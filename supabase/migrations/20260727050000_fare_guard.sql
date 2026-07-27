-- ============================================================
-- Phase 4-7 — 지난 행사의 차량비를 못 바꾸게 (HANDOFF §8-E)
-- ============================================================
-- 왜 지금인가: 4-6 으로 지난 행사를 **볼 수 있게** 됐다. 그런데
-- update_event_fares 는 SECURITY DEFINER 라 RLS 를 우회하고, 어느 행사든
-- p_event_id 만 주면 요금을 바꾼다.
--
-- 무엇이 위험한가: registrations.fee 는 행사 요금표에서 계산되는 GENERATED 컬럼이다.
-- 지난 행사의 요금을 바꾸면 **이미 정산이 끝난 599명의 청구액이 통째로 재계산된다.**
-- 장부(payment_ledger)에 남은 "받은 돈"은 그대로인데 청구액만 움직이니, 차액이
-- 조용히 만들어진다. 돈 문제는 롤백해도 이미 집행한 송금이 안 돌아온다.
--
-- events 테이블에는 행사 쓰기 가드 트리거가 없다(그 테이블 자체가 행사 목록이라
-- event_id 컬럼이 없다). 그래서 이 함수 본문에서 직접 막는다.
-- ============================================================

create or replace function public.update_event_fares(
  p_event_id      uuid,
  p_fee_roundtrip integer,
  p_fee_oneway    integer
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() <> 'master' then
    raise exception '차량비 변경은 master 만 할 수 있습니다';
  end if;
  if p_fee_roundtrip < 0 or p_fee_oneway < 0 then
    raise exception '차량비는 0원 이상이어야 합니다';
  end if;

  -- 지난 행사는 잠금을 열지 않는 한 못 바꾼다. 청구액이 재계산되기 때문이다.
  if not (select public.is_event_writable(p_event_id)) then
    raise exception
      '지난 행사의 차량비는 바꿀 수 없습니다. 이미 정산된 청구액이 다시 계산됩니다. 꼭 필요하면 사유를 적고 잠금을 여세요.'
      using errcode = 'restrict_violation';
  end if;

  update events
     set fee_roundtrip = p_fee_roundtrip,
         fee_oneway    = p_fee_oneway
   where id = p_event_id;

  if not found then
    raise exception '없는 행사입니다';
  end if;
end $$;

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_past uuid;
  v_ok   boolean;
begin
  insert into events (name, starts_on, ends_on)
  values ('__검증_요금가드', current_date - 30, current_date - 28)
  returning id into v_past;

  -- master 세션을 흉내내 지난 행사 요금 변경을 시도한다.
  v_ok := false;
  begin
    perform public.update_event_fares(v_past, 10000, 5000);
  exception
    when restrict_violation then v_ok := true;
    when others then
      -- master 판정에서 먼저 걸리면 이 검증은 의미가 없다 — 그대로 알린다.
      raise notice '  (검증 건너뜀: %)', sqlerrm;
      v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 지난 행사의 차량비가 바뀌었습니다';
  end if;
  raise notice '검증: 지난 행사 차량비 변경 차단 OK';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;
