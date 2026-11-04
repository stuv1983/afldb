#!/usr/bin/env python3
"""Owner decision O2: the guarded production entry point that resolves EXACTLY the 36 converged `canonical_apply_failed` findings (data_issues ids
41-76) through the narrow writer `tools/v2/o2_converged_findings.py` (one transaction; see its docstring for the comparison and the write).

    plan       read-only (read-only REPEATABLE READ session, SELECT-only cursor, no temp table): pins the 36 rows in every column, their canonical and
               staged rows, the 53-field comparison (all must be equal) and the rest of data_issues; seals a plan carrying the restorable pre-image.
    apply      needs the plan, an approval pinned to its digest, a clean checkout at the reviewed revision, the same tool bytes, fresh machine-assembled
               backup + restore evidence (stage O2) whose operation digest equals the live one; re-plans and must get the same facts; runs the writer
               and classifies the outcome with an independent read-only probe.
    state      read-only: BASELINE / PLANNED RESULT PRESENT / OTHER.
    tool-hashes  read-only.

    python tools/v2/o2-converged-findings-production.py plan  --target T [--rehearsal | --backup B --backup-file F --restore-evidence R] --out O
    python tools/v2/o2-converged-findings-production.py apply --plan P [--rehearsal | --approval A --backup-file F --restore-evidence R] --out O
    python tools/v2/o2-converged-findings-production.py state --plan P --out O

RECOVERY. Nothing is reversed automatically. The plan carries the exact pre-image of the 36 rows (resolved_at and resolution NULL). Re-opening them is a
separate owner decision (an UPDATE of those ids setting resolved_at = NULL, resolution = NULL), and it is BLOCKED by uq_data_issues_open_by_key for any key
whose finding a later settle has re-opened as a NEW row in the meantime. Resolving does not prevent a future settle from opening a fresh row for a key.

OUTCOMES as gap029_common.py; the writer's exit code is never evidence; only the read-only probe decides. A second apply is REFUSED_BEFORE_MUTATION.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("gap029_dl", REPO / "tools" / "v2" / "gap029-draft-link-production.py")
dl = importlib.util.module_from_spec(_spec)
sys.modules["gap029_dl"] = dl
_spec.loader.exec_module(dl)
gate, sha, canon, iso, parse_iso, fresh, outside, now = dl.gate, dl.sha, dl.canon, dl.iso, dl.parse_iso, dl.fresh, dl.outside, dl.now
import o2_converged_findings as w  # noqa: E402  (tools/v2 is on sys.path via the draft-link module)
import issue333_o2_common as oc  # noqa: E402

Refused = dl.Refused
OPERATION = w.OPERATION
STAGE = "O2"
TOOL_REL = "tools/v2/o2-converged-findings-production.py"
WRITER_REL = "tools/v2/o2_converged_findings.py"
WRITER_TIMEOUT_SECONDS = 600
BOUND_FILES = (TOOL_REL, WRITER_REL, "tools/v2/issue333_o2_common.py", "tools/v2/gap029_common.py", "tools/v2/gap029-draft-link-production.py",
               "tools/rebuild/draftguru/bridge_import_gate.py")
STAGE_KEYS = ("baselineDigest", "o2OperationDigest", "o2ComparisonDigest", "o2Others")


def tool_hashes() -> dict:
    return {rel: dl.lf_sha256(rel) for rel in BOUND_FILES}


def assembled_problem(backup: dict, target: dict, revision: str, t) -> str | None:
    return dl.common.assembly_problem(backup, operation=OPERATION, stage=STAGE, revision=revision, now=t, target=target, tool_sha256=tool_hashes(),
                                      stage_fields={k: backup.get(k) for k in STAGE_KEYS})


def approval_problem(ap_: dict, plan: dict, revision: str, t) -> str | None:
    """The owner's approval.json must pin this plan's digest, operation, target, revision, the 36 ids and the resolution value, be inside its own and
    the plan's expiry, and name a reference."""
    try:
        if ap_["planDigest"] != plan["digest"] or ap_["operation"] != OPERATION or ap_["target"] != plan["target"] or ap_["revision"] != revision:
            return "the approval names another plan, operation, target or revision"
        if ap_["resolution"] != w.RESOLUTION or ap_["ids"] != w.IDS:
            return "the approval names another resolution or other ids"
        if not parse_iso(ap_["expiresAt"]) > t or parse_iso(ap_["expiresAt"]) > parse_iso(plan["expiresAt"]) or not parse_iso(ap_["approvedAt"]) <= t:
            return "the approval is expired, outlives the plan, or is dated in the future"
        if not str(ap_.get("reference", "")).strip():
            return "the approval names no reference"
    except (KeyError, TypeError, ValueError):
        return "the approval is malformed"
    return None


def read_live(dsn: str, target: dict) -> tuple[dict, dict]:
    conn = gate.open_read_only(dsn)
    try:
        with conn.cursor() as raw:
            cur = gate.SelectOnlyCursor(raw)
            session = gate.assert_read_only(cur, target["database"])
            state = w.read_state(cur)
            cur.execute("SELECT pg_my_temp_schema()::oid::bigint, current_setting('transaction_isolation'), current_setting('track_counts'), "
                        "current_setting('server_version_num')")
            temp_schema, isolation, track_counts, version = cur.fetchone()
            if int(temp_schema) != 0:
                raise Refused("the read session created a temporary schema")
            if track_counts != "on":
                raise Refused("track_counts is off: the writer's in-transaction write accounting would be blind (review F-004)")
            session.update({"temporarySchema": "none", "isolation": isolation, "selectOnlyCursor": True, "trackCounts": track_counts, "serverVersionNum": version})
        return state, session
    finally:
        conn.rollback()
        conn.close()


def live_writers(dsn: str, target: dict) -> list[int]:
    """pids of live O2 writer backends, in a FRESH read-only session each call (pg_stat_activity is a per-transaction snapshot). Review F-001."""
    conn = gate.open_read_only(dsn)
    try:
        with conn.cursor() as raw:
            cur = gate.SelectOnlyCursor(raw)
            gate.assert_read_only(cur, target["database"])
            cur.execute(oc.LIVE_WRITER_SQL, (w.APP_NAME,))
            return [int(r[0]) for r in cur.fetchall()]
    finally:
        conn.rollback()
        conn.close()


def await_no_live_writer(dsn: str, target: dict, seconds: float = oc.LIVE_WRITER_WAIT_SECONDS) -> None:
    import time
    end = time.monotonic() + seconds
    while True:
        pids = live_writers(dsn, target)
        if not pids:
            return
        if time.monotonic() > end:
            raise RuntimeError(f"a writer backend is still live after {seconds:.0f} s (pids {pids}); its outcome cannot be classified yet")
        time.sleep(1)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("plan", "apply", "state", "tool-hashes"))
    for flag in ("--target", "--backup", "--backup-file", "--restore-evidence", "--plan", "--approval", "--out"):
        ap.add_argument(flag)
    ap.add_argument("--rehearsal", action="store_true")
    a = ap.parse_args(argv)
    if a.mode == "tool-hashes":
        print(json.dumps(tool_hashes(), sort_keys=True))
        return 0
    try:
        out = outside(a.out)
        if out.exists():
            raise Refused("output already exists; preserve evidence and choose another path")
        revision = dl.git("rev-parse", "HEAD")
        if subprocess.run(["git", "diff", "--quiet"], cwd=REPO).returncode or subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO).returncode:
            raise Refused("tracked working tree is not clean")
        plan_path = outside(a.plan) if a.mode in ("apply", "state") else None
        plan0 = json.loads(plan_path.read_text()) if plan_path else None
        rehearsal = plan0["rehearsal"] if plan0 else a.rehearsal
        if a.rehearsal and plan0 and not plan0["rehearsal"]:
            raise Refused("the plan is not a rehearsal plan")
        target = plan0["target"] if plan0 else json.loads(outside(a.target).read_text())
        if rehearsal and not re.fullmatch(r"afldb_v2_[a-z0-9_]+_test", target["database"]):
            raise Refused("a rehearsal is only for an isolated afldb_v2_*_test database")
        if not rehearsal and re.fullmatch(r"afldb_v2_.*_test", target["database"]):
            raise Refused("an isolated clone is rehearsed with --rehearsal")
        dsn = os.environ.get("AFLDB_GAP029_DSN", "")
        dl.dsn_matches(dsn, target, True)
        dl.prove_identity(dsn, target)
        t = now()
        if a.mode == "plan":
            backup = None
            if not rehearsal:
                backup = dl.read_backup(a, target, t)
                problem = assembled_problem(backup, target, revision, t)
                if problem:
                    raise Refused(problem)
            state, session = read_live(dsn, target)
            f = w.facts(state)
            if not rehearsal and f["baseline"]["operation"]["triggers"]:
                raise Refused(f"data_issues carries triggers the review did not see: {[x[:2] for x in f['baseline']['operation']['triggers']]}")
            appended = []
            if backup:
                bo = backup.get("o2Others") or {}
                if f["baseline"]["operationDigest"] != backup.get("o2OperationDigest") or w.oc.rows_digest(f["comparison"]) != backup.get("o2ComparisonDigest"):
                    raise Refused("baseline drift: the verified restore's operation or comparison digest does not equal the live target's")
                max_id = int(bo.get("maxId", -1))
                if w.others_prefix_digest(state, max_id) != bo.get("fullRowDigest") or sum(1 for r in state["others"] if int(r[0]) <= max_id) != bo.get("rows"):
                    raise Refused("another data_issues row the backup holds differs live: take a fresh restore-verified backup")
                appended = [[int(r[0]), r[3]] for r in state["others"] if int(r[0]) > max_id]
            body = {"operation": OPERATION, "revision": revision, "target": target, "rehearsal": rehearsal, **f, "readSession": session,
                    "otherFindingsAppendedSinceBackup": appended, "resolution": w.RESOLUTION, "ids": w.IDS, "toolSha256": tool_hashes(), "backup": backup,
                    "noApplyWindowHostLocal": "04:15-05:30 Australia/Melbourne", "createdAt": iso(t), "expiresAt": iso(t + dl.MAX_AGE)}
            plan = {**body, "digest": sha(canon(body))}
            dl.write_exclusive(out, plan)
            op = f["baseline"]["operation"]
            print(f"Review plan {plan['digest']}; no writes; {op['targets']['rows']} findings, {op['comparison']['equal']} of {op['comparison']['entries']} "
                  f"flagged fields equal; operation digest {f['baseline']['operationDigest'][:16]}; other findings appended since backup {len(appended)}")
            return 0
        plan = plan0
        body = {k: v for k, v in plan.items() if k != "digest"}
        if plan["digest"] != sha(canon(body)) or plan["operation"] != OPERATION or plan["revision"] != revision:
            raise Refused("plan digest, operation or revision differs")
        if a.mode == "state":
            live = live_writers(dsn, target)
            if live:
                dl.write_exclusive(out, {"planDigest": plan["digest"], "state": "UNDETERMINED (a writer session is still live)", "liveWriterPids": live, "checkedAt": iso(now())})
                print(f"STATE UNDETERMINED: a writer session is still live (pids {live}); its COMMIT may be in flight. Re-run state when it has gone.")
                return 6
            state, _ = read_live(dsn, target)
            seen, problems = w.classify(plan, state)
            label = {"unchanged": "BASELINE (the plan has not been applied)", "applied": "PLANNED RESULT PRESENT (exactly the 36 findings are resolved)",
                     "other": "OTHER (neither the plan baseline nor the planned result)"}[seen]
            dl.write_exclusive(out, {"planDigest": plan["digest"], "state": label, "problems": problems, "checkedAt": iso(now())})
            print(f"STATE {label}")
            for p in problems:
                print(f"  {p}")
            return 0 if seen != "other" else 6
        wdsn = os.environ.get("AFLDB_GAP029_WRITE_DSN", "")

        def preflight():
            tt = now()
            if not parse_iso(plan["expiresAt"]) > tt:
                raise Refused("plan expired")
            if not rehearsal and oc.in_no_apply_window(tt):
                raise Refused("inside the 04:15-05:30 host-time no-apply window around the nightly timers")
            if tool_hashes() != plan["toolSha256"]:
                raise Refused("a bound tool file differs from the reviewed bytes")
            if not rehearsal:
                pb = plan["backup"]
                if not pb or approval_problem(json.loads(outside(a.approval).read_text()), plan, revision, tt):
                    raise Refused("stale plan or missing execution approval")
                if not fresh(pb["capturedAt"]) or not fresh(pb["restoredAt"]) or sha(outside(a.backup_file).read_bytes()) != pb["sha256"] \
                        or sha(outside(a.restore_evidence).read_bytes()) != pb["restoreEvidenceSha256"]:
                    raise Refused("backup no longer fresh or its evidence differs")
                problem = assembled_problem(pb, plan["target"], revision, tt)
                if problem:
                    raise Refused(problem)
            dl.dsn_matches(wdsn, target, False)
            dl.prove_identity(wdsn, target, writer=True)
            if live_writers(dsn, target):
                raise Refused("another writer session of this operation is live")
            state, _ = read_live(dsn, target)
            again = w.facts(state)
            if again["baseline"] != plan["baseline"] or again["comparison"] != plan["comparison"] or again["preImage"] != plan["preImage"]:
                raise Refused("baseline drift; re-plan and obtain new execution approval")

        def launch():
            r = dl.run_logged([sys.executable, str(REPO / WRITER_REL), "apply", "--plan", str(plan_path)], out=out, tag="writer", cwd=REPO,
                              env={**os.environ, "AFLDB_IMPORT_DATABASE_URL": wdsn, "AFLDB_O2_PLAN_DIGEST": plan["digest"]}, timeout=WRITER_TIMEOUT_SECONDS)
            return {"exit": r.returncode, "writerExit": r.returncode, "writerSaid": (r.stdout or "").strip().splitlines()[-1:]}

        def probe():
            await_no_live_writer(dsn, target)         # raises => unreadable => OUTCOME_UNDETERMINED (never a false ROLLED_BACK)
            state, _ = read_live(dsn, target)
            return w.classify(plan, state)[0]

        def verify():
            await_no_live_writer(dsn, target)
            state, _ = read_live(dsn, target)
            seen, problems = w.classify(plan, state)
            return [] if seen == "applied" else (problems or [f"the committed state classifies as {seen}"])

        report = dl.common.run_apply(preflight, launch, probe, verify, lambda rec: dl.write_exclusive(out, {"planDigest": plan["digest"], **rec}), lambda: iso(now()))
        for line in report.lines():
            print(line)
        return report.exit_code
    except (Refused, oc.Refused, gate.GateError) as exc:
        print(f"OUTCOME REFUSED_BEFORE_MUTATION (exit 1)\nO2 refused: {exc if isinstance(exc, (Refused, oc.Refused)) else type(exc).__name__ + ' ' + str(exc)[:200]}")
        return 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"OUTCOME REFUSED_BEFORE_MUTATION (exit 1)\nO2 refused: unreadable or malformed input ({type(exc).__name__})")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
