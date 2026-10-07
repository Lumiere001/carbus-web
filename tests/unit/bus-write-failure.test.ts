import { beforeEach, describe, expect, it, vi } from "vitest";
import { setDriver, setFixedPassengers } from "@/lib/admin/buses";
import type { BusRow } from "@/lib/admin/buses";

type RpcResult = { data: BusRow | null; error: { code: string; message: string } | null };
const single = vi.fn<() => Promise<RpcResult>>();
const rpc = vi.fn<(name: string, args: unknown) => { single: typeof single }>(() => ({ single }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
const personId = "10000000-0000-4000-8000-000000000001";
const state = { busId: 2, mode: "down", driverId: personId, fixedIds: [personId] } as const;
const row = { id: 2, name: "2호차", event_id: "e1", kind: "staff_car", capacity: 3, hard_cap: 3,
  up_trip_id: 1, down_trip_id: 2, driver_registration_id: null, down_driver_registration_id: null,
  fixed_passenger_ids: [], down_fixed_passenger_ids: [], is_cohesion_exempt: false,
  fill_priority: 0, display_order: 0 } satisfies BusRow;
beforeEach(() => { rpc.mockClear(); single.mockReset().mockResolvedValue({ data: row, error: null }); });

describe("호차 리더 원자적 저장", () => {
  it("기사 해제는 운영자가 본 기사와 고정 명단을 함께 비교한다", async () => {
    // Given / When
    const result = await setDriver(state, null);
    // Then
    expect(result).toEqual({ ok: true, row });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_bus_binding", {
      p_bus_id: 2, p_mode: "down", p_intent: { kind: "driver", driver_id: null,
        expected_driver_id: personId, expected_fixed_ids: [personId] },
    });
  });

  it.each(["40001", "40P01", "P0001", "42501"])("고정 명단의 %s 실패는 성공으로 반환되지 않는다", async (code) => {
    // Given
    single.mockResolvedValue({ data: null, error: { code, message: "binding conflict" } });
    // When
    const result = await setFixedPassengers(state, []);
    // Then
    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_bus_binding", {
      p_bus_id: 2, p_mode: "down", p_intent: { kind: "fixed", fixed_ids: [],
        expected_driver_id: personId, expected_fixed_ids: [personId] },
    });
  });
});
