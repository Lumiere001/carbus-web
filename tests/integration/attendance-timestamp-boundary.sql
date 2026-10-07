\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='master' limit 1),'role','authenticated')::text,true);
select set_config('request.headers','{"x-carbus-event":"fc000000-0000-4000-8000-000000000001"}',true);
insert into public.events(id,name,starts_on,ends_on,unlock_until) values ('fc000000-0000-4000-8000-000000000001','Timestamp boundary fixture','2026-10-10','2026-10-12',now()+interval '1 hour');
insert into public.event_trips(id,event_id,key,label,direction) overriding system value values
(32601,'fc000000-0000-4000-8000-000000000001','boundary-up','Boundary up','up'),
(32602,'fc000000-0000-4000-8000-000000000001','boundary-down','Boundary down','down');
select not exists(select 1 from pg_trigger where tgname='trg_reg_004_attendance_timestamp_rpc') as boundary_uninstalled \gset
\if :boundary_uninstalled
\ir ../../supabase/migrations/20261007140000_attendance_timestamp_rpc_boundary.sql
\endif
create function pg_temp.assert_boundary(p_ok boolean,p_reason text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL: %',p_reason; end if; end $$;
create function pg_temp.boundary_payload() returns jsonb language sql as $$
select jsonb_build_object('name','Boundary person '||gen_random_uuid(),'student_id','26','campus_id',(select id from public.campuses limit 1),
'up_trip_id',32601,'down_trip_id',32602,'payment_status','unpaid','note',null,'attend_from',null,'attend_to',null,
'attend_from_at','2026-10-10T00:00:00+09:00','attend_to_at','2026-10-12T19:40:00+09:00','legs','[]'::jsonb,'pickups','[]'::jsonb,'courses','[]'::jsonb) $$;
create function pg_temp.boundary_snapshot(p_id uuid) returns jsonb language sql as $$
select jsonb_build_object('version',r.version,'attend_from',r.attend_from,'attend_to',r.attend_to,'attend_from_at',r.attend_from_at,'attend_to_at',r.attend_to_at,
'up_trip_id',r.up_trip_id,'down_trip_id',r.down_trip_id,'legs','[]'::jsonb) from public.registrations r where id=p_id $$;
set local role authenticated;

-- Given an explicitly selected 00:00 KST; When the shape-validated RPC creates it; Then midnight is retained, never inferred.
do $$ declare v_id uuid; v_result jsonb; begin
v_id:=public.create_registration_complete('fc000000-0000-4000-8000-000000000001',pg_temp.boundary_payload());
set constraints all immediate;
set constraints all deferred;
perform pg_temp.assert_boundary((select attend_from_at='2026-10-09T15:00:00Z' and attend_to_at='2026-10-12T10:40:00Z' from public.registrations where id=v_id),'explicit KST midnight succeeds');
perform pg_temp.assert_boundary(current_setting('carbus_private.attendance_plan_validated',true) is distinct from 'yes','create marker is cleared before returning');

-- Given a legitimate create earlier in this same transaction; When direct date-only casts are written; Then its marker cannot be reused.
begin
  insert into public.registrations(event_id,campus_id,name,student_id,up_trip_id,down_trip_id,attend_from_at,attend_to_at)
  values ('fc000000-0000-4000-8000-000000000001',(select id from public.campuses limit 1),'Date-only direct cast','26',32601,32602,'2026-10-10'::timestamptz,'2026-10-12'::timestamptz);
  raise exception 'Expected direct cast rejection';
exception when check_violation then null; end;
begin
  update public.registrations set attend_from_at='2026-10-10'::timestamptz,attend_to_at='2026-10-12'::timestamptz where id=v_id;
  raise exception 'Expected direct timestamp update rejection';
exception when check_violation then null; end;
update public.registrations set note='Unrelated note remains editable' where id=v_id;
perform pg_temp.assert_boundary((select attend_from_at='2026-10-09T15:00:00Z' and note='Unrelated note remains editable' from public.registrations where id=v_id),'direct rejection preserves time and unrelated legacy-compatible writes');

v_result:=public.save_registration_journey(v_id,pg_temp.boundary_snapshot(v_id),
  (pg_temp.boundary_payload()-array['name','student_id','campus_id','payment_status','note','pickups','courses']) || '{"attend_from":"2026-10-10","attend_to":"2026-10-12"}'::jsonb);
set constraints all immediate;
set constraints all deferred;
perform pg_temp.assert_boundary(v_result->'row'->>'attend_from'='2026-10-10','journey RPC edits a complete plan');
perform pg_temp.assert_boundary(current_setting('carbus_private.attendance_plan_validated',true) is distinct from 'yes','journey marker is cleared before returning');
begin
  update public.registrations set attend_from_at=null,attend_to_at=null where id=v_id;
  raise exception 'Expected direct timestamp clearing rejection';
exception when check_violation then null; end;
end $$;

-- Given failure after the marker is set; When the create RPC rolls back; Then no caller retains timestamp-write authority.
do $$ begin
begin
  perform public.create_registration_complete('fc000000-0000-4000-8000-000000000001',pg_temp.boundary_payload() ||
    '{"pickups":[{"direction":"up","pickup_at":null,"place_id":999999999,"note":null}]}'::jsonb);
  raise exception 'Expected late create failure';
exception when foreign_key_violation then null; end;
perform pg_temp.assert_boundary(current_setting('carbus_private.attendance_plan_validated',true) is distinct from 'yes','create failure cannot reuse marker');
end $$;
reset role;
rollback;
\echo 'PASS: direct date-only casts blocked, explicit midnight accepted, RPC markers cleared on success/failure, and unrelated edits preserved; fixtures rolled back'
