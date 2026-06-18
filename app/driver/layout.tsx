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
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 md:px-6">
          <h1 className="text-sm font-semibold text-foreground whitespace-nowrap">
            차량 순장 · {profile.display_name ?? "(이름 없음)"}
          </h1>
          <form action={signOut} className="shrink-0">
            <button
              type="submit"
              className="text-sm text-muted transition hover:text-foreground whitespace-nowrap"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-3xl p-4 md:p-6">{children}</div>
    </div>
  );
}
