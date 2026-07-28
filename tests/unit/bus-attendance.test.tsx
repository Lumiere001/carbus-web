// @vitest-environment happy-dom
/**
 * 출석 화면(BusAttendance) — 호차 바로가기 스모크 테스트.
 *
 * 왜 필요한가 — fleet-panel 과 같은 이유다. 이 화면은 로그인 뒤에만 열리는데
 * 로컬 `auth.users` 가 비어 있어 브라우저로 확인할 수가 없다. 그래서 렌더 단계의
 * 런타임 오류와 **기능의 핵심 동작**을 여기서 잡는다.
 *
 * 검증 대상은 사용자 피드백 그 자체다:
 *   "호차가 많고 인원이 많은 경우 계속 밑으로 스크롤을 내렸어야 하는데 그게 불편했다.
 *    호차별 버튼이 있어서 거기로 바로바로 화면이 바뀌어서 볼 수 있었으면."
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { BusAttendance } from "@/components/campus/bus-attendance";

// Realtime 구독은 렌더만 볼 것이므로 최소 구현으로 막는다.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
    rpc: async () => ({ error: null }),
  }),
}));

const member = (id: string, name: string, on = false) => ({
  id,
  name,
  student_id: "26",
  checked_in: on,
  checked_out: on,
});

const BUSES = [
  { id: 1, name: "1호차", up_trip_id: 10 },
  { id: 2, name: "2호차", up_trip_id: 10 },
  { id: 3, name: "3호차", up_trip_id: 20 },
];
const SLOTS = [
  { id: 10, label: "화 오전 9시" },
  { id: 20, label: "화 오후 7시" },
];

// 1호차 2명(1명 체크) · 2호차 1명 · 3호차 1명
const UP: [number, ReturnType<typeof member>[]][] = [
  [1, [member("a", "가나", true), member("b", "나다")]],
  [2, [member("c", "다라")]],
  [3, [member("d", "라마")]],
];
const DOWN: [number, ReturnType<typeof member>[]][] = [
  [1, [member("a", "가나", true)]],
];

beforeEach(cleanup);

describe("BusAttendance 호차 바로가기", () => {
  it("호차가 여럿이면 바로가기 칩이 뜬다", () => {
    render(
      <BusAttendance upGroups={UP} downGroups={DOWN} buses={BUSES} slots={SLOTS} />
    );
    expect(screen.getByRole("button", { name: /전체/ })).toBeDefined();
    // 칩은 호차 이름 + 진행률을 함께 보여준다 — 어느 호차가 안 끝났는지가 목적이다.
    const chips = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    // 진행률은 **지금 보는 방향만** 센다. 기본은 상행이므로 1호차는 2명 중 1명.
    // (예전에는 상행 1 + 하행 1 을 더해 "2/3" 으로 보여줬는데, 같은 호차라도
    //  상·하행 멤버가 달라서 그 숫자가 무엇을 뜻하는지 알 수 없었다)
    expect(chips.some((t) => /1호차\s*1\/2/.test(t))).toBe(true);
    expect(chips.some((t) => /2호차\s*0\/1/.test(t))).toBe(true);
  });

  it("방향을 바꾸면 그 방향의 호차·진행률만 보여준다", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    // 하행은 배차가 독립이라 **같은 호차라도 멤버가 다르다.** 여기서는 1·2호차만
    // 하행을 뛰고, 1호차 하행 멤버는 상행과 아예 다른 사람이다.
    const DOWN2: [number, ReturnType<typeof member>[]][] = [
      [1, [member("d", "라마", true), member("e", "마바")]],
      [2, [member("c", "다라", true)]],
    ];
    render(
      <BusAttendance upGroups={UP} downGroups={DOWN2} buses={BUSES} slots={SLOTS} />
    );
    // 상행에는 1·2·3호차가 있다
    expect(
      screen.getAllByRole("button").some((b) => /^2호차/.test(b.textContent ?? ""))
    ).toBe(true);

    // 상행 3호차가 있는지 먼저 확인
    expect(
      screen.getAllByRole("button").some((b) => /^3호차/.test(b.textContent ?? ""))
    ).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /하행/ }));

    const chips = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    // 하행을 안 뛰는 3호차는 칩에서 사라진다
    expect(chips.some((t) => /^3호차/.test(t))).toBe(false);
    // 하행 1호차 진행률은 **하행 멤버 기준** 2명 중 1명 — 상행(1/2)과 값이 겹치지
    // 않도록 데이터를 잡았다. 예전처럼 두 방향을 더하면 이 숫자가 안 나온다.
    expect(chips.some((t) => /1호차\s*1\/2/.test(t))).toBe(true);
    expect(chips.some((t) => /2호차\s*1\/1/.test(t))).toBe(true);
  });

  it("호차를 고르면 그 호차 명단만 남는다", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(
      <BusAttendance upGroups={UP} downGroups={DOWN} buses={BUSES} slots={SLOTS} />
    );
    // 고르기 전에는 다른 호차 인원도 보인다.
    expect(screen.queryByText("다라")).not.toBeNull();

    const chip = screen
      .getAllByRole("button")
      .find((b) => /^1호차/.test(b.textContent ?? ""))!;
    await userEvent.click(chip);

    // 방향을 하나만 보므로 "가나"도 한 번만 나온다. 예전에는 상·하행 섹션이 함께
    // 그려져 같은 사람이 두 번 보였다.
    expect(screen.getAllByText("가나")).toHaveLength(1);
    expect(screen.queryByText("다라")).toBeNull(); // 2호차 인원은 사라진다
    expect(screen.queryByText("라마")).toBeNull(); // 3호차도
  });

  it("호차가 하나뿐이면 칩을 띄우지 않는다 — 임역원 화면이 대개 그렇다", () => {
    render(
      <BusAttendance
        upGroups={[UP[0]]}
        downGroups={[]}
        buses={BUSES}
        slots={SLOTS}
      />
    );
    expect(screen.queryByRole("button", { name: /^전체$/ })).toBeNull();
  });

  it("배정 인원이 없는 호차를 골라도 깨지지 않는다", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    // 하행에만 있는 호차를 상행 그룹에서 빼면, 상행 섹션이 빈 채로 남는다.
    render(
      <BusAttendance
        upGroups={[UP[0], UP[1]]}
        downGroups={DOWN}
        buses={BUSES}
        slots={SLOTS}
      />
    );
    const chip = screen
      .getAllByRole("button")
      .find((b) => /^2호차/.test(b.textContent ?? ""))!;
    await userEvent.click(chip);
    expect(screen.queryByText("다라")).not.toBeNull();
  });
});
