// 배차 엔진 정원 근접 스트레스 테스트 (9대 고정: 화 7 + 수 2, 하행 9).
// 부하를 단계적으로 올려 미배정·빈좌석·정원초과·캠퍼스 분할을 관찰한다.
// 작년 숫자에 맞추지 않고, 9대 정원(상행 화308·수88 / 하행 396)에 근접·초과시킨다.
// 실행: npx tsx scripts/stress-batch.mjs
import { runBatch } from "../lib/batch/engine.ts";

// ── 재현 가능한 시드 RNG (mulberry32) ──
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 캠퍼스 비중(상대 가중치). 큰 캠퍼스 몇 개 + 중소 다수 + 타지구.
const CAMPUS_WEIGHTS = [
  ["전남대", 18], ["조선대", 14], ["호남대", 8], ["광주대", 7],
  ["동신대", 6], ["송원대", 5], ["남부대", 5], ["광주보건대", 4],
  ["서영대", 4], ["광주여대", 4], ["동강대", 3], ["광주교대", 3],
  ["조선간호대", 3], ["기독간호대", 3], ["아가페", 2], ["간사", 2], ["타지구", 6],
];
const TOTAL_W = CAMPUS_WEIGHTS.reduce((s, [, w]) => s + w, 0);

// 9대 고정 (화 7 + 수 2). 하행은 엔진이 같은 9대를 토요일로 재사용.
function makeBuses() {
  const b = [];
  for (let i = 1; i <= 7; i++) b.push(bus(i, 1));
  for (let i = 8; i <= 9; i++) b.push(bus(i, 2));
  return b;
}
const bus = (id, day) => ({
  id, name: `${id}호차`, capacity: 44, hard_cap: 45,
  departure_slot_id: day, driver_registration_id: null, fixed_passenger_ids: [],
});

// N명 생성. 요일 비율은 화 정원:수 정원 = 308:88 ≈ 0.78 로 맞춰 현실화.
// upRatio: 상행(요일 배정) 대상 비율, downRatio: 하행 이용 비율.
function makePassengers(n, seed, { tueShare = 0.78, oneWayUp = 0.12 } = {}) {
  const rand = rng(seed);
  const pick = () => {
    let r = rand() * TOTAL_W;
    for (const [c, w] of CAMPUS_WEIGHTS) { if ((r -= w) < 0) return c; }
    return "타지구";
  };
  const pax = [];
  for (let i = 0; i < n; i++) {
    const campus = pick();
    const roll = rand();
    let attendance_type, departure_slot_id, uses_return_bus;
    if (roll < 1 - oneWayUp - 0.06) {
      attendance_type = "roundtrip";
      departure_slot_id = rand() < tueShare ? 1 : 2;
      uses_return_bus = true;
    } else if (roll < 1 - 0.06) {
      attendance_type = "oneway"; // 상행 편도
      departure_slot_id = rand() < tueShare ? 1 : 2;
      uses_return_bus = false;
    } else {
      attendance_type = "oneway"; // 하행 편도
      departure_slot_id = null;
      uses_return_bus = true;
    }
    pax.push({ id: `p${i}`, name: `${campus}-${i}`, campus, attendance_type, departure_slot_id, uses_return_bus, fixed_up_bus_id: null });
  }
  return pax;
}

function analyze(label, pax, buses) {
  const r = runBatch(pax, buses);
  const upTue = pax.filter((p) => p.departure_slot_id === 1).length;
  const upWed = pax.filter((p) => p.departure_slot_id === 2).length;
  const down = pax.filter((p) => p.uses_return_bus).length;

  // 상행 by_bus / 하행 by_bus
  const upBy = r.by_bus;
  const downBy = {};
  for (const v of Object.values(r.down_assignments)) downBy[v] = (downBy[v] ?? 0) + 1;

  const upAssigned = Object.keys(r.up_assignments).length;
  const downAssigned = Object.keys(r.down_assignments).length;
  const upUnassigned = (upTue + upWed) - upAssigned;
  const downUnassigned = down - downAssigned;

  const maxUp = Math.max(0, ...Object.values(upBy));
  const maxDown = Math.max(0, ...Object.values(downBy));
  const over45Up = Object.entries(upBy).filter(([, n]) => n > 45);
  const over45Down = Object.entries(downBy).filter(([, n]) => n > 45);

  // 같은 요일 내 캠퍼스 분할
  const intra = {};
  for (const p of pax) {
    const b = r.up_assignments[p.id];
    if (b == null || p.departure_slot_id == null) continue;
    (intra[`${p.campus}/${p.departure_slot_id}`] ??= new Set()).add(b);
  }
  const splits = Object.entries(intra).filter(([, s]) => s.size > 1);

  console.log(`\n■ ${label}  (총 ${pax.length}명)`);
  console.log(`  상행 화 ${upTue}/308  수 ${upWed}/88   하행 ${down}/396`);
  console.log(`  배정: 상행 ${upAssigned} (미배정 ${upUnassigned}) | 하행 ${downAssigned} (미배정 ${downUnassigned})`);
  console.log(`  최대 탑승: 상행 ${maxUp} / 하행 ${maxDown}  (정원44·보조45)`);
  console.log(`  45초과: 상행 ${over45Up.length ? JSON.stringify(over45Up) : "0"} | 하행 ${over45Down.length ? JSON.stringify(over45Down) : "0"}`);
  console.log(`  상행 by_bus: ${JSON.stringify(upBy)}`);
  console.log(`  하행 by_bus: ${JSON.stringify(downBy)}`);
  console.log(`  같은요일 캠퍼스 분할: ${splits.length}/${Object.keys(intra).length}  ${splits.length ? JSON.stringify(Object.fromEntries(splits.map(([k, s]) => [k, s.size]))) : ""}`);
  if (r.errors.length) console.log(`  errors(${r.errors.length}): ${JSON.stringify(r.errors.slice(0, 4))}`);
  return { label, upUnassigned, downUnassigned, maxUp, maxDown, splits: splits.length, errors: r.errors.length };
}

console.log("════ 배차 정원 근접 스트레스 (9대: 화7 수2 / 하행9) ════");
console.log("정원 합계: 상행 화 308 + 수 88 = 396 | 하행 396 (보조석 hard_cap 45 → 화 315·수 90·하행 405)");

const buses = makeBuses();
const SCEN = [
  ["여유 (300)", 300],
  ["근접 (360)", 360],
  ["정원턱 (396)", 396],
  ["초과 (430)", 430],
  ["과부하 (470)", 470],
];
const summary = [];
for (const [label, n] of SCEN) summary.push(analyze(label, makePassengers(n, 42), buses));

console.log("\n════ 요약 ════");
console.log("시나리오        | 상미배정 | 하미배정 | 상최대 | 하최대 | 분할 | errors");
for (const s of summary)
  console.log(`${s.label.padEnd(14)} | ${String(s.upUnassigned).padStart(7)} | ${String(s.downUnassigned).padStart(7)} | ${String(s.maxUp).padStart(5)} | ${String(s.maxDown).padStart(5)} | ${String(s.splits).padStart(3)} | ${s.errors}`);
