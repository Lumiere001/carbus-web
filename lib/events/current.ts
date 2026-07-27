import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * 지금 **쓰기가 허용된** 행사 id.
 *
 * 왜 이게 필요한가 (Phase 4-3, HANDOFF §8-F):
 *   지금까지 앱은 event_id 를 한 번도 안 보냈다. 8개 테이블의 컬럼 DEFAULT
 *   (`active_event_id()`)가 조용히 채워줬기 때문이다. 그 설계 덕분에 Phase 1 에서
 *   INSERT 문을 한 줄도 안 고치고 행사 개념을 넣을 수 있었지만, 폴더화에서는
 *   그게 정확히 위험이 된다 — **화면은 과거 행사를 보는데 저장은 진행 중 행사로
 *   조용히 성공**하는 오배치가 에러 없이 생긴다.
 *
 *   그래서 DEFAULT 를 제거하기 전에(4-4) 앱이 먼저 명시하게 만든다. 지금은
 *   `writable_event_id()` 가 `active_event_id()` 와 같은 값을 내므로 **동작이
 *   하나도 안 바뀐다** — 그게 이 단계를 무위험으로 검증할 수 있는 이유다.
 *
 * ⚠️ "보는 행사"가 아니라 "쓰는 행사"다. 4-5 에서 주소창의 eventId 가 생겨도
 *    쓰기 대상은 여전히 이 값이어야 한다. 둘이 어긋나면 DB 가 거부한다(4-4 가드).
 */
export async function writableEventId(
  supabase: Client
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("writable_event_id");
  if (error) return { ok: false, message: error.message };
  if (!data)
    return {
      ok: false,
      message:
        "지금 입력할 수 있는 행사가 없습니다. 운영자에게 행사 시작을 요청해 주세요.",
    };
  return { ok: true, id: data };
}
