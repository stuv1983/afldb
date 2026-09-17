#!/usr/bin/env python3
"""Record tracked Wikipedia infobox heights as a THIRD height evidence source.

    python tools/migration/enrich_heights_wikipedia.py --validate-only
    python tools/migration/enrich_heights_wikipedia.py --dry-run
    python tools/migration/enrich_heights_wikipedia.py

Why this exists (AFLDB-ISSUE-118 Stage H3)
------------------------------------------
The Gridley external oracle disagrees with the AFL Tables register height
for 83 bridged players. The AFL API season rosters (enrich_heights_afl_api.py)
corroborate one side or the other for those listed from 2012; the players
who retired earlier have no second machine-readable source AFLDB already
acquires. For that adjudication set, and only for it, the Wikipedia
infobox height was transcribed into the tracked artefact
data/players/height-evidence-wikipedia.csv with the article title and
the exact revision it was read from, keyed by the AFL Tables profile URL
path external_identities already holds (never by name).

This is a targeted corroboration set, not a Wikipedia height acquisition:
it says nothing about players outside it and it never fills
players.height_cm. Every row becomes a player_height_evidence row
(source wikipedia, evidence_type wikipedia_infobox_height) so the
oracle's classification can be read from the evidence model.

Fail-closed: a profile path with no canonical identity, a duplicate
profile, an implausible height or a malformed row refuses the whole run.
Safe to re-run: evidence is upserted on (player_id, source_id, height_cm).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    Reporter, connect_pg, import_batch, load_env, require_env, safe_dsn,
)
from enrich_heights import HEIGHT_MAX, HEIGHT_MIN  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CSV = REPO_ROOT / "data" / "players" / "height-evidence-wikipedia.csv"

SOURCE_KEY = "wikipedia"
IDENTITY_SOURCE_KEY = "afltables"
MATCH_METHOD = "afltables_profile_url"
EVIDENCE_TYPE = "wikipedia_infobox_height"
TOOL = "enrich_heights_wikipedia.py"
COLUMNS = ["afltables_profile", "player", "height_cm", "wikipedia_title", "revision_id",
           "revision_timestamp", "infobox_height_raw", "note"]


def read_rows(path: Path) -> list[dict[str, Any]]:
    """The artefact, shape-checked. Any defect refuses the whole file."""
    if not path.is_file():
        sys.exit(f"ERROR: tracked artefact missing: {path}")
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != COLUMNS:
            sys.exit(f"ERROR: {path.name} columns {reader.fieldnames} != {COLUMNS}")
        rows = list(reader)
    seen: set[str] = set()
    for i, row in enumerate(rows, start=2):
        profile = (row["afltables_profile"] or "").strip()
        if not profile.startswith("players/") or not profile.endswith(".html"):
            sys.exit(f"ERROR: {path.name} line {i}: afltables_profile {profile!r} is not a profile path")
        if profile in seen:
            sys.exit(f"ERROR: {path.name} line {i}: duplicate profile {profile}")
        seen.add(profile)
        try:
            height = int(row["height_cm"])
            int(row["revision_id"])
        except ValueError:
            sys.exit(f"ERROR: {path.name} line {i}: height_cm / revision_id must be integers")
        if not HEIGHT_MIN <= height <= HEIGHT_MAX:
            sys.exit(f"ERROR: {path.name} line {i}: height {height} outside {HEIGHT_MIN}-{HEIGHT_MAX}")
        if not (row["wikipedia_title"] or "").strip():
            sys.exit(f"ERROR: {path.name} line {i}: wikipedia_title is blank")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record tracked Wikipedia infobox heights in player_height_evidence "
                    "(corroborating source; never writes players.height_cm).")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--validate-only", action="store_true",
                        help="Check the artefact's shape offline; touch no database.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB height evidence (Wikipedia infobox, tracked adjudication set)")
    rows = read_rows(args.csv)
    rep.step(f"{args.csv.name}: {len(rows)} rows, shape verified")
    if args.validate_only:
        print(f"  done (validate only) in {time.time() - started:.1f}s")
        return 0

    load_env()
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    pg = connect_pg(dsn)
    with pg.cursor() as cur:
        cur.execute("SELECT key, id FROM sources WHERE key IN (%s, %s)",
                    (SOURCE_KEY, IDENTITY_SOURCE_KEY))
        source_ids = dict(cur.fetchall())
        cur.execute(
            """SELECT ei.external_id, ei.player_id, p.height_cm
                 FROM external_identities ei JOIN players p ON p.id = ei.player_id
                WHERE ei.source_id = %s AND ei.match_method = %s
                  AND ei.status IN ('unique', 'resolved')""",
            (source_ids[IDENTITY_SOURCE_KEY], MATCH_METHOD))
        by_profile = {path: (pid, h) for path, pid, h in cur.fetchall()}

    resolved: list[tuple[int, dict[str, Any]]] = []
    unresolved: list[str] = []
    for row in rows:
        hit = by_profile.get(row["afltables_profile"].strip())
        if hit is None:
            unresolved.append(row["afltables_profile"])
        else:
            resolved.append((hit[0], row))
    rep.result("profiles resolved to a canonical player", len(resolved))
    rep.result("profiles with no canonical identity on this database", len(unresolved))
    if unresolved:
        # The set is small and hand-checked: an unresolvable key is a defect in
        # the artefact or a database without that identity, never a skip.
        sys.exit("ERROR: refusing to write with unresolved profiles: "
                 + ", ".join(unresolved[:10]))
    agree = sum(1 for pid, row in resolved if by_profile[row["afltables_profile"].strip()][1] == int(row["height_cm"]))
    rep.result("agree with the canonical (AFL Tables) height", agree)
    rep.result("differ from the canonical height", len(resolved) - agree)
    summary = {"rows": len(rows), "resolved": len(resolved), "agree": agree,
               "differ": len(resolved) - agree, "dry_run": bool(args.dry_run)}
    if args.dry_run:
        print(f"  done (dry run) in {time.time() - started:.1f}s")
        return 0

    with import_batch(pg, SOURCE_KEY, TOOL, "player_height_evidence") as batch:
        batch.records_read = len(rows)
        evidence = [(pid, source_ids[SOURCE_KEY], row["wikipedia_title"].strip(), int(row["height_cm"]),
                     EVIDENCE_TYPE, "sourced", 1, batch.id,
                     f"Wikipedia infobox height, article {row['wikipedia_title'].strip()!r} revision "
                     f"{row['revision_id']} ({row['revision_timestamp']}); raw {row['infobox_height_raw']!r}; "
                     f"identity via AFL Tables profile {row['afltables_profile'].strip()}.")
                    for pid, row in resolved]
        with pg.cursor() as cur:
            cur.executemany(
                """INSERT INTO player_height_evidence
                     (player_id, source_id, external_id, height_cm, evidence_type,
                      confidence, occurrences, batch_id, notes)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (player_id, source_id, height_cm) DO UPDATE
                     SET notes = EXCLUDED.notes, external_id = EXCLUDED.external_id,
                         batch_id = EXCLUDED.batch_id, observed_at = now()""",
                evidence)
        batch.records_inserted += len(evidence)
    with pg.cursor() as cur:
        cur.execute("UPDATE import_batches SET validation_result = %s WHERE id = %s",
                    (json.dumps(summary), batch.id))
    pg.commit()
    print(f"  batch {batch.id}: evidence rows {len(evidence)}; done in {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
