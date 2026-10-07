// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FleetPanel } from "@/components/admin/fleet-panel";
import { createTripWithBuses, setTripBusCount, updateTrip } from "@/lib/admin/trips";
import { createBus, updateBus } from "@/lib/admin/buses";
import type { TripRow } from "@/lib/admin/trips";
import type { BusRow } from "@/lib/admin/buses";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/admin/trips", () => ({ createTripWithBuses: vi.fn(), updateTrip: vi.fn(), setTripBusCount: vi.fn(), deleteTrip: vi.fn() }));
vi.mock("@/lib/admin/buses", () => ({ createBus: vi.fn(), updateBus: vi.fn(), deleteBus: vi.fn() }));
const trip = { id: 1, key: "up_1", label: "오전 출발", direction: "up", display_order: 1, active: true,
  created_at: "2026-10-07T00:00:00Z", event_id: "e1", departs_at: null, origin: null, destination: null } satisfies TripRow;
const bus = { id: 1, name: "1호차", capacity: 44, hard_cap: 45, up_trip_id: 1, down_trip_id: null,
  event_id: "e1", kind: "bus", display_order: 1, driver_registration_id: null, down_driver_registration_id: null,
  fixed_passenger_ids: [], down_fixed_passenger_ids: [], is_cohesion_exempt: false, fill_priority: 0 } satisfies BusRow;
const failure = { ok: false, message: "synthetic rejected write" } as const;
function showFleet() { render(<FleetPanel trips={[trip]} buses={[bus]} loads={{}} upRequests={{}} downRequests={{}} />); }
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("진행 중 편성 초안 보존", () => {
  it("운행편 저장 중 이름·대수·취소를 잠그고 실패 후 같은 초안을 남긴다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(updateTrip).mockReturnValueOnce(reply.promise);
    showFleet();
    await user.click(screen.getAllByRole("button", { name: "수정" })[0]);
    const name = screen.getByLabelText("운행편 이름");
    const count = screen.getByRole("spinbutton", { name: /이 편 차량/ });
    await user.clear(name); await user.type(name, "야간 출발");
    await user.clear(count); await user.type(count, "2");
    // When
    await user.click(screen.getByRole("button", { name: "저장" }));
    // Then
    expect(name).toBeDisabled(); expect(count).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    await user.type(name, "새 초안"); await user.click(screen.getByRole("button", { name: "취소" }));
    expect(name).toHaveValue("야간 출발");
    await act(async () => { reply.resolve(failure); });
    expect(name).toBeEnabled(); expect(name).toHaveValue("야간 출발"); expect(count).toHaveValue(2);
  });

  it("편 이름 저장 뒤 대수 저장이 진행 중이어도 잠금과 실패 초안을 유지한다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(updateTrip).mockResolvedValueOnce({ ok: true, value: { ...trip, label: "야간 출발" } });
    vi.mocked(setTripBusCount).mockReturnValueOnce(reply.promise);
    showFleet();
    await user.click(screen.getAllByRole("button", { name: "수정" })[0]);
    const name = screen.getByLabelText("운행편 이름");
    const count = screen.getByRole("spinbutton", { name: /이 편 차량/ });
    await user.clear(name); await user.type(name, "야간 출발");
    await user.clear(count); await user.type(count, "2");
    // When
    await user.click(screen.getByRole("button", { name: "저장" }));
    // Then
    expect(setTripBusCount).toHaveBeenCalledExactlyOnceWith(1, "up", 2);
    expect(name).toBeDisabled(); expect(count).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    await act(async () => { reply.resolve(failure); });
    expect(name).toBeEnabled(); expect(name).toHaveValue("야간 출발"); expect(count).toHaveValue(2);
  });

  it("새 운행편 생성 중 입력을 잠그고 실패 후 이름·대수를 유지한다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(createTripWithBuses).mockReturnValueOnce(reply.promise);
    showFleet();
    const name = screen.getAllByLabelText("새 운행편 이름")[0];
    const count = screen.getAllByRole("spinbutton", { name: "이 편을 뛸 차량 대수" })[0];
    await user.type(name, "야간 출발"); await user.clear(count); await user.type(count, "2");
    // When
    await user.click(screen.getAllByRole("button", { name: "추가" })[0]);
    // Then
    expect(name).toBeDisabled(); expect(count).toBeDisabled();
    await user.type(name, "새 초안");
    expect(name).toHaveValue("야간 출발");
    await act(async () => { reply.resolve(failure); });
    expect(name).toBeEnabled(); expect(name).toHaveValue("야간 출발"); expect(count).toHaveValue(2);
  });

  it("새 차량 생성 중 이름·종류를 잠그고 기존 간사 차량 입력을 보존한다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(createBus).mockReturnValueOnce(reply.promise);
    showFleet();
    const name = screen.getByLabelText("새 호차 이름");
    const kind = screen.getByRole("combobox", { name: "차량 종류" });
    await user.type(name, "간사차"); await user.selectOptions(kind, "staff_car");
    // When
    await user.click(screen.getAllByRole("button", { name: "추가" })[2]);
    // Then
    expect(name).toBeDisabled(); expect(kind).toBeDisabled();
    await user.type(name, "새 초안"); await user.selectOptions(kind, "bus");
    expect(name).toHaveValue("간사차"); expect(kind).toHaveValue("staff_car");
    await act(async () => { reply.resolve(failure); });
    expect(name).toBeEnabled(); expect(name).toHaveValue("간사차");
    expect(createBus).toHaveBeenCalledExactlyOnceWith({ name: "간사차", kind: "staff_car", capacity: 4, hardCap: 4, upTripId: 1, downTripId: null });
  });

  it("차량 수정 저장 중 입력·선택·특례·취소를 잠그고 실패 후 수정 상태를 남긴다", async () => {
    // Given
    const user = userEvent.setup();
    const reply = Promise.withResolvers<typeof failure>();
    vi.mocked(updateBus).mockReturnValueOnce(reply.promise);
    showFleet();
    const edits = screen.getAllByRole("button", { name: "수정" });
    await user.click(edits[edits.length - 1]);
    const name = screen.getByLabelText("차량 이름");
    await user.clear(name); await user.type(name, "바꾼 호차");
    // When
    await user.click(screen.getByRole("button", { name: "저장" }));
    // Then
    for (const control of [name, screen.getByLabelText("정원"), screen.getByLabelText("보조석 포함 최대"),
      screen.getByRole("combobox", { name: "상행 편" }), screen.getByRole("combobox", { name: "하행 편" }),
      ...screen.getAllByRole("checkbox"), screen.getByRole("button", { name: "취소" })]) expect(control).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(name).toBeInTheDocument();
    await act(async () => { reply.resolve(failure); });
    expect(name).toBeEnabled(); expect(name).toHaveValue("바꾼 호차");
  });
});
