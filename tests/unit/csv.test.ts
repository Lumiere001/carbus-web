import { describe, expect, it } from "vitest";
import { parseRegistrationsCsv } from "@/lib/csv/parse";

const CAMPUS = "11111111-1111-4111-8111-111111111111";
const SLOTS = [
  { id: 1, key: "tue_am", label: "화 오전 9시" },
  { id: 2, key: "tue_pm", label: "화 오후 7시" },
];

describe("parseRegistrationsCsv (reference/validators.md §5·7)", () => {
  it("정상 CSV — 왕복·편도상행·편도하행 3행 모두 성공 (슬롯 key)", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "김철수,26,왕복,tue_am,O,",
      "이영희,27,편도,tue_am,X,상행만",
      "박지민,타지구,편도,,O,하행만",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(0);
    expect(successes).toHaveLength(3);
    expect(successes[0]).toMatchObject({
      name: "김철수",
      student_id: "26",
      attendance_type: "roundtrip",
      departure_slot_id: 1,
      uses_return_bus: true,
    });
    expect(successes[2]).toMatchObject({
      attendance_type: "oneway",
      departure_slot_id: null,
      uses_return_bus: true,
    });
  });

  it("슬롯 라벨로도 인식 (화 오후 7시)", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "라벨,26,왕복,화 오후 7시,O,",
    ].join("\n");
    const { successes } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(successes[0]).toMatchObject({ departure_slot_id: 2 });
  });

  it("인식 불가 슬롯값 → 검증 실패로 표면화", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "오류,26,왕복,수요일,O,",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(successes).toHaveLength(0);
    expect(failures).toHaveLength(1);
  });

  it("학번 형식 오류 → 실패 행", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "오류,2611,왕복,tue_am,O,",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(successes).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].row).toBe(2);
    expect(failures[0].reason).toContain("학번");
  });

  it("왕복인데 슬롯 공란 → 일관성 실패", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "위반,26,왕복,,O,",
    ].join("\n");
    const { failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain("왕복");
  });

  it("O/X·Y/N 불리언 변환", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "에이,26,편도,tue_am,X,",
      "비,25,편도,tue_pm,N,",
    ].join("\n");
    const { successes } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(successes).toHaveLength(2);
    expect(successes[0].uses_return_bus).toBe(false);
    expect(successes[1].uses_return_bus).toBe(false);
  });

  it("TSV(탭 구분, 복붙) 자동 감지 + 구 헤더 '상행 요일' 호환", () => {
    const tsv = [
      "이름\t학번\t참석 유형\t상행 요일\t하행 차량 이용\t비고",
      "탭철수\t26\t왕복\ttue_pm\tO\t",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(tsv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(0);
    expect(successes[0]).toMatchObject({ name: "탭철수", departure_slot_id: 2 });
  });

  it("성공·실패 혼재 → 분리", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "정상,26,왕복,tue_am,O,",
      "불량,abc,왕복,tue_am,O,",
      "정상2,타지구,편도,tue_pm,X,",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(successes).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(failures[0].row).toBe(3);
  });
});
