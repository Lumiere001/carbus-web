"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unlock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { unlockEventWrites } from "@/lib/admin/events";

/**
 * 지난 행사 잠금 열기 (§25-D 의 마지막 미검증 RPC).
 *
 * 화면 상단 띠는 예전부터 **"고쳐야 하면 Phase 화면에서 사유를 적고 잠금을 여세요"**
 * 라고 안내해 왔다. 그런데 그런 자리가 어디에도 없었다 — RPC 만 있고 부르는 곳이
 * 0곳이었다. 시키는 대로 할 수가 없는 안내였다. 그 자리를 만든다.
 *
 * ⚠️ 이 카드는 **지난 행사를 보고 있을 때만** 나온다. 진행 중인 행사는 원래
 * 쓸 수 있으니 열 것이 없고, 여기 버튼이 늘 보이면 "잠금은 그냥 여는 것" 이 된다.
 */
export function UnlockPanel({
  eventId,
  eventName,
  unlockUntil,
  unlockReason,
}: {
  eventId: string;
  eventName: string;
  /** 지금 열려 있으면 만료 시각(ISO). 닫혀 있으면 null. */
  unlockUntil: string | null;
  unlockReason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const open = unlockUntil != null && new Date(unlockUntil) > new Date();

  function run() {
    setMsg(null);
    start(async () => {
      const res = await unlockEventWrites(eventId, reason.trim(), minutes);
      if (!res.ok) return setMsg({ type: "err", text: res.message });
      setReason("");
      setMsg({
        type: "ok",
        text: `${fmt(res.value)} 까지 열렸습니다. 시간이 지나면 자동으로 다시 잠깁니다.`,
      });
      router.refresh();
    });
  }

  return (
    <Card
      title="지난 행사 잠금"
      subtitle={`'${eventName}' 은(는) 끝난 행사라 읽기 전용입니다. 고쳐야 할 것이 있을 때만 잠시 엽니다.`}
    >
      <div className="px-5 py-4 flex flex-col gap-3">
        {open && (
          <div className="text-sm rounded-lg px-3 py-2 border bg-danger-bg border-danger-border text-danger">
            <b>지금 열려 있습니다</b> — {fmt(unlockUntil!)} 까지.
            {unlockReason && <span className="block mt-0.5">사유: {unlockReason}</span>}
            <span className="block mt-0.5 text-xs">
              시간이 지나면 자동으로 다시 잠깁니다. 따로 닫지 않아도 됩니다.
            </span>
          </div>
        )}

        <p className="text-xs text-muted-2 leading-snug">
          왜 사유를 받나 — 지난 행사를 고치는 일은 드물어야 하고, <b>무엇을 고치려고
          열었는지</b>가 안 남으면 나중에 그 수정이 왜 있는지 아무도 모릅니다.
          기록은 행사에 남습니다.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-2 flex-1 min-w-[16rem]">
            사유 (필수)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 정산 마감 후 환불 1건 반영"
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-2">
            열어둘 시간
            <select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            >
              {[15, 30, 60, 120, 240, 480].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m}분` : `${m / 60}시간`}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="danger"
            size="sm"
            disabled={pending || !reason.trim()}
            onClick={run}
          >
            <Unlock size={14} className="mr-1" />
            {open ? "다시 열기 (시간 연장)" : "잠금 열기"}
          </Button>
        </div>

        {msg && (
          <p
            className={
              "text-sm " + (msg.type === "err" ? "text-danger" : "text-foreground")
            }
          >
            {msg.text}
          </p>
        )}
      </div>
    </Card>
  );
}

/** 항상 KST 로 보여준다 — 현장에서 쓰는 시각이 그거다. */
function fmt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
