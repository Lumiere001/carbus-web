import Link from "next/link";
import { ArrowRight, CalendarDays, Bus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OnsiteAttendance } from "@/components/onsite/onsite-attendance";
import { attendanceSummary } from "@/lib/labels";
import { DIRECTION_LABELS, DIRECTION_SHORT, transportBadge } from "@/lib/transport/labels";
import type { TransportMode, TransportStatus } from "@/lib/transport/labels";
import type { EventTrip } from "@/lib/supabase/types";
import { adminHref } from "@/lib/events/route";

type Leg = { readonly mode: TransportMode; readonly status: TransportStatus; readonly via: string | null };
type PartialRow = {
  readonly id: string; readonly campus: string; readonly name: string; readonly student_id: string;
  readonly partialPeriod: boolean; readonly attend_from: string | null; readonly attend_to: string | null;
  readonly up_trip_id: number | null; readonly down_trip_id: number | null;
  readonly up: Leg | null; readonly down: Leg | null; readonly missing: boolean; readonly note: string | null;
};
export function PartialList({ rows, title, eventId, canEdit, trips, startsOn, endsOn }: {
  readonly rows: readonly PartialRow[]; readonly title: string; readonly eventId: string; readonly canEdit: boolean;
  readonly trips: Pick<EventTrip,"id"|"label">[]; readonly startsOn: string | null; readonly endsOn: string | null;
}) {
  return <Card title={title} subtitle={`${rows.length}명 · 캠퍼스 순 · 예정 일정과 현장 기록`}>
    {rows.length === 0 ? <p className="p-5 text-sm text-muted">해당하는 사람이 없습니다. 위에서 다른 조건을 선택하세요.</p> :
      <ul className="grid gap-4 p-4 xl:grid-cols-2 sm:p-5">{rows.map((row) => <li key={row.id} className={`min-w-0 rounded-lg border border-border p-4 ${row.missing ? "bg-warning-bg/30" : "bg-surface-2/40"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><h3 className="break-words text-lg font-medium text-foreground">{row.name}</h3><p className="text-sm text-muted">{row.campus} · {row.student_id}</p></div>
          {canEdit && <Link href={`${adminHref(eventId, "/registrations")}?edit=${encodeURIComponent(row.id)}`} aria-label={`${row.name} 정보 수정`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-2 px-4 text-sm text-foreground hover:bg-surface-2">정보 수정<ArrowRight size={16} aria-hidden="true" /></Link>}
        </div>
        <div className="mt-4 space-y-4">
          <section aria-label={`${row.name} 참여 예정`} className="rounded-lg bg-surface-2 p-3">
            <p className="flex items-center gap-2 text-sm text-muted"><CalendarDays size={16} aria-hidden="true" />참여 예정{!row.partialPeriod && <span className="ml-auto text-foreground">전체 참석</span>}</p>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
              <div><p className="text-xs text-muted-2">시작</p><p className="mt-1 tabular-nums text-foreground">{row.attend_from ?? startsOn ?? "행사 시작"}</p></div>
              <ArrowRight size={16} className="text-muted" aria-hidden="true" />
              <div className="text-right"><p className="text-xs text-muted-2">종료</p><p className="mt-1 tabular-nums text-foreground">{row.attend_to ?? endsOn ?? "행사 종료"}</p></div>
            </div>
          </section>
          <section aria-label={`${row.name} 이동 정보`} className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted"><Bus size={16} aria-hidden="true" />버스 이용<Badge variant="mute" dot={false}>{attendanceSummary(row.up_trip_id, row.down_trip_id, trips)}</Badge></p>
            <div className="flex flex-wrap gap-2">{(["up", "down"] as const).map((direction) => {
              const leg = row[direction]; const badge = transportBadge(leg?.mode, leg?.status, leg?.via);
              return badge ? <Badge key={direction} variant={badge.tone} dot={false} title={`${DIRECTION_LABELS[direction]} — ${badge.title}`}>{DIRECTION_SHORT[direction]} {badge.text}</Badge> : null;
            })}{(!row.up || row.up.mode === "our_bus") && (!row.down || row.down.mode === "our_bus") && <span className={`text-sm ${row.missing ? "text-warning" : "text-muted-2"}`}>{row.missing ? "이동수단 기록 없음" : "별도 이동수단 없음"}</span>}</div>
          </section>
          <section aria-label={`${row.name} 현장 실제 기록`} className="border-t border-border pt-3">
            <h4 className="mb-2 text-sm font-medium text-foreground">현장 실제 기록 · KST</h4>
            <OnsiteAttendance registrationId={row.id} name={row.name} startsOn={startsOn} endsOn={endsOn} />
          </section>
          <div className="border-t border-border pt-3"><p className="text-xs text-muted-2">비고</p><p className="mt-1 break-words whitespace-pre-wrap text-sm text-muted">{row.note?.trim() ? row.note : "—"}</p></div>
        </div>
      </li>)}</ul>}
  </Card>;
}
