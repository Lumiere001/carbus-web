#!/usr/bin/env bash
# ============================================================
# 적재 후 backfill 일괄 재실행 (로컬 검증 전용)
# ============================================================
# load-backup.py 로 운영 백업을 넣은 뒤 이 스크립트를 한 번 돌리면
# 로컬이 운영과 같은 상태가 된다.
#
# 왜 필요한가:
#   supabase db reset 은 마이그레이션을 먼저 적용한다. 그 시점엔 테이블이 비어 있어
#   "데이터에 의존하는 backfill"은 0건을 처리하고 끝난다. 그 뒤 백업을 넣으면
#   backfill 결과만 빠진 상태가 된다.
#
# 왜 마이그레이션 파일을 다시 부르나:
#   payment_ledger 는 백업 대상 테이블이 아니다(backup-prod.mjs TABLES 에 없다).
#   그래서 백업에서 복원되지 않고, 이관 마이그레이션을 다시 돌려야만 채워진다.
#   해당 마이그레이션은 source='migration' 존재 여부로 스스로 재실행을 막는다.
#
# 새 Phase 에서 데이터 의존 backfill 이 생기면 아래 MIGRATIONS 에 추가할 것.
#
# 사용법:  bash scripts/local-verify/post-load.sh
# ============================================================
set -euo pipefail

CONTAINER="supabase_db_carbus-web"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 백업에서 복원되지 않아 재실행이 필요한 마이그레이션 (적용 순서대로)
#
# 두 종류가 여기 들어온다:
#   ① 백업 대상 테이블이 아니라 아예 복원되지 않는 것 (payment_ledger)
#   ② 백업을 뜬 시점에 없던 컬럼이라 복원 시 DEFAULT 로 앉는 것 (buses 배차 플래그)
#      로더는 백업 JSON 에 실제로 있는 컬럼만 INSERT 하므로, 백업보다 나중에 생긴
#      컬럼은 전부 DEFAULT 가 된다. 플래그가 false/0 이면 짐차 특례가 꺼진 상태라
#      골든 스냅샷 대조가 통째로 무의미해진다.
MIGRATIONS=(
  "supabase/migrations/20260721020100_ledger_backfill.sql"   # Phase 2-A 장부 이관
  "supabase/migrations/20260721050000_bus_batch_flags.sql"   # Phase 3 배차 특례 플래그
  "supabase/migrations/20260721070000_event_trips.sql"       # Phase 3 하행 편 생성 + 차량 연결
)

run_sql_file() {
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$1"
}

echo "── post-load.sql (컬럼 backfill)"
run_sql_file "$REPO_ROOT/scripts/local-verify/post-load.sql"

for m in "${MIGRATIONS[@]}"; do
  echo "── $m"
  run_sql_file "$REPO_ROOT/$m"
done

echo "── 정합성 확인"
# 행수만 보면 "적재 성공"인데 실제로는 망가진 상태가 있다.
# 실제 사례: 컬럼 rename(buses.departure_slot_id → up_trip_id)을 로더가 못 따라가
# 전 차량 up_trip_id 가 NULL 이 됐다. 행수는 11/11 로 멀쩡했고 적재는 PASS 였지만
# 상행 배차가 0건이 되는 상태였다. 값이 비면 여기서 크게 실패시킨다.
docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare v_bad int;
begin
  select count(*) into v_bad from buses where up_trip_id is null;
  if v_bad > 0 then
    raise exception '상행 편 미연결 차량 %대 — 백업 적재가 컬럼을 흘렸습니다 (load-backup.py RENAMED_COLUMNS 확인)', v_bad;
  end if;

  select count(*) into v_bad from buses where down_trip_id is null;
  if v_bad > 0 then
    raise exception '하행 편 미연결 차량 %대', v_bad;
  end if;

  -- 신청의 상행 편이 실제 운행편을 가리키는가
  select count(*) into v_bad
    from registrations r
   where r.up_trip_id is not null
     and not exists (select 1 from event_trips t
                      where t.id = r.up_trip_id and t.direction = 'up');
  if v_bad > 0 then
    raise exception '존재하지 않는 상행 편을 가리키는 신청 %건', v_bad;
  end if;

  select count(*) into v_bad
    from registrations r
   where r.down_trip_id is not null
     and not exists (select 1 from event_trips t
                      where t.id = r.down_trip_id and t.direction = 'down');
  if v_bad > 0 then
    raise exception '존재하지 않는 하행 편을 가리키는 신청 %건', v_bad;
  end if;

  -- 파생 트리거가 ALWAYS 인가. ORIGIN 이면 다음 백업 적재가 CHECK 위반으로 통째로 실패한다.
  -- `enable trigger user` 를 쓰는 블록이 하나라도 지나가면 조용히 내려가므로 매번 확인한다.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'registrations' and t.tgname = 'trg_reg_000_derive'
       and t.tgenabled = 'A'
  ) then
    raise exception 'trg_reg_000_derive 가 ENABLE ALWAYS 가 아닙니다 — 백업 적재가 실패합니다';
  end if;
end $$;
SQL
echo "  OK — 차량·신청이 운행편에 정상 연결됨"

echo "── 기준선 확인"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -q -c "
select '신청' k, count(*)::text v from registrations
union all select '감사로그', count(*)::text from registration_audit
union all select '소속(home_unit_id)', count(*)::text from registrations where home_unit_id is not null
union all select '장부', count(*)::text from payment_ledger
union all select '차액', count(*)::text from v_payment_balance where balance > 0
union all select '배차 상행', count(*)::text from registrations where assigned_up_bus_id is not null
union all select '배차 하행', count(*)::text from registrations where assigned_down_bus_id is not null;"

cat <<'EOF'

기대값 (2026-07-21 기준):
  신청 599 · 감사로그 18967 · 소속 65 · 장부 1081 · 차액 46
  배차 상행 454 / 하행 459
EOF
