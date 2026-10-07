// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegForm } from "@/components/admin/reg-form";
import { createCompleteRegistration } from "@/lib/registrations/create";
import type { EventTrip } from "@/lib/supabase/types";

vi.mock("@/lib/registrations/create", () => ({ createCompleteRegistration: vi.fn() }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const eventId = "30000000-0000-4000-8000-000000000001";
const campus = "10000000-0000-4000-8000-000000000001";
const unit = "20000000-0000-4000-8000-000000000001";
const trips: EventTrip[] = [1, 2].map((id) => ({ id, key: `trip-${id}`, label: `운행편 ${id}`, direction: id === 1 ? "up" : "down", active: true, display_order: id, created_at: "2026-10-07T00:00:00Z", event_id: "30000000-0000-4000-8000-000000000001", departs_at: null, origin: null, destination: null }));
const onClose = vi.fn();
function mount(lockedCampusId?: string) {
  return render(<RegForm eventId={eventId} campuses={[{ id: campus, name: "캠퍼스" }]} trips={trips} units={[{ id: unit, name: "타지구" }]} places={[{ id: 9, name: "역 앞" }]} dayCount={3} lockedCampusId={lockedCampusId} onClose={onClose} />);
}
function basic() {
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "추가 학우" } });
  fireEvent.change(screen.getByLabelText("학번"), { target: { value: "26" } });
}
async function submit() {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "신청 추가" })); });
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(createCompleteRegistration).mockResolvedValue({ ok: true, id: "created-id" }); });
afterEach(cleanup);

describe("신규 신청의 필드 일관성", () => {
  it.each([undefined, campus])("관리자와 캠퍼스가 같은 전체 정보를 한 번에 저장한다 (%s)", async (lockedCampusId) => {
    // Given
    mount(lockedCampusId); basic();
    fireEvent.change(screen.getByLabelText("상행 (가는 편)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("하행 (오는 편)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("참여 시작일"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("참여 종료일"), { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "ktx" } });
    fireEvent.change(screen.getByLabelText("수련회장 → 지구 이동수단"), { target: { value: "other_district" } });
    fireEvent.change(screen.getByLabelText("수련회장 → 지구 타지구 이름"), { target: { value: unit } });
    fireEvent.click(screen.getByRole("button", { name: "수송 요청 추가" }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("시각"), { target: { value: "15:40" } });
    fireEvent.change(screen.getByLabelText("픽업 장소"), { target: { value: "9" } });
    fireEvent.click(screen.getByLabelText("첫째날 수강신청"));
    fireEvent.change(screen.getByLabelText("첫째날 시간"), { target: { value: "12:30" } });
    // When
    await submit();
    // Then
    expect(createCompleteRegistration).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      campus_id: campus, up_trip_id: null, down_trip_id: 2, attend_from: "2026-10-10", attend_to: "2026-10-12",
      legs: [{ direction: "up", mode: "ktx", status: "confirmed", via_unit_id: null }, { direction: "down", mode: "other_district", status: "pending", via_unit_id: unit }],
      pickups: [{ direction: "up", pickup_at: "2026-10-10T15:40:00+09:00", place_id: 9, note: null }], courses: [{ day_no: 1, at_time: "12:30" }],
    }), eventId);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("부가 정보 저장 실패는 입력을 남기고 폼을 닫지 않는다", async () => {
    // Given
    mount(); basic();
    vi.mocked(createCompleteRegistration).mockResolvedValue({ ok: false, message: "late stage failure" });
    // When
    await submit();
    // Then
    expect(screen.getByRole("alert").textContent).toContain("late stage failure");
    expect(document.activeElement).toBe(screen.getByRole("alert"));
    expect(screen.getByDisplayValue("추가 학우")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("픽업 날짜만 입력하면 저장을 시작하지 않는다", async () => {
    // Given
    mount(); basic(); fireEvent.click(screen.getByRole("button", { name: "수송 요청 추가" }));
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-10-10" } });
    // When
    await submit();
    // Then
    expect(createCompleteRegistration).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("미정인 픽업 시각과 장소는 NULL로 저장한다", async () => {
    // Given
    mount(); basic(); fireEvent.click(screen.getByRole("button", { name: "수송 요청 추가" }));
    // When
    await submit();
    // Then
    expect(createCompleteRegistration).toHaveBeenCalledWith(expect.objectContaining({ pickups: [{ direction: "up", pickup_at: null, place_id: null, note: null }] }), eventId);
  });

  it("저장 여부가 불명확하면 즉시 재전송하지 않고 초안을 보존한다", async () => {
    // Given
    mount(); basic(); vi.mocked(createCompleteRegistration).mockResolvedValue({ ok: false, message: "network uncertainty", uncertain: true });
    // When
    await submit();
    // Then
    expect(screen.getByRole("button", { name: "신청 추가" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "명단 새로고침" })).toBeTruthy();
    expect(document.querySelector('form[data-unsaved="true"]')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
  it("저장 확인을 취소하면 재전송 잠금과 초안을 유지한다", async () => {
    // Given
    mount(); basic(); vi.mocked(createCompleteRegistration).mockResolvedValue({ ok: false, message: "network uncertainty", uncertain: true });
    await submit();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "명단 확인 후 다시 저장" })); });
    // When
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "명단에 같은 신청이 없나요?" })).getByRole("button", { name: "취소" })); });
    // Then
    expect(screen.getByRole("button", { name: "신청 추가" }).hasAttribute("disabled")).toBe(true);
    expect(createCompleteRegistration).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("추가 학우")).toBeTruthy();
  });

  it("미저장 신청에서 ESC를 취소하면 모든 입력을 보존한다", async () => {
    mount(); basic();
    fireEvent.change(screen.getByLabelText("참여 시작일"), { target: { value: "2026-10-10" } });
    await act(async () => { fireEvent(screen.getByRole("dialog", { name: "순장/순원 추가" }), new Event("cancel", { cancelable: true })); });
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog", { name: "입력한 신청을 닫을까요?" })).getByRole("button", { name: "취소" })); });
    expect(screen.getByLabelText("이름")).toHaveValue("추가 학우");
    expect(screen.getByLabelText("참여 시작일")).toHaveValue("2026-10-10");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("저장 중에는 새 패널의 닫기와 입력 이동도 잠그고 실패 후 초안을 보존한다", async () => {
    mount(); basic();
    const reply = Promise.withResolvers<{ ok: false; message: string }>();
    vi.mocked(createCompleteRegistration).mockReturnValueOnce(reply.promise);
    await submit();
    expect(screen.getByRole("button", { name: "신청 입력 닫기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "수송 요청 입력으로 이동" })).toBeDisabled();
    await act(async () => { fireEvent(screen.getByRole("dialog", { name: "순장/순원 추가" }), new Event("cancel", { cancelable: true })); });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { reply.resolve({ ok: false, message: "합성 저장 실패" }); });
    expect(screen.getByLabelText("이름")).toHaveValue("추가 학우");
    expect(screen.getByRole("button", { name: "신청 입력 닫기" })).toBeEnabled();
  });
  it("추가는 모달로 열고 크기 변경 중에도 버림 확인과 초안을 보존한다", async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const media = window.matchMedia("(min-width: 768px)");
    const matches = vi.spyOn(media, "matches", "get").mockReturnValue(true);
    const mediaCall = vi.spyOn(window, "matchMedia").mockReturnValue(media);
    try {
      mount(); basic();
      const panel = screen.getByRole("dialog", { name: "순장/순원 추가" });
      expect(panel).toHaveAttribute("aria-modal", "true");
      expect(showModal.mock.instances).toContain(panel);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "신청 입력 닫기" })); });
      const confirmation = screen.getByRole("dialog", { name: "입력한 신청을 닫을까요?" });
      await act(async () => { window.dispatchEvent(new Event("resize")); });
      expect(confirmation.contains(document.activeElement)).toBe(true);
      await act(async () => { fireEvent.click(within(confirmation).getByRole("button", { name: "취소" })); });
      expect(screen.getByLabelText("이름")).toHaveValue("추가 학우");
      expect(onClose).not.toHaveBeenCalled();
    } finally { showModal.mockRestore(); mediaCall.mockRestore(); matches.mockRestore(); }
  });
});
