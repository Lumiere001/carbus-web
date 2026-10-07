"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
import { ChevronDown, Menu, Search, X } from "lucide-react";

export type NavGroup = {
  readonly label: string;
  readonly items: readonly { readonly label: string; readonly href: string }[];
};

export function WorkspaceNav({ groups }: { readonly groups: readonly NavGroup[] }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const searchId = useId();
  const needle = query.trim().toLocaleLowerCase("ko-KR");
  const found = groups.flatMap((group) => group.items.filter((item) => `${group.label} ${item.label}`.toLocaleLowerCase("ko-KR").includes(needle)));
  const menuRef = useRef<HTMLDetailsElement>(null);
  const current = groups.flatMap((group) => group.items).find((item) => item.href === pathname);

  function links() {
    return groups.map((group, index) => {
      const items = group.items.filter((item) => `${group.label} ${item.label}`.toLocaleLowerCase("ko-KR").includes(needle));
      if (!items.length) return null;
      return (
      <div key={group.label} className="space-y-1">
        <h2 className="px-3 pt-5 pb-2 text-base font-mono font-normal tracking-wide text-foreground"><span aria-hidden="true" className="mr-2 text-muted-2">/{String(index + 1).padStart(2, "0")}</span>{group.label}</h2>
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={() => { setQuery(""); if (menuRef.current) menuRef.current.open = false; }}
              className={"flex min-h-11 items-center rounded-full px-3 text-sm transition-colors " +
                (active ? "bg-primary-50 font-normal text-foreground" : "text-muted hover:bg-surface-2 hover:text-foreground")}
            >
              {item.label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-800" aria-hidden="true" />}
            </Link>
          );
        })}
      </div>
    );});
  }

  function search(suffix: string) {
    return <div className="border-b border-border p-2">
      <label htmlFor={`${searchId}-${suffix}`} className="mb-2 block text-sm text-muted">업무 찾기</label>
      <div className="flex min-w-0 items-center gap-2 rounded-full border border-border-2 bg-surface-2 px-3">
        <Search size={16} className="shrink-0 text-muted" aria-hidden="true" />
        <input id={`${searchId}-${suffix}`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="명단, 배차, 정산…" className="min-h-11 w-full min-w-0 bg-transparent text-sm text-foreground focus-visible:outline-2 focus-visible:outline-foreground focus-visible:outline-offset-0" />
        {query && <button type="button" onClick={() => setQuery("")} aria-label="업무 검색 지우기" title="업무 검색 지우기" className="flex min-h-11 min-w-11 items-center justify-center text-muted"><X size={16} /></button>}
      </div>
      {query && <p role="status" className="mt-2 text-xs text-muted">{found.length ? `${found.length}개 업무` : <><span className="inline-block whitespace-nowrap">찾는 업무가 없습니다.</span>{" "}<span className="inline-block whitespace-nowrap">검색어를 바꿔 보세요.</span></>}</p>}
    </div>;
  }

  return (
    <>
      <nav aria-label="업무 메뉴" className="hidden w-52 shrink-0 self-start rounded-xl border border-border bg-surface p-2 md:block md:sticky md:top-4 md:max-h-[calc(100dvh-6rem)] md:overflow-y-auto">
        {search("wide")}
        {links()}
      </nav>
      <details ref={menuRef} className="rounded-xl border border-border bg-surface md:hidden" onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-foreground">
          <Menu size={18} aria-hidden="true" />
          <span>메뉴</span><span className="font-normal text-muted">· {current?.label ?? "전체 업무"}</span>
          <ChevronDown size={16} className="ml-auto" aria-hidden="true" />
        </summary>
        {search("compact")}
        <nav aria-label="업무 메뉴" className="grid grid-cols-2 gap-x-2 border-t border-border p-2 pb-3">{links()}</nav>
      </details>
    </>
  );
}
