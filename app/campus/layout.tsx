import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ProfileMini } from "@/lib/supabase/types";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, campus_id, display_name")
    .eq("id", user.id)
    .single<ProfileMini>();

  if (!profile || profile.role !== "campus_admin") {
    redirect(profile?.role === "guest" ? "/pending" : "/admin");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-foreground">
              임역원 · {profile.display_name ?? "(이름 없음)"}
            </h1>
            <span className="text-border-2">|</span>
            <nav className="flex gap-1 text-sm">
              <a
                href="/campus"
                className="rounded-md px-2.5 py-1 text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                순장/순원 입력
              </a>
              <a
                href="/campus/import"
                className="rounded-md px-2.5 py-1 text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                Import
              </a>
              <a
                href="/campus/buses"
                className="rounded-md px-2.5 py-1 text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                호차 조회
              </a>
              <a
                href="/campus/payments"
                className="rounded-md px-2.5 py-1 text-muted transition hover:bg-surface-2 hover:text-foreground"
              >
                차량비
              </a>
            </nav>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="text-sm text-muted transition hover:text-foreground"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-7xl p-6">{children}</div>
    </div>
  );
}
