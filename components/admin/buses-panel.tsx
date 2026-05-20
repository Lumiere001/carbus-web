"use client";

import { useState } from "react";
import { Bus, Star, Pin, ChevronDown, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DAY_LABELS } from "@/lib/labels";
import type { DepartureDay } from "@/lib/supabase/types";
import { setDriver, setFixedPassengers } from "@/lib/admin/buses";

export type PaxData = {
  id: string;
  name: string;
  student_id: string;
  campus_name: string;
};

export type BusData = {
  id: number;
  name: string;
  departure_day: DepartureDay;
  capacity: number;
  hard_cap: number;
  driver_registration_id: string | null;
  fixed_passenger_ids: string[];
  passengers: PaxData[]; // 상행 탑승
  downPassengers: PaxData[]; // 하행 탑승 (독립 배차)
};

type Msg = { type: "ok" | "err"; text: string } | null;

export function BusesPanel({
  buses: initial,
  isMaster,
}: {
  buses: BusData[];
  isMaster: boolean;
}) {
  const [buses, setBuses] = useState(initial);
  const [view, setView] = useState<"up" | "down">("up");
  const [msg, setMsg] = useState<Msg>(null);

  function patch(busId: number, fields: Partial<BusData>) {
    setBuses((prev) =>
      prev.map((b) => (b.id === busId ? { ...b, ...fields } : b))
    );
  }

  const tabClass = (active: boolean) =>
    "px-3.5 py-1.5 rounded-lg text-sm transition border " +
    (active
      ? "bg-primary-50 border-primary-200 text-primary-800 font-medium"
      : "border-border text-muted hover:bg-surface-2");

  // 상행: 요일별 그룹 / 하행: 토요일 9대 전체 (호차순)
  const days: DepartureDay[] = ["TUE", "WED"];

  return (
    <div className="space-y-6">
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

      <div className="flex gap-2">
        <button className={tabClass(view === "up")} onClick={() => setView("up")}>
          상행 보기 (올라갈 때)
        </button>
        <button
          className={tabClass(view === "down")}
          onClick={() => setView("down")}
        >
          하행 보기 (내려올 때)
        </button>
      </div>

      {view === "up"
        ? days.map((day) => {
            const dayBuses = buses.filter((b) => b.departure_day === day);
            if (dayBuses.length === 0) return null;
            return (
              <section key={day}>
                <h3 className="text-sm font-medium text-muted mb-3">
                  {DAY_LABELS[day]} 출발 · {dayBuses.length}대
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {dayBuses.map((b) => (
                    <BusCard
                      key={b.id}
                      bus={b}
                      mode="up"
                      passengers={b.passengers}
                      dayText={`${DAY_LABELS[day]} 출발`}
                      isMaster={isMaster}
                      onPatch={(f) => patch(b.id, f)}
                      onMsg={setMsg}
                    />
                  ))}
                </div>
              </section>
            );
          })
        : (
          <section>
            <h3 className="text-sm font-medium text-muted mb-3">
              토요일 하행 · {buses.length}대 (상행과 독립 배차)
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {[...buses]
                .sort((a, b) => a.id - b.id)
                .map((b) => (
                  <BusCard
                    key={b.id}
                    bus={b}
                    mode="down"
                    passengers={b.downPassengers}
                    dayText="토요일 하행"
                    isMaster={isMaster}
                    onPatch={(f) => patch(b.id, f)}
                    onMsg={setMsg}
                  />
                ))}
            </div>
          </section>
        )}
    </div>
  );
}

/**
 * 호차 카드 — 상행·하행 공용. 동일 구조(헤더·좌석 그리드·캠퍼스 분포·명단).
 * 상행(mode="up")에서만 차량순장·고정탑승 지정 블록을 추가로 노출.
 */
function BusCard({
  bus,
  mode,
  passengers,
  dayText,
  isMaster,
  onPatch,
  onMsg,
}: {
  bus: BusData;
  mode: "up" | "down";
  passengers: PaxData[];
  dayText: string;
  isMaster: boolean;
  onPatch: (f: Partial<BusData>) => void;
  onMsg: (m: Msg) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pax = passengers;
  const cap = bus.capacity;
  const filled = pax.length;
  const over = filled > cap;
  const editable = mode === "up" && isMaster;

  const driver = pax.find((p) => p.id === bus.driver_registration_id);
  const fixed = bus.fixed_passenger_ids
    .map((id) => pax.find((p) => p.id === id))
    .filter((p): p is PaxData => !!p);
  const fixedSet = new Set(bus.fixed_passenger_ids);

  const dist = new Map<string, number>();
  for (const p of pax) dist.set(p.campus_name, (dist.get(p.campus_name) ?? 0) + 1);
  const distSorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);

  async function handleSetDriver(regId: string | null) {
    setBusy(true);
    const res = await setDriver(bus.id, regId);
    setBusy(false);
    if (!res.ok) return onMsg({ type: "err", text: res.message });
    onPatch({ driver_registration_id: regId });
    const who = regId ? pax.find((p) => p.id === regId)?.name : null;
    onMsg({
      type: "ok",
      text: who ? `${bus.name} 차량순장: ${who}` : `${bus.name} 차량순장 해제`,
    });
  }

  async function handleToggleFixed(regId: string) {
    const next = fixedSet.has(regId)
      ? bus.fixed_passenger_ids.filter((id) => id !== regId)
      : [...bus.fixed_passenger_ids, regId];
    setBusy(true);
    const res = await setFixedPassengers(bus.id, next);
    setBusy(false);
    if (!res.ok) return onMsg({ type: "err", text: res.message });
    onPatch({ fixed_passenger_ids: next });
  }

  return (
    <Card>
      <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bus size={18} className="text-primary-700" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{bus.name}</h3>
            <p className="text-xs text-muted">{dayText}</p>
          </div>
        </div>
        <Badge variant={over ? "danger" : filled >= cap ? "warning" : "success"}>
          {filled} / {cap}석
        </Badge>
      </div>

      <div className="p-5 space-y-4">
        {/* 좌석 그리드 */}
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: Math.max(cap, filled) }).map((_, i) => (
            <span
              key={i}
              className={
                "w-3.5 h-3.5 rounded-sm " +
                (i < filled
                  ? i >= cap
                    ? "bg-danger"
                    : "bg-primary-500"
                  : "bg-surface-2 ring-1 ring-inset ring-border")
              }
            />
          ))}
        </div>

        {/* 차량순장 · 고정 탑승자 (상행만) */}
        {mode === "up" && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted flex items-center gap-1.5">
                <Star size={13} className="text-warning" /> 차량순장
              </span>
              {editable ? (
                <select
                  value={bus.driver_registration_id ?? ""}
                  disabled={busy}
                  onChange={(e) => handleSetDriver(e.target.value || null)}
                  className="text-xs border border-border-2 rounded-md px-2 py-1 bg-surface max-w-[12rem]"
                >
                  <option value="">미지정</option>
                  {pax.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.campus_name})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-foreground">
                  {driver ? `${driver.name} (${driver.campus_name})` : "미지정"}
                </span>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted mb-1.5">
                <Pin size={13} className="text-primary-600" /> 고정 탑승자 (
                {fixed.length})
              </div>
              {fixed.length === 0 && !editable && (
                <p className="text-xs text-muted-2">없음</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {fixed.map((p) => (
                  <Badge key={p.id} variant="primary" dot={false}>
                    {p.name}
                    {editable && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleToggleFixed(p.id)}
                        className="ml-1 hover:text-danger"
                        aria-label="고정 해제"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </Badge>
                ))}
              </div>
              {editable && (
                <select
                  value=""
                  disabled={busy}
                  onChange={(e) =>
                    e.target.value && handleToggleFixed(e.target.value)
                  }
                  className="mt-2 text-xs border border-border-2 rounded-md px-2 py-1 bg-surface"
                >
                  <option value="">+ 고정 탑승자 추가</option>
                  {pax
                    .filter((p) => !fixedSet.has(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.campus_name})
                      </option>
                    ))}
                </select>
              )}
            </div>
          </>
        )}

        {/* 캠퍼스 분포 */}
        {distSorted.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {distSorted.map(([name, n]) => (
              <span key={name}>
                {name} <span className="text-foreground font-medium">{n}</span>
              </span>
            ))}
          </div>
        )}

        {/* 명단 토글 */}
        <div className="border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((o) => !o)}
            className="text-xs"
          >
            전체 명단 ({pax.length})
            <ChevronDown
              size={14}
              className={"transition " + (open ? "rotate-180" : "")}
            />
          </Button>
          {open && (
            <ol className="mt-2 text-sm text-foreground space-y-0.5 list-decimal list-inside">
              {pax.length === 0 && (
                <li className="list-none text-muted-2">
                  배정된 순장/순원이 없습니다.
                </li>
              )}
              {pax.map((p) => (
                <li key={p.id}>
                  {p.name}
                  <span className="text-xs text-muted-2 ml-1.5">
                    {p.campus_name} · {p.student_id}
                  </span>
                  {mode === "up" && p.id === bus.driver_registration_id && (
                    <Star size={11} className="inline ml-1 text-warning" />
                  )}
                  {mode === "up" && fixedSet.has(p.id) && (
                    <Pin size={11} className="inline ml-1 text-primary-600" />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Card>
  );
}
