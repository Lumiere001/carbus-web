-- ============================================================
-- 이동수단과 좌석을 양방향으로 잇는다 (HANDOFF §26-B)
-- ============================================================
-- 배경:
--   지금은 **타지구(확정)만** 우리 버스 좌석을 반납한다(20260728070000).
--   `ktx` · `own_car` · `other` 는 아무 연동이 없어서, 자차로 온다고 적어도
--   그 사람 자리는 그대로 잡혀 있다. 동규님이 화면에서 이걸 찾았다 —
--   **우리 버스를 안 타는 건 똑같다.** 빈 좌석을 태우고 출발한다.
--
--   당시 이걸 범위에서 뺀 이유는 "KTX·자차는 확정 대기 개념이 없어 입력하는
--   순간이 곧 확정이고, 지금까지 운영자가 손으로 편을 비워 왔다" 였다.
--   그 판단이 동규님 기대와 달랐다.
--
-- 동규님 결정 (2026-07-28):
--   ① 우리 버스가 아닌 수단은 **전부** 그 방향 좌석을 반납한다.
--      되돌리려면 재배차해야 하므로 화면에서 확인을 받는다(타지구 확정과 동일).
--   ② **반대 방향도 잇는다.** 편을 지정하면 이동수단이 `우리 버스` 로 돌아간다.
--      그래야 둘이 어긋난 상태가 아예 못 생긴다.
--
-- ⚠️ ② 의 예외가 하나 있다: **타지구 확정 대기**.
--    그건 "타지구 차를 알아보는 중이라 일단 우리 자리를 잡아둔다" 는 뜻이라,
--    편이 지정돼 있는 게 정상이다. 여기서 `우리 버스` 로 덮으면 그 상태를
--    표현할 방법이 사라진다.
--
-- 왜 DB 트리거인가: `transport_legs` 도 `registrations` 도 임역원이 쓸 수 있고
-- 경로가 하나가 아니다(신청 화면·확정 관리 화면·앞으로 생길 무엇이든).
-- 앱에서 하면 PostgREST 직접 호출로 우회된다(§8-D 가 반복해서 배운 것).
-- ============================================================

-- ── 0. "우리 버스를 안 탄다" 를 한 곳에서 판정한다 ────────────
-- 이 술어가 세 곳에 필요하다: 좌석 반납 트리거 · 배정 가드 · 정합성 점검.
-- 흩어 놓으면 한 곳만 고쳐지고 나머지가 조용히 옛 규칙으로 남는다.
create or replace function public.leg_skips_our_bus(
  p_mode public.transport_mode,
  p_status public.transport_status
) returns boolean language sql immutable as $$
  select p_mode in ('ktx', 'own_car', 'other')
      or (p_mode = 'other_district' and p_status = 'confirmed');
$$;

comment on function public.leg_skips_our_bus(public.transport_mode, public.transport_status) is
  '이 이동수단이면 우리 버스 좌석을 잡고 있을 이유가 없다.
   타지구 "확정 대기" 만 예외다 — 무산되면 바로 타야 하므로 자리를 잡아둔다.';

-- ── 1. 좌석 반납을 우리 버스가 아닌 수단 전체로 넓힌다 ────────
create or replace function public.release_seat_on_transport_confirm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 우리 버스이거나 타지구 확정 대기면 좌석을 그대로 둔다.
  if not public.leg_skips_our_bus(new.mode, new.status) then
    return new;
  end if;

  -- 이미 비어 있으면 아무 일도 하지 않는다 (where 절이 그걸 보장한다).
  -- 그래서 note 만 고치는 UPDATE 가 감사 로그를 더럽히지 않는다.
  if new.direction = 'up' then
    update registrations
       set up_trip_id = null, assigned_up_bus_id = null
     where id = new.registration_id
       and (up_trip_id is not null or assigned_up_bus_id is not null);
  else
    update registrations
       set down_trip_id = null, assigned_down_bus_id = null
     where id = new.registration_id
       and (down_trip_id is not null or assigned_down_bus_id is not null);
  end if;

  return new;
end $$;

comment on function public.release_seat_on_transport_confirm() is
  '우리 버스를 안 타는 이동수단이 등록되면 그 방향의 운행편과 배정 호차를 함께 비운다.
   편만 비우면 배정이 유령으로 남아 호차 명단에 계속 뜬다 — 둘 다 비워야 실제 반납이다.';

-- ── 2. 반대 방향 — 편을 지정하면 이동수단이 우리 버스로 돌아온다 ──
create or replace function public.sync_transport_on_trip_assign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 상행: 편이 **새로 생겼을 때만** 본다. 편이 비워지는 경우(좌석 반납)는
  -- 이 함수가 손대면 안 된다 — 그게 바로 반납 트리거가 한 일이다.
  if new.up_trip_id is not null and new.up_trip_id is distinct from old.up_trip_id then
    update transport_legs
       set mode = 'our_bus', via_unit_id = null, status = 'confirmed'
     where registration_id = new.id
       and direction = 'up'
       and mode <> 'our_bus'
       -- 타지구 확정 대기는 편이 지정돼 있는 게 정상이다. 덮지 않는다.
       and not (mode = 'other_district' and status = 'pending');
  end if;

  if new.down_trip_id is not null and new.down_trip_id is distinct from old.down_trip_id then
    update transport_legs
       set mode = 'our_bus', via_unit_id = null, status = 'confirmed'
     where registration_id = new.id
       and direction = 'down'
       and mode <> 'our_bus'
       and not (mode = 'other_district' and status = 'pending');
  end if;

  return new;
end $$;

comment on function public.sync_transport_on_trip_assign() is
  '편을 지정하면 그 방향 이동수단을 우리 버스로 되돌린다. 두 곳에 적힌 같은 사실이
   어긋나지 않게 하는 반대 방향 연결이다(§26-B). 타지구 확정 대기만 예외.';

-- AFTER 로 단다. BEFORE 로 달면 `registrations` 의 다른 BEFORE 트리거들과
-- 알파벳 순서를 다투게 되는데(§4-5), 이 함수는 registrations 를 고치지 않으므로
-- 순서를 다툴 이유가 없다.
--
-- 무한 반복은 없다: 이 트리거가 transport_legs 를 `our_bus` 로 바꾸면 반납
-- 트리거가 돌지만 `leg_skips_our_bus` 가 false 라 즉시 반환한다. 반대로 반납
-- 트리거가 편을 비우면 이 트리거가 돌지만 "편이 새로 생겼을 때만" 이라 안 걸린다.
drop trigger if exists trg_reg_zz_transport_sync on public.registrations;
create trigger trg_reg_zz_transport_sync
  after update of up_trip_id, down_trip_id on public.registrations
  for each row execute function public.sync_transport_on_trip_assign();
-- ENABLE ALWAYS — 백업 적재(replica 모드)에서도 꺼지지 않아야 한다.
alter table public.registrations enable always trigger trg_reg_zz_transport_sync;

-- ── 3. 배정 가드도 같은 술어로 넓힌다 ────────────────────────
-- `trg_reg_guard_assignment` 는 임역원이 배차 컬럼을 건드리는 걸 막는다(맞는 규칙).
-- 그런데 반납은 임역원이 이동수단을 골랐을 때도 돌아야 한다. 예전엔 "타지구 확정"
-- 만 열어 뒀는데, 이제 KTX·자차도 같은 이유로 반납하므로 같은 술어를 쓴다.
create or replace function public.guard_assignment_columns()
returns trigger language plpgsql set search_path = public as $$
declare
  v_up_changed   boolean := new.assigned_up_bus_id   is distinct from old.assigned_up_bus_id;
  v_down_changed boolean := new.assigned_down_bus_id is distinct from old.assigned_down_bus_id;
begin
  if public.current_role() is distinct from 'campus_admin' then
    return new;
  end if;
  if not (v_up_changed or v_down_changed) then
    return new;
  end if;

  -- ① 취소 처리로 좌석이 반납되는 경우 (기존 규칙, 그대로)
  if new.participation_status = 'cancelled'
     and new.assigned_up_bus_id is null
     and new.assigned_down_bus_id is null then
    return new;
  end if;

  -- ② 우리 버스를 안 타는 이동수단이 등록돼 그 방향 좌석이 반납되는 경우.
  --    바뀐 방향마다 따로 본다 — 한 방향이 정당하다고 다른 방향까지 열어주면
  --    "하행은 자차, 상행은 슬쩍 재배차" 가 통과한다.
  if (not v_up_changed
      or (new.assigned_up_bus_id is null
          and exists (select 1 from public.transport_legs l
                       where l.registration_id = new.id and l.direction = 'up'
                         and public.leg_skips_our_bus(l.mode, l.status))))
     and (not v_down_changed
      or (new.assigned_down_bus_id is null
          and exists (select 1 from public.transport_legs l
                       where l.registration_id = new.id and l.direction = 'down'
                         and public.leg_skips_our_bus(l.mode, l.status))))
  then
    return new;
  end if;

  raise exception '배차(호차 배정)는 총단 운영자만 변경할 수 있습니다';
end $$;

-- ── 4. 이미 어긋나 있는 행을 맞춘다 ──────────────────────────
-- 착수 시점 실측: 1건(리더십 캠프, 자차인데 상행 편을 잡고 있음).
-- **이동수단을 진실원으로 삼아 좌석을 놓는다** — 사람이 "자차로 간다" 고 적은 것이
-- 나중에 표현된 의사이고, 손해가 나는 쪽(빈 좌석)이 그 반대이기 때문이다.
do $$
declare v_n int := 0; r record;
begin
  for r in
    select l.registration_id, l.direction, reg.name, l.mode
      from transport_legs l
      join registrations reg on reg.id = l.registration_id
     where reg.participation_status <> 'cancelled'
       and public.leg_skips_our_bus(l.mode, l.status)
       and (case when l.direction = 'up' then reg.up_trip_id else reg.down_trip_id end) is not null
  loop
    if r.direction = 'up' then
      update registrations set up_trip_id = null, assigned_up_bus_id = null
       where id = r.registration_id;
    else
      update registrations set down_trip_id = null, assigned_down_bus_id = null
       where id = r.registration_id;
    end if;
    raise notice '  좌석 반납: % (%, %)', r.name, r.direction, r.mode;
    v_n := v_n + 1;
  end loop;
  raise notice '이관: 우리 버스를 안 타는데 좌석을 잡고 있던 %건 정리', v_n;
end $$;

-- ── 자체검증 ─────────────────────────────────────────────────
-- ⚠️ §25-C 의 교훈대로 **앱과 같은 조건**을 만든다 — 헤더와 역할을 세팅한다.
--    psql 기본 상태에는 `request.headers` 가 아예 없어서 가드가 통째로 건너뛰어진다.
do $$
declare
  v_event uuid := public.active_event_id();
  v_reg   uuid;
  v_up    smallint;
  v_down  smallint;
  v_bus   int;
  v_leg   bigint;
  v_mode  text;
  v_type  text;
begin
  -- 화면과 같게: 지금 보고 있는 행사를 선언한 상태로 돈다.
  perform set_config('request.headers',
                     jsonb_build_object('x-carbus-event', v_event::text)::text, true);

  select id, up_trip_id, down_trip_id, assigned_down_bus_id
    into v_reg, v_up, v_down, v_bus
    from registrations
   where event_id = v_event
     and participation_status <> 'cancelled'
     and up_trip_id is not null and down_trip_id is not null
   limit 1;

  if v_reg is null then
    raise notice '  (조건에 맞는 데이터가 없어 검증 건너뜀)';
    return;
  end if;

  -- ① 자차를 고르면 그 방향 좌석이 반납된다 (예전엔 아무 일도 안 일어났다)
  insert into transport_legs (event_id, registration_id, direction, mode, status)
  values (v_event, v_reg, 'up', 'own_car', 'confirmed')
  returning id into v_leg;

  if (select up_trip_id from registrations where id = v_reg) is not null then
    raise exception '검증 실패: 자차인데 상행 편이 남아 있습니다';
  end if;
  raise notice '검증 ①: 자차 → 상행 좌석 반납 OK';

  -- ② 반대 방향은 건드리지 않는다
  if (select down_trip_id from registrations where id = v_reg) is distinct from v_down then
    raise exception '검증 실패: 상행 자차가 하행까지 건드렸습니다';
  end if;
  raise notice '검증 ②: 반대 방향 보존 OK';

  -- ③ 편을 다시 지정하면 이동수단이 우리 버스로 돌아온다 (양방향 연결)
  update registrations set up_trip_id = v_up where id = v_reg;

  select mode::text into v_mode from transport_legs where id = v_leg;
  if v_mode <> 'our_bus' then
    raise exception '검증 실패: 편을 지정했는데 이동수단이 % 입니다 (our_bus 예상)', v_mode;
  end if;
  raise notice '검증 ③: 편 지정 → 이동수단 우리 버스 복귀 OK';

  -- ④ 그 되돌림이 좌석을 다시 뺏지 않는다 (반복이 없는가)
  if (select up_trip_id from registrations where id = v_reg) is null then
    raise exception '검증 실패: 우리 버스로 돌아오면서 좌석이 다시 반납됐습니다 (반복)';
  end if;
  raise notice '검증 ④: 되돌림이 좌석을 다시 뺏지 않음 OK';

  -- ⑤ 타지구 확정 대기는 편이 지정돼도 덮이지 않는다 (유일한 예외)
  update transport_legs
     set mode = 'other_district', status = 'pending',
         via_unit_id = (select id from org_units where kind = 'district' limit 1)
   where id = v_leg;
  update registrations set up_trip_id = v_up where id = v_reg;   -- 편 재지정
  select mode::text || '/' || status::text into v_mode
    from transport_legs where id = v_leg;
  if v_mode <> 'other_district/pending' then
    raise exception '검증 실패: 확정 대기가 % 로 덮였습니다', v_mode;
  end if;
  raise notice '검증 ⑤: 타지구 확정 대기는 덮이지 않음 OK';

  -- ⑥ 참여형태가 따라 움직인다
  select attendance_type::text into v_type from registrations where id = v_reg;
  if v_type <> 'roundtrip' then
    raise exception '검증 실패: 참여형태가 % 입니다 (roundtrip 예상)', v_type;
  end if;
  raise notice '검증 ⑥: 참여형태 파생 OK';

  raise exception '__검증완료_롤백';
exception when others then
  perform set_config('request.headers', '', true);
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

-- ── 임역원 경로 검증 (배정 가드가 자차에도 열리는가) ─────────
do $$
declare
  v_event  uuid := public.active_event_id();
  v_admin  uuid;
  v_campus uuid;
  v_reg    uuid;
  v_ok     boolean;
begin
  select id, campus_id into v_admin, v_campus
    from profiles where role = 'campus_admin' and campus_id is not null
      and revoked_at is null limit 1;
  select id into v_reg from registrations
   where event_id = v_event and campus_id = v_campus
     and participation_status <> 'cancelled'
     and down_trip_id is not null and assigned_down_bus_id is not null
   limit 1;

  if v_admin is null or v_reg is null then
    raise notice '  (임역원 경로 검증 건너뜀 — 조건에 맞는 계정/데이터 없음)';
    return;
  end if;

  perform set_config('request.headers',
                     jsonb_build_object('x-carbus-event', v_event::text)::text, true);
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin::text)::text, true);

  -- ⑦ 임역원이 배차 컬럼을 직접 건드리는 건 여전히 막혀야 한다
  v_ok := false;
  begin
    update registrations set assigned_down_bus_id = null where id = v_reg;
  exception when others then
    v_ok := sqlerrm like '%총단 운영자만%';
  end;
  if not v_ok then
    raise exception '검증 실패: 임역원이 배차를 그냥 지웠습니다 (가드가 뚫렸습니다)';
  end if;
  raise notice '검증 ⑦: 임역원 직접 배차 변경 → 여전히 차단 OK';

  -- ⑧ 그런데 자차를 등록해서는 통과한다 (예전엔 타지구 확정만 열려 있었다)
  insert into transport_legs (event_id, registration_id, direction, mode, status)
  values (v_event, v_reg, 'down', 'own_car', 'confirmed');

  if (select assigned_down_bus_id from registrations where id = v_reg) is not null then
    raise exception '검증 실패: 임역원이 자차를 등록했는데 좌석이 안 놓였습니다';
  end if;
  raise notice '검증 ⑧: 임역원 자차 등록 → 좌석 반납 통과 OK';

  raise exception '__검증완료_롤백';
exception when others then
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
  if sqlerrm = '__검증완료_롤백' then
    raise notice '임역원 경로 검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

-- ── 트리거 상태 확인 (§8-G) ─────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'registrations'
       and t.tgname = 'trg_reg_zz_transport_sync' and t.tgenabled = 'A'
  ) then
    raise exception '이동수단 되돌림 트리거가 ENABLE ALWAYS 가 아닙니다';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'transport_legs'
       and t.tgname = 'trg_transport_legs_zz_release' and t.tgenabled = 'A'
  ) then
    raise exception '좌석 반납 트리거가 ENABLE ALWAYS 가 아닙니다';
  end if;
  raise notice '트리거 확인 OK';
end $$;
