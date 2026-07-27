# 로컬 마이그레이션 검증

운영 백업을 로컬 Supabase 에 올려놓고 마이그레이션을 돌려, **기존 동작이 안 깨지는지**
전후 스냅샷으로 대조한다. 스키마를 건드리는 단계(Phase 1~4)마다 이 절차를 밟는다.

## 절차

```bash
supabase start

# 1) 새 마이그레이션을 잠시 빼고 "적용 전" 상태를 만든다
mkdir -p /tmp/hold && mv supabase/migrations/<새파일>.sql /tmp/hold/
supabase db reset --no-seed
python3 scripts/local-verify/load-backup.py      # 운영 백업 적재 (최신 자동 선택)
bash    scripts/local-verify/post-load.sh        # 데이터 의존 backfill 일괄 + 기준선 출력
bash    scripts/local-verify/snapshot.sh > /tmp/before.txt

# 2) 마이그레이션을 되돌려놓고 적용
mv /tmp/hold/*.sql supabase/migrations/
for f in supabase/migrations/<새파일>.sql; do
  docker exec -i supabase_db_carbus-web psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < "$f"
done

# 3) 대조 — 의도한 변경만 있어야 한다
bash scripts/local-verify/snapshot.sh > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt

# 4) 기능 테스트
bash scripts/local-verify/test-event-switch.sh
```

## 이 방식으로 실제로 잡은 것

- 감사 트리거가 backfill 에 반응해 유령 이력 599건을 쌓던 문제 (18,967 → 19,566)
- `v_payment_summary` 재작성 중 `self` 제외 조건을 빠뜨려 납부 집계가 60건 부풀던 문제
- `buses.name` UNIQUE 를 행사 범위로 안 바꿔 차량 복제가 통째로 막히던 문제
- `departure_slots.id` 가 GENERATED ALWAYS 라 직접 삽입이 불가능한 문제

## post-load.sh 가 필요한 이유

`supabase db reset` 은 마이그레이션을 **빈 DB 에** 먼저 적용한다. 그래서 데이터에 의존하는
backfill(예: Phase 1 의 `home_unit_id` 매칭)은 0건을 처리하고 끝난다. 그 뒤 백업을 적재하면
backfill 결과만 빠진 상태가 되어 로컬이 운영과 달라진다.

→ 적재 직후 `post-load.sh` 를 한 번 돌려 맞춘다. 이 스크립트는 두 가지를 이어서 실행한다:
1. `post-load.sql` — 컬럼 backfill (`home_unit_id`)
2. `MIGRATIONS` 배열의 마이그레이션 재실행 — 지금은 Phase 2-A 장부 이관

**새 Phase 에서 데이터 의존 backfill 을 추가하면 `post-load.sh` 에도 넣어야 한다.**
이 규칙은 Phase 2-A 에서 한 번 지켜지지 않았고, 그 결과 로컬 장부가 0건이라
기준선(장부 1,081 · 차액 46명)이 재현되지 않았다.

## 백업 커버리지 (중요)

`backup-prod.mjs` 의 `TABLES` 는 하드코딩이다. **새 테이블을 만들면 반드시 여기에 추가**해야
한다. 실제로 Phase 1·2-A 가 만든 `events`·`org_units`·`payment_ledger` 가 누락된 채
백업이 5번 떠졌고, 그 백업들로는 복구도 로컬 재현도 되지 않는다
(`registrations.event_id` 가 존재하지 않는 행사를 가리켜 RLS·뷰가 전부 0행을 낸다).

`load-backup.py` 가 적재 전에 DB 테이블 목록과 대조해 누락을 잡아준다 — 조용히 넘어가지 않고
크게 실패한다. 이 가드가 실패하면 **백업을 다시 뜨는 것이 정답**이다.

## 주의

- **`test-event-switch.sh` 는 두 번째 행사를 만들고 커밋한다.** 돌리고 나면 로컬에
  행사가 2개(버스 22대·신청 600건)가 된다. 앱은 RLS 로 활성 행사만 보므로 화면은 멀쩡하지만,
  `event_id` 필터 없이 직접 SELECT 하는 도구는 지난 행사까지 빨아들인다.
  실제로 `make-batch-fixture.mjs` 가 이것 때문에 오염될 뻔했다(지금은 활성 행사로 좁혀 둠).
  기준선을 다시 맞추려면 `supabase db reset --no-seed` 부터 다시 한다.
- `load-backup.py` 는 **로컬 전용**이다. 운영 실명이 로컬 DB 에 올라가므로 커밋·외부 전송 금지.
- 백업 경로는 자동으로 `~/Backups/carbus-web/` 의 **최신 디렉터리**를 고른다.
  다른 백업을 쓰려면 인자로 경로를 준다: `python3 ... load-backup.py ~/Backups/carbus-web/<이름>`
- 로더는 **백업 JSON 에 실제로 있는 컬럼만** INSERT 한다. 백업 이후 추가된 컬럼을 목록에
  넣으면 NULL 이 명시적으로 들어가 컬럼 DEFAULT 가 무력화되고 NOT NULL 위반이 난다.

## 배차 골든 스냅샷

`make-batch-fixture.mjs` 가 로컬 DB(운영 복제)에서 배차 입력을 뽑아 **익명화**해
`tests/fixtures/batch-prod-shape.json` 으로 저장한다. `tests/unit/batch-golden.test.ts` 가
그 입력의 현재 배차 결과를 고정한다.

왜 필요한가: 기존 단위 테스트 33개 중 `"1호차"` 특례를 실제로 붙잡는 건 2개뿐이고,
**하행 방향 응집 면제(engine.ts:315)는 테스트가 0개**였다. 특례를 통째로 지워도 31개가 통과했다.
골든 스냅샷은 상·하행 양쪽 특례 제거를 모두 잡아낸다(변이 테스트로 확인).

fixture 재생성: `node scripts/local-verify/make-batch-fixture.mjs` (로컬에 백업이 적재된 상태에서)
