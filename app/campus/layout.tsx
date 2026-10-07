import { DraftNavigationProvider } from "@/components/ui/draft-navigation";
import { RefreshOnReturn } from "@/components/ui/refresh-on-return";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProfileMini } from "@/lib/supabase/types";
import { WorkspaceNav } from "@/components/ui/workspace-nav";
import { campusNavigation } from "@/lib/navigation";
import { signOut } from "@/app/logout/actions";

export default async function CampusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: event }] = await Promise.all([
    supabase
      .from("profiles")
      .select("role, campus_id, display_name")
      .eq("id", user.id)
      .single<ProfileMini>(),
    // 임역원 화면에는 행사 이름이 **한 군데도** 없었다. master 가 행사를 넘기면
    // 명단이 빈 화면으로 바뀌는데, 임역원은 자기 입력이 사라진 줄 안다.
    supabase.from("events").select("name").eq("is_active", true).maybeSingle(),
  ]);

  if (!profile || profile.role !== "campus_admin") {
    redirect(profile?.role === "guest" ? "/pending" : "/admin");
  }

  return (
    <DraftNavigationProvider><div className="min-h-screen bg-background">
      <a href="#workspace-content" className="skip-link">본문으로 건너뛰기</a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-[1600px] flex-row items-start justify-between gap-2 px-4 py-3 md:items-center md:px-6">
          <div className="flex w-full flex-col items-start gap-2 md:w-auto md:flex-row md:items-center md:gap-4 min-w-0">
            <h1 className="text-sm font-semibold text-foreground whitespace-nowrap shrink-0">
              Carbus · 임역원 · {profile.display_name ?? "(이름 없음)"}
            </h1>
            <span
              className="shrink-0 max-w-[14rem] truncate rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted"
              title={event?.name ?? undefined}
            >
              {event?.name ?? "진행 중 행사 없음"}
            </span>

          </div>
          <form action={signOut} className="shrink-0">
            <button
              type="submit"
              className="min-h-11 px-3 rounded-lg text-sm text-muted transition hover:bg-surface-2 hover:text-foreground whitespace-nowrap"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
        <WorkspaceNav groups={campusNavigation} />
        <main id="workspace-content" tabIndex={-1} className="min-w-0 flex-1"><RefreshOnReturn />{children}</main>
      </div>
    </div></DraftNavigationProvider>
  );
}
