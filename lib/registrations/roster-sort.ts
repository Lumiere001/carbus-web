/**
 * 호차 명단(roster) 정렬 — 작년 차량편성표 관행 + 사용자 요청(학번 정렬).
 *
 * 정렬 규칙:
 *   1. 캠퍼스 묶음 — 같은 캠퍼스끼리 모은다. 인원 많은 캠퍼스가 위.
 *   2. 캠퍼스 내부 — **학번 오름차순**(낮은 학번=고학번 선배가 위, 20 → 25).
 *   3. 학번 특수값('외국인'·'타지구')은 숫자 뒤로.
 *   4. 동일 학번은 이름 가나다순.
 *
 * 배차 결과(어느 호차)는 바꾸지 않는다. 표시 순서만 정렬한다.
 */

export interface RosterMember {
  name: string;
  /** 학번: 두 자리 숫자 문자열 또는 '외국인'·'타지구'. */
  student_id: string;
  /** 캠퍼스명. 없으면(단일 캠퍼스 화면 등) 학번·이름 순으로만 정렬. */
  campus_name?: string;
}

/** 학번 정렬 키. 두 자리 숫자는 그 값, 특수값은 큰 수(뒤로 보냄). */
function studentIdKey(sid: string): number {
  return /^\d{2}$/.test(sid) ? Number(sid) : 999;
}

/**
 * 명단을 캠퍼스 묶음(인원 많은 순) → 학번 오름차순 → 이름순으로 정렬.
 * 원본을 건드리지 않고 새 배열을 반환한다.
 */
export function sortRoster<T extends RosterMember>(members: T[]): T[] {
  const size = new Map<string, number>();
  for (const m of members) {
    const c = m.campus_name ?? "";
    size.set(c, (size.get(c) ?? 0) + 1);
  }
  return [...members].sort((a, b) => {
    const ca = a.campus_name ?? "";
    const cb = b.campus_name ?? "";
    if (ca !== cb) {
      const diff = (size.get(cb) ?? 0) - (size.get(ca) ?? 0);
      if (diff !== 0) return diff; // 인원 많은 캠퍼스 먼저
      return ca < cb ? -1 : 1; // 동수면 이름순 안정화
    }
    const ka = studentIdKey(a.student_id);
    const kb = studentIdKey(b.student_id);
    if (ka !== kb) return ka - kb; // 학번 오름차순
    if (a.student_id !== b.student_id) return a.student_id < b.student_id ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; // 이름 가나다순
  });
}
