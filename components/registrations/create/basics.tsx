"use client";

import { legSkipsOurBus } from "@/lib/transport/labels";
import { PAYMENT_LABELS, PAYMENT_STATUSES, tripOptions } from "@/lib/labels";
import type { EventTrip } from "@/lib/supabase/types";
import { createInputClass as input, createLabelClass as label, createSectionClass as section } from "./types";
import type { CreateFieldsProps } from "./types";

export function RegistrationCreateBasics({ value, onChange, campuses, trips, lockedCampusId }: CreateFieldsProps & {
  readonly campuses: readonly { readonly id: string; readonly name: string }[];
  readonly trips: EventTrip[];
  readonly lockedCampusId?: string;
}) {
  return <fieldset className={section}>
    <legend className="px-1 text-base font-semibold text-foreground">기본 정보</legend>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className={label}>이름<input autoFocus required className={input} value={value.name} onChange={(e) => onChange({ name: e.target.value })} /></label>
      <label className={label}>학번<input required className={input} value={value.student_id} onChange={(e) => onChange({ student_id: e.target.value })} placeholder="26 / 외국인 / 타지구" /></label>
      <label className={label}>캠퍼스<select disabled={Boolean(lockedCampusId)} className={input} value={value.campus_id} onChange={(e) => onChange({ campus_id: e.target.value })}>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className={label}>납부<select className={input} value={value.payment_status} onChange={(e) => { const status = PAYMENT_STATUSES.find((s) => s === e.target.value); if (status) onChange({ payment_status: status }); }}>{PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_LABELS[s]}</option>)}</select></label>
      {(["up", "down"] as const).map((dir) => <label key={dir} className={label}>{dir === "up" ? "상행 (가는 편)" : "하행 (오는 편)"}<select disabled={value.legs.some((leg) => leg.direction === dir && legSkipsOurBus(leg.mode, leg.status))} className={input} value={(dir === "up" ? value.up_trip_id : value.down_trip_id) ?? ""} onChange={(e) => onChange(dir === "up" ? { up_trip_id: e.target.value ? Number(e.target.value) : null } : { down_trip_id: e.target.value ? Number(e.target.value) : null })}>{tripOptions(trips, dir).map((o) => <option key={o.id ?? "none"} value={o.id ?? ""}>{o.label}</option>)}</select></label>)}
      <label className={label + " sm:col-span-2"}>비고<textarea className={input} rows={3} value={value.note ?? ""} onChange={(e) => onChange({ note: e.target.value || null })} /></label>
    </div>
  </fieldset>;
}
