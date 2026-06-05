import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import {
  BusesPanel,
  type BusData,
  type PaxData,
  type CandidateData,
} from "@/components/admin/buses-panel";

export const dynamic = "force-dynamic";

export default async function AdminBusesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<{ role: UserRole }>();
  const isMaster = profile?.role === "master";

  const [busRes, regRes, campusRes, slotRes] = await Promise.all([
    supabase
      .from("buses")
      .select(
        "id, name, departure_slot_id, capacity, hard_cap, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids"
      )
      .order("id"),
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, departure_slot_id, uses_return_bus, assigned_up_bus_id, assigned_down_bus_id"
      )
      .order("name"),
    supabase.from("campuses").select("id, name"),
    supabase.from("departure_slots").select("id, label, active, display_order").order("display_order"),
  ]);

  const campusName = new Map(
    (campusRes.data ?? []).map((c) => [c.id, c.name])
  );

  const upByBus = new Map<number, PaxData[]>();
  const downByBus = new Map<number, PaxData[]>();
  // 차량순장·고정탑승 사전 지정용 후보(전체 명단). 호차 카드에서 방향·요일로 필터.
  const candidates: CandidateData[] = [];
  for (const r of regRes.data ?? []) {
    const pax: PaxData = {
      id: r.id,
      name: r.name,
      student_id: r.student_id,
      campus_name: campusName.get(r.campus_id) ?? "—",
    };
    candidates.push({
      ...pax,
      departure_slot_id: r.departure_slot_id,
      uses_return_bus: r.uses_return_bus,
    });
    if (r.assigned_up_bus_id != null) {
      const list = upByBus.get(r.assigned_up_bus_id) ?? [];
      list.push(pax);
      upByBus.set(r.assigned_up_bus_id, list);
    }
    if (r.assigned_down_bus_id != null) {
      const list = downByBus.get(r.assigned_down_bus_id) ?? [];
      list.push(pax);
      downByBus.set(r.assigned_down_bus_id, list);
    }
  }

  const buses: BusData[] = (busRes.data ?? []).map((b) => ({
    ...b,
    passengers: upByBus.get(b.id) ?? [],
    downPassengers: downByBus.get(b.id) ?? [],
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">호차 배차 현황</h2>
        <p className="text-sm text-muted mt-0.5">
          {buses.length}대 · 상행/하행 명단{isMaster ? " · 차량순장·고정 탑승자 지정(상행·하행 각각)" : " (보기 전용)"}
        </p>
      </div>
      <BusesPanel buses={buses} candidates={candidates} slots={slotRes.data ?? []} isMaster={isMaster} />
    </div>
  );
}
