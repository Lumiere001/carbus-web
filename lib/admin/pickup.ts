"use client";

import { createClient } from "@/lib/supabase/client";
import { currentEventId } from "@/lib/events/current";
import type { Database } from "@/lib/supabase/database.types";

type Result = { ok: true } | { ok: false; message: string };

export type PickupInput = {
  direction: "up" | "down";
  /** 데리러 갈 시각(KST). 비우면 "시각 미정" — 보드에서 따로 모인다. */
  pickupAt?: string | null;
  /** 총단이 등록한 픽업 장소 id. NULL = 장소 미정. 자유 입력이 아니다. */
  placeId?: number | null;
  note?: string | null;
};

/**
 * 수송 요청 추가.
 *
 * 시각·장소를 **비워도 등록된다.** "가긴 가는데 아직 모른다"가 실제로 가장 흔한
 * 상태라, 필수로 받으면 아무 값이나 찍히고 "미정"이 데이터에서 사라진다.
 * 미정인 채로 남아 있어야 보드에서 "다음에 물어볼 사람"으로 보인다.
 */
export async function addPickup(
  registrationId: string,
  input: PickupInput
): Promise<Result> {
  const supabase = createClient();
  const ev = await currentEventId(supabase);
  if (!ev.ok) return ev;

  const { error } = await supabase.from("pickup_requests").insert({
    event_id: ev.id,
    registration_id: registrationId,
    direction: input.direction,
    // datetime-local 값은 타임존이 없는 문자열이다. KST 로 못 박아 보낸다 —
    // 안 붙이면 서버·브라우저 시간대에 따라 날짜가 하루씩 밀린다.
    pickup_at: toKst(input.pickupAt),
    place_id: input.placeId ?? null,
    note: input.note?.trim() || null,
  });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

export async function updatePickup(
  id: number,
  input: Partial<PickupInput>
): Promise<Result> {
  const supabase = createClient();
  const patch: Database["public"]["Tables"]["pickup_requests"]["Update"] = {};
  if (input.direction !== undefined) patch.direction = input.direction;
  if (input.pickupAt !== undefined) patch.pickup_at = toKst(input.pickupAt);
  if (input.placeId !== undefined) patch.place_id = input.placeId ?? null;
  if (input.note !== undefined) patch.note = input.note?.trim() || null;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("pickup_requests").update(patch).eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

export async function deletePickup(id: number): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.from("pickup_requests").delete().eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/** 참여기간 저장. 둘 다 비우면 "행사 전체 참석"으로 돌아간다. */
export async function setAttendRange(
  registrationId: string,
  from: string | null,
  to: string | null
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("registrations")
    .update({ attend_from: from || null, attend_to: to || null })
    .eq("id", registrationId);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/**
 * `datetime-local` 의 "2026-08-11T23:30" 에 KST 오프셋을 붙인다.
 *
 * 이걸 안 하면 Postgres 가 서버 시간대로 해석한다. 이 서비스는 밤 늦은 픽업이
 * 흔해서(막차·야간 도착) **날짜가 하루 밀리는 게 곧 다른 날 배차표**가 된다.
 */
export function toKst(v: string | null | undefined): string | null {
  if (!v) return null;
  // 이미 오프셋이 붙어 있으면 그대로 둔다.
  if (/[+-]\d{2}:?\d{2}$|Z$/.test(v)) return v;
  return `${v.length === 16 ? `${v}:00` : v}+09:00`;
}

function humanize(msg: string): string {
  if (msg.includes("다른 행사")) return msg;
  if (msg.includes("지난 행사")) return msg;
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다 (본인 캠퍼스 순장/순원만 관리할 수 있어요)";
  if (msg.includes("chk_attend_range"))
    return "참여 종료일이 시작일보다 빠릅니다.";
  return msg;
}

// ── 픽업 장소 (총단만) ──────────────────────────────────────
// 임역원·순장/순원은 이 목록에서 고르기만 한다. 차를 실제로 보내는 건 총단이라,
// 갈 수 있는 곳의 목록도 총단만 안다.

export type PlaceRow = {
  id: number;
  name: string;
  note: string | null;
  displayOrder: number;
  active: boolean;
};

export async function addPickupPlace(
  name: string,
  note: string | null
): Promise<Result> {
  const supabase = createClient();
  const ev = await currentEventId(supabase);
  if (!ev.ok) return ev;
  const { error } = await supabase
    .from("pickup_places")
    .insert({ event_id: ev.id, name: name.trim(), note: note?.trim() || null });
  if (error) return { ok: false, message: humanizePlace(error.message) };
  return { ok: true };
}

export async function updatePickupPlace(
  id: number,
  patch: { name?: string; note?: string | null; active?: boolean }
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("pickup_places")
    .update({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, message: humanizePlace(error.message) };
  return { ok: true };
}

/**
 * 장소 삭제. 이미 그 장소로 잡힌 수송 요청이 있으면 FK 가 막는다 —
 * 그때는 지우지 말고 **내려서(active=false)** 새 입력에서만 감춘다.
 * 지우면 "어디로 가기로 했었는지"가 사라진다.
 */
export async function deletePickupPlace(id: number): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.from("pickup_places").delete().eq("id", id);
  if (error) return { ok: false, message: humanizePlace(error.message) };
  return { ok: true };
}

function humanizePlace(msg: string): string {
  if (msg.includes("pickup_places_event_id_name_key") || msg.includes("duplicate key"))
    return "같은 이름의 픽업 장소가 이미 있습니다.";
  if (msg.includes("foreign key") || msg.includes("violates foreign key"))
    return "이 장소로 잡힌 수송 요청이 있어 지울 수 없습니다. 대신 ‘안 씀’으로 내려 주세요.";
  if (msg.includes("이름을 적어")) return "픽업 장소 이름을 적어 주세요.";
  if (msg.includes("지난 행사")) return msg;
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "픽업 장소는 총단 운영자만 만들 수 있습니다.";
  return msg;
}
