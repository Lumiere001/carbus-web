-- ============================================================
-- Phase 4-6 — 읽기 확대: 주소창이 정한 행사를 화면이 그린다 (HANDOFF §8-C)
-- ============================================================
-- 마지막 단계인 이유(§8-F): 되돌리기가 가장 쉽다. 이 파일만 되돌리면 읽기가 다시
-- 진행 중 행사로 좁아지고, 앞 단계들은 그대로 정상 동작한다.
--
-- 무엇이 바뀌나:
--   지금까지 "화면이 그리는 행사"는 DB 전역 스위치(active_event_id())였다. 그래서
--   master 가 과거 행사를 열면 **모든 사용자 화면이 같이 과거로 갔다.**
--   이제 `x-carbus-event` 요청 헤더(= 주소창의 행사)가 그걸 정한다. 사람마다,
--   심지어 탭마다 다른 행사를 볼 수 있다.
--
-- ⚠️ 헤더는 **권한을 주지 않는다.** 캠퍼스 범위·역할 정책은 그대로 살아 있다.
--    헤더가 하는 일은 "이미 볼 수 있는 것 중 어느 행사를 볼지" 고르는 것뿐이다.
--    헤더가 없거나 이상하면 진행 중 행사로 떨어진다(지금까지의 동작).
-- ============================================================

-- ── 1. 지금 보는 행사 ───────────────────────────────────────
create or replace function public.viewing_event_id()
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      -- 헤더 값이 uuid 모양일 때만 받아들인다. 아무 문자열이나 캐스팅하면
      -- 잘못된 헤더 하나로 **모든 조회가 예외**가 된다(화면 전체가 죽는다).
      select e.id from public.events e
       where e.id::text = nullif(
               current_setting('request.headers', true)::json ->> 'x-carbus-event', '')
    ),
    public.active_event_id()
  )
$$;

comment on function public.viewing_event_id is
  '화면이 그리는 행사. 요청 헤더 x-carbus-event(= 주소창 /admin/e/<id>)가 정하고,
   없거나 존재하지 않는 값이면 진행 중 행사로 떨어진다. 쓰기 대상은 이것이 아니라
   is_event_writable() 로 따로 판정한다 — 지난 행사는 보이지만 쓰이지 않는다.';

grant execute on function public.viewing_event_id() to authenticated;

-- ── 2. 뷰를 "보는 행사" 기준으로 ────────────────────────────
-- ⚠️ 마이그레이션 파일이 아니라 **DB 에 실재하는 정의**를 읽어 치환한다(§8-G).
--    v_campus_stats 는 이미 3회 재정의됐다 — 파일만 보고 다시 쓰면 그동안의 수정을
--    조용히 되돌린다. 필터 구조는 건드리지 않고 함수 이름만 바꾼다.
--    (뷰에서 행사 필터를 빼고 앱이 거르게 하는 방식은 채택하지 않았다. 필터를 하나
--     빠뜨리면 그 화면에 전 행사가 합산되는데 **에러가 안 난다** — 정산 숫자가 조용히
--     틀리면 금전 사고다.)
do $$
declare
  r      record;
  v_def  text;
  v_cnt  int := 0;
begin
  for r in
    select c.relname, pg_get_viewdef(c.oid, true) as def
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and pg_get_viewdef(c.oid) like '%active_event_id()%'
     order by c.relname
  loop
    v_def := replace(r.def, 'active_event_id()', 'viewing_event_id()');
    execute format('create or replace view public.%I with (security_invoker = on) as %s',
                   r.relname, v_def);
    v_cnt := v_cnt + 1;
  end loop;
  raise notice '뷰 %개를 "보는 행사" 기준으로 전환', v_cnt;
end $$;

-- ── 3. RLS — 읽기는 보는 행사, 쓰기는 쓸 수 있는 행사 ───────
-- using(읽기)과 with check(쓰기)를 서로 다른 술어로 두는 게 폴더화의 핵심이다.
-- 지난 행사를 **볼 수는 있고 쓸 수는 없는** 상태가 이걸로 표현된다.
--
-- ⚠️ DELETE 는 별도 정책이 필요하다. PostgreSQL 은 DELETE 에 with check 를 적용하지
--    않고 using 만 본다. 이걸 안 메우면 지난 행사를 열어둔 채 삭제하면 **과거가 지워진다.**
do $$
declare t text;
begin
  foreach t in array array[
    'registrations','buses','event_trips','batch_runs',
    'campus_payment_settlements','campus_remittances','registration_audit','payment_ledger'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_event_scope', t);
    execute format(
      'create policy %I on public.%I as restrictive for all
         using (event_id = (select public.viewing_event_id()))
         with check ((select public.is_event_writable(event_id)))',
      t || '_event_scope', t);

    execute format('drop policy if exists %I on public.%I', t || '_event_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete
         using ((select public.is_event_writable(event_id)))',
      t || '_event_delete', t);
  end loop;
end $$;

-- ── 4. 열람·쓰기 대조 (§8-D 3번) ────────────────────────────
-- 화면이 A 를 보는데 저장이 B 로 가는 것을 막는다. 이게 없으면 "master 는 과거
-- 화면을 보는데 저장은 진행 중 행사로 조용히 성공"하는 **발견 불가능한** 오배치가 남는다.
-- 헤더가 없으면(행사 경로 밖 — 임역원 화면 등) 검사하지 않는다.
create or replace function public.guard_event_writable()
returns trigger language plpgsql set search_path = public as $$
declare
  v_event  uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  v_header text := nullif(
    current_setting('request.headers', true)::json ->> 'x-carbus-event', '');
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

-- ── 5. 자체검증 ─────────────────────────────────────────────
do $$
declare
  v_live uuid := public.active_event_id();
  v_past uuid;
  v_seen uuid;
  v_cnt  int;
  v_ok   boolean;
begin
  -- ① 헤더가 없으면 지금까지와 똑같이 진행 중 행사를 본다
  if public.viewing_event_id() is distinct from v_live then
    raise exception '헤더 없이도 진행 중 행사를 봐야 합니다';
  end if;
  raise notice '검증 ①: 헤더 없음 → 진행 중 행사 (기존 동작 유지) OK';

  -- ② 헤더를 주면 그 행사를 본다
  insert into events (name, starts_on, ends_on)
  values ('__검증_지난행사', current_date - 30, current_date - 28)
  returning id into v_past;

  perform set_config('request.headers',
                     json_build_object('x-carbus-event', v_past::text)::text, true);
  v_seen := public.viewing_event_id();
  if v_seen is distinct from v_past then
    raise exception '헤더가 가리키는 행사를 안 봅니다 (기대 % / 실제 %)', v_past, v_seen;
  end if;
  raise notice '검증 ②: 헤더 → 그 행사를 봄 OK';

  -- ③ 이상한 헤더는 무시하고 진행 중 행사로 떨어진다 (화면이 죽지 않아야 한다)
  perform set_config('request.headers', '{"x-carbus-event":"쓰레기값"}', true);
  if public.viewing_event_id() is distinct from v_live then
    raise exception '잘못된 헤더에서 진행 중 행사로 안 떨어집니다';
  end if;
  raise notice '검증 ③: 잘못된 헤더 → 진행 중 행사로 안전하게 떨어짐 OK';

  -- ④ 화면과 저장 대상이 다르면 거부 (열람·쓰기 대조)
  perform set_config('request.headers',
                     json_build_object('x-carbus-event', v_past::text)::text, true);
  v_ok := false;
  begin
    insert into registrations (event_id, campus_id, student_id, name)
    values (v_live, (select id from campuses limit 1), '00', '__검증_대조');
  exception when restrict_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 보는 행사와 다른 행사에 저장됐습니다';
  end if;
  raise notice '검증 ④: 열람·쓰기 대조 OK';

  perform set_config('request.headers', '', true);

  -- ⑤ 뷰가 헤더를 따라간다 — 지난 행사를 보면 그 행사 기준으로 센다
  perform set_config('request.headers',
                     json_build_object('x-carbus-event', v_past::text)::text, true);
  select count(*) into v_cnt from v_campus_stats;
  raise notice '검증 ⑤: 지난 행사 뷰 조회 %행 (예외 없이 동작)', v_cnt;
  perform set_config('request.headers', '', true);

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

-- ── 6. security_invoker 전수 검사 (§8-G) ────────────────────
-- 빠지면 뷰가 소유자 권한으로 돌아 RLS 가 통째로 우회된다.
-- 실측 피해 기록: campus_admin 이 8건 대신 599건을 조회했다.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and coalesce(c.reloptions::text, '') not like '%security_invoker=on%';
  if v_bad is not null then
    raise exception 'security_invoker 가 빠진 뷰: % — RLS 가 우회됩니다', v_bad;
  end if;
  raise notice 'security_invoker 전수 검사 통과';
end $$;

-- ── 7. 트리거 활성 확인 ─────────────────────────────────────
do $$
declare t text; v_state char;
begin
  foreach t in array array[
    'registrations','buses','event_trips','batch_runs',
    'campus_payment_settlements','campus_remittances','registration_audit','payment_ledger'
  ] loop
    select tg.tgenabled into v_state from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
     where c.relname = t and tg.tgname = 'trg_' || t || '_event_writable';
    if v_state is distinct from 'A' then
      raise exception '% 의 쓰기 가드가 ENABLE ALWAYS 가 아닙니다 (%)', t, coalesce(v_state::text,'없음');
    end if;
  end loop;
  raise notice '쓰기 가드 8개 ENABLE ALWAYS 확인';
end $$;
