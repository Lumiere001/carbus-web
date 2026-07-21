"use client";

import { createClient } from "@/lib/supabase/client";
import type { AttendanceType, PaymentStatus } from "@/lib/supabase/types";

type Result = { ok: true } | { ok: false; message: string };

/** master 명단 추가·수정 폼 필드 (참석 3필드는 프리셋으로 일관성 보장된 값). */
export type RegFormFields = {
  name: string;
  student_id: string;
  campus_id: string;
  attendance_type: AttendanceType;
  departure_slot_id: number | null;
  uses_return_bus: boolean;
  payment_status: PaymentStatus;
  note: string | null;
};

/** 학번 형식: 두 자리 숫자 또는 외국인/타지구. */
function validStudentId(s: string): boolean {
  return /^\d{2}$/.test(s) || s === "외국인" || s === "타지구";
}
/** 폼 공통 검증 — DB CHECK 도달 전 친절한 메시지. */
function validateForm(f: RegFormFields): string | null {
  if (!f.name.trim()) return "이름은 필수입니다";
  if (!f.campus_id) return "캠퍼스를 선택하세요";
  if (!validStudentId(f.student_id.trim()))
    return "학번은 두 자리 숫자 또는 외국인/타지구만 가능합니다";
  return null;
}

/** 순장/순원 신규 추가 (master 전용, 캠퍼스 지정). */
export async function createRegistration(f: RegFormFields): Promise<Result> {
  const err = validateForm(f);
  if (err) return { ok: false, message: err };
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
  const err = validateForm(f);
  if (err) return { ok: false, message: err };
  const supabase = createClient();
  const { error } = await supabase.from("registrations").update(f).eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}
type Client = ReturnType<typeof createClient>;

/**
 * 수동 배정 검증 (B/C/F):
 *  - 상행: 학우가 상행 대상(departure_slot_id 있음) + 호차 슬롯 일치
 *  - 하행: 학우가 하행 이용자(uses_return_bus)
 *  - 정원: 보조석(hard_cap) 초과 차단
 */
async function validateAssign(
  supabase: Client,
  mode: "up" | "down",
  regId: string,
  busId: number,
  reg: { departure_slot_id: number | null; uses_return_bus: boolean }
): Promise<Result> {
  const { data: bus } = await supabase
    .from("buses")
    .select("name, up_trip_id, hard_cap")
    .eq("id", busId)
    .single();
  if (!bus) return { ok: false, message: "호차를 찾을 수 없습니다" };

  if (mode === "up") {
    if (reg.departure_slot_id == null)
      return { ok: false, message: "상행 대상이 아닙니다 (하행 편도 신청자)" };
    // up_trip_id 가 nullable 이 되면서 "상행을 운행하지 않는 차량"이 표현 가능해졌다.
    if (bus.up_trip_id == null)
      return { ok: false, message: `${bus.name}는 상행을 운행하지 않습니다` };
    if (reg.departure_slot_id !== bus.up_trip_id) {
      const upTripId = bus.up_trip_id;
      const { data: slots } = await supabase
        .from("event_trips")
        .select("id, label")
        .in("id", [reg.departure_slot_id, upTripId]);
      const lbl = (sid: number) =>
        slots?.find((s) => s.id === sid)?.label ?? `slot ${sid}`;
      return {
        ok: false,
        message: `출발 시간대가 다릅니다 (신청 ${lbl(reg.departure_slot_id)} ≠ ${bus.name} ${lbl(upTripId)})`,
      };
    }
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
      .select("departure_slot_id, uses_return_bus")
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

/**
 * 신청 취소. master 전용. audit 자동 기록.
 *
 * 행을 지우지 않고 상태만 바꾼다. 예전엔 삭제였는데 그 방식으로 81건이
 * 사라졌고, 그중 10건(225,000원)은 이미 돈을 받은 사람이었다. 납부·배차
 * 기록이 함께 사라져 되돌릴 수 없었다. 지금은 DB 트리거가 앱에서 오는
 * 삭제를 막는다.
 *
 * 취소하면 좌석·출석·차량순장·고정탑승이 자동으로 반납된다.
 */
export async function excludeRegistration(
  id: string,
  reason?: string | null
): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("registrations")
    .update({
      participation_status: "cancelled",
      cancel_reason: reason?.trim() || null,
    })
    .eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

/** 취소 되돌리기. 좌석은 자동 복구하지 않는다(다른 사람이 이미 앉았을 수 있다). */
export async function restoreRegistration(id: string): Promise<Result> {
  const supabase = createClient();
  const { error } = await supabase
    .from("registrations")
    .update({ participation_status: "registered" })
    .eq("id", id);
  if (error) return { ok: false, message: humanize(error.message) };
  return { ok: true };
}

function humanize(msg: string): string {
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (master만 배정을 수정할 수 있어요)";
  }
  return msg;
}
