\set ON_ERROR_STOP on
begin;
select set_config('request.headers',jsonb_build_object('x-carbus-event',public.active_event_id())::text,true);
select set_config('qa.onsite.event',public.active_event_id()::text,true);
select set_config('qa.onsite.master',(select id::text from profiles where role='master' limit 1),true);
select set_config('qa.onsite.campus',(select id::text from profiles where role='campus_admin' and campus_id is not null limit 1),true);
select set_config('qa.onsite.viewer',(select id::text from profiles where role='viewer' limit 1),true);
select set_config('qa.onsite.guest',(select id::text from profiles where role='guest' limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.onsite.master'),'role','authenticated')::text,true);
insert into registrations(id,event_id,campus_id,name,student_id)
select 'f4000000-0000-4000-8000-000000000001',public.active_event_id(),campus_id,'__현장권한_로컬검증__','26'
from profiles where id=current_setting('qa.onsite.campus')::uuid;
insert into registrations(id,event_id,campus_id,name,student_id)
select 'f4000000-0000-4000-8000-000000000002',public.active_event_id(),id,'__현장다른캠퍼스_로컬검증__','26'
from campuses where id<>(select campus_id from profiles where id=current_setting('qa.onsite.campus')::uuid) limit 1;
create function pg_temp.assert_onsite(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
set local role authenticated;

-- Given viewer/guest roles; When write RPC is called; Then it denies before writing.
do $$ declare who text; e uuid:=current_setting('qa.onsite.event')::uuid; r uuid:='f4000000-0000-4000-8000-000000000001'; begin
  foreach who in array array['viewer','guest'] loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.onsite.'||who),'role','authenticated')::text,true);
    begin perform public.record_onsite(e,r,gen_random_uuid(),'{"action":"arrive","expected_revision":0}'); raise exception 'readonly write accepted';
    exception when insufficient_privilege then null; end;
    if who='viewer' then perform pg_temp.assert_onsite(jsonb_array_length(public.onsite_snapshot(e,array[r]))=1,'viewer can read');
    else perform pg_temp.assert_onsite(public.onsite_snapshot(e,array[r])='[]'::jsonb,'guest has no site access'); end if;
  end loop;
  raise notice 'PASS: viewer read-only + guest denied';
end $$;

-- Given a campus admin; When own campus checks and foreign campus access happen; Then only own campus succeeds.
do $$ declare e uuid:=current_setting('qa.onsite.event')::uuid; own uuid:='f4000000-0000-4000-8000-000000000001'; other uuid:='f4000000-0000-4000-8000-000000000002'; begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.onsite.campus'),'role','authenticated')::text,true);
  perform public.record_onsite(e,own,gen_random_uuid(),'{"action":"arrive","expected_revision":0}');
  begin perform public.record_onsite(e,other,gen_random_uuid(),'{"action":"arrive","expected_revision":0}'); raise exception 'foreign campus accepted';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_onsite(public.onsite_snapshot(e,array[other])='[]'::jsonb,'foreign campus snapshot denied');
  begin insert into onsite_visits(event_id,registration_id,visit_number,arrived_at) values(e,own,2,now()); raise exception 'direct write accepted';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: campus write/read scope + direct table writes denied';
end $$;

-- Given an authenticated master; When request ID is reused with altered input/actor or scope differs; Then no mutation occurs.
do $$ declare e uuid:=current_setting('qa.onsite.event')::uuid; r uuid:='f4000000-0000-4000-8000-000000000001'; q uuid:=gen_random_uuid(); begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.onsite.master'),'role','authenticated')::text,true);
  perform public.record_onsite(e,r,q,'{"action":"depart","expected_revision":1}');
  begin perform public.record_onsite(e,r,q,'{"action":"arrive","expected_revision":2}'); raise exception 'altered request accepted';
  exception when invalid_parameter_value then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.onsite.campus'),'role','authenticated')::text,true);
  begin perform public.record_onsite(e,r,q,'{"action":"depart","expected_revision":1}'); raise exception 'other actor request accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.record_onsite('00000000-0000-4000-8000-000000000099',r,gen_random_uuid(),'{"action":"arrive","expected_revision":2}'); raise exception 'cross event accepted';
  exception when insufficient_privilege then null; end;
  perform pg_temp.assert_onsite((select revision=2 from onsite_states where registration_id=r),'rejections no revision writes');
  raise notice 'PASS: request actor/payload and event identity guarded';
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.onsite.master'),'role','authenticated')::text,true);
update registrations set participation_status='cancelled' where id='f4000000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ begin
  begin perform public.record_onsite(current_setting('qa.onsite.event')::uuid,'f4000000-0000-4000-8000-000000000002',gen_random_uuid(),'{"action":"arrive","expected_revision":0}'); raise exception 'cancelled accepted';
  exception when check_violation then null; end;
  raise notice 'PASS: cancelled site check denied';
end $$;
reset role;
-- Closed event enforcement is verified without changing the current live event.
insert into events(id,name) values('f4000000-0000-4000-8000-000000000003','__현장닫힌행사_로컬검증__');
select set_config('request.headers','{"x-carbus-event":"f4000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
do $$ begin
  begin perform public.record_onsite('f4000000-0000-4000-8000-000000000003','f4000000-0000-4000-8000-000000000001',gen_random_uuid(),'{"action":"arrive","expected_revision":0}'); raise exception 'closed event accepted';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: closed event denied';
end $$;
reset role;
rollback;
\echo 'PASS: onsite local permission tests; all fixtures rolled back'
