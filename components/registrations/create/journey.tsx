"use client";

import { TransportPicker } from "@/components/admin/transport-picker";
import { AttendancePlanFields } from "@/components/registrations/plan/fields";
import { needsAttendancePlan } from "@/lib/registrations/attendance-plan";
import { DIRECTION_LABELS, legSkipsOurBus } from "@/lib/transport/labels";
import { createSectionClass as section } from "./types";
import type { CreateFieldsProps } from "./types";

export function RegistrationCreateJourney({ value, onChange, units }: CreateFieldsProps & {
  readonly units: { id: string; name: string }[];
}) {
  return <>
    <fieldset className={section}>
      <legend className="px-1 text-base font-semibold text-foreground">참여 예정 일정</legend>
      <AttendancePlanFields value={value} required={needsAttendancePlan(value)} onChange={onChange} />
    </fieldset>
    <fieldset className={section}>
      <legend className="px-1 text-base font-semibold text-foreground">이동수단</legend>
      <p className="text-sm text-muted">우리 버스를 타는 방향은 운행편을 고르고, 버스를 타지 않는 방향은 이동수단을 꼭 선택하세요.</p>
      <div className="grid gap-4 lg:grid-cols-2">{(["up", "down"] as const).map((direction) => {
        const leg = value.legs.find((item) => item.direction === direction);
        return <TransportPicker key={direction} label={DIRECTION_LABELS[direction]} units={units}
          value={leg ? { mode: leg.mode, viaUnitId: leg.via_unit_id, status: leg.status } : null}
          onChange={(next) => onChange({ ...(legSkipsOurBus(next.mode, next.status) ? (direction === "up" ? { up_trip_id: null } : { down_trip_id: null }) : {}),
            legs: [...value.legs.filter((item) => item.direction !== direction), { direction, mode: next.mode, via_unit_id: next.viaUnitId, status: next.status }],
          })} />;
      })}</div>
    </fieldset>
  </>;
}
