-- ============================================================
-- [핫픽스] 정산·송금 경로의 행사 범위 복구
-- ============================================================
-- Phase 1 이 campus_payment_settlements 의 PK 를
--   (campus_id) → (event_id, campus_id)
-- 로 바꿨는데, 그 PK 를 ON CONFLICT 대상으로 쓰던 곳을 같이 못 고쳤다.
--
-- 증상 (지금 운영에서 100% 재현):
--   ERROR: there is no unique or exclusion constraint matching
--          the ON CONFLICT specification
--   → 캠퍼스가 송금을 등록하는 순간 실패한다.
--   campus_remittances 가 0행이라 아직 아무도 안 밟았을 뿐이다.
--   하필 Phase 2 의 목표가 "송금 등록률을 올리는 것"이라 그대로 두면
--   개선한 화면이 첫 클릭에서 에러를 뱉는다.
--
-- 함께 고치는 것:
--   · 송금 누계 SUM 이 행사 구분 없이 전 행사를 합산하던 문제(잠복 버그).
--     지금은 행사가 1개라 드러나지 않지만, 리더십 캠프를 열면 지난 수련회
--     송금액이 새 행사 정산에 섞인다.
--   · campus_remit_delete 의 행사 범위 누락(보안). SECURITY DEFINER 라
--     Phase 1 의 RESTRICTIVE 정책을 우회하는데 event_id 조건이 없어,
--     campus_admin 이 지난 행사 원장 행을 지울 수 있었다.
--
-- 되돌리기: 이 파일의 두 함수를 20260520140000 의 원본 정의로 되돌리면 된다.
--   단 그 상태는 PK 불일치로 다시 깨지므로, 되돌릴 이유는 사실상 없다.
-- ============================================================

-- ── 1. 송금 누계 동기화 — 행사 범위 적용 ────────────────────
create or replace function public.sync_campus_remitted_total()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cid uuid := coalesce(new.campus_id, old.campus_id);
  eid uuid := coalesce(new.event_id, old.event_id);
begin
  insert into campus_payment_settlements (event_id, campus_id, campus_remitted_total, updated_at)
  values (
    eid,
    cid,
    (select coalesce(sum(amount), 0)
       from campus_remittances
      where campus_id = cid
        and event_id = eid),      -- 행사별로 합산해야 다음 행사에 섞이지 않는다
    now()
  )
  on conflict (event_id, campus_id) do update
    set campus_remitted_total = excluded.campus_remitted_total,
        updated_at = now();
  return null;
end $$;

-- ── 2. 송금 항목 삭제 — 활성 행사로 제한 ────────────────────
create or replace function public.campus_remit_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- SECURITY DEFINER 라 RLS(RESTRICTIVE event_scope)를 우회한다.
  -- 그래서 행사 범위를 본문에서 직접 강제해야 한다.
  if public.current_role() = 'campus_admin' then
    delete from campus_remittances
     where id = p_id
       and campus_id = public.current_campus()
       and event_id = public.active_event_id();
  elsif public.current_role() = 'master' then
    delete from campus_remittances
     where id = p_id
       and event_id = public.active_event_id();
  else
    raise exception '권한이 없습니다';
  end if;
end $$;

-- ── 3. 적용 검증 ─────────────────────────────────────────────
-- 실제로 송금 등록이 되는지 트랜잭션 안에서 시험하고 되돌린다.
-- 여기서 실패하면 마이그레이션 전체가 롤백돼 깨진 상태로 배포되지 않는다.
do $$
declare v_campus uuid; v_before int; v_after int;
begin
  select id into v_campus from campuses order by display_order limit 1;
  if v_campus is null then
    raise notice '캠퍼스가 없어 검증을 건너뜁니다';
    return;
  end if;

  select campus_remitted_total into v_before
    from campus_payment_settlements
   where campus_id = v_campus and event_id = public.active_event_id();

  insert into campus_remittances (campus_id, amount, note, created_by)
  values (v_campus, 12345, '[마이그레이션 자체검증]', null);

  select campus_remitted_total into v_after
    from campus_payment_settlements
   where campus_id = v_campus and event_id = public.active_event_id();

  if coalesce(v_after, 0) <> coalesce(v_before, 0) + 12345 then
    raise exception '송금 누계 동기화 실패: % → % (기대 %)',
      v_before, v_after, coalesce(v_before, 0) + 12345;
  end if;

  -- 검증용 행과 그 여파를 되돌린다
  delete from campus_remittances where note = '[마이그레이션 자체검증]';

  raise notice '송금 등록 경로 검증 통과 (% → % → 원복)', v_before, v_after;
end $$;
