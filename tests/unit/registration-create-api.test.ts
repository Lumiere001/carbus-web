import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompleteRegistration } from "@/lib/registrations/create";
import { currentEventId } from "@/lib/events/current";
import type { CreateRegistrationInput } from "@/lib/registrations/create-schema";

const rpc = vi.fn<(name: string, args: unknown) => Promise<{ data: string | null; error: { code: string; message: string } | null }>>();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/lib/events/current", () => ({ currentEventId: vi.fn() }));
const eventId = "10000000-0000-4000-8000-000000000001";
const input = (): CreateRegistrationInput => ({ name: "학우", student_id: "26", campus_id: "20000000-0000-4000-8000-000000000001", up_trip_id: null, down_trip_id: null, payment_status: "unpaid", note: null, attend_from: null, attend_to: null, legs: [], pickups: [], courses: [] });
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: eventId, error: null }); vi.mocked(currentEventId).mockResolvedValue({ ok: true, id: eventId }); });

describe("완전한 신청 추가 경계", () => {
  it.each([{ roles: ["driver"] }, { fee: 1 }, { assigned_up_bus_id: 7 }, { attend_from: "2026-10-12", attend_to: "2026-10-10" }])("권한 또는 형식이 다른 필드는 쓰기 전에 거부한다 (%o)", async (patch) => {
    // Given / When
    const result = await createCompleteRegistration({ ...input(), ...patch }, eventId);
    // Then
    expect(result.ok).toBe(false); expect(rpc).not.toHaveBeenCalled();
  });
  it("DB 저장 실패는 성공 ID를 반환하지 않는다", async () => {
    // Given
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "course failure" } });
    // When
    const result = await createCompleteRegistration(input(), eventId);
    // Then
    expect(result).toMatchObject({ ok: false, uncertain: false });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_registration_complete", { p_event_id: eventId, p_input: input() });
  });
  it("네트워크 오류는 저장 여부가 불명확하다고 반환한다", async () => {
    // Given
    rpc.mockResolvedValue({ data: null, error: { code: "", message: "fetch failed" } });
    // When
    const result = await createCompleteRegistration(input(), eventId);
    // Then
    expect(result).toMatchObject({ ok: false, uncertain: true });
  });
  it("확정 대기 타지구의 지구 선택 누락을 쓰기 전에 거부한다", async () => {
    // Given / When
    const result = await createCompleteRegistration({ ...input(), legs: [{ direction: "up", mode: "other_district", status: "pending", via_unit_id: null }] }, eventId);
    // Then
    expect(result.ok).toBe(false); expect(rpc).not.toHaveBeenCalled();
  });
  it("화면을 연 뒤 활성 행사가 바뀌면 다른 행사에 신청을 만들지 않는다", async () => {
    vi.mocked(currentEventId).mockResolvedValue({ ok: true, id: "10000000-0000-4000-8000-000000000002" });
    const result = await createCompleteRegistration(input(), eventId);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("행사가 바뀌었습니다") });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("행사 없는 화면의 신청은 쓰기 전에 거부한다", async () => {
    const result = await createCompleteRegistration(input(), null);
    expect(result.ok).toBe(false);
    expect(currentEventId).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
