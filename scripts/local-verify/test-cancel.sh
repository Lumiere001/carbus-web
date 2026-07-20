#!/bin/bash
# 취소 처리 검증 — 좌석이 실제로 반납되는지, 삭제가 막히는지.
set -uo pipefail
MASTER="d330c677-321a-492c-ae77-465293307853"
Q() { docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c "$1"; }
TX() { docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -tA 2>&1; }

echo "### 1. 취소하면 좌석·출석이 반납되는가"
TX << 'SQL' | grep -E "^(전|후|판정)"
begin;
create temp table t as
  select id from registrations
   where assigned_up_bus_id is not null and assigned_down_bus_id is not null
     and checked_in limit 1;
select '전: 상행'||assigned_up_bus_id||' 하행'||assigned_down_bus_id||' 체크인'||checked_in
  from registrations where id=(select id from t);
update registrations set participation_status='cancelled', cancel_reason='테스트'
 where id=(select id from t);
select '후: 상행'||coalesce(assigned_up_bus_id::text,'없음')||' 하행'||coalesce(assigned_down_bus_id::text,'없음')
       ||' 체크인'||checked_in||' 취소시각'||case when cancelled_at is null then '없음' else '기록됨' end
  from registrations where id=(select id from t);
select '판정: '||case when assigned_up_bus_id is null and assigned_down_bus_id is null
                        and not checked_in and cancelled_at is not null
                     then 'PASS — 좌석·출석 반납됨' else 'FAIL' end
  from registrations where id=(select id from t);
rollback;
SQL

echo
echo "### 2. 차량순장/고정탑승에서도 빠지는가"
TX << 'SQL' | grep -E "^(전|후|판정)"
begin;
create temp table d as select driver_registration_id rid, id bid from buses
 where driver_registration_id is not null limit 1;
select '전: 호차'||bid||' 의 차량순장 지정됨' from d;
update registrations set participation_status='cancelled' where id=(select rid from d);
select '판정: '||case when (select driver_registration_id from buses where id=(select bid from d)) is null
                     then 'PASS — 차량순장에서 해제됨' else 'FAIL — 여전히 지정됨' end;
rollback;
SQL

echo
echo "### 3. 집계에서 취소자가 빠지는가"
TX << 'SQL' | grep -E "^(전|후|판정)"
begin;
select '전: 전체 신청 '||coalesce(sum(total),0) from v_campus_stats;
update registrations set participation_status='cancelled'
 where id in (select id from registrations limit 5);
select '후: 전체 신청 '||coalesce(sum(total),0)||' (5명 줄어야)' from v_campus_stats;
select '판정: '||case when (select coalesce(sum(total),0) from v_campus_stats)=594
                     then 'PASS — 취소자 5명 제외됨' else 'FAIL' end;
rollback;
SQL

echo
echo "### 4. 하드 삭제가 막히는가 (앱 경로)"
DEL=$(docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -tA 2>&1 << 'SQL'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d330c677-321a-492c-ae77-465293307853","role":"authenticated"}';
delete from registrations where id=(select id from registrations limit 1);
rollback;
SQL
)
case "$DEL" in
  *"취소\" 처리해 주세요"*|*"취소"*) echo "  PASS — 삭제 차단됨" ;;
  *) echo "  FAIL — 삭제됨: $DEL" ;;
esac

echo
echo "### 5. 운영 스크립트(service_role)는 통과하는가"
TX << 'SQL' | grep -E "^(판정)"
begin;
delete from registrations where id=(select id from registrations limit 1);
select '판정: PASS — 마이그레이션·스크립트 경로는 삭제 가능';
rollback;
SQL

echo
echo "### 6. 취소자가 다시 신청할 수 있는가 (부분 유니크)"
TX << 'SQL' | grep -E "^(판정)"
begin;
create temp table v as select campus_id c, student_id s, name n, departure_slot_id d from registrations
 where departure_slot_id is not null limit 1;
update registrations set participation_status='cancelled'
 where (campus_id,student_id,name)=(select c,s,n from v);
insert into registrations (campus_id, student_id, name, attendance_type, departure_slot_id, uses_return_bus)
select c,s,n,'roundtrip',d,true from v;
select '판정: PASS — 취소 후 재신청 가능';
rollback;
SQL

echo
echo "### 7. 취소자에게 출석 못 찍는가"
TX << 'SQL' | grep -E "PASS|FAIL"
begin;
create temp table w as select id from registrations limit 1;
update registrations set participation_status='cancelled' where id=(select id from w);
do $$ begin
  update registrations set checked_in=true where id=(select id from w);
  raise notice 'FAIL — 출석 찍힘';
exception when others then
  raise notice '판정: PASS — %', sqlerrm;
end $$;
rollback;
SQL

echo
echo "### 8. 취소자 점검 뷰"
Q "select '현재 취소자: '||count(*)||'명' from v_cancelled;"
