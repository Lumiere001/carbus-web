"use client";

import { useEffect, useMemo, useState } from "react";
import { Bus, ArrowUp, ArrowDown, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { slotLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DepartureSlot } from "@/lib/supabase/types";

type Member = {
  id: string;
  name: string;
  student_id: string;
  checked_in: boolean;
  checked_out: boolean;
  campus?: string; // 관리자(전 캠퍼스) 뷰에서 소속 표시용
};
type BusInfo = { id: number; name: string; departure_slot_id: number };
type Group = [number, Member[]];
type SlotMini = Pick<DepartureSlot, "id" | "label">;
type CheckField = "checked_in" | "checked_out";
type CheckState = Record<string, { checked_in: boolean; checked_out: boolean }>;

/**
 * 호차별 출석 체크 (현장용). 임역원(/campus/buses)·운영자(/admin/attendance) 공용.
 * 상행 명단 탭 → 도착(checked_in), 하행 명단 탭 → 귀가(checked_out). 탭하면 즉시 초록.
 * editable=false 면 읽기 전용(viewer). 낙관적 업데이트 + Realtime 동기화.
 * campusId 있으면 그 캠퍼스만, 없으면(관리자) 전 캠퍼스 변경을 구독.
 */
export function BusAttendance({
  campusId,
  upGroups,
  downGroups,
  buses,
  slots,
  editable = true,
}: {
  campusId?: string;
  upGroups: Group[];
  downGroups: Group[];
  buses: BusInfo[];
  slots: SlotMini[];
  editable?: boolean;
}) {
  const busName = useMemo(
    () => new Map(buses.map((b) => [b.id, b])),
    [buses]
  );

  const [state, setState] = useState<CheckState>(() => {
    const s: CheckState = {};
    for (const [, members] of [...upGroups, ...downGroups]) {
      for (const m of members) {
        s[m.id] = { checked_in: m.checked_in, checked_out: m.checked_out };
      }
    }
    return s;
  });
  const [err, setErr] = useState<string | null>(null);

  // Realtime: 같은 캠퍼스 다른 기기의 체크를 자동 반영 (본인 echo 도 idempotent).
  useEffect(() => {
    const supabase = createClient();
    const sub: {
      event: "UPDATE";
      schema: string;
      table: string;
      filter?: string;
    } = { event: "UPDATE", schema: "public", table: "registrations" };
    if (campusId) sub.filter = `campus_id=eq.${campusId}`;
    const channel = supabase
      .channel(`bus-attendance:${campusId ?? "all"}`)
      .on("postgres_changes", sub, (payload) => {
          const r = payload.new as {
            id: string;
            checked_in: boolean;
            checked_out: boolean;
          };
          setState((s) =>
            s[r.id]
              ? {
                  ...s,
                  [r.id]: { checked_in: r.checked_in, checked_out: r.checked_out },
                }
              : s
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [campusId]);

  async function toggle(id: string, field: CheckField) {
    if (!editable) return;
    const cur = state[id];
    if (!cur) return;
    const next = !cur[field];
    // computed-key 객체는 Supabase Update 타입과 안 맞아 명시 분기.
    const optimistic =
      field === "checked_in"
        ? { checked_in: next, checked_out: cur.checked_out }
        : { checked_in: cur.checked_in, checked_out: next };
    setState((s) => ({ ...s, [id]: optimistic })); // 낙관적
    const supabase = createClient();
    const { error } = await supabase
      .from("registrations")
      .update(
        field === "checked_in" ? { checked_in: next } : { checked_out: next }
      )
      .eq("id", id);
    if (error) {
      setState((s) => ({ ...s, [id]: cur })); // 롤백
      setErr("저장 실패 — 다시 눌러주세요");
      setTimeout(() => setErr(null), 2500);
    }
  }

  function renderSection(
    groups: Group[],
    field: CheckField,
    accent: "up" | "down"
  ) {
    if (groups.length === 0) return null;
    const Icon = accent === "up" ? ArrowUp : ArrowDown;
    const title =
      accent === "up" ? "상행 명단 (올라갈 때)" : "하행 명단 (내려올 때)";
    const checkLabel = accent === "up" ? "도착" : "귀가";
    return (
      <section className="space-y-3">
        <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-muted">
          <Icon size={15} className="text-primary-700" /> {title}
          <span className="text-xs font-normal text-muted-2">
            {editable ? `— 이름을 탭하면 ${checkLabel} 체크` : `— ${checkLabel} 현황`}
          </span>
        </h3>
        {groups.map(([busId, members]) => {
          const info = busName.get(busId);
          const done = members.filter((m) => state[m.id]?.[field]).length;
          return (
            <Card key={busId}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                <span className="flex items-center gap-2 font-semibold text-foreground">
                  <Bus size={18} className="text-primary-700" />
                  {info?.name ?? `${busId}호차`}
                  {accent === "up" && info && (
                    <span className="text-xs font-normal text-muted-2">
                      {slotLabel(info.departure_slot_id, slots)} 출발
                    </span>
                  )}
                  {accent === "down" && (
                    <span className="text-xs font-normal text-muted-2">
                      토요일 하행
                    </span>
                  )}
                </span>
                <Badge
                  variant={done === members.length ? "success" : "primary"}
                  dot={false}
                >
                  {checkLabel} {done}/{members.length}
                </Badge>
              </div>
              <ul className="divide-y divide-border">
                {members.map((m) => {
                  const on = state[m.id]?.[field] ?? false;
                  const inner = (
                    <>
                      <span
                        className={cn(
                          "flex items-center gap-2.5 text-base",
                          on ? "font-medium text-success" : "text-foreground"
                        )}
                      >
                        {on ? (
                          <Check size={18} className="text-success" />
                        ) : (
                          <span className="inline-block h-[18px] w-[18px] rounded-full border-2 border-border-2" />
                        )}
                        {m.name}
                        {m.campus && (
                          <span className="text-xs font-normal text-muted-2">
                            {m.campus}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-2">{m.student_id}</span>
                    </>
                  );
                  return (
                    <li key={m.id}>
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => toggle(m.id, field)}
                          aria-pressed={on}
                          className={cn(
                            "flex w-full items-center justify-between px-5 py-3 text-left transition select-none",
                            on ? "bg-success-bg" : "hover:bg-surface-2/60"
                          )}
                        >
                          {inner}
                        </button>
                      ) : (
                        <div
                          className={cn(
                            "flex w-full items-center justify-between px-5 py-3",
                            on && "bg-success-bg"
                          )}
                        >
                          {inner}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {err && (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {err}
        </div>
      )}
      {renderSection(upGroups, "checked_in", "up")}
      {renderSection(downGroups, "checked_out", "down")}
    </div>
  );
}
