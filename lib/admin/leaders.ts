"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * 리더(차량순장·고정탑승) 호차 지정 — 사람 기준.
 * 사람 관점에서 "이 사람을 (상행/하행) N호차의 차량순장/고정탑승으로" 지정한다.
 * 한 사람이 한 방향에서 두 호차에 중복되지 않도록, 새 호차로 옮기기 전에
 * 기존 배정을 먼저 정리한다. master 전용(RLS).
 */

type Mode = "up" | "down";
type Result = { ok: true } | { ok: false; message: string };

/**
 * 역할 토글 → 현재 배정 호차에 자동 결박/해제.
 * 차량순장/고정탑승 역할을 켜면 그 사람이 *이미 배정된* 호차(상행/하행)에
 * driver/fixed 로 묶고, 끄면 모든 호차에서 해제한다. (단일 진실원 = buses 바인딩)
 *
 * - 타는 방향에 배정 호차가 하나도 없으면 결박 불가 → 안내.
 * - 차량순장 결박 시 그 호차에 이미 다른 순장이 있으면 차단(덮어쓰기 방지).
 */
export async function setLeaderRole(opts: {
  regId: string;
  ridesUp: boolean;
  upBusId: number | null;
  ridesDown: boolean;
  downBusId: number | null;
  kind: "driver" | "fixed";
  on: boolean;
}): Promise<Result> {
  const supabase = createClient();
  const { regId, ridesUp, upBusId, ridesDown, downBusId, kind, on } = opts;

  if (on) {
    const targets: { mode: Mode; busId: number }[] = [];
    if (ridesUp && upBusId != null) targets.push({ mode: "up", busId: upBusId });
    if (ridesDown && downBusId != null) targets.push({ mode: "down", busId: downBusId });
    if (targets.length === 0)
      return {
        ok: false,
        message:
          "아직 배정된 호차가 없어 결박할 수 없습니다. 먼저 배차하거나 '리더 관리'에서 호차를 지정하세요.",
      };
    for (const t of targets) {
      const res =
        kind === "driver"
          ? await assignDriverBusChecked(supabase, regId, t.busId, t.mode)
          : await assignFixedBus(regId, t.busId, t.mode);
      if (!res.ok) return res;
    }
    return { ok: true };
  }

  // off: 모든 호차에서 해제
  const res =
    kind === "driver"
      ? await clearDriverEverywhere(supabase, regId)
      : await clearFixedEverywhere(supabase, regId);
  return res;
}

type SupabaseClient = ReturnType<typeof createClient>;

/** 차량순장 결박 — 대상 호차에 다른 순장이 있으면 차단. 본인의 다른 순장 호차는 해제. */
async function assignDriverBusChecked(
  supabase: SupabaseClient,
  regId: string,
  busId: number,
  mode: Mode
): Promise<Result> {
  const { data: bus } = await supabase
    .from("buses")
    .select("id, name, driver_registration_id, down_driver_registration_id")
    .eq("id", busId)
    .single();
  const occupant = mode === "up" ? bus?.driver_registration_id : bus?.down_driver_registration_id;
  if (occupant && occupant !== regId)
    return {
      ok: false,
      message: `${bus?.name ?? `${busId}호차`}에 이미 ${mode === "up" ? "상행" : "하행"} 차량순장이 있습니다. 먼저 해제하세요.`,
    };
  return assignDriverBus(regId, busId, mode);
}

async function clearDriverEverywhere(supabase: SupabaseClient, regId: string): Promise<Result> {
  const a = await supabase.from("buses").update({ driver_registration_id: null }).eq("driver_registration_id", regId);
  if (a.error) return { ok: false, message: humanize(a.error.message) };
  const b = await supabase.from("buses").update({ down_driver_registration_id: null }).eq("down_driver_registration_id", regId);
  if (b.error) return { ok: false, message: humanize(b.error.message) };
  return { ok: true };
}

async function clearFixedEverywhere(supabase: SupabaseClient, regId: string): Promise<Result> {
  const { data: all, error } = await supabase
    .from("buses")
    .select("id, fixed_passenger_ids, down_fixed_passenger_ids");
  if (error) return { ok: false, message: humanize(error.message) };
  for (const b of all ?? []) {
    if ((b.fixed_passenger_ids ?? []).includes(regId)) {
      const u = await supabase.from("buses").update({ fixed_passenger_ids: (b.fixed_passenger_ids ?? []).filter((x) => x !== regId) }).eq("id", b.id);
      if (u.error) return { ok: false, message: humanize(u.error.message) };
    }
    if ((b.down_fixed_passenger_ids ?? []).includes(regId)) {
      const u = await supabase.from("buses").update({ down_fixed_passenger_ids: (b.down_fixed_passenger_ids ?? []).filter((x) => x !== regId) }).eq("id", b.id);
      if (u.error) return { ok: false, message: humanize(u.error.message) };
    }
  }
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다 (master만 변경할 수 있어요)";
  return msg;
}

/**
 * 상행 호차는 신청자의 출발 슬롯과 일치해야 함 (하행은 슬롯 무관 → 통과).
 * 드롭다운 필터 우회·API 직접 호출 대비 서버측 방어 (setAssignment 와 동일 정책).
 */
async function assertUpSlotMatch(
  supabase: SupabaseClient,
  personId: string,
  busId: number,
  mode: Mode
): Promise<Result> {
  if (mode !== "up") return { ok: true };
  const [{ data: reg }, { data: bus }] = await Promise.all([
    supabase.from("registrations").select("departure_slot_id").eq("id", personId).single(),
    supabase.from("buses").select("name, up_trip_id").eq("id", busId).single(),
  ]);
  if (!reg || !bus) return { ok: true }; // 못 찾으면 후속 쿼리에서 처리
  if (reg.departure_slot_id == null)
    return { ok: false, message: "상행 대상이 아닙니다 (하행 편도 신청자)" };
  // up_trip_id 가 nullable 이 되면서 "상행을 운행하지 않는 차량"이 표현 가능해졌다.
  if (bus.up_trip_id == null)
    return { ok: false, message: `${bus.name}는 상행을 운행하지 않습니다` };
  if (reg.departure_slot_id !== bus.up_trip_id) {
    const upTripId = bus.up_trip_id;
    const { data: slots } = await supabase
      .from("event_trips")
      .select("id, label")
      .in("id", [reg.departure_slot_id, upTripId]);
    const lbl = (sid: number) => slots?.find((s) => s.id === sid)?.label ?? `slot ${sid}`;
    return {
      ok: false,
      message: `출발 시간대가 다릅니다 (신청 ${lbl(reg.departure_slot_id)} ≠ ${bus.name} ${lbl(upTripId)})`,
    };
  }
  return { ok: true };
}

/** 사람을 (방향) busId 의 차량순장으로 지정. busId=null 이면 해제. 이전 순장 호차는 자동 해제. */
export async function assignDriverBus(
  personId: string,
  busId: number | null,
  mode: Mode
): Promise<Result> {
  const supabase = createClient();
  // 가드: 상행 슬롯 일치 + 대상 호차에 이미 다른 차량순장이 있으면 차단(무경고 덮어쓰기 방지).
  if (busId != null) {
    const slotG = await assertUpSlotMatch(supabase, personId, busId, mode);
    if (!slotG.ok) return slotG;
    const { data: bus } = await supabase
      .from("buses")
      .select("name, driver_registration_id, down_driver_registration_id")
      .eq("id", busId)
      .single();
    const occupant =
      mode === "up" ? bus?.driver_registration_id : bus?.down_driver_registration_id;
    if (occupant && occupant !== personId)
      return {
        ok: false,
        message: `${bus?.name ?? `${busId}호차`}에 이미 ${mode === "up" ? "상행" : "하행"} 차량순장이 있습니다. 먼저 해제하세요.`,
      };
  }
  if (mode === "up") {
    const c = await supabase
      .from("buses")
      .update({ driver_registration_id: null })
      .eq("driver_registration_id", personId);
    if (c.error) return { ok: false, message: humanize(c.error.message) };
    if (busId != null) {
      const s = await supabase
        .from("buses")
        .update({ driver_registration_id: personId })
        .eq("id", busId);
      if (s.error) return { ok: false, message: humanize(s.error.message) };
    }
  } else {
    const c = await supabase
      .from("buses")
      .update({ down_driver_registration_id: null })
      .eq("down_driver_registration_id", personId);
    if (c.error) return { ok: false, message: humanize(c.error.message) };
    if (busId != null) {
      const s = await supabase
        .from("buses")
        .update({ down_driver_registration_id: personId })
        .eq("id", busId);
      if (s.error) return { ok: false, message: humanize(s.error.message) };
    }
  }
  return { ok: true };
}

/** 사람을 (방향) busId 의 고정탑승으로 지정. busId=null 이면 해제. 이전 고정 호차는 자동 해제. */
export async function assignFixedBus(
  personId: string,
  busId: number | null,
  mode: Mode
): Promise<Result> {
  const supabase = createClient();

  // 가드: 상행 호차는 신청자 출발 슬롯과 일치해야 함 (드롭다운 우회 방어).
  if (busId != null) {
    const slotG = await assertUpSlotMatch(supabase, personId, busId, mode);
    if (!slotG.ok) return slotG;
  }

  // 현재 이 사람이 들어있는 모든 호차의 고정 배열 조회 후 제거
  const { data: all, error: fErr } = await supabase
    .from("buses")
    .select(
      "id, name, hard_cap, driver_registration_id, down_driver_registration_id, fixed_passenger_ids, down_fixed_passenger_ids"
    );
  if (fErr) return { ok: false, message: humanize(fErr.message) };

  // 정원 초과 가드: 대상 호차의 (차량순장 + 고정) 인원이 hard_cap 도달이면 차단
  if (busId != null) {
    const t = (all ?? []).find((b) => b.id === busId);
    if (t) {
      const fixedArr: string[] =
        (mode === "up" ? t.fixed_passenger_ids : t.down_fixed_passenger_ids) ?? [];
      const driver = mode === "up" ? t.driver_registration_id : t.down_driver_registration_id;
      const occupied =
        fixedArr.filter((x) => x !== personId).length + (driver && driver !== personId ? 1 : 0);
      if (!fixedArr.includes(personId) && occupied >= t.hard_cap) {
        return {
          ok: false,
          message: `${t.name} 고정 인원이 정원(${t.hard_cap}석)에 도달했습니다`,
        };
      }
    }
  }

  for (const b of all ?? []) {
    const arr: string[] =
      (mode === "up" ? b.fixed_passenger_ids : b.down_fixed_passenger_ids) ?? [];
    if (b.id !== busId && arr.includes(personId)) {
      const next = arr.filter((x) => x !== personId);
      const u =
        mode === "up"
          ? await supabase.from("buses").update({ fixed_passenger_ids: next }).eq("id", b.id)
          : await supabase.from("buses").update({ down_fixed_passenger_ids: next }).eq("id", b.id);
      if (u.error) return { ok: false, message: humanize(u.error.message) };
    }
  }

  if (busId != null) {
    const target = (all ?? []).find((b) => b.id === busId);
    const arr: string[] =
      (mode === "up" ? target?.fixed_passenger_ids : target?.down_fixed_passenger_ids) ?? [];
    if (!arr.includes(personId)) {
      const next = [...arr, personId];
      const u =
        mode === "up"
          ? await supabase.from("buses").update({ fixed_passenger_ids: next }).eq("id", busId)
          : await supabase.from("buses").update({ down_fixed_passenger_ids: next }).eq("id", busId);
      if (u.error) return { ok: false, message: humanize(u.error.message) };
    }
  }
  return { ok: true };
}
