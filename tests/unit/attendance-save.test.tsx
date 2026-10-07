// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusAttendance } from "@/components/campus/bus-attendance";

const { rpc, readLatest, realtime, subscribed, channelName } = vi.hoisted(() => ({ rpc: vi.fn(), readLatest: vi.fn(), subscribed: vi.fn(), channelName: vi.fn(), realtime: { receive: null as null | ((payload: { new: { id: string; checked_in: boolean; checked_out: boolean; version: number } }) => void) } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  channel: (name: string) => { channelName(name); return { on: (event: string, filter: object, receive: NonNullable<typeof realtime.receive>) => { subscribed(event, filter); realtime.receive = receive; return { subscribe: () => ({}) }; } }; },
  removeChannel: vi.fn(), rpc, from: () => ({ select: () => ({ eq: () => ({ single: readLatest }) }) }),
}) }));
const MEMBER = { id: "m1", name: "테스트 참석자", student_id: "26", checked_in: false, checked_out: false, version: 1 };
function mount() { render(<BusAttendance upGroups={[[1, [MEMBER]]]} downGroups={[[1, [MEMBER]]]} buses={[{ id: 1, name: "1호차", up_trip_id: 1 }]} slots={[{ id: 1, label: "오전 출발" }]} />); }
beforeEach(() => { rpc.mockReset(); subscribed.mockReset(); channelName.mockReset(); readLatest.mockReset().mockResolvedValue({ data: {...MEMBER, checked_in: true, version: 2}, error: null }); realtime.receive = null; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("출석 저장 실패와 겹치는 입력", () => {
  it("응답을 기다리는 동안 같은 사람·방향의 중복 요청을 막는다", async () => {
    let finish!: (value: { error: null }) => void;
    rpc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mount(); const button = screen.getByRole("button", { name: /테스트 참석자/ });
    fireEvent.click(button); fireEvent.click(button);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(button).toHaveProperty("disabled", true);
    await act(async () => { finish({ error: null }); });
    expect(screen.getByRole("button", { name: /테스트 참석자/ })).toHaveProperty("disabled", false);
  });
  it("실패한 사람 옆에 오류를 유지하고 다시 누르면 성공을 반영한다", async () => {
    vi.useFakeTimers(); rpc.mockResolvedValueOnce({ error: { message: "blocked" } }).mockResolvedValueOnce({ error: null });
    mount(); await act(async () => { fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ })); });
    expect(screen.getByRole("alert").textContent).toContain("테스트 참석자");
    expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("false");
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("alert")).toBeDefined();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ })); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("true");
  });
  it("상행의 늦은 실패가 먼저 성공한 하행 체크를 덮지 않는다", async () => {
    let failUp!: (value: { error: { message: string } }) => void;
    rpc.mockImplementation((_name, args) => args.p_field === "checked_in"
      ? new Promise((resolve) => { failUp = resolve; }) : Promise.resolve({ error: null }));
    readLatest.mockResolvedValue({ data: {...MEMBER, checked_out: true, version: 2}, error: null });
    mount(); fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ }));
    fireEvent.click(screen.getByRole("button", { name: /하행 \(/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ })); });
    await act(async () => { failUp({ error: { message: "blocked" } }); });
    expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("출석 읽기 권한과 실시간 범위", () => {
  it("캠퍼스 조회 화면에서 사람을 눌러도 출석을 쓰지 않는다", () => {
    // Given
    render(<BusAttendance campusId="campus-a" editable={false} upGroups={[[1, [MEMBER]]]} downGroups={[]} buses={[]} slots={[]} />);
    // When
    fireEvent.click(screen.getByText(MEMBER.name));
    // Then
    expect(rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /테스트 참석자/ })).toBeNull();
  });

  it("캠퍼스 조회 화면은 같은 캠퍼스 구독의 확인된 값을 갱신한다", () => {
    // Given
    render(<BusAttendance campusId="campus-a" editable={false} upGroups={[[1, [MEMBER]]]} downGroups={[]} buses={[]} slots={[]} />);
    // When
    act(() => { realtime.receive?.({ new: { ...MEMBER, checked_in: true, version: 2 } }); });
    // Then
    expect(screen.getByText("출발 버스 1/1")).toBeDefined();
    expect(channelName).toHaveBeenCalledWith("bus-attendance:campus-a");
    expect(subscribed).toHaveBeenCalledWith("postgres_changes", {
      event: "UPDATE", schema: "public", table: "registrations", filter: "campus_id=eq.campus-a",
    });
  });

  it("전체 캠퍼스 구독에서 명단 밖 값은 나중에 합류한 사람의 서버 값을 덮지 않는다", () => {
    // Given
    const view = render(<BusAttendance upGroups={[[1, [MEMBER]]]} downGroups={[]} buses={[]} slots={[]} />);
    const newcomer = { ...MEMBER, id: "outside-roster", name: "새 참석자" };
    act(() => { realtime.receive?.({ new: { ...newcomer, checked_in: true, version: 2 } }); });
    // When
    view.rerender(<BusAttendance upGroups={[[1, [MEMBER, newcomer]]]} downGroups={[]} buses={[]} slots={[]} />);
    // Then
    expect(screen.getByRole("button", { name: /새 참석자/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("출발 버스 0/2")).toBeDefined();
    expect(channelName).toHaveBeenCalledWith("bus-attendance:all");
    expect(subscribed).toHaveBeenCalledWith("postgres_changes", {
      event: "UPDATE", schema: "public", table: "registrations",
    });
  });
});


describe("출석의 확인된 상태", () => {
 it("저장 응답 전에는 완료 표시와 집계를 올리지 않는다", async () => {
  let finish!: (value: {error: null}) => void;
  rpc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mount(); fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ }));
  expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByText("출발 버스 0/1")).toBeDefined();
  await act(async () => { finish({error: null}); });
  expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("true");
 });
 it("늦은 실패가 다른 기기의 확인된 체크를 되돌리지 않는다", async () => {
  let finish!: (value: {error: {message: string}}) => void;
  rpc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mount(); fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ }));
  act(() => { realtime.receive?.({new: {...MEMBER, checked_in: true, version: 2}}); });
  await act(async () => { finish({error: {message: "timeout"}}); });
  expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("true");
 });
 it("응답이 늦어도 이미 받은 다른 기기의 체크 해제를 덮지 않는다", async () => {
  let finish!: (value: {error: null}) => void;
  rpc.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  mount(); fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ }));
  act(() => { realtime.receive?.({new: {...MEMBER, checked_in: true, version: 2}}); realtime.receive?.({new: {...MEMBER, version: 3}}); });
  await act(async () => { finish({error: null}); });
  expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("false");
 });
 it("새로 합류한 참석자의 서버 값과 체크 동작을 유지한다", async () => {
  rpc.mockResolvedValue({error: null});
  const view = render(<BusAttendance upGroups={[]} downGroups={[]} buses={[]} slots={[]} />);
  const member = {...MEMBER, checked_in: true, version: 2};
  readLatest.mockResolvedValue({data: {...MEMBER, version: 3}, error: null});
  view.rerender(<BusAttendance upGroups={[[1, [member]]]} downGroups={[]} buses={[{id: 1, name: "1호차", up_trip_id: 1}]} slots={[]} />);
  expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("true");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ })); });
  expect(rpc).toHaveBeenCalledWith("set_attendance", {p_reg_id: MEMBER.id, p_field: "checked_in", p_value: false});
 });
 it("기존 참석자의 새 서버 체크 값과 다음 해제 요청을 반영한다", async () => {
  // Given: Same attendee already exists with an unchecked initial snapshot.
  rpc.mockResolvedValue({error: null});
  const view = render(<BusAttendance upGroups={[[1, [MEMBER]]]} downGroups={[]} buses={[{id: 1, name: "1호차", up_trip_id: 1}]} slots={[]} />);
  // When: Returning to the page refreshes this existing attendee's authoritative value.
  const refreshed = {...MEMBER, checked_in: true, version: 2};
  readLatest.mockResolvedValue({data: {...MEMBER, version: 3}, error: null});
  view.rerender(<BusAttendance upGroups={[[1, [refreshed]]]} downGroups={[]} buses={[{id: 1, name: "1호차", up_trip_id: 1}]} slots={[]} />);
  // Then: It renders the confirmed check and the next action clears it.
  expect(screen.getByRole("button", { name: /테스트 참석자/ }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("출발 버스 1/1")).toBeDefined();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /테스트 참석자/ })); });
  expect(rpc).toHaveBeenCalledWith("set_attendance", {p_reg_id: MEMBER.id, p_field: "checked_in", p_value: false});
 });


 it("확인된 실시간 버전보다 늦게 온 낡은 서버 값은 되돌리지 않는다", () => {
  // Given
  const view = render(<BusAttendance upGroups={[[1, [MEMBER]]]} downGroups={[]} buses={[]} slots={[]} />);
  act(() => { realtime.receive?.({new: {...MEMBER, checked_in: true, version: 5}}); });
  // When
  view.rerender(<BusAttendance upGroups={[[1, [{...MEMBER, version: 3}]]]} downGroups={[]} buses={[]} slots={[]} />);
  // Then
  expect(screen.getByRole("button", {name: /테스트 참석자/}).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("출발 버스 1/1")).toBeDefined();
 });

 it("저장 후 실제 버전 조회가 앞선 서버 응답보다 최신이면 그 값을 유지한다", async () => {
  // Given: Other registration edits made the actual committed check revision 9, not base + 1.
  rpc.mockResolvedValue({error: null});
  readLatest.mockResolvedValueOnce({data: {...MEMBER, checked_in: true, version: 9}, error: null})
    .mockResolvedValueOnce({data: {...MEMBER, version: 10}, error: null});
  const view = render(<BusAttendance upGroups={[[1, [MEMBER]]]} downGroups={[]} buses={[]} slots={[]} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", {name: /테스트 참석자/})); });
  // When: A snapshot captured before that write arrives late.
  view.rerender(<BusAttendance upGroups={[[1, [{...MEMBER, version: 8}]]]} downGroups={[]} buses={[]} slots={[]} />);
  // Then
  expect(screen.getByRole("button", {name: /테스트 참석자/}).getAttribute("aria-pressed")).toBe("true");
  await act(async () => { fireEvent.click(screen.getByRole("button", {name: /테스트 참석자/})); });
  expect(rpc).toHaveBeenLastCalledWith("set_attendance", {p_reg_id: MEMBER.id, p_field: "checked_in", p_value: false});
 });

 it("조회 대기 중 더 최신 서버 값이 오면 늦은 조회 응답이 덮지 않는다", async () => {
  // Given
  rpc.mockResolvedValue({error: null});
  const reply = Promise.withResolvers<{data: typeof MEMBER; error: null}>();
  readLatest.mockReturnValueOnce(reply.promise);
  const view = render(<BusAttendance upGroups={[[1, [MEMBER]]]} downGroups={[]} buses={[]} slots={[]} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", {name: /테스트 참석자/})); });
  // When
  view.rerender(<BusAttendance upGroups={[[1, [{...MEMBER, version: 4}]]]} downGroups={[]} buses={[]} slots={[]} />);
  fireEvent.click(screen.getByRole("button", {name: /테스트 참석자/}));
  await act(async () => { reply.resolve({data: {...MEMBER, checked_in: true, version: 3}, error: null}); });
  // Then
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", {name: /테스트 참석자/}).getAttribute("aria-pressed")).toBe("false");
 });

 it("실시간 최신 값이 조회 대기 중 도착하면 낡은 저장 조회 응답보다 우선한다", async () => {
  // Given
  rpc.mockResolvedValue({error: null});
  const reply = Promise.withResolvers<{data: typeof MEMBER; error: null}>();
  readLatest.mockReturnValueOnce(reply.promise);
  mount();
  await act(async () => { fireEvent.click(screen.getByRole("button", {name: /테스트 참석자/})); });
  // When
  act(() => { realtime.receive?.({new: {...MEMBER, version: 4}}); });
  await act(async () => { reply.resolve({data: {...MEMBER, checked_in: true, version: 3}, error: null}); });
  // Then
  expect(screen.getByRole("button", {name: /테스트 참석자/}).getAttribute("aria-pressed")).toBe("false");
 });

 it("저장은 성공하고 최신 조회만 실패하면 저장 사실을 알리고 재조회 때 다시 쓰지 않는다", async () => {
  // Given
  rpc.mockResolvedValue({error: null});
  readLatest.mockResolvedValueOnce({data: null, error: {message: "read disconnected"}});
  mount();
  // When
  await act(async () => { fireEvent.click(screen.getByRole("button", {name: /테스트 참석자/})); });
  // Then
  expect(screen.getByRole("alert").textContent).toContain("체크는 저장되었습니다");
  readLatest.mockResolvedValueOnce({data: {...MEMBER, checked_in: true, version: 3}, error: null});
  await act(async () => { fireEvent.click(screen.getByRole("button", {name: /테스트 참석자/})); });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(readLatest).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", {name: /테스트 참석자/}).getAttribute("aria-pressed")).toBe("true");
 });

});
