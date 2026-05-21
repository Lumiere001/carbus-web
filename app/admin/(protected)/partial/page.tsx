import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dayLabel } from "@/lib/labels";
import type { DepartureDay } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type Reg = {
  id: string;
  name: string;
  student_id: string;
  campus_id: string;
  departure_day: DepartureDay | null;
  uses_return_bus: boolean;
  note: string | null;
};

function partialLabel(r: Reg): string {
  // 편도: 상행만(하행 미이용) 또는 하행만(요일 없음)
  if (r.departure_day !== null && !r.uses_return_bus)
    return `편도 상행 (${dayLabel(r.departure_day)})`;
  if (r.departure_day === null && r.uses_return_bus) return "편도 하행";
  return "편도";
}

export default async function AdminPartialPage() {
  const supabase = await createClient();
  const [regRes, campusRes] = await Promise.all([
    supabase
      .from("registrations")
      .select("id, name, student_id, campus_id, departure_day, uses_return_bus, note")
      .eq("attendance_type", "oneway")
      .order("campus_id"),
    supabase.from("campuses").select("id, name, display_order"),
  ]);
  const regs = (regRes.data ?? []) as Reg[];
  const campuses = (campusRes.data ?? []).sort(
    (a, b) => a.display_order - b.display_order
  );

  const byCampus = new Map<string, Reg[]>();
  for (const r of regs) {
    const list = byCampus.get(r.campus_id) ?? [];
    list.push(r);
    byCampus.set(r.campus_id, list);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">부분 참석자</h2>
        <p className="text-sm text-muted mt-0.5">
          편도(상행만 / 하행만) 신청자 모음 · 비고 포함 — 총{" "}
          <b className="text-foreground tabular-nums">{regs.length}</b>명
        </p>
      </div>

      {regs.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-muted">부분 참석자(편도)가 없습니다.</p>
        </Card>
      ) : (
        campuses
          .filter((c) => (byCampus.get(c.id)?.length ?? 0) > 0)
          .map((c) => {
            const members = byCampus.get(c.id) ?? [];
            return (
              <Card key={c.id} title={c.name} subtitle={`${members.length}명`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-2 text-muted text-left">
                        <th className="px-4 py-2.5">이름</th>
                        <th className="px-4 py-2.5">학번</th>
                        <th className="px-4 py-2.5">유형</th>
                        <th className="px-4 py-2.5">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          <td className="px-4 py-2 text-foreground whitespace-nowrap">
                            {r.name}
                          </td>
                          <td className="px-4 py-2 text-muted-2">{r.student_id}</td>
                          <td className="px-4 py-2">
                            <Badge variant="mute">{partialLabel(r)}</Badge>
                          </td>
                          <td className="px-4 py-2 text-muted-2 whitespace-pre-wrap break-words max-w-[20rem]">
                            {r.note?.trim() ? r.note : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })
      )}
    </div>
  );
}
