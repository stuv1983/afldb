"""Scratch driver: byte-exact comparison of original_club_raw for draft_picks 5961, 6784, 6626 across
(a) the fresh acquisition (parsed from the raw annual page), (b) the restored production row,
(c) the owner CSV of 2026-11-05 (raw cell, no normalisation). Prints the strings and their UTF-8 hex."""
import csv, io, json, sys, pathlib, gzip, re
W = pathlib.Path(sys.argv[1]); OWNER = pathlib.Path(sys.argv[2])
IDS = (5961, 6784, 6626)
db = {r["id"]: r for r in json.loads(gzip.decompress((W / "work-fresh/draft-export.json.gz").read_bytes()))["rows"]}
fresh = json.loads((W / "work-fresh/fresh-rows.json").read_text(encoding="utf-8"))
def n(s):
    if s is None: return None
    s = re.sub(r"\s+", " ", s.replace(" ", " ").replace("​", "")).strip(); return s or None
def hx(s): return None if s is None else s.encode("utf-8").hex()
out = {}
for i in IDS:
    d = db[i]
    fr = [r for r in fresh if r["draft_year"] == d["year"] and r["player_url"] == d["player_url"] and r["event_type_raw"] == d["type"]]
    # owner CSV raw cells
    raw = (OWNER / f"{d['year']}_AFL_Draft_and_Trade_Period_Table_1.csv").read_bytes().decode("utf-8-sig")
    rd = csv.reader(io.StringIO(raw, newline="")); hdr = next(rd); col = {h: k for k, h in enumerate(hdr)}
    ow = [c for c in rd if c and n(c[col["Player"]]) == n(d["player"]) and c[col["Draft"]] == d["type"]]
    rec = {"id": i, "year": d["year"], "type": d["type"], "player_url": d["player_url"], "player_id": d["player_id"],
           "stored_raw": d["origin"], "stored_hex": hx(d["origin"]),
           "fresh_matches": len(fr), "fresh_raw": [r["original_club_raw"] for r in fr], "fresh_hex": [hx(r["original_club_raw"]) for r in fr],
           "owner_matches": len(ow), "owner_raw": [c[col["Original Club"]] for c in ow], "owner_hex": [hx(c[col["Original Club"]]) for c in ow]}
    f0 = rec["fresh_raw"][0] if len(fr) == 1 else None; o0 = rec["owner_raw"][0] if len(ow) == 1 else None
    rec["fresh_eq_owner_bytes"] = (f0 is not None and o0 is not None and f0.encode("utf-8") == o0.encode("utf-8"))
    rec["fresh_eq_owner_normalised"] = (f0 is not None and o0 is not None and n(f0) == n(o0))
    rec["fresh_eq_stored_bytes"] = (f0 is not None and d["origin"] is not None and f0.encode("utf-8") == d["origin"].encode("utf-8"))
    rec["owner_eq_stored_bytes"] = (o0 is not None and d["origin"] is not None and o0.encode("utf-8") == d["origin"].encode("utf-8"))
    out[i] = rec
    print(json.dumps(rec, ensure_ascii=False, indent=1))
