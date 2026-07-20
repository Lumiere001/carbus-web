import { describe, expect, it } from "vitest";
import { paymentDisplayOverride } from "@/lib/labels";

describe("paymentDisplayOverride — 차량비 0원 행의 납부 배지", () => {
  it("fee > 0 이면 관여하지 않는다 (기존 배지 유지)", () => {
    // 운영 데이터 539건(왕복 379 + 편도 160)이 여기 해당. 무변화가 보장돼야 한다.
    expect(paymentDisplayOverride(50000, null)).toBeNull();
    expect(paymentDisplayOverride(25000, "하행 순수 확정")).toBeNull();
    expect(paymentDisplayOverride(25000, "환불 필요")).toBeNull();
  });

  it("fee = 0 이고 비고에 환불 언급이 없으면 '해당없음'", () => {
    // 버스를 안 타면 청구액이 0이라 완납/미납 자체가 의미 없다.
    expect(paymentDisplayOverride(0, null)).toEqual({
      label: "해당없음",
      variant: "mute",
    });
    expect(paymentDisplayOverride(0, "자차 이용")).toEqual({
      label: "해당없음",
      variant: "mute",
    });
  });

  it("fee = 0 이어도 비고에 '환불' 이 있으면 '환불 대기' — 감추면 안 된다", () => {
    // 버스를 취소하면 attendance_type 이 self 로 바뀌며 fee 가 0이 된다.
    // 즉 "이미 받은 돈"의 청구 기록이 사라진다. 이걸 '해당없음' 으로 묶으면
    // 환불 채무가 화면에서 영원히 안 보인다. 운영 데이터 12건이 여기 해당.
    expect(paymentDisplayOverride(0, "왕복 신청했으나 취소. 환불 필요.")).toEqual({
      label: "환불 대기",
      variant: "warning",
    });
  });

  it("빈 문자열·공백·개행만 있는 비고는 '해당없음'", () => {
    expect(paymentDisplayOverride(0, "")?.label).toBe("해당없음");
    expect(paymentDisplayOverride(0, "   ")?.label).toBe("해당없음");
    expect(paymentDisplayOverride(0, "\n\n")?.label).toBe("해당없음");
  });

  it("fee 가 null/undefined 여도 0으로 취급해 터지지 않는다", () => {
    expect(paymentDisplayOverride(null, null)?.label).toBe("해당없음");
    expect(paymentDisplayOverride(undefined, undefined)?.label).toBe("해당없음");
    expect(paymentDisplayOverride(null, "환불 필요")?.label).toBe("환불 대기");
  });

  it("운영 데이터 스냅샷: fee=0 60건 = 환불 대기 12 + 해당없음 48", () => {
    // 2026-07-20 백업 기준. 이 비율이 깨지면 분류 규칙이 바뀐 것이다.
    const rows = [
      ...Array.from({ length: 12 }, () => ({ fee: 0, note: "환불 필요" })),
      ...Array.from({ length: 48 }, () => ({ fee: 0, note: "자차" })),
    ];
    const out = rows.map((r) => paymentDisplayOverride(r.fee, r.note)!);
    expect(out.filter((o) => o.label === "환불 대기")).toHaveLength(12);
    expect(out.filter((o) => o.label === "해당없음")).toHaveLength(48);
  });
});
