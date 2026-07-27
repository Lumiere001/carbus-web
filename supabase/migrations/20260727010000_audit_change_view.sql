-- ============================================================
-- 변경 이력을 쓸 수 있게 만들기 (사용자 피드백: 로그 50건 제한 + 이력 추적 불가)
-- ============================================================
-- 사용자 피드백 원문:
--   "로그를 확인할 수 있는 부분이 있어서 괜찮긴 했는데 문제가 50건만 볼 수 있고
--    이전 이력들을 다 볼 수 없었다는 거야. 그러다 보니 차량 배차같이 큰 것들을
--    돌리니까 불편한 점들이 많았단다. 또 어떤 사람들은 여러 번 바꾸기도 해서
--    그런 바꾼 이력들이 잘 추적이 되어야 할 것 같은데 그것이 잘 안 되어서..."
--
-- 왜 "50건 제한만 풀면" 안 되는가:
--   실측으로 감사 이력 18,967건 중 **73%가 실제로 아무것도 안 바뀐 UPDATE** 다.
--   배차를 한 번 돌리면 599명을 UPDATE 하는데, 그중 배정이 실제로 달라진 사람은
--   일부다. 나머지는 "같은 값으로 덮어쓴" 이력이다. 제한만 풀면 화면이 그 노이즈로
--   가득 차서 오히려 더 못 찾는다. **무엇이 바뀌었는지를 알아야 거를 수 있다.**
--
-- 그래서 뷰가 하나 필요하다. 앱에서 JSON 을 비교하면 페이지 단위로만 걸러져
-- "몇 건인지"도 못 세고 페이지 넘김이 깨진다. SQL 에서 걸러야 센다.
--
-- ⚠️ 옛 컬럼·새 컬럼이 한 논리 필드다.
--    감사 스냅샷에는 3-C 이전(departure_slot_id·uses_return_bus)과 이후
--    (up_trip_id·down_trip_id)가 **섞여 있다.** 둘을 따로 세면 3-C 이후 변경이
--    "상행 편"과 "출발 시간대" 두 줄로 중복돼 보인다. 그래서 논리 필드 하나에
--    두 키를 달고 coalesce 로 비교한다 (마감 후 변동 화면과 같은 규칙).
-- ============================================================

-- 전체 이력을 시간순으로 넘겨보려면 이 인덱스가 있어야 한다.
-- 기존 인덱스는 (registration_id, created_at) 이라 "한 사람 이력"에만 듣는다.
create index if not exists idx_audit_event_time
  on public.registration_audit (event_id, created_at desc);

-- ── 변경 이력 뷰 ────────────────────────────────────────────
-- security_invoker = on 필수: 임역원은 자기 캠퍼스 이력만 봐야 한다.
-- 빠지면 뷰가 소유자 권한으로 돌아 **타 캠퍼스 개인정보가 새어나간다.**
drop view if exists public.v_registration_changes;
create view public.v_registration_changes with (security_invoker = on) as
select
  a.id,
  a.registration_id,
  a.event_id,
  a.created_at,
  a.change_type,
  a.changed_by,
  coalesce(a.after_value ->> 'name', a.before_value ->> 'name')             as person_name,
  coalesce(a.after_value ->> 'student_id', a.before_value ->> 'student_id') as student_id,
  nullif(coalesce(a.after_value ->> 'campus_id', a.before_value ->> 'campus_id'), '')::uuid
                                                                            as campus_id,
  d.changed_fields
from public.registration_audit a
left join lateral (
  select array_agg(f.label order by f.ord) as changed_fields
  from (values
    ('이름',      'name',                 null,                1),
    ('학번',      'student_id',           null,                2),
    ('캠퍼스',    'campus_id',            null,                3),
    ('상행 편',   'up_trip_id',           'departure_slot_id', 4),
    ('하행 편',   'down_trip_id',         'uses_return_bus',   5),
    ('참석유형',  'attendance_type',      null,                6),
    ('납부',      'payment_status',       null,                7),
    ('참여상태',  'participation_status', null,                8),
    ('역할',      'roles',                null,                9),
    ('비고',      'note',                 null,                10)
  ) as f(label, k, legacy, ord)
  where a.change_type = 'update'
    and coalesce(a.before_value -> f.k, a.before_value -> f.legacy)
        is distinct from
        coalesce(a.after_value -> f.k, a.after_value -> f.legacy)
) d on true;

comment on view public.v_registration_changes is
  '순장/순원 변경 이력 + **무엇이 바뀌었는지**(changed_fields). change_type=update 인데
   changed_fields 가 NULL 이면 값이 하나도 안 바뀐 UPDATE 다(배차 재실행 등). 화면은
   기본적으로 그것을 감춘다. 옛·새 컬럼은 한 논리 필드로 묶어 중복 표시를 막는다.';

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_total   int;
  v_real    int;
  v_noop    int;
  v_sample  text;
begin
  select count(*) into v_total from v_registration_changes;
  select count(*) into v_real  from v_registration_changes
   where change_type <> 'update' or changed_fields is not null;
  v_noop := v_total - v_real;

  raise notice '변경 이력 뷰: 전체 %건 / 실변경 %건 / 무변경 UPDATE %건',
    v_total, v_real, v_noop;

  -- 뷰가 실제로 필드 이름을 뽑아내는가 (전부 NULL 이면 비교 로직이 죽은 것이다)
  if v_total > 0 and v_real = 0 then
    raise exception '변경 이력 뷰가 실변경을 하나도 못 찾았습니다 — 비교 로직 확인 필요';
  end if;

  select array_to_string(changed_fields, ', ') into v_sample
    from v_registration_changes
   where changed_fields is not null
   limit 1;
  if v_sample is not null then
    raise notice '  예시 변경 항목: %', v_sample;
  end if;
end $$;
