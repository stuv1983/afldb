#!/usr/bin/env python3
"""AFLDB-ISSUE-233 D-233-2 -- DB-free contract checks for
tools/migration/brownlow_afl_api_season_rehearsal.py (the code_test_db write-path rehearsal and
its eight-player prerequisite fixture).

    python tests/python/brownlow_afl_api_season_rehearsal_contract.py

Every check exercises the harness's pure planning and judging functions against fabricated
artefact rows, an in-memory ProfileResolver, fabricated journal documents and temporary
directories. No database connection, no network request, no Git command, and the harness's
`run` / `restore` / `residue` subcommands are never executed. Where the genuine 2026 artefact
exists at its evidence path, it is read (never written) to prove the exact eight-path plan.
"""

from __future__ import annotations

import inspect
import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tools" / "migration"
sys.path.insert(0, str(TOOL_DIR))

import brownlow_afl_api_season_rehearsal as h
import import_brownlow_season as loader

GENUINE_DIR = Path(r"D:\tmp\issue233\brownlow-2026")

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


def refusal(fn, *args, **kwargs) -> str:
    try:
        fn(*args, **kwargs)
    except h.RehearsalRefused as exc:
        return str(exc)
    return ""


def vote_row(path: str, *, season: int = 2026, votes: int = 1, bootstrap: int = 1,
             name: str | None = None, winner: bool = False) -> loader.SeasonVoteRow:
    return loader.SeasonVoteRow(
        season=season, afltables_profile_url=path, votes=votes, vote_rank=1, eligible_rank=1,
        is_ineligible=False, is_winner=winner, games=10, three_vote_games=None,
        two_vote_games=None, one_vote_games=1, polling_games=1, link_status_value="unique",
        bootstrap_player_id=bootstrap, display_name=name or path.rsplit("/", 1)[1][:-5].replace("_", " "),
        legacy_source_record_id=f"afl_api-brownlow-season:{season}:CD_I{bootstrap}:snap")


FIXTURE = list(h.FIXTURE_PROFILE_PATHS)
# The DEV surrogate ids the genuine artefact carries as review-only bootstrap_player_id.
DEV_IDS = {"players/D/Dyson_Sharp.html": 13329, "players/H/Harry_Dean.html": 13341,
           "players/J/Jagga_Smith.html": 13290, "players/J/Joel_Fitzgerald.html": 13313,
           "players/M/Milan_Murdock.html": 13328, "players/P/Phoenix_Gothard.html": 13356,
           "players/S/Sam_Swadling.html": 13331, "players/Z/Zeke_Uwland.html": 13296}
OTHERS = [f"players/A/Existing_Player{i}.html" for i in range(175)]


def artefact_rows(fixture_paths=FIXTURE, others=OTHERS) -> list[loader.SeasonVoteRow]:
    rows = [vote_row(p, bootstrap=DEV_IDS.get(p, 5000 + i)) for i, p in enumerate(fixture_paths)]
    rows += [vote_row(p, bootstrap=1000 + i) for i, p in enumerate(others)]
    return sorted(rows, key=lambda r: (r.season, r.afltables_profile_url))


def resolver_for(paths_to_ids: dict[str, list[int]]) -> loader.ProfileResolver:
    return loader.ProfileResolver.from_pairs(
        (path, pid) for path, ids in paths_to_ids.items() for pid in ids)


BASELINE = {p: [100 + i] for i, p in enumerate(OTHERS)}
DSN = "postgresql://afldb_owner:s3cret-pw@127.0.0.1:55432/{db}"


# ---------------------------------------------------------------------------
section("1. Target guard: exactly code_test_db; afldb_dev/afldb_test/afldb_prod and any other name refused")

for name in ("afldb_dev", "afldb_test", "afldb_prod"):
    message = refusal(h.database_of_dsn, DSN.format(db=name), h.OWNER_ENV)
    check(f"1. {name} is refused by name", "refuses by name" in message and "s3cret-pw" not in message,
          message)
for name in ("postgres", "code_test_db_x", "CODE_TEST_DB", "code_test", "afldb_test_copy", ""):
    message = refusal(h.database_of_dsn, DSN.format(db=name), h.OWNER_ENV)
    check(f"1. arbitrary name {name!r} is refused as not exactly code_test_db",
          "not exactly code_test_db" in message and "s3cret-pw" not in message, message)
check("1. a keyword DSN is refused (it can hide its database)",
      "postgresql:// URL" in refusal(h.database_of_dsn, "dbname=code_test_db host=x", h.OWNER_ENV))
check("1. a ?dbname= override is refused",
      "could point it at another database" in refusal(
          h.database_of_dsn, DSN.format(db="code_test_db") + "?dbname=afldb_prod", h.OWNER_ENV))
check("1. a ?service= override is refused",
      "could point it at another database" in refusal(
          h.database_of_dsn, DSN.format(db="code_test_db") + "?service=prod", h.OWNER_ENV))
check("1. exactly code_test_db is accepted (postgresql:// and postgres://)",
      h.database_of_dsn(DSN.format(db="code_test_db"), h.OWNER_ENV) == "code_test_db"
      and h.database_of_dsn("postgres://u:p@h:1/code_test_db", h.IMPORT_ENV) == "code_test_db")

good_owner = DSN.format(db="code_test_db")
good_import = "postgresql://afldb_import:other-pw@127.0.0.1:55432/code_test_db"
check("1. resolve_dsns reads exactly the two code_test_db variables",
      h.resolve_dsns({h.OWNER_ENV: good_owner, h.IMPORT_ENV: good_import}) == (good_owner, good_import))
decoys = {"AFLDB_IMPORT_DATABASE_URL": good_import, "AFLDB_DATABASE_URL": good_owner,
          "AFLDB_TEST_DATABASE_URL": good_owner, "AFLDB_TEST_IMPORT_DATABASE_URL": good_import,
          "DATABASE_URL": good_owner}
check("1. no other variable can name the target (every decoy set, the two unset -> refused)",
      f"{h.OWNER_ENV} is not set" in refusal(h.resolve_dsns, decoys))
check("1. a missing import DSN is refused",
      f"{h.IMPORT_ENV} is not set" in refusal(h.resolve_dsns, {h.OWNER_ENV: good_owner}))
check("1. identical owner/import DSNs are refused (the loader must run as afldb_import)",
      "identical" in refusal(h.resolve_dsns, {h.OWNER_ENV: good_owner, h.IMPORT_ENV: good_owner}))
check("1. an afldb_test import DSN is refused even with a good owner DSN",
      "refuses by name" in refusal(h.resolve_dsns, {h.OWNER_ENV: good_owner,
                                                    h.IMPORT_ENV: DSN.format(db="afldb_test")}))
source = inspect.getsource(h)
env_names = set(re.findall(r"AFLDB_[A-Z_]*DATABASE_URL", source))
check("1. the module names no DSN variable except the two code_test_db ones",
      env_names == {h.OWNER_ENV, h.IMPORT_ENV}, str(sorted(env_names)))
check("1. the module never calls the loader's env helpers (load_env / require_env)",
      "load_env(" not in source and "require_env(" not in source)
parser = h.build_parser()
dests = {action.dest for sub in parser._subparsers._group_actions for choice in sub.choices.values()
         for action in choice._actions}
check("1. no argv option can carry a DSN", not any(re.search(r"dsn|url|database|host", d) for d in dests),
      str(sorted(dests)))
check("1. --acknowledge must be exactly code_test_db",
      "--acknowledge code_test_db is required" in refusal(h.require_acknowledgement, "afldb_test")
      and refusal(h.require_acknowledgement, "code_test_db") == "")
with tempfile.TemporaryDirectory() as tmp:
    code = h.main(["run", "--acknowledge", "afldb_dev", "--artefact-dir", tmp,
                   "--evidence", str(Path(tmp) / "e")])
check("1. run with a wrong acknowledgement exits 2 before reading any DSN or input",
      code == 2)
check("1. redact() removes a password a driver message might echo",
      h.redact("FATAL for s3cret-pw", good_owner) == "FATAL for ***")
check("1. the child CLI environment carries no DSN or libpq variable",
      not any("DATABASE_URL" in k.upper() or k.upper().startswith("PG") for k in h.scrubbed_environment()))


# ---------------------------------------------------------------------------
section("2. The exact eight-path set")

check("2. FIXTURE_PROFILE_PATHS is exactly the eight measured paths",
      set(FIXTURE) == {"players/D/Dyson_Sharp.html", "players/H/Harry_Dean.html",
                       "players/J/Jagga_Smith.html", "players/J/Joel_Fitzgerald.html",
                       "players/M/Milan_Murdock.html", "players/P/Phoenix_Gothard.html",
                       "players/S/Sam_Swadling.html", "players/Z/Zeke_Uwland.html"}
      and len(FIXTURE) == 8)
check("2. every fixture key is a full AFL Tables profile path",
      all(loader.PROFILE_URL.fullmatch(p) for p in FIXTURE))
plan = h.build_fixture_plan(artefact_rows())
check("2. the plan holds exactly the eight paths, in sorted order", plan.paths == sorted(FIXTURE))
check("2. display_name comes from the artefact row",
      {p.profile_path: p.display_name for p in plan.players}["players/D/Dyson_Sharp.html"] == "Dyson Sharp")
check("2. a seven-path set is refused",
      "exactly eight" in refusal(h.build_fixture_plan, artefact_rows(), FIXTURE[:7]))
check("2. a repeated path in the set is refused",
      "exactly eight" in refusal(h.build_fixture_plan, artefact_rows(), FIXTURE[:7] + FIXTURE[:1]))

if (GENUINE_DIR / h.CSV_NAME).is_file():
    genuine = h.load_fixture_source(GENUINE_DIR)
    check("2. GENUINE artefact: pinned hashes verify and the loader accepts it",
          genuine.artefact.csv_sha256 == h.PINNED_CSV_SHA256
          and genuine.artefact.manifest_sha256 == h.PINNED_MANIFEST_SHA256)
    check("2. GENUINE artefact: 183 rows, 1,242 votes, 1 winner, 14 ineligible",
          {k: loader.measure(genuine.artefact.rows)[k] for k in h.EXPECTED_ARTEFACT} == h.EXPECTED_ARTEFACT)
    check("2. GENUINE artefact: the plan is exactly the eight paths with the artefact's names",
          [(p.profile_path, p.display_name) for p in genuine.plan.players] == [
              ("players/D/Dyson_Sharp.html", "Dyson Sharp"), ("players/H/Harry_Dean.html", "Harry Dean"),
              ("players/J/Jagga_Smith.html", "Jagga Smith"), ("players/J/Joel_Fitzgerald.html", "Joel Fitzgerald"),
              ("players/M/Milan_Murdock.html", "Milan Murdock"), ("players/P/Phoenix_Gothard.html", "Phoenix Gothard"),
              ("players/S/Sam_Swadling.html", "Sam Swadling"), ("players/Z/Zeke_Uwland.html", "Zeke Uwland")])
    check("2. GENUINE artefact: continuity provenance verifies against the tracked contract (Jack Ross fold)",
          genuine.continuity["folds"] == [{"rule_id": "2025-jack-ross-renumbered-profile",
                                           "continuing_url": "players/J/Jack_Ross.html",
                                           "renumbered_url": "players/J/Jack_Ross3.html"}]
          and genuine.continuity["sha256"] == loader.sha256_file(ROOT / "tools/rebuild/fitzroy/fitzroy-contract.json"))
else:
    print(f"  SKIP  genuine artefact checks ({GENUINE_DIR} absent)")


# ---------------------------------------------------------------------------
section("3. A changed or missing artefact row refuses fixture construction")

missing_one = [r for r in artefact_rows() if r.afltables_profile_url != "players/S/Sam_Swadling.html"]
check("3. a missing fixture row refuses (named)",
      "players/S/Sam_Swadling.html" in refusal(h.build_fixture_plan, missing_one))
doubled = artefact_rows() + [vote_row("players/H/Harry_Dean.html", bootstrap=13341)]
check("3. a duplicated fixture row refuses", "more than one row" in refusal(h.build_fixture_plan, doubled))
off_season = [vote_row(p, season=2025) if p == FIXTURE[0] else vote_row(p) for p in FIXTURE + OTHERS]
check("3. a fixture row from another season refuses", "not 2026" in refusal(h.build_fixture_plan, off_season))
blank = [vote_row(p, name=" ") if p == FIXTURE[1] else vote_row(p) for p in FIXTURE + OTHERS]
check("3. a fixture row without a display_name refuses", "no display_name" in refusal(h.build_fixture_plan, blank))
with tempfile.TemporaryDirectory() as tmp:
    tmp_path = Path(tmp)
    check("3. an absent artefact refuses", "does not exist" in refusal(h.load_fixture_source, tmp_path))
    if (GENUINE_DIR / h.CSV_NAME).is_file():
        changed = bytearray((GENUINE_DIR / h.CSV_NAME).read_bytes())
        changed[-3] = ord("9") if changed[-3] != ord("9") else ord("8")
        (tmp_path / h.CSV_NAME).write_bytes(bytes(changed))
        (tmp_path / h.MANIFEST_NAME).write_bytes((GENUINE_DIR / h.MANIFEST_NAME).read_bytes())
        check("3. one changed CSV byte refuses on the pinned hash",
              "is not the pinned" in refusal(h.load_fixture_source, tmp_path))
        (tmp_path / h.CSV_NAME).write_bytes((GENUINE_DIR / h.CSV_NAME).read_bytes())
        manifest = json.loads((GENUINE_DIR / h.MANIFEST_NAME).read_text(encoding="utf-8"))
        manifest["artefact"]["votes_total"] += 1
        (tmp_path / h.MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
        check("3. a changed manifest refuses on the pinned hash",
              "is not the pinned" in refusal(h.load_fixture_source, tmp_path))
        check("3. ... and, re-pinned, the loader's own check refuses it too",
              "artefact.votes_total" in refusal(h.load_fixture_source, tmp_path,
                                                manifest_sha256=loader.sha256_file(tmp_path / h.MANIFEST_NAME)))
        manifest = json.loads((GENUINE_DIR / h.MANIFEST_NAME).read_text(encoding="utf-8"))
        manifest["identity_evidence"]["profile_url_continuity"]["sha256"] = "0" * 64
        (tmp_path / h.MANIFEST_NAME).write_text(json.dumps(manifest), encoding="utf-8")
        check("3. a manifest whose continuity provenance names other rules refuses (even re-pinned)",
              "continuity provenance does not verify" in refusal(
                  h.load_fixture_source, tmp_path,
                  manifest_sha256=loader.sha256_file(tmp_path / h.MANIFEST_NAME)))


# ---------------------------------------------------------------------------
section("4. The measured prerequisite shape: drift (a pre-existing path) refuses setup")

rows = artefact_rows()
baseline = h.classify_resolution(resolver_for(BASELINE), rows)
check("4. the measured shape: 183 / 175 / 8 / 0, unresolved == the eight",
      {k: baseline[k] for k in h.EXPECTED_PREFLIGHT} == h.EXPECTED_PREFLIGHT
      and baseline["unresolved_paths"] == sorted(FIXTURE) and refusal(h.judge_preflight, baseline) == "")
appeared = h.classify_resolution(resolver_for({**BASELINE, FIXTURE[3]: [9999]}), rows)
message = refusal(h.judge_preflight, appeared)
check("4. one of the eight appearing since the preflight STOPS (never seeds seven)",
      "drifted" in message and "STOP" in message, message)
ambiguous = h.classify_resolution(resolver_for({**BASELINE, OTHERS[0]: [100, 101]}), rows)
check("4. an ambiguous path STOPS", "drifted" in refusal(h.judge_preflight, ambiguous))
swapped = dict(BASELINE)
del swapped[OTHERS[5]]
swapped[FIXTURE[0]] = [7777]
moved = h.classify_resolution(resolver_for(swapped), rows)
check("4. 175/8 but a different unresolved set STOPS",
      {k: moved[k] for k in h.EXPECTED_PREFLIGHT} == h.EXPECTED_PREFLIGHT
      and "not exactly the fixture's" in refusal(h.judge_preflight, moved))
collide = h.classify_resolution(resolver_for({**BASELINE, OTHERS[1]: [100]}), rows)
check("4. a same-season two-paths-one-player collision STOPS",
      collide["collisions"] == 1 and "drifted" in refusal(h.judge_preflight, collide))
check("4. an existing fixture slug / identity refuses the seed",
      "already present" in refusal(h.assert_fixture_absent, {"slugs": [plan.slugs[0]], "identities": []})
      and "already present" in refusal(h.assert_fixture_absent, {"identities": [[1, "afltables", FIXTURE[0]]]})
      and refusal(h.assert_fixture_absent, {"slugs": [], "identities": [], "noted_players": []}) == "")


# ---------------------------------------------------------------------------
section("5. The fixture plan: exactly 8 players + 8 identities, the importer's identity shape")

player_rows = h.fixture_player_rows(plan)
created = {p: 900001 + i for i, p in enumerate(plan.paths)}
identity_rows = h.fixture_identity_rows(plan, 3, created)
check("5. exactly eight player rows and eight identity rows", len(player_rows) == 8 and len(identity_rows) == 8)
check("5. identity shape: afltables source, exact path, afltables URL, unique, afltables_profile_url",
      all(r == (3, p.profile_path, "https://afltables.com/afl/stats/" + p.profile_path, created[p.profile_path],
                "unique", "afltables_profile_url", p.note)
          for r, p in zip(identity_rows, plan.players)))
check("5. synthetic fields carry the ISSUE-233 namespace",
      all(slug.startswith("afldb-issue-233-rehearsal-fixture-") for slug in plan.slugs)
      and all(r[1] == r[2] == r[3] and r[3].startswith(h.FIXTURE_SLUG_PREFIX) for r in player_rows))
check("5. notes carry the fixture marker and the exact path",
      all(p.note == f"{h.FIXTURE_NOTE}: {p.profile_path}" for p in plan.players))
check("5. identities need exactly the eight created ids",
      "exactly the eight" in refusal(h.fixture_identity_rows, plan, 3, dict(list(created.items())[:7])))
seed_source = inspect.getsource(h.seed_fixture)
check("5. the seed writes only players and external_identities (no match / PMS / PSS state)",
      set(re.findall(r"INSERT INTO (\w+)", seed_source)) == {"players", "external_identities"})


# ---------------------------------------------------------------------------
section("6. No DEV player id is ever a target id")

check("6. the player INSERT has no id / legacy_player_id column (code_test_db allocates ids)",
      not {"id", "legacy_player_id"} & set(h.FIXTURE_PLAYER_COLUMNS)
      and "id" not in h.FIXTURE_IDENTITY_COLUMNS)
flat = {v for r in player_rows for v in r}
check("6. no bootstrap_player_id (DEV surrogate id) appears in any fixture parameter",
      not (set(DEV_IDS.values()) & flat)
      and not (set(DEV_IDS.values()) & {v for r in identity_rows for v in r}))
check("6. identity player_ids are exactly the ids this run created",
      [r[3] for r in identity_rows] == [created[p] for p in plan.paths])
check("6. FixturePlayer carries no id field", "id" not in {f for f in h.FixturePlayer.__dataclass_fields__})


# ---------------------------------------------------------------------------
section("7. Post-seed: 183/183 and the eight resolve to exactly the fixture-created ids")

seeded = {**BASELINE, **{p: [created[p]] for p in FIXTURE}}
post = h.classify_resolution(resolver_for(seeded), rows)
check("7. 183 / 183 / 0 / 0 on the fixture ids", refusal(h.judge_post_seed, post, created) == "")
wrong_ids = {**created, FIXTURE[2]: 123}
check("7. a fixture path resolving to another id refuses",
      "do not resolve to the fixture-created ids" in refusal(h.judge_post_seed, post, wrong_ids))
stray = h.classify_resolution(resolver_for({**seeded, OTHERS[9]: [created[FIXTURE[0]]]}), rows)
check("7. a non-fixture path resolving to a fixture player refuses",
      refusal(h.judge_post_seed, stray, created) != "")
short = h.classify_resolution(resolver_for({**BASELINE, **{p: [created[p]] for p in FIXTURE[:7]}}), rows)
check("7. 182/183 refuses", "is not" in refusal(h.judge_post_seed, short, created))


# ---------------------------------------------------------------------------
section("8. Cleanup targets only rows the rehearsal created; no wildcard teardown")

planned = plan.to_json()
p_rows = [{"id": created[p["profile_path"]], "slug": p["slug"], "notes": p["note"]} for p in planned]
i_rows = [{"id": 70001 + n, "external_id": p["profile_path"], "player_id": created[p["profile_path"]],
           "notes": p["note"], "match_method": "afltables_profile_url"} for n, p in enumerate(planned)]
journal_ids = {"players": created, "identities": {p["profile_path"]: 70001 + n for n, p in enumerate(planned)}}
located = h.judge_located_fixture(planned, p_rows, i_rows, 900000, 70000, journal_ids)
check("8. the eight created rows are located by exact keys and match the journal ids",
      located == (sorted(created.values()), list(range(70001, 70009))))
check("8. after a crash before the journal recorded ids, exact keys still locate them",
      h.judge_located_fixture(planned, p_rows, i_rows, 900000, 70000, None) == located)
check("8. a seed that never committed (no rows, no ids) has nothing to delete",
      h.judge_located_fixture(planned, [], [], 900000, 70000, None) == ([], []))
check("8. a pre-existing row (id at/below the pre-max) is never treated as fixture",
      "not a row this rehearsal created" in refusal(h.judge_located_fixture, planned, p_rows, i_rows,
                                                   max(created.values()), 70000, None))
foreign_note = [dict(r) for r in p_rows]
foreign_note[0]["notes"] = "someone else's row"
check("8. a row with the right slug but another note refuses",
      "not a row this rehearsal created" in refusal(h.judge_located_fixture, planned, foreign_note,
                                                   i_rows, 900000, 70000, None))
check("8. a partial set (seven of eight) refuses",
      "all 8 or none" in refusal(h.judge_located_fixture, planned, p_rows[:7], i_rows, 900000, 70000, None))
check("8. located ids differing from the journal refuse",
      "not the ids the journal recorded" in refusal(
          h.judge_located_fixture, planned, p_rows, i_rows, 900000, 70000,
          {"players": {**created, FIXTURE[0]: 1}, "identities": journal_ids["identities"]}))
check("8. a committed journal with no rows present refuses",
      "none of its rows exist" in refusal(h.judge_located_fixture, planned, [], [], 900000, 70000, journal_ids))

loader_batch = {"tool": loader.TOOL_NAME, "target_table": loader.TARGET_TABLE}
above = [{"id": 501, "source_key": "afltables", **loader_batch}, {"id": 502, "source_key": "afl_api", **loader_batch}]
with_load = {"steps": {"A1": {"state": "committed", "batch_ids": [501, 502]}}}
check("8. rehearsal batches above the pre-max are the loader's and journaled",
      h.judge_rehearsal_batches(above, with_load) == [501, 502])
check("8. a crash after the batch commit but before the journal: accepted only with a load intent",
      h.judge_rehearsal_batches(above, {"steps": {"A1": {"state": "intent"}}}) == [501, 502])
check("8. batches above the pre-max with no journaled load refuse",
      "records no load" in refusal(h.judge_rehearsal_batches, above, {"steps": {}}))
check("8. a foreign batch above the pre-max refuses",
      "not the loader's" in refusal(h.judge_rehearsal_batches,
                                    above + [{"id": 503, "source_key": "afltables", "tool": "settle",
                                              "target_table": "matches"}], with_load))
check("8. a journaled batch missing from import_batches refuses",
      "missing" in refusal(h.judge_rehearsal_batches, above[:1], with_load))

for statement in h.TEARDOWN_SQL:
    upper = statement.upper()
    check(f"8. no wildcard/CASCADE: {statement[:58]}",
          "LIKE" not in upper and "CASCADE" not in upper and "%" not in statement.replace("%s", "")
          and (not upper.startswith("TRUNCATE") or statement == "TRUNCATE ONLY brownlow_season_votes"))
deletes = [s for s in h.TEARDOWN_SQL if s.startswith("DELETE")]
check("8. every DELETE is keyed by an exact id array",
      len(deletes) == 4 and all(re.search(r"\b(id|import_batch_id) = ANY\(%s\)", s) for s in deletes))
check("8. the fixture DELETEs also require the exact planned keys (slug / path / note)",
      "slug = ANY(%s)" in h.SQL_TEARDOWN_PLAYERS and "notes = ANY(%s)" in h.SQL_TEARDOWN_PLAYERS
      and "external_id = ANY(%s)" in h.SQL_TEARDOWN_IDENTITIES and "notes = ANY(%s)" in h.SQL_TEARDOWN_IDENTITIES)
restore_source = inspect.getsource(h.restore)
check("8. restore never issues SQL outside the reviewed statements (no CASCADE / LIKE / DROP)",
      not re.search(r"CASCADE|\bDROP\b|LIKE '", restore_source.replace("ON COMMIT DROP", "")))
order = [restore_source.index(name) for name in ("SQL_RESTORE_TRUNCATE", "SQL_TEARDOWN_REJECTIONS",
                                                 "SQL_TEARDOWN_BATCHES", "SQL_RESTORE_SEASON",
                                                 "SQL_TEARDOWN_IDENTITIES", "SQL_TEARDOWN_PLAYERS",
                                                 "SQL_SETVAL")]
check("8. FK-safe teardown order: votes, rejections, batches, setup rows, identities, players, sequences",
      order == sorted(order))


# ---------------------------------------------------------------------------
section("9. An unexpected reference makes cleanup fail closed")

clean = [{"constraint": "bsv_player_fk", "table": "brownlow_season_votes", "column": "player_id",
          "referenced_table": "players", "count": 0}]
check("9. zero references pass", refusal(h.judge_references, clean) == "")
dirty = clean + [{"constraint": "pms_player_fk", "table": "player_match_stats", "column": "player_id",
                  "referenced_table": "players", "count": 2}]
message = refusal(h.judge_references, dirty)
check("9. any referencing row refuses, naming the table/column and refusing CASCADE",
      "player_match_stats.player_id" in message and "no CASCADE" in message, message)
check("9. the reference check covers every table the teardown deletes from",
      set(h.REFERENCE_CHECKED_TABLES) == {"players", "external_identities", "import_batches"})
fk_source = inspect.getsource(h.fk_edges)
check("9. foreign keys are discovered from pg_constraint (every FK, not a hand list), and a "
      "composite FK refuses", "pg_constraint" in fk_source and "not a single-column" in fk_source)


# ---------------------------------------------------------------------------
section("10. The sequence restore plan covers every sequence the fixture or loader can advance")

captured = {t: {"sequence": f"public.{t}_id_seq", "last_value": 10 + n, "is_called": True, "max_id": 10 + n}
            for n, t in enumerate(h.RESTORED_SEQUENCE_TABLES)}
seq_plan = h.sequence_restore_plan(captured)
check("10. players, external_identities, import_batches, import_rejections, brownlow_season_votes",
      [s for s, _, _ in seq_plan] == [f"public.{t}_id_seq" for t in
                                       ("players", "external_identities", "import_batches",
                                        "import_rejections", "brownlow_season_votes")])
check("10. (last_value, is_called) are carried exactly", seq_plan[0] == ("public.players_id_seq", 10, True))
check("10. a missing sequence refuses a partial restore",
      "partial restore" in refusal(h.sequence_restore_plan,
                                   {k: v for k, v in captured.items() if k != "external_identities"}))
harness_inserts = {t.removeprefix("public.") for t in re.findall(r"INSERT INTO ([\w.]+)", source)}
loader_source = Path(loader.__file__).read_text(encoding="utf-8")
common_source = (TOOL_DIR / "common.py").read_text(encoding="utf-8")
batch_tables = set(re.findall(r"INSERT INTO (import_\w+)", common_source))
check("10. every table the harness inserts into is in the restore plan",
      harness_inserts <= set(h.RESTORED_SEQUENCE_TABLES), str(harness_inserts))
check("10. every table the loader writes (its COPY target + the batch tables) is in the restore plan",
      {loader.TARGET_TABLE} | batch_tables <= set(h.RESTORED_SEQUENCE_TABLES)
      and "TRUNCATE ONLY brownlow_season_votes" in loader_source, str(batch_tables))
check("10. the fresh-session fingerprint also covers EVERY public sequence",
      "pg_sequences" in inspect.getsource(h.fingerprint))


# ---------------------------------------------------------------------------
section("11. The journal: seed committed / load committed / restore complete")

check("11. no pre-state captured -> nothing to restore",
      h.recovery_plan({"steps": {}})["pre_captured"] is False)
intent = {"pre": {}, "fixture": {"state": "intent"}, "steps": {}}
check("11. seed intent only -> locate the fixture by its exact planned keys",
      h.recovery_plan(intent)["fixture"] == "locate_exact_keys")
committed = {"pre": {}, "fixture": {"state": "committed"},
             "steps": {"F1": {"state": "committed"}, "F2": {"state": "intent"},
                       "D1": {"state": "refused"}, "A1": {"state": "committed"}}}
plan_c = h.recovery_plan(committed)
check("11. seed committed -> delete the journaled ids; setup rows and loads are known",
      plan_c["fixture"] == "delete_journal_ids" and plan_c["setup_rows"] == ["F1", "F2"]
      and plan_c["loads"] == ["D1", "A1"] and plan_c["restore"] == "none")
check("11. restore complete is recorded",
      h.recovery_plan({**committed, "restore": {"state": "complete"}})["restore"] == "complete")
check("11. an unknown fixture state refuses",
      "unknown" in refusal(h.recovery_plan, {"pre": {}, "fixture": {"state": "half"}}))
with tempfile.TemporaryDirectory() as tmp:
    evidence = Path(tmp) / "e"
    evidence.mkdir()
    journal = {"journal_version": h.JOURNAL_VERSION, "database": "code_test_db", "pre": {}, "steps": {},
               "fixture": {"state": "none"}}
    h.mark_step(evidence, journal, "A1", "intent", import_batches_pre_max=40)
    h.mark_step(evidence, journal, "A1", "committed", batch_ids=[41, 42])
    reread = h.load_journal(evidence)
    check("11. a step's intent and commit survive a reread from disk (separate restore invocation)",
          reread["steps"]["A1"]["state"] == "committed" and reread["steps"]["A1"]["batch_ids"] == [41, 42]
          and reread["steps"]["A1"]["import_batches_pre_max"] == 40 and "intent_at_utc" in reread["steps"]["A1"])
    (evidence / h.JOURNAL_FILE).write_text(json.dumps({**journal, "database": "afldb_test"}), encoding="utf-8")
    check("11. a journal for another database is refused", "not an" in refusal(h.load_journal, evidence))


# ---------------------------------------------------------------------------
section("12. Inputs and evidence: the availability fixture, the fingerprint diff, the evidence directory")

tracked = loader.AVAILABILITY_PATH.read_bytes()
fixture_text = h.make_availability_fixture(tracked.decode("utf-8"))
diff_lines = [(a, b) for a, b in zip(tracked.decode("utf-8").splitlines(), fixture_text.splitlines()) if a != b]
check("12. the availability fixture differs from the tracked file by exactly one line",
      len(diff_lines) == 1 and '"pending"' in diff_lines[0][0] and '"complete"' in diff_lines[0][1]
      and len(tracked.decode("utf-8").splitlines()) == len(fixture_text.splitlines()))
with tempfile.TemporaryDirectory() as tmp:
    fixture_path = Path(tmp) / "stat-availability.json"
    fixture_path.write_text(fixture_text, encoding="utf-8")
    check("12. ... and adds exactly 2026 to the complete brownlow_season_total seasons",
          loader.load_reviewed_complete_seasons(fixture_path)
          == loader.load_reviewed_complete_seasons(loader.AVAILABILITY_PATH) | {2026})
check("12. the tracked availability file is untouched", loader.AVAILABILITY_PATH.read_bytes() == tracked)
already_complete = refusal(h.make_availability_fixture, fixture_text)
check("12. a document whose 2026 range is no longer pending refuses",
      "not pending" in already_complete, already_complete)
check("12. equal fingerprints have no diff",
      h.compare_fingerprints({"a": {"b": 1}, "s": [1, True]}, {"a": {"b": 1}, "s": [1, True]}) == [])
check("12. a changed sequence / count is reported by key",
      h.compare_fingerprints({"sequences": {"x": [5, True]}, "t": {"players": 9}},
                             {"sequences": {"x": [6, True]}, "t": {"players": 9}}) == ["sequences.x: [5, True] -> [6, True]"])
check("12. the evidence directory must be outside the repository",
      "outside the repository" in refusal(h.prepare_evidence_dir, ROOT / "tmp-issue233-evidence"))
with tempfile.TemporaryDirectory() as tmp:
    made = h.prepare_evidence_dir(Path(tmp) / "new")
    check("12. a new evidence directory is created; an existing one refuses",
          made.is_dir() and "already exists" in refusal(h.prepare_evidence_dir, made))
check("12. the in-repo evidence probe created nothing", not (ROOT / "tmp-issue233-evidence").exists())


# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} Brownlow AFL API season rehearsal contract check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    raise SystemExit(1)
print("All Brownlow AFL API season rehearsal contract checks passed.")
