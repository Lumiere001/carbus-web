// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BusesPanel } from "@/components/admin/buses-panel";
import type { BusData, CandidateData } from "@/components/admin/buses-panel";
import { setDriver, setFixedPassengers } from "@/lib/admin/buses";
import type { BusRow } from "@/lib/admin/buses";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/admin/buses", () => ({ setDriver: vi.fn(), setFixedPassengers: vi.fn() }));
const firstId = "10000000-0000-4000-8000-000000000001";
const nextId = "10000000-0000-4000-8000-000000000002";
const candidates: CandidateData[] = [
  { id: firstId, name: "기존 인원", student_id: "26", campus_name: "전남대", up_trip_id: 1, down_trip_id: 2 },
  { id: nextId, name: "별도 이동 인원", student_id: "26", campus_name: "전남대", up_trip_id: null, down_trip_id: null },
];
const row = { id: 1, name: "간사차", event_id: "e1", kind: "staff_car", capacity: 3, hard_cap: 3,
  up_trip_id: 1, down_trip_id: 2, driver_registration_id: firstId, down_driver_registration_id: null,
  fixed_passenger_ids: [firstId], down_fixed_passenger_ids: [], is_cohesion_exempt: false,
  fill_priority: 0, display_order: 0 } satisfies BusRow;
const bus = { ...row, passengers: [], downPassengers: [] } satisfies BusData;
const trips = [{ id: 1, label: "올라갈 때", active: true, display_order: 1, direction: "up" },
  { id: 2, label: "내려올 때", active: true, display_order: 2, direction: "down" }] as const;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function show(b: BusData = bus) {
  return render(<BusesPanel buses={[b]} candidates={candidates} trips={[...trips]} isMaster />);
}

describe("호차 화면 저장 계약", () => {
  it("간사차는 별도 이동 신청자도 고정 후보에 포함한다", () => {
    // Given / When
    show();
    // Then
    expect(screen.getAllByRole("option", { name: "별도 이동 인원 (전남대)" })).toHaveLength(2);
  });

  it("일반 버스는 신청한 편과 다른 사람을 후보에 포함하지 않는다", () => {
    // Given / When
    show({ ...bus, kind: "bus" });
    // Then
    expect(screen.queryByRole("option", { name: "별도 이동 인원 (전남대)" })).toBeNull();
  });

  it("기사 저장 실패는 새 명단을 불러오지 않고 기존 선택을 유지한다", async () => {
    // Given
    vi.mocked(setDriver).mockResolvedValue({ ok: false, message: "동시 변경" });
    show();
    // When
    await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "간사차 상행 차량순장" }), { target: { value: nextId } }); });
    // Then
    expect(screen.getByRole("combobox", { name: "간사차 상행 차량순장" })).toHaveValue(firstId);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("동시 변경");
  });

  it("고정 저장 성공은 기사와 기존 고정 값을 전달하고 실제 명단을 새로 불러온다", async () => {
    // Given
    vi.mocked(setFixedPassengers).mockResolvedValue({ ok: true, row });
    show();
    // When
    await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "간사차 상행 고정 탑승자 추가" }), { target: { value: nextId } }); });
    // Then
    expect(setFixedPassengers).toHaveBeenCalledExactlyOnceWith({ busId: 1, mode: "up", driverId: firstId, fixedIds: [firstId] }, [firstId, nextId]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("서버가 갱신한 기사와 탑승 명단을 화면에 반영한다", () => {
    // Given
    const view = show();
    // When
    view.rerender(<BusesPanel buses={[{ ...bus, driver_registration_id: nextId, passengers: [candidates[1]] }]} candidates={candidates} trips={[...trips]} isMaster />);
    // Then
    expect(screen.getByRole("combobox", { name: "간사차 상행 차량순장" })).toHaveValue(nextId);
    expect(screen.getByText("1 / 3석")).toBeInTheDocument();
  });
});
