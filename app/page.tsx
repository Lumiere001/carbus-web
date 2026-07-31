import Link from "next/link";
import { Bus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/logout/actions";
import type { UserRole } from "@/lib/supabase/types";

const logoutBtnClass =
  "text-xs text-muted-2 underline hover:text-muted bg-transparent border-0 cursor-pointer p-0";

export const dynamic = "force-dynamic";

const primaryBtn =
  "inline-flex items-center justify-center h-11 px-6 rounded-lg bg-primary-800 hover:bg-primary-700 text-white font-medium transition shadow-sm";
const secondaryBtn =
  "inline-flex items-center justify-center h-11 px-6 rounded-lg border border-border bg-surface hover:bg-surface-2 text-foreground font-medium transition shadow-sm";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: UserRole = "guest";
  let isDriver = false;
  if (user) {
    const { data: p } = await supabase
      .from("profiles")
      .select("role, driver_bus_id")
      .eq("id", user.id)
      .single<{ role: UserRole; driver_bus_id: number | null }>();
    role = p?.role ?? "guest";
    isDriver = p?.driver_bus_id != null;
  }

  // 진입 가능한 화면 (둘 이상이면 여기서 선택 — 임역원이면서 차량순장인 경우 구분)
  const entries: { href: string; label: string; primary?: boolean }[] = [];
  if (role === "campus_admin")
    entries.push({ href: "/campus", label: "임역원 화면" });
  if (role === "viewer" || role === "master")
    entries.push({ href: "/admin", label: "운영자 화면", primary: true });
  if (isDriver)
    entries.push({ href: "/driver", label: "차량 순장 출석체크", primary: true });

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-xl w-full text-center space-y-8 py-12">
        <div className="space-y-4">
          <div className="w-12 h-12 rounded-xl bg-primary-800 flex items-center justify-center mx-auto">
            <Bus className="w-6 h-6 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-semibold text-foreground tracking-tight">
              광주지구 차량 관리
            </h1>
            <p className="text-muted text-base">
              광주지구 CCC 차량 신청·배차·정산 시스템
            </p>
          </div>
        </div>

        {!user ? (
          <>
            <div className="text-sm text-muted bg-surface rounded-xl p-4 border border-border shadow-1">
              <p className="font-medium text-foreground mb-1">시스템 안내</p>
              <p>본 시스템은 캠퍼스 임역원·차량 순장·총단 운영자 전용입니다.</p>
              <p className="mt-1">
                순장/순원분은 캠퍼스 임역원에게 직접 신청해 주세요.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/login" className={secondaryBtn}>
                Google로 로그인 (임역원·차량순장)
              </Link>
              <Link href="/admin/login" className={primaryBtn}>
                운영자 로그인
              </Link>
            </div>
          </>
        ) : entries.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">들어갈 화면을 선택하세요</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {entries.map((e) => (
                <Link
                  key={e.href}
                  href={e.href}
                  className={e.primary ? primaryBtn : secondaryBtn}
                >
                  {e.label}
                </Link>
              ))}
            </div>
            <form action={signOut}>
              <button type="submit" className={logoutBtnClass}>
                로그아웃
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-muted bg-surface rounded-xl p-4 border border-border shadow-1">
              <p className="font-medium text-foreground mb-1">승인 대기 중</p>
              <p>
                로그인되었지만 아직 권한이 없습니다. 총단(master)이 캠퍼스 또는
                담당 호차를 배정하면 화면이 열립니다.
              </p>
            </div>
            <form action={signOut}>
              <button type="submit" className={logoutBtnClass}>
                로그아웃
              </button>
            </form>
          </div>
        )}

        <footer className="text-xs text-muted-2 pt-12">carbus-web · 2026</footer>
      </div>
    </main>
  );
}
