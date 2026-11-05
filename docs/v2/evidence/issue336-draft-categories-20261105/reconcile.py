"""AFLDB-ISSUE-336 read-only reconciliation: DraftGuru CSV exports (1991-2025) vs the stored draft_picks rows."""
import json, gzip, sys, re, collections, unicodedata, pathlib
sys.stdout.reconfigure(encoding="utf-8")
SP = pathlib.Path(sys.argv[1])
csv_rows = json.loads((SP / "csv_rows.json").read_text(encoding="utf-8"))
db = json.loads(gzip.decompress((SP / "draft-export.json.gz").read_bytes()))
KIND = {"National": "national", "Rookie": "rookie", "Trade": "trade", "Pre-Season": "preseason", "Pre-Draft": "pre_draft",
        "Mid-Season": "midseason", "Post-Draft": "post_draft", "Free Agency": "free_agency", "Mini-Draft": "mini_draft",
        "Training Squad Selection": "training_squad_selection"}

def n(s):
    if s is None: return None
    s = s.replace(" ", " ").replace("​", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s or None

def demojibake(s):
    if s and "Ã" in s:
        for codec in ("cp1252", "latin-1"):
            try:
                return s.encode(codec).decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
    return s

MOJIBAKE = collections.Counter()
def key_name(s):
    fixed = demojibake(s)
    if fixed != s: MOJIBAKE[s] += 1
    s = unicodedata.normalize("NFKD", n(fixed) or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)

def pick(s):
    return int(float(s)) if s else None

rows = db["rows"]
in_range = [r for r in rows if 1991 <= r["year"] <= 2025]
src = [r for r in in_range if r["source"] == "draftguru"]
manual = [r for r in in_range if r["source"] != "draftguru"]
print("db total", len(rows), "1991-2025", len(in_range), "draftguru", len(src), "non-draftguru", len(manual),
      collections.Counter(r["source"] for r in in_range))
print("db outside 1991-2025", len(rows) - len(in_range), sorted(collections.Counter(r["year"] for r in rows if not 1991 <= r["year"] <= 2025).items())[:3], "...")

c_by = collections.Counter((r["year"], KIND[r["cat"]]) for r in csv_rows)
d_by = collections.Counter((r["year"], r["kind"]) for r in src)
diff = {k: (c_by.get(k, 0), d_by.get(k, 0)) for k in set(c_by) | set(d_by) if c_by.get(k, 0) != d_by.get(k, 0)}
print("per (year,kind) count differences csv vs db(draftguru):", sorted(diff.items()))
print("db types by kind", sorted(collections.Counter((r["kind"], r["type"]) for r in in_range).items()))
print("db signing_kind", collections.Counter(r["signing_kind"] for r in in_range).most_common())

# Row matching: (year, kind, pick) for numbered; (year, kind, name, club) for all.
dpool = collections.defaultdict(list)
for r in src:
    dpool[(r["year"], r["kind"], key_name(r["player"]))].append(r)
matched, unmatched_csv, field_diffs = [], [], collections.Counter()
examples = collections.defaultdict(list)
used = set()
for c in csv_rows:
    k = (c["year"], KIND[c["cat"]], key_name(c["player"]))
    cands = [r for r in dpool.get(k, []) if r["id"] not in used]
    if len(cands) > 1:
        cands = [r for r in cands if key_name(r["club_raw"]) == key_name(c["club"])] or cands
    if len(cands) > 1:
        cands = [r for r in cands if r["pick"] == pick(c["sel_raw"])] or cands
    if not cands:
        unmatched_csv.append(c); continue
    r = cands[0]; used.add(r["id"]); matched.append((c, r))
    checks = {
        "pick": (pick(c["sel_raw"]), r["pick"]),
        "pick_note": (n(c["pick_raw"]), n(r["pick_note"])),
        "club": (key_name(c["club"]), key_name(r["club_raw"])),
        "signing": (n(c["signing"]), n(r["signing"])),
        "origin": (n(c["origin"]), n(r["origin"])),
        "type_label": (c["cat"], r["type"]),
    }
    for f, (a, b) in checks.items():
        if a != b:
            field_diffs[f] += 1
            if len(examples[f]) < 6:
                examples[f].append({"year": c["year"], "cat": c["cat"], "player": c["player"], "csv": a, "db": b, "id": r["id"]})
unmatched_db = [r for r in src if r["id"] not in used]
print("matched", len(matched), "unmatched csv", len(unmatched_csv), "unmatched db(draftguru,1991-2025)", len(unmatched_db))
print("field differences", dict(field_diffs))
for f, ex in examples.items():
    print(" ", f, json.dumps(ex, ensure_ascii=False))
print("unmatched csv sample", json.dumps([{k: c[k] for k in ("year", "cat", "sel_raw", "club", "player", "signing")} for c in unmatched_csv[:25]], ensure_ascii=False))
print("unmatched db sample", json.dumps([{k: r[k] for k in ("id", "year", "type", "pick", "club_raw", "player", "player_url")} for r in unmatched_db[:25]], ensure_ascii=False))
print("manual rows", json.dumps([{k: r[k] for k in ("id", "year", "type", "kind", "pick", "club", "player", "player_display", "source")} for r in manual], ensure_ascii=False))
# Within-category pick collisions in the stored data
coll = collections.Counter((r["year"], r["kind"], r["pick"]) for r in in_range if r["pick"] is not None)
print("stored (year,kind,pick) collisions", [(k, v) for k, v in coll.items() if v > 1])
# Pick numbers on unnumbered kinds
print("stored unnumbered kinds carrying a pick", collections.Counter(r["kind"] for r in in_range if r["kind"] in ("trade", "free_agency", "pre_draft", "post_draft") and r["pick"] is not None))
for name in ("Fred Rodriguez", "Willem Duursma", "Nick Daicos"):
    print(name, json.dumps([{k: r[k] for k in ("id", "year", "type", "kind", "pick", "club", "signing_kind", "player_id", "link", "source")} for r in rows if key_name(r["player"]) == key_name(name) or key_name(r["player_display"]) == key_name(name)], ensure_ascii=False))
# Father-Son by kind in the stored data
print("stored Father-Son by kind (1991-2025)", collections.Counter(r["kind"] for r in in_range if r["signing_kind"] == "Father-Son"),
      "all years", collections.Counter(r["kind"] for r in rows if r["signing_kind"] == "Father-Son"))
# repeated players across events
rep = collections.Counter(r["player_id"] for r in rows if r["player_id"])
print("players with >1 stored event", sum(1 for v in rep.values() if v > 1), "max", max(rep.values()))
print("mojibake repaired names", dict(MOJIBAKE))
print("unmatched csv by (cat, signing head)", collections.Counter((c["cat"], c["signing_head"]) for c in unmatched_csv))
print("origin diffs: csv extends db (db is a suffix/subset)", sum(1 for c, r in matched if n(c["origin"]) != n(r["origin"]) and n(r["origin"]) and n(c["origin"]) and n(c["origin"]).endswith(n(r["origin"]))),
      "db null, csv set", sum(1 for c, r in matched if n(c["origin"]) and not n(r["origin"])))
json.dump({"unmatched_csv": unmatched_csv, "unmatched_db": unmatched_db, "examples": examples}, open(SP / "reconcile-detail.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
