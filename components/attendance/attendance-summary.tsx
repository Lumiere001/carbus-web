import { AttendanceRate } from "@/components/admin/attendance-rate";
import { Card } from "@/components/ui/card";
import type { AttendanceState } from "@/lib/attendance/state";
import { attendanceProgress } from "./model";
import type { AttendanceBus, AttendanceGroup, AttendanceSummaryData } from "./model";

type SummaryProps = {
  readonly summary: AttendanceSummaryData;
  readonly upGroups: readonly AttendanceGroup[];
  readonly downGroups: readonly AttendanceGroup[];
  readonly buses: ReadonlyMap<number, AttendanceBus>;
  readonly state: AttendanceState;
};

export function AttendanceSummary({ summary, upGroups, downGroups, buses, state }: SummaryProps) {
  const slotArrived = new Map<number, number>();
  for (const [busId, members] of upGroups) {
    const slotId = buses.get(busId)?.up_trip_id;
    if (slotId == null) continue;
    const { done } = attendanceProgress(members, state, "checked_in");
    slotArrived.set(slotId, (slotArrived.get(slotId) ?? 0) + done);
  }
  const returned = downGroups.reduce(
    (total, [, members]) => total + attendanceProgress(members, state, "checked_out").done,
    0
  );
  const assignedSlots = summary.slots.filter((slot) => slot.total > 0);
  const emptySlots = summary.slots.filter((slot) => slot.total === 0);
  return (
    <Card
      title="출석률"
      subtitle={<>출발 버스 탑승 · 하행 귀가 — 분모는 배차된 인원<span className="whitespace-nowrap">(간사 차량·불참 제외)</span></>}
    >
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-x-6 gap-y-3">
          {assignedSlots.map((slot) => (
            <AttendanceRate
              key={slot.id}
              label={`${slot.label} 출발 버스`}
              done={slotArrived.get(slot.id) ?? 0}
              total={slot.total}
              tone="success"
            />
          ))}
          <AttendanceRate label="하행 귀가" done={returned} total={summary.returnTotal} tone="primary" />
        </div>
        {emptySlots.length > 0 && (
          <details className="border-t border-border">
            <summary className="min-h-11 cursor-pointer py-3 text-sm text-muted focus-visible:outline-2 focus-visible:outline-primary-600">
              배차 없는 출발편 {emptySlots.length}개
            </summary>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-x-6 gap-y-2 pb-2 text-sm">
              {emptySlots.map((slot) => (
                <div key={slot.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <dt className="text-muted [overflow-wrap:anywhere]">{slot.label} 출발 버스</dt>
                  <dd className="text-muted-2"><span className="tabular-nums">0 / 0</span> · 대상 없음</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
    </Card>
  );
}
