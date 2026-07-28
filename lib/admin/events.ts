"use client";

import { createClient } from "@/lib/supabase/client";

export type EventRow = {
  id: string;
  name: string;
  subtitle: string | null;
  starts_on: string | null;
  ends_on: string | null;
  origin: string | null;
  destination: string | null;
  /** 이 행사의 왕복 차량비. 신청자 청구액이 이 금액으로 매겨진다. */
  fee_roundtrip: number;
  /** 이 행사의 편도 차량비. */
  fee_oneway: number;
  is_active: boolean;
  created_at: string;
};

type Result<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; message: string };

export type NewEventInput = {
  name: string;
  subtitle?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  origin?: string | null;
  destination?: string | null;
  /** 운행편(출발 시간대)을 지난 행사에서 복제. */
  copyTrips: boolean;
  /** 차량(호차)을 지난 행사에서 복제. 차량순장·고정탑승은 비워진다. */
  copyBuses: boolean;
  /** 왕복 차량비. 생략하면 직전 행사 금액을 이어받는다. */
  feeRoundtrip?: number | null;
  /** 편도 차량비. 생략하면 직전 행사 금액을 이어받는다. */
  feeOneway?: number | null;
};

/**
 * 새 행사를 만들고 활성으로 전환한다.
 * 지난 행사 데이터는 삭제되지 않고 보관되며, activateEvent 로 언제든 되돌릴 수 있다.
 */
export async function createEvent(input: NewEventInput): Promise<Result<string>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_event", {
    p_name: input.name,
    p_subtitle: input.subtitle ?? undefined,
    p_starts_on: input.startsOn ?? undefined,
    p_ends_on: input.endsOn ?? undefined,
    p_origin: input.origin ?? undefined,
    p_destination: input.destination ?? undefined,
    p_copy_trips: input.copyTrips,
    p_copy_buses: input.copyBuses,
    p_fee_roundtrip: input.feeRoundtrip ?? undefined,
    p_fee_oneway: input.feeOneway ?? undefined,
  });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: data as string };
}

/**
 * 진행 중인 행사의 차량비 변경.
 * 이미 등록된 사람의 청구액은 바뀌지 않고, 이후 등록분부터 적용된다.
 */
export async function updateEventFares(
  eventId: string,
  feeRoundtrip: number,
  feeOneway: number
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.rpc("update_event_fares", {
    p_event_id: eventId,
    p_fee_roundtrip: feeRoundtrip,
    p_fee_oneway: feeOneway,
  });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: undefined };
}

/** 활성 행사를 바꾼다(잘못 전환했을 때 되돌리기 포함). */
export async function activateEvent(eventId: string): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.rpc("activate_event", { p_event_id: eventId });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: undefined };
}

/**
 * 지난 행사의 잠금을 잠시 연다.
 *
 * 화면 상단 띠가 예전부터 "고쳐야 하면 Phase 화면에서 사유를 적고 잠금을 여세요" 라고
 * 안내했는데 **그런 자리가 어디에도 없었다.** RPC 는 있는데 부르는 곳이 0곳이었다 —
 * 시키는 대로 할 수 없는 안내였다(§25-D 의 "아직 안 눌러 본 RPC" 중 하나).
 *
 * 사유를 필수로 받는 건 DB 가 강제한다. 지난 행사를 여는 일은 드물어야 하고,
 * 무엇을 고치려고 열었는지가 안 남으면 나중에 그 수정이 왜 있는지 알 수 없다.
 */
export async function unlockEventWrites(
  eventId: string,
  reason: string,
  minutes: number
): Promise<Result<string>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("unlock_event_writes", {
    p_event_id: eventId,
    p_reason: reason,
    p_minutes: minutes,
  });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: data as unknown as string };
}

function humanize(msg: string): string {
  if (msg.includes("master")) return "행사 전환은 총단(master)만 할 수 있습니다.";
  if (msg.includes("사유를 적어")) return "무엇을 고치려고 여는지 사유를 적어 주세요.";
  if (msg.includes("1분~8시간")) return "잠금 해제 시간은 1분~8시간 사이로 정해 주세요.";
  if (msg.includes("이름은 비울 수 없습니다")) return "행사 이름을 입력해 주세요.";
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다.";
  return msg;
}
