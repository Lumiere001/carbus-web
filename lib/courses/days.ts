/**
 * 수강신청의 "몇째 날" 계산 — **순수 함수**다.
 *
 * ⚠️ 이 파일에 `"use client"` 를 붙이지 마라. 서버 컴포넌트(목록 페이지)가
 * `eventDayCount` 를 부르고, 클라이언트 컴포넌트(서랍·보드)가 `dayLabel` 을 부른다.
 * 클라이언트 모듈에 두면 서버 쪽에서 **"클라이언트 함수를 서버에서 호출했다"** 로
 * 화면이 통째로 죽는다(실제로 그렇게 죽었다). 저장 동작은 `lib/admin/courses.ts` 에 있다.
 */

/**
 * 이 행사에서 고를 수 있는 날 수.
 *
 * 행사 기간에서 계산한다 — 캠프는 3일이라 셋째날까지, 4박 행사면 넷째날이 저절로
 * 생긴다. 날짜를 못 구하면 3일로 본다(동규님이 말한 첫째~셋째날).
 */
export function eventDayCount(
  startsOn: string | null,
  endsOn: string | null
): number {
  if (!startsOn || !endsOn) return 3;
  const a = new Date(`${startsOn}T00:00:00Z`).getTime();
  const b = new Date(`${endsOn}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 3;
  const days = Math.round((b - a) / 86_400_000) + 1;
  // 상한은 DB CHECK 와 같게. 날짜가 잘못 들어가 있어도 화면이 100개 줄을 그리지 않는다.
  return Math.min(Math.max(days, 1), 14);
}

/** `1 → 첫째날`. 다섯째날부터는 숫자로 — 우리말 서수가 그 뒤로는 어색해진다. */
export function dayLabel(dayNo: number): string {
  const names = ["첫째날", "둘째날", "셋째날", "넷째날"];
  return names[dayNo - 1] ?? `${dayNo}일차`;
}
