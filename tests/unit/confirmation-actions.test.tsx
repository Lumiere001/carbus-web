// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FleetTripRow } from "@/components/admin/fleet-trip-row";
import { CampusPaymentsPanel } from "@/components/campus/payments-panel";
import { deleteRemittance } from "@/lib/campus/payments";
import type { TripRow } from "@/lib/admin/trips";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/campus/payments", () => ({
  deleteRemittance: vi.fn(async () => ({ ok: true })),
  addRemittance: vi.fn(async () => ({ ok: true })),
  setPaymentStatus: vi.fn(async () => ({ ok: true })),
}));

const TRIP = {
  id: 1, key: "up_1", label: "오전 출발", direction: "up", display_order: 10,
  active: true, created_at: "2026-07-01T00:00:00Z", event_id: "e1",
  departs_at: null, origin: null, destination: null,
} satisfies TripRow;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("확인 이후 쓰기", () => {
  it.each([["취소", 0], ["운행편 삭제", 1]])("운행편 삭제에서 %s를 누르면 허용한 동작만 실행한다", async (action, calls) => {
    // Given: 외부 쓰기는 콜백으로 기록
    const remove = vi.fn();
    render(<FleetTripRow trip={TRIP} busCount={0} pending={false} onPatch={vi.fn()} onBusCount={vi.fn()} onDelete={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(remove).not.toHaveBeenCalled();
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: action })); });
    // Then
    expect(remove).toHaveBeenCalledTimes(calls);
    if (calls) expect(remove).toHaveBeenCalledWith(1);
  });

  it.each([["취소", 0], ["송금 삭제", 1]])("송금 삭제에서 %s를 누르면 확인 전 요청 없이 처리한다", async (action, calls) => {
    // Given: 실제 DB 대신 쓰기 경계만 기록
    render(<CampusPaymentsPanel campusName="전남대" rows={[]} remittances={[{ id: "remit-1", amount: 10000, note: null, created_at: "2026-08-01T00:00:00Z" }]} masterReceived={0} masterReceivedAt={null} />);
    fireEvent.click(screen.getByRole("button", { name: "송금 항목 삭제" }));
    expect(deleteRemittance).not.toHaveBeenCalled();
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: action })); });
    // Then
    expect(deleteRemittance).toHaveBeenCalledTimes(calls);
    if (calls) expect(deleteRemittance).toHaveBeenCalledWith("remit-1");
  });
});
