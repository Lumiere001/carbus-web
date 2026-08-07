import { createClient } from "/Users/east_star/Projects/carbus-web/node_modules/.pnpm/@supabase+supabase-js@2.106.0/node_modules/@supabase/supabase-js/dist/index.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// ============================================================
// 운영 스냅샷 백업 (로컬 전용 — PII 포함, 커밋·외부 전송 금지)
// ============================================================
// 사용법: node scripts/local-verify/backup-prod.mjs <출력경로> [설명]
//
// ⚠️ 이 백업이 **유일한 롤백 경로**인 경우가 있다(Phase 3 처럼 컬럼 rename 이
//    들어가면 앱만 되돌리는 롤백이 불가능하다). 그래서 이 스크립트는
//    한 테이블이라도 못 뜨면 **0 이 아닌 코드로 종료한다.** 예전엔 실패를
//    한 줄 찍고 성공처럼 끝나서, 빠진 걸 모르고 db push 로 넘어갈 수 있었다.

const OUT = process.argv[2];
if (!OUT) {
  console.error("사용법: node backup-prod.mjs <출력경로> [설명]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  readFileSync("/Users/east_star/Projects/carbus-web/.env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ⚠️ 새 Phase 에서 테이블을 만들면 **여기에 반드시 추가**할 것.
//    이 목록은 Phase 1 때 쓰인 뒤 갱신되지 않아 events·org_units·payment_ledger 가
//    2026-07-21 까지 백업에서 통째로 빠져 있었다. 장부 1,081건이 백업에 없다는 뜻이고,
//    그 백업으로는 복구도 로컬 재현도 되지 않는다(registrations.event_id 가 붕 뜬다).
//    load-backup.py 가 적재 시 DB 테이블 목록과 대조해 누락을 잡아준다.
//
// `was` 는 **이름이 바뀐 테이블의 옛 이름**이다. 마이그레이션을 올리기 *직전*에
// 백업을 뜨는데, 그 순간 운영은 아직 옛 이름이다. 이걸 안 보면 백업 대상이
// 통째로 빠진 채 "성공"으로 끝난다 — 정확히 롤백이 필요한 순간에.
// 파일은 **찾은 이름 그대로** 저장한다(load-backup.py 가 RENAMED_FROM 으로 읽는다).
//
// 순서: 참조되는 쪽 먼저 (events → registrations → payment_ledger)
const TABLES = [
  { name: "events" },
  { name: "campuses" },
  { name: "org_units" },
  { name: "event_trips", was: "departure_slots" },
  { name: "buses" },
  { name: "registrations" },
  { name: "profiles" },
  { name: "role_labels" },
  { name: "system_config" },
  { name: "batch_runs" },
  { name: "registration_audit" },
  { name: "campus_remittances" },
  { name: "campus_payment_settlements" },
  { name: "payment_ledger" },
  { name: "transport_legs" },
  { name: "pickup_places" },
  { name: "pickup_requests" },
  // 수강신청 조사 (2026-07-31). 새 테이블을 여기 안 넣으면 **백업에서 통째로 빠진다** —
  // 행수만 보는 검사로는 안 걸리고, 롤백이 필요한 순간에야 없다는 걸 알게 된다.
  { name: "course_signups" },
];

/** 테이블 전체를 1000행씩 읽는다. 없는 테이블이면 null. */
async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").range(from, from + 999);
    if (error) return { error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows };
}

const manifest = {
  created_at: new Date().toISOString(),
  purpose: process.argv[3] ?? "운영 스냅샷",
  tables: {},
};
let failed = 0;

for (const t of TABLES) {
  let stored = t.name;
  let res = await fetchAll(t.name);
  // 아직 이름이 안 바뀐 운영이면 옛 이름으로 한 번 더.
  if (res.error && t.was) {
    const alt = await fetchAll(t.was);
    if (!alt.error) {
      stored = t.was;
      res = alt;
      console.log(`  ↩ ${t.name} → 운영은 아직 '${t.was}' 입니다. 그 이름으로 저장합니다.`);
    }
  }
  if (res.error) {
    // "아직 없는 테이블"과 "백업 실패"는 다르다. 새 기능을 올리기 **직전**에 백업을
    // 뜨면 그 기능의 테이블은 당연히 아직 없다 — 그걸 실패로 세면 배포가 막히고,
    // 막으려던 진짜 사고(있는데 못 뜬 것)와 구분이 안 된다.
    const notThereYet =
      /does not exist|Could not find the table|PGRST205/i.test(res.error);
    if (notThereYet) {
      console.log(`  · ${t.name.padEnd(28)} 아직 운영에 없음 (건너뜀)`);
      manifest.tables[t.name] = { absent: true };
      continue;
    }
    console.log(`  ✗ ${t.name}: ${res.error}`);
    manifest.tables[t.name] = { error: res.error };
    failed++;
    continue;
  }
  writeFileSync(`${OUT}/${stored}.json`, JSON.stringify(res.rows, null, 1));
  manifest.tables[stored] = { rows: res.rows.length };
  console.log(`  ✓ ${stored.padEnd(28)} ${String(res.rows.length).padStart(6)} 행`);
}

writeFileSync(`${OUT}/_manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\n실패: ${failed}`);

if (failed > 0) {
  console.error(
    "\n🔴 백업이 불완전합니다. 이 상태로 마이그레이션을 올리면 되돌릴 수 없습니다.\n" +
      "   빠진 테이블을 확인하고 다시 뜨세요."
  );
  process.exit(1);
}
console.log("✅ 전 테이블 백업 완료");
