import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/logout/actions";
import { Clock } from "lucide-react";

export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-surface rounded-xl shadow-2 border border-border p-8 space-y-6 text-center">
        <div className="w-12 h-12 rounded-full bg-surface-2 border border-border flex items-center justify-center mx-auto">
          <Clock className="w-6 h-6 text-muted" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">
          승인 대기 중
        </h1>
        <p className="text-sm text-muted leading-relaxed">
          Google 로그인이 완료되었습니다.
          <br />
          운영자가 캠퍼스 권한을 부여하면 순장/순원 관리 화면에 접근할 수 있습니다.
        </p>
        <div className="text-xs text-muted-2 bg-surface-2 rounded-lg p-3 border border-border">
          로그인 계정: {user?.user_metadata?.name ?? user?.email ?? "(이름 없음)"}
          <br />
          ID: <span className="font-mono">{user?.id?.slice(0, 8) ?? "?"}…</span>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm text-muted hover:text-foreground underline"
          >
            로그아웃
          </button>
        </form>
      </div>
    </main>
  );
}
