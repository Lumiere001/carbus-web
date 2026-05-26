-- ============================================================
-- 20260522200000_fix_campus_stats_total_regression — total 카운트 회귀 픽스
-- ============================================================
-- 회귀: 20260522190001 에서 v_campus_stats 를 재생성할 때 total 을 COUNT(*) 로
-- 다시 써서 2026-05-20 의 버그A 픽스(COUNT(*) → COUNT(r.id))가 되돌아감.
-- LEFT JOIN 특성상 등록자 0인 캠퍼스도 NULL row 가 한 줄 생겨 COUNT(*)=1 → "계 1" 표시 버그.
-- COUNT(r.id) 는 NULL 이면 0 → 올바른 동작.
-- 나머지 *_count 는 FILTER 가 NULL r.attendance_type 에서 false → 0 이라 영향 없음.

CREATE OR REPLACE VIEW v_campus_stats AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COUNT(*) FILTER (WHERE r.attendance_type = 'roundtrip') AS roundtrip_count,
  COUNT(*) FILTER (WHERE r.attendance_type = 'oneway')    AS oneway_count,
  COUNT(r.id)                                              AS total,
  COUNT(*) FILTER (WHERE r.attendance_type = 'self')      AS self_count
FROM campuses c
LEFT JOIN registrations r ON r.campus_id = c.id
GROUP BY c.id, c.name
ORDER BY c.display_order;
ALTER VIEW v_campus_stats SET (security_invoker = on);
