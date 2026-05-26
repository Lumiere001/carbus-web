-- ============================================================
-- 20260522190001_attendance_self_constraints — chk_self + fee 갱신 + 뷰 재생성
-- ============================================================
-- 선행 마이그(20260522190000)에서 enum 'self' 값이 추가되어 있어야 함.
-- 이 마이그는 'self' 의 데이터 형태 강제 + 차량비 0 + 결제 통계에서 self 제외.

-- ------------------------------------------------------------
-- 1. chk_self — 'self' 행은 슬롯 없음 + 하행 미이용을 강제
-- ------------------------------------------------------------
ALTER TABLE registrations ADD CONSTRAINT chk_self CHECK (
  attendance_type <> 'self'
  OR (departure_slot_id IS NULL AND uses_return_bus = false)
);

-- ------------------------------------------------------------
-- 2. fee GENERATED 컬럼 재정의 — self → 0
-- ------------------------------------------------------------
-- Postgres 는 GENERATED 식을 ALTER 로 변경 못해서 DROP/ADD 가 필요.
-- fee 를 참조하는 뷰는 CASCADE 로 같이 떨어졌다가 아래에서 재생성.
DROP VIEW IF EXISTS v_payment_3way_comparison;
DROP VIEW IF EXISTS v_payment_summary;
ALTER TABLE registrations DROP COLUMN fee;
ALTER TABLE registrations ADD COLUMN fee int GENERATED ALWAYS AS (
  CASE
    WHEN attendance_type = 'roundtrip' THEN 50000
    WHEN attendance_type = 'oneway'    THEN 25000
    ELSE 0  -- 'self' (버스 미이용) 등
  END
) STORED;

-- ------------------------------------------------------------
-- 3. v_payment_summary 재생성 — self 는 결제 통계에서 제외(부과 대상 아님)
-- ------------------------------------------------------------
CREATE VIEW v_payment_summary AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COUNT(*) FILTER (WHERE r.payment_status = 'unpaid') AS unpaid_count,
  COUNT(*) FILTER (WHERE r.payment_status = 'paid')   AS paid_count,
  COUNT(*) FILTER (WHERE r.payment_status = 'waived') AS waived_count,
  COALESCE(SUM(r.fee) FILTER (WHERE r.payment_status = 'paid'),   0) AS paid_total,
  COALESCE(SUM(r.fee) FILTER (WHERE r.payment_status = 'unpaid'), 0) AS unpaid_total
FROM campuses c
LEFT JOIN registrations r
  ON r.campus_id = c.id
  AND r.attendance_type IN ('roundtrip', 'oneway')
GROUP BY c.id, c.name
ORDER BY c.display_order;

-- ------------------------------------------------------------
-- 4. v_payment_3way_comparison 재생성 (정의 그대로 — v_payment_summary 의존)
-- ------------------------------------------------------------
CREATE VIEW v_payment_3way_comparison AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COALESCE(p.paid_total, 0)             AS system_paid_total,
  s.campus_remitted_total,
  s.master_received_total,
  COALESCE(p.paid_total, 0) - s.campus_remitted_total AS diff_system_vs_campus,
  s.campus_remitted_total - s.master_received_total   AS diff_campus_vs_master,
  COALESCE(p.paid_total, 0) - s.master_received_total AS diff_system_vs_master
FROM campuses c
JOIN campus_payment_settlements s ON s.campus_id = c.id
LEFT JOIN v_payment_summary p     ON p.campus_id = c.id
ORDER BY c.display_order;

-- 재생성된 뷰에 security_invoker 재적용 (20260521110000 정책 유지)
ALTER VIEW v_payment_summary         SET (security_invoker = on);
ALTER VIEW v_payment_3way_comparison SET (security_invoker = on);

-- ------------------------------------------------------------
-- 5. v_campus_stats — self_count 노출 (column 추가는 끝쪽이라 CREATE OR REPLACE 가능)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_campus_stats AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COUNT(*) FILTER (WHERE r.attendance_type = 'roundtrip') AS roundtrip_count,
  COUNT(*) FILTER (WHERE r.attendance_type = 'oneway')    AS oneway_count,
  COUNT(*)                                                AS total,
  COUNT(*) FILTER (WHERE r.attendance_type = 'self')      AS self_count
FROM campuses c
LEFT JOIN registrations r ON r.campus_id = c.id
GROUP BY c.id, c.name
ORDER BY c.display_order;
ALTER VIEW v_campus_stats SET (security_invoker = on);
