-- ============================================================
-- Phase 2-B — 취소 상태 + 좌석 자동 반납
-- ============================================================
-- 왜?
--   지금 "취소"를 표현할 자리가 없어서 두 가지 방식으로 처리되고 있다.
--     ① 비고에 "취소함"이라고 적기 → 좌석은 그대로 남는다(유령 승객)
--     ② 행을 삭제하기 → 감사로그 delete 81건. 그중 납부완료 10건(225,000원)이
--        흔적 없이 사라졌다. 되돌릴 방법도 없다.
--
--   실제로 지금 취소·불참이라 적힌 사람 3명이 좌석을 들고 있다.
--   그중 한 명은 상행 11호차 + 하행 2호차를 동시에 점유 중이다.
--
--   → 취소를 정식 상태로 만들고, 취소하면 좌석이 자동으로 반납되게 한다.
--     삭제는 DB 레벨에서 막는다.
--
-- ⚠️ 기존 데이터를 비고 텍스트로 자동 취소 처리하지 않는다.
--    "왕복 타지구 확정 -> 취소함 / 취소 이후 순수 하행 확정" 처럼
--    취소했다가 다시 참석하는 사람이 섞여 있다. 실제로 확인해 보니
--    비고에 '취소'가 있으면서 좌석을 든 3명 중 1명이 이 경우였다.
--    자동 판정하면 참석자를 죽인다. 사람이 화면에서 지정한다.
--
-- 되돌리기(안전):  아래 '되돌리기 A' — 트리거·뷰만 원복. 컬럼은 남긴다.
-- 되돌리기(파괴적): 취소 건이 생긴 뒤 컬럼까지 지우면 그 기록이 사라진다.
--                   반드시 취소자 명단을 먼저 뽑고 사용자 승인을 받을 것.
-- ============================================================

-- ── 1. 상태 컬럼 ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'participation_status') then
    create type participation_status as enum ('registered', 'cancelled');
  end if;
end $$;

-- NOT NULL DEFAULT 상수는 테이블 재작성도 행 트리거 발화도 하지 않는다.
-- (Phase 1 에서 겪은 감사 이력 599건 오염이 여기서는 일어나지 않는다)
alter table public.registrations
  add column if not exists participation_status participation_status not null default 'registered',
  add column if not exists cancelled_at   timestamptz,
  add column if not exists cancel_reason  text,
  add column if not exists cancelled_by   uuid references public.profiles(id);

comment on column public.registrations.participation_status is
  '참여 상태. cancelled 로 바꾸면 좌석·차량순장·고정탑승이 자동 반납된다. 행은 지우지 않는다.';

create index if not exists idx_reg_participation
  on public.registrations (event_id, participation_status);

-- ── 2. 동일인 중복 방지를 '살아있는 행'에만 적용 ─────────────
-- 취소한 사람이 다시 신청할 수 있어야 한다. 지금 제약은 취소 여부를 몰라서
-- 재신청을 막는다.
alter table public.registrations drop constraint if exists uq_registrations_identity;
drop index if exists uq_registrations_identity;
create unique index if not exists uq_registrations_identity
  on public.registrations (event_id, campus_id, student_id, name)
  where participation_status <> 'cancelled';

-- ── 3. 취소 시 좌석 반납 ─────────────────────────────────────
create or replace function public.apply_cancellation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 취소로 바뀌는 순간에만 동작
  if new.participation_status = 'cancelled'
     and old.participation_status is distinct from 'cancelled' then

    new.cancelled_at  := coalesce(new.cancelled_at, now());
    new.cancelled_by  := coalesce(new.cancelled_by, auth.uid());

    -- 좌석 반납
    new.assigned_up_bus_id   := null;
    new.assigned_down_bus_id := null;
    new.checked_in           := false;
    new.checked_out          := false;

    -- 차량순장·고정탑승에서도 빼낸다. 안 빼면 배차가 존재하지 않는 사람을
    -- 호차에 고정하려 하고, 리더 화면에도 계속 남는다.
    update buses
       set driver_registration_id =
             case when driver_registration_id = new.id then null else driver_registration_id end,
           down_driver_registration_id =
             case when down_driver_registration_id = new.id then null else down_driver_registration_id end,
           fixed_passenger_ids      = array_remove(fixed_passenger_ids, new.id),
           down_fixed_passenger_ids = array_remove(down_fixed_passenger_ids, new.id)
     where driver_registration_id = new.id
        or down_driver_registration_id = new.id
        or new.id = any(fixed_passenger_ids)
        or new.id = any(down_fixed_passenger_ids);

  -- 취소를 되돌리는 경우: 좌석은 자동 복구하지 않는다(누가 이미 앉았을 수 있다).
  elsif new.participation_status = 'registered'
        and old.participation_status = 'cancelled' then
    new.cancelled_at := null;
    new.cancel_reason := null;
    new.cancelled_by := null;
  end if;

  return new;
end $$;

comment on function public.apply_cancellation is
  '취소 전이 처리. 좌석·출석·차량순장·고정탑승을 자동 반납한다. 되돌리면 좌석은 복구하지 않는다(다른 사람이 앉았을 수 있으므로).';

-- 이름을 trg_reg_01_cancel 로 잡아 감사 트리거(trg_reg_audit)보다 **먼저** 돌게 한다.
-- 그래야 좌석 반납이 감사 이력에 남는다. (BEFORE 트리거는 이름 알파벳순)
drop trigger if exists trg_reg_01_cancel on public.registrations;
create trigger trg_reg_01_cancel
  before update on public.registrations
  for each row execute function public.apply_cancellation();

-- ── 4. 배차 가드에 취소 예외 ─────────────────────────────────
-- 위 트리거가 좌석을 비우면, 기존 가드가 "임역원은 배차를 못 바꾼다"며 막는다.
-- 그러면 임역원이 취소를 아예 못 하게 된다. 비우는 방향만 허용한다.
create or replace function public.guard_assignment_columns()
returns trigger language plpgsql as $$
begin
  if public.current_role() = 'campus_admin' and (
        new.assigned_up_bus_id   is distinct from old.assigned_up_bus_id
     or new.assigned_down_bus_id is distinct from old.assigned_down_bus_id
  ) then
    -- 취소 처리로 좌석이 반납되는 경우만 통과 (비우는 방향만)
    if new.participation_status = 'cancelled'
       and new.assigned_up_bus_id is null
       and new.assigned_down_bus_id is null then
      return new;
    end if;
    raise exception '배차(호차 배정)는 총단 운영자만 변경할 수 있습니다';
  end if;
  return new;
end $$;

-- ── 5. 하드 삭제 차단 ────────────────────────────────────────
-- 삭제가 취소의 실질 경로였고, 그래서 225,000원의 수납 기록이 사라졌다.
-- 앱에서 오는 삭제만 막는다. service_role·마이그레이션·스크립트(auth.uid() IS NULL)는
-- 통과시켜 운영 도구가 멈추지 않게 한다.
create or replace function public.block_registration_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    raise exception '신청을 삭제하는 대신 "취소" 처리해 주세요. 삭제하면 납부·배차 기록이 함께 사라집니다.';
  end if;
  return old;
end $$;

drop trigger if exists trg_reg_block_delete on public.registrations;
create trigger trg_reg_block_delete
  before delete on public.registrations
  for each row execute function public.block_registration_delete();

-- ── 6. 집계에서 취소자 제외 ──────────────────────────────────
-- 뷰에서 빼지 않으면 취소자가 인원·좌석 계산에 계속 잡힌다.
-- 납부 관련 뷰(v_payment_summary·3way)는 **의도적으로 제외하지 않는다** —
-- 취소자에게 받은 돈은 환불 전까지 정산 대상으로 남아야 한다.
create or replace view public.v_campus_stats
with (security_invoker = on) as
  select c.id as campus_id, c.name as campus_name,
         count(*) filter (where r.attendance_type = 'roundtrip') as roundtrip_count,
         count(*) filter (where r.attendance_type = 'oneway') as oneway_count,
         count(r.id) as total,
         count(*) filter (where r.attendance_type = 'self') as self_count,
         count(*) filter (where r.checked_in) as arrived_count,
         count(*) filter (where r.uses_return_bus) as return_target,
         count(*) filter (where r.checked_out) as returned_count
    from campuses c
    left join registrations r
      on r.campus_id = c.id
     and r.event_id = public.active_event_id()
     and r.participation_status <> 'cancelled'
   group by c.id, c.name
   order by c.display_order;

create or replace view public.v_bus_occupancy
with (security_invoker = on) as
  select b.id as bus_id, b.name as bus_name, b.departure_slot_id, b.capacity, b.hard_cap,
         (select count(*) from registrations r
           where r.assigned_up_bus_id = b.id and r.event_id = b.event_id
             and r.participation_status <> 'cancelled') as up_passengers,
         (select count(*) from registrations r
           where r.assigned_down_bus_id = b.id and r.event_id = b.event_id
             and r.participation_status <> 'cancelled') as down_passengers,
         b.capacity - (select count(*) from registrations r
           where r.assigned_up_bus_id = b.id and r.event_id = b.event_id
             and r.participation_status <> 'cancelled') as up_empty_seats,
         b.capacity - (select count(*) from registrations r
           where r.assigned_down_bus_id = b.id and r.event_id = b.event_id
             and r.participation_status <> 'cancelled') as down_empty_seats
    from buses b
   where b.event_id = public.active_event_id()
   order by b.id;

create or replace view public.v_day_capacity
with (security_invoker = on) as
  select s.id as slot_id, s.key as slot_key, s.label as slot_label, s.display_order,
         coalesce(sum(b.capacity), 0::bigint) as total_capacity,
         (select count(*) from registrations r
           where r.departure_slot_id = s.id and r.event_id = s.event_id
             and r.participation_status <> 'cancelled') as total_passengers,
         (select count(*) from registrations r
           where r.departure_slot_id = s.id and r.checked_in and r.event_id = s.event_id
             and r.participation_status <> 'cancelled') as arrived,
         coalesce(sum(b.capacity), 0::bigint) - (select count(*) from registrations r
           where r.departure_slot_id = s.id and r.event_id = s.event_id
             and r.participation_status <> 'cancelled') as remaining_seats
    from departure_slots s
    left join buses b on b.departure_slot_id = s.id and b.event_id = s.event_id
   where s.active and s.event_id = public.active_event_id()
   group by s.id, s.key, s.label, s.display_order, s.event_id
   order by s.display_order;

-- ── 7. 함수 보정 ─────────────────────────────────────────────
-- 행사별 신청 건수에서 취소자 제외
create or replace function public.event_summary()
returns table (event_id uuid, reg_count bigint, batch_count bigint)
language sql stable security definer set search_path = public as $$
  select e.id,
         (select count(*) from registrations r
           where r.event_id = e.id and r.participation_status <> 'cancelled'),
         (select count(*) from batch_runs b where b.event_id = e.id)
    from events e
   where public.current_role() in ('master', 'viewer')
$$;

-- 취소자에게는 출석을 찍을 수 없게 한다.
create or replace function public.guard_attendance_update()
returns trigger language plpgsql as $$
begin
  if (new.checked_in is distinct from old.checked_in
      or new.checked_out is distinct from old.checked_out)
     and new.participation_status = 'cancelled'
     and (new.checked_in or new.checked_out) then
    raise exception '취소한 신청자는 출석 처리할 수 없습니다';
  end if;
  return new;
end $$;

-- ── 8. 점검용 뷰 ─────────────────────────────────────────────
create or replace view public.v_cancelled
with (security_invoker = on) as
  select r.id as registration_id, r.campus_id, r.name, r.student_id,
         r.cancelled_at, r.cancel_reason, r.payment_status, r.fee,
         coalesce(b.balance, 0) as balance,
         r.note
    from registrations r
    left join v_payment_balance b on b.registration_id = r.id
   where r.event_id = public.active_event_id()
     and r.participation_status = 'cancelled'
   order by r.cancelled_at desc nulls last;

comment on view public.v_cancelled is
  '취소한 신청자. balance > 0 이면 환불할 돈이 남아 있다는 뜻.';

-- ── security_invoker 재적용 확인 ─────────────────────────────
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\_%'
     and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'on';
  if missing is not null then
    raise exception 'security_invoker 누락: % — RLS 우회 위험', missing;
  end if;
end $$;

-- ── 되돌리기 A (안전 — 컬럼은 남긴다) ────────────────────────
-- drop trigger if exists trg_reg_01_cancel on public.registrations;
-- drop trigger if exists trg_reg_block_delete on public.registrations;
-- 그리고 v_campus_stats / v_bus_occupancy / v_day_capacity 를
-- 20260721000001_events_rls_views.sql 의 정의로 되돌린다.
