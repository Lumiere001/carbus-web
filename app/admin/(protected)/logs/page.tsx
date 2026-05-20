import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Database, Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type ChangeType = Database["public"]["Enums"]["request_type"];

const CHANGE_LABEL: Record<ChangeType, string> = {
  insert: "추가",
  update: "수정",
  delete: "삭제",
};
const CHANGE_VARIANT: Record<ChangeType, "success" | "primary" | "danger"> = {
  insert: "success",
  update: "primary",
  delete: "danger",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR");
}

/** before/after jsonb 에서 순장/순원 이름 추출 (방어적). */
function nameOf(after: Json | null, before: Json | null): string {
  const pick = (j: Json | null): string | null => {
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const n = (j as Record<string, Json | undefined>).name;
      return typeof n === "string" ? n : null;
    }
    return null;
  };
  return pick(after) ?? pick(before) ?? "—";
}

export default async function AdminLogsPage() {
  const supabase = await createClient();

  const [auditRes, runsRes] = await Promise.all([
    supabase
      .from("registration_audit")
      .select("id, created_at, change_type, before_value, after_value, changed_by")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("batch_runs")
      .select("id, run_at, success, total_assigned, empty_seats, elapsed_ms, trigger_reason")
      .order("run_at", { ascending: false })
      .limit(10),
  ]);

  const audit = auditRes.data ?? [];
  const runs = runsRes.data ?? [];

  // 변경자 이름 매핑 (display_name 없으면 역할 라벨로 fallback → 추적 가능하게)
  const ROLE_LABEL: Record<string, string> = {
    master: "총단 운영자",
    viewer: "운영자(보기)",
    campus_admin: "임역원",
    guest: "게스트",
  };
  const changerIds = [...new Set(audit.map((a) => a.changed_by).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (changerIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name, role")
      .in("id", changerIds);
    for (const p of profs ?? []) {
      const label =
        p.display_name && p.display_name.trim()
          ? p.display_name
          : ROLE_LABEL[p.role] ?? "—";
      nameById.set(p.id, label);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">로그</h2>
        <p className="text-sm text-muted mt-0.5">순장/순원 변경 이력 · 배차 실행 이력</p>
      </div>

      <Card title="순장/순원 변경 이력" subtitle="최근 50건 (audit)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2.5">시각</th>
                <th className="px-4 py-2.5">유형</th>
                <th className="px-4 py-2.5">대상</th>
                <th className="px-4 py-2.5">변경자</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted-2 py-6">
                    변경 이력이 없습니다.
                  </td>
                </tr>
              )}
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-2 text-muted-2 whitespace-nowrap">
                    {fmt(a.created_at)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={CHANGE_VARIANT[a.change_type]}>
                      {CHANGE_LABEL[a.change_type]}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-foreground">
                    {nameOf(a.after_value, a.before_value)}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {a.changed_by ? nameById.get(a.changed_by) ?? "—" : "시스템"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="배차 실행 이력" subtitle="최근 10건">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2.5">시각</th>
                <th className="px-4 py-2.5">결과</th>
                <th className="px-4 py-2.5">배정</th>
                <th className="px-4 py-2.5">소요</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted-2 py-6">
                    배차 실행 이력이 없습니다.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 text-muted-2 whitespace-nowrap">
                    {fmt(r.run_at)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={r.success ? "success" : "danger"}>
                      {r.success ? "성공" : "실패"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 tabular-nums">{r.total_assigned ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-2">
                    {r.elapsed_ms != null ? `${r.elapsed_ms}ms` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
