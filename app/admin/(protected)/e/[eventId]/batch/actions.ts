"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runBatch } from "@/lib/batch/engine";
import { batchSnapshotSchema } from "@/lib/batch/snapshot";
import { writableEventId } from "@/lib/events/current";
import { viewingEventId } from "@/lib/events/server";
import { adminHref } from "@/lib/events/route";
import type { Passenger } from "@/lib/batch/types";
import type { UserRole } from "@/lib/supabase/types";

export type BatchActionResult =
  | { ok: true; mode: "up" | "down"; total_assigned: number; empty_seats: number;
      errors: string[]; by_bus: Record<number, number> }
  | { ok: false; message: string };

/** The pure engine reads one revision; assignments, cleanup and history save in one transaction. */
export async function runBatchAction(mode: "up" | "down"): Promise<BatchActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "로그인이 필요합니다" };
  const { data: profile } = await supabase.from("profiles").select("role")
    .eq("id", user.id).single<{ role: UserRole }>();
  if (profile?.role !== "master") return { ok: false, message: "총단만 배차를 실행할 수 있습니다" };

  const viewing = await viewingEventId();
  const fallback = viewing ? null : await writableEventId(supabase);
  const eventId = viewing ?? (fallback?.ok ? fallback.id : null);
  if (!eventId) return { ok: false, message: "행사를 확인할 수 없어 배차를 실행하지 않았습니다." };
  const startedAt = Date.now();
  const { data, error: snapshotError } = await supabase.rpc("get_batch_snapshot", { p_event_id: eventId });
  if (snapshotError) return { ok: false, message: snapshotError.message };
  const parsed = batchSnapshotSchema.safeParse(data);
  if (!parsed.success || parsed.data.event_id !== eventId) {
    return { ok: false, message: "배차 입력을 확인할 수 없어 저장하지 않았습니다. 새로고침 후 다시 시도해 주세요." };
  }
  const snapshot = parsed.data;
  if (snapshot.buses.length === 0) return { ok: false, message: "호차 시드가 없습니다 (buses 0건)" };
  const passengers: Passenger[] = snapshot.registrations.map((r) => ({
    id: r.id, name: r.name, campus: r.campus_id, attendance_type: r.attendance_type,
    up_trip_id: r.up_trip_id, down_trip_id: r.down_trip_id, fixed_up_bus_id: null,
  }));
  const labels = Object.fromEntries(snapshot.trips.map((t) => [t.id, t.label]));
  const result = runBatch(passengers, snapshot.buses, mode, labels);
  const assignMap = mode === "up" ? result.up_assignments : result.down_assignments;
  // Include engine-assigned staff-car riders without a bus trip; DB retains other staff-car riders.
  const assignments = Object.fromEntries(passengers
    .filter((p) => (mode === "up" ? p.up_trip_id : p.down_trip_id) !== null || assignMap[p.id] != null)
    .map((p) => [p.id, assignMap[p.id] ?? null]));
  const { error } = await supabase.rpc("save_batch", {
    p_event_id: eventId, p_mode: mode, p_expected_revision: snapshot.revision,
    p_assignments: assignments, p_bus_order: snapshot.buses.map((b) => b.id), p_errors: result.errors, p_elapsed_ms: Date.now() - startedAt,
  });
  const eventPath = adminHref(eventId);
  if (error) {
    revalidatePath(eventPath, "layout");
    if (error.code === "40001" || error.code === "40P01") {
      return { ok: false, message: "다른 변경과 겹쳐 저장하지 않았습니다. 새로고침 후 다시 배차해 주세요." };
    }
    const message = /^(22|23|40|42|P0)/.test(error.code)
      ? `배차 변경을 저장하지 않았습니다: ${error.message}`
      : `배차 저장 결과를 확인하지 못했습니다: ${error.message}. 명단을 새로고침해 확인해 주세요.`;
    return { ok: false, message };
  }
  revalidatePath(eventPath, "layout");
  return { ok: true, mode, total_assigned: result.total_assigned,
    empty_seats: result.empty_seats, errors: result.errors, by_bus: result.by_bus };
}
