import { describe, expect, it } from "vitest";
import { parseRegistrationsCsv } from "@/lib/csv/parse";

const CAMPUS = "11111111-1111-4111-8111-111111111111";
const SLOTS = [
  { id: 1, key: "tue_am", label: "화 오전 9시", direction: "up" as const, active: true },
  { id: 2, key: "tue_pm", label: "화 오후 7시", direction: "up" as const, active: true },
  // 하행 편 하나 — O/X 하위호환이 이 편으로 해석된다.
  { id: 9, key: "return", label: "귀가", direction: "down" as const, active: true },
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
      up_trip_id: 1,
      down_trip_id: 9,
    });
    expect(successes[2]).toMatchObject({
      up_trip_id: null,
      down_trip_id: 9,
    });
  });

  it("슬롯 라벨로도 인식 (화 오후 7시)", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "라벨,26,왕복,화 오후 7시,O,",
    ].join("\n");
    const { successes } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(successes[0]).toMatchObject({ up_trip_id: 2 });
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

  it("상행 공란이면 편도 하행으로 해석된다 — 예전엔 '왕복 일관성 실패'였다", () => {
    // attendance_type 이 파생값이 되면서 "왕복인데 슬롯 없음" 같은 모순 자체가
    // 표현 불가능해졌다. 두 편만 받으므로 빈 상행은 그냥 하행 편도다.
    const csv = ["이름,학번,상행 출발,하행 차량 이용,비고", "모순,26,,O,"].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(0);
    expect(successes[0]).toMatchObject({ up_trip_id: null, down_trip_id: 9 });
  });

  it("하위호환: 하행 O/X·Y/N 을 편 id 로 해석한다", () => {
    // 임역원 기존 템플릿이 전부 O/X 라 계속 받아야 한다.
    // 하행 편이 하나뿐일 때만 해석 가능 — O 는 "탄다"만 말하기 때문이다.
    const csv = [
      "이름,학번,상행 출발,하행 차량 이용,비고",
      "에이,26,tue_am,X,",
      "비,25,tue_pm,O,",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(0);
    expect(successes[0].down_trip_id).toBeNull();
    expect(successes[1].down_trip_id).toBe(9);
  });

  it("하행 편이 여러 개면 O 를 해석하지 않고 실패로 표면화한다", () => {
    // 조용히 아무 편이나 꽂으면 엉뚱한 시각 버스에 배차된다. 사람이 고치게 둔다.
    const twoDown = [
      ...SLOTS,
      { id: 10, key: "return_pm", label: "귀가 오후", direction: "down" as const, active: true },
    ];
    const csv = ["이름,학번,상행 출발,하행 차량 이용,비고", "에이,26,tue_am,O,"].join("\n");
    const { failures } = parseRegistrationsCsv(csv, CAMPUS, twoDown);
    expect(failures).toHaveLength(1);
  });

  it("하행도 편 라벨로 지정할 수 있다 — 여러 편이어도 명확하다", () => {
    const twoDown = [
      ...SLOTS,
      { id: 10, key: "return_pm", label: "귀가 오후", direction: "down" as const, active: true },
    ];
    const csv = ["이름,학번,상행 출발,하행 출발,비고", "에이,26,tue_am,귀가 오후,"].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, twoDown);
    expect(failures).toHaveLength(0);
    expect(successes[0].down_trip_id).toBe(10);
  });

  it("TSV(탭 구분, 복붙) 자동 감지 + 구 헤더 '상행 요일' 호환", () => {
    const tsv = [
      "이름\t학번\t참석 유형\t상행 요일\t하행 차량 이용\t비고",
      "탭철수\t26\t왕복\ttue_pm\tO\t",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(tsv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(0);
    expect(successes[0]).toMatchObject({ name: "탭철수", up_trip_id: 2 });
  });

  it("버스 미이용(self) — 슬롯 빈칸 + 하행 X + 비고에 수단 → 통과", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "케이티엑스,26,버스 미이용,,X,KTX 자가 이동",
      "차차,27,미이용,,X,자차",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(0);
    expect(successes).toHaveLength(2);
    expect(successes[0]).toMatchObject({
      up_trip_id: null,
      down_trip_id: null,
      note: "KTX 자가 이동",
    });
  });

  it("하행 열이 없는 옛 CSV 의 '왕복' → 하행 편이 채워진다 (편도로 조용히 등록되지 않는다)", () => {
    // 실제 결함이었다: '참석 유형' 열을 읽고 버려서, 왕복 요금을 낸 학우가
    // 편도 상행으로 등록되고 귀가 버스에서 빠졌다.
    const csv = ["이름,학번,참석 유형,상행 출발,비고", "왕복이,26,왕복,tue_am,"].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(0);
    expect(successes[0]).toMatchObject({ up_trip_id: 1, down_trip_id: 9 });
  });

  it("하행 열이 없고 하행 편이 여러 개면 실패로 표면화", () => {
    const twoDown = [
      ...SLOTS,
      { id: 10, key: "return_pm", label: "귀가 오후", direction: "down" as const, active: true },
    ];
    const csv = ["이름,학번,참석 유형,상행 출발,비고", "왕복이,26,왕복,tue_am,"].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, twoDown);
    expect(successes).toHaveLength(0);
    expect(failures[0].reason).toContain("하행 편이 2개");
  });

  it("하행 열이 없는 '편도'(상행 있음) → 그대로 편도 상행", () => {
    const csv = ["이름,학번,참석 유형,상행 출발,비고", "편도,26,편도,tue_am,"].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(failures).toHaveLength(0);
    expect(successes[0]).toMatchObject({ up_trip_id: 1, down_trip_id: null });
  });

  it("참석 유형과 상·하행 입력이 어긋나면 실패 — 조용히 한쪽을 버리지 않는다", () => {
    const csv = [
      "이름,학번,참석 유형,상행 출발,하행 차량 이용,비고",
      "모순,26,왕복,tue_am,X,",
    ].join("\n");
    const { successes, failures } = parseRegistrationsCsv(csv, CAMPUS, SLOTS);
    expect(successes).toHaveLength(0);
    expect(failures[0].reason).toContain("참석 유형");
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
