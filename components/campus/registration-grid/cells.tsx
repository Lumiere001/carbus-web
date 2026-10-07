"use client";

import { useState } from "react";
import type { CellContext } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PAYMENT_LABELS, PAYMENT_STATUSES, paymentDisplayOverride } from "@/lib/labels";
import type { TripOption } from "@/lib/labels";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import type { PaymentStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import type { TextEdit, TextField } from "./types";

const TEXT_LABELS: Record<TextField, string> = { name: "이름", student_id: "학번", note: "비고" };

const PAYMENT_VARIANT = { paid: "success", unpaid: "warning", waived: "mute" } as const;

/** 학번 셀: 숫자 평문 · 외국인/타지구 mute badge. */
export function StudentIdCell({ value }: { value: string }) {
  if (value === "외국인" || value === "타지구") {
    return (
      <Badge variant="mute" dot={false}>
        {value}
      </Badge>
    );
  }
  return <span className="tabular text-foreground">{value}</span>;
}

/** 배차 셀: 값 있으면 평문, 없으면(—) 흐리게. */
export function BusCell({ value, label }: { value: number | null; label: string }) {
  if (value == null) {
    return <span className="text-border-2">—</span>;
  }
  return <span className="text-[13px] text-foreground">{label}</span>;
}

/** 납부 셀: Badge 비주얼 + 투명 select 오버레이(기존 select 동작 유지). */
export function PaymentCell({
  status,
  fee,
  note,
  conflict,
  onChange,
}: {
  readonly status: PaymentStatus;
  readonly fee: number | null;
  readonly note: string | null;
  readonly conflict: boolean;
  readonly onChange: (s: PaymentStatus) => void;
}) {
  // 차량비 0원(버스 미이용)이면 완납/미납 대신 '해당없음' — 단 환불 대기는 드러낸다.
  const override = paymentDisplayOverride(fee, note);
  return (
    <span className="relative inline-flex rounded-full focus-within:ring-2 focus-within:ring-primary-600 focus-within:ring-offset-2 hover:brightness-95 active:brightness-90">
      <Badge
        variant={override ? override.variant : PAYMENT_VARIANT[status]}
        className={cn(conflict && "ring-2 ring-danger")}
      >
        {override ? override.label : PAYMENT_LABELS[status]}
      </Badge>
      <select
        value={status}
        onChange={(e) => { const status = PAYMENT_STATUSES.find((s) => s === e.target.value); if (status) onChange(status); }}
        aria-label="납부 상태"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {PAYMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {PAYMENT_LABELS[s]}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * 텍스트 셀 인라인 편집. 클릭 시 input, blur·Enter 저장, Esc 취소.
 * 값 미변경 시 onSave 내부에서 skip.
 */
export function TextCell({
  ctx,
  field,
  conflict,
  muted = false,
  onSave,
}: {
  readonly ctx: CellContext<RegistrationRow, string | null>;
  readonly field: TextField;
  readonly conflict: boolean;
  readonly muted?: boolean;
  readonly onSave: (edit: TextEdit) => void | Promise<void>;
}) {
  const row = ctx.row.original;
  const value = ctx.getValue() ?? "";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [started, setStarted] = useState(value);

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={field === "student_id" ? `${row.name} 학번 ${value || "미입력"} 수정` : undefined}
        onClick={() => {
          setText(value);
          setStarted(value);
          setEditing(true);
        }}
        className={cn(
          "-mx-1 block min-h-[1.5rem] w-full rounded px-1 text-left transition hover:bg-surface-2",
          conflict && "bg-danger-bg ring-1 ring-danger",
          field === "note" && "max-w-[12rem] truncate text-muted",
          muted && field === "name" && "text-muted"
        )}
      >
        {field === "student_id" ? <StudentIdCell value={value || "—"} /> : value || <span className="text-border-2">—</span>}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    void onSave({ row, field, started, next: text.trim() });
  };

  return (
    <input
      autoFocus
      aria-label={`${row.name} ${TEXT_LABELS[field]}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setText(value);
          setEditing(false);
        }
      }}
      className="w-full rounded-md border-2 border-primary-800 bg-surface px-2 py-1 text-sm text-foreground focus:outline-none"
    />
  );
}

/** 방향 하나의 편 선택 셀. 상·하행이 같은 모양이라 한 컴포넌트로 쓴다. */
export function TripCell({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly options: TripOption[];
  readonly onChange: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted-2">
      <span className="w-8 shrink-0 whitespace-nowrap">{label}</span>
      <select
        value={value === null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-full rounded-md border border-border bg-surface px-2 py-1 text-[13px] text-foreground focus:outline-none focus:border-primary-800"
      >
        {options.map((o) => (
          <option key={o.id ?? "none"} value={o.id === null ? "" : String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
