-- 순장/순원 제외(삭제) 시 호차 고정탑승 배열에서 자동 제거.
-- 차량순장(driver_registration_id, down_driver_registration_id)은 FK ON DELETE SET NULL
-- 로 이미 정리되지만, fixed_passenger_ids[] 배열 원소는 FK가 없어 orphan 으로 남는다.
-- 이 트리거가 삭제되는 registration id 를 상행·하행 고정 배열 양쪽에서 제거한다.

CREATE OR REPLACE FUNCTION public.cleanup_bus_fixed_on_reg_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE buses
    SET fixed_passenger_ids = array_remove(fixed_passenger_ids, OLD.id)
    WHERE OLD.id = ANY(fixed_passenger_ids);
  UPDATE buses
    SET down_fixed_passenger_ids = array_remove(down_fixed_passenger_ids, OLD.id)
    WHERE OLD.id = ANY(down_fixed_passenger_ids);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_cleanup_bus_fixed_on_reg_delete ON registrations;
CREATE TRIGGER trg_cleanup_bus_fixed_on_reg_delete
  BEFORE DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_bus_fixed_on_reg_delete();
