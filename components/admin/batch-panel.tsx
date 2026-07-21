"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, CircleCheck, TriangleAlert, Clock, ArrowUp, ArrowDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { runBatchAction, type BatchActionResult } from "@/app/admin/(protected)/batch/actions";
import { setAssignment } from "@/lib/admin/registrations";
import { slotLabel } from "@/lib/labels";
import type { DepartureSlot } from "@/lib/supabase/types";

export type BatchRunRow = {
  id: string;
  run_at: string;
  success: boolean;
  total_assigned: number | null;
  empty_seats: number | null;
  error_message: string | null;
  elapsed_ms: number | null;
  trigger_reason: string | null;
};
export type UnassignedRow = {
  id: string;
  name: string;
  student_id: string;
  campus_name: string;
};
export type BusOption = { id: number; name: string; up_trip_id: number | null };

function fmt(iso: string | null): string {
  if (!iso) return "기록 없음";
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BatchPanel({
  upParticipants,
  upAssigned,
  downParticipants,
  downAssigned,
  upUnassigned,
  downUnassigned,
  buses,
  slots,
  lastBatchAt,
  currentPhase,
  runs,
  pinStatus,
}: {
  upParticipants: number;
  upAssigned: number;
  downParticipants: number;
  downAssigned: number;
  upUnassigned: UnassignedRow[];
  downUnassigned: UnassignedRow[];
  buses: BusOption[];
  slots: Pick<DepartureSlot, "id" | "label">[];
  lastBatchAt: string | null;
  currentPhase: string;
  runs: BatchRunRow[];
  /** 차량순장·고정탑승 현황 + 미반영(stale) 수 (방향별). */
  pinStatus: {
    upPins: number;
    downPins: number;
    upStale: number;
    downStale: number;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<BatchActionResult | null>(null);

  function run(mode: "up" | "down") {
    const label = mode === "up" ? "상행" : "하행";
    if (
      !confirm(
        `${label} 배차를 새로 계산해 덮어씁니다.\n\n` +
          `⚠️ 수동으로 직접 옮긴 ${label} 배정은 모두 사라지고 다시 계산됩니다.\n` +
          `특정 인원을 그대로 두려면 호차 화면에서 '고정 탑승자'로 지정한 뒤 실행하세요.\n\n` +
          `진행할까요?`
      )
    )
      return;
    setResult(null);
    startTransition(async () => {
      const res = await runBatchAction(mode);
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  const upUn = upParticipants - upAssigned;
  const downUn = downParticipants - downAssigned;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">배차 실행</h2>
        <p className="text-sm text-muted mt-0.5">
          버튼을 누르면 전체 인원을 호차에 자동으로 나눠 배정합니다. 같은 캠퍼스는
          되도록 같은 호차로, 호차는 정원까지 꽉 채워 미배정이 없게 합니다.
          상행·하행은 따로 실행합니다.
        </p>
      </div>

      {/* 권장 운영 순서 안내 */}
      <div className="text-sm rounded-lg px-3 py-2 border bg-primary-50 border-primary-200 text-primary-800">
        <b>권장 순서</b> ① 호차 화면에서 차량순장·고정탑승을 먼저 지정 → ② 여기서 배차 실행 →
        ③ 결과 확인. 고정 지정을 <b>배차 실행 후</b>에 바꾸면 다시 실행해야 반영됩니다.
        <span className="ml-1 text-primary-700">
          (현재 고정: 상행 {pinStatus.upPins}명 · 하행 {pinStatus.downPins}명)
        </span>
      </div>

      {/* 미반영(stale) 경고 — 고정 지정이 마지막 배차에 안 들어간 경우 */}
      {(pinStatus.upStale > 0 || pinStatus.downStale > 0) && (
        <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning flex items-start gap-2">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            <b>재배차 필요</b> — 차량순장·고정탑승 지정이 현재 배차 결과에 반영되지 않았습니다
            {pinStatus.upStale > 0 && ` (상행 ${pinStatus.upStale}명`}
            {pinStatus.upStale > 0 && pinStatus.downStale > 0 && ", "}
            {pinStatus.downStale > 0 &&
              `${pinStatus.upStale > 0 ? "" : " ("}하행 ${pinStatus.downStale}명`}
            {(pinStatus.upStale > 0 || pinStatus.downStale > 0) && ")"}.
            해당 방향 <b>배차 실행</b>을 다시 눌러주세요.
          </span>
        </div>
      )}

      {currentPhase !== "phase2" && (
        <div className="text-sm rounded-lg px-3 py-2 border bg-warning-bg border-warning-border text-warning">
          아직 <b>입력 단계</b>입니다. 신청을 마감한 뒤 배차하는 게 보통이지만, 지금
          미리 돌려봐도 됩니다. (마감 전환은 ‘Phase’ 화면)
        </div>
      )}

      {/* 상행/하행 현황 + 실행 버튼 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {[
          {
            mode: "up" as const,
            icon: <ArrowUp size={16} />,
            label: "상행 (올라갈 때)",
            part: upParticipants,
            assigned: upAssigned,
            un: upUn,
          },
          {
            mode: "down" as const,
            icon: <ArrowDown size={16} />,
            label: "하행 (내려올 때)",
            part: downParticipants,
            assigned: downAssigned,
            un: downUn,
          },
        ].map((s) => (
          <Card key={s.mode} className="p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-medium text-foreground">
                {s.icon}
                {s.label}
              </span>
              <Button onClick={() => run(s.mode)} disabled={pending}>
                <Play size={14} />
                {pending ? "계산 중…" : "배차 실행"}
              </Button>
            </div>
            <div className="mt-3 flex gap-4 text-sm">
              <span className="text-muted">
                대상 <b className="text-foreground tabular-nums">{s.part}</b>
              </span>
              <span className="text-success">
                배정 <b className="tabular-nums">{s.assigned}</b>
              </span>
              <span className={s.un > 0 ? "text-warning" : "text-muted-2"}>
                미배정 <b className="tabular-nums">{s.un}</b>
              </span>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-2 flex items-center gap-1">
        <Clock size={12} /> 마지막 배차: {fmt(lastBatchAt)}
      </p>

      {/* 실행 결과 */}
      {result && (
        <Card title="실행 결과" subtitle={result.ok ? (result.mode === "up" ? "상행" : "하행") : "실패"}>
          <div className="p-5">
            {result.ok ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={result.errors.length === 0 ? "success" : "warning"}>
                    {result.errors.length === 0 ? <CircleCheck size={12} /> : <TriangleAlert size={12} />}
                    {result.errors.length === 0 ? "성공" : "경고 포함"}
                  </Badge>
                  <span className="text-sm text-foreground tabular-nums">
                    배정 {result.total_assigned}명
                  </span>
                </div>
                {result.errors.length > 0 && (
                  <ul className="text-sm text-warning list-disc list-inside space-y-0.5">
                    {result.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-danger">{result.message}</p>
            )}
          </div>
        </Card>
      )}

      {/* 미배정 인원 — 한 번에 보고 직접 배정 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <UnassignedList
          title="상행 미배정"
          mode="up"
          rows={upUnassigned}
          buses={buses}
          slots={slots}
        />
        <UnassignedList
          title="하행 미배정"
          mode="down"
          rows={downUnassigned}
          buses={buses}
          slots={slots}
        />
      </div>

      {/* 실행 이력 */}
      <Card title="실행 이력" subtitle="최근 8회">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-muted text-left">
                <th className="px-4 py-2">시각</th>
                <th className="px-4 py-2">방향</th>
                <th className="px-4 py-2">결과</th>
                <th className="px-4 py-2">배정</th>
                <th className="px-4 py-2">소요</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted-2 py-6">
                    아직 배차 실행 이력이 없습니다.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 text-foreground">{fmt(r.run_at)}</td>
                  <td className="px-4 py-2 text-muted">
                    {r.trigger_reason === "manual-down"
                      ? "하행"
                      : r.trigger_reason === "manual-up"
                        ? "상행"
                        : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {r.success ? (
                      <Badge variant="success">성공</Badge>
                    ) : (
                      <Badge variant="danger">실패</Badge>
                    )}
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

/** 미배정 인원 목록 + 호차 직접 배정 (master). */
function UnassignedList({
  title,
  mode,
  rows,
  buses,
  slots,
}: {
  title: string;
  mode: "up" | "down";
  rows: UnassignedRow[];
  buses: BusOption[];
  slots: Pick<DepartureSlot, "id" | "label">[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function assign(id: string, value: string) {
    if (!value) return;
    const busId = Number(value);
    startTransition(async () => {
      const res = await setAssignment(
        id,
        mode === "up"
          ? { assigned_up_bus_id: busId }
          : { assigned_down_bus_id: busId }
      );
      if (!res.ok) return setErr(res.message);
      setErr(null);
      router.refresh();
    });
  }

  return (
    <Card title={title} subtitle={`${rows.length}명 — 배차 후 남은 인원`}>
      {err && (
        <p className="px-5 pt-3 text-sm text-danger">{err}</p>
      )}
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-success">미배정 없음 ✓</p>
      ) : (
        <div className="max-h-72 overflow-y-auto divide-y divide-border">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 px-5 py-2">
              <span className="text-sm text-foreground">
                {r.name}
                <span className="ml-1.5 text-xs text-muted-2">
                  {r.campus_name} · {r.student_id}
                </span>
              </span>
              <select
                defaultValue=""
                disabled={pending}
                onChange={(e) => assign(r.id, e.target.value)}
                className="text-xs border border-border-2 rounded-md px-1.5 py-1 bg-surface"
              >
                <option value="">호차 배정…</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {mode === "up" ? ` (${slotLabel(b.up_trip_id, slots)})` : ""}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
