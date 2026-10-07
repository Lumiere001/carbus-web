#!/usr/bin/env bash
set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dev-local.sh"
TASK_TMP="$(mktemp -d)"
trap 'rm -rf "$TASK_TMP"' EXIT
mkdir -p "$TASK_TMP/bin"
cat > "$TASK_TMP/bin/lsof" <<'STUB'
#!/usr/bin/env bash
[[ "$DEV_TEST_CASE" == occupied ]]
STUB
cat > "$TASK_TMP/bin/supabase" <<'STUB'
#!/usr/bin/env bash
if [[ "$*" == 'start -x studio,postgres-meta,edge-runtime,logflare,vector,storage-api,imgproxy,mailpit,supavisor' ]]; then
  echo MINIMAL_DB_STARTED; exit 0
elif [[ "$*" == stop ]]; then
  echo LOCAL_DB_STOPPED; exit 0
fi
[[ "$*" == 'status -o env' ]] || exit 99
[[ "$DEV_TEST_CASE" != stopped ]] || exit 1
if [[ "$DEV_TEST_CASE" == remote ]]; then
  echo 'API_URL="https://example.invalid"'
else
  echo 'API_URL="http://127.0.0.1:54321"'
fi
printf '%s\n' 'ANON_KEY="test-only-anon"' 'SERVICE_ROLE_KEY="test-only-service"'
STUB
cat > "$TASK_TMP/bin/pnpm" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == 'next dev --webpack -p 3010 --hostname 127.0.0.1' ]] || exit 98
[[ "$NEXT_PUBLIC_SUPABASE_URL" == http://127.0.0.1:54321 ]] || exit 97
[[ "$SUPABASE_ANON_KEY" == test-only-anon && "$SUPABASE_SERVICE_ROLE_KEY" == test-only-service ]] || exit 96
[[ "$ADMIN_MASTER_EMAIL" == local-master@carbus.test ]] || exit 95
echo APP_STARTED_WITH_LOCAL_ENV
STUB
cat > "$TASK_TMP/bin/node" <<'STUB'
#!/usr/bin/env bash
[[ "$DEV_TEST_CASE" != node-unavailable ]]
STUB
chmod +x "$TASK_TMP/bin/"*
run_case() {
  local scenario="$1" port="$2" expected="$3" needle="$4" result=0
  SUPABASE_BIN="$TASK_TMP/bin/supabase" PATH="$TASK_TMP/bin:$PATH" DEV_TEST_CASE="$scenario" PORT="$port" ADMIN_MASTER_EMAIL=local-master@carbus.test \
    bash "$SCRIPT" > "$TASK_TMP/output" 2>&1 || result=$?
  if [[ "$result" != "$expected" ]] || ! grep -q "$needle" "$TASK_TMP/output"; then
    echo "FAIL: $scenario" >&2
    cat "$TASK_TMP/output" >&2
    exit 1
  fi
  if grep -q 'test-only-' "$TASK_TMP/output"; then echo 'FAIL: secret output' >&2; exit 1; fi
}
run_case invalid abc 1 'PORT'
run_case range 65536 1 'PORT'
run_case occupied 3010 1 '이미 사용'
run_case stopped 3010 1 'pnpm db:local'
run_case remote 3010 1 '로컬 DB 주소'
run_case ready 3010 0 APP_STARTED_WITH_LOCAL_ENV
run_case node-unavailable 3010 1 'Node.js'
SUPABASE_BIN="$TASK_TMP/bin/supabase" bash "$SCRIPT" db-start | grep -q MINIMAL_DB_STARTED
SUPABASE_BIN="$TASK_TMP/bin/supabase" bash "$SCRIPT" db-stop | grep -q LOCAL_DB_STOPPED
echo 'PASS: 로컬 실행 보호·명시적 시작/종료 9가지 (실제 Docker·DB·서버 실행 없음)'
