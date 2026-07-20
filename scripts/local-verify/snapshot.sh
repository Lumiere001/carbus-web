#!/bin/bash
# 로컬 DB 상태 스냅샷 — 마이그레이션 전후 비교용.
# 행수 + 핵심 집계 + 뷰 결과 + 제약/정책 목록을 한 번에 뽑는다.
set -euo pipefail
Q() { docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c "$1"; }

echo "### 행수"
for t in campuses departure_slots buses profiles registrations role_labels system_config batch_runs registration_audit campus_remittances campus_payment_settlements; do
  printf "%-28s %s\n" "$t" "$(Q "select count(*) from public.$t")"
done

echo
echo "### 핵심 집계"
Q "select 'fee합계  '||coalesce(sum(fee),0) from registrations
   union all select 'fee분포  '||string_agg(f||':'||c,' ' order by f) from (select fee f,count(*) c from registrations group by 1) x
   union all select 'payment  '||string_agg(p||':'||c,' ' order by p) from (select payment_status p,count(*) c from registrations group by 1) y
   union all select 'attend   '||string_agg(a||':'||c,' ' order by a) from (select attendance_type a,count(*) c from registrations group by 1) z
   union all select '상행배차 '||count(*) from registrations where assigned_up_bus_id is not null
   union all select '하행배차 '||count(*) from registrations where assigned_down_bus_id is not null
   union all select '체크인   '||count(*) from registrations where checked_in
   union all select '체크아웃 '||count(*) from registrations where checked_out"

echo
echo "### 뷰 결과"
echo "-- v_day_capacity"
Q "select slot_id||'|'||coalesce(slot_label,'')||'|'||coalesce(total_capacity,0)||'|'||coalesce(total_passengers,0)||'|'||coalesce(arrived,0) from v_day_capacity order by slot_id"
echo "-- v_bus_occupancy"
Q "select bus_id||'|'||bus_name||'|'||coalesce(departure_slot_id::text,'-')||'|'||coalesce(up_passengers,0)||'|'||coalesce(down_passengers,0) from v_bus_occupancy order by bus_id"
echo "-- v_campus_stats (상위 5)"
Q "select campus_name||'|'||coalesce(total,0)||'|'||coalesce(return_target,0)||'|'||coalesce(returned_count,0) from v_campus_stats order by total desc nulls last, campus_name limit 5"
echo "-- v_payment_summary"
Q "select campus_name||'|'||coalesce(paid_count,0)||'|'||coalesce(unpaid_count,0)||'|'||coalesce(waived_count,0) from v_payment_summary order by campus_name"
echo "-- v_payment_3way_comparison"
Q "select campus_name||'|'||coalesce(system_paid_total,0)||'|'||coalesce(campus_remitted_total,0)||'|'||coalesce(master_received_total,0) from v_payment_3way_comparison order by campus_name"

echo
echo "### 제약 (UNIQUE/PK)"
Q "select conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid) from pg_constraint
   where contype in ('u','p') and connamespace='public'::regnamespace order by 1"

echo
echo "### UNIQUE 인덱스 (제약 미포함분까지 — 제약만 보면 놓친다)"
Q "select tablename||' '||indexname||' '||regexp_replace(indexdef,'^.*USING btree ','') from pg_indexes
   where schemaname='public' and indexdef like '%UNIQUE%' order by tablename, indexname"

echo
echo "### RLS 정책 수"
Q "select t||' '||c from (select tablename t, count(*) c from pg_policies where schemaname='public' group by tablename) x order by t"

echo
echo "### 뷰 security_invoker"
Q "select c.relname||' '||coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name='security_invoker'),'false')
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v' order by 1"
