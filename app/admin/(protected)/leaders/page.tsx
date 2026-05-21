import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { ROLE_DRIVER, ROLE_FIXED } from "@/lib/roles/special";
import {
  LeadersPanel,
  type LeaderRow,
  type MismatchRow,
  type BusOpt,
} from "@/components/admin/leaders-panel";

export const dynamic = "force-dynamic";

export default async function AdminLeadersPage() {
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

  const [busRes, campusRes] = await Promise.all([
    supabase
      .from("buses")
      .select(
        "id, name, departure_day, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids"
      )
      .order("id"),
    supabase.from("campuses").select("id, name"),
  ]);
  const buses = busRes.data ?? [];
  const campusName = new Map((campusRes.data ?? []).map((c) => [c.id, c.name]));

  // 호차에 묶인 사람들(불일치 감지용) + 특수 역할자 합집합
  const boundIds = new Set<string>();
  for (const b of buses) {
    if (b.driver_registration_id) boundIds.add(b.driver_registration_id);
    if (b.down_driver_registration_id) boundIds.add(b.down_driver_registration_id);
    for (const id of b.fixed_passenger_ids ?? []) boundIds.add(id);
    for (const id of b.down_fixed_passenger_ids ?? []) boundIds.add(id);
  }

  const [roleRes, boundRes] = await Promise.all([
    supabase
      .from("registrations")
      .select("id, name, student_id, campus_id, departure_day, uses_return_bus, roles")
      .overlaps("roles", [ROLE_DRIVER, ROLE_FIXED]),
    boundIds.size > 0
      ? supabase
          .from("registrations")
          .select("id, name, student_id, campus_id, departure_day, uses_return_bus, roles")
          .in("id", [...boundIds])
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      student_id: string;
      campus_id: string;
      departure_day: string | null;
      uses_return_bus: boolean;
      roles: string[];
    }
  >();
  for (const r of [...(roleRes.data ?? []), ...(boundRes.data ?? [])]) byId.set(r.id, r);

  // 현재 호차 바인딩 조회 헬퍼
  const upDriverOf = new Map<string, number>();
  const downDriverOf = new Map<string, number>();
  const upFixedOf = new Map<string, number>();
  const downFixedOf = new Map<string, number>();
  for (const b of buses) {
    if (b.driver_registration_id) upDriverOf.set(b.driver_registration_id, b.id);
    if (b.down_driver_registration_id) downDriverOf.set(b.down_driver_registration_id, b.id);
    for (const id of b.fixed_passenger_ids ?? []) upFixedOf.set(id, b.id);
    for (const id of b.down_fixed_passenger_ids ?? []) downFixedOf.set(id, b.id);
  }

  const leaders: LeaderRow[] = [];
  for (const r of roleRes.data ?? []) {
    const roles = r.roles ?? [];
    const isDriver = roles.includes(ROLE_DRIVER);
    const kind: "driver" | "fixed" = isDriver ? "driver" : "fixed";
    const ridesUp = r.departure_day !== null;
    const ridesDown = r.uses_return_bus === true;
    const upBus = isDriver ? upDriverOf.get(r.id) : upFixedOf.get(r.id);
    const downBus = isDriver ? downDriverOf.get(r.id) : downFixedOf.get(r.id);
    leaders.push({
      id: r.id,
      name: r.name,
      student_id: r.student_id,
      campus_name: campusName.get(r.campus_id) ?? "—",
      kind,
      departure_day: (r.departure_day as "TUE" | "WED" | null) ?? null,
      ridesUp,
      ridesDown,
      upBusId: upBus ?? null,
      downBusId: downBus ?? null,
      needUp: ridesUp && upBus == null,
      needDown: ridesDown && downBus == null,
    });
  }
  leaders.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === "driver" ? -1 : 1) : a.name < b.name ? -1 : 1
  );

  // 불일치: 호차에 묶였지만 해당 역할이 없는 사람
  const mismatches: MismatchRow[] = [];
  const pushMismatch = (id: string, busId: number, label: string, roleNeeded: string) => {
    const r = byId.get(id);
    if (!r) return;
    if (!(r.roles ?? []).includes(roleNeeded))
      mismatches.push({
        id,
        name: r.name,
        campus_name: campusName.get(r.campus_id) ?? "—",
        detail: `${busName(buses, busId)} ${label} — '${roleNeeded}' 역할 없음`,
      });
  };
  for (const b of buses) {
    if (b.driver_registration_id) pushMismatch(b.driver_registration_id, b.id, "상행 차량순장", ROLE_DRIVER);
    if (b.down_driver_registration_id) pushMismatch(b.down_driver_registration_id, b.id, "하행 차량순장", ROLE_DRIVER);
    for (const id of b.fixed_passenger_ids ?? []) pushMismatch(id, b.id, "상행 고정", ROLE_FIXED);
    for (const id of b.down_fixed_passenger_ids ?? []) pushMismatch(id, b.id, "하행 고정", ROLE_FIXED);
  }

  const busOpts: BusOpt[] = buses.map((b) => ({
    id: b.id,
    name: b.name,
    departure_day: b.departure_day,
  }));

  return (
    <LeadersPanel
      leaders={leaders}
      mismatches={mismatches}
      buses={busOpts}
      isMaster={isMaster}
    />
  );
}

function busName(buses: { id: number; name: string }[], id: number): string {
  return buses.find((b) => b.id === id)?.name ?? `${id}호차`;
}
