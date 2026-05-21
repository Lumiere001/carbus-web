"use client";

import { createClient } from "@/lib/supabase/client";
import { DAY_LABELS } from "@/lib/labels";
import type {
  AttendanceType,
  DepartureDay,
  PaymentStatus,
} from "@/lib/supabase/types";

type Result = { ok: true } | { ok: false; message: string };

/** master 명단 추가·수정 폼 필드 (참석 3필드는 프리셋으로 일관성 보장된 값). */
export type RegFormFields = {
  name: string;
  student_id: string;
  campus_id: string;
  attendance_type: AttendanceType;
  departure_day: DepartureDay | null;
  uses_return_bus: boolean;
  payment_status: PaymentStatus;
};

/** 순장/순원 신규 추가 (master 전용, 캠퍼스 지정). */
export async function createRegistration(f: RegFormFields): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("registrations")
    .insert({ ...f, roles: [] });
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/** 이름·학번·참석일정·납부·캠퍼스 수정 (master 전용). 배정 컬럼은 건드리지 않음. */
export async function updateRegistrationFields(
  id: string,
  f: RegFormFields
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.from("registrations").update(f).eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}
type Client = ReturnType<typeof createClient>;

/**
 * 수동 배정 검증 (B/C/F):
 *  - 상행: 학우가 상행 대상(departure_day 있음) + 호차 요일 일치
 *  - 하행: 학우가 하행 이용자(uses_return_bus)
 *  - 정원: 보조석(hard_cap) 초과 차단
 */
async function validateAssign(
  supabase: Client,
  mode: "up" | "down",
  regId: string,
  busId: number,
  reg: { departure_day: string | null; uses_return_bus: boolean }
): Promise<Result> {
  const { data: bus } = await supabase
    .from("buses")
    .select("name, departure_day, hard_cap")
    .eq("id", busId)
    .single();
  if (!bus) return { ok: false, message: "호차를 찾을 수 없습니다" };

  if (mode === "up") {
    if (reg.departure_day == null)
      return { ok: false, message: "상행 대상이 아닙니다 (하행 편도 신청자)" };
    if (reg.departure_day !== bus.departure_day)
      return {
        ok: false,
        message: `요일이 다릅니다 (신청 ${DAY_LABELS[reg.departure_day as "TUE" | "WED"]} ≠ ${bus.name} ${DAY_LABELS[bus.departure_day]})`,
      };
  } else if (reg.uses_return_bus !== true) {
    return { ok: false, message: "하행 대상이 아닙니다 (하행 미이용 신청자)" };
  }

  const col = mode === "up" ? "assigned_up_bus_id" : "assigned_down_bus_id";
  const { count } = await supabase
    .from("registrations")
    .select("id", { count: "exact", head: true })
    .eq(col, busId)
    .neq("id", regId);
  if ((count ?? 0) >= bus.hard_cap)
    return {
      ok: false,
      message: `${bus.name} 정원 초과 (이미 ${count}명 / 최대 ${bus.hard_cap}석)`,
    };

  return { ok: true };
}

/** 상행/하행 호차 수동 배정·변경·해제 (master 전용, RLS master ALL). null=미배정. */
export async function setAssignment(
  id: string,
  fields: { assigned_up_bus_id?: number | null; assigned_down_bus_id?: number | null }
): Promise<Result> {
  const supabase = createClient();
  const upBus = fields.assigned_up_bus_id;
  const downBus = fields.assigned_down_bus_id;

  // 호차 지정(배정) 시에만 검증. 해제(null)는 통과.
  if (upBus != null || downBus != null) {
    const { data: reg, error: regErr } = await supabase
      .from("registrations")
      .select("departure_day, uses_return_bus")
      .eq("id", id)
      .single();
    if (regErr || !reg)
      return { ok: false, message: "신청 정보를 찾을 수 없습니다" };

    if (upBus != null) {
      const v = await validateAssign(supabase, "up", id, upBus, reg);
      if (!v.ok) return v;
    }
    if (downBus != null) {
      const v = await validateAssign(supabase, "down", id, downBus, reg);
      if (!v.ok) return v;
    }
  }

  const { error } = await supabase
    .from("registrations")
    .update(fields)
    .eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/** 역할 라벨 부여·해제 (registrations.roles 배열 교체). master 전용(guard 트리거). */
export async function setRoles(id: string, roles: string[]): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("registrations")
    .update({ roles })
    .eq("id", id);
  if (error) {
    if (error.message.includes("master-only"))
      return { ok: false, message: "역할은 master만 지정할 수 있습니다" };
    return { ok: false, message: humanize(error.message) };
  }
  return { ok: true };
}

/** 전체 명단에서 제외 (등록 삭제). master 전용. audit 자동 기록. */
export async function excludeRegistration(id: string): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase.from("registrations").delete().eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (master만 배정을 수정할 수 있어요)";
  }
  return msg;
}
