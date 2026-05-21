import { z } from "zod";

/**
 * 순장/순원 신청 검증 — carbus-web v4.2 (reference/validators.md 포팅).
 * Zod 4 기준. 클라이언트·서버 공용 스키마.
 */

export const STUDENT_ID_SPECIAL = ["외국인", "타지구"] as const;
export const DEPARTURE_DAYS = ["TUE", "WED"] as const;
export const ATTENDANCE_TYPES = ["roundtrip", "oneway"] as const;

export const RegistrationSchema = z
  .object({
    name: z
      .string()
      .min(1, "이름은 필수입니다")
      .max(20, "이름이 너무 깁니다 (20자 이내)"),
    campus_id: z.string().uuid("캠퍼스를 선택해주세요"),
    student_id: z.string().refine(
      (v) =>
        /^\d{2}$/.test(v) ||
        (STUDENT_ID_SPECIAL as readonly string[]).includes(v),
      {
        message: "학번 형식이 올바르지 않습니다 (예: 26 / 외국인 / 타지구)",
      }
    ),
    attendance_type: z.enum(ATTENDANCE_TYPES, {
      error: "참석 유형을 선택해주세요",
    }),
    departure_day: z.enum(DEPARTURE_DAYS).nullable(),
    uses_return_bus: z.boolean(),
    note: z.string().max(200, "비고는 200자 이내입니다").nullish(),
    roles: z.array(z.string()).default([]),
  })
  // 규칙 3: 왕복 일관성 — departure_day NOT NULL AND uses_return_bus
  .refine(
    (data) =>
      data.attendance_type !== "roundtrip" ||
      (data.departure_day !== null && data.uses_return_bus === true),
    {
      message: "왕복은 상행 요일과 하행 차량 이용이 모두 필요합니다",
      path: ["attendance_type"],
    }
  )
  // 규칙 4: 편도 일관성 — 편도 상행(요일O+하행X) 또는 편도 하행(요일X+하행O) 중 하나
  .refine(
    (data) => {
      if (data.attendance_type !== "oneway") return true;
      const upOnly =
        data.departure_day !== null && data.uses_return_bus === false;
      const downOnly =
        data.departure_day === null && data.uses_return_bus === true;
      return upOnly || downOnly;
    },
    {
      message: "편도는 상행 또는 하행 중 하나만 선택 가능합니다",
      path: ["attendance_type"],
    }
  );

export type RegistrationInput = z.infer<typeof RegistrationSchema>;

/** 수정 시 — id + version (낙관적 동시성). */
export const RegistrationUpdateSchema = RegistrationSchema.safeExtend({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});

export type RegistrationUpdateInput = z.infer<typeof RegistrationUpdateSchema>;

/** Zod issue 배열 → 필드별 메시지 맵 (UI inline error 용). */
export function fieldErrors(
  error: z.ZodError
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
