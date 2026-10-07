// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RolesPanel } from "@/components/admin/roles-panel";
import { updateRoleLabel, type RoleLabelRow } from "@/lib/admin/role-labels";
vi.mock("@/lib/admin/role-labels", () => ({
  createRoleLabel: vi.fn(), updateRoleLabel: vi.fn(), deleteRoleLabel: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("기존 사용자 색을 다른 색으로 표시하거나 자동 변경하지 않고 새 선택은 저장한다", async () => {
  const row = { id: "role-1", label: "미디어", color: "#db2777", display_order: 10, created_at: "2026-01-01", updated_at: "2026-01-01" } satisfies RoleLabelRow;
  render(<RolesPanel initial={[row]} />);
  const select = screen.getByRole<HTMLSelectElement>("combobox", { name: "미디어 역할 색" });
  expect(select.value).toBe("#db2777");
  expect(select.selectedOptions[0].textContent).toBe("현재 색 유지");
  expect(updateRoleLabel).not.toHaveBeenCalled();
  vi.mocked(updateRoleLabel).mockResolvedValueOnce({ ok: true, row: { ...row, color: "blue" } });
  await act(async () => { fireEvent.change(select, { target: { value: "blue" } }); });
  expect(updateRoleLabel).toHaveBeenCalledWith("role-1", { color: "blue" });
  expect(select.selectedOptions[0].textContent).toBe("파랑");
});
