/**
 * 배차 골든 스냅샷 — 운영 데이터 형상(599명 / 11호차)의 현재 결과를 고정한다.
 *
 * 왜 있나:
 *   Phase 3 는 엔진의 `"1호차"` 문자열 특례(COHESION_EXEMPT / FILL_LAST)를
 *   플래그 컬럼으로 승격한다. 이건 **배차 결과를 바꿀 수 있는** 변경이다.
 *   batch.test.ts 의 단위 테스트는 각 규칙을 소수 인원으로 검증하지만,
 *   실제 캠퍼스 크기 분포(121·87·70·66·47…)에서 best-fit·분할·1명조각 방지가
 *   어떻게 상호작용하는지는 잡지 못한다. 그 조합 결과를 통째로 고정한다.
 *
 * 이 테스트가 깨지면:
 *   배차 결과가 바뀐 것이다. **의도한 변경이면** 아래 기대값을 갱신하고,
 *   무엇이 왜 달라졌는지 커밋 메시지에 남긴다. 의도치 않았다면 회귀다.
 *
 * fixture 재생성: node scripts/local-verify/make-batch-fixture.mjs
 *   (로컬 DB 에 운영 백업이 적재돼 있어야 한다 — scripts/local-verify/README.md)
 *   실명·실 UUID 는 1:1 가명으로 치환돼 있고 배차 결과는 원본과 동일하다.
 */
import { describe, expect, it } from "vitest";
import { runBatch } from "@/lib/batch/engine";
import type { Bus, Passenger } from "@/lib/batch/types";
import fixture from "../fixtures/batch-prod-shape.json";

const passengers = fixture.passengers as Passenger[];
const buses = fixture.buses as Bus[];

/** 배정 맵을 순서 무관·전수 비교 가능한 한 줄로 접는다. */
function digest(assignments: Record<string, number>): string {
  const entries = Object.entries(assignments).sort(([a], [b]) => a.localeCompare(b));
  let h = 0;
  for (const [id, bus] of entries) {
    for (const ch of `${id}:${bus};`) {
      h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
    }
  }
  return `${entries.length}건/${(h >>> 0).toString(16)}`;
}

describe("배차 골든 스냅샷 (운영 형상)", () => {
  it("fixture 가 운영 규모를 유지한다", () => {
    // fixture 가 조용히 축소·교체되면 이 테스트 전체가 무의미해지므로 먼저 못 박는다.
    expect(passengers).toHaveLength(599);
    expect(buses).toHaveLength(11);
    expect(passengers.filter((p) => p.departure_slot_id !== null)).toHaveLength(459);
    expect(passengers.filter((p) => p.uses_return_bus)).toHaveLength(459);
  });

  it("상행(up): 호차별 인원·미배정·오류가 고정된다", () => {
    const r = runBatch(passengers, buses, "up");

    expect(r.by_bus).toEqual({
      1: 33,
      2: 44,
      3: 43,
      4: 44,
      5: 43,
      6: 44,
      7: 44,
      8: 39,
      9: 42,
      10: 44,
      11: 39,
    });
    expect(r.total_assigned).toBe(459);
    expect(r.empty_seats).toBe(25);
    expect(r.errors).toEqual([]);
    expect(digest(r.up_assignments)).toBe("459건/e669c198");
  });

  it("하행(down): 호차별 인원·미배정·오류가 고정된다", () => {
    const r = runBatch(passengers, buses, "down");

    expect(r.by_bus).toEqual({
      1: 23,
      2: 44,
      3: 41,
      4: 44,
      5: 44,
      6: 44,
      7: 44,
      8: 43,
      9: 44,
      10: 44,
      11: 44,
    });
    expect(r.total_assigned).toBe(459);
    expect(r.empty_seats).toBe(25);
    expect(r.errors).toEqual([]);
    expect(digest(r.down_assignments)).toBe("459건/91c52240");
  });

  it("both: 상·하행 결과가 단독 실행과 동일하다", () => {
    // 방향별 독립성 — Phase 3 에서 하행에 편(trip) 루프가 생겨도 유지돼야 하는 성질.
    const both = runBatch(passengers, buses, "both");
    const up = runBatch(passengers, buses, "up");
    const down = runBatch(passengers, buses, "down");

    expect(digest(both.up_assignments)).toBe(digest(up.up_assignments));
    expect(digest(both.down_assignments)).toBe(digest(down.down_assignments));
  });

  it("배차 플래그가 빠진 호차는 조용히 넘어가지 않고 던진다", () => {
    // 왜 이 테스트가 있나 — 플래그가 undefined 면 `fillLastRank(a) - fillLastRank(b)`
    // 가 NaN 이고, NaN 은 falsy 라 `||` 우변으로 폴백해 **후순위 규칙이 통째로 무시된다.**
    // 실측: 80명·3대에서 짐차 배정이 0명 → 44명으로 뒤집혔다.
    // tsc 가 .ts 호출부는 막아주지만 scripts/*.mjs·JSON 픽스처·DB row 는 못 막는다.
    const noFlags = buses.map((b) => {
      const rest: Record<string, unknown> = { ...b };
      delete rest.is_cohesion_exempt;
      delete rest.fill_priority;
      return rest as unknown as Bus;
    });
    expect(() => runBatch(passengers, noFlags, "up")).toThrow(/배차 플래그 누락/);

    // NaN 도 같이 막는다 — 숫자 타입이라도 계산이 오염되면 같은 증상이 난다.
    const nanFlags = buses.map((b) => ({ ...b, fill_priority: Number.NaN }));
    expect(() => runBatch(passengers, nanFlags, "up")).toThrow(/배차 플래그 누락/);

    // 운행편 id 도 마찬가지. undefined("안 넘김")와 null("운행 안 함")은 다르다.
    const noTrip = buses.map((b) => {
      const rest: Record<string, unknown> = { ...b };
      delete rest.up_trip_id;
      return rest as unknown as Bus;
    });
    expect(() => runBatch(passengers, noTrip, "up")).toThrow(/운행편 id 누락/);
  });

  it("결정적이다 — 같은 입력이면 항상 같은 결과", () => {
    // 엔진이 Map 삽입 순서·안정 정렬에 의존하므로 순수성이 깨지면 여기서 잡힌다.
    const a = runBatch(passengers, buses, "both");
    const b = runBatch(passengers, buses, "both");
    expect(digest(a.up_assignments)).toBe(digest(b.up_assignments));
    expect(digest(a.down_assignments)).toBe(digest(b.down_assignments));
  });

  it("1호차 특례(FILL_LAST)가 운영 규모에서 실제로 작동한다", () => {
    // Phase 3 의 핵심 위험: 이 특례가 `"1호차"` 문자열 일치라 다른 행사에서 조용히 죽는다.
    // 플래그 컬럼으로 승격한 뒤에도 아래 성질이 그대로여야 한다.
    //
    // ⚠️ "1호차는 비워진다"가 아니다 — 이번 행사는 수요가 좌석을 초과해서 실제로 33명 탄다.
    //    지켜져야 할 성질은 "1호차는 **넘친 만큼만** 받는다"이다.
    const up = runBatch(passengers, buses, "up");

    const SLOT1 = 1;
    const others = buses.filter(
      (b) => b.up_trip_id === SLOT1 && b.name !== "1호차"
    );
    const otherRemaining = others.reduce(
      (n, b) => n + (b.capacity - (up.by_bus[b.id] ?? 0)),
      0
    );
    const bus1Fixed = 25; // 1호차 고정 탑승 인원(fixture 기준)
    const bus1Free = (up.by_bus[1] ?? 0) - bus1Fixed;

    // ① 1호차는 넘친 만큼만 받는다 — 고정 25명 + 자유 8명.
    expect(bus1Free).toBe(8);

    // ② ⚠️ 다른 호차에 빈 좌석 9개가 **남아 있는데도** 1호차가 8명을 받는다.
    //    engine.ts 주석은 "다른 호차로 충분하면 1호차는 비워진다"고 하지만,
    //    실제 FILL_LAST 는 그렇게 강하지 않다. 캠퍼스 단위 best-fit(①)과
    //    1명조각 방지(②)가 먼저 걸려, 잔여 좌석이 흩어진 채로 1호차가 쓰인다.
    //    현재 운영에서 실제로 일어나는 일이므로 그대로 고정한다.
    //    Phase 3 에서 플래그로 승격할 때 이 값이 0 이 되면 "개선"이 아니라
    //    **다른 알고리즘이 된 것**이니 반드시 근거를 남길 것.
    expect(otherRemaining).toBe(9);

    // ③ 그 대가로 미배정이 생기지는 않는다.
    expect(up.errors).toEqual([]);
    expect(up.total_assigned).toBe(459);
  });
});
