create function public.set_leader_binding(
  p_registration_id uuid, p_kind text, p_operation text,
  p_mode text default null, p_bus_id integer default null
) returns void
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_event uuid;
  v_reg public.registrations%rowtype;
  v_bus public.buses%rowtype;
  v_modes text[];
  v_targets integer[];
  v_mode text;
  v_target integer;
  v_reg_trip smallint;
  v_bus_trip smallint;
  v_driver uuid;
  v_fixed uuid[];
  v_occupied integer;
  v_index integer;
  v_label_reg text;
  v_label_bus text;
  v_up integer;
  v_down integer;
  v_current_kind public.bus_kind;
begin
  if auth.uid() is null or public.current_role() is distinct from 'master' then
    raise exception '권한이 없습니다 (총단만 변경할 수 있어요)' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('driver', 'fixed')
     or p_operation is null or p_operation not in ('assign', 'enable', 'disable')
     or (p_operation = 'assign' and (p_mode is null or p_mode not in ('up', 'down'))) then
    raise exception '리더 저장 입력이 올바르지 않습니다' using errcode = '22023';
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
  if v_reg.participation_status = 'cancelled' then
    raise exception '취소된 신청은 차량순장·고정 탑승자로 지정할 수 없습니다';
  end if;
  perform 1 from public.buses where event_id = v_event order by id for update;
  v_up := v_reg.assigned_up_bus_id;
  v_down := v_reg.assigned_down_bus_id;
  if p_operation = 'assign' then
    v_modes := array[p_mode];
    v_targets := array[p_bus_id];
  elsif p_operation = 'disable' then
    v_modes := array['up', 'down'];
    v_targets := array[null::integer, null::integer];
  else
    -- Ignore stale UI assignments: toggle both directions from the locked current row.
    v_modes := '{}'::text[];
    v_targets := '{}'::integer[];
    if v_reg.up_trip_id is not null and v_up is not null then
      v_modes := array_append(v_modes, 'up');
      v_targets := array_append(v_targets, v_up);
    end if;
    if v_reg.down_trip_id is not null and v_down is not null then
      v_modes := array_append(v_modes, 'down');
      v_targets := array_append(v_targets, v_down);
    end if;
    if cardinality(v_modes) = 0 then
      raise exception '아직 배정된 호차가 없어 결박할 수 없습니다. 먼저 배차하거나 ''리더 관리''에서 호차를 지정하세요.';
    end if;
  end if;
  for v_index in 1..cardinality(v_modes) loop
    v_mode := v_modes[v_index];
    v_target := v_targets[v_index];
    if v_target is not null then
      select * into v_bus from public.buses where id = v_target and event_id = v_event;
      if not found then raise exception '대상 호차를 찾을 수 없습니다'; end if;
      v_reg_trip := case when v_mode = 'up' then v_reg.up_trip_id else v_reg.down_trip_id end;
      v_bus_trip := case when v_mode = 'up' then v_bus.up_trip_id else v_bus.down_trip_id end;
      if v_bus_trip is null then
        raise exception '%는 %을 운행하지 않습니다', v_bus.name, case when v_mode = 'up' then '상행' else '하행' end;
      end if;
      if v_bus.kind <> 'staff_car' then
        if v_reg_trip is null then
          raise exception '%', case when v_mode = 'up' then '상행 대상이 아닙니다 (하행 편도 신청자)'
            else '하행 대상이 아닙니다 (하행 미이용 신청자)' end;
        end if;
        if v_reg_trip <> v_bus_trip then
          select label into v_label_reg from public.event_trips where id = v_reg_trip and event_id = v_event;
          select label into v_label_bus from public.event_trips where id = v_bus_trip and event_id = v_event;
          raise exception '% 시간 불일치: 신청 %(은)는 %(이)가 아니라 %입니다',
            case when v_mode = 'up' then '출발' else '귀가' end,
            coalesce(v_label_reg, '편 ' || v_reg_trip), v_bus.name, coalesce(v_label_bus, '편 ' || v_bus_trip);
        end if;
      end if;
      v_driver := case when v_mode = 'up' then v_bus.driver_registration_id else v_bus.down_driver_registration_id end;
      v_fixed := case when v_mode = 'up' then v_bus.fixed_passenger_ids else v_bus.down_fixed_passenger_ids end;
      if p_kind = 'driver' and v_driver is not null and v_driver <> p_registration_id then
        raise exception '%에 이미 % 차량순장이 있습니다. 먼저 해제하세요.',
          v_bus.name, case when v_mode = 'up' then '상행' else '하행' end;
      end if;
      if p_kind = 'fixed' then
        select count(distinct rid) into v_occupied from unnest(array_append(v_fixed, v_driver)) rid
          where rid is not null and rid <> p_registration_id;
        if not p_registration_id = any(v_fixed) and v_occupied >= v_bus.hard_cap then
          raise exception '% 고정 인원이 정원(%석)에 도달했습니다', v_bus.name, v_bus.hard_cap;
        end if;
      end if;
    end if;
    if p_kind = 'driver' and v_mode = 'up' then
      update public.buses set driver_registration_id = null where event_id = v_event
        and driver_registration_id = p_registration_id and id is distinct from v_target;
      update public.buses set driver_registration_id = p_registration_id where id = v_target
        and driver_registration_id is distinct from p_registration_id;
    elsif p_kind = 'driver' then
      update public.buses set down_driver_registration_id = null where event_id = v_event
        and down_driver_registration_id = p_registration_id and id is distinct from v_target;
      update public.buses set down_driver_registration_id = p_registration_id where id = v_target
        and down_driver_registration_id is distinct from p_registration_id;
    elsif v_mode = 'up' then
      update public.buses set fixed_passenger_ids = array_remove(fixed_passenger_ids, p_registration_id)
        where event_id = v_event and p_registration_id = any(fixed_passenger_ids) and id is distinct from v_target;
      update public.buses set fixed_passenger_ids = array_append(fixed_passenger_ids, p_registration_id)
        where id = v_target and not p_registration_id = any(fixed_passenger_ids);
    else
      update public.buses set down_fixed_passenger_ids = array_remove(down_fixed_passenger_ids, p_registration_id)
        where event_id = v_event and p_registration_id = any(down_fixed_passenger_ids) and id is distinct from v_target;
      update public.buses set down_fixed_passenger_ids = array_append(down_fixed_passenger_ids, p_registration_id)
        where id = v_target and not p_registration_id = any(down_fixed_passenger_ids);
    end if;
    -- Bind first: the existing staff-car assignment trigger enforces this order.
    if v_target is not null and v_bus.kind = 'staff_car' then
      if v_mode = 'up' then v_up := v_target; else v_down := v_target; end if;
    else
      select kind into v_current_kind from public.buses
        where id = case when v_mode = 'up' then v_up else v_down end;
      if v_current_kind = 'staff_car' and not exists (
        select 1 from public.buses where id = case when v_mode = 'up' then v_up else v_down end
          and (p_registration_id = case when v_mode = 'up' then driver_registration_id else down_driver_registration_id end
            or p_registration_id = any(case when v_mode = 'up' then fixed_passenger_ids else down_fixed_passenger_ids end))
      ) then
        if v_mode = 'up' then v_up := null; else v_down := null; end if;
      end if;
    end if;
  end loop;
  update public.registrations set assigned_up_bus_id = v_up, assigned_down_bus_id = v_down
    where id = p_registration_id
      and (assigned_up_bus_id is distinct from v_up or assigned_down_bus_id is distinct from v_down);
end $$;
revoke all on function public.set_leader_binding(uuid, text, text, text, integer) from public, anon;
grant execute on function public.set_leader_binding(uuid, text, text, text, integer) to authenticated;
