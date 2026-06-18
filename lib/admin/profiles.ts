"use client";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

type Result = { ok: true; row: ProfileRow } | { ok: false; message: string };

/** 게스트 → 임역원(campus_admin) 승격 + 담당 캠퍼스 매핑. master만 (RLS). */
export async function assignCampusAdmin(
  id: string,
  campusId: string
): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role: "campus_admin", campus_id: campusId })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

/** 임역원 → 게스트로 권한 해제 (campus_id 비움). */
export async function revokeToGuest(id: string): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role: "guest", campus_id: null })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

/** 임역원 담당 캠퍼스 변경. */
export async function changeCampus(
  id: string,
  campusId: string
): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ campus_id: campusId })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

/** 차량순장 호차 배정 (role 과 독립 — 임역원·게스트 누구나 배정 가능). master만. */
export async function assignDriverBus(
  id: string,
  busId: number
): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ driver_bus_id: busId })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

/** 차량순장 호차 배정 해제. */
export async function clearDriverBus(id: string): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ driver_bus_id: null })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (master만 사용자 권한을 변경할 수 있어요)";
  }
  return msg;
}
