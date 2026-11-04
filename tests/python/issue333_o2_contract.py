#!/usr/bin/env python3
"""AFLDB-ISSUE-333 (O1) and O2 -- DB-free contract for the two narrowly scoped production writers and their ceremonies.

    python tests/python/issue333_o2_contract.py

Against the real modules (no database; the write transaction is driven through a fake psycopg connection that records every statement):

  O1 staging   the pinned tar hash, a pre-existing (stale) staging directory, link / unlisted / duplicate / changed tar members, a tampered or extra
               staged file -- all refuse;
  O1 plan      the exact additive set; a pre-existing assignment conflict, a coach string with no existing coaches row, a deletion-causing input
               (a stored assignment the source no longer asserts), a pre-inserted planned key and a wrong season all refuse;
  O1 classify  baseline / applied / other, including a tampered pre-existing row (any column) and a foreign batch appended by the nightly settle;
  O1 writer    COMMITs only when every in-transaction check passes; pre-state drift refuses before any INSERT; a post-state failure ROLLS BACK;
  O2           the pinned comparison (equal / drift / NULL / moved version / already resolved), classify, and the writer's commit / rollback paths;
  ceremony     approval binding (digest, operation, target, revision, package or ids, expiry, reference), machine-assembled backup evidence (fresh,
               stale, other stage, changed tool bytes), the exact-target DSN rule, the no-apply window, the timezone-invariant digest, and that
               both ceremonies route their apply through the shared outcome runner with no restore / retry step.
"""
from __future__ import annotations

import copy
import importlib.util
import io
import json
import os
import shutil
import sys
import tarfile
import tempfile
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "v2"))
sys.path.insert(0, str(REPO / "tools" / "migration"))
os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
sys.dont_write_bytecode = True


def load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, REPO / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


import issue333_o2_common as oc  # noqa: E402
import add_match_coaches_2026 as w1  # noqa: E402
import o2_converged_findings as w2  # noqa: E402
c1 = load("issue333_ceremony", "tools/v2/issue333-coach-assignments-production.py")
c2 = load("o2_ceremony", "tools/v2/o2-converged-findings-production.py")
import gap029_common as gc  # noqa: E402

FAILED: list[str] = []
RAN = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global RAN
    RAN += 1
    print(("ok   " if ok else "FAIL ") + name + (f" -- {detail}" if (detail and not ok) else ""))
    if not ok:
        FAILED.append(name)


def refuses(fn, needle: str) -> tuple[bool, str]:
    try:
        fn()
    except (oc.Refused, c1.Refused) as exc:
        return (needle in str(exc), str(exc))
    return (False, "did not refuse")


UTC = timezone.utc
T0 = datetime(2026, 11, 4, 2, 0, tzinfo=UTC)

# ------------------------------------------------------------------------------------------------ O1 fixtures (patched to a 4-row world)
w1.EXPECT_NEW, w1.EXPECT_MATCHES = 4, 2
w1.EXPECTED_WRITES = {"public.import_batches": [1, 1, 0], "public.match_coaches": [4, 0, 0]}


def coach(i, path, name):
    return (i, path, name, name, None, None, None, None, "unmatched", None, 10, 1, path, 5, None)


def o1_state():
    return {"sourceId": 1,
            "matches": [(1, "2025|1|A|B", 2025, 10, 11), (2, "2026|1|A|B", 2026, 10, 11), (3, "2026|1|C|D", 2026, 12, 13)],
            "clubs": [(10, "A"), (11, "B"), (12, "C"), (13, "D")],
            "coaches": [coach(100, "coaches/X.html", "X, Y"), coach(101, "coaches/Z.html", "Z, W")],
            "matchCoaches": [(1, 10, 100, 1, "2025|1|A|B@A", 5), (1, 11, 101, 1, "2025|1|A|B@B", 5)],
            "importBatches": [(5, 1, "import_match_coaches.py", "match_coaches", T0, T0, "completed", 1, 2, 0, 0, {"k": 1}, None, None)],
            "importRejections": [0, 0], "coachOverrides": [], "triggers": [["match_coaches", "match_coaches_club_in_match_trg", "O", "CREATE TRIGGER ..."]]}


def o1_src():
    X, Z = "coaches/X.html", "coaches/Z.html"
    return {"assignments": {("2025|1|A|B", 2025, "A"): X, ("2025|1|A|B", 2025, "B"): Z, ("2026|1|A|B", 2026, "A"): X, ("2026|1|A|B", 2026, "B"): Z,
                            ("2026|1|C|D", 2026, "C"): X, ("2026|1|C|D", 2026, "D"): Z}, "rowsRead": 12}


def o1_plan(state=None, src=None):
    f = w1.facts(src or o1_src(), state or o1_state())
    body = {"operation": "issue333-coach-assignments", "rehearsal": True, "target": TARGET, "staging": {"path": "x"}, **f, "createdAt": "2026-11-04T01:00:00.000Z"}
    return {**body, "digest": oc.sha(oc.canon(body))}


def o1_applied(plan, batch_id=6, tool=None):
    s = o1_state()
    s["importBatches"].append((batch_id, 1, tool or w1.TOOL, "match_coaches", T0, T0, "completed", 12, 4, 0, 0, {}, None, "n"))
    s["matchCoaches"] = sorted(s["matchCoaches"] + [(r[0], r[1], r[2], r[3], r[4], batch_id) for r in plan["newRows"]["rows"]])
    return s


TARGET = {"host": "127.0.0.1", "port": 55493, "database": "afldb_v2_x_test", "user": "afldb_owner", "systemIdentifier": "1", "databaseOid": "2",
          "clusterName": "afldb_v2_isolated", "databaseComment": "afldb-v2-isolated-test"}

# ---- plan facts
p = o1_plan()
check("O1 plan: exactly the additive set (2026 only, both sides of every 2026 match)", p["newRows"]["count"] == 4 and p["newRows"]["matches"] == 2
      and all(r[0] in (2, 3) for r in p["newRows"]["rows"]))
s = o1_state(); s["matchCoaches"][0] = (1, 10, 101, 1, "2025|1|A|B@A", 5)
check("O1 plan: a pre-existing assignment conflict refuses", *refuses(lambda: w1.compute_new(o1_src(), s), "conflict"))
src = o1_src(); src["assignments"][("2026|1|C|D", 2026, "D")] = "coaches/NEW.html"
check("O1 plan: an extra coach string with no existing coaches row refuses (no coach is ever inserted)", *refuses(lambda: w1.compute_new(src, o1_state()), "not already in coaches"))
src = o1_src(); del src["assignments"][("2025|1|A|B", 2025, "B")]
check("O1 plan: a deletion-causing input (a stored assignment the source no longer asserts) refuses", *refuses(lambda: w1.compute_new(src, o1_state()), "deletion-causing"))
s = o1_state(); s["matchCoaches"].append((2, 10, 100, 1, "2026|1|A|B@A", 5))
check("O1 plan: a planned key already present (rehearsal conflict scenario) refuses", *refuses(lambda: w1.compute_new(o1_src(), s), "not exactly the reviewed"))
s = o1_state(); s["matchCoaches"].append((2, 10, 101, 1, "2026|1|A|B@A", 5))
check("O1 plan: a planned key present with another coach refuses as a conflict", *refuses(lambda: w1.compute_new(o1_src(), s), "conflict"))
src = o1_src(); src["assignments"][("2024|1|Q|R", 2024, "A")] = "coaches/X.html"
check("O1 plan: a source match key absent from a held season refuses", *refuses(lambda: w1.compute_new(src, {**o1_state(), "matches": o1_state()["matches"] + [(9, "zz", 2024, 10, 11)]}), "absent from matches"))

# ---- classify
check("O1 classify: the plan's own baseline is BASELINE", w1.classify(p, o1_state())[0] == "unchanged")
check("O1 classify: exactly the planned rows + one completed batch is APPLIED", w1.classify(p, o1_applied(p))[0] == "applied")
s = o1_applied(p); s["matchCoaches"][0] = (1, 10, 100, 1, "2025|1|A|B@A", 7)
check("O1 classify: a pre-existing row changed in ANY column (import_batch_id) is OTHER", w1.classify(p, s)[0] == "other")
s = o1_applied(p); s["coaches"][0] = coach(100, "coaches/X.html", "X, Y")[:14] + ("note",)
check("O1 classify: a coaches row changed is OTHER", w1.classify(p, s)[0] == "other")
s = o1_applied(p); s["importBatches"].append((7, 2, "settle-afl-api.ts", "x", T0, T0, "completed", 0, 0, 0, 0, None, None, None))
check("O1 classify: a foreign nightly batch appended is tolerated outside the transaction", w1.classify(p, s)[0] == "applied")
check("O1 classify: ... and refused inside the transaction (strict)", w1.classify(p, s, strict=True)[0] == "other")
s = o1_state(); s["importBatches"].append((7, 2, "settle-afl-api.ts", "x", T0, T0, "completed", 0, 0, 0, 0, None, None, None))
check("O1 classify: baseline + a foreign appended batch is still BASELINE (disclosed)", w1.classify(p, s)[0] == "unchanged" and "appended" in w1.classify(p, s)[1][0])
s = o1_state(); s["importBatches"][0] = s["importBatches"][0][:13] + ("edited",)
check("O1 classify: an edited pre-existing batch row is OTHER", w1.classify(p, s)[0] == "other")

# ---- timezone invariance (plan-review F-001)
mel = T0.astimezone(ZoneInfo("Australia/Melbourne"))
check("digest: a timestamptz digests identically in any session TimeZone", oc.rows_digest([(1, T0)]) == oc.rows_digest([(1, mel)]))
check("digest: a naive timestamp refuses", *refuses(lambda: oc.rows_digest([(datetime(2026, 1, 1),)]), "without time zone"))
check("no-apply window: 04:20 AEDT is inside, 03:59 / 05:30 / 12:00 are outside",
      oc.in_no_apply_window(datetime(2026, 11, 4, 4, 20, tzinfo=ZoneInfo("Australia/Melbourne")))
      and not any(oc.in_no_apply_window(datetime(2026, 11, 4, h, m, tzinfo=ZoneInfo("Australia/Melbourne"))) for h, m in ((3, 59), (5, 30), (12, 0))))

# ------------------------------------------------------------------------------------------------ O1 staging (synthetic tar)
tmp = Path(tempfile.mkdtemp(prefix="i333-contract-"))
REAL_SHA, REAL_MANIFEST = w1.CORE_TAR_SHA256, w1.manifest_files
try:
    files = {"player_stats_2026.csv": b"a,b\n1,2\n", "results.csv": b"r\n"}

    def make_tar(name, members):
        path = tmp / name
        with tarfile.open(path, "w") as tf:
            for m in members:
                if m[0] == "symlink":
                    ti = tarfile.TarInfo(m[1]); ti.type = tarfile.SYMTYPE; ti.linkname = "/etc/passwd"; tf.addfile(ti)
                else:
                    ti = tarfile.TarInfo(m[0]); ti.size = len(m[1]); tf.addfile(ti, io.BytesIO(m[1]))
        return path

    w1.manifest_files = lambda: {k: oc.sha(v) for k, v in files.items()}

    def stage_with(tar, dest):
        w1.CORE_TAR_SHA256 = w1.file_sha256(tar)
        return w1.stage_core(tar, dest)

    good = make_tar("good.tar", list(files.items()))
    info = stage_with(good, tmp / "s1")
    check("O1 staging: the hash-verified tar stages exactly the manifest's files", info["files"] == 2)
    w1.CORE_TAR_SHA256 = "0" * 64
    check("O1 staging: a tampered tar (wrong sha256) refuses", *refuses(lambda: w1.stage_core(good, tmp / "s2"), "does not hash"))
    check("O1 staging: a pre-existing (stale) staging directory refuses", *refuses(lambda: stage_with(good, tmp / "s1"), "already exists"))
    (tmp / "s1" / "results.csv").write_bytes(b"tampered\n")
    check("O1 staging: a tampered staged file refuses at re-verification", *refuses(lambda: w1.verify_staging(tmp / "s1"), "differs from the manifest"))
    (tmp / "s1" / "results.csv").write_bytes(files["results.csv"]); (tmp / "s1" / "extra.csv").write_bytes(b"x")
    check("O1 staging: an extra staged file refuses", *refuses(lambda: w1.verify_staging(tmp / "s1"), "differs from the manifest"))
    check("O1 staging: a link member refuses", *refuses(lambda: stage_with(make_tar("l.tar", [("symlink", "results.csv")]), tmp / "s3"), "not a regular file"))
    check("O1 staging: an unlisted member refuses", *refuses(lambda: stage_with(make_tar("u.tar", [("evil.sh", b"x")]), tmp / "s4"), "not a manifest file"))
    check("O1 staging: a path-traversal member refuses", *refuses(lambda: stage_with(make_tar("p.tar", [("../results.csv", b"r\n")]), tmp / "s5"), "not a manifest file"))
    check("O1 staging: a duplicate member refuses", *refuses(lambda: stage_with(make_tar("d.tar", [("results.csv", b"r\n"), ("results.csv", b"r\n")]), tmp / "s6"), "duplicated"))
    check("O1 staging: a changed member refuses", *refuses(lambda: stage_with(make_tar("c.tar", [("results.csv", b"R\n")]), tmp / "s7"), "differs from the tracked manifest"))
    check("O1 staging: a missing member refuses", *refuses(lambda: stage_with(make_tar("m.tar", [("results.csv", b"r\n")]), tmp / "s8"), "lacks 1 manifest files"))
finally:
    w1.CORE_TAR_SHA256, w1.manifest_files = REAL_SHA, REAL_MANIFEST
    shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------------------------------------ fake psycopg for the write transactions
class FakeCursor:
    def __init__(self, conn):
        self.conn, self.rowcount, self._one = conn, 0, None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.conn.log.append(sql.split()[0] + " " + sql.split()[1])
        t = self.conn.target
        if sql.startswith("SELECT set_config"):
            self._one = ("",)
        elif sql.startswith("SELECT current_setting('TimeZone'), current_setting('lock_timeout')"):
            self._one = ("UTC", "5s", "300s", "off", self.conn.track_counts)
        elif "pg_control_system" in sql:
            self._one = (t["database"], "afldb_import", t["systemIdentifier"], t["databaseOid"], t["clusterName"])
        elif "has_table_privilege" in sql:
            self._one = (True,)
        elif sql.startswith("INSERT INTO import_batches"):
            self._one = (6,)
        elif sql.startswith("INSERT INTO match_coaches"):
            self.rowcount = len(params[1])
        elif sql.startswith("UPDATE import_batches"):
            self.rowcount = 1
        elif sql.startswith("UPDATE data_issues"):
            self.rowcount = self.conn.update_rows
        elif sql.startswith("SELECT now()"):
            self._one = (T0 + timedelta(hours=1),)
        elif "FOR UPDATE" in sql or "FOR SHARE" in sql:
            self._rows = [(e,) for e in params[1]] if "FROM staging." in sql else [(i,) for i in params[0]]
        return self

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._rows


class FakeConn:
    def __init__(self, target, update_rows=0):
        self.target, self.log, self.committed, self.rolled_back, self.closed, self.update_rows = target, [], False, False, False, update_rows
        self.track_counts = "on"

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def with_fake(conn, states, writes, fn):
    fake = types.ModuleType("psycopg"); fake.connect = lambda *a, **k: conn
    saved = sys.modules.get("psycopg"), w1.read_state, w2.read_state, oc.transaction_writes, w1.verify_staging, w1.read_source
    sys.modules["psycopg"] = fake
    seq, wseq = list(states), list(writes)
    w1.read_state = w2.read_state = lambda cur: seq.pop(0)
    oc.transaction_writes = lambda cur: wseq.pop(0)
    w1.verify_staging = lambda path: {"path": "x"}
    w1.read_source = lambda path: o1_src()
    try:
        return fn()
    finally:
        sys.modules["psycopg"], w1.read_state, w2.read_state, oc.transaction_writes, w1.verify_staging, w1.read_source = saved
        if saved[0] is None:
            del sys.modules["psycopg"]


p = o1_plan()
conn = FakeConn(TARGET)
r = with_fake(conn, [o1_state(), o1_applied(p)], [{}, w1.EXPECTED_WRITES], lambda: w1.apply(p, "dsn"))
check("O1 writer: every in-transaction check passes -> one COMMIT (lock taken, plain INSERT, batch completed)",
      conn.committed and not conn.rolled_back and r["inserted"] == 4 and "LOCK TABLE" in conn.log and "INSERT INTO" in conn.log)
conn = FakeConn(TARGET)
bad = o1_applied(p); bad["matchCoaches"][0] = (1, 10, 100, 1, "2025|1|A|B@A", 99)
ok, why = refuses(lambda: with_fake(conn, [o1_state(), bad], [{}, w1.EXPECTED_WRITES], lambda: w1.apply(p, "dsn")), "post-state check failed")
check("O1 writer: a post-state failure after the INSERT ROLLS BACK (no commit)", ok and conn.rolled_back and not conn.committed, why)
conn = FakeConn(TARGET)
ok, why = refuses(lambda: with_fake(conn, [o1_state(), o1_applied(p)], [{}, {**w1.EXPECTED_WRITES, "public.import_batches": [2, 1, 0]}], lambda: w1.apply(p, "dsn")), "post-state")
check("O1 writer: a surplus write by a trigger (pg_stat_xact) ROLLS BACK", ok and conn.rolled_back and not conn.committed, why)
conn = FakeConn(TARGET)
drift = o1_state(); drift["coaches"][1] = coach(101, "coaches/Z.html", "Z, W")[:10] + (11,) + coach(101, "", "")[11:]
ok, why = refuses(lambda: with_fake(conn, [drift], [{}], lambda: w1.apply(p, "dsn")), "baseline drift")
check("O1 writer: baseline drift inside the transaction refuses before any INSERT", ok and conn.rolled_back and not any(x.startswith("INSERT") for x in conn.log), why)
pt = copy.deepcopy(p); pt["newRows"]["count"] = 5
check("O1 writer: a plan edited after sealing refuses", *refuses(lambda: w1.plan_body_ok(pt), "digest"))
conn = FakeConn(TARGET); conn.track_counts = "off"
ok, why = refuses(lambda: with_fake(conn, [o1_state()], [{}], lambda: w1.apply(p, "dsn")), "track_counts")
check("O1 writer: track_counts off refuses before any statement that writes (review F-004)", ok and not any(x.startswith("INSERT") for x in conn.log) and not conn.committed, why)
pp = {k: v for k, v in p.items() if k != "digest"}; pp["rehearsal"] = False; pp = {**pp, "digest": oc.sha(oc.canon(pp))}
conn = FakeConn(TARGET)
ok, why = refuses(lambda: with_fake(conn, [o1_state()], [{}], lambda: w1.apply(pp, "dsn")), "rehearsal plan")
check("O1 writer: a production plan never writes an isolated test database (review F-003)", ok and not conn.committed, why)
check("common: a rehearsal plan against a production database name refuses (review F-003)",
      *refuses(lambda: oc.rehearsal_target_ok({"rehearsal": True}, "afldb_prod"), "rehearsal plan"))
check("common: a production plan against afldb_prod passes the rehearsal-target rule", oc.rehearsal_target_ok({"rehearsal": False}, "afldb_prod") is None)

# ------------------------------------------------------------------------------------------------ O2 fixtures (patched to 2 findings, 3 fields)
w2.IDS, w2.EXPECT_ROWS, w2.EXPECT_FIELDS = [41, 42], 2, 3
w2.EXPECTED_WRITES = {"public.data_issues": [0, 2, 0]}


def finding(i, pms, ext, fields, resolved=None, resolution=None):
    d = {"owner": "AFLDB-ISSUE-122", "refusal": "foreign_source_owner", "source_key": "afl_api", "target_table": "player_match_stats",
         "family": "player_match_stats", "external_record_id": ext, "source_version_seq": 1, "fields": fields, "match_key": "mk"}
    return (i, "player_match_stats", pms, "canonical_apply_failed", "warning", "desc", d, T0, resolved, resolution, f"afl_api|apply|{ext}")


def o2_state():
    return {"sources": {"afl_api": 2, "afltables": 1},
            "targets": [finding(41, 700, "E1", ["kicks"]), finding(42, 701, "E2", ["marks", "tackles"])],
            "others": [(1, "player_achievements", 5, "x", "warning", "d", {}, T0, None, None, None)],
            "canonical": [(700, {"id": 700, "player_id": 9, "club_id": 3, "match_id": 50, "source_id": 1, "kicks": 10}),
                          (701, {"id": 701, "player_id": 8, "club_id": 3, "match_id": 50, "source_id": 1, "marks": 4, "tackles": 2})],
            "staged": [("E1", {"version_seq": 1, "player_id": 9, "club_id": 3, "match_key": "mk", "kicks": 10}),
                       ("E2", {"version_seq": 1, "player_id": 8, "club_id": 3, "match_key": "mk", "marks": 4, "tackles": 2})],
            "matches": {"mk": 50}, "triggers": []}


def o2_plan(state=None):
    f = w2.facts(state or o2_state())
    body = {"operation": w2.OPERATION, "rehearsal": True, "target": TARGET, **f, "createdAt": "2026-11-04T01:00:00.000Z"}
    return {**body, "digest": oc.sha(oc.canon(body))}


def o2_applied(at=T0 + timedelta(hours=1)):
    s = o2_state()
    s["targets"] = [r[:8] + (at, "canonical_apply_not_needed") + r[10:] for r in s["targets"]]
    return s


q = o2_plan()
check("O2 plan: every flagged field equal -> plan with the restorable pre-image", q["baseline"]["operation"]["comparison"]["equal"] == 3 and len(q["preImage"]) == 2)
s = o2_state(); s["canonical"][1][1]["tackles"] = 3
check("O2 plan: a canonical value that differs refuses (negative comparison)", *refuses(lambda: w2.facts(s), "NOT equal"))
s = o2_state(); s["staged"][0][1]["kicks"] = None; s["canonical"][0][1]["kicks"] = None
check("O2 plan: NULL on both sides is not convergence", *refuses(lambda: w2.facts(s), "NOT equal"))
s = o2_state(); s["staged"][0][1]["version_seq"] = 2
check("O2 plan: a staged record that moved version refuses", *refuses(lambda: w2.facts(s), "moved from version"))
s = o2_state(); s["targets"][0] = finding(41, 700, "E1", ["kicks"], T0, "x")
check("O2 plan: an already-resolved row refuses", *refuses(lambda: w2.facts(s), "not an unresolved"))
s = o2_state(); s["canonical"][0][1]["source_id"] = 2
check("O2 plan: a canonical row no longer owned by afltables refuses", *refuses(lambda: w2.facts(s), "no longer owned"))
s = o2_state(); s["staged"][1][1]["player_id"] = 7
check("O2 plan: a staged record naming another player refuses", *refuses(lambda: w2.facts(s), "different players"))
check("O2 classify: BASELINE / APPLIED", w2.classify(q, o2_state())[0] == "unchanged" and w2.classify(q, o2_applied())[0] == "applied")
s = o2_applied(); s["targets"][0] = s["targets"][0][:5] + ("edited",) + s["targets"][0][6:]
check("O2 classify: another column of a resolved row changed is OTHER", w2.classify(q, s)[0] == "other")
s = o2_applied(); s["canonical"][0][1]["kicks"] = 11
check("O2 classify: a canonical change is OTHER", w2.classify(q, s)[0] == "other")
s = o2_applied(); s["others"].append((80, "x", 1, "y", "warning", "d", {}, T0, None, None, "k"))
check("O2 classify: a new other finding is tolerated outside the transaction, refused inside", w2.classify(q, s)[0] == "applied" and w2.classify(q, s, strict=True)[0] == "other")

conn = FakeConn(TARGET, update_rows=2)
r = with_fake(conn, [o2_state(), o2_state(), o2_applied()], [{}, w2.EXPECTED_WRITES], lambda: w2.apply(q, "dsn"))
check("O2 writer: rows locked FOR UPDATE, canonical/staged FOR SHARE, one UPDATE of exactly 2 -> COMMIT",
      conn.committed and r["updated"] == 2 and conn.log.count("SELECT id") >= 2 and "UPDATE data_issues" in conn.log)
conn = FakeConn(TARGET, update_rows=1)
ok, why = refuses(lambda: with_fake(conn, [o2_state(), o2_state(), o2_applied()], [{}, w2.EXPECTED_WRITES], lambda: w2.apply(q, "dsn")), "expected exactly")
check("O2 writer: a rowcount other than exactly N ROLLS BACK", ok and conn.rolled_back and not conn.committed, why)
conn = FakeConn(TARGET, update_rows=2)
bad = o2_applied(); bad["others"][0] = bad["others"][0][:5] + ("edited",) + bad["others"][0][6:]
ok, why = refuses(lambda: with_fake(conn, [o2_state(), o2_state(), bad], [{}, w2.EXPECTED_WRITES], lambda: w2.apply(q, "dsn")), "post-state")
check("O2 writer: another data_issues row changing inside the transaction ROLLS BACK", ok and conn.rolled_back and not conn.committed, why)
conn = FakeConn(TARGET, update_rows=2)
drift = o2_state(); drift["canonical"][0][1]["kicks"] = 12
ok, why = refuses(lambda: with_fake(conn, [o2_state(), drift], [{}], lambda: w2.apply(q, "dsn")), "NOT equal")
check("O2 writer: drift under the locks refuses before the UPDATE", ok and conn.rolled_back and "UPDATE data_issues" not in conn.log, why)

# ------------------------------------------------------------------------------------------------ ceremony: approval, evidence, target
w2.IDS, w2.EXPECT_ROWS, w2.EXPECT_FIELDS = list(range(41, 77)), 36, 53          # the real pins again
tt =datetime(2026, 11, 4, 3, 0, tzinfo=UTC)
plan = {"digest": "d" * 64, "target": TARGET, "expiresAt": "2026-11-05T01:00:00.000Z"}
good1 = {"planDigest": "d" * 64, "operation": c1.OPERATION, "target": TARGET, "revision": "r" * 40, "coreTarSha256": w1.CORE_TAR_SHA256,
         "approvedAt": "2026-11-04T02:59:00.000Z", "expiresAt": "2026-11-04T20:00:00.000Z", "reference": "owner message 2026-11-04"}
check("ceremony O1: a matching approval is accepted", c1.approval_problem(good1, plan, "r" * 40, tt) is None)
for name, edit in (("another plan digest", {"planDigest": "e" * 64}), ("another revision", {"revision": "s" * 40}), ("another package", {"coreTarSha256": "0" * 64}),
                   ("expired", {"expiresAt": "2026-11-04T02:00:00.000Z"}), ("outliving the plan", {"expiresAt": "2026-11-06T00:00:00.000Z"}),
                   ("dated in the future", {"approvedAt": "2026-11-04T04:00:00.000Z"}), ("with no reference", {"reference": " "}),
                   ("another target", {"target": {**TARGET, "databaseOid": "3"}})):
    check(f"ceremony O1: an approval {name} is refused", c1.approval_problem({**good1, **edit}, plan, "r" * 40, tt) is not None)
check("ceremony O1: a malformed approval is refused", c1.approval_problem({"planDigest": "d" * 64}, plan, "r" * 40, tt) is not None)
good2 = {**{k: v for k, v in good1.items() if k != "coreTarSha256"}, "operation": c2.OPERATION, "resolution": "canonical_apply_not_needed", "ids": list(range(41, 77))}
check("ceremony O2: a matching approval is accepted", c2.approval_problem(good2, plan, "r" * 40, tt) is None)
check("ceremony O2: an approval naming other ids or another resolution is refused",
      c2.approval_problem({**good2, "ids": list(range(41, 78))}, plan, "r" * 40, tt) is not None and c2.approval_problem({**good2, "resolution": "x"}, plan, "r" * 40, tt) is not None)

PROD = {"host": "localhost", "port": 5432, "database": "afldb_prod", "user": "afldb_backup", "systemIdentifier": "7674454702926115004", "databaseOid": "66668",
        "clusterName": "16/main", "databaseComment": None}


def sealed(stage, operation, tool_sha, fields, captured, inputs=None):
    backup = {"target": PROD, "sha256": "a" * 64, "restoreEvidenceSha256": "b" * 64, "capturedAt": captured, "restoredAt": captured, **fields}
    rest = {"format": gc.ASSEMBLY_FORMAT, "stage": stage, "operation": operation, "revision": "r" * 40, "assembledAt": captured,
            "restoreTarget": TARGET, "inputs": {"dumpSha256": "a" * 64, "restoreEvidenceSha256": "b" * 64, "toolSha256": tool_sha, **(inputs or {})},
            "derived": {"mode": "plan --rehearsal", "outputSha256": "c" * 64, "values": fields}}
    body = json.dumps({**backup, "assembly": rest})
    return {**backup, "assembly": {**rest, "sealedBody": body, "sealedBodySha256": gc.sha256_text(body)}}


F1 = {"baselineDigest": "1" * 64, "i333OperationDigest": "2" * 64, "i333NewRowsDigest": "3" * 64, "i333ImportBatches": {"rows": 75, "maxId": 82, "fullRowDigest": "4" * 64}}
fresh_at = "2026-11-04T02:00:00.000Z"
b1 = sealed("I333", c1.OPERATION, c1.tool_hashes(), F1, fresh_at, {"coreTarSha256": w1.CORE_TAR_SHA256})
check("ceremony O1: fresh machine-assembled I333 evidence is accepted", c1.assembled_problem(b1, PROD, "r" * 40, tt) is None, str(c1.assembled_problem(b1, PROD, "r" * 40, tt)))
check("ceremony O1: stale evidence (older than 24 h) is refused", "older than 24 hours" in str(c1.assembled_problem(sealed("I333", c1.OPERATION, c1.tool_hashes(), F1, "2026-11-03T02:00:00.000Z", {"coreTarSha256": w1.CORE_TAR_SHA256}), PROD, "r" * 40, tt)))
check("ceremony O1: evidence assembled for another stage is refused", "assembled for" in str(c1.assembled_problem(sealed("S4", "gap029-sibling-pair", c1.tool_hashes(), F1, fresh_at), PROD, "r" * 40, tt)))
th = {**c1.tool_hashes(), c1.WRITER_REL: "0" * 64}
check("ceremony O1: evidence derived with other writer bytes is refused", "differs from the bytes" in str(c1.assembled_problem(sealed("I333", c1.OPERATION, th, F1, fresh_at, {"coreTarSha256": w1.CORE_TAR_SHA256}), PROD, "r" * 40, tt)))
check("ceremony O1: evidence derived from another package is refused", "different coreTarSha256" in str(c1.assembled_problem(sealed("I333", c1.OPERATION, c1.tool_hashes(), F1, fresh_at, {"coreTarSha256": "0" * 64}), PROD, "r" * 40, tt)))
b1e = copy.deepcopy(b1); b1e["i333NewRowsDigest"] = "9" * 64
check("ceremony O1: a hand-edited evidence field is refused", c1.assembled_problem(b1e, PROD, "r" * 40, tt) is not None)
F2 = {"baselineDigest": "1" * 64, "o2OperationDigest": "2" * 64, "o2ComparisonDigest": "3" * 64, "o2Others": {"rows": 4, "maxId": 4, "fullRowDigest": "4" * 64}}
check("ceremony O2: fresh machine-assembled O2 evidence is accepted", c2.assembled_problem(sealed("O2", c2.OPERATION, c2.tool_hashes(), F2, fresh_at), PROD, "r" * 40, tt) is None)
check("ceremony: a DSN naming another database is refused before connecting", *refuses(lambda: c1.dl.dsn_matches("postgresql://afldb_backup@localhost:5432/afldb_dev", PROD, True), "wrong target"))
check("ceremony: a DSN with another user is refused for the read session", *refuses(lambda: c1.dl.dsn_matches("postgresql://afldb_import@localhost:5432/afldb_prod", PROD, True), "wrong target"))

# ---- review F-001: never classify while a writer backend is live (a killed writer's COMMIT may be in flight)
for name, mod in (("O1", c1), ("O2", c2)):
    saved = mod.live_writers, mod.__dict__.get("time")
    seq = [[4242], [4242], []]
    mod.live_writers = lambda dsn, target: seq.pop(0) if seq else []
    import time as _time
    real_sleep = _time.sleep; _time.sleep = lambda s: None
    try:
        mod.await_no_live_writer("dsn", TARGET, seconds=60)
        check(f"ceremony {name}: the probe waits while a writer backend is live, then classifies", not seq)
        mod.live_writers = lambda dsn, target: [4242]
        try:
            mod.await_no_live_writer("dsn", TARGET, seconds=0)
            check(f"ceremony {name}: a writer backend that stays live makes the probe raise", False)
        except RuntimeError as exc:
            check(f"ceremony {name}: a writer backend that stays live makes the probe raise", "still live" in str(exc))
    finally:
        mod.live_writers = saved[0]; _time.sleep = real_sleep
rep = gc.run_apply(lambda: None, lambda: {"exit": -9}, lambda: (_ for _ in ()).throw(RuntimeError("a writer backend is still live")), lambda: [],
                   lambda rec: None, lambda: "t")
check("outcome runner: a killed writer whose session is still live is OUTCOME_UNDETERMINED, never ROLLED_BACK", rep.exit_code == 5, str(rep.exit_code))
check("live-writer SQL reads only columns every role may see (datid, usesysid, application_name)",
      all(x in oc.LIVE_WRITER_SQL for x in ("datid", "usesysid", "application_name")) and "state" not in oc.LIVE_WRITER_SQL.replace("pg_stat_activity", ""))

for rel in ("tools/v2/issue333-coach-assignments-production.py", "tools/v2/o2-converged-findings-production.py"):
    text = (REPO / rel).read_text(encoding="utf-8")
    check(f"{rel}: apply goes through the shared outcome runner and holds no restore / retry step",
          "run_apply(" in text and "pg_restore" not in text and "retry(" not in text and "assembly_problem" in text and "prove_identity" in text)
for rel in ("tools/migration/add_match_coaches_2026.py",):
    text = (REPO / rel).read_text(encoding="utf-8").split('"""', 2)[2]   # the code after the module docstring (which names what it does NOT do)
    check(f"{rel}: plain INSERT (no ON CONFLICT), no DELETE, no coaches write", "ON CONFLICT" not in text and "DELETE FROM" not in text
          and "INSERT INTO coaches" not in text and "UPDATE coaches" not in text and "UPDATE match_coaches" not in text)
check("the broad importer is unmodified by this work (it is only imported)", "def main" in (REPO / "tools/migration/import_match_coaches.py").read_text(encoding="utf-8"))

print(f"\n{RAN - len(FAILED)} of {RAN} checks passed")
sys.exit(1 if FAILED else 0)
