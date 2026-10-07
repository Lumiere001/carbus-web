create function public.save_batch(
  p_event_id uuid, p_mode text, p_expected_revision text, p_assignments jsonb,
  p_bus_order integer[], p_errors text[], p_elapsed_ms integer
) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_revision bigint;
  v_bus public.buses%rowtype;
  v_reg public.registrations%rowtype;
  v_rid uuid;
  v_trip smallint;
  v_ids uuid[];
  v_pinned jsonb := '{}'::jsonb;
  v_count integer;
  v_total integer;
  v_by_bus jsonb;
  v_empty integer;
begin
  if auth.uid() is null or public.current_role() is distinct from 'master' then
    raise exception '총단만 배차를 실행할 수 있습니다' using errcode = '42501';
  end if;
  if p_event_id is distinct from public.viewing_event_id() then
    raise exception '보고 있는 행사와 배차 행사가 다릅니다' using errcode = '42501';
  end if;
  select batch_revision into v_revision from public.events where id = p_event_id for update;
  if not found then raise exception '행사를 찾을 수 없습니다'; end if;
  if not public.is_event_writable(p_event_id) then
    raise exception '지난 행사의 자료는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if p_expected_revision is distinct from v_revision::text then
    raise exception '배차 입력이 변경됐습니다. 다시 배차해 주세요.' using errcode = '40001';
  end if;
  if p_mode is null or p_mode not in ('up', 'down')
     or jsonb_typeof(p_assignments) is distinct from 'object'
     or p_bus_order is null or p_errors is null or p_elapsed_ms is null or p_elapsed_ms < 0 then
    raise exception '배차 저장 입력이 올바르지 않습니다' using errcode = '22023';
  end if;
  if p_bus_order is distinct from array(select (value ->> 'id')::integer
      from jsonb_array_elements(public.get_batch_snapshot(p_event_id) -> 'buses')) then
    raise exception '배차 호차 순서가 변경됐습니다. 다시 배차해 주세요.' using errcode = '40001';
  end if;
  -- Casting each key/value also rejects malformed UUIDs and noninteger bus IDs.
  if exists (select 1 from jsonb_each(p_assignments) a
      left join public.registrations r on r.id = a.key::uuid and r.event_id = p_event_id
      where r.id is null or r.participation_status = 'cancelled'
         or jsonb_typeof(a.value) not in ('number', 'null')) then
    raise exception '배차 대상 신청이 올바르지 않습니다' using errcode = '22023';
  end if;
  if exists (select 1 from public.registrations r
      where r.event_id = p_event_id and r.participation_status <> 'cancelled'
        and (case when p_mode = 'up' then r.up_trip_id else r.down_trip_id end) is not null
        and not p_assignments ? r.id::text) then
    raise exception '배차 참여자 결과가 누락됐습니다' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_assignments) a
      join public.registrations r on r.id = a.key::uuid
      left join public.buses b on b.id = (a.value #>> '{}')::integer and b.event_id = p_event_id
      where (a.value <> 'null'::jsonb and
        (b.id is null or (case when p_mode = 'up' then b.up_trip_id else b.down_trip_id end) is null
          or (b.kind = 'bus' and
            (case when p_mode = 'up' then r.up_trip_id else r.down_trip_id end) is distinct from
            (case when p_mode = 'up' then b.up_trip_id else b.down_trip_id end))
          or (b.kind = 'staff_car' and not
            (r.id = coalesce(case when p_mode = 'up' then b.driver_registration_id else b.down_driver_registration_id end,
                            '00000000-0000-0000-0000-000000000000'::uuid)
             or r.id = any(case when p_mode = 'up' then b.fixed_passenger_ids else b.down_fixed_passenger_ids end)))))
        or (a.value = 'null'::jsonb and
            (case when p_mode = 'up' then r.up_trip_id else r.down_trip_id end) is null)) then
    raise exception '배차 호차·편·간사 차량 지정이 올바르지 않습니다' using errcode = '22023';
  end if;
  -- Validate only the engine's anchor stage; free filling stays in TypeScript.
  -- Duplicate/mismatched/overflow anchors keep the engine's existing partial-result behavior.
  for v_bus in select * from public.buses where event_id = p_event_id order by array_position(p_bus_order, id) loop
    v_trip := case when p_mode = 'up' then v_bus.up_trip_id else v_bus.down_trip_id end;
    if v_trip is null then continue; end if;
    v_ids := array[case when p_mode = 'up' then v_bus.driver_registration_id else v_bus.down_driver_registration_id end]
      || case when p_mode = 'up' then v_bus.fixed_passenger_ids else v_bus.down_fixed_passenger_ids end;
    v_count := 0;
    for v_rid in select rid from unnest(v_ids) with ordinality as ids(rid, ord)
        where rid is not null group by rid order by min(ord) loop
      if v_pinned ? v_rid::text then continue; end if;
      select * into v_reg from public.registrations where id = v_rid and event_id = p_event_id
        and participation_status <> 'cancelled';
      if not found then continue; end if;
      if v_bus.kind <> 'staff_car' and
         (case when p_mode = 'up' then v_reg.up_trip_id else v_reg.down_trip_id end) is distinct from v_trip then
        continue;
      end if;
      if v_count >= v_bus.hard_cap then continue; end if;
      if (p_assignments ->> v_rid::text)::integer is distinct from v_bus.id then
        raise exception '리더 고정 배정이 변경됐습니다' using errcode = '22023';
      end if;
      v_pinned := v_pinned || jsonb_build_object(v_rid::text, v_bus.id);
      v_count := v_count + 1;
    end loop;
  end loop;
  -- Final occupancy includes the nonparticipant staff-car assignments deliberately retained below.
  if exists (with final_assignments as (
      select case when p_assignments ? r.id::text then (p_assignments ->> r.id::text)::integer
        when b.kind = 'staff_car' then b.id else null end as bus_id
      from public.registrations r left join public.buses b
        on b.id = case when p_mode = 'up' then r.assigned_up_bus_id else r.assigned_down_bus_id end
      where r.event_id = p_event_id and r.participation_status <> 'cancelled')
    select 1 from final_assignments f join public.buses b on b.id = f.bus_id
      group by b.id, b.hard_cap having count(*) > b.hard_cap) then
    raise exception '배차 결과가 호차 최대 정원을 초과합니다' using errcode = '22023';
  end if;
  if p_mode = 'up' then
    update public.registrations r set assigned_up_bus_id = (p_assignments ->> r.id::text)::integer
      where r.event_id = p_event_id and p_assignments ? r.id::text
        and r.assigned_up_bus_id is distinct from (p_assignments ->> r.id::text)::integer;
    update public.registrations r set assigned_up_bus_id = null
      where r.event_id = p_event_id and r.participation_status <> 'cancelled'
        and not p_assignments ? r.id::text and r.assigned_up_bus_id is not null
        and not exists (select 1 from public.buses b where b.id = r.assigned_up_bus_id and b.kind = 'staff_car');
  else
    update public.registrations r set assigned_down_bus_id = (p_assignments ->> r.id::text)::integer
      where r.event_id = p_event_id and p_assignments ? r.id::text
        and r.assigned_down_bus_id is distinct from (p_assignments ->> r.id::text)::integer;
    update public.registrations r set assigned_down_bus_id = null
      where r.event_id = p_event_id and r.participation_status <> 'cancelled'
        and not p_assignments ? r.id::text and r.assigned_down_bus_id is not null
        and not exists (select 1 from public.buses b where b.id = r.assigned_down_bus_id and b.kind = 'staff_car');
  end if;
  select count(*)::integer into v_total from jsonb_each(p_assignments) where value <> 'null'::jsonb;
  select coalesce(jsonb_object_agg(bus_id, n), '{}'::jsonb) into v_by_bus from (
    select value #>> '{}' as bus_id, count(*) as n from jsonb_each(p_assignments)
    where value <> 'null'::jsonb group by value) counts;
  select coalesce(sum(greatest(0, b.capacity - coalesce((v_by_bus ->> b.id::text)::integer, 0))), 0)::integer
    into v_empty from public.buses b where b.event_id = p_event_id
      and (case when p_mode = 'up' then b.up_trip_id else b.down_trip_id end) is not null;
  insert into public.batch_runs(event_id, run_by, success, total_assigned, by_bus, empty_seats,
    error_message, trigger_reason, elapsed_ms)
  values (p_event_id, auth.uid(), cardinality(p_errors) = 0, v_total, v_by_bus, to_jsonb(v_empty),
    case when cardinality(p_errors) > 0 then array_to_string(p_errors, E'\n') else null end,
    'manual-' || p_mode, p_elapsed_ms);
  update public.system_config set last_batch_at = clock_timestamp() where id = 1;
  if not found then raise exception '마지막 배차 시각 설정을 찾을 수 없습니다'; end if;
  -- Also invalidate a same-result concurrent save, even when no registration changed.
  update public.events set batch_revision = batch_revision + 1 where id = p_event_id;
end $$;
revoke all on function public.save_batch(uuid, text, text, jsonb, integer[], text[], integer) from public, anon;
grant execute on function public.save_batch(uuid, text, text, jsonb, integer[], text[], integer) to authenticated;
