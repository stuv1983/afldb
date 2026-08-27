#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B2-1 — G5 final question: what exactly must a seeded player carry?

EVIDENCE ONLY. Zero writes.

G5 is now scoped to **exactly two rows in `players`** (B2 handoff §38): the only two
`legacy_player_id IS NULL` players in `afldb_dev`, which are precisely the two zero-senior-game
targets of explicit human `linked` decisions. `import_fitzroy_core.py` builds `players` only
from fitzRoy `player_stats` rows, so it will never create them; preserving those two decisions
across a clean rebuild requires seeding.

Before any seeding design can be approved, one thing must be measured: **is there any
canonical state attached to those two players beyond the players row, the explicit decision
and the draft references?**

  A. a minimal canonical player shell is all that must be recreated;  or
  B. additional canonical data exists and would also have to be reconstructed — **HALT**.

Method
------
Every foreign key referencing `players(id)` is discovered from the catalogue — nothing is
hard-coded, so a table added since this file was written cannot be missed — and each is
counted against the two target players. Tables with zero references are summarised, not
listed row by row.

The two targets are selected structurally as `players.legacy_player_id IS NULL`, which §38.3
established is exactly this set (`not_from_legacy_import = 2`). The run asserts that count is
still 2 and refuses otherwise, so it can never silently measure a different population.

The second section reports, per nullable `players` column, **how many of the two carry a
non-NULL value** — never the value itself. That is what says which fields a seed must supply.

Egress discipline
-----------------
Table names, column names and counts only. **No player names, no display text, no values from
any row, and no surrogate ids** — not `players.id`, not `draft_picks.id`, not
`draft_persons.id`, not `auth_users.id`.

Safety envelope — identical to the other Stage B2 runners: `AFLDB_OWNER_DATABASE_URL` parsed
out of `.env` (never sourced, never printed); DSN path hard-guarded to `/afldb_dev`; the
preserved pre-rebuild database refused by name; `default_transaction_read_only=on` at connect;
`REPEATABLE READ` read-only; in-session verification of database / user / read-only /
isolation; SELECT only; explicit `ROLLBACK` and a safe close on success and failure alike.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]

REQUIRED_DB = "afldb_dev"
REQUIRED_PATH = f"/{REQUIRED_DB}"
REFUSED_SUBSTRINGS = ("afldb_test_pre_rebuild",)
ENV_KEY = "AFLDB_OWNER_DATABASE_URL"

EXPECTED_TARGETS = 2

# The structural selector for the two admin-created players. No id is ever read out of it.
TARGETS = "SELECT id FROM players WHERE legacy_player_id IS NULL"

Q_TARGET_COUNT = "SELECT count(*) FROM players WHERE legacy_player_id IS NULL"

# Every FK that references players(id), discovered from the catalogue.
Q_FKS = """
SELECT src_ns.nspname  AS schema_name,
       src.relname     AS table_name,
       att.attname     AS column_name
FROM pg_constraint con
JOIN pg_class     src     ON src.oid = con.conrelid
JOIN pg_namespace src_ns  ON src_ns.oid = src.relnamespace
JOIN pg_class     tgt     ON tgt.oid = con.confrelid
JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
WHERE con.contype = 'f'
  AND tgt.relname = 'players'
  AND src_ns.nspname = 'public'
ORDER BY 1, 2, 3
"""

# Which optional players columns do the two targets actually populate?
Q_PLAYERS_COLUMNS = """
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'players'
ORDER BY ordinal_position
"""

# Explicit-decision context, restated here so the seed scope is self-contained.
Q_DECISION_CONTEXT = """
SELECT count(*) FILTER (WHERE plr.action = 'linked')             AS linked_decisions_on_targets,
       count(*) FILTER (WHERE plr.action = 'confirmed_unlinked') AS unlinked_decisions_on_targets,
       count(DISTINCT dpk.player_url)                            AS distinct_player_urls,
       count(DISTINCT dpk.draft_year)                            AS distinct_draft_years
FROM player_link_resolutions plr
JOIN draft_picks dpk ON dpk.id = plr.target_id
WHERE plr.target_table = 'draft_picks'
  AND plr.player_id IN (SELECT id FROM players WHERE legacy_player_id IS NULL)
"""


def read_dsn() -> str:
    """Parse the owner DSN out of .env. The file is never sourced and never printed."""
    env_path = REPO_ROOT / ".env"
    if not env_path.is_file():
        raise SystemExit(f"REFUSED: {env_path} not found")
    for raw in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if line.startswith(f"{ENV_KEY}="):
            dsn = line[len(ENV_KEY) + 1:].strip().strip('"').strip("'")
            break
    else:
        raise SystemExit(f"REFUSED: {ENV_KEY} is not set in .env")
    parsed = urlparse(dsn)
    if parsed.path != REQUIRED_PATH:
        raise SystemExit(f"REFUSED: {ENV_KEY} does not target {REQUIRED_PATH}")
    if any(bad in dsn for bad in REFUSED_SUBSTRINGS):
        raise SystemExit("REFUSED: DSN names a preserved pre-rebuild database")
    return dsn


def section(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def table(rows, headers) -> None:
    if not rows:
        print("  (none)")
        return
    widths = [max(len(str(h)), max(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    print("  " + "  ".join(str(h).ljust(w) for h, w in zip(headers, widths)))
    print("  " + "  ".join("-" * w for w in widths))
    for row in rows:
        print("  " + "  ".join(str(v).ljust(w) for v, w in zip(row, widths)))


def named(cur, sql, params=None):
    cur.execute(sql, params)
    row = cur.fetchone()
    return list(zip([d.name for d in cur.description], row))


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args(argv)

    import psycopg
    from psycopg import sql as pgsql

    dsn = read_dsn()
    conn = psycopg.connect(dsn, options="-c default_transaction_read_only=on")
    try:
        conn.read_only = True
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user, "
                        "current_setting('transaction_read_only'), "
                        "current_setting('default_transaction_read_only'), "
                        "current_setting('transaction_isolation')")
            db, usr, txn_ro, default_ro, iso = cur.fetchone()
            section("SAFETY IDENTITY")
            print(f"  db={db}  user={usr}  txn_ro={txn_ro}  default_ro={default_ro}  isolation={iso}")
            if db != REQUIRED_DB:
                raise SystemExit(f"REFUSED: connected to {db!r}, not {REQUIRED_DB!r}")
            if txn_ro != "on" or default_ro != "on":
                raise SystemExit("REFUSED: transaction is not read-only")
            if not iso.startswith("repeatable"):
                raise SystemExit(f"REFUSED: isolation is {iso!r}")

            # ---- population guard ----------------------------------------
            cur.execute(Q_TARGET_COUNT)
            n_targets = cur.fetchone()[0]
            section("TARGET POPULATION")
            print(f"  players with legacy_player_id IS NULL (admin-created): {n_targets}")
            if n_targets != EXPECTED_TARGETS:
                raise SystemExit(
                    f"REFUSED: expected exactly {EXPECTED_TARGETS} admin-created players "
                    f"(B2 handoff §38.3), found {n_targets}. The measured scope has changed; "
                    "review before continuing.")

            for name, value in named(cur, Q_DECISION_CONTEXT):
                print(f"  {name:<32} {value}")

            # ---- A. everything referencing those two players -------------
            section("G5-A — canonical state attached to the two targets (catalogue-discovered)")
            cur.execute(Q_FKS)
            fks = cur.fetchall()
            print(f"  foreign keys referencing players(id): {len(fks)}\n")

            referencing, empty = [], []
            for schema_name, table_name, column_name in fks:
                query = pgsql.SQL(
                    "SELECT count(*) FROM {}.{} WHERE {} IN ({})"
                ).format(
                    pgsql.Identifier(schema_name),
                    pgsql.Identifier(table_name),
                    pgsql.Identifier(column_name),
                    pgsql.SQL(TARGETS),
                )
                cur.execute(query)
                n = cur.fetchone()[0]
                (referencing if n else empty).append((table_name, column_name, n))

            print("  tables that DO reference the two targets:")
            table(referencing, ["table", "column", "rows"])
            print(f"\n  tables with zero references: {len(empty)}")
            print("  " + ", ".join(sorted({t for t, _, _ in empty})))

            expected = {"draft_picks", "draft_persons", "player_link_resolutions",
                        "player_career_stats"}
            unexpected = sorted({t for t, _, _ in referencing} - expected)
            print()
            if unexpected:
                print("  *** CANONICAL STATE BEYOND THE DRAFT/DECISION FOOTPRINT: "
                      + ", ".join(unexpected))
                print("      Outcome B — rebuilding these players means reconstructing more than")
                print("      a minimal shell. HALT and review before approving any seeding "
                      "design. ***")
            else:
                print("  ==> Outcome A: every reference lies inside the draft / explicit-decision")
                print("      footprint (plus derived career stats). A minimal canonical player")
                print("      shell is all a rebuild must recreate.")

            # ---- B. which players columns a seed must supply --------------
            section("G5-B — which `players` columns the two targets actually populate")
            print("  Counts only — no value from any row is printed.\n")
            cur.execute(Q_PLAYERS_COLUMNS)
            columns = cur.fetchall()
            rows = []
            for column_name, is_nullable, data_type in columns:
                query = pgsql.SQL(
                    "SELECT count(*) FROM players WHERE legacy_player_id IS NULL AND {} IS NOT NULL"
                ).format(pgsql.Identifier(column_name))
                cur.execute(query)
                rows.append((column_name, data_type,
                             "NOT NULL" if is_nullable == "NO" else "nullable",
                             f"{cur.fetchone()[0]} / {n_targets}"))
            table(rows, ["column", "type", "constraint", "non-null in targets"])
            print("\n  A seed must supply every NOT NULL column. Anything nullable that reads")
            print(f"  0 / {n_targets} needs no source at all and is deliberately absent (class C).")
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()

    print("\nROLLBACK completed — nothing was written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
