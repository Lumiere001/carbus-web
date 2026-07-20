#!/bin/bash
# 행사 전환 기능 검증.
# ⚠️ SET LOCAL 은 트랜잭션 안에서만 먹는다. begin/commit 으로 감싸지 않으면
#    역할·JWT 클레임이 적용되지 않아 "master 로 테스트했다"는 착각을 하게 된다.
set -uo pipefail
MASTER="d330c677-321a-492c-ae77-465293307853"

Q() { docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c "$1"; }

# 지정한 프로필로 로그인한 authenticated 세션처럼 실행 (RLS·current_role() 적용).
AS() {
  local uid="$1" sql="$2"
  docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -tA 2>&1 <<SQL | grep -v '^BEGIN$\|^COMMIT$\|^ROLLBACK$\|^SET$'
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"$uid","role":"authenticated"}';
$sql
commit;
SQL
}

echo "### 0. 세션 흉내가 실제로 먹는지 먼저 확인"
echo -n "  master 세션의 current_role() = "
AS "$MASTER" "select public.current_role();"

echo
echo "### 1. 전환 전 (master 화면 기준)"
AS "$MASTER" "select '활성행사 '||name from events where is_active;
select '신청 '||count(*) from registrations;
select '호차 '||count(*) from buses;
select '운행편 '||count(*) from departure_slots;
select '정산행 '||count(*) from campus_payment_settlements;"

echo
echo "### 2. 권한 — campus_admin 은 거부되어야 함"
CAMPUS=$(Q "select id from profiles where role='campus_admin' limit 1")
AS "$CAMPUS" "select public.create_event('침투 시도');" | grep -oE "행사 전환은 master 만[^\"]*" | head -1

echo
echo "### 3. 새 행사 생성"
AS "$MASTER" "select '새 행사: '||public.create_event(
  '2026 리더십 캠프', 'CCC 71기', date '2026-08-14', date '2026-08-16', '광주', '무주', true, true);"

echo
echo "### 4. 전환 후 — 화면에 보이는 것 (전부 0/복제분이어야 함)"
AS "$MASTER" "select '활성행사 '||name from events where is_active;
select '신청 '||count(*) from registrations;
select '호차 '||count(*) from buses;
select '운행편 '||count(*) from departure_slots;
select '정산행 '||count(*) from campus_payment_settlements;
select '감사로그 '||count(*) from registration_audit;"

echo
echo "### 5. 지난 행사 데이터는 DB 에 그대로인가 (RLS 우회)"
Q "select '전체 신청 '||count(*) from registrations;
select '전체 감사로그 '||count(*) from registration_audit;
select '행사: '||string_agg(name||case when is_active then '(활성)' else '' end, ' / ' order by created_at) from events;"

echo
echo "### 6. 복제 결과"
NEW=$(Q "select id from events where is_active")
Q "select '새 호차: '||count(*)||'대' from buses where event_id='$NEW';
select '새 운행편: '||string_agg(label,',' order by display_order) from departure_slots where event_id='$NEW';
select '호차→운행편 연결 정상: '||case when count(*)=0 then 'YES' else 'NO('||count(*)||')' end
  from buses b where b.event_id='$NEW'
   and not exists (select 1 from departure_slots s where s.id=b.departure_slot_id and s.event_id='$NEW');
select '차량순장/고정 비움: '||case when count(*)=0 then 'YES' else 'NO('||count(*)||')' end
  from buses where event_id='$NEW'
   and (driver_registration_id is not null or down_driver_registration_id is not null
        or coalesce(array_length(fixed_passenger_ids,1),0)>0
        or coalesce(array_length(down_fixed_passenger_ids,1),0)>0);
select '차량순장 로그인 재매핑: '||count(*)||'명이 새 호차를 가리킴'
  from profiles p join buses b on b.id=p.driver_bus_id where b.event_id='$NEW';
select '진행단계 초기화: '||current_phase||' / batch_enabled='||batch_enabled from system_config;"

echo
echo "### 7. 뷰가 새 행사 기준인가"
AS "$MASTER" "select 'v_campus_stats 신청합 '||coalesce(sum(total),0) from v_campus_stats;
select 'v_day_capacity 행 '||count(*)||' / 정원합 '||coalesce(sum(total_capacity),0) from v_day_capacity;
select 'v_bus_occupancy 행 '||count(*) from v_bus_occupancy;
select 'v_payment_summary 인원합 '||coalesce(sum(paid_count+unpaid_count+waived_count),0) from v_payment_summary;"

echo
echo "### 8. 지난 행사의 같은 학우를 새 행사에 다시 신청할 수 있는가 (UNIQUE 범위)"
# chk_roundtrip: 왕복은 출발편·하행이용이 모두 있어야 한다 → 테스트도 지켜야 함
SLOT=$(Q "select id from departure_slots where event_id=(select id from events where is_active) order by display_order limit 1")
OLDEV=$(Q "select id from events where not is_active order by created_at limit 1")
DUP=$(Q "select campus_id||'|'||student_id||'|'||name from registrations where event_id='$OLDEV' limit 1")
IFS='|' read -r C S N <<< "$DUP"
echo -n "  지난 행사 학우를 새 행사에 등록: "
Q "insert into registrations (campus_id, student_id, name, attendance_type, departure_slot_id, uses_return_bus)
   values ('$C','$S','$N','roundtrip',$SLOT,true) returning 'OK'" 2>&1 | tail -1
echo -n "  같은 행사 안 중복은 여전히 거부되는가: "
DUPOUT=$(Q "insert into registrations (campus_id, student_id, name, attendance_type, departure_slot_id, uses_return_bus)
   values ('$C','$S','$N','roundtrip',$SLOT,true)" 2>&1 || true)
case "$DUPOUT" in
  *uq_registrations_identity*) echo "YES (정상 거부)" ;;
  *) echo "NO ← 문제: $DUPOUT" ;;
esac

echo
echo "### 9. 되돌리기 — 이전 행사로 복귀"
OLD=$(Q "select id from events where not is_active order by created_at limit 1")
AS "$MASTER" "select public.activate_event('$OLD'::uuid);"
AS "$MASTER" "select '활성행사 '||name from events where is_active;
select '신청 '||count(*) from registrations;
select '호차 '||count(*) from buses;
select '감사로그 '||count(*) from registration_audit;"
