"use client";

import { createClient } from "@/lib/supabase/client";
import { currentEventId } from "@/lib/events/current";
import type { TransportMode, TransportStatus } from "@/lib/transport/labels";

type Result = { ok: true } | { ok: false; message: string };

export type LegInput = {
  mode: TransportMode;
  /** 타지구 차량일 때만. org_units.id */
  viaUnitId?: string | null;
  status?: TransportStatus;
  note?: string | null;
};

/**
 * 한 사람의 한 방향 이동수단을 저장한다.
 *
 * `our_bus` 는 기본값이라 **행을 지운다** — 599명 중 대부분이 우리 버스이므로,
 * 기본값까지 저장하면 테이블이 의미 없이 커지고 "특별한 사람"을 세는 질의가
 * 전부 필터를 달아야 한다. 없으면 우리 버스라는 규칙 하나로 통일한다.
 */
export async function setTransportLeg(
  registrationId: string,
  direction: "up" | "down",
  input: LegInput
): Promise<Result> {
  const supabase = createClient();

  if (input.mode === "our_bus") {
    const { error } = await supabase
      .from("transport_legs")
      .delete()
      .eq("registration_id", registrationId)
      .eq("direction", direction);
    if (error) return { ok: false, message: humanize(error.message) };
    return { ok: true };
  }

  const ev = await currentEventId(supabase);
  if (!ev.ok) return ev;

  const isOther = input.mode === "other_district";
  const { error } = await supabase.from("transport_legs").upsert(
    {
      event_id: ev.id,
      registration_id: registrationId,
      direction,
      mode: input.mode,
      // 제약이 DB 에도 있지만, 화면에서 먼저 맞춰 보내야 에러 문구를 안 보여준다.
      via_unit_id: isOther ? (input.viaUnitId ?? null) : null,
      status: isOther ? (input.status ?? "confirmed") : "confirmed",
      note: input.note?.trim() || null,
    },
    { onConflict: "registration_id,direction" }
  );
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("chk_via_unit_only_other_district"))
    return "타지구 차량은 어느 지구인지 골라야 합니다.";
  if (msg.includes("chk_pending_only_other_district"))
    return "‘확정 대기’는 타지구 차량일 때만 쓸 수 있습니다.";
  if (msg.includes("지난 행사")) return msg;
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다 (본인 캠퍼스 순장/순원만 관리할 수 있어요)";
  return msg;
}
