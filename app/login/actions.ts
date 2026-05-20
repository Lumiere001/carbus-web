"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * Google OAuth 로그인 (임역원·게스트).
 *
 * 카카오 대신 Google 사용 이유: Supabase 내장 카카오 provider가 account_email scope를
 * 강제하는데(GitHub #36878), 카카오는 그 scope를 사업자 인증 앱에만 허용 → 개인 개발자는
 * KOE205로 카카오 로그인 불가. Google은 이런 제약 없음. (MIGRATION 결정 #1 개정)
 */
export async function signInWithGoogle() {
  const supabase = await createClient();
  const headersList = await headers();
  const origin =
    headersList.get("origin") ??
    `https://${headersList.get("host") ?? "localhost:3000"}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  if (data?.url) {
    redirect(data.url);
  }
}
