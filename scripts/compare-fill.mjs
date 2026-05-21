// 채움 전략 비교 (실험·비프로덕션): 현재 "순차 채움(next-fit)" vs "FFD(캠퍼스 통째 우선)".
// 같은 더미·같은 호차로 상행 채움 품질을 비교 — 분할 수 vs 빈좌석 trade-off 측정.
// 실행: npx tsx scripts/compare-fill.mjs
import { runBatch } from "../lib/batch/engine.ts";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const W = [
  ["전남대", 18], ["조선대", 14], ["호남대", 8], ["광주대", 7], ["동신대", 6],
  ["송원대", 5], ["남부대", 5], ["광주보건대", 4], ["서영대", 4], ["광주여대", 4],
  ["동강대", 3], ["광주교대", 3], ["조선간호대", 3], ["기독간호대", 3], ["아가페", 2],
  ["간사", 2], ["타지구", 6],
];
const TW = W.reduce((s, [, w]) => s + w, 0);
function makePax(n, seed) {
  const rand = rng(seed);
  const pick = () => { let r = rand() * TW; for (const [c, w] of W) if ((r -= w) < 0) return c; return "타지구"; };
  const pax = [];
  for (let i = 0; i < n; i++) {
    const campus = pick(); const roll = rand();
    let at, day, ret;
    if (roll < 0.82) { at = "roundtrip"; day = rand() < 0.78 ? "TUE" : "WED"; ret = true; }
    else if (roll < 0.94) { at = "oneway"; day = rand() < 0.78 ? "TUE" : "WED"; ret = false; }
    else { at = "oneway"; day = null; ret = true; }
    pax.push({ id: `p${i}`, name: `${campus}-${i}`, campus, attendance_type: at, departure_day: day, uses_return_bus: ret, fixed_up_bus_id: null });
  }
  return pax;
}
const mkBuses = () => {
  const b = [];
  for (let i = 1; i <= 7; i++) b.push({ id: i, capacity: 44, hard_cap: 45, departure_day: "TUE" });
  for (let i = 8; i <= 9; i++) b.push({ id: i, capacity: 44, hard_cap: 45, departure_day: "WED" });
  return b;
};

// ── 캠퍼스 그룹 (큰 순) ──
function campusesDesc(group) {
  const m = new Map();
  for (const p of group) (m.get(p.campus) ?? m.set(p.campus, []).get(p.campus)).push(p);
  return [...m.values()].sort((a, b) => b.length - a.length);
}

// ── FFD: 캠퍼스를 통째로 들어가는 첫 호차(잔여 최소=best-fit)에. 없으면 잔여 큰 순 분할 ──
function ffdFill(group, buses) {
  const work = buses.map((b) => ({ ...b, count: 0 }));
  const assign = {};
  const errors = [];
  for (const members of campusesDesc(group)) {
    let q = members;
    // 1) 통째로 들어가는 호차 중 잔여 최소(best-fit) — 분할·빈자리 동시 최소화
    const fit = work
      .filter((b) => b.capacity - b.count >= q.length)
      .sort((a, b) => (a.capacity - a.count) - (b.capacity - b.count))[0];
    if (fit) { for (const m of q) { assign[m.id] = fit.id; fit.count++; } continue; }
    // 2) 통째로 안 들어감 → 잔여 큰 호차부터 분할(조각 최소)
    while (q.length > 0) {
      const b = work.filter((x) => x.count < x.capacity).sort((a, b2) => (b2.capacity - b2.count) - (a.capacity - a.count))[0];
      if (!b) break;
      let take = Math.min(b.capacity - b.count, q.length);
      if (q.length - take === 1 && take > 1) take--; // 1명 조각 방지
      for (const m of q.slice(0, take)) { assign[m.id] = b.id; b.count++; }
      q = q.slice(take);
    }
    // 3) 보조석
    for (const m of q) {
      const b = work.filter((x) => x.count < x.hard_cap).sort((a, b2) => (b2.hard_cap - b2.count) - (a.hard_cap - a.count))[0];
      if (!b) { errors.push(`미배정`); continue; }
      assign[m.id] = b.id; b.count++;
    }
  }
  return { assign, errors };
}

function metrics(label, pax, upAssign) {
  const intra = {};
  for (const p of pax) {
    const b = upAssign[p.id];
    if (b == null || p.departure_day == null) continue;
    (intra[`${p.campus}/${p.departure_day}`] ??= new Set()).add(b);
  }
  const splits = Object.values(intra).filter((s) => s.size > 1).length;
  const splitDetail = Object.entries(intra).filter(([, s]) => s.size > 1).map(([k, s]) => `${k}:${s.size}`);
  const byBus = {};
  for (const v of Object.values(upAssign)) byBus[v] = (byBus[v] ?? 0) + 1;
  const used = Object.keys(byBus).length;
  const assigned = Object.keys(upAssign).length;
  const eligible = pax.filter((p) => p.departure_day != null).length;
  // 빈좌석 = 사용 호차의 정원44 기준 빈자리 합
  let empty = 0;
  for (const id of Object.keys(byBus)) empty += Math.max(0, 44 - byBus[id]);
  return { label, splits, splitDetail, used, assigned, unassigned: eligible - assigned, empty };
}

console.log("════ 채움 전략 비교 (상행, 9대: 화7 수2) ════\n");
for (const n of [300, 360, 396]) {
  const pax = makePax(n, 99);
  // 현재(순차) — runBatch 사용
  const cur = runBatch(pax, mkBuses().map((b) => ({ ...b, name: `${b.id}`, driver_registration_id: null, fixed_passenger_ids: [] })));
  const curM = metrics("순차(현재)", pax, cur.up_assignments);
  // FFD — 요일별로
  const ffdAssign = {};
  const buses = mkBuses();
  for (const day of ["TUE", "WED"]) {
    const grp = pax.filter((p) => p.departure_day === day);
    const dayBuses = buses.filter((b) => b.departure_day === day);
    const r = ffdFill(grp, dayBuses);
    Object.assign(ffdAssign, r.assign);
  }
  const ffdM = metrics("FFD", pax, ffdAssign);
  console.log(`■ ${n}명`);
  for (const m of [curM, ffdM]) {
    console.log(`  ${m.label.padEnd(10)} 분할 ${m.splits}  빈좌석 ${m.empty}  사용호차 ${m.used}  미배정 ${m.unassigned}`);
    if (m.splitDetail.length) console.log(`             분할상세: ${m.splitDetail.join("  ")}`);
  }
  console.log();
}
