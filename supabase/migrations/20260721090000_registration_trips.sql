-- ============================================================
-- Phase 3-C (1/2) — 신청도 상·하행 대칭으로
-- ============================================================
-- 지금까지 신청은 비대칭이었다:
--   상행 = departure_slot_id (운행편 FK)   ← 어느 편인지 고를 수 있다
--   하행 = uses_return_bus (불린)          ← 탄다/안 탄다뿐, 편 개념이 없다
-- 그래서 3-B 로 하행을 여러 편으로 나눌 수 있게 만들어도 **신청자가 편을 고를 수 없고**
-- 배차가 섞어버린다. 이 파일이 그 마지막 비대칭을 없앤다.
--
-- ## attendance_type 은 파생값이 된다
-- 실측: 활성 행사 599건에서 (상행 있음, 하행 있음) 조합이 attendance_type 과
-- **100% 일치**한다(위반 0건). 즉 지금도 이미 파생값인데 입력으로 받고 있었다.
--   둘 다 → roundtrip / 정확히 하나 → oneway / 둘 다 없음 → self
-- 파생으로 바꾸면 CHECK 3종이 강제하던 정합성이 구조적으로 보장된다.
--
-- ## 왜 양방향 파생인가 (핵심 설계)
-- 컬럼을 새로 만들고 CHECK 를 걸면 "DB 먼저 → 코드 나중" 구간에서 구버전 앱의
-- 신규 신청이 전부 막힌다(NOT VALID 로 걸어도 신규 INSERT 는 즉시 검사된다 — 실측).
-- 그래서 트리거가 **양쪽을 서로 채운다**:
--   · 구버전이 (departure_slot_id, uses_return_bus) 를 보내면 → up/down_trip_id 를 만든다
--   · 신버전이 (up_trip_id, down_trip_id) 를 보내면      → 옛 컬럼을 만든다
-- 덕분에 DB 를 먼저 올려도 구버전 앱이 그대로 돌고, 코드 배포 뒤에도 옛 컬럼이 유지돼
-- **앱만 되돌리는 롤백**이 가능하다. 옛 컬럼 제거는 안정화 후 별도로.
--
-- ## 트리거 이름이 왜 trg_reg_000_derive 인가
-- BEFORE 트리거는 이름 알파벳순으로 실행된다. trg_reg_00_fare(apply_event_fare)가
-- attendance_type 을 읽어 요금을 계산하므로, 파생은 **그보다 먼저** 서야 한다.
-- '0'(0x30) < '_'(0x5F) 이라 trg_reg_000_* 가 trg_reg_00_* 앞에 온다 — 실측으로 확인했다.
-- 실행 순서: trg_guard_attendance → **trg_reg_000_derive** → trg_reg_00_fare
--            → trg_reg_01_cancel → trg_reg_audit(최종값으로 기록) → …
--
-- 되돌리기:
--   drop trigger trg_reg_000_derive on public.registrations;
--   drop function public.derive_registration_trips();
--   alter table public.registrations drop column up_trip_id, drop column down_trip_id;
--   (옛 컬럼은 계속 살아 있으므로 앱 롤백만으로 복구된다)
-- ============================================================

-- ── 1. 컬럼 추가 ────────────────────────────────────────────
alter table public.registrations
  add column if not exists up_trip_id   smallint,
  add column if not exists down_trip_id smallint;

alter table public.registrations drop constraint if exists registrations_up_trip_id_fkey;
alter table public.registrations
  add constraint registrations_up_trip_id_fkey
  foreign key (up_trip_id) references public.event_trips(id);

alter table public.registrations drop constraint if exists registrations_down_trip_id_fkey;
alter table public.registrations
  add constraint registrations_down_trip_id_fkey
  foreign key (down_trip_id) references public.event_trips(id);

create index if not exists idx_reg_up_trip   on public.registrations(up_trip_id);
create index if not exists idx_reg_down_trip on public.registrations(down_trip_id);

comment on column public.registrations.up_trip_id is
  '신청한 상행 편. NULL = 상행을 이용하지 않음. (옛 departure_slot_id 와 같은 값을 가리킨다)';
comment on column public.registrations.down_trip_id is
  '신청한 하행 편. NULL = 하행을 이용하지 않음. (옛 uses_return_bus 를 대체한다)';

-- ── 2. 양방향 파생 트리거 ───────────────────────────────────
create or replace function public.derive_registration_trips()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new_side boolean;   -- 신버전 컬럼이 이번 문장의 진실원인가
  v_down     smallint;
  v_ndown    int;
begin
  -- 어느 쪽이 이번에 지정됐는지 판정한다.
  if tg_op = 'INSERT' then
    v_new_side := new.up_trip_id is not null or new.down_trip_id is not null;
  else
    -- UPDATE: 실제로 바뀐 쪽이 진실원. 둘 다 안 바뀌었으면 아무것도 안 한다.
    if new.up_trip_id is distinct from old.up_trip_id
       or new.down_trip_id is distinct from old.down_trip_id then
      v_new_side := true;
    elsif new.departure_slot_id is distinct from old.departure_slot_id
       or new.uses_return_bus  is distinct from old.uses_return_bus then
      v_new_side := false;
    else
      -- 참여 관련 필드가 안 바뀐 UPDATE(납부·비고·출석 등) — attendance_type 만 맞춰둔다.
      new.attendance_type := derive_attendance(new.up_trip_id, new.down_trip_id);
      return new;
    end if;
  end if;

  if v_new_side then
    -- 신버전 → 옛 컬럼을 만든다.
    new.departure_slot_id := new.up_trip_id;
    new.uses_return_bus   := new.down_trip_id is not null;
  else
    -- 구버전 → 신버전 컬럼을 만든다.
    new.up_trip_id := new.departure_slot_id;

    if new.uses_return_bus then
      -- 구버전은 "탄다"만 말할 수 있다. **어느 편인지는 말하지 못한다.**
      -- 그러니 이미 정해져 있는 편이 있으면 그게 답이다 — 건드리지 않는다.
      -- (이 보존이 없으면 구버전 앱이 납부 상태 하나만 바꿔도 6시 편 신청자가
      --  3시 편으로 갈아끼워지거나, 하행이 2편 이상일 때 저장이 통째로 막혔다.)
      if new.down_trip_id is null then
        -- 처음 정하는 경우에만 우리가 고른다. 활성 하행 편이 하나뿐이면 그것으로,
        -- 여러 개면 고를 수 없으므로 거부한다 (조용히 아무 편이나 꽂으면 사람이
        -- 모르는 사이에 엉뚱한 시각에 배차된다).
        select count(*), min(id) into v_ndown, v_down
          from event_trips
         where event_id = new.event_id and direction = 'down' and active;

        if v_ndown = 0 then
          raise exception '이 행사에 하행 운행편이 없습니다. 편성에서 먼저 만들어 주세요.'
            using errcode = 'check_violation';
        elsif v_ndown > 1 then
          raise exception
            '하행 편이 %개라 "탑승 여부"만으로는 정할 수 없습니다. 어느 편인지 지정해 주세요.',
            v_ndown using errcode = 'check_violation';
        end if;
        new.down_trip_id := v_down;
      end if;
    else
      new.down_trip_id := null;
    end if;
  end if;

  new.attendance_type := derive_attendance(new.up_trip_id, new.down_trip_id);
  return new;
end $$;

create or replace function public.derive_attendance(p_up smallint, p_down smallint)
returns attendance_type language sql immutable as $$
  select case
    when p_up is not null and p_down is not null then 'roundtrip'
    when p_up is null     and p_down is null     then 'self'
    else 'oneway'
  end::attendance_type
$$;

comment on function public.derive_attendance is
  'attendance_type 은 (상행 편, 하행 편) 조합으로 완전히 결정된다. 실측: 기존 599건과 100% 일치.';

-- ── 3. backfill ─────────────────────────────────────────────
-- 감사 트리거를 끄고 채운다. 새 컬럼을 채우는 건 업무 변경이 아니므로 이력에 남기지 않는다
-- (Phase 1 에서 이걸 빠뜨려 유령 이력 599건이 쌓였다).
do $$
declare
  v_up int; v_dn int; v_self int; v_audit_before int; v_audit_after int;
begin
  select count(*) into v_audit_before from registration_audit;

  alter table public.registrations disable trigger user;

  -- 상행: 옛 컬럼이 곧 편 id 다(3-A 의 rename 으로 같은 테이블을 가리킨다).
  update public.registrations set up_trip_id = departure_slot_id
   where departure_slot_id is not null and up_trip_id is null;

  -- 하행: 행사별 하행 편으로. 여러 편이면 이 시점엔 아직 하나뿐이라 안전하다
  -- (3-B 로 편을 나눌 수 있게 됐지만, 나눈 상태로 이 마이그레이션을 처음 돌릴 일은 없다.
  --  혹시 여러 편이면 아래 검증이 잡는다).
  update public.registrations r
     set down_trip_id = t.id
    from public.event_trips t
   where t.event_id = r.event_id and t.direction = 'down'
     and r.uses_return_bus and r.down_trip_id is null;

  update public.registrations
     set attendance_type = derive_attendance(up_trip_id, down_trip_id)
   where attendance_type is distinct from derive_attendance(up_trip_id, down_trip_id);

  alter table public.registrations enable trigger user;
  -- ⚠️ `enable trigger user` 는 **모든** 사용자 트리거를 ORIGIN 으로 되돌린다.
  --    아래에서 trg_reg_000_derive 를 ALWAYS 로 세워도, 이 블록이 나중에 다시 돌면
  --    조용히 ORIGIN 으로 내려간다(실측: 재적재가 CHECK 위반으로 실패했다).
  --    그래서 여기서 즉시 복구한다. 트리거가 아직 없을 수도 있으므로 존재 검사.
  if exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where c.relname = 'registrations' and t.tgname = 'trg_reg_000_derive') then
    alter table public.registrations enable always trigger trg_reg_000_derive;
  end if;

  select count(*) into v_audit_after from registration_audit;
  if v_audit_after <> v_audit_before then
    raise exception 'backfill 이 감사 이력을 %건 늘렸습니다 — 트리거가 안 꺼졌습니다',
      v_audit_after - v_audit_before;
  end if;

  select count(*) filter (where up_trip_id is not null),
         count(*) filter (where down_trip_id is not null),
         count(*) filter (where up_trip_id is null and down_trip_id is null)
    into v_up, v_dn, v_self
    from public.registrations where event_id = active_event_id();
  raise notice 'backfill: 상행 %건 / 하행 %건 / 미이용 %건', v_up, v_dn, v_self;
end $$;

-- ── 4. 정합성 검증 + CHECK 재작성 ───────────────────────────
do $$
declare v_bad int;
begin
  -- 옛 컬럼과 새 컬럼이 같은 것을 말하는가
  select count(*) into v_bad from public.registrations
   where up_trip_id is distinct from departure_slot_id
      or uses_return_bus <> (down_trip_id is not null);
  if v_bad > 0 then
    raise exception '옛 컬럼과 새 컬럼이 어긋난 행 %건', v_bad;
  end if;

  -- 편이 실제로 그 행사의, 그 방향의 편인가
  select count(*) into v_bad
    from public.registrations r
    left join event_trips u on u.id = r.up_trip_id
    left join event_trips d on d.id = r.down_trip_id
   where (r.up_trip_id   is not null and (u.event_id <> r.event_id or u.direction <> 'up'))
      or (r.down_trip_id is not null and (d.event_id <> r.event_id or d.direction <> 'down'));
  if v_bad > 0 then
    raise exception '행사·방향이 어긋난 신청-운행편 연결 %건', v_bad;
  end if;

  raise notice '정합성 검증 통과';
end $$;

-- 옛 CHECK 3종을 파생 기준 하나로 대체한다.
-- 파생 트리거가 attendance_type 을 만들므로 "조합과 어긋난 값"은 구조적으로 생길 수 없지만,
-- 트리거를 끄고 넣는 경로(backfill 등)를 위해 제약으로도 못 박는다.
alter table public.registrations drop constraint if exists chk_roundtrip;
alter table public.registrations drop constraint if exists chk_oneway;
alter table public.registrations drop constraint if exists chk_self;

-- ⚠️ CHECK 안에서 derive_attendance() 를 부르지 않는다.
--    그 함수는 IMMUTABLE 로 선언돼 있지만 본문에 text→enum 캐스트가 있어 엄밀히는
--    immutable 이 아니다(enum_in 은 stable). PostgreSQL 이 지금은 통과시키지만,
--    제약 안에서 비-immutable 함수를 쓰는 건 정의상 위험하다.
--    같은 규칙을 enum 리터럴 비교로 인라인하면 런타임 캐스트가 아예 없어진다
--    (리터럴은 파싱 시점에 enum 으로 굳는다).
alter table public.registrations drop constraint if exists chk_attendance_derived;
alter table public.registrations
  add constraint chk_attendance_derived
  check (
       (attendance_type = 'roundtrip' and up_trip_id is not null and down_trip_id is not null)
    or (attendance_type = 'self'      and up_trip_id is null     and down_trip_id is null)
    or (attendance_type = 'oneway'    and (up_trip_id is null) <> (down_trip_id is null))
  );

-- 옛 컬럼이 살아 있는 동안은 두 표현이 같아야 한다(전환기 안전장치).
alter table public.registrations drop constraint if exists chk_trip_legacy_sync;
alter table public.registrations
  add constraint chk_trip_legacy_sync
  check (up_trip_id is not distinct from departure_slot_id
         and uses_return_bus = (down_trip_id is not null));

-- attendance_type 에 기본값을 준다. 파생 트리거가 어차피 덮어쓰므로 값은 아무거나
-- 되지만, DEFAULT 가 없으면 신버전 앱이 INSERT 할 때 쓰지도 않는 값을 억지로
-- 보내야 한다(파생값을 입력으로 요구하는 셈).
alter table public.registrations alter column attendance_type set default 'self';

-- ── 5. 트리거 부착 ──────────────────────────────────────────
-- 이름이 trg_reg_00_fare 보다 앞서야 요금이 파생된 attendance_type 으로 계산된다.
drop trigger if exists trg_reg_000_derive on public.registrations;
create trigger trg_reg_000_derive
  before insert or update on public.registrations
  for each row execute function public.derive_registration_trips();

-- ⚠️ ENABLE ALWAYS 인 이유 — 이걸 빼면 백업 적재가 통째로 실패한다.
--    load-backup.py 는 session_replication_role = replica 로 트리거를 끄고 넣는다
--    (감사 트리거가 599건의 유령 이력을 쌓는 걸 막으려고).
--    그런데 이 트리거는 **업무 로직이 아니라 파생 컬럼을 채우는 구조 유지 장치**라,
--    꺼지면 up/down_trip_id 가 NULL 인 채로 들어가고 chk_attendance_derived 에 걸린다.
--    실측으로 확인했다 — 재현 절차가 "신청 0건"으로 끝났다.
--    ENABLE ALWAYS 는 replica 모드에서도 이 트리거만 계속 돌게 한다(감사 트리거는 그대로 꺼진다).
alter table public.registrations enable always trigger trg_reg_000_derive;

-- ── 6. 자체검증 — 실제로 넣어보고 롤백 ──────────────────────
do $$
declare
  v_slot  smallint;
  v_down  smallint;
  v_down2 smallint;
  v_id    uuid;
  v_row   record;
begin
  select id into v_slot from event_trips
   where event_id = active_event_id() and direction = 'up' and active order by display_order limit 1;
  select id into v_down from event_trips
   where event_id = active_event_id() and direction = 'down' and active limit 1;

  -- ① 구버전 방식 INSERT (옛 컬럼만) → 새 컬럼이 채워져야 한다
  insert into registrations (campus_id, student_id, name, attendance_type,
                             departure_slot_id, uses_return_bus)
  values ((select id from campuses limit 1), '00', '__검증_구버전', 'roundtrip', v_slot, true)
  returning id into v_id;
  select * into v_row from registrations where id = v_id;
  if v_row.up_trip_id is distinct from v_slot or v_row.down_trip_id is distinct from v_down then
    raise exception '구버전 INSERT 에서 새 컬럼이 안 채워졌습니다 (up=% down=%)',
      v_row.up_trip_id, v_row.down_trip_id;
  end if;
  raise notice '검증 ①: 구버전 방식 INSERT → 새 컬럼 자동 생성 OK';

  -- ② 신버전 방식 INSERT (새 컬럼만) → 옛 컬럼 + attendance_type 이 채워져야 한다
  insert into registrations (campus_id, student_id, name, up_trip_id, down_trip_id)
  values ((select id from campuses limit 1), '00', '__검증_신버전', v_slot, null)
  returning id into v_id;
  select * into v_row from registrations where id = v_id;
  if v_row.departure_slot_id is distinct from v_slot
     or v_row.uses_return_bus <> false
     or v_row.attendance_type <> 'oneway' then
    raise exception '신버전 INSERT 에서 옛 컬럼·참여형태가 안 맞습니다 (slot=% ret=% type=%)',
      v_row.departure_slot_id, v_row.uses_return_bus, v_row.attendance_type;
  end if;
  raise notice '검증 ②: 신버전 방식 INSERT → 옛 컬럼·참여형태 자동 생성 OK';

  -- ③ 참여형태를 손으로 틀리게 넣어도 파생이 이긴다
  update registrations set attendance_type = 'self' where id = v_id;
  select * into v_row from registrations where id = v_id;
  if v_row.attendance_type <> 'oneway' then
    raise exception '파생이 수동 값에 밀렸습니다 (type=%)', v_row.attendance_type;
  end if;
  raise notice '검증 ③: 손으로 넣은 참여형태를 파생이 덮어씀 OK';

  -- ④ 하행이 2편일 때, 구버전 경로가 이미 정해진 하행 편을 건드리지 않는다.
  --    예전 코드는 여기서 (a) 편을 갈아끼우거나 (b) "정할 수 없다"며 저장을 통째로
  --    막았다. 구버전 앱은 "탄다"만 말할 수 있을 뿐 편을 바꾸라고 한 적이 없다.
  insert into event_trips (key, label, display_order, active, event_id, direction)
  values ('__verify_down2', '__검증_하행2편', 900, true, active_event_id(), 'down')
  returning id into v_down2;

  insert into registrations (campus_id, student_id, name, up_trip_id, down_trip_id)
  values ((select id from campuses limit 1), '00', '__검증_하행보존', null, v_down2)
  returning id into v_id;

  -- 구버전 앱이 상행만 지정 (옛 컬럼 경로). uses_return_bus 는 true 그대로다.
  update registrations set departure_slot_id = v_slot where id = v_id;
  select * into v_row from registrations where id = v_id;
  if v_row.down_trip_id is distinct from v_down2 then
    raise exception '구버전 경로가 하행 편을 바꿔치웠습니다 (기대 % → 실제 %)',
      v_down2, v_row.down_trip_id;
  end if;
  if v_row.up_trip_id is distinct from v_slot then
    raise exception '구버전 경로가 상행 편을 못 채웠습니다 (up=%)', v_row.up_trip_id;
  end if;
  raise notice '검증 ④: 하행 2편에서 구버전 경로가 기존 하행 편 보존 OK';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 행은 롤백됨)';
  else
    raise;
  end if;
end $$;
