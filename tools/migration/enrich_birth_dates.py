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
    check_population_drop,
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

# AFLDB-ISSUE-090: shared shape for the versioned dob_conflict payload.
# This pass owns the 'register' key of disputed_by; the club-list pass
# (enrich_birth_dates_from_club_lists.py) owns 'club_list'. Neither pass
# ever writes the other's key, and both read resolved history to avoid
# refiling an adjudicated finding (D1). Kept duplicated rather than shared
# via common.py: see AFLDB-ISSUE-090.md Sec 20 for the approved file list.
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
    club-list (B, lossless), and v2 aggregate (C). A shape-A row cannot
    contribute to the full set because it has no external_id -- the
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


def reconcile_register_conflicts(
    pg,
    to_fill: list[tuple[int, date, int, str]],
    source_conflicts: list[tuple[int, date, date, str | None]],
    internal_conflicts: list[tuple[int, list[date]]],
    agreements: list[tuple[int, date, str | None]],
) -> set[int]:
    """Sec 8/10 reconciliation, scoped to this run's resolved population.

    Owned population = every AFLDB player this run actually produced
    evidence for (to_fill/source_conflicts/internal_conflicts/agreements).
    A player carrying a register assertion but touched by none of those is
    left alone -- absence from the resolved population is not authoritative
    cessation (Sec 8). Runs inside the caller's already-open transaction.
    Returns the set of player ids whose dob issue state changed, for the D5
    dob_disputed recompute -- never a global sweep (Sec 13).
    """
    owned: set[int] = set()
    owned.update(pid for pid, *_ in to_fill)
    owned.update(pid for pid, *_ in source_conflicts)
    owned.update(pid for pid, *_ in internal_conflicts)
    owned.update(pid for pid, *_ in agreements)
    if not owned:
        return set()

    with pg.cursor() as cur:
        cur.execute(
            """SELECT entity_id, details FROM data_issues
                WHERE entity_type = 'player' AND issue_type = 'dob_conflict'
                  AND resolved_at IS NOT NULL"""
        )
        resolved_rows = cur.fetchall()
    r_full, r_register_partial = _expand_resolved_fingerprints(resolved_rows)

    # D1, with the documented shape-A asymmetry: a shape-A resolved row
    # carries no external_id, so suppression there ignores it on both
    # sides (Sec 6.2).
    mine: dict[int, dict] = {}
    for pid, existing, asserted, ext in source_conflicts:
        fp = _register_fp(ext, asserted, existing)
        if fp in r_full.get(pid, set()):
            continue
        if (str(asserted), str(existing)) in r_register_partial.get(pid, set()):
            continue
        mine[pid] = {
            "source": SOURCE_KEY, "external_id": ext,
            "asserted": str(asserted), "existing_at_detection": str(existing),
        }

    with pg.cursor() as cur:
        cur.execute(
            """SELECT id, entity_id, details FROM data_issues
                WHERE entity_type = 'player' AND issue_type = 'dob_conflict'
                  AND resolved_at IS NULL AND entity_id = ANY(%s)
                FOR UPDATE""",
            (list(owned),),
        )
        existing_rows = cur.fetchall()
    by_player = {entity_id: (issue_id, details) for issue_id, entity_id, details in existing_rows}

    with pg.cursor() as cur:
        cur.execute("SELECT id, dob FROM players WHERE id = ANY(%s)", (list(owned),))
        current_dob = {pid: dob for pid, dob in cur.fetchall()}

    affected: set[int] = set()
    with pg.cursor() as cur:
        for pid in owned:
            issue_id, details = by_player.get(pid, (None, None))
            disputed_by = (details or {}).get("disputed_by") or {}
            club_list_assertions = disputed_by.get("club_list") or []  # never touched by this pass

            register_assertion = mine.get(pid)
            new_disputed_by = {}
            if club_list_assertions:
                new_disputed_by["club_list"] = club_list_assertions
            if register_assertion is not None:
                new_disputed_by["register"] = [register_assertion]

            if not new_disputed_by:
                if issue_id is not None:
                    cur.execute("DELETE FROM data_issues WHERE id = %s", (issue_id,))
                affected.add(pid)
                continue

            description = _describe_dob_conflict(current_dob.get(pid), new_disputed_by)
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
                    (pid, description, payload),
                )
            affected.add(pid)

        # dob_internal_conflict: scoped delete-then-refile over the same
        # owned population (Sec 10 step 6 / Sec 9) -- single writer, no
        # aggregation need, the import-first-kick-goal.ts:1305-1312 idiom.
        cur.execute(
            """DELETE FROM data_issues
                WHERE entity_type = 'player' AND issue_type = 'dob_internal_conflict'
                  AND resolved_at IS NULL AND entity_id = ANY(%s)""",
            (list(owned),),
        )
        for pid, dates in internal_conflicts:
            cur.execute(
                """INSERT INTO data_issues
                     (entity_type, entity_id, issue_type, severity, description, details)
                   VALUES ('player', %s, 'dob_internal_conflict', 'warning', %s, %s)""",
                (
                    pid,
                    "The club register asserts more than one date of birth for this "
                    "player across its rows. No date has been applied.",
                    json.dumps({"dates": [str(d) for d in dates]}, sort_keys=True),
                ),
            )
            affected.add(pid)

    return affected


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
    # AFLDB-ISSUE-092: --source-key scopes every read/write/delete to one
    # sources row, so a test/partial invocation can be structurally
    # contained away from the real population. --acknowledge-population-drop
    # is the explicit per-invocation bypass for the Sec 4 threshold check.
    parser.add_argument("--source-key", default=SOURCE_KEY,
                        help=f"sources.key to attribute this run to (default: {SOURCE_KEY}).")
    parser.add_argument("--acknowledge-population-drop", action="store_true",
                        help="Explicitly permit an external_identities drop above the "
                             "fail-closed population-sanity threshold (AFLDB-ISSUE-092).")
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
        cur.execute("SELECT id FROM sources WHERE key = %s", (args.source_key,))
        source_row = cur.fetchone()
        if source_row is None:
            sys.exit(f"ERROR: no sources row with key {args.source_key!r}.")
        source_id = source_row[0]

    # Classify before writing anything.
    internal_conflicts: list[tuple[int, list[date]]] = []
    to_fill: list[tuple[int, date, int, str]] = []      # afldb_id, dob, occurrences, key
    source_conflicts: list[tuple[int, date, date, str | None]] = []  # afldb_id, existing, asserted, external_id
    agreements: list[tuple[int, date, str | None]] = []  # afldb_id, asserted, external_id
    unknown_players = 0

    for legacy_id, dates in evidence.items():
        entry = players.get(legacy_id)
        if entry is None:
            unknown_players += 1
            continue
        afldb_id, existing = entry
        external_id = profile_urls.get(legacy_id)

        if len(dates) > 1:
            # The register itself disagrees. Do not choose.
            internal_conflicts.append((afldb_id, sorted(dates)))
            continue

        asserted, occurrences = next(iter(dates.items()))
        if existing is None:
            to_fill.append((afldb_id, asserted, occurrences, str(legacy_id)))
        elif existing == asserted:
            agreements.append((afldb_id, asserted, external_id))
        else:
            source_conflicts.append((afldb_id, existing, asserted, external_id))

    rep.result("players with evidence", len(evidence))
    rep.result("dates to fill", len(to_fill))
    rep.result("agreements with existing data", len(agreements))
    if internal_conflicts:
        rep.warn(f"{len(internal_conflicts)} players have conflicting dates within the register")
    if source_conflicts:
        rep.warn(f"{len(source_conflicts)} players conflict with an existing AFLDB date")
        for afldb_id, existing, asserted, _ext in source_conflicts:
            rep.warn(f"    player {afldb_id}: existing {existing} vs register {asserted}")
    if unknown_players:
        rep.warn(f"{unknown_players} legacy ids have no AFLDB player")

    if args.dry_run:
        projected = sum(1 for _, (_, dob) in players.items() if dob is not None) + len(to_fill)
        print(f"\nWould raise DOB coverage to {projected} players.")
        print(f"Completed in {time.time() - started:.1f}s")
        pg.close()
        return 0

    with import_batch(pg, args.source_key, "enrich_birth_dates.py",
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
            #
            # AFLDB-ISSUE-092 Sec 4: that delete is correct only if this
            # run's register is the complete population, which nothing above
            # proves. Fail closed, before any delete, when the asserted
            # population is empty or would drop more than the threshold of
            # the stored population; import_batch's rollback-on-exception
            # leaves nothing half-applied.
            asserted_ids = [ext for _, ext, _ in identity_rows]
            cur.execute(
                """SELECT count(*),
                          count(*) FILTER (WHERE external_id <> ALL(%s::text[]))
                     FROM external_identities
                    WHERE source_id = %s
                      AND match_method = 'afltables_profile_url'""",
                (asserted_ids, source_id),
            )
            stored_count, candidate_delete_count = cur.fetchone()
            check_population_drop(
                stored_count=stored_count,
                asserted_count=len(identity_rows),
                candidate_delete_count=candidate_delete_count,
                label=f"external_identities ({args.source_key}/afltables_profile_url)",
                acknowledged=args.acknowledge_population_drop,
                reporter=rep,
            )
            cur.execute(
                """DELETE FROM external_identities
                    WHERE source_id = %s
                      AND match_method = 'afltables_profile_url'
                      AND external_id <> ALL(%s::text[])""",
                (source_id, asserted_ids),
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

            # 4. Reconcile dob_conflict/dob_internal_conflict against this
            #    run's resolved population, scoped and idempotent
            #    (AFLDB-ISSUE-090 Sec 8/10). Replaces the prior unscoped
            #    DELETE, which erased unresolved club-list findings it did
            #    not own.
            affected = reconcile_register_conflicts(
                pg, to_fill, source_conflicts, internal_conflicts, agreements,
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
    lite.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
