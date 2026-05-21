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
  const [presetKey, setPresetKey] = useState(
    (initial ? presetKeyOf(initial, presets) : null) ?? presets[0]?.key ?? ""
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
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
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
