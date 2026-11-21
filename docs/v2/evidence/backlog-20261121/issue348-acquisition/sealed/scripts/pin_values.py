"""Compute the reviewed-pin values for annual-html-20261122 from the copied raw pages (no network)."""
import hashlib, json, sys
from pathlib import Path
co = Path(sys.argv[1])
sys.path.insert(0, str(co / "tools/rebuild/draftguru"))
import parse_draft_snapshot as p
c = p.load_contract()
snap = co / "data/sources/draftguru/annual-html-20261122"
r = p.parse_snapshot(c, snap, require_complete=True)
pages = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((snap / "raw/years").glob("year_*.html"))}
blank = sum(1 for rows in r["rows_by_year"].values() for x in rows if x["pick_number"] is None)
ev = p._multiset((x["event_type_raw"] or "__no_draft_column__") for rows in r["rows_by_year"].values() for x in rows)
lab = {}
for rows in r["rows_by_year"].values():
    for x in rows:
        if x["pick_note_raw"] is not None:
            f = p.classify_pick_label(x["pick_note_raw"]); lab[f] = lab.get(f, 0) + 1
out = {
    "files": len(pages), "total_rows": r["total_rows"], "distinct_persons": r["distinct_person_count"],
    "selection_number_blank": blank, "event_type_totals": ev, "special_pick_label_totals": lab,
    "robots_txt_sha256": hashlib.sha256((snap / "http/robots.txt").read_bytes()).hexdigest(),
    "parsed_rows_sha256": p.parsed_rows_digest(r), "raw_pages_sha256": pages,
}
print(json.dumps(out, sort_keys=True, ensure_ascii=True))
print("baseline 0826:", c["parity_baseline"], "event baseline:", c["event_type_baseline"], "labels:", c["special_pick_label_baseline"], file=sys.stderr)
