import { describe, it, expect } from "vitest";
import { runBatch } from "@/lib/batch/engine";
import type { Bus, Passenger } from "@/lib/batch/types";

const bus = (id: number, up: number | null, down: number | null, cap = 10): Bus => ({
  id, name: `${id}호차`, capacity: cap, hard_cap: cap + 1,
  driver_registration_id: null, fixed_passenger_ids: [],
  down_driver_registration_id: null, down_fixed_passenger_ids: [],
  up_trip_id: up, down_trip_id: down,
  is_cohesion_exempt: false, fill_priority: 0,
} as unknown as Bus);

const p = (i: number, up: number | null, down: number | null, campus = "C1"): Passenger => ({
  id: `r${i}`, name: `p${i}`, campus, up_trip_id: up, down_trip_id: down,
} as unknown as Passenger);

describe("범용성", () => {
  it("② 상행 5편 · 하행 2편", () => {
    const buses = [bus(1,1,4), bus(2,2,4), bus(3,3,5), bus(4,4,5), bus(5,5,null)];
    const ps = [
      ...Array.from({length:5},(_,i)=>p(i,1,4)),
      ...Array.from({length:5},(_,i)=>p(100+i,5,5)),
    ];
    const r = runBatch(ps, buses, "both");
    console.log("② errors:", JSON.stringify(r.errors, null, 1));
  });

  it("⑤ 편별 정원 초과 — A편 넘침, B편 자리 남음", () => {
    // 하행 편 4: 버스 1대(10석), 승객 25명 → 15명 미배정
    // 하행 편 5: 버스 2대(20석), 승객 2명 → 18석 남음
    const buses = [bus(1,null,4), bus(2,null,5), bus(3,null,5)];
    const ps = [
      ...Array.from({length:25},(_,i)=>p(i,null,4)),
      ...Array.from({length:2},(_,i)=>p(200+i,null,5)),
    ];
    const r = runBatch(ps, buses, "down");
    console.log("⑤ errors:", JSON.stringify(r.errors, null, 1));
    console.log("⑤ by_bus:", JSON.stringify(r.by_bus), "empty_seats:", r.empty_seats, "total_assigned:", r.total_assigned);
  });

  it("③ 하행만 있는 행사", () => {
    const buses = [bus(1,null,4), bus(2,null,4)];
    const ps = Array.from({length:15},(_,i)=>p(i,null,4));
    const r = runBatch(ps, buses, "both");
    console.log("③ errors:", JSON.stringify(r.errors), "by_bus:", JSON.stringify(r.by_bus), "empty:", r.empty_seats, "assigned:", r.total_assigned);
  });
});
