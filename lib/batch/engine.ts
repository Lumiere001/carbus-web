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
 *   4. 혼자만 다른 캠퍼스 금지 — 분할 조각이 1명이 되지 않게.
 *   5. (상행만) 요일 분리 + 고정 배정(driver/fixed) 보존. 차량순장은 개별 배정.
 *
 * 알고리즘: 캠퍼스 큰 순으로 정렬해 연속으로 호차에 순차 채움(44).
 * 넘치면 보조석(45) → 그래도 넘치면 미배정. 순수 함수.
 */

import type {
  Assignment,
  BatchResult,
  Bus,
  DepartureDay,
  Passenger,
} from "./types";

export type BatchMode = "up" | "down" | "both";

/** 작업용 호차: count = 현재 배정 인원. */
interface BusWork extends Bus {
  count: number;
}

const DAYS: readonly DepartureDay[] = ["TUE", "WED"] as const;

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
  errors: string[]
): void {
  if (group.length === 0) return;
  if (buses.length === 0) {
    errors.push(`${label} 호차 없음: ${group.length}명 미배정`);
    return;
  }

  const campuses = campusesBySizeDesc(group);
  const overflow: Passenger[] = [];
  let bi = 0;

  for (const members of campuses) {
    let q = members;
    while (q.length > 0) {
      // 정원(44) 여유 있는 다음 호차로
      while (bi < buses.length && buses[bi].count >= buses[bi].capacity) bi++;
      if (bi >= buses.length) {
        overflow.push(...q);
        break;
      }
      const b = buses[bi];
      const rem = b.capacity - b.count;

      if (q.length <= rem) {
        for (const m of q) {
          assign(m.id, b.id);
          b.count++;
        }
        q = [];
        continue;
      }

      // 캠퍼스가 이 호차 잔여보다 큼 → 분할
      let take = rem;
      const spill = q.length - take;
      if (spill === 1 && take > 1) take--; // 흘리는 조각이 1명 되지 않게
      if (take <= 1 && b.count > 0) {
        // 이미 다른 캠퍼스가 탄 호차에 1명만 끼지 않도록 → 이 호차 건너뜀
        bi++;
        continue;
      }
      for (const m of q.slice(0, take)) {
        assign(m.id, b.id);
        b.count++;
      }
      q = q.slice(take);
      bi++; // 이 호차 가득 → 다음 호차
    }
  }

  // 정원(44) 초과분 → 보조석(45)까지
  let i = 0;
  for (; i < overflow.length; i++) {
    const b = buses
      .filter((x) => x.count < x.hard_cap)
      .sort((a, b2) => b2.hard_cap - b2.count - (a.hard_cap - a.count))[0];
    if (!b) break;
    assign(overflow[i].id, b.id);
    b.count++;
  }
  const unassigned = overflow.length - i;
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
        ...bus.fixed_passenger_ids,
      ];
      for (const rid of [...new Set(ids)]) {
        if (pinned.has(rid)) continue;
        const reg = byId.get(rid);
        if (!reg || reg.departure_day === null) continue;
        if (reg.departure_day !== bus.departure_day) {
          errors.push(
            `고정 배정 요일 불일치: ${reg.name} (${reg.departure_day} → ${bus.name})`
          );
          continue;
        }
        assignUp(rid, bus.id);
        bus.count++;
        pinned.add(rid);
      }
    }

    // Step 2. 요일별로 순차 채움
    const upParticipants = passengers.filter(
      (p) => p.departure_day !== null && !pinned.has(p.id)
    );
    for (const day of DAYS) {
      const dayBuses = upBuses.filter((b) => b.departure_day === day);
      const grp = upParticipants.filter((p) => p.departure_day === day);
      fillBuses(day, grp, dayBuses, assignUp, errors);
    }
  }

  // ════════════════════ 하행 (DOWN) — 독립 ════════════════════
  if (runDown) {
    // 토요일 9대 모두 운행. 상행 호차 상속 X.
    const downBuses: BusWork[] = buses.map((b) => ({ ...b, count: 0 }));
    const downParticipants = passengers.filter((p) => p.uses_return_bus === true);
    fillBuses("하행", downParticipants, downBuses, assignDown, errors);
  }

  // ════════════════════ 집계 ════════════════════
  const byBus: Record<number, number> = {};
  const upAssignments: Record<string, number> = {};
  const downAssignments: Record<string, number> = {};
  let totalAssigned = 0;

  for (const [id, a] of assignments) {
    if (a.up_bus_id !== null) {
      byBus[a.up_bus_id] = (byBus[a.up_bus_id] ?? 0) + 1;
      upAssignments[id] = a.up_bus_id;
      totalAssigned += 1;
    }
    if (a.down_bus_id !== null) {
      downAssignments[id] = a.down_bus_id;
    }
  }

  // 상행 기준 빈 좌석
  const emptySeats = buses.reduce(
    (sum, b) => sum + (b.capacity - (byBus[b.id] ?? 0)),
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
