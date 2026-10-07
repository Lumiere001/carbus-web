// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Papa from "papaparse";
import userEvent from "@testing-library/user-event";
import { ImportPanel } from "@/components/campus/import-panel";
import { parseRegistrationsCsv } from "@/lib/csv/parse";
import type { ImportTrip } from "@/components/campus/import/template";

vi.mock("@/lib/registrations/mutations", () => ({ insertRegistration: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const CAMPUS_ID = "00000000-0000-4000-8000-000000000001";
const TRIPS = [
  { id: 1, key: "up_1", label: "오전 출발", direction: "up", active: true },
  { id: 2, key: "down_1", label: "귀가편", direction: "down", active: true },
] as const;
const HEADERS = [
  "이름", "학번", "상행 출발", "하행 출발", "비고",
  "참여 시작일", "참여 종료일", "참여 시작 일시", "참여 종료 일시",
  "상행 이동수단", "하행 이동수단", "상행 타지구", "하행 타지구",
  "상행 이동상태", "하행 이동상태",
] as const;

function prepareDownload(trips: readonly ImportTrip[]) {
  const file = Promise.withResolvers<Blob>();
  vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
    if (value instanceof Blob) file.resolve(value);
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ImportPanel campusId={CAMPUS_ID} trips={trips} />);
  return file.promise;
}

describe("실제 템플릿 다운로드 내용", () => {
  it.each(['목요일, "밤"\n출발', '=HYPERLINK("test")'])("편 라벨 %s를 안전한 단일 CSV 필드로 저장한다", async (label) => {
    // Given
    const file = prepareDownload([{ ...TRIPS[0], label }, TRIPS[1]]);
    // When
    fireEvent.click(screen.getByRole("button", { name: "템플릿 다운로드" }));
    // Then
    const rows = Papa.parse<string[]>(await (await file).text()).data;
    expect(rows[0]).toEqual([...HEADERS]);
    expect(rows.every((row) => row.length === 15)).toBe(true);
    expect(rows[1]?.[2]).toBe(label.startsWith("=") ? "'" + label : label);
  });

  it("전체 참석 왕복 예시 하나가 실제 검증을 통과하며 일시를 만들어 넣지 않는다", async () => {
    // Given
    const file = prepareDownload(TRIPS);
    // When
    fireEvent.click(screen.getByRole("button", { name: "템플릿 다운로드" }));
    // Then
    const csv = await (await file).text();
    const parsed = parseRegistrationsCsv(csv, CAMPUS_ID, [...TRIPS]);
    expect(parsed.failures).toEqual([]);
    expect(parsed.successes).toHaveLength(1);
    expect(parsed.successes[0]).toMatchObject({
      up_trip_id: 1, down_trip_id: 2,
      attend_from: null, attend_to: null, attend_from_at: null, attend_to_at: null,
      legs: [
        { direction: "up", mode: "our_bus", via_unit_id: null, status: "confirmed" },
        { direction: "down", mode: "our_bus", via_unit_id: null, status: "confirmed" },
      ],
    });
  });

  it("왕복 운행편이 없으면 미완성 예시 사람을 넣지 않고 입력 틀을 제공한다", async () => {
    // Given
    const file = prepareDownload([TRIPS[0]]);
    // When
    fireEvent.click(screen.getByRole("button", { name: "템플릿 다운로드" }));
    // Then
    expect(Papa.parse<string[]>(await (await file).text()).data).toEqual([[...HEADERS]]);
  });
});

describe("CSV 일정과 이동수단 미리보기", () => {
  it("부분 참석의 정확한 KST 일시와 양방향 이동수단·지구·상태를 함께 보여준다", async () => {
    // Given
    const user = userEvent.setup();
    const unit = { id: "00000000-0000-4000-8000-000000000002", name: "부산지구" };
    const csv = Papa.unparse([
      [...HEADERS],
      ["합성 참석자", "26", "", "", "전체 참고 메모",
        "2026-08-04", "2026-08-05", "2026-08-04T15:30", "2026-08-05T18:40",
        "타지구 차량", "자차·가족차", "부산지구", "", "대기", "확정"],
    ]);
    const view = render(<ImportPanel campusId={CAMPUS_ID} trips={TRIPS} units={[unit]} />);
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("CSV file input missing");
    // When
    await user.upload(input, new File([csv], "confirmed-plan.csv", { type: "text/csv" }));
    // Then
    const row = screen.getByText("합성 참석자").closest("tr");
    if (!row) throw new Error("Preview row missing");
    const cells = within(row);
    expect(cells.getByText("부분 참석 2026-08-04 ~ 2026-08-05")).toBeDefined();
    expect(cells.getByText("2026-08-04 15:30")).toBeDefined();
    expect(cells.getByText("2026-08-05 18:40")).toBeDefined();
    expect(cells.getByText("타지구 차량")).toBeDefined();
    expect(cells.getByText("부산지구")).toBeDefined();
    expect(cells.getByText("대기")).toBeDefined();
    expect(cells.getByText("자차·가족차")).toBeDefined();
    expect(cells.getByText("확정")).toBeDefined();
    expect(cells.getByText("전체 참고 메모")).toBeDefined();
    expect(screen.getByRole("button", { name: "1명 등록" })).toBeDefined();
  });
});
