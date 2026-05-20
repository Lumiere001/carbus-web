---
title: 차량비 흐름 (payment flow)
project: carbus-web
version: v4.2
last_modified: 2026-05-20T00:00:00+09:00
status: reference
tags:
  - carbus-web
  - reference
  - payment
---

# 차량비 흐름 — carbus-web v4.2

> CCC 71기 광주지구 여름수련회 차량 관리 웹앱. 순장/순원 시스템 미접근, 임역원 100% 대리 입력.
> 본 문서는 **차량비(fee) 계산 → 순장/순원 송금 → 캠퍼스 송금 → master 통장 입금**까지 4단계 자금 흐름과 3중 비교 정산 구조를 정의한다.

---

## 1. 차량비 자동 계산

`registrations.fee`는 PostgreSQL **GENERATED ALWAYS AS STORED** 컬럼. 애플리케이션 코드에서 직접 계산하지 않는다.

```sql
fee int GENERATED ALWAYS AS (
  CASE WHEN attendance_type = 'roundtrip' THEN 50000 ELSE 25000 END
) STORED
```

| attendance_type | 의미 | fee (원) |
|---|---|---|
| `roundtrip` | 왕복 | 50,000 |
| `oneway_up` | 편도 상행 | 25,000 |
| `oneway_down` | 편도 하행 | 25,000 |

### 정책

- 편도 상행이든 편도 하행이든 **동일하게 25,000원**. 거리·차량 차이 무시 (v1 단순화).
- **임역원·master 모두 fee 직접 수정 불가**. DB가 거부 (GENERATED 컬럼이라 UPDATE 자체 불가).
- 예외 없음. v2에 필요 시 `fee_override int NULL` 컬럼 + audit 추가 검토.
- `attendance_type` 변경 시 fee 자동 재계산 (STORED 라 INSERT/UPDATE 시점에 산출).

---

## 2. 면제 처리

`payment_status = 'waived'`로 토글. **fee 값 자체는 그대로 50K/25K 유지**하되, 합계 계산에서 제외한다.

### UI 표시

```
| 박민준 | 25,000 (면제) | 면제 ▼ |   ← 옅은 회색 + 취소선
```

면제 사유는 별도 컬럼이 아니라 `note` 자유 입력 필드에 기록.

### DB 합계 (VIEW)

```sql
SUM(fee) FILTER (WHERE payment_status = 'paid')  -- 면제·미납 자동 제외
```

PostgreSQL `FILTER` 절로 한 번에 처리. waived와 unpaid는 paid_total에 합산되지 않는다.

---

## 3. 전체 흐름 (순장/순원 → 임역원 → master → 통장)

```
[순장/순원] 임역원에게 카톡으로 신청 + 송금 (시스템 외)
       │
       ▼
[임역원] /campus 또는 /campus/payments 에서
         · 순장/순원 행 입력 → fee 자동 계산 (50K/25K)
         · 순장/순원 송금 받으면 → payment_status 를 '완납'(paid)으로 토글
         · 시스템 자동: 캠퍼스 완납 합계 갱신 (v_payment_summary VIEW)
       │
       ▼
[임역원] 캠퍼스 모은 돈을 master 에게 송금 (시스템 외, 계좌이체)
         · /campus/payments 에서 "master에게 송금" 등록
         · campus_payment_settlements.campus_remitted_total 입력
         · 시스템: 시스템 합계 vs 캠퍼스 송금 합계 차이 표시
       │
       ▼
[master] 본인 통장 확인
         · /admin/payments 에서 캠퍼스별 "통장 입금 받은 금액" 입력
         · campus_payment_settlements.master_received_total 입력
         · 시스템: 캠퍼스 송금 vs master 입금 차이 표시
```

### 각 단계의 시스템 외 행위

| 단계 | 시스템 외 행위 | 시스템 입력 |
|---|---|---|
| 순장/순원 → 임역원 | 카톡 신청, 계좌이체 | 임역원이 grid 입력 + 완납 토글 |
| 임역원 → master | 계좌이체 | 임역원이 송금액 입력 |
| master 통장 확인 | 통장 사본 확인 | master가 입금액 입력 |

---

## 4. 3중 비교 (campus_payment_settlements 활용)

3단계로 차이 추적. 각 차이가 **0이면 정상**, 아니면 색상 강조.

| 차이 | 정의 | 의미 |
|---|---|---|
| **차이 1** | 시스템 완납 합계 − 캠퍼스 송금 합계 | 순장/순원 체크 vs 임역원 실 송금 |
| **차이 2** | 캠퍼스 송금 합계 − master 통장 입금 | 임역원 송금 vs 통장 실 입금 |

### 차이 발생 시 해석

- **차이 1 > 0**: 임역원이 완납 체크는 했는데 master 에게 덜 보냄. (체크 오류 또는 송금 누락)
- **차이 1 < 0**: 캠퍼스가 시스템보다 더 보냄. (이전 회차 누락분 합산 가능성)
- **차이 2 > 0**: 임역원이 보냈다고 등록한 금액보다 통장에 덜 들어옴. (송금 실패/오송금)
- **차이 2 < 0**: 통장에 더 들어옴. (이중 입금 또는 다른 항목 혼입)

---

## 5. /campus/payments 화면 (campus_admin)

본인 캠퍼스 순장/순원 list + 토글 + master 송금 등록. 다른 캠퍼스는 RLS 로 차단.

```
전남대 차량비 정산

순장/순원 납부 현황:
| 이름     | 학번      | 차량비   | 납부 상태 |
| 김OO     | 22XXXXX   | 50,000   | 완납 ▼   |
| 이OO     | 23XXXXX   | 25,000   | 미납 ▼   |
| 박OO     | 24XXXXX   | 25,000   | 면제 ▼   | ← 합계 제외

캠퍼스 합계 (면제 제외):
  미납: N명 · ₩X
  완납: M명 · ₩Y
  면제: K명 (제외)

━━━ master 에게 송금 ━━━
  시스템 완납 합계:               ₩ Y
  실제 master 에게 송금한 금액:   ₩ [_____]  [송금 등록]
  메모:                          [차이 사유]
  차이:                          ±₩...
```

### 동작

- 납부 상태 cell 클릭 → 드롭다운 (미납/완납/면제 3택).
- 상태 변경 시 즉시 Server Action → `registration_audit` 자동 기록.
- 송금 등록은 `campus_payment_settlements` UPSERT (캠퍼스당 1행).

---

## 6. /admin/payments 화면 (viewer 보기 / master 편집)

```
전체 차량비 정산

캠퍼스별 표:
| 캠퍼스   | 완납 합계 (시스템) | 캠퍼스 송금 | master 입금 | 차이1 | 차이2 |
| 전남대   | 1,250,000          | 1,250,000   | 1,250,000   | 0     | 0     |
| 조선대   | 800,000            | 800,000     | 750,000     | 0     | 50,000|
| ...      | ...                | ...         | ...         | ...   | ...   |
| 합계     | X                  | Y           | Z           | X−Y   | Y−Z   |

차이1 = 시스템 - 캠퍼스 송금
차이2 = 캠퍼스 송금 - master 입금
```

### 권한별 동작

| Role | 표 보기 | master_received_total 편집 | 드릴다운 |
|---|---|---|---|
| viewer | O | X (read-only) | O |
| master | O | O (인라인 편집) | O |

- 캠퍼스 행 클릭 → 해당 캠퍼스 순장/순원 list 상세 (드릴다운).
- 차이가 0 아닌 행은 **노란색·빨간색** 색상 강조 (절댓값 기준).
- master 가 인라인 편집 시 Server Action → `campus_payment_settlements` UPDATE.

---

## 7. payment_status 흐름 (상태 머신)

```
unpaid (미납, default)
   │
   │  순장/순원 송금·임역원 확인
   ▼
paid (완납)
   │
   │  (특별 케이스, 임역원·master 판단)
   ▼
waived (면제, 시스템 외 사유)

→ 어느 상태든 다른 상태로 자유 토글 가능 (campus_admin·master)
→ 상태 변경 시 registration_audit 자동 기록
```

### 상태별 합계 계산

| 상태 | paid_total 포함 | unpaid_total 포함 | 화면 표시 |
|---|---|---|---|
| `unpaid` | X | O | 일반 |
| `paid` | O | X | 일반 |
| `waived` | X | X | 옅은 회색 + 취소선 |

---

## 8. SQL VIEW 정의

### 캠퍼스별 납부 요약

```sql
CREATE VIEW v_payment_summary AS
SELECT campus_id,
  COUNT(*) FILTER (WHERE payment_status='unpaid')     AS unpaid_count,
  COUNT(*) FILTER (WHERE payment_status='paid')       AS paid_count,
  COUNT(*) FILTER (WHERE payment_status='waived')     AS waived_count,
  COALESCE(SUM(fee) FILTER (WHERE payment_status='paid'),   0) AS paid_total,
  COALESCE(SUM(fee) FILTER (WHERE payment_status='unpaid'), 0) AS unpaid_total
FROM registrations
GROUP BY campus_id;
```

### 3중 비교 정산

```sql
CREATE VIEW v_payment_3way_comparison AS
SELECT
  c.id AS campus_id,
  c.name AS campus_name,
  COALESCE(ps.paid_total, 0)                                        AS system_paid_total,
  COALESCE(cps.campus_remitted_total, 0)                            AS campus_remitted_total,
  COALESCE(cps.master_received_total, 0)                            AS master_received_total,
  COALESCE(ps.paid_total, 0) - COALESCE(cps.campus_remitted_total, 0) AS diff_1,
  COALESCE(cps.campus_remitted_total, 0)
    - COALESCE(cps.master_received_total, 0)                        AS diff_2
FROM campuses c
LEFT JOIN v_payment_summary ps              ON ps.campus_id  = c.id
LEFT JOIN campus_payment_settlements cps    ON cps.campus_id = c.id;
```

`COALESCE` 로 NULL 캠퍼스 (순장/순원 0명 또는 settlement 미입력)도 0으로 출력.

---

## 9. 분쟁·오류 대응

| 케이스 | 처리 |
|---|---|
| 순장/순원가 잘못된 금액 송금 | `payment_status='unpaid'` 유지 + `note` 에 메모 (예: "20K 송금, 5K 부족") |
| 임역원이 순장/순원 잘못 체크 | `registration_audit` 으로 추적 가능, master 가 강제 롤백 가능 |
| 캠퍼스 송금 누락분 | `campus_remitted_note` 에 메모 (예: "12,000원 누락, 다음 회차 합산") |
| 통장 입금 불명 | `master_received_note` 에 메모 (예: "입금자명 불일치, 확인 중") |
| 순장/순원 환불 | `payment_status='unpaid'` 로 토글 + `note` 에 환불 사유 + 임역원 외부 처리 |

### 감사 로그

- 모든 `payment_status` 변경은 `registration_audit` 테이블에 자동 기록.
- `campus_payment_settlements` 의 송금/입금 금액 변경도 별도 audit 권장 (v2).

---

## 🔗 Related Notes

- [[projects/carbus-web/reference/data_model]] - registrations·campus_payment_settlements 스키마
- [[projects/carbus-web/reference/test_scenarios]] - 차량비 흐름 테스트 시나리오
