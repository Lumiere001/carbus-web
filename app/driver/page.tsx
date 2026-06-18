import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sortRoster } from "@/lib/registrations/roster-sort";
import { BusAttendance } from "@/components/campus/bus-attendance";
import { Card } from "@/components/ui/card";
import type { DepartureSlot } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type BusInfo = { id: number; name: string; departure_slot_id: number };
type SlotMini = Pick<DepartureSlot, "id" | "label">;
type Reg = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
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

export default async function DriverPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("driver_bus_id")
    .eq("id", user.id)
    .single<{ driver_bus_id: number | null }>();
  const busId = profile?.driver_bus_id ?? null;
  if (busId == null) redirect("/pending");

  const [regRes, busRes, slotRes, campusRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, assigned_up_bus_id, assigned_down_bus_id, checked_in, checked_out"
      )
      .or(`assigned_up_bus_id.eq.${busId},assigned_down_bus_id.eq.${busId}`)
      .order("name"),
    supabase.from("buses").select("id, name, departure_slot_id").order("id"),
    supabase.from("departure_slots").select("id, label").order("display_order"),
    supabase.from("campuses").select("id, name"),
  ]);

  const regs = (regRes.data ?? []) as Reg[];
  const buses = (busRes.data ?? []) as BusInfo[];
  const slots = (slotRes.data ?? []) as SlotMini[];
  const campusName = new Map(
    ((campusRes.data ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ])
  );
  const myBus = buses.find((b) => b.id === busId);

  const toMembers = (list: Reg[]): Member[] =>
    sortRoster(list).map((r) => ({
      id: r.id,
      name: r.name,
      student_id: r.student_id,
      checked_in: r.checked_in,
      checked_out: r.checked_out,
      campus: campusName.get(r.campus_id),
    }));

  const upMembers = toMembers(regs.filter((r) => r.assigned_up_bus_id === busId));
  const downMembers = toMembers(
    regs.filter((r) => r.assigned_down_bus_id === busId)
  );
  const upGroups: [number, Member[]][] = upMembers.length
    ? [[busId, upMembers]]
    : [];
  const downGroups: [number, Member[]][] = downMembers.length
    ? [[busId, downMembers]]
    : [];

  const slotStats = slots
    .filter((s) => myBus?.departure_slot_id === s.id)
    .map((s) => ({ id: s.id, label: s.label, total: upMembers.length }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          {myBus?.name ?? `${busId}호차`} 출석체크
        </h2>
        <p className="text-sm text-muted mt-0.5">
          이름을 탭하면 출발 버스(상행)·귀가(하행) 체크가 됩니다. 본인 호차 명단만
          보입니다.
        </p>
      </div>

      {upGroups.length === 0 && downGroups.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-muted">
            아직 이 호차에 배차된 명단이 없습니다. (배차 후 표시)
          </p>
        </Card>
      ) : (
        <BusAttendance
          upGroups={upGroups}
          downGroups={downGroups}
          buses={buses}
          slots={slots}
          editable
          summary={{ slots: slotStats, returnTotal: downMembers.length }}
        />
      )}
    </div>
  );
}
