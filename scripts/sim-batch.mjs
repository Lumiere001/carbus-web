// 배차 엔진 더미 300 시뮬레이션 (진단용). 엔진 로직을 그대로 복제하지 않고
// 빌드된 출력 대신, ts를 직접 못 부르므로 here 에서는 engine 을 동적 import.
// 실행: node --experimental-strip-types scripts/sim-batch.mjs  (Node 22+)
import { runBatch } from "../lib/batch/engine.ts";

const CAMPUSES = [
  ["전남대", 55], ["조선대", 40], ["호남대", 22], ["광주교대", 8],
  ["광주대", 18], ["광주여대", 12], ["서영대", 9], ["송원대", 14],
  ["광주보건대", 11], ["동신대", 16], ["남부대", 13], ["동강대", 10],
  ["아가페", 6], ["기독간호대", 7], ["조선간호대", 9], ["간사", 5], ["타지구", 18],
];

let id = 0;
const passengers = [];
for (const [campus, n] of CAMPUSES) {
  for (let i = 0; i < n; i++) {
    const roll = Math.random();
    let attendance_type, departure_day, uses_return_bus;
    if (roll < 0.78) {
      // 왕복
      attendance_type = "roundtrip";
      departure_day = Math.random() < 0.8 ? "TUE" : "WED";
      uses_return_bus = true;
    } else if (roll < 0.92) {
      // 편도 상행
      attendance_type = "oneway";
      departure_day = Math.random() < 0.8 ? "TUE" : "WED";
      uses_return_bus = false;
    } else {
      // 편도 하행
      attendance_type = "oneway";
      departure_day = null;
      uses_return_bus = true;
    }
    passengers.push({
      id: `p${++id}`, name: `${campus}${i}`, campus,
      attendance_type, departure_day, uses_return_bus, fixed_up_bus_id: null,
    });
  }
}

const buses = [];
for (let i = 1; i <= 7; i++) buses.push({ id: i, name: `${i}호차`, capacity: 44, hard_cap: 45, departure_day: "TUE", driver_registration_id: null, fixed_passenger_ids: [] });
for (let i = 8; i <= 9; i++) buses.push({ id: i, name: `${i}호차`, capacity: 44, hard_cap: 45, departure_day: "WED", driver_registration_id: null, fixed_passenger_ids: [] });

const upTue = passengers.filter((p) => p.departure_day === "TUE").length;
const upWed = passengers.filter((p) => p.departure_day === "WED").length;
const down = passengers.filter((p) => p.uses_return_bus).length;
console.log(`총 ${passengers.length}명 | 상행 화 ${upTue} 수 ${upWed} | 하행 ${down}`);
console.log(`정원: 화 ${7 * 44}=308, 수 ${2 * 44}=88, 토(하행) ${9 * 44}=396`);

const r = runBatch(passengers, buses);
console.log(`\n총 상행배정 ${r.total_assigned} | 상행 빈좌석 ${r.empty_seats} | errors ${r.errors.length}`);
console.log("상행 by_bus:", JSON.stringify(r.by_bus));

// 하행 by_bus 집계
const downByBus = {};
for (const v of Object.values(r.down_assignments)) downByBus[v] = (downByBus[v] ?? 0) + 1;
console.log("하행 by_bus:", JSON.stringify(downByBus));

// 검증 1: 요일 분리 위반?
let dayViol = 0;
for (const p of passengers) {
  const b = r.up_assignments[p.id];
  if (b == null) continue;
  const bus = buses.find((x) => x.id === b);
  if (bus.departure_day !== p.departure_day) dayViol++;
}
console.log("요일 분리 위반(상행):", dayViol);

// 검증 2: 캠퍼스 분할 수 (상행)
const campusBusesUp = {};
for (const p of passengers) {
  const b = r.up_assignments[p.id];
  if (b == null) continue;
  (campusBusesUp[p.campus] ??= new Set()).add(b);
}
console.log("캠퍼스별 상행 분할 호차수:", Object.fromEntries(Object.entries(campusBusesUp).map(([k, v]) => [k, v.size])));

// 검증 3: 정원 초과?
const over = Object.entries(r.by_bus).filter(([, n]) => n > 45);
console.log("hard_cap(45) 초과 호차:", over.length ? JSON.stringify(over) : "없음");

if (r.errors.length) console.log("\nerrors 샘플:", r.errors.slice(0, 5));

// 검증 4: 같은 요일 내 캠퍼스 분할 (진짜 fragmentation 지표)
const intraDay = {};
for (const p of passengers) {
  const b = r.up_assignments[p.id];
  if (b == null || p.departure_day == null) continue;
  const key = `${p.campus}/${p.departure_day}`;
  (intraDay[key] ??= new Set()).add(b);
}
const split = Object.entries(intraDay).filter(([, s]) => s.size > 1);
console.log("\n같은 요일 내 분할된 (캠퍼스/요일) 수:", split.length, "/", Object.keys(intraDay).length);
console.log("분할된 것:", JSON.stringify(Object.fromEntries(split.map(([k, s]) => [k, s.size]))));

// 검증 5: 정원 초과 점검 (>44, >45)
const over44 = Object.entries(r.by_bus).filter(([,n])=>n>44);
const down44 = Object.entries(downByBus).filter(([,n])=>n>44);
console.log("\n[정원초과] 상행 >44:", JSON.stringify(over44), "| 하행 >44:", JSON.stringify(down44));
console.log("[미배정] errors:", r.errors.length, r.errors.slice(0,3));
