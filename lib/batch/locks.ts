/**
 * 하행 배차 보존 잠금 (전체 순장/순원 페이지의 수동 배정 보호).
 *
 * 하행 배차를 다시 돌릴 때, 이미 `assigned_down_bus_id` 가 지정된 사람은 그 호차의
 * 하행 고정(down_fixed)으로 "잠가" 엔진이 그 자리에 그대로 두게 한다. 결과적으로
 * **미배정(null)인 하행 이용자만 새로 채워지고**, 기존 수동 배정은 건드리지 않는다.
 *
 * - 입력 buses 를 변형하지 않고 새 배열을 반환한다(순수 함수).
 * - 하행 미이용자(uses_return_bus !== true)는 무시.
 * - 이미 down 차량순장/고정인 사람은 중복 잠그지 않는다(엔진 '하행 고정 중복' 경고 방지).
 * - assigned_down_bus_id 가 실재하지 않는 호차를 가리키면 그 잠금은 조용히 버린다.
 */
import type { Bus } from "./types";

export type DownLockReg = {
  id: string;
  uses_return_bus: boolean;
  assigned_down_bus_id: number | null;
};

export function lockExistingDownAssignments(
  buses: Bus[],
  regs: DownLockReg[]
): Bus[] {
  // 이미 하행 리더(차량순장/고정)인 사람 — 중복 잠금 제외.
  const alreadyLeader = new Set<string>();
  for (const b of buses) {
    if (b.down_driver_registration_id) alreadyLeader.add(b.down_driver_registration_id);
    for (const id of b.down_fixed_passenger_ids ?? []) alreadyLeader.add(id);
  }

  const busIds = new Set(buses.map((b) => b.id));
  const lockByBus = new Map<number, string[]>();
  for (const r of regs) {
    if (r.uses_return_bus !== true) continue;
    if (r.assigned_down_bus_id == null) continue;
    if (!busIds.has(r.assigned_down_bus_id)) continue; // 사라진 호차 참조 방어
    if (alreadyLeader.has(r.id)) continue;
    const arr = lockByBus.get(r.assigned_down_bus_id) ?? [];
    arr.push(r.id);
    lockByBus.set(r.assigned_down_bus_id, arr);
  }

  if (lockByBus.size === 0) return buses;

  return buses.map((b) => {
    const extra = lockByBus.get(b.id);
    if (!extra || extra.length === 0) return b;
    const seen = new Set(b.down_fixed_passenger_ids ?? []);
    const merged = [...(b.down_fixed_passenger_ids ?? [])];
    for (const id of extra) if (!seen.has(id)) merged.push(id);
    return { ...b, down_fixed_passenger_ids: merged };
  });
}
