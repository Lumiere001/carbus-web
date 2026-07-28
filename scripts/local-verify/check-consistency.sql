-- ============================================================
-- 정합성 전수 점검 (HANDOFF §26-D)
-- ============================================================
-- 이 레포에서 정합성이 깨지는 자리는 대부분 **같은 사실을 두 곳에 적어 둔 곳**이다.
-- 화면으로 훑으면 "이상해 보이는 것"만 걸리고 규모를 모른다. 그래서 쌍마다
-- **어긋난 행이 몇 건인가**를 세어 둔다 — 고친 뒤 0 이 되는지로 검증된다.
--
-- 읽는 법:
--   must_be_zero = true  → 0 이 아니면 결함이다. 고쳐야 한다.
--   must_be_zero = false → 세어 두기만 한다(의도된 이중화·운영 중 상태).
--
-- 행사 구분: 모든 검사는 **행사 전체**를 본다. 지난 행사도 포함한다 —
--   지난 행사가 어긋난 채 보관되면 다음 행사 전환 때 그대로 복제된다.
--
-- 실행: bash scripts/local-verify/check-consistency.sh
-- ============================================================

drop table if exists _consistency;
create temp table _consistency (
  ord        int,
  pair       text,   -- 어떤 사실이 두 곳에 적혀 있나
  finding    text,   -- 어떤 모양의 어긋남인가
  n          bigint,
  must_be_zero boolean
);

-- ── ① 이 사람이 우리 버스를 타는가 ────────────────────────────
--     registrations.up/down_trip_id  ↔  transport_legs.mode
--     §26-B 의 본체. "안 타는데 자리를 잡고 있다"가 실제 손해다 —
--     빈 좌석을 태우고 출발한다.
insert into _consistency
select 1, '우리 버스 탑승 여부 (편 ↔ 이동수단)',
       '우리 버스를 안 타는데 그 방향 좌석을 잡고 있다', count(*), true
  from transport_legs l
  join registrations r on r.id = l.registration_id
 where r.participation_status <> 'cancelled'
   and (l.mode in ('ktx','own_car','other')
        or (l.mode = 'other_district' and l.status = 'confirmed'))
   and (case when l.direction = 'up' then r.up_trip_id else r.down_trip_id end) is not null;

insert into _consistency
select 2, '우리 버스 탑승 여부 (편 ↔ 이동수단)',
       '우리 버스라고 적혀 있는데 그 방향 편이 비어 있다', count(*), false
  from transport_legs l
  join registrations r on r.id = l.registration_id
 where r.participation_status <> 'cancelled'
   and l.mode = 'our_bus'
   and (case when l.direction = 'up' then r.up_trip_id else r.down_trip_id end) is null;

-- 배정 호차만 남고 편이 비어 있는 유령 배정. 편이 진실원이므로 이건 언제나 결함이다.
insert into _consistency
select 3, '우리 버스 탑승 여부 (편 ↔ 이동수단)',
       '편은 비었는데 배정 호차가 유령으로 남아 있다', count(*), true
  from registrations r
 where (r.up_trip_id is null and r.assigned_up_bus_id is not null)
    or (r.down_trip_id is null and r.assigned_down_bus_id is not null);

-- ── ② 참여형태 (파생) ────────────────────────────────────────
--     attendance_type  ↔  두 편에서 파생
insert into _consistency
select 10, '참여형태 (attendance_type ↔ 두 편)',
       'attendance_type 이 편 두 개에서 나온 값과 다르다', count(*), true
  from registrations r
 where r.attendance_type is distinct from derive_attendance(r.up_trip_id, r.down_trip_id);

-- ── ③ 옛 컬럼 (파생, 미제거) ─────────────────────────────────
--     departure_slot_id · uses_return_bus  ↔  up/down_trip_id
insert into _consistency
select 20, '옛 컬럼 (departure_slot_id · uses_return_bus)',
       '옛 컬럼이 새 컬럼과 어긋난다', count(*), true
  from registrations r
 where r.departure_slot_id is distinct from r.up_trip_id
    or r.uses_return_bus is distinct from (r.down_trip_id is not null);

-- ── ④ 청구액 (의도된 이중화) ─────────────────────────────────
--     registrations.fee(동결)  ↔  v_payment_balance.fee_now
--     ⚠️ 0 이 목표가 아니다. 참여형태가 바뀌면 청구액이 달라지는 게 정상이고,
--        그 차이를 **차액 목록이 드러내는 것**이 설계다.
insert into _consistency
select 30, '청구액 (동결 fee ↔ 지금 계산 fee_now)',
       '동결된 청구액과 지금 계산이 다르다 (차액 목록에 뜨는 사람)', count(*), false
  from v_payment_balance b
 where b.fee_now is distinct from (select fee from registrations where id = b.registration_id);

-- ── ⑤ 취소자 ────────────────────────────────────────────────
-- 진행 중인 행사와 보관된 행사를 나눈다. **손해가 나는 쪽이 다르기 때문이다** —
-- 진행 중이면 빈 좌석을 태우고 출발하지만, 끝난 행사에서는 아무도 안 탄다.
-- 보관된 행사는 write_mode 가 closed 라 고치려면 잠금을 열어야 하는데, 그걸
-- 강제하면 "고치려고 지난 행사를 여는" 더 위험한 습관이 생긴다.
insert into _consistency
select 40, '취소자 (participation_status ↔ 좌석)',
       '진행 중인 행사에서 취소했는데 편·배정이 남아 있다', count(*), true
  from registrations r
  join events e on e.id = r.event_id and e.is_active
 where r.participation_status = 'cancelled'
   and (r.up_trip_id is not null or r.down_trip_id is not null
        or r.assigned_up_bus_id is not null or r.assigned_down_bus_id is not null);

insert into _consistency
select 41, '취소자 (participation_status ↔ 좌석)',
       '보관된 행사에 남아 있다 (잠금을 열 때 같이 정리하면 된다)', count(*), false
  from registrations r
  join events e on e.id = r.event_id and not e.is_active
 where r.participation_status = 'cancelled'
   and (r.up_trip_id is not null or r.down_trip_id is not null
        or r.assigned_up_bus_id is not null or r.assigned_down_bus_id is not null);

-- ── ⑥ 차량순장 (§26-D 에서 "점검 안 함" 으로 남아 있던 쌍) ────
--     buses.driver_registration_id  ↔  profiles.driver_bus_id
--     행사 전환 때 **이름으로 매칭**하므로 어긋날 여지가 있다.
insert into _consistency
select 50, '차량순장 (buses.driver ↔ profiles.driver_bus_id)',
       '순장 계정이 가리키는 차와 그 차가 가리키는 순장이 다르다', count(*), true
  from profiles p
  join buses b on b.id = p.driver_bus_id
 where b.driver_registration_id is null
    or not exists (
      select 1 from registrations r
       where r.id = b.driver_registration_id
         and r.event_id = b.event_id
    );

insert into _consistency
select 51, '차량순장 (buses.driver ↔ profiles.driver_bus_id)',
       '차가 가리키는 순장이 취소자다', count(*), true
  from buses b
  join registrations r on r.id = b.driver_registration_id
 where r.participation_status = 'cancelled';

-- ── ⑦ 배정 ↔ 그 차가 뛰는 편 ────────────────────────────────
--     assigned_*_bus_id  ↔  그 차의 *_trip_id
--     어긋나면 "그 편에 없는 차"에 타 있는 사람이 된다. 현장에서 차를 못 찾는다.
insert into _consistency
select 60, '배정 (배정 호차 ↔ 그 차가 뛰는 편)',
       '상행 배정된 차가 그 사람의 상행 편을 뛰지 않는다', count(*), true
  from registrations r
  join buses b on b.id = r.assigned_up_bus_id
 where b.up_trip_id is distinct from r.up_trip_id;

insert into _consistency
select 61, '배정 (배정 호차 ↔ 그 차가 뛰는 편)',
       '하행 배정된 차가 그 사람의 하행 편을 뛰지 않는다', count(*), true
  from registrations r
  join buses b on b.id = r.assigned_down_bus_id
 where b.down_trip_id is distinct from r.down_trip_id;

-- ── ⑧ 행사 격리 ─────────────────────────────────────────────
--     "이 행사의 것" 이 여러 테이블에 따로 적혀 있다. 어긋나면 지난 행사 데이터가 샌다.
insert into _consistency
select 70, '행사 격리 (event_id 가 여러 곳에 적혀 있다)',
       '차량이 다른 행사의 운행편에 붙어 있다', count(*), true
  from buses b
  left join event_trips tu on tu.id = b.up_trip_id
  left join event_trips td on td.id = b.down_trip_id
 where (tu.id is not null and tu.event_id is distinct from b.event_id)
    or (td.id is not null and td.event_id is distinct from b.event_id);

insert into _consistency
select 71, '행사 격리 (event_id 가 여러 곳에 적혀 있다)',
       '신청이 다른 행사의 운행편·차량을 가리킨다', count(*), true
  from registrations r
  left join event_trips tu on tu.id = r.up_trip_id
  left join event_trips td on td.id = r.down_trip_id
  left join buses bu on bu.id = r.assigned_up_bus_id
  left join buses bd on bd.id = r.assigned_down_bus_id
 where (tu.id is not null and tu.event_id is distinct from r.event_id)
    or (td.id is not null and td.event_id is distinct from r.event_id)
    or (bu.id is not null and bu.event_id is distinct from r.event_id)
    or (bd.id is not null and bd.event_id is distinct from r.event_id);

insert into _consistency
select 72, '행사 격리 (event_id 가 여러 곳에 적혀 있다)',
       '이동수단 기록이 신청과 다른 행사에 달려 있다', count(*), true
  from transport_legs l
  join registrations r on r.id = l.registration_id
 where l.event_id is distinct from r.event_id;

-- ── ⑨ 방향 (26-A 가 만든 모양이 남아 있는가) ─────────────────
insert into _consistency
select 80, '차량 ↔ 운행편 연결',
       '어느 편에도 안 붙은 차량 (화면에 나오지 않는다)', count(*), true
  from buses b
 where b.up_trip_id is null and b.down_trip_id is null;

-- 정보성: 방향별 대수가 다른 것 자체는 정상이다(작년 상행 11 / 하행 10).
-- 다만 **활성 행사**에서 한 방향만 뛰는 차가 있으면 26-A 의 흔적일 수 있어 세어 둔다.
insert into _consistency
select 81, '차량 ↔ 운행편 연결',
       '활성 행사에서 한 방향만 뛰는 차량 (정상일 수 있음 — 대수가 다른 해가 있다)',
       count(*), false
  from buses b
  join events e on e.id = b.event_id and e.is_active
 where (b.up_trip_id is null) <> (b.down_trip_id is null);

select ord, pair, finding, n,
       case when must_be_zero and n > 0 then '❌ 결함'
            when must_be_zero then '✅'
            else '· 참고' end as verdict
  from _consistency
 order by ord;

-- 종합 판정 — must_be_zero 인데 0 이 아닌 것이 하나라도 있으면 실패로 알린다.
select case when count(*) = 0
            then '정합성: 어긋난 쌍 없음 ✅'
            else '정합성: ' || count(*) || '종류가 어긋나 있습니다 ❌'
       end as "종합"
  from _consistency where must_be_zero and n > 0;
