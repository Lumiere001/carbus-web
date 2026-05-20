-- ============================================================
-- carbus-web 초기 스키마 마이그레이션 (v4.2)
-- ============================================================
-- SSOT: projects/carbus-web/reference/data_schemas.md
-- 대상: CCC 71기 광주지구 여름수련회 차량 신청·배차·정산 웹앱
-- 실행: Supabase Dashboard SQL Editor에 단일 paste 실행 가능
-- 적용 순서: ENUM → TABLE → ALTER(순환 FK) → INDEX → RLS 헬퍼
--           → RLS ENABLE+POLICY → TRIGGER → VIEW → SEED → 운영자 매핑
-- 주의: DROP IF EXISTS 미사용 (production 삭제 방지). 재실행 시 에러는 정상.
-- ============================================================


-- ============================================================
-- 1. ENUM 타입 정의
-- ============================================================
-- 왜 ENUM? 유한·고정 도메인을 DB 단에서 강제. 오타·버그 차단.
-- 값 추가는 ALTER TYPE ADD VALUE로 가능 (data_schemas.md §9.1).

-- 사용자 역할 4종
CREATE TYPE user_role AS ENUM ('guest', 'campus_admin', 'viewer', 'master');

-- 출발 요일 (초기 화/수만, 추후 'THU' 등 ALTER TYPE으로 확장)
CREATE TYPE departure_day AS ENUM ('TUE', 'WED');

-- 참석 유형: 왕복 / 편도 (상행만 또는 하행만)
CREATE TYPE attendance_type AS ENUM ('roundtrip', 'oneway');

-- 결제 상태: 미납/완납/면제 (간사·외국인 등 면제 케이스 존재)
CREATE TYPE payment_status AS ENUM ('unpaid', 'paid', 'waived');

-- audit 로그용 변경 유형
CREATE TYPE request_type AS ENUM ('insert', 'update', 'delete');

-- 시스템 운영 단계 (phase1=신청수집, phase2=배차후정산)
CREATE TYPE system_phase AS ENUM ('phase1', 'phase2');


-- ============================================================
-- 2. 테이블 정의
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 campuses — 캠퍼스 마스터 (18행 시드)
-- ------------------------------------------------------------
-- 왜 별도 테이블? 캠퍼스명 오타·표기 흔들림 방지 + display_order로 UI 정렬 일관성.
CREATE TABLE campuses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  display_order int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2.2 buses — 버스 마스터 (9대 시드)
-- ------------------------------------------------------------
-- 왜 capacity와 hard_cap 둘 다? capacity(44)=배차 목표, hard_cap(45)=절대 상한.
-- driver_registration_id는 "차량순장 1인 고정", fixed_passenger_ids[]는 "강제 탑승 명단".
-- 주의: buses ↔ registrations 순환 FK. 일단 컬럼만 만들고 REFERENCES는 ALTER로 추가.
CREATE TABLE buses (
  id                       serial PRIMARY KEY,
  name                     text NOT NULL UNIQUE,           -- '1호차' …
  capacity                 int  NOT NULL DEFAULT 44,
  hard_cap                 int  NOT NULL DEFAULT 45,
  departure_day            departure_day NOT NULL,
  driver_registration_id   uuid,                            -- FK는 registrations 생성 후 ALTER로 추가
  fixed_passenger_ids      uuid[] NOT NULL DEFAULT '{}'
);

-- ------------------------------------------------------------
-- 2.3 profiles — Supabase auth.users 1:1 확장
-- ------------------------------------------------------------
-- 왜 별도? auth.users는 Supabase 관리 테이블이라 직접 컬럼 추가 불가.
-- 앱 도메인 필드(역할·캠퍼스 매핑·카카오 ID)는 public.profiles로 분리.
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  kakao_id      text UNIQUE,
  display_name  text,
  role          user_role NOT NULL DEFAULT 'guest',
  campus_id     uuid REFERENCES campuses(id),     -- campus_admin인 경우 본인 담당 캠퍼스
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2.4 registrations — 신청 메인 테이블
-- ------------------------------------------------------------
-- 왜 컬럼 순서가 중요? 임역원 입력 UI 폼 순서 / 시스템 자동 계산 / 배차 결과 / 메타가
-- 테이블 스키마 순서와 일치해야 디버깅·SQL·관리자 화면이 직관적.
CREATE TABLE registrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- [임역원 입력 영역]
  name                  text NOT NULL,
  student_id            text NOT NULL,
  campus_id             uuid NOT NULL REFERENCES campuses(id),
  attendance_type       attendance_type NOT NULL,
  departure_day         departure_day,                       -- 하행편도면 NULL
  uses_return_bus       boolean NOT NULL DEFAULT false,
  note                  text,

  -- [시스템 자동 / master 전용]
  fee                   int GENERATED ALWAYS AS (
                          CASE WHEN attendance_type = 'roundtrip' THEN 50000
                               ELSE 25000 END
                        ) STORED,
  payment_status        payment_status NOT NULL DEFAULT 'unpaid',
  roles                 text[] NOT NULL DEFAULT '{}',        -- master만 편집 (RLS + 트리거)

  -- [배차 결과 영역]
  assigned_up_bus_id    int REFERENCES buses(id) ON DELETE SET NULL,
  assigned_down_bus_id  int REFERENCES buses(id) ON DELETE SET NULL,

  -- [메타]
  created_by            uuid REFERENCES profiles(id),
  version               int  NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- 동일인 중복 방지 (캠퍼스+학번+이름)
  CONSTRAINT uq_registrations_identity UNIQUE (campus_id, student_id, name),

  -- 왕복은 반드시 출발일 + 복귀 버스 사용
  CONSTRAINT chk_roundtrip CHECK (
    attendance_type <> 'roundtrip'
    OR (departure_day IS NOT NULL AND uses_return_bus = true)
  ),

  -- 편도: 상행편도(요일 있음 + 복귀 X) 또는 하행편도(요일 NULL + 복귀 O)
  CONSTRAINT chk_oneway CHECK (
    attendance_type <> 'oneway'
    OR (departure_day IS NOT NULL AND uses_return_bus = false)
    OR (departure_day IS NULL     AND uses_return_bus = true)
  ),

  -- 학번 형식: 두 자리 숫자 또는 특수값
  CONSTRAINT chk_student_id_format CHECK (
    student_id ~ '^\d{2}$' OR student_id IN ('간사', '외국인', '타지구')
  )
);

-- ------------------------------------------------------------
-- 2.5 buses ↔ registrations 순환 FK ALTER (registrations 생성 후)
-- ------------------------------------------------------------
-- 왜 ALTER로? buses 생성 시점엔 registrations 테이블이 없어 REFERENCES 불가.
-- registrations 생성 후 이제 안전하게 FK 추가.
ALTER TABLE buses
  ADD CONSTRAINT buses_driver_registration_id_fkey
  FOREIGN KEY (driver_registration_id) REFERENCES registrations(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- 2.6 registration_audit — 변동 이력
-- ------------------------------------------------------------
-- 왜 유지? 분쟁(배차·정산), 실수 복구, 임역원별 작업량 집계.
-- 전후 jsonb로 저장해 스키마 변경에도 깨지지 않음.
-- registration_id에 FK 없음 — registrations DELETE 시도 보존 위해 ID만 보관.
CREATE TABLE registration_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL,
  changed_by      uuid REFERENCES profiles(id),
  change_type     request_type NOT NULL,
  before_value    jsonb,
  after_value     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2.7 batch_runs — 배차 실행 이력
-- ------------------------------------------------------------
-- 왜? 배차는 멱등 아님(랜덤 요소·시드 변화). "언제·왜 돌렸나"가 분쟁 시 절대적 증거.
CREATE TABLE batch_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at          timestamptz NOT NULL DEFAULT now(),
  run_by          uuid REFERENCES profiles(id),
  trigger_reason  text,
  total_assigned  int,
  by_bus          jsonb,
  empty_seats     jsonb,
  success         boolean NOT NULL DEFAULT true,
  error_message   text,
  elapsed_ms      int
);

-- ------------------------------------------------------------
-- 2.8 campus_payment_settlements — 캠퍼스별 정산 (18행)
-- ------------------------------------------------------------
-- 왜 3중 비교? 시스템 자동 합계 ↔ 임역원 신고 송금액 ↔ master 통장 실입금.
-- 3개가 어긋나면 어느 단계 문제인지 즉시 분리 가능.
CREATE TABLE campus_payment_settlements (
  campus_id              uuid PRIMARY KEY REFERENCES campuses(id),
  campus_remitted_total  int NOT NULL DEFAULT 0,
  campus_remitted_at     timestamptz,
  campus_remitted_note   text,
  campus_remitted_by     uuid REFERENCES profiles(id),
  master_received_total  int NOT NULL DEFAULT 0,
  master_received_at     timestamptz,
  master_received_note   text,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2.9 system_config — 단일 행 운영 설정
-- ------------------------------------------------------------
-- 왜 단일 행? phase·배차 활성화 같은 전역 플래그는 행 1개여야 함. CHECK (id=1)로 강제.
CREATE TABLE system_config (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_phase  system_phase NOT NULL DEFAULT 'phase1',
  batch_enabled  boolean NOT NULL DEFAULT false,
  last_batch_at  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2.10 role_labels — 역할 라벨 (master CRUD)
-- ------------------------------------------------------------
-- 왜 별도 테이블? registrations.roles[]에 들어가는 라벨을 master가 동적으로 관리.
-- 색깔·순서도 함께 관리.
CREATE TABLE role_labels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL UNIQUE,
  color         text,                          -- tailwind color 키 또는 hex
  display_order int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- 3. 인덱스
-- ============================================================
-- 왜 이 컬럼들? 모든 view·페이지가 캠퍼스 필터링·배차 결과 조회 반복.
-- audit·batch_runs는 시간 역순 조회가 99%.
CREATE INDEX idx_reg_campus      ON registrations(campus_id);
CREATE INDEX idx_reg_up_bus      ON registrations(assigned_up_bus_id);
CREATE INDEX idx_reg_down_bus    ON registrations(assigned_down_bus_id);
CREATE INDEX idx_reg_payment     ON registrations(payment_status);
CREATE INDEX idx_reg_created_by  ON registrations(created_by);

CREATE INDEX idx_audit_reg_time  ON registration_audit(registration_id, created_at DESC);
CREATE INDEX idx_batch_runs_time ON batch_runs(run_at DESC);


-- ============================================================
-- 4. RLS 헬퍼 함수 (SECURITY DEFINER)
-- ============================================================
-- 왜 SECURITY DEFINER? 정책 내부에서 profiles SELECT 필요. RLS 재귀 호출 무한루프 우회.
-- 위치: public 스키마. Supabase Cloud는 auth 스키마에 사용자 함수 생성을 막음 (2024+).
-- auth.uid()는 Supabase 내장이라 그대로 사용 가능.

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS user_role
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_campus()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT campus_id FROM public.profiles WHERE id = auth.uid();
$$;


-- ============================================================
-- 5. RLS ENABLE + POLICY
-- ============================================================
-- 모든 테이블 RLS 활성화. 익명 정책은 어디에도 없음 (순장/순원 시스템 미접근).

-- ------------------------------------------------------------
-- 5.1 registrations
-- ------------------------------------------------------------
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY reg_campus_admin_all ON registrations
  FOR ALL TO authenticated
  USING (public.current_role() = 'campus_admin' AND campus_id = public.current_campus())
  WITH CHECK (public.current_role() = 'campus_admin' AND campus_id = public.current_campus());

CREATE POLICY reg_viewer_select ON registrations
  FOR SELECT TO authenticated
  USING (public.current_role() = 'viewer');

CREATE POLICY reg_master_all ON registrations
  FOR ALL TO authenticated
  USING (public.current_role() = 'master')
  WITH CHECK (public.current_role() = 'master');

-- roles[] 컬럼은 master 전용 — RLS는 row 단위라 트리거로 보완 (§6.5)

-- ------------------------------------------------------------
-- 5.2 profiles
-- ------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_self ON profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY profile_self_update ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM profiles WHERE id = auth.uid()));
  -- 본인이 자신의 role을 못 바꾸도록

CREATE POLICY profile_master_all ON profiles
  FOR ALL TO authenticated
  USING (public.current_role() = 'master')
  WITH CHECK (public.current_role() = 'master');

-- ------------------------------------------------------------
-- 5.3 공용 read-only 테이블 (buses, campuses, system_config, role_labels)
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['buses','campuses','system_config','role_labels'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format($f$CREATE POLICY %I_master_all ON %I FOR ALL TO authenticated USING (public.current_role()='master') WITH CHECK (public.current_role()='master')$f$, t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5.4 registration_audit
-- ------------------------------------------------------------
ALTER TABLE registration_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_campus_admin_select ON registration_audit
  FOR SELECT TO authenticated
  USING (
    public.current_role() = 'campus_admin'
    AND registration_id IN (
      SELECT id FROM registrations WHERE campus_id = public.current_campus()
    )
  );

CREATE POLICY audit_viewer_select ON registration_audit
  FOR SELECT TO authenticated USING (public.current_role() = 'viewer');

CREATE POLICY audit_master_all ON registration_audit
  FOR ALL TO authenticated
  USING (public.current_role() = 'master')
  WITH CHECK (public.current_role() = 'master');

-- ------------------------------------------------------------
-- 5.5 batch_runs
-- ------------------------------------------------------------
ALTER TABLE batch_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY batch_viewer_select ON batch_runs
  FOR SELECT TO authenticated USING (public.current_role() IN ('viewer','master'));

CREATE POLICY batch_master_all ON batch_runs
  FOR ALL TO authenticated
  USING (public.current_role() = 'master')
  WITH CHECK (public.current_role() = 'master');

-- ------------------------------------------------------------
-- 5.6 campus_payment_settlements
-- ------------------------------------------------------------
ALTER TABLE campus_payment_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY settle_campus_admin_select ON campus_payment_settlements
  FOR SELECT TO authenticated
  USING (public.current_role() = 'campus_admin' AND campus_id = public.current_campus());

CREATE POLICY settle_viewer_select ON campus_payment_settlements
  FOR SELECT TO authenticated USING (public.current_role() = 'viewer');

CREATE POLICY settle_master_all ON campus_payment_settlements
  FOR ALL TO authenticated
  USING (public.current_role() = 'master')
  WITH CHECK (public.current_role() = 'master');


-- ============================================================
-- 6. 트리거
-- ============================================================

-- ------------------------------------------------------------
-- 6.1 auth.users → profiles 자동 생성
-- ------------------------------------------------------------
-- 왜? 카카오 OAuth 첫 로그인 시 profiles row 없으면 RLS가 전부 막힘.
-- 사용자가 인지하기 전에 guest 프로필 선생성.
-- kakao_id·display_name도 raw_user_meta_data에서 best-effort 추출
-- (카카오 provider별 키가 다를 수 있어 COALESCE로 여러 후보 시도).
-- → /admin/users 임역원 목록에서 이름 표시용 (Phase D).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, kakao_id, display_name)
  VALUES (
    NEW.id,
    'guest',
    COALESCE(
      NEW.raw_user_meta_data->>'provider_id',
      NEW.raw_user_meta_data->>'sub'
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'nickname',
      NEW.raw_user_meta_data->>'user_name',
      NEW.raw_user_meta_data->>'preferred_username'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- 6.2 updated_at 자동 갱신
-- ------------------------------------------------------------
-- 왜? 앱 코드에서 매번 set하면 누락 위험. DB가 단일 진실원.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_reg_updated_at      BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_role_labels_updated_at BEFORE UPDATE ON role_labels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_sys_updated_at      BEFORE UPDATE ON system_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_settle_updated_at   BEFORE UPDATE ON campus_payment_settlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 6.3 registration_audit 자동 기록
-- ------------------------------------------------------------
-- 왜? 임역원·master가 안 적어도 DB가 강제 기록. version도 함께 증가.
CREATE OR REPLACE FUNCTION public.log_registration_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO registration_audit(registration_id, changed_by, change_type, after_value)
    VALUES (NEW.id, auth.uid(), 'insert', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.version = OLD.version + 1;
    INSERT INTO registration_audit(registration_id, changed_by, change_type, before_value, after_value)
    VALUES (NEW.id, auth.uid(), 'update', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO registration_audit(registration_id, changed_by, change_type, before_value)
    VALUES (OLD.id, auth.uid(), 'delete', to_jsonb(OLD));
    RETURN OLD;
  END IF;
END $$;

CREATE TRIGGER trg_reg_audit
  BEFORE INSERT OR UPDATE OR DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.log_registration_change();

-- ------------------------------------------------------------
-- 6.4 role_labels 변경 → registrations.roles[] 동기화
-- ------------------------------------------------------------
-- 왜? 라벨명 변경·삭제 시 이미 부여된 학생들 roles[]도 같이 갱신되어야 일관성 유지.
CREATE OR REPLACE FUNCTION public.sync_role_labels()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.label <> OLD.label THEN
    UPDATE registrations
       SET roles = array_replace(roles, OLD.label, NEW.label)
     WHERE OLD.label = ANY(roles);
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE registrations
       SET roles = array_remove(roles, OLD.label)
     WHERE OLD.label = ANY(roles);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_role_labels_sync
  AFTER UPDATE OR DELETE ON role_labels
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_labels();

-- ------------------------------------------------------------
-- 6.5 roles[] 컬럼 master 전용 가드
-- ------------------------------------------------------------
-- 왜? RLS는 row 단위라 특정 컬럼만 막기 어려움. 트리거로 campus_admin의 roles[] 변경 거부.
CREATE OR REPLACE FUNCTION public.guard_roles_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF public.current_role() <> 'master' AND NEW.roles IS DISTINCT FROM OLD.roles THEN
    RAISE EXCEPTION 'roles column is master-only';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_reg_guard_roles
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.guard_roles_column();


-- ============================================================
-- 7. VIEW (실시간 통계용)
-- ============================================================
-- 왜 VIEW? 매번 페이지에서 동일 집계 쿼리 짜면 RLS 평가·코드 중복. VIEW는 RLS 상속.

-- ------------------------------------------------------------
-- 7.1 v_payment_summary — 캠퍼스별 결제 요약
-- ------------------------------------------------------------
-- 왜 면제 합계 제외? 실수금 추적이 목적. 면제는 카운트만.
CREATE OR REPLACE VIEW v_payment_summary AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COUNT(*) FILTER (WHERE r.payment_status = 'unpaid') AS unpaid_count,
  COUNT(*) FILTER (WHERE r.payment_status = 'paid')   AS paid_count,
  COUNT(*) FILTER (WHERE r.payment_status = 'waived') AS waived_count,
  COALESCE(SUM(r.fee) FILTER (WHERE r.payment_status = 'paid'),   0) AS paid_total,
  COALESCE(SUM(r.fee) FILTER (WHERE r.payment_status = 'unpaid'), 0) AS unpaid_total
FROM campuses c
LEFT JOIN registrations r ON r.campus_id = c.id
GROUP BY c.id, c.name
ORDER BY c.display_order;

-- ------------------------------------------------------------
-- 7.2 v_payment_3way_comparison — 3중 비교
-- ------------------------------------------------------------
-- 왜? 시스템 자동 합계 ↔ 캠퍼스 신고 송금액 ↔ master 실입금. 단계별 어긋남 즉시 식별.
CREATE OR REPLACE VIEW v_payment_3way_comparison AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COALESCE(p.paid_total, 0)             AS system_paid_total,
  s.campus_remitted_total,
  s.master_received_total,
  COALESCE(p.paid_total, 0) - s.campus_remitted_total AS diff_system_vs_campus,
  s.campus_remitted_total - s.master_received_total   AS diff_campus_vs_master,
  COALESCE(p.paid_total, 0) - s.master_received_total AS diff_system_vs_master
FROM campuses c
JOIN campus_payment_settlements s ON s.campus_id = c.id
LEFT JOIN v_payment_summary p     ON p.campus_id = c.id
ORDER BY c.display_order;

-- ------------------------------------------------------------
-- 7.3 v_campus_stats — 캠퍼스별 신청 통계
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_campus_stats AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COUNT(*) FILTER (WHERE r.attendance_type = 'roundtrip') AS roundtrip_count,
  COUNT(*) FILTER (WHERE r.attendance_type = 'oneway')    AS oneway_count,
  COUNT(*)                                                AS total
FROM campuses c
LEFT JOIN registrations r ON r.campus_id = c.id
GROUP BY c.id, c.name
ORDER BY c.display_order;

-- ------------------------------------------------------------
-- 7.4 v_bus_occupancy — 호차별 탑승 현황
-- ------------------------------------------------------------
-- 왜? 배차 후 즉시 호차별 빈자리·초과 여부 확인. 상행/하행 모두 카운트.
CREATE OR REPLACE VIEW v_bus_occupancy AS
SELECT
  b.id                                  AS bus_id,
  b.name                                AS bus_name,
  b.departure_day,
  b.capacity,
  b.hard_cap,
  (SELECT COUNT(*) FROM registrations r WHERE r.assigned_up_bus_id   = b.id) AS up_passengers,
  (SELECT COUNT(*) FROM registrations r WHERE r.assigned_down_bus_id = b.id) AS down_passengers,
  b.capacity - (SELECT COUNT(*) FROM registrations r WHERE r.assigned_up_bus_id   = b.id) AS up_empty_seats,
  b.capacity - (SELECT COUNT(*) FROM registrations r WHERE r.assigned_down_bus_id = b.id) AS down_empty_seats
FROM buses b
ORDER BY b.id;

-- ------------------------------------------------------------
-- 7.5 v_day_capacity — 요일별 정원/인원/잔여
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_day_capacity AS
SELECT
  d.departure_day,
  SUM(b.capacity)                                            AS total_capacity,
  (SELECT COUNT(*) FROM registrations r
    WHERE r.departure_day = d.departure_day)                 AS total_passengers,
  SUM(b.capacity)
    - (SELECT COUNT(*) FROM registrations r
        WHERE r.departure_day = d.departure_day)             AS remaining_seats
FROM (SELECT unnest(enum_range(NULL::departure_day)) AS departure_day) d
LEFT JOIN buses b ON b.departure_day = d.departure_day
GROUP BY d.departure_day
ORDER BY d.departure_day;


-- ============================================================
-- 8. 시드 데이터
-- ============================================================

-- ------------------------------------------------------------
-- 8.1 캠퍼스 (18개)
-- ------------------------------------------------------------
INSERT INTO campuses (name, display_order) VALUES
  ('전남대',       10),
  ('조선대',       20),
  ('호남대',       30),
  ('광주교육대',   40),
  ('광주대',       50),
  ('광주여대',     60),
  ('서영대',       70),
  ('송원대',       80),
  ('광주보건대',   90),
  ('동신대',      100),
  ('남부대',      110),
  ('동강대',      120),
  ('아가페',      130),
  ('기독간호대',  140),
  ('조선간호대',  150),
  ('순수지구',    160),
  ('간사',        170),
  ('타지구',      180);

-- ------------------------------------------------------------
-- 8.2 버스 (9대 — 1~7호차 TUE, 8~9호차 WED)
-- ------------------------------------------------------------
INSERT INTO buses (name, capacity, hard_cap, departure_day) VALUES
  ('1호차', 44, 45, 'TUE'),
  ('2호차', 44, 45, 'TUE'),
  ('3호차', 44, 45, 'TUE'),
  ('4호차', 44, 45, 'TUE'),
  ('5호차', 44, 45, 'TUE'),
  ('6호차', 44, 45, 'TUE'),
  ('7호차', 44, 45, 'TUE'),
  ('8호차', 44, 45, 'WED'),
  ('9호차', 44, 45, 'WED');

-- ------------------------------------------------------------
-- 8.3 캠퍼스 정산 (18행 0으로)
-- ------------------------------------------------------------
INSERT INTO campus_payment_settlements (campus_id)
SELECT id FROM campuses;

-- ------------------------------------------------------------
-- 8.4 system_config 단일 행
-- ------------------------------------------------------------
INSERT INTO system_config (id, current_phase, batch_enabled)
VALUES (1, 'phase1', false);

-- ------------------------------------------------------------
-- 8.5 role_labels 시드
-- ------------------------------------------------------------
INSERT INTO role_labels (label, color, display_order) VALUES
  ('채플담당',     'green',  10),
  ('기타임역원',   'yellow', 20);


-- ============================================================
-- 9. 운영자 시스템 계정 profiles.role 매핑
-- ============================================================
-- 운영자가 Supabase Dashboard에서 미리 만든 운영자 시스템 계정 UID 매핑.
-- 순장/순원 시스템 미접근 정책 하에서 viewer·master는 카카오 OAuth가 아닌
-- 이메일/비번 계정으로 분리 운영 (data_schemas.md §9.3).
--
-- 주의: handle_new_user 트리거(6.1)는 auth.users INSERT 시점에만 fire.
-- 운영자 계정이 이 마이그 적용 *전*에 Dashboard에서 생성된 경우 트리거 미발동 →
-- profiles 행이 없어 UPDATE는 0 rows affected. 따라서 UPSERT로 처리.
-- 트리거가 이미 만들어 둔 경우에도 ON CONFLICT 가 안전하게 role만 갱신.

-- 배포 환경별 운영자 계정 UID를 채워 실행 (공개 repo라 실제 UID는 제외).
-- Supabase Dashboard에서 viewer·master 계정 생성 후 그 auth UID로 치환:
--
-- INSERT INTO profiles (id, role) VALUES
--   ('<VIEWER_AUTH_UID>', 'viewer'),
--   ('<MASTER_AUTH_UID>', 'master')
-- ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;


-- ============================================================
-- 적용 후 검증 쿼리 (Supabase SQL Editor에서 실행)
-- ============================================================
-- SELECT name, role FROM profiles JOIN auth.users ON profiles.id = auth.users.id;  -- 운영자 2명 보이는지
-- SELECT count(*) FROM campuses;                       -- 18
-- SELECT count(*) FROM buses;                          -- 9
-- SELECT count(*) FROM campus_payment_settlements;     -- 18
-- SELECT count(*) FROM system_config;                  -- 1
-- SELECT count(*) FROM role_labels;                    -- 2
