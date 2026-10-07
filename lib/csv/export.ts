import Papa from "papaparse";
import { PAYMENT_LABELS, paymentDisplayOverride, tripLabel } from "@/lib/labels";
import type { RegistrationRow } from "@/lib/registrations/mutations";

export type ExportRegistration = Readonly<Pick<RegistrationRow,
  "name" | "student_id" | "participation_status" | "up_trip_id" | "down_trip_id" |
  "fee" | "payment_status" | "assigned_up_bus_id" | "assigned_down_bus_id" | "note"
>>;

type ExportOptions = {
  readonly rows: readonly ExportRegistration[];
  readonly trips: readonly { readonly id: number; readonly label: string }[];
  readonly buses: readonly { readonly id: number; readonly name: string }[];
};

const HEADERS = ["이름", "학번", "참여 상태", "상행 출발", "하행 출발", "차량비", "납부", "상행 배차", "하행 배차", "비고"] as const;

/** 표에 보이는 행 순서를 유지한다. 수식 앞 공백·BOM도 Excel 수식으로 실행되지 않게 한다. */
export function registrationCsv({ rows, trips, buses }: ExportOptions): string {
  const tripList = [...trips];
  const busNames = new Map(buses.map((b) => [b.id, b.name]));
  const busName = (id: number | null) => id === null ? "—" : busNames.get(id) ?? "—";
  const data = rows.map((r) => [
    r.name, r.student_id, r.participation_status === "cancelled" ? "취소" : "신청",
    tripLabel(r.up_trip_id, tripList), tripLabel(r.down_trip_id, tripList), r.fee ?? 0,
    paymentDisplayOverride(r.fee, r.note)?.label ?? PAYMENT_LABELS[r.payment_status],
    busName(r.assigned_up_bus_id), busName(r.assigned_down_bus_id), r.note ?? "",
  ]);
  const csv = Papa.unparse({ fields: [...HEADERS], data }, {
    quotes: true,
    newline: "\r\n",
    escapeFormulae: /^[\s\uFEFF]*[=+\-@\t\r\n]/,
  });
  return "\uFEFF" + csv.replace(/\r\n$/, "");
}
