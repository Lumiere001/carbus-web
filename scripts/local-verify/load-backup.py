#!/usr/bin/env python3
"""운영 백업 JSON → 로컬 Supabase 적재.

- session_replication_role=replica 로 FK·트리거를 잠시 끈다.
  (순환 FK buses↔registrations, profiles→auth.users 회피 + 감사 트리거 599회 발화 방지)
- GENERATED 컬럼(fee)은 INSERT 대상에서 제외 — 컬럼 목록을 DB에서 읽어 자동 처리.
- jsonb_populate_recordset 으로 타입 변환을 Postgres 에 맡긴다.
"""
import json, subprocess, sys, pathlib

BACKUP_ROOT = pathlib.Path("/Users/east_star/Backups/carbus-web")


def latest_backup() -> pathlib.Path:
    """가장 최근 백업 디렉터리. 인자로 경로를 주면 그걸 쓴다.

    상수로 박아두면 Phase 가 넘어갈 때마다 낡는다(실제로 pre-phase1 을 가리킨 채
    Phase 2-B 까지 왔다). 디렉터리명이 YYYY-MM-DD_HHMM 접두사라 이름순 정렬이
    곧 시간순이다.
    """
    if len(sys.argv) > 1:
        p = pathlib.Path(sys.argv[1]).expanduser()
        if not p.is_dir():
            sys.exit(f"백업 경로가 없습니다: {p}")
        return p
    dirs = sorted((d for d in BACKUP_ROOT.iterdir()
                   if d.is_dir() and (d / "_manifest.json").exists()),
                  key=lambda d: d.name)
    if not dirs:
        sys.exit(f"백업이 없습니다: {BACKUP_ROOT}")
    return dirs[-1]


BACKUP = latest_backup()
CONTAINER = "supabase_db_carbus-web"
# FK 순서 무관(replica 모드)이지만 가독성을 위해 논리 순서대로
TABLES = [
    "events", "campuses", "org_units", "departure_slots", "buses",
    "profiles", "registrations", "role_labels", "system_config",
    "batch_runs", "registration_audit",
    "campus_remittances", "campus_payment_settlements", "payment_ledger",
]

# 백업하지 않아도 되는 테이블 (마이그레이션이 전량 생성 = 데이터가 아니라 스키마의 일부)
NO_BACKUP_NEEDED: set[str] = set()


def psql(sql: str, tuples_only=True) -> str:
    cmd = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
    if tuples_only:
        cmd += ["-tA"]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"SQL 실패:\n{r.stderr[:3000]}", file=sys.stderr)
        sys.exit(1)
    return r.stdout.strip()


def insertable_columns(table: str) -> list[str]:
    """GENERATED ALWAYS 컬럼을 제외한 실제 삽입 가능 컬럼."""
    out = psql(f"""
        select column_name from information_schema.columns
        where table_schema='public' and table_name='{table}'
          and is_generated='NEVER' and identity_generation is null
        order by ordinal_position
    """)
    return [c for c in out.splitlines() if c]


def check_coverage() -> None:
    """DB 테이블 ⊆ 백업 대상인지 검사.

    backup-prod.mjs 의 테이블 목록이 하드코딩이라 새 Phase 가 테이블을 추가해도
    조용히 빠진다. 실제로 events·org_units·payment_ledger 가 그렇게 누락됐고,
    적재는 replica 모드(FK 끔) 덕에 성공한 척하다가 뒤늦게 FK 위반으로 터졌다.
    여기서 먼저, 크게 실패시킨다.
    """
    db_tables = {t for t in psql(
        "select tablename from pg_tables where schemaname='public'"
    ).splitlines() if t}
    missing = db_tables - set(TABLES) - NO_BACKUP_NEEDED
    if missing:
        sys.exit(
            f"❌ 백업 대상에 빠진 테이블: {', '.join(sorted(missing))}\n"
            f"   backup-prod.mjs 의 TABLES 와 이 파일의 TABLES 양쪽에 추가한 뒤\n"
            f"   운영 백업을 다시 뜨세요. 지금 백업으로는 복구도 재현도 안 됩니다."
        )

    no_file = [t for t in TABLES if not (BACKUP / f"{t}.json").exists()]
    if no_file:
        sys.exit(
            f"❌ 백업 '{BACKUP.name}' 에 파일이 없는 테이블: {', '.join(no_file)}\n"
            f"   이 백업은 해당 테이블이 생기기 전에 뜬 것입니다.\n"
            f"   운영 백업을 다시 뜨거나(권장), 더 최신 백업 경로를 인자로 주세요."
        )


def main():
    check_coverage()
    # 마이그레이션이 마스터데이터(campuses·slots·role_labels·system_config)를 시드하므로
    # 운영 백업으로 갈아끼우기 위해 먼저 비운다. 로컬 전용 작업.
    stmts = [
        "SET session_replication_role = replica;",
        "TRUNCATE " + ", ".join(f"public.{t}" for t in TABLES) + " RESTART IDENTITY CASCADE;",
    ]
    summary = []
    for t in TABLES:
        rows = json.loads((BACKUP / f"{t}.json").read_text())
        if not rows:
            summary.append((t, 0))
            continue
        # 백업에 실제로 들어 있는 컬럼만 INSERT 한다.
        # 백업을 뜬 뒤에 추가된 컬럼(예: Phase 1 의 event_id)을 목록에 넣으면
        # jsonb 에 키가 없어 NULL 이 명시적으로 들어가고, 그 순간 컬럼 DEFAULT 가
        # 무력화돼 NOT NULL 위반이 난다. DEFAULT 가 채우게 두려면 아예 빼야 한다.
        present = set().union(*(r.keys() for r in rows))
        cols = [c for c in insertable_columns(t) if c in present]
        collist = ", ".join(f'"{c}"' for c in cols)
        payload = json.dumps(rows, ensure_ascii=False).replace("'", "''")
        stmts.append(
            f"INSERT INTO public.{t} ({collist}) "
            f"SELECT {collist} FROM jsonb_populate_recordset(null::public.{t}, '{payload}'::jsonb);"
        )
        summary.append((t, len(rows)))
    stmts.append("SET session_replication_role = DEFAULT;")

    # 시퀀스/identity 를 최대값으로 올린다.
    # jsonb_populate_recordset 으로 id 를 직접 넣으면 시퀀스가 1에 머물러,
    # 이후 정상 INSERT 가 "duplicate key" 로 실패한다(운영에는 없는 로컬 전용 함정).
    stmts.append("""
    do $$
    declare r record; seq text; mx bigint;
    begin
      for r in
        select c.table_name, c.column_name
          from information_schema.columns c
         where c.table_schema='public'
           and (c.column_default like 'nextval%' or c.identity_generation is not null)
      loop
        seq := pg_get_serial_sequence('public.'||quote_ident(r.table_name), r.column_name);
        if seq is not null then
          execute format('select coalesce(max(%I),0) from public.%I', r.column_name, r.table_name) into mx;
          perform setval(seq, greatest(mx, 1), mx > 0);
        end if;
      end loop;
    end $$;""")

    psql("\n".join(stmts), tuples_only=False)

    print(f"=== 적재 결과 (백업 {BACKUP.name} vs 로컬 DB) ===")
    ok = True
    for t, n in summary:
        actual = int(psql(f"select count(*) from public.{t}"))
        match = actual == n
        ok &= match
        print(f"  {'OK ' if match else 'MISMATCH'} {t:28} 백업 {n:6} / DB {actual:6}")
    print()
    print("적재 무결성:", "PASS ✅" if ok else "FAIL ❌")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
