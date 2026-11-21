"""ISSUE-348: build the reviewed reconciliation from a guard report, fail-closed.

python -I recon348.py <co> <guard-report.json> <owner-csv-dir> <out.json>

Accepts ONLY what the owner decided on 2026-11-22 (Q2, F-348-1) and the reviewed evidence says:
  * 0 pick deletions and 0 person deletions (anything else: refuse to build);
  * audited pick rewrites whose ONLY change is competition NULL -> 'AFL' (Q2(b) re-baseline);
  * audited person rewrites whose ONLY change is dg_person_id (a per-load rank);
  * origin changes: the D-336-3 classifier row (classification-fresh.json, tracked) where its
    stored/incoming/class equal the guard's; outside the classifier's 1991-2025 range only an
    auto-accepted class (INSERT_*), built from the guard row and marked as such;
  * owner_rulings only for 5961, 6784, 6626 and only when the incoming raw bytes equal the owner
    CSV cell of 2026-11-05 byte for byte, the CSV file itself verified against the tracked
    SHA256SUMS.owner-csv (Q2(c)). Any other non-auto class: refuse.
"""
import csv, hashlib, io, json, re, sys
from pathlib import Path

co, report_path, owner_dir, out_path = (Path(a) for a in sys.argv[1:5])
sys.path.insert(0, str(co / "tools/rebuild/draftguru"))
import reload_guard as rg  # noqa: E402

EV = co / "docs/v2/evidence"
CLASSIFICATION = EV / "backlog-20261121/issue348-acquisition/classification-fresh.json"
SUMS = EV / "issue336-draft-categories-20261105/d3363-classification-20261111/SHA256SUMS.owner-csv"
RULED = {5961, 6784, 6626}
report = json.loads(report_path.read_text(encoding="utf-8"))
eff = report["effects"]
problems = []
if eff["deleted_picks"] or eff["deleted_persons"]:
    sys.exit(f"REFUSED: deletions present ({len(eff['deleted_picks'])} picks, "
             f"{len(eff['deleted_persons'])} persons); this reconciliation acknowledges none")

rewrites = []
for r in eff["protected_rewrites"]:
    if r["columns"] != {"competition": [None, "AFL"]}:
        problems.append(f"protected rewrite {r['id']} changes {sorted(r['columns'])}")
    rewrites.append({"id": r["id"], "key": r["key"], "reasons": r["reasons"], "columns": r["columns"],
                     "acknowledged_because": "Owner Q2(b) 2026-11-22: re-baseline to the reviewed acquisition. "
                     "The D-336-2 audited insert stored competition NULL; the importer derives 'AFL' from "
                     "data/reference/seasons.json league eras for every DraftGuru pick."})
person_rewrites = []
for r in eff["protected_person_rewrites"]:
    cols = set(r["columns"])
    if not cols <= {"dg_person_id", "name_key"} or "dg_person_id" not in cols:
        problems.append(f"protected person rewrite {r['player_url']} changes {sorted(cols)}")
    why = ("dg_person_id is a per-load rank (import_draftguru.build_persons); never durable identity")
    if "name_key" in cols:
        before, after = r["columns"]["name_key"]
        # the D-336-2 insert stored an alphanumeric-only key; the importer's frozen G6 rule
        # (draftguru_name_key: NBSP->space, collapse, trim, lowercase) is what the other 5,057 carry
        if re.sub(r"[^0-9a-z]", "", after or "") != before or after != re.sub(r"\s+", " ", after).strip().lower():
            problems.append(f"protected person rewrite {r['player_url']}: name_key {before!r} -> {after!r} "
                            "is not the G6 form of the same key")
        why += ("; name_key moves from the D-336-2 insert's alphanumeric-only form to the importer's "
                "frozen G6 rule carried by every other DraftGuru person (search key, never identity)")
    person_rewrites.append({"id": r["id"], "player_url": r["player_url"], "columns": r["columns"],
                            "acknowledged_because": why})

classified = {row["id"]: row for row in json.loads(CLASSIFICATION.read_text(encoding="utf-8"))}
review, rulings = [], []
sums = {}
for line in SUMS.read_text(encoding="utf-8").splitlines():
    if line.strip():
        h, name = line.split(None, 1)
        sums[name.lstrip("*").strip()] = h


def n(s):
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s.replace(" ", " ").replace("​", "")).strip()
    return s or None


for ch in eff["origin_changes"]:
    pid = ch["id"]
    row = classified.get(pid)
    if row is not None:
        if (rg.normalise_origin(row["db"]) != rg.normalise_origin(ch["before"])
                or rg.normalise_origin(row["csv"]) != rg.normalise_origin(ch["after"])
                or row["class"] != ch["class"] or row["year"] != ch["year"]):
            problems.append(f"origin {pid}: guard differs from the reviewed classifier row")
        review.append(row)
    else:
        if ch["class"] not in rg.AUTO_ACCEPTED_ORIGIN_CLASSES:
            problems.append(f"origin {pid}: outside the classifier and not auto-accepted ({ch['class']})")
        review.append({"id": pid, "year": ch["year"], "db": ch["before"], "csv": ch["after"],
                       "class": ch["class"], "key": ch["key"],
                       "reviewed_as": "outside the D-336-3 classifier range (1991-2025); auto-accepted class "
                       "per D-336-3/Q2; listed in issue348-acquisition/README.md section 3"})
    if ch["class"] not in rg.AUTO_ACCEPTED_ORIGIN_CLASSES:
        if pid not in RULED or row is None:
            problems.append(f"origin {pid}: {ch['class']} without an owner ruling")
            continue
        fname = f"{row['year']}_AFL_Draft_and_Trade_Period_Table_1.csv"
        data = (owner_dir / fname).read_bytes()
        file_sha = hashlib.sha256(data).hexdigest()
        if sums.get(fname) != file_sha:
            problems.append(f"owner CSV {fname} sha256 {file_sha} is not the tracked {sums.get(fname)}")
            continue
        rd = csv.reader(io.StringIO(data.decode("utf-8-sig"), newline=""))
        hdr = next(rd); col = {h: k for k, h in enumerate(hdr)}
        cells = [c[col["Original Club"]] for c in rd
                 if c and n(c[col["Player"]]) == n(row["player"]) and c[col["Draft"]] == row["cat"]]
        if len(cells) != 1 or cells[0].encode("utf-8") != (ch["after"] or "").encode("utf-8"):
            problems.append(f"ruling {pid}: incoming is not byte-equal to the single owner CSV cell "
                            f"({len(cells)} match(es))")
            continue
        rulings.append({"id": pid, "decision": "accept_incoming",
                        "reference": (f"Owner Q2(c) 2026-11-22: accept_incoming only where incoming equals the "
                                      f"reviewed 2026-11-05 owner CSV byte for byte; {fname} sha256 {file_sha}, "
                                      f"listed in SHA256SUMS.owner-csv (sha256 "
                                      f"{hashlib.sha256(SUMS.read_bytes()).hexdigest()})"),
                        "incoming_utf8_hex": ch["after"].encode("utf-8").hex(),
                        "stored_utf8_hex": (ch["before"] or "").encode("utf-8").hex()})

if problems:
    sys.exit("REFUSED:\n  " + "\n  ".join(problems))
doc = {"format": rg.RECONCILIATION_FORMAT, "stage_a_label": report["stage_a_label"],
       "effect_digest": report["effect_digest"], "acknowledged_deletions": [],
       "acknowledged_person_deletions": [], "acknowledged_protected_rewrites": rewrites,
       "acknowledged_protected_person_rewrites": person_rewrites,
       "origin_review": sorted(review, key=lambda r: r["id"]),
       "owner_rulings": sorted(rulings, key=lambda r: r["id"])}
data = (json.dumps(doc, indent=1, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
out_path.write_bytes(data)
classes = {}
for ch in eff["origin_changes"]:
    classes[ch["class"]] = classes.get(ch["class"], 0) + 1
print(json.dumps({"sha256": hashlib.sha256(data).hexdigest(), "effect_digest": report["effect_digest"],
                  "rewrites": len(rewrites), "person_rewrites": len(person_rewrites),
                  "origin_review": len(review), "rulings": [r["id"] for r in rulings], "classes": classes}))
