-- ============================================================
-- 보안 — 역할 검사가 NULL 에서 열리던 것 + anon 실행 권한 회수
-- ============================================================
-- 어떻게 발견했나: master_remit_add 의 자체검증이 "권한 검사 없이 대리 등록됐습니다"로
-- 실패했다. 검증이 잘못된 줄 알았는데 **함수가 잘못돼 있었다.**
--
-- 무엇이 문제인가:
--   `public.current_role()` 은 `select role from profiles where id = auth.uid()` 다.
--   로그인하지 않은 호출(auth.uid() = NULL)에서는 **NULL** 을 돌려준다.
--   그런데 가드가 `if current_role() <> 'master' then raise` 형태였다.
--   SQL 에서 `NULL <> 'master'` 는 **참이 아니라 NULL** 이고, IF 는 NULL 을 거짓으로
--   본다. 즉 **로그인하지 않으면 권한 검사가 통째로 통과한다.**
--
--   반대로 `campus_remit_delete` 는 긍정 검사(`= 'campus_admin'` / `= 'master'`)에
--   `else raise` 라서 NULL 이 정상적으로 막힌다. 같은 코드베이스에 두 형태가 섞여 있었다.
--
-- 실제 노출 범위 (실측):
--   PostgreSQL 은 새 함수에 EXECUTE 를 PUBLIC 으로 기본 부여하고, Supabase 의 `anon`
--   은 PUBLIC 의 일원이다. 그래서 **인증 없이** 호출 가능한 상태였다:
--     · master_remit_add       — 아무 캠퍼스 이름으로 송금 기록을 만들 수 있다
--     · unlock_event_writes    — 지난 행사의 쓰기 잠금을 열 수 있다
--     · lock_event_writes      — 열린 잠금을 닫을 수 있다
--   (campus_remit_add 는 담당 캠퍼스가 NULL 이라 뒤에서 우연히 막혔지만 같이 고친다)
--
-- 두 겹으로 막는다:
--   ① 가드를 `is distinct from` 으로 — NULL 에서도 참이 되어 제대로 막는다.
--   ② PUBLIC 의 EXECUTE 를 회수하고 authenticated 에게만 준다.
--      ①만 하면 "권한 없음" 예외까지는 anon 이 호출할 수 있다(정보 노출·소음).
-- ============================================================

-- ── ① 가드를 NULL 안전하게 ──────────────────────────────────
create or replace function public.master_remit_add(
  p_campus_id uuid, p_amount int, p_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare v_event uuid := (select public.writable_event_id());
begin
  -- `is distinct from` 이라 NULL(미로그인)도 걸린다. `<>` 는 NULL 을 통과시킨다.
  if public.current_role() is distinct from 'master' then
    raise exception '총단(master)만 대리 등록할 수 있습니다';
  end if;
  if v_event is null then raise exception '지금 쓸 수 있는 행사가 없습니다'; end if;
  if p_amount <= 0 then raise exception '송금액은 0보다 커야 합니다'; end if;
  if not exists (select 1 from campuses where id = p_campus_id) then
    raise exception '없는 캠퍼스입니다';
  end if;

  insert into campus_remittances (event_id, campus_id, amount, note, created_by)
  values (v_event, p_campus_id, p_amount,
          coalesce(nullif(btrim(p_note), ''), '총단 대리 등록'), auth.uid());
end $$;

create or replace function public.unlock_event_writes(
  p_event_id uuid, p_reason text, p_minutes int default 60
)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if public.current_role() is distinct from 'master' then
    raise exception 'master만 지난 행사의 잠금을 열 수 있습니다';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '사유를 적어 주세요 (무엇을 고치려고 여는지)';
  end if;
  if p_minutes < 1 or p_minutes > 480 then
    raise exception '잠금해제는 1분~8시간(480분) 사이만 됩니다';
  end if;
  v_until := now() + make_interval(mins => p_minutes);
  update public.events set unlock_until = v_until, unlock_reason = btrim(p_reason)
   where id = p_event_id;
  if not found then raise exception '행사를 찾을 수 없습니다'; end if;
  return v_until;
end $$;

create or replace function public.lock_event_writes(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() is distinct from 'master' then
    raise exception 'master만 잠글 수 있습니다';
  end if;
  update public.events set unlock_until = null, unlock_reason = null
   where id = p_event_id;
end $$;

create or replace function public.campus_remit_add(p_amount int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campus uuid := public.current_campus();
  v_event  uuid := (select public.writable_event_id());
begin
  if public.current_role() is distinct from 'campus_admin' then
    raise exception 'campus_admin만 송금을 등록할 수 있습니다';
  end if;
  if v_campus is null then raise exception '담당 캠퍼스가 지정되지 않았습니다'; end if;
  if v_event is null then raise exception '지금 쓸 수 있는 행사가 없습니다'; end if;
  if p_amount <= 0 then raise exception '송금액은 0보다 커야 합니다'; end if;
  insert into campus_remittances (event_id, campus_id, amount, note, created_by)
  values (v_event, v_campus, p_amount, p_note, auth.uid());
end $$;

create or replace function public.update_event_fares(
  p_event_id uuid, p_fee_roundtrip integer, p_fee_oneway integer
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() is distinct from 'master' then
    raise exception '차량비 변경은 master 만 할 수 있습니다';
  end if;
  if p_fee_roundtrip < 0 or p_fee_oneway < 0 then
    raise exception '차량비는 0원 이상이어야 합니다';
  end if;
  if not (select public.is_event_writable(p_event_id)) then
    raise exception
      '지난 행사의 차량비는 바꿀 수 없습니다. 이미 정산된 청구액이 다시 계산됩니다. 꼭 필요하면 사유를 적고 잠금을 여세요.'
      using errcode = 'restrict_violation';
  end if;
  update events set fee_roundtrip = p_fee_roundtrip, fee_oneway = p_fee_oneway
   where id = p_event_id;
  if not found then raise exception '없는 행사입니다'; end if;
end $$;

-- ── ② 인증 없는 호출자에게서 실행 권한 회수 ─────────────────
-- PostgreSQL 은 새 함수의 EXECUTE 를 PUBLIC 에 기본 부여한다. Supabase 의 anon 은
-- PUBLIC 의 일원이라, 아무것도 안 하면 **로그인 없이 호출 가능**하다.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.master_remit_add(uuid, int, text)',
    'public.campus_remit_add(int, text)',
    'public.campus_remit_delete(uuid)',
    'public.unlock_event_writes(uuid, text, int)',
    'public.lock_event_writes(uuid)',
    'public.update_event_fares(uuid, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_prev text := current_user;
  v_ok   boolean;
  v_cnt  int;
begin
  -- ① 미로그인(=current_role() NULL) 상태에서 막히는가.
  --    postgres 로 실행 중이라 auth.uid() 가 NULL 이고 profiles 행이 없다 —
  --    이게 정확히 anon 이 처한 상태다.
  if public.current_role() is not null then
    raise notice '  (이 세션의 current_role() 이 NULL 이 아니라 검증 건너뜀)';
    return;
  end if;

  v_ok := false;
  begin
    perform public.master_remit_add((select id from campuses limit 1), 1000, '__검증');
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 미로그인 상태로 대리 등록이 됐습니다';
  end if;
  raise notice '검증 ①: 미로그인 대리 등록 차단 OK';

  v_ok := false;
  begin
    perform public.unlock_event_writes(public.active_event_id(), '__검증', 5);
  exception when others then v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 미로그인 상태로 행사 잠금이 열렸습니다';
  end if;
  raise notice '검증 ②: 미로그인 잠금해제 차단 OK';

  -- ③ anon 에게 실행 권한이 남아 있지 않은가
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('master_remit_add','campus_remit_add','campus_remit_delete',
                       'unlock_event_writes','lock_event_writes','update_event_fares')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_cnt > 0 then
    raise exception 'anon 이 아직 실행할 수 있는 권한 함수 %개', v_cnt;
  end if;
  raise notice '검증 ③: anon 실행 권한 회수 확인 OK';
end $$;
