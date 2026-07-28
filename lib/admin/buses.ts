"use client";

import { createClient } from "@/lib/supabase/client";
import { currentEventId } from "@/lib/events/current";
import type { Database } from "@/lib/supabase/database.types";

export type BusRow = Database["public"]["Tables"]["buses"]["Row"];
type BusUpdate = Database["public"]["Tables"]["buses"]["Update"];

type Result = { ok: true; row: BusRow } | { ok: false; message: string };

/** 배차 방향. 상행/하행 차량순장·고정은 별개 컬럼으로 관리. */
export type BusPinMode = "up" | "down";

/** 차량순장 지정·해제 (regId null 이면 해제). master만 (RLS). 방향별 컬럼. */
export async function setDriver(
  busId: number,
  regId: string | null,
  mode: BusPinMode = "up"
): Promise<Result> {
  const supabase = createClient();
  const patch =
    mode === "up"
      ? { driver_registration_id: regId }
      : { down_driver_registration_id: regId };
  const { data, error } = await supabase
    .from("buses")
    .update(patch)
    .eq("id", busId)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

/** 고정 탑승자 배열 전체 교체 (client가 현재 배열 보유 → 추가/제거 후 전달). 방향별 컬럼. */
export async function setFixedPassengers(
  busId: number,
  ids: string[],
  mode: BusPinMode = "up"
): Promise<Result> {
  const supabase = createClient();
  const patch =
    mode === "up"
      ? { fixed_passenger_ids: ids }
      : { down_fixed_passenger_ids: ids };
  const { data, error } = await supabase
    .from("buses")
    .update(patch)
    .eq("id", busId)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, row: data };
}

// ── 편성 편집 (Phase 3-B) ─────────────────────────────────────
// 지금까지 차량은 마이그레이션 시드와 create_event 복제로만 생겼다.
// 코드에 생성·삭제 경로가 0곳이라, 다음 행사에서 대수·정원·출발편을
// 바꾸려면 DB 를 직접 만지는 수밖에 없었다.

export type NewBusInput = {
  name: string;
  capacity?: number;
  hardCap?: number;
  upTripId?: number | null;
  downTripId?: number | null;
  /** 여러 캠퍼스가 섞이는 차(임원·총단 차). 순장 캠퍼스를 끌어오지 않는다. */
  isCohesionExempt?: boolean;
  /** 클수록 나중에 채운다. 짐을 싣는 차는 1 이상으로 두어 빈자리를 남긴다. */
  fillPriority?: number;
  /**
   * 차량 종류 (§26-E). `staff_car` = 간사 차량 — 호차 화면·출석에는 같이 나오지만
   * **자동 배차 대상이 아니다.** 탑승자는 고정 탑승자로 수동 지정한다.
   */
  kind?: "bus" | "staff_car";
};

export type BusPatch = Partial<NewBusInput> & { displayOrder?: number };

type CrudResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/**
 * 차량 추가.
 *
 * event_id 는 넘기지 않는다 — DEFAULT 가 active_event_id() 이고 RESTRICTIVE 정책이
 * 그 값만 허용하므로, 다른 행사에 끼워 넣을 수 없다.
 */
export async function createBus(
  input: NewBusInput
): Promise<CrudResult<BusRow>> {
  const supabase = createClient();
  const name = input.name.trim();
  if (!name) return { ok: false, message: "호차 이름을 입력해 주세요." };

  const { data: siblings } = await supabase.from("buses").select("display_order");
  const maxOrder = (siblings ?? []).reduce(
    (m, b) => Math.max(m, b.display_order ?? 0),
    0
  );

  const ev = await currentEventId(supabase); // Phase 4-3 — 기본값에 기대지 않는다
  if (!ev.ok) return { ok: false, message: ev.message };

  const { data, error } = await supabase
    .from("buses")
    .insert({
      event_id: ev.id,
      name,
      capacity: input.capacity ?? 44,
      hard_cap: input.hardCap ?? 45,
      up_trip_id: input.upTripId ?? null,
      down_trip_id: input.downTripId ?? null,
      is_cohesion_exempt: input.isCohesionExempt ?? false,
      fill_priority: input.fillPriority ?? 0,
      kind: input.kind ?? "bus",
      display_order: maxOrder + 10,
    })
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: data };
}

/** 차량 설정 변경 (이름·정원·운행편·배차 플래그). */
export async function updateBus(
  busId: number,
  patch: BusPatch
): Promise<CrudResult<BusRow>> {
  const supabase = createClient();
  const body: BusUpdate = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) return { ok: false, message: "호차 이름을 비울 수 없습니다." };
    body.name = name;
  }
  if (patch.capacity !== undefined) body.capacity = patch.capacity;
  if (patch.hardCap !== undefined) body.hard_cap = patch.hardCap;
  if (patch.upTripId !== undefined) body.up_trip_id = patch.upTripId;
  if (patch.downTripId !== undefined) body.down_trip_id = patch.downTripId;
  if (patch.isCohesionExempt !== undefined)
    body.is_cohesion_exempt = patch.isCohesionExempt;
  if (patch.fillPriority !== undefined) body.fill_priority = patch.fillPriority;
  if (patch.kind !== undefined) body.kind = patch.kind;
  if (patch.displayOrder !== undefined) body.display_order = patch.displayOrder;

  if (Object.keys(body).length === 0)
    return { ok: false, message: "바뀐 내용이 없습니다." };

  if (
    typeof body.capacity === "number" &&
    typeof body.hard_cap === "number" &&
    body.hard_cap < body.capacity
  ) {
    return {
      ok: false,
      message: "보조석 포함 정원이 기본 정원보다 작을 수 없습니다.",
    };
  }

  const { data, error } = await supabase
    .from("buses")
    .update(body)
    .eq("id", busId)
    .select()
    .single();
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: data };
}

/**
 * 차량 삭제.
 *
 * ⚠️ 실제 방어는 DB 트리거(trg_bus_guard_delete)가 한다. 여기서만 검사하면
 * PostgREST 에 직접 DELETE 를 보내 우회할 수 있고, 그러면
 * registrations.assigned_*_bus_id 의 FK 가 ON DELETE SET NULL 이라
 * **배정이 에러 없이 증발한다**. 이 함수는 그 예외를 문장으로 바꿔 돌려줄 뿐이다.
 */
export async function deleteBus(busId: number): Promise<CrudResult> {
  const supabase = createClient();
  const { error } = await supabase.from("buses").delete().eq("id", busId);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: undefined };
}

function humanize(msg: string): string {
  // DB 트리거가 이미 사람이 읽을 문장으로 던진다 — 그대로 보여준다.
  if (msg.includes("배정된 인원이 있습니다")) return msg;
  if (msg.includes("운행편을 지정할 수 없습니다")) return msg;
  if (msg.includes("buses_name_key")) return "같은 이름의 호차가 이미 있습니다.";
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (master만 호차 정보를 변경할 수 있어요)";
  }
  return msg;
}
