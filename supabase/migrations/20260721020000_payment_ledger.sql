-- ============================================================
-- Phase 2-A (1/2) — 결제 원장(payment_ledger)
-- ============================================================
-- 왜?
--   지금은 차량비를 얼마 청구했는지가 registrations.fee 한 칸에만 있고,
--   그 값은 attendance_type 에서 자동 계산된다(왕복 50000 / 편도 25000 / 미이용 0).
--   그래서 버스를 취소해 '미이용'으로 바꾸는 순간 청구액이 0원이 되고,
--   **이미 받은 돈의 흔적이 사라진다.**
--
--   실제로 이 일이 벌어졌다. 납부 시점의 청구액을 감사로그에서 복원해 보면
--   "낸 돈 > 현재 청구액" 인 사람이 46명 / 1,350,000원이다.
--   그중 28명은 비고에 아무 언급이 없어 아무도 모르고 있었다.
--
--   → 돈이 오간 내역을 한 줄씩 쌓는 원장을 만든다. 참여 형태가 바뀌어도
--     과거 기록은 지워지지 않는다.
--
-- 설계 결정: payment_status 는 그대로 둔다(원장에서 파생시키지 않는다).
--   · Postgres 생성컬럼은 다른 테이블을 참조할 수 없어 원장 합계를 넣을 수 없다.
--   · 'waived'(면제) 24건은 금액이 없는 정책 판단이라 금액 행으로 표현 못 한다.
--   · registrations 만 realtime publication 에 있어서, 파생으로 바꾸면
--     납부 변경이 다른 임역원 화면에 실시간 반영되지 않는다(조용히 깨짐).
--   원장은 '기록'을, payment_status 는 '현재 상태'를 담당한다.
--
-- 되돌리기: drop table payment_ledger; 그리고 fee 를 다시 GENERATED 로.
--   (이 파일 하단 주석에 복원 SQL 을 적어둔다)
-- ============================================================

-- ── 1. 원장 ──────────────────────────────────────────────────
create table if not exists public.payment_ledger (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null default public.active_event_id() references public.events(id),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  -- charge  : 청구 (받아야 할 돈)
  -- payment : 수납 (받은 돈)
  -- refund  : 환불 (돌려준 돈)
  -- waive   : 면제 (안 받기로 한 돈)
  -- adjust  : 조정 (상계·대체납부 등 위 넷으로 안 떨어지는 경우)
  kind            text not null check (kind in ('charge','payment','refund','waive','adjust')),
  amount          int  not null check (amount >= 0),
  occurred_at     timestamptz not null default now(),
  actor           uuid references public.profiles(id),
  reason          text,
  -- 이 행이 어디서 왔는지. 마이그레이션 이관분을 한 줄로 되돌릴 수 있게 한다.
  source          text not null default 'app'
                  check (source in ('app','migration','sync')),
  created_at      timestamptz not null default now()
);

comment on table public.payment_ledger is
  '차량비 원장. 청구·수납·환불·면제를 한 줄씩 쌓는다. registrations.fee 가 바뀌어도 과거 기록은 남는다.';

create index if not exists idx_ledger_reg   on public.payment_ledger (registration_id, occurred_at);
create index if not exists idx_ledger_event on public.payment_ledger (event_id);
create index if not exists idx_ledger_kind  on public.payment_ledger (event_id, kind);

alter table public.payment_ledger enable row level security;

-- Phase 1 과 같은 방식: 역할 정책 + 행사 범위 RESTRICTIVE 정책.
drop policy if exists ledger_master_all on public.payment_ledger;
create policy ledger_master_all on public.payment_ledger for all
  using (public.current_role() = 'master')
  with check (public.current_role() = 'master');

drop policy if exists ledger_viewer_select on public.payment_ledger;
create policy ledger_viewer_select on public.payment_ledger for select
  using (public.current_role() = 'viewer');

drop policy if exists ledger_campus_select on public.payment_ledger;
create policy ledger_campus_select on public.payment_ledger for select
  using (
    public.current_role() = 'campus_admin'
    and registration_id in (
      select id from public.registrations where campus_id = public.current_campus()
    )
  );

drop policy if exists payment_ledger_event_scope on public.payment_ledger;
create policy payment_ledger_event_scope on public.payment_ledger as restrictive for all
  using (event_id = public.active_event_id())
  with check (event_id = public.active_event_id());

-- ── 2. fee 를 생성컬럼에서 해제 ──────────────────────────────
-- drop column 을 쓰면 CASCADE 로 v_payment_summary 가 함께 삭제돼 납부 화면이
-- 즉시 죽는다(pg_depend 로 의존 객체가 그 뷰 하나임을 확인). DROP EXPRESSION 은
-- 값을 그대로 둔 채 '자동 계산' 성질만 뗀다.
do $$
begin
  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.registrations'::regclass
       and attname = 'fee' and attgenerated <> ''
  ) then
    alter table public.registrations alter column fee drop expression;
    raise notice 'fee: 생성컬럼 → 일반 컬럼 (값 보존)';
  else
    raise notice 'fee: 이미 일반 컬럼';
  end if;
end $$;

-- ── 3. 요금 적용 규칙 ────────────────────────────────────────
-- 해제했으니 이제 누군가 fee 를 채워야 한다. 규칙:
--   · 새로 등록하면 행사 요금표대로 청구액을 매긴다.
--   · 참여 형태가 바뀌면, **아직 안 낸 사람만** 청구액을 다시 계산한다.
--     이미 낸 사람의 청구액은 건드리지 않는다 — 그 순간 받은 돈의 근거가
--     사라지기 때문이다. 이게 지금까지 46명이 안 보이던 원인이다.
--     낸 사람의 금액을 바꿔야 하면 원장에 환불·조정을 남기면 된다.
create or replace function public.apply_event_fare()
returns trigger language plpgsql as $$
declare
  v_rt int;
  v_ow int;
begin
  select fee_roundtrip, fee_oneway into v_rt, v_ow
    from events where id = coalesce(new.event_id, public.active_event_id());
  v_rt := coalesce(v_rt, 50000);
  v_ow := coalesce(v_ow, 25000);

  if tg_op = 'INSERT' then
    if new.fee is null then
      new.fee := case new.attendance_type
                   when 'roundtrip' then v_rt
                   when 'oneway'    then v_ow
                   else 0 end;
    end if;
    return new;
  end if;

  -- UPDATE: 아직 안 낸 사람만 재계산
  if new.payment_status = 'unpaid' then
    new.fee := case new.attendance_type
                 when 'roundtrip' then v_rt
                 when 'oneway'    then v_ow
                 else 0 end;
  else
    new.fee := old.fee;   -- 낸 사람의 청구액은 동결
  end if;
  return new;
end $$;

comment on function public.apply_event_fare is
  '청구액 규칙. 미납이면 참여형태 따라 재계산, 납부·면제면 동결(받은 돈의 근거를 지우지 않기 위해).';

-- 이름을 trg_reg_00_fare 로 잡아 감사 트리거(trg_reg_audit)보다 먼저 돌게 한다.
-- (BEFORE 트리거는 이름 알파벳순으로 실행된다)
drop trigger if exists trg_reg_00_fare on public.registrations;
create trigger trg_reg_00_fare
  before insert or update on public.registrations
  for each row execute function public.apply_event_fare();

-- ── 4. 잔액 뷰 ───────────────────────────────────────────────
-- 낸 돈 - 청구액 - 환불액. 양수면 더 받은 것(환불 확인 대상), 음수면 미수.
create or replace view public.v_payment_balance
with (security_invoker = on) as
  select r.id as registration_id,
         r.event_id,
         r.campus_id,
         r.name,
         r.payment_status,
         r.fee as charged_now,
         coalesce(sum(l.amount) filter (where l.kind = 'payment'), 0) as paid_total,
         coalesce(sum(l.amount) filter (where l.kind = 'refund'),  0) as refunded_total,
         coalesce(sum(l.amount) filter (where l.kind = 'waive'),   0) as waived_total,
         coalesce(sum(l.amount) filter (where l.kind = 'charge'),  0) as charged_total,
         coalesce(sum(l.amount) filter (where l.kind = 'payment'), 0)
           - coalesce(sum(l.amount) filter (where l.kind = 'refund'), 0)
           - coalesce(sum(l.amount) filter (where l.kind = 'charge'), 0)
           + coalesce(sum(l.amount) filter (where l.kind = 'adjust'), 0) as balance,
         r.note
    from registrations r
    left join payment_ledger l on l.registration_id = r.id
   where r.event_id = public.active_event_id()
   group by r.id, r.event_id, r.campus_id, r.name, r.payment_status, r.fee, r.note;

comment on view public.v_payment_balance is
  '신청자별 정산 잔액. balance > 0 이면 더 받은 것(환불 확인 대상), < 0 이면 미수.';

-- ── 되돌리기 ─────────────────────────────────────────────────
-- drop view if exists public.v_payment_balance;
-- drop trigger if exists trg_reg_00_fare on public.registrations;
-- drop function if exists public.apply_event_fare();
-- drop table if exists public.payment_ledger;
-- alter table public.registrations alter column fee
--   add generated always as (case when attendance_type='roundtrip' then 50000
--                                 when attendance_type='oneway' then 25000
--                                 else 0 end) stored;
