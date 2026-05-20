"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * 운영자 비번 로그인.
 *
 * 사용자는 비번만 입력. 서버가 master·viewer 이메일에 차례로 signInWithPassword 시도해
 * 성공한 쪽으로 자동 로그인. master 비번을 먼저 시도해 master 우선 (보안: master 의도 가정).
 */
export async function loginWithAdminPassword(formData: FormData) {
  const password = formData.get("password");
  if (typeof password !== "string" || !password) {
    redirect("/admin/login?error=" + encodeURIComponent("비밀번호를 입력하세요"));
  }

  const masterEmail = process.env.ADMIN_MASTER_EMAIL;
  const viewerEmail = process.env.ADMIN_VIEWER_EMAIL;
  if (!masterEmail || !viewerEmail) {
    redirect(
      "/admin/login?error=" +
        encodeURIComponent("서버 환경변수 미설정 — CC에게 문의")
    );
  }

  const supabase = await createClient();

  // master 우선 시도
  const m = await supabase.auth.signInWithPassword({
    email: masterEmail,
    password: password as string,
  });
  if (!m.error && m.data.session) {
    redirect("/admin");
  }

  // viewer 시도
  const v = await supabase.auth.signInWithPassword({
    email: viewerEmail,
    password: password as string,
  });
  if (!v.error && v.data.session) {
    redirect("/admin");
  }

  // 둘 다 실패
  redirect(
    "/admin/login?error=" + encodeURIComponent("비밀번호가 올바르지 않습니다")
  );
}
