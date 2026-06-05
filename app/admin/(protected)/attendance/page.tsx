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
import { AttendanceRate } from "@/components/admin/attendance-rate";

export const dynamic = "force-dynamic";

type BusInfo = { id: number; name: string; departure_slot_id: number };
type SlotMini = Pick<DepartureSlot, "id" | "label">;
type Reg = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
  attendance_type: AttendanceType;
  departure_slot_id: number | null;
  uses_return_bus: boolean;
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
        "id, name, student_id, campus_id, attendance_type, departure_slot_id, uses_return_bus, assigned_up_bus_id, assigned_down_bus_id, checked_in, checked_out"
      )
      .order("name"),
    supabase.from("buses").select("id, name, departure_slot_id").order("id"),
    supabase.from("departure_slots").select("id, label").order("display_order"),
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
  const slotStats = slots.map((s) => ({
    id: s.id,
    label: s.label,
    total: regs.filter((r) => r.departure_slot_id === s.id).length,
    arrived: regs.filter((r) => r.departure_slot_id === s.id && r.checked_in)
      .length,
  }));
  const returnTarget = regs.filter((r) => r.uses_return_bus).length;
  const returned = regs.filter((r) => r.checked_out).length;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-xl font-semibold text-foreground">출석 현황</h2>
        <p className="text-sm text-muted mt-0.5">
          전 캠퍼스 호차별 도착·귀가{" "}
          {isMaster
            ? "· 이름을 탭해 직접 체크 가능"
            : "(보기 전용 — 체크는 임역원·총단)"}
        </p>
      </div>

      <Card title="출석률" subtitle="출발 시간대별 도착 · 하행 귀가">
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          {slotStats.map((ss) => (
            <AttendanceRate
              key={ss.id}
              label={`${ss.label} 도착`}
              done={ss.arrived}
              total={ss.total}
              tone="success"
            />
          ))}
          <AttendanceRate
            label="하행 귀가"
            done={returned}
            total={returnTarget}
            tone="primary"
          />
        </div>
      </Card>

      {upGroups.length === 0 && downGroups.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-muted">아직 배차된 명단이 없습니다.</p>
        </Card>
      ) : (
        <BusAttendance
          upGroups={upGroups}
          downGroups={downGroups}
          buses={buses}
          slots={slots}
          editable={isMaster}
        />
      )}
    </div>
  );
}
