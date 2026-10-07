import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const container = "supabase_db_carbus-web";
const sql = (query) => execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
const fixture = JSON.parse(sql(`select jsonb_build_object('event', b.event_id, 'bus', b.id,
  'master', (select id from public.profiles where role = 'master' limit 1), 'next_driver', r.id,
  'expected_driver_id', b.driver_registration_id, 'expected_fixed_ids', b.fixed_passenger_ids)
  from public.buses b join public.registrations r on r.event_id = b.event_id
    and r.participation_status <> 'cancelled' and r.id is distinct from b.driver_registration_id
    and (b.kind = 'staff_car' or r.up_trip_id = b.up_trip_id)
  where b.event_id = public.active_event_id() and b.up_trip_id is not null limit 1`));
assert.ok(fixture, "A writable local bus and registration fixture is required");
for (const id of [fixture.event, fixture.master, fixture.next_driver]) assert.match(id, /^[0-9a-f-]{36}$/);
assert.ok(Number.isSafeInteger(fixture.bus));
const fingerprint = () => sql(`select md5(jsonb_build_object('event',(select to_jsonb(e) from public.events e where id='${fixture.event}'),
  'regs',(select jsonb_agg(to_jsonb(r) order by id) from public.registrations r where event_id='${fixture.event}'),
  'buses',(select jsonb_agg(to_jsonb(b) order by id) from public.buses b where event_id='${fixture.event}'),
  'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.registration_audit a where event_id='${fixture.event}'))::text)`);
const before = fingerprint();
const session = (name) => {
  const proc = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  const waiters = [];
  proc.stdout.on("data", (chunk) => {
    output += chunk;
    for (const waiter of waiters) if (output.includes(waiter.marker)) waiter.resolve();
  });
  proc.stderr.on("data", (chunk) => { errors += chunk; });
  const done = new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${name} exit ${code}: ${errors}`)));
  });
  const send = (query) => proc.stdin.write(query + "\n");
  const wait = (marker) => output.includes(marker) ? Promise.resolve() : new Promise((resolve) => waiters.push({ marker, resolve }));
  send(`begin; set application_name='${name}'; do $$ begin perform set_config('request.jwt.claims','{"sub":"${fixture.master}","role":"authenticated"}',true); perform set_config('request.headers','{"x-carbus-event":"${fixture.event}"}',true); end $$; set local role authenticated;`);
  return { send, wait, done, close: () => proc.stdin.end(), kill: () => proc.kill() };
};
const runId = randomUUID();
const a = session("bus-binding-A-" + runId), bName = "bus-binding-B-" + runId, b = session(bName);
const intent = JSON.stringify({ kind: "driver", expected_driver_id: fixture.expected_driver_id,
  expected_fixed_ids: fixture.expected_fixed_ids, driver_id: fixture.next_driver });
let timer;
const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Bus serialization check exceeded 15 seconds")), 15000); });
try {
  await Promise.race([(async () => {
    // Given: A changed the observed driver inside an uncommitted atomic RPC.
    a.send(`select public.set_bus_binding(${fixture.bus}, 'up', '${intent}'::jsonb);\n\\echo A_REPLACED`);
    await a.wait("A_REPLACED");
    // When: B submits the same original observation, it waits on the event lock before writing.
    b.send(`select public.set_bus_binding(${fixture.bus}, 'up', '${intent}'::jsonb);\nrollback;\n\\echo B_ROLLED_BACK`);
    while (sql(`select count(*) from pg_stat_activity where application_name='${bName}' and wait_event_type='Lock'`) !== "1") await new Promise((resolve) => setImmediate(resolve));
    a.send(`rollback;\n\\echo A_ROLLED_BACK`);
    await Promise.all([a.wait("A_ROLLED_BACK"), b.wait("B_ROLLED_BACK")]);
    a.close(); b.close();
    await Promise.all([a.done, b.done]);
    // Then: B observes A's rollback, completes its own atomic replacement, and rolls back without persistent changes.
    assert.equal(fingerprint(), before);
    console.log("PASS: two bus binding RPCs serialize on the event lock; both roll back without persistent writes");
  })(), deadline]);
} finally {
  clearTimeout(timer);
  a.kill(); b.kill();
}
