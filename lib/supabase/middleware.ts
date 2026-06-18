import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import type { UserRole } from "./types";

/**
 * 미들웨어에서 호출되는 Supabase 세션 갱신 + role 기반 라우트 보호.
 *
 * @see SPEC §3.1 역할 4종
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 1. 세션 갱신
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // 2. 공개 경로는 통과
  const publicPaths = ["/", "/login", "/admin/login", "/auth/callback"];
  if (publicPaths.some((p) => pathname === p)) {
    return supabaseResponse;
  }

  // 3. Next 내부 리소스는 통과
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico)$/.test(pathname)
  ) {
    return supabaseResponse;
  }

  // 4. 미인증이면 로그인 페이지로 (운영자 영역은 운영자 로그인으로)
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.startsWith("/admin") ? "/admin/login" : "/login";
    return NextResponse.redirect(url);
  }

  // 5. role + 차량순장 호차 조회 (profiles)
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, driver_bus_id")
    .eq("id", user.id)
    .single();

  const role: UserRole = (profile?.role ?? "guest") as UserRole;
  const isDriver = profile?.driver_bus_id != null; // master가 호차 배정 → 차량순장

  // 역할별 기본 홈 (배차/캠퍼스 > 운영자 > 차량순장 > 대기)
  const home = () => {
    if (role === "campus_admin") return "/campus";
    if (role === "viewer" || role === "master") return "/admin";
    if (isDriver) return "/driver";
    return "/pending";
  };

  // 6. 라우트 분기
  // /pending : 아무 권한 없는 게스트 전용 (배정되면 자기 페이지로)
  if (pathname.startsWith("/pending")) {
    if (role !== "guest" || isDriver) {
      const url = request.nextUrl.clone();
      url.pathname = home();
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // /driver : 차량순장(호차 배정된 사용자)만 — master 배정 전엔 진입 불가
  if (pathname.startsWith("/driver")) {
    if (!isDriver) {
      const url = request.nextUrl.clone();
      url.pathname = home();
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // /campus : campus_admin만
  if (pathname.startsWith("/campus")) {
    if (role !== "campus_admin") {
      const url = request.nextUrl.clone();
      url.pathname = home();
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  // /admin : viewer 또는 master (단 /admin/login은 위에서 통과)
  if (pathname.startsWith("/admin")) {
    if (role !== "viewer" && role !== "master") {
      const url = request.nextUrl.clone();
      url.pathname = home();
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  return supabaseResponse;
}
