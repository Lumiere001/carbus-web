-- ============================================================
-- 20260522190000_attendance_self_enum — attendance_type 에 'self' 값 추가
-- ============================================================
-- 왜 분리? Postgres 는 같은 트랜잭션 내에서 ADD VALUE 된 enum 값을
-- 즉시 참조(CHECK·뷰 정의 등)할 수 없음. 새 값 사용은 다음 마이그(20260522190001)에서.

ALTER TYPE attendance_type ADD VALUE 'self';
