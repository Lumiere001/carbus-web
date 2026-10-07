// @vitest-environment happy-dom
import { createRef, useImperativeHandle } from "react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useConfirmation } from "@/components/ui/use-confirmation";

type Request = ReturnType<typeof useConfirmation>["requestConfirmation"];
const OPTIONS = { title: "기록을 삭제할까요?", description: "연결된 기록도 제거됩니다.", confirmLabel: "기록 삭제", tone: "danger" } as const;

function Harness({ api }: { readonly api: RefObject<Request | null> }) {
  const { requestConfirmation, confirmationDialog } = useConfirmation();
  useImperativeHandle(api, () => requestConfirmation, [requestConfirmation]);
  return <><button>요청한 버튼</button>{confirmationDialog}</>;
}

function setup() {
  const api = createRef<Request>();
  const view = render(<Harness api={api} />);
  const request = api.current;
  if (!request) throw new Error("확인 요청 함수가 연결되지 않았습니다.");
  return { request, view };
}

afterEach(cleanup);

describe("비동기 확인 대화상자", () => {
  it("실행을 누르기 전에는 대기하고 누르면 true로 한 번 완료한다", async () => {
    // Given: 확인을 기다리는 호출자
    const { request } = setup();
    let pending = Promise.resolve(false);
    act(() => { pending = request(OPTIONS); });
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "기록 삭제" })); });
    // Then
    await expect(pending).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("취소에 처음 초점을 두고 취소하면 false 및 원래 초점으로 돌아온다", async () => {
    // Given
    const { request } = setup();
    const trigger = screen.getByRole("button", { name: "요청한 버튼" });
    trigger.focus();
    let pending = Promise.resolve(true);
    act(() => { pending = request(OPTIONS); });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "취소" }));
    // When
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "취소" })); });
    // Then
    await expect(pending).resolves.toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape에 해당하는 dialog cancel 이벤트도 false로 완료한다", async () => {
    // Given
    const { request } = setup();
    let pending = Promise.resolve(true);
    act(() => { pending = request(OPTIONS); });
    // When: 브라우저가 Escape를 dialog cancel 이벤트로 전달
    await act(async () => { fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true })); });
    // Then
    await expect(pending).resolves.toBe(false);
  });

  it("새 요청은 이전 대기를 false로 정리하고 최신 요청만 실행한다", async () => {
    // Given
    const { request } = setup();
    let first = Promise.resolve(true);
    act(() => { first = request(OPTIONS); });
    // When: 확인 전 다른 요청이 들어옴
    let latest = Promise.resolve(false);
    act(() => { latest = request({ ...OPTIONS, title: "차량을 삭제할까요?", confirmLabel: "차량 삭제" }); });
    // Then
    await expect(first).resolves.toBe(false);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "차량 삭제" })); });
    await expect(latest).resolves.toBe(true);
  });

  it("화면이 사라지면 대기 중인 호출을 false로 완료한다", async () => {
    // Given
    const { request, view } = setup();
    let pending = Promise.resolve(true);
    act(() => { pending = request(OPTIONS); });
    // When
    view.unmount();
    // Then
    await expect(pending).resolves.toBe(false);
  });

  it("사라진 화면의 오래된 요청 함수는 즉시 false를 반환한다", async () => {
    // Given
    const { request, view } = setup();
    view.unmount();
    // When
    const pending = request(OPTIONS);
    // Then
    await expect(pending).resolves.toBe(false);
  });
});
