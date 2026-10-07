import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertRegistration } from "@/lib/registrations/mutations";
import { parseRegistrationsCsv } from "@/lib/csv/parse";

const { rpc, insert, single, client } = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn(), single: vi.fn(), client: vi.fn() }));
const query = { select: () => query, eq: () => query, insert: (input: unknown) => { insert(input); return query; }, single };
vi.mock("@/lib/supabase/client", () => ({ createClient: () => { client(); return { from: () => query, rpc }; } }));
const event = "10000000-0000-4000-8000-000000000001";
const campus = "20000000-0000-4000-8000-000000000001";
const base = { event_id: event, campus_id: campus, name: "합성 학우", student_id: "26", up_trip_id: 1, down_trip_id: 2 };
beforeEach(() => {
  vi.clearAllMocks(); rpc.mockResolvedValue({ data: "new-id", error: null });
  single.mockResolvedValue({ data: { id: "new-id" }, error: null });
});

describe("직접·CSV 등록의 마지막 입력 경계", () => {
  it("메모만으로 빠진 방향의 이동수단을 대신하지 못한다", async () => {
    // Given / When
    const result = await insertRegistration({ ...base, down_trip_id: null, note: "자차 귀가" });
    // Then
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("이동수단") });
    expect(client).not.toHaveBeenCalled();
  });
  it("왕복 전 일정의 기존 직접 등록은 시각을 생성하지 않는다", async () => {
    // Given / When
    const result = await insertRegistration(base);
    // Then
    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledExactlyOnceWith(base);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("방향별 부가 정보가 없어도 계획 일시는 검증한 생성 RPC로 보낸다", async () => {
    // Given / When
    const result = await insertRegistration({ ...base, attend_from_at: "2026-10-10T00:00:00+09:00", attend_to_at: "2026-10-12T19:40:00+09:00" });
    // Then
    expect(result.ok).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][0]).toBe("create_registration_complete");
  });
  it("CSV의 확정 기간과 이동수단은 등록·수단 행을 한 번의 RPC로 함께 만든다", async () => {
    // Given
    const trips = [{ id: 1, key: "up", label: "상행", direction: "up" as const, active: true },
      { id: 2, key: "down", label: "하행", direction: "down" as const, active: true }];
    const csv = "이름,학번,상행 출발,하행 출발,참여 시작 일시,참여 종료 일시,하행 이동수단\n합성 학우,26,상행,,2026-10-10T09:30,2026-10-12T19:40,own_car";
    const parsed = parseRegistrationsCsv(csv, campus, trips);
    // When
    const result = await insertRegistration({ ...parsed.successes[0], campus_id: campus, event_id: event });
    // Then
    expect(parsed.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_registration_complete", { p_event_id: event, p_input: {
      name: "합성 학우", student_id: "26", campus_id: campus, up_trip_id: 1, down_trip_id: null,
      payment_status: "unpaid", note: null, attend_from: null, attend_to: null,
      attend_from_at: "2026-10-10T09:30:00+09:00", attend_to_at: "2026-10-12T19:40:00+09:00",
      legs: [{ direction: "down", mode: "own_car", via_unit_id: null, status: "confirmed" }], pickups: [], courses: [],
    } });
  });
});
