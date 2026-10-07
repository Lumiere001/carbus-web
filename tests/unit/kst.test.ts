import { describe, expect, it } from "vitest";
import { formatKst, isCompleteDateTime, toKst, toKstInput } from "@/lib/time/kst";

describe("한국 날짜·시각", () => {
  it.each([
    ["2026-08-11T15:15:00Z", "2026-08-12T00:15"],
    ["2026-08-11T14:59:00Z", "2026-08-11T23:59"],
    ["2026-08-12T00:15:00+09:00", "2026-08-12T00:15"],
    ["2026-08-12T00:15", "2026-08-12T00:15"],
  ])("자정 경계에서 %s를 한국 입력값 %s로 표시한다", (saved, expected) => {
    // Given: 저장된 timestamp 또는 한국 시간 초안
    // When: 수정 폼의 날짜·시각으로 변환
    const input = toKstInput(saved);
    // Then: 실행 환경 시간대와 무관한 한국 날짜·시각
    expect(input).toBe(expected);
  });

  it("한국 자정 초안을 전날 UTC 순간으로 저장한다", () => {
    // Given
    const draft = "2026-08-12T00:15";
    // When
    const saved = toKst(draft);
    // Then
    expect(saved && new Date(saved).toISOString()).toBe("2026-08-11T15:15:00.000Z");
  });

  it.each(["2026-08-12T00:15:00+09:00", "2026-08-11T15:15:00Z"])("기존 오프셋 %s를 보존한다", (saved) => {
    // Given: 오프셋이 이미 있는 timestamp
    // When
    const result = toKst(saved);
    // Then
    expect(result).toBe(saved);
  });

  it.each(["", null, undefined])("미정 %s를 null로 저장한다", (draft) => {
    // Given: 날짜와 시각을 모두 정하지 않은 초안
    // When
    const saved = toKst(draft);
    // Then
    expect(saved).toBeNull();
  });

  it.each(["2026-08-12T", "T00:15", "2026-02-30T12:00", "2026-08-12T24:00"])("반쪽 또는 잘못된 초안 %s는 저장할 수 없다", (draft) => {
    // Given: 완성되지 않았거나 유효하지 않은 초안
    // When
    const complete = isCompleteDateTime(draft);
    // Then
    expect(complete).toBe(false);
  });

  it("완성된 자정 시각도 저장할 수 있다", () => {
    // Given
    const draft = "2026-08-12T00:00";
    // When
    const complete = isCompleteDateTime(draft);
    // Then
    expect(complete).toBe(true);
  });

  it.each(["not-a-date", "", null])("표시할 수 없는 %s는 미정으로 안내한다", (saved) => {
    // Given: 일시 미정 또는 유효하지 않은 timestamp
    // When
    const text = formatKst(saved);
    // Then
    expect(text).toBe("미정");
  });
});
