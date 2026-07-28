"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  PAYMENT_LABELS,
  PAYMENT_STATUSES,
  tripOptions,
  attendanceSummary,
} from "@/lib/labels";
import {
  createRegistration,
  updateRegistrationFields,
  type RegFormFields,
} from "@/lib/admin/registrations";
import { setTransportLeg } from "@/lib/admin/transport";
import {
  TransportPicker,
  DEFAULT_LEG,
  type LegValue,
} from "@/components/admin/transport-picker";
import type { EventTrip, PaymentStatus } from "@/lib/supabase/types";

export type RegFormInitial = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
  up_trip_id: number | null;
  down_trip_id: number | null;
  payment_status: PaymentStatus;
  note: string | null;
  /** 방향별 이동수단 (3단계). 없으면 우리 버스. */
  up_leg?: LegValue;
  down_leg?: LegValue;
};

/** master 전용 순장/순원 추가·수정 폼. */
export function RegForm({
  mode,
  initial,
  campuses,
  trips,
  units,
  onClose,
}: {
  mode: "new" | "edit";
  initial?: RegFormInitial;
  campuses: { id: string; name: string }[];
  trips: EventTrip[];
  /** 타지구 차량일 때 고를 지구 목록 (org_units). */
  units: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [studentId, setStudentId] = useState(initial?.student_id ?? "");
  const [campusId, setCampusId] = useState(initial?.campus_id ?? campuses[0]?.id ?? "");
  // 상·하행을 각각 고른다. 참여 형태(attendance_type)는 DB 가 두 편에서 파생하므로
  // 화면이 보내지 않는다 — 조합 셀 시절의 "폴백이 신청을 덮어쓰는" 사고가 구조적으로 사라진다.
  const [upTripId, setUpTripId] = useState<number | null>(initial?.up_trip_id ?? null);
  const [downTripId, setDownTripId] = useState<number | null>(
    initial?.down_trip_id ?? null
  );
  const [payment, setPayment] = useState<PaymentStatus>(
    initial?.payment_status ?? "unpaid"
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [upLeg, setUpLeg] = useState<LegValue>(initial?.up_leg ?? DEFAULT_LEG);
  const [downLeg, setDownLeg] = useState<LegValue>(initial?.down_leg ?? DEFAULT_LEG);

  function submit() {
    setErr(null);
    const fields: RegFormFields = {
      name: name.trim(),
      student_id: studentId.trim(),
      campus_id: campusId,
      up_trip_id: upTripId,
      down_trip_id: downTripId,
      payment_status: payment,
      note: note.trim() || null,
    };
    if (!fields.name || !fields.student_id || !fields.campus_id)
      return setErr("이름·학번·캠퍼스는 필수입니다");

    // 타지구 확정으로 저장하면 DB 트리거가 그 방향의 편·배정 호차를 비운다.
    // 저장 버튼 하나로 좌석이 사라지므로 여기서 한 번 묻는다 — 되돌리려면 재배차해야 한다.
    const releasing = ([
      ["갈 때", upLeg, upTripId],
      ["올 때", downLeg, downTripId],
    ] as const)
      .filter(
        ([, leg, tripId]) =>
          leg.mode === "other_district" && leg.status === "confirmed" && tripId != null
      )
      .map(([dir]) => dir);
    if (releasing.length > 0) {
      const ok = window.confirm(
        `${releasing.join("·")} 타지구 차량이 확정으로 저장됩니다.\n\n` +
          `해당 방향의 운행편과 배정 호차가 비워져 좌석이 반납됩니다.\n` +
          `되돌리려면 편을 다시 지정하고 배차를 다시 실행해야 합니다.\n\n진행할까요?`
      );
      if (!ok) return;
    }

    start(async () => {
      const res =
        mode === "new"
          ? await createRegistration(fields)
          : await updateRegistrationFields(initial!.id, fields);
      if (!res.ok) return setErr(res.message);

      // 이동수단은 별도 테이블이라 따로 저장한다. 신규는 방금 만든 행의 id 가
      // 필요해서 수정 때만 반영한다 — 추가 직후 다시 열어 고르면 된다.
      if (mode === "edit" && initial) {
        for (const [dir, leg] of [
          ["up", upLeg],
          ["down", downLeg],
        ] as const) {
          const r = await setTransportLeg(initial.id, dir, {
            mode: leg.mode,
            viaUnitId: leg.viaUnitId,
            status: leg.status,
          });
          if (!r.ok) return setErr(r.message);
        }
      }
      onClose();
      router.refresh();
    });
  }

  const inputCls =
    "w-full text-sm border border-border-2 rounded-md px-2.5 py-1.5 bg-surface";

  return (
    <Card
      title={mode === "new" ? "순장/순원 추가" : "순장/순원 수정"}
      subtitle={mode === "edit" ? initial?.name : "master 전용"}
    >
      <div className="p-5 space-y-3">
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-muted space-y-1 block">
            이름
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-xs text-muted space-y-1 block">
            학번 (두 자리 숫자 또는 외국인/타지구)
            <input
              className={inputCls}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              placeholder="예: 23"
            />
          </label>
          <label className="text-xs text-muted space-y-1 block">
            캠퍼스
            <select className={inputCls} value={campusId} onChange={(e) => setCampusId(e.target.value)}>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted space-y-1 block">
              상행 (가는 편)
              <select
                className={inputCls}
                value={upTripId === null ? "" : String(upTripId)}
                onChange={(e) =>
                  setUpTripId(e.target.value === "" ? null : Number(e.target.value))
                }
              >
                {/* 현재 값이 비활성 편이어도 목록에 남긴다 — 사라지면 조용히 덮어써진다. */}
                {tripOptions(trips, "up", initial?.up_trip_id ?? null).map((o) => (
                  <option key={o.id ?? "none"} value={o.id === null ? "" : String(o.id)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted space-y-1 block">
              하행 (오는 편)
              <select
                className={inputCls}
                value={downTripId === null ? "" : String(downTripId)}
                onChange={(e) =>
                  setDownTripId(e.target.value === "" ? null : Number(e.target.value))
                }
              >
                {tripOptions(trips, "down", initial?.down_trip_id ?? null).map((o) => (
                  <option key={o.id ?? "none"} value={o.id === null ? "" : String(o.id)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-muted-2 leading-snug">
            {attendanceSummary(upTripId, downTripId, trips)}
            {upTripId === null && downTripId === null &&
              " — KTX·자차 등 버스를 전혀 이용하지 않는 분입니다."}
          </p>
          {initial &&
            payment === "paid" &&
            (upTripId !== initial.up_trip_id || downTripId !== initial.down_trip_id) && (
              <p className="text-[11px] text-warning-700 leading-snug">
                ⚠ 이미 납부한 신청입니다. 편을 바꿔도 <b>청구액은 자동으로 바뀌지 않습니다</b> —
                환불이 필요한지 따로 확인하세요.
              </p>
            )}
          <label className="text-xs text-muted space-y-1 block">
            납부
            <select
              className={inputCls}
              value={payment}
              onChange={(e) => setPayment(e.target.value as PaymentStatus)}
            >
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PAYMENT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          {mode === "edit" && (
            <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
              <p className="sm:col-span-2 text-xs text-muted-2 leading-snug">
                <b className="text-foreground">이동수단</b> — 우리 버스가 아니면 여기서 고르세요.
                예전엔 비고에 적었는데, 그러면 “타지구”가 <b>소속</b>인지 <b>얻어 타는 차</b>인지
                구분되지 않았습니다(지난 수련회에서 두 뜻이 63건·80건으로 섞였습니다).
              </p>
              <TransportPicker
                label="갈 때 (상행)"
                value={upLeg}
                units={units}
                disabled={pending}
                onChange={setUpLeg}
              />
              <TransportPicker
                label="올 때 (하행)"
                value={downLeg}
                units={units}
                disabled={pending}
                onChange={setDownLeg}
              />
            </div>
          )}
          <label className="text-xs text-muted space-y-1 block sm:col-span-2">
            비고 (부분참 일정·특이사항 등 자유 기록)
            <textarea
              className={inputCls + " min-h-[60px]"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 평창역 17:30 도착 / 금요일 저녁 KTX 귀가"
            />
            {upTripId === null && downTripId === null && !note.trim() && (
              <span className="block text-[11px] text-warning leading-snug">
                ⚠ 미이용 선택 시 이동 수단(KTX·자차 등)을 비고에 적어주세요.
              </span>
            )}
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <Button onClick={submit} disabled={pending}>
            {pending ? "저장 중…" : mode === "new" ? "추가" : "저장"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            취소
          </Button>
        </div>
      </div>
    </Card>
  );
}
