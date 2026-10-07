import type { z } from "zod";
import type { batchSnapshotSchema } from "@/lib/batch/snapshot";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { runBatchAction } from "@/app/admin/(protected)/e/[eventId]/batch/actions";
import { viewingEventId } from "@/lib/events/server";
import { writableEventId } from "@/lib/events/current";

const eventId = "18650503-b0fa-4d8e-ab16-72eb47c8c384";
const personIds = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002"];
type Snapshot = z.infer<typeof batchSnapshotSchema>;
const registrations: Snapshot["registrations"] = personIds.map((id, index) => ({
  id, name: `학우${index}`, campus_id: "20000000-0000-4000-8000-000000000001",
  attendance_type: "oneway", up_trip_id: index + 1, down_trip_id: null,
  assigned_up_bus_id: null, assigned_down_bus_id: null,
}));
const buses: Snapshot["buses"] = [1, 2].map((id) => ({
  id, name: `${id}호차`, capacity: 44, hard_cap: 45, up_trip_id: id, down_trip_id: null,
  driver_registration_id: null, fixed_passenger_ids: [], down_driver_registration_id: null,
  down_fixed_passenger_ids: [], is_cohesion_exempt: false, fill_priority: 0, kind: "bus",
}));
const fixture = (): Snapshot => ({ event_id: eventId, revision: "9007199254740993", registrations, buses, trips: [] });
type RpcResult = { data: unknown; error: { code: string; message: string } | null };
const rpc = vi.fn<(name: string, args: unknown) => Promise<RpcResult>>();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/events/server", () => ({ viewingEventId: vi.fn() }));
vi.mock("@/lib/events/current", () => ({ writableEventId: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-master" } } }) },
    from: (table: string) => {
      if (table !== "profiles") throw new Error("Independent table writes are forbidden");
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: "master" }, error: null }) }) }) };
    },
    rpc,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async (name) => ({ data: name === "get_batch_snapshot" ? fixture() : null, error: null }));
  vi.mocked(viewingEventId).mockResolvedValue(eventId);
  vi.mocked(writableEventId).mockResolvedValue({ ok: true, id: eventId });
});

describe("배차 원자적 저장", () => {
  it("행사를 확인하지 못하면 배정을 저장하지 않는다", async () => {
    // Given
    vi.mocked(viewingEventId).mockResolvedValue(null);
    vi.mocked(writableEventId).mockResolvedValue({ ok: false, message: "행사 없음" });
    // When
    const result = await runBatchAction("up");
    // Then
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["P0001", "40001", "40P01"])("DB 트랜잭션이 %s로 실패하면 성공을 반환하지 않는다", async (code) => {
    // Given
    rpc.mockImplementation(async (name) => ({ data: fixture(), error: name === "save_batch" ? { code, message: "injected failure" } : null }));
    // When
    const result = await runBatchAction("up");
    // Then
    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/e/${eventId}`, "layout");
  });

  it("저장 성공은 동일 스냅샷 버전과 행사로 결과를 보내고 화면을 갱신한다", async () => {
    // Given / When
    const result = await runBatchAction("up");
    // Then
    expect(result).toMatchObject({ ok: true, total_assigned: 2 });
    expect(rpc).toHaveBeenLastCalledWith("save_batch", expect.objectContaining({
      p_event_id: eventId, p_mode: "up", p_expected_revision: "9007199254740993",
      p_assignments: { [personIds[0]]: 1, [personIds[1]]: 2 }, p_errors: [],
    }));
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(`/admin/e/${eventId}`, "layout");
  });

  it("엔진 오류가 있어도 가능한 배정을 같은 트랜잭션으로 저장한다", async () => {
    // Given
    const snapshot = fixture();
    snapshot.registrations = registrations.map((r) => ({ ...r, up_trip_id: 99 }));
    rpc.mockImplementation(async (name) => ({ data: name === "get_batch_snapshot" ? snapshot : null, error: null }));
    // When
    const result = await runBatchAction("up");
    // Then
    expect(result).toMatchObject({ ok: true, total_assigned: 0 });
    if (!result.ok) throw new Error("The partial result must save");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(rpc).toHaveBeenLastCalledWith("save_batch", expect.objectContaining({
      p_assignments: { [personIds[0]]: null, [personIds[1]]: null }, p_errors: result.errors,
    }));
  });

  it("간사 차에 고정된 미신청자도 배차 저장 결과에 포함한다", async () => {
    // Given
    const snapshot = fixture();
    snapshot.registrations = registrations.map((r) => ({ ...r, attendance_type: "self", up_trip_id: null }));
    snapshot.buses = buses.map((b) => ({ ...b, kind: "staff_car", fixed_passenger_ids: [personIds[b.id - 1]] }));
    rpc.mockImplementation(async (name) => ({ data: name === "get_batch_snapshot" ? snapshot : null, error: null }));
    // When
    const result = await runBatchAction("up");
    // Then
    expect(result).toMatchObject({ ok: true, total_assigned: 2 });
    expect(rpc).toHaveBeenLastCalledWith("save_batch", expect.objectContaining({ p_assignments: { [personIds[0]]: 1, [personIds[1]]: 2 } }));
  });

  it("간사 차량 종류가 누락된 스냅샷은 저장 전에 거부한다", async () => {
    // Given
    rpc.mockResolvedValue({ data: { ...fixture(), buses: buses.map((b) => ({ ...b, kind: undefined })) }, error: null });
    // When
    const result = await runBatchAction("up");
    // Then
    expect(result.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
