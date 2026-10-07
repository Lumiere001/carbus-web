// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationGrid } from "@/components/campus/registration-grid";
import { updateCells } from "@/lib/registrations/mutations";
import { excludeRegistration, restoreRegistration } from "@/lib/admin/registrations";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import type { RegistrationGridProps } from "@/components/campus/registration-grid/types";

const { query, rosterRead, rosterEq, rosterFrom, mutationWrite, mutationSingle } = vi.hoisted(() => ({ query: { value: "" }, rosterRead: vi.fn(), rosterEq: vi.fn(), rosterFrom: vi.fn(), mutationWrite: vi.fn(), mutationSingle: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(query.value) }));
vi.mock("@/lib/registrations/mutations", () => ({ updateCells: vi.fn() }));
vi.mock("@/lib/admin/registrations", () => ({ excludeRegistration: vi.fn(async () => ({ ok: true })), restoreRegistration: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/components/admin/reg-drawer", () => ({ RegDrawer: ({ row }: { readonly row: { readonly name: string } }) => <aside aria-label="편집 대상">{row.name}</aside> }));
vi.mock("@/components/admin/reg-form", () => ({ RegForm: () => <section aria-label="전체 신청 폼" /> }));
type Change = { readonly eventType: "INSERT" | "UPDATE" | "DELETE"; readonly new: RegistrationRow; readonly old: Pick<RegistrationRow, "id"> };
let receive: ((change: Change) => void) | undefined;
const channel = {
  on(_event: string, _filter: unknown, callback: (change: Change) => void) { receive = callback; return channel; },
  subscribe() { return channel; },
};
const rosterQuery = {
  select() { return rosterQuery; },
  eq(field: string, value: string) { rosterEq(field, value); return rosterQuery; },
  order() { return rosterRead(); },
  update(patch: unknown) { mutationWrite(patch); return rosterQuery; },
  maybeSingle() { return mutationSingle(); },
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  channel: () => channel, removeChannel: vi.fn(),
  from(table: string) { rosterFrom(table); return rosterQuery; },
}) }));

const row = (id = "own", name = "원래 이름"): RegistrationRow => ({
  id, name, student_id: "26", campus_id: "campus", event_id: "event", attendance_type: "roundtrip",
  up_trip_id: 1, down_trip_id: 2, departure_slot_id: 1, uses_return_bus: true,
  payment_status: "unpaid", fee: 50000, note: null, roles: [], assigned_up_bus_id: null,
  assigned_down_bus_id: null, created_by: null, created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z",
  version: 1, checked_in: false, checked_out: false, home_unit_id: null, participation_status: "registered",
  cancelled_at: null, cancelled_by: null, cancel_reason: null, attend_from: null, attend_to: null,
});
const props = (): RegistrationGridProps => ({ eventId: "event", campusId: "campus", campusName: "테스트", initialRows: [row(), row("other", "다른 학우")],
  buses: [], trips: [1,2].map((id) => ({ id, key: `t${id}`, label: `기존 편 ${id}`, direction: id === 1 ? "up" : "down", active: true, display_order: id, event_id: "event", created_at: "2026-10-07T00:00:00Z", departs_at: null, origin: null, destination: null })),
  legs: {}, units: [], pickups: {}, places: [], courses: {}, dayCount: 3,
});
beforeEach(() => {
  query.value = ""; receive = undefined; vi.clearAllMocks();
  rosterRead.mockReset().mockResolvedValue({ data: [row(), row("other", "다른 학우")], error: null });
  mutationSingle.mockReset().mockResolvedValueOnce({ data: row(), error: null }).mockResolvedValueOnce({ data: { ...row(), name: "", version: 2 }, error: null });
  vi.mocked(updateCells).mockImplementation(async (id, _expected, patch) => {
    const current = row(id);
    return { ok: true, row: { ...current, version: current.version + 1, name: patch.name ?? current.name, note: patch.note === undefined ? current.note : patch.note } };
  });
});
afterEach(cleanup);

describe("캠퍼스 명단 모듈 경계", () => {
  it("운행편 메타데이터가 바뀌면 열의 선택지에 최신 이름을 보여 준다", () => {
    // Given
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    // When
    rerender(<RegistrationGrid {...initial} trips={initial.trips.map((t) => t.id === 1 ? { ...t, label: "새 출발 편" } : t)} />);
    // Then
    expect(screen.getAllByRole("option", { name: "새 출발 편" })).toHaveLength(2);
    expect(screen.queryByRole("option", { name: "기존 편 1" })).toBeNull();
  });

  it("새 URL로 편집한 뒤에도 다른 사람의 행 버튼을 현재 범위로 연다", () => {
    // Given
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    query.value = "edit=other"; rerender(<RegistrationGrid {...initial} />);
    // When
    fireEvent.click(screen.getByRole("button", { name: "원래 이름 정보 수정: 이동수단·참여기간·수송 요청" }));
    // Then
    expect(screen.getByLabelText("편집 대상").textContent).toBe("원래 이름");
  });

  it("조회 필터는 취소 행을 따로 보여 주고 활성 행은 기본으로 유지한다", () => {
    // Given
    const initial = props(); initial.initialRows[1] = { ...row("other", "취소 학우"), participation_status: "cancelled", cancel_reason: "사유" };
    render(<RegistrationGrid {...initial} />);
    // When
    fireEvent.change(screen.getByLabelText("명단 보기"), { target: { value: "cancelled" } });
    // Then
    expect(screen.getByRole("button", { name: "취소 학우" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "원래 이름" })).toBeNull();
    expect(screen.getByRole("button", { name: "취소 되돌리기" })).toBeTruthy();
  });

  it("추가 버튼은 같은 전체 신청 폼을 연다", () => {
    // Given
    render(<RegistrationGrid {...props()} />);
    // When
    fireEvent.click(screen.getByRole("button", { name: "순장/순원 추가" }));
    // Then
    expect(screen.getByLabelText("전체 신청 폼")).toBeTruthy();
  });

  it("편집 중 다른 기기가 값을 바꿔도 처음 읽은 값을 기대값으로 저장한다", async () => {
    // Given
    render(<RegistrationGrid {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "원래 이름" }));
    const input = screen.getByRole("textbox", { name: "원래 이름 이름" });
    fireEvent.change(input, { target: { value: "내 수정" } });
    if (!receive) throw new Error("Realtime callback missing");
    act(() => receive?.({ eventType: "UPDATE", new: { ...row("own", "다른 기기 이름"), version: 2 }, old: { id: "own" } }));
    // When
    await act(async () => { fireEvent.blur(input); });
    // Then
    expect(updateCells).toHaveBeenCalledExactlyOnceWith("own", { name: "원래 이름" }, { name: "내 수정" });
  });
  it("늦은 저장 응답이 더 최신 Realtime의 다른 필드를 되돌리지 않는다", async () => {
    // Given
    let acknowledge: ((value: Awaited<ReturnType<typeof updateCells>>) => void) | undefined;
    vi.mocked(updateCells).mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
    render(<RegistrationGrid {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "원래 이름" }));
    const input = screen.getByRole("textbox", { name: "원래 이름 이름" });
    fireEvent.change(input, { target: { value: "저장 이름" } });
    fireEvent.blur(input);
    if (!receive || !acknowledge) throw new Error("Expected pending acknowledgement and Realtime callback");
    await act(async () => receive?.({ eventType: "UPDATE", new: { ...row("own", "저장 이름"), note: "다른 기기의 최신 비고", version: 3 }, old: { id: "own" } }));
    // When
    await act(async () => { acknowledge?.({ ok: true, row: { ...row("own", "저장 이름"), note: null, version: 2 } }); });
    // Then
    expect(screen.getByRole("button", { name: "다른 기기의 최신 비고" })).toBeTruthy();
  });

  it("이미 받은 최신 저장 응답보다 오래된 Realtime은 화면을 되돌리지 않는다", async () => {
    // Given
    vi.mocked(updateCells).mockResolvedValueOnce({ ok: true, row: { ...row("own", "저장 이름"), note: "확인된 최신 비고", version: 3 } });
    render(<RegistrationGrid {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "원래 이름" }));
    const input = screen.getByRole("textbox", { name: "원래 이름 이름" });
    fireEvent.change(input, { target: { value: "저장 이름" } });
    await act(async () => { fireEvent.blur(input); });
    if (!receive) throw new Error("Realtime callback missing");
    // When
    await act(async () => receive?.({ eventType: "UPDATE", new: { ...row("own", "저장 이름"), note: "오래된 비고", version: 2 }, old: { id: "own" } }));
    // Then
    expect(screen.getByRole("button", { name: "확인된 최신 비고" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "오래된 비고" })).toBeNull();
  });

  it("늦은 서버 props도 같은 신청의 최신 Realtime 값을 되돌리지 않는다", async () => {
    // Given
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    if (!receive) throw new Error("Realtime callback missing");
    await act(async () => receive?.({ eventType: "UPDATE", new: { ...row(), note: "최신 서버 비고", version: 3 }, old: { id: "own" } }));
    // When
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={initial.initialRows.map((r) => ({ ...r }))} />); });
    // Then
    expect(screen.getByRole("button", { name: "최신 서버 비고" })).toBeTruthy();
  });

  it("새 서버 목록의 더 높은 버전은 화면에 반영한다", async () => {
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    if (!receive) throw new Error("Realtime callback missing");
    await act(async () => receive?.({ eventType: "UPDATE", new: { ...row(), note: "앞서 받은 실시간 비고", version: 2 }, old: { id: "own" } }));
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={[{ ...row(), note: "최신 서버 비고", version: 3 }, row("other", "다른 학우")]} />); });
    expect(screen.getByRole("button", { name: "최신 서버 비고" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "앞서 받은 실시간 비고" })).toBeNull();
  });

  it("확인한 새 서버 목록이 비면 기존 행을 남기지 않는다", async () => {
    rosterRead.mockResolvedValueOnce({ data: [], error: null });
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={[]} />); });
    expect(screen.queryByRole("button", { name: "원래 이름" })).toBeNull();
    expect(screen.queryByRole("button", { name: "다른 학우" })).toBeNull();
  });

  it("새 Realtime 등록을 빠뜨린 SSR은 확인 전에도 그 행을 숨기지 않는다", async () => {
    let confirm: ((value: { data: RegistrationRow[]; error: null }) => void) | undefined;
    rosterRead.mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    const inserted = row("new", "실시간 새 신청");
    await act(async () => receive?.({ eventType: "INSERT", new: inserted, old: { id: inserted.id } }));
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={[...initial.initialRows]} />); });
    expect(screen.getByRole("button", { name: "실시간 새 신청" })).toBeTruthy();
    expect(rosterFrom).toHaveBeenCalledWith("registrations");
    expect(rosterEq).toHaveBeenCalledWith("campus_id", "campus");
    expect(rosterEq).toHaveBeenCalledWith("event_id", "event");
    if (!confirm) throw new Error("Roster confirmation missing");
    await act(async () => { confirm?.({ data: [...initial.initialRows, inserted], error: null }); });
    expect(screen.getByRole("button", { name: "실시간 새 신청" })).toBeTruthy();
  });

  it("진짜 빈 DB 명단을 확인하면 임시로 남겼던 행을 제거한다", async () => {
    let confirm: ((value: { data: RegistrationRow[]; error: null }) => void) | undefined;
    rosterRead.mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={[]} />); });
    expect(screen.getByRole("button", { name: "원래 이름" })).toBeTruthy();
    if (!confirm) throw new Error("Roster confirmation missing");
    await act(async () => { confirm?.({ data: [], error: null }); });
    expect(screen.queryByRole("button", { name: "원래 이름" })).toBeNull();
    expect(screen.queryByRole("button", { name: "다른 학우" })).toBeNull();
  });

  it("확인 도중 받은 새 등록이 있으면 오래된 확인 결과를 버리고 다시 조회한다", async () => {
    let confirm: ((value: { data: RegistrationRow[]; error: null }) => void) | undefined;
    const inserted = row("new", "확인 중 새 신청");
    rosterRead.mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    rosterRead.mockResolvedValueOnce({ data: [inserted], error: null });
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={[]} />); });
    await act(async () => receive?.({ eventType: "INSERT", new: inserted, old: { id: inserted.id } }));
    if (!confirm) throw new Error("Roster confirmation missing");
    await act(async () => { confirm?.({ data: [], error: null }); });
    expect(rosterRead).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "확인 중 새 신청" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "원래 이름" })).toBeNull();
  });

  it("명단 확인 오류는 기존 행과 재시도 안내를 남기고 성공한 재시도로 해제한다", async () => {
    rosterRead.mockResolvedValueOnce({ data: null, error: { message: "temporary failure" } });
    rosterRead.mockResolvedValueOnce({ data: [], error: null });
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={[]} />); });
    expect(screen.getByRole("button", { name: "원래 이름" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("최신 명단을 확인하지 못했습니다");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "명단 다시 확인" })); });
    expect(screen.queryByRole("button", { name: "원래 이름" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["event", "campus"] as const)("%s 범위가 바뀌면 즉시 새 명단으로 바뀌고 이전 확인 응답을 무시한다", async (scope) => {
    let confirm: ((value: { data: RegistrationRow[]; error: null }) => void) | undefined;
    rosterRead.mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    const initial = props(); const { rerender } = render(<RegistrationGrid key="event:campus" {...initial} />);
    await act(async () => { rerender(<RegistrationGrid key="event:campus" {...initial} initialRows={[]} />); });
    const nextRow = { ...row("next", "새 범위 신청"), event_id: scope === "event" ? "next-event" : "event", campus_id: scope === "campus" ? "next-campus" : "campus" };
    await act(async () => { rerender(<RegistrationGrid key={`${nextRow.event_id}:${nextRow.campus_id}`} {...initial} eventId={nextRow.event_id} campusId={nextRow.campus_id} initialRows={[nextRow]} />); });
    expect(screen.getByRole("button", { name: "새 범위 신청" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "원래 이름" })).toBeNull();
    if (!confirm) throw new Error("Roster confirmation missing");
    await act(async () => { confirm?.({ data: initial.initialRows, error: null }); });
    expect(screen.getByRole("button", { name: "새 범위 신청" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "원래 이름" })).toBeNull();
  });

  it("확인 도중 받은 DELETE도 오래된 목록의 행을 되살리지 못하게 한다", async () => {
    let confirm: ((value: { data: RegistrationRow[]; error: null }) => void) | undefined;
    rosterRead.mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    rosterRead.mockResolvedValueOnce({ data: [row("other", "다른 학우")], error: null });
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={[]} />); });
    await act(async () => receive?.({ eventType: "DELETE", new: row(), old: { id: "own" } }));
    if (!confirm) throw new Error("Roster confirmation missing");
    await act(async () => { confirm?.({ data: initial.initialRows, error: null }); });
    expect(rosterRead).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "원래 이름" })).toBeNull();
    expect(screen.getByRole("button", { name: "다른 학우" })).toBeTruthy();
  });

  it("명단 재확인도 조회 도중 받은 더 높은 행 버전을 유지한다", async () => {
    let confirm: ((value: { data: RegistrationRow[]; error: null }) => void) | undefined;
    rosterRead.mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    const initial = props(); const { rerender } = render(<RegistrationGrid {...initial} />);
    await act(async () => { rerender(<RegistrationGrid {...initial} initialRows={[row()]} />); });
    await act(async () => receive?.({ eventType: "UPDATE", new: { ...row(), note: "조회 중 최신 비고", version: 3 }, old: { id: "own" } }));
    if (!confirm) throw new Error("Roster confirmation missing");
    await act(async () => { confirm?.({ data: [{ ...row(), note: "오래된 조회 비고", version: 2 }], error: null }); });
    expect(rosterRead).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "조회 중 최신 비고" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "다른 학우" })).toBeNull();
  });

  it("같은 캠퍼스라도 다른 행사 Realtime 행을 현재 명단에 추가하지 않는다", async () => {
    render(<RegistrationGrid {...props()} />);
    const otherEvent = { ...row("other-event", "다른 행사 신청"), event_id: "other-event" };
    await act(async () => receive?.({ eventType: "INSERT", new: otherEvent, old: { id: otherEvent.id } }));
    expect(screen.queryByRole("button", { name: "다른 행사 신청" })).toBeNull();
    expect(rosterRead).not.toHaveBeenCalled();
  });

  it("취소 성공 뒤 같은 버전의 늦은 UPDATE는 취소와 좌석 반납을 되돌리지 않는다", async () => {
    rosterRead.mockImplementationOnce(() => new Promise(() => {}));
    const before = { ...row(), assigned_up_bus_id: 3 };
    render(<RegistrationGrid {...props()} initialRows={[before]} buses={[{ id: 3, name: "배정 버스" }]} />);
    fireEvent.change(screen.getByLabelText("명단 보기"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "신청 취소" }));
    fireEvent.change(screen.getByRole("textbox", { name: "취소 사유 (선택)" }), { target: { value: "개인 사정" } });
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "신청 취소" })); });
    expect(excludeRegistration).toHaveBeenCalledExactlyOnceWith("own", "개인 사정");
    await act(async () => receive?.({ eventType: "UPDATE", new: before, old: { id: "own" } }));
    expect(screen.getByRole("button", { name: "취소 되돌리기" })).toBeTruthy();
    expect(screen.getByText("개인 사정")).toBeTruthy();
    expect(screen.queryByText("배정 버스")).toBeNull();
    await act(async () => receive?.({ eventType: "UPDATE", new: { ...before, version: 2, participation_status: "cancelled", cancel_reason: "개인 사정", assigned_up_bus_id: null, note: "DB 확인된 취소" }, old: { id: "own" } }));
    expect(screen.getByRole("button", { name: "DB 확인된 취소" })).toBeTruthy();
  });

  it("복원 성공 뒤 같은 버전의 늦은 UPDATE는 다시 취소 표시하지 않는다", async () => {
    rosterRead.mockImplementationOnce(() => new Promise(() => {}));
    const before: RegistrationRow = { ...row(), participation_status: "cancelled", cancel_reason: "이전 취소" };
    render(<RegistrationGrid {...props()} initialRows={[before]} />);
    fireEvent.change(screen.getByLabelText("명단 보기"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "취소 되돌리기" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "되돌리기" })); });
    expect(restoreRegistration).toHaveBeenCalledExactlyOnceWith("own");
    await act(async () => receive?.({ eventType: "UPDATE", new: before, old: { id: "own" } }));
    expect(screen.getByRole("button", { name: "신청 취소" })).toBeTruthy();
    expect(screen.queryByText("이전 취소")).toBeNull();
    await act(async () => receive?.({ eventType: "UPDATE", new: { ...before, version: 2, participation_status: "registered", cancel_reason: null, note: "DB 확인된 복원" }, old: { id: "own" } }));
    expect(screen.getByRole("button", { name: "DB 확인된 복원" })).toBeTruthy();
  });

  it("취소 응답보다 먼저 받은 더 최신 복원 행은 늦은 취소 응답으로 바뀌지 않는다", async () => {
    let acknowledge: ((value: Awaited<ReturnType<typeof excludeRegistration>>) => void) | undefined;
    vi.mocked(excludeRegistration).mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
    const newer = { ...row(), version: 3, note: "다른 기기의 최신 복원" };
    rosterRead.mockResolvedValueOnce({ data: [newer], error: null });
    render(<RegistrationGrid {...props()} initialRows={[row()]} />);
    fireEvent.change(screen.getByLabelText("명단 보기"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "신청 취소" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "신청 취소" })); });
    await act(async () => receive?.({ eventType: "UPDATE", new: newer, old: { id: "own" } }));
    if (!acknowledge) throw new Error("Cancel acknowledgement missing");
    await act(async () => { acknowledge?.({ ok: true }); });
    expect(screen.getByRole("button", { name: "신청 취소" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "취소 되돌리기" })).toBeNull();
    expect(screen.getByRole("button", { name: "다른 기기의 최신 복원" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("신청 취소됨");
    expect(rosterRead).toHaveBeenCalledTimes(1);
  });

  it("복원 응답보다 먼저 받은 더 최신 취소 행은 늦은 복원 응답으로 바뀌지 않는다", async () => {
    let acknowledge: ((value: Awaited<ReturnType<typeof restoreRegistration>>) => void) | undefined;
    vi.mocked(restoreRegistration).mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
    const before: RegistrationRow = { ...row(), participation_status: "cancelled" };
    const newer: RegistrationRow = { ...before, version: 3, cancel_reason: "다른 기기의 최신 취소", note: "최신 취소 기록" };
    rosterRead.mockResolvedValueOnce({ data: [newer], error: null });
    render(<RegistrationGrid {...props()} initialRows={[before]} />);
    fireEvent.change(screen.getByLabelText("명단 보기"), { target: { value: "all" } });
    fireEvent.click(screen.getByRole("button", { name: "취소 되돌리기" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "되돌리기" })); });
    await act(async () => receive?.({ eventType: "UPDATE", new: newer, old: { id: "own" } }));
    if (!acknowledge) throw new Error("Restore acknowledgement missing");
    await act(async () => { acknowledge?.({ ok: true }); });
    expect(screen.getByRole("button", { name: "취소 되돌리기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "신청 취소" })).toBeNull();
    expect(screen.getByText("다른 기기의 최신 취소")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("취소 되돌림");
    expect(rosterRead).toHaveBeenCalledTimes(1);
  });

  it.each(["외국인", "타지구"])("학번도 같은 셀 저장으로 %s 표시까지 편집한다", async (studentId) => {
    vi.mocked(updateCells).mockResolvedValueOnce({ ok: true, row: { ...row(), version: 2, student_id: studentId } });
    render(<RegistrationGrid {...props()} />);
    expect(screen.getByRole("button", { name: "다른 학우 학번 26 수정" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "원래 이름 학번 26 수정" }));
    const input = screen.getByRole("textbox", { name: "원래 이름 학번" });
    fireEvent.change(input, { target: { value: studentId } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(updateCells).toHaveBeenCalledExactlyOnceWith("own", { student_id: "26" }, { student_id: studentId });
    const saved = screen.getByRole("button", { name: `원래 이름 학번 ${studentId} 수정` });
    expect(within(saved).getByText(studentId)).toBeTruthy();
    expect(screen.getByRole("button", { name: "다른 학우 학번 26 수정" })).toBeTruthy();
  });

  it("학번 편집 도중 받은 다른 값으로 원래 기대값을 바꾸지 않고 충돌 최신값을 표시한다", async () => {
    vi.mocked(updateCells).mockResolvedValueOnce({ ok: false, conflict: true, conflictFields: ["student_id"], message: "학번이 다른 기기에서 바뀌었습니다", latest: { ...row(), student_id: "28", version: 3 } });
    render(<RegistrationGrid {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "원래 이름 학번 26 수정" }));
    const input = screen.getByRole("textbox", { name: "원래 이름 학번" });
    fireEvent.change(input, { target: { value: "29" } });
    await act(async () => receive?.({ eventType: "UPDATE", new: { ...row(), student_id: "27", version: 2 }, old: { id: "own" } }));
    expect(input).toHaveProperty("value", "29");
    await act(async () => { fireEvent.blur(input); });
    expect(updateCells).toHaveBeenCalledExactlyOnceWith("own", { student_id: "26" }, { student_id: "29" });
    expect(screen.getByRole("button", { name: "원래 이름 학번 28 수정" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "원래 이름 학번 29 수정" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("학번이 다른 기기에서 바뀌었습니다");
  });

  it("학번에서 Escape를 누르면 입력을 취소하고 원래 표시를 유지하며 저장하지 않는다", async () => {
    const initial = props(); initial.initialRows[0] = { ...row(), student_id: "타지구" };
    render(<RegistrationGrid {...initial} />);
    fireEvent.click(screen.getByRole("button", { name: "원래 이름 학번 타지구 수정" }));
    const input = screen.getByRole("textbox", { name: "원래 이름 학번" });
    fireEvent.change(input, { target: { value: "26" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Escape" }); });
    expect(screen.queryByRole("textbox", { name: "원래 이름 학번" })).toBeNull();
    expect(screen.getByRole("button", { name: "원래 이름 학번 타지구 수정" })).toBeTruthy();
    expect(updateCells).not.toHaveBeenCalled();
  });

  it.each(["", "  \t"])("실제 공통 저장이 이름 %j를 차단하면 기존 이름과 같은 필수 안내를 유지한다", async (name) => {
    const actual = await vi.importActual<typeof import("@/lib/registrations/mutations")>("@/lib/registrations/mutations");
    vi.mocked(updateCells).mockImplementationOnce(actual.updateCells);
    render(<RegistrationGrid {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "원래 이름" }));
    const input = screen.getByRole("textbox", { name: "원래 이름 이름" });
    fireEvent.change(input, { target: { value: name } });
    await act(async () => { fireEvent.blur(input); });
    expect(updateCells).toHaveBeenCalledExactlyOnceWith("own", { name: "원래 이름" }, { name: "" });
    expect(mutationWrite).not.toHaveBeenCalled();
    expect(rosterFrom).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "원래 이름" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("이름은 필수입니다");
  });

});
