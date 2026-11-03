#!/usr/bin/env python3
"""GAP-029 FINAL verification follow-up for S2 (READ-ONLY). The main run's S2 gate VERIFY on the post-S4 restore matched three of the four production plan hashes
(after_state, picks_after, newly_linked) and differed on baseline_sha256. Hypothesis: baseline_sha256 digests the NON-LINK columns of the whole draft_picks surface, which S3
changed (eight audited rows were added AFTER S2). This script tests that on the retained restores, using the stage tool's own read helper:
  * post-S2 restore (taken just before S3)  -> the gate VERIFY against the production S2 plan must PASS in full, incl. baseline_sha256 = be716e65...;
  * post-S3 restore (taken just before S4)  -> must differ on baseline_sha256 only (S3's eight rows exist), the other three hashes equal.
env: CAND, EXPECT, CHILD, DB_POST_S2, DB_POST_S3, AFLDB_TEST_DATABASE_URL."""
import hashlib, importlib.util, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

sys.dont_write_bytecode = True
CAND = Path(os.environ["CAND"]); EXPECT = Path(os.environ["EXPECT"]); CHILD = Path(os.environ["CHILD"])
BASE = urlsplit(os.environ["AFLDB_TEST_DATABASE_URL"])
fails = 0


def res(ok, name, detail=""):
    global fails
    fails += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{(' -- ' + detail) if detail else ''}")


spec = importlib.util.spec_from_file_location("gap029_s4", CAND / "tools/v2/gap029-sibling-pair-production.py")
s4 = importlib.util.module_from_spec(spec); sys.modules["gap029_s4"] = s4; spec.loader.exec_module(s4)
dl = s4.dl
p2 = json.loads((EXPECT / "s2-plan.json").read_text())
assert hashlib.sha256(CHILD.read_bytes()).hexdigest() == p2["childSha256"]
KEYS = ("after_state_sha256", "picks_after_sha256", "newly_linked_sha256", "baseline_sha256")
expect = {**p2["expect"], "batches_before": p2["batchesBefore"]}


def dsn(db):
    return urlunsplit(BASE._replace(path="/" + db))


def run(mode, db, **kw):
    return dl.run_gate_mode(mode, dsn(db), {"database": db}, str(CHILD), p2["childSha256"], p2["label"], **kw)


post2, post3 = os.environ["DB_POST_S2"], os.environ["DB_POST_S3"]
try:
    run("verify", post2, expect=expect)
    res(True, f"S2 gate VERIFY passes IN FULL against the production plan on the post-S2 restore ({post2})")
except Exception as e:
    res(False, f"S2 gate VERIFY on the post-S2 restore ({post2})", str(e)[:500])
try:
    again = run("plan", post3)
    eq = {k: again[k] == p2["expect"][k] for k in KEYS}
    res(eq["after_state_sha256"] and eq["picks_after_sha256"] and eq["newly_linked_sha256"] and not eq["baseline_sha256"],
        f"post-S3 restore ({post3}): three S2 hashes equal, baseline_sha256 differs (S3's eight rows exist)", json.dumps(eq))
except Exception as e:
    res(False, f"S2 gate plan on the post-S3 restore ({post3})", str(e)[:500])
print("S2 FOLLOW-UP PASS" if fails == 0 else f"S2 FOLLOW-UP FAIL ({fails})")
sys.exit(0 if fails == 0 else 1)
