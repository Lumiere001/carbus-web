alter table public.events add column batch_revision bigint not null default 0;

-- Only batch inputs advance this revision. Attendance/payment edits do not invalidate a calculation.
create function public.bump_batch_revision() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'registrations' then
      if
       row(new.name, new.campus_id, new.up_trip_id, new.down_trip_id,
           new.assigned_up_bus_id, new.assigned_down_bus_id, new.participation_status)
       is not distinct from
       row(old.name, old.campus_id, old.up_trip_id, old.down_trip_id,
           old.assigned_up_bus_id, old.assigned_down_bus_id, old.participation_status) then
      return new;
    end if;
    elsif tg_table_name = 'buses' then
      if
       row(new.name, new.capacity, new.hard_cap, new.up_trip_id, new.down_trip_id,
           new.driver_registration_id, new.fixed_passenger_ids,
           new.down_driver_registration_id, new.down_fixed_passenger_ids,
           new.is_cohesion_exempt, new.fill_priority, new.kind)
       is not distinct from
       row(old.name, old.capacity, old.hard_cap, old.up_trip_id, old.down_trip_id,
           old.driver_registration_id, old.fixed_passenger_ids,
           old.down_driver_registration_id, old.down_fixed_passenger_ids,
           old.is_cohesion_exempt, old.fill_priority, old.kind) then
      return new;
    end if;
    elsif tg_table_name = 'event_trips' then
      if
       row(new.label, new.direction, new.active) is not distinct from
       row(old.label, old.direction, old.active) then
      return new;
      end if;
    end if;
  end if;
  update public.events set batch_revision = batch_revision + 1 where id = v_event;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.bump_batch_revision() from public, anon, authenticated;

create trigger trg_reg_batch_revision after insert or update or delete on public.registrations
for each row execute function public.bump_batch_revision();
create trigger trg_bus_batch_revision after insert or update or delete on public.buses
for each row execute function public.bump_batch_revision();
create trigger trg_trip_batch_revision after insert or update or delete on public.event_trips
for each row execute function public.bump_batch_revision();

create function public.get_batch_snapshot(p_event_id uuid) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_snapshot jsonb;
begin
  if auth.uid() is null or public.current_role() is distinct from 'master' then
    raise exception '총단만 배차를 실행할 수 있습니다' using errcode = '42501';
  end if;
  if p_event_id is distinct from public.viewing_event_id() then
    raise exception '보고 있는 행사와 배차 행사가 다릅니다' using errcode = '42501';
  end if;
  perform 1 from public.events where id = p_event_id for share;
  if not found then raise exception '행사를 찾을 수 없습니다'; end if;
  if not public.is_event_writable(p_event_id) then
    raise exception '지난 행사의 자료는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  -- Keep the prior query row order; all inputs and the revision share one statement snapshot.
  select jsonb_build_object(
    'event_id', e.id, 'revision', e.batch_revision::text,
    'registrations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'campus_id', r.campus_id,
      'attendance_type', r.attendance_type, 'up_trip_id', r.up_trip_id,
      'down_trip_id', r.down_trip_id, 'assigned_up_bus_id', r.assigned_up_bus_id,
      'assigned_down_bus_id', r.assigned_down_bus_id))
      from public.registrations r where r.event_id = e.id
        and r.participation_status <> 'cancelled'), '[]'::jsonb),
    'buses', coalesce((select jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'capacity', b.capacity, 'hard_cap', b.hard_cap,
      'up_trip_id', b.up_trip_id, 'down_trip_id', b.down_trip_id,
      'driver_registration_id', b.driver_registration_id,
      'fixed_passenger_ids', b.fixed_passenger_ids,
      'down_driver_registration_id', b.down_driver_registration_id,
      'down_fixed_passenger_ids', b.down_fixed_passenger_ids,
      'is_cohesion_exempt', b.is_cohesion_exempt, 'fill_priority', b.fill_priority,
      'kind', b.kind))
      from public.buses b where b.event_id = e.id), '[]'::jsonb),
    'trips', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label) order by t.id)
      from public.event_trips t where t.event_id = e.id), '[]'::jsonb))
    into v_snapshot from public.events e where e.id = p_event_id;
  return v_snapshot;
end $$;
revoke all on function public.get_batch_snapshot(uuid) from public, anon;
grant execute on function public.get_batch_snapshot(uuid) to authenticated;
