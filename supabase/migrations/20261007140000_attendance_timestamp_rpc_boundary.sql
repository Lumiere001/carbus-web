-- A typed timestamptz no longer reveals whether HTTP input omitted its time.
-- Authenticated planned timestamp writes must use the shape-validated create/journey RPCs.
create function public.guard_attendance_timestamp_rpc() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then return new; end if;
  if (tg_op='INSERT' and (new.attend_from_at is not null or new.attend_to_at is not null))
    or (tg_op='UPDATE' and row(new.attend_from_at,new.attend_to_at) is distinct from row(old.attend_from_at,old.attend_to_at)) then
    if current_setting('carbus_private.attendance_plan_validated',true) is distinct from 'yes' then
      raise exception '확정 참여 일시는 날짜와 시각을 함께 확인하는 참여 일정 편집기로 저장해 주세요.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_attendance_timestamp_rpc() from public, anon, authenticated;
create trigger trg_reg_004_attendance_timestamp_rpc before insert or update on public.registrations
  for each row execute function public.guard_attendance_timestamp_rpc();
alter table public.registrations enable always trigger trg_reg_004_attendance_timestamp_rpc;

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
  perform set_config('carbus_private.attendance_plan_validated','yes',true);
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
  perform set_config('carbus_private.attendance_plan_validated','',true);
  return v_id;
exception when others then
  perform set_config('carbus_private.attendance_plan_validated','',true);
  raise;
end $$;

create or replace function public.save_registration_journey(p_registration_id uuid,p_expected jsonb,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare r public.registrations%rowtype; v_row jsonb; v_up smallint; v_down smallint; v_legs jsonb; v_expected_legs jsonb;
begin
  if auth.uid() is null or public.current_role() is null or public.current_role() not in ('master','campus_admin') then
    raise exception '참여 일정과 이동수단을 편집할 권한이 없습니다.' using errcode='42501';
  end if;
  if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_input) is distinct from 'object'
    or not (p_expected ?& array['version','attend_from','attend_to','attend_from_at','attend_to_at','up_trip_id','down_trip_id','legs'])
    or not (p_input ?& array['attend_from','attend_to','attend_from_at','attend_to_at','up_trip_id','down_trip_id','legs'])
    or jsonb_typeof(p_expected->'legs') is distinct from 'array' or jsonb_typeof(p_input->'legs') is distinct from 'array'
    or exists(select 1 from jsonb_object_keys(p_expected) k where k not in ('version','attend_from','attend_to','attend_from_at','attend_to_at','up_trip_id','down_trip_id','legs'))
    or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('attend_from','attend_to','attend_from_at','attend_to_at','up_trip_id','down_trip_id','legs')) then
    raise exception '참여 일정과 이동수단 입력이 올바르지 않습니다.' using errcode='22023';
  end if;
  select * into r from public.registrations where id=p_registration_id for update;
  if not found then raise exception '신청을 찾을 수 없습니다.' using errcode='42501'; end if;
  if r.event_id is distinct from public.viewing_event_id() or not public.is_event_writable(r.event_id) then
    raise exception '보고 있는 행사에 지금 저장할 수 없습니다.' using errcode='42501';
  end if;
  if r.participation_status='cancelled' then raise exception '취소된 신청의 참여 일정은 편집할 수 없습니다.' using errcode='23514'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('direction',direction,'mode',mode,'via_unit_id',via_unit_id,'status',status) order by direction),'[]'::jsonb)
    into v_legs from public.transport_legs where registration_id=r.id;
  select coalesce(jsonb_agg(value order by value->>'direction'),'[]'::jsonb) into v_expected_legs from jsonb_array_elements(p_expected->'legs');
  if (p_expected->>'version')::integer is distinct from r.version
    or (p_expected->>'attend_from')::date is distinct from r.attend_from or (p_expected->>'attend_to')::date is distinct from r.attend_to
    or (p_expected->>'attend_from_at')::timestamptz is distinct from r.attend_from_at
    or (p_expected->>'attend_to_at')::timestamptz is distinct from r.attend_to_at
    or (p_expected->>'up_trip_id')::smallint is distinct from r.up_trip_id or (p_expected->>'down_trip_id')::smallint is distinct from r.down_trip_id
    or v_legs is distinct from v_expected_legs then
    raise exception '참여 일정이나 이동수단이 다른 화면에서 바뀌었습니다. 새로고침 후 다시 확인해 주세요.' using errcode='40001';
  end if;
  if exists(select 1 from jsonb_each(p_input) f where f.key in ('attend_from','attend_to','attend_from_at','attend_to_at') and jsonb_typeof(f.value) not in ('string','null'))
    or exists(select 1 from jsonb_each(p_input) f where f.key in ('up_trip_id','down_trip_id') and jsonb_typeof(f.value) not in ('number','null'))
    or exists(select 1 from jsonb_each(p_input) f where f.key in ('attend_from_at','attend_to_at') and f.value<>'null'::jsonb
      and (f.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$')
    or exists(select 1 from jsonb_array_elements(p_input->'legs') l group by l->>'direction' having count(*)>1) then
    raise exception '참여 날짜·시각과 방향별 이동수단을 확인해 주세요.' using errcode='22023';
  end if;
  v_up:=(p_input->>'up_trip_id')::smallint; v_down:=(p_input->>'down_trip_id')::smallint;
  for v_row in select value from jsonb_array_elements(p_input->'legs') loop
    if jsonb_typeof(v_row) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_row) k where k not in ('direction','mode','via_unit_id','status'))
      or not (v_row ?& array['direction','mode','via_unit_id','status']) or coalesce(v_row->>'direction','') not in ('up','down')
      or coalesce(v_row->>'mode','') not in ('our_bus','other_district','ktx','own_car','other')
      or coalesce(v_row->>'status','') not in ('pending','confirmed')
      or (v_row->>'mode'<>'other_district' and (v_row->>'via_unit_id' is not null or v_row->>'status'<>'confirmed'))
      or (v_row->>'mode'='other_district' and v_row->>'via_unit_id' is null) then
      raise exception '이동수단의 방향·지구·확정 상태를 확인해 주세요.' using errcode='22023';
    end if;
    if public.leg_skips_our_bus((v_row->>'mode')::public.transport_mode,(v_row->>'status')::public.transport_status) then
      if v_row->>'direction'='up' then v_up:=null; else v_down:=null; end if;
    end if;
  end loop;
  perform set_config('carbus_private.attendance_plan_validated','yes',true);
  -- Existing seat-release triggers see the explicit leg first, retaining campus assignment guards.
  for v_row in select value from jsonb_array_elements(p_input->'legs') loop
    insert into public.transport_legs(event_id,registration_id,direction,mode,via_unit_id,status)
    values (r.event_id,r.id,v_row->>'direction',(v_row->>'mode')::public.transport_mode,
      (v_row->>'via_unit_id')::uuid,(v_row->>'status')::public.transport_status)
    on conflict(registration_id,direction) do update set mode=excluded.mode,via_unit_id=excluded.via_unit_id,status=excluded.status;
  end loop;
  delete from public.transport_legs l where l.registration_id=r.id and not exists (
    select 1 from jsonb_array_elements(p_input->'legs') v where v->>'direction'=l.direction);
  update public.registrations set attend_from=(p_input->>'attend_from')::date,attend_to=(p_input->>'attend_to')::date,
    attend_from_at=(p_input->>'attend_from_at')::timestamptz,attend_to_at=(p_input->>'attend_to_at')::timestamptz,
    up_trip_id=v_up,down_trip_id=v_down where id=r.id;
  select * into r from public.registrations where id=r.id;
  select coalesce(jsonb_agg(jsonb_build_object('direction',direction,'mode',mode,'via_unit_id',via_unit_id,'status',status) order by direction),'[]'::jsonb)
    into v_legs from public.transport_legs where registration_id=r.id;
  perform set_config('carbus_private.attendance_plan_validated','',true);
  return jsonb_build_object('row',to_jsonb(r),'legs',v_legs);
exception when others then
  perform set_config('carbus_private.attendance_plan_validated','',true);
  raise;
end $$;
