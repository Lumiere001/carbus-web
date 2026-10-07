"use client";

import { useState, type ReactNode, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";

export type BoardDay = { readonly key: string; readonly label: string; readonly date: string | null };
export type TimeEntry = {
  readonly key: string;
  readonly day: string;
  readonly time: string | null;
  readonly count?: number;
  readonly content: ReactNode;
};

export function boardDate(value: string | null): string {
  if (!value) return "날짜 미정";
  return new Date(`${value}T00:00:00+09:00`).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short",
  });
}

/** Point-in-time entries: row height represents content, never an invented duration. */
export function TimeBoard({ label, days, entries }: {
  readonly label: string;
  readonly days: readonly BoardDay[];
  readonly entries: readonly TimeEntry[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const activeDay = days.find((day) => day.key === selected)?.key ?? days[0]?.key;
  const tableStyle: CSSProperties & { readonly "--board-min-width": string } = { "--board-min-width": `${5 + days.length * 12}rem` };
  const times = [...new Set(entries.map((entry) => entry.time?.slice(0, 5) ?? ""))].sort();
  const byCell = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const key = `${entry.day}|${entry.time?.slice(0, 5) ?? ""}`;
    const cell = byCell.get(key);
    if (cell) cell.push(entry); else byCell.set(key, [entry]);
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 md:hidden" aria-label={`${label} 날짜 선택`}>
        {days.map((day) => (
          <Button key={day.key} size="default" variant={day.key === activeDay ? "default" : "secondary"}
            aria-pressed={day.key === activeDay} onClick={() => setSelected(day.key)}>
            {day.date ? boardDate(day.date) : day.label}
          </Button>
        ))}
      </div>
      <p className="px-4 py-3 text-xs text-muted">한국 시간(KST) · 등록된 시작 시각만 표시합니다. <span className="inline-block">칸의 높이는 소요 시간이 아닙니다.</span></p>
      <div className="max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200" tabIndex={0} role="region" aria-label={`${label} 시간표 영역`}>
        <table style={tableStyle} className="w-full table-fixed border-collapse text-left text-sm md:min-w-[var(--board-min-width)]" aria-label={`${label} 시간표`}>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="w-20 border-b border-border p-3 text-xs text-muted">시각</th>
              {days.map((day) => (
                <th scope="col" key={day.key} className={`${day.key === activeDay ? "" : "hidden md:table-cell "}min-w-48 border-b border-l border-border p-3 align-top font-medium`}>
                  <span className="block text-base text-foreground">{day.date ? boardDate(day.date) : day.label}</span>
                  {day.date && <span className="block text-xs text-muted">{day.label}</span>}
                  <span className="block text-xs font-normal text-muted">{entries.filter((entry) => entry.day === day.key).reduce((total, entry) => total + (entry.count ?? 1), 0)}건</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {times.map((time) => (
              <tr key={time} className={byCell.has(`${activeDay}|${time}`) ? "" : "hidden md:table-row"}>
                <th scope="row" aria-label={time || "시간 미정"} className="whitespace-nowrap border-b border-border bg-surface-2 p-3 align-top font-medium tabular-nums">
                  {time || <span className="text-warning whitespace-nowrap">미정</span>}
                </th>
                {days.map((day) => {
                  const cell = byCell.get(`${day.key}|${time}`) ?? [];
                  return <td key={day.key} className={`${day.key === activeDay ? "" : "hidden md:table-cell "}border-b border-l border-border p-3 align-top`}>
                    {cell.length > 0 ? <ul className="flex flex-wrap gap-2">{cell.map((entry) => <li key={entry.key} className="min-w-0 max-w-full [overflow-wrap:anywhere]">{entry.content}</li>)}</ul> : <span className="text-muted-2" aria-label="신청 없음">—</span>}
                  </td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
