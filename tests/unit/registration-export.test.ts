import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { registrationCsv, type ExportRegistration } from "@/lib/csv/export";
import { parseRegistrationsCsv } from "@/lib/csv/parse";

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
  it("확정 참여 일시는 한국 native 값으로 내보내고 방향별 이동수단을 남긴다", () => {
    // Given
    const row: ExportRegistration = { ...ROW, down_trip_id: null, down_mode: "own_car",
      attend_from: null, attend_to: null, attend_from_at: "2026-10-09T15:30:00Z", attend_to_at: "2026-10-12T10:40:00Z" };
    // When
    const parsed = Papa.parse<Record<string, string>>(registrationCsv({ rows: [row], trips: TRIPS, buses: BUSES }), { header: true });
    // Then
    expect(parsed.data[0]).toMatchObject({ "참여 시작일": "", "참여 종료일": "",
      "참여 시작 일시": "2026-10-10T00:30", "참여 종료 일시": "2026-10-12T19:40", "상행 이동수단": "우리 버스", "하행 이동수단": "자차·가족차" });
  });
  it("타지구 차량의 지구·확정 대기 상태와 빠진 버스 방향을 재가져올 수 있다", () => {
    // Given
    const district = "11111111-1111-4111-8111-111111111111";
    const row: ExportRegistration = { ...ROW, down_trip_id: null, up_mode: "other_district", down_mode: "own_car",
      up_via_unit_id: district, up_transport_status: "pending", down_transport_status: "confirmed",
      attend_from_at: "2026-10-09T15:30:00Z", attend_to_at: "2026-10-12T10:40:00Z" };
    const trips = TRIPS.map((trip) => ({ ...trip, key: String(trip.id), direction: trip.id === 1 ? "up" as const : "down" as const, active: true }));
    // When
    const parsed = parseRegistrationsCsv(registrationCsv({ rows: [row], trips: TRIPS, buses: BUSES }), district, trips);
    // Then
    expect(parsed.failures).toEqual([]);
    expect(parsed.successes[0]).toMatchObject({ up_trip_id: 1, down_trip_id: null, legs: [
      { direction: "up", mode: "other_district", via_unit_id: district, status: "pending" },
      { direction: "down", mode: "own_car", via_unit_id: null, status: "confirmed" },
    ] });
  });
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
