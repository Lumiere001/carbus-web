// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnsiteProvider } from "@/components/onsite/onsite-provider";
import { OnsiteAttendance } from "@/components/onsite/onsite-attendance";
import { onsiteSnapshotSchema } from "@/lib/onsite/model";
import type { Json } from "@/lib/supabase/database.types";

const reg = "f3000000-0000-4000-8000-000000000001";
const event = "f3000000-0000-4000-8000-000000000002";
const visitId = "f3000000-0000-4000-8000-000000000003";
type Reply = { data: Json | null; error: { code: string; message: string } | null };
const rpc = vi.fn<(name: string, input: unknown) => Promise<Reply>>();
const channel = { on: vi.fn(), subscribe: vi.fn() };
channel.on.mockReturnValue(channel); channel.subscribe.mockReturnValue(channel);
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, channel: () => channel, removeChannel: vi.fn() }) }));
const confirmed = [{ registration_id: reg, revision: 1, visits: [{ id: visitId, visit_number: 1, version: 1,
  arrived_at: "2026-10-07T03:30:00+00:00", departed_at: null }] }];
function mount(canEdit = true) {
  render(<OnsiteProvider eventId={event} initial={onsiteSnapshotSchema.parse([{ registration_id: reg, revision: 0, visits: [] }])} canEdit={canEdit}>
    <OnsiteAttendance registrationId={reg} name="검증 학우" startsOn="2026-10-07" endsOn="2026-10-09" />
  </OnsiteProvider>);
}
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: confirmed, error: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("현장 기록 확인", () => {
  it("보이는 지난 행사 화면은 실시간 전달이 없어도 최신 기록을 다시 읽는다", async () => {
    // Given an idle onscreen snapshot and no Realtime delivery
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    mount();
    expect(screen.getByText("미확인")).toBeInTheDocument();
    // When the fallback read interval elapses
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    // Then server-confirmed state replaces the older local snapshot
    expect(rpc).toHaveBeenCalledExactlyOnceWith("onsite_snapshot", { p_event: event, p_reg_ids: [reg] });
    expect(screen.getByText("행사장에 있음")).toBeInTheDocument();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(rpc).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("저장 중에는 완료 시각을 만들지 않고 서버 성공 이후에만 KST로 표시한다", async () => {
    // Given a response still in flight
    let complete: ((reply: Reply) => void) | undefined;
    rpc.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; })); mount();
    // When arrival is checked
    await userEvent.click(screen.getByRole("button", { name: "검증 학우 행사장 도착 체크" }));
    // Then the action stays pending until the server confirms it
    expect(screen.getByRole("status")).toHaveTextContent("저장 중");
    expect(screen.queryByText("행사장에 있음")).not.toBeInTheDocument();
    await act(async () => { complete?.({ data: confirmed, error: null }); });
    expect(screen.getByText("행사장에 있음")).toBeInTheDocument();
    expect(screen.getByLabelText("검증 학우 현장 기록")).toHaveTextContent(/도착.*12:30/);
  });
  it("통신 결과가 불명확하면 새 체크를 막고 같은 UUID로 저장 여부를 확인한다", async () => {
    // Given an unknown transport result
    rpc.mockResolvedValueOnce({ data: null, error: { code: "", message: "transport unavailable" } }); mount();
    // When checking arrival and retrying the uncertain request
    await userEvent.click(screen.getByRole("button", { name: "검증 학우 행사장 도착 체크" }));
    expect(screen.getByRole("button", { name: "검증 학우 행사장 떠남 체크" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "같은 요청 확인" }));
    // Then retry uses the exact original request identity and payload
    expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
    expect(screen.getByText("행사장에 있음")).toBeInTheDocument();
  });
  it("다른 기기의 변경 충돌이면 최신 기록을 읽고 저장했다고 표시하지 않는다", async () => {
    // Given a stale revision
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "다른 기기 변경" } }); mount();
    // When arrival is checked
    await userEvent.click(screen.getByRole("button", { name: "검증 학우 행사장 도착 체크" }));
    // Then server conflict persists while latest confirmed history is loaded
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("다른 기기 변경"));
    expect(rpc.mock.calls[1]?.[0]).toBe("onsite_snapshot");
    expect(screen.queryByRole("button", { name: "같은 요청 확인" })).not.toBeInTheDocument();
  });
  it("조회 전용 역할에는 체크 행동을 노출하지 않는다", () => {
    // Given read-only scope
    mount(false);
    // When the control renders
    // Then both write actions are absent
    expect(screen.queryByRole("button", { name: /체크/ })).not.toBeInTheDocument();
  });
});
