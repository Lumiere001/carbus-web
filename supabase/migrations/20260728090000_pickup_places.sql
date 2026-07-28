-- ============================================================
-- 픽업 장소는 총단이 행사마다 정하고, 나머지는 고르기만 한다
-- ============================================================
-- 동규님 지시 (2026-07-28, 점검 후):
--   "픽업 장소는 임역원이 입력하는 게 아니라 master 가 행사마다 지정할 수 있게
--    되어 있어서 학생들이 거기로 직접 와야 해. 관리자가 먼저 픽업 장소를 선택하고
--    이후에 학생들이 관리자가 만들어 놓은 선택지에서 고르도록."
--
-- 직전 구현은 `place` 를 **자유 입력 텍스트**로 뒀다. 그러면 적는 사람마다
-- "평창역" / "평창 역" / "평창역앞" 이 되고, 무엇보다 **차가 실제로 가지 않는 곳을
-- 적을 수 있다.** 픽업은 총단이 차를 보내는 일이라, 갈 수 있는 곳의 목록은
-- 총단만 안다.
--
-- ⚠️ 원래 원칙은 그대로다 — **코드에는 여전히 지명이 없다.**
--    "장소 마스터를 만들지 마라"는 지시의 뜻은 *지명을 코드에 박지 말라*는 것이었고,
--    총단이 행사마다 등록하는 이 방식은 그 원칙을 그대로 지킨다. 행사가 바뀌면
--    장소도 바뀌고, 코드는 아무것도 모른다.
--
-- 운영 `pickup_requests` 는 **0행**이라(점검 데이터도 정리됨) 이관할 것이 없다.
-- 그래서 `place` 텍스트 컬럼을 남기지 않고 지운다 — 두 개를 같이 두면
-- "어느 쪽이 진짜인가"가 생기고, 그 질문은 반드시 나중에 사고가 된다.
-- ============================================================

create table if not exists public.pickup_places (
  id            bigint generated always as identity primary key,
  event_id      uuid not null references public.events(id),
  name          text not null,
  -- 장소 자체에 대한 안내. 예: "정문 쪽 버스정류장", "1번 출구 앞"
  note          text,
  display_order int  not null default 100,
  -- 안 쓰게 된 장소를 지우는 대신 내린다. 이미 그 장소로 잡힌 요청이 있으면
  -- 지울 수 없어야 하기 때문이다(아래 FK).
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (event_id, name)
);

comment on table public.pickup_places is
  '행사별 픽업 장소. 총단이 등록하고 임역원·순장/순원은 고르기만 한다.
   코드에는 지명이 없다 — 행사마다 총단이 채운다.';

create index if not exists idx_pickup_places_event on public.pickup_places (event_id);

-- ── 수송 요청이 이 목록을 가리킨다 ──────────────────────────
alter table public.pickup_requests
  add column if not exists place_id bigint references public.pickup_places(id);

-- 자유 입력 텍스트는 없앤다 (운영 0행, 이관 대상 없음).
-- 보드 뷰가 이 컬럼을 읽고 있으므로 먼저 내린다. 아래에서 새 정의로 다시 만든다.
drop view if exists public.v_pickup_board;
alter table public.pickup_requests drop column if exists place;

comment on column public.pickup_requests.place_id is
  '어느 픽업 장소인가. NULL = 장소 미정 (시각 미정과 같은 뜻으로, 아직 안 정해진 것).';

-- ── 권한: 읽기는 모두, 쓰기는 총단만 ────────────────────────
alter table public.pickup_places enable row level security;

drop policy if exists pickup_places_select on public.pickup_places;
create policy pickup_places_select on public.pickup_places for select
  -- 임역원·순장/순원이 고르려면 목록이 보여야 한다.
  using (public.current_role() is not null);

drop policy if exists pickup_places_write on public.pickup_places;
create policy pickup_places_write on public.pickup_places for all
  using (public.current_role() = 'master')
  with check (public.current_role() = 'master');

-- ── 행사 범위 3종 세트 (§10-C 6) ────────────────────────────
drop policy if exists pickup_places_event_scope on public.pickup_places;
create policy pickup_places_event_scope on public.pickup_places as restrictive for all
  using (event_id = (select public.viewing_event_id()))
  with check ((select public.is_event_writable(event_id)));

drop policy if exists pickup_places_event_delete on public.pickup_places;
create policy pickup_places_event_delete on public.pickup_places as restrictive for delete
  using ((select public.is_event_writable(event_id)));

drop trigger if exists trg_pickup_places_event_writable on public.pickup_places;
create trigger trg_pickup_places_event_writable
  before insert or update or delete on public.pickup_places
  for each row execute function public.guard_event_writable();
alter table public.pickup_places enable always trigger trg_pickup_places_event_writable;

create or replace function public.touch_pickup_place()
returns trigger language plpgsql set search_path = public as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception '픽업 장소 이름을 적어 주세요.' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_pickup_places_touch on public.pickup_places;
create trigger trg_pickup_places_touch
  before insert or update on public.pickup_places
  for each row execute function public.touch_pickup_place();
alter table public.pickup_places enable always trigger trg_pickup_places_touch;

-- ── 수송 요청이 **다른 행사의 장소**를 가리키지 못하게 ──────
-- 신청 쪽 검사만 있고 장소 쪽이 빠지면, 행사 폴더화에 구멍이 하나 남는다.
create or replace function public.guard_pickup_request_scope()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from registrations r
                  where r.id = new.registration_id and r.event_id = new.event_id) then
    raise exception '수송 요청이 다른 행사의 신청을 가리킵니다.'
      using errcode = 'foreign_key_violation';
  end if;
  if new.place_id is not null
     and not exists (select 1 from pickup_places p
                      where p.id = new.place_id and p.event_id = new.event_id) then
    raise exception '수송 요청이 다른 행사의 픽업 장소를 가리킵니다.'
      using errcode = 'foreign_key_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ── 보드 뷰를 장소 목록과 이어 붙인다 ───────────────────────
drop view if exists public.v_pickup_board;
create view public.v_pickup_board with (security_invoker = on) as
select
  p.id,
  p.event_id,
  p.registration_id,
  p.direction,
  p.pickup_at,
  p.place_id,
  pl.name        as place,
  pl.note        as place_note,
  p.note,
  p.created_at,
  (p.pickup_at at time zone 'Asia/Seoul')::date as pickup_date,
  to_char(p.pickup_at at time zone 'Asia/Seoul', 'HH24:MI') as pickup_time,
  r.name         as person_name,
  r.student_id,
  r.campus_id,
  c.name         as campus_name,
  r.attend_from,
  r.attend_to,
  r.participation_status
from public.pickup_requests p
join public.registrations r on r.id = p.registration_id
left join public.pickup_places pl on pl.id = p.place_id
left join public.campuses c on c.id = r.campus_id;

comment on view public.v_pickup_board is
  '수송 요청 보드. (pickup_date, pickup_time, place) 로 묶으면 차량 배차표가 된다.
   place 는 총단이 등록한 목록에서 온다 — 자유 입력이 아니다.';

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_event uuid := public.active_event_id();
  v_reg   uuid;
  v_place bigint;
  v_id    bigint;
  v_ok    boolean;
  v_polq  text;
begin
  select id into v_reg from registrations where event_id = v_event limit 1;
  if v_reg is null then
    raise notice '  (신청 데이터가 없어 검증 건너뜀)';
    return;
  end if;

  -- ① 총단이 장소를 등록한다
  insert into pickup_places (event_id, name, display_order)
  values (v_event, '  검증용 장소  ', 10) returning id into v_place;
  if (select name from pickup_places where id = v_place) <> '검증용 장소' then
    raise exception '검증 실패: 이름 앞뒤 공백이 안 지워졌습니다';
  end if;
  raise notice '검증 ①: 장소 등록 + 이름 공백 정리 OK';

  -- ② 빈 이름은 거부
  v_ok := false;
  begin
    insert into pickup_places (event_id, name) values (v_event, '   ');
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception '검증 실패: 빈 이름이 들어갔습니다'; end if;
  raise notice '검증 ②: 빈 이름 → 거부 OK';

  -- ③ 같은 행사에 같은 이름 두 번은 거부 (표기 갈림 방지의 핵심)
  v_ok := false;
  begin
    insert into pickup_places (event_id, name) values (v_event, '검증용 장소');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception '검증 실패: 같은 이름이 두 번 들어갔습니다'; end if;
  raise notice '검증 ③: 같은 행사 이름 중복 → 거부 OK';

  -- ④ 수송 요청이 그 장소를 가리키고, 보드가 이름을 읽는다
  insert into pickup_requests (event_id, registration_id, direction, place_id, pickup_at)
  values (v_event, v_reg, 'up', v_place, timestamptz '2026-08-11 23:30+09')
  returning id into v_id;
  if (select place from v_pickup_board where id = v_id) <> '검증용 장소' then
    raise exception '검증 실패: 보드가 장소 이름을 못 읽습니다';
  end if;
  raise notice '검증 ④: 수송 요청 → 장소 연결 + 보드 표시 OK';

  -- ⑤ 장소를 안 정해도 등록된다 (시각 미정과 같은 뜻)
  insert into pickup_requests (event_id, registration_id, direction)
  values (v_event, v_reg, 'down');
  raise notice '검증 ⑤: 장소 미정으로도 등록 OK';

  -- ⑥ 쓰기 정책이 총단으로 걸려 있는가 (임역원이 장소를 만들면 안 된다)
  select pg_get_expr(polqual, polrelid) into v_polq
    from pg_policy where polrelid = 'pickup_places'::regclass and polname = 'pickup_places_write';
  if v_polq is null or v_polq not like '%master%' then
    raise exception '검증 실패: 픽업 장소 쓰기 정책이 총단 전용이 아닙니다 (%)', v_polq;
  end if;
  raise notice '검증 ⑥: 쓰기 정책 총단 전용 OK';

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
     where c.relname = 'pickup_places'
       and t.tgname = 'trg_pickup_places_event_writable' and t.tgenabled = 'A'
  ) then
    raise exception '픽업 장소 쓰기 가드가 ENABLE ALWAYS 가 아닙니다';
  end if;
  raise notice 'security_invoker · 쓰기 가드 확인';
end $$;
