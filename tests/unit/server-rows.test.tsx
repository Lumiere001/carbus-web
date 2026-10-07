// @vitest-environment happy-dom
import { act, renderHook, cleanup } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useServerRows } from "@/components/registrations/use-server-rows";

describe("서버 새로고침과 명단 상태", () => {
  beforeEach(cleanup);
  it("Realtime 없이도 저장 후 서버 props에 온 참여기간을 반영한다", () => {
    const original = [{ id: "own", from: null as string | null }];
    const { result, rerender } = renderHook(({ rows }) => useServerRows(rows), { initialProps: { rows: original } });
    rerender({ rows: [{ id: "own", from: "2026-08-14" }] });
    expect(result.current[0]).toEqual([{ id: "own", from: "2026-08-14" }]);
  });
  it("같은 서버 props로 다시 그릴 때는 로컬 셀 업데이트를 유지한다", () => {
    const original = [{ id: "own", name: "기존" }];
    const { result, rerender } = renderHook(({ rows }) => useServerRows(rows), { initialProps: { rows: original } });
    act(() => result.current[1]((rows) => rows.map((row) => ({ ...row, name: "로컬 저장" }))));
    rerender({ rows: original });
    expect(result.current[0][0]?.name).toBe("로컬 저장");
  });
  it("빈 행사 명단이 오면 이전 행사 행을 남기지 않는다", () => {
    const { result, rerender } = renderHook(({ rows }) => useServerRows(rows), { initialProps: { rows: [{ id: "past-event" }] } });
    rerender({ rows: [] });
    expect(result.current[0]).toEqual([]);
  });
});
