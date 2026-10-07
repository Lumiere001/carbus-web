// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegDrawer } from "@/components/admin/reg-drawer";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import type { RegDrawerProps } from "@/components/admin/drawer/types";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import type { RegistrationJourneySnapshot, saveRegistrationJourney } from "@/lib/registrations/journey";
import type { EventTrip } from "@/lib/supabase/types";

const { saveJourney, updateRegField } = vi.hoisted(() => ({ saveJourney: vi.fn<typeof saveRegistrationJourney>(), updateRegField: vi.fn() }));
vi.mock("@/lib/registrations/journey", () => ({ saveRegistrationJourney: saveJourney }));
vi.mock("@/lib/admin/registrations", () => ({ updateRegField }));
vi.mock("@/lib/admin/pickup", () => ({ addPickup: vi.fn(), deletePickup: vi.fn() }));
const row: AdminRegRow = { id: "reg-1", version: 7, name: "김순장", student_id: "23", campus_id: "campus-a", attendance_type: "roundtrip",
  up_trip_id: 10, down_trip_id: 20, fee: 50000, payment_status: "unpaid", roles: [], note: null,
  assigned_up_bus_id: 1, assigned_down_bus_id: 2, participation_status: "registered", cancel_reason: null,
  attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null };
const resultRow: RegistrationRow = { ...row, event_id: "event-1", version: 8, departure_slot_id: 10, uses_return_bus: true,
  cancelled_at: null, cancelled_by: null, checked_in: false, checked_out: false, created_by: null,
  created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z", home_unit_id: null };
const our = { mode: "our_bus", viaUnitId: null, status: "confirmed" } as const;
const legs = [{ direction: "up", mode: "our_bus", status: "confirmed", via_unit_id: null },
  { direction: "down", mode: "our_bus", status: "confirmed", via_unit_id: null }] as const;
const tripFields = { active: true, display_order: 10, event_id: "event-1", created_at: "2026-10-07T00:00:00Z", departs_at: null, origin: null, destination: null };
const trips: EventTrip[] = [{ ...tripFields, id: 10, key: "up-10", label: "화 오전 9시", direction: "up" },
  { ...tripFields, id: 20, key: "down-20", label: "금 오후 3시", direction: "down" },
  { ...tripFields, id: 21, key: "down-21", label: "금 오후 6시", direction: "down" }];
const props: RegDrawerProps = { row, journeyLegs: legs, campuses: [{ id: "campus-a", name: "전남대", display_order: 1 }], trips,
  units: [{ id: "unit-1", name: "경주지구" }], upLeg: our, downLeg: our, pickups: [], courses: [], dayCount: 3, places: [], onSaved: vi.fn(), onClose: vi.fn() };
const expected: RegistrationJourneySnapshot = { version: 7, attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null, up_trip_id: 10, down_trip_id: 20, legs };
const wholePlan = { attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null };
const timedPlan = { attend_from: null, attend_to: null, attend_from_at: "2026-08-14T09:30", attend_to_at: "2026-08-16T18:00" };
function completeTimes() {
  fireEvent.change(screen.getByLabelText("참여 시작 날짜"), { target: { value: "2026-08-14" } });
  fireEvent.change(screen.getByLabelText("참여 시작 시각"), { target: { value: "09:30" } });
  fireEvent.change(screen.getByLabelText("참여 종료 날짜"), { target: { value: "2026-08-16" } });
  fireEvent.change(screen.getByLabelText("참여 종료 시각"), { target: { value: "18:00" } });
}
beforeEach(() => {
  vi.clearAllMocks();
  saveJourney.mockImplementation(async (_id, observed, plan, selectedTrips, selectedLegs) => ({ ok: true,
    row: { ...resultRow, ...plan, ...selectedTrips, version: observed.version + 1 }, legs: selectedLegs }));
});
afterEach(cleanup);

describe("RegDrawer — 일정·이동 묶음 저장", () => {
  it("하행 편 초안은 상행을 보존하며 명시적으로 한 번에 저장한다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("하행 (오는 편)"), { target: { value: "21" } });
    expect(saveJourney).not.toHaveBeenCalled();
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" })); });
    // Then
    expect(saveJourney).toHaveBeenCalledExactlyOnceWith("reg-1", expected, wholePlan, { up_trip_id: 10, down_trip_id: 21 }, legs);
    expect(updateRegField).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "일정·이동수단 저장" })).toBeDisabled();
  });
  it("버스 미이용은 확정한 별도 수단과 함께 null 편으로 저장한다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("상행 (가는 편)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "own_car" } });
    completeTimes();
    // When
    fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "좌석 반납하고 변경" })); });
    // Then
    expect(saveJourney).toHaveBeenCalledExactlyOnceWith("reg-1", expected, timedPlan, { up_trip_id: null, down_trip_id: 20 }, [{ direction: "up", mode: "own_car", status: "confirmed", via_unit_id: null }, legs[1]]);
  });
  it("타지구를 고르면 지구 선택 칸이 나타나고 즉시 저장하지 않는다", () => {
    // Given
    render(<RegDrawer {...props} />);
    // When
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "other_district" } });
    // Then
    expect(screen.getByLabelText("지구 → 수련회장 타지구 이름")).toHaveValue("");
    expect(saveJourney).not.toHaveBeenCalled();
  });
  it("지구와 예정 시각을 완성한 후 저장하면 확정 대기와 원래 편을 함께 보낸다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "other_district" } });
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 타지구 이름"), { target: { value: "unit-1" } });
    completeTimes();
    expect(saveJourney).not.toHaveBeenCalled();
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" })); });
    // Then
    expect(saveJourney).toHaveBeenCalledExactlyOnceWith("reg-1", expected, timedPlan, { up_trip_id: 10, down_trip_id: 20 }, [{ direction: "up", mode: "other_district", status: "pending", via_unit_id: "unit-1" }, legs[1]]);
  });
  it("확정 대기 체크는 타지구를 선택한 경우에만 나타난다", () => {
    // Given
    render(<RegDrawer {...props} />);
    expect(screen.queryByLabelText("확정 대기")).not.toBeInTheDocument();
    // When
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "other_district" } });
    // Then
    expect(screen.getByLabelText("확정 대기")).toBeChecked();
  });
  it("KTX 초안은 시각을 완성하고 저장할 때 좌석 반납을 확인한다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("수련회장 → 지구 이동수단"), { target: { value: "ktx" } });
    expect(screen.queryByRole("dialog", { name: "우리 버스 좌석을 반납할까요?" })).not.toBeInTheDocument();
    completeTimes();
    // When
    fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" }));
    expect(saveJourney).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "취소" })).toHaveFocus();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "좌석 반납하고 변경" })); });
    // Then
    expect(saveJourney).toHaveBeenCalledExactlyOnceWith("reg-1", expected, timedPlan, { up_trip_id: 10, down_trip_id: null }, [legs[0], { direction: "down", mode: "ktx", status: "confirmed", via_unit_id: null }]);
  });
  it("좌석 반납을 취소하면 서버를 쓰지 않고 작성한 초안을 유지한다", () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("수련회장 → 지구 이동수단"), { target: { value: "ktx" } });
    completeTimes();
    fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" }));
    // When
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    // Then
    expect(saveJourney).not.toHaveBeenCalled();
    expect(screen.getByLabelText("수련회장 → 지구 이동수단")).toHaveValue("ktx");
    expect(screen.getByRole("button", { name: "일정·이동수단 저장" })).toBeEnabled();
  });
  it("참여 날짜만 입력하면 저장을 막고 확인창과 지속 오류를 보여 준다", () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.click(screen.getByLabelText("행사의 일부 기간만 참석합니다"));
    fireEvent.change(screen.getByLabelText("참여 시작 날짜"), { target: { value: "2026-08-14" } });
    // When
    fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" }));
    // Then
    expect(saveJourney).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "참여 정보를 확인해 주세요" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("참여 기간");
    expect(screen.getByLabelText("참여 시작 날짜")).toHaveValue("2026-08-14");
  });
});
