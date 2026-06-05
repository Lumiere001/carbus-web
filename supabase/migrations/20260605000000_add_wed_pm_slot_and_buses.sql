-- ============================================================
-- 20260605000000 — 수 오후 7시 슬롯 추가 + 버스 11대 재구성
-- ============================================================
-- 운영 변동 확정(2026-06-05): 화 오전 9대 / 화 오후 1대 / 수 오후 1대.
--   호차: 1~9호차 = 화 오전, 10호차 = 화 오후, 11호차 = 수 오후.
--   (기존: 1~8호차 = 화 오전, 9호차 = 화 오후 → 9호차를 화 오전으로 재배정 + 10·11호차 신규)
--
-- 코드 변경 0건: 슬롯이 departure_slots 데이터라, 행 추가만으로
--   프리셋("왕복/편도상행 (수 오후 7시)")·배차 엔진·뷰(v_day_capacity)·
--   대시보드 상행 정원이 전부 자동 반영된다.
--
-- 비파괴: 슬롯 INSERT · 버스 INSERT · 9호차 슬롯 재배정뿐. 신청·정산 데이터 무손상.
-- idempotent: 재실행해도 동일 상태로 수렴 (ON CONFLICT).
--
-- ⚠️ 적용 후: 이미 상행 배차를 돌린 상태라면 master가 상행 배차를 1회 재실행할 것.
--   (화 오후 신청자는 10호차로, 수 오후 신청자는 11호차로 새로 배정되도록)
-- ============================================================

BEGIN;

-- 1. 수 오후 7시 슬롯 추가 (display_order 30 → tue_am=10 · tue_pm=20 다음)
INSERT INTO departure_slots (key, label, display_order, active)
VALUES ('wed_pm', '수 오후 7시', 30, true)
ON CONFLICT (key) DO UPDATE
  SET label         = EXCLUDED.label,
      display_order = EXCLUDED.display_order,
      active        = true;

-- 2. 9호차: 화 오후 → 화 오전 재배정
UPDATE buses
SET departure_slot_id = (SELECT id FROM departure_slots WHERE key = 'tue_am')
WHERE name = '9호차';

-- 3. 10호차 = 화 오후 (신규)
INSERT INTO buses (name, capacity, hard_cap, departure_slot_id)
VALUES ('10호차', 44, 45, (SELECT id FROM departure_slots WHERE key = 'tue_pm'))
ON CONFLICT (name) DO UPDATE
  SET departure_slot_id = EXCLUDED.departure_slot_id;

-- 4. 11호차 = 수 오후 (신규)
INSERT INTO buses (name, capacity, hard_cap, departure_slot_id)
VALUES ('11호차', 44, 45, (SELECT id FROM departure_slots WHERE key = 'wed_pm'))
ON CONFLICT (name) DO UPDATE
  SET departure_slot_id = EXCLUDED.departure_slot_id;

COMMIT;

-- 적용 검증용 (자동 실행 X, 참고):
--   SELECT b.name, s.label FROM buses b
--   JOIN departure_slots s ON s.id = b.departure_slot_id ORDER BY b.id;
--   → 1~9호차=화 오전 9시, 10호차=화 오후 7시, 11호차=수 오후 7시
