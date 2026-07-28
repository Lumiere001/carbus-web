import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/types";
import { ControlPanel } from "@/components/admin/control-panel";
import { EventsPanel, type EventCounts } from "@/components/admin/events-panel";
import { UnlockPanel } from "@/components/admin/unlock-panel";
import type { EventRow } from "@/lib/admin/events";

export const dynamic = "force-dynamic";

export default async function AdminControlPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
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

  const [cfgRes, eventsRes, summaryRes] = await Promise.all([
    supabase
      .from("system_config")
      .select("current_phase, batch_enabled, updated_at")
      .maybeSingle(),
    supabase
      .from("events")
      .select(
        // `write_mode`·`unlock_*` — 지금 보는 행사가 잠겨 있는지, 열려 있다면 언제까지
        // 인지 알아야 잠금 카드를 띄울 수 있다 (§25-D 의 unlock_event_writes).
        "id, name, subtitle, starts_on, ends_on, origin, destination, fee_roundtrip, fee_oneway, is_active, created_at, write_mode, unlock_until, unlock_reason"
      )
      .order("created_at", { ascending: false }),
    // 지난 행사 건수는 RLS 범위 밖이라 집계 전용 RPC 로 받는다.
    supabase.rpc("event_summary"),
  ]);
  const cfg = cfgRes.data;

  const counts: EventCounts = {};
  for (const s of summaryRes.data ?? []) {
    counts[s.event_id] = { regs: Number(s.reg_count), batches: Number(s.batch_count) };
  }

  // 지금 **보고 있는** 행사가 잠겨 있으면 여는 자리를 띄운다.
  // 진행 중인 행사는 원래 쓸 수 있으니 열 것이 없다 — 늘 보이면 "잠금은 그냥 여는 것"
  // 이 된다.
  const viewing = (eventsRes.data ?? []).find((e) => e.id === eventId);
  const showUnlock = viewing != null && viewing.write_mode !== "live";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">시스템 설정</h2>
        <p className="text-sm text-muted mt-0.5">
          행사 전환, 입력·마감 단계 전환 및 배차 활성화 (master 전용)
        </p>
      </div>
      <EventsPanel events={(eventsRes.data ?? []) as EventRow[]} counts={counts} />
      {showUnlock && (
        <UnlockPanel
          eventId={viewing.id}
          eventName={viewing.name}
          unlockUntil={viewing.unlock_until}
          unlockReason={viewing.unlock_reason}
        />
      )}
      <ControlPanel
        phase={cfg?.current_phase ?? "phase1"}
        batchEnabled={cfg?.batch_enabled ?? false}
        updatedAt={cfg?.updated_at ?? null}
      />
    </div>
  );
}
