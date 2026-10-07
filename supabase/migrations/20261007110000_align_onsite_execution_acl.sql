revoke execute on function public.can_read_onsite(uuid, uuid) from anon;
revoke execute on function public.onsite_snapshot(uuid, uuid[]) from anon;
revoke execute on function public.record_onsite(uuid, uuid, uuid, jsonb) from anon;
revoke execute on function public.guard_onsite_order() from public, anon, authenticated;
