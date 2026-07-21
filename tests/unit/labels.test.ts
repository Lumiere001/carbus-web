import { describe, expect, it } from "vitest";
import {
  buildAttendancePresets,
  presetKeyOf,
  presetByKey,
  tripOptions,
  deriveAttendance,
  attendanceSummary,
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
  it("슬롯 2개 → 2×2 + 편도하행 1 + 미이용 1 = 6개", () => {
    expect(PRESETS).toHaveLength(6);
  });

  it("비활성 슬롯은 제외", () => {
    const presets = buildAttendancePresets([
      ...SLOTS,
      { id: 3, key: "wed_am", label: "수 오전", active: false, display_order: 30 },
    ]);
    expect(presets).toHaveLength(6); // 비활성 wed_am 무시 (2×2 + 하행 + 미이용)
  });

  it("모든 preset이 왕복/편도/미이용 CHECK 일관성 만족", () => {
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
      const selfOk =
        p.attendance_type === "self" &&
        p.departure_slot_id === null &&
        p.uses_return_bus === false;
      expect(roundtripOk || onewayUp || onewayDown || selfOk).toBe(true);
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

  it("미이용 → self", () => {
    expect(
      presetKeyOf(
        { attendance_type: "self", departure_slot_id: null, uses_return_bus: false },
        PRESETS
      )
    ).toBe("self");
  });

  it("presetByKey 미이용 복원", () => {
    const p = presetByKey("self", PRESETS);
    expect(p).toMatchObject({
      attendance_type: "self",
      departure_slot_id: null,
      uses_return_bus: false,
      label: "참석 (버스 미이용)",
    });
  });

  it("없는 key → undefined", () => {
    expect(presetByKey("nope", PRESETS)).toBeUndefined();
  });
});

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
