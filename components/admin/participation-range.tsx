"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function ParticipationRange({ from, to, disabled, onChange, onDirtyChange }: {
  readonly from: string | null;
  readonly to: string | null;
  readonly disabled: boolean;
  readonly onChange: (from: string | null, to: string | null, expected: { readonly attend_from: string | null; readonly attend_to: string | null }) => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [range, setRange] = useState({ source: { from: from ?? "", to: to ?? "" }, draft: { from: from ?? "", to: to ?? "" } });
  const { draft, source } = range;
  const dirty = draft.from !== source.from || draft.to !== source.to;
  const sourceChanged = source.from !== (from ?? "") || source.to !== (to ?? "");
  if (!disabled && sourceChanged && (!dirty || (draft.from === (from ?? "") && draft.to === (to ?? "")))) {
    const next = { from: from ?? "", to: to ?? "" };
    setRange({ source: next, draft: next });
  }
  const setDraft = (next: typeof draft) => setRange((current) => ({ ...current, draft: next }));
  const [error, setError] = useState("");
  const errorId = useId();
  const endRef = useRef<HTMLInputElement>(null);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  function save() {
    if (draft.from && draft.to && draft.from > draft.to) {
      setError("참여 종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요.");
      endRef.current?.focus();
      return;
    }
    setError("");
    onChange(draft.from || null, draft.to || null, { attend_from: source.from || null, attend_to: source.to || null });
  }
  const inputClass = "w-full min-h-11 rounded-md border border-border-2 bg-surface px-2 text-sm";
  return (
    <fieldset disabled={disabled} className="rounded-lg border border-border p-3 space-y-3">
      <legend className="px-1 text-sm font-semibold text-foreground">부분 참석 · 참여 기간</legend>
      <p className="text-xs leading-relaxed text-muted">참여하는 첫날과 마지막 날을 선택하고 기간 저장을 누르세요. 전체 참석이면 두 날짜를 비워 두세요.</p>
      {sourceChanged && dirty && <div className="space-y-2 text-xs text-warning"><p>다른 곳에서 참여 기간이 바뀌었습니다. 작성한 입력은 남아 있으며, 이전 기간으로 덮어쓰지 않습니다.</p><Button type="button" variant="secondary" size="sm" onClick={() => { const next = { from: from ?? "", to: to ?? "" }; setRange({ source: next, draft: next }); setError(""); }}>입력 버리고 새 값 불러오기</Button></div>}
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0 text-xs text-muted space-y-1">참여 시작일<input type="date" className={inputClass} value={draft.from} onChange={(event) => { setError(""); setDraft({ ...draft, from: event.target.value }); }} /></label>
        <label className="min-w-0 text-xs text-muted space-y-1">참여 종료일<input ref={endRef} type="date" className={inputClass} value={draft.to} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => { setError(""); setDraft({ ...draft, to: event.target.value }); }} /></label>
      </div>
      {error && <p id={errorId} role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex items-center gap-3"><Button variant="secondary" size="sm" disabled={disabled || !dirty} onClick={save}>기간 저장</Button>{dirty && <span className="text-xs text-warning">아직 저장하지 않은 변경</span>}</div>
      <p className="text-xs text-muted">따로 데리러 가야 한다면 픽업 시각·장소를 <span className="whitespace-nowrap"><b>수송 요청</b>에 입력하세요.</span></p>
    </fieldset>
  );
}
