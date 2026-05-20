import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_PRESETS,
  presetKeyOf,
  presetByKey,
} from "@/lib/labels";

/**
 * 참석/일정 5조합 preset — grid 셀 인라인 편집의 일관성 핵심.
 * 모든 preset이 SPEC §4.3 / DB CHECK(왕복·편도 일관성)를 만족해야 함.
 */
describe("ATTENDANCE_PRESETS 일관성", () => {
  it("정확히 5개 조합", () => {
    expect(ATTENDANCE_PRESETS).toHaveLength(5);
  });

  it("모든 preset이 왕복/편도 CHECK 일관성 만족", () => {
    for (const p of ATTENDANCE_PRESETS) {
      const roundtripOk =
        p.attendance_type === "roundtrip" &&
        p.departure_day !== null &&
        p.uses_return_bus === true;
      const onewayUp =
        p.attendance_type === "oneway" &&
        p.departure_day !== null &&
        p.uses_return_bus === false;
      const onewayDown =
        p.attendance_type === "oneway" &&
        p.departure_day === null &&
        p.uses_return_bus === true;
      expect(roundtripOk || onewayUp || onewayDown).toBe(true);
    }
  });

  it("preset key 고유", () => {
    const keys = ATTENDANCE_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("presetKeyOf / presetByKey 왕복(roundtrip)", () => {
  it("왕복 화 → rt_tue", () => {
    expect(
      presetKeyOf({ attendance_type: "roundtrip", departure_day: "TUE", uses_return_bus: true })
    ).toBe("rt_tue");
  });

  it("왕복 수 → rt_wed", () => {
    expect(
      presetKeyOf({ attendance_type: "roundtrip", departure_day: "WED", uses_return_bus: true })
    ).toBe("rt_wed");
  });

  it("편도 상행 화 → ow_up_tue", () => {
    expect(
      presetKeyOf({ attendance_type: "oneway", departure_day: "TUE", uses_return_bus: false })
    ).toBe("ow_up_tue");
  });

  it("편도 하행 → ow_down", () => {
    expect(
      presetKeyOf({ attendance_type: "oneway", departure_day: null, uses_return_bus: true })
    ).toBe("ow_down");
  });

  it("비정상 조합(왕복인데 하행 미이용) → null", () => {
    expect(
      presetKeyOf({ attendance_type: "roundtrip", departure_day: "TUE", uses_return_bus: false })
    ).toBeNull();
  });

  it("presetByKey 왕복복원 → 3필드 정확", () => {
    const p = presetByKey("rt_wed");
    expect(p).toMatchObject({
      attendance_type: "roundtrip",
      departure_day: "WED",
      uses_return_bus: true,
    });
  });

  it("presetByKey 편도하행 복원", () => {
    const p = presetByKey("ow_down");
    expect(p).toMatchObject({
      attendance_type: "oneway",
      departure_day: null,
      uses_return_bus: true,
    });
  });

  it("없는 key → undefined", () => {
    expect(presetByKey("nope")).toBeUndefined();
  });
});
