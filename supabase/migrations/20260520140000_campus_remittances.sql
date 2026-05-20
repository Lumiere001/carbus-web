-- ============================================================
-- campus_remittances — 캠퍼스 → 총단 송금 원장 (누적 로그)
-- ============================================================
-- 왜? 송금은 여러 번 나눠 일어남 (걷힌 돈 일부만, 마감 맞춰 분할 송금).
--     단일 합계(campus_payment_settlements.campus_remitted_total)로는
--     이력 추적 불가 → 항목 단위 원장 + 누계 동기화.
-- 모델: 걷어야 할(목표) / 걷힌(완납) / 총단 송금 누계 / 캠퍼스 보유 잔액.
-- ============================================================

CREATE TABLE campus_remittances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid NOT NULL REFERENCES campuses(id) ON DELETE CASCADE,
  amount      int  NOT NULL CHECK (amount > 0),
  note        text,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_remit_campus_time ON campus_remittances(campus_id, created_at DESC);

ALTER TABLE campus_remittances ENABLE ROW LEVEL SECURITY;

CREATE POLICY remit_campus_admin_select ON campus_remittances
  FOR SELECT TO authenticated
  USING (public.current_role() = 'campus_admin' AND campus_id = public.current_campus());

CREATE POLICY remit_staff_select ON campus_remittances
  FOR SELECT TO authenticated
  USING (public.current_role() IN ('viewer', 'master'));

CREATE POLICY remit_master_all ON campus_remittances
  FOR ALL TO authenticated
  USING (public.current_role() = 'master')
  WITH CHECK (public.current_role() = 'master');

-- 원장 변경 시 campus_payment_settlements.campus_remitted_total = SUM 동기화
-- (3중 비교 뷰 v_payment_3way_comparison 가 campus_remitted_total 을 읽으므로 유지).
CREATE OR REPLACE FUNCTION public.sync_campus_remitted_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid := COALESCE(NEW.campus_id, OLD.campus_id);
BEGIN
  INSERT INTO campus_payment_settlements (campus_id, campus_remitted_total, updated_at)
  VALUES (cid, (SELECT COALESCE(SUM(amount), 0) FROM campus_remittances WHERE campus_id = cid), now())
  ON CONFLICT (campus_id) DO UPDATE
    SET campus_remitted_total = EXCLUDED.campus_remitted_total, updated_at = now();
  RETURN NULL;
END $$;

CREATE TRIGGER trg_remit_sync
  AFTER INSERT OR UPDATE OR DELETE ON campus_remittances
  FOR EACH ROW EXECUTE FUNCTION public.sync_campus_remitted_total();

-- 송금 항목 추가 (campus_admin, 본인 캠퍼스, 양수만)
CREATE OR REPLACE FUNCTION public.campus_remit_add(p_amount int, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_campus uuid := public.current_campus();
BEGIN
  IF public.current_role() <> 'campus_admin' THEN
    RAISE EXCEPTION 'campus_admin만 송금을 등록할 수 있습니다';
  END IF;
  IF v_campus IS NULL THEN
    RAISE EXCEPTION '담당 캠퍼스가 지정되지 않았습니다';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION '송금액은 0보다 커야 합니다';
  END IF;
  INSERT INTO campus_remittances (campus_id, amount, note, created_by)
  VALUES (v_campus, p_amount, p_note, auth.uid());
END $$;
GRANT EXECUTE ON FUNCTION public.campus_remit_add(int, text) TO authenticated;

-- 송금 항목 삭제 (campus_admin 본인 캠퍼스 / master 전체)
CREATE OR REPLACE FUNCTION public.campus_remit_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_role() = 'campus_admin' THEN
    DELETE FROM campus_remittances WHERE id = p_id AND campus_id = public.current_campus();
  ELSIF public.current_role() = 'master' THEN
    DELETE FROM campus_remittances WHERE id = p_id;
  ELSE
    RAISE EXCEPTION '권한이 없습니다';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.campus_remit_delete(uuid) TO authenticated;

-- 구 campus_remit(총액 덮어쓰기) 폐기 — 이제 원장 항목 추가 방식 사용.
DROP FUNCTION IF EXISTS public.campus_remit(int, text);
