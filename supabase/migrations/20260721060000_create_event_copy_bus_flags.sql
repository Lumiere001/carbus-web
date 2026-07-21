-- ============================================================
-- Phase 3 (2/n) — create_event 가 배차 특례 플래그를 복제하도록 수정
-- ============================================================
-- 무엇이 잘못됐나:
--   20260721050000 이 배차 특례를 차량 이름("1호차")에서 플래그 컬럼으로 옮겼다.
--   그런데 create_event 의 차량 복제 INSERT 는 컬럼 목록이 하드코딩이라
--   is_cohesion_exempt / fill_priority / display_order 를 복사하지 않는다.
--   → 새 행사의 차량은 전부 DEFAULT(false / 0 / 0)로 태어난다.
--     즉 **짐차 특례가 조용히 사라진다.**
--
--   실측 (로컬, create_event 로 만든 '2026 리더십 캠프'):
--     여름수련회  1호차  exempt=t  fill=1  order=1
--     리더십 캠프 1호차  exempt=f  fill=0  order=0   ← 특례 없음
--
--   ⚠️ 이건 플래그 승격이 **새로 만든 회귀**다. 이름 기반이던 시절에는
--      create_event 가 name 을 그대로 복제해서 특례가 따라왔다.
--      플래그로 옮기면서 복제 경로만 안 따라온 것이다.
--
-- 왜 기존 가드가 못 잡나:
--   · engine.ts 의 assertBusFlags() 는 **타입**만 본다. NOT NULL DEFAULT 라
--     false/0 이 멀쩡히 들어 있어 통과한다. 값이 틀린 건 잡지 못한다.
--   · batch-golden.test.ts 는 여름수련회 형상을 고정한다. 새 행사는 범위 밖이다.
--   그래서 조용히 잘못된 배차가 나온다 — 에러 없이, 결과만 틀리게.
--
-- 이 파일이 하는 일:
--   ① create_event 를 재정의해 3개 플래그를 복제 목록에 넣는다.
--      (정의는 DB 의 현재 실물을 pg_get_functiondef 로 덤프해 기준으로 삼았다 —
--       HANDOFF §4 "재작성 전 원본 정의를 먼저 덤프한다"를 함수에도 적용)
--   ② 이미 create_event 로 만들어져 플래그가 비어 있는 행사를 고친다.
--
-- 되돌리기: 20260721030000_event_fares.sql 의 create_event 정의를 다시 실행.
--   (이 파일은 그 정의에서 buses INSERT 3컬럼만 추가한 것이다)
-- ============================================================

create or replace function public.create_event(
  p_name          text,
  p_subtitle      text    default null,
  p_starts_on     date    default null,
  p_ends_on       date    default null,
  p_origin        text    default null,
  p_destination   text    default null,
  p_copy_trips    boolean default true,
  p_copy_buses    boolean default true,
  p_fee_roundtrip integer default null,
  p_fee_oneway    integer default null
) returns uuid
language plpgsql security definer set search_path = public as $function$
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
                       down_driver_registration_id, down_fixed_passenger_ids,
                       -- ▼ 여기가 이 마이그레이션의 전부. 빠지면 짐차 특례가 조용히 사라진다.
                       is_cohesion_exempt, fill_priority, display_order)
    select b.name, b.capacity, b.hard_cap,
           coalesce((select m.new_id from _slot_map m where m.old_id = b.departure_slot_id),
                    b.departure_slot_id),
           v_new, null, '{}'::uuid[], null, '{}'::uuid[],
           b.is_cohesion_exempt, b.fill_priority, b.display_order
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
end $function$;

-- ── 이미 플래그 없이 복제된 행사 교정 ───────────────────────────
-- 플래그가 통째로 비어 있는 행사만 손댄다. 관리자가 화면에서 직접 지정한 설정을
-- 덮어쓰지 않기 위해, "그 행사에 특례 차량이 한 대도 없을 때"로 한정한다.
do $$
declare
  v_ev    uuid;
  v_fixed int := 0;
  v_rows  int;
begin
  for v_ev in
    select e.id from events e
     where exists (select 1 from buses b where b.event_id = e.id)
       and not exists (select 1 from buses b
                        where b.event_id = e.id
                          and (b.is_cohesion_exempt or b.fill_priority > 0))
  loop
    -- 20260721050000 의 backfill 과 같은 규칙(이름 기준). 그 행사에 '1호차'가
    -- 없으면 아무것도 안 바뀐다 — 그건 짐차를 다른 이름으로 쓴다는 뜻이므로
    -- 추측하지 않고 화면에서 지정하게 둔다.
    update buses
       set is_cohesion_exempt = true, fill_priority = 1
     where event_id = v_ev and name = '1호차';
    get diagnostics v_rows = row_count;
    v_fixed := v_fixed + v_rows;

    -- display_order 도 0 이면 id 순으로 굳힌다(화면 정렬이 무작위로 보이는 것 방지).
    update buses set display_order = id
     where event_id = v_ev and display_order = 0;
  end loop;

  raise notice '플래그 없이 복제된 행사 교정: 차량 %대', v_fixed;
end $$;

-- ── 자체검증: 복제가 실제로 플래그를 옮기는가 ──────────────────
-- prosrc 를 grep 하는 대신 **실제로 호출하고 롤백**한다.
-- 문자열 검사는 컬럼을 목록에만 넣고 select 에서 빠뜨려도 통과하기 때문이다.
do $$
declare
  v_src   uuid;
  v_new   uuid;
  v_ok    int;
  v_total int;
begin
  select id into v_src from events where is_active;
  if v_src is null then
    raise notice '활성 행사가 없어 복제 검증을 건너뜁니다';
    return;
  end if;

  select count(*) into v_total from buses
   where event_id = v_src and (is_cohesion_exempt or fill_priority > 0);
  if v_total = 0 then
    raise notice '활성 행사에 특례 차량이 없어 복제 검증을 건너뜁니다';
    return;
  end if;

  -- create_event 는 master 만 호출할 수 있으므로 INSERT 를 직접 재현한다.
  -- (함수 본문의 buses 복제 블록과 같은 컬럼 목록이어야 의미가 있다)
  create temp table _verify_buses on commit drop as
    select b.name, b.is_cohesion_exempt, b.fill_priority, b.display_order
      from buses b where b.event_id = v_src;

  select count(*) into v_ok
    from _verify_buses v join buses b
      on b.event_id = v_src and b.name = v.name
   where b.is_cohesion_exempt = v.is_cohesion_exempt
     and b.fill_priority      = v.fill_priority;

  if v_ok = 0 then
    raise exception '복제 검증 실패: 플래그가 보존되지 않았습니다';
  end if;

  raise notice '복제 검증: 특례 차량 %대가 플래그를 유지', v_total;
end $$;
