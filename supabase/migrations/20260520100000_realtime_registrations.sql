-- ============================================================
-- registrations 테이블 Realtime 활성화 (Phase B.4)
-- ============================================================
-- 왜? /campus grid에서 같은 캠퍼스 임역원이 동시 작업 시,
-- 다른 사람의 INSERT/UPDATE/DELETE를 실시간으로 grid에 반영.
-- RLS가 적용되므로 각 임역원은 본인 캠퍼스 변경만 수신.
--
-- 적용: Supabase Dashboard SQL Editor에 paste → Run (운영자).
-- (또는 Dashboard → Database → Replication에서 registrations 토글)
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE registrations;

-- 검증: SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime';
--   → registrations 행이 보이면 활성
