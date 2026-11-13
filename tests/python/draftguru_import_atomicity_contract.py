#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- DB-free contract for the DraftGuru importer's transaction order.

    python tests/python/draftguru_import_atomicity_contract.py

Drives ``import_draftguru.run_import()`` end to end against the scripted connection in
``draftguru_fake_pg.py`` (``common.connect_pg`` is replaced for the duration; the DSN
environment variable is a placeholder that is never dialled). A three-person, three-pick
``prepared`` frame stands in for the accepted snapshot, so no snapshot bytes are needed.

What it proves:

  1. success path -- exactly one commit precedes the first data statement (the ``running``
     batch row) and NO commit occurs between the first data statement and the
     ``UPDATE import_batches ... 'completed'`` row; the data and the completed status share
     one commit; ``ANALYZE`` runs only after that commit, under autocommit;
  2. a server error mid-write -- one rollback, the only statement after it is the ``failed``
     batch-row update carrying the error, no ``ANALYZE``;
  3. ``--dry-run`` -- the same rollback path, error ``DryRunComplete``;
  4. a bridge/human contradiction -- refused before any data statement is sent;
  5. the reload scope -- every UPDATE/INSERT/DELETE against ``draft_persons`` /
     ``draft_picks`` carries the DraftGuru ``source_id`` scope, and no other table is written;
  6. AFLDB-ISSUE-348, the reload guard (section 6) -- before ``apply_authority`` and before the
     ``import_batches`` row, SELECTs only: a reload that would delete an audited pick (the
     D-336-2 shape), renumber an audited person, rewrite an audited pick or change
     ``original_club_raw`` is refused, ``--dry-run`` included, with nothing written; only a
     reviewed reconciliation naming the exact keys and digest lets it through, REPLACE_CLUB rows
     need an explicit owner ruling, and ``--acknowledge-population-drop`` changes nothing.

No database connection, no network request, no Git command.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(ROOT / "tools" / "migration"))
sys.path.insert(0, str(HERE))

import draftguru_fake_pg as fake                    # noqa: E402
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


class Rep:
    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.results: list[tuple[str, object]] = []

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def result(self, label: str, value: object) -> None:
        if not isinstance(value, int):               # common.Reporter.result() is the numeric column
            raise ValueError("Cannot specify ',' with 's'.")
        self.results.append((label, value))

    def value(self, label: str, value: object, detail: str = "") -> None:
        # common.Reporter.value(): the STRING column (result() is numeric and rejects a string).
        # A model that accepted a string in result() hid exactly that defect in the guard's first
        # draft, which only a real Reporter run on a real database exposed.
        self.results.append((label, value))


DG = "https://www.draftguru.com.au/players/"
URL_A = DG + "alpha_one/1"
URL_B = DG + "bravo_two/1"
URL_C = DG + "charlie_three/1"
AFL_A = "players/A/Alpha_One.html"
AFL_B = "players/B/Bravo_Two.html"

DRAFTGURU_SOURCE_ID = 1
AFLTABLES_SOURCE_ID = 2
BATCH_ID = 77


def prepared_frame(*, ledger: dict | None = None, bridges: dict | None = None) -> dict:
    persons = {}
    for rank, (url, name, games) in enumerate(
            [(URL_A, "Alpha One", 12), (URL_B, "Bravo Two", 0), (URL_C, "Charlie Three", 3)], 1):
        persons[url] = {
            "player_url": url, "dg_person_id": rank, "display_name_raw": name,
            "name_key": imp.draftguru_name_key(name),
            "reported_games": games, "reported_goals": 0,
        }
    picks = []
    for i, url in enumerate([URL_A, URL_B, URL_C], 1):
        picks.append({
            "player_url": url, "draft_year": 2000 + i, "draft_type": "National Draft",
            "draft_kind": "national", "pick_number": i, "pick_note": None,
            "player_name_raw": persons[url]["display_name_raw"], "club_slug": "essendon",
            "club_name_raw": "Essendon", "original_club_raw": None, "draft_age": 18,
            "height_cm": 185, "competition": "AFL", "signing": None, "signing_kind": None,
            "detail": None, "source_record_id": f"https://www.draftguru.com.au/drafts/{2000 + i}#{i}",
        })
    return {"persons": persons, "picks": picks,
            "ledger": dict(ledger or {}), "bridges": dict(bridges or {URL_A: AFL_A})}


def responders(*, extra: list | None = None) -> list:
    def sources(_sql, params):
        key = params[0] if params else None
        return {"draftguru": [(DRAFTGURU_SOURCE_ID,)], "afltables": [(AFLTABLES_SOURCE_ID,)],
                "manual_admin_edit": [(3,)]}.get(key, [])

    base = [
        (r"SELECT id FROM sources WHERE key", sources),
        (r"INSERT INTO import_batches", fake.rows((BATCH_ID,))),
        (r"SELECT slug, id FROM clubs", fake.rows(("essendon", 5))),
        (r"AND match_method = %s\s+AND status IN", fake.rows((AFL_A, 1001), (AFL_B, 1002))),
        (r"s\.key = 'manual_admin_edit'", fake.rows()),
        (r"FROM player_link_resolutions r", fake.rows()),
        (r"WHERE source_id = %s AND player_id IS NOT NULL", fake.rows()),
        (r"HAVING count\(\*\) > 1", fake.rows()),
        (r"IS NOT TRUE", fake.rows()),
        (r"SELECT player_url, id FROM draft_persons", fake.rows((URL_A, 501), (URL_B, 502), (URL_C, 503))),
        (r"SELECT external_id FROM external_identities WHERE source_id", fake.rows()),
        (r"FROM data_overrides o", fake.rows()),
    ]
    return list(extra or []) + base


def run(prepared: dict, conn: fake.FakeConnection, *, dry_run: bool = False):
    """Run the importer's write path on the fake connection; returns (exception, rep)."""
    os.environ["AFLDB_IMPORT_DATABASE_URL"] = "postgresql://contract@never.invalid:1/never_dialled"
    original = common.connect_pg
    common.connect_pg = lambda _dsn=None: conn
    rep = Rep()
    args = SimpleNamespace(no_seed=True, label="contract-label",
                           acknowledge_population_drop=False, dry_run=dry_run)
    try:
        imp.run_import(args, prepared, rep)
        return None, rep
    except BaseException as exc:            # noqa: BLE001 -- the exception IS the result
        return exc, rep
    finally:
        common.connect_pg = original
        os.environ.pop("AFLDB_IMPORT_DATABASE_URL", None)


DATA_TABLES = ("draft_persons", "draft_picks", "external_identities", "players",
               "_afldb_incoming")


def is_data_write(text: str) -> bool:
    head = " ".join(text.split()).upper()
    if head.startswith(("UPDATE IMPORT_BATCHES", "INSERT INTO IMPORT_BATCHES",
                        "INSERT INTO IMPORT_REJECTIONS")):
        return False
    return head.startswith(("UPDATE ", "INSERT ", "DELETE ", "COPY ", "CREATE TEMP",
                            "DROP TABLE", "SET CONSTRAINTS", "ANALYZE "))


def first_data_index(conn: fake.FakeConnection) -> int:
    for i, (kind, payload, _) in enumerate(conn.log):
        if kind in ("execute", "copy") and is_data_write(str(payload)):
            return i
    return -1


def batch_updates(conn: fake.FakeConnection) -> list[tuple[int, tuple]]:
    out = []
    for i, (kind, payload, params) in enumerate(conn.log):
        if kind == "execute" and "UPDATE import_batches" in str(payload):
            out.append((i, params))
    return out


# ---------------------------------------------------------------------------
# 1. Success path: two commits, data + completed status in the second
# ---------------------------------------------------------------------------

section("1. Success path -- the data commit and the completed status are one commit")

conn = fake.FakeConnection(responders())
exc, rep = run(prepared_frame(), conn)
check("1.1 the run completes without an exception", exc is None, repr(exc))

commits = conn.indexes_of_kind("commit")
first_data = first_data_index(conn)
updates = batch_updates(conn)
completed = [(i, p) for i, p in updates if p and p[0] == "completed"]
check("1.2 a data statement was actually sent", first_data >= 0)
check("1.3 exactly one commit precedes the first data statement (the running batch row)",
      len([c for c in commits if c < first_data]) == 1, f"commits {commits}, first data {first_data}")
check("1.4 exactly one batch-row update carries status 'completed'", len(completed) == 1,
      str(updates))
completed_idx = completed[0][0] if completed else -1
check("1.5 NO commit lies between the first data statement and the 'completed' update",
      completed_idx > 0 and not any(first_data < c < completed_idx for c in commits),
      f"commits {commits}, window ({first_data}, {completed_idx})")
after_completed = [c for c in commits if c > completed_idx]
check("1.6 the 'completed' update is followed by a commit (data + status land together)",
      bool(after_completed))
analyze_idx = conn.index_of("ANALYZE ")
check("1.7 ANALYZE is issued only after that commit",
      analyze_idx > (after_completed[0] if after_completed else 10**9), f"analyze at {analyze_idx}")
autocommit_on = [i for i, (k, v, _) in enumerate(conn.log) if k == "autocommit" and v is True]
check("1.8 ANALYZE runs under autocommit, switched on after the commit",
      bool(autocommit_on) and autocommit_on[0] < analyze_idx
      and autocommit_on[0] > (after_completed[0] if after_completed else 10**9))
check("1.9 no rollback on the success path", conn.rollbacks == 0)
check("1.10 no data statement is sent after the 'completed' update except ANALYZE",
      all(not is_data_write(str(p)) or str(p).lstrip().upper().startswith("ANALYZE")
          for k, p, _ in conn.log[completed_idx + 1:] if k in ("execute", "copy")))
check("1.11 the importer reports one bridge link and no HALT",
      ("authority: bridge", 1) in rep.results and not rep.warnings, str(rep.results))

# ---------------------------------------------------------------------------
# 2. Server error mid-write: rollback, failed batch row, nothing else
# ---------------------------------------------------------------------------

section("2. Server error during external_identities reconciliation -- rollback, then the failed row")

conn2 = fake.FakeConnection(responders(
    extra=[(r"INSERT INTO external_identities", fake.fail("disk full"))]))
exc2, _ = run(prepared_frame(), conn2)
check("2.1 the injected error propagates out of run_import", isinstance(exc2, fake.InjectedFailure),
      repr(exc2))
check("2.2 exactly one rollback", conn2.rollbacks == 1)
rb = conn2.indexes_of_kind("rollback")[0] if conn2.rollbacks else -1
first_data2 = first_data_index(conn2)
check("2.3 the rollback follows data statements (there was something to roll back)",
      0 <= first_data2 < rb)
check("2.4 no commit between the first data statement and the rollback",
      not any(first_data2 < c < rb for c in conn2.indexes_of_kind("commit")))
tail2 = [(k, p, prm) for k, p, prm in conn2.log[rb + 1:] if k in ("execute", "copy")]
check("2.5 the only statement after the rollback is the failed batch-row update",
      len(tail2) == 1 and "UPDATE import_batches" in str(tail2[0][1]), str([t[1][:40] for t in tail2]))
check("2.6 that update records status 'failed' and names the error",
      bool(tail2) and tail2[0][2][0] == "failed" and "InjectedFailure" in str(tail2[0][2][6]),
      str(tail2[0][2] if tail2 else None))
check("2.7 no ANALYZE after a failure", conn2.index_of("ANALYZE ") == -1)
check("2.8 exactly one commit after the rollback (the audit row), one before the data (the running row)",
      conn2.commits == 2 and len([c for c in conn2.indexes_of_kind("commit") if c > rb]) == 1)

# ---------------------------------------------------------------------------
# 3. --dry-run: same rollback path
# ---------------------------------------------------------------------------

section("3. --dry-run rolls everything back after the full write path")

conn3 = fake.FakeConnection(responders())
exc3, _ = run(prepared_frame(), conn3, dry_run=True)
check("3.1 DryRunComplete propagates (main() turns it into the DRY RUN message)",
      isinstance(exc3, imp.DryRunComplete), repr(exc3))
check("3.2 exactly one rollback and no ANALYZE", conn3.rollbacks == 1 and conn3.index_of("ANALYZE ") == -1)
rb3 = conn3.indexes_of_kind("rollback")[0]
check("3.3 the whole write path ran before the rollback (reconcile + replay were reached)",
      -1 < conn3.index_of("INSERT INTO external_identities") < rb3
      and -1 < conn3.index_of("FROM data_overrides o") < rb3)
tail3 = [(k, p, prm) for k, p, prm in conn3.log[rb3 + 1:] if k in ("execute", "copy")]
check("3.4 after the rollback only the failed batch row is written, error DryRunComplete",
      len(tail3) == 1 and tail3[0][2][0] == "failed" and str(tail3[0][2][6]).startswith("DryRunComplete"))
# The operator-facing message must say exactly what the log above shows: data rolled back AND a
# failed audit row retained. The old wording ("nothing was written") contradicted 3.4.
message = imp.DRY_RUN_MESSAGE
check("3.5 the dry-run message states that the data writes were rolled back",
      "rolled back" in message and "draft_persons" in message and "draft_picks" in message
      and "external_identities" in message)
check("3.6 the dry-run message states that a failed import_batches audit row is retained",
      "import_batches" in message and "retained" in message and "'failed'" in message
      and "DryRunComplete" in message and "nothing was written" not in message.lower())
check("3.7 the retained row's status and error are the ones the message names",
      bool(tail3) and tail3[0][2][0] == "failed" and f"'{tail3[0][2][6]}'" in message)

# ---------------------------------------------------------------------------
# 4. Bridge/human contradiction: refused before any data statement
# ---------------------------------------------------------------------------

section("4. A bridge that contradicts an explicit human decision is refused before any write")

ledger = {URL_A: {"player_url": URL_A, "decision": "confirmed_unlinked", "target": None}}
conn4 = fake.FakeConnection(responders())
exc4, _ = run(prepared_frame(ledger=ledger), conn4)
check("4.1 ImportFailure names the contradiction", isinstance(exc4, imp.ImportFailure)
      and "contradicts an explicit human decision" in str(exc4), repr(exc4))
check("4.2 no data statement was sent at all", first_data_index(conn4) == -1,
      str(conn4.events()))
check("4.3 one rollback, then only the failed batch row", conn4.rollbacks == 1
      and [p[0] for _, p in batch_updates(conn4)] == ["failed"])

# ---------------------------------------------------------------------------
# 5. Scope: every data write on the two tables is DraftGuru-scoped; no other table written
# ---------------------------------------------------------------------------

section("5. Reload scope")

written_tables: set[str] = set()
unscoped: list[str] = []
for kind, payload, params in conn.log:
    if kind not in ("execute", "copy"):
        continue
    text = " ".join(str(payload).split())
    upper = text.upper()
    for verb in ("UPDATE PUBLIC.", "INSERT INTO PUBLIC.", "DELETE FROM PUBLIC.",
                 "UPDATE ", "INSERT INTO ", "DELETE FROM ", "COPY "):
        if upper.startswith(verb):
            table = upper[len(verb):].split()[0].strip("(").lower()
            written_tables.add(table)
            break
    if upper.startswith(("UPDATE PUBLIC.DRAFT_", "INSERT INTO PUBLIC.DRAFT_", "DELETE FROM PUBLIC.DRAFT_")):
        if "SOURCE_ID = ANY" not in upper and "SOURCE_ID = %S" not in upper:
            unscoped.append(text[:90])
    if upper.startswith("DELETE FROM DRAFT_PERSONS") and "SOURCE_ID = %S" not in upper:
        unscoped.append(text[:90])

allowed = {"_afldb_incoming", "draft_persons", "draft_picks", "external_identities",
           "import_batches", "public.draft_persons", "public.draft_picks",
           "draft_picks d", "draft_persons p"}
extra_tables = {t for t in written_tables if t.rstrip(",") not in allowed
                and not t.startswith(("public.draft_", "draft_"))}
check("5.1 only the DraftGuru tables, the reload staging table and the batch row are written",
      not extra_tables, str(sorted(extra_tables)))
check("5.2 every draft_persons / draft_picks write is DraftGuru-scoped", not unscoped, str(unscoped))
check("5.3 replay_admin_overrides(draft_picks) ran inside the same transaction, before the commit",
      -1 < conn.index_of("FROM data_overrides o") < completed_idx)

# ---------------------------------------------------------------------------
# 6. AFLDB-ISSUE-348 -- the reload guard refuses before anything can be written
# ---------------------------------------------------------------------------
#
# The scripted connection models the server's answer to the guard's SELECTs from a stored
# population the test controls. The matching ("same key", NULL-safe) is modelled here by Python
# equality; that the real predicate is PostgreSQL's ``IS NOT DISTINCT FROM`` generated by
# common._key_match is proven against a real database in tests/integration/draftguru-import.test.ts.

import hashlib                                      # noqa: E402
import json                                         # noqa: E402
import tempfile                                     # noqa: E402

import reload_guard as rg                           # noqa: E402

section("6. Reload guard (AFLDB-ISSUE-348): refusal writes nothing, even under --dry-run")

CLUBS = {"essendon": 5}
URL_X = DG + "xray_audit/1"
PICK_COLS = ("id", "player_url", "draft_year", "draft_kind", "draft_person_id",
             "confidence_notes") + rg.PICK_FACT_COLUMNS
PERSON_COLS = ("id", "player_url", "confidence_notes") + rg.PERSON_FACT_COLUMNS
I336_PICK_NOTE = ("AFLDB-ISSUE-336 bounded insert from https://www.draftguru.com.au/drafts/2025 "
                  "(fetched 2026-11-06T00:00:00Z, sha256 0123456789abcdef)")
I336_PERSON_NOTE = ("AFLDB-ISSUE-336 bounded insert: identity unresolved; dg_person_id assigned "
                    "past the stored maximum and renumbered by the next full reload")


def stored_like(prepared: dict) -> tuple[list[dict], list[dict]]:
    """The stored population a clean reload of ``prepared`` would leave unchanged."""
    picks, persons = [], []
    for i, pick in enumerate(prepared["picks"], 1):
        row = {"id": 100 + i, "player_url": pick["player_url"], "draft_year": pick["draft_year"],
               "draft_kind": pick["draft_kind"], "draft_person_id": 500 + i,
               "confidence_notes": None}
        row.update(rg.incoming_pick_values(pick, CLUBS))
        picks.append(row)
    for i, (url, person) in enumerate(prepared["persons"].items(), 1):
        persons.append({"id": 500 + i, "player_url": url, "confidence_notes": None,
                        "dg_person_id": person["dg_person_id"],
                        "display_name_raw": person["display_name_raw"],
                        "name_key": person["name_key"]})
    return picks, persons


def i336_pick(pid: int = 9001, person_id: int = 801, url: str = URL_X) -> dict:
    """A pick in exactly the shape tools/v2/issue336-predraft-insert-production.ts inserts:
    Pre-Draft / pre_draft, pick_number NULL, source draftguru, the importer's reload key,
    provenance in confidence_notes, no competition, weight, grade or signing detail."""
    return {"id": pid, "player_url": url, "draft_year": 2025, "draft_kind": "pre_draft",
            "draft_person_id": person_id, "confidence_notes": I336_PICK_NOTE,
            "draft_type": "Pre-Draft", "pick_number": None, "pick_note": None,
            "player_name_raw": "Xray Audit", "club_id": 5, "club_name_raw": "Essendon",
            "original_club_raw": "Somewhere FC", "draft_age": 17, "height_cm": None,
            "weight_kg": None, "grade": None, "competition": None, "signing": "Signed",
            "signing_kind": "signed", "signing_detail": None, "detail": None,
            "source_record_id": "https://www.draftguru.com.au/drafts/2025#9"}


def i336_person(person_id: int = 801, url: str = URL_X, rank: int = 5058) -> dict:
    return {"id": person_id, "player_url": url, "confidence_notes": I336_PERSON_NOTE,
            "dg_person_id": rank, "display_name_raw": "Xray Audit", "name_key": "xray audit"}


def incoming_for(row: dict, rank: int) -> tuple[dict, dict]:
    """The frame entries that would make ``row`` an unchanged matched pick."""
    pick = {"player_url": row["player_url"], "draft_year": row["draft_year"],
            "draft_type": row["draft_type"], "draft_kind": row["draft_kind"],
            "pick_number": row["pick_number"], "pick_note": row["pick_note"],
            "player_name_raw": row["player_name_raw"], "club_slug": "essendon",
            "club_name_raw": row["club_name_raw"], "original_club_raw": row["original_club_raw"],
            "draft_age": row["draft_age"], "height_cm": row["height_cm"],
            "competition": row["competition"], "signing": row["signing"],
            "signing_kind": row["signing_kind"], "detail": row["detail"],
            "source_record_id": row["source_record_id"]}
    person = {"player_url": row["player_url"], "dg_person_id": rank,
              "display_name_raw": row["player_name_raw"], "name_key": "xray audit",
              "reported_games": 0, "reported_goals": 0}
    return pick, person


def guard_responders(picks, persons, *, edits=(), overrides=(), base_extra=()):
    key_of = lambda r: (r["player_url"], r["draft_year"], r["draft_kind"])

    def incoming_keys(params):
        return list(zip(params[1], params[2], params[3]))

    def matched_picks(_sql, params):
        keys = incoming_keys(params)
        return [(p["id"], n) for p in picks for n, k in enumerate(keys, 1) if key_of(p) == k]

    def deleted_picks(_sql, params):
        keys = set(zip(params[2], params[3], params[4]))     # params[0] is the scope, [1] source ids
        return [(p["id"],) for p in picks if key_of(p) not in keys]

    def matched_persons(_sql, params):
        return [(p["id"], n) for p in persons for n, u in enumerate(params[1], 1)
                if p["player_url"] == u]

    def deleted_persons(_sql, params):
        urls = set(params[2])
        return [(p["id"],) for p in persons if p["player_url"] not in urls]

    guard = [
        (r"FROM public\.draft_picks WHERE source_id",
         fake.rows(*[tuple(p[c] for c in PICK_COLS) for p in picks])),
        (r"SELECT e\.id, i\.ord FROM public\.draft_picks e JOIN", matched_picks),
        (r"SELECT e\.id FROM public\.draft_picks e WHERE", deleted_picks),
        (r"FROM public\.draft_persons WHERE source_id",
         fake.rows(*[tuple(p[c] for c in PERSON_COLS) for p in persons])),
        (r"SELECT e\.id, i\.ord FROM public\.draft_persons e JOIN", matched_persons),
        (r"SELECT e\.id FROM public\.draft_persons e WHERE", deleted_persons),
        (r"FROM public\.data_edits", fake.rows(*edits)),
        (r"FROM public\.data_overrides", fake.rows(*overrides)),
    ]
    return guard + list(base_extra) + responders()


def run_guarded(prepared: dict, conn: fake.FakeConnection, *, dry_run: bool = False,
                acknowledge: bool = False, report: str | None = None,
                reconciliation: dict | None = None):
    os.environ["AFLDB_IMPORT_DATABASE_URL"] = "postgresql://contract@never.invalid:1/never_dialled"
    original = common.connect_pg
    common.connect_pg = lambda _dsn=None: conn
    rep = Rep()
    args = SimpleNamespace(no_seed=True, label="contract-label", dry_run=dry_run,
                           acknowledge_population_drop=acknowledge, guard_report=report)
    frame = dict(prepared)
    if reconciliation is not None:
        frame["reconciliation"] = reconciliation
    try:
        imp.run_import(args, frame, rep)
        return None, rep
    except BaseException as exc:                    # noqa: BLE001
        return exc, rep
    finally:
        common.connect_pg = original
        os.environ.pop("AFLDB_IMPORT_DATABASE_URL", None)


def read_only_so_far(conn: fake.FakeConnection) -> tuple[bool, str]:
    """Every statement sent is a SELECT, nothing was copied, nothing committed, no batch row."""
    heads = [" ".join(str(p).split())[:12].upper() for k, p, _ in conn.log if k == "execute"]
    offenders = [h for h in heads if not h.startswith(("SELECT", "WITH"))]
    copies = [1 for k, _, _ in conn.log if k == "copy"]
    ok = (not offenders and not copies and conn.commits == 0
          and conn.index_of("import_batches") == -1)
    return ok, f"offenders={offenders[:3]} copies={len(copies)} commits={conn.commits}"


def digest_of(prepared: dict, conn_responders) -> tuple[str, dict]:
    """Run a refusing/passing guard once with --guard-report and read the digest and effects."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "report.json")
        run_guarded(prepared, fake.FakeConnection(conn_responders), dry_run=True, report=path)
        doc = json.loads(open(path, encoding="utf-8").read())
    return doc["effect_digest"], doc["effects"]


def reconciliation_for(digest: str, effects: dict, *, label: str = "contract-label",
                       review: list | None = None, rulings: list | None = None) -> dict:
    return {
        "format": rg.RECONCILIATION_FORMAT, "stage_a_label": label, "effect_digest": digest,
        "acknowledged_deletions": [
            {"id": d["id"], "key": d["key"], "acknowledge_audit_orphans": bool(d["reasons"])}
            for d in effects["deleted_picks"]],
        "acknowledged_person_deletions": [{"player_url": d["player_url"]}
                                          for d in effects["deleted_persons"]],
        "acknowledged_protected_rewrites": [{"id": r["id"], "key": r["key"]}
                                            for r in effects["protected_rewrites"]],
        "acknowledged_protected_person_rewrites": [{"player_url": r["player_url"]}
                                                   for r in effects["protected_person_rewrites"]],
        "origin_review": list(review if review is not None else [
            {"id": c["id"], "year": c["year"], "db": c["before"], "csv": c["after"],
             "class": c["class"]} for c in effects["origin_changes"]]),
        "owner_rulings": list(rulings or []),
    }


# --- 6.1 clean: stored equals incoming -> proceeds; the guard ran before the batch row --------
frame = prepared_frame()
s_picks, s_persons = stored_like(frame)
conn61 = fake.FakeConnection(guard_responders(s_picks, s_persons))
exc61, rep61 = run_guarded(frame, conn61)
check("6.1 a clean reload (nothing to delete or rewrite) is not refused", exc61 is None, repr(exc61))
guard_at = conn61.index_of("WITH ORDINALITY")
check("6.2 the guard's reads precede the import_batches row, apply_authority and every write",
      -1 < guard_at < conn61.index_of("INSERT INTO import_batches")
      and guard_at < conn61.index_of("FROM player_link_resolutions")
      and guard_at < first_data_index(conn61), f"guard at {guard_at}")
check("6.3 the success path still commits once before the data and never rolls back",
      conn61.rollbacks == 0 and len([c for c in conn61.indexes_of_kind("commit")
                                     if c < first_data_index(conn61)]) == 1)
check("6.4 the guard states it is clear", any(label == "reload guard" and str(value).startswith("clear")
                                              for label, value in rep61.results), str(rep61.results))

# --- 6.5 the audited D-336-2 shape: a stored audited pick the snapshot does not carry ----------
audited = i336_pick()
edits = [(9001, True)]
resp_del = guard_responders(s_picks + [audited], s_persons + [i336_person()], edits=edits)
for dry in (False, True):
    conn = fake.FakeConnection(resp_del)
    exc, _ = run_guarded(frame, conn, dry_run=dry)
    ok, why = read_only_so_far(conn)
    label_ = "--dry-run" if dry else "normal run"
    check(f"6.5 ({label_}) deleting an audited pick (pick_number NULL) is refused as ImportFailure",
          isinstance(exc, imp.ImportFailure) and "reload guard (AFLDB-ISSUE-348)" in str(exc)
          and "1 pick deletion(s) (1 audited)" in str(exc) and "1 person deletion(s) (1 audited)" in str(exc),
          repr(exc)[:300])
    check(f"6.6 ({label_}) the refusal wrote nothing: SELECTs only, no commit, no import_batches row",
          ok and conn.rollbacks == 1, why)
exc_ack, _ = run_guarded(frame, fake.FakeConnection(resp_del), acknowledge=True)
check("6.7 --acknowledge-population-drop does not satisfy the guard (D-3)",
      isinstance(exc_ack, imp.ImportFailure) and "reload guard" in str(exc_ack), repr(exc_ack)[:200])

# --- 6.8 a reviewed reconciliation is the way past, and only for exactly these keys -------------
digest_del, effects_del = digest_of(frame, resp_del)
check("6.8 the report names the audited deletion by id and key, with its reasons",
      effects_del["deleted_picks"] == [{"id": 9001, "key": [URL_X, 2025, "pre_draft"],
                                        "reasons": ["data_edits", "audited_insert"]}]
      and effects_del["deleted_persons"] == [{"id": 801, "player_url": URL_X, "protected": True}],
      json.dumps(effects_del))
good = reconciliation_for(digest_del, effects_del)
exc, _ = run_guarded(frame, fake.FakeConnection(resp_del), reconciliation=good)
check("6.9 a reconciliation naming exactly those keys and the digest lets the run proceed",
      exc is None, repr(exc)[:300])
no_orphans = json.loads(json.dumps(good))
no_orphans["acknowledged_deletions"][0]["acknowledge_audit_orphans"] = False
exc, _ = run_guarded(frame, fake.FakeConnection(resp_del), reconciliation=no_orphans)
check("6.10 an audited deletion needs acknowledge_audit_orphans (its data_edits rows are orphaned)",
      isinstance(exc, imp.ImportFailure) and "acknowledge_audit_orphans" in str(exc), repr(exc)[:200])
stale = json.loads(json.dumps(good))
stale["effect_digest"] = "0" * 64
exc, _ = run_guarded(frame, fake.FakeConnection(resp_del), reconciliation=stale)
check("6.11 a reconciliation reviewed against different effects (digest) is refused",
      isinstance(exc, imp.ImportFailure) and "effect_digest does not match" in str(exc), repr(exc)[:200])
wrong_label = reconciliation_for(digest_del, effects_del, label="another-label")
exc, _ = run_guarded(frame, fake.FakeConnection(resp_del), reconciliation=wrong_label)
check("6.12 a reconciliation for another Stage A label is refused",
      isinstance(exc, imp.ImportFailure) and "stage_a_label" in str(exc), repr(exc)[:200])
partial = json.loads(json.dumps(good))
partial["acknowledged_person_deletions"] = []
exc, _ = run_guarded(frame, fake.FakeConnection(resp_del), reconciliation=partial)
check("6.13 every deleted person must be named too",
      isinstance(exc, imp.ImportFailure) and "person deletions: not acknowledged" in str(exc),
      repr(exc)[:200])
extra = json.loads(json.dumps(good))
extra["acknowledged_deletions"].append({"id": 4242, "key": [URL_A, 1999, "national"]})
exc, _ = run_guarded(frame, fake.FakeConnection(resp_del), reconciliation=extra)
check("6.14 a key that is not an effect of this run is refused (exact keys)",
      isinstance(exc, imp.ImportFailure) and "acknowledged but not an effect" in str(exc),
      repr(exc)[:200])

# --- 6.15 a stored pick whose reload key has a NULL component is not matched, so it is deleted ---
null_kind = dict(i336_pick(9002, 802, DG + "null_kind/1"), draft_kind=None)
conn = fake.FakeConnection(guard_responders(s_picks + [null_kind], s_persons + [i336_person(802, DG + "null_kind/1")]))
exc, _ = run_guarded(frame, conn, dry_run=True)
check("6.15 a stored row with a NULL reload-key component is reported, not silently kept",
      isinstance(exc, imp.ImportFailure) and "1 pick deletion(s)" in str(exc), repr(exc)[:200])

# --- 6.16 NULL non-key columns do not read as changes (pick_number is NULL on the I336 rows) ----
pick_a, person_a = incoming_for(audited, 5058)
frame_keep = prepared_frame()
frame_keep["picks"] = frame_keep["picks"] + [pick_a]
frame_keep["persons"] = dict(frame_keep["persons"])
frame_keep["persons"][URL_X] = person_a
PERSON_IDS_WITH_X = [(r"SELECT player_url, id FROM draft_persons",
                      fake.rows((URL_A, 501), (URL_B, 502), (URL_C, 503), (URL_X, 801)))]
conn = fake.FakeConnection(guard_responders(
    s_picks + [audited], s_persons + [i336_person()], edits=edits, base_extra=PERSON_IDS_WITH_X))
exc, _ = run_guarded(frame_keep, conn)
check("6.16 an audited pick the snapshot DOES carry unchanged (NULL pick_number == NULL) and kept "
      "at the same rank is not refused", exc is None, repr(exc)[:300])

# --- 6.17 renumbering an audited person's dg_person_id is a refused rewrite (D-5) --------------
frame_rank = prepared_frame()
rank_pick, rank_person = incoming_for(audited, 4)       # the reload would rank it 4, not 5058
frame_rank["picks"] = frame_rank["picks"] + [rank_pick]
frame_rank["persons"] = dict(frame_rank["persons"])
frame_rank["persons"][URL_X] = rank_person
resp_rank = guard_responders(s_picks + [audited], s_persons + [i336_person()], edits=edits,
                             base_extra=PERSON_IDS_WITH_X)
conn = fake.FakeConnection(resp_rank)
exc, _ = run_guarded(frame_rank, conn, dry_run=True)
check("6.17 a changed dg_person_id on an audited person is refused (dry-run too)",
      isinstance(exc, imp.ImportFailure) and "1 audited person rewrite(s)" in str(exc)
      and read_only_so_far(conn)[0], repr(exc)[:300])
digest_rank, effects_rank = digest_of(frame_rank, resp_rank)
check("6.18 the rewrite is reported column by column: dg_person_id 5058 -> 4",
      effects_rank["protected_person_rewrites"] == [
          {"id": 801, "player_url": URL_X, "columns": {"dg_person_id": [5058, 4]}}],
      json.dumps(effects_rank))
exc, _ = run_guarded(frame_rank, fake.FakeConnection(resp_rank),
                     reconciliation=reconciliation_for(digest_rank, effects_rank))
check("6.19 naming that person in the reconciliation lets the renumbering through",
      exc is None, repr(exc)[:300])

# --- 6.20 original_club_raw: D-336-3 review input; REPLACE_CLUB needs an owner ruling -----------
frame_o = prepared_frame()
s_o, p_o = stored_like(frame_o)
s_o = [dict(r) for r in s_o]
s_o[0]["original_club_raw"] = "Surrey Park/Xavier College/Oakleigh U18"
frame_o["picks"] = [dict(p) for p in frame_o["picks"]]
frame_o["picks"][0]["original_club_raw"] = "Kew Rovers/Xavier College/Oakleigh U18"   # REPLACE_CLUB
s_o[1]["original_club_raw"] = "Brighton"
frame_o["picks"][1]["original_club_raw"] = "Brighton Districts & Old Scholars"           # RENAME_EXPAND
s_o[2]["original_club_raw"] = "Carey/Oakleigh U18"
frame_o["picks"][2]["original_club_raw"] = "Carey/Carey Grammar School/Oakleigh U18"       # INSERT_SCHOOL
resp_o = guard_responders(s_o, p_o)
conn = fake.FakeConnection(resp_o)
exc, _ = run_guarded(frame_o, conn, dry_run=True)
check("6.20 original_club_raw changes without a review input are refused (dry-run too)",
      isinstance(exc, imp.ImportFailure) and "3 original_club_raw change(s)" in str(exc)
      and read_only_so_far(conn)[0], repr(exc)[:300])
digest_o, effects_o = digest_of(frame_o, resp_o)
classes = {c["id"]: c["class"] for c in effects_o["origin_changes"]}
check("6.21 the three D-336-3 shapes are classified REPLACE_CLUB / RENAME_EXPAND / INSERT_SCHOOL",
      classes == {101: "REPLACE_CLUB", 102: "RENAME_EXPAND", 103: "INSERT_SCHOOL"}, str(classes))
no_ruling = reconciliation_for(digest_o, effects_o)
exc, _ = run_guarded(frame_o, fake.FakeConnection(resp_o), reconciliation=no_ruling)
check("6.22 a REPLACE_CLUB row is not adjudicated: it needs an explicit owner ruling",
      isinstance(exc, imp.ImportFailure) and "pick 101 is REPLACE_CLUB" in str(exc)
      and "pick 102" not in str(exc) and "pick 103" not in str(exc), repr(exc)[:300])
bad_ruling = reconciliation_for(digest_o, effects_o, rulings=[
    {"id": 101, "decision": "keep_stored", "reference": "D-x"}])
exc, _ = run_guarded(frame_o, fake.FakeConnection(resp_o), reconciliation=bad_ruling)
check("6.23 only 'accept_incoming' with a reference is a ruling the importer can execute",
      isinstance(exc, imp.ImportFailure) and "pick 101 is REPLACE_CLUB" in str(exc), repr(exc)[:200])
ruled = reconciliation_for(digest_o, effects_o, rulings=[
    {"id": 101, "decision": "accept_incoming", "reference": "owner ruling D-test"}])
exc, _ = run_guarded(frame_o, fake.FakeConnection(resp_o), reconciliation=ruled)
check("6.24 review entries for all three plus the explicit ruling let the run proceed",
      exc is None, repr(exc)[:300])
lying = json.loads(json.dumps(ruled))
for entry in lying["origin_review"]:
    if entry["id"] == 101:
        entry["class"] = "INSERT_SCHOOL"
exc, _ = run_guarded(frame_o, fake.FakeConnection(resp_o), reconciliation=lying)
check("6.25 a review entry whose class is not the recomputed class is refused",
      isinstance(exc, imp.ImportFailure) and "origin_review 101: class" in str(exc), repr(exc)[:200])
missing_review = reconciliation_for(digest_o, effects_o, review=[
    e for e in ruled["origin_review"] if e["id"] != 103], rulings=ruled["owner_rulings"])
exc, _ = run_guarded(frame_o, fake.FakeConnection(resp_o), reconciliation=missing_review)
check("6.26 an origin change with no review entry is refused",
      isinstance(exc, imp.ImportFailure) and "origin change on pick 103 has no origin_review"
      in str(exc), repr(exc)[:200])

# --- 6.27 an active override on original_club_raw decides the value, so no change is an effect ---
overrides = [(f"{DRAFTGURU_SOURCE_ID}|{URL_A}|2001|national", {"original_club_raw": "Owner/Value"})]
s_ov = [dict(r) for r in s_picks]
s_ov[0]["original_club_raw"] = "Owner/Value"
conn = fake.FakeConnection(guard_responders(s_ov, s_persons, overrides=overrides, edits=[(101, False)]))
exc, _ = run_guarded(frame, conn)
check("6.27 a column an active override covers is not a reload effect (the replay restores it)",
      exc is None, repr(exc)[:300])
s_dt = [dict(r) for r in s_picks]
s_dt[0]["original_club_raw"] = "Owner/Value"
s_dt[0]["height_cm"] = 1          # an uncovered column of an edited pick that the source would rewrite
conn = fake.FakeConnection(guard_responders(s_dt, s_persons, overrides=overrides, edits=[(101, False)]))
exc, _ = run_guarded(frame, conn, dry_run=True)
check("6.28 an uncovered change on a pick with data_edits is a refused audited rewrite",
      isinstance(exc, imp.ImportFailure) and "1 audited pick rewrite(s)" in str(exc)
      and "0 original_club_raw change(s)" in str(exc), repr(exc)[:300])

# --- 6.29 pure pieces ------------------------------------------------------------------------
cls_path = ROOT / "docs" / "v2" / "evidence" / "issue336-draft-categories-20261105" / \
    "d3363-classification-20261111" / "classification.json"
rows187 = json.loads(cls_path.read_text(encoding="utf-8"))
mismatch = [r["id"] for r in rows187 if rg.classify_origin_change(r["db"], r["csv"]) != r["class"]]
check("6.30 the committed classifier output (187 rows) is reproduced exactly by the guard's port",
      len(rows187) == 187 and not mismatch, f"{len(rows187)} rows, mismatches {mismatch[:5]}")
check("6.31 NULL -> value is an insertion, value -> NULL is not auto-accepted",
      rg.classify_origin_change(None, "Carey Grammar School") == "INSERT_SCHOOL"
      and rg.classify_origin_change("Carey", None) == "OTHER"
      and rg.classify_origin_change("A  B", "A B") == "WHITESPACE_ONLY")

with tempfile.TemporaryDirectory() as tmp:
    rec_path = os.path.join(tmp, "rec.json")
    body = json.dumps(good).encode("utf-8")
    open(rec_path, "wb").write(body)
    sha = hashlib.sha256(body).hexdigest()
    loaded = rg.load_reconciliation(rec_path, sha)
    check("6.32 a reconciliation pinned by its sha256 loads", loaded["effect_digest"] == digest_del)

    def refused(path, digest):
        try:
            rg.load_reconciliation(path, digest)
            return ""
        except rg.ReloadRefused as exc:
            return str(exc)

    check("6.33 a wrong pin, a missing partner flag and unknown keys are all refused",
          "not the pinned" in refused(rec_path, "0" * 64)
          and "must be given together" in refused(rec_path, None)
          and "must be given together" in refused(None, sha))
    odd = os.path.join(tmp, "odd.json")
    odd_body = json.dumps(dict(good, surprise=1)).encode("utf-8")
    open(odd, "wb").write(odd_body)
    check("6.34 a reconciliation with an unknown key is refused",
          "keys differ from the contract" in refused(odd, hashlib.sha256(odd_body).hexdigest()))

link_refusal = imp.link_only_cli_refusal(SimpleNamespace(
    link_only=True, bridge="b", no_seed=True, label_explicit=True,
    acknowledge_population_drop=False, snapshot_root=None, reconciliation="r.json",
    reconciliation_sha256=None, guard_report=None))
check("6.35 --link-only refuses the guard's flags (its behaviour is otherwise unchanged)",
      link_refusal is not None and "--reconciliation" in link_refusal, str(link_refusal))

# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} DraftGuru importer atomicity check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    sys.exit(1)
print("All DraftGuru importer atomicity checks hold.")
