"""AFLDB-ISSUE-336: fetch the DraftGuru year pages holding the 35 missing Pre-Draft rows and parse them
with the repository's own parser (tools/rebuild/draftguru/parse_draft_snapshot.py). Read-only towards
the repository; downloads go to their own directory and are only parsed, never executed."""
import sys, json, time, hashlib, pathlib, urllib.request, datetime
sys.stdout.reconfigure(encoding="utf-8")
REPO = pathlib.Path(sys.argv[1]); OUTDIR = pathlib.Path(sys.argv[2]); SP = pathlib.Path(sys.argv[3])
sys.path.insert(0, str(REPO / "tools" / "rebuild" / "draftguru"))
import parse_draft_snapshot as p  # noqa: E402

contract = json.loads((REPO / "tools" / "rebuild" / "draftguru" / "draftguru-contract.json").read_text(encoding="utf-8"))
detail = json.loads((SP / "reconcile-detail.json").read_text(encoding="utf-8"))
missing = detail["unmatched_csv"]
years = sorted({m["year"] for m in missing})
OUTDIR.mkdir(parents=True, exist_ok=True)
fetched = {}
for y in years:
    url = p.build_year_url(contract, y)
    path = OUTDIR / f"{y}.html"
    if not path.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "AFLDB draft-history research (non-commercial)"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read(); ctype = r.headers.get("Content-Type", "")
        path.write_bytes(raw)
        (OUTDIR / f"{y}.http.json").write_text(json.dumps({"url": url, "final_url": url, "content_type": ctype,
            "fetched_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "sha256": hashlib.sha256(raw).hexdigest()}))
        time.sleep(3)
    http = json.loads((OUTDIR / f"{y}.http.json").read_text())
    rows, info = p.parse_year(contract, y, path.read_bytes(), http)
    fetched[y] = rows
    print(y, "rows", len(rows), "sha256", http["sha256"][:16])

def k(s):
    import unicodedata, re
    s = unicodedata.normalize("NFKD", (s or "").replace(" ", " ")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)

plan = []
for m in missing:
    hits = [r for r in fetched[m["year"]] if r["event_type_raw"] == "Pre-Draft" and k(r["player_name_raw"]) == k(m["player"]) and k(r["club_name_raw"]) == k(m["club"])]
    if len(hits) != 1:
        print("UNRESOLVED page row", m["year"], m["player"], len(hits)); continue
    h = hits[0]
    plan.append({"draft_year": m["year"], "event_type_raw": h["event_type_raw"], "player_name_raw": h["player_name_raw"],
                 "player_url": h["player_url"], "club_name_raw": h["club_name_raw"], "club_slug_source": h["club_slug"],
                 "signing_raw": h["signing_raw"], "pick_number": h["pick_number"], "pick_note_raw": h["pick_note_raw"],
                 "age_raw": h["age_raw"], "height_raw": h["height_raw"], "original_club_raw": h["original_club_raw"],
                 "source_url": h["source_url"], "row_index": h["row_index"],
                 "csv_agrees": {"signing": (m["signing"] or None) == (h["signing_raw"] or None)}})
# page totals vs CSV totals for those years
csv_rows = json.loads((SP / "csv_rows.json").read_text(encoding="utf-8"))
for y in years:
    print(y, "page", len(fetched[y]), "csv", sum(1 for r in csv_rows if r["year"] == y))
(SP / "missing-plan-rows.json").write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
print("plan rows", len(plan), "signing heads", sorted({(r["signing_raw"] or "").split(" (")[0] for r in plan}))
