import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "@/components/campus/import-panel";
import { DataLoadError } from "@/components/ui/data-load-error";

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("campus_id")
    .eq("id", user.id)
    .single();
  if (!profile?.campus_id) redirect("/pending");

  const { data: slots, error } = await supabase
    .from("event_trips")
    .select("id, key, label, direction, active")
        .eq("active", true)
    .order("display_order");

  if (error) return <DataLoadError retryHref="/campus/import" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">명단 가져오기 (CSV)</h2>
        <p className="text-sm text-muted mt-0.5">
          템플릿에 맞춰 작성한 CSV 파일을 올리세요. 엑셀·노션에서 작성한 명단도 CSV 파일로 저장한 뒤 올릴 수 있습니다. 캠퍼스는 본인 캠퍼스로 자동 지정됩니다.
        </p>
      </div>
      <ImportPanel campusId={profile.campus_id} trips={slots ?? []} />
    </div>
  );
}
