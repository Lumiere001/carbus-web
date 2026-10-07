import { z } from "zod";

const nullableId = z.number().int().positive().nullable();
const leg = z.strictObject({
  direction: z.enum(["up", "down"]), mode: z.enum(["our_bus", "other_district", "ktx", "own_car", "other"]),
  via_unit_id: z.string().uuid().nullable(), status: z.enum(["pending", "confirmed"]),
}).refine((v) => v.mode === "other_district" ? v.via_unit_id !== null : v.via_unit_id === null && v.status === "confirmed", "타지구 차량의 지구와 확정 상태를 확인해 주세요.");
export const createRegistrationSchema = z.strictObject({
  name: z.string().trim().min(1, "이름은 필수입니다"),
  student_id: z.string().trim().regex(/^(\d{2}|외국인|타지구)$/, "학번은 두 자리 숫자 또는 외국인/타지구만 가능합니다"),
  campus_id: z.string().uuid("캠퍼스를 선택해 주세요"),
  up_trip_id: nullableId, down_trip_id: nullableId,
  payment_status: z.enum(["unpaid", "paid", "waived"]), note: z.string().nullable(),
  attend_from: z.iso.date().nullable(), attend_to: z.iso.date().nullable(),
  legs: z.array(leg),
  pickups: z.array(z.strictObject({ direction: z.enum(["up", "down"]), pickup_at: z.iso.datetime({ offset: true }).nullable(), place_id: nullableId, note: z.string().nullable() })),
  courses: z.array(z.strictObject({ day_no: z.number().int().min(1).max(14), at_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable() })),
}).refine((v) => !v.attend_from || !v.attend_to || v.attend_from <= v.attend_to, { message: "참여 종료일이 시작일보다 빠릅니다", path: ["attend_to"] });
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
