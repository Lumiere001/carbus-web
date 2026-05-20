-- ============================================================
-- campus_remit — campus_admin 의 본인 캠퍼스 송금액 등록 RPC
-- ============================================================
-- 왜? campus_payment_settlements 의 RLS 는 campus_admin 에게 SELECT 만 허용.
--     3중 비교의 무결성을 위해 campus_admin 이 master_received_* 컬럼을
--     건드리지 못하게 컬럼 단위로 막아야 함 (RLS 는 행 단위라 부족).
--     → SECURITY DEFINER 함수로 campus_remitted_* 만 갱신.
--     master 는 settle_master_all 정책으로 master_received_* 직접 upsert.
-- ============================================================

CREATE OR REPLACE FUNCTION public.campus_remit(p_total int, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus uuid := public.current_campus();
BEGIN
  IF public.current_role() <> 'campus_admin' THEN
    RAISE EXCEPTION 'campus_admin만 캠퍼스 송금액을 등록할 수 있습니다';
  END IF;
  IF v_campus IS NULL THEN
    RAISE EXCEPTION '담당 캠퍼스가 지정되지 않았습니다';
  END IF;
  IF p_total < 0 THEN
    RAISE EXCEPTION '송금액은 0 이상이어야 합니다';
  END IF;

  INSERT INTO campus_payment_settlements
    (campus_id, campus_remitted_total, campus_remitted_note,
     campus_remitted_at, campus_remitted_by)
  VALUES
    (v_campus, p_total, p_note, now(), auth.uid())
  ON CONFLICT (campus_id) DO UPDATE
    SET campus_remitted_total = EXCLUDED.campus_remitted_total,
        campus_remitted_note  = EXCLUDED.campus_remitted_note,
        campus_remitted_at    = now(),
        campus_remitted_by    = auth.uid(),
        updated_at            = now();
END $$;

GRANT EXECUTE ON FUNCTION public.campus_remit(int, text) TO authenticated;
