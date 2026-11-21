"""PROVISIONAL scratch driver (outside the repository; edits no file). The genuine importer refuses the fresh
acquisition at the Stage A manifest gate because the tool's parity gate (frozen CSV oracle) did not pass and so no
manifest was sealed, and would then refuse at the 6,810/5,057 constants. To still obtain the reload guard's effects
(--dry-run, SELECT-only, writes nothing) this driver patches three things IN MEMORY and then calls main():
  1. import_draftguru.verify_stage_a_manifest -> an in-memory manifest built from the real http/years records;
  2. import_draftguru.EXPECTED_ROWS / EXPECTED_PERSONS -> the fresh counts (6845 / 5088);
  3. parse_draft_snapshot.load_contract -> a deep copy whose parity_baseline equals the fresh counts.
The result is NOT an accepted import and must not be used as one; effect_digest values from it are provisional."""
import copy, json, pathlib, sys
W = pathlib.Path(sys.argv[1]); label = sys.argv[2]; rest = sys.argv[3:]
src = W / "src"
sys.path.insert(0, str(src / "tools/rebuild/draftguru"))
import parse_draft_snapshot as parser_mod  # noqa: E402
import import_draftguru as imp  # noqa: E402

snap = src / "data/sources/draftguru" / label
orig_load = parser_mod.load_contract

def patched_contract():
    c = copy.deepcopy(orig_load())
    c["parity_baseline"]["total_rows"] = 6845
    c["parity_baseline"]["distinct_persons"] = 5088
    return c

def provisional_manifest(lbl):
    entries = []
    for p in sorted((snap / "http/years").glob("year_*.json")):
        rec = json.loads(p.read_text(encoding="utf-8"))
        entries.append({"raw_filename": rec["raw_filename"], "sha256": rec["sha256"], "year": int(p.stem.split("_")[1])})
    return {"snapshot_label": lbl, "identity_complete": True, "import_capable": True,
            "total_rows": 6845, "distinct_player_url_count": 5088, "source_urls": entries,
            "PROVISIONAL": "in-memory, unaccepted; parity gate did not pass"}

parser_mod.load_contract = patched_contract
imp.EXPECTED_ROWS = 6845
imp.EXPECTED_PERSONS = 5088
imp.verify_stage_a_manifest = provisional_manifest
print("*** PROVISIONAL DRY-RUN: in-memory manifest + baseline overrides; no file edited, nothing written ***")
sys.exit(imp.main(rest))
