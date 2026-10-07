// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ParticipationRange } from "@/components/admin/participation-range";

describe("참여 기간 묶음 저장", () => {
  beforeEach(cleanup);
  it("시작일을 먼저 바꿔도 두 날짜를 완성하기 전에는 저장하지 않는다", () => {
    const save = vi.fn();
    render(<ParticipationRange from="2026-08-08" to="2026-08-10" disabled={false} onChange={save} />);
    fireEvent.change(screen.getByLabelText("참여 시작일"), { target: { value: "2026-08-14" } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("참여 종료일"), { target: { value: "2026-08-16" } });
    fireEvent.click(screen.getByRole("button", { name: "기간 저장" }));
    expect(save).toHaveBeenCalledExactlyOnceWith("2026-08-14", "2026-08-16", { attend_from: "2026-08-08", attend_to: "2026-08-10" });
  });
  it("뒤집힌 날짜는 저장을 막고 종료일로 초점을 옮긴다", () => {
    const save = vi.fn();
    render(<ParticipationRange from={null} to={null} disabled={false} onChange={save} />);
    fireEvent.change(screen.getByLabelText("참여 시작일"), { target: { value: "2026-08-16" } });
    fireEvent.change(screen.getByLabelText("참여 종료일"), { target: { value: "2026-08-14" } });
    fireEvent.click(screen.getByRole("button", { name: "기간 저장" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("참여 종료일"));
    expect(screen.getByLabelText("참여 시작일")).toHaveProperty("value", "2026-08-16");
  });
  it("두 날짜를 비우면 전체 참석(null,null)으로 한 번에 저장한다", () => {
    const save = vi.fn();
    render(<ParticipationRange from="2026-08-14" to="2026-08-16" disabled={false} onChange={save} />);
    fireEvent.change(screen.getByLabelText("참여 시작일"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("참여 종료일"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "기간 저장" }));
    expect(save).toHaveBeenCalledExactlyOnceWith(null, null, { attend_from: "2026-08-14", attend_to: "2026-08-16" });
  });
  it("작성하지 않은 기간은 최신 서버 날짜를 반영한다", () => {
    const save = vi.fn();
    const { rerender } = render(<ParticipationRange from={null} to={null} disabled={false} onChange={save} />);
    rerender(<ParticipationRange from="2026-08-14" to="2026-08-16" disabled={false} onChange={save} />);
    expect(screen.getByLabelText("참여 시작일")).toHaveProperty("value", "2026-08-14");
    expect(screen.getByLabelText("참여 종료일")).toHaveProperty("value", "2026-08-16");
    expect(save).not.toHaveBeenCalled();
  });
  it("다른 기기가 기간을 바꿔도 초안과 편집 시작 시 두 날짜를 보존한다", () => {
    const save = vi.fn();
    const { rerender } = render(<ParticipationRange from="2026-08-08" to="2026-08-10" disabled={false} onChange={save} />);
    fireEvent.change(screen.getByLabelText("참여 시작일"), { target: { value: "2026-08-14" } });
    fireEvent.change(screen.getByLabelText("참여 종료일"), { target: { value: "2026-08-16" } });
    rerender(<ParticipationRange from="2026-08-20" to="2026-08-22" disabled={false} onChange={save} />);
    expect(screen.getByLabelText("참여 시작일")).toHaveProperty("value", "2026-08-14");
    fireEvent.click(screen.getByRole("button", { name: "기간 저장" }));
    expect(save).toHaveBeenCalledExactlyOnceWith("2026-08-14", "2026-08-16", { attend_from: "2026-08-08", attend_to: "2026-08-10" });
    fireEvent.click(screen.getByRole("button", { name: "입력 버리고 새 값 불러오기" }));
    expect(screen.getByLabelText("참여 시작일")).toHaveProperty("value", "2026-08-20");
    expect(screen.getByLabelText("참여 종료일")).toHaveProperty("value", "2026-08-22");
    expect(screen.getByRole("button", { name: "기간 저장" }).hasAttribute("disabled")).toBe(true);
  });

});
