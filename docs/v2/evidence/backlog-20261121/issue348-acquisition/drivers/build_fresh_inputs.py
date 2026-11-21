"""Scratch driver (outside the repository). Parses the fresh annual-page snapshot with the repository's own
parser and writes csv_rows.json in the shape csv_inventory.py emits, so the unmodified D-336-3 scripts can run
against the fresh acquisition. Also writes fresh-rows.json (every parsed row, 1981-2025) and a summary."""
import sys, json, re, pathlib, collections
W = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2]); label = sys.argv[3]
sys.path.insert(0, str(W / "src/tools/rebuild/draftguru"))
import parse_draft_snapshot as p  # noqa: E402

contract = p.load_contract()
snap = W / "src/data/sources/draftguru" / label
res = p.parse_snapshot(contract, snap, require_complete=True)
out.mkdir(parents=True, exist_ok=True)
rows, allrows = [], []
for y in sorted(res["rows_by_year"]):
    for r in res["rows_by_year"][y]:
        allrows.append({k: r[k] for k in ("draft_year", "row_index", "player_name_raw", "player_url", "club_name_raw",
                                          "pick_note_raw", "event_type_raw", "pick_number", "signing_raw",
                                          "detail_raw", "age_raw", "height_raw", "original_club_raw", "trade_raw")})
        if 1991 <= y <= 2025 and r["event_type_raw"]:
            sign = r["signing_raw"]
            head = re.sub(r"\s*\(.*$", "", sign).strip() if sign else None
            rows.append({"year": y, "row": r["row_index"], "cat": r["event_type_raw"], "pick_raw": r["pick_note_raw"],
                         "sel_raw": None if r["pick_number"] is None else str(r["pick_number"]),
                         "club": r["club_name_raw"], "signing": sign, "signing_head": head,
                         "player": r["player_name_raw"], "age": r["age_raw"], "height": r["height_raw"],
                         "origin": r["original_club_raw"], "player_url": r["player_url"]})
(out / "csv_rows.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
(out / "fresh-rows.json").write_text(json.dumps(allrows, ensure_ascii=False), encoding="utf-8")
summ = {"label": label, "total_rows": res["total_rows"], "distinct_persons": res["distinct_person_count"],
        "rows_1991_2025_with_event": len(rows),
        "rows_by_year": {str(y): len(v) for y, v in res["rows_by_year"].items()},
        "event_counts": collections.Counter((r["event_type_raw"] or "__none__") for r in allrows)}
(out / "fresh-summary.json").write_text(json.dumps(summ, indent=1, sort_keys=True), encoding="utf-8")
print(json.dumps({k: summ[k] for k in ("total_rows", "distinct_persons", "rows_1991_2025_with_event")}))
