-- QA 보완 (출시 전): ① 임역원의 배정 컬럼 직접 변경 차단 ② 집계 뷰 RLS 적용

-- ─────────────────────────────────────────────────────────────
-- ① S1: 배정(호차) 컬럼 가드
--   reg_campus_admin_all 정책이 본인 캠퍼스 행의 모든 컬럼 UPDATE 를 허용하므로,
--   임역원이 클라이언트 검증(setAssignment)을 우회해 assigned_*_bus_id 를 직접
--   바꿀 수 있다. 배차는 총단 운영자(master) 권한이므로 트리거로 차단한다.
--   master / service_role(current_role() = NULL) 은 통과 → 배차 실행·운영 스크립트 정상.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_assignment_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.current_role() = 'campus_admin' AND (
        NEW.assigned_up_bus_id   IS DISTINCT FROM OLD.assigned_up_bus_id
     OR NEW.assigned_down_bus_id IS DISTINCT FROM OLD.assigned_down_bus_id
  ) THEN
    RAISE EXCEPTION '배차(호차 배정)는 총단 운영자만 변경할 수 있습니다';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reg_guard_assignment ON registrations;
CREATE TRIGGER trg_reg_guard_assignment
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.guard_assignment_columns();

-- ─────────────────────────────────────────────────────────────
-- ② S2: 집계 뷰 security_invoker = on
--   뷰 기본값(invoker off)은 뷰 소유자 권한으로 실행되어 RLS 를 우회한다.
--   → 임역원/게스트가 v_payment_* 등을 직접 조회하면 전 캠퍼스 금액이 노출.
--   security_invoker 를 켜면 호출자 RLS 로 평가 → 임역원은 본인 캠퍼스만 보게 된다.
--   (buses·campuses·system_config·role_labels 는 authenticated 읽기 허용,
--    registrations·settlements 는 viewer/master 전체·campus_admin 본인 → 대시보드 정상)
-- ─────────────────────────────────────────────────────────────
ALTER VIEW v_payment_summary         SET (security_invoker = on);
ALTER VIEW v_payment_3way_comparison SET (security_invoker = on);
ALTER VIEW v_campus_stats            SET (security_invoker = on);
ALTER VIEW v_bus_occupancy           SET (security_invoker = on);
ALTER VIEW v_day_capacity            SET (security_invoker = on);
