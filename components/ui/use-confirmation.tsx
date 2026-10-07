"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ConfirmationRequest = {
  readonly title: string;
  readonly description?: ReactNode;
  readonly confirmLabel: string;
  readonly tone?: "default" | "danger";
};

export function useConfirmation() {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      resolver.current?.(false);
      resolver.current = null;
    };
  }, []);

  const requestConfirmation = useCallback(
    (next: ConfirmationRequest): Promise<boolean> => {
      if (!mounted.current) return Promise.resolve(false);
      resolver.current?.(false);
      return new Promise((resolve) => {
        resolver.current = resolve;
        setRequest(next);
      });
    },
    []
  );

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(confirmed);
  }, []);

  const confirmationDialog = (
    <ConfirmDialog
      open={request !== null}
      title={request?.title ?? ""}
      description={request?.description == null ? undefined : (
        <div className="whitespace-pre-line">{request.description}</div>
      )}
      confirmLabel={request?.confirmLabel}
      tone={request?.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { requestConfirmation, confirmationDialog };
}
