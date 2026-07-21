import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { FleetPanel, type BusLoad } from "@/components/admin/fleet-panel";
import type { TripRow } from "@/lib/admin/trips";
import type { BusRow } from "@/lib/admin/buses";

export const dynamic = "force-dynamic";

/**
 * 편성 — 운행편·차량 자체를 만들고 고치는 화면.
 *
 * `/admin/buses` 와 나누는 기준: 여기는 **무엇이 있는가**(어떤 편이 몇 시에 뜨고
 * 차가 몇 대인가), 거기는 **누가 어디 타는가**(차량순장·고정탑승).
 *
 * 이 화면이 생기기 전에는 차량 생성·삭제 경로와 운행편 편집 경로가 코드에
 * 아예 없었다. create_event 가 지난 행사 편성을 그대로 복제할 뿐이라,
 * 다음 행사에서 대수나 출발 시각을 바꾸려면 DB 를 직접 만져야 했다.
 */
export default async function AdminTripsPage() {
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

  const [tripsRes, busesRes, regsRes] = await Promise.all([
    supabase
      .from("event_trips")
      .select("*")
      .order("direction")
      .order("display_order"),
    supabase.from("buses").select("*").order("display_order").order("id"),
    // 삭제 위험을 화면에서 미리 보여주려고 배정 인원을 센다.
    // (실제 차단은 DB 트리거가 한다 — 화면 검사만 두면 우회된다)
    supabase
      .from("registrations")
      .select("assigned_up_bus_id, assigned_down_bus_id")
      .neq("participation_status", "cancelled"),
  ]);

  const trips = (tripsRes.data ?? []) as TripRow[];
  const buses = (busesRes.data ?? []) as BusRow[];

  const loads: Record<number, BusLoad> = {};
  for (const b of buses) loads[b.id] = { up: 0, down: 0 };
  for (const r of regsRes.data ?? []) {
    if (r.assigned_up_bus_id != null && loads[r.assigned_up_bus_id])
      loads[r.assigned_up_bus_id].up += 1;
    if (r.assigned_down_bus_id != null && loads[r.assigned_down_bus_id])
      loads[r.assigned_down_bus_id].down += 1;
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold">편성</h2>
        <p className="text-sm text-muted-2 mt-1">
          운행편과 차량을 만들고 고칩니다. 상행·하행은 완전히 같은 구조라, 하행도
          출발 시각이 다른 여러 편으로 나눌 수 있습니다.
        </p>
      </header>

      <FleetPanel trips={trips} buses={buses} loads={loads} />
    </div>
  );
}
