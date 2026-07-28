#!/usr/bin/env bash
# ============================================================
# 정합성 전수 점검 (HANDOFF §26-D)
# ============================================================
# "같은 사실이 두 곳에 적혀 있는" 쌍마다 어긋난 행 수를 센다.
# 고치기 **전에** 한 번 돌려 규모를 기록하고, 고친 **뒤에** 0 이 되는지로 검증한다.
#
# 사용법:
#   bash scripts/local-verify/check-consistency.sh          # 로컬
#
# 종료 코드: 어긋난 쌍이 하나라도 있으면 1.
# ============================================================
set -euo pipefail

CONTAINER="${CARBUS_DB_CONTAINER:-supabase_db_carbus-web}"
SQL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-consistency.sql"

OUT="$(docker exec -i "$CONTAINER" psql -U postgres -d postgres \
        -v ON_ERROR_STOP=1 -q < "$SQL_FILE")"
echo "$OUT"

if echo "$OUT" | grep -q '어긋나 있습니다'; then
  exit 1
fi
