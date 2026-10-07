import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const container = "supabase_db_carbus-web";
const event = "f9200000-0000-4000-8000-000000000001";
const tripIds = [31961, 31962, 31963, 31964];
const logDir = fileURLToPath(new URL("../../test-results/attendance-plan-worker/concurrency/", import.meta.url));
mkdirSync(logDir, { recursive: true });
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = (query) => execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
const metadata = JSON.parse(sql("select jsonb_build_object('master',(select id from public.profiles where role='master' limit 1),'campus',(select id from public.campuses limit 1),'guards',(select count(*) from pg_trigger where tgname in ('trg_registration_attendance_plan','trg_transport_attendance_plan','trg_transport_000_parent_lock','trg_reg_004_attendance_timestamp_rpc') and tgenabled='A'))"));
assert.match(metadata.master, /^[0-9a-f-]{36}$/);
assert.match(metadata.campus, /^[0-9a-f-]{36}$/);
assert.equal(metadata.guards, 4, "Install all attendance migrations before this local test");
const sanitize = (value) => value.replaceAll(metadata.master, "[local-master-id]").replaceAll(metadata.campus, "[local-campus-id]");
const ownedCount = () => Number(sql(`select (select count(*) from public.events where id=${literal(event)})+(select count(*) from public.registrations where event_id=${literal(event)})+(select count(*) from public.event_trips where event_id=${literal(event)})+(select count(*) from public.transport_legs where event_id=${literal(event)})+(select count(*) from public.registration_audit where event_id=${literal(event)})+(select count(*) from public.payment_ledger where event_id=${literal(event)})`));
assert.equal(ownedCount(), 0, "Never reuse existing fixtures");
assert.equal(sql(`select count(*) from public.event_trips where id in (${tripIds.join(",")})`), "0", "Never reuse occupied trip IDs");
const context = `do $$ begin perform set_config('request.jwt.claims','{"sub":"${metadata.master}","role":"authenticated"}',true); perform set_config('request.headers','{"x-carbus-event":"${event}"}',true); end $$; set local role authenticated;`;
const snapshotQuery = (id) => `select jsonb_build_object('version',r.version,'attend_from',r.attend_from,'attend_to',r.attend_to,'attend_from_at',r.attend_from_at,'attend_to_at',r.attend_to_at,'up_trip_id',r.up_trip_id,'down_trip_id',r.down_trip_id,'legs',coalesce((select jsonb_agg(jsonb_build_object('direction',direction,'mode',mode,'via_unit_id',via_unit_id,'status',status) order by direction) from public.transport_legs where registration_id=r.id),'[]'::jsonb)) from public.registrations r where id=${id}`;
const busLeg = (direction) => ({ direction, mode: "our_bus", via_unit_id: null, status: "confirmed" });
const initial = { attend_from: null, attend_to: null, attend_from_at: "2026-10-10T09:00:00+09:00", attend_to_at: "2026-10-12T18:00:00+09:00", up_trip_id: tripIds[0], down_trip_id: tripIds[1], legs: [busLeg("up"), busLeg("down")] };
let fixture;
const sessions = [];
const evidence = { event_id: event, trip_ids: tripIds, initial_owned_rows: 0, checks: [] };
const fingerprintQuery = () => `select md5(jsonb_build_object('event',(select to_jsonb(e) from public.events e where id=${literal(event)}),'registration',(select to_jsonb(r) from public.registrations r where id=${literal(fixture.id)} and event_id=${literal(event)}),'legs',(select jsonb_agg(to_jsonb(l) order by id) from public.transport_legs l where event_id=${literal(event)}),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.registration_audit a where event_id=${literal(event)}),'ledger',(select jsonb_agg(to_jsonb(l) order by id) from public.payment_ledger l where event_id=${literal(event)}))::text)`;
const session = (name) => {
  const proc = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "", exited = false;
  const waiters = [];
  const done = new Promise((resolve) => {
    proc.on("error", (error) => { errors += error.message; });
    proc.on("exit", (code) => {
      exited = true;
      for (const waiter of waiters) waiter.reject(new Error(`${name} exited before ${waiter.marker}: ${errors}`));
      resolve(code);
    });
  });
  proc.stdout.on("data", (chunk) => {
    output += chunk;
    for (const waiter of waiters) if (output.includes(waiter.marker)) waiter.resolve();
  });
  proc.stderr.on("data", (chunk) => { errors += chunk; });
  const wait = (marker) => output.includes(marker) ? Promise.resolve() : exited ? Promise.reject(new Error(`${name} exited: ${errors}`)) : new Promise((resolve, reject) => waiters.push({ marker, resolve, reject }));
  const send = (query) => proc.stdin.write(query + "\n");
  send(`begin; set local application_name=${literal(name)}; ${context} select 'SESSION_PID:'||pg_backend_pid();\n\\echo SESSION_STARTED`);
  const item = { name, send, wait, done, output: () => output, errors: () => errors, close: () => proc.stdin.end(), kill: () => proc.kill() };
  sessions.push(item);
  return item;
};
const markerValue = (client, marker) => {
  const line = client.output().split("\n").find((value) => value.startsWith(marker));
  assert.ok(line, `Missing ${marker}`);
  return line.slice(marker.length);
};
const blockedBy = async (waiting, holder) => {
  const holderPid = Number(markerValue(holder, "SESSION_PID:"));
  for (let attempt = 0; attempt < 50; attempt++) {
    const raw = sql(`select jsonb_build_object('waiter_pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event,'holder_pid',${holderPid},'blocked_by_holder',${holderPid}=any(pg_blocking_pids(pid))) from pg_stat_activity where application_name=${literal(waiting.name)}`);
    if (raw) {
      const state = JSON.parse(raw);
      if (state.wait_event_type === "Lock" && state.blocked_by_holder) return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${waiting.name} never waited on ${holder.name}`);
};
const closePair = async (a, b) => {
  a.close(); b.close();
  const codes = await Promise.all([a.done, b.done]);
  assert.deepEqual(codes, [0, 0], a.errors() + b.errors());
};
let failure;
let timer;
try {
  const payload = { ...initial, name: "Synthetic f920 journey concurrency", student_id: "26", campus_id: metadata.campus, payment_status: "unpaid", note: "Synthetic concurrency only", pickups: [], courses: [] };
  fixture = JSON.parse(sql(`begin; insert into public.events(id,name,starts_on,ends_on,unlock_until) values (${literal(event)},'Synthetic f920 concurrency','2026-10-10','2026-10-12',now()+interval '1 hour'); insert into public.event_trips(id,event_id,key,label,direction) overriding system value values (${tripIds[0]},${literal(event)},'race-up-a','Race up A','up'),(${tripIds[1]},${literal(event)},'race-down-a','Race down A','down'),(${tripIds[2]},${literal(event)},'race-up-b','Race up B','up'),(${tripIds[3]},${literal(event)},'race-down-b','Race down B','down'); ${context} do $$ declare v_id uuid; v_expected jsonb; begin v_id:=public.create_registration_complete(${literal(event)},${literal(JSON.stringify(payload))}::jsonb); select (${snapshotQuery("v_id")}) into v_expected; perform public.save_registration_journey(v_id,v_expected,${literal(JSON.stringify(initial))}::jsonb); perform set_config('test.journey_concurrency_id',v_id::text,true); end $$; select jsonb_build_object('id',current_setting('test.journey_concurrency_id'),'snapshot',(${snapshotQuery("current_setting('test.journey_concurrency_id')::uuid")})); commit;`));
  assert.match(fixture.id, /^[0-9a-f-]{36}$/);
  assert.equal(fixture.snapshot.legs.length, 2);
  evidence.registration_id = fixture.id;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Local concurrency verification exceeded 20 seconds")), 20000); });
  await Promise.race([(async () => {
    // Given: both clients observed the same complete parent and explicit raw legs.
    const run = randomUUID();
    evidence.run_id = run;
    const a = session("journey-race-A-" + run), b = session("journey-race-B-" + run);
    await Promise.all([a.wait("SESSION_STARTED"), b.wait("SESSION_STARTED")]);
    const winner = { ...initial, attend_from: "2026-10-10", attend_to: "2026-10-11", attend_from_at: "2026-10-10T10:00:00+09:00", attend_to_at: "2026-10-11T21:00:00+09:00", up_trip_id: tripIds[2], down_trip_id: null, legs: [busLeg("up"), { direction: "down", mode: "ktx", via_unit_id: null, status: "confirmed" }] };
    const loser = { ...initial, attend_from: "2026-10-11", attend_to: "2026-10-12", attend_from_at: "2026-10-11T11:00:00+09:00", attend_to_at: "2026-10-12T20:00:00+09:00", up_trip_id: null, down_trip_id: tripIds[3], legs: [{ direction: "up", mode: "own_car", via_unit_id: null, status: "confirmed" }, busLeg("down")] };
    a.send(`select 'A_RESULT:'||public.save_registration_journey(${literal(fixture.id)},${literal(JSON.stringify(fixture.snapshot))}::jsonb,${literal(JSON.stringify(winner))}::jsonb)::text; select 'A_FINGERPRINT:'||(${fingerprintQuery()});\n\\echo A_SAVED_PARENT_LOCKED`);
    await a.wait("A_SAVED_PARENT_LOCKED");
    // When: the second real psql client submits the old snapshot while A is uncommitted.
    b.send(`do $$ begin begin perform public.save_registration_journey(${literal(fixture.id)},${literal(JSON.stringify(fixture.snapshot))}::jsonb,${literal(JSON.stringify(loser))}::jsonb); raise exception 'Expected stale snapshot rejection'; exception when serialization_failure then raise notice 'B_CONFLICT_%',sqlstate; end; end $$; rollback;\n\\echo B_REJECTED_ROLLED_BACK`);
    evidence.rpc_wait = await blockedBy(b, a);
    a.send("commit;\n\\echo A_COMMITTED");
    await Promise.all([a.wait("A_COMMITTED"), b.wait("B_REJECTED_ROLLED_BACK")]);
    await closePair(a, b);
    // Then: 40001 follows an observed wait, and every durable row exactly matches A's locked result.
    assert.match(b.errors(), /B_CONFLICT_40001/);
    assert.equal(sql(fingerprintQuery()), markerValue(a, "A_FINGERPRINT:"));
    const result = JSON.parse(markerValue(a, "A_RESULT:"));
    assert.equal(result.row.up_trip_id, tripIds[2]);
    assert.equal(result.row.down_trip_id, null);
    assert.equal(result.row.attend_from_at, "2026-10-10T01:00:00+00:00");
    assert.equal(result.row.attend_to_at, "2026-10-11T12:00:00+00:00");
    assert.equal(result.row.fee, 25000);
    assert.equal(result.legs.find((leg) => leg.direction === "down").mode, "ktx");
    evidence.checks.push("Two journey RPCs serialize; stale client waits then receives 40001; winner row/legs/audit/ledger/revision fingerprint unchanged by loser");
    evidence.rpc_conflict_sqlstate = "40001";
    evidence.winner_fingerprint = markerValue(a, "A_FINGERPRINT:");
    const c = session("journey-leg-C-" + run), d = session("journey-leg-D-" + run);
    await Promise.all([c.wait("SESSION_STARTED"), d.wait("SESSION_STARTED")]);
    const beforeLeg = sql(fingerprintQuery());
    // Given: C holds only the parent row; no leg row is locked by C.
    c.send(`select 1 from public.registrations where id=${literal(fixture.id)} for update;\n\\echo C_PARENT_ONLY_LOCKED`);
    await c.wait("C_PARENT_ONLY_LOCKED");
    // When: an independent transport update reaches the installed parent-lock trigger.
    d.send(`update public.transport_legs set mode='own_car' where registration_id=${literal(fixture.id)} and direction='down';\n\\echo D_LEG_CHANGED\nrollback;\n\\echo D_ROLLED_BACK`);
    evidence.transport_wait = await blockedBy(d, c);
    c.send("commit;\n\\echo C_COMMITTED");
    await Promise.all([c.wait("C_COMMITTED"), d.wait("D_ROLLED_BACK")]);
    await closePair(c, d);
    // Then: the standalone leg writer waited on the parent, and its rollback restored the entire owned state.
    assert.equal(sql(fingerprintQuery()), beforeLeg);
    evidence.checks.push("Standalone transport writer waits on parent-only lock; rollback restores full owned-state fingerprint");
  })(), deadline]);
  evidence.status = "PASS";
} catch (error) {
  failure = error;
  evidence.status = "FAIL";
  evidence.error = error instanceof Error ? error.message : String(error);
} finally {
  clearTimeout(timer);
  for (const client of sessions) {
    writeFileSync(logDir + client.name + ".log", sanitize(client.output() + "\nSTDERR\n" + client.errors()));
    client.kill();
  }
  if (sessions.length > 0) sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in (${sessions.map((client) => literal(client.name)).join(",")}) and pid<>pg_backend_pid()`);
  // Cleanup is restricted to the newly created f920 event; no existing participant/profile is changed.
  sql(`begin; delete from public.transport_legs where event_id=${literal(event)}; delete from public.registrations where event_id=${literal(event)}; delete from public.registration_audit where event_id=${literal(event)}; delete from public.payment_ledger where event_id=${literal(event)}; delete from public.event_trips where event_id=${literal(event)}; delete from public.events where id=${literal(event)}; commit;`);
  evidence.final_owned_rows = ownedCount();
  assert.equal(evidence.final_owned_rows, 0, "Every owned synthetic fixture must be removed");
  assert.equal(sql(`select count(*) from public.event_trips where id in (${tripIds.join(",")})`), "0");
  evidence.completed_at_kst = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }) + "+09:00";
  evidence.session_logs = sessions.map((client) => client.name + ".log");
  writeFileSync(logDir + "verification.json", JSON.stringify(evidence, null, 2) + "\n");
}
if (failure) throw failure;
console.log("PASS: actual two-client journey wait→40001; standalone transport parent lock; no mixed durable state; owned fixtures 0→0");
console.log("Receipt: " + logDir + "verification.json");
