#!/usr/bin/env python3
"""V2-GAP-029 -- DB-free contract for the shared failure semantics and the restore-evidence seal check of the Python production stages.

    python tests/python/gap029_common_contract.py                     run every check
    python tests/python/gap029_common_contract.py --verify-fixture F  print {case: problem|null} for the sealed cases in F (used by tests/gap029-assembly.test.ts)

What this proves, against the real modules (no database, no subprocess of the importer or the loader):

  1. the seven outcomes, their exit codes and their fixed statements; a committed or undetermined state is never described as rolled back;
  2. the writer (an importer or loader that COMMITS IN ITS OWN TRANSACTION) is classified by a read-only probe, never by its exit code: a non-zero
     exit after a COMMIT is a committed outcome, a non-zero exit before any commit is ROLLED_BACK only when the probe proves the pre-run state,
     a writer that is killed or times out is classified the same way, and an unreadable state is OUTCOME_UNDETERMINED (never "rolled back");
  3. a post-commit verification failure and an unavailable verification are distinct committed outcomes; neither retries or restores;
  4. the sibling stage's state classifier (baseline / planned result / other) on synthetic rows;
  5. the seal check mirrors the TypeScript one (the cross-language equality is asserted by tests/gap029-assembly.test.ts);
  6. the stage tools route their apply through the runner and contain no restore, retry or reverse step.
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "v2"))
import gap029_common as c  # noqa: E402

FAILED: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + (f" -- {detail}" if (detail and not ok) else ""))
    if not ok:
        FAILED.append(name)


def verify_fixture(path: str) -> int:
    doc = json.loads(Path(path).read_text())
    now = datetime.fromtimestamp(doc["now"] / 1000, tz=timezone.utc)
    out = {}
    for name, backup in doc["cases"].items():
        out[name] = c.assembly_problem(backup, operation="gap029-draft-link-production", stage="S2", revision=doc["revision"], now=now, target=doc["target"],
                                       tool_sha256=doc["toolSha256"], stage_fields=doc["stageFields"], inputs=doc["inputs"])
    print(json.dumps(out))
    return 0


def at() -> str:
    return "2026-11-03T00:00:00.000Z"


def drive(preflight=lambda: None, launch=lambda: {"exit": 0}, probe=None, verify=lambda: []):
    calls, records = [], []

    def p():
        calls.append("preflight")
        preflight()

    def l():
        calls.append("launch")
        return launch()

    def pr():
        calls.append("probe")
        if probe is None:
            raise AssertionError("probe must not run")
        return probe()

    def v():
        calls.append("verify")
        return verify()

    def ps(rec):
        calls.append("persist")
        records.append(rec)

    return c.run_apply(p, l, pr, v, ps, at), calls, records


def raising(exc):
    def f(*_a, **_k):
        raise exc
    return f


def outcomes_and_writer_semantics() -> None:
    check("seven outcomes with unique statements", set(c.OUTCOMES) == set(c.STATEMENT) == set(c.EXIT_CODE) and len(set(c.STATEMENT.values())) == 7)
    check("exit codes", c.EXIT_CODE == {"COMMITTED_VERIFIED": 0, "NOTHING_WRITTEN": 0, "REFUSED_BEFORE_MUTATION": 1, "ROLLED_BACK": 2, "COMMITTED_VERIFICATION_FAILED": 3,
                                        "COMMITTED_VERIFICATION_UNAVAILABLE": 4, "OUTCOME_UNDETERMINED": 5})
    for o in ("COMMITTED_VERIFICATION_FAILED", "COMMITTED_VERIFICATION_UNAVAILABLE"):
        s = c.STATEMENT[o]
        check(f"{o} statement: committed, NOT rolled back, no retry/reverse/restore, owner decision",
              all(x in s for x in ("COMMITTED", "NOT rolled back", "will not retry, reverse or restore", "separate OWNER decision",
                                   "discard every write made to the database after the backup was taken", "nothing is restored automatically")))
    check("undetermined statement forbids assuming rollback", "Do NOT assume it rolled back and do NOT retry" in c.STATEMENT["OUTCOME_UNDETERMINED"])
    check("no committed statement claims a rollback", all("ROLLED BACK:" not in c.STATEMENT[o] for o in c.OUTCOMES if o != "ROLLED_BACK"))

    r, calls, rec = drive(preflight=raising(RuntimeError("stale plan")))
    check("preflight failure => REFUSED_BEFORE_MUTATION, writer never launched, no record", r.outcome == "REFUSED_BEFORE_MUTATION" and calls == ["preflight"] and not rec and r.exit_code == 1)

    r, calls, _ = drive()
    check("writer exit 0 + verify passes => COMMITTED_VERIFIED", r.outcome == "COMMITTED_VERIFIED" and calls == ["preflight", "launch", "verify", "persist"] and r.exit_code == 0)

    r, calls, _ = drive(verify=lambda: ["a pre-existing row changed"])
    check("writer exit 0 + verify finds differences => COMMITTED_VERIFICATION_FAILED (no retry)", r.outcome == "COMMITTED_VERIFICATION_FAILED" and r.exit_code == 3 and calls.count("launch") == 1
          and "NOT rolled back" in "\n".join(r.lines()))

    r, _, _ = drive(verify=raising(ConnectionError("down")))
    check("writer exit 0 + verify cannot run => COMMITTED_VERIFICATION_UNAVAILABLE", r.outcome == "COMMITTED_VERIFICATION_UNAVAILABLE" and r.exit_code == 4)

    # the importer/loader exit code is not evidence about its transaction
    r, calls, _ = drive(launch=lambda: {"exit": 1}, probe=lambda: "unchanged")
    check("writer exit 1 + probe proves the pre-run state => ROLLED_BACK", r.outcome == "ROLLED_BACK" and r.exit_code == 2 and calls == ["preflight", "launch", "probe", "persist"])

    r, calls, _ = drive(launch=lambda: {"exit": 1}, probe=lambda: "applied")
    check("writer exit 1 but the planned result is present (failed AFTER commit) => verified as COMMITTED, not rolled back",
          r.outcome == "COMMITTED_VERIFIED" and r.record.get("writerFailedAfterCommit") and "verify" in calls)

    r, _, _ = drive(launch=lambda: {"exit": 1}, probe=lambda: "applied", verify=lambda: ["count differs"])
    check("writer exit 1 after commit + verification differences => COMMITTED_VERIFICATION_FAILED", r.outcome == "COMMITTED_VERIFICATION_FAILED")

    r, _, _ = drive(launch=lambda: {"exit": 1}, probe=lambda: "other")
    check("writer exit 1 + a state that is neither => OUTCOME_UNDETERMINED (no rollback claim)", r.outcome == "OUTCOME_UNDETERMINED" and r.exit_code == 5
          and "Do NOT assume it rolled back" in r.statement and "ROLLED BACK:" not in r.statement)

    r, _, _ = drive(launch=lambda: {"exit": 1}, probe=raising(ConnectionError("probe down")))
    check("writer exit 1 + probe unreadable => OUTCOME_UNDETERMINED (never ROLLED_BACK)", r.outcome == "OUTCOME_UNDETERMINED")

    for name, exc in (("timeout", subprocess.TimeoutExpired(["x"], 1)), ("interrupt", KeyboardInterrupt())):
        r, calls, _ = drive(launch=raising(exc), probe=lambda: "unchanged")
        check(f"writer {name} + probe proves pre-run state => ROLLED_BACK", r.outcome == "ROLLED_BACK" and calls.count("probe") == 1)
        r, _, _ = drive(launch=raising(exc), probe=lambda: "applied")
        check(f"writer {name} but the planned result is present => COMMITTED, verified", r.outcome == "COMMITTED_VERIFIED")
        r, _, _ = drive(launch=raising(exc), probe=raising(OSError("x")))
        check(f"writer {name} + unreadable state => OUTCOME_UNDETERMINED", r.outcome == "OUTCOME_UNDETERMINED")

    r, _, _ = drive(launch=lambda: {"exit": 0}, verify=lambda: [])
    check("record is written for every outcome except a refusal", bool(r.record_persisted))

    def bad_persist(_rec):
        raise FileExistsError("x")
    rr = c.run_apply(lambda: None, lambda: {"exit": 0}, lambda: "unchanged", lambda: [], bad_persist, at)
    check("a record that cannot be written never changes the outcome; its content is printed", rr.outcome == "COMMITTED_VERIFIED" and not rr.record_persisted
          and "the output record could not be written" in "\n".join(rr.lines()))


def load(rel: str, name: str):
    spec = importlib.util.spec_from_file_location(name, REPO / rel)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def sibling_state_classifier() -> None:
    try:
        sp = load("tools/v2/gap029-sibling-pair-production.py", "gap029_sp")
    except ModuleNotFoundError as exc:     # psycopg is required by the loader this tool imports
        print(f"skip sibling classifier ({exc})")
        return

    def row(key: str, batch: int = 1):
        return tuple(["fam", "Fam", 1, "A", "brother", 2, "B", "brother", "sibling", "brothers", "source", "ev", "m", 7, key, batch][:16])

    old = [row("siblings:x:001"), row("siblings:x:002")]
    new = row(sp.NEW_KEY, 99)
    plan = {"before": sp.digests(old), "importBatchesBefore": 5}
    check("sibling classify: baseline", sp.classify(plan, old, 5) == "unchanged")
    check("sibling classify: the reviewed pair added and every old row byte-identical", sp.classify(plan, old + [new], 6) == "applied")
    changed = [row("siblings:x:001", 2), old[1]]
    check("sibling classify: an old row's import_batch_id changed => other", sp.classify(plan, changed + [new], 6) == "other")
    check("sibling classify: a batch appeared but no row => other", sp.classify(plan, old, 6) == "other")
    check("sibling classify: a row removed => other", sp.classify(plan, old[:1], 5) == "other")


def tools_route_through_runner() -> None:
    for rel in ("tools/v2/gap029-draft-link-production.py", "tools/v2/gap029-sibling-pair-production.py"):
        src = (REPO / rel).read_text(encoding="utf-8")
        check(f"{rel} applies through run_apply", "run_apply(" in src)
        check(f"{rel} contains no restore / retry / reverse step", not re.search(r"pg_restore|createdb|dropdb|--clean\b|RESTORE REQUIRED|while True", src))
        check(f"{rel} offers the read-only state mode and the hash listing", 'choices=("plan", "apply", "state", "tool-hashes")' in src)
        check(f"{rel} refuses unassembled backup evidence in a production plan", "assembled_problem(" in src)
        check(f"{rel} bounds the writer with a timeout", "timeout=WRITER_TIMEOUT_SECONDS" in src)


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--verify-fixture":
        return verify_fixture(sys.argv[2])
    outcomes_and_writer_semantics()
    sibling_state_classifier()
    tools_route_through_runner()
    if FAILED:
        print(f"{len(FAILED)} check(s) FAILED")
        return 1
    print("All GAP-029 common checks hold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
