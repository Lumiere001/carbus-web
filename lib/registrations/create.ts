"use client";

import { createClient } from "@/lib/supabase/client";
import { currentEventId } from "@/lib/events/current";
import { createRegistrationSchema } from "./create-schema";

type Result = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly message: string; readonly uncertain?: boolean };

export async function createCompleteRegistration(input: unknown, expectedEventId: string | null): Promise<Result> {
  const parsed = createRegistrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "입력 값을 확인해 주세요" };
  if (!expectedEventId) return { ok: false, message: "보고 있는 행사가 없습니다. 행사 화면을 다시 열어 주세요." };
  const supabase = createClient();
  const event = await currentEventId(supabase);
  if (!event.ok) return event;
  if (event.id !== expectedEventId) return { ok: false, message: "보고 있던 행사가 바뀌었습니다. 입력을 확인한 뒤 새 행사 화면에서 다시 신청해 주세요." };
  const { data, error } = await supabase.rpc("create_registration_complete", { p_event_id: event.id, p_input: parsed.data });
  if (error?.code === "23505" && error.message.includes("uq_registrations_identity")) return { ok: false, message: "같은 캠퍼스에 같은 이름·학번의 신청이 이미 있습니다. 명단을 확인하고 그 신청을 편집해 주세요." };
  if (error) return { ok: false, uncertain: !/^(22|23|40|42|P0)/.test(error.code), message: /^(22|23|40|42|P0)/.test(error.code)
    ? `신청을 저장하지 않았습니다: ${error.message}`
    : `저장 결과를 확인하지 못했습니다: ${error.message}. 명단을 새로고침해 확인해 주세요.` };
  return { ok: true, id: data };
}
