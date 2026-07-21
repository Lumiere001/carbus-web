-- ============================================================
-- Phase 3-B (1/2) — 편성 편집 화면을 열기 전에 세우는 DB 가드
-- ============================================================
-- 지금까지 차량·운행편에는 **쓰기 경로가 아예 없었다**(생성·삭제 UI 0곳).
-- 그래서 위험한 삭제가 실제로 일어날 수 없었고, 가드도 없었다.
-- 편성 편집 화면을 붙이는 순간 그 전제가 깨진다.
--
-- 왜 DB 계층인가:
--   lib/admin/*.ts 는 브라우저에서 도는 클라이언트 모듈이고 권한을 RLS 에 맡긴다.
--   거기에 "배정된 사람이 있으면 못 지운다" 같은 검사를 넣어도 **우회할 수 있다**
--   (master 는 PostgREST 에 직접 DELETE 를 보낼 수 있다).
--   데이터를 지키는 규칙은 데이터 옆에 둔다.
--
-- 무엇을 막나:
--   ① 차량 삭제 시 승객 배정이 조용히 사라지는 것.
--      registrations.assigned_up_bus_id / assigned_down_bus_id 의 FK 가
--      **ON DELETE SET NULL** 이라, 차량을 지우면 에러 없이 배정만 증발한다.
--      실측: 1호차를 지우면 상행 33명 + 하행 23명의 좌석이 조용히 없어진다.
--   ② 운행편 삭제 시 차량·신청이 붕 뜨는 것.
--      FK 가 NO ACTION 이라 어차피 실패하지만, 에러 메시지가 raw Postgres 라
--      화면에서 뭘 해야 할지 알 수 없다. 사람이 읽을 수 있는 문장으로 바꾼다.
--   ③ 마지막 상행/하행 편을 지워 그 방향이 통째로 사라지는 것.
--
-- 되돌리기:
--   drop trigger trg_bus_guard_delete on public.buses;
--   drop trigger trg_trip_guard_delete on public.event_trips;
--   drop function public.guard_bus_delete();
--   drop function public.guard_trip_delete();
-- ============================================================

-- ── 차량 삭제 가드 ──────────────────────────────────────────
-- ⚠️ 배정 인원만 보면 **정작 이 화면을 가장 많이 쓰는 시점에 무력하다.**
--    정상 운영 순서가 "차량순장·고정탑승 지정 → 배차 실행" 이라,
--    편성을 만지는 시점에는 assigned_*_bus_id 가 전부 NULL 이다.
--    처음에 배정만 검사했다가 실측으로 확인했다 — 배차 전에는 11대 전부 삭제되고,
--    1호차 기준 고정탑승 34명(상행 25 / 하행 9) + 하행 차량순장 지정이 조용히 사라졌다.
--    배차 후에도 batch/actions.ts 의 배정 초기화 경로를 타면 같은 상태가 된다.
--    그래서 **차량에 매달린 모든 사람 정보**를 검사한다.
create or replace function public.guard_bus_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_up      int;
  v_down    int;
  v_fix_up  int := coalesce(array_length(old.fixed_passenger_ids, 1), 0);
  v_fix_dn  int := coalesce(array_length(old.down_fixed_passenger_ids, 1), 0);
  v_logins  int;
  v_parts   text[] := '{}';
begin
  select count(*) into v_up
    from registrations
   where assigned_up_bus_id = old.id
     and participation_status <> 'cancelled';
  select count(*) into v_down
    from registrations
   where assigned_down_bus_id = old.id
     and participation_status <> 'cancelled';
  select count(*) into v_logins from profiles where driver_bus_id = old.id;

  -- 무엇이 함께 사라지는지 전부 모아 한 문장으로 알려준다.
  -- raise notice 는 클라이언트(PostgREST)에 도달하지 않으므로 경고로는 쓸 수 없다.
  if v_up > 0   then v_parts := v_parts || format('상행 배정 %s명', v_up); end if;
  if v_down > 0 then v_parts := v_parts || format('하행 배정 %s명', v_down); end if;
  if v_fix_up > 0 then v_parts := v_parts || format('상행 고정탑승 %s명', v_fix_up); end if;
  if v_fix_dn > 0 then v_parts := v_parts || format('하행 고정탑승 %s명', v_fix_dn); end if;
  if old.driver_registration_id is not null      then v_parts := v_parts || '상행 차량순장'::text; end if;
  if old.down_driver_registration_id is not null then v_parts := v_parts || '하행 차량순장'::text; end if;
  if v_logins > 0 then v_parts := v_parts || format('차량순장 로그인 %s건', v_logins); end if;

  if array_length(v_parts, 1) > 0 then
    raise exception
      '%에 %이(가) 걸려 있어 지울 수 없습니다. 먼저 해제하거나 다른 호차로 옮겨 주세요.',
      old.name, array_to_string(v_parts, ' · ')
      using errcode = 'restrict_violation';
  end if;

  return old;
end $$;

drop trigger if exists trg_bus_guard_delete on public.buses;
create trigger trg_bus_guard_delete
  before delete on public.buses
  for each row execute function public.guard_bus_delete();

-- ── 운행편 삭제 가드 ────────────────────────────────────────
create or replace function public.guard_trip_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_buses int;
  v_regs  int;
  v_left  int;
begin
  select count(*) into v_buses
    from buses
   where up_trip_id = old.id or down_trip_id = old.id;
  if v_buses > 0 then
    raise exception
      '"%" 운행편에 배정된 차량이 %대 있습니다. 먼저 차량의 운행편을 바꿔 주세요.',
      old.label, v_buses
      using errcode = 'restrict_violation';
  end if;

  -- 신청은 아직 상행만 trip 을 가리킨다(registrations.departure_slot_id).
  -- 하행 대칭화(3-C) 후에는 down_trip_id 도 같이 검사해야 한다.
  select count(*) into v_regs
    from registrations
   where departure_slot_id = old.id
     and participation_status <> 'cancelled';
  if v_regs > 0 then
    raise exception
      '"%" 운행편으로 신청한 사람이 %명 있습니다. 먼저 신청을 다른 편으로 옮겨 주세요.',
      old.label, v_regs
      using errcode = 'restrict_violation';
  end if;

  -- ⚠️ "마지막 편이니 못 지운다" 규칙은 넣지 않는다.
  --    처음엔 넣었는데, 위 두 검사가 이미 "쓰이고 있는 편"을 막고 있어서 중복이면서
  --    **범용성만 깎았다**. 예를 들어 "하행만 있는 행사"(상행 0편)를 만들 수 없게 된다.
  --    아무도 안 쓰는 편이라면 지워도 잃을 게 없다.
  --    대신 활성 편이 0개가 되는 것은 아래 guard_trip_last_active 가 막는다 —
  --    그건 삭제뿐 아니라 **비활성화**로도 도달하는 상태라 따로 다뤄야 한다.

  return old;
end $$;

drop trigger if exists trg_trip_guard_delete on public.event_trips;
create trigger trg_trip_guard_delete
  before delete on public.event_trips
  for each row execute function public.guard_trip_delete();

-- ── 그 방향에 신청자가 있는데 활성 편이 0개가 되는 것 ───────
-- 신청 폼은 **활성 편**으로만 선택지를 만든다(lib/labels.ts). 그래서 상행 활성 편이
-- 0개가 되면 아무도 상행을 신청할 수 없다. 화면에는 아무 경고도 안 뜬다.
-- 삭제뿐 아니라 [비활성] 토글로도 같은 상태에 도달하므로 UPDATE 도 함께 본다.
--
-- "그 방향을 아예 안 쓰는 행사"(예: 하행만 있는 행사)는 정당하므로,
-- 신청자가 이미 있는 방향만 막는다.
create or replace function public.guard_trip_last_active()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_dir   text := coalesce(new.direction, old.direction);
  v_event uuid := coalesce(new.event_id, old.event_id);
  v_left  int;
  v_users int;
begin
  -- 비활성으로 내리는 것도, 지우는 것도 아니면 볼 것 없다.
  if tg_op = 'UPDATE' and new.active then
    return new;
  end if;

  select count(*) into v_left
    from event_trips
   where event_id = v_event and direction = v_dir and active
     and id <> coalesce(new.id, old.id);
  if v_left > 0 then
    return coalesce(new, old);
  end if;

  -- 이 방향을 쓰는 신청자가 있는가 (상행만 판정 가능 — 하행은 3-C 이후)
  if v_dir = 'up' then
    select count(*) into v_users
      from registrations
     where event_id = v_event and departure_slot_id is not null
       and participation_status <> 'cancelled';
  else
    select count(*) into v_users
      from registrations
     where event_id = v_event and uses_return_bus
       and participation_status <> 'cancelled';
  end if;

  if v_users > 0 then
    raise exception
      '"%" 를 내리면 % 활성 편이 0개가 됩니다. 그 방향 신청자 %명이 편을 고를 수 없게 됩니다 — 먼저 다른 편을 만드세요.',
      coalesce(new.label, old.label),
      case v_dir when 'up' then '상행' else '하행' end,
      v_users
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists trg_trip_last_active on public.event_trips;
create trigger trg_trip_last_active
  before update or delete on public.event_trips
  for each row execute function public.guard_trip_last_active();

-- ── 정원은 양수여야 하고 보조석이 정원보다 작을 수 없다 ─────
-- 화면 검사만으로는 빈 입력(→ Number("") = 0)과 PostgREST 직접 호출을 둘 다 못 막는다.
alter table public.buses drop constraint if exists buses_capacity_sane;
alter table public.buses
  add constraint buses_capacity_sane
  check (capacity > 0 and hard_cap >= capacity);

-- ── 차량이 다른 행사의 운행편을 가리키지 못하게 ─────────────
-- 편성 화면에서 편 id 를 직접 넘기게 되므로, 행사 간 교차 참조가 실제로 가능해진다.
-- RESTRICTIVE 정책은 buses.event_id 만 보므로 이건 막지 못한다.
create or replace function public.guard_bus_trip_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_bad text;
begin
  if new.up_trip_id is not null then
    select case when t.event_id <> new.event_id then '다른 행사'
                when t.direction <> 'up'        then '하행'
           end into v_bad
      from event_trips t where t.id = new.up_trip_id;
    if v_bad is not null then
      raise exception '상행 편에 % 운행편을 지정할 수 없습니다', v_bad
        using errcode = 'check_violation';
    end if;
  end if;

  if new.down_trip_id is not null then
    select case when t.event_id <> new.event_id then '다른 행사'
                when t.direction <> 'down'      then '상행'
           end into v_bad
      from event_trips t where t.id = new.down_trip_id;
    if v_bad is not null then
      raise exception '하행 편에 % 운행편을 지정할 수 없습니다', v_bad
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_bus_guard_trip_scope on public.buses;
create trigger trg_bus_guard_trip_scope
  before insert or update of up_trip_id, down_trip_id, event_id on public.buses
  for each row execute function public.guard_bus_trip_scope();

-- ── 운행 편을 바꿀 때 이미 탄 사람이 어긋나지 않게 ──────────
-- 삭제만 막고 **수정**을 안 막으면 같은 사고가 조용히 난다:
--   1호차(상행 1편)에 1편 신청자 33명이 배정된 상태에서 1호차를 2편으로 옮기면,
--   33명이 "1편을 신청했는데 2편 차에 앉아 있는" 상태가 된다.
--   실측으로 확인했다 — 아무것도 막지 않고 아무 표시도 나지 않는다.
--   다음 배차를 돌리면 정리되지만, 그 전까지 출석·명단 화면이 틀린 편을 보여준다.
-- 삭제 가드와 같은 규칙으로 막는다: 먼저 배정을 비우거나 재배차하게 한다.
-- ⚠️ 조건을 "배정 인원이 있으면 무조건 거부"로 짜면 안 된다. 처음에 그렇게 했다가
--    마이그레이션의 backfill(down_trip_id NULL → 값)까지 막혀 재현이 깨졌다.
--    실제로 막아야 할 것은 "인원이 있다"가 아니라 **"신청한 편과 어긋나게 된다"** 이다.
--    그래서 새 값 기준으로 어긋나는 인원만 센다 — 값을 처음 채우는 건 통과한다.
create or replace function public.guard_bus_trip_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if new.up_trip_id is distinct from old.up_trip_id then
    -- registrations.departure_slot_id 가 "신청한 상행 편"이다.
    -- 바꾼 뒤 그 값과 어긋나는 배정만 문제다.
    select count(*) into v_n
      from registrations
     where assigned_up_bus_id = old.id
       and participation_status <> 'cancelled'
       and departure_slot_id is distinct from new.up_trip_id;
    if v_n > 0 then
      raise exception
        '%에 배정된 %명이 신청한 상행 편과 어긋나게 됩니다. 먼저 재배차하세요.',
        old.name, v_n
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- 하행은 아직 검사할 게 없다 — registrations 에 "신청한 하행 편"이 없기 때문이다
  -- (uses_return_bus 불린 하나뿐). 어긋날 대상 자체가 없으므로 여기서 막으면
  -- 막을 이유 없는 것을 막는 셈이 된다.
  -- ⚠️ 3-C 에서 registrations.down_trip_id 가 생기면 위 상행 블록과 같은 모양으로
  --    반드시 추가할 것. 안 그러면 하행만 조용히 어긋난다.

  return new;
end $$;

drop trigger if exists trg_bus_guard_trip_change on public.buses;
create trigger trg_bus_guard_trip_change
  before update of up_trip_id, down_trip_id on public.buses
  for each row execute function public.guard_bus_trip_change();

-- ── 자체검증 ─────────────────────────────────────────────────
-- prosrc 를 grep 하지 않고 **실제로 시도하고 롤백**한다.
-- 문자열 검사는 트리거를 만들어놓고 붙이지 않아도 통과한다.
do $$
declare
  v_bus  int;
  v_trip smallint;
  v_ok   boolean;
begin
  -- ① 배정 인원이 있는 차량은 못 지운다
  select assigned_up_bus_id into v_bus
    from registrations
   where assigned_up_bus_id is not null
     and participation_status <> 'cancelled'
   limit 1;

  if v_bus is not null then
    v_ok := false;
    begin
      delete from buses where id = v_bus;
    exception when restrict_violation then
      v_ok := true;
    end;
    if not v_ok then
      raise exception '검증 실패: 배정 인원이 있는 차량이 삭제됐습니다';
    end if;
    raise notice '검증 ①: 배정 인원 있는 차량 삭제 차단 OK';
  end if;

  -- ② 차량이 물린 운행편은 못 지운다
  select up_trip_id into v_trip from buses where up_trip_id is not null limit 1;
  if v_trip is not null then
    v_ok := false;
    begin
      delete from event_trips where id = v_trip;
    exception when restrict_violation then
      v_ok := true;
    end;
    if not v_ok then
      raise exception '검증 실패: 차량이 물린 운행편이 삭제됐습니다';
    end if;
    raise notice '검증 ②: 차량 물린 운행편 삭제 차단 OK';
  end if;

  -- ③ 방향이 어긋난 편 지정은 막힌다
  --    배정 인원이 없는 차량을 골라야 ④의 가드에 먼저 걸리지 않는다.
  select id into v_trip from event_trips where direction = 'down' limit 1;
  select b.id into v_bus from buses b
   where not exists (select 1 from registrations r
                      where (r.assigned_up_bus_id = b.id or r.assigned_down_bus_id = b.id)
                        and r.participation_status <> 'cancelled')
   limit 1;
  if v_trip is not null and v_bus is not null then
    v_ok := false;
    begin
      update buses set up_trip_id = v_trip where id = v_bus;
    exception when check_violation then
      v_ok := true;
    end;
    if not v_ok then
      raise exception '검증 실패: 상행 편에 하행 운행편이 지정됐습니다';
    end if;
    raise notice '검증 ③: 방향 어긋난 편 지정 차단 OK';
  else
    -- 조용히 건너뛰면 "통과"로 오해된다. 건너뛴 사실을 남긴다.
    raise warning '검증 ③ 건너뜀: 배정 인원이 없는 차량이 없어 시도하지 못했습니다';
  end if;

  -- ④ 배정 인원이 있는 차량의 운행편 변경은 막힌다
  select assigned_up_bus_id into v_bus
    from registrations
   where assigned_up_bus_id is not null
     and participation_status <> 'cancelled'
   limit 1;
  if v_bus is not null then
    select id into v_trip from event_trips
     where direction = 'up' and id <> (select up_trip_id from buses where id = v_bus)
     limit 1;
    if v_trip is not null then
      v_ok := false;
      begin
        update buses set up_trip_id = v_trip where id = v_bus;
      exception when restrict_violation then
        v_ok := true;
      end;
      if not v_ok then
        raise exception '검증 실패: 배정 인원이 있는데 운행편이 바뀌었습니다';
      end if;
      raise notice '검증 ④: 신청 편과 어긋나는 운행편 변경 차단 OK';
    end if;
  end if;
end $$;

-- 위 do 블록의 delete/update 는 예외로 롤백되지만, 예외를 잡은 뒤의 상태를
-- 확실히 하기 위해 한 번 더 확인한다.
do $$
declare v_n int;
begin
  select count(*) into v_n from buses;
  raise notice '자체검증 후 차량 %대 (변화 없어야 정상)', v_n;
end $$;
