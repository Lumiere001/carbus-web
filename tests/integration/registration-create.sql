\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims', jsonb_build_object('sub',(select id from public.profiles where role='master' limit 1),'role','authenticated')::text,true);
select set_config('request.headers','{"x-carbus-event":"f3000000-0000-4000-8000-000000000001"}',true);
insert into public.events(id,name,starts_on,ends_on,unlock_until) values ('f3000000-0000-4000-8000-000000000001','Complete create fixture','2026-10-10','2026-10-12',now()+interval '1 hour');
insert into public.event_trips(id,event_id,key,label,direction) overriding system value values
(31001,'f3000000-0000-4000-8000-000000000001','create-up','Create up','up'),
(31002,'f3000000-0000-4000-8000-000000000001','create-down','Create down','down');
insert into public.pickup_places(id,event_id,name) overriding system value values (310000001,'f3000000-0000-4000-8000-000000000001','Create place');
insert into public.org_units(id,name,kind) values ('f4000000-0000-4000-8000-000000000001','Create district','district');
create function pg_temp.assert_create(p_ok boolean,p_reason text) returns void language plpgsql as $$ begin if p_ok is distinct from true then raise exception 'FAIL: %',p_reason; end if; end $$;
create function pg_temp.create_payload(p_payment text default 'unpaid') returns jsonb language sql as $$
select jsonb_build_object('name','Complete create person ' || p_payment || ' ' || gen_random_uuid(),'student_id','26','campus_id',(select id from public.campuses limit 1),
'up_trip_id',31001,'down_trip_id',31002,'payment_status',p_payment,'note','Create note','attend_from','2026-10-10','attend_to','2026-10-12',
'legs','[{"direction":"up","mode":"ktx","via_unit_id":null,"status":"confirmed"},{"direction":"down","mode":"other_district","via_unit_id":"f4000000-0000-4000-8000-000000000001","status":"pending"}]'::jsonb,
'pickups','[{"direction":"up","pickup_at":"2026-10-11T14:20:00+09:00","place_id":310000001,"note":"First request"},{"direction":"down","pickup_at":null,"place_id":null,"note":null}]'::jsonb,
'courses','[{"day_no":1,"at_time":null},{"day_no":2,"at_time":"12:30"}]'::jsonb)
$$;
create function pg_temp.fail_create_course() returns trigger language plpgsql as $$ begin
if current_setting('test.create_failure',true)='course' and new.day_no=2 then raise exception 'Injected late course failure' using errcode='P9010'; end if; return new; end $$;
create trigger test_create_late after insert on public.course_signups for each row execute function pg_temp.fail_create_course();
set local role authenticated;

-- Given complete new input; When either unpaid or paid is created; Then all edit-compatible fields and final-trip fares agree.
do $$ declare v_status text; v_id uuid; v_reg public.registrations%rowtype; begin
foreach v_status in array array['unpaid','paid'] loop
  v_id:=public.create_registration_complete('f3000000-0000-4000-8000-000000000001',pg_temp.create_payload(v_status));
  select * into v_reg from public.registrations where id=v_id;
  perform pg_temp.assert_create(v_reg.name like 'Complete create person %' and v_reg.student_id='26' and v_reg.attend_from='2026-10-10' and v_reg.attend_to='2026-10-12' and v_reg.note='Create note','basic and participation fields');
  perform pg_temp.assert_create(v_reg.up_trip_id is null and v_reg.down_trip_id=31002 and v_reg.attendance_type='oneway' and v_reg.fee=25000,'final trips derive initial fare for unpaid and paid');
  perform pg_temp.assert_create(cardinality(v_reg.roles)=0 and v_reg.assigned_up_bus_id is null and v_reg.assigned_down_bus_id is null and not v_reg.checked_in and not v_reg.checked_out,'no role/assignment/attendance privilege granted');
  perform pg_temp.assert_create((select count(*)=2 from public.transport_legs where registration_id=v_id),'both transport directions');
  perform pg_temp.assert_create((select count(*)=2 from public.pickup_requests where registration_id=v_id),'multiple pickup requests');
  perform pg_temp.assert_create((select pickup_at='2026-10-11T05:20:00Z'::timestamptz and place_id=310000001 from public.pickup_requests where registration_id=v_id and direction='up'),'KST pickup semantics');
  perform pg_temp.assert_create((select pickup_at is null and place_id is null from public.pickup_requests where registration_id=v_id and direction='down'),'unknown pickup stays NULL');
  perform pg_temp.assert_create((select count(*)=2 from public.course_signups where registration_id=v_id),'all course selections');
  perform pg_temp.assert_create((select at_time='12:30'::time from public.course_signups where registration_id=v_id and day_no=2),'course time');
end loop;
end $$;

-- Given a late failure after the second course insert; When create runs; Then main/extra rows, audit and revision all roll back.
do $$ declare v_before jsonb; v_after jsonb; begin
select jsonb_build_object('regs',(select count(*) from public.registrations),'legs',(select count(*) from public.transport_legs),'pickups',(select count(*) from public.pickup_requests),'courses',(select count(*) from public.course_signups),'audit',(select count(*) from public.registration_audit),'revision',(select batch_revision from public.events where id='f3000000-0000-4000-8000-000000000001')) into v_before;
perform set_config('test.create_failure','course',true);
begin
  perform public.create_registration_complete('f3000000-0000-4000-8000-000000000001',pg_temp.create_payload());
  raise exception 'Expected late course failure';
exception when sqlstate 'P9010' then null; end;
select jsonb_build_object('regs',(select count(*) from public.registrations),'legs',(select count(*) from public.transport_legs),'pickups',(select count(*) from public.pickup_requests),'courses',(select count(*) from public.course_signups),'audit',(select count(*) from public.registration_audit),'revision',(select batch_revision from public.events where id='f3000000-0000-4000-8000-000000000001')) into v_after;
perform pg_temp.assert_create(v_before=v_after,'complete late failure rollback');
perform set_config('test.create_failure','',true);
end $$;

-- Given restricted/malformed values; When create rejects; Then no partial registration survives.
do $$ declare v_input jsonb; v_count bigint; begin
select count(*) into v_count from public.registrations;
foreach v_input in array array[
  pg_temp.create_payload() || '{"roles":["driver"]}'::jsonb,
  pg_temp.create_payload() || '{"fee":1}'::jsonb,
  pg_temp.create_payload() || '{"assigned_up_bus_id":7}'::jsonb,
  pg_temp.create_payload() || '{"legs":[{"direction":"up","mode":"hovercraft","status":"confirmed","via_unit_id":null}]}'::jsonb,
  pg_temp.create_payload() || '{"courses":[{"day_no":15,"at_time":null}]}'::jsonb,
  pg_temp.create_payload() || '{"pickups":[{"direction":"up","pickup_at":null,"place_id":999999999,"note":null}]}'::jsonb,
  pg_temp.create_payload() || '{"pickups":[{"direction":"up","pickup_at":"2026-10-11","place_id":null,"note":null}]}'::jsonb] loop
  begin
    perform public.create_registration_complete('f3000000-0000-4000-8000-000000000001',v_input);
    raise exception 'Expected rejected input';
  exception when sqlstate '22023' or check_violation or foreign_key_violation then null; end;
  perform pg_temp.assert_create(v_count=(select count(*) from public.registrations),'invalid input no registration leak');
end loop;
end $$;

-- Given an existing paid record; When its travel changes; Then the original paid-fare freeze remains.
do $$ declare v_id uuid; begin
v_id:=public.create_registration_complete('f3000000-0000-4000-8000-000000000001',pg_temp.create_payload('paid') || '{"legs":[]}'::jsonb);
insert into public.transport_legs(event_id,registration_id,direction,mode,status) values ('f3000000-0000-4000-8000-000000000001',v_id,'up','ktx','confirmed');
perform pg_temp.assert_create((select up_trip_id is null and fee=50000 from public.registrations where id=v_id),'existing paid fare remains frozen');
end $$;

-- Given a campus admin; When they create in their scope; Then identical complete fields save and another campus is denied.
savepoint campus_scope;
reset role;
update public.profiles set role='campus_admin',campus_id=(select id from public.campuses limit 1) where id=auth.uid();
set local role authenticated;
do $$ declare v_id uuid; v_other uuid; begin
v_id:=public.create_registration_complete('f3000000-0000-4000-8000-000000000001',pg_temp.create_payload());
perform pg_temp.assert_create((select count(*)=2 from public.pickup_requests where registration_id=v_id),'campus complete pickup parity');
select id into v_other from public.campuses where id<>public.current_campus() limit 1;
begin
  perform public.create_registration_complete('f3000000-0000-4000-8000-000000000001',pg_temp.create_payload() || jsonb_build_object('campus_id',v_other));
  raise exception 'Expected other campus rejection';
exception when insufficient_privilege then null; end;
end $$;
rollback to campus_scope;
release campus_scope;

-- Given a read-only role; When create is requested; Then the existing permission boundary stays closed.
savepoint viewer_scope;
reset role;
update public.profiles set role='viewer' where id=auth.uid();
set local role authenticated;
do $$ begin
begin
  perform public.create_registration_complete('f3000000-0000-4000-8000-000000000001',pg_temp.create_payload());
  raise exception 'Expected viewer rejection';
exception when insufficient_privilege then null; end;
end $$;
rollback to viewer_scope;
release viewer_scope;
reset role;
rollback;
\echo 'PASS: complete create fields, atomic rollback, fare preservation and campus permissions; all fixtures rolled back'
