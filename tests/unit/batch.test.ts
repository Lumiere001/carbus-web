import { describe, expect, it } from "vitest";
import { runBatch } from "@/lib/batch/engine";
import type { Bus, Passenger } from "@/lib/batch/types";

// 테스트용 운행편 id. AM=화 오전, PM=화 오후 (상행), DOWN=귀가 (하행).
// 하행이 상행과 대칭 승격되면서 차량도 하행 편을 갖는다(buses.down_trip_id).
const AM = 1;
const PM = 2;
const DOWN = 90;

// ── 픽스처 헬퍼 ─────────────────────────────────────────────────────

let _pid = 0;
function pax(overrides: Partial<Passenger> = {}): Passenger {
  _pid += 1;
  return {
    id: `p${_pid}`,
    name: `순장/순원${_pid}`,
    campus: "전남대",
    attendance_type: "roundtrip",
    up_trip_id: AM,
    down_trip_id: DOWN,
    fixed_up_bus_id: null,
    ...overrides,
  };
}

/** n명을 동일 옵션으로 생성. */
function paxN(n: number, overrides: Partial<Passenger> = {}): Passenger[] {
  return Array.from({ length: n }, () => pax(overrides));
}

function bus(overrides: Partial<Bus> = {}): Bus {
  const name = overrides.name ?? "1호차";
  return {
    id: 1,
    name,
    capacity: 44,
    hard_cap: 45,
    up_trip_id: AM,
    // 하행은 기본적으로 전 호차 운행 — 이 값이 null 이면 하행 배차에서 제외된다.
    down_trip_id: DOWN,
    driver_registration_id: null,
    fixed_passenger_ids: [],
    down_driver_registration_id: null,
    down_fixed_passenger_ids: [],
    // 배차 특례는 이제 이름이 아니라 플래그다(마이그레이션 20260721050000).
    // 여기서 이름으로 유도하는 건 그 마이그레이션의 backfill 과 **같은 규칙**이라,
    // 기존 테스트가 검증하던 동작이 그대로 유지된다. 플래그를 직접 지정하면 그게 이긴다.
    is_cohesion_exempt: name === "1호차",
    fill_priority: name === "1호차" ? 1 : 0,
    // 기본은 일반 버스. 간사 차량은 그 테스트에서 명시적으로 넘긴다(§26-E).
    kind: "bus",
    ...overrides,
  };
}

/** 화 4대(1~4) + 수 4대(5~8) + 토 전용 1대(9). 총 9대. */
function nineBuses(): Bus[] {
  const tue = [1, 2, 3, 4].map((id) =>
    bus({ id, name: `${id}호차`, up_trip_id: AM })
  );
  const wed = [5, 6, 7, 8].map((id) =>
    bus({ id, name: `${id}호차`, up_trip_id: PM })
  );
  const sat = bus({ id: 9, name: "9호차", up_trip_id: AM });
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
    const buses = [bus({ id: 1, up_trip_id: AM })];
    const r = runBatch(paxN(40), buses);
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(40);
    expect(r.by_bus[1]).toBe(40);
    expect(r.empty_seats).toBe(4); // 44 - 40
  });

  it("3) 만석: 화요일 4대(44×4=176) 가득", () => {
    // 캠퍼스 다양화 → 한 캠퍼스가 한 호차 정원 안 넘게
    const buses = [1, 2, 3, 4].map((id) => bus({ id, up_trip_id: AM }));
    const passengers = Array.from({ length: 176 }, (_, i) =>
      pax({ campus: `c${i % 8}` })
    );
    const r = runBatch(passengers, buses);
    expect(r.total_assigned).toBe(176);
    expect(r.empty_seats).toBe(0);
  });

  it("4) 좌석 부족: 화 4대에 200명 → 미배정 errors 발생", () => {
    const buses = [1, 2, 3, 4].map((id) => bus({ id, up_trip_id: AM }));
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
    const buses = [1, 2, 3, 4].map((id) => bus({ id, up_trip_id: AM }));
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
    const driver = pax({ id: "drv", up_trip_id: AM, campus: "조선대" });
    const buses = [
      bus({ id: 1, up_trip_id: AM, driver_registration_id: "drv" }),
      bus({ id: 2, up_trip_id: AM }),
    ];
    // 1호차를 가득 메울 큰 캠퍼스 → 빈자리는 2호차가 더 많아짐
    const others = paxN(40, { campus: "전남대", up_trip_id: AM });
    const r = runBatch([driver, ...others], buses);
    expect(r.errors).toEqual([]);
    // driver 는 capacity 와 무관하게 반드시 1호차
    expect(r.up_assignments["drv"]).toBe(1);
  });

  it("7) fixed_passenger_ids 우선 점유: 5명 0호차 고정", () => {
    const fixed = paxN(5, { up_trip_id: AM, campus: "채플팀" });
    const buses = [
      bus({
        id: 1,
        up_trip_id: AM,
        fixed_passenger_ids: fixed.map((p) => p.id),
      }),
      bus({ id: 2, up_trip_id: AM }),
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
    const tueBus = bus({ id: 1, up_trip_id: AM, capacity: 2, hard_cap: 2 });
    const wedBus = bus({ id: 5, up_trip_id: PM, capacity: 44 });
    // TUE 5명 (정원 2 초과) → 일부 미배정, 그러나 WED 차에는 절대 안 들어감
    const tuePax = paxN(5, { up_trip_id: AM, campus: "전남대" });
    const r = runBatch([...tuePax, pax({ up_trip_id: PM })], [
      tueBus,
      wedBus,
    ]);
    // WED 차(5호차)에는 TUE 인원 없음 — WED 신청자 1명만
    expect(r.by_bus[5]).toBe(1);
    // TUE 차(2석)는 2명만, 3명 미배정
    expect(r.by_bus[1]).toBe(2);
    expect(r.errors.some((e) => e.includes("미배정"))).toBe(true);
    // TUE 인원 누구도 WED 차(id 5)에 배정되지 않음
    for (const p of tuePax) {
      expect(r.up_assignments[p.id]).not.toBe(5);
    }
  });

  it("9) 하행편도 단독: 상행 null, 하행만 캠퍼스 묶음 배정", () => {
    const buses = nineBuses();
    const downPax = paxN(10, {
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
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

  it("10b) 하행 단독 실행(mode='down')은 리포팅도 하행 기준 ('배정 0명' 회귀 방지)", () => {
    const buses = nineBuses();
    const down = paxN(50, {
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
      campus: "전남대",
    });
    const r = runBatch(down, buses, "down");
    expect(r.errors).toEqual([]);
    // 예전엔 up_bus_id 만 집계해 하행 실행이 항상 0명/396석으로 표시됐다.
    expect(r.total_assigned).toBe(50);
    const byBusTotal = Object.values(r.by_bus).reduce((s, n) => s + n, 0);
    expect(byBusTotal).toBe(50);
    const totalCap = buses.reduce((s, b) => s + b.capacity, 0);
    expect(r.empty_seats).toBe(totalCap - 50);
  });

  it("11) 완참: 상행·하행 모두 독립 배정 (둘 다 정의됨)", () => {
    const buses = [bus({ id: 1, up_trip_id: AM })];
    const passengers = paxN(10, { attendance_type: "roundtrip" });
    const r = runBatch(passengers, buses);
    for (const p of passengers) {
      expect(r.up_assignments[p.id]).toBe(1);
      expect(r.down_assignments[p.id]).toBe(1); // 단일 호차라 값은 같지만 독립 계산
    }
  });

  it("11b) 완참 하행은 요일 무관 전체 호차 대상 (상행과 독립)", () => {
    // WED 상행자는 상행은 WED 호차(5)지만, 하행은 토요일 9대 어디든 가능.
    const wedBuses = [5, 6].map((id) => bus({ id, up_trip_id: PM }));
    const tueBus = bus({ id: 1, up_trip_id: AM });
    const wed = paxN(3, { up_trip_id: PM, campus: "전남대" });
    const r = runBatch(wed, [tueBus, ...wedBuses]);
    for (const p of wed) {
      // 상행: WED 호차만 (5 또는 6)
      expect([5, 6]).toContain(r.up_assignments[p.id]);
      // 하행: 전체 호차 중 하나 (1·5·6 가능) — 정의됨
      expect(r.down_assignments[p.id]).toBeDefined();
    }
  });

  it("12) 편도 상행: up 정상, down null", () => {
    const buses = [bus({ id: 1, up_trip_id: AM })];
    const onewayUp = paxN(5, {
      attendance_type: "oneway",
      up_trip_id: AM,
      down_trip_id: null,
    });
    const r = runBatch(onewayUp, buses);
    for (const p of onewayUp) {
      expect(r.up_assignments[p.id]).toBe(1);
      // down 미배정
      expect(r.down_assignments[p.id]).toBeUndefined();
    }
  });

  it("13) 같은 캠퍼스 같은 호차 우선 (우선순위 1)", () => {
    const buses = [1, 2].map((id) => bus({ id, up_trip_id: AM }));
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

  it("14) 고정 배정 편 불일치 → errors 기록 + 미배정", () => {
    const wrong = pax({ id: "wrong", up_trip_id: PM });
    const buses = [
      bus({ id: 1, up_trip_id: AM, driver_registration_id: "wrong" }),
      bus({ id: 5, up_trip_id: PM }),
    ];
    const r = runBatch([wrong], buses);
    expect(r.errors.some((e) => e.includes("편 불일치"))).toBe(true);
    // TUE 차에 고정 안 됨. WED 차에는 일반 배정될 수 있음 (pinned 아님)
    expect(r.up_assignments["wrong"]).not.toBe(1);
  });

  it("16) FFD 채움 — 미배정 0, 정원 초과 0, 캠퍼스 분할 없음", () => {
    // 7개 캠퍼스 × 20명(140), 4대. FFD는 캠퍼스를 통째로 best-fit 호차에 넣어
    // 불필요한 분할을 만들지 않는다 (정원 안 채워도 분할보다 낫다 — 빈좌석 동일).
    const buses = [1, 2, 3, 4].map((id) => bus({ id, up_trip_id: AM }));
    const passengers = Array.from({ length: 7 }, (_, c) =>
      paxN(20, { campus: `c${c}`, up_trip_id: AM })
    ).flat();
    const r = runBatch(passengers, buses);
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(140);
    const counts = Object.values(r.by_bus);
    expect(Math.max(...counts)).toBeLessThanOrEqual(44); // 정원 초과 없음
    // 20명 캠퍼스는 44 정원에 통째로 들어가므로 어떤 캠퍼스도 분할되지 않음
    const campusBuses = new Map<string, Set<number>>();
    for (const p of passengers) {
      const set = campusBuses.get(p.campus) ?? new Set<number>();
      set.add(r.up_assignments[p.id]);
      campusBuses.set(p.campus, set);
    }
    for (const set of campusBuses.values()) expect(set.size).toBe(1);
  });

  it("19) 정원 초과 방지: 빈 호차가 있으면 보조석(45) 쓰지 않음", () => {
    // 하행 47명, 9대(각 44). 44+3 으로 나눠야지 한 대에 45 몰면 안 됨.
    const buses = nineBuses();
    const down = paxN(47, {
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
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

  it("17) 차량순장 캠퍼스 우선: 같은 캠퍼스를 순장 호차에 먼저 배정", () => {
    // 순장(전남대) 2호차. 전남대 동료 10명이 순장 호차(2)로 우선 배정됨. (1호차는 예외라 회피)
    const drv = pax({ id: "drv", campus: "전남대", up_trip_id: AM });
    const mates = paxN(10, { campus: "전남대", up_trip_id: AM });
    const buses = [
      bus({ id: 2, name: "2호차", up_trip_id: AM, driver_registration_id: "drv" }),
      bus({ id: 3, name: "3호차", up_trip_id: AM }),
    ];
    const r = runBatch([drv, ...mates], buses);
    expect(r.up_assignments["drv"]).toBe(2);
    // 같은 캠퍼스 전원이 순장 호차(2)에 우선 배정
    for (const m of mates) expect(r.up_assignments[m.id]).toBe(2);
    expect(r.errors).toEqual([]);
  });

  it("17b) 순장 캠퍼스 정원 초과: 정원(44)까지만 순장 호차, 나머지 일반 배차", () => {
    // 순장(전남대) 2호차 + 전남대 50명. 2호차는 정원(순장1+43=44)까지, 7명은 3호차로.
    // cohesion 없으면 best-fit 으로 3호차 44·2호차 7 이 되므로 이 테스트가 cohesion 을 검증.
    const drv = pax({ id: "drv", campus: "전남대", up_trip_id: AM });
    const mates = paxN(50, { campus: "전남대", up_trip_id: AM });
    const buses = [
      bus({ id: 2, name: "2호차", up_trip_id: AM, driver_registration_id: "drv" }),
      bus({ id: 3, name: "3호차", up_trip_id: AM }),
    ];
    const r = runBatch([drv, ...mates], buses);
    expect(r.errors).toEqual([]);
    expect(r.by_bus[2]).toBe(44); // 정원까지 (순장 + 43)
    expect(r.by_bus[3]).toBe(7); // 넘친 7명
  });

  it("17d) 1호차는 예외: 순장 있어도 캠퍼스 우선 배치 안 함", () => {
    // 1호차 순장(전남대) + 전남대 10명, 비-1호차(2·3호차) 여유 있음.
    // 응집이 적용됐다면 전남대가 순장 호차(1)로 몰리지만, 1호차는 예외라 비-1호차로 감.
    const drv = pax({ id: "drv", campus: "전남대", up_trip_id: AM });
    const mates = paxN(10, { campus: "전남대", up_trip_id: AM });
    const buses = [
      bus({ id: 1, name: "1호차", up_trip_id: AM, driver_registration_id: "drv" }),
      bus({ id: 2, name: "2호차", up_trip_id: AM }),
      bus({ id: 3, name: "3호차", up_trip_id: AM }),
    ];
    const r = runBatch([drv, ...mates], buses);
    expect(r.errors).toEqual([]);
    expect(r.up_assignments["drv"]).toBe(1); // 순장 고정은 유지
    // 전남대 동료는 1호차로 끌려가지 않음 (예외 + 1호차 빈자리 후순위) → 0명
    const matesOn1 = mates.filter((m) => r.up_assignments[m.id] === 1).length;
    expect(matesOn1).toBe(0);
  });

  it("1호차 빈자리 최대화: 여유 있으면 1호차를 비워둠 (후순위)", () => {
    // 80명, 2·3호차(88석)로 흡수 가능 → 1호차(짐차)는 0명.
    const buses = [1, 2, 3].map((id) =>
      bus({ id, name: `${id}호차`, up_trip_id: AM })
    );
    const pax80 = Array.from({ length: 80 }, (_, i) =>
      pax({ campus: `c${i % 8}` })
    );
    const r = runBatch(pax80, buses);
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(80);
    expect(r.by_bus[1] ?? 0).toBe(0); // 1호차 비움
  });

  it("1호차도 자리 부족하면 오버플로우로 채움 (미배정 0 유지)", () => {
    // 120명 > 2·3호차(88) → 1호차로 넘침. 후순위라도 좌석 부족 시엔 사용.
    const buses = [1, 2, 3].map((id) =>
      bus({ id, name: `${id}호차`, up_trip_id: AM })
    );
    const pax120 = Array.from({ length: 120 }, (_, i) =>
      pax({ campus: `c${i % 12}` })
    );
    const r = runBatch(pax120, buses);
    expect(r.errors).toEqual([]);
    expect(r.total_assigned).toBe(120);
    expect(r.by_bus[1] ?? 0).toBeGreaterThan(0); // 1호차도 사용
  });

  it("17c) 하행도 차량순장 캠퍼스 우선 (상행과 독립)", () => {
    const drv = pax({
      id: "ddrv",
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
      campus: "조선대",
    });
    const mates = paxN(10, {
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
      campus: "조선대",
    });
    const buses = [
      bus({ id: 2, name: "2호차", up_trip_id: AM, down_driver_registration_id: "ddrv" }),
      bus({ id: 3, name: "3호차", up_trip_id: AM }),
    ];
    const r = runBatch([drv, ...mates], buses);
    expect(r.errors).toEqual([]);
    expect(r.down_assignments["ddrv"]).toBe(2);
    // 같은 캠퍼스 전원이 하행 순장 호차(2)에 우선 배정
    for (const m of mates) expect(r.down_assignments[m.id]).toBe(2);
  });

  it("18) 큰 캠퍼스 분할 최소화: 50명 → 정확히 2호차 (45+5)", () => {
    const buses = [1, 2, 3].map((id) => bus({ id, up_trip_id: AM }));
    const big = paxN(50, { campus: "전남대", up_trip_id: AM });
    const r = runBatch(big, buses);
    const used = new Set(big.map((m) => r.up_assignments[m.id]));
    expect(used.size).toBe(2);
  });

  it("20) 하행 차량순장 고정: down_driver 지정 호차에 고정 (상행과 독립)", () => {
    const drv = pax({
      id: "ddrv",
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
      campus: "조선대",
    });
    const others = paxN(40, {
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
      campus: "전남대",
    });
    const buses = [
      bus({ id: 1, up_trip_id: AM, down_driver_registration_id: "ddrv" }),
      bus({ id: 2, up_trip_id: AM }),
    ];
    const r = runBatch([drv, ...others], buses);
    expect(r.errors).toEqual([]);
    // 하행 차량순장은 1호차에 고정
    expect(r.down_assignments["ddrv"]).toBe(1);
    // 상행 배정은 없음 (하행편도)
    expect(r.up_assignments["ddrv"]).toBeUndefined();
  });

  it("21) 하행 고정탑승: down_fixed 5명 지정 호차 점유", () => {
    const fixed = paxN(5, {
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
      campus: "채플팀",
    });
    const buses = [
      bus({
        id: 1,
        up_trip_id: AM,
        down_fixed_passenger_ids: fixed.map((p) => p.id),
      }),
      bus({ id: 2, up_trip_id: AM }),
    ];
    const r = runBatch(fixed, buses);
    expect(r.errors).toEqual([]);
    for (const p of fixed) expect(r.down_assignments[p.id]).toBe(1);
  });

  it("22) 하행 고정은 상행 고정과 별개 (같은 사람 상/하행 다른 호차)", () => {
    // 왕복자: 상행은 1호차 driver, 하행은 2호차 down_driver 로 지정 → 각각 따로 고정.
    const p = pax({
      id: "both",
      attendance_type: "roundtrip",
      up_trip_id: AM,
      down_trip_id: DOWN,
      campus: "호남대",
    });
    const buses = [
      bus({ id: 1, up_trip_id: AM, driver_registration_id: "both" }),
      bus({ id: 2, up_trip_id: AM, down_driver_registration_id: "both" }),
    ];
    const r = runBatch([p], buses);
    expect(r.up_assignments["both"]).toBe(1); // 상행 1호차
    expect(r.down_assignments["both"]).toBe(2); // 하행 2호차
  });

  it("22b) 상행 전용 리더는 하행에선 일반 자동배차 (하행 리더 아님)", () => {
    // 왕복자 X: 상행 1호차 차량순장으로 고정 + 하행은 아무 바인딩 없음.
    // 하행에선 일반 탑승자로 자동 배차돼야 한다(상행 리더라고 하행이 막히면 안 됨).
    // → batch/actions.ts 의 과도한 '교차-방향 리더 호차 필수' 가드 제거를 엔진 레벨에서 못박음.
    const x = pax({
      id: "x",
      attendance_type: "roundtrip",
      up_trip_id: AM,
      down_trip_id: DOWN,
      campus: "전남대",
    });
    const mates = paxN(5, {
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
      campus: "전남대",
    });
    const buses = [
      bus({ id: 1, up_trip_id: AM, driver_registration_id: "x" }),
      bus({ id: 2, up_trip_id: AM }),
    ];
    const r = runBatch([x, ...mates], buses, "down");
    expect(r.errors).toEqual([]);
    // 상행 리더 X 도 하행 좌석을 자동으로 받음
    expect(r.down_assignments["x"]).toBeDefined();
    // 하행 이용자 전원 배정 (X + 동료 5명)
    expect(Object.keys(r.down_assignments).length).toBe(6);
  });

  it("23) 고정 정원 초과 방지: hard_cap(45) 넘는 고정은 차단+에러", () => {
    // 1대(hard_cap 45)에 46명 고정 시도 → 45명만 고정, 초과분 에러
    const fixed = paxN(46, { up_trip_id: AM, campus: "전남대" });
    const buses = [
      bus({
        id: 1,
        up_trip_id: AM,
        fixed_passenger_ids: fixed.map((p) => p.id),
      }),
    ];
    const r = runBatch(fixed, buses);
    // 어떤 호차도 hard_cap(45) 초과 안 함
    expect(Math.max(...Object.values(r.by_bus))).toBeLessThanOrEqual(45);
    expect(r.errors.some((e) => e.includes("정원 초과"))).toBe(true);
  });

  it("24) 같은 사람 두 호차 중복 고정 → 첫 호차만, 중복 경고", () => {
    const dup = pax({ id: "dup", up_trip_id: AM, campus: "조선대" });
    const buses = [
      bus({ id: 1, up_trip_id: AM, fixed_passenger_ids: ["dup"] }),
      bus({ id: 2, up_trip_id: AM, fixed_passenger_ids: ["dup"] }),
    ];
    const r = runBatch([dup], buses);
    expect(r.up_assignments["dup"]).toBe(1); // 첫 호차
    expect(r.errors.some((e) => e.includes("중복"))).toBe(true);
  });

  it("25) 하행 고정 정원 초과 방지", () => {
    const fixed = paxN(46, {
      attendance_type: "oneway",
      up_trip_id: null,
      down_trip_id: DOWN,
      campus: "전남대",
    });
    const buses = [
      bus({
        id: 1,
        up_trip_id: AM,
        down_fixed_passenger_ids: fixed.map((p) => p.id),
      }),
    ];
    const r = runBatch(fixed, buses);
    const downCounts: Record<number, number> = {};
    for (const v of Object.values(r.down_assignments))
      downCounts[v] = (downCounts[v] ?? 0) + 1;
    expect(Math.max(...Object.values(downCounts))).toBeLessThanOrEqual(45);
    expect(r.errors.some((e) => e.includes("정원 초과"))).toBe(true);
  });

  it("15) 350명 화 4대 → hard_cap 후도 대량 미배정 (reference §9 #3)", () => {
    const buses = [1, 2, 3, 4].map((id) => bus({ id, up_trip_id: AM }));
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

describe("오류 문구는 편 이름으로 말한다", () => {
  it("좌석이 모자라면 어느 편인지 이름으로 알려준다", () => {
    // 리허설에서 실제로 `미배정: slot 7 29명` 이 나왔다. 화면에서 그걸 본 운영자는
    // 7 이 어느 편인지 알 수 없다 — 증편해야 할 편을 못 찾는다.
    const buses = [bus({ id: 1, up_trip_id: AM, is_cohesion_exempt: false, fill_priority: 0 })];
    const r = runBatch(paxN(60), buses, "up", { [AM]: "목 오전 10시" });
    expect(r.errors.some((e) => e.includes("목 오전 10시"))).toBe(true);
    expect(r.errors.some((e) => e.includes("slot"))).toBe(false);
  });

  it("이름을 안 넘기면 편 번호로 떨어진다 — 순수 함수라 스스로 조회하지 않는다", () => {
    const buses = [bus({ id: 1, up_trip_id: AM, is_cohesion_exempt: false, fill_priority: 0 })];
    const r = runBatch(paxN(60), buses, "up");
    expect(r.errors.some((e) => e.includes(`편 ${AM}`))).toBe(true);
  });
});

describe("간사 차량은 자동 배차에서 빠진다 (§26-E)", () => {
  // 이게 이번 개편에서 **가장 크게 터질 수 있는 자리**다. 안 빼면 캠퍼스 인원이
  // 간사 차에 밀려 들어가고, 현장에서는 간사 차에 모르는 학우가 타 있게 된다.

  it("좌석이 모자라도 간사 차에는 아무도 안 들어간다", () => {
    // 일반 버스 1대(45석)에 60명 → 15명이 미배정이 되어야 한다.
    // 간사 차(4석)가 있어도 그 15명이 거기로 흘러들면 안 된다.
    const buses = [
      bus({ id: 1, name: "1호차", up_trip_id: AM, is_cohesion_exempt: false, fill_priority: 0 }),
      bus({ id: 9, name: "A간사차", up_trip_id: AM, capacity: 4, hard_cap: 4, kind: "staff_car" }),
    ];
    const passengers = Array.from({ length: 60 }, (_, i) => pax({ campus: `c${i % 6}` }));
    const r = runBatch(passengers, buses, "up");

    const onStaffCar = Object.values(r.up_assignments).filter((b) => b === 9);
    expect(onStaffCar).toHaveLength(0);
    expect(r.total_assigned).toBe(45); // 일반 버스 hard_cap 만큼만
  });

  it("고정 탑승자로 지정된 사람은 간사 차에 남는다 — 재배차에도 살아남아야 한다", () => {
    // 수동 지정의 유일한 통로다. 여기가 깨지면 크루·미디어를 적어 둬도
    // 배차를 다시 돌리는 순간 사라진다.
    const crew = pax({ id: "crew1", campus: "c1" });
    const others = Array.from({ length: 30 }, (_, i) => pax({ campus: `c${i % 3}` }));
    const buses = [
      bus({ id: 1, name: "1호차", up_trip_id: AM, is_cohesion_exempt: false, fill_priority: 0 }),
      bus({
        id: 9,
        name: "A간사차",
        up_trip_id: AM,
        capacity: 4,
        hard_cap: 4,
        kind: "staff_car",
        fixed_passenger_ids: ["crew1"],
      }),
    ];
    const r = runBatch([crew, ...others], buses, "up");

    expect(r.up_assignments["crew1"]).toBe(9);
    // 나머지는 전원 일반 버스로
    for (const p of others) expect(r.up_assignments[p.id]).toBe(1);
  });

  it("간사 차만 뛰는 편은 '운행 호차 없음'으로 드러난다 — 조용히 미배정되지 않는다", () => {
    // 간사 차를 편 목록에서 안 빼면 그 편에 채울 차가 없어 전원이 조용히 미배정된다.
    const buses = [bus({ id: 9, name: "A간사차", up_trip_id: AM, kind: "staff_car" })];
    const r = runBatch(paxN(10), buses, "up");
    expect(r.total_assigned).toBe(0);
    expect(r.errors.some((e) => e.includes("운행 호차 없는"))).toBe(true);
  });

  it("하행도 같은 규칙이다", () => {
    const buses = [
      bus({ id: 1, name: "1호차", up_trip_id: AM, down_trip_id: DOWN, is_cohesion_exempt: false, fill_priority: 0 }),
      bus({ id: 9, name: "A간사차", up_trip_id: null, down_trip_id: DOWN, capacity: 4, hard_cap: 4, kind: "staff_car" }),
    ];
    const r = runBatch(paxN(50), buses, "down");
    expect(Object.values(r.down_assignments).filter((b) => b === 9)).toHaveLength(0);
  });

  it("우리 버스 편을 신청하지 않은 사람도 간사 차에 남는다", () => {
    // 크루·미디어는 우리 버스를 안 타서 편이 아예 없다(attendance_type=self).
    // 일반 버스라면 "편 불일치" 로 떨어지는 게 맞지만, 간사 차는 우리 버스 편과
    // 짝을 맞추는 개념이 아니다. 여기서 떨어지면 간사 차 명단이 매번 비워진다.
    const crew = pax({ id: "crew1", campus: "c1", up_trip_id: null, down_trip_id: null });
    const buses = [
      bus({ id: 1, name: "1호차", up_trip_id: AM, is_cohesion_exempt: false, fill_priority: 0 }),
      bus({
        id: 9,
        name: "A간사차",
        up_trip_id: AM,
        capacity: 4,
        hard_cap: 4,
        kind: "staff_car",
        fixed_passenger_ids: ["crew1"],
      }),
    ];
    const r = runBatch([crew, ...paxN(10)], buses, "up");
    expect(r.up_assignments["crew1"]).toBe(9);
    expect(r.errors.some((e) => e.includes("편 불일치"))).toBe(false);
  });

  it("일반 버스는 여전히 편이 맞아야 한다 — 느슨해지면 안 된다", () => {
    const wrong = pax({ id: "w1", campus: "c1", up_trip_id: PM });
    const buses = [
      bus({
        id: 1,
        name: "1호차",
        up_trip_id: AM,
        fixed_passenger_ids: ["w1"],
        is_cohesion_exempt: false,
        fill_priority: 0,
      }),
    ];
    const r = runBatch([wrong], buses, "up");
    expect(r.errors.some((e) => e.includes("편 불일치"))).toBe(true);
  });

  it("kind 가 빠지면 크게 실패한다 — 조용히 되살아나면 안 된다", () => {
    // `kind` 가 undefined 면 `b.kind !== "staff_car"` 가 참이라 간사 차량이
    // 자동 배차 대상으로 되살아난다. 타입 검사를 안 받는 경로(JSON 픽스처·
    // 진단 스크립트)를 위한 방어선이다.
    const broken = [{ ...bus({ id: 1 }), kind: undefined } as unknown as Parameters<typeof runBatch>[1][number]];
    expect(() => runBatch(paxN(3), broken)).toThrow(/배차 플래그 누락/);
  });
});
