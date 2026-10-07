"use client";

import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { registrationLegSchema } from "./create-schema";
import { validateAttendancePlan, type AttendancePlan } from "./attendance-plan";
import type { RegistrationRow } from "./mutations";
import { toKst } from "@/lib/time/kst";

export type RegistrationJourneyLeg = z.infer<typeof registrationLegSchema>;
export type RegistrationJourneyTrips = { readonly up_trip_id: number | null; readonly down_trip_id: number | null };
export type RegistrationJourneySnapshot = AttendancePlan & RegistrationJourneyTrips & {
  readonly version: number;
  readonly legs: readonly RegistrationJourneyLeg[];
};
type JourneyResult = { readonly ok: true; readonly row: RegistrationRow; readonly legs: readonly RegistrationJourneyLeg[] } | {
  readonly ok: false; readonly message: string; readonly conflict?: boolean; readonly uncertain?: boolean;
};
const journeySchema = z.strictObject({
  attend_from: z.iso.date().nullable(), attend_to: z.iso.date().nullable(),
  attend_from_at: z.iso.datetime({ offset: true }).nullable(), attend_to_at: z.iso.datetime({ offset: true }).nullable(),
  up_trip_id: z.number().int().positive().nullable(), down_trip_id: z.number().int().positive().nullable(),
  legs: z.array(registrationLegSchema),
}).superRefine((value, ctx) => {
  const result = validateAttendancePlan(value);
  if (!result.ok) ctx.addIssue({ code: "custom", message: result.message, path: [result.field] });
});

/** 참여 기간·버스 편·방향별 이동수단을 관찰한 상태와 비교하고 함께 저장한다. */
export async function saveRegistrationJourney(
  id: string,
  expected: RegistrationJourneySnapshot,
  plan: AttendancePlan,
  trips: RegistrationJourneyTrips,
  legs: readonly RegistrationJourneyLeg[]
): Promise<JourneyResult> {
  const parsed = journeySchema.safeParse({ attend_from: plan.attend_from, attend_to: plan.attend_to,
    up_trip_id: trips.up_trip_id, down_trip_id: trips.down_trip_id, legs: [...legs],
    attend_from_at: toKst(plan.attend_from_at), attend_to_at: toKst(plan.attend_to_at) });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "참여 일정과 이동수단을 확인해 주세요." };
  const supabase = createClient();
  const { data, error } = await supabase.rpc("save_registration_journey", { p_registration_id: id,
    p_expected: { attend_from: expected.attend_from, attend_to: expected.attend_to,
      attend_from_at: expected.attend_from_at, attend_to_at: expected.attend_to_at,
      up_trip_id: expected.up_trip_id, down_trip_id: expected.down_trip_id, version: expected.version, legs: [...expected.legs] },
    p_input: parsed.data });
  if (error) {
    const conflict = error.code === "40001" || error.code === "40P01";
    const uncertain = !/^(22|23|40|42|P0)/.test(error.code);
    return { ok: false, conflict, uncertain, message: uncertain
      ? "저장 결과를 확인하지 못했습니다. 명단을 새로고침한 뒤 다시 확인해 주세요."
      : error.code === "40P01" ? "다른 변경과 겹쳐 저장하지 않았습니다. 최신 자료를 불러온 뒤 다시 확인해 주세요." : error.message };
  }
  if (!data) return { ok: false, uncertain: true, message: "저장 결과를 확인하지 못했습니다. 명단을 새로고침해 확인해 주세요." };
  return { ok: true, row: data.row, legs: data.legs };
}
