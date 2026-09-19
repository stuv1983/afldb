#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- DB-free contract for tools/rebuild/draftguru/bridge_import_gate.py
(the read-only pre-import PLAN and post-import VERIFY gates).

    python tests/python/draftguru_import_gate_contract.py

Every scenario runs ``bridge_import_gate.run_gate`` over a five-person hand-built frame and
the scripted connection in ``draftguru_fake_pg.py``. The real child, parent, snapshot and
database are never opened; ``open_read_only`` is never called. What it proves:

  * the DSN guard (env var only, database must be exactly afldb_test, never printed);
  * the read-only assertion, the SELECT-only cursor, rollback-and-close on every path;
  * the child/parent hash pins and shape checks;
  * classification: newly linked, already agreeing (human / bridge / unlinked), conflicting
    (dropped / relinked), missing, extra, duplicate/ambiguous, unexpected state -- each of the
    refusals fails closed;
  * seed-required and bridge/human contradiction refusals;
  * hashes are deterministic and the plan's hashes reproduce on the post-import state;
  * verify: withheld persons stay unlinked, the rejected identities cannot re-enter,
    duplicate targets, vocabulary, batch status, baseline digests;
  * nothing is written to the working directory.

No database connection, no network request, no Git command.
"""

from __future__ import annotations

import ast
import contextlib
import copy
import io
import json
import os
import re
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(ROOT / "tools" / "migration"))
sys.path.insert(0, str(HERE))

import draftguru_fake_pg as fake                    # noqa: E402
import bridge_import_gate as tool                   # noqa: E402
import import_draftguru as imp                      # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


def quiet(_line: str) -> None:
    return None


# ---------------------------------------------------------------------------
# The frame: five persons, five picks
# ---------------------------------------------------------------------------

DG = "https://www.draftguru.com.au/players/"
A, B, C, D, R = (DG + "alpha_one/1", DG + "bravo_two/1", DG + "charlie_three/1",
                 DG + "delta_four/1", DG + "rejected_five/1")
A_AFL, B_AFL, D_AFL, R_AFL = ("players/A/Alpha_One.html", "players/B/Bravo_Two.html",
                              "players/D/Delta_Four.html", "players/R/Rejected_Five.html")
# A registered identity that no DraftGuru person, bridge, ledger or rejection names: the only
# legitimate target for a live admin decision in these fixtures. R_AFL's player (1003) is the
# REJECTED identity's player and must never be used as a "benign" target (first-run defect).
E_AFL = "players/E/Echo_Six.html"
LABEL = "annual-html-contract"
SOURCE_ID, AFL_SOURCE_ID = 1, 2
POPULATION = {"persons": 5, "picks": 5}
REJECTED = {R: R_AFL}

LEDGER = {B: {"player_url": B, "decision": "linked",
              "target": {"source": "afltables", "external_id": B_AFL}}}
BRIDGES = {A: A_AFL, B: B_AFL}
PARENT_MAP = {A: A_AFL, B: B_AFL, D: D_AFL}
CHILD = {
    "kind": "deployment", "target": "afldb_test", "schema_version": 1, "parent_sha256": "p" * 64,
    "bridges": [{"player_url": u, "afltables_external_id": i} for u, i in BRIDGES.items()],
    "withheld": [{"player_url": C, "reason": "U-no-href"},
                 {"player_url": D, "reason": "target_not_registered"},
                 {"player_url": R, "reason": "different_person_wrong_href"}],
}
CHILD_SHA = "c" * 64
# Same shape, the real DEV deployment label: the exporter stamps `--resolve-against dev` verbatim
# into `target`, so the accepted afldb_dev child carries "dev", NOT the database name. This is the
# exact shape of data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json (checked against
# the real file in section 8 below) and proves the gate's DEV generalisation without duplicating
# the frame.
DEV_CHILD = dict(CHILD, target="dev")
# The database-named mislabel the fail-closed target model must refuse under --target dev: no
# exporter run ever produces it, so accepting it would mean the gate was comparing the child's
# target with the physical database name instead of the target specification's label.
DEV_CHILD_DATABASE_LABELLED = dict(CHILD, target="afldb_dev")

REAL_DEV_CHILD_REL = "data/reference/draftguru-person-bridge-20260918-v2.afldb_dev.json"
REAL_DEV_CHILD_SHA256 = "a9652e4a6ca96ced32d64d36cb0a3a1b6cdf1e2591927e628753b399c6647c95"


def prepared_frame() -> dict:
    persons = {}
    for rank, (url, name, games) in enumerate(
            [(A, "Alpha One", 12), (B, "Bravo Two", 40), (C, "Charlie Three", 3),
             (D, "Delta Four", 9), (R, "Rejected Five", 0)], 1):
        persons[url] = {"player_url": url, "dg_person_id": rank, "display_name_raw": name,
                        "name_key": imp.draftguru_name_key(name),
                        "reported_games": games, "reported_goals": 0}
    picks = []
    for i, url in enumerate([A, B, C, D, R], 1):
        picks.append({"player_url": url, "draft_year": 2000 + i, "draft_type": "National Draft",
                      "draft_kind": "national", "pick_number": i, "pick_note": None,
                      "player_name_raw": persons[url]["display_name_raw"], "club_slug": "essendon",
                      "club_name_raw": "Essendon", "original_club_raw": None, "draft_age": 18,
                      "height_cm": 185, "competition": "AFL", "signing": None, "signing_kind": None,
                      "detail": None, "source_record_id": f"https://www.draftguru.com.au/d/{2000 + i}#{i}"})
    return {"persons": persons, "picks": picks, "ledger": copy.deepcopy(LEDGER),
            "bridges": dict(BRIDGES)}


class Rep:
    def warn(self, _m: str) -> None:
        return None


class World:
    """The scripted database. ``pre()`` is the state before the import, ``post()`` after."""

    def __init__(self, *, bridged: bool, database: str = "afldb_test") -> None:
        self.settings = ("on", "on", database, "UTC")
        self.afl_players = {A_AFL: [1001], B_AFL: [1002], R_AFL: [1003], E_AFL: [1004]}
        self.live_rows: list = []
        self.dg_identities = {B: 1002}
        self.overrides: list = []
        self.resolutions: list = []
        self.clubs = [("essendon", 5, "Essendon")]
        self.manual_picks: list = []
        self.resolve_rows: dict = {}
        self.baseline = {}
        prepared = prepared_frame()
        persons = copy.deepcopy(prepared["persons"])
        imp.apply_authority(None, Rep(), persons, prepared["ledger"], {},
                            dict(BRIDGES) if bridged else {}, self.afl_players, SOURCE_ID,
                            dict(self.dg_identities), seeds_allowed=False, manual_players={})
        self.person_rows = tool.expected_person_rows(persons, SOURCE_ID)
        for n, url in enumerate(sorted(self.person_rows, key=tool.url_key), 501):
            self.person_rows[url]["id"] = n
        target_like = {"clubs": {s: (i, n) for s, i, n in self.clubs},
                       "persons": self.person_rows, "source_id": SOURCE_ID}
        self.pick_rows = tool.expected_pick_rows(prepared, persons, target_like)
        self.batch_id = 41 if bridged else 40
        for n, key in enumerate(sorted(self.pick_rows, key=lambda k: tool.url_key(k[0])), 9001):
            self.pick_rows[key]["id"] = n
            self.pick_rows[key]["import_batch_id"] = self.batch_id
        self.identity_rows = tool.expected_identity_rows(persons, LABEL)
        if bridged:
            self.batches = [(41, "import_draftguru.py", "draft_picks", "completed", 5, 0, 10, 0, None,
                             "2026-09-18T10:00:00+00:00", "2026-09-18T10:00:05+00:00")]
            self.batch_count = 4
        else:
            self.batches = [(40, "import_draftguru.py", "draft_picks", "completed", 5, 0, 10, 0, None,
                             "2026-09-17T10:00:00+00:00", "2026-09-17T10:00:05+00:00")]
            self.batch_count = 3
        if bridged:
            self.dg_identities = {A: 1001, B: 1002}

    def responders(self) -> list:
        w = self

        def sources(_sql, params):
            return {"draftguru": [(SOURCE_ID,)], "afltables": [(AFL_SOURCE_ID,)],
                    "manual_admin_edit": [(3,)]}.get(params[0] if params else None, [])

        def registrations(_sql, _params):
            return [(i, p) for i, ps in w.afl_players.items() for p in ps]

        def persons(_sql, _params):
            return [tuple(r[f] for f in tool.PERSON_FIELDS) for r in w.person_rows.values()]

        def picks(_sql, _params):
            return [tuple(r[f] for f in tool.PICK_FIELDS) for r in w.pick_rows.values()]

        def identities(_sql, _params):
            return [tuple(r[f] for f in tool.IDENTITY_FIELDS) for r in w.identity_rows.values()]

        def digest(sql, _params):
            table = re.search(r"FROM (\w+)", sql).group(1)
            key = table + ("_nonlink" if "json_build_object" in sql else "") + (
                "_not_dg" if ("<> %s" in sql or "IS DISTINCT FROM" in sql) else "")
            return [(1, w.baseline.get(key, "md5-" + key))]

        def resolve(_sql, params):
            return [(p,) for p in w.resolve_rows.get(tuple(params), [])]

        return [
            (r"current_setting\('transaction_read_only'\)", lambda *_: [w.settings]),
            (r"SELECT id FROM sources WHERE key", sources),
            (r"AND match_method = %s\s+AND status IN", registrations),
            (r"s\.key = 'manual_admin_edit'\s+AND e\.match_method", fake.rows()),
            (r"FROM player_link_resolutions r", lambda *_: list(w.live_rows)),
            (r"WHERE source_id = %s AND player_id IS NOT NULL", lambda *_: list(w.dg_identities.items())),
            (r"md5\(coalesce\(string_agg", digest),
            (r"FROM draft_persons WHERE source_id = %s", persons),
            (r"FROM draft_picks WHERE source_id = \(SELECT id FROM sources", lambda *_: list(w.manual_picks)),
            (r"FROM draft_picks WHERE source_id = %s", picks),
            (r"external_name.*FROM external_identities WHERE source_id", identities),
            (r"FROM data_overrides WHERE entity_type", lambda *_: list(w.overrides)),
            (r"FROM player_link_resolutions WHERE target_table", lambda *_: list(w.resolutions)),
            (r"SELECT slug, id, name FROM clubs", lambda *_: list(w.clubs)),
            (r"FROM import_batches WHERE source_id = %s ORDER BY id DESC", lambda *_: list(w.batches)),
            (r"SELECT count\(\*\), coalesce\(max\(id\), 0\)", lambda *_: [(w.batch_count, w.batch_id)]),
            (r"SELECT DISTINCT e\.player_id", resolve),
        ]


LAST_OUTPUT: list[str] = []


def run(mode: str, world: World, *, prepared: dict | None = None, child: dict | None = None,
        expect: dict | None = None, rejected: dict | None = None,
        parent_map: dict | None = None,
        required_database: str = tool.REQUIRED_DATABASE) -> tuple[dict, fake.FakeConnection]:
    """Runs the gate on the scripted world; the emitted lines land in LAST_OUTPUT."""
    conn = fake.FakeConnection(world.responders())
    LAST_OUTPUT.clear()
    summary = tool.run_gate(mode, prepared or prepared_frame(), child or CHILD, CHILD_SHA,
                            PARENT_MAP if parent_map is None else parent_map, LABEL, lambda: conn,
                            expect=expect, population=POPULATION,
                            rejected=REJECTED if rejected is None else rejected,
                            emit=LAST_OUTPUT.append, required_database=required_database)
    return summary, conn


def output_has(text: str) -> bool:
    return any(text in line for line in LAST_OUTPUT)


def printed_int(key: str) -> int | None:
    """The integer printed after ``<key>:`` on the first matching output line -- exactly what an
    operator reads off the plan output and passes to verify."""
    for line in LAST_OUTPUT:
        m = re.match(rf"\s*{re.escape(key)}:\s*(\d+)", line)
        if m:
            return int(m.group(1))
    return None


def failed(summary: dict, number: str) -> bool:
    return any(n.startswith(number + " ") for n in summary["failures"])


def only_selects(conn: fake.FakeConnection) -> bool:
    return all(re.match(r"^\s*SELECT\b", s, re.IGNORECASE) for s, _ in conn.statements)


# ---------------------------------------------------------------------------
# 1. Clean plan
# ---------------------------------------------------------------------------

section("1. Clean plan on the pre-import state")

pre = World(bridged=False)
plan, conn = run("plan", pre)
check("1.1 the plan holds (no failures)", not plan["failures"], str(plan["failures"]))
check("1.2 newly linked is exactly the one non-decided bridge person",
      plan["persons"]["newly_linked"] == 1 and plan["counts"]["expected_bridged"] == 1)
check("1.3 the ledger person in the bridge is already-agreeing human-linked",
      plan["persons"]["already_agreeing_linked_human"] == 1
      and plan["counts"]["decided_persons_in_bridge"] == [B])
check("1.4 the three withheld persons are already-agreeing unlinked",
      plan["persons"]["already_agreeing_unlinked"] == 3)
check("1.5 authority: bridge 1, ledger 1, seeded 0", plan["authority"]["bridge"] == 1
      and plan["authority"]["ledger"] == 1 and plan["authority"]["seeded"] == 0)
check("1.6 pick link changes belong to the newly linked person only",
      plan["picks"]["link_change"] == 1 and plan["picks"]["nonlink_change"] == 0)
check("1.7 identity link changes are the newly linked person only",
      plan["identities"]["link_change"] == 1 and plan["identities"]["other_change"] == 0)
check("1.8 totals_after: 2 linked persons, 2 linked picks, vocabulary keys",
      plan["totals_after"]["linked_persons"] == 2 and plan["totals_after"]["linked_picks"] == 2
      and set(plan["totals_after"]["persons_by_status_method"]) == {
          f"unique|{imp.BRIDGE_MATCH_METHOD}", f"resolved|{imp.LEDGER_MATCH_METHOD}", "unmatched|"})
check("1.9 only SELECT statements reached the connection", only_selects(conn),
      str([s[:40] for s, _ in conn.statements if not s.lstrip().upper().startswith("SELECT")]))
check("1.10 the transaction was rolled back once and the connection closed",
      conn.rollbacks == 1 and conn.closed and conn.commits == 0)
check("1.11 the gate never toggles autocommit", not any(k == "autocommit" for k, _, _ in conn.log))
check("1.12 import_batches_expected_after = before + 1 in the summary",
      plan["import_batches_expected_after"] == plan["import_batches_before"] + 1 == 4)
printed_before = printed_int("import_batches_before")
printed_after = printed_int("import_batches_expected_after")
check("1.12a the plan PRINTS import_batches_before and import_batches_expected_after",
      printed_before == 3 and printed_after == 4, f"printed {printed_before} / {printed_after}")
check("1.12b the printed values equal the summary's (same read-only snapshot)",
      printed_before == plan["import_batches_before"]
      and printed_after == plan["import_batches_expected_after"])
check("1.12c both counters are inside the hashed summary payload",
      "import_batches_before" in plan and "import_batches_expected_after" in plan
      and plan["summary_sha256"] == tool.sha256_canonical(
          {k: v for k, v in plan.items() if k != "summary_sha256"}))

plan2, _ = run("plan", World(bridged=False))
check("1.13 a second plan over the same state reproduces every hash and the summary_sha256",
      plan2["summary_sha256"] == plan["summary_sha256"]
      and plan2["after_state_sha256"] == plan["after_state_sha256"]
      and plan2["newly_linked_sha256"] == plan["newly_linked_sha256"]
      and plan2["baseline_sha256"] == plan["baseline_sha256"])
check("1.13a the second plan prints the same two batch counters",
      printed_int("import_batches_before") == printed_before
      and printed_int("import_batches_expected_after") == printed_after)
check("1.14 changes_sha256 covers exactly the one changing person",
      plan["changes"] == 1)

# ---------------------------------------------------------------------------
# 2. Guards: DSN, read-only assertion, SELECT-only cursor, child/parent pins
# ---------------------------------------------------------------------------

section("2. Guards")

for env, expect_ok in ((None, False), ("postgresql://u:pw@h:5432/afldb_dev", False),
                       ("postgresql://u:pw@h:5432/afldb_test_shadow", False),
                       ("mysql://u:pw@h/afldb_test", False),
                       ("postgresql://u:pw@h:5432/afldb_test?sslmode=require", True)):
    try:
        # No target argument at all -- the legacy/default call every pre-existing caller made.
        tool.resolve_dsn(environ={} if env is None else {tool.DSN_ENV: env})
        ok = True
        message = ""
    except tool.GateError as exc:
        ok = False
        message = str(exc)
    check(f"2.1 legacy/default resolve_dsn() (no --target) for {env!r}: "
          f"{'accepted' if expect_ok else 'refused'}", ok == expect_ok, message)
    if not ok:
        check("2.2 the refusal never echoes the DSN or a password", "pw" not in message and "@h" not in message)

section("2b. --target generalisation: explicit test, explicit dev, DSN separation, PROD refusal")

check("2b.0 the default target is test, and dev is a separate, closed second entry",
      sorted(tool.TARGETS) == ["dev", "test"] and tool.TARGETS["test"]["database"] == "afldb_test"
      and tool.TARGETS["dev"]["database"] == "afldb_dev")
check("2b.0aa the target specification carries the physical database and the child's own "
      "deployment-target LABEL as SEPARATE fields, and they differ for dev",
      tool.TARGETS["test"]["database"] == "afldb_test"
      and tool.TARGETS["test"]["child_target"] == "afldb_test"
      and tool.TARGETS["dev"]["database"] == "afldb_dev"
      and tool.TARGETS["dev"]["child_target"] == "dev"
      and tool.TARGETS["dev"]["database"] != tool.TARGETS["dev"]["child_target"],
      str({t: (c["database"], c["child_target"]) for t, c in tool.TARGETS.items()}))
check("2b.0a test and dev read different environment variables (never the importer's write DSN)",
      tool.TARGETS["test"]["dsn_env"] == tool.DSN_ENV == "AFLDB_TEST_DATABASE_URL"
      and tool.TARGETS["dev"]["dsn_env"] == "AFLDB_DEV_DATABASE_URL"
      and "AFLDB_IMPORT_DATABASE_URL" not in (tool.TARGETS["test"]["dsn_env"], tool.TARGETS["dev"]["dsn_env"])
      and "AFLDB_OWNER_DATABASE_URL" not in (tool.TARGETS["test"]["dsn_env"], tool.TARGETS["dev"]["dsn_env"]))

for target, env, expect_ok in (
        ("test", None, False),
        ("test", "postgresql://u:pw@h:5432/afldb_test", True),
        ("test", "postgresql://u:pw@h:5432/afldb_dev", False),
        ("dev", None, False),
        ("dev", "postgresql://u:pw@h:5432/afldb_dev", True),
        ("dev", "postgresql://u:pw@h:5432/afldb_test", False),
        ("dev", "postgresql://u:pw@h:5432/afldb_import", False),
):
    dsn_env = tool.TARGETS[target]["dsn_env"]
    try:
        tool.resolve_dsn(target, {} if env is None else {dsn_env: env})
        ok = True
        message = ""
    except tool.GateError as exc:
        ok = False
        message = str(exc)
    check(f"2b.1 explicit --target {target} DSN guard for {env!r}: "
          f"{'accepted' if expect_ok else 'refused'}", ok == expect_ok, message)
    if not ok:
        check("2b.2 the refusal never echoes the DSN or a password", "pw" not in message and "@h" not in message)

for bad_target in ("prod", "PROD", "afldb_prod", ""):
    try:
        tool.resolve_dsn(bad_target, {"AFLDB_PROD_DATABASE_URL": "postgresql://u:pw@h:5432/afldb_prod"})
        prod_ok, prod_message = True, ""
    except tool.GateError as exc:
        prod_ok, prod_message = False, str(exc)
    check(f"2b.3 target {bad_target!r} is refused before any DSN is read -- no PROD target exists",
          not prod_ok and "no PROD target" in prod_message, prod_message)

sneaky = World(bridged=False)
sneaky.settings = ("off", "on", "afldb_test", "UTC")
try:
    run("plan", sneaky)
    ro_refused = False
except tool.GateError as exc:
    ro_refused = "not read-only" in str(exc)
check("2.3 a server that reports transaction_read_only=off is refused before any read", ro_refused)

wrong_db = World(bridged=False)
wrong_db.settings = ("on", "on", "afldb_dev", "UTC")
try:
    run("plan", wrong_db)
    db_refused = False
except tool.GateError as exc:
    db_refused = "connected database" in str(exc)
check("2.4 a server whose current_database() is not afldb_test is refused", db_refused)

probe = fake.FakeConnection([])
raw = probe.cursor()
sel = tool.SelectOnlyCursor(raw)
try:
    sel.execute("UPDATE draft_persons SET player_id = 1")
    write_refused = False
except tool.GateError:
    write_refused = True
check("2.5 the SELECT-only cursor refuses a write before it is sent",
      write_refused and not probe.statements)
try:
    sel.execute("  -- comment\n  select 1")
    comment_ok = True
except tool.GateError:
    comment_ok = False
check("2.6 a commented, lower-case SELECT is still a SELECT", comment_ok and len(probe.statements) == 1)

closing = World(bridged=False)
closing.settings = ("off", "on", "afldb_test", "UTC")
conn_c = fake.FakeConnection(closing.responders())
with contextlib.suppress(tool.GateError):
    tool.run_gate("plan", prepared_frame(), CHILD, CHILD_SHA, PARENT_MAP, LABEL, lambda: conn_c,
                  population=POPULATION, rejected=REJECTED, emit=quiet)
check("2.7 rollback and close happen even when the read-only assertion refuses",
      conn_c.rollbacks == 1 and conn_c.closed)

with tempfile.TemporaryDirectory() as tmp:
    child_path = Path(tmp) / "child.json"
    child_path.write_text(json.dumps(CHILD), encoding="utf-8")
    real_sha = tool.sha256_bytes(child_path.read_bytes())
    try:
        tool.load_child(child_path, "0" * 64, None)
        pin_ok = False
    except tool.GateError as exc:
        pin_ok = "pinned child hash" in str(exc)
    check("2.8 a child whose sha256 is not the pinned value is refused", pin_ok)
    doc, digest = tool.load_child(child_path, real_sha, {"bridges": 2, "withheld": 3, "U-no-href": 1})
    check("2.9 the pinned child loads with its counts", digest == real_sha and doc["target"] == "afldb_test")
    try:
        tool.load_child(child_path, real_sha, {"bridges": 3})
        counts_ok = False
    except tool.GateError as exc:
        counts_ok = "child count bridges" in str(exc)
    check("2.10 a count that differs from the pinned expectation is refused", counts_ok)
    parent_doc = {"kind": "source-evidence", "bridges": [
        {"player_url": u, "afltables_external_id": i} for u, i in PARENT_MAP.items()]}
    parent_path = Path(tmp) / "parent.json"
    parent_path.write_text(json.dumps(parent_doc), encoding="utf-8")
    parent_sha = tool.sha256_bytes(parent_path.read_bytes())
    try:
        tool.load_parent_map(parent_path, {"parent_sha256": "x" * 64}, parent_sha)
        chain_ok = False
    except tool.GateError as exc:
        chain_ok = "parent_sha256 does not name" in str(exc)
    check("2.11 a parent the child's parent_sha256 does not name is refused", chain_ok)
    pm = tool.load_parent_map(parent_path, {"parent_sha256": parent_sha}, parent_sha)
    check("2.12 the parent map carries the withheld person's identity", pm.get(D) == D_AFL)
    parent_child = dict(CHILD, kind="source-evidence")
    (Path(tmp) / "kind.json").write_text(json.dumps(parent_child), encoding="utf-8")
    try:
        tool.load_child(Path(tmp) / "kind.json", None, None)
        kind_ok = False
    except tool.GateError as exc:
        kind_ok = "not a deployment child" in str(exc)
    check("2.13 a source-evidence parent passed as --bridge is refused", kind_ok)

# ---------------------------------------------------------------------------
# 3. Refusals: registration, contradiction, seeding
# ---------------------------------------------------------------------------

section("3. Registration and authority refusals")

w = World(bridged=False)
w.afl_players = {B_AFL: [1002], R_AFL: [1003]}            # A's target unregistered
s, c = run("plan", w)
check("3.1 an unregistered bridge target fails 4.1 and stops before the replay",
      failed(s, "4.1") and "5.1" not in " ".join(n for n, _ in s["checks"]) and c.rollbacks == 1)

w = World(bridged=False)
w.afl_players = {A_AFL: [1001, 1005], B_AFL: [1002], R_AFL: [1003]}
s, _ = run("plan", w)
check("3.2 a bridge target registered twice (ambiguous) fails 4.1", failed(s, "4.1")
      and s["registration"]["bridge_ambiguous"] == [(A, A_AFL, 2)])

w = World(bridged=False)
w.afl_players[D_AFL] = [1009]                              # withheld identity now registered
s, _ = run("plan", w)
check("3.3 a target_not_registered identity that became registered fails 4.2 (stale child)",
      failed(s, "4.2") and s["registration"]["withheld_now_registered"] == [(D, D_AFL, 1)])

w = World(bridged=False)
p = prepared_frame()
p["ledger"][B] = {"player_url": B, "decision": "confirmed_unlinked", "target": None}
s, c = run("plan", w, prepared=p)
check("3.4 a bridge contradicting a human decision fails 5.1 with the importer's HALT message",
      failed(s, "5.1") and output_has("contradicts an explicit human decision") and c.rollbacks == 1)

w = World(bridged=False)
p = prepared_frame()
p["ledger"][C] = {"player_url": C, "decision": "linked",
                  "target": {"source": "draftguru", "external_id": C}}
s, _ = run("plan", w, prepared=p)
check("3.5 a ledger decision that would mint a player shell fails 5.1 as seed_required",
      failed(s, "5.1") and output_has("seed_required:"))

w = World(bridged=False)
w.live_rows = [(A, "confirmed_unlinked", None)]
s, _ = run("plan", w)
check("3.6 a live confirmed_unlinked decision on a bridged person HALTs the replay (5.1)", failed(s, "5.1"))

def with_live_decision(player_id: int) -> World:
    """A live admin decision linking the non-bridged person C to ``player_id``, already applied
    to the stored rows and normalised by the last reload -- the consistent state a live database
    is in after /admin/player-links records a decision."""
    w = World(bridged=False)
    w.live_rows = [(C, "linked", player_id)]
    w.person_rows[C].update(player_id=player_id, link_status="resolved",
                            match_method=imp.LEDGER_MATCH_METHOD,
                            confidence_notes="explicit human decision: linked",
                            is_matching_backlog=False)
    for key, row in w.pick_rows.items():
        if key[0] == C:
            row.update(player_id=player_id, link_status_value="resolved",
                       match_method=imp.LEDGER_MATCH_METHOD,
                       confidence_notes="explicit human decision: linked")
    w.identity_rows[C].update(player_id=player_id, status="resolved",
                              match_method=imp.LEDGER_MATCH_METHOD)
    return w


# Player 1004 is E_AFL's: registered exactly once, named by no bridge, ledger or rejection.
s, _ = run("plan", with_live_decision(1004))
check("3.7 a live decision on a non-bridged person (clean, uniquely registered, non-rejected "
      "target) is honoured, warned, and not a refusal",
      not s["failures"] and s["live_decisions"] == 1 and any("live" in m for m in s["warnings"])
      and s["authority"]["ledger"] == 2 and s["persons"]["already_agreeing_linked_human"] == 2,
      str(s["failures"]))

# Player 1003 is the REJECTED identity's player (R_AFL, Rejected Five). A live decision is
# human authority and the importer would honour it, so the gate -- not the importer -- is what
# stops the rejected identity from entering a stored DraftGuru link. This is the case the
# first-run 3.7 fixture accidentally exercised.
s, _ = run("plan", with_live_decision(1003))
check("3.9 a non-bridged live decision targeting a rejected identity's player is refused by 4.3 "
      "(the invariant holds even against human authority)",
      failed(s, "4.3") and s["registration"] is not None
      and any("rejected AFL Tables identity" in n for n in s["failures"]),
      str(s["failures"]))

w = World(bridged=False)
w.live_rows = [(A, "linked", 1001), (A, "confirmed_unlinked", None)]
s, _ = run("plan", w)
check("3.8 contradictory live decisions across one person's picks fail 2.4 (read_live_decisions HALT)",
      failed(s, "2.4"))

# ---------------------------------------------------------------------------
# 4. Refusals: classification (conflict / missing / extra / unexpected state)
# ---------------------------------------------------------------------------

section("4. Classification refusals")

w = World(bridged=False)
w.person_rows[A].update(player_id=1099, link_status="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                        confidence_notes="draftguru person-page bridge -> players/X/Other.html",
                        is_matching_backlog=False)
for key, row in w.pick_rows.items():
    if key[0] == A:
        row.update(player_id=1099, link_status_value="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                   confidence_notes="draftguru person-page bridge -> players/X/Other.html")
s, _ = run("plan", w)
check("4.1 a person already linked to a different player is 'relinked' and fails 6.3",
      failed(s, "6.3") and s["persons"]["relinked"] == 1)

w = World(bridged=False)
w.person_rows[C].update(player_id=1003, link_status="resolved", match_method=imp.LEDGER_MATCH_METHOD,
                        confidence_notes="explicit human decision: linked", is_matching_backlog=False)
for key, row in w.pick_rows.items():
    if key[0] == C:
        row.update(player_id=1003, link_status_value="resolved", match_method=imp.LEDGER_MATCH_METHOD,
                   confidence_notes="explicit human decision: linked")
s, _ = run("plan", w)
check("4.2 a stored link the import would drop is 'link_dropped' and fails 6.3",
      failed(s, "6.3") and s["persons"]["link_dropped"] == 1)

w = World(bridged=False)
del w.person_rows[D]
s, _ = run("plan", w)
check("4.3 a snapshot person absent from the target is 'missing' and fails 6.1 and 3.1",
      failed(s, "6.1") and failed(s, "3.1") and s["persons"]["missing"] == 1)

w = World(bridged=False)
w.person_rows[DG + "zulu_six/1"] = dict(w.person_rows[D], id=599, player_url=DG + "zulu_six/1",
                                        dg_person_id=6)
s, _ = run("plan", w)
check("4.4 a stored person the snapshot no longer carries is 'extra' and fails 6.1",
      failed(s, "6.1") and s["persons"]["extra"] == 1)

w = World(bridged=False)
w.person_rows[C]["display_name_raw"] = "Charlie  Three"
s, _ = run("plan", w)
check("4.5 a non-link person column that would change fails 6.4",
      failed(s, "6.4") and s["persons"]["nonlink_change"] == 1)

w = World(bridged=False)
w.person_rows[A]["dg_person_id"], w.person_rows[B]["dg_person_id"] = 2, 1
s, _ = run("plan", w)
check("4.6 a dg_person_id permutation fails 6.5", failed(s, "6.5") and s["persons"]["dg_person_id_permutation"] == 2)

w = World(bridged=False)
for row in w.identity_rows.values():
    row["notes"] = "stage_a_snapshot=annual-html-other"
s, _ = run("plan", w)
check("4.7 external_identities notes carrying another Stage A label fail 6.7 (unexpected state)",
      failed(s, "6.7") and s["identities"]["other_change"] == 5)

w = World(bridged=False)
key_c = next(k for k in w.pick_rows if k[0] == C)
w.pick_rows[key_c]["height_cm"] = 190
s, _ = run("plan", w)
check("4.8 a non-link pick column that would change fails 6.6", failed(s, "6.6"))

w = World(bridged=False)
w.overrides = [(1, f"{SOURCE_ID}|{C}|2003|national", "facts", {"height_cm": 190}, True)]
w.pick_rows[key_c]["height_cm"] = 190
s, _ = run("plan", w)
check("4.9 the same change explained by an active source-owned override is expected (6.6 holds)",
      not failed(s, "6.6") and s["source_override_patches_applied"] == 1, str(s["failures"]))

w = World(bridged=False)
w.overrides = [(2, "manual_admin_edit:tok1", "selection",
                {"draft_year": 2010, "draft_type": "Rookie Draft", "draft_kind": "rookie",
                 "pick_number": 3, "club_slug": "essendon", "player_identity": f"afltables:{R_AFL}"},
                True)]
w.resolve_rows[("afltables", R_AFL)] = [1003]
s, _ = run("plan", w)
check("4.10 an active manual selection with no stored row (would be re-created) fails 6.10",
      failed(s, "6.10") and s["manual_picks"]["missing"] == 1)

w = World(bridged=False)
w.person_rows[C].update(player_id=1003, link_status="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                        confidence_notes="x", is_matching_backlog=False)
w.person_rows[D].update(player_id=1003, link_status="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                        confidence_notes="x", is_matching_backlog=False)
s, _ = run("plan", w)
check("4.11 two stored persons on one canonical player surface as dropped links (never silently kept)",
      failed(s, "6.3") and s["persons"]["link_dropped"] == 2)

w = World(bridged=False)
w.person_rows[R].update(player_id=1003, link_status="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                        confidence_notes="x", is_matching_backlog=False)
s, _ = run("plan", w)
check("4.12 a stored person reaching a rejected identity fails 4.3", failed(s, "4.3"))

# ---------------------------------------------------------------------------
# 5. Verify on the post-import state, with the plan's hashes
# ---------------------------------------------------------------------------

section("5. Verify")

post = World(bridged=True)
# --expect-batches-before is the value the operator reads off the plan's printed line, under
# the documented semantics: verify passes when the target now holds exactly that count + 1.
expect = {"after_state_sha256": plan["after_state_sha256"],
          "picks_after_sha256": plan["picks_after_sha256"],
          "newly_linked_sha256": plan["newly_linked_sha256"],
          "baseline_sha256": plan["baseline_sha256"],
          "batches_before": printed_before}
v, vconn = run("verify", post, expect=expect)
check("5.1 the post-import state verifies against the plan's four hashes and the PRINTED batch count",
      not v["failures"] and printed_before is not None, str(v["failures"]))
check("5.1a verify prints import_batches_before (now = printed plan value + 1) and no expected_after",
      printed_int("import_batches_before") == printed_before + 1
      and printed_int("import_batches_expected_after") is None
      and "import_batches_expected_after" not in v)
check("5.2 verify reports 0 changes and the bridge-linked set equals the plan's",
      v["changes"] == 0 and v["newly_linked_sha256"] == plan["newly_linked_sha256"]
      and v["persons"]["already_agreeing_linked_bridge"] == 1)
check("5.3 verify is read-only too: SELECT only, one rollback, closed",
      only_selects(vconn) and vconn.rollbacks == 1 and vconn.closed and vconn.commits == 0)

w = World(bridged=True)
w.person_rows[R].update(player_id=1003, link_status="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                        confidence_notes="draftguru person-page bridge -> " + R_AFL,
                        is_matching_backlog=False)
for key, row in w.pick_rows.items():
    if key[0] == R:
        row.update(player_id=1003, link_status_value="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                   confidence_notes="draftguru person-page bridge -> " + R_AFL)
w.identity_rows[R].update(player_id=1003, status="unique", match_method=imp.BRIDGE_MATCH_METHOD)
v, _ = run("verify", w, expect=expect)
check("5.4 a rejected person that re-entered fails 4.3, 8.7 and the state hash",
      failed(v, "4.3") and failed(v, "8.7") and failed(v, "8.14 after_state_sha256"))

w = World(bridged=True)
w.person_rows[C].update(player_id=1003, link_status="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                        confidence_notes="draftguru person-page bridge -> x", is_matching_backlog=False)
v, _ = run("verify", w, expect=expect)
check("5.5 a withheld person linked by the bridge fails 8.5, 8.6 and 8.1",
      failed(v, "8.5") and failed(v, "8.6") and failed(v, "8.1"))

w = World(bridged=True)
w.person_rows[A]["link_status"], w.person_rows[A]["match_method"] = "resolved", imp.BRIDGE_MATCH_METHOD
v, _ = run("verify", w, expect=expect)
check("5.6 a bridge link stored as 'resolved' is outside the vocabulary (8.9) and provenance (8.4)",
      failed(v, "8.9") and failed(v, "8.4"))

w = World(bridged=True)
w.baseline = {"players": "md5-players-changed"}
v, _ = run("verify", w, expect=expect)
check("5.7 a changed unrelated-table digest fails 8.14 baseline_sha256 only",
      failed(v, "8.14 baseline_sha256") and not failed(v, "8.14 after_state_sha256"))

w = World(bridged=True)
w.batches = [(42, "import_draftguru.py", "draft_picks", "running", 5, 0, 0, 0, None,
              "2026-09-18T10:00:00+00:00", None)] + w.batches
w.batch_count = 5
v, _ = run("verify", w, expect=expect)
check("5.8 a running draftguru batch fails 8.10, 8.11, 8.12 and 8.13",
      failed(v, "8.10") and failed(v, "8.11") and failed(v, "8.12") and failed(v, "8.13"))

w = World(bridged=True)
w.batches = [(41, "import_draftguru.py", "draft_picks", "failed", 5, 0, 0, 0, "ImportFailure: x",
              "2026-09-18T10:00:00+00:00", "2026-09-18T10:00:01+00:00")]
v, _ = run("verify", w, expect=expect)
check("5.9 a failed newest batch fails 8.10", failed(v, "8.10"))

w = World(bridged=True)
w.person_rows[D].update(player_id=1001, link_status="unique", match_method=imp.BRIDGE_MATCH_METHOD,
                        confidence_notes="x", is_matching_backlog=False)
v, _ = run("verify", w, expect=expect)
check("5.10 a canonical player claimed by two persons fails 8.8", failed(v, "8.8"))

v_pre, _ = run("verify", World(bridged=False), expect=expect)
check("5.11 verify on the PRE-import state refuses (8.1, 8.4, 8.5, 8.12, 8.13)",
      failed(v_pre, "8.1") and failed(v_pre, "8.4") and failed(v_pre, "8.5") and failed(v_pre, "8.13"))

# ---------------------------------------------------------------------------
# 6. Nothing written; CLI guard exits
# ---------------------------------------------------------------------------

section("6. No artefact; CLI guards")

with tempfile.TemporaryDirectory() as tmp:
    cwd = os.getcwd()
    os.chdir(tmp)
    try:
        run("plan", World(bridged=False))
        run("verify", World(bridged=True), expect=expect)
    finally:
        os.chdir(cwd)
    check("6.1 neither mode writes a file to the working directory", not os.listdir(tmp))

original_open = tool.open_read_only


def never_connect(_dsn):
    raise AssertionError("open_read_only must not be reached when the DSN guard refuses")


tool.open_read_only = never_connect
saved = os.environ.pop(tool.DSN_ENV, None)
saved_load = None
try:
    import common
    saved_load = common.load_env
    common.load_env = lambda *_a, **_k: None          # never read the real .env in this contract
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        rc_missing = tool.main(["plan"])
    os.environ[tool.DSN_ENV] = "postgresql://u:pw@h:5432/afldb_dev"
    out2 = io.StringIO()
    with contextlib.redirect_stdout(out2):
        rc_wrong = tool.main(["verify"])
finally:
    tool.open_read_only = original_open
    if saved_load is not None:
        common.load_env = saved_load
    if saved is None:
        os.environ.pop(tool.DSN_ENV, None)
    else:
        os.environ[tool.DSN_ENV] = saved
check("6.2 missing DSN exits 2 with an ERROR line", rc_missing == tool.EXIT_ERROR and "ERROR:" in out.getvalue())
check("6.3 a DSN for another database exits 2 and never prints the DSN",
      rc_wrong == tool.EXIT_ERROR and "ERROR:" in out2.getvalue()
      and "afldb_dev" not in out2.getvalue() and "pw" not in out2.getvalue()
      and "@h:" not in out2.getvalue())

# ---------------------------------------------------------------------------
# 7. --target dev generalisation: full plan/verify parity, cross-target refusal
# ---------------------------------------------------------------------------

section("7. --target dev: plan/verify parity with test, on the same frame")

dev_pre = World(bridged=False, database="afldb_dev")
dev_plan, dev_conn = run("plan", dev_pre, child=DEV_CHILD, required_database="afldb_dev")
check("7.1 a DEV-target plan over the equivalent frame holds and reproduces the test-target hashes",
      not dev_plan["failures"]
      and dev_plan["after_state_sha256"] == plan["after_state_sha256"]
      and dev_plan["picks_after_sha256"] == plan["picks_after_sha256"]
      and dev_plan["newly_linked_sha256"] == plan["newly_linked_sha256"]
      and dev_plan["baseline_sha256"] == plan["baseline_sha256"],
      str(dev_plan["failures"]))
check("7.2 the DEV plan's hashed summary records target_database=afldb_dev",
      dev_plan["target_database"] == "afldb_dev")
check("7.3 the DEV plan is read-only too: SELECT only, one rollback, closed, no autocommit toggle",
      only_selects(dev_conn) and dev_conn.rollbacks == 1 and dev_conn.closed and dev_conn.commits == 0
      and not any(k == "autocommit" for k, _, _ in dev_conn.log))

dev_plan2, _ = run("plan", World(bridged=False, database="afldb_dev"), child=DEV_CHILD,
                   required_database="afldb_dev")
check("7.4 a second DEV plan over the same state reproduces the summary_sha256 deterministically",
      dev_plan2["summary_sha256"] == dev_plan["summary_sha256"])

dev_post = World(bridged=True, database="afldb_dev")
dev_expect = {"after_state_sha256": dev_plan["after_state_sha256"],
              "picks_after_sha256": dev_plan["picks_after_sha256"],
              "newly_linked_sha256": dev_plan["newly_linked_sha256"],
              "baseline_sha256": dev_plan["baseline_sha256"],
              "batches_before": dev_plan["import_batches_before"]}
dev_verify, dev_vconn = run("verify", dev_post, child=DEV_CHILD, expect=dev_expect,
                            required_database="afldb_dev")
check("7.5 the DEV verify holds against the DEV plan's four hashes and batch count",
      not dev_verify["failures"], str(dev_verify["failures"]))
check("7.6 the DEV verify's hashed summary also records target_database=afldb_dev",
      dev_verify["target_database"] == "afldb_dev")

dev_wrong_db = World(bridged=False, database="afldb_test")
try:
    run("plan", dev_wrong_db, child=DEV_CHILD, required_database="afldb_dev")
    dev_db_refused = False
except tool.GateError as exc:
    dev_db_refused = "connected database" in str(exc)
check("7.7 a server reporting afldb_test when required_database is afldb_dev is refused before any read",
      dev_db_refused)

# The physical-database guard is on current_database() and stays the DATABASE name: the CLI
# target label 'dev' is not a database and a server reporting it must be refused, exactly as any
# other wrong database is. This is the other half of the separated target model.
dev_label_db = World(bridged=False, database="dev")
try:
    run("plan", dev_label_db, child=DEV_CHILD, required_database="afldb_dev")
    dev_label_refused = False
except tool.GateError as exc:
    dev_label_refused = "connected database" in str(exc)
check("7.8 a server whose current_database() is the LABEL 'dev' is refused -- the DEV physical "
      "database guard remains exactly afldb_dev", dev_label_refused)
check("7.9 the DEV target's current_database guard is the database name, not the child label",
      tool.TARGETS["dev"]["database"] == "afldb_dev" != tool.TARGETS["dev"]["child_target"])

section("8. Refusal of cross-target child artefacts (target LABEL, never the database name)")

DEV_CHILD_TARGET = tool.TARGETS["dev"]["child_target"]
TEST_CHILD_TARGET = tool.TARGETS["test"]["child_target"]

with tempfile.TemporaryDirectory() as tmp:
    test_child_path = Path(tmp) / "test_child.json"
    test_child_path.write_text(json.dumps(CHILD), encoding="utf-8")
    test_child_sha = tool.sha256_bytes(test_child_path.read_bytes())
    try:
        tool.load_child(test_child_path, test_child_sha, None,
                        expect_child_target=DEV_CHILD_TARGET)
        cross_ok, cross_message = True, ""
    except tool.GateError as exc:
        cross_ok, cross_message = False, str(exc)
    check("8.1 an afldb_test-labelled child is refused under the dev target label",
          not cross_ok and "'dev'" in cross_message, cross_message)

    dev_child_path = Path(tmp) / "dev_child.json"
    dev_child_path.write_text(json.dumps(DEV_CHILD), encoding="utf-8")
    dev_child_sha = tool.sha256_bytes(dev_child_path.read_bytes())
    doc, digest = tool.load_child(dev_child_path, dev_child_sha, None,
                                  expect_child_target=DEV_CHILD_TARGET)
    check("8.2 the real DEV child shape (target='dev') loads cleanly under the dev target label",
          digest == dev_child_sha and doc["target"] == "dev")
    try:
        tool.load_child(dev_child_path, dev_child_sha, None,
                        expect_child_target=TEST_CHILD_TARGET)
        reverse_ok = True
    except tool.GateError:
        reverse_ok = False
    check("8.3 the reverse is also refused: a target='dev' child under the test target label",
          not reverse_ok)

    # The regression the real DEV pre-import attempt hit: a child labelled with the PHYSICAL
    # database name is not what any exporter run produces, and accepting it would mean the gate
    # had gone back to comparing child.target with current_database().
    db_labelled_path = Path(tmp) / "dev_child_database_labelled.json"
    db_labelled_path.write_text(json.dumps(DEV_CHILD_DATABASE_LABELLED), encoding="utf-8")
    db_labelled_sha = tool.sha256_bytes(db_labelled_path.read_bytes())
    try:
        tool.load_child(db_labelled_path, db_labelled_sha, None,
                        expect_child_target=DEV_CHILD_TARGET)
        db_label_ok, db_label_message = True, ""
    except tool.GateError as exc:
        db_label_ok, db_label_message = False, str(exc)
    check("8.4 a child labelled with the PHYSICAL database name ('afldb_dev') is refused under "
          "the dev target -- the label is never the database name",
          not db_label_ok and "'afldb_dev'" in db_label_message, db_label_message)

    # DENY-only guards: the afldb_test child cannot be laundered into a DEV run by renaming it.
    renamed = Path(tmp) / "innocent-looking-child.json"
    renamed.write_bytes((ROOT / tool.CHILD_REL).read_bytes())
    try:
        tool.refuse_test_child_under("dev", renamed)
        bytes_ok, bytes_message = True, ""
    except tool.GateError as exc:
        bytes_ok, bytes_message = False, str(exc)
    check("8.5 the pinned afldb_test child is refused under --target dev by its BYTES even "
          "under a neutral filename", not bytes_ok and "sha256" in bytes_message, bytes_message)
    try:
        tool.refuse_test_child_under("dev", Path(tmp) / "something-v9.afldb_test.json")
        name_ok = True
    except tool.GateError:
        name_ok = False
    check("8.6 a .afldb_test.json name is refused under --target dev (DENY rule, file need not "
          "exist)", not name_ok)
    try:
        tool.refuse_test_child_under("test", ROOT / tool.CHILD_REL)
        test_default_ok = True
    except tool.GateError:
        test_default_ok = False
    check("8.7 the same guard never fires on --target test (the default path is unchanged)",
          test_default_ok)

section("8b. The real committed DEV child carries the exporter's real label")

real_dev = ROOT / REAL_DEV_CHILD_REL
check("8b.1 the real DEV deployment child exists, hashes to the operator-reported sha256, and "
      "declares target='dev'",
      real_dev.is_file()
      and tool.sha256_bytes(real_dev.read_bytes()) == REAL_DEV_CHILD_SHA256
      and json.loads(real_dev.read_bytes().decode("utf-8")).get("target") == DEV_CHILD_TARGET,
      str(real_dev))
real_doc, real_digest = tool.load_child(real_dev, REAL_DEV_CHILD_SHA256, None,
                                        expect_child_target=DEV_CHILD_TARGET)
check("8b.2 load_child accepts the real DEV child under the dev target label",
      real_digest == REAL_DEV_CHILD_SHA256 and real_doc["kind"] == "deployment")
try:
    tool.load_child(real_dev, REAL_DEV_CHILD_SHA256, None, expect_child_target=TEST_CHILD_TARGET)
    real_cross_ok = True
except tool.GateError:
    real_cross_ok = False
check("8b.3 the real DEV child is refused under the test target label", not real_cross_ok)

real_test_child = ROOT / tool.CHILD_REL
real_test_doc, _ = tool.load_child(real_test_child, tool.EXPECTED_CHILD_SHA256,
                                   tool.EXPECTED_CHILD_COUNTS,
                                   expect_child_target=TEST_CHILD_TARGET)
check("8b.4 the real afldb_test child still loads under the test target label with its pinned "
      "hash and counts, and declares target='afldb_test'",
      real_test_doc["target"] == "afldb_test")


def exporter_target_labels() -> dict:
    """export_person_bridge.TARGET_DSN_ENV read from source without importing that module
    (it carries a database surface this contract does not load): label -> required database."""
    src = (TOOL_DIR / "export_person_bridge.py").read_text(encoding="utf-8")
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "TARGET_DSN_ENV" for t in node.targets):
            return {k.value: v.elts[1].value for k, v in zip(node.value.keys, node.value.values)}
    return {}


exporter = exporter_target_labels()
check("8b.5 every target's child_target is one of the exporter's own TARGET_DSN_ENV labels, and "
      "each label's exporter database equals this target's physical database",
      exporter == {"afldb_test": "afldb_test", "dev": "afldb_dev"}
      and all(cfg["child_target"] in exporter
              and exporter[cfg["child_target"]] == cfg["database"]
              for cfg in tool.TARGETS.values())
      and "prod" not in exporter,
      str(exporter))

section("9. CLI --target dev: mandatory --bridge, no silent afldb_test reuse, no PROD choice")

saved_dev_dsn = os.environ.pop("AFLDB_DEV_DATABASE_URL", None)
tool.open_read_only = never_connect
common_saved_load = None
try:
    import common as common_mod
    common_saved_load = common_mod.load_env
    common_mod.load_env = lambda *_a, **_k: None
    out3 = io.StringIO()
    with contextlib.redirect_stdout(out3):
        rc_dev_no_bridge = tool.main(["plan", "--target", "dev"])
    os.environ["AFLDB_DEV_DATABASE_URL"] = "postgresql://u:pw@h:5432/afldb_dev"
    out4 = io.StringIO()
    with contextlib.redirect_stdout(out4):
        rc_dev_still_no_bridge = tool.main(["plan", "--target", "dev"])
    out5 = io.StringIO()
    with contextlib.redirect_stdout(out5):
        rc_dev_reuse = tool.main(["plan", "--target", "dev", "--bridge", tool.CHILD_REL])
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            tool.main(["plan", "--target", "prod"])
            prod_choice_refused = False
        except SystemExit as exc:
            prod_choice_refused = exc.code not in (0, tool.EXIT_OK)
finally:
    tool.open_read_only = original_open
    if common_saved_load is not None:
        common_mod.load_env = common_saved_load
    if saved_dev_dsn is None:
        os.environ.pop("AFLDB_DEV_DATABASE_URL", None)
    else:
        os.environ["AFLDB_DEV_DATABASE_URL"] = saved_dev_dsn

check("9.1 --target dev with no --bridge and no AFLDB_DEV_DATABASE_URL exits ERROR "
      "before any DSN is read (never reaches open_read_only)",
      rc_dev_no_bridge == tool.EXIT_ERROR and "--bridge is required" in out3.getvalue())
check("9.2 --target dev with AFLDB_DEV_DATABASE_URL set but still no --bridge still exits ERROR",
      rc_dev_still_no_bridge == tool.EXIT_ERROR and "--bridge is required" in out4.getvalue())
check("9.3 --target dev with --bridge pointed at the afldb_test child is refused "
      "(must not silently reuse the afldb_test child)",
      rc_dev_reuse == tool.EXIT_ERROR and "must not be the afldb_test child" in out5.getvalue())
check("9.4 --target prod does not exist as a choice", prod_choice_refused)

# The exact regression the real DEV pre-import attempt hit: `plan --target dev --bridge <the real
# DEV child>` refused with "the child targets 'dev', not afldb_dev" before anything else could
# run. open_read_only is still stubbed to an assertion, so this can never reach a database; the
# run is expected to stop at the point where it would open a connection -- which is exactly how
# far a DB-free contract can take it, and is past every offline guard the bug was blocking.
REACHED = "REFUSED: contract stub -- the gate reached the connection step"


def reached_connection(_dsn):
    raise tool.GateError(REACHED)


saved_dev_dsn2 = os.environ.pop("AFLDB_DEV_DATABASE_URL", None)
tool.open_read_only = never_connect
common_saved_load2 = None
try:
    import common as common_mod2
    common_saved_load2 = common_mod2.load_env
    common_mod2.load_env = lambda *_a, **_k: None
    tool.open_read_only = reached_connection
    os.environ["AFLDB_DEV_DATABASE_URL"] = "postgresql://u:pw@h:5432/afldb_dev"
    out6 = io.StringIO()
    with contextlib.redirect_stdout(out6):
        rc_dev_real_child = tool.main(["plan", "--target", "dev", "--bridge", REAL_DEV_CHILD_REL])
finally:
    tool.open_read_only = original_open
    if common_saved_load2 is not None:
        common_mod2.load_env = common_saved_load2
    if saved_dev_dsn2 is None:
        os.environ.pop("AFLDB_DEV_DATABASE_URL", None)
    else:
        os.environ["AFLDB_DEV_DATABASE_URL"] = saved_dev_dsn2

dev_real_output = out6.getvalue()
check("9.5 --target dev with the REAL committed DEV child is no longer refused on its target "
      "label (the exact fail-closed bug the DEV pre-import attempt hit)",
      "the child targets" not in dev_real_output,
      str((rc_dev_real_child, dev_real_output.strip().splitlines()[-2:])))
check("9.6 that run passed every offline guard -- the real DEV child's pinned bytes, the v2 "
      "parent_sha256 chain and the Stage A snapshot -- and stopped only where it would open a "
      "connection",
      rc_dev_real_child == tool.EXIT_ERROR and REACHED in dev_real_output
      and REAL_DEV_CHILD_SHA256[:16] in dev_real_output
      and "parent_sha256 chain verified" in dev_real_output,
      str(dev_real_output.strip().splitlines()[-5:]))

# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} DraftGuru import-gate check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    sys.exit(1)
print("All DraftGuru import-gate checks hold.")
