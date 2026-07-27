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

/** 차량에 배정된 사람들이 신청한 상행 편 — DB 가드와 같은 술어로 잠금을 계산한다. */
const UP_REQ: Record<number, number[]> = { 1: [1], 2: [1], 3: [] };
/** 하행도 같다 — 3-C 로 신청이 하행 편을 갖게 되면서 가드가 대칭이 됐다. */
const DOWN_REQ: Record<number, number[]> = { 1: [90], 2: [90], 3: [] };

beforeEach(cleanup);

describe("FleetPanel", () => {
  it("상·하행 두 방향이 같은 구조로 렌더된다", () => {
    render(<FleetPanel trips={TRIPS} buses={BUSES} loads={LOADS} upRequests={UP_REQ} downRequests={DOWN_REQ} />);
    expect(screen.getByText("상행 (가는 편)")).toBeDefined();
    expect(screen.getByText("하행 (오는 편)")).toBeDefined();
    // 하행이 한 편뿐이어도 상행과 같은 섹션 구조를 갖는다(범용 틀의 핵심).
    // "귀가" 는 운행편 목록과 차량 행의 하행 편 칸 양쪽에 나오므로 getAllByText 로 센다.
    expect(screen.getAllByText("귀가").length).toBeGreaterThan(0);
    // 두 방향 모두 "추가" 폼을 갖는다 — 하행도 편을 더 만들 수 있다는 뜻.
    expect(screen.getAllByRole("button", { name: "추가" })).toHaveLength(3); // 상행·하행·차량
  });

  it("운행편별 차량 대수를 방향에 맞게 센다", () => {
    render(<FleetPanel trips={TRIPS} buses={BUSES} loads={LOADS} upRequests={UP_REQ} downRequests={DOWN_REQ} />);
    // 상행 1편: 1·2호차 = 2대 / 상행 2편: 3호차 = 1대 / 하행: 3대 전부
    expect(screen.getByText("차량 2대")).toBeDefined();
    expect(screen.getByText("차량 1대")).toBeDefined();
    expect(screen.getByText("차량 3대")).toBeDefined();
  });

  it("배차 특례가 배지로 드러난다", () => {
    render(<FleetPanel trips={TRIPS} buses={BUSES} loads={LOADS} upRequests={UP_REQ} downRequests={DOWN_REQ} />);
    expect(screen.getByText("응집 면제")).toBeDefined();
    expect(screen.getByText("후순위")).toBeDefined();
  });

  it("배정 인원이 있는 차량은 삭제 버튼이 잠긴다", () => {
    render(<FleetPanel trips={TRIPS} buses={BUSES} loads={LOADS} upRequests={UP_REQ} downRequests={DOWN_REQ} />);
    const del = screen.getAllByRole("button", { name: "삭제" });
    // 차량 3대 중 1·2호차는 배정 있음 → 비활성, 3호차는 0명 → 활성.
    // (운행편 삭제 버튼도 같은 이름이라 차량 쪽만 세지 않고 잠긴 개수로 본다)
    const disabled = del.filter((b) => (b as HTMLButtonElement).disabled);
    expect(disabled.length).toBe(2);
  });

  it("잠금이 DB 가드와 같은 술어다 — 어긋나는 편만, 선택지 단위로", async () => {
    // DB 가드는 "바꾼 뒤 신청 편과 어긋나는 배정이 생기는가"를 본다.
    // 화면이 더 엄격하면(select 통째 잠금) 고칠 방법이 화면에 없는 막다른 길이 되고,
    // 더 느슨하면 저장 눌렀을 때 서버가 거부해 "왜 안 되지"가 된다.
    const { default: userEvent } = await import("@testing-library/user-event");
    // 1호차: 상행 33명 배정, 전원 1편 신청 → 1편은 유지 가능, 2편은 어긋남.
    render(
      <FleetPanel trips={TRIPS} buses={[BUSES[0]]} loads={{ 1: { up: 33, down: 23 } }} upRequests={{ 1: [1] }} downRequests={{ 1: [90] }} />
    );
    const edits = screen.getAllByRole("button", { name: "수정" });
    await userEvent.click(edits[edits.length - 1]);

    const opt = (re: RegExp) =>
      screen.getAllByRole("option").find((o) => re.test(o.textContent ?? "")) as HTMLOptionElement;

    // 현재 편(1편)은 고를 수 있어야 한다 — 아니면 저장 자체가 불가능해진다.
    expect(opt(/화 오전 9시/).disabled).toBe(false);
    // 다른 상행 편(2편)은 어긋나므로 잠긴다.
    expect(opt(/화 오후 7시/).disabled).toBe(true);
    // 하행도 같은 규칙이다. 지금 편(귀가)은 배정된 전원이 신청한 편이라 열려 있다.
    expect(opt(/귀가/).disabled).toBe(false);
  });

  it("하행도 상행과 같은 규칙으로 잠긴다 — 3-C 이후 DB 가드가 대칭이다", async () => {
    // 예전엔 하행 select 에 잠금이 아예 없었다. 그때는 신청에 하행 편이 없어
    // 어긋날 대상 자체가 없었기 때문인데, 3-C 이후엔 DB 가 막는데 화면만 열려 있어
    // "고를 수는 있는데 저장하면 거부되는" 상태가 됐다.
    const twoDown = [
      ...TRIPS,
      trip({ id: 91, label: "귀가 오후", direction: "down", display_order: 110 }),
    ];
    render(
      <FleetPanel
        trips={twoDown}
        buses={[BUSES[0]]}
        loads={{ 1: { up: 33, down: 23 } }}
        upRequests={{ 1: [1] }}
        downRequests={{ 1: [90] }}
      />
    );
    const { default: userEvent } = await import("@testing-library/user-event");
    const edits = screen.getAllByRole("button", { name: "수정" });
    await userEvent.click(edits[edits.length - 1]);
    const opt = (re: RegExp) =>
      screen.getAllByRole("option").find((o) => re.test(o.textContent ?? "")) as HTMLOptionElement;
    // 배정된 23명이 신청한 편(귀가)은 유지 가능, 다른 하행 편은 어긋나므로 잠긴다.
    expect(opt(/^귀가$/).disabled).toBe(false);
    expect(opt(/귀가 오후/).disabled).toBe(true);
  });

  it("배정이 없으면 상행 편을 자유롭게 고를 수 있다", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(
      <FleetPanel trips={TRIPS} buses={[BUSES[2]]} loads={{ 3: { up: 0, down: 0 } }} upRequests={{ 3: [] }} downRequests={{ 3: [] }} />
    );
    const edits = screen.getAllByRole("button", { name: "수정" });
    await userEvent.click(edits[edits.length - 1]);
    const disabledOpts = screen
      .getAllByRole("option")
      .filter((o) => (o as HTMLOptionElement).disabled);
    expect(disabledOpts).toHaveLength(0);
  });

  it("활성 운행편이 없으면 차량 추가가 잠긴다", () => {
    // 비활성 편에 차량을 붙이면 /admin/buses 에서 그 차량과 승객이 통째로 사라진다.
    const inactive = TRIPS.map((t) => ({ ...t, active: false }));
    render(<FleetPanel trips={inactive} buses={[]} loads={{}} upRequests={{}} downRequests={{}} />);
    const add = screen.getAllByRole("button", { name: "추가" });
    expect((add[add.length - 1] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/활성 운행편이 없습니다/)).toBeDefined();
  });

  it("운행편이 없는 방향도 깨지지 않는다", () => {
    // 새 행사를 빈 상태로 시작하면 실제로 이 상태가 된다.
    render(<FleetPanel trips={[]} buses={[]} loads={{}} upRequests={{}} downRequests={{}} />);
    expect(screen.getAllByText("아직 운행편이 없습니다.")).toHaveLength(2);
  });

  it("운행편을 아직 안 정한 차량(NULL)도 렌더된다", () => {
    // up_trip_id / down_trip_id 가 nullable 이 되면서 생긴 상태 —
    // "하행만 운행하는 차량" 같은 편성이 가능해야 범용이다.
    const orphan = [bus({ id: 9, name: "9호차", up_trip_id: null, down_trip_id: null })];
    render(<FleetPanel trips={TRIPS} buses={orphan} loads={{ 9: { up: 0, down: 0 } }} upRequests={{ 9: [] }} downRequests={{ 9: [] }} />);
    expect(screen.getByText("9호차")).toBeDefined();
    expect(screen.getAllByText("—")).toHaveLength(2); // 상행·하행 둘 다 미지정
  });
});
