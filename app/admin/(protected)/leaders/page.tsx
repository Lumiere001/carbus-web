import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { ROLE_DRIVER, ROLE_FIXED } from "@/lib/roles/special";
import {
  LeadersPanel,
  type LeaderRow,
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

  const [busRes, campusRes, labelRes, slotRes] = await Promise.all([
    supabase
      .from("buses")
      .select(
        "id, name, up_trip_id, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids"
      )
      .order("id"),
    supabase.from("campuses").select("id, name"),
    supabase.from("role_labels").select("label"),
    supabase.from("event_trips").select("id, label").eq("direction", "up").order("display_order"),
  ]);
  const buses = busRes.data ?? [];
  const campusName = new Map((campusRes.data ?? []).map((c) => [c.id, c.name]));
  // 일반 역할(차량순장/고정 제외) — roles[]에 저장되는 라벨
  const plainLabels = (labelRes.data ?? [])
    .map((l) => l.label)
    .filter((l) => l !== ROLE_DRIVER && l !== ROLE_FIXED);

  // 호차 바인딩 → 차량순장/고정 파생
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
  const boundIds = new Set<string>([
    ...upDriverOf.keys(),
    ...downDriverOf.keys(),
    ...upFixedOf.keys(),
    ...downFixedOf.keys(),
  ]);

  // 리더 = 호차에 묶인 사람(차량순장/고정 파생) ∪ 일반 역할 보유자(총단·간사 등)
  const [boundRes, roleRes] = await Promise.all([
    boundIds.size > 0
      ? supabase
          .from("registrations")
          .select("id, name, student_id, campus_id, departure_slot_id, uses_return_bus, roles")
          // 취소자는 리더 목록에서 제외 (좌석·차량순장은 DB 트리거가 이미 반납했다)
          .neq("participation_status", "cancelled")
          .in("id", [...boundIds])
      : Promise.resolve({ data: [] as never[] }),
    plainLabels.length > 0
      ? supabase
          .from("registrations")
          .select("id, name, student_id, campus_id, departure_slot_id, uses_return_bus, roles")
          .neq("participation_status", "cancelled")
          .overlaps("roles", plainLabels)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      student_id: string;
      campus_id: string;
      departure_slot_id: number | null;
      uses_return_bus: boolean;
      roles: string[];
    }
  >();
  for (const r of [...(boundRes.data ?? []), ...(roleRes.data ?? [])]) byId.set(r.id, r);

  const leaders: LeaderRow[] = [];
  for (const r of byId.values()) {
    const upKind: "driver" | "fixed" | null = upDriverOf.has(r.id)
      ? "driver"
      : upFixedOf.has(r.id)
        ? "fixed"
        : null;
    const downKind: "driver" | "fixed" | null = downDriverOf.has(r.id)
      ? "driver"
      : downFixedOf.has(r.id)
        ? "fixed"
        : null;
    const isDriver = upKind === "driver" || downKind === "driver";
    const isFixed = upKind === "fixed" || downKind === "fixed";
    const plain = (r.roles ?? []).filter((x) => x !== ROLE_DRIVER && x !== ROLE_FIXED);
    const roleBadges = [
      ...plain,
      ...(isDriver ? [ROLE_DRIVER] : []),
      ...(isFixed ? [ROLE_FIXED] : []),
    ];
    if (roleBadges.length === 0) continue;
    // 새 방향 결박 시 사용할 기본 종류 (차량순장 우선)
    const primaryKind: "driver" | "fixed" | null = isDriver ? "driver" : isFixed ? "fixed" : null;
    const ridesUp = r.departure_slot_id !== null;
    const ridesDown = r.uses_return_bus === true;
    const upBusId = upDriverOf.get(r.id) ?? upFixedOf.get(r.id) ?? null;
    const downBusId = downDriverOf.get(r.id) ?? downFixedOf.get(r.id) ?? null;
    leaders.push({
      id: r.id,
      name: r.name,
      student_id: r.student_id,
      campus_name: campusName.get(r.campus_id) ?? "—",
      roleBadges,
      primaryKind,
      departure_slot_id: r.departure_slot_id ?? null,
      ridesUp,
      ridesDown,
      upKind,
      downKind,
      upBusId,
      downBusId,
      needUp: primaryKind != null && ridesUp && upBusId == null,
      needDown: primaryKind != null && ridesDown && downBusId == null,
    });
  }
  leaders.sort((a, b) => {
    const rank = (l: LeaderRow) => (l.primaryKind === "driver" ? 0 : l.primaryKind === "fixed" ? 1 : 2);
    return rank(a) !== rank(b) ? rank(a) - rank(b) : a.name < b.name ? -1 : 1;
  });

  const busOpts: BusOpt[] = buses.map((b) => ({
    id: b.id,
    name: b.name,
    up_trip_id: b.up_trip_id,
  }));

  return (
    <LeadersPanel
      leaders={leaders}
      buses={busOpts}
      slots={slotRes.data ?? []}
      isMaster={isMaster}
    />
  );
}
