-- Actual site visits are separate from planned attendance and vehicle boarding.
alter table public.registrations add constraint registrations_event_id_id_key unique (event_id, id);

create table public.onsite_states (
  registration_id uuid primary key,
  event_id uuid not null,
  revision integer not null default 0 check (revision >= 0),
  foreign key (event_id, registration_id) references public.registrations(event_id, id)
);
create table public.onsite_visits (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  registration_id uuid not null,
  visit_number integer not null check (visit_number > 0),
  arrived_at timestamptz,
  departed_at timestamptz,
  arrived_by uuid references public.profiles(id),
  departed_by uuid references public.profiles(id),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default clock_timestamp(),
  unique (registration_id, visit_number),
  foreign key (event_id, registration_id) references public.registrations(event_id, id),
  check (arrived_at is null or departed_at is null or arrived_at <= departed_at)
);
create unique index onsite_one_open_visit on public.onsite_visits(registration_id)
  where arrived_at is not null and departed_at is null;
create function public.guard_onsite_order()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if (new.arrived_at is not null and not isfinite(new.arrived_at))
    or (new.departed_at is not null and not isfinite(new.departed_at)) then
    raise exception '유효한 날짜·시각을 입력하세요' using errcode = '23514';
  end if;
  if new.arrived_at is not null and new.departed_at is null and exists
    (select 1 from onsite_visits x where x.registration_id = new.registration_id and x.id <> new.id
      and x.visit_number > new.visit_number and (x.arrived_at is not null or x.departed_at is not null)) then
    raise exception '이후 방문이 있는 기록을 현장 참석 중으로 되돌릴 수 없습니다' using errcode = '23514';
  end if;
  if exists(select 1 from onsite_visits x where x.registration_id = new.registration_id and x.id <> new.id and
    ((x.visit_number < new.visit_number and greatest(x.arrived_at,x.departed_at) > least(new.arrived_at,new.departed_at))
      or (x.visit_number > new.visit_number and least(x.arrived_at,x.departed_at) < greatest(new.arrived_at,new.departed_at)))) then
    raise exception '이전·다음 방문의 시각과 겹칩니다. 방문 순서를 확인하세요' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger onsite_visit_order before insert or update on public.onsite_visits
  for each row execute function public.guard_onsite_order();
create table public.onsite_requests (
  id uuid primary key,
  event_id uuid not null,
  registration_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (event_id, registration_id) references public.registrations(event_id, id)
);
create table public.onsite_corrections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  registration_id uuid not null,
  visit_id uuid not null references public.onsite_visits(id),
  request_id uuid not null references public.onsite_requests(id),
  changed_by uuid not null references public.profiles(id),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  before_value jsonb not null,
  after_value jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (event_id, registration_id) references public.registrations(event_id, id)
);

-- Reuse the existing master/viewer/campus read scope. Drivers gain no site access.
create function public.can_read_onsite(p_event uuid, p_reg uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and p_event = public.viewing_event_id()
    and exists (select 1 from registrations r where r.id = p_reg and r.event_id = p_event
      and (public.current_role() in ('master', 'viewer')
        or (public.current_role() = 'campus_admin' and r.campus_id = public.current_campus())))
$$;
revoke all on function public.can_read_onsite(uuid,uuid) from public;
grant execute on function public.can_read_onsite(uuid,uuid) to authenticated;
do $$ declare t text; begin
  foreach t in array array['onsite_states','onsite_visits','onsite_requests','onsite_corrections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger trg_%s_event_writable before insert or update or delete on public.%I
      for each row execute function public.guard_event_writable()', t, t);
    execute format('alter table public.%I enable always trigger trg_%s_event_writable', t, t);
  end loop;
  foreach t in array array['onsite_states','onsite_visits','onsite_corrections'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy onsite_read on public.%I for select to authenticated
      using ((select public.can_read_onsite(event_id,registration_id)))', t);
  end loop;
end $$;

-- A single statement returns the visit history together with its monotonic revision.
create function public.onsite_snapshot(p_event uuid, p_reg_ids uuid[])
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'registration_id', r.id, 'revision', coalesce(s.revision,0),
    'visits', coalesce((select jsonb_agg(to_jsonb(v) order by v.visit_number)
      from onsite_visits v where v.registration_id = r.id), '[]'::jsonb))), '[]'::jsonb)
  from registrations r left join onsite_states s on s.registration_id = r.id
  where r.event_id = p_event and r.id = any(p_reg_ids)
    and public.can_read_onsite(p_event,r.id)
$$;
revoke all on function public.onsite_snapshot(uuid,uuid[]) from public;
grant execute on function public.onsite_snapshot(uuid,uuid[]) to authenticated;

-- Notify only scoped readers; client reads a fresh snapshot rather than trusting payloads.
alter publication supabase_realtime add table public.onsite_states;
