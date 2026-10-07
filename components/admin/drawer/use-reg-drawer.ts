import { useCallback, useRef, useState, useTransition } from "react";
import { updateRegField } from "@/lib/admin/registrations";
import { addPickup, deletePickup } from "@/lib/admin/pickup";
import { setCourseSignup, clearCourseSignup } from "@/lib/admin/courses";
import { dayLabel } from "@/lib/courses/days";
import { isCompleteDateTime } from "@/lib/time/kst";
import type { DrawerStatus, PickupDraft, RegDrawerProps, SaveRegField } from "./types";

export function useRegDrawer({ row, courses, onSaved, onClose }: Pick<RegDrawerProps, "row" | "courses" | "onSaved" | "onClose">) {
  const [fieldBusy, start] = useTransition();
  const [journeyBusy, setJourneyBusy] = useState(false);
  const busy = fieldBusy || journeyBusy;
  const [state, setState] = useState<DrawerStatus>({ kind: "idle" });
  const courseTimes = new Map(courses.map((course) => [course.dayNo, (course.atTime ?? "").slice(0, 5)] as const));
  const [pickupError, setPickupError] = useState("");
  const [pickupDraft, setPickupDraft] = useState<PickupDraft>({ direction: "up", at: "", placeId: "", note: "" });
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const textDirtyFields = useRef(new Set<string>());
  const discardRequested = useRef(false);
  const onTextDirty = useCallback((field: string, dirty: boolean) => {
    if (dirty) {
      textDirtyFields.current.add(field);
      setState({ kind: "idle" });
    } else textDirtyFields.current.delete(field);
  }, []);
  const onNameDirty = useCallback((dirty: boolean) => onTextDirty("name", dirty), [onTextDirty]);
  const onStudentDirty = useCallback((dirty: boolean) => onTextDirty("student_id", dirty), [onTextDirty]);
  const onNoteDirty = useCallback((dirty: boolean) => onTextDirty("note", dirty), [onTextDirty]);
  const onAttendanceDirty = useCallback((dirty: boolean) => {
    setAttendanceDirty(dirty);
    if (dirty) setState({ kind: "idle" });
  }, []);

  function requestClose() {
    if (textDirtyFields.current.size || attendanceDirty || pickupDraft.at || pickupDraft.placeId || pickupDraft.note || pickupDraft.direction !== "up") {
      discardRequested.current = true;
      setDiscardOpen(true);
    } else onClose();
  }

  function cancelDiscard() {
    discardRequested.current = false;
    setDiscardOpen(false);
  }

  /** 관측한 한 칸만 비교·저장한다. 닫기 확인으로 생긴 blur는 저장하지 않는다. */
  const save: SaveRegField = (label, expected, patch) => {
    if (discardRequested.current) return;
    setState({ kind: "idle" });
    start(async () => {
      const res = await updateRegField(row.id, expected, patch);
      if (!res.ok) {
        setState({ kind: "err", text: res.message });
        if (res.conflict) onSaved("최신값");
        return;
      }
      setState({ kind: "saved", field: label });
      onSaved(label);
    });
  };

  /** 해당 없는 날은 수강신청 행을 지운다. */
  function toggleCourse(dayNo: number, on: boolean) {
    setState({ kind: "idle" });
    const label = `수강신청 ${dayLabel(dayNo)}`;
    start(async () => {
      const res = on
        ? await setCourseSignup(row.id, dayNo, courseTimes.get(dayNo) || null)
        : await clearCourseSignup(row.id, dayNo);
      if (!res.ok) return setState({ kind: "err", text: res.message });
      setState({ kind: "saved", field: label });
      onSaved(label);
    });
  }

  /** 빈 값은 시간 미정이다. */
  function saveCourseTime(dayNo: number, value: string) {
    setState({ kind: "idle" });
    const label = `수강신청 ${dayLabel(dayNo)} 시간`;
    start(async () => {
      const res = await setCourseSignup(row.id, dayNo, value || null);
      if (!res.ok) return setState({ kind: "err", text: res.message });
      setState({ kind: "saved", field: label });
      onSaved(label);
    });
  }

  function addPickupRow() {
    if (pickupDraft.at && !isCompleteDateTime(pickupDraft.at)) {
      setPickupError("픽업 날짜와 시각을 모두 입력해 주세요. 미정이면 둘 다 비우세요.");
      return;
    }
    setPickupError("");
    setState({ kind: "idle" });
    start(async () => {
      const res = await addPickup(row.id, {
        direction: pickupDraft.direction,
        pickupAt: pickupDraft.at || null,
        placeId: pickupDraft.placeId ? Number(pickupDraft.placeId) : null,
        note: pickupDraft.note || null,
      });
      if (!res.ok) return setState({ kind: "err", text: res.message });
      setPickupDraft({ direction: "up", at: "", placeId: "", note: "" });
      setState({ kind: "saved", field: "수송 요청" });
      onSaved("수송 요청");
    });
  }

  function removePickup(id: number) {
    setState({ kind: "idle" });
    start(async () => {
      const res = await deletePickup(id);
      if (!res.ok) return setState({ kind: "err", text: res.message });
      setState({ kind: "saved", field: "수송 요청 삭제" });
      onSaved("수송 요청 삭제");
    });
  }

  return {
    busy, state, setJourneyBusy, save, toggleCourse, saveCourseTime,
    pickupDraft, setPickupDraft, pickupError, setPickupError, addPickupRow, removePickup,
    onNameDirty, onStudentDirty, onNoteDirty, onAttendanceDirty, requestClose, discardOpen, cancelDiscard,
  };
}
