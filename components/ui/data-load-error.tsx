export function DataLoadError({ retryHref }: { readonly retryHref: string }) {
  return (
    <div role="alert" className="rounded-xl border border-danger-border bg-danger-bg p-5 space-y-3">
      <h2 className="text-lg font-semibold text-danger">정보를 불러오지 못했습니다</h2>
      <p className="text-sm text-foreground">연결 상태를 확인하고 다시 시도해 주세요. 문제가 계속되면 총단에 알려 주세요.</p>
      <a href={retryHref} className="inline-flex min-h-11 items-center rounded-lg border border-danger-border bg-surface px-4 text-sm font-medium text-danger">다시 불러오기</a>
    </div>
  );
}
