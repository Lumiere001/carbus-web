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
    expect(chips.some((t) => /1호차\s*2\/3/.test(t))).toBe(true); // 상행1 + 하행1 체크
    expect(chips.some((t) => /2호차\s*0\/1/.test(t))).toBe(true);
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

    // "가나"는 1호차 상행·하행 양쪽에 있으므로 2개 — 같은 호차의 두 섹션이 맞다.
    expect(screen.getAllByText("가나")).toHaveLength(2);
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
