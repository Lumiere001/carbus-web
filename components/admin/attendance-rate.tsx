/**
 * 출석률 한 줄 (라벨 + done/total + 퍼센트 + 막대).
 * 분모 0이면 "대상 없음" (NaN/0% 방지). 대시보드·/admin/attendance 공용.
 * presentational only — 서버 컴포넌트에서 직접 사용 가능.
 */
export function AttendanceRate({
  label,
  done,
  total,
  tone = "success",
}: {
  label: string;
  done: number;
  total: number;
  tone?: "success" | "primary";
}) {
  const has = total > 0;
  const pct = has ? Math.round((done / total) * 100) : 0;
  const fill = tone === "success" ? "bg-success" : "bg-primary-600";
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1.5">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums font-medium text-foreground">
          {has ? (
            <>
              {done} / {total}{" "}
              <span className="text-muted-2 font-normal">({pct}%)</span>
            </>
          ) : (
            <span className="text-muted-2 font-normal">대상 없음</span>
          )}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
