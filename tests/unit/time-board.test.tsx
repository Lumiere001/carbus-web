// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CourseBoard, type CourseRow } from "@/components/admin/course-board";
import { PickupBoard, type BoardRow } from "@/components/pickup/pickup-board";

afterEach(cleanup);
const course = { id: 1, dayNo: 1, atTime: "10:00", personName: "같은 이름", campusName: "가 캠퍼스", campusOrder: 1, studentId: "26", onDate: "2026-08-20" } satisfies CourseRow;
const pickup = { id: 1, pickup_at: "2026-08-20T09:00:00+09:00", pickup_date: "2026-08-20", pickup_time: "09:00", place: "역", direction: "up", person_name: "같은 이름", campus_name: "가 캠퍼스", note: null } satisfies BoardRow;

describe("날짜별 시간표의 정보 보존", () => {
  it("같은 날짜·시각의 동명이인을 지우지 않고 같은 칸에 표시한다", () => {
    // Given
    render(<CourseBoard rows={[course, { ...course, id: 2, campusName: "나 캠퍼스" }, { ...course, id: 3, dayNo: 2, onDate: "2026-08-21" }]} />);
    // When
    const cells = screen.getAllByRole("cell");
    // Then
    expect(within(cells[0]).getAllByText("같은 이름")).toHaveLength(2);
    expect(within(cells[1]).getAllByText("같은 이름")).toHaveLength(1);
    expect(screen.getAllByRole("rowheader", { name: "10:00" })).toHaveLength(1);
  });

  it("날짜 선택은 현재 날짜를 표시하고 전체 명단 기능과 별도인 시간표를 유지한다", () => {
    // Given
    render(<CourseBoard rows={[course, { ...course, id: 2, dayNo: 2, onDate: "2026-08-21" }]} />);
    // When
    fireEvent.click(screen.getByRole("button", { name: "8. 21. (금)" }));
    // Then
    expect(screen.getByRole("button", { name: "8. 21. (금)" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table")).toBeDefined();
  });

  it("같은 시각의 다른 장소·방향 요청과 전체 메모를 별도로 보존한다", () => {
    // Given
    render(<PickupBoard audience="admin" rows={[pickup, { ...pickup, id: 2, place: "터미널", direction: "down", note: "짐을 챙긴 뒤 출발" }, { ...pickup, id: 3, pickup_at: null, pickup_date: null, pickup_time: null }]} />);
    // When
    const table = screen.getByRole("table", { name: "수송 요청 시간표" });
    // Then
    expect(within(table).getAllByText("같은 이름")).toHaveLength(3);
    expect(within(table).getByText("수련회장 출발 · 1건")).toBeDefined();
    expect(within(table).getByText("짐을 챙긴 뒤 출발", { exact: false })).toBeDefined();
    expect(within(table).getByRole("columnheader", { name: /날짜 미정/ })).toBeDefined();
    expect(within(table).getByRole("rowheader", { name: "시간 미정" })).toBeDefined();
  });

  it("임역원 시간표에도 장소와 사람은 남고 다른 캠퍼스의 정보는 노출하지 않는다", () => {
    // Given
    render(<PickupBoard audience="campus" rows={[pickup]} />);
    // When / Then
    expect(screen.getByRole("table", { name: "수송 요청 시간표" })).toBeDefined();
    expect(screen.getByText("역")).toBeDefined();
    expect(screen.queryByText("가 캠퍼스")).toBeNull();
  });
});
