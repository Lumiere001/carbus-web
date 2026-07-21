-- ============================================================
-- 적재 후 backfill 재실행 (로컬 검증 전용)
-- ============================================================
-- 왜 필요한가:
--   supabase db reset 은 마이그레이션을 먼저 적용한다. 그 시점엔 테이블이 비어 있으므로
--   "데이터에 의존하는 backfill"은 0건을 처리하고 끝난다.
--   그 뒤 load-backup.py 가 운영 데이터를 넣으면 backfill 결과가 빠진 상태가 된다.
--   → 적재 후 이 파일을 한 번 실행해 로컬을 운영과 동일한 상태로 맞춘다.
--
-- 모든 문장은 **여러 번 돌려도 같은 결과**여야 한다(idempotent).
-- 새 Phase 에서 데이터 의존 backfill 을 추가하면 여기에도 같이 넣을 것.
-- ============================================================

-- ── Phase 1: registrations.home_unit_id (org_units 매칭) ─────
-- 감사 트리거를 끄고 갱신한다 — 새 컬럼 채우기는 업무 변경이 아니므로 이력에 남기지 않는다.
do $$
declare matched int;
begin
  alter table public.registrations disable trigger user;

  with tj as (
    select r.id,
           btrim(split_part(split_part(split_part(r.note, ',', 1), '(', 1), E'\n', 1)) as head
      from registrations r
      join campuses c on c.id = r.campus_id
     where c.name = '타지구'
       and coalesce(btrim(r.note), '') <> ''
  )
  update registrations r
     set home_unit_id = u.id
    from tj
    join org_units u
      on u.name = tj.head or tj.head = any(u.aliases)
   where r.id = tj.id
     and r.home_unit_id is distinct from u.id;

  get diagnostics matched = row_count;

  alter table public.registrations enable trigger user;
  raise notice 'home_unit_id backfill: %건', matched;
end $$;

-- ⚠️ 데이터 의존 backfill 이 이 파일에만 있는 게 아니다.
--    payment_ledger 이관(Phase 2-A)은 마이그레이션 파일 자체를 재실행해야 하므로
--    post-load.sh 가 이 파일 다음에 이어서 돌린다. 이 파일만 단독 실행하면
--    로컬 장부가 0건이 되어 차액 46명이 재현되지 않는다. → post-load.sh 를 쓸 것.
