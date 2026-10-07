-- Confirmed planned attendance is separate from actual onsite entry/exit.
-- No existing date-only schedule is converted to an invented time.
alter table public.registrations add column attend_from_at timestamptz;
alter table public.registrations add column attend_to_at timestamptz;
comment on column public.registrations.attend_from_at is '확정한 참여 시작 일시. 실제 현장 입장 시각과 별개. 기존 자료는 NULL 유지.';
comment on column public.registrations.attend_to_at is '확정한 참여 종료 일시. 실제 현장 퇴장 시각과 별개. 기존 자료는 NULL 유지.';

create function public.assert_registration_attendance_plan(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.registrations%rowtype; v_partial boolean; v_required boolean;
begin
  select * into r from public.registrations where id = p_id for update;
  if not found then return; end if;
  v_partial := r.attend_from is not null or r.attend_to is not null;
  if v_partial and (r.attend_from is null or r.attend_to is null) then
    raise exception '부분 참석의 시작일과 종료일을 모두 지정해 주세요.' using errcode = '23514';
  end if;
  if (r.up_trip_id is null and not exists (select 1 from public.transport_legs where registration_id=r.id and direction='up' and mode<>'our_bus'))
     or (r.down_trip_id is null and not exists (select 1 from public.transport_legs where registration_id=r.id and direction='down' and mode<>'our_bus')) then
    raise exception '버스를 이용하지 않는 방향의 이동수단을 선택해 주세요.' using errcode = '23514';
  end if;
  v_required := v_partial or r.up_trip_id is null or r.down_trip_id is null
    or exists (select 1 from public.transport_legs where registration_id=r.id and mode<>'our_bus');
  if v_required or r.attend_from_at is not null or r.attend_to_at is not null then
    if r.attend_from_at is null or r.attend_to_at is null then
      raise exception '참여 시작과 종료의 날짜·시각을 모두 확정해 주세요.' using errcode = '23514';
    end if;
    if not isfinite(r.attend_from_at) or not isfinite(r.attend_to_at) or r.attend_from_at >= r.attend_to_at then
      raise exception '참여 종료 일시는 유효한 시작 일시보다 늦어야 합니다.' using errcode = '23514';
    end if;
    if v_partial and ((r.attend_from_at at time zone 'Asia/Seoul')::date <> r.attend_from
      or (r.attend_to_at at time zone 'Asia/Seoul')::date <> r.attend_to) then
      raise exception '참여 일시의 한국 날짜가 참여 시작일·종료일과 일치해야 합니다.' using errcode = '23514';
    end if;
  end if;
end $$;
revoke all on function public.assert_registration_attendance_plan(uuid) from public, anon, authenticated;

create function public.guard_registration_attendance_plan() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and row(new.attend_from,new.attend_to,new.attend_from_at,new.attend_to_at,new.up_trip_id,new.down_trip_id)
      is not distinct from row(old.attend_from,old.attend_to,old.attend_from_at,old.attend_to_at,old.up_trip_id,old.down_trip_id) then
    return null;
  end if;
  perform public.assert_registration_attendance_plan(new.id);
  return null;
end $$;
revoke all on function public.guard_registration_attendance_plan() from public, anon, authenticated;
-- Registration and its legs are inserted in a single create RPC transaction.
-- Validate the final relation after both exist; unrelated legacy edits remain allowed.
create constraint trigger trg_registration_attendance_plan
  after insert or update on public.registrations deferrable initially deferred
  for each row execute function public.guard_registration_attendance_plan();
alter table public.registrations enable always trigger trg_registration_attendance_plan;

create function public.guard_transport_attendance_plan() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and row(new.registration_id,new.direction,new.mode,new.status,new.via_unit_id)
      is not distinct from row(old.registration_id,old.direction,old.mode,old.status,old.via_unit_id) then
    return null;
  end if;
  if tg_op <> 'INSERT' then
    perform public.assert_registration_attendance_plan(old.registration_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.assert_registration_attendance_plan(new.registration_id);
  end if;
  return null;
end $$;
revoke all on function public.guard_transport_attendance_plan() from public, anon, authenticated;
create constraint trigger trg_transport_attendance_plan
  after insert or update or delete on public.transport_legs deferrable initially deferred
  for each row execute function public.guard_transport_attendance_plan();
alter table public.transport_legs enable always trigger trg_transport_attendance_plan;
create or replace function public.create_registration_complete(p_event_id uuid, p_input jsonb) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_id uuid; v_row jsonb; v_up smallint; v_down smallint; v_role public.user_role := public.current_role();
begin
  if auth.uid() is null or v_role not in ('master', 'campus_admin') or v_role is null then
    raise exception '명단을 추가할 권한이 없습니다' using errcode = '42501';
  end if;
  if p_event_id is distinct from public.viewing_event_id() or not public.is_event_writable(p_event_id) then
    raise exception '보고 있는 행사에 지금 저장할 수 없습니다' using errcode = '42501';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_input) k where k not in
      ('name','student_id','campus_id','up_trip_id','down_trip_id','payment_status','note','attend_from','attend_to','attend_from_at','attend_to_at','legs','pickups','courses')) then
    raise exception '신청 입력이 올바르지 않습니다' using errcode = '22023';
  end if;
  if jsonb_typeof(p_input->'name') is distinct from 'string' or length(trim(p_input->>'name')) = 0
     or jsonb_typeof(p_input->'student_id') is distinct from 'string'
     or jsonb_typeof(p_input->'campus_id') is distinct from 'string'
     or jsonb_typeof(p_input->'legs') is distinct from 'array'
     or jsonb_typeof(p_input->'pickups') is distinct from 'array'
     or jsonb_typeof(p_input->'courses') is distinct from 'array' then
    raise exception '이름·학번·캠퍼스와 부가 정보를 확인해 주세요' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_each(p_input) f
      where f.key in ('name','student_id','campus_id','payment_status','note','attend_from','attend_to','attend_from_at','attend_to_at')
        and jsonb_typeof(f.value) not in ('string','null'))
     or exists(select 1 from jsonb_each(p_input) f where f.key in ('up_trip_id','down_trip_id')
        and jsonb_typeof(f.value) not in ('number','null')) then
    raise exception '신청 필드의 형식을 확인해 주세요' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_input) f where f.key in ('attend_from_at','attend_to_at') and f.value <> 'null'::jsonb
    and (jsonb_typeof(f.value) <> 'string' or (f.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$')) then
    raise exception '참여 시작과 종료의 날짜·시각·시간대를 모두 지정해 주세요' using errcode = '22023';
  end if;
  if v_role = 'campus_admin' and (p_input->>'campus_id')::uuid is distinct from public.current_campus() then
    raise exception '본인 캠퍼스에만 추가할 수 있습니다' using errcode = '42501';
  end if;
  v_up := (p_input->>'up_trip_id')::smallint;
  v_down := (p_input->>'down_trip_id')::smallint;
  if exists(select 1 from jsonb_array_elements(p_input->'legs') l group by l->>'direction' having count(*) > 1) then
    raise exception '방향별 이동수단은 하나만 입력할 수 있습니다' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_input->'legs') loop
    if jsonb_typeof(v_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_row) k where k not in ('direction','mode','via_unit_id','status'))
       or coalesce(v_row->>'direction','') not in ('up','down')
       or coalesce(v_row->>'mode','') not in ('our_bus','other_district','ktx','own_car','other')
       or coalesce(v_row->>'status','') not in ('pending','confirmed')
       or (v_row->>'mode' <> 'other_district' and (v_row->>'via_unit_id' is not null or v_row->>'status' <> 'confirmed'))
       or (v_row->>'mode' = 'other_district' and v_row->>'via_unit_id' is null) then
      raise exception '이동수단의 방향·지구·확정 상태를 확인해 주세요' using errcode = '22023';
    end if;
    -- New records get their first fee from their final trips, before the existing paid-fee freeze applies.
    if public.leg_skips_our_bus((v_row->>'mode')::public.transport_mode, (v_row->>'status')::public.transport_status) then
      if v_row->>'direction' = 'up' then v_up := null; else v_down := null; end if;
    end if;
  end loop;
  insert into public.registrations(event_id, name, student_id, campus_id, up_trip_id, down_trip_id,
    payment_status, note, attend_from, attend_to, attend_from_at, attend_to_at, roles, created_by)
  values (p_event_id, trim(p_input->>'name'), trim(p_input->>'student_id'), (p_input->>'campus_id')::uuid,
    v_up, v_down,
    (p_input->>'payment_status')::public.payment_status, p_input->>'note',
    (p_input->>'attend_from')::date, (p_input->>'attend_to')::date,
    (p_input->>'attend_from_at')::timestamptz, (p_input->>'attend_to_at')::timestamptz, '{}', auth.uid()) returning id into v_id;
  for v_row in select value from jsonb_array_elements(p_input->'legs') loop
    if jsonb_typeof(v_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_row) k where k not in ('direction','mode','via_unit_id','status')) then
      raise exception '이동수단 입력이 올바르지 않습니다' using errcode = '22023';
    end if;
    if v_row->>'mode' = 'our_bus' then continue; end if;
    insert into public.transport_legs(event_id, registration_id, direction, mode, via_unit_id, status)
    values (p_event_id, v_id, v_row->>'direction', (v_row->>'mode')::public.transport_mode,
      (v_row->>'via_unit_id')::uuid, (v_row->>'status')::public.transport_status);
  end loop;
  for v_row in select value from jsonb_array_elements(p_input->'pickups') loop
    if jsonb_typeof(v_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_row) k where k not in ('direction','pickup_at','place_id','note')) then
      raise exception '수송 요청 입력이 올바르지 않습니다' using errcode = '22023';
    end if;
    if v_row->>'pickup_at' is not null and (jsonb_typeof(v_row->'pickup_at') <> 'string'
       or (v_row->>'pickup_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$') then
      raise exception '픽업 날짜·시각·시간대를 모두 지정하거나 미정으로 남겨 주세요' using errcode = '22023';
    end if;
    insert into public.pickup_requests(event_id, registration_id, direction, pickup_at, place_id, note)
    values (p_event_id, v_id, v_row->>'direction', (v_row->>'pickup_at')::timestamptz, (v_row->>'place_id')::bigint, v_row->>'note');
  end loop;
  for v_row in select value from jsonb_array_elements(p_input->'courses') loop
    if jsonb_typeof(v_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_row) k where k not in ('day_no','at_time')) then
      raise exception '수강신청 입력이 올바르지 않습니다' using errcode = '22023';
    end if;
    insert into public.course_signups(event_id, registration_id, day_no, at_time)
    values (p_event_id, v_id, (v_row->>'day_no')::smallint, (v_row->>'at_time')::time);
  end loop;
  return v_id;
end $$;
revoke all on function public.create_registration_complete(uuid, jsonb) from public, anon;
grant execute on function public.create_registration_complete(uuid, jsonb) to authenticated;
