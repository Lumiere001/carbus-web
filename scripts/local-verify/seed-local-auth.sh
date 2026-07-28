#!/usr/bin/env bash
# ============================================================
# 로컬 전용 로그인 계정 만들기
# ============================================================
# 운영 백업은 `auth` 스키마를 담지 않는다(담아서도 안 된다 — 남의 로그인 정보다).
# 그래서 적재 직후 로컬 `auth.users` 는 비어 있고, /admin/* 은 로그인 화면에서
# 더 나아가지 못한다. **그 때문에 지금까지 화면을 로컬에서 한 번도 못 열어 봤고,
# 화면에서만 쓰는 RPC 가 두 번 연속 운영에서 터졌다**(§24·§25).
#
# 이 스크립트는 이미 적재된 `profiles` 행에 로그인 수단만 붙인다.
#   - master  : 운영 백업에 있는 master 프로필에 붙인다(권한·소속 그대로).
#   - viewer  : 없으면 만들지 않는다. 있으면 같은 방식으로 붙인다.
#   - 임역원  : `--campus <캠퍼스이름>` 을 주면 그 캠퍼스 임역원 계정에도 붙인다.
#
# ⚠️ 로컬 전용이다. 운영 DB 를 가리키는 컨테이너에 대고 돌리지 않는다 —
#    아래에서 컨테이너 이름이 로컬 스택의 것인지 확인하고 시작한다.
#
# 사용법:
#   bash scripts/local-verify/seed-local-auth.sh
#   bash scripts/local-verify/seed-local-auth.sh --campus 전남대
# ============================================================
set -euo pipefail

CONTAINER="${CARBUS_DB_CONTAINER:-supabase_db_carbus-web}"
PASSWORD="${LOCAL_ADMIN_PASSWORD:-carbus-local}"
MASTER_EMAIL="${ADMIN_MASTER_EMAIL:-local-master@carbus.test}"
VIEWER_EMAIL="${ADMIN_VIEWER_EMAIL:-local-viewer@carbus.test}"
CAMPUS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --campus) CAMPUS="${2:-}"; shift 2 ;;
    *) echo "모르는 인자: $1" >&2; exit 2 ;;
  esac
done

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "로컬 Supabase 컨테이너($CONTAINER)가 안 떠 있습니다. supabase start 먼저." >&2
  exit 1
fi

docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -v pw="$PASSWORD" -v master_email="$MASTER_EMAIL" -v viewer_email="$VIEWER_EMAIL" \
  -v campus="$CAMPUS" <<'SQL'
-- psql 변수(:'pw')는 **달러 인용 블록 안에서 치환되지 않는다.** 그래서 먼저
-- 세션 설정으로 옮긴 뒤 current_setting 으로 읽는다.
select set_config('carbus.pw',           :'pw',           false),
       set_config('carbus.master_email', :'master_email', false),
       set_config('carbus.viewer_email', :'viewer_email', false),
       set_config('carbus.campus',       :'campus',       false);

do $$
declare
  v_pw     text := current_setting('carbus.pw');
  v_campus text := nullif(current_setting('carbus.campus'), '');
  r        record;
  v_n      int := 0;
begin
  -- 붙일 대상: master · viewer · (요청 시) 그 캠퍼스의 임역원 하나.
  for r in
    select p.id, p.role,
           case p.role
             when 'master' then current_setting('carbus.master_email')
             when 'viewer' then current_setting('carbus.viewer_email')
             else 'local-campus-' || left(p.id::text, 8) || '@carbus.test'
           end as email
      from profiles p
      left join campuses c on c.id = p.campus_id
     where p.revoked_at is null
       and (p.role in ('master','viewer')
            or (v_campus is not null and p.role = 'campus_admin' and c.name = v_campus))
     order by case p.role when 'master' then 1 when 'viewer' then 2 else 3 end
  loop
    -- auth.users 를 직접 만든다. GoTrue API 를 쓰면 새 id 가 생겨 profiles 와
    -- 이어지지 않는다 — **기존 프로필의 id 를 그대로 써야** 권한·소속이 따라온다.
    --
    -- ⚠️ 토큰 컬럼(confirmation_token 등)은 **빈 문자열로 둔다. NULL 이면 안 된다.**
    --    GoTrue 는 Go 로 짜여 있어 이 칼럼들을 string 으로 읽는데, NULL 이 오면
    --    "converting NULL to string is unsupported" 로 스캔이 실패하고, 화면에는
    --    그냥 "비밀번호가 올바르지 않습니다" 로 보인다. 비밀번호는 맞는데도.
    insert into auth.users (
      id, instance_id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token,
      created_at, updated_at
    ) values (
      r.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', r.email,
      crypt(v_pw, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '',
      now(), now()
    )
    on conflict (id) do update
      set email = excluded.email,
          encrypted_password = excluded.encrypted_password,
          email_confirmed_at = now(),
          confirmation_token = '', recovery_token = '',
          email_change = '', email_change_token_new = '',
          email_change_token_current = '',
          phone_change = '', phone_change_token = '', reauthentication_token = '',
          updated_at = now();

    -- 로그인 수단(identity). 없으면 GoTrue 가 비밀번호 로그인을 거부한다.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at,
      created_at, updated_at
    ) values (
      gen_random_uuid(), r.id, r.id::text,
      jsonb_build_object('sub', r.id::text, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict (provider, provider_id) do update
      set identity_data = excluded.identity_data, updated_at = now();

    raise notice '  % → %', r.role, r.email;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception '붙일 프로필이 없습니다 — 백업이 적재됐는지 확인하세요';
  end if;
  raise notice '로컬 로그인 계정 %개 준비됨', v_n;
end $$;
SQL

echo
echo "비밀번호: $PASSWORD"
echo "  개발 서버는 bash scripts/local-verify/dev-local.sh 로 띄우세요 (로컬 DB 를 봅니다)."
