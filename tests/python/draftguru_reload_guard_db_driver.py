#!/usr/bin/env python3
"""AFLDB-ISSUE-348 -- real-database driver for the DraftGuru reload guard.

Used only by the ``reload guard`` case of ``tests/integration/draftguru-import.test.ts``; it is
a helper, not a suite (no assertions here). The Stage A snapshot is gitignored, and the guard
needs none: it compares the INCOMING picks/persons with what the target stores. This driver
therefore builds the incoming ``prepared`` frame from the target's own stored DraftGuru rows
(an identity frame: a clean reload would change nothing), applies the requested deviations, and
runs the REAL ``import_draftguru.main`` against the real database as the ``afldb_import`` role
(``AFLDB_IMPORT_DATABASE_URL``, supplied by the test harness):

    python draftguru_reload_guard_db_driver.py [--omit-url URL]... [--incoming-origin ID=TEXT]...
           [--incoming-rank URL=N]... -- <importer argv>
    python draftguru_reload_guard_db_driver.py --probe-null-key URL YEAR

``--omit-url`` leaves every pick and the person of that player_url out of the incoming frame (the
ING-2 situation: the snapshot does not carry rows the target stores). ``--incoming-origin`` sets
the incoming ``original_club_raw`` of stored pick ID; ``--incoming-rank`` sets an incoming
person's ``dg_person_id``. ``--probe-null-key`` calls ``reload_guard.read_surface`` with one
incoming pick whose reload key has a NULL ``draft_kind`` and prints which stored ids matched
and which would be deleted, as JSON.

Never run against a database that is not an isolated ``_test`` copy.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tools" / "rebuild" / "draftguru"))
sys.path.insert(0, str(ROOT / "tools" / "migration"))

import common                                       # noqa: E402
import import_draftguru as imp                      # noqa: E402
import reload_guard as rg                           # noqa: E402

PICK_SQL = """SELECT id, player_url, draft_year, draft_type, draft_kind, pick_number, pick_note,
                     player_name_raw, club_id, club_name_raw, original_club_raw, draft_age,
                     height_cm, competition, signing, signing_kind, detail, source_record_id
                FROM draft_picks WHERE source_id = %s ORDER BY id"""
PERSON_SQL = """SELECT player_url, dg_person_id, display_name_raw, name_key, reported_games,
                       reported_goals
                  FROM draft_persons WHERE source_id = %s ORDER BY dg_person_id"""


def stored_frame(omit: set[str], origins: dict[int, str], ranks: dict[str, int]) -> dict:
    pg = common.connect_pg()
    try:
        with pg.cursor() as cur:
            source_id = imp.resolve_source_id(cur, imp.SOURCE_KEY)
            cur.execute("SELECT id, slug FROM clubs")
            slug_of = dict(cur.fetchall())
            cur.execute(PICK_SQL, (source_id,))
            pick_rows = cur.fetchall()
            cur.execute(PERSON_SQL, (source_id,))
            person_rows = cur.fetchall()
    finally:
        pg.rollback()
        pg.close()

    persons: dict[str, dict] = {}
    for url, rank, display, name_key, games, goals in person_rows:
        if url in omit:
            continue
        persons[url] = {"player_url": url, "dg_person_id": ranks.get(url, rank),
                        "display_name_raw": display, "name_key": name_key,
                        "reported_games": games or 0, "reported_goals": goals or 0}
    picks: list[dict] = []
    for (pid, url, year, dtype, kind, number, note, name, club_id, club_name, origin, age,
         height, competition, signing, signing_kind, detail, record) in pick_rows:
        if url in omit:
            continue
        picks.append({
            "player_url": url, "draft_year": year, "draft_type": dtype, "draft_kind": kind,
            "pick_number": number, "pick_note": note, "player_name_raw": name,
            "club_slug": slug_of.get(club_id), "club_name_raw": club_name,
            "original_club_raw": origins.get(pid, origin), "draft_age": age,
            "height_cm": height, "competition": competition, "signing": signing,
            "signing_kind": signing_kind, "detail": detail, "source_record_id": record})
    return {"persons": persons, "picks": picks, "ledger": {}, "bridges": {}, "year_count": 0,
            "manifest": {}, "contract": {}}


def probe_null_key(url: str, year: int) -> int:
    pg = common.connect_pg()
    try:
        with pg.cursor() as cur:
            source_id = imp.resolve_source_id(cur, imp.SOURCE_KEY)
            incoming_pick = {"player_url": url, "draft_year": year, "draft_kind": None}
            incoming_person = {"player_url": url}
            surface = rg.read_surface(
                cur, source_id=source_id, picks=[incoming_pick], persons=[incoming_person],
                pick_key=imp.PICK_KEY, person_key=imp.PERSON_KEY)
        print(json.dumps({
            "matched_pick_ids": sorted(pid for pid, _ in surface["matched_picks"]),
            "deleted_pick_count": len(surface["deleted_pick_ids"]),
            "matched_person_ids": sorted(pid for pid, _ in surface["matched_persons"]),
        }))
    finally:
        pg.rollback()
        pg.close()
    return 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["--probe-null-key"]:
        return probe_null_key(argv[1], int(argv[2]))
    omit: set[str] = set()
    origins: dict[int, str] = {}
    ranks: dict[str, int] = {}
    i = 0
    while i < len(argv) and argv[i] != "--":
        flag, value = argv[i], argv[i + 1]
        if flag == "--omit-url":
            omit.add(value)
        elif flag == "--incoming-origin":
            pid, _, text = value.partition("=")
            origins[int(pid)] = text
        elif flag == "--incoming-rank":
            url, _, rank = value.rpartition("=")
            ranks[url] = int(rank)
        else:
            raise SystemExit(f"unknown driver flag {flag}")
        i += 2
    importer_argv = argv[i + 1:] if i < len(argv) else []
    frame = stored_frame(omit, origins, ranks)
    imp.validate = lambda _args: frame               # the guard needs no Stage A snapshot
    return imp.main(importer_argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
