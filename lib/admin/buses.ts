"use client";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type BusRow = Database["public"]["Tables"]["buses"]["Row"];

type Result = { ok: true; row: BusRow } | { ok: false; message: string };

/** 배차 방향. 상행/하행 차량순장·고정은 별개 컬럼으로 관리. */
export type BusPinMode = "up" | "down";

/** 차량순장 지정·해제 (regId null 이면 해제). master만 (RLS). 방향별 컬럼. */
export async function setDriver(
  busId: number,
  regId: string | null,
  mode: BusPinMode = "up"
): Promise<Result> {
  const supabase = createClient();
  const patch =
    mode === "up"
      ? { driver_registration_id: regId }
      : { down_driver_registration_id: regId };
  const { data, error } = await supabase
    .from("buses")
    .update(patch)
    .eq("id", busId)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

/** 고정 탑승자 배열 전체 교체 (client가 현재 배열 보유 → 추가/제거 후 전달). 방향별 컬럼. */
export async function setFixedPassengers(
  busId: number,
  ids: string[],
  mode: BusPinMode = "up"
): Promise<Result> {
  const supabase = createClient();
  const patch =
    mode === "up"
      ? { fixed_passenger_ids: ids }
      : { down_fixed_passenger_ids: ids };
  const { data, error } = await supabase
    .from("buses")
    .update(patch)
    .eq("id", busId)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (master만 호차 정보를 변경할 수 있어요)";
  }
  return msg;
}
