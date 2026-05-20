import type { RegistrationRow } from "@/lib/registrations/mutations";

/**
 * 명단 표 뷰 공용 정렬 (사용자 결정 2026-05-20):
 * 입력 순서와 무관하게 **충돌 → 미납 → 면제 → 완납** 순으로 묶어서 표시.
 * 같은 그룹 안에서는 입력 순서(created_at 오름차순) 유지.
 *
 * "충돌"은 낙관적 락 충돌이 발생해 잠깐 강조 중인 행(conflictRowIds).
 * 운영자가 즉시 조치해야 하므로 최상단으로 올린다.
 */
const PAYMENT_RANK: Record<string, number> = {
  unpaid: 1, // 미납
  waived: 2, // 면제
  paid: 3, // 완납
};

function rowRank(row: RegistrationRow, conflictRowIds: Set<string>): number {
  if (conflictRowIds.has(row.id)) return 0; // 충돌 최우선
  return PAYMENT_RANK[row.payment_status] ?? 9;
}

/** 원본 배열을 건드리지 않고 정렬된 새 배열 반환. */
export function sortRegistrations(
  rows: RegistrationRow[],
  conflictRowIds: Set<string> = new Set()
): RegistrationRow[] {
  return [...rows].sort((a, b) => {
    const ra = rowRank(a, conflictRowIds);
    const rb = rowRank(b, conflictRowIds);
    if (ra !== rb) return ra - rb;
    // 같은 그룹: 입력 순서 (created_at 오름차순). 없으면 0.
    const ta = a.created_at ?? "";
    const tb = b.created_at ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return 0;
  });
}

/** `${id}:${field}` 형식의 conflictCells Set → 충돌 행 id Set. */
export function conflictRowIdsOf(conflictCells: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const key of conflictCells) {
    const id = key.split(":")[0];
    if (id) ids.add(id);
  }
  return ids;
}
