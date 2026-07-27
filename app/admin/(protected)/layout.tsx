import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";

/**
 * 운영자 (viewer/master) 보호 layout.
 * `/admin/login` 은 이 group 밖에 있어서 layout 적용 안 받음.
 *
 * ⚠️ 여기는 **권한만** 본다. 화면 뼈대(헤더·네비)는 `e/[eventId]/layout.tsx` 에 있다 —
 *    네비 링크가 행사 id 를 알아야 하기 때문이다(Phase 4-5).
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

  return <>{children}</>;
}
