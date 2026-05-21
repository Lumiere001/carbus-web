import { redirect } from "next/navigation";
import { Bus, ArrowUp, ArrowDown, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DAY_LABELS } from "@/lib/labels";
import type { DepartureDay, AttendanceType } from "@/lib/supabase/types";
import { sortRoster } from "@/lib/registrations/roster-sort";

export const dynamic = "force-dynamic";

type BusInfo = { id: number; name: string; departure_day: DepartureDay };
type Reg = {
  id: string;
  name: string;
  student_id: string;
  attendance_type: AttendanceType;
  departure_day: DepartureDay | null;
  uses_return_bus: boolean;
  assigned_up_bus_id: number | null;
  assigned_down_bus_id: number | null;
};

/** 호차별 그룹핑 (busId → 명단). */
function groupBy(regs: Reg[], key: (r: Reg) => number | null) {
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
    .map(([busId, members]) => [busId, sortRoster(members)] as [number, Reg[]]);
}

function BusGroups({
  groups,
  busName,
  accent,
}: {
  groups: [number, Reg[]][];
  busName: Map<number, BusInfo>;
  accent: "up" | "down";
}) {
  return (
    <div className="space-y-3">
      {groups.map(([busId, members]) => {
        const info = busName.get(busId);
        return (
          <Card key={busId}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <span className="flex items-center gap-2 font-semibold text-foreground">
                <Bus size={18} className="text-primary-700" />
                {info?.name ?? `${busId}호차`}
                {accent === "up" && info && (
                  <span className="text-xs font-normal text-muted-2">
                    {DAY_LABELS[info.departure_day]} 출발
                  </span>
                )}
                {accent === "down" && (
                  <span className="text-xs font-normal text-muted-2">
                    토요일 하행
                  </span>
                )}
              </span>
              <Badge variant="primary" dot={false}>
                {members.length}명
              </Badge>
            </div>
            <ul className="divide-y divide-border">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between px-5 py-2.5"
                >
                  <span className="text-base text-foreground">{m.name}</span>
                  <span className="text-xs text-muted-2">{m.student_id}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

export default async function CampusBusesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("campus_id")
    .eq("id", user.id)
    .single();
  const campusId = profile?.campus_id;
  if (!campusId) redirect("/pending");

  const [regRes, busRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, attendance_type, departure_day, uses_return_bus, assigned_up_bus_id, assigned_down_bus_id"
      )
      .eq("campus_id", campusId)
      .order("name"),
    supabase.from("buses").select("id, name, departure_day").order("id"),
  ]);

  const buses = (busRes.data ?? []) as BusInfo[];
  const regs = (regRes.data ?? []) as Reg[];
  const busName = new Map(buses.map((b) => [b.id, b]));

  const upGroups = groupBy(regs, (r) => r.assigned_up_bus_id);
  const downGroups = groupBy(regs, (r) => r.assigned_down_bus_id);

  // 배차 대기: 상행 필요(departure_day 있음)인데 미배정 / 하행 필요(uses_return_bus)인데 미배정
  const waiting = regs
    .map((r) => {
      const upPending = r.departure_day !== null && r.assigned_up_bus_id == null;
      const downPending = r.uses_return_bus && r.assigned_down_bus_id == null;
      return { r, upPending, downPending };
    })
    .filter((w) => w.upPending || w.downPending);

  const nothing =
    upGroups.length === 0 && downGroups.length === 0 && waiting.length === 0;

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <h2 className="text-lg font-semibold text-foreground">호차 조회</h2>
        <p className="text-sm text-muted mt-0.5">
          우리 캠퍼스 순장/순원의 상행·하행 배차 결과
        </p>
      </div>

      {nothing && (
        <Card className="p-5">
          <p className="text-sm text-muted">
            아직 등록된 순장/순원이 없거나 배차 전입니다.
          </p>
        </Card>
      )}

      {/* 상행 명단 */}
      {upGroups.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <ArrowUp size={15} className="text-primary-700" /> 상행 명단 (올라갈 때)
          </h3>
          <BusGroups groups={upGroups} busName={busName} accent="up" />
        </section>
      )}

      {/* 하행 명단 */}
      {downGroups.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <ArrowDown size={15} className="text-primary-700" /> 하행 명단 (내려올 때)
          </h3>
          <BusGroups groups={downGroups} busName={busName} accent="down" />
        </section>
      )}

      {/* 배차 대기 */}
      {waiting.length > 0 && (
        <section className="space-y-3">
          <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted">
            <Clock size={15} className="text-warning" /> 배차 대기 ({waiting.length}명)
          </h3>
          <Card>
            <ul className="divide-y divide-border">
              {waiting.map(({ r, upPending, downPending }) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between px-5 py-2.5"
                >
                  <span className="text-base text-foreground">{r.name}</span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-2">
                    <span>{r.student_id}</span>
                    {upPending && (
                      <Badge variant="warning" dot={false}>상행 대기</Badge>
                    )}
                    {downPending && (
                      <Badge variant="warning" dot={false}>하행 대기</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
