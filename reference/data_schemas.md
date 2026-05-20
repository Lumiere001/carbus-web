# carbus-web 데이터 스키마 reference (PostgreSQL / Supabase)

> CCC 71기 광주지구 여름수련회 차량 신청·배차·정산 웹앱 v4.2
> Stack: Next.js 15 App Router + TypeScript + Supabase (PostgreSQL + Auth + RLS + Realtime) + Tailwind + shadcn/ui
> 순장/순원 시스템 미접근 — 임역원 100% 대리 입력. 데스크탑 우선 (`/campus/buses`만 모바일 친화).

이 문서는 Supabase 프로젝트의 DDL·RLS·트리거·VIEW·시드를 한 곳에 모은 **단일 reference**입니다. 모든 마이그레이션 파일은 이 문서를 기준으로 작성·검증합니다.

---

## 0. 마이그레이션 적용 순서

순서가 깨지면 FK·트리거·RLS 헬퍼가 줄줄이 실패합니다. **반드시 아래 순서**로 작성·실행합니다.

| 순서 | 단계 | 이유 |
|------|------|------|
| 1 | ENUM | 테이블 컬럼 타입으로 참조됨 |
| 2 | TABLE | 모든 후속 객체의 기반 |
| 3 | INDEX | 테이블 생성 후, RLS 평가 비용 절감 |
| 4 | RLS | 트리거가 RLS 헬퍼를 호출할 수도 있어 먼저 활성화 |
| 5 | TRIGGER | 테이블·RLS 완성 후 |
| 6 | VIEW | 위 모든 객체의 정합성 보장된 뒤 |
| 7 | SEED | 마지막 — 운영 데이터는 정의 끝난 뒤 |

```bash
supabase migration new 01_enums
supabase migration new 02_tables
supabase migration new 03_indexes
supabase migration new 04_rls
supabase migration new 05_triggers
supabase migration new 06_views
supabase migration new 07_seed
```

---

## 1. ENUM 타입 정의

왜 ENUM? — 유한·고정 도메인(역할, 출발 요일, 결제 상태 등)을 컬럼 레벨에서 강제하면 애플리케이션 버그·오타가 DB 단에서 차단됩니다. 단, 값 추가는 `ALTER TYPE ADD VALUE`로 운영 중에도 가능합니다 (§10 참조).

```sql
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
```

---

## 2. 테이블 정의

### 2.1 `campuses` — 캠퍼스 마스터 (18행 시드)

> 왜 별도 테이블? — 캠퍼스명 오타·표기 흔들림(예: "전남대" vs "전남대학교") 방지 + display_order로 UI 정렬 일관성.

```sql
CREATE TABLE campuses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE,
  display_order int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

### 2.2 `buses` — 버스 마스터 (9대 시드)

> 왜 capacity와 hard_cap 둘 다? — capacity(44)는 배차 알고리즘의 "정상 목표", hard_cap(45)은 한 명 더 욱여넣어야 할 때의 절대 상한. driver_registration_id는 "차량순장 1인 고정", fixed_passenger_ids[]는 "강제 탑승 명단"(가족·VIP·집중 케어 대상).

```sql
CREATE TABLE buses (
  id                       serial PRIMARY KEY,
  name                     text NOT NULL UNIQUE,           -- '1호차' …
  capacity                 int  NOT NULL DEFAULT 44,
  hard_cap                 int  NOT NULL DEFAULT 45,
  departure_day            departure_day NOT NULL,
  driver_registration_id   uuid REFERENCES registrations(id) ON DELETE SET NULL,
  fixed_passenger_ids      uuid[] NOT NULL DEFAULT '{}'
);
```

> 주의: `buses` ↔ `registrations` 순환 FK. 마이그레이션은 buses를 먼저 생성하되 `driver_registration_id`·`fixed_passenger_ids` 참조 제약은 registrations 생성 후 `ALTER TABLE`로 추가합니다.

### 2.3 `profiles` — Supabase auth.users 1:1 확장

> 왜 별도? — auth.users는 Supabase 관리 테이블이라 직접 컬럼 추가 불가. 앱 도메인 필드(역할·캠퍼스 매핑·provider ID (Google sub))는 public.profiles로 분리.

```sql
CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  kakao_id      text UNIQUE,
  display_name  text,
  role          user_role NOT NULL DEFAULT 'guest',
  campus_id     uuid REFERENCES campuses(id),     -- campus_admin인 경우 본인 담당 캠퍼스
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

### 2.4 `registrations` — 신청 메인 테이블

> 왜 컬럼 순서가 중요? — 임역원 입력 UI 폼 순서, 시스템 자동 계산 영역, 배차 결과 영역, 메타 영역이 **테이블 스키마 순서**와 일치해야 디버깅·SQL 작성·관리자 화면이 직관적입니다.

```sql
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
  roles                 text[] NOT NULL DEFAULT '{}',        -- master만 편집 (RLS)

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
```

### 2.5 `registration_audit` — 변동 이력

> 왜 유지? — 분쟁(배차·정산), 실수 복구, 임역원별 작업량 집계. 전후 jsonb로 저장해 스키마 변경에도 깨지지 않음.

```sql
CREATE TABLE registration_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL,                            -- registrations DELETE 시도 보존 위해 FK 없이 ID만
  changed_by      uuid REFERENCES profiles(id),
  change_type     request_type NOT NULL,
  before_value    jsonb,
  after_value     jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 2.6 `batch_runs` — 배차 실행 이력

> 왜? — 배차는 멱등 아님(랜덤 요소·시드 변화). "어떤 시점·어떤 트리거로 돌렸나"가 분쟁 시 절대적 증거.

```sql
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
```

### 2.7 `campus_payment_settlements` — 캠퍼스별 정산 (18행)

> 왜 3중 비교? — 시스템 자동 합계(완납 표시) ↔ 임역원 신고 송금액 ↔ master 통장 실입금. 3개가 어긋나면 어느 단계 문제인지 즉시 분리 가능.

```sql
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
```

### 2.8 `system_config` — 단일 행 운영 설정

> 왜 단일 행? — 시스템 phase·배차 활성화 같은 전역 플래그는 행이 1개여야 함. `CHECK (id=1)`로 강제.

```sql
CREATE TABLE system_config (
  id             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_phase  system_phase NOT NULL DEFAULT 'phase1',
  batch_enabled  boolean NOT NULL DEFAULT false,
  last_batch_at  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

### 2.9 `role_labels` — 역할 라벨 (master CRUD)

> 왜 별도 테이블? — registrations.roles[]에 들어가는 라벨 텍스트를 master가 동적으로 추가·수정·삭제. 색깔·순서도 함께 관리.

```sql
CREATE TABLE role_labels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL UNIQUE,
  color         text,                          -- tailwind color 키 또는 hex
  display_order int  NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

---

## 3. 인덱스

> 왜 이 컬럼들? — 모든 view·페이지가 캠퍼스 필터링과 배차 결과 조회를 반복. audit·batch_runs는 시간 역순 조회가 99%.

```sql
CREATE INDEX idx_reg_campus      ON registrations(campus_id);
CREATE INDEX idx_reg_up_bus      ON registrations(assigned_up_bus_id);
CREATE INDEX idx_reg_down_bus    ON registrations(assigned_down_bus_id);
CREATE INDEX idx_reg_payment     ON registrations(payment_status);
CREATE INDEX idx_reg_created_by  ON registrations(created_by);

CREATE INDEX idx_audit_reg_time  ON registration_audit(registration_id, created_at DESC);
CREATE INDEX idx_batch_runs_time ON batch_runs(run_at DESC);
```

---

## 4. RLS 정책

모든 테이블 `ENABLE ROW LEVEL SECURITY`. 익명 정책은 어디에도 없음 (순장/순원 시스템 미접근).

### 4.1 헬퍼 함수 — SECURITY DEFINER

> 왜 SECURITY DEFINER? — 정책 내부에서 profiles를 SELECT해야 하는데, RLS 재귀 호출이 일어나면 무한 루프. DEFINER로 정의자 권한으로 우회.

```sql
CREATE OR REPLACE FUNCTION auth.current_role()
RETURNS user_role
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION auth.current_campus()
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT campus_id FROM public.profiles WHERE id = auth.uid();
$$;
```

### 4.2 테이블별 정책 요약

| 테이블 | guest | campus_admin | viewer | master |
|--------|-------|--------------|--------|--------|
| profiles | 본인 SELECT/UPDATE | 본인 SELECT/UPDATE | 본인 SELECT/UPDATE | ALL |
| campuses | SELECT | SELECT | SELECT | ALL |
| buses | SELECT | SELECT | SELECT | ALL |
| system_config | SELECT | SELECT | SELECT | ALL |
| role_labels | SELECT | SELECT | SELECT | ALL |
| registrations | — | 본인 캠퍼스 ALL | SELECT | ALL |
| registration_audit | — | 본인 캠퍼스 SELECT | SELECT | ALL |
| batch_runs | — | — | SELECT | ALL |
| campus_payment_settlements | — | 본인 캠퍼스 SELECT | SELECT | ALL |

### 4.3 핵심 정책 SQL

```sql
-- registrations
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY reg_campus_admin_all ON registrations
  FOR ALL TO authenticated
  USING (auth.current_role() = 'campus_admin' AND campus_id = auth.current_campus())
  WITH CHECK (auth.current_role() = 'campus_admin' AND campus_id = auth.current_campus());

CREATE POLICY reg_viewer_select ON registrations
  FOR SELECT TO authenticated
  USING (auth.current_role() = 'viewer');

CREATE POLICY reg_master_all ON registrations
  FOR ALL TO authenticated
  USING (auth.current_role() = 'master')
  WITH CHECK (auth.current_role() = 'master');

-- roles[] 컬럼은 master만 — column-level 분리 어려워 트리거로 보완 (§5.5)

-- profiles
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
  USING (auth.current_role() = 'master')
  WITH CHECK (auth.current_role() = 'master');

-- 공용 read-only 테이블 (buses, campuses, system_config, role_labels)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['buses','campuses','system_config','role_labels'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_select ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format($f$CREATE POLICY %I_master_all ON %I FOR ALL TO authenticated USING (auth.current_role()='master') WITH CHECK (auth.current_role()='master')$f$, t, t);
  END LOOP;
END $$;

-- registration_audit
ALTER TABLE registration_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_campus_admin_select ON registration_audit
  FOR SELECT TO authenticated
  USING (
    auth.current_role() = 'campus_admin'
    AND registration_id IN (
      SELECT id FROM registrations WHERE campus_id = auth.current_campus()
    )
  );

CREATE POLICY audit_viewer_select ON registration_audit
  FOR SELECT TO authenticated USING (auth.current_role() = 'viewer');

CREATE POLICY audit_master_all ON registration_audit
  FOR ALL TO authenticated
  USING (auth.current_role() = 'master')
  WITH CHECK (auth.current_role() = 'master');

-- batch_runs
ALTER TABLE batch_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY batch_viewer_select ON batch_runs
  FOR SELECT TO authenticated USING (auth.current_role() IN ('viewer','master'));
CREATE POLICY batch_master_all ON batch_runs
  FOR ALL TO authenticated
  USING (auth.current_role() = 'master')
  WITH CHECK (auth.current_role() = 'master');

-- campus_payment_settlements
ALTER TABLE campus_payment_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY settle_campus_admin_select ON campus_payment_settlements
  FOR SELECT TO authenticated
  USING (auth.current_role() = 'campus_admin' AND campus_id = auth.current_campus());
CREATE POLICY settle_viewer_select ON campus_payment_settlements
  FOR SELECT TO authenticated USING (auth.current_role() = 'viewer');
CREATE POLICY settle_master_all ON campus_payment_settlements
  FOR ALL TO authenticated
  USING (auth.current_role() = 'master')
  WITH CHECK (auth.current_role() = 'master');
```

---

## 5. 트리거

### 5.1 auth.users → profiles 자동 생성

> 왜? — Google OAuth 첫 로그인 시 profiles row가 없으면 RLS가 전부 막힘. 사용자가 인지하기 전에 guest 프로필 선생성.

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, role) VALUES (NEW.id, 'guest')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 5.2 `updated_at` 자동 갱신

> 왜? — 애플리케이션 코드에서 매번 set하면 누락 위험. DB가 단일 진실원.

```sql
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
```

### 5.3 registration_audit 자동 기록

> 왜? — 임역원·master가 잊고 안 적어도 DB가 강제 기록. version도 함께 증가.

```sql
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
```

### 5.4 role_labels 변경 → registrations.roles[] 동기화

> 왜? — 라벨명을 바꾸면 이미 부여된 학생들의 roles[]에 들어있는 옛 문자열도 같이 바뀌어야 일관성 유지. 삭제도 마찬가지.

```sql
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
```

### 5.5 roles[] 컬럼 master 전용 가드

> 왜? — RLS는 row 단위라 특정 컬럼만 막기 어려움. 트리거로 campus_admin이 roles[] 변경 시도 시 거부.

```sql
CREATE OR REPLACE FUNCTION public.guard_roles_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF auth.current_role() <> 'master' AND NEW.roles IS DISTINCT FROM OLD.roles THEN
    RAISE EXCEPTION 'roles column is master-only';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_reg_guard_roles
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.guard_roles_column();
```

---

## 6. VIEW (실시간 통계용)

> 왜 VIEW? — 매번 페이지에서 동일한 집계 쿼리를 짜면 RLS 평가 비용·코드 중복. VIEW는 RLS도 자동 상속됨.

### 6.1 `v_payment_summary` — 캠퍼스별 결제 요약

```sql
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
```

> 왜 면제 합계 제외? — 실수금 추적이 목적. 면제는 카운트만.

### 6.2 `v_payment_3way_comparison` — 3중 비교

```sql
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
```

### 6.3 `v_campus_stats` — 캠퍼스별 신청 통계

```sql
CREATE OR REPLACE VIEW v_campus_stats AS
SELECT
  c.id   AS campus_id,
  c.name AS campus_name,
  COUNT(*) FILTER (WHERE r.attendance_type = 'roundtrip') AS roundtrip_count,
  COUNT(*) FILTER (WHERE r.attendance_type = 'oneway')    AS oneway_count,
  COUNT(r.id)                                             AS total  -- LEFT JOIN NULL 행 제외 (마이그 20260520120000)
FROM campuses c
LEFT JOIN registrations r ON r.campus_id = c.id
GROUP BY c.id, c.name
ORDER BY c.display_order;
```

### 6.4 `v_bus_occupancy` — 호차별 탑승 현황

> 왜? — 배차 후 즉시 호차별 빈자리·초과 여부 확인. 상행/하행 모두 카운트.

```sql
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
```

### 6.5 `v_day_capacity` — 요일별 정원/인원/잔여

```sql
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
```

---

## 7. 시드 데이터

### 7.1 캠퍼스 (18개)

```sql
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
```

### 7.2 버스 (9대)

```sql
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
```

### 7.3 캠퍼스 정산 (18행 0으로)

```sql
INSERT INTO campus_payment_settlements (campus_id)
SELECT id FROM campuses;
```

### 7.4 system_config 단일 행

```sql
INSERT INTO system_config (id, current_phase, batch_enabled)
VALUES (1, 'phase1', false);
```

### 7.5 role_labels 시드

```sql
INSERT INTO role_labels (label, color, display_order) VALUES
  ('채플담당',     'green',  10),
  ('기타임역원',   'yellow', 20);
```

---

## 8. Supabase CLI 명령

```bash
# 새 마이그레이션 파일 생성
supabase migration new <name>

# 로컬 DB를 마이그레이션 처음부터 재실행 (개발)
supabase db reset

# 원격 DB에 마이그레이션 push
supabase db push

# TypeScript 타입 자동 생성
supabase gen types typescript --project-id <ref> --schema public > src/types/database.types.ts

# 또는 로컬 DB 기준
supabase gen types typescript --local > src/types/database.types.ts
```

---

## 9. 운영 노트

### 9.1 ENUM 값 추가 절차

PostgreSQL은 ENUM에 값 추가는 비교적 안전하지만, 트랜잭션 내부에서는 일부 환경에서 제약이 있습니다.

```sql
-- 예: 목요일 추가
ALTER TYPE departure_day ADD VALUE IF NOT EXISTS 'THU';
```

- 값 **삭제·이름 변경**은 직접 지원되지 않음 → 새 ENUM 생성 → 컬럼 타입 ALTER → 옛 ENUM DROP 순서.
- 추가한 값은 즉시 모든 RLS·CHECK에 반영됨. 별도 마이그레이션 권장.

### 9.2 새 캠퍼스 추가

캠퍼스 추가 시 `campus_payment_settlements`에도 같은 트랜잭션에서 row를 만들어야 3중 비교 VIEW가 깨지지 않습니다.

```sql
WITH new_c AS (
  INSERT INTO campuses (name, display_order)
  VALUES ('새캠퍼스', 190) RETURNING id
)
INSERT INTO campus_payment_settlements (campus_id) SELECT id FROM new_c;
```

> TODO: 이 동작도 `AFTER INSERT ON campuses` 트리거로 자동화 가능. 운영 안정화 후 적용 권장.

### 9.3 운영자 시스템 계정 (viewer / master)

순장/순원 시스템 미접근 정책 하에서, viewer·master는 **Google OAuth가 아닌 이메일/비번** 계정으로 분리 운영합니다.

| 계정 | 이메일 | 용도 |
|------|--------|------|
| viewer | `viewer@carbus.71kj.com` | 전체 read-only (예배·중간점검 화면 등) |
| master | `master@carbus.71kj.com` | 전체 + 배차·정산·시스템 설정 |

**생성 절차** (수동):
1. Supabase Dashboard → Authentication → Users → "Add user" → email + password
2. 생성된 user의 UUID 확인
3. SQL Editor에서 profiles.role 수동 설정:
   ```sql
   UPDATE profiles SET role = 'viewer' WHERE id = '<uuid>';
   UPDATE profiles SET role = 'master' WHERE id = '<uuid>';
   ```
4. 비밀번호는 1Password 등 안전한 저장소에 보관, 임역원과 공유 금지 (master는 더더욱).

### 9.4 백업·복구

- registrations와 registration_audit은 **함께** 백업·복구해야 무결성 유지.
- batch_runs는 분쟁 시 절대적 증거 — 임의 삭제 금지.
- 면제(`waived`) 처리는 audit에 사유 한 줄을 `note`로 함께 기록하는 운영 컨벤션 권장.

---

> 변경 이력은 `supabase/migrations/` 파일명 prefix(`YYYYMMDDHHMMSS_*.sql`)로 추적합니다. 이 문서는 "현재 시점 최종형"의 reference이며, 마이그레이션이 추가될 때마다 이 문서의 해당 섹션도 함께 갱신합니다.
