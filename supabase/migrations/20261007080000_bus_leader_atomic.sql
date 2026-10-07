create function public.set_bus_binding(p_bus_id integer, p_mode text, p_intent jsonb)
returns setof public.buses
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_event uuid;
  v_bus public.buses%rowtype;
  v_kind text;
  v_expected_driver uuid;
  v_expected_fixed uuid[];
  v_driver uuid;
  v_fixed uuid[];
  v_next_driver uuid;
  v_next_fixed uuid[];
  v_person uuid;
begin
  if auth.uid() is null or public.current_role() is distinct from 'master' then
    raise exception '권한이 없습니다 (총단만 변경할 수 있어요)' using errcode = '42501';
  end if;
  v_kind := p_intent ->> 'kind';
  if p_mode is null or p_mode not in ('up', 'down')
     or jsonb_typeof(p_intent) is distinct from 'object'
     or v_kind is null or v_kind not in ('driver', 'fixed')
     or not p_intent ? 'expected_driver_id'
     or jsonb_typeof(p_intent -> 'expected_driver_id') not in ('null', 'string')
     or jsonb_typeof(p_intent -> 'expected_fixed_ids') is distinct from 'array' then
    raise exception '호차 리더 저장 입력이 올바르지 않습니다' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_intent -> 'expected_fixed_ids') x
             where jsonb_typeof(x) is distinct from 'string') then
    raise exception '고정 탑승자 입력이 올바르지 않습니다' using errcode = '22023';
  end if;
  v_expected_driver := (p_intent ->> 'expected_driver_id')::uuid;
  select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
    into v_expected_fixed from jsonb_array_elements_text(p_intent -> 'expected_fixed_ids') with ordinality;
  if v_kind = 'driver' then
    if not p_intent ? 'driver_id'
       or jsonb_typeof(p_intent -> 'driver_id') not in ('null', 'string') then
      raise exception '차량순장 입력이 올바르지 않습니다' using errcode = '22023';
    end if;
    v_next_driver := (p_intent ->> 'driver_id')::uuid;
  else
    if jsonb_typeof(p_intent -> 'fixed_ids') is distinct from 'array' then
      raise exception '고정 탑승자 입력이 올바르지 않습니다' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(p_intent -> 'fixed_ids') x
               where jsonb_typeof(x) is distinct from 'string') then
      raise exception '고정 탑승자 입력이 올바르지 않습니다' using errcode = '22023';
    end if;
    select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
      into v_next_fixed from jsonb_array_elements_text(p_intent -> 'fixed_ids') with ordinality;
    if cardinality(v_next_fixed) <> (select count(distinct id) from unnest(v_next_fixed) id) then
      raise exception '고정 탑승자 입력에 중복이 있습니다' using errcode = '22023';
    end if;
  end if;
  select event_id into v_event from public.buses where id = p_bus_id;
  if not found then raise exception '대상 호차를 찾을 수 없습니다'; end if;
  if v_event is distinct from public.viewing_event_id() then
    raise exception '보고 있는 행사와 호차 행사가 다릅니다' using errcode = '42501';
  end if;
  perform 1 from public.events where id = v_event for update;
  if not public.is_event_writable(v_event) then
    raise exception '지난 행사의 자료는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  select * into v_bus from public.buses where id = p_bus_id and event_id = v_event;
  if not found then raise exception '대상 호차를 찾을 수 없습니다'; end if;
  v_driver := case when p_mode = 'up' then v_bus.driver_registration_id else v_bus.down_driver_registration_id end;
  v_fixed := case when p_mode = 'up' then v_bus.fixed_passenger_ids else v_bus.down_fixed_passenger_ids end;
  -- Lock registrations before buses, as the person binding RPC does. The event lock serializes RPCs.
  perform 1 from public.registrations
    where event_id = v_event and id = any(array_append(array_append(v_fixed, v_driver), v_next_driver) || coalesce(v_next_fixed, '{}'::uuid[]))
    order by id for update;
  perform 1 from public.buses where event_id = v_event order by id for update;
  select * into v_bus from public.buses where id = p_bus_id;
  if not found then raise exception '대상 호차를 찾을 수 없습니다'; end if;
  v_driver := case when p_mode = 'up' then v_bus.driver_registration_id else v_bus.down_driver_registration_id end;
  v_fixed := case when p_mode = 'up' then v_bus.fixed_passenger_ids else v_bus.down_fixed_passenger_ids end;
  if v_driver is distinct from v_expected_driver or v_fixed is distinct from v_expected_fixed then
    raise exception '호차 리더 정보가 다른 화면에서 바뀌었습니다. 새로고침 후 다시 지정해 주세요.' using errcode = '40001';
  end if;
  if v_kind = 'driver' then
    -- The bus selector explicitly replaces its current driver, unlike person-centric assignment.
    if v_driver is not null and v_driver is distinct from v_next_driver then
      perform public.set_leader_binding(v_driver, 'driver', 'assign', p_mode, null);
    end if;
    if v_next_driver is not null and v_next_driver is distinct from v_driver then
      perform public.set_leader_binding(v_next_driver, 'driver', 'assign', p_mode, p_bus_id);
    end if;
  else
    foreach v_person in array v_fixed loop
      if not v_person = any(v_next_fixed) then
        perform public.set_leader_binding(v_person, 'fixed', 'assign', p_mode, null);
      end if;
    end loop;
    foreach v_person in array v_next_fixed loop
      if not v_person = any(v_fixed) then
        perform public.set_leader_binding(v_person, 'fixed', 'assign', p_mode, p_bus_id);
      end if;
    end loop;
    if p_mode = 'up' then
      update public.buses set fixed_passenger_ids = v_next_fixed where id = p_bus_id and fixed_passenger_ids is distinct from v_next_fixed;
    else
      update public.buses set down_fixed_passenger_ids = v_next_fixed where id = p_bus_id and down_fixed_passenger_ids is distinct from v_next_fixed;
    end if;
  end if;
  return query select * from public.buses where id = p_bus_id;
end $$;
revoke all on function public.set_bus_binding(integer, text, jsonb) from public, anon;
grant execute on function public.set_bus_binding(integer, text, jsonb) to authenticated;
