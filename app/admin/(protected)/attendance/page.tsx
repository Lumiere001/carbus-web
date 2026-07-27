import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  UserRole,
  AttendanceType,
  DepartureSlot,
} from "@/lib/supabase/types";
import { sortRoster } from "@/lib/registrations/roster-sort";
import { BusAttendance } from "@/components/campus/bus-attendance";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

type BusInfo = { id: number; name: string; up_trip_id: number | null };
type SlotMini = Pick<DepartureSlot, "id" | "label">;
type Reg = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
  attendance_type: AttendanceType;
  up_trip_id: number | null;
  down_trip_id: number | null;
  assigned_up_bus_id: number | null;
  assigned_down_bus_id: number | null;
  checked_in: boolean;
  checked_out: boolean;
};
type Member = {
  id: string;
  name: string;
  student_id: string;
  checked_in: boolean;
  checked_out: boolean;
  campus?: string;
};

/** 호차별 그룹핑 (busId → 명단). 멤버에 캠퍼스 라벨 부여. */
function groupByBus(
  regs: Reg[],
  campusName: Map<string, string>,
  key: (r: Reg) => number | null
): [number, Member[]][] {
  const m = new Map<number, Reg[]>();
  for (const r of regs) {
    const b = key(r);
    if (b == null) continue;
    const list = m.get(b) ?? [];
    list.push(r);
    m.set(b, list);
  }
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([busId, list]) =>
        [
          busId,
          sortRoster(list).map((r) => ({
            id: r.id,
            name: r.name,
            student_id: r.student_id,
            checked_in: r.checked_in,
            checked_out: r.checked_out,
            campus: campusName.get(r.campus_id),
          })),
        ] as [number, Member[]]
    );
}

export default async function AdminAttendancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  const role: UserRole = profile?.role ?? "guest";
  if (role !== "master" && role !== "viewer") {
    redirect(role === "campus_admin" ? "/campus" : "/pending");
  }
  const isMaster = role === "master";

  const [regRes, busRes, slotRes, campusRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, attendance_type, up_trip_id, down_trip_id, assigned_up_bus_id, assigned_down_bus_id, checked_in, checked_out"
      )
      // 취소자는 명단·집계에서 제외한다(좌석 반납은 DB 트리거가 처리).
      .neq("participation_status", "cancelled")
      .order("name"),
    supabase.from("buses").select("id, name, up_trip_id").order("id"),
    supabase.from("event_trips").select("id, label").eq("direction", "up").order("display_order"),
    supabase.from("campuses").select("id, name"),
  ]);

  const buses = (busRes.data ?? []) as BusInfo[];
  const regs = (regRes.data ?? []) as Reg[];
  const slots = (slotRes.data ?? []) as SlotMini[];
  const campusName = new Map(
    ((campusRes.data ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ])
  );

  const upGroups = groupByBus(regs, campusName, (r) => r.assigned_up_bus_id);
  const downGroups = groupByBus(regs, campusName, (r) => r.assigned_down_bus_id);

  // 출석률 집계 — 출발 시간대별 도착 + 하행 귀가
  // 출석률 카드 분모(배차 기준). numerator는 BusAttendance가 state로 라이브 집계.
  // 분자가 배차된 인원만 세므로(미배차자는 명단에 안 뜨고 set_attendance도 거부),
  // 분모도 배차 기준이어야 전원 탑승 시 100%에 도달한다. 간사 차량·불참자는 제외.
  // 슬롯 귀속도 분자(bus-attendance)와 동일하게 "배정된 호차의 슬롯" 기준.
  const busSlot = new Map(buses.map((b) => [b.id, b.up_trip_id]));
  const slotStats = slots.map((s) => ({
    id: s.id,
    label: s.label,
    total: regs.filter(
      (r) =>
        r.assigned_up_bus_id != null &&
        busSlot.get(r.assigned_up_bus_id) === s.id
    ).length,
  }));
  const returnTarget = regs.filter((r) => r.assigned_down_bus_id != null).length;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold text-foreground">출석 현황</h2>
        <p className="text-sm text-muted mt-0.5">
          전 캠퍼스 호차별 출발 버스·귀가{" "}
          {isMaster
            ? "· 이름을 탭해 직접 체크 가능"
            : "(보기 전용 — 체크는 임역원·총단)"}
        </p>
      </div>

      <BusAttendance
        upGroups={upGroups}
        downGroups={downGroups}
        buses={buses}
        slots={slots}
        editable={isMaster}
        summary={{ slots: slotStats, returnTotal: returnTarget }}
      />

      {upGroups.length === 0 && downGroups.length === 0 && (
        <Card className="p-5">
          <p className="text-sm text-muted">
            아직 배차된 명단이 없습니다. (출석률은 배차 기준)
          </p>
        </Card>
      )}
    </div>
  );
}
