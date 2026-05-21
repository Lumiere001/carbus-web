import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RegistrationGrid } from "@/components/campus/registration-grid";
import { buildAttendancePresets } from "@/lib/labels";

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
      .eq("campus_id", campusId)
      .order("created_at", { ascending: true }),
    supabase.from("campuses").select("name").eq("id", campusId).single(),
    supabase.from("buses").select("id, name").order("id"),
    supabase.from("departure_slots").select("*").order("display_order"),
  ]);

  return (
    <RegistrationGrid
      campusId={campusId}
      campusName={campusRes.data?.name ?? "내"}
      initialRows={regRes.data ?? []}
      buses={busRes.data ?? []}
      presets={buildAttendancePresets(slotRes.data ?? [])}
    />
  );
}
