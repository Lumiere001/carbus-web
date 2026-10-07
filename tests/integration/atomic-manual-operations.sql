\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims', jsonb_build_object('sub',(select id from profiles where role='master' limit 1),'role','authenticated')::text,true);
select set_config('request.headers','{"x-carbus-event":"f6000000-0000-4000-8000-000000000001"}',true);
insert into public.events(id,name,unlock_until) values('f6000000-0000-4000-8000-000000000001','Manual operations fixture',now()+interval '1 hour');
insert into public.event_trips(id,event_id,key,label,direction) overriding system value values
(30201,'f6000000-0000-4000-8000-000000000001','manual-up','Manual up','up'),
(30202,'f6000000-0000-4000-8000-000000000001','manual-down','Manual down','down'),
(30203,'f6000000-0000-4000-8000-000000000001','manual-other','Manual other','up');
insert into public.buses(id,event_id,name,capacity,hard_cap,up_trip_id,down_trip_id,kind) values
(230000001,'f6000000-0000-4000-8000-000000000001','Manual first',2,2,30201,30202,'bus'),
(230000002,'f6000000-0000-4000-8000-000000000001','Manual other',2,2,30203,30202,'bus'),
(230000003,'f6000000-0000-4000-8000-000000000001','Manual staff',2,2,30201,30202,'staff_car');
insert into public.registrations(id,event_id,name,student_id,campus_id,up_trip_id,down_trip_id,assigned_up_bus_id,assigned_down_bus_id,payment_status)
select ('f6100000-0000-4000-8000-00000000000'||n)::uuid,'f6000000-0000-4000-8000-000000000001','Manual person '||n,'26',
(select campus_id from public.profiles where role='campus_admin' and campus_id is not null limit 1),30201,30202,
case when n=1 then 230000001 end,case when n=1 then 230000001 end,case when n=5 then 'paid'::payment_status else 'unpaid'::payment_status end
from generate_series(1,6)n;
update public.registrations set participation_status='cancelled' where id='f6100000-0000-4000-8000-000000000004';
create function pg_temp.check_manual(p_ok boolean,p_message text) returns void language plpgsql as $$ begin if p_ok is distinct from true then raise exception 'FAIL: %',p_message; end if; end $$;
create function pg_temp.manual_expected(p_reg uuid) returns jsonb language sql as $$
 select jsonb_build_object('up_trip_id',up_trip_id,'down_trip_id',down_trip_id,'assigned_up_bus_id',assigned_up_bus_id,'assigned_down_bus_id',assigned_down_bus_id) from registrations where id=p_reg
$$;
create function pg_temp.manual_state() returns jsonb language sql as $$
 select jsonb_build_object('r',(select jsonb_agg(to_jsonb(r) order by id) from registrations r where event_id='f6000000-0000-4000-8000-000000000001'),
 'b',(select jsonb_agg(to_jsonb(b) order by id) from buses b where event_id='f6000000-0000-4000-8000-000000000001'),
 'l',(select jsonb_agg(to_jsonb(l) order by id) from transport_legs l where event_id='f6000000-0000-4000-8000-000000000001'),
 'a',(select jsonb_agg(to_jsonb(a) order by id) from registration_audit a where event_id='f6000000-0000-4000-8000-000000000001'),
 'e',(select to_jsonb(e) from events e where id='f6000000-0000-4000-8000-000000000001'))
$$;
set local role authenticated;

-- Given one free seat; When the first operator fills it and the next operator tries another rider; Then the hard cap rejects the second without any partial values.
savepoint manual_capacity;
select public.set_manual_assignment('f6100000-0000-4000-8000-000000000002',pg_temp.manual_expected('f6100000-0000-4000-8000-000000000002'),'{"assigned_up_bus_id":230000001}');
do $$ declare before jsonb:=pg_temp.manual_state(); begin
 begin perform public.set_manual_assignment('f6100000-0000-4000-8000-000000000003',pg_temp.manual_expected('f6100000-0000-4000-8000-000000000003'),'{"assigned_up_bus_id":230000001}'); raise exception 'Expected cap rejection' using errcode='P9009'; exception when raise_exception then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'last seat cannot be overwritten');
end $$;
rollback to manual_capacity;
release manual_capacity;

-- Given the cancelled row still has requested trips; When a master tries assignment; Then the cancelled payload remains exactly unchanged.
do $$ declare before jsonb:=pg_temp.manual_state(); begin
 begin perform public.set_manual_assignment('f6100000-0000-4000-8000-000000000004',pg_temp.manual_expected('f6100000-0000-4000-8000-000000000004'),'{"assigned_up_bus_id":230000001}'); raise exception 'Expected cancelled rejection' using errcode='P9009'; exception when check_violation then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'cancelled assignment rejected atomically');
end $$;

-- Given a valid up target and invalid down target; When both are saved; Then the valid first direction does not persist.
do $$ declare before jsonb:=pg_temp.manual_state(); begin
 begin perform public.set_manual_assignment('f6100000-0000-4000-8000-000000000002',pg_temp.manual_expected('f6100000-0000-4000-8000-000000000002'),'{"assigned_up_bus_id":230000001,"assigned_down_bus_id":999999999}'); raise exception 'Expected target rejection' using errcode='P9009'; exception when raise_exception then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'two direction assignment is atomic');
end $$;

-- Given a different-trip normal bus or an unbound staff target; When assigning; Then existing slot and staff-anchor rules reject unchanged payloads.
do $$ declare before jsonb:=pg_temp.manual_state(); begin
 begin perform public.set_manual_assignment('f6100000-0000-4000-8000-000000000002',pg_temp.manual_expected('f6100000-0000-4000-8000-000000000002'),'{"assigned_up_bus_id":230000002}'); raise exception 'Expected trip mismatch rejection' using errcode='P9009'; exception when raise_exception then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'manual trip equality retained');
 begin perform public.set_manual_assignment('f6100000-0000-4000-8000-000000000002',pg_temp.manual_expected('f6100000-0000-4000-8000-000000000002'),'{"assigned_up_bus_id":230000003}'); raise exception 'Expected staff anchor rejection' using errcode='P9009'; exception when check_violation then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'manual staff anchor requirement retained');
end $$;

-- Given a bound staff rider with no requested trip; When the manual path saves; Then its existing equality rule still rejects while the leader-created staff assignment remains.
savepoint staff_manual;
select public.set_leader_binding('f6100000-0000-4000-8000-000000000003','fixed','assign','up',230000003);
update registrations set up_trip_id=null where id='f6100000-0000-4000-8000-000000000003';
do $$ declare before jsonb:=pg_temp.manual_state(); begin
 begin perform public.set_manual_assignment('f6100000-0000-4000-8000-000000000003',pg_temp.manual_expected('f6100000-0000-4000-8000-000000000003'),'{"assigned_up_bus_id":230000003}'); raise exception 'Expected manual no-trip rejection' using errcode='P9009'; exception when raise_exception then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'manual staff no-trip policy unchanged');
end $$;
rollback to staff_manual;
release staff_manual;

-- Given a newer trip edit; When the old observed snapshot is submitted; Then it cannot restore an obsolete assignment.
savepoint manual_stale;
do $$ declare expected jsonb:=pg_temp.manual_expected('f6100000-0000-4000-8000-000000000002'); before jsonb; begin
 update registrations set up_trip_id=30203 where id='f6100000-0000-4000-8000-000000000002'; before:=pg_temp.manual_state();
 begin perform public.set_manual_assignment('f6100000-0000-4000-8000-000000000002',expected,'{"assigned_up_bus_id":230000001}'); raise exception 'Expected stale rejection' using errcode='P9009'; exception when serialization_failure then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'newer trip preserved');
end $$;
rollback to manual_stale;
release manual_stale;

-- Given an ordinary assigned rider; When the trip changes; Then only the stale direction assignment clears.
savepoint trip_reconcile;
do $$ begin
 update registrations set up_trip_id=30203 where id='f6100000-0000-4000-8000-000000000001';
 perform pg_temp.check_manual((select assigned_up_bus_id is null and assigned_down_bus_id=230000001 from registrations where id='f6100000-0000-4000-8000-000000000001'),'stale ordinary assignment clears direction only');
end $$;
rollback to trip_reconcile;
release trip_reconcile;

-- Given an ordinary leader anchor; When a manual trip mismatch is attempted; Then registration, fee, anchor, audit and revision remain unchanged.
savepoint leader_trip;
select public.set_leader_binding('f6100000-0000-4000-8000-000000000001','driver','assign','up',230000001);
do $$ declare before jsonb:=pg_temp.manual_state(); begin
 begin update registrations set up_trip_id=30203 where id='f6100000-0000-4000-8000-000000000001'; raise exception 'Expected leader rejection' using errcode='P9009'; exception when check_violation then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'manual leader trip mismatch preserves old payload');
end $$;
rollback to leader_trip;
release leader_trip;

-- Given a paid leader in both directions; When confirmed external transport releases up; Then only up bindings/trip/assignment clear and the paid fee remains frozen.
savepoint transport_release;
select public.set_leader_binding('f6100000-0000-4000-8000-000000000005','driver','assign','up',230000001);
select public.set_leader_binding('f6100000-0000-4000-8000-000000000005','fixed','assign','down',230000001);
do $$ declare frozen integer; begin
 select fee into frozen from registrations where id='f6100000-0000-4000-8000-000000000005';
 insert into transport_legs(event_id,registration_id,direction,mode,status) values('f6000000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000005','up','own_car','confirmed');
 perform pg_temp.check_manual((select up_trip_id is null and assigned_up_bus_id is null and down_trip_id=30202 and fee=frozen from registrations where id='f6100000-0000-4000-8000-000000000005'),'transport release keeps paid freeze and opposite trip');
 perform pg_temp.check_manual((select driver_registration_id is null and 'f6100000-0000-4000-8000-000000000005'::uuid=any(down_fixed_passenger_ids) from buses where id=230000001),'transport clears only direction anchor');
 delete from transport_legs where registration_id='f6100000-0000-4000-8000-000000000005' and direction='up';
 perform pg_temp.check_manual((select up_trip_id is null and assigned_up_bus_id is null from registrations where id='f6100000-0000-4000-8000-000000000005'),'return to our_bus does not recreate trips or assignment');
 update registrations set up_trip_id=30201 where id='f6100000-0000-4000-8000-000000000005';
 perform pg_temp.check_manual((select assigned_up_bus_id is null from registrations where id='f6100000-0000-4000-8000-000000000005'),'reselecting our trip does not recreate assignment');
 perform pg_temp.check_manual((select driver_registration_id is null from buses where id=230000001),'reselecting our trip does not recreate old anchor');
end $$;
rollback to transport_release;
release transport_release;

-- Given release removes an anchor before a registration failure; When the DB aborts the transport write; Then the leg, old registration, bindings, fee, audit and revision all roll back.
savepoint transport_failure;
select public.set_leader_binding('f6100000-0000-4000-8000-000000000001','driver','assign','up',230000001);
reset role;
create function pg_temp.fail_release() returns trigger language plpgsql as $$ begin
 if new.id='f6100000-0000-4000-8000-000000000001' and old.up_trip_id is not null and new.up_trip_id is null then
  raise exception 'Injected release failure' using errcode='P9002'; end if; return new;
end $$;
create trigger test_release_failure before update on registrations for each row execute function pg_temp.fail_release();
set local role authenticated;
do $$ declare before jsonb:=pg_temp.manual_state(); begin
 begin insert into transport_legs(event_id,registration_id,direction,mode,status) values('f6000000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000001','up','own_car','confirmed'); raise exception 'Expected injected failure' using errcode='P9009'; exception when sqlstate 'P9002' then null; end;
 perform pg_temp.check_manual(pg_temp.manual_state()=before,'release failure rolls back entire linked state');
end $$;
rollback to transport_failure;
release transport_failure;

-- Given a cancellation transition with a leader anchor; When cancellation occurs; Then the new trip guard does not block existing cancellation behavior.
savepoint cancellation;
select public.set_leader_binding('f6100000-0000-4000-8000-000000000001','driver','assign','up',230000001);
do $$ begin
 update registrations set participation_status='cancelled',up_trip_id=null where id='f6100000-0000-4000-8000-000000000001';
 perform pg_temp.check_manual((select assigned_up_bus_id is null and assigned_down_bus_id is null from registrations where id='f6100000-0000-4000-8000-000000000001'),'cancel transition remains allowed');
end $$;
rollback to cancellation;
release cancellation;

-- Given a campus editor of an assigned normal rider; When its trip changes; Then derived seat release is allowed while unrelated manual assignment remains forbidden.
savepoint campus_trip;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='campus_admin' and campus_id is not null limit 1),'role','authenticated')::text,true);
do $$ begin
 update registrations set up_trip_id=30203 where id='f6100000-0000-4000-8000-000000000001';
 perform pg_temp.check_manual((select assigned_up_bus_id is null and assigned_down_bus_id=230000001 from registrations where id='f6100000-0000-4000-8000-000000000001'),'campus trip edit releases stale seat');
 begin update registrations set assigned_down_bus_id=null where id='f6100000-0000-4000-8000-000000000001'; raise exception 'Expected assignment permission rejection' using errcode='P9009'; exception when raise_exception then null; end;
end $$;
rollback to campus_trip;
release campus_trip;

-- Given the viewed historical fixture is unlocked; When master remittance is recorded; Then it lands in that event and deletion updates its settlement.
savepoint viewed_remittance;
do $$ declare campus uuid:=(select campus_id from registrations where id='f6100000-0000-4000-8000-000000000001'); rid uuid; begin
 perform public.master_remit_add(campus,123,'synthetic viewed-event remittance');
 select id into rid from campus_remittances where event_id='f6000000-0000-4000-8000-000000000001' and campus_id=campus;
 perform pg_temp.check_manual(rid is not null,'remit targets viewed unlocked event');
 perform public.campus_remit_delete(rid);
 perform pg_temp.check_manual((select campus_remitted_total=0 from campus_payment_settlements where event_id='f6000000-0000-4000-8000-000000000001' and campus_id=campus),'remit deletion recalculates settlement');
 begin perform public.campus_remit_delete(rid); raise exception 'Expected stale delete rejection' using errcode='P9009'; exception when serialization_failure then null; end;
end $$;
rollback to viewed_remittance;
release viewed_remittance;
-- Given a campus editor viewing the unlocked historical fixture; When remittance is added; Then it targets the viewed event with the original campus role restriction.
savepoint campus_remittance;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from public.profiles where role='campus_admin' and campus_id is not null limit 1),'role','authenticated')::text,true);
do $$ begin
 perform public.campus_remit_add(123,'synthetic campus remit');
 perform pg_temp.check_manual((select count(*)=1 from campus_remittances where event_id='f6000000-0000-4000-8000-000000000001' and campus_id=public.current_campus()),'campus remittance targets viewed event');
 begin perform public.set_manual_assignment('f6100000-0000-4000-8000-000000000002',pg_temp.manual_expected('f6100000-0000-4000-8000-000000000002'),'{"assigned_up_bus_id":230000001}'); raise exception 'Expected master-only rejection' using errcode='P9009'; exception when insufficient_privilege then null; end;
end $$;
rollback to campus_remittance;
release campus_remittance;
reset role;
rollback;
\echo 'PASS: atomic manual assignment, trip reconciliation, transport release and viewed-event remit tests; fixtures rolled back'
