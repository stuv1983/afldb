#!/usr/bin/env python3
"""AFLDB-ISSUE-348 F-348-1 -- the owner-reviewed acquisition pin (``reviewed_acquisitions``).

Proves, without a database and without the network:

  1. the pin logic on a synthetic snapshot: the exact input passes; an altered raw page, a missing or
     extra page, an altered parsed row and an altered count are each REFUSED;
  2. the change is additive: every label without a pin (``annual-html-20260826``,
     ``annual-html-20260902``, ``None``, a fixture label) keeps the frozen ``parity_baseline`` and the
     importer's legacy 6,810 / 5,057 constants; only ``annual-html-20261122`` is held to 6,845 / 5,088;
  3. the importer accepts the tracked sealed manifest for the pinned label and refuses a manifest whose
     page digests or source check differ from the pin; the 20260826 manifest still passes unchanged;
  4. ``acquire_draft.py --seal-reviewed`` refuses an unpinned label and an existing manifest before it
     could construct a fetcher (offline by construction);
  5. (real data, when the untracked raw pages are present) the real 20261122 pages pass the pin, a
     one-byte change to one page is refused, and both labels validate end to end with ``--validate-only``.
"""

from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import shutil
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(ROOT / "tools" / "migration"))

import importlib.util  # noqa: E402

import parse_draft_snapshot as p  # noqa: E402
import import_draftguru as imp    # noqa: E402

# tools/rebuild/draftguru/acquire_draft.py is a retired stub of the same module name; load the
# documented adapter by path so the stub can never shadow it.
_spec = importlib.util.spec_from_file_location(
    "acquire_draft_legacy", ROOT / "legacy" / "offline" / "tools" / "rebuild" / "draftguru" / "acquire_draft.py")
acq = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(acq)

PINNED = "annual-html-20261122"
failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


def refuses(fn, needle: str = "", exc=Exception) -> tuple[bool, str]:
    try:
        fn()
    except exc as e:  # noqa: BLE001
        return (needle in str(e)), str(e)
    return False, "did not refuse"


# ---------------------------------------------------------------------------
section("1. Pin logic on a synthetic snapshot")

tmp = Path(tempfile.mkdtemp(prefix="dg-pin-"))
snap = tmp / "snap"
(snap / "raw" / "years").mkdir(parents=True)
pages = {}
for year in (2001, 2002):
    data = f"<html>synthetic {year}</html>".encode()
    (snap / "raw" / "years" / f"year_{year}.html").write_bytes(data)
    pages[f"year_{year}.html"] = hashlib.sha256(data).hexdigest()


def row(year: int, i: int, club: str | None = "Club A", pick: int | None = 1) -> dict:
    return {"year": year, "row_index": i, "player_url": f"https://x/players/p{i}/1",
            "pick_number": pick, "event_type_raw": "National", "pick_note_raw": None,
            "original_club_raw": club}


result = {"rows_by_year": {2001: [row(2001, 1), row(2001, 2, pick=None)], 2002: [row(2002, 3)]},
          "total_rows": 3, "distinct_person_count": 3}
pin = {"files": 2, "total_rows": 3, "distinct_persons": 3, "selection_number_blank": 1,
       "event_type_totals": {"National": 3}, "special_pick_label_totals": {},
       "parsed_rows_sha256": p.parsed_rows_digest(result), "raw_pages_sha256": dict(pages),
       "authority": "synthetic"}
contract = {"reviewed_acquisitions": {"synthetic-label": pin},
            "parity_baseline": {"total_rows": 6810, "distinct_persons": 5057}}

ok = True
try:
    rep = p.verify_reviewed_pin(contract, "synthetic-label", snap, result)
    ok = rep["status"] == "REVIEWED_PIN" and rep["corpus_checks"]["raw_pages_verified"] == 2
except Exception as e:  # noqa: BLE001
    ok = False
check("1.1 the exact reviewed input passes (status REVIEWED_PIN, 2 pages verified)", ok)

(snap / "raw" / "years" / "year_2002.html").write_bytes(b"<html>synthetic 2002!</html>")
r, d = refuses(lambda: p.verify_reviewed_pin(contract, "synthetic-label", snap, result),
               "year_2002.html")
check("1.2 one altered raw page is refused, naming the page", r, d)
(snap / "raw" / "years" / "year_2002.html").write_bytes(b"<html>synthetic 2002</html>")

(snap / "raw" / "years" / "year_2003.html").write_bytes(b"extra")
r, d = refuses(lambda: p.verify_reviewed_pin(contract, "synthetic-label", snap, result),
               "raw page set differs")
check("1.3 an extra raw page is refused", r, d)
(snap / "raw" / "years" / "year_2003.html").unlink()
(snap / "raw" / "years" / "year_2001.html").rename(tmp / "held.html")
r, d = refuses(lambda: p.verify_reviewed_pin(contract, "synthetic-label", snap, result),
               "raw page set differs")
check("1.4 a missing raw page is refused", r, d)
(tmp / "held.html").rename(snap / "raw" / "years" / "year_2001.html")

altered = copy.deepcopy(result)
altered["rows_by_year"][2001][0]["original_club_raw"] = "Club B"
r, d = refuses(lambda: p.verify_reviewed_pin(contract, "synthetic-label", snap, altered),
               "parsed rows sha256")
check("1.5 one altered parsed value (original_club_raw) is refused by the parsed-rows digest", r, d)

altered = copy.deepcopy(result)
altered["total_rows"] = 4
r, d = refuses(lambda: p.verify_reviewed_pin(contract, "synthetic-label", snap, altered),
               "total rows")
check("1.6 an altered row count is refused", r, d)

r, d = refuses(lambda: p.verify_reviewed_pin(contract, "unpinned-label", snap, result), "no reviewed pin")
check("1.7 verify_reviewed_pin refuses a label without a pin", r, d)
shutil.rmtree(tmp, ignore_errors=True)

# ---------------------------------------------------------------------------
section("2. Additive: unpinned labels keep the frozen baseline and constants")

real = p.load_contract()
pins = {k for k in (real.get("reviewed_acquisitions") or {}) if not k.startswith("$")}
check("2.1 the tracked contract pins exactly one label, annual-html-20261122", pins == {PINNED}, str(pins))
check("2.2 parity_baseline is unchanged (6,810 / 5,057 / 1,686 blank)",
      (real["parity_baseline"]["total_rows"], real["parity_baseline"]["distinct_persons"],
       real["parity_baseline"]["selection_number_blank"]) == (6810, 5057, 1686))
for label in ("annual-html-20260826", "annual-html-20260902", None, "fixture-snapshot"):
    check(f"2.3 reviewed_pin({label!r}) is None", p.reviewed_pin(real, label) is None)
    check(f"2.4 expected_population({label!r}) == (6810, 5057)",
          imp.expected_population(label) == (6810, 5057), str(imp.expected_population(label)))
check("2.5 expected_population(annual-html-20261122) == (6845, 5088)",
      imp.expected_population(PINNED) == (6845, 5088), str(imp.expected_population(PINNED)))
check("2.6 the importer's legacy constants are unchanged (link-only and gate callers)",
      (imp.EXPECTED_ROWS, imp.EXPECTED_PERSONS) == (6810, 5057))

fake = {"rows_by_year": {}, "total_rows": 6845, "distinct_person_count": 5088}
r, d = refuses(lambda: p.validate_identity(real, fake, require_complete=True,
                                           accept_baseline_drift=False,
                                           label="annual-html-20260826"), "baseline drift")
check("2.7 6,845 / 5,088 under the 20260826 label is still baseline drift", r, d)
try:
    rep = p.validate_identity(real, fake, require_complete=True, accept_baseline_drift=False, label=PINNED)
    ok = rep["baseline_drift"] is None and rep["baseline_source"] == f"reviewed_acquisitions[{PINNED}]"
except Exception as e:  # noqa: BLE001
    ok = False
check("2.8 6,845 / 5,088 under the pinned label passes against its pin", ok)
old = {"rows_by_year": {}, "total_rows": 6810, "distinct_person_count": 5057}
r, d = refuses(lambda: p.validate_identity(real, old, require_complete=True,
                                           accept_baseline_drift=False, label=PINNED), "baseline drift")
check("2.9 6,810 / 5,057 under the pinned label is refused", r, d)
rep_default = p.validate_identity(real, old, require_complete=True, accept_baseline_drift=False)
check("2.10 the default (no label) report is byte-for-byte the pre-change shape",
      set(rep_default) == {"total_rows", "distinct_person_count", "baseline_total_rows",
                           "baseline_distinct_persons", "baseline_drift"})

# ---------------------------------------------------------------------------
section("3. Importer manifest checks")

try:
    m = imp.verify_stage_a_manifest(PINNED)
    ok = m["total_rows"] == 6845 and m["parity"]["status"] == "REVIEWED_PIN"
except Exception as e:  # noqa: BLE001
    ok, m = False, None
check("3.1 the tracked sealed 20261122 manifest passes", ok)
try:
    ok = imp.verify_stage_a_manifest("annual-html-20260826")["total_rows"] == 6810
except Exception:  # noqa: BLE001
    ok = False
check("3.2 the 20260826 manifest still passes unchanged (6,810)", ok)

if m is not None:
    real_dir = imp.MANIFEST_DIR
    with tempfile.TemporaryDirectory() as td:
        imp.MANIFEST_DIR = Path(td)
        try:
            bad = copy.deepcopy(m)
            bad["source_urls"][0]["sha256"] = "0" * 64
            (Path(td) / f"{PINNED}.json").write_text(json.dumps(bad), encoding="utf-8")
            r, d = refuses(lambda: imp.verify_stage_a_manifest(PINNED), "not the owner-reviewed pin")
            check("3.3 a manifest with one altered page digest is refused", r, d)
            bad = copy.deepcopy(m)
            bad["parity"]["status"] = "PASS"
            (Path(td) / f"{PINNED}.json").write_text(json.dumps(bad), encoding="utf-8")
            r, d = refuses(lambda: imp.verify_stage_a_manifest(PINNED), "not sealed against")
            check("3.4 a manifest not sealed by the reviewed-pin source check is refused", r, d)
            bad = copy.deepcopy(m)
            bad["total_rows"] = 6810
            (Path(td) / f"{PINNED}.json").write_text(json.dumps(bad), encoding="utf-8")
            r, d = refuses(lambda: imp.verify_stage_a_manifest(PINNED), "expected 6845")
            check("3.5 a pinned-label manifest declaring 6,810 rows is refused", r, d)
        finally:
            imp.MANIFEST_DIR = real_dir

# ---------------------------------------------------------------------------
section("4. acquire_draft.py --seal-reviewed is offline and fail-closed")


class NoNetwork(Exception):
    pass


def _forbidden(*_a, **_k):
    raise NoNetwork("a fetcher was constructed")


real_fetcher = acq.Fetcher
acq.Fetcher = _forbidden
try:
    with tempfile.TemporaryDirectory() as td:
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(io.StringIO()):
            rc = acq.main(["--label", "annual-html-20991231", "--seal-reviewed",
                           "--snapshot-root", td, "--manifest-dir", td])
        check("4.1 an unpinned label is refused (rc 1, no fetcher)", rc == 1 and "no owner-reviewed pin" in buf.getvalue(),
              buf.getvalue().strip())
        (Path(td) / f"{PINNED}.json").write_text("{}", encoding="utf-8")
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(io.StringIO()):
            rc = acq.main(["--label", PINNED, "--seal-reviewed", "--snapshot-root", td, "--manifest-dir", td])
        check("4.2 an existing manifest is never overwritten (rc 1, no fetcher)",
              rc == 1 and "already exists" in buf.getvalue(), buf.getvalue().strip())
        (Path(td) / f"{PINNED}.json").unlink()
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(io.StringIO()):
            rc = acq.main(["--label", PINNED, "--seal-reviewed", "--snapshot-root", td, "--manifest-dir", td])
        check("4.3 absent raw pages are refused before anything is written",
              rc == 1 and not (Path(td) / f"{PINNED}.json").exists(), buf.getvalue().strip())
except NoNetwork as e:
    check("4.x --seal-reviewed never constructs a fetcher", False, str(e))
finally:
    acq.Fetcher = real_fetcher

# ---------------------------------------------------------------------------
section("5. Real data (untracked raw pages; runs where they are present)")

real_snap = ROOT / "data" / "sources" / "draftguru" / PINNED
if not (real_snap / "raw" / "years").is_dir():
    print("  SKIP  real 20261122 raw pages are not present on this host (untracked data)")
else:
    res = p.parse_snapshot(real, real_snap, require_complete=True)
    try:
        rep = p.verify_reviewed_pin(real, PINNED, real_snap, res)
        ok = rep["corpus_checks"]["raw_pages_verified"] == 42
    except Exception as e:  # noqa: BLE001
        ok = False
    check("5.1 the real 42 pages, 6,845 rows and parsed rows equal the pin", ok)
    with tempfile.TemporaryDirectory() as td:
        alt = Path(td) / PINNED
        shutil.copytree(real_snap / "raw", alt / "raw")
        page = alt / "raw" / "years" / "year_2013.html"
        data = bytearray(page.read_bytes())
        data[len(data) // 2] ^= 0x01
        page.write_bytes(bytes(data))
        r, d = refuses(lambda: p.verify_reviewed_pin_raw(p.reviewed_pin(real, PINNED), alt), "year_2013.html")
        check("5.2 a one-bit change in one real page is refused", r, d)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = imp.main(["--label", PINNED, "--validate-only"])
    out = buf.getvalue()
    check("5.3 importer --validate-only on the pinned label: rc 0, 5,088 persons, 6,845 picks",
          rc == 0 and "persons    : 5088" in out and "picks      : 6845" in out, out[-400:])

old_snap = ROOT / "data" / "sources" / "draftguru" / "annual-html-20260826"
if not (old_snap / "raw" / "years").is_dir():
    print("  SKIP  real 20260826 raw pages are not present on this host (untracked data)")
else:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = imp.main(["--validate-only"])
    out = buf.getvalue()
    check("5.4 importer --validate-only, default label (20260826): rc 0, 5,057 persons, 6,810 picks",
          rc == 0 and "persons    : 5057" in out and "picks      : 6810" in out, out[-400:])

print()
if failures:
    print(f"{len(failures)} DraftGuru reviewed-pin check(s) FAILED:")
    for name in failures:
        print(f"  - {name}")
    sys.exit(1)
print("All DraftGuru reviewed-pin checks hold.")
