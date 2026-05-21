-- 학번(student_id) 허용값에서 '간사' 제거. ('간사'는 학번이 아님 — 역할로만 관리)
-- 허용: 두 자리 숫자 / '외국인' / '타지구'.
-- 기존 student_id='간사' 행은 더미 위주이므로 '타지구'로 옮긴 뒤 제약을 강화한다.
-- ⚠️ '간사' 역할(role_labels / registrations.roles[])과는 무관 — 그건 그대로 유지.

ALTER TABLE registrations DROP CONSTRAINT IF EXISTS chk_student_id_format;

UPDATE registrations SET student_id = '타지구' WHERE student_id = '간사';

ALTER TABLE registrations ADD CONSTRAINT chk_student_id_format CHECK (
  student_id ~ '^\d{2}$' OR student_id IN ('외국인', '타지구')
);
