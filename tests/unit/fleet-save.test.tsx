// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetTripRow } from "@/components/admin/fleet-trip-row";
import { FleetTripSection } from "@/components/admin/fleet-trip-section";
import type { TripRow } from "@/lib/admin/trips";
const TRIP = { id: 1, key: "up_1", label: "오전 출발", direction: "up", display_order: 1, active: true, created_at: "2026-01-01", event_id: "e1", departs_at: null, origin: null, destination: null } satisfies TripRow;
afterEach(cleanup);
describe("편성 실패 시 입력 보존", () => {
  it("운행편 저장 실패 시 닫지 않고 차량 대수 저장도 실행하지 않는다", async () => {
    const patch = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const count = vi.fn().mockResolvedValue(true);
    render(<FleetTripRow trip={TRIP} busCount={1} pending={false} onPatch={patch} onBusCount={count} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("운행편 이름"), { target: { value: "밤 출발" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /이 편 차량/ }), { target: { value: "2" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "저장" })); });
    expect(screen.getByLabelText("운행편 이름")).toHaveProperty("value", "밤 출발");
    expect(count).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "저장" })); });
    expect(count).toHaveBeenCalledWith(1, 2);
    expect(screen.queryByLabelText("운행편 이름")).toBeNull();
  });
  it("새 운행편 생성 실패 후 이름과 일시를 재입력하지 않아도 된다", async () => {
    const create = vi.fn().mockResolvedValue(false);
    render(<FleetTripSection direction="up" trips={[]} buses={[]} pending={false} onCreate={create} onPatch={vi.fn()} onBusCount={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("새 운행편 이름"), { target: { value: "밤 출발" } });
    fireEvent.change(screen.getByLabelText("날짜"), { target: { value: "2026-08-14" } });
    fireEvent.change(screen.getByLabelText("시각"), { target: { value: "23:30" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "추가" })); });
    expect(screen.getByLabelText("새 운행편 이름")).toHaveProperty("value", "밤 출발");
    expect(screen.getByLabelText("시각")).toHaveProperty("value", "23:30");
  });
});
