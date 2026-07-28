/**
 * 편에 차를 붙이고 떼는 **판단**만 검증한다 (§26-A).
 *
 * 왜 순수 함수로 떼어 냈나 — 실제 붙이기는 Supabase 브라우저 클라이언트를 쓰는
 * "use client" 모듈이라 로컬에서 돌려볼 수가 없다. 그런데 이 결함(상행 3대 +
 * 하행 3대 = 6대)은 **판단의 결함**이었지 DB 의 결함이 아니었다. 판단만 떼어
 * 내면 그 부분은 확실히 잡힌다. DB 쪽 규칙(배정된 사람이 있으면 못 뗀다)은
 * 트리거가 막고, 그건 psql 로 확인한다.
 */
import { describe, expect, it } from "vitest";
import { planBusAttachment, planBusReduction } from "@/lib/admin/trips";

describe("planBusAttachment — 비어 있는 방향부터 채운다", () => {
  it("상행 3대 뒤에 하행 3대를 지정하면 같은 3대가 왕복한다", () => {
    // 상행 편을 만들 때: 차가 하나도 없으니 3대를 새로 만든다.
    const first = planBusAttachment([], [], 3);
    expect(first.reuse).toEqual([]);
    expect(first.create).toEqual(["1호차", "2호차", "3호차"]);

    // 하행 편을 만들 때: 그 1~3호차는 하행이 비어 있으므로 **재사용**한다.
    // 예전에는 여기서 4·5·6호차를 새로 만들어 6대가 됐다 — 그게 §26-A 의 결함이다.
    const free = [
      { id: 1, name: "1호차" },
      { id: 2, name: "2호차" },
      { id: 3, name: "3호차" },
    ];
    const second = planBusAttachment(free, ["1호차", "2호차", "3호차"], 3);
    expect(second.reuse.map((b) => b.name)).toEqual(["1호차", "2호차", "3호차"]);
    expect(second.create).toEqual([]);
  });

  it("모자라면 그만큼만 새로 만든다 — 방향별 대수가 달라도 된다", () => {
    // 작년 실데이터가 상행 11대 / 하행 10대였다. 강제로 양방향으로 묶으면 안 된다.
    const free = [
      { id: 1, name: "1호차" },
      { id: 2, name: "2호차" },
    ];
    const plan = planBusAttachment(free, ["1호차", "2호차"], 4);
    expect(plan.reuse.map((b) => b.name)).toEqual(["1호차", "2호차"]);
    expect(plan.create).toEqual(["3호차", "4호차"]);
  });

  it("남는 차가 더 많아도 필요한 만큼만 쓴다", () => {
    const free = [
      { id: 1, name: "1호차" },
      { id: 2, name: "2호차" },
      { id: 3, name: "3호차" },
    ];
    const plan = planBusAttachment(free, ["1호차", "2호차", "3호차"], 1);
    expect(plan.reuse.map((b) => b.name)).toEqual(["1호차"]);
    expect(plan.create).toEqual([]);
  });

  it("번호 규칙을 벗어난 이름은 번호 계산에서 무시된다", () => {
    // 간사 차량은 `A간사차` 처럼 자유 입력이다(§26-E). 그 이름이 번호를 밀어내면
    // 다음 버스가 엉뚱한 번호를 받는다.
    const plan = planBusAttachment([], ["1호차", "2호차", "A간사차"], 1);
    expect(plan.create).toEqual(["3호차"]);
  });

  it("0대를 요구하면 아무것도 하지 않는다", () => {
    const plan = planBusAttachment([{ id: 1, name: "1호차" }], ["1호차"], 0);
    expect(plan).toEqual({ reuse: [], create: [] });
  });
});

describe("planBusReduction — 지우는 것과 떼는 것을 가른다", () => {
  const current = [
    { id: 1, name: "1호차", servesOther: true },
    { id: 2, name: "2호차", servesOther: true },
    { id: 3, name: "3호차", servesOther: false },
  ];

  it("반대 방향도 뛰는 차는 이 편에서만 뗀다", () => {
    // 지워 버리면 하행 대수를 줄였을 뿐인데 상행 배차까지 사라진다.
    const steps = planBusReduction(current, 1);
    expect(steps).toEqual([
      { id: 3, name: "3호차", action: "delete" }, // 이 방향만 뛰던 차 → 지운다
      { id: 2, name: "2호차", action: "detach" }, // 상행도 뛴다 → 뗀다
    ]);
  });

  it("뒤에 붙은 차부터 처리한다", () => {
    const steps = planBusReduction(current, 2);
    expect(steps.map((s) => s.id)).toEqual([3]);
  });

  it("목표가 지금보다 크거나 같으면 아무것도 하지 않는다", () => {
    expect(planBusReduction(current, 3)).toEqual([]);
    expect(planBusReduction(current, 5)).toEqual([]);
  });

  it("0으로 줄이면 전부 처리한다", () => {
    expect(planBusReduction(current, 0).map((s) => s.action)).toEqual([
      "delete",
      "detach",
      "detach",
    ]);
  });
});
