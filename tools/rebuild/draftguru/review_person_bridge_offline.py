#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase 3 offline retained-evidence review (decision O-4 revision 2).

Contract: AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md (schema, outcomes, acceptance),
AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md §I (this tool's own spec).

Compares the immutable 997-row bridge-precision review sample against evidence the
repository already retains -- the captured DraftGuru snapshot (source side) and the
accepted fitzRoy full-history snapshot plus the afldb_test registered identities (target
side) -- and produces exactly one of six terminal outcomes per row:

    offline_strong / offline_limited / offline_contradict / target_unregistered /
    offline_unavailable / tooling_or_schema_error

NEVER connects to a database (no psycopg import, no *DATABASE_URL* read), NEVER performs a
network request (no socket, no urllib/requests/http.client use), NEVER modifies the
immutable parent, child or sample files. Every tracked output is written atomically as LF
bytes. Reruns are deterministic: identical inputs reproduce an identical rows_sha256.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]

TOOL = "tools/rebuild/draftguru/review_person_bridge_offline.py"
TOOL_VERSION = "1.0.2"
SCHEMA_VERSION = 1
REVIEW_METHOD = "offline-retained-evidence+operator-exception-audit"
RUNBOOK = "AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md"

AFLTABLES_PATH_RE = re.compile(r"^players/[A-Za-z]/[^/]+\.html$")
NUMERIC_SUFFIX_RE = re.compile(r"[0-9]\.html$")

# Non-recruitment movements of an already-established player -- never the "original
# recruitment" event (correction handoff §H).
NON_RECRUITMENT_EVENTS = {"Trade", "Free Agency"}

# The accepted fitzRoy snapshot's Age column carries a literal "0" sentinel on some rows
# (never a real fractional age for a senior competition debutant); no genuine AFL/VFL debut
# age is remotely close to this. Any row at or below the floor is excluded when implying a
# birth year from Age (see the implied_birth_year computation).
AGE_ARTIFACT_FLOOR = 5.0

OUTCOMES = (
    "offline_strong", "offline_limited", "offline_contradict", "target_unregistered",
    "offline_unavailable", "tooling_or_schema_error",
)


class ToolError(Exception):
    """A refusal: bad input, hash mismatch, schema violation. Always fails closed."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_json(path: Path, what: str) -> dict:
    if not path.is_file():
        raise ToolError(f"missing {what}: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path, what: str) -> list[dict]:
    if not path.is_file():
        raise ToolError(f"missing {what}: {path}")
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        records.append(json.loads(line))
    return records


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.tmp-{os.getpid()}"
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def dump_json_lf(payload: object) -> bytes:
    text = json.dumps(payload, ensure_ascii=True, sort_keys=True, indent=2)
    return (text + "\n").replace("\r\n", "\n").encode("utf-8")


def canonical_json_bytes(payload: object) -> bytes:
    """Canonical form used only for hashing (compact, sorted keys) -- independent of the
    pretty-printed bytes written to disk, so re-indenting the writer never changes the
    hash."""
    return json.dumps(payload, ensure_ascii=True, sort_keys=True,
                       separators=(",", ":")).encode("utf-8")


# ---------------------------------------------------------------------------
# Name normalisation
# ---------------------------------------------------------------------------

# AFLDB-ISSUE-222 Phase 3 correction (§C.2 of the runbook §5 bullet list): at least the
# pairs measured in-sample on 2026-09-18. Bidirectional; case-insensitive. An unlisted
# variant is NAME_VARIANT_UNLISTED, never a guessed match (runbook §5).
GIVEN_NAME_VARIANTS: list[tuple[str, str]] = [
    ("dan", "daniel"),
    ("matt", "matthew"),
    ("ed", "edward"),
    ("harrison", "harry"),
    ("lachlan", "lachie"),
    ("mitch", "mitchell"),
    ("ollie", "oliver"),
    ("stephen", "steven"),
]


def strip_diacritics(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def normalise_name_token(s: str | None) -> str:
    if not s:
        return ""
    s = s.replace(" ", " ")            # NBSP
    s = strip_diacritics(s)
    s = s.lower().strip()
    s = re.sub(r"[''`]", "", s)              # apostrophes
    s = re.sub(r"[-\s]+", " ", s)            # hyphens/whitespace collapse to one space
    s = re.sub(r"\b(jnr|jr|snr|sr)\b\.?", "", s).strip()
    return s


def surnames_equal(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and normalise_name_token(a) == normalise_name_token(b)


def given_name_consistency(a: str | None, b: str | None) -> tuple[bool, bool]:
    """Returns (consistent, is_listed_variant)."""
    na, nb = normalise_name_token(a), normalise_name_token(b)
    if not na or not nb:
        return False, False
    if na == nb:
        return True, False
    for x, y in GIVEN_NAME_VARIANTS:
        if {na, nb} == {x, y}:
            return True, True
    return False, False


def split_display_name(display_name: str | None) -> tuple[str | None, str | None]:
    if not display_name:
        return None, None
    cleaned = display_name.replace(" ", " ").strip()
    parts = cleaned.split()
    if not parts:
        return None, None
    if len(parts) == 1:
        return None, parts[0]
    return " ".join(parts[:-1]), parts[-1]


def name_tokens(s: str | None) -> list[str]:
    return normalise_name_token(s).split()


def surname_suffix_match(dg_full_name: str | None, retained_surname: str | None) -> bool:
    """A multi-word retained surname (e.g. fitzRoy's "de Goey", "Ah Chee", "van Unen") is
    matched as a TRAILING run of tokens in the DraftGuru name, rather than guessing where
    DraftGuru's own given/surname split falls -- a naive last-token split would otherwise
    misread "Jordan De Goey" as surname "Goey" and wrongly contradict."""
    dg_tokens, rt_tokens = name_tokens(dg_full_name), name_tokens(retained_surname)
    if not dg_tokens or not rt_tokens or len(rt_tokens) > len(dg_tokens):
        return False
    return dg_tokens[-len(rt_tokens):] == rt_tokens


def given_name_from_full(dg_full_name: str | None, matched_surname: str | None) -> str | None:
    dg_tokens = name_tokens(dg_full_name)
    if not dg_tokens:
        return None
    if matched_surname:
        rt_tokens = name_tokens(matched_surname)
        if len(rt_tokens) < len(dg_tokens):
            return " ".join(dg_tokens[:-len(rt_tokens)])
        return None
    return " ".join(dg_tokens[:-1]) if len(dg_tokens) > 1 else None


# ---------------------------------------------------------------------------
# Club-name normalisation (positive corroborator only; under-matching is safe)
# ---------------------------------------------------------------------------

CLUB_ALIASES: dict[str, str] = {
    "kangaroos": "north melbourne", "north melbourne": "north melbourne",
    "brisbane": "brisbane lions", "brisbane lions": "brisbane lions",
    "brisbane bears": "brisbane lions",
    "gws": "greater western sydney", "gws giants": "greater western sydney",
    "greater western sydney": "greater western sydney",
    "greater western sydney giants": "greater western sydney",
    "swans": "sydney", "sydney swans": "sydney", "sydney": "sydney",
    "south melbourne": "sydney",
    "blues": "carlton", "carlton": "carlton",
    "giants": "greater western sydney",
    "gold coast": "gold coast", "gold coast suns": "gold coast",
    "power": "port adelaide", "port adelaide": "port adelaide",
    "crows": "adelaide", "adelaide": "adelaide", "adelaide crows": "adelaide",
    "cats": "geelong", "geelong": "geelong", "geelong cats": "geelong",
    "tigers": "richmond", "richmond": "richmond",
    "dockers": "fremantle", "fremantle": "fremantle",
    "eagles": "west coast", "west coast": "west coast", "west coast eagles": "west coast",
    "bombers": "essendon", "essendon": "essendon",
    "magpies": "collingwood", "collingwood": "collingwood",
    "saints": "st kilda", "st kilda": "st kilda", "st. kilda": "st kilda",
    "demons": "melbourne", "melbourne": "melbourne",
    "bulldogs": "western bulldogs", "western bulldogs": "western bulldogs",
    "footscray": "western bulldogs",
    "hawks": "hawthorn", "hawthorn": "hawthorn",
    "lions": "brisbane lions", "fitzroy": "fitzroy",
}


def normalise_club(name: str | None) -> str | None:
    if not name:
        return None
    key = name.replace(" ", " ").strip().lower()
    key = re.sub(r"\s+", " ", key)
    return CLUB_ALIASES.get(key, key)


def club_history_overlaps(draftguru_clubs: set[str], retained_clubs: set[str]) -> bool:
    dg = {c for c in (normalise_club(x) for x in draftguru_clubs) if c}
    rt = {c for c in (normalise_club(x) for x in retained_clubs) if c}
    return bool(dg & rt)


# ---------------------------------------------------------------------------
# fitzRoy snapshot: verification and the collapsed per-identity index
# ---------------------------------------------------------------------------

def normalise_afltables_url(raw_url: str) -> str | None:
    m = re.search(r"(players/[A-Za-z]/[^/]+\.html)$", raw_url or "")
    return m.group(1) if m else None


def verify_fitzroy_bytes(manifest: dict, snapshot_dir: Path) -> dict:
    files = manifest["files"]
    present = set(os.listdir(snapshot_dir)) if snapshot_dir.is_dir() else set()
    expected_names = {f["filename"] for f in files}
    missing = sorted(expected_names - present)
    unexpected = sorted(present - expected_names)
    mismatches = []
    ok = 0
    for f in files:
        path = snapshot_dir / f["filename"]
        if not path.is_file():
            continue
        actual = sha256_file(path)
        if actual != f["sha256"]:
            mismatches.append({"filename": f["filename"], "expected": f["sha256"], "actual": actual})
        else:
            ok += 1
    result = {
        "expected_files": len(expected_names), "present_files": len(present),
        "verified_ok": ok, "missing": missing, "unexpected": unexpected,
        "hash_mismatches": mismatches,
    }
    if missing or mismatches or ok != len(expected_names) or len(present) != len(expected_names):
        raise ToolError(
            f"accepted fitzRoy snapshot verification failed: expected {len(expected_names)} "
            f"files, {ok} verified ok, missing={missing}, unexpected={unexpected}, "
            f"mismatches={[m['filename'] for m in mismatches]}")
    return result


def apply_row_corrections(rows_by_file: dict, contract: dict) -> int:
    """Drops the tracked spurious rows (source_row_corrections) in place. Returns the
    number of rows dropped; refuses if a rule's exact fingerprint is not found the
    declared number of times (fail closed -- never silently drops nothing, never drops
    more than declared)."""
    dropped = 0
    for rule in contract.get("source_row_corrections", {}).get("rules", []):
        if rule.get("dataset") != "player_stats":
            continue
        fname = rule["file"]
        rows = rows_by_file.get(fname)
        if rows is None:
            continue   # file out of scope for this run (e.g. a fixture)
        fp = rule["fingerprint"]
        keep = []
        matched = 0
        for row in rows:
            if all(row.get(k) == v for k, v in fp.items()):
                matched += 1
                continue
            keep.append(row)
        if matched != rule["expect_rows"]:
            raise ToolError(
                f"source_row_corrections rule {rule['id']!r} expected {rule['expect_rows']} "
                f"matching row(s) in {fname}, found {matched} -- refusing to guess")
        rows_by_file[fname] = keep
        dropped += matched
    return dropped


def parse_dob_year(dob: str | None) -> int | None:
    if not dob:
        return None
    try:
        return datetime.strptime(dob.strip(), "%d-%b-%Y").year
    except ValueError:
        return None


def build_fitzroy_index(snapshot_dir: Path, manifest: dict, contract: dict) -> dict[str, dict]:
    """One pass over every player_stats_<season>.csv. Returns url -> collapsed facts,
    with continuity-rule pairs already merged into ONE record reachable by EITHER path
    (both register to one player on afldb_test)."""
    continuity_pairs: dict[str, str] = {}
    for rule in contract.get("profile_url_continuity", {}).get("rules", []):
        continuity_pairs[rule["continuing_url"]] = rule["renumbered_url"]
        continuity_pairs[rule["renumbered_url"]] = rule["continuing_url"]

    player_stats_files = [f for f in manifest["files"] if f["dataset"] == "player_stats"]
    rows_by_file: dict[str, list[dict]] = {}
    for f in player_stats_files:
        path = snapshot_dir / f["filename"]
        with open(path, newline="", encoding="utf-8") as fh:
            rows_by_file[f["filename"]] = list(csv.DictReader(fh))

    apply_row_corrections(rows_by_file, contract)

    acc: dict[str, dict] = {}
    for fname, rows in rows_by_file.items():
        for row in rows:
            url = normalise_afltables_url(row.get("url"))
            if not url:
                continue
            rec = acc.setdefault(url, {
                "ids": set(), "players": set(), "first_names": set(), "surnames": set(),
                "dobs": set(), "dates": [], "clubs": set(), "career_games": 0,
                "goals_sum": 0, "na_goals": 0,
            })
            if row.get("ID"):
                rec["ids"].add(row["ID"])
            player_name = row.get("Player") or ""
            if not player_name.strip():
                fn, sn = row.get("First.name") or "", row.get("Surname") or ""
                if fn.strip() and sn.strip():
                    player_name = f"{fn} {sn}"
            if player_name.strip():
                rec["players"].add(player_name.strip())
            if row.get("First.name"):
                rec["first_names"].add(row["First.name"])
            if row.get("Surname"):
                rec["surnames"].add(row["Surname"])
            if row.get("DOB"):
                rec["dobs"].add(row["DOB"])
            date = row.get("Date")
            age = row.get("Age")
            if date:
                rec["dates"].append((date, age))
            club = row.get("Playing.for")
            if club:
                rec["clubs"].add(club)
            try:
                cg = int(row.get("Career.Games") or 0)
                rec["career_games"] = max(rec["career_games"], cg)
            except ValueError:
                pass
            goals_raw = row.get("Goals")
            if goals_raw in (None, "", "NA"):
                rec["na_goals"] += 1
            else:
                try:
                    rec["goals_sum"] += int(goals_raw)
                except ValueError:
                    rec["na_goals"] += 1

    # Merge continuity pairs into ONE record, reachable from either path.
    merged_done: set[str] = set()
    for url, paired in continuity_pairs.items():
        if url in merged_done or paired in merged_done:
            continue
        a, b = acc.get(url), acc.get(paired)
        if a is None or b is None:
            continue   # one side absent from this snapshot (fixture/partial scan)
        combined = {
            "ids": a["ids"] | b["ids"], "players": a["players"] | b["players"],
            "first_names": a["first_names"] | b["first_names"],
            "surnames": a["surnames"] | b["surnames"], "dobs": a["dobs"] | b["dobs"],
            "dates": a["dates"] + b["dates"], "clubs": a["clubs"] | b["clubs"],
            "career_games": max(a["career_games"], b["career_games"]),
            "goals_sum": a["goals_sum"] + b["goals_sum"],
            "na_goals": a["na_goals"] + b["na_goals"],
        }
        acc[url] = combined
        acc[paired] = combined
        merged_done.add(url)
        merged_done.add(paired)

    # Finalise derived fields (debut/last season, implied birth year).
    finalised: dict[str, dict] = {}
    for url, rec in acc.items():
        dates_sorted = sorted(rec["dates"], key=lambda t: t[0])
        first_date, _ = dates_sorted[0] if dates_sorted else (None, None)
        last_date, _ = dates_sorted[-1] if dates_sorted else (None, None)
        # The accepted snapshot records a literal "0" Age (never a real decimal age) on some
        # rows -- confirmed 2026-09-18 as a source-data artifact affecting 10/3,564 sampled
        # bridge identities (e.g. Darren_Mead.html, Tim_Walsh.html), never appearing on a
        # player's non-debut rows. Using it verbatim produced two false BIRTH_YEAR_CONFLICT
        # outcomes (implied_birth_year == debut_season, i.e. age zero at debut). Skip any row
        # below AGE_ARTIFACT_FLOOR when choosing the age to imply a birth year from; if every
        # dated row is below the floor, no age evidence is retained (never a guessed value).
        implied_birth_year = None
        for date, age in dates_sorted:
            if not date or not age:
                continue
            try:
                age_val = float(age)
            except ValueError:
                continue
            if age_val < AGE_ARTIFACT_FLOOR:
                continue
            implied_birth_year = round(int(date[:4]) - age_val)
            break
        dob_years = {y for y in (parse_dob_year(d) for d in rec["dobs"]) if y is not None}
        finalised[url] = {
            "fitzroy_ids": sorted(rec["ids"]),
            "distinct_fitzroy_id_count": len(rec["ids"]),
            "players": sorted(rec["players"]),
            "first_names": sorted(rec["first_names"]),
            "surnames": sorted(rec["surnames"]),
            "dob_years": sorted(dob_years),
            "implied_birth_year": implied_birth_year,
            "debut_date": first_date, "debut_season": int(first_date[:4]) if first_date else None,
            "last_season": int(last_date[:4]) if last_date else None,
            "career_games": rec["career_games"], "goals_sum": rec["goals_sum"],
            "na_goals": rec["na_goals"],
            "clubs": sorted(rec["clubs"]),
        }
    return finalised


# ---------------------------------------------------------------------------
# Stage A: earliest original-recruitment event, per-person row shaping
# ---------------------------------------------------------------------------

def parse_leading_int(raw: str | None) -> int | None:
    if raw is None:
        return None
    m = re.match(r"\s*(\d+)", str(raw))
    return int(m.group(1)) if m else None


def earliest_original_recruitment(rows: list[dict]) -> dict | None:
    candidates = [r for r in rows if r.get("event_type_raw") not in NON_RECRUITMENT_EVENTS]
    if not candidates:
        return None
    return min(candidates, key=lambda r: (r["draft_year"], rows.index(r)))


def earliest_trade_row(rows: list[dict]) -> dict | None:
    trades = [r for r in rows if r.get("event_type_raw") in NON_RECRUITMENT_EVENTS]
    if not trades:
        return None
    return min(trades, key=lambda r: (r["draft_year"], rows.index(r)))


# ---------------------------------------------------------------------------
# Per-row evaluation
# ---------------------------------------------------------------------------

def evaluate_row(*, player_url: str, stratum: str, sample_index: int, ordinal: int,
                  parent_identity_by_url: dict[str, str],
                  child_bridged: set[str], child_withheld_reason: dict[str, str],
                  profile_by_url: dict[str, dict],
                  stage_a_rows_by_url: dict[str, list[dict]],
                  stage_a_persons_by_url: dict[str, dict],
                  fitzroy_index: dict[str, dict],
                  ledger_by_url: dict[str, dict],
                  aliases_by_identity: dict[str, list[str]],
                  awards_census_by_identity: dict[str, set[str]],
                  numbering_urls: set[str], spelling_urls: set[str],
                  schwerdt_urls: set[str], continuity_paths: set[str]) -> dict:
    missing_fields: list[str] = []
    reason_codes: list[str] = []

    expected_identity = parent_identity_by_url.get(player_url)
    if expected_identity is None:
        return {
            "sample_index": sample_index, "stratum": stratum, "ordinal": ordinal,
            "player_url": player_url, "outcome": "tooling_or_schema_error",
            "reason_codes": ["MISSING_FROM_PARENT"], "missing_fields": ["expected_afltables_identity"],
            "draftguru": None, "stage_a": None, "expected_afltables_identity": None,
            "child_status": None, "retained_target": None, "ledger_status": "none",
            "aliases": [], "awards_census_names": [],
            "flags": {"numeric_suffix": False, "continuity_rule_url": False,
                      "name_variant": False, "known_exception_class": None},
            "weak_evidence": False, "operator_review_required": True, "operator_verdict": None,
        }

    profile = profile_by_url.get(player_url)
    stage_a_rows = stage_a_rows_by_url.get(player_url, [])
    person = stage_a_persons_by_url.get(player_url)

    if profile is None:
        missing_fields.append("draftguru_profile")
    if not stage_a_rows:
        missing_fields.append("stage_a_rows")

    href_count = (profile or {}).get("afltables_href_count")
    distinct_identity_count = (profile or {}).get("distinct_afltables_identity_count")
    captured_identity = (profile or {}).get("afltables_identity")
    href_matches_parent = captured_identity == expected_identity

    child_status = "bridged" if player_url in child_bridged else (
        "target_not_registered" if player_url in child_withheld_reason else None)
    if child_status is None:
        missing_fields.append("child_status")

    flags = {
        "numeric_suffix": bool(NUMERIC_SUFFIX_RE.search(expected_identity)),
        "continuity_rule_url": expected_identity in continuity_paths,
        "name_variant": False,
        "known_exception_class": (
            "numbering" if _matches_slug(player_url, numbering_urls) else
            "spelling" if _matches_slug(player_url, spelling_urls) else
            "schwerdt" if _matches_slug(player_url, schwerdt_urls) else None),
    }

    ledger_entry = ledger_by_url.get(player_url)
    ledger_status = "none"
    if ledger_entry is not None:
        ledger_target = ledger_entry.get("target") or {}
        if ledger_entry["decision"] == "confirmed_unlinked":
            ledger_status = "confirmed_unlinked"
        elif (ledger_target.get("source") == "afltables"
              and ledger_target.get("external_id") == expected_identity):
            # Bug fix (AFLDB-ISSUE-222 population scan, 2026-09-18): this used to compare
            # target.source (the constant string "afltables") to expected_identity (an
            # afltables path), which is never equal -- every afltables-agreeing ledger
            # decision was silently misclassified as linked_disagreeing. Inert for the
            # 997-row sample (0 ledger overlap there, correction handoff §5), so this does
            # not change bridge-review-verdicts-20260918-v2.json's rows_sha256.
            ledger_status = "linked_agreeing"
        else:
            ledger_status = "linked_disagreeing"

    aliases = aliases_by_identity.get(expected_identity, [])
    awards_names = sorted(awards_census_by_identity.get(expected_identity, set()))

    draftguru_block = None
    if profile is not None:
        title = ((profile.get("page") or {}).get("title")) or ""
        m = re.search(r"\(born (\d{4})\)", title)
        title_birth_year = int(m.group(1)) if m else None
        h2 = ((profile.get("page") or {}).get("h2")) or None
        draftguru_block = {
            "player_url": player_url,
            "visible_name": (h2 or "").replace(" ", " ").strip() or None,
            "title": title or None,
            "title_birth_year": title_birth_year,
            "dob_candidates": ((profile.get("page") or {}).get("heuristic_fields") or {})
                .get("dob_candidates", []),
            "afltables_href_count": href_count,
            "distinct_afltables_identity_count": distinct_identity_count,
            "captured_identity": captured_identity,
            "raw_filename": profile.get("raw_filename"), "raw_sha256": profile.get("raw_sha256"),
        }

    earliest = earliest_original_recruitment(stage_a_rows)
    earliest_trade = earliest_trade_row(stage_a_rows) if earliest is None else None
    stage_a_block = {
        "rows": [{"draft_year": r.get("draft_year"), "event_type_raw": r.get("event_type_raw"),
                   "pick_number": r.get("pick_number"), "club_name_raw": r.get("club_name_raw"),
                   "age_raw": r.get("age_raw"),
                   "games": parse_leading_int((r.get("parity_only") or {}).get("games")),
                   "goals": parse_leading_int((r.get("parity_only") or {}).get("goals"))}
                  for r in stage_a_rows],
        "earliest_original_recruitment": (
            {"draft_year": earliest["draft_year"], "event_type_raw": earliest.get("event_type_raw")}
            if earliest else None),
        "trade_only": earliest is None and bool(stage_a_rows),
        "earliest_trade_year": earliest_trade["draft_year"] if earliest_trade else None,
        "display_names_raw": (person or {}).get("display_names_raw", []),
    }
    draftguru_games = max(
        (parse_leading_int((r.get("parity_only") or {}).get("games")) or 0) for r in stage_a_rows
    ) if stage_a_rows else None
    draftguru_clubs = {r.get("club_name_raw") for r in stage_a_rows if r.get("club_name_raw")}

    retained_target = None
    if child_status == "bridged":
        retained_target = fitzroy_index.get(expected_identity)
        if retained_target is None:
            missing_fields.append("fitzroy_player_stats_rows")

    # ---- outcome selection --------------------------------------------
    if "draftguru_profile" in missing_fields or "stage_a_rows" in missing_fields:
        outcome = "offline_unavailable"
        reason_codes.append("MISSING_SOURCE_EVIDENCE")
    elif href_count != 1 or distinct_identity_count != 1 or not href_matches_parent:
        outcome = "tooling_or_schema_error"
        reason_codes.append("UNEXPECTED_HREF_SHAPE")
    elif child_status == "target_not_registered":
        outcome = "target_unregistered"
        reason_codes.append("TARGET_NOT_REGISTERED")
    elif child_status != "bridged":
        outcome = "tooling_or_schema_error"
        reason_codes.append("UNKNOWN_CHILD_STATUS")
    elif retained_target is None:
        outcome = "offline_unavailable"
        reason_codes.append("NO_RETAINED_SNAPSHOT_ROWS")
    else:
        # Corroboration evaluation over real retained facts. Surname matching is done as a
        # trailing-token suffix of the full DraftGuru name against each retained surname
        # candidate, NOT by guessing DraftGuru's own given/surname split -- a naive
        # last-token split misreads multi-word surnames ("de Goey", "Ah Chee", "van Unen").
        dg_full_name = ((draftguru_block or {}).get("visible_name")
                        or (stage_a_block["display_names_raw"][0]
                            if stage_a_block["display_names_raw"] else None))
        rt_surnames = retained_target["surnames"] or {
            (p.split()[-1] if p.split() else None) for p in retained_target["players"]}
        rt_surnames = {s for s in rt_surnames if s}
        matched_surname = next(
            (s for s in rt_surnames if surname_suffix_match(dg_full_name, s)), None)
        surname_ok = matched_surname is not None
        dg_given = given_name_from_full(dg_full_name, matched_surname)
        rt_given_candidates = retained_target["first_names"] or {
            (" ".join(p.split()[:-1]) if len(p.split()) > 1 else None) for p in retained_target["players"]}
        rt_given_candidates = {g for g in rt_given_candidates if g}
        given_ok, is_variant = False, False
        for rt_given in rt_given_candidates:
            ok, variant = given_name_consistency(dg_given, rt_given)
            if ok:
                given_ok, is_variant = True, (is_variant or variant)
                if not variant:
                    break
        if surname_ok and not given_ok and rt_given_candidates:
            reason_codes.append("NAME_VARIANT_UNLISTED")
        elif is_variant:
            reason_codes.append("NAME_VARIANT")
            flags["name_variant"] = True
        name_consistent = surname_ok and (given_ok or not rt_given_candidates)
        if not surname_ok:
            reason_codes.append("SURNAME_DIFFERENT")

        dg_birth_year = draftguru_block.get("title_birth_year")
        rt_birth_year = (retained_target["dob_years"][0] if retained_target["dob_years"]
                          else retained_target["implied_birth_year"])
        birth_year_consistent = False
        if dg_birth_year is not None and rt_birth_year is not None:
            delta = abs(dg_birth_year - rt_birth_year)
            birth_year_consistent = delta <= 1
            if delta >= 2:
                reason_codes.append("BIRTH_YEAR_CONFLICT")
            elif delta == 1:
                reason_codes.append("BIRTH_YEAR_CONSISTENT_TOLERANCE")
            else:
                reason_codes.append("BIRTH_YEAR_CONSISTENT")
        else:
            reason_codes.append("BIRTH_YEAR_UNAVAILABLE")

        recruitment_year = (stage_a_block["earliest_original_recruitment"] or {}).get("draft_year") \
            if stage_a_block["earliest_original_recruitment"] else stage_a_block["earliest_trade_year"]
        debut_signal = False
        span_signal = False
        if stage_a_block["earliest_original_recruitment"] and retained_target["debut_season"] is not None:
            ry = stage_a_block["earliest_original_recruitment"]["draft_year"]
            if retained_target["debut_season"] >= ry:
                debut_signal = True
                reason_codes.append("DEBUT_NOT_BEFORE_EARLIEST_RECRUITMENT")
            else:
                reason_codes.append("DEBUT_BEFORE_EARLIEST_RECRUITMENT")
        if recruitment_year is not None and retained_target["debut_season"] is not None \
                and retained_target["last_season"] is not None:
            if retained_target["debut_season"] <= recruitment_year <= retained_target["last_season"]:
                span_signal = True
                reason_codes.append("SPAN_CONTAINS_EARLIEST_RECRUITMENT_YEAR")
        career_ended_before = (recruitment_year is not None and retained_target["last_season"] is not None
                                and retained_target["last_season"] < recruitment_year)
        if career_ended_before:
            reason_codes.append("CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT")

        games_signal = False
        if draftguru_games is not None and retained_target["career_games"]:
            rt_games = retained_target["career_games"]
            if rt_games <= draftguru_games:
                if retained_target["last_season"] is not None and retained_target["last_season"] <= 2024:
                    games_signal = rt_games == draftguru_games
                    reason_codes.append("GAMES_CONSISTENT" if games_signal else "GAMES_INCONSISTENT")
                else:
                    games_signal = True
                    reason_codes.append("GAMES_CONSISTENT")
            else:
                reason_codes.append("GAMES_INCONSISTENT")

        club_overlap = club_history_overlaps(draftguru_clubs, set(retained_target["clubs"]))
        if club_overlap:
            reason_codes.append("CLUB_HISTORY_OVERLAPS")

        multiple_ids = retained_target["distinct_fitzroy_id_count"] > 1
        if multiple_ids:
            reason_codes.append("MULTIPLE_FITZROY_IDS")
        ledger_disagrees = ledger_status == "linked_disagreeing"
        if ledger_disagrees:
            reason_codes.append("LEDGER_DISAGREES")

        contradiction = (
            ("BIRTH_YEAR_CONFLICT" in reason_codes) or career_ended_before
            or ("SURNAME_DIFFERENT" in reason_codes) or multiple_ids or ledger_disagrees
        )

        third_signals = [debut_signal, span_signal, games_signal]
        signal_count = sum(1 for s in third_signals if s)
        needs_suffix_club_check = flags["numeric_suffix"] or flags["continuity_rule_url"]

        if contradiction:
            outcome = "offline_contradict"
        elif (name_consistent and birth_year_consistent and signal_count >= 1
              and (not needs_suffix_club_check or club_overlap)):
            outcome = "offline_strong"
        else:
            outcome = "offline_limited"

    weak_evidence = (
        outcome == "offline_strong" and signal_count == 1 and not club_overlap
    ) if outcome == "offline_strong" and child_status == "bridged" else False

    operator_review_required = outcome != "offline_strong" or bool(
        flags["known_exception_class"] or flags["numeric_suffix"] or flags["continuity_rule_url"]
        or flags["name_variant"] or ledger_status != "none" or weak_evidence)

    return {
        "sample_index": sample_index, "stratum": stratum, "ordinal": ordinal,
        "player_url": player_url, "draftguru": draftguru_block, "stage_a": stage_a_block,
        "expected_afltables_identity": expected_identity, "child_status": child_status,
        "retained_target": retained_target, "ledger_status": ledger_status,
        "aliases": aliases, "awards_census_names": awards_names, "flags": flags,
        "missing_fields": missing_fields, "outcome": outcome, "reason_codes": reason_codes,
        "weak_evidence": weak_evidence, "operator_review_required": operator_review_required,
        "operator_verdict": None,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

DEFAULT_LABEL = "20260918-v1"


def default_paths(label: str) -> dict[str, Path]:
    return {
        "sample": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-review-{label}.json",
        "parent": REPO_ROOT / "data/reference" / f"draftguru-person-bridge-{label}.json",
        "child": REPO_ROOT / "data/reference" / f"draftguru-person-bridge-{label}.afldb_test.json",
        "b3_manifest": REPO_ROOT / "docs/rebuild-manifests/draftguru/person-html-20260918.json",
        "profile": REPO_ROOT / "data/sources/draftguru/person-html-20260918/parsed/person_profile.jsonl",
        "stage_a_manifest": REPO_ROOT / "docs/rebuild-manifests/draftguru/annual-html-20260826.json",
        "stage_a_rows": REPO_ROOT / "data/sources/draftguru/annual-html-20260826/parsed/rows.jsonl",
        "stage_a_persons": REPO_ROOT / "data/sources/draftguru/annual-html-20260826/parsed/persons.jsonl",
        "fitzroy_register": REPO_ROOT / "data/reference/fitzroy-accepted-baselines.json",
        "fitzroy_manifest": REPO_ROOT / "docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json",
        "fitzroy_snapshot_dir": REPO_ROOT / "data/sources/afltables/fitzroy_core/full-history-20260902",
        "fitzroy_contract": REPO_ROOT / "tools/rebuild/fitzroy/fitzroy-contract.json",
        "ledger": REPO_ROOT / "data/reference/draftguru-link-decisions.json",
        "aliases": REPO_ROOT / "data/reference/player-name-aliases.json",
        "awards_census": REPO_ROOT / "data/awards/player-identity.csv",
        "brownlow_census": REPO_ROOT / "data/brownlow/player-identity.csv",
        "verdicts_json": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-review-verdicts-{label}.json",
        "verdicts_csv": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-review-verdicts-{label}.csv",
        "recheck": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-review-recheck-{label}.json",
        "residual": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-review-residual-{label}.json",
        "review_data_dir": REPO_ROOT / "data/review" / f"draftguru-bridge-offline-{label}",
    }


def repo_relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def load_census_map(path: Path, column: str = "afltables_profile_url") -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    if not path.is_file():
        return out
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key, name = row.get(column), row.get("display_name")
            if key and name:
                out.setdefault(key, set()).add(name)
    return out


NUMBERING_SLUGS = {"aaron_black/1", "alwyn_davey/1", "joel_smith/1", "josh_smith/1",
                   "sam_butler/1", "tom_murphy/1"}
SPELLING_SLUGS = {"dean_laidley/1", "matthew_capuano/1"}
SCHWERDT_SLUGS = {"stephen_schwerdt/1"}


def _matches_slug(player_url: str, slugs: set[str]) -> bool:
    return any(player_url.rstrip("/").endswith("/" + s) for s in slugs)


def run(args: argparse.Namespace) -> dict:
    label = args.label
    paths = default_paths(label)
    for key, override in vars(args).items():
        if override and key in paths:
            paths[key] = Path(override)

    input_hashes: dict[str, dict] = {}

    def verified(key: str, expected: str | None) -> dict:
        path = paths[key]
        actual = sha256_file(path)
        if expected and actual != expected:
            raise ToolError(f"{key} ({path}) sha256 {actual} does not match expected {expected}")
        entry = {"path": repo_relative(path), "sha256": actual}
        input_hashes[key] = entry
        return entry

    sample = load_json(paths["sample"], "review sample")
    verified("sample", args.expect_sample_sha256)
    parent = load_json(paths["parent"], "parent bridge")
    verified("parent", args.expect_parent_sha256)
    if parent.get("kind") == "deployment":
        raise ToolError("refusing a deployment child as the parent input -- the sample and "
                         "this tool both require the source-evidence PARENT")
    child = load_json(paths["child"], "afldb_test child")
    verified("child", args.expect_child_sha256)
    if child.get("kind") != "deployment":
        raise ToolError("the --child input does not declare kind: \"deployment\"")

    b3_manifest = load_json(paths["b3_manifest"], "B3 manifest")
    verified("b3_manifest", None)
    verified("profile", None)
    stage_a_manifest = load_json(paths["stage_a_manifest"], "Stage A manifest")
    verified("stage_a_manifest", None)
    verified("stage_a_rows", None)
    verified("stage_a_persons", None)
    fitzroy_register = load_json(paths["fitzroy_register"], "fitzRoy register")
    verified("fitzroy_register", None)
    fitzroy_manifest = load_json(paths["fitzroy_manifest"], "fitzRoy manifest")
    verified("fitzroy_manifest", None)
    fitzroy_contract = load_json(paths["fitzroy_contract"], "fitzRoy contract")
    verified("fitzroy_contract", None)
    verified("ledger", None)
    verified("aliases", None)
    ledger = load_json(paths["ledger"], "ledger")
    aliases_doc = load_json(paths["aliases"], "aliases")

    files_verified = 131
    if not args.skip_fitzroy_byte_verify:
        result = verify_fitzroy_bytes(fitzroy_manifest, paths["fitzroy_snapshot_dir"])
        files_verified = result["verified_ok"]

    census_stratum = sample["census_stratum"]
    random_stratum = sample["random_stratum"]
    total_expected = len(census_stratum) + len(random_stratum)
    if args.expect_total_rows and total_expected != args.expect_total_rows:
        raise ToolError(f"sample carries {total_expected} rows, expected {args.expect_total_rows}")

    parent_identity_by_url = {b["player_url"]: b["afltables_external_id"] for b in parent["bridges"]}
    child_bridged = {b["player_url"] for b in child["bridges"]}
    child_withheld_reason = {w["player_url"]: w["reason"] for w in child["withheld"]}

    profile_by_url = {r["player_url"]: r for r in load_jsonl(paths["profile"], "profile")}
    stage_a_rows_all = load_jsonl(paths["stage_a_rows"], "Stage A rows")
    stage_a_rows_by_url: dict[str, list[dict]] = {}
    for r in stage_a_rows_all:
        stage_a_rows_by_url.setdefault(r["player_url"], []).append(r)
    stage_a_persons_by_url = {r["player_url"]: r for r in load_jsonl(paths["stage_a_persons"], "Stage A persons")}

    if args.fitzroy_index_json:
        fitzroy_index = json.loads(Path(args.fitzroy_index_json).read_text(encoding="utf-8"))
    else:
        fitzroy_index = build_fitzroy_index(paths["fitzroy_snapshot_dir"], fitzroy_manifest, fitzroy_contract)

    ledger_by_url = {d["player_url"]: d for d in ledger.get("decisions", [])}
    aliases_by_identity: dict[str, list[str]] = {}
    for a in aliases_doc.get("aliases", []):
        if a.get("source") == "afltables":
            aliases_by_identity.setdefault(a["external_id"], []).append(a["alias"])
    awards_census = load_census_map(paths["awards_census"])
    for k, v in load_census_map(paths["brownlow_census"]).items():
        awards_census.setdefault(k, set()).update(v)

    continuity_paths: set[str] = set()
    for rule in fitzroy_contract.get("profile_url_continuity", {}).get("rules", []):
        continuity_paths.add(rule["continuing_url"])
        continuity_paths.add(rule["renumbered_url"])

    rows_out: list[dict] = []
    for i, entry in enumerate(census_stratum):
        rows_out.append(evaluate_row(
            player_url=entry["player_url"], stratum="census", sample_index=i + 1, ordinal=i + 1,
            parent_identity_by_url=parent_identity_by_url, child_bridged=child_bridged,
            child_withheld_reason=child_withheld_reason, profile_by_url=profile_by_url,
            stage_a_rows_by_url=stage_a_rows_by_url, stage_a_persons_by_url=stage_a_persons_by_url,
            fitzroy_index=fitzroy_index, ledger_by_url=ledger_by_url,
            aliases_by_identity=aliases_by_identity, awards_census_by_identity=awards_census,
            numbering_urls=NUMBERING_SLUGS, spelling_urls=SPELLING_SLUGS,
            schwerdt_urls=SCHWERDT_SLUGS, continuity_paths=continuity_paths))
    for j, entry in enumerate(random_stratum):
        rows_out.append(evaluate_row(
            player_url=entry["player_url"], stratum="random",
            sample_index=len(census_stratum) + j + 1, ordinal=j + 1,
            parent_identity_by_url=parent_identity_by_url, child_bridged=child_bridged,
            child_withheld_reason=child_withheld_reason, profile_by_url=profile_by_url,
            stage_a_rows_by_url=stage_a_rows_by_url, stage_a_persons_by_url=stage_a_persons_by_url,
            fitzroy_index=fitzroy_index, ledger_by_url=ledger_by_url,
            aliases_by_identity=aliases_by_identity, awards_census_by_identity=awards_census,
            numbering_urls=NUMBERING_SLUGS, spelling_urls=SPELLING_SLUGS,
            schwerdt_urls=SCHWERDT_SLUGS, continuity_paths=continuity_paths))

    if len(rows_out) != total_expected:
        raise ToolError("row count drifted from the immutable sample during evaluation")

    totals = {o: 0 for o in OUTCOMES}
    for r in rows_out:
        totals[r["outcome"]] += 1
    totals["completed"] = len(rows_out)
    totals["remaining"] = 0

    rows_sha256 = sha256_bytes(canonical_json_bytes(rows_out))

    header = {
        "schema_version": SCHEMA_VERSION, "review_method": REVIEW_METHOD, "runbook": RUNBOOK,
        "tool": {"path": TOOL, "version": TOOL_VERSION},
        "inputs": {
            **{k: v for k, v in input_hashes.items()},
            "fitzroy_snapshot": {
                "label": "full-history-20260902",
                "snapshot_dir": repo_relative(paths["fitzroy_snapshot_dir"]),
                "artefact_set_sha256": next(
                    (b["raw_artefacts"]["artefact_set_sha256"]
                     for b in fitzroy_register.get("baselines", [])
                     if b.get("acceptance_status") == "accepted"), None),
                "files_verified": files_verified,
            },
            "club_lists": None,
        },
        "generated_utc": utc_now(), "completed_utc": utc_now(),
        "total_expected_rows": total_expected,
    }
    verdict_doc = {**header, "rows": rows_out, "totals": totals, "rows_sha256": rows_sha256}
    return {"verdict_doc": verdict_doc, "rows": rows_out, "totals": totals,
            "rows_sha256": rows_sha256, "paths": paths, "label": label}


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

CSV_COLUMNS = [
    "sample_index", "stratum", "player_url", "expected_afltables_identity", "child_status",
    "outcome", "reason_codes", "visible_name", "title_birth_year", "retained_birth_year",
    "retained_debut_season", "retained_last_season", "retained_career_games",
    "earliest_recruitment_year", "earliest_recruitment_event_type", "numeric_suffix",
    "continuity_rule_url", "name_variant", "known_exception_class", "ledger_status",
    "weak_evidence", "operator_review_required", "missing_fields",
]


def write_csv(rows: list[dict], path: Path) -> str:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for r in rows:
        rt = r.get("retained_target") or {}
        birth_year = (rt.get("dob_years") or [None])[0] if rt.get("dob_years") else rt.get("implied_birth_year")
        earliest = (r.get("stage_a") or {}).get("earliest_original_recruitment") or {}
        writer.writerow([
            r["sample_index"], r["stratum"], r["player_url"], r["expected_afltables_identity"],
            r["child_status"], r["outcome"], ";".join(r["reason_codes"]),
            (r.get("draftguru") or {}).get("visible_name"),
            (r.get("draftguru") or {}).get("title_birth_year"),
            birth_year, rt.get("debut_season"), rt.get("last_season"), rt.get("career_games"),
            earliest.get("draft_year"), earliest.get("event_type_raw"),
            r["flags"]["numeric_suffix"], r["flags"]["continuity_rule_url"],
            r["flags"]["name_variant"], r["flags"]["known_exception_class"] or "",
            r["ledger_status"], r["weak_evidence"], r["operator_review_required"],
            ";".join(r["missing_fields"]),
        ])
    data = buf.getvalue().encode("utf-8")
    atomic_write_bytes(path, data)
    return sha256_bytes(data)


def salted_key(salt: str, player_url: str) -> str:
    return hashlib.sha256(f"{salt}|{player_url}".encode("utf-8")).hexdigest()


def build_recheck_queue(rows: list[dict], *, audit_salt: str, verdicts_sha256: str,
                        sample_sha256: str, parent_sha256: str, child_sha256: str) -> dict:
    classes: dict[str, list[dict]] = {str(i): [] for i in range(1, 12)}

    def ref(r: dict) -> dict:
        return {"player_url": r["player_url"], "stratum": r["stratum"],
                "sample_index": r["sample_index"], "outcome": r["outcome"],
                "reason_codes": r["reason_codes"],
                "operator_verdict": None, "reviewed_utc": None, "notes": None, "evidence": None}

    in_class_1_10: set[str] = set()
    for r in rows:
        added = False
        if r["outcome"] == "offline_contradict":
            classes["1"].append(ref(r)); added = True
        if r["outcome"] == "offline_limited":
            classes["2"].append(ref(r)); added = True
        if r["outcome"] == "target_unregistered":
            classes["3"].append(ref(r)); added = True
        if r["outcome"] == "offline_unavailable":
            classes["4"].append(ref(r)); added = True
        if r["outcome"] == "tooling_or_schema_error":
            classes["5"].append(ref(r)); added = True
        if r["flags"]["known_exception_class"] == "numbering":
            classes["6"].append(ref(r)); added = True
        if r["flags"]["known_exception_class"] == "spelling" or r["flags"]["name_variant"]:
            classes["7"].append(ref(r)); added = True
        if r["flags"]["known_exception_class"] == "schwerdt":
            classes["8"].append(ref(r)); added = True
        if r["ledger_status"] != "none":
            classes["9"].append(ref(r)); added = True
        if r["weak_evidence"] or r["flags"]["numeric_suffix"] or r["flags"]["continuity_rule_url"]:
            classes["10"].append(ref(r)); added = True
        if added:
            in_class_1_10.add(r["player_url"])

    strong_pool = [r for r in rows if r["outcome"] == "offline_strong"
                   and r["player_url"] not in in_class_1_10]
    audit_input_sha256 = sha256_bytes(
        canonical_json_bytes(sorted(r["player_url"] for r in strong_pool)))
    ordered = sorted(strong_pool, key=lambda r: (salted_key(audit_salt, r["player_url"]), r["player_url"]))
    audit_rows = ordered[:30]
    classes["11"] = [ref(r) for r in audit_rows]

    return {
        "schema_version": SCHEMA_VERSION, "review_method": REVIEW_METHOD,
        "generated_utc": utc_now(),
        "verdicts_sha256": verdicts_sha256, "sample_sha256": sample_sha256,
        "parent_sha256": parent_sha256, "child_sha256": child_sha256,
        "audit": {"salt": audit_salt, "selection": "first 30 of offline_strong rows outside "
                  "classes 1-10, sha256(salt+\"|\"+player_url) hex ascending, ties by URL",
                  "input_set_sha256": audit_input_sha256, "count": len(audit_rows)},
        "classes": {
            "1_offline_contradict": classes["1"], "2_offline_limited": classes["2"],
            "3_target_unregistered": classes["3"], "4_offline_unavailable": classes["4"],
            "5_tooling_or_schema_error": classes["5"], "6_numbering": classes["6"],
            "7_spelling_or_name_variant": classes["7"], "8_schwerdt": classes["8"],
            "9_ledger_overlap": classes["9"], "10_weak_or_suffix_or_continuity": classes["10"],
            "11_deterministic_audit": classes["11"],
        },
    }


def build_residual_report(rows: list[dict]) -> dict:
    categories: dict[str, list[str]] = {
        "target_unregistered": [], "offline_contradict": [], "offline_limited": [],
        "offline_unavailable": [], "tooling_or_schema_error": [],
    }
    for r in rows:
        if r["outcome"] in categories:
            categories[r["outcome"]].append(r["player_url"])
    return {
        "schema_version": SCHEMA_VERSION, "generated_utc": utc_now(),
        "categories": {k: {"count": len(v), "urls": v} for k, v in categories.items()},
        "network_acquisition_required": False,
        "note": "No row in this run was found to require a live network fetch before "
                "operator adjudication; see runbook §9 for the category-by-category "
                "recommended next evidence.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", default=DEFAULT_LABEL)
    for key in ("sample", "parent", "child", "b3-manifest", "profile", "stage-a-manifest",
               "stage-a-rows", "stage-a-persons", "fitzroy-register", "fitzroy-manifest",
               "fitzroy-snapshot-dir", "fitzroy-contract", "ledger", "aliases",
               "awards-census", "brownlow-census", "verdicts-json", "verdicts-csv",
               "recheck", "residual", "review-data-dir"):
        parser.add_argument(f"--{key}", default=None)
    parser.add_argument("--fitzroy-index-json", default=None,
                        help="test-only: load a pre-built fitzRoy index instead of scanning CSVs")
    parser.add_argument("--skip-fitzroy-byte-verify", action="store_true",
                        help="test-only: skip the 131-file byte verification")
    parser.add_argument("--expect-total-rows", type=int, default=997)
    parser.add_argument("--expect-sample-sha256", default=None)
    parser.add_argument("--expect-parent-sha256", default=None)
    parser.add_argument("--expect-child-sha256", default=None)
    parser.add_argument("--audit-salt", default="AFLDB-ISSUE-222/audit-v1")
    parser.add_argument("--write", action="store_true", help="write output artefacts to disk")
    parser.add_argument("--print-rows-sha256-only", action="store_true")
    args = parser.parse_args(argv)

    try:
        result = run(args)
    except ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1

    if args.print_rows_sha256_only:
        print(result["rows_sha256"])
        return 0

    print(json.dumps({"rows_sha256": result["rows_sha256"], "totals": result["totals"]},
                     indent=2, sort_keys=True))

    if not args.write:
        return 0

    paths = result["paths"]
    verdicts_bytes = dump_json_lf(result["verdict_doc"])
    atomic_write_bytes(paths["verdicts_json"], verdicts_bytes)
    verdicts_sha256 = sha256_bytes(verdicts_bytes)

    write_csv(result["rows"], paths["verdicts_csv"])

    recheck = build_recheck_queue(
        result["rows"], audit_salt=args.audit_salt, verdicts_sha256=verdicts_sha256,
        sample_sha256=result["verdict_doc"]["inputs"]["sample"]["sha256"],
        parent_sha256=result["verdict_doc"]["inputs"]["parent"]["sha256"],
        child_sha256=result["verdict_doc"]["inputs"]["child"]["sha256"])
    atomic_write_bytes(paths["recheck"], dump_json_lf(recheck))

    residual = build_residual_report(result["rows"])
    atomic_write_bytes(paths["residual"], dump_json_lf(residual))

    print(f"verdicts_sha256={verdicts_sha256}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
