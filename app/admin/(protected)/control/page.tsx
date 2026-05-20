import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { ControlPanel } from "@/components/admin/control-panel";

export const dynamic = "force-dynamic";

export default async function AdminControlPage() {
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

  const { data: cfg } = await supabase
    .from("system_config")
    .select("current_phase, batch_enabled, updated_at")
    .maybeSingle();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">시스템 설정</h2>
        <p className="text-sm text-muted mt-0.5">
          입력·마감 단계 전환 및 배차 활성화 (master 전용)
        </p>
      </div>
      <ControlPanel
        phase={cfg?.current_phase ?? "phase1"}
        batchEnabled={cfg?.batch_enabled ?? false}
        updatedAt={cfg?.updated_at ?? null}
      />
    </div>
  );
}
