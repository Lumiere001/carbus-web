import { describe, expect, it } from "vitest";

/**
 * Vitest 환경 sanity 체크. 실제 로직 테스트는 validators·labels·csv·batch·sort에서.
 */
describe("sanity", () => {
  it("테스트 환경 동작", () => {
    expect(1 + 1).toBe(2);
  });

  it("@ alias import 동작", async () => {
    const mod = await import("@/lib/labels");
    expect(typeof mod.buildAttendancePresets).toBe("function");
  });
});
