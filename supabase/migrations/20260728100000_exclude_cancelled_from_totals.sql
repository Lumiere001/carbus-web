-- ============================================================
-- 취소한 사람은 집계에서 빠진다
-- ============================================================
-- 점검에서 나온 것: 신청을 취소해도 **그 사람 차량비가 "받아야 할 돈"에 계속 잡혔다.**
-- 대시보드 신청 인원은 599 로 줄었는데 징수 대상 합계는 그대로였다. 즉 화면마다
-- 취소자를 세느냐 마느냐가 달랐다.
--
--   대시보드 총 신청 인원 · Phase · 배차 대상 → 이미 제외 ✅
--   정산 집계(v_payment_summary) · 이동수단 요약(v_transport_summary) → 포함 ❌
--
-- 실제 운영에서 중도 취소가 나오면 그대로 겪는다. 점검 때는 납부를 `면제`로 바꿔
-- 우회했는데, 그건 "돈을 안 받기로 했다"는 뜻이라 사실과 다른 기록이 남는다.
--
-- ⚠️ `v_payment_balance` 는 **일부러 그대로 둔다.** 취소자야말로 낸 돈을 돌려줘야
--    하는 사람이라, 환불·차액 목록에서는 보여야 한다. 집계(받아야 할 돈)에서 빼는
--    것과 환불 대상에서 빼는 것은 정반대의 일이다.
-- ============================================================

-- ── 정산 집계: 취소자의 차량비를 "걷어야 할 돈"에서 뺀다 ────
-- 3중 비교 뷰가 이 뷰를 읽으므로 같이 내렸다가 아래에서 **원래 정의 그대로** 되살린다.
-- (정의를 바꾸는 게 아니라, 밑에 깔린 숫자가 바뀌면 자동으로 따라온다)
drop view if exists public.v_payment_3way_comparison;
drop view if exists public.v_payment_summary;
create view public.v_payment_summary with (security_invoker = on) as
select
  c.id   as campus_id,
  c.name as campus_name,
  count(*) filter (where r.payment_status = 'unpaid')  as unpaid_count,
  count(*) filter (where r.payment_status = 'paid')    as paid_count,
  count(*) filter (where r.payment_status = 'waived')  as waived_count,
  coalesce(sum(r.fee) filter (where r.payment_status = 'paid'),   0::bigint) as paid_total,
  coalesce(sum(r.fee) filter (where r.payment_status = 'unpaid'), 0::bigint) as unpaid_total
from public.campuses c
left join public.registrations r
       on r.campus_id = c.id
      and r.attendance_type in ('roundtrip', 'oneway')
      and r.event_id = public.viewing_event_id()
      -- ↓ 이 한 줄이 이번 수정이다.
      and r.participation_status <> 'cancelled'
group by c.id, c.name
order by c.display_order;

comment on view public.v_payment_summary is
  '캠퍼스별 납부 집계. 취소자는 빠진다 — 안 오는 사람에게 받을 돈은 없다.
   (환불은 v_payment_balance 가 따로 본다)';

-- 3중 비교 뷰 되살리기 (정의 그대로 — 위 뷰 하나만 바뀌었다).
create view public.v_payment_3way_comparison with (security_invoker = on) as
select
  c.id   as campus_id,
  c.name as campus_name,
  coalesce(p.paid_total, 0::bigint) as system_paid_total,
  s.campus_remitted_total,
  s.master_received_total,
  coalesce(p.paid_total, 0::bigint) - s.campus_remitted_total as diff_system_vs_campus,
  s.campus_remitted_total - s.master_received_total           as diff_campus_vs_master,
  coalesce(p.paid_total, 0::bigint) - s.master_received_total as diff_system_vs_master
from public.campuses c
join public.campus_payment_settlements s
     on s.campus_id = c.id and s.event_id = public.viewing_event_id()
left join public.v_payment_summary p on p.campus_id = c.id
order by c.display_order;

-- ── 이동수단 요약: 취소자는 배차·정원 판단 대상이 아니다 ────
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
  (up.status = 'pending' or dn.status = 'pending') as has_pending,
  (coalesce(up.mode, 'our_bus') <> 'our_bus'
   or coalesce(dn.mode, 'our_bus') <> 'our_bus') as uses_other_transport
from public.registrations r
left join public.transport_legs up
       on up.registration_id = r.id and up.direction = 'up'
left join public.transport_legs dn
       on dn.registration_id = r.id and dn.direction = 'down'
left join public.org_units uu on uu.id = up.via_unit_id
left join public.org_units du on du.id = dn.via_unit_id
where r.participation_status <> 'cancelled';

comment on view public.v_transport_summary is
  '사람 단위 이동수단 요약. 취소자는 빠진다 — 좌석·정원 판단에 쓰는 값이라,
   안 오는 사람이 "확정 대기"로 잡혀 있으면 자리를 잡아둔 것처럼 보인다.';

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_event  uuid := public.active_event_id();
  v_reg    uuid;
  v_campus uuid;
  v_before bigint;
  v_after  bigint;
  v_fee    int;
begin
  -- 완납이면서 차량비가 있는 사람을 하나 골라 취소해 본다 (끝에 롤백).
  select r.id, r.campus_id, r.fee into v_reg, v_campus, v_fee
    from registrations r
   where r.event_id = v_event and r.payment_status = 'paid' and coalesce(r.fee,0) > 0
     and r.participation_status <> 'cancelled'
   limit 1;
  if v_reg is null then
    raise notice '  (조건에 맞는 신청이 없어 검증 건너뜀)';
    return;
  end if;

  select paid_total into v_before from v_payment_summary where campus_id = v_campus;

  update registrations
     set participation_status = 'cancelled', cancelled_at = now(),
         assigned_up_bus_id = null, assigned_down_bus_id = null
   where id = v_reg;

  select paid_total into v_after from v_payment_summary where campus_id = v_campus;
  if v_after <> v_before - v_fee then
    raise exception '검증 실패: 취소했는데 걷힌 돈이 % → % (%원 줄어야)', v_before, v_after, v_fee;
  end if;
  raise notice '검증 ①: 취소 → 정산 집계에서 % 원 빠짐 OK', v_fee;

  -- 환불 쪽에는 남아 있어야 한다 (돌려줄 돈이 생긴 사람이다)
  if not exists (select 1 from v_payment_balance where registration_id = v_reg) then
    raise exception '검증 실패: 취소자가 환불·차액 목록에서도 사라졌습니다';
  end if;
  raise notice '검증 ②: 취소자가 환불·차액 목록에는 그대로 남음 OK';

  -- 이동수단 요약에서도 빠진다
  if exists (select 1 from v_transport_summary where registration_id = v_reg) then
    raise exception '검증 실패: 취소자가 이동수단 요약에 남아 있습니다';
  end if;
  raise notice '검증 ③: 취소자가 이동수단 요약에서 빠짐 OK';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 변경은 롤백됨)';
  else
    raise;
  end if;
end $$;

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
  raise notice 'security_invoker 전수 검사 통과';
end $$;
