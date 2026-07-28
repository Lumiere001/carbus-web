-- ============================================================
-- 타지구 차량이 확정되면 우리 버스 좌석을 자동으로 반납한다 (§11-C 의 C)
-- ============================================================
-- 배경:
--   `transport_legs.status = 'pending'` 은 "타지구 차를 얻어 타기로 했는데 아직
--   확정이 안 났다" 는 뜻이고, 그 동안은 **우리 버스 좌석을 그대로 잡아둔다**
--   (타지구가 무산되면 바로 타야 하므로 — 20260728010000 의 사용자 결정).
--   그러면 확정이 난 순간 그 좌석은 놓아줘야 하는데, 지금은 운영자가 손으로
--   편을 비워야 한다. 실제 운영에서 이게 빠지면 **빈 좌석을 태우고 출발한다.**
--
--   동규님 결정(2026-07-28): **자동으로 반납한다.** 되돌리려면 재배차해야 한다는
--   위험을 알고 고르셨다. 화면에서는 확인 대화상자를 띄운다.
--
-- 왜 DB 트리거인가:
--   앱에서 하면 PostgREST 직접 호출로 우회된다(§8-D 가 반복해서 배운 것).
--   `transport_legs` 는 임역원도 쓸 수 있는 테이블이라 경로가 하나가 아니다 —
--   신청 화면의 이동수단 입력, 이번에 만드는 확정 관리 화면, 앞으로 생길 무엇이든
--   같은 규칙을 타야 한다.
--
-- ⚠️ 의도한 부수 효과: 편이 비면 `attendance_type` 이 내려가고, 그러면
--    `v_payment_balance.fee_now` 가 줄어 **환불 대상 목록에 자동으로 뜬다.**
--    낸 사람이 타지구로 확정되면 돌려줄 돈이 생기는 게 맞다.
-- ============================================================

-- ── 1. 반납 트리거 ──────────────────────────────────────────
create or replace function public.release_seat_on_transport_confirm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 확정된 타지구 차량일 때만. 그 외(우리 버스·KTX·자차·확정 대기)는 손대지 않는다.
  --
  -- KTX·자차를 여기 넣지 않는 이유: 그건 "확정 대기"라는 개념이 아예 없어서
  -- (chk_pending_only_other_district) 입력하는 순간이 곧 확정이고, 지금까지
  -- 운영자가 손으로 편을 비워 왔다. 그 흐름까지 이번에 바꾸면 이번 변경이
  -- 무엇을 했는지 나중에 읽을 수 없게 된다. 필요하면 별도로 넓힌다.
  if new.mode <> 'other_district' or new.status <> 'confirmed' then
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
  '타지구 차량이 확정되면 그 방향의 운행편과 배정 호차를 함께 비운다.
   편만 비우면 배정이 유령으로 남아 호차 명단에 계속 뜬다 — 둘 다 비워야 실제 반납이다.';

drop trigger if exists trg_transport_legs_zz_release on public.transport_legs;
create trigger trg_transport_legs_zz_release
  after insert or update on public.transport_legs
  for each row execute function public.release_seat_on_transport_confirm();
-- ENABLE ALWAYS — 백업 적재(replica 모드)에서도 꺼지지 않아야 한다. 꺼진 줄 모르고
-- 적재하면 "확정인데 좌석을 잡고 있는" 행이 조용히 생긴다(§11-F 6).
alter table public.transport_legs enable always trigger trg_transport_legs_zz_release;

-- ── 2. 배정 가드가 이 반납을 막지 않게 한다 ──────────────────
-- `trg_reg_guard_assignment` 는 임역원이 배차 컬럼을 건드리는 걸 막는다(맞는 규칙).
-- 그런데 위 트리거는 **임역원이 확정을 눌렀을 때도** 돌아야 한다. SECURITY DEFINER 는
-- RLS 는 우회해도 트리거는 우회하지 못하므로(§11-F), 가드 쪽에 구멍이 아니라
-- **조건**을 낸다.
--
-- 우회 플래그(GUC)를 쓰지 않은 이유: 플래그는 "켜져 있으면 통과"라 켜는 경로가 하나
-- 늘어난다. 대신 가드가 **transport_legs 를 직접 보고** 판단하게 했다. 이 문을 열려면
-- 실제로 그 방향에 확정된 타지구 이용을 등록해야 하는데, 그 상태에서는 좌석 반납이
-- 애초에 정당하다. 즉 우회하려면 정당해져야 한다.
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

  -- ② 타지구 확정으로 그 방향 좌석이 반납되는 경우.
  --    바뀐 방향마다 따로 본다 — 한 방향이 정당하다고 다른 방향까지 열어주면
  --    "하행은 타지구 확정, 상행은 슬쩍 재배차" 가 통과한다.
  if (not v_up_changed
      or (new.assigned_up_bus_id is null
          and exists (select 1 from public.transport_legs l
                       where l.registration_id = new.id and l.direction = 'up'
                         and l.mode = 'other_district' and l.status = 'confirmed')))
     and (not v_down_changed
      or (new.assigned_down_bus_id is null
          and exists (select 1 from public.transport_legs l
                       where l.registration_id = new.id and l.direction = 'down'
                         and l.mode = 'other_district' and l.status = 'confirmed')))
  then
    return new;
  end if;

  raise exception '배차(호차 배정)는 총단 운영자만 변경할 수 있습니다';
end $$;

-- ── 3. 확정 관리 화면이 읽을 뷰 ──────────────────────────────
-- 화면이 매번 4개 테이블을 조인하지 않게. 특히 **지금 좌석을 잡고 있는가**
-- (held_trip_id) 를 한 칸으로 만들어 둔다 — 이 화면의 존재 이유가 그 숫자다.
drop view if exists public.v_transport_legs_detail;
create view public.v_transport_legs_detail with (security_invoker = on) as
select
  l.id,
  l.event_id,
  l.registration_id,
  l.direction,
  l.mode,
  l.status,
  l.via_unit_id,
  ou.name        as via_unit_name,
  l.note,
  l.created_at,
  l.updated_at,
  r.name         as person_name,
  r.student_id,
  r.campus_id,
  cp.name        as campus_name,
  r.participation_status,
  -- 이 방향으로 지금 잡고 있는 것. 둘 중 하나라도 있으면 좌석을 점유 중이다.
  case when l.direction = 'up' then r.up_trip_id else r.down_trip_id end          as held_trip_id,
  case when l.direction = 'up' then r.assigned_up_bus_id
       else r.assigned_down_bus_id end                                            as held_bus_id,
  -- 며칠째 기다리는가. 확정 관리는 "오래된 것부터" 가 곧 우선순위다.
  greatest(0, (extract(epoch from (now() - l.created_at)) / 86400)::int) as days_waiting
from public.transport_legs l
join public.registrations r on r.id = l.registration_id
left join public.org_units ou on ou.id = l.via_unit_id
left join public.campuses  cp on cp.id = r.campus_id;

comment on view public.v_transport_legs_detail is
  '확정 관리 화면용. held_trip_id 가 비어 있지 않으면 그 사람은 아직 우리 버스
   좌석을 잡고 있다. status=confirmed 인데 held 가 남아 있으면 모순 상태 —
   확정을 먼저 등록하고 나중에 편을 지정한 경우다(트리거는 편 지정을 막지 않는다).';

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_event uuid := public.active_event_id();
  v_reg   uuid;
  v_unit  uuid;
  v_up    smallint;
  v_down  smallint;
  v_bus   int;
  v_type  text;
  v_refund bigint;
  v_leg   bigint;
begin
  select id into v_unit from org_units where kind = 'district' limit 1;
  -- 상·하행 편이 다 있고 배정까지 된 사람. 반납 전후 대조가 가능한 조건이다.
  select id, up_trip_id, down_trip_id, assigned_down_bus_id
    into v_reg, v_up, v_down, v_bus
    from registrations
   where event_id = v_event
     and up_trip_id is not null and down_trip_id is not null
     and assigned_down_bus_id is not null
   limit 1;

  if v_reg is null or v_unit is null then
    raise notice '  (조건에 맞는 데이터가 없어 검증 건너뜀)';
    return;
  end if;

  -- ① 확정 대기 동안에는 좌석을 그대로 잡아둔다 (기존 규칙이 안 깨졌는가)
  insert into transport_legs (event_id, registration_id, direction, mode, via_unit_id, status)
  values (v_event, v_reg, 'down', 'other_district', v_unit, 'pending')
  returning id into v_leg;

  if (select down_trip_id from registrations where id = v_reg) is null then
    raise exception '검증 실패: 확정 대기인데 좌석이 반납됐습니다';
  end if;
  raise notice '검증 ①: 확정 대기 → 좌석 유지 OK';

  -- ② 확정되면 그 방향의 편과 배정 호차가 **둘 다** 비워진다
  update transport_legs set status = 'confirmed' where id = v_leg;

  if (select down_trip_id from registrations where id = v_reg) is not null then
    raise exception '검증 실패: 확정인데 하행 편이 남아 있습니다';
  end if;
  if (select assigned_down_bus_id from registrations where id = v_reg) is not null then
    raise exception '검증 실패: 편은 비었는데 배정 호차가 유령으로 남았습니다';
  end if;
  raise notice '검증 ②: 확정 → 하행 편·배정 호차 모두 반납 OK';

  -- ③ 반대 방향은 건드리지 않는다
  if (select up_trip_id from registrations where id = v_reg) is distinct from v_up then
    raise exception '검증 실패: 하행 확정이 상행까지 건드렸습니다';
  end if;
  raise notice '검증 ③: 반대 방향 보존 OK';

  -- ④ 참여형태가 따라 내려간다 (왕복 → 편도)
  select attendance_type::text into v_type from registrations where id = v_reg;
  if v_type <> 'oneway' then
    raise exception '검증 실패: 참여형태가 % 입니다 (oneway 예상)', v_type;
  end if;
  raise notice '검증 ④: 참여형태 왕복 → 편도 OK';

  -- ⑤ 낸 돈이 있으면 환불 대상에 뜬다 (의도한 부수 효과)
  select refund_due into v_refund from v_payment_balance where registration_id = v_reg;
  raise notice '검증 ⑤: 환불 대상 금액 = % (낸 돈이 없으면 0 이 정상)', coalesce(v_refund, 0);

  -- ⑥ 뷰가 "좌석을 놓았다" 를 보여준다
  if (select held_trip_id from v_transport_legs_detail where id = v_leg) is not null then
    raise exception '검증 실패: 뷰가 아직 좌석을 잡고 있다고 말합니다';
  end if;
  raise notice '검증 ⑥: 뷰 held_trip_id 비었음 OK';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

-- ── 임역원 경로 검증 (배정 가드를 실제로 통과하는가) ─────────
-- auth.uid() 는 request.jwt.claims 의 sub 를 읽는다. 역할 자체를 바꾸지 않고
-- **누구로 보이는가**만 바꾸므로 `reset role` 함정(§11-F 인접)을 피한다.
do $$
declare
  v_event uuid := public.active_event_id();
  v_admin uuid;
  v_campus uuid;
  v_reg   uuid;
  v_unit  uuid;
  v_ok    boolean;
begin
  select id, campus_id into v_admin, v_campus
    from profiles where role = 'campus_admin' and campus_id is not null limit 1;
  select id into v_unit from org_units where kind = 'district' limit 1;
  select id into v_reg from registrations
   where event_id = v_event and campus_id = v_campus
     and down_trip_id is not null and assigned_down_bus_id is not null
   limit 1;

  if v_admin is null or v_reg is null or v_unit is null then
    raise notice '  (임역원 경로 검증 건너뜀 — 조건에 맞는 계정/데이터 없음)';
    return;
  end if;

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

  -- ⑧ 그런데 타지구 확정을 통해서는 통과한다
  insert into transport_legs (event_id, registration_id, direction, mode, via_unit_id, status)
  values (v_event, v_reg, 'down', 'other_district', v_unit, 'confirmed');

  if (select assigned_down_bus_id from registrations where id = v_reg) is not null then
    raise exception '검증 실패: 임역원이 확정했는데 좌석이 안 놓였습니다';
  end if;
  raise notice '검증 ⑧: 임역원 타지구 확정 → 좌석 반납 통과 OK';

  raise exception '__검증완료_롤백';
exception when others then
  perform set_config('request.jwt.claims', '', true);
  if sqlerrm = '__검증완료_롤백' then
    raise notice '임역원 경로 검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

-- ── security_invoker · 트리거 확인 (§8-G) ───────────────────
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and coalesce(c.reloptions::text, '') not like '%security_invoker=on%';
  if v_bad is not null then
    raise exception 'security_invoker 가 빠진 뷰: %', v_bad;
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'transport_legs'
       and t.tgname = 'trg_transport_legs_zz_release' and t.tgenabled = 'A'
  ) then
    raise exception '좌석 반납 트리거가 ENABLE ALWAYS 가 아닙니다';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'registrations' and t.tgname = 'trg_reg_guard_assignment'
  ) then
    raise exception '배정 가드 트리거가 사라졌습니다';
  end if;
  raise notice 'security_invoker · 트리거 확인';
end $$;
