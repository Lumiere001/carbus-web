import { DraftNavigationProvider } from "@/components/ui/draft-navigation";
import { RefreshOnReturn } from "@/components/ui/refresh-on-return";
import { notFound } from "next/navigation";
import { adminHref } from "@/lib/events/route";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { signOut } from "@/app/logout/actions";
import { adminNavigation } from "@/lib/navigation";
import { WorkspaceNav } from "@/components/ui/workspace-nav";
import { DataLoadError } from "@/components/ui/data-load-error";
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

  const [{ data: { user } }, { data: events, error: eventsError }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("events")
      .select("id, name, is_active, write_mode, unlock_until, starts_on")
      .order("starts_on", { ascending: false }),
  ]);

  if (eventsError) return <DataLoadError retryHref={adminHref(eventId, "")} />;

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

  const groups = adminNavigation(eventId, isMaster);

  return (
    <DraftNavigationProvider><div className="min-h-[100dvh] bg-background">
      <a href="#workspace-content" className="skip-link">본문으로 건너뛰기</a>
      <header className="bg-primary-900 text-white">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3 w-full md:w-auto min-w-0">
            <h1 className="font-normal flex items-center gap-2 whitespace-nowrap shrink-0">
              Carbus · 차량 운영
              <span
                className={
                  "text-xs px-2 py-0.5 rounded-md " +
                  (isMaster
                    ? "bg-surface-2 text-foreground border border-border-2"
                    : "bg-surface-2 text-muted")
                }
              >
                {isMaster ? "총단" : "조회 담당자"}
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


          </div>
          <form action={signOut} className="shrink-0">
            <button
              type="submit"
              className="min-h-11 px-3 rounded-lg text-sm text-primary-200 hover:bg-surface-2 hover:text-foreground transition whitespace-nowrap"
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
            <b>{current.name}</b>은 읽기 전용입니다. {isMaster ? "수정이 필요하면 운영 설정에서 사유를 적고 잠금을 여세요." : "수정이 필요하면 총단에 요청해 주세요."}
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

      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
        <WorkspaceNav groups={groups} />
        <main id="workspace-content" tabIndex={-1} className="min-w-0 flex-1"><RefreshOnReturn />{children}</main>
      </div>
    </div></DraftNavigationProvider>
  );
}
