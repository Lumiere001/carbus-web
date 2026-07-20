#!/bin/bash
# 결제 장부 검증 — 이 파일의 핵심은 "청구액 동결"이 실제로 되는지다.
# 동결이 안 되면 장부을 만들어도 앞으로 생기는 취소는 다시 안 보인다.
set -uo pipefail
Q() { docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c "$1"; }
TX() { docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -tA 2>&1; }

echo "### 1. 이관 결과"
Q "select '장부 행수: '||count(*)||' (청구 '||count(*) filter (where kind='charge')
   ||' / 수납 '||count(*) filter (where kind='payment')
   ||' / 면제 '||count(*) filter (where kind='waive')||')' from payment_ledger;
   select '차액 발생(환불 확인 대상): '||count(*)||'명 / '||coalesce(sum(balance),0)||'원'
     from v_payment_balance where balance>0;
   select '미수(덜 낸 사람): '||count(*)||'명 / '||coalesce(-sum(balance),0)||'원'
     from v_payment_balance where balance<0;"

echo
echo "### 2. 기존 화면 숫자 불변 확인"
Q "select '납부 집계(v_payment_summary): '||coalesce(sum(paid_total),0)||'원' from v_payment_summary;
   select 'fee 분포: '||string_agg(f||'원:'||c,' / ' order by f) from (select fee f,count(*) c from registrations group by 1) x;
   select '감사로그: '||count(*)||' (18967 유지되어야)' from registration_audit;"

echo
echo "### 3. ★핵심★ 청구액 동결 — 낸 사람의 참여형태를 바꿔도 fee 가 유지되는가"
TX << 'SQL' | grep -E "^(원래|바꾼|판정)"
begin;
-- 왕복 5만원 내고 완납된 사람을 하나 골라 '버스 미이용'으로 바꿔본다 (= 버스 취소)
create temp table t as
  select id, fee as fee0 from registrations
   where payment_status='paid' and attendance_type='roundtrip' and fee=50000 limit 1;
select '원래: fee '||fee0 from t;
update registrations set attendance_type='self', departure_slot_id=null, uses_return_bus=false
 where id=(select id from t);
select '바꾼 뒤: fee '||r.fee||' (미이용으로 변경 후)' from registrations r where r.id=(select id from t);
select '판정: '||case when r.fee=(select fee0 from t)
                     then 'PASS — 청구액 동결됨 (받은 돈 근거 보존)'
                     else 'FAIL — 청구액이 '||r.fee||'로 덮어써짐' end
  from registrations r where r.id=(select id from t);
rollback;
SQL

echo
echo "### 4. 미납자는 참여형태 따라 재계산되는가 (정상 신청 흐름)"
TX << 'SQL' | grep -E "^(미납|판정)"
begin;
create temp table u as
  select id, fee as fee0 from registrations
   where payment_status='unpaid' and attendance_type='roundtrip' limit 1;
select '미납자 원래 fee: '||fee0 from u;
update registrations set attendance_type='oneway', uses_return_bus=false
 where id=(select id from u);
select '판정: '||case when r.fee=25000 then 'PASS — 편도 25000원으로 재계산됨'
                     else 'FAIL — fee '||r.fee end
  from registrations r where r.id=(select id from u);
rollback;
SQL

echo
echo "### 5. 새로 등록하면 청구액이 자동으로 매겨지는가"
TX << 'SQL' | grep -E "^(신규|판정)"
begin;
insert into registrations (campus_id, student_id, name, attendance_type, departure_slot_id, uses_return_bus)
values ((select id from campuses where name='전남대'), '26', '장부테스트', 'roundtrip',
        (select id from departure_slots where event_id=public.active_event_id() order by display_order limit 1), true)
returning '신규 등록 fee: '||fee;
select '판정: '||case when fee=50000 then 'PASS — 행사 요금표(왕복 50000) 적용'
                     else 'FAIL — fee '||fee end
  from registrations where name='장부테스트';
rollback;
SQL

echo
echo "### 6. 장부이 행사 범위를 지키는가 (다른 행사 데이터가 새지 않는가)"
Q "select '활성 행사 장부: '||count(*) from payment_ledger where event_id=public.active_event_id();
   select '전체 장부: '||count(*)||' (같아야 정상 — 행사 1개)' from payment_ledger;"

echo
echo "### 7. 되돌리기 가능한가"
Q "select '이관분(source=migration): '||count(*)||'건 → delete 한 줄로 원복 가능' from payment_ledger where source='migration';"
