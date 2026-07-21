import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RegistrationGrid } from "@/components/campus/registration-grid";

export default async function CampusPage() {
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

  const campusId = profile?.campus_id;
  if (!campusId) redirect("/pending");

  const [regRes, campusRes, busRes, slotRes] = await Promise.all([
    supabase
      .from("registrations")
      .select("*")
      // 취소자는 명단·집계에서 제외한다(좌석 반납은 DB 트리거가 처리).
      .neq("participation_status", "cancelled")
      .eq("campus_id", campusId)
      .order("created_at", { ascending: true }),
    supabase.from("campuses").select("name").eq("id", campusId).single(),
    supabase.from("buses").select("id, name").order("id"),
    supabase.from("event_trips").select("*").order("direction").order("display_order"),
  ]);

  return (
    <RegistrationGrid
      campusId={campusId}
      campusName={campusRes.data?.name ?? "내"}
      initialRows={regRes.data ?? []}
      buses={busRes.data ?? []}
      trips={slotRes.data ?? []}
    />
  );
}
