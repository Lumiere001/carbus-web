import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { RolesPanel } from "@/components/admin/roles-panel";
import type { RoleLabelRow } from "@/lib/admin/role-labels";

export const dynamic = "force-dynamic";

export default async function AdminRolesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<{ role: UserRole }>();
  if (profile?.role !== "master") redirect("/admin");

  const { data: labels } = await supabase
    .from("role_labels")
    .select("*")
    .order("display_order");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">역할 라벨</h2>
        <p className="text-sm text-muted mt-0.5">
          채플담당·기타임역원 등 순장/순원 역할 라벨 관리 (배차 고정 탑승자 분류용)
        </p>
      </div>
      <RolesPanel initial={(labels ?? []) as RoleLabelRow[]} />
    </div>
  );
}
