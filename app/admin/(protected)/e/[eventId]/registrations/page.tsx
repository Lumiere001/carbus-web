import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
// buses 는 캐스트 없이 그대로 넘긴다 — select 문에서 컬럼이 빠지면 tsc 가 잡게 하려는 것.
// `as BusInfo[]` 로 감싸면 그 검사가 통째로 무력화된다 (bus-options.ts 주석의 사고 참고).
import {
  RegistrationsPanel,
  type AdminRegRow,
  type CampusInfo,
} from "@/components/admin/registrations-panel";
import type { PickupRow } from "@/components/admin/reg-drawer";

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

  const [regRes, campusRes, busRes, roleRes, cfgRes, slotRes, unitRes, legRes, pickupRes] =
    await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, attendance_type, up_trip_id, down_trip_id, fee, payment_status, participation_status, cancel_reason, roles, note, assigned_up_bus_id, assigned_down_bus_id, attend_from, attend_to, created_at"
      )
      .order("created_at", { ascending: true }),
    supabase.from("campuses").select("id, name, display_order"),
    supabase
      .from("buses")
      .select(
        "id, name, up_trip_id, down_trip_id, capacity, driver_registration_id, fixed_passenger_ids, down_driver_registration_id, down_fixed_passenger_ids"
      )
      .order("id"),
    supabase.from("role_labels").select("label, color").order("display_order"),
    supabase.from("system_config").select("current_phase").maybeSingle(),
    supabase.from("event_trips").select("*").order("direction").order("display_order"),
    // 타지구 차량일 때 고를 지구 목록.
    // 새로 고를 수 있는 소속만(내린 것 제외). 과거 데이터가 가리키는 옛 이름은
    // 아래 unitName 에서 따로 읽어 **표시에는 계속 쓴다** — 과거는 과거대로 남긴다.
    supabase
      .from("org_units")
      .select("id, name, retired_at")
      .order("display_order"),
    // 방향별 이동수단 — 명단에 배지로 띄우고, 수정 폼의 초기값이 된다.
    supabase
      .from("transport_legs")
      .select("registration_id, direction, mode, status, via_unit_id"),
    // 수송 요청 — 서랍에서 사람별로 넣고 지운다. 보드(부분참 화면)는 이걸 묶어 읽는다.
    supabase
      .from("pickup_requests")
      .select("id, registration_id, direction, pickup_at, place, note")
      .order("pickup_at", { ascending: true, nullsFirst: true }),
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

  const allUnits = unitRes.data ?? [];
  // 표시는 전부(옛 이름 포함), 선택지는 안 내린 것만.
  const unitName = new Map(allUnits.map((u) => [u.id, u.name]));
  const units = allUnits
    .filter((u) => u.retired_at === null)
    .map((u) => ({ id: u.id, name: u.name }));
  // 사람 → 방향별 이동수단. 없으면 우리 버스(기본값)라 행을 안 만든다.
  const legs = new Map<
    string,
    { mode: string; status: string; via: string | null }
  >();
  for (const l of legRes.data ?? []) {
    legs.set(`${l.registration_id}:${l.direction}`, {
      mode: l.mode,
      status: l.status,
      via: l.via_unit_id ? unitName.get(l.via_unit_id) ?? null : null,
    });
  }
  const pendingCount = (legRes.data ?? []).filter((l) => l.status === "pending").length;

  // 사람 → 수송 요청들. 한 사람이 여러 건일 수 있다(중간 합류·중간 이탈).
  const pickups: Record<string, PickupRow[]> = {};
  for (const p of pickupRes.data ?? []) {
    (pickups[p.registration_id] ??= []).push({
      id: p.id,
      direction: p.direction === "down" ? "down" : "up",
      pickupAt: p.pickup_at,
      place: p.place,
      note: p.note,
    });
  }
  // 같은 행사에서 이미 쓰인 장소 = 자동완성 후보. **장소 마스터 테이블을 두지 않는다**
  // (동규님 지시 — 픽업 장소는 행사마다 달라진다). 쓰인 값을 모으면 표기가 통일된다.
  const places = [
    ...new Set((pickupRes.data ?? []).map((p) => p.place).filter((x): x is string => !!x)),
  ].sort();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">전체 순장/순원</h2>
        <p className="text-sm text-muted mt-0.5">
          캠퍼스별 신청·납부·배차 현황
          {isMaster ? " · 배정 수정·제외 가능" : " (보기 전용)"}
        </p>
        {pendingCount > 0 && (
          <p className="text-sm text-warning mt-1">
            타지구 차량 <b>확정 대기 {pendingCount}건</b> — 그동안 우리 버스 좌석을
            잡아두고 있습니다. <b>이동수단</b> 화면에서 확정하면 자리가 자동으로 반납됩니다.
          </p>
        )}
      </div>
      <RegistrationsPanel
        rows={(regRes.data ?? []) as AdminRegRow[]}
        campuses={campuses}
        buses={busRes.data ?? []}
        roleLabels={(roleRes.data ?? []) as { label: string; color: string | null }[]}
        isMaster={isMaster}
        groupByBus={phase2}
        driverIds={driverIds}
        fixedIds={fixedIds}
        trips={trips}
        units={units}
        legs={Object.fromEntries(legs)}
        pickups={pickups}
        places={places}
      />
    </div>
  );
}
