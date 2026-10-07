\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from profiles where role='master' limit 1),'role','authenticated')::text,true);
select set_config('request.headers',jsonb_build_object('x-carbus-event',public.active_event_id())::text,true);
select set_config('qa.onsite.event',public.active_event_id()::text,true);
insert into registrations(id,event_id,campus_id,name,student_id)
select 'f3000000-0000-4000-8000-000000000001',public.active_event_id(),campus_id,'__현장_로컬검증__','26'
from profiles where role='campus_admin' and campus_id is not null limit 1;
create function pg_temp.assert_onsite(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
set local role authenticated;

-- Given unconfirmed attendance; When first arrival and duplicate requests arrive; Then first time/actor/version remain.
do $$ declare e uuid:=current_setting('qa.onsite.event')::uuid; r uuid:='f3000000-0000-4000-8000-000000000001';
  q uuid:=gen_random_uuid(); first_visit jsonb; result jsonb;
begin
  perform public.record_onsite(e,r,q,'{"action":"arrive","expected_revision":0}');
  select to_jsonb(v) into first_visit from onsite_visits v where registration_id=r;
  result:=public.record_onsite(e,r,q,'{"action":"arrive","expected_revision":0}');
  perform public.record_onsite(e,r,gen_random_uuid(),'{"action":"arrive","expected_revision":1}');
  perform pg_temp.assert_onsite(first_visit=(select to_jsonb(v) from onsite_visits v where registration_id=r),'duplicate preserves complete row');
  perform pg_temp.assert_onsite((select revision=1 from onsite_states where registration_id=r),'no-op revision preserved');
  perform pg_temp.assert_onsite((select checked_in=false and checked_out=false and attend_from is null and attend_to is null and fee=0 from registrations where id=r),'planned dates boarding and fare unchanged');
  raise notice 'PASS: first touch + duplicate UUID/action + original semantics';
end $$;

-- Given an arrival; When departure, re-entry and delayed old request occur; Then the new open visit survives.
do $$ declare e uuid:=current_setting('qa.onsite.event')::uuid; r uuid:='f3000000-0000-4000-8000-000000000001'; q uuid:=gen_random_uuid(); snapshot jsonb;
begin
  perform public.record_onsite(e,r,q,'{"action":"depart","expected_revision":1}');
  perform public.record_onsite(e,r,gen_random_uuid(),'{"action":"depart","expected_revision":2}');
  perform public.record_onsite(e,r,gen_random_uuid(),'{"action":"arrive","expected_revision":2}');
  snapshot:=public.record_onsite(e,r,q,'{"action":"depart","expected_revision":1}');
  perform pg_temp.assert_onsite((select count(*)=2 from onsite_visits where registration_id=r),'two visits preserved');
  perform pg_temp.assert_onsite((select departed_at is null from onsite_visits where registration_id=r and visit_number=2),'late retry cannot close re-entry');
  perform pg_temp.assert_onsite(snapshot->0->>'revision'='3','retry returns current snapshot');
  begin
    perform public.record_onsite(e,r,gen_random_uuid(),'{"action":"depart","expected_revision":2}');
    raise exception 'stale request accepted';
  exception when serialization_failure then null; end;
  raise notice 'PASS: departure/re-entry/history + stale retry guard';
end $$;

-- Given current visit; When correction is saved; Then audit preserves old values and a version conflict rejects stale correction.
do $$ declare e uuid:=current_setting('qa.onsite.event')::uuid; r uuid:='f3000000-0000-4000-8000-000000000001'; v onsite_visits; input jsonb; rev int;
begin
  select * into v from onsite_visits where registration_id=r and visit_number=2;
  input:=jsonb_build_object('action','correct','expected_revision',3,'visit_id',v.id,'visit_version',v.version,
    'arrived_at',v.arrived_at,'departed_at',v.arrived_at+interval '1 second','reason','로컬 순서 검증');
  perform public.record_onsite(e,r,gen_random_uuid(),input);
  perform pg_temp.assert_onsite((select count(*)=1 from onsite_corrections where registration_id=r),'one correction audit');
  perform pg_temp.assert_onsite((select before_value->>'departed_at' is null and after_value->>'departed_at' is not null from onsite_corrections where registration_id=r),'old/new values preserved');
  begin
    perform public.record_onsite(e,r,gen_random_uuid(),input||'{"expected_revision":4}');
    raise exception 'stale visit correction accepted';
  exception when serialization_failure then null; end;
  select revision into rev from onsite_states where registration_id=r;
  perform pg_temp.assert_onsite(rev=4,'stale correction revision unchanged');
  raise notice 'PASS: correction reason/audit/version guard';
end $$;

-- Given ordered history; When chronology/empty reason is invalid; Then visits, state and request are unchanged.
do $$ declare e uuid:=current_setting('qa.onsite.event')::uuid; r uuid:='f3000000-0000-4000-8000-000000000001'; v onsite_visits; input jsonb; before_rows jsonb;
begin
  select * into v from onsite_visits where registration_id=r and visit_number=1;
  select jsonb_agg(to_jsonb(x) order by visit_number) into before_rows from onsite_visits x where registration_id=r;
  input:=jsonb_build_object('action','correct','expected_revision',4,'visit_id',v.id,'visit_version',v.version,
    'arrived_at',v.arrived_at,'departed_at',v.arrived_at-interval '1 second','reason','순서 검증');
  begin perform public.record_onsite(e,r,gen_random_uuid(),input); raise exception 'bad pair accepted'; exception when check_violation then null; end;
  begin perform public.record_onsite(e,r,gen_random_uuid(),input||jsonb_build_object('departed_at',clock_timestamp()+interval '1 day')); raise exception 'overlap accepted'; exception when check_violation then null; end;
  begin perform public.record_onsite(e,r,gen_random_uuid(),input||'{"reason":""}'); raise exception 'empty reason accepted'; exception when invalid_parameter_value then null; end;
  perform pg_temp.assert_onsite(before_rows=(select jsonb_agg(to_jsonb(x) order by visit_number) from onsite_visits x where registration_id=r),'failed correction rolls back');
  perform pg_temp.assert_onsite((select revision=4 from onsite_states where registration_id=r),'failed correction state unchanged');
  raise notice 'PASS: pair order + historical overlap + reason failure rollback';
end $$;

-- Given history; When both confirmed times are explicitly cleared; Then the visit remains and its reason is audited.
do $$ declare e uuid:=current_setting('qa.onsite.event')::uuid; r uuid:='f3000000-0000-4000-8000-000000000001'; v onsite_visits;
begin
  select * into v from onsite_visits where registration_id=r and visit_number=2;
  perform public.record_onsite(e,r,gen_random_uuid(),jsonb_build_object('action','correct','expected_revision',4,
    'visit_id',v.id,'visit_version',v.version,'arrived_at',null,'departed_at',null,'reason','잘못 누른 기록 해제'));
  perform pg_temp.assert_onsite((select arrived_at is null and departed_at is null from onsite_visits where id=v.id),'clear leaves unknown times');
  perform pg_temp.assert_onsite((select count(*)=2 from onsite_visits where registration_id=r),'clear preserves historical rows');
  perform pg_temp.assert_onsite((select count(*)=2 from onsite_corrections where registration_id=r),'clear audited');
  raise notice 'PASS: explicit clear preserves visit and correction audit';
end $$;
reset role;
-- Separate fixture: departure without any known arrival.
insert into registrations(id,event_id,campus_id,name,student_id)
select 'f3000000-0000-4000-8000-000000000002',public.active_event_id(),campus_id,'__출발먼저_로컬검증__','26' from profiles where role='campus_admin' and campus_id is not null limit 1;
set local role authenticated;
do $$ declare r uuid:='f3000000-0000-4000-8000-000000000002'; begin
  perform public.record_onsite(current_setting('qa.onsite.event')::uuid,r,gen_random_uuid(),'{"action":"depart","expected_revision":0}');
  perform pg_temp.assert_onsite((select arrived_at is null and departed_at is not null from onsite_visits where registration_id=r),'departure never invents arrival');
  raise notice 'PASS: departure first stays unknown arrival';
end $$;
reset role;
rollback;
\echo 'PASS: onsite local storage tests; all fixtures rolled back'
