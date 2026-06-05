-- ============================================================
-- 20260605130000 — v_campus_stats 에 출석 카운트 추가
-- ============================================================
-- 대시보드 출석률 카드 + 캠퍼스별 도착 표시용.
--   arrived_count   = 도착(checked_in) 인원
--   return_target   = 하행 이용(uses_return_bus) 대상 인원
--   returned_count  = 귀가(checked_out) 인원
-- 뷰만 재정의(비파괴). security_invoker 재적용(viewer/master 권한 그대로 통과).
-- ============================================================

CREATE OR REPLACE VIEW v_campus_stats AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COUNT(*) FILTER (WHERE r.attendance_type = 'roundtrip') AS roundtrip_count,
  COUNT(*) FILTER (WHERE r.attendance_type = 'oneway')    AS oneway_count,
  COUNT(r.id)                                              AS total,
  COUNT(*) FILTER (WHERE r.attendance_type = 'self')      AS self_count,
  COUNT(*) FILTER (WHERE r.checked_in)                     AS arrived_count,
  COUNT(*) FILTER (WHERE r.uses_return_bus)                AS return_target,
  COUNT(*) FILTER (WHERE r.checked_out)                    AS returned_count
FROM campuses c
LEFT JOIN registrations r ON r.campus_id = c.id
GROUP BY c.id, c.name
ORDER BY c.display_order;

ALTER VIEW v_campus_stats SET (security_invoker = on);
