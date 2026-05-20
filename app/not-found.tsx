import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-surface rounded-xl shadow-2 border border-border p-8 space-y-5 text-center">
        <div className="w-12 h-12 rounded-full bg-surface-2 border border-border flex items-center justify-center mx-auto">
          <Compass className="w-6 h-6 text-muted" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold text-foreground">
            페이지를 찾을 수 없어요
          </h1>
          <p className="text-sm text-muted">
            주소가 바뀌었거나 없는 페이지일 수 있어요.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center justify-center w-full h-10 rounded-lg border border-border bg-surface hover:bg-surface-2 text-foreground font-medium transition"
        >
          홈으로
        </Link>
      </div>
    </main>
  );
}
