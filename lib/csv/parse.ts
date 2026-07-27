import Papa from "papaparse";
import {
  RegistrationSchema,
  fieldErrors,
  type RegistrationInput,
} from "@/lib/validators/registration";
import {
  ATTENDANCE_FROM_KO,
  ATTENDANCE_LABELS,
  BOOL_FROM_KO,
  deriveAttendance,
} from "@/lib/labels";
import type { EventTrip } from "@/lib/supabase/types";

/**
 * CSV·복붙 import 파싱 (reference/validators.md §5·7).
 * 임역원용: 캠퍼스는 본인 것으로 자동 → CSV에 캠퍼스 컬럼 없음.
 *
 * 흐름: papaparse(한글 헤더) → 영문 필드 매핑 → 값 변환 → 행별 Zod 검증 → 성공/실패 분리.
 */

/** CSV 한글 헤더 → registrations 영문 필드. ("상행 요일"은 구 템플릿 호환). */
const HEADER_MAP: Record<string, string> = {
  이름: "name",
  학번: "student_id",
  "참석 유형": "attendance_type",
  "상행 출발": "up_trip_id",
  "상행 요일": "up_trip_id",
  // 하행은 O/X 였다. 이제 편 라벨도 받는다 — 둘 다 아래에서 해석한다.
  "하행 차량 이용": "down_trip_id",
  "하행 출발": "down_trip_id",
  비고: "note",
};

export type ParsedRow = Omit<RegistrationInput, "campus_id">;

export type CsvParseResult = {
  successes: ParsedRow[];
  failures: { row: number; reason: string; raw: Record<string, string> }[];
  /** 사용자 안내 (빈 파일·행수 초과 등). 없으면 정상. */
  notice?: string;
};

/** 한 번에 처리할 최대 행 수 (수련회 규모상 충분, 폭주 방지). */
const MAX_ROWS = 1000;

/**
 * @param csv     CSV 또는 TSV 텍스트 (복붙 포함). papaparse가 구분자 자동 감지.
 * @param campusId 검증용 캠퍼스 uuid (Zod는 campus_id 필요. 실제 INSERT 시 호출부가 본인 캠퍼스로 세팅).
 */
export function parseRegistrationsCsv(
  csv: string,
  campusId: string,
  trips: Pick<EventTrip, "id" | "key" | "label" | "direction" | "active">[]
): CsvParseResult {
  const dirTrips = (d: "up" | "down") => trips.filter((t) => t.direction === d);

  /** 편 입력값(라벨 또는 key) → 편 id. 트림·소문자 허용. 미인식은 undefined. */
  const tripIdFromInput = (
    raw: string,
    direction: "up" | "down"
  ): number | null | undefined => {
    const v = raw.trim();
    if (v === "") return null; // 미입력 = 그 방향 미이용
    const pool = dirTrips(direction);
    const hit = pool.find(
      (t) => t.label === v || t.key === v || t.key === v.toLowerCase()
    );
    if (hit) return hit.id;

    // ── 하위호환: 하행이 O/X 불린이던 시절의 CSV ──────────────
    // 임역원들이 쓰던 템플릿이 전부 O/X 다. 그걸 계속 받아야 한다.
    // O 는 "탄다"만 말하므로 편이 하나일 때만 해석할 수 있다.
    // 여러 편이면 조용히 아무 편이나 꽂지 않고 미인식으로 두어 사람이 고치게 한다
    // (조용히 꽂으면 엉뚱한 시각 버스에 배차된다).
    if (direction === "down" && v in BOOL_FROM_KO) {
      if (!BOOL_FROM_KO[v]) return null; // X → 하행 미이용
      const active = pool.filter((t) => t.active);
      return active.length === 1 ? active[0].id : undefined;
    }
    return undefined; // 미인식 → 검증 실패로 표면화
  };

  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const successes: ParsedRow[] = [];
  const failures: CsvParseResult["failures"] = [];

  // 빈 파일 안내
  if (parsed.data.length === 0) {
    return {
      successes,
      failures,
      notice: "행이 없습니다. 헤더와 데이터가 있는 CSV인지 확인해주세요.",
    };
  }

  // 행수 초과 시 잘라서 처리하고 안내
  const overflow = parsed.data.length > MAX_ROWS;
  const rows = overflow ? parsed.data.slice(0, MAX_ROWS) : parsed.data;

  // 파일 내 중복(이름+학번) 검출용
  const seen = new Set<string>();

  rows.forEach((rawRow, idx) => {
    const mapped: Record<string, unknown> = {};
    for (const [ko, en] of Object.entries(HEADER_MAP)) {
      if (rawRow[ko] !== undefined) mapped[en] = rawRow[ko]?.trim();
    }

    // 값 변환 (한글·기호 → enum/boolean)
    if (typeof mapped.attendance_type === "string") {
      mapped.attendance_type =
        ATTENDANCE_FROM_KO[mapped.attendance_type] ?? mapped.attendance_type;
    }
    const hasDownColumn = "down_trip_id" in mapped;
    mapped.up_trip_id =
      "up_trip_id" in mapped
        ? tripIdFromInput((mapped.up_trip_id as string) ?? "", "up")
        : null;
    mapped.down_trip_id = hasDownColumn
      ? tripIdFromInput((mapped.down_trip_id as string) ?? "", "down")
      : null;
    if (mapped.note === "") mapped.note = null;

    // ── '참석 유형' 열 처리 ────────────────────────────────
    // attendance_type 은 3-C 에서 파생값이 됐다(DB 트리거가 두 편에서 계산).
    // 그런데 임역원 템플릿에는 이 열이 그대로 있고, 예전엔 읽어서 **조용히 버렸다.**
    // 그 결과 하행 열이 없는 옛 CSV 의 "왕복" 이 편도 상행으로 등록됐다 —
    // 학우는 왕복 요금을 냈는데 귀가 버스에서 빠진다.
    // 그래서 지금은 ① 하행 열이 없을 때 참석 유형으로 하행을 정하고,
    // ② 정할 수 없거나 두 편과 어긋나면 **실패로 표면화**한다.
    const declared = mapped.attendance_type;
    const up = mapped.up_trip_id;
    const down = mapped.down_trip_id;
    let attendanceError: string | null = null;

    if (typeof declared === "string" && declared !== "" && !(declared in ATTENDANCE_LABELS)) {
      attendanceError = `참석 유형: '${declared}' 을 알 수 없습니다 (왕복 / 편도 / 버스 미이용)`;
    } else if (
      typeof declared === "string" &&
      declared !== "" &&
      up !== undefined &&
      down !== undefined
    ) {
      const wantsDown = declared === "roundtrip" || (declared === "oneway" && up === null);
      if (!hasDownColumn && wantsDown) {
        // 하행 열이 아예 없는 옛 포맷. "탄다"까지는 알지만 어느 편인지는 모른다.
        const active = dirTrips("down").filter((t) => t.active);
        if (active.length === 1) mapped.down_trip_id = active[0].id;
        else
          attendanceError =
            active.length === 0
              ? "참석 유형: 하행 운행편이 없습니다 (편성에서 먼저 만들어 주세요)"
              : `참석 유형: 하행 편이 ${active.length}개라 "왕복/편도"만으로는 정할 수 없습니다 — '하행 출발' 열에 편을 적어주세요`;
      }
      if (!attendanceError) {
        const derived = deriveAttendance(
          mapped.up_trip_id as number | null,
          mapped.down_trip_id as number | null
        );
        if (derived !== declared)
          attendanceError = `참석 유형: '${ATTENDANCE_LABELS[declared as keyof typeof ATTENDANCE_LABELS]}' 인데 상·하행 입력은 '${ATTENDANCE_LABELS[derived]}' 입니다 — 한쪽을 고쳐주세요`;
      }
    }

    if (attendanceError) {
      failures.push({ row: idx + 2, reason: attendanceError, raw: rawRow });
      return;
    }

    const candidate = { ...mapped, campus_id: campusId, roles: [] };
    const result = RegistrationSchema.safeParse(candidate);

    if (result.success) {
      const { campus_id: _omit, ...rest } = result.data;
      void _omit;
      const key = `${rest.name}|${rest.student_id}`;
      if (seen.has(key)) {
        failures.push({
          row: idx + 2,
          reason: "파일 내 중복 (이름+학번이 위 행과 같음)",
          raw: rawRow,
        });
      } else {
        seen.add(key);
        successes.push(rest);
      }
    } else {
      const errs = fieldErrors(result.error);
      const reason = Object.entries(errs)
        .map(([k, msgs]) => `${k}: ${msgs[0]}`)
        .join("; ");
      failures.push({ row: idx + 2, reason, raw: rawRow }); // +2: 1-based + 헤더행
    }
  });

  return {
    successes,
    failures,
    notice: overflow
      ? `행이 너무 많아 처음 ${MAX_ROWS}건만 처리했습니다. 나눠서 올려주세요.`
      : undefined,
  };
}
