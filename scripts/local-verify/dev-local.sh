#!/usr/bin/env bash
# ============================================================
# 로컬 Supabase 를 보는 개발 서버 (운영 DB 와 격리)
# ============================================================
# 왜 필요한가:
#   `.env.local` 은 **운영 DB** 를 가리킨다. 그래서 `pnpm dev` 로 띄운 화면에서
#   무언가를 누르면 그건 운영에 쓰는 것이다. 더미 데이터 리허설이나 편성 실험을
#   그렇게 할 수는 없다.
#
#   그리고 §24·§25 가 같은 뿌리에서 두 번 터졌다 — **화면에서만 쓰는 RPC 를 화면
#   없이 검증**해서다. psql 에는 safeupdate 도 `request.headers` 도 없어서 통과했다.
#   화면을 로컬에서 열 수 있어야 그 검증이 가능하다.
#
# 환경변수는 **인라인으로** 준다. `.env.development.local` 같은 파일을 만들면
# 그 뒤로 모든 `pnpm dev` 가 조용히 로컬을 보게 되는데, 그건 반대 방향의 같은
# 함정이다(운영을 보고 있다고 믿는데 아니거나, 그 반대). 이 스크립트로 띄운
# 서버만 로컬을 본다.
#
# 사용법:
#   bash scripts/local-verify/dev-local.sh          # http://localhost:3010
#
# 로그인: /admin/login 에서 아래 LOCAL_ADMIN_PASSWORD.
#   그 계정은 seed-local-auth.sh 가 만든다 (로컬 전용, 운영에 없음).
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# pnpm의 vendor CLI가 실행되지 않는 머신에서는 기존 호스트 CLI를 재사용한다.
SUPABASE_BIN="${SUPABASE_BIN:-$(PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" command -v supabase || true)}"
if [[ ! -x "$SUPABASE_BIN" ]]; then
  echo "실행 가능한 Supabase CLI가 필요합니다." >&2
  exit 1
fi
case "${1:-dev}" in
  db-start) exec "$SUPABASE_BIN" start -x studio,postgres-meta,edge-runtime,logflare,vector,storage-api,imgproxy,mailpit,supavisor ;;
  db-stop) exec "$SUPABASE_BIN" stop ;;
  dev) ;;
  *) echo "지원하지 않는 로컬 실행 명령입니다." >&2; exit 1 ;;
esac

PORT="${PORT:-3010}"
if ! [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$PORT < 1 || 10#$PORT > 65535 )); then
  echo "PORT는 1~65535의 숫자여야 합니다." >&2
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1)' >/dev/null 2>&1; then
  echo "이 컴퓨터에서 실행 가능한 Node.js 20.9 이상이 필요합니다. Node 버전과 PATH를 확인하세요." >&2
  exit 1
fi
for tool in pnpm lsof; do
  command -v "$tool" >/dev/null || { echo "$tool 명령이 필요합니다." >&2; exit 1; }
done
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "포트 ${PORT}가 이미 사용 중입니다. 실행 중인 서버를 확인하거나 다른 PORT를 선택하세요." >&2
  exit 1
fi

# 실행 중인 로컬 스택을 재사용한다. 시작·초기화·마이그레이션은 여기서 하지 않는다.
if ! LOCAL_STATUS="$("$SUPABASE_BIN" status -o env 2>/dev/null)"; then
  echo "로컬 DB를 확인할 수 없습니다. 필요한 경우 pnpm db:local로 켠 뒤 다시 실행하세요." >&2
  exit 1
fi
eval "$(printf '%s\n' "$LOCAL_STATUS" | sed 's/^/LOCAL_/')"
if ! [[ "${LOCAL_API_URL:-}" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+$ ]]; then
  echo "로컬 DB 주소가 아닙니다. 개발 서버 실행을 중단합니다." >&2
  exit 1
fi

export NEXT_PUBLIC_SUPABASE_URL="$LOCAL_API_URL"
export SUPABASE_URL="$LOCAL_API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$LOCAL_ANON_KEY"
export SUPABASE_ANON_KEY="$LOCAL_ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY"

# 로그인 계정 — seed-local-auth.sh 가 만드는 것과 같은 값이어야 한다.
export ADMIN_MASTER_EMAIL="${ADMIN_MASTER_EMAIL:-local-master@carbus.test}"
export ADMIN_VIEWER_EMAIL="${ADMIN_VIEWER_EMAIL:-local-viewer@carbus.test}"

echo "로컬 DB 를 보는 개발 서버: http://127.0.0.1:${PORT}"
echo "  Supabase: ${NEXT_PUBLIC_SUPABASE_URL}"
echo "  로그인:   /admin/login → seed-local-auth.sh 가 정한 비밀번호"
exec pnpm next dev --webpack -p "$PORT" --hostname 127.0.0.1
