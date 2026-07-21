# carbus-web 개선 작업 — 인수인계

> **다음 세션은 이 문서부터 읽으세요.** 마지막 갱신 2026-07-21.

---

## 0. 다음 세션 시작점 — 30초 요약

**Phase 3 를 전부 만들었습니다. 아직 운영에는 안 올렸습니다.**

- 브랜치 `phase3-trips` 에 커밋 13개. `master` 는 손대지 않았습니다.
- 로컬에서 129개 테스트·빌드·기능 테스트 전부 통과, 운영 백업 재현도 기준선 일치.
- **push 도 안 했습니다** — 이 레포는 push·배포를 사용자가 직접 합니다.

### 무엇이 달라졌나 (한 문장)

행사마다 **버스 편성을 화면에서 짤 수 있게** 됐고, **가는 편과 오는 편이 완전히 같은 구조**가
됐습니다. 그래서 다음 행사에서 "귀가 버스를 오후 3시·6시 두 편으로 나눈다" 같은 게
개발 없이 됩니다.

### 다음 세션에서 할 일 (순서대로)

1. **§0-A 의 결정 3가지**를 사용자와 정한다. 그게 안 정해지면 배포 순서가 안 잡힌다.
2. 3-C 적대적 검증을 한 번 돌린다 (3-A·3-B 는 이미 거쳤고 3-C 만 못 거쳤다).
3. 백업 → `supabase db push` → 코드 배포 → 화면 확인. **DB 와 코드를 연달아** 올려야 한다(§3).

---

## 0-A. 사용자에게 물어야 할 결정 3가지

### ① 납부한 사람의 편성을 바꾸면 환불은 어떻게 하나 ⚠️ 가장 중요

**무슨 일인가:** 어떤 학우가 왕복 5만원을 이미 냈는데, 나중에 "안 갈래요" 해서
편성을 비웠다고 하자. 시스템은 이 사람 청구액을 **5만원 그대로 둔다.** 그리고
정산 화면의 "차액 확인 필요" 목록에도 **안 나온다.** 즉 5만원을 돌려줘야 하는데
아무도 모른다.

**왜 그런가:** Phase 2-A 에서 "낸 순간의 금액을 얼려둔다"고 정했기 때문이다.
그때는 편성을 바꿀 일이 드물어서 문제가 안 됐는데, 이번에 가는 편·오는 편을
따로 끄고 켤 수 있게 되면서 훨씬 자주 생기게 됐다.

**지금 해둔 것:** 편성을 바꿀 때 화면에 경고만 띄운다.

**사용자가 정할 것:** 자동으로 환불 기록을 남길지, 아니면 지금처럼 사람이 보고
판단할지. 이건 §5 의 "차액 46명 / 135만원" 과 같은 성격의 문제다 — 현장에서
현금으로 이미 정산했는지는 사용자만 알기 때문이다.

### ② 운영에 언제 올릴까

**무슨 일인가:** 이번 변경은 DB 와 코드를 **동시에** 올려야 한다. 한쪽만 올리면
관리자 화면이 전부 깨진다(컬럼 이름이 바뀌어서).

**지금 왜 괜찮나:** 여름수련회가 6/27 에 끝났고 다음 행사 신청이 아직 안 열려서
쓰는 사람이 없다. 그래서 잠깐 창이 생겨도 아무도 안 겪는다.

**사용자가 정할 것:** 지금 올릴지, 리더십 캠프 준비를 시작하기 직전에 올릴지.
**다음 행사 신청이 열린 뒤에는 이 방법을 쓰면 안 된다.**

### ③ 리더십 캠프 편성을 언제 짤까

**무슨 일인가:** 편성 화면은 **활성 행사만** 만질 수 있다. 즉 리더십 캠프 편성을
짜려면 먼저 "새 행사 시작"을 눌러 활성 행사를 바꿔야 하고, 그러면 여름수련회
화면이 비워진다(데이터는 남고 되돌릴 수 있다).

**사용자가 정할 것:** 여름수련회 정산·환불이 다 끝난 뒤에 전환할지, 아니면
전환해두고 정산은 지난 행사로 되돌려가며 할지.

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
| 3-B | 편성 편집 UI (/admin/trips) | 🟡 로컬만 (미배포) | 〃 |
| 3-C | 신청 대칭화 (up/down_trip_id + 폼 + 엔진) | 🟡 로컬만 (미배포) | 〃 |
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

## 2. Phase 3 — 무엇을 어떻게 만들었나

**목표(사용자 확정):** "행사에 관계없이 항상 쓸 수 있는 **범용 틀**". 하행은 상행과 완전 대칭 —
"용어만 하행으로 바뀔 뿐". 여름수련회 기존 데이터는 그대로 두고 재배차하지 않는다.

### 3-A ✅ 끝남 (로컬 검증 완료, 미배포 — 브랜치 `phase3-trips`)

1. **배차 특례 플래그화** — `buses.is_cohesion_exempt` / `fill_priority` / `display_order`.
   엔진이 `"1호차"` 문자열 대신 이 컬럼을 본다. 배차 결과는 비트 단위로 동일.
2. **`departure_slots` → `event_trips`** (rename) + `direction`(up/down)·`departs_at`·
   `origin`·`destination`. `buses.departure_slot_id` → `up_trip_id`(nullable) + `down_trip_id`.
   행사마다 하행 편 1건 생성 + 전 차량 연결.
3. **골든 스냅샷** `tests/unit/batch-golden.test.ts` — 운영 599명 형상을 익명화해 고정.
   기존 33개 테스트로는 특례를 통째로 지워도 31개가 통과했다(하행 응집 면제는 테스트 0개).

### 3-B ✅ 편성 편집 UI

`/admin/trips` — 운행편·차량을 화면에서 만들고 고친다. 상·하행이 같은 컴포넌트라
하행을 여러 편으로 나눠도 코드 변경 없이 섹션이 나뉜다.
파괴적 조작은 **DB 트리거**가 막는다(화면 검사는 우회 가능해서). 차량 삭제·운행편 삭제·
방향 교차 지정·신청 편과 어긋나는 편 변경·마지막 활성 편 비활성화.

### 3-C ✅ 신청 대칭화

`registrations.up_trip_id / down_trip_id`. `attendance_type` 은 **파생값**이 됐다
(실측: 기존 599건과 100% 일치). 신청 폼은 조합 셀 대신 상행·하행 두 개의 독립 선택.
엔진도 하행을 상행과 같은 편별 그룹 배차로 바꿨다 — 골든 스냅샷 기대값 불변.

**양방향 파생 트리거**(`trg_reg_000_derive`)가 옛 컬럼과 새 컬럼을 서로 채운다.
덕분에 DB 를 먼저 올려도 구버전 앱이 돌고, 배포 뒤에도 앱만 되돌리는 롤백이 가능하다.

⚠️ 이 트리거는 **ENABLE ALWAYS** 여야 한다. 백업 적재가 `session_replication_role=replica`
로 트리거를 끄는데, 이건 업무 로직이 아니라 파생 컬럼을 채우는 구조 유지 장치라
꺼지면 CHECK 위반으로 적재가 통째로 실패한다. 그리고 **`enable trigger user` 를 쓰는
블록이 지나갈 때마다 조용히 ORIGIN 으로 내려간다** — post-load.sh 가 매번 검사한다.

### 남은 것 (3-C 이후)

- **옛 컬럼 제거** — `departure_slot_id` / `uses_return_bus` 는 아직 살아 있다(파생 트리거가
  동기화). 운영이 안정된 뒤 별도로 지운다. 지우는 순간 앱 롤백 경로가 사라지므로 서두르지 말 것.
- **납부 후 편성 변경 → 환불** ⚠️ 사용자 결정 필요.
  실측: 왕복 5만원을 낸 사람의 편을 다 비워도 `fee` 는 50000 으로 **동결**되고
  장부 차액에도 안 잡힌다(Phase 2-A 가 청구액을 납부 시점에 동결하는 설계).
  3-C 로 편을 개별로 끄고 켜기 쉬워졌으니 이 상황이 훨씬 자주 생긴다.
  지금은 **편집 화면에서 경고만** 띄운다. 자동 환불 기록을 남길지는
  §5 의 "차액 46명" 항목과 함께 결정할 문제다.
- **편별 요금** — 요금은 아직 행사 단위(`events.fee_roundtrip` / `fee_oneway`)다.
  상행과 하행 구간이 다른 행사(예: 광주→무주 / 무주→서울)에서 방향별 요금이 필요해지면
  `event_trips.fare` 로 옮기는 별도 작업이 된다.

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
bash scripts/local-verify/post-load.sh
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
