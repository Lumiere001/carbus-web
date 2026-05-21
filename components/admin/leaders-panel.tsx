"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Pin, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DAY_LABELS } from "@/lib/labels";
import type { DepartureDay } from "@/lib/supabase/types";
import { assignDriverBus, assignFixedBus } from "@/lib/admin/leaders";

export type LeaderRow = {
  id: string;
  name: string;
  student_id: string;
  campus_name: string;
  kind: "driver" | "fixed";
  departure_day: DepartureDay | null;
  ridesUp: boolean;
  ridesDown: boolean;
  upBusId: number | null;
  downBusId: number | null;
  needUp: boolean;
  needDown: boolean;
};
export type MismatchRow = { id: string; name: string; campus_name: string; detail: string };
export type BusOpt = { id: number; name: string; departure_day: DepartureDay };

export function LeadersPanel({
  leaders,
  mismatches,
  buses,
  isMaster,
}: {
  leaders: LeaderRow[];
  mismatches: MismatchRow[];
  buses: BusOpt[];
  isMaster: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const needCount = leaders.filter((l) => l.needUp || l.needDown).length;

  function assign(row: LeaderRow, mode: "up" | "down", value: string) {
    const busId = value ? Number(value) : null;
    startTransition(async () => {
      const fn = row.kind === "driver" ? assignDriverBus : assignFixedBus;
      const res = await fn(row.id, busId, mode);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setMsg({ type: "ok", text: `${row.name} ${mode === "up" ? "상행" : "하행"} 호차 ${busId ? "지정" : "해제"}` });
      router.refresh();
    });
  }

  const busCell = (row: LeaderRow, mode: "up" | "down") => {
    const rides = mode === "up" ? row.ridesUp : row.ridesDown;
    const cur = mode === "up" ? row.upBusId : row.downBusId;
    const need = mode === "up" ? row.needUp : row.needDown;
    if (!rides) return <span className="text-muted-2">해당 없음</span>;
    const opts =
      mode === "up"
        ? buses.filter((b) => b.departure_day === row.departure_day)
        : buses;
    if (!isMaster) {
      const b = buses.find((x) => x.id === cur);
      return (
        <span className={need ? "text-warning font-medium" : "text-foreground"}>
          {b ? b.name : "미지정"}
        </span>
      );
    }
    return (
      <select
        value={cur ?? ""}
        disabled={pending}
        onChange={(e) => assign(row, mode, e.target.value)}
        className={
          "text-xs border rounded-md px-2 py-1 bg-surface " +
          (need ? "border-warning-border text-warning" : "border-border-2")
        }
      >
        <option value="">미지정</option>
        {opts.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {mode === "up" ? ` (${DAY_LABELS[b.departure_day]})` : ""}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">리더 관리</h2>
        <p className="text-sm text-muted mt-0.5">
          차량순장·고정탑승 역할이 부여된 순장/순원의 호차를 지정합니다. 배차 전에 모두
          호차가 지정돼야 배차를 실행할 수 있습니다.
        </p>
      </div>

      {msg && (
        <div
          className={
            "text-sm rounded-lg px-3 py-2 border " +
            (msg.type === "err"
              ? "bg-danger-bg border-danger-border text-danger"
              : "bg-success-bg border-success-border text-success")
          }
        >
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-muted">
          리더 <b className="text-foreground tabular-nums">{leaders.length}</b>
        </span>
        <span className={needCount > 0 ? "text-warning" : "text-muted-2"}>
          호차 미지정 <b className="tabular-nums">{needCount}</b>
        </span>
      </div>

      {needCount > 0 && (
        <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning flex items-start gap-2">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            호차가 지정되지 않은 리더가 <b>{needCount}명</b> 있습니다. 배차를 실행하려면
            먼저 이들의 호차를 모두 지정해야 합니다.
          </span>
        </div>
      )}

      <Card title="리더 목록" subtitle="차량순장 ★ · 고정탑승 📌">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2.5">이름</th>
                <th className="px-4 py-2.5">캠퍼스 · 학번</th>
                <th className="px-4 py-2.5">역할</th>
                <th className="px-4 py-2.5">상행 호차</th>
                <th className="px-4 py-2.5">하행 호차</th>
              </tr>
            </thead>
            <tbody>
              {leaders.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted-2 py-6">
                    차량순장·고정탑승 역할이 부여된 사람이 없습니다. (전체 순장/순원 화면에서
                    역할을 부여하세요)
                  </td>
                </tr>
              )}
              {leaders.map((l) => (
                <tr
                  key={l.id}
                  className={
                    "border-t border-border " + (l.needUp || l.needDown ? "bg-warning-bg/40" : "")
                  }
                >
                  <td className="px-4 py-2 text-foreground whitespace-nowrap">{l.name}</td>
                  <td className="px-4 py-2 text-muted-2 whitespace-nowrap">
                    {l.campus_name} · {l.student_id}
                  </td>
                  <td className="px-4 py-2">
                    {l.kind === "driver" ? (
                      <Badge variant="warning">
                        <Star size={11} /> 차량순장
                      </Badge>
                    ) : (
                      <Badge variant="primary">
                        <Pin size={11} /> 고정탑승
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">{busCell(l, "up")}</td>
                  <td className="px-4 py-2">{busCell(l, "down")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {mismatches.length > 0 && (
        <Card title="불일치 점검" subtitle="호차에 배정됐지만 역할이 없는 사람">
          <ul className="divide-y divide-border">
            {mismatches.map((m, i) => (
              <li key={`${m.id}-${i}`} className="px-5 py-2.5 text-sm flex justify-between gap-2">
                <span className="text-foreground">
                  {m.name}
                  <span className="ml-1.5 text-xs text-muted-2">{m.campus_name}</span>
                </span>
                <span className="text-muted-2 text-xs">{m.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
