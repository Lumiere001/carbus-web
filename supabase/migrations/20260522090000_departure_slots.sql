-- ============================================================
-- 20260522090000_departure_slots — 출발 슬롯 모델 (v1.1.1)
-- ============================================================
-- 왜? 상행 출발을 고정 enum(TUE/WED)에서 데이터 테이블(departure_slots)로 일반화.
--   광주 운행 현실 = 화 오전 9시 / 화 오후 7시. 수요일 상행·버스 증차가 생겨도
--   코드 변경 없이 행(row) 추가만으로 반영되도록.
-- 하행은 여전히 슬롯 무관(단일 풀) — 이 마이그는 상행 슬롯만 도입.
-- 데이터 매핑: 기존 TUE→tue_am, WED→tue_pm (순원 선택 보존).
-- 버스 운영 config: 8대 tue_am + 1대 tue_pm (handoff 확정). 기존 배정은 재배차로 갱신.

-- ------------------------------------------------------------
-- 1. departure_slots 테이블 + 시드
-- ------------------------------------------------------------
CREATE TABLE departure_slots (
  id            smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  key           text    NOT NULL UNIQUE,           -- 코드 식별자 (tue_am …)
  label         text    NOT NULL,                  -- UI 한글 라벨
  display_order int     NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO departure_slots (key, label, display_order) VALUES
  ('tue_am', '화 오전 9시', 10),
  ('tue_pm', '화 오후 7시', 20);

-- 공용 read-only RLS (buses·campuses 와 동일 패턴: 전원 읽기, master 쓰기)
ALTER TABLE departure_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY departure_slots_select ON departure_slots
  FOR SELECT TO authenticated USING (true);
CREATE POLICY departure_slots_master_all ON departure_slots
  FOR ALL TO authenticated
  USING (public.current_role() = 'master')
  WITH CHECK (public.current_role() = 'master');

-- ------------------------------------------------------------
-- 2. buses.departure_slot_id (departure_day 대체)
-- ------------------------------------------------------------
ALTER TABLE buses ADD COLUMN departure_slot_id smallint REFERENCES departure_slots(id);

-- 운영 config: 전부 화 오전, 9호차만 화 오후 (8 + 1).
UPDATE buses SET departure_slot_id = (SELECT id FROM departure_slots WHERE key = 'tue_am');
UPDATE buses SET departure_slot_id = (SELECT id FROM departure_slots WHERE key = 'tue_pm')
  WHERE name = '9호차';

ALTER TABLE buses ALTER COLUMN departure_slot_id SET NOT NULL;

-- ------------------------------------------------------------
-- 3. registrations.departure_slot_id (departure_day 대체, nullable=하행편도)
-- ------------------------------------------------------------
ALTER TABLE registrations ADD COLUMN departure_slot_id smallint REFERENCES departure_slots(id);

UPDATE registrations SET departure_slot_id = (SELECT id FROM departure_slots WHERE key = 'tue_am')
  WHERE departure_day = 'TUE';
UPDATE registrations SET departure_slot_id = (SELECT id FROM departure_slots WHERE key = 'tue_pm')
  WHERE departure_day = 'WED';
-- departure_day IS NULL (하행편도) → departure_slot_id 도 NULL 유지.

-- ------------------------------------------------------------
-- 4. CHECK 제약 재작성 (departure_day → departure_slot_id)
-- ------------------------------------------------------------
ALTER TABLE registrations DROP CONSTRAINT chk_roundtrip;
ALTER TABLE registrations DROP CONSTRAINT chk_oneway;

ALTER TABLE registrations ADD CONSTRAINT chk_roundtrip CHECK (
  attendance_type <> 'roundtrip'
  OR (departure_slot_id IS NOT NULL AND uses_return_bus = true)
);

ALTER TABLE registrations ADD CONSTRAINT chk_oneway CHECK (
  attendance_type <> 'oneway'
  OR (departure_slot_id IS NOT NULL AND uses_return_bus = false)
  OR (departure_slot_id IS NULL     AND uses_return_bus = true)
);

-- ------------------------------------------------------------
-- 5. departure_day 컬럼 의존 뷰 DROP (컬럼 제거 전 선행)
-- ------------------------------------------------------------
DROP VIEW IF EXISTS v_day_capacity;
DROP VIEW IF EXISTS v_bus_occupancy;

-- ------------------------------------------------------------
-- 6. departure_day 컬럼·enum 제거
-- ------------------------------------------------------------
ALTER TABLE registrations DROP COLUMN departure_day;
ALTER TABLE buses          DROP COLUMN departure_day;
DROP TYPE departure_day;

-- ------------------------------------------------------------
-- 7. 뷰 재생성 (슬롯 기준)
-- ------------------------------------------------------------
-- 7.1 v_bus_occupancy — 호차별 탑승 현황 (departure_day → departure_slot_id)
CREATE VIEW v_bus_occupancy AS
SELECT
  b.id                                  AS bus_id,
  b.name                                AS bus_name,
  b.departure_slot_id,
  b.capacity,
  b.hard_cap,
  (SELECT COUNT(*) FROM registrations r WHERE r.assigned_up_bus_id   = b.id) AS up_passengers,
  (SELECT COUNT(*) FROM registrations r WHERE r.assigned_down_bus_id = b.id) AS down_passengers,
  b.capacity - (SELECT COUNT(*) FROM registrations r WHERE r.assigned_up_bus_id   = b.id) AS up_empty_seats,
  b.capacity - (SELECT COUNT(*) FROM registrations r WHERE r.assigned_down_bus_id = b.id) AS down_empty_seats
FROM buses b
ORDER BY b.id;

-- 7.2 v_day_capacity — 슬롯별 정원/인원/잔여 (구 요일별 → 슬롯별)
CREATE VIEW v_day_capacity AS
SELECT
  s.id                                                       AS slot_id,
  s.key                                                      AS slot_key,
  s.label                                                    AS slot_label,
  s.display_order,
  COALESCE(SUM(b.capacity), 0)                               AS total_capacity,
  (SELECT COUNT(*) FROM registrations r
    WHERE r.departure_slot_id = s.id)                        AS total_passengers,
  COALESCE(SUM(b.capacity), 0)
    - (SELECT COUNT(*) FROM registrations r
        WHERE r.departure_slot_id = s.id)                    AS remaining_seats
FROM departure_slots s
LEFT JOIN buses b ON b.departure_slot_id = s.id
WHERE s.active
GROUP BY s.id, s.key, s.label, s.display_order
ORDER BY s.display_order;

-- 재생성된 뷰에 security_invoker 재적용 (20260521110000 에서 설정했던 가드 유지)
ALTER VIEW v_bus_occupancy SET (security_invoker = on);
ALTER VIEW v_day_capacity  SET (security_invoker = on);
