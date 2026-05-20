"use client";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type RoleLabelRow = Database["public"]["Tables"]["role_labels"]["Row"];

type Result = { ok: true; row: RoleLabelRow } | { ok: false; message: string };

export async function createRoleLabel(
  label: string,
  color: string,
  displayOrder: number
): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("role_labels")
    .insert({ label, color, display_order: displayOrder })
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

export async function updateRoleLabel(
  id: string,
  fields: Partial<Pick<RoleLabelRow, "label" | "color" | "display_order">>
): Promise<Result> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("role_labels")
    .update(fields)
    .eq("id", id)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

export async function deleteRoleLabel(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createClient();
  const { error } = await supabase.from("role_labels").delete().eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("duplicate key") || msg.includes("role_labels_label_key")) {
    return "이미 존재하는 라벨입니다";
  }
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (master만 역할 라벨을 관리할 수 있어요)";
  }
  return msg;
}
