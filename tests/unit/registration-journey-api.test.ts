import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveRegistrationJourney, type RegistrationJourneySnapshot } from "@/lib/registrations/journey";
import type { RegistrationRow } from "@/lib/registrations/mutations";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
const snapshot: RegistrationJourneySnapshot = { version: 1, attend_from: null, attend_to: null,
  attend_from_at: null, attend_to_at: null, up_trip_id: null, down_trip_id: null, legs: [] };
const plan = { attend_from: null, attend_to: null, attend_from_at: "2026-10-10T09:30", attend_to_at: "2026-10-12T19:40" };
const trips = { up_trip_id: 1, down_trip_id: null };
const legs = [{ direction: "up", mode: "our_bus", via_unit_id: null, status: "confirmed" },
  { direction: "down", mode: "own_car", via_unit_id: null, status: "confirmed" }] as const;
const row: RegistrationRow = { id: "10000000-0000-4000-8000-000000000001", event_id: "e1", name: "합성 인원", student_id: "26", campus_id: "c1",
  attendance_type: "oneway", up_trip_id: 1, down_trip_id: null, departure_slot_id: 1, uses_return_bus: false,
  assigned_up_bus_id: null, assigned_down_bus_id: null, attend_from: null, attend_to: null,
  attend_from_at: "2026-10-10T00:30:00Z", attend_to_at: "2026-10-12T10:40:00Z", payment_status: "paid", fee: 50000,
  roles: [], participation_status: "registered", cancelled_at: null, cancel_reason: null, cancelled_by: null,
  checked_in: false, checked_out: false, created_by: null, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z",
  version: 2, note: null, home_unit_id: null };
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: { row, legs: [...legs] }, error: null }); });

describe("원자적 참여 일정 편집 API", () => {
  it("관찰한 날짜·시각·편·원본 수단과 새 여정을 한 번에 보내고 동일 트랜잭션 결과를 쓴다", async () => {
    // Given / When
    const result = await saveRegistrationJourney(row.id, snapshot, plan, trips, legs);
    // Then
    expect(result).toEqual({ ok: true, row, legs });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("save_registration_journey", { p_registration_id: row.id,
      p_expected: snapshot, p_input: { ...plan, ...trips, attend_from_at: "2026-10-10T09:30:00+09:00", attend_to_at: "2026-10-12T19:40:00+09:00", legs } });
  });
  it("수단이 없는 방향은 RPC 전에 거부한다", async () => {
    // Given / When
    const result = await saveRegistrationJourney(row.id, snapshot, plan, trips, []);
    // Then
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("이동수단") });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["40001", "40P01"])("%s 충돌 시 성공이나 자동 재시도를 반환하지 않는다", async (code) => {
    // Given
    rpc.mockResolvedValue({ data: null, error: { code, message: "다른 변경" } });
    // When
    const result = await saveRegistrationJourney(row.id, snapshot, plan, trips, legs);
    // Then
    expect(result).toMatchObject({ ok: false, conflict: true, uncertain: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("통신 오류는 저장 결과가 불명확하다고 돌려준다", async () => {
    // Given
    rpc.mockResolvedValue({ data: null, error: { code: "", message: "fetch failed" } });
    // When
    const result = await saveRegistrationJourney(row.id, snapshot, plan, trips, legs);
    // Then
    expect(result).toMatchObject({ ok: false, uncertain: true });
  });
});
