"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type CellContext,
} from "@tanstack/react-table";
import { Plus, Download, Upload, Trash2, Clock, Pencil, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { RegDrawer, type PickupRow } from "@/components/admin/reg-drawer";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import type { LegValue } from "@/components/admin/transport-picker";
import {
  type RegistrationRow,
  insertRegistration,
  updateCells,
} from "@/lib/registrations/mutations";
// 취소·되돌리기는 총단 화면과 **같은 함수**를 쓴다. 화면마다 다른 경로를 두면
// 한쪽만 고쳐지고, 실제로 그렇게 갈라져 있어서 임역원 쪽이 동작하지 않았다.
import {
  excludeRegistration,
  restoreRegistration,
} from "@/lib/admin/registrations";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PAYMENT_LABELS,
  PAYMENT_STATUSES,
  paymentDisplayOverride,
  tripOptions,
  type TripOption,
} from "@/lib/labels";
import type { PaymentStatus, EventTrip } from "@/lib/supabase/types";
import { sortRegistrations, conflictRowIdsOf } from "@/lib/registrations/sort";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Bus = { id: number; name: string };
type Toast = { type: "ok" | "err"; text: string };

/** 빈 행(추가용) draft. 상·하행 편을 각각 고른다(참여 형태는 DB 가 파생). */
type Draft = {
  name: string;
  student_id: string;
  upTripId: number | null;
  downTripId: number | null;
  note: string;
};

/** 텍스트 셀에서 편집 가능한 필드(이름·학번·비고). */
type TextField = "name" | "student_id" | "note";

/** 납부상태 → Badge variant 매핑. */
const PAYMENT_VARIANT: Record<PaymentStatus, "success" | "warning" | "mute"> = {
  paid: "success",
  unpaid: "warning",
  waived: "mute",
};

export function RegistrationGrid({
  campusId,
  campusName,
  initialRows,
  buses,
  trips,
  legs,
  units,
  pickups,
  places,
  courses,
  dayCount,
}: {
  campusId: string;
  campusName: string;
  initialRows: RegistrationRow[];
  buses: Bus[];
  trips: EventTrip[];
  /** "<신청id>:<방향>" → 이동수단. 행이 없으면 우리 버스(기본값). */
  legs: Record<string, { mode: string; status: string; via: string | null }>;
  /** 타지구 차량일 때 고를 지구 목록. */
  units: { id: string; name: string }[];
  /** 신청id → 수송 요청들. */
  pickups: Record<string, PickupRow[]>;
  /** 총단이 등록해 둔 픽업 장소. 고르기만 한다. */
  places: { id: number; name: string }[];
  /** 사람별 수강신청 — 날짜가 아니라 몇째 날이다. */
  courses: Record<string, { dayNo: number; atTime: string | null }[]>;
  /** 이 행사에서 고를 수 있는 날 수 (행사 기간에서 계산). */
  dayCount: number;
}) {
  const emptyDraft: Draft = {
    name: "",
    student_id: "",
    upTripId: null as number | null,
    downTripId: null as number | null,
    note: "",
  };
  const [rows, setRows] = useState<RegistrationRow[]>(initialRows);
  /** 편집 서랍이 열린 사람. id 로만 들고 있어야 저장 후 최신값이 서랍에 비친다. */
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const router = useRouter();

  /** 서랍이 보는 사람. rows 에서 매번 찾으므로 저장 뒤 최신값이 그대로 비친다. */
  const drawerRow: AdminRegRow | null = useMemo(() => {
    const r = rows.find((x) => x.id === drawerId);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      student_id: r.student_id,
      campus_id: r.campus_id,
      attendance_type: r.attendance_type,
      up_trip_id: r.up_trip_id,
      down_trip_id: r.down_trip_id,
      fee: r.fee,
      payment_status: r.payment_status,
      roles: r.roles,
      note: r.note,
      assigned_up_bus_id: r.assigned_up_bus_id,
      assigned_down_bus_id: r.assigned_down_bus_id,
      participation_status: r.participation_status,
      cancel_reason: r.cancel_reason,
      attend_from: r.attend_from,
      attend_to: r.attend_to,
    };
  }, [rows, drawerId]);

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
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [toast, setToast] = useState<Toast | null>(null);
  /** 충돌난 (rowId, field) 셀 잠깐 강조용. key = `${id}:${field}`. */
  const [conflictCells, setConflictCells] = useState<Set<string>>(new Set());
  /**
   * 취소/되돌리기 확인 대화상자. `window.confirm` 을 안 쓰는 이유는
   * `ConfirmDialog` 주석 참고 — 탭이 멈추고, 사유를 따로 받을 수가 없다.
   */
  const [ask, setAsk] = useState<
    { kind: "cancel" | "restore"; row: RegistrationRow } | null
  >(null);

  const busName = (id: number | null): string =>
    id == null ? "—" : (buses.find((b) => b.id === id)?.name ?? "—");

  function replaceRow(row: RegistrationRow) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
  }

  function flashConflict(id: string, fields: string[]) {
    const keys = fields.map((f) => `${id}:${f}`);
    setConflictCells((prev) => new Set([...prev, ...keys]));
    setTimeout(() => {
      setConflictCells((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }, 2500);
  }

  // Realtime: 같은 캠퍼스 다른 임역원의 변경을 grid에 자동 반영.
  // 본인 변경 echo도 id 기준 upsert/제거라 idempotent.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`registrations:${campusId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "registrations",
          filter: `campus_id=eq.${campusId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as RegistrationRow;
            setRows((prev) =>
              prev.some((r) => r.id === row.id) ? prev : [...prev, row]
            );
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as RegistrationRow;
            setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id: string };
            setRows((prev) => prev.filter((r) => r.id !== oldRow.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campusId]);

  /** 충돌 결과 공통 처리: 최신값 교체 + 토스트 + 셀 강조. */
  function handleConflict(
    id: string,
    res: { latest?: RegistrationRow; conflictFields?: string[]; message: string }
  ) {
    if (res.latest) replaceRow(res.latest);
    if (res.conflictFields?.length) flashConflict(id, res.conflictFields);
    setToast({ type: "err", text: res.message });
  }

  // 텍스트 셀 저장 (이름·학번·비고).
  async function saveText(
    row: RegistrationRow,
    field: TextField,
    started: string,
    next: string
  ) {
    if (next === started) return; // 변경 없으면 skip
    const res = await updateCells(
      row.id,
      { [field]: started },
      { [field]: next }
    );
    if (!res.ok) {
      if (res.conflict) handleConflict(row.id, res);
      else setToast({ type: "err", text: res.message });
      return;
    }
    replaceRow(res.row);
  }

  /**
   * 상행·하행 편 변경.
   *
   * 두 개의 독립 select 로 보이지만 **DB write 는 반드시 한 번**이다.
   * 따로 보내면 (a) version 이 두 번 튀어 다른 임역원에게 충돌이 두 번 뜨고,
   * (b) 중간 상태(둘 다 null = 버스 미이용)가 잠깐 저장되면서 요금 트리거가
   * 0원을 찍는다. attendance_type 은 DB 파생이라 보내지 않는다.
   */
  async function saveTrips(
    row: RegistrationRow,
    patch: { up_trip_id?: number | null; down_trip_id?: number | null }
  ) {
    // 이미 낸 사람의 편성을 바꾸면 청구액이 **동결된 채로** 남는다(Phase 2-A 설계).
    // 실측: 왕복 5만원을 낸 사람의 편을 다 비워도 fee 는 50000 그대로고,
    // 장부 차액에도 안 잡혀서 아무도 환불 대상인 걸 모른다.
    // 3-C 로 편을 개별로 끄고 켜기 쉬워졌으니 최소한 이 순간에는 알려준다.
    if (row.payment_status === "paid") {
      const next = { ...row, ...patch };
      const ridesAfter = next.up_trip_id !== null || next.down_trip_id !== null;
      const msg = ridesAfter
        ? `${row.name}님은 이미 납부했습니다. 편을 바꿔도 청구액은 그대로 남습니다.`
        : `${row.name}님은 이미 납부했는데 버스를 아예 안 타게 됩니다.\n청구액은 자동으로 줄지 않으니 환불 여부를 따로 확인하세요.`;
      if (!confirm(`${msg}\n\n계속할까요?`)) return;
    }
    const res = await updateCells(
      row.id,
      { up_trip_id: row.up_trip_id, down_trip_id: row.down_trip_id },
      { up_trip_id: row.up_trip_id, down_trip_id: row.down_trip_id, ...patch }
    );
    if (!res.ok) {
      if (res.conflict) handleConflict(row.id, res);
      else setToast({ type: "err", text: res.message });
      return;
    }
    replaceRow(res.row);
  }

  // 납부 상태 변경.
  async function savePayment(row: RegistrationRow, status: PaymentStatus) {
    const res = await updateCells(
      row.id,
      { payment_status: row.payment_status },
      { payment_status: status }
    );
    if (!res.ok) {
      if (res.conflict) handleConflict(row.id, res);
      else setToast({ type: "err", text: res.message });
      return;
    }
    replaceRow(res.row);
  }

  /**
   * 신청 취소 — **지우지 않는다.**
   *
   * 예전엔 여기서 진짜 삭제(DELETE)를 시도했다. 그런데 DB 가 로그인한 사용자의
   * 삭제를 전부 막는다("삭제하면 납부·배차 기록이 함께 사라집니다"). 그래서
   * 임역원이 휴지통을 눌러도 **아무 일도 안 일어나고 에러만 떴다** — 버튼은
   * 있는데 되지 않는 상태였다.
   *
   * DB 는 원래부터 임역원 취소를 허용하도록 돼 있었다. 배차 가드에 "그러면
   * 임역원이 취소를 아예 못 하게 된다" 는 예외가 명시돼 있다(20260721040000).
   * 화면만 잘못된 함수를 부르고 있었다.
   */
  async function handleCancel(row: RegistrationRow, reason: string) {
    setAsk(null);
    const res = await excludeRegistration(row.id, reason || null);
    if (!res.ok) {
      setToast({ type: "err", text: res.message });
      return;
    }
    // 행을 지우지 않는다 — 취소 표시로 남겨야 되돌릴 수 있고, 무엇이 취소됐는지도 보인다.
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? {
              ...r,
              participation_status: "cancelled" as const,
              cancel_reason: reason || null,
              assigned_up_bus_id: null,
              assigned_down_bus_id: null,
            }
          : r
      )
    );
    setToast({ type: "ok", text: `${row.name} 신청 취소됨 (좌석 반납)` });
  }

  /** 취소 되돌리기. 좌석은 자동 복구하지 않는다 — 다른 분이 이미 앉았을 수 있다. */
  async function handleRestore(row: RegistrationRow) {
    setAsk(null);
    const res = await restoreRegistration(row.id);
    if (!res.ok) {
      setToast({ type: "err", text: res.message });
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id
          ? { ...r, participation_status: "registered" as const, cancel_reason: null }
          : r
      )
    );
    setToast({
      type: "ok",
      text: `${row.name} 취소 되돌림 — 배차는 총단이 다시 지정합니다`,
    });
  }

  // 빈 행 → 신규 순장/순원 추가.
  async function handleAdd() {
    if (!draft.name.trim() || !draft.student_id.trim()) {
      setToast({ type: "err", text: "이름과 학번을 입력하세요" });
      return;
    }
    // attendance_type 은 보내지 않는다 — DB 트리거가 두 편에서 파생한다.
    const res = await insertRegistration({
      campus_id: campusId,
      name: draft.name.trim(),
      student_id: draft.student_id.trim(),
      up_trip_id: draft.upTripId,
      down_trip_id: draft.downTripId,
      note: draft.note.trim() || null,
    });
    if (!res.ok) {
      setToast({ type: "err", text: res.message });
      return;
    }
    setRows((prev) =>
      prev.some((r) => r.id === res.row.id) ? prev : [...prev, res.row]
    );
    setDraft(emptyDraft);
    setToast({ type: "ok", text: `${res.row.name} 순장/순원 추가 완료` });
  }

  const columnHelper = createColumnHelper<RegistrationRow>();

  const isConflict = (id: string, field: string) =>
    conflictCells.has(`${id}:${field}`);

  const columns = useMemo(
    () => [
      columnHelper.accessor("name", {
        header: "이름",
        cell: (ctx) => {
          const cancelled = ctx.row.original.participation_status === "cancelled";
          return (
            <div className="flex flex-col gap-0.5">
              <span className={cancelled ? "line-through text-muted-2" : ""}>
                <TextCell
                  ctx={ctx}
                  field="name"
                  conflict={isConflict(ctx.row.original.id, "name")}
                  muted={
                    cancelled || ctx.row.original.payment_status === "waived"
                  }
                  onSave={saveText}
                />
              </span>
              {/* 취소는 지운 게 아니라 남아 있는 상태다. 사유까지 보여야
                  "왜 빠졌더라" 를 나중에 다시 묻지 않는다. */}
              {cancelled && (
                <span className="flex flex-wrap items-center gap-1">
                  <span className="rounded bg-danger-bg px-1.5 py-0.5 text-[11px] text-danger">
                    취소
                  </span>
                  {ctx.row.original.cancel_reason && (
                    <span className="text-[11px] text-muted-2">
                      {ctx.row.original.cancel_reason}
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("student_id", {
        header: "학번",
        cell: (ctx) => <StudentIdCell value={ctx.getValue()} />,
      }),
      columnHelper.display({
        id: "attendance",
        header: "참석/일정",
        cell: (ctx) => {
          const row = ctx.row.original;
          const conflict =
            isConflict(row.id, "up_trip_id") || isConflict(row.id, "down_trip_id");
          return (
            <div className={cn("flex flex-col gap-1", conflict && "rounded ring-1 ring-danger")}>
              <TripCell
                label="상행"
                value={row.up_trip_id}
                // 현재 값이 비활성 편이어도 목록에 남긴다 — 사라지면 다른 편으로
                // 조용히 덮어써진다(admin reg-form 에서 실제로 났던 사고).
                options={tripOptions(trips, "up", row.up_trip_id)}
                onChange={(v) => saveTrips(row, { up_trip_id: v })}
              />
              <TripCell
                label="하행"
                value={row.down_trip_id}
                options={tripOptions(trips, "down", row.down_trip_id)}
                onChange={(v) => saveTrips(row, { down_trip_id: v })}
              />
            </div>
          );
        },
      }),
      columnHelper.accessor("note", {
        header: "비고",
        cell: (ctx) => (
          <TextCell
            ctx={ctx}
            field="note"
            conflict={isConflict(ctx.row.original.id, "note")}
            onSave={saveText}
          />
        ),
      }),
      columnHelper.accessor("fee", {
        header: "차량비",
        cell: (ctx) => {
          const row = ctx.row.original;
          const waived = row.payment_status === "waived";
          return (
            <span
              className={cn(
                "tabular",
                waived
                  ? "text-muted-2 line-through"
                  : "text-foreground font-medium"
              )}
            >
              ₩{(row.fee ?? 0).toLocaleString()}
            </span>
          );
        },
      }),
      columnHelper.accessor("payment_status", {
        header: "납부",
        cell: (ctx) => {
          const row = ctx.row.original;
          const conflict = isConflict(row.id, "payment_status");
          return (
            <PaymentCell
              status={row.payment_status}
              fee={row.fee}
              note={row.note}
              conflict={conflict}
              onChange={(s) => savePayment(row, s)}
            />
          );
        },
      }),
      columnHelper.accessor("assigned_up_bus_id", {
        header: "상행 배차",
        cell: (ctx) => <BusCell value={ctx.getValue()} label={busName(ctx.getValue())} />,
      }),
      columnHelper.accessor("assigned_down_bus_id", {
        header: "하행 배차",
        cell: (ctx) => <BusCell value={ctx.getValue()} label={busName(ctx.getValue())} />,
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        // 되돌릴 수 없는 삭제를 자주 쓰는 연필 바로 옆에 두지 않는다.
        // 점검에서 실제로 연필을 누르려다 휴지통을 눌렀다.
        cell: (ctx) => (
          <span className="inline-flex items-center gap-3">
          {/* 이동수단·참여기간·수송 요청은 칸이 여러 개 모여야 한 값이 돼서
              표 안에서 고치기 어렵다. 그 셋만 서랍에서 받는다. */}
          <button
            type="button"
            aria-label="이동수단·참여기간·수송 요청"
            title="이동수단 · 참여기간 · 수송 요청"
            onClick={() => setDrawerId((cur) => (cur === ctx.row.original.id ? null : ctx.row.original.id))}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-2 transition hover:bg-surface-2 hover:text-primary-700"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {/* 취소된 사람은 되돌리기, 아니면 취소. 지우는 게 아니라 **취소**다 —
              지우면 납부·배차 기록이 함께 사라지고 되돌릴 수도 없다. */}
          {ctx.row.original.participation_status === "cancelled" ? (
            <button
              type="button"
              aria-label="취소 되돌리기"
              title="취소 되돌리기"
              onClick={() => setAsk({ kind: "restore", row: ctx.row.original })}
              className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-2 transition hover:bg-surface-2 hover:text-primary-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="신청 취소"
              title="신청 취소 (좌석 반납 · 되돌릴 수 있음)"
              onClick={() => setAsk({ kind: "cancel", row: ctx.row.original })}
              className="opacity-0 group-hover:opacity-100 ml-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-2 transition hover:bg-danger-bg hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          </span>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buses, conflictCells]
  );

  // 명단 정렬: 충돌 → 미납 → 면제 → 완납, 그룹 내 입력순 (입력 순서 무관).
  const sortedRows = useMemo(
    () => sortRegistrations(rows, conflictRowIdsOf(conflictCells)),
    [rows, conflictCells]
  );

  // TanStack Table API는 React Compiler가 메모이즈하지 않음(정상). 경고 억제.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: sortedRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // 통계·합계 — rows client state에서 실시간 계산 (면제 제외).
  const stats = useMemo(() => {
    let paidCount = 0;
    let unpaidCount = 0;
    let waivedCount = 0;
    let expected = 0; // 예상 수입 (면제 제외 전체 차량비)
    let received = 0; // 수령 (완납 합)
    let outstanding = 0; // 잔액 (미납 합)
    let selfCount = 0; // 버스 미이용 (KTX·자차 등)
    let selfMissingNote = 0; // 미이용인데 비고 비어있는 행
    for (const r of rows) {
      if (r.attendance_type === "self") {
        selfCount += 1;
        if (!r.note?.trim()) selfMissingNote += 1;
      }
      const fee = r.fee ?? 0;
      if (r.payment_status === "waived") {
        waivedCount += 1;
        continue;
      }
      expected += fee;
      if (r.payment_status === "paid") {
        paidCount += 1;
        received += fee;
      } else {
        unpaidCount += 1;
        outstanding += fee;
      }
    }
    return {
      total: rows.length,
      paidCount,
      unpaidCount,
      waivedCount,
      selfCount,
      selfMissingNote,
      expected,
      received,
      outstanding,
    };
  }, [rows]);

  // 열 너비 (시안 §2): 학번 w-20, 참석/일정 w-48(슬롯 라벨 길어짐), 차량비 w-24.
  const colClass: Record<string, string> = {
    name: "w-32",
    student_id: "w-20",
    attendance: "w-48",
    note: "w-40",
    fee: "w-24 text-right",
    payment_status: "w-28",
    assigned_up_bus_id: "w-24",
    assigned_down_bus_id: "w-24",
    actions: "w-12",
  };

  return (
    <div className="space-y-4">
      {/* Page header — breadcrumb · 캠퍼스명 · 통계 · 액션 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1.5">
          <nav className="flex items-center gap-1.5 text-xs text-muted-2">
            <span>홈</span>
            <span>›</span>
            <span className="text-muted">순장/순원 관리</span>
          </nav>
          <h2 className="text-2xl font-semibold text-foreground">
            {campusName} 캠퍼스
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>
              총 <span className="tabular font-medium text-foreground">{stats.total}</span>명
            </span>
            <span className="text-border-2">·</span>
            <StatDot color="bg-success" label="완납" value={stats.paidCount} />
            <StatDot color="bg-warning" label="미납" value={stats.unpaidCount} />
            <StatDot color="bg-muted" label="면제" value={stats.waivedCount} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" type="button">
            <Download className="h-3.5 w-3.5" />
            내보내기
          </Button>
          <a
            href="/campus/import"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          >
            <Upload className="h-3.5 w-3.5" />
            CSV 등록
          </a>
          <Button
            size="sm"
            type="button"
            onClick={() => {
              const el = document.getElementById("grid-add-name");
              el?.focus();
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            순장/순원 추가
          </Button>
        </div>
      </div>

      {toast && (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            toast.type === "err"
              ? "border-danger-border bg-danger-bg text-danger"
              : "border-success-border bg-success-bg text-success"
          )}
        >
          {toast.text}
        </div>
      )}

      {/* 취소·되돌리기 확인. 총단 화면과 **같은 문구**를 쓴다 — 같은 일인데 화면마다
          다르게 설명하면 무엇이 일어나는지가 자리마다 달라 보인다. */}
      <ConfirmDialog
        open={ask?.kind === "cancel"}
        title={`${ask?.row.name ?? ""} 님의 신청을 취소할까요?`}
        description={
          <>
            좌석과 출석이 <b>반납되고 명단에서 빠집니다.</b> 기록은 남으므로 나중에
            되돌릴 수 있습니다.
          </>
        }
        confirmLabel="신청 취소"
        tone="danger"
        reasonLabel="취소 사유 (선택)"
        reasonPlaceholder="예: 개인 사정으로 불참"
        onConfirm={(reason) => ask && handleCancel(ask.row, reason)}
        onCancel={() => setAsk(null)}
      />
      <ConfirmDialog
        open={ask?.kind === "restore"}
        title={`${ask?.row.name ?? ""} 님의 취소를 되돌릴까요?`}
        description={
          <>
            <b>좌석은 자동으로 복구되지 않습니다</b> — 다른 분이 이미 앉았을 수
            있어서입니다. 배차는 총단이 다시 지정합니다.
          </>
        }
        confirmLabel="되돌리기"
        onConfirm={() => ask && handleRestore(ask.row)}
        onCancel={() => setAsk(null)}
      />

      {/* 안내: 미이용 사용법 + 비고 비어있는 미이용 행 알림 (조건부) */}
      <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-2 space-y-1">
        <p>
          💡 <span className="font-medium text-muted">「참석 (버스 미이용)」 안내</span> — KTX·자차 등 버스를 <b>전혀</b> 이용하지 않는 분만 선택해주세요. 한쪽만 이용하시면 「편도 상행」 또는 「편도 하행」으로 골라주세요.
        </p>
        {stats.selfMissingNote > 0 && (
          <p className="text-warning">
            ⚠ 미이용 {stats.selfCount}명 중 비고가 비어있는 행 {stats.selfMissingNote}건 — 비고에 이동 수단(KTX·자차 등)을 적어주세요.
          </p>
        )}
      </div>

      {/* Grid container — Card 비주얼 */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
        <div className="flex flex-col lg:flex-row">
        <div className="max-h-[560px] overflow-auto flex-1 min-w-0">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="text-left">
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className={cn(
                        "whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted",
                        colClass[h.column.id]
                      )}
                    >
                      {h.isPlaceholder
                        ? null
                        : flexRender(
                            h.column.columnDef.header,
                            h.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((r) => (
                <tr
                  key={r.id}
                  className="group border-b border-border transition hover:bg-surface-2/60"
                >
                  {r.getVisibleCells().map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        "px-3 py-2.5 align-middle",
                        colClass[c.column.id]
                      )}
                    >
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              ))}

              {/* 항상 맨 아래 빈 입력 행 — "+ 순장/순원 추가하기" */}
              <tr className="cursor-pointer bg-surface-2/30 transition hover:bg-surface-2">
                <td className="px-3 py-2.5">
                  <input
                    id="grid-add-name"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, name: e.target.value }))
                    }
                    placeholder="홍길동"
                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted-2 focus:outline-none focus:border-primary-800"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <input
                    value={draft.student_id}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, student_id: e.target.value }))
                    }
                    placeholder="26 / 외국인 / 타지구"
                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted-2 focus:outline-none focus:border-primary-800"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-1">
                    <TripCell
                      label="상행"
                      value={draft.upTripId}
                      options={tripOptions(trips, "up")}
                      onChange={(v) => setDraft((d) => ({ ...d, upTripId: v }))}
                    />
                    <TripCell
                      label="하행"
                      value={draft.downTripId}
                      options={tripOptions(trips, "down")}
                      onChange={(v) => setDraft((d) => ({ ...d, downTripId: v }))}
                    />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <input
                    value={draft.note}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, note: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAdd();
                    }}
                    placeholder="(선택)"
                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground placeholder:text-muted-2 focus:outline-none focus:border-primary-800"
                  />
                </td>
                <td className="px-3 py-2.5 text-right text-border-2">—</td>
                <td className="px-3 py-2.5 text-border-2">—</td>
                <td className="px-3 py-2.5 text-border-2">—</td>
                <td className="px-3 py-2.5 text-border-2">—</td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => void handleAdd()}
                    aria-label="순장/순원 추가하기"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary-800 text-white transition hover:bg-primary-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {drawerRow && (
          <RegDrawer
            key={drawerRow.id}
            row={drawerRow}
            campuses={[{ id: campusId, name: campusName, display_order: 0 }]}
            trips={trips}
            units={units}
            upLeg={legOf(drawerRow.id, "up")}
            downLeg={legOf(drawerRow.id, "down")}
            pickups={pickups[drawerRow.id] ?? []}
            courses={courses[drawerRow.id] ?? []}
            dayCount={dayCount}
            places={places}
            variant="campus"
            onSaved={() => router.refresh()}
            onClose={() => setDrawerId(null)}
          />
        )}
        </div>

        {/* footer 요약 */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-surface-2/60 px-4 py-2.5 text-xs text-muted">
          <span>
            예상 수입{" "}
            <span className="tabular font-medium text-foreground">
              ₩{stats.expected.toLocaleString()}
            </span>
          </span>
          <span>
            수령{" "}
            <span className="tabular font-medium text-success">
              ₩{stats.received.toLocaleString()}
            </span>
          </span>
          <span>
            잔액{" "}
            <span className="tabular font-medium text-warning">
              ₩{stats.outstanding.toLocaleString()}
            </span>
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-muted-2">
            <Clock className="h-3 w-3" />
            변경 즉시 저장
          </span>
        </div>
      </div>
    </div>
  );
}

/** 통계 dot + 라벨 + tabular 숫자. */
function StatDot({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full", color)} />
      {label}
      <span className="tabular font-medium text-foreground">{value}</span>
    </span>
  );
}

/** 학번 셀: 숫자 평문 · 외국인/타지구 mute badge. */
function StudentIdCell({ value }: { value: string }) {
  if (value === "외국인" || value === "타지구") {
    return (
      <Badge variant="mute" dot={false}>
        {value}
      </Badge>
    );
  }
  return <span className="tabular text-foreground">{value}</span>;
}

/** 배차 셀: 값 있으면 평문, 없으면(—) 흐리게. */
function BusCell({ value, label }: { value: number | null; label: string }) {
  if (value == null) {
    return <span className="text-border-2">—</span>;
  }
  return <span className="text-[13px] text-foreground">{label}</span>;
}

/** 납부 셀: Badge 비주얼 + 투명 select 오버레이(기존 select 동작 유지). */
function PaymentCell({
  status,
  fee,
  note,
  conflict,
  onChange,
}: {
  status: PaymentStatus;
  fee: number | null;
  note: string | null;
  conflict: boolean;
  onChange: (s: PaymentStatus) => void;
}) {
  // 차량비 0원(버스 미이용)이면 완납/미납 대신 '해당없음' — 단 환불 대기는 드러낸다.
  const override = paymentDisplayOverride(fee, note);
  return (
    <span className="relative inline-flex">
      <Badge
        variant={override ? override.variant : PAYMENT_VARIANT[status]}
        className={cn(conflict && "ring-2 ring-danger")}
      >
        {override ? override.label : PAYMENT_LABELS[status]}
      </Badge>
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as PaymentStatus)}
        aria-label="납부 상태"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {PAYMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PAYMENT_LABELS[s]}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * 텍스트 셀 인라인 편집. 클릭 시 input, blur·Enter 저장, Esc 취소.
 * 값 미변경 시 onSave 내부에서 skip.
 */
function TextCell({
  ctx,
  field,
  conflict,
  muted = false,
  onSave,
}: {
  ctx: CellContext<RegistrationRow, string | null>;
  field: TextField;
  conflict: boolean;
  muted?: boolean;
  onSave: (
    row: RegistrationRow,
    field: TextField,
    started: string,
    next: string
  ) => void | Promise<void>;
}) {
  const row = ctx.row.original;
  const value = (ctx.getValue() ?? "") as string;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(value);
          setEditing(true);
        }}
        className={cn(
          "-mx-1 block min-h-[1.5rem] w-full rounded px-1 text-left transition hover:bg-surface-2",
          conflict && "bg-danger-bg ring-1 ring-danger",
          field === "note" && "max-w-[12rem] truncate text-muted",
          muted && field === "name" && "text-muted"
        )}
      >
        {value || <span className="text-border-2">—</span>}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    void onSave(row, field, value, text.trim());
  };

  return (
    <input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setText(value);
          setEditing(false);
        }
      }}
      className="w-full rounded-md border-2 border-primary-800 bg-surface px-2 py-1 text-sm text-foreground focus:outline-none"
    />
  );
}

/** 방향 하나의 편 선택 셀. 상·하행이 같은 모양이라 한 컴포넌트로 쓴다. */
function TripCell({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number | null;
  options: TripOption[];
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[11px] text-muted-2">
      <span className="w-6 shrink-0">{label}</span>
      <select
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus:border-primary-800"
      >
        {options.map((o) => (
          <option key={o.id ?? "none"} value={o.id === null ? "" : String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
