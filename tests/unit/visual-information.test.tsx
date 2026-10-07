// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CourseBoard } from "@/components/admin/course-board";
import { PartialList } from "@/components/admin/partial-list";
import { TransportPanel, type LegRow } from "@/components/admin/transport-panel";
import { SettlementOverview } from "@/components/admin/settlement-overview";
import { WorkspaceNav } from "@/components/ui/workspace-nav";
import { confirmLegs } from "@/lib/admin/transport";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/roster" }));
vi.mock("@/lib/admin/transport", () => ({ confirmLegs: vi.fn() }));
vi.mock("@/components/onsite/onsite-attendance", () => ({ OnsiteAttendance: ({ name }: { name: string }) => <p>합성 실제 기록 {name}</p> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("시각 구성의 정보와 행동 보존", () => {
  it.each(["09:00", null])("같은 사람의 두 날짜 수강신청을 두 사람으로 집계하지 않는다 (%s)", (atTime) => {
    render(<CourseBoard rows={[1, 2].map((dayNo) => ({ id: dayNo, dayNo, atTime, personName: "검증 학우", studentId: "26", campusName: "합성 캠퍼스", campusOrder: 1, onDate: null }))} />);
    expect(screen.getByText("신청 2건 · 한 사람의 여러 날짜 신청을 각각 집계합니다")).toBeTruthy();
    expect(screen.getAllByText("검증 학우")).toHaveLength(2);
    if (atTime === null) {
      expect(screen.getByText("신청 2건")).toBeTruthy();
      expect(screen.queryByText("2명")).toBeNull();
    }
  });
  it.each([true, false])("부분 참석 카드에 모든 원래 정보와 권한별 편집을 보존한다 (%s)", (canEdit) => {
    render(<PartialList rows={[{ id: "r1", campus: "합성 캠퍼스", name: "검증 학우", student_id: "26", partialPeriod: true,
      attend_from: "2026-10-08", attend_to: null, up_trip_id: 1, down_trip_id: null, up: { mode: "ktx", status: "confirmed", via: null },
      down: { mode: "own_car", status: "confirmed", via: null }, missing: false, note: "금요일 저녁 이동 · 메모 전체" }]} title="부분 참석" eventId="event-1" canEdit={canEdit} trips={[{ id: 1, label: "오전 출발" }]} startsOn="2026-10-07" endsOn="2026-10-09" />);
    for (const text of ["검증 학우", "합성 캠퍼스 · 26", "2026-10-08", "2026-10-09", "금요일 저녁 이동 · 메모 전체"]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText(/KTX·고속버스/)).toBeTruthy(); expect(screen.getByText(/자차·가족차/)).toBeTruthy();
    expect(screen.getByLabelText("검증 학우 참여 예정")).toBeTruthy(); expect(screen.getByLabelText("검증 학우 현장 실제 기록")).toBeTruthy();
    const link = screen.queryByRole("link", { name: "검증 학우 정보 수정" });
    if (canEdit) expect(link).toHaveAttribute("href", "/admin/e/event-1/registrations?edit=r1"); else expect(link).toBeNull();
  });

  it("외부 이동 목록은 방향·자리·대기·메모를 보존하고 확정 취소에서 쓰지 않는다", async () => {
    const rows: LegRow[] = [{ id: 1, registrationId: "r1", personName: "검증 학우", campusName: "합성 캠퍼스", direction: "up", mode: "other_district", status: "pending", viaUnitName: "합성 지구", note: "전체 메모", daysWaiting: 8, heldTripLabel: "오전 편", heldBusLabel: "1호차" }];
    render(<TransportPanel pending={rows} confirmedHolding={[]} otherRows={[]} canConfirm />);
    expect(screen.getByText("전체 메모")).toBeTruthy(); expect(screen.getByText(/오전 편 · 1호차/)).toBeTruthy(); expect(screen.getByText("확정 대기 8일")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "검증 학우 상행 이동수단 확정" })); });
    expect(screen.getByRole("dialog")).toHaveTextContent("1석을 반납");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "취소" })); });
    expect(confirmLegs).not.toHaveBeenCalled();
  });

  it("정산의 세 금액은 누적하지 않고 같은 길이 축에서 각각 표시한다", () => {
    const { container } = render(<SettlementOverview paid={200000} remitted={100000} received={50000} />);
    expect(screen.getByText("200,000원")).toBeTruthy(); expect(screen.getAllByText("100,000원")).toHaveLength(2);
    const bars = container.querySelectorAll('[aria-hidden="true"] > div');
    expect([...bars].map((bar) => bar.getAttribute("style"))).toEqual(["left: 0%; width: 100%;", "left: 0%; width: 50%;", "left: 0%; width: 25%;"]);
    expect(screen.getByText(/단위 원 · 0 ~ 200,000/)).toBeTruthy();
  });

  it("정산의 0과 음수는 정확한 값과 0 기준선을 보존한다", () => {
    const { container } = render(<SettlementOverview paid={0} remitted={-100} received={100} />);
    expect(screen.getByText("0원")).toBeTruthy(); expect(screen.getAllByText("-100원").length).toBeGreaterThan(0);
    expect(screen.getByText(/단위 원 · -100 ~ 100/)).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("업무 검색은 기존 메뉴를 필터하고 지우면 전체 기능과 현재 메뉴가 돌아온다", () => {
    render(<WorkspaceNav groups={[{ label: "참여", items: [{ label: "전체 명단", href: "/roster" }, { label: "부분 참석", href: "/partial" }] }, { label: "차량", items: [{ label: "출석 확인", href: "/attendance" }] }]} />);
    const menu = within(screen.getAllByRole("navigation", { name: "업무 메뉴" })[0]!);
    expect(menu.getAllByRole("link")).toHaveLength(3);
    fireEvent.change(menu.getByLabelText("업무 찾기"), { target: { value: "출석" } });
    expect(menu.getAllByRole("link")).toHaveLength(1); expect(menu.getByRole("link", { name: "출석 확인" })).toHaveAttribute("href", "/attendance");
    fireEvent.click(menu.getByRole("button", { name: "업무 검색 지우기" }));
    expect(menu.getAllByRole("link")).toHaveLength(3); expect(menu.getByRole("link", { name: "전체 명단" })).toHaveAttribute("aria-current", "page");
  });
});
