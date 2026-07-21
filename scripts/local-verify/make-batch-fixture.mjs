/**
 * 배차 골든 스냅샷용 fixture 생성 (로컬 DB → 익명화 JSON).
 *
 * 왜 필요한가:
 *   Phase 3 는 배차 엔진의 "1호차" 문자열 특례를 플래그 컬럼으로 승격한다.
 *   이건 배차 *결과* 를 바꿀 수 있는 변경이라, 손대기 전에 현재 운영 데이터(599건)로
 *   나오는 결과를 고정해 둬야 "의도한 변경만 일어났다"를 증명할 수 있다.
 *   합성 데이터로는 부족하다 — 캠퍼스 크기 분포·고정배정 조합이 실제와 다르면
 *   best-fit / 분할 / 1명조각 방지 분기가 같은 경로를 타지 않는다.
 *
 * 왜 익명화해도 결과가 같은가:
 *   엔진(lib/batch/engine.ts)은 id·name·campus 를 **식별자로만** 쓴다.
 *   비교는 전부 동등성(===)이고, 순서는 배열 순서와 캠퍼스 그룹 크기로만 정해진다
 *   (groupByCampus 는 Map 삽입 순서, campusesBySizeDesc 는 크기 기준 안정 정렬).
 *   따라서 1:1 치환 + 행 순서 보존이면 배차 결과는 완전히 동일하다.
 *   name 은 errors 문자열에만 등장하므로 가명을 그대로 쓴다.
 *
 * 결정성:
 *   행 순서를 id 오름차순으로 고정한다. 운영 코드(batch/actions.ts)는 order 절이
 *   없어 PostgREST 기본 순서에 의존하지만, 스냅샷은 재현 가능해야 하므로 여기서 고정한다.
 *
 * 사용법: node scripts/local-verify/make-batch-fixture.mjs
 * 출력:   tests/fixtures/batch-prod-shape.json  (PII 없음 — 커밋 가능)
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const CONTAINER = "supabase_db_carbus-web";
const REPO = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(REPO, "tests/fixtures/batch-prod-shape.json");

const q = (sql) =>
  execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  ).trim();

const rows = (sql) => (q(sql) ? JSON.parse(q(sql)) : []);

// 운영 코드와 같은 필터:
//   · 취소자는 배차 대상이 아니다.
//   · **활성 행사만** — 앱은 RLS 로 활성 행사만 본다. 이 필터가 없으면 로컬에
//     행사가 둘 이상일 때(예: test-event-switch.sh 실행 후) 지난 행사 데이터까지
//     빨아들여 픽스처가 조용히 오염된다. 실제로 그 상태가 됐었다(22대/600명).
const regs = rows(`
  select coalesce(json_agg(t order by t.id), '[]'::json)::text from (
    select id::text, campus_id::text, attendance_type,
           departure_slot_id, uses_return_bus
      from registrations
     where participation_status is distinct from 'cancelled'
       and event_id = public.active_event_id()
     order by id
  ) t`);

const buses = rows(`
  select coalesce(json_agg(t order by t.id), '[]'::json)::text from (
    select id, name, capacity, hard_cap, departure_slot_id,
           driver_registration_id::text,
           coalesce(fixed_passenger_ids, '{}')::text[] as fixed_passenger_ids,
           down_driver_registration_id::text,
           coalesce(down_fixed_passenger_ids, '{}')::text[] as down_fixed_passenger_ids,
           is_cohesion_exempt, fill_priority
      from buses
     where event_id = public.active_event_id()
     order by id
  ) t`);

// ── 1:1 가명 매핑 (등장 순서대로 부여 = 결정적) ─────────────────
const regAlias = new Map();
const campusAlias = new Map();
const aliasReg = (id) => {
  if (id === null || id === undefined) return null;
  if (!regAlias.has(id)) regAlias.set(id, `r${String(regAlias.size + 1).padStart(4, "0")}`);
  return regAlias.get(id);
};
const aliasCampus = (id) => {
  if (id === null || id === undefined) return null;
  if (!campusAlias.has(id)) campusAlias.set(id, `C${String(campusAlias.size + 1).padStart(2, "0")}`);
  return campusAlias.get(id);
};

const passengers = regs.map((r) => {
  const id = aliasReg(r.id);
  return {
    id,
    name: id, // 이름은 errors 메시지에만 쓰인다 — 가명으로 충분
    campus: aliasCampus(r.campus_id),
    attendance_type: r.attendance_type,
    departure_slot_id: r.departure_slot_id,
    uses_return_bus: r.uses_return_bus,
    fixed_up_bus_id: null, // 운영 코드가 항상 null 로 투영한다
  };
});

// 호차의 driver/fixed 는 registrations id 참조 → 같은 매핑을 통과시킨다.
// 취소자라 승객 목록에 없는 id 도 그대로 가명화한다(엔진이 "없는 id" 로 처리하는 경로도 보존).
const busFixture = buses.map((b) => ({
  id: b.id,
  name: b.name,
  capacity: b.capacity,
  hard_cap: b.hard_cap,
  departure_slot_id: b.departure_slot_id,
  driver_registration_id: aliasReg(b.driver_registration_id),
  fixed_passenger_ids: (b.fixed_passenger_ids ?? []).map(aliasReg).filter(Boolean),
  down_driver_registration_id: aliasReg(b.down_driver_registration_id),
  down_fixed_passenger_ids: (b.down_fixed_passenger_ids ?? []).map(aliasReg).filter(Boolean),
  is_cohesion_exempt: b.is_cohesion_exempt,
  fill_priority: b.fill_priority,
}));

// ── 가드: 특례가 꺼진 상태를 정본으로 굳히지 않는다 ──────────────
// 로컬에 마이그레이션 20260721050000 이 안 걸린 채(또는 post-load 를 건너뛴 채)
// 이 스크립트를 돌리면 전 차량 플래그가 기본값(false/0)으로 나온다. 그대로 커밋하면
// batch-golden.test.ts 는 "특례 없는 배차"를 정답으로 고정하게 되고,
// 그 테스트 주석이 "의도한 변경이면 기대값을 갱신하라"고 안내하기 때문에
// 회귀가 기대값으로 승격되는 경로가 실제로 열린다. 여기서 끊는다.
const exempt = busFixture.filter((b) => b.is_cohesion_exempt).length;
if (exempt === 0) {
  console.error(
    "❌ 응집 면제(짐차) 차량이 0대입니다. 특례가 꺼진 상태를 픽스처로 굳히려 하고 있습니다.\n" +
      "   supabase/migrations/20260721050000_bus_batch_flags.sql 이 적용됐는지,\n" +
      "   post-load.sh 를 돌렸는지 확인하세요."
  );
  process.exit(1);
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      _note:
        "운영 데이터(2026-07-21)의 구조만 익명화해 옮긴 배차 골든 스냅샷 입력. 실명·실 UUID 없음.",
      _source: "scripts/local-verify/make-batch-fixture.mjs",
      passengers,
      buses: busFixture,
    },
    null,
    1
  )
);

const campusSizes = [...passengers.reduce((m, p) => m.set(p.campus, (m.get(p.campus) ?? 0) + 1), new Map()).values()].sort((a, b) => b - a);
console.log(`승객 ${passengers.length} · 호차 ${busFixture.length} · 캠퍼스 ${campusAlias.size}`);
console.log(`상행슬롯 보유 ${passengers.filter((p) => p.departure_slot_id !== null).length} · 하행이용 ${passengers.filter((p) => p.uses_return_bus).length}`);
console.log(`캠퍼스 크기 분포 ${campusSizes.join(",")}`);
console.log(`→ ${path.relative(REPO, OUT)}`);
