#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B2-1 — G5 ONLY: can every explicit `linked` decision be represented?

EVIDENCE ONLY. Zero writes. G2/G3/G4/G6/G7 are CLOSED (B2 handoff §30, §35) and are not
re-measured here.

The question
-----------
Six explicit human/admin decisions exist (5 `linked`, 1 `confirmed_unlinked`). In `afldb_dev`
only 2 of the 5 linked targets hold a stable AFL Tables identity. §16's ledger design names
the target player by its AFL Tables profile path, so as written it cannot carry the other 3.

But `afldb_dev` is the LEGACY-built database. The rebuild path is different, and its rule is
decisive: `import_fitzroy_core.py` builds `players` **only** from fitzRoy `player_stats`
rows, and every such row must carry an ID and a profile URL or the import fails closed
(`PlayerIdentityError`, :713-716). Therefore, on a clean rebuild:

  * a player exists **iff** they have at least one senior player-match row, and
  * every player that exists **necessarily** holds an `afltables_profile_url` identity.

So the three "missing" identities are either (a) a legacy registration gap that the rebuild
closes by itself — in which case §16 works unchanged and no fallback is needed — or (b)
targets that would not exist on a clean rebuild at all, in which case the ledger would have
to seed the player. This runner measures which.

It also runs the G5-C collision/equivalence gates, and the G5-A cross-tab, before any
fallback identity is contemplated.

Egress discipline
-----------------
Aggregate counts and booleans only. **No player names, no display text, no surrogate ids** —
not `players.id`, not `draft_picks.id`, not `draft_persons.id`, not `auth_users.id`, and no
`player_url` or AFL Tables path is ever printed. The joint cross-tab prints boolean tuples
with counts, which is what makes it interpretable without identifying anyone.

Safety envelope — identical to `b2_evidence.py` / `b2_evidence_followup.py` /
`reconcile_person_bridge.py`: `AFLDB_OWNER_DATABASE_URL` parsed out of `.env` (never sourced,
never printed); DSN path hard-guarded to `/afldb_dev`; the preserved pre-rebuild database
refused by name; `default_transaction_read_only=on` at connect; `REPEATABLE READ` read-only;
in-session verification of database / user / read-only / isolation; SELECT only; explicit
`ROLLBACK` and a safe close on success and failure alike.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]

REQUIRED_DB = "afldb_dev"
REQUIRED_PATH = f"/{REQUIRED_DB}"
REFUSED_SUBSTRINGS = ("afldb_test_pre_rebuild",)
ENV_KEY = "AFLDB_OWNER_DATABASE_URL"

# Stage A canonical person identity. Used only as a shape test — never printed.
PLAYER_URL_RE = r"^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$"


# ---------------------------------------------------------------------------
# G5-A — joint cross-tab over the explicit decisions.
#
# One row per decision, reduced to booleans, then grouped. Nothing identifying
# leaves the database.
# ---------------------------------------------------------------------------
Q_CROSSTAB = f"""
WITH observed(player_url, observed_path) AS (
  SELECT * FROM unnest(%s::text[], %s::text[])
), decision AS (
  SELECT plr.action,
         plr.player_id,
         dpk.player_url,
         dpe.player_id AS person_player_id
  FROM player_link_resolutions plr
  JOIN draft_picks   dpk ON dpk.id = plr.target_id
  LEFT JOIN draft_persons dpe ON dpe.id = dpk.draft_person_id
  WHERE plr.target_table = 'draft_picks'
), enriched AS (
  SELECT d.action,
         d.player_id,
         d.player_url,
         -- A. stable AFL Tables identity for the target player
         EXISTS (SELECT 1 FROM external_identities ei
                 JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
                 WHERE ei.player_id = d.player_id
                   AND ei.match_method = 'afltables_profile_url'
                   AND ei.status IN ('unique','resolved'))            AS a_stable_afltables,
         -- B. senior football: the clean-rebuild existence test
         EXISTS (SELECT 1 FROM player_match_stats pms
                 WHERE pms.player_id = d.player_id)                   AS b_senior_games,
         -- proxy for "this player came from the legacy import" — the legacy migration
         -- seeds players.id = legacy_player_id, so NULL marks an admin-created player.
         EXISTS (SELECT 1 FROM players p
                 WHERE p.id = d.player_id AND p.legacy_player_id IS NOT NULL)
                                                                      AS from_legacy_import,
         -- C. an accepted, canonical DraftGuru person identity is available
         (d.player_url IS NOT NULL AND d.player_url ~ '{PLAYER_URL_RE}') AS c_canonical_player_url,
         -- F/G. Stage B1 person-page bridge evidence for this player_url, if any
         EXISTS (SELECT 1 FROM observed o WHERE o.player_url = d.player_url)
                                                                      AS f_in_b1_sample,
         (SELECT o.observed_path FROM observed o
           WHERE o.player_url = d.player_url)                         AS b1_observed_path
  FROM decision d
), classified AS (
  SELECT e.*,
         CASE
           WHEN NOT e.f_in_b1_sample                THEN 'no_b1_evidence'
           WHEN e.b1_observed_path IS NULL          THEN 'b1_observed_no_bridge'
           WHEN EXISTS (SELECT 1 FROM external_identities ei
                        JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
                        WHERE ei.player_id = e.player_id
                          AND ei.external_id = e.b1_observed_path)  THEN 'b1_bridge_agrees'
           WHEN e.a_stable_afltables                THEN 'b1_bridge_CONTRADICTS'
           ELSE 'b1_bridge_present_target_has_none'
         END AS g_bridge_agreement
  FROM enriched e
)
SELECT action,
       a_stable_afltables,
       b_senior_games,
       from_legacy_import,
       c_canonical_player_url,
       g_bridge_agreement,
       count(*) AS decisions
FROM classified
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY 1, 2, 3, 4, 5, 6
"""


# ---------------------------------------------------------------------------
# G5-C — collision and equivalence gates. Zero is the safe value except where noted.
# ---------------------------------------------------------------------------
Q_GATES = """
WITH decision AS (
  SELECT plr.action, plr.player_id, dpk.player_url
  FROM player_link_resolutions plr
  JOIN draft_picks dpk ON dpk.id = plr.target_id
  WHERE plr.target_table = 'draft_picks'
), linked AS (
  SELECT DISTINCT player_id, player_url FROM decision
  WHERE action = 'linked' AND player_id IS NOT NULL AND player_url IS NOT NULL
)
SELECT
  -- UNSAFE: one DraftGuru person claimed by two different canonical players.
  (SELECT count(*) FROM (
     SELECT player_url FROM linked GROUP BY 1 HAVING count(DISTINCT player_id) > 1) x)
                                                          AS url_claimed_by_multiple_players,
  -- NOT automatically unsafe: one human legitimately has several DraftGuru person rows.
  (SELECT count(*) FROM (
     SELECT player_id FROM linked GROUP BY 1 HAVING count(DISTINCT player_url) > 1) x)
                                                          AS player_claimed_by_multiple_urls,
  -- UNSAFE: a decision target with no usable DraftGuru person identity would need a surrogate.
  (SELECT count(*) FROM decision
    WHERE action = 'linked' AND player_url IS NULL)        AS linked_without_player_url,
  (SELECT count(*) FROM decision
    WHERE action = 'confirmed_unlinked' AND player_url IS NULL)
                                                          AS unlinked_without_player_url,
  -- Would a draftguru-sourced fallback identity collide with anything already registered?
  (SELECT count(*) FROM external_identities ei
   JOIN sources s ON s.id = ei.source_id AND s.key = 'draftguru')
                                                          AS existing_draftguru_identity_rows,
  (SELECT count(*) FROM external_identities ei
   JOIN sources s ON s.id = ei.source_id AND s.key = 'draftguru'
   WHERE ei.external_id IN (SELECT player_url FROM linked))
                                                          AS draftguru_rows_already_on_these_urls
"""


# Population context: how completely does THIS database register AFL Tables identities, and
# how does that compare with the linked-decision targets?
Q_BASE_RATE = """
SELECT count(*)                                                  AS players_total,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM external_identities ei
         JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
         WHERE ei.player_id = p.id
           AND ei.match_method = 'afltables_profile_url'
           AND ei.status IN ('unique','resolved')))              AS with_stable_afltables,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM player_match_stats pms WHERE pms.player_id = p.id))
                                                                 AS with_senior_games,
       -- The clean-rebuild population test, applied to the whole table: a player with senior
       -- games but no registered identity is a LEGACY REGISTRATION GAP, not a model gap.
       count(*) FILTER (WHERE EXISTS (
                          SELECT 1 FROM player_match_stats pms WHERE pms.player_id = p.id)
                          AND NOT EXISTS (
                          SELECT 1 FROM external_identities ei
                          JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
                          WHERE ei.player_id = p.id
                            AND ei.match_method = 'afltables_profile_url'
                            AND ei.status IN ('unique','resolved')))
                                                                 AS played_but_unregistered,
       count(*) FILTER (WHERE p.legacy_player_id IS NULL)        AS not_from_legacy_import
FROM players p
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


def load_b1_observations(label: str) -> tuple[list[str], list[str | None]]:
    """Stage B1's accepted observations: player_url -> normalised AFL Tables path or None."""
    path = REPO_ROOT / "data" / "sources" / "draftguru" / label / "parsed" / "person_profile.jsonl"
    if not path.is_file():
        raise SystemExit(f"REFUSED: missing Stage B1 profile output {path}")
    urls: list[str] = []
    paths: list[str | None] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        urls.append(record["player_url"])           # byte-exact, never decoded
        paths.append(record["afltables_identity"])
    if len(set(urls)) != len(urls):
        raise SystemExit("REFUSED: duplicate player_url in the Stage B1 profile output")
    return urls, paths


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
    cur.execute(sql, params)
    row = cur.fetchone()
    return list(zip([d.name for d in cur.description], row))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", default="person-html-20260826",
                        help="accepted Stage B1 snapshot label (profiling oracle only)")
    args = parser.parse_args(argv)

    import psycopg

    urls, paths = load_b1_observations(args.label)
    bridged = sum(1 for p in paths if p)
    print(f"Stage B1 oracle: {len(urls)} persons, {bridged} with a bridge, "
          f"{len(urls) - bridged} without (profiling only — never an import source)")

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

            # ---- G5-A ----------------------------------------------------
            section("G5-A — explicit decisions, joint cross-tab (booleans + counts only)")
            print("  a_stable_afltables      target player holds afltables_profile_url "
                  "(unique/resolved)")
            print("  b_senior_games          target player has >=1 player_match_stats row")
            print("  from_legacy_import      players.legacy_player_id IS NOT NULL "
                  "(false => admin-created)")
            print("  c_canonical_player_url  decision's pick carries a canonical DraftGuru "
                  "player_url")
            print("  g_bridge_agreement      Stage B1 person-page evidence for that "
                  "player_url\n")
            cur.execute(Q_CROSSTAB, (urls, paths))
            rows = cur.fetchall()
            table(rows, ["action", "a_stable_afltables", "b_senior_games", "from_legacy_import",
                         "c_canonical_player_url", "g_bridge_agreement", "decisions"])

            linked_total = sum(r[6] for r in rows if r[0] == "linked")
            linked_stable = sum(r[6] for r in rows if r[0] == "linked" and r[1])
            linked_played = sum(r[6] for r in rows if r[0] == "linked" and r[2])
            linked_admin = sum(r[6] for r in rows if r[0] == "linked" and not r[3])
            contradicts = sum(r[6] for r in rows if r[5] == "b1_bridge_CONTRADICTS")

            print(f"\n  linked decisions                                  {linked_total}")
            print(f"  ... with a stable AFL Tables identity TODAY        {linked_stable}")
            print(f"  ... whose target played senior football            {linked_played}")
            print(f"  ... whose target is NOT from the legacy import     {linked_admin}")
            print(f"  Stage B1 bridge CONTRADICTIONS                     {contradicts}")

            section("CLEAN-REBUILD REPRESENTABILITY — the decisive reading")
            print("  import_fitzroy_core.py builds players ONLY from fitzRoy player_stats rows,")
            print("  and fails closed on any row lacking an ID/profile URL (:713-716). So on a")
            print("  clean rebuild a player exists IFF they played, and every player that exists")
            print("  necessarily holds an afltables_profile_url identity.\n")
            if linked_total and linked_played == linked_total:
                print("  ==> ALL linked targets played senior football.")
                print("      Every one of them would be minted WITH an AFL Tables identity by a")
                print("      clean rebuild. The 'missing' identities are a LEGACY REGISTRATION")
                print("      GAP in afldb_dev, not a model gap. §16's ledger design stands as")
                print("      written and NO DraftGuru fallback identity is required.")
            else:
                print(f"  ==> {linked_total - linked_played} linked target(s) have NO senior "
                      "games in this database.")
                print("      Such a player would NOT be created by a clean rebuild at all, so the")
                print("      ledger cannot link to it — it would have to SEED it. That is a")
                print("      different and larger design question. **HALT** and review before")
                print("      any fallback identity is adopted.")
            if contradicts:
                print("\n  *** A Stage B1 bridge CONTRADICTS an explicit decision. Explicit human")
                print("      authority wins, but the contradiction must be surfaced, never")
                print("      silently overridden. HALT and review. ***")

            # ---- G5-C ----------------------------------------------------
            section("G5-C — collision / equivalence gates")
            gates = dict(named(cur, Q_GATES))
            unsafe = ("url_claimed_by_multiple_players", "linked_without_player_url",
                      "unlinked_without_player_url", "draftguru_rows_already_on_these_urls")
            for name, value in gates.items():
                mark = ""
                if name in unsafe and value:
                    mark = "   <== UNSAFE, HALT"
                elif name == "player_claimed_by_multiple_urls" and value:
                    mark = "   <== not unsafe, but needs a stated deterministic representation"
                print(f"  {name:<40} {value}{mark}")

            # ---- population context --------------------------------------
            section("POPULATION CONTEXT — afldb_dev registration state vs the rebuild model")
            base = dict(named(cur, Q_BASE_RATE))
            tot = base["players_total"] or 1
            for name, value in base.items():
                pct = "" if name == "players_total" else f"  ({100.0 * value / tot:.2f}%)"
                print(f"  {name:<32} {value}{pct}")
            print("\n  `played_but_unregistered` is the size of the legacy registration gap.")
            print("  A clean rebuild has no such category by construction.")
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()

    print("\nROLLBACK completed — nothing was written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
