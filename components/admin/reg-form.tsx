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
import { createRegistration, type RegFormFields } from "@/lib/admin/registrations";
import type { EventTrip, PaymentStatus } from "@/lib/supabase/types";

/**
 * master 전용 순장/순원 **추가** 폼.
 *
 * 수정은 오른쪽 편집 서랍(`reg-drawer.tsx`)이 맡는다 — 칸마다 즉시 저장이고,
 * 통째 저장인 이 폼과는 저장 방식 자체가 다르다. 두 경로를 다 남겨두면
 * "어느 화면에서 고쳤나"에 따라 동시 편집 결과가 달라진다.
 *
 * 이동수단(`transport_legs`)은 여기서 받지 않는다. 별도 테이블이라 신청 행이
 * 만들어진 뒤에야 저장할 수 있고, 추가 직후 서랍에서 고르면 된다.
 */
export function RegForm({
  campuses,
  trips,
  onClose,
}: {
  campuses: { id: string; name: string }[];
  trips: EventTrip[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [campusId, setCampusId] = useState(campuses[0]?.id ?? "");
  // 상·하행을 각각 고른다. 참여 형태(attendance_type)는 DB 가 두 편에서 파생하므로
  // 화면이 보내지 않는다 — 조합 셀 시절의 "폴백이 신청을 덮어쓰는" 사고가 구조적으로 사라진다.
  const [upTripId, setUpTripId] = useState<number | null>(null);
  const [downTripId, setDownTripId] = useState<number | null>(null);
  const [payment, setPayment] = useState<PaymentStatus>("unpaid");
  const [note, setNote] = useState("");

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
      const res = await createRegistration(fields);
      if (!res.ok) return setErr(res.message);
      onClose();
      router.refresh();
    });
  }

  const inputCls =
    "w-full text-sm border border-border-2 rounded-md px-2.5 py-1.5 bg-surface";

  return (
    <Card title="순장/순원 추가" subtitle="master 전용">
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
                {tripOptions(trips, "up", null).map((o) => (
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
                {tripOptions(trips, "down", null).map((o) => (
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
              placeholder="예: 금요일 저녁 KTX 귀가"
            />
            {upTripId === null && downTripId === null && !note.trim() && (
              <span className="block text-[11px] text-warning leading-snug">
                ⚠ 버스를 안 타는 분입니다. 추가한 뒤 <b>이동수단</b>을 편집 서랍에서 골라 주세요.
              </span>
            )}
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <Button onClick={submit} disabled={pending}>
            {pending ? "저장 중…" : "추가"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            취소
          </Button>
        </div>
      </div>
    </Card>
  );
}
