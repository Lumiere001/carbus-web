---
type: reference
project: carbus-web
version: v4.2
created: 2026-05-20T00:00:00+09:00
last_modified: 2026-05-20T00:00:00+09:00
sensitivity: sensitive
tags:
  - carbus
  - algorithm
  - reference
---

# 배차 알고리즘 (batch_algorithm) — carbus-web v4.2

> CCC 71기 광주지구 여름수련회 차량 관리 웹앱.
> mini 시스템의 Python `batch.py`를 Next.js + Supabase 환경 TypeScript로 포팅한 결과물.
> 9대(화 4 / 수 4 / 토 9 운영) × capacity 44 (hard_cap 45) 기준.

---

## 1. 알고리즘 개요

**6단계 Bin Packing 휴리스틱.** 완전탐색·ILP 대신 우선순위 기반 그리디(greedy)로 9대 × 44석을 채운다. 입력은 `registrations` 전체 row + `buses` 9대. 출력은 각 신청자의 `assigned_up_bus_id`, `assigned_down_bus_id` UPDATE + `batch_runs` 실행 이력 INSERT.

**왜 그리디인가?**
- 308명 × 9 bin 규모에서 ILP는 과잉
- "같은 캠퍼스 같은 호차" 같은 인간 친화 제약이 최적화 목적함수보다 운영상 더 중요
- 미배정 발생 시 운영자가 즉시 호차 증편 판단 가능해야 함 → 알고리즘 의사결정이 사람이 따라가 읽을 수 있어야 함

**배정 규칙 (v4.6 — FFD 캠퍼스 단위, 우선순위 사용자 확정):**
1. **미배정 최소화** (최우선) — 정원이 허용하는 한 전원 배정.
2. **호차 꽉 채움(44)** — 빈 좌석·사용 호차 최소화. 보조석(45)은 44×대수로 부족할 때만.
3. **같은 캠퍼스 묶음(soft)** — 안 되면 찢어서라도 채움.
   - **3-1. 차량순장 캠퍼스 우선 [v4.6]** — 순장이 있는 호차에 같은 캠퍼스를
     정원(44)까지 먼저 채운다(상·하행 각각). 넘치는 인원·남는 좌석은 일반 배차가 처리.
     **예외: 1호차** — 임원·총단 등 여러 캠퍼스가 섞이는 차라 캠퍼스 우선 없이 일반 배차
     (`engine.ts`의 `COHESION_EXEMPT_BUS_NAMES`, 이름 기준).
4. **혼자만 다른 캠퍼스 금지** — 분할 조각이 1명이 되지 않게 보정.
구현(FFD — First-Fit Decreasing): ⓪ 순장 있는 호차에 같은 캠퍼스를 정원까지 우선 배정 →
그 뒤 남은 인원을 캠퍼스 큰 순으로 ① 통째로 들어가는 호차 중 잔여 최소(best-fit)에 배정
→ ② 어느 호차에도 통째로 못 들어가면 잔여 큰 호차부터 분할(1명 조각 방지)
→ ③ 정원(44) 다 차면 보조석(45) → 그래도 넘치면 미배정.
v4.4 순차 채움(next-fit) 대비 작은 캠퍼스의 불필요한 분할을 제거(빈좌석은 동일 — 파레토 개선).
더미 300 시뮬 기준 같은요일 분할 3→0, 정원턱(396) 6→1(전남대 등 정원 초과 캠퍼스만).
[v4.6] 차량순장이 있는 호차는 그 순장의 캠퍼스를 정원까지 먼저 끌어온다(상·하행 각각의
`driver_registration_id` / `down_driver_registration_id` 기준). 고정탑승은 캠퍼스를 끌지 않음.
상행/하행은 `mode` 로 따로 실행(상행 버튼·하행 버튼 분리).

---

## 2. 우선순위 (절대 순서)

| 순위 | 제약 | 강도 | 설명 |
|---|---|---|---|
| 1 | **같은 캠퍼스 → 같은 호차** | hard | 인솔·안내 편의. 캠퍼스 분할은 hard_cap 도달 시에만. |
| 2 | **요일 분리** | hard (위반 절대 X) | TUE 호차에 WED 인원 절대 탑승 X. departure_day로 강제 분리. |
| 3 | **고정 배정 보존** | hard | `buses.driver_registration_id` (차량순장) + `buses.fixed_passenger_ids[]` 는 해당 호차에서 절대 이동 X. |
| 4 | **역할 기반** | soft (v1 placeholder) | v1: `fixed_passenger_ids[]` 로 대체. v2: roles 라벨 기반 자동 배정. |

**충돌 시 1 → 2 → 3 → 4 순서로 적용.** 단, 2·3은 절대 위반 불가이므로 충돌 발생 시 운영자에게 alert + 미배정 처리.

---

## 3. 6단계 의사코드

```
입력: registrations (전체 신청자), buses (9대)
출력: assignments Map<registration_id, {up_bus_id, down_bus_id}>, errors[]

────────────────────────────────────────────────────────────
Step 1. 고정 배정 (driver + fixed_passenger_ids)
────────────────────────────────────────────────────────────
for each bus in buses:
    fixed_ids = unique([bus.driver_registration_id, ...bus.fixed_passenger_ids])
    for each rid in fixed_ids:
        if rid is null: continue
        reg = registrations[rid]
        # 요일 일치 검증 (방어적)
        if reg.departure_day != bus.departure_day:
            errors.push("고정 배정 요일 불일치: " + reg.name)
            continue
        assignments[rid].up_bus_id = bus.id
        bus.remaining_capacity -= 1
        mark reg as PINNED  # 이후 단계에서 건드리지 않음

────────────────────────────────────────────────────────────
Step 2. 역할 기반 필수 탑승자 (v1: NO-OP placeholder)
────────────────────────────────────────────────────────────
# v1은 fixed_passenger_ids로 대체. v2에서 roles 라벨 매핑 도입.
pass

────────────────────────────────────────────────────────────
Step 3. 상행 요일별 분리
────────────────────────────────────────────────────────────
unpinned = registrations filter !PINNED
byDay = {
  'TUE': unpinned filter (departure_day == 'TUE'),
  'WED': unpinned filter (departure_day == 'WED'),
}
downOnly = unpinned filter (departure_day == null && uses_return_bus == true)
# departure_day == null 인 oneway-하행편도는 별도 Step 5에서 처리

────────────────────────────────────────────────────────────
Step 4. 캠퍼스 단위 묶음 배정 (Bin Packing)
────────────────────────────────────────────────────────────
for day in ['TUE', 'WED']:
    group = byDay[day]
    dayBuses = buses filter (departure_day == day)
    
    # (a) 캠퍼스별 그룹화
    byCampus = groupBy(group, 'campus_id')
    
    # (b) 인원 큰 캠퍼스 우선 정렬
    sortedCampuses = byCampus entries sorted by length DESC
    
    # (c) 큰 캠퍼스부터: 여유 좌석 가장 많은 호차에 한 번에
    for [campus_id, members] in sortedCampuses:
        # 가장 여유 큰 호차 선택
        target = dayBuses sorted by remaining_capacity DESC [0]
        
        if target.remaining_capacity >= members.length:
            # 한 호차에 통째로
            for m in members:
                assignments[m.id].up_bus_id = target.id
                target.remaining_capacity -= 1
        else:
            # (d) capacity 초과 → hard_cap 45까지 fallback
            # 또는 캠퍼스 분할 (여러 호차에 나눔)
            split_and_pack(members, dayBuses, errors)

────────────────────────────────────────────────────────────
Step 5. 하행 (down) — 상행과 완전히 독립 배정  [v4.3 변경]
────────────────────────────────────────────────────────────
# 하행 대상 = uses_return_bus == true 전원 (왕복 + 하행편도)
# 토요일은 9대 모두 운행. 요일 무관, 상행 호차 상속 X.
# → 왕복자도 상행 호차와 하행 호차가 다를 수 있음.
# [v4.5] 하행도 차량순장·고정탑승 지원 — 상행과 별개 컬럼
#        (down_driver_registration_id, down_fixed_passenger_ids).
#        하행은 요일 제약이 없으므로 요일 일치 검증 없이 그대로 고정.
downPinned = buses 의 down_driver + down_fixed → 해당 호차 선점 (uses_return_bus 확인)
downParticipants = registrations filter (uses_return_bus == true) − downPinned
downBuses = buses (전부, 잔여좌석 독립 트래커, 고정분 count 반영)
# 상행과 동일한 FFD 캠퍼스 묶음을 down 풀에 별도 실행
packGroup("하행", downParticipants, downBuses, assignDown, errors)

# 편도-상행 (uses_return_bus == false): 하행 없음 → down_bus_id = null (기본값)

────────────────────────────────────────────────────────────
Step 6. 결과 write back
────────────────────────────────────────────────────────────
BEGIN TRANSACTION
  for [rid, a] in assignments:
    UPDATE registrations 
      SET assigned_up_bus_id = a.up_bus_id, 
          assigned_down_bus_id = a.down_bus_id, 
          version = version + 1
      WHERE id = rid
  
  INSERT INTO batch_runs (
    total_registrations, by_bus_jsonb, empty_seats, success, 
    errors_jsonb, elapsed_ms, created_by
  ) VALUES (...)
COMMIT
```

---

## 4. TypeScript 포팅 (~150줄)

```typescript
// src/lib/batch/runBatch.ts
import type { Database } from '@/types/supabase';

type Bus = Database['public']['Tables']['buses']['Row'] & {
  remaining_capacity: number;
};
type Passenger = Database['public']['Tables']['registrations']['Row'];

export type BatchResult = {
  assignments: Map<string, { up_bus_id: string | null; down_bus_id: string | null }>;
  byBusCount: Record<string, number>;
  emptySeats: number;
  errors: string[];
  elapsedMs: number;
};

export async function runBatch(
  passengers: Passenger[],
  busesRaw: Database['public']['Tables']['buses']['Row'][]
): Promise<BatchResult> {
  const start = Date.now();
  const buses: Bus[] = busesRaw.map((b) => ({ ...b, remaining_capacity: b.capacity }));
  const assignments = new Map<string, { up_bus_id: string | null; down_bus_id: string | null }>();
  const errors: string[] = [];
  const pinned = new Set<string>();

  passengers.forEach((p) => assignments.set(p.id, { up_bus_id: null, down_bus_id: null }));

  // Step 1. 고정 배정
  for (const bus of buses) {
    const fixedIds = Array.from(
      new Set([bus.driver_registration_id, ...(bus.fixed_passenger_ids ?? [])].filter(Boolean))
    ) as string[];
    for (const rid of fixedIds) {
      const reg = passengers.find((p) => p.id === rid);
      if (!reg) continue;
      if (reg.departure_day !== bus.departure_day) {
        errors.push(`고정 배정 요일 불일치: ${reg.name} (${reg.departure_day} → bus ${bus.name})`);
        continue;
      }
      assignments.get(rid)!.up_bus_id = bus.id;
      bus.remaining_capacity -= 1;
      pinned.add(rid);
    }
  }

  // Step 2. 역할 기반 (v1 no-op)

  // Step 3. 요일별 분리
  const unpinned = passengers.filter((p) => !pinned.has(p.id));
  const byDay: Record<'TUE' | 'WED', Passenger[]> = {
    TUE: unpinned.filter((p) => p.departure_day === 'TUE'),
    WED: unpinned.filter((p) => p.departure_day === 'WED'),
  };
  const downOnly = unpinned.filter(
    (p) => p.departure_day === null && p.uses_return_bus === true
  );

  // Step 4. 캠퍼스 묶음 배정
  for (const day of ['TUE', 'WED'] as const) {
    const group = byDay[day];
    const dayBuses = buses.filter((b) => b.departure_day === day);
    const byCampus = new Map<string, Passenger[]>();
    group.forEach((p) => {
      if (!byCampus.has(p.campus_id)) byCampus.set(p.campus_id, []);
      byCampus.get(p.campus_id)!.push(p);
    });
    const sorted = [...byCampus.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [campusId, members] of sorted) {
      const target = [...dayBuses].sort((a, b) => b.remaining_capacity - a.remaining_capacity)[0];
      if (!target) {
        errors.push(`${day} 호차 없음: 캠퍼스 ${campusId} ${members.length}명 미배정`);
        continue;
      }
      if (target.remaining_capacity >= members.length) {
        // 통째로 배정
        for (const m of members) {
          assignments.get(m.id)!.up_bus_id = target.id;
          target.remaining_capacity -= 1;
        }
      } else {
        // 캠퍼스 분할 (큰 캠퍼스가 호차 1대 못 들어감)
        let remaining = [...members];
        while (remaining.length > 0) {
          const next = [...dayBuses]
            .filter((b) => b.remaining_capacity > 0)
            .sort((a, b) => b.remaining_capacity - a.remaining_capacity)[0];
          if (!next) {
            errors.push(
              `미배정: ${day} 캠퍼스 ${campusId} ${remaining.length}명 (좌석 부족)`
            );
            break;
          }
          // hard_cap까지 사용
          const cap = Math.min(next.hard_cap - (next.capacity - next.remaining_capacity), remaining.length);
          const take = remaining.splice(0, cap);
          for (const m of take) {
            assignments.get(m.id)!.up_bus_id = next.id;
            next.remaining_capacity -= 1;
          }
        }
      }
    }
  }

  // Step 5. 하행 처리
  // 완참: down = up
  // 편도 상행: down = null (이미 null)
  // 편도 하행만 (downOnly): 별도 packDown
  for (const p of passengers) {
    if (p.attendance_type === 'roundtrip') {
      const up = assignments.get(p.id)!.up_bus_id;
      assignments.get(p.id)!.down_bus_id = up;
    }
  }
  // downOnly 별도 배정 (캠퍼스 묶음 유지, 토요일 9대 빈자리)
  const downBuses = buses.map((b) => ({ ...b, remaining_capacity: b.capacity }));
  // 이미 배정된 down 인원 차감
  for (const p of passengers) {
    const dn = assignments.get(p.id)!.down_bus_id;
    if (dn) {
      const b = downBuses.find((x) => x.id === dn);
      if (b) b.remaining_capacity -= 1;
    }
  }
  const downByCampus = new Map<string, Passenger[]>();
  downOnly.forEach((p) => {
    if (!downByCampus.has(p.campus_id)) downByCampus.set(p.campus_id, []);
    downByCampus.get(p.campus_id)!.push(p);
  });
  for (const [campusId, members] of [...downByCampus.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const target = [...downBuses].sort((a, b) => b.remaining_capacity - a.remaining_capacity)[0];
    if (!target || target.remaining_capacity < members.length) {
      errors.push(`하행편도 미배정: 캠퍼스 ${campusId} ${members.length}명`);
      continue;
    }
    for (const m of members) {
      assignments.get(m.id)!.down_bus_id = target.id;
      target.remaining_capacity -= 1;
    }
  }

  // 집계
  const byBusCount: Record<string, number> = {};
  let assignedCount = 0;
  for (const [, a] of assignments) {
    if (a.up_bus_id) {
      byBusCount[a.up_bus_id] = (byBusCount[a.up_bus_id] ?? 0) + 1;
      assignedCount += 1;
    }
  }
  const emptySeats = buses.reduce((s, b) => s + b.remaining_capacity, 0);

  return {
    assignments,
    byBusCount,
    emptySeats,
    errors,
    elapsedMs: Date.now() - start,
  };
}
```

**스타일 규약:**
- TypeScript strict 모드
- 함수형, 부수효과 최소화 (write back은 Server Action에서 분리)
- 캠퍼스 분할 fallback은 `split_and_pack` 인라인으로 처리 (별도 함수 추출은 v2)

---

## 5. 하행 처리 명세

| 케이스 | attendance_type | departure_day | uses_return_bus | assigned_down_bus_id |
|---|---|---|---|---|
| 완참 | roundtrip | TUE/WED | true | = assigned_up_bus_id (단순 매핑) |
| 편도-상행 | oneway | TUE/WED | false | NULL |
| 편도-하행 | oneway | NULL | true | Step 5 별도 배정 (캠퍼스 묶음 유지) |
| 비정상 | oneway | NULL | false | (Zod refine 단계에서 reject) |

**핵심 가정**: 토요일은 9대 모두 운행. 따라서 하행은 좌석 부족이 발생할 일이 거의 없다. 만약 발생 시 운영자 alert.

---

## 6. 미배정 경고

`BatchResult.errors[]` 에 캠퍼스·인원·사유 기록:

```
"미배정: TUE 캠퍼스 전남대 (UUID) 8명 (좌석 부족, hard_cap 도달)"
"고정 배정 요일 불일치: 김철수 (TUE → bus 수요일1호차)"
"하행편도 미배정: 캠퍼스 조선대 5명"
```

**UI 표시 (`/admin/batch` 결과 페이지):**
- 빨강 배경 + 경고 아이콘
- 미배정 인원 명단 (이름·캠퍼스·학번)
- "추가 호차 검토 권유" 안내문
- 마스터에게 슬랙 알림 (옵션)

---

## 7. 재실행 모드 (Phase 2)

**현재 v1**: 항상 전체 최적화. 재실행 시 기존 배정 무시하고 처음부터 계산.

**고려한 대안 (v2 검토):**
- 안정 모드: 이미 배정된 사람은 이동 금지 → 변동 최소화 → 신뢰 향상
- delta 모드: 신규 신청자만 빈 좌석에 채워넣기 (간단·빠름)

**자동 재배차 X**: 신청 변경 시마다 자동 재실행 X. 마스터가 `/admin/batch` 페이지에서 수동 트리거. 이유: 운영 신뢰성 + 변동 폭주 방지.

---

## 8. v2 검토 항목

1. **안정 모드** — 배정된 사람 이동 금지 옵션 (UI toggle)
2. **역할 기반 자동 그루핑** — `roles[]` 에 '채플담당', '연단' 등 라벨로 호차 자동 배정
3. **캠퍼스 분할 최소화 메트릭** — 분할 횟수를 결과에 기록, 운영자 회고
4. **diff view** — 재실행 시 이동 인원 표시 (붉은색 화살표)

---

## 9. 테스트 시나리오 (10개)

| # | 시나리오 | 입력 | 기대 |
|---|---|---|---|
| 1 | 단순 | 40명, 캠퍼스 1개, TUE | 1호차 단독 배정, 미배정 0 |
| 2 | 만석 | 308명 화요일 가득 (캠퍼스 다양) | 4호차 가득(44×4=176... 즉 4호차로는 불충분), 일부 미배정 발생 → 운영자 alert |
| 3 | 좌석 부족 | 350명 화요일 (capacity 한계 초과) | hard_cap 45 적용 후도 미배정 약 170명 → 빨강 경고 |
| 4 | 큰 캠퍼스 분할 | 전남대 50명 + 다른 캠퍼스 작은 그룹 | 전남대가 2호차에 분산 배치 + 작은 캠퍼스 통째 |
| 5 | 차량순장 고정 | bus[0].driver = 김철수 | 김철수 절대 다른 호차 X (재실행 후도) |
| 6 | fixed_passenger_ids | bus[0].fixed = [채플담당 5명] | 5명 모두 0호차, capacity 39 잔여 |
| 7 | 하행편도 단독 | departure_day=NULL, uses_return_bus=true, 10명 | up_bus_id NULL, down_bus_id 캠퍼스 묶음 배정 |
| 8 | 완참 only | 모두 roundtrip | down = up 단순 매핑 |
| 9 | 편도 상행 | oneway + TUE | up 정상, down NULL |
| 10 | 빈 입력 | 0명 | errors 비어있음, byBusCount 빈 객체, success |

**테스트 위치**: `src/lib/batch/__tests__/runBatch.test.ts` (Vitest)

---

## 10. 참고

- mini Python 원본 (폐기됨).
- DB schema: [[data_schemas]]
- 검증 규칙: [[validators]]
- 운영 매뉴얼: [[../docs/operations]]

## Related Notes
- [[data_schemas]] - registrations / buses / batch_runs 컬럼 정의
- [[validators]] - 입력 검증 규칙 (배차 전 단계)
- [[../README]] - carbus-web 프로젝트 개요
