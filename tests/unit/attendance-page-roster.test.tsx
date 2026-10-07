// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import DriverPage from "@/app/driver/page";
import AdminAttendancePage from "@/app/admin/(protected)/e/[eventId]/attendance/page";

const registrations = [
  { id: "small", name: "작은 캠퍼스", student_id: "20", campus_id: "campus-b" },
  { id: "large-new", name: "큰 캠퍼스 후배", student_id: "26", campus_id: "campus-a" },
  { id: "large-old", name: "큰 캠퍼스 선배", student_id: "24", campus_id: "campus-a" },
].map((row) => ({
  ...row, attendance_type: "roundtrip", up_trip_id: 1, down_trip_id: 2,
  assigned_up_bus_id: 1, assigned_down_bus_id: 1, checked_in: false, checked_out: false, version: 1,
}));

class Query {
  constructor(private readonly table: string) {}
  select() { return this; }
  eq() { return this; }
  neq() { return this; }
  or() { return this; }
  order() { return this; }
  single() { return Promise.resolve({ data: { role: "master", driver_bus_id: 1 }, error: null }); }
  then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
    const data = this.table === "registrations" ? registrations
      : this.table === "buses" ? [{ id: 1, name: "1호차", up_trip_id: 1 }]
      : this.table === "event_trips" ? [{ id: 1, label: "가는 편" }]
      : [{ id: "campus-a", name: "큰 캠퍼스" }, { id: "campus-b", name: "작은 캠퍼스" }];
    return Promise.resolve({ data, error: null }).then(resolve);
  }
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "synthetic-user" } } }) },
    from: (table: string) => new Query(table),
  }),
}));
vi.mock("@/components/campus/bus-attendance", () => ({
  BusAttendance: ({ upGroups, downGroups }: {
    upGroups: [number, { id: string; name: string; campus?: string }[]][];
    downGroups: [number, { id: string; name: string; campus?: string }[]][];
  }) => <>
    {[{ label: "상행", groups: upGroups }, { label: "하행", groups: downGroups }].map(({ label, groups }) => (
      <ol key={label} aria-label={label}>
        {groups.flatMap(([busId, members]) => members.map((member) => (
          <li key={`${busId}:${member.id}`}>{member.campus} · {member.name}</li>
        )))}
      </ol>
    ))}
  </>,
}));

afterEach(cleanup);

describe("출석 페이지의 실제 명단 전달 순서", () => {
  it.each([
    ["차량순장", () => DriverPage()],
    ["관리자", () => AdminAttendancePage({ params: Promise.resolve({ eventId: "18650503-b0fa-4d8e-ab16-72eb47c8c384" }) })],
  ])("%s 화면은 캠퍼스 인원순으로 묶고 그 안에서 학번순으로 정렬한다", async (_label, Page) => {
    render(await Page());
    for (const direction of ["상행", "하행"]) {
      const list = screen.getByRole("list", { name: direction });
      expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
        "큰 캠퍼스 · 큰 캠퍼스 선배",
        "큰 캠퍼스 · 큰 캠퍼스 후배",
        "작은 캠퍼스 · 작은 캠퍼스",
      ]);
    }
  });
});
