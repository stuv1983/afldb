#!/usr/bin/env python3
"""AFLDB-ISSUE-228 Stage S5 -- DB-free contract checks for
tools/migration/build_afl_api_player_bridge.py (the offline evidence builder)
and tools/migration/import_afl_api_player_bridge.py (the fail-closed loader).

    python tests/python/afl_api_bridge_contract.py

Every check exercises the modules' pure functions against fabricated evidence
or a minimal fake database cursor. No real sample corpus file, no real
afldb_test connection, no network request, no Git command.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tools" / "migration"
sys.path.insert(0, str(TOOL_DIR))

import build_afl_api_brownlow_name_bridge as name_bridge  # noqa: E402
import build_afl_api_player_bridge as builder  # noqa: E402
import import_afl_api_player_bridge as loader  # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


# ---------------------------------------------------------------------------
# num_or_none (Sec 4.4 -- must agree with afl-api-bundle.ts numOrNull())
# ---------------------------------------------------------------------------

section("num_or_none")
check("None passes through as None", builder.num_or_none(None) is None)
check("integral float 9.0 -> int 9", builder.num_or_none(9.0) == 9 and isinstance(builder.num_or_none(9.0), int))
check("plain int 12 -> int 12", builder.num_or_none(12) == 12)
check("zero -> 0, not None", builder.num_or_none(0.0) == 0)

try:
    builder.num_or_none(9.5)
    check("non-integral value refuses", False, "did not raise")
except builder.BridgeSourceError:
    check("non-integral value refuses", True)

try:
    builder.num_or_none(True)
    check("bool is refused (not a real count)", False, "did not raise")
except builder.BridgeSourceError:
    check("bool is refused (not a real count)", True)


# ---------------------------------------------------------------------------
# normalise_surname
# ---------------------------------------------------------------------------

section("normalise_surname")
check("case-insensitive", builder.normalise_surname("Smith") == builder.normalise_surname("SMITH"))
check("strips accents", builder.normalise_surname("Petracca") == builder.normalise_surname("Petracca"))
check("O'Brien / OBrien equal after stripping punctuation",
      builder.normalise_surname("O'Brien") == builder.normalise_surname("OBrien"))
check("None -> empty string", builder.normalise_surname(None) == "")
check("distinct surnames stay distinct",
      builder.normalise_surname("Smith") != builder.normalise_surname("Jones"))


# ---------------------------------------------------------------------------
# FOLDER_RE -- the tracked sample-folder naming convention
# ---------------------------------------------------------------------------

section("FOLDER_RE")
m = builder.FOLDER_RE.match("2022-05-07_R8_BL_v_WCE_CD_M20220140807")
check("historical H&A folder parses", m is not None)
if m:
    check("historical: date", m.group("date") == "2022-05-07")
    check("historical: round", m.group("round") == "8")
    check("historical: home", m.group("home") == "BL")
    check("historical: away", m.group("away") == "WCE")
    check("historical: match id", m.group("match_id") == "CD_M20220140807")

m2 = builder.FOLDER_RE.match("2026-09-18_SYD_v_FRE_CD_M20260142802")
check("finals folder (no round token) parses", m2 is not None)
if m2:
    check("finals: round group is absent", m2.group("round") is None)
    check("finals: home", m2.group("home") == "SYD")
    check("finals: away", m2.group("away") == "FRE")

check("garbage folder name refused", builder.FOLDER_RE.match("not_a_sample_folder") is None)


# ---------------------------------------------------------------------------
# parse_player_stats (fabricated payload, no file I/O)
# ---------------------------------------------------------------------------

section("parse_player_stats")


class _FakeMatch:
    def __init__(self, tmp_path: Path):
        self.provider_match_id = "CD_M_FIXTURE"
        self.player_stats_path = tmp_path


def _entry(player_id: str, team_id: str, jumper: float, surname: str, **stats) -> dict:
    base_stats = {
        "kicks": 10.0, "handballs": 5.0, "marks": 3.0, "tackles": 4.0, "goals": 2.0,
        "behinds": 1.0, "hitouts": 0.0, "freesFor": 1.0, "freesAgainst": 0.0,
        "inside50s": 2.0, "clearances": {"totalClearances": 3.0}, "rebound50s": 1.0,
        "goalAssists": 0.0, "contestedPossessions": 6.0, "uncontestedPossessions": 8.0,
        "contestedMarks": 1.0, "marksInside50": 0.0, "onePercenters": 2.0,
        "bounces": 0.0, "clangers": 1.0,
    }
    base_stats.update(stats)
    return {
        "teamId": team_id,
        "playerStats": {
            "player": {
                "playerId": player_id,
                "playerJumperNumber": jumper,
                "playerName": {"givenName": "Fixture", "surname": surname},
            },
            "stats": base_stats,
        },
    }


def _write_fixture(tmp_path: Path, payload: dict) -> _FakeMatch:
    import json as _json
    tmp_path.write_text(_json.dumps(payload), encoding="utf-8")
    return _FakeMatch(tmp_path)


import tempfile

with tempfile.TemporaryDirectory() as tmp:
    tmp_dir = Path(tmp)

    payload_ok = {
        "homeTeamPlayerStats": [_entry("CD_I1", "CD_T10", 23.0, "Bloggs")],
        "awayTeamPlayerStats": [_entry("CD_I2", "CD_T20", 7.0, "Smith")],
    }
    fixture = _write_fixture(tmp_dir / "ok.json", payload_ok)
    rows = builder.parse_player_stats(fixture)
    check("two entries parsed", len(rows) == 2)
    check("provider ids read", {r.provider_player_id for r in rows} == {"CD_I1", "CD_I2"})
    check("jumper number coerced to int", rows[0].jumper_number == 23)
    check("clearances.totalClearances read", rows[0].stats["clearances"] == 3)
    check("surname carried for diagnostics only", rows[0].surname == "Bloggs")

    payload_dupe = {
        "homeTeamPlayerStats": [
            _entry("CD_I1", "CD_T10", 23.0, "Bloggs"),
            _entry("CD_I1", "CD_T10", 23.0, "Bloggs"),
        ],
    }
    fixture_dupe = _write_fixture(tmp_dir / "dupe.json", payload_dupe)
    try:
        builder.parse_player_stats(fixture_dupe)
        check("duplicate player in one match refuses", False, "did not raise")
    except builder.BridgeSourceError:
        check("duplicate player in one match refuses", True)


# ---------------------------------------------------------------------------
# classify_providers -- Sec 6.3 (a)-(d) acceptance
# ---------------------------------------------------------------------------

section("classify_providers")


class _FakeCursor:
    def __init__(self, surnames: dict[int, str]):
        self._surnames = surnames
        self._last: list[tuple] = []

    def execute(self, sql: str, params=None):
        player_ids = params[0]
        self._last = [(pid, self._surnames.get(pid)) for pid in player_ids]

    def fetchall(self):
        return self._last

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, surnames: dict[int, str]):
        self._surnames = surnames

    def cursor(self):
        return _FakeCursor(self._surnames)


def _evidence(external_id: str, surname: str | None, hits: list[tuple[str, int, int]]) -> builder.ProviderEvidence:
    ev = builder.ProviderEvidence(provider_player_id=external_id, observed_surname=surname,
                                   observed_given_name="Fixture")
    for provider_match_id, player_id, agreeing_count in hits:
        ev.hits.append(builder.MatchHit(provider_match_id=provider_match_id, player_id=player_id,
                                         agreeing_count=agreeing_count, core_agrees=True))
    return ev


# (a)/(c): >= 2 matched matches, same player each time, matching surname -> linked.
providers = {
    "CD_I100": _evidence("CD_I100", "Bloggs", [("CD_M1", 501, 13), ("CD_M2", 501, 13)]),
}
report = builder.classify_providers(providers, _FakeConn({501: "Bloggs"}))
check("2-match exact-agreement provider links", report["CD_I100"]["disposition"] == "linked")
check("linked row carries the candidate player id", report["CD_I100"].get("candidate_player_id") == 501)

# (c): exactly 1 match but >= 10 agreeing statistics -> linked.
providers = {"CD_I200": _evidence("CD_I200", "Smith", [("CD_M1", 502, 13)])}
report = builder.classify_providers(providers, _FakeConn({502: "Smith"}))
check("1 match with >=10 agreeing stats links", report["CD_I200"]["disposition"] == "linked")

# (c): exactly 1 match with < 10 agreeing statistics -> unresolved, never linked.
providers = {"CD_I201": _evidence("CD_I201", "Smith", [("CD_M1", 503, 9)])}
report = builder.classify_providers(providers, _FakeConn({503: "Smith"}))
check("1 match with <10 agreeing stats stays unresolved", report["CD_I201"]["disposition"] == "unresolved")
check("insufficient-evidence reason recorded", "insufficient_evidence" in (report["CD_I201"]["reason"] or ""))

# Zero candidates -> unresolved, never linked, never guessed.
providers = {"CD_I300": builder.ProviderEvidence(provider_player_id="CD_I300")}
report = builder.classify_providers(providers, _FakeConn({}))
check("zero-evidence provider is unresolved", report["CD_I300"]["disposition"] == "unresolved")
check("zero-evidence never linked", "candidate_player_id" not in report["CD_I300"])

# (h): one CD_I whose matches point at two different players -> contradictory, withheld.
providers = {
    "CD_I400": _evidence("CD_I400", "Ambiguous", [("CD_M1", 601, 13), ("CD_M2", 602, 13)]),
}
report = builder.classify_providers(providers, _FakeConn({601: "Ambiguous", 602: "Ambiguous"}))
check("provider matching two different players is contradictory",
      report["CD_I400"]["disposition"] == "contradictory")
check("contradictory row never carries a candidate player id",
      "candidate_player_id" not in report["CD_I400"])

# (h): two different CD_I both pointing at the same single player -> both withheld.
providers = {
    "CD_I500": _evidence("CD_I500", "Shared", [("CD_M1", 700, 13), ("CD_M2", 700, 13)]),
    "CD_I501": _evidence("CD_I501", "Shared", [("CD_M3", 700, 13), ("CD_M4", 700, 13)]),
}
report = builder.classify_providers(providers, _FakeConn({700: "Shared"}))
check("shared player_id: first provider withheld", report["CD_I500"]["disposition"] == "contradictory")
check("shared player_id: second provider withheld", report["CD_I501"]["disposition"] == "contradictory")

# (d): surname disagreement withholds an otherwise-qualifying pair.
providers = {"CD_I600": _evidence("CD_I600", "WrongName", [("CD_M1", 801, 13), ("CD_M2", 801, 13)])}
report = builder.classify_providers(providers, _FakeConn({801: "RightName"}))
check("surname disagreement withholds the pair even with strong stat evidence",
      report["CD_I600"]["disposition"] == "unresolved")
check("surname_disagrees reason recorded", "surname_disagrees" in (report["CD_I600"]["reason"] or ""))

# Determinism: re-running classify_providers over identical evidence reproduces
# the identical disposition and candidate (Sec 19.4(a) "a second run over
# identical evidence is a no-op" -- at the classification layer, "no-op" means
# "the same answer every time").
providers = {"CD_I700": _evidence("CD_I700", "Bloggs", [("CD_M1", 900, 13), ("CD_M2", 900, 13)])}
report_a = builder.classify_providers(providers, _FakeConn({900: "Bloggs"}))
report_b = builder.classify_providers(providers, _FakeConn({900: "Bloggs"}))
check("classification is deterministic across repeated runs",
      report_a["CD_I700"]["disposition"] == report_b["CD_I700"]["disposition"] == "linked"
      and report_a["CD_I700"]["candidate_player_id"] == report_b["CD_I700"]["candidate_player_id"])


# ---------------------------------------------------------------------------
# name_bridge.classify() -- S5b season-hardcoding fix (AFLDB-ISSUE-228 §9.10)
#
# classify() must thread its own `season` argument into season_club_roster(),
# never the module's SEASON=2025 constant. Proven by recording which season
# value reaches the roster query's own SQL parameters -- never by asserting a
# real roster match, which would require a live DB. Fails against the old
# implementation because classify() did not accept a `season` argument at all.
# ---------------------------------------------------------------------------

section("name_bridge.classify season threading (S5b)")


class _FakeRosterCursor:
    def __init__(self, club_ids: dict[str, int]):
        self._club_ids = club_ids
        self.roster_season_calls: list[int] = []
        self._last: list[tuple] = []

    def execute(self, sql: str, params=None):
        if "FROM clubs WHERE legacy_club_hist" in sql:
            hist_values = params[0]
            self._last = [(h, self._club_ids[h]) for h in hist_values if h in self._club_ids]
        elif "FROM player_match_stats" in sql:
            season, _club_id = params
            self.roster_season_calls.append(season)
            self._last = []  # zero-candidate roster -> "unresolved", never guessed
        elif sql.strip().startswith("SELECT id, surname FROM players"):
            self._last = []
        else:
            raise AssertionError(f"unexpected query: {sql!r}")

    def fetchall(self):
        return self._last

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeRosterConn:
    def __init__(self, cursor: _FakeRosterCursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


def _voter(provider_id: str, team_provider_id: str) -> name_bridge.ProviderVoter:
    return name_bridge.ProviderVoter(
        provider_id=provider_id, given_name="Test", surname="Player",
        team_provider_id=team_provider_id, team_abbr="TST",
    )


roster_team_identities = {"CD_T1": "HAWTHORN"}
roster_population = {"CD_I900": _voter("CD_I900", "CD_T1")}

cur_2022 = _FakeRosterCursor(club_ids={"HAWTHORN": 55})
name_bridge.classify(roster_population, ["CD_I900"], roster_team_identities, _FakeRosterConn(cur_2022), season=2022)
check("--season 2022 is threaded into season_club_roster(), not hardcoded 2025",
      cur_2022.roster_season_calls == [2022])

cur_default = _FakeRosterCursor(club_ids={"HAWTHORN": 55})
name_bridge.classify(roster_population, ["CD_I900"], roster_team_identities, _FakeRosterConn(cur_default),
                      season=name_bridge.SEASON)
check("omitted --season (CLI default 2025) still reaches season_club_roster() unchanged",
      cur_default.roster_season_calls == [name_bridge.SEASON] and name_bridge.SEASON == 2025)


# ---------------------------------------------------------------------------
# loader: linked_rows() only ever selects disposition == 'linked'
# ---------------------------------------------------------------------------

section("loader.linked_rows")

artefact = {
    "providers": {
        "CD_I1": {"disposition": "linked", "candidate_player_id": 1},
        "CD_I2": {"disposition": "unresolved"},
        "CD_I3": {"disposition": "contradictory"},
        "CD_I4": {"disposition": "linked", "candidate_player_id": 4},
    }
}
to_link = loader.linked_rows(artefact)
check("only linked rows are selected", set(to_link) == {"CD_I1", "CD_I4"})


# ---------------------------------------------------------------------------
# loader: S5b -- ALLOWED_MATCH_METHODS accepts both evidence classes, and
# apply_rows() writes each artefact's OWN declared match_method, never a
# hardcoded one (AFLDB-ISSUE-228 S5b, 2026-09-20).
# ---------------------------------------------------------------------------

section("loader.ALLOWED_MATCH_METHODS")

check(
    "stat-vector method is allowed",
    loader.MATCH_METHOD in loader.ALLOWED_MATCH_METHODS,
)
check(
    "name+team+season method is allowed",
    loader.NAME_TEAM_SEASON_MATCH_METHOD in loader.ALLOWED_MATCH_METHODS,
)
check(
    "an unrelated method is not allowed",
    "some_other_bootstrap" not in loader.ALLOWED_MATCH_METHODS,
)


class _FakeCursor:
    """Enough of a DB cursor for apply_rows(): no existing row for any id,
    so every candidate takes the INSERT branch and records the exact SQL
    parameters it was called with."""

    def __init__(self) -> None:
        self.inserted: list[tuple] = []

    def execute(self, sql: str, params: tuple | None = None) -> None:
        if sql.strip().startswith("SELECT"):
            self._last_select = True
        else:
            self._last_select = False
            if "INSERT INTO external_identities" in sql:
                self.inserted.append(params)

    def fetchone(self):
        return None  # classify_existing(): no existing row -> "would_link"


fake_cur = _FakeCursor()
fake_to_link = {
    "CD_I9": {
        "candidate_player_id": 9,
        "observed_name": "Test Player",
        "evidence_summary": "unique season-roster name match",
    }
}
loader.apply_rows(fake_cur, source_id=1, to_link=fake_to_link, rep=loader.Reporter(verbose=False),
                   batch=None, match_method=loader.NAME_TEAM_SEASON_MATCH_METHOD)
check(
    "apply_rows() writes the artefact's own match_method, not the hardcoded stat-vector one",
    fake_cur.inserted and fake_cur.inserted[0][4] == loader.NAME_TEAM_SEASON_MATCH_METHOD,
)


# ---------------------------------------------------------------------------
# loader: AFLDB-ISSUE-228 Sec 9.10 -- afl_api_manual_adjudication (CD_I293854
# / Matthew Taberner). Covers: the method is accepted, an unknown method is
# still refused, a manual row imports its OWN match_method, the new
# manual-only identity pre-check (player exists; declared afltables profile
# already resolves to the candidate), a genuine provider->player conflict is
# still refused/withheld (never overwritten), and identical replay against an
# already-linked identical mapping is a no-op -- all DB-free.
# ---------------------------------------------------------------------------

section("loader.MANUAL_ADJUDICATION_MATCH_METHOD (Sec 9.10)")

check(
    "afl_api_manual_adjudication is an allowed match_method",
    loader.MANUAL_ADJUDICATION_MATCH_METHOD in loader.ALLOWED_MATCH_METHODS,
)


def _write_manual_artefact(tmp_path: Path, match_method: str) -> Path:
    import json as _json
    payload = {
        "source_key": "afl_api",
        "match_method": match_method,
        "providers": {
            "CD_I293854": {
                "disposition": "linked",
                "candidate_player_id": 12205,
                "observed_name": "Matt Taberner",
                "canonical_afltables_profile_url": "players/M/Matthew_Taberner.html",
                "evidence_summary": "fixture",
            }
        },
    }
    path = tmp_path / "manual-artefact.json"
    path.write_text(_json.dumps(payload), encoding="utf-8")
    return path


with tempfile.TemporaryDirectory() as tmp:
    tmp_dir = Path(tmp)

    accepted_path = _write_manual_artefact(tmp_dir, loader.MANUAL_ADJUDICATION_MATCH_METHOD)
    accepted_artefact = loader.load_artefact(accepted_path, "afldb_test")
    check(
        "load_artefact() accepts an afl_api_manual_adjudication artefact",
        accepted_artefact["match_method"] == loader.MANUAL_ADJUDICATION_MATCH_METHOD,
    )

    refused_path = _write_manual_artefact(tmp_dir, "some_other_bootstrap")
    try:
        loader.load_artefact(refused_path, "afldb_test")
        check("load_artefact() still rejects an unknown match_method", False, "did not raise")
    except loader.ImportRefused:
        check("load_artefact() still rejects an unknown match_method", True)


class _FakeManualAdjudicationCursor:
    """DB-free cursor covering the three SELECTs the manual-adjudication path
    issues (players existence, afltables profile resolution, classify_existing)
    plus the two INSERTs (external_identities, data_issues). Every branch is
    driven by constructor flags, never a live connection."""

    def __init__(self, players_exists: bool = True, profile_owner: int | None = None,
                 existing_link: tuple[int, int] | None = None) -> None:
        self.players_exists = players_exists
        self.profile_owner = profile_owner
        self.existing_link = existing_link
        self.inserted: list[tuple] = []
        self.data_issues: list[tuple] = []
        self._pending: str | None = None

    def execute(self, sql: str, params: tuple | None = None) -> None:
        s = sql.strip()
        if s.startswith("SELECT 1 FROM players"):
            self._pending = "players"
        elif s.startswith("SELECT ei.player_id FROM external_identities"):
            self._pending = "profile"
        elif s.startswith("SELECT id, player_id FROM external_identities"):
            self._pending = "existing"
        elif s.startswith("INSERT INTO external_identities"):
            self._pending = None
            self.inserted.append(params)
        elif s.startswith("INSERT INTO data_issues"):
            self._pending = None
            self.data_issues.append(params)
        else:
            raise AssertionError(f"unexpected query: {sql!r}")

    def fetchone(self):
        if self._pending == "players":
            return (1,) if self.players_exists else None
        if self._pending == "profile":
            return (self.profile_owner,) if self.profile_owner is not None else None
        if self._pending == "existing":
            return self.existing_link
        return None


manual_to_link = {
    "CD_I293854": {
        "candidate_player_id": 12205,
        "observed_name": "Matt Taberner",
        "canonical_afltables_profile_url": "players/M/Matthew_Taberner.html",
        "evidence_summary": "manual adjudication fixture",
    }
}

# Happy path: player exists, declared afltables profile already resolves to
# the SAME candidate, no existing link -> inserts, carrying the artefact's
# own match_method, no data_issues row.
cur_ok = _FakeManualAdjudicationCursor(players_exists=True, profile_owner=12205, existing_link=None)
loader.apply_rows(cur_ok, source_id=1, to_link=manual_to_link, rep=loader.Reporter(verbose=False),
                   batch=None, match_method=loader.MANUAL_ADJUDICATION_MATCH_METHOD)
check(
    "a manual adjudication row imports its OWN match_method, not another",
    bool(cur_ok.inserted) and cur_ok.inserted[0][4] == loader.MANUAL_ADJUDICATION_MATCH_METHOD,
)
check("manual adjudication happy path opens no data_issues row", cur_ok.data_issues == [])

# Pre-write identity check: candidate player_id must exist.
cur_missing_player = _FakeManualAdjudicationCursor(players_exists=False)
try:
    loader.apply_rows(cur_missing_player, source_id=1, to_link=manual_to_link, rep=loader.Reporter(verbose=False),
                       batch=None, match_method=loader.MANUAL_ADJUDICATION_MATCH_METHOD)
    check("manual adjudication refuses a nonexistent candidate player_id", False, "did not raise")
except loader.ImportRefused:
    check("manual adjudication refuses a nonexistent candidate player_id", True)
check("no row inserted when the candidate player_id does not exist", cur_missing_player.inserted == [])

# Pre-write identity check: declared afltables profile must resolve to the SAME candidate.
cur_bad_profile = _FakeManualAdjudicationCursor(players_exists=True, profile_owner=99999)
try:
    loader.apply_rows(cur_bad_profile, source_id=1, to_link=manual_to_link, rep=loader.Reporter(verbose=False),
                       batch=None, match_method=loader.MANUAL_ADJUDICATION_MATCH_METHOD)
    check("manual adjudication refuses when the declared afltables profile resolves elsewhere", False, "did not raise")
except loader.ImportRefused:
    check("manual adjudication refuses when the declared afltables profile resolves elsewhere", True)
check("no row inserted when the declared afltables profile disagrees", cur_bad_profile.inserted == [])

# Conflicting provider -> player mapping: still refused/withheld, never overwritten.
cur_conflict = _FakeManualAdjudicationCursor(players_exists=True, profile_owner=12205, existing_link=(999, 55555))
loader.apply_rows(cur_conflict, source_id=1, to_link=manual_to_link, rep=loader.Reporter(verbose=False),
                   batch=None, match_method=loader.MANUAL_ADJUDICATION_MATCH_METHOD)
check("conflicting provider->player mapping is never overwritten by manual adjudication", cur_conflict.inserted == [])
check("conflicting mapping opens exactly one data_issues row instead", len(cur_conflict.data_issues) == 1)

# Idempotent replay: an identical mapping already linked to the SAME player
# is a no-op -- no re-insert, no data_issues row, no exception.
cur_replay = _FakeManualAdjudicationCursor(players_exists=True, profile_owner=12205, existing_link=(42, 12205))
replay_stats = loader.apply_rows(cur_replay, source_id=1, to_link=manual_to_link, rep=loader.Reporter(verbose=False),
                                  batch=None, match_method=loader.MANUAL_ADJUDICATION_MATCH_METHOD)
check(
    "identical replay against an already-linked identical mapping is idempotent",
    cur_replay.inserted == [] and cur_replay.data_issues == [] and replay_stats.already_linked == 1,
)


# ---------------------------------------------------------------------------
# loader: DSN safety refuses anything that is not afldb_test
# ---------------------------------------------------------------------------

section("loader DSN safety")

try:
    loader._resolve_dsn("AFLDB_TEST_DATABASE_URL_DOES_NOT_EXIST", "afldb_test")
    check("unset DSN env var refuses", False, "did not raise")
except loader.ImportRefused:
    check("unset DSN env var refuses", True)

import os as _os

_os.environ["_AFLDB_BRIDGE_TEST_DSN"] = "postgresql://user:pw@localhost:5432/afldb_dev"
try:
    loader._resolve_dsn("_AFLDB_BRIDGE_TEST_DSN", "afldb_test")
    check("DSN targeting the wrong database refuses", False, "did not raise")
except loader.ImportRefused:
    check("DSN targeting the wrong database refuses", True)
finally:
    del _os.environ["_AFLDB_BRIDGE_TEST_DSN"]

_os.environ["_AFLDB_BRIDGE_TEST_DSN"] = "postgresql://user:pw@localhost:5432/afldb_test"
try:
    dsn = loader._resolve_dsn("_AFLDB_BRIDGE_TEST_DSN", "afldb_test")
    check("DSN targeting afldb_test is accepted", dsn.endswith("/afldb_test"))
finally:
    del _os.environ["_AFLDB_BRIDGE_TEST_DSN"]


# ---------------------------------------------------------------------------
# loader: AFLDB-ISSUE-228 S9 -- target generalisation (TARGETS dict wiring).
# All DB-free: the dict is inspected directly, never a live connection.
# ---------------------------------------------------------------------------

section("loader.TARGETS (S9 target generalisation)")

check("only afldb_test and dev targets exist -- no PROD target",
      set(loader.TARGETS) == {"afldb_test", "dev"})
check("'prod' is not a target", "prod" not in loader.TARGETS)
check("afldb_test read DSN env is unchanged (AFLDB_TEST_DATABASE_URL)",
      loader.TARGETS["afldb_test"]["read_dsn_env"] == "AFLDB_TEST_DATABASE_URL")
check("afldb_test write DSN env is unchanged (AFLDB_TEST_IMPORT_DATABASE_URL)",
      loader.TARGETS["afldb_test"]["write_dsn_env"] == "AFLDB_TEST_IMPORT_DATABASE_URL")
check("afldb_test database is unchanged", loader.TARGETS["afldb_test"]["database"] == "afldb_test")
check("afldb_test carries no role gate (preserves S5/S5b/Sec 9.10 behaviour)",
      loader.TARGETS["afldb_test"]["read_role"] is None
      and loader.TARGETS["afldb_test"]["write_role"] is None)
check("dev read target resolves to DATABASE_URL / afldb_dev",
      loader.TARGETS["dev"]["read_dsn_env"] == "DATABASE_URL"
      and loader.TARGETS["dev"]["database"] == "afldb_dev")
check("dev write target resolves to AFLDB_IMPORT_DATABASE_URL / afldb_dev",
      loader.TARGETS["dev"]["write_dsn_env"] == "AFLDB_IMPORT_DATABASE_URL"
      and loader.TARGETS["dev"]["database"] == "afldb_dev")
check("dev role gates expect afldb_app (read) / afldb_import (write)",
      loader.TARGETS["dev"]["read_role"] == "afldb_app"
      and loader.TARGETS["dev"]["write_role"] == "afldb_import")


# ---------------------------------------------------------------------------
# loader: CLI argument contract -- --artefact is mandatory, no PROD target,
# the old lexical default-artefact selection is gone. Argparse validation
# happens before common.load_env()/any DB access, so these are DB-free.
# ---------------------------------------------------------------------------

section("loader CLI argument contract (S9)")

try:
    loader.main(["--validate-only"])
    check("--artefact is required", False, "did not raise/exit")
except SystemExit as exc:
    check("--artefact is required", exc.code != 0)

check("old lexical default-artefact selection is gone",
      not hasattr(loader, "default_artefact_path"))

try:
    loader.main(["--validate-only", "--artefact", "x.json", "--target", "prod"])
    check("unknown target refused by argparse", False, "did not raise/exit")
except SystemExit as exc:
    check("unknown target refused by argparse", exc.code != 0)


# ---------------------------------------------------------------------------
# loader.load_artefact(): the three pre-existing evidence classes are still
# accepted for --target afldb_test (S9 must not regress S5/S5b/Sec 9.10).
# ---------------------------------------------------------------------------

section("loader.load_artefact() -- existing three classes still accepted for afldb_test")


def _write_artefact(tmp_path: Path, payload: dict, name: str) -> Path:
    import json as _json
    path = tmp_path / name
    path.write_text(_json.dumps(payload), encoding="utf-8")
    return path


_BASE_PROVIDERS = {
    "CD_I1": {"disposition": "linked", "candidate_player_id": 1, "observed_name": "Test Player",
              "evidence_summary": "fixture"},
}

with tempfile.TemporaryDirectory() as tmp:
    tmp_dir = Path(tmp)

    for _i, _method in enumerate((
        loader.MATCH_METHOD, loader.NAME_TEAM_SEASON_MATCH_METHOD,
        loader.MANUAL_ADJUDICATION_MATCH_METHOD,
    )):
        _path = _write_artefact(
            tmp_dir, {"source_key": "afl_api", "match_method": _method, "providers": _BASE_PROVIDERS},
            name=f"existing-class-{_i}.json",
        )
        _artefact = loader.load_artefact(_path, "afldb_test")
        check(f"{_method!r} still accepted for --target afldb_test", _artefact["match_method"] == _method)


# ---------------------------------------------------------------------------
# loader.load_artefact(): afl_api_stat_vector_season provenance gate (S9).
# Every check is DB-free: fabricated artefacts only, never a real evidence
# artefact or a live connection.
# ---------------------------------------------------------------------------

section("loader.load_artefact() -- afl_api_stat_vector_season provenance gate (S9)")


def _season_payload(**overrides) -> dict:
    payload = {
        "source_key": "afl_api",
        "match_method": loader.SEASON_EVIDENCE_MATCH_METHOD,
        "built_from_database": "afldb_dev",
        "read_only": True,
        "season": 2026,
        "snapshot_label": "afl-api-2026-fixture-label",
        "snapshot_manifest_sha256": "0" * 64,
        "existing_claim_comparison": "unproved_cross_database_id_parity",
        "providers": _BASE_PROVIDERS,
    }
    payload.update(overrides)
    return payload


with tempfile.TemporaryDirectory() as tmp:
    tmp_dir = Path(tmp)

    _ok_path = _write_artefact(tmp_dir, _season_payload(), name="season-ok.json")
    _accepted = loader.load_artefact(_ok_path, "dev")
    check(
        "afl_api_stat_vector_season accepted under --target dev with intact provenance",
        _accepted["match_method"] == loader.SEASON_EVIDENCE_MATCH_METHOD,
    )

    _refuse_cases = [
        ("refused for --target afldb_test", {}, "afldb_test"),
        ("refused if built_from_database != afldb_dev", {"built_from_database": "afldb_test"}, "dev"),
        ("refused if read_only is false", {"read_only": False}, "dev"),
        ("refused if read_only is missing/null", {"read_only": None}, "dev"),
        ("refused if season is non-numeric", {"season": "2026"}, "dev"),
        ("refused if season is a bool", {"season": True}, "dev"),
        ("refused if snapshot_label is empty", {"snapshot_label": ""}, "dev"),
        ("refused if snapshot_label is missing/null", {"snapshot_label": None}, "dev"),
        ("refused if snapshot_manifest_sha256 is too short", {"snapshot_manifest_sha256": "abc"}, "dev"),
        ("refused if snapshot_manifest_sha256 is uppercase", {"snapshot_manifest_sha256": "A" * 64}, "dev"),
        ("refused if existing_claim_comparison is wrong", {"existing_claim_comparison": "proved"}, "dev"),
        ("refused if existing_claim_comparison is missing/null", {"existing_claim_comparison": None}, "dev"),
    ]
    for _i, (_label, _overrides, _target) in enumerate(_refuse_cases):
        _path = _write_artefact(tmp_dir, _season_payload(**_overrides), name=f"season-refused-{_i}.json")
        try:
            loader.load_artefact(_path, _target)
            check(f"season evidence {_label}", False, "did not raise")
        except loader.ImportRefused:
            check(f"season evidence {_label}", True)


# ---------------------------------------------------------------------------
# loader: DSN/path refusal messages never expose a password or other secret.
# ---------------------------------------------------------------------------

section("loader refusal messages never expose a secret")

_os.environ["_AFLDB_BRIDGE_TEST_DSN_PW"] = "postgresql://user:supersecretpw@localhost:5432/afldb_dev"
try:
    loader._resolve_dsn("_AFLDB_BRIDGE_TEST_DSN_PW", "afldb_test")
    check("wrong-database DSN refusal raised", False, "did not raise")
except loader.ImportRefused as exc:
    check("wrong-database DSN refusal never leaks the password", "supersecretpw" not in str(exc))
finally:
    del _os.environ["_AFLDB_BRIDGE_TEST_DSN_PW"]

try:
    loader.load_artefact(Path("does-not-exist-anywhere.json"), "afldb_test")
    check("missing-artefact refusal raised", False, "did not raise")
except loader.ImportRefused as exc:
    check("missing-artefact refusal names only the path, no secret",
          "does-not-exist-anywhere.json" in str(exc))


# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} afl_api player-bridge contract check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    raise SystemExit(1)
print("All afl_api player-bridge contract checks passed.")
