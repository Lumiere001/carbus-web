-- ============================================================
-- 행사 전환이 쓰기 가드에 막히던 것
-- ============================================================
-- 증상: `행사 시작` 을 누르면
--       "보고 있는 행사와 저장하려는 행사가 다릅니다. 화면을 새로 고친 뒤 다시
--        시도해 주세요." 가 뜨고 전환이 안 됐다. 새로 고쳐도 마찬가지다.
--
-- 원인: `create_event` 는 **새 행사**에 쓰는데, 요청 헤더(`x-carbus-event`)는
--       화면이 보고 있는 **옛 행사**를 가리킨다. 행사 폴더화(Phase 4)에서 붙인
--       쓰기 가드가 그 불일치를 잡아 거부했다.
--
--       가드는 옳게 동작했다. 잘못된 쪽은 **함수가 의도를 선언하지 않은 것**이다.
--
--       편성·차량 이어받기를 꺼도 막힌다 — 함수 끝의 `campus_payment_settlements`
--       시드는 옵션과 무관하게 항상 돌기 때문이다. 즉 **행사 전환은 폴더화 이후
--       한 번도 성공할 수 없는 상태였다.**
--
-- 고친 것: 새 행사 행을 만든 **직후에 헤더를 새 행사로 갱신**한다. 가드를 끄지
--       않는다 — 이제 진짜로 새 행사에 쓰므로 선언을 사실과 맞추는 것뿐이다.
--       트랜잭션 로컬이라 이 호출 밖으로 새지 않는다.
--
-- ⚠️ §24 와 같은 뿌리다: **화면에서만 쓰는 RPC 를 psql 로만 검증했다.**
--    psql 에는 `request.headers` 가 아예 없어서 가드의 헤더 검사가 통째로
--    건너뛰어졌다. 아래 자체검증은 **헤더를 옛 행사로 세팅한 채** 호출해
--    운영과 같은 조건을 만든다.
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
end $function$

;

-- ── 자체검증 — 운영과 같은 조건(헤더가 옛 행사를 가리킴)에서 전환된다 ──────
do $$
declare
  v_old   uuid := public.active_event_id();
  v_new   uuid;
  v_seed  int;
  v_master uuid;
begin
  select id into v_master from profiles where role = 'master' limit 1;
  if v_master is null then
    raise notice '  (master 계정이 없어 검증 건너뜀)';
    return;
  end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_master::text)::text, true);

  -- 화면이 "여름수련회를 보는 중" 이라고 선언한 상태를 그대로 만든다.
  perform set_config('request.headers',
                     jsonb_build_object('x-carbus-event', v_old::text)::text, true);

  v_new := public.create_event('__검증용 행사__', p_copy_trips => false,
                               p_copy_buses => false);

  if v_new is null then raise exception '검증 실패: 새 행사가 안 만들어졌습니다'; end if;
  raise notice '검증 ①: 헤더가 옛 행사를 가리켜도 전환 성공 OK';

  select count(*) into v_seed
    from campus_payment_settlements where event_id = v_new;
  if v_seed = 0 then
    raise exception '검증 실패: 새 행사의 캠퍼스 정산 시드가 안 만들어졌습니다 (여기서 막혔었다)';
  end if;
  raise notice '검증 ②: 캠퍼스 정산 시드 %건 생성 OK — 막히던 지점', v_seed;

  if (select is_active from events where id = v_old) then
    raise exception '검증 실패: 옛 행사가 아직 진행 중입니다';
  end if;
  raise notice '검증 ③: 옛 행사 비활성 OK';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;
