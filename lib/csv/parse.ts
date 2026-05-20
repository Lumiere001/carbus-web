import Papa from "papaparse";
import {
  RegistrationSchema,
  fieldErrors,
  type RegistrationInput,
} from "@/lib/validators/registration";
import { ATTENDANCE_FROM_KO, DAY_FROM_KO, BOOL_FROM_KO } from "@/lib/labels";

/**
 * CSV·복붙 import 파싱 (reference/validators.md §5·7).
 * 임역원용: 캠퍼스는 본인 것으로 자동 → CSV에 캠퍼스 컬럼 없음.
 *
 * 흐름: papaparse(한글 헤더) → 영문 필드 매핑 → 값 변환 → 행별 Zod 검증 → 성공/실패 분리.
 */

/** CSV 한글 헤더 → registrations 영문 필드. */
const HEADER_MAP: Record<string, string> = {
  이름: "name",
  학번: "student_id",
  "참석 유형": "attendance_type",
  "상행 요일": "departure_day",
  "하행 차량 이용": "uses_return_bus",
  비고: "note",
};

export type ParsedRow = Omit<RegistrationInput, "campus_id">;

export type CsvParseResult = {
  successes: ParsedRow[];
  failures: { row: number; reason: string; raw: Record<string, string> }[];
};

/**
 * @param csv     CSV 또는 TSV 텍스트 (복붙 포함). papaparse가 구분자 자동 감지.
 * @param campusId 검증용 캠퍼스 uuid (Zod는 campus_id 필요. 실제 INSERT 시 호출부가 본인 캠퍼스로 세팅).
 */
export function parseRegistrationsCsv(
  csv: string,
  campusId: string
): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const successes: ParsedRow[] = [];
  const failures: CsvParseResult["failures"] = [];

  parsed.data.forEach((rawRow, idx) => {
    const mapped: Record<string, unknown> = {};
    for (const [ko, en] of Object.entries(HEADER_MAP)) {
      if (rawRow[ko] !== undefined) mapped[en] = rawRow[ko]?.trim();
    }

    // 값 변환 (한글·기호 → enum/boolean)
    if (typeof mapped.attendance_type === "string") {
      mapped.attendance_type =
        ATTENDANCE_FROM_KO[mapped.attendance_type] ?? mapped.attendance_type;
    }
    if ("departure_day" in mapped) {
      const d = (mapped.departure_day as string) ?? "";
      mapped.departure_day = d in DAY_FROM_KO ? DAY_FROM_KO[d] : (d || null);
    }
    if ("uses_return_bus" in mapped) {
      const b = (mapped.uses_return_bus as string) ?? "";
      mapped.uses_return_bus = BOOL_FROM_KO[b] ?? false;
    } else {
      mapped.uses_return_bus = false;
    }
    if (mapped.note === "") mapped.note = null;

    const candidate = { ...mapped, campus_id: campusId, roles: [] };
    const result = RegistrationSchema.safeParse(candidate);

    if (result.success) {
      const { campus_id: _omit, ...rest } = result.data;
      void _omit;
      successes.push(rest);
    } else {
      const errs = fieldErrors(result.error);
      const reason = Object.entries(errs)
        .map(([k, msgs]) => `${k}: ${msgs[0]}`)
        .join("; ");
      failures.push({ row: idx + 2, reason, raw: rawRow }); // +2: 1-based + 헤더행
    }
  });

  return { successes, failures };
}
