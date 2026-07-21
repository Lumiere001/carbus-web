-- ============================================================
-- Phase 3 (1/n) — 배차 특례를 차량 이름에서 플래그 컬럼으로 승격
-- ============================================================
-- 왜?
--   lib/batch/engine.ts 가 배차 특례를 **차량 이름 문자열 "1호차"** 로 판정한다.
--     const COHESION_EXEMPT_BUS_NAMES = new Set(["1호차"]);  // 응집 면제
--     const FILL_LAST_BUS_NAMES       = new Set(["1호차"]);  // 채우기 후순위
--   지금은 맞는다. 하지만 이건 데이터가 아니라 **코드에 박힌 이름**이라,
--   다음 행사에서 짐차를 다른 이름으로 두는 순간(예: '짐차', '1번차')
--   에러 하나 없이 조용히 특례가 사라진다. 배차는 성공하고 결과만 틀린다.
--
--   ⚠️ 다만 정확히 해두자 — create_event 는 차량 이름을 그대로 복제하므로
--      '새 행사 시작' 만으로는 안 깨진다. 깨지는 건 이름을 바꾸거나 차량을
--      새로 만들 때다. 그리고 지금 레포에는 차량 생성·삭제 경로가 0곳이라
--      **곧 붙일 /admin/buses 편성 편집 화면이 정확히 그 순간**이다.
--      그래서 화면보다 이 마이그레이션이 먼저 와야 한다.
--
-- 두 특례는 서로 독립이다(하나로 합치면 안 된다):
--   is_cohesion_exempt — 차량순장 캠퍼스 우선 배치(3-1)에서 제외.
--                        1호차는 임원·총단이 섞이는 차라 순장 캠퍼스를 끌지 않는다.
--   fill_priority      — 채움 순서. 큰 값일수록 나중에 채운다.
--                        1호차는 지구 짐을 실어 인원을 최소화(후순위).
--
-- 배차 결과는 **비트 단위로 동일해야 한다**. 이 마이그레이션은 현재 엔진이
-- 이름으로 판정하던 집합을 그대로 플래그로 옮길 뿐이다. 아래 자체검증이
-- '플래그 집합 ≠ 이름 집합' 이면 예외를 던져 마이그레이션 전체를 롤백한다.
-- 코드 쪽 회귀는 tests/unit/batch-golden.test.ts 가 잡는다(운영 599명 형상 고정).
--
-- 되돌리기:
--   alter table public.buses
--     drop column is_cohesion_exempt, drop column fill_priority, drop column display_order;
--   (registrations·뷰·CHECK 어디도 이 컬럼을 참조하지 않으므로 CASCADE 위험 없음)
-- ============================================================

-- ── 컬럼 추가 (전부 상수 DEFAULT — 행마다 다른 backfill 이 아니다) ──────
-- 상수 DEFAULT 라 감사 트리거 이슈가 없다. buses 에는 사용자 트리거가 하나도 없고
-- 이 마이그레이션도 만들지 않는다(트리거를 붙이면 buses 최초의 사용자 트리거가 된다).
alter table public.buses
  add column if not exists is_cohesion_exempt boolean not null default false,
  add column if not exists fill_priority      int     not null default 0,
  add column if not exists display_order      int     not null default 0;

comment on column public.buses.is_cohesion_exempt is
  '차량순장 캠퍼스 우선 배치(응집)에서 제외. 여러 캠퍼스가 섞이는 차(예: 임원·총단 차)에 켠다. 엔진의 COHESION_EXEMPT_BUS_NAMES 를 대체.';
comment on column public.buses.fill_priority is
  '채움 순서. 클수록 나중에 채운다. 짐을 싣는 차는 1 이상으로 두어 빈자리를 남긴다. 엔진의 FILL_LAST_BUS_NAMES 를 대체.';
comment on column public.buses.display_order is
  '화면 정렬 순서. 0 이면 id 순으로 보인다.';

-- ── backfill — 현행 엔진이 이름으로 판정하던 것을 그대로 옮긴다 ──────────
-- 전 행사에 걸쳐 적용한다. event_id 로 좁히지 않는 이유: 지난 행사 차량도
-- 같은 규칙으로 배차됐고, 나중에 그 행사를 다시 활성화해 재배차할 수 있다.
update public.buses
   set is_cohesion_exempt = true,
       fill_priority      = 1
 where name = '1호차'
   and (is_cohesion_exempt is distinct from true or fill_priority is distinct from 1);

-- display_order 는 지금까지 id 순으로 보여줬으므로 그대로 굳힌다.
update public.buses set display_order = id where display_order = 0;

-- ── 자체검증 ①: 플래그 집합 == 이름 집합 ────────────────────────────────
-- 이게 어긋나면 배차 결과가 바뀐다. 마이그레이션을 통째로 롤백시킨다.
do $$
declare
  v_mismatch int;
  v_flagged  int;
begin
  select count(*) into v_mismatch
    from public.buses
   where (name = '1호차') is distinct from (is_cohesion_exempt and fill_priority > 0);

  if v_mismatch > 0 then
    raise exception
      '플래그 집합이 이름 집합과 다릅니다 (%건). 배차 결과가 바뀝니다 — 중단합니다.',
      v_mismatch;
  end if;

  select count(*) into v_flagged from public.buses where is_cohesion_exempt;
  raise notice '배차 특례 플래그 이관: %대 (이름 "1호차" 기준)', v_flagged;

  -- 0대면 이 행사에 짐차가 없다는 뜻이다. 오류는 아니지만 눈으로 확인해야 한다.
  if v_flagged = 0 then
    raise warning '특례 차량이 0대입니다. 차량 이름이 "1호차" 가 아니면 짐차 특례가 적용되지 않습니다.';
  end if;
end $$;

-- ── 자체검증 ②: 두 플래그가 항상 같이 켜져 있다 ─────────────────────────
-- 지금은 1:1 이지만 앞으로 화면에서 따로 켤 수 있게 된다. 이관 시점에는
-- 반드시 일치해야 하므로 여기서만 확인한다(제약으로 걸지는 않는다 —
-- 응집 면제만 켜고 후순위는 끄는 조합이 나중에 정당할 수 있다).
do $$
declare v_split int;
begin
  select count(*) into v_split
    from public.buses
   where is_cohesion_exempt <> (fill_priority > 0);
  if v_split > 0 then
    raise exception '이관 직후인데 두 플래그가 갈렸습니다 (%건)', v_split;
  end if;
end $$;
