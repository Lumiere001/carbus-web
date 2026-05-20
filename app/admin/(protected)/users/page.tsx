import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { UsersPanel } from "@/components/admin/users-panel";

/** 사용자 관리 — master 전용 (게스트 → 임역원 승격·해제). */
export default async function AdminUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single<{ role: UserRole }>();
  if (me?.role !== "master") redirect("/admin");

  const [profilesRes, campusesRes] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("campuses").select("id, name").order("display_order"),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">사용자 관리</h2>
        <p className="text-sm text-muted mt-0.5">
          Google 로그인한 게스트에게 캠퍼스를 부여하면 임역원으로 활동할 수
          있습니다. master만 접근 가능.
        </p>
      </div>
      <UsersPanel
        profiles={profilesRes.data ?? []}
        campuses={campusesRes.data ?? []}
      />
    </div>
  );
}
