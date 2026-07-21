import { z } from "zod";

/**
 * 순장/순원 신청 검증 — carbus-web v4.2 (reference/validators.md 포팅).
 * Zod 4 기준. 클라이언트·서버 공용 스키마.
 */

export const STUDENT_ID_SPECIAL = ["외국인", "타지구"] as const;
export const ATTENDANCE_TYPES = ["roundtrip", "oneway", "self"] as const;

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
    // ⚠️ attendance_type 은 **입력이 아니다.** DB 트리거가 (상행 편, 하행 편)에서
    //    파생한다. 예전엔 입력으로 받고 3개 refine 으로 일관성을 강제했는데,
    //    그 규칙들이 곧 파생 규칙이었다 — 즉 파생값을 입력으로 받고 나서
    //    "제대로 계산해 왔는지" 검사하고 있었다. 이제 그럴 필요가 없다.
    up_trip_id: z
      .number({ error: "상행 운행편을 선택해주세요" })
      .int()
      .positive()
      .nullable(),
    down_trip_id: z
      .number({ error: "하행 운행편을 선택해주세요" })
      .int()
      .positive()
      .nullable(),
    note: z.string().max(200, "비고는 200자 이내입니다").nullish(),
    roles: z.array(z.string()).default([]),
  })
  // 버스를 전혀 안 타면 이동 수단을 알아야 한다 — 배차·출석에서 빠지기 때문이다.
  .refine(
    (d) => d.up_trip_id !== null || d.down_trip_id !== null || !!d.note?.trim(),
    {
      message:
        "버스를 이용하지 않는 경우 이동 수단(KTX·자차 등)을 비고에 적어주세요",
      path: ["note"],
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
