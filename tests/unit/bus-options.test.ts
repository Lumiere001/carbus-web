import { describe, expect, it } from "vitest";
import { busSelectOptions, type BusOption } from "@/lib/admin/bus-options";

// 운영 형상(2026 여름수련회) 기준.
// 상행 3편: 1=화 오전 9시(9대) · 2=화 오후 7시(1대) · 3=수 오후 7시(1대)
// 하행 1편: 4=귀가(전 차량 11대)
const AM = 1, PM = 2, WED = 3, HOME = 4;
// 하행이 여러 편으로 나뉜 미래 형상(3-C 의 존재 이유) 검증용.
const HOME2 = 5;

function bus(o: Partial<BusOption> & { id: number }): BusOption {
  return {
    name: `${o.id}호차`,
    up_trip_id: AM,
    down_trip_id: HOME,
    capacity: 44,
    // 기본은 일반 버스. 간사 차량은 그 테스트에서 명시적으로 넘긴다 (§26-E).
    kind: "bus",
    ...o,
  };
}

/** 화 오전 3대 + 화 오후 1대 + 수 오후 1대. 전 차량이 같은 하행 편(HOME)을 운행. */
const BUSES: BusOption[] = [
  bus({ id: 1 }), bus({ id: 2 }), bus({ id: 3 }),
  bus({ id: 10, up_trip_id: PM }),
  bus({ id: 11, up_trip_id: WED }),
];
const NONE = new Map<number, number>();

describe("busSelectOptions — 서버가 허용하는 선택지와 일치", () => {
  it("상행: 학우가 신청한 편과 같은 호차만 노출", () => {
    const o = busSelectOptions(BUSES, "up", AM, null, NONE);
    expect(o.map((b) => b.id)).toEqual([1, 2, 3]);
  });

  it("상행: 화 오후 학우는 해당 편 1대만", () => {
    const o = busSelectOptions(BUSES, "up", PM, null, NONE);
    expect(o.map((b) => b.id)).toEqual([10]);
  });

  it("상행: 상행 미이용(편 null)은 옵션 0개 — 서버의 '상행 대상 아님'과 동일", () => {
    const o = busSelectOptions(BUSES, "up", null, null, NONE);
    expect(o).toEqual([]);
  });

  it("하행: 전 차량이 같은 편을 운행하면 전 호차 노출 (운영 현재 형상)", () => {
    // 실운영 459건 전부 reg.down_trip_id = bus.down_trip_id 로 확인됨.
    // 상행 편이 서로 달라도 하행 편이 같으면 막히지 않는다.
    const o = busSelectOptions(BUSES, "down", HOME, null, NONE);
    expect(o.map((b) => b.id)).toEqual([1, 2, 3, 10, 11]);
  });

  it("하행: 하행 미이용(편 null)은 옵션 0개 — 서버의 '하행 대상 아님'과 동일", () => {
    const o = busSelectOptions(BUSES, "down", null, null, NONE);
    expect(o).toEqual([]);
  });

  it("하행이 두 편으로 나뉘면 신청한 편의 호차만 (3-C 의 존재 이유)", () => {
    const split: BusOption[] = [
      bus({ id: 1, down_trip_id: HOME }),
      bus({ id: 2, down_trip_id: HOME2 }),
      bus({ id: 3, down_trip_id: HOME2 }),
    ];
    expect(busSelectOptions(split, "down", HOME, null, NONE).map((b) => b.id)).toEqual([1]);
    expect(busSelectOptions(split, "down", HOME2, null, NONE).map((b) => b.id)).toEqual([2, 3]);
  });

  it("그 방향을 운행하지 않는 호차는 제외 — 서버의 'N호차는 하행을 운행하지 않습니다'와 동일", () => {
    const mixed: BusOption[] = [
      bus({ id: 1 }),
      bus({ id: 2, down_trip_id: null }), // 하행 미운행
    ];
    expect(busSelectOptions(mixed, "down", HOME, null, NONE).map((b) => b.id)).toEqual([1]);
    // 상행도 대칭
    const mixedUp: BusOption[] = [bus({ id: 1 }), bus({ id: 2, up_trip_id: null })];
    expect(busSelectOptions(mixedUp, "up", AM, null, NONE).map((b) => b.id)).toEqual([1]);
  });

  it("편 불일치로 이미 배정된 호차는 목록에 남는다 (select value 유지)", () => {
    // 편 불일치 배정은 /admin/changes 가 경고하는 실재 케이스.
    // 목록에서 빼면 select 표시가 깨지고 되돌릴 수도 없다.
    const o = busSelectOptions(BUSES, "up", AM, 11, NONE);
    expect(o.map((b) => b.id)).toContain(11);
  });

  it("잔여석은 정원(capacity) 기준 — 만석은 0", () => {
    const used = new Map([[1, 44], [2, 40]]);
    const o = busSelectOptions(BUSES, "up", AM, null, used);
    expect(o.find((b) => b.id === 1)!.seatsLeft).toBe(0); // 44-44
    expect(o.find((b) => b.id === 2)!.seatsLeft).toBe(4); // 44-40
    expect(o.find((b) => b.id === 3)!.seatsLeft).toBe(44); // 미배정
  });

  it("보조석까지 찬 경우에도 음수가 아닌 0 (hard_cap 회귀 방지)", () => {
    // capacity 44 를 넘겨 45명이 타도 '잔여 -1' 이 아니라 0.
    // 예전 제안대로 hard_cap(45) 로 표기했으면 만석 호차가 '잔여 1' 로 보여
    // 총단이 자리가 있다고 착각해 보조석을 소진시켰을 것이다.
    const o = busSelectOptions(BUSES, "up", AM, null, new Map([[1, 45]]));
    expect(o.find((b) => b.id === 1)!.seatsLeft).toBe(0);
  });

  it("호차마다 다른 정원을 그대로 반영", () => {
    const small = [bus({ id: 9, capacity: 39 })];
    const o = busSelectOptions(small, "up", AM, null, new Map([[9, 30]]));
    expect(o[0].seatsLeft).toBe(9);
  });

  it("간사 차량은 목록에 없다 — 고르면 DB 가 거부한다 (§26-E)", () => {
    // 리허설에서 실제로 드러났다. 배차 화면의 수동 배정 드롭다운이 간사 차량을
    // 제안했는데, 그걸 고르면 DB 가드가 "먼저 고정 탑승자로 지정하세요" 로 거부한다.
    // 고를 수는 있는데 저장이 거부되는 상태 — 이 레포에서 이미 네 번 나온 결함이다.
    const withStaff = [
      bus({ id: 1 }),
      bus({ id: 9, name: "A간사차", kind: "staff_car", capacity: 4 }),
    ];
    const o = busSelectOptions(withStaff, "up", AM, null, new Map());
    expect(o.map((b) => b.id)).toEqual([1]);
  });

  it("이미 간사 차에 타 있으면 목록에 남는다 — 아니면 배정을 풀 수도 없다", () => {
    const withStaff = [
      bus({ id: 1 }),
      bus({ id: 9, name: "A간사차", kind: "staff_car", capacity: 4 }),
    ];
    const o = busSelectOptions(withStaff, "up", AM, 9, new Map());
    expect(o.map((b) => b.id).sort()).toEqual([1, 9]);
  });
});
