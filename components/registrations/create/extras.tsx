"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { dayLabel } from "@/lib/courses/days";
import { PICKUP_DIRECTION_LABELS } from "@/lib/transport/labels";
import type { CreateRegistrationInput } from "@/lib/registrations/create-schema";
import { createInputClass as input, createLabelClass as label, createSectionClass as section } from "./types";
import type { CreateFieldsProps } from "./types";

type Pickup = CreateRegistrationInput["pickups"][number];
export function RegistrationCreateExtras({ value, onChange, places, dayCount }: CreateFieldsProps & {
  readonly places: readonly { readonly id: number; readonly name: string }[];
  readonly dayCount: number;
}) {
  const changePickup = (index: number, patch: Partial<Pickup>) => onChange({ pickups: value.pickups.map((row, i) => i === index ? { ...row, ...patch } : row) });
  return <>
    <details open={value.pickups.length > 0} className="rounded-lg border border-border p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-foreground">수송 요청 (선택) · {value.pickups.length}건</summary>
    <fieldset className={section}>
      <legend className="px-1 text-base font-semibold text-foreground">수송 요청</legend>
      <p className="text-sm text-muted">따로 데리러 가야 할 때 요청을 추가하세요. <span className="whitespace-nowrap">시각과 장소는 미정으로 남길 수 있습니다.</span></p>
      {value.pickups.map((pickup, index) => <div key={index} className="rounded-md border border-border bg-surface-2 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">수송 요청 {index + 1}</p><Button type="button" variant="ghost" size="icon" aria-label={`수송 요청 ${index + 1} 삭제`} title={`수송 요청 ${index + 1} 삭제`} onClick={() => onChange({ pickups: value.pickups.filter((_, i) => i !== index) })}><Trash2 size={16} /></Button></div>
        <label className={label}>수송 방향<select className={input} value={pickup.direction} onChange={(e) => changePickup(index, { direction: e.target.value === "down" ? "down" : "up" })}>{(["up", "down"] as const).map((d) => <option key={d} value={d}>{PICKUP_DIRECTION_LABELS[d]}</option>)}</select></label>
        <DateTimeField label={`픽업 일시 ${index + 1}`} value={pickup.pickup_at ?? ""} onChange={(v) => changePickup(index, { pickup_at: v || null })} />
        <label className={label}>픽업 장소<select className={input} value={pickup.place_id ?? ""} onChange={(e) => changePickup(index, { place_id: e.target.value ? Number(e.target.value) : null })}><option value="">장소 미정</option>{places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className={label}>수송 요청 메모<input className={input} value={pickup.note ?? ""} onChange={(e) => changePickup(index, { note: e.target.value || null })} /></label>
      </div>)}
      <Button type="button" variant="secondary" onClick={() => onChange({ pickups: [...value.pickups, { direction: "up", pickup_at: null, place_id: null, note: null }] })}><Plus size={16} /> 수송 요청 추가</Button>
    </fieldset></details>
    <details open={value.courses.length > 0} className="rounded-lg border border-border p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm text-foreground">수강신청 (선택) · {value.courses.length}일</summary>
    <fieldset className={section}>
      <legend className="px-1 text-base font-semibold text-foreground">수강신청</legend>
      <p className="text-sm text-muted">해당하는 날만 고르세요. <span className="whitespace-nowrap">시간은 미정으로 남길 수 있습니다.</span></p>
      <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: dayCount }, (_, i) => i + 1).map((day) => {
        const course = value.courses.find((c) => c.day_no === day);
        return <div key={day} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
          <label className="flex min-h-11 flex-1 items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(course)} onChange={(e) => onChange({ courses: e.target.checked ? [...value.courses, { day_no: day, at_time: null }] : value.courses.filter((c) => c.day_no !== day) })} />{dayLabel(day)} 수강신청</label>
          <label className={label}>시간<input type="time" aria-label={`${dayLabel(day)} 시간`} className={input} disabled={!course} value={course?.at_time ?? ""} onChange={(e) => onChange({ courses: value.courses.map((c) => c.day_no === day ? { ...c, at_time: e.target.value || null } : c) })} /></label>
        </div>;
      })}</div>
    </fieldset></details>
  </>;
}
