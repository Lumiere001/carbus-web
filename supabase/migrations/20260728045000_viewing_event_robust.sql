-- ============================================================
-- viewing_event_id() 를 잘못된 헤더에 견디게 (4-6 보강)
-- ============================================================
-- 어떻게 드러났나: 마이그레이션 전량 재적용 중 `invalid input syntax for type json`
-- 으로 멈췄다. 앞선 마이그레이션의 자체검증이 `request.headers` 를 빈 문자열로
-- 되돌려 놓았고, 그 뒤 이 함수가 `''::json` 을 시도했다.
--
-- 왜 이게 운영에서도 문제인가:
--   `current_setting('request.headers', true)` 는 PostgREST 가 심는 값이다. 그런데
--   **비어 있거나 JSON 이 아닌 상태**가 되면 이 함수를 부르는 모든 뷰·정책이 예외를
--   던진다 — 즉 화면 전체가 죽는다. 4-6 에서 "헤더 값이 uuid 모양일 때만 받는다"는
--   방어는 넣었지만, **헤더 문자열 자체가 JSON 이 아닌 경우**는 못 막고 있었다.
--   uuid 검사보다 한 겹 앞의 문제다.
--
-- 고침: JSON 객체 모양일 때만 캐스팅한다. 아니면 없는 것으로 보고 진행 중 행사로
-- 떨어진다(지금까지의 동작). **최악이 "기본 행사를 본다"이지 "화면이 죽는다"가 아니다.**
-- ============================================================

-- ⚠️ **SQL 함수가 아니라 plpgsql 이다.** 처음엔 SQL 함수에서 CASE 로 막았는데
--    그래도 터졌다 — 에러가 "SQL function ... during startup" 이었다.
--    SQL 함수는 인라인되면서 실행 계획 단계에서 식이 **미리 평가**될 수 있어,
--    CASE 의 "이 가지는 안 탄다"가 보호가 되지 못한다.
--    plpgsql 은 문장을 순서대로 실행하므로 검사 뒤에만 캐스팅한다.
--    (EXCEPTION 블록은 쓰지 않는다 — 호출마다 서브트랜잭션이 생겨 RLS 핫패스에서 비싸다)
create or replace function public.viewing_event_id()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_raw text := current_setting('request.headers', true);
  v_id  text;
begin
  -- `IS JSON` 은 **실제 파싱 가능 여부**를 본다 (PostgreSQL 16+).
  -- 처음엔 '{' 로 시작하는지만 봤는데, '{' 한 글자도 그 검사를 통과하고 캐스팅에서
  -- 터졌다 — "모양이 비슷하다"와 "파싱된다"는 다르다.
  if v_raw is json object then
    v_id := (v_raw::json) ->> 'x-carbus-event';
  end if;

  if v_id is not null and v_id <> '' then
    -- 존재하는 행사만 인정한다. 모르는 uuid 면 진행 중 행사로 떨어진다.
    return coalesce(
      (select e.id from public.events e where e.id::text = v_id),
      public.active_event_id());
  end if;
  return public.active_event_id();
end $$;

grant execute on function public.viewing_event_id() to authenticated;

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_live uuid := public.active_event_id();
  v_bad  text[] := array['', 'null', '쓰레기값', '{', '[]', '{"x-carbus-event":"몰라"}'];
  v_one  text;
begin
  foreach v_one in array v_bad loop
    perform set_config('request.headers', v_one, true);
    -- 예외 없이, 진행 중 행사로 떨어져야 한다.
    if public.viewing_event_id() is distinct from v_live then
      perform set_config('request.headers', '{}', true);
      raise exception '헤더가 [%] 일 때 진행 중 행사로 안 떨어집니다', v_one;
    end if;
  end loop;
  perform set_config('request.headers', '{}', true);
  raise notice '검증: 빈 값·비 JSON·모르는 uuid 헤더 %건에서 예외 없이 기본 행사 OK',
    array_length(v_bad, 1);
end $$;
