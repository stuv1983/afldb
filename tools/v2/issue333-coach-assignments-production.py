#!/usr/bin/env python3
"""AFLDB-ISSUE-333 / owner decision O1: the guarded production entry point for the 436 missing 2026 coach assignments, through the NARROWLY
ADDITIVE writer `tools/migration/add_match_coaches_2026.py` (the broad importer `import_match_coaches.py` is not run and not modified).

    plan       read-only (server-side read-only REPEATABLE READ session AND a SELECT-only cursor; no temp table): stages the hash-pinned core.tar
               FRESHLY into a new exclusive directory, folds the source, proves exactly the 436 additions and the full-row baseline; seals a plan.
               This is the production dry run. No importer dry run exists for production.
    apply      needs the plan, an approval pinned to its digest, a clean checkout at the reviewed revision, the same tool bytes, fresh machine-
               assembled backup + restore evidence whose operation digests equal the live ones; re-plans (read-only) and must get the same facts;
               then runs the writer (one transaction it controls; see its docstring) and classifies the outcome with an independent read-only probe.
    state      read-only: BASELINE / PLANNED RESULT PRESENT / OTHER (use it after any non-zero apply, and for the uncertain-outcome case).
    tool-hashes  read-only: the LF-normalised sha256 of every file whose bytes decide what a plan means (what the assembler binds evidence to).

    python tools/v2/issue333-coach-assignments-production.py plan  --target T --core-tar C --staging-dir S [--rehearsal | --backup B --backup-file F --restore-evidence R] --out O
    python tools/v2/issue333-coach-assignments-production.py apply --plan P [--rehearsal | --approval A --backup-file F --restore-evidence R] --out O
    python tools/v2/issue333-coach-assignments-production.py state --plan P --out O

  AFLDB_GAP029_DSN        the read-only plan/probe connection (exact host, port, database, user of the target file)
  AFLDB_GAP029_WRITE_DSN  the writer connection (afldb_import, same host/port/database)

BACKUP BINDING. A production plan requires backup evidence MACHINE-ASSEMBLED (gap029-assemble-restore-evidence.ts, stage I333) from a restore of a fresh
production backup verified off production. The restored copy's operation digest (full rows of match_coaches and coaches, the 2026 match identities,
coach data_overrides, the trigger inventory) and planned new-row digest must EQUAL the live target's; every import_batches row the backup holds must
be byte-identical live (rows appended since by other tools, e.g. the nightly settle, are disclosed in the plan, never assumed).

NIGHTLY SETTLE. The AFL API timer fires 05:00 + up to 15 min (Persistent). A batch it lands after the plan is baseline drift: the apply refuses and a new
read-only plan + new approval are needed (the backup stays valid while fresh). An apply never starts between 04:15 and 05:30 host time (Australia/Melbourne).

OUTCOMES (gap029_common.py). REFUSED_BEFORE_MUTATION (1), ROLLED_BACK (2), COMMITTED_VERIFIED / NOTHING_WRITTEN (0), COMMITTED_VERIFICATION_FAILED (3),
COMMITTED_VERIFICATION_UNAVAILABLE (4), OUTCOME_UNDETERMINED (5). The writer's exit code is never evidence; only the read-only probe decides. A second apply
of an applied plan is REFUSED_BEFORE_MUTATION (its re-plan no longer finds 436 additions).

COMMITTED-STATE RECOVERY LIMIT. After a committed outcome this tool does not retry, reverse or restore. Restoring the verified backup would discard every
write made after it was taken and is a separate OWNER decision.
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
import add_match_coaches_2026 as w  # noqa: E402  (tools/migration is on sys.path via the draft-link module)
import issue333_o2_common as oc  # noqa: E402

Refused = dl.Refused
OPERATION = "issue333-coach-assignments"
STAGE = "I333"
TOOL_REL = "tools/v2/issue333-coach-assignments-production.py"
WRITER_REL = "tools/migration/add_match_coaches_2026.py"
WRITER_TIMEOUT_SECONDS = 900
BOUND_FILES = (TOOL_REL, WRITER_REL, "tools/v2/issue333_o2_common.py", "tools/v2/gap029_common.py", "tools/v2/gap029-draft-link-production.py",
               "tools/rebuild/draftguru/bridge_import_gate.py", "tools/migration/import_match_coaches.py", "tools/migration/import_fitzroy_core.py",
               "tools/migration/enrich_heights.py", "tools/migration/common.py", "tools/rebuild/afltables/coach_snapshot_parser.py",
               "tools/rebuild/afltables/afltables-contract.json", "tools/rebuild/fitzroy/fitzroy-contract.json", "data/reference/clubs.json",
               "docs/rebuild-manifests/afltables_fitzroy_core/c2-2026-final-core-v1.json", "docs/rebuild-manifests/afltables_coaches/coaches-20260905.json",
               "data/sources/afltables/coaches/coaches-20260905/parsed/coaches_index.csv", "data/sources/afltables/coaches/coaches-20260905/parsed/coach_pages.csv")
STAGE_KEYS = ("baselineDigest", "i333OperationDigest", "i333NewRowsDigest", "i333ImportBatches")


def tool_hashes() -> dict:
    return {rel: dl.lf_sha256(rel) for rel in BOUND_FILES}


def assembled_problem(backup: dict, target: dict, revision: str, t) -> str | None:
    return dl.common.assembly_problem(backup, operation=OPERATION, stage=STAGE, revision=revision, now=t, target=target, tool_sha256=tool_hashes(),
                                      stage_fields={k: backup.get(k) for k in STAGE_KEYS}, inputs={"coreTarSha256": w.CORE_TAR_SHA256})


def approval_problem(ap_: dict, plan: dict, revision: str, t) -> str | None:
    """The owner's approval.json must pin this plan's digest, operation, target, revision and package, be inside its own and the plan's expiry, and
    name a reference. Any missing or different field refuses."""
    try:
        if ap_["planDigest"] != plan["digest"] or ap_["operation"] != OPERATION or ap_["target"] != plan["target"] or ap_["revision"] != revision:
            return "the approval names another plan, operation, target or revision"
        if ap_["coreTarSha256"] != w.CORE_TAR_SHA256:
            return "the approval names another source package"
        if not parse_iso(ap_["expiresAt"]) > t or parse_iso(ap_["expiresAt"]) > parse_iso(plan["expiresAt"]) or not parse_iso(ap_["approvedAt"]) <= t:
            return "the approval is expired, outlives the plan, or is dated in the future"
        if not str(ap_.get("reference", "")).strip():
            return "the approval names no reference"
    except (KeyError, TypeError, ValueError):
        return "the approval is malformed"
    return None


def read_live(dsn: str, target: dict) -> tuple[dict, dict]:
    """One read-only REPEATABLE READ snapshot through a SELECT-only cursor. Returns (state, session proof)."""
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
    """pids of live writer backends (afldb_import, the writer's application_name, this database), in a FRESH read-only session each call
    (pg_stat_activity is a per-transaction snapshot). Review F-001."""
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
    """Never classify while a writer backend is live: a killed writer's COMMIT may still be in flight. Raises after `seconds`."""
    import time
    end = time.monotonic() + seconds
    while True:
        pids = live_writers(dsn, target)
        if not pids:
            return
        if time.monotonic() > end:
            raise RuntimeError(f"a writer backend is still live after {seconds:.0f} s (pids {pids}); its outcome cannot be classified yet")
        time.sleep(1)


def plan_facts(dsn: str, target: dict, staging_path: Path) -> tuple[dict, dict]:
    staging = w.verify_staging(staging_path)
    src = w.read_source(staging_path)
    state, session = read_live(dsn, target)
    f = w.facts(src, state)
    f["staging"] = staging
    f["source"] = {k: v for k, v in src.items() if k not in ("assignments", "names")}
    return f, {"session": session, "state": state}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("plan", "apply", "state", "tool-hashes"))
    for flag in ("--target", "--core-tar", "--staging-dir", "--backup", "--backup-file", "--restore-evidence", "--plan", "--approval", "--out"):
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
            if not (a.core_tar and a.staging_dir):
                raise Refused("--core-tar and --staging-dir are required")
            backup = None
            if not rehearsal:
                backup = dl.read_backup(a, target, t)
                problem = assembled_problem(backup, target, revision, t)
                if problem:
                    raise Refused(problem)
            staging_path = outside(a.staging_dir)
            staged = w.stage_core(outside(a.core_tar), staging_path)           # fresh, exclusive, file-by-file verified
            f, extra = plan_facts(dsn, target, staging_path)
            if f["staging"] != staged:
                raise Refused("the staging directory changed between extraction and planning")
            live_triggers = [x[:2] for x in f["baseline"]["operation"]["triggers"]]
            if not rehearsal and live_triggers != w.ALLOWED_TRIGGERS:
                raise Refused(f"the trigger inventory on the touched tables is not the reviewed one: {live_triggers}")
            appended = []
            if backup:
                bib = backup.get("i333ImportBatches") or {}
                if f["baseline"]["operationDigest"] != backup.get("i333OperationDigest") or f["newRows"]["digest"] != backup.get("i333NewRowsDigest"):
                    raise Refused("baseline drift: the verified restore's operation digest or new-row digest does not equal the live target's")
                max_id = int(bib.get("maxId", -1))
                if w.import_batches_prefix_digest(extra["state"], max_id) != bib.get("fullRowDigest") \
                        or sum(1 for r in extra["state"]["importBatches"] if int(r[0]) <= max_id) != bib.get("rows"):
                    raise Refused("an import_batches row the backup holds differs live (not an append): take a fresh restore-verified backup")
                appended = [[int(r[0]), r[2], r[6]] for r in extra["state"]["importBatches"] if int(r[0]) > max_id]
                if any(r[1] == w.TOOL for r in appended):
                    raise Refused("this tool's batch already exists after the backup")
            body = {"operation": OPERATION, "revision": revision, "target": target, "rehearsal": rehearsal, **f,
                    "readSession": extra["session"], "importBatchesAppendedSinceBackup": appended, "toolSha256": tool_hashes(),
                    "coreTar": {"path": str(outside(a.core_tar)), "sha256": w.CORE_TAR_SHA256}, "backup": backup,
                    "noApplyWindowHostLocal": "04:15-05:30 Australia/Melbourne", "createdAt": iso(t), "expiresAt": iso(t + dl.MAX_AGE)}
            plan = {**body, "digest": sha(canon(body))}
            dl.write_exclusive(out, plan)
            nr = f["newRows"]
            print(f"Review plan {plan['digest']}; no writes (read-only session, SELECT-only cursor); {nr['count']} new assignments over {nr['matches']} matches; "
                  f"operation digest {f['baseline']['operationDigest'][:16]}; new rows {nr['digest'][:16]}; batches appended since backup {len(appended)}")
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
            label = {"unchanged": "BASELINE (the plan has not been applied)", "applied": "PLANNED RESULT PRESENT (exactly the reviewed 436 assignments were added)",
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
                raise Refused("a bound tool or source file differs from the reviewed bytes")
            if w.file_sha256(Path(plan["coreTar"]["path"])) != w.CORE_TAR_SHA256:
                raise Refused("core.tar differs from the reviewed bytes")
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
            again, _ = plan_facts(dsn, target, Path(plan["staging"]["path"]))
            if again["baseline"] != plan["baseline"] or again["newRows"] != plan["newRows"] or again["staging"] != plan["staging"]:
                raise Refused("baseline drift (or a changed staging directory); re-plan and obtain new execution approval")

        def launch():
            r = dl.run_logged([sys.executable, str(REPO / WRITER_REL), "apply", "--plan", str(plan_path)], out=out, tag="writer",
                              cwd=REPO, env={**os.environ, "AFLDB_IMPORT_DATABASE_URL": wdsn, "AFLDB_ISSUE333_PLAN_DIGEST": plan["digest"]},
                              timeout=WRITER_TIMEOUT_SECONDS)
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
        print(f"OUTCOME REFUSED_BEFORE_MUTATION (exit 1)\nISSUE-333 refused: {exc if isinstance(exc, (Refused, oc.Refused)) else type(exc).__name__ + ' ' + str(exc)[:200]}")
        return 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"OUTCOME REFUSED_BEFORE_MUTATION (exit 1)\nISSUE-333 refused: unreadable or malformed input ({type(exc).__name__})")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
