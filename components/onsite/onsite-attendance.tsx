"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOnsite } from "./onsite-provider";
import { OnsiteCorrection } from "./onsite-correction";
import { formatKst, toKstInput } from "@/lib/time/kst";
import type { OnsiteCommand, OnsiteState, Visit } from "@/lib/onsite/model";

export function OnsiteAttendance({ registrationId, name, startsOn, endsOn }: {
  readonly registrationId: string; readonly name: string;
  readonly startsOn: string | null; readonly endsOn: string | null;
}) {
  const context = useOnsite();
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{ readonly state: OnsiteState; readonly visit: Visit } | null>(null);
  const state = context?.states.find((item) => item.registration_id === registrationId);
  if (!context || !state) return <span className="text-sm text-muted">현장 기록을 확인할 수 없습니다.</span>;
  const latest = state.visits.at(-1);
  const atSite = Boolean(latest?.arrived_at && !latest.departed_at);
  const departed = Boolean(latest?.departed_at);
  const busy = context.pending.has(registrationId);
  const uncertain = context.uncertain.has(registrationId);
  const latestDate = toKstInput(latest?.departed_at ?? latest?.arrived_at).slice(0, 10);
  const outsidePeriod = latestDate && ((startsOn && latestDate < startsOn) || (endsOn && latestDate > endsOn));
  const locked = busy || uncertain;
  async function save(target: OnsiteState, command: OnsiteCommand) {
    if (!context) return false;
    setMessage("");
    const result = await context.save(target, command);
    if (!result.ok) setMessage(result.message);
    return result.ok;
  }
  return <div className="space-y-2" aria-label={`${name} 현장 기록`}>
    <Badge variant={atSite ? "primary" : "mute"} dot={false}>{atSite ? "행사장에 있음" : departed ? "행사장 떠남 확인" : "미확인"}</Badge>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-live="polite">
      <p>도착 확인 {latest?.arrived_at ? formatKst(latest.arrived_at) : "미확인"}</p>
      <p>떠남 확인 {latest?.departed_at ? formatKst(latest.departed_at) : "미확인"}</p>
      {outsidePeriod && <p className="text-warning">행사 날짜 밖 기록 · 한국 시간</p>}
    </div>
    {context.canEdit && <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" disabled={locked || atSite}
        aria-label={`${name} ${departed ? "행사장 다시 도착" : "행사장 도착"} 체크`}
        onClick={() => { void save(state, { action: "arrive" }); }}>{departed ? "행사장 다시 도착" : "행사장 도착"}</Button>
      <Button type="button" variant="secondary" disabled={locked || departed}
        aria-label={`${name} 행사장 떠남 체크`} onClick={() => { void save(state, { action: "depart" }); }}>행사장 떠남</Button>
    </div>}
    {busy && <p role="status" className="text-sm text-muted">저장 중…</p>}
    {message && <p role="alert" className="max-w-sm whitespace-normal text-sm text-danger">{message}</p>}
    {uncertain && !busy && <Button type="button" variant="outline" onClick={async () => {
      const result = await context.retry(registrationId); setMessage(result.ok ? "" : result.message);
    }}>같은 요청 확인</Button>}
    {state.visits.length > 0 && <details>
      <summary className="min-h-11 cursor-pointer py-3 text-sm text-primary-700">방문 내역 {state.visits.length}건</summary>
      <ol className="space-y-3 whitespace-normal text-xs text-muted">
        {state.visits.map((visit) => <li key={visit.id} className="space-y-1">
          <p className="font-medium">{visit.visit_number}번째 방문{!visit.arrived_at && !visit.departed_at ? " · 기록 해제" : ""}</p>
          <p>도착 확인 {visit.arrived_at ? formatKst(visit.arrived_at) : "미확인"}</p>
          <p>떠남 확인 {visit.departed_at ? formatKst(visit.departed_at) : "미확인"}</p>
          {context.canEdit && <Button type="button" variant="ghost" disabled={locked}
            aria-label={`${name} ${visit.visit_number}번째 방문 시각 정정`}
            onClick={() => setEditing({ state, visit })}>시각 정정 · 해제</Button>}
        </li>)}
      </ol>
    </details>}
    {editing && <OnsiteCorrection key={`${editing.visit.id}:${editing.visit.version}`} name={name} visit={editing.visit}
      busy={busy} onClose={() => setEditing(null)} onSave={(command) => save(editing.state, command)} />}
  </div>;
}
