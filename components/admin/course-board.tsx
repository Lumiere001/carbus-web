import { Card } from "@/components/ui/card";
import { TriangleAlert } from "lucide-react";
import { dayLabel } from "@/lib/courses/days";
import { TimeBoard } from "@/components/schedule/time-board";

export type CourseRow = {
  id: number;
  dayNo: number;
  /** `HH:MM`. null = 시간 미정 — 그 날 묶음의 맨 위에 모인다. */
  atTime: string | null;
  personName: string;
  studentId: string | null;
  campusName: string | null;
  campusOrder: number | null;
  /** 행사 시작일 + (dayNo-1) 로 **계산된** 날짜. 저장된 값이 아니다. */
  onDate: string | null;
};

export function CourseBoard({ rows }: { readonly rows: readonly CourseRow[] }) {
  const byDay = new Map<number, CourseRow[]>();
  for (const row of rows) {
    const people = byDay.get(row.dayNo);
    if (people) people.push(row); else byDay.set(row.dayNo, [row]);
  }
  const days = [...byDay].sort(([a], [b]) => a - b).map(([dayNo, members]) => ({
    dayNo, onDate: members[0]?.onDate ?? null,
    people: [...members].sort((a, b) => (a.campusOrder ?? 999) - (b.campusOrder ?? 999) || a.personName.localeCompare(b.personName)),
  }));
  const undecided = rows.filter((row) => !row.atTime).length;
  return <Card title="수강신청 현황" subtitle={`신청 ${rows.length}건 · 한 사람의 여러 날짜 신청을 각각 집계합니다`}>
    {rows.length === 0 ? <p className="px-5 py-6 text-sm text-muted-2">아직 수강신청이 없습니다. <b>전체 순장/순원</b> 화면에서 사람을 열고 수강신청에서 듣는 날을 고르면 여기에 모입니다.</p> : <>
      {undecided > 0 && <div className="flex items-start gap-2 border-b border-border bg-danger-bg/40 px-5 py-3 text-sm text-danger">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span><span className="inline-block"><b>신청 {undecided}건</b>의 시간이 미정입니다.</span> <span className="inline-block">강의 시각을 확인해 주세요.</span></span>
      </div>}
      <TimeBoard label="수강신청" days={days.map((day) => ({ key: String(day.dayNo), label: dayLabel(day.dayNo), date: day.onDate }))}
        entries={days.flatMap((day) => day.people.map((person) => ({
          key: String(person.id), day: String(day.dayNo), time: person.atTime,
          content: <span className="inline-block rounded-md bg-surface-2 px-2 py-1"><span className="text-foreground">{person.personName}</span><span className="ml-1 text-xs text-muted">{person.campusName}{person.studentId ? ` · ${person.studentId}` : ""}</span></span>,
        })))} />
    </>}
  </Card>;
}
