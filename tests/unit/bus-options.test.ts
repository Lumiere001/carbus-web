import { describe, expect, it } from "vitest";
import { busSelectOptions, type BusOption } from "@/lib/admin/bus-options";

// 슬롯: 1=화 오전, 2=화 오후, 3=수 오후 (운영 DB 기준)
const AM = 1, PM = 2, WED = 3;

function bus(o: Partial<BusOption> & { id: number }): BusOption {
  return { name: `${o.id}호차`, departure_slot_id: AM, capacity: 44, ...o };
}

/** 화 오전 3대 + 화 오후 1대 + 수 오후 1대. */
const BUSES: BusOption[] = [
  bus({ id: 1 }), bus({ id: 2 }), bus({ id: 3 }),
  bus({ id: 10, departure_slot_id: PM }),
  bus({ id: 11, departure_slot_id: WED }),
];
const NONE = new Map<number, number>();

describe("busSelectOptions — 서버가 허용하는 선택지와 일치", () => {
  it("상행: 학우 슬롯과 같은 호차만 노출", () => {
    const o = busSelectOptions(BUSES, "up", AM, null, NONE);
    expect(o.map((b) => b.id)).toEqual([1, 2, 3]);
  });

  it("상행: 화 오후 학우는 해당 슬롯 1대만", () => {
    const o = busSelectOptions(BUSES, "up", PM, null, NONE);
    expect(o.map((b) => b.id)).toEqual([10]);
  });

  it("상행: 하행 편도(슬롯 null)는 옵션 0개 — 서버의 '상행 대상 아님'과 동일", () => {
    const o = busSelectOptions(BUSES, "up", null, null, NONE);
    expect(o).toEqual([]);
  });

  it("하행: 슬롯 제한 없이 전 호차 — 교차슬롯 배정을 막지 않는다", () => {
    // 실운영에 하행 교차슬롯 배정이 86건 존재. 여기 필터를 걸면 그게 전부 막힌다.
    const o = busSelectOptions(BUSES, "down", AM, null, NONE);
    expect(o.map((b) => b.id)).toEqual([1, 2, 3, 10, 11]);
  });

  it("하행: 상행 슬롯이 null 이어도 전 호차 노출", () => {
    const o = busSelectOptions(BUSES, "down", null, null, NONE);
    expect(o).toHaveLength(5);
  });

  it("슬롯 불일치로 이미 배정된 호차는 목록에 남는다 (select value 유지)", () => {
    // 슬롯 불일치 배정은 /admin/changes 가 경고하는 실재 케이스.
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
});
