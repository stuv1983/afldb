#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B2-1 — bounded read-only evidence for gaps G2-G6 (+ a G7 supplement).

EVIDENCE ONLY. This runner performs **zero writes**. It answers the derivation questions
the Stage B2 plan (AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md §19-§20) leaves open, so the
column-derivation register can be frozen before any adapter is written.

  G2  event vocabulary  — the exact (draft_type, draft_kind) pairs currently stored, and
                          what the 113 rows whose Stage A page has no `Draft` column
                          (1981 x24, 1982 x24, 1987 x65) were given.
  G3  signing_kind      — is it reproducible as the head of `signing` with the first
                          parenthetical qualifier removed?  Stage A already proves the
                          head set of `signing_raw` is EXACTLY GRID_SIGNING_KINDS (18/18);
                          this measures whether the stored column agrees row by row.
  G4  source loss       — population of weight_kg / competition / grade.
  G5  explicit decisions— do the `linked` explicit human/admin decisions resolve to a
                          player holding a stable AFL Tables external identity, and does
                          their target row still carry a usable natural key?
  G6  name_key          — is draft_persons.name_key exactly the canonical normaliser
                          applied to display_name_raw?  The normaliser is DISCOVERED from
                          the catalogue, never assumed.
  G7  club (supplement) — Stage A closes the club question only as far as tracked data
                          allows (see the handoff).  This adds one aggregate view of how
                          the CURRENT database resolved each DraftGuru club label, as
                          prior-behaviour evidence only — never as authority.

Egress discipline (deliberate, matches the Stage B1 reconciliation runner):

  * aggregate counts and low-cardinality CATEGORICAL vocabulary only;
  * **no** player names, **no** display text, **no** `signing` source text (it embeds
    father-son player names), **no** surrogate ids of any kind — not players.id, not
    draft_picks.id, not draft_persons.id, not auth_users.id;
  * an unexpectedly high-cardinality column reports its cardinality and STOPS rather than
    dumping uncontrolled source text.

Database access is read-only and bounded to one rolled-back transaction, exactly as
`reconcile_person_bridge.py`:

  * ``AFLDB_OWNER_DATABASE_URL`` is parsed out of ``.env`` — the file is never sourced;
  * the URL path is hard-guarded to ``/afldb_dev`` and the preserved pre-rebuild database
    is refused by name;
  * the DSN is never printed;
  * the connection sets ``default_transaction_read_only=on`` at connect time;
  * the transaction is ``REPEATABLE READ`` and read-only, verified in-session against
    ``current_database()``, ``transaction_read_only``, ``default_transaction_read_only``
    and ``transaction_isolation``;
  * only SELECT statements run, then ``ROLLBACK``, on success and on failure alike.
"""

from __future__ import annotations

import argparse
from urllib.parse import urlparse
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]

REQUIRED_DB = "afldb_dev"
REQUIRED_PATH = f"/{REQUIRED_DB}"
REFUSED_SUBSTRINGS = ("afldb_test_pre_rebuild",)
ENV_KEY = "AFLDB_OWNER_DATABASE_URL"

# Stage A years whose annual page has no `Draft` column at all (contract csv_schema_variants A).
NO_DRAFT_COLUMN_YEARS = (1981, 1982, 1987)

# The head of `signing` once the FIRST parenthetical qualifier is removed. Stage A proves
# this reduction maps its 165 distinct signing_raw values onto exactly the 18 values of
# src/search/grid-solver-spec.ts GRID_SIGNING_KINDS, set-equal, no residue either way.
SIGNING_HEAD_SQL = "btrim(regexp_replace(signing, '\\s*\\(.*$', ''))"

# A stable AFL Tables identity, as import_fitzroy_core.py registers it.
AFLTABLES_PATH_RE = "^players/[A-Za-z]/[^/]+\\.html$"

# Printing a source-text vocabulary is allowed only while it stays genuinely categorical.
MAX_VOCAB_PRINT = 30


# ---------------------------------------------------------------------------
# Queries. Every one is a SELECT.
# ---------------------------------------------------------------------------

Q_SOURCE_SPLIT = """
SELECT COALESCE(s.key, '<null source_id — admin-created>') AS source_key, count(*) AS picks
FROM draft_picks dp
LEFT JOIN sources s ON s.id = dp.source_id
GROUP BY 1 ORDER BY 2 DESC
"""

Q_G2_PAIRS = """
SELECT dp.draft_type,
       COALESCE(dp.draft_kind, '<NULL>') AS draft_kind,
       count(*) AS picks,
       min(dp.draft_year) AS first_year,
       max(dp.draft_year) AS last_year
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2
"""

Q_G2_NO_DRAFT_COLUMN = """
SELECT dp.draft_year,
       dp.draft_type,
       COALESCE(dp.draft_kind, '<NULL>') AS draft_kind,
       count(*) AS picks
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
WHERE dp.draft_year = ANY(%s)
GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC, 2, 3
"""

Q_G3_SUMMARY = f"""
SELECT count(*)                                                              AS picks,
       count(dp.signing)                                                     AS signing_present,
       count(dp.signing_kind)                                                AS kind_present,
       count(*) FILTER (WHERE dp.signing IS NOT NULL
                          AND dp.signing_kind IS NULL)                       AS signing_without_kind,
       count(*) FILTER (WHERE dp.signing IS NULL
                          AND dp.signing_kind IS NOT NULL)                   AS kind_without_signing,
       count(*) FILTER (WHERE dp.signing IS NOT NULL AND dp.signing_kind IS NOT NULL
                          AND dp.signing_kind = {SIGNING_HEAD_SQL})          AS head_rule_matches,
       count(*) FILTER (WHERE dp.signing IS NOT NULL AND dp.signing_kind IS NOT NULL
                          AND dp.signing_kind <> {SIGNING_HEAD_SQL})         AS head_rule_mismatches,
       count(DISTINCT dp.signing)                                            AS distinct_signing_values,
       count(dp.signing_detail)                                              AS signing_detail_present
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
"""

# signing_kind is categorical vocabulary (GRID_SIGNING_KINDS), so printing it is safe.
# The `signing` source text is NOT printed anywhere: it embeds father-son player names.
Q_G3_KINDS = """
SELECT COALESCE(dp.signing_kind, '<NULL>') AS signing_kind, count(*) AS picks
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
GROUP BY 1 ORDER BY 2 DESC, 1
"""

Q_G3_MISMATCH_KINDS = f"""
SELECT COALESCE(dp.signing_kind, '<NULL>') AS signing_kind, count(*) AS picks
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
WHERE dp.signing IS NOT NULL AND dp.signing_kind IS NOT NULL
  AND dp.signing_kind <> {SIGNING_HEAD_SQL}
GROUP BY 1 ORDER BY 2 DESC, 1
"""

Q_G4 = """
SELECT count(*)                                                        AS picks,
       count(dp.weight_kg)                                             AS weight_kg_present,
       count(*) FILTER (WHERE dp.competition IS NOT NULL
                          AND btrim(dp.competition) <> '')             AS competition_present,
       count(*) FILTER (WHERE dp.grade IS NOT NULL
                          AND btrim(dp.grade) <> '')                   AS grade_present,
       count(DISTINCT dp.competition)                                  AS competition_distinct,
       count(DISTINCT dp.grade)                                        AS grade_distinct
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
"""

Q_G4_GRADE_VOCAB = """
SELECT dp.grade, count(*) AS picks
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
WHERE dp.grade IS NOT NULL AND btrim(dp.grade) <> ''
GROUP BY 1 ORDER BY 2 DESC, 1
"""

Q_G4_COMPETITION_VOCAB = """
SELECT dp.competition, count(*) AS picks
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
WHERE dp.competition IS NOT NULL AND btrim(dp.competition) <> ''
GROUP BY 1 ORDER BY 2 DESC, 1
"""

# G5. Aggregate authority gate only. No decision, pick, person, player or admin id is
# selected, and no name or note text is selected.
Q_G5 = f"""
WITH decision AS (
  SELECT plr.action,
         plr.player_id,
         dpk.player_url,
         dpk.draft_year,
         dpk.draft_kind,
         dpk.draft_person_id
  FROM player_link_resolutions plr
  JOIN draft_picks dpk ON dpk.id = plr.target_id
  WHERE plr.target_table = 'draft_picks'
), scored AS (
  SELECT d.action,
         EXISTS (
           SELECT 1 FROM external_identities ei
           JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
           WHERE ei.player_id = d.player_id
             AND ei.match_method = 'afltables_profile_url'
             AND ei.status IN ('unique', 'resolved')
             AND ei.external_id ~ '{AFLTABLES_PATH_RE}'
         ) AS has_stable_identity,
         (d.player_url IS NOT NULL AND d.draft_year IS NOT NULL
            AND d.draft_kind IS NOT NULL)              AS natural_key_complete,
         (d.draft_person_id IS NOT NULL)               AS person_resolvable
  FROM decision d
)
SELECT
  count(*)                                                              AS explicit_decisions_total,
  count(*) FILTER (WHERE action = 'linked')                             AS linked_explicit_total,
  count(*) FILTER (WHERE action = 'linked' AND has_stable_identity)     AS linked_with_stable_afltables_identity,
  count(*) FILTER (WHERE action = 'linked' AND NOT has_stable_identity) AS linked_without_stable_afltables_identity,
  count(*) FILTER (WHERE action = 'confirmed_unlinked')                 AS confirmed_unlinked_total,
  count(*) FILTER (WHERE natural_key_complete)                          AS natural_key_complete,
  count(*) FILTER (WHERE NOT natural_key_complete)                      AS natural_key_incomplete,
  count(*) FILTER (WHERE person_resolvable)                             AS target_row_has_person
FROM scored
"""

# G6. The normaliser is discovered, not assumed.
Q_G6_FUNCTIONS = """
SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')' AS fn
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname LIKE '%normalise%name%' OR p.proname LIKE '%normalize%name%'
ORDER BY 1
"""

Q_G6 = """
SELECT count(*)                                                                     AS persons,
       count(*) FILTER (WHERE d.display_name_raw IS NULL
                          OR btrim(d.display_name_raw) = '')                        AS source_null_or_blank,
       count(*) FILTER (WHERE afldb_normalise_name(d.display_name_raw) IS NULL)     AS normaliser_returned_null,
       count(*) FILTER (WHERE d.name_key = afldb_normalise_name(d.display_name_raw)) AS matches,
       count(*) FILTER (WHERE d.name_key IS DISTINCT FROM
                              afldb_normalise_name(d.display_name_raw))             AS mismatches,
       -- Diagnostic only: DraftGuru separates name parts with U+00A0. If the stored key
       -- reproduces only after folding NBSP to a space, the derivation needs that step.
       count(*) FILTER (WHERE d.name_key IS DISTINCT FROM
                              afldb_normalise_name(d.display_name_raw)
                          AND d.name_key = afldb_normalise_name(
                                replace(d.display_name_raw, U&'\\00A0', ' ')))       AS mismatch_explained_by_nbsp
FROM draft_persons d
JOIN sources s ON s.id = d.source_id AND s.key = 'draftguru'
"""

# G7 supplement. Prior behaviour only. Club slugs are tracked reference data, not identity
# surrogates, so naming them is within the egress rule; clubs.id is never selected.
Q_G7 = """
SELECT dp.club_name_raw,
       COALESCE(c.slug, '<UNRESOLVED — club_id IS NULL>') AS resolved_club_slug,
       count(*) AS picks,
       min(dp.draft_year) AS first_year,
       max(dp.draft_year) AS last_year
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
LEFT JOIN clubs c ON c.id = dp.club_id
GROUP BY 1, 2 ORDER BY 1, 3 DESC
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
        print("  (no rows)")
        return
    widths = [max(len(str(h)), max(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    print("  " + "  ".join(str(h).ljust(w) for h, w in zip(headers, widths)))
    print("  " + "  ".join("-" * w for w in widths))
    for row in rows:
        print("  " + "  ".join(str(v).ljust(w) for v, w in zip(row, widths)))


def named(cur, sql, params=None):
    """One-row SELECT returned as (column_name, value) pairs."""
    cur.execute(sql, params or ())
    row = cur.fetchone()
    return list(zip([d.name for d in cur.description], row))


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__.splitlines()[0]).parse_args(argv)

    import psycopg  # imported after argument parsing so --help never needs the driver

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

            # ---- scope ----------------------------------------------------
            section("SCOPE — draft_picks by source")
            cur.execute(Q_SOURCE_SPLIT)
            table(cur.fetchall(), ["source_key", "picks"])

            # ---- G2 -------------------------------------------------------
            section("G2 — event vocabulary: (draft_type, draft_kind) as currently stored")
            cur.execute(Q_G2_PAIRS)
            pairs = cur.fetchall()
            table(pairs, ["draft_type", "draft_kind", "picks", "first_year", "last_year"])
            print(f"\n  distinct (draft_type, draft_kind) pairs: {len(pairs)}")
            print("  Stage A event_type_baseline has 11 values, one of which is the ABSENCE of a "
                  "Draft column\n  (stored as JSON null in parsed/rows.jsonl for 113 rows: "
                  "1981 x24, 1982 x24, 1987 x65).")

            section("G2 — the 113 rows whose Stage A page has no `Draft` column")
            cur.execute(Q_G2_NO_DRAFT_COLUMN, (list(NO_DRAFT_COLUMN_YEARS),))
            table(cur.fetchall(), ["draft_year", "draft_type", "draft_kind", "picks"])

            # ---- G3 -------------------------------------------------------
            section("G3 — signing_kind derivability from the signing source text")
            print("  candidate rule: signing_kind = btrim(regexp_replace(signing, '\\s*\\(.*$', ''))")
            print("  Stage A already proves the head set of signing_raw equals GRID_SIGNING_KINDS "
                  "exactly (18/18).")
            print()
            for name, value in named(cur, Q_G3_SUMMARY):
                print(f"  {name:<28} {value}")
            print("\n  signing_kind vocabulary (categorical — safe to print):")
            cur.execute(Q_G3_KINDS)
            table(cur.fetchall(), ["signing_kind", "picks"])
            cur.execute(Q_G3_MISMATCH_KINDS)
            mismatch_kinds = cur.fetchall()
            if mismatch_kinds:
                print("\n  HEAD-RULE MISMATCHES, by stored signing_kind "
                      "(source text deliberately NOT printed — it embeds player names):")
                table(mismatch_kinds, ["signing_kind", "picks"])
            else:
                print("\n  head-rule mismatches: none")

            # ---- G4 -------------------------------------------------------
            section("G4 — source-loss exposure: weight_kg / competition / grade")
            g4 = dict(named(cur, Q_G4))
            total = g4["picks"] or 1
            for col, key in (("weight_kg", "weight_kg_present"),
                             ("competition", "competition_present"),
                             ("grade", "grade_present")):
                n = g4[key]
                print(f"  {col:<14} present {n:>6} / {g4['picks']:<6} = {100.0 * n / total:6.2f}%")
            print(f"\n  distinct competition values: {g4['competition_distinct']}")
            print(f"  distinct grade values:       {g4['grade_distinct']}")
            print("\n  Stage A comparison (measured offline, accepted snapshot annual-html-20260826):")
            print("    weight_kg   — NO Stage A source field at all")
            print("    competition — NO Stage A source field at all")
            print("    grade       — present under parity_only.grade for 6,093 / 6,810 rows "
                  "(89.47%), 7 distinct values")
            if g4["grade_distinct"] <= MAX_VOCAB_PRINT:
                print("\n  grade vocabulary:")
                cur.execute(Q_G4_GRADE_VOCAB)
                table(cur.fetchall(), ["grade", "picks"])
            else:
                print(f"\n  grade cardinality {g4['grade_distinct']} exceeds {MAX_VOCAB_PRINT} — "
                      "NOT dumping source text (fail closed on egress).")
            if g4["competition_distinct"] <= MAX_VOCAB_PRINT:
                print("\n  competition vocabulary:")
                cur.execute(Q_G4_COMPETITION_VOCAB)
                table(cur.fetchall(), ["competition", "picks"])
            else:
                print(f"\n  competition cardinality {g4['competition_distinct']} exceeds "
                      f"{MAX_VOCAB_PRINT} — NOT dumping source text (fail closed on egress).")

            # ---- G5 -------------------------------------------------------
            section("G5 — explicit human/admin decisions: natural-key authority gate")
            g5 = dict(named(cur, Q_G5))
            for name, value in g5.items():
                print(f"  {name:<42} {value}")
            print("\n  expected safe gate: linked_explicit_total=5, "
                  "linked_with_stable_afltables_identity=5,\n"
                  "                      linked_without_stable_afltables_identity=0, "
                  "confirmed_unlinked_total=1")
            if (g5["linked_explicit_total"] != 5
                    or g5["linked_with_stable_afltables_identity"] != 5
                    or g5["linked_without_stable_afltables_identity"] != 0):
                print("\n  *** G5 GATE NOT MET — HALT. The §16 ledger design must be reviewed "
                      "before export. ***")
            if g5["natural_key_incomplete"]:
                print("\n  *** At least one decision's target row cannot be natural-keyed "
                      "(player_url / draft_year / draft_kind incomplete) — HALT. ***")

            # ---- G6 -------------------------------------------------------
            section("G6 — name_key derivation")
            cur.execute(Q_G6_FUNCTIONS)
            fns = cur.fetchall()
            print("  canonical normaliser(s) discovered in the catalogue:")
            table(fns, ["function"])
            # The comparison names afldb_normalise_name explicitly. If the catalogue does not
            # hold it, say so and move on rather than aborting the transaction and losing G7 —
            # G6 stays OPEN and the plan's assumed derivation is disproved, which is the finding.
            if any(f[0].split("(")[0].endswith("afldb_normalise_name") for f in fns):
                for name, value in named(cur, Q_G6):
                    print(f"  {name:<32} {value}")
            else:
                print("\n  *** afldb_normalise_name is NOT in the catalogue — G6 stays OPEN and "
                      "§20's assumed\n      name_key derivation is disproved. HALT that "
                      "derivation. ***")

            # ---- G7 supplement -------------------------------------------
            section("G7 SUPPLEMENT — how the CURRENT database resolved each DraftGuru club label")
            print("  PRIOR BEHAVIOUR ONLY. import_draft.py resolves clubs best-effort via")
            print("  club_aliases/clubs.name/clubs.short_name and keeps club_name_raw on failure.")
            print("  §19 states that behaviour is NOT automatically carried forward.\n")
            cur.execute(Q_G7)
            table(cur.fetchall(),
                  ["club_name_raw", "resolved_club_slug", "picks", "first_year", "last_year"])
    finally:
        # Rolled back whether every SELECT succeeded or not; the connection is always closed.
        try:
            conn.rollback()
        finally:
            conn.close()

    print("\nROLLBACK completed — nothing was written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
