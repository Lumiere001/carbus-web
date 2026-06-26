import { describe, expect, it } from "vitest";
import { lockExistingDownAssignments, type DownLockReg } from "@/lib/batch/locks";
import { runBatch } from "@/lib/batch/engine";
import type { Bus } from "@/lib/batch/types";

function bus(overrides: Partial<Bus> = {}): Bus {
  return {
    id: 1,
    name: "1호차",
    capacity: 44,
    hard_cap: 45,
    departure_slot_id: 1,
    driver_registration_id: null,
    fixed_passenger_ids: [],
    down_driver_registration_id: null,
    down_fixed_passenger_ids: [],
    ...overrides,
  };
}
function reg(o: Partial<DownLockReg> & { id: string }): DownLockReg {
  return { uses_return_bus: true, assigned_down_bus_id: null, ...o };
}

describe("lockExistingDownAssignments (하행 수동 배정 보존)", () => {
  it("미배정(null)만 있으면 잠금 없음 — 원본 그대로", () => {
    const buses = [bus({ id: 1 }), bus({ id: 2 })];
    const out = lockExistingDownAssignments(buses, [
      reg({ id: "a" }),
      reg({ id: "b" }),
    ]);
    expect(out).toBe(buses); // 변경 없으면 같은 참조 반환
  });

  it("배정된 사람을 해당 호차 down_fixed 로 잠금", () => {
    const buses = [bus({ id: 1 }), bus({ id: 2 })];
    const out = lockExistingDownAssignments(buses, [
      reg({ id: "a", assigned_down_bus_id: 2 }),
      reg({ id: "b", assigned_down_bus_id: 2 }),
      reg({ id: "c", assigned_down_bus_id: 1 }),
    ]);
    expect(out.find((b) => b.id === 2)!.down_fixed_passenger_ids).toEqual(["a", "b"]);
    expect(out.find((b) => b.id === 1)!.down_fixed_passenger_ids).toEqual(["c"]);
  });

  it("하행 미이용자(uses_return_bus=false)는 잠그지 않음", () => {
    const buses = [bus({ id: 1 })];
    const out = lockExistingDownAssignments(buses, [
      reg({ id: "a", uses_return_bus: false, assigned_down_bus_id: 1 }),
    ]);
    expect(out[0].down_fixed_passenger_ids).toEqual([]);
  });

  it("이미 down 리더(차량순장/고정)면 중복 잠금하지 않음", () => {
    const buses = [
      bus({ id: 1, down_driver_registration_id: "drv" }),
      bus({ id: 2, down_fixed_passenger_ids: ["fix"] }),
    ];
    const out = lockExistingDownAssignments(buses, [
      reg({ id: "drv", assigned_down_bus_id: 1 }),
      reg({ id: "fix", assigned_down_bus_id: 2 }),
    ]);
    // drv 는 down_fixed 에 안 들어감(이미 차량순장), fix 도 중복 추가 없음
    expect(out[0].down_fixed_passenger_ids).toEqual([]);
    expect(out[1].down_fixed_passenger_ids).toEqual(["fix"]);
  });

  it("사라진 호차를 가리키는 배정은 조용히 버림", () => {
    const buses = [bus({ id: 1 })];
    const out = lockExistingDownAssignments(buses, [
      reg({ id: "a", assigned_down_bus_id: 99 }),
    ]);
    expect(out).toBe(buses);
  });

  it("입력 buses 를 변형하지 않음(순수)", () => {
    const buses = [bus({ id: 1 })];
    const out = lockExistingDownAssignments(buses, [
      reg({ id: "a", assigned_down_bus_id: 1 }),
    ]);
    expect(buses[0].down_fixed_passenger_ids).toEqual([]); // 원본 불변
    expect(out[0].down_fixed_passenger_ids).toEqual(["a"]);
  });

  it("엔진 연동: 잠근 사람은 그 호차 유지, 미배정만 채워짐", () => {
    // a 는 이미 2호차로 수동 배정 → 보존돼야 함. b·c 는 미배정 → 자동 배차.
    const buses = [bus({ id: 1 }), bus({ id: 2 })];
    const regs = [
      { id: "a", name: "a", campus: "전남대", attendance_type: "oneway" as const, departure_slot_id: null, uses_return_bus: true, fixed_up_bus_id: null },
      { id: "b", name: "b", campus: "전남대", attendance_type: "oneway" as const, departure_slot_id: null, uses_return_bus: true, fixed_up_bus_id: null },
      { id: "c", name: "c", campus: "전남대", attendance_type: "oneway" as const, departure_slot_id: null, uses_return_bus: true, fixed_up_bus_id: null },
    ];
    const locked = lockExistingDownAssignments(buses, [
      reg({ id: "a", assigned_down_bus_id: 2 }),
      reg({ id: "b" }),
      reg({ id: "c" }),
    ]);
    const r = runBatch(regs, locked, "down");
    expect(r.errors).toEqual([]);
    expect(r.down_assignments["a"]).toBe(2); // 보존
    expect(r.down_assignments["b"]).toBeDefined();
    expect(r.down_assignments["c"]).toBeDefined();
  });
});
