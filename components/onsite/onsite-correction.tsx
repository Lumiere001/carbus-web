"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isCompleteDateTime, toKst, toKstInput } from "@/lib/time/kst";
import type { OnsiteCommand, Visit } from "@/lib/onsite/model";

type TimeDraft = { readonly date: string; readonly time: string };
function draft(value: string | null): TimeDraft {
  const input = toKstInput(value);
  return { date: input.slice(0, 10), time: input.slice(11, 16) };
}
function storedTime(value: TimeDraft, original: string | null): string | null {
  const input = value.date ? `${value.date}T${value.time}` : "";
  return input === toKstInput(original) ? original : toKst(input || null);
}
function DateTimeFields({ label, value, onChange }: {
  readonly label: string; readonly value: TimeDraft; readonly onChange: (next: TimeDraft) => void;
}) {
  return <fieldset className="space-y-2">
    <legend className="font-medium text-sm">{label} · 한국 시간(KST)</legend>
    <div className="grid grid-cols-2 gap-3">
      <label className="space-y-1 text-sm">날짜<input aria-label={`${label} 날짜`} type="date" value={value.date}
        className="block w-full min-w-0 rounded-md border border-border-2 bg-surface p-2 text-base"
        onChange={(event) => onChange({ ...value, date: event.target.value })} /></label>
      <label className="space-y-1 text-sm">시각<input aria-label={`${label} 시각`} type="time" value={value.time}
        className="block w-full min-w-0 rounded-md border border-border-2 bg-surface p-2 text-base"
        onChange={(event) => onChange({ ...value, time: event.target.value })} /></label>
    </div>
    <Button type="button" variant="ghost" onClick={() => onChange({ date: "", time: "" })}>시각을 미확인으로 변경</Button>
  </fieldset>;
}

export function OnsiteCorrection({ visit, name, busy, onSave, onClose }: {
  readonly visit: Visit;
  readonly name: string;
  readonly busy: boolean;
  readonly onSave: (command: OnsiteCommand) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [arrival, setArrival] = useState(() => draft(visit.arrived_at));
  const [departure, setDeparture] = useState(() => draft(visit.departed_at));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const dirty = reason.length > 0 || JSON.stringify(arrival) !== JSON.stringify(draft(visit.arrived_at))
    || JSON.stringify(departure) !== JSON.stringify(draft(visit.departed_at));
  function requestClose() { if (dirty) setDiscard(true); else onClose(); }
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    element.showModal();
    close.current?.focus();
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    for (const value of [arrival, departure]) {
      if ((value.date || value.time) && !isCompleteDateTime(`${value.date}T${value.time}`)) {
        setError("기록할 날짜와 시각을 함께 입력하세요. 미확인은 두 칸 모두 비워 주세요."); return;
      }
    }
    const arrivedAt = storedTime(arrival, visit.arrived_at);
    const departedAt = storedTime(departure, visit.departed_at);
    if (arrivedAt && departedAt && new Date(arrivedAt) > new Date(departedAt)) {
      setError("행사장 떠남은 행사장 도착 이후 시각이어야 합니다."); return;
    }
    if (!reason.trim()) { setError("정정 사유를 입력하세요."); return; }
    setError("");
    if (await onSave({ action: "correct", visit_id: visit.id, visit_version: visit.version,
      arrived_at: arrivedAt, departed_at: departedAt, reason: reason.trim() })) onClose();
    else setError("저장을 확인하지 못했습니다. 대화상자를 닫고 행에 표시된 안내를 확인하세요.");
  }
  return <><dialog ref={dialog} aria-labelledby={titleId}
    className="m-auto w-[calc(100%-2rem)] max-w-md max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-surface p-5 text-foreground shadow-3 backdrop:bg-black/40"
    onCancel={(event) => { event.preventDefault(); if (!busy) requestClose(); }}>
    <form onSubmit={(event) => { void submit(event); }}><fieldset disabled={busy} className="min-w-0 space-y-4">
      <div><h3 id={titleId} className="font-semibold">{name} <span className="inline-block whitespace-nowrap">· {visit.visit_number}번째 방문 정정</span></h3>
        <p className="mt-1 text-sm text-muted">실제 현장 시각을 정정합니다. 미확인으로 바꾼 시각도 이전 기록과 사유가 이력에 남습니다.</p></div>
      <DateTimeFields label="행사장 도착" value={arrival} onChange={setArrival} />
      <DateTimeFields label="행사장 떠남" value={departure} onChange={setDeparture} />
      <label className="block space-y-1 text-sm">정정 사유<textarea value={reason} maxLength={500} required
        className="block w-full rounded-md border border-border-2 bg-surface p-2 text-base"
        onChange={(event) => setReason(event.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={close} type="button" variant="ghost" disabled={busy} onClick={requestClose}>닫기</Button>
        <Button type="submit" disabled={busy}>{busy ? "저장 중…" : "정정 저장"}</Button>
      </div>
    </fieldset></form>
  </dialog><ConfirmDialog open={discard} title="작성 중인 정정을 버릴까요?"
    description="아직 저장하지 않은 날짜·시각과 사유가 사라집니다. 저장된 방문 기록은 유지됩니다."
    confirmLabel="작성 내용 버리기" onCancel={() => setDiscard(false)} onConfirm={onClose} /></>;
}
