#!/usr/bin/env python3
"""운영 백업 JSON → 로컬 Supabase 적재.

- session_replication_role=replica 로 FK·트리거를 잠시 끈다.
  (순환 FK buses↔registrations, profiles→auth.users 회피 + 감사 트리거 599회 발화 방지)
- GENERATED 컬럼(fee)은 INSERT 대상에서 제외 — 컬럼 목록을 DB에서 읽어 자동 처리.
- jsonb_populate_recordset 으로 타입 변환을 Postgres 에 맡긴다.
"""
import json, subprocess, sys, pathlib

BACKUP = pathlib.Path("/Users/east_star/Backups/carbus-web/2026-07-21_0038-pre-phase1")
CONTAINER = "supabase_db_carbus-web"
# FK 순서 무관(replica 모드)이지만 가독성을 위해 논리 순서대로
TABLES = [
    "campuses", "departure_slots", "buses", "profiles", "registrations",
    "role_labels", "system_config", "batch_runs", "registration_audit",
    "campus_remittances", "campus_payment_settlements",
]


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


def main():
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

    print("=== 적재 결과 (백업 vs 로컬 DB) ===")
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
