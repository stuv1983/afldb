#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase F -- DB-free contract checks for
tools/rebuild/draftguru/build_validation_sample.py (the disjoint new-salt validation sample).

    python tests/python/draftguru_validation_sample_contract.py

Every behavioural check runs against the hand-built lineage fixture in
tests/python/draftguru_lineage_fixture.py, in a temporary directory -- never the real
parent, child, prior sample or verdict artefacts, and the REAL Phase F sample is never
generated here. The real-lineage checks assert pinned module constants only.

No database connection, no network request, no importer, no Git command.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOL_DIR = ROOT / "tools" / "rebuild" / "draftguru"
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(HERE))

import draftguru_lineage_fixture as fx                # noqa: E402
import build_validation_sample as tool                # noqa: E402
import export_person_bridge as exporter               # noqa: E402  (salted_key parity only)
import review_person_bridge_offline as base           # noqa: E402

failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name}{(' -- ' + detail) if detail else ''}")
        failures.append(name)


def section(title: str) -> None:
    print(f"\n{title}")


def quiet(*_args, **_kwargs) -> None:
    return None


SALT = "AFLDB-ISSUE-222/v2"


def build(fixture: dict, **kwargs) -> dict:
    params = {"salt": SALT, "n": 2, "pinned": fixture["pinned_sample"],
              "child_expect": fixture["expect"]}
    params.update(kwargs)
    return tool.build(fixture["root"], **params)


def refusal(fn, *args, **kwargs) -> str | None:
    try:
        fn(*args, **kwargs)
    except base.ToolError as exc:
        return str(exc)
    return None


def run(fixture: dict, mode: str, **kwargs) -> tuple[int, list[str]]:
    lines: list[str] = []
    params = {"salt": SALT, "n": 2, "pinned": fixture["pinned_sample"],
              "child_expect": fixture["expect"], "emit": lines.append}
    params.update(kwargs)
    return tool.run(fixture["root"], mode=mode, **params), lines


def independent_key(salt: str, url: str) -> str:
    return hashlib.sha256((salt + "|" + url).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# 1. Clean build
# ---------------------------------------------------------------------------

section("1. Clean build on the fixture lineage")

clean = fx.new_fixture()
result = build(clean)
payload = result["payload"]
frame_expected = [fx.URL(6), fx.URL(7), fx.URL(8), fx.URL(9)]
check("1.1 the eligible frame is the non-census v2 bridges minus the v1 sample minus the "
      "adjudicated pack", result["frame"] == frame_expected, repr(result["frame"]))
check("1.2 the ranking is sha256(salt|url) ascending, ties by url (independent computation)",
      result["ranked"] == sorted(frame_expected, key=lambda u: (independent_key(SALT, u), u)))
check("1.3 the rows are the first n ranked persons with ordinals 1..n",
      [r["player_url"] for r in payload["rows"]] == result["ranked"][:2]
      and [r["ordinal"] for r in payload["rows"]] == [1, 2])
check("1.4 every selection_key equals export_person_bridge.salted_key (v1 formula parity)",
      all(r["selection_key"] == exporter.salted_key(SALT, r["player_url"])
          == tool.salted_key(SALT, r["player_url"]) for r in payload["rows"]))
check("1.5 the v2 census is derived from Stage A and equals the v1 census",
      result["census_v2"] == {fx.URL(1)} and payload["frame"]["census_equals_v1_census"] is True)
check("1.6 the frame accounting is exact",
      payload["frame"]["parent_bridges"] == 8 and payload["frame"]["census_v2"] == 1
      and payload["frame"]["non_census"] == 7
      and payload["frame"]["excluded_by_source"]
      == {"v1_census": 0, "v1_random": 2, "adjudicated_pack": 1}
      and payload["frame"]["excluded_union"] == 3 and payload["frame"]["eligible"] == 4,
      repr(payload["frame"]))
check("1.7 disjointness from the census, the v1 census, the v1 random stratum and the "
      "adjudicated pack is proven and recorded as zero overlaps",
      payload["disjointness"]["overlap_counts"]
      == {"census_v2": 0, "v1_census": 0, "v1_random": 0, "adjudicated_pack": 0}
      and payload["disjointness"]["prior_sample"]["sha256"] == clean["sha"]["review_sample_v1"]
      and payload["disjointness"]["prior_sample"]["census_total"] == 1
      and payload["disjointness"]["prior_sample"]["random_total"] == 2)
check("1.8 generated_utc is frozen to the validated child's generated_utc and the child is "
      "hash-linked with its validation summary",
      payload["generated_utc"] == fx.V2_CHILD_UTC
      and payload["child"]["sha256"] == clean["child_sha256"]
      and payload["child"]["validation"].startswith("PASS")
      and payload["prior_salt"] == fx.PRIOR_SALT and payload["salt"] == SALT
      and payload["n"] == 2)
check("1.9 every row carries the parent identity and the child status, and no verdict field",
      all(set(r) == {"ordinal", "player_url", "afltables_external_id", "child_status",
                     "selection_key"} for r in payload["rows"])
      and all(r["child_status"] in {"bridged", "target_not_registered"} for r in payload["rows"])
      and all(r["child_status"] == ("target_not_registered" if r["player_url"] == fx.URL(9)
                                    else "bridged") for r in payload["rows"])
      and payload["review"]["status"] == "UNREVIEWED")
check("1.10 the zero-failure bound is 1 - 0.05^(1/n), recorded beside n",
      payload["zero_failure_bound"]["n"] == 2
      and payload["zero_failure_bound"]["one_sided_95_upper_bound"]
      == round(1 - 0.05 ** 0.5, 6)
      and round(tool.zero_failure_upper_bound(598), 6) == 0.004997)
check("1.11 rows_sha256 is the sha256 of the canonical rows",
      payload["rows_sha256"] == base.sha256_bytes(base.canonical_json_bytes(payload["rows"])))
csv_text = result["outputs"]["sample_csv"].decode("utf-8")
check("1.12 the CSV is LF-only with the declared header and one line per row",
      "\r" not in csv_text and csv_text.splitlines()[0] == ",".join(tool.CSV_COLUMNS)
      and len(csv_text.splitlines()) == 3 and csv_text.endswith("\n"))
again = build(clean)
check("1.13 a second build reproduces both outputs byte-for-byte",
      again["outputs"] == result["outputs"])
other = build(clean, salt="AFLDB-ISSUE-222/v3")
check("1.14 a different salt produces different selection keys for every frame person",
      not ({tool.salted_key(SALT, u) for u in frame_expected}
           & {tool.salted_key("AFLDB-ISSUE-222/v3", u) for u in frame_expected})
      and other["payload"]["salt"] == "AFLDB-ISSUE-222/v3")
json_text = result["outputs"]["sample_json"].decode("utf-8")
check("1.15 no absolute path, DSN or credential appears in the outputs (the fixture root is "
      "an absolute temp path and is absent)",
      str(clean["root"]) not in json_text and str(clean["root"]).replace("\\", "\\\\")
      not in json_text and "postgres" not in json_text.lower())
check("1.16 every input and tool hash is recorded repository-relative",
      set(payload["inputs"]) == set(clean["pinned_sample"])
      and all(v["sha256"] == clean["pinned_sample"][k][1] for k, v in payload["inputs"].items())
      and set(payload["tool_hashes"]) == set(tool.TOOL_SOURCES)
      and all(len(v["sha256"]) == 64 and not v["path"].startswith("/")
              and ":" not in v["path"] for v in payload["tool_hashes"].values()))

# ---------------------------------------------------------------------------
# 2. Frame options and refusals
# ---------------------------------------------------------------------------

section("2. Frame options and refusals")

incl = build(clean, exclude_adjudicated=False, n=5)
check("2.1 --include-adjudicated returns the adjudicated bridged non-census person to the frame",
      incl["frame"] == [fx.URL(4)] + frame_expected
      and "adjudicated_pack" not in incl["payload"]["frame"]["excluded_by_source"]
      and incl["payload"]["frame"]["eligible"] == 5
      and "NOT excluded" in incl["payload"]["frame"]["exclusion_policy"])
msg = refusal(build, clean, n=5)
check("2.2 n larger than the eligible frame is refused", msg is not None and "exceeds" in msg,
      str(msg))
msg = refusal(build, clean, salt=fx.PRIOR_SALT)
check("2.3 reusing the prior sample's salt is refused", msg is not None and "differ" in msg,
      str(msg))
check("2.4 a salt containing '|' or a non-positive n is refused",
      refusal(build, clean, salt="a|b") is not None and refusal(build, clean, n=0) is not None)
census_shift = fx.new_fixture(top10=(1, 2))
msg = refusal(build, census_shift)
check("2.5 a v2 census that differs from the v1 census is refused (operator matter)",
      msg is not None and "census" in msg, str(msg))
gate = fx.new_fixture()
doc = fx.read_json(gate["root"], gate["child_rel"])
doc["kind"] = "source-evidence"
new_child_sha = fx.rewrite_json(gate["root"], gate["child_rel"], doc)
repinned = dict(gate["pinned_sample"])
repinned["child_v2_afldb_test"] = (gate["child_rel"], new_child_sha)
msg = refusal(build, gate, pinned=repinned)
check("2.6 a child that fails validation refuses generation (the gate)",
      msg is not None and "child validation failed" in msg, str(msg))
tampered = fx.new_fixture()
(tampered["root"] / tampered["rel"]["review_sample_v1"]).write_bytes(b"{}\n")
msg = refusal(build, tampered)
check("2.7 a pinned-input hash mismatch is refused before anything is computed",
      msg is not None and "sha256 mismatch" in msg, str(msg))
check("2.8 the tool exposes no overwrite flag",
      "allow-overwrite" not in (TOOL_DIR / "build_validation_sample.py").read_text(encoding="utf-8"))

# ---------------------------------------------------------------------------
# 3. Output lifecycle
# ---------------------------------------------------------------------------

section("3. Output lifecycle (validate-only writes nothing; write never overwrites)")

life = fx.new_fixture()
before = fx.snapshot(life["root"])
rc, lines = run(life, "validate-only")
check("3.1 validate-only exits 0 and writes nothing",
      rc == 0 and fx.snapshot(life["root"]) == before
      and all(not (life["root"] / rel).exists() for rel in tool.OUTPUTS.values())
      and lines and lines[-1].startswith("validate-only: nothing written"), str(lines[-2:]))
report = json.loads("\n".join(lines[:-1]))
check("3.2 validate-only reports both outputs absent with their would-be hashes",
      all(v["status"] == "absent" and len(v["sha256"]) == 64 for v in report["outputs"].values())
      and report["written"] is False)
rc, lines = run(life, "write")
expected = build(life)["outputs"]
check("3.3 write exits 0 and creates both outputs with the computed bytes",
      rc == 0 and all((life["root"] / tool.OUTPUTS[k]).read_bytes() == expected[k]
                      for k in tool.OUTPUTS)
      and json.loads("\n".join(lines[:-1]))["outputs"]["sample_json"]["status"] == "written")
rc2, lines2 = run(life, "write")
check("3.4 a second write exits 0 and reports both outputs identical",
      rc2 == 0 and all(v["status"] == "identical"
                       for v in json.loads("\n".join(lines2[:-1]))["outputs"].values()))
rc3, _ = run(life, "validate-only")
check("3.5 validate-only after a write exits 0", rc3 == 0)
csv_path = life["root"] / tool.OUTPUTS["sample_csv"]
csv_path.write_bytes(csv_path.read_bytes() + b"tampered\n")
json_before = (life["root"] / tool.OUTPUTS["sample_json"]).read_bytes()
rc4, lines4 = run(life, "write")
check("3.6 write refuses when an existing output differs and touches neither file",
      rc4 == 1 and csv_path.read_bytes().endswith(b"tampered\n")
      and (life["root"] / tool.OUTPUTS["sample_json"]).read_bytes() == json_before
      and lines4[-1].startswith("REFUSED"), str(lines4[-1:]))
rc5, lines5 = run(life, "validate-only")
check("3.7 validate-only exits 1 when an existing output differs",
      rc5 == 1 and any("DIFFERS" in line for line in lines5))
rc6, lines6 = run(life, "write", n=9)
check("3.8 a refusal inside run() is reported, not raised, with exit 1",
      rc6 == 1 and lines6 and lines6[-1].startswith("REFUSED"))

# ---------------------------------------------------------------------------
# 4. No database / network / import code path
# ---------------------------------------------------------------------------

section("4. No database / network / import code path")

SRC = (TOOL_DIR / "build_validation_sample.py").read_text(encoding="utf-8")
offenders = sorted(fx.imported_modules(SRC) & fx.FORBIDDEN_MODULES)
check("4.1 the generator imports no database, network, subprocess, GUI, importer or exporter "
      "module", not offenders, str(offenders))
env = fx.env_accesses(SRC)
check("4.2 the generator reads no environment variable", not env, "; ".join(env))
check("4.3 every frozen tool source exists in the repository",
      all((ROOT / rel).is_file() for rel in tool.TOOL_SOURCES.values()))
PROFILER_SRC = (TOOL_DIR / "profile_person_pages.py").read_text(encoding="utf-8")
check("4.4 the top-10 census helper module imports no network or database module either",
      not (fx.imported_modules(PROFILER_SRC) & fx.FORBIDDEN_MODULES))

# ---------------------------------------------------------------------------
# 5. Pinned Phase F constants (the real sample is never generated here)
# ---------------------------------------------------------------------------

section("5. Pinned Phase F constants")

check("5.1 the default salt is AFLDB-ISSUE-222/v2 and the default n is 598",
      tool.DEFAULT_SALT == "AFLDB-ISSUE-222/v2" and tool.DEFAULT_N == 598)
check("5.2 the ordering formula is the v1 formula with the new salt",
      tool.ORDERING_FORMULA == 'sha256(salt + "|" + player_url) hex ascending, ties by player_url')
check("5.3 the outputs are the v2 validation-sample JSON and CSV under docs/rebuild-manifests",
      tool.OUTPUTS == {
          "sample_json": "docs/rebuild-manifests/draftguru/bridge-validation-sample-20260918-v2.json",
          "sample_csv": "docs/rebuild-manifests/draftguru/bridge-validation-sample-20260918-v2.csv"})
check("5.4 the pinned inputs include the validated v2 child, the v1 review sample and the "
      "Stage A rows with the recorded hashes",
      tool.PINNED_INPUTS["child_v2_afldb_test"][1].startswith("b996c60e9d4de3ae")
      and tool.PINNED_INPUTS["review_sample_v1"][1].startswith("036cc0826428c03a")
      and tool.PINNED_INPUTS["stage_a_rows"][1].startswith("06936baca3b37133")
      and tool.PINNED_INPUTS["parent_v2"][1].startswith("ad25d965cba72b97"))
check("5.5 no output path is a pinned input path (nothing pinned can be overwritten)",
      not (set(tool.OUTPUTS.values()) & {rel for rel, _ in tool.PINNED_INPUTS.values()}))
check("5.6 the sample never carries a verdict field and declares itself unreviewed",
      "verdict" not in "".join(tool.CSV_COLUMNS)
      and "UNREVIEWED" in SRC and "any review verdict" in " ".join(tool.NOT_PERFORMED))

# ---------------------------------------------------------------------------

print()
if failures:
    print(f"{len(failures)} check(s) FAILED: {failures}")
    raise SystemExit(1)
print("All DraftGuru validation-sample checks hold.")
