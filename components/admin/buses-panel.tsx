"use client";

import { useState } from "react";
import { Bus, Star, Pin, ChevronDown, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DepartureSlot } from "@/lib/supabase/types";
import { setDriver, setFixedPassengers } from "@/lib/admin/buses";
import { sortRoster } from "@/lib/registrations/roster-sort";

export type PaxData = {
  id: string;
  name: string;
  student_id: string;
  campus_name: string;
};

/** 차량순장·고정탑승 사전 지정 후보 (전체 명단). 방향·슬롯으로 필터해 선택. */
export type CandidateData = PaxData & {
  departure_slot_id: number | null;
  uses_return_bus: boolean;
};

export type BusData = {
  id: number;
  name: string;
  /** 이 차량의 상행 편. NULL 이면 상행을 운행하지 않는다. */
  up_trip_id: number | null;
  capacity: number;
  hard_cap: number;
  driver_registration_id: string | null;
  fixed_passenger_ids: string[];
  down_driver_registration_id: string | null;
  down_fixed_passenger_ids: string[];
  passengers: PaxData[]; // 상행 탑승
  downPassengers: PaxData[]; // 하행 탑승 (독립 배차)
};

type Msg = { type: "ok" | "err"; text: string } | null;

export function BusesPanel({
  buses: initial,
  candidates,
  slots,
  isMaster,
}: {
  buses: BusData[];
  candidates: CandidateData[];
  slots: Pick<DepartureSlot, "id" | "label" | "active" | "display_order">[];
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

  // 상행: 슬롯별 그룹(active·display_order 순) / 하행: 전 호차 (호차순)
  const activeSlots = [...slots]
    .filter((s) => s.active)
    .sort((a, b) => a.display_order - b.display_order);

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
        ? activeSlots.map((slot) => {
            const slotBuses = buses.filter((b) => b.up_trip_id === slot.id);
            if (slotBuses.length === 0) return null;
            return (
              <section key={slot.id}>
                <h3 className="text-sm font-medium text-muted mb-3">
                  {slot.label} 출발 · {slotBuses.length}대
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {slotBuses.map((b) => (
                    <BusCard
                      key={b.id}
                      bus={b}
                      mode="up"
                      passengers={b.passengers}
                      candidates={candidates}
                      buses={buses}
                      dayText={`${slot.label} 출발`}
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
              하행 (내려올 때) · {buses.length}대 (상행과 독립 배차)
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
                    candidates={candidates}
                    buses={buses}
                    dayText="하행 (내려올 때)"
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
  candidates,
  buses,
  dayText,
  isMaster,
  onPatch,
  onMsg,
}: {
  bus: BusData;
  mode: "up" | "down";
  passengers: PaxData[];
  candidates: CandidateData[];
  buses: BusData[];
  dayText: string;
  isMaster: boolean;
  onPatch: (f: Partial<BusData>) => void;
  onMsg: (m: Msg) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pax = sortRoster(passengers);
  const cap = bus.capacity;
  const filled = pax.length;
  const over = filled > cap;
  const editable = isMaster; // 상·하행 모두 master 편집 가능

  // 방향별 차량순장·고정탑승 (상행/하행 별개 컬럼)
  const driverId =
    mode === "up" ? bus.driver_registration_id : bus.down_driver_registration_id;
  const fixedIds =
    mode === "up" ? bus.fixed_passenger_ids : bus.down_fixed_passenger_ids;

  // 사전 지정 후보(A): 상행=호차 요일 일치자, 하행=하행 이용자. 이름순.
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));
  const pinPool = candidates
    .filter((c) =>
      mode === "up"
        ? c.departure_slot_id === bus.up_trip_id
        : c.uses_return_bus === true
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // 차량순장·고정 표시는 후보 전체에서 조회(배차 전이라 pax에 없을 수 있음).
  const driver = driverId ? candidateMap.get(driverId) : undefined;
  const fixed = fixedIds
    .map((id) => candidateMap.get(id))
    .filter((p): p is CandidateData => !!p);
  const fixedSet = new Set(fixedIds);

  const dist = new Map<string, number>();
  for (const p of pax) dist.set(p.campus_name, (dist.get(p.campus_name) ?? 0) + 1);
  const distSorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);

  const dirText = mode === "up" ? "상행" : "하행";

  /** G: 같은 방향에서 regId 가 다른 호차에 이미 고정(차량순장/고정)됐으면 그 호차 번호. */
  function pinnedElsewhere(regId: string): number | null {
    for (const b of buses) {
      if (b.id === bus.id) continue;
      const d =
        mode === "up" ? b.driver_registration_id : b.down_driver_registration_id;
      const f =
        mode === "up" ? b.fixed_passenger_ids : b.down_fixed_passenger_ids;
      if (d === regId || f.includes(regId)) return b.id;
    }
    return null;
  }

  async function handleSetDriver(regId: string | null) {
    if (regId) {
      const dup = pinnedElsewhere(regId);
      if (dup != null) {
        const who = candidateMap.get(regId)?.name ?? "해당 인원";
        return onMsg({
          type: "err",
          text: `${who}는 이미 ${dirText} ${dup}호차에 고정되어 있습니다 (먼저 해제하세요)`,
        });
      }
    }
    setBusy(true);
    const res = await setDriver(bus.id, regId, mode);
    setBusy(false);
    if (!res.ok) return onMsg({ type: "err", text: res.message });
    onPatch(
      mode === "up"
        ? { driver_registration_id: regId }
        : { down_driver_registration_id: regId }
    );
    const who = regId ? candidateMap.get(regId)?.name : null;
    onMsg({
      type: "ok",
      text: who
        ? `${bus.name} ${dirText} 차량순장: ${who}`
        : `${bus.name} ${dirText} 차량순장 해제`,
    });
  }

  async function handleToggleFixed(regId: string) {
    const adding = !fixedSet.has(regId);
    if (adding) {
      // G: 다른 호차 중복 고정 방지
      const dup = pinnedElsewhere(regId);
      if (dup != null) {
        const who = candidateMap.get(regId)?.name ?? "해당 인원";
        return onMsg({
          type: "err",
          text: `${who}는 이미 ${dirText} ${dup}호차에 고정되어 있습니다`,
        });
      }
      // E: 고정 인원이 호차 정원(보조석 포함)을 넘지 않게
      const pinnedCount = new Set([
        ...(driverId ? [driverId] : []),
        ...fixedIds,
      ]).size;
      if (pinnedCount >= bus.hard_cap) {
        return onMsg({
          type: "err",
          text: `${bus.name} 고정 인원이 정원(${bus.hard_cap}석)에 도달했습니다`,
        });
      }
    }
    const next = fixedSet.has(regId)
      ? fixedIds.filter((id) => id !== regId)
      : [...fixedIds, regId];
    setBusy(true);
    const res = await setFixedPassengers(bus.id, next, mode);
    setBusy(false);
    if (!res.ok) return onMsg({ type: "err", text: res.message });
    onPatch(
      mode === "up"
        ? { fixed_passenger_ids: next }
        : { down_fixed_passenger_ids: next }
    );
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

        {/* 차량순장 · 고정 탑승자 (상행·하행 각각) */}
        {(
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted flex items-center gap-1.5">
                <Star size={13} className="text-warning" /> {dirText} 차량순장
              </span>
              {editable ? (
                <select
                  value={driverId ?? ""}
                  disabled={busy}
                  onChange={(e) => handleSetDriver(e.target.value || null)}
                  className="text-xs border border-border-2 rounded-md px-2 py-1 bg-surface max-w-[12rem]"
                >
                  <option value="">미지정</option>
                  {pinPool.map((p) => (
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
                  {pinPool
                    .filter((p) => !fixedSet.has(p.id) && p.id !== driverId)
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
                  {p.id === driverId && (
                    <Star size={11} className="inline ml-1 text-warning" />
                  )}
                  {fixedSet.has(p.id) && (
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
