"use client";

import { createClient } from "@/lib/supabase/client";
import type { PaymentStatus } from "@/lib/supabase/types";

type Result = { ok: true } | { ok: false; message: string };

/** 납부 상태 토글 (본인 캠퍼스 순장/순원, RLS 차단). audit 자동 기록. */
export async function setPaymentStatus(
  id: string,
  status: PaymentStatus
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("registrations")
    .update({ payment_status: status })
    .eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/** 송금 항목 추가 (campus_remit_add RPC — 본인 캠퍼스 원장에 누적). */
export async function addRemittance(
  amount: number,
  note: string | null
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.rpc("campus_remit_add", {
    p_amount: amount,
    // 메모가 없으면 인자를 생략한다 — SQL 쪽 기본값이 NULL 이라 결과는 같다.
    // (생성된 타입이 p_note?: string 이라 null 을 직접 넘길 수 없다)
    p_note: note ?? undefined,
  });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/** 송금 항목 삭제 (campus_remit_delete RPC — 본인 캠퍼스 항목만). */
export async function deleteRemittance(id: string): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.rpc("campus_remit_delete", { p_id: id });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (본인 캠퍼스만 관리할 수 있어요)";
  }
  return msg;
}
