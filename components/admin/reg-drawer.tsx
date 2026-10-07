"use client";

import { useEffect, useRef } from "react";
import { X, Check } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ParticipationRange } from "@/components/admin/participation-range";
import { Badge } from "@/components/ui/badge";
import { attendanceSummary } from "@/lib/labels";
import { DrawerBasicFields } from "./drawer/basic-fields";
import { DrawerCourseFields } from "./drawer/course-fields";
import { DrawerPickupFields } from "./drawer/pickup-fields";
import { useRegDrawer } from "./drawer/use-reg-drawer";
import type { RegDrawerProps } from "./drawer/types";
export type { PickupRow } from "./drawer/types";

/**
 * 오른쪽 편집 서랍 (§11-C 의 A).
 *
 * 왜 서랍인가: 예전에는 고칠 사람의 **행 아래에** 폼을 펼쳤다. 화면 맨 위로
 * 되돌아가는 문제는 그걸로 풀렸지만, 폼이 열릴 때마다 아래 행들이 통째로 밀려서
 * 방금 보던 자리가 사라졌다. 서랍은 표를 밀지 않고 스크롤도 건드리지 않는다.
 *
 * **기본 정보는 칸별로 자동 저장한다.** 서로 맞아야 하는 일정·이동은 따로 비교하고 함께 저장한다(`updateRegField` →
 * `updateCells`). 통째 저장이면 내가 안 건드린 칸까지 내가 열었을 때의 값으로
 * 되돌아가고, 그 사이 다른 사람이 고친 것이 조용히 덮인다.
 */
export function RegDrawer({
  row,
  campuses,
  trips,
  units,
  journeyLegs = [],
  pickups,
  places,
  courses,
  dayCount,
  onSaved,
  variant = "master",
  includeBasics = variant === "master",
  onClose,
}: RegDrawerProps) {
  const {
    busy, state, setJourneyBusy, save, toggleCourse, saveCourseTime,
    pickupDraft, setPickupDraft, pickupError, setPickupError, addPickupRow, removePickup,
    onNameDirty, onStudentDirty, onNoteDirty, onAttendanceDirty, requestClose, discardOpen, cancelDiscard,
  } = useRegDrawer({ row, courses, onSaved, onClose });
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const drawer = drawerRef.current;
    const previous = document.activeElement;
    drawer?.showModal();
    closeRef.current?.focus();
    return () => {
      drawer?.close();
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) previous.focus();
      else (document.querySelector<HTMLElement>(`[data-registration-editor="${row.id}"]`)
        ?? document.querySelector<HTMLElement>('nav[aria-label="부분 참석 조건"] [aria-current="page"], nav[aria-label="부분 참석 조건"] button[aria-pressed="true"]')
        ?? document.getElementById("workspace-content"))?.focus();
    };
  }, [row.id]);

  return (
    <dialog
      ref={drawerRef}
      aria-label={`${row.name} 편집`}
      onCancel={(event) => { event.preventDefault(); if (!busy) requestClose(); }}
      className="fixed inset-y-0 left-auto right-0 m-0 flex h-dvh max-h-none w-[calc(100%-1rem)] max-w-2xl flex-col border-0 border-l border-border bg-surface p-0 text-foreground shadow-3 backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{row.name}</p>
          <p className="text-xs text-muted-2">
            {campuses.find((c) => c.id === row.campus_id)?.name ?? "—"} ·{" "}
            {attendanceSummary(row.up_trip_id, row.down_trip_id, trips)}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={requestClose}
          aria-label="편집 닫기"
          title="편집 닫기"
          disabled={busy}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {(busy || state.kind !== "idle") && <div role={state.kind === "err" ? "alert" : "status"} className="px-4 py-3 border-b border-border min-h-11 text-xs">
        {busy ? (
          <span className="text-muted-2 flex items-center gap-1">
            저장 중…
          </span>
        ) : state.kind === "saved" ? (
          <span className="text-success flex items-center gap-1">
            <Check size={12} /> {state.field} 저장됨
          </span>
        ) : state.kind === "err" ? (
          <span className="text-danger">{state.text}</span>
        ) : null}
      </div>}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-3">
        <nav aria-label="개인 정보 편집 항목" className="flex flex-wrap gap-1">
          <a href={`#attend-${row.id}`} className="inline-flex min-h-11 items-center rounded-md bg-primary-50 px-3 text-xs font-medium text-primary-800">참여 기간</a>
          <a onClick={(event) => { const target = document.getElementById(`pickup-${row.id}`); if (target instanceof HTMLDetailsElement) { event.preventDefault(); target.open = true; target.scrollIntoView({ block: "start" }); } }} href={`#pickup-${row.id}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-xs text-primary-800 hover:bg-primary-50">수송 요청</a>
          <a onClick={(event) => { const target = document.getElementById(`course-${row.id}`); if (target instanceof HTMLDetailsElement) { event.preventDefault(); target.open = true; target.scrollIntoView({ block: "start" }); } }} href={`#course-${row.id}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-xs text-primary-800 hover:bg-primary-50">수강신청</a>
        </nav>
        <div id={`attend-${row.id}`} className="scroll-mt-3">
        <ParticipationRange key={row.id} row={row} legs={journeyLegs} trips={trips} units={units} disabled={busy} onSaved={onSaved} onDirtyChange={onAttendanceDirty} onBusyChange={setJourneyBusy} />

        </div>
        {includeBasics && <DrawerBasicFields row={row} campuses={campuses} variant={variant} busy={busy}
          save={save}
          onNameDirty={onNameDirty} onStudentDirty={onStudentDirty} onNoteDirty={onNoteDirty} />}

        <details id={`course-${row.id}`} open={courses.length > 0} className="scroll-mt-3 rounded-lg border border-border p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">수강신청 (선택) · {courses.length}일</summary>
        <DrawerCourseFields courses={courses} dayCount={dayCount} busy={busy} toggleCourse={toggleCourse} saveCourseTime={saveCourseTime} /></details>

        <details id={`pickup-${row.id}`} open={pickups.length > 0} className="scroll-mt-3 rounded-lg border border-border p-3"><summary className="min-h-11 cursor-pointer py-3 text-sm">수송 요청 (선택) · {pickups.length}건</summary>
        <DrawerPickupFields pickups={pickups} places={places} busy={busy} draft={pickupDraft} error={pickupError}
          setDraft={setPickupDraft} setError={setPickupError} addPickup={addPickupRow} removePickup={removePickup} /></details>

        {row.participation_status === "cancelled" && (
          <Badge variant="danger" dot={false}>
            취소된 신청 — 되돌리기는 명단의 ‘되돌리기’ 에서
          </Badge>
        )}
      </div>
      <ConfirmDialog open={discardOpen} title="미저장 변경을 버리고 닫을까요?" description="아직 저장하지 않은 입력이 있습니다. 계속 입력하려면 취소를 누르세요." confirmLabel="변경 버리고 닫기" tone="danger" onCancel={cancelDiscard} onConfirm={onClose} />
    </dialog>
  );
}
