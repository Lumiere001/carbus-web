"use client";

import { useConfirmation } from "@/components/ui/use-confirmation";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SystemPhase } from "@/lib/supabase/types";
import { setPhase, setBatchEnabled } from "@/lib/admin/system-config";

export function ControlPanel({
  phase: initialPhase,
  batchEnabled: initialBatch,
  updatedAt,
}: {
  phase: SystemPhase;
  batchEnabled: boolean;
  updatedAt: string | null;
}) {
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const router = useRouter();
  const [phase, setLocalPhase] = useState<SystemPhase>(initialPhase);
  const [batch, setLocalBatch] = useState(initialBatch);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  async function handlePhase(next: SystemPhase) {
    if (next === phase) return;
    const label = next === "phase2" ? "마감" : "입력";
    if (!(await requestConfirmation({ title: "운영 설정을 변경할까요?", description: `전체 운영 설정을 ${label} 단계로 변경합니다.`, confirmLabel: "운영 설정 변경", tone: "default" }))) return;
    startTransition(async () => {
      const res = await setPhase(next);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setLocalPhase(res.row.current_phase);
      setMsg({ type: "ok", text: `${label} 단계로 전환됨` });
      router.refresh();
    });
  }

  function handleBatch(next: boolean) {
    startTransition(async () => {
      const res = await setBatchEnabled(next);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setLocalBatch(res.row.batch_enabled);
      setMsg({ type: "ok", text: next ? "배차 활성화됨" : "배차 비활성화됨" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5 max-w-2xl">
      {confirmationDialog}
      {pending && <p role="status" className="text-sm text-muted">운영 설정 저장 중…</p>}
      {msg && !pending && (
        <div role={msg.type === "err" ? "alert" : "status"}
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

      {/* Phase 전환 */}
      <Card title="전체 운영 단계" subtitle="활성 행사에서 사용하는 입력·마감 설정">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">현재 단계</span>
            <Badge variant={phase === "phase2" ? "primary" : "mute"}>
              {phase === "phase2" ? "마감 단계" : "입력 단계"}
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            {phase === "phase1"
              ? "임역원이 명단과 차량 신청을 입력·수정하는 기간입니다."
              : "신청을 마감하고 배차·정산을 진행하는 기간입니다."}
          </p>
          <Button disabled={pending} onClick={() => handlePhase(phase === "phase1" ? "phase2" : "phase1")}>
            {phase === "phase1" ? "마감 단계로 변경" : "입력 단계로 변경"}
          </Button>
        </div>
      </Card>

      {/* 배차 활성화 */}
      <Card title="배차 운영 상태">
        <div className="p-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant={batch ? "success" : "mute"}>
                {batch ? "활성" : "비활성"}
              </Badge>
            </div>
            <p className="text-xs text-muted mt-1">
              비활성 상태에서도 총단 운영자는 자동 배차를 수동으로 실행할 수 있습니다.
            </p>
          </div>
          <Button
            variant={batch ? "danger" : "default"}
            disabled={pending}
            onClick={() => handleBatch(!batch)}
          >
            {batch ? "비활성화" : "활성화"}
          </Button>
        </div>
      </Card>

      {updatedAt && (
        <p className="text-xs text-muted-2">
          마지막 변경: {new Date(updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
        </p>
      )}
    </div>
  );
}
