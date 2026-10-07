import Papa from "papaparse";
import type { EventTrip } from "@/lib/supabase/types";

export type ImportTrip = Readonly<Pick<EventTrip, "id" | "key" | "label" | "direction" | "active">>;
export type ImportUnit = { readonly id: string; readonly name: string };

const HEADERS = [
  "이름", "학번", "상행 출발", "하행 출발", "비고",
  "참여 시작일", "참여 종료일", "참여 시작 일시", "참여 종료 일시",
  "상행 이동수단", "하행 이동수단", "상행 타지구", "하행 타지구",
  "상행 이동상태", "하행 이동상태",
] as const;

/** A full-event roundtrip example needs no invented participation dates or times. */
export function buildImportTemplate(trips: readonly ImportTrip[]): string {
  const up = trips.find((trip) => trip.direction === "up" && trip.active);
  const down = trips.find((trip) => trip.direction === "down" && trip.active);
  const rows: string[][] = [[...HEADERS]];
  if (up && down) {
    rows.push([
      "홍길동", "26", up.label, down.label, "",
      "", "", "", "", "우리 버스", "우리 버스", "", "", "확정", "확정",
    ]);
  }
  return Papa.unparse(rows, {
    quotes: true,
    escapeFormulae: /^[\s\uFEFF]*[=+\-@\t\r\n]/,
  });
}
