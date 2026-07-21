-- ============================================================
-- Phase 3 (3/n) — departure_slots → event_trips, 상·하행 대칭 운행편 모델
-- ============================================================
-- 목표(사용자 확정): **행사에 관계없이 항상 쓸 수 있는 범용 틀**.
--   하행은 상행과 완전 대칭이어야 한다 — "용어만 하행으로 바뀔 뿐".
--   지금 여름수련회는 하행 출발시각이 하나뿐이지만, 다음 행사에서 갈릴 때
--   **스키마 마이그레이션 없이** 되어야 한다.
--
-- 무엇이 문제였나:
--   상행만 운행편(departure_slots)을 갖고, 하행은 uses_return_bus 불린 하나였다.
--   그래서 하행에는 출발 시각 개념이 아예 없고, 차량을 하행 편별로 나눌 수도 없다.
--   게다가 차량 생성·삭제 경로와 운행편 편집 경로가 코드에 **0곳**이라,
--   다음 행사에서 대수·시각을 화면에서 바꿀 방법이 없다(create_event 복제본 그대로).
--
-- 왜 RENAME 인가 (신설+미러 동기화가 아니라):
--   신설 방식은 이중 진실을 만들고, 적대적 검증에서 치명결함이 나왔다 —
--   /admin/trips 로 **새 운행편을 만드는 순간 FK 위반으로 죽는다**
--   (buses.departure_slot_id 가 NOT NULL + 기본값 없음 + FK NO ACTION이라 우회 불가).
--   RENAME 은 FK·인덱스·제약·RLS·뷰가 전부 자동으로 따라온다(로컬 트랜잭션에서 실측).
--   이중 진실이 원천적으로 생기지 않는다.
--
-- 왜 앱이 안 깨지나 (이 마이그레이션은 앱 관점에서 순수 가법):
--   ① 옛 이름 호환 뷰 public.departure_slots (상행 편만) 를 남긴다.
--   ② v_bus_occupancy / v_day_capacity 가 옛 출력 컬럼명을 **별칭으로 유지**한다.
--   그래서 코드 53개 파일을 건드리지 않고 DB 를 먼저 반영할 수 있다
--   (HANDOFF §3 의 "DB 먼저 → 확인 → 코드" 순서를 지킬 수 있다는 뜻).
--
-- ⚠️ registrations 는 이 마이그레이션에서 **건드리지 않는다.**
--    departure_slot_id 는 이름 그대로 두고(FK 만 event_trips 로 자동 이동),
--    uses_return_bus 도 그대로다. 신청 쪽 대칭화는 별도 마이그레이션에서 한다
--    (CHECK 3종 재작성 + 신청 폼 재설계가 함께 와야 하므로).
--
-- 되돌리기: 이 파일은 rename 이 주라 역방향 rename 으로 되돌릴 수 있다.
--   drop view public.departure_slots;  -- 호환 뷰 먼저
--   alter table public.event_trips rename to departure_slots;
--   alter table public.buses rename column up_trip_id to departure_slot_id;
--   alter table public.buses drop column down_trip_id;
--   delete from public.departure_slots where direction = 'down';
--   alter table public.departure_slots drop column direction, drop column departs_at,
--     drop column origin, drop column destination;
--   그 뒤 20260721060000 의 create_event 정의와 이전 뷰 정의를 다시 실행.
-- ============================================================

-- ── 1. 테이블·컬럼 이름 변경 ────────────────────────────────
-- FK·인덱스·제약·RLS 정책·뷰 정의가 전부 자동으로 따라온다(OID 참조).
--
-- ⚠️ 재실행 안전해야 한다. scripts/local-verify/post-load.sh 가 운영 백업을 적재한 뒤
--    이 파일을 다시 돌린다(하행 편 생성이 데이터 의존 backfill 이라서).
--    rename 은 본질적으로 비멱등이므로 "아직 옛 이름일 때만" 실행한다.
do $$
begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='departure_slots') then
    alter table public.departure_slots rename to event_trips;
    alter table public.buses rename column departure_slot_id to up_trip_id;

    -- 자동으로 따라온 객체들의 **이름**은 옛것으로 남는다. 다음 사람이 헷갈리지 않게 정리.
    alter table public.event_trips rename constraint departure_slots_event_id_fkey to event_trips_event_id_fkey;
    alter table public.buses       rename constraint buses_departure_slot_id_fkey  to buses_up_trip_id_fkey;
    alter index public.departure_slots_pkey      rename to event_trips_pkey;
    alter index public.idx_departure_slots_event rename to idx_event_trips_event;
    alter policy departure_slots_event_scope on public.event_trips rename to event_trips_event_scope;
    alter policy departure_slots_master_all  on public.event_trips rename to event_trips_master_all;
    alter policy departure_slots_select      on public.event_trips rename to event_trips_select;
    raise notice 'departure_slots → event_trips 이름 변경 완료';
  else
    raise notice '이미 event_trips 입니다 — 이름 변경 건너뜀';
  end if;
end $$;

-- ── 2. 운행편을 방향·시각·구간을 갖는 실체로 ────────────────
alter table public.event_trips
  add column if not exists direction   text not null default 'up',
  add column if not exists departs_at  timestamptz,
  add column if not exists origin      text,
  add column if not exists destination text;

alter table public.event_trips
  drop constraint if exists event_trips_direction_check;
alter table public.event_trips
  add constraint event_trips_direction_check check (direction in ('up','down'));

-- key 유일성을 방향별로 푼다. 상행 'tue_am' 과 하행 'tue_am' 이 공존할 수 있어야 한다.
alter table public.event_trips drop constraint if exists departure_slots_key_key;
drop index if exists public.departure_slots_key_key;
do $$
begin
  -- ADD CONSTRAINT 에는 IF NOT EXISTS 가 없다. 재실행 안전하게 존재 여부로 감싼다.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.event_trips'::regclass and conname = 'event_trips_key_key'
  ) then
    alter table public.event_trips
      add constraint event_trips_key_key unique (event_id, direction, key);
  end if;
end $$;

comment on table  public.event_trips is
  '행사의 운행편. 상행(direction=up)·하행(down)을 같은 구조로 다룬다. 방향마다 여러 편을 둘 수 있다.';
comment on column public.event_trips.direction is
  'up=가는 편, down=오는 편. 두 방향은 완전히 대칭이다.';
comment on column public.event_trips.departs_at is
  '실제 출발 일시(KST). 기존 label("화 오전 9시")에는 연·월·일이 없어 파싱할 수 없으므로 nullable 로 시작하고 화면에서 채운다.';

-- ── 3. 차량도 방향별 운행편에 매달린다 ──────────────────────
-- up_trip_id 를 nullable 로 푼다 — "하행만 운행하는 차량"이 표현 가능해야 범용이다.
-- (지금 데이터는 전 차량이 상행 편을 갖고 있어 동작 변화는 없다.
--  엔진은 up_trip_id IS NULL 인 차량을 상행 배차에서 제외하도록 함께 고친다.)
alter table public.buses alter column up_trip_id drop not null;

alter table public.buses
  add column if not exists down_trip_id smallint;

alter table public.buses drop constraint if exists buses_down_trip_id_fkey;
alter table public.buses
  add constraint buses_down_trip_id_fkey
  foreign key (down_trip_id) references public.event_trips(id);

create index if not exists idx_buses_up_trip   on public.buses(up_trip_id);
create index if not exists idx_buses_down_trip on public.buses(down_trip_id);

comment on column public.buses.up_trip_id is
  '이 차량이 운행하는 상행 편. NULL 이면 상행을 운행하지 않는다.';
comment on column public.buses.down_trip_id is
  '이 차량이 운행하는 하행 편. NULL 이면 하행을 운행하지 않는다.';

-- ── 4. 행사마다 하행 편을 하나 만든다 ───────────────────────
-- 지금까지 하행은 uses_return_bus 불린 하나로만 존재했다. 실체가 없으니 만든다.
-- **전 행사 대상**이다 — 활성 행사만 하면 지난·예정 행사가 하행 편 0건으로 남는다.
insert into public.event_trips (key, label, display_order, active, event_id, direction)
select 'return', '귀가', 100, true, e.id, 'down'
  from public.events e
 where not exists (
   select 1 from public.event_trips t
    where t.event_id = e.id and t.direction = 'down'
 );

-- 차량은 전부 그 행사의 하행 편을 운행한다(현행 엔진이 "하행은 전 호차 운행"이었다).
update public.buses b
   set down_trip_id = t.id
  from public.event_trips t
 where t.event_id = b.event_id
   and t.direction = 'down'
   and b.down_trip_id is null;

-- ── 5. 뷰 재작성 ────────────────────────────────────────────
-- 정의는 파일이 아니라 **DB 의 현재 실물**(pg_get_viewdef)을 기준으로 삼았다.
-- 정본이 여러 파일에 흩어져 있어 최초 파일만 읽으면 옛 버전을 베낀다(HANDOFF §4).
--
-- ⚠️ security_invoker = on 을 반드시 명시한다. 빠뜨리면 뷰가 소유자(postgres,
--    rolbypassrls) 권한으로 평가돼 RLS 가 통째로 우회된다. 실측 피해:
--    campus_admin 이 자기 캠퍼스 8건 대신 16개 캠퍼스 599건을 보게 된다.
--    CREATE OR REPLACE 라도 WITH 절을 생략하면 기존 설정이 조용히 사라진다.

-- 컬럼명이 바뀌므로 REPLACE 불가 → DROP + CREATE.
-- 두 뷰 모두 의존 뷰가 없어 CASCADE 사고 위험은 없다(pg_depend 확인).
drop view if exists public.v_bus_occupancy;
create view public.v_bus_occupancy with (security_invoker = on) as
  select b.id   as bus_id,
         b.name as bus_name,
         -- 옛 이름을 별칭으로 유지 → 기존 화면 코드가 그대로 돈다.
         b.up_trip_id as departure_slot_id,
         b.up_trip_id,
         b.down_trip_id,
         b.capacity,
         b.hard_cap,
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
    from public.buses b
   where b.event_id = public.active_event_id()
   order by b.id;

-- v_day_capacity: 상행 편 기준. 출력 컬럼명(slot_*)은 그대로 두어 화면을 보존한다.
-- registrations 는 아직 departure_slot_id 를 쓰므로 그대로 참조한다.
drop view if exists public.v_day_capacity;
create view public.v_day_capacity with (security_invoker = on) as
  select t.id   as slot_id,
         t.key  as slot_key,
         t.label as slot_label,
         t.display_order,
         t.departs_at,
         coalesce(sum(b.capacity), 0::bigint) as total_capacity,
         (select count(*) from registrations r
           where r.departure_slot_id = t.id and r.event_id = t.event_id
             and r.participation_status <> 'cancelled') as total_passengers,
         (select count(*) from registrations r
           where r.departure_slot_id = t.id and r.checked_in and r.event_id = t.event_id
             and r.participation_status <> 'cancelled') as arrived,
         coalesce(sum(b.capacity), 0::bigint) - (select count(*) from registrations r
           where r.departure_slot_id = t.id and r.event_id = t.event_id
             and r.participation_status <> 'cancelled') as remaining_seats
    from public.event_trips t
    left join public.buses b on b.up_trip_id = t.id and b.event_id = t.event_id
   where t.active and t.direction = 'up' and t.event_id = public.active_event_id()
   group by t.id, t.key, t.label, t.display_order, t.departs_at, t.event_id
   order by t.display_order;

-- 하행 대칭 뷰 — 상행의 v_day_capacity 와 같은 모양. 화면이 대칭으로 붙을 수 있게.
drop view if exists public.v_down_capacity;
create view public.v_down_capacity with (security_invoker = on) as
  select t.id    as trip_id,
         t.key   as trip_key,
         t.label as trip_label,
         t.display_order,
         t.departs_at,
         coalesce(sum(b.capacity), 0::bigint) as total_capacity,
         (select count(*) from registrations r
           where r.uses_return_bus and r.event_id = t.event_id
             and r.participation_status <> 'cancelled') as total_passengers,
         (select count(*) from registrations r
           where r.uses_return_bus and r.checked_out and r.event_id = t.event_id
             and r.participation_status <> 'cancelled') as returned
    from public.event_trips t
    left join public.buses b on b.down_trip_id = t.id and b.event_id = t.event_id
   where t.active and t.direction = 'down' and t.event_id = public.active_event_id()
   group by t.id, t.key, t.label, t.display_order, t.departs_at, t.event_id
   order by t.display_order;

-- 옛 이름 호환 뷰 — 아직 "departure_slots" 를 조회하는 코드가 그대로 돌게 한다.
-- 상행 편만 보여준다(옛 의미가 곧 상행이었다). 코드 전환이 끝나면 지운다.
drop view if exists public.departure_slots;
create view public.departure_slots with (security_invoker = on) as
  select id, key, label, display_order, active, created_at, event_id
    from public.event_trips
   where direction = 'up';

comment on view public.departure_slots is
  '[전환용] event_trips 의 상행 편. 옛 이름을 조회하는 코드가 살아 있는 동안만 유지한다. 새 코드는 event_trips 를 직접 쓸 것.';

-- ── 6. create_event 가 방향별 운행편·차량을 복제하도록 ──────
-- 빠뜨리면 새 행사가 하행 편 0건 / 차량 FK 깨짐으로 태어난다.
create or replace function public.create_event(
  p_name          text,
  p_subtitle      text    default null,
  p_starts_on     date    default null,
  p_ends_on       date    default null,
  p_origin        text    default null,
  p_destination   text    default null,
  p_copy_trips    boolean default true,
  p_copy_buses    boolean default true,
  p_fee_roundtrip integer default null,
  p_fee_oneway    integer default null
) returns uuid
language plpgsql security definer set search_path = public as $function$
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
  delete from _trip_map;

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
              r.direction, coalesce(p_origin, r.origin), coalesce(p_destination, r.destination))
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

-- ── 7. 자체검증 ─────────────────────────────────────────────
do $$
declare
  v_ev        int;
  v_no_down   int;
  v_bus_nodown int;
  v_orphan    int;
begin
  -- 모든 행사가 하행 편을 갖는가
  select count(*) into v_no_down
    from events e
   where not exists (select 1 from event_trips t
                      where t.event_id = e.id and t.direction = 'down');
  if v_no_down > 0 then
    raise exception '하행 편이 없는 행사 %건', v_no_down;
  end if;

  -- 차량이 전부 하행 편에 연결됐는가
  select count(*) into v_bus_nodown from buses where down_trip_id is null;
  if v_bus_nodown > 0 then
    raise exception '하행 편 미연결 차량 %대', v_bus_nodown;
  end if;

  -- 차량의 편이 같은 행사에 속하는가 (행사 간 교차 참조 = 데이터 유출 경로)
  select count(*) into v_orphan
    from buses b
    left join event_trips u on u.id = b.up_trip_id
    left join event_trips d on d.id = b.down_trip_id
   where (b.up_trip_id   is not null and (u.event_id is distinct from b.event_id or u.direction <> 'up'))
      or (b.down_trip_id is not null and (d.event_id is distinct from b.event_id or d.direction <> 'down'));
  if v_orphan > 0 then
    raise exception '행사·방향이 어긋난 차량-운행편 연결 %건', v_orphan;
  end if;

  select count(*) into v_ev from events;
  raise notice '운행편 모델 전환 완료: 행사 %개, 상행 %편 / 하행 %편, 차량 %대',
    v_ev,
    (select count(*) from event_trips where direction='up'),
    (select count(*) from event_trips where direction='down'),
    (select count(*) from buses);
end $$;

-- security_invoker 누락 검사 — 20260721000001 의 가드를 그대로 재사용한다.
-- WITH 절을 하나라도 빠뜨리면 여기서 배포가 멈춘다(RLS 우회 = 타 캠퍼스 개인정보 유출).
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

  -- 호환 뷰는 v_ 접두사가 아니라 위 검사에 안 걸린다. 따로 확인한다.
  if coalesce((select option_value from pg_options_to_table(c.reloptions)
                where option_name = 'security_invoker'), 'false') <> 'on'
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='departure_slots'
  then
    raise exception 'departure_slots 호환 뷰의 security_invoker 가 꺼져 있습니다';
  end if;
end $$;
