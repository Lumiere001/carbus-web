-- ============================================================
-- 전체 지구 명단 반영 (사용자 제공, 2026-07-28)
-- ============================================================
-- 왜 필요한가: 3단계(비고 구조화)에서 "타지구 **차량**을 얻어 탄다"를 구조로 받는데,
-- 어느 지구인지 고르려면 목록이 있어야 한다. 기존 org_units 에는 여름수련회에
-- 실제로 나타난 24개만 들어 있었다(비고에서 역으로 추출한 것).
--
-- ⚠️ **기존 행은 하나도 건드리지 않는다.** 지금 65명의 `home_unit_id` 가 기존 행을
--    가리키고 있고, 이름을 바꾸거나 합치는 것은 그 사람들의 소속을 바꾸는 일이다.
--    아래 "합칠지 결정 필요" 5건은 손대지 않고 남겨둔다(HANDOFF §10).
--
-- 지구 번호(1408, 2101…)는 받았지만 쓰지 않는다 — 사용자 지시. 이름만 쓴다.
-- ============================================================

-- 사역부·기관은 kind='mission', 나머지는 'district'.
-- (kind 는 내부 분류일 뿐 화면에는 이름만 나온다)
insert into public.org_units (name, kind, display_order)
select v.name, v.kind, v.ord
  from (values
    ('외국인사역부 B.I.', 'mission',  1000),
    ('의료선교부',        'mission',  1010),
    ('TIA',               'mission',  1020),
    ('서울동1',           'district', 2101),
    ('서울동2',           'district', 2102),
    ('서울서',            'district', 2103),
    ('서울서2',           'district', 2104),
    ('서울남',            'district', 2105),
    ('서울북',            'district', 2106),
    ('서울북동',          'district', 2107),
    ('서울북동2',         'district', 2108),
    ('서울중앙',          'district', 2109),
    ('서울북중앙',        'district', 2110),
    ('인천지구',          'district', 2201),
    ('수원지구',          'district', 2202),
    ('안양지구',          'district', 2203),
    ('용인지구',          'district', 2204),
    ('성남지구',          'district', 2205),
    ('안산지구',          'district', 2206),
    ('평택안성',          'district', 2207),
    ('부천지구',          'district', 2208),
    ('의정부지구',        'district', 2209),
    ('강릉속초',          'district', 2301),
    ('춘천지구',          'district', 2302),
    ('원주지구',          'district', 2303),
    ('삼척지구',          'district', 2304),
    ('대전지구',          'district', 2401),
    ('공주지구',          'district', 2402),
    ('천안지구',          'district', 2403),
    ('세종지구',          'district', 2404),
    ('홍성지구',          'district', 2405),
    ('청주지구',          'district', 2501),
    ('충주지구',          'district', 2502),
    ('제천지구',          'district', 2503),
    ('광주지구',          'district', 2601),
    ('목포지구',          'district', 2603),
    ('제주지구',          'district', 2605),
    ('순천여수',          'district', 2606),
    ('전주지구',          'district', 2701),
    ('군산지구',          'district', 2702),
    ('익산지구',          'district', 2703),
    ('부산지구',          'district', 2801),
    ('창원지구',          'district', 2802),
    ('울산지구',          'district', 2803),
    ('진주지구',          'district', 2804),
    ('대구지구',          'district', 2901),
    ('안동지구',          'district', 2902),
    ('경주지구',          'district', 2903),
    ('포항지구',          'district', 2904),
    ('김천구미',          'district', 2905),
    ('영주지구',          'district', 2906),
    ('경기P2C',           'district', 4701),
    ('해외',              'district', 9999)
  ) as v(name, kind, ord)
 where not exists (select 1 from public.org_units o where o.name = v.name);

-- ── 확인 ────────────────────────────────────────────────────
do $$
declare
  v_total  int;
  v_legacy text;
begin
  select count(*) into v_total from org_units;
  raise notice '전체 소속 %개', v_total;

  -- 공식 명단에 없는 기존 행 = 합칠지 결정이 필요한 것들.
  -- **자동으로 합치지 않는다** — 65명의 소속이 걸려 있고, 특히 "서울지구"는
  -- 공식 명단에서 10개로 갈라져 있어 어느 쪽인지 사람만 안다.
  select string_agg(o.name || '(' || cnt.n || '명)', ', ' order by o.name)
    into v_legacy
    from org_units o
    join lateral (select count(*) n from registrations r where r.home_unit_id = o.id) cnt on true
   where o.name not in (
     '외국인사역부 B.I.','의료선교부','TIA','서울동1','서울동2','서울서','서울서2','서울남',
     '서울북','서울북동','서울북동2','서울중앙','서울북중앙','인천지구','수원지구','안양지구',
     '용인지구','성남지구','안산지구','평택안성','부천지구','의정부지구','강릉속초','춘천지구',
     '원주지구','삼척지구','대전지구','공주지구','천안지구','세종지구','홍성지구','청주지구',
     '충주지구','제천지구','광주지구','목포지구','제주지구','순천여수','전주지구','군산지구',
     '익산지구','부산지구','창원지구','울산지구','진주지구','대구지구','안동지구','경주지구',
     '포항지구','김천구미','영주지구','경기P2C','해외');
  if v_legacy is not null then
    raise notice '⚠️ 공식 명단에 없는 기존 소속(합칠지 결정 대기): %', v_legacy;
  end if;
end $$;
