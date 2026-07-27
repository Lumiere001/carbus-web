-- ============================================================
-- 3-D — 납부 후 편성이 바뀌면 환불 대상으로 뜨게 (사용자 결정: 목록 표시만)
-- ============================================================
-- 문제 (Phase 3 때 실측으로 확인됨):
--   왕복 5만원을 낸 학우의 편을 다 비워도 `fee` 는 0이 되는데 **정산 화면의
--   "차액 확인 필요" 목록에는 안 뜬다.** 5만원을 돌려줘야 하는데 아무도 모른다.
--
-- 왜 안 떴나: 그 목록은 장부(payment_ledger) 기준이다.
--   balance = 납부 − 환불 − 청구 + 조정
--   Phase 2-A 가 **납부 시점의 청구액을 장부에 얼려** 두므로(받은 돈의 근거 보존),
--   나중에 fee 가 0이 되어도 장부의 charge 5만원은 그대로다 → balance 0 → 안 보인다.
--
-- 사용자 결정: **"청구액은 건드리지 않고, 차액 확인 필요 목록에 자동으로 뜨게만 한다.
--   실제로 돌려줬는지는 사람이 화면에서 확인."**
--   현장에서 이미 현금으로 정산한 경우를 시스템이 "환불함"으로 잘못 기록하는 사고를
--   막기 위해서다.
--
-- 그래서 **아무 데이터도 쓰지 않는다.** 뷰에 계산 열을 더할 뿐이다.
--
-- ⚠️ 처음 쓴 공식이 아무것도 못 잡았고, 자체검증이 그걸 잡았다.
--    `registrations.fee` 는 **생성 컬럼이 아니다.** 납부 시점 값이 그대로 얼어 있어서,
--    편을 다 비워도 50,000 그대로다(그게 Phase 2-A 의 동결 설계다).
--    그래서 `낸 돈 − fee` 로는 영원히 0이 나온다 — 고치려던 그 버그를 그대로 재현한다.
--    **지금 참여 형태(attendance_type)로 다시 계산한 요금**과 비교해야 한다.
--      fee_now:  왕복 → events.fee_roundtrip / 편도 → fee_oneway / 미이용 → 0
--      refund_due = 낸 돈 − 돌려준 돈 − fee_now
--   · 기존 46명(장부상 과납)도 여기 잡힌다.
--   · 편을 비워 참여 형태가 바뀐 사람도 잡힌다. ← 이번에 새로 보이는 것
-- ============================================================

-- ⚠️ drop 이 아니라 replace 다 — v_cancelled 가 이 뷰에 의존한다. drop cascade 로
--    지우면 그 뷰까지 날아가고, 되살릴 때 정의가 미묘하게 달라질 위험이 있다.
--    replace 는 **기존 컬럼의 이름·타입·순서가 그대로**여야 하므로 새 열은 맨 뒤에 붙인다.
create or replace view public.v_payment_balance with (security_invoker = on) as
select
  r.id        as registration_id,
  r.event_id,
  r.campus_id,
  r.name,
  r.payment_status,
  r.fee       as charged_now,
  coalesce(sum(l.amount) filter (where l.kind = 'payment'), 0) as paid_total,
  coalesce(sum(l.amount) filter (where l.kind = 'refund'),  0) as refunded_total,
  coalesce(sum(l.amount) filter (where l.kind = 'waive'),   0) as waived_total,
  coalesce(sum(l.amount) filter (where l.kind = 'charge'),  0) as charged_total,
  coalesce(sum(l.amount) filter (where l.kind = 'payment'), 0)
    - coalesce(sum(l.amount) filter (where l.kind = 'refund'), 0)
    - coalesce(sum(l.amount) filter (where l.kind = 'charge'), 0)
    + coalesce(sum(l.amount) filter (where l.kind = 'adjust'), 0) as balance,
  r.note,
  -- ↓ 새 열은 여기부터 (create or replace 제약 때문에 반드시 맨 뒤)

  -- **지금 참여 형태로 다시 계산한 요금.** r.fee 는 납부 시점에 얼어 있어서
  -- 편성이 바뀌어도 안 움직인다 — 그 차이가 곧 "돌려줄 돈"이다.
  case r.attendance_type
    when 'roundtrip' then e.fee_roundtrip
    when 'oneway'    then e.fee_oneway
    else 0
  end as fee_now,

  case when r.payment_status = 'waived' then 0
       else greatest(
         coalesce(sum(l.amount) filter (where l.kind = 'payment'), 0)
           - coalesce(sum(l.amount) filter (where l.kind = 'refund'), 0)
           - case r.attendance_type
               when 'roundtrip' then e.fee_roundtrip
               when 'oneway'    then e.fee_oneway
               else 0
             end,
         0)
  end as refund_due,

  -- 왜 대상이 됐는지. "원래 과납"과 "편성을 바꿔서 줄어든 것"은 사람이 할 일이 다르다.
  case
    when r.payment_status = 'waived' then null
    when case r.attendance_type
           when 'roundtrip' then e.fee_roundtrip
           when 'oneway'    then e.fee_oneway
           else 0
         end < r.fee
      then 'fee_dropped'
    when coalesce(sum(l.amount) filter (where l.kind = 'payment'), 0)
         - coalesce(sum(l.amount) filter (where l.kind = 'refund'), 0)
         - r.fee > 0
      then 'overpaid'
    else null
  end as refund_reason
from public.registrations r
join public.events e on e.id = r.event_id
left join public.payment_ledger l on l.registration_id = r.id
where r.event_id = public.viewing_event_id()
group by r.id, r.event_id, r.campus_id, r.name, r.payment_status, r.fee, r.note,
         r.attendance_type, e.fee_roundtrip, e.fee_oneway;

comment on view public.v_payment_balance is
  '사람별 장부 잔액 + **지금 기준 환불 대상**(refund_due). 청구액은 건드리지 않는다 —
   납부 시점 청구액을 얼려 두는 Phase 2-A 설계 때문에 편성을 바꿔도 장부는 안 움직이고,
   그래서 "돌려줄 돈이 있는데 아무도 모르는" 상태가 생겼다. 여기서 계산으로만 드러낸다.
   실제 환불 여부는 사람이 판단한다(현장 현금 정산이 섞여 있다).';

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_reg    uuid;
  v_before bigint;
  v_after  bigint;
  v_reason text;
begin
  -- ⚠️ **지금은 환불 대상이 아닌** 사람을 골라야 한다. 처음 이 검증을 쓸 때
  --    아무나 골랐더니 이미 과납 46명 중 하나가 걸려서, 편을 비우기 전부터
  --    refund_due 가 25,000 이었다 — 새로 잡히는 것을 증명하지 못했다.
  select r.id into v_reg
    from registrations r
    join v_payment_balance b on b.registration_id = r.id
   where r.event_id = active_event_id()
     and r.payment_status = 'paid'
     and r.fee > 0
     and b.refund_due = 0
     and exists (select 1 from payment_ledger l
                  where l.registration_id = r.id and l.kind = 'payment')
   limit 1;

  if v_reg is null then
    raise notice '  (조건에 맞는 신청이 없어 검증 건너뜀)';
    return;
  end if;

  select refund_due into v_before from v_payment_balance where registration_id = v_reg;

  -- "안 갈래요" — 편을 다 비운다. fee 가 0이 된다.
  update registrations set up_trip_id = null, down_trip_id = null where id = v_reg;

  select refund_due, refund_reason into v_after, v_reason
    from v_payment_balance where registration_id = v_reg;

  if coalesce(v_after, 0) <= 0 then
    raise exception
      '검증 실패: 낸 사람의 편을 다 비웠는데 환불 대상으로 안 잡힙니다 (전 % → 후 %)',
      v_before, v_after;
  end if;
  if v_reason is null then
    raise exception '검증 실패: 환불 사유가 비어 있습니다';
  end if;
  raise notice
    '검증: 납부 후 편성을 비우니 환불 대상으로 잡힘 (전 % → 후 %, 사유 %)',
    v_before, v_after, v_reason;

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
