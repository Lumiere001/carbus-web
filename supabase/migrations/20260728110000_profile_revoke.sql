-- ============================================================
-- 임역원 기간이 끝난 계정을 내린다 (지우지 않는다)
-- ============================================================
-- 동규님 요청: "임역원 기간이 끝나면 접근 권한을 삭제해야 시스템을 돌릴 수 있을 것."
--
-- **왜 삭제가 아니라 "내리기"인가** — 실측으로 두 가지가 확인됐다:
--
--   ① `profiles` 를 참조하는 FK 7개가 전부 NO ACTION 이다. 감사 로그(누가 바꿨나) ·
--      배차 실행자 · 장부 기록자 · 신청 작성자 · 취소자 · 송금 등록자가 이 사람을
--      가리킨다. **33개 계정 중 29개가 이미 기록을 갖고 있어** 삭제가 물리적으로
--      거부된다. 억지로 지우려면 FK 를 끊어야 하고, 그러면 "누가 했는지"가 사라진다.
--   ② 설령 `profiles` 행을 지워도 `auth.users` 가 남아 **다시 로그인하면 되살아난다.**
--      삭제가 접근 차단이 되지 못한다.
--
-- 그래서 옛 소속을 내렸던 것과 같은 방식으로 간다(§10-B — "과거는 과거로 남기고
-- 앞으로를 잘 하자"). 기록은 그대로 두고, **다시 못 들어오게** 한다.
--
-- 실제 차단은 이미 있는 장치가 한다: 권한을 `guest` 로 내리고 캠퍼스·호차 배정을
-- 떼면 미들웨어와 RLS 가 전부 막는다. `revoked_at` 은 그 위에 **"이 사람은 이제
-- 우리 사용자가 아니다"** 라는 사실을 남겨, 목록에서 갈라 보여주기 위한 것이다.
-- ============================================================

alter table public.profiles add column if not exists revoked_at timestamptz;

comment on column public.profiles.revoked_at is
  '접근을 내린 시각. NULL = 현재 사용자. 값이 있으면 목록에서 갈라 보여준다.
   실제 차단은 role=guest + 배정 해제가 한다 — 이 컬럼은 그 사실의 기록이다.';

-- 현재 사용자 목록을 자주 훑으므로 부분 인덱스로 충분하다.
create index if not exists idx_profiles_active on public.profiles (role)
  where revoked_at is null;

-- ── 자체검증 ─────────────────────────────────────────────────
do $$
declare
  v_id   uuid;
  v_role text;
  v_cnt  int;
begin
  -- 로그인 계정이 실제로 있는 프로필만 고른다. 로컬 검증 환경은 백업으로 profiles
  -- 만 채우고 auth.users 는 비어 있어서, 그런 행을 건드리면 FK 가 막는다.
  select p.id into v_id
    from profiles p
   where p.role = 'campus_admin'
     and exists (select 1 from auth.users u where u.id = p.id)
   limit 1;
  if v_id is null then
    raise notice '  (로그인 계정이 붙은 임역원이 없어 검증 건너뜀)';
    return;
  end if;

  -- ① 내리면 권한이 guest 로 떨어지고 배정이 사라진다 (실제 차단은 이게 한다)
  update profiles
     set role = 'guest', campus_id = null, driver_bus_id = null, revoked_at = now()
   where id = v_id;

  select role::text into v_role from profiles where id = v_id;
  if v_role <> 'guest' then
    raise exception '검증 실패: 권한이 % 로 남았습니다', v_role;
  end if;
  if (select campus_id from profiles where id = v_id) is not null then
    raise exception '검증 실패: 캠퍼스 배정이 남았습니다';
  end if;
  raise notice '검증 ①: 내리기 → guest + 배정 해제 OK';

  -- ② 기록은 그대로 남는다 (감사 로그가 이 사람을 계속 가리킬 수 있다)
  select count(*) into v_cnt from registration_audit where changed_by = v_id;
  raise notice '검증 ②: 이 계정이 남긴 감사 기록 %건 — 그대로 보존됨', v_cnt;

  -- ③ 되돌리면 다시 현재 사용자가 된다 (권한은 따로 부여해야 한다)
  update profiles set revoked_at = null where id = v_id;
  if (select revoked_at from profiles where id = v_id) is not null then
    raise exception '검증 실패: 되돌리기가 안 됩니다';
  end if;
  raise notice '검증 ③: 되돌리기 OK (권한 부여는 별도)';

  raise exception '__검증완료_롤백';
exception when others then
  if sqlerrm = '__검증완료_롤백' then
    raise notice '자체검증 완료 (테스트 변경은 롤백됨)';
  else
    raise;
  end if;
end $$;
