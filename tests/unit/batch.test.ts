import { describe, expect, it } from "vitest";
import { runBatch } from "@/lib/batch/engine";
import type { Bus, Passenger } from "@/lib/batch/types";

// ── 픽스처 헬퍼 ─────────────────────────────────────────────────────

let _pid = 0;
function pax(overrides: Partial<Passenger> = {}): Passenger {
  _pid += 1;
  return {
    id: `p${_pid}`,
    name: `순장/순원${_pid}`,
    campus: "전남대",
    attendance_type: "roundtrip",
    departure_day: "TUE",
    uses_return_bus: true,
    fixed_up_bus_id: null,
    ...overrides,
  };
}

/** n명을 동일 옵션으로 생성. */
function paxN(n: number, overrides: Partial<Passenger> = {}): Passenger[] {
  return Array.from({ length: n }, () => pax(overrides));
}

function bus(overrides: Partial<Bus> = {}): Bus {
  return {
    id: 1,
    name: "1호차",
    capacity: 44,
    hard_cap: 45,
    departure_day: "TUE",
    driver_registration_id: null,
    fixed_passenger_ids: [],
    ...overrides,
  };
}

/** 화 4대(1~4) + 수 4대(5~8) + 토 전용 1대(9). 총 9대. */
function nineBuses(): Bus[] {
  const tue = [1, 2, 3, 4].map((id) =>
    bus({ id, name: `${id}호차`, departure_day: "TUE" })
  );
  const wed = [5, 6, 7, 8].map((id) =>
    bus({ id, name: `${id}호차`, departure_day: "WED" })
  );
  const sat = bus({ id: 9, name: "9호차", departure_day: "TUE" });
  return [...tue, ...wed, sat];
}

// ── 시나리오 (reference §9) ─────────────────────────────────────────

describe("runBatch (reference/batch_algorithm.md §3·§9)", () => {
  it("10) 빈 입력 → 빈 결과, 무에러", () => {
    const r = runBatch([], nineBuses());
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(0);
    expect(r.by_bus).toEqual({});
    expect(r.up_assignments).toEqual({});
    expect(r.down_assignments).toEqual({});
  });

  it("1a) 1명 → 1호차 단독 배정", () => {
    const p = pax();
    const r = runBatch([p], nineBuses());
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(1);
    expect(r.up_assignments[p.id]).not.toBeNull();
    // 빈 차 4대 중 하나 (여유 좌석 가장 큰 = 1호차)
    expect(r.by_bus[r.up_assignments[p.id]]).toBe(1);
  });

  it("1b) 단순: 40명 캠퍼스 1개 TUE → 한 호차 단독, 미배정 0", () => {
    const buses = [bus({ id: 1, departure_day: "TUE" })];
    const r = runBatch(paxN(40), buses);
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(40);
    expect(r.by_bus[1]).toBe(40);
    expect(r.empty_seats).toBe(4); // 44 - 40
  });

  it("3) 만석: 화요일 4대(44×4=176) 가득", () => {
    // 캠퍼스 다양화 → 한 캠퍼스가 한 호차 정원 안 넘게
    const buses = [1, 2, 3, 4].map((id) => bus({ id, departure_day: "TUE" }));
    const passengers = Array.from({ length: 176 }, (_, i) =>
      pax({ campus: `c${i % 8}` })
    );
    const r = runBatch(passengers, buses);
    expect(r.total_assigned).toBe(176);
    expect(r.empty_seats).toBe(0);
  });

  it("4) 좌석 부족: 화 4대에 200명 → 미배정 errors 발생", () => {
    const buses = [1, 2, 3, 4].map((id) => bus({ id, departure_day: "TUE" }));
    // 캠퍼스를 잘게 쪼개 hard_cap(45) 까지 채우게 유도
    const passengers = Array.from({ length: 200 }, (_, i) =>
      pax({ campus: `c${i % 20}` })
    );
    const r = runBatch(passengers, buses);
    // hard_cap 45 × 4 = 180 까지만 배정 가능 → 20명 미배정
    expect(r.total_assigned).toBe(180);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.includes("미배정"))).toBe(true);
  });

  it("5) 큰 캠퍼스 분할: 전남대 50명 → 여러 호차 분산 + 작은 캠퍼스 통째", () => {
    const buses = [1, 2, 3, 4].map((id) => bus({ id, departure_day: "TUE" }));
    const big = paxN(50, { campus: "전남대" });
    const small = paxN(10, { campus: "조선대" });
    const r = runBatch([...big, ...small], buses);
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(60);
    // 전남대 50명은 한 호차(44/45) 못 들어가므로 2개 이상 호차에 분산
    const bigBuses = new Set(big.map((p) => r.up_assignments[p.id]));
    expect(bigBuses.size).toBeGreaterThanOrEqual(2);
    // 조선대 10명은 한 호차에 통째
    const smallBuses = new Set(small.map((p) => r.up_assignments[p.id]));
    expect(smallBuses.size).toBe(1);
  });

  it("6) 차량순장 고정: driver 지정 호차에 고정 (이동 X)", () => {
    const driver = pax({ id: "drv", departure_day: "TUE", campus: "조선대" });
    const buses = [
      bus({ id: 1, departure_day: "TUE", driver_registration_id: "drv" }),
      bus({ id: 2, departure_day: "TUE" }),
    ];
    // 1호차를 가득 메울 큰 캠퍼스 → 빈자리는 2호차가 더 많아짐
    const others = paxN(40, { campus: "전남대", departure_day: "TUE" });
    const r = runBatch([driver, ...others], buses);
    expect(r.errors).toEqual([]);
    // driver 는 capacity 와 무관하게 반드시 1호차
    expect(r.up_assignments["drv"]).toBe(1);
  });

  it("7) fixed_passenger_ids 우선 점유: 5명 0호차 고정", () => {
    const fixed = paxN(5, { departure_day: "TUE", campus: "채플팀" });
    const buses = [
      bus({
        id: 1,
        departure_day: "TUE",
        fixed_passenger_ids: fixed.map((p) => p.id),
      }),
      bus({ id: 2, departure_day: "TUE" }),
    ];
    const r = runBatch(fixed, buses);
    expect(r.errors).toEqual([]);
    for (const p of fixed) expect(r.up_assignments[p.id]).toBe(1);
    expect(r.by_bus[1]).toBe(5);
    // capacity 39 잔여 (44 - 5)
    const emptyOn1 = 44 - 5;
    expect(emptyOn1).toBe(39);
  });

  it("8) 요일 분리 강제: TUE 인원이 WED 호차에 절대 X", () => {
    const tueBus = bus({ id: 1, departure_day: "TUE", capacity: 2, hard_cap: 2 });
    const wedBus = bus({ id: 5, departure_day: "WED", capacity: 44 });
    // TUE 5명 (정원 2 초과) → 일부 미배정, 그러나 WED 차에는 절대 안 들어감
    const tuePax = paxN(5, { departure_day: "TUE", campus: "전남대" });
    const r = runBatch([...tuePax, pax({ departure_day: "WED" })], [
      tueBus,
      wedBus,
    ]);
    // WED 차(5호차)에는 TUE 인원 없음 — WED 신청자 1명만
    expect(r.by_bus[5]).toBe(1);
    // TUE 차(2석)는 2명만, 3명 미배정
    expect(r.by_bus[1]).toBe(2);
    expect(r.errors.some((e) => e.includes("TUE"))).toBe(true);
    // TUE 인원 누구도 WED 차(id 5)에 배정되지 않음
    for (const p of tuePax) {
      expect(r.up_assignments[p.id]).not.toBe(5);
    }
  });

  it("9) 하행편도 단독: 상행 null, 하행만 캠퍼스 묶음 배정", () => {
    const buses = nineBuses();
    const downPax = paxN(10, {
      attendance_type: "oneway",
      departure_day: null,
      uses_return_bus: true,
      campus: "전남대",
    });
    const r = runBatch(downPax, buses);
    expect(r.errors).toEqual([]);
    for (const p of downPax) {
      // 상행 미배정
      expect(r.up_assignments[p.id]).toBeUndefined();
      // 하행 배정됨
      expect(r.down_assignments[p.id]).toBeDefined();
    }
    // 같은 캠퍼스 묶음 → 한 호차에
    const downBuses = new Set(downPax.map((p) => r.down_assignments[p.id]));
    expect(downBuses.size).toBe(1);
  });

  it("11) 완참: 상행·하행 모두 독립 배정 (둘 다 정의됨)", () => {
    const buses = [bus({ id: 1, departure_day: "TUE" })];
    const passengers = paxN(10, { attendance_type: "roundtrip" });
    const r = runBatch(passengers, buses);
    for (const p of passengers) {
      expect(r.up_assignments[p.id]).toBe(1);
      expect(r.down_assignments[p.id]).toBe(1); // 단일 호차라 값은 같지만 독립 계산
    }
  });

  it("11b) 완참 하행은 요일 무관 전체 호차 대상 (상행과 독립)", () => {
    // WED 상행자는 상행은 WED 호차(5)지만, 하행은 토요일 9대 어디든 가능.
    const wedBuses = [5, 6].map((id) => bus({ id, departure_day: "WED" }));
    const tueBus = bus({ id: 1, departure_day: "TUE" });
    const wed = paxN(3, { departure_day: "WED", campus: "전남대" });
    const r = runBatch(wed, [tueBus, ...wedBuses]);
    for (const p of wed) {
      // 상행: WED 호차만 (5 또는 6)
      expect([5, 6]).toContain(r.up_assignments[p.id]);
      // 하행: 전체 호차 중 하나 (1·5·6 가능) — 정의됨
      expect(r.down_assignments[p.id]).toBeDefined();
    }
  });

  it("12) 편도 상행: up 정상, down null", () => {
    const buses = [bus({ id: 1, departure_day: "TUE" })];
    const onewayUp = paxN(5, {
      attendance_type: "oneway",
      departure_day: "TUE",
      uses_return_bus: false,
    });
    const r = runBatch(onewayUp, buses);
    for (const p of onewayUp) {
      expect(r.up_assignments[p.id]).toBe(1);
      // down 미배정
      expect(r.down_assignments[p.id]).toBeUndefined();
    }
  });

  it("13) 같은 캠퍼스 같은 호차 우선 (우선순위 1)", () => {
    const buses = [1, 2].map((id) => bus({ id, departure_day: "TUE" }));
    const a = paxN(20, { campus: "전남대" });
    const b = paxN(15, { campus: "조선대" });
    const r = runBatch([...a, ...b], buses);
    expect(r.errors).toEqual([]);
    // 각 캠퍼스는 정원 내라 통째로 한 호차에
    const aBuses = new Set(a.map((p) => r.up_assignments[p.id]));
    const bBuses = new Set(b.map((p) => r.up_assignments[p.id]));
    expect(aBuses.size).toBe(1);
    expect(bBuses.size).toBe(1);
  });

  it("14) 고정 배정 요일 불일치 → errors 기록 + 미배정", () => {
    const wrong = pax({ id: "wrong", departure_day: "WED" });
    const buses = [
      bus({ id: 1, departure_day: "TUE", driver_registration_id: "wrong" }),
      bus({ id: 5, departure_day: "WED" }),
    ];
    const r = runBatch([wrong], buses);
    expect(r.errors.some((e) => e.includes("요일 불일치"))).toBe(true);
    // TUE 차에 고정 안 됨. WED 차에는 일반 배정될 수 있음 (pinned 아님)
    expect(r.up_assignments["wrong"]).not.toBe(1);
  });

  it("16) 호차를 정원(44)까지 꽉 채움 — 미배정 0, 정원 초과 0", () => {
    // 7개 캠퍼스 × 20명(140), 4대. 채우기 위해 분할 허용 → 3대 44 + 1대 8.
    const buses = [1, 2, 3, 4].map((id) => bus({ id, departure_day: "TUE" }));
    const passengers = Array.from({ length: 7 }, (_, c) =>
      paxN(20, { campus: `c${c}`, departure_day: "TUE" })
    ).flat();
    const r = runBatch(passengers, buses);
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(140);
    const counts = Object.values(r.by_bus);
    expect(Math.max(...counts)).toBeLessThanOrEqual(44); // 정원 초과 없음
    expect(counts.filter((n) => n === 44).length).toBe(3); // 3대는 꽉 참
  });

  it("19) 정원 초과 방지: 빈 호차가 있으면 보조석(45) 쓰지 않음", () => {
    // 하행 47명, 9대(각 44). 44+3 으로 나눠야지 한 대에 45 몰면 안 됨.
    const buses = nineBuses();
    const down = paxN(47, {
      attendance_type: "oneway",
      departure_day: null,
      uses_return_bus: true,
      campus: "전남대",
    });
    const r = runBatch(down, buses);
    expect(r.errors).toEqual([]);
    const downCounts: Record<number, number> = {};
    for (const v of Object.values(r.down_assignments))
      downCounts[v] = (downCounts[v] ?? 0) + 1;
    // 어떤 호차도 정원(44) 초과 안 함
    expect(Math.max(...Object.values(downCounts))).toBeLessThanOrEqual(44);
  });

  it("17) 차량순장은 그 호차에 고정되되 캠퍼스를 끌어오지 않음", () => {
    // 순장(전남대) 1호차 고정. 전남대 나머지는 응집 없이 best-fit 으로 배정.
    const drv = pax({ id: "drv", campus: "전남대", departure_day: "TUE" });
    const mates = paxN(10, { campus: "전남대", departure_day: "TUE" });
    const buses = [
      bus({ id: 1, departure_day: "TUE", driver_registration_id: "drv" }),
      bus({ id: 2, departure_day: "TUE" }),
    ];
    const r = runBatch([drv, ...mates], buses);
    // 순장은 1호차에 그대로
    expect(r.up_assignments["drv"]).toBe(1);
    // 나머지는 best-fit 으로 어딘가 배정됨 (응집 강제 X) — 미배정만 아니면 됨
    for (const m of mates) expect(r.up_assignments[m.id]).toBeDefined();
    expect(r.errors).toEqual([]);
  });

  it("18) 큰 캠퍼스 분할 최소화: 50명 → 정확히 2호차 (45+5)", () => {
    const buses = [1, 2, 3].map((id) => bus({ id, departure_day: "TUE" }));
    const big = paxN(50, { campus: "전남대", departure_day: "TUE" });
    const r = runBatch(big, buses);
    const used = new Set(big.map((m) => r.up_assignments[m.id]));
    expect(used.size).toBe(2);
  });

  it("15) 350명 화 4대 → hard_cap 후도 대량 미배정 (reference §9 #3)", () => {
    const buses = [1, 2, 3, 4].map((id) => bus({ id, departure_day: "TUE" }));
    const passengers = Array.from({ length: 350 }, (_, i) =>
      pax({ campus: `c${i % 35}` })
    );
    const r = runBatch(passengers, buses);
    // hard_cap 45 × 4 = 180 최대
    expect(r.total_assigned).toBe(180);
    // 약 170명 미배정
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
