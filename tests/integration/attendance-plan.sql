\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='master' limit 1),'role','authenticated')::text,true);
select set_config('request.headers','{"x-carbus-event":"f5000000-0000-4000-8000-000000000001"}',true);
insert into public.events(id,name,starts_on,ends_on,unlock_until) values ('f5000000-0000-4000-8000-000000000001','Attendance plan fixture','2026-10-10','2026-10-12',now()+interval '1 hour');
insert into public.event_trips(id,event_id,key,label,direction) overriding system value values
(32001,'f5000000-0000-4000-8000-000000000001','plan-up','Plan up','up'),
(32002,'f5000000-0000-4000-8000-000000000001','plan-down','Plan down','down');
insert into public.org_units(id,name,kind) values ('f6000000-0000-4000-8000-000000000001','Plan district','district');
select not exists(select 1 from information_schema.columns where table_schema='public' and table_name='registrations' and column_name='attend_from_at') as plan_uninstalled \gset
\if :plan_uninstalled
-- Given a genuine pre-migration date-only one-way row; install within this rollback transaction.
insert into public.registrations(id,event_id,campus_id,name,student_id,up_trip_id,down_trip_id,attend_from,attend_to)
values ('f7000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',(select id from public.campuses limit 1),'Legacy plan fixture','26',32001,null,'2026-10-11','2026-10-12');
\ir ../../supabase/migrations/20261007120000_confirmed_attendance_plan.sql
\else
-- A rerun still checks unrelated edits to a timestamp-free full-event row.
insert into public.registrations(id,event_id,campus_id,name,student_id,up_trip_id,down_trip_id)
values ('f7000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',(select id from public.campuses limit 1),'Legacy plan fixture','26',32001,32002);
\endif
create function pg_temp.assert_plan(p_ok boolean,p_reason text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %',p_reason; end if; end $$;
create function pg_temp.plan_payload() returns jsonb language sql as $$
select jsonb_build_object('name','Plan person '||gen_random_uuid(),'student_id','26','campus_id',(select id from public.campuses limit 1),
'up_trip_id',32001,'down_trip_id',32002,'payment_status','unpaid','note',null,'attend_from',null,'attend_to',null,
'attend_from_at',null,'attend_to_at',null,'legs','[]'::jsonb,'pickups','[]'::jsonb,'courses','[]'::jsonb) $$;
set local role authenticated;

-- Given legacy input without planned times; When an unrelated field changes; Then no backfill is required.
update public.registrations set name='Legacy renamed',note='Legacy note' where id='f7000000-0000-4000-8000-000000000001';
set constraints all immediate;
select pg_temp.assert_plan((select attend_from_at is null and attend_to_at is null and note='Legacy note' from public.registrations where id='f7000000-0000-4000-8000-000000000001'),'legacy unrelated edit keeps unknown old times');
set constraints all deferred;

-- Given full-event roundtrip input; When created; Then optional times remain NULL.
do $$ declare v_id uuid; begin
v_id:=public.create_registration_complete('f5000000-0000-4000-8000-000000000001',pg_temp.plan_payload());
set constraints all immediate;
perform pg_temp.assert_plan((select attend_from_at is null and attend_to_at is null and up_trip_id=32001 and down_trip_id=32002 from public.registrations where id=v_id),'full roundtrip remains valid');
set constraints all deferred;
end $$;

-- Given explicit self transport with a complete pair; When created; Then dates remain NULL=full event and KST times store UTC.
do $$ declare v_id uuid; begin
v_id:=public.create_registration_complete('f5000000-0000-4000-8000-000000000001',pg_temp.plan_payload() ||
'{"down_trip_id":null,"attend_from_at":"2026-10-10T09:30:00+09:00","attend_to_at":"2026-10-12T19:40:00+09:00","legs":[{"direction":"down","mode":"own_car","via_unit_id":null,"status":"confirmed"}]}'::jsonb);
set constraints all immediate;
perform pg_temp.assert_plan((select attend_from is null and attend_to is null and attend_from_at='2026-10-10T00:30:00Z' and attend_to_at='2026-10-12T10:40:00Z' from public.registrations where id=v_id),'full event one-way preserves dates and KST');
set constraints all deferred;
end $$;

-- Given complete partial dates and UTC instants crossing midnight; When created; Then KST date consistency succeeds.
do $$ begin
perform public.create_registration_complete('f5000000-0000-4000-8000-000000000001',pg_temp.plan_payload() ||
'{"attend_from":"2026-10-10","attend_to":"2026-10-11","attend_from_at":"2026-10-09T15:30:00Z","attend_to_at":"2026-10-10T17:00:00Z"}'::jsonb);
set constraints all immediate;
set constraints all deferred;
end $$;

-- Given incomplete or inconsistent new API schedules; When created; Then each entire transaction fails.
do $$ declare v_patch jsonb; v_before bigint; begin
select count(*) into v_before from public.registrations;
foreach v_patch in array array[
  '{"down_trip_id":null,"note":"자차로 귀가"}'::jsonb,
  '{"down_trip_id":null,"attend_from_at":"2026-10-10T09:30:00+09:00","attend_to_at":"2026-10-12T19:40:00+09:00"}'::jsonb,
  '{"attend_from":"2026-10-10","attend_to":"2026-10-12"}'::jsonb,
  '{"attend_from_at":"2026-10-10","attend_to_at":"2026-10-12T19:40:00+09:00"}'::jsonb,
  '{"attend_from_at":"2026-10-10T09:30:00+09:00"}'::jsonb,
  '{"attend_from_at":"2026-10-12T19:40:00+09:00","attend_to_at":"2026-10-10T09:30:00+09:00"}'::jsonb,
  '{"attend_from":"2026-10-11","attend_to":"2026-10-12","attend_from_at":"2026-10-10T09:30:00+09:00","attend_to_at":"2026-10-12T19:40:00+09:00"}'::jsonb,
  '{"attend_from":"2026-10-10","attend_from_at":"2026-10-10T09:30:00+09:00","attend_to_at":"2026-10-12T19:40:00+09:00"}'::jsonb,
  '{"legs":[{"direction":"up","mode":"other_district","via_unit_id":"f6000000-0000-4000-8000-000000000001","status":"pending"}]}'::jsonb,
  '{"down_trip_id":null,"legs":[{"direction":"down","mode":"our_bus","via_unit_id":null,"status":"confirmed"}]}'::jsonb
] loop
  begin
    perform public.create_registration_complete('f5000000-0000-4000-8000-000000000001',pg_temp.plan_payload() || v_patch);
    set constraints all immediate;
    raise exception 'Expected rejected schedule: %',v_patch;
  exception when check_violation or sqlstate '22023' then null;
  end;
  set constraints all deferred;
  perform pg_temp.assert_plan(v_before=(select count(*) from public.registrations),'invalid API schedule rollback');
end loop;
end $$;

-- Given direct INSERT and UPDATE rather than the create RPC; When schedule/travel is incomplete; Then the final DB boundary rejects it.
do $$ declare v_id uuid; begin
begin
  insert into public.registrations(event_id,campus_id,name,student_id,up_trip_id,down_trip_id)
  values ('f5000000-0000-4000-8000-000000000001',(select id from public.campuses limit 1),'Direct invalid','26',32001,null);
  set constraints all immediate;
  raise exception 'Expected direct insert rejection';
exception when check_violation then null; end;
set constraints all deferred;
v_id:=public.create_registration_complete('f5000000-0000-4000-8000-000000000001',pg_temp.plan_payload());
set constraints all immediate;
set constraints all deferred;
begin
  update public.registrations set attend_from_at='infinity',attend_to_at='infinity' where id=v_id;
  set constraints all immediate;
  raise exception 'Expected infinite direct timestamp rejection';
exception when check_violation then null; end;
set constraints all deferred;
begin
  insert into public.transport_legs(event_id,registration_id,direction,mode,status)
  values ('f5000000-0000-4000-8000-000000000001',v_id,'down','own_car','confirmed');
  set constraints all immediate;
  raise exception 'Expected direct travel change rejection';
exception when check_violation then null; end;
set constraints all deferred;
perform pg_temp.assert_plan((select down_trip_id=32002 and attend_from_at is null from public.registrations where id=v_id),'rejected travel and timestamp edits leave registration intact');
end $$;
reset role;
rollback;
\echo 'PASS: planned dates/times, explicit directional modes, legacy preservation, KST conversion and direct/API rejection; fixtures rolled back'
