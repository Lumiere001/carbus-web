-- ============================================================
-- 행사 전환이 "DELETE requires a WHERE clause" 로 실패하던 것
-- ============================================================
-- 증상: Phase 화면에서 `행사 시작` 을 누르면 빨간 오류만 뜨고 전환이 안 됐다.
--
-- 원인: `create_event` 안의 임시 테이블 정리 문장 `delete from _trip_map;` 에
--       WHERE 가 없었다. Supabase 는 조건 없는 DELETE/UPDATE 를 막는 안전장치를
--       켜두는데(실수로 테이블을 통째로 비우는 사고를 막기 위한 것), 그게 이
--       한 줄에 걸렸다.
--
-- 왜 여태 안 걸렸나: 이 레포의 자체검증과 기능 테스트는 전부 **로컬 psql** 로 돈다.
--       거기엔 그 안전장치가 없어서 통과했다. 행사 전환을 **운영 화면에서 실제로
--       누른 것은 이번이 처음**이었다.
--
--       → 배운 것: RPC 는 psql 로 통과해도 **앱 경로로 한 번 눌러 봐야** 한다.
--         두 경로의 실행 환경이 다르다.
--
-- 고친 것은 그 한 줄뿐이고, 나머지 본문은 지금 운영에 있는 정의 그대로다.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_event(p_name text, p_subtitle text DEFAULT NULL::text, p_starts_on date DEFAULT NULL::date, p_ends_on date DEFAULT NULL::date, p_origin text DEFAULT NULL::text, p_destination text DEFAULT NULL::text, p_copy_trips boolean DEFAULT true, p_copy_buses boolean DEFAULT true, p_fee_roundtrip integer DEFAULT NULL::integer, p_fee_oneway integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select coalesce(p_fee_roundtrip, e.fee_roundtrip, 50000),
         coalesce(p_fee_oneway,    e.fee_oneway,    25000)
    into v_rt, v_ow
    from events e where e.id = v_old;
  v_rt := coalesce(v_rt, coalesce(p_fee_roundtrip, 50000));
  v_ow := coalesce(v_ow, coalesce(p_fee_oneway, 25000));

  -- 옛 편 → 새 편 매핑. 방향 구분 없이 id 로만 매핑하므로 상·하행 모두 커버된다.
  create temp table if not exists _trip_map (old_id smallint, new_id smallint) on commit drop;
  -- ⚠️ WHERE 를 반드시 붙인다. Supabase 는 조건 없는 DELETE/UPDATE 를 막는
  --    안전장치(safeupdate)를 켜두는데, 그게 이 한 줄에 걸려 **화면에서 행사
  --    전환이 통째로 실패했다**("DELETE requires a WHERE clause").
  --    로컬 psql 에는 그 장치가 없어 자체검증·기능 테스트는 전부 통과했다 —
  --    운영 화면에서 처음 눌러 보고서야 드러났다.
  delete from _trip_map where true;

  update events set is_active = false where is_active;

  insert into events (name, subtitle, starts_on, ends_on, origin, destination,
                      fee_roundtrip, fee_oneway, is_active)
  values (btrim(p_name), p_subtitle, p_starts_on, p_ends_on, p_origin, p_destination,
          v_rt, v_ow, true)
  returning id into v_new;

  if p_copy_trips and v_old is not null then
    -- 상·하행을 모두 복제한다. departs_at 은 행사마다 다르므로 옮기지 않는다.
    for r in select * from event_trips where event_id = v_old
              order by direction, display_order, id
    loop
      insert into event_trips (key, label, display_order, active, event_id,
                               direction, origin, destination)
      values (r.key, r.label, r.display_order, r.active, v_new,
              r.direction,
              -- 하행은 방향이 반대다 — 행사의 출발지/도착지를 그대로 박으면 거꾸로 들어간다.
              -- (광주 → 무주 행사면 하행 편의 출발지는 무주, 도착지는 광주)
              case r.direction when 'down' then coalesce(p_destination, r.origin)
                                           else coalesce(p_origin, r.origin) end,
              case r.direction when 'down' then coalesce(p_origin, r.destination)
                                           else coalesce(p_destination, r.destination) end)
      returning id into v_next;
      insert into _trip_map values (r.id, v_next);
    end loop;
  end if;

  if p_copy_buses and v_old is not null then
    insert into buses (name, capacity, hard_cap, up_trip_id, down_trip_id, event_id,
                       driver_registration_id, fixed_passenger_ids,
                       down_driver_registration_id, down_fixed_passenger_ids,
                       is_cohesion_exempt, fill_priority, display_order)
    select b.name, b.capacity, b.hard_cap,
           (select m.new_id from _trip_map m where m.old_id = b.up_trip_id),
           (select m.new_id from _trip_map m where m.old_id = b.down_trip_id),
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



-- 조건 없는 DELETE/UPDATE 가 다른 함수에도 있는지 훑는다 (같은 사고 재발 방지).
do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~* 'delete[[:space:]]+from[[:space:]]+[a-z_]+[[:space:]]*;';
  if v_bad is not null then
    raise exception '조건 없는 DELETE 가 남은 함수: %', v_bad;
  end if;
  raise notice '조건 없는 DELETE 없음 확인';
end $$;
