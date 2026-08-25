#!/usr/bin/env python3
"""Recover player birth dates from AFL Tables all-time club player lists.

    python tools/migration/enrich_birth_dates_from_club_lists.py --csv-dir DIR --dry-run
    python tools/migration/enrich_birth_dates_from_club_lists.py --csv-dir DIR

Why this exists
---------------
enrich_birth_dates.py recovered ~12,000 dates from the legacy club
register, matching on AFL Tables profile URLs. Five clubs were missing
from that register entirely -- Fitzroy, University, Brisbane Bears,
Sydney/South Melbourne and North Melbourne -- and they hold essentially
the whole remaining gap (877 players with no date of birth, 759 of them
Fitzroy). Their all-time player list pages were captured separately as
CSVs:

    Cap,#,Player,DOB,HT,WT,Games (W-D-L),Goals,Seasons,Debut,Last
    714,1,"Murray, Kevin",1938-06-18,178cm,79kg,333 (122-3-208),51,...

How players are matched
-----------------------
There are no profile URLs here, so the match is name-based -- exactly
what the register pass refused to do -- made safe by scoping and
corroboration instead:

  * Candidates are limited to players who actually played for the
    file's club (player_clubs, organization-level so renames fold in:
    South Melbourne rows match the Sydney organization).
  * The name must match the player's search_name (or a recorded alias)
    after the same normalisation the schema applies -- lowercased,
    unaccented, punctuation stripped -- so the CSV's "OLoughlin,
    Michael" meets the database's "michael oloughlin".
  * A unique name match still needs one career fact to agree before a
    date is written: games at that club, goals at that club, or the
    seasons span. A name alone never fills anything.
  * Multiple same-name candidates (fathers and sons) are disambiguated
    by exact games+goals; if that does not settle it, nobody is filled
    and the row is recorded as a rejection.

What it will and will not do
----------------------------
  * Fills only MISSING dates. An existing value is never overwritten.
  * Records every matched date in player_birth_evidence, including ones
    it does not act on, so the decision can be revisited.
  * Where the list disagrees with an existing AFLDB date, keeps the
    existing value, flags the player and opens a data_issue.
  * Unmatched and uncorroborated rows land in import_rejections with
    the full source row, never silently dropped.

Safe to re-run: evidence is upserted on (player_id, source_id, dob) and
the fill step only touches rows that are still NULL.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg  # noqa: E402

from common import (  # noqa: E402
    Reporter,
    connect_pg,
    import_batch,
    load_env,
    require_env,
    safe_dsn,
)

SOURCE_KEY = "afltables"
EVIDENCE_TYPE = "club_all_time_list"

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
EARLIEST_PLAUSIBLE = date(1850, 1, 1)

# File-name stem -> club_organizations.name. The parenthetical in the
# Sydney file names the historical identity; the organization already
# folds South Melbourne in, so the org name is what matters here.
FILE_ORGS = {
    "Brisbane_Bears_-_All_Time_Player_List.csv": "Brisbane Bears",
    "Fitzroy_-_All_Time_Player_List.csv": "Fitzroy",
    "North_Melbourne_-_All_Time_Player_List.csv": "North Melbourne",
    "Sydney(South Melbourne)_-_All_Time_Player_List.csv": "Sydney",
    "University_-_All_Time_Player_List.csv": "University",
}

# AFLDB-ISSUE-093 Sec 4: the canonical source directory for the five
# club-list CSVs. When --csv-dir is omitted, this directory is used and
# all five expected files are required (fail closed on any missing file);
# an explicit --csv-dir keeps the partial/test semantics AFLDB-ISSUE-090's
# suite relies on unless --require-complete is passed.
CANONICAL_CSV_DIR = Path(__file__).resolve().parents[2] / "data" / "sources" / "afltables" / "club_lists"

# Every column the importer reads. A file missing any of these is a
# malformed capture, not a partial source: fail closed before any write.
REQUIRED_HEADERS = ("Cap", "Player", "DOB", "Games (W-D-L)", "Goals", "Seasons")

# How far apart the list's club games/goals may sit from player_clubs
# and still count as "the same career". Zero would be ideal, but the
# list and the stats table were captured at different times.
FACT_TOLERANCE = 2

# AFLDB-ISSUE-090: shared shape for the versioned dob_conflict payload.
# The club-list pass owns the 'club_list' key of disputed_by; the register
# pass (enrich_birth_dates.py) owns 'register'. Neither pass ever writes
# the other's key, and both read resolved history to avoid refiling an
# adjudicated finding (D1). Kept duplicated rather than shared via
# common.py: see AFLDB-ISSUE-090.md Sec 20 for the approved file list.
CLUB_EXTERNAL_ID_RE = re.compile(r"^club-list:([a-z0-9-]+):")


def _club_list_fp(club: str | None, external_id: str | None, asserted, existing) -> tuple:
    return ("club_list", club, external_id, str(asserted), str(existing))


def _register_fp(external_id: str | None, asserted, existing) -> tuple:
    return ("register", external_id, str(asserted), str(existing))


def _expand_resolved_fingerprints(
    rows,
) -> tuple[dict[int, set[tuple]], dict[int, set[tuple]]]:
    """Resolved dob_conflict rows -> per-player fingerprint sets (D1, Sec 6.2).

    Handles all three resolved-history shapes: legacy register (A), legacy
    club-list (B, lossless), and v2 aggregate (C). Returns (full, where a
    shape-A row cannot contribute because it has no external_id -- the
    documented reader asymmetry that ignores external_id on both sides
    when comparing against a shape-A row.
    """
    full: dict[int, set[tuple]] = defaultdict(set)
    register_partial: dict[int, set[tuple]] = defaultdict(set)
    for entity_id, details in rows:
        if not isinstance(details, dict):
            continue
        disputed_by = details.get("disputed_by")
        if isinstance(disputed_by, dict):
            for pass_key, assertions in disputed_by.items():
                if not isinstance(assertions, list):
                    continue
                for a in assertions:
                    if not isinstance(a, dict):
                        continue
                    if "asserted" not in a or "existing_at_detection" not in a:
                        continue
                    if pass_key == "club_list":
                        full[entity_id].add(_club_list_fp(
                            a.get("club"), a.get("external_id"),
                            a["asserted"], a["existing_at_detection"]))
                    elif pass_key == "register":
                        full[entity_id].add(_register_fp(
                            a.get("external_id"), a["asserted"], a["existing_at_detection"]))
        elif "club_list" in details:
            ext = details.get("external_id")
            match = CLUB_EXTERNAL_ID_RE.match(ext or "")
            club = match.group(1) if match else None
            full[entity_id].add(_club_list_fp(club, ext, details.get("club_list"), details.get("existing")))
        elif "register" in details:
            register_partial[entity_id].add((str(details.get("register")), str(details.get("existing"))))
    return full, register_partial


def _assertion_sort_key(a: dict) -> tuple:
    return (a.get("club") or "", a["external_id"], a["asserted"])


def _build_v2_payload(disputed_by: dict) -> str:
    """Deterministic JSON: sorted assertion arrays, sorted keys (Sec 5.1)."""
    cleaned = {}
    for pass_key in ("club_list", "register"):
        assertions = disputed_by.get(pass_key) or []
        if assertions:
            cleaned[pass_key] = sorted(assertions, key=_assertion_sort_key)
    payload = {"version": 2, "disputed_by": cleaned, "resolution": "manual review required"}
    return json.dumps(payload, sort_keys=True)


def _describe_dob_conflict(existing_dob, disputed_by: dict) -> str:
    parts = []
    for a in disputed_by.get("club_list") or []:
        parts.append(f"the {a['club']} all-time club list ({a['external_id']}) reports {a['asserted']}")
    for a in disputed_by.get("register") or []:
        parts.append(f"the AFL Tables club register ({a['external_id']}) reports {a['asserted']}")
    existing_text = str(existing_dob) if existing_dob is not None else "no recorded date"
    return (
        f"Existing date of birth {existing_text} disagrees with "
        + "; ".join(parts)
        + ". The existing value has been retained pending adjudication."
    )


def reconcile_club_list_conflicts(
    pg, processed_file_keys: set[str],
    source_conflicts: list[tuple[int, date, date, str]],
    agreements: list[tuple[int, date, str]],
    to_fill: list[tuple[int, date, str]],
    rejections: list[tuple[str, str, dict]],
) -> set[int]:
    """Sec 10 reconciliation, scoped to this run's processed club files.

    Runs inside the caller's already-open transaction (import_batch). Returns
    the set of player ids whose dob_conflict state changed, for the D5
    dob_disputed recompute -- never a global sweep (Sec 13).
    """
    def file_key_of(ext: str) -> str | None:
        parts = ext.split(":", 2)
        return parts[1] if len(parts) > 1 else None

    conflicts_by_file: dict[str, set[str]] = defaultdict(set)
    agreements_by_file: dict[str, set[str]] = defaultdict(set)
    fills_by_file: dict[str, set[str]] = defaultdict(set)
    rejected_by_file: dict[str, set[str]] = defaultdict(set)
    for pid, existing, asserted, ext in source_conflicts:
        conflicts_by_file[file_key_of(ext)].add(ext)
    for pid, dob, ext in agreements:
        agreements_by_file[file_key_of(ext)].add(ext)
    for pid, dob, ext in to_fill:
        fills_by_file[file_key_of(ext)].add(ext)
    for ext, reason, payload in rejections:
        rejected_by_file[file_key_of(ext)].add(ext)

    with pg.cursor() as cur:
        cur.execute(
            """SELECT entity_id, details FROM data_issues
                WHERE entity_type = 'player' AND issue_type = 'dob_conflict'
                  AND resolved_at IS NOT NULL"""
        )
        resolved_rows = cur.fetchall()
    r_full, _r_register_partial = _expand_resolved_fingerprints(resolved_rows)

    # D1: an identical previously-adjudicated assertion is not refiled.
    mine: dict[int, list[dict]] = defaultdict(list)
    for pid, existing, asserted, ext in source_conflicts:
        club = file_key_of(ext)
        fp = _club_list_fp(club, ext, asserted, existing)
        if fp in r_full.get(pid, set()):
            continue
        mine[pid].append({
            "source": SOURCE_KEY, "club": club, "external_id": ext,
            "asserted": str(asserted), "existing_at_detection": str(existing),
        })

    with pg.cursor() as cur:
        cur.execute(
            """SELECT id, entity_id, details FROM data_issues
                WHERE entity_type = 'player' AND issue_type = 'dob_conflict'
                  AND resolved_at IS NULL
                FOR UPDATE"""
        )
        existing_rows = cur.fetchall()
    by_player = {entity_id: (issue_id, details) for issue_id, entity_id, details in existing_rows}

    # Owned population: fresh evidence this run, plus any existing row
    # carrying a club_list assertion under a file this run processed.
    touched: set[int] = set(mine)
    for entity_id, (_issue_id, details) in by_player.items():
        for a in (details.get("disputed_by") or {}).get("club_list") or []:
            if a.get("club") in processed_file_keys:
                touched.add(entity_id)
                break
    if not touched:
        return set()

    with pg.cursor() as cur:
        cur.execute("SELECT id, dob FROM players WHERE id = ANY(%s)", (list(touched),))
        current_dob = {pid: dob for pid, dob in cur.fetchall()}

    affected: set[int] = set()
    with pg.cursor() as cur:
        for entity_id in touched:
            issue_id, details = by_player.get(entity_id, (None, None))
            disputed_by = (details or {}).get("disputed_by") or {}
            register_assertions = disputed_by.get("register") or []

            new_club_list = []
            for a in disputed_by.get("club_list") or []:
                club = a.get("club")
                ext = a.get("external_id")
                if club not in processed_file_keys:
                    new_club_list.append(a)                       # unprocessed file: no evidence
                elif ext in conflicts_by_file.get(club, set()):
                    continue                                      # superseded by a fresh 'mine' entry
                elif ext in rejected_by_file.get(club, set()):
                    new_club_list.append(a)                       # present but unmatchable: retain
                else:
                    continue                                      # agreed, filled, or vanished: delete
            new_club_list.extend(mine.get(entity_id, []))

            new_disputed_by = {}
            if new_club_list:
                new_disputed_by["club_list"] = new_club_list
            if register_assertions:
                new_disputed_by["register"] = register_assertions

            if not new_disputed_by:
                if issue_id is not None:
                    cur.execute("DELETE FROM data_issues WHERE id = %s", (issue_id,))
                affected.add(entity_id)
                continue

            description = _describe_dob_conflict(current_dob.get(entity_id), new_disputed_by)
            payload = _build_v2_payload(new_disputed_by)
            if issue_id is not None:
                cur.execute(
                    "UPDATE data_issues SET details = %s, description = %s WHERE id = %s",
                    (payload, description, issue_id),
                )
            else:
                cur.execute(
                    """INSERT INTO data_issues
                         (entity_type, entity_id, issue_type, severity, description, details)
                       VALUES ('player', %s, 'dob_conflict', 'warning', %s, %s)""",
                    (entity_id, description, payload),
                )
            affected.add(entity_id)

    return affected


def normalise_name(text: str) -> str:
    """The schema's search_name normalisation: lowercase, unaccented,
    punctuation stripped, whitespace collapsed."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9 ]", "", text.lower().replace("-", " ").replace("'", ""))
    return re.sub(r"\s+", " ", text).strip()


def parse_dob(raw: str | None) -> date | None:
    if not raw:
        return None
    match = ISO_DATE.match(raw.strip())
    if not match:
        return None
    try:
        value = date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None
    return value if value >= EARLIEST_PLAUSIBLE else None


def parse_games(raw: str | None) -> int | None:
    """"164 (54-2-108)" -> 164."""
    if not raw:
        return None
    match = re.match(r"^\s*(\d+)", raw)
    return int(match[1]) if match else None


def parse_goals(raw: str | None) -> int | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        return int(str(raw).strip())
    except ValueError:
        return None


def parse_span(raw: str | None) -> tuple[int, int] | None:
    """"1955-1964, 1967-1974" -> (1955, 1974)."""
    if not raw:
        return None
    years = [int(y) for y in re.findall(r"\b(1[89]\d{2}|20\d{2})\b", raw)]
    return (min(years), max(years)) if years else None


def name_from_csv(raw: str) -> str:
    """"Murray, Kevin" -> "kevin murray" (normalised)."""
    if "," in raw:
        surname, _, given = raw.partition(",")
        full = f"{given.strip()} {surname.strip()}"
    else:
        full = raw.strip()
    return normalise_name(full)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recover player birth dates from all-time club player list CSVs."
    )
    parser.add_argument("--csv-dir", type=Path, default=None,
                        help="Directory holding the *_All_Time_Player_List.csv files "
                             f"(default: the canonical {CANONICAL_CSV_DIR}, which "
                             "requires all five expected files).")
    parser.add_argument("--require-complete", action="store_true",
                        help="Fail if any of the five expected club-list files is "
                             "missing (always on for the canonical directory).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would change without writing.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    # AFLDB-ISSUE-093 Sec 13.4: canonical mode is complete-or-refuse; no
    # file is ever silently substituted or downloaded. Source validation
    # runs before any environment/database access so a bad source set can
    # never reach a write path.
    csv_dir: Path = args.csv_dir if args.csv_dir is not None else CANONICAL_CSV_DIR
    require_complete = args.require_complete or args.csv_dir is None

    if not csv_dir.is_dir():
        sys.exit(f"ERROR: club-list source directory not found: {csv_dir}")
    files = [p for p in sorted(csv_dir.iterdir()) if p.name in FILE_ORGS]
    missing = sorted(set(FILE_ORGS) - {p.name for p in files})
    if missing and require_complete:
        sys.exit(
            "ERROR: expected club-list files missing from "
            f"{csv_dir}: {', '.join(missing)}"
        )
    if not files:
        sys.exit("ERROR: no recognised club list CSVs in that directory.")
    for path in files:
        with path.open(newline="", encoding="utf-8-sig") as fh:
            headers = csv.DictReader(fh).fieldnames or []
        bad = [h for h in REQUIRED_HEADERS if h not in headers]
        if bad:
            sys.exit(
                f"ERROR: {path.name} is missing required column(s): "
                f"{', '.join(bad)}"
            )

    load_env()
    rep = Reporter(verbose=not args.quiet)
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")

    print("AFLDB birth-date enrichment (all-time club lists)")
    print(f"  target: {safe_dsn(dsn)}")
    print(f"  csvs:   {csv_dir}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    print()

    if missing:
        rep.warn(f"expected files not found: {', '.join(missing)}")

    pg = connect_pg(dsn)
    started = time.time()

    with pg.cursor() as cur:
        cur.execute("SELECT id, name FROM club_organizations")
        org_ids = {name: oid for oid, name in cur.fetchall()}
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
        source_id = cur.fetchone()[0]

    # Per-file classification, before writing anything.
    #
    # to_fill / evidence rows: (player_id, dob, external_id)
    to_fill: list[tuple[int, date, str]] = []
    evidence_rows: list[tuple[int, date, str]] = []
    source_conflicts: list[tuple[int, date, date, str]] = []  # pid, existing, asserted, ext
    rejections: list[tuple[str, str, dict]] = []  # external_id, reason, payload
    agreements: list[tuple[int, date, str]] = []  # pid, dob, external_id
    processed_file_keys: set[str] = set()  # AFLDB-ISSUE-090 Sec 7 owned population
    rows_read = 0

    for path in files:
        org_name = FILE_ORGS[path.name]
        org_id = org_ids.get(org_name)
        if org_id is None:
            rep.warn(f"{path.name}: no organization named {org_name!r}; skipped")
            continue

        # Every player who played for this organization, with club-level
        # career facts and every known name form.
        with pg.cursor() as cur:
            cur.execute(
                """SELECT p.id, p.dob, p.search_name,
                          sum(pc.games)::int AS games, sum(pc.goals)::int AS goals,
                          p.debut_season, p.final_season,
                          coalesce(array_agg(DISTINCT a.search_alias)
                                   FILTER (WHERE a.search_alias IS NOT NULL), '{}') AS aliases
                     FROM players p
                     JOIN player_clubs pc ON pc.player_id = p.id
                     JOIN clubs cl ON cl.id = pc.club_id
                     LEFT JOIN player_name_aliases a ON a.player_id = p.id
                    WHERE cl.organization_id = %s
                    GROUP BY p.id""",
                (org_id,),
            )
            roster = cur.fetchall()

        by_name: dict[str, list[tuple]] = {}
        for row in roster:
            names = {row[2], *(row[7] or [])}
            for name in names:
                if name:
                    by_name.setdefault(name, []).append(row)

        file_key = org_name.lower().replace(" ", "-")
        processed_file_keys.add(file_key)
        file_filled = 0
        file_rows = 0

        with path.open(newline="", encoding="utf-8-sig") as fh:
            for record in csv.DictReader(fh):
                rows_read += 1
                file_rows += 1
                external_id = f"club-list:{file_key}:cap{record.get('Cap', '?')}"
                payload = dict(record)

                dob = parse_dob(record.get("DOB"))
                if dob is None:
                    rejections.append((external_id, "no parseable date of birth", payload))
                    continue

                raw_name = (record.get("Player") or "").strip()
                if not raw_name:
                    rejections.append((external_id, "no player name", payload))
                    continue
                name = name_from_csv(raw_name)

                csv_games = parse_games(record.get("Games (W-D-L)"))
                csv_goals = parse_goals(record.get("Goals"))
                csv_span = parse_span(record.get("Seasons"))

                candidates = by_name.get(name, [])

                def facts_agree(row) -> bool:
                    pid, _, _, games, goals, debut, final, _ = row
                    checks = []
                    if csv_games is not None and games is not None:
                        checks.append(abs(csv_games - games) <= FACT_TOLERANCE)
                    if csv_goals is not None and goals is not None:
                        checks.append(abs(csv_goals - goals) <= FACT_TOLERANCE)
                    if csv_span is not None and debut is not None and final is not None:
                        # The club span must sit inside the whole career.
                        checks.append(debut <= csv_span[0] and csv_span[1] <= final)
                    return any(checks)

                def facts_exact(row) -> bool:
                    """Strict test for choosing between same-name players.

                    Games-at-club must match exactly -- that is the
                    discriminator (a 1-game 1927 John Hayes vs a 94-game
                    1961-66 one). Goals and the seasons span only veto
                    when both sides actually know them: the list leaves
                    goals blank for many early players, and requiring it
                    left genuinely separable pairs unresolved.
                    """
                    _, _, _, games, goals, debut, final, _ = row
                    if csv_games is None or games is None or games != csv_games:
                        return False
                    if csv_goals is not None and goals is not None and goals != csv_goals:
                        return False
                    if (csv_span is not None and debut is not None and final is not None
                            and not (debut <= csv_span[0] <= final)):
                        return False
                    return True

                if not candidates:
                    rejections.append((external_id, "no player of this name at this club", payload))
                    continue
                if len(candidates) == 1:
                    chosen = candidates[0]
                    if not facts_agree(chosen):
                        rejections.append((
                            external_id,
                            "name matched but no career fact agrees "
                            f"(list: games={csv_games} goals={csv_goals} span={csv_span}; "
                            f"player {chosen[0]}: games={chosen[3]} goals={chosen[4]} "
                            f"span={chosen[5]}-{chosen[6]})",
                            payload,
                        ))
                        continue
                else:
                    exact = [c for c in candidates if facts_exact(c)]
                    if len(exact) != 1:
                        rejections.append((
                            external_id,
                            f"{len(candidates)} same-name players at this club; "
                            "games+goals did not single one out",
                            payload,
                        ))
                        continue
                    chosen = exact[0]

                pid, existing = chosen[0], chosen[1]
                evidence_rows.append((pid, dob, external_id))
                if existing is None:
                    to_fill.append((pid, dob, external_id))
                    file_filled += 1
                elif existing == dob:
                    agreements.append((pid, dob, external_id))
                else:
                    source_conflicts.append((pid, existing, dob, external_id))

        rep.result(f"{org_name}: rows / would fill", file_rows, f"fills {file_filled}")

    rep.result("rows read", rows_read)
    rep.result("dates to fill", len(to_fill))
    rep.result("agreements with existing data", len(agreements))
    rep.result("rows rejected", len(rejections))
    if source_conflicts:
        rep.warn(f"{len(source_conflicts)} players conflict with an existing AFLDB date")
        for pid, existing, asserted, ext in source_conflicts:
            rep.warn(f"    player {pid}: existing {existing} vs list {asserted} ({ext})")

    if args.dry_run:
        reasons: dict[str, int] = {}
        for _, reason, _ in rejections:
            key = reason.split(" (")[0]
            reasons[key] = reasons.get(key, 0) + 1
        if reasons:
            print("\nRejection reasons:")
            for reason, count in sorted(reasons.items(), key=lambda kv: -kv[1]):
                print(f"    {count:>5}  {reason}")
        print(f"\nCompleted in {time.time() - started:.1f}s")
        pg.close()
        return 0

    with import_batch(pg, SOURCE_KEY, "enrich_birth_dates_from_club_lists.py",
                      "player_birth_evidence") as batch:
        batch.records_read = rows_read
        for external_id, reason, payload in rejections:
            batch.reject(external_id, reason, payload)

        with pg.cursor() as cur:
            # 1. Record ALL matched evidence, acted on or not.
            cur.executemany(
                """INSERT INTO player_birth_evidence
                     (player_id, source_id, external_id, dob, evidence_type,
                      confidence, occurrences, batch_id, notes)
                   VALUES (%s, %s, %s, %s, %s, 'sourced', 1, %s,
                           'All-time club player list; matched on name within the '
                           'club roster, corroborated by games/goals/span.')
                   ON CONFLICT (player_id, source_id, dob) DO UPDATE
                     SET batch_id = EXCLUDED.batch_id,
                         observed_at = now()""",
                [(pid, source_id, ext, dob, EVIDENCE_TYPE, batch.id)
                 for pid, dob, ext in evidence_rows],
            )
            batch.records_inserted = len(evidence_rows)

            # 2. Fill only what is missing. WHERE dob IS NULL keeps
            #    "never overwrite" true even on a re-run after manual
            #    corrections.
            cur.executemany(
                """UPDATE players p
                      SET dob = %s,
                          dob_confidence = 'sourced',
                          birth_year = EXTRACT(YEAR FROM %s::date)::smallint,
                          birth_year_min = EXTRACT(YEAR FROM %s::date)::smallint,
                          birth_year_max = EXTRACT(YEAR FROM %s::date)::smallint,
                          birth_year_confidence = 'sourced',
                          dob_evidence_id = e.id
                     FROM player_birth_evidence e
                    WHERE p.id = %s
                      AND p.dob IS NULL
                      AND e.player_id = p.id AND e.source_id = %s AND e.dob = %s""",
                [(dob, dob, dob, dob, pid, source_id, dob)
                 for pid, dob, _ in to_fill],
            )
            batch.records_updated = cur.rowcount if cur.rowcount > 0 else len(to_fill)

            # 3. Reconcile dob_conflict against this run's processed club
            #    files, scoped and idempotent (AFLDB-ISSUE-090 Sec 7/10).
            #    Replaces the prior unconditional INSERT, which stacked a
            #    duplicate row on every rerun.
            affected = reconcile_club_list_conflicts(
                pg, processed_file_keys, source_conflicts, agreements, to_fill, rejections,
            )

            # D5: recompute dob_disputed only for players this run's
            # reconciliation actually touched -- never a global sweep.
            if affected:
                cur.execute(
                    """UPDATE players p
                          SET dob_disputed = EXISTS (
                                SELECT 1 FROM data_issues d
                                 WHERE d.entity_type = 'player' AND d.entity_id = p.id
                                   AND d.issue_type IN ('dob_conflict', 'dob_internal_conflict')
                                   AND d.resolved_at IS NULL)
                        WHERE p.id = ANY(%s)""",
                    (list(affected),),
                )

        pg.commit()

    with pg.cursor() as cur:
        cur.execute(
            "SELECT count(*) FILTER (WHERE dob IS NOT NULL), count(*) FROM players"
        )
        with_dob, total = cur.fetchone()

    print()
    rep.result("players with a date of birth", with_dob,
               f"of {total} ({with_dob / total * 100:.1f}%)")
    print(f"\nCompleted in {time.time() - started:.1f}s")
    pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
