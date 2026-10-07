// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Papa from "papaparse";
import { ImportPanel } from "@/components/campus/import-panel";
vi.mock("@/lib/registrations/mutations", () => ({ insertRegistration: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("실제 템플릿 다운로드 내용", () => {
  it.each(['목요일, "밤"\n출발', '=HYPERLINK("test")'])("편 라벨 %s를 안전한 단일 CSV 필드로 저장한다", async (label) => {
    let blob!: Blob;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:test"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ImportPanel campusId="c1" trips={[{ id: 1, key: "up_1", label, direction: "up", active: true }]} />);
    fireEvent.click(screen.getByRole("button", { name: "템플릿 다운로드" }));
    const rows = Papa.parse<string[]>(await blob.text()).data;
    expect(rows.every(row => row.length === 5)).toBe(true);
    expect(rows[1][2]).toBe(label.startsWith("=") ? "'" + label : label);
  });
});
