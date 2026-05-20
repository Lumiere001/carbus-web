import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import {
  BatchPanel,
  type BatchRunRow,
  type UnassignedRow,
  type BusOption,
} from "@/components/admin/batch-panel";

export const dynamic = "force-dynamic";

export default async function AdminBatchPage() {
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

  const reg = () =>
    supabase.from("registrations").select("id", { count: "exact", head: true });

  const [
    upPartRes,
    upAssignedRes,
    downPartRes,
    downAssignedRes,
    upUnRes,
    downUnRes,
    busRes,
    campusRes,
    runsRes,
    cfgRes,
  ] = await Promise.all([
    reg().not("departure_day", "is", null),
    reg().not("departure_day", "is", null).not("assigned_up_bus_id", "is", null),
    reg().eq("uses_return_bus", true),
    reg().eq("uses_return_bus", true).not("assigned_down_bus_id", "is", null),
    supabase
      .from("registrations")
      .select("id, name, student_id, campus_id")
      .not("departure_day", "is", null)
      .is("assigned_up_bus_id", null)
      .order("name"),
    supabase
      .from("registrations")
      .select("id, name, student_id, campus_id")
      .eq("uses_return_bus", true)
      .is("assigned_down_bus_id", null)
      .order("name"),
    supabase.from("buses").select("id, name, departure_day").order("id"),
    supabase.from("campuses").select("id, name"),
    supabase
      .from("batch_runs")
      .select(
        "id, run_at, success, total_assigned, empty_seats, error_message, elapsed_ms, trigger_reason"
      )
      .order("run_at", { ascending: false })
      .limit(8),
    supabase.from("system_config").select("last_batch_at, current_phase").maybeSingle(),
  ]);

  const campusName = new Map((campusRes.data ?? []).map((c) => [c.id, c.name]));
  const toUn = (rows: { id: string; name: string; student_id: string; campus_id: string }[]) =>
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      student_id: r.student_id,
      campus_name: campusName.get(r.campus_id) ?? "—",
    }));

  return (
    <BatchPanel
      upParticipants={upPartRes.count ?? 0}
      upAssigned={upAssignedRes.count ?? 0}
      downParticipants={downPartRes.count ?? 0}
      downAssigned={downAssignedRes.count ?? 0}
      upUnassigned={toUn(upUnRes.data ?? []) as UnassignedRow[]}
      downUnassigned={toUn(downUnRes.data ?? []) as UnassignedRow[]}
      buses={(busRes.data ?? []) as BusOption[]}
      lastBatchAt={cfgRes.data?.last_batch_at ?? null}
      currentPhase={cfgRes.data?.current_phase ?? "phase1"}
      runs={(runsRes.data ?? []) as BatchRunRow[]}
    />
  );
}
