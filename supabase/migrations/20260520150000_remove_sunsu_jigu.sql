-- ============================================================
-- 순수지구 캠퍼스 제거 — 타지구 카테고리에 흡수
-- ============================================================
-- 순수지구는 별도 캠퍼스가 아니라 타지구에 포함되는 분류 →
-- 캠퍼스 목록·대시보드·정산 어디에도 별도로 나오지 않도록 제거.
-- 기존 데이터(있다면)는 타지구로 이전 후 캠퍼스 행 삭제.
-- ============================================================

DO $$
DECLARE
  v_sunsu uuid;
  v_etc   uuid;
BEGIN
  SELECT id INTO v_sunsu FROM campuses WHERE name = '순수지구';
  IF v_sunsu IS NULL THEN
    RAISE NOTICE '순수지구 캠퍼스 없음 — 건너뜀';
    RETURN;
  END IF;
  SELECT id INTO v_etc FROM campuses WHERE name = '타지구';

  -- 신청·임역원이 순수지구를 가리키면 타지구로 이전 (타지구 있을 때만)
  IF v_etc IS NOT NULL THEN
    UPDATE registrations SET campus_id = v_etc WHERE campus_id = v_sunsu;
    UPDATE profiles      SET campus_id = v_etc WHERE campus_id = v_sunsu;
  ELSE
    UPDATE profiles SET campus_id = NULL,
      role = CASE WHEN role = 'campus_admin' THEN 'guest' ELSE role END
     WHERE campus_id = v_sunsu;
  END IF;

  DELETE FROM campus_remittances          WHERE campus_id = v_sunsu;
  DELETE FROM campus_payment_settlements  WHERE campus_id = v_sunsu;
  DELETE FROM campuses                    WHERE id = v_sunsu;
END $$;
