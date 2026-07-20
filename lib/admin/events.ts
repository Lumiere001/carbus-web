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
  });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: data as string };
}

/** 활성 행사를 바꾼다(잘못 전환했을 때 되돌리기 포함). */
export async function activateEvent(eventId: string): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.rpc("activate_event", { p_event_id: eventId });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true, value: undefined };
}

function humanize(msg: string): string {
  if (msg.includes("master")) return "행사 전환은 총단(master)만 할 수 있습니다.";
  if (msg.includes("이름은 비울 수 없습니다")) return "행사 이름을 입력해 주세요.";
  if (msg.includes("row-level security") || msg.includes("policy"))
    return "권한이 없습니다.";
  return msg;
}
