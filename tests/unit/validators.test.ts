import { describe, expect, it } from "vitest";
import {
  RegistrationSchema,
  fieldErrors,
} from "@/lib/validators/registration";

/**
 * 신청 검증 — Phase 3-C 이후.
 *
 * 예전엔 attendance_type 을 **입력으로 받고** 규칙 3·4·5(왕복/편도/미이용 일관성)로
 * "제대로 계산해 왔는지"를 검사했다. 즉 파생값을 받아놓고 검산하는 구조였다.
 * 지금은 (상행 편, 하행 편) 두 값만 받고 DB 트리거가 참여 형태를 파생하므로,
 * 그 세 규칙은 **위반 자체가 불가능**해졌다. 그래서 그 테스트들은 사라지고,
 * 대신 "두 값만으로 모든 조합이 표현되는가"를 여기서 고정한다.
 */

const VALID_CAMPUS = "11111111-1111-4111-8111-111111111111";

function base(overrides: Record<string, unknown> = {}) {
  return {
    name: "김철수",
    campus_id: VALID_CAMPUS,
    student_id: "26",
    up_trip_id: 1,
    down_trip_id: 9,
    roles: [],
    ...overrides,
  };
}

describe("RegistrationSchema — 상·하행 두 값만 받는다", () => {
  it("왕복: 상행 편 + 하행 편", () => {
    expect(RegistrationSchema.safeParse(base()).success).toBe(true);
  });

  it("편도 상행: 하행만 비움", () => {
    expect(RegistrationSchema.safeParse(base({ down_trip_id: null })).success).toBe(true);
  });

  it("편도 하행: 상행만 비움", () => {
    expect(RegistrationSchema.safeParse(base({ up_trip_id: null })).success).toBe(true);
  });

  it("버스 미이용: 둘 다 비우고 이동 수단을 비고에", () => {
    const r = RegistrationSchema.safeParse(
      base({ up_trip_id: null, down_trip_id: null, note: "KTX 자가 이동" })
    );
    expect(r.success).toBe(true);
  });

  it("버스 미이용인데 비고가 없으면 실패 — 배차·출석에서 빠지므로 수단을 알아야 한다", () => {
    const r = RegistrationSchema.safeParse(
      base({ up_trip_id: null, down_trip_id: null })
    );
    expect(r.success).toBe(false);
    // fieldErrors 는 필드별 메시지 **배열**을 준다.
    if (!r.success) expect(fieldErrors(r.error).note?.join(" ")).toContain("이동 수단");
  });

  it("왕복인데 상·하행 편이 서로 다른 시각이어도 된다", () => {
    // 범용 틀의 핵심 — 조합 preset 으로는 표현할 수 없던 조합이다.
    expect(
      RegistrationSchema.safeParse(base({ up_trip_id: 2, down_trip_id: 11 })).success
    ).toBe(true);
  });

  it("attendance_type 은 아예 받지 않는다 — 파생값이라 입력이 아니다", () => {
    const parsed = RegistrationSchema.safeParse(base());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect("attendance_type" in parsed.data).toBe(false);
  });
});

describe("RegistrationSchema — 기본 필드", () => {
  it("이름 필수", () => {
    const r = RegistrationSchema.safeParse(base({ name: "" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).name).toBeTruthy();
  });

  it("이름 20자 초과 실패", () => {
    expect(RegistrationSchema.safeParse(base({ name: "가".repeat(21) })).success).toBe(false);
  });

  it("학번은 두 자리 숫자", () => {
    expect(RegistrationSchema.safeParse(base({ student_id: "26" })).success).toBe(true);
    expect(RegistrationSchema.safeParse(base({ student_id: "2" })).success).toBe(false);
    expect(RegistrationSchema.safeParse(base({ student_id: "abc" })).success).toBe(false);
  });

  it("학번 '외국인' / '타지구' 는 통과", () => {
    expect(RegistrationSchema.safeParse(base({ student_id: "외국인" })).success).toBe(true);
    expect(RegistrationSchema.safeParse(base({ student_id: "타지구" })).success).toBe(true);
  });

  it("캠퍼스는 uuid", () => {
    const r = RegistrationSchema.safeParse(base({ campus_id: "not-a-uuid" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).campus_id).toBeTruthy();
  });

  it("비고 200자 초과 실패", () => {
    expect(RegistrationSchema.safeParse(base({ note: "가".repeat(201) })).success).toBe(false);
  });

  it("roles 기본값 []", () => {
    const r = RegistrationSchema.safeParse({
      name: "김철수",
      campus_id: VALID_CAMPUS,
      student_id: "26",
      up_trip_id: 1,
      down_trip_id: 9,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.roles).toEqual([]);
  });
});
