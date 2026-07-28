import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { attendanceSummary } from "@/lib/labels";
import {
  DIRECTION_LABELS,
  DIRECTION_SHORT,
  transportBadge,
  type TransportMode,
  type TransportStatus,
} from "@/lib/transport/labels";
import type { EventTrip } from "@/lib/supabase/types";
import { PickupBoard, type BoardRow } from "@/components/admin/pickup-board";

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
 * 그래서 **한 표**로 합쳤다. 캠퍼스는 열 하나가 되고, 유형은 필터가 된다.
 * 그리고 이동 수단을 비고 텍스트가 아니라 3단계에서 만든 구조(transport_legs)에서
 * 읽는다 — "무엇으로 오는지 모르는 사람"을 눈으로 찾지 않아도 된다.
 */

type Filter = "all" | "oneway" | "self" | "period" | "pending" | "missing";

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: "all", label: "전체", hint: "편도 · 개인 이동 · 며칠만 참석 전부" },
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
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const filter: Filter = FILTERS.some((x) => x.key === f) ? (f as Filter) : "all";

  const supabase = await createClient();
  const [regRes, campusRes, tripRes, legRes, unitRes, boardRes] = await Promise.all([
    supabase
      .from("registrations")
      .select(
        "id, name, student_id, campus_id, attendance_type, up_trip_id, down_trip_id, note, attend_from, attend_to"
      )
      // 취소자는 명단·집계에서 제외한다(좌석 반납은 DB 트리거가 처리).
      .neq("participation_status", "cancelled")
      // 버스 이용만으로 거르면 **왕복으로 타면서 며칠만 있다 가는 사람이 통째로
      // 빠진다.** 부분참은 "버스를 덜 타는 것"만이 아니라 "며칠만 있는 것"이기도
      // 하다 — 참여기간 필드를 만든 이유가 그것이다.
      .or(
        "attendance_type.in.(oneway,self),attend_from.not.is.null,attend_to.not.is.null"
      )
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
  });

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

  const chip = (active: boolean) =>
    "px-3 py-1 rounded-lg text-sm border transition " +
    (active
      ? "bg-primary-50 border-primary-200 text-primary-800 font-medium"
      : "border-border text-muted hover:bg-surface-2");

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">부분 참석 · 개인 이동</h2>
        <p className="text-sm text-muted mt-0.5">
          한쪽만 버스를 타거나, 우리 버스를 아예 안 타거나, <b>며칠만 참석하는</b> 사람을
          한 표에서 봅니다.
        </p>
      </div>

      {(counts.missing > 0 || counts.pending > 0) && (
        <div className="flex flex-col gap-2">
          {counts.missing > 0 && (
            <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning">
              <b>{counts.missing}명</b>이 우리 버스를 안 타는데{" "}
              <b>무엇으로 오는지 기록이 없습니다.</b> 전체 순장/순원 화면에서 이동수단을
              지정해 주세요 — 현장에서 “안 왔는데 왜 안 왔는지 모르는” 상황을 막습니다.
            </div>
          )}
          {counts.pending > 0 && (
            <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning">
              타지구 차량 <b>확정 대기 {counts.pending}명</b> — 그동안 우리 버스 좌석을
              잡아두고 있습니다. <b>이동수단</b> 화면에서 확정하면 자리가 자동으로 반납됩니다.
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
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

      <Card
        title={FILTERS.find((x) => x.key === filter)!.label}
        subtitle={`${shown.length}명 · 캠퍼스 순`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left [&>th]:whitespace-nowrap">
                <th className="px-4 py-2.5">캠퍼스</th>
                <th className="px-4 py-2.5">이름</th>
                <th className="px-4 py-2.5">학번</th>
                <th className="px-4 py-2.5">참여기간</th>
                <th className="px-4 py-2.5">버스 이용</th>
                <th className="px-4 py-2.5">이동 수단</th>
                <th className="px-4 py-2.5">비고</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted-2 py-8">
                    해당하는 사람이 없습니다.
                  </td>
                </tr>
              )}
              {shown.map((r) => {
                const upB = transportBadge(r.up?.mode, r.up?.status, r.up?.via);
                const downB = transportBadge(r.down?.mode, r.down?.status, r.down?.via);
                return (
                  <tr
                    key={r.id}
                    className={
                      "border-t border-border " + (r.missing ? "bg-warning-bg/30" : "")
                    }
                  >
                    <td className="px-4 py-2 text-muted-2 whitespace-nowrap">{r.campus}</td>
                    <td className="px-4 py-2 text-foreground whitespace-nowrap">{r.name}</td>
                    <td className="px-4 py-2 text-muted-2">{r.student_id}</td>
                    <td className="px-4 py-2 text-muted-2 whitespace-nowrap">
                      {r.partialPeriod ? (
                        <span className="text-foreground">
                          {r.attend_from ?? "처음"} ~ {r.attend_to ?? "끝"}
                        </span>
                      ) : (
                        "전체"
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Badge variant="mute" dot={false}>
                        {attendanceSummary(r.up_trip_id, r.down_trip_id, trips)}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {upB || downB ? (
                        <span className="inline-flex flex-wrap gap-1">
                          {upB && (
                            <Badge
                              variant={upB.tone}
                              dot={false}
                              title={`${DIRECTION_LABELS.up} — ${upB.title}`}
                            >
                              {DIRECTION_SHORT.up.slice(0, 1)} {upB.text}
                            </Badge>
                          )}
                          {downB && (
                            <Badge
                              variant={downB.tone}
                              dot={false}
                              title={`${DIRECTION_LABELS.down} — ${downB.title}`}
                            >
                              {DIRECTION_SHORT.down.slice(0, 1)} {downB.text}
                            </Badge>
                          )}
                        </span>
                      ) : r.missing ? (
                        <span className="text-warning text-xs">⚠ 기록 없음</span>
                      ) : (
                        <span className="text-muted-2">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-2 whitespace-pre-wrap break-words max-w-[22rem]">
                      {r.note?.trim() ? r.note : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PickupBoard rows={(boardRes.data ?? []) as BoardRow[]} audience="admin" />
    </div>
  );
}
