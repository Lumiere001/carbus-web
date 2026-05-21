"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type CellContext,
} from "@tanstack/react-table";
import { Plus, Download, Upload, Trash2, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  type RegistrationRow,
  insertRegistration,
  updateCells,
  deleteRegistration,
} from "@/lib/registrations/mutations";
import {
  presetKeyOf,
  presetByKey,
  PAYMENT_LABELS,
  PAYMENT_STATUSES,
  type AttendancePreset,
} from "@/lib/labels";
import type { PaymentStatus } from "@/lib/supabase/types";
import { sortRegistrations, conflictRowIdsOf } from "@/lib/registrations/sort";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Bus = { id: number; name: string };
type Toast = { type: "ok" | "err"; text: string };

/** 빈 행(추가용) draft. 참석/일정 기본값은 첫 active 슬롯의 왕복 preset. */
type Draft = {
  name: string;
  student_id: string;
  presetKey: string;
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
  presets,
}: {
  campusId: string;
  campusName: string;
  initialRows: RegistrationRow[];
  buses: Bus[];
  presets: AttendancePreset[];
}) {
  const emptyDraft: Draft = {
    name: "",
    student_id: "",
    presetKey: presets[0]?.key ?? "",
    note: "",
  };
  const [rows, setRows] = useState<RegistrationRow[]>(initialRows);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [toast, setToast] = useState<Toast | null>(null);
  /** 충돌난 (rowId, field) 셀 잠깐 강조용. key = `${id}:${field}`. */
  const [conflictCells, setConflictCells] = useState<Set<string>>(new Set());

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

  // 참석/일정 preset 변경 (3필드 동시).
  async function savePreset(row: RegistrationRow, key: string) {
    const preset = presetByKey(key, presets);
    if (!preset) return;
    const res = await updateCells(
      row.id,
      {
        attendance_type: row.attendance_type,
        departure_slot_id: row.departure_slot_id,
        uses_return_bus: row.uses_return_bus,
      },
      {
        attendance_type: preset.attendance_type,
        departure_slot_id: preset.departure_slot_id,
        uses_return_bus: preset.uses_return_bus,
      }
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

  async function handleDelete(row: RegistrationRow) {
    if (!confirm(`${row.name} 순장/순원 신청을 취소(삭제)할까요?`)) return;
    const res = await deleteRegistration(row.id);
    if (!res.ok) {
      setToast({ type: "err", text: res.message });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    setToast({ type: "ok", text: `${row.name} 순장/순원 삭제 완료` });
  }

  // 빈 행 → 신규 순장/순원 추가.
  async function handleAdd() {
    if (!draft.name.trim() || !draft.student_id.trim()) {
      setToast({ type: "err", text: "이름과 학번을 입력하세요" });
      return;
    }
    const preset = presetByKey(draft.presetKey, presets);
    if (!preset) {
      setToast({ type: "err", text: "참석/일정을 선택하세요" });
      return;
    }
    const res = await insertRegistration({
      campus_id: campusId,
      name: draft.name.trim(),
      student_id: draft.student_id.trim(),
      attendance_type: preset.attendance_type,
      departure_slot_id: preset.departure_slot_id,
      uses_return_bus: preset.uses_return_bus,
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
        cell: (ctx) => (
          <TextCell
            ctx={ctx}
            field="name"
            conflict={isConflict(ctx.row.original.id, "name")}
            muted={ctx.row.original.payment_status === "waived"}
            onSave={saveText}
          />
        ),
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
            isConflict(row.id, "attendance_type") ||
            isConflict(row.id, "departure_slot_id") ||
            isConflict(row.id, "uses_return_bus");
          return (
            <select
              value={presetKeyOf(row, presets) ?? ""}
              onChange={(e) => savePreset(row, e.target.value)}
              className={cn(
                "w-full rounded-md border bg-surface px-2 py-1 text-[13px] text-foreground transition focus:outline-none focus:border-primary-800",
                conflict ? "border-danger ring-1 ring-danger" : "border-border"
              )}
            >
              {presetKeyOf(row, presets) == null && <option value="">(직접조합)</option>}
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
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
        cell: (ctx) => (
          <button
            type="button"
            aria-label="삭제"
            onClick={() => handleDelete(ctx.row.original)}
            className="opacity-0 group-hover:opacity-100 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-2 transition hover:bg-danger-bg hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
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
    for (const r of rows) {
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
      expected,
      received,
      outstanding,
    };
  }, [rows]);

  // 열 너비 (시안 §2): 학번 w-20, 참석/일정 w-36, 차량비 w-24.
  const colClass: Record<string, string> = {
    name: "w-32",
    student_id: "w-20",
    attendance: "w-36",
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

      {/* Grid container — Card 비주얼 */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
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
                  <select
                    value={draft.presetKey}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, presetKey: e.target.value }))
                    }
                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus:border-primary-800"
                  >
                    {presets.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
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
  conflict,
  onChange,
}: {
  status: PaymentStatus;
  conflict: boolean;
  onChange: (s: PaymentStatus) => void;
}) {
  return (
    <span className="relative inline-flex">
      <Badge
        variant={PAYMENT_VARIANT[status]}
        className={cn(conflict && "ring-2 ring-danger")}
      >
        {PAYMENT_LABELS[status]}
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
