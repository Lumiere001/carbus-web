import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import type { PickupRow } from "@/components/admin/reg-drawer";
import type { LegValue } from "@/components/admin/transport-picker";
import { eventDayCount } from "@/lib/courses/days";
import { isPartialRegistration } from "@/lib/registrations/view";
import { needsAttendancePlan } from "@/lib/registrations/attendance-plan";

/** 두 부분 참석 화면은 같은 신청과 부가 정보를 읽고, 쓰기는 기존 편집기를 사용한다. */
export async function loadPartialEditorData(supabase: SupabaseClient<Database>, eventId: string, campusId?: string) {
  let registrations = supabase.from("registrations").select("*").eq("event_id", eventId).neq("participation_status", "cancelled").order("name");
  if (campusId) registrations = registrations.eq("campus_id", campusId);
  const [reg, campus, trip, leg, unit, pickup, place, course, event, writable] = await Promise.all([
    registrations, supabase.from("campuses").select("id,name,display_order"),
    supabase.from("event_trips").select("*").eq("event_id", eventId).order("direction").order("display_order"),
    supabase.from("transport_legs").select("registration_id,direction,mode,status,via_unit_id").eq("event_id", eventId),
    supabase.from("org_units").select("id,name,retired_at").order("display_order"),
    supabase.from("pickup_requests").select("id,registration_id,direction,pickup_at,note,pickup_places(name)").eq("event_id", eventId).order("pickup_at", { nullsFirst: true }),
    supabase.from("pickup_places").select("id,name").eq("event_id", eventId).eq("active", true).order("display_order"),
    supabase.from("course_signups").select("registration_id,day_no,at_time").eq("event_id", eventId),
    supabase.from("events").select("starts_on,ends_on").eq("id", eventId).single(),
    supabase.rpc("is_event_writable", { p_event: eventId }),
  ]);
  if ([reg,campus,trip,leg,unit,pickup,place,course,event,writable].some((result) => result.error)) return { ok: false } as const;
  const campuses = campus.data ?? [];
  const unitNames = new Map((unit.data ?? []).map((item) => [item.id, item.name]));
  const legs: Record<string, LegValue> = {};
  for (const item of leg.data ?? []) legs[`${item.registration_id}:${item.direction}`] = {
    mode: item.mode, status: item.status, viaUnitId: item.via_unit_id,
  };
  const pickups: Record<string, PickupRow[]> = {};
  for (const item of pickup.data ?? []) (pickups[item.registration_id] ??= []).push({
    id: item.id, direction: item.direction === "down" ? "down" : "up", pickupAt: item.pickup_at, note: item.note, placeName: item.pickup_places?.name ?? null,
  });
  const courses: Record<string, { dayNo: number; atTime: string | null }[]> = {};
  for (const item of course.data ?? []) (courses[item.registration_id] ??= []).push({ dayNo: item.day_no, atTime: item.at_time });
  const editorRows: AdminRegRow[] = reg.data ?? [];
  const rows = editorRows.map((item) => {
    const up = legs[`${item.id}:up`]; const down = legs[`${item.id}:down`];
    const pending = up?.status === "pending" || down?.status === "pending";
    const campus = campuses.find((value) => value.id === item.campus_id);
    const journey = { ...item, legs: (["up","down"] as const).flatMap((direction) => {
      const value = legs[`${item.id}:${direction}`]; return value ? [{ direction, ...value }] : [];
    }) };
    return { ...item, campus: campus?.name ?? "—", order: campus?.display_order ?? 999,
      partialPeriod: item.attend_from !== null || item.attend_to !== null, pending,
      missing: (item.up_trip_id === null && (!up || up.mode === "our_bus")) || (item.down_trip_id === null && (!down || down.mode === "our_bus")),
      needsPlan: needsAttendancePlan(journey) && (!item.attend_from_at || !item.attend_to_at),
      up: up ? { mode: up.mode, status: up.status, via: up.viaUnitId ? unitNames.get(up.viaUnitId) ?? null : null } : null,
      down: down ? { mode: down.mode, status: down.status, via: down.viaUnitId ? unitNames.get(down.viaUnitId) ?? null : null } : null,
    };
  }).filter((item) => isPartialRegistration(item, item.pending)).sort((a,b) => a.order - b.order || a.name.localeCompare(b.name, "ko"));
  return { ok: true, rows, editorRows, campuses, trips: trip.data ?? [], legs, pickups, courses,
    units: (unit.data ?? []).filter((item) => item.retired_at === null).map((item) => ({ id: item.id, name: item.name })),
    places: place.data ?? [], startsOn: event.data?.starts_on ?? null, endsOn: event.data?.ends_on ?? null,
    dayCount: eventDayCount(event.data?.starts_on ?? null, event.data?.ends_on ?? null), writable: writable.data === true,
  } as const;
}
export type PartialEditorData = Extract<Awaited<ReturnType<typeof loadPartialEditorData>>, { ok: true }>;
