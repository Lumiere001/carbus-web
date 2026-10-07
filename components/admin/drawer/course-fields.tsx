import { dayLabel } from "@/lib/courses/days";
import type { RegDrawerProps } from "./types";

export function DrawerCourseFields({
  courses, dayCount, busy, toggleCourse, saveCourseTime,
}: Pick<RegDrawerProps, "courses" | "dayCount"> & {
  readonly busy: boolean;
  readonly toggleCourse: (dayNo: number, on: boolean) => void;
  readonly saveCourseTime: (dayNo: number, value: string) => void;
}) {
  // 부모가 저장 후 읽은 서버 값에서 곧바로 표시한다.
  const courseDays = new Set(courses.map((course) => course.dayNo));
  const courseTimes = new Map(
    courses.map((course) => [course.dayNo, (course.atTime ?? "").slice(0, 5)] as const)
  );
  return (
    <div className="rounded-lg border border-border bg-surface-2/40 p-3 space-y-2.5">
      <p className="text-xs text-muted-2 leading-snug">
        <b className="text-foreground">수강신청 · 바로 저장</b> — <span className="whitespace-nowrap">듣는 날만 고르세요.</span>
        <b className="whitespace-nowrap"> 해당 없으면 선택하지 마세요.</b>
      </p>
      {Array.from({ length: dayCount }, (_, index) => index + 1).map((day) => {
        const on = courseDays.has(day);
        return (
          <div key={day} className={
            "flex items-center gap-2 rounded-md border px-2 py-1.5 " +
            (on ? "border-border bg-primary-50/60" : "border-border bg-surface")
          }>
            <label className="flex items-center gap-2 text-sm flex-1 min-w-0 cursor-pointer">
              <input
                type="checkbox"
                checked={on}
                disabled={busy}
                onChange={(event) => toggleCourse(day, event.target.checked)}
                aria-label={`${dayLabel(day)} 수강신청`}
              />
              <span className="truncate">
                {dayLabel(day)}
                {on && !courseTimes.get(day) && <span className="ml-1 text-xs text-warning">시간 미정</span>}
              </span>
            </label>
            <input
              type="time"
              value={courseTimes.get(day) ?? ""}
              disabled={busy || !on}
              onChange={(event) => saveCourseTime(day, event.target.value)}
              aria-label={`${dayLabel(day)} 시간`}
              className={
                "rounded-md border border-border-2 bg-surface px-2 py-1 text-sm text-foreground tabular-nums " +
                (on ? "" : "opacity-40")
              }
            />
          </div>
        );
      })}
      <p className="text-xs text-muted-2 leading-snug">
        시간은 나중에 적어도 됩니다 — 비워 두면 수강신청 화면에{" "}
        <span className="whitespace-nowrap"><b>시간 미정</b>으로 모입니다.</span>
      </p>
    </div>
  );
}
