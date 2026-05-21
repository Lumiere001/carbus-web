-- 마감(phase2) 전환 시각 기록 — '마감 후 변동' 화면의 기준점.
-- phase2 로 전환할 때 now() 로 갱신(코드에서 set), phase1 로 되돌리면 null.
ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS phase2_started_at timestamptz;
