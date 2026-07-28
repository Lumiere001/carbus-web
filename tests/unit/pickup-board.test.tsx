// @vitest-environment happy-dom
/**
 * 수송 요청 — 보드 묶음과 시각 변환.
 *
 * 이 둘이 틀리면 **다른 날 배차표**가 된다. 밤 늦은 픽업(막차·야간 도착)이 흔해서
 * 오프셋 하나 빠지면 하루가 밀리고, 묶음이 쪼개지면 같은 시각 같은 장소에 차를
 * 두 번 보낸다. 화면으로는 둘 다 "그럴싸하게" 보여서 눈으로 못 잡는다.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PickupBoard, type BoardRow } from "@/components/admin/pickup-board";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/events/current", () => ({ currentEventId: async () => ({ ok: true, id: "e" }) }));

const { toKst } = await import("@/lib/admin/pickup");

const row = (o: Partial<BoardRow> & { id: number }): BoardRow => ({
  direction: "up",
  pickup_at: null,
  pickup_date: null,
  pickup_time: null,
  place: null,
  note: null,
  person_name: "아무개",
  campus_name: "전남대",
  ...o,
});

describe("toKst — datetime-local 에 KST 를 못 박는다", () => {
  it("오프셋이 없으면 +09:00 을 붙인다", () => {
    expect(toKst("2026-08-11T23:30")).toBe("2026-08-11T23:30:00+09:00");
  });

  it("이미 오프셋이 있으면 건드리지 않는다", () => {
    expect(toKst("2026-08-11T23:30:00+09:00")).toBe("2026-08-11T23:30:00+09:00");
    expect(toKst("2026-08-11T14:30:00Z")).toBe("2026-08-11T14:30:00Z");
  });

  it("빈 값은 null — '시각 미정'이 그대로 남아야 한다", () => {
    expect(toKst("")).toBeNull();
    expect(toKst(null)).toBeNull();
    expect(toKst(undefined)).toBeNull();
  });
});

describe("PickupBoard — 묶음", () => {
  beforeEach(cleanup);

  it("같은 (날짜·시각·장소)면 한 묶음으로 합친다", () => {
    render(
      <PickupBoard
        rows={[
          row({ id: 1, pickup_at: "x", pickup_date: "2026-08-11", pickup_time: "23:30", place: "어딘가 역", person_name: "김순장" }),
          row({ id: 2, pickup_at: "x", pickup_date: "2026-08-11", pickup_time: "23:30", place: "어딘가 역", person_name: "이순원" }),
        ]}
      />
    );
    expect(screen.getByText("2026-08-11 23:30")).toBeTruthy();
    expect(screen.getByText("2명")).toBeTruthy();
  });

  it("장소가 다르면 다른 묶음이다 (차를 따로 보내야 하므로)", () => {
    render(
      <PickupBoard
        rows={[
          row({ id: 1, pickup_at: "x", pickup_date: "2026-08-11", pickup_time: "23:30", place: "가 장소" }),
          row({ id: 2, pickup_at: "x", pickup_date: "2026-08-11", pickup_time: "23:30", place: "나 장소" }),
        ]}
      />
    );
    expect(screen.getAllByText("1명")).toHaveLength(2);
  });

  it("시각 미정은 맨 위에 모이고 건수를 경고로 알린다", () => {
    render(
      <PickupBoard
        rows={[
          row({ id: 1, pickup_at: "x", pickup_date: "2026-08-11", pickup_time: "09:00", place: "어딘가 역" }),
          row({ id: 2 }),
          row({ id: 3 }),
        ]}
      />
    );
    expect(screen.getByText("시각 미정")).toBeTruthy();
    // 경고 문구에 미정 건수가 숫자로 나와야 한다 — 그게 곧 할 일 개수다.
    expect(screen.getByText("2건")).toBeTruthy();
    // 미정 묶음이 먼저 그려진다
    const texts = [...document.querySelectorAll("span")].map((e) => e.textContent);
    expect(texts.indexOf("시각 미정")).toBeLessThan(texts.indexOf("2026-08-11 09:00"));
  });

  it("요청이 없으면 어디서 넣는지 알려준다", () => {
    render(<PickupBoard rows={[]} />);
    expect(screen.getByText(/아직 수송 요청이 없습니다/)).toBeTruthy();
  });
});
