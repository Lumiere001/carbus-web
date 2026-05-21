"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { slotLabel } from "@/lib/labels";
import type { DepartureSlot } from "@/lib/supabase/types";

export type BusOcc = {
  bus_id: number | null;
  bus_name: string | null;
  departure_slot_id: number | null;
  capacity: number | null;
  up_passengers: number | null;
  down_passengers: number | null;
  up_empty_seats: number | null;
  down_empty_seats: number | null;
};

type View = "both" | "up" | "down";

function Bar({
  value,
  max,
  tone,
}: {
  value: number;
  max: number;
  tone: "primary" | "success" | "warning";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = { primary: "bg-primary-600", success: "bg-success", warning: "bg-warning" }[tone];
  return (
    <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
      <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function BusOccupancy({
  buses,
  slots,
}: {
  buses: BusOcc[];
  slots: Pick<DepartureSlot, "id" | "label">[];
}) {
  const [view, setView] = useState<View>("both");

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
      title="호차별 탑승 현황"
      subtitle="9대 · 상행(올라갈 때)·하행(내려올 때) 좌석 사용"
      action={
        <div className="flex gap-1.5">
          {btn("both", "둘 다")}
          {btn("up", "상행")}
          {btn("down", "하행")}
        </div>
      }
    >
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
        {buses.length === 0 && (
          <p className="text-sm text-muted col-span-full">
            배차 전입니다. 배차 실행 후 호차별 인원이 표시됩니다.
          </p>
        )}
        {buses.map((b) => {
          const cap = b.capacity ?? 44;
          const up = b.up_passengers ?? 0;
          const down = b.down_passengers ?? 0;
          return (
            <div key={b.bus_id} className="space-y-1.5">
              <span className="text-sm font-medium text-foreground">
                {b.bus_name}
                <span className="ml-1.5 text-xs text-muted-2">
                  {b.departure_slot_id != null
                    ? `${slotLabel(b.departure_slot_id, slots)} 출발`
                    : ""}
                </span>
              </span>
              {view !== "down" && (
                <div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-2">상행</span>
                    <span className="tabular-nums text-muted">
                      {up}/{cap} · 빈 {b.up_empty_seats ?? cap - up}
                    </span>
                  </div>
                  <Bar value={up} max={cap} tone={up >= cap ? "warning" : "primary"} />
                </div>
              )}
              {view !== "up" && (
                <div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted-2">하행</span>
                    <span className="tabular-nums text-muted">
                      {down}/{cap} · 빈 {b.down_empty_seats ?? cap - down}
                    </span>
                  </div>
                  <Bar value={down} max={cap} tone={down >= cap ? "warning" : "success"} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
