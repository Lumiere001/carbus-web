-- ============================================================
-- profile_self_update RLS 정책: campus_id 변경 잠금 (보안 패치)
-- ============================================================
-- 문제: 기존 profile_self_update 정책의 WITH CHECK 가 role 만 잠그고
--   campus_id 는 잠그지 않았다. campus_admin(임역원)이 anon 키로 브라우저에서
--   UPDATE profiles SET campus_id = '<다른 캠퍼스>' WHERE id = auth.uid()
--   를 실행하면 current_campus() 가 그 캠퍼스를 반환 → reg_campus_admin_all
--   정책이 다른 캠퍼스 명단·정산을 전부 CRUD 허용. 캠퍼스 격리(RLS)가 뚫린다.
--
-- 수정: 본인 self-update 시 campus_id 를 현재값에서 변경 불가하도록 고정.
--   - role 잠금은 기존 그대로 유지.
--   - campus_id 는 NULL 가능(미배정/master)이라 = 대신 IS NOT DISTINCT FROM 사용.
--   - master 의 캠퍼스 재배정은 별도 정책 profile_master_all(OR 결합)로 계속 가능.
--   - 데이터 행 변경 0건 — 권한 규칙만 재정의.
-- ============================================================

DROP POLICY IF EXISTS profile_self_update ON profiles;

CREATE POLICY profile_self_update ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
    AND campus_id IS NOT DISTINCT FROM
        (SELECT campus_id FROM profiles WHERE id = auth.uid())
  );
  -- 본인이 자신의 role·campus_id 를 못 바꾸도록 (master 는 profile_master_all 로 우회)
