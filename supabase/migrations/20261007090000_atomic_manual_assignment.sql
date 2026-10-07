create function public.set_manual_assignment(p_registration_id uuid, p_expected jsonb, p_assignments jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_event uuid;
  v_reg public.registrations%rowtype;
  v_bus public.buses%rowtype;
  v_mode text;
  v_column text;
  v_target integer;
  v_reg_trip smallint;
  v_bus_trip smallint;
  v_occupied integer;
begin
  if auth.uid() is null or public.current_role() is distinct from 'master' then
    raise exception '권한이 없습니다 (총단만 배정을 변경할 수 있어요)' using errcode = '42501';
  end if;
  if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_assignments) is distinct from 'object'
     or p_assignments = '{}'::jsonb or exists (select 1 from jsonb_object_keys(p_assignments) k
       where k not in ('assigned_up_bus_id','assigned_down_bus_id')) then
    raise exception '수동 배정 입력이 올바르지 않습니다' using errcode = '22023';
  end if;
  select event_id into v_event from public.registrations where id = p_registration_id;
  if not found then raise exception '신청을 찾을 수 없습니다'; end if;
  if v_event is distinct from public.viewing_event_id() then
    raise exception '보고 있는 행사와 신청 행사가 다릅니다' using errcode = '42501';
  end if;
  perform 1 from public.events where id = v_event for update;
  if not public.is_event_writable(v_event) then
    raise exception '지난 행사의 자료는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then raise exception '신청을 찾을 수 없습니다'; end if;
  perform 1 from public.buses where event_id = v_event order by id for update;
  if p_expected is distinct from jsonb_build_object('up_trip_id',v_reg.up_trip_id,'down_trip_id',v_reg.down_trip_id,
      'assigned_up_bus_id',v_reg.assigned_up_bus_id,'assigned_down_bus_id',v_reg.assigned_down_bus_id) then
    raise exception '신청 편이나 배정이 다른 화면에서 바뀌었습니다. 새로고침 후 다시 배정해 주세요.' using errcode = '40001';
  end if;
  foreach v_mode in array array['up','down'] loop
    v_column := case when v_mode = 'up' then 'assigned_up_bus_id' else 'assigned_down_bus_id' end;
    if not p_assignments ? v_column then continue; end if;
    if jsonb_typeof(p_assignments -> v_column) not in ('number','null') then
      raise exception '배정 호차 입력이 올바르지 않습니다' using errcode = '22023';
    end if;
    v_target := (p_assignments ->> v_column)::integer;
    if v_target is null then continue; end if;
    if v_reg.participation_status = 'cancelled' then
      raise exception '취소된 신청은 배정할 수 없습니다' using errcode = '23514';
    end if;
    select * into v_bus from public.buses where id = v_target and event_id = v_event;
    if not found then raise exception '호차를 찾을 수 없습니다'; end if;
    v_reg_trip := case when v_mode = 'up' then v_reg.up_trip_id else v_reg.down_trip_id end;
    v_bus_trip := case when v_mode = 'up' then v_bus.up_trip_id else v_bus.down_trip_id end;
    if v_reg_trip is null then raise exception '% 대상이 아닙니다', case when v_mode = 'up' then '상행' else '하행' end; end if;
    if v_bus_trip is null then raise exception '%는 %을 운행하지 않습니다', v_bus.name, case when v_mode = 'up' then '상행' else '하행' end; end if;
    if v_reg_trip <> v_bus_trip then raise exception '% 신청한 편과 %의 운행편이 다릅니다', case when v_mode = 'up' then '상행' else '하행' end, v_bus.name; end if;
    if v_bus.kind = 'staff_car' and not (
      p_registration_id is not distinct from case when v_mode = 'up' then v_bus.driver_registration_id else v_bus.down_driver_registration_id end
      or p_registration_id = any(case when v_mode = 'up' then v_bus.fixed_passenger_ids else v_bus.down_fixed_passenger_ids end)) then
      raise exception '%는 간사 차량입니다. 먼저 이 사람을 그 차의 고정 탑승자로 지정해 주세요.', v_bus.name using errcode = '23514';
    end if;
    select count(*) into v_occupied from public.registrations where id <> p_registration_id
      and case when v_mode = 'up' then assigned_up_bus_id else assigned_down_bus_id end = v_target;
    if v_occupied >= v_bus.hard_cap then
      raise exception '% 정원 초과 (이미 %명 / 최대 %석)', v_bus.name, v_occupied, v_bus.hard_cap;
    end if;
  end loop;
  update public.registrations set
    assigned_up_bus_id = case when p_assignments ? 'assigned_up_bus_id' then (p_assignments->>'assigned_up_bus_id')::integer else assigned_up_bus_id end,
    assigned_down_bus_id = case when p_assignments ? 'assigned_down_bus_id' then (p_assignments->>'assigned_down_bus_id')::integer else assigned_down_bus_id end
  where id = p_registration_id;
end $$;
revoke all on function public.set_manual_assignment(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.set_manual_assignment(uuid,jsonb,jsonb) to authenticated;

create function public.reconcile_registration_trip_assignment() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_mode text; v_trip smallint; v_old_trip smallint; v_assigned integer;
begin
  if new.participation_status = 'cancelled' then return new; end if;
  foreach v_mode in array array['up','down'] loop
    v_trip := case when v_mode = 'up' then new.up_trip_id else new.down_trip_id end;
    v_old_trip := case when v_mode = 'up' then old.up_trip_id else old.down_trip_id end;
    if v_trip is not distinct from v_old_trip then continue; end if;
    if exists (select 1 from public.buses b where b.event_id = new.event_id and b.kind = 'bus'
      and (new.id = case when v_mode = 'up' then b.driver_registration_id else b.down_driver_registration_id end
        or new.id = any(case when v_mode = 'up' then b.fixed_passenger_ids else b.down_fixed_passenger_ids end))
      and v_trip is distinct from case when v_mode = 'up' then b.up_trip_id else b.down_trip_id end) then
      raise exception '먼저 % 차량순장·고정 탑승 지정을 해제하거나 호차를 바꾼 뒤 신청 편을 변경해 주세요.',
        case when v_mode = 'up' then '상행' else '하행' end using errcode = '23514';
    end if;
    v_assigned := case when v_mode = 'up' then new.assigned_up_bus_id else new.assigned_down_bus_id end;
    if exists (select 1 from public.buses b where b.id = v_assigned and b.kind = 'bus'
      and v_trip is distinct from case when v_mode = 'up' then b.up_trip_id else b.down_trip_id end) then
      if v_mode = 'up' then new.assigned_up_bus_id := null; else new.assigned_down_bus_id := null; end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.reconcile_registration_trip_assignment() from public, anon, authenticated;
create trigger trg_reg_005_assignment_trip before update on public.registrations
for each row execute function public.reconcile_registration_trip_assignment();

create or replace function public.release_seat_on_transport_confirm() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.leg_skips_our_bus(new.mode, new.status) then return new; end if;
  -- Release direction bindings first so the trip guard never sees a manually broken leader anchor.
  perform 1 from public.events where id = new.event_id for update;
  perform 1 from public.registrations where id = new.registration_id for update;
  perform 1 from public.buses where event_id = new.event_id order by id for update;
  if new.direction = 'up' then
    update public.buses set driver_registration_id = case when driver_registration_id = new.registration_id then null else driver_registration_id end,
      fixed_passenger_ids = array_remove(fixed_passenger_ids, new.registration_id)
    where event_id = new.event_id and (driver_registration_id = new.registration_id or new.registration_id = any(fixed_passenger_ids));
    update public.registrations set up_trip_id = null, assigned_up_bus_id = null
    where id = new.registration_id and (up_trip_id is not null or assigned_up_bus_id is not null);
  else
    update public.buses set down_driver_registration_id = case when down_driver_registration_id = new.registration_id then null else down_driver_registration_id end,
      down_fixed_passenger_ids = array_remove(down_fixed_passenger_ids, new.registration_id)
    where event_id = new.event_id and (down_driver_registration_id = new.registration_id or new.registration_id = any(down_fixed_passenger_ids));
    update public.registrations set down_trip_id = null, assigned_down_bus_id = null
    where id = new.registration_id and (down_trip_id is not null or assigned_down_bus_id is not null);
  end if;
  return new;
end $$;

create or replace function public.guard_assignment_columns() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_up_changed boolean := new.assigned_up_bus_id is distinct from old.assigned_up_bus_id;
  v_down_changed boolean := new.assigned_down_bus_id is distinct from old.assigned_down_bus_id;
begin
  if public.current_role() is distinct from 'campus_admin' or not (v_up_changed or v_down_changed) then return new; end if;
  if new.participation_status = 'cancelled' and new.assigned_up_bus_id is null and new.assigned_down_bus_id is null then return new; end if;
  if (not v_up_changed or (new.assigned_up_bus_id is null and (
      exists(select 1 from public.transport_legs l where l.registration_id=new.id and l.direction='up' and public.leg_skips_our_bus(l.mode,l.status))
      or (new.up_trip_id is distinct from old.up_trip_id and exists(select 1 from public.buses b
        where b.id=old.assigned_up_bus_id and b.kind='bus' and b.up_trip_id is distinct from new.up_trip_id)))))
    and (not v_down_changed or (new.assigned_down_bus_id is null and (
      exists(select 1 from public.transport_legs l where l.registration_id=new.id and l.direction='down' and public.leg_skips_our_bus(l.mode,l.status))
      or (new.down_trip_id is distinct from old.down_trip_id and exists(select 1 from public.buses b
        where b.id=old.assigned_down_bus_id and b.kind='bus' and b.down_trip_id is distinct from new.down_trip_id))))) then
    return new;
  end if;
  raise exception '배차(호차 배정)는 총단 운영자만 변경할 수 있습니다';
end $$;
