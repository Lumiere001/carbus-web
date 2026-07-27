-- ============================================================
-- 요청 헤더 읽기를 한 곳으로 모으고 안전하게 (4-6 보강 2)
-- ============================================================
-- 어떻게 드러났나: 4단계 배포 중 `invalid input syntax for type json` 으로 멈췄다.
-- 로컬에서는 전량 재적용이 통과했는데 운영에서만 터졌다 — 두 환경의
-- `request.headers` 초기값이 달랐기 때문이다.
--
-- 진짜 문제는 그보다 크다: **이미 운영에 올라간 `guard_event_writable()` 트리거가
-- 헤더를 무방비로 캐스팅하고 있었다.**
--     current_setting('request.headers', true)::json ->> 'x-carbus-event'
-- 이 트리거는 8개 테이블의 INSERT/UPDATE/DELETE 마다 돈다. 헤더가 비었거나 JSON 이
-- 아닌 상태가 되면 **그 테이블에 대한 모든 쓰기가 실패한다** — 신청·배차·정산 전부.
-- 평소 PostgREST 는 항상 올바른 JSON 을 넣어주므로 지금까지 드러나지 않았을 뿐,
-- 조건이 맞으면 운영이 통째로 멈추는 종류의 결함이다.
--
-- 그래서 헤더 읽기를 **함수 하나로 모은다.** 같은 캐스팅을 여러 곳에 복사해두면
-- 한 곳만 고치고 나머지를 놓친다 — 실제로 viewing_event_id() 만 고치고 트리거를
-- 놓쳐서 이 사고가 났다.
-- ============================================================

-- ⚠️ plpgsql 인 이유: SQL 함수는 인라인되며 실행 계획 단계에서 식이 미리 평가될 수
--    있어, CASE 로 감싸도 캐스팅이 먼저 터진다("during startup" 에러).
--    plpgsql 은 문장을 순서대로 실행한다.
create or replace function public.request_event_header()
returns text language plpgsql stable set search_path = public as $$
declare v_raw text := current_setting('request.headers', true);
begin
  -- `IS JSON` 은 실제 파싱 가능 여부를 본다 (PostgreSQL 16+).
  -- "'{' 로 시작하는가" 같은 모양 검사로는 부족하다 — '{' 한 글자가 그걸 통과한다.
  if v_raw is null or not (v_raw is json object) then
    return null;
  end if;
  return nullif((v_raw::json) ->> 'x-carbus-event', '');
end $$;

comment on function public.request_event_header is
  '요청 헤더에서 "지금 보는 행사" id 를 안전하게 읽는다. 헤더가 없거나 JSON 이 아니면
   NULL — **절대 예외를 던지지 않는다.** 이 함수가 예외를 던지면 쓰기 가드 트리거가
   걸린 8개 테이블의 모든 쓰기가 멈춘다.';

-- ── 두 사용처를 이 함수로 통일 ──────────────────────────────
create or replace function public.viewing_event_id()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_id text := public.request_event_header();
begin
  if v_id is not null then
    -- 존재하는 행사만 인정한다. 모르는 uuid 면 진행 중 행사로 떨어진다.
    return coalesce(
      (select e.id from public.events e where e.id::text = v_id),
      public.active_event_id());
  end if;
  return public.active_event_id();
end $$;

create or replace function public.guard_event_writable()
returns trigger language plpgsql set search_path = public as $$
declare
  v_event  uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  v_header text := public.request_event_header();
begin
  if v_event is null then
    raise exception '% 에 행사(event_id)가 지정되지 않았습니다. 앱이 행사를 명시해야 합니다.',
      tg_table_name using errcode = 'not_null_violation';
  end if;

  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception '이미 저장된 자료를 다른 행사로 옮길 수 없습니다 (% → %).',
      old.event_id, new.event_id using errcode = 'restrict_violation';
  end if;

  -- 화면이 선언한 행사와 저장하려는 행사가 다르면 거부.
  if v_header is not null and v_header <> v_event::text then
    raise exception
      '보고 있는 행사와 저장하려는 행사가 다릅니다. 화면을 새로 고친 뒤 다시 시도해 주세요.'
      using errcode = 'restrict_violation';
  end if;

  if current_setting('session_replication_role', true) is distinct from 'replica'
     and not (select public.is_event_writable(v_event)) then
    raise exception
      '지난 행사의 자료는 바꿀 수 없습니다. 고쳐야 하면 운영자가 사유를 적고 잠금을 열어야 합니다.'
      using errcode = 'restrict_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

grant execute on function public.request_event_header() to authenticated;
grant execute on function public.viewing_event_id() to authenticated;

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_live uuid := public.active_event_id();
  -- **행사를 선언하지 않은** 헤더들. 못 읽는 값은 "선언 없음"과 같이 취급해야 한다.
  v_none text[] := array['', 'null', '쓰레기값', '{', '[]', '{}'];
  v_one  text;
  v_reg  uuid;
  v_ok   boolean;
begin
  select id into v_reg from registrations where event_id = v_live limit 1;
  if v_reg is null then
    raise notice '  (신청 데이터가 없어 쓰기 검증은 건너뜀)';
  end if;

  foreach v_one in array v_none loop
    perform set_config('request.headers', v_one, true);

    -- ① 조회가 예외 없이 진행 중 행사로 떨어진다
    if public.viewing_event_id() is distinct from v_live then
      perform set_config('request.headers', '{}', true);
      raise exception '헤더가 [%] 일 때 진행 중 행사로 안 떨어집니다', v_one;
    end if;

    -- ② **쓰기도 막히지 않는다.** 이게 이번 사고의 핵심이다 — 쓰기 가드가 헤더를
    --    캐스팅하다 터지면 8개 테이블의 모든 쓰기가 멈춘다(신청·배차·정산 전부).
    if v_reg is not null then
      update registrations set note = note where id = v_reg;
    end if;
  end loop;
  raise notice '검증 ①: 행사 선언 없는 헤더 %건에서 조회·쓰기 모두 정상',
    array_length(v_none, 1);

  -- ③ 반대로 **다른 행사를 선언한** 헤더면 쓰기는 거부되어야 한다(열람·쓰기 대조).
  --    읽기는 기본 행사로 떨어지고, 쓰기는 막는다 — 의도가 불분명할 때 쓰지 않는 쪽이 안전하다.
  if v_reg is not null then
    perform set_config(
      'request.headers',
      json_build_object('x-carbus-event', gen_random_uuid()::text)::text, true);
    v_ok := false;
    begin
      update registrations set note = note where id = v_reg;
    exception when restrict_violation then v_ok := true;
    end;
    if not v_ok then
      perform set_config('request.headers', '{}', true);
      raise exception '검증 실패: 다른 행사를 선언한 헤더인데 쓰기가 통과했습니다';
    end if;
    raise notice '검증 ②: 다른 행사를 선언한 헤더 → 쓰기 거부 OK';
  end if;

  perform set_config('request.headers', '{}', true);
  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 변경은 롤백됨)';
  else
    raise;
  end if;
end $$;
