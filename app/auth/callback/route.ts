import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";

/**
 * Supabase OAuth callback (Google 동의 후 redirect).
 * code 받아서 session 교환 → role에 따라 redirect.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("인증 코드 누락")}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  // 로그인된 user의 role 조회
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/login?error=session_missing`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, driver_bus_id")
    .eq("id", user.id)
    .single<{ role: UserRole; driver_bus_id: number | null }>();

  const role: UserRole = profile?.role ?? "guest";
  const isDriver = profile?.driver_bus_id != null;

  // next 쿼리가 있으면 그쪽으로, 없으면 role 기본 페이지
  if (next?.startsWith("/")) {
    return NextResponse.redirect(`${origin}${next}`);
  }
  // 임역원이면서 차량순장이면 진입 영역이 둘 → 랜딩에서 선택
  if (role === "campus_admin" && isDriver) {
    return NextResponse.redirect(`${origin}/`);
  }
  if (role === "campus_admin") {
    return NextResponse.redirect(`${origin}/campus`);
  }
  if (role === "viewer" || role === "master") {
    return NextResponse.redirect(`${origin}/admin`);
  }
  if (isDriver) {
    return NextResponse.redirect(`${origin}/driver`);
  }
  return NextResponse.redirect(`${origin}/pending`);
}
