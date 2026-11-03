#!/usr/bin/env python3
"""V2-GAP-029 / owner decision D2: the production-bound DraftGuru link-only promotion, as a REPLACEMENT procedure for
tools/rebuild/draftguru/bridge_import_gate.py, which stays unmodified and keeps refusing production.

    plan      read-only; runs the gate's own link-only plan over the target; seals a target-bound, digest-pinned plan
    apply     needs the plan, an approval pinned to its digest, a clean HEAD at the reviewed revision, fresh backup + restore evidence;
              re-runs the plan, runs the importer's --link-only write, then the gate's own VERIFY against the plan's hashes
    (rehearsal only) apply --with-dry-run runs the importer's --dry-run first. A dry run RETAINS a failed audit batch, so it is a write
              to import_batches and is refused on any non-isolated target: no production dry run is authorised.

    python tools/v2/gap029-draft-link-production.py plan  --target T --child C --child-sha256 H --label L [--rehearsal | --backup B --backup-file F --restore-evidence R] --out O
    python tools/v2/gap029-draft-link-production.py apply --plan P [--rehearsal [--with-dry-run] | --approval A --backup-file F --restore-evidence R] --out O

WHY A REPLACEMENT, AND WHAT IT KEEPS. The gate's closed TARGETS list (test, dev) is its production refusal: "no PROD target exists and none
can be added by a command-line value". This tool does not edit, wrap, monkey-patch or call around that list; it never calls `resolve_dsn`,
`effective_config` or `main`. It imports the gate and the importer as LIBRARIES and calls `run_gate` -- the very function that holds the
checks -- with its own connection that carries the guards below. Every safeguard the gate documents is reproduced here, by name, and
`safeguards` in every plan records the check that carries it (the contract test pins this table against the gate's source):

  G1  closed target, exact database, re-checked after connecting   -> target.json identity proof (system id, OID, cluster, comment) + exact DSN host/port/db/user
  G2  read-only session, REPEATABLE READ, SELECT-only cursor        -> gate.open_read_only + gate.with_read_only (inside run_gate), asserted 'on' before any read
  G3  rollback and close unconditionally; nothing written to disk   -> gate.with_read_only; this tool writes only its own --out, outside the checkout, exclusively
  G4  DSN and credentials never printed                             -> no DSN is printed; failures name the class only
  G5  child sha256 pinned, kind 'deployment', schema 1, label       -> gate.load_child with a REQUIRED --child-sha256 and the exporter label 'isolated'
  G6  the test child can never be reused                            -> gate.refuse_test_child_under('dev', child) (bytes, name, label)
  G7  parent chain verified                                         -> gate.load_parent_map with the pinned v3 parent sha256
  G8  label proven against every stored identity note; no Stage A   -> gate link-only plan (explicit --label required) + imp.validate_link_only
  G9  write set is exactly the link columns, disjoint from others   -> gate link-only plan (set_clause_columns) + this tool compares imp.link_only_write_set() to the plan
  G10 modelled after-state differs from stored in nothing else      -> gate plan checks 6.x; this tool requires ZERO failures
  G11 verify re-reads the non-link digests (incl. import_batch_id)  -> gate VERIFY run against the plan's after/picks/newly-linked/baseline hashes + batches_before
  G12 deterministic                                                 -> the plan is re-run at apply time and every hash must equal the plan's

Properties added for production: one importer transaction (the importer's own); the target's backup baseline digest must equal the live
baseline; the approval pins plan digest, target, revision, child sha, label, expiry. A failed VERIFY after the importer commits cannot be undone by
this tool: it reports RESTORE REQUIRED (restore of the verified backup is the only recovery; there is no inverse).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote, urlparse

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "tools" / "rebuild" / "draftguru"))
sys.path.insert(0, str(REPO / "tools" / "migration"))
import bridge_import_gate as gate  # noqa: E402
import import_draftguru as imp  # noqa: E402

OPERATION = "gap029-draft-link-production"
CHILD_LABEL = "isolated"          # the exporter's label for a child resolved against a verified restore of the target
V3_PARENT_REL = gate.LINEAGES["v3"]["parent_rel"]
V3_PARENT_SHA = gate.LINEAGES["v3"]["expected_parent_sha256"]
MAX_AGE = timedelta(hours=24)
EXPECT_KEYS = ("after_state_sha256", "picks_after_sha256", "newly_linked_sha256", "baseline_sha256")

SAFEGUARDS = {
    "G1": "target identity proof + exact DSN", "G2": "read-only session via gate.open_read_only/with_read_only", "G3": "rollback and close; exclusive output outside checkout",
    "G4": "no DSN printed", "G5": "child sha pinned + label", "G6": "test child refused", "G7": "parent chain verified", "G8": "explicit label proven; no Stage A",
    "G9": "write set equals link columns", "G10": "zero gate failures", "G11": "gate verify against plan hashes", "G12": "plan re-run at apply must equal the plan",
}


class Refused(Exception):
    pass


def sha(b: bytes | str) -> str:
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def canon(v) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def fresh(s: str) -> bool:
    t = parse_iso(s)
    return t <= now() and now() - t <= MAX_AGE


def git(*a: str) -> str:
    return subprocess.run(["git", *a], cwd=REPO, check=True, capture_output=True, text=True).stdout.strip()


def outside(p: str) -> Path:
    path = Path(p).resolve()
    try:
        path.relative_to(REPO)
        raise Refused("evidence files must be outside the checkout")
    except ValueError:
        return path


def gate_still_refuses_production() -> dict:
    """The gate's own refusal, re-proven on every run (it is the reason this tool exists)."""
    ok = sorted(gate.TARGETS) == ["dev", "test"]
    for probe in (lambda: gate.resolve_dsn("prod"), lambda: gate.effective_config("prod", "v3"), lambda: gate.effective_config("production", "v3")):
        try:
            probe()
            ok = False
        except gate.GateError:
            pass
    if not ok:
        raise Refused("the gate no longer refuses a production target; this procedure must not run against an altered gate")
    return {"targets": sorted(gate.TARGETS), "productionRefused": True, "gateSha256": sha((REPO / "tools/rebuild/draftguru/bridge_import_gate.py").read_bytes())}


def dsn_matches(dsn: str, target: dict, exact_user: bool) -> None:
    u = urlparse(dsn or "")
    if u.scheme not in ("postgres", "postgresql") or u.query or u.fragment or u.hostname != target["host"] or (u.port or 5432) != target["port"] \
            or unquote(u.path.lstrip("/")) != target["database"] or (exact_user and unquote(u.username or "") != target["user"]):
        raise Refused("wrong target; no connection authorised")


def prove_identity(dsn: str, target: dict, writer: bool = False) -> None:
    """G1: the live database is the reviewed target, read through the gate's own read-only connection."""
    box: dict = {}

    def body(cur, settings):
        cur.execute("SELECT current_database(), current_user, c.system_identifier::text, d.oid::text, current_setting('cluster_name'), shobj_description(d.oid,'pg_database') "
                    "FROM pg_control_system() c CROSS JOIN pg_database d WHERE d.datname = current_database()")
        box["row"] = cur.fetchone()
        return None
    gate.with_read_only(lambda: gate.open_read_only(dsn), body, target["database"])
    database, user, system_id, oid, cluster, comment = box["row"]
    if writer and user != "afldb_import":
        raise Refused("the write connection must be the afldb_import role")
    if (database, system_id, oid, cluster, comment) != (target["database"], target["systemIdentifier"], target["databaseOid"], target["clusterName"], target["databaseComment"]) \
            or (not writer and user != target["user"]):
        raise Refused("live database identity differs from the reviewed target")


def load_inputs(child: str, child_sha: str, label: str):
    child_path = Path(child).resolve()
    gate.refuse_test_child_under("dev", child_path)                                   # G6
    doc, digest = gate.load_child(child_path, child_sha, None, expect_child_target=CHILD_LABEL)   # G5
    parent_map = gate.load_parent_map(REPO / V3_PARENT_REL, doc, V3_PARENT_SHA)         # G7
    prepared = imp.validate_link_only(SimpleNamespace(label=label, snapshot_root=None, bridge=str(child_path)))   # G8
    return child_path, doc, digest, parent_map, prepared


def run_gate_mode(mode: str, dsn: str, target: dict, child: str, child_sha: str, label: str, expect: dict | None = None) -> dict:
    child_path, doc, digest, parent_map, prepared = load_inputs(child, child_sha, label)
    lines: list[str] = []
    summary = gate.run_gate(mode, prepared, doc, digest, parent_map, label, lambda: gate.open_read_only(dsn), expect=expect or {},
                            required_database=target["database"], link_only=True, emit=lines.append)
    if summary["failures"]:
        raise Refused(f"the gate's {mode} refused: {len(summary['failures'])} check(s) failed: {summary['failures'][:3]}")   # G10
    write_set = {t: list(c) for t, c in imp.link_only_write_set().items()}
    if summary.get("link_only_write_set") != write_set:
        raise Refused("the modelled write set differs from the importer's link-only write set")                          # G9
    return summary


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("plan", "apply"))
    for flag in ("--target", "--child", "--child-sha256", "--label", "--backup", "--backup-file", "--restore-evidence", "--plan", "--approval", "--out"):
        ap.add_argument(flag)
    ap.add_argument("--rehearsal", action="store_true")
    ap.add_argument("--with-dry-run", action="store_true")
    a = ap.parse_args(argv)
    try:
        out = outside(a.out)
        if out.exists():
            raise Refused("output already exists; preserve evidence and choose another path")
        revision = git("rev-parse", "HEAD")
        if subprocess.run(["git", "diff", "--quiet"], cwd=REPO).returncode or subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO).returncode:
            raise Refused("tracked working tree is not clean")
        refusal = gate_still_refuses_production()
        plan0 = json.loads(outside(a.plan).read_text()) if a.mode == "apply" else None
        rehearsal = plan0["rehearsal"] if plan0 else a.rehearsal
        if a.rehearsal and plan0 and not plan0["rehearsal"]:
            raise Refused("the plan is not a rehearsal plan")
        target = plan0["target"] if plan0 else json.loads(outside(a.target).read_text())
        if rehearsal and not re.fullmatch(r"afldb_v2_[a-z0-9_]+_test", target["database"]):
            raise Refused("a rehearsal is only for an isolated afldb_v2_*_test database")
        if not rehearsal and re.fullmatch(r"afldb_v2_.*_test", target["database"]):
            raise Refused("an isolated clone is rehearsed with --rehearsal")
        if a.with_dry_run and not rehearsal:
            raise Refused("no production dry run is authorised: the importer's dry run retains a failed audit batch (a write to import_batches)")
        dsn = os.environ.get("AFLDB_GAP029_DSN", "")
        dsn_matches(dsn, target, True)
        prove_identity(dsn, target)
        child_sha = (plan0 or {}).get("childSha256") or a.child_sha256
        label = (plan0 or {}).get("label") or a.label
        child = (plan0 or {}).get("childPath") or a.child
        if not (child and child_sha and label):
            raise Refused("--child, --child-sha256 and an explicit --label are required")
        t = now()
        if a.mode == "plan":
            backup = None
            if not rehearsal:
                backup = json.loads(outside(a.backup).read_text())
                if backup["target"] != target or not fresh(backup["capturedAt"]) or not fresh(backup["restoredAt"]) or parse_iso(backup["restoredAt"]) < parse_iso(backup["capturedAt"]):
                    raise Refused("fresh target-bound backup and verified restore evidence required")
                if sha(outside(a.backup_file).read_bytes()) != backup["sha256"] or sha(outside(a.restore_evidence).read_bytes()) != backup["restoreEvidenceSha256"]:
                    raise Refused("backup or restore evidence content differs")
            summary = run_gate_mode("plan", dsn, target, child, child_sha, label)
            if backup and {k: summary[k] for k in EXPECT_KEYS} != backup.get("draftLinkRestorePlanExpect"):
                raise Refused("the plan run against the verified restore (draftLinkRestorePlanExpect) does not equal the live target's plan: baseline drift or an unverified restore")
            body = {"operation": OPERATION, "revision": revision, "target": target, "rehearsal": rehearsal, "childPath": str(Path(child).resolve()), "childSha256": child_sha,
                    "label": label, "parentSha256": V3_PARENT_SHA, "gate": refusal, "importerSha256": sha((REPO / "tools/rebuild/draftguru/import_draftguru.py").read_bytes()),
                    "writeSet": summary["link_only_write_set"], "expect": {k: summary[k] for k in EXPECT_KEYS}, "batchesBefore": summary["import_batches_before"],
                    "gateSummarySha256": summary["summary_sha256"], "counts": summary.get("counts"), "safeguards": SAFEGUARDS, "backup": backup,
                    "createdAt": iso(t), "expiresAt": iso(t + MAX_AGE)}
            plan = {**body, "digest": sha(canon(body))}
            out.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
            print(f"Review plan {plan['digest']}; gate plan clean; no writes; expecting after-state {summary['after_state_sha256'][:16]}")
            return 0
        plan = plan0
        body = {k: v for k, v in plan.items() if k != "digest"}
        if plan["digest"] != sha(canon(body)) or plan["operation"] != OPERATION or plan["revision"] != revision or not parse_iso(plan["expiresAt"]) > t:
            raise Refused("plan digest, operation, revision or expiry differs")
        if sha((REPO / "tools/rebuild/draftguru/import_draftguru.py").read_bytes()) != plan["importerSha256"] or refusal["gateSha256"] != plan["gate"]["gateSha256"]:
            raise Refused("the importer or the gate differs from the reviewed bytes")
        if not rehearsal:
            ap_ = json.loads(outside(a.approval).read_text())
            pb = plan["backup"]
            if not pb or ap_["planDigest"] != plan["digest"] or ap_["operation"] != OPERATION or ap_["target"] != plan["target"] or ap_["revision"] != revision \
                    or ap_["childSha256"] != plan["childSha256"] or ap_["label"] != plan["label"] or not parse_iso(ap_["expiresAt"]) > t \
                    or parse_iso(ap_["expiresAt"]) > parse_iso(plan["expiresAt"]) or not parse_iso(ap_["approvedAt"]) <= t or not str(ap_.get("reference", "")).strip():
                raise Refused("stale plan or missing execution approval")
            if not fresh(pb["capturedAt"]) or not fresh(pb["restoredAt"]) or sha(outside(a.backup_file).read_bytes()) != pb["sha256"] \
                    or sha(outside(a.restore_evidence).read_bytes()) != pb["restoreEvidenceSha256"]:
                raise Refused("backup no longer fresh or its evidence differs")
        wdsn = os.environ.get("AFLDB_GAP029_WRITE_DSN", "")
        dsn_matches(wdsn, target, False)
        prove_identity(wdsn, target, writer=True)
        # G12: the live state must still produce exactly the reviewed plan
        again = run_gate_mode("plan", dsn, target, plan["childPath"], plan["childSha256"], plan["label"])
        if {k: again[k] for k in EXPECT_KEYS} != plan["expect"] or again["import_batches_before"] != plan["batchesBefore"]:
            raise Refused("baseline drift; re-plan and obtain new execution approval")
        base = [sys.executable, str(REPO / "tools/rebuild/draftguru/import_draftguru.py"), "--link-only", "--no-seed", "--label", plan["label"], "--bridge", plan["childPath"]]
        env = {**os.environ, "AFLDB_IMPORT_DATABASE_URL": wdsn}
        run = lambda extra: subprocess.run([*base, *extra], cwd=REPO, env=env, capture_output=True, text=True)
        v = run(["--validate-only"])
        if v.returncode:
            raise Refused("the importer's validate-only refused; nothing written")
        record: dict = {"planDigest": plan["digest"], "at": iso(now())}
        if a.with_dry_run:
            d = run(["--dry-run"])
            record["dryRun"] = {"exit": d.returncode, "note": "retains one failed audit batch by design; rehearsal only"}
            if d.returncode:
                raise Refused("the importer's dry run refused")
        applied = run([])
        record["importerExit"] = applied.returncode
        if applied.returncode:
            raise Refused("the importer refused or failed; inspect the target (its own transaction rolled back); restore is the recovery if rows differ")
        expect = {**plan["expect"], "batches_before": plan["batchesBefore"] + (1 if a.with_dry_run else 0)}
        try:
            run_gate_mode("verify", dsn, target, plan["childPath"], plan["childSha256"], plan["label"], expect)           # G11
            record["verify"] = "PASS"
        except Refused as exc:
            record["verify"] = f"FAIL: {exc}"
            out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            print("RESTORE REQUIRED: the importer committed but the gate's verify refused. Stop; restore the verified backup; do not retry.")
            return 1
        out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        print("Committed link-only promotion; gate verify PASS; review restricted output")
        return 0
    except (Refused, gate.GateError, imp.ImportFailure) as exc:
        print(f"GAP-029 draft-link refused: {exc if isinstance(exc, Refused) else type(exc).__name__ + ' ' + str(exc)[:200]}")
        return 1
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"GAP-029 draft-link refused: unreadable or malformed input ({type(exc).__name__})")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
