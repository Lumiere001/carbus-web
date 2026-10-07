// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshOnReturn } from "@/components/ui/refresh-on-return";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => { refresh.mockReset(); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); });
afterEach(cleanup);

describe("화면으로 돌아온 뒤 최신 자료 확인", () => {
  it("작성 중인 입력을 덮지 않고 작성 종료 후 밀린 새로고침을 한 번 수행한다", async () => {
    // Given a dirty form visible in the workspace
    const view = render(<main><div data-unsaved="true">작성 중</div><RefreshOnReturn /></main>);
    // When returning while the draft is open
    fireEvent(window, new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("입력 중인 내용을 보호했습니다");
    // Then closing the draft automatically reads the shared committed data
    view.rerender(<main><div data-unsaved="false">저장 완료</div><RefreshOnReturn /></main>);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("열린 대화상자는 보호하고 대화상자가 닫히면 최신 자료를 읽는다", async () => {
    // Given an open detail dialog
    const view = render(<main><dialog open>상세</dialog><RefreshOnReturn /></main>);
    // When returning to its window
    fireEvent(window, new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();
    // Then closing it flushes the deferred refresh
    view.rerender(<main><dialog>상세</dialog><RefreshOnReturn /></main>);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("숨겨진 창은 요청하지 않고 화면이 다시 보일 때 새로 읽는다", () => {
    // Given a background workspace
    render(<RefreshOnReturn />);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    // When background focus events arrive
    act(() => window.dispatchEvent(new Event("focus")));
    expect(refresh).not.toHaveBeenCalled();
    // Then the visible return refreshes once
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
