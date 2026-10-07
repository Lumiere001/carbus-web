import Link from "next/link";
import { partialFilters as filters, matchesPartialFilter as matches } from "@/components/registrations/partial-filters";
import { createClient } from "@/lib/supabase/server";
import { OnsiteProvider } from "@/components/onsite/onsite-provider";
import { onsiteSnapshotSchema } from "@/lib/onsite/model";
import { loadPartialEditorData } from "@/components/registrations/partial-editor-data";
import { PartialParticipants } from "@/components/registrations/partial-participants";
import { PickupBoard, type BoardRow } from "@/components/admin/pickup-board";
import { DataLoadError } from "@/components/ui/data-load-error";
import { adminHref } from "@/lib/events/route";

export const dynamic = "force-dynamic";

export default async function AdminPartialPage({ searchParams, params }: {
  readonly searchParams: Promise<{ f?: string }>;
  readonly params: Promise<{ eventId: string }>;
}) {
  const [{ f }, { eventId }] = await Promise.all([searchParams, params]);
  const filter = filters.find((item) => item.key === f)?.key ?? "all";
  const supabase = await createClient();
  const [{ data: { user } }, data, board] = await Promise.all([
    supabase.auth.getUser(), loadPartialEditorData(supabase, eventId),
    supabase.from("v_pickup_board").select("*").eq("event_id", eventId).neq("participation_status", "cancelled").order("pickup_at", { nullsFirst: true }),
  ]);
  const retryHref = adminHref(eventId, `/partial${filter === "all" ? "" : `?f=${filter}`}`);
  if (!data.ok || board.error) return <DataLoadError retryHref={retryHref} />;
  const [profile, onsite] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user?.id ?? "").single(),
    supabase.rpc("onsite_snapshot", { p_event: eventId, p_reg_ids: data.rows.map((item) => item.id) }),
  ]);
  const parsed = onsiteSnapshotSchema.safeParse(onsite.data);
  if (profile.error || onsite.error || !parsed.success) return <DataLoadError retryHref={retryHref} />;
  const canEdit = profile.data?.role === "master" && data.writable;
  const counts = Object.fromEntries(filters.map((item) => [item.key, data.rows.filter((row) => matches(item.key, row)).length]));
  const shown = data.rows.filter((row) => matches(filter, row));
  return <OnsiteProvider key={eventId} eventId={eventId} initial={parsed.data} canEdit={canEdit}>
    <div className="space-y-4">
      <div><h2 className="text-xl font-semibold text-foreground">부분 참석 · 개인 이동</h2>
        <p className="mt-1 text-sm text-muted">예정 일정과 이동수단을 사람별로 확인하세요. {canEdit ? "정보 수정은 이 목록에서 열고 닫습니다." : "조회 전용입니다."}</p></div>
      {(counts.missing > 0 || counts.pending > 0 || counts.schedule > 0) && <div className="flex flex-wrap gap-2 text-sm text-warning">
        {counts.missing > 0 && <p className="rounded-lg border border-border bg-warning-bg px-3 py-2">이동수단 확인 필요 {counts.missing}명</p>}
        {counts.schedule > 0 && <p className="rounded-lg border border-border bg-warning-bg px-3 py-2">예정 시각 확인 필요 {counts.schedule}명</p>}
        {counts.pending > 0 && <p className="rounded-lg border border-border bg-warning-bg px-3 py-2">타지구 차량 확정 대기 {counts.pending}명 · <Link href={adminHref(eventId,"/transport")} className="underline underline-offset-2">이동수단 확인</Link><span className="block">확정되면 해당 방향의 우리 버스 좌석을 반납합니다.</span></p>}
      </div>}
      <p className="text-sm text-muted">‘행사장 도착’은 행사장에 들어온 것을, ‘행사장 떠남’은 행사장을 나간 것을 확인한 실제 시각입니다. 버튼을 누른 한국 시각(KST)을 기록하며 버스 탑승 체크와 별개입니다.</p>
      <nav aria-label="부분 참석 조건" className="flex flex-wrap gap-2">{filters.map((item) => <Link key={item.key}
        href={item.key === "all" ? "?" : `?f=${item.key}`} aria-current={filter === item.key ? "page" : undefined}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm ${filter === item.key ? "border-border-2 bg-surface-2 text-foreground" : "border-border text-muted hover:bg-surface-2"}`}>
        {item.label}<span className="tabular-nums">{counts[item.key]}</span></Link>)}</nav>
      <PartialParticipants data={data} rows={shown} title={filters.find((item) => item.key === filter)?.label ?? "전체"} canEdit={canEdit} />
      <PickupBoard rows={(board.data ?? []) as BoardRow[]} audience="admin" />
    </div>
  </OnsiteProvider>;
}
