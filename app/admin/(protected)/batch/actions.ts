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
        "id, name, campus_id, attendance_type, departure_slot_id, uses_return_bus, assigned_up_bus_id, assigned_down_bus_id, roles"
      ),
    supabase
      .from("buses")
      .select(
        "id, name, capacity, hard_cap, departure_slot_id, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids"
      ),
  ]);
  if (regRes.error) return { ok: false, message: regRes.error.message };
  if (busRes.error) return { ok: false, message: busRes.error.message };

  const passengers: Passenger[] = (regRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    campus: r.campus_id,
    attendance_type: r.attendance_type,
    departure_slot_id: r.departure_slot_id,
    uses_return_bus: r.uses_return_bus,
    fixed_up_bus_id: null,
  }));
  const buses: Bus[] = (busRes.data ?? []).map((b) => ({ ...b }));

  if (buses.length === 0) {
    return { ok: false, message: "호차 시드가 없습니다 (buses 0건)" };
  }

  // ── 선행조건: 차량순장/고정탑승(= 호차에 묶인 리더)은 타는 방향에도 호차가 있어야 함 ──
  // 역할 = 호차 바인딩(단일 진실원). 어떤 방향에든 묶인 사람은 "리더"이고,
  // 그 사람이 이 방향을 타는데 이 방향 호차가 없으면 배차를 멈추고 호차 지정을 요구.
  {
    const ridesDir = (r: { departure_slot_id: number | null; uses_return_bus: boolean }) =>
      mode === "up" ? r.departure_slot_id !== null : r.uses_return_bus === true;
    const dirDriver = new Set<string>(); // 이 방향 차량순장
    const dirFixed = new Set<string>(); // 이 방향 고정
    const anyLeader = new Set<string>(); // 어느 방향에든 묶인 사람(=리더)
    for (const b of busRes.data ?? []) {
      if (b.driver_registration_id) anyLeader.add(b.driver_registration_id);
      if (b.down_driver_registration_id) anyLeader.add(b.down_driver_registration_id);
      for (const id of b.fixed_passenger_ids ?? []) anyLeader.add(id);
      for (const id of b.down_fixed_passenger_ids ?? []) anyLeader.add(id);
      const drv = mode === "up" ? b.driver_registration_id : b.down_driver_registration_id;
      const fxd = mode === "up" ? b.fixed_passenger_ids : b.down_fixed_passenger_ids;
      if (drv) dirDriver.add(drv);
      for (const id of fxd ?? []) dirFixed.add(id);
    }
    const missing: string[] = [];
    for (const r of regRes.data ?? []) {
      if (!anyLeader.has(r.id)) continue; // 리더 아님
      if (!ridesDir(r)) continue; // 이 방향 안 탐
      if (!dirDriver.has(r.id) && !dirFixed.has(r.id)) missing.push(r.name);
    }
    if (missing.length > 0) {
      const dir = mode === "up" ? "상행" : "하행";
      const head = missing.slice(0, 8).join(", ");
      const more = missing.length > 8 ? ` 외 ${missing.length - 8}명` : "";
      return {
        ok: false,
        message: `${dir}을 타지만 ${dir} 호차가 지정되지 않은 리더(차량순장/고정탑승)가 있습니다: ${head}${more}. '리더 관리' 화면에서 ${dir} 호차를 지정한 뒤 다시 실행하세요.`,
      };
    }
  }

  const result = runBatch(passengers, buses, mode);

  // 해당 방향 컬럼만 그룹 업데이트 (배정 호차별 1회. 미배정은 null 그룹).
  const assignMap = mode === "up" ? result.up_assignments : result.down_assignments;
  // 그 방향 참여자만 대상 (상행=요일 있음 / 하행=uses_return_bus)
  const participants = passengers.filter((p) =>
    mode === "up" ? p.departure_slot_id !== null : p.uses_return_bus === true
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

  // 이 방향에서 빠진 사람(비참여자)인데 옛 배정이 남아 있으면 정리 — 유령 탑승자 방지.
  // (예: 왕복→상행편도로 바뀌어 하행 안 타는데 assigned_down_bus_id 잔존)
  const participantIds = new Set(participants.map((p) => p.id));
  const staleIds = (regRes.data ?? [])
    .filter(
      (r) =>
        !participantIds.has(r.id) &&
        (mode === "up"
          ? r.assigned_up_bus_id !== null
          : r.assigned_down_bus_id !== null)
    )
    .map((r) => r.id);
  const clearPatch =
    mode === "up" ? { assigned_up_bus_id: null } : { assigned_down_bus_id: null };
  for (let i = 0; i < staleIds.length; i += 100) {
    const { error } = await supabase
      .from("registrations")
      .update(clearPatch)
      .in("id", staleIds.slice(i, i + 100));
    if (error) return { ok: false, message: `배정 정리 실패: ${error.message}` };
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
