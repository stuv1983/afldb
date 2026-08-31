#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B2-2 — the one open item: how is draft_picks.signing_detail derived?

EVIDENCE ONLY. Zero writes.

B2-2 closed the event vocabulary and `signing_kind` from tracked evidence alone. One field
remains unsettled: `signing_detail`. What is known:

  * the stored population is **593** rows (measured, B2 handoff §30.2);
  * the accepted Stage A snapshot carries **593** `signing_raw` values containing a
    parenthetical — the same count;
  * **44** of those carry a SECOND parenthetical (`Academy (NG) (Fremantle)`), which is
    exactly where candidate derivations disagree;
  * it has **zero consumers** in `src/` — only `signing_kind` is read
    (`src/db/queries/grid-solver.ts:884`).

A matching count is not a matching rule. Rather than freeze a guess, this runner tests four
candidate derivations against the stored column and reports agreement counts.

  D1  inner text of the first parenthetical through the FINAL ')'
      'Academy (NG) (Fremantle)' -> 'NG) (Fremantle'
  D2  everything from the first '(' onward, verbatim, parentheses included
      'Academy (NG) (Fremantle)' -> '(NG) (Fremantle)'
  D3  inner text of the LAST parenthetical only
      'Academy (NG) (Fremantle)' -> 'Fremantle'
  D4  inner text of the FIRST parenthetical only
      'Academy (NG) (Fremantle)' -> 'NG'

The four coincide on the 549 single-parenthetical values and separate only on the 44, which is
what makes the comparison decisive. Whichever reproduces 593/593 is the rule; if none does,
`signing_detail` stays OPEN and is classified D (not imported), which costs nothing because
nothing consumes it.

Egress discipline
-----------------
Counts only. **No `signing` or `signing_detail` source text is printed** — it embeds
father-son player names. No names, no surrogate ids.

Safety envelope — identical to every other Stage B2 runner: `AFLDB_OWNER_DATABASE_URL` parsed
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

# Rows in scope: draftguru-sourced picks whose signing carries a parenthetical.
SCOPE = """
  FROM draft_picks dp
  JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
  WHERE dp.signing IS NOT NULL AND dp.signing LIKE '%(%'
"""

CANDIDATES = [
    ("D1  first '(' .. final ')', inner text",
     "substring(dp.signing from position('(' in dp.signing) + 1 "
     "for length(dp.signing) - position('(' in dp.signing) - 1)"),
    ("D2  first '(' onward, verbatim",
     "substring(dp.signing from position('(' in dp.signing))"),
    ("D3  LAST parenthetical, inner text",
     "(regexp_match(dp.signing, '\\(([^()]*)\\)\\s*$'))[1]"),
    ("D4  FIRST parenthetical, inner text",
     "(regexp_match(dp.signing, '\\(([^()]*)\\)'))[1]"),
]

Q_SCOPE = f"""
SELECT count(*)                                                AS picks_with_parenthetical,
       count(dp.signing_detail)                                AS signing_detail_present,
       count(*) FILTER (WHERE dp.signing_detail IS NULL)       AS signing_detail_null,
       count(*) FILTER (WHERE dp.signing ~ '\\(.*\\(')         AS multi_parenthetical
{SCOPE}
"""

# Is signing_detail ever set on a row with NO parenthetical? That would disprove every
# candidate at once.
Q_OUTSIDE_SCOPE = """
SELECT count(*) AS detail_present_without_parenthetical
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
WHERE dp.signing_detail IS NOT NULL
  AND (dp.signing IS NULL OR dp.signing NOT LIKE '%(%')
"""


def build_candidate_query() -> str:
    filters = ",\n".join(
        f"       count(*) FILTER (WHERE dp.signing_detail IS NOT DISTINCT FROM ({expr}))"
        f"        AS cand{i}_exact,\n"
        f"       count(*) FILTER (WHERE btrim(COALESCE(dp.signing_detail, '')) "
        f"= btrim(COALESCE({expr}, ''))) AS cand{i}_trimmed"
        for i, (_, expr) in enumerate(CANDIDATES)
    )
    return f"SELECT count(*) AS rows_compared,\n{filters}\n{SCOPE}"


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


def named(cur, sql, params=None):
    cur.execute(sql, params)
    row = cur.fetchone()
    return list(zip([d.name for d in cur.description], row))


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args(argv)

    import psycopg

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

            section("SCOPE")
            scope = dict(named(cur, Q_SCOPE))
            for name, value in scope.items():
                print(f"  {name:<40} {value}")
            for name, value in named(cur, Q_OUTSIDE_SCOPE):
                print(f"  {name:<40} {value}")
            print("\n  Stage A (accepted snapshot, measured offline): 995 signing_raw values,")
            print("  593 containing a parenthetical, 44 of them multi-parenthetical.")

            section("CANDIDATE DERIVATIONS")
            print("  Source text is deliberately NOT printed — it embeds father-son player "
                  "names.\n")
            result = dict(named(cur, build_candidate_query()))
            compared = result["rows_compared"]
            winner = None
            for i, (label, _) in enumerate(CANDIDATES):
                exact = result[f"cand{i}_exact"]
                trimmed = result[f"cand{i}_trimmed"]
                mark = ""
                if exact == compared:
                    mark = "   <== EXACT"
                    winner = winner or label
                print(f"  {label}\n      exact={exact:<5} / {compared}   "
                      f"whitespace-insensitive={trimmed}{mark}")

            section("VERDICT")
            if winner:
                print(f"  {winner} reproduces all {compared} stored values.")
                print("  signing_detail may be frozen as class A on that rule.")
            else:
                print("  No candidate reproduces the stored column.")
                print("  signing_detail stays OPEN and is classified D — NOT imported.")
                print("  That costs nothing: it has zero consumers in src/, and inventing a")
                print("  rule that merely matches the row COUNT would be a guess.")
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()

    print("\nROLLBACK completed — nothing was written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
