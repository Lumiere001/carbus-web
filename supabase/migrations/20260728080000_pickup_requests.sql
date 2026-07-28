-- ============================================================
-- 수송 요청 + 참여기간 (§11-C 의 D)
-- ============================================================
-- 사용자 피드백의 실제 모양:
--   부분참자가 "며칠부터 며칠까지 참석하고, 언제 어디로 데리러 와 달라"고 말한다.
--   지금은 그 두 가지가 **전부 비고에 글로** 적힌다. 그래서
--   ① 누가 언제까지 있는지 세려면 비고를 사람이 읽어야 하고
--   ② "화요일 저녁에 역으로 몇 명 나가야 하나"를 아무도 한눈에 못 본다.
--
-- ⚠️ 동규님 지시 (2026-07-28): **픽업 장소에 특정 지명을 박지 말 것.**
--    "이번에는 평창역이지만 앞으로는 픽업 장소가 달라질 수 있다."
--    → `place` 는 **자유 입력 텍스트**다. 장소 마스터 테이블을 만들지 않는다.
--      표기 통일은 같은 행사에서 이미 쓰인 값을 자동완성으로 보여주는 것으로 한다
--      (행사마다 달라지는 것에 마스터를 두면 관리 부담만 늘어난다).
--
-- 왜 `pickup_at` 이 NULL 을 허용하나: 실제로 "가긴 가는데 시각은 아직 모른다"가
-- 가장 흔한 상태다. 시각을 강제로 받으면 아무 값이나 찍히고, 그러면 "미정"이
-- 데이터에서 사라져 **할 일이 안 보이게 된다.** NULL 을 그대로 두고 화면에서
-- "시각 미정" 묶음으로 모은다 — 그 묶음이 곧 다음에 물어봐야 할 사람들의 명단이다.
-- ============================================================

-- ── 1. 참여기간 ─────────────────────────────────────────────
-- 부분참이 "며칠부터 며칠까지"인지. 지금은 비고에 글로 적힌다.
alter table public.registrations add column if not exists attend_from date;
alter table public.registrations add column if not exists attend_to   date;

comment on column public.registrations.attend_from is
  '참여 시작일. NULL = 행사 전체 참석(기본). 부분참만 채운다.';
comment on column public.registrations.attend_to is
  '참여 종료일. NULL = 행사 끝까지.';

-- 거꾸로 된 기간만 막는다. **행사 기간 밖인지는 막지 않는다** — 행사 날짜가
-- 나중에 바뀌면 이미 들어간 값이 통째로 제약 위반이 돼 저장이 전부 막힌다.
-- 그건 화면에서 경고로 알린다.
alter table public.registrations drop constraint if exists chk_attend_range;
alter table public.registrations
  add constraint chk_attend_range
  check (attend_from is null or attend_to is null or attend_from <= attend_to);

-- ── 2. 수송 요청 ────────────────────────────────────────────
create table if not exists public.pickup_requests (
  id              bigint generated always as identity primary key,
  event_id        uuid not null references public.events(id),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  -- 데리러 가는 시각. NULL = "시각 미정" (보드에서 따로 모인다)
  pickup_at       timestamptz,
  -- 자유 입력. 지명을 코드에 박지 않는다 (동규님 지시).
  place           text,
  direction       text not null check (direction in ('up', 'down')),
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.pickup_requests is
  '개인 수송 요청. (날짜·시각·장소) 로 묶으면 그대로 간사 차량 배차표가 된다.
   place 는 자유 입력이다 — 픽업 장소는 행사마다 달라지므로 마스터 테이블을 두지 않는다.';

-- 한 사람이 방향마다 하나씩만 쓰도록 **막지 않는다.** 부분참은 중간에 합류하고
-- 중간에 빠지는 일이 실제로 있어서(참여기간 컬럼을 두는 이유가 그것이다),
-- 유니크를 걸면 표현 자체가 막힌다. 나중에 조일 수는 있어도, 운영 중에
-- "적을 수가 없는" 상황은 되돌릴 방법이 없다.
create index if not exists idx_pickup_requests_event on public.pickup_requests (event_id);
create index if not exists idx_pickup_requests_reg   on public.pickup_requests (registration_id);
-- 보드가 (시각, 장소) 순으로 읽는다. 시각 미정(NULL)이 먼저 오게 둔다 — 할 일이 위로.
create index if not exists idx_pickup_requests_board
  on public.pickup_requests (event_id, pickup_at nulls first);

-- ── 3. 권한 ─────────────────────────────────────────────────
alter table public.pickup_requests enable row level security;

drop policy if exists pickup_requests_select on public.pickup_requests;
create policy pickup_requests_select on public.pickup_requests for select
  using (
    exists (select 1 from public.registrations r
             where r.id = registration_id
               and (public.current_role() in ('master', 'viewer')
                    or r.campus_id = public.current_campus()))
  );

drop policy if exists pickup_requests_write on public.pickup_requests;
create policy pickup_requests_write on public.pickup_requests for all
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

-- ── 4. 행사 범위 3종 세트 (§10-C 6) ─────────────────────────
-- 새 테이블을 만들 때 이걸 빠뜨리면 그 테이블만 행사 폴더화 밖에 남는다.
drop policy if exists pickup_requests_event_scope on public.pickup_requests;
create policy pickup_requests_event_scope on public.pickup_requests as restrictive for all
  using (event_id = (select public.viewing_event_id()))
  with check ((select public.is_event_writable(event_id)));

drop policy if exists pickup_requests_event_delete on public.pickup_requests;
create policy pickup_requests_event_delete on public.pickup_requests as restrictive for delete
  using ((select public.is_event_writable(event_id)));

drop trigger if exists trg_pickup_requests_event_writable on public.pickup_requests;
create trigger trg_pickup_requests_event_writable
  before insert or update or delete on public.pickup_requests
  for each row execute function public.guard_event_writable();
alter table public.pickup_requests enable always trigger trg_pickup_requests_event_writable;

-- 신청과 같은 행사여야 한다 (교차 행사 참조 차단).
create or replace function public.guard_pickup_request_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from registrations r
                  where r.id = new.registration_id and r.event_id = new.event_id) then
    raise exception '수송 요청이 다른 행사의 신청을 가리킵니다.'
      using errcode = 'foreign_key_violation';
  end if;
  -- 앞뒤 공백만 남은 장소는 없는 것으로. 자유 입력이라 이걸 안 하면
  -- "  " 과 NULL 이 다른 묶음이 돼 보드가 쪼개진다.
  new.place := nullif(btrim(coalesce(new.place, '')), '');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_pickup_requests_scope on public.pickup_requests;
create trigger trg_pickup_requests_scope
  before insert or update on public.pickup_requests
  for each row execute function public.guard_pickup_request_scope();
alter table public.pickup_requests enable always trigger trg_pickup_requests_scope;

-- ── 5. 보드용 뷰 ────────────────────────────────────────────
-- 화면이 조인을 반복하지 않게. 묶음 키((날짜, 시각, 장소))를 DB 에서 만들어 두면
-- 화면과 CSV 가 같은 기준으로 묶는다.
drop view if exists public.v_pickup_board;
create view public.v_pickup_board with (security_invoker = on) as
select
  p.id,
  p.event_id,
  p.registration_id,
  p.direction,
  p.pickup_at,
  p.place,
  p.note,
  p.created_at,
  -- KST 로 끊는다. 이 서비스의 모든 시각 표현이 KST 다(운영 규칙).
  (p.pickup_at at time zone 'Asia/Seoul')::date as pickup_date,
  to_char(p.pickup_at at time zone 'Asia/Seoul', 'HH24:MI') as pickup_time,
  r.name        as person_name,
  r.student_id,
  r.campus_id,
  c.name        as campus_name,
  r.attend_from,
  r.attend_to,
  r.participation_status
from public.pickup_requests p
join public.registrations r on r.id = p.registration_id
left join public.campuses c on c.id = r.campus_id;

comment on view public.v_pickup_board is
  '수송 요청 보드. (pickup_date, pickup_time, place) 로 묶으면 간사 차량 배차표가 된다.
   pickup_at 이 NULL 인 행은 "시각 미정" — 다음에 물어봐야 할 사람들이다.';

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_event uuid := public.active_event_id();
  v_reg   uuid;
  v_other uuid;
  v_id    bigint;
  v_ok    boolean;
  v_date  date;
begin
  select id into v_reg from registrations where event_id = v_event limit 1;
  if v_reg is null then
    raise notice '  (신청 데이터가 없어 검증 건너뜀)';
    return;
  end if;

  -- ① 시각·장소 없이도 들어간다 ("가긴 가는데 아직 모른다"가 가장 흔한 상태다)
  insert into pickup_requests (event_id, registration_id, direction)
  values (v_event, v_reg, 'up') returning id into v_id;
  if (select pickup_at from v_pickup_board where id = v_id) is not null then
    raise exception '검증 실패: 시각 미정이 아닌 값이 들어갔습니다';
  end if;
  raise notice '검증 ①: 시각·장소 미정으로 등록 OK (보드의 "시각 미정" 묶음)';

  -- ② 공백만 있는 장소는 NULL 로 접힌다 (보드 묶음이 쪼개지지 않게)
  update pickup_requests set place = '   ' where id = v_id;
  if (select place from pickup_requests where id = v_id) is not null then
    raise exception '검증 실패: 공백 장소가 그대로 남았습니다';
  end if;
  raise notice '검증 ②: 공백 장소 → NULL OK';

  -- ③ 시각을 넣으면 보드가 KST 날짜·시각으로 끊는다
  update pickup_requests
     set pickup_at = timestamptz '2026-08-11 23:30+09', place = '어딘가 역'
   where id = v_id;
  select pickup_date into v_date from v_pickup_board where id = v_id;
  if v_date <> date '2026-08-11' then
    raise exception '검증 실패: KST 날짜가 % 입니다 (2026-08-11 예상)', v_date;
  end if;
  if (select pickup_time from v_pickup_board where id = v_id) <> '23:30' then
    raise exception '검증 실패: KST 시각이 안 맞습니다';
  end if;
  raise notice '검증 ③: KST 날짜·시각 분해 OK (자정 근처에서도 날짜가 안 밀린다)';

  -- ④ 같은 사람이 방향마다, 또 여러 건 쓸 수 있다 (중간 합류·중간 이탈)
  insert into pickup_requests (event_id, registration_id, direction, place)
  values (v_event, v_reg, 'up', '두 번째 요청');
  raise notice '검증 ④: 같은 사람·같은 방향 추가 등록 OK (유니크로 막지 않는다)';

  -- ⑤ 다른 행사의 신청을 가리키면 거부
  select id into v_other from events where id <> v_event limit 1;
  if v_other is not null then
    v_ok := false;
    begin
      insert into pickup_requests (event_id, registration_id, direction)
      values (v_other, v_reg, 'up');
    exception when others then v_ok := true;
    end;
    if not v_ok then raise exception '검증 실패: 교차 행사 참조가 통과했습니다'; end if;
    raise notice '검증 ⑤: 교차 행사 참조 → 거부 OK';
  else
    raise notice '검증 ⑤: (행사가 하나뿐이라 교차 참조 검증 건너뜀)';
  end if;

  -- ⑥ 거꾸로 된 참여기간은 거부
  v_ok := false;
  begin
    update registrations
       set attend_from = date '2026-08-14', attend_to = date '2026-08-11'
     where id = v_reg;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception '검증 실패: 끝나는 날이 시작보다 빠른데 들어갔습니다'; end if;
  raise notice '검증 ⑥: 거꾸로 된 참여기간 → 거부 OK';

  -- ⑦ 정상 참여기간은 들어가고 보드에서 같이 읽힌다
  update registrations
     set attend_from = date '2026-08-11', attend_to = date '2026-08-13'
   where id = v_reg;
  if (select attend_to from v_pickup_board where id = v_id) <> date '2026-08-13' then
    raise exception '검증 실패: 보드가 참여기간을 못 읽습니다';
  end if;
  raise notice '검증 ⑦: 참여기간 저장 + 보드 노출 OK';

  raise exception '__검증완료_롤백';
exception when others then
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
     where c.relname = 'pickup_requests'
       and t.tgname = 'trg_pickup_requests_event_writable' and t.tgenabled = 'A'
  ) then
    raise exception '수송 요청 쓰기 가드가 ENABLE ALWAYS 가 아닙니다';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'pickup_requests'
       and t.tgname = 'trg_pickup_requests_scope' and t.tgenabled = 'A'
  ) then
    raise exception '수송 요청 행사 가드가 ENABLE ALWAYS 가 아닙니다';
  end if;
  raise notice 'security_invoker · 쓰기 가드 확인';
end $$;
