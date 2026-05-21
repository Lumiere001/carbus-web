import { describe, expect, it } from "vitest";
import {
  buildAttendancePresets,
  presetKeyOf,
  presetByKey,
} from "@/lib/labels";

/**
 * 참석/일정 preset — grid 셀 인라인 편집의 일관성 핵심.
 * 슬롯이 데이터라 preset 도 동적: active 슬롯마다 {왕복·편도상행} + 공통 {편도하행}.
 * 모든 preset이 SPEC §4.3 / DB CHECK(왕복·편도 일관성)를 만족해야 함.
 */
const SLOTS = [
  { id: 1, key: "tue_am", label: "화 오전 9시", active: true, display_order: 10 },
  { id: 2, key: "tue_pm", label: "화 오후 7시", active: true, display_order: 20 },
];
const PRESETS = buildAttendancePresets(SLOTS);

describe("buildAttendancePresets 일관성", () => {
  it("슬롯 2개 → 2×2 + 편도하행 1 = 5개", () => {
    expect(PRESETS).toHaveLength(5);
  });

  it("비활성 슬롯은 제외", () => {
    const presets = buildAttendancePresets([
      ...SLOTS,
      { id: 3, key: "wed_am", label: "수 오전", active: false, display_order: 30 },
    ]);
    expect(presets).toHaveLength(5); // 비활성 wed_am 무시
  });

  it("모든 preset이 왕복/편도 CHECK 일관성 만족", () => {
    for (const p of PRESETS) {
      const roundtripOk =
        p.attendance_type === "roundtrip" &&
        p.departure_slot_id !== null &&
        p.uses_return_bus === true;
      const onewayUp =
        p.attendance_type === "oneway" &&
        p.departure_slot_id !== null &&
        p.uses_return_bus === false;
      const onewayDown =
        p.attendance_type === "oneway" &&
        p.departure_slot_id === null &&
        p.uses_return_bus === true;
      expect(roundtripOk || onewayUp || onewayDown).toBe(true);
    }
  });

  it("preset key 고유", () => {
    const keys = PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("presetKeyOf / presetByKey", () => {
  it("왕복 slot1 → rt_tue_am", () => {
    expect(
      presetKeyOf(
        { attendance_type: "roundtrip", departure_slot_id: 1, uses_return_bus: true },
        PRESETS
      )
    ).toBe("rt_tue_am");
  });

  it("왕복 slot2 → rt_tue_pm", () => {
    expect(
      presetKeyOf(
        { attendance_type: "roundtrip", departure_slot_id: 2, uses_return_bus: true },
        PRESETS
      )
    ).toBe("rt_tue_pm");
  });

  it("편도 상행 slot1 → ow_up_tue_am", () => {
    expect(
      presetKeyOf(
        { attendance_type: "oneway", departure_slot_id: 1, uses_return_bus: false },
        PRESETS
      )
    ).toBe("ow_up_tue_am");
  });

  it("편도 하행 → ow_down", () => {
    expect(
      presetKeyOf(
        { attendance_type: "oneway", departure_slot_id: null, uses_return_bus: true },
        PRESETS
      )
    ).toBe("ow_down");
  });

  it("비정상 조합(왕복인데 하행 미이용) → null", () => {
    expect(
      presetKeyOf(
        { attendance_type: "roundtrip", departure_slot_id: 1, uses_return_bus: false },
        PRESETS
      )
    ).toBeNull();
  });

  it("presetByKey 왕복복원 → 3필드 정확", () => {
    const p = presetByKey("rt_tue_pm", PRESETS);
    expect(p).toMatchObject({
      attendance_type: "roundtrip",
      departure_slot_id: 2,
      uses_return_bus: true,
    });
  });

  it("presetByKey 편도하행 복원", () => {
    const p = presetByKey("ow_down", PRESETS);
    expect(p).toMatchObject({
      attendance_type: "oneway",
      departure_slot_id: null,
      uses_return_bus: true,
    });
  });

  it("없는 key → undefined", () => {
    expect(presetByKey("nope", PRESETS)).toBeUndefined();
  });
});
