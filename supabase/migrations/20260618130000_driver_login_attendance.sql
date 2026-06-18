-- ============================================================
-- 20260618130000_driver_login_attendance — 차량순장 로그인 + 출석 권한 재정비
-- ============================================================
-- · profiles.driver_bus_id: 담당 호차 (role 과 독립 — 임역원이면서 차량순장도 가능).
--   master 가 배정하기 전(NULL)에는 /driver 진입 불가(= 승인 게이트).
-- · set_attendance RPC: 출석체크는 master + 해당 호차 차량순장만 (SECURITY DEFINER).
-- · reg_driver_select: 차량순장은 본인 호차(상행/하행) 명단만 SELECT.
-- · guard_attendance_update 트리거: 직접 UPDATE 우회 시에도 동일 권한 강제
--   (임역원 campus_admin 의 출석 변경 차단). service_role/마이그/스크립트는 통과.
-- 비파괴(컬럼·함수·정책·트리거 추가만). 라이브 안전. enum 변경 없음.

BEGIN;

-- ------------------------------------------------------------
-- 1. profiles.driver_bus_id — 담당 호차 (role 과 독립)
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS driver_bus_id int REFERENCES public.buses(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 2. 현재 사용자의 담당 호차 (RLS·트리거·RPC용). current_campus() 와 동일 패턴.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_driver_bus()
RETURNS int
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT driver_bus_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ------------------------------------------------------------
-- 3. 차량순장: 본인 호차(상행 또는 하행) 명단 SELECT
-- ------------------------------------------------------------
DROP POLICY IF EXISTS reg_driver_select ON public.registrations;
CREATE POLICY reg_driver_select ON public.registrations
  FOR SELECT
  USING (
    public.current_driver_bus() IS NOT NULL
    AND (
      assigned_up_bus_id = public.current_driver_bus()
      OR assigned_down_bus_id = public.current_driver_bus()
    )
  );

-- ------------------------------------------------------------
-- 4. 출석체크 RPC — master + 해당 호차 차량순장만.
--    checked_in = 상행 호차 기준, checked_out = 하행 호차 기준.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_attendance(
  p_reg_id uuid,
  p_field  text,
  p_value  boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid    uuid := auth.uid();
  v_role user_role;
  v_bus  int;
  v_up   int;
  v_down int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  IF p_field NOT IN ('checked_in', 'checked_out') THEN
    RAISE EXCEPTION '잘못된 필드: %', p_field;
  END IF;

  SELECT role, driver_bus_id INTO v_role, v_bus
    FROM public.profiles WHERE id = uid;
  SELECT assigned_up_bus_id, assigned_down_bus_id INTO v_up, v_down
    FROM public.registrations WHERE id = p_reg_id;

  -- 권한: master 전체 / 그 외(차량순장)는 해당 방향의 본인 호차만
  IF v_role IS DISTINCT FROM 'master' THEN
    IF p_field = 'checked_in' AND (v_bus IS NULL OR v_bus IS DISTINCT FROM v_up) THEN
      RAISE EXCEPTION '출석체크 권한 없음 (본인 상행 호차가 아닙니다)';
    END IF;
    IF p_field = 'checked_out' AND (v_bus IS NULL OR v_bus IS DISTINCT FROM v_down) THEN
      RAISE EXCEPTION '출석체크 권한 없음 (본인 하행 호차가 아닙니다)';
    END IF;
  END IF;

  IF p_field = 'checked_in' THEN
    UPDATE public.registrations SET checked_in = p_value WHERE id = p_reg_id;
  ELSE
    UPDATE public.registrations SET checked_out = p_value WHERE id = p_reg_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_attendance(uuid, text, boolean) TO authenticated;

-- ------------------------------------------------------------
-- 5. 가드 트리거 — 직접 UPDATE 로 출석 변경 시에도 동일 권한 강제.
--    UI 는 RPC 를 쓰지만 API 직접 호출 우회를 막는 backstop.
--    출석 컬럼이 안 바뀌는 UPDATE(그리드 편집·배차 등)는 그대로 통과.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_attendance_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid         uuid := auth.uid();
  v_role      user_role;
  v_bus       int;
  changed_in  boolean := NEW.checked_in  IS DISTINCT FROM OLD.checked_in;
  changed_out boolean := NEW.checked_out IS DISTINCT FROM OLD.checked_out;
BEGIN
  IF uid IS NULL THEN
    RETURN NEW; -- service_role / 마이그 / 로컬 스크립트
  END IF;
  IF NOT (changed_in OR changed_out) THEN
    RETURN NEW; -- 출석 외 변경은 이 트리거 관심 밖
  END IF;

  SELECT role, driver_bus_id INTO v_role, v_bus
    FROM public.profiles WHERE id = uid;
  IF v_role = 'master' THEN
    RETURN NEW;
  END IF;
  IF changed_in AND (v_bus IS NULL OR v_bus IS DISTINCT FROM NEW.assigned_up_bus_id) THEN
    RAISE EXCEPTION '출석체크 권한 없음 (상행 호차 아님 / 임역원 불가)';
  END IF;
  IF changed_out AND (v_bus IS NULL OR v_bus IS DISTINCT FROM NEW.assigned_down_bus_id) THEN
    RAISE EXCEPTION '출석체크 권한 없음 (하행 호차 아님 / 임역원 불가)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_attendance ON public.registrations;
CREATE TRIGGER trg_guard_attendance
  BEFORE UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.guard_attendance_update();

-- ------------------------------------------------------------
-- 6. profile_self_update: driver_bus_id self-배정 잠금 (승인 게이트 보안)
--    (20260530 campus_id 잠금과 동일 — 본인이 driver_bus_id 를 못 바꾸게.
--     master 의 배정은 profile_master_all 정책으로 계속 가능.)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS profile_self_update ON public.profiles;
CREATE POLICY profile_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    AND campus_id IS NOT DISTINCT FROM
        (SELECT campus_id FROM public.profiles WHERE id = auth.uid())
    AND driver_bus_id IS NOT DISTINCT FROM
        (SELECT driver_bus_id FROM public.profiles WHERE id = auth.uid())
  );

COMMIT;
