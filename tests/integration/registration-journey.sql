\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='master' limit 1),'role','authenticated')::text,true);
select set_config('request.headers','{"x-carbus-event":"f8000000-0000-4000-8000-000000000001"}',true);
insert into public.events(id,name,starts_on,ends_on,unlock_until) values ('f8000000-0000-4000-8000-000000000001','Atomic journey fixture','2026-10-10','2026-10-12',now()+interval '1 hour');
insert into public.event_trips(id,event_id,key,label,direction) overriding system value values
(32501,'f8000000-0000-4000-8000-000000000001','journey-up','Journey up','up'),
(32502,'f8000000-0000-4000-8000-000000000001','journey-down','Journey down','down');
insert into public.buses(id,event_id,name,capacity,hard_cap,up_trip_id,down_trip_id) overriding system value values
(325000001,'f8000000-0000-4000-8000-000000000001','Journey bus',40,45,32501,32502);
insert into public.org_units(id,name,kind) values ('f9000000-0000-4000-8000-000000000001','Journey district','district');
select not exists(select 1 from pg_proc where proname='save_registration_journey') as journey_uninstalled \gset
\if :journey_uninstalled
\ir ../../supabase/migrations/20261007130000_atomic_registration_journey.sql
\endif
create function pg_temp.assert_journey(p_ok boolean,p_reason text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %',p_reason; end if; end $$;
create function pg_temp.journey_snapshot(p_id uuid) returns jsonb language sql as $$
select jsonb_build_object('version',r.version,'attend_from',r.attend_from,'attend_to',r.attend_to,'attend_from_at',r.attend_from_at,'attend_to_at',r.attend_to_at,
'up_trip_id',r.up_trip_id,'down_trip_id',r.down_trip_id,'legs',coalesce((select jsonb_agg(jsonb_build_object('direction',direction,'mode',mode,'via_unit_id',via_unit_id,'status',status) order by direction) from public.transport_legs where registration_id=r.id),'[]'::jsonb))
from public.registrations r where id=p_id $$;
create function pg_temp.journey_input() returns jsonb language sql as $$
select '{"attend_from":"2026-10-10","attend_to":"2026-10-12","attend_from_at":"2026-10-10T09:30:00+09:00","attend_to_at":"2026-10-12T19:40:00+09:00","up_trip_id":32501,"down_trip_id":null,"legs":[{"direction":"down","mode":"own_car","via_unit_id":null,"status":"confirmed"}]}'::jsonb $$;
create function pg_temp.make_journey() returns uuid language sql as $$
insert into public.registrations(event_id,campus_id,name,student_id,up_trip_id,down_trip_id,payment_status,roles)
values ('f8000000-0000-4000-8000-000000000001',(select id from public.campuses limit 1),'Journey person '||gen_random_uuid(),'26',32501,32502,'paid','{}') returning id $$;
-- Seed one genuine pre-migration shape only during setup, then restore every constraint before testing.
-- New application writes and every assertion below run with the ALWAYS trigger enabled.
alter table public.registrations disable trigger trg_registration_attendance_plan;
insert into public.registrations(id,event_id,campus_id,name,student_id,up_trip_id,down_trip_id,payment_status,attend_from,attend_to)
values ('fa000000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000001',(select id from public.campuses limit 1),'Pre-migration fixture','26',null,null,'paid','2026-10-10','2026-10-12');
alter table public.registrations enable always trigger trg_registration_attendance_plan;
set local role authenticated;

-- Given a date-only legacy row lacking both planned times and explicit modes; When repaired together; Then no intermediate invalid transaction is required.
do $$ declare v_id uuid := 'fa000000-0000-4000-8000-000000000001'; begin
perform pg_temp.assert_journey((select up_trip_id is null and down_trip_id is null and attend_from_at is null from public.registrations where id=v_id),'genuine pre-migration fixture missing plan and modes');
perform public.save_registration_journey(v_id,pg_temp.journey_snapshot(v_id),pg_temp.journey_input());
set constraints all immediate;
perform pg_temp.assert_journey((select up_trip_id=32501 and down_trip_id is null and attend_from='2026-10-10' and attend_from_at='2026-10-10T00:30:00Z' and fee=0 from public.registrations where id=v_id),'atomic repair saves plan/travel and retains paid fee');
perform pg_temp.assert_journey((select mode='own_car' from public.transport_legs where registration_id=v_id and direction='down'),'explicit nonbus repair');
set constraints all deferred;
end $$;

-- Given a observed parent/leg state; When parent or a pending leg changes; Then stale saves conflict without overwrite.
do $$ declare v_id uuid; v_expected jsonb; begin
v_id:=pg_temp.make_journey();
set constraints all immediate;
set constraints all deferred;
v_expected:=pg_temp.journey_snapshot(v_id);
update public.registrations set note='Other editor note' where id=v_id;
begin
  perform public.save_registration_journey(v_id,v_expected,pg_temp.journey_input());
  raise exception 'Expected parent conflict';
exception when serialization_failure then null; end;
perform public.save_registration_journey(v_id,pg_temp.journey_snapshot(v_id),pg_temp.journey_input() ||
'{"down_trip_id":32502,"legs":[{"direction":"up","mode":"other_district","status":"pending","via_unit_id":"f9000000-0000-4000-8000-000000000001"}]}'::jsonb);
set constraints all immediate;
set constraints all deferred;
v_expected:=pg_temp.journey_snapshot(v_id);
insert into public.transport_legs(event_id,registration_id,direction,mode,status) values ('f8000000-0000-4000-8000-000000000001',v_id,'down','our_bus','confirmed');
begin
  perform public.save_registration_journey(v_id,v_expected,pg_temp.journey_input());
  raise exception 'Expected raw leg conflict';
exception when serialization_failure then null; end;
perform pg_temp.assert_journey((select note='Other editor note' and down_trip_id=32502 from public.registrations where id=v_id),'conflict retains unrelated data and trips');
end $$;

-- Given a late invalid schedule after transport changes; When saving fails; Then assignments/trips/legs/audit and revision all roll back.
do $$ declare v_id uuid; v_before jsonb; begin
v_id:=pg_temp.make_journey();
update public.registrations set assigned_down_bus_id=325000001 where id=v_id;
set constraints all immediate;
set constraints all deferred;
select jsonb_build_object('snapshot',pg_temp.journey_snapshot(v_id),'assignment',(select assigned_down_bus_id from public.registrations where id=v_id),
'audit',(select count(*) from public.registration_audit where registration_id=v_id),'revision',(select batch_revision from public.events where id='f8000000-0000-4000-8000-000000000001')) into v_before;
begin
  perform public.save_registration_journey(v_id,pg_temp.journey_snapshot(v_id),pg_temp.journey_input() || '{"attend_to_at":null}'::jsonb);
  set constraints all immediate;
  raise exception 'Expected invalid schedule rollback';
exception when check_violation then null; end;
set constraints all deferred;
perform pg_temp.assert_journey(v_before=jsonb_build_object('snapshot',pg_temp.journey_snapshot(v_id),'assignment',(select assigned_down_bus_id from public.registrations where id=v_id),
'audit',(select count(*) from public.registration_audit where registration_id=v_id),'revision',(select batch_revision from public.events where id='f8000000-0000-4000-8000-000000000001')),'late invalid complete rollback');
perform public.save_registration_journey(v_id,pg_temp.journey_snapshot(v_id),pg_temp.journey_input());
set constraints all immediate;
perform pg_temp.assert_journey((select assigned_down_bus_id is null and down_trip_id is null and fee=50000 from public.registrations where id=v_id),'explicit confirmed nonbus releases one assignment and freezes paid fee');
set constraints all deferred;
end $$;

-- Given a campus admin; When saving a known own row; Then RLS permits the atomic journey without expanding assignment authority.
savepoint journey_campus;
reset role;
select pg_temp.make_journey() as campus_journey_id \gset
update public.registrations set assigned_down_bus_id=325000001 where id=:'campus_journey_id';
select set_config('test.journey_campus_id',:'campus_journey_id',true);
update public.profiles set role='campus_admin',campus_id=(select id from public.campuses limit 1) where id=auth.uid();
set local role authenticated;
do $$ declare v_id uuid := current_setting('test.journey_campus_id')::uuid; v_result jsonb; begin
set constraints all immediate;
set constraints all deferred;
v_result:=public.save_registration_journey(v_id,pg_temp.journey_snapshot(v_id),pg_temp.journey_input() ||
'{"legs":[{"direction":"up","mode":"our_bus","via_unit_id":null,"status":"confirmed"},{"direction":"down","mode":"own_car","via_unit_id":null,"status":"confirmed"}]}'::jsonb);
set constraints all immediate;
perform pg_temp.assert_journey((select down_trip_id is null and assigned_down_bus_id is null and fee=50000 from public.registrations where id=v_id),'campus journey preserves assignment guard and paid fare');
perform pg_temp.assert_journey(v_result->'row'=(select to_jsonb(r) from public.registrations r where id=v_id)
  and v_result->'legs'=pg_temp.journey_snapshot(v_id)->'legs' and jsonb_array_length(v_result->'legs')=2,'returned row and exact explicit legs agree inside locked transaction');
set constraints all deferred;
end $$;
rollback to journey_campus;
release journey_campus;
reset role;
rollback;
\echo 'PASS: atomic legacy journey repair, parent/raw-leg CAS, late rollback, seat/paid-fare preservation and campus RLS; fixtures rolled back'
