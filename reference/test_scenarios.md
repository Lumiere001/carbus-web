---
title: 자동 테스트 시나리오 (test scenarios)
project: carbus-web
version: v4.2
last_modified: 2026-05-20T00:00:00+09:00
status: reference
tags:
  - carbus-web
  - reference
  - testing
---

# 자동 테스트 시나리오 — carbus-web v4.2

> Phase A~F 각 단계의 통과 기준, 단위·통합·E2E·수동 테스트 시나리오를 정의한다.
> 모든 Phase는 게이트 통과 후 다음 Phase로 진행.

---

## 1. 테스트 전략 개요

| 종류 | 범위 | 도구 | 실행 시점 |
|---|---|---|---|
| 단위 | 배차 알고리즘, 검증, fee 계산, CSV 파싱 | Vitest | PR 자동 |
| 통합 | RLS, Server Action, Supabase 권한 | Vitest + Supabase 로컬 | PR 자동 |
| E2E | 로그인 4종, grid 편집, CSV import, 배차 | Playwright | nightly + 배포 전 수동 |
| 수동 | 호차 배정 검수, 통장 대조 | 체크리스트 | 사역 직전 |

### 커버리지 목표

- 단위: lib/* 80% 이상
- 통합: RLS 정책 전수 (캠퍼스 18개 × role 4종 = 72 케이스)
- E2E: smoke (로그인 → 배차 한 사이클) + 핵심 시나리오 10개
- 수동: master 사역 D-1 체크리스트

---

## 2. CI 자동화 (GitHub Actions)

```yaml
# .github/workflows/ci.yml
on:
  pull_request:
    branches: [main]

jobs:
  unit-and-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install
      - run: pnpm test:unit
      - run: supabase start && pnpm test:integration
```

- PR → 단위 + 통합 자동 실행
- main 머지 전 통과 필수 (branch protection)
- E2E 는 nightly cron + 배포 전 수동 trigger
- 실패 시 Slack 알림 (master only)

---

## 3. Phase별 게이트

각 Phase 다음으로 넘어가기 전 **아래 모든 항목 통과 필수**. 한 항목이라도 실패면 Phase 미통과.

### Phase A — 인프라

- [x] Google OAuth 로그인 → `profiles.role='guest'` 자동 생성
- [x] 운영자 비번1 입력 → viewer 세션, `profiles.role='viewer'`
- [x] 운영자 비번2 입력 → master 세션, `profiles.role='master'`
- [x] guest 가 `/admin` 접근 → 차단 (RLS + UI 양쪽)
- [x] campus_admin 이 다른 캠퍼스 SELECT → RLS 차단
- [x] viewer 가 UPDATE/INSERT 시도 → RLS 차단
- [x] Supabase 마이그레이션 적용 성공
- [x] 시드 데이터 18개 캠퍼스 + 9대 버스 검증

**통과 기준**: 위 8개 모두 자동 테스트 통과 + 수동 확인.

### Phase B — 임역원 grid

- [x] `/campus` grid 에서 새 행 추가 → `registrations` INSERT
- [x] 인라인 cell 편집 → UPDATE
- [x] 검증 6규칙 각각 시나리오 (UNIQUE 충돌, student_id 형식 오류 등)
- [x] 충돌 시나리오: A·B 동시 같은 행 다른 필드 → 둘 다 적용
- [x] 충돌 시나리오: A·B 동시 같은 필드 → 늦은 쪽 conflict 알림
- [x] Supabase Realtime: 다른 임역원 변경이 grid 에 자동 반영 (3초 이내)

**통과 기준**: 6개 시나리오 E2E 통과.

### Phase C — Import

- [x] CSV 템플릿 형식 정상 → 23행 import 성공
- [x] 잘못된 형식 (학번 `abc`) → 실패 행 별도 표시
- [x] paste import (TSV) → 정상 파싱
- [x] paste import (헤더 자동 감지) → 컬럼 매핑 정확
- [x] 부분 실패 → 성공 행만 INSERT, 실패 행은 화면에 남아 재시도
- [x] 23행 import 성공 시 audit log 23건 생성

**통과 기준**: 6개 시나리오 통과 + 실패 행 표시 UX 수동 확인.

### Phase D — 운영자 대시보드

- [x] `/admin` 통계 SQL 정확성 (캠퍼스별·일자별·호차별)
- [x] master 가 게스트 → 임역원 부여 → guest 의 다음 로그인에서 `/campus` 접근 가능
- [x] master 가 임역원 권한 해제 → 즉시 차단 (현재 세션 무효화)
- [x] `/admin/registrations` 캠퍼스 탭 정상 동작 (18개 탭 전환)
- [x] `/admin/buses` 차량순장 지정/해제
- [x] `/admin/buses` `fixed_passenger_ids` 추가/제거
- [x] `/admin/roles` 라벨 변경 시 `registrations.roles` 자동 일괄 UPDATE

**통과 기준**: 7개 시나리오 통과 + 권한 변경 즉시성 확인.

### Phase E — 배차

- [x] 배차 시나리오 10+개 (batch_algorithm.md 참고)
- [x] 재배차 시 기존 결과·새 결과 diff 정확
- [x] Phase 1 상태에서 배차 버튼 클릭 → 차단 (`registration_phase != 'phase_2'`)
- [x] Phase 2 + `batch_enabled=true` → 배차 가능
- [x] `batch_runs` 이력 기록 정확 (started_at, completed_at, input_hash)
- [x] 좌석 부족 케이스 → 명확한 에러 메시지

**통과 기준**: 6개 시나리오 통과 + 배차 결과 master 시각 검수.

### Phase F — Polish

- [x] 데스크탑 1280×800 검수 (모든 페이지)
- [x] 데스크탑 1920×1080 검수
- [x] `/campus/buses` 모바일 360px 검수 (순장/순원 조회용 단일 페이지)
- [x] Google OAuth production 도메인 연동
- [x] Vercel 배포 후 smoke test (로그인 → grid → 배차 한 사이클)
- [x] Lighthouse score: Performance 80+, Accessibility 90+

**통과 기준**: 6개 시나리오 + 사용자 (master 본인) 최종 승인.

---

## 4. 핵심 단위 테스트 케이스 (Vitest)

### lib/batch.test.ts (15+개)

| # | 시나리오 | 입력 | 기대 |
|---|---|---|---|
| 1 | 빈 입력 | `[]` | `[]` |
| 2 | 1명만 | 1 reg, 9 bus | 1호차에 1명 |
| 3 | 만석 케이스 | 100 reg, 5 bus (각 20석) | 빈자리 0 |
| 4 | 좌석 부족 | 200 reg, 5 bus (총 100석) | error: "좌석 부족 (부족 100석)" |
| 5 | 차량순장 고정 | bus_leader 지정된 reg | 해당 reg 가 지정 호차 |
| 6 | 같은 캠퍼스 묶음 | 30 reg (3 캠퍼스) | 캠퍼스별 인접 좌석 |
| 7 | split case | 캠퍼스 인원 > 호차 좌석 | 자동 split, 큰 묶음 우선 배치 |
| 8 | 화/수 분리 강제 | TUE 30 + WED 30 | TUE 인원이 WED 차에 절대 X |
| 9 | 하행편도 별도 | oneway_down 5명 | 별도 호차 (하행 전용) |
| 10 | fixed_passenger_ids 우선 | bus.fixed_passenger_ids 설정 | 해당 reg 가 강제 배치 |
| 11 | 차량순장 없는 호차 | bus_leader 미지정 | warning + 미배치 |
| 12 | 좌석 정확히 일치 | 100 reg, 100석 | 빈자리 0, 미배치 0 |
| 13 | 결정성 | 같은 입력 2회 실행 | 동일 결과 (input_hash 일치) |
| 14 | 면제·미납 포함 | payment_status 무관 | 배차에 영향 X |
| 15 | guest reg 제외 | profiles.role='guest' | 배차 대상 X |

### lib/validators.test.ts (10+개)

6규칙 각각 시나리오:

| 규칙 | 정상 | 실패 |
|---|---|---|
| student_id 형식 | `22XXXXX` | `abc`, `123` (자릿수 부족) |
| student_id UNIQUE | 새 학번 | 기존 학번 중복 |
| attendance_type enum | `roundtrip` | `unknown` |
| campus_id FK | 존재하는 캠퍼스 | 없는 UUID |
| roles 배열 | `['연단']` | `['없는역할']` |
| phone 형식 (선택) | `010-XXXX-XXXX` | `abc` |

CSV 행 파싱 케이스:
- 정상 행
- 빈 cell (null 처리)
- 따옴표 포함 (`"김, 둘째 이름"`)
- 헤더 자동 감지 실패 → 1행 첫 데이터로 추정

### lib/payment.test.ts (5+개)

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | fee 자동 계산 - 왕복 | 50,000 |
| 2 | fee 자동 계산 - 편도 (상/하행) | 25,000 |
| 3 | 면제 합계 제외 | waived reg 는 paid_total 에 미포함 |
| 4 | v_payment_summary 정확성 | unpaid·paid·waived 카운트 일치 |
| 5 | v_payment_3way_comparison 정확성 | diff_1, diff_2 산출 정확 |

---

## 5. RLS 통합 테스트 (Supabase 로컬)

각 role 로 supabase client 만들어서 시도. 18개 캠퍼스 × 4개 role.

### guest

```ts
const client = createClient(supabaseUrl, anonKey)
await client.auth.signInWithIdToken({ provider: 'kakao', token: guestToken })

expect(await client.from('registrations').select()).toHaveLength(0)
expect(await client.from('campuses').select()).toHaveLength(18)  // 캠퍼스 자체는 공개
expect(await client.from('registrations').insert({...})).toReject()
```

### campus_admin (전남대 예시)

```ts
const result = await client.from('registrations').select()
expect(result.every(r => r.campus_id === 전남대Id)).toBe(true)

// 다른 캠퍼스 INSERT 시도
const insertOther = await client.from('registrations')
  .insert({ campus_id: 조선대Id, ... })
expect(insertOther.error).toBeDefined()
```

### viewer

```ts
expect(await client.from('registrations').select()).toHaveLengthGreaterThan(0)  // 전체 조회 가능
expect(await client.from('registrations').update({...}).eq('id', someId)).toReject()
expect(await client.from('registrations').insert({...})).toReject()
expect(await client.from('registrations').delete().eq('id', someId)).toReject()
```

### master

```ts
expect(await client.from('registrations').select()).toHaveLengthGreaterThan(0)
expect(await client.from('registrations').insert({...})).toResolve()
expect(await client.from('registrations').update({...}).eq('id', someId)).toResolve()
expect(await client.from('profiles').update({ role: 'campus_admin' })...).toResolve()
```

---

## 6. E2E (Playwright) 시나리오

### 6.1 로그인 4종

| # | 시나리오 | 기대 결과 |
|---|---|---|
| 1 | Google OAuth → guest 페이지 | `/` 진입, "역할 부여 대기" 메시지 |
| 2 | 비번1 입력 → viewer 대시보드 | `/admin` 접근, 액션 버튼 (편집·배차) 없음 |
| 3 | 비번2 입력 → master 대시보드 | `/admin` 접근, 모든 버튼 활성 |
| 4 | master 가 guest 에게 campus_admin 부여 → guest 재로그인 | `/campus` 접근 가능 |

### 6.2 campus_admin grid 워크플로우

```
1. /campus 진입
2. 새 행 추가 (이름, 학번, 캠퍼스, attendance_type)
3. 행 저장 → fee 자동 표시 (50K 또는 25K)
4. payment_status cell 클릭 → "완납" 선택
5. CSV 파일 업로드 → 23행 import
6. 실패 행 (학번 abc) → 화면에 빨간색 표시
7. /campus/payments 진입 → "master 에게 송금" 금액 입력 → 등록
```

### 6.3 master 배차 워크플로우

```
1. /admin 진입 (master 로그인)
2. /admin/registrations 에서 Phase 1 → Phase 2 전환
3. /admin/buses 에서 9대 모두 차량순장 지정 확인
4. "배차 실행" 버튼 클릭
5. 결과 시각화 (호차별 명단, 빈자리, 미배치) 확인
6. 호차 명단 PDF/CSV 다운로드
7. /admin/payments 진입
8. 캠퍼스별 통장 입금 금액 입력
9. 3중 비교 표에서 차이 0 확인
```

### 6.4 권한 차단

| # | 시나리오 | 기대 |
|---|---|---|
| 1 | guest 가 `/admin` 직접 URL 접근 | 302 → `/` 리다이렉트 |
| 2 | viewer 가 grid 편집 버튼 시도 | UI 버튼 disabled + RLS 차단 |
| 3 | campus_admin 이 `/admin/buses` 접근 | 403 페이지 |
| 4 | master 가 권한 해제 후 다른 master 재접근 | 즉시 차단 |

### 6.5 Realtime 동기화

```
1. 2개 브라우저 창에서 campus_admin A, B 로그인
2. A 가 새 행 추가
3. B 의 grid 에 3초 이내 자동 반영
4. A·B 동시 같은 행 다른 필드 편집 → 둘 다 적용
5. A·B 동시 같은 필드 편집 → 늦은 쪽에 conflict 알림 표시
```

---

## 7. 수동 테스트 체크리스트

### 사역 D-1 master 체크리스트

- [ ] Phase 가 `phase_2` 인가
- [ ] 9대 차량 모두 차량순장 지정됐는가
- [ ] 미납 순장/순원 명단 출력 → 임역원에게 공유했는가
- [ ] 배차 결과 호차별 명단 인쇄 (각 차량순장에게)
- [ ] 3중 비교 차이 0 인가
- [ ] 통장 입금 누락 캠퍼스 있는가
- [ ] Google OAuth production 정상 동작 (모바일에서 순장/순원용 `/campus/buses` 확인)

### 사역 당일 운영 체크리스트

- [ ] 차량순장 9명 호차별 명단 보유 확인
- [ ] 현장 추가 순장/순원 처리 절차 합의 (수기 → 임역원 grid 추가 → 재배차 안 함)
- [ ] 하행 편도 별도 호차 출발 시각 공유

---

## 8. 테스트 데이터 시드

```sql
-- supabase/seed.sql
INSERT INTO campuses (id, name, region) VALUES
  ('uuid-1', '전남대', '광주'),
  ('uuid-2', '조선대', '광주'),
  ...  -- 18개

INSERT INTO buses (id, name, capacity) VALUES
  ('bus-1', '1호차', 45),
  ...  -- 9대

INSERT INTO profiles (id, role, name) VALUES
  ('test-master-id',  'master',       'Test Master'),
  ('test-viewer-id',  'viewer',       'Test Viewer'),
  ('test-admin-id',   'campus_admin', 'Test 전남대 임역원'),
  ('test-guest-id',   'guest',        'Test Guest');
```

테스트용 순장/순원 reg 30~100건은 fixture factory 로 생성 (`tests/fixtures/registrations.ts`).

---

## 🔗 Related Notes

- [[projects/carbus-web/reference/payment_flow]] - 차량비 흐름 (테스트 대상)
- [[projects/carbus-web/reference/batch_algorithm]] - 배차 알고리즘 (Phase E 입력)
- [[projects/carbus-web/reference/data_model]] - RLS·VIEW 정의 출처
