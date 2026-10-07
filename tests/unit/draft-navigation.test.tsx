// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import Link from "next/link";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftNavigationProvider } from "@/components/ui/draft-navigation";
import { EventSwitcher } from "@/components/admin/event-switcher";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/admin/e/old/registrations" }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
function mount(saving = false) {
  return render(<DraftNavigationProvider>
    <form data-unsaved="true" data-saving={saving}><input aria-label="작성 중 이름" defaultValue="합성 입력" /></form>
    <Link href="/admin/e/old/partial">부분 참석으로 이동</Link>
    <EventSwitcher current={{ id: "old", name: "이전 행사" }} events={[{ id: "old", name: "이전 행사", isLive: true }, { id: "new", name: "다른 행사", isLive: false }]} />
  </DraftNavigationProvider>);
}

describe("작성 중인 전체 신청의 이동 보호", () => {
  it("다른 화면 이동을 취소하면 입력을 남기고, 승인했을 때만 이동한다", async () => {
    mount();
    fireEvent.click(screen.getByRole("link", { name: "부분 참석으로 이동" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "취소" })); });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("작성 중 이름")).toHaveValue("합성 입력");
    fireEvent.click(screen.getByRole("link", { name: "부분 참석으로 이동" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "입력 버리고 이동" })); });
    expect(push).toHaveBeenCalledExactlyOnceWith("/admin/e/old/partial");
  });
  it("행사 선택을 취소하면 표시된 행사와 초안을 유지한다", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("보는 행사 바꾸기"), { target: { value: "new" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "취소" })); });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("보는 행사 바꾸기")).toHaveValue("old");
    expect(screen.getByLabelText("작성 중 이름")).toHaveValue("합성 입력");
  });
  it("저장 중에는 이동 대신 저장 결과를 기다리는 안내를 표시한다", async () => {
    mount(true);
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "부분 참석으로 이동" })); });
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("저장 결과");
  });
  it("작성 중인 페이지를 새로고침하거나 닫으려면 기본 브라우저 경고를 요청한다", () => {
    mount();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
