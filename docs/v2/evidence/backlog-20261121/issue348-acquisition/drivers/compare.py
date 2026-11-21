"""Scratch driver: compare fresh/owner classifier outputs with the committed 2026-11-11 classification, and the
fresh snapshot rows with the owner CSV rows. Aggregates only on stdout except where ids are named."""
import json, sys, pathlib, collections, re, hashlib
W = pathlib.Path(sys.argv[1])
EV = W / "src/docs/v2/evidence/issue336-draft-categories-20261105/d3363-classification-20261111"
committed = json.loads((EV / "classification.json").read_text(encoding="utf-8"))
cby = {r["id"]: r for r in committed}
res = {}
for k in ("fresh", "owner"):
    new = json.loads((W / f"work-{k}" / "d3363-classification.json").read_text(encoding="utf-8"))
    nby = {r["id"]: r for r in new}
    only_new = sorted(set(nby) - set(cby)); only_old = sorted(set(cby) - set(nby))
    changed = []
    for i in sorted(set(nby) & set(cby)):
        a, b = cby[i], nby[i]
        d = [f for f in ("class", "db", "csv", "year", "cat", "player", "player_id", "in_original_46") if a.get(f) != b.get(f)]
        if a["evidence"] != b["evidence"]: d.append("evidence")
        if d: changed.append((i, d))
    res[k] = {"n": len(new), "classes": dict(collections.Counter(r["class"] for r in new)),
              "ids_new_vs_committed": only_new, "ids_dropped_vs_committed": only_old,
              "rows_with_any_field_differing_from_committed": changed,
              "non_INSERT_SCHOOL_ids": sorted((r["id"], r["class"]) for r in new if r["class"] != "INSERT_SCHOOL"),
              "sha256_classification_json": hashlib.sha256((W / f"work-{k}" / "d3363-classification.json").read_bytes()).hexdigest()}
print(json.dumps(res, indent=1, default=str))

# fresh snapshot rows vs owner CSV rows (1991-2025)
def n(s):
    if s is None: return None
    s = re.sub(r"\s+", " ", s.replace(" ", " ").replace("​", "")).strip(); return s or None
fr = json.loads((W / "work-fresh/csv_rows.json").read_text(encoding="utf-8"))
ow = json.loads((W / "work-owner/csv_rows.json").read_text(encoding="utf-8"))
def key(r): return (r["year"], r["cat"], n(r["player"]), n(r["club"]), r["sel_raw"] and str(int(float(r["sel_raw"]))), n(r["signing"]))
fc = collections.Counter(key(r) for r in fr); oc = collections.Counter(key(r) for r in ow)
print("fresh rows", len(fr), "owner rows", len(ow), "keys only in fresh", sum((fc - oc).values()), "keys only in owner", sum((oc - fc).values()))
# multiset diff of origins per key
fo = collections.defaultdict(list); oo = collections.defaultdict(list)
for r in fr: fo[key(r)].append(n(r["origin"]))
for r in ow: oo[key(r)].append(n(r["origin"]))
diffs = []
for k in fo.keys() & oo.keys():
    if sorted(map(str, fo[k])) != sorted(map(str, oo[k])): diffs.append((k, fo[k], oo[k]))
print("keys common to both whose origin multiset differs (fresh vs owner CSV):", len(diffs))
for d in diffs[:40]: print("  ", json.dumps(d, ensure_ascii=False))
print("only in fresh:", json.dumps([k for k in (fc - oc)][:40], ensure_ascii=False))
print("only in owner:", json.dumps([k for k in (oc - fc)][:40], ensure_ascii=False))
