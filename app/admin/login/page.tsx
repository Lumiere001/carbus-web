import Link from "next/link";
import { loginWithAdminPassword } from "./actions";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-surface rounded-xl shadow-2 border border-border p-8 space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">
            운영자 로그인
          </h1>
          <p className="text-sm text-muted">
            운영자 비밀번호를 입력하세요. 권한(viewer / master)은 비밀번호로
            자동 결정됩니다.
          </p>
        </div>

        <form action={loginWithAdminPassword} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-foreground mb-1"
            >
              비밀번호
            </label>
            <input
              type="password"
              id="password"
              name="password"
              required
              autoFocus
              autoComplete="current-password"
              className="w-full h-10 px-3 text-sm bg-surface border border-border rounded-lg focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
            />
          </div>

          {error ? (
            <div className="text-sm text-danger bg-danger-bg border border-danger-border rounded-lg px-3 py-2">
              {decodeURIComponent(error)}
            </div>
          ) : null}

          <button
            type="submit"
            className="w-full h-11 px-4 rounded-lg bg-primary-800 hover:bg-primary-700 text-white font-medium transition shadow-sm"
          >
            로그인
          </button>
        </form>

        <div className="text-center text-sm text-muted pt-2 border-t border-border">
          <Link href="/login" className="hover:text-foreground underline">
            임역원 Google 로그인은 여기로
          </Link>
        </div>
      </div>
    </main>
  );
}
