// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParticipationRange } from "@/components/admin/participation-range";
import { saveRegistrationJourney, type RegistrationJourneyLeg } from "@/lib/registrations/journey";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import type { EventTrip } from "@/lib/supabase/types";
vi.mock("@/lib/registrations/journey", () => ({ saveRegistrationJourney: vi.fn() }));
const row: AdminRegRow = { id: "r1", version: 1, name: "합성 학우", student_id: "26", campus_id: "c1", attendance_type: "roundtrip",
  up_trip_id: 1, down_trip_id: 2, fee: 50000, payment_status: "unpaid", roles: [], note: null, assigned_up_bus_id: null, assigned_down_bus_id: null,
  participation_status: "registered", cancel_reason: null, attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null };
const trips: EventTrip[] = [1,2].map((id) => ({ id, key: String(id), label: `편 ${id}`, direction: id === 1 ? "up" : "down", active: true,
  display_order: id, created_at: "", event_id: "e1", departs_at: null, origin: null, destination: null }));
const onSaved = vi.fn(); const onDirtyChange = vi.fn(); const onBusyChange = vi.fn();
const props = { trips, units: [], disabled: false, onSaved, onDirtyChange, onBusyChange };
function times() {
  for (const [label,value] of [["참여 시작 날짜","2026-10-10"],["참여 시작 시각","09:30"],["참여 종료 날짜","2026-10-12"],["참여 종료 시각","19:40"]])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
async function save() { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" })); }); }
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);
describe("확정한 참여 일정과 이동수단의 한 번 저장", () => {
  it("이름만 바뀐 최신 버전은 일정 초안을 유지하며 저장 기준에 반영한다", async () => {
    vi.mocked(saveRegistrationJourney).mockResolvedValue({ ok: false, message: "합성 응답" });
    const view = render(<ParticipationRange {...props} row={row} legs={[]} />);
    fireEvent.click(screen.getByLabelText("행사의 일부 기간만 참석합니다")); times();
    view.rerender(<ParticipationRange {...props} row={{ ...row, version: 2, name: "새 이름" }} legs={[]} />);
    expect(screen.queryByText(/다른 곳에서 일정이나 이동수단/)).toBeNull();
    expect(screen.getByLabelText("참여 시작 시각")).toHaveValue("09:30"); await save();
    expect(saveRegistrationJourney).toHaveBeenCalledWith("r1", expect.objectContaining({ version: 2 }), expect.anything(), expect.anything(), []);
  });
  it("버스 편만 바꾸면 편집하지 않은 시각의 초 단위도 보존한다", async () => {
    vi.mocked(saveRegistrationJourney).mockResolvedValue({ ok: false, message: "합성 응답" });
    const planned = { ...row, attend_from_at: "2026-10-10T00:30:45Z", attend_to_at: "2026-10-12T10:40:55Z" };
    render(<ParticipationRange {...props} row={planned} legs={[]} trips={[...trips, { ...trips[0], id: 3, label: "다른 편" }]} />);
    fireEvent.change(screen.getByLabelText("상행 (가는 편)"), { target: { value: "3" } }); await save();
    expect(saveRegistrationJourney).toHaveBeenCalledWith("r1", expect.anything(), expect.objectContaining({
      attend_from_at: planned.attend_from_at, attend_to_at: planned.attend_to_at }), expect.anything(), expect.anything());
  });

  it("시각·이동수단이 함께 비어 있는 기존 편도 신청도 원래 값을 기준으로 한 번에 고친다", async () => {
    const legacy = { ...row, attendance_type: "oneway" as const, down_trip_id: null, attend_from: "2026-10-10", attend_to: "2026-10-12" };
    const legs: RegistrationJourneyLeg[] = [{ direction: "down", mode: "own_car", via_unit_id: null, status: "confirmed" }];
    vi.mocked(saveRegistrationJourney).mockResolvedValue({ ok: true, row: { ...legacy, version: 2,
      event_id: "e1", cancelled_at: null, cancelled_by: null, checked_in: false, checked_out: false, created_by: null, created_at: "", updated_at: "", departure_slot_id: 1, uses_return_bus: false, home_unit_id: null,
      attend_from_at: "2026-10-10T00:30:00Z", attend_to_at: "2026-10-12T10:40:00Z" }, legs });
    render(<ParticipationRange {...props} row={legacy} legs={[]} />);
    expect(screen.getByLabelText("참여 시작 날짜")).toHaveValue("2026-10-10");
    expect(screen.getByLabelText("참여 시작 시각")).toHaveValue("");
    times(); fireEvent.change(screen.getByLabelText("수련회장 → 지구 이동수단"), { target: { value: "own_car" } });
    await save();
    expect(saveRegistrationJourney).toHaveBeenCalledExactlyOnceWith("r1", expect.objectContaining({ version: 1, legs: [], attend_from_at: null }),
      expect.objectContaining({ attend_from: "2026-10-10", attend_to: "2026-10-12", attend_from_at: "2026-10-10T09:30", attend_to_at: "2026-10-12T19:40" }),
      { up_trip_id: 1, down_trip_id: null }, legs);
    expect(screen.getByRole("status")).toHaveTextContent("저장됨");
    expect(screen.getByRole("button", { name: "일정·이동수단 저장" })).toBeDisabled();
  });
  it("행사 전체 참석인 편도 이용자의 확정 시각은 부분 참석 날짜로 바꾸지 않는다", async () => {
    const legs: RegistrationJourneyLeg[] = [{ direction: "down", mode: "ktx", status: "confirmed", via_unit_id: null }];
    vi.mocked(saveRegistrationJourney).mockResolvedValue({ ok: false, message: "합성 응답" });
    render(<ParticipationRange {...props} row={{ ...row, down_trip_id: null }} legs={legs} />); times(); await save();
    expect(saveRegistrationJourney).toHaveBeenCalledWith("r1", expect.anything(), expect.objectContaining({ attend_from: null, attend_to: null }), expect.anything(), legs);
  });
  it("날짜만 입력하면 팝업으로 막고 반쪽 초안을 유지한다", async () => {
    render(<ParticipationRange {...props} row={row} legs={[]} />);
    fireEvent.click(screen.getByLabelText("행사의 일부 기간만 참석합니다"));
    fireEvent.change(screen.getByLabelText("참여 시작 날짜"), { target: { value: "2026-10-10" } });
    await save();
    expect(saveRegistrationJourney).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "참여 정보를 확인해 주세요" })).toHaveTextContent("부분참은 참여 기간(시간 포함)을 입력해주세요!");
    expect(screen.getByLabelText("참여 시작 날짜")).toHaveValue("2026-10-10");
  });
  it("작성 중 외부 수정이 와도 초안과 관측 기준을 덮어쓰지 않는다", async () => {
    vi.mocked(saveRegistrationJourney).mockResolvedValue({ ok: false, message: "변경 충돌", conflict: true });
    const view = render(<ParticipationRange {...props} row={row} legs={[]} />);
    fireEvent.click(screen.getByLabelText("행사의 일부 기간만 참석합니다")); times();
    view.rerender(<ParticipationRange {...props} row={{ ...row, version: 2, up_trip_id: 3 }} legs={[]} />);
    expect(screen.getByText(/다른 곳에서 일정이나 이동수단/)).toBeTruthy(); await save();
    expect(saveRegistrationJourney).toHaveBeenCalledWith("r1", expect.objectContaining({ version: 1, up_trip_id: 1 }), expect.anything(), expect.anything(), []);
    expect(onSaved).toHaveBeenCalledWith("최신값");
    expect(screen.getByLabelText("참여 시작 시각")).toHaveValue("09:30");
  });
  it("납부한 신청의 확정 외부 이동은 저장 직전에 좌석 반납을 확인한다", async () => {
    render(<ParticipationRange {...props} row={{ ...row, payment_status: "paid", assigned_down_bus_id: 7 }} legs={[]} />);
    fireEvent.change(screen.getByLabelText("수련회장 → 지구 이동수단"), { target: { value: "own_car" } }); times();
    expect(saveRegistrationJourney).not.toHaveBeenCalled(); await save();
    const dialog = screen.getByRole("dialog", { name: "우리 버스 좌석을 반납할까요?" });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "취소" })); });
    expect(saveRegistrationJourney).not.toHaveBeenCalled(); expect(screen.getByLabelText("수련회장 → 지구 이동수단")).toHaveValue("own_car");
    expect(screen.getByText(/청구액은 자동으로 바뀌지 않습니다/)).toBeTruthy();
  });
  it("저장 결과가 불명확하면 새 쓰기를 잠그고 최신 목록을 확인한 뒤 재개한다", async () => {
    vi.mocked(saveRegistrationJourney).mockResolvedValue({ ok: false, message: "연결 확인 필요", uncertain: true });
    const view = render(<ParticipationRange {...props} row={row} legs={[]} />);
    fireEvent.click(screen.getByLabelText("행사의 일부 기간만 참석합니다")); times(); await save();
    expect(screen.getByRole("button", { name: "일정·이동수단 저장" })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "목록을 새로 확인" })); });
    view.rerender(<ParticipationRange {...props} row={{ ...row }} legs={[]} />);
    expect(screen.getByRole("button", { name: "일정·이동수단 저장" })).toBeEnabled();
    expect(screen.getByLabelText("참여 시작 시각")).toHaveValue("09:30");
    expect(saveRegistrationJourney).toHaveBeenCalledTimes(1);
  });
  it("저장 중에는 입력·저장·상위 닫기에 잠금 신호를 유지한다", async () => {
    const reply = Promise.withResolvers<Awaited<ReturnType<typeof saveRegistrationJourney>>>();
    vi.mocked(saveRegistrationJourney).mockReturnValue(reply.promise);
    render(<ParticipationRange {...props} row={row} legs={[]} />);
    fireEvent.click(screen.getByLabelText("행사의 일부 기간만 참석합니다")); times(); await save();
    expect(onBusyChange).toHaveBeenLastCalledWith(true); expect(screen.getByLabelText("참여 시작 시각")).toBeDisabled();
    await act(async () => { reply.resolve({ ok: false, message: "합성 실패" }); });
    expect(onBusyChange).toHaveBeenLastCalledWith(false); expect(screen.getByLabelText("참여 시작 시각")).toHaveValue("09:30");
  });
});
