import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnsiteProvider } from "@/components/onsite/onsite-provider";
import { onsiteSnapshotSchema } from "@/lib/onsite/model";
import { loadPartialEditorData } from "@/components/registrations/partial-editor-data";
import { PartialParticipants } from "@/components/registrations/partial-participants";
import { DataLoadError } from "@/components/ui/data-load-error";

export const dynamic = "force-dynamic";
export default async function CampusPartialPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("campus_id,role").eq("id", user.id).single();
  if (!profile?.campus_id) redirect("/pending");
  const { data: eventId, error } = await supabase.rpc("viewing_event_id");
  if (error || !eventId) return <DataLoadError retryHref="/campus/partial" />;
  const data = await loadPartialEditorData(supabase, eventId, profile.campus_id);
  if (!data.ok) return <DataLoadError retryHref="/campus/partial" />;
  const onsite = await supabase.rpc("onsite_snapshot", { p_event: eventId, p_reg_ids: data.rows.map((item) => item.id) });
  const parsed = onsiteSnapshotSchema.safeParse(onsite.data);
  if (onsite.error || !parsed.success) return <DataLoadError retryHref="/campus/partial" />;
  const canEdit = profile.role === "campus_admin" && data.writable;
  return <OnsiteProvider key={eventId} eventId={eventId} initial={parsed.data} canEdit={canEdit}>
    <div className="space-y-4">
      <div><h2 className="text-xl font-semibold text-foreground">부분 참석 · 개인 이동</h2>
        <p className="mt-1 text-sm text-muted">우리 캠퍼스의 일부 기간 참석·버스 편도·개인 이동을 함께 확인합니다. 한 사람은 한 번만 표시합니다.</p>
        <p className="mt-1 text-sm text-muted">정보 수정은 이 목록에서 열고 닫습니다. 참여 예정 일정과 이동수단은 필수이며, 수송 요청과 수강신청은 선택 사항입니다.</p></div>
      <p className="text-sm text-muted">‘집회장 도착’과 ‘집회장 떠남’은 집회장에 들어오거나 나간 것을 확인한 실제 한국 시각(KST)을 기록합니다. 버스 탑승 체크·참여 예정 일정과 별개입니다.</p>
      <PartialParticipants data={data} rows={data.rows} title="우리 캠퍼스 명단" canEdit={canEdit} campusId={profile.campus_id} />
    </div>
  </OnsiteProvider>;
}
