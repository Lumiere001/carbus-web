"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * 앱 자체 확인 대화상자.
 *
 * 왜 `window.confirm` / `window.prompt` 를 안 쓰는가:
 *   ① 브라우저 기본 대화상자는 **탭 전체를 멈춘다.** 점검 중에 실제로 두 번 멈췄고,
 *      사람이 직접 눌러 줘야 진행됐다.
 *   ② 화면과 생김새가 따로 놀아, 되돌릴 수 없는 조작인지 아닌지가 안 읽힌다.
 *   ③ `prompt` 는 "확인"과 "사유 입력"을 한 칸에 섞는다. 사유를 안 적으면 취소한
 *      것인지 사유 없이 진행한 것인지 코드에서 구분이 어렵다(빈 문자열 vs null).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "확인",
  tone = "default",
  /** 사유를 함께 받을 때. 없으면 확인만 한다. */
  reasonLabel,
  reasonPlaceholder,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "default" | "danger";
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 열릴 때 **취소 버튼**에 초점을 준다. 되돌리기 어려운 조작이라 엔터를 눌러
  // 실수로 진행되면 안 된다.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl">
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <div className="mt-1.5 text-sm text-muted leading-relaxed">{description}</div>
          )}
          {reasonLabel && (
            <label className="mt-3 block text-xs text-muted space-y-1">
              {reasonLabel}
              <input
                className="w-full text-sm border border-border-2 rounded-md px-2.5 py-1.5 bg-surface"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
              />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
            그만두기
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "default"}
            onClick={() => {
              onConfirm(reason);
              setReason("");
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
