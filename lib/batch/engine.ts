/**
 * 배차 엔진 (reference/batch_algorithm.md §3·§4)
 *
 * 상행·하행을 **독립적으로** 배차한다. mode 로 한쪽만 실행 가능.
 *
 * 우선순위 (사용자 확정):
 *   1. 미배정 최소화 — 모두 좌석을 받아야 함 (정원이 허용하는 한 0).
 *   2. 호차를 꽉(정원 44) 채움 — 빈 좌석·사용 호차 최소화. 보조석(45)은
 *      44×대수로 부족할 때만 마지막 수단.
 *   3. 같은 캠퍼스 묶음(soft) — 안 되면 찢어서라도 채움.
 *      3-1. 차량순장 캠퍼스 우선 — 순장이 있는 호차에 같은 캠퍼스를 정원(44)까지
 *           먼저 채운다(상·하행 각각). 넘치는 인원·남는 좌석은 아래 일반 배차가 처리.
 *           단, 여러 캠퍼스가 섞이는 호차는 예외 — `buses.is_cohesion_exempt`.
 *   4. 혼자만 다른 캠퍼스 금지 — 분할 조각이 1명이 되지 않게.
 *   5. (상행만) 요일 분리 + 고정 배정(driver/fixed) 보존. 차량순장은 개별 배정.
 *   6. (후순위) 짐차 빈자리 최대 — 짐을 함께 싣는 호차는 인원을 최소화.
 *      1~5를 모두 지킨 뒤, 빈자리 분배 단계에서만 가장 나중에 채운다
 *      (오버플로우 전용) — `buses.fill_priority` 가 클수록 뒤로 밀린다.
 *      ⚠️ "다른 호차로 충분하면 비워진다"는 보장이 아니다. 캠퍼스 단위 best-fit 과
 *      1명조각 방지가 먼저 걸려, 다른 호차에 빈자리가 남은 채로 쓰이기도 한다
 *      (실측: 운영 599명에서 다른 호차 잔여 9석인데 짐차가 8명 수용).
 *
 * 알고리즘 (FFD — First-Fit Decreasing, 캠퍼스 단위):
 *   ⓪ 차량순장 캠퍼스 우선: 순장 있는 호차에 같은 캠퍼스를 정원까지 먼저 배정.
 *   그 뒤 남은 인원을 캠퍼스 큰 순으로, 각 캠퍼스를
 *     ① 통째로 들어가는 호차 중 잔여 최소(best-fit)에 배정 — 분할·빈자리 동시 최소화.
 *     ② 어느 호차에도 통째로 못 들어가면(캠퍼스 > 호차 잔여) 잔여 큰 호차부터 분할
 *        (조각 최소, 1명 조각 방지).
 *     ③ 정원(44) 다 차면 보조석(45)까지 → 그래도 넘치면 미배정.
 *   ①②③ 모두 같은 잔여 조건이면 fill_priority 가 큰 호차를 뒤로 밀어 마지막에 채운다.
 *   순차 채움(next-fit) 대비 작은 캠퍼스의 불필요한 분할을 없애면서 빈좌석은
 *   동일하게 유지한다(파레토 개선). 순수 함수.
 */

import type { Assignment, BatchResult, Bus, Passenger } from "./types";

export type BatchMode = "up" | "down" | "both";

/** 작업용 호차: count = 현재 배정 인원. */
interface BusWork extends Bus {
  count: number;
}

/**
 * 후순위 정렬 키 — 클수록 나중에 채운다.
 *
 * 예전엔 `FILL_LAST_BUS_NAMES.has(b.name)` 로 `"1호차"` 를 찾았다. 이름이
 * 코드에 박혀 있어 다른 행사에서 짐차 이름이 바뀌면 조용히 특례가 사라졌다.
 * 지금은 buses.fill_priority 컬럼이 진실원이다(마이그레이션 20260721050000).
 */
const fillLastRank = (b: BusWork): number => b.fill_priority;

/**
 * 호차에 배차 플래그가 실제로 들어 있는지 확인하고, 없으면 **던진다**.
 *
 * 왜 던지나 — 빠뜨리면 조용히 반대로 배차되기 때문이다:
 *   `fill_priority` 가 undefined 면 `fillLastRank(a) - fillLastRank(b)` 가 NaN 이고,
 *   NaN 은 falsy 라 `||` 우변으로 폴백해 **후순위 규칙이 통째로 무시된다.**
 *   `is_cohesion_exempt` 가 undefined 면 falsy 라 응집 면제도 사라진다.
 *   실측: 80명·3대에서 짐차 배정이 0명 → 44명으로 뒤집혔다.
 *
 * 왜 errors 배열이 아니라 예외인가 — 호출부(batch/actions.ts)가 result.errors 를
 * 검사하지 않고 배정을 DB 에 쓴다. 경고로 두면 틀린 배정이 그대로 저장된다.
 *
 * 왜 `?? 0` 폴백을 쓰지 않나 — 그러면 누락이 영구히 숨는다. 이건 데이터 상태가
 * 아니라 **호출부의 버그**이므로 크게 실패하는 게 맞다.
 *
 * .ts 호출부는 tsc 가 막아준다. 이 가드는 타입 검사를 안 받는 경로
 * (scripts/*.mjs 진단 도구, JSON 픽스처, 런타임 DB row)를 위한 것이다.
 */
function assertBusFlags(buses: Bus[]): void {
  const bad = buses.filter(
    (b) =>
      typeof b.fill_priority !== "number" ||
      Number.isNaN(b.fill_priority) ||
      typeof b.is_cohesion_exempt !== "boolean"
  );
  if (bad.length > 0) {
    throw new Error(
      `배차 플래그 누락: ${bad
        .map((b) => b.name ?? b.id)
        .join(", ")} — is_cohesion_exempt(boolean) / fill_priority(number) 가 필요합니다. ` +
        `빠뜨리면 짐차 특례가 조용히 반대로 적용됩니다.`
    );
  }

  // 운행편 id 도 같은 이유로 검사한다. undefined 는 null 과 다르다 —
  // "이 방향을 운행하지 않는다"(null)와 "값을 안 넘겼다"(undefined)를 구분하지 않으면
  // undefined 가 그대로 운행편 id 로 취급돼 엉뚱한 그룹이 생긴다.
  const badTrip = buses.filter(
    (b) => b.up_trip_id === undefined || b.down_trip_id === undefined
  );
  if (badTrip.length > 0) {
    throw new Error(
      `운행편 id 누락: ${badTrip
        .map((b) => b.name ?? b.id)
        .join(", ")} — up_trip_id / down_trip_id 는 number 또는 null 이어야 합니다 ` +
        `(null = 그 방향을 운행하지 않음). undefined 는 허용하지 않습니다.`
    );
  }
}

function groupByCampus(passengers: Passenger[]): Map<string, Passenger[]> {
  const m = new Map<string, Passenger[]>();
  for (const p of passengers) {
    const b = m.get(p.campus);
    if (b) b.push(p);
    else m.set(p.campus, [p]);
  }
  return m;
}

/** 인원 큰 캠퍼스 우선 [campus, members][]. */
function campusesBySizeDesc(group: Passenger[]): Passenger[][] {
  return [...groupByCampus(group).values()].sort((a, b) => b.length - a.length);
}

/**
 * 순차 채움 — 캠퍼스 큰 순으로 호차를 정원(44)까지 차례로 채운다.
 * 분할 조각이 1명이 되지 않도록 보정. 정원 초과분은 보조석(45) → 미배정.
 *
 * @param buses count 가 미리 채워진(고정배정 반영) 작업 호차들, 호차순.
 */
function fillBuses(
  label: string,
  group: Passenger[],
  buses: BusWork[],
  assign: (id: string, busId: number) => void,
  errors: string[],
  driverCampusByBus?: Map<number, string>
): void {
  if (group.length === 0) return;
  if (buses.length === 0) {
    errors.push(`${label} 호차 없음: ${group.length}명 미배정`);
    return;
  }

  let pool = group;

  // ⓪ 차량순장 캠퍼스 우선 — 순장 있는 호차에 같은 캠퍼스를 정원(capacity)까지 먼저.
  //    넘치는 인원·남는 좌석은 아래 일반 배차가 그대로 처리(미배정·빈좌석·1명조각 정책 유지).
  if (driverCampusByBus && driverCampusByBus.size > 0) {
    const taken = new Set<string>();
    for (const b of buses) {
      const campus = driverCampusByBus.get(b.id);
      if (campus === undefined) continue;
      const same = pool.filter((p) => p.campus === campus && !taken.has(p.id));
      let take = Math.min(b.capacity - b.count, same.length);
      if (same.length - take === 1 && take > 1) take--; // 흘리는 조각이 1명 되지 않게
      for (const m of same.slice(0, take)) {
        assign(m.id, b.id);
        b.count++;
        taken.add(m.id);
      }
    }
    if (taken.size > 0) pool = pool.filter((p) => !taken.has(p.id));
  }

  const campuses = campusesBySizeDesc(pool);
  let unassigned = 0;

  for (const members of campuses) {
    let q = members;

    // ① 통째로 들어가는 호차 중 잔여 최소(best-fit) — 분할·빈자리 동시 최소화.
    //    동률이면 fill_priority 가 큰 호차를 뒤로 → 짐차 빈자리 최대(후순위).
    const whole = buses
      .filter((b) => b.capacity - b.count >= q.length)
      .sort(
        (a, b) =>
          fillLastRank(a) - fillLastRank(b) ||
          a.capacity - a.count - (b.capacity - b.count)
      )[0];
    if (whole) {
      for (const m of q) {
        assign(m.id, whole.id);
        whole.count++;
      }
      continue;
    }

    // ② 통째로 못 들어감 → 잔여 큰 호차부터 분할 (조각 최소, 1명 조각 방지).
    //    fill_priority 가 큰 호차는 뒤로 밀어 일반 호차부터 채운다.
    while (q.length > 0) {
      const b = buses
        .filter((x) => x.count < x.capacity)
        .sort(
          (a, b2) =>
            fillLastRank(a) - fillLastRank(b2) ||
            b2.capacity - b2.count - (a.capacity - a.count)
        )[0];
      if (!b) break;
      let take = Math.min(b.capacity - b.count, q.length);
      if (q.length - take === 1 && take > 1) take--; // 흘리는 조각이 1명 되지 않게
      for (const m of q.slice(0, take)) {
        assign(m.id, b.id);
        b.count++;
      }
      q = q.slice(take);
    }

    // ③ 정원(44) 다 참 → 보조석(hard_cap)까지, 잔여 큰 호차부터 (짐차는 후순위)
    while (q.length > 0) {
      const b = buses
        .filter((x) => x.count < x.hard_cap)
        .sort(
          (a, b2) =>
            fillLastRank(a) - fillLastRank(b2) ||
            b2.hard_cap - b2.count - (a.hard_cap - a.count)
        )[0];
      if (!b) break;
      assign(q[0].id, b.id);
      b.count++;
      q = q.slice(1);
    }

    unassigned += q.length;
  }

  if (unassigned > 0) {
    errors.push(`미배정: ${label} ${unassigned}명 (좌석 부족 — 호차 증편 필요)`);
  }
}

/**
 * 배차 실행.
 * @param mode "up" 상행만 / "down" 하행만 / "both" 둘 다 (기본).
 */
export function runBatch(
  passengers: Passenger[],
  buses: Bus[],
  mode: BatchMode = "both"
): BatchResult {
  assertBusFlags(buses);

  const assignments = new Map<string, Assignment>();
  for (const p of passengers) {
    assignments.set(p.id, { up_bus_id: null, down_bus_id: null });
  }
  const byId = new Map(passengers.map((p) => [p.id, p]));
  const errors: string[] = [];

  const assignUp = (id: string, busId: number) => {
    const a = assignments.get(id);
    if (a) a.up_bus_id = busId;
  };
  const assignDown = (id: string, busId: number) => {
    const a = assignments.get(id);
    if (a) a.down_bus_id = busId;
  };

  const runUp = mode === "up" || mode === "both";
  const runDown = mode === "down" || mode === "both";

  // ════════════════════ 상행 (UP) ════════════════════
  if (runUp) {
    const upBuses: BusWork[] = buses.map((b) => ({ ...b, count: 0 }));
    const pinned = new Set<string>();

    // Step 1. 고정 배정 (driver + fixed) — 그 호차에 둘 뿐 캠퍼스 안 끎.
    for (const bus of upBuses) {
      const ids = [
        ...(bus.driver_registration_id ? [bus.driver_registration_id] : []),
        ...(bus.fixed_passenger_ids ?? []),
      ];
      for (const rid of [...new Set(ids)]) {
        if (pinned.has(rid)) {
          // 같은 사람이 다른 호차에도 고정됨 → 첫 호차 유지, 경고
          errors.push(
            `상행 고정 중복: 같은 인원이 여러 호차에 지정됨 (${byId.get(rid)?.name ?? rid})`
          );
          continue;
        }
        const reg = byId.get(rid);
        if (!reg || reg.up_trip_id === null) continue;
        if (bus.up_trip_id === null) {
          errors.push(`${bus.name}는 상행을 운행하지 않는데 고정 배정됨: ${reg.name}`);
          continue;
        }
        if (reg.up_trip_id !== bus.up_trip_id) {
          errors.push(
            `고정 배정 편 불일치: ${reg.name} (편 ${reg.up_trip_id} → ${bus.name})`
          );
          continue;
        }
        if (bus.count >= bus.hard_cap) {
          errors.push(`${bus.name} 정원 초과로 고정 배정 실패: ${reg.name}`);
          continue;
        }
        assignUp(rid, bus.id);
        bus.count++;
        pinned.add(rid);
      }
    }

    // Step 2. 편별로 채움. 운행 편 = buses 에 존재하는 distinct up_trip_id.
    //   (요일 enum 하드코딩 제거 → 슬롯 추가는 buses 행 추가만으로 자동 반영)
    const upParticipants = passengers.filter(
      (p) => p.up_trip_id !== null && !pinned.has(p.id)
    );
    // 차량순장 캠퍼스 우선용: 호차 id → 상행 순장의 캠퍼스. (응집 면제 호차 제외)
    const upDriverCampus = new Map<number, string>();
    for (const b of buses) {
      if (b.is_cohesion_exempt) continue;
      if (b.driver_registration_id) {
        const d = byId.get(b.driver_registration_id);
        if (d) upDriverCampus.set(b.id, d.campus);
      }
    }
    const slots = [
      ...new Set(
        upBuses.map((b) => b.up_trip_id).filter((id): id is number => id !== null)
      ),
    ];
    for (const slotId of slots) {
      const slotBuses = upBuses.filter((b) => b.up_trip_id === slotId);
      const grp = upParticipants.filter((p) => p.up_trip_id === slotId);
      fillBuses(`slot ${slotId}`, grp, slotBuses, assignUp, errors, upDriverCampus);
    }

    // 운행 호차가 없는 슬롯의 신청자는 배정 불가 — 조용히 누락하지 않고 표면화.
    const orphan = upParticipants.filter(
      (p) => !slots.includes(p.up_trip_id as number)
    );
    if (orphan.length > 0) {
      errors.push(
        `미배정: 운행 호차 없는 상행 슬롯 ${orphan.length}명 (호차 배정 필요)`
      );
    }
  }

  // ════════════════════ 하행 (DOWN) — 독립 ════════════════════
  if (runDown) {
    // 하행 운행 차량만 대상. 상행 호차 상속 X.
    //
    // 예전엔 "하행은 전 호차 운행"이 코드에 박힌 가정이었다. 이제 차량마다
    // down_trip_id 를 가지므로 "이 차량은 하행을 운행하지 않는다"(NULL)를 표현할 수 있다.
    // 현재 데이터는 전 차량이 하행 편을 갖고 있어 동작은 그대로다.
    //
    // 신청도 down_trip_id 를 갖게 되면서(3-C) 하행도 상행과 **같은 편별 그룹 배차**를 한다.
    // 아래 Step 2 가 상행의 편 루프와 문자 그대로 같은 모양이다 — "용어만 하행으로 바뀔 뿐".
    const downBuses: BusWork[] = buses
      .filter((b) => b.down_trip_id !== null)
      .map((b) => ({ ...b, count: 0 }));
    const pinnedDown = new Set<string>();

    // Step 1. 하행 고정 배정 (down 차량순장 + down 고정탑승). 하행은 요일 제약 없음.
    for (const bus of downBuses) {
      const ids = [
        ...(bus.down_driver_registration_id
          ? [bus.down_driver_registration_id]
          : []),
        ...(bus.down_fixed_passenger_ids ?? []),
      ];
      for (const rid of [...new Set(ids)]) {
        if (pinnedDown.has(rid)) {
          errors.push(
            `하행 고정 중복: 같은 인원이 여러 호차에 지정됨 (${byId.get(rid)?.name ?? rid})`
          );
          continue;
        }
        const reg = byId.get(rid);
        if (!reg || reg.down_trip_id === null) continue; // 하행 미이용자는 고정 불가
        // 상행과 대칭: 신청한 편과 다른 편을 운행하는 차량에는 고정할 수 없다.
        // 예전엔 "하행은 전 호차 운행"이라 이 검사가 아예 없었다.
        if (bus.down_trip_id === null) {
          errors.push(`${bus.name}는 하행을 운행하지 않는데 고정 배정됨: ${reg.name}`);
          continue;
        }
        if (reg.down_trip_id !== bus.down_trip_id) {
          errors.push(
            `하행 고정 배정 편 불일치: ${reg.name} (편 ${reg.down_trip_id} → ${bus.name})`
          );
          continue;
        }
        if (bus.count >= bus.hard_cap) {
          errors.push(`${bus.name} 정원 초과로 하행 고정 배정 실패: ${reg.name}`);
          continue;
        }
        assignDown(rid, bus.id);
        bus.count++;
        pinnedDown.add(rid);
      }
    }

    // Step 2. 편별로 채움 — 상행 Step 2 와 같은 구조.
    const downParticipants = passengers.filter(
      (p) => p.down_trip_id !== null && !pinnedDown.has(p.id)
    );
    // 차량순장 캠퍼스 우선용: 호차 id → 하행 순장의 캠퍼스. (응집 면제 호차 제외)
    const downDriverCampus = new Map<number, string>();
    for (const b of buses) {
      if (b.is_cohesion_exempt) continue;
      if (b.down_driver_registration_id) {
        const d = byId.get(b.down_driver_registration_id);
        if (d) downDriverCampus.set(b.id, d.campus);
      }
    }
    // 상행과 같은 편별 루프. 하행 편이 하나뿐이면 이 루프는 1회 돌고, 결과는
    // 예전의 "전 호차 대상 1회 호출"과 동일하다 — 골든 스냅샷이 그걸 고정한다.
    const downTrips = [
      ...new Set(
        downBuses.map((b) => b.down_trip_id).filter((id): id is number => id !== null)
      ),
    ];
    for (const tripId of downTrips) {
      const tripBuses = downBuses.filter((b) => b.down_trip_id === tripId);
      const grp = downParticipants.filter((p) => p.down_trip_id === tripId);
      fillBuses(`하행 편 ${tripId}`, grp, tripBuses, assignDown, errors, downDriverCampus);
    }

    // 운행 차량이 없는 하행 편의 신청자 — 조용히 누락하지 않고 표면화(상행과 대칭).
    const downOrphan = downParticipants.filter(
      (p) => !downTrips.includes(p.down_trip_id as number)
    );
    if (downOrphan.length > 0) {
      errors.push(
        `미배정: 운행 호차 없는 하행 편 ${downOrphan.length}명 (호차 배정 필요)`
      );
    }
  }

  // ════════════════════ 집계 ════════════════════
  // 리포팅(by_bus·total_assigned·empty_seats) 기준 방향:
  //   하행 단독 실행이면 하행, 그 외(상행 단독·both)는 상행.
  //   (하행만 돌렸을 때 up_bus_id 가 전부 null 이라 "배정 0명"으로 잘못 표시되던 버그 수정.)
  //   up_assignments·down_assignments 맵은 호출부의 DB 반영용이라 방향 무관하게 항상 채운다.
  const reportDown = runDown && !runUp;
  const byBus: Record<number, number> = {};
  const upAssignments: Record<string, number> = {};
  const downAssignments: Record<string, number> = {};
  let totalAssigned = 0;

  for (const [id, a] of assignments) {
    if (a.up_bus_id !== null) upAssignments[id] = a.up_bus_id;
    if (a.down_bus_id !== null) downAssignments[id] = a.down_bus_id;
    const busId = reportDown ? a.down_bus_id : a.up_bus_id;
    if (busId !== null) {
      byBus[busId] = (byBus[busId] ?? 0) + 1;
      totalAssigned += 1;
    }
  }

  // 리포팅 방향 기준 빈 좌석 (보조석으로 정원 초과 시 음수가 되지 않게 0 클램프)
  const emptySeats = buses.reduce(
    (sum, b) => sum + Math.max(0, b.capacity - (byBus[b.id] ?? 0)),
    0
  );

  return {
    total_assigned: totalAssigned,
    by_bus: byBus,
    empty_seats: emptySeats,
    errors,
    up_assignments: upAssignments,
    down_assignments: downAssignments,
  };
}
