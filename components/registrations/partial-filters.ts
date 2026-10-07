export const partialFilters = [
  { key: "all", label: "전체" }, { key: "oneway", label: "버스 편도" }, { key: "self", label: "개인 이동" },
  { key: "period", label: "일부 기간 참석" }, { key: "pending", label: "차량 확정 대기" },
  { key: "missing", label: "이동수단 확인 필요" }, { key: "schedule", label: "예정 시각 확인 필요" },
] as const;
export type PartialFilter = typeof partialFilters[number]["key"];
export function matchesPartialFilter(key: PartialFilter, row: {
  readonly attendance_type: string; readonly partialPeriod: boolean; readonly pending: boolean; readonly missing: boolean; readonly needsPlan: boolean;
}): boolean {
  switch (key) {
    case "all": return true;
    case "oneway": return row.attendance_type === "oneway";
    case "self": return row.attendance_type === "self";
    case "period": return row.partialPeriod;
    case "pending": return row.pending;
    case "missing": return row.missing;
    case "schedule": return row.needsPlan;
  }
}
