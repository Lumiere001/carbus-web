import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { FleetPanel, type BusLoad } from "@/components/admin/fleet-panel";
import type { TripRow } from "@/lib/admin/trips";
import type { BusRow } from "@/lib/admin/buses";
import { PickupPlacesPanel } from "@/components/admin/pickup-places-panel";
import type { PlaceRow } from "@/lib/admin/pickup";

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

  const [tripsRes, busesRes, regsRes, placesRes] = await Promise.all([
    supabase
      .from("event_trips")
      .select("*")
      .order("direction")
      .order("display_order"),
    supabase.from("buses").select("*").order("display_order").order("id"),
    // 삭제·변경 위험을 화면에서 미리 보여주려고 배정 상태를 읽는다.
    // (실제 차단은 DB 트리거가 한다 — 화면 검사만 두면 우회된다.
    //  화면은 "무엇이 막히는지 미리 알려주는" 역할만 한다)
    supabase
      .from("registrations")
      .select("assigned_up_bus_id, assigned_down_bus_id, up_trip_id, down_trip_id")
      .neq("participation_status", "cancelled"),
    // 픽업 장소도 행사마다 새로 정하는 것이라 편성 화면이 자리다.
    supabase
      .from("pickup_places")
      .select("id, name, note, display_order, active")
      .order("display_order")
      .order("name"),
  ]);

  const trips = (tripsRes.data ?? []) as TripRow[];
  const buses = (busesRes.data ?? []) as BusRow[];

  const loads: Record<number, BusLoad> = {};
  // 차량에 배정된 사람들이 **신청한 편**의 집합 (방향별).
  // DB 가드가 "바꾼 뒤 신청 편과 어긋나는 인원"을 세므로, 화면도 같은 술어를 쓰려면
  // 단순 인원수가 아니라 이 집합이 필요하다.
  // 3-C 로 하행도 신청 편을 갖게 됐고 DB 가드(guard_bus_trip_change)도 하행을 검사한다.
  // 여기서 하행 집합을 안 만들면 화면만 느슨해져, 저장 눌렀을 때 서버가 거절한다.
  const upRequests: Record<number, number[]> = {};
  const downRequests: Record<number, number[]> = {};
  for (const b of buses) {
    loads[b.id] = { up: 0, down: 0 };
    upRequests[b.id] = [];
    downRequests[b.id] = [];
  }
  const seenUp: Record<number, Set<number>> = {};
  const seenDown: Record<number, Set<number>> = {};
  for (const r of regsRes.data ?? []) {
    const up = r.assigned_up_bus_id;
    if (up != null && loads[up]) {
      loads[up].up += 1;
      if (r.up_trip_id != null) (seenUp[up] ??= new Set()).add(r.up_trip_id);
    }
    const down = r.assigned_down_bus_id;
    if (down != null && loads[down]) {
      loads[down].down += 1;
      if (r.down_trip_id != null) (seenDown[down] ??= new Set()).add(r.down_trip_id);
    }
  }
  for (const [busId, set] of Object.entries(seenUp)) {
    upRequests[Number(busId)] = [...set];
  }
  for (const [busId, set] of Object.entries(seenDown)) {
    downRequests[Number(busId)] = [...set];
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold">편성</h2>
        <p className="text-sm text-muted-2 mt-1">
          운행편과 차량을 만들고 고칩니다. 차량은 상·하행 편을 각각 갖습니다.
          <br />
          하행도 상행과 똑같이 여러 편으로 나눌 수 있습니다 — 신청 화면에서 학우가
          상행·하행 편을 각각 고르고, 배차도 편별로 나눠 돌립니다. 이미 배정된 인원이
          있는 차량은 그 사람들이 신청한 편으로만 옮길 수 있습니다(먼저 재배차).
          <br />
          <b>간사 차량</b>은 맨 아래 <b>차량</b> 카드에서 종류를 “간사 차량”으로 놓고
          추가합니다. 자동 배차에서 빠지고, 탈 사람은 <b>리더</b> 화면에서 고정
          탑승자로 지정합니다.
        </p>
      </header>

      {/* 픽업 장소를 운행편·차량보다 **위**에 둔다. 총단이 행사를 처음 세팅할 때
          이걸 먼저 해야 임역원이 수송 요청에서 장소를 고를 수 있는데, 맨 아래에
          두면 운행편 4개와 차량 11대를 다 지나야 나온다. */}
      <PickupPlacesPanel
        places={(placesRes.data ?? []).map((p): PlaceRow => ({
          id: p.id,
          name: p.name,
          note: p.note,
          displayOrder: p.display_order,
          active: p.active,
        }))}
      />

      <FleetPanel
        trips={trips}
        buses={buses}
        loads={loads}
        upRequests={upRequests}
        downRequests={downRequests}
      />
    </div>
  );
}
