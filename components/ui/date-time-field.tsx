"use client";

import { useEffect, useId, useRef } from "react";

type Props = {
  readonly label: string;
  /** 반쪽 입력도 YYYY-MM-DDT 또는 THH:mm으로 유지한다. 둘 다 비우면 빈 문자열. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly error?: string;
};

export function DateTimeField({ label, value, onChange, disabled, error }: Props) {
  const id = useId();
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (error) {
      if (!dateRef.current?.value) dateRef.current?.focus(); else timeRef.current?.focus();
    }
  }, [error]);
  const [date = "", time = ""] = value.split("T");
  const description = `${id}-hint${error ? ` ${id}-error` : ""}`;
  const change = (nextDate: string, nextTime: string) =>
    onChange(nextDate || nextTime ? `${nextDate}T${nextTime}` : "");
  const inputClass = "min-h-11 min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-base text-foreground sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 aria-invalid:border-danger";

  return (
    <fieldset disabled={disabled} className="min-w-0 max-w-full">
      <legend className="mb-1 text-xs font-medium text-muted-2">{label}</legend>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-2">
          날짜
          <input
            ref={dateRef}
            type="date"
            value={date}
            onChange={(event) => change(event.target.value, time)}
            aria-describedby={description}
            aria-invalid={Boolean(error)}
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-2">
          시각
          <input
            ref={timeRef}
            type="time"
            value={time}
            onChange={(event) => change(date, event.target.value)}
            aria-describedby={description}
            aria-invalid={Boolean(error)}
            className={inputClass}
          />
        </label>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted-2">한국 시간(KST, UTC+9)</p>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p>
      )}
    </fieldset>
  );
}
