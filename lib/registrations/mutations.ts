"use client";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

export type RegistrationRow =
  Database["public"]["Tables"]["registrations"]["Row"];
export type RegistrationInsert =
  Database["public"]["Tables"]["registrations"]["Insert"];

type Result<T> =
  | { ok: true; row: T }
  | { ok: false; conflict?: boolean; message: string; latest?: T };

/**
 * 신규 순장/순원 INSERT. campus_id는 호출부에서 본인 캠퍼스로 강제 (RLS WITH CHECK도 이중 차단).
 */
export async function insertRegistration(
  input: RegistrationInsert
): Promise<Result<RegistrationRow>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("registrations")
    .insert(input)
    .select()
    .single();

  if (error) {
    return { ok: false, message: humanizeError(error.message) };
  }
  return { ok: true, row: data };
}

/**
 * 필드 단위 UPDATE + 낙관적 동시성.
 * version은 트리거가 자동 증가하므로 patch에 넣지 않음.
 * `.eq("version", expectedVersion)` 으로 충돌 감지 (0 rows = 다른 사용자가 먼저 수정).
 */
export async function updateRegistration(
  id: string,
  expectedVersion: number,
  patch: Partial<RegistrationInsert>
): Promise<Result<RegistrationRow>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("registrations")
    .update(patch)
    .eq("id", id)
    .eq("version", expectedVersion)
    .select()
    .maybeSingle();

  if (error) {
    return { ok: false, message: humanizeError(error.message) };
  }
  if (!data) {
    // version 불일치 = 다른 임역원이 먼저 수정. 최신 row를 가져와 호출부에 전달
    // (Realtime이 아직 도달 안 했어도 즉시 최신값으로 갱신하기 위함).
    const { data: latest } = await supabase
      .from("registrations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return {
      ok: false,
      conflict: true,
      message: "다른 임역원이 먼저 수정했습니다. 최신 값으로 갱신했어요.",
      latest: latest ?? undefined,
    };
  }
  return { ok: true, row: data };
}

/**
 * 셀 단위(field-level) 편집 + 충돌 감지.
 * `expected`의 각 필드를 DB 현재값과 비교 → 하나라도 다르면(다른 임역원이 그 셀을 바꿈)
 * 충돌로 보고 + 최신 row 반환. 모두 일치하면 `patch` 적용.
 * 충돌 안 난 다른 셀은 그대로 두므로, 같은 행이라도 서로 다른 셀은 동시 편집 가능.
 *
 * @param expected 편집 시작 시 사용자가 보던 해당 셀(들)의 값
 * @param patch    적용할 새 값 (참석/일정 묶음이면 3필드 동시)
 */
export async function updateCells(
  id: string,
  expected: Partial<RegistrationRow>,
  patch: Partial<RegistrationInsert>
): Promise<Result<RegistrationRow> & { conflictFields?: string[] }> {
  const supabase = createClient();
  const { data: current, error: fetchErr } = await supabase
    .from("registrations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) return { ok: false, message: humanizeError(fetchErr.message) };
  if (!current) {
    return { ok: false, message: "신청 내역을 찾을 수 없습니다" };
  }

  // 값 기반 비교 (배열·null 안전). 참조 비교는 roles[] 등에서 오탐.
  const sameValue = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const conflictFields = Object.keys(expected).filter(
    (k) =>
      !sameValue(
        current[k as keyof RegistrationRow],
        expected[k as keyof RegistrationRow]
      )
  );
  if (conflictFields.length > 0) {
    return {
      ok: false,
      conflict: true,
      conflictFields,
      latest: current,
      message: "다른 임역원이 같은 항목을 먼저 수정했습니다. 최신값을 반영했어요.",
    };
  }

  // 원자적 낙관 락: 읽은 version 일 때만 갱신. 그 사이 누가 바꿨으면 0행 → 충돌.
  const { data, error } = await supabase
    .from("registrations")
    .update(patch)
    .eq("id", id)
    .eq("version", current.version)
    .select()
    .maybeSingle();

  if (error) return { ok: false, message: humanizeError(error.message) };
  if (!data) {
    // version 불일치 — SELECT 이후 다른 사람이 먼저 커밋함
    const { data: latest } = await supabase
      .from("registrations")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return {
      ok: false,
      conflict: true,
      conflictFields: Object.keys(expected),
      latest: latest ?? current,
      message: "다른 임역원이 같은 항목을 먼저 수정했습니다. 최신값을 반영했어요.",
    };
  }
  return { ok: true, row: data };
}

export async function deleteRegistration(
  id: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = createClient();
  const { error } = await supabase.from("registrations").delete().eq("id", id);
  if (error) {
    return { ok: false, message: humanizeError(error.message) };
  }
  return { ok: true };
}

/** Postgres·Supabase 에러 메시지를 사용자 친화 한국어로. */
function humanizeError(msg: string): string {
  if (msg.includes("registrations_unique_person") || msg.includes("duplicate key")) {
    return "이미 등록된 순장/순원입니다 (캠퍼스·학번·이름 동일)";
  }
  if (msg.includes("chk_roundtrip") || msg.includes("roundtrip")) {
    return "왕복은 상행 요일과 하행 차량 이용이 모두 필요합니다";
  }
  if (msg.includes("chk_oneway") || msg.includes("oneway")) {
    return "편도는 상행 또는 하행 중 하나만 선택 가능합니다";
  }
  if (msg.includes("student_id")) {
    return "학번 형식이 올바르지 않습니다 (예: 26 / 간사 / 외국인 / 타지구)";
  }
  if (msg.includes("row-level security") || msg.includes("policy")) {
    return "권한이 없습니다 (본인 캠퍼스 순장/순원만 관리할 수 있어요)";
  }
  return msg;
}
