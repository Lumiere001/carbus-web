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

  // 취소자는 배차 대상이 아니다 — 엔진(actions.ts)은 이미 빼고 돌린다.
  // 여기서 안 빼면 취소자가 "대상 인원"에 잡히는데, 취소하면 배정이 반납되므로
  // **미배정 목록에 영원히 남는다.** 관리자가 안 가는 사람을 배차하려 하게 된다.
  const notCancelled = <T extends { neq: (c: string, v: string) => unknown }>(q: T) =>
    q.neq("participation_status", "cancelled") as ReturnType<T["neq"]>;
  const reg = () =>
    notCancelled(
      supabase.from("registrations").select("id", { count: "exact", head: true })
    );
  const unassigned = () =>
    notCancelled(
      supabase
        .from("registrations")
        .select("id, name, student_id, campus_id, up_trip_id, down_trip_id")
    );

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
    tripRes,
    assignedRes,
  ] = await Promise.all([
    reg().not("up_trip_id", "is", null),
    reg().not("up_trip_id", "is", null).not("assigned_up_bus_id", "is", null),
    reg().not("down_trip_id", "is", null),
    reg().not("down_trip_id", "is", null).not("assigned_down_bus_id", "is", null),
    unassigned().not("up_trip_id", "is", null).is("assigned_up_bus_id", null).order("name"),
    unassigned().not("down_trip_id", "is", null).is("assigned_down_bus_id", null).order("name"),
    supabase
      .from("buses")
      .select(
        "id, name, up_trip_id, down_trip_id, capacity, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids"
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
    // 하행도 편을 갖는다(3-C) — 상행만 가져오면 하행 호차에 라벨을 못 붙인다.
    supabase.from("event_trips").select("id, label").order("display_order"),
    // 호차별 사용 좌석 — 수동 배정 드롭다운의 잔여석 표시용.
    supabase
      .from("registrations")
      .select("assigned_up_bus_id, assigned_down_bus_id")
      .neq("participation_status", "cancelled"),
  ]);

  const usedUp = new Map<number, number>();
  const usedDown = new Map<number, number>();
  for (const r of assignedRes.data ?? []) {
    if (r.assigned_up_bus_id != null)
      usedUp.set(r.assigned_up_bus_id, (usedUp.get(r.assigned_up_bus_id) ?? 0) + 1);
    if (r.assigned_down_bus_id != null)
      usedDown.set(r.assigned_down_bus_id, (usedDown.get(r.assigned_down_bus_id) ?? 0) + 1);
  }

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
  const toUn = (
    rows: {
      id: string;
      name: string;
      student_id: string;
      campus_id: string;
      up_trip_id: number | null;
      down_trip_id: number | null;
    }[]
  ): UnassignedRow[] =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      student_id: r.student_id,
      campus_name: campusName.get(r.campus_id) ?? "—",
      // 신청한 편 — 드롭다운을 서버 판정과 같은 집합으로 좁히는 데 쓴다.
      up_trip_id: r.up_trip_id,
      down_trip_id: r.down_trip_id,
    }));

  return (
    <BatchPanel
      upParticipants={upPartRes.count ?? 0}
      upAssigned={upAssignedRes.count ?? 0}
      downParticipants={downPartRes.count ?? 0}
      downAssigned={downAssignedRes.count ?? 0}
      upUnassigned={toUn(upUnRes.data ?? [])}
      downUnassigned={toUn(downUnRes.data ?? [])}
      buses={(busRes.data ?? []) as BusOption[]}
      trips={tripRes.data ?? []}
      usedUp={Object.fromEntries(usedUp)}
      usedDown={Object.fromEntries(usedDown)}
      lastBatchAt={cfgRes.data?.last_batch_at ?? null}
      currentPhase={cfgRes.data?.current_phase ?? "phase1"}
      runs={(runsRes.data ?? []) as BatchRunRow[]}
      pinStatus={pinStatus}
    />
  );
}
