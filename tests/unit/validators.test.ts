import { describe, expect, it } from "vitest";
import {
  RegistrationSchema,
  fieldErrors,
} from "@/lib/validators/registration";

const VALID_CAMPUS = "11111111-1111-4111-8111-111111111111";

function base(overrides: Record<string, unknown> = {}) {
  return {
    name: "김철수",
    campus_id: VALID_CAMPUS,
    student_id: "26",
    attendance_type: "roundtrip",
    departure_day: "TUE",
    uses_return_bus: true,
    roles: [],
    ...overrides,
  };
}

describe("RegistrationSchema (reference/validators.md §8)", () => {
  it("1) 이름 빈 값 → 실패", () => {
    const r = RegistrationSchema.safeParse(base({ name: "" }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error).name?.[0]).toContain("이름은 필수");
    }
  });

  it("2) 학번 형식 위반 (2611) → 실패", () => {
    const r = RegistrationSchema.safeParse(base({ student_id: "2611" }));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error).student_id?.[0]).toContain("학번 형식");
    }
  });

  it("3) 학번 특수값 '간사' → 통과", () => {
    const r = RegistrationSchema.safeParse(base({ student_id: "간사" }));
    expect(r.success).toBe(true);
  });

  it("3b) 학번 '외국인' / '타지구' → 통과", () => {
    expect(RegistrationSchema.safeParse(base({ student_id: "외국인" })).success).toBe(true);
    expect(RegistrationSchema.safeParse(base({ student_id: "타지구" })).success).toBe(true);
  });

  it("4) 왕복인데 departure_day=null → 실패 (규칙 3)", () => {
    const r = RegistrationSchema.safeParse(
      base({ attendance_type: "roundtrip", departure_day: null, uses_return_bus: true })
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error).attendance_type?.[0]).toContain("왕복은 상행 요일");
    }
  });

  it("4b) 왕복 + 요일 + 하행이용 → 통과", () => {
    const r = RegistrationSchema.safeParse(
      base({ attendance_type: "roundtrip", departure_day: "WED", uses_return_bus: true })
    );
    expect(r.success).toBe(true);
  });

  it("5) 편도인데 요일+하행 둘 다 → 실패 (규칙 4)", () => {
    const r = RegistrationSchema.safeParse(
      base({ attendance_type: "oneway", departure_day: "TUE", uses_return_bus: true })
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error).attendance_type?.[0]).toContain("편도는");
    }
  });

  it("6) 편도 상행 (요일O + 하행X) → 통과", () => {
    const r = RegistrationSchema.safeParse(
      base({ attendance_type: "oneway", departure_day: "TUE", uses_return_bus: false })
    );
    expect(r.success).toBe(true);
  });

  it("7) 편도 하행 (요일X + 하행O) → 통과", () => {
    const r = RegistrationSchema.safeParse(
      base({ attendance_type: "oneway", departure_day: null, uses_return_bus: true })
    );
    expect(r.success).toBe(true);
  });

  it("8) 편도인데 요일X + 하행X → 실패", () => {
    const r = RegistrationSchema.safeParse(
      base({ attendance_type: "oneway", departure_day: null, uses_return_bus: false })
    );
    expect(r.success).toBe(false);
  });

  it("9) departure_day=THU → 실패 (규칙 5, Zod enum)", () => {
    const r = RegistrationSchema.safeParse(base({ departure_day: "THU" }));
    expect(r.success).toBe(false);
  });

  it("10) campus_id 비-uuid → 실패", () => {
    const r = RegistrationSchema.safeParse(base({ campus_id: "not-a-uuid" }));
    expect(r.success).toBe(false);
  });

  it("정상 케이스 (왕복 화요일) → 통과 + roles 기본 []", () => {
    const r = RegistrationSchema.safeParse(base({ roles: undefined }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.roles).toEqual([]);
  });
});
