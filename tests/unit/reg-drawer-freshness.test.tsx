// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegDrawer } from "@/components/admin/reg-drawer";
import type { AdminRegRow } from "@/components/admin/registrations-panel";
import type { LegValue } from "@/components/admin/transport-picker";

const { setAttendRange, setTransportLeg } = vi.hoisted(() => ({ setAttendRange: vi.fn(), setTransportLeg: vi.fn() }));
vi.mock("@/lib/admin/pickup", () => ({ setAttendRange, addPickup: vi.fn(), deletePickup: vi.fn() }));
vi.mock("@/lib/admin/transport", () => ({ setTransportLeg }));
vi.mock("@/lib/admin/registrations", () => ({ updateRegField: vi.fn() }));
const row: AdminRegRow = { id: "r1", name: "합성 학우", student_id: "26", campus_id: "c1", attendance_type: "roundtrip",
  up_trip_id: 1, down_trip_id: 2, fee: 50000, payment_status: "unpaid", roles: [], note: null,
  assigned_up_bus_id: 1, assigned_down_bus_id: 2, participation_status: "registered", cancel_reason: null,
  attend_from: "2026-10-07", attend_to: "2026-10-09" };
const our: LegValue = { mode: "our_bus", viaUnitId: null, status: "confirmed" };
const props = { row, campuses: [{ id: "c1", name: "합성 캠퍼스", display_order: 0 }], trips: [],
  units: [{ id: "u1", name: "합성 지구" }], places: [], courses: [], pickups: [], dayCount: 3, upLeg: our, downLeg: our, onSaved: vi.fn(), onClose: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); setAttendRange.mockResolvedValue({ ok: true }); setTransportLeg.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("서랍의 최신 정보와 작성 중 복합 입력", () => {
  it("수정 중이 아닌 이동수단은 새 서버 정보를 표시하며 쓰기를 하지 않는다", () => {
    const { rerender } = render(<RegDrawer {...props} />);
    rerender(<RegDrawer {...props} upLeg={{ mode: "ktx", viaUnitId: null, status: "confirmed" }} downLeg={{ mode: "own_car", viaUnitId: null, status: "confirmed" }} />);
    expect(screen.getByLabelText("지구 → 수련회장 이동수단")).toHaveValue("ktx");
    expect(screen.getByLabelText("수련회장 → 지구 이동수단")).toHaveValue("own_car");
    expect(setTransportLeg).not.toHaveBeenCalled();
  });
  it("미완성 타지구 초안은 외부 갱신으로 지워지지 않는다", () => {
    const { rerender } = render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "other_district" } });
    rerender(<RegDrawer {...props} upLeg={{ mode: "ktx", viaUnitId: null, status: "confirmed" }} />);
    expect(screen.getByLabelText("지구 → 수련회장 이동수단")).toHaveValue("other_district");
    expect(screen.getByLabelText("지구 → 수련회장 타지구 이름")).toHaveValue("");
    expect(setTransportLeg).not.toHaveBeenCalled();
  });
  it("좌석 반납 확인을 취소하면 가장 최근 서버 이동수단으로 돌아간다", async () => {
    const { rerender } = render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("지구 → 수련회장 이동수단"), { target: { value: "ktx" } });
    rerender(<RegDrawer {...props} upLeg={{ mode: "own_car", viaUnitId: null, status: "confirmed" }} />);
    expect(screen.getByLabelText("지구 → 수련회장 이동수단")).toHaveValue("ktx");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "취소" })); });
    expect(screen.getByLabelText("지구 → 수련회장 이동수단")).toHaveValue("own_car");
    expect(setTransportLeg).not.toHaveBeenCalled();
  });
  it("기간 충돌은 시작 시 두 날짜를 전달하고 최신 읽기를 요청하며 저장 완료로 표시하지 않는다", async () => {
    setAttendRange.mockResolvedValue({ ok: false, conflict: true, message: "다른 곳에서 기간을 바꿨습니다" });
    render(<RegDrawer {...props} />);
    fireEvent.change(screen.getByLabelText("참여 시작일"), { target: { value: "2026-10-08" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "기간 저장" })); });
    expect(setAttendRange).toHaveBeenCalledExactlyOnceWith("r1", "2026-10-08", "2026-10-09", { attend_from: "2026-10-07", attend_to: "2026-10-09" });
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith("최신값");
    expect(screen.getByRole("alert")).toHaveTextContent("다른 곳에서 기간");
    expect(screen.queryByText(/참여기간.*저장/)).not.toBeInTheDocument();
  });
});
