import Link from "next/link";
import { signInWithGoogle } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-surface rounded-xl shadow-2 border border-border p-8 space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            임역원 로그인
          </h1>
          <p className="text-sm text-muted">
            Google 계정으로 로그인하세요. 운영자가 캠퍼스 권한을 부여하면 관리
            화면에 접근할 수 있습니다.
          </p>
          <p className="text-sm text-muted-2">
            순장/순원분은 캠퍼스 임역원에게 직접 신청해 주세요.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger">
            로그인을 완료하지 못했어요. 아래 버튼으로 다시 시도해 주세요. 계속되면 운영자에게 문의해 주세요.
          </p>
        )}
        <form action={signInWithGoogle}>
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center h-11 px-4 rounded-lg border border-border bg-surface hover:bg-surface-2 text-foreground font-medium transition shadow-sm"
          >
            Google로 로그인
          </button>
        </form>

        <div className="text-center text-sm text-muted pt-2 border-t border-border">
          <Link href="/admin/login" className="inline-flex min-h-11 items-center justify-center hover:text-foreground underline">
            운영자 로그인은 여기로
          </Link>
        </div>
      </div>
    </main>
  );
}
