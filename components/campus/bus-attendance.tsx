"use client";

import { useEffect, useMemo, useState } from "react";
import { Bus, ArrowUp, ArrowDown, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { slotLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AttendanceRate } from "@/components/admin/attendance-rate";
import type { DepartureSlot } from "@/lib/supabase/types";

type Member = {
  id: string;
  name: string;
  student_id: string;
  checked_in: boolean;
  checked_out: boolean;
  campus?: string; // 관리자(전 캠퍼스) 뷰에서 소속 표시용
};
type BusInfo = { id: number; name: string; up_trip_id: number | null };
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
  summary,
}: {
  campusId?: string;
  upGroups: Group[];
  downGroups: Group[];
  buses: BusInfo[];
  slots: SlotMini[];
  editable?: boolean;
  summary?: {
    slots: { id: number; label: string; total: number }[];
    returnTotal: number;
  };
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
  /** 선택한 호차. null = 전체 (지금까지의 동작). */
  const [selBus, setSelBus] = useState<number | null>(null);

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
    // 출석 쓰기는 set_attendance RPC 경유 — master + 해당 호차 차량순장만 허용(서버 강제).
    const { error } = await supabase.rpc("set_attendance", {
      p_reg_id: id,
      p_field: field,
      p_value: next,
    });
    if (error) {
      setState((s) => ({ ...s, [id]: cur })); // 롤백
      setErr("저장 실패 — 권한이 없거나 네트워크 오류");
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
    const checkLabel = accent === "up" ? "출발 버스" : "귀가";
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
                      {slotLabel(info.up_trip_id, slots)} 출발
                    </span>
                  )}
                  {accent === "down" && (
                    <span className="text-xs font-normal text-muted-2">
                      하행 (내려올 때)
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

  /**
   * 호차 바로가기 — 사용자 피드백: "호차가 많고 인원이 많은 경우 계속 밑으로 스크롤을
   * 내렸어야 하는데 그게 많이 불편했다. 호차별 버튼이 있어서 거기로 바로바로 화면이
   * 바뀌어서 볼 수 있었으면."
   *
   * 기본은 전체(지금까지의 동작)로 두고, 호차를 고르면 그 호차만 보여준다.
   * 칩에 진행률을 같이 띄운다 — 현장에서 필요한 건 "어느 호차가 아직 안 끝났나"이고,
   * 그건 목록을 다 내려봐야만 알 수 있었다.
   */
  const busIds = useMemo(() => {
    const ids = new Set<number>();
    for (const [id] of upGroups) ids.add(id);
    for (const [id] of downGroups) ids.add(id);
    return [...ids].sort((a, b) => a - b);
  }, [upGroups, downGroups]);

  const progressOf = (busId: number) => {
    let done = 0;
    let total = 0;
    for (const [id, members] of upGroups)
      if (id === busId) {
        total += members.length;
        done += members.filter((m) => state[m.id]?.checked_in).length;
      }
    for (const [id, members] of downGroups)
      if (id === busId) {
        total += members.length;
        done += members.filter((m) => state[m.id]?.checked_out).length;
      }
    return { done, total };
  };

  const onlySelected = (groups: Group[]) =>
    selBus == null ? groups : groups.filter(([id]) => id === selBus);

  // 요약 카드용 라이브 집계 (state 기반 → 토글/Realtime 즉시 반영)
  const slotArrived = new Map<number, number>();
  for (const [busId, members] of upGroups) {
    const slotId = busName.get(busId)?.up_trip_id;
    if (slotId == null) continue;
    let c = 0;
    for (const m of members) if (state[m.id]?.checked_in) c += 1;
    slotArrived.set(slotId, (slotArrived.get(slotId) ?? 0) + c);
  }
  const returnedLive = downGroups.reduce(
    (acc, [, members]) =>
      acc + members.filter((m) => state[m.id]?.checked_out).length,
    0
  );

  return (
    <div className="space-y-6">
      {summary && (
        <Card
          title="출석률"
          subtitle="출발 버스 탑승 · 하행 귀가 — 분모는 배차된 인원(간사 차량·불참 제외)"
        >
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {summary.slots.map((s) => (
              <AttendanceRate
                key={s.id}
                label={`${s.label} 출발 버스`}
                done={slotArrived.get(s.id) ?? 0}
                total={s.total}
                tone="success"
              />
            ))}
            <AttendanceRate
              label="하행 귀가"
              done={returnedLive}
              total={summary.returnTotal}
              tone="primary"
            />
          </div>
        </Card>
      )}
      {err && (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
          {err}
        </div>
      )}
      {busIds.length > 1 && (
        <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-surface/95 backdrop-blur border-b border-border">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelBus(null)}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-lg text-sm border transition",
                selBus == null
                  ? "bg-primary-50 border-primary-200 text-primary-800 font-medium"
                  : "border-border text-muted hover:bg-surface-2"
              )}
            >
              전체
            </button>
            {busIds.map((id) => {
              const { done, total } = progressOf(id);
              const complete = total > 0 && done === total;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelBus(id)}
                  className={cn(
                    "shrink-0 px-3 py-1.5 rounded-lg text-sm border transition whitespace-nowrap",
                    selBus === id
                      ? "bg-primary-50 border-primary-200 text-primary-800 font-medium"
                      : complete
                        ? "border-success-border bg-success-bg text-success"
                        : "border-border text-muted hover:bg-surface-2"
                  )}
                >
                  {busName.get(id)?.name ?? `${id}호차`}{" "}
                  <span className="tabular-nums text-xs">
                    {done}/{total}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {renderSection(onlySelected(upGroups), "checked_in", "up")}
      {renderSection(onlySelected(downGroups), "checked_out", "down")}

      {selBus != null &&
        onlySelected(upGroups).length === 0 &&
        onlySelected(downGroups).length === 0 && (
          <p className="text-sm text-muted-2 py-6 text-center">
            이 호차에 배정된 인원이 없습니다.
          </p>
        )}
    </div>
  );
}
