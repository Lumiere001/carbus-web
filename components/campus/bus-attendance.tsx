"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bus, ArrowUp, ArrowDown, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { slotLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AttendanceRate } from "@/components/admin/attendance-rate";
import { attendanceSnapshotSchema, mergeAttendance } from "@/lib/attendance/state";
import type { DepartureSlot } from "@/lib/supabase/types";

type Member = {
  id: string;
  name: string;
  student_id: string;
  checked_in: boolean;
  checked_out: boolean;
  readonly version: number;
  campus?: string; // 관리자(전 캠퍼스) 뷰에서 소속 표시용
};
type BusInfo = { id: number; name: string; up_trip_id: number | null };
type Group = [number, Member[]];
type SlotMini = Pick<DepartureSlot, "id" | "label">;
type CheckField = "checked_in" | "checked_out";

/**
 * 호차별 출석 체크 (현장용). 임역원(/campus/buses)·운영자(/admin/attendance) 공용.
 * 상행은 출발 버스 탑승(checked_in), 하행은 귀가(checked_out).
 * 저장 응답 또는 Realtime으로 확인된 값만 완료 표시한다. editable=false는 읽기 전용.
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

  const membersById = useMemo(() => new Map([...upGroups, ...downGroups].flatMap(([, members]) => members.map((m) => [m.id, m] as const))), [upGroups, downGroups]);
  const [checks, setChecks] = useState(() => ({ source: membersById, values: mergeAttendance({}, [...membersById.values()]) }));
  if (checks.source !== membersById) {
    setChecks({ source: membersById, values: mergeAttendance(checks.values, [...membersById.values()]) });
  }
  const state = checks.values;
  const requests = useRef(new Set<string>());
  const unreadSaved = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  /** 선택한 호차. null = 전체 (지금까지의 동작). */
  const [selBus, setSelBus] = useState<number | null>(null);
  /** 지금 보는 방향. 현장에서는 한 번에 한 방향만 체크한다. */
  const [dir, setDir] = useState<"up" | "down">("up");

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
          const parsed = attendanceSnapshotSchema.safeParse(payload.new);
          if (!parsed.success || !membersById.has(parsed.data.id)) return;
          setChecks((s) => ({ ...s, values: mergeAttendance(s.values, [parsed.data]) }));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [campusId, membersById]);

  const toggle = useCallback(async (id: string, field: CheckField) => {
    const key = `${id}:${field}`;
    if (!editable || requests.current.has(key)) return;
    const cur = state[id] ?? membersById.get(id);
    if (!cur) return;
    setSaving((s) => ({ ...s, [key]: true }));
    setErrors((s) => ({ ...s, [key]: "" }));
    const next = !cur[field];
    requests.current.add(key);
    const failed = () => {
      const member = membersById.get(id);
      setErrors((s) => ({ ...s, [key]: `${member?.name ?? "이 사람"} ${field === "checked_in" ? "상행 출발" : "하행 귀가"} 체크 요청을 완료하지 못했습니다. 현재 체크 상태와 연결을 확인한 뒤 다시 눌러 주세요.` }));
    };
    const unread = () => {
      unreadSaved.current.add(key);
      const member = membersById.get(id);
      setErrors((s) => ({ ...s, [key]: `${member?.name ?? "이 사람"} 체크는 저장되었습니다. 최신 상태를 불러오지 못했습니다. 연결을 확인한 뒤 이름을 다시 눌러 최신 상태를 확인해 주세요.` }));
    };
    try {
      if (!unreadSaved.current.has(key)) {
        const { error } = await createClient().rpc("set_attendance", {
          p_reg_id: id, p_field: field, p_value: next,
        });
        if (error) { failed(); return; }
        unreadSaved.current.add(key);
      }
      // The RPC returns void. Read the actual committed revision rather than inventing base + 1.
      const { data, error } = await createClient().from("registrations")
        .select("id, checked_in, checked_out, version").eq("id", id).single();
      const parsed = attendanceSnapshotSchema.safeParse(data);
      if (error || !parsed.success) { unread(); return; }
      setChecks((s) => ({ ...s, values: mergeAttendance(s.values, [parsed.data]) }));
      unreadSaved.current.delete(key);
    } catch {
      if (unreadSaved.current.has(key)) unread(); else failed();
    } finally {
      requests.current.delete(key);
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }, [editable, membersById, state]);

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
          const done = members.filter((m) => (state[m.id]?.[field] ?? m[field])).length;
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
                  const on = state[m.id]?.[field] ?? m[field];
                  const key = `${m.id}:${field}`;
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
                          disabled={saving[key]}
                          aria-busy={saving[key] || undefined}
                          aria-pressed={on}
                          className={cn(
                            "flex w-full items-center justify-between px-5 py-3 text-left transition select-none",
                            on ? "bg-success-bg" : "hover:bg-surface-2/60"
                          )}
                        >
                          {inner}
                          {saving[key] && <span role="status" className="text-xs text-muted">저장 중…</span>}
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
                      {errors[key] && <p role="alert" className="mx-5 mb-3 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">{errors[key]}</p>}
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
  /**
   * ⚠️ **호차 칩은 방향별로 따로 세어야 한다.**
   *
   * 예전에는 상행·하행 호차를 합집합으로 묶고 진행률도 두 방향을 **더했다.**
   * 같은 5호차라도 상행 멤버와 하행 멤버가 다른데(배차가 독립이다), 화면에는
   * "5호차 56/56" 하나로 보여서 그게 갈 때인지 올 때인지 알 수가 없었다.
   * 현장에서는 한 번에 한 방향만 체크하므로 방향을 먼저 고르게 한다.
   */
  const groupsOf = (d: "up" | "down") => (d === "up" ? upGroups : downGroups);

  const busIds = useMemo(() => {
    const ids = new Set<number>();
    for (const [id] of groupsOf(dir)) ids.add(id);
    return [...ids].sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upGroups, downGroups, dir]);

  const progressOf = (busId: number) => {
    let done = 0;
    let total = 0;
    const field = dir === "up" ? "checked_in" : "checked_out";
    for (const [id, members] of groupsOf(dir))
      if (id === busId) {
        total += members.length;
        done += members.filter((m) => (state[m.id]?.[field] ?? m[field])).length;
      }
    return { done, total };
  };

  const onlySelected = (groups: Group[]) =>
    selBus == null ? groups : groups.filter(([id]) => id === selBus);

  const dirTab = (active: boolean) =>
    cn(
      "min-h-11 px-3 py-1.5 rounded-lg text-sm border transition whitespace-nowrap",
      active
        ? "bg-primary-50 border-border text-primary-800 font-medium"
        : "border-border text-muted hover:bg-surface-2"
    );

  // 요약 카드용 라이브 집계 (state 기반 → 토글/Realtime 즉시 반영)
  const slotArrived = new Map<number, number>();
  for (const [busId, members] of upGroups) {
    const slotId = busName.get(busId)?.up_trip_id;
    if (slotId == null) continue;
    let c = 0;
    for (const m of members) if ((state[m.id]?.checked_in ?? m.checked_in)) c += 1;
    slotArrived.set(slotId, (slotArrived.get(slotId) ?? 0) + c);
  }
  const returnedLive = downGroups.reduce(
    (acc, [, members]) =>
      acc + members.filter((m) => (state[m.id]?.checked_out ?? m.checked_out)).length,
    0
  );

  return (
    <div className="space-y-6">
      {summary && (
        <Card
          title="출석률"
          subtitle={<>출발 버스 탑승 · 하행 귀가 — 분모는 배차된 인원<span className="whitespace-nowrap">(간사 차량·불참 제외)</span></>}
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
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-surface/95 backdrop-blur border-b border-border space-y-2">
        {/* 방향 먼저 — 상·하행은 배차가 독립이라 같은 호차라도 멤버가 다르다. */}
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setDir("up");
              setSelBus(null);
            }}
            aria-pressed={dir === "up"}
            className={dirTab(dir === "up")}
          >
            <ArrowUp size={13} className="inline mr-1" />
            {dir === "up" && <Check size={13} className="inline mr-1" aria-hidden="true" />}상행 (올라갈 때)
          </button>
          <button
            type="button"
            onClick={() => {
              setDir("down");
              setSelBus(null);
            }}
            aria-pressed={dir === "down"}
            className={dirTab(dir === "down")}
          >
            <ArrowDown size={13} className="inline mr-1" />
            {dir === "down" && <Check size={13} className="inline mr-1" aria-hidden="true" />}하행 (내려올 때)
          </button>
        </div>
      {busIds.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelBus(null)}
              aria-pressed={selBus == null}
              className={cn(
                "shrink-0 min-h-11 px-3 py-1.5 rounded-lg text-sm border transition",
                selBus == null
                  ? "bg-primary-50 border-border text-primary-800 font-medium"
                  : "border-border text-muted hover:bg-surface-2"
              )}
            >
              {selBus == null && <Check size={13} className="inline mr-1" aria-hidden="true" />}전체
            </button>
            {busIds.map((id) => {
              const { done, total } = progressOf(id);
              const complete = total > 0 && done === total;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelBus(id)}
                  aria-pressed={selBus === id}
                  className={cn(
                    "shrink-0 min-h-11 px-3 py-1.5 rounded-lg text-sm border transition whitespace-nowrap",
                    selBus === id
                      ? "bg-primary-50 border-border text-primary-800 font-medium"
                      : complete
                        ? "border-border bg-success-bg text-success"
                        : "border-border text-muted hover:bg-surface-2"
                  )}
                >
                  {selBus === id && <Check size={13} className="inline mr-1" aria-hidden="true" />}{busName.get(id)?.name ?? `${id}호차`}{" "}
                  <span className="tabular-nums text-xs">
                    {done}/{total}
                  </span>
                </button>
              );
            })}
          </div>
      )}
      </div>

      {dir === "up" && renderSection(onlySelected(upGroups), "checked_in", "up")}
      {dir === "down" && renderSection(onlySelected(downGroups), "checked_out", "down")}

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
