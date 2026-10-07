import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { UsersPanel } from "@/components/admin/users-panel";
import { DataLoadError } from "@/components/ui/data-load-error";
import { adminHref } from "@/lib/events/route";

/** 사용자 관리 — master 전용 (게스트 → 임역원 승격·해제). */
export default async function AdminUsersPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
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

  const [profilesRes, campusesRes, busesRes] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("campuses").select("id, name").order("display_order"),
    supabase.from("buses").select("id, name").order("id"),
  ]);

  if ([profilesRes, campusesRes, busesRes].some((result) => result.error)) {
    return <DataLoadError retryHref={adminHref(eventId, "/users")} />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">사용자 관리</h2>
        <p className="text-sm text-muted mt-0.5">
          Google 로그인한 게스트에게 캠퍼스를 부여하면 임역원, 호차를 배정하면
          차량 순장으로 활동합니다 (둘 다 가능). <span className="whitespace-nowrap">총단 전용 화면입니다.</span>
        </p>
      </div>
      <UsersPanel
        profiles={profilesRes.data ?? []}
        campuses={campusesRes.data ?? []}
        buses={busesRes.data ?? []}
      />
    </div>
  );
}
