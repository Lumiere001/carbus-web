-- ============================================================
-- 차량 삭제 — **탑승자만** 막는다 (동규님 요청, 2026-07-28)
-- ============================================================
-- 동규님: "편성에서 이미 등록된 차량 삭제할 때, 배정된 탑승자가 없으면 바로
--          삭제가 되도록 해줘."
--
-- 지금은 배정 인원이 0명이어도 아래 넷 중 하나만 걸려 있으면 거부한다:
--   차량순장 지정 · 고정 탑승자 지정 · 순장 로그인 연결
-- 실제로 운영에서 1호차가 그 상태였다. 사람은 "아무도 안 탔는데 왜 안 지워지지"
-- 가 되고, 어디서 그 지정을 풀어야 하는지도 화면에 안 나온다.
--
-- 무엇이 다른가:
--   **배정(assigned_*_bus_id)** 은 배차의 결과다. 지우면 그 사람들이 갈 곳을 잃는다
--   → 계속 막는다.
--   **지정(차량순장·고정 탑승자)** 은 그 차에 대한 설정일 뿐이다. 차가 없어지면
--   같이 없어지는 게 당연하고, 되돌리기도 쉽다(리더 화면에서 다시 지정).
--   → 막지 않는다. 대신 **무엇이 함께 사라지는지 알려준다.**
--
-- 순장 로그인(`profiles.driver_bus_id`)은 FK 가 `ON DELETE SET NULL` 이라
-- 저절로 풀린다. 트리거가 따로 정리할 게 없다.
-- ============================================================

create or replace function public.guard_bus_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_up   int;
  v_down int;
begin
  select count(*) into v_up
    from registrations
   where assigned_up_bus_id = old.id
     and participation_status <> 'cancelled';
  select count(*) into v_down
    from registrations
   where assigned_down_bus_id = old.id
     and participation_status <> 'cancelled';

  -- 막는 것은 **탑승자뿐이다.** 지우면 이 사람들이 갈 곳을 잃는다.
  if v_up > 0 or v_down > 0 then
    raise exception
      '%에 배정된 인원이 있어 지울 수 없습니다 (%). 먼저 배차를 다시 돌려 이 차를 비워 주세요.',
      old.name,
      trim(both ' · ' from
        concat_ws(' · ',
          case when v_up   > 0 then format('상행 %s명', v_up)   end,
          case when v_down > 0 then format('하행 %s명', v_down) end))
      using errcode = 'restrict_violation';
  end if;

  -- 차량순장·고정 탑승자 지정은 막지 않는다. 차가 사라지면 함께 사라진다.
  -- (순장 로그인 연결은 FK ON DELETE SET NULL 이 알아서 푼다)
  return old;
end $$;

comment on function public.guard_bus_delete() is
  '차량 삭제는 **배정된 탑승자**만 막는다. 차량순장·고정 탑승자 지정은 그 차에 대한
   설정일 뿐이라 차와 함께 사라지는 게 맞다 — 막으면 "아무도 안 탔는데 왜 안 지워지지"
   가 되고 어디서 푸는지도 화면에 안 나온다.';

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_event uuid := public.active_event_id();
  v_trip  smallint;
  v_bus   int;
  v_reg   uuid;
  v_ok    boolean;
begin
  perform set_config('request.headers',
                     jsonb_build_object('x-carbus-event', v_event::text)::text, true);

  select id into v_trip from event_trips
   where event_id = v_event and direction = 'up' and active limit 1;
  select id into v_reg from registrations
   where event_id = v_event and up_trip_id = v_trip
     and participation_status <> 'cancelled' limit 1;
  if v_trip is null or v_reg is null then
    raise notice '  (조건에 맞는 데이터가 없어 검증 건너뜀)';
    return;
  end if;

  -- ① 차량순장만 지정된 차 — 탑승자가 없으면 지워진다 (이번에 바뀐 것)
  insert into buses (event_id, name, capacity, hard_cap, up_trip_id, display_order,
                     driver_registration_id)
  values (v_event, '__검증용 순장차__', 44, 45, v_trip, 991, v_reg)
  returning id into v_bus;

  delete from buses where id = v_bus;
  if exists (select 1 from buses where id = v_bus) then
    raise exception '검증 실패: 차량순장만 지정된 차가 안 지워졌습니다';
  end if;
  raise notice '검증 ①: 차량순장 지정만 있으면 삭제됨 OK';

  -- ② 고정 탑승자만 지정된 차도 지워진다
  insert into buses (event_id, name, capacity, hard_cap, up_trip_id, display_order,
                     fixed_passenger_ids)
  values (v_event, '__검증용 고정차__', 44, 45, v_trip, 992, array[v_reg])
  returning id into v_bus;

  delete from buses where id = v_bus;
  if exists (select 1 from buses where id = v_bus) then
    raise exception '검증 실패: 고정 탑승자 지정만 있는 차가 안 지워졌습니다';
  end if;
  raise notice '검증 ②: 고정 탑승자 지정만 있으면 삭제됨 OK';

  -- ③ **배정된 탑승자가 있으면 여전히 막힌다** (느슨해지면 안 되는 쪽)
  insert into buses (event_id, name, capacity, hard_cap, up_trip_id, display_order)
  values (v_event, '__검증용 만차__', 44, 45, v_trip, 993)
  returning id into v_bus;
  update registrations set assigned_up_bus_id = v_bus where id = v_reg;

  v_ok := false;
  begin
    delete from buses where id = v_bus;
  exception when others then
    v_ok := sqlerrm like '%배정된 인원이 있어%';
  end;
  if not v_ok then
    raise exception '검증 실패: 배정된 인원이 있는데 차가 지워졌습니다';
  end if;
  raise notice '검증 ③: 배정된 탑승자가 있으면 여전히 차단 OK';

  -- ④ 취소자는 탑승자로 세지 않는다
  update registrations set participation_status = 'cancelled', cancelled_at = now()
   where id = v_reg;
  delete from buses where id = v_bus;
  if exists (select 1 from buses where id = v_bus) then
    raise exception '검증 실패: 취소자만 남았는데 차가 안 지워졌습니다';
  end if;
  raise notice '검증 ④: 취소자는 탑승자로 안 셈 OK';

  raise exception '__검증완료_롤백';
exception when others then
  perform set_config('request.headers', '', true);
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;
