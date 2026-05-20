import Link from "next/link";
import { Bus } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-xl w-full text-center space-y-8 py-12">
        <div className="space-y-4">
          <div className="w-12 h-12 rounded-xl bg-primary-800 flex items-center justify-center mx-auto">
            <Bus className="w-6 h-6 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-semibold text-foreground tracking-tight">
              광주지구 여름수련회 차량 관리
            </h1>
            <p className="text-muted text-base">
              CCC 71기 여름수련회 차량 신청·배차·정산 시스템
            </p>
          </div>
        </div>

        <div className="text-sm text-muted bg-surface rounded-xl p-4 border border-border shadow-1">
          <p className="font-medium text-foreground mb-1">시스템 안내</p>
          <p>본 시스템은 캠퍼스 임역원·총단 운영자 전용입니다.</p>
          <p className="mt-1">
            순장/순원분은 캠퍼스 임역원에게 직접 신청해 주세요.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-11 px-6 rounded-lg border border-border bg-surface hover:bg-surface-2 text-foreground font-medium transition shadow-sm"
          >
            Google로 로그인 (임역원)
          </Link>
          <Link
            href="/admin/login"
            className="inline-flex items-center justify-center h-11 px-6 rounded-lg bg-primary-800 hover:bg-primary-700 text-white font-medium transition shadow-sm"
          >
            운영자 로그인
          </Link>
        </div>

        <footer className="text-xs text-muted-2 pt-12">carbus-web · 2026</footer>
      </div>
    </main>
  );
}
