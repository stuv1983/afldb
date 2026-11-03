#!/usr/bin/env python3
"""GAP-029 FINAL verification, Python half: S4 (sibling rows and digests) and S2 (the DraftGuru link-only after-state) on the fresh post-S4 restore.
READ-ONLY: it calls only the stage tools' own read helpers (read_state, run_gate_mode 'verify'/'plan'), which open read-only sessions and roll back.
env: CAND (pinned checkout), EXPECT (dir with the four production plans), RDB (restored database name), CHILD (the S2 child.json), AFLDB_TEST_DATABASE_URL (guarded runner)."""
import hashlib, importlib.util, json, os, sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

sys.dont_write_bytecode = True
CAND = Path(os.environ["CAND"]); EXPECT = Path(os.environ["EXPECT"]); DB = os.environ["RDB"]; CHILD = Path(os.environ["CHILD"])
DSN = urlunsplit(urlsplit(os.environ["AFLDB_TEST_DATABASE_URL"])._replace(path="/" + DB))
fails = 0


def res(ok, name, detail=""):
    global fails
    fails += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'} {name}{(' -- ' + detail) if detail else ''}")


spec = importlib.util.spec_from_file_location("gap029_s4", CAND / "tools/v2/gap029-sibling-pair-production.py")
s4 = importlib.util.module_from_spec(spec); sys.modules["gap029_s4"] = s4; spec.loader.exec_module(s4)
dl = s4.dl
target = {"database": DB}

# ---- S4 ------------------------------------------------------------------------------------------------------------------------------------------
p4 = json.loads((EXPECT / "s4-plan.json").read_text())
source_id, live, batches, _ = s4.read_state(DSN, target, False)
new = [r for r in live if r[14] == s4.NEW_KEY]; old = [r for r in live if r[14] != s4.NEW_KEY]
d_all, d_old = s4.digests(live), s4.digests(old)
res(len(live) == 499 and len(old) == 498, "S4 sibling rows: 499 in total, 498 pre-existing", f"{len(live)} / {len(old)}")
res(len(new) == 1 and {new[0][2], new[0][5]} == {6937, 9714}, "S4 exactly one new relationship siblings:afldb-sibling-supplement:015 = Jeremy McGovern 6937 / Mitch McGovern 9714",
    f"names {new[0][3]} / {new[0][6]}" if new else "none")
res(d_all["contentDigest"] == p4["expectAfterContentDigest"], "S4 content digest equals the rehearsed digest d6fceb33...", d_all["contentDigest"])
res(d_old["contentDigest"] == p4["before"]["contentDigest"] and d_old["fullRowDigest"] == p4["before"]["fullRowDigest"],
    "S4 the 498 pre-existing rows are byte-identical to the pre-S4 backup (every column, incl. import_batch_id)", d_old["fullRowDigest"])
res(bool(new) and new[0][15] is not None and all(r[15] != new[0][15] for r in old), "S4 the new row carries its own new import batch", str(new[0][15]) if new else "")
print(f"INFO import_batches rows now {batches} (S4 plan before: {p4['importBatchesBefore']})")

# ---- S2 ------------------------------------------------------------------------------------------------------------------------------------------
p2 = json.loads((EXPECT / "s2-plan.json").read_text())
child_sha = hashlib.sha256(CHILD.read_bytes()).hexdigest()
res(child_sha == p2["childSha256"], "S2 the child.json on this host is the one the production plan pinned", child_sha)
expect = {**p2["expect"], "batches_before": p2["batchesBefore"]}
try:
    dl.run_gate_mode("verify", DSN, target, str(CHILD), p2["childSha256"], p2["label"], expect)
    res(True, "S2 the gate's own VERIFY of the DraftGuru link-only after-state passes against the production plan's four hashes")
except Exception as e:  # report, then show which hash moved
    res(False, "S2 the gate's own VERIFY of the DraftGuru link-only after-state", str(e)[:600])
    try:
        again = dl.run_gate_mode("plan", DSN, target, str(CHILD), p2["childSha256"], p2["label"])
        for k in ("after_state_sha256", "picks_after_sha256", "newly_linked_sha256", "baseline_sha256"):
            print(f"INFO S2 plan-mode {k}: now {again[k][:16]} vs production plan {p2['expect'][k][:16]} {'(equal)' if again[k] == p2['expect'][k] else '(differs)'}")
    except Exception as e2:
        print(f"INFO S2 plan-mode diagnostic refused: {str(e2)[:300]}")
print("PY VERIFICATION PASS" if fails == 0 else f"PY VERIFICATION FAIL ({fails})")
sys.exit(0 if fails == 0 else 1)
