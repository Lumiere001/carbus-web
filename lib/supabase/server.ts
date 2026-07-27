import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { EVENT_HEADER } from "@/lib/events/route";
import type { Database } from "./database.types";

/**
 * Server Component·Server Action 에서 사용하는 Supabase 클라이언트.
 * cookies()는 next/headers — 요청 컨텍스트 내에서만 호출 가능.
 */
export async function createClient() {
  const cookieStore = await cookies();
  // 미들웨어가 주소창에서 뽑아 심어둔 "지금 보는 행사". DB 가 열람·쓰기 대조에 쓴다.
  // 미들웨어를 안 타는 경로(정적 자산 등)에서는 없을 수 있다 — 없으면 안 보낸다.
  const viewingEventId = (await headers()).get(EVENT_HEADER);

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(viewingEventId
        ? { global: { headers: { [EVENT_HEADER]: viewingEventId } } }
        : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component에서 호출되면 cookie set 불가 — middleware가 처리
          }
        },
      },
    }
  );
}

/**
 * service_role key로 만든 admin 클라이언트 (RLS 우회).
 * 절대 클라이언트로 import 하지 말 것. 환경변수 보호 필수.
 */
export function createAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 미설정");
  }
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          /* admin client는 cookie 미사용 */
        },
      },
    }
  );
}
