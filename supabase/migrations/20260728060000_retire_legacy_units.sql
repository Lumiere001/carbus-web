-- ============================================================
-- 옛 소속 이름을 "과거 전용"으로 내린다 (사용자 결정, 2026-07-28)
-- ============================================================
-- 사용자 결정 원문:
--   "기존 소속은 과거 데이터니까 그냥 서울지구는 다 서울지구라고 하고 순천여수는
--    순수지구야. **과거 데이터는 그냥 과거 데이터로만 남기고 앞으로 하는 것들을
--    잘 해보는 방향으로 가자!**"
--
-- 그래서 **아무 데이터도 옮기지 않는다.** 서울지구 10명은 서울지구인 채로 남는다.
-- 대신 새로 입력할 때 그 이름이 다시 선택되지 않게만 막는다 — 안 그러면 공식 명단과
-- 옛 이름이 드롭다운에 나란히 떠서 같은 혼란이 계속 쌓인다.
--
-- 삭제가 아니라 "내림"인 이유:
--   · 지금 65명의 `home_unit_id` 가 이 행들을 가리킨다. 지우면 그 사람들의 소속이
--     사라지고, 과거 명단을 다시 볼 때 빈칸이 된다.
--   · Phase 3 의 운행편에서 쓴 것과 **같은 방식**이다: 비활성 편은 목록에서 숨기되
--     이미 그 값을 쓰는 행에서는 계속 보인다.
-- ============================================================

alter table public.org_units
  add column if not exists retired_at timestamptz;

comment on column public.org_units.retired_at is
  '이 이름을 더 이상 새로 고르지 않는다는 표시. 값이 있으면 새 입력 드롭다운에서 숨긴다.
   **이미 이 소속으로 저장된 사람은 그대로 둔다** — 과거 데이터는 과거 그대로 남긴다.';

-- 공식 명단(2026-07-28 사용자 제공)에 없는 옛 이름들.
-- 괄호는 이 마이그레이션 시점의 실제 인원 수 — 왜 안 지웠는지의 근거로 남긴다.
update public.org_units
   set retired_at = now(),
       aliases = (
         select array(select distinct e from unnest(
           coalesce(aliases, '{}') ||
           case name
             -- 옛 이름 ↔ 공식 이름의 대응을 기록만 해둔다(자동 병합은 하지 않는다).
             when '순수지구'     then array['순천여수']
             when '김천구미지구' then array['김천구미']
             when 'BI 선교부'    then array['외국인사역부 B.I.']
             when '평안지구'     then array['평택안성']
             else '{}'::text[]
           end
         ) e)
       )
 where name in ('서울지구', '순수지구', '김천구미지구', 'BI 선교부', '평안지구')
   and retired_at is null;

-- ── 확인 ────────────────────────────────────────────────────
do $$
declare
  v_retired int;
  v_kept    int;
  v_active  int;
begin
  select count(*) into v_retired from org_units where retired_at is not null;
  select count(*) into v_active  from org_units where retired_at is null;
  select count(*) into v_kept
    from registrations r join org_units o on o.id = r.home_unit_id
   where o.retired_at is not null;

  raise notice '내린 소속 %개 / 새로 고를 수 있는 소속 %개', v_retired, v_active;
  raise notice '옛 소속을 그대로 유지한 인원 %명 (건드리지 않음)', v_kept;

  if v_active < 50 then
    raise exception '새로 고를 수 있는 소속이 %개뿐입니다 — 공식 명단이 안 들어간 것 같습니다', v_active;
  end if;
end $$;
