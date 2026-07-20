-- ============================================================
-- 행사별 차량비 설정
-- ============================================================
-- 지금까지 왕복 50,000원 / 편도 25,000원이 코드에 박혀 있었다.
-- 행사마다 거리도 차량도 다른데 금액은 고정이라, 다른 행사를 열면
-- 요금을 바꾸는 데 마이그레이션이 필요했다.
--
-- events.fee_roundtrip / fee_oneway 컬럼은 Phase 1 에서 만들어 뒀고
-- 청구액 트리거(apply_event_fare)도 이미 그 값을 읽는다.
-- 남은 것은 "행사를 만들 때 금액을 정하고, 나중에 고칠 수 있게" 하는 것뿐이다.
--
-- 주의: 요금을 바꿔도 **이미 등록된 사람의 청구액은 바뀌지 않는다.**
--   새로 등록하는 사람부터 적용된다. 이미 낸 사람의 금액을 소급해서
--   바꾸면 받은 돈의 근거가 흔들리기 때문이다(Phase 2-A 와 같은 이유).
--
-- 되돌리기: create_event 를 이전 시그니처로, update_event_fares 는 DROP.
-- ============================================================

-- ── 1. 행사 생성 시 요금 지정 ────────────────────────────────
-- 기존 시그니처에 인자를 덧붙이면 오버로드가 생겨 호출이 모호해진다.
-- 이전 버전을 지우고 새로 만든다.
drop function if exists public.create_event(text, text, date, date, text, text, boolean, boolean);

create or replace function public.create_event(
  p_name          text,
  p_subtitle      text    default null,
  p_starts_on     date    default null,
  p_ends_on       date    default null,
  p_origin        text    default null,
  p_destination   text    default null,
  p_copy_trips    boolean default true,
  p_copy_buses    boolean default true,
  -- 차량비. 넘기지 않으면 직전 행사 금액을 이어받는다.
  p_fee_roundtrip int     default null,
  p_fee_oneway    int     default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_old  uuid;
  v_new  uuid;
  v_next smallint;
  v_rt   int;
  v_ow   int;
  r      record;
begin
  if public.current_role() <> 'master' then
    raise exception '행사 전환은 master 만 할 수 있습니다';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception '행사 이름은 비울 수 없습니다';
  end if;
  if coalesce(p_fee_roundtrip, 0) < 0 or coalesce(p_fee_oneway, 0) < 0 then
    raise exception '차량비는 0원 이상이어야 합니다';
  end if;

  v_old := public.active_event_id();

  -- 금액을 안 넘기면 직전 행사 금액을 이어받는다(대개 비슷하므로).
  select coalesce(p_fee_roundtrip, e.fee_roundtrip, 50000),
         coalesce(p_fee_oneway,    e.fee_oneway,    25000)
    into v_rt, v_ow
    from events e where e.id = v_old;
  v_rt := coalesce(v_rt, coalesce(p_fee_roundtrip, 50000));
  v_ow := coalesce(v_ow, coalesce(p_fee_oneway, 25000));

  create temp table if not exists _slot_map (old_id smallint, new_id smallint) on commit drop;
  delete from _slot_map;

  update events set is_active = false where is_active;

  insert into events (name, subtitle, starts_on, ends_on, origin, destination,
                      fee_roundtrip, fee_oneway, is_active)
  values (btrim(p_name), p_subtitle, p_starts_on, p_ends_on, p_origin, p_destination,
          v_rt, v_ow, true)
  returning id into v_new;

  if p_copy_trips and v_old is not null then
    for r in select * from departure_slots where event_id = v_old order by display_order, id
    loop
      insert into departure_slots (key, label, display_order, active, event_id)
      values (r.key, r.label, r.display_order, r.active, v_new)
      returning id into v_next;
      insert into _slot_map values (r.id, v_next);
    end loop;
  end if;

  if p_copy_buses and v_old is not null then
    insert into buses (name, capacity, hard_cap, departure_slot_id, event_id,
                       driver_registration_id, fixed_passenger_ids,
                       down_driver_registration_id, down_fixed_passenger_ids)
    select b.name, b.capacity, b.hard_cap,
           coalesce((select m.new_id from _slot_map m where m.old_id = b.departure_slot_id),
                    b.departure_slot_id),
           v_new, null, '{}'::uuid[], null, '{}'::uuid[]
      from buses b where b.event_id = v_old order by b.id;
  end if;

  update profiles p
     set driver_bus_id = (
           select nb.id from buses nb
            where nb.event_id = v_new
              and nb.name = (select ob.name from buses ob where ob.id = p.driver_bus_id)
            limit 1)
   where p.driver_bus_id is not null;

  insert into campus_payment_settlements (event_id, campus_id)
  select v_new, c.id from campuses c
  on conflict (event_id, campus_id) do nothing;

  update system_config
     set current_phase = 'phase1', batch_enabled = false,
         last_batch_at = null, phase2_started_at = null, updated_at = now()
   where id = 1;

  return v_new;
end $$;

comment on function public.create_event is
  '새 행사를 만들고 활성으로 전환한다. 차량비를 지정할 수 있고, 생략하면 직전 행사 금액을 이어받는다. 지난 행사 데이터는 보관된다.';

revoke all on function public.create_event(text, text, date, date, text, text, boolean, boolean, int, int) from public, anon;
grant execute on function public.create_event(text, text, date, date, text, text, boolean, boolean, int, int) to authenticated;

-- ── 2. 진행 중인 행사의 요금 수정 ────────────────────────────
create or replace function public.update_event_fares(
  p_event_id      uuid,
  p_fee_roundtrip int,
  p_fee_oneway    int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() <> 'master' then
    raise exception '차량비 변경은 master 만 할 수 있습니다';
  end if;
  if p_fee_roundtrip < 0 or p_fee_oneway < 0 then
    raise exception '차량비는 0원 이상이어야 합니다';
  end if;

  update events
     set fee_roundtrip = p_fee_roundtrip,
         fee_oneway    = p_fee_oneway
   where id = p_event_id;

  if not found then
    raise exception '없는 행사입니다';
  end if;
end $$;

comment on function public.update_event_fares is
  '행사 차량비 변경. 이미 등록된 사람의 청구액은 바뀌지 않고 이후 등록분부터 적용된다.';

revoke all on function public.update_event_fares(uuid, int, int) from public, anon;
grant execute on function public.update_event_fares(uuid, int, int) to authenticated;
