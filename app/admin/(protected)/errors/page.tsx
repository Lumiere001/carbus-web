import { TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

export default async function AdminErrorsPage() {
  const supabase = await createClient();

  const { data: runs } = await supabase
    .from("batch_runs")
    .select("id, run_at, error_message, trigger_reason, total_assigned, elapsed_ms")
    .eq("success", false)
    .order("run_at", { ascending: false })
    .limit(50);

  const rows = runs ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">오류 이력</h2>
        <p className="text-sm text-muted mt-0.5">
          배차 실행 중 발생한 실패·미배정 경고 (최근 50건)
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center">
          <TriangleAlert size={28} className="mx-auto text-success mb-2" />
          <p className="text-sm text-muted">기록된 오류가 없습니다.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <TriangleAlert size={18} className="text-danger mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      배차 실패 · {r.trigger_reason ?? "manual"}
                    </span>
                    <span className="text-xs text-muted-2 whitespace-nowrap">
                      {fmt(r.run_at)}
                    </span>
                  </div>
                  {r.error_message && (
                    <pre className="mt-1.5 text-xs text-danger whitespace-pre-wrap font-sans">
                      {r.error_message}
                    </pre>
                  )}
                  <p className="mt-1 text-xs text-muted-2 tabular-nums">
                    배정 {r.total_assigned ?? 0}명
                    {r.elapsed_ms != null && ` · ${r.elapsed_ms}ms`}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
