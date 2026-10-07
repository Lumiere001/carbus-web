-- Internal only: caller has already authenticated, scoped and locked the registration.
create function public.correct_onsite_visit(p_event uuid,p_reg uuid,p_request uuid,p_input jsonb)
returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v onsite_visits;
  next_v onsite_visits;
  arrival timestamptz;
  departure timestamptz;
  reason text := btrim(p_input->>'reason');
begin
  if not (p_input ?& array['visit_id','visit_version','arrived_at','departed_at','reason'])
    or reason is null or length(reason) not between 1 and 500 then
    raise exception '정정할 방문과 날짜·시각, 사유를 입력하세요' using errcode = '22023';
  end if;
  select * into v from onsite_visits where id = (p_input->>'visit_id')::uuid
    and event_id = p_event and registration_id = p_reg;
  if not found then raise exception '정정할 방문을 찾을 수 없습니다' using errcode = '22023'; end if;
  if (p_input->>'visit_version')::integer is distinct from v.version then
    raise exception '방문 기록이 변경됐습니다. 최신 기록을 확인하세요' using errcode = '40001';
  end if;
  -- Require explicit offsets so a browser/session timezone never determines the record.
  if ((p_input->>'arrived_at') is not null and (p_input->>'arrived_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$')
    or ((p_input->>'departed_at') is not null and (p_input->>'departed_at') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception '정정 시각에는 시간대가 필요합니다' using errcode = '22023';
  end if;
  arrival := (p_input->>'arrived_at')::timestamptz;
  departure := (p_input->>'departed_at')::timestamptz;
  if (arrival is not null and not isfinite(arrival)) or (departure is not null and not isfinite(departure)) then
    raise exception '유효한 날짜·시각을 입력하세요' using errcode = '22023';
  end if;
  if arrival is not distinct from v.arrived_at and departure is not distinct from v.departed_at then return false; end if;
  update onsite_visits set arrived_at = arrival, departed_at = departure,
    arrived_by = case when arrival is null then null when arrival is distinct from v.arrived_at then auth.uid() else v.arrived_by end,
    departed_by = case when departure is null then null when departure is distinct from v.departed_at then auth.uid() else v.departed_by end,
    version = version+1, updated_at = clock_timestamp() where id = v.id returning * into next_v;
  insert into onsite_corrections(event_id,registration_id,visit_id,request_id,changed_by,reason,before_value,after_value)
    values(p_event,p_reg,v.id,p_request,auth.uid(),reason,to_jsonb(v),to_jsonb(next_v));
  return true;
end $$;
revoke all on function public.correct_onsite_visit(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
