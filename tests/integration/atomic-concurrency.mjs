import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const container = "supabase_db_carbus-web";
const sql = (query) => execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
const fixture = JSON.parse(sql("select jsonb_build_object('event',(select public.active_event_id()),'master',(select id from public.profiles where role='master' limit 1),'reg',(select id from public.registrations where event_id=public.active_event_id() and participation_status<>'cancelled' limit 1))"));
for (const id of Object.values(fixture)) assert.match(id, /^[0-9a-f-]{36}$/);
const fingerprint = () => sql(`select md5(jsonb_build_object('event',(select to_jsonb(e) from public.events e where id='${fixture.event}'),'regs',(select jsonb_agg(to_jsonb(r) order by id) from public.registrations r where event_id='${fixture.event}'),'buses',(select jsonb_agg(to_jsonb(b) order by id) from public.buses b where event_id='${fixture.event}'),'history',(select jsonb_agg(to_jsonb(b) order by id) from public.batch_runs b where event_id='${fixture.event}'),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.registration_audit a where event_id='${fixture.event}'),'config',(select to_jsonb(s) from public.system_config s where id=1))::text)`);
const before = fingerprint();
const session = (name) => {
  const proc = spawn("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-Atq"], { stdio: ["pipe", "pipe", "pipe"] });
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
  return { send, wait, done, close: () => proc.stdin.end(), kill: () => proc.kill(), errors: () => errors };
};
const runId = randomUUID();
const aName = "atomic-lock-A-" + runId, bName = "atomic-lock-B-" + runId;
const a = session(aName), b = session(bName);
let timer;
const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Concurrency check exceeded 15 seconds")), 15000); });
try {
  await Promise.race([(async () => {
    // Given: A owns the event lock, then B owns a registration lock and waits on A's revision row.
    a.send(`select 1 from public.events where id='${fixture.event}' for update;\n\\echo A_LOCKED`);
    await a.wait("A_LOCKED");
    b.send(`update public.registrations set name=name || ' concurrency fixture' where id='${fixture.reg}';\nrollback;\n\\echo B_ROLLED_BACK`);
    while (sql(`select count(*) from pg_stat_activity where application_name='${bName}' and wait_event_type='Lock'`) !== "1") await new Promise((resolve) => setImmediate(resolve));
    // When: the event-first RPC meets the existing row-first direct writer.
    a.send(`do $$ begin begin perform public.set_leader_binding('${fixture.reg}','driver','disable'); exception when deadlock_detected then raise notice 'ATOMIC_DEADLOCK_40P01'; end; end $$;\nrollback;\n\\echo A_ROLLED_BACK`);
    await Promise.all([a.wait("A_ROLLED_BACK"), b.wait("B_ROLLED_BACK")]);
    a.close(); b.close();
    await Promise.all([a.done, b.done]);
    // Then: one actual 40P01/deadlock, both sessions finish, and every persistent value is unchanged.
    assert.match(a.errors() + b.errors(), /ATOMIC_DEADLOCK_40P01|deadlock detected/);
    assert.equal(fingerprint(), before);
    console.log("PASS: real event/registration lock collision rolls back, no partial or persistent writes");
  })(), deadline]);
} finally {
  clearTimeout(timer);
  a.kill(); b.kill();
}
