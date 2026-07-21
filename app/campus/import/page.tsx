import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ImportPanel } from "@/components/campus/import-panel";

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

  const { data: slots } = await supabase
    .from("event_trips")
    .select("id, key, label")
    .eq("direction", "up")
    .eq("active", true)
    .order("display_order");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">대량 등록 (CSV·복붙)</h2>
        <p className="text-sm text-muted mt-0.5">
          노션·엑셀에서 복사해 붙여넣거나 CSV 파일을 올리세요. 캠퍼스는 본인
          캠퍼스로 자동 지정됩니다.
        </p>
      </div>
      <ImportPanel campusId={profile.campus_id} slots={slots ?? []} />
    </div>
  );
}
