import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { signOut } from "@/app/logout/actions";
import { adminHref } from "@/lib/events/route";
import { EventSwitcher } from "@/components/admin/event-switcher";

/**
 * 행사 범위 관리자 화면 (Phase 4-5).
 *
 * 주소창의 `<eventId>` 가 "지금 보는 행사"다. 미들웨어가 같은 값을 `x-carbus-event`
 * 헤더로 심어 DB 까지 전달한다. 사람마다 다른 행사를 볼 수 있다는 게 폴더화의 핵심 —
 * 예전엔 DB 전역 스위치 하나라 master 가 과거를 열면 **모든 사용자 화면이 같이** 갔다.
 */
export default async function AdminEventLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createClient();

  const [{ data: { user } }, { data: events }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("events")
      .select("id, name, is_active, write_mode, unlock_until, starts_on")
      .order("starts_on", { ascending: false }),
  ]);

  const current = (events ?? []).find((e) => e.id === eventId);
  // 없는 행사를 주소창에 치면 404 — 조용히 다른 행사를 보여주면 그게 더 위험하다.
  if (!current) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<{ role: UserRole }>();
  const role: UserRole = profile?.role ?? "guest";
  const isMaster = role === "master";

  // 이 행사에 지금 쓸 수 있는가 — 읽기 전용이면 화면에 못을 박아둔다.
  const unlocked =
    current.unlock_until != null && new Date(current.unlock_until) > new Date();
  const writable = current.write_mode === "live" || unlocked;

  const navLink = "text-sm text-primary-200 hover:text-white transition shrink-0";
  const href = (sub: string) => adminHref(eventId, sub);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary-900 text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3 w-full md:w-auto min-w-0">
            <h1 className="font-semibold flex items-center gap-2 whitespace-nowrap shrink-0">
              운영자
              <span
                className={
                  "text-xs px-2 py-0.5 rounded-md " +
                  (isMaster
                    ? "bg-danger/25 text-danger-border"
                    : "bg-primary-700 text-primary-200")
                }
              >
                {role}
              </span>
            </h1>

            <EventSwitcher
              current={{ id: current.id, name: current.name }}
              events={(events ?? []).map((e) => ({
                id: e.id,
                name: e.name,
                isLive: e.write_mode === "live",
              }))}
            />

            <nav className="flex gap-3.5 w-full md:w-auto overflow-x-auto whitespace-nowrap pb-1 md:pb-0 md:flex-wrap md:overflow-visible">
              <a href={href("")} className={navLink}>대시보드</a>
              <a href={href("/registrations")} className={navLink}>전체 순장/순원</a>
              <a href={href("/buses")} className={navLink}>호차</a>
              <a href={href("/attendance")} className={navLink}>출석</a>
              {isMaster && (
                <>
                  <a href={href("/trips")} className={navLink}>편성</a>
                  <a href={href("/batch")} className={navLink}>배차</a>
                </>
              )}
              <a href={href("/leaders")} className={navLink}>리더</a>
              <a href={href("/partial")} className={navLink}>부분참</a>
              <a href={href("/transport")} className={navLink}>이동수단</a>
              <a href={href("/payments")} className={navLink}>정산</a>
              {isMaster && (
                <>
                  <a href={href("/control")} className={navLink}>Phase</a>
                  <a href={href("/users")} className={navLink}>사용자</a>
                  <a href={href("/roles")} className={navLink}>역할 라벨</a>
                </>
              )}
              <a href={href("/changes")} className={navLink}>변동</a>
              <a href={href("/errors")} className={navLink}>오류</a>
              <a href={href("/logs")} className={navLink}>로그</a>
            </nav>
          </div>
          <form action={signOut} className="shrink-0">
            <button
              type="submit"
              className="text-sm text-primary-300 hover:text-white transition whitespace-nowrap"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>

      {/* 읽기 전용 행사를 보고 있다는 사실은 화면에 계속 붙어 있어야 한다.
          이게 없으면 "왜 저장이 안 되지"가 된다. */}
      {!writable && (
        <div className="bg-warning-bg border-b border-warning-border">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 text-sm text-warning">
            <b>지난 행사</b>를 보고 있습니다 — 읽기 전용입니다. 고쳐야 하면 Phase 화면에서
            사유를 적고 잠금을 여세요.
          </div>
        </div>
      )}
      {writable && unlocked && (
        <div className="bg-danger-bg border-b border-danger-border">
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 text-sm text-danger">
            <b>지난 행사의 잠금이 열려 있습니다.</b> 수정 내용이 이 지난 행사에 저장됩니다.
            시간이 지나면 자동으로 다시 잠깁니다.
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto p-4 md:p-6">{children}</div>
    </div>
  );
}
