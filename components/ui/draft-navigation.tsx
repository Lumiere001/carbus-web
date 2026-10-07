"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useConfirmation } from "./use-confirmation";

type Navigate = (href: string) => Promise<boolean>;
const DraftNavigation = createContext<Navigate | null>(null);
const hasDraft = () => Boolean(document.querySelector('[data-unsaved="true"]'));
const saving = () => Boolean(document.querySelector('[data-saving="true"]'));

/** Protect page forms when a link or event selector would discard their inputs. */
export function DraftNavigationProvider({ children }: { readonly children: ReactNode }) {
  const { push } = useRouter();
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  const [hint, setHint] = useState("");
  const navigate = useCallback(async (href: string) => {
    setHint("");
    if (saving()) { setHint("이동 전에 저장 결과를 확인해 주세요."); return false; }
    if (hasDraft() && !await requestConfirmation({
      title: "작성 중인 입력을 버리고 이동할까요?",
      description: <>화면에서 작성 중인 내용은 사라집니다. <span className="whitespace-nowrap">이미 저장된 자료는 그대로 남습니다.</span></>,
      confirmLabel: "입력 버리고 이동", tone: "danger",
    })) return false;
    push(href);
    return true;
  }, [push, requestConfirmation]);
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!hasDraft() && !saving()) return;
      event.preventDefault(); event.returnValue = "";
    };
    const onLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download") || link.target === "_blank") return;
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.search === window.location.search)) return;
      if (!hasDraft() && !saving()) return;
      event.preventDefault(); event.stopPropagation();
      void navigate(target.pathname + target.search + target.hash);
    };
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("click", onLink, true);
    return () => { window.removeEventListener("beforeunload", onLeave); document.removeEventListener("click", onLink, true); };
  }, [navigate]);
  return <DraftNavigation value={navigate}>
    {hint && <p role="status" className="border-b border-border bg-surface-2 px-4 py-3 text-sm text-muted">{hint}</p>}
    {children}{confirmationDialog}
  </DraftNavigation>;
}

export function useDraftNavigation() {
  const navigate = useContext(DraftNavigation);
  if (!navigate) throw new Error("Draft navigation needs its workspace provider");
  return navigate;
}
