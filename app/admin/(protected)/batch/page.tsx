import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import {
  BatchPanel,
  type BatchRunRow,
  type UnassignedRow,
  type BusOption,
} from "@/components/admin/batch-panel";

export const dynamic = "force-dynamic";

export default async function AdminBatchPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<{ role: UserRole }>();
  if (profile?.role !== "master") redirect("/admin");

  const reg = () =>
    supabase.from("registrations").select("id", { count: "exact", head: true });

  const [
    upPartRes,
    upAssignedRes,
    downPartRes,
    downAssignedRes,
    upUnRes,
    downUnRes,
    busRes,
    campusRes,
    runsRes,
    cfgRes,
    slotRes,
  ] = await Promise.all([
    reg().not("departure_slot_id", "is", null),
    reg().not("departure_slot_id", "is", null).not("assigned_up_bus_id", "is", null),
    reg().eq("uses_return_bus", true),
    reg().eq("uses_return_bus", true).not("assigned_down_bus_id", "is", null),
    supabase
      .from("registrations")
      .select("id, name, student_id, campus_id")
      .not("departure_slot_id", "is", null)
      .is("assigned_up_bus_id", null)
      .order("name"),
    supabase
      .from("registrations")
      .select("id, name, student_id, campus_id")
      .eq("uses_return_bus", true)
      .is("assigned_down_bus_id", null)
      .order("name"),
    supabase
      .from("buses")
      .select(
        "id, name, departure_slot_id, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids"
      )
      .order("id"),
    supabase.from("campuses").select("id, name"),
    supabase
      .from("batch_runs")
      .select(
        "id, run_at, success, total_assigned, empty_seats, error_message, elapsed_ms, trigger_reason"
      )
      .order("run_at", { ascending: false })
      .limit(8),
    supabase.from("system_config").select("last_batch_at, current_phase").maybeSingle(),
    supabase.from("departure_slots").select("id, label").order("display_order"),
  ]);

  // 고정(차량순장+고정탑승) 현황 + staleness: 지정됐지만 현재 배정이 지정 호차와
  // 다르면 = 마지막 배차에 미반영 → 재배차 필요. (스키마 변경 없이 배정 비교로 감지)
  const upExpect = new Map<string, number>();
  const downExpect = new Map<string, number>();
  for (const b of busRes.data ?? []) {
    if (b.driver_registration_id) upExpect.set(b.driver_registration_id, b.id);
    for (const id of b.fixed_passenger_ids ?? []) upExpect.set(id, b.id);
    if (b.down_driver_registration_id)
      downExpect.set(b.down_driver_registration_id, b.id);
    for (const id of b.down_fixed_passenger_ids ?? []) downExpect.set(id, b.id);
  }
  const pinnedIds = [...new Set([...upExpect.keys(), ...downExpect.keys()])];
  let upStale = 0;
  let downStale = 0;
  if (pinnedIds.length > 0) {
    const { data: pinned } = await supabase
      .from("registrations")
      .select("id, assigned_up_bus_id, assigned_down_bus_id")
      .in("id", pinnedIds);
    for (const r of pinned ?? []) {
      if (upExpect.has(r.id) && r.assigned_up_bus_id !== upExpect.get(r.id))
        upStale += 1;
      if (downExpect.has(r.id) && r.assigned_down_bus_id !== downExpect.get(r.id))
        downStale += 1;
    }
  }
  const pinStatus = {
    upPins: upExpect.size,
    downPins: downExpect.size,
    upStale,
    downStale,
  };

  const campusName = new Map((campusRes.data ?? []).map((c) => [c.id, c.name]));
  const toUn = (rows: { id: string; name: string; student_id: string; campus_id: string }[]) =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      student_id: r.student_id,
      campus_name: campusName.get(r.campus_id) ?? "—",
    }));

  return (
    <BatchPanel
      upParticipants={upPartRes.count ?? 0}
      upAssigned={upAssignedRes.count ?? 0}
      downParticipants={downPartRes.count ?? 0}
      downAssigned={downAssignedRes.count ?? 0}
      upUnassigned={toUn(upUnRes.data ?? []) as UnassignedRow[]}
      downUnassigned={toUn(downUnRes.data ?? []) as UnassignedRow[]}
      buses={(busRes.data ?? []) as BusOption[]}
      slots={slotRes.data ?? []}
      lastBatchAt={cfgRes.data?.last_batch_at ?? null}
      currentPhase={cfgRes.data?.current_phase ?? "phase1"}
      runs={(runsRes.data ?? []) as BatchRunRow[]}
      pinStatus={pinStatus}
    />
  );
}
