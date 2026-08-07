-- ============================================================
-- 수강신청 조사 (동규님 요청, 2026-07-31)
-- ============================================================
-- 동규님: "리더십 캠프에서는 수강신청 조사도 해야 한다. 첫째날·둘째날·셋째날을
--          고르고 시간을 적을 수 있게. 해당 없는 사람은 아무것도 안 고른다.
--          master 화면에서는 요일·시간별로 누가 있는지 몰아서 보여 달라."
--
-- ⚠️ **날짜를 저장하지 않는다.** 동규님이 이유를 짚어 주셨다 —
--    "반복해서 사용할 건데 리더십 캠프 날짜가 계속 변하잖아."
--    그래서 `day_no`(1=첫째날, 2=둘째날 …) 라는 **행사 안에서의 몇째 날**만 적는다.
--    실제 날짜는 행사의 starts_on 에서 계산하면 되고, 행사가 바뀌어도 이 값은 그대로다.
--    날짜를 박아 두면 다음 행사에서 전부 손으로 고쳐야 한다.
--
-- 왜 시간이 NULL 을 허용하나: 수송 요청(`pickup_requests`)에서 배운 것과 같다.
-- "듣긴 듣는데 몇 시인지 아직 모른다" 가 실제로 가장 흔한 중간 상태다. 강제로 받으면
-- 아무 값이나 찍히고, 그러면 **"미정" 이 데이터에서 사라져 할 일이 안 보인다.**
-- NULL 로 두고 보드에서 "시간 미정" 묶음으로 맨 위에 모은다.
--
-- 해당 없는 사람은 **행이 아예 없다.** "안 들음" 을 값으로 저장하지 않는다 —
-- 그러면 전원에게 행을 만들어야 하고, 안 고른 것과 "안 들음" 을 고른 것이 구분되지
-- 않는다. 없으면 없는 것이다.
-- ============================================================

create table if not exists public.course_signups (
  id              bigint generated always as identity primary key,
  event_id        uuid not null references public.events(id),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  -- 행사 안에서 몇째 날인가. 날짜가 아니다(위 주석).
  -- 상한 14 는 "말도 안 되는 값" 만 막는 선이다. 실제로 고를 수 있는 날 수는
  -- 화면이 행사 기간에서 계산한다 — DB 에 박으면 4박 행사에서 저장이 막힌다.
  day_no          smallint not null check (day_no between 1 and 14),
  -- 시간만. 날짜는 안 적는다. NULL = "시간 미정".
  at_time         time,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.course_signups is
  '수강신청 조사. 날짜가 아니라 **행사 안에서 몇째 날**(day_no)을 적는다 —
   행사 날짜는 해마다 바뀌지만 "첫째날" 은 안 바뀐다.
   해당 없는 사람은 행이 없다. at_time 이 NULL 이면 시간 미정.';
comment on column public.course_signups.day_no is
  '1=첫째날, 2=둘째날 … 실제 날짜는 events.starts_on + (day_no - 1) 로 계산한다.';

-- 한 사람이 같은 날에 두 번 신청하는 건 막는다. 그게 대개 실수고,
-- 보드에서 같은 사람이 두 번 세어져 인원이 부풀기 때문이다.
-- (한 날에 여러 강의를 듣는 운영이 생기면 이 제약을 풀면 된다 — 푸는 건 쉽다.)
create unique index if not exists uq_course_signups_reg_day
  on public.course_signups (registration_id, day_no);
create index if not exists idx_course_signups_event on public.course_signups (event_id);
-- 보드가 (날, 시간) 순으로 읽는다. 시간 미정이 먼저 오게 — 할 일이 위로.
create index if not exists idx_course_signups_board
  on public.course_signups (event_id, day_no, at_time nulls first);

-- ── 권한 ────────────────────────────────────────────────────
-- 이동수단·수송 요청과 같다. 임역원은 **자기 캠퍼스 사람만** 쓰고, 총단은 전부.
alter table public.course_signups enable row level security;

drop policy if exists course_signups_select on public.course_signups;
create policy course_signups_select on public.course_signups for select
  using (
    exists (select 1 from public.registrations r
             where r.id = registration_id
               and (public.current_role() in ('master', 'viewer')
                    or r.campus_id = public.current_campus()))
  );

drop policy if exists course_signups_write on public.course_signups;
create policy course_signups_write on public.course_signups for all
  using (
    exists (select 1 from public.registrations r
             where r.id = registration_id
               and (public.current_role() = 'master'
                    or (public.current_role() = 'campus_admin'
                        and r.campus_id = public.current_campus())))
  )
  with check (
    exists (select 1 from public.registrations r
             where r.id = registration_id
               and (public.current_role() = 'master'
                    or (public.current_role() = 'campus_admin'
                        and r.campus_id = public.current_campus())))
  );

-- ── 행사 범위 3종 세트 (§10-C 6) ────────────────────────────
-- 새 테이블을 만들 때 이걸 빠뜨리면 그 테이블만 행사 폴더화 밖에 남는다.
drop policy if exists course_signups_event_scope on public.course_signups;
create policy course_signups_event_scope on public.course_signups as restrictive for all
  using (event_id = (select public.viewing_event_id()))
  with check ((select public.is_event_writable(event_id)));

drop policy if exists course_signups_event_delete on public.course_signups;
create policy course_signups_event_delete on public.course_signups as restrictive for delete
  using ((select public.is_event_writable(event_id)));

drop trigger if exists trg_course_signups_event_writable on public.course_signups;
create trigger trg_course_signups_event_writable
  before insert or update or delete on public.course_signups
  for each row execute function public.guard_event_writable();
alter table public.course_signups enable always trigger trg_course_signups_event_writable;

-- 신청과 같은 행사여야 한다 (교차 행사 참조 차단).
create or replace function public.guard_course_signup_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from registrations r
                  where r.id = new.registration_id and r.event_id = new.event_id) then
    raise exception '수강신청이 다른 행사의 신청을 가리킵니다.'
      using errcode = 'foreign_key_violation';
  end if;
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_course_signups_scope on public.course_signups;
create trigger trg_course_signups_scope
  before insert or update on public.course_signups
  for each row execute function public.guard_course_signup_scope();
alter table public.course_signups enable always trigger trg_course_signups_scope;

-- ── 보드가 읽을 뷰 ──────────────────────────────────────────
-- 화면이 매번 3개 테이블을 조인하지 않게. 취소자는 여기서 걸러 둔다 —
-- 취소한 사람이 수강 명단에 남으면 강의실 인원이 틀린다.
drop view if exists public.v_course_board;
create view public.v_course_board with (security_invoker = on) as
select
  cs.id,
  cs.event_id,
  cs.registration_id,
  cs.day_no,
  cs.at_time,
  cs.note,
  cs.created_at,
  r.name        as person_name,
  r.student_id,
  r.campus_id,
  cp.name       as campus_name,
  cp.display_order as campus_order,
  -- 실제 날짜는 **여기서 계산한다.** 저장하지 않는 이유는 위 주석과 같다 —
  -- 행사 날짜가 바뀌면 이 값도 저절로 따라간다.
  (e.starts_on + (cs.day_no - 1)) as on_date
from public.course_signups cs
join public.registrations r on r.id = cs.registration_id
join public.events e on e.id = cs.event_id
left join public.campuses cp on cp.id = r.campus_id
where r.participation_status <> 'cancelled';

comment on view public.v_course_board is
  '수강신청 보드용. on_date 는 행사 시작일 + (day_no-1) 로 **계산된 값**이다 —
   저장하지 않으므로 행사 날짜를 고치면 저절로 따라간다.';

-- ── 자체검증 ─────────────────────────────────────────────────
-- §25-C 의 교훈대로 앱과 같은 조건(헤더)을 만든다.
do $$
declare
  v_event uuid := public.active_event_id();
  v_reg   uuid;
  v_other uuid;
  v_id    bigint;
  v_ok    boolean;
  v_date  date;
begin
  perform set_config('request.headers',
                     jsonb_build_object('x-carbus-event', v_event::text)::text, true);

  select id into v_reg from registrations
   where event_id = v_event and participation_status <> 'cancelled' limit 1;
  if v_reg is null then
    raise notice '  (신청이 없어 검증 건너뜀)';
    return;
  end if;

  -- ① 날만 적고 시간은 비워 둘 수 있다 ("아직 몇 시인지 모른다")
  insert into course_signups (event_id, registration_id, day_no)
  values (v_event, v_reg, 1) returning id into v_id;
  raise notice '검증 ①: 시간 없이 날만 저장 OK';

  -- ② 같은 사람이 같은 날에 두 번은 안 된다
  v_ok := false;
  begin
    insert into course_signups (event_id, registration_id, day_no, at_time)
    values (v_event, v_reg, 1, '14:00');
  exception when unique_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: 같은 날 중복 신청이 들어갔습니다';
  end if;
  raise notice '검증 ②: 같은 날 중복 차단 OK';

  -- ③ 다른 날은 된다 (한 사람이 여러 날 들을 수 있어야 한다)
  insert into course_signups (event_id, registration_id, day_no, at_time)
  values (v_event, v_reg, 2, '14:00');
  raise notice '검증 ③: 다른 날 추가 OK';

  -- ④ 뷰가 실제 날짜를 계산해 준다
  select on_date into v_date from v_course_board where id = v_id;
  if v_date is distinct from (select starts_on from events where id = v_event) then
    raise exception '검증 실패: 첫째날이 행사 시작일과 다릅니다 (%)', v_date;
  end if;
  raise notice '검증 ④: 첫째날 = 행사 시작일 OK';

  -- ⑤ 말도 안 되는 날은 막는다
  v_ok := false;
  begin
    insert into course_signups (event_id, registration_id, day_no) values (v_event, v_reg, 0);
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then
    raise exception '검증 실패: day_no = 0 이 들어갔습니다';
  end if;
  raise notice '검증 ⑤: 잘못된 날 차단 OK';

  -- ⑥ 취소자는 보드에서 빠진다 (강의실 인원이 틀리면 안 된다)
  update registrations set participation_status = 'cancelled', cancelled_at = now()
   where id = v_reg;
  if exists (select 1 from v_course_board where registration_id = v_reg) then
    raise exception '검증 실패: 취소자가 수강 명단에 남아 있습니다';
  end if;
  raise notice '검증 ⑥: 취소자 제외 OK';

  raise exception '__검증완료_롤백';
exception when others then
  perform set_config('request.headers', '', true);
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;

-- ── security_invoker · 트리거 확인 (§8-G) ───────────────────
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and coalesce(c.reloptions::text, '') not like '%security_invoker=on%';
  if v_bad is not null then
    raise exception 'security_invoker 가 빠진 뷰: %', v_bad;
  end if;

  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'course_signups'
       and t.tgname = 'trg_course_signups_event_writable' and t.tgenabled = 'A'
  ) then
    raise exception '행사 쓰기 가드가 ENABLE ALWAYS 가 아닙니다';
  end if;
  raise notice 'security_invoker · 트리거 확인 OK';
end $$;
