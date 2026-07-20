"use client";

import { createClient } from "@/lib/supabase/client";

type Result = { ok: true } | { ok: false; message: string };

/**
 * master 통장 입금액 등록 (campus_payment_settlements UPSERT, master_received_* 만).
 * RLS settle_master_all 로 master 만 통과. campus_remitted_* 는 미포함 → 보존.
 */
export async function setMasterReceived(
  campusId: string,
  total: number,
  note: string | null
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("campus_payment_settlements")
    .upsert(
      {
        campus_id: campusId,
        master_received_total: total,
        master_received_note: note,
        master_received_at: new Date().toISOString(),
      },
      // 정산 행의 키는 (event_id, campus_id) 다. campus_id 만 주면
      // "ON CONFLICT 에 맞는 제약이 없다"로 실패한다.
      // event_id 는 컬럼 기본값(활성 행사)이 채우므로 페이로드에 넣지 않는다.
      { onConflict: "event_id,campus_id" }
    );
  if (error) {
    if (error.message.includes("row-level security") || error.message.includes("policy")) {
      return { ok: false, message: "권한이 없습니다 (master만 입금액을 등록할 수 있어요)" };
    }
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
