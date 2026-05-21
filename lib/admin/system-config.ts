"use client";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import type { SystemPhase } from "@/lib/supabase/types";

export type SystemConfigRow = Database["public"]["Tables"]["system_config"]["Row"];

type Result =
  | { ok: true; row: SystemConfigRow }
  | { ok: false; message: string };

/** Phase 전환 (phase1 입력 ↔ phase2 마감/배차). master만 (RLS).
 *  phase2 로 전환하는 순간을 기록(phase2_started_at) → '마감 후 변동'의 기준점. */
export async function setPhase(phase: SystemPhase): Promise<Result> {
  return update({
    current_phase: phase,
    phase2_started_at: phase === "phase2" ? new Date().toISOString() : null,
  });
}

/** 배차 활성화 토글. master만 (RLS). */
export async function setBatchEnabled(enabled: boolean): Promise<Result> {
  return update({ batch_enabled: enabled });
}

async function update(
  fields: Partial<
    Pick<SystemConfigRow, "current_phase" | "batch_enabled" | "phase2_started_at">
  >
): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("system_config")
    .update(fields)
    .eq("id", 1)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (master만 시스템 설정을 변경할 수 있어요)";
  }
  return msg;
}
