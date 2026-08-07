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
    "events", "campuses", "org_units", "event_trips", "buses",
    "profiles", "registrations", "role_labels", "system_config",
    "batch_runs", "registration_audit",
    "campus_remittances", "campus_payment_settlements", "payment_ledger",
    "transport_legs", "pickup_places", "pickup_requests", "course_signups",
]

# 백업하지 않아도 되는 테이블 (마이그레이션이 전량 생성 = 데이터가 아니라 스키마의 일부)
NO_BACKUP_NEEDED: set[str] = set()

# 테이블이 rename 된 경우, 그 전에 뜬 백업 파일의 옛 이름.
# 옛 백업으로도 재현이 되어야 한다 — 운영이 아직 rename 전일 수도 있으므로.
# 백업 JSON 에 없는 컬럼은 로더가 자동으로 빼므로 신규 컬럼은 DEFAULT 가 채운다
# (예: event_trips.direction 은 'up' 으로 앉는다 — 옛 departure_slots 가 곧 상행이었다).
RENAMED_FROM = {
    "event_trips": "departure_slots",
}

# 컬럼이 rename 된 경우: {테이블: {백업의 옛 키: 현재 컬럼명}}.
# 테이블 rename 만 처리하면 컬럼은 조용히 버려진다 — jsonb_populate_recordset 은
# JSON 키를 컬럼명으로 매칭하므로, 옛 키는 어떤 컬럼에도 안 붙고 NULL 이 된다.
# 실제로 buses.departure_slot_id → up_trip_id 를 놓쳐 전 차량 상행 편이 NULL 이 됐고,
# 상행 배차가 0건이 되는데도 적재는 "PASS" 로 끝났다(행수만 보므로).
RENAMED_COLUMNS = {
    "buses": {"departure_slot_id": "up_trip_id"},
}

# 어떤 테이블을 넣은 **직후** 돌려야 하는 SQL.
# 왜 필요한가: registrations 의 파생 트리거가 "하행 편"을 찾는데, 백업은 3-A 이전에
# 떠서 하행 편 행이 없다. 그 편은 마이그레이션이 events 를 보고 만드는데, 그건
# 적재가 다 끝난 뒤(post-load.sh)라 순서가 뒤집힌다.
# → event_trips 를 넣은 직후 하행 편을 만들어 둔다. 마이그레이션과 같은 SQL 이라
#   나중에 다시 돌아도 (where not exists) 아무 일도 안 일어난다.
AFTER_TABLE_SQL = {
    "event_trips": """
        insert into public.event_trips (key, label, display_order, active, event_id, direction)
        select 'return', '귀가', 100, true, e.id, 'down'
          from public.events e
         where not exists (
           select 1 from public.event_trips t
            where t.event_id = e.id and t.direction = 'down');
    """,
}


def psql(sql: str, tuples_only=True, quiet=False) -> str:
    cmd = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"]
    if tuples_only:
        cmd += ["-tA"]
    # -q 는 "CREATE TABLE" 같은 명령 태그를 지운다. DDL 과 SELECT 를 한 세션에서
    # 같이 돌릴 때(임시 테이블) 태그가 결과 행에 섞여 들어오는 걸 막는다.
    if quiet:
        cmd += ["-q"]
    r = subprocess.run(cmd, input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"SQL 실패:\n{r.stderr[:3000]}", file=sys.stderr)
        sys.exit(1)
    return r.stdout.strip()


def insertable_columns(table: str) -> list[str]:
    """실제 삽입 가능 컬럼.

    제외하는 것은 **생성 컬럼(`GENERATED ALWAYS AS (식) STORED`)뿐**이다.
    identity 컬럼(`GENERATED ALWAYS AS IDENTITY`)은 **반드시 넣는다** —
    `OVERRIDING SYSTEM VALUE` 로 운영의 id 를 그대로 보존한다.

    ⚠️ 예전엔 identity 도 빼고 있었다. 그러면 id 가 로컬에서 1부터 새로 매겨지는데,
    `event_trips` 의 운영 id 가 우연히 1~4 라 오래 들키지 않았다. 캠프 행사의 편이
    7·8 로 생기면서 드러났다 — 로컬에선 5·6 으로 앉고, `buses.up_trip_id=7` 이
    허공을 가리키고, `trg_reg_event_scope`(ENABLE ALWAYS 라 replica 모드에서도
    발화)가 "다른 행사의 운행편" 이라며 신청 적재를 통째로 중단시켰다.
    id 를 보존하지 않으면 **로컬은 운영의 재현이 아니다.**
    """
    out = psql(f"""
        select column_name from information_schema.columns
        where table_schema='public' and table_name='{table}'
          and is_generated='NEVER'
        order by ordinal_position
    """)
    return [c for c in out.splitlines() if c]


def has_always_identity(table: str) -> bool:
    """`GENERATED ALWAYS AS IDENTITY` 컬럼이 있는가.

    있으면 INSERT 에 `OVERRIDING SYSTEM VALUE` 가 필요하다. 없는 테이블에 그 구문을
    붙이면 Postgres 가 거부하므로 테이블마다 따로 판단한다.
    """
    return psql(f"""
        select count(*) from information_schema.columns
        where table_schema='public' and table_name='{table}'
          and identity_generation = 'ALWAYS'
    """) not in ("", "0")


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

    # 파일이 없는 테이블은 두 경우로 갈린다. 섞으면 안 된다:
    #   ① 백업을 뜰 때 **이미 있었는데** 파일이 없다 → 백업이 깨진 것. 크게 실패.
    #   ② 백업을 뜬 **뒤에 생긴** 테이블이다 → 시간 순서상 당연하고, 빈 채로 두면 된다.
    # 구분은 manifest 로 한다. manifest 는 그 백업이 무엇을 대상으로 삼았는지의 기록이라,
    # 거기 이름이 있는데 파일이 없으면 그건 사고다.
    manifest_tables: set[str] = set()
    mf = BACKUP / "_manifest.json"
    if mf.exists():
        try:
            _tables = json.loads(mf.read_text()).get("tables", {})
            # 백업 당시 **운영에 그 테이블이 아직 없었던** 경우는 매니페스트에
            # `absent: true` 로 남는다. 그건 사고가 아니라 정상이다 — 새 테이블을
            # 만든 직후 뜬 백업은 항상 이 상태가 된다. 구분하지 않으면 배포할 때마다
            # 재적재가 막힌다(실제로 막혔다).
            manifest_tables = {
                k for k, v in _tables.items()
                if not (isinstance(v, dict) and v.get("absent"))
            }
        except Exception:
            manifest_tables = set()

    broken, newer = [], []
    for t in TABLES:
        if backup_file(t) is not None:
            continue
        names = {t, RENAMED_FROM.get(t, "")} - {""}
        (broken if names & manifest_tables else newer).append(t)

    if broken:
        sys.exit(
            f"❌ 백업 '{BACKUP.name}' 이 대상으로 삼았는데 파일이 없는 테이블: "
            f"{', '.join(broken)}\n"
            f"   백업이 불완전합니다. 다시 뜨세요."
        )
    if newer:
        print(
            f"⚠️  이 백업보다 나중에 생긴 테이블이라 비어 있습니다: {', '.join(newer)}\n"
            f"   (백업: {BACKUP.name}) — 다음 백업부터는 포함됩니다."
        )


def backup_file(table: str) -> pathlib.Path | None:
    """이 테이블의 백업 JSON. rename 이전 백업이면 옛 이름으로 찾는다."""
    p = BACKUP / f"{table}.json"
    if p.exists():
        return p
    old = RENAMED_FROM.get(table)
    if old:
        p = BACKUP / f"{old}.json"
        if p.exists():
            return p
    return None


def check_foreign_keys() -> list[str]:
    """적재가 끝난 뒤 **끊긴 참조**를 전수로 센다.

    왜 행 수 대조만으로는 부족한가: 적재는 `session_replication_role = replica` 로
    FK 를 끄고 돈다(순환 FK 때문에 필요하다). 그래서 가리키는 곳이 없는 값이 들어가도
    행 수는 맞고 "PASS" 가 찍힌다. 실제로 `buses.up_trip_id` 가 사라진 편을 가리킨 채
    통과했고, 그 로컬로 한 검증은 전부 무의미했다.

    대상은 **public → public** FK 만이다. `profiles.id → auth.users.id` 처럼 로컬에
    원본이 없는 것은 정상이므로 뺀다.
    복합 FK 는 행 비교(`(a,b) = (c,d)`)로 본다. 행 전체가 NULL 이 아닌 경우만 세는데,
    이는 Postgres 의 MATCH SIMPLE 기본 동작과 같다.
    """
    out = psql("""
      drop table if exists _fk_bad;
      create temp table _fk_bad (msg text);
      do $$
      declare r record; n bigint;
      begin
        for r in
          select con.conname,
                 src.relname as src_table, tgt.relname as tgt_table,
                 (select string_agg('s.'||quote_ident(a.attname), ', ' order by k.ord)
                    from unnest(con.conkey) with ordinality k(attnum, ord)
                    join pg_attribute a
                      on a.attrelid = con.conrelid and a.attnum = k.attnum) as src_cols,
                 (select string_agg('t.'||quote_ident(a.attname), ', ' order by k.ord)
                    from unnest(con.confkey) with ordinality k(attnum, ord)
                    join pg_attribute a
                      on a.attrelid = con.confrelid and a.attnum = k.attnum) as tgt_cols
            from pg_constraint con
            join pg_class src on src.oid = con.conrelid
            join pg_class tgt on tgt.oid = con.confrelid
            join pg_namespace ns on ns.oid = src.relnamespace
            join pg_namespace nt on nt.oid = tgt.relnamespace
           where con.contype = 'f'
             and ns.nspname = 'public' and nt.nspname = 'public'
        loop
          execute format(
            'select count(*) from public.%I s where (%s) is not null'
            ' and not exists (select 1 from public.%I t where (%s) = (%s))',
            r.src_table, r.src_cols, r.tgt_table, r.tgt_cols, r.src_cols
          ) into n;
          if n > 0 then
            insert into _fk_bad values (format('%s: %s행 (%s)', r.conname, n, r.src_table));
          end if;
        end loop;
      end $$;
      select msg from _fk_bad order by msg;
    """, quiet=True)
    return [line for line in out.splitlines() if line.strip()]


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
        f = backup_file(t)
        if f is None:
            # 이 백업보다 나중에 생긴 테이블 — 위 check_coverage 가 이미 경고했다.
            summary.append((t, 0))
            continue
        rows = json.loads(f.read_text())
        # 컬럼 rename 이 있었으면 백업의 옛 키를 현재 컬럼명으로 바꿔 끼운다.
        colmap = RENAMED_COLUMNS.get(t)
        if colmap and rows:
            for r in rows:
                for old_c, new_c in colmap.items():
                    if old_c in r and new_c not in r:
                        r[new_c] = r.pop(old_c)
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
        override = " OVERRIDING SYSTEM VALUE" if has_always_identity(t) else ""
        stmts.append(
            f"INSERT INTO public.{t} ({collist}){override} "
            f"SELECT {collist} FROM jsonb_populate_recordset(null::public.{t}, '{payload}'::jsonb);"
        )
        summary.append((t, len(rows)))
        if t in AFTER_TABLE_SQL:
            stmts.append(AFTER_TABLE_SQL[t])
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
        # AFTER_TABLE_SQL 이 행을 더 만드는 테이블은 DB 가 백업보다 많은 게 정상이다
        # (예: event_trips 에 하행 편을 만들어 넣는다). 적기만 하면 여전히 실패.
        match = actual >= n if t in AFTER_TABLE_SQL else actual == n
        ok &= match
        extra = f" (+{actual - n} 생성)" if t in AFTER_TABLE_SQL and actual > n else ""
        print(f"  {'OK ' if match else 'MISMATCH'} {t:28} 백업 {n:6} / DB {actual:6}{extra}")

    dangling = check_foreign_keys()
    print()
    if dangling:
        print("❌ 가리키는 곳이 없는 참조:")
        for line in dangling:
            print(f"   {line}")
        ok = False
    else:
        print("참조 무결성: 끊긴 참조 없음")

    print()
    print("적재 무결성:", "PASS ✅" if ok else "FAIL ❌")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
