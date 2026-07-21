-- ============================================================
-- Phase 3-C (2/2) — 뷰·가드를 하행 대칭에 맞춘다
-- ============================================================
-- 3-C 로 신청이 down_trip_id 를 갖게 됐는데, 뷰와 가드는 아직 "하행 = 불린" 시절
-- 그대로다. 그대로 두면 하행을 여러 편으로 나눈 순간 다음이 깨진다:
--
--   · v_down_capacity 가 **편 구분 없이** 전체 하행 인원을 센다.
--     편이 3개면 세 편 모두 "459명"으로 보인다 — 정원 계획이 불가능해진다.
--   · guard_bus_trip_change 가 하행을 검사하지 않는다.
--     3-C 전에는 "신청한 하행 편"이 없어 어긋날 대상이 없었지만, 이제 있다.
--   · guard_trip_delete 가 down_trip_id 로 신청한 사람을 못 본다.
--     하행 편을 지우면 그 편 신청자가 붕 뜬다.
--
-- 되돌리기: 이 파일은 뷰 재정의와 함수 교체뿐이라, 20260721070000 / 20260721080000 의
--   해당 블록을 다시 실행하면 원상복구된다.
-- ============================================================

-- ── 뷰: 하행도 편별로 센다 ──────────────────────────────────
-- ⚠️ security_invoker = on 필수. 빠뜨리면 뷰가 소유자(rolbypassrls) 권한으로 평가돼
--    RLS 가 통째로 우회된다 — campus_admin 이 전 캠퍼스를 보게 된다(실측).
drop view if exists public.v_down_capacity;
create view public.v_down_capacity with (security_invoker = on) as
  select t.id    as trip_id,
         t.key   as trip_key,
         t.label as trip_label,
         t.display_order,
         t.departs_at,
         coalesce(sum(b.capacity), 0::bigint) as total_capacity,
         -- 편별로 센다. 예전엔 uses_return_bus 만 보고 전체를 세서
         -- 편이 여러 개면 모든 편이 같은 숫자를 보여줬다.
         (select count(*) from registrations r
           where r.down_trip_id = t.id and r.event_id = t.event_id
             and r.participation_status <> 'cancelled') as total_passengers,
         (select count(*) from registrations r
           where r.down_trip_id = t.id and r.checked_out and r.event_id = t.event_id
             and r.participation_status <> 'cancelled') as returned,
         coalesce(sum(b.capacity), 0::bigint) - (select count(*) from registrations r
           where r.down_trip_id = t.id and r.event_id = t.event_id
             and r.participation_status <> 'cancelled') as remaining_seats
    from public.event_trips t
    left join public.buses b on b.down_trip_id = t.id and b.event_id = t.event_id
   where t.active and t.direction = 'down' and t.event_id = public.active_event_id()
   group by t.id, t.key, t.label, t.display_order, t.departs_at, t.event_id
   order by t.display_order;

-- v_campus_stats: return_target 만 down_trip_id 기준으로. 출력 컬럼은 그대로라
-- CREATE OR REPLACE 가 가능하다(이름·타입·순서 불변).
-- 정의는 DB 의 현재 실물을 덤프해 그 위에서 한 줄만 바꿨다 — 정본이 여러 파일에
-- 흩어져 있어 파일만 읽으면 옛 버전을 베낀다(HANDOFF §4).
create or replace view public.v_campus_stats with (security_invoker = on) as
  select c.id   as campus_id,
         c.name as campus_name,
         count(*) filter (where r.attendance_type = 'roundtrip') as roundtrip_count,
         count(*) filter (where r.attendance_type = 'oneway')    as oneway_count,
         count(r.id)                                             as total,
         count(*) filter (where r.attendance_type = 'self')      as self_count,
         count(*) filter (where r.checked_in)                    as arrived_count,
         count(*) filter (where r.down_trip_id is not null)      as return_target,
         count(*) filter (where r.checked_out)                   as returned_count
    from public.campuses c
    left join public.registrations r
      on r.campus_id = c.id
     and r.event_id = public.active_event_id()
     and r.participation_status <> 'cancelled'
   group by c.id, c.name
   order by c.display_order;

-- ── 가드: 하행도 상행과 같은 규칙 ───────────────────────────
-- 3-C 전에는 "신청한 하행 편"이 없어서 어긋날 대상이 없었다. 이제 있다.
create or replace function public.guard_bus_trip_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- 막아야 할 것은 "인원이 있다"가 아니라 **"신청한 편과 어긋나게 된다"** 이다.
  -- (전자로 짰다가 마이그레이션의 backfill 까지 막혀 재현이 깨졌다)
  if new.up_trip_id is distinct from old.up_trip_id then
    select count(*) into v_n
      from registrations
     where assigned_up_bus_id = old.id
       and participation_status <> 'cancelled'
       and up_trip_id is distinct from new.up_trip_id;
    if v_n > 0 then
      raise exception
        '%에 배정된 %명이 신청한 상행 편과 어긋나게 됩니다. 먼저 재배차하세요.',
        old.name, v_n
        using errcode = 'restrict_violation';
    end if;
  end if;

  if new.down_trip_id is distinct from old.down_trip_id then
    select count(*) into v_n
      from registrations
     where assigned_down_bus_id = old.id
       and participation_status <> 'cancelled'
       and down_trip_id is distinct from new.down_trip_id;
    if v_n > 0 then
      raise exception
        '%에 배정된 %명이 신청한 하행 편과 어긋나게 됩니다. 먼저 재배차하세요.',
        old.name, v_n
        using errcode = 'restrict_violation';
    end if;
  end if;

  return new;
end $$;

-- 운행편 삭제 가드: 하행 편으로 신청한 사람도 본다.
create or replace function public.guard_trip_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_buses int;
  v_regs  int;
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

  -- 상·하행 양쪽을 본다. 예전엔 departure_slot_id(=상행)만 봐서
  -- 하행 편을 지우면 그 편 신청자가 조용히 붕 떴다.
  select count(*) into v_regs
    from registrations
   where (up_trip_id = old.id or down_trip_id = old.id)
     and participation_status <> 'cancelled';
  if v_regs > 0 then
    raise exception
      '"%" 운행편으로 신청한 사람이 %명 있습니다. 먼저 신청을 다른 편으로 옮겨 주세요.',
      old.label, v_regs
      using errcode = 'restrict_violation';
  end if;

  return old;
end $$;

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_trip smallint;
  v_bus  int;
  v_ok   boolean;
  v_rows int;
begin
  -- 뷰가 편별로 세는가 (하행 편이 1개면 전체와 같아야 하고, 컬럼은 존재해야 한다)
  select count(*) into v_rows from v_down_capacity;
  raise notice '하행 편 용량 뷰: %행', v_rows;

  select count(*) into v_rows from v_campus_stats where return_target > 0;
  raise notice 'v_campus_stats 귀가 대상 있는 캠퍼스: %개', v_rows;

  -- 하행 편으로 신청한 사람이 있는 편은 못 지운다
  select down_trip_id into v_trip from registrations
   where down_trip_id is not null and participation_status <> 'cancelled' limit 1;
  if v_trip is not null then
    v_ok := false;
    begin
      delete from event_trips where id = v_trip;
    exception when restrict_violation then v_ok := true;
    end;
    if not v_ok then
      raise exception '검증 실패: 하행 신청자가 있는 편이 삭제됐습니다';
    end if;
    raise notice '검증 ①: 하행 신청자 있는 편 삭제 차단 OK';
  end if;

  -- 하행 배정이 있는 차량의 하행 편 변경은 막힌다
  select assigned_down_bus_id into v_bus from registrations
   where assigned_down_bus_id is not null and participation_status <> 'cancelled' limit 1;
  if v_bus is not null then
    v_ok := false;
    begin
      -- 실제로 다른 편으로 바꾸는 대신 NULL 로 — 어긋남 판정은 같다
      update buses set down_trip_id = null where id = v_bus;
    exception when restrict_violation then v_ok := true;
    end;
    if not v_ok then
      raise exception '검증 실패: 하행 배정이 있는데 편이 바뀌었습니다';
    end if;
    raise notice '검증 ②: 하행 편 변경 차단 OK';
  end if;
end $$;

-- security_invoker 누락 검사 — 20260721000001 의 가드를 재사용.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\_%'
     and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'on';
  if v_bad is not null then
    raise exception 'security_invoker 가 꺼진 뷰: % — RLS 가 우회됩니다', v_bad;
  end if;
  raise notice 'security_invoker 전수 검사 통과';
end $$;
