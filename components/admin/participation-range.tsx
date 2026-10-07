"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TransportPicker } from "./transport-picker";
import { AttendancePlanFields, attendancePlanDraft } from "@/components/registrations/plan/fields";
import { needsAttendancePlan, validateAttendancePlan, type AttendancePlan } from "@/lib/registrations/attendance-plan";
import { saveRegistrationJourney, type RegistrationJourneySnapshot, type RegistrationJourneyLeg } from "@/lib/registrations/journey";
import { DIRECTION_LABELS, legSkipsOurBus } from "@/lib/transport/labels";
import { tripOptions } from "@/lib/labels";
import { toKst } from "@/lib/time/kst";
import type { AdminRegRow } from "./registrations-panel";
import type { EventTrip } from "@/lib/supabase/types";

type Draft = { readonly plan: AttendancePlan; readonly up_trip_id: number | null; readonly down_trip_id: number | null; readonly legs: readonly RegistrationJourneyLeg[] };
function snapshot(row: AdminRegRow, legs: readonly RegistrationJourneyLeg[]): RegistrationJourneySnapshot {
  return { attend_from: row.attend_from, attend_to: row.attend_to, attend_from_at: row.attend_from_at, attend_to_at: row.attend_to_at,
    up_trip_id: row.up_trip_id, down_trip_id: row.down_trip_id, version: row.version ?? 0, legs: [...legs].sort((a,b) => a.direction === b.direction ? 0 : a.direction === "up" ? -1 : 1) };
}
function draftOf(source: RegistrationJourneySnapshot): Draft {
  return { plan: attendancePlanDraft(source), up_trip_id: source.up_trip_id, down_trip_id: source.down_trip_id, legs: source.legs };
}
const keyOf = (value: unknown) => JSON.stringify(value);

/** 일정과 이동을 한 번에 완성하며, 기존의 불완전한 신청도 같은 경로로 고친다. */
export function ParticipationRange({ row, legs, trips, units, disabled, onSaved, onDirtyChange, onBusyChange }: {
  readonly row: AdminRegRow; readonly legs: readonly RegistrationJourneyLeg[]; readonly trips: EventTrip[];
  readonly units: { id: string; name: string }[]; readonly disabled: boolean;
  readonly onSaved: (label: string) => void; readonly onDirtyChange: (dirty: boolean) => void;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const observed = snapshot(row, legs);
  const observedKey = keyOf(observed);
  const [value, setValue] = useState(() => ({ source: observed, seen: observedKey, rowSeen: row, draft: draftOf(observed) }));
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [popup, setPopup] = useState("");
  const [confirmSeats, setConfirmSeats] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const dirty = keyOf(value.draft) !== keyOf(draftOf(value.source));
  if (!pending && ((observedKey !== value.seen) || (refreshRequested && row !== value.rowSeen))) {
    const fresh = draftOf(observed);
    const sameJourney = keyOf({ ...value.source, version: 0 }) === keyOf({ ...observed, version: 0 });
    const canRebase = sameJourney && observed.version >= value.source.version;
    setValue({ source: !dirty || refreshRequested || canRebase || keyOf(fresh) === keyOf(value.draft) ? observed : value.source,
      seen: observedKey, rowSeen: row, draft: !dirty || keyOf(fresh) === keyOf(value.draft) ? fresh : value.draft });
    if (refreshRequested) { setRefreshRequested(false); setUncertain(false); }
  }
  const sourceChanged = keyOf(value.source) !== observedKey && observed.version >= value.source.version;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange(pending); }, [pending, onBusyChange]);
  const locked = disabled || pending || uncertain;
  const change = (draft: Draft) => { setMessage(""); setSaved(false); setValue((current) => ({ ...current, draft: { ...draft, legs: [...draft.legs].sort((a,b) => a.direction === b.direction ? 0 : a.direction === "up" ? -1 : 1) } })); };
  const journey = { ...value.draft.plan, up_trip_id: value.draft.up_trip_id, down_trip_id: value.draft.down_trip_id, legs: value.draft.legs };
  const released = value.draft.legs.filter((leg) => legSkipsOurBus(leg.mode, leg.status) && (leg.direction === "up" ? value.source.up_trip_id : value.source.down_trip_id) !== null);
  function submit(confirmed = false) {
    const plan = { ...value.draft.plan,
      attend_from_at: value.draft.plan.attend_from_at === draftOf(value.source).plan.attend_from_at ? value.source.attend_from_at : value.draft.plan.attend_from_at,
      attend_to_at: value.draft.plan.attend_to_at === draftOf(value.source).plan.attend_to_at ? value.source.attend_to_at : value.draft.plan.attend_to_at,
    };
    const validation = validateAttendancePlan({ ...journey, ...plan, attend_from_at: toKst(plan.attend_from_at), attend_to_at: toKst(plan.attend_to_at) });
    if (!validation.ok) {
      const text = validation.field === "legs" ? validation.message : "부분참은 참여 기간(시간 포함)을 입력해주세요! " + validation.message;
      setMessage(text); setPopup(text); return;
    }
    if (released.length && !confirmed) { setConfirmSeats(true); return; }
    setMessage(""); setSaved(false);
    start(async () => {
      const result = await saveRegistrationJourney(row.id, value.source, plan,
        { up_trip_id: value.draft.up_trip_id, down_trip_id: value.draft.down_trip_id }, value.draft.legs);
      if (!result.ok) {
        setMessage(result.message); setUncertain(Boolean(result.uncertain));
        if (result.conflict) onSaved("최신값");
        return;
      }
      const committed = snapshot(result.row, result.legs);
      setValue({ source: committed, seen: observedKey, rowSeen: row, draft: draftOf(committed) });
      setSaved(true);
      onSaved("참여 예정 일정·이동수단");
    });
  }
  return <fieldset disabled={disabled || pending} className="min-w-0 space-y-3 rounded-lg border border-border p-3">
    <legend className="px-1 text-base font-semibold">참여 예정 일정 · 이동수단</legend>
    {sourceChanged && dirty && <div className="space-y-2 text-sm text-warning"><p>다른 곳에서 일정이나 이동수단이 바뀌었습니다. 작성 중인 입력은 남아 있습니다.</p>
      <Button type="button" variant="secondary" disabled={locked} onClick={() => { setValue({ source: observed, seen: observedKey, rowSeen: row, draft: draftOf(observed) }); setMessage(""); }}>입력 버리고 새 값 불러오기</Button></div>}
    <AttendancePlanFields value={value.draft.plan} required={needsAttendancePlan(journey)} disabled={locked}
      onChange={(plan) => change({ ...value.draft, plan })} />
    <div className="grid gap-3 sm:grid-cols-2">{(["up", "down"] as const).map((direction) => {
      const leg = value.draft.legs.find((item) => item.direction === direction);
      const trip = direction === "up" ? value.draft.up_trip_id : value.draft.down_trip_id;
      return <div key={direction} className="min-w-0 space-y-3">
        <label className="block space-y-1 text-sm text-muted">{direction === "up" ? "상행 (가는 편)" : "하행 (오는 편)"}
          <select disabled={locked || Boolean(leg && legSkipsOurBus(leg.mode, leg.status))} className="min-h-11 w-full rounded-md border border-border-2 bg-surface px-2 text-base text-foreground sm:text-sm"
            value={trip ?? ""} onChange={(event) => {
              const id = event.target.value ? Number(event.target.value) : null;
              change({ ...value.draft, ...(direction === "up" ? { up_trip_id: id } : { down_trip_id: id }),
                legs: id === null ? value.draft.legs : [...value.draft.legs.filter((item) => item.direction !== direction), { direction, mode: "our_bus", status: "confirmed", via_unit_id: null }] });
            }}>{tripOptions(trips, direction, trip).map((option) => <option key={option.id ?? "none"} value={option.id ?? ""}>{option.label}</option>)}</select>
        </label>
        <TransportPicker label={DIRECTION_LABELS[direction]} disabled={locked} units={units}
          value={leg ? { mode: leg.mode, status: leg.status, viaUnitId: leg.via_unit_id } : trip === null ? null : { mode: "our_bus", status: "confirmed", viaUnitId: null }}
          onChange={(next) => change({ ...value.draft,
            ...(legSkipsOurBus(next.mode, next.status) ? (direction === "up" ? { up_trip_id: null } : { down_trip_id: null }) : {}),
            legs: [...value.draft.legs.filter((item) => item.direction !== direction), { direction, mode: next.mode, status: next.status, via_unit_id: next.viaUnitId }],
          })} />
      </div>;
    })}</div>
    {row.payment_status === "paid" && <p className="text-sm text-warning">이미 납부한 신청입니다. 편을 바꿔도 청구액은 자동으로 바뀌지 않습니다. 정산에서 차액을 확인하세요.</p>}
    {message && <p role="alert" className="whitespace-normal text-sm text-danger">{message}</p>}
    {saved && <p role="status" className="text-sm text-success">참여 예정 일정·이동수단 저장됨</p>}
    {uncertain && <Button type="button" variant="secondary" onClick={() => { setRefreshRequested(true); onSaved("최신값"); }}>목록을 새로 확인</Button>}
    <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" disabled={locked || !dirty} onClick={() => submit()}>일정·이동수단 저장</Button>{dirty && <span className="text-sm text-warning">아직 저장하지 않은 변경</span>}</div>
    <p className="text-xs text-muted">수송 요청과 수강신청은 아래에서 선택적으로 입력합니다.</p>
    <ConfirmDialog open={Boolean(popup)} title="참여 정보를 확인해 주세요" description={popup} confirmLabel="확인" onCancel={() => setPopup("")} onConfirm={() => setPopup("")} />
    <ConfirmDialog open={confirmSeats} title="우리 버스 좌석을 반납할까요?" description={`${released.map((leg) => DIRECTION_LABELS[leg.direction]).join(" · ")}의 운행편과 배정 호차를 비웁니다. 다시 타려면 편 지정과 재배차가 필요합니다.`} tone="danger" confirmLabel="좌석 반납하고 변경" onCancel={() => setConfirmSeats(false)} onConfirm={() => { setConfirmSeats(false); submit(true); }} />
  </fieldset>;
}
