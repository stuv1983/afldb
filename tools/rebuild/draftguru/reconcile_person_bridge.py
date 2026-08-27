#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B1 FINAL GATE — bounded read-only reconciliation (runbook §30.9).

Question answered: *when AFLDB already holds enough identity evidence to compare a
DraftGuru person with an AFL Tables identity, does the Stage B1 person-page bridge
agree?*  Structural coverage does not prove correctness; a systematically wrong but
well-formed link would pass every other Stage B1 gate.

Input is only the observed Stage B1 pairs

    player_url  ->  normalised AFL Tables path (or none observed)

read offline from the accepted snapshot's ``parsed/person_profile.jsonl``.

Database access is read-only and bounded to one rolled-back transaction:

  * ``AFLDB_OWNER_DATABASE_URL`` is parsed out of ``.env`` — the file is never sourced;
  * the URL path is hard-guarded to ``/afldb_dev`` and the preserved pre-rebuild database
    is refused by name;
  * the connection sets ``default_transaction_read_only=on`` at connect time;
  * the transaction is ``REPEATABLE READ`` and read-only, verified in-session against
    ``current_database()``, ``transaction_read_only`` and ``default_transaction_read_only``;
  * exactly one SELECT runs, then ``ROLLBACK``. Nothing is ever written.

**Egress is aggregate categories and counts only** — no canonical player id, no player
name, no external id, no row detail ever reaches the terminal. Matching is by
``player_url`` and by the normalised AFL Tables path; **names are never used**.

Historical automatic links and explicit human/admin decisions are reported as SEPARATE
provenance classes. An old automatic link is reconciliation evidence, never identity
truth. Nothing here replays, repairs or modifies any link.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]

REQUIRED_DB = "afldb_dev"
REQUIRED_PATH = f"/{REQUIRED_DB}"
REFUSED_SUBSTRINGS = ("afldb_test_pre_rebuild",)
ENV_KEY = "AFLDB_OWNER_DATABASE_URL"

CATEGORY_ORDER = [
    "same",
    "contradicts",
    "absent",
    "not_linked",
    "person_absent",
    "no_bridge_observed_afldb_has_identity",
    "no_bridge_observed",
]

CATEGORY_MEANING = {
    "same": "AFLDB holds an AFL Tables identity for this person and the observed bridge "
            "matches it exactly",
    "contradicts": "AFLDB holds an AFL Tables identity for this person and the observed "
                   "bridge names a DIFFERENT one",
    "absent": "the person is linked to a canonical player, but AFLDB holds no AFL Tables "
              "identity for that player — the bridge is new information",
    "not_linked": "AFLDB knows this DraftGuru person but has no canonical player for it — "
                  "nothing to compare",
    "person_absent": "AFLDB has no draft_persons row for this player_url at all",
    "no_bridge_observed_afldb_has_identity":
        "DraftGuru exposes no AFL Tables link, but AFLDB already holds one",
    "no_bridge_observed": "DraftGuru exposes no AFL Tables link and AFLDB holds none either",
}

RECONCILE_SQL = """
WITH observed(player_url, observed_path) AS (
  SELECT * FROM unnest(%s::text[], %s::text[])
), dg AS (
  SELECT dp.id AS dg_id, dp.player_url, dp.player_id, dp.link_status
  FROM draft_persons dp
  JOIN sources s ON s.id = dp.source_id AND s.key = 'draftguru'
), afl AS (
  SELECT ei.player_id, ei.external_id
  FROM external_identities ei
  JOIN sources s ON s.id = ei.source_id AND s.key = 'afltables'
  WHERE ei.player_id IS NOT NULL AND ei.status IN ('unique','resolved')
), human AS (
  -- Explicit human/admin decisions, deliberately kept separate from automatic links.
  SELECT dpk.draft_person_id AS dg_id,
         count(*) FILTER (WHERE plr.action = 'linked')             AS admin_linked,
         count(*) FILTER (WHERE plr.action = 'confirmed_unlinked') AS admin_unlinked
  FROM player_link_resolutions plr
  JOIN draft_picks dpk ON dpk.id = plr.target_id
  WHERE plr.target_table = 'draft_picks' AND dpk.draft_person_id IS NOT NULL
  GROUP BY dpk.draft_person_id
), j AS (
  SELECT o.observed_path,
         dg.dg_id, dg.player_id, dg.link_status,
         (SELECT count(*) FROM afl WHERE afl.player_id = dg.player_id) AS afldb_identities,
         (SELECT count(*) FROM afl WHERE afl.player_id = dg.player_id
            AND afl.external_id = o.observed_path)                     AS exact_matches,
         COALESCE(h.admin_linked, 0)   AS admin_linked,
         COALESCE(h.admin_unlinked, 0) AS admin_unlinked
  FROM observed o
  LEFT JOIN dg    ON dg.player_url = o.player_url
  LEFT JOIN human h ON h.dg_id = dg.dg_id
)
SELECT
  CASE
    WHEN dg_id IS NULL                                       THEN 'person_absent'
    WHEN player_id IS NULL                                   THEN 'not_linked'
    WHEN observed_path IS NULL AND afldb_identities > 0
                        THEN 'no_bridge_observed_afldb_has_identity'
    WHEN observed_path IS NULL                               THEN 'no_bridge_observed'
    WHEN afldb_identities = 0                                THEN 'absent'
    WHEN exact_matches > 0                                   THEN 'same'
    ELSE 'contradicts'
  END AS category,
  CASE WHEN admin_linked + admin_unlinked > 0 THEN 'explicit_admin_decision'
       ELSE 'automatic_only' END AS provenance,
  COALESCE(link_status::text, 'none') AS afldb_link_status,
  count(*) AS persons
FROM j
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
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


def load_observed(snapshot_dir: Path) -> tuple[list[str], list[str | None]]:
    """The Stage B1 observations: player_url -> normalised AFL Tables path (or None)."""
    path = snapshot_dir / "parsed" / "person_profile.jsonl"
    if not path.is_file():
        raise SystemExit(f"REFUSED: missing Stage B1 profile output {path}")
    urls: list[str] = []
    paths: list[str | None] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        urls.append(record["player_url"])          # byte-exact, never decoded
        paths.append(record["afltables_identity"])
    if len(set(urls)) != len(urls):
        raise SystemExit("REFUSED: duplicate player_url in the profile output")
    return urls, paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", default="person-html-20260826",
                        help="accepted Stage B1 snapshot label")
    args = parser.parse_args(argv)

    import psycopg  # imported after argument parsing so --help never needs the driver

    snapshot_dir = REPO_ROOT / "data" / "sources" / "draftguru" / args.label
    urls, paths = load_observed(snapshot_dir)
    observed_bridges = sum(1 for p in paths if p)
    print(f"observed pairs: {len(urls)} persons, {observed_bridges} with a bridge, "
          f"{len(urls) - observed_bridges} without")

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
            print(f"== identity ==\ndb={db} user={usr} txn_ro={txn_ro} "
                  f"default_ro={default_ro} isolation={iso}")
            if db != REQUIRED_DB:
                raise SystemExit(f"REFUSED: connected to {db!r}, not {REQUIRED_DB!r}")
            if txn_ro != "on" or default_ro != "on":
                raise SystemExit("REFUSED: transaction is not read-only")
            if not iso.startswith("repeatable"):
                raise SystemExit(f"REFUSED: isolation is {iso!r}")

            cur.execute(RECONCILE_SQL, (urls, paths))
            rows = cur.fetchall()
    finally:
        # The transaction is rolled back whether the SELECT succeeded or failed, and the
        # connection is always closed. Nothing is ever committed.
        try:
            conn.rollback()
        finally:
            conn.close()

    by_category: dict[str, int] = {}
    detail: list[tuple[str, str, str, int]] = []
    for category, provenance, link_status, persons in rows:
        by_category[category] = by_category.get(category, 0) + persons
        detail.append((category, provenance, link_status, persons))

    print("\n== reconciliation categories (aggregate only) ==")
    for category in CATEGORY_ORDER:
        if category in by_category:
            print(f"  {category:<38} {by_category[category]:>4}   {CATEGORY_MEANING[category]}")
    unexpected = sorted(set(by_category) - set(CATEGORY_ORDER))
    for category in unexpected:
        print(f"  {category:<38} {by_category[category]:>4}   (UNEXPECTED CATEGORY)")
    print(f"  {'TOTAL':<38} {sum(by_category.values()):>4}")

    print("\n== provenance / link-status breakdown (aggregate only) ==")
    for category, provenance, link_status, persons in sorted(detail):
        print(f"  {category:<38} {provenance:<24} link_status={link_status:<10} {persons:>4}")

    comparable = by_category.get("same", 0) + by_category.get("contradicts", 0)
    contradictions = by_category.get("contradicts", 0)
    rate = (100.0 * contradictions / comparable) if comparable else None
    print("\n== headline ==")
    print(f"  comparable (AFLDB held an identity to check against): {comparable}")
    print(f"  agreement (same): {by_category.get('same', 0)}")
    print(f"  contradictions:   {contradictions}")
    print(f"  contradiction rate: {'n/a' if rate is None else f'{rate:.2f}%'}")
    print(f"  new information (absent): {by_category.get('absent', 0)}")
    print("\nROLLBACK completed — nothing was written.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
