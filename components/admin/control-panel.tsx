"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PencilLine, Lock } from "lucide-react";
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
  const router = useRouter();
  const [phase, setLocalPhase] = useState<SystemPhase>(initialPhase);
  const [batch, setLocalBatch] = useState(initialBatch);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  function handlePhase(next: SystemPhase) {
    if (next === phase) return;
    const label = next === "phase2" ? "마감" : "입력";
    if (!confirm(`시스템 단계를 '${label}'(으)로 전환할까요?`)) return;
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

      {/* Phase 전환 */}
      <Card title="운영 단계" subtitle="순장/순원 입력 단계와 배차/마감 단계 전환">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">현재 단계</span>
            <Badge variant={phase === "phase2" ? "primary" : "mute"}>
              {phase === "phase2" ? "마감 단계" : "입력 단계"}
            </Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => handlePhase("phase1")}
              className={
                "text-left rounded-xl border p-4 transition disabled:opacity-50 " +
                (phase === "phase1"
                  ? "border-primary-300 bg-primary-50 ring-1 ring-primary-200"
                  : "border-border hover:bg-surface-2")
              }
            >
              <div className="flex items-center gap-2 font-medium text-foreground">
                <PencilLine size={16} className="text-primary-700" />
                입력 단계
              </div>
              <p className="text-xs text-muted mt-1">
                각 캠퍼스 임역원이 순장/순원 명단과 차량 신청을 입력·수정하는
                기간입니다. 신청을 받는 중일 때 이 단계로 둡니다.
              </p>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => handlePhase("phase2")}
              className={
                "text-left rounded-xl border p-4 transition disabled:opacity-50 " +
                (phase === "phase2"
                  ? "border-primary-300 bg-primary-50 ring-1 ring-primary-200"
                  : "border-border hover:bg-surface-2")
              }
            >
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Lock size={16} className="text-primary-700" />
                마감 단계
              </div>
              <p className="text-xs text-muted mt-1">
                신청을 마감하고 배차·정산을 진행하는 기간입니다. 명단이 다 모이면
                이 단계로 바꾼 뒤 ‘배차’를 실행하세요.
              </p>
            </button>
          </div>
        </div>
      </Card>

      {/* 배차 활성화 */}
      <Card title="배차 활성화" subtitle="배차 실행 기능 on/off">
        <div className="p-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                배차 실행
              </span>
              <Badge variant={batch ? "success" : "mute"}>
                {batch ? "활성" : "비활성"}
              </Badge>
            </div>
            <p className="text-xs text-muted mt-1">
              비활성 시에도 /admin/batch 접근은 가능하나, 이 플래그로 운영 의도를 표시.
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
          마지막 변경: {new Date(updatedAt).toLocaleString("ko-KR")}
        </p>
      )}
    </div>
  );
}
