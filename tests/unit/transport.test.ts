import { describe, expect, it } from "vitest";
import {
  transportBadge,
  transportSummaryText,
  TRANSPORT_MODES,
  TRANSPORT_LABELS,
} from "@/lib/transport/labels";

/**
 * 이동수단 표시 (3단계 — 비고 구조화).
 *
 * 피드백의 핵심은 두 가지였다:
 *   ① "타지구"가 소속인지 얻어 타는 차인지 구분이 안 된다
 *   ② 확정 대기를 **한눈에** 보고 싶다
 * ②는 색과 문구로 푸는 문제라, 여기서 그 규칙을 고정한다.
 */
describe("transportBadge", () => {
  it("우리 버스는 배지를 안 만든다 — 대부분이 그래서 소음이 된다", () => {
    expect(transportBadge("our_bus", "confirmed", null)).toBeNull();
    expect(transportBadge(null, null, null)).toBeNull();
    expect(transportBadge(undefined, undefined, undefined)).toBeNull();
  });

  it("타지구 확정은 지구명을 그대로 보여준다", () => {
    const b = transportBadge("other_district", "confirmed", "전주지구")!;
    expect(b.text).toBe("전주지구");
    expect(b.tone).toBe("primary");
  });

  it("타지구 확정 대기는 색이 다르고 '대기'가 붙는다 — 훑어보며 걸러야 한다", () => {
    const b = transportBadge("other_district", "pending", "전주지구")!;
    expect(b.text).toBe("전주지구 대기");
    expect(b.tone).toBe("warning");
    // 좌석을 잡아둔다는 사실이 설명에 있어야 한다 (사용자 결정)
    expect(b.title).toContain("좌석");
  });

  it("지구를 아직 안 고른 타지구도 깨지지 않는다", () => {
    const b = transportBadge("other_district", "confirmed", null)!;
    expect(b.text).toBe("지구 미지정");
  });

  it("KTX·자차는 짧은 배지로", () => {
    expect(transportBadge("ktx", "confirmed", null)!.text).toBe("KTX");
    expect(transportBadge("own_car", "confirmed", null)!.text).toBe("자차");
  });

  it("모든 수단에 라벨이 있다 — 하나라도 비면 화면에 빈칸이 뜬다", () => {
    for (const m of TRANSPORT_MODES) {
      expect(TRANSPORT_LABELS[m]).toBeTruthy();
    }
  });
});

describe("transportSummaryText", () => {
  it("상·하행이 같으면 한 번만 말한다", () => {
    expect(transportSummaryText({ mode: "ktx" }, { mode: "ktx" })).toBe("KTX·고속버스");
  });

  it("다르면 둘 다 말한다 — '가는 편은 KTX, 오는 편은 우리 버스'가 실제로 있다", () => {
    expect(
      transportSummaryText({ mode: "ktx" }, { mode: "our_bus" })
    ).toBe("가는 편 KTX·고속버스 · 오는 편 우리 버스");
  });

  it("값이 없으면 우리 버스로 읽는다 (행을 안 만드는 게 기본값이라서)", () => {
    expect(transportSummaryText(null, null)).toBe("우리 버스");
  });

  it("타지구는 지구명을 붙인다", () => {
    expect(
      transportSummaryText(
        { mode: "other_district", via: "부산지구" },
        { mode: "other_district", via: "부산지구" }
      )
    ).toBe("부산지구 차량");
  });
});
