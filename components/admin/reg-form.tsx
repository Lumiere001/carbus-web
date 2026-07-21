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
};

/** master 전용 순장/순원 추가·수정 폼. */
export function RegForm({
  mode,
  initial,
  campuses,
  trips,
  onClose,
}: {
  mode: "new" | "edit";
  initial?: RegFormInitial;
  campuses: { id: string; name: string }[];
  trips: EventTrip[];
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
    start(async () => {
      const res =
        mode === "new"
          ? await createRegistration(fields)
          : await updateRegistrationFields(initial!.id, fields);
      if (!res.ok) return setErr(res.message);
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
