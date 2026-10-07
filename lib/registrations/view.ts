import type { RegistrationRow } from "@/lib/registrations/mutations";

type ScopedRow = Readonly<Pick<RegistrationRow, "id" | "campus_id">>;

/** 주소의 id는 권한이 아니다. 이미 조회한 행사·캠퍼스 범위 안의 사람만 선택한다. */
export function scopedRegistrationId(id: string | null, rows: readonly ScopedRow[], campusId?: string): string | null {
  return rows.some((r) => r.id === id && (campusId === undefined || r.campus_id === campusId)) ? id : null;
}

type PartialRow = Readonly<Pick<RegistrationRow, "attendance_type" | "attend_from" | "attend_to">>;

export function isPartialRegistration(row: PartialRow, pending: boolean): boolean {
  return row.attendance_type !== "roundtrip" || row.attend_from !== null || row.attend_to !== null || pending;
}

type SummaryRow = Readonly<Pick<RegistrationRow, "participation_status" | "attendance_type" | "fee" | "payment_status" | "note">>;

export function summarizeRegistrations(rows: readonly SummaryRow[]) {
  const totals = { total: 0, cancelledCount: 0, paidCount: 0, unpaidCount: 0, waivedCount: 0, expected: 0, received: 0, outstanding: 0, selfCount: 0, selfMissingNote: 0 };
  for (const row of rows) {
    if (row.participation_status === "cancelled") {
      totals.cancelledCount++;
      continue;
    }
    totals.total++;
    if (row.attendance_type === "self") {
      totals.selfCount++;
      if (!row.note?.trim()) totals.selfMissingNote++;
    }
    const fee = row.fee ?? 0;
    if (row.payment_status === "waived") {
      totals.waivedCount++;
      continue;
    }
    totals.expected += fee;
    if (row.payment_status === "paid") {
      totals.paidCount++;
      totals.received += fee;
    } else {
      totals.unpaidCount++;
      totals.outstanding += fee;
    }
  }
  return totals;
}
