"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runBatch } from "@/lib/batch/engine";
import type { Passenger, Bus } from "@/lib/batch/types";
import type { UserRole } from "@/lib/supabase/types";

export type BatchActionResult =
  | {
      ok: true;
      mode: "up" | "down";
      total_assigned: number;
      empty_seats: number;
      errors: string[];
      by_bus: Record<number, number>;
    }
  | { ok: false; message: string };

/**
 * 배차 실행 (master 수동 트리거). 상행/하행을 따로 실행.
 * registrations·buses 조회 → 순수 엔진(lib/batch, mode) 실행 →
 * 해당 방향 컬럼만 그룹 업데이트 → batch_runs 이력 + last_batch_at 갱신.
 *
 * @param mode "up" 상행만 / "down" 하행만
 */
export async function runBatchAction(
  mode: "up" | "down"
): Promise<BatchActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "로그인이 필요합니다" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  if (profile?.role !== "master") {
    return { ok: false, message: "master만 배차를 실행할 수 있습니다" };
  }

  const startedAt = Date.now();

  const [regRes, busRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, campus_id, attendance_type, departure_day, uses_return_bus"
      ),
    supabase
      .from("buses")
      .select(
        "id, name, capacity, hard_cap, departure_day, driver_registration_id, fixed_passenger_ids"
      ),
  ]);
  if (regRes.error) return { ok: false, message: regRes.error.message };
  if (busRes.error) return { ok: false, message: busRes.error.message };

  const passengers: Passenger[] = (regRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    campus: r.campus_id,
    attendance_type: r.attendance_type,
    departure_day: r.departure_day,
    uses_return_bus: r.uses_return_bus,
    fixed_up_bus_id: null,
  }));
  const buses: Bus[] = (busRes.data ?? []).map((b) => ({ ...b }));

  if (buses.length === 0) {
    return { ok: false, message: "호차 시드가 없습니다 (buses 0건)" };
  }

  const result = runBatch(passengers, buses, mode);

  // 해당 방향 컬럼만 그룹 업데이트 (배정 호차별 1회. 미배정은 null 그룹).
  const assignMap = mode === "up" ? result.up_assignments : result.down_assignments;
  // 그 방향 참여자만 대상 (상행=요일 있음 / 하행=uses_return_bus)
  const participants = passengers.filter((p) =>
    mode === "up" ? p.departure_day !== null : p.uses_return_bus === true
  );
  const groups = new Map<number | null, string[]>();
  for (const p of participants) {
    const busId = assignMap[p.id] ?? null;
    const arr = groups.get(busId) ?? [];
    arr.push(p.id);
    groups.set(busId, arr);
  }
  for (const [busId, ids] of groups) {
    const patch =
      mode === "up"
        ? { assigned_up_bus_id: busId }
        : { assigned_down_bus_id: busId };
    for (let i = 0; i < ids.length; i += 100) {
      const { error } = await supabase
        .from("registrations")
        .update(patch)
        .in("id", ids.slice(i, i + 100));
      if (error) return { ok: false, message: `배정 저장 실패: ${error.message}` };
    }
  }

  const success = result.errors.length === 0;
  await supabase.from("batch_runs").insert({
    run_by: user.id,
    success,
    total_assigned: result.total_assigned,
    by_bus: result.by_bus,
    empty_seats: result.empty_seats,
    error_message: result.errors.length ? result.errors.join("\n") : null,
    trigger_reason: mode === "up" ? "manual-up" : "manual-down",
    elapsed_ms: Date.now() - startedAt,
  });
  await supabase
    .from("system_config")
    .update({ last_batch_at: new Date().toISOString() })
    .eq("id", 1);

  revalidatePath("/admin/buses");
  revalidatePath("/admin");
  revalidatePath("/admin/batch");

  return {
    ok: true,
    mode,
    total_assigned: result.total_assigned,
    empty_seats: result.empty_seats,
    errors: result.errors,
    by_bus: result.by_bus,
  };
}
