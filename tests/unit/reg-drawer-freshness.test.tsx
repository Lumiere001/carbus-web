// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegDrawer } from "@/components/admin/reg-drawer";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import type { RegDrawerProps } from "@/components/admin/drawer/types";
import type { RegistrationJourneySnapshot, saveRegistrationJourney } from "@/lib/registrations/journey";

const { saveJourney, updateRegField } = vi.hoisted(() => ({ saveJourney: vi.fn<typeof saveRegistrationJourney>(), updateRegField: vi.fn() }));
vi.mock("@/lib/registrations/journey", () => ({ saveRegistrationJourney: saveJourney }));
vi.mock("@/lib/admin/registrations", () => ({ updateRegField }));
vi.mock("@/lib/admin/pickup", () => ({ addPickup: vi.fn(), deletePickup: vi.fn() }));
const row: AdminRegRow = { id: "r1", version: 4, name: "합성 학우", student_id: "26", campus_id: "c1", attendance_type: "roundtrip",
  up_trip_id: 1, down_trip_id: 2, fee: 50000, payment_status: "unpaid", roles: [], note: null,
  assigned_up_bus_id: 1, assigned_down_bus_id: 2, participation_status: "registered", cancel_reason: null,
  attend_from: "2026-10-07", attend_to: "2026-10-09", attend_from_at: "2026-10-07T09:00:00+09:00", attend_to_at: "2026-10-09T18:00:00+09:00" };
const our = { mode: "our_bus", viaUnitId: null, status: "confirmed" } as const;
const legs = [{ direction: "up", mode: "our_bus", status: "confirmed", via_unit_id: null },
  { direction: "down", mode: "our_bus", status: "confirmed", via_unit_id: null }] as const;
const props: RegDrawerProps = { row, journeyLegs: legs, campuses: [{ id: "c1", name: "합성 캠퍼스", display_order: 0 }], trips: [],
  units: [{ id: "u1", name: "합성 지구" }], places: [], courses: [], pickups: [], dayCount: 3, upLeg: our, downLeg: our, onSaved: vi.fn(), onClose: vi.fn() };
const expected: RegistrationJourneySnapshot = { version: 4, attend_from: "2026-10-07", attend_to: "2026-10-09",
  attend_from_at: "2026-10-07T09:00:00+09:00", attend_to_at: "2026-10-09T18:00:00+09:00", up_trip_id: 1, down_trip_id: 2, legs };
beforeEach(() => { vi.clearAllMocks(); saveJourney.mockReset(); updateRegField.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("서랍의 최신 정보와 작성 중 복합 입력", () => {
  it("수정 중이 아닌 이동수단은 원자적으로 읽은 새 서버 정보를 표시한다", () => {
    // Given
    const { rerender } = render(<RegDrawer {...props} />);
    // When
    rerender(<RegDrawer {...props} row={{ ...row, version: 5, up_trip_id: null, down_trip_id: null }} journeyLegs={[
      { direction: "up", mode: "ktx", status: "confirmed", via_unit_id: null },
      { direction: "down", mode: "own_car", status: "confirmed", via_unit_id: null },
    ]} />);
    // Then
    expect(screen.getByLabelText("지구 → 수련회장 이동수단")).toHaveValue("ktx");
    expect(screen.getByLabelText("수련회장 → 지구 이동수단")).toHaveValue("own_car");
    expect(saveJourney).not.toHaveBeenCalled();
  });
  it("미완성 타지구 초안은 외부 갱신으로 지워지지 않는다", () => {
    // Given
    const { rerender } = render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "other_district" } });
    // When
    rerender(<RegDrawer {...props} row={{ ...row, version: 5, up_trip_id: null }} journeyLegs={[legs[1], { direction: "up", mode: "ktx", status: "confirmed", via_unit_id: null }]} />);
    // Then
    expect(screen.getByLabelText("지구 → 수련회장 이동수단")).toHaveValue("other_district");
    expect(screen.getByLabelText("지구 → 수련회장 타지구 이름")).toHaveValue("");
    expect(saveJourney).not.toHaveBeenCalled();
  });
  it("좌석 반납 취소 후 초안을 버리면 가장 최근 서버 이동수단으로 돌아간다", () => {
    // Given
    const { rerender } = render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "ktx" } });
    fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" }));
    rerender(<RegDrawer {...props} row={{ ...row, version: 5, up_trip_id: null }} journeyLegs={[legs[1], { direction: "up", mode: "own_car", status: "confirmed", via_unit_id: null }]} />);
    // When
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "입력 버리고 새 값 불러오기" }));
    // Then
    expect(screen.getByLabelText("지구 → 수련회장 이동수단")).toHaveValue("own_car");
    expect(saveJourney).not.toHaveBeenCalled();
  });
  it("충돌은 편집 시작의 네 일정 필드와 편·수단을 보내고 최신 읽기를 요청한다", async () => {
    // Given
    saveJourney.mockResolvedValue({ ok: false, conflict: true, message: "다른 곳에서 기간을 바꿨습니다" });
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("참여 시작 날짜"), { target: { value: "2026-10-08" } });
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" })); });
    // Then
    expect(saveJourney).toHaveBeenCalledExactlyOnceWith("r1", expected, { attend_from: "2026-10-08", attend_to: "2026-10-09", attend_from_at: "2026-10-08T09:00", attend_to_at: row.attend_to_at }, { up_trip_id: 1, down_trip_id: 2 }, legs);
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith("최신값");
    expect(screen.getByRole("alert")).toHaveTextContent("다른 곳에서 기간");
    expect(screen.queryByText("참여 예정 일정·이동수단 저장됨")).not.toBeInTheDocument();
  });
  it("일정 저장 중에는 서랍 닫기·Escape·기본 정보 입력을 잠근다", async () => {
    // Given
    const request = Promise.withResolvers<Awaited<ReturnType<typeof saveRegistrationJourney>>>();
    saveJourney.mockReturnValue(request.promise);
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("참여 시작 날짜"), { target: { value: "2026-10-08" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" })); });
    // When
    fireEvent(screen.getByRole("dialog", { name: "합성 학우 편집" }), new Event("cancel", { cancelable: true }));
    // Then
    expect(screen.getByRole("button", { name: "편집 닫기" })).toBeDisabled();
    expect(screen.getByLabelText("이름")).toBeDisabled();
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => { request.resolve({ ok: false, message: "저장 실패" }); });
  });
  it("저장 결과가 불명확하면 새 목록을 확인할 때까지 재저장과 일정 입력을 막는다", async () => {
    // Given
    saveJourney.mockResolvedValue({ ok: false, uncertain: true, message: "저장 결과를 확인하지 못했습니다" });
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("참여 시작 날짜"), { target: { value: "2026-10-08" } });
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "일정·이동수단 저장" })); });
    // Then
    expect(screen.getByLabelText("참여 시작 날짜")).toBeDisabled();
    expect(screen.getByRole("button", { name: "일정·이동수단 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "목록을 새로 확인" })).toBeEnabled();
    expect(saveJourney).toHaveBeenCalledOnce();
  });
});

describe("캠퍼스 서랍의 기본 정보 포함 옵션", () => {
  it("캠퍼스 화면은 옵션을 켜기 전까지 기본 정보 입력을 제외한다", () => {
    // Given / When
    render(<RegDrawer {...props} variant="campus" />);
    // Then
    expect(screen.queryByLabelText("이름")).not.toBeInTheDocument();
  });
  it("기본 정보를 포함해도 캠퍼스 선택은 읽기 전용이다", () => {
    // Given / When
    render(<RegDrawer {...props} variant="campus" includeBasics />);
    // Then
    expect(screen.getByLabelText("캠퍼스")).toBeDisabled();
    expect(screen.getByLabelText("이름")).toBeEnabled();
  });
  it("포함한 이름 수정은 관측한 이름만 비교하고 저장한다", async () => {
    // Given
    render(<RegDrawer {...props} variant="campus" includeBasics />);
    // When
    await act(async () => {
      fireEvent.change(screen.getByLabelText("이름"), { target: { value: "바뀐 이름" } });
      fireEvent.blur(screen.getByLabelText("이름"));
    });
    // Then
    expect(updateRegField).toHaveBeenCalledExactlyOnceWith("r1", { name: "합성 학우" }, { name: "바뀐 이름" });
  });
});
