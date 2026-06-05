-- ============================================================
-- 20260605140000 — v_day_capacity 에 슬롯별 도착 카운트 추가
-- ============================================================
-- 출발 시간대별(화 오전/화 오후/수 오후) 출석률 표시용.
--   arrived = 해당 슬롯 신청자 중 도착(checked_in) 인원.
-- 뷰만 재정의(비파괴). security_invoker 재적용.
-- ⚠️ arrived 를 컬럼 중간에 추가 → CREATE OR REPLACE 는 컬럼 순서 변경을 거부하므로
--    DROP + CREATE 로 처리(의존 뷰 없음). 향후 v_day_capacity 컬럼 순서 변경 시 동일 패턴.
-- ============================================================

DROP VIEW IF EXISTS v_day_capacity;
CREATE VIEW v_day_capacity AS
SELECT
  s.id    AS slot_id,
  s.key   AS slot_key,
  s.label AS slot_label,
  s.display_order,
  COALESCE(SUM(b.capacity), 0)                               AS total_capacity,
  (SELECT COUNT(*) FROM registrations r
    WHERE r.departure_slot_id = s.id)                        AS total_passengers,
  (SELECT COUNT(*) FROM registrations r
    WHERE r.departure_slot_id = s.id AND r.checked_in)       AS arrived,
  COALESCE(SUM(b.capacity), 0)
    - (SELECT COUNT(*) FROM registrations r
        WHERE r.departure_slot_id = s.id)                    AS remaining_seats
FROM departure_slots s
LEFT JOIN buses b ON b.departure_slot_id = s.id
WHERE s.active
GROUP BY s.id, s.key, s.label, s.display_order
ORDER BY s.display_order;

ALTER VIEW v_day_capacity SET (security_invoker = on);
