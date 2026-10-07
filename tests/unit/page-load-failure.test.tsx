// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import AdminErrorsPage from "@/app/admin/(protected)/e/[eventId]/errors/page";
import CampusPaymentsPage from "@/app/campus/payments/page";

const state = vi.hoisted(() => ({ failedTable: "" }));
const eventId = "18650503-b0fa-4d8e-ab16-72eb47c8c384";
type QueryResult = { data: unknown; error: { message: string } | null };

class Query {
  constructor(private readonly table: string) {}
  select() { return this; }
  eq() { return this; }
  neq() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  private result(single: boolean): QueryResult {
    if (state.failedTable === this.table) return { data: null, error: { message: "synthetic read failure" } };
    const data = this.table === "profiles" ? { campus_id: "synthetic-campus" }
      : this.table === "campuses" ? { name: "우리 캠퍼스" }
      : single ? null : [];
    return { data, error: null };
  }
  single() { return Promise.resolve(this.result(true)); }
  maybeSingle() { return Promise.resolve(this.result(true)); }
  then(resolve: (result: QueryResult) => unknown) {
    return Promise.resolve(this.result(false)).then(resolve);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-user" } } }) },
    from: (table: string) => new Query(table),
  }),
}));
vi.mock("@/components/campus/payments-panel", () => ({
  CampusPaymentsPanel: ({ rows, remittances, masterReceived }: {
    rows: unknown[]; remittances: unknown[]; masterReceived: number;
  }) => <output aria-label="정산 결과">명단 {rows.length} · 송금 {remittances.length} · 총단 입금 {masterReceived}</output>,
}));

beforeEach(() => { state.failedTable = ""; });
afterEach(cleanup);

describe("서버 페이지의 조회 실패 경계", () => {
  it("오류 이력 조회 실패를 오류 없음으로 표시하지 않고 같은 행사에서 재시도한다", async () => {
    state.failedTable = "batch_runs";
    render(await AdminErrorsPage({ params: Promise.resolve({ eventId }) }));
    expect(screen.getByRole("alert").textContent).toContain("정보를 불러오지 못했습니다");
    expect(screen.queryByText("기록된 오류가 없습니다.")).toBeNull();
    expect(screen.getByRole("link", { name: "다시 불러오기" }).getAttribute("href")).toBe(`/admin/e/${eventId}/errors`);
  });

  it("오류 이력의 성공한 빈 조회는 오류 없음으로 표시한다", async () => {
    render(await AdminErrorsPage({ params: Promise.resolve({ eventId }) }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("기록된 오류가 없습니다.")).toBeTruthy();
  });

  it.each(["registrations", "campuses", "campus_remittances", "campus_payment_settlements"])(
    "캠퍼스 정산의 %s 조회 실패에서 빈 명단·입금 0 화면을 막는다", async (table) => {
      state.failedTable = table;
      render(await CampusPaymentsPage());
      expect(screen.getByRole("alert").textContent).toContain("정보를 불러오지 못했습니다");
      expect(screen.queryByRole("status", { name: "정산 결과" })).toBeNull();
      expect(screen.getByRole("link", { name: "다시 불러오기" }).getAttribute("href")).toBe("/campus/payments");
    },
  );

  it("정산 기록이 실제로 없는 성공한 조회는 기존 빈 정산 결과를 표시한다", async () => {
    render(await CampusPaymentsPage());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("정산 결과").textContent).toBe("명단 0 · 송금 0 · 총단 입금 0");
  });
});
