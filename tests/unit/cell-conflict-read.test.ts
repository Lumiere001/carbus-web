import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateCells, updateRegistration } from "@/lib/registrations/mutations";
import type { RegistrationInsert, RegistrationRow } from "@/lib/registrations/mutations";

const initial: RegistrationRow = { id: "r1", event_id: "e1", name: "합성 학우", student_id: "26", campus_id: "c1", attendance_type: "roundtrip",
  up_trip_id: 1, down_trip_id: 2, departure_slot_id: 1, uses_return_bus: true, assigned_up_bus_id: null, assigned_down_bus_id: null,
  attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null, payment_status: "unpaid", fee: 50000, roles: [], participation_status: "registered",
  cancelled_at: null, cancel_reason: null, cancelled_by: null, checked_in: false, checked_out: false, created_by: null,
  created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z", version: 2, note: "이전 비고", home_unit_id: null };
let current: RegistrationRow = initial;
let unavailable = false;
let latestError: { message: string } | null = null;
let race = true;
let attempted = false;
const select = () => ({ eq: () => ({ maybeSingle: async () => {
  return attempted && unavailable ? { data: null, error: latestError } : { data: current, error: null };
} }) });
const update = vi.fn((patch: Partial<RegistrationInsert>) => ({ eq: () => ({ eq: (_column: string, version: number) => ({ select: () => ({ maybeSingle: async () => {
  attempted = true;
  if (race) { race = false; current = { ...current, version: 3, note: "다른 기기의 비고" }; }
  if (current.version !== version) return { data: null, error: null };
  current = { ...current, ...patch, version: current.version + 1 };
  return { data: current, error: null };
} }) }) }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ select, update }) }) }));
beforeEach(() => { current = { ...initial }; unavailable = false; latestError = null; race = true; attempted = false; vi.clearAllMocks(); });
const methods = [
  { name: "필드 비교", save: () => updateCells("r1", { note: initial.note }, { note: "내 비고" }) },
  { name: "버전 비교", save: () => updateRegistration("r1", 2, { note: "내 비고" }) },
];
describe.each(methods)("$name 충돌 이후 최신 읽기", ({ save }) => {
  it.each([null, { message: "offline" }])("읽을 수 없으면 이전 행을 최신이라고 반환하지 않는다 (%o)", async (error) => {
    unavailable = true; latestError = error;
    const result = await save();
    expect(result).toMatchObject({ ok: false, conflict: true, message: expect.stringContaining("불러오지 못했습니다") });
    if (result.ok) throw new Error("Expected rejected stale write");
    expect(result.latest).toBeUndefined();
    expect(current.note).toBe("다른 기기의 비고");
    expect(update).toHaveBeenCalledTimes(1);
  });
  it("최신 읽기가 성공했을 때만 실제 최신 행을 반환한다", async () => {
    const result = await save();
    expect(result).toMatchObject({ ok: false, conflict: true, latest: { version: 3, note: "다른 기기의 비고" } });
    expect(current.note).toBe("다른 기기의 비고");
  });
});
