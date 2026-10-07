// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateTimeField } from "@/components/ui/date-time-field";

function DraftField({ initial = "" }: { readonly initial?: string }) {
  const [draft, setDraft] = useState(initial);
  return <><DateTimeField label="픽업 일시" value={draft} onChange={setDraft} /><output aria-label="입력 초안">{draft}</output></>;
}

afterEach(cleanup);

describe("날짜·시각 분리 입력", () => {
  it.each([["2026-08-12T", "시각"], ["T00:15", "날짜"]])("반쪽 입력 %s의 오류는 빠진 %s로 초점을 옮긴다", (value, label) => {
    const view = render(<DateTimeField label="픽업 일시" value={value} onChange={() => {}} />);
    view.rerender(<DateTimeField label="픽업 일시" value={value} onChange={() => {}} error="날짜와 시각을 모두 입력해 주세요." />);
    expect(document.activeElement).toBe(screen.getByLabelText(label));
  });
  it.each([
    ["", "날짜", "2026-08-12", "2026-08-12T"],
    ["", "시각", "00:15", "T00:15"],
    ["2026-08-12T00:15", "날짜", "", "T00:15"],
    ["2026-08-12T00:15", "시각", "", "2026-08-12T"],
    ["T00:15", "날짜", "2026-08-12", "2026-08-12T00:15"],
    ["2026-08-12T", "시각", "00:15", "2026-08-12T00:15"],
    ["T00:15", "시각", "", ""],
  ])("초안 %s에서 %s를 바꾸면 반대쪽 값도 보존한다", (initial, label, value, expected) => {
    // Given: 부모가 보관하는 입력 초안
    render(<DraftField initial={initial} />);
    // When: 한쪽 native 입력을 바꿈
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    // Then: 임의의 날짜나 00:00을 채우지 않고 부모 초안에 전달
    expect(screen.getByLabelText("입력 초안").textContent).toBe(expected);
  });

  it("부모가 새 초안으로 바꾸면 양쪽 입력도 따라간다", () => {
    // Given
    const change = () => {};
    const view = render(<DateTimeField label="픽업 일시" value="2026-08-12T00:15" onChange={change} />);
    // When: 저장·취소·다른 행 선택 후 부모가 값을 바꿈
    view.rerender(<DateTimeField label="픽업 일시" value="2026-08-13T" onChange={change} />);
    // Then
    expect(screen.getByLabelText("날짜")).toHaveProperty("value", "2026-08-13");
    expect(screen.getByLabelText("시각")).toHaveProperty("value", "");
  });
});
