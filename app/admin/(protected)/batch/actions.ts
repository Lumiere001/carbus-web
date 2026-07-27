"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runBatch } from "@/lib/batch/engine";
import { writableEventId } from "@/lib/events/current";
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
        "id, name, campus_id, attendance_type, up_trip_id, down_trip_id, assigned_up_bus_id, assigned_down_bus_id, roles"
      )
      // 취소자는 배차 대상이 아니다. 빼지 않으면 좌석을 차지하는 유령 승객이 된다.
      .neq("participation_status", "cancelled"),
    supabase
      .from("buses")
      .select(
        "id, name, capacity, hard_cap, up_trip_id, down_trip_id, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids, is_cohesion_exempt, fill_priority"
      ),
  ]);
  if (regRes.error) return { ok: false, message: regRes.error.message };
  if (busRes.error) return { ok: false, message: busRes.error.message };

  const passengers: Passenger[] = (regRes.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    campus: r.campus_id,
    attendance_type: r.attendance_type,
    up_trip_id: r.up_trip_id,
    down_trip_id: r.down_trip_id,
    fixed_up_bus_id: null,
  }));
  const buses: Bus[] = (busRes.data ?? []).map((b) => ({ ...b }));

  if (buses.length === 0) {
    return { ok: false, message: "호차 시드가 없습니다 (buses 0건)" };
  }

  // ── 선행조건: 이 방향의 리더(차량순장/고정탑승)는 이 방향 호차가 지정돼 있어야 함 ──
  // 역할 = 호차 바인딩(단일 진실원)이라, 이 방향 리더는 정의상 이 방향 호차를 갖는다.
  // 따라서 "한 방향만 리더"인 사람(예: 상행 차량순장이지만 하행은 일반 탑승)은
  // 다른 방향에선 일반 탑승자로 보고 엔진이 자동 배차한다.
  //   ⚠️ 과거엔 '어느 방향에든 리더면 타는 모든 방향에 호차 필수'로 막아서, 상행 리더가
  //   하행도 타면 하행 배차가 통째로 멈췄다(상행만 정상). 그 교차-방향 강제를 제거.
  // 실제 문제(좌석 부족·슬롯 불일치·중복 고정)는 엔진이 result.errors 로 표면화한다.

  // 상·하행 모두 전체 재배차: 기존 배정(assigned_*)을 초기화하고 새로 계산한다.
  // (차량순장/고정탑승 바인딩만 엔진이 앵커로 존중하고, 그 외 인원은 재배치.)
  const result = runBatch(passengers, buses, mode);

  // 해당 방향 컬럼만 그룹 업데이트 (배정 호차별 1회. 미배정은 null 그룹).
  const assignMap = mode === "up" ? result.up_assignments : result.down_assignments;
  // 그 방향 참여자만 대상 (상행=요일 있음 / 하행=uses_return_bus)
  const participants = passengers.filter((p) =>
    mode === "up" ? p.up_trip_id !== null : p.down_trip_id !== null
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
  // Phase 4-3 — 배차 실행 기록도 행사를 명시한다. 이 행이 엉뚱한 행사에 붙으면
  // "이 행사에서 배차를 언제 돌렸나"가 통째로 틀린다.
  const ev = await writableEventId(supabase);
  await supabase.from("batch_runs").insert({
    ...(ev.ok ? { event_id: ev.id } : {}),
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
