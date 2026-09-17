#!/usr/bin/env python3
"""Player dates of birth from the AFL Tables all-time club player lists.

    python tools/migration/enrich_birth_dates_afltables.py --label club-lists-20260905 --validate-only
    python tools/migration/enrich_birth_dates_afltables.py --label club-lists-20260905 --dry-run
    python tools/migration/enrich_birth_dates_afltables.py --label club-lists-20260905

AFLDB-ISSUE-118 Stage D1. The canonical rebuild leaves ``players.dob`` NULL for
~12,400 of 13,273 players: the accepted fitzRoy register drops the DOB column
(``fetch_player_details_afltables`` selects it away) and the legacy recovery path
read an untracked SQLite payload. This loader reads the manifest-pinned snapshot
``tools/rebuild/afltables/acquire_club_lists.R`` captured from the same 21 pages
(``docs/rebuild-manifests/afltables_club_lists/<label>.json``; raw artefacts under
``data/sources/afltables/club_lists/<label>/``) and:

  * verifies every artefact's SHA-256 against the tracked manifest (``--validate-only``
    stops here, offline, for the rebuild's preflight);
  * joins each page row to a canonical player ONLY through ``profile_path`` ->
    ``external_identities`` (source ``afltables``), the identity the fitzRoy stage
    registered; the fitzRoy contract's ``profile_url_continuity`` rules fold a
    tracked renumbered path onto its continuing profile; anything else unresolved is
    reported and refused -- a name is never identity;
  * records every ISO date it sees in ``player_birth_evidence`` (source ``afltables``,
    evidence_type ``afltables_club_list``, external_id = profile_path), including
    the ones it does not act on;
  * fills ``players.dob`` ONLY where it is NULL (``dob_confidence`` = sourced,
    ``dob_evidence_id`` = the evidence row); an existing date is never overwritten,
    and a disagreement is reported (``dob_disputed`` stays the ISSUE-072 mechanism's
    to set through ``data_issues``, which this loader does not write);
  * fails closed on the shape: a page path with two different dates, or a player
    reached from two paths with different dates, is a conflict -- reported, not filled.

Blank DOB cells (a handful of pre-1930 players) are absent evidence, not a date.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import connect_pg, import_batch, load_env, require_env, safe_dsn  # noqa: E402
from import_fitzroy_core import normalise_profile_url, sha256_file  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_ROOT = REPO_ROOT / "data" / "sources" / "afltables" / "club_lists"
MANIFEST_ROOT = REPO_ROOT / "docs" / "rebuild-manifests" / "afltables_club_lists"
CONTRACT_PATH = REPO_ROOT / "tools" / "rebuild" / "afltables" / "afltables-contract.json"
FITZROY_CONTRACT_PATH = REPO_ROOT / "tools" / "rebuild" / "fitzroy" / "fitzroy-contract.json"
SOURCE_KEY = "afltables"
EVIDENCE_TYPE = "afltables_club_list"
TOOL = "enrich_birth_dates_afltables.py"
FAMILY = "club_player_list"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Plausibility, mirroring player_birth_evidence's pbe_plausible_ck and the
# obvious upper bound: nobody debuts before birth.
EARLIEST = date(1850, 1, 1)


def load_manifest(label: str) -> dict:
    path = MANIFEST_ROOT / f"{label}.json"
    if not path.is_file():
        sys.exit(f"ERROR: no tracked manifest for label {label!r} at {path}")
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def verified_files(label: str, snapshot_dir: Path, expected_clubs: int) -> list[tuple[dict, Path]]:
    manifest = load_manifest(label)
    entries = [e for e in manifest.get("files", []) if e.get("dataset") == FAMILY]
    if len(entries) != expected_clubs:
        sys.exit(f"ERROR: manifest {label!r} lists {len(entries)} club artefacts; the contract "
                 f"names {expected_clubs} clubs and a partial capture is not loadable")
    out: list[tuple[dict, Path]] = []
    for entry in entries:
        for key, digest_key in (("filename", "sha256"), ("raw_filename", "raw_sha256")):
            path = snapshot_dir / entry[key]
            if not path.is_file():
                sys.exit(f"ERROR: {label}: {entry[key]} is missing from {snapshot_dir}")
            digest = sha256_file(path)
            if digest != entry.get(digest_key):
                sys.exit(f"ERROR: {label}: {entry[key]} sha256 {digest[:12]}… does not match the "
                         f"tracked manifest ({str(entry.get(digest_key))[:12]}…)")
        out.append((entry, snapshot_dir / entry["filename"]))
    return out


def read_rows(files: list[tuple[dict, Path]], columns: list[str]) -> list[dict]:
    rows: list[dict] = []
    for entry, path in files:
        with path.open(encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            if reader.fieldnames != columns:
                sys.exit(f"ERROR: {path.name}: columns {reader.fieldnames} differ from the contract's")
            club_rows = list(reader)
        if len(club_rows) != int(entry["row_count"]):
            sys.exit(f"ERROR: {path.name}: {len(club_rows)} rows, manifest says {entry['row_count']}")
        rows.extend(club_rows)
    return rows


def parse_dob(raw: str) -> date | None:
    text = (raw or "").replace("\xa0", " ").strip()
    if not text:
        return None
    if not ISO.match(text):
        sys.exit(f"ERROR: DOB {raw!r} is not an ISO date; the page format changed, refusing")
    return date.fromisoformat(text)


def continuity_rules() -> dict[str, str]:
    """renumbered profile path -> continuing profile path, from the fitzRoy contract."""
    with FITZROY_CONTRACT_PATH.open(encoding="utf-8") as fh:
        contract = json.load(fh)
    out: dict[str, str] = {}
    for rule in contract.get("profile_url_continuity", {}).get("rules", []):
        out[normalise_profile_url(rule["renumbered_url"])] = normalise_profile_url(rule["continuing_url"])
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", required=True, help="snapshot label (tracked manifest name)")
    parser.add_argument("--validate-only", action="store_true",
                        help="verify the tracked manifest and every artefact hash, then stop (no database)")
    parser.add_argument("--dry-run", action="store_true", help="reconcile and report; write nothing")
    args = parser.parse_args()
    t0 = time.time()

    with CONTRACT_PATH.open(encoding="utf-8") as fh:
        contract = json.load(fh)["club_player_lists"]
    columns = list(contract["artefact_columns"])
    snapshot_dir = SNAPSHOT_ROOT / args.label
    files = verified_files(args.label, snapshot_dir, len(contract["clubs"]))
    rows = read_rows(files, columns)
    print("AFLDB birth-date enrichment (AFL Tables all-time club lists)")
    print(f"  {args.label}: {len(files)} club artefacts verified, {len(rows):,} rows")
    if args.validate_only:
        print(f"  done (validate only) in {time.time() - t0:.1f}s")
        return 0

    # ---- Fold the pages: one date per profile path, blanks are absent.
    dates_by_path: dict[str, set[date]] = defaultdict(set)
    occurrences: Counter[tuple[str, date]] = Counter()
    blank = 0
    for r in rows:
        path = normalise_profile_url(r["profile_path"])
        d = parse_dob(r["dob"])
        if d is None:
            blank += 1
            dates_by_path.setdefault(path, set())
            continue
        if d < EARLIEST or d > date.today():
            sys.exit(f"ERROR: implausible DOB {d} for {path}; refusing")
        dates_by_path[path].add(d)
        occurrences[(path, d)] += 1
    path_conflicts = sorted(p for p, ds in dates_by_path.items() if len(ds) > 1)
    print(f"  distinct profile paths {len(dates_by_path):,}; blank DOB rows {blank}; "
          f"paths with two dates across clubs {len(path_conflicts)}")

    # ---- Database side.
    load_env()
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    pg = connect_pg(dsn)
    with pg.cursor() as cur:
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
        hit = cur.fetchone()
        if not hit:
            sys.exit(f"ERROR: source {SOURCE_KEY!r} is not registered")
        source_id = hit[0]
        cur.execute("""SELECT ei.external_id, ei.player_id, p.dob
                         FROM external_identities ei JOIN players p ON p.id = ei.player_id
                        WHERE ei.source_id = %s""", (source_id,))
        identity: dict[str, tuple[int, date | None]] = {}
        for ext, pid, dob in cur.fetchall():
            identity[normalise_profile_url(ext)] = (pid, dob)
    print(f"  canonical afltables identities: {len(identity):,}")

    folded = continuity_rules()
    resolved: dict[str, int] = {}
    unresolved: list[str] = []
    via_continuity = 0
    for path in dates_by_path:
        target = path
        if path not in identity and path in folded and folded[path] in identity:
            target = folded[path]
            via_continuity += 1
        if target in identity:
            resolved[path] = identity[target][0]
        else:
            unresolved.append(path)
    print(f"  paths resolved {len(resolved):,} ({via_continuity} through the contract's continuity rules); "
          f"unresolved {len(unresolved)} (reported, never matched by name)")
    for p in sorted(unresolved)[:12]:
        print(f"    unresolved: {p}")
    if len(unresolved) > 12:
        print(f"    … {len(unresolved) - 12} more")

    # ---- Per player: the set of page dates reaching it.
    player_dates: dict[int, set[date]] = defaultdict(set)
    player_paths: dict[int, set[str]] = defaultdict(set)
    for path, pid in resolved.items():
        player_paths[pid].add(path)
        player_dates[pid].update(dates_by_path[path])
    player_conflicts = sorted(pid for pid, ds in player_dates.items() if len(ds) > 1)
    current = {pid: dob for (pid, dob) in identity.values()}
    fill: list[tuple[int, date, str]] = []
    agree = 0
    disagree: list[tuple[int, date, date]] = []
    evidence: list[tuple[int, str, date, int]] = []  # player, path, dob, occurrences
    for pid, ds in player_dates.items():
        for path in sorted(player_paths[pid]):
            for d in sorted(dates_by_path[path]):
                evidence.append((pid, path, d, occurrences[(path, d)]))
        if len(ds) != 1:
            continue
        d = next(iter(ds))
        existing = current.get(pid)
        if existing is None:
            fill.append((pid, d, sorted(player_paths[pid])[0]))
        elif existing == d:
            agree += 1
        else:
            disagree.append((pid, existing, d))
    print(f"  players reached {len(player_dates):,}: fill {len(fill):,} (dob NULL), existing agree {agree:,}, "
          f"existing disagree {len(disagree)} (kept, reported), page-conflict players {len(player_conflicts)} (not filled)")
    for pid, existing, d in disagree:
        print(f"    disagree: player {pid} has {existing}, the club list says {d}")
    for pid in player_conflicts:
        print(f"    conflict: player {pid} reached with dates {sorted(str(x) for x in player_dates[pid])}")
    if path_conflicts:
        for p in path_conflicts[:10]:
            print(f"    path conflict: {p} {sorted(str(x) for x in dates_by_path[p])}")

    if args.dry_run:
        print(f"  done (dry run) in {time.time() - t0:.1f}s")
        return 0

    # ---- Write: evidence for everything seen, fill only NULL.
    #
    # Batched (ISSUE-118 §23.24): the rows go up in two COPYs into ON COMMIT DROP temp
    # tables and land in two set statements, so the stage costs a handful of round trips
    # rather than one per row (the per-row loop took ~28 minutes through the tunnel).
    # Semantics are unchanged: the evidence upsert is keyed (player, source, dob) and a
    # rerun rewrites the same rows; the fill joins each player to ITS OWN evidence row of
    # the same date and touches only players whose dob is still NULL, so a rerun fills 0.
    # Two paths reaching one player with the same date (continuity folding) collapse to
    # one evidence row here — occurrences summed, external_id the first path — where the
    # loop let the last path win; nothing else differs.
    t_write = time.time()
    with import_batch(pg, SOURCE_KEY, TOOL, "players") as batch:
        with pg.cursor() as cur:
            cur.execute("""CREATE TEMP TABLE tmp_birth_evidence
                             (player_id integer NOT NULL, external_id text NOT NULL,
                              dob date NOT NULL, occurrences integer NOT NULL) ON COMMIT DROP""")
            with cur.copy("COPY tmp_birth_evidence (player_id, external_id, dob, occurrences) FROM STDIN") as copy:
                for pid, path, d, occ in evidence:
                    copy.write_row((pid, path, d, occ))
            cur.execute(
                """INSERT INTO player_birth_evidence
                     (player_id, source_id, external_id, dob, evidence_type, confidence, occurrences, batch_id, notes)
                   SELECT t.player_id, %s, min(t.external_id), t.dob, %s, 'sourced', sum(t.occurrences)::integer, %s, %s
                     FROM tmp_birth_evidence t
                    GROUP BY t.player_id, t.dob
                   ON CONFLICT (player_id, source_id, dob) DO UPDATE
                     SET occurrences = EXCLUDED.occurrences, batch_id = EXCLUDED.batch_id,
                         external_id = EXCLUDED.external_id, notes = EXCLUDED.notes""",
                (source_id, EVIDENCE_TYPE, batch.id, f"snapshot {args.label}"),
            )
            evidence_written = cur.rowcount
            expected_evidence = len({(pid, d) for pid, _p, d, _o in evidence})
            if evidence_written != expected_evidence:
                raise RuntimeError(f"evidence upsert wrote {evidence_written} rows, expected {expected_evidence}")

            cur.execute("""CREATE TEMP TABLE tmp_birth_fill
                             (player_id integer PRIMARY KEY, dob date NOT NULL) ON COMMIT DROP""")
            with cur.copy("COPY tmp_birth_fill (player_id, dob) FROM STDIN") as copy:
                for pid, d, _path in fill:
                    copy.write_row((pid, d))
            cur.execute(
                """UPDATE players p
                      SET dob = f.dob, dob_confidence = 'sourced',
                          birth_year = EXTRACT(YEAR FROM f.dob)::smallint,
                          birth_year_min = EXTRACT(YEAR FROM f.dob)::smallint,
                          birth_year_max = EXTRACT(YEAR FROM f.dob)::smallint,
                          birth_year_confidence = 'sourced',
                          dob_evidence_id = e.id
                     FROM tmp_birth_fill f
                     JOIN player_birth_evidence e
                       ON e.player_id = f.player_id AND e.source_id = %s AND e.dob = f.dob
                    WHERE p.id = f.player_id AND p.dob IS NULL""",
                (source_id,),
            )
            filled = cur.rowcount
            # Fail closed on the invariant the gates assume: nothing filled may lack its link.
            cur.execute("SELECT count(*) FROM players WHERE dob IS NOT NULL AND dob_evidence_id IS NULL")
            without_evidence = cur.fetchone()[0]
            if without_evidence:
                raise RuntimeError(f"{without_evidence} players carry a dob with no dob_evidence_id; refusing to commit")
            batch.rows_inserted = evidence_written
            batch.rows_updated = filled
        pg.commit()
    write_seconds = time.time() - t_write

    with pg.cursor() as cur:
        cur.execute("SELECT count(*) FILTER (WHERE dob IS NOT NULL), count(*) FROM players")
        with_dob, total = cur.fetchone()
    print(f"  batch {batch.id}: evidence rows {evidence_written:,}, filled {filled:,} (write {write_seconds:.1f}s); "
          f"players with dob {with_dob:,} / {total:,}; done in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
