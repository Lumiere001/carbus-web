"use client";

import { useEffect, useState } from "react";

export function AutosaveTextField({ label, value, disabled, onSave, onDirtyChange, multiline = false }: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly multiline?: boolean;
  readonly onSave: (value: string) => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft.trim() !== value;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const props = {
    className: "w-full min-h-10 text-sm border border-border-2 rounded-md px-2.5 py-2 bg-surface disabled:opacity-60",
    value: draft,
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => { if (draft.trim() !== value) onSave(draft.trim()); },
  };
  return <label className="block space-y-1 text-xs text-muted">{label}{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}</label>;
}
