"use client";

import { useRouter, usePathname } from "next/navigation";
import { adminHref } from "@/lib/events/route";

type EventOpt = { id: string; name: string; isLive: boolean };

/**
 * 보는 행사 전환 (Phase 4-5).
 *
 * 전역 스위치가 아니라 **주소창만** 바꾼다. 그래서 다른 사람 화면은 그대로다.
 * 예전 `/admin/control` 의 "이 행사로 전환"은 DB 의 활성 행사를 바꿔서,
 * master 가 과거를 열어보면 임역원 화면까지 같이 과거로 갔다.
 */
export function EventSwitcher({
  current,
  events,
}: {
  current: { id: string; name: string };
  events: EventOpt[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  // 지금 보고 있는 하위 경로를 유지한 채 행사만 바꾼다.
  // (`/admin/e/<A>/payments` 에서 고르면 `/admin/e/<B>/payments` 로)
  const sub = pathname.replace(/^\/admin\/e\/[^/]+/, "");

  if (events.length <= 1) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-md bg-primary-700/70 text-primary-100 whitespace-nowrap shrink-0 max-w-[14rem] truncate">
        {current.name}
      </span>
    );
  }

  return (
    <select
      value={current.id}
      onChange={(e) => router.push(adminHref(e.target.value, sub))}
      aria-label="보는 행사 바꾸기"
      className="text-xs px-2 py-1 rounded-md bg-primary-700 text-primary-100 border border-primary-600 max-w-[14rem] shrink-0"
    >
      {events.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
          {e.isLive ? " (진행 중)" : ""}
        </option>
      ))}
    </select>
  );
}
