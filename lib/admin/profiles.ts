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

/**
 * 접근 내리기 — 임역원 기간이 끝난 사람을 시스템에서 뺀다.
 *
 * **지우지 않는다.** 이 사람이 남긴 감사 기록·배차 실행·장부 기록이 전부 그를
 * 가리키고 있어서 삭제가 물리적으로 거부되고(FK), 설령 지워도 `auth.users` 가 남아
 * 다시 로그인하면 되살아난다. 그래서 **다시 못 들어오게** 하는 쪽으로 한다:
 * 권한을 게스트로 내리고 캠퍼스·호차 배정을 뗀다. 그러면 미들웨어와 RLS 가 전부 막는다.
 */
export async function revokeAccess(id: string): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({
      role: "guest",
      campus_id: null,
      driver_bus_id: null,
      revoked_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

/** 되돌리기 — 목록으로 복귀시킨다. 권한(캠퍼스·호차)은 따로 다시 줘야 한다. */
export async function restoreAccess(id: string): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ revoked_at: null })
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}
