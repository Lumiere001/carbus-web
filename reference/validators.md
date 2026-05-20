---
type: reference
project: carbus-web
version: v4.2
created: 2026-05-20T00:00:00+09:00
last_modified: 2026-05-20T00:00:00+09:00
sensitivity: sensitive
tags:
  - carbus
  - validation
  - reference
---

# 검증 규칙 (validators) — carbus-web v4.2

> CCC 71기 광주지구 여름수련회 차량 신청 입력 검증.
> 클라이언트 (Zod) · 서버 (Server Action) · DB (CHECK) 3중 방어선.
> v3.2 대비 phone 컬럼·부분참 도착/출발일 컬럼 제거 → 관련 규칙 자동 폐기.

---

## 1. 검증 규칙 6가지

| # | 규칙 | 메시지 |
|---|---|---|
| 1 | **UNIQUE (campus_id, student_id, name)** | "이미 등록된 순장/순원입니다 (캠퍼스·학번·이름 동일)" |
| 2 | **student_id 형식**: 2자리 숫자 OR '간사' OR '외국인' OR '타지구' | "학번 형식이 올바르지 않습니다 (예: 26 / 간사 / 외국인 / 타지구)" |
| 3 | **roundtrip 일관성**: attendance_type='roundtrip' → departure_day NOT NULL AND uses_return_bus=true | "왕복은 상행 요일과 하행 차량 이용이 모두 필요합니다" |
| 4 | **oneway 일관성**: 편도 상행 (departure_day NOT NULL + uses_return_bus=false) 또는 편도 하행 (departure_day NULL + uses_return_bus=true) 중 하나 | "편도는 상행 또는 하행 중 하나만 선택 가능합니다" |
| 5 | **departure_day 운영 요일**: TUE/WED/NULL 만 허용 | "현재 운영 요일은 화요일·수요일입니다" |
| 6 | **수정·취소 대상 존재**: id로 SELECT → 결과 없으면 fail | "신청 내역을 찾을 수 없습니다" |

**폐기된 v3.2 규칙:**
- "휴대폰 번호 형식" → phone 컬럼 제거로 자동 폐기
- "부분참 도착/출발일 필수" → 해당 컬럼 제거 + attendance_type 단순화로 자동 폐기

---

## 2. 검증 시점 (3중 방어선)

| 시점 | 도구 | 책임 |
|---|---|---|
| 클라이언트 (브라우저 폼) | Zod schema + react-hook-form | 즉시 UI inline error, UX 향상 |
| 서버 (Server Action) | 동일 Zod schema + DB 접근 검증 | UNIQUE, 대상 존재, 권한 |
| DB (Supabase Postgres) | CHECK 제약 + UNIQUE 인덱스 | 마지막 방어선 (race condition 대비) |

**원칙**: 클라이언트 검증은 신뢰하지 않는다. 서버에서 다시 검증. DB CHECK는 동시성 보호.

---

## 3. TypeScript Zod schema (~80줄)

```typescript
// src/lib/validators/registration.ts
import { z } from 'zod';

export const STUDENT_ID_SPECIAL = ['간사', '외국인', '타지구'] as const;
export const DEPARTURE_DAYS = ['TUE', 'WED'] as const;
export const ATTENDANCE_TYPES = ['roundtrip', 'oneway'] as const;

export const RegistrationSchema = z
  .object({
    name: z
      .string()
      .min(1, '이름은 필수입니다')
      .max(20, '이름이 너무 깁니다 (20자 이내)'),
    campus_id: z.string().uuid('캠퍼스를 선택해주세요'),
    student_id: z.string().refine(
      (v) =>
        /^\d{2}$/.test(v) ||
        (STUDENT_ID_SPECIAL as readonly string[]).includes(v),
      {
        message: '학번 형식이 올바르지 않습니다 (예: 26 / 간사 / 외국인 / 타지구)',
      }
    ),
    attendance_type: z.enum(ATTENDANCE_TYPES, {
      errorMap: () => ({ message: '참석 유형을 선택해주세요' }),
    }),
    departure_day: z.enum(DEPARTURE_DAYS).nullable(),
    uses_return_bus: z.boolean(),
    note: z.string().max(200, '비고는 200자 이내').optional(),
    roles: z.array(z.string()).optional().default([]),
  })
  // 규칙 3: 왕복 일관성
  .refine(
    (data) => {
      if (data.attendance_type !== 'roundtrip') return true;
      return data.departure_day !== null && data.uses_return_bus === true;
    },
    {
      message: '왕복은 상행 요일과 하행 차량 이용이 모두 필요합니다',
      path: ['attendance_type'],
    }
  )
  // 규칙 4: 편도 일관성
  .refine(
    (data) => {
      if (data.attendance_type !== 'oneway') return true;
      const upOnly = data.departure_day !== null && data.uses_return_bus === false;
      const downOnly = data.departure_day === null && data.uses_return_bus === true;
      return upOnly || downOnly;
    },
    {
      message: '편도는 상행 또는 하행 중 하나만 선택 가능합니다',
      path: ['attendance_type'],
    }
  );

export type RegistrationInput = z.infer<typeof RegistrationSchema>;

// CSV import용 (한글 헤더 매핑 후 적용)
export const RegistrationCsvRowSchema = RegistrationSchema;

// 수정 시 (id 포함)
export const RegistrationUpdateSchema = RegistrationSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().nonnegative(),
});
```

---

## 4. 서버 측 추가 검증 (DB 접근 필요)

Zod로 잡을 수 없는 검증은 Server Action 내부에서 별도 처리.

```typescript
// src/app/(public)/register/actions.ts
'use server';
import { createClient } from '@/lib/supabase/server';
import { RegistrationSchema } from '@/lib/validators/registration';

export async function registerAction(input: unknown) {
  const parsed = RegistrationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten() };
  }
  const data = parsed.data;
  const supabase = createClient();

  // 규칙 1: UNIQUE
  const { data: existing } = await supabase
    .from('registrations')
    .select('id')
    .eq('campus_id', data.campus_id)
    .eq('student_id', data.student_id)
    .eq('name', data.name)
    .maybeSingle();
  if (existing) {
    return {
      ok: false,
      errors: { name: ['이미 등록된 순장/순원입니다 (캠퍼스·학번·이름 동일)'] },
    };
  }

  // INSERT
  const { error } = await supabase.from('registrations').insert(data);
  if (error) {
    // DB CHECK 위반 등 마지막 방어선
    return { ok: false, errors: { _form: [error.message] } };
  }
  return { ok: true };
}

export async function updateAction(input: unknown) {
  // 규칙 6: 대상 존재
  const { data: target } = await supabase
    .from('registrations')
    .select('id, version')
    .eq('id', input.id)
    .maybeSingle();
  if (!target) {
    return { ok: false, errors: { _form: ['신청 내역을 찾을 수 없습니다'] } };
  }
  // 낙관적 동시성: version 체크
  if (target.version !== input.version) {
    return { ok: false, errors: { _form: ['다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해주세요'] } };
  }
  // ... UPDATE
}
```

---

## 5. CSV import 검증

`/admin/csv-import` 페이지에서 일괄 등록.

**흐름:**
1. papaparse로 CSV 파싱 (한글 헤더)
2. 헤더 → 영문 필드 매핑 (§7 참고)
3. 행마다 Zod 적용
4. 성공/실패 행 분리
5. UI에 실패 행 표시 (행 번호 · 사유 · 원본 데이터)
6. 사용자가 "성공 행만 등록" 또는 "수정 후 재시도"

```typescript
// src/lib/csv/parseRegistrations.ts
import Papa from 'papaparse';
import { RegistrationSchema } from '@/lib/validators/registration';

const HEADER_MAP: Record<string, string> = {
  이름: 'name',
  학번: 'student_id',
  '참석 유형': 'attendance_type',
  '상행 요일': 'departure_day',
  '하행 차량 이용': 'uses_return_bus',
  역할: 'roles',
  비고: 'note',
  캠퍼스: 'campus_name', // master CSV 전용. 이후 campus_id로 lookup
};

const ATTENDANCE_MAP: Record<string, string> = {
  왕복: 'roundtrip',
  편도: 'oneway',
};

const DAY_MAP: Record<string, string | null> = {
  화요일: 'TUE',
  수요일: 'WED',
  '': null,
};

const BOOL_MAP: Record<string, boolean> = {
  O: true,
  X: false,
  true: true,
  false: false,
  Y: true,
  N: false,
};

export function parseRegistrationsCsv(csv: string) {
  const result = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  const successes: any[] = [];
  const failures: { row: number; reason: string; raw: any }[] = [];

  result.data.forEach((row, idx) => {
    const mapped: any = {};
    for (const [kor, eng] of Object.entries(HEADER_MAP)) {
      if (row[kor] !== undefined) mapped[eng] = row[kor];
    }
    // 값 변환
    if (mapped.attendance_type) mapped.attendance_type = ATTENDANCE_MAP[mapped.attendance_type] ?? mapped.attendance_type;
    if ('departure_day' in mapped) mapped.departure_day = DAY_MAP[mapped.departure_day] ?? null;
    if ('uses_return_bus' in mapped) mapped.uses_return_bus = BOOL_MAP[mapped.uses_return_bus] ?? false;
    if ('roles' in mapped && typeof mapped.roles === 'string') mapped.roles = mapped.roles.split(',').map((s) => s.trim()).filter(Boolean);

    const parsed = RegistrationSchema.safeParse(mapped);
    if (parsed.success) {
      successes.push(parsed.data);
    } else {
      failures.push({
        row: idx + 2, // 1-based + 헤더 행
        reason: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        raw: row,
      });
    }
  });

  return { successes, failures };
}
```

---

## 6. 오류 메시지 톤·앤·매너

| 원칙 | 좋음 | 나쁨 |
|---|---|---|
| 친절 | "이미 등록된 순장/순원입니다" | "ERROR: duplicate key" |
| 구체적 (어느 필드) | "학번 형식이 올바르지 않습니다 (예: 26 / 간사)" | "Invalid input" |
| 행동 가능 (다음 단계) | "새로고침 후 다시 시도해주세요" | "Failed" |
| 책임 회피 X | "다른 사용자가 먼저 수정했습니다" | "User error" |

**왜 한국어인가**: 사용자가 모두 한국 대학생·간사. 영어 stack trace는 신뢰 손상.

---

## 7. CSV 템플릿 (UI 한글 라벨 매핑)

### 임역원용 (캠퍼스 자동 = 본인 캠퍼스, 역할 컬럼 없음)

```csv
이름,학번,참석 유형,상행 요일,하행 차량 이용,비고
김철수,26,왕복,화요일,O,
이영희,27,편도,화요일,X,상행만 참석
박지민,간사,편도,,O,하행만 (토요일)
최민수,외국인,왕복,수요일,O,
```

### Master용 (캠퍼스 + 역할 포함)

```csv
캠퍼스,이름,학번,참석 유형,상행 요일,하행 차량 이용,역할,비고
전남대,김철수,26,왕복,화요일,O,채플담당,
조선대,이영희,27,편도,화요일,X,,상행만
호남대,박지민,간사,편도,,O,연단,하행만 (토요일)
```

### 컬럼 매핑 표

| CSV 한글 헤더 | DB 영문 필드 | 변환 |
|---|---|---|
| 이름 | name | (그대로) |
| 학번 | student_id | (그대로) |
| 참석 유형 | attendance_type | 왕복 → roundtrip, 편도 → oneway |
| 상행 요일 | departure_day | 화요일 → TUE, 수요일 → WED, 공란 → NULL |
| 하행 차량 이용 | uses_return_bus | O/Y/true → true, X/N/false → false |
| 역할 | roles | 콤마 split (예: "채플담당,연단" → ["채플담당", "연단"]) |
| 비고 | note | (그대로) |
| 캠퍼스 (master만) | campus_name → campus_id | 이름으로 campuses 테이블 lookup |

---

## 8. 테스트 시나리오

| # | 입력 | 기대 |
|---|---|---|
| 1 | name="", student_id="26" | 규칙 1 위반: "이름은 필수입니다" |
| 2 | name="김철수", student_id="2611" | 규칙 2 위반: "학번 형식이 올바르지 않습니다" |
| 3 | student_id="간사" | pass |
| 4 | attendance_type=roundtrip, departure_day=null | 규칙 3 위반: "왕복은 상행 요일과 하행 차량 이용이 모두 필요합니다" |
| 5 | attendance_type=oneway, departure_day=TUE, uses_return_bus=true | 규칙 4 위반: "편도는 상행 또는 하행 중 하나만" |
| 6 | attendance_type=oneway, departure_day=null, uses_return_bus=true | pass (편도 하행) |
| 7 | attendance_type=oneway, departure_day=null, uses_return_bus=false | 규칙 4 위반 |
| 8 | departure_day="THU" | 규칙 5 위반 (Zod enum) |
| 9 | (campus_id, student_id, name) 이미 존재 | 규칙 1 위반 (서버) |
| 10 | update id 존재 X | 규칙 6 위반: "신청 내역을 찾을 수 없습니다" |

테스트 위치: `src/lib/validators/__tests__/registration.test.ts`

---

## 9. DB CHECK 제약 (참고)

Zod 외 마지막 방어선. 자세한 DDL은 [[data_schemas]] 참고.

```sql
-- CHECK: roundtrip 일관성
ALTER TABLE registrations ADD CONSTRAINT chk_roundtrip
  CHECK (
    attendance_type <> 'roundtrip' OR
    (departure_day IS NOT NULL AND uses_return_bus = true)
  );

-- CHECK: oneway 일관성
ALTER TABLE registrations ADD CONSTRAINT chk_oneway
  CHECK (
    attendance_type <> 'oneway' OR
    (departure_day IS NOT NULL AND uses_return_bus = false) OR
    (departure_day IS NULL AND uses_return_bus = true)
  );

-- UNIQUE: 중복 신청 방지
CREATE UNIQUE INDEX uniq_registration 
  ON registrations (campus_id, student_id, name);
```

---

## Related Notes
- [[batch_algorithm]] - 검증 통과 후 진행되는 배차 알고리즘
- [[data_schemas]] - 컬럼 정의 + DB CHECK 제약 DDL
- [[../README]] - carbus-web 프로젝트 개요
