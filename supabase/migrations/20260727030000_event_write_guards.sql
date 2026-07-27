-- ============================================================
-- Phase 4-4 — event_id 기본값 제거 + 쓰기 가드 (HANDOFF §8-D)
-- ============================================================
-- 전제: **앱 코드는 언젠가 반드시 틀린다.** "조심하면 된다"는 방어에 넣지 않는다.
--
-- 무엇을 막는가:
--   지금은 8개 테이블의 event_id 에 DEFAULT active_event_id() 가 걸려 있다.
--   그래서 앱이 event_id 를 빠뜨려도 **에러 없이** 활성 행사로 들어간다.
--   폴더화 뒤에는 이게 정확히 위험이 된다 — 화면은 과거 행사를 보는데 저장은
--   진행 중 행사로 조용히 성공하는, 발견 불가능한 오배치가 된다.
--   DEFAULT 를 지우면 그 실수가 **NOT NULL 위반**으로 즉시 시끄럽게 실패한다.
--
-- 왜 트리거까지 두는가 (RLS 로 부족한 이유):
--   SECURITY DEFINER 함수는 RLS 를 통째로 우회한다. 이 코드베이스에는 그런 함수가
--   여럿 있다(campus_remit_add, set_attendance, create_event...). **테이블 트리거는
--   우회하지 못한다.** 그래서 마지막 방어선을 트리거에 둔다.
--
-- 선행 조건 (4-3, 이미 완료):
--   앱 쓰기 6곳 + DB 함수 campus_remit_add 가 event_id 를 명시한다.
--   create_event·sync_campus_remitted_total·장부 backfill 은 원래 명시하고 있었다.
--   log_registration_change 만 빠져 있었고 — 이 파일에서 고친다.
-- ============================================================

-- ── 1. 이 행사에 지금 쓸 수 있는가 ──────────────────────────
create or replace function public.is_event_writable(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events
     where id = p_event
       and (write_mode = 'live'
            or (unlock_until is not null and unlock_until > now()))
  )
$$;

comment on function public.is_event_writable is
  '그 행사에 지금 쓰기가 허용되는가. 진행 중 행사이거나, 임시 잠금해제가 아직 안 끝났으면 참.
   ⚠️ 정책·트리거에서는 (select public.is_event_writable(...)) 로 감쌀 것 (§8-G).';

grant execute on function public.is_event_writable(uuid) to authenticated;

-- ── 2. 감사 이력이 자기 행사를 따라가게 ─────────────────────
-- 예전엔 event_id 를 컬럼 DEFAULT(=활성 행사)에 맡겼다. 두 가지가 잘못이다:
--   ① DEFAULT 를 지우는 순간 **모든 신청 쓰기가 NOT NULL 위반으로 죽는다.**
--   ② 과거 행사 신청을 고치면(잠금해제 중) 그 이력이 **현재 행사에 붙는다.**
-- 이력은 자기가 기록하는 행과 같은 행사에 속해야 한다.
create or replace function public.log_registration_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into registration_audit(event_id, registration_id, changed_by, change_type, after_value)
    values (new.event_id, new.id, auth.uid(), 'insert', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    new.version := old.version + 1;
    insert into registration_audit(event_id, registration_id, changed_by, change_type,
                                   before_value, after_value)
    values (new.event_id, new.id, auth.uid(), 'update', to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into registration_audit(event_id, registration_id, changed_by, change_type, before_value)
    values (old.event_id, old.id, auth.uid(), 'delete', to_jsonb(old));
    return old;
  end if;
end $$;

-- ── 3. DEFAULT 제거 ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'registrations','buses','event_trips','batch_runs',
    'campus_payment_settlements','campus_remittances','registration_audit','payment_ledger'
  ] loop
    execute format('alter table public.%I alter column event_id drop default', t);
  end loop;
end $$;

-- ── 4. 쓰기 가드 트리거 ─────────────────────────────────────
-- 검사 3가지 (§8-D 4번):
--   ① event_id NULL 금지 — NOT NULL 이 이미 막지만, 사람이 읽을 문장으로 바꿔준다.
--   ② UPDATE 로 행이 행사를 갈아타는 것 금지 — "과거 자료 보존"의 **유일한 물리적
--      보장**이다. RLS 는 행이 어디 속하는지만 볼 뿐, 그 값이 바뀌는 것을 못 본다.
--   ③ 그 행사에 지금 쓸 수 있는가.
--
-- ⚠️ ③ 은 백업 적재(session_replication_role = replica) 중에는 건너뛴다.
--    load-backup.py 가 그 모드로 운영 스냅샷을 통째로 넣는데, 스냅샷에는 이미 끝난
--    행사의 행이 들어 있을 수 있다. 그때 ③ 이 걸리면 **로컬 재현이 통째로 실패**한다.
--    replica 모드는 앱(PostgREST)에서 도달할 수 없고 DB 직접 접속으로만 설정된다.
--    ①②는 그 모드에서도 계속 검사한다 — 구조를 지키는 검사라 면제할 이유가 없다.
create or replace function public.guard_event_writable()
returns trigger language plpgsql set search_path = public as $$
declare
  v_event uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
begin
  if v_event is null then
    raise exception '% 에 행사(event_id)가 지정되지 않았습니다. 앱이 행사를 명시해야 합니다.',
      tg_table_name using errcode = 'not_null_violation';
  end if;

  if tg_op = 'UPDATE' and new.event_id is distinct from old.event_id then
    raise exception '이미 저장된 자료를 다른 행사로 옮길 수 없습니다 (% → %).',
      old.event_id, new.event_id using errcode = 'restrict_violation';
  end if;

  if current_setting('session_replication_role', true) is distinct from 'replica'
     and not (select public.is_event_writable(v_event)) then
    raise exception
      '지난 행사의 자료는 바꿀 수 없습니다. 고쳐야 하면 운영자가 사유를 적고 잠금을 열어야 합니다.'
      using errcode = 'restrict_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'registrations','buses','event_trips','batch_runs',
    'campus_payment_settlements','campus_remittances','registration_audit','payment_ledger'
  ] loop
    execute format('drop trigger if exists trg_%s_event_writable on public.%I', t, t);
    execute format(
      'create trigger trg_%s_event_writable before insert or update or delete on public.%I
         for each row execute function public.guard_event_writable()', t, t);
    -- ENABLE ALWAYS: 이게 마지막 방어선이라 replica 모드에서도 살아 있어야 한다.
    -- (쓰기 가능 여부 검사만 함수 안에서 면제된다 — 위 주석 참고)
    execute format('alter table public.%I enable always trigger trg_%s_event_writable', t, t);
  end loop;
end $$;

-- ── 5. 교차 행사 참조 가드 ──────────────────────────────────
-- 신청이 **다른 행사의** 운행편·호차를 가리키면 막는다.
-- buses ↔ event_trips 는 guard_bus_trip_scope(20260721080000)가 이미 같은 일을 한다.
create or replace function public.guard_registration_scope()
returns trigger language plpgsql set search_path = public as $$
declare v_bad text;
begin
  select case
    when new.up_trip_id is not null
         and not exists (select 1 from event_trips t
                          where t.id = new.up_trip_id and t.event_id = new.event_id)
      then '상행 운행편'
    when new.down_trip_id is not null
         and not exists (select 1 from event_trips t
                          where t.id = new.down_trip_id and t.event_id = new.event_id)
      then '하행 운행편'
    when new.assigned_up_bus_id is not null
         and not exists (select 1 from buses b
                          where b.id = new.assigned_up_bus_id and b.event_id = new.event_id)
      then '상행 배정 호차'
    when new.assigned_down_bus_id is not null
         and not exists (select 1 from buses b
                          where b.id = new.assigned_down_bus_id and b.event_id = new.event_id)
      then '하행 배정 호차'
  end into v_bad;

  if v_bad is not null then
    raise exception '%가 다른 행사의 것입니다. 같은 행사 안에서만 연결할 수 있습니다.', v_bad
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_reg_event_scope on public.registrations;
create trigger trg_reg_event_scope
  before insert or update of event_id, up_trip_id, down_trip_id,
                             assigned_up_bus_id, assigned_down_bus_id
  on public.registrations
  for each row execute function public.guard_registration_scope();
alter table public.registrations enable always trigger trg_reg_event_scope;

-- ── 6. 쓰기 정책을 "쓸 수 있는 행사"로 ──────────────────────
-- using(읽기)은 아직 그대로 둔다 — 읽기 확대는 4-6 이다(§8-F: 되돌리기 가장 쉬운 마지막).
-- with check(쓰기)만 잠금해제를 인정하도록 넓힌다. 지금은 진행 중 행사 = 활성 행사라
-- **동작이 하나도 안 바뀐다.**
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
         using (event_id = (select public.active_event_id()))
         with check ((select public.is_event_writable(event_id)))',
      t || '_event_scope', t);
  end loop;
end $$;

-- ── 7. 자체검증 ─────────────────────────────────────────────
do $$
declare
  v_event uuid := public.active_event_id();
  v_past  uuid;
  v_id    uuid;
  v_ok    boolean;
  v_cnt   int;
begin
  -- ① event_id 를 빼면 이제 시끄럽게 실패한다 (예전엔 조용히 활성 행사로 들어갔다)
  v_ok := false;
  begin
    insert into registrations (campus_id, student_id, name)
    values ((select id from campuses limit 1), '00', '__검증_행사없음');
  exception when not_null_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: event_id 없이 신청이 들어갔습니다 (DEFAULT 가 남아 있습니다)';
  end if;
  raise notice '검증 ①: event_id 누락 시 즉시 실패 OK';

  -- ② 정상 INSERT 는 그대로 되고, 감사 이력도 같은 행사에 붙는다
  insert into registrations (event_id, campus_id, student_id, name)
  values (v_event, (select id from campuses limit 1), '00', '__검증_정상')
  returning id into v_id;
  select count(*) into v_cnt from registration_audit
   where registration_id = v_id and event_id = v_event;
  if v_cnt <> 1 then
    raise exception '검증 실패: 감사 이력이 같은 행사에 안 붙었습니다 (%건)', v_cnt;
  end if;
  raise notice '검증 ②: 정상 INSERT + 감사 이력 행사 일치 OK';

  -- ③ 행을 다른 행사로 옮길 수 없다 (과거 자료 보존의 물리적 보장)
  insert into events (name, starts_on, ends_on)
  values ('__검증_과거행사', current_date, current_date)
  returning id into v_past;
  v_ok := false;
  begin
    update registrations set event_id = v_past where id = v_id;
  exception when restrict_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 신청이 다른 행사로 옮겨졌습니다';
  end if;
  raise notice '검증 ③: 행이 행사를 갈아타는 것 차단 OK';

  -- ④ 지난 행사에는 쓸 수 없고, 잠금을 열면 쓸 수 있다
  v_ok := false;
  begin
    insert into registrations (event_id, campus_id, student_id, name)
    values (v_past, (select id from campuses limit 1), '00', '__검증_과거쓰기');
  exception when restrict_violation or insufficient_privilege then v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 지난 행사에 그냥 쓰였습니다';
  end if;
  update events set unlock_until = now() + interval '10 minutes',
                    unlock_reason = '__검증'
   where id = v_past;
  insert into registrations (event_id, campus_id, student_id, name)
  values (v_past, (select id from campuses limit 1), '00', '__검증_잠금해제후');
  raise notice '검증 ④: 지난 행사 쓰기 차단 + 잠금해제 후 허용 OK';

  -- ⑤ 다른 행사의 운행편을 가리킬 수 없다
  v_ok := false;
  begin
    update registrations
       set up_trip_id = (select id from event_trips
                          where event_id = v_event and direction = 'up' limit 1)
     where name = '__검증_잠금해제후';
  exception when foreign_key_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 다른 행사의 운행편이 연결됐습니다';
  end if;
  raise notice '검증 ⑤: 교차 행사 참조 차단 OK';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

-- ── 8. 트리거 활성 확인 (§8-G — 매 마이그레이션 필수) ───────
do $$
declare t text; v_state char;
begin
  foreach t in array array[
    'registrations','buses','event_trips','batch_runs',
    'campus_payment_settlements','campus_remittances','registration_audit','payment_ledger'
  ] loop
    select tg.tgenabled into v_state
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
     where c.relname = t and tg.tgname = 'trg_' || t || '_event_writable';
    if v_state is distinct from 'A' then
      raise exception '% 의 쓰기 가드가 ENABLE ALWAYS 가 아닙니다 (상태 %) — 방어선이 없습니다',
        t, coalesce(v_state::text, '없음');
    end if;
  end loop;
  raise notice '쓰기 가드 8개 전부 ENABLE ALWAYS 확인';
end $$;
