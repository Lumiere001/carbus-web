"use client";

import { createClient } from "@/lib/supabase/client";
import { currentEventId } from "@/lib/events/current";
import type { Database } from "@/lib/supabase/database.types";
import { createBus, deleteBus } from "@/lib/admin/buses";

export type TripRow = Database["public"]["Tables"]["event_trips"]["Row"];
type TripUpdate = Database["public"]["Tables"]["event_trips"]["Update"];
export type TripDirection = "up" | "down";

type Result<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export type NewTripInput = {
  direction: TripDirection;
  /** 화면에 보이는 이름. 예: "화 오전 9시", "일 오후 3시 귀가" */
  label: string;
  /** 실제 출발 일시(KST). 아직 안 정했으면 null. */
  departsAt?: string | null;
  origin?: string | null;
  destination?: string | null;
};

export type TripPatch = {
  label?: string;
  departsAt?: string | null;
  origin?: string | null;
  destination?: string | null;
  active?: boolean;
  displayOrder?: number;
};

/**
 * 운행편 추가.
 *
 * `key` 는 사용자에게 묻지 않고 자동 생성한다. CSV 가져오기·과거 데이터가 이 값에
 * 의존하는데, 한글 라벨에서 안정적인 slug 를 만들 방법이 없고 사용자가 신경 쓸
 * 개념도 아니기 때문이다. `up_3` / `down_2` 처럼 방향+순번으로 짓는다.
 *
 * event_id 는 **명시한다** (Phase 4-3). 예전엔 컬럼 DEFAULT 에 맡겼는데 4-4 에서
 * 그 기본값을 지운다. RESTRICTIVE 정책이 여전히 쓰기 가능한 행사만 허용하므로,
 * 명시해도 다른 행사에 끼워 넣을 수는 없다.
 */
export async function createTrip(input: NewTripInput): Promise<Result<TripRow>> {
  const supabase = createClient();

  const label = input.label.trim();
  if (!label) return { ok: false, message: "운행편 이름을 입력해 주세요." };

  // 같은 행사·같은 방향의 현재 편들을 보고 key 와 정렬 순서를 정한다.
  const { data: siblings, error: readErr } = await supabase
    .from("event_trips")
    .select("key, display_order")
    .eq("direction", input.direction);
  if (readErr) return { ok: false, message: humanize(readErr.message) };

  const used = new Set((siblings ?? []).map((s) => s.key));
  let n = (siblings?.length ?? 0) + 1;
  while (used.has(`${input.direction}_${n}`)) n += 1;

  const maxOrder = (siblings ?? []).reduce(
    (m, s) => Math.max(m, s.display_order ?? 0),
    0
  );

  const ev = await currentEventId(supabase);
  if (!ev.ok) return { ok: false, message: ev.message };

  const { data, error } = await supabase
    .from("event_trips")
    .insert({
      event_id: ev.id,
      key: `${input.direction}_${n}`,
      label,
      direction: input.direction,
      departs_at: input.departsAt ?? null,
      origin: input.origin?.trim() || null,
      destination: input.destination?.trim() || null,
      display_order: maxOrder + 10,
      active: true,
    })
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: data };
}

/** 운행편 수정. 방향(direction)과 key 는 바꾸지 않는다 — 과거 데이터가 참조한다. */
export async function updateTrip(
  tripId: number,
  patch: TripPatch
): Promise<Result<TripRow>> {
  const supabase = createClient();

  const body: TripUpdate = {};
  if (patch.label !== undefined) {
    const label = patch.label.trim();
    if (!label) return { ok: false, message: "운행편 이름을 비울 수 없습니다." };
    body.label = label;
  }
  if (patch.departsAt !== undefined) body.departs_at = patch.departsAt;
  if (patch.origin !== undefined) body.origin = patch.origin?.trim() || null;
  if (patch.destination !== undefined)
    body.destination = patch.destination?.trim() || null;
  if (patch.active !== undefined) body.active = patch.active;
  if (patch.displayOrder !== undefined) body.display_order = patch.displayOrder;

  if (Object.keys(body).length === 0)
    return { ok: false, message: "바뀐 내용이 없습니다." };

  const { data, error } = await supabase
    .from("event_trips")
    .update(body)
    .eq("id", tripId)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: data };
}

/**
 * 운행편 삭제.
 *
 * 실제 방어는 DB 트리거(trg_trip_guard_delete)가 한다 — 여기서만 검사하면
 * PostgREST 에 직접 DELETE 를 보내 우회할 수 있다. 이 함수는 그 예외를
 * 사람이 읽을 수 있는 문장으로 바꿔 돌려줄 뿐이다.
 */
export async function deleteTrip(tripId: number): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.from("event_trips").delete().eq("id", tripId);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: undefined };
}

function humanize(msg: string): string {
  // DB 트리거가 이미 사람이 읽을 문장으로 던진다 — 그대로 보여준다.
  if (msg.includes("운행편에 배정된 차량이")) return msg;
  if (msg.includes("운행편으로 신청한 사람이")) return msg;
  if (msg.includes("마지막")) return msg;
  if (msg.includes("event_trips_key_key"))
    return "같은 방향에 같은 이름의 운행편이 이미 있습니다.";
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다 (총단만 편성을 바꿀 수 있어요).";
  if (msg.includes("violates foreign key"))
    return "이 운행편을 쓰는 차량이나 신청이 남아 있습니다.";
  return msg;
}

/**
 * 운행편을 만들면서 **그 편을 뛸 차량까지 한 번에** 만든다.
 *
 * 편만 만들어 두면 차가 0대라 아무도 못 탄다. 그런데 지금까지는 편을 만든 뒤
 * 아래 차량 섹션으로 내려가 한 대씩 따로 추가해야 했다 — 편성을 처음 짤 때
 * 반드시 이어서 하는 일인데 화면이 갈라져 있었다.
 *
 * 대수는 **그 편을 뛰는 총 대수**다. 이미 있는 차 중 이 방향이 비어 있는 차부터
 * 채우므로 "상행 3대" 뒤에 "하행 3대"를 지정하면 **같은 3대가 왕복**한다.
 */
export async function createTripWithBuses(
  input: NewTripInput,
  busCount: number
): Promise<Result<TripRow>> {
  const created = await createTrip(input);
  if (!created.ok) return created;
  if (busCount <= 0) return created;

  const added = await attachBusesTo(created.value.id, input.direction, busCount);
  if (!added.ok)
    return { ok: false, message: `운행편은 만들었지만 ${added.message}` };
  return created;
}

/**
 * 이미 있는 운행편의 **차량 대수를 맞춘다.**
 *
 * 편성을 짜다 보면 "이 편은 9대로" 처럼 대수를 다시 잡는 일이 잦은데, 지금까지는
 * 아래 차량 섹션에서 한 대씩 추가하거나 지워야 했다.
 *
 * 대수는 **그 편을 뛰는 총 대수**다. 늘릴 때는 이 방향이 비어 있는 기존 차부터
 * 채운다(`attachBusesTo`).
 *
 * ⚠️ **줄일 때 차를 지우는 것과 이 방향에서 떼는 것은 다르다.** 반대 방향도 뛰는
 * 차를 지우면 그 방향까지 통째로 사라진다 — 하행 대수를 줄였을 뿐인데 상행 배차가
 * 무너진다. 그래서 반대 방향이 있으면 **이 방향만 뗀다.**
 *
 * ⚠️ 사람이 탄 차는 DB 가드가 막는다 — 그 경우 몇 대까지 줄었는지 알려주고 멈춘다
 * (일부만 처리된 채 조용히 끝나면 화면과 실제가 어긋난다).
 */
export async function setTripBusCount(
  tripId: number,
  direction: TripDirection,
  target: number
): Promise<Result<{ created: number; removed: number }>> {
  if (target < 0 || target > 30)
    return { ok: false, message: "차량 대수는 0~30 사이로 정해 주세요." };

  const supabase = createClient();
  const col = direction === "up" ? "up_trip_id" : "down_trip_id";
  const otherCol = direction === "up" ? "down_trip_id" : "up_trip_id";
  // 간사 차량은 이 대수에 들어가지 않는다 (§26-E) — 세지도, 지우지도 않는다.
  // 넣으면 "이 편 3대" 가 간사 차를 포함한 숫자가 되어, 3 을 그대로 저장하는
  // 것만으로 버스가 한 대 사라진다.
  const { data: mine, error } = await supabase
    .from("buses")
    .select("id, name, up_trip_id, down_trip_id")
    .eq(col, tripId)
    .eq("kind", "bus")
    .order("display_order")
    .order("id");
  if (error) return { ok: false, message: error.message };

  const current = mine ?? [];
  if (target === current.length) return { ok: true, value: { created: 0, removed: 0 } };

  if (target > current.length) {
    const added = await attachBusesTo(tripId, direction, target - current.length);
    return added.ok
      ? { ok: true, value: { created: target - current.length, removed: 0 } }
      : added;
  }

  // 줄이기 — 뒤에 붙은 차부터 뗀다(대개 나중에 늘린 차가 비어 있다).
  let removed = 0;
  for (const step of planBusReduction(
    current.map((b) => ({
      id: b.id,
      name: b.name,
      servesOther: b[otherCol] !== null,
    })),
    target
  )) {
    const res =
      step.action === "detach"
        ? await detachBusFrom(step.id, direction)
        : await deleteBus(step.id);
    if (!res.ok) {
      return {
        ok: false,
        message:
          `${step.name} 은(는) ${step.action === "detach" ? "이 편에서 뗄" : "지울"} 수 없습니다 — ` +
          `${res.message} (${removed}대까지 줄였습니다. 먼저 배차를 다시 돌려 이 차를 비우세요.)`,
      };
    }
    removed += 1;
  }
  return { ok: true, value: { created: 0, removed } };
}

/**
 * 대수를 줄일 때 **차마다 무엇을 할지** 정한다 (순수 함수 — DB 를 보지 않는다).
 *
 * ⚠️ 지우는 것과 이 편에서 떼는 것은 다르다. 반대 방향도 뛰는 차를 지우면 그 방향
 * 배차까지 통째로 사라진다 — 하행 대수를 줄였을 뿐인데 상행이 무너진다.
 * 반대 방향이 있으면 **뗀다**, 이 방향만 뛰는 차라면 그 차는 쓸모가 없으니 **지운다.**
 *
 * 뒤에 붙은 차부터 처리한다. 대개 나중에 늘린 차가 비어 있어 가드에 덜 걸린다.
 */
export function planBusReduction(
  current: { id: number; name: string; servesOther: boolean }[],
  target: number
): { id: number; name: string; action: "detach" | "delete" }[] {
  const steps: { id: number; name: string; action: "detach" | "delete" }[] = [];
  let left = current.length;
  for (const bus of [...current].reverse()) {
    if (left <= target) break;
    steps.push({
      id: bus.id,
      name: bus.name,
      action: bus.servesOther ? "detach" : "delete",
    });
    left -= 1;
  }
  return steps;
}

/**
 * 편에 차량 n대를 붙인다 — **이미 있는 차 중 이 방향이 비어 있는 차부터.**
 *
 * 왜 재사용이 먼저인가: 상행 3대와 하행 3대를 지정하면 동규님이 기대하는 것은
 * **같은 3대가 갈 때도 오고 올 때도 오는 것**이다. 예전에는 방향마다 새로 만들어
 * 6대가 됐다. 지난 여름수련회도 11대 전부가 상·하행 둘 다 뛰었다.
 *
 * 그렇다고 **강제로 양방향으로 묶지는 않는다.** 작년엔 상행 11대 / 하행 10대처럼
 * 방향별 대수가 다른 해가 있었다. "비어 있는 방향을 먼저 채운다"가 그 경우까지
 * 자연스럽게 맞는다 — 모자라면 그때 새로 만든다.
 *
 * 새 차 이름은 기존 `N호차` 중 가장 큰 번호 다음부터 잇는다. 번호가 겹치면
 * 현장에서 "몇 호차 타세요"가 통하지 않는다.
 */
async function attachBusesTo(
  tripId: number,
  direction: TripDirection,
  n: number
): Promise<Result<{ reused: number; created: number }>> {
  const supabase = createClient();
  const col = direction === "up" ? "up_trip_id" : "down_trip_id";

  // 이 방향이 비어 있는 차 — 붙일 자리가 있는 차다.
  // 정렬은 화면 순서 그대로. 1호차부터 채워야 "1·2·3호차가 왕복" 이 된다.
  //
  // ⚠️ 간사 차량은 제외한다 (§26-E). "하행 3대" 라고 하면 그건 버스 3대라는 뜻이지
  //    간사 차를 끌어다 쓰라는 뜻이 아니다.
  const { data: free, error: freeErr } = await supabase
    .from("buses")
    .select("id, name")
    .is(col, null)
    .eq("kind", "bus")
    .order("display_order")
    .order("id");
  if (freeErr) return { ok: false, message: humanize(freeErr.message) };

  const { data: existing } = await supabase.from("buses").select("name");
  const plan = planBusAttachment(
    free ?? [],
    (existing ?? []).map((b) => b.name ?? ""),
    n
  );

  let reused = 0;
  for (const bus of plan.reuse) {
    // 계산된 키(`{[col]: tripId}`)로 쓰지 않는다 — 그러면 타입이 인덱스 시그니처로
    // 넓어져 `tsc` 가 컬럼 이름 오타를 못 잡는다(§4-9 와 같은 종류의 눈감김).
    const { error } = await supabase
      .from("buses")
      .update(direction === "up" ? { up_trip_id: tripId } : { down_trip_id: tripId })
      .eq("id", bus.id);
    if (error)
      return {
        ok: false,
        message: `${bus.name} 을(를) 이 편에 붙이지 못했습니다 — ${humanize(error.message)}`,
      };
    reused += 1;
  }

  let created = 0;
  for (const name of plan.create) {
    const res = await createBus({
      name,
      ...(direction === "up" ? { upTripId: tripId } : { downTripId: tripId }),
    });
    if (!res.ok)
      return {
        ok: false,
        message: `차량 추가에서 멈췄습니다 (${reused}대 재사용 · ${created}대 생성). ${res.message}`,
      };
    created += 1;
  }
  return { ok: true, value: { reused, created } };
}

/**
 * 어떤 차를 재사용하고 몇 대를 새로 만들지 정한다 (순수 함수 — DB 를 보지 않는다).
 *
 * `free` 는 이 방향이 비어 있는 차들(화면 순서). 앞에서부터 채우므로 상행 3대 뒤에
 * 하행 3대를 지정하면 **1·2·3호차가 그대로 왕복**한다.
 *
 * 새 이름은 기존 `N호차` 중 가장 큰 번호 다음부터. `A간사차` 처럼 번호 규칙을 벗어난
 * 이름은 번호 계산에서 무시된다 — 그래야 자유 입력 이름이 번호를 건너뛰게 하지 않는다.
 */
export function planBusAttachment(
  free: { id: number; name: string }[],
  existingNames: string[],
  need: number
): { reuse: { id: number; name: string }[]; create: string[] } {
  if (need <= 0) return { reuse: [], create: [] };

  const reuse = free.slice(0, need);
  const maxNo = existingNames.reduce((m, name) => {
    const num = Number(/^(\d+)호차$/.exec(name ?? "")?.[1] ?? 0);
    return Number.isFinite(num) ? Math.max(m, num) : m;
  }, 0);

  const create: string[] = [];
  for (let i = 1; i <= need - reuse.length; i += 1) create.push(`${maxNo + i}호차`);
  return { reuse, create };
}

/**
 * 차를 **이 방향에서만** 뗀다. 차 자체는 남는다 — 반대 방향은 계속 뛴다.
 *
 * 배정된 사람이 있으면 `guard_bus_trip_change` 가 막는다. 여기서 미리 세지 않는
 * 이유는 §8-D 와 같다 — 화면에서만 검사하면 PostgREST 직접 호출로 우회된다.
 */
async function detachBusFrom(
  busId: number,
  direction: TripDirection
): Promise<Result<undefined>> {
  const supabase = createClient();
  const { error } = await supabase
    .from("buses")
    .update(direction === "up" ? { up_trip_id: null } : { down_trip_id: null })
    .eq("id", busId);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: undefined };
}
