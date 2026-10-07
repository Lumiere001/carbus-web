import { z } from "zod";
import { toKstInput } from "@/lib/time/kst";
import type { TransportMode, TransportStatus } from "@/lib/transport/labels";

export type AttendancePlan = {
  readonly attend_from: string | null;
  readonly attend_to: string | null;
  readonly attend_from_at: string | null;
  readonly attend_to_at: string | null;
};
export type AttendancePlanLeg = {
  readonly direction: "up" | "down";
  readonly mode: TransportMode;
  readonly status: TransportStatus;
};
type PlanJourney = AttendancePlan & {
  readonly up_trip_id: number | null;
  readonly down_trip_id: number | null;
  readonly legs: readonly AttendancePlanLeg[];
};
export type AttendancePlanValidation = { readonly ok: true } | {
  readonly ok: false;
  readonly field: keyof AttendancePlan | "legs";
  readonly message: string;
};
const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();

/** 기존 날짜가 모두 NULL이면 행사 전체 참석이다. 버스 편도와 부분 참석은 별개다. */
export function isPartialAttendance(plan: Pick<AttendancePlan, "attend_from" | "attend_to">): boolean {
  return plan.attend_from !== null || plan.attend_to !== null;
}

export function needsAttendancePlan(input: PlanJourney): boolean {
  return isPartialAttendance(input) || input.up_trip_id === null || input.down_trip_id === null
    || input.legs.some((leg) => leg.mode !== "our_bus");
}

/** 실제 현장 입·퇴장 기록과 별개로, 신청 시 확정한 참여 기간과 이동수단을 검사한다. */
export function validateAttendancePlan(input: PlanJourney): AttendancePlanValidation {
  const fail = (field: keyof AttendancePlan | "legs", message: string): AttendancePlanValidation => ({ ok: false, field, message });
  for (const direction of ["up", "down"] as const) {
    const legs = input.legs.filter((leg) => leg.direction === direction);
    if (legs.length > 1) return fail("legs", "방향별 이동수단은 하나만 선택해 주세요.");
    const trip = direction === "up" ? input.up_trip_id : input.down_trip_id;
    if (trip === null && (!legs[0] || legs[0].mode === "our_bus")) {
      return fail("legs", `${direction === "up" ? "상행" : "하행"} 이동수단을 선택하세요.`);
    }
  }
  if (isPartialAttendance(input)) {
    if (!input.attend_from || !input.attend_to) return fail("attend_from", "부분 참석의 시작일과 종료일을 모두 지정해 주세요.");
    if (!date.safeParse(input.attend_from).success || !date.safeParse(input.attend_to).success) return fail("attend_from", "참여 날짜를 확인해 주세요.");
    if (input.attend_from > input.attend_to) return fail("attend_to", "참여 종료일이 시작일보다 빠릅니다.");
  }
  const start = input.attend_from_at;
  const end = input.attend_to_at;
  if (needsAttendancePlan(input) || start !== null || end !== null) {
    if (!start || !end) return fail("attend_from_at", "참여 시작과 종료의 날짜·시각을 모두 확정해 주세요.");
    if (!timestamp.safeParse(start).success || !timestamp.safeParse(end).success
      || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) {
      return fail("attend_from_at", "참여 시작과 종료의 날짜·시각·시간대를 모두 지정해 주세요.");
    }
    if (Date.parse(start) >= Date.parse(end)) return fail("attend_to_at", "참여 종료 일시는 시작 일시보다 늦어야 합니다.");
    if (isPartialAttendance(input) && (toKstInput(start).slice(0, 10) !== input.attend_from
      || toKstInput(end).slice(0, 10) !== input.attend_to)) {
      return fail("attend_from_at", "참여 일시의 한국 날짜가 참여 시작일·종료일과 일치해야 합니다.");
    }
  }
  return { ok: true };
}
