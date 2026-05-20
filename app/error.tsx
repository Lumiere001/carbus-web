"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * 전역 에러 바운더리 — 예상 못 한 런타임 오류 시 흰 화면 대신 친절한 안내.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 개발 중 콘솔 확인용 (운영에선 로깅 서비스 연동 가능)
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-surface rounded-xl shadow-2 border border-border p-8 space-y-5 text-center">
        <div className="w-12 h-12 rounded-full bg-danger-bg border border-danger-border flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6 text-danger" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold text-foreground">
            문제가 발생했어요
          </h1>
          <p className="text-sm text-muted leading-relaxed">
            일시적인 오류일 수 있어요. 다시 시도해 주세요. 계속되면 운영자에게
            문의해 주세요.
          </p>
        </div>
        <button
          onClick={reset}
          className="w-full h-10 rounded-lg bg-primary-800 hover:bg-primary-700 text-white font-medium transition"
        >
          다시 시도
        </button>
        {error.digest && (
          <p className="text-xs text-muted-2 font-mono">오류 코드: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
