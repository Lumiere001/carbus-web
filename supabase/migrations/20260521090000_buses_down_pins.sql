-- 하행(내려올 때) 차량순장·고정탑승 지원.
-- 상행과 하행은 호차 구성이 독립적이므로(같은 사람도 상/하행 호차가 다름),
-- 차량순장·고정탑승도 방향별로 따로 둔다. 기존 driver_registration_id/
-- fixed_passenger_ids 는 상행 전용, 아래 down_* 컬럼이 하행 전용.

ALTER TABLE buses
  ADD COLUMN IF NOT EXISTS down_driver_registration_id uuid,
  ADD COLUMN IF NOT EXISTS down_fixed_passenger_ids uuid[] NOT NULL DEFAULT '{}';

-- registrations 삭제 시 참조 정리 (상행 driver 와 동일 정책)
ALTER TABLE buses
  DROP CONSTRAINT IF EXISTS buses_down_driver_registration_id_fkey;
ALTER TABLE buses
  ADD CONSTRAINT buses_down_driver_registration_id_fkey
  FOREIGN KEY (down_driver_registration_id) REFERENCES registrations(id) ON DELETE SET NULL;

COMMENT ON COLUMN buses.down_driver_registration_id IS '하행 차량순장 1인 고정 (상행 driver_registration_id 와 별개)';
COMMENT ON COLUMN buses.down_fixed_passenger_ids IS '하행 강제 탑승 명단 (상행 fixed_passenger_ids 와 별개)';
