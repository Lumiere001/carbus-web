import { Card } from "@/components/ui/card";

/** 채워진 비율 막대. tone 으로 임계 색 전환. */
export function ProgressBar({
  value,
  max,
  tone = "primary",
}: {
  value: number;
  max: number;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fill = {
    primary: "bg-primary-600",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];
  return (
    <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
      <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Kpi({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-primary-50 text-primary-800 p-2">
          {icon}
        </div>
        <p className="min-w-0 text-xs text-muted">{label}</p>
      </div>
      <p className="mt-3 whitespace-nowrap text-xl font-semibold text-foreground tabular-nums leading-tight sm:text-2xl">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-2">{sub}</p>}
    </Card>
  );
}

