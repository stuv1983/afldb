#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B2-1 FOLLOW-UP — bounded read-only evidence for G4/G5/G6 (+ G7 aid).

EVIDENCE ONLY. Zero writes. Separate from `b2_evidence.py` because it asks different
questions of different tables; that runner's results (§30 of the B2 handoff) stand and are
not re-measured.

  FU-A / G5  The approved gate expected 5 linked explicit decisions with 5 stable AFL Tables
             identities. Measured 5 / 2 / 3. AFL Tables is therefore NOT assumed to be the
             only permissible stable identity. This section asks, for those five target
             players only: what stable, reproducible, NON-SURROGATE identity does AFLDB
             actually hold, from ANY tracked source?  It also measures the population base
             rate, because `afldb_dev` is the LEGACY-built database — a low base rate would
             mean 2/5 says more about this database than about the model.

  FU-B / G6  `afldb_normalise_name(display_name_raw)` was rejected (4,926 / 131). Offline
             analysis of the accepted Stage A persons frame found that exactly
             55 + 72 + 4 = 131 display names contain, respectively, a hyphen, an ASCII
             apostrophe, or a non-ASCII letter — and those three classes are disjoint. That
             is precisely the set of inputs `afldb_normalise_name` rewrites. The hypothesis
             is therefore that `name_key` applies NO unaccenting and NO punctuation
             handling: lowercase plus whitespace folding only. Candidates are tested against
             all 5,057 stored values, aggregate counts only, and the mismatch classes are
             cross-tabulated to confirm the mechanism rather than curve-fit it.

  FU-C / G4  `competition` is already CLOSED offline: cumulative Stage A rows through 1989
             are exactly 604 and `data/reference/seasons.json` `league_eras` gives
             VFL 1897-1989 / AFL 1990-. This confirms it against the stored column and, in
             passing, pins that the existing model anchors `competition` on the
             transaction's OWN year — not on a destination season.

  FU-D / G7  One aid, not a decision: the organization behind each resolved club identity.
             `grid-solver.ts` matches `drafted_by_club` at ORGANIZATION grain, so an
             era choice inside one organization is invisible there, while a choice that
             crosses organizations is not.

Egress discipline: aggregate counts and tracked reference vocabulary (club / organization /
source keys, match methods, statuses) only. **No player names, no display text, no surrogate
ids** — not `players.id`, not `draft_picks.id`, not `draft_persons.id`, not `auth_users.id`.

Safety envelope is identical to `b2_evidence.py` / `reconcile_person_bridge.py`:
`AFLDB_OWNER_DATABASE_URL` parsed out of `.env` (never sourced, never printed); DSN path
hard-guarded to `/afldb_dev`; the preserved pre-rebuild database refused by name;
`default_transaction_read_only=on` at connect; `REPEATABLE READ` read-only; in-session
verification of database / read-only / isolation; SELECT only; explicit `ROLLBACK` and a
safe close on success and failure alike.
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

# NBSP folded to a space. DraftGuru separates every name part with U+00A0.
NBSP_FOLDED = "replace(d.display_name_raw, U&'\\00A0', ' ')"

# name_key candidates. C0 is the rejected baseline, kept so the run is self-checking.
NAME_KEY_CANDIDATES = [
    ("C0  afldb_normalise_name(display_name_raw)              [REJECTED baseline]",
     "afldb_normalise_name(d.display_name_raw)"),
    ("C1  lower + NBSP->space + trim",
     f"lower(btrim({NBSP_FOLDED}))"),
    ("C2  lower + NBSP->space + collapse whitespace runs + trim",
     f"lower(btrim(regexp_replace({NBSP_FOLDED}, '\\s+', ' ', 'g')))"),
    ("C3  lower + trim, NBSP left intact",
     "lower(btrim(d.display_name_raw))"),
    ("C4  lower + unaccent + NBSP->space + collapse + trim (no punctuation handling)",
     f"lower(btrim(regexp_replace(public.unaccent({NBSP_FOLDED}), '\\s+', ' ', 'g')))"),
]


# ---------------------------------------------------------------------------
# FU-A — G5: a stable identity for the five explicit `linked` decision targets
# ---------------------------------------------------------------------------

Q_A_BY_SOURCE = """
WITH targets AS (
  SELECT DISTINCT plr.player_id
  FROM player_link_resolutions plr
  WHERE plr.target_table = 'draft_picks' AND plr.action = 'linked'
    AND plr.player_id IS NOT NULL
)
SELECT COALESCE(s.key, '<no external_identities row at all>') AS source_key,
       COALESCE(ei.match_method, '<null>')                    AS match_method,
       COALESCE(ei.status::text, '<null>')                    AS status,
       count(ei.id)                                           AS identity_rows,
       count(DISTINCT t.player_id)                            AS target_players
FROM targets t
LEFT JOIN external_identities ei ON ei.player_id = t.player_id
LEFT JOIN sources s ON s.id = ei.source_id
GROUP BY 1, 2, 3 ORDER BY 5 DESC, 1, 2, 3
"""

Q_A_ROLLUP = """
WITH targets AS (
  SELECT DISTINCT plr.player_id
  FROM player_link_resolutions plr
  WHERE plr.target_table = 'draft_picks' AND plr.action = 'linked'
    AND plr.player_id IS NOT NULL
), scored AS (
  SELECT t.player_id,
         EXISTS (SELECT 1 FROM external_identities ei
                 JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
                 WHERE ei.player_id = t.player_id
                   AND ei.match_method = 'afltables_profile_url'
                   AND ei.status IN ('unique','resolved'))          AS stable_afltables,
         EXISTS (SELECT 1 FROM external_identities ei
                 JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
                 WHERE ei.player_id = t.player_id)                  AS any_afltables_row,
         EXISTS (SELECT 1 FROM external_identities ei
                 WHERE ei.player_id = t.player_id)                  AS any_external_identity,
         EXISTS (SELECT 1 FROM player_match_stats pms
                 WHERE pms.player_id = t.player_id)                 AS has_senior_games
  FROM targets t
)
SELECT count(*)                                              AS linked_target_players,
       count(*) FILTER (WHERE stable_afltables)              AS with_stable_afltables_identity,
       count(*) FILTER (WHERE NOT stable_afltables)          AS without_stable_afltables_identity,
       count(*) FILTER (WHERE any_afltables_row
                          AND NOT stable_afltables)          AS afltables_row_present_but_not_stable,
       count(*) FILTER (WHERE any_external_identity)         AS with_any_external_identity,
       count(*) FILTER (WHERE NOT any_external_identity)     AS with_no_external_identity_at_all,
       count(*) FILTER (WHERE has_senior_games)              AS played_senior_football,
       count(*) FILTER (WHERE NOT has_senior_games)          AS no_senior_games
FROM scored
"""

# Base rate. If this database registers AFL Tables identities for only a fraction of its
# players, "2 of 5" is a property of THIS database, not of the identity model.
Q_A_BASE_RATE = """
SELECT count(*)                                              AS players_total,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM external_identities ei
         JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
         WHERE ei.player_id = p.id
           AND ei.match_method = 'afltables_profile_url'
           AND ei.status IN ('unique','resolved')))          AS with_stable_afltables_identity,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM external_identities ei WHERE ei.player_id = p.id))
                                                             AS with_any_external_identity
FROM players p
"""

Q_A_IDENTITY_POPULATION = """
SELECT s.key AS source_key,
       COALESCE(ei.match_method, '<null>') AS match_method,
       ei.status::text                     AS status,
       count(*)                            AS rows
FROM external_identities ei
JOIN sources s ON s.id = ei.source_id
GROUP BY 1, 2, 3 ORDER BY 4 DESC
"""


# ---------------------------------------------------------------------------
# FU-B — G6: name_key candidates and the mismatch mechanism
# ---------------------------------------------------------------------------

def build_q_b_candidates() -> str:
    filters = ",\n".join(
        f"       count(*) FILTER (WHERE d.name_key = {expr})        AS cand{i}_matches,\n"
        f"       count(*) FILTER (WHERE d.name_key IS DISTINCT FROM {expr}) AS cand{i}_mismatches,\n"
        f"       count(*) FILTER (WHERE {expr} IS NULL)             AS cand{i}_null"
        for i, (_, expr) in enumerate(NAME_KEY_CANDIDATES)
    )
    return f"""
SELECT count(*) AS persons,
{filters}
FROM draft_persons d
JOIN sources s ON s.id = d.source_id AND s.key = 'draftguru'
"""


# Confirms the MECHANISM: the rejected baseline's mismatches should be exactly the names
# afldb_normalise_name rewrites — hyphen, apostrophe, accent. No name is emitted.
Q_B_CLASSES = f"""
WITH p AS (
  SELECT d.name_key,
         d.display_name_raw,
         {NBSP_FOLDED}                                            AS folded,
         (d.name_key IS DISTINCT FROM afldb_normalise_name(d.display_name_raw)) AS baseline_mismatch
  FROM draft_persons d
  JOIN sources s ON s.id = d.source_id AND s.key = 'draftguru'
), c AS (
  SELECT baseline_mismatch,
         (folded LIKE '%-%')              AS has_hyphen,
         (folded LIKE '%''%')             AS has_apostrophe,
         (folded ~ '[^\\x20-\\x7E]')      AS has_non_ascii
  FROM p
)
SELECT count(*)                                                    AS persons,
       count(*) FILTER (WHERE baseline_mismatch)                   AS baseline_mismatches,
       count(*) FILTER (WHERE has_hyphen)                          AS names_with_hyphen,
       count(*) FILTER (WHERE has_apostrophe)                      AS names_with_apostrophe,
       count(*) FILTER (WHERE has_non_ascii)                       AS names_with_non_ascii,
       count(*) FILTER (WHERE has_hyphen OR has_apostrophe OR has_non_ascii)
                                                                   AS names_in_any_rewritten_class,
       count(*) FILTER (WHERE baseline_mismatch
                          AND NOT (has_hyphen OR has_apostrophe OR has_non_ascii))
                                                                   AS mismatch_outside_those_classes,
       count(*) FILTER (WHERE NOT baseline_mismatch
                          AND (has_hyphen OR has_apostrophe OR has_non_ascii))
                                                                   AS in_class_but_matching
FROM c
"""


# ---------------------------------------------------------------------------
# FU-C — G4 competition
# ---------------------------------------------------------------------------

Q_C_COMPETITION = """
SELECT COALESCE(dp.competition, '<NULL>') AS competition,
       count(*)           AS picks,
       min(dp.draft_year) AS first_draft_year,
       max(dp.draft_year) AS last_draft_year
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
GROUP BY 1 ORDER BY 2 DESC
"""

Q_C_MIXED_YEARS = """
SELECT count(*) AS draft_years_carrying_more_than_one_competition
FROM (
  SELECT dp.draft_year
  FROM draft_picks dp
  JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
  GROUP BY dp.draft_year
  HAVING count(DISTINCT dp.competition) > 1
) x
"""


# ---------------------------------------------------------------------------
# FU-D — G7 aid: identity -> organization
# ---------------------------------------------------------------------------

Q_D_ORG = """
SELECT dp.club_name_raw,
       COALESCE(c.slug,  '<club_id IS NULL>') AS club_identity_slug,
       COALESCE(co.slug, '<none>')            AS organization_slug,
       count(*)           AS picks,
       min(dp.draft_year) AS first_year,
       max(dp.draft_year) AS last_year
FROM draft_picks dp
JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
LEFT JOIN clubs c ON c.id = dp.club_id
LEFT JOIN club_organizations co ON co.id = c.organization_id
GROUP BY 1, 2, 3 ORDER BY 1
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
    # params stays None when there are none, so psycopg does no placeholder processing and a
    # literal '%' in a LIKE pattern needs no doubling.
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

            # ---- FU-A / G5 -----------------------------------------------
            section("FU-A / G5 — stable identity for the five explicit `linked` decision targets")
            roll = dict(named(cur, Q_A_ROLLUP))
            for name, value in roll.items():
                print(f"  {name:<42} {value}")
            print("\n  every external_identities row those target players hold "
                  "(aggregate; no ids, no names):")
            cur.execute(Q_A_BY_SOURCE)
            table(cur.fetchall(), ["source_key", "match_method", "status",
                                   "identity_rows", "target_players"])

            print("\n  POPULATION BASE RATE — afldb_dev is the LEGACY-built database, so a low")
            print("  registration rate means 2/5 describes this database, not the identity model:")
            base = dict(named(cur, Q_A_BASE_RATE))
            tot = base["players_total"] or 1
            print(f"    players_total                     {base['players_total']}")
            print(f"    with_stable_afltables_identity    {base['with_stable_afltables_identity']}"
                  f"  ({100.0 * base['with_stable_afltables_identity'] / tot:.2f}%)")
            print(f"    with_any_external_identity        {base['with_any_external_identity']}"
                  f"  ({100.0 * base['with_any_external_identity'] / tot:.2f}%)")
            print("\n  external_identities population by (source, match_method, status):")
            cur.execute(Q_A_IDENTITY_POPULATION)
            table(cur.fetchall(), ["source_key", "match_method", "status", "rows"])

            # ---- FU-B / G6 -----------------------------------------------
            section("FU-B / G6 — name_key candidate derivations (5,057 persons)")
            b = dict(named(cur, build_q_b_candidates()))
            persons = b["persons"]
            print(f"  persons compared: {persons}\n")
            winner = None
            for i, (label, _) in enumerate(NAME_KEY_CANDIDATES):
                m, x, n = b[f"cand{i}_matches"], b[f"cand{i}_mismatches"], b[f"cand{i}_null"]
                flag = ""
                if m == persons and x == 0 and n == 0:
                    flag = "   <== EXACT"
                    winner = winner or label
                print(f"  {label}\n      matches={m:<6} mismatches={x:<6} null={n}{flag}")
            print("\n  mismatch mechanism for the rejected baseline "
                  "(classes afldb_normalise_name rewrites):")
            for name, value in named(cur, Q_B_CLASSES):
                print(f"    {name:<38} {value}")
            if winner:
                print(f"\n  CANDIDATE REPRODUCING ALL {persons}: {winner}")
                print("  G6 may close on this rule once it is stated in the plan. name_key is a "
                      "search/index\n  key and never becomes part of player identity.")
            else:
                print("\n  *** No candidate reproduces all stored values — G6 stays OPEN. "
                      "HALT rather than approximate. ***")

            # ---- FU-C / G4 -----------------------------------------------
            section("FU-C / G4 — `competition` derivation")
            cur.execute(Q_C_COMPETITION)
            table(cur.fetchall(), ["competition", "picks", "first_draft_year", "last_draft_year"])
            for name, value in named(cur, Q_C_MIXED_YEARS):
                print(f"\n  {name} = {value}")
            print("\n  tracked reference: data/reference/seasons.json league_eras — "
                  "VFL 1897-1989, AFL 1990-…")
            print("  offline Stage A: cumulative rows through draft_year 1989 = 604; "
                  "1990+ = 6,206.")
            print("  If the table above reads VFL 1981-1989 / AFL 1990-2025 with 0 mixed years,")
            print("  competition = league_era(draft_year) is EXACT and total — class B.")

            # ---- FU-D / G7 -----------------------------------------------
            section("FU-D / G7 aid — club identity and its organization")
            print("  grid-solver.ts resolves `drafted_by_club` at ORGANIZATION grain")
            print("  (club_id IN (SELECT id FROM clubs WHERE organization_id = ...)), while")
            print("  draft.ts filters and renders at IDENTITY grain (c.slug). An era choice")
            print("  inside one organization is invisible to the solver; one that crosses")
            print("  organizations is not.\n")
            cur.execute(Q_D_ORG)
            table(cur.fetchall(), ["club_name_raw", "club_identity_slug", "organization_slug",
                                   "picks", "first_year", "last_year"])
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()

    print("\nROLLBACK completed — nothing was written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
