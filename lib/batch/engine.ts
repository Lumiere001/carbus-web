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
 * 알고리즘 (FFD — First-Fit Decreasing, 캠퍼스 단위):
 *   캠퍼스 큰 순으로, 각 캠퍼스를
 *     ① 통째로 들어가는 호차 중 잔여 최소(best-fit)에 배정 — 분할·빈자리 동시 최소화.
 *     ② 어느 호차에도 통째로 못 들어가면(캠퍼스 > 호차 잔여) 잔여 큰 호차부터 분할
 *        (조각 최소, 1명 조각 방지).
 *     ③ 정원(44) 다 차면 보조석(45)까지 → 그래도 넘치면 미배정.
 *   순차 채움(next-fit) 대비 작은 캠퍼스의 불필요한 분할을 없애면서 빈좌석은
 *   동일하게 유지한다(파레토 개선). 순수 함수.
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
  let unassigned = 0;

  for (const members of campuses) {
    let q = members;

    // ① 통째로 들어가는 호차 중 잔여 최소(best-fit) — 분할·빈자리 동시 최소화
    const whole = buses
      .filter((b) => b.capacity - b.count >= q.length)
      .sort((a, b) => a.capacity - a.count - (b.capacity - b.count))[0];
    if (whole) {
      for (const m of q) {
        assign(m.id, whole.id);
        whole.count++;
      }
      continue;
    }

    // ② 통째로 못 들어감 → 잔여 큰 호차부터 분할 (조각 최소, 1명 조각 방지)
    while (q.length > 0) {
      const b = buses
        .filter((x) => x.count < x.capacity)
        .sort((a, b2) => b2.capacity - b2.count - (a.capacity - a.count))[0];
      if (!b) break;
      let take = Math.min(b.capacity - b.count, q.length);
      if (q.length - take === 1 && take > 1) take--; // 흘리는 조각이 1명 되지 않게
      for (const m of q.slice(0, take)) {
        assign(m.id, b.id);
        b.count++;
      }
      q = q.slice(take);
    }

    // ③ 정원(44) 다 참 → 보조석(hard_cap)까지, 잔여 큰 호차부터
    while (q.length > 0) {
      const b = buses
        .filter((x) => x.count < x.hard_cap)
        .sort((a, b2) => b2.hard_cap - b2.count - (a.hard_cap - a.count))[0];
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
    const pinnedDown = new Set<string>();

    // Step 1. 하행 고정 배정 (down 차량순장 + down 고정탑승). 하행은 요일 제약 없음.
    for (const bus of downBuses) {
      const ids = [
        ...(bus.down_driver_registration_id
          ? [bus.down_driver_registration_id]
          : []),
        ...bus.down_fixed_passenger_ids,
      ];
      for (const rid of [...new Set(ids)]) {
        if (pinnedDown.has(rid)) continue;
        const reg = byId.get(rid);
        if (!reg || reg.uses_return_bus !== true) continue; // 하행 미이용자는 고정 불가
        assignDown(rid, bus.id);
        bus.count++;
        pinnedDown.add(rid);
      }
    }

    // Step 2. 나머지 하행 이용자만 채움 (고정자 제외).
    const downParticipants = passengers.filter(
      (p) => p.uses_return_bus === true && !pinnedDown.has(p.id)
    );
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
