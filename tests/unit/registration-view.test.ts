import { describe, expect, it } from "vitest";
import { isPartialRegistration, scopedRegistrationId, summarizeRegistrations } from "@/lib/registrations/view";

describe("registration view scope and totals", () => {
  it("opens only a listed registration belonging to the requested campus", () => {
    // Given
    const rows = [{ id: "own", campus_id: "campus-a" }, { id: "foreign", campus_id: "campus-b" }];
    // When / Then
    expect(scopedRegistrationId("own", rows, "campus-a")).toBe("own");
    expect(scopedRegistrationId("foreign", rows, "campus-a")).toBeNull();
    expect(scopedRegistrationId("unlisted", rows, "campus-a")).toBeNull();
    expect(scopedRegistrationId(null, rows, "campus-a")).toBeNull();
    expect(scopedRegistrationId("foreign", rows)).toBe("foreign");
  });

  it("excludes retained cancellations from active people, fees, and payment counters", () => {
    // Given
    const active = { participation_status: "registered" as const, attendance_type: "roundtrip" as const, fee: 50000, payment_status: "paid" as const, note: null };
    const cancelled = { ...active, participation_status: "cancelled" as const, payment_status: "unpaid" as const, attendance_type: "self" as const };
    // When
    const totals = summarizeRegistrations([active, cancelled]);
    // Then
    expect(totals).toMatchObject({ total: 1, cancelledCount: 1, expected: 50000, received: 50000, outstanding: 0, paidCount: 1, unpaidCount: 0, selfMissingNote: 0 });
  });

  it("includes round-trip people awaiting transport confirmation in the partial work list", () => {
    // Given
    const row = { attendance_type: "roundtrip" as const, attend_from: null, attend_to: null };
    // When / Then
    expect(isPartialRegistration(row, true)).toBe(true);
    expect(isPartialRegistration(row, false)).toBe(false);
    expect(isPartialRegistration({ ...row, attend_from: "2026-10-06" }, false)).toBe(true);
    expect(isPartialRegistration({ ...row, attendance_type: "self" }, false)).toBe(true);
  });
});
