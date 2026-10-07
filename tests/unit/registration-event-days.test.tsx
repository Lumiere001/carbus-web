// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AdminRegistrationsPage from "@/app/admin/(protected)/e/[eventId]/registrations/page";

const activeEvent = "18650503-b0fa-4d8e-ab16-72eb47c8c384";
const viewedEvent = "28650503-b0fa-4d8e-ab16-72eb47c8c384";
const queries: Query[] = [];

class Query {
  readonly filters = new Map<string, unknown>();
  constructor(readonly table: string) {}
  select() { return this; }
  order() { return this; }
  eq(column: string, value: unknown) { this.filters.set(column, value); return this; }
  single() { return Promise.resolve({ data: { role: "master" }, error: null }); }
  maybeSingle() {
    if (this.table === "events") {
      const id = this.filters.get("id") ?? activeEvent;
      return Promise.resolve({
        data: { starts_on: "2026-08-20", ends_on: id === viewedEvent ? "2026-08-24" : "2026-08-22" },
        error: null,
      });
    }
    return Promise.resolve({ data: { current_phase: "phase1" }, error: null });
  }
  then(resolve: (result: { data: never[]; error: null }) => unknown) {
    return Promise.resolve({ data: [], error: null }).then(resolve);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-master" } } }) },
    from: (table: string) => { const query = new Query(table); queries.push(query); return query; },
  }),
}));
vi.mock("@/components/admin/registrations-panel", () => ({
  RegistrationsPanel: ({ dayCount }: { dayCount: number }) => <output>{dayCount}일</output>,
}));

afterEach(cleanup);

it("활성 행사와 기간이 다른 행사를 보고 있으면 그 행사의 날 선택지를 만든다", async () => {
  const page = await AdminRegistrationsPage({ params: Promise.resolve({ eventId: viewedEvent }) });
  render(page);
  expect(screen.getByText("5일")).toBeTruthy();
  const eventQuery = queries.find((query) => query.table === "events");
  expect(eventQuery?.filters.get("id")).toBe(viewedEvent);
  expect(eventQuery?.filters.has("is_active")).toBe(false);
});
