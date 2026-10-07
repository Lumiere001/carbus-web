import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { registrationCsv, type ExportRegistration } from "@/lib/csv/export";

const ROW: ExportRegistration = {
  name: "김순장",
  student_id: "26",
  participation_status: "registered",
  up_trip_id: 1,
  down_trip_id: 2,
  fee: 50000,
  payment_status: "paid",
  assigned_up_bus_id: 1,
  assigned_down_bus_id: 2,
  note: null,
};
const TRIPS = [{ id: 1, label: "화 오전" }, { id: 2, label: "금 오후" }];
const BUSES = [{ id: 1, name: "1호차" }, { id: 2, name: "2호차" }];

describe("registrationCsv", () => {
  it("exports only the supplied visible rows in their order with Korean labels and a UTF-8 BOM", () => {
    // Given
    const rows = [{ ...ROW, name: "이먼저", participation_status: "cancelled" as const }, ROW];
    // When
    const csv = registrationCsv({ rows, trips: TRIPS, buses: BUSES });
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    // Then
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.map((r) => r.이름)).toEqual(["이먼저", "김순장"]);
    expect(parsed.data[0]["참여 상태"]).toBe("취소");
    expect(parsed.data[1]).toMatchObject({
      "상행 출발": "화 오전", "하행 출발": "금 오후", 차량비: "50000", 납부: "완납",
      "상행 배차": "1호차", "하행 배차": "2호차",
    });
  });

  it("round-trips commas, quotes, line breaks, Korean, and blank values without adding rows", () => {
    // Given
    const row = { ...ROW, name: '김, "순장"', note: '첫 줄\n둘째 줄, "만남"' };
    // When
    const csv = registrationCsv({ rows: [row], trips: TRIPS, buses: BUSES });
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    // Then
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]).toMatchObject({ 이름: row.name, 비고: row.note });
  });

  it.each(["=1+1", "+SUM(1,2)", "-1+2", "@SUM(1,2)", "\t=1+1", "\r=1+1", "\n=1+1", "  =1+1", " \uFEFF+1"])(
    "stores a formula-like value %j as literal text in every text field",
    (value) => {
      // Given
      const row = { ...ROW, name: value, student_id: value, note: value };
      const trips = [{ id: 1, label: value }, { id: 2, label: value }];
      const buses = [{ id: 1, name: value }, { id: 2, name: value }];
      // When
      const csv = registrationCsv({ rows: [row], trips, buses });
      const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
      // Then
      for (const column of ["이름", "학번", "상행 출발", "하행 출발", "상행 배차", "하행 배차", "비고"]) {
        expect(parsed.data[0][column]).toBe(`'${value}`);
      }
    }
  );

  it("uses the same no-fee and refund labels as the grid", () => {
    // Given
    const rows = [{ ...ROW, fee: 0, note: "환불 예정" }, { ...ROW, fee: 0, note: null }];
    // When
    const csv = registrationCsv({ rows, trips: TRIPS, buses: BUSES });
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    // Then
    expect(parsed.data.map((r) => r.납부)).toEqual(["환불 대기", "해당없음"]);
  });

  it("keeps an empty export header-only without a phantom row", () => {
    // Given / When
    const csv = registrationCsv({ rows: [], trips: [], buses: [] });
    // Then
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(Papa.parse(csv, { header: true }).data).toEqual([]);
  });
});
