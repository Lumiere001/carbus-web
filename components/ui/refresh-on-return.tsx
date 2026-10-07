"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Returning to a workspace reads its shared DB state without replacing an open draft. */
export function RefreshOnReturn() {
  const { refresh: refreshWorkspace } = useRouter();
  const [waiting, setWaiting] = useState(false);
  const queued = useRef(false);
  useEffect(() => {
    function refresh() {
      if (document.visibilityState !== "visible") return;
      if (document.querySelector('dialog[open], [data-unsaved="true"], main input:focus, main select:focus, main textarea:focus')) {
        queued.current = true; setWaiting(true); return;
      }
      refreshWorkspace();
      queued.current = false;
      setWaiting(false);
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const finishEditing = () => { if (queued.current) refresh(); };
    const observer = new MutationObserver(finishEditing);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "data-unsaved"] });
    const onBlur = () => queueMicrotask(finishEditing);
    document.addEventListener("focusout", onBlur);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); document.removeEventListener("focusout", onBlur); observer.disconnect(); };
  }, [refreshWorkspace]);
  if (!waiting) return null;
  return <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3 text-sm">
    <p>입력 중인 내용을 보호했습니다. 저장하거나 닫으면 최신 자료를 불러옵니다.</p>
  </div>;
}
