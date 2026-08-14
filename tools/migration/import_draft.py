#!/usr/bin/env python3
"""Import the draft source, retaining every row including unresolved ones.

    python tools/migration/import_draft.py --dry-run
    python tools/migration/import_draft.py

All 6,810 rows are imported. None is dropped for being unmatched: a
draft row is a fact about the draft, whether or not the person can be
tied to an AFLDB player.

Identity is resolved once per PERSON
------------------------------------
The source describes 5,057 people across 6,810 rows — a person recurs
when they are drafted, delisted, re-drafted, traded or signed. Matching
each row independently would let the same person be linked in one row
and unlinked in the next. Rows therefore carry only the transaction, and
identity hangs off draft_persons, keyed on DraftGuru's own person id.

The unmatched rows are not one problem
--------------------------------------
    1,555 rows  report zero senior games. These people were drafted and
                never played, so having no AFLDB player is CORRECT —
                AFLDB contains players who appeared. Not a backlog.

      109 rows  across 85 people report senior games. The person played,
                so an AFLDB player should exist. Flagged
                is_matching_backlog for deliberate work.

Nothing is matched fuzzily. Only link states the source itself treats as
certain ('unique', 'resolved') are carried across, and the schema
refuses to store a trusted status without a player. Improving the
remaining matches is a candidate-generation exercise — club, era, career
span, games and goals, then human review — not a similarity threshold.

Idempotent: truncates and reloads both tables.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    Reporter,
    analyze,
    clean_text,
    connect_legacy,
    connect_pg,
    copy_rows,
    import_batch,
    load_env,
    require_env,
    safe_dsn,
    to_int,
    truncate,
)

SOURCE_KEY = "draftguru"

# Link states the SOURCE considers certain. Anything else is retained
# with player_id NULL rather than guessed at.
TRUSTED = ("unique", "resolved")

DRAFT_QUERY = """
SELECT d.rowid            AS draft_rowid,
       d.dg_person_id,
       d.player_url,
       d.player,
       d.name_key,
       d.draft_year,
       d.draft_type,
       d.draft_kind,
       d.pick,
       d.pick_note,
       d.club,
       d.original_club,
       d.draft_age,
       d.height_cm,
       d.weight_kg,
       d.grade,
       d.competition,
       d.signing,
       d.signing_kind,
       d.signing_detail,
       d.detail,
       d.games,
       d.goals,
       l.player_id,
       l.match_status,
       l.match_method,
       l.candidate_count,
       l.confidence_notes
  FROM draft d
  LEFT JOIN draft_links l ON l.draft_rowid = d.rowid
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Import draft picks and draft people.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    load_env()
    rep = Reporter(verbose=not args.quiet)
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")

    print("AFLDB draft import")
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    print()

    lite = connect_legacy()
    pg = connect_pg(dsn)
    started = time.time()

    rows = [dict(zip([c[0] for c in cur.description], r))
            for cur in [lite.execute(DRAFT_QUERY)]
            for r in cur.fetchall()]
    rep.result("draft rows read", len(rows))

    # Map legacy player ids to AFLDB ids, and club names to identities.
    with pg.cursor() as cur:
        cur.execute("SELECT legacy_player_id, id FROM players "
                    "WHERE legacy_player_id IS NOT NULL")
        players = dict(cur.fetchall())
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
        source_id = cur.fetchone()[0]
        # Club resolution is best-effort: an unresolved club name is kept
        # as club_name_raw rather than dropping the row.
        cur.execute("""
            SELECT lower(alias), club_id FROM club_aliases
            UNION ALL SELECT lower(name), id FROM clubs
            UNION ALL SELECT lower(short_name), id FROM clubs
        """)
        clubs = dict(cur.fetchall())

    # ---- Fold rows into people -------------------------------------
    people: dict[int, dict] = {}
    for row in rows:
        dg = row["dg_person_id"]
        if dg is None:
            continue
        person = people.setdefault(dg, {
            "dg_person_id": dg,
            "player_url": row["player_url"],
            "display_name_raw": row["player"],
            "name_key": row["name_key"],
            "player_id": None,
            "link_status": "unmatched",
            "candidate_count": 0,
            "match_method": None,
            "confidence_notes": None,
            "reported_games": 0,
            "reported_goals": 0,
        })

        person["reported_games"] = max(person["reported_games"],
                                       to_int(row["games"]) or 0)
        person["reported_goals"] = max(person["reported_goals"],
                                       to_int(row["goals"]) or 0)

        status = (row["match_status"] or "unmatched").strip()
        legacy_pid = row["player_id"]
        afldb_pid = players.get(legacy_pid) if legacy_pid is not None else None

        # A trusted link on ANY of the person's rows resolves the person.
        # Rows disagreeing is exactly the inconsistency this prevents.
        if status in TRUSTED and afldb_pid is not None and person["player_id"] is None:
            person["player_id"] = afldb_pid
            person["link_status"] = status
            person["match_method"] = clean_text(row["match_method"])
            person["confidence_notes"] = clean_text(row["confidence_notes"])
        elif person["player_id"] is None and status in ("ambiguous", "implausible"):
            # Keep the more informative unlinked state.
            person["link_status"] = status
            person["candidate_count"] = to_int(row["candidate_count"]) or 0
            person["match_method"] = clean_text(row["match_method"])
            person["confidence_notes"] = clean_text(row["confidence_notes"])

    for person in people.values():
        person["is_matching_backlog"] = (
            person["player_id"] is None and person["reported_games"] > 0
        )

    linked = sum(1 for p in people.values() if p["player_id"] is not None)
    backlog = sum(1 for p in people.values() if p["is_matching_backlog"])
    rep.result("people", len(people))
    rep.result("people linked to a player", linked)
    rep.result("matching backlog (played, unlinked)", backlog)
    rep.result("correctly unlinked (never played)",
               len(people) - linked - backlog)

    status_counts: dict[str, int] = {}
    for row in rows:
        key = (row["match_status"] or "unmatched").strip()
        status_counts[key] = status_counts.get(key, 0) + 1
    for key in sorted(status_counts, key=lambda k: -status_counts[k]):
        rep.result(f"  rows {key}", status_counts[key])

    if args.dry_run:
        print(f"\nCompleted in {time.time() - started:.1f}s")
        pg.close()
        return 0

    with import_batch(pg, SOURCE_KEY, "import_draft.py", "draft_picks") as batch:
        batch.records_read = len(rows)

        # draft_picks references draft_persons, so it goes first.
        truncate(pg, "draft_picks", "draft_persons")

        copy_rows(
            pg, "draft_persons",
            ("source_id", "dg_person_id", "player_url", "display_name_raw",
             "name_key", "player_id", "link_status", "candidate_count",
             "match_method", "confidence_notes", "reported_games",
             "reported_goals", "is_matching_backlog"),
            (
                (source_id, p["dg_person_id"], p["player_url"],
                 p["display_name_raw"], p["name_key"], p["player_id"],
                 p["link_status"], p["candidate_count"], p["match_method"],
                 p["confidence_notes"], p["reported_games"],
                 p["reported_goals"], p["is_matching_backlog"])
                for p in people.values()
            ),
            batch,
        )
        pg.commit()

        with pg.cursor() as cur:
            cur.execute("SELECT dg_person_id, id, player_id, link_status "
                        "FROM draft_persons WHERE source_id = %s", (source_id,))
            person_rows = {dg: (pid, player_id, status)
                           for dg, pid, player_id, status in cur.fetchall()}

        def pick_rows():
            for row in rows:
                dg = row["dg_person_id"]
                entry = person_rows.get(dg) if dg is not None else None
                if entry is None:
                    # No person id: retain the row, unlinked. Dropping it
                    # would lose a real draft transaction.
                    batch.reject(str(row["draft_rowid"]),
                                 "no dg_person_id on source row",
                                 {"player": row["player"]})
                    person_pk, player_id, status = None, None, "unmatched"
                else:
                    person_pk, player_id, status = entry

                club_raw = clean_text(row["club"])
                yield (
                    to_int(row["draft_year"]),
                    clean_text(row["draft_type"]) or "unknown",
                    clean_text(row["draft_kind"]),
                    to_int(row["pick"]),
                    clean_text(row["pick_note"]),
                    player_id,
                    row["player"] or "",
                    status,
                    to_int(row["candidate_count"]) or 0,
                    clean_text(row["match_method"]),
                    clean_text(row["confidence_notes"]),
                    clubs.get(club_raw.lower()) if club_raw else None,
                    club_raw,
                    clean_text(row["original_club"]),
                    to_int(row["draft_age"]),
                    to_int(row["height_cm"]),
                    to_int(row["weight_kg"]),
                    clean_text(row["grade"]),
                    clean_text(row["competition"]),
                    clean_text(row["signing"]),
                    clean_text(row["signing_kind"]),
                    clean_text(row["detail"]),
                    source_id,
                    str(row["draft_rowid"]),
                    batch.id,
                    person_pk,
                    dg,
                    clean_text(row["player_url"]),
                    to_int(row["games"]),
                    to_int(row["goals"]),
                )

        copy_rows(
            pg, "draft_picks",
            ("draft_year", "draft_type", "draft_kind", "pick_number",
             "pick_note", "player_id", "player_name_raw", "link_status_value",
             "candidate_count", "match_method", "confidence_notes",
             "club_id", "club_name_raw", "original_club_raw", "draft_age",
             "height_cm", "weight_kg", "grade", "competition", "signing",
             "signing_kind", "detail", "source_id", "source_record_id",
             "import_batch_id", "draft_person_id", "dg_person_id",
             "player_url", "reported_games", "reported_goals"),
            pick_rows(),
            batch,
        )
        pg.commit()

        # Record the backlog as a data issue rather than leaving it in a
        # column nobody reads.
        with pg.cursor() as cur:
            # draft_persons is truncated and reloaded, so old issues point
            # at ids that no longer exist. Clear the unresolved ones this
            # pass owns; adjudicated issues are history and stay.
            cur.execute("""
                DELETE FROM data_issues
                 WHERE entity_type = 'draft_person'
                   AND issue_type = 'unlinked_player_with_games'
                   AND resolved_at IS NULL
            """)
            cur.execute("""
                INSERT INTO data_issues
                    (entity_type, entity_id, issue_type, severity, description, details)
                SELECT 'draft_person', dp.id, 'unlinked_player_with_games', 'warning',
                       format('Draft person %s reports %s senior games but is not linked '
                              'to an AFLDB player.', dp.display_name_raw, dp.reported_games),
                       jsonb_build_object('dg_person_id', dp.dg_person_id,
                                          'player_url', dp.player_url,
                                          'reported_games', dp.reported_games)
                  FROM draft_persons dp
                 WHERE dp.is_matching_backlog
            """)
        pg.commit()

    analyze(pg, "draft_picks", "draft_persons")

    with pg.cursor() as cur:
        cur.execute("SELECT link_status_value, count(*) FROM draft_picks "
                    "GROUP BY 1 ORDER BY 2 DESC")
        print()
        for status, count in cur.fetchall():
            rep.result(f"draft_picks {status}", count)

    print(f"\nCompleted in {time.time() - started:.1f}s")
    pg.close()
    lite.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
