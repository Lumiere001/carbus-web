"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createEvent, activateEvent, type EventRow } from "@/lib/admin/events";

/** 행사별 신청·배차 건수 (활성 행사 판단용 표시). */
export type EventCounts = Record<string, { regs: number; batches: number }>;

export function EventsPanel({
  events,
  counts,
}: {
  events: EventRow[];
  counts: EventCounts;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [copyTrips, setCopyTrips] = useState(true);
  const [copyBuses, setCopyBuses] = useState(true);

  const active = events.find((e) => e.is_active) ?? null;
  const past = events.filter((e) => !e.is_active);

  function submit() {
    if (!name.trim()) return setMsg({ type: "err", text: "행사 이름을 입력해 주세요." });
    startTransition(async () => {
      const res = await createEvent({
        name: name.trim(),
        subtitle: subtitle.trim() || null,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        origin: origin.trim() || null,
        destination: destination.trim() || null,
        copyTrips,
        copyBuses,
      });
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setOpen(false);
      setName(""); setSubtitle(""); setStartsOn(""); setEndsOn("");
      setOrigin(""); setDestination("");
      setMsg({ type: "ok", text: `'${name.trim()}' 행사가 시작됐습니다. 지난 행사 자료는 그대로 보관됩니다.` });
      router.refresh();
    });
  }

  function switchTo(e: EventRow) {
    if (!confirm(`'${e.name}'(으)로 전환할까요? 현재 행사 자료는 삭제되지 않습니다.`)) return;
    startTransition(async () => {
      const res = await activateEvent(e.id);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setMsg({ type: "ok", text: `'${e.name}'(으)로 전환됨` });
      router.refresh();
    });
  }

  const period = (e: EventRow) =>
    e.starts_on && e.ends_on ? `${fmt(e.starts_on)} ~ ${fmt(e.ends_on)}` : null;

  return (
    <div className="space-y-4 max-w-2xl">
      {msg && (
        <div
          className={
            "text-sm rounded-lg px-3 py-2 border " +
            (msg.type === "err"
              ? "bg-danger-bg border-danger-border text-danger"
              : "bg-success-bg border-success-border text-success")
          }
        >
          {msg.text}
        </div>
      )}

      <Card title="행사 관리" subtitle="새 행사를 시작하면 화면이 비워지고, 지난 행사 자료는 보관됩니다">
        <div className="p-5 space-y-4">
          {active && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
              <Badge variant="success">진행 중</Badge>
              <span className="font-medium text-foreground">{active.name}</span>
              {active.subtitle && (
                <span className="text-xs text-muted-2">{active.subtitle}</span>
              )}
              <span className="ml-auto text-xs text-muted-2 tabular-nums">
                신청 {counts[active.id]?.regs ?? 0}건
                {period(active) ? ` · ${period(active)}` : ""}
              </span>
            </div>
          )}

          {past.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-2">지난 행사</p>
              {past.map((e) => (
                <div
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="text-muted">{e.name}</span>
                  <span className="text-xs text-muted-2 tabular-nums">
                    신청 {counts[e.id]?.regs ?? 0}건
                    {period(e) ? ` · ${period(e)}` : ""}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => switchTo(e)}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                  >
                    <RotateCcw size={13} />
                    이 행사로 전환
                  </button>
                </div>
              ))}
            </div>
          )}

          {!open ? (
            <Button onClick={() => setOpen(true)} disabled={pending}>
              <CalendarPlus size={15} className="mr-1.5" />새 행사 시작
            </Button>
          ) : (
            <div className="space-y-3 rounded-lg border border-border-2 p-4">
              <Field label="행사 이름">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 2026 리더십 캠프"
                  className={inputCls}
                />
              </Field>
              <Field label="부제 (선택)">
                <input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="예: CCC 71기"
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="시작일">
                  <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={inputCls} />
                </Field>
                <Field label="종료일">
                  <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="출발지">
                  <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="예: 광주" className={inputCls} />
                </Field>
                <Field label="도착지">
                  <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="예: 무주" className={inputCls} />
                </Field>
              </div>

              <div className="space-y-1.5 border-t border-border pt-3">
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={copyTrips} onChange={(e) => setCopyTrips(e.target.checked)} />
                  출발 시간대 이어받기
                </label>
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={copyBuses} onChange={(e) => setCopyBuses(e.target.checked)} />
                  차량(호차) 이어받기 — 차량순장·고정 탑승은 비워집니다
                </label>
              </div>

              <p className="text-xs text-muted-2">
                지난 행사의 신청·배차·정산 자료는 <b>삭제되지 않고 보관</b>됩니다. 언제든 되돌릴 수 있습니다.
              </p>

              <div className="flex gap-2">
                <Button onClick={submit} disabled={pending}>
                  {pending ? "시작하는 중…" : "행사 시작"}
                </Button>
                <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                  취소
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

const inputCls =
  "w-full text-sm border border-border-2 rounded-md px-2.5 py-1.5 bg-surface text-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-2">{label}</span>
      {children}
    </label>
  );
}

function fmt(d: string) {
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}
