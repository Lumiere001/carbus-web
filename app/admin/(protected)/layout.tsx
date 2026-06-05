import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { signOut } from "@/app/logout/actions";

/**
 * 운영자 (viewer/master) 보호 layout.
 * `/admin/login` 은 이 group 밖에 있어서 layout 적용 안 받음.
 */
export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();

  const role: UserRole = profile?.role ?? "guest";
  if (role !== "viewer" && role !== "master") {
    redirect(role === "campus_admin" ? "/campus" : "/pending");
  }

  const isMaster = role === "master";

  const navLink =
    "text-sm text-primary-200 hover:text-white transition shrink-0";

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
            <span className="hidden md:inline text-xs text-primary-400">|</span>
            <nav className="flex gap-3.5 w-full md:w-auto overflow-x-auto whitespace-nowrap pb-1 md:pb-0 md:flex-wrap md:overflow-visible">
              <a href="/admin" className={navLink}>
                대시보드
              </a>
              <a href="/admin/registrations" className={navLink}>
                전체 순장/순원
              </a>
              <a href="/admin/buses" className={navLink}>
                호차
              </a>
              <a href="/admin/attendance" className={navLink}>
                출석
              </a>
              {isMaster && (
                <a href="/admin/batch" className={navLink}>
                  배차
                </a>
              )}
              <a href="/admin/leaders" className={navLink}>
                리더
              </a>
              <a href="/admin/partial" className={navLink}>
                부분참
              </a>
              <a href="/admin/payments" className={navLink}>
                정산
              </a>
              {isMaster && (
                <>
                  <a href="/admin/control" className={navLink}>
                    Phase
                  </a>
                  <a href="/admin/users" className={navLink}>
                    사용자
                  </a>
                  <a href="/admin/roles" className={navLink}>
                    역할 라벨
                  </a>
                </>
              )}
              <a href="/admin/changes" className={navLink}>
                변동
              </a>
              <a href="/admin/errors" className={navLink}>
                오류
              </a>
              <a href="/admin/logs" className={navLink}>
                로그
              </a>
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
      <div className="max-w-7xl mx-auto p-4 md:p-6">{children}</div>
    </div>
  );
}
