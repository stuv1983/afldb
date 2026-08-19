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

# How far apart the list's club games/goals may sit from player_clubs
# and still count as "the same career". Zero would be ideal, but the
# list and the stats table were captured at different times.
FACT_TOLERANCE = 2


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
    parser.add_argument("--csv-dir", required=True, type=Path,
                        help="Directory holding the *_All_Time_Player_List.csv files.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would change without writing.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    load_env()
    rep = Reporter(verbose=not args.quiet)
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")

    print("AFLDB birth-date enrichment (all-time club lists)")
    print(f"  target: {safe_dsn(dsn)}")
    print(f"  csvs:   {args.csv_dir}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    print()

    files = [p for p in sorted(args.csv_dir.iterdir()) if p.name in FILE_ORGS]
    missing = sorted(set(FILE_ORGS) - {p.name for p in files})
    if missing:
        rep.warn(f"expected files not found: {', '.join(missing)}")
    if not files:
        sys.exit("ERROR: no recognised club list CSVs in that directory.")

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
    agreements = 0
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
                    agreements += 1
                else:
                    source_conflicts.append((pid, existing, dob, external_id))

        rep.result(f"{org_name}: rows / would fill", file_rows, f"fills {file_filled}")

    rep.result("rows read", rows_read)
    rep.result("dates to fill", len(to_fill))
    rep.result("agreements with existing data", agreements)
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

            # 3. Flag disagreements rather than resolving them -- same
            #    shape as enrich_birth_dates.py, distinct issue payload.
            if source_conflicts:
                cur.execute(
                    "UPDATE players SET dob_disputed = true WHERE id = ANY(%s)",
                    ([pid for pid, _, _, _ in source_conflicts],),
                )
            cur.executemany(
                """INSERT INTO data_issues
                     (entity_type, entity_id, issue_type, severity, description, details)
                   VALUES ('player', %s, 'dob_conflict', 'warning', %s, %s)""",
                [
                    (
                        pid,
                        f"Existing date of birth {existing} disagrees with the all-time "
                        f"club player list, which reports {asserted}. The existing value "
                        f"has been retained pending adjudication.",
                        json.dumps({
                            "existing": str(existing),
                            "club_list": str(asserted),
                            "external_id": ext,
                            "source": SOURCE_KEY,
                            "resolution": "manual review required",
                        }),
                    )
                    for pid, existing, asserted, ext in source_conflicts
                ],
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
