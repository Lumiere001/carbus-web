-- ============================================================
-- Phase 1 (1/4) — 행사(event) 골격
-- ============================================================
-- 왜?
--   지금 이 앱은 "2026 여름수련회" 한 행사 전용이다. 다음 행사(리더십 캠프 등)를
--   쓰려면 데이터를 지우는 수밖에 없는데, 그러면 지난 행사 기록이 사라진다.
--   실제로 취소의 실질 경로가 행 삭제였고(감사로그 delete 81건, 그중 납부완료 10건),
--   그 흔적은 registration_audit 에만 남아 있다.
--
--   그래서 "초기화 = 삭제"를 "초기화 = 새 행사로 전환"으로 바꾼다.
--   행사 데이터에 event_id 를 붙이고, 활성 행사만 보이게 하면
--   화면은 깨끗이 비워지면서 과거 기록은 DB 에 그대로 남는다.
--
-- 이 파일에서 하는 일: events 테이블 + event_id 컬럼 + backfill + 제약 범위 조정.
-- RLS·뷰는 다음 마이그레이션에서.
--
-- 되돌리기: 이 파일의 역순으로 DROP. event_id 는 nullable 로 시작해
--   backfill 후 NOT NULL 을 걸므로, 중간에 실패해도 기존 동작은 유지된다.
-- ============================================================

-- ── 1. events ────────────────────────────────────────────────
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  subtitle      text,
  starts_on     date,
  ends_on       date,
  origin        text,                 -- 출발 지역 (예: 광주)
  destination   text,                 -- 도착 지역 (예: 평창)
  -- 요금은 지금 registrations.fee 가 GENERATED 로 하드코딩하고 있다.
  -- 여기에 보관만 해두고 실제 전환은 Phase 2(원장 도입)에서 한다.
  fee_roundtrip int         not null default 50000,
  fee_oneway    int         not null default 25000,
  is_active     boolean     not null default false,
  created_at    timestamptz not null default now(),
  constraint events_period_valid check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

comment on table public.events is
  '행사(수련회·캠프 등). 활성 행사 1개만 화면에 보인다. 과거 행사는 삭제하지 않고 보관.';

-- 활성 행사는 항상 최대 1개.
create unique index if not exists uq_events_single_active
  on public.events (is_active) where is_active;

alter table public.events enable row level security;

-- 행사 목록은 로그인한 사람 누구나 읽을 수 있어야 화면 상단 배지를 그린다.
drop policy if exists events_select on public.events;
create policy events_select on public.events for select using (true);

drop policy if exists events_master_all on public.events;
create policy events_master_all on public.events for all
  using (public.current_role() = 'master')
  with check (public.current_role() = 'master');

-- ── 2. 현재 운영 데이터를 담을 행사 1건 ──────────────────────
insert into public.events (name, subtitle, starts_on, ends_on, origin, destination, is_active)
select '2026 여름수련회', 'CCC 71기 광주지구', date '2026-06-23', date '2026-06-27', '광주', '평창', true
where not exists (select 1 from public.events);

-- ── 3. 활성 행사 조회 헬퍼 ───────────────────────────────────
-- STABLE: 한 쿼리 안에서 값이 안 바뀌므로 플래너가 캐시할 수 있다.
-- 컬럼 DEFAULT 와 RLS·뷰에서 공통으로 쓴다.
create or replace function public.active_event_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.events where is_active limit 1
$$;

comment on function public.active_event_id() is
  '현재 활성 행사 id. event_id 컬럼 기본값·RLS 범위·뷰 필터의 단일 기준.';

grant execute on function public.active_event_id() to anon, authenticated, service_role;

-- ── 4. event_id 부착 (nullable → backfill → NOT NULL) ────────
-- DEFAULT 를 함께 걸어 앱 코드가 event_id 를 몰라도 활성 행사로 들어가게 한다.
-- (기존 INSERT 문을 한 줄도 안 고쳐도 되는 게 이 설계의 핵심)
-- ⚠️ backfill 중에는 사용자 트리거를 끈다.
--    registrations 에는 감사 트리거(trg_reg_audit)가 걸려 있어서, 그냥 UPDATE 하면
--    599건 전부에 대해 "아무도 안 바꾼" 감사 이력이 쌓이고 version 도 599번 튄다.
--    (실제로 이 가드 없이 돌렸을 때 registration_audit 이 18,967 → 19,566 으로 늘었다)
--    새 컬럼을 채우는 것은 업무 변경이 아니므로 이력에 남을 이유가 없다.
do $$
declare t text;
begin
  foreach t in array array[
    'registrations','buses','departure_slots','batch_runs',
    'campus_payment_settlements','campus_remittances','registration_audit'
  ] loop
    execute format('alter table public.%I add column if not exists event_id uuid references public.events(id)', t);
    execute format('alter table public.%I disable trigger user', t);
    execute format('update public.%I set event_id = public.active_event_id() where event_id is null', t);
    execute format('alter table public.%I enable trigger user', t);
    execute format('alter table public.%I alter column event_id set default public.active_event_id()', t);
    execute format('alter table public.%I alter column event_id set not null', t);
    execute format('create index if not exists idx_%s_event on public.%I (event_id)', t, t);
  end loop;
end $$;

-- ── 5. UNIQUE 제약을 행사 범위로 ─────────────────────────────
-- 다음 행사에서 같은 학우가 다시 신청하면 지금 제약에 걸려 등록이 막힌다.
alter table public.registrations drop constraint if exists uq_registrations_identity;
alter table public.registrations
  add constraint uq_registrations_identity unique (event_id, campus_id, student_id, name);

-- 출발편 key('tue_am' 등)도 행사마다 다시 쓰인다.
alter table public.departure_slots drop constraint if exists departure_slots_key_key;
alter table public.departure_slots
  add constraint departure_slots_key_key unique (event_id, key);

-- 호차 이름('1호차' 등)은 행사마다 그대로 다시 쓴다.
-- 이걸 놓치면 새 행사의 차량 복제가 "duplicate key: 1호차" 로 막혀 행사를 아예 못 연다.
alter table public.buses drop constraint if exists buses_name_key;
alter table public.buses
  add constraint buses_name_key unique (event_id, name);

-- 캠퍼스 정산은 행사별로 한 행씩.
alter table public.campus_payment_settlements drop constraint if exists campus_payment_settlements_pkey;
alter table public.campus_payment_settlements
  add constraint campus_payment_settlements_pkey primary key (event_id, campus_id);
