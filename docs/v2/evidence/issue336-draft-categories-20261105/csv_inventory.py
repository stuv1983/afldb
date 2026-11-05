"""Read-only inventory of the DraftGuru CSV exports (1991-2025). Never writes to the source folder."""
import csv, json, sys, re, hashlib, collections, pathlib

sys.stdout.reconfigure(encoding="utf-8")
SRC = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
NBSP = " "; ZWSP = "​"

def norm(s):
    if s is None:
        return None
    t = s.replace(NBSP, " ").replace(ZWSP, "").strip()
    return t if t != "" else None

headers = collections.Counter()
by_year = {}
cats = collections.Counter()
sign_heads = collections.Counter()
sign_by_cat = collections.Counter()
pick_col = collections.Counter()
rows_out = []
enc = collections.Counter()
files = sorted(SRC.glob("*_AFL_Draft_and_Trade_Period_Table_1.csv"))
hashes = {}
for f in files:
    year = int(f.name[:4])
    raw = f.read_bytes()
    hashes[f.name] = hashlib.sha256(raw).hexdigest()
    text = raw.decode("utf-8-sig")
    enc["nbsp"] += text.count(NBSP); enc["zwsp"] += text.count(ZWSP); enc["bom"] += raw.startswith(b"\xef\xbb\xbf")
    rd = csv.reader(text.splitlines(keepends=False) if False else __import__("io").StringIO(text, newline=""))
    hdr = next(rd)
    headers[tuple(hdr)] += 1
    col = {h: i for i, h in enumerate(hdr)}
    n = 0
    for i, cells in enumerate(rd):
        if not cells or all(c == "" for c in cells):
            continue
        if len(cells) != len(hdr):
            raise SystemExit(f"{f.name} row {i}: {len(cells)} cells vs {len(hdr)}")
        g = lambda k: norm(cells[col[k]]) if k in col else None
        cat = g("Draft"); pick = g("Pick"); sel = g("# ↧"); sign = g("Signing")
        cats[(cat)] += 1
        head = re.sub(r"\s*\(.*$", "", sign).strip() if sign else None
        sign_heads[head] += 1
        sign_by_cat[(cat, head)] += 1
        pick_col[(cat, "Pick" if pick else "-", "#" if sel else "-")] += 1
        rows_out.append({"year": year, "row": i, "cat": cat, "pick_raw": pick, "sel_raw": sel,
                         "club": g("Club"), "signing": sign, "signing_head": head, "player": g("Player"),
                         "age": g("Age"), "height": g("Height"), "origin": g("Original Club")})
        n += 1
    by_year[year] = n

OUT.write_text(json.dumps(rows_out, ensure_ascii=False), encoding="utf-8")
print("files", len(files), "rows", sum(by_year.values()))
print("headers", [(list(h), c) for h, c in headers.items()])
print("encoding", dict(enc))
print("per year", by_year)
print("categories", cats.most_common())
print("signing heads", sign_heads.most_common())
print("father-son by cat", [(k, v) for k, v in sign_by_cat.items() if k[1] and "Father" in k[1]])
print("pick/# presence by cat", sorted(pick_col.items(), key=lambda kv: (str(kv[0][0]), kv[0][1], kv[0][2])))
nonnum = collections.Counter((r["cat"], r["sel_raw"]) for r in rows_out if r["sel_raw"] and not re.fullmatch(r"\d+(\.0)?", r["sel_raw"]))
print("non-numeric #", nonnum.most_common(20))
picknote = collections.Counter(r["pick_raw"] for r in rows_out if r["pick_raw"])
print("distinct Pick values", len(picknote), picknote.most_common(15))
# duplicate selection numbers within (year, category)
dup = collections.Counter((r["year"], r["cat"], r["sel_raw"]) for r in rows_out if r["sel_raw"])
print("dup (year,cat,#)", [(k, v) for k, v in dup.items() if v > 1][:20])
for name in ["Fred Rodriguez", "Willem Duursma", "Nick Daicos"]:
    print(name, [ {k: r[k] for k in ("year","cat","pick_raw","sel_raw","club","signing")} for r in rows_out if r["player"] == name])
print("sha256", json.dumps(hashes))
