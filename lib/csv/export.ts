import Papa from "papaparse";
import { PAYMENT_LABELS, paymentDisplayOverride, tripLabel } from "@/lib/labels";
import type { RegistrationRow } from "@/lib/registrations/mutations";
import type { AttendancePlan } from "@/lib/registrations/attendance-plan";
import type { TransportMode, TransportStatus } from "@/lib/transport/labels";
import { TRANSPORT_LABELS } from "@/lib/transport/labels";
import { toKstInput } from "@/lib/time/kst";

export type ExportRegistration = Readonly<Pick<RegistrationRow,
  "name" | "student_id" | "participation_status" | "up_trip_id" | "down_trip_id" |
  "fee" | "payment_status" | "assigned_up_bus_id" | "assigned_down_bus_id" | "note"
>> & Partial<AttendancePlan> & {
  readonly up_mode?: TransportMode | null;
  readonly down_mode?: TransportMode | null;
  readonly up_via_unit_id?: string | null;
  readonly down_via_unit_id?: string | null;
  readonly up_via_unit_name?: string | null;
  readonly down_via_unit_name?: string | null;
  readonly up_transport_status?: TransportStatus | null;
  readonly down_transport_status?: TransportStatus | null;
};

type ExportOptions = {
  readonly rows: readonly ExportRegistration[];
  readonly trips: readonly { readonly id: number; readonly label: string }[];
  readonly buses: readonly { readonly id: number; readonly name: string }[];
};

const HEADERS = ["이름", "학번", "참여 상태", "상행 출발", "하행 출발", "차량비", "납부", "상행 배차", "하행 배차", "비고",
  "참여 시작일", "참여 종료일", "참여 시작 일시", "참여 종료 일시", "상행 이동수단", "하행 이동수단",
  "상행 타지구", "하행 타지구", "상행 타지구 ID", "하행 타지구 ID", "상행 이동상태", "하행 이동상태"] as const;

/** 표에 보이는 행 순서를 유지한다. 수식 앞 공백·BOM도 Excel 수식으로 실행되지 않게 한다. */
export function registrationCsv({ rows, trips, buses }: ExportOptions): string {
  const tripList = [...trips];
  const busNames = new Map(buses.map((b) => [b.id, b.name]));
  const busName = (id: number | null) => id === null ? "—" : busNames.get(id) ?? "—";
  const data = rows.map((r) => [
    r.name, r.student_id, r.participation_status === "cancelled" ? "취소" : "신청",
    r.up_trip_id === null ? "" : tripLabel(r.up_trip_id, tripList), r.down_trip_id === null ? "" : tripLabel(r.down_trip_id, tripList), r.fee ?? 0,
    paymentDisplayOverride(r.fee, r.note)?.label ?? PAYMENT_LABELS[r.payment_status],
    busName(r.assigned_up_bus_id), busName(r.assigned_down_bus_id), r.note ?? "",
    r.attend_from ?? "", r.attend_to ?? "", toKstInput(r.attend_from_at), toKstInput(r.attend_to_at),
    r.up_mode ? TRANSPORT_LABELS[r.up_mode] : r.up_trip_id === null ? "" : TRANSPORT_LABELS.our_bus,
    r.down_mode ? TRANSPORT_LABELS[r.down_mode] : r.down_trip_id === null ? "" : TRANSPORT_LABELS.our_bus,
    r.up_via_unit_name ?? "", r.down_via_unit_name ?? "", r.up_via_unit_id ?? "", r.down_via_unit_id ?? "",
    r.up_transport_status ?? "", r.down_transport_status ?? "",
  ]);
  const csv = Papa.unparse({ fields: [...HEADERS], data }, {
    quotes: true,
    newline: "\r\n",
    escapeFormulae: /^[\s\uFEFF]*[=+\-@\t\r\n]/,
  });
  return "\uFEFF" + csv.replace(/\r\n$/, "");
}
