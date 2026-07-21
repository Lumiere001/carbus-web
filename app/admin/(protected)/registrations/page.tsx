import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import {
  RegistrationsPanel,
  type AdminRegRow,
  type CampusInfo,
  type BusInfo,
} from "@/components/admin/registrations-panel";

export const dynamic = "force-dynamic";

export default async function AdminRegistrationsPage() {
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

  const [regRes, campusRes, busRes, roleRes, cfgRes, slotRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, attendance_type, up_trip_id, down_trip_id, fee, payment_status, participation_status, cancel_reason, roles, note, assigned_up_bus_id, assigned_down_bus_id, created_at"
      )
      .order("created_at", { ascending: true }),
    supabase.from("campuses").select("id, name, display_order"),
    supabase
      .from("buses")
      .select(
        "id, name, up_trip_id, capacity, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids"
      )
      .order("id"),
    supabase.from("role_labels").select("label, color").order("display_order"),
    supabase.from("system_config").select("current_phase").maybeSingle(),
    supabase.from("event_trips").select("*").order("direction").order("display_order"),
  ]);
  const trips = slotRes.data ?? [];
  // Phase 2(마감)부터는 캠퍼스 그룹 안에서 호차별로 묶어 보여줌 (그 전엔 납부 상태순).
  const phase2 = cfgRes.data?.current_phase === "phase2";

  const campuses = ((campusRes.data ?? []) as CampusInfo[]).sort(
    (a, b) => a.display_order - b.display_order
  );

  // 호차 바인딩에서 차량순장/고정 역할 파생 (상·하행 합집합)
  const driverIds = new Set<string>();
  const fixedIds = new Set<string>();
  for (const b of busRes.data ?? []) {
    if (b.driver_registration_id) driverIds.add(b.driver_registration_id);
    if (b.down_driver_registration_id) driverIds.add(b.down_driver_registration_id);
    for (const id of b.fixed_passenger_ids ?? []) fixedIds.add(id);
    for (const id of b.down_fixed_passenger_ids ?? []) fixedIds.add(id);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">전체 순장/순원</h2>
        <p className="text-sm text-muted mt-0.5">
          캠퍼스별 신청·납부·배차 현황
          {isMaster ? " · 배정 수정·제외 가능" : " (보기 전용)"}
        </p>
      </div>
      <RegistrationsPanel
        rows={(regRes.data ?? []) as AdminRegRow[]}
        campuses={campuses}
        buses={(busRes.data ?? []) as BusInfo[]}
        roleLabels={(roleRes.data ?? []) as { label: string; color: string | null }[]}
        isMaster={isMaster}
        groupByBus={phase2}
        driverIds={driverIds}
        fixedIds={fixedIds}
        trips={trips}
      />
    </div>
  );
}
