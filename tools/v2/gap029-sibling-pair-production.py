#!/usr/bin/env python3
"""V2-GAP-029 / owner decision D4: the guarded production entry point for the single McGovern sibling pair
(`afldb-sibling-supplement:015`, Jeremy McGovern 6937 / Mitch McGovern 9714) through the existing loader `tools/migration/family_siblings.py load`.

    plan   read-only; proves the target, resolves the artefact's identities, proves exactly ONE new pair and ZERO changes/stale removals; seals a plan
    apply  needs the plan, an approval pinned to its digest, a clean HEAD at the reviewed revision, fresh backup + restore evidence;
           runs the loader (no dry run is offered: the loader's write is one batch), then proves the result

    python tools/v2/gap029-sibling-pair-production.py plan  --target T --expect-after-content-digest D [--rehearsal | --backup B --backup-file F --restore-evidence R] --out O
    python tools/v2/gap029-sibling-pair-production.py apply --plan P [--rehearsal | --approval A --backup-file F --restore-evidence R] --out O

Why a plan is needed at all. The loader upserts EVERY artefact row (`ON CONFLICT ... DO UPDATE ... WHERE ... IS DISTINCT FROM`) and DELETES any sibling row not in the
artefact. It is additive here only if (a) every existing row already equals its artefact row (so the upsert is a no-op that leaves `import_batch_id` alone) and (b) no stored
sibling row is absent from the artefact. The plan proves both against the live target, names the one new key, and the apply proves it afterwards: all pre-existing rows
byte-identical (every column), exactly one new row, one new `import_batches` row, and the content digest equals the digest rehearsed on the production-equal clone.
Reuses the ceremony helpers of gap029-draft-link-production.py (target proof, exact DSN, exclusive outside-checkout output, 24 h freshness, approval binding).
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
gate, Refused, sha, canon, iso, parse_iso, fresh, outside, now = dl.gate, dl.Refused, dl.sha, dl.canon, dl.iso, dl.parse_iso, dl.fresh, dl.outside, dl.now
import family_siblings as fam  # noqa: E402  (tools/migration is on sys.path via the draft-link module)

OPERATION = "gap029-sibling-pair"
NEW_KEY = "siblings:afldb-sibling-supplement:015"
NEW_PAIR = {"personAPlayerId": 6937, "personBPlayerId": 9714}   # Jeremy McGovern, Mitch McGovern (read live 3 Nov); either order
CONTENT_COLS = ("family_key,family_name,person_a_player_id,person_a_name,person_a_role,person_b_player_id,person_b_name,person_b_role,relationship,relationship_label,"
                "confidence,evidence,extraction_method,source_id,source_record_id")
LIVE_SQL = f"SELECT {CONTENT_COLS}, import_batch_id FROM player_relationships WHERE source_id = %s AND source_record_id LIKE %s ORDER BY source_record_id"


def expected_tuple(r, a_id, b_id, source_id):
    """The row exactly as write_rows() builds it (minus the batch id)."""
    if r["source_label"] == fam.SUPPLEMENT_LABEL:
        evidence = f"{r['evidence']} (AFLDB sibling supplement {r['source_key']}: a pair the families export lacks)"
    else:
        evidence = f"{r['evidence']} (Wikipedia: {fam.SOURCE_ARTICLE}, {r['family_name'] or r['family_key']} family, revision {r['source_revision_id']})"
    return (r["family_key"], r["family_name"] or None, a_id, r["person_a_name"], r["person_a_role"] or None, b_id, r["person_b_name"], r["person_b_role"] or None,
            "sibling", r["relationship_label"], "source", evidence, r["extraction_method"] or None, source_id, f"{fam.RELATIONSHIP_PREFIX}:{r['source_key']}")


def read_state(dsn: str, target: dict, resolve: bool):
    conn = gate.open_read_only(dsn)
    try:
        gate.assert_read_only(gate.SelectOnlyCursor(conn.cursor()), target["database"])
        source_ids = fam.fetch_source_ids(conn)
        source_id = source_ids[fam.SOURCE_KEY]
        with conn.cursor() as cur:
            cur.execute(LIVE_SQL, (source_id, f"{fam.RELATIONSHIP_PREFIX}:%"))
            live = cur.fetchall()
            cur.execute("SELECT count(*) FROM import_batches")
            batches = cur.fetchone()[0]
        resolved = fam.resolve_artefact(fam.read_artefact(fam.DEFAULT_ARTEFACT), fam.fetch_identity(conn, source_ids)) if resolve else None
        return source_id, live, batches, resolved
    finally:
        conn.rollback()
        conn.close()


def digests(live) -> dict:
    content = [tuple(row[:15]) for row in live]
    return {"rows": len(live), "contentDigest": sha(canon([list(map(lambda v: v if v is None else str(v), r)) for r in content])),
            "fullRowDigest": sha(canon([list(map(lambda v: v if v is None else str(v), r)) for r in live]))}


def build_plan_facts(dsn: str, target: dict) -> dict:
    source_id, live, batches, resolved = read_state(dsn, target, True)
    live_by_key = {row[14]: row for row in live}
    new, changed = [], []
    for r, a_id, b_id in resolved:
        tup = expected_tuple(r, a_id, b_id, source_id)
        row = live_by_key.get(tup[14])
        if row is None:
            new.append({"key": tup[14], "personAPlayerId": a_id, "personBPlayerId": b_id})
        elif tuple(row[:15]) != tup:
            changed.append(tup[14])
    artefact_keys = {f"{fam.RELATIONSHIP_PREFIX}:{r['source_key']}" for r, _, _ in resolved}
    stale = sorted(set(live_by_key) - artefact_keys)
    if changed:
        raise Refused(f"the loader would rewrite {len(changed)} existing row(s), e.g. {changed[0]}; not additive")
    if stale:
        raise Refused(f"the loader would delete {len(stale)} stored sibling row(s), e.g. {stale[0]}; not additive")
    if len(new) != 1 or new[0]["key"] != NEW_KEY or sorted([new[0]["personAPlayerId"], new[0]["personBPlayerId"]]) != sorted(NEW_PAIR.values()):
        raise Refused(f"the artefact does not add exactly the reviewed McGovern pair: {new}")
    return {"before": digests(live), "newPair": new[0], "importBatchesBefore": batches, "artefactRows": len(resolved),
            "artefactSha256": sha(fam.DEFAULT_ARTEFACT.read_bytes()), "loaderSha256": sha((REPO / "tools/migration/family_siblings.py").read_bytes())}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=("plan", "apply"))
    for flag in ("--target", "--expect-after-content-digest", "--backup", "--backup-file", "--restore-evidence", "--plan", "--approval", "--out"):
        ap.add_argument(flag)
    ap.add_argument("--rehearsal", action="store_true")
    a = ap.parse_args(argv)
    try:
        out = outside(a.out)
        if out.exists():
            raise Refused("output already exists; preserve evidence and choose another path")
        revision = dl.git("rev-parse", "HEAD")
        if subprocess.run(["git", "diff", "--quiet"], cwd=REPO).returncode or subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=REPO).returncode:
            raise Refused("tracked working tree is not clean")
        plan0 = json.loads(outside(a.plan).read_text()) if a.mode == "apply" else None
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
                if not a.expect_after_content_digest:
                    raise Refused("--expect-after-content-digest (from the production-equal rehearsal) is required for a production plan")
                backup = json.loads(outside(a.backup).read_text())
                if backup["target"] != target or not fresh(backup["capturedAt"]) or not fresh(backup["restoredAt"]) or parse_iso(backup["restoredAt"]) < parse_iso(backup["capturedAt"]):
                    raise Refused("fresh target-bound backup and verified restore evidence required")
                if sha(outside(a.backup_file).read_bytes()) != backup["sha256"] or sha(outside(a.restore_evidence).read_bytes()) != backup["restoreEvidenceSha256"]:
                    raise Refused("backup or restore evidence content differs")
            facts = build_plan_facts(dsn, target)
            if backup and facts["before"]["contentDigest"] != backup.get("siblingContentDigest"):
                raise Refused("baseline drift: the verified restore's sibling content digest (siblingContentDigest) does not equal the live target's")
            body = {"operation": OPERATION, "revision": revision, "target": target, "rehearsal": rehearsal, **facts, "expectAfterContentDigest": a.expect_after_content_digest,
                    "backup": backup, "createdAt": iso(t), "expiresAt": iso(t + dl.MAX_AGE)}
            plan = {**body, "digest": sha(canon(body))}
            out.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
            print(f"Review plan {plan['digest']}; no writes; exactly one new pair ({NEW_KEY}), 0 changed, 0 stale; before content digest {facts['before']['contentDigest'][:16]}")
            return 0
        plan = plan0
        body = {k: v for k, v in plan.items() if k != "digest"}
        if plan["digest"] != sha(canon(body)) or plan["operation"] != OPERATION or plan["revision"] != revision or not parse_iso(plan["expiresAt"]) > t:
            raise Refused("plan digest, operation, revision or expiry differs")
        if sha((REPO / "tools/migration/family_siblings.py").read_bytes()) != plan["loaderSha256"] or sha(fam.DEFAULT_ARTEFACT.read_bytes()) != plan["artefactSha256"]:
            raise Refused("the loader or the artefact differs from the reviewed bytes")
        if not rehearsal:
            ap_ = json.loads(outside(a.approval).read_text())
            pb = plan["backup"]
            if not pb or ap_["planDigest"] != plan["digest"] or ap_["operation"] != OPERATION or ap_["target"] != plan["target"] or ap_["revision"] != revision \
                    or ap_["artefactSha256"] != plan["artefactSha256"] or not parse_iso(ap_["expiresAt"]) > t or parse_iso(ap_["expiresAt"]) > parse_iso(plan["expiresAt"]) \
                    or not parse_iso(ap_["approvedAt"]) <= t or not str(ap_.get("reference", "")).strip():
                raise Refused("stale plan or missing execution approval")
            if not fresh(pb["capturedAt"]) or not fresh(pb["restoredAt"]) or sha(outside(a.backup_file).read_bytes()) != pb["sha256"] \
                    or sha(outside(a.restore_evidence).read_bytes()) != pb["restoreEvidenceSha256"]:
                raise Refused("backup no longer fresh or its evidence differs")
        wdsn = os.environ.get("AFLDB_GAP029_WRITE_DSN", "")
        dl.dsn_matches(wdsn, target, False)
        dl.prove_identity(wdsn, target, writer=True)
        again = build_plan_facts(dsn, target)
        if again["before"] != plan["before"] or again["importBatchesBefore"] != plan["importBatchesBefore"] or again["newPair"] != plan["newPair"]:
            raise Refused("baseline drift; re-plan and obtain new execution approval")
        r = subprocess.run([sys.executable, str(REPO / "tools/migration/family_siblings.py"), "load", "--quiet"], cwd=REPO,
                           env={**os.environ, "AFLDB_IMPORT_DATABASE_URL": wdsn}, capture_output=True, text=True)
        record = {"planDigest": plan["digest"], "loaderExit": r.returncode, "at": iso(now())}
        if r.returncode:
            raise Refused("the loader failed; its batch transaction rolled back; verify the target equals the plan's before state before any retry")
        _, live, batches, _ = read_state(dsn, target, False)
        after = digests(live)
        old = [row for row in live if row[14] != NEW_KEY]
        problems = []
        if after["rows"] != plan["before"]["rows"] + 1:
            problems.append("row count is not exactly one more")
        if digests(old)["fullRowDigest"] != plan["before"]["fullRowDigest"]:
            problems.append("a pre-existing sibling row changed (including its import_batch_id)")
        if plan["expectAfterContentDigest"] and after["contentDigest"] != plan["expectAfterContentDigest"]:
            problems.append("the content digest differs from the rehearsed value")
        if batches != plan["importBatchesBefore"] + 1:
            problems.append("import_batches did not grow by exactly one")
        record.update({"after": after, "importBatchesAfter": batches, "problems": problems})
        out.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        if problems:
            print("RESTORE REQUIRED: the loader committed but verification refused: " + "; ".join(problems))
            return 1
        print("Committed one sibling pair; verification PASS; review restricted output")
        return 0
    except (Refused, gate.GateError) as exc:
        print(f"GAP-029 sibling refused: {exc if isinstance(exc, Refused) else type(exc).__name__ + ' ' + str(exc)[:200]}")
        return 1
    except (OSError, ValueError, KeyError, TypeError, fam.SiblingSourceError) as exc:
        print(f"GAP-029 sibling refused: unreadable or malformed input ({type(exc).__name__})")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
