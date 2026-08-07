"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TriangleAlert, ChevronDown, ChevronRight } from "lucide-react";
import { dayLabel } from "@/lib/courses/days";

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

/**
 * 수강신청 보드 (동규님 요청, 2026-07-31).
 *
 * **날 → 시간으로 묶으면 그대로 강의실 명단이 된다.** 사람 단위로 흩어져 있으면
 * "둘째날 2시에 몇 명 들어오나" 를 아무도 못 본다.
 *
 * ⚠️ 시간 미정 묶음은 그 날의 맨 위, 빨강이다. 그게 곧 다음에 물어봐야 할
 * 사람들의 명단이다 — 수송 요청 보드에서 같은 방식이 실제로 쓸모 있었다.
 *
 * 날짜(8/20)는 화면에 보여주지만 **저장된 값이 아니다.** 행사 시작일에서 계산한 것이라
 * 행사 날짜를 고치면 저절로 따라간다 — 동규님이 "캠프 날짜가 계속 변한다" 고 짚은 부분.
 */
export function CourseBoard({ rows }: { rows: CourseRow[] }) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const days = useMemo(() => {
    const byDay = new Map<number, CourseRow[]>();
    for (const r of rows) (byDay.get(r.dayNo) ?? byDay.set(r.dayNo, []).get(r.dayNo)!).push(r);
    return [...byDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayNo, members]) => {
        const bySlot = new Map<string, CourseRow[]>();
        for (const m of members) {
          const key = m.atTime ?? "";
          (bySlot.get(key) ?? bySlot.set(key, []).get(key)!).push(m);
        }
        const slots = [...bySlot.entries()]
          .sort((a, b) => {
            // 시간 미정이 위로 — 정렬이 아니라 우선순위다.
            if (!a[0]) return -1;
            if (!b[0]) return 1;
            return a[0].localeCompare(b[0]);
          })
          .map(([time, people]) => ({
            time,
            people: [...people].sort(
              (x, y) =>
                (x.campusOrder ?? 999) - (y.campusOrder ?? 999) ||
                x.personName.localeCompare(y.personName)
            ),
          }));
        return {
          dayNo,
          onDate: members[0]?.onDate ?? null,
          count: members.length,
          undecided: members.filter((m) => !m.atTime).length,
          slots,
        };
      });
  }, [rows]);

  const undecidedTotal = rows.filter((r) => !r.atTime).length;

  const toggle = (dayNo: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dayNo)) next.delete(dayNo);
      else next.add(dayNo);
      return next;
    });

  return (
    <Card
      title="수강신청 현황"
      subtitle={`${rows.length}명 · 날과 시간으로 묶음 — 그대로 강의실 명단이 됩니다`}
    >
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-2">
          아직 수강신청이 없습니다. <b>전체 순장/순원</b> 화면에서 사람을 열고
          수강신청에서 듣는 날을 고르면 여기에 묶여서 보입니다.
        </p>
      ) : (
        <>
          {undecidedTotal > 0 && (
            <div className="px-5 py-3 text-sm text-danger flex items-start gap-2 border-b border-border bg-danger-bg/40">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                <b>{undecidedTotal}명</b>이 시간 미정입니다. 이 사람들에게 몇 시 강의인지
                먼저 물어봐야 강의실을 짤 수 있습니다.
              </span>
            </div>
          )}

          {/* 요약 — 스크롤을 내리지 않고도 어느 날에 몇 명인지 보인다. */}
          <div className="px-5 py-3 border-b border-border flex flex-wrap gap-1.5">
            {days.map((d) => (
              <span
                key={d.dayNo}
                className="text-xs rounded-full border border-border px-2.5 py-1 text-muted"
              >
                {dayLabel(d.dayNo)} <b className="tabular-nums">{d.count}</b>
                {d.undecided > 0 && (
                  <span className="text-danger"> · 미정 {d.undecided}</span>
                )}
              </span>
            ))}
          </div>

          <div className="divide-y divide-border">
            {days.map((d) => {
              const isCollapsed = collapsed.has(d.dayNo);
              return (
                <section key={d.dayNo} aria-label={`${dayLabel(d.dayNo)} 수강신청`}>
                  <button
                    type="button"
                    onClick={() => toggle(d.dayNo)}
                    className="w-full flex flex-wrap items-baseline gap-2 px-5 py-2.5 bg-surface-2 text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} className="text-muted-2 shrink-0 self-center" />
                    ) : (
                      <ChevronDown size={14} className="text-muted-2 shrink-0 self-center" />
                    )}
                    <span className="text-sm font-semibold text-foreground">
                      {dayLabel(d.dayNo)}
                    </span>
                    {/* 날짜는 계산된 값이다 — 행사 날짜를 고치면 저절로 따라간다. */}
                    {d.onDate && (
                      <span className="text-xs text-muted-2 tabular-nums">
                        {formatDate(d.onDate)}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-muted tabular-nums">
                      {d.count}명
                    </span>
                  </button>

                  {!isCollapsed &&
                    d.slots.map((s) => (
                      <div
                        key={s.time || "none"}
                        className={
                          "px-5 py-2.5 border-t border-dashed border-border " +
                          (s.time ? "" : "bg-danger-bg/30")
                        }
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={
                              "text-sm font-semibold tabular-nums " +
                              (s.time ? "text-foreground" : "text-danger")
                            }
                          >
                            {s.time || "시간 미정"}
                          </span>
                          <Badge variant={s.time ? "primary" : "danger"} dot={false}>
                            {s.people.length}명
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                          {s.people.map((p) => (
                            <span key={p.id} className="whitespace-nowrap">
                              <span className="text-foreground">{p.personName}</span>
                              <span className="text-muted-2 text-xs ml-1">
                                {p.campusName}
                                {p.studentId ? ` · ${p.studentId}` : ""}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/** 항상 KST 기준 표기. `2026-08-20` → `8/20 (목)`. */
function formatDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}
