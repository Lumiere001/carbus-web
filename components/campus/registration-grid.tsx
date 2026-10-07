"use client";

import type { RegistrationGridProps } from "./registration-grid/types";
import { useRegistrationGridController } from "./registration-grid/use-controller";
import { RegistrationGridHeader, RegistrationGridFilters, RegistrationGridSummary } from "./registration-grid/overview";
import { RegistrationGridTable } from "./registration-grid/table";
import { useRegistrationColumns } from "./registration-grid/columns";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RegForm } from "@/components/admin/reg-form";
import { journeyLegsOf } from "@/components/registrations/journey-data";
import { RegDrawer } from "@/components/admin/reg-drawer";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import type { LegValue } from "@/components/admin/transport-picker";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { sortRegistrations, conflictRowIdsOf } from "@/lib/registrations/sort";
import { cn } from "@/lib/utils";
import { useRegistrationEditor } from "@/components/registrations/use-registration-editor";
import { validateAttendancePlan } from "@/lib/registrations/attendance-plan";
import { TRANSPORT_MODES } from "@/lib/transport/labels";
import { summarizeRegistrations } from "@/lib/registrations/view";

export function RegistrationGrid({
  eventId,
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
}: RegistrationGridProps ) {
  const { rows, toast, conflictCells, ask, setAsk, commands, confirmationDialog, membershipError, checkingMembership, confirmMembership } = useRegistrationGridController({ campusId, eventId, initialRows });
  const { saveText, saveTrips, savePayment, handleCancel, handleRestore } = commands;
  const [listView, setListView] = useState("active");
  /** 편집 서랍이 열린 사람. id 로만 들고 있어야 저장 후 최신값이 서랍에 비친다. */
  const { drawerId, openRegistration, closeRegistration } = useRegistrationEditor(rows, campusId);
  const router = useRouter();

  /** 서랍이 보는 사람. rows 에서 매번 찾으므로 저장 뒤 최신값이 그대로 비친다. */
  const drawerRow: AdminRegRow | null = useMemo(() => {
    const r = rows.find((x) => x.id === drawerId);
    if (!r) return null;
    return {
      id: r.id,
      version: r.version,
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
      attend_from_at: r.attend_from_at,
      attend_to_at: r.attend_to_at,
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
  const [creating, setCreating] = useState(false);
  const columns = useRegistrationColumns({ buses, trips, conflictCells, saveText, saveTrips, savePayment, openRegistration, setAsk });

  // 명단 정렬: 충돌 → 미납 → 면제 → 완납, 그룹 내 입력순 (입력 순서 무관).
  const sortedRows = useMemo(
    () => sortRegistrations(rows, conflictRowIdsOf(conflictCells)),
    [rows, conflictCells]
  );
  const visibleRows = useMemo(() => sortedRows.filter((row) =>
    listView === "all" || (listView === "cancelled" ? row.participation_status === "cancelled" : row.participation_status !== "cancelled")
  ), [sortedRows, listView]);

  // 통계·합계 — rows client state에서 실시간 계산 (면제 제외).
  const stats = useMemo(() => summarizeRegistrations(rows), [rows]);

  return (
    <div className="space-y-4">
      {confirmationDialog}
      <RegistrationGridHeader campusName={campusName} visibleRows={visibleRows.map((row) => {
        const up = legs[`${row.id}:up`]; const down = legs[`${row.id}:down`];
        return { ...row, up_mode: TRANSPORT_MODES.find((mode) => mode === up?.mode), down_mode: TRANSPORT_MODES.find((mode) => mode === down?.mode),
          up_via_unit_name: up?.via ?? null, down_via_unit_name: down?.via ?? null,
          up_via_unit_id: up?.viaUnitId ?? null, down_via_unit_id: down?.viaUnitId ?? null,
          up_transport_status: up?.status === "pending" ? "pending" as const : "confirmed" as const,
          down_transport_status: down?.status === "pending" ? "pending" as const : "confirmed" as const };
      })} trips={trips} buses={buses} stats={stats} onCreate={() => setCreating(true)} />

      {creating && <RegForm eventId={eventId} campuses={[{ id: campusId, name: campusName }]} lockedCampusId={campusId} trips={trips} units={units} places={places} dayCount={dayCount} onClose={() => setCreating(false)} />}

      {membershipError && <div role="alert" className="space-y-2 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger">
        <p>{membershipError}</p>
        <Button type="button" variant="secondary" disabled={checkingMembership} onClick={() => void confirmMembership()}>{checkingMembership ? "명단 확인 중…" : "명단 다시 확인"}</Button>
      </div>}

      {toast && (
        <div role={toast.type === "err" ? "alert" : "status"}
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
            좌석과 출석이 <b>반납되고 참여 인원에서 제외됩니다.</b> 명단에는 취소 표시로 남으므로 나중에
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

      <RegistrationGridFilters rows={rows} listView={listView} setListView={setListView} missingTransportCount={rows.filter((row) => {
        const result = validateAttendancePlan({ ...row, legs: journeyLegsOf(legs, row.id) });
        return row.participation_status !== "cancelled" && !result.ok && result.field === "legs";
      }).length} />

      {/* Grid container — Card 비주얼 */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
        <div className="flex flex-col lg:flex-row">
        <RegistrationGridTable visibleRows={visibleRows} columns={columns} listView={listView} />

        {drawerRow && (
          <RegDrawer
            key={drawerRow.id}
            row={drawerRow}
            journeyLegs={journeyLegsOf(legs, drawerRow.id)}
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
            onClose={closeRegistration}
          />
        )}
        </div>

        <RegistrationGridSummary stats={stats} />
      </div>
    </div>
  );
}
