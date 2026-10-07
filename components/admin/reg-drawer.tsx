"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { X, Check, Trash2, Plus } from "lucide-react";
import { DateTimeField } from "@/components/ui/date-time-field";
import { isCompleteDateTime, formatKst } from "@/lib/time/kst";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AutosaveTextField } from "@/components/admin/autosave-text-field";
import { ParticipationRange } from "@/components/admin/participation-range";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PAYMENT_LABELS, PAYMENT_STATUSES, tripOptions, attendanceSummary } from "@/lib/labels";
import { updateRegField } from "@/lib/admin/registrations";
import { setTransportLeg } from "@/lib/admin/transport";
import { addPickup, deletePickup, setAttendRange } from "@/lib/admin/pickup";
import { setCourseSignup, clearCourseSignup } from "@/lib/admin/courses";
import { dayLabel } from "@/lib/courses/days";
import { TransportPicker, type LegValue } from "@/components/admin/transport-picker";
import {
  DIRECTION_LABELS,
  PICKUP_DIRECTION_LABELS,
  TRANSPORT_LABELS,
  legSkipsOurBus,
} from "@/lib/transport/labels";
import type { AdminRegRow, CampusInfo } from "@/components/admin/registrations-panel";
import type { EventTrip, PaymentStatus } from "@/lib/supabase/types";

/**
 * 오른쪽 편집 서랍 (§11-C 의 A).
 *
 * 왜 서랍인가: 예전에는 고칠 사람의 **행 아래에** 폼을 펼쳤다. 화면 맨 위로
 * 되돌아가는 문제는 그걸로 풀렸지만, 폼이 열릴 때마다 아래 행들이 통째로 밀려서
 * 방금 보던 자리가 사라졌다. 서랍은 표를 밀지 않고 스크롤도 건드리지 않는다.
 *
 * **저장 버튼이 없다.** 칸을 고치면 그 칸만 바로 저장된다(`updateRegField` →
 * `updateCells`). 통째 저장이면 내가 안 건드린 칸까지 내가 열었을 때의 값으로
 * 되돌아가고, 그 사이 다른 사람이 고친 것이 조용히 덮인다.
 */
export type PickupRow = {
  id: number;
  direction: "up" | "down";
  pickupAt: string | null;
  placeName: string | null;
  note: string | null;
};

function sameLeg(a: LegValue, b: LegValue) {
  return a.mode === b.mode && a.viaUnitId === b.viaUnitId && a.status === b.status;
}

export function RegDrawer({
  row,
  campuses,
  trips,
  units,
  upLeg,
  downLeg,
  pickups,
  places,
  courses,
  dayCount,
  onSaved,
  variant = "master",
  onClose,
}: {
  row: AdminRegRow;
  campuses: CampusInfo[];
  trips: EventTrip[];
  units: { id: string; name: string }[];
  upLeg: LegValue;
  downLeg: LegValue;
  /** 이 사람의 수송 요청들. 여러 건일 수 있다(중간 합류·중간 이탈). */
  pickups: PickupRow[];
  /** 총단이 이 행사에 등록해 둔 픽업 장소. 고르기만 한다 — 자유 입력이 아니다. */
  places: { id: number; name: string }[];
  /**
   * 이 사람의 수강신청 — `day_no → 시간(HH:MM)`. 시간이 없으면 빈 문자열.
   * **날짜가 아니라 몇째 날**이다(행사 날짜는 해마다 바뀐다).
   */
  courses: { dayNo: number; atTime: string | null }[];
  /** 이 행사에서 고를 수 있는 날 수. 행사 기간에서 계산해 부모가 넘긴다. */
  dayCount: number;
  /**
   * 저장이 끝났을 때. **새로고침은 부모가 한다** — 사람을 바꾸면 이 서랍이
   * 통째로 다시 마운트되는데, 그 순간 진행 중이던 저장의 뒷정리가 같이 사라져
   * "DB 에는 저장됐는데 표는 옛 값 그대로"가 됐다. 저장 버튼이 없는 화면에서
   * 그건 조용한 데이터 손실이다.
   */
  onSaved: (label: string) => void;
  /**
   * `master` = 전부 편집. `campus` = 임역원용으로, **그리드에 이미 있는 칸은 뺀다**
   * (이름·학번·캠퍼스·편·납부·비고). 같은 값을 두 자리에서 고치게 하면 어느 쪽이
   * 최신인지가 화면마다 달라진다. 임역원에게 없던 것 — 이동수단·참여기간·수송 요청 —
   * 만 남긴다.
   */
  variant?: "master" | "campus";
  onClose: () => void;
}) {
  const [busy, start] = useTransition();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "saved"; field: string } | { kind: "err"; text: string }
  >({ kind: "idle" });

  // 이동수단은 여러 칸이 모여야 한 값이 되므로 화면 상태를 따로 든다 (changeLeg 주석 참고).
  const [upDraft, setUpDraft] = useState<LegValue>(upLeg);
  const [downDraft, setDownDraft] = useState<LegValue>(downLeg);
  const [legSources, setLegSources] = useState({ up: upLeg, down: downLeg });
  // 수강신청은 서버 값에서 곧바로 읽는다 — 저장이 끝나면 부모가 새로고침하므로
  // 화면 상태를 따로 들면 그 둘이 어긋난다(저장 버튼이 없는 화면이라 더 그렇다).
  const courseDays = new Set(courses.map((c) => c.dayNo));
  const courseTimes = new Map(
    courses.map((c) => [c.dayNo, (c.atTime ?? "").slice(0, 5)] as const)
  );
  const [pickupError, setPickupError] = useState("");
  const [pickupDraft, setPickupDraft] = useState({
    direction: "up" as "up" | "down",
    at: "",
    placeId: "",
    note: "",
  });

  const [pendingLeg, setPendingLeg] = useState<{ dir: "up" | "down"; next: LegValue } | null>(null);
  const changedUp = !sameLeg(legSources.up, upLeg);
  const changedDown = !sameLeg(legSources.down, downLeg);
  if (!busy && (changedUp || changedDown)) {
    setLegSources({ up: upLeg, down: downLeg });
    if (changedUp && pendingLeg?.dir !== "up" && !(upDraft.mode === "other_district" && !upDraft.viaUnitId)) setUpDraft(upLeg);
    if (changedDown && pendingLeg?.dir !== "down" && !(downDraft.mode === "other_district" && !downDraft.viaUnitId)) setDownDraft(downLeg);
  }
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
    const incompleteLeg = (upDraft.mode === "other_district" && !upDraft.viaUnitId) || (downDraft.mode === "other_district" && !downDraft.viaUnitId);
    if (textDirtyFields.current.size || attendanceDirty || pickupDraft.at || pickupDraft.placeId || pickupDraft.note || pickupDraft.direction !== "up" || incompleteLeg) {
      discardRequested.current = true;
      setDiscardOpen(true);
    }
    else onClose();
  }
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
      else document.querySelector<HTMLButtonElement>(`[data-registration-editor="${row.id}"]`)?.focus();
    };
  }, [row.id]);

  /** 한 칸 저장. expected 는 "내가 열었을 때 보던 값" — 충돌 감지의 기준이다. */
  function save(
    label: string,
    expected: Partial<AdminRegRow>,
    patch: Record<string, unknown>
  ) {
    setState({ kind: "idle" });
    start(async () => {
      const res = await updateRegField(row.id, expected, patch);
      if (!res.ok) {
        setState({ kind: "err", text: res.message });
        // 충돌이면 최신값을 화면에 다시 그려야 한다 — 안 그러면 다음 저장도 같은 값으로 또 실패한다.
        if (res.conflict) onSaved("최신값");
        return;
      }
      setState({ kind: "saved", field: label });
      onSaved(label);
    });
  }

  /**
   * 이동수단은 **여러 칸이 모여야 한 값이 된다.** 타지구 차량은 지구까지 골라야
   * DB 가 받아준다. 그래서 다른 칸처럼 "고르는 즉시 저장"을 하면:
   *   타지구를 고름 → 지구가 아직 없어 저장 거부 → 화면 값이 안 바뀜
   *   → **지구 고르는 칸이 나타나지 않음** → 영원히 못 넣는다.
   * 실제로 이 상태로 배포돼서, 확정 대기를 만들 방법이 아예 없었다.
   *
   * 그래서 이동수단만 화면 상태를 따로 들고, **값이 완성됐을 때 저장한다.**
   */
  function changeLeg(dir: "up" | "down", next: LegValue) {
    if (dir === "up") setUpDraft(next);
    else setDownDraft(next);

    if (next.mode === "other_district" && !next.viaUnitId) {
      // 아직 값이 반쪽이다. 저장하지 않고, 무엇이 남았는지 알려준다.
      setState({ kind: "err", text: "어느 지구 차량인지 마저 골라 주세요 (아직 저장 안 됨)" });
      return;
    }
    saveLeg(dir, next);
  }

  /**
   * 이동수단 한 방향 저장.
   *
   * 우리 버스를 안 타는 수단으로 바꾸면 **그 방향 좌석이 반납된다**(§26-B).
   * 되돌리려면 재배차해야 하므로 좌석을 잡고 있을 때만 먼저 묻는다 — 이미 비어
   * 있으면 잃을 게 없는데도 묻는 셈이라 확인창이 소음이 된다.
   */
  function saveLeg(dir: "up" | "down", next: LegValue) {
    const tripId = dir === "up" ? row.up_trip_id : row.down_trip_id;
    if (legSkipsOurBus(next.mode, next.status) && tripId != null) {
      setPendingLeg({ dir, next });
      return;
    }
    commitLeg(dir, next);
  }

  function commitLeg(dir: "up" | "down", next: LegValue) {
    setState({ kind: "idle" });
    start(async () => {
      const res = await setTransportLeg(row.id, dir, {
        mode: next.mode,
        viaUnitId: next.viaUnitId,
        status: next.status,
      });
      if (!res.ok) {
        if (dir === "up") setUpDraft(upLeg); else setDownDraft(downLeg);
        setState({ kind: "err", text: res.message });
        return;
      }
      const label = `${DIRECTION_LABELS[dir]} 이동수단`;
      setState({ kind: "saved", field: label });
      onSaved(label);
    });
  }

  /** 참여기간 — 둘 다 비우면 "행사 전체 참석"으로 돌아간다. */
  function saveAttend(from: string | null, to: string | null, expected: { readonly attend_from: string | null; readonly attend_to: string | null }) {
    setState({ kind: "idle" });
    start(async () => {
      const res = await setAttendRange(row.id, from, to, expected);
      if (!res.ok) {
        setState({ kind: "err", text: res.message });
        if (res.conflict) onSaved("최신값");
        return;
      }
      setState({ kind: "saved", field: "참여기간" });
      onSaved("참여기간");
    });
  }

  /**
   * 수강신청 켜기/끄기.
   *
   * 끄면 **행을 지운다.** "안 들음" 을 값으로 남기면 아직 안 고른 사람과 구분되지
   * 않는다(동규님 결정: 해당 없는 사람은 아무것도 안 고른다).
   */
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

  /** 시간만 고치기. 빈 값은 "시간 미정" 으로 그대로 저장된다. */
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
        // 시각·장소를 비워도 등록된다 — "가긴 가는데 아직 모른다"가 가장 흔한 상태고,
        // 그게 보드의 "시각 미정" 묶음이 된다.
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

  const inputCls =
    "w-full text-sm border border-border-2 rounded-md px-2.5 py-1.5 bg-surface disabled:opacity-60";
  const labelCls = "text-xs text-muted space-y-1 block";

  // 방향 문구는 `lib/transport/labels` 한 곳에서 만든다 — 수송 요청과 이동수단이
  // 따로 놀면(한쪽은 "픽업 장소 → 수련회장", 한쪽은 "갈 때 (상행)") 같은 화면에서
  // 두 기준을 동시에 읽어야 한다.
  const pickupDirLabel = (dir: "up" | "down") => PICKUP_DIRECTION_LABELS[dir];

  const paidWarning =
    row.payment_status === "paid" ? (
      <p className="text-xs text-warning leading-snug">
        이미 납부한 신청입니다. 편을 바꿔도 <b>청구액은 자동으로 바뀌지 않습니다</b> —
        정산 화면의 차액 목록에 나타납니다.
      </p>
    ) : null;

  return (
    <dialog
      ref={drawerRef}
      aria-label={`${row.name} 편집`}
      onCancel={(event) => { event.preventDefault(); if (!busy) requestClose(); }}
      className="fixed inset-y-0 left-auto right-0 m-0 flex h-dvh max-h-none w-[calc(100%-1rem)] max-w-md flex-col border-0 border-l border-border bg-surface p-0 text-foreground shadow-3 backdrop:bg-black/40"
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

      {/* 저장 버튼이 없으므로 "저장됐다"는 신호는 여기 한 줄이 전부다. */}
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

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <nav aria-label="개인 정보 편집 항목" className="flex flex-wrap gap-1">
          <a href={`#attend-${row.id}`} className="inline-flex min-h-11 items-center rounded-md bg-primary-50 px-3 text-xs font-medium text-primary-800">참여 기간</a>
          <a href={`#pickup-${row.id}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-xs text-primary-800 hover:bg-primary-50">수송 요청</a>
          <a href={`#course-${row.id}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-xs text-primary-800 hover:bg-primary-50">수강신청</a>
        </nav>
        <div id={`attend-${row.id}`} className="scroll-mt-3">
        <ParticipationRange key={row.id} from={row.attend_from} to={row.attend_to} disabled={busy} onChange={saveAttend} onDirtyChange={onAttendanceDirty} />

        </div>
        {variant === "master" && (
        <fieldset className="rounded-lg border border-border p-3 space-y-3">
        <legend className="px-1 text-sm font-semibold text-foreground">기본 정보 · 자동 저장</legend>
        <p className="text-xs text-muted">선택은 바로 저장, 글자는 칸을 벗어나면 저장됩니다.</p>
        <AutosaveTextField key={`name:${row.name}`} label="이름" value={row.name} disabled={busy} onDirtyChange={onNameDirty} onSave={(value) => { if (!discardRequested.current) save("이름", { name: row.name }, { name: value }); }} />
        <div className="grid grid-cols-2 gap-2">
          <AutosaveTextField key={`student:${row.student_id}`} label="학번" value={row.student_id} disabled={busy} onDirtyChange={onStudentDirty} onSave={(value) => { if (!discardRequested.current) save("학번", { student_id: row.student_id }, { student_id: value }); }} />
          <label className={labelCls}>
            캠퍼스
            <select
              className={inputCls}
              value={row.campus_id}
              disabled={busy}
              onChange={(e) =>
                save("캠퍼스", { campus_id: row.campus_id }, { campus_id: e.target.value })
              }
            >
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            상행 (가는 편)
            <select
              className={inputCls}
              value={row.up_trip_id === null ? "" : String(row.up_trip_id)}
              disabled={busy}
              onChange={(e) =>
                save(
                  "상행 편",
                  { up_trip_id: row.up_trip_id },
                  { up_trip_id: e.target.value === "" ? null : Number(e.target.value) }
                )
              }
            >
              {/* 비활성 편이어도 현재 값이면 목록에 남긴다 — 사라지면 조용히 덮어써진다. */}
              {tripOptions(trips, "up", row.up_trip_id).map((o) => (
                <option key={o.id ?? "none"} value={o.id === null ? "" : String(o.id)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            하행 (오는 편)
            <select
              className={inputCls}
              value={row.down_trip_id === null ? "" : String(row.down_trip_id)}
              disabled={busy}
              onChange={(e) =>
                save(
                  "하행 편",
                  { down_trip_id: row.down_trip_id },
                  { down_trip_id: e.target.value === "" ? null : Number(e.target.value) }
                )
              }
            >
              {tripOptions(trips, "down", row.down_trip_id).map((o) => (
                <option key={o.id ?? "none"} value={o.id === null ? "" : String(o.id)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {paidWarning}

        <label className={labelCls}>
          납부
          <select
            className={inputCls}
            value={row.payment_status}
            disabled={busy}
            onChange={(e) =>
              save(
                "납부",
                { payment_status: row.payment_status },
                { payment_status: e.target.value as PaymentStatus }
              )
            }
          >
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYMENT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <AutosaveTextField key={`note:${row.note}`} label="비고 (특이사항 등 자유 기록)" value={row.note ?? ""} disabled={busy} multiline onDirtyChange={onNoteDirty} onSave={(value) => { if (!discardRequested.current) save("비고", { note: row.note }, { note: value || null }); }} />
        </fieldset>
        )}

        <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-2.5">
          <p className="text-xs text-muted-2 leading-snug">
            <b className="text-foreground">이동수단 · 선택 완료 시 저장</b> — 우리 버스가 아니면 여기서 고르세요.
            비고에 적으면 “타지구”가 <b>소속</b>인지 <b>얻어 타는 차</b>인지 구분되지 않습니다.
          </p>
          <TransportPicker
            label={DIRECTION_LABELS.up}
            value={upDraft}
            units={units}
            disabled={busy}
            onChange={(v) => changeLeg("up", v)}
          />
          <TransportPicker
            label={DIRECTION_LABELS.down}
            value={downDraft}
            units={units}
            disabled={busy}
            onChange={(v) => changeLeg("down", v)}
          />
        </div>

        <div id={`course-${row.id}`} className="scroll-mt-3" />
        {/* 수강신청 조사 — 캠프에서 함께 받는다.
            ⚠️ **날짜를 저장하지 않는다.** 저장하는 건 "첫째날" 뿐이다 — 행사 날짜는
            해마다 바뀌지만 "첫째날" 은 안 바뀐다(동규님 지시). */}
        <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-2.5">
          <p className="text-xs text-muted-2 leading-snug">
            <b className="text-foreground">수강신청 · 바로 저장</b> — <span className="whitespace-nowrap">듣는 날만 고르세요.</span>
            <b className="whitespace-nowrap"> 해당 없으면 선택하지 마세요.</b>
          </p>

          {Array.from({ length: dayCount }, (_, i) => i + 1).map((day) => {
            const on = courseDays.has(day);
            return (
              <div
                key={day}
                className={
                  "flex items-center gap-2 rounded-md border px-2 py-1.5 " +
                  (on
                    ? "border-border bg-primary-50/60"
                    : "border-border bg-surface")
                }
              >
                <label className="flex items-center gap-2 text-sm flex-1 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={(e) => toggleCourse(day, e.target.checked)}
                    aria-label={`${dayLabel(day)} 수강신청`}
                  />
                  <span className="truncate">
                    {dayLabel(day)}
                    {on && !courseTimes.get(day) && (
                      <span className="ml-1 text-xs text-warning">시간 미정</span>
                    )}
                  </span>
                </label>
                {/* 시간은 비워 둘 수 있다. "듣긴 듣는데 몇 시인지 모른다" 가 실제로
                    흔하고, 강제로 받으면 아무 값이나 찍혀 할 일이 안 보이게 된다. */}
                <input
                  type="time"
                  value={courseTimes.get(day) ?? ""}
                  disabled={busy || !on}
                  onChange={(e) => saveCourseTime(day, e.target.value)}
                  aria-label={`${dayLabel(day)} 시간`}
                  className={
                    "rounded-md border border-border-2 bg-surface px-2 py-1 text-sm text-foreground tabular-nums " +
                    (on ? "" : "opacity-40")
                  }
                />
              </div>
            );
          })}

          <p className="text-xs text-muted-2 leading-snug">
            시간은 나중에 적어도 됩니다 — 비워 두면 수강신청 화면에{" "}
            <span className="whitespace-nowrap"><b>시간 미정</b>으로 모입니다.</span>
          </p>
        </div>

        <div id={`pickup-${row.id}`} className="scroll-mt-3" />
        {/* 수송 요청 — 개인을 데리러 가는 건. 보드(부분참 화면)에서 (날짜·시각·장소)로
            묶이면 그대로 간사 차량 배차표가 된다. */}
        <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-2.5">
          <p className="text-sm font-semibold text-foreground">수송 요청 <span className="text-xs font-normal text-muted">추가 버튼으로 저장</span></p>
          <p className="text-xs text-muted-2 leading-snug">
            따로 데리러 가야 할 때 입력하세요.{" "}
            <span className="whitespace-nowrap">시각·장소는 미정으로 남길 수 있습니다.</span>
          </p>

          {pickups.length > 0 && (
            <ul className="space-y-1">
              {pickups.map((p) => (
                <li
                  key={p.id}
                  className="flex items-start justify-between gap-2 text-xs bg-surface rounded-md border border-border px-2 py-1.5"
                >
                  <span className="min-w-0">
                    <b className="text-foreground">{pickupDirLabel(p.direction)}</b>{" "}
                    <span className={p.pickupAt ? "text-muted" : "text-danger"}>
                      {p.pickupAt ? formatKst(p.pickupAt) : "시각 미정"}
                    </span>
                    <span className="text-muted-2">
                      {p.placeName ? ` · ${p.placeName}` : " · 장소 미정"}

                    </span>
                    {p.note && <span role="note" aria-label="수송 메모" className="mt-1 block whitespace-pre-wrap break-words text-foreground"><span className="mr-2 text-muted">수송 메모</span>{p.note}</span>}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removePickup(p.id)}
                    aria-label="수송 요청 삭제"
                    title="수송 요청 삭제"
                    className="flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-danger-bg hover:text-danger shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className={labelCls}>수송 방향<select
              className={inputCls}
              value={pickupDraft.direction}
              disabled={busy}
              onChange={(e) =>
                setPickupDraft((d) => ({
                  ...d,
                  direction: e.target.value as "up" | "down",
                }))
              }
              aria-label="수송 방향"
            >
              <option value="up">{pickupDirLabel("up")}</option>
              <option value="down">{pickupDirLabel("down")}</option>
            </select></label>
          <DateTimeField label="픽업 일시" value={pickupDraft.at} disabled={busy} error={pickupError} onChange={(value) => { setPickupError(""); setPickupDraft((draft) => ({ ...draft, at: value })); }} />
          {/* 장소는 **총단이 등록한 목록에서 고른다.** 차를 보내는 건 총단이라
              갈 수 있는 곳의 목록도 총단만 안다. 자유 입력이면 차가 가지 않는 곳을
              적을 수 있다. */}
          <label className={labelCls}>픽업 장소<select
            className={inputCls}
            value={pickupDraft.placeId}
            disabled={busy || places.length === 0}
            onChange={(e) => setPickupDraft((d) => ({ ...d, placeId: e.target.value }))}
            aria-label="픽업 장소"
          >
            <option value="">장소 미정</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select></label>
          {places.length === 0 && (
            <p className="text-xs text-warning leading-snug">
              이 행사에 등록된 픽업 장소가 없습니다. 총단 운영자가 <b className="whitespace-nowrap">운행편·차량 편성</b> 화면에서
              먼저 장소를 등록해야 고를 수 있습니다.
            </p>
          )}
          <label className={labelCls}>수송 요청 메모 (선택)<input
            type="text"
            className={inputCls}
            value={pickupDraft.note}
            disabled={busy}
            onChange={(e) => setPickupDraft((d) => ({ ...d, note: e.target.value }))}
            placeholder="메모 (선택)"
            aria-label="수송 요청 메모"
          /></label>
          <Button size="sm" disabled={busy} onClick={addPickupRow}>
            <Plus size={14} /> 수송 요청 추가
          </Button>
        </div>


        {row.participation_status === "cancelled" && (
          <Badge variant="danger" dot={false}>
            취소된 신청 — 되돌리기는 명단의 ‘되돌리기’ 에서
          </Badge>
        )}
      </div>
      <ConfirmDialog open={pendingLeg !== null} title="우리 버스 좌석을 반납할까요?" description={pendingLeg ? `${DIRECTION_LABELS[pendingLeg.dir]} 이동수단을 변경합니다: ${TRANSPORT_LABELS[pendingLeg.next.mode]}. 배정 호차·운행편을 비우며, 다시 타려면 편 지정과 재배차가 필요합니다.` : undefined} confirmLabel="좌석 반납하고 변경" tone="danger" onCancel={() => {
        if (pendingLeg?.dir === "up") setUpDraft(upLeg);
        if (pendingLeg?.dir === "down") setDownDraft(downLeg);
        setPendingLeg(null);
      }} onConfirm={() => { if (pendingLeg) commitLeg(pendingLeg.dir, pendingLeg.next); setPendingLeg(null); }} />
      <ConfirmDialog open={discardOpen} title="미저장 변경을 버리고 닫을까요?" description="아직 저장하지 않은 입력이 있습니다. 계속 입력하려면 취소를 누르세요." confirmLabel="변경 버리고 닫기" tone="danger" onCancel={() => { discardRequested.current = false; setDiscardOpen(false); }} onConfirm={onClose} />
    </dialog>
  );
}
