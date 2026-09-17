#!/usr/bin/env python3
"""AFLDB-ISSUE-136 — the renumbered-profile fold reaches PostgreSQL as ONE player.

    python tests/python/fitzroy_profile_continuity_contract.py

The spawn tests in tests/fitzroy-core-import.test.ts prove the offline half: a tracked
``profile_url_continuity`` rule folds a renumbered AFL Tables profile into its continuing
player, and a blank-ID profile no rule names is refused. They stop at --validate-only,
so nothing there proves what ``import_players()`` then WRITES. This file drives the real
``import_players()`` against an in-memory stand-in for the psycopg connection and asserts
the write contract that keeps the fold from re-splitting downstream:

* one ``players`` row for the folded player, never two;
* BOTH profile paths registered in ``external_identities`` against that one ``players.id``
  (so the settle, the awards census and the Brownlow writers resolve either url to the
  same career);
* DOB evidence keyed on the continuing path only;
* a database that already holds the split (the two paths registered to DIFFERENT players)
  HALTs before the reconciliation DELETE and before the identity upsert — no merge, no
  choice, no partial write.

It also exercises ``apply_profile_continuity`` / ``refuse_unresolved_renumbering``
directly on PlayerFact objects, and the real contract's rule list.

No database, no network, no psycopg: ``common`` is replaced by a stand-in module for the
duration of the write test so the import path is exercised without a driver.
"""

from __future__ import annotations

import contextlib
import json
import sys
import tempfile
import types
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "migration"))

import import_fitzroy_core as fz  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' — ' + detail) if detail else ''}")
        failures.append(name)


def raises(fn, exc_type, needle: str = "") -> tuple[bool, str]:
    try:
        fn()
    except exc_type as exc:
        return (needle in str(exc)), str(exc)
    except Exception as exc:  # noqa: BLE001
        return False, f"wrong exception {type(exc).__name__}: {exc}"
    return False, "no exception"


# ---------------------------------------------------------------------------
# 1. The tracked rules load, and only the four measured renumberings are named
# ---------------------------------------------------------------------------

print("1. the tracked profile_url_continuity rules")

rules = fz.load_profile_continuity_rules()
check("1a four rules load from the tracked contract", len(rules) == 4, str(len(rules)))
check("1b every rule names player_stats_2025.csv and normalised paths",
      all(r["file"] == "player_stats_2025.csv"
          and fz.PROFILE_PATH_SHAPE.match(r["continuing_url"])
          and fz.PROFILE_PATH_SHAPE.match(r["renumbered_url"]) for r in rules))
check("1c the renumbered rows sum to the 79 measured blank-ID renumbered rows",
      sum(r["expect"]["renumbered_rows"] for r in rules) == 79)
check("1d Billy Wilson (career-game-1 debut) is named by no rule",
      not any("Billy_Wilson" in json.dumps(r) for r in rules))


def contract_with(rule_patch: dict) -> Path:
    contract = json.loads((ROOT / "tools" / "rebuild" / "fitzroy"
                           / "fitzroy-contract.json").read_text(encoding="utf-8"))
    contract["profile_url_continuity"]["rules"] = [{**rules[0], **rule_patch}]
    tmp = Path(tempfile.mkdtemp(prefix="issue136-")) / "contract.json"
    tmp.write_text(json.dumps(contract), encoding="utf-8")
    return tmp


ok, msg = raises(lambda: fz.load_profile_continuity_rules(
    contract_with({"renumbered_url": rules[0]["continuing_url"]})),
    fz.SnapshotValidationError, "same path")
check("1e a rule folding a path into itself is refused as malformed", ok, msg)
ok, msg = raises(lambda: fz.load_profile_continuity_rules(
    contract_with({"file": "player_stats_2024.csv"})),
    fz.SnapshotValidationError, "artefact of expect.renumbered_first_season")
check("1f a rule whose file is not the renumbered season is refused", ok, msg)
ok, msg = raises(lambda: fz.load_profile_continuity_rules(
    contract_with({"expect": {**rules[0]["expect"], "continuing_id": ""}})),
    fz.SnapshotValidationError, "continuing_id")
check("1g a rule with no continuing ID is refused", ok, msg)


# ---------------------------------------------------------------------------
# 2. apply_profile_continuity / refuse_unresolved_renumbering on PlayerFacts
# ---------------------------------------------------------------------------

print("\n2. the fold and the refusal on PlayerFact objects")

CONT, RENUM = "players/J/John_Smith0.html", "players/J/John_Smith3.html"


def fact(url: str, afl_id: str | None, first: tuple, last: tuple, rows: int,
         dob: date | None = None) -> fz.PlayerFact:
    f = fz.PlayerFact(afl_id=afl_id, url=url, given_name="John", surname="Smith",
                      display_name="John Smith")
    f.urls.add(url)
    f.first_appearance, f.last_appearance, f.rows = first, last, rows
    f.first_season, f.last_season = first[0], last[0]
    if dob is not None:
        f.dobs[dob] = rows
    return f


def players_split(**renum_over) -> dict[str, fz.PlayerFact]:
    cont = fact(CONT, "101", (2014, date(2014, 3, 1), 1), (2024, date(2024, 9, 28), 229),
                229, date(1994, 7, 5))
    renum = fact(RENUM, None, (2025, date(2025, 3, 29), 230),
                 (2025, date(2025, 8, 20), 254), 25)
    for k, v in renum_over.items():
        setattr(renum, k, v)
    return {CONT: cont, RENUM: renum}


RULE = {
    "id": "fixture", "dataset": "player_stats", "file": "player_stats_2025.csv",
    "continuing_url": CONT, "renumbered_url": RENUM,
    "expect": {"continuing_id": "101", "continuing_last_season": 2024,
               "continuing_last_career_game": 229, "renumbered_first_season": 2025,
               "renumbered_last_season": 2025, "renumbered_first_career_game": 230,
               "renumbered_rows": 25},
    "authority": "fixture", "reason": "fixture",
}

players = players_split()
applied = fz.apply_profile_continuity(players, [RULE])
folded = players.get(CONT)
check("2a the renumbered profile is removed and the continuing player remains",
      RENUM not in players and folded is not None)
check("2b both paths are registered on the one player, keyed by the continuing path",
      folded is not None and folded.urls == {CONT, RENUM} and folded.url == CONT)
check("2c rows, last season and last appearance carry over; DOB evidence is untouched",
      folded is not None and folded.rows == 254 and folded.last_season == 2025
      and folded.last_appearance[2] == 254 and folded.dobs == {date(1994, 7, 5): 229})
check("2d the fold is reported with the rule id and the career-game proof",
      applied == [{"rule_id": "fixture", "continuing_url": CONT, "renumbered_url": RENUM,
                   "rows": 25, "seasons": "2025-2025", "career_games": "229 -> 230"}],
      str(applied))
ok, msg = raises(lambda: fz.refuse_unresolved_renumbering(players),
                 fz.PlayerIdentityError)
check("2e after the fold nothing is left to refuse", not ok and msg == "no exception", msg)

for label, over, needle in (
    ("2f a renumbered profile carrying an ID", {"afl_id": "999"}, "carries fitzRoy ID 999"),
    ("2g a career-game gap", {"first_appearance": (2025, date(2025, 3, 29), 231)},
     "career games run 229 -> 231"),
    ("2h an unrecorded boundary career game",
     {"first_appearance": (2025, date(2025, 3, 29), None)}, "cannot be proved"),
    ("2i a season overlap", {"first_season": 2024, "first_appearance": (2024, date(2024, 9, 1), 230)},
     "spans 2024-2025"),
    ("2j a DOB conflict", {"dobs": {date(1990, 1, 1): 25}}, "DOB disagrees"),
    ("2k a name-field disagreement", {"given_name": "Jon"}, "name fields disagree"),
    ("2l a row-count drift", {"rows": 26}, "carries 26 row(s), rule binds 25"),
):
    ok, msg = raises(lambda over=over: fz.apply_profile_continuity(players_split(**over), [RULE]),
                     fz.PlayerIdentityError, needle)
    check(f"{label} is refused", ok, msg)

ok, msg = raises(lambda: fz.refuse_unresolved_renumbering(players_split()),
                 fz.PlayerIdentityError, "no profile_url_continuity rule names it")
check("2m an unfolded blank-ID veteran is refused, not seeded", ok, msg)
debut = {RENUM: fact(RENUM, None, (2025, date(2025, 6, 26), 1), (2025, date(2025, 8, 1), 4), 4)}
ok, msg = raises(lambda: fz.refuse_unresolved_renumbering(debut), fz.PlayerIdentityError)
check("2n a blank-ID career-game-1 debut is accepted as a new player",
      not ok and msg == "no exception", msg)
id_bearing = {CONT: fact(CONT, "77", (1911, date(1911, 5, 6), 0), (1911, date(1911, 9, 1), 3), 3)}
ok, msg = raises(lambda: fz.refuse_unresolved_renumbering(id_bearing), fz.PlayerIdentityError)
check("2o an ID-bearing profile is never examined (1911 career game 0 is source noise)",
      not ok and msg == "no exception", msg)


# ---------------------------------------------------------------------------
# 3. import_players() writes ONE player with BOTH identities (driver-free)
# ---------------------------------------------------------------------------

print("\n3. import_players() write contract, with a stand-in connection")


class FakeDb:
    def __init__(self, identities: dict[str, int]):
        self.sources = {"afltables": 1, "fitzroy_afldata": 2}
        self.identities = dict(identities)   # external_id -> player_id, as stored
        self.next_id = 100
        self.inserted_players: list[tuple] = []
        self.updated_players: list[int] = []
        self.identity_writes: list[tuple] = []
        self.evidence_writes: list[tuple] = []
        self.deleted = False
        self.commits = 0
        self.rollbacks = 0
        self.population_check: dict | None = None


class FakeCursor:
    def __init__(self, db: FakeDb):
        self.db, self._rows = db, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        s = " ".join(sql.split())
        db = self.db
        if s.startswith("SELECT id FROM sources"):
            self._rows = [(db.sources[params[0]],)]
        elif s.startswith("SELECT external_id, player_id FROM external_identities WHERE source_id = %s AND match_method"):
            self._rows = list(db.identities.items())
        elif s.startswith("INSERT INTO players"):
            pid = db.next_id
            db.next_id += 1
            db.inserted_players.append(params)
            self._rows = [(pid,)]
        elif s.startswith("UPDATE players SET display_name"):
            db.updated_players.append(params[-1])
            self._rows = []
        elif s.startswith("SELECT id, dob FROM players"):
            self._rows = [(pid, None) for pid in params[0]]
        elif s.startswith("SELECT external_id, player_id FROM external_identities WHERE source_id = %s AND external_id = ANY"):
            self._rows = [(ext, pid) for ext, pid in db.identities.items() if ext in params[1]]
        elif s.startswith("SELECT count(*)"):
            asserted = set(params[0])
            self._rows = [(len(db.identities),
                           sum(1 for ext in db.identities if ext not in asserted))]
        elif s.startswith("DELETE FROM external_identities"):
            db.deleted = True
            self._rows = []
        else:
            self._rows = []

    def executemany(self, sql, rows):
        s = " ".join(sql.split())
        rows = list(rows)
        if s.startswith("INSERT INTO external_identities"):
            self.db.identity_writes = rows
        elif s.startswith("INSERT INTO player_birth_evidence"):
            self.db.evidence_writes = rows

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class FakePg:
    def __init__(self, db: FakeDb):
        self.db = db

    def cursor(self):
        return FakeCursor(self.db)

    def commit(self):
        self.db.commits += 1

    def rollback(self):
        self.db.rollbacks += 1


class FakeBatch:
    def __init__(self):
        self.id, self.records_read = 555, 0
        self.records_inserted, self.records_updated = 0, 0


def stand_in_common(db: FakeDb) -> types.ModuleType:
    mod = types.ModuleType("common")

    @contextlib.contextmanager
    def import_batch(conn, source_key, tool, target_table=None):
        batch = FakeBatch()
        try:
            yield batch
        except Exception:
            conn.rollback()
            raise

    def check_population_drop(**kwargs):
        db.population_check = kwargs

    mod.import_batch = import_batch
    mod.check_population_drop = check_population_drop
    return mod


class Rep:
    def warn(self, msg):
        pass

    def result(self, *a):
        pass


class Args:
    source_key = "afltables"
    acknowledge_population_drop = False


def run_import(identities: dict[str, int]):
    players = players_split()
    fz.apply_profile_continuity(players, [RULE])
    other = fact("players/M/Marcus_Bontempelli.html", "103", (2014, date(2014, 3, 1), 1),
                 (2024, date(2024, 9, 1), 250), 250)
    other.given_name, other.surname, other.display_name = "Marcus", "Bontempelli", "Marcus Bontempelli"
    players[other.url] = other
    db = FakeDb(identities)
    saved = sys.modules.get("common")
    sys.modules["common"] = stand_in_common(db)
    try:
        fz.import_players(FakePg(db), Rep(), players, Args(), refs={})
        error = None
    except RuntimeError as exc:
        error = str(exc)
    finally:
        if saved is None:
            sys.modules.pop("common", None)
        else:
            sys.modules["common"] = saved
    return db, error


db, error = run_import({})
by_ext = {ext: (pid, note) for _, ext, _, pid, _, note in db.identity_writes}
check("3a clean database: no error, two players inserted (folded + other), none updated",
      error is None and len(db.inserted_players) == 2 and db.updated_players == [], str(error))
check("3b three identities asserted for two players; both John Smith paths share one id",
      len(db.identity_writes) == 3 and CONT in by_ext and RENUM in by_ext
      and by_ext[CONT][0] == by_ext[RENUM][0]
      and by_ext[CONT][0] != by_ext["players/M/Marcus_Bontempelli.html"][0], str(by_ext))
check("3c the renumbered path's note records the continuity rule and the continuing path",
      "AFLDB-ISSUE-136" in by_ext[RENUM][1] and "fixture" in by_ext[RENUM][1]
      and CONT in by_ext[RENUM][1] and "AFLDB-ISSUE-136" not in by_ext[CONT][1])
check("3d DOB evidence is keyed on the continuing path only",
      [row[2] for row in db.evidence_writes] == [CONT], str(db.evidence_writes))
check("3e the population gate sees every path (3 asserted) before the reconciliation delete",
      db.population_check is not None and db.population_check["asserted_count"] == 3
      and db.deleted and db.commits == 1)

db, error = run_import({CONT: 7, RENUM: 7, "players/M/Marcus_Bontempelli.html": 8})
check("3f both paths already on one player: that player is updated, nothing inserted",
      error is None and db.inserted_players == [] and sorted(db.updated_players) == [7, 8],
      f"{error} {db.updated_players}")
check("3g and both paths are re-asserted against that same id",
      {pid for _, ext, _, pid, _, _ in db.identity_writes if ext in (CONT, RENUM)} == {7})

db, error = run_import({CONT: 7, RENUM: 9})
check("3h the SPLIT database HALTs: the two paths registered to different players",
      error is not None and "external-identity split" in error, str(error))
check("3i ...before any identity upsert, before the reconciliation delete, rolled back",
      db.identity_writes == [] and not db.deleted and db.commits == 0 and db.rollbacks == 1)
check("3j the halt names both paths and both players, and refuses to choose",
      error is not None and CONT in error and RENUM in error and "[7, 9]" in error
      and "refusing to merge or choose" in error, str(error))

db, error = run_import({CONT: 7})
check("3k only the continuing path registered (pre-fix database): updated, renumbered path added to it",
      error is None and db.updated_players and 7 in db.updated_players
      and by_ext.keys() and {pid for _, ext, _, pid, _, _ in db.identity_writes
                              if ext in (CONT, RENUM)} == {7}, str(error))


# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    sys.exit(1)
print("all checks passed")
