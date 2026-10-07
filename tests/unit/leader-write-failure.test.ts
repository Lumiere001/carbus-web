import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignDriverBus, assignFixedBus, setLeaderRole } from "@/lib/admin/leaders";

type RpcResult = { error: { code: string; message: string } | null };
const rpc = vi.fn<(name: string, args: unknown) => Promise<RpcResult>>();
const personId = "10000000-0000-4000-8000-000000000001";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
beforeEach(() => rpc.mockReset().mockResolvedValue({ error: null }));

describe("리더 원자적 저장", () => {
  it.each(["up", "down"] as const)("%s 순장 이동 실패는 성공으로 반환되지 않는다", async (mode) => {
    // Given
    rpc.mockResolvedValue({ error: { code: "P0001", message: "target conflict" } });
    // When
    const result = await assignDriverBus(personId, 2, mode);
    // Then
    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_leader_binding", {
      p_registration_id: personId, p_kind: "driver", p_operation: "assign", p_mode: mode, p_bus_id: 2,
    });
  });

  it.each(["driver", "fixed"] as const)("%s 양방향 토글은 하나의 저장 결과만 반환한다", async (kind) => {
    // Given
    rpc.mockResolvedValue({ error: { code: "P0001", message: "down or staff synchronization failure" } });
    // When
    const result = await setLeaderRole({ regId: personId, ridesUp: true, upBusId: 1,
      ridesDown: true, downBusId: 2, kind, on: true });
    // Then
    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_leader_binding", {
      p_registration_id: personId, p_kind: kind, p_operation: "enable",
    });
  });

  it.each(["driver", "fixed"] as const)("%s 역할 해제도 한 트랜잭션으로 요청한다", async (kind) => {
    // Given / When
    const result = await setLeaderRole({ regId: personId, ridesUp: true, upBusId: 1,
      ridesDown: true, downBusId: 2, kind, on: false });
    // Then
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_leader_binding", {
      p_registration_id: personId, p_kind: kind, p_operation: "disable",
    });
  });

  it("고정탑승 해제는 NULL 호차 기본값을 사용하는 원자적 요청이다", async () => {
    // Given / When
    const result = await assignFixedBus(personId, null, "up");
    // Then
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("set_leader_binding", {
      p_registration_id: personId, p_kind: "fixed", p_operation: "assign", p_mode: "up",
    });
  });

  it.each(["40001", "40P01"])("%s 충돌은 재시도 가능한 실패로 반환한다", async (code) => {
    // Given
    rpc.mockResolvedValue({ error: { code, message: "concurrent change" } });
    // When
    const result = await assignFixedBus(personId, 2, "up");
    // Then
    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
