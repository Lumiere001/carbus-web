# 로컬 마이그레이션 검증

운영 백업을 로컬 Supabase 에 올려놓고 마이그레이션을 돌려, **기존 동작이 안 깨지는지**
전후 스냅샷으로 대조한다. 스키마를 건드리는 단계(Phase 1~4)마다 이 절차를 밟는다.

## 절차

```bash
supabase start

# 1) 새 마이그레이션을 잠시 빼고 "적용 전" 상태를 만든다
mkdir -p /tmp/hold && mv supabase/migrations/<새파일>.sql /tmp/hold/
supabase db reset --no-seed
python3 scripts/local-verify/load-backup.py      # 운영 백업 적재
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

## 주의

- `load-backup.py` 는 **로컬 전용**이다. 운영 실명이 로컬 DB 에 올라가므로 커밋·외부 전송 금지.
- 백업 경로는 스크립트 상단 `BACKUP` 상수. 새 백업을 뜨면 그 경로로 바꾼다.
