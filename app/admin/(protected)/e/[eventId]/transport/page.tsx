import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { TransportPanel, type LegRow } from "@/components/admin/transport-panel";
import type { TransportMode } from "@/lib/transport/labels";

export const dynamic = "force-dynamic";

/**
 * 외부수단 확정 관리 (§11-C 의 E).
 *
 * `/admin/registrations` 와 나누는 기준: 거기는 **한 사람**을 고치는 화면이고,
 * 여기는 **확정을 기다리는 것들 전체**를 지구 단위로 처리하는 화면이다.
 * 확정 연락은 사람이 아니라 지구 담당자에게 한 번에 하게 되므로 묶는 축이 다르다.
 *
 * 데이터는 이미 `transport_legs` 에 다 있다(3단계). 없던 건 그걸 모아 보여주고
 * 한 번에 확정하는 자리뿐이었다.
 */
export default async function AdminTransportPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<{ role: UserRole }>();
  const role: UserRole = profile?.role ?? "guest";
  if (role !== "master" && role !== "viewer") redirect("/admin");

  const [legsRes, tripsRes, busesRes] = await Promise.all([
    // RLS 의 event_scope 가 "지금 보는 행사"로 이미 좁힌다 — 여기서 또 거르지 않는다.
    // 두 곳에서 거르면 한쪽만 고쳤을 때 조용히 어긋난다.
    supabase
      .from("v_transport_legs_detail")
      .select("*")
      .order("created_at", { ascending: true }),
    supabase.from("event_trips").select("id, label"),
    supabase.from("buses").select("id, name"),
  ]);

  const tripLabel = new Map((tripsRes.data ?? []).map((t) => [t.id, t.label]));
  const busLabel = new Map((busesRes.data ?? []).map((b) => [b.id, b.name]));

  const toRow = (l: NonNullable<typeof legsRes.data>[number]): LegRow => ({
    id: l.id ?? 0,
    registrationId: l.registration_id ?? "",
    personName: l.person_name ?? "—",
    campusName: l.campus_name ?? "—",
    direction: l.direction === "down" ? "down" : "up",
    mode: (l.mode ?? "other") as TransportMode,
    status: l.status ?? "confirmed",
    viaUnitName: l.via_unit_name,
    note: l.note,
    daysWaiting: l.days_waiting ?? 0,
    heldTripLabel:
      l.held_trip_id != null ? tripLabel.get(l.held_trip_id) ?? `${l.held_trip_id}번 편` : null,
    heldBusLabel:
      l.held_bus_id != null ? busLabel.get(l.held_bus_id) ?? `${l.held_bus_id}호차` : null,
  });

  // 취소된 사람은 확정할 것도 없다 — 좌석은 취소 처리에서 이미 반납된다.
  const legs = (legsRes.data ?? []).filter(
    (l) => l.participation_status !== "cancelled"
  );

  const pending = legs
    .filter((l) => l.status === "pending" && l.mode === "other_district")
    .map(toRow);

  // 확정인데 아직 좌석을 잡고 있는 것 — 확정을 먼저 등록하고 나중에 편을 지정하면
  // 생긴다. 트리거는 편 지정을 막지 않는다(막으면 "화면 선택지 ⊋ 서버 허용 집합"
  // 결함이 또 나온다 — 편 드롭다운은 이동수단을 모른다). 그래서 여기서 보여준다.
  const confirmedHolding = legs
    .filter(
      (l) =>
        l.status === "confirmed" &&
        l.mode === "other_district" &&
        (l.held_trip_id != null || l.held_bus_id != null)
    )
    .map(toRow);

  // 우리 버스가 아닌 나머지(KTX·고속버스 · 자차·가족차 · 기타) — **명단까지** 넘긴다.
  //
  // 예전엔 "KTX·고속버스 3건" 처럼 숫자만 보여줬다. 그런데 운영에서 필요한 건
  // **누가** 자차로 오는지다 — 그 사람은 우리가 안 태우니 출발 인원에서 빠지고,
  // 도착 시각도 따로 물어야 한다. 숫자만 보면 그다음에 할 수 있는 게 없다.
  const otherRows = legs
    .filter((l) => l.mode != null && l.mode !== "other_district" && l.mode !== "our_bus")
    .map(toRow);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">이동수단 확정</h2>
        <p className="text-sm text-muted mt-0.5">
          타지구 차량을 얻어 타기로 한 사람들은 확정이 날 때까지 우리 버스 좌석을 잡아둡니다.
          확정되면 여기서 눌러 <b>자리를 놓아 주세요</b> — 그 방향의 편과 배정 호차가 함께 비워집니다.
        </p>
      </div>

      <TransportPanel
        pending={pending}
        confirmedHolding={confirmedHolding}
        otherRows={otherRows}
        canConfirm={role === "master"}
      />
    </div>
  );
}
