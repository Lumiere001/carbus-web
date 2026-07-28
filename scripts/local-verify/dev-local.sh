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

PORT="${PORT:-3010}"

# supabase CLI 가 찍어 주는 값을 그대로 쓴다. 상수로 박으면 스택을 다시 만들 때 낡는다.
eval "$(supabase status -o env | sed 's/^/LOCAL_/')"

export NEXT_PUBLIC_SUPABASE_URL="$LOCAL_API_URL"
export SUPABASE_URL="$LOCAL_API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$LOCAL_ANON_KEY"
export SUPABASE_ANON_KEY="$LOCAL_ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SERVICE_ROLE_KEY"

# 로그인 계정 — seed-local-auth.sh 가 만드는 것과 같은 값이어야 한다.
export ADMIN_MASTER_EMAIL="${ADMIN_MASTER_EMAIL:-local-master@carbus.test}"
export ADMIN_VIEWER_EMAIL="${ADMIN_VIEWER_EMAIL:-local-viewer@carbus.test}"

echo "로컬 DB 를 보는 개발 서버: http://localhost:${PORT}"
echo "  Supabase: ${NEXT_PUBLIC_SUPABASE_URL}"
echo "  로그인:   /admin/login → seed-local-auth.sh 가 정한 비밀번호"
exec pnpm next dev -p "$PORT"
