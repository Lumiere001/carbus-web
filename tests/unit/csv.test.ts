import { describe, expect, it } from "vitest";
import { parseRegistrationsCsv } from "@/lib/csv/parse";

const CAMPUS = "11111111-1111-4111-8111-111111111111";

describe("parseRegistrationsCsv (reference/validators.md §5·7)", () => {
  it("정상 CSV — 왕복·편도상행·편도하행 3행 모두 성공", () => {
    const csv = [
      "이름,학번,참석 유형,상행 요일,하행 차량 이용,비고",
      "김철수,26,왕복,화요일,O,",
      "이영희,27,편도,화요일,X,상행만",
      "박지민,간사,편도,,O,하행만",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS);
    expect(failures).toHaveLength(0);
    expect(successes).toHaveLength(3);
    expect(successes[0]).toMatchObject({
      name: "김철수",
      student_id: "26",
      attendance_type: "roundtrip",
      departure_day: "TUE",
      uses_return_bus: true,
    });
    expect(successes[2]).toMatchObject({
      attendance_type: "oneway",
      departure_day: null,
      uses_return_bus: true,
    });
  });

  it("학번 형식 오류 → 실패 행", () => {
    const csv = [
      "이름,학번,참석 유형,상행 요일,하행 차량 이용,비고",
      "오류,2611,왕복,화요일,O,",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS);
    expect(successes).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].row).toBe(2);
    expect(failures[0].reason).toContain("학번");
  });

  it("왕복인데 요일 공란 → 일관성 실패", () => {
    const csv = [
      "이름,학번,참석 유형,상행 요일,하행 차량 이용,비고",
      "위반,26,왕복,,O,",
    ].join("\n");
    const { failures } = parseRegistrationsCsv(csv, CAMPUS);
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toContain("왕복");
  });

  it("O/X·Y/N 불리언 변환", () => {
    const csv = [
      "이름,학번,참석 유형,상행 요일,하행 차량 이용,비고",
      "에이,26,편도,화요일,X,",
      "비,25,편도,수요일,N,",
    ].join("\n");
    const { successes } = parseRegistrationsCsv(csv, CAMPUS);
    expect(successes).toHaveLength(2);
    expect(successes[0].uses_return_bus).toBe(false);
    expect(successes[1].uses_return_bus).toBe(false);
  });

  it("TSV(탭 구분, 복붙) 자동 감지", () => {
    const tsv = [
      "이름\t학번\t참석 유형\t상행 요일\t하행 차량 이용\t비고",
      "탭철수\t26\t왕복\t수요일\tO\t",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(tsv, CAMPUS);
    expect(failures).toHaveLength(0);
    expect(successes[0]).toMatchObject({ name: "탭철수", departure_day: "WED" });
  });

  it("성공·실패 혼재 → 분리", () => {
    const csv = [
      "이름,학번,참석 유형,상행 요일,하행 차량 이용,비고",
      "정상,26,왕복,화요일,O,",
      "불량,abc,왕복,화요일,O,",
      "정상2,간사,편도,수요일,X,",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS);
    expect(successes).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(failures[0].row).toBe(3);
  });
});
