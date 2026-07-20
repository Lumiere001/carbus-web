-- ============================================================
-- Phase 1 (4/4) — 소속 마스터(org_units) + registrations.home_unit_id
-- ============================================================
-- 왜?
--   비고에 적힌 "○○지구" 가 두 가지 정반대 뜻으로 쓰이고 있다.
--     (1) 소속  — "나는 저 지구 사람이다". campus='타지구' 인 70명이 여기 해당하고,
--                 이들은 69/70 이 **우리 버스를 탄다**.
--     (2) 수단  — "저 지구 차를 탄다". 광주 소속 학우들이 여기 해당하고,
--                 이들은 우리 버스를 안 탄다.
--   칸이 하나라 정반대 의미가 같은 자리에 눌려 있었다.
--
--   이 마이그레이션은 (1) 소속만 구조화한다. 판별자가 campus_id 에 이미 있어서
--   비고 파싱 없이 100% 안전하게 가를 수 있기 때문이다.
--   (2) 수단은 transport_legs 가 필요하므로 Phase 4 에서 한다.
--
-- ⚠️ 절대 규칙: 여기서 leg(외부 차량 이용) 를 만들지 않는다.
--    이 63건은 우리 버스 탑승자라, 외부수단으로 바꾸면 좌석이 회수된다.
--
-- 되돌리기: update registrations set home_unit_id = null; drop table org_units;
-- ============================================================

create table if not exists public.org_units (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  kind          text not null default 'district'
                check (kind in ('district','church','school','mission','company','other')),
  -- 표기 흔들림·오타 흡수용. 예: '새종지구'(오타) → '세종지구'
  aliases       text[] not null default '{}',
  display_order int  not null default 100,
  created_at    timestamptz not null default now()
);

comment on table public.org_units is
  '소속 단위(타 지구·교회·학교 등). 행사와 무관한 마스터 데이터라 event_id 를 붙이지 않는다.';
comment on column public.org_units.aliases is
  '같은 곳을 가리키는 다른 표기. 오타 포함. 검색·자동매칭에 쓴다.';

alter table public.org_units enable row level security;

drop policy if exists org_units_select on public.org_units;
create policy org_units_select on public.org_units for select using (true);

drop policy if exists org_units_master_all on public.org_units;
create policy org_units_master_all on public.org_units for all
  using (public.current_role() = 'master')
  with check (public.current_role() = 'master');

-- ── 시드 ─────────────────────────────────────────────────────
-- 운영 데이터(2026 여름수련회)에 실제로 등장한 소속만 넣는다.
-- 없는 곳은 화면에서 추가하면 된다.
insert into public.org_units (name, kind, aliases, display_order) values
  ('목포지구',     'district', '{}',            10),
  ('서울지구',     'district', '{서울남팀,서울북팀,서울서팀}', 20),
  ('전주지구',     'district', '{}',            30),
  ('용인지구',     'district', '{}',            40),
  ('충주지구',     'district', '{}',            50),
  ('대구지구',     'district', '{}',            60),
  ('포항지구',     'district', '{}',            70),
  ('부산지구',     'district', '{}',            80),
  ('순수지구',     'district', '{순천지구}',     90),
  ('익산지구',     'district', '{}',           100),
  ('인천지구',     'district', '{}',           110),
  ('천안지구',     'district', '{}',           120),
  ('춘천지구',     'district', '{}',           130),
  ('세종지구',     'district', '{새종지구}',    140),  -- '새종'은 오타
  ('공주지구',     'district', '{}',           150),
  ('김천구미지구', 'district', '{}',           160),
  ('대전지구',     'district', '{}',           170),
  ('수원지구',     'district', '{}',           180),
  ('안산지구',     'district', '{}',           190),
  ('안양지구',     'district', '{}',           200),
  ('의정부지구',   'district', '{}',           210),
  ('제주지구',     'district', '{}',           220),
  ('평안지구',     'district', '{}',           230),
  ('청주지구',     'district', '{}',           240),
  ('BI 선교부',    'mission',  '{BI선교부}',    900)
on conflict (name) do nothing;

-- ── registrations.home_unit_id ───────────────────────────────
alter table public.registrations
  add column if not exists home_unit_id uuid references public.org_units(id);

comment on column public.registrations.home_unit_id is
  '소속 단위. 광주 캠퍼스 학우는 NULL(campus_id 가 소속). 타 지구 학우만 채운다.
   "저 지구 차를 탄다"(이용 수단)와는 다른 개념 — 그건 Phase 4 transport_legs.';

create index if not exists idx_registrations_home_unit
  on public.registrations (home_unit_id) where home_unit_id is not null;

-- ── backfill (campus='타지구' 만, 비고의 선두 지구명으로 매칭) ─
-- 안전장치 3겹:
--   1) campus='타지구' 인 행만 — 광주 소속 학우는 절대 건드리지 않는다.
--   2) 비고의 첫 토큰이 마스터 이름/별칭과 정확히 일치할 때만.
--   3) 트리거를 끄고 갱신 — 감사 이력에 "아무도 안 바꾼" 599건이 쌓이지 않게.
do $$
declare matched int;
begin
  alter table public.registrations disable trigger user;

  with tj as (
    select r.id,
           -- 쉼표·괄호·줄바꿈 앞까지만 취한다.
           -- 예: '목포지구, 시험 일정으로...' → '목포지구'
           --     '부산지구 (○○ 동생)'        → '부산지구'
           btrim(split_part(split_part(split_part(r.note, ',', 1), '(', 1), E'\n', 1)) as head
      from registrations r
      join campuses c on c.id = r.campus_id
     where c.name = '타지구'
       and coalesce(btrim(r.note), '') <> ''
  )
  update registrations r
     set home_unit_id = u.id
    from tj
    join org_units u
      on u.name = tj.head or tj.head = any(u.aliases)
   where r.id = tj.id;

  get diagnostics matched = row_count;

  alter table public.registrations enable trigger user;

  raise notice 'home_unit_id backfill: %건 매칭', matched;
end $$;
