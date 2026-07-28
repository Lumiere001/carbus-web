-- ============================================================
-- 간사 차량 (HANDOFF §26-E)
-- ============================================================
-- 동규님 요청:
--   "크루·미디어·총단인 경우 간사님 차량을 타고 이동하는 경우가 있다. 호차별 배차뿐
--    아니라 **어떤 간사 차량에 누가 타는지**도 같이 볼 수 있으면 좋겠다.
--    호차에 같이 나오도록. 예를 들면 A간사차는 최대 4명."
--
-- 지금은 그런 사람들이 `attendance_type = self`(미이용)로 빠져서
-- **어디에 탔는지가 아무 데도 안 남는다.**
--
-- 선택한 구조: `buses` 에 종류를 더한다 (동규님 결정).
--   호차 화면·출석·CSV·변동 보드가 이미 `buses` 를 읽으므로 "호차에 같이 나오도록"
--   이 거의 공짜로 된다. 별도 테이블로 가면 그 화면들을 전부 새로 만들어야 한다.
--
-- ⚠️ 대신 **자동 배차에서 반드시 빼야 한다.** 안 빼면 캠퍼스 인원이 간사 차에 밀려
--    들어간다. `fill_priority` 로는 부족하다 — 그건 "나중에 채운다" 일 뿐이라
--    좌석이 모자라면 결국 채워진다. 종류로 갈라야 한다.
--
-- 탑승자는 **수동 지정**이다. 자동 배차가 손대지 않으면서 재배차에도 살아남아야
-- 하므로, 이미 있는 **고정 탑승자** 앵커를 그대로 쓴다(엔진 Step 1 이 존중한다).
-- ============================================================

-- ── 1. 차량 종류 ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'bus_kind') then
    create type public.bus_kind as enum ('bus', 'staff_car');
  end if;
end $$;

alter table public.buses
  add column if not exists kind public.bus_kind not null default 'bus';

comment on column public.buses.kind is
  '차량 종류. staff_car = 간사 차량 — 호차 화면·출석에는 같이 나오지만
   자동 배차 대상이 아니다. 탑승자는 고정 탑승자로 수동 지정한다.';

create index if not exists idx_buses_kind on public.buses (event_id, kind);

-- ── 2. 간사 차량은 자동 배차에서 빠진다 (DB 쪽 방어선) ───────
-- 엔진(TypeScript)에서 빼는 것이 1차 방어선이지만, 그건 **한 경로일 뿐**이다.
-- 수동 배정 드롭다운·CSV 가져오기·PostgREST 직접 호출이 같은 실수를 할 수 있다.
-- 그래서 "고정 탑승자가 아닌 사람이 간사 차에 배정되는 것" 자체를 DB 가 막는다.
--
-- 왜 배정 자체를 막지 않는가: 간사 차에 **누가 타는지**를 적는 것이 이 기능의 목적이다.
-- 막아야 할 것은 "의도치 않게 밀려 들어가는 것" 이고, 그건 곧 **고정 탑승자로
-- 지정되지 않았는데 배정된 상태**다.
create or replace function public.guard_staff_car_assignment()
returns trigger language plpgsql set search_path = public as $$
declare
  v_bus record;
begin
  if new.assigned_up_bus_id is not null
     and new.assigned_up_bus_id is distinct from old.assigned_up_bus_id then
    select id, name, kind, driver_registration_id, fixed_passenger_ids
      into v_bus from buses where id = new.assigned_up_bus_id;
    if v_bus.kind = 'staff_car'
       and new.id <> coalesce(v_bus.driver_registration_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and not (new.id = any (v_bus.fixed_passenger_ids)) then
      raise exception
        '%는 간사 차량입니다. 먼저 이 사람을 그 차의 고정 탑승자로 지정해 주세요.',
        v_bus.name using errcode = 'restrict_violation';
    end if;
  end if;

  if new.assigned_down_bus_id is not null
     and new.assigned_down_bus_id is distinct from old.assigned_down_bus_id then
    select id, name, kind, down_driver_registration_id, down_fixed_passenger_ids
      into v_bus from buses where id = new.assigned_down_bus_id;
    if v_bus.kind = 'staff_car'
       and new.id <> coalesce(v_bus.down_driver_registration_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and not (new.id = any (v_bus.down_fixed_passenger_ids)) then
      raise exception
        '%는 간사 차량입니다. 먼저 이 사람을 그 차의 고정 탑승자로 지정해 주세요.',
        v_bus.name using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end $$;

-- BEFORE UPDATE. 이름을 `trg_reg_02_*` 로 지어 `trg_reg_audit` **앞**에 서게 한다
-- (§4-5 — BEFORE 트리거는 이름 알파벳순이고, 감사보다 뒤면 변경이 조용히 누락된다).
drop trigger if exists trg_reg_02_staff_car on public.registrations;
create trigger trg_reg_02_staff_car
  before update of assigned_up_bus_id, assigned_down_bus_id on public.registrations
  for each row execute function public.guard_staff_car_assignment();

-- ── 3. 역할 라벨에 크루·미디어를 더한다 ──────────────────────
-- 간사 차를 타는 사람은 크루·미디어·총단인데 **크루·미디어 라벨이 아예 없었다.**
-- display_order 는 기존 총단(10)·간사(20) 다음으로.
insert into public.role_labels (label, color, display_order)
select v.label, v.color, v.display_order
  from (values ('크루', 'orange', 30), ('미디어', 'pink', 40)) as v(label, color, display_order)
 where not exists (select 1 from public.role_labels r where r.label = v.label);

-- ── 자체검증 ─────────────────────────────────────────────────
-- §25-C 의 교훈대로 **앱과 같은 조건**을 만든다 (헤더·역할 세팅).
do $$
declare
  v_event uuid := public.active_event_id();
  v_trip  smallint;
  v_car   int;
  v_reg   uuid;
  v_other uuid;
  v_ok    boolean;
begin
  perform set_config('request.headers',
                     jsonb_build_object('x-carbus-event', v_event::text)::text, true);

  select id into v_trip from event_trips
   where event_id = v_event and direction = 'up' and active limit 1;
  select id into v_reg from registrations
   where event_id = v_event and up_trip_id is not null
     and participation_status <> 'cancelled' limit 1;
  select id into v_other from registrations
   where event_id = v_event and up_trip_id is not null
     and participation_status <> 'cancelled' and id <> v_reg limit 1;

  if v_trip is null or v_reg is null or v_other is null then
    raise notice '  (조건에 맞는 데이터가 없어 검증 건너뜀)';
    return;
  end if;

  -- 간사 차량을 만든다. 이름은 자유 입력 — `N호차` 번호 규칙과 섞이면 안 된다.
  insert into buses (event_id, name, capacity, hard_cap, up_trip_id, kind, display_order)
  values (v_event, '__검증용 A간사차__', 4, 4, v_trip, 'staff_car', 900)
  returning id into v_car;
  raise notice '검증 ①: 간사 차량 생성 OK (정원 4)';

  -- ② 고정 탑승자가 아닌 사람은 간사 차에 배정되지 않는다
  v_ok := false;
  begin
    update registrations set assigned_up_bus_id = v_car where id = v_other;
  exception when others then
    v_ok := sqlerrm like '%간사 차량입니다%';
  end;
  if not v_ok then
    raise exception '검증 실패: 지정 안 된 사람이 간사 차에 배정됐습니다';
  end if;
  raise notice '검증 ②: 지정 안 된 사람 배정 → 차단 OK';

  -- ③ 고정 탑승자로 지정하면 배정된다
  update buses set fixed_passenger_ids = array[v_reg] where id = v_car;
  update registrations set assigned_up_bus_id = v_car where id = v_reg;
  if (select assigned_up_bus_id from registrations where id = v_reg) <> v_car then
    raise exception '검증 실패: 고정 탑승자인데 간사 차에 못 탔습니다';
  end if;
  raise notice '검증 ③: 고정 탑승자 배정 OK';

  -- ④ 일반 버스는 아무 영향이 없다 (가드가 버스까지 잠그면 배차가 통째로 멈춘다)
  update registrations set assigned_up_bus_id =
    (select id from buses where event_id = v_event and kind = 'bus' and up_trip_id = v_trip limit 1)
   where id = v_other;
  raise notice '검증 ④: 일반 버스 배정은 그대로 OK';

  -- ⑤ 호차 화면이 읽는 뷰에 간사 차량이 함께 나온다
  if not exists (select 1 from v_bus_occupancy where bus_id = v_car) then
    raise exception '검증 실패: 간사 차량이 호차 화면 뷰에 안 나옵니다';
  end if;
  raise notice '검증 ⑤: 호차 화면에 함께 노출 OK';

  raise exception '__검증완료_롤백';
exception when others then
  perform set_config('request.headers', '', true);
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from role_labels where label in ('크루', '미디어');
  if v_n <> 2 then
    raise exception '역할 라벨 크루·미디어가 %개입니다 (2개 예상)', v_n;
  end if;
  raise notice '역할 라벨 확인 OK (크루·미디어)';

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'registrations' and t.tgname = 'trg_reg_02_staff_car'
  ) then
    raise exception '간사 차량 가드 트리거가 없습니다';
  end if;
  raise notice '트리거 확인 OK';
end $$;
