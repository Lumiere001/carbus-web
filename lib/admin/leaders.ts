"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * 리더(차량순장·고정탑승) 호차 지정 — 사람 기준.
 * 사람 관점에서 "이 사람을 (상행/하행) N호차의 차량순장/고정탑승으로" 지정한다.
 * 한 사람이 한 방향에서 두 호차에 중복되지 않도록, 새 호차로 옮기기 전에
 * 기존 배정을 먼저 정리한다. master 전용(RLS).
 */

type Mode = "up" | "down";
type Result = { ok: true } | { ok: false; message: string };

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다 (master만 변경할 수 있어요)";
  return msg;
}

/** 사람을 (방향) busId 의 차량순장으로 지정. busId=null 이면 해제. 이전 순장 호차는 자동 해제. */
export async function assignDriverBus(
  personId: string,
  busId: number | null,
  mode: Mode
): Promise<Result> {
  const supabase = createClient();
  if (mode === "up") {
    const c = await supabase
      .from("buses")
      .update({ driver_registration_id: null })
      .eq("driver_registration_id", personId);
    if (c.error) return { ok: false, message: humanize(c.error.message) };
    if (busId != null) {
      const s = await supabase
        .from("buses")
        .update({ driver_registration_id: personId })
        .eq("id", busId);
      if (s.error) return { ok: false, message: humanize(s.error.message) };
    }
  } else {
    const c = await supabase
      .from("buses")
      .update({ down_driver_registration_id: null })
      .eq("down_driver_registration_id", personId);
    if (c.error) return { ok: false, message: humanize(c.error.message) };
    if (busId != null) {
      const s = await supabase
        .from("buses")
        .update({ down_driver_registration_id: personId })
        .eq("id", busId);
      if (s.error) return { ok: false, message: humanize(s.error.message) };
    }
  }
  return { ok: true };
}

/** 사람을 (방향) busId 의 고정탑승으로 지정. busId=null 이면 해제. 이전 고정 호차는 자동 해제. */
export async function assignFixedBus(
  personId: string,
  busId: number | null,
  mode: Mode
): Promise<Result> {
  const supabase = createClient();
  const col = mode === "up" ? "fixed_passenger_ids" : "down_fixed_passenger_ids";

  // 현재 이 사람이 들어있는 모든 호차의 고정 배열 조회 후 제거
  const { data: all, error: fErr } = await supabase
    .from("buses")
    .select("id, fixed_passenger_ids, down_fixed_passenger_ids");
  if (fErr) return { ok: false, message: humanize(fErr.message) };

  for (const b of all ?? []) {
    const arr: string[] =
      (mode === "up" ? b.fixed_passenger_ids : b.down_fixed_passenger_ids) ?? [];
    if (b.id !== busId && arr.includes(personId)) {
      const next = arr.filter((x) => x !== personId);
      const u =
        mode === "up"
          ? await supabase.from("buses").update({ fixed_passenger_ids: next }).eq("id", b.id)
          : await supabase.from("buses").update({ down_fixed_passenger_ids: next }).eq("id", b.id);
      if (u.error) return { ok: false, message: humanize(u.error.message) };
    }
  }

  if (busId != null) {
    const target = (all ?? []).find((b) => b.id === busId);
    const arr: string[] =
      (mode === "up" ? target?.fixed_passenger_ids : target?.down_fixed_passenger_ids) ?? [];
    if (!arr.includes(personId)) {
      const next = [...arr, personId];
      const u =
        mode === "up"
          ? await supabase.from("buses").update({ fixed_passenger_ids: next }).eq("id", busId)
          : await supabase.from("buses").update({ down_fixed_passenger_ids: next }).eq("id", busId);
      if (u.error) return { ok: false, message: humanize(u.error.message) };
    }
  }
  void col;
  return { ok: true };
}
