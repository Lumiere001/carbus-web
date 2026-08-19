import { describe, it, expect } from "vitest";
import { staffCarSync } from "@/lib/admin/leaders";

/**
 * 간사 차량 지정 → 실제 배정 반영 (§26-E).
 *
 * 배경: 간사 차량은 자동 배차의 "빈자리 채움" 단계에서 빠진다. 그래서 리더 화면의
 * 지정이 `buses.fixed_passenger_ids` 에만 남고, `assigned_*_bus_id` 를 읽는
 * 대시보드·전체 순장/순원·출석부에는 배차를 돌리기 전까지 아무것도 안 나타났다.
 *
 * 이 판정부의 계약:
 *  - 간사 차에 태우면 → 배정까지 쓴다 (배차 엔진 Step 1 과 같은 결과를 미리 만든다)
 *  - 간사 차에서 내리면 → 배정을 푼다 (유령 탑승자 방지)
 *  - 일반 버스는 → 손대지 않는다 (배차 엔진 소관)
 */
describe("staffCarSync", () => {
  it("간사 차에 새로 태우면 그 호차로 배정한다", () => {
    expect(
      staffCarSync({ nextKind: "staff_car", nextBusId: 91, currentKind: null })
    ).toEqual({ action: "assign", busId: 91 });
  });

  it("일반 버스에서 간사 차로 옮기면 간사 차로 배정한다", () => {
    expect(
      staffCarSync({ nextKind: "staff_car", nextBusId: 91, currentKind: "bus" })
    ).toEqual({ action: "assign", busId: 91 });
  });

  it("간사 차 지정을 풀면 배정도 푼다 — 유령 탑승자가 남으면 안 된다", () => {
    expect(
      staffCarSync({ nextKind: null, nextBusId: null, currentKind: "staff_car" })
    ).toEqual({ action: "clear" });
  });

  it("간사 차에서 일반 버스로 옮기면 간사 차 배정을 푼다 (일반 버스 배정은 배차가 쓴다)", () => {
    expect(
      staffCarSync({ nextKind: "bus", nextBusId: 3, currentKind: "staff_car" })
    ).toEqual({ action: "clear" });
  });

  it("일반 버스 고정 지정은 배정을 건드리지 않는다 — 그건 배차 엔진 소관이다", () => {
    expect(
      staffCarSync({ nextKind: "bus", nextBusId: 3, currentKind: "bus" })
    ).toBeNull();
  });

  it("일반 버스 고정을 풀어도 배정은 그대로 둔다 — 멀쩡한 배차를 지우면 안 된다", () => {
    expect(
      staffCarSync({ nextKind: null, nextBusId: null, currentKind: "bus" })
    ).toBeNull();
  });

  it("아무 데도 안 묶인 사람은 손대지 않는다", () => {
    expect(
      staffCarSync({ nextKind: null, nextBusId: null, currentKind: null })
    ).toBeNull();
  });
});
