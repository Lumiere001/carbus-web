import { z } from "zod";

const completeDateTime = z.iso.datetime({ local: true, precision: -1 });

/** 두 native 입력이 모두 완성된 한국 날짜·시각인지 저장 전에 확인한다. */
export function isCompleteDateTime(value: string): boolean {
  return completeDateTime.safeParse(value).success;
}

/** 시간대 없는 날짜·시각은 KST로 저장하며, 미정과 기존 오프셋은 보존한다. */
export function toKst(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/[+-]\d{2}:?\d{2}$|Z$/.test(value)) return value;
  return `${value.length === 16 ? `${value}:00` : value}+09:00`;
}

/** 브라우저 시간대와 무관한 YYYY-MM-DDTHH:mm 입력 값. */
export function toKstInput(value: string | null | undefined): string {
  const kst = toKst(value);
  if (!kst) return "";
  const timestamp = new Date(kst).getTime();
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function formatKst(value: string | null | undefined): string {
  const kst = toKst(value);
  if (!kst) return "미정";
  const date = new Date(kst);
  if (!Number.isFinite(date.getTime())) return "미정";
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
