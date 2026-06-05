---
type: spec
project: carbus-web
version: v4.2
created: 2026-05-20T01:00:00+09:00
status: superseded   # v1.1.1 departure_slots 모델 + 2026-06-05 11대·3슬롯 변동으로 본문 다수 stale. 상단 배너 참조.
event: CCC 71기 광주지구 여름수련회
tags:
  - carbus
  - spec
  - 사역
sensitivity: sensitive
---

# carbus-web 시스템 명세서 v4.2

> ⚠️ **STALE — 설계 스냅샷(v4.2, 2026-05-20).** 본문은 옛 `departure_day` enum(`TUE`/`WED`) 모델 기준입니다.
> v1.1.1(2026-05-22)부터 출발이 **`departure_slots` 데이터 테이블 모델**로 일반화됐고(코드 변경 없이 슬롯·버스 추가), 2026-06-05 운영 변동으로 **버스 11대 · 3슬롯**(화 오전 9대 / 화 오후 1대 / 수 오후 1대), `attendance_type`에 **`self`(버스 미이용)** 추가 등 본문과 어긋난 곳이 많습니다. (예: §1.4 호차표, §4 `departure_day` enum 섹션 전부.)
> **현행 정본 도메인 모델:** `supabase/migrations/`(특히 `20260522090000_departure_slots` 이후) · `lib/labels.ts`(`buildAttendancePresets`) · `lib/batch/engine.ts` 코드, 그리고 운영 핸드오프(HANDOFF). 아래 본문은 **설계 당시 기록으로 보존**합니다.

> CCC 71기 광주지구 여름수련회 차량 신청·배차·정산 웹앱. 노션 기반 v3.2 / Python mini v0.2 시스템을 자체 웹앱으로 전면 재구축.

---

## 0. 문서 정보

| 항목 | 값 |
|---|---|
| 버전 | **v4.2** |
| 이전 버전 | v4.1 (설계 대화 단계) / v4.0 (`outputs/carbus-web` 폐기) / v3.2 (노션 기반, 폐기) |
| 작성일 | 2026-05-20 |
| 대상 행사 | CCC 71기 광주지구 여름수련회 (광주 → 평창, 화-토 4박 5일) |
| 시스템 범위 | 임역원 순장/순원 등록 → 검증 → master 수동 배차 → 차량비 3중 정산 + 모니터링 |
| 사용 범위 | **임역원·운영자만**. 순장/순원는 시스템 미접근 (카톡 안내만) |

---

## 1. 시스템 개요

### 1.1 목적

기존 카카오톡·엑셀 수기 운영의 비효율을 다음 방향으로 자동화:

- **수집 자동화**: 임역원이 grid·CSV·복붙으로 순장/순원 일괄 등록
- **검증 자동화**: 양식·중복·일정 규칙 자동 체크
- **배차 자동화**: 6단계 알고리즘으로 호차 배정 (master 수동 트리거)
- **차량비 자동화**: 참석 유형 기준 자동 계산 + 3중 통장 대조
- **모니터링 자동화**: 헬스 체크·배차 이력 통합

→ **master(운영자)는 배차 트리거·통장 확인·예외 처리만 수행.**
→ **임역원은 본인 캠퍼스 순장/순원 grid 입력만 집중.**

### 1.2 행사 특수성

- 기간: **화요일 ~ 토요일 (4박 5일)**
- 경로: 광주 → 평창
- 상행: **화요일 / 수요일** (확장 가능)
- 하행: **토요일 1회**, 9대 동시
- 인원: 약 500명 예상
- 부분참석자 존재 (편도 상행 또는 편도 하행으로 표현)

### 1.3 차량 기본 정보

- 정원: **44석** (보조좌석 사용 시 45석)
- 캠퍼스: 16개 + 간사·타지구·순수지구 → **총 18개**
- 총 운영 차량: **9대**
- 송정역 탑승: 미운영
- 간사 차량: 미운영

### 1.4 호차 구성 (현재 확정)

| 호차 | 정원 | 출발 요일 |
|---|---|---|
| 1~7호차 | 44 (45 허용) | 화요일 |
| 8~9호차 | 44 (45 허용) | 수요일 |
| 하행 (전체 9대) | 동일 | 토요일 1회 |

- 화요일 총 정원: **308석** (7×44)
- 수요일 총 정원: **88석** (2×44)

### 1.5 상행 일정 변경 시 체크리스트 ⚠️

상행 요일이 바뀌면 ENUM·시드·UI·검증을 함께 갱신:

- [ ] `departure_day` ENUM에 새 값 추가 (`ALTER TYPE departure_day ADD VALUE 'THU'`)
- [ ] `buses` 시드에 새 요일 호차 추가
- [ ] 폼·CSV·grid의 "상행 요일" 옵션
- [ ] `/admin` 대시보드의 상행 일자별 인원 섹션
- [ ] 검증 규칙 5 (운영 요일 일치) 자동 통과
- [ ] Phase 2 진행 중이면 master 재배차 수동 트리거

→ ENUM 확장 가능 설계로 위 절차만 따르면 다른 코드 수정 불필요.

---

## 2. 핵심 아키텍처

### 2.1 구성도

```
[임역원·운영자]
       ↓ (브라우저 — 데스크탑 우선)
[Next.js 15 App Router on Vercel]
   ├─ Server Components / Server Actions
   ├─ Route Handlers
   └─ shadcn/ui + Tailwind + TanStack Table
       ↓
[Supabase]
   ├─ PostgreSQL (모든 데이터)
   ├─ Auth (Google OAuth + 시스템 계정 2개)
   ├─ Row Level Security (4종 권한 격리)
   └─ Realtime (충돌 감지·grid 자동 갱신)
       ↓
[배차 엔진]
   TypeScript 단위 함수 (lib/batch/)
   Server Action으로 호출
```

### 2.2 노션·mini 시절과의 차이

| 항목 | v3.2 (노션 + mini) | v4.2 (웹앱) |
|---|---|---|
| 데이터 저장 | 노션 DB 18개 | PostgreSQL 단일 DB |
| 입력 UI | 노션 DB 행 추가 | TanStack Table grid + CSV·복붙 |
| 권한 | 노션 페이지 share | Supabase RLS (4종 role) |
| 배차 트리거 | mini의 .env 변수 | `/admin/batch` 버튼 (master만) |
| 헬스 체크 | "Current Status" 행 hack | `/admin` 위젯 + system_config |
| 동기화 | mini 1분 cron 폴링 | 실시간 DB 쓰기 |
| 충돌 처리 | 없음 (마지막 쓰기 승리) | Optimistic locking + field-level diff |
| 순장/순원 접근 | 노션 share | **없음 (시스템 미접근)** |
| 데이터 마이그 | — | **불필요** (노션 데이터 0건 상태에서 전환) |

핵심: **폴링 사라지고 실시간**. 노션 의존 0%.

---

## 3. 사용자·권한

### 3.1 역할 4종

| Role | 식별 | 권한 | 비고 |
|---|---|---|---|
| **guest** | Google OAuth (campus_id 미할당) | 본인 profiles만 SELECT, `/pending` 안내 페이지 | master가 매핑하면 campus_admin 승격 |
| **campus_admin** | Google OAuth + master가 campus_id 매핑 | 본인 캠퍼스 registrations ALL | `/campus/*` 메인 작업 |
| **viewer** | 운영자 비번1 → 시스템 계정 viewer@... | 전체 SELECT (액션 불가) | 보기만, 어떤 INSERT/UPDATE/DELETE도 X |
| **master** | 운영자 비번2 → 시스템 계정 master@... | 전체 ALL + 시스템 설정 | 모든 임역원 기능 포함 |

### 3.2 인증 채널 (2종)

**채널 A — Google OAuth** (임역원·게스트)
- `/login` → "Google로 로그인" 버튼
- Supabase Auth + Google provider
- 첫 로그인 시 `auth.users` INSERT 트리거 → `profiles` 행 자동 생성 (role='guest')
- Google 사업자 등록 불필요 (`email`·`profile` scope 기본, Supabase 제약 없이 동작)
- 순장/순원용 Google 로그인은 미운영 (순장/순원는 시스템 미접근)

**채널 B — 운영자 비밀번호** (viewer·master)
- `/admin/login` → 비밀번호 1칸만 표시
- 서버: 비번1 → `viewer@carbus.71kj.com` 자동 매핑 / 비번2 → `master@carbus.71kj.com` 자동 매핑
- Supabase Auth 표준 이메일+비번 로그인 (내부적으로)
- 비번 변경 정책: **고정** (사용자만 사용. 변경 필요 시 Supabase 대시보드 직접)

### 3.3 RLS 정책 핵심 (자세한 건 reference/data_schemas.md)

- `registrations`: campus_admin은 own campus, viewer SELECT, master ALL
- `profiles`: 본인 SELECT/UPDATE, master ALL
- `buses`, `campuses`, `system_config`, `role_labels`: 인증 사용자 SELECT, master ALL
- `registration_audit`, `batch_runs`, `campus_payment_settlements`: viewer SELECT, master ALL

---

## 4. 데이터 모델

### 4.1 테이블 목록

| 테이블 | 행 수 | 역할 |
|---|---|---|
| `campuses` | 18 (시드) | 캠퍼스 마스터 |
| `buses` | 9 (시드) | 호차 + 차량순장·고정 탑승자 |
| `profiles` | N (Auth 가입자) | 사용자 프로필·역할 |
| `registrations` | ~500 (순장/순원) | **메인 — 순장/순원 신청** |
| `registration_audit` | 누적 | 변동 이력 (분쟁·복구) |
| `batch_runs` | 누적 | 배차 실행 이력 |
| `campus_payment_settlements` | 18 (시드) | 캠퍼스별 차량비 3중 비교 |
| `system_config` | 1 (시드) | Phase 토글 |
| `role_labels` | M (master CRUD) | 역할 라벨 (채플담당 등) |

폐기됨:
- ~~`validation_errors`~~ (즉시 차단으로 대체)
- ~~`payment_reconciliation` 단일 행~~ (캠퍼스별로 확장됨)

### 4.2 `registrations` 컬럼 순서 (UI/CSV/grid 동일)

| 순서 | 영문 컬럼 | 한글 라벨 | 입력자 | 타입·제약 |
|---|---|---|---|---|
| 🟢 **임역원 입력 영역** | | | | |
| 1 | `name` | 이름 | 임역원 | text NOT NULL |
| 2 | `student_id` | 학번 | 임역원 | text NOT NULL, 2자리 숫자 또는 간사/외국인/타지구 |
| 3 | `campus_id` | 캠퍼스 | 임역원 (자기 캠퍼스 자동) | uuid FK, RLS 강제 |
| 4 | `attendance_type` | 참석 유형 | 임역원 | enum: `roundtrip` (왕복) / `oneway` (편도) |
| 5 | `departure_day` | 상행 요일 | 임역원 | enum: `TUE` / `WED` / NULL (하행편도면 NULL) |
| 6 | `uses_return_bus` | 하행 차량 이용 | 임역원 | boolean |
| 7 | `note` | 비고 | 임역원 | text, 옵셔널 |
| 🟡 **시스템 자동 / master 영역** | | | | |
| 8 | `fee` | 차량비 | 자동 (GENERATED) | int — 왕복=50000 / 편도=25000 |
| 9 | `payment_status` | 납부 상태 | 임역원·master 토글 | enum: `unpaid` (미납) / `paid` (완납) / `waived` (면제) |
| 10 | `roles` | 역할 | **master만 편집** | text[], 기본 `{}` |
| 🔴 **배차 결과 영역 (임역원 read-only)** | | | | |
| 11 | `assigned_up_bus_id` | 상행 배차 결과 | 배차 알고리즘 | int FK buses |
| 12 | `assigned_down_bus_id` | 하행 배차 결과 | 배차 알고리즘 | int FK buses |
| 🟦 **메타 (UI 보통 숨김)** | | | | |
| 13~16 | `id`, `created_by`, `version`, `created_at`/`updated_at` | — | 자동 | uuid PK / FK profiles / int (충돌 감지) / timestamptz |

### 4.3 attendance_type · departure_day · uses_return_bus 관계

|  attendance_type | departure_day | uses_return_bus | 의미 | 차량비 | 상행 배차 | 하행 배차 |
|---|---|---|---|---|---|---|
| 왕복 (roundtrip) | TUE | true | 화요일 상행 + 토요일 하행 | 50,000 | 화 호차 | 토요일 독립 배정 |
| 왕복 (roundtrip) | WED | true | 수요일 상행 + 토요일 하행 | 50,000 | 수 호차 | 토요일 독립 배정 |
| 편도 (oneway) | TUE | false | 화요일 상행만 | 25,000 | 화 호차 | NULL |
| 편도 (oneway) | WED | false | 수요일 상행만 | 25,000 | 수 호차 | NULL |
| 편도 (oneway) | NULL | true | 하행편도 (현지 합류 → 토요일 귀가) | 25,000 | NULL | 토요일 독립 배정 |

> **v4.3 변경**: 상행·하행 배차는 **완전히 독립**. 왕복자도 상행 호차와 하행 호차가 다를 수 있음 (올라갈 때 알고리즘 / 내려올 때 알고리즘 별도 실행). 하행은 `uses_return_bus=true` 인 전원을 토요일 9대 전체에 캠퍼스 묶음 Bin Packing.

### 4.4 핵심 제약 (CHECK)

```sql
CHECK (
  (attendance_type = 'roundtrip' AND departure_day IS NOT NULL AND uses_return_bus = true)
  OR (attendance_type = 'oneway' AND (
    (departure_day IS NOT NULL AND uses_return_bus = false)
    OR (departure_day IS NULL AND uses_return_bus = true)
  ))
)

CHECK (
  student_id ~ '^\d{2}$'
  OR student_id IN ('간사', '외국인', '타지구')
)

UNIQUE (campus_id, student_id, name)
```

### 4.5 `buses` 테이블 핵심

```sql
CREATE TABLE buses (
  id serial PRIMARY KEY,
  name text UNIQUE,
  capacity int DEFAULT 44,
  hard_cap int DEFAULT 45,
  departure_day departure_day NOT NULL,
  driver_registration_id uuid REFERENCES registrations(id) ON DELETE SET NULL,
  fixed_passenger_ids uuid[] NOT NULL DEFAULT '{}'
);
```

- `driver_registration_id`: 차량순장 1명 (master 수동 지정·해제)
- `fixed_passenger_ids`: 채플담당·기타 강제 탑승자 (master가 호차별로 N명 지정)
- 배차 알고리즘 Step 1에서 이 둘 합쳐서 우선 자리 점유
- 차량순장은 시스템 자동 변경 X. master 수동 변경만.

### 4.6 `campus_payment_settlements` (3중 비교 핵심)

```sql
CREATE TABLE campus_payment_settlements (
  campus_id uuid PRIMARY KEY REFERENCES campuses(id),
  campus_remitted_total int DEFAULT 0,           -- 임역원이 master에게 보낸 합계
  campus_remitted_at timestamptz,
  campus_remitted_note text,
  campus_remitted_by uuid REFERENCES profiles(id),
  master_received_total int DEFAULT 0,           -- master 통장 실제 입금 합계
  master_received_at timestamptz,
  master_received_note text,
  updated_at timestamptz DEFAULT now()
);
```

→ 18개 캠퍼스 모두 0으로 시드. 임역원·master가 송금/입금 진행하며 업데이트.

### 4.7 ENUM 확장 가능 설계

```sql
CREATE TYPE departure_day AS ENUM ('TUE', 'WED');
-- 추후 새 요일 운영 시:
-- ALTER TYPE departure_day ADD VALUE 'THU';
```

→ 새 요일 추가 시 ENUM ALTER + buses 시드 + UI dropdown 옵션 추가, 3곳만 손대면 됨.

### 4.8 자세한 DDL

전체 DDL·RLS·TRIGGER·VIEW는 `reference/data_schemas.md` 참고.

---

## 5. 인증·권한 (간단 흐름)

```
[Google OAuth 흐름]
사용자 → /login → "Google로 로그인" 버튼 클릭
→ Google 동의 → Supabase Auth 세션 생성
→ profiles 자동 생성 (role='guest')
→ 첫 접근: /pending (승인 대기) 안내
→ master가 /admin/users에서 campus_id 매핑 → role='campus_admin' 승격
→ 임역원이 다시 로그인하면 /campus 진입 가능

[운영자 비밀번호 흐름]
운영자 → /admin/login → 비번 입력
→ 서버 측: 비번1 매칭 → viewer 시스템 계정 로그인 / 비번2 → master
→ /admin 진입
```

---

## 6. 워크플로우

### 6.1 순장/순원 신청 (Phase 1)

```
1. 순장/순원가 임역원에게 카톡으로 신청 의사 + 송금 (시스템 외)
2. 임역원 → /campus 메인 grid에서 새 행 추가 (인라인 입력)
   또는 /campus/import에서 CSV 업로드·복붙
3. 클라이언트 Zod 검증 → 서버 검증 → registrations INSERT
4. fee 자동 계산 (왕복 50K / 편도 25K)
5. 임역원이 순장/순원에게 차량비 송금 안내 (시스템 외, 카톡)
```

### 6.2 순장/순원 변동·취소

```
1. 순장/순원가 임역원에게 변경 요청 카톡
2. 임역원 → /campus grid에서 해당 행 인라인 편집 또는 삭제
3. 검증 통과 시 UPDATE/DELETE → registration_audit 자동 기록
4. 임역원이 순장/순원에게 변경 사실 카톡 안내
```

### 6.3 임역원 권한 부여 (master)

```
1. 새 임역원이 Google OAuth 첫 로그인 → guest 프로필 자동 생성
2. master → /admin/users 페이지에서 게스트 list 확인
3. 캠퍼스 dropdown 선택 → [부여] 클릭 → role='campus_admin', campus_id 매핑
4. 임역원의 다음 로그인부터 /campus 접근 가능
5. 권한 해제는 master가 [해제] 클릭 → role='guest'로 복귀
```

### 6.4 차량비 정산 (3단계)

```
[Step 1] 순장/순원 송금 받음
  임역원 → /campus/payments 또는 /campus grid에서
  순장/순원 행 payment_status = '완납' 토글
  → 시스템 자동: v_payment_summary VIEW로 합계 즉시 갱신

[Step 2] 임역원 → master 송금
  임역원 → /campus/payments 에서 "master에게 송금" 등록
  → campus_payment_settlements.campus_remitted_total 입력
  → 차이1 (시스템 합계 vs 캠퍼스 송금) 자동 계산

[Step 3] master 통장 확인
  master → /admin/payments 에서 캠퍼스별 통장 입금 합계 수동 입력
  → campus_payment_settlements.master_received_total 입력
  → 차이2 (캠퍼스 송금 vs master 입금) 자동 계산
```

자세한 흐름·UI는 `reference/payment_flow.md` 참고.

### 6.5 Phase 2 진입 + 배차

```
1. master → /admin/control에서 "Phase 2로 전환" 토글
   → system_config.current_phase = 'phase2', batch_enabled = true
2. master → /admin/batch 페이지 "배차 실행" 버튼 클릭
3. 배차 엔진 실행 (6단계 알고리즘) → registrations.assigned_up/down_bus_id 갱신
4. batch_runs에 실행 이력 INSERT
5. 결과 시각화: /admin/buses에서 호차별 명단 카드
6. master가 차량 순장 9명에게 명단 카톡 전달 (시스템 외)
7. Phase 2 진행 중 신규 순장/순원 추가 시: master가 수동으로 재배차 트리거 (자동 X)
```

---

## 7. 페이지 사양

### 7.1 전체 페이지 목록

| 경로 | Role | 내용 |
|---|---|---|
| `/` | 공개 | 행사 소개 + 로그인 진입 |
| `/login` | 공개 | Google 로그인 |
| `/admin/login` | 공개 | 운영자 비밀번호 |
| `/pending` | guest | 임역원 승인 대기 안내 |
| `/campus` | campus_admin | **본인 캠퍼스 순장/순원 grid (메인 작업)** |
| `/campus/import` | campus_admin | CSV 업로드 + 복붙 import |
| `/campus/buses` | campus_admin | 본인 캠퍼스 호차 조회 (**모바일 친화**) |
| `/campus/payments` | campus_admin | 본인 캠퍼스 차량비 + master 송금 등록 |
| `/admin` | viewer / master | 전체 대시보드 (master만 액션 버튼) |
| `/admin/registrations` | viewer / master | 전체 순장/순원 grid + 18개 캠퍼스 탭 |
| `/admin/buses` | viewer / master | 9대 호차 + 차량순장·고정 탑승자 + 배차 결과 시각화 |
| `/admin/batch` | master | 배차 실행 + 이력 |
| `/admin/payments` | viewer / master | 전체 정산 (3중 비교 표) |
| `/admin/errors` | viewer / master | 배차 실패 이력 |
| `/admin/control` | master | Phase 토글·시스템 설정 |
| `/admin/users` | master | 게스트 → 임역원 권한 부여·해제 |
| `/admin/roles` | master | 역할 라벨 CRUD |
| `/admin/logs` | viewer / master | audit·batch_runs 이력 |

### 7.2 `/admin` 운영 대시보드 구성

| 섹션 | 내용 |
|---|---|
| A. 캠퍼스별 인원 | 18개 × (왕복/편도) 카운트 |
| B. 상행 일자별 | 화 X명 · 수 Y명, 정원·잔여 좌석 (잔여 - 빨강) |
| C. 호차별 | 1~9호차 탑승 인원·빈자리·차량순장 |
| D. 차량비 (요약) | 상태별 인원·금액, 면제 별도 표시 |
| E. 통장 대조 (요약) | 시스템 합계·캠퍼스 송금·master 입금·차이 |
| F. 헬스 | 마지막 배차 시각·최근 24h 활동·DB 연결 |

상세 페이지(/admin/payments, /admin/buses)로 드릴다운 가능.

---

## 8. 입력 UX (핵심)

### 8.1 메인 — `/campus` grid (TanStack Table)

- 인라인 cell 편집 (Enter·Tab으로 셀 이동)
- 맨 아래 항상 빈 행 1개 → 입력 시작 시 새 행 생성
- 변경 즉시 server 저장 (optimistic UI + debounce 500ms)
- Zod 검증 실패 시 셀 빨강 + tooltip
- Supabase Realtime 구독 → 다른 임역원 변경 자동 반영
- Optimistic locking (version 컬럼)으로 충돌 감지

### 8.2 대량 — `/campus/import`

**복붙 (Paste import)**
- paste 영역에 Cmd+V → TSV/CSV 파서로 처리
- 첫 행이 헤더면 자동 매핑
- 미리보기에서 성공·실패 행 색깔
- "등록" 클릭 시 일괄 INSERT (성공만, 실패 행은 별도 표시 + 수정 후 재시도)

**CSV 업로드**
- 임역원용 템플릿: `이름,학번,참석 유형,상행 요일,하행 차량 이용,비고` (캠퍼스·역할 제외)
- master용 템플릿: `캠퍼스,이름,학번,참석 유형,상행 요일,하행 차량 이용,역할,비고`
- papaparse로 파싱 → 행마다 Zod 검증
- 헤더 한글 → 영문 컬럼 자동 매핑
- "O/X", "true/false", "체크/공란" 모두 허용 (관대한 파싱)

### 8.3 실시간 충돌 처리

**시나리오 — 다른 필드 동시 편집:**
```
T+0: A가 attendance_type 편집 시작 (version=5)
T+5: B가 phone 편집 후 저장 → version=6
T+10: A가 attendance_type 저장 시도
   → 서버: version mismatch이지만 A가 안 건드린 필드는 B 변경으로 자동 반영
   → A의 attendance_type만 적용 (충돌 없음, version=7)
   → A의 UI: 자동 새로고침으로 B 변경 반영
```

**시나리오 — 같은 필드 동시 편집 (진짜 충돌):**
```
T+10: A가 attendance_type='oneway' 저장
T+12: B가 attendance_type='roundtrip' 저장 (B가 먼저 도착, version=7)
T+13: A의 요청 도착 → 동일 필드 conflict
   → A의 UI: 해당 셀 빨강 + 토스트 "다른 임역원이 '왕복'으로 변경"
   → A가 다시 확인하고 입력 후 재시도
```

### 8.4 18개 캠퍼스 통합 관리 (`/admin/registrations`, master)

```
[전체 ▼] [전남대] [조선대] ... [간사] [타지구] [순수지구]
   ↑ 캠퍼스 탭

"전체"는 캠퍼스 컬럼 보이고 모두 grid. 특정 캠퍼스 탭은 그 캠퍼스만.
간사·타지구·순수지구도 캠퍼스 탭 동일 취급 (campuses 시드에 등록).
master는 어느 탭에서든 인라인 편집·삭제·CSV 업로드 가능.
```

### 8.5 임역원 모바일 — `/campus/buses`

- **모바일 친화 디자인** (카드 list, 큰 글자, tap 친화적)
- 호차별 그룹핑 + 순장/순원 카드 펼침/접힘
- 화/수/하행편도 섹션 분리
- "카톡 공유 텍스트 복사" 버튼 → 자동 포맷 클립보드 (단톡방에 paste)

---

## 9. 배차 엔진 (요약)

6단계 Bin Packing. 자세한 의사코드·TypeScript 포팅은 `reference/batch_algorithm.md`.

**Step 1.** 고정 배정 (buses.driver_registration_id + fixed_passenger_ids 합쳐서 우선 점유)
**Step 2.** 역할 기반 (v1 placeholder, fixed_passenger_ids로 대체)
**Step 3.** 상행 요일별 분리 (TUE / WED / NULL)
**Step 4.** 캠퍼스 단위 묶음 Bin Packing (큰 캠퍼스 우선, 같은 호차 묶기)
**Step 5.** 하행편도 별도 처리 (departure_day=NULL + uses_return_bus=true)
**Step 6.** 결과 write back + `batch_runs` 기록

**우선순위:** 같은 캠퍼스 같은 호차 > 요일 분리 강제 > 고정 배정 보존 > 역할 기반.

**모드:** 항상 전체 최적화. Phase 2 신규 추가 시 master 수동 재배차만 (자동 X).

---

## 10. 검증 규칙 (요약)

6규칙. 자세한 Zod 스키마·DB CHECK·CSV 파서 가이드는 `reference/validators.md`.

| # | 규칙 | 메시지 |
|---|---|---|
| 1 | UNIQUE (campus, student_id, name) | "이미 등록된 순장/순원입니다" |
| 2 | student_id 4종 패턴 | "학번 형식이 올바르지 않습니다" |
| 3 | 왕복 일관성 (departure_day + uses_return_bus 모두) | "왕복은 상행 요일과 하행 차량 모두 필요" |
| 4 | 편도 일관성 (상행/하행 중 하나) | "편도는 상행 또는 하행 중 하나만" |
| 5 | departure_day가 운영 요일과 일치 | "현재 운영 요일은 화·수" |
| 6 | 수정·취소 대상 존재 | "신청 내역을 찾을 수 없습니다" |

검증 시점: 클라이언트(Zod) → 서버(Zod + DB 접근) → DB CHECK (방어선)

---

## 11. 차량비 (요약)

자세한 흐름·UI·SQL VIEW는 `reference/payment_flow.md`.

### 11.1 자동 계산
`fee` 컬럼은 GENERATED ALWAYS AS STORED: 왕복=50,000 / 편도=25,000. 직접 수정 불가.

### 11.2 면제 처리
`payment_status = 'waived'` 토글 → fee는 그대로 유지하되 SQL VIEW에서 합계 제외.

### 11.3 3중 비교 (campus_payment_settlements 활용)
- 시스템 자동 합계 (paid의 fee 합)
- 캠퍼스 송금 합계 (임역원 입력)
- master 통장 입금 합계 (master 입력)
- 차이 자동 표시

### 11.4 페이지 분화
- `/campus/payments`: campus_admin, 본인 캠퍼스 + master 송금 등록
- `/admin/payments`: viewer 보기·master 편집, 전체 3중 비교 표

---

## 12. Phase 모델

| | Phase 1 | Phase 2 |
|---|---|---|
| 의미 | 자율 입력 기간 | 배차 가동·마감 |
| 임역원 입력 | 가능 | 가능 (변동만 권장) |
| 배차 엔진 | OFF | master 수동 트리거만 |
| 자동 재배차 | X | **X (사용자 결정: 신규 추가 시 master 수동만)** |
| 전환 | — | master가 `/admin/control` 토글 |

Phase 2 진행 중 신규/수정/취소가 발생하면 시스템 알림 X (사용자 결정: 경고 메시지 안 띄움). master가 인지하고 적절히 재배차.

---

## 13. master 사용자 관리 (`/admin/users`)

```
사용자 관리                                    [master]

게스트 (권한 미부여) — 3명
| Google | 이름   | 가입일      | 캠퍼스 부여 | 액션  |
| ... | 김민수 | 2026-05-19 | [선택 ▼]    | [부여][차단] |

임역원 — 10명
| Google | 이름   | 캠퍼스   | 마지막 활동 | 액션          |
| ... | 박민준 | 전남대 ▼ | 1시간 전    | [캠퍼스 변경][해제] |
```

- 게스트 → 캠퍼스 dropdown 선택 → [부여]: role='campus_admin', campus_id 매핑
- 임역원 → [해제]: role='guest', campus_id=NULL
- master는 한 화면에서 모두 관리

---

## 14. 역할 라벨 관리 (`/admin/roles`)

```
역할 라벨 관리                          [master]

| 순서 | 라벨      | 색상   | 액션 |
| 1   | 채플담당  | 🟢 #2..| [수정][삭제] |
| 2   | 기타임역원| 🟡 #f..| [수정][삭제] |
| + 새 역할 추가 |
```

- master가 `role_labels` CRUD
- 라벨 변경 시 DB 트리거로 `registrations.roles` 배열 내 string 자동 일괄 UPDATE
- 라벨 삭제 시 `registrations.roles`에서 자동 제거 (트랜잭션)
- 임역원 grid의 "역할" 컬럼은 master만 편집 (RLS로 차단). 임역원은 read-only.

---

## 15. master 배차 결과 시각화 (`/admin/buses`)

호차별 카드 (화 7대 + 수 2대):

```
🚌 1호차 · 화요일 · 32/44
차량순장: 김철수 (전남대 22) [변경] [해제]
고정 탑승자 (5명): [+ 추가]
   • 이영희 (전남대, 채플담당)
   • ...
캠퍼스 분포: 전남대 20 · 조선대 12
[전체 명단 보기]  [PDF 다운로드]  [카톡 텍스트 복사]
```

- 카드 클릭 → `/admin/buses/[id]` 상세 (좌석 도식·캠퍼스 분포 차트·전체 명단)
- 명단 PDF 다운로드 (인쇄용)
- 카톡 공유 텍스트 (단톡방 paste용)

---

## 16. 오류·헬스 모니터링

### 16.1 오류 로그 (`/admin/errors`)

- `batch_runs.success = false` 행
- 미배정자 발생 경고 (좌석 부족 등)
- viewer는 보기, master는 처리 상태 변경

→ `validation_errors` 테이블은 폐기. 폼·grid에서 즉시 차단해서 별도 보존 불필요.

### 16.2 헬스 위젯 (`/admin`)

- 마지막 배차 시각
- 최근 24h 신청·수정·취소 횟수
- Supabase 연결 상태
- system_config 현재 phase

---

## 17. MVP 스코프

### 17.1 v1 MVP — Must Have ✅

1. Supabase 프로젝트 + 스키마 마이그레이션 + RLS + 시드 데이터
2. Google OAuth + 운영자 시스템 계정 2개
3. 로그인 흐름 4종 (guest/campus_admin/viewer/master)
4. `/admin/users` 권한 부여·해제
5. `/admin/roles` 역할 라벨 CRUD
6. `/campus` 메인 grid (TanStack Table + 인라인 편집 + Realtime + 충돌 감지)
7. `/campus/import` CSV·복붙 import
8. `/campus/buses` 모바일 호차 조회
9. `/campus/payments` 캠퍼스 차량비 + master 송금 등록
10. `/admin` 대시보드 (캠퍼스별·일자별·호차별·차량비)
11. `/admin/registrations` 18개 캠퍼스 통합 관리
12. `/admin/buses` 호차 시각화 + 차량순장·고정 탑승자
13. `/admin/batch` 배차 실행 + 결과
14. `/admin/payments` 3중 비교 정산
15. `/admin/errors` 오류 로그
16. `/admin/control` Phase 토글
17. 자동 테스트 (단위·통합·E2E)
18. Vercel 배포

### 17.2 Nice to Have 🟡

- CSV 내보내기 (순장/순원 목록·호차 명단)
- 명단 PDF 다운로드
- 인쇄 친화 레이아웃

### 17.3 Out of Scope ❌ (v2 이후)

- 카카오 알림톡 자동 발송 (사업자 등록 후)
- 오픈뱅킹 자동 송금 매칭 (사업자 등록 후)
- 순장/순원 셀프 서비스 모드
- 다국어
- 모바일 네이티브 앱
- "안정 모드" 배차 (배정된 사람 이동 금지)
- 다음 행사 템플릿화 (events 테이블 분리)
- Google OAuth 외 추가 인증 수단 (카카오·애플 등)
- fee_override (예외 차량비)

---

## 18. 작업 우선순위 (Phase A~F)

### Phase A — 인프라 (1~2일)
- Next.js 15 프로젝트 init (TypeScript, Tailwind, shadcn/ui)
- Supabase 프로젝트 생성 + 연결
- 스키마 마이그레이션 (`reference/data_schemas.md` 기준 1개 SQL 파일)
- Google Cloud Console 셋업 + Supabase Google provider 등록
- 운영자 시스템 계정 2개 수동 생성 (Supabase Dashboard)
- 로그인 흐름 4종 구현

### Phase B — 임역원 grid (3~4일)
- TanStack Table 기반 `/campus` 메인 grid
- 인라인 cell 편집 (Input/Select/DatePicker 컴포넌트)
- Zod 검증 (lib/validators) + 6규칙
- Supabase Realtime 구독
- Optimistic locking (version 컬럼) + field-level conflict 처리

### Phase C — Import (2일)
- `/campus/import` paste 영역 + CSV 업로드
- papaparse 파싱 + 컬럼 매핑 UI
- 미리보기·실패 행 표시
- CSV 템플릿 다운로드 (한글 헤더)

### Phase D — 운영자 대시보드 (3~4일)
- `/admin` 위젯 (캠퍼스별·일자별·호차별·차량비·헬스)
- `/admin/users` 권한 관리
- `/admin/roles` 역할 라벨 CRUD
- `/admin/registrations` 캠퍼스 탭 grid
- `/admin/buses` 호차 카드 + 차량순장·고정 탑승자
- `/admin/payments` 3중 비교 표
- `/campus/payments` 임역원 송금 등록
- `/campus/buses` 모바일 호차 조회

### Phase E — 배차·정산 (2일)
- 배차 엔진 TypeScript 포팅 (`lib/batch/`)
- `/admin/batch` 실행 + 결과 시각화
- `/admin/errors` 오류 로그
- `batch_runs` 이력 기록·조회
- `/admin/control` Phase 토글
- `/admin/logs` audit·batch_runs

### Phase F — Polish (1~2일)
- 데스크탑 1280×800 / 1920×1080 검수
- `/campus/buses` 모바일 360px 검수
- Vercel 배포 + 도메인 연결 (도메인 미정)
- Production smoke test

**총 12~17일** (풀타임, AI 가속 가정. 사역·학업·사업 우선순위 따라 변동)

### Phase별 자동 테스트 게이트

각 Phase 다음으로 넘어가기 전 단위·통합 테스트 필수 통과. 시나리오 목록은 `reference/test_scenarios.md`.

---

## 19. 코딩 컨벤션

- **TypeScript strict** 모드
- **함수형 React** (no class components)
- **Server Components 우선**, Client Components는 인터랙션·realtime 필요시만
- **shadcn/ui** 기본 컴포넌트 활용 (커스텀 최소화)
- **Tailwind** 클래스 (CSS Modules 지양)
- **Korean 주석·docstring** OK, 변수명·함수명·DB 컬럼은 영문 snake_case
- **Zod** 폼 검증 (lib/validators)
- **Drizzle ORM 또는 Supabase 직접 SQL** — 선택 (Phase A에서 결정)
- 한 번에 한 책임 (single responsibility) 원칙

---

## 20. 보안·운영

- `.env.local` git 커밋 X (`.gitignore` 필수)
- Supabase Row Level Security 모든 테이블 ON
- Google OAuth client secret·Supabase service role key 환경변수로만
- 운영자 비밀번호는 Supabase Auth 내장 hash 사용
- 민감 데이터는 외부 LLM에 전송하지 않음

---

## 21. 기술 스택 (확정)

```
Frontend:    Next.js 15 (App Router) + TypeScript strict + Tailwind + shadcn/ui
Grid:        TanStack Table v8
CSV parsing: papaparse
Forms:       Zod + react-hook-form
Backend:     Next.js Server Actions + Route Handlers
DB·Auth:     Supabase (PostgreSQL + Auth + RLS + Realtime)
OAuth:       Google Cloud Console → Supabase Google provider
Testing:     Vitest (단위·통합) + Playwright (E2E)
CI:          GitHub Actions
배포:        Vercel hobby
도메인:      미정 (carbus.71kj.com 후보, 또는 Vercel 기본)
```

---

## 22. 향후 확장 (v4.3+)

- **카카오 알림톡** (사업자 등록 후): 신청·변동·배차 자동 알림
- **오픈뱅킹 API**: 통장 입금 자동 매칭 → payment_status 자동 갱신
- **안정 모드 배차**: 공지 후 호차 고정 (기배정 인원 이동 금지)
- **events 테이블 분리**: 다음 학기·금식기도수련회 템플릿화
- **fee_override**: 예외 차량비 (특별 할인 등)
- **PWA**: 모바일 홈 화면 추가 가능

---

## 23. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|---|---|---|
| v3.2 | 2026-05-13 | 노션 + Python mini 기반 마지막 버전 |
| v4.0 | 2026-05-19 | (이전 Claude 세션 작성, 폐기) 웹앱 첫 명세 |
| v4.1 | 2026-05-20 | 설계 대화 단계 결정 사항 누적 |
| **v4.2** | **2026-05-20** | **최종 명세. 28개 결정 + fee 옵션 A 통합. 노션·mini 폐기 후 작성** |
| v4.2.1 | 2026-05-20 | 인증 카카오→Google 전환 (Supabase account_email 제약 회피) |

→ 28개 결정 사항 전체 기록은 `MIGRATION.md` 참고.

---

## 🔗 Related Notes

- [[MIGRATION]] — 노션·mini → 웹앱 전환 이력 + 결정 28개
- [[reference/data_schemas]] — PostgreSQL DDL 전체
- [[reference/batch_algorithm]] — 배차 알고리즘 의사코드 + TypeScript 포팅
- [[reference/validators]] — Zod 스키마 + 검증 규칙 6가지
- [[reference/payment_flow]] — 차량비 3중 비교 흐름 + SQL VIEW
- [[reference/test_scenarios]] — Phase별 자동 테스트 게이트
