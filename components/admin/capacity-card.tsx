"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";

/** 상행 슬롯별 정원 행 (v_day_capacity). */
export type SlotCapRow = {
  slot_id: number | null;
  slot_key: string | null;
  slot_label: string | null;
  total_capacity: number | null;
  total_passengers: number | null;
  remaining_seats: number | null;
};

type View = "up" | "down";

function Bar({
  value,
  max,
  tone,
}: {
  value: number;
  max: number;
  tone: "primary" | "warning" | "danger";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = {
    primary: "bg-primary-600",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];
  return (
    <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
      <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function CapRow({
  label,
  passengers,
  capacity,
}: {
  label: string;
  passengers: number;
  capacity: number;
}) {
  const remaining = capacity - passengers;
  const tone =
    remaining <= 0 ? "danger" : remaining < capacity * 0.1 ? "warning" : "primary";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm tabular-nums text-muted">
          {passengers} / {capacity}석
          <span
            className={`ml-2 font-medium ${remaining <= 0 ? "text-danger" : "text-muted-2"}`}
          >
            잔여 {remaining}
          </span>
        </span>
      </div>
      <Bar value={passengers} max={capacity} tone={tone} />
    </div>
  );
}

/**
 * 출발 정원 카드 — 상행/하행 토글.
 * 상행: 출발 슬롯별(화 오전/오후 등) 막대. 하행: 슬롯 없는 단일 풀(전 호차)이라 한 줄 막대.
 */
export function CapacityCard({
  upRows,
  downCapacity,
  downPassengers,
}: {
  upRows: SlotCapRow[];
  downCapacity: number;
  downPassengers: number;
}) {
  const [view, setView] = useState<View>("up");

  const btn = (v: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      className={
        "px-2.5 py-1 rounded-md text-xs transition border " +
        (view === v
          ? "bg-primary-50 border-primary-200 text-primary-800 font-medium"
          : "border-border text-muted hover:bg-surface-2")
      }
    >
      {label}
    </button>
  );

  return (
    <Card
      title="출발 정원"
      subtitle={
        view === "up"
          ? "상행 출발 시간대(슬롯)별 좌석 사용"
          : "하행 좌석 사용 (슬롯 없이 전 호차 단일 운행)"
      }
      action={
        <div className="flex gap-1.5">
          {btn("up", "상행")}
          {btn("down", "하행")}
        </div>
      }
    >
      <div className="p-5 space-y-4">
        {view === "up" ? (
          upRows.length === 0 ? (
            <p className="text-sm text-muted">운행 중인 상행 슬롯이 없습니다.</p>
          ) : (
            upRows.map((row) => (
              <CapRow
                key={row.slot_id ?? row.slot_key ?? row.slot_label}
                label={`${row.slot_label} 상행`}
                passengers={row.total_passengers ?? 0}
                capacity={row.total_capacity ?? 0}
              />
            ))
          )
        ) : (
          <CapRow
            label="하행 (전 호차)"
            passengers={downPassengers}
            capacity={downCapacity}
          />
        )}
      </div>
    </Card>
  );
}
