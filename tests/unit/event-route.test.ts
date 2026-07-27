import { describe, expect, it } from "vitest";
import { eventIdFromPath, adminHref, EVENT_HEADER } from "@/lib/events/route";

/**
 * 주소창 → 행사 id (Phase 4-5).
 *
 * 이 함수가 폴더화의 **진실원**이다. 여기서 뽑은 값이 요청 헤더로 실려 DB 까지 가고,
 * 쓰기 대상도 이걸로 정해진다. 틀리면 "화면은 A 인데 저장은 B" 가 되는데, 그게
 * 폴더화에서 가장 발견하기 어려운 사고다.
 */
const UUID = "18650503-b0fa-4d8e-ab16-72eb47c8c384";

describe("eventIdFromPath", () => {
  it("행사 경로에서 id 를 뽑는다", () => {
    expect(eventIdFromPath(`/admin/e/${UUID}`)).toBe(UUID);
    expect(eventIdFromPath(`/admin/e/${UUID}/buses`)).toBe(UUID);
    expect(eventIdFromPath(`/admin/e/${UUID}/logs?page=2`)).toBe(UUID);
  });

  it("대문자 uuid 도 받아 소문자로 정규화한다 — 헤더와 DB 비교가 문자열이라 중요하다", () => {
    expect(eventIdFromPath(`/admin/e/${UUID.toUpperCase()}/buses`)).toBe(UUID);
  });

  it("행사 경로가 아니면 null", () => {
    expect(eventIdFromPath("/admin")).toBeNull();
    expect(eventIdFromPath("/admin/login")).toBeNull();
    expect(eventIdFromPath("/campus")).toBeNull();
    expect(eventIdFromPath("/")).toBeNull();
  });

  it("uuid 모양이 아니면 null — 아무 문자열이나 통과시키면 DB 조회가 예외가 된다", () => {
    expect(eventIdFromPath("/admin/e/쓰레기값/buses")).toBeNull();
    expect(eventIdFromPath("/admin/e/12345/buses")).toBeNull();
    expect(eventIdFromPath("/admin/e//buses")).toBeNull();
  });

  it("옛 주소는 행사가 없다 — 리다이렉트 대상이라는 뜻", () => {
    expect(eventIdFromPath("/admin/buses")).toBeNull();
    expect(eventIdFromPath("/admin/registrations")).toBeNull();
  });
});

describe("adminHref", () => {
  it("하위 경로를 붙인다", () => {
    expect(adminHref(UUID)).toBe(`/admin/e/${UUID}`);
    expect(adminHref(UUID, "/buses")).toBe(`/admin/e/${UUID}/buses`);
    expect(adminHref(UUID, "buses")).toBe(`/admin/e/${UUID}/buses`);
    expect(adminHref(UUID, "")).toBe(`/admin/e/${UUID}`);
  });

  it("만든 주소를 다시 읽으면 같은 행사가 나온다 (왕복)", () => {
    expect(eventIdFromPath(adminHref(UUID, "/payments"))).toBe(UUID);
  });
});

describe("EVENT_HEADER", () => {
  it("헤더 이름은 소문자다 — HTTP 헤더는 대소문자 무시지만 DB 는 json 키로 정확히 읽는다", () => {
    expect(EVENT_HEADER).toBe("x-carbus-event");
    expect(EVENT_HEADER).toBe(EVENT_HEADER.toLowerCase());
  });
});
