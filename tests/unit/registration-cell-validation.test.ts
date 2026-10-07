import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateCells } from "@/lib/registrations/mutations";

const { from, update, single, client } = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), single: vi.fn(), client: vi.fn() }));
const query = {
  select() { return query; },
  eq() { return query; },
  update(patch: unknown) { update(patch); return query; },
  maybeSingle: single,
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => { client(); return { from: (table: string) => { from(table); return query; } }; } }));

beforeEach(() => {
  vi.clearAllMocks(); single.mockReset();
  single.mockResolvedValueOnce({ data: { id: "own", name: "원래 이름", note: null, version: 1 }, error: null });
  single.mockResolvedValueOnce({ data: { id: "own", name: "", note: "메모", version: 2 }, error: null });
});

describe("공통 셀 저장의 필수 이름", () => {
  it.each(["", "  \t\n", "　"])("빈 이름 %j는 조회나 DB 쓰기 전에 차단한다", async (name) => {
    expect(await updateCells("own", { name: "원래 이름" }, { name })).toEqual({ ok: false, message: "이름은 필수입니다" });
    expect(client).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("이름이 없는 비고 수정은 기존 필드 기대값 비교와 DB 저장을 유지한다", async () => {
    const result = await updateCells("own", { note: null }, { note: "메모" });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledExactlyOnceWith({ note: "메모" });
  });
});
