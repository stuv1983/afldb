#!/usr/bin/env python3
"""AFLDB-ISSUE-228 Stage S5 -- DB-free contract checks for
tools/migration/build_afl_api_player_bridge.py (the offline evidence builder)
and the retired tools/migration/import_afl_api_player_bridge.py stub (AFLDB-ISSUE-241: the
loader is now tools/migration/import_afl_api_player_bridge.ts, pinned by
tests/afl-api-player-bridge-import.test.ts).

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
# loader: RETIRED (AFLDB-ISSUE-241). tools/migration/import_afl_api_player_bridge.py is now a
# stub that refuses every invocation; the loader is tools/migration/import_afl_api_player_bridge.ts
# and its contract (closed targets, DSN safety, the season provenance gate, pinned inputs, the
# AFLDB-ISSUE-235 P1-P5 human-row behaviour, the ISSUE-241 identity contract and the ISSUE-240
# dedup) is pinned DB-free by tests/afl-api-player-bridge-import.test.ts.
# ---------------------------------------------------------------------------

section("loader (retired Python stub, AFLDB-ISSUE-241)")

import contextlib as _contextlib
import io as _io

_stderr = _io.StringIO()
with _contextlib.redirect_stderr(_stderr):
    _code = loader.main(["--apply", "--artefact", "x.json"])
check("the retired Python loader refuses every invocation", _code == 1)
check("its refusal names the TypeScript replacement",
      "import_afl_api_player_bridge.ts" in _stderr.getvalue())
_stub_source = Path(loader.__file__).read_text(encoding="utf-8")
check("the stub opens no connection and writes nothing (no psycopg, no SQL)",
      "psycopg" not in _stub_source and "INSERT INTO" not in _stub_source)


# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} afl_api player-bridge contract check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    raise SystemExit(1)
print("All afl_api player-bridge contract checks passed.")
