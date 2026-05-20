"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ATTENDANCE_LABELS,
  PAYMENT_LABELS,
  dayLabel,
  presetKeyOf,
  presetByKey,
} from "@/lib/labels";
import type {
  AttendanceType,
  DepartureDay,
  PaymentStatus,
} from "@/lib/supabase/types";
import {
  setAssignment,
  excludeRegistration,
  setRoles,
} from "@/lib/admin/registrations";

export type AdminRegRow = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
  attendance_type: AttendanceType;
  departure_day: DepartureDay | null;
  uses_return_bus: boolean;
  payment_status: PaymentStatus;
  roles: string[];
  assigned_up_bus_id: number | null;
  assigned_down_bus_id: number | null;
};
export type CampusInfo = { id: string; name: string; display_order: number };
export type BusInfo = { id: number; name: string; departure_day?: DepartureDay };
export type RoleLabel = { label: string; color: string | null };

const ROLE_HEX: Record<string, string> = {
  green: "#047857",
  yellow: "#b45309",
  blue: "#1f3a5f",
  red: "#b91c1c",
  purple: "#6d28d9",
  gray: "#57534e",
};
const roleHex = (color: string | null) => ROLE_HEX[color ?? "gray"] ?? "#57534e";

const PAY_VARIANT: Record<PaymentStatus, "success" | "warning" | "mute"> = {
  paid: "success",
  unpaid: "warning",
  waived: "mute",
};

/** 명단 정렬: 미납 → 완납 → 면제. 그룹 내에서는 입력순 유지(안정 정렬). */
const STATUS_RANK: Record<PaymentStatus, number> = {
  unpaid: 0,
  paid: 1,
  waived: 2,
};
const byStatus = (arr: AdminRegRow[]) =>
  [...arr].sort(
    (a, b) => STATUS_RANK[a.payment_status] - STATUS_RANK[b.payment_status]
  );

function attendanceLabel(r: AdminRegRow): string {
  const key = presetKeyOf(r);
  if (key) return presetByKey(key)?.label ?? ATTENDANCE_LABELS[r.attendance_type];
  return `${ATTENDANCE_LABELS[r.attendance_type]} ${dayLabel(r.departure_day)}`;
}

const ALL = "__all__";

type Msg = { type: "ok" | "err"; text: string } | null;

export function RegistrationsPanel({
  rows,
  campuses,
  buses,
  roleLabels,
  isMaster,
}: {
  rows: AdminRegRow[];
  campuses: CampusInfo[];
  buses: BusInfo[];
  roleLabels: RoleLabel[];
  isMaster: boolean;
}) {
  const [tab, setTab] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<Msg>(null);

  const busName = useMemo(
    () => new Map(buses.map((b) => [b.id, b.name])),
    [buses]
  );
  const countByCampus = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.campus_id, (m.get(r.campus_id) ?? 0) + 1);
    return m;
  }, [rows]);

  const colCount = isMaster ? 7 : 6;

  // 검색 중이면 캠퍼스 탭 무시하고 이름·학번으로 전체에서 찾음.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const base = searching
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.student_id.toLowerCase().includes(q)
      )
    : tab === ALL
      ? rows
      : rows.filter((r) => r.campus_id === tab);
  // 검색·전체 탭은 캠퍼스별 그룹, 특정 캠퍼스 탭은 평면 목록
  const grouped = searching || tab === ALL;
  const groups = grouped
    ? campuses
        .map((c) => ({ c, members: byStatus(base.filter((r) => r.campus_id === c.id)) }))
        .filter((g) => g.members.length > 0)
    : [];
  const flatRows = grouped ? [] : byStatus(base);
  const emptyMsg = searching
    ? `‘${query}’ 검색 결과가 없습니다.`
    : tab === ALL
      ? "순장/순원이 없습니다."
      : `${campuses.find((c) => c.id === tab)?.name ?? "해당 캠퍼스"} 인원이 없습니다.`;

  const tabClass = (active: boolean) =>
    "px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition border " +
    (active
      ? "bg-primary-50 border-primary-200 text-primary-800 font-medium"
      : "border-transparent text-muted hover:bg-surface-2");

  return (
    <div className="space-y-4">
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

      {/* 이름 검색 */}
      <div className="relative max-w-xs">
        <Search
          size={15}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름·학번 검색"
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-border-2 rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary-200"
        />
      </div>

      {/* 캠퍼스 탭 (검색 중에는 비활성 표시) */}
      <div className={"flex flex-wrap gap-1.5" + (searching ? " opacity-50 pointer-events-none" : "")}>
        <button className={tabClass(tab === ALL)} onClick={() => setTab(ALL)}>
          전체 <span className="tabular-nums">{rows.length}</span>
        </button>
        {campuses.map((c) => (
          <button
            key={c.id}
            className={tabClass(tab === c.id)}
            onClick={() => setTab(c.id)}
          >
            {c.name}{" "}
            <span className="tabular-nums text-muted-2">
              {countByCampus.get(c.id) ?? 0}
            </span>
          </button>
        ))}
      </div>

      {searching && (
        <p className="text-xs text-muted">
          ‘{query}’ 검색 — {base.length}명
        </p>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2.5">이름</th>
                <th className="px-4 py-2.5">학번</th>
                <th className="px-4 py-2.5">참석/일정</th>
                <th className="px-4 py-2.5">납부</th>
                <th className="px-4 py-2.5">상행 배차</th>
                <th className="px-4 py-2.5">하행 배차</th>
                {isMaster && <th className="px-4 py-2.5">작업</th>}
              </tr>
            </thead>
            <tbody>
              {base.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="text-center text-muted-2 py-8">
                    {emptyMsg}
                  </td>
                </tr>
              ) : grouped ? (
                groups.map(({ c, members }) => (
                  <Fragment key={c.id}>
                    <tr className="bg-surface-2/60 border-t border-border-2">
                      <td
                        colSpan={colCount}
                        className="px-4 py-1.5 text-xs font-medium text-muted"
                      >
                        {c.name}{" "}
                        <span className="text-muted-2 tabular-nums">
                          {members.length}명
                        </span>
                      </td>
                    </tr>
                    {members.map((r) => (
                      <Row
                        key={r.id}
                        r={r}
                        busName={busName}
                        buses={buses}
                        roleLabels={roleLabels}
                        isMaster={isMaster}
                        onMsg={setMsg}
                      />
                    ))}
                  </Fragment>
                ))
              ) : (
                flatRows.map((r) => (
                  <Row
                    key={r.id}
                    r={r}
                    busName={busName}
                    buses={buses}
                    roleLabels={roleLabels}
                    isMaster={isMaster}
                    onMsg={setMsg}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {isMaster && (
        <p className="text-xs text-muted-2">
          상행·하행 호차를 직접 바꾸거나 제외(삭제)할 수 있습니다. 변경은 즉시 저장됩니다.
        </p>
      )}
    </div>
  );
}

/** 학우 한 행. master 면 상행·하행 배정 select + 제외 버튼. */
function Row({
  r,
  busName,
  buses,
  roleLabels,
  isMaster,
  onMsg,
}: {
  r: AdminRegRow;
  busName: Map<number, string>;
  buses: BusInfo[];
  roleLabels: RoleLabel[];
  isMaster: boolean;
  onMsg: (m: Msg) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const roleColor = (label: string) =>
    roleHex(roleLabels.find((rl) => rl.label === label)?.color ?? null);

  function toggleRole(label: string) {
    const has = r.roles.includes(label);
    const next = has ? r.roles.filter((x) => x !== label) : [...r.roles, label];
    startTransition(async () => {
      const res = await setRoles(r.id, next);
      if (!res.ok) return onMsg({ type: "err", text: res.message });
      router.refresh();
    });
  }

  function changeBus(which: "up" | "down", value: string) {
    const busId = value === "" ? null : Number(value);
    startTransition(async () => {
      const res = await setAssignment(r.id, {
        [which === "up" ? "assigned_up_bus_id" : "assigned_down_bus_id"]: busId,
      });
      if (!res.ok) return onMsg({ type: "err", text: res.message });
      router.refresh();
    });
  }

  function exclude() {
    if (!confirm(`${r.name} 님을 전체 명단에서 제외(삭제)할까요?`)) return;
    startTransition(async () => {
      const res = await excludeRegistration(r.id);
      if (!res.ok) return onMsg({ type: "err", text: res.message });
      onMsg({ type: "ok", text: `${r.name} 제외됨` });
      router.refresh();
    });
  }

  const busSelect = (which: "up" | "down", current: number | null) => (
    <select
      value={current ?? ""}
      disabled={pending}
      onChange={(e) => changeBus(which, e.target.value)}
      className="text-xs border border-border-2 rounded-md px-1.5 py-1 bg-surface"
    >
      <option value="">미배정</option>
      {buses.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2.5 text-foreground">
        <div className="flex flex-col gap-1">
          <span>{r.name}</span>
          {(r.roles.length > 0 || isMaster) && (
            <span className="flex flex-wrap items-center gap-1">
              {r.roles.map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white"
                  style={{ background: roleColor(role) }}
                >
                  {role}
                  {isMaster && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggleRole(role)}
                      aria-label="역할 해제"
                      className="hover:opacity-70"
                    >
                      <X size={9} />
                    </button>
                  )}
                </span>
              ))}
              {isMaster && roleLabels.length > 0 && (
                <select
                  value=""
                  disabled={pending}
                  onChange={(e) => e.target.value && toggleRole(e.target.value)}
                  className="text-[11px] border border-border-2 rounded px-1 py-0.5 bg-surface text-muted"
                >
                  <option value="">+ 역할</option>
                  {roleLabels
                    .filter((rl) => !r.roles.includes(rl.label))
                    .map((rl) => (
                      <option key={rl.label} value={rl.label}>
                        {rl.label}
                      </option>
                    ))}
                </select>
              )}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-muted-2">{r.student_id}</td>
      <td className="px-4 py-2.5 text-foreground">{attendanceLabel(r)}</td>
      <td className="px-4 py-2.5">
        <Badge variant={PAY_VARIANT[r.payment_status]}>
          {PAYMENT_LABELS[r.payment_status]}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-muted">
        {isMaster
          ? busSelect("up", r.assigned_up_bus_id)
          : r.assigned_up_bus_id != null
            ? busName.get(r.assigned_up_bus_id) ?? "—"
            : "—"}
      </td>
      <td className="px-4 py-2.5 text-muted">
        {isMaster
          ? busSelect("down", r.assigned_down_bus_id)
          : r.assigned_down_bus_id != null
            ? busName.get(r.assigned_down_bus_id) ?? "—"
            : "—"}
      </td>
      {isMaster && (
        <td className="px-4 py-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={exclude}
            className="text-muted-2 hover:text-danger"
            aria-label="명단에서 제외"
          >
            <Trash2 size={14} />
          </button>
        </td>
      )}
    </tr>
  );
}
