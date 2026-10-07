// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RegistrationsPanel } from "@/components/admin/registrations-panel";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import { setRoles } from "@/lib/admin/registrations";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/admin/registrations", () => ({ setRoles: vi.fn(), setAssignment: vi.fn(), excludeRegistration: vi.fn(), restoreRegistration: vi.fn() }));
const row = { id: "10000000-0000-4000-8000-000000000001", name: "합성 인원", student_id: "26", campus_id: "c1",
  attendance_type: "roundtrip", up_trip_id: 1, down_trip_id: 2, fee: 50000, payment_status: "unpaid", roles: [], note: null,
  assigned_up_bus_id: null, assigned_down_bus_id: null, participation_status: "cancelled", cancel_reason: null,
  attend_from: null, attend_to: null } satisfies AdminRegRow;
const props = { eventId: "30000000-0000-4000-8000-000000000001", campuses: [{ id: "c1", name: "합성 캠퍼스", display_order: 0 }],
  buses: [{ id: 1, name: "1호차", up_trip_id: 1, down_trip_id: 2, capacity: 2, kind: "bus" }],
  roleLabels: [{ label: "일반 역할", color: "green" }], isMaster: true, groupByBus: false,
  driverIds: new Set<string>(), fixedIds: new Set<string>(), trips: [], units: [], legs: {}, pickups: {}, places: [], courses: {}, dayCount: 3 } as const;
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("수동 배정 화면 방어", () => {
  it.each(["cancelled", "registered"] as const)("%s 신청은 정책에 맞게 배정 선택을 잠근다", (status) => {
    // Given / When
    render(<RegistrationsPanel {...props} campuses={[...props.campuses]} buses={[...props.buses]} roleLabels={[...props.roleLabels]} trips={[...props.trips]} units={[...props.units]} places={[...props.places]} rows={[{ ...row, participation_status: status }]} />);
    // Then
    const selects = [screen.getByRole("combobox", { name: "합성 인원 상행 배정 호차" }), screen.getByRole("combobox", { name: "합성 인원 하행 배정 호차" })];
    for (const select of selects) expect(select.hasAttribute("disabled")).toBe(status === "cancelled");
  });

  it("일반 역할 충돌은 기존 배열을 전달하고 최신 행을 다시 불러온다", async () => {
    // Given
    vi.mocked(setRoles).mockResolvedValue({ ok: false, conflict: true, message: "역할 동시 변경" });
    render(<RegistrationsPanel {...props} campuses={[...props.campuses]} buses={[...props.buses]} roleLabels={[...props.roleLabels]} trips={[...props.trips]} units={[...props.units]} places={[...props.places]} rows={[{ ...row, participation_status: "registered" }]} />);
    // When
    await act(async () => { fireEvent.change(screen.getByRole("combobox", { name: "합성 인원 역할 추가" }), { target: { value: "일반 역할" } }); });
    // Then
    expect(setRoles).toHaveBeenCalledExactlyOnceWith(row.id, [], ["일반 역할"]);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
