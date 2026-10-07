// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StaffCarPanel, type StaffVehicle } from "@/components/admin/staff-car-panel";
import { LeadersPanel, type LeaderRow } from "@/components/admin/leaders-panel";
import { setFixedPassengers } from "@/lib/admin/buses";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/admin/buses", () => ({ setFixedPassengers: vi.fn() }));
const car = { id: 9, name: "합성 간사 차량", kind: "staff_car", up_trip_id: 1, down_trip_id: 2, hard_cap: 4,
  driver_registration_id: "driver", fixed_passenger_ids: ["fixed"], down_driver_registration_id: null, down_fixed_passenger_ids: [] } satisfies StaffVehicle;
const people = [
  { id: "new", name: "새 탑승자", student_id: "26", campus_name: "가 캠퍼스", up_trip_id: null, down_trip_id: null },
  { id: "fixed", name: "기존 탑승자", student_id: "24", campus_name: "나 캠퍼스", up_trip_id: null, down_trip_id: null },
  { id: "driver", name: "차량순장", student_id: "23", campus_name: "가 캠퍼스", up_trip_id: null, down_trip_id: null },
];
const leader = { id: "fixed", name: "기존 탑승자", student_id: "24", campus_name: "나 캠퍼스", roleBadges: ["고정 탑승자"], primaryKind: "fixed", up_trip_id: 1, down_trip_id: 2, ridesUp: true, ridesDown: true, upKind: "fixed", downKind: "fixed", upBusId: 9, downBusId: null, needUp: false, needDown: true } satisfies LeaderRow;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("간사 차량을 먼저 고르는 배정", () => {
  it("일반 인원을 바로 검색해 고정 지정하되 실패하면 기존 탑승자를 보존한다", async () => {
    // Given
    vi.mocked(setFixedPassengers).mockResolvedValue({ ok: false, message: "동시 변경으로 저장하지 않았습니다" });
    render(<StaffCarPanel vehicles={[car]} people={people} isMaster />);
    fireEvent.change(screen.getByRole("searchbox", { name: "추가할 사람 찾기" }), { target: { value: "새탑승자" } });
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "새 탑승자 합성 간사 차량 상행 고정 지정" })); });
    // Then
    expect(setFixedPassengers).toHaveBeenCalledExactlyOnceWith({ busId: 9, mode: "up", driverId: "driver", fixedIds: ["fixed"] }, ["fixed", "new"]);
    expect(screen.getByRole("alert")).toHaveTextContent("동시 변경");
    expect(screen.getByText("기존 탑승자")).toBeDefined();
    expect(screen.getByRole("button", { name: "기존 탑승자 상행 고정 해제" })).toBeDefined();
  });

  it("정원에 도달하면 새 고정 지정을 허용하지 않는다", () => {
    // Given
    render(<StaffCarPanel vehicles={[{ ...car, hard_cap: 2 }]} people={people} isMaster />);
    // When
    fireEvent.change(screen.getByRole("searchbox", { name: "추가할 사람 찾기" }), { target: { value: "새 탑승자" } });
    // Then
    expect(screen.getByRole("button", { name: "새 탑승자 합성 간사 차량 상행 고정 지정" })).toBeDisabled();
    expect(setFixedPassengers).not.toHaveBeenCalled();
  });

  it("조회 사용자는 탑승 명단을 읽지만 고정 지정·해제할 수 없다", () => {
    // Given / When
    render(<StaffCarPanel vehicles={[car]} people={people} isMaster={false} />);
    // Then
    expect(screen.getByText("기존 탑승자")).toBeDefined();
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /고정 해제/ })).toBeNull();
  });

  it("캠퍼스와 미지정 조건을 함께 적용해 대상 리더만 찾는다", () => {
    // Given
    render(<LeadersPanel leaders={[leader, { ...leader, id: "other", name: "다른 리더", campus_name: "가 캠퍼스", roleBadges: ["총단"], needDown: false }]} buses={[car]} trips={[]} isMaster vehicles={[car]} candidates={people} />);
    // When
    fireEvent.change(screen.getByRole("combobox", { name: "캠퍼스" }), { target: { value: "나 캠퍼스" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "호차 미지정만" }));
    // Then
    expect(screen.getByText("기존 탑승자")).toBeDefined();
    expect(screen.queryByText("다른 리더")).toBeNull();
  });
});
