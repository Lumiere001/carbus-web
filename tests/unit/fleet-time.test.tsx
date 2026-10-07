// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FleetTripSection } from "@/components/admin/fleet-trip-section";
import { FleetTripRow } from "@/components/admin/fleet-trip-row";
import type { TripRow } from "@/lib/admin/trips";

const TRIP = {
  id: 1, key: "up_1", label: "자정 출발", direction: "up",
  display_order: 10, active: true, created_at: "2026-07-01T00:00:00Z",
  event_id: "e1", departs_at: "2026-08-11T15:15:00Z", origin: null, destination: null,
} satisfies TripRow;

afterEach(cleanup);

function createSection() {
  const create = vi.fn();
  render(<FleetTripSection direction="up" trips={[]} buses={[]} pending={false} onCreate={create} onPatch={vi.fn()} onBusCount={vi.fn()} onDelete={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("새 운행편 이름"), { target: { value: "자정 출발" } });
  return create;
}

function editRow() {
  const patch = vi.fn();
  const busCount = vi.fn();
  render(<FleetTripRow trip={TRIP} busCount={1} pending={false} onPatch={patch} onBusCount={busCount} onDelete={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  return { patch, busCount };
}

describe("운행편 한국 날짜·시각 저장", () => {
  it("새 운행편의 자정 출발은 한국 시간으로 저장한다", () => {
    // Given: 날짜·시각이 완성된 새 운행편
    const create = createSection();
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-08-12" } });
    fireEvent.change(screen.getByLabelText("시각"), { target: { value: "00:15" } });
    // When
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    // Then
    expect(create).toHaveBeenCalledWith("자정 출발", "2026-08-12T00:15:00+09:00", 0);
  });

  it.each([["날짜", "2026-08-12"], ["시각", "00:15"]])("새 운행편에 %s만 입력하면 저장을 막고 입력을 남긴다", (label, value) => {
    // Given
    const create = createSection();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    // When
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    // Then: 부모 저장 호출 없이 작성 중인 값 유지
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByLabelText(label)).toHaveProperty("value", value);
  });

  it("출발 일시를 모두 비운 새 운행편은 미정으로 저장한다", () => {
    // Given
    const create = createSection();
    // When
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    // Then
    expect(create).toHaveBeenCalledWith("자정 출발", null, 0);
  });

  it("저장된 UTC 자정 경계 일시는 한국 날짜로 수정하고 그대로 저장한다", () => {
    // Given
    const { patch } = editRow();
    expect(screen.getByLabelText("날짜")).toHaveProperty("value", "2026-08-12");
    expect(screen.getByLabelText("시각")).toHaveProperty("value", "00:15");
    // When
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    // Then
    expect(patch).toHaveBeenCalledWith(1, { label: "자정 출발", departsAt: "2026-08-12T00:15:00+09:00" });
  });

  it.each(["날짜", "시각"])("수정 중 %s만 지우면 편 정보와 차량 대수를 저장하지 않는다", (label) => {
    // Given
    const { patch, busCount } = editRow();
    fireEvent.change(screen.getByLabelText(label), { target: { value: "" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /이 편 차량/ }), { target: { value: "2" } });
    // When
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    // Then
    expect(patch).not.toHaveBeenCalled();
    expect(busCount).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("반쪽 입력을 취소하고 다시 열면 저장된 일시로 돌아온다", () => {
    // Given
    editRow();
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    // When
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    // Then
    expect(screen.getByLabelText("날짜")).toHaveProperty("value", "2026-08-12");
    expect(screen.getByLabelText("시각")).toHaveProperty("value", "00:15");
  });
});
