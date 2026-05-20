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

  const [regRes, campusRes, busRes, roleRes, cfgRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, attendance_type, departure_day, uses_return_bus, payment_status, roles, assigned_up_bus_id, assigned_down_bus_id, created_at"
      )
      .order("created_at", { ascending: true }),
    supabase.from("campuses").select("id, name, display_order"),
    supabase.from("buses").select("id, name, departure_day").order("id"),
    supabase.from("role_labels").select("label, color").order("display_order"),
    supabase.from("system_config").select("current_phase").maybeSingle(),
  ]);
  // Phase 2(마감)부터는 캠퍼스 그룹 안에서 호차별로 묶어 보여줌 (그 전엔 납부 상태순).
  const phase2 = cfgRes.data?.current_phase === "phase2";

  const campuses = ((campusRes.data ?? []) as CampusInfo[]).sort(
    (a, b) => a.display_order - b.display_order
  );

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
      />
    </div>
  );
}
