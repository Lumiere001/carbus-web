"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { scopedRegistrationId } from "@/lib/registrations/view";

export function useRegistrationEditor(rows: readonly { readonly id: string; readonly campus_id: string }[], campusId?: string) {
  const queryId = useSearchParams().get("edit");
  const [selection, setSelection] = useState({ queryId, id: queryId });
  if (selection.queryId !== queryId) setSelection({ queryId, id: queryId });

  const openRegistration = useCallback((id: string) => setSelection({ queryId, id }), [queryId]);
  const closeRegistration = useCallback(() => setSelection({ queryId, id: null }), [queryId]);

  return {
    drawerId: scopedRegistrationId(selection.id, rows, campusId),
    openRegistration,
    closeRegistration,
  };
}
