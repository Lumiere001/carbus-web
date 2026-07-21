// @vitest-environment happy-dom
/**
 * 편성 화면(FleetPanel) 스모크 테스트.
 *
 * 왜 필요한가 — 이 화면은 로컬에서 **브라우저로 열어볼 수가 없다.**
 * 운영 백업이 `auth` 스키마를 담지 않아 로컬 `auth.users` 가 비어 있고,
 * /admin/* 은 로그인 없이는 리다이렉트된다. 계정을 만들지 않는 한 확인이 불가능하다.
 * 그래서 렌더 단계의 런타임 오류(훅 오용·undefined 접근·잘못된 prop)는
 * 여기서 잡는다. tsc 는 타입만 보고, 배차 테스트는 순수 함수만 본다.
 *
 * DB 규칙(삭제 가드·방향 검사·권한)은 여기서 검증하지 않는다 —
 * 그건 psql 로 실제 트리거를 때려서 확인했고, 화면 검사는 어차피 우회 가능하다.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FleetPanel, type BusLoad } from "@/components/admin/fleet-panel";
import type { TripRow } from "@/lib/admin/trips";
import type { BusRow } from "@/lib/admin/buses";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
// 클라이언트 모듈은 Supabase 브라우저 클라이언트를 만든다 — 렌더만 볼 것이므로 막는다.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const trip = (o: Partial<TripRow> & Pick<TripRow, "id" | "label" | "direction">) =>
  ({
    key: `k${o.id}`,
    display_order: 10,
    active: true,
    created_at: "2026-07-01T00:00:00Z",
    event_id: "e1",
    departs_at: null,
    origin: null,
    destination: null,
    ...o,
  }) as TripRow;

const bus = (o: Partial<BusRow> & Pick<BusRow, "id" | "name">) =>
  ({
    capacity: 44,
    hard_cap: 45,
    up_trip_id: 1,
    down_trip_id: 90,
    display_order: o.id,
    event_id: "e1",
    driver_registration_id: null,
    fixed_passenger_ids: [],
    down_driver_registration_id: null,
    down_fixed_passenger_ids: [],
    is_cohesion_exempt: false,
    fill_priority: 0,
    ...o,
  }) as BusRow;

const TRIPS: TripRow[] = [
  trip({ id: 1, label: "화 오전 9시", direction: "up" }),
  trip({ id: 2, label: "화 오후 7시", direction: "up", display_order: 20 }),
  trip({ id: 90, label: "귀가", direction: "down", display_order: 100 }),
];

const BUSES: BusRow[] = [
  bus({ id: 1, name: "1호차", is_cohesion_exempt: true, fill_priority: 1 }),
  bus({ id: 2, name: "2호차" }),
  bus({ id: 3, name: "3호차", up_trip_id: 2 }),
];

const LOADS: Record<number, BusLoad> = {
  1: { up: 33, down: 23 },
  2: { up: 44, down: 44 },
  3: { up: 0, down: 0 },
};

beforeEach(cleanup);

describe("FleetPanel", () => {
  it("상·하행 두 방향이 같은 구조로 렌더된다", () => {
    render(<FleetPanel trips={TRIPS} buses={BUSES} loads={LOADS} />);
    expect(screen.getByText("상행 (가는 편)")).toBeDefined();
    expect(screen.getByText("하행 (오는 편)")).toBeDefined();
    // 하행이 한 편뿐이어도 상행과 같은 섹션 구조를 갖는다(범용 틀의 핵심).
    // "귀가" 는 운행편 목록과 차량 행의 하행 편 칸 양쪽에 나오므로 getAllByText 로 센다.
    expect(screen.getAllByText("귀가").length).toBeGreaterThan(0);
    // 두 방향 모두 "추가" 폼을 갖는다 — 하행도 편을 더 만들 수 있다는 뜻.
    expect(screen.getAllByRole("button", { name: "추가" })).toHaveLength(3); // 상행·하행·차량
  });

  it("운행편별 차량 대수를 방향에 맞게 센다", () => {
    render(<FleetPanel trips={TRIPS} buses={BUSES} loads={LOADS} />);
    // 상행 1편: 1·2호차 = 2대 / 상행 2편: 3호차 = 1대 / 하행: 3대 전부
    expect(screen.getByText("차량 2대")).toBeDefined();
    expect(screen.getByText("차량 1대")).toBeDefined();
    expect(screen.getByText("차량 3대")).toBeDefined();
  });

  it("배차 특례가 배지로 드러난다", () => {
    render(<FleetPanel trips={TRIPS} buses={BUSES} loads={LOADS} />);
    expect(screen.getByText("응집 면제")).toBeDefined();
    expect(screen.getByText("후순위")).toBeDefined();
  });

  it("배정 인원이 있는 차량은 삭제 버튼이 잠긴다", () => {
    render(<FleetPanel trips={TRIPS} buses={BUSES} loads={LOADS} />);
    const del = screen.getAllByRole("button", { name: "삭제" });
    // 차량 3대 중 1·2호차는 배정 있음 → 비활성, 3호차는 0명 → 활성.
    // (운행편 삭제 버튼도 같은 이름이라 차량 쪽만 세지 않고 잠긴 개수로 본다)
    const disabled = del.filter((b) => (b as HTMLButtonElement).disabled);
    expect(disabled.length).toBe(2);
  });

  it("배정 인원이 있으면 운행편 선택이 잠긴다 (DB 가드와 같은 규칙)", async () => {
    // DB 트리거가 이 변경을 거부한다. 화면만 열어두면 저장 눌렀을 때 서버가 거부해
    // "왜 안 되지"가 된다 — 두 규칙이 어긋나지 않게 여기서 고정한다.
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<FleetPanel trips={TRIPS} buses={[BUSES[0]]} loads={{ 1: { up: 33, down: 23 } }} />);
    // 운행편 행에도 "수정" 이 있다. 차량 섹션은 마지막에 렌더되므로 마지막 것을 집는다.
    const edits = screen.getAllByRole("button", { name: "수정" });
    await userEvent.click(edits[edits.length - 1]);

    const selects = screen.getAllByRole("combobox");
    expect(selects.every((s) => (s as HTMLSelectElement).disabled)).toBe(true);
    expect(screen.getByText(/배정된 인원이 있어 운행편은 바꿀 수 없습니다/)).toBeDefined();
  });

  it("배정이 없으면 운행편을 바꿀 수 있다", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<FleetPanel trips={TRIPS} buses={[BUSES[2]]} loads={{ 3: { up: 0, down: 0 } }} />);
    const edits = screen.getAllByRole("button", { name: "수정" });
    await userEvent.click(edits[edits.length - 1]);

    const selects = screen.getAllByRole("combobox");
    expect(selects.some((s) => !(s as HTMLSelectElement).disabled)).toBe(true);
  });

  it("운행편이 없는 방향도 깨지지 않는다", () => {
    // 새 행사를 빈 상태로 시작하면 실제로 이 상태가 된다.
    render(<FleetPanel trips={[]} buses={[]} loads={{}} />);
    expect(screen.getAllByText("아직 운행편이 없습니다.")).toHaveLength(2);
  });

  it("운행편을 아직 안 정한 차량(NULL)도 렌더된다", () => {
    // up_trip_id / down_trip_id 가 nullable 이 되면서 생긴 상태 —
    // "하행만 운행하는 차량" 같은 편성이 가능해야 범용이다.
    const orphan = [bus({ id: 9, name: "9호차", up_trip_id: null, down_trip_id: null })];
    render(<FleetPanel trips={TRIPS} buses={orphan} loads={{ 9: { up: 0, down: 0 } }} />);
    expect(screen.getByText("9호차")).toBeDefined();
    expect(screen.getAllByText("—")).toHaveLength(2); // 상행·하행 둘 다 미지정
  });
});
