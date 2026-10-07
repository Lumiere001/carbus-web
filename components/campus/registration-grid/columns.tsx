"use client";

import { useMemo } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { tripOptions } from "@/lib/labels";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import type { PaymentStatus, EventTrip } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { BusCell, PaymentCell, TextCell, TripCell } from "./cells";
import type { Bus, CancellationRequest, TextEdit } from "./types";

const columnHelper = createColumnHelper<RegistrationRow>();

type ColumnInputs = {
  readonly buses: Bus[];
  readonly trips: EventTrip[];
  readonly conflictCells: Set<string>;
  readonly saveText: (edit: TextEdit) => Promise<void>;
  readonly saveTrips: (row: RegistrationRow, patch: { up_trip_id?: number | null; down_trip_id?: number | null }) => Promise<void>;
  readonly savePayment: (row: RegistrationRow, status: PaymentStatus) => Promise<void>;
  readonly openRegistration: (id: string) => void;
  readonly setAsk: (request: CancellationRequest) => void;
};

export function useRegistrationColumns({ buses, trips, conflictCells, saveText, saveTrips, savePayment, openRegistration, setAsk }: ColumnInputs) {
  const columns = useMemo(
    () => {
      const isConflict = (id: string, field: string) => conflictCells.has(`${id}:${field}`);
      const busName = (id: number | null): string => id == null ? "—" : (buses.find((b) => b.id === id)?.name ?? "—");
      return [
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
                  <span className="rounded bg-danger-bg px-1.5 py-0.5 text-xs text-danger">
                    취소
                  </span>
                  {ctx.row.original.cancel_reason && (
                    <span className="text-xs text-muted-2">
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
        cell: (ctx) => <TextCell ctx={ctx} field="student_id" conflict={isConflict(ctx.row.original.id, "student_id")} onSave={saveText} />,
      }),
      columnHelper.display({
        id: "attendance",
        header: "버스 이용",
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
          <span className="inline-flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
          {/* 이동수단·참여기간·수송 요청은 칸이 여러 개 모여야 한 값이 돼서
              표 안에서 고치기 어렵다. 그 셋만 서랍에서 받는다. */}
          <button
            type="button"
            aria-label={`${ctx.row.original.name} 정보 수정: 이동수단·참여기간·수송 요청`}
            data-registration-editor={ctx.row.original.id}
            onClick={() => openRegistration(ctx.row.original.id)}
            className="inline-flex min-h-11 shrink-0 whitespace-nowrap items-center justify-center gap-1 rounded-md px-2 text-sm text-primary-700 transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary-700"
          >
            <Pencil className="h-3.5 w-3.5" />
            정보 수정
          </button>
          {/* 취소된 사람은 되돌리기, 아니면 취소. 지우는 게 아니라 **취소**다 —
              지우면 납부·배차 기록이 함께 사라지고 되돌릴 수도 없다. */}
          {ctx.row.original.participation_status === "cancelled" ? (
            <button
              type="button"
              aria-label="취소 되돌리기"
              title="취소 되돌리기"
              onClick={() => setAsk({ kind: "restore", row: ctx.row.original })}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-2 transition hover:bg-surface-2 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-primary-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="신청 취소"
              title="신청 취소 (좌석 반납 · 되돌릴 수 있음)"
              onClick={() => setAsk({ kind: "cancel", row: ctx.row.original })}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-2 transition hover:bg-danger-bg hover:text-danger focus-visible:outline-2 focus-visible:outline-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          </span>
        ),
      }),
    ];
    },
    [buses, conflictCells, trips, saveText, saveTrips, savePayment, openRegistration, setAsk]
  );

  return columns;
}
