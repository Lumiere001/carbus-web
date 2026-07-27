"use client";

import { createClient } from "@/lib/supabase/client";
import { currentEventId } from "@/lib/events/current";

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
  // ⚠️ 정산 행의 키는 (event_id, campus_id) 다. 예전엔 event_id 를 컬럼 기본값에
  //    맡기고 페이로드에서 뺐는데, 4-4 에서 그 기본값을 지운다. 그때 이 upsert 가
  //    조용히 깨지면 **금전 사고**다(입금액이 엉뚱한 행사에 붙거나 아예 안 들어간다).
  //    그래서 명시로 바꾼다. 지금 값은 기본값이 넣던 것과 같다.
  const ev = await currentEventId(supabase);
  if (!ev.ok) return ev;
  const { error } = await supabase
    .from("campus_payment_settlements")
    .upsert(
      {
        event_id: ev.id,
        campus_id: campusId,
        master_received_total: total,
        master_received_note: note,
        master_received_at: new Date().toISOString(),
      },
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

/**
 * 총단이 캠퍼스를 대신해 송금을 등록한다 (4단계 — 송금 등록 유도).
 *
 * 왜 필요한가: 실측으로 운영 `campus_remittances` 가 **0행**이었다. 임역원이 안 해서
 * 돈 흐름 추적이 통째로 비어 있었다. 기능을 없애자니 나중에 흐름을 못 따라가고,
 * 두자니 안 채워진다 — 그래서 **총단이 통장 내역을 보고 대신 채운다.**
 * 등록 주체는 note 에 남아 나중에 구분된다.
 */
export async function masterRemitFor(
  campusId: string,
  amount: number,
  note?: string | null
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.rpc("master_remit_add", {
    p_campus_id: campusId,
    p_amount: amount,
    p_note: note ?? undefined,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}
