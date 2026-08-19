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
  const kinds = await fetchBusKinds(supabase);
  for (const m of ["up", "down"] as Mode[]) {
    const sync = await applyStaffCarSync(supabase, regId, m, null, kinds);
    if (!sync.ok) return sync;
  }
  return { ok: true };
}

async function clearFixedEverywhere(supabase: SupabaseClient, regId: string): Promise<Result> {
  const { data: all, error } = await supabase
    .from("buses")
    .select("id, kind, fixed_passenger_ids, down_fixed_passenger_ids");
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
  // 간사 차 고정을 풀었으면 배정도 같이 푼다 — 안 그러면 아무 데도 안 묶인
  // 사람이 호차 명단에 유령으로 남는다 (§26-E).
  for (const m of ["up", "down"] as Mode[]) {
    const sync = await applyStaffCarSync(supabase, regId, m, null, all ?? []);
    if (!sync.ok) return sync;
  }
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다 (master만 변경할 수 있어요)";
  return msg;
}

/**
 * 리더로 지정하려는 호차가 그 사람이 **그 방향으로 신청한 편**과 같아야 한다.
 * 드롭다운 필터 우회·API 직접 호출 대비 서버측 방어
 * (setAssignment 의 validateAssign 과 동일 정책 — 상·하행 대칭).
 *
 * ⚠️ 3-C 이전에는 `mode !== "up"` 이면 즉시 통과시켰다. 그때는 신청에
 * "하행 편"이라는 개념이 없어(불린 하나) 어긋날 대상이 없었기 때문이다.
 * 지금은 하행도 편을 신청하므로, 통과시키면 3시 차 순장으로 지정된 사람이
 * 6시 차 승객이어도 아무 데서도 안 막히고 배차에서 조용히 탈락한다.
 */
async function assertTripMatch(
  supabase: SupabaseClient,
  personId: string,
  busId: number,
  mode: Mode
): Promise<Result> {
  const [{ data: reg }, { data: bus }] = await Promise.all([
    supabase
      .from("registrations")
      .select("up_trip_id, down_trip_id")
      .eq("id", personId)
      .single(),
    supabase
      .from("buses")
      .select("name, kind, up_trip_id, down_trip_id")
      .eq("id", busId)
      .single(),
  ]);
  if (!reg || !bus) return { ok: true }; // 못 찾으면 후속 쿼리에서 처리

  const regTrip = mode === "up" ? reg.up_trip_id : reg.down_trip_id;
  const busTrip = mode === "up" ? bus.up_trip_id : bus.down_trip_id;
  const dir = mode === "up" ? "상행" : "하행";

  // 간사 차량은 **우리 버스 편과 짝을 맞추지 않는다** (§26-E).
  //
  // 이 검사가 있는 이유는 "9시 편 신청자가 7시 편 버스에 타 있는" 상태를 막기
  // 위해서다. 그런데 간사 차를 타는 사람(크루·미디어)은 애초에 우리 버스를 안 타서
  // **편을 신청하지 않은 경우가 대부분**이다. 여기서 편을 요구하면 간사 차 탑승자를
  // 지정할 방법이 아예 없어진다 — 리허설에서 실제로 그 막다른 길에 부딪혔다.
  //
  // 그 차가 그 방향을 뛰는지는 그대로 검사한다.
  if (bus.kind === "staff_car") {
    if (busTrip == null)
      return { ok: false, message: `${bus.name}는 ${dir}을 운행하지 않습니다` };
    return { ok: true };
  }

  if (regTrip == null)
    return {
      ok: false,
      message:
        mode === "up"
          ? "상행 대상이 아닙니다 (하행 편도 신청자)"
          : "하행 대상이 아닙니다 (하행 미이용 신청자)",
    };
  // trip_id 가 nullable 이라 "그 방향을 운행하지 않는 차량"이 표현 가능하다.
  if (busTrip == null)
    return { ok: false, message: `${bus.name}는 ${dir}을 운행하지 않습니다` };
  if (regTrip !== busTrip) {
    const { data: trips } = await supabase
      .from("event_trips")
      .select("id, label")
      .in("id", [regTrip, busTrip]);
    const lbl = (tid: number) => trips?.find((t) => t.id === tid)?.label ?? `편 ${tid}`;
    return {
      ok: false,
      message: `${mode === "up" ? "출발" : "귀가"} 시간대가 다릅니다 (신청 ${lbl(regTrip)} ≠ ${bus.name} ${lbl(busTrip)})`,
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
  // 가드: 편 일치(상·하행) + 대상 호차에 이미 다른 차량순장이 있으면 차단(무경고 덮어쓰기 방지).
  if (busId != null) {
    const slotG = await assertTripMatch(supabase, personId, busId, mode);
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
  // 고정 탑승자와 같은 이유로, 간사 차량의 차량순장도 배정까지 같이 쓴다 (§26-E).
  return applyStaffCarSync(supabase, personId, mode, busId, await fetchBusKinds(supabase));
}

/** 사람을 (방향) busId 의 고정탑승으로 지정. busId=null 이면 해제. 이전 고정 호차는 자동 해제. */
export async function assignFixedBus(
  personId: string,
  busId: number | null,
  mode: Mode
): Promise<Result> {
  const supabase = createClient();

  // 가드: 호차의 편이 신청한 편과 같아야 함 — 상·하행 모두 (드롭다운 우회 방어).
  if (busId != null) {
    const slotG = await assertTripMatch(supabase, personId, busId, mode);
    if (!slotG.ok) return slotG;
  }

  // 현재 이 사람이 들어있는 모든 호차의 고정 배열 조회 후 제거
  const { data: all, error: fErr } = await supabase
    .from("buses")
    .select(
      // `kind` — 간사 차량이면 배정까지 같이 써야 한다 (applyStaffCarSync).
      "id, name, kind, hard_cap, driver_registration_id, down_driver_registration_id, fixed_passenger_ids, down_fixed_passenger_ids"
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
  // ⚠️ 반드시 fixed_passenger_ids 를 쓴 **뒤에** — DB 가드가 순서를 강제한다.
  return applyStaffCarSync(supabase, personId, mode, busId, all ?? []);
}

// ════════════════════════════════════════════════════════════════════
// 간사 차량 — 고정/순장 지정을 **실제 배정까지** 반영한다 (§26-E)
// ════════════════════════════════════════════════════════════════════
//
// 왜 필요한가. 일반 버스는 `registrations.assigned_*_bus_id` 를 **배차 엔진이**
// 채운다. 그런데 간사 차량은 자동 배차의 "빈자리 채움" 단계에서 빠지므로,
// 배차를 돌리기 전까지 이 화면의 지정이 `buses.fixed_passenger_ids` 에만 남는다.
// 대시보드·전체 순장/순원·출석부·CSV 는 전부 `assigned_*_bus_id` 를 읽는다
// (`v_bus_occupancy` 가 그 컬럼을 센다). 그래서 운영자 눈에는 **리더 화면에서
// 지정했는데 아무 일도 안 일어난 것**으로 보인다 — 실제로 그 신고가 들어왔다.
//
// 배차를 돌리면 엔진 Step 1(고정 배정)이 정확히 같은 값을 쓴다. 즉 여기서 하는
// 일은 **배차 이후 상태를 미리 만드는 것뿐**이고, 없던 상태를 새로 만들지 않는다.
//
// 일반 버스는 건드리지 않는다. 그건 배차 엔진 소관이고, 여기서 손대면 배차를
// 돌리기도 전에 그 사람이 좌석을 차지해 남은 좌석 계산이 어긋난다.

/** `applyStaffCarSync` 가 내릴 결정. `null` = 손대지 않음. */
export type StaffCarSync = { action: "assign"; busId: number } | { action: "clear" } | null;

/**
 * 순수 판정부 — 부수효과가 없어 단위 테스트가 가능하다.
 *
 * @param nextKind    이 방향에서 새로 묶인 호차의 종류. 해제면 null.
 * @param nextBusId   그 호차 id. 해제면 null.
 * @param currentKind 지금 `assigned_*_bus_id` 가 가리키는 호차의 종류. 미배정이면 null.
 */
export function staffCarSync(opts: {
  nextKind: "bus" | "staff_car" | null;
  nextBusId: number | null;
  currentKind: "bus" | "staff_car" | null;
}): StaffCarSync {
  if (opts.nextKind === "staff_car" && opts.nextBusId != null)
    return { action: "assign", busId: opts.nextBusId };
  // 간사 차에서 내린 경우(해제·다른 차로 이동)에만 배정을 푼다. 일반 버스 배정은
  // 배차 엔진의 결과라 여기서 지우면 멀쩡한 배차가 사라진다.
  if (opts.currentKind === "staff_car") return { action: "clear" };
  return null;
}

type BusKindRow = { id: number; kind: "bus" | "staff_car" };

/** 판정에 필요한 최소 정보만. 호차 목록을 이미 들고 있으면 그걸 넘기고 이건 부르지 마라. */
async function fetchBusKinds(supabase: SupabaseClient): Promise<BusKindRow[]> {
  const { data } = await supabase.from("buses").select("id, kind");
  return data ?? [];
}

/**
 * ⚠️ 반드시 `fixed_passenger_ids` / `driver_registration_id` 를 쓴 **뒤에** 호출할 것.
 * DB 가드(`guard_staff_car_assignment`)가 "고정 탑승자도 차량순장도 아닌 사람의
 * 간사 차 배정"을 거부하므로, 순서가 뒤집히면 저장이 통째로 실패한다.
 */
async function applyStaffCarSync(
  supabase: SupabaseClient,
  personId: string,
  mode: Mode,
  nextBusId: number | null,
  buses: BusKindRow[]
): Promise<Result> {
  // 목록에 없는 호차는 일반 버스로 본다 — 모르는 차를 간사 차로 추정해 배정을
  // 지워 버리는 것보다, 손대지 않는 쪽이 안전하다.
  const kindOf = (id: number | null) =>
    id == null ? null : (buses.find((b) => b.id === id)?.kind ?? "bus");

  const { data: reg, error } = await supabase
    .from("registrations")
    .select("assigned_up_bus_id, assigned_down_bus_id")
    .eq("id", personId)
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  const currentBusId =
    (mode === "up" ? reg?.assigned_up_bus_id : reg?.assigned_down_bus_id) ?? null;

  const decision = staffCarSync({
    nextKind: kindOf(nextBusId),
    nextBusId,
    currentKind: kindOf(currentBusId),
  });
  if (decision === null) return { ok: true };

  const value = decision.action === "assign" ? decision.busId : null;
  if (value === currentBusId) return { ok: true }; // 이미 같다 — 감사 로그를 더럽히지 않는다

  const patch =
    mode === "up" ? { assigned_up_bus_id: value } : { assigned_down_bus_id: value };
  const u = await supabase.from("registrations").update(patch).eq("id", personId);
  if (u.error) return { ok: false, message: humanize(u.error.message) };
  return { ok: true };
}
