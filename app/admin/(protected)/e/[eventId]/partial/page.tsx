import { OnsiteProvider } from "@/components/onsite/onsite-provider";
import { onsiteSnapshotSchema } from "@/lib/onsite/model";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PartialList } from "@/components/admin/partial-list";
import {
  type TransportMode,
  type TransportStatus,
} from "@/lib/transport/labels";
import type { EventTrip } from "@/lib/supabase/types";
import { PickupBoard, type BoardRow } from "@/components/admin/pickup-board";
import { adminHref } from "@/lib/events/route";
import { isPartialRegistration } from "@/lib/registrations/view";
import { DataLoadError } from "@/components/ui/data-load-error";

export const dynamic = "force-dynamic";

/**
 * 부분 참석 · 개인 이동 (4단계 재설계).
 *
 * 사용자 피드백: **"부분참도 따로 모아서 볼 수 있어서 괜찮았는데 정보가 너무
 * 산발적이라 보기가 어려웠었어."**
 *
 * 무엇이 산발적이었나 — 편도/미이용을 두 섹션으로 나누고, 각 섹션을 **캠퍼스마다
 * 카드로 또 쪼갰다.** 16개 캠퍼스면 카드가 최대 32개가 되고, "누가 왜 버스를 안 타나"를
 * 보려면 그걸 다 훑어야 했다. 세로로 흩어진 것은 서로 비교가 안 된다.
 *
 * 같은 명단을 유형별로 필터하고 사람별 일정 카드로 확인한다.
 * 그리고 이동 수단을 비고 텍스트가 아니라 3단계에서 만든 구조(transport_legs)에서
 * 읽는다 — "무엇으로 오는지 모르는 사람"을 눈으로 찾지 않아도 된다.
 */

type Filter = "all" | "oneway" | "self" | "period" | "pending" | "missing";

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: "all", label: "전체", hint: "편도 · 개인 이동 · 며칠만 참석 · 타지구 차량 확정 대기" },
  { key: "oneway", label: "편도", hint: "갈 때나 올 때 한쪽만 버스를 타는 사람" },
  { key: "self", label: "개인 이동", hint: "우리 버스를 아예 안 타는 사람" },
  {
    key: "period",
    label: "며칠만 참석",
    hint: "참여기간이 행사 전체가 아닌 사람 — 왕복으로 타더라도 부분참이다",
  },
  {
    key: "pending",
    label: "확정 대기",
    hint: "타지구 차량인데 아직 확정 안 됨 — 좌석을 잡아둔 상태",
  },
  {
    key: "missing",
    label: "수단 미확인",
    hint: "버스를 안 타는데 무엇으로 오는지 기록이 없음",
  },
];

export default async function AdminPartialPage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ f?: string }>;
  params: Promise<{ eventId: string }>;
}) {
  const [{ f }, { eventId }] = await Promise.all([searchParams, params]);
  const filter: Filter = FILTERS.find((x) => x.key === f)?.key ?? "all";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user?.id ?? "").single();
  const canEdit = profile?.role === "master";
  const [regRes, campusRes, tripRes, legRes, unitRes, boardRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, attendance_type, up_trip_id, down_trip_id, note, attend_from, attend_to"
      )
      // 취소자는 명단·집계에서 제외한다(좌석 반납은 DB 트리거가 처리).
      .neq("participation_status", "cancelled")
      // 왕복 신청 중인 타지구 차량 확정 대기도 포함한다. 이동수단 조회 후 함께 거른다.
      .order("name"),
    supabase.from("campuses").select("id, name, display_order"),
    supabase.from("event_trips").select("id, label").order("direction").order("display_order"),
    supabase
      .from("transport_legs")
      .select("registration_id, direction, mode, status, via_unit_id"),
    supabase.from("org_units").select("id, name"),
    // 수송 요청 보드. 시각 미정(NULL)이 먼저 오게 읽는다 — 그게 곧 할 일이다.
    supabase
      .from("v_pickup_board")
      .select("*")
      .neq("participation_status", "cancelled")
      .order("pickup_at", { ascending: true, nullsFirst: true }),
  ]);

  if ([regRes, campusRes, tripRes, legRes, unitRes, boardRes].some((result) => result.error)) {
    return <DataLoadError retryHref={adminHref(eventId, filter === "all" ? "/partial" : `/partial?f=${filter}`)} />;
  }

  const campusName = new Map((campusRes.data ?? []).map((c) => [c.id, c.name]));
  const campusOrder = new Map(
    (campusRes.data ?? []).map((c) => [c.id, c.display_order])
  );
  const trips = (tripRes.data ?? []) as Pick<EventTrip, "id" | "label">[];
  const unitName = new Map((unitRes.data ?? []).map((u) => [u.id, u.name]));

  type Leg = { mode: TransportMode; status: TransportStatus; via: string | null };
  const legs = new Map<string, Leg>();
  for (const l of legRes.data ?? []) {
    legs.set(`${l.registration_id}:${l.direction}`, {
      mode: l.mode as TransportMode,
      status: l.status as TransportStatus,
      via: l.via_unit_id ? unitName.get(l.via_unit_id) ?? null : null,
    });
  }

  const rows = (regRes.data ?? []).map((r) => {
    const up = legs.get(`${r.id}:up`) ?? null;
    const down = legs.get(`${r.id}:down`) ?? null;
    const pending = up?.status === "pending" || down?.status === "pending";
    // "무엇으로 오는지 모른다" = 우리 버스를 아예 안 타는데(self) 이동수단 기록도
    // 비고도 없는 사람. 예전엔 비고 유무로만 판단해서, 비고에 딴 얘기가 적혀 있으면
    // 기재된 것으로 쳤다.
    const missing = r.attendance_type === "self" && !up && !down && !r.note?.trim();
    // 며칠만 참석 — 왕복이어도 부분참이다.
    const partialPeriod = r.attend_from != null || r.attend_to != null;
    return {
      partialPeriod,
      ...r,
      up,
      down,
      pending,
      missing,
      campus: campusName.get(r.campus_id) ?? "—",
      order: campusOrder.get(r.campus_id) ?? 999,
    };
  }).filter((r) => isPartialRegistration(r, r.pending));

  const counts: Record<Filter, number> = {
    all: rows.length,
    oneway: rows.filter((r) => r.attendance_type === "oneway").length,
    self: rows.filter((r) => r.attendance_type === "self").length,
    period: rows.filter((r) => r.partialPeriod).length,
    pending: rows.filter((r) => r.pending).length,
    missing: rows.filter((r) => r.missing).length,
  };

  const shown = rows
    .filter((r) => {
      if (filter === "all") return true;
      if (filter === "oneway") return r.attendance_type === "oneway";
      if (filter === "self") return r.attendance_type === "self";
      if (filter === "period") return r.partialPeriod;
      if (filter === "pending") return r.pending;
      return r.missing;
    })
    .sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));

  const [onsite, event, writable] = await Promise.all([
    supabase.rpc("onsite_snapshot", { p_event: eventId, p_reg_ids: shown.map((r) => r.id) }),
    supabase.from("events").select("starts_on, ends_on").eq("id", eventId).single(),
    supabase.rpc("is_event_writable", { p_event: eventId }),
  ]);
  const onsiteParsed = onsiteSnapshotSchema.safeParse(onsite.data);
  if (onsite.error || event.error || writable.error || !onsiteParsed.success) return <DataLoadError retryHref={adminHref(eventId, "/partial")} />;

  const chip = (active: boolean) =>
    "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 px-3 py-1 rounded-lg text-sm border transition " +
    (active
      ? "bg-primary-50 border-border text-primary-800 font-medium"
      : "border-border text-muted hover:bg-surface-2");

  return (
    <OnsiteProvider key={eventId} eventId={eventId} initial={onsiteParsed.data} canEdit={canEdit && writable.data === true}>
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">부분 참석 · 개인 이동</h2>
        <p className="text-sm text-muted mt-0.5">
          일정과 이동수단을 사람별로 확인하세요.
          {canEdit ? " 정보 수정 버튼으로 신청을 바꿉니다." : " 조회 전용이며, 수정·확정은 총단 운영자가 합니다."}
        </p>
      </div>

      {(counts.missing > 0 || counts.pending > 0) && (
        <div className="flex flex-col gap-2">
          {counts.missing > 0 && (
            <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-border text-warning">
              <b>{counts.missing}명</b>이 우리 버스를 안 타는데{" "}
              <b>무엇으로 오는지 기록이 없습니다.</b>{" "}
              {canEdit ? "각 일정의 정보 수정 버튼으로 이동수단을 입력해 주세요." : "캠퍼스 임역원이나 총단 운영자에게 이동수단 확인을 요청해 주세요."}
            </div>
          )}
          {counts.pending > 0 && (
            <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning">
              타지구 차량 <b>확정 대기 {counts.pending}명</b> — 그동안 우리 버스 좌석을
              잡아두고 있습니다.{" "}
              <Link href={adminHref(eventId, "/transport")} className="font-medium underline underline-offset-2">이동수단 확인</Link>
              {canEdit ? "에서 확정하면 그 방향의 좌석이 반납됩니다." : "에서 상태를 조회할 수 있습니다. 확정은 총단 운영자가 합니다."}
            </div>
          )}
        </div>
      )}

      <p className="text-sm text-muted">현장 도착·행사 출발은 아래 버튼을 누른 실제 시각으로 기록합니다. 버스 탑승 체크·참여 예정 날짜와 별개이며 한국 시간(KST)으로 표시합니다.</p>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={x.key === "all" ? "?" : `?f=${x.key}`}
            className={chip(filter === x.key)}
            title={x.hint}
          >
            {x.label} <span className="tabular-nums text-xs">{counts[x.key]}</span>
          </Link>
        ))}
      </div>

      <PartialList rows={shown} title={FILTERS.find((x) => x.key === filter)?.label ?? "전체"}
        eventId={eventId} canEdit={canEdit} trips={trips} startsOn={event.data?.starts_on ?? null} endsOn={event.data?.ends_on ?? null} />

      <PickupBoard rows={(boardRes.data ?? []) as BoardRow[]} audience="admin" />
    </div>
    </OnsiteProvider>
  );
}
