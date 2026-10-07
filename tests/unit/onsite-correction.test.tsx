// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnsiteCorrection } from "@/components/onsite/onsite-correction";
import { visitSchema } from "@/lib/onsite/model";

afterEach(cleanup);
const visit = visitSchema.parse({ id: "f3000000-0000-4000-8000-000000000002", visit_number: 2, version: 3,
  arrived_at: "2026-10-07T01:00:31.123+00:00", departed_at: "2026-10-07T01:03:49.123+00:00" });
describe("현장 시각 정정", () => {
  it("날짜·분 입력을 건드리지 않으면 원래 초 단위 시각을 그대로 보존한다", async () => {
    // Given confirmed sub-minute timestamps
    const save = vi.fn().mockResolvedValue(true);
    render(<OnsiteCorrection visit={visit} name="합성 학우" busy={false} onSave={save} onClose={vi.fn()} />);
    // When saving only the correction reason
    await userEvent.type(screen.getByLabelText("정정 사유"), "시각 확인");
    await userEvent.click(screen.getByRole("button", { name: "정정 저장" }));
    // Then rounded native inputs cannot replace the original timestamp
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ arrived_at: visit.arrived_at, departed_at: visit.departed_at }));
  });
  it("날짜만 입력한 시각은 자정으로 저장하지 않는다", async () => {
    // Given an incomplete arrival edit
    const save = vi.fn();
    render(<OnsiteCorrection visit={visit} name="합성 학우" busy={false} onSave={save} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("현장 도착 시각"), { target: { value: "" } });
    await userEvent.type(screen.getByLabelText("정정 사유"), "입력 중");
    // When submitting
    await userEvent.click(screen.getByRole("button", { name: "정정 저장" }));
    // Then no storage request is made
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
  it("작성한 정정은 닫기 확인을 취소하면 남는다", async () => {
    // Given an unsaved correction draft
    const close = vi.fn();
    render(<OnsiteCorrection visit={visit} name="합성 학우" busy={false} onSave={vi.fn()} onClose={close} />);
    await userEvent.type(screen.getByLabelText("정정 사유"), "합성 검증 사유");
    // When close confirmation is cancelled
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));
    // Then the draft and dialog survive
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("정정 사유")).toHaveValue("합성 검증 사유");
  });
  it("정정 저장 중에는 시각·사유·해제·닫기를 잠가 전송 내용이 바뀌지 않는다", () => {
    render(<OnsiteCorrection visit={visit} name="합성 학우" busy={true} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("현장 도착 날짜")).toBeDisabled();
    expect(screen.getByLabelText("현장 도착 시각")).toBeDisabled();
    expect(screen.getByLabelText("행사 출발 날짜")).toBeDisabled();
    expect(screen.getByLabelText("행사 출발 시각")).toBeDisabled();
    expect(screen.getByLabelText("정정 사유")).toBeDisabled();
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

});
