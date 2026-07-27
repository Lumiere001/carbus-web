/**
 * 주소창에서 "지금 보고 있는 행사"를 읽는다 (Phase 4-5, HANDOFF §8-C).
 *
 * 설계의 핵심 문장: **주소창을 진실로 삼고, 헤더는 대조용으로만 쓴다.**
 *   - 무엇을 보는지는 URL 이 정한다 → 사람마다 다른 행사를 볼 수 있다.
 *     (예전엔 DB 전역 스위치 하나라, master 가 과거를 열면 임역원 화면도 같이 갔다)
 *   - 브라우저는 그 값을 `x-carbus-event` 헤더로 한 번 더 선언하고, DB 가
 *     페이로드의 event_id 와 대조한다. 헤더는 **권한을 주는 채널이 아니라 의도를
 *     재확인하는 채널**이다 — 헤더가 없어도 시스템은 URL 기반 원안대로 동작한다.
 *     최악의 경우가 "방어가 한 겹 준다"이지 "엉뚱한 행사에 쓰인다"가 아니다.
 */

/** 관리자 화면의 행사 경로. `/admin/e/<uuid>/...` */
const ADMIN_EVENT_PATH = /^\/admin\/e\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** 경로에서 행사 id 를 뽑는다. 행사 경로가 아니면 null. */
export function eventIdFromPath(pathname: string): string | null {
  const m = ADMIN_EVENT_PATH.exec(pathname);
  return m ? m[1].toLowerCase() : null;
}

/** `/admin/e/<id>` 뒤에 붙일 경로를 만든다. `adminHref(id, "/buses")` → `/admin/e/<id>/buses` */
export function adminHref(eventId: string, sub: string = ""): string {
  const tail = sub && !sub.startsWith("/") ? `/${sub}` : sub;
  return `/admin/e/${eventId}${tail}`;
}

/**
 * 옛 주소(`/admin/buses`)를 새 주소로 옮길 때 쓸 꼬리 경로.
 * 북마크·기존 링크가 죽지 않게 리다이렉트에 쓴다.
 */
export function legacyAdminTail(pathname: string): string {
  return pathname.replace(/^\/admin/, "") || "";
}

/** 요청 헤더 이름 — 미들웨어가 심고, 서버 클라이언트가 Supabase 로 넘긴다. */
export const EVENT_HEADER = "x-carbus-event";
