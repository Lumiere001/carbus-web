"use client";

import { createClient } from "@/lib/supabase/client";

type Mode = "up" | "down";
type Result = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Toggle both directions using the current assignments read and locked by the DB. */
export async function setLeaderRole(opts: {
  readonly regId: string;
  readonly ridesUp: boolean;
  readonly upBusId: number | null;
  readonly ridesDown: boolean;
  readonly downBusId: number | null;
  readonly kind: "driver" | "fixed";
  readonly on: boolean;
}): Promise<Result> {
  return saveBinding({ p_registration_id: opts.regId, p_kind: opts.kind,
    p_operation: opts.on ? "enable" : "disable" });
}

export async function assignDriverBus(personId: string, busId: number | null, mode: Mode): Promise<Result> {
  return saveBinding({ p_registration_id: personId, p_kind: "driver",
    p_operation: "assign", p_mode: mode, ...(busId == null ? {} : { p_bus_id: busId }) });
}

export async function assignFixedBus(personId: string, busId: number | null, mode: Mode): Promise<Result> {
  return saveBinding({ p_registration_id: personId, p_kind: "fixed",
    p_operation: "assign", p_mode: mode, ...(busId == null ? {} : { p_bus_id: busId }) });
}

type BindingInput = {
  readonly p_registration_id: string;
  readonly p_kind: "driver" | "fixed";
  readonly p_operation: "assign" | "enable" | "disable";
  readonly p_mode?: Mode;
  readonly p_bus_id?: number;
};

async function saveBinding(input: BindingInput): Promise<Result> {
  const { error } = await createClient().rpc("set_leader_binding", input);
  if (!error) return { ok: true };
  if (error.code === "40001" || error.code === "40P01") {
    return { ok: false, message: "다른 변경과 겹쳐 저장하지 않았습니다. 새로고침 후 다시 지정해 주세요." };
  }
  const detail = error.message.includes("row-level security") || error.message.includes("policy")
    ? "권한이 없습니다 (총단만 변경할 수 있어요)" : error.message;
  return { ok: false, message: /^(22|23|40|42|P0)/.test(error.code)
    ? `리더 변경을 저장하지 않았습니다: ${detail}`
    : `리더 저장 결과를 확인하지 못했습니다: ${detail}. 명단을 새로고침해 확인해 주세요.` };
}

export type StaffCarSync = { readonly action: "assign"; readonly busId: number } | { readonly action: "clear" } | null;

/** Kept as the pure behavioral contract for staff-car assignment synchronization. */
export function staffCarSync(opts: {
  readonly nextKind: "bus" | "staff_car" | null;
  readonly nextBusId: number | null;
  readonly currentKind: "bus" | "staff_car" | null;
}): StaffCarSync {
  if (opts.nextKind === "staff_car" && opts.nextBusId != null) return { action: "assign", busId: opts.nextBusId };
  if (opts.currentKind === "staff_car") return { action: "clear" };
  return null;
}
