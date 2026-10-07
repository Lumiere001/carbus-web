\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from public.profiles where role = 'master' limit 1), 'role', 'authenticated')::text, true);
select set_config('request.headers', '{"x-carbus-event":"f1000000-0000-4000-8000-000000000001"}', true);
insert into public.events(id, name, unlock_until) values ('f1000000-0000-4000-8000-000000000001', 'Atomic SQL fixture', now() + interval '1 hour');
insert into public.event_trips(id, event_id, key, label, direction) overriding system value values
(30001, 'f1000000-0000-4000-8000-000000000001', 'atomic-up', 'Atomic up', 'up'),
(30002, 'f1000000-0000-4000-8000-000000000001', 'atomic-down', 'Atomic down', 'down'),
(30003, 'f1000000-0000-4000-8000-000000000001', 'atomic-other', 'Atomic other', 'up');
insert into public.buses(id, event_id, name, capacity, hard_cap, up_trip_id, down_trip_id, kind) values
(210000001, 'f1000000-0000-4000-8000-000000000001', 'Atomic first', 2, 2, 30001, 30002, 'bus'),
(210000002, 'f1000000-0000-4000-8000-000000000001', 'Atomic second', 2, 2, 30001, 30002, 'bus'),
(210000003, 'f1000000-0000-4000-8000-000000000001', 'Atomic staff', 2, 2, 30001, 30002, 'staff_car');
insert into public.registrations(id, event_id, name, student_id, campus_id, up_trip_id, down_trip_id, assigned_up_bus_id, assigned_down_bus_id)
select ('f2000000-0000-4000-8000-00000000000' || n)::uuid, 'f1000000-0000-4000-8000-000000000001',
  'Atomic person ' || n, '26', (select id from public.campuses limit 1),
  case when n in (1,2,4) then 30001 end, case when n in (1,2,4) then 30002 end,
  case when n in (1,2,5) then 210000001 when n = 3 then 210000003 end,
  case when n in (1,2,5) then 210000001 when n = 3 then 210000003 end
from generate_series(1,6) n;
update public.registrations set participation_status = 'cancelled' where id = 'f2000000-0000-4000-8000-000000000004';
update public.buses set driver_registration_id = 'f2000000-0000-4000-8000-000000000001', down_driver_registration_id = 'f2000000-0000-4000-8000-000000000001' where id = 210000001;
update public.buses set fixed_passenger_ids = array['f2000000-0000-4000-8000-000000000006'::uuid], down_fixed_passenger_ids = array['f2000000-0000-4000-8000-000000000006'::uuid] where id = 210000003;

create function pg_temp.assert_atomic(p_ok boolean, p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %', p_message; end if; end $$;
create function pg_temp.atomic_failure() returns trigger language plpgsql as $$
declare v_stage text := current_setting('test.atomic_failure', true);
begin
  if (v_stage = 'history' and tg_table_name = 'batch_runs')
     or (v_stage = 'timestamp' and tg_table_name = 'system_config') then
    raise exception 'Injected % failure', v_stage using errcode = 'P9001';
  end if;
  if v_stage = 'leader_down' and tg_table_name = 'buses' then
    if new.down_driver_registration_id is distinct from old.down_driver_registration_id then
      raise exception 'Injected down failure' using errcode = 'P9001';
    end if;
  end if;
  if v_stage = 'staff_sync' and tg_table_name = 'registrations' then
    if new.assigned_up_bus_id = 210000003 and new.assigned_up_bus_id is distinct from old.assigned_up_bus_id then
      raise exception 'Injected staff sync failure' using errcode = 'P9001';
    end if;
  end if;
  return new;
end $$;
create trigger test_atomic_history after insert on public.batch_runs for each row execute function pg_temp.atomic_failure();
create trigger test_atomic_timestamp after update on public.system_config for each row execute function pg_temp.atomic_failure();
create trigger test_atomic_down after update on public.buses for each row execute function pg_temp.atomic_failure();
create trigger test_atomic_staff before update on public.registrations for each row execute function pg_temp.atomic_failure();
create function pg_temp.atomic_order() returns integer[] language sql as $$ select array(select (value ->> 'id')::integer from jsonb_array_elements(public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->'buses')) $$;
create function pg_temp.atomic_payload() returns jsonb language sql as $$ select '{"f2000000-0000-4000-8000-000000000001":210000001,"f2000000-0000-4000-8000-000000000002":210000002,"f2000000-0000-4000-8000-000000000006":210000003}'::jsonb $$;
set local role authenticated;

-- Given a target driver conflict in the second direction; When toggle runs; Then the first direction remains bound to its old bus.
savepoint leader_conflict;
update public.registrations set assigned_up_bus_id = 210000002, assigned_down_bus_id = 210000002 where id = 'f2000000-0000-4000-8000-000000000001';
update public.buses set down_driver_registration_id = 'f2000000-0000-4000-8000-000000000002' where id = 210000002;
do $$ begin
  begin
    perform public.set_leader_binding('f2000000-0000-4000-8000-000000000001', 'driver', 'enable');
    raise exception 'Expected occupied driver rejection';
  exception when raise_exception then
    if sqlerrm = 'Expected occupied driver rejection' then raise; end if;
  end;
  perform pg_temp.assert_atomic((select driver_registration_id = 'f2000000-0000-4000-8000-000000000001' from public.buses where id = 210000001), 'first direction driver rollback');
  perform pg_temp.assert_atomic((select driver_registration_id is null from public.buses where id = 210000002), 'new target driver rollback');
end $$;
rollback to leader_conflict;
release leader_conflict;

-- Given a second-direction injected failure; When role toggles; Then both bindings roll back.
savepoint leader_down;
update public.registrations set assigned_up_bus_id = 210000002, assigned_down_bus_id = 210000002 where id = 'f2000000-0000-4000-8000-000000000001';
select set_config('test.atomic_failure', 'leader_down', true);
do $$ begin
  begin
    perform public.set_leader_binding('f2000000-0000-4000-8000-000000000001', 'driver', 'enable');
    raise exception 'Expected second-direction failure';
  exception when sqlstate 'P9001' then null; end;
  perform pg_temp.assert_atomic((select driver_registration_id = 'f2000000-0000-4000-8000-000000000001' and down_driver_registration_id = 'f2000000-0000-4000-8000-000000000001' from public.buses where id = 210000001), 'both old bindings retained');
  perform pg_temp.assert_atomic((select driver_registration_id is null and down_driver_registration_id is null from public.buses where id = 210000002), 'both new bindings absent');
end $$;
rollback to leader_down;
release leader_down;

-- Given an assignment failure after staff-car binding; When a fixed rider moves; Then the binding and prior assignment roll back.
savepoint staff_sync;
update public.buses set fixed_passenger_ids = array['f2000000-0000-4000-8000-000000000002'::uuid] where id = 210000001;
select set_config('test.atomic_failure', 'staff_sync', true);
do $$ begin
  begin
    perform public.set_leader_binding('f2000000-0000-4000-8000-000000000002', 'fixed', 'assign', 'up', 210000003);
    raise exception 'Expected staff synchronization failure';
  exception when sqlstate 'P9001' then null; end;
  perform pg_temp.assert_atomic((select 'f2000000-0000-4000-8000-000000000002'::uuid = any(fixed_passenger_ids) from public.buses where id = 210000001), 'old fixed binding retained');
  perform pg_temp.assert_atomic((select not 'f2000000-0000-4000-8000-000000000002'::uuid = any(fixed_passenger_ids) from public.buses where id = 210000003), 'staff binding rolled back');
  perform pg_temp.assert_atomic((select assigned_up_bus_id = 210000001 from public.registrations where id = 'f2000000-0000-4000-8000-000000000002'), 'prior assignment retained');
end $$;
rollback to staff_sync;
release staff_sync;

-- Given a no-trip staff rider; When fixed assignment succeeds then clears; Then staff synchronization preserves ordinary bus assignments.
savepoint leader_success;
do $$ begin
  perform public.set_leader_binding('f2000000-0000-4000-8000-000000000006', 'fixed', 'assign', 'up', 210000003);
  perform pg_temp.assert_atomic((select assigned_up_bus_id = 210000003 from public.registrations where id = 'f2000000-0000-4000-8000-000000000006'), 'staff assign sync');
  perform public.set_leader_binding('f2000000-0000-4000-8000-000000000006', 'fixed', 'disable');
  perform pg_temp.assert_atomic((select assigned_up_bus_id is null from public.registrations where id = 'f2000000-0000-4000-8000-000000000006'), 'staff clear sync');
  perform public.set_leader_binding('f2000000-0000-4000-8000-000000000001', 'driver', 'disable');
  perform pg_temp.assert_atomic((select assigned_up_bus_id = 210000001 and assigned_down_bus_id = 210000001 from public.registrations where id = 'f2000000-0000-4000-8000-000000000001'), 'ordinary assignments retained');
end $$;
rollback to leader_success;
release leader_success;
reset role;
rollback;
\echo 'PASS: atomic leader local DB tests; all fixtures and failure triggers rolled back'
