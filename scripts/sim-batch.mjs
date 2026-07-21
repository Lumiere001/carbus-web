// 배차 엔진 더미 시뮬레이션 (진단용). 출발 슬롯 모델(v1.1.1).
// 실행: npx tsx scripts/sim-batch.mjs
import { runBatch } from "../lib/batch/engine.ts";

// 슬롯 id: 1 = 화 오전 9시(tue_am), 2 = 화 오후 7시(tue_pm). 운영 = 8대 am + 1대 pm.
const AM = 1;
const PM = 2;
const DOWN = 90; // 하행 편 (buses.down_trip_id)
const SLOT_LABEL = { [AM]: "화오전", [PM]: "화오후" };

const CAMPUSES = [
  ["전남대", 55], ["조선대", 40], ["호남대", 22], ["광주교대", 8],
  ["광주대", 18], ["광주여대", 12], ["서영대", 9], ["송원대", 14],
  ["광주보건대", 11], ["동신대", 16], ["남부대", 13], ["동강대", 10],
  ["아가페", 6], ["기독간호대", 7], ["조선간호대", 9], ["간사", 5], ["타지구", 18],
];

// 화 오후(PM)는 1대(44석)뿐이라 소수만. 대부분 화 오전(AM).
const pickSlot = () => (Math.random() < 0.88 ? AM : PM);

let id = 0;
const passengers = [];
for (const [campus, n] of CAMPUSES) {
  for (let i = 0; i < n; i++) {
    const roll = Math.random();
    let attendance_type, departure_slot_id, uses_return_bus;
    if (roll < 0.78) {
      attendance_type = "roundtrip";
      departure_slot_id = pickSlot();
      uses_return_bus = true;
    } else if (roll < 0.92) {
      attendance_type = "oneway";
      departure_slot_id = pickSlot();
      uses_return_bus = false;
    } else {
      attendance_type = "oneway";
      departure_slot_id = null;
      uses_return_bus = true;
    }
    passengers.push({
      id: `p${++id}`, name: `${campus}${i}`, campus,
      attendance_type, departure_slot_id, uses_return_bus, fixed_up_bus_id: null,
    });
  }
}

const buses = [];
// 배차 특례 플래그(마이그레이션 20260721050000)의 backfill 규칙과 동일 — 1호차만 짐차.
// 빠뜨리면 엔진이 던진다. 예전엔 NaN 폴백으로 특례가 조용히 사라졌다.
const flags = (i) => ({ is_cohesion_exempt: i === 1, fill_priority: i === 1 ? 1 : 0 });
for (let i = 1; i <= 8; i++) buses.push({ id: i, name: `${i}호차`, capacity: 44, hard_cap: 45, up_trip_id: AM, down_trip_id: DOWN, driver_registration_id: null, fixed_passenger_ids: [], down_driver_registration_id: null, down_fixed_passenger_ids: [], ...flags(i) });
buses.push({ id: 9, name: "9호차", capacity: 44, hard_cap: 45, up_trip_id: PM, down_trip_id: DOWN, driver_registration_id: null, fixed_passenger_ids: [], down_driver_registration_id: null, down_fixed_passenger_ids: [], ...flags(9) });

const upAm = passengers.filter((p) => p.departure_slot_id === AM).length;
const upPm = passengers.filter((p) => p.departure_slot_id === PM).length;
const down = passengers.filter((p) => p.uses_return_bus).length;
console.log(`총 ${passengers.length}명 | 상행 오전 ${upAm} 오후 ${upPm} | 하행 ${down}`);
console.log(`정원: 오전 ${8 * 44}=352, 오후 ${1 * 44}=44, 하행 ${9 * 44}=396`);

const r = runBatch(passengers, buses);
console.log(`\n총 상행배정 ${r.total_assigned} | 상행 빈좌석 ${r.empty_seats} | errors ${r.errors.length}`);
console.log("상행 by_bus:", JSON.stringify(r.by_bus));

const downByBus = {};
for (const v of Object.values(r.down_assignments)) downByBus[v] = (downByBus[v] ?? 0) + 1;
console.log("하행 by_bus:", JSON.stringify(downByBus));

// 검증 1: 슬롯 분리 위반?
let slotViol = 0;
for (const p of passengers) {
  const b = r.up_assignments[p.id];
  if (b == null) continue;
  const bus = buses.find((x) => x.id === b);
  if (bus.departure_slot_id !== p.departure_slot_id) slotViol++;
}
console.log("슬롯 분리 위반(상행):", slotViol);

// 검증 4: 같은 슬롯 내 캠퍼스 분할 (진짜 fragmentation 지표)
const intraSlot = {};
for (const p of passengers) {
  const b = r.up_assignments[p.id];
  if (b == null || p.departure_slot_id == null) continue;
  const key = `${p.campus}/${SLOT_LABEL[p.departure_slot_id]}`;
  (intraSlot[key] ??= new Set()).add(b);
}
const split = Object.entries(intraSlot).filter(([, s]) => s.size > 1);
console.log("\n같은 슬롯 내 분할된 (캠퍼스/슬롯) 수:", split.length, "/", Object.keys(intraSlot).length);
console.log("분할된 것:", JSON.stringify(Object.fromEntries(split.map(([k, s]) => [k, s.size]))));

// 검증 5: 정원 초과 점검 (>44, >45)
const over44 = Object.entries(r.by_bus).filter(([, n]) => n > 44);
const down44 = Object.entries(downByBus).filter(([, n]) => n > 44);
const over45 = Object.entries(r.by_bus).filter(([, n]) => n > 45);
console.log("\n[정원초과] 상행 >44:", JSON.stringify(over44), "| 하행 >44:", JSON.stringify(down44));
console.log("[hard_cap초과] 상행 >45:", over45.length ? JSON.stringify(over45) : "없음");
console.log("[미배정] errors:", r.errors.length, r.errors.slice(0, 3));
