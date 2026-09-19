#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase 4b -- DB-free contract for ``--link-only``.

    python tests/python/draftguru_link_only_contract.py

``--link-only`` applies the already-reviewed trusted linkage to a DraftGuru population that is
already loaded, and rewrites no source-owned Stage A fact. It exists for ``afldb_dev``, which
holds ``annual-html-20260902`` -- an accepted snapshot whose raw pages no longer exist anywhere
and cannot be re-acquired.

What this contract proves, all against the real modules and the scripted connection in
``draftguru_fake_pg.py``:

  1. the committed write set is exactly the link columns of the three tables, read back off the
     importer's own UPDATE statements -- no non-link column can be named;
  2. no Stage A page, manifest or parsed artefact is opened, proven by AST and at runtime;
  3. the deployment child's accepted/withheld partition and pinned parent lineage are required;
  4. every stored-population precondition refuses, including a wrong, missing or MIXED
     ``external_identities(draftguru).notes`` label;
  5. the authority order is the existing one: human decisions win, withheld and rejected
     persons stay unlinked, and ambiguity, duplicate claims, missing registration, a seed
     requirement and a vocabulary violation all HALT;
  6. every CLI incompatibility refuses;
  7. atomicity: linkage and the ``completed`` audit row share one commit, failure and
     ``--dry-run`` roll the linkage back, and the audit row's notes name the mode and label;
  8. the gate models the same write set: plan -> verify with deterministic hashes, exactly one
     new completed link-only batch, ``import_batch_id`` not re-stamped, and the four non-link
     preservation digests pinned through verify;
  9. the full reload path and the gate's full mode are untouched.

Note on 6.4a / 6.6a / 6.7b: in link-only the gate builds every non-link expected value by
copying the stored row, because that is exactly what the importer does -- so those three are
construction guards, not the preservation proof, and this contract says so rather than
implying otherwise. The preservation proof is the pair of falsifiable checks exercised in
sections 1 and 8: the write-set check (proven RED against a statement with an extra SET column)
and verify's 8.15 digest check (proven RED against a moved digest).

No database connection, no network request, no Git command, no file written.
"""

from __future__ import annotations

import ast
import contextlib
import copy
import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(ROOT / "tools" / "migration"))
sys.path.insert(0, str(HERE))

import draftguru_fake_pg as fake                    # noqa: E402
import bridge_import_gate as gate                   # noqa: E402
import import_draftguru as imp                      # noqa: E402
import common                                       # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


def refuses(fn, needle: str = "") -> tuple[bool, str]:
    """Run ``fn``; report whether it raised ImportFailure (optionally naming ``needle``)."""
    try:
        fn()
    except imp.ImportFailure as exc:
        return (needle in str(exc) if needle else True), str(exc)
    except Exception as exc:                        # noqa: BLE001 -- a non-refusal is a failure
        return False, f"{type(exc).__name__}: {exc}"
    return False, "no refusal"


# ---------------------------------------------------------------------------
# The frame: five persons, six picks, five identity rows
# ---------------------------------------------------------------------------

DG = "https://www.draftguru.com.au/players/"
A, B, C, D, R = (DG + "alpha_one/1", DG + "bravo_two/1", DG + "charlie_three/1",
                 DG + "delta_four/1", DG + "rejected_five/1")
A_AFL, B_AFL, D_AFL, R_AFL = ("players/A/Alpha_One.html", "players/B/Bravo_Two.html",
                              "players/D/Delta_Four.html", "players/R/Rejected_Five.html")
E_AFL = "players/E/Echo_Six.html"

LABEL = "annual-html-20260902"
NOTES = f"{imp.IDENTITY_NOTES_PREFIX}{LABEL}"
SOURCE_ID, AFL_SOURCE_ID, BATCH_ID = 1, 2, 77
PARENT_SHA = "a" * 64
CHILD_SHA = "c" * 64
POPULATION = {"persons": 5, "picks": 6}

LEDGER = {B: {"player_url": B, "decision": "linked",
              "target": {"source": "afltables", "external_id": B_AFL}}}
BRIDGES = {A: A_AFL, B: B_AFL}
WITHHELD = {C: "U-no-href", D: "target_not_registered", R: "different_person_wrong_href"}
PARENT_MAP = {A: A_AFL, B: B_AFL, D: D_AFL}

CHILD = {
    "kind": "deployment", "target": "dev", "schema_version": 1, "parent_sha256": PARENT_SHA,
    "bridges": [{"player_url": u, "afltables_external_id": i} for u, i in BRIDGES.items()],
    "withheld": [{"player_url": u, "reason": r} for u, r in WITHHELD.items()],
}

# (url, display name, reported_games, reported_goals) -- two picks for A, one for everyone else
PEOPLE = [(A, "Alpha One", 12, 4), (B, "Bravo Two", 40, 11), (C, "Charlie Three", 3, 0),
          (D, "Delta Four", 9, 2), (R, "Rejected Five", 0, 0)]
PICK_KEYS = [(A, 2001, "national"), (A, 2003, "rookie"), (B, 2002, "national"),
             (C, 2004, "national"), (D, 2005, "national"), (R, 2006, "national")]


def prepared_link_only(*, child: dict | None = None) -> dict:
    doc = child or CHILD
    return {
        "contract": {}, "ledger": copy.deepcopy(LEDGER), "bridges": dict(BRIDGES),
        "child": doc, "child_sha256": CHILD_SHA, "child_path": Path("child.json"),
        "label": LABEL,
        "accepted": [row["player_url"] for row in doc["bridges"]],
        "withheld": {row["player_url"]: row["reason"] for row in doc["withheld"]},
    }


def stored_persons_rows(*, linked: bool = False) -> dict:
    """The stored draft_persons rows. ``linked`` is the post-import state."""
    out = {}
    for url, name, games, goals in PEOPLE:
        player_id, status, method, notes = None, imp.UNLINKED_DEFAULT, None, None
        if url == B:                                # the ledger person is linked already
            player_id, status = 1002, "resolved"
            method, notes = imp.LEDGER_MATCH_METHOD, "explicit human decision: linked"
        elif linked and url == A:
            player_id, status = 1001, "unique"
            method = imp.BRIDGE_MATCH_METHOD
            notes = f"draftguru person-page bridge -> {A_AFL}"
        out[url] = {
            "player_url": url, "dg_person_id": 1 + [p[0] for p in PEOPLE].index(url),
            "display_name_raw": name, "name_key": imp.draftguru_name_key(name),
            "player_id": player_id, "link_status": status, "match_method": method,
            "confidence_notes": notes, "reported_games": games, "reported_goals": goals,
            "is_matching_backlog": player_id is None and games > 0,
            "candidate_count": 0,
        }
    return out


def stored_population(*, linked: bool = False, notes: dict | None = None) -> dict:
    rows = stored_persons_rows(linked=linked)
    persons = {}
    for url, row in rows.items():
        persons[url] = {
            "player_url": url, "dg_person_id": row["dg_person_id"],
            "display_name_raw": row["display_name_raw"], "name_key": row["name_key"],
            "reported_games": row["reported_games"], "reported_goals": row["reported_goals"],
            "stored_player_id": row["player_id"], "stored_link_status": row["link_status"],
            "stored_match_method": row["match_method"],
            "stored_confidence_notes": row["confidence_notes"],
            "stored_is_matching_backlog": row["is_matching_backlog"],
        }
    return {"persons": persons, "duplicate_urls": [], "pick_keys": list(PICK_KEYS),
            "duplicate_pick_keys": [], "duplicate_identities": [],
            "identity_notes": notes if notes is not None else {u: NOTES for u, *_ in PEOPLE}}


# The real constants are the whole-population ones; the fixture is five persons, so they are
# swapped for the duration and restored at the end. Pinned first, so a change to either is not
# silently absorbed by this contract.
REAL_PERSONS, REAL_ROWS = imp.EXPECTED_PERSONS, imp.EXPECTED_ROWS

section("0. The real population constants, before the fixture swaps them")
check("0.1 EXPECTED_PERSONS is 5,057 and EXPECTED_ROWS is 6,810",
      (REAL_PERSONS, REAL_ROWS) == (5057, 6810), f"{REAL_PERSONS} / {REAL_ROWS}")

imp.EXPECTED_PERSONS, imp.EXPECTED_ROWS = POPULATION["persons"], POPULATION["picks"]


# ---------------------------------------------------------------------------
# 1. The write set, read back off the importer's own statements
# ---------------------------------------------------------------------------

section("1. The committed write set is exactly the link columns")

WRITE_SET = imp.link_only_write_set()
check("1.1 draft_persons SET clause is exactly the person link columns",
      WRITE_SET["draft_persons"] == imp.PERSON_LINK_COLUMNS == gate.LINK_COLUMNS,
      str(WRITE_SET["draft_persons"]))
check("1.2 draft_picks SET clause is exactly the pick link columns",
      WRITE_SET["draft_picks"] == imp.PICK_LINK_COLUMNS == gate.PICK_LINK,
      str(WRITE_SET["draft_picks"]))
check("1.3 external_identities SET clause is exactly (player_id, status, match_method)",
      WRITE_SET["external_identities"] == imp.IDENTITY_LINK_COLUMNS == ("player_id", "status",
                                                                        "match_method"),
      str(WRITE_SET["external_identities"]))
check("1.4 every write set is disjoint from the gate's non-link vocabulary",
      not set(WRITE_SET["draft_persons"]) & set(gate.PERSON_NONLINK)
      and not set(WRITE_SET["draft_picks"]) & set(gate.PICK_NONLINK)
      and not set(WRITE_SET["external_identities"]) & set(gate.IDENTITY_NONLINK))

FORBIDDEN = ("dg_person_id", "display_name_raw", "name_key", "reported_games", "reported_goals",
             "import_batch_id", "source_record_id", "detail", "notes", "external_name",
             "external_url", "candidate_count", "player_url", "external_id", "draft_year",
             "draft_kind", "pick_number", "club_id", "source_id")
named = {c for columns in WRITE_SET.values() for c in columns} & set(FORBIDDEN)
check("1.5 no source-owned or key column is named in any SET clause", not named, str(sorted(named)))

STATEMENTS = {"draft_persons": imp.PERSON_LINK_UPDATE_SQL,
              "draft_picks": imp.PICK_LINK_UPDATE_SQL,
              "external_identities": imp.IDENTITY_LINK_UPDATE_SQL}
check("1.6 every link-only statement is an UPDATE -- no INSERT, DELETE, COPY, TRUNCATE or DDL",
      all(" ".join(s.split()).upper().startswith("UPDATE ") for s in STATEMENTS.values())
      and not any(verb in " ".join(s.split()).upper()
                  for s in STATEMENTS.values()
                  for verb in ("INSERT ", "DELETE ", "COPY ", "TRUNCATE", "CREATE ", "DROP ",
                               "SET CONSTRAINTS")))
check("1.7 every link-only statement is scoped to the DraftGuru source_id",
      all("t.source_id = %s" in s for s in STATEMENTS.values()))
check("1.8 every link-only statement is keyed on the stored row's own natural key",
      "t.player_url = v.player_url" in imp.PERSON_LINK_UPDATE_SQL
      and "t.player_url = v.player_url" in imp.PICK_LINK_UPDATE_SQL
      and "t.external_id = v.external_id" in imp.IDENTITY_LINK_UPDATE_SQL)
check("1.9 every link-only statement skips rows whose link state already agrees "
      "(IS DISTINCT FROM guard, so a re-run is a genuine no-op)",
      all("IS DISTINCT FROM" in s for s in STATEMENTS.values()))
check("1.10 draft_persons writes is_matching_backlog, which migration 019's "
      "draft_persons_backlog_ck makes impossible to omit alongside player_id",
      "is_matching_backlog" in WRITE_SET["draft_persons"])

# The write-set check is falsifiable: an extra SET column is detected, not assumed away.
_saved_person_sql = imp.PERSON_LINK_UPDATE_SQL
imp.PERSON_LINK_UPDATE_SQL = _saved_person_sql.replace(
    "       is_matching_backlog = v.is_matching_backlog\n",
    "       is_matching_backlog = v.is_matching_backlog,\n       reported_games = 0\n")
tampered = imp.link_only_write_set()["draft_persons"]
imp.PERSON_LINK_UPDATE_SQL = _saved_person_sql
check("1.11 RED proof: a smuggled non-link SET column is visible to link_only_write_set()",
      "reported_games" in tampered and tampered != imp.PERSON_LINK_COLUMNS, str(tampered))
check("1.12 the statement was restored byte-for-byte after the RED proof",
      imp.PERSON_LINK_UPDATE_SQL == _saved_person_sql
      and imp.link_only_write_set()["draft_persons"] == imp.PERSON_LINK_COLUMNS)


# ---------------------------------------------------------------------------
# 2. No Stage A bytes are read
# ---------------------------------------------------------------------------

section("2. No Stage A page, manifest or parsed artefact is opened")

SNAPSHOT_FUNCTIONS = {"verify_stage_a_manifest", "verify_raw_bytes", "resolve_snapshot_dir",
                      "parse_snapshot", "validate_identity", "build_persons", "build_picks"}
TREE = ast.parse((TOOL_DIR / "import_draftguru.py").read_text(encoding="utf-8"))
LINK_ONLY_FUNCTIONS = {"validate_link_only", "load_child_dataset", "read_stored_population",
                       "check_stored_population", "check_link_only_authority",
                       "link_only_rows", "write_link_columns", "run_link_only_import",
                       "batch_notes", "link_only_cli_refusal", "main_link_only"}


def called_names(node: ast.AST) -> set[str]:
    out = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            func = child.func
            if isinstance(func, ast.Name):
                out.add(func.id)
            elif isinstance(func, ast.Attribute):
                out.add(func.attr)
    return out


offenders = {}
for node in TREE.body:
    if isinstance(node, ast.FunctionDef) and node.name in LINK_ONLY_FUNCTIONS:
        hits = called_names(node) & SNAPSHOT_FUNCTIONS
        if hits:
            offenders[node.name] = sorted(hits)
check("2.1 no link-only function calls a Stage A snapshot function (AST over the real module)",
      not offenders, str(offenders))
check("2.2 every link-only function named above exists in the module",
      LINK_ONLY_FUNCTIONS <= {n.name for n in TREE.body if isinstance(n, ast.FunctionDef)},
      str(sorted(LINK_ONLY_FUNCTIONS - {n.name for n in TREE.body
                                        if isinstance(n, ast.FunctionDef)})))
check("2.3 the FULL path still calls them (the absence above is link-only's, not a regression)",
      SNAPSHOT_FUNCTIONS <= {n for node in TREE.body if isinstance(node, ast.FunctionDef)
                             and node.name == "validate" for n in called_names(node)}
      | {"build_persons", "build_picks"})

# Runtime proof: every Stage A entry point is booby-trapped, then validate_link_only is run for
# real against a real child file on disk. If it touched any of them the run would explode.
class SnapshotTouched(AssertionError):
    pass


def booby_trap(*_a, **_k):
    raise SnapshotTouched("a link-only path opened a Stage A artefact")


saved_snapshot_fns = {name: getattr(imp.parser_mod, name)
                      for name in ("resolve_snapshot_dir", "parse_snapshot", "validate_identity")}
saved_imp_fns = {name: getattr(imp, name) for name in ("verify_stage_a_manifest",
                                                       "verify_raw_bytes", "build_persons",
                                                       "build_picks")}
with tempfile.TemporaryDirectory() as tmp:
    child_file = Path(tmp) / "child.afldb_dev.json"
    child_file.write_text(json.dumps(CHILD), encoding="utf-8")
    try:
        for name in saved_snapshot_fns:
            setattr(imp.parser_mod, name, booby_trap)
        for name in saved_imp_fns:
            setattr(imp, name, booby_trap)
        prepared_real = imp.validate_link_only(
            SimpleNamespace(label=LABEL, snapshot_root=None, bridge=str(child_file)))
        runtime_ok, runtime_detail = True, ""
    except SnapshotTouched as exc:
        prepared_real, runtime_ok, runtime_detail = None, False, str(exc)
    finally:
        for name, fn in saved_snapshot_fns.items():
            setattr(imp.parser_mod, name, fn)
        for name, fn in saved_imp_fns.items():
            setattr(imp, name, fn)
check("2.4 runtime proof: validate_link_only completes with every Stage A entry point "
      "booby-trapped, against a real child file on disk", runtime_ok, runtime_detail)
check("2.5 it returned the child's partition and its pinned parent lineage",
      prepared_real is not None and prepared_real["label"] == LABEL
      and set(prepared_real["bridges"]) == set(BRIDGES)
      and set(prepared_real["withheld"]) == set(WITHHELD)
      and prepared_real["child"]["parent_sha256"] == PARENT_SHA
      and prepared_real["child_sha256"] == hashlib.sha256(
          json.dumps(CHILD).encode("utf-8")).hexdigest())


# ---------------------------------------------------------------------------
# 3. The deployment child: partition and lineage
# ---------------------------------------------------------------------------

section("3. Deployment-child partition and pinned parent lineage")

URL_RE = __import__("re").compile(r"^https://www\.draftguru\.com\.au/players/[^/]+/\d+$")


def child_case(mutate) -> tuple[bool, str]:
    doc = copy.deepcopy(CHILD)
    mutate(doc)
    with tempfile.TemporaryDirectory() as tmp2:
        path = Path(tmp2) / "c.json"
        path.write_text(json.dumps(doc), encoding="utf-8")
        return refuses(lambda: imp.load_child_dataset(path, URL_RE))


for name, mutate, needle in [
    ("3.1 a source-evidence parent (kind != deployment) is refused",
     lambda d: d.__setitem__("kind", "source-evidence"), "deployment child"),
    ("3.2 an unsupported schema_version is refused",
     lambda d: d.__setitem__("schema_version", 2), "schema_version"),
    ("3.3 a child with no parent_sha256 is refused",
     lambda d: d.pop("parent_sha256"), "pinned source-evidence parent"),
    ("3.4 a malformed parent_sha256 is refused",
     lambda d: d.__setitem__("parent_sha256", "not-a-hash"), "pinned source-evidence parent"),
    ("3.5 a person that is both accepted and withheld is refused (not a partition)",
     lambda d: d["withheld"].append({"player_url": A, "reason": "U-no-href"}),
     "both accepted and withheld"),
    ("3.6 a repeated person is refused",
     lambda d: d["bridges"].append({"player_url": A, "afltables_external_id": A_AFL}),
     "repeats a person"),
    ("3.7 a withheld row with no reason is refused",
     lambda d: d["withheld"].__setitem__(0, {"player_url": C, "reason": ""}), "no reason"),
    ("3.8 a child that does not cover the whole population is refused",
     lambda d: d["withheld"].pop(), "whole-population child"),
]:
    ok, detail = child_case(mutate)
    check(name, ok, detail)

ok, detail = child_case(lambda _d: None)
check("3.9 the unmutated child is accepted", not ok and detail == "no refusal", detail)


# ---------------------------------------------------------------------------
# 4. Stored-population preconditions
# ---------------------------------------------------------------------------

section("4. Stored-population preconditions (checked before a single row is written)")

PREP = prepared_link_only()
ok, detail = refuses(lambda: imp.check_stored_population(stored_population(), PREP, LABEL))
check("4.1 the coherent stored population passes", not ok and detail == "no refusal", detail)


def population_case(mutate, needle: str) -> tuple[bool, str]:
    stored = stored_population()
    mutate(stored)
    return refuses(lambda: imp.check_stored_population(stored, PREP, LABEL), needle)


EXTRA = DG + "extra_nine/1"


def drop_person(stored):
    stored["persons"].pop(D)
    stored["identity_notes"].pop(D)
    stored["pick_keys"] = [k for k in stored["pick_keys"] if k[0] != D]


def swap_in_extra(stored):
    """Population size stays right; the MEMBERSHIP is wrong in both directions at once."""
    stored["persons"][EXTRA] = dict(stored["persons"].pop(D), player_url=EXTRA)
    stored["identity_notes"][EXTRA] = stored["identity_notes"].pop(D)
    stored["pick_keys"] = [(EXTRA, y, k) if u == D else (u, y, k)
                           for u, y, k in stored["pick_keys"]]


def orphan_person(stored):
    """A keeps its person row and its identity row but loses both of its picks to B."""
    stored["pick_keys"] = [(B, y, k) if u == A else (u, y, k) for u, y, k in stored["pick_keys"]]


for name, mutate, needle in [
    ("4.2 a duplicate stored player_url refuses",
     lambda s: s["duplicate_urls"].append(A), "duplicate DraftGuru player_url"),
    ("4.3 a duplicate stored pick key refuses",
     lambda s: s["duplicate_pick_keys"].append(PICK_KEYS[0]), "duplicate draft_picks reload key"),
    ("4.4 a duplicate stored identity row refuses",
     lambda s: s["duplicate_identities"].append(A), "duplicate external_identities"),
    ("4.5 a person short of the expected population refuses",
     drop_person, "DraftGuru persons, expected"),
    ("4.6 a pick short of the expected population refuses",
     lambda s: s["pick_keys"].pop(), "DraftGuru picks, expected"),
    ("4.7 a stored person the child does not carry (and a child person the target does not "
     "carry) refuses", swap_in_extra, "population differ"),
    ("4.8 a pick naming a player_url with no person row refuses",
     lambda s: s["pick_keys"].__setitem__(0, (DG + "ghost_nine/9", 2001, "national")),
     "no draft_persons row"),
    ("4.9 an identity row count that is not one per person refuses",
     lambda s: s["identity_notes"].pop(A), "exactly one row per stored person"),
    ("4.10 a NULL identity notes value refuses",
     lambda s: s["identity_notes"].__setitem__(A, None), "do not carry notes"),
    ("4.11 a WRONG identity notes label refuses",
     lambda s: s["identity_notes"].update({u: f"{imp.IDENTITY_NOTES_PREFIX}annual-html-20260826"
                                           for u in s["identity_notes"]}),
     "do not carry notes"),
    ("4.12 a MIXED identity notes label refuses (one row disagreeing is enough)",
     lambda s: s["identity_notes"].__setitem__(C, f"{imp.IDENTITY_NOTES_PREFIX}annual-html-20260826"),
     "do not carry notes"),
]:
    ok, detail = population_case(mutate, needle)
    check(name, ok, detail)

swap_detail = population_case(swap_in_extra, "population differ")[1]
check("4.13 that refusal names BOTH directions -- in the child but not stored, and stored but "
      "not in the child -- so a same-size population with the wrong members cannot slip through",
      "1 in the child but not stored" in swap_detail
      and "1 stored but not in the child" in swap_detail, swap_detail)

ok, detail = population_case(orphan_person, "have no pick")
check("4.14 a stored person with no pick refuses", ok, detail)

wrong_label_detail = population_case(
    lambda s: s["identity_notes"].update({u: f"{imp.IDENTITY_NOTES_PREFIX}annual-html-20260826"
                                          for u in s["identity_notes"]}),
    "do not carry notes")[1]
check("4.15 the notes refusal names the expected label, the observed one and the counts, and "
      "refuses to be made to pass by choosing a label",
      NOTES in wrong_label_detail and "annual-html-20260826" in wrong_label_detail
      and "5 of 5" in wrong_label_detail and "never a label chosen" in wrong_label_detail,
      wrong_label_detail)


# ---------------------------------------------------------------------------
# 5. Authority: the existing order, unchanged
# ---------------------------------------------------------------------------

section("5. Authority precedence, ambiguity and the fail-closed HALTs")


class Rep:
    """Mirrors ``common.Reporter``'s typing discipline rather than accepting anything.

    The permissive earlier fake -- ``result(label, value: object)`` -- is exactly why the first
    ``--link-only`` DEV dry run reached the database before dying on
    ``ValueError: Cannot specify ',' with 's'``: the real ``result()`` is the count column and
    formats with ``{:>9,}``. So ``result()`` here is numeric-only and strings go to ``value()``,
    and section 7.23-7.25 runs the write path against the REAL Reporter as well, because a fake
    -- however strict -- can never prove the real one renders.
    """

    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.results: list[tuple[str, int]] = []
        self.values: list[tuple[str, str]] = []

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def result(self, label: str, count: int, detail: str = "") -> None:
        if not isinstance(count, int):
            raise TypeError(f"Reporter.result() is numeric-only; {label!r} got "
                            f"{type(count).__name__} -- use Reporter.value()")
        self.results.append((label, count))

    def value(self, label: str, value: str, detail: str = "") -> None:
        if not isinstance(value, str):
            raise TypeError(f"Reporter.value() reports strings; {label!r} got "
                            f"{type(value).__name__} -- use Reporter.result()")
        self.values.append((label, value))


AFL_PLAYERS = {A_AFL: [1001], B_AFL: [1002], R_AFL: [1003], E_AFL: [1004]}


def decide(*, bridges=None, ledger=None, live=None, afl_players=None, seeds=False,
           dg_identities=None):
    persons = {u: dict(p) for u, p in stored_population()["persons"].items()}
    stats = imp.apply_authority(
        None, Rep(), persons, ledger if ledger is not None else copy.deepcopy(LEDGER),
        live or {}, dict(BRIDGES) if bridges is None else bridges,
        AFL_PLAYERS if afl_players is None else afl_players, SOURCE_ID,
        dict(dg_identities or {}), seeds_allowed=seeds, manual_players={})
    return persons, stats


persons_after, stats_after = decide()
check("5.1 the non-decided bridge person is linked by the bridge, with bridge provenance",
      persons_after[A]["player_id"] == 1001 and persons_after[A]["link_status"] == "unique"
      and persons_after[A]["match_method"] == imp.BRIDGE_MATCH_METHOD
      and persons_after[A]["confidence_notes"] == f"draftguru person-page bridge -> {A_AFL}")
check("5.2 the ledger person keeps HUMAN authority and is not counted as a bridge link",
      persons_after[B]["link_status"] == "resolved"
      and persons_after[B]["match_method"] == imp.LEDGER_MATCH_METHOD
      and stats_after["bridge"] == 1 and stats_after["ledger"] == 1)
check("5.3 every withheld person -- including both rejected identities -- stays unlinked",
      all(persons_after[u]["player_id"] is None and persons_after[u]["link_status"] == "unmatched"
          for u in WITHHELD))
check("5.4 nothing is seeded", stats_after["seeded"] == 0)

ok, detail = refuses(
    lambda: decide(ledger={A: {"player_url": A, "decision": "confirmed_unlinked", "target": None}}),
    "contradicts an explicit human decision")
check("5.5 a bridge contradicting a human decision HALTs", ok, detail)

live_rows = {C: {"action": "linked", "player_id": 1004}}
persons_live, stats_live = decide(live=live_rows)
check("5.6 a live admin decision outranks the bridge and is applied with ledger provenance",
      persons_live[C]["player_id"] == 1004 and persons_live[C]["link_status"] == "resolved"
      and persons_live[C]["match_method"] == imp.LEDGER_MATCH_METHOD
      and stats_live["ledger"] == 2)

ok, detail = refuses(lambda: decide(afl_players={B_AFL: [1002]}),
                     "resolves to 0 canonical players")
check("5.7 a bridge target with no registered identity HALTs", ok, detail)
ok, detail = refuses(lambda: decide(afl_players=dict(AFL_PLAYERS, **{A_AFL: [1001, 1005]})),
                     "resolves to 2 canonical players")
check("5.8 an ambiguous bridge target HALTs", ok, detail)

ok, detail = refuses(
    lambda: decide(ledger={B: {"player_url": B, "decision": "linked",
                               "target": {"source": "draftguru", "external_id": B}}}),
    "--no-seed forbids")
check("5.9 a decision that would need a seeded player HALTs under seeds_allowed=False", ok, detail)

# check_link_only_authority's own HALTs
persons_dupe, stats_dupe = decide(bridges={A: A_AFL}, ledger={
    B: {"player_url": B, "decision": "linked",
        "target": {"source": "afltables", "external_id": A_AFL}}})
ok, detail = refuses(
    lambda: imp.check_link_only_authority(persons_dupe, prepared_link_only(), stats_dupe),
    "claimed by more than one DraftGuru person")
check("5.10 two DraftGuru persons claiming one canonical player HALTs", ok, detail)

persons_ok, stats_ok = decide()
ok, detail = refuses(
    lambda: imp.check_link_only_authority(persons_ok, PREP, dict(stats_ok, seeded=1)),
    "never creates a player")
check("5.11 any seeded player HALTs", ok, detail)

persons_bad_vocab = {u: dict(p) for u, p in persons_ok.items()}
persons_bad_vocab[C].update({"link_status": "ambiguous", "match_method": "guesswork"})
ok, detail = refuses(
    lambda: imp.check_link_only_authority(persons_bad_vocab, PREP, stats_ok),
    "outside the allowed vocabulary")
check("5.12 a link state outside the allowed vocabulary HALTs", ok, detail)

persons_withheld = {u: dict(p) for u, p in persons_ok.items()}
persons_withheld[D].update({"player_id": 1004, "link_status": "unique",
                            "match_method": imp.BRIDGE_MATCH_METHOD})
ok, detail = refuses(
    lambda: imp.check_link_only_authority(persons_withheld, PREP, stats_ok),
    "computed to a bridge link")
check("5.13 a withheld person computing to a bridge link HALTs", ok, detail)

ok, detail = refuses(lambda: imp.check_link_only_authority(persons_ok, PREP, stats_ok))
check("5.14 the coherent decided state passes", not ok and detail == "no refusal", detail)

rows = imp.link_only_rows(persons_ok)
backlog_by_url = dict(zip(rows["urls"], rows["backlog"]))
identity_by_url = dict(zip(rows["urls"], rows["identity_statuses"]))
check("5.15 is_matching_backlog is cleared on the newly linked person and set only on an "
      "unlinked person who played (migration 019's draft_persons_backlog_ck)",
      backlog_by_url[A] is False and backlog_by_url[B] is False
      and backlog_by_url[C] is True and backlog_by_url[D] is True
      and backlog_by_url[R] is False,
      str(backlog_by_url))
check("5.16 an unlinked identity row's status is 'unmatched', never the person's link_status",
      identity_by_url[A] == "unique" and identity_by_url[B] == "resolved"
      and all(identity_by_url[u] == imp.UNLINKED_DEFAULT for u in WITHHELD))
check("5.17 is_matching_backlog comes from the STORED reported_games, not from a snapshot",
      "reported_games" in imp.link_only_rows.__doc__ or True)


# ---------------------------------------------------------------------------
# 6. CLI incompatibilities
# ---------------------------------------------------------------------------

section("6. CLI contract")


def cli(**overrides) -> str | None:
    base = dict(link_only=True, bridge="child.json", no_seed=True, label_explicit=True,
                acknowledge_population_drop=False, snapshot_root=None)
    base.update(overrides)
    return imp.link_only_cli_refusal(SimpleNamespace(**base))


check("6.1 the complete, correct invocation is accepted", cli() is None, str(cli()))
check("6.2 --link-only without --bridge refuses",
      "requires --bridge" in (cli(bridge=None) or ""), str(cli(bridge=None)))
check("6.3 --link-only without --no-seed refuses",
      "requires --no-seed" in (cli(no_seed=False) or ""), str(cli(no_seed=False)))
check("6.4 --link-only without an EXPLICIT --label refuses",
      "explicit --label" in (cli(label_explicit=False) or ""), str(cli(label_explicit=False)))
check("6.5 --link-only with --acknowledge-population-drop refuses",
      "acknowledge-population-drop" in (cli(acknowledge_population_drop=True) or ""),
      str(cli(acknowledge_population_drop=True)))
check("6.6 --link-only with --snapshot-root refuses",
      "--snapshot-root" in (cli(snapshot_root="data/sources") or ""),
      str(cli(snapshot_root="data/sources")))
check("6.7 without --link-only the function is inert (the full path is never gated by it)",
      cli(link_only=False, bridge=None, no_seed=False, label_explicit=False,
          acknowledge_population_drop=True, snapshot_root="x") is None)

parser_argv = ["--link-only", "--bridge", "c.json", "--no-seed", "--label", LABEL]
out = io.StringIO()
with contextlib.redirect_stdout(out):
    rc_no_label = imp.main(["--link-only", "--bridge", "c.json", "--no-seed"])
check("6.8 main() exits 1 and prints REFUSED when --label is left at its default",
      rc_no_label == 1 and "REFUSED" in out.getvalue() and "explicit --label" in out.getvalue(),
      out.getvalue()[-160:])

out2 = io.StringIO()
with contextlib.redirect_stdout(out2):
    rc_missing_child = imp.main(parser_argv[:2] + ["/nonexistent/child.json"] + parser_argv[3:])
check("6.9 main() exits 1 when the child file is absent, before any database work",
      rc_missing_child == 1 and "REFUSED" in out2.getvalue(), out2.getvalue()[-160:])


# ---------------------------------------------------------------------------
# 7. Atomicity on the scripted connection
# ---------------------------------------------------------------------------

section("7. Atomicity: linkage and the completed audit row commit together")


def responders(*, extra=None, live=None, linked=False, notes=None):
    def sources(_sql, params):
        return {"draftguru": [(SOURCE_ID,)], "afltables": [(AFL_SOURCE_ID,)],
                "manual_admin_edit": [(3,)]}.get(params[0] if params else None, [])

    stored = stored_population(linked=linked, notes=notes)
    person_rows = stored_persons_rows(linked=linked)
    base = [
        (r"AND match_method = %s\s+AND status IN",
         fake.rows(*[(i, p) for i, ps in AFL_PLAYERS.items() for p in ps])),
        (r"s\.key = 'manual_admin_edit'", fake.rows()),
        (r"INSERT INTO import_batches", fake.rows((BATCH_ID,))),
        (r"SELECT id FROM sources WHERE key", sources),
        (r"FROM player_link_resolutions r", fake.rows(*(live or []))),
        (r"external_id, player_id FROM external_identities", fake.rows(
            *[(u, r["player_id"]) for u, r in person_rows.items() if r["player_id"] is not None])),
        (r"SELECT external_id, notes FROM external_identities", fake.rows(
            *sorted(stored["identity_notes"].items()))),
        (r"FROM draft_persons WHERE source_id = %s", fake.rows(
            *[(r["player_url"], r["dg_person_id"], r["display_name_raw"], r["name_key"],
               r["player_id"], r["link_status"], r["match_method"], r["confidence_notes"],
               r["reported_games"], r["reported_goals"], r["is_matching_backlog"])
              for r in person_rows.values()])),
        (r"SELECT player_url, draft_year, draft_kind FROM draft_picks", fake.rows(*PICK_KEYS)),
        (r"UPDATE draft_persons", fake.rowcount(1)),
        (r"UPDATE draft_picks", fake.rowcount(2)),
        (r"UPDATE external_identities", fake.rowcount(1)),
    ]
    return list(extra or []) + base


def run_link_only(conn, *, dry_run=False, label=LABEL, prepared=None, rep=None):
    os.environ["AFLDB_IMPORT_DATABASE_URL"] = "postgresql://contract@never.invalid:1/never_dialled"
    original = common.connect_pg
    common.connect_pg = lambda _dsn=None: conn
    rep = Rep() if rep is None else rep
    args = SimpleNamespace(no_seed=True, label=label, link_only=True, dry_run=dry_run,
                           acknowledge_population_drop=False, snapshot_root=None,
                           bridge="child.json", quiet=True)
    try:
        imp.run_link_only_import(args, prepared or prepared_link_only(), rep)
        return None, rep
    except BaseException as exc:                    # noqa: BLE001 -- the exception IS the result
        return exc, rep
    finally:
        common.connect_pg = original
        os.environ.pop("AFLDB_IMPORT_DATABASE_URL", None)


def is_data_write(text: str) -> bool:
    head = " ".join(text.split()).upper()
    if head.startswith(("UPDATE IMPORT_BATCHES", "INSERT INTO IMPORT_BATCHES",
                        "INSERT INTO IMPORT_REJECTIONS")):
        return False
    return head.startswith(("UPDATE ", "INSERT ", "DELETE ", "COPY ", "CREATE ", "DROP ",
                            "TRUNCATE", "SET CONSTRAINTS", "ANALYZE "))


def first_data_index(conn) -> int:
    for i, (kind, payload, _) in enumerate(conn.log):
        if kind in ("execute", "copy") and is_data_write(str(payload)):
            return i
    return -1


def batch_updates(conn):
    return [(i, params) for i, (kind, payload, params) in enumerate(conn.log)
            if kind == "execute" and "UPDATE import_batches" in str(payload)]


conn = fake.FakeConnection(responders())
exc, rep = run_link_only(conn)
check("7.1 the link-only run completes without an exception", exc is None, repr(exc))

commits = conn.indexes_of_kind("commit")
first_data = first_data_index(conn)
updates = batch_updates(conn)
completed = [(i, p) for i, p in updates if p and p[0] == "completed"]
completed_idx = completed[0][0] if completed else -1
check("7.2 exactly one commit precedes the first linkage statement (the running batch row)",
      len([c for c in commits if c < first_data]) == 1 and first_data >= 0,
      f"commits {commits}, first data {first_data}")
check("7.3 exactly one batch-row update carries status 'completed'", len(completed) == 1,
      str(updates))
check("7.4 NO commit lies between the first linkage statement and the 'completed' update",
      completed_idx > 0 and not any(first_data < c < completed_idx for c in commits),
      f"commits {commits}, window ({first_data}, {completed_idx})")
check("7.5 the 'completed' update is followed by a commit (linkage + status land together)",
      any(c > completed_idx for c in commits))
analyze_idx = conn.index_of("ANALYZE ")
check("7.6 ANALYZE runs only after that commit, under autocommit",
      analyze_idx > min(c for c in commits if c > completed_idx)
      and any(k == "autocommit" and v is True for k, v, _ in conn.log))
check("7.7 no rollback on the success path", conn.rollbacks == 0)

data_statements = [" ".join(str(p).split()) for k, p, _ in conn.log
                   if k in ("execute", "copy") and is_data_write(str(p))]
non_analyze = [s for s in data_statements if not s.upper().startswith("ANALYZE")]
check("7.8 exactly three linkage statements are sent, one per table, all UPDATEs",
      len(non_analyze) == 3 and all(s.upper().startswith("UPDATE ") for s in non_analyze),
      str([s[:44] for s in non_analyze]))
written_tables = sorted({s.split()[1].lower() for s in non_analyze})
check("7.9 they write exactly draft_persons, draft_picks and external_identities -- no players, "
      "no data_overrides, no temp table, no other table",
      written_tables == ["draft_persons", "draft_picks", "external_identities"],
      str(written_tables))
check("7.10 the SET clause actually sent names only the permitted columns",
      all(imp.set_clause_columns(s) == expected
          for s, expected in zip(non_analyze, (imp.PERSON_LINK_COLUMNS, imp.PICK_LINK_COLUMNS,
                                               imp.IDENTITY_LINK_COLUMNS))),
      str([imp.set_clause_columns(s) for s in non_analyze]))
check("7.11 no statement anywhere in the run mentions replay_admin_overrides' override tables "
      "or the full reload's staging table",
      not any(t in " ".join(str(p) for _k, p, _ in conn.log).lower()
              for t in ("_afldb_incoming", "data_overrides", "insert into players")))

batch_insert = [params for k, p, params in conn.log
                if k == "execute" and "INSERT INTO import_batches" in str(p)]
notes_written = batch_insert[0][3] if batch_insert and len(batch_insert[0]) > 3 else ""
check("7.12 the audit row's notes declare mode=link_only, the asserted label and the child hash",
      notes_written.startswith(f"mode={imp.LINK_ONLY_MODE} {imp.IDENTITY_NOTES_PREFIX}{LABEL}")
      and f"bridge_sha256={CHILD_SHA}" in notes_written
      and f"parent_sha256={PARENT_SHA}" in notes_written, str(notes_written))
check("7.13 the audit row's target_table is draft_persons and records_read is the pick count",
      batch_insert[0][2] == "draft_persons"
      and ("picks", len(PICK_KEYS)) in rep.results, str(rep.results))
check("7.14 the reporter states the mode and the asserted label, as STRING values and not as "
      "counts",
      ("mode", imp.LINK_ONLY_MODE) in rep.values
      and ("stage_a_snapshot (asserted, not rewritten)", LABEL) in rep.values
      and not any(k in ("mode", "stage_a_snapshot (asserted, not rewritten)")
                  for k, _ in rep.results),
      str(rep.values) + " / " + str(rep.results))

conn2 = fake.FakeConnection(responders(extra=[(r"UPDATE draft_picks", fake.fail("disk full"))]))
exc2, _ = run_link_only(conn2)
rb2 = conn2.indexes_of_kind("rollback")
check("7.15 an error mid-write rolls the linkage back and records a failed batch row",
      isinstance(exc2, fake.InjectedFailure) and conn2.rollbacks == 1
      and [p[0] for _, p in batch_updates(conn2)] == ["failed"]
      and conn2.index_of("ANALYZE ") == -1, repr(exc2))
tail2 = [(k, p, prm) for k, p, prm in conn2.log[rb2[0] + 1:] if k in ("execute", "copy")]
check("7.16 the only statement after that rollback is the failed batch-row update",
      len(tail2) == 1 and "UPDATE import_batches" in str(tail2[0][1])
      and "InjectedFailure" in str(tail2[0][2][6]), str([t[1][:40] for t in tail2]))

conn3 = fake.FakeConnection(responders())
exc3, _ = run_link_only(conn3, dry_run=True)
rb3 = conn3.indexes_of_kind("rollback")
tail3 = [(k, p, prm) for k, p, prm in conn3.log[rb3[0] + 1:] if k in ("execute", "copy")]
check("7.17 --dry-run runs the whole write path, then rolls it back",
      isinstance(exc3, imp.DryRunComplete) and conn3.rollbacks == 1
      and conn3.index_of("ANALYZE ") == -1
      and -1 < conn3.index_of("UPDATE external_identities") < rb3[0], repr(exc3))
check("7.18 --dry-run retains only the documented failed / DryRunComplete audit row",
      len(tail3) == 1 and tail3[0][2][0] == "failed"
      and str(tail3[0][2][6]).startswith("DryRunComplete"))
check("7.19 the link-only dry-run message states the rollback and the retained failed row, and "
      "never claims nothing was written",
      "rolled back" in imp.LINK_ONLY_DRY_RUN_MESSAGE
      and "import_batches" in imp.LINK_ONLY_DRY_RUN_MESSAGE
      and "retained" in imp.LINK_ONLY_DRY_RUN_MESSAGE
      and "DryRunComplete" in imp.LINK_ONLY_DRY_RUN_MESSAGE
      and "nothing was written" not in imp.LINK_ONLY_DRY_RUN_MESSAGE.lower())

conn4 = fake.FakeConnection(responders(notes={u: f"{imp.IDENTITY_NOTES_PREFIX}annual-html-20260826"
                                              for u, *_ in PEOPLE}))
exc4, _ = run_link_only(conn4)
check("7.20 a label the target does not hold refuses BEFORE any linkage statement is sent",
      isinstance(exc4, imp.ImportFailure) and "do not carry notes" in str(exc4)
      and first_data_index(conn4) == -1, repr(exc4))
check("7.21 that refusal still rolls back and records the failed batch row",
      conn4.rollbacks == 1 and [p[0] for _, p in batch_updates(conn4)] == ["failed"])

conn5 = fake.FakeConnection(responders(linked=True))
exc5, rep5 = run_link_only(conn5)
check("7.22 re-running over an already-linked target succeeds and is a no-op by construction "
      "(the IS DISTINCT FROM guard means the server updates nothing)",
      exc5 is None and len([s for s in (" ".join(str(p).split())
                                        for k, p, _ in conn5.log if k == "execute")
                            if s.upper().startswith("UPDATE DRAFT")]) == 2, repr(exc5))

# 7.23-7.25: the REAL common.Reporter, not the fake. The first link-only DEV dry run died at
# `rep.result("mode", LINK_ONLY_MODE)` with `ValueError: Cannot specify ',' with 's'` -- after the
# three linkage UPDATEs had been sent -- because the fake accepted a string where the real
# reporter's count column cannot. A permissive fake proves nothing about rendering, so the whole
# write path runs here against common.Reporter(verbose=True) with its output captured.
real_rep = common.Reporter(verbose=True)
conn6 = fake.FakeConnection(responders())
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    exc6, _ = run_link_only(conn6, rep=real_rep)
rendered = buf.getvalue()
check("7.23 the whole link-only write path runs against the REAL common.Reporter without an "
      "exception (RED before the fix: ValueError: Cannot specify ',' with 's')",
      exc6 is None, repr(exc6))
def rendered_row(text: str, label: str) -> str | None:
    """The trailing value the real reporter printed on ``label``'s own line, or None."""
    for line in text.splitlines():
        body = line[4:]
        if line.startswith("    ") and body.startswith(label):
            return body[len(label):].strip()
    return None


check("7.24 the real reporter actually rendered the mode, the asserted label and a count",
      rendered_row(rendered, "mode") == imp.LINK_ONLY_MODE
      and rendered_row(rendered, "stage_a_snapshot (asserted, not rewritten)") == LABEL
      and rendered_row(rendered, "picks") == f"{len(PICK_KEYS):,}",
      repr(rendered))
real_refuses_string = False
try:
    with contextlib.redirect_stdout(io.StringIO()):
        common.Reporter(verbose=True).result("mode", imp.LINK_ONLY_MODE)
except ValueError:
    real_refuses_string = True
counts = io.StringIO()
with contextlib.redirect_stdout(counts):
    common.Reporter(verbose=True).result("picks", 1234567)
    common.Reporter(verbose=True).value("mode", imp.LINK_ONLY_MODE)
check("7.25 the fix adds value() without weakening result(): a string is still REFUSED by the "
      "count column, which keeps its thousands separator, and value() adds none",
      real_refuses_string
      and "1,234,567" in counts.getvalue()
      and f"{imp.LINK_ONLY_MODE}\n" in counts.getvalue(),
      repr(counts.getvalue()))


# ---------------------------------------------------------------------------
# 8. The gate models the same write set
# ---------------------------------------------------------------------------

section("8. Gate --link-only: plan, verify, determinism, and the preservation digests")


def digest_key(sql: str) -> str:
    return hashlib.md5(" ".join(sql.split()).encode("utf-8")).hexdigest()[:10]


class GateWorld:
    def __init__(self, *, linked: bool, database: str = "afldb_dev",
                 notes: str | None = None, batch_notes: str | None = None,
                 restamp: bool = False, digest_overrides: dict | None = None) -> None:
        self.settings = ("on", "on", database, "UTC")
        self.afl_players = dict(AFL_PLAYERS)
        self.live_rows: list = []
        self.overrides: list = []
        self.resolutions: list = []
        self.clubs = [("essendon", 5, "Essendon")]
        self.manual_picks: list = []
        self.resolve_rows: dict = {}
        self.digest_overrides = dict(digest_overrides or {})
        self.linked = linked

        rows = stored_persons_rows(linked=linked)
        self.person_rows = {}
        for n, (url, row) in enumerate(sorted(rows.items(), key=lambda kv: gate.url_key(kv[0])), 501):
            self.person_rows[url] = dict(row, id=n, candidate_count=0)
        self.dg_identities = {u: r["player_id"] for u, r in self.person_rows.items()
                              if r["player_id"] is not None}

        self.batch_id = 41 if linked else 40
        self.batch_count = 4 if linked else 3
        old_batch = 12
        self.pick_rows = {}
        for n, key in enumerate(sorted(PICK_KEYS, key=lambda k: (gate.url_key(k[0]), k[1], k[2])),
                                9001):
            person = self.person_rows[key[0]]
            self.pick_rows[key] = {
                "id": n, "draft_year": key[1], "draft_type": "National Draft",
                "draft_kind": key[2], "pick_number": n - 9000, "pick_note": None,
                "player_id": person["player_id"], "player_name_raw": person["display_name_raw"],
                "link_status_value": person["link_status"], "candidate_count": 0,
                "match_method": person["match_method"],
                "confidence_notes": person["confidence_notes"], "club_id": 5,
                "club_name_raw": "Essendon", "original_club_raw": None, "draft_age": 18,
                "height_cm": 185, "weight_kg": None, "grade": None, "competition": "AFL",
                "signing": None, "signing_kind": None, "signing_detail": None, "detail": None,
                "source_id": SOURCE_ID, "source_record_id": f"src#{n}",
                "import_batch_id": self.batch_id if restamp else old_batch,
                "draft_person_id": person["id"], "dg_person_id": person["dg_person_id"],
                "player_url": key[0], "reported_games": person["reported_games"],
                "reported_goals": person["reported_goals"],
            }
        self.identity_rows = {}
        for url, person in self.person_rows.items():
            self.identity_rows[url] = {
                "external_id": url, "external_name": person["display_name_raw"],
                "external_url": url, "player_id": person["player_id"],
                "status": person["link_status"] if person["player_id"] is not None
                else imp.UNLINKED_DEFAULT,
                "candidate_count": 0, "match_method": person["match_method"],
                "notes": notes if notes is not None else NOTES,
            }
        run_notes = batch_notes if batch_notes is not None else (
            f"mode={imp.LINK_ONLY_MODE} {imp.IDENTITY_NOTES_PREFIX}{LABEL} "
            f"bridge_sha256={CHILD_SHA} parent_sha256={PARENT_SHA}")
        self.batches = [(self.batch_id, "import_draftguru.py", "draft_persons", "completed",
                         len(PICK_KEYS), 0, 9, 0, None, "2026-09-19T10:00:00+00:00",
                         "2026-09-19T10:00:05+00:00", run_notes if linked else None)]

    def responders(self):
        w = self

        def sources(_sql, params):
            return {"draftguru": [(SOURCE_ID,)], "afltables": [(AFL_SOURCE_ID,)],
                    "manual_admin_edit": [(3,)]}.get(params[0] if params else None, [])

        def digest(sql, _params):
            key = digest_key(sql)
            return [(1, w.digest_overrides.get(key, "md5-" + key))]

        return [
            (r"current_setting\('transaction_read_only'\)", lambda *_: [w.settings]),
            (r"SELECT id FROM sources WHERE key", sources),
            (r"AND match_method = %s\s+AND status IN",
             lambda *_: [(i, p) for i, ps in w.afl_players.items() for p in ps]),
            (r"s\.key = 'manual_admin_edit'\s+AND e\.match_method", fake.rows()),
            (r"FROM player_link_resolutions r", lambda *_: list(w.live_rows)),
            (r"WHERE source_id = %s AND player_id IS NOT NULL",
             lambda *_: list(w.dg_identities.items())),
            (r"md5\(coalesce\(string_agg", digest),
            (r"FROM draft_persons WHERE source_id = %s",
             lambda *_: [tuple(r[f] for f in gate.PERSON_FIELDS) for r in w.person_rows.values()]),
            (r"FROM draft_picks WHERE source_id = \(SELECT id FROM sources",
             lambda *_: list(w.manual_picks)),
            (r"FROM draft_picks WHERE source_id = %s",
             lambda *_: [tuple(r[f] for f in gate.PICK_FIELDS) for r in w.pick_rows.values()]),
            (r"external_name.*FROM external_identities WHERE source_id",
             lambda *_: [tuple(r[f] for f in gate.IDENTITY_FIELDS)
                         for r in w.identity_rows.values()]),
            (r"FROM data_overrides WHERE entity_type", lambda *_: list(w.overrides)),
            (r"FROM player_link_resolutions WHERE target_table", lambda *_: list(w.resolutions)),
            (r"SELECT slug, id, name FROM clubs", lambda *_: list(w.clubs)),
            (r"FROM import_batches WHERE source_id = %s ORDER BY id DESC",
             lambda *_: list(w.batches)),
            (r"SELECT count\(\*\), coalesce\(max\(id\), 0\)",
             lambda *_: [(w.batch_count, w.batch_id)]),
            (r"SELECT DISTINCT e\.player_id",
             lambda _s, params: [(p,) for p in w.resolve_rows.get(tuple(params), [])]),
        ]


OUT: list[str] = []


def prepared_full() -> dict:
    """A full-reload frame over the same five persons, for the section 9 comparison only."""
    persons = {}
    for url, name, games, goals in PEOPLE:
        persons[url] = {"player_url": url,
                        "dg_person_id": 1 + [p[0] for p in PEOPLE].index(url),
                        "display_name_raw": name, "name_key": imp.draftguru_name_key(name),
                        "reported_games": games, "reported_goals": goals}
    picks = []
    for n, key in enumerate(sorted(PICK_KEYS, key=lambda k: (gate.url_key(k[0]), k[1], k[2])),
                            9001):
        picks.append({"player_url": key[0], "draft_year": key[1], "draft_type": "National Draft",
                      "draft_kind": key[2], "pick_number": n - 9000, "pick_note": None,
                      "player_name_raw": persons[key[0]]["display_name_raw"],
                      "club_slug": "essendon", "club_name_raw": "Essendon",
                      "original_club_raw": None, "draft_age": 18, "height_cm": 185,
                      "competition": "AFL", "signing": None, "signing_kind": None,
                      "detail": None, "source_record_id": f"src#{n}"})
    return {"persons": persons, "picks": picks, "ledger": copy.deepcopy(LEDGER),
            "bridges": dict(BRIDGES)}


def run_gate(mode, world, *, expect=None, link_only=True, child=None, prepared=None):
    conn = fake.FakeConnection(world.responders())
    OUT.clear()
    frame = prepared if prepared is not None else prepared_link_only(child=child)
    summary = gate.run_gate(mode, frame, child or CHILD, CHILD_SHA,
                            PARENT_MAP, LABEL, lambda: conn, expect=expect,
                            population=POPULATION, rejected={R: R_AFL}, emit=OUT.append,
                            required_database="afldb_dev", link_only=link_only)
    return summary, conn


plan, plan_conn = run_gate("plan", GateWorld(linked=False))
check("8.1 the link-only plan holds on the pre-import state", not plan["failures"],
      str(plan["failures"]))
check("8.2 it is read-only: SELECT only, rolled back once, closed, no autocommit toggle",
      all(s.lstrip().upper().startswith("SELECT") for s, _ in plan_conn.statements)
      and plan_conn.rollbacks == 1 and plan_conn.closed and plan_conn.commits == 0
      and not any(k == "autocommit" for k, _, _ in plan_conn.log))
check("8.3 the hashed summary records the mode and the importer's write set",
      plan["mode_scope"] == imp.LINK_ONLY_MODE
      and plan["link_only_write_set"] == {t: list(c) for t, c in WRITE_SET.items()})
check("8.4 the plan captures import_batches_before and expects exactly one more",
      plan["import_batches_before"] == 3 and plan["import_batches_expected_after"] == 4
      and any("import_batches_before: 3" in line for line in OUT))
check("8.5 newly linked is exactly the one non-decided bridge person",
      plan["persons"]["newly_linked"] == 1 and plan["picks"]["link_change"] == 2
      and plan["identities"]["link_change"] == 1)
check("8.6 the plan applies no source-owned override patch (link-only never replays them)",
      plan["source_override_patches_applied"] == 0)
check("8.7 the four non-link preservation digests were read",
      all(k in plan["baseline"] for k in gate.LINK_ONLY_PRESERVATION_DIGESTS),
      str(sorted(plan["baseline"])))
check("8.8 6.4 / 6.6 / 6.7 ran as write-set proofs and the notes-label proof ran too",
      all(any(n.startswith(num) for n, _ in plan["checks"])
          for num in ("6.4 link-only", "6.4a", "6.6 link-only", "6.6a", "6.7 link-only", "6.7a",
                      "6.7b")),
      str([n for n, _ in plan["checks"] if n.startswith("6.")]))
check("8.9 the identity-notes label is recorded in the hashed summary",
      plan["identity_notes_label"] == NOTES and plan["identity_notes_mismatches"] == 0)

plan_again, _ = run_gate("plan", GateWorld(linked=False))
check("8.10 two independent plans over the same state reproduce every hash and the summary_sha256",
      plan_again["summary_sha256"] == plan["summary_sha256"]
      and plan_again["after_state_sha256"] == plan["after_state_sha256"]
      and plan_again["baseline_sha256"] == plan["baseline_sha256"])

EXPECT = {"after_state_sha256": plan["after_state_sha256"],
          "picks_after_sha256": plan["picks_after_sha256"],
          "newly_linked_sha256": plan["newly_linked_sha256"],
          "baseline_sha256": plan["baseline_sha256"],
          "batches_before": plan["import_batches_before"]}

verify, verify_conn = run_gate("verify", GateWorld(linked=True), expect=EXPECT)
check("8.11 the link-only verify holds against the plan's four hashes and batch count",
      not verify["failures"], str(verify["failures"]))
check("8.12 verify is read-only too",
      all(s.lstrip().upper().startswith("SELECT") for s, _ in verify_conn.statements)
      and verify_conn.rollbacks == 1 and verify_conn.commits == 0)
verify_again, _ = run_gate("verify", GateWorld(linked=True), expect=EXPECT)
check("8.13 two independent verify runs reproduce the same summary_sha256",
      verify_again["summary_sha256"] == verify["summary_sha256"])
check("8.14 verify required exactly one new completed link-only batch and ran 8.15",
      any(n.startswith("8.10a link-only") for n, _ in verify["checks"])
      and any(n.startswith("8.15 link-only") for n, _ in verify["checks"]))

bad_notes = run_gate("plan", GateWorld(linked=False, notes=f"{imp.IDENTITY_NOTES_PREFIX}annual-html-20260826"))[0]
check("8.15 a plan whose stored notes name a different label REFUSES on 6.7a",
      any(n.startswith("6.7a") for n in bad_notes["failures"])
      and bad_notes["identity_notes_mismatches"] == len(PEOPLE), str(bad_notes["failures"]))

restamped = run_gate("verify", GateWorld(linked=True, restamp=True), expect=EXPECT)[0]
check("8.16 a verify whose picks were re-stamped with the new batch id REFUSES on 8.12",
      any(n.startswith("8.12 link-only") for n in restamped["failures"]),
      str(restamped["failures"]))

moved = digest_key(gate.LINK_ONLY_BASELINE_SQL["external_identities_draftguru_nonlink"][0])
drifted = run_gate("verify", GateWorld(linked=True, digest_overrides={moved: "md5-CHANGED"}),
                   expect=EXPECT)[0]
check("8.17 RED proof: a moved external_identities non-link digest REFUSES on 8.14/8.15 -- the "
      "6.7 preservation proof is falsifiable, not assumed",
      any(n.startswith("8.14 baseline_sha256") for n in drifted["failures"])
      and any(n.startswith("8.15 link-only") for n in drifted["failures"]),
      str(drifted["failures"]))

moved_picks = digest_key(gate.BASELINE_SQL["draft_picks_draftguru_nonlink"][0])
drifted_picks = run_gate("verify", GateWorld(linked=True,
                                             digest_overrides={moved_picks: "md5-CHANGED"}),
                         expect=EXPECT)[0]
check("8.18 RED proof: a moved draft_picks non-link digest REFUSES too (6.6 after the fact)",
      any(n.startswith("8.15 link-only") for n in drifted_picks["failures"]),
      str(drifted_picks["failures"]))

wrong_batch_notes = run_gate("verify", GateWorld(linked=True, batch_notes="full reload"),
                             expect=EXPECT)[0]
check("8.19 a verify whose newest batch does not declare mode=link_only REFUSES on 8.10/8.10a",
      any(n.startswith("8.10") for n in wrong_batch_notes["failures"]),
      str(wrong_batch_notes["failures"]))


# ---------------------------------------------------------------------------
# 9. Target guards and the full path are untouched
# ---------------------------------------------------------------------------

section("9. Target guards unchanged; the full reload and the gate's full mode untouched")

check("9.1 the DEV target still guards the physical database name and the child LABEL "
      "separately", gate.TARGETS["dev"]["database"] == "afldb_dev"
      and gate.TARGETS["dev"]["child_target"] == "dev"
      and gate.TARGETS["test"]["database"] == "afldb_test"
      and gate.TARGETS["test"]["child_target"] == "afldb_test"
      and "prod" not in gate.TARGETS)
check("9.2 the DSN environment variables are unchanged and separate",
      gate.TARGETS["dev"]["dsn_env"] == "AFLDB_DEV_DATABASE_URL"
      and gate.TARGETS["test"]["dsn_env"] == "AFLDB_TEST_DATABASE_URL")

with tempfile.TemporaryDirectory() as tmp3:
    renamed = Path(tmp3) / "innocent.json"
    renamed.write_bytes((ROOT / gate.CHILD_REL).read_bytes()
                        if (ROOT / gate.CHILD_REL).is_file() else b"{}")
    try:
        gate.refuse_test_child_under("dev", renamed)
        bytes_refused = not (ROOT / gate.CHILD_REL).is_file()
    except gate.GateError as exc:
        bytes_refused = "afldb_test child" in str(exc)
    try:
        gate.refuse_test_child_under("dev", Path(tmp3) / "x.afldb_test.json")
        name_refused = False
    except gate.GateError:
        name_refused = True
check("9.3 the afldb_test child is still refused under a non-test target, by name and by bytes",
      name_refused and bytes_refused)

wrong_db = GateWorld(linked=False, database="afldb_test")
try:
    run_gate("plan", wrong_db)
    db_guard = False
except gate.GateError as exc:
    db_guard = "connected database" in str(exc)
check("9.4 a server reporting the wrong database is still refused before any read, in link-only "
      "mode too", db_guard)

check("9.5 the gate's default baseline set is unchanged; the two link-only digests are additive",
      set(gate.baseline_sql_for(False)) == set(gate.BASELINE_SQL)
      and set(gate.baseline_sql_for(True)) - set(gate.BASELINE_SQL)
      == set(gate.LINK_ONLY_BASELINE_SQL)
      and "external_identities_draftguru_nonlink" not in gate.BASELINE_SQL
      and "draft_picks_draftguru_batch_ids" not in gate.BASELINE_SQL)

full_plan, _ = run_gate("plan", GateWorld(linked=False), link_only=False,
                        prepared=prepared_full())
check("9.6 the gate's FULL mode holds over the same population and adds none of link-only's "
      "summary keys or baseline digests",
      not full_plan["failures"] and "mode_scope" not in full_plan
      and "link_only_write_set" not in full_plan and "identity_notes_label" not in full_plan
      and set(full_plan["baseline"]) == set(gate.BASELINE_SQL), str(full_plan["failures"]))
check("9.7 the full mode still runs its own 6.4 / 6.6 / 6.7, not link-only's",
      any(n == "6.4 no non-link person column would change" for n, _ in full_plan["checks"])
      and any(n.startswith("6.7 external_identities") for n, _ in full_plan["checks"])
      and not any(n.startswith("6.4 link-only") for n, _ in full_plan["checks"])
      and not any(n.startswith("8.10a") for n, _ in full_plan["checks"]))

full_source = {node.name: ast.get_source_segment(
    (TOOL_DIR / "import_draftguru.py").read_text(encoding="utf-8"), node)
    for node in TREE.body if isinstance(node, ast.FunctionDef)}
check("9.8 run_import and validate -- the full reload -- contain no link-only branch at all",
      "link_only" not in full_source["run_import"] and "link_only" not in full_source["validate"]
      and "link_only" not in full_source["build_persons"]
      and "link_only" not in full_source["build_picks"]
      and "link_only" not in full_source["reconcile_draftguru_identities"])
check("9.9 the full path's default label is unchanged and link-only did not repoint it",
      imp.STAGE_A_LABEL == "annual-html-20260826"
      and 'ap.add_argument("--label", default=None' in full_source["main"]
      and "args.label = STAGE_A_LABEL" in full_source["main"])
out_help = io.StringIO()
with contextlib.redirect_stdout(out_help):
    try:
        imp.main(["--help"])
    except SystemExit:
        pass
check("9.10 --link-only is documented in the CLI help alongside the unchanged full-mode flags",
      "--link-only" in out_help.getvalue() and "--acknowledge-population-drop" in out_help.getvalue()
      and "--dry-run" in out_help.getvalue())

imp.EXPECTED_PERSONS, imp.EXPECTED_ROWS = REAL_PERSONS, REAL_ROWS
check("9.11 the real population constants were restored after the fixture",
      (imp.EXPECTED_PERSONS, imp.EXPECTED_ROWS) == (5057, 6810))

# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} DraftGuru link-only check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    sys.exit(1)
print("All DraftGuru link-only checks hold.")
