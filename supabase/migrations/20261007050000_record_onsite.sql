create function public.record_onsite(p_event uuid, p_reg uuid, p_request uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r registrations;
  v onsite_visits;
  prior onsite_requests;
  rev integer;
  action text := p_input->>'action';
  expected integer;
  changed boolean := false;
begin
  if auth.uid() is null or public.current_role() not in ('master','campus_admin')
     or public.current_role() is null then
    raise exception '현장 기록을 변경할 권한이 없습니다' using errcode = '42501';
  end if;
  perform 1 from events where id = p_event for share;
  if p_event is distinct from public.viewing_event_id() or not public.is_event_writable(p_event) then
    raise exception '현재 화면의 쓰기 가능한 행사에서만 기록할 수 있습니다' using errcode = '42501';
  end if;
  select * into r from registrations where id = p_reg and event_id = p_event for update;
  if not found or (public.current_role() = 'campus_admin' and r.campus_id is distinct from public.current_campus()) then
    raise exception '본인 편집 범위의 신청자가 아닙니다' using errcode = '42501';
  end if;
  if r.participation_status = 'cancelled' then
    raise exception '취소한 신청자는 현장 체크할 수 없습니다' using errcode = '23514';
  end if;
  if p_request is null or jsonb_typeof(p_input) is distinct from 'object'
    or not (p_input ? 'expected_revision') or action is null or action not in ('arrive','depart','correct') then
    raise exception '현장 기록 요청 형식이 올바르지 않습니다' using errcode = '22023';
  end if;
  expected := (p_input->>'expected_revision')::integer;
  if expected is null or expected < 0 then
    raise exception '현장 기록 버전을 확인하세요' using errcode = '22023';
  end if;
  select * into prior from onsite_requests where id = p_request;
  if found then
    if prior.event_id <> p_event or prior.registration_id <> p_reg or prior.actor_id <> auth.uid()
      or prior.payload <> p_input then
      raise exception '다른 요청에 사용된 식별자입니다' using errcode = '22023';
    end if;
    return public.onsite_snapshot(p_event,array[p_reg]);
  end if;
  select revision into rev from onsite_states where registration_id = p_reg;
  rev := coalesce(rev,0);
  if rev <> expected then
    raise exception '다른 기기에서 현장 기록을 변경했습니다. 최신 기록을 확인하고 다시 체크하세요'
      using errcode = '40001';
  end if;
  insert into onsite_requests(id,event_id,registration_id,actor_id,payload)
    values(p_request,p_event,p_reg,auth.uid(),p_input);
  select * into v from onsite_visits where registration_id = p_reg order by visit_number desc limit 1;
  case action
  when 'arrive' then
    if v.arrived_at is null or v.departed_at is not null then
      insert into onsite_visits(event_id,registration_id,visit_number,arrived_at,arrived_by)
      values(p_event,p_reg,coalesce(v.visit_number,0)+1,clock_timestamp(),auth.uid());
      changed := true;
    end if;
  when 'depart' then
    if v.id is null or (v.arrived_at is null and v.departed_at is null) then
      insert into onsite_visits(event_id,registration_id,visit_number,departed_at,departed_by)
      values(p_event,p_reg,coalesce(v.visit_number,0)+1,clock_timestamp(),auth.uid());
      changed := true;
    elsif v.departed_at is null then
      update onsite_visits set departed_at = clock_timestamp(), departed_by = auth.uid(),
        version = version+1, updated_at = clock_timestamp() where id = v.id;
      changed := true;
    end if;
  when 'correct' then
    changed := public.correct_onsite_visit(p_event,p_reg,p_request,p_input);
  end case;
  if changed then
    insert into onsite_states(registration_id,event_id,revision) values(p_reg,p_event,rev+1)
      on conflict(registration_id) do update set revision = excluded.revision;
  end if;
  return public.onsite_snapshot(p_event,array[p_reg]);
end $$;
revoke all on function public.record_onsite(uuid,uuid,uuid,jsonb) from public;
grant execute on function public.record_onsite(uuid,uuid,uuid,jsonb) to authenticated;
