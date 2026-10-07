"use client";

import { createClient } from "@/lib/supabase/client";
import {
  updateCells,
  type RegistrationRow,
  type RegistrationInsert,
} from "@/lib/registrations/mutations";

type Result = { ok: true } | { ok: false; message: string };

/** 학번 형식: 두 자리 숫자 또는 외국인/타지구. */
function validStudentId(s: string): boolean {
  return /^\d{2}$/.test(s) || s === "외국인" || s === "타지구";
}
/**
 * 편집 서랍의 **필드 하나**를 저장한다 (저장 버튼 없는 즉시 저장).
 *
 * 통째 저장(옛 `updateRegistrationFields`, 서랍 도입과 함께 제거)과 나누는 이유:
 * 서랍은 한 번에 한 칸씩 고치는 화면이라, 통째로 보내면 **내가 안 건드린 칸까지
 * 내가 열었을 때의 값으로 되돌린다.** 그 사이 다른 사람이 고쳤어도 조용히 덮인다.
 *
 * 그래서 임역원 그리드가 쓰던 `updateCells` 를 그대로 재사용한다 — 값 기반 충돌
 * 감지(내가 보던 값이 아직 그대로일 때만 쓴다)가 이미 들어 있다. 새로 만들지 않는다.
 */
export async function updateRegField(
  id: string,
  expected: Partial<RegistrationRow>,
  patch: Partial<RegistrationInsert>
): Promise<Result & { conflict?: boolean }> {
  // 필드별 저장이라 폼 전체 검증은 못 쓴다. 온 칸만 검사한다.
  if (patch.name !== undefined && !String(patch.name).trim())
    return { ok: false, message: "이름은 필수입니다" };
  if (patch.student_id !== undefined && !validStudentId(String(patch.student_id).trim()))
    return { ok: false, message: "학번은 두 자리 숫자 또는 외국인/타지구만 가능합니다" };
  if (patch.campus_id !== undefined && !patch.campus_id)
    return { ok: false, message: "캠퍼스를 선택하세요" };

  const res = await updateCells(id, expected, patch);
  if (res.ok) return { ok: true };
  return { ok: false, conflict: res.conflict, message: humanize(res.message) };
}

export type AssignmentSnapshot = {
  readonly up_trip_id: number | null;
  readonly down_trip_id: number | null;
  readonly assigned_up_bus_id: number | null;
  readonly assigned_down_bus_id: number | null;
};

/** Compare the visible trip/assignment state, then validate and save both directions atomically. */
export async function setAssignment(
  id: string,
  expected: AssignmentSnapshot,
  fields: { readonly assigned_up_bus_id?: number | null; readonly assigned_down_bus_id?: number | null }
): Promise<Result> {
  const { error } = await createClient().rpc("set_manual_assignment", {
    p_registration_id: id, p_expected: expected, p_assignments: fields,
  });
  if (!error) return { ok: true };
  if (error.code === "40001" || error.code === "40P01") {
    return { ok: false, message: "다른 변경과 겹쳐 저장하지 않았습니다. 새로고침 후 다시 배정해 주세요." };
  }
  return { ok: false, message: humanize(error.message) };
}

/** Normal labels use the same expected-array and version CAS as editable registration cells. */
export async function setRoles(id: string, expectedRoles: readonly string[], roles: readonly string[]): Promise<Result & { readonly conflict?: boolean }> {
  return updateRegField(id, { roles: [...expectedRoles] }, { roles: [...roles] });
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
    return "권한이 없습니다 (총단만 배정을 수정할 수 있어요)";
  }
  return msg;
}
