-- ============================================================
-- Phase 2-A (2/2) — 현재 상태를 장부 초기 잔액으로 이관
-- ============================================================
-- 원칙:
--   1. registrations 를 UPDATE 하지 않는다. 감사로그에 "아무도 안 바꾼" 599건이
--      쌓이는 것을 막기 위해서다(Phase 1 에서 겪음). 장부에 INSERT 만 한다.
--   2. 비고 텍스트로 판정하지 않는다. "환불해야 할 것은 없음" 같은 부정문이
--      '환불' 부분문자열에 걸리고, 반대로 아무 말 없이 차액이 생긴 28명은 놓친다.
--      금액은 금액으로만 계산한다.
--   3. source='migration' 을 붙여 한 줄로 되돌릴 수 있게 한다.
--
-- 이관 규칙:
--   · charge  = 현재 청구액(registrations.fee)
--   · payment = **납부 완료로 표시된 그 시점의 청구액**
--       fee 는 참여형태에서 자동 계산되던 값이라 지금 값은 이미 바뀌어 있을 수 있다.
--       감사로그의 before_value 에는 실제 값이 남아 있어(after_value 는 생성컬럼이라
--       항상 NULL) 'unpaid → paid' 로 바뀐 순간의 청구액을 복원할 수 있다.
--       복원이 안 되면(감사 이력 없음) 현재 청구액을 쓴다.
--   · waive   = 면제(waived)인 경우 현재 청구액
--
-- 결과적으로 payment - charge > 0 인 사람이 "낸 돈이 청구액보다 많은" 사람이다.
-- 실측 46명 / 1,350,000원. 이 중 28명은 비고에 아무 언급이 없었다.
-- ⚠️ 이건 확정 채무가 아니라 **계산상 차액**이다. 현장에서 현금으로 이미
--    정산했을 수 있으므로 화면에서는 "확인 필요"로 다룬다.
--
-- 되돌리기: delete from payment_ledger where source='migration';
-- ============================================================

do $$
declare
  v_charge int;
  v_pay    int;
  v_waive  int;
  v_diff   int;
begin
  -- 이미 이관했으면 다시 하지 않는다(재실행 안전).
  if exists (select 1 from payment_ledger where source = 'migration') then
    raise notice '이관분이 이미 있습니다 — 건너뜁니다';
    return;
  end if;

  -- 납부 시점의 청구액 복원
  create temp table _paid_at on commit drop as
    select distinct on (registration_id)
           registration_id,
           (before_value->>'fee')::int as fee_when_paid
      from registration_audit
     where change_type = 'update'
       and before_value->>'payment_status' is distinct from 'paid'
       and after_value->>'payment_status' = 'paid'
       and before_value->>'fee' is not null
     order by registration_id, created_at desc;

  -- ① 청구 — 현재 청구액이 0보다 큰 전원
  insert into payment_ledger (event_id, registration_id, kind, amount, occurred_at, reason, source)
  select r.event_id, r.id, 'charge', r.fee, r.created_at,
         '이관: 현재 청구액', 'migration'
    from registrations r
   where r.fee > 0;
  get diagnostics v_charge = row_count;

  -- ② 수납 — 납부 완료자. 금액은 '그때 청구액'(복원 실패 시 현재 청구액)
  insert into payment_ledger (event_id, registration_id, kind, amount, occurred_at, reason, source)
  select r.event_id, r.id, 'payment',
         coalesce(p.fee_when_paid, r.fee),
         r.updated_at,
         case when p.fee_when_paid is null then '이관: 납부(시점 청구액 복원 불가 — 현재값 사용)'
              when p.fee_when_paid <> r.fee then '이관: 납부(당시 청구액 ' || p.fee_when_paid || '원)'
              else '이관: 납부' end,
         'migration'
    from registrations r
    left join _paid_at p on p.registration_id = r.id
   where r.payment_status = 'paid'
     and coalesce(p.fee_when_paid, r.fee) > 0;
  get diagnostics v_pay = row_count;

  -- ③ 면제
  insert into payment_ledger (event_id, registration_id, kind, amount, occurred_at, reason, source)
  select r.event_id, r.id, 'waive', r.fee, r.updated_at, '이관: 면제', 'migration'
    from registrations r
   where r.payment_status = 'waived' and r.fee > 0;
  get diagnostics v_waive = row_count;

  select count(*) into v_diff from v_payment_balance where balance > 0;

  raise notice '장부 이관: 청구 %건 / 수납 %건 / 면제 %건 → 차액 발생 %명',
    v_charge, v_pay, v_waive, v_diff;
end $$;

-- ── 검증 ─────────────────────────────────────────────────────
-- 장부 합계가 기존 화면 숫자(v_payment_summary)와 어긋나면 중단한다.
do $$
declare
  v_view_paid  bigint;
  v_ledger_pay bigint;
begin
  select coalesce(sum(paid_total), 0) into v_view_paid from v_payment_summary;

  -- 뷰는 self 를 제외하고 '현재 청구액' 기준으로 합산한다.
  -- 장부의 수납은 '납부 시점 청구액'이라 더 클 수 있다(그 차이가 곧 환불 대상).
  select coalesce(sum(amount), 0) into v_ledger_pay
    from payment_ledger l
    join registrations r on r.id = l.registration_id
   where l.kind = 'payment' and r.attendance_type in ('roundtrip','oneway');

  if v_ledger_pay < v_view_paid then
    raise exception '장부 수납합(%)이 기존 집계(%)보다 작습니다 — 이관 누락',
      v_ledger_pay, v_view_paid;
  end if;

  raise notice '검증: 기존 집계 %원 / 장부 수납 %원 (차 %원 = 참여형태 변경분)',
    v_view_paid, v_ledger_pay, v_ledger_pay - v_view_paid;
end $$;
