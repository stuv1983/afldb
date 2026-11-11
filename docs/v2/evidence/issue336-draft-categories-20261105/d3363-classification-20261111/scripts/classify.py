"""D-336-3: classify every original_club_raw difference by segment-level edit, with per-row evidence."""
import json, gzip, sys, re, collections, pathlib
sys.stdout.reconfigure(encoding="utf-8")
SP = pathlib.Path(sys.argv[1])
pairs = json.loads((SP / "origin-pairs.json").read_text(encoding="utf-8"))
db = json.loads(gzip.decompress((SP / "draft-export.json.gz").read_bytes()))["rows"]
csv_rows = json.loads((SP / "csv_rows.json").read_text(encoding="utf-8"))
def n(s):
    if s is None: return None
    s = re.sub(r"\s+", " ", s.replace("\u00a0", " ").replace("\u200b", "")).strip(); return s or None
seg = lambda s: [t.strip() for t in s.split("/")] if s else []
# Vocabulary evidence: every segment ever used in the stored origins and in the CSV origins
stored_vocab = collections.Counter(t for r in db for t in seg(n(r["origin"])))
csv_vocab = collections.Counter(t for c in csv_rows for t in seg(n(c["origin"])))
SCHOOL = re.compile(r"(College|Grammar|\bSHS\b|\bHS\b|\bSC\b|School|Anglican|Blackfriars|Mount Scopus|St Ignatius|Islamic College|\bSS\b)")
def is_school(t): return bool(SCHOOL.search(t))
def subseq(small, big):
    it = iter(big); return all(any(x == y for y in it) for x in small)
def cls(d, c):
    D, C = seg(d), seg(c)
    if subseq(D, C) and len(C) > len(D):
        ins = list(C); [ins.remove(x) for x in D]
        pos = set()
        for t in ins:
            i = C.index(t)
            pos.add("prefix" if i == 0 else "suffix" if i == len(C) - 1 else "interior")
        kind = "school" if all(is_school(t) for t in ins) else "club" if not any(is_school(t) for t in ins) else "mixed"
        return f"INSERT_{kind.upper()}", ins, [], sorted(pos)
    if len(D) == len(C):
        diff = [(a, b) for a, b in zip(D, C) if a != b]
        if len(diff) == 1:
            a, b = diff[0]
            if b.startswith(a + " ") or b.lower().startswith(a.lower()):
                return "RENAME_EXPAND", [b], [a], []
            return "REPLACE_CLUB", [b], [a], []
    return "OTHER", [], [], []
pid_rows = collections.defaultdict(list)
for r in db:
    if r.get("player_id"): pid_rows[r["player_id"]].append(r)
out = []; agg = collections.Counter(); agg46 = collections.Counter(); ins_terms = collections.Counter()
for p in pairs:
    k, added, removed, pos = cls(p["db"], p["csv"])
    in46 = p["csv"].endswith(p["db"])          # reconcile.py's original "csv extends db" test
    siblings = [{"id": r["id"], "year": r["year"], "type": r["type"], "origin": n(r["origin"])} for r in pid_rows.get(p["player_id"], []) if r["id"] != p["id"]]
    ev = {"added_segments": added, "removed_segments": removed, "positions": pos,
          "added_seen_in_stored_vocab": {t: stored_vocab.get(t, 0) for t in added},
          "added_seen_in_csv_vocab": {t: csv_vocab.get(t, 0) for t in added},
          "removed_seen_in_csv_vocab": {t: csv_vocab.get(t, 0) for t in removed},
          "stored_segments_all_retained": subseq(seg(p["db"]), seg(p["csv"])),
          "same_player_other_stored_events": siblings}
    out.append({**{k2: p[k2] for k2 in ("id", "year", "cat", "player", "pick", "club", "player_id", "db", "csv")},
                "in_original_46": in46, "class": k, "evidence": ev})
    agg[k] += 1; agg46[(in46, k)] += 1
    for t in added: ins_terms[t] += 1
(SP / "d3363-classification.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("total", len(out), dict(agg))
print("by (in original 46, class)", sorted(agg46.items()))
print("years", sorted(collections.Counter(o["year"] for o in out).items()))
print("years of the 141", sorted(collections.Counter(o["year"] for o in out if not o["in_original_46"]).items()))
print("positions (insertions)", collections.Counter(tuple(o["evidence"]["positions"]) for o in out if o["class"].startswith("INSERT")))
print("added segment count per row", collections.Counter(len(o["evidence"]["added_segments"]) for o in out))
print("non-school inserted terms", sorted({t for o in out if o["class"] in ("INSERT_CLUB", "INSERT_MIXED") for t in o["evidence"]["added_segments"] if not is_school(t)}))
print("school-matched inserted distinct", len({t for t in ins_terms if is_school(t)}))
print("inserted terms absent from stored vocab", sorted(t for t in ins_terms if stored_vocab.get(t, 0) == 0))
for o in out:
    if o["class"] not in ("INSERT_SCHOOL",):
        print(" ", o["class"], o["id"], o["year"], o["cat"], o["player"], o["player_id"], "|", o["db"], "=>", o["csv"], "| siblings", o["evidence"]["same_player_other_stored_events"], "| removed in csv vocab", o["evidence"]["removed_seen_in_csv_vocab"])
# person-level: same player with stored events whose origins disagree among themselves
inc = [o for o in out if any(s["origin"] != o["db"] for s in o["evidence"]["same_player_other_stored_events"])]
print("rows whose player has another stored event with a different stored origin", len(inc))
for o in inc: print("   ", o["id"], o["player"], o["db"], "| others:", [(s["id"], s["origin"]) for s in o["evidence"]["same_player_other_stored_events"]], "| csv", o["csv"])
# cross-check: do the CSV's own values for sibling events agree with this row's CSV value?
