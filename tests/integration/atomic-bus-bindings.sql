\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from public.profiles where role = 'master' limit 1), 'role', 'authenticated')::text, true);
select set_config('request.headers', '{"x-carbus-event":"f3000000-0000-4000-8000-000000000001"}', true);
insert into public.events(id, name, unlock_until) values ('f3000000-0000-4000-8000-000000000001', 'Bus binding SQL fixture', now() + interval '1 hour');
insert into public.event_trips(id, event_id, key, label, direction) overriding system value values
(30101, 'f3000000-0000-4000-8000-000000000001', 'binding-up', 'Binding up', 'up'),
(30102, 'f3000000-0000-4000-8000-000000000001', 'binding-down', 'Binding down', 'down'),
(30103, 'f3000000-0000-4000-8000-000000000001', 'binding-other', 'Binding other', 'up');
insert into public.buses(id, event_id, name, capacity, hard_cap, up_trip_id, down_trip_id, kind) values
(220000001, 'f3000000-0000-4000-8000-000000000001', 'Binding first', 3, 3, 30101, 30102, 'bus'),
(220000002, 'f3000000-0000-4000-8000-000000000001', 'Binding second', 3, 3, 30101, 30102, 'bus'),
(220000003, 'f3000000-0000-4000-8000-000000000001', 'Binding staff', 3, 3, 30101, 30102, 'staff_car');
insert into public.registrations(id, event_id, name, student_id, campus_id, up_trip_id, down_trip_id, assigned_up_bus_id, assigned_down_bus_id)
select ('f4000000-0000-4000-8000-00000000000' || n)::uuid, 'f3000000-0000-4000-8000-000000000001',
  'Binding person ' || n, '26', (select id from public.campuses limit 1),
  case when n = 5 then 30103 when n <> 3 then 30101 end, case when n <> 3 then 30102 end,
  case when n <> 3 then 220000001 end, case when n <> 3 then 220000001 end
from generate_series(1,9) n;
update public.registrations set participation_status = 'cancelled' where id = 'f4000000-0000-4000-8000-000000000004';
update public.buses set driver_registration_id = 'f4000000-0000-4000-8000-000000000001', down_driver_registration_id = 'f4000000-0000-4000-8000-000000000001',
  fixed_passenger_ids = array['f4000000-0000-4000-8000-000000000002'::uuid], down_fixed_passenger_ids = array['f4000000-0000-4000-8000-000000000002'::uuid] where id = 220000001;
create function pg_temp.assert_binding(p_ok boolean, p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %', p_message; end if; end $$;
create function pg_temp.binding_intent(p_bus integer, p_mode text, p_kind text, p_desired jsonb) returns jsonb language sql as $$
  select jsonb_build_object('kind', p_kind,
    'expected_driver_id', case when p_mode = 'up' then driver_registration_id else down_driver_registration_id end,
    'expected_fixed_ids', case when p_mode = 'up' then fixed_passenger_ids else down_fixed_passenger_ids end) || p_desired
  from public.buses where id = p_bus
$$;
create function pg_temp.binding_snapshot() returns jsonb language sql as $$
  select jsonb_build_object('buses', (select jsonb_agg(to_jsonb(b) order by id) from public.buses b where event_id = 'f3000000-0000-4000-8000-000000000001'),
    'regs', (select jsonb_agg(to_jsonb(r) order by id) from public.registrations r where event_id = 'f3000000-0000-4000-8000-000000000001'),
    'event', (select to_jsonb(e) from public.events e where id = 'f3000000-0000-4000-8000-000000000001'),
    'audit', (select jsonb_agg(to_jsonb(a) order by id) from public.registration_audit a where event_id = 'f3000000-0000-4000-8000-000000000001'))
$$;
create function pg_temp.fail_staff_sync() returns trigger language plpgsql as $$
begin
  if current_setting('test.bus_staff_failure', true) = 'on' and new.id = 'f4000000-0000-4000-8000-000000000006'
     and new.assigned_up_bus_id = 220000003 and new.assigned_up_bus_id is distinct from old.assigned_up_bus_id then
    raise exception 'Injected staff sync failure' using errcode = 'P9001';
  end if;
  return new;
end $$;
create trigger test_bus_staff_failure before update on public.registrations for each row execute function pg_temp.fail_staff_sync();
set local role authenticated;

-- Given the bus selector's observed current driver; When explicitly replaced; Then only its driver role changes and ordinary assignments remain.
savepoint driver_replace;
do $$ begin
  perform public.set_bus_binding(220000001, 'up', pg_temp.binding_intent(220000001, 'up', 'driver', '{"driver_id":"f4000000-0000-4000-8000-000000000002"}'));
  perform pg_temp.assert_binding((select driver_registration_id = 'f4000000-0000-4000-8000-000000000002' and 'f4000000-0000-4000-8000-000000000002'::uuid = any(fixed_passenger_ids) from public.buses where id = 220000001), 'driver replacement preserves other role');
  perform pg_temp.assert_binding((select bool_and(assigned_up_bus_id = 220000001 and assigned_down_bus_id = 220000001) from public.registrations where id in ('f4000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000002')), 'ordinary assignments unchanged');
end $$;
rollback to driver_replace;
release driver_replace;

-- Given a driver already on another bus; When selected through a stale candidate list; Then its same-kind source binding moves without removing its other role.
savepoint driver_move;
update public.buses set fixed_passenger_ids = array['f4000000-0000-4000-8000-000000000001'::uuid] where id = 220000001;
do $$ begin
  perform public.set_bus_binding(220000002, 'up', pg_temp.binding_intent(220000002, 'up', 'driver', '{"driver_id":"f4000000-0000-4000-8000-000000000001"}'));
  perform pg_temp.assert_binding((select driver_registration_id is null and 'f4000000-0000-4000-8000-000000000001'::uuid = any(fixed_passenger_ids) from public.buses where id = 220000001), 'source same-kind clears and other kind retained');
  perform pg_temp.assert_binding((select driver_registration_id = 'f4000000-0000-4000-8000-000000000001' from public.buses where id = 220000002), 'destination driver bound');
end $$;
rollback to driver_move;
release driver_move;

-- Given a fixed rider on another bus; When added to the destination in the down direction; Then its same-kind source moves while ordinary assignments stay unchanged.
savepoint fixed_move;
do $$ begin
  perform public.set_bus_binding(220000002, 'down', pg_temp.binding_intent(220000002, 'down', 'fixed', '{"fixed_ids":["f4000000-0000-4000-8000-000000000002"]}'));
  perform pg_temp.assert_binding((select cardinality(down_fixed_passenger_ids) = 0 and cardinality(fixed_passenger_ids) = 1 from public.buses where id = 220000001), 'source down fixed moves without touching up');
  perform pg_temp.assert_binding((select assigned_up_bus_id = 220000001 and assigned_down_bus_id = 220000001 from public.registrations where id = 'f4000000-0000-4000-8000-000000000002'), 'ordinary assignments retained after move');
end $$;
rollback to fixed_move;
release fixed_move;

-- Given another operator changed either observed field; When an old intent is submitted; Then the newer state survives without partial writes.
savepoint stale_bus;
do $$ declare v_intent jsonb; v_before jsonb; begin
  v_intent := pg_temp.binding_intent(220000001, 'up', 'driver', '{"driver_id":"f4000000-0000-4000-8000-000000000006"}');
  update public.buses set fixed_passenger_ids = array_append(fixed_passenger_ids, 'f4000000-0000-4000-8000-000000000007') where id = 220000001;
  v_before := pg_temp.binding_snapshot();
  begin perform public.set_bus_binding(220000001, 'up', v_intent); raise exception 'Expected stale rejection' using errcode = 'P9009'; exception when sqlstate '40001' then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'stale driver intent preserves newer fixed rider');
  v_intent := pg_temp.binding_intent(220000001, 'down', 'fixed', '{"fixed_ids":[]}');
  update public.buses set down_driver_registration_id = 'f4000000-0000-4000-8000-000000000006' where id = 220000001;
  v_before := pg_temp.binding_snapshot();
  begin perform public.set_bus_binding(220000001, 'down', v_intent); raise exception 'Expected stale rejection' using errcode = 'P9009'; exception when sqlstate '40001' then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'stale fixed intent preserves newer driver');
end $$;
rollback to stale_bus;
release stale_bus;

-- Given a no-trip staff rider; When bound in each direction; Then staff assignment follows the committed binding.
savepoint staff_assign;
do $$ begin
  perform public.set_bus_binding(220000003, 'up', pg_temp.binding_intent(220000003, 'up', 'fixed', '{"fixed_ids":["f4000000-0000-4000-8000-000000000003"]}'));
  perform public.set_bus_binding(220000003, 'down', pg_temp.binding_intent(220000003, 'down', 'driver', '{"driver_id":"f4000000-0000-4000-8000-000000000003"}'));
  perform pg_temp.assert_binding((select assigned_up_bus_id = 220000003 and assigned_down_bus_id = 220000003 from public.registrations where id = 'f4000000-0000-4000-8000-000000000003'), 'both staff directions synchronized without trips');
end $$;
rollback to staff_assign;
release staff_assign;

-- Given both roles retain the same staff rider; When only fixed is removed; Then its driver and assignment remain.
savepoint staff_fixed_off;
select public.set_leader_binding('f4000000-0000-4000-8000-000000000003', 'driver', 'assign', 'up', 220000003);
select public.set_leader_binding('f4000000-0000-4000-8000-000000000003', 'fixed', 'assign', 'up', 220000003);
do $$ begin
  perform public.set_bus_binding(220000003, 'up', pg_temp.binding_intent(220000003, 'up', 'fixed', '{"fixed_ids":[]}'));
  perform pg_temp.assert_binding((select assigned_up_bus_id = 220000003 from public.registrations where id = 'f4000000-0000-4000-8000-000000000003'), 'fixed-off retains driver assignment');
end $$;
rollback to staff_fixed_off;
release staff_fixed_off;

-- Given both staff roles; When only driver is removed; Then fixed retains the assignment; removing its last role clears it.
savepoint staff_driver_off;
select public.set_leader_binding('f4000000-0000-4000-8000-000000000003', 'driver', 'assign', 'up', 220000003);
select public.set_leader_binding('f4000000-0000-4000-8000-000000000003', 'fixed', 'assign', 'up', 220000003);
do $$ begin
  perform public.set_bus_binding(220000003, 'up', pg_temp.binding_intent(220000003, 'up', 'driver', '{"driver_id":null}'));
  perform pg_temp.assert_binding((select assigned_up_bus_id = 220000003 from public.registrations where id = 'f4000000-0000-4000-8000-000000000003'), 'driver-off retains fixed assignment');
end $$;
do $$ begin
  perform public.set_leader_binding('f4000000-0000-4000-8000-000000000003', 'fixed', 'disable');
  perform pg_temp.assert_binding((select assigned_up_bus_id is null from public.registrations where id = 'f4000000-0000-4000-8000-000000000003'), 'last role off clears staff assignment');
end $$;
rollback to staff_driver_off;
release staff_driver_off;

-- Given a staff driver's fixed role moves elsewhere; When the other-kind staff anchor remains; Then the current staff assignment and explicit anchor remain.
savepoint staff_other_anchor;
select public.set_leader_binding('f4000000-0000-4000-8000-000000000006', 'driver', 'assign', 'up', 220000003);
select public.set_leader_binding('f4000000-0000-4000-8000-000000000006', 'fixed', 'assign', 'up', 220000003);
do $$ begin
  perform public.set_bus_binding(220000001, 'up', pg_temp.binding_intent(220000001, 'up', 'fixed', '{"fixed_ids":["f4000000-0000-4000-8000-000000000002","f4000000-0000-4000-8000-000000000006"]}'));
  perform pg_temp.assert_binding((select assigned_up_bus_id = 220000003 from public.registrations where id = 'f4000000-0000-4000-8000-000000000006'), 'other-kind staff anchor retains current assignment after fixed move');
  perform pg_temp.assert_binding((select driver_registration_id = 'f4000000-0000-4000-8000-000000000006' and cardinality(fixed_passenger_ids) = 0 from public.buses where id = 220000003), 'same-kind move preserves other-kind staff anchor');
end $$;
rollback to staff_other_anchor;
release staff_other_anchor;

-- Given a driver also present in the fixed array; When one more fixed rider fills its last seat; Then each person counts once and the next rider is rejected.
savepoint distinct_capacity;
update public.buses set fixed_passenger_ids = array['f4000000-0000-4000-8000-000000000001'::uuid, 'f4000000-0000-4000-8000-000000000002'::uuid] where id = 220000001;
do $$ begin
  perform public.set_bus_binding(220000001, 'up', pg_temp.binding_intent(220000001, 'up', 'fixed', '{"fixed_ids":["f4000000-0000-4000-8000-000000000001","f4000000-0000-4000-8000-000000000002","f4000000-0000-4000-8000-000000000006"]}'));
  perform pg_temp.assert_binding((select cardinality(fixed_passenger_ids) = 3 from public.buses where id = 220000001), 'driver plus fixed uses one seat');
end $$;
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  begin perform public.set_bus_binding(220000001, 'up', pg_temp.binding_intent(220000001, 'up', 'fixed', '{"fixed_ids":["f4000000-0000-4000-8000-000000000001","f4000000-0000-4000-8000-000000000002","f4000000-0000-4000-8000-000000000006","f4000000-0000-4000-8000-000000000007"]}')); raise exception 'Expected capacity rejection' using errcode = 'P9009'; exception when raise_exception then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'over-capacity addition rolls back');
end $$;
rollback to distinct_capacity;
release distinct_capacity;

-- Given removing the old staff driver precedes a failed new assignment; When synchronization raises; Then replacement, source move, assignments, audit and revision all roll back.
savepoint staff_replace_failure;
select public.set_leader_binding('f4000000-0000-4000-8000-000000000003', 'driver', 'assign', 'up', 220000003);
select public.set_leader_binding('f4000000-0000-4000-8000-000000000006', 'driver', 'assign', 'up', 220000002);
select set_config('test.bus_staff_failure', 'on', true);
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  begin perform public.set_bus_binding(220000003, 'up', pg_temp.binding_intent(220000003, 'up', 'driver', '{"driver_id":"f4000000-0000-4000-8000-000000000006"}')); raise exception 'Expected staff failure' using errcode = 'P9009'; exception when sqlstate 'P9001' then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'staff driver replacement is fully atomic');
end $$;
rollback to staff_replace_failure;
release staff_replace_failure;

-- Given old fixed removal succeeds but new staff assignment fails; When the array is replaced; Then the whole old array and assignments survive.
savepoint staff_fixed_failure;
select public.set_leader_binding('f4000000-0000-4000-8000-000000000003', 'fixed', 'assign', 'up', 220000003);
select set_config('test.bus_staff_failure', 'on', true);
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  begin perform public.set_bus_binding(220000003, 'up', pg_temp.binding_intent(220000003, 'up', 'fixed', '{"fixed_ids":["f4000000-0000-4000-8000-000000000006"]}')); raise exception 'Expected staff failure' using errcode = 'P9009'; exception when sqlstate 'P9001' then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'fixed replacement rolls back removal and staff sync');
end $$;
rollback to staff_fixed_failure;
release staff_fixed_failure;

-- Given a new rider with a different trip; When replacing fixed riders; Then both old binding and assignments roll back.
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  begin perform public.set_bus_binding(220000001, 'up', pg_temp.binding_intent(220000001, 'up', 'fixed', '{"fixed_ids":["f4000000-0000-4000-8000-000000000005"]}')); raise exception 'Expected trip rejection' using errcode = 'P9009'; exception when raise_exception then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'trip mismatch is atomic');
end $$;

-- Given a cancelled registration; When either surface tries to bind it; Then no binding or assignment is restored.
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  begin perform public.set_leader_binding('f4000000-0000-4000-8000-000000000004', 'fixed', 'assign', 'up', 220000001); raise exception 'Expected cancelled rejection' using errcode = 'P9009'; exception when raise_exception then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'person surface rejects cancelled rider');
end $$;
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  begin perform public.set_bus_binding(220000001, 'up', pg_temp.binding_intent(220000001, 'up', 'driver', '{"driver_id":"f4000000-0000-4000-8000-000000000004"}')); raise exception 'Expected cancelled rejection' using errcode = 'P9009'; exception when raise_exception then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'bus surface cancelled replacement retains prior driver');
end $$;

-- Given an authenticated caller without the master role; When calling the RPC; Then the DB role guard rejects it.
savepoint nonmaster;
select set_config('request.jwt.claims', '{"sub":"f5000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  begin perform public.set_bus_binding(220000001, 'up', '{}'); raise exception 'Expected master-only rejection' using errcode = 'P9009'; exception when insufficient_privilege then null; end;
end $$;
rollback to nonmaster;
release nonmaster;

-- Given a closed event; When a correctly scoped master saves; Then the event gate rejects the write.
savepoint closed_event;
reset role;
update public.events set unlock_until = null where id = 'f3000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  begin perform public.set_bus_binding(220000001, 'up', pg_temp.binding_intent(220000001, 'up', 'driver', '{"driver_id":null}')); raise exception 'Expected closed-event rejection' using errcode = 'P9009'; exception when insufficient_privilege then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'closed event remains unchanged');
end $$;
rollback to closed_event;
release closed_event;

-- Given the request views a different event; When saving the hidden target bus; Then event-scoped RLS prevents any mutation.
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  perform set_config('request.headers', jsonb_build_object('x-carbus-event', public.active_event_id())::text, true);
  begin perform public.set_bus_binding(220000001, 'up', '{"kind":"driver","expected_driver_id":"f4000000-0000-4000-8000-000000000001","expected_fixed_ids":["f4000000-0000-4000-8000-000000000002"],"driver_id":null}'); raise exception 'Expected event-scope rejection' using errcode = 'P9009'; exception when raise_exception then null; end;
  perform set_config('request.headers', '{"x-carbus-event":"f3000000-0000-4000-8000-000000000001"}', true);
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'wrong viewing event preserves hidden target');
end $$;

-- Given a malformed array at the JSON boundary; When fixed saving is requested; Then it fails before removing the current binding.
do $$ declare v_before jsonb := pg_temp.binding_snapshot(); begin
  begin perform public.set_bus_binding(220000001, 'up', pg_temp.binding_intent(220000001, 'up', 'fixed', '{"fixed_ids":[null]}')); raise exception 'Expected invalid-input rejection' using errcode = 'P9009'; exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_binding(pg_temp.binding_snapshot() = v_before, 'invalid JSON intent preserves existing bindings');
end $$;

-- Given an anonymous caller; When using the new RPC; Then execution is denied without extra public grants.
set local role anon;
do $$ begin
  begin perform public.set_bus_binding(220000001, 'up', '{}'); raise exception 'Expected permission rejection' using errcode = 'P9009'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'PASS: atomic bus binding local SQL tests; all fixtures and triggers rolled back'
