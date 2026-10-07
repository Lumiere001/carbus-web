import type { ReactNode } from "react";

export function ComparisonBars({ rows, unit }: {
  readonly rows: readonly { readonly label: string; readonly value: number; readonly display: ReactNode }[];
  readonly unit: string;
}) {
  const minimum = Math.min(0, ...rows.map((row) => row.value));
  const maximum = Math.max(0, ...rows.map((row) => row.value));
  const span = maximum - minimum || 1;
  const zero = -minimum / span * 100;
  return <div className="space-y-4">
    <dl className="space-y-4">{rows.map((row) => <div key={row.label} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <dt className="text-sm text-muted">{row.label}</dt>
        <dd className="font-mono text-base tabular-nums text-foreground">{row.display}</dd>
      </div>
      <div aria-hidden="true" className="relative h-3 overflow-hidden rounded-full bg-surface-2">
        <div className="absolute h-full bg-primary-600" style={{ left: `${(Math.min(0, row.value) - minimum) / span * 100}%`, width: `${Math.abs(row.value) / span * 100}%` }} />
        {minimum < 0 && <div className="absolute h-full w-px bg-muted" style={{ left: `${zero}%` }} />}
      </div>
    </div>)}</dl>
    <p className="text-xs text-muted-2">같은 길이 기준 · 단위 {unit} · {minimum.toLocaleString("ko-KR")} ~ {maximum.toLocaleString("ko-KR")}</p>
  </div>;
}
