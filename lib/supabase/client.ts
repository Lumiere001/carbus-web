"use client";

import { createBrowserClient } from "@supabase/ssr";
import { EVENT_HEADER, eventIdFromPath } from "@/lib/events/route";
import type { Database } from "./database.types";

/**
 * 브라우저용 Supabase 클라이언트.
 *
 * 주소창의 행사 id 를 `x-carbus-event` 로 함께 보낸다 (Phase 4-5). 서버 쪽은
 * 미들웨어가 같은 값을 심으므로, 화면·요청·DB 가 같은 행사를 말하게 된다.
 * ⚠️ 이 헤더는 권한을 주지 않는다 — 위조해도 RLS·트리거가 막는다(§8-C).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch(input, init) {
          const headers = new Headers(input instanceof Request ? input.headers : undefined);
          new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
          const viewingEventId =
            typeof window === "undefined" ? null : eventIdFromPath(window.location.pathname);
          if (viewingEventId) headers.set(EVENT_HEADER, viewingEventId);
          else headers.delete(EVENT_HEADER);
          return fetch(input, { ...init, headers });
        },
      },
    }
  );
}
