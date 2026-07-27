-- ============================================================
-- 4단계 — 캠퍼스 송금 등록 유도: 총단 1클릭 대리등록
-- ============================================================
-- 사용자 피드백:
--   "각 캠퍼스 임역원이 차량비를 걷고 총단에게 송금을 등록해야 하는데 그거를 안 하더라고.
--    그래서 이걸 확실하게 개선해야 할 것 같아. 없애자기에는 나중에 돈의 흐름을 추적할 때
--    불편할 것 같아서 남겨야 할 것 같은데..."
--
-- 실측: 운영 백업의 `campus_remittances` 가 **0행**이다. 기능은 Phase 2-A 에서
-- 만들어졌는데 **아무도 안 쓴다.** 즉 "기능을 만들었는데 원래 문제는 하나도 안 풀린" 상태다.
--
-- 원인 진단: 임역원 입장에서 송금 등록은 "내 일이 끝난 뒤 추가로 하는 일"이라 미뤄진다.
-- 그래서 두 방향으로 민다(사용자 결정: 배너 + 총단 1클릭 대리등록):
--   ① 임역원 화면에 "걷었는데 아직 안 보낸 돈"을 상시로 띄운다(앱 쪽).
--   ② 그래도 안 하면 **총단이 통장 내역을 보고 대신 등록**한다 — 이 파일.
--
-- 왜 대리등록이 필요한가: 돈은 실제로 들어왔는데 기록만 없는 상태가 계속되면
-- 3중 비교(시스템 완납 / 캠퍼스 송금 / 총단 입금)가 영원히 안 맞는다. 기록의 목적이
-- "돈의 흐름 추적"이므로, 등록 주체가 누구든 **흐름이 남는 게 우선**이다.
-- 대신 누가 등록했는지 note 에 남겨 나중에 구분할 수 있게 한다.
-- ============================================================

create or replace function public.master_remit_add(
  p_campus_id uuid,
  p_amount    int,
  p_note      text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_event uuid := (select public.writable_event_id());
begin
  if public.current_role() <> 'master' then
    raise exception '총단(master)만 대리 등록할 수 있습니다';
  end if;
  if v_event is null then
    raise exception '지금 쓸 수 있는 행사가 없습니다';
  end if;
  if p_amount <= 0 then
    raise exception '송금액은 0보다 커야 합니다';
  end if;
  if not exists (select 1 from campuses where id = p_campus_id) then
    raise exception '없는 캠퍼스입니다';
  end if;

  -- 누가 등록했는지 남긴다. 임역원 본인이 등록한 것과 섞이면 "왜 안 하지"를
  -- 다시 판단할 수 없다(개선 효과를 못 잰다).
  insert into campus_remittances (event_id, campus_id, amount, note, created_by)
  values (
    v_event,
    p_campus_id,
    p_amount,
    coalesce(nullif(btrim(p_note), ''), '총단 대리 등록'),
    auth.uid()
  );
end $$;

grant execute on function public.master_remit_add(uuid, int, text) to authenticated;

comment on function public.master_remit_add is
  '총단이 캠퍼스를 대신해 송금을 등록한다. campus_remit_add 의 master 판. 실측
   campus_remittances 0행 — 임역원이 안 해서 돈 흐름 추적이 통째로 비어 있었다.';

-- ⚠️ 이 파일에는 자체검증을 두지 않는다. 여기 넣었던 "권한 검사가 도는가" 검증이
-- **실패했고, 그게 함수가 아니라 코드베이스 전반의 결함을 드러냈다**
-- (`current_role() <> 'master'` 가 NULL 에서 통과). 검증과 수정을 함께 다음 파일에 뒀다:
--   20260728040000_role_guard_hardening.sql
