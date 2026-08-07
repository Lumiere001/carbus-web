// @vitest-environment happy-dom
/**
 * 수강신청 조사 (동규님 요청, 2026-07-31).
 *
 * 이 기능의 핵심 결정은 **날짜를 저장하지 않는 것**이다 — "리더십 캠프 날짜가 계속
 * 변하잖아". 그래서 저장하는 건 `day_no` 뿐이고 실제 날짜는 계산해서 보여준다.
 * 아래 테스트가 그 결정을 못 박는다.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { eventDayCount, dayLabel } from "@/lib/courses/days";
import { CourseBoard, type CourseRow } from "@/components/admin/course-board";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

beforeEach(cleanup);

describe("eventDayCount — 고를 수 있는 날 수는 행사 기간에서 나온다", () => {
  it("3일 행사면 셋째날까지", () => {
    // 리더십 캠프 8/20~8/22.
    expect(eventDayCount("2026-08-20", "2026-08-22")).toBe(3);
  });

  it("4박 행사면 넷째날이 저절로 생긴다 — 코드를 안 고쳐도 된다", () => {
    expect(eventDayCount("2026-06-23", "2026-06-27")).toBe(5);
  });

  it("하루짜리도 된다", () => {
    expect(eventDayCount("2026-08-20", "2026-08-20")).toBe(1);
  });

  it("날짜가 없으면 3일로 본다 — 동규님이 말한 첫째~셋째날", () => {
    expect(eventDayCount(null, null)).toBe(3);
    expect(eventDayCount("2026-08-20", null)).toBe(3);
  });

  it("거꾸로 들어가 있어도 화면이 안 깨진다", () => {
    // 날짜가 잘못 들어가 있어도 100개 줄을 그리면 안 된다.
    expect(eventDayCount("2026-08-22", "2026-08-20")).toBe(3);
    expect(eventDayCount("2000-01-01", "2030-01-01")).toBe(14);
  });
});

describe("dayLabel", () => {
  it("넷째날까지는 우리말로", () => {
    expect(dayLabel(1)).toBe("첫째날");
    expect(dayLabel(3)).toBe("셋째날");
    expect(dayLabel(4)).toBe("넷째날");
  });
  it("그 뒤는 숫자로 — '다섯째날'부터는 어색하다", () => {
    expect(dayLabel(5)).toBe("5일차");
  });
});

const row = (o: Partial<CourseRow> & { id: number }): CourseRow => ({
  dayNo: 1,
  atTime: "10:00",
  personName: "김민준",
  studentId: "21",
  campusName: "전남대",
  campusOrder: 1,
  onDate: "2026-08-20",
  ...o,
});

describe("CourseBoard — 날 → 시간으로 묶는다", () => {
  it("같은 날 같은 시간이면 한 묶음", () => {
    render(
      <CourseBoard
        rows={[
          row({ id: 1, personName: "김민준" }),
          row({ id: 2, personName: "이서연" }),
        ]}
      />
    );
    expect(screen.getByText("10:00")).toBeTruthy();
    // "2명" 은 날 머리글과 시간 묶음 배지 양쪽에 나온다 — 둘 다 2명이면 맞다.
    expect(screen.getAllByText("2명").length).toBeGreaterThanOrEqual(2);
  });

  it("시간 미정은 그 날의 맨 위에 오고 건수를 경고로 알린다", () => {
    render(
      <CourseBoard
        rows={[
          row({ id: 1, atTime: "10:00" }),
          row({ id: 2, atTime: null, personName: "박서준" }),
        ]}
      />
    );
    expect(screen.getByText("시간 미정")).toBeTruthy();
    // 경고에 미정 인원이 숫자로 — 그게 곧 물어볼 사람 수다.
    expect(screen.getByText("1명", { selector: "b" })).toBeTruthy();
    const texts = [...document.querySelectorAll("span")].map((e) => e.textContent);
    expect(texts.indexOf("시간 미정")).toBeLessThan(texts.indexOf("10:00"));
  });

  it("날짜는 **계산된 값**을 보여준다 — 저장된 게 아니다", () => {
    // 저장하는 건 "첫째날" 뿐이고, 8/20 은 행사 시작일에서 나온 값이다.
    render(<CourseBoard rows={[row({ id: 1, dayNo: 1, onDate: "2026-08-20" })]} />);
    // 요약 칩과 날 머리글 양쪽에 나온다.
    expect(screen.getAllByText("첫째날").length).toBeGreaterThan(0);
    expect(screen.getByText(/8\. 20\.|8\/20/)).toBeTruthy();
  });

  it("여러 날이면 날짜순으로 나뉜다", () => {
    render(
      <CourseBoard
        rows={[
          row({ id: 1, dayNo: 2, onDate: "2026-08-21", personName: "이서연" }),
          row({ id: 2, dayNo: 1, onDate: "2026-08-20", personName: "김민준" }),
        ]}
      />
    );
    const heads = [...document.querySelectorAll("section")].map(
      (s) => s.getAttribute("aria-label")
    );
    expect(heads).toEqual(["첫째날 수강신청", "둘째날 수강신청"]);
  });

  it("아무도 없으면 어디서 넣는지 알려준다", () => {
    render(<CourseBoard rows={[]} />);
    expect(screen.getByText(/아직 수강신청이 없습니다/)).toBeTruthy();
    expect(screen.getByText(/전체 순장\/순원/)).toBeTruthy();
  });

  it("묶음을 접으면 명단이 사라진다 — 인원이 많을 때 스크롤을 줄인다", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    render(<CourseBoard rows={[row({ id: 1, personName: "김민준" })]} />);
    expect(screen.getByText("김민준")).toBeTruthy();
    // 요약 칩이 아니라 **날 머리글**을 눌러야 접힌다.
    await userEvent.click(screen.getByRole("button", { name: /첫째날/ }));
    expect(screen.queryByText("김민준")).toBeNull();
  });
});
