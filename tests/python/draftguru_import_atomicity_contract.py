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
     ``draft_picks`` carries the DraftGuru ``source_id`` scope, and no other table is written.

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

print()
if failures:
    print(f"{len(failures)} DraftGuru importer atomicity check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    sys.exit(1)
print("All DraftGuru importer atomicity checks hold.")
