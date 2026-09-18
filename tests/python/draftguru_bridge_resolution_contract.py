#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase 3 correction handoff §C.1, §C.2, §C.7 -- exporter/importer
target-resolution agreement, direct on the real functions.

    python tests/python/draftguru_bridge_resolution_contract.py

The independent review found two divergences between export_person_bridge.py's
REGISTRATION_SQL and import_draftguru.py's resolve_afltables_players():

  1. the exporter counted COUNT(DISTINCT ei.player_id), which HIDES a genuine duplicate
     registration (two external_identities rows for one identity, same player) behind a
     count of 1, while the importer appends one candidate per ROW it reads and HALTs on
     len(candidates) != 1 -- so the exporter could call an identity "registered exactly
     once" while the importer would still refuse it;
  2. the exporter carried no match_method filter, so an identity registered under some
     OTHER match_method passed the exporter as "registered" but resolved to zero
     candidates at import (also a HALT, via the bridge branch's "resolves to 0 canonical
     players" refusal).

external_identities carries UNIQUE (source_id, external_id) (src/db/migrations/
002_core_entities.sql:189), so a literal duplicate DATABASE ROW for one external_id is
already structurally impossible today. That is exactly why this file tests the two
resolution FUNCTIONS directly, with a fabricated row set standing in for whatever
read_target_registration()/resolve_afltables_players() would see -- it proves the two
functions' OWN counting logic agrees (or, for the importer, fails closed) regardless of
whether today's schema can currently produce that input. Neither function is asked to open
a real connection: resolve_afltables_players() only ever calls cur.execute()/cur.fetchall(),
so a fake cursor object exercises its real code unmodified; build_deployment_dataset() and
apply_authority() take their inputs as plain Python values.

No database, no network, no importer/exporter subprocess.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))

import export_person_bridge as exporter          # noqa: E402
import import_draftguru as importer              # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def check_raises(name: str, exc_type: type[BaseException], fn, *args, **kwargs) -> None:
    try:
        fn(*args, **kwargs)
    except exc_type as exc:
        print(f"  PASS  {name}")
        return
    except Exception as exc:  # noqa: BLE001
        print(f"  FAIL  {name} -- raised {type(exc).__name__}, expected {exc_type.__name__}")
        failures.append(name)
        return
    print(f"  FAIL  {name} -- no exception raised")
    failures.append(name)


class FakeCursor:
    """Stands in for a psycopg cursor: records the SQL it is given and returns a
    pre-loaded row set on fetchall(). Never opens anything."""

    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows
        self.executed: list[tuple] = []

    def execute(self, sql, params=None):  # noqa: ANN001
        self.executed.append((sql, params))

    def fetchall(self):
        return list(self._rows)


class Stub:
    """Minimal stand-in for the importer's Reporter -- apply_authority() only ever
    calls .warn(), and only on a live/ledger overlap this contract never exercises."""

    def warn(self, *args, **kwargs):  # noqa: D401, ANN001, ANN002, ANN003
        pass


IDENTITY = "players/D/Duplicate_Registration.html"

print("1. resolve_afltables_players() does not de-duplicate rows (handoff sec C.1)")

# A row set standing in for what the importer's own query would return if the schema
# permitted two rows for one (source_id, external_id) under the pinned match_method --
# same player_id both times, the "duplicate registration for the same player" case §B names.
cur = FakeCursor([(IDENTITY, 42), (IDENTITY, 42)])
resolved = importer.resolve_afltables_players(cur, afltables_source_id=1)
check("1a two rows for one identity produce a 2-element candidate list, not a distinct-count of 1",
      resolved.get(IDENTITY) == [42, 42], str(resolved.get(IDENTITY)))
check("1b the query is filtered to the pinned match_method",
      cur.executed[0][1] == (1, importer.AFLTABLES_MATCH_METHOD),
      str(cur.executed[0][1]))

print()
print("2. apply_authority() HALTs on that 2-element candidate list (mirrors the real bridge "
      "and ledger branches -- proves the importer's own fail-closed behaviour on this input)")


def run_bridge_with_duplicate() -> None:
    persons = {"https://www.draftguru.com.au/players/dup_target/1": {"display_name_raw": "Dup Target"}}
    importer.apply_authority(
        cur=None, rep=Stub(), persons=persons, ledger={}, live={},
        bridges={"https://www.draftguru.com.au/players/dup_target/1": IDENTITY},
        afl_players=resolved, source_id=1, dg_identities={}, seeds_allowed=True)


check_raises("2a a bridge naming the duplicated identity HALTs with ImportFailure",
             importer.ImportFailure, run_bridge_with_duplicate)

print()
print("3. export_person_bridge.build_deployment_dataset() agrees: the SAME duplicated-row "
     "count (2) is withheld target_ambiguous, never silently accepted as registered "
     "(handoff sec C.1, C.2)")

contract, _b3 = exporter.load_contract_and_b3()
parent = {
    "schema_version": 1,
    "bridges": [
        {"player_url": "https://www.draftguru.com.au/players/dup_target/1",
         "afltables_external_id": IDENTITY},
        {"player_url": "https://www.draftguru.com.au/players/unregistered_target/1",
         "afltables_external_id": "players/U/Unregistered_Target.html"},
        {"player_url": "https://www.draftguru.com.au/players/clean_target/1",
         "afltables_external_id": "players/C/Clean_Target.html"},
    ],
    "withheld": [],
}
# registration counts exactly mirroring §C.1's duplicate-row scenario (2), an identity this
# target never registered under the pinned match_method (0, absent from the dict), and an
# ordinary unique registration (1).
registration = {IDENTITY: len(resolved[IDENTITY]), "players/C/Clean_Target.html": 1}
deployment = exporter.build_deployment_dataset(
    contract, parent=parent, target="afldb_test", registration=registration)
reasons = {w["player_url"]: w["reason"] for w in deployment["withheld"]}

check("3a the duplicated-registration identity is withheld target_ambiguous, not accepted",
      reasons.get("https://www.draftguru.com.au/players/dup_target/1") == "target_ambiguous",
      str(reasons.get("https://www.draftguru.com.au/players/dup_target/1")))
check("3b an identity absent from the registration dict is withheld target_not_registered",
      reasons.get("https://www.draftguru.com.au/players/unregistered_target/1") == "target_not_registered",
      str(reasons.get("https://www.draftguru.com.au/players/unregistered_target/1")))
check("3c an identity registered exactly once is accepted into the deployment bridge",
      deployment["bridges"] == [
          {"player_url": "https://www.draftguru.com.au/players/clean_target/1",
           "afltables_external_id": "players/C/Clean_Target.html"}],
      str(deployment["bridges"]))
check("3d withheld count matches (dup + unregistered), accepted count matches (clean only)",
      deployment["counts"]["withheld"] == 2 and deployment["counts"]["bridges"] == 1,
      str(deployment["counts"]))

print()
print("4. apply_authority(): an admissible bridge that AGREES with an existing human decision "
     "is excluded from stats['bridge'] but counted in stats['ledger'], with no HALT "
     "(handoff sec C.7, sec 3's three agreeing rows: matt_rendell/1, nathan_fyfe/1, "
     "ryan_o'keefe/1)")

AGREEING_URL = "https://www.draftguru.com.au/players/agreeing_person/1"
OTHER_URL = "https://www.draftguru.com.au/players/other_bridge_person/1"
AGREEING_IDENTITY = "players/A/Agreeing_Person.html"
OTHER_IDENTITY = "players/O/Other_Bridge_Person.html"

persons = {
    AGREEING_URL: {"display_name_raw": "Agreeing Person"},
    OTHER_URL: {"display_name_raw": "Other Bridge Person"},
}
ledger = {
    AGREEING_URL: {"decision": "linked",
                    "target": {"source": "afltables", "external_id": AGREEING_IDENTITY}},
}
bridges = {AGREEING_URL: AGREEING_IDENTITY, OTHER_URL: OTHER_IDENTITY}
afl_players = {AGREEING_IDENTITY: [101], OTHER_IDENTITY: [202]}

stats = importer.apply_authority(
    cur=None, rep=Stub(), persons=persons, ledger=ledger, live={},
    bridges=bridges, afl_players=afl_players, source_id=1, dg_identities={}, seeds_allowed=True)

check("4a stats['ledger'] counts the one explicit human decision",
      stats["ledger"] == 1, str(stats))
check("4b stats['bridge'] counts ONLY the non-agreeing bridge, excluding the agreeing one",
      stats["bridge"] == 1, str(stats))
check("4c the agreeing person keeps the human decision's player_id, not a re-application",
      persons[AGREEING_URL]["player_id"] == 101
      and persons[AGREEING_URL]["match_method"] == importer.LEDGER_MATCH_METHOD,
      str({k: persons[AGREEING_URL].get(k) for k in ("player_id", "match_method")}))
check("4d the other bridge person is linked via the bridge, not the ledger",
      persons[OTHER_URL]["player_id"] == 202
      and persons[OTHER_URL]["match_method"] == importer.BRIDGE_MATCH_METHOD,
      str({k: persons[OTHER_URL].get(k) for k in ("player_id", "match_method")}))
check("4e no HALT: apply_authority() returned normally for an agreeing bridge", True)

print()
print("5. apply_authority(): a bridge that DISAGREES with an existing human decision HALTs "
     "(sanity check that 'agrees' in item 4 is doing real work, not vacuously passing)")


def run_bridge_disagreeing() -> None:
    disagreeing_persons = {AGREEING_URL: {"display_name_raw": "Agreeing Person"}}
    disagreeing_afl_players = {AGREEING_IDENTITY: [101], "players/W/Wrong.html": [999]}
    importer.apply_authority(
        cur=None, rep=Stub(), persons=disagreeing_persons, ledger=ledger, live={},
        bridges={AGREEING_URL: "players/W/Wrong.html"},
        afl_players=disagreeing_afl_players, source_id=1, dg_identities={}, seeds_allowed=True)


check_raises("5a a disagreeing bridge HALTs with ImportFailure",
             importer.ImportFailure, run_bridge_disagreeing)

print()
print("6. --resolve-against takes the SOURCE-EVIDENCE parent, never a per-target deployment "
      "child (the resolve-side twin of the --review-sample guard; the v2 parent and the v1 "
      "afldb_test child now differ by one filename suffix)")


def refusal(fn, *args, **kwargs) -> str | None:
    """The refusal message, or None when the call was accepted."""
    try:
        fn(*args, **kwargs)
    except exporter.BridgeExportError as exc:
        return str(exc)
    return None


deployment_input = {"schema_version": 1, "kind": "deployment", "target": "afldb_test",
                    "bridges": [], "withheld": []}
msg = refusal(exporter.assert_resolvable_parent, deployment_input)
check("6a a kind='deployment' child is refused as a resolve input",
      msg is not None and "not a" in msg and "deployment child" in msg, str(msg))
check("6b the source-evidence parent is accepted",
      refusal(exporter.assert_resolvable_parent,
              {"schema_version": 1, "kind": "source-evidence", "bridges": []}) is None)
check("6c a minimal parent carrying no 'kind' is still accepted (integration-test shape)",
      refusal(exporter.assert_resolvable_parent,
              {"schema_version": 1, "bridges": []}) is None)

print()
print("7. --resolve-against never silently replaces an existing file: atomic_write_bytes() "
      "would overwrite the pinned v1 child or the parent itself without warning")

import tempfile  # noqa: E402

with tempfile.TemporaryDirectory() as _td:
    _dir = Path(_td)
    parent_file = _dir / "parent.json"
    parent_file.write_bytes(b"{}\n")
    fresh_out = _dir / "child.json"
    existing_out = _dir / "existing-child.json"
    existing_out.write_bytes(b"{}\n")

    check("7a a --out that does not yet exist is allowed",
          refusal(exporter.assert_writable_out, fresh_out,
                  parent_path=parent_file, allow_overwrite=False) is None)

    msg = refusal(exporter.assert_writable_out, parent_file,
                  parent_path=parent_file, allow_overwrite=False)
    check("7b --out equal to --parent is refused", msg is not None and "same file" in msg,
          str(msg))
    msg = refusal(exporter.assert_writable_out, parent_file,
                  parent_path=parent_file, allow_overwrite=True)
    check("7c --out equal to --parent is refused even with --allow-overwrite",
          msg is not None and "same file" in msg, str(msg))

    msg = refusal(exporter.assert_writable_out, existing_out,
                  parent_path=parent_file, allow_overwrite=False)
    check("7d an existing --out is refused without --allow-overwrite",
          msg is not None and "already exists" in msg, str(msg))
    check("7e an existing --out is permitted with an explicit --allow-overwrite",
          refusal(exporter.assert_writable_out, existing_out,
                  parent_path=parent_file, allow_overwrite=True) is None)

    check("7f the guards wrote nothing and left both files byte-identical",
          parent_file.read_bytes() == b"{}\n" and existing_out.read_bytes() == b"{}\n"
          and not fresh_out.exists())

print()
print("8. the resolve path is provably read-only: every SQL statement this module can "
      "execute is a SELECT, resolved through the module's own constants (AST, not grep)")

import ast  # noqa: E402
import re as _re  # noqa: E402

EXPORTER_SRC = (TOOL_DIR / "export_person_bridge.py").read_text(encoding="utf-8")
WRITE_VERBS = ("insert", "update", "delete", "merge", "truncate", "create", "drop", "alter",
               "grant", "revoke", "copy", "vacuum", "refresh", "commit", "call", "do")


def executed_sql(src: str) -> tuple[list[str], list[str]]:
    """Every SQL string reachable by a `.execute(...)` call in this module.

    The first argument is resolved either from a literal or, when it is a bare name, from
    the imported module's own attribute -- so an f-string constant such as REGISTRATION_SQL
    is checked as the exact text psycopg would receive. Anything that cannot be resolved is
    returned as unresolved and fails the contract, so the SELECT-only claim below is
    exhaustive rather than a sample.
    """
    tree = ast.parse(src)
    statements: list[str] = []
    unresolved: list[str] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "execute"):
            continue
        arg = node.args[0] if node.args else None
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            statements.append(arg.value)
            continue
        if isinstance(arg, ast.Name):
            value = getattr(exporter, arg.id, None)
            if isinstance(value, str):
                statements.append(value)
                continue
        unresolved.append(f"{node.lineno}: {ast.unparse(node)}")
    return statements, unresolved


sql_statements, unresolved_execs = executed_sql(EXPORTER_SRC)

check("8a every execute() call resolves to a known SQL string",
      not unresolved_execs, "; ".join(unresolved_execs))
check("8b the module executes exactly the two statements of the registration read",
      len(sql_statements) == 2, str(len(sql_statements)))
check("8c every executed statement is a SELECT",
      all(s.strip().lower().startswith("select") for s in sql_statements),
      str([s.strip().split()[0] for s in sql_statements if s.strip()]))
offending = sorted({verb for s in sql_statements for verb in WRITE_VERBS
                    if _re.search(rf"\b{verb}\b", s, _re.I)})
check("8d no executed statement carries a write, DDL or transaction-control verb",
      not offending, str(offending))


def calls_named(src: str, attr: str) -> list[str]:
    return [f"{n.lineno}: {ast.unparse(n)}" for n in ast.walk(ast.parse(src))
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and n.func.attr == attr]


commits = calls_named(EXPORTER_SRC, "commit")
check("8e the module never calls commit()", not commits, "; ".join(commits))
check("8f the module always rolls the read transaction back", calls_named(EXPORTER_SRC, "rollback"))
check("8g the module closes the connection", calls_named(EXPORTER_SRC, "close"))

autocommits = [f"{n.lineno}: {ast.unparse(n)}" for n in ast.walk(ast.parse(EXPORTER_SRC))
               if isinstance(n, ast.Attribute) and n.attr == "autocommit"]
check("8h the module never touches autocommit", not autocommits, "; ".join(autocommits))

connects = [n for n in ast.walk(ast.parse(EXPORTER_SRC))
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and n.func.attr == "connect"]
read_only_connects = [
    n for n in connects
    if any(kw.arg == "options" and isinstance(kw.value, ast.Constant)
           and isinstance(kw.value.value, str)
           and "default_transaction_read_only=on" in kw.value.value
           for kw in n.keywords)]
check("8i every connect() forces default_transaction_read_only=on at the server",
      len(connects) == 1 and len(read_only_connects) == 1,
      f"{len(connects)} connect call(s), {len(read_only_connects)} read-only")

imported: set[str] = set()
for _n in ast.walk(ast.parse(EXPORTER_SRC)):
    if isinstance(_n, ast.Import):
        imported.update(a.name.split(".")[0] for a in _n.names)
    elif isinstance(_n, ast.ImportFrom) and _n.module:
        imported.add(_n.module.split(".")[0])
check("8j the tool imports no importer module (no write surface, even transitively) -- a "
      "comment naming import_draftguru is prose, not an import",
      "import_draftguru" not in imported, str(sorted(imported)))

print()
if failures:
    print(f"FAILED: {len(failures)} check(s): {', '.join(failures)}")
    raise SystemExit(1)
print("All DraftGuru bridge-resolution alignment checks hold.")
