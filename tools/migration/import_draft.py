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
identity hangs off draft_persons, keyed on DraftGuru's own player page.

That page URL — `player_url`, with a trailing ordinal separating
same-name people — is the ONLY durable identifier the source has, and it
is the upstream loader's own `person_key`. Two things that look like ids
are not (AFLDB-ISSUE-078):

    dg_person_id      assigned as `p.index + 1` over a person frame
                      sorted by player_url, so it is a RANK recomputed on
                      every upstream load. One new person renumbers
                      everything after it. Still stored and still useful
                      for quoting, but never identity.

    source_record_id  the legacy SQLite rowid. That table is written with
                      `to_sql(if_exists="replace")`, so every rowid is
                      reissued on every source rebuild. Kept as
                      provenance; never a key.

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

Reloads are keyed, not destructive
----------------------------------
Both tables are reconciled by their source key, so every row id survives
a reload. That matters because the ids are durable application identity:
`player_link_resolutions.target_id` names a draft_picks row,
`player_link_match_candidates` and the draft-person `data_issues` history
name a draft_persons row.

Manual identity decisions are read before anything is written and
re-applied afterwards. They are PERSON-grained even though the audit row
names one pick, because `applyLockedLink` writes the draft_person and
every pick belonging to it. A decision that cannot be carried across —
the source dropped the key, or renamed the row under it — aborts the
reload before the first write unless --allow-link-loss is given. Two
picks of one person carrying contradictory decisions always abort: there
is no safe way to pick a winner.

Rows the importer does not own are never touched. Everything it writes
carries `source_id = draftguru`; an admin-created pick
(`createPlayerInTransaction`) has `source_id IS NULL` and stays outside
the reload's UPDATE, INSERT and DELETE alike.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    DiscardedDecision,
    LinkDecisionLoss,
    Reporter,
    analyze,
    clean_text,
    connect_legacy,
    connect_pg,
    import_batch,
    load_env,
    reload_keyed,
    report_reload,
    require_env,
    safe_dsn,
    to_int,
)

SOURCE_KEY = "draftguru"

# Link states the SOURCE considers certain. Anything else is retained
# with player_id NULL rather than guessed at.
TRUSTED = ("unique", "resolved")

# The states that mean "no confirmed link", and so the states a decision
# that says "genuinely not an AFLDB player" may leave a row in.
UNLINKED = ("ambiguous", "unmatched", "implausible")

# See the module docstring: player_url, not dg_person_id, not the rowid.
PERSON_KEY = ("source_id", "player_url")
PERSON_COLUMNS = (
    "source_id", "dg_person_id", "player_url", "display_name_raw",
    "name_key", "player_id", "link_status", "candidate_count",
    "match_method", "confidence_notes", "reported_games",
    "reported_goals", "is_matching_backlog",
)

# draft_year is the year page itself (source_url maps to it one to one),
# and draft_kind separates the 23 people who appear twice on one board.
# pick_number is deliberately absent: a corrected pick number is the same
# selection and must reconcile as an UPDATE to the same row.
PICK_KEY = ("source_id", "player_url", "draft_year", "draft_kind")
PICK_COLUMNS = (
    "draft_year", "draft_type", "draft_kind", "pick_number",
    "pick_note", "player_id", "player_name_raw", "link_status_value",
    "candidate_count", "match_method", "confidence_notes",
    "club_id", "club_name_raw", "original_club_raw", "draft_age",
    "height_cm", "weight_kg", "grade", "competition", "signing",
    "signing_kind", "signing_detail", "detail",
    "source_id", "source_record_id",
    "import_batch_id", "draft_person_id", "dg_person_id",
    "player_url", "reported_games", "reported_goals",
)

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


@dataclass
class PersonDecision:
    """One admin decision, normalised from the pick it names to its person."""

    player_url: str
    action: str
    player_id: int | None
    #: The draft_picks row the audit trail points at.
    target_id: int
    previous_status: str
    #: That pick's current name and key, for the carry check below.
    pick_name: str
    pick_key: tuple

    def describe_key(self) -> str:
        return " | ".join(str(part) for part in self.pick_key)


def read_decisions(pg, source_id: int) -> tuple[list[PersonDecision], list[str]]:
    """The operative decision per decided pick, normalised to its person.

    The audit trail is append-only, so the newest row for a target is the
    decision that stands. A decision whose target no longer exists is
    invisible here — those are the orphans AFLDB-ISSUE-079 tracks, and
    nothing in a reload can recover them.
    """
    with pg.cursor() as cur:
        cur.execute(
            """SELECT DISTINCT ON (r.target_id)
                      r.target_id, r.action, r.player_id,
                      r.previous_status::text,
                      p.player_url, k.player_name_raw,
                      k.source_id, k.draft_year, k.draft_kind
                 FROM player_link_resolutions r
                 JOIN draft_picks k ON k.id = r.target_id
                 LEFT JOIN draft_persons p ON p.id = k.draft_person_id
                WHERE r.target_table = 'draft_picks'
                  AND k.source_id = %s
                ORDER BY r.target_id, r.created_at DESC, r.id DESC""",
            (source_id,),
        )
        raw = cur.fetchall()

    decisions: list[PersonDecision] = []
    orphaned: list[str] = []
    for (target_id, action, player_id, previous_status, player_url,
         pick_name, pick_source, draft_year, draft_kind) in raw:
        if player_url is None:
            # Only reachable if a pick lost its person outside this loader:
            # lockUnresolvedTarget refuses to decide a pick without one.
            orphaned.append(
                f"draft_picks id={target_id} carries a {action} decision but has "
                "no draft person identity; it cannot be carried across a reload"
            )
            continue
        decisions.append(PersonDecision(
            player_url=player_url,
            action=action,
            player_id=player_id,
            target_id=target_id,
            previous_status=previous_status,
            pick_name=pick_name,
            pick_key=(pick_source, player_url, draft_year, draft_kind),
        ))
    return decisions, orphaned


def classify_decisions(
    decisions: list[PersonDecision],
    incoming_people: set[str],
    incoming_picks: dict[tuple, str],
    allow_link_loss: bool,
) -> tuple[list[PersonDecision], list[DiscardedDecision]]:
    """Decide what survives the reload, before a single row is written.

    Two separate failure modes, and only one of them has an escape hatch.
    A decision the source can no longer carry is a LOSS, which
    --allow-link-loss may discard deliberately. Two picks of one person
    disagreeing is an AMBIGUITY: there is nothing to choose between, so it
    always stops the run.
    """
    by_person: dict[str, list[PersonDecision]] = {}
    for decision in decisions:
        by_person.setdefault(decision.player_url, []).append(decision)

    conflicts: list[str] = []
    for player_url, group in sorted(by_person.items()):
        actions = {d.action for d in group}
        linked_players = {d.player_id for d in group if d.action == "linked"}
        if len(actions) > 1 or len(linked_players) > 1:
            detail = "; ".join(
                f"draft_picks id={d.target_id} {d.action}"
                + (f" player {d.player_id}" if d.player_id is not None else "")
                for d in sorted(group, key=lambda d: d.target_id)
            )
            conflicts.append(
                f"{player_url}: the picks of this person contradict each other "
                f"[{detail}]. Identity is person-grained, so one of these "
                "decisions has to be withdrawn in /admin/player-links before "
                "the draft can reload."
            )
    if conflicts:
        raise LinkDecisionLoss(
            f"{len(conflicts)} draft person(s) carry contradictory human "
            "identity decisions; nothing has been written:\n  "
            + "\n  ".join(conflicts)
            + "\n--allow-link-loss does NOT apply here: there is no safe "
              "decision to keep."
        )

    surviving: list[PersonDecision] = []
    discarded: list[DiscardedDecision] = []
    for decision in decisions:
        if decision.player_url not in incoming_people:
            discarded.append(DiscardedDecision(
                "draft_picks", decision.target_id, decision.describe_key(),
                decision.pick_name, "the source no longer carries this person",
                decision.action, decision.player_id,
            ))
            continue
        incoming_name = incoming_picks.get(decision.pick_key)
        if incoming_name is None:
            discarded.append(DiscardedDecision(
                "draft_picks", decision.target_id, decision.describe_key(),
                decision.pick_name, "the source no longer carries this key",
                decision.action, decision.player_id,
            ))
            continue
        if incoming_name != decision.pick_name:
            discarded.append(DiscardedDecision(
                "draft_picks", decision.target_id, decision.describe_key(),
                decision.pick_name,
                f"the source name changed to {incoming_name!r}",
                decision.action, decision.player_id,
            ))
            continue
        surviving.append(decision)

    if discarded and not allow_link_loss:
        raise LinkDecisionLoss(
            f"{len(discarded)} human identity decision(s) cannot survive this "
            "draft reload; nothing has been written:\n  "
            + "\n  ".join(d.describe() for d in discarded)
            + "\nReview them in /admin/player-links, or rerun with "
              "--allow-link-loss to discard them deliberately."
        )
    return surviving, discarded


def replay_decisions(pg, source_id: int, decisions: list[PersonDecision],
                     rep: Reporter) -> int:
    """Re-apply each surviving decision on top of the refreshed source facts.

    Person-grained, exactly as applyLockedLink writes it: the draft_person
    and every pick belonging to it. Anything else would let one pick of a
    person take a source link the admin has already rejected on another.
    """
    applied = 0
    for decision in sorted(decisions, key=lambda d: d.target_id):
        with pg.cursor() as cur:
            cur.execute(
                """SELECT id, player_id, link_status::text
                     FROM draft_persons
                    WHERE source_id = %s AND player_url = %s""",
                (source_id, decision.player_url),
            )
            row = cur.fetchone()
            if row is None:
                # Classification proved the source still carries this person,
                # so a missing row here means the reload itself went wrong.
                raise RuntimeError(
                    f"draft person {decision.player_url} vanished during the "
                    "reload; refusing to continue"
                )
            person_id, source_player, source_status = row

            if decision.action == "linked":
                if source_player is not None and source_player != decision.player_id:
                    rep.warn(
                        f"draft_persons id={person_id} [{decision.player_url}] "
                        f"{decision.pick_name!r}: the source now links player "
                        f"{source_player}, an admin linked player "
                        f"{decision.player_id}; keeping the admin's decision — "
                        "review it"
                    )
                cur.execute(
                    """UPDATE draft_persons
                          SET player_id = %s, link_status = 'resolved',
                              is_matching_backlog = false
                        WHERE id = %s""",
                    (decision.player_id, person_id),
                )
                cur.execute(
                    """UPDATE draft_picks
                          SET player_id = %s, link_status_value = 'resolved'
                        WHERE draft_person_id = %s""",
                    (decision.player_id, person_id),
                )
            else:
                if source_player is not None:
                    rep.warn(
                        f"draft_persons id={person_id} [{decision.player_url}] "
                        f"{decision.pick_name!r}: the source now links player "
                        f"{source_player}, an admin confirmed this person is "
                        "genuinely unlinked; keeping it unlinked — review it"
                    )
                # Keep the source's own unlinked wording where it has one; a
                # source that now claims a link has none to keep, so fall back
                # to the status the admin was looking at when they decided.
                status = source_status if source_status in UNLINKED else (
                    decision.previous_status
                    if decision.previous_status in UNLINKED else "unmatched"
                )
                cur.execute(
                    """UPDATE draft_persons
                          SET player_id = NULL, link_status = %s,
                              is_matching_backlog = false
                        WHERE id = %s""",
                    (status, person_id),
                )
                cur.execute(
                    """UPDATE draft_picks
                          SET player_id = NULL, link_status_value = %s
                        WHERE draft_person_id = %s""",
                    (status, person_id),
                )
        applied += 1
    return applied


def main() -> int:
    parser = argparse.ArgumentParser(description="Import draft picks and draft people.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument(
        "--allow-link-loss", action="store_true",
        help="proceed even though a manual player-link decision cannot be "
             "carried across, itemising every decision discarded",
    )
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

    # Every row must be keyable. player_url is the person's identity and
    # draft_kind separates two selections on one board; without either the
    # row cannot be reconciled, and silently dropping it would lose a real
    # draft transaction. Stop instead.
    unkeyable = [r for r in rows
                 if not clean_text(r["player_url"]) or not clean_text(r["draft_kind"])]
    if unkeyable:
        rep.warn(f"{len(unkeyable)} source rows cannot be keyed for reload:")
        for row in unkeyable[:5]:
            rep.warn(f"    rowid {row['draft_rowid']} {row['player']!r} "
                     f"player_url={row['player_url']!r} draft_kind={row['draft_kind']!r}")
        raise SystemExit(
            "The draft source supplied rows with no player_url or no draft_kind. "
            "A draft_kind of NULL usually means afl/draft_kinds.py upstream does "
            "not know a new draft_type wording yet. Nothing has been written."
        )

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
    # Source row order is not guaranteed, so fold in a fixed order: which
    # row wins decides the person's name, URL and link, and that must not
    # change between runs over identical data.
    rows.sort(key=lambda r: (r["player_url"] or "", r["draft_rowid"]))

    people: dict[str, dict] = {}
    # player_url -> the distinct AFLDB players trusted rows point at.
    # More than one means the source contradicts itself about who this
    # person is, which is a fact worth surfacing rather than resolving by
    # taking whichever row was read first.
    trusted_targets: dict[str, dict[int, int]] = {}
    for row in rows:
        url = clean_text(row["player_url"])
        person = people.setdefault(url, {
            "dg_person_id": to_int(row["dg_person_id"]),
            "player_url": url,
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
        if status in TRUSTED and afldb_pid is not None:
            targets = trusted_targets.setdefault(url, {})
            targets[afldb_pid] = targets.get(afldb_pid, 0) + 1
            if person["player_id"] is None:
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

    # Trusted rows that point at different players for the same person.
    # Keeping the first and discarding the rest would present a resolved
    # link the source does not actually support.
    contradictions = {url: targets for url, targets in trusted_targets.items()
                      if len(targets) > 1}
    if contradictions:
        rep.warn(f"{len(contradictions)} draft people have trusted links to more "
                 "than one AFLDB player; the first is used and each is flagged")
        for url, targets in sorted(contradictions.items()):
            rep.warn(f"    {url}: players {sorted(targets)}")

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

    # The incoming key sets, used to classify decisions before writing.
    incoming_people = set(people)
    incoming_picks: dict[tuple, str] = {}
    for row in rows:
        key = (source_id, clean_text(row["player_url"]),
               to_int(row["draft_year"]), clean_text(row["draft_kind"]))
        incoming_picks[key] = row["player"] or ""

    with import_batch(pg, SOURCE_KEY, "import_draft.py", "draft_picks") as batch:
        batch.records_read = len(rows)

        # ---- Classify every human decision BEFORE anything is written --
        decisions, orphaned = read_decisions(pg, source_id)
        for message in orphaned:
            rep.warn(message)
        surviving, discarded = classify_decisions(
            decisions, incoming_people, incoming_picks, args.allow_link_loss,
        )
        if decisions:
            rep.result("manual decisions read", len(decisions))

        # dg_person_id is a per-load rank, so a reload can PERMUTE it. A
        # non-deferrable unique constraint fails row by row on that; migration
        # 069 made this one deferrable so the whole statement is checked once.
        with pg.cursor() as cur:
            cur.execute("SET CONSTRAINTS draft_persons_source_id_dg_person_id_key DEFERRED")

        # ---- draft_persons: upsert only --------------------------------
        # draft_picks.draft_person_id is a NO ACTION foreign key, so a person
        # the source dropped can only be deleted once its picks have been.
        person_stats = reload_keyed(
            pg, "draft_persons", PERSON_KEY, PERSON_COLUMNS,
            (
                (source_id, p["dg_person_id"], p["player_url"],
                 p["display_name_raw"], p["name_key"], p["player_id"],
                 p["link_status"], p["candidate_count"], p["match_method"],
                 p["confidence_notes"], p["reported_games"],
                 p["reported_goals"], p["is_matching_backlog"])
                for p in people.values()
            ),
            batch,
            link_columns=None,
            scope_column="source_id", scope_values=[source_id],
            delete_missing=False,
        )

        with pg.cursor() as cur:
            cur.execute("SELECT player_url, id FROM draft_persons "
                        "WHERE source_id = %s", (source_id,))
            person_ids = dict(cur.fetchall())

        def pick_rows():
            for row in rows:
                url = clean_text(row["player_url"])
                club_raw = clean_text(row["club"])
                yield (
                    to_int(row["draft_year"]),
                    clean_text(row["draft_type"]) or "unknown",
                    clean_text(row["draft_kind"]),
                    to_int(row["pick"]),
                    clean_text(row["pick_note"]),
                    people[url]["player_id"],
                    row["player"] or "",
                    people[url]["link_status"],
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
                    clean_text(row["signing_detail"]),
                    clean_text(row["detail"]),
                    source_id,
                    str(row["draft_rowid"]),
                    batch.id,
                    person_ids[url],
                    to_int(row["dg_person_id"]),
                    url,
                    to_int(row["games"]),
                    to_int(row["goals"]),
                )

        pick_stats = reload_keyed(
            pg, "draft_picks", PICK_KEY, PICK_COLUMNS, pick_rows(), batch,
            link_columns=None,
            scope_column="source_id", scope_values=[source_id],
        )

        # ---- Now the childless people the source dropped ---------------
        # A person exists only because a pick references them, so a person
        # with no picks left is exactly one the source no longer carries.
        with pg.cursor() as cur:
            cur.execute(
                """DELETE FROM draft_persons p
                    WHERE p.source_id = %s
                      AND NOT EXISTS (SELECT 1 FROM draft_picks k
                                       WHERE k.draft_person_id = p.id)""",
                (source_id,),
            )
            person_stats.deleted = cur.rowcount

        # ---- Re-apply the human decisions ------------------------------
        person_stats.preserved = replay_decisions(pg, source_id, surviving, rep)
        person_stats.discarded = discarded

        report_reload(rep, "draft_persons", person_stats)
        report_reload(rep, "draft_picks", pick_stats)
        for label, stats in (("draft_persons", person_stats),
                             ("draft_picks", pick_stats)):
            rep.step(f"{label}: {stats.updated:,} updated, "
                     f"{stats.inserted:,} inserted, {stats.deleted:,} deleted")

        # Record the backlog as a data issue rather than leaving it in a
        # column nobody reads. Filed after the decision replay, so a person
        # an admin has just adjudicated is no longer reported as backlog.
        with pg.cursor() as cur:
            # Row ids now survive a reload, so an adjudicated issue keeps
            # naming the row it was about. Only the unresolved ones this pass
            # owns are refiled; a human resolution is history and stays.
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

            # Contradictory trusted links, recorded for the same reason:
            # a link the source disagrees with itself about should be
            # visible, not resolved silently by read order.
            cur.execute("""
                DELETE FROM data_issues
                 WHERE entity_type = 'draft_person'
                   AND issue_type = 'contradictory_trusted_link'
                   AND resolved_at IS NULL
            """)
            if contradictions:
                cur.executemany(
                    """INSERT INTO data_issues
                         (entity_type, entity_id, issue_type, severity,
                          description, details)
                       SELECT 'draft_person', dp.id, 'contradictory_trusted_link',
                              'warning', %s, %s::jsonb
                         FROM draft_persons dp
                        WHERE dp.source_id = %s AND dp.player_url = %s""",
                    [
                        (
                            f"The source reports trusted links from this person to "
                            f"{len(targets)} different AFLDB players "
                            f"({', '.join(str(p) for p in sorted(targets))}). "
                            f"Player {people[url]['player_id']} was used; the "
                            f"disagreement is unresolved.",
                            json.dumps({
                                "player_url": url,
                                "dg_person_id": people[url]["dg_person_id"],
                                "player_ids": sorted(targets),
                                "row_counts": {str(k): v for k, v in sorted(targets.items())},
                                "used_player_id": people[url]["player_id"],
                            }),
                            source_id,
                            url,
                        )
                        for url, targets in sorted(contradictions.items())
                    ],
                )

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
    try:
        raise SystemExit(main())
    except LinkDecisionLoss as loss:
        # Raised during classification, before anything was written;
        # import_batch has already rolled its transaction back, so both
        # tables are untouched.
        print(str(loss))
        raise SystemExit(1)
