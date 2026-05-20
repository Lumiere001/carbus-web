import { describe, expect, it } from "vitest";
import {
  sortRegistrations,
  conflictRowIdsOf,
} from "@/lib/registrations/sort";
import type { RegistrationRow } from "@/lib/registrations/mutations";

function row(
  id: string,
  payment_status: string,
  created_at: string
): RegistrationRow {
  return { id, payment_status, created_at } as unknown as RegistrationRow;
}

describe("sortRegistrations — 충돌→미납→면제→완납, 그룹 내 입력순", () => {
  it("payment_status 그룹 순서: 미납 → 면제 → 완납", () => {
    const rows = [
      row("a", "paid", "2026-01-01"),
      row("b", "waived", "2026-01-01"),
      row("c", "unpaid", "2026-01-01"),
    ];
    const sorted = sortRegistrations(rows);
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("충돌 행이 최상단 (payment 무관)", () => {
    const rows = [
      row("a", "paid", "2026-01-01"),
      row("b", "unpaid", "2026-01-02"),
      row("c", "paid", "2026-01-03"),
    ];
    const sorted = sortRegistrations(rows, new Set(["c"]));
    expect(sorted[0].id).toBe("c"); // 충돌(완납이지만) 최상단
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("같은 그룹 내 입력 순서(created_at 오름차순) 유지", () => {
    const rows = [
      row("late", "unpaid", "2026-03-10"),
      row("early", "unpaid", "2026-03-01"),
      row("mid", "unpaid", "2026-03-05"),
    ];
    const sorted = sortRegistrations(rows);
    expect(sorted.map((r) => r.id)).toEqual(["early", "mid", "late"]);
  });

  it("원본 배열 불변 (새 배열 반환)", () => {
    const rows = [row("a", "paid", "t"), row("b", "unpaid", "t")];
    const sorted = sortRegistrations(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]); // 원본 그대로
    expect(sorted).not.toBe(rows);
  });

  it("conflictRowIdsOf: `${id}:${field}` → id Set", () => {
    const cells = new Set(["r1:name", "r1:payment_status", "r2:note"]);
    const ids = conflictRowIdsOf(cells);
    expect([...ids].sort()).toEqual(["r1", "r2"]);
  });

  it("종합: 충돌1 → 미납2 → 면제 → 완납, 각 그룹 입력순", () => {
    const rows = [
      row("paid_old", "paid", "2026-01-01"),
      row("unpaid_new", "unpaid", "2026-02-02"),
      row("waived", "waived", "2026-01-15"),
      row("unpaid_old", "unpaid", "2026-01-10"),
      row("conflict", "paid", "2026-03-01"),
    ];
    const sorted = sortRegistrations(rows, new Set(["conflict"]));
    expect(sorted.map((r) => r.id)).toEqual([
      "conflict",
      "unpaid_old",
      "unpaid_new",
      "waived",
      "paid_old",
    ]);
  });
});
