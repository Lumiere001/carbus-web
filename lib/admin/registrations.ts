"use client";

import { createClient } from "@/lib/supabase/client";

type Result = { ok: true } | { ok: false; message: string };

/** 상행/하행 호차 수동 배정·변경·해제 (master 전용, RLS master ALL). null=미배정. */
export async function setAssignment(
  id: string,
  fields: { assigned_up_bus_id?: number | null; assigned_down_bus_id?: number | null }
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("registrations")
    .update(fields)
    .eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/** 역할 라벨 부여·해제 (registrations.roles 배열 교체). master 전용(guard 트리거). */
export async function setRoles(id: string, roles: string[]): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("registrations")
    .update({ roles })
    .eq("id", id);
  if (error) {
    if (error.message.includes("master-only"))
      return { ok: false, message: "역할은 master만 지정할 수 있습니다" };
    return { ok: false, message: humanize(error.message) };
  }
  return { ok: true };
}

/** 전체 명단에서 제외 (등록 삭제). master 전용. audit 자동 기록. */
export async function excludeRegistration(id: string): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.from("registrations").delete().eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (master만 배정을 수정할 수 있어요)";
  }
  return msg;
}
