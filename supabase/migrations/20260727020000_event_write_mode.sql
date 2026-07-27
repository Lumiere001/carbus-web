-- ============================================================
-- Phase 4-2 — "진행 중 행사"(쓰기)와 "보는 행사"(읽기)를 분리할 토대
-- ============================================================
-- 설계 전문: HANDOFF §8. 이 파일은 4-2 단계로, **읽기는 아직 안 넓힌다.**
-- 지금 단계에서 화면 동작은 하나도 안 바뀐다 — 그게 의도다(§8-F 대원칙).
--
-- 무엇이 문제인가:
--   `events.is_active` 하나가 "신청이 들어가는 행사"와 "화면이 그리는 행사"를
--   겸직한다. 그래서 master 가 과거 행사를 열어보면 **모든 사용자 화면이 같이
--   과거로 가고**, 그 상태에서 누가 입력하면 과거 행사에 쓰인다.
--
-- 이 파일이 하는 일:
--   ① write_mode 도입 — 쓰기 대상 행사를 is_active 와 **별도 개념**으로 세운다.
--   ② 진행 중 행사는 DB 가 최대 1개만 허용한다(부분 유니크 인덱스).
--   ③ 끝난 행사에 정산·환불이 필요하면 **시간이 지나면 저절로 닫히는** 임시 잠금해제.
--   ④ is_active 는 write_mode 를 따라가는 동기화 컬럼으로 남긴다 —
--      기존 코드 52개 파일이 그대로 도는 안전판이자 롤백 여지다.
--
-- 함께 고치는 것 (§8-E) — 미루면 게이트를 켜는 순간 깨지고, 하나는 **지금도 오염 중**이다:
--   · sync_role_labels 가 행사 범위 없이 registrations 를 UPDATE 한다.
--   · campus_remit_add 가 event_id 를 명시하지 않는다.
-- ============================================================

-- ── 1. write_mode ───────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'event_write_mode') then
    create type public.event_write_mode as enum ('live', 'closed');
  end if;
end $$;

alter table public.events
  add column if not exists write_mode public.event_write_mode not null default 'closed';

-- 임시 잠금해제: 끝난 행사의 정산·환불용. **시간이 지나면 저절로 닫힌다.**
-- cron 이 필요 없고, "풀어놓고 잊는" 가장 흔한 실패를 시간이 흡수한다.
alter table public.events
  add column if not exists unlock_until  timestamptz,
  add column if not exists unlock_reason text;

comment on column public.events.write_mode is
  '이 행사에 지금 쓸 수 있는가. live = 신청이 들어가는 행사(항상 최대 1개).
   closed = 끝난 행사(읽기 전용). is_active 와 달리 **화면이 무엇을 그리는지와 무관**하다.';
comment on column public.events.unlock_until is
  '끝난 행사의 임시 쓰기 허용 만료 시각. now() 와 비교하므로 저절로 닫힌다.';

-- 기존 데이터: 지금 활성인 행사가 곧 진행 중 행사다.
update public.events set write_mode = 'live' where is_active and write_mode <> 'live';

-- ② 진행 중 행사는 최대 1개. 두 행사가 동시에 신청을 받는 상태를 DB 가 만들 수 없다.
create unique index if not exists uq_events_single_live
  on public.events ((write_mode)) where write_mode = 'live';

-- ── 2. is_active 를 write_mode 에 동기화 ────────────────────
-- 기존 코드(52개 파일)가 계속 is_active 를 본다. 둘이 어긋나면 화면과 저장 대상이
-- 갈라지므로, **한쪽만 바꿔도 다른 쪽이 따라오게** 만든다. Phase 4 가 끝나면
-- is_active 는 지워도 되지만, 그전까지는 이게 롤백 여지다.
create or replace function public.sync_event_active()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- ⚠️ INSERT 에서는 "둘 중 하나라도 살아 있다고 말하면 진행 중"으로 본다.
    --    write_mode 를 안 주면 DEFAULT 'closed' 가 앉는데, 그걸 곧이곧대로 믿으면
    --    **is_active=true 인 백업 행을 넣는 순간 그 행사가 죽는다**(아래 참고).
    if new.is_active or new.write_mode = 'live' then
      new.is_active  := true;
      new.write_mode := 'live';
    else
      new.is_active  := false;
      new.write_mode := 'closed';
    end if;
  elsif new.write_mode is distinct from old.write_mode then
    new.is_active := (new.write_mode = 'live');
  elsif new.is_active is distinct from old.is_active then
    new.write_mode := case when new.is_active then 'live' else 'closed' end;
  end if;
  return new;
end $$;

drop trigger if exists trg_events_sync_active on public.events;
create trigger trg_events_sync_active
  before insert or update on public.events
  for each row execute function public.sync_event_active();

-- ⚠️ ENABLE ALWAYS 인 이유 — 이걸 빼면 **백업을 복원한 뒤 아무 데도 쓸 수 없게 된다.**
--    load-backup.py 는 session_replication_role = replica 로 트리거를 끄고 넣는다.
--    백업은 write_mode 컬럼이 생기기 전에 뜬 것이라 그 값이 없고, 트리거가 꺼져 있으면
--    DEFAULT 'closed' 가 그대로 앉는다. 결과: is_active=true 인데 write_mode='closed' 인
--    행사 — 화면에는 정상으로 보이는데 4-4 의 쓰기 가드가 전부 막는다.
--    **실측으로 겪었다.** trg_reg_000_derive 가 ALWAYS 인 것과 똑같은 이유다:
--    이건 업무 로직이 아니라 한 사실의 두 표현을 맞춰주는 구조 유지 장치다.
alter table public.events enable always trigger trg_events_sync_active;

-- ── 3. 지금 쓸 수 있는 행사 ─────────────────────────────────
-- active_event_id() 는 그대로 둔다(읽기용, 4-6 에서 viewing_event_id() 로 간다).
-- 이건 **쓰기용**이다. 둘을 나누는 게 Phase 4 의 핵심이다.
-- ⚠️ SECURITY DEFINER 인 이유: 형제 함수 active_event_id() 와 같아야 한다.
--    invoker 로 두면 events 읽기 정책에 의존하게 되는데, 지금은 events_select 가
--    `using true` 라 우연히 동작할 뿐이다. 그 정책을 조이는 순간 임역원의 명단
--    입력이 통째로 막힌다(event_id 를 못 구해서). 읽는 값이 "지금 쓰기 가능한
--    행사 id" 하나뿐이라 정보 노출도 없다.
create or replace function public.writable_event_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.events
   where write_mode = 'live'
      or (unlock_until is not null and unlock_until > now())
   order by (write_mode = 'live') desc
   limit 1
$$;

comment on function public.writable_event_id is
  '지금 쓰기가 허용된 행사. 진행 중 행사가 우선이고, 임시 잠금해제된 과거 행사도 포함된다.
   ⚠️ 정책·트리거에서 부를 때는 반드시 (select public.writable_event_id()) 처럼 서브쿼리로
   감쌀 것 — plpgsql/sql STABLE 함수는 인라인되지 않아 행마다 재평가된다.';

-- 끝난 행사 임시 잠금해제 (master 전용). 기본 60분, 최대 8시간.
create or replace function public.unlock_event_writes(
  p_event_id uuid,
  p_reason   text,
  p_minutes  int default 60
)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if public.current_role() <> 'master' then
    raise exception 'master만 지난 행사의 잠금을 열 수 있습니다';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception '사유를 적어 주세요 (무엇을 고치려고 여는지)';
  end if;
  if p_minutes < 1 or p_minutes > 480 then
    raise exception '잠금해제는 1분~8시간(480분) 사이만 됩니다';
  end if;

  v_until := now() + make_interval(mins => p_minutes);
  update public.events
     set unlock_until = v_until, unlock_reason = btrim(p_reason)
   where id = p_event_id;
  if not found then
    raise exception '행사를 찾을 수 없습니다';
  end if;
  return v_until;
end $$;

create or replace function public.lock_event_writes(p_event_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.current_role() <> 'master' then
    raise exception 'master만 잠글 수 있습니다';
  end if;
  update public.events
     set unlock_until = null, unlock_reason = null
   where id = p_event_id;
end $$;

grant execute on function public.writable_event_id() to authenticated;
grant execute on function public.unlock_event_writes(uuid, text, int) to authenticated;
grant execute on function public.lock_event_writes(uuid) to authenticated;

-- ── 4. §8-E — 지금도 오염 중인 행사 범위 누락 ───────────────
-- role_labels 의 라벨 이름을 바꾸면 **모든 행사**의 신청자 roles[] 가 바뀌었다.
-- 감사 트리거가 그 UPDATE 를 전부 이력으로 남기므로 과거 행사 이력까지 오염된다.
-- 라벨은 행사별 개념이 아니지만(전역 테이블), 그것이 건드리는 신청은 행사별이다.
create or replace function public.sync_role_labels()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.label <> old.label then
    update registrations
       set roles = array_replace(roles, old.label, new.label)
     where old.label = any(roles)
       and event_id = (select public.writable_event_id());
  elsif tg_op = 'DELETE' then
    update registrations
       set roles = array_remove(roles, old.label)
     where old.label = any(roles)
       and event_id = (select public.writable_event_id());
  end if;
  return coalesce(new, old);
end $$;

comment on function public.sync_role_labels is
  '역할 라벨 이름 변경·삭제를 신청의 roles[] 에 반영한다. **진행 중 행사만** 건드린다 —
   예전엔 조건이 없어 과거 행사 신청과 그 감사 이력까지 바꿨다(§8-E).';

-- campus_remit_add: event_id 를 명시한다. 지금은 컬럼 DEFAULT 가 채워주고 있지만,
-- 4-4 에서 DEFAULT 를 제거하면 이 함수가 조용히 깨진다. 자매 함수
-- campus_remit_delete 는 20260721010000 에서 이미 고쳐졌고 add 만 빠져 있었다.
create or replace function public.campus_remit_add(p_amount int, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_campus uuid := public.current_campus();
  v_event  uuid := (select public.writable_event_id());
begin
  if public.current_role() <> 'campus_admin' then
    raise exception 'campus_admin만 송금을 등록할 수 있습니다';
  end if;
  if v_campus is null then
    raise exception '담당 캠퍼스가 지정되지 않았습니다';
  end if;
  if v_event is null then
    raise exception '지금 쓸 수 있는 행사가 없습니다';
  end if;
  if p_amount <= 0 then
    raise exception '송금액은 0보다 커야 합니다';
  end if;
  insert into campus_remittances (event_id, campus_id, amount, note, created_by)
  values (v_event, v_campus, p_amount, p_note, auth.uid());
end $$;

-- ── 5. 자체검증 ─────────────────────────────────────────────
do $$
declare
  v_live     int;
  v_id       uuid;
  v_restored uuid;
  v_write    uuid;
  v_active   boolean;
  v_ok       boolean;
begin
  -- ① 진행 중 행사는 정확히 1개이고, is_active 와 일치한다
  select count(*) into v_live from events where write_mode = 'live';
  if v_live <> 1 then
    raise exception '진행 중 행사가 %개입니다 (1개여야 함)', v_live;
  end if;
  select id into v_id from events where write_mode = 'live';
  select is_active into v_active from events where id = v_id;
  if not v_active then
    raise exception '진행 중 행사인데 is_active 가 false 입니다 — 동기화 트리거 확인';
  end if;
  raise notice '검증 ①: 진행 중 행사 1개 + is_active 일치 OK';

  -- ② writable_event_id() 가 그 행사를 가리킨다
  v_write := public.writable_event_id();
  if v_write is distinct from v_id then
    raise exception 'writable_event_id() 가 진행 중 행사를 안 가리킵니다 (% vs %)', v_write, v_id;
  end if;
  raise notice '검증 ②: writable_event_id() = 진행 중 행사 OK';

  -- ③ 두 번째 행사를 live 로 만들 수 없다
  v_ok := false;
  begin
    insert into events (name, starts_on, ends_on, write_mode)
    values ('__검증_두번째_live', current_date, current_date, 'live');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 진행 중 행사가 2개가 됐습니다';
  end if;
  raise notice '검증 ③: 진행 중 행사 2개 동시 차단 OK';

  -- ④ is_active 를 끄면 write_mode 도 따라 닫힌다 (기존 코드 경로 호환)
  update events set is_active = false where id = v_id;
  if (select write_mode from events where id = v_id) <> 'closed' then
    raise exception 'is_active=false 인데 write_mode 가 안 따라왔습니다';
  end if;
  update events set is_active = true where id = v_id;
  if (select write_mode from events where id = v_id) <> 'live' then
    raise exception 'is_active=true 인데 write_mode 가 안 따라왔습니다';
  end if;
  raise notice '검증 ④: is_active ↔ write_mode 양방향 동기화 OK';

  -- ⑤ 임역원(authenticated) 권한으로도 값이 나오는가.
  --    앱의 모든 INSERT 가 이 함수로 event_id 를 구한다(Phase 4-3). 여기서 NULL 이
  --    나오면 **임역원의 명단 입력이 통째로 막힌다** — 화면에는 "행사가 없습니다"만
  --    뜨고 원인은 안 보인다. SECURITY DEFINER 라 events 읽기 정책과 무관해야 한다.
  set local role authenticated;
  if public.writable_event_id() is null then
    reset role;
    raise exception 'authenticated 권한에서 writable_event_id() 가 NULL 입니다 — 임역원 입력이 막힙니다';
  end if;
  reset role;
  raise notice '검증 ⑤: 임역원 권한에서도 쓰기 행사 조회 OK';

  -- ⑥ 백업 적재 경로. load-backup.py 는 replica 모드로 넣고, 백업에는 write_mode 가
  --    없다(컬럼이 생기기 전에 뜬 스냅샷). 동기화가 안 걸리면 is_active=true 인데
  --    write_mode='closed' 인 행사가 생기고 — 화면엔 정상인데 **모든 쓰기가 막힌다.**
  --    실제로 이 상태를 만들어 재현했다. 여기서 매번 확인한다.
  -- 활성 행사는 하나뿐이라, 복원 상황을 재현하려면 현재 것을 먼저 내려야 한다
  -- (이 블록은 끝에서 통째로 롤백된다).
  update events set is_active = false where id = v_id;
  set local session_replication_role = replica;
  insert into events (name, starts_on, ends_on, is_active)
  values ('__검증_백업복원', current_date, current_date, true)
  returning id into v_restored;
  if (select write_mode from events where id = v_restored) <> 'live' then
    reset session_replication_role;
    raise exception
      '백업 적재 경로에서 write_mode 가 안 따라왔습니다 — 복원 후 아무것도 못 씁니다 (동기화 트리거가 ALWAYS 인지 확인)';
  end if;
  reset session_replication_role;
  raise notice '검증 ⑥: 백업 적재(replica 모드)에서도 write_mode 동기화 OK';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

-- ⚠️ 앞으로 쓰는 모든 마이그레이션 끝에 붙일 것 (§8-G).
-- backfill 이 트리거를 끄고 안 켜면 방어선이 통째로 사라진다.
do $$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'events' and t.tgname = 'trg_events_sync_active'
       and t.tgenabled = 'A'
  ) then
    raise exception
      'trg_events_sync_active 가 ENABLE ALWAYS 가 아닙니다 — 백업 복원 시 모든 쓰기가 막힙니다';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'registrations' and t.tgname = 'trg_reg_000_derive'
       and t.tgenabled = 'A'
  ) then
    raise exception 'trg_reg_000_derive 가 ENABLE ALWAYS 가 아닙니다';
  end if;
end $$;
