"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  presetKeyOf,
  presetByKey,
  PAYMENT_LABELS,
  PAYMENT_STATUSES,
  type AttendancePreset,
} from "@/lib/labels";
import {
  createRegistration,
  updateRegistrationFields,
  type RegFormFields,
} from "@/lib/admin/registrations";
import type { AttendanceType, PaymentStatus } from "@/lib/supabase/types";

export type RegFormInitial = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
  attendance_type: AttendanceType;
  departure_slot_id: number | null;
  uses_return_bus: boolean;
  payment_status: PaymentStatus;
  note: string | null;
};

/** master 전용 순장/순원 추가·수정 폼. */
export function RegForm({
  mode,
  initial,
  campuses,
  presets,
  onClose,
}: {
  mode: "new" | "edit";
  initial?: RegFormInitial;
  campuses: { id: string; name: string }[];
  presets: AttendancePreset[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [studentId, setStudentId] = useState(initial?.student_id ?? "");
  const [campusId, setCampusId] = useState(initial?.campus_id ?? campuses[0]?.id ?? "");
  // ⚠️ 수정 모드에서 `?? presets[0]?.key` 로 폴백하면 **신청 내용이 조용히 덮어써진다.**
  //    preset 은 활성 운행편으로만 만들어지므로(lib/labels.ts), 관리자가 편을 비활성으로
  //    내린 뒤 그 편 신청자를 열면 매칭이 실패해 첫 preset(예: '왕복 (화 오후 7시)')이
  //    잡힌다. 납부 상태만 고치고 저장해도 출발 편·참여 형태가 함께 바뀐다.
  //    빈 값으로 두고 아래에서 "(현재 편 — 목록에 없음)" 선택지를 보여준다.
  //    새로 만들 때만 첫 preset 을 기본값으로 쓴다.
  const matchedKey = initial ? presetKeyOf(initial, presets) : null;
  const [presetKey, setPresetKey] = useState(
    initial ? (matchedKey ?? "") : (presets[0]?.key ?? "")
  );
  const [payment, setPayment] = useState<PaymentStatus>(
    initial?.payment_status ?? "unpaid"
  );
  const [note, setNote] = useState(initial?.note ?? "");

  function submit() {
    setErr(null);
    const preset = presetByKey(presetKey, presets);
    if (!preset) return setErr("참석 일정을 선택하세요");
    const fields: RegFormFields = {
      name: name.trim(),
      student_id: studentId.trim(),
      campus_id: campusId,
      attendance_type: preset.attendance_type,
      departure_slot_id: preset.departure_slot_id,
      uses_return_bus: preset.uses_return_bus,
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
          <label className="text-xs text-muted space-y-1 block">
            참석 일정
            <select className={inputCls} value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
              {/*
                현재 값이 어떤 preset 에도 안 맞는 경우(대개 운행편이 비활성으로 내려간 경우).
                빈 선택지를 두어 "고르지 않으면 저장이 막히게" 한다 — 예전엔 첫 preset 으로
                조용히 폴백해서 납부만 고쳐도 출발 편이 바뀌었다.
              */}
              {initial && matchedKey == null && (
                <option value="">지금 편이 목록에 없습니다 — 다시 고르세요</option>
              )}
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            <span className="block text-[11px] text-muted-2 leading-snug">
              💡 「참석 (버스 미이용)」은 KTX·자차 등 버스를 <b>전혀</b> 이용하지 않는 분만. 한쪽만 이용하면 「편도 상행/하행」 선택.
            </span>
          </label>
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
            {presetKey === "self" && !note.trim() && (
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
