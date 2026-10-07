// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { changesFare, type FareChange } from "@/lib/payments/balance-history";
import { BalanceHistoryDetails } from "@/components/admin/balance-history";

afterEach(cleanup);
const fare = { registration_id: "person", created_at: "2026-08-20T15:30:42Z", before_type: "roundtrip", after_type: "oneway", before_fee: 15000, after_fee: 15000 } satisfies FareChange;

describe("차액의 원본 기록 대조", () => {
  it("납부 당시 요금이 동결되어 있어도 왕복→편도 변경을 구분한다", () => {
    // Given / When / Then
    expect(changesFare(fare)).toBe(true);
    expect(changesFare({ ...fare, after_type: "roundtrip" })).toBe(false);
    expect(changesFare({ ...fare, after_type: "roundtrip", after_fee: 10000 })).toBe(true);
  });

  it("UTC 변경 기록은 다음날 한국 시각과 초를 보존하고 개인 활동 이력으로 연결한다", () => {
    // Given
    render(<BalanceHistoryDetails history={{ fareChange: fare }} href="/logs?person=person" />);
    // When
    const time = document.querySelector("time");
    // Then
    expect(time).toHaveAttribute("dateTime", fare.created_at);
    expect(time?.textContent).toContain("08. 21.");
    expect(time?.textContent).toContain("00:30:42");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/logs?person=person");
  });

  it("이관된 장부 기록의 날짜를 실제 거래일로 단정하지 않는다", () => {
    // Given
    render(<BalanceHistoryDetails history={{ ledger: { kind: "payment", amount: 15000, occurred_at: fare.created_at, created_at: fare.created_at, source: "migration" } }} href="/logs" />);
    // When / Then
    expect(screen.getByText(/실제 거래일 확인 필요/)).toBeDefined();
    expect(screen.getByText("편성·청구 변경 시각: 기록 없음")).toBeDefined();
    expect(document.querySelectorAll("time")).toHaveLength(1);
  });
});
