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

-- Given late-stage failures; When save runs; Then assignments, audit, revision, history and timestamp all roll back.
savepoint late_failure;
do $$
declare v_stage text; v_regs jsonb; v_audit bigint; v_revision text; v_history bigint; v_last timestamptz;
begin
  select jsonb_agg(to_jsonb(r) order by id) into v_regs from public.registrations r;
  select count(*) into v_audit from public.registration_audit;
  select count(*) into v_history from public.batch_runs;
  select last_batch_at into v_last from public.system_config where id = 1;
  v_revision := public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision';
  foreach v_stage in array array['history', 'timestamp'] loop
    perform set_config('test.atomic_failure', v_stage, true);
    begin
      perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision, pg_temp.atomic_payload(), pg_temp.atomic_order(), '{}', 1);
      raise exception 'Expected late-stage failure';
    exception when sqlstate 'P9001' then null; end;
    perform pg_temp.assert_atomic(v_regs = (select jsonb_agg(to_jsonb(r) order by id) from public.registrations r), v_stage || ' registration rollback');
    perform pg_temp.assert_atomic(v_audit = (select count(*) from public.registration_audit), v_stage || ' audit rollback');
    perform pg_temp.assert_atomic(v_history = (select count(*) from public.batch_runs), v_stage || ' history rollback');
    perform pg_temp.assert_atomic(v_last is not distinct from (select last_batch_at from public.system_config where id = 1), v_stage || ' timestamp rollback');
    perform pg_temp.assert_atomic(v_revision = public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision', v_stage || ' revision rollback');
  end loop;
end $$;
rollback to late_failure;
release late_failure;

-- Given changed batch inputs; When an old revision saves; Then it changes no assignments/history.
savepoint stale_revision;
do $$
declare v_revision text; v_history bigint; v_regs jsonb; v_sql text;
begin
  foreach v_sql in array array[
    'update public.registrations set name = name || '' changed'' where id = ''f2000000-0000-4000-8000-000000000002''',
    'update public.buses set fill_priority = fill_priority + 1 where id = 210000002',
    'update public.event_trips set label = label || '' changed'' where id = 30001'] loop
    v_revision := public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision';
    execute v_sql;
    select jsonb_agg(to_jsonb(r) order by id) into v_regs from public.registrations r;
    select count(*) into v_history from public.batch_runs;
    begin
      perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision, pg_temp.atomic_payload(), pg_temp.atomic_order(), '{}', 1);
      raise exception 'Expected stale revision rejection';
    exception when serialization_failure then null; end;
    perform pg_temp.assert_atomic(v_regs = (select jsonb_agg(to_jsonb(r) order by id) from public.registrations r), 'stale revision no assignment writes');
    perform pg_temp.assert_atomic(v_history = (select count(*) from public.batch_runs), 'stale revision no history writes');
  end loop;
end $$;
rollback to stale_revision;
release stale_revision;

-- Given valid assignments with engine warnings; When save succeeds; Then history/stats/timestamp and one direction agree.
savepoint success;
do $$
declare v_revision text; v_last timestamptz; v_history public.batch_runs%rowtype;
begin
  v_revision := public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision';
  select last_batch_at into v_last from public.system_config where id = 1;
  perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision, pg_temp.atomic_payload(), pg_temp.atomic_order(), array['fixture warning'], 1);
  select * into v_history from public.batch_runs where event_id = 'f1000000-0000-4000-8000-000000000001';
  perform pg_temp.assert_atomic(not v_history.success and v_history.total_assigned = 3 and v_history.by_bus = '{"210000001":1,"210000002":1,"210000003":1}'::jsonb and v_history.empty_seats = '3'::jsonb, 'partial result history stats');
  perform pg_temp.assert_atomic((select assigned_up_bus_id = 210000002 and assigned_down_bus_id = 210000001 from public.registrations where id = 'f2000000-0000-4000-8000-000000000002'), 'only requested direction saves');
  perform pg_temp.assert_atomic((select assigned_up_bus_id is null from public.registrations where id = 'f2000000-0000-4000-8000-000000000005'), 'stale regular assignment clears');
  perform pg_temp.assert_atomic((select assigned_up_bus_id = 210000003 from public.registrations where id = 'f2000000-0000-4000-8000-000000000003'), 'stale staff assignment retained');
  perform pg_temp.assert_atomic(v_last is distinct from (select last_batch_at from public.system_config where id = 1), 'timestamp saved');
end $$;
rollback to success;
release success;

-- Given forged inputs; When save validates; Then all failures happen before writes.
savepoint invalid_payload;
do $$
declare v_payload jsonb; v_revision text; v_regs jsonb;
begin
  v_revision := public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision';
  select jsonb_agg(to_jsonb(r) order by id) into v_regs from public.registrations r;
  foreach v_payload in array array[
    null::jsonb, '[]'::jsonb, '{"bad-uuid":null}'::jsonb,
    pg_temp.atomic_payload() || '{"f2000000-0000-4000-8000-000000000004":210000002}'::jsonb,
    pg_temp.atomic_payload() || '{"f2000000-0000-4000-8000-000000000002":210000003}'::jsonb,
    pg_temp.atomic_payload() || '{"f2000000-0000-4000-8000-000000000001":210000002}'::jsonb,
    pg_temp.atomic_payload() || '{"f2000000-0000-4000-8000-000000000002":1.1}'::jsonb,
    pg_temp.atomic_payload() || '{"f2000000-0000-4000-8000-000000000002":999999999}'::jsonb,
    pg_temp.atomic_payload() - 'f2000000-0000-4000-8000-000000000002'] loop
    begin
      perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision, v_payload, pg_temp.atomic_order(), '{}', 1);
      raise exception 'Expected invalid payload rejection';
    exception when sqlstate '22023' or invalid_text_representation then null; end;
    perform pg_temp.assert_atomic(v_regs = (select jsonb_agg(to_jsonb(r) order by id) from public.registrations r), 'invalid payload no writes');
  end loop;
end $$;
rollback to invalid_payload;
release invalid_payload;

-- Given duplicate anchors; When the first valid snapshot anchor wins; Then the partial result remains saveable.
savepoint duplicate_anchor;
update public.buses set driver_registration_id = 'f2000000-0000-4000-8000-000000000001' where id = 210000002;
do $$ declare v_revision text; v_first integer; v_payload jsonb; begin
  v_revision := public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision';
  select id into v_first from public.buses where id in (210000001,210000002) order by array_position(pg_temp.atomic_order(), id) limit 1;
  v_payload := pg_temp.atomic_payload() || jsonb_build_object('f2000000-0000-4000-8000-000000000001',v_first);
  perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision, v_payload, pg_temp.atomic_order(), array['duplicate anchor warning'], 1);
  perform pg_temp.assert_atomic((select assigned_up_bus_id = v_first from public.registrations where id = 'f2000000-0000-4000-8000-000000000001'), 'first duplicate anchor retained');
end $$;
rollback to duplicate_anchor;
release duplicate_anchor;

-- Given anchor overflow; When the skipped fixed rider receives a free seat elsewhere; Then the partial result keeps that seat.
savepoint overflow_anchor;
update public.buses set capacity = 1, hard_cap = 1, fixed_passenger_ids = array['f2000000-0000-4000-8000-000000000002'::uuid] where id = 210000001;
do $$ declare v_revision text; begin
  v_revision := public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision';
  perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision, pg_temp.atomic_payload(), pg_temp.atomic_order(), array['anchor overflow warning'], 1);
  perform pg_temp.assert_atomic((select assigned_up_bus_id = 210000002 from public.registrations where id = 'f2000000-0000-4000-8000-000000000002'), 'overflow anchor free placement retained');
end $$;
rollback to overflow_anchor;
release overflow_anchor;

-- Given a mismatched anchor; When the engine leaves that trip unassigned; Then the warning result saves without moving it to a wrong trip.
savepoint mismatch_anchor;
update public.buses set fixed_passenger_ids = array['f2000000-0000-4000-8000-000000000002'::uuid] where id = 210000001;
update public.registrations set up_trip_id = 30003 where id = 'f2000000-0000-4000-8000-000000000002';
do $$ declare v_revision text; begin
  v_revision := public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision';
  begin
    perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision, pg_temp.atomic_payload(), pg_temp.atomic_order(), '{}', 1);
    raise exception 'Expected slot mismatch rejection';
  exception when sqlstate '22023' then null; end;
  perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision, pg_temp.atomic_payload() || '{"f2000000-0000-4000-8000-000000000002":null}'::jsonb, pg_temp.atomic_order(), array['mismatch anchor warning'], 1);
  perform pg_temp.assert_atomic((select assigned_up_bus_id is null from public.registrations where id = 'f2000000-0000-4000-8000-000000000002'), 'mismatched anchor remains unassigned');
end $$;
rollback to mismatch_anchor;
release mismatch_anchor;

-- Given a full bus; When batch/fixed placement exceeds hard_cap; Then no placement is written.
savepoint capacity;
update public.buses set capacity = 1, hard_cap = 1 where id = 210000001;
do $$ declare v_revision text; begin
  v_revision := public.get_batch_snapshot('f1000000-0000-4000-8000-000000000001')->>'revision';
  begin
    perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', v_revision,
      pg_temp.atomic_payload() || '{"f2000000-0000-4000-8000-000000000002":210000001}'::jsonb, pg_temp.atomic_order(), '{}', 1);
    raise exception 'Expected capacity rejection';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.set_leader_binding('f2000000-0000-4000-8000-000000000002', 'fixed', 'assign', 'up', 210000001);
    raise exception 'Expected fixed capacity rejection';
  exception when raise_exception then
    if sqlerrm = 'Expected fixed capacity rejection' then raise; end if;
  end;
  perform pg_temp.assert_atomic((select cardinality(fixed_passenger_ids) = 0 from public.buses where id = 210000001), 'full fixed target unchanged');
end $$;
rollback to capacity;
release capacity;

-- Given a different requested event; When either RPC writes; Then existing event scope rejects it.
savepoint event_scope;
select set_config('request.headers', jsonb_build_object('x-carbus-event', public.active_event_id())::text, true);
do $$ begin
  begin
    perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', '0', pg_temp.atomic_payload(), '{}', '{}', 1);
    raise exception 'Expected batch event rejection';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_leader_binding('f2000000-0000-4000-8000-000000000001', 'driver', 'disable');
    raise exception 'Expected leader event rejection';
  exception when insufficient_privilege then null;
    when raise_exception then if sqlerrm = 'Expected leader event rejection' then raise; end if; end;
end $$;
rollback to event_scope;
release event_scope;

-- Given each nonmaster role; When either RPC writes; Then no new role gains permission.
savepoint permission_scope;
reset role;
do $$ declare v_role public.user_role; begin
  foreach v_role in array array['viewer','campus_admin','guest']::public.user_role[] loop
    update public.profiles set role = v_role, driver_bus_id = case when v_role = 'guest' then 210000001 end where id = auth.uid();
    execute 'set local role authenticated';
    begin
      perform public.save_batch('f1000000-0000-4000-8000-000000000001', 'up', '0', pg_temp.atomic_payload(), '{}', '{}', 1);
      raise exception 'Expected batch role rejection';
    exception when insufficient_privilege then null; end;
    begin
      perform public.set_leader_binding('f2000000-0000-4000-8000-000000000001', 'driver', 'disable');
      raise exception 'Expected leader role rejection';
    exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;
end $$;
rollback to permission_scope;
release permission_scope;
reset role;
rollback;
\echo 'PASS: atomic local DB tests; all fixtures and failure triggers rolled back'
