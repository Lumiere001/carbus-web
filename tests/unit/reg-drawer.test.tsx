// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegDrawer } from "@/components/admin/reg-drawer";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import type { RegDrawerProps } from "@/components/admin/drawer/types";

const { updateRegField, saveJourney, addPickup, setCourseSignup, clearCourseSignup } = vi.hoisted(() => ({
  updateRegField: vi.fn(), saveJourney: vi.fn(), addPickup: vi.fn(), setCourseSignup: vi.fn(), clearCourseSignup: vi.fn(),
}));
vi.mock("@/lib/admin/registrations", () => ({ updateRegField }));
vi.mock("@/lib/registrations/journey", () => ({ saveRegistrationJourney: saveJourney }));
vi.mock("@/lib/admin/pickup", () => ({ addPickup, deletePickup: vi.fn() }));
vi.mock("@/lib/admin/courses", () => ({ setCourseSignup, clearCourseSignup }));
const row: AdminRegRow = { id: "reg-1", name: "김순장", student_id: "23", campus_id: "campus-a", attendance_type: "roundtrip",
  up_trip_id: 10, down_trip_id: 20, fee: 50000, payment_status: "unpaid", roles: [], note: "기존 비고",
  assigned_up_bus_id: 1, assigned_down_bus_id: 2, participation_status: "registered", cancel_reason: null,
  attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null };
const our = { mode: "our_bus", viaUnitId: null, status: "confirmed" } as const;
const props: RegDrawerProps = { row, campuses: [{ id: "campus-a", name: "전남대", display_order: 1 }], trips: [],
  units: [{ id: "unit-1", name: "경주지구" }], upLeg: our, downLeg: our, pickups: [], courses: [], dayCount: 3, places: [],
  onSaved: vi.fn(), onClose: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  updateRegField.mockResolvedValue({ ok: true }); addPickup.mockResolvedValue({ ok: true });
  setCourseSignup.mockResolvedValue({ ok: true }); clearCourseSignup.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

// 기본 정보는 일정·이동 묶음과 독립적으로 관측한 한 칸만 저장한다.
describe("RegDrawer — 필드별 즉시 저장", () => {
  it("납부만 바꾸면 관측한 납부와 새 납부 한 칸만 보낸다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    // When
    await act(async () => { fireEvent.change(screen.getByLabelText("납부"), { target: { value: "paid" } }); });
    // Then
    expect(updateRegField).toHaveBeenCalledExactlyOnceWith("reg-1", { payment_status: "unpaid" }, { payment_status: "paid" });
    expect(saveJourney).not.toHaveBeenCalled();
  });
  it("값을 안 바꾸고 빠져나가면 아무것도 보내지 않는다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    // When
    await act(async () => { fireEvent.blur(screen.getByLabelText("이름")); });
    // Then
    expect(updateRegField).not.toHaveBeenCalled();
  });
  it("비고를 지우면 빈 문자열 대신 null을 보낸다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    // When
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/비고/), { target: { value: "  " } });
      fireEvent.blur(screen.getByLabelText(/비고/));
    });
    // Then
    expect(updateRegField).toHaveBeenCalledExactlyOnceWith("reg-1", { note: "기존 비고" }, { note: null });
  });
});

describe("RegDrawer — 입력 보존과 닫기", () => {
  it.each(["이름", "학번", "비고 (특이사항 등 자유 기록)"])("%s 입력 중 Escape의 취소와 버리기는 저장을 일으키지 않는다", async (label) => {
    // Given
    render(<RegDrawer {...props} />);
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: "새 초안" } });
    // When: Escape로 닫기 확인을 열고 취소한 뒤 다시 버린다
    fireEvent(screen.getByRole("dialog", { name: "김순장 편집" }), new Event("cancel", { cancelable: true }));
    await act(async () => { fireEvent.blur(input); });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(updateRegField).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(input).toHaveValue("새 초안");
    fireEvent(screen.getByRole("dialog", { name: "김순장 편집" }), new Event("cancel", { cancelable: true }));
    fireEvent.click(screen.getByRole("button", { name: "변경 버리고 닫기" }));
    // Then
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(updateRegField).not.toHaveBeenCalled();
  });
  it("미저장 참여 날짜는 닫기 확인을 취소해도 보존된다", () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.click(screen.getByLabelText("행사의 일부 기간만 참석합니다"));
    fireEvent.change(screen.getByLabelText("참여 시작 날짜"), { target: { value: "2026-08-14" } });
    // When
    fireEvent.click(screen.getByRole("button", { name: "편집 닫기" }));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    // Then
    expect(screen.getByLabelText("참여 시작 날짜")).toHaveValue("2026-08-14");
    expect(saveJourney).not.toHaveBeenCalled();
  });
  it("서버에서 최신 이름이 오면 과거 초안으로 다시 저장하지 않는다", async () => {
    // Given
    const view = render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "과거 초안" } });
    // When
    view.rerender(<RegDrawer {...props} row={{ ...row, name: "다른 담당자가 저장한 이름" }} />);
    await act(async () => { fireEvent.blur(screen.getByLabelText("이름")); });
    // Then
    expect(screen.getByLabelText("이름")).toHaveValue("다른 담당자가 저장한 이름");
    expect(updateRegField).not.toHaveBeenCalled();
  });
  it("포인터로 닫기를 눌러도 미저장 글자를 먼저 자동 저장하지 않는다", async () => {
    // Given
    const user = userEvent.setup();
    render(<RegDrawer {...props} />);
    // When
    await act(async () => {
      await user.click(screen.getByLabelText("이름"));
      await user.clear(screen.getByLabelText("이름"));
      await user.type(screen.getByLabelText("이름"), "미저장 수정");
      await user.click(screen.getByRole("button", { name: "편집 닫기" }));
    });
    // Then
    expect(screen.getByRole("button", { name: "변경 버리고 닫기" })).toBeInTheDocument();
    expect(updateRegField).not.toHaveBeenCalled();
  });
  it("서랍을 열고 닫으면 초점이 원래 버튼으로 돌아간다", () => {
    // Given
    render(<button>편집 열기</button>);
    const opener = screen.getByRole("button", { name: "편집 열기" });
    opener.focus();
    const view = render(<RegDrawer {...props} />);
    expect(screen.getByRole("button", { name: "편집 닫기" })).toHaveFocus();
    // When
    view.unmount();
    // Then
    expect(opener).toHaveFocus();
  });
});

describe("RegDrawer — 선택 수송·수강신청", () => {
  it("픽업 장소는 자유 입력 대신 총단이 등록한 선택 목록이다", () => {
    // Given / When
    render(<RegDrawer {...props} places={[{ id: 7, name: "합성 역" }]} />);
    // Then
    expect(screen.getByLabelText("픽업 장소").tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "합성 역" })).toBeInTheDocument();
  });
  it("총단이 장소를 안 만들었으면 고를 수 없음을 알린다", () => {
    // Given / When
    render(<RegDrawer {...props} />);
    // Then
    expect(screen.getByLabelText("픽업 장소")).toBeDisabled();
    expect(screen.getByText(/등록된 픽업 장소가 없습니다/)).toBeInTheDocument();
  });
  it("픽업 날짜만 입력하면 저장을 막고 초안을 보존한다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.click(screen.getByText("수송 요청 (선택) · 0건"));
    fireEvent.change(screen.getByLabelText("픽업 일시 날짜"), { target: { value: "2026-08-14" } });
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "수송 요청 추가" })); });
    // Then
    expect(addPickup).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("날짜와 시각");
    expect(screen.getByLabelText("픽업 일시 날짜")).toHaveValue("2026-08-14");
  });
  it("수강신청을 켜면 날짜 대신 몇째 날과 시간 미정을 저장한다", async () => {
    // Given
    render(<RegDrawer {...props} />);
    fireEvent.click(screen.getByText("수강신청 (선택) · 0일"));
    // When
    await act(async () => { fireEvent.click(screen.getByLabelText("첫째날 수강신청")); });
    // Then
    expect(setCourseSignup).toHaveBeenCalledExactlyOnceWith("reg-1", 1, null);
    expect(saveJourney).not.toHaveBeenCalled();
  });
  it("수강신청을 끄면 해당 날의 행을 삭제한다", async () => {
    // Given
    render(<RegDrawer {...props} courses={[{ dayNo: 1, atTime: null }]} />);
    // When
    await act(async () => { fireEvent.click(screen.getByLabelText("첫째날 수강신청")); });
    // Then
    expect(clearCourseSignup).toHaveBeenCalledExactlyOnceWith("reg-1", 1);
  });
});
