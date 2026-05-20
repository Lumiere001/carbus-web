-- ============================================================
-- 카카오 → Google OAuth 전환 (MIGRATION 결정 #1 개정)
-- ============================================================
-- 왜? Supabase 내장 카카오 provider가 account_email scope를 강제 (GitHub #36878).
-- 카카오는 그 scope를 사업자 인증 앱에만 허용 → 개인 개발자 앱은 KOE205로 로그인 불가.
-- Google OAuth는 이런 제약 없음. 임역원 대부분 Google 계정 보유.
--
-- 적용: Supabase Dashboard SQL Editor에 paste → Run (운영자).
-- ============================================================

-- 1. profiles.kakao_id → provider_id (provider 중립적 이름)
ALTER TABLE profiles RENAME COLUMN kakao_id TO provider_id;

-- 2. handle_new_user 트리거 재정의 — Google raw_user_meta_data 매핑
--    Google OIDC: sub(고유 id), name/full_name(이름), email, picture
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, provider_id, display_name)
  VALUES (
    NEW.id,
    'guest',
    COALESCE(
      NEW.raw_user_meta_data->>'provider_id',
      NEW.raw_user_meta_data->>'sub'
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'email'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

-- 트리거 자체(on_auth_user_created)는 함수 이름으로 연결돼 있어 재생성 불필요.

-- ============================================================
-- 적용 후 검증 (Supabase SQL Editor)
-- ============================================================
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='profiles' AND column_name IN ('provider_id','kakao_id');
--   → provider_id 1행만 (kakao_id 없음)
