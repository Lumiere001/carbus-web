"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { X, Check, Loader2, Trash2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PAYMENT_LABELS, PAYMENT_STATUSES, tripOptions, attendanceSummary } from "@/lib/labels";
import { updateRegField } from "@/lib/admin/registrations";
import { setTransportLeg } from "@/lib/admin/transport";
import { addPickup, deletePickup, setAttendRange } from "@/lib/admin/pickup";
import { TransportPicker, type LegValue } from "@/components/admin/transport-picker";
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

export function RegDrawer({
  row,
  campuses,
  trips,
  units,
  upLeg,
  downLeg,
  pickups,
  places,
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

  // 텍스트 칸은 타자마다 저장하면 안 되므로 로컬 상태를 두고 blur 에서 보낸다.
  const [name, setName] = useState(row.name);
  const [studentId, setStudentId] = useState(row.student_id);
  const [note, setNote] = useState(row.note ?? "");
  // 이동수단은 여러 칸이 모여야 한 값이 되므로 화면 상태를 따로 든다 (changeLeg 주석 참고).
  const [upDraft, setUpDraft] = useState<LegValue>(upLeg);
  const [downDraft, setDownDraft] = useState<LegValue>(downLeg);
  const [pickupDraft, setPickupDraft] = useState({
    direction: "up" as "up" | "down",
    at: "",
    placeId: "",
    note: "",
  });

  // 다른 사람을 고르면 이 컴포넌트가 통째로 다시 마운트돼(부모가 key={row.id})
  // 위 상태가 그 사람 값으로 새로 잡힌다. effect 로 되돌리면 저장 직후 새로고침에서
  // 방금 친 글자가 서버 값으로 덮인다.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

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

  /** 이동수단 한 방향 저장. 확정으로 바꾸면 좌석이 반납되므로 먼저 묻는다. */
  function saveLeg(dir: "up" | "down", next: LegValue) {
    const tripId = dir === "up" ? row.up_trip_id : row.down_trip_id;
    if (
      next.mode === "other_district" &&
      next.status === "confirmed" &&
      tripId != null
    ) {
      const ok = window.confirm(
        `${dir === "up" ? "갈 때" : "올 때"} 타지구 차량이 확정으로 저장됩니다.\n\n` +
          `해당 방향의 운행편과 배정 호차가 비워져 좌석이 반납됩니다.\n` +
          `되돌리려면 편을 다시 지정하고 배차를 다시 실행해야 합니다.\n\n진행할까요?`
      );
      if (!ok) return;
    }
    setState({ kind: "idle" });
    start(async () => {
      const res = await setTransportLeg(row.id, dir, {
        mode: next.mode,
        viaUnitId: next.viaUnitId,
        status: next.status,
      });
      if (!res.ok) return setState({ kind: "err", text: res.message });
      const label = dir === "up" ? "갈 때 이동수단" : "올 때 이동수단";
      setState({ kind: "saved", field: label });
      onSaved(label);
    });
  }

  /** 참여기간 — 둘 다 비우면 "행사 전체 참석"으로 돌아간다. */
  function saveAttend(from: string | null, to: string | null) {
    setState({ kind: "idle" });
    start(async () => {
      const res = await setAttendRange(row.id, from, to);
      if (!res.ok) return setState({ kind: "err", text: res.message });
      setState({ kind: "saved", field: "참여기간" });
      onSaved("참여기간");
    });
  }

  function addPickupRow() {
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

  const paidWarning =
    row.payment_status === "paid" ? (
      <p className="text-[11px] text-warning-700 leading-snug">
        ⚠ 이미 납부한 신청입니다. 편을 바꿔도 <b>청구액은 자동으로 바뀌지 않습니다</b> —
        정산 화면의 차액 목록에 나타납니다.
      </p>
    ) : null;

  return (
    <aside
      // 액센트 테두리로 "여기가 지금 고치는 자리"를 표시한다.
      // 넓은 화면에서는 표 오른쪽에 나란히(표를 밀지 않는다), 좁은 화면에서는
      // 오른쪽에서 덮는 패널로. 좁은 화면에서 나란히 두면 둘 다 못 읽는다.
      className={
        "bg-surface border-l-2 border-primary-300 flex flex-col " +
        "fixed inset-y-0 right-0 z-40 w-[88%] max-w-sm shadow-2xl " +
        "lg:static lg:z-auto lg:w-[320px] lg:max-w-none lg:shrink-0 " +
        "lg:max-h-[560px] lg:shadow-none"
      }
      aria-label={`${row.name} 편집`}
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
          onClick={onClose}
          aria-label="편집 닫기"
          className="text-muted-2 hover:text-foreground shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* 저장 버튼이 없으므로 "저장됐다"는 신호는 여기 한 줄이 전부다. */}
      <div className="px-4 py-1.5 border-b border-border min-h-[28px] text-xs">
        {busy ? (
          <span className="text-muted-2 flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> 저장 중…
          </span>
        ) : state.kind === "saved" ? (
          <span className="text-success flex items-center gap-1">
            <Check size={12} /> {state.field} 저장됨
          </span>
        ) : state.kind === "err" ? (
          <span className="text-danger">{state.text}</span>
        ) : (
          <span className="text-muted-2">고치면 바로 저장됩니다</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {variant === "master" && (
        <>
        <label className={labelCls}>
          이름
          <input
            className={inputCls}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() === row.name) return;
              save("이름", { name: row.name }, { name: name.trim() });
            }}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            학번
            <input
              className={inputCls}
              value={studentId}
              disabled={busy}
              onChange={(e) => setStudentId(e.target.value)}
              onBlur={() => {
                if (studentId.trim() === row.student_id) return;
                save("학번", { student_id: row.student_id }, { student_id: studentId.trim() });
              }}
            />
          </label>
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
        </>
        )}

        <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-2.5">
          <p className="text-xs text-muted-2 leading-snug">
            <b className="text-foreground">이동수단</b> — 우리 버스가 아니면 여기서 고르세요.
            비고에 적으면 “타지구”가 <b>소속</b>인지 <b>얻어 타는 차</b>인지 구분되지 않습니다.
          </p>
          <TransportPicker
            label="갈 때 (상행)"
            value={upDraft}
            units={units}
            disabled={busy}
            onChange={(v) => changeLeg("up", v)}
          />
          <TransportPicker
            label="올 때 (하행)"
            value={downDraft}
            units={units}
            disabled={busy}
            onChange={(v) => changeLeg("down", v)}
          />
        </div>

        {/* 참여기간 — 부분참이 "며칠부터 며칠까지"인지. 지금까지는 비고에 글로 적혔다. */}
        <div className="grid grid-cols-2 gap-2">
          <label className={labelCls}>
            참여 시작일
            <input
              type="date"
              className={inputCls}
              defaultValue={row.attend_from ?? ""}
              disabled={busy}
              onChange={(e) => saveAttend(e.target.value || null, row.attend_to)}
            />
          </label>
          <label className={labelCls}>
            참여 종료일
            <input
              type="date"
              className={inputCls}
              defaultValue={row.attend_to ?? ""}
              disabled={busy}
              onChange={(e) => saveAttend(row.attend_from, e.target.value || null)}
            />
          </label>
        </div>
        <p className="text-[11px] text-muted-2 leading-snug">
          비워 두면 <b>행사 전체 참석</b>입니다. 부분참만 채우세요.
        </p>

        {/* 수송 요청 — 개인을 데리러 가는 건. 보드(부분참 화면)에서 (날짜·시각·장소)로
            묶이면 그대로 간사 차량 배차표가 된다. */}
        <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-2.5">
          <p className="text-xs text-muted-2 leading-snug">
            <b className="text-foreground">수송 요청</b> — 따로 데리러 가야 하는 경우.
            <b> 시각·장소를 몰라도 등록하세요</b> — 미정인 채로 남아야 “물어볼 사람”으로
            보드에 뜹니다.
          </p>

          {pickups.length > 0 && (
            <ul className="space-y-1">
              {pickups.map((p) => (
                <li
                  key={p.id}
                  className="flex items-start justify-between gap-2 text-xs bg-surface rounded-md border border-border px-2 py-1.5"
                >
                  <span className="min-w-0">
                    <b className="text-foreground">
                      {p.direction === "up" ? "갈 때" : "올 때"}
                    </b>{" "}
                    <span className={p.pickupAt ? "text-muted" : "text-danger"}>
                      {p.pickupAt
                        ? new Date(p.pickupAt).toLocaleString("ko-KR", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "시각 미정"}
                    </span>
                    <span className="text-muted-2">
                      {p.placeName ? ` · ${p.placeName}` : " · 장소 미정"}
                      {p.note ? ` · ${p.note}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removePickup(p.id)}
                    aria-label="수송 요청 삭제"
                    className="text-muted-2 hover:text-danger shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <select
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
              <option value="up">갈 때</option>
              <option value="down">올 때</option>
            </select>
          {/* 날짜+시각이 한 칸에 들어가는 입력이라 좁으면 시각이 잘린다.
              전화로 도착 시각을 받아 적는 칸이라 잘리면 확인이 안 된다. */}
          <input
            type="datetime-local"
            className={inputCls}
            value={pickupDraft.at}
            disabled={busy}
            onChange={(e) => setPickupDraft((d) => ({ ...d, at: e.target.value }))}
            aria-label="픽업 시각"
          />
          {/* 장소는 **총단이 등록한 목록에서 고른다.** 차를 보내는 건 총단이라
              갈 수 있는 곳의 목록도 총단만 안다. 자유 입력이면 차가 가지 않는 곳을
              적을 수 있다. */}
          <select
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
          </select>
          {places.length === 0 && (
            <p className="text-[11px] text-warning-700 leading-snug">
              이 행사에 등록된 픽업 장소가 없습니다. 총단 운영자가 <b>편성</b> 화면에서
              먼저 장소를 등록해야 고를 수 있습니다.
            </p>
          )}
          <input
            type="text"
            className={inputCls}
            value={pickupDraft.note}
            disabled={busy}
            onChange={(e) => setPickupDraft((d) => ({ ...d, note: e.target.value }))}
            placeholder="메모 (선택)"
            aria-label="수송 요청 메모"
          />
          <Button size="sm" disabled={busy} onClick={addPickupRow}>
            <Plus size={14} /> 수송 요청 추가
          </Button>
        </div>

        {variant === "master" && (
        <label className={labelCls}>
          비고 (부분참 일정·특이사항 등 자유 기록)
          <textarea
            className={inputCls + " min-h-[70px]"}
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note.trim() === (row.note ?? "").trim()) return;
              save("비고", { note: row.note }, { note: note.trim() || null });
            }}
            placeholder="예: 금요일 저녁 KTX 귀가"
          />
        </label>
        )}

        {row.participation_status === "cancelled" && (
          <Badge variant="danger" dot={false}>
            취소된 신청 — 되돌리기는 명단의 ‘되돌리기’ 에서
          </Badge>
        )}
      </div>
    </aside>
  );
}
