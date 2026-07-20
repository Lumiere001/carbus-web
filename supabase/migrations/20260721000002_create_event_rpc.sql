-- ============================================================
-- Phase 1 (3/4) — 비파괴 행사 전환 RPC
-- ============================================================
-- "초기화 버튼"의 실체. 데이터를 지우지 않는다.
--   지난 행사를 비활성으로 내리고 새 행사를 활성으로 올리면,
--   RLS·뷰가 활성 행사만 보여주므로 화면은 비워지고 기록은 남는다.
--
-- 되돌리기: 새 행사를 비활성으로, 이전 행사를 활성으로 되돌리면 그대로 복구된다.
--   (그래서 이 동작에는 "정말 삭제할까요?" 같은 확인 절차가 필요 없다)
-- ============================================================

create or replace function public.create_event(
  p_name        text,
  p_subtitle    text    default null,
  p_starts_on   date    default null,
  p_ends_on     date    default null,
  p_origin      text    default null,
  p_destination text    default null,
  -- 차량·운행편은 행사마다 거의 같으므로 기본으로 복제한다.
  -- 복제하지 않으면 새 행사에 호차가 0대라 배차를 아예 못 돌린다.
  p_copy_trips  boolean default true,
  p_copy_buses  boolean default true
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_old  uuid;
  v_new  uuid;
  v_next smallint;
  r      record;
begin
  if public.current_role() <> 'master' then
    raise exception '행사 전환은 master 만 할 수 있습니다';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception '행사 이름은 비울 수 없습니다';
  end if;

  v_old := public.active_event_id();

  -- 옛 슬롯 → 새 슬롯 매핑. 운행편을 복제하지 않아도 아래 차량 복제가 참조하므로
  -- 루프 밖에서 미리 만든다(비어 있으면 매핑 없이 원래 슬롯 id 를 쓴다).
  create temp table if not exists _slot_map (old_id smallint, new_id smallint) on commit drop;
  delete from _slot_map;

  -- 활성은 항상 1개(uq_events_single_active). 내리고 올린다.
  update events set is_active = false where is_active;

  insert into events (name, subtitle, starts_on, ends_on, origin, destination, is_active)
  values (btrim(p_name), p_subtitle, p_starts_on, p_ends_on, p_origin, p_destination, true)
  returning id into v_new;

  -- ── 운행편 복제 ──────────────────────────────────────────
  -- departure_slots.id 는 GENERATED ALWAYS identity 라 값을 직접 넣을 수 없다.
  -- 생성된 id 를 돌려받아 옛 슬롯 → 새 슬롯 매핑을 만든다(아래 차량 복제가 참조).
  if p_copy_trips and v_old is not null then
    for r in
      select * from departure_slots where event_id = v_old order by display_order, id
    loop
      insert into departure_slots (key, label, display_order, active, event_id)
      values (r.key, r.label, r.display_order, r.active, v_new)
      returning id into v_next;
      insert into _slot_map values (r.id, v_next);
    end loop;
  end if;

  -- ── 차량 복제 ────────────────────────────────────────────
  -- 차량순장·고정탑승은 지난 행사 신청자를 가리키므로 반드시 비운다.
  -- (안 비우면 새 행사 배차가 존재하지 않는 사람을 호차에 고정하려 한다)
  if p_copy_buses and v_old is not null then
    insert into buses (name, capacity, hard_cap, departure_slot_id, event_id,
                       driver_registration_id, fixed_passenger_ids,
                       down_driver_registration_id, down_fixed_passenger_ids)
    select b.name, b.capacity, b.hard_cap,
           coalesce((select m.new_id from _slot_map m where m.old_id = b.departure_slot_id),
                    b.departure_slot_id),
           v_new,
           null, '{}'::uuid[], null, '{}'::uuid[]
      from buses b
     where b.event_id = v_old
     order by b.id;
  end if;

  -- ── 차량순장 로그인 재매핑 ───────────────────────────────
  -- profiles.driver_bus_id 는 옛 행사 호차를 가리킨 채 남는다.
  -- 같은 이름의 새 호차로 옮겨 붙인다(없으면 해제).
  update profiles p
     set driver_bus_id = (
           select nb.id from buses nb
            where nb.event_id = v_new
              and nb.name = (select ob.name from buses ob where ob.id = p.driver_bus_id)
            limit 1)
   where p.driver_bus_id is not null;

  -- ── 캠퍼스 정산 행 생성 (전부 0원에서 시작) ──────────────
  insert into campus_payment_settlements (event_id, campus_id)
  select v_new, c.id from campuses c
  on conflict (event_id, campus_id) do nothing;

  -- ── 진행 단계 초기화 ─────────────────────────────────────
  -- system_config 는 싱글턴이라 "지금 활성 행사의 상태"를 뜻한다.
  update system_config
     set current_phase     = 'phase1',
         batch_enabled     = false,
         last_batch_at     = null,
         phase2_started_at = null,
         updated_at        = now()
   where id = 1;

  return v_new;
end $$;

comment on function public.create_event is
  '새 행사를 만들고 활성으로 전환한다. 지난 행사 데이터는 삭제하지 않고 보관된다.';

revoke all on function public.create_event(text, text, date, date, text, text, boolean, boolean) from public, anon;
grant execute on function public.create_event(text, text, date, date, text, text, boolean, boolean) to authenticated;

-- ── 행사 되돌리기 ────────────────────────────────────────────
-- 잘못 전환했을 때 즉시 복구할 수 있어야 "삭제가 아니다"가 실질적으로 성립한다.
create or replace function public.activate_event(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() <> 'master' then
    raise exception '행사 전환은 master 만 할 수 있습니다';
  end if;
  if not exists (select 1 from events where id = p_event_id) then
    raise exception '없는 행사입니다';
  end if;
  update events set is_active = false where is_active;
  update events set is_active = true  where id = p_event_id;
end $$;

comment on function public.activate_event is '행사 활성 전환(되돌리기 포함). master 전용.';

revoke all on function public.activate_event(uuid) from public, anon;
grant execute on function public.activate_event(uuid) to authenticated;

-- ── 행사별 요약 ──────────────────────────────────────────────
-- 지난 행사의 신청 건수는 RLS(활성 행사 범위) 때문에 일반 쿼리로 셀 수 없다.
-- "지난 행사 신청 599건" 같은 표시를 위해 집계만 SECURITY DEFINER 로 뽑는다.
-- 개별 행은 노출하지 않는다 — 건수만.
create or replace function public.event_summary()
returns table (event_id uuid, reg_count bigint, batch_count bigint)
language sql stable security definer set search_path = public as $$
  select e.id,
         (select count(*) from registrations r where r.event_id = e.id),
         (select count(*) from batch_runs b where b.event_id = e.id)
    from events e
   where public.current_role() in ('master', 'viewer')
$$;

comment on function public.event_summary is
  '행사별 신청·배차 건수. RLS 범위 밖(지난 행사) 집계를 위해 SECURITY DEFINER. 건수만 반환.';

revoke all on function public.event_summary() from public, anon;
grant execute on function public.event_summary() to authenticated;
