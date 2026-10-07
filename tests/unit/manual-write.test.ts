import { beforeEach, describe, expect, it, vi } from "vitest";
import { setAttendancePlan } from "@/lib/admin/pickup";
import { setAssignment, setRoles } from "@/lib/admin/registrations";
import type { RegistrationInsert, RegistrationRow } from "@/lib/registrations/mutations";
import { z } from "zod";
import { registrationLegSchema } from "@/lib/registrations/create-schema";

const id = "10000000-0000-4000-8000-000000000001";
const initial = { id, event_id: "e1", name: "합성 인원", student_id: "26", campus_id: "c1", attendance_type: "roundtrip",
  up_trip_id: 1, down_trip_id: 2, departure_slot_id: 1, uses_return_bus: true,
  assigned_up_bus_id: null, assigned_down_bus_id: null, attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null,
  payment_status: "unpaid", fee: 50000, roles: ["먼저 추가한 역할"], participation_status: "registered",
  cancelled_at: null, cancel_reason: null, cancelled_by: null, checked_in: false, checked_out: false,
  created_by: null, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z",
  version: 2, note: null, home_unit_id: null } satisfies RegistrationRow;
// This narrow in-memory database adapter applies the same atomic version predicate as PostgREST.
let current: RegistrationRow = initial;
const select = () => ({ eq: () => ({ maybeSingle: async () => ({ data: current, error: null }) }) });
const update = vi.fn((patch: Partial<RegistrationInsert>) => ({
  eq: () => ({ eq: (_column: string, expectedVersion: number) => ({ select: () => ({ maybeSingle: async () => {
    if (current.version !== expectedVersion) return { data: null, error: null };
    current = { ...current, ...patch, version: current.version + 1 };
    return { data: current, error: null };
  } }) }) }),
}));
const journeyArgs = z.object({ p_input: z.object({ attend_from: z.string().nullable(), attend_to: z.string().nullable(),
  attend_from_at: z.string().nullable(), attend_to_at: z.string().nullable(), up_trip_id: z.number().nullable(), down_trip_id: z.number().nullable(),
  legs: z.array(registrationLegSchema) }) });
const rpc = vi.fn<(name: string, args: unknown) => Promise<{ error: { code: string; message: string } | null;
  data?: { row: RegistrationRow; legs: z.infer<typeof registrationLegSchema>[] } }>>();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: (table: string) => table === "transport_legs" ? { select: () => ({ eq: async () => ({ data: [], error: null }) }) } : { select, update }, rpc }) }));
beforeEach(() => {
  current = { ...initial, roles: [...initial.roles] }; update.mockClear(); rpc.mockReset().mockImplementation(async (name, args) => {
    if (name !== "save_registration_journey") return { error: null };
    const { legs, ...plan } = journeyArgs.parse(args).p_input;
    current = { ...current, ...plan, version: current.version + 1 };
    return { data: { row: current, legs }, error: null };
  });
});

describe("수동 배정·일반 역할 저장", () => {
  it.each(["40001", "40P01", "23514", "P0001"])("배정의 %s 실패는 성공으로 반환하지 않는다", async (code) => {
    // Given
    rpc.mockResolvedValue({ error: { code, message: "manual assignment rejected" } });
    const expected = { up_trip_id: 1, down_trip_id: 2, assigned_up_bus_id: null, assigned_down_bus_id: null };
    // When
    const result = await setAssignment(id, expected, { assigned_up_bus_id: 1 });
    // Then
    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_manual_assignment", { p_registration_id: id,
      p_expected: expected, p_assignments: { assigned_up_bus_id: 1 } });
  });

  it("다른 기기가 먼저 추가한 일반 역할을 낡은 배열로 지우지 않는다", async () => {
    // Given: The second device still sees an empty array, while the first device committed a label.
    // When
    const result = await setRoles(id, [], ["뒤에 추가한 역할"]);
    // Then
    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(current.roles).toEqual(["먼저 추가한 역할"]);
    expect(update).not.toHaveBeenCalled();
  });

  it("최신 역할 배열을 읽고 재시도하면 두 기기의 역할을 함께 보존한다", async () => {
    // Given
    const observed = [...current.roles];
    // When
    const result = await setRoles(id, observed, [...observed, "뒤에 추가한 역할"]);
    // Then
    expect(result.ok).toBe(true);
    expect(current.roles).toEqual(["먼저 추가한 역할", "뒤에 추가한 역할"]);
    expect(current.version).toBe(3);
  });
  it("이미 바뀐 참여 기간은 낡은 두 날짜로 덮어쓰지 않는다", async () => {
    current = { ...current, attend_from: "2026-10-07", attend_to: "2026-10-09" };
    const result = await setAttendancePlan(id, { attend_from: "2026-10-08", attend_to: "2026-10-10", attend_from_at: "2026-10-08T09:30:00+09:00", attend_to_at: "2026-10-10T19:40:00+09:00" }, { attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null });
    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(update).not.toHaveBeenCalled();
    expect(current.attend_from).toBe("2026-10-07");
    expect(current.attend_to).toBe("2026-10-09");
  });
  it("RPC에서 참여 기간이 충돌하면 최신 행을 읽고 재시도 없이 반환한다", async () => {
    // Given
    rpc.mockImplementationOnce(async () => {
      current = { ...current, attend_from: "2026-10-08", attend_to: "2026-10-10", version: 3 };
      return { error: { code: "40001", message: "다른 곳에서 기간이 바뀌었습니다" } };
    });
    // When
    const result = await setAttendancePlan(id, { attend_from: "2026-10-07", attend_to: "2026-10-09", attend_from_at: "2026-10-07T09:30:00+09:00", attend_to_at: "2026-10-09T19:40:00+09:00" },
      { attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null });
    // Then
    expect(result).toMatchObject({ ok: false, conflict: true, latest: current });
    expect(rpc).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
  it("새 참여 기간의 두 날짜를 기존 버전으로 함께 저장하고 다른 칸을 보존한다", async () => {
    const result = await setAttendancePlan(id, { attend_from: "2026-10-07", attend_to: "2026-10-09", attend_from_at: "2026-10-07T09:30:00+09:00", attend_to_at: "2026-10-09T19:40:00+09:00" }, { attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null });
    expect(result.ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][0]).toBe("save_registration_journey");
    expect(current.attend_from_at).toBe("2026-10-07T09:30:00+09:00");
    expect(current.roles).toEqual(initial.roles);
    expect(current.version).toBe(3);
  });

});
