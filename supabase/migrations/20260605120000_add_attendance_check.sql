-- ============================================================
-- 20260605120000 — 현장 출석 체크 (도착/귀가) 컬럼 추가
-- ============================================================
-- 임역원이 /campus 명단 그리드에서 현장 도착/귀가를 한 번 탭으로 체크.
--   checked_in  = 도착(현장 출석, 전원 대상)
--   checked_out = 귀가(하행 버스 탑승, uses_return_bus=true 대상만 UI 활성)
-- 추가형(ADD COLUMN DEFAULT false)이라 비파괴 — 기존 신청/정산 데이터 무손상.
-- 기존 행은 전부 false(미체크). idempotent (IF NOT EXISTS).
--
-- 권한: campus_admin 가 본인 캠퍼스 행에 토글. reg_campus_admin_all(RLS)로 허용되고,
--   컬럼 가드 트리거(guard_assignment_columns / guard_roles_column)는
--   assigned_*bus_id·roles 만 막으므로 이 컬럼엔 영향 없음.
-- ============================================================

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS checked_in  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_out boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN registrations.checked_in  IS '현장 도착(출석) 체크 — 전원 대상';
COMMENT ON COLUMN registrations.checked_out IS '귀가(하행 버스 탑승) 체크 — uses_return_bus=true 대상';
