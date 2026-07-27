-- ============================================================
-- 3단계 — 비고 구조화: 이동수단을 자유 텍스트에서 꺼낸다
-- ============================================================
-- 사용자 피드백 원문:
--   "타지구 차량을 이용하는 사람도 생각보다 많고, 타지구의 경우에도 확정이 날 때까지
--    기다려야 하는 경우도 많고, 그것을 잘 구분이 필요해. 그리고 그것을 시각적으로
--    한눈에 잘 보이도록 하는 것도 필요했었고. KTX 이용도 마찬가지야."
--
-- 왜 자유 텍스트로는 안 되는가 (실측):
--   · 비고 사용률 599명 중 226명(37.7%)
--   · **"타지구"가 정반대 두 뜻으로 섞여 있다** — 소속이 타지구(63건) / 타지구 *차량*을
--     얻어 탐(80건). 문자열만 봐서는 구분 자체가 불가능하다.
--   · 그래서 "비고 텍스트로 자동 판정하지 않는다"가 이 레포의 규칙이 됐다(§4 규칙 4).
--     판정을 포기하는 대신 **입력 단계에서 구조로 받는다.**
--
-- 소속 쪽 "타지구"는 이미 `registrations.home_unit_id`(org_units)로 처리돼 있다.
-- 이 파일이 다루는 건 **이용수단**뿐이다. 두 개념을 갈라놓는 게 핵심이다.
--
-- 방향별로 따로 받는다. Phase 3 에서 상·하행이 대칭이 됐고, 실제로 "갈 때는 KTX,
-- 올 때는 우리 버스" 같은 조합이 있다. 한 칸으로 받으면 그게 표현이 안 된다.
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'transport_mode') then
    create type public.transport_mode as enum
      ('our_bus', 'other_district', 'ktx', 'own_car', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'transport_status') then
    -- pending = "타기로 했는데 아직 확정이 안 났다". 확정될 때까지 **우리 버스 좌석을
    -- 잡아둔다**(사용자 결정) — 타지구가 안 되면 바로 타야 하기 때문이다.
    create type public.transport_status as enum ('confirmed', 'pending');
  end if;
end $$;

create table if not exists public.transport_legs (
  id              bigint generated always as identity primary key,
  event_id        uuid not null references public.events(id),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  direction       text not null check (direction in ('up', 'down')),
  mode            public.transport_mode   not null,
  -- 타지구 차량일 때 **어느 지구**인지. 지구 목록은 이미 org_units 에 있다(24개).
  via_unit_id     uuid references public.org_units(id),
  status          public.transport_status not null default 'confirmed',
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (registration_id, direction)
);

comment on table public.transport_legs is
  '방향별 이동수단. 우리 버스가 아닌 경로(타지구 차량·KTX·자차)를 구조로 받는다.
   비고 자유 텍스트로는 "타지구"의 두 뜻(소속/이용수단)이 구분되지 않았다.
   소속은 registrations.home_unit_id 가 따로 담당한다.';
comment on column public.transport_legs.status is
  'pending = 타지구 확정 대기. 이 동안 우리 버스 좌석은 그대로 잡아둔다(사용자 결정).
   확정되면 운영자가 그 방향 운행편을 비워 좌석을 반납한다.';

create index if not exists idx_transport_legs_event on public.transport_legs (event_id);
create index if not exists idx_transport_legs_reg   on public.transport_legs (registration_id);
create index if not exists idx_transport_legs_pending
  on public.transport_legs (event_id) where status = 'pending';

-- 타지구인데 지구를 안 적었거나, 타지구가 아닌데 지구를 적은 것을 막는다.
alter table public.transport_legs drop constraint if exists chk_via_unit_only_other_district;
alter table public.transport_legs
  add constraint chk_via_unit_only_other_district
  check (
    (mode = 'other_district' and via_unit_id is not null)
    or (mode <> 'other_district' and via_unit_id is null)
  );

-- "확정 대기"는 타지구 차량에서만 의미가 있다. 우리 버스를 타는데 대기일 수는 없다.
alter table public.transport_legs drop constraint if exists chk_pending_only_other_district;
alter table public.transport_legs
  add constraint chk_pending_only_other_district
  check (status = 'confirmed' or mode = 'other_district');

-- ── 행사 범위 (Phase 4 와 같은 형태) ────────────────────────
alter table public.transport_legs enable row level security;

drop policy if exists transport_legs_select on public.transport_legs;
create policy transport_legs_select on public.transport_legs for select
  using (
    exists (select 1 from public.registrations r
             where r.id = registration_id
               and (public.current_role() in ('master', 'viewer')
                    or r.campus_id = public.current_campus()))
  );

drop policy if exists transport_legs_write on public.transport_legs;
create policy transport_legs_write on public.transport_legs for all
  using (
    exists (select 1 from public.registrations r
             where r.id = registration_id
               and (public.current_role() = 'master'
                    or (public.current_role() = 'campus_admin'
                        and r.campus_id = public.current_campus())))
  )
  with check (
    exists (select 1 from public.registrations r
             where r.id = registration_id
               and (public.current_role() = 'master'
                    or (public.current_role() = 'campus_admin'
                        and r.campus_id = public.current_campus())))
  );

-- 행사 범위 + 쓰기 가드 — Phase 4 가 만든 것과 **같은 방식**이어야 한다.
-- 새 테이블을 만들 때 이걸 빠뜨리면 그 테이블만 폴더화 밖에 남는다.
drop policy if exists transport_legs_event_scope on public.transport_legs;
create policy transport_legs_event_scope on public.transport_legs as restrictive for all
  using (event_id = (select public.viewing_event_id()))
  with check ((select public.is_event_writable(event_id)));

drop policy if exists transport_legs_event_delete on public.transport_legs;
create policy transport_legs_event_delete on public.transport_legs as restrictive for delete
  using ((select public.is_event_writable(event_id)));

drop trigger if exists trg_transport_legs_event_writable on public.transport_legs;
create trigger trg_transport_legs_event_writable
  before insert or update or delete on public.transport_legs
  for each row execute function public.guard_event_writable();
alter table public.transport_legs enable always trigger trg_transport_legs_event_writable;

-- 신청과 같은 행사여야 한다 (교차 행사 참조 차단).
create or replace function public.guard_transport_leg_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from registrations r
                  where r.id = new.registration_id and r.event_id = new.event_id) then
    raise exception '이동수단이 다른 행사의 신청을 가리킵니다.'
      using errcode = 'foreign_key_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_transport_legs_scope on public.transport_legs;
create trigger trg_transport_legs_scope
  before insert or update on public.transport_legs
  for each row execute function public.guard_transport_leg_scope();
alter table public.transport_legs enable always trigger trg_transport_legs_scope;

-- ── 한눈에 보기 위한 뷰 ─────────────────────────────────────
-- 화면이 매번 조인·집계하지 않게, 사람 단위로 납작하게 편다.
-- (피드백: "시각적으로 한눈에 잘 보이도록 하는 것도 필요했었고")
drop view if exists public.v_transport_summary;
create view public.v_transport_summary with (security_invoker = on) as
select
  r.id            as registration_id,
  r.event_id,
  up.mode         as up_mode,
  up.status       as up_status,
  uu.name         as up_via_unit,
  dn.mode         as down_mode,
  dn.status       as down_status,
  du.name         as down_via_unit,
  -- 어느 방향이든 확정 대기가 있으면 그 사람은 "대기"다. 배차·정원 판단에 쓴다.
  (up.status = 'pending' or dn.status = 'pending') as has_pending,
  -- 우리 버스 외 수단을 하나라도 쓰는가 (부분참·명단 화면 배지용)
  (coalesce(up.mode, 'our_bus') <> 'our_bus'
   or coalesce(dn.mode, 'our_bus') <> 'our_bus') as uses_other_transport
from public.registrations r
left join public.transport_legs up
       on up.registration_id = r.id and up.direction = 'up'
left join public.transport_legs dn
       on dn.registration_id = r.id and dn.direction = 'down'
left join public.org_units uu on uu.id = up.via_unit_id
left join public.org_units du on du.id = dn.via_unit_id;

comment on view public.v_transport_summary is
  '사람 단위로 편 이동수단 요약. 화면이 조인을 반복하지 않게. has_pending 은
   "타지구 확정 대기" — 그 동안 우리 버스 좌석을 잡아두므로 정원 판단에 쓴다.';

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_event uuid := public.active_event_id();
  v_reg   uuid;
  v_unit  uuid;
  v_ok    boolean;
begin
  select id into v_reg from registrations where event_id = v_event limit 1;
  select id into v_unit from org_units where kind = 'district' limit 1;
  if v_reg is null then
    raise notice '  (신청 데이터가 없어 검증 건너뜀)';
    return;
  end if;

  -- ① 타지구인데 지구를 안 적으면 거부
  v_ok := false;
  begin
    insert into transport_legs (event_id, registration_id, direction, mode)
    values (v_event, v_reg, 'up', 'other_district');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '검증 실패: 지구 없는 타지구가 들어갔습니다'; end if;
  raise notice '검증 ①: 타지구인데 지구 미기재 → 거부 OK';

  -- ② 우리 버스인데 지구를 적으면 거부
  v_ok := false;
  begin
    insert into transport_legs (event_id, registration_id, direction, mode, via_unit_id)
    values (v_event, v_reg, 'up', 'our_bus', v_unit);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '검증 실패: 우리 버스에 지구가 붙었습니다'; end if;
  raise notice '검증 ②: 우리 버스 + 지구 → 거부 OK';

  -- ③ 우리 버스인데 "확정 대기"는 말이 안 된다
  v_ok := false;
  begin
    insert into transport_legs (event_id, registration_id, direction, mode, status)
    values (v_event, v_reg, 'up', 'ktx', 'pending');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '검증 실패: 타지구가 아닌데 대기 상태가 됐습니다'; end if;
  raise notice '검증 ③: 타지구 아닌 확정 대기 → 거부 OK';

  -- ④ 정상 입력 + 요약 뷰가 읽힌다
  insert into transport_legs (event_id, registration_id, direction, mode, via_unit_id, status)
  values (v_event, v_reg, 'up', 'other_district', v_unit, 'pending');
  if not exists (select 1 from v_transport_summary
                  where registration_id = v_reg and has_pending) then
    raise exception '검증 실패: 요약 뷰가 확정 대기를 못 봅니다';
  end if;
  raise notice '검증 ④: 정상 입력 + 요약 뷰 OK';

  -- ⑤ 한 사람 한 방향은 한 줄만
  v_ok := false;
  begin
    insert into transport_legs (event_id, registration_id, direction, mode)
    values (v_event, v_reg, 'up', 'ktx');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception '검증 실패: 같은 방향이 두 줄 들어갔습니다'; end if;
  raise notice '검증 ⑤: 한 사람 한 방향 = 한 줄 OK';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
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
       and t.tgname = 'trg_transport_legs_event_writable' and t.tgenabled = 'A'
  ) then
    raise exception 'transport_legs 쓰기 가드가 ENABLE ALWAYS 가 아닙니다';
  end if;
  raise notice 'security_invoker · 쓰기 가드 확인';
end $$;
