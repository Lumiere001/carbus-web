import { headers } from "next/headers";
import { EVENT_HEADER } from "@/lib/events/route";

/**
 * 서버(Server Component·Server Action)에서 "지금 보는 행사".
 *
 * 서버는 주소창을 직접 못 본다. 미들웨어가 URL 에서 뽑아 요청 헤더에 심어두고,
 * 여기서 그걸 읽는다. 클라이언트 쪽 짝은 `lib/events/current.ts` 의 currentEventId.
 *
 * ⚠️ `next/headers` 는 서버 전용이라 이 파일을 클라이언트 모듈에서 import 하면 안 된다.
 *    그래서 클라이언트용과 파일을 나눠 뒀다.
 */
export async function viewingEventId(): Promise<string | null> {
  return (await headers()).get(EVENT_HEADER);
}
