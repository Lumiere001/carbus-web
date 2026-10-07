create or replace function public.campus_remit_add(p_amount integer, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campus uuid := public.current_campus(); v_event uuid := public.viewing_event_id();
begin
  if public.current_role() is distinct from 'campus_admin' then raise exception 'campus_admin만 송금을 등록할 수 있습니다'; end if;
  if v_campus is null then raise exception '담당 캠퍼스가 지정되지 않았습니다'; end if;
  if v_event is null or not public.is_event_writable(v_event) then raise exception '지금 보고 있는 행사에 송금을 등록할 수 없습니다' using errcode = '42501'; end if;
  if p_amount <= 0 then raise exception '송금액은 0보다 커야 합니다'; end if;
  insert into public.campus_remittances(event_id,campus_id,amount,note,created_by)
  values(v_event,v_campus,p_amount,p_note,auth.uid());
end $$;

create or replace function public.master_remit_add(p_campus_id uuid, p_amount integer, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event uuid := public.viewing_event_id();
begin
  if public.current_role() is distinct from 'master' then raise exception '총단(master)만 대리 등록할 수 있습니다'; end if;
  if v_event is null or not public.is_event_writable(v_event) then raise exception '지금 보고 있는 행사에 송금을 등록할 수 없습니다' using errcode = '42501'; end if;
  if p_amount <= 0 then raise exception '송금액은 0보다 커야 합니다'; end if;
  if not exists(select 1 from public.campuses where id=p_campus_id) then raise exception '없는 캠퍼스입니다'; end if;
  insert into public.campus_remittances(event_id,campus_id,amount,note,created_by)
  values(v_event,p_campus_id,p_amount,coalesce(nullif(btrim(p_note),''),'총단 대리 등록'),auth.uid());
end $$;

create or replace function public.campus_remit_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event uuid := public.viewing_event_id(); v_role public.user_role := public.current_role();
begin
  if v_role is null or v_role not in ('campus_admin','master') then raise exception '권한이 없습니다' using errcode = '42501'; end if;
  if v_event is null or not public.is_event_writable(v_event) then raise exception '지금 보고 있는 행사에 송금을 삭제할 수 없습니다' using errcode = '42501'; end if;
  delete from public.campus_remittances where id=p_id and event_id=v_event
    and (v_role='master' or campus_id=public.current_campus());
  if not found then raise exception '이 화면의 송금 항목을 찾을 수 없습니다. 이미 삭제되었거나 다른 행사의 항목입니다.' using errcode = '40001'; end if;
end $$;
