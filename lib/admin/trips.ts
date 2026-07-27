"use client";

import { createClient } from "@/lib/supabase/client";
import { writableEventId } from "@/lib/events/current";
import type { Database } from "@/lib/supabase/database.types";

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

  const ev = await writableEventId(supabase);
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
