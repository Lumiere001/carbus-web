-- ============================================================
-- Phase 1 (2/4) — 활성 행사 범위 적용 (RLS + 뷰)
-- ============================================================
-- 왜 RESTRICTIVE 정책인가?
--   기존 정책 19개를 하나씩 고치면 실수 하나가 곧 데이터 유출이다.
--   RESTRICTIVE 정책은 기존 PERMISSIVE 정책들과 AND 로 묶이므로,
--   테이블당 1개만 추가하면 "역할 판정은 그대로 + 활성 행사만" 이 된다.
--   롤백도 이 정책들만 DROP 하면 끝.
--
-- 효과: 새 행사로 전환하면 지난 행사 데이터가 앱에서 자동으로 안 보인다.
--   (삭제가 아니라 범위 밖으로 나가는 것 — DB 에는 그대로 남아 있다)
--
-- 주의: service_role 은 RLS 를 우회한다. 그래서 뷰에도 같은 필터를 건다.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'registrations','buses','departure_slots','batch_runs',
    'campus_payment_settlements','campus_remittances','registration_audit'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_event_scope', t);
    execute format($f$
      create policy %I on public.%I as restrictive for all
        using (event_id = public.active_event_id())
        with check (event_id = public.active_event_id())
    $f$, t || '_event_scope', t);
  end loop;
end $$;

-- ── 뷰 재정의 — 활성 행사만 집계 ─────────────────────────────
-- 뷰는 전부 security_invoker=on 이라 조회자의 RLS 를 따르지만,
-- service_role 로 조회하면 RLS 가 없으므로 뷰 자체에도 필터를 건다.
-- ⚠️ security_invoker 는 CREATE OR REPLACE 시 유지되지만, 누락되면 뷰가
--    소유자 권한으로 돌아 RLS 를 통째로 우회한다. 파일 끝에서 assert 한다.

create or replace view public.v_campus_stats
with (security_invoker = on) as
  select c.id as campus_id,
         c.name as campus_name,
         count(*) filter (where r.attendance_type = 'roundtrip') as roundtrip_count,
         count(*) filter (where r.attendance_type = 'oneway') as oneway_count,
         count(r.id) as total,
         count(*) filter (where r.attendance_type = 'self') as self_count,
         count(*) filter (where r.checked_in) as arrived_count,
         count(*) filter (where r.uses_return_bus) as return_target,
         count(*) filter (where r.checked_out) as returned_count
    from campuses c
    left join registrations r
      on r.campus_id = c.id
     and r.event_id = public.active_event_id()
   group by c.id, c.name
   order by c.display_order;

create or replace view public.v_bus_occupancy
with (security_invoker = on) as
  select b.id as bus_id,
         b.name as bus_name,
         b.departure_slot_id,
         b.capacity,
         b.hard_cap,
         (select count(*) from registrations r
           where r.assigned_up_bus_id = b.id and r.event_id = b.event_id) as up_passengers,
         (select count(*) from registrations r
           where r.assigned_down_bus_id = b.id and r.event_id = b.event_id) as down_passengers,
         b.capacity - (select count(*) from registrations r
           where r.assigned_up_bus_id = b.id and r.event_id = b.event_id) as up_empty_seats,
         b.capacity - (select count(*) from registrations r
           where r.assigned_down_bus_id = b.id and r.event_id = b.event_id) as down_empty_seats
    from buses b
   where b.event_id = public.active_event_id()
   order by b.id;

create or replace view public.v_day_capacity
with (security_invoker = on) as
  select s.id as slot_id,
         s.key as slot_key,
         s.label as slot_label,
         s.display_order,
         coalesce(sum(b.capacity), 0::bigint) as total_capacity,
         (select count(*) from registrations r
           where r.departure_slot_id = s.id and r.event_id = s.event_id) as total_passengers,
         (select count(*) from registrations r
           where r.departure_slot_id = s.id and r.checked_in and r.event_id = s.event_id) as arrived,
         coalesce(sum(b.capacity), 0::bigint) - (select count(*) from registrations r
           where r.departure_slot_id = s.id and r.event_id = s.event_id) as remaining_seats
    from departure_slots s
    left join buses b on b.departure_slot_id = s.id and b.event_id = s.event_id
   where s.active
     and s.event_id = public.active_event_id()
   group by s.id, s.key, s.label, s.display_order, s.event_id
   order by s.display_order;

create or replace view public.v_payment_summary
with (security_invoker = on) as
  select c.id as campus_id,
         c.name as campus_name,
         count(*) filter (where r.payment_status = 'unpaid')  as unpaid_count,
         count(*) filter (where r.payment_status = 'paid')    as paid_count,
         count(*) filter (where r.payment_status = 'waived')  as waived_count,
         coalesce(sum(r.fee) filter (where r.payment_status = 'paid'), 0)   as paid_total,
         coalesce(sum(r.fee) filter (where r.payment_status = 'unpaid'), 0) as unpaid_total
    from campuses c
    left join registrations r
      on r.campus_id = c.id
     -- 버스 미이용(self)은 차량비 대상이 아니다. 원본 정의 유지 — 빼면 납부 집계가
     -- self 60건만큼 부풀어 정산 3중 대조가 통째로 어긋난다.
     and r.attendance_type in ('roundtrip', 'oneway')
     and r.event_id = public.active_event_id()
   group by c.id, c.name
   order by c.display_order;

create or replace view public.v_payment_3way_comparison
with (security_invoker = on) as
  select c.id as campus_id,
         c.name as campus_name,
         coalesce(p.paid_total, 0::bigint) as system_paid_total,
         s.campus_remitted_total,
         s.master_received_total,
         coalesce(p.paid_total, 0::bigint) - s.campus_remitted_total as diff_system_vs_campus,
         s.campus_remitted_total - s.master_received_total           as diff_campus_vs_master,
         coalesce(p.paid_total, 0::bigint) - s.master_received_total as diff_system_vs_master
    from campuses c
    join campus_payment_settlements s
      on s.campus_id = c.id
     and s.event_id = public.active_event_id()
    left join v_payment_summary p on p.campus_id = c.id
   order by c.display_order;

-- ── security_invoker 재적용 검증 ─────────────────────────────
-- 하나라도 빠지면 그 뷰는 RLS 를 우회해 전 행사 데이터를 흘린다.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and c.relname like 'v\_%'
     and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'on';
  if missing is not null then
    raise exception 'security_invoker 누락: % — RLS 우회 위험', missing;
  end if;
end $$;
