-- ============================================================
-- 행사를 넘겨도 간사 차량은 간사 차량으로 남는다 (§26-E 후속)
-- ============================================================
-- 동규님 지적: "간사 차량에는 미리 선택한 인원만 들어가야 한다.
--              이번뿐 아니라 **다른 모든 행사에서도** 적용되는 거야."
--
-- 그 요구가 걸리는 자리가 하나 있었다. `create_event` 의 차량 복제 목록에
-- `kind` 가 빠져 있었다. 그러면 다음 행사로 넘어가는 순간 `A간사차` 가
-- **일반 버스로 복제**되어 자동 배차 대상이 된다 — 캠퍼스 인원이 간사 차에
-- 밀려 들어간다. 정원 4는 따라가므로 44명이 아니라 4명이지만, 그래도 결함이다.
--
-- 한 줄만 더한다. 함수 본문의 나머지는 20260728130000 그대로다.
-- ============================================================


-- ⚠️ 이 함수를 **20260728130000 의 본문에서** 가져왔다. DB 에 살아 있는 정의를
--    베끼면 안 됐다 — post-load 가 재실행하는 20260721070000 이 create_event 를
--    다시 정의해서, 로컬 DB 의 함수는 §24·§25 수정이 **되돌려진 옛 버전**이었다.
--    그대로 베꼈으면 행사 전환이 다시 두 가지 방식으로 터졌을 것이다.
--    (post-load.sh 의 재실행 목록도 함께 고쳤다.)

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
  v_hdr  text;
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

  -- ⚠️ 여기서부터 쓰는 대상은 **새 행사**다. 그런데 요청 헤더(x-carbus-event)는
  --    아직 "지금 보고 있는 행사"(= 옛 행사)를 가리키고 있어서, 아래 insert 들이
  --    쓰기 가드(guard_event_writable)에 걸린다:
  --      "보고 있는 행사와 저장하려는 행사가 다릅니다."
  --    실제로 이것 때문에 화면에서 행사 전환이 **한 번도 성공하지 못했다.**
  --    (편성·차량 이어받기를 꺼도 campus_payment_settlements 시드는 항상 돈다)
  --
  --    그래서 선언을 새 행사로 갱신한다. 가드를 끄는 게 아니라 **의도를 정확히
  --    말해 주는 것**이다 — 가드는 그대로 살아 있고, 이제 진짜로 새 행사에 쓴다.
  --    트랜잭션 로컬(set_config 세 번째 인자 true)이라 이 호출 밖으로 안 샌다.
  v_hdr := current_setting('request.headers', true);
  perform set_config(
    'request.headers',
    case
      when v_hdr is not null and v_hdr is json object
        then (v_hdr::jsonb || jsonb_build_object('x-carbus-event', v_new::text))::text
      else jsonb_build_object('x-carbus-event', v_new::text)::text
    end,
    true);

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
                       is_cohesion_exempt, fill_priority, display_order, kind)
    select b.name, b.capacity, b.hard_cap,
           (select m.new_id from _trip_map m where m.old_id = b.up_trip_id),
           (select m.new_id from _trip_map m where m.old_id = b.down_trip_id),
           v_new, null, '{}'::uuid[], null, '{}'::uuid[],
           b.is_cohesion_exempt, b.fill_priority, b.display_order,
           -- 차량 종류도 함께 넘긴다. 빠뜨리면 다음 행사에서 간사 차량이
           -- **일반 버스로 되살아나** 자동 배차 대상이 된다 (§26-E).
           b.kind
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

-- ── 자체검증 ─────────────────────────────────────────────────
-- §25-C 의 교훈대로 **앱과 같은 조건**을 만든다 — 헤더를 옛 행사로 세팅한 채 부른다.
-- (행사 전환은 화면에서만 쓰는 RPC 라 psql 기본 상태로는 가드를 안 지난다.)
do $$
declare
  v_old   uuid := public.active_event_id();
  v_new   uuid;
  v_trip  smallint;
  v_car   int;
  v_kinds text;
begin
  perform set_config('request.headers',
                     jsonb_build_object('x-carbus-event', v_old::text)::text, true);

  -- 간사 차량을 하나 만들어 두고 행사를 넘긴다.
  select id into v_trip from event_trips
   where event_id = v_old and direction = 'up' and active limit 1;
  if v_trip is null then
    raise notice '  (상행 편이 없어 검증 건너뜀)';
    return;
  end if;

  insert into buses (event_id, name, capacity, hard_cap, up_trip_id, kind, display_order)
  values (v_old, '__검증용 간사차__', 4, 4, v_trip, 'staff_car', 990)
  returning id into v_car;

  v_new := public.create_event('__검증용 다음 행사__',
                               p_copy_trips => true, p_copy_buses => true);

  -- 복제된 쪽에서 그 차가 **여전히 간사 차량인가**
  select string_agg(kind::text, ',') into v_kinds
    from buses where event_id = v_new and name = '__검증용 간사차__';

  if v_kinds is distinct from 'staff_car' then
    raise exception
      '검증 실패: 다음 행사로 넘어가면서 간사 차량이 % 가 됐습니다 (staff_car 예상)',
      coalesce(v_kinds, '복제 안 됨');
  end if;
  raise notice '검증 ①: 행사를 넘겨도 간사 차량으로 남음 OK';

  -- 일반 버스는 그대로 일반 버스여야 한다 (반대로 뒤집히면 배차가 통째로 멈춘다)
  if exists (select 1 from buses where event_id = v_new and name <> '__검증용 간사차__'
                                   and kind <> 'bus') then
    raise exception '검증 실패: 일반 버스가 간사 차량으로 복제됐습니다';
  end if;
  raise notice '검증 ②: 일반 버스는 그대로 OK';

  raise exception '__검증완료_롤백';
exception when others then
  perform set_config('request.headers', '', true);
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;
