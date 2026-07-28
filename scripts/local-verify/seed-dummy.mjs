// ============================================================
// 더미 신청 투입 — 행사를 실제로 돌리기 전에 리허설한다
// ============================================================
// 왜 필요한가:
//   행사를 새로 열면 신청이 0건이다. 그 상태에서는 배차도 출석도 정산도
//   **눌러 볼 수가 없다.** 실제 캠프가 시작된 뒤에 처음 눌러 보면 그때 터진다 —
//   §24·§25 가 정확히 그렇게 터졌다.
//
// 어떻게 쓰나:
//   node scripts/local-verify/seed-dummy.mjs --count 200            # 로컬
//   node scripts/local-verify/seed-dummy.mjs --count 30 --prod      # 운영(소수)
//   node scripts/local-verify/seed-dummy.mjs --cleanup [--prod]     # 전량 회수
//
// ⚠️ 지우는 방법이 함께 있어야 넣을 수 있다. 그래서 더미는 **표식**을 달고 태어난다:
//   이름이 `[테스트]` 로 시작하고 끝에 일련번호가 붙는다 — `[테스트]김민준001`.
//   회수는 이 표식으로만 지운다. 표식이 없는 행은 어떤 경우에도 건드리지 않는다.
//
//   학번은 표식으로 쓸 수 없다. 이 시스템의 학번은 **두 자리 숫자**(입학 연도)라
//   `chk_student_id_format` 이 `^\d{2}$` 로 막는다. 사람마다 고유한 값이 아니다.
//   그래서 이름이 유일한 표식이고, 신원 유니크 키(행사·캠퍼스·학번·이름)를
//   지키기 위해 이름 끝에 일련번호를 붙인다.
//
// ⚠️ 앱과 같은 길로 넣는다 — PostgREST + `x-carbus-event` 헤더. psql 로 직접 넣으면
//    행사 쓰기 가드·파생 트리거가 실제로 도는지 알 수 없다(§25-C 의 교훈).
// ============================================================
import { createClient } from "/Users/east_star/Projects/carbus-web/node_modules/.pnpm/@supabase+supabase-js@2.106.0/node_modules/@supabase/supabase-js/dist/index.mjs";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const PROD = has("--prod");
const CLEANUP = has("--cleanup");
const COUNT = Number(val("--count", "200"));

const NAME_PREFIX = "[테스트]";

// ── 접속 대상 ────────────────────────────────────────────────
// 기본은 **로컬**이다. 운영은 --prod 를 명시해야만 간다 — 기본값이 운영이면
// 언젠가 깜빡하고 운영에 200명을 넣는다.
let url, key;
if (PROD) {
  const env = Object.fromEntries(
    readFileSync("/Users/east_star/Projects/carbus-web/.env.local", "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
  url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  key = env.SUPABASE_SERVICE_ROLE_KEY;
} else {
  url = "http://127.0.0.1:54321";
  key =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
}

const anon = createClient(url, key, { auth: { persistSession: false } });

// 활성 행사를 먼저 알아야 헤더를 달 수 있다.
const { data: ev, error: evErr } = await anon
  .from("events")
  .select("id,name,starts_on,ends_on")
  .eq("is_active", true)
  .single();
if (evErr || !ev) {
  console.error("활성 행사를 못 찾았습니다:", evErr?.message);
  process.exit(1);
}

// 앱과 같은 헤더를 달고 다시 만든다. 이 헤더가 없으면 행사 쓰기 가드가 막는다.
const db = createClient(url, key, {
  auth: { persistSession: false },
  global: { headers: { "x-carbus-event": ev.id } },
});

console.log(`대상: ${PROD ? "🔴 운영" : "로컬"} · 행사 "${ev.name}" (${ev.starts_on}~${ev.ends_on})`);

// ── 회수 ─────────────────────────────────────────────────────
if (CLEANUP) {
  const { data: mine, error } = await db
    .from("registrations")
    .select("id,name")
    .eq("event_id", ev.id)
    .like("name", `${NAME_PREFIX}%`);
  if (error) {
    console.error("조회 실패:", error.message);
    process.exit(1);
  }
  if (!mine?.length) {
    console.log("회수할 더미가 없습니다.");
    process.exit(0);
  }
  // 서버가 걸러 준 것을 **여기서 한 번 더 확인한다.** LIKE 패턴을 잘못 짜면
  // 사람 행이 딸려 온다. 지우기 직전이 마지막으로 멈출 수 있는 자리다.
  const targets = mine.filter((r) => r.name?.startsWith(NAME_PREFIX));
  if (targets.length !== mine.length) {
    console.error(
      `표식이 없는 행이 ${mine.length - targets.length}건 섞여 있습니다. 중단합니다.`
    );
    process.exit(1);
  }
  const ids = targets.map((r) => r.id);

  // 딸린 것부터 지운다 — FK 가 NO ACTION 인 것들이 있다.
  for (const t of ["pickup_requests", "transport_legs", "payment_ledger", "registration_audit"]) {
    const { error: e } = await db.from(t).delete().in("registration_id", ids);
    if (e && !e.message.includes("does not exist")) console.log(`  ${t}: ${e.message}`);
  }
  // 고정 탑승자·차량순장으로 박혀 있으면 FK 가 막는다. 먼저 뗀다.
  const { data: buses } = await db.from("buses").select("id,driver_registration_id,down_driver_registration_id,fixed_passenger_ids,down_fixed_passenger_ids").eq("event_id", ev.id);
  for (const b of buses ?? []) {
    const patch = {};
    if (ids.includes(b.driver_registration_id)) patch.driver_registration_id = null;
    if (ids.includes(b.down_driver_registration_id)) patch.down_driver_registration_id = null;
    const fu = (b.fixed_passenger_ids ?? []).filter((x) => !ids.includes(x));
    const fd = (b.down_fixed_passenger_ids ?? []).filter((x) => !ids.includes(x));
    if (fu.length !== (b.fixed_passenger_ids ?? []).length) patch.fixed_passenger_ids = fu;
    if (fd.length !== (b.down_fixed_passenger_ids ?? []).length) patch.down_fixed_passenger_ids = fd;
    if (Object.keys(patch).length) await db.from("buses").update(patch).eq("id", b.id);
  }

  const { error: delErr, count } = await db
    .from("registrations")
    .delete({ count: "exact" })
    .in("id", ids);
  if (delErr) {
    console.error("삭제 실패:", delErr.message);
    process.exit(1);
  }
  console.log(`회수 완료: 신청 ${count ?? ids.length}건 (+ 딸린 기록)`);

  // 남은 게 없는지 **다시 세어서** 확인한다. "삭제됨" 이라 보고됐는데 행이 남아
  // 있던 적이 있다(§26 교훈).
  const { count: left } = await db
    .from("registrations")
    .select("*", { count: "exact", head: true })
    .eq("event_id", ev.id)
    .like("name", `${NAME_PREFIX}%`);
  console.log(`확인: 남은 더미 ${left ?? 0}건`);
  process.exit(left ? 1 : 0);
}

// ── 투입 ─────────────────────────────────────────────────────
if (PROD && COUNT > 50) {
  console.error(`운영에는 한 번에 50건까지만 넣습니다 (요청 ${COUNT}건).`);
  process.exit(1);
}

const [{ data: campuses }, { data: trips }, { data: units }, { data: roleLabels }] =
  await Promise.all([
    db.from("campuses").select("id,name,display_order").order("display_order"),
    db.from("event_trips").select("id,direction,label,active").eq("event_id", ev.id),
    db.from("org_units").select("id,name").eq("kind", "district").limit(8),
    db.from("role_labels").select("label"),
  ]);

const upTrips = (trips ?? []).filter((t) => t.direction === "up" && t.active);
const downTrips = (trips ?? []).filter((t) => t.direction === "down" && t.active);
if (!upTrips.length || !downTrips.length) {
  console.error("상행·하행 운행편이 둘 다 있어야 합니다. 편성에서 먼저 만드세요.");
  process.exit(1);
}

// 재현 가능한 난수 — 같은 씨앗이면 같은 명단이 나온다. 리허설을 두 번 돌려
// 비교할 때 명단이 매번 바뀌면 무엇이 달라진 건지 알 수 없다.
let seed = Number(val("--seed", "20260820"));
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// 차량과 짝을 이뤄야 뜻이 통하는 역할(`차량 순장`·`고정 탑승자`)은 뺀다.
const VEHICLE_ROLES = ["차량 순장", "고정 탑승자"];
const PERSON_ROLES = (roleLabels ?? [])
  .map((x) => x.label)
  .filter((l) => !VEHICLE_ROLES.includes(l));

const SURNAMES = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노정하곽성차주우구신임";
const GIVEN = ["민준","서연","도윤","하은","시우","지우","주원","서아","예준","수아","지호","하윤","건우","지아","우진","채원","선우","다은","연우","유나","현우","소율","시윤","은우","서윤","정우","윤서","승우","가은"];

const rows = [];
for (let i = 0; i < COUNT; i += 1) {
  const campus = pick(campuses ?? []);
  const r = rnd();
  // 참여형태 분포를 실제와 비슷하게. 지난 수련회는 왕복이 압도적이고 편도가 조금,
  // 미이용(self)이 소수였다. 전부 왕복으로 만들면 편도 경로가 리허설에서 빠진다.
  const roundtrip = r < 0.78;
  const onlyUp = !roundtrip && r < 0.88;
  const onlyDown = !roundtrip && !onlyUp && r < 0.95;

  rows.push({
    event_id: ev.id,
    // 일련번호는 신원 유니크 키(행사·캠퍼스·학번·이름)를 지키기 위한 것이다.
    // 200명이면 같은 캠퍼스·같은 학번에 같은 이름이 반드시 겹친다.
    name:
      `${NAME_PREFIX}${SURNAMES[Math.floor(rnd() * SURNAMES.length)]}${pick(GIVEN)}` +
      String(i + 1).padStart(3, "0"),
    student_id: String(18 + Math.floor(rnd() * 8)), // 18~25학번
    campus_id: campus.id,
    up_trip_id: roundtrip || onlyUp ? pick(upTrips).id : null,
    down_trip_id: roundtrip || onlyDown ? pick(downTrips).id : null,
    payment_status: rnd() < 0.55 ? "paid" : "unpaid",
    // 역할은 **사람만 붙이는 것**(총단·간사 등)만 쓴다. `차량 순장`·`고정 탑승자` 는
    // 차량과 짝을 이뤄야 뜻이 통하므로 더미가 함부로 달면 배차가 이상해진다.
    roles: rnd() < 0.06 ? [pick(PERSON_ROLES)] : [],
    note: null,
  });
}

// 100건씩 나눠 넣는다. 한 번에 다 보내면 어디서 막혔는지 알 수 없다.
let inserted = 0;
const madeIds = [];
for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100);
  const { data, error } = await db.from("registrations").insert(chunk).select("id,name");
  if (error) {
    console.error(`신청 투입 실패 (${inserted}건까지 성공):`, error.message);
    process.exit(1);
  }
  inserted += data.length;
  madeIds.push(...data.map((d) => d.id));
  process.stdout.write(`  신청 ${inserted}/${rows.length}\r`);
}
console.log(`  신청 ${inserted}건 투입 완료      `);

// ── 이동수단 — 우리 버스가 아닌 사람들 ────────────────────────
// 이걸 안 넣으면 §26-B 의 연동이 리허설에서 한 번도 안 돌아 본다.
const legs = [];
for (const id of madeIds) {
  const r = rnd();
  if (r < 0.05) {
    legs.push({ event_id: ev.id, registration_id: id, direction: "up",
                mode: "other_district", status: "pending",
                via_unit_id: pick(units ?? []).id });
  } else if (r < 0.08) {
    legs.push({ event_id: ev.id, registration_id: id, direction: "down",
                mode: "own_car", status: "confirmed" });
  } else if (r < 0.10) {
    legs.push({ event_id: ev.id, registration_id: id, direction: "up",
                mode: "ktx", status: "confirmed" });
  }
}
if (legs.length) {
  const { error } = await db.from("transport_legs").insert(legs);
  if (error) console.error("이동수단 투입 실패:", error.message);
  else console.log(`  이동수단 ${legs.length}건 (타지구 대기·자차·KTX 섞음)`);
}

console.log(`\n완료. 회수: node scripts/local-verify/seed-dummy.mjs --cleanup${PROD ? " --prod" : ""}`);
