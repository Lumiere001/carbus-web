import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { signOut } from "@/app/logout/actions";

/**
 * 차량 순장 영역. master 가 profiles.driver_bus_id 를 배정해야 진입 가능.
 * (배정 전에는 /pending 또는 본인 역할 홈으로 — 승인 게이트)
 */
export default async function DriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, driver_bus_id, display_name")
    .eq("id", user.id)
    .single<{
      role: UserRole;
      driver_bus_id: number | null;
      display_name: string | null;
    }>();

  if (!profile || profile.driver_bus_id == null) {
    redirect(
      profile?.role === "campus_admin"
        ? "/campus"
        : profile?.role === "viewer" || profile?.role === "master"
          ? "/admin"
          : "/pending"
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <a href="#workspace-content" className="skip-link">본문으로 건너뛰기</a>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 md:px-6">
          <h1 className="text-sm font-normal text-foreground whitespace-nowrap">
            차량 순장 · {profile.display_name ?? "(이름 없음)"}
          </h1>
          <form action={signOut} className="shrink-0">
            <button
              type="submit"
              className="min-h-11 rounded-full px-3 text-sm text-muted transition hover:text-foreground whitespace-nowrap"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main id="workspace-content" tabIndex={-1} className="mx-auto max-w-3xl p-4 md:p-6">{children}</main>
    </div>
  );
}
