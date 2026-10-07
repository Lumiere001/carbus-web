"use client";

import { TransportPicker } from "@/components/admin/transport-picker";
import { legSkipsOurBus } from "@/lib/transport/labels";
import { DIRECTION_LABELS } from "@/lib/transport/labels";
import { createInputClass as input, createLabelClass as label, createSectionClass as section } from "./types";
import type { CreateFieldsProps } from "./types";

export function RegistrationCreateJourney({ value, onChange, units }: CreateFieldsProps & {
  readonly units: { id: string; name: string }[];
}) {
  return <>
    <fieldset className={section}>
      <legend className="px-1 text-base font-semibold text-foreground">부분 참석 · 참여 기간</legend>
      <p className="text-sm text-muted">참여 예정 날짜입니다. 전체 참석이면 두 날짜를 비워 두세요.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>참여 시작일<input type="date" className={input} value={value.attend_from ?? ""} onChange={(e) => onChange({ attend_from: e.target.value || null })} /></label>
        <label className={label}>참여 종료일<input type="date" className={input} value={value.attend_to ?? ""} onChange={(e) => onChange({ attend_to: e.target.value || null })} /></label>
      </div>
    </fieldset>
    <fieldset className={section}>
      <legend className="px-1 text-base font-semibold text-foreground">이동수단</legend>
      <p className="text-sm text-muted">상행과 하행을 따로 고르세요. 우리 버스가 아닌 확정 이동수단은 해당 편을 비우고 저장합니다.</p>
      <div className="grid gap-4 lg:grid-cols-2">{value.legs.map((leg) => <TransportPicker key={leg.direction} label={DIRECTION_LABELS[leg.direction]} units={units} value={{ mode: leg.mode, viaUnitId: leg.via_unit_id, status: leg.status }} onChange={(next) => onChange({ ...(legSkipsOurBus(next.mode, next.status) ? (leg.direction === "up" ? { up_trip_id: null } : { down_trip_id: null }) : {}), legs: value.legs.map((item) => item.direction === leg.direction ? { ...leg, mode: next.mode, via_unit_id: next.viaUnitId, status: next.status } : item) })} />)}</div>
    </fieldset>
  </>;
}
