import Papa from "papaparse";
import {
  RegistrationSchema,
  fieldErrors,
  type RegistrationInput,
} from "@/lib/validators/registration";
import { ATTENDANCE_FROM_KO, BOOL_FROM_KO } from "@/lib/labels";
import type { DepartureSlot } from "@/lib/supabase/types";

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
  "상행 출발": "departure_slot_id",
  "상행 요일": "departure_slot_id",
  "하행 차량 이용": "uses_return_bus",
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
  slots: Pick<DepartureSlot, "id" | "key" | "label">[]
): CsvParseResult {
  // 상행 출발 입력값(라벨 또는 key) → slot id. 트림·소문자 허용.
  const slotIdFromInput = (raw: string): number | null | undefined => {
    const v = raw.trim();
    if (v === "") return null; // 미입력 = 상행 미이용(하행편도)
    const hit = slots.find(
      (s) => s.label === v || s.key === v || s.key === v.toLowerCase()
    );
    return hit ? hit.id : undefined; // 미인식 → undefined(검증 실패로 표면화)
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
    if ("departure_slot_id" in mapped) {
      mapped.departure_slot_id = slotIdFromInput(
        (mapped.departure_slot_id as string) ?? ""
      );
    } else {
      mapped.departure_slot_id = null;
    }
    if ("uses_return_bus" in mapped) {
      const b = (mapped.uses_return_bus as string) ?? "";
      if (b === "") mapped.uses_return_bus = false;
      else if (b in BOOL_FROM_KO) mapped.uses_return_bus = BOOL_FROM_KO[b];
      else mapped.uses_return_bus = undefined; // 인식 불가 값 → 검증 실패로 표면화(조용히 false로 두지 않음)
    } else {
      mapped.uses_return_bus = false;
    }
    if (mapped.note === "") mapped.note = null;

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
