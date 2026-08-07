import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RegistrationGrid } from "@/components/campus/registration-grid";
import type { PickupRow } from "@/components/admin/reg-drawer";
import { eventDayCount } from "@/lib/courses/days";

export default async function CampusPage() {
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

  const [regRes, campusRes, busRes, slotRes, legRes, unitRes, pickupRes, placeRes, courseRes, eventRes] =
    await Promise.all([
    supabase
      .from("registrations")
      .select("*")
      // 취소자는 명단·집계에서 제외한다(좌석 반납은 DB 트리거가 처리).
      .neq("participation_status", "cancelled")
      .eq("campus_id", campusId)
      .order("created_at", { ascending: true }),
    supabase.from("campuses").select("name").eq("id", campusId).single(),
    supabase.from("buses").select("id, name").order("id"),
    supabase.from("event_trips").select("*").order("direction").order("display_order"),
    // 아래 넷은 편집 서랍용이다. 임역원도 자기 캠퍼스 사람의 이동수단·참여기간·수송
    // 요청을 직접 넣을 수 있어야 한다 — 지금까지는 권한(RLS)만 열려 있고 화면이 없어
    // 총단 혼자 599명분을 다 넣어야 했다.
    supabase
      .from("transport_legs")
      .select("registration_id, direction, mode, status, via_unit_id"),
    supabase
      .from("org_units")
      .select("id, name, retired_at")
      .order("display_order"),
    supabase
      .from("pickup_requests")
      .select("id, registration_id, direction, pickup_at, note, pickup_places(name)")
      .order("pickup_at", { ascending: true, nullsFirst: true }),
    supabase
      .from("pickup_places")
      .select("id, name")
      .eq("active", true)
      .order("display_order")
      .order("name"),
    // 수강신청 — 임역원도 자기 캠퍼스 사람 것을 서랍에서 켜고 끈다(RLS 가 범위를 좁힌다).
    supabase.from("course_signups").select("registration_id, day_no, at_time"),
    // 고를 수 있는 날 수 계산용. **날짜를 저장하지는 않는다.**
    supabase.from("events").select("starts_on, ends_on").eq("is_active", true).maybeSingle(),
  ]);

  const allUnits = unitRes.data ?? [];
  const unitName = new Map(allUnits.map((u) => [u.id, u.name]));
  const legs: Record<string, { mode: string; status: string; via: string | null }> = {};
  for (const l of legRes.data ?? []) {
    legs[`${l.registration_id}:${l.direction}`] = {
      mode: l.mode,
      status: l.status,
      via: l.via_unit_id ? unitName.get(l.via_unit_id) ?? null : null,
    };
  }
  const pickups: Record<string, PickupRow[]> = {};
  for (const p of pickupRes.data ?? []) {
    (pickups[p.registration_id] ??= []).push({
      id: p.id,
      direction: p.direction === "down" ? "down" : "up",
      pickupAt: p.pickup_at,
      placeName: p.pickup_places?.name ?? null,
      note: p.note,
    });
  }

  // 사람 → 수강신청. **날짜가 아니라 몇째 날**이다 — 행사 날짜는 해마다 바뀐다.
  const courses: Record<string, { dayNo: number; atTime: string | null }[]> = {};
  for (const c of courseRes.data ?? []) {
    (courses[c.registration_id] ??= []).push({ dayNo: c.day_no, atTime: c.at_time });
  }
  const dayCount = eventDayCount(
    eventRes.data?.starts_on ?? null,
    eventRes.data?.ends_on ?? null
  );

  return (
    <RegistrationGrid
      campusId={campusId}
      campusName={campusRes.data?.name ?? "내"}
      initialRows={regRes.data ?? []}
      buses={busRes.data ?? []}
      trips={slotRes.data ?? []}
      legs={legs}
      units={allUnits.filter((u) => u.retired_at === null).map((u) => ({ id: u.id, name: u.name }))}
      pickups={pickups}
      places={placeRes.data ?? []}
      courses={courses}
      dayCount={dayCount}
    />
  );
}
