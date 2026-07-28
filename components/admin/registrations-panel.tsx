"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  PAYMENT_LABELS,
  paymentDisplayOverride,
  attendanceSummary,
} from "@/lib/labels";
import type {
  AttendanceType,
  PaymentStatus, EventTrip } from "@/lib/supabase/types";
import {
  setAssignment,
  excludeRegistration,
  restoreRegistration,
  setRoles,
} from "@/lib/admin/registrations";
import { busSelectOptions } from "@/lib/admin/bus-options";
import { RegForm } from "@/components/admin/reg-form";
import { RegDrawer } from "@/components/admin/reg-drawer";
import { TransportBadges } from "@/components/admin/transport-picker";
import type { LegValue } from "@/components/admin/transport-picker";
import type { TransportMode, TransportStatus } from "@/lib/transport/labels";
import { Button } from "@/components/ui/button";
import { Pencil, Plus } from "lucide-react";
import { setLeaderRole } from "@/lib/admin/leaders";
import { ROLE_DRIVER, ROLE_FIXED, isSpecialRole } from "@/lib/roles/special";

export type AdminRegRow = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
  attendance_type: AttendanceType;
  up_trip_id: number | null;
  down_trip_id: number | null;
  /** GENERATED 컬럼 — 미이용(self)은 0. 납부 배지 '해당없음/환불 대기' 판정에 씀. */
  fee: number | null;
  payment_status: PaymentStatus;
  roles: string[];
  note: string | null;
  assigned_up_bus_id: number | null;
  assigned_down_bus_id: number | null;
  /** 'cancelled' 면 취소된 신청. 행은 남아 있고 좌석만 반납된 상태. */
  participation_status: "registered" | "cancelled";
  cancel_reason: string | null;
};
export type CampusInfo = { id: string; name: string; display_order: number };
export type BusInfo = {
  id: number;
  name: string;
  /** 이 호차가 운행하는 편. 그 방향을 안 뛰면 null. 선택 필드로 만들지 말 것 — bus-options.ts 주석 참고. */
  up_trip_id: number | null;
  down_trip_id: number | null;
  /** 정원(보조석 제외). 잔여석 표기 기준 — 배차 엔진·호차 화면과 동일하게 capacity 를 쓴다. */
  capacity: number;
};
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

/** 납부 정렬 순위: 미납 → 완납 → 면제. */
const STATUS_RANK: Record<PaymentStatus, number> = {
  unpaid: 0,
  paid: 1,
  waived: 2,
};

/**
 * 캠퍼스 그룹 안 정렬 (안정 정렬 — 같은 키 내에서는 입력순 유지).
 * - groupByBus=false(입력 단계): 미납 → 완납 → 면제
 * - groupByBus=true(마감 단계): 상행 배차 호차별(2호차끼리 → 3호차끼리, 미배정 마지막),
 *   같은 호차 안에서는 미납 우선.
 */
function sortRows(arr: AdminRegRow[], groupByBus: boolean): AdminRegRow[] {
  if (!groupByBus) {
    return [...arr].sort(
      (a, b) => STATUS_RANK[a.payment_status] - STATUS_RANK[b.payment_status]
    );
  }
  const busKey = (r: AdminRegRow) => r.assigned_up_bus_id ?? Number.MAX_SAFE_INTEGER;
  return [...arr].sort(
    (a, b) =>
      busKey(a) - busKey(b) ||
      STATUS_RANK[a.payment_status] - STATUS_RANK[b.payment_status]
  );
}

function attendanceLabel(
  r: AdminRegRow,
  trips: Pick<EventTrip, "id" | "label">[]
): string {
  return attendanceSummary(r.up_trip_id, r.down_trip_id, trips);
}

const ALL = "__all__";

type Msg = { type: "ok" | "err"; text: string } | null;

export function RegistrationsPanel({
  rows,
  campuses,
  buses,
  roleLabels,
  isMaster,
  groupByBus,
  driverIds,
  fixedIds,
  trips,
  units,
  legs,
}: {
  rows: AdminRegRow[];
  campuses: CampusInfo[];
  buses: BusInfo[];
  roleLabels: RoleLabel[];
  isMaster: boolean;
  groupByBus: boolean;
  /** 호차에 차량순장으로 묶인 reg id (상/하행) — 역할 파생용. */
  driverIds: Set<string>;
  /** 호차에 고정탑승으로 묶인 reg id (상/하행) — 역할 파생용. */
  fixedIds: Set<string>;
  trips: EventTrip[];
  /** 타지구 차량일 때 고를 지구 목록 (org_units). */
  units: { id: string; name: string }[];
  /** "<신청id>:<방향>" → 이동수단. 행이 없으면 우리 버스(기본값). */
  legs: Record<string, { mode: string; status: string; via: string | null }>;
}) {
  const [tab, setTab] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  // 편집 대상은 **id 로만** 들고 있는다. 행 스냅샷을 들고 있으면 저장 후
  // 새로고침된 값이 서랍에 안 비쳐서, 방금 고친 칸이 옛 값으로 보인다.
  const [form, setForm] = useState<
    { mode: "new" } | { mode: "edit"; id: string } | null
  >(null);

  const busName = useMemo(
    () => new Map(buses.map((b) => [b.id, b.name])),
    [buses]
  );
  /** 호차별 배정 인원 (상·하행 별도) — 잔여석 표기용. rows 는 필터 전 전체 명단. */
  const seatUsed = useMemo(() => {
    const up = new Map<number, number>();
    const down = new Map<number, number>();
    for (const r of rows) {
      if (r.assigned_up_bus_id != null)
        up.set(r.assigned_up_bus_id, (up.get(r.assigned_up_bus_id) ?? 0) + 1);
      if (r.assigned_down_bus_id != null)
        down.set(
          r.assigned_down_bus_id,
          (down.get(r.assigned_down_bus_id) ?? 0) + 1
        );
    }
    return { up, down };
  }, [rows]);
  const countByCampus = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.campus_id, (m.get(r.campus_id) ?? 0) + 1);
    return m;
  }, [rows]);

  const colCount = isMaster ? 8 : 7;

  /** legs 맵에서 한 방향 값을 꺼낸다. 없으면 우리 버스(기본값). */
  const legOf = (regId: string, dir: "up" | "down"): LegValue => {
    const raw = legs[`${regId}:${dir}`];
    if (!raw) return { mode: "our_bus", viaUnitId: null, status: "confirmed" };
    const unit = units.find((u) => u.name === raw.via);
    return {
      mode: raw.mode as LegValue["mode"],
      viaUnitId: unit?.id ?? null,
      status: raw.status as LegValue["status"],
    };
  };
  const badgeOf = (regId: string, dir: "up" | "down") => {
    const raw = legs[`${regId}:${dir}`];
    return {
      mode: (raw?.mode ?? null) as TransportMode | null,
      status: (raw?.status ?? null) as TransportStatus | null,
      via: raw?.via ?? null,
    };
  };

  const renderRow = (r: AdminRegRow) => {
    const editing = isMaster && form?.mode === "edit" && form.id === r.id;
    return (
        <Row
          key={r.id}
          r={r}
          busName={busName}
          buses={buses}
          upUsed={seatUsed.up}
          downUsed={seatUsed.down}
          roleLabels={roleLabels}
          isMaster={isMaster}
          onMsg={setMsg}
          onEdit={(row) =>
            // 같은 사람의 "수정"을 다시 누르면 접는다 (토글).
            setForm((cur) =>
              cur?.mode === "edit" && cur.id === row.id
                ? null
                : { mode: "edit", id: row.id }
            )
          }
          editing={!!editing}
          driverIds={driverIds}
          fixedIds={fixedIds}
          trips={trips}
          upLeg={badgeOf(r.id, "up")}
          downLeg={badgeOf(r.id, "down")}
        />
    );
  };

  // 서랍이 보고 있는 사람. rows 에서 매번 다시 찾으므로 저장 후 새로고침된 값이
  // 그대로 서랍에 반영된다.
  const editRow =
    isMaster && form?.mode === "edit"
      ? rows.find((r) => r.id === form.id) ?? null
      : null;

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
        .map((c) => ({ c, members: sortRows(base.filter((r) => r.campus_id === c.id), groupByBus) }))
        .filter((g) => g.members.length > 0)
    : [];
  const flatRows = grouped ? [] : sortRows(base, groupByBus);
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

      {/* 이름 검색 + (master) 추가 */}
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
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
        {isMaster && (
          <Button size="sm" onClick={() => setForm({ mode: "new" })}>
            <Plus size={14} /> 추가
          </Button>
        )}
      </div>

      {/* 추가 폼만 위에 둔다 — "추가" 버튼이 바로 위라 시선이 이어진다.
          **수정 폼은 그 사람 행 바로 아래에서 열린다.** 예전엔 수정도 여기 떴는데,
          인원이 많아지자 고칠 사람을 찾은 뒤 화면 맨 위까지 다시 올라가야 했다
          (사용자 피드백). 표가 max-h 안에서 스크롤되므로 위로 올라가는 거리가
          곧 명단 길이였다. */}
      {isMaster && form?.mode === "new" && (
        <RegForm
          campuses={campuses}
          trips={trips}
          onClose={() => setForm(null)}
        />
      )}

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
        {/* 표 + 서랍. 서랍이 열려도 표는 제자리에 있고 스크롤도 움직이지 않는다 —
            행 아래에 폼을 펼치던 예전 방식은 열 때마다 아래 행들이 통째로 밀렸다. */}
        <div className="flex flex-col lg:flex-row">
        <div className="max-h-[560px] overflow-auto rounded-xl flex-1 min-w-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
                <th className="px-4 py-2.5">이름</th>
                <th className="px-4 py-2.5">학번</th>
                <th className="px-4 py-2.5">참석/일정</th>
                <th className="px-4 py-2.5">납부</th>
                <th className="px-4 py-2.5">상행 배차</th>
                <th className="px-4 py-2.5">하행 배차</th>
                <th className="px-4 py-2.5">비고</th>
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
                    {members.map(renderRow)}
                  </Fragment>
                ))
              ) : (
                flatRows.map(renderRow)
              )}
            </tbody>
          </table>
        </div>
        {editRow && (
          <RegDrawer
            // 다른 사람으로 갈아타면 서랍을 새로 마운트해 입력 상태를 비운다.
            key={editRow.id}
            row={editRow}
            campuses={campuses}
            trips={trips}
            units={units}
            upLeg={legOf(editRow.id, "up")}
            downLeg={legOf(editRow.id, "down")}
            onClose={() => setForm(null)}
          />
        )}
        </div>
      </Card>
      {isMaster && (
        <p className="text-xs text-muted-2">
          상행·하행 호차를 직접 바꾸거나 신청을 취소할 수 있습니다. 변경은 즉시 저장됩니다.
          취소해도 기록은 남고 좌석만 반납됩니다.
        </p>
      )}
    </div>
  );
}

/** 학우 한 행. master 면 상행·하행 배정 select + 취소 버튼. */
function Row({
  r,
  busName,
  buses,
  upUsed,
  downUsed,
  roleLabels,
  isMaster,
  onMsg,
  onEdit,
  editing,
  driverIds,
  fixedIds,
  trips,
  upLeg,
  downLeg,
}: {
  r: AdminRegRow;
  busName: Map<number, string>;
  buses: BusInfo[];
  /** 호차별 상행 배정 인원 — 잔여석 표기용. */
  upUsed: Map<number, number>;
  /** 호차별 하행 배정 인원 — 잔여석 표기용. */
  downUsed: Map<number, number>;
  roleLabels: RoleLabel[];
  isMaster: boolean;
  onMsg: (m: Msg) => void;
  onEdit: (row: AdminRegRow) => void;
  /** 이 행 아래에 수정 폼이 펼쳐져 있는가. */
  editing: boolean;
  driverIds: Set<string>;
  fixedIds: Set<string>;
  trips: EventTrip[];
  /** 이 사람의 방향별 이동수단 — 우리 버스면 배지를 안 그린다. */
  upLeg: { mode: TransportMode | null; status: TransportStatus | null; via: string | null };
  downLeg: { mode: TransportMode | null; status: TransportStatus | null; via: string | null };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const roleColor = (label: string) =>
    roleHex(roleLabels.find((rl) => rl.label === label)?.color ?? null);

  // 일반 역할(roles[]) + 특수 역할(차량순장/고정 — 호차 바인딩에서 파생)
  const isDriver = driverIds.has(r.id);
  const isFixed = fixedIds.has(r.id);
  const plainRoles = r.roles.filter((x) => !isSpecialRole(x));
  const displayRoles = [
    ...plainRoles,
    ...(isDriver ? [ROLE_DRIVER] : []),
    ...(isFixed ? [ROLE_FIXED] : []),
  ];
  const hasRole = (label: string) =>
    isSpecialRole(label)
      ? label === ROLE_DRIVER
        ? isDriver
        : isFixed
      : plainRoles.includes(label);

  /** 역할 토글 — 특수 역할은 현재 배정 호차에 자동 결박/해제, 일반 역할은 roles[]. */
  function toggleRole(label: string) {
    if (isSpecialRole(label)) {
      const kind = label === ROLE_DRIVER ? "driver" : "fixed";
      const on = !hasRole(label);
      startTransition(async () => {
        const res = await setLeaderRole({
          regId: r.id,
          ridesUp: r.up_trip_id !== null,
          upBusId: r.assigned_up_bus_id,
          ridesDown: r.down_trip_id !== null,
          downBusId: r.assigned_down_bus_id,
          kind,
          on,
        });
        if (!res.ok) return onMsg({ type: "err", text: res.message });
        router.refresh();
      });
      return;
    }
    const has = plainRoles.includes(label);
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
    const reason = prompt(
      `${r.name} 님의 신청을 취소할까요?\n` +
        `좌석과 출석이 반납되고, 명단에서 빠집니다.\n` +
        `기록은 남으므로 나중에 되돌릴 수 있습니다.\n\n` +
        `취소 사유 (선택)`,
      ""
    );
    if (reason === null) return; // 취소 버튼
    startTransition(async () => {
      const res = await excludeRegistration(r.id, reason);
      if (!res.ok) return onMsg({ type: "err", text: res.message });
      onMsg({ type: "ok", text: `${r.name} 신청 취소됨 (좌석 반납)` });
      router.refresh();
    });
  }

  const cancelled = r.participation_status === "cancelled";

  function restore() {
    if (
      !confirm(
        `${r.name} 님의 취소를 되돌릴까요?\n` +
          `좌석은 자동으로 복구되지 않습니다 — 다른 분이 이미 앉았을 수 있어서\n` +
          `배차를 다시 돌리거나 직접 지정해 주세요.`
      )
    )
      return;
    startTransition(async () => {
      const res = await restoreRegistration(r.id);
      if (!res.ok) return onMsg({ type: "err", text: res.message });
      onMsg({ type: "ok", text: `${r.name} 취소 되돌림 — 배차는 다시 지정해 주세요` });
      router.refresh();
    });
  }

  /** 배차 select. 옵션 계산 규칙은 lib/admin/bus-options 참고(순수 함수 + 테스트). */
  const busSelect = (which: "up" | "down", current: number | null) => {
    const options = busSelectOptions(
      buses,
      which,
      which === "up" ? r.up_trip_id : r.down_trip_id,
      current,
      which === "up" ? upUsed : downUsed
    );
    return (
      <select
        value={current ?? ""}
        disabled={pending}
        onChange={(e) => changeBus(which, e.target.value)}
        className="text-xs border border-border-2 rounded-md px-1.5 py-1 bg-surface"
      >
        <option value="">미배정</option>
        {options.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} (잔여 {b.seatsLeft})
          </option>
        ))}
      </select>
    );
  };

  return (
    <tr
      className={
        "border-t border-border " +
        // 취소된 신청은 눈에 띄게 죽여서 표시한다. 지우지 않고 남기는 이유는
        // 납부·배차 기록을 보존하고 되돌릴 수 있게 하기 위해서다.
        (cancelled ? "bg-surface-2/60 text-muted-2" : "")
      }
    >
      <td className="px-4 py-2.5 text-foreground">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5">
            <span className={cancelled ? "line-through text-muted-2" : ""}>
              {r.name}
            </span>
            {cancelled && (
              <Badge variant="danger" dot={false}>
                취소
              </Badge>
            )}
          </span>
          {cancelled && r.cancel_reason && (
            <span className="text-[11px] text-muted-2">{r.cancel_reason}</span>
          )}
          {(displayRoles.length > 0 || isMaster) && (
            <span className="flex flex-wrap items-center gap-1">
              {displayRoles.map((role) => (
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
                    .filter((rl) => !hasRole(rl.label))
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
      <td className="px-4 py-2.5 text-foreground whitespace-nowrap">{attendanceLabel(r, trips)}</td>
      <td className="px-4 py-2.5">
        {(() => {
          // 차량비 0원(버스 미이용)이면 완납/미납 대신 '해당없음' — 환불 대기는 드러낸다.
          const ov = paymentDisplayOverride(r.fee, r.note);
          return (
            <Badge variant={ov ? ov.variant : PAY_VARIANT[r.payment_status]}>
              {ov ? ov.label : PAYMENT_LABELS[r.payment_status]}
            </Badge>
          );
        })()}
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
      <td className="px-4 py-2.5 text-muted-2 max-w-[14rem] whitespace-pre-wrap break-words">
        <span className="flex flex-wrap items-center gap-1.5">
          <TransportBadges up={upLeg} down={downLeg} />
          <span>{r.note?.trim() ? r.note : upLeg.mode || downLeg.mode ? "" : "—"}</span>
        </span>
      </td>
      {isMaster && (
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => onEdit(r)}
              className={
                editing
                  ? "text-primary-700"
                  : "text-muted-2 hover:text-primary-700"
              }
              aria-label={editing ? "수정 닫기" : "수정"}
              aria-expanded={editing}
            >
              <Pencil size={14} />
            </button>
            {cancelled ? (
              <button
                type="button"
                disabled={pending}
                onClick={restore}
                className="text-xs text-primary hover:underline whitespace-nowrap"
              >
                되돌리기
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={exclude}
                className="text-muted-2 hover:text-danger"
                aria-label="신청 취소"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
