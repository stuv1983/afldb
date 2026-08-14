#!/usr/bin/env python3
"""Recover player birth dates from the legacy club player register.

    python tools/migration/enrich_birth_dates.py --dry-run
    python tools/migration/enrich_birth_dates.py

Why this exists
---------------
Only 945 of 13,361 players carry a date of birth, yet the dates for
12,472 of them have been sitting in the legacy database all along. The
AFL Tables club register scraper hit a malformed table header and
collapsed several columns into a single key:

    "DOB HT WT Games (W-D-L) Goals Seasons Debut Last": "1976-08-04"

``club_player_register.dob`` is empty for all 15,310 rows as a result.
``raw_row_json`` kept the payload, which is the only reason this is
recoverable. That is the argument for keeping raw source rows: a parser
bug is survivable, a discarded payload is not.

How players are matched
-----------------------
On the AFL Tables profile URL, never on the name. The register stores it
relative ("../players/A/Andrew_McLeod.html") and the player index stores
it absolute, so both are reduced to a common path. All 15,310 register
rows resolve this way. Names would not do: there are six Peter Browns
and two Ron Barassis, and the index already disambiguates duplicates
with a numeric suffix (Aaron_Black0, Aaron_Black1) that a name match
would collapse.

What it will and will not do
----------------------------
  * Fills only MISSING dates. An existing value is never overwritten.
  * Records every date it sees in player_birth_evidence, including ones
    it does not act on, so the decision can be revisited.
  * Where sources disagree, keeps the existing value, flags the player
    and opens a data_issue. It does not average, prefer or guess.
  * Promotes birth_year/min/max to the real year and marks both
    confidences 'sourced'. Before this pass those columns hold an
    estimate derived from debut season; afterwards they are a fact.

Safe to re-run: evidence is upserted on (player_id, source_id, dob) and
the fill step only touches rows that are still NULL.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg  # noqa: E402

from common import (  # noqa: E402
    Reporter,
    connect_legacy,
    connect_pg,
    import_batch,
    load_env,
    require_env,
    safe_dsn,
)

# The malformed header the scraper produced. Every register column ended
# up under this one key; the DOB is what actually landed in the value.
COLLAPSED_HEADER = "DOB HT WT Games (W-D-L) Goals Seasons Debut Last"

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

SOURCE_KEY = "afltables"

# A date outside this range is a parsing artefact, not a birth date.
EARLIEST_PLAUSIBLE = date(1850, 1, 1)


def normalise_profile_url(url: str | None) -> str | None:
    """Reduce either URL form to a common ``players/A/Name.html`` path.

    The register stores "../players/A/Andrew_McLeod.html"; the player
    index stores "https://afltables.com/afl/stats/players/A/...".
    """
    if not url:
        return None
    path = url.strip().replace("../", "")
    path = re.sub(r"^https?://afltables\.com/afl/stats/", "", path)
    return path.lstrip("/") or None


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


def collect_evidence(
    lite, rep: Reporter
) -> tuple[dict[int, dict[date, int]], dict[int, str], int, int]:
    """Read the register and group asserted birth dates by legacy player id.

    Returns (evidence, profile_urls, rows_read, rows_unmatched).

    profile_urls carries the AFL Tables profile URL each legacy id was
    matched on. Migration 018 defines external_id as that URL, and it is
    the thing the match was actually made on, so it has to be what gets
    stored: a legacy row number is not evidence of anything a later
    reader could check.
    """
    index: dict[str, int] = {}
    profile_urls: dict[int, str] = {}
    for profile_url, legacy_id in lite.execute(
        "SELECT profile_url, player_id FROM afltables_player_index "
        "WHERE profile_url IS NOT NULL AND player_id IS NOT NULL "
        "ORDER BY player_id, profile_url"
    ):
        key = normalise_profile_url(profile_url)
        if key:
            index[key] = legacy_id
            # Deterministic when a legacy id has more than one profile
            # row: ORDER BY above fixes which one wins.
            profile_urls.setdefault(legacy_id, key)

    rep.result("player index entries", len(index))

    evidence: dict[int, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    rows_read = 0
    unmatched = 0

    for player_url, raw_json in lite.execute(
        "SELECT player_url, raw_row_json FROM club_player_register"
    ):
        rows_read += 1
        legacy_id = index.get(normalise_profile_url(player_url))
        if legacy_id is None:
            unmatched += 1
            continue
        if not raw_json:
            continue
        try:
            payload = json.loads(raw_json)
        except (TypeError, ValueError):
            continue
        dob = parse_dob(payload.get(COLLAPSED_HEADER))
        if dob is not None:
            evidence[legacy_id][dob] += 1

    return evidence, profile_urls, rows_read, unmatched


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Recover player birth dates from the legacy club register."
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Report what would change without writing.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    load_env()
    rep = Reporter(verbose=not args.quiet)
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")

    print("AFLDB birth-date enrichment")
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    print()

    lite = connect_legacy()
    pg = connect_pg(dsn)
    started = time.time()

    evidence, profile_urls, rows_read, unmatched = collect_evidence(lite, rep)
    rep.result("register rows read", rows_read)
    if unmatched:
        rep.warn(f"{unmatched} register rows did not resolve to a player index entry")

    # Map legacy ids to AFLDB ids, and note who already has a date.
    with pg.cursor() as cur:
        cur.execute(
            "SELECT legacy_player_id, id, dob FROM players "
            "WHERE legacy_player_id IS NOT NULL"
        )
        players = {legacy: (pid, dob) for legacy, pid, dob in cur.fetchall()}
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
        source_id = cur.fetchone()[0]

    # Classify before writing anything.
    internal_conflicts: list[tuple[int, list[date]]] = []
    to_fill: list[tuple[int, date, int, str]] = []      # afldb_id, dob, occurrences, key
    source_conflicts: list[tuple[int, date, date]] = []  # afldb_id, existing, asserted
    agreements = 0
    unknown_players = 0

    for legacy_id, dates in evidence.items():
        entry = players.get(legacy_id)
        if entry is None:
            unknown_players += 1
            continue
        afldb_id, existing = entry

        if len(dates) > 1:
            # The register itself disagrees. Do not choose.
            internal_conflicts.append((afldb_id, sorted(dates)))
            continue

        asserted, occurrences = next(iter(dates.items()))
        if existing is None:
            to_fill.append((afldb_id, asserted, occurrences, str(legacy_id)))
        elif existing == asserted:
            agreements += 1
        else:
            source_conflicts.append((afldb_id, existing, asserted))

    rep.result("players with evidence", len(evidence))
    rep.result("dates to fill", len(to_fill))
    rep.result("agreements with existing data", agreements)
    if internal_conflicts:
        rep.warn(f"{len(internal_conflicts)} players have conflicting dates within the register")
    if source_conflicts:
        rep.warn(f"{len(source_conflicts)} players conflict with an existing AFLDB date")
        for afldb_id, existing, asserted in source_conflicts:
            rep.warn(f"    player {afldb_id}: existing {existing} vs register {asserted}")
    if unknown_players:
        rep.warn(f"{unknown_players} legacy ids have no AFLDB player")

    if args.dry_run:
        projected = sum(1 for _, (_, dob) in players.items() if dob is not None) + len(to_fill)
        print(f"\nWould raise DOB coverage to {projected} players.")
        print(f"Completed in {time.time() - started:.1f}s")
        pg.close()
        return 0

    with import_batch(pg, SOURCE_KEY, "enrich_birth_dates.py",
                      "player_birth_evidence") as batch:
        batch.records_read = rows_read

        with pg.cursor() as cur:
            # 1. Record ALL evidence, including dates we will not act on.
            #    An upsert keeps the pass re-runnable.
            rows = []
            for legacy_id, dates in evidence.items():
                entry = players.get(legacy_id)
                if entry is None:
                    continue
                afldb_id, _ = entry
                # The profile URL is the durable key migration 018 defines
                # this column as, and the key the match was made on.
                external_id = profile_urls.get(legacy_id)
                if external_id is None:
                    continue
                for dob, occurrences in dates.items():
                    rows.append((
                        afldb_id, source_id, external_id, dob,
                        "club_player_register", "sourced", occurrences, batch.id,
                        "Recovered from raw_row_json; the scraper's parsed dob "
                        "column was empty for every row.",
                    ))
            cur.executemany(
                """INSERT INTO player_birth_evidence
                     (player_id, source_id, external_id, dob, evidence_type,
                      confidence, occurrences, batch_id, notes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (player_id, source_id, dob) DO UPDATE
                     SET occurrences = EXCLUDED.occurrences,
                         batch_id    = EXCLUDED.batch_id,
                         observed_at = now()""",
                rows,
            )
            batch.records_inserted = len(rows)

            # 2. Register the AFL Tables profile URL as an external identity.
            #
            #    The URL is stored, not the legacy row id: the whole point
            #    of match_method = 'afltables_profile_url' is that a later
            #    reader can follow the evidence back to the source.
            #
            #    An existing row pointing at a DIFFERENT player is left
            #    alone. Overwriting it would silently move a player's
            #    identity on re-run; the disagreement is reported below and
            #    adjudicated by a person instead.
            identity_rows = [
                (source_id, profile_urls[legacy], players[legacy][0])
                for legacy in evidence
                if legacy in players and legacy in profile_urls
            ]
            # Nothing truncates external_identities, so rows this pass wrote
            # under the old key (the legacy row id) would otherwise survive
            # alongside the URL-keyed ones and double the count. Remove the
            # rows this pass owns that it is no longer asserting.
            cur.execute(
                """DELETE FROM external_identities
                    WHERE source_id = %s
                      AND match_method = 'afltables_profile_url'
                      AND external_id <> ALL(%s)""",
                (source_id, [ext for _, ext, _ in identity_rows]),
            )

            cur.executemany(
                """INSERT INTO external_identities
                     (source_id, external_id, external_url, player_id, status,
                      match_method, notes)
                   VALUES (%s, %s, %s, %s, 'unique', 'afltables_profile_url',
                           'Matched on profile URL, not name.')
                   ON CONFLICT (source_id, external_id) DO UPDATE
                     SET status       = EXCLUDED.status,
                         match_method = EXCLUDED.match_method,
                         external_url = EXCLUDED.external_url
                   WHERE external_identities.player_id = EXCLUDED.player_id""",
                [(sid, ext, ext, pid) for sid, ext, pid in identity_rows],
            )

            # Anything the upsert declined to touch is a real conflict: the
            # same profile URL already mapped to a different player. Read
            # back what is stored and compare it with what was intended.
            intended = {ext: pid for _, ext, pid in identity_rows}
            cur.execute(
                """SELECT external_id, player_id
                     FROM external_identities
                    WHERE source_id = %s AND external_id = ANY(%s)""",
                (source_id, list(intended)),
            )
            identity_conflicts = [
                (ext, stored, intended[ext])
                for ext, stored in cur.fetchall()
                if stored != intended[ext]
            ]

            for external_id, stored, wanted in identity_conflicts:
                rep.warn(
                    f"    profile {external_id} already maps to player {stored}, "
                    f"not {wanted}; left unchanged"
                )
            cur.executemany(
                """INSERT INTO data_issues
                     (entity_type, entity_id, issue_type, severity,
                      description, details)
                   VALUES ('player', %s, 'external_identity_conflict', 'warning',
                           %s, %s)""",
                [
                    (
                        stored,
                        f"AFL Tables profile {external_id} is already linked to "
                        f"player {stored}; this pass would have linked it to "
                        f"player {wanted}. The existing link was kept.",
                        json.dumps({
                            "external_id": external_id,
                            "stored_player_id": stored,
                            "asserted_player_id": wanted,
                        }),
                    )
                    for external_id, stored, wanted in identity_conflicts
                ],
            )
            if identity_conflicts:
                rep.warn(
                    f"{len(identity_conflicts)} profile URLs already map to another "
                    "player; each is now an open data issue"
                )

            # 3. Fill only what is missing. The WHERE dob IS NULL guard is
            #    what makes "never overwrite" true even if this is re-run
            #    after a manual correction.
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
                 for pid, dob, _, _ in to_fill],
            )
            batch.records_updated = cur.rowcount if cur.rowcount > 0 else len(to_fill)

            # 4. Flag disagreements rather than resolving them.
            disputed = [pid for pid, _, _ in source_conflicts]
            disputed += [pid for pid, _ in internal_conflicts]
            if disputed:
                cur.execute(
                    "UPDATE players SET dob_disputed = true WHERE id = ANY(%s)",
                    (disputed,),
                )

            # Re-running must not stack duplicate issues. Only UNRESOLVED
            # ones this pass owns are cleared; anything already
            # adjudicated is history and stays.
            cur.execute(
                """DELETE FROM data_issues
                    WHERE entity_type = 'player'
                      AND issue_type IN ('dob_conflict', 'dob_internal_conflict')
                      AND resolved_at IS NULL"""
            )

            for afldb_id, existing, asserted in source_conflicts:
                cur.execute(
                    """INSERT INTO data_issues
                         (entity_type, entity_id, issue_type, severity,
                          description, details)
                       VALUES ('player', %s, 'dob_conflict', 'warning', %s, %s)""",
                    (
                        afldb_id,
                        f"Existing date of birth {existing} disagrees with the AFL Tables "
                        f"club register, which reports {asserted}. The existing value has "
                        f"been retained pending adjudication.",
                        json.dumps({
                            "existing": str(existing),
                            "register": str(asserted),
                            "source": SOURCE_KEY,
                            "resolution": "manual review required",
                        }),
                    ),
                )

            for afldb_id, dates in internal_conflicts:
                cur.execute(
                    """INSERT INTO data_issues
                         (entity_type, entity_id, issue_type, severity,
                          description, details)
                       VALUES ('player', %s, 'dob_internal_conflict', 'warning', %s, %s)""",
                    (
                        afldb_id,
                        "The club register asserts more than one date of birth for this "
                        "player across its rows. No date has been applied.",
                        json.dumps({"dates": [str(d) for d in dates]}),
                    ),
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
    lite.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
