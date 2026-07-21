# carbus-web 개선 작업 — 인수인계

> **다음 세션은 이 문서부터 읽으세요.** 마지막 갱신 2026-07-21. 다음 작업은 **Phase 3**.

---

## 1. 지금 어디까지 왔나

여름수련회(6/23~27) 운영 후 받은 피드백 9건을 6단계로 나눠 고치는 중입니다.
**0~2단계는 끝났고 운영에 반영돼 있습니다.**

| 단계 | 내용 | 상태 | PR |
|---|---|---|---|
| 0 | 거짓말 제거 (관측 교정) | ✅ 배포됨 | [#8](https://github.com/Lumiere001/carbus-web/pull/8) |
| 1 | 행사(event) 골격 + 비파괴 초기화 | ✅ 배포됨 | [#9](https://github.com/Lumiere001/carbus-web/pull/9) |
| — | 정산 경로 행사범위 복구 (Phase 1 회귀 핫픽스) | ✅ 배포됨 | [#10](https://github.com/Lumiere001/carbus-web/pull/10) |
| 2-A | 결제 장부 + 환불 차액 추적 | ✅ 배포됨 | [#11](https://github.com/Lumiere001/carbus-web/pull/11) |
| — | 행사별 차량비 설정 + 용어 '원장'→'장부' | ✅ 배포됨 | [#12](https://github.com/Lumiere001/carbus-web/pull/12) |
| 2-B | 취소 상태 + 좌석 자동 반납 | ✅ 배포됨 | [#13](https://github.com/Lumiere001/carbus-web/pull/13) |
| 3-A | 배차 특례 플래그화 + 운행편 모델(event_trips) | 🟡 로컬만 (미배포) | 브랜치 `phase3-trips` |
| **3-B** | **/admin/trips·/admin/buses 편성 편집 UI** | **다음** | — |
| 3-C | 신청 대칭화 (registrations.up/down_trip_id + 폼) | 대기 | — |
| 4 | 비고 구조화 본체 (transport_legs) | 대기 | — |
| 5 | 화면 응집 (목업 반영) | 대기 | — |

**피드백 ↔ 단계 매핑**

| 사용자 피드백 | 해소 단계 |
|---|---|
| 상/하행 버스·출발시각 자유 선택 | **Phase 3** |
| 초기화 버튼 | Phase 1 ✅ |
| 전체 순장/순원 편집 UX (최상단 폼) | Phase 5 |
| 비고 구조화 (타지구·KTX 확정상태) | Phase 4 |
| 출석 호차별 네비게이션 | Phase 5 |
| 부분참 정보 산발 | Phase 5 |
| 로그 50건 제한 | Phase 5 |
| 변경 이력 추적 | Phase 5 |
| 캠퍼스 송금 등록 안 함 | Phase 2-A 일부 ✅ (넛지 UI는 Phase 5) |

---

## 1-A. ⚠️ 먼저 알아야 할 것 (2026-07-21 추가)

**`.env.local` 은 운영 DB 를 가리킨다** (`qqtqwyhclscfjlefkiqr.supabase.co`).
`pnpm dev` 를 그냥 띄우면 **로컬 화면이 운영 데이터에 붙는다.** 로컬 스키마로 검증하려면
`.env.local` 을 `supabase status` 의 로컬 URL·키로 바꾸고 띄워야 한다.
지금 브랜치의 코드는 `buses.up_trip_id` 를 조회하는데 운영은 아직 `departure_slot_id` 라,
바꾸지 않고 띄우면 /admin 화면이 전부 깨진다.

**브랜치 `phase3-trips` 는 아직 운영에 반영되지 않았다.** 커밋 5개가 로컬 검증만 끝난 상태다.
반영 순서는 §3 "운영 반영" 참고 — 이 브랜치는 **DB 와 코드를 함께** 올려야 한다
(컬럼 rename 이라 한쪽만 올리면 깨진다). 다행히 행사 사이 정지 구간이라 트래픽이 없다.

## 2. 다음 작업 — Phase 3

**목표:** 지금 하행은 `uses_return_bus` 불린 하나뿐이라 **출발 시각 개념 자체가 없습니다.**
상행처럼 운행편(trip)으로 승격해 상·하행 모두 시각·차량을 자유롭게 짜게 합니다.

### 3-A ✅ 끝남 (로컬 검증 완료, 미배포 — 브랜치 `phase3-trips`)

1. **배차 특례 플래그화** — `buses.is_cohesion_exempt` / `fill_priority` / `display_order`.
   엔진이 `"1호차"` 문자열 대신 이 컬럼을 본다. 배차 결과는 비트 단위로 동일.
2. **`departure_slots` → `event_trips`** (rename) + `direction`(up/down)·`departs_at`·
   `origin`·`destination`. `buses.departure_slot_id` → `up_trip_id`(nullable) + `down_trip_id`.
   행사마다 하행 편 1건 생성 + 전 차량 연결.
3. **골든 스냅샷** `tests/unit/batch-golden.test.ts` — 운영 599명 형상을 익명화해 고정.
   기존 33개 테스트로는 특례를 통째로 지워도 31개가 통과했다(하행 응집 면제는 테스트 0개).

### 3-B ⬅ 다음 — 편성 편집 UI

- **`/admin/trips` CRUD** — 운행편 생성·수정·삭제. 참고할 기존 UI 선례가 **0곳**이다
  (`departure_slots` 쓰기 경로가 코드에 아예 없었다). `lib/admin/trips.ts` 신설 필요.
- **`/admin/buses` 차량 설정** — 라우트는 이미 있지만 차량 생성·정원·시각·플래그 UI 가 없다.
  지금 있는 건 차량순장/고정탑승 지정뿐. 확장 대상이지 재사용 대상이 아니다.
- ⚠️ **차량 삭제 UI 를 붙일 때 가드 필수.** `registrations.assigned_*_bus_id` FK 가
  `ON DELETE SET NULL` 이라, 차량을 지우면 승객 배정이 **조용히** 사라진다.
- `components/admin/buses-panel.tsx` 는 이미 상/하행 탭이 있고 상행만 편별 섹션을 만든다.
  하행도 같은 `activeTrips.filter(direction==='down')` 구조로 통일하면, 하행이 2편으로
  갈리는 순간 코드 변경 없이 섹션이 나뉜다 — "용어만 하행으로 바뀔 뿐"이 구현되는 지점.

### 3-C 대기 — 신청 대칭화

- `registrations.up_trip_id` / `down_trip_id` + CHECK **3개**(`chk_roundtrip`·`chk_oneway`·
  **`chk_self`**) 재작성. 원안이 chk_self 를 빠뜨렸다.
- ⚠️ `NOT VALID` 로 걸어도 **신규 INSERT 는 즉시 검사된다.** "DB 먼저 → 코드 나중" 순서와
  겹치면 그 구간 동안 신규 신청이 전부 막힌다. 컬럼 추가·backfill → 앱 배포 → CHECK 순서로.
- **`attendance_type` 은 입력이 아니라 파생값이 된다** (up/down 조합으로 완전히 결정됨).
  `lib/labels.ts` 의 `AttendancePreset` 개념 자체를 폐기할 수 있다. 실제 편집 UI 는
  `registration-grid.tsx` 와 `reg-form.tsx` **2곳뿐**이고 나머지는 표시용이다.
- 두 개의 독립 select 로 쪼개되 **DB write 는 한 번으로 묶어야 한다** — 낙관적 잠금이
  `version` 을 쓰므로 따로 보내면 충돌이 두 번 뜨고 중간 상태가 저장된다.
- CSV `"하행 차량 이용"` 헤더가 O/X 불린이다. 하위호환 규칙 필요(O → 그 행사의 단일 하행편).
- ⚠️ `trg_reg_00_fare` 가 `attendance_type` 을 읽어 요금을 계산한다. 파생 트리거는
  `trg_reg_audit` 앞이 아니라 **`trg_reg_00_fare` 앞**에 서야 한다(이름을 `trg_reg_00a_*` 류로).
  HANDOFF 가 예전에 안내한 `trg_reg_02_*` 를 따르면 요금이 한 세대 늦게 계산된다.

---

## 3. 재개 방법

### 로컬 환경 띄우기

```bash
open -a Docker && sleep 30          # Docker Desktop (필수)
cd ~/Projects/carbus-web
supabase start                       # 로컬 스택
supabase db reset --no-seed          # 마이그레이션 전량 적용
python3 scripts/local-verify/load-backup.py    # 운영 백업 적재 (최신 백업 자동 선택)
bash scripts/local-verify/post-load.sh         # 데이터 의존 backfill 일괄 + 기준선 출력
```

적재 후 아래와 일치해야 운영과 동일한 상태입니다 (post-load.sh 가 직접 찍어줍니다):

```
신청 599 · 감사로그 18,967 · 소속(home_unit_id) 65 · 장부 1,081 · 차액 46명
배차 상행 454 / 하행 459
```

> `load-backup.py` 는 `~/Backups/carbus-web/` 에서 **가장 최근 백업을 자동 선택**합니다
> (인자로 경로를 주면 그걸 씁니다). 상수로 박아두면 Phase 마다 낡습니다.
> ⚠️ 로컬 DB에 실명이 올라갑니다. 커밋·외부 전송 금지.

> ⚠️ **2026-07-21_0843-pre-phase2b 이전 백업은 못 씁니다.** `events`·`org_units`·
> `payment_ledger` 가 백업 대상에서 빠져 있어서, 적재하면 `registrations.event_id` 가
> 존재하지 않는 행사를 가리킵니다. 적재는 replica 모드(FK 끔)라 성공한 척하지만
> RLS·뷰를 통과하면 599행이 전부 0으로 보입니다. 지금은 `load-backup.py` 가
> 착수 전에 이 누락을 검사해 크게 실패시킵니다. 쓸 수 있는 최초의 완전한 백업은
> `2026-07-21_0924-pre-phase3` 입니다.

### 스키마 변경 작업 절차 (반드시 지킬 것)

```bash
# 1) 새 마이그레이션을 잠시 빼고 "적용 전" 기준선을 찍는다
mkdir -p /tmp/hold && mv supabase/migrations/<새파일>.sql /tmp/hold/
supabase db reset --no-seed && python3 scripts/local-verify/load-backup.py
docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -q < scripts/local-verify/post-load.sql
bash scripts/local-verify/snapshot.sh > /tmp/before.txt

# 2) 되돌려놓고 적용
mv /tmp/hold/*.sql supabase/migrations/
docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/<새파일>.sql

# 3) 대조 — 의도한 변경만 나와야 한다
bash scripts/local-verify/snapshot.sh > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt

# 4) 기능 테스트
bash scripts/local-verify/test-event-switch.sh   # 행사 전환
bash scripts/local-verify/test-ledger.sh         # 장부·청구액 동결
bash scripts/local-verify/test-cancel.sh         # 취소·좌석 반납

# 5) 코드 검증
pnpm tsc --noEmit && pnpm vitest run && pnpm eslint app components lib && pnpm build
```

### 운영 반영

```bash
node scripts/local-verify/backup-prod.mjs ~/Backups/carbus-web/$(date +%Y-%m-%d_%H%M)-pre-phaseN  # 백업 먼저
supabase db push          # link 되어 있음 (project ref qqtqwyhclscfjlefkiqr)
```

> `supabase db push`는 **DB 비밀번호가 필요한 link가 이미 되어 있어서** 그냥 됩니다.
> link가 풀리면 `supabase link --project-ref qqtqwyhclscfjlefkiqr`를 **사용자가 직접** 실행해야
> 합니다(비밀번호 입력 필요).
>
> ⚠️ CI는 마이그레이션을 적용하지 않습니다. **DB 먼저 적용 → 확인 → PR 머지** 순서를 지키세요.
> 코드만 먼저 배포되면 없는 테이블을 조회해 화면이 깨집니다.
>
> ⚠️ **브랜치 `phase3-trips` 는 예외입니다.** 컬럼 rename(`buses.departure_slot_id`
> → `up_trip_id`)이 들어 있어 **어느 쪽을 먼저 올려도 반대쪽이 깨집니다.**
> DB 적용과 코드 배포를 연달아 해야 합니다. 지금은 행사 사이 정지 구간이라
> (여름수련회 6/27 종료, `batch_enabled=false`) 실사용 트래픽이 없어 안전합니다.
> 다음 행사 신청이 열린 뒤에는 이 방법을 쓰면 안 됩니다.

---

## 4. 반드시 지켜야 할 규칙 (실제로 사고를 막은 것들)

1. **backfill 중에는 사용자 트리거를 끈다.**
   `registrations`를 UPDATE 하면 감사 트리거가 599건의 "아무도 안 바꾼" 이력을 쌓는다.
   실제로 Phase 1에서 18,967 → 19,566으로 늘었다가 잡았다.

2. **뷰를 재작성할 때 원본 정의를 먼저 덤프해서 조건을 확인한다.**
   `v_payment_summary`에 `self` 제외 조건이 있었는데 빠뜨려 납부 집계가 60건 부풀었다.

3. **UNIQUE는 제약(`pg_constraint`)뿐 아니라 인덱스(`pg_indexes`)도 확인한다.**
   `buses.name` UNIQUE를 놓쳐 차량 복제가 통째로 막혔다.
   `snapshot.sh`에 인덱스 검사를 넣어뒀다.

4. **비고 텍스트로 자동 판정하지 않는다.**
   - `"환불해야 할 것은 없음"`이 '환불' 부분문자열에 걸린다(상계 건)
   - `"취소함 → 취소 이후 순수 하행 확정"`은 실제로는 참석자다
   - 반대로 아무 말 없이 차액이 생긴 28명은 놓친다
   **금액은 금액으로, 상태는 상태 필드로.**

5. **BEFORE 트리거는 이름 알파벳순으로 실행된다.**
   `registrations` 의 BEFORE 트리거는 4개가 아니라 **9개**다 (실측):
   `trg_cleanup_bus_fixed_on_reg_delete` → `trg_guard_attendance` → `trg_reg_00_fare`
   → `trg_reg_01_cancel` → `trg_reg_audit` → `trg_reg_block_delete`
   → `trg_reg_guard_assignment` → `trg_reg_guard_roles` → `trg_reg_updated_at`
   감사에 남겨야 할 변경은 `trg_reg_audit`보다 **먼저** 돌아야 한다.
   → 새 트리거는 `trg_reg_02_*` 처럼 지어야 앞에 선다. `trg_trip_*` 로 지으면
   `trg_reg_audit` 뒤로 밀려 **변경이 조용히 감사 누락**된다.
   (`snapshot.sh` 의 "### 트리거" 섹션이 현재 순서를 항상 찍어준다)

6. ~~**GENERATED 컬럼은 BEFORE 트리거에서 `NEW`가 항상 NULL이다.**~~ — **더는 사실이 아니다.**
   Phase 2-A 가 `fee` 의 생성식을 해제해서 지금은 평범한 nullable int 다
   (`is_generated=NEVER`, public 스키마에 생성컬럼 0개). 지금은 `trg_reg_00_fare`
   (BEFORE, 알파벳상 `trg_reg_audit` 앞)가 `NEW.fee` 를 채우므로 **Phase 2-A 이후
   새로 쌓이는 감사행은 `after_value.fee` 에 실값이 들어간다.**
   ⚠️ "after_value.fee 는 NULL" 을 전제로 쿼리를 짜면 옛 행과 새 행이 뒤섞여 틀린다.
   과거 46명을 복원할 때 쓴 성질이라 기록으로만 남긴다.

7. **`v_payment_summary` 를 CASCADE 로 날리지 마라.**
   원래는 "생성컬럼 해제는 `DROP EXPRESSION` 으로" 라는 규칙이었다(§6 참고).
   일반화하면: `registrations` 의 컬럼을 `DROP COLUMN` 하면 CASCADE 로
   `v_payment_summary` 가 함께 삭제돼 납부 화면이 즉시 죽는다.

8. **신규 테이블은 `event_id` + RESTRICTIVE 정책을 갖고 태어나야 한다.**
   안 걸면 다음 행사에서 지난 행사 데이터가 샌다.

---

## 5. 열린 항목

### 🔴 사용자 확인 필요

- **차액 46명 / 1,350,000원** — `/admin/payments`의 "차액 확인 필요" 섹션.
  낸 돈이 현재 청구액보다 많은 사람들. **확정 채무가 아니라 계산상 차액**이다
  (현장에서 이미 현금 정산했을 수 있음). 17명은 비고에 환불 언급이 있고,
  **28명은 아무 언급이 없어 아무도 모르고 있었다.**
  → 정산 완료 / 아직 안 드림을 구분해 주시면 환불 기록 남기는 기능을 붙일 수 있다.

- **취소 처리가 안 된 기존 데이터** — 비고에 "취소"라 적힌 사람 중 일부는 아직
  `participation_status='registered'`다. 자동 판정은 위험해서 안 했다.
  화면에서 직접 취소 처리해야 좌석이 반납된다. 현재 취소자 0명.

### 🟡 결정 대기

- 다음 행사(리더십 캠프)에 **하행이 여러 편으로 나뉘는지** → Phase 3 우선순위 좌우
- 캠퍼스 송금 등록 넛지 UI (총단 기록 1클릭 승인) — Phase 2-A에서 백엔드는 준비됐고
  화면은 Phase 5로 미뤄둔 상태

### 참고

- **리더십 캠프 전환은 Phase 3 이후에** 하는 게 안전합니다. `/admin/control`의
  "새 행사 시작"을 누르면 화면이 비워지지만, 지금 눌러도 되돌릴 수 있습니다
  (지난 행사 데이터는 삭제되지 않음).

---

## 6. 참조

- 코드: `~/Projects/carbus-web` · 운영: https://carbus-web.vercel.app
- Supabase: `qqtqwyhclscfjlefkiqr` (Northeast Asia)
- 백업: `~/Backups/carbus-web/` (PII 포함 — 로컬 전용)
- 검증 도구: `scripts/local-verify/` (README 참고)
- 개선안 목업: 이 작업 초기에 만든 아티팩트 (화면 7개 + 6단계 계획)

### 이 작업에서 나온 주요 발견

| 발견 | 실측 |
|---|---|
| 비고 사용률 | 599명 중 226명(37.7%) |
| 비고에서 "타지구"의 두 가지 뜻 | 소속 63건 / 이용수단 80건 (**정반대 의미**) |
| 감사로그 유령 이력 | 18,967건 중 73%가 실변경 없음 |
| 출석률이 100%에 못 닿던 이유 | 분모가 신청 기준(376)인데 분자는 배차 기준(372) |
| 환불 차액 | 46명 / 1,350,000원 (그중 28명은 아무 기록 없었음) |
| 하드 삭제로 사라진 수납 기록 | 10건 / 225,000원 |
