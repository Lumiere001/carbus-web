"use client";

import { DateTimeField } from "@/components/ui/date-time-field";
import type { AttendancePlan } from "@/lib/registrations/attendance-plan";
import { isPartialAttendance } from "@/lib/registrations/attendance-plan";
import { toKstInput } from "@/lib/time/kst";

/** 편집 초안은 반쪽 날짜·시각을 보존하고, 저장 경계에서만 KST로 변환한다. */
export function attendancePlanDraft(plan: AttendancePlan): AttendancePlan {
  return { attend_from: plan.attend_from, attend_to: plan.attend_to, attend_from_at: toKstInput(plan.attend_from_at) || (plan.attend_from ? `${plan.attend_from}T` : null),
    attend_to_at: toKstInput(plan.attend_to_at) || (plan.attend_to ? `${plan.attend_to}T` : null) };
}
export function AttendancePlanFields({ value, required, disabled, error, onChange }: {
  readonly value: AttendancePlan;
  readonly required: boolean;
  readonly disabled?: boolean;
  readonly error?: string;
  readonly onChange: (plan: AttendancePlan) => void;
}) {
  const partial = isPartialAttendance(value);
  const showTimes = required || partial || Boolean(value.attend_from_at || value.attend_to_at);
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-foreground">
      <input type="checkbox" checked={partial} onChange={(event) => onChange({ ...value,
        attend_from: event.target.checked ? value.attend_from_at?.split("T")[0] ?? "" : null,
        attend_to: event.target.checked ? value.attend_to_at?.split("T")[0] ?? "" : null,
      })} />행사의 일부 기간만 참석합니다
    </label>
    <p className="text-sm text-muted">{showTimes ? "참여 시작·종료 날짜와 시각을 모두 확정해서 입력하세요. 실제 행사장 도착·떠남 체크와 별도로 저장합니다." : "행사 전체에 참석하며 우리 버스를 왕복 이용합니다. 일부 기간만 참석한다면 위 항목을 선택하세요."}</p>
    {showTimes && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <DateTimeField label="참여 시작" value={value.attend_from_at ?? ""} error={error} onChange={(next) => onChange({ ...value,
        attend_from_at: next || null, attend_from: partial ? next.split("T")[0] : null })} />
      <DateTimeField label="참여 종료" value={value.attend_to_at ?? ""} onChange={(next) => onChange({ ...value,
        attend_to_at: next || null, attend_to: partial ? next.split("T")[0] : null })} />
    </div>}
  </fieldset>;
}
