import { describe, expect, it } from "vitest";
import { tripOptions, deriveAttendance, attendanceSummary } from "@/lib/labels";

/**
 * 참석/일정 선택 — 상행 편·하행 편 두 개의 독립 선택 (Phase 3-C).
 * 이전 preset(조합 셀) 모델과 그 테스트는 화면이 안 쓰게 되면서 함께 지웠다.
 * 안 쓰이는 코드를 테스트가 초록으로 지켜주면 다음 사람이 살아 있는 모델로 착각한다.
 */

// ── 운행편 선택 (Phase 3-C) ────────────────────────────────────

describe("tripOptions", () => {
  const trips = [
    { id: 1, label: "화 오전 9시", direction: "up" as const, active: true, display_order: 10 },
    { id: 2, label: "화 오후 7시", direction: "up" as const, active: false, display_order: 20 },
    { id: 9, label: "귀가", direction: "down" as const, active: true, display_order: 100 },
  ];

  it("맨 앞에 '이용 안 함'이 온다 — 한 방향만 타는 신청이 가능해야 한다", () => {
    const opts = tripOptions(trips, "up");
    expect(opts[0]).toEqual({ id: null, label: "이용 안 함", active: true });
  });

  it("비활성 편은 기본적으로 숨긴다", () => {
    expect(tripOptions(trips, "up").map((o) => o.id)).toEqual([null, 1]);
  });

  it("현재 값이 비활성 편이면 목록에 남긴다", () => {
    // 남기지 않으면 그 행을 편집할 때 값이 사라져 다른 편으로 조용히 덮어써진다.
    const opts = tripOptions(trips, "up", 2);
    expect(opts.map((o) => o.id)).toEqual([null, 1, 2]);
    expect(opts.find((o) => o.id === 2)?.label).toContain("비활성");
  });

  it("방향별로 갈라 준다 — 하행도 상행과 같은 모양", () => {
    expect(tripOptions(trips, "down").map((o) => o.id)).toEqual([null, 9]);
  });
});

describe("deriveAttendance — DB derive_attendance() 와 같은 규칙", () => {
  it("둘 다 있으면 왕복", () => expect(deriveAttendance(1, 9)).toBe("roundtrip"));
  it("상행만 있으면 편도", () => expect(deriveAttendance(1, null)).toBe("oneway"));
  it("하행만 있으면 편도", () => expect(deriveAttendance(null, 9)).toBe("oneway"));
  it("둘 다 없으면 미이용", () => expect(deriveAttendance(null, null)).toBe("self"));
});

describe("attendanceSummary", () => {
  const trips = [
    { id: 1, label: "화 오전 9시" },
    { id: 9, label: "귀가" },
  ];
  it("왕복은 두 편을 다 보여준다", () =>
    expect(attendanceSummary(1, 9, trips)).toBe("왕복 (화 오전 9시 / 귀가)"));
  it("편도 상행", () =>
    expect(attendanceSummary(1, null, trips)).toBe("편도 상행 (화 오전 9시)"));
  it("편도 하행", () =>
    expect(attendanceSummary(null, 9, trips)).toBe("편도 하행 (귀가)"));
  it("미이용", () => expect(attendanceSummary(null, null, trips)).toBe("버스 미이용"));
});
