-- ============================================================
-- 버그 A 수정 — v_campus_stats.total 집계 오류
-- ============================================================
-- 문제: total = COUNT(*) 이라 campuses LEFT JOIN registrations 에서
--       신청 0건인 캠퍼스도 NULL 행 1개를 1로 카운트 → total=1.
--       대시보드 "총 신청 인원" KPI + "캠퍼스별 신청 인원" 부풀려짐.
-- 수정: COUNT(*) → COUNT(r.id) (NULL 행 제외).
--       roundtrip_count·oneway_count 는 FILTER 절이라 이미 정상.
-- ============================================================

CREATE OR REPLACE VIEW v_campus_stats AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COUNT(*) FILTER (WHERE r.attendance_type = 'roundtrip') AS roundtrip_count,
  COUNT(*) FILTER (WHERE r.attendance_type = 'oneway')    AS oneway_count,
  COUNT(r.id)                                             AS total
FROM campuses c
LEFT JOIN registrations r ON r.campus_id = c.id
GROUP BY c.id, c.name
ORDER BY c.display_order;
