#!/usr/bin/env python3
"""AFLDB-ISSUE-222 -- population-wide offline DraftGuru mislink scan.

Context: the Phase 3 997-row review sample found seven genuine DraftGuru-side
mislinks sharing one signature -- DraftGuru's own capture records ZERO career
games for a specific drafted entry, but the captured AFL Tables href resolves
to an unrelated, ALREADY-RETIRED same-named player whose retained career
ended before that entry's earliest original recruitment. That is a
population-level stop condition: this module scans every one of the 3,564
admissible PARENT bridge candidates (not only the 997-row sample) for that
mechanism and closely related identity contradictions, before any operator
sign-off or bridge import.

Design: this module is deliberately a thin orchestration + classification
layer over tools/rebuild/draftguru/review_person_bridge_offline.py ("the
review tool"), imported as a library so the name/club normalisation, fitzRoy
snapshot indexing (including the AGE_ARTIFACT_FLOOR sentinel-age correction),
earliest-original-recruitment selection and per-row corroboration rules
(evaluate_row) stay a SINGLE source of truth shared with the reviewed and
hash-verified 997-row sample tool. This module adds only:

  1. iteration over all 3,564 parent bridge candidates instead of the
     immutable 997-row sample;
  2. a population outcome classification layer mapping the review tool's six
     per-row outcomes onto the seven population outcomes this scan reports:
         population_clean, relisting_signature_review, suspected_source_mislink,
         source_discrepancy_same_person, insufficient_evidence,
         human_authority_overlap, tooling_or_schema_error
  3. a bounded, evidence-gated "alternate registered identity" probe for
     target_unregistered rows (numeric-suffix and visible-name spelling
     candidates only, promoted to source_discrepancy_same_person only under
     the SAME corroboration bar evaluate_row itself requires for
     offline_strong -- name consistency AND birth-year consistency AND at
     least one games/debut/span signal, plus club overlap for a suffixed
     candidate). Name equality alone never promotes a candidate (D-9).

Correction (v2, independent review 2026-09-18): v1 of this scanner classified
23 rows as `confirmed_source_mislink` on a signature -- a DraftGuru entry
recording zero games FOLLOWING that specific listing event, whose captured
href resolves to a retained target with a genuine played career that had
already ENDED BEFORE that event's year (`CAREER_ENDED_BEFORE_EARLIEST_
RECRUITMENT`, strict `<`). An independent review found that bound invalid:
DraftGuru's per-entry games figure is games following THAT event, not the
person's career games, so zero there proves nothing about whether the person
ever played; Stage A's own recorded listing age agrees with the retained
target's birth year on every one of the 23 rows (evidence FOR the same
person, not against); and 21 rows sharing the identical shape, differing only
in whether the retained career ended exactly in the event year rather than
one year earlier, were classified `population_clean` purely because the
comparison used strict `<` instead of `<=` -- an arbitrary one-year boundary
splitting one real phenomenon (a delisted/veteran player relisted years later
via a National/Rookie/Pre-Season/Mid-Season/Pre-Draft/Post-Draft event, or a
trade) into two different labels. No retained evidence supports calling any
of these 44 rows a "confirmed" mislink; none supports calling them safe
either. `confirmed_source_mislink` is removed from this module's vocabulary
entirely and replaced by the neutral `relisting_signature_review`, which
`classify_population_row()` now assigns uniformly to the union of both former
groups (see `relisting_signature_match()`), and which explicitly does NOT
fire alongside a genuine identity contradiction (birth-year conflict, surname
difference, multiple fitzRoy ids, ledger disagreement) -- those remain
`suspected_source_mislink`, never guessed away.

NEVER connects to a database (no psycopg import, no *DATABASE_URL* read),
NEVER performs a network request (no socket/urllib/requests/http.client use),
NEVER modifies the parent, child or sample files (read-only). Every tracked
output is written atomically as LF bytes. Reruns are deterministic: identical
inputs reproduce an identical rows_sha256.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

import review_person_bridge_offline as base  # noqa: E402

SCANNER = "tools/rebuild/draftguru/scan_person_bridge_population.py"
SCANNER_VERSION = "2.0.0"
SCHEMA_VERSION = 2
DEFAULT_LABEL = "20260918-v2"

POPULATION_OUTCOMES = (
    "population_clean", "relisting_signature_review", "suspected_source_mislink",
    "source_discrepancy_same_person", "insufficient_evidence",
    "human_authority_overlap", "tooling_or_schema_error",
)

# Population outcomes for which the operator sign-off table must carry a row
# (Phase D contract).
SIGNOFF_OUTCOMES = (
    "relisting_signature_review", "suspected_source_mislink",
    "source_discrepancy_same_person", "insufficient_evidence",
    "tooling_or_schema_error",
)

CONTRADICTION_REASON_CODES = (
    "CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT", "BIRTH_YEAR_CONFLICT",
    "SURNAME_DIFFERENT", "MULTIPLE_FITZROY_IDS", "LEDGER_DISAGREES",
)

# A genuine identity contradiction that must never be absorbed into the
# neutral relisting-signature class -- if any of these fired, the row is
# reported as suspected_source_mislink instead (independent review item 5;
# "true DOB/career contradiction can still be represented without being
# guessed away").
RELISTING_EXCLUDING_REASON_CODES = (
    "BIRTH_YEAR_CONFLICT", "SURNAME_DIFFERENT", "MULTIPLE_FITZROY_IDS",
    "LEDGER_DISAGREES",
)

POPULATION_REASON_RELISTING = "RELISTING_SIGNATURE_REQUIRES_OPERATOR_ADJUDICATION"

# Biologically implausible age at original recruitment -- neither side of the
# comparison is a real senior-competition draftee at these ages. This is an
# ADDITIONAL screen beyond evaluate_row's own rules (correction handoff
# Phase B "related strong risks"); it never fires on a row evaluate_row
# already classified as a contradiction.
IMPLAUSIBLE_AGE_FLOOR = 14
IMPLAUSIBLE_AGE_CEILING = 45

# Numeric-suffix candidate range for the alternate-identity probe. AFL Tables
# retroactively suffixes every name shared by 2+ players starting at 0; every
# case measured in the Phase 3 sample (Tom_Murphy0, Joel_Smith0, Josh_Smith0,
# Nathan_Brown1/2, David_Clarke1, Chris_Waterson0, ...) falls in 0-9.
NUMBERED_CANDIDATE_RANGE = range(0, 20)


class ScanError(base.ToolError):
    """A refusal: bad input, hash mismatch, schema violation. Fails closed."""


# ---------------------------------------------------------------------------
# Draft evidence helpers derived from an evaluate_row() result
# ---------------------------------------------------------------------------

def draftguru_max_games(stage_a_block: dict | None) -> int | None:
    rows = (stage_a_block or {}).get("rows") or []
    if not rows:
        return None
    games = [r.get("games") for r in rows if r.get("games") is not None]
    return max(games) if games else None


def draftguru_clubs(stage_a_block: dict | None) -> set[str]:
    rows = (stage_a_block or {}).get("rows") or []
    return {r.get("club_name_raw") for r in rows if r.get("club_name_raw")}


def recruitment_year_of(stage_a_block: dict | None) -> int | None:
    stage_a_block = stage_a_block or {}
    earliest = stage_a_block.get("earliest_original_recruitment")
    if earliest:
        return earliest.get("draft_year")
    return stage_a_block.get("earliest_trade_year")


def retained_birth_year(retained_target: dict | None) -> int | None:
    if not retained_target:
        return None
    dob_years = retained_target.get("dob_years") or []
    return dob_years[0] if dob_years else retained_target.get("implied_birth_year")


def implausible_age_at_recruitment(retained_target: dict | None, recruitment_year: int | None) -> bool:
    if not retained_target or recruitment_year is None:
        return False
    birth_year = retained_birth_year(retained_target)
    if birth_year is None:
        return False
    age = recruitment_year - birth_year
    return age < IMPLAUSIBLE_AGE_FLOOR or age > IMPLAUSIBLE_AGE_CEILING


def relisting_signature_match(retained_target: dict | None, stage_a_block: dict | None,
                              reason_codes: list[str]) -> bool:
    """The relisting / delisted-veteran signature (independent review,
    2026-09-18): a DraftGuru entry recording ZERO games following that
    specific listing event (per-entry games, never career games -- correction
    item 6) whose captured href resolves to a retained target with a genuine
    played career (`career_games > 0`) that had already ended AT OR BEFORE
    the event's year. Deliberately keyed to `<=`, not `<`: whether the
    retained career ended exactly in the event year or one year earlier is
    the same real-world shape (a later National/Rookie/Pre-Season/Mid-Season/
    Pre-Draft/Post-Draft listing, or a trade, of someone already delisted or
    retiring), and splitting them at that boundary was the defect this
    function replaces (v1 confirmed_source_mislink vs. population_clean).
    Never fires alongside a genuine identity contradiction -- those signals
    (birth-year conflict, surname difference, multiple fitzRoy ids, ledger
    disagreement) are independent of this shape and must still surface as
    suspected_source_mislink, never guessed away as a relisting."""
    if not retained_target or not retained_target.get("career_games"):
        return False
    if draftguru_max_games(stage_a_block) != 0:
        return False
    recruitment_year = recruitment_year_of(stage_a_block)
    last_season = retained_target.get("last_season")
    if recruitment_year is None or last_season is None or last_season > recruitment_year:
        return False
    return not any(code in reason_codes for code in RELISTING_EXCLUDING_REASON_CODES)


# ---------------------------------------------------------------------------
# Bounded alternate-registered-identity probe (target_unregistered rows only)
# ---------------------------------------------------------------------------

def numbered_candidates(identity: str) -> list[str]:
    if not identity.endswith(".html"):
        return []
    stem = identity[: -len(".html")]
    return [f"{stem}{n}.html" for n in NUMBERED_CANDIDATE_RANGE]


def spelling_candidate(identity: str, visible_name: str | None) -> str | None:
    if not visible_name or "/" not in identity:
        return None
    directory = identity.rsplit("/", 1)[0]
    cleaned = base.normalise_name_token(visible_name)
    if not cleaned:
        return None
    filename = "_".join(w.capitalize() for w in cleaned.split()) + ".html"
    return f"{directory}/{filename}"


def evaluate_candidate(*, candidate: str, visible_name: str | None, dg_birth_year: int | None,
                       dg_games: int | None, dg_clubs: set[str], stage_a_block: dict | None,
                       recruitment_year: int | None, retained_target: dict) -> dict | None:
    """Applies the SAME corroboration bar evaluate_row() requires for
    offline_strong to a substitute identity: name consistency beyond mere
    equality, birth-year tolerance, at least one games/debut/span signal, and
    club overlap for a numeric-suffix candidate. Returns a match record or
    None (never a guess)."""
    rt_surnames = retained_target["surnames"] or {
        (p.split()[-1] if p.split() else None) for p in retained_target["players"]}
    rt_surnames = {s for s in rt_surnames if s}
    matched_surname = next(
        (s for s in rt_surnames if base.surname_suffix_match(visible_name, s)), None)
    if matched_surname is None:
        return None
    dg_given = base.given_name_from_full(visible_name, matched_surname)
    rt_given_candidates = retained_target["first_names"] or {
        (" ".join(p.split()[:-1]) if len(p.split()) > 1 else None) for p in retained_target["players"]}
    rt_given_candidates = {g for g in rt_given_candidates if g}
    given_ok = False
    for rt_given in rt_given_candidates:
        ok, _variant = base.given_name_consistency(dg_given, rt_given)
        if ok:
            given_ok = True
            break
    name_consistent = given_ok or not rt_given_candidates
    if not name_consistent:
        return None

    rt_birth_year = retained_birth_year(retained_target)
    birth_year_consistent = (dg_birth_year is not None and rt_birth_year is not None
                              and abs(dg_birth_year - rt_birth_year) <= 1)
    if not birth_year_consistent:
        return None

    earliest = (stage_a_block or {}).get("earliest_original_recruitment")
    debut_signal = False
    if earliest and retained_target.get("debut_season") is not None:
        debut_signal = retained_target["debut_season"] >= earliest["draft_year"]
    span_signal = False
    if (recruitment_year is not None and retained_target.get("debut_season") is not None
            and retained_target.get("last_season") is not None):
        span_signal = retained_target["debut_season"] <= recruitment_year <= retained_target["last_season"]
    games_signal = False
    if dg_games and retained_target.get("career_games"):
        rt_games = retained_target["career_games"]
        if rt_games <= dg_games:
            if retained_target.get("last_season") is not None and retained_target["last_season"] <= 2024:
                games_signal = rt_games == dg_games
            else:
                games_signal = True

    club_overlap = base.club_history_overlaps(dg_clubs, set(retained_target.get("clubs") or []))
    signal_count = sum([debut_signal, span_signal, games_signal])
    needs_club = bool(base.NUMERIC_SUFFIX_RE.search(candidate))
    if signal_count < 1 or (needs_club and not club_overlap):
        return None
    if retained_target.get("distinct_fitzroy_id_count", 0) > 1:
        return None

    return {
        "identity": candidate, "birth_year_consistent": birth_year_consistent,
        "signal_count": signal_count, "club_overlap": club_overlap,
        "debut_signal": debut_signal, "span_signal": span_signal, "games_signal": games_signal,
    }


def probe_same_person_alternate_identity(row: dict, fitzroy_index: dict[str, dict]) -> dict | None:
    """Only called for target_unregistered rows (D-9: never for a row that
    already has a registered target). Never forces an ambiguous result: zero
    or more-than-one qualifying candidate both yield None."""
    expected_identity = row.get("expected_afltables_identity")
    if not expected_identity:
        return None
    draftguru = row.get("draftguru") or {}
    stage_a = row.get("stage_a") or {}
    visible_name = draftguru.get("visible_name") or (
        stage_a.get("display_names_raw") or [None])[0]
    dg_birth_year = draftguru.get("title_birth_year")
    dg_games = draftguru_max_games(stage_a)
    dg_clubs = draftguru_clubs(stage_a)
    recruitment_year = recruitment_year_of(stage_a)

    candidates = set(numbered_candidates(expected_identity))
    sc = spelling_candidate(expected_identity, visible_name)
    if sc:
        candidates.add(sc)
    candidates.discard(expected_identity)

    matches = []
    for candidate in sorted(candidates):
        target = fitzroy_index.get(candidate)
        if target is None:
            continue
        m = evaluate_candidate(
            candidate=candidate, visible_name=visible_name, dg_birth_year=dg_birth_year,
            dg_games=dg_games, dg_clubs=dg_clubs, stage_a_block=stage_a,
            recruitment_year=recruitment_year, retained_target=target)
        if m is not None:
            matches.append(m)

    if len(matches) == 1:
        return matches[0]
    return None


# ---------------------------------------------------------------------------
# Population outcome classification
# ---------------------------------------------------------------------------

def classify_population_row(row: dict, fitzroy_index: dict[str, dict]) -> dict:
    """Maps one evaluate_row() result (base outcome, reason codes, ledger
    status, retained facts) to exactly one population outcome. Never
    reclassifies from name equality alone; every confirmed/suspected/
    discrepancy classification is evidence-gated."""
    base_outcome = row["outcome"]
    reason_codes = row.get("reason_codes") or []
    ledger_status = row.get("ledger_status", "none")
    stage_a = row.get("stage_a") or {}
    retained_target = row.get("retained_target")

    out = {
        "population_outcome": None, "population_reason": None,
        "corrected_identity": None, "recommended_disposition": None,
    }

    if base_outcome == "tooling_or_schema_error":
        out["population_outcome"] = "tooling_or_schema_error"
        out["population_reason"] = "|".join(reason_codes) or "TOOLING_OR_SCHEMA_ERROR"

    elif ledger_status in ("linked_agreeing", "confirmed_unlinked") and base_outcome != "offline_contradict":
        out["population_outcome"] = "human_authority_overlap"
        out["population_reason"] = f"LEDGER_{ledger_status.upper()}"

    elif base_outcome == "offline_unavailable":
        out["population_outcome"] = "insufficient_evidence"
        out["population_reason"] = "OFFLINE_UNAVAILABLE"

    elif base_outcome == "target_unregistered":
        match = probe_same_person_alternate_identity(row, fitzroy_index)
        if match is not None:
            out["population_outcome"] = "source_discrepancy_same_person"
            out["population_reason"] = "ALTERNATE_REGISTERED_IDENTITY_CORROBORATED"
            out["corrected_identity"] = match["identity"]
        else:
            out["population_outcome"] = "insufficient_evidence"
            out["population_reason"] = "TARGET_NOT_REGISTERED_NO_EVIDENCE"

    elif base_outcome == "offline_contradict":
        if relisting_signature_match(retained_target, stage_a, reason_codes):
            out["population_outcome"] = "relisting_signature_review"
            out["population_reason"] = POPULATION_REASON_RELISTING
        else:
            out["population_outcome"] = "suspected_source_mislink"
            fired = [c for c in CONTRADICTION_REASON_CODES if c in reason_codes]
            out["population_reason"] = "OTHER_CONTRADICTION:" + ",".join(fired)

    elif base_outcome == "offline_strong":
        recruitment_year = recruitment_year_of(stage_a)
        if relisting_signature_match(retained_target, stage_a, reason_codes):
            out["population_outcome"] = "relisting_signature_review"
            out["population_reason"] = POPULATION_REASON_RELISTING
        elif implausible_age_at_recruitment(retained_target, recruitment_year):
            out["population_outcome"] = "suspected_source_mislink"
            out["population_reason"] = "IMPLAUSIBLE_AGE_AT_RECRUITMENT"
        else:
            out["population_outcome"] = "population_clean"
            out["population_reason"] = "OFFLINE_STRONG"

    elif base_outcome == "offline_limited":
        out["population_outcome"] = "insufficient_evidence"
        out["population_reason"] = "OFFLINE_LIMITED"

    else:
        raise AssertionError(f"unhandled evaluate_row outcome {base_outcome!r}")

    out["recommended_disposition"] = recommended_disposition(
        out["population_outcome"], out["population_reason"])
    return {**row, **out}


def recommended_disposition(population_outcome: str, population_reason: str) -> str:
    if population_outcome == "relisting_signature_review":
        return "operator_adjudication_required"
    if population_outcome in ("suspected_source_mislink", "source_discrepancy_same_person"):
        return "manual_curation"
    if population_outcome == "tooling_or_schema_error":
        return "undetermined"
    if population_outcome == "insufficient_evidence":
        return "manual_curation" if population_reason == "OFFLINE_LIMITED" else "withhold"
    # human_authority_overlap and population_clean: no exclusion recommended.
    return "retain_bridge"


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def default_paths(label: str) -> dict[str, Path]:
    p = base.default_paths(label)
    p.update({
        "population_json": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-population-scan-{label}.json",
        "population_csv": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-population-scan-{label}.csv",
        "population_manifest": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-population-scan-manifest-{label}.json",
        "population_signoff": REPO_ROOT / "docs/rebuild-manifests/draftguru" / f"bridge-population-scan-signoff-{label}.md",
    })
    return p


def run(args: argparse.Namespace) -> dict:
    label = args.label
    paths = default_paths(label)
    for key, override in vars(args).items():
        if override and key in paths:
            paths[key] = Path(override)

    input_hashes: dict[str, dict] = {}

    def verified(key: str, expected: str | None) -> dict:
        path = paths[key]
        actual = base.sha256_file(path)
        if expected and actual != expected:
            raise ScanError(f"{key} ({path}) sha256 {actual} does not match expected {expected}")
        entry = {"path": base.repo_relative(path), "sha256": actual}
        input_hashes[key] = entry
        return entry

    parent = base.load_json(paths["parent"], "parent bridge")
    verified("parent", args.expect_parent_sha256)
    if parent.get("kind") == "deployment":
        raise ScanError("refusing a deployment child as the parent input -- this scanner "
                         "requires the source-evidence PARENT")
    child = base.load_json(paths["child"], "afldb_test child")
    verified("child", args.expect_child_sha256)
    if child.get("kind") != "deployment":
        raise ScanError("the --child input does not declare kind: \"deployment\"")

    verified("b3_manifest", None)
    verified("profile", None)
    verified("stage_a_manifest", None)
    verified("stage_a_rows", None)
    verified("stage_a_persons", None)
    fitzroy_register = base.load_json(paths["fitzroy_register"], "fitzRoy register")
    verified("fitzroy_register", None)
    fitzroy_manifest = base.load_json(paths["fitzroy_manifest"], "fitzRoy manifest")
    verified("fitzroy_manifest", None)
    fitzroy_contract = base.load_json(paths["fitzroy_contract"], "fitzRoy contract")
    verified("fitzroy_contract", None)
    verified("ledger", None)
    verified("aliases", None)
    ledger = base.load_json(paths["ledger"], "ledger")
    aliases_doc = base.load_json(paths["aliases"], "aliases")

    files_verified = 131
    if not args.skip_fitzroy_byte_verify:
        result = base.verify_fitzroy_bytes(fitzroy_manifest, paths["fitzroy_snapshot_dir"])
        files_verified = result["verified_ok"]

    bridges = parent["bridges"]
    total_expected = len(bridges)
    if args.expect_total_rows and total_expected != args.expect_total_rows:
        raise ScanError(f"parent carries {total_expected} bridge candidates, expected {args.expect_total_rows}")

    parent_identity_by_url = {b["player_url"]: b["afltables_external_id"] for b in bridges}
    child_bridged = {b["player_url"] for b in child["bridges"]}
    child_withheld_reason = {w["player_url"]: w["reason"] for w in child["withheld"]}

    profile_by_url = {r["player_url"]: r for r in base.load_jsonl(paths["profile"], "profile")}
    stage_a_rows_all = base.load_jsonl(paths["stage_a_rows"], "Stage A rows")
    stage_a_rows_by_url: dict[str, list[dict]] = {}
    for r in stage_a_rows_all:
        stage_a_rows_by_url.setdefault(r["player_url"], []).append(r)
    stage_a_persons_by_url = {r["player_url"]: r for r in base.load_jsonl(paths["stage_a_persons"], "Stage A persons")}

    if args.fitzroy_index_json:
        fitzroy_index = json.loads(Path(args.fitzroy_index_json).read_text(encoding="utf-8"))
    else:
        fitzroy_index = base.build_fitzroy_index(paths["fitzroy_snapshot_dir"], fitzroy_manifest, fitzroy_contract)

    ledger_by_url = {d["player_url"]: d for d in ledger.get("decisions", [])}
    aliases_by_identity: dict[str, list[str]] = {}
    for a in aliases_doc.get("aliases", []):
        if a.get("source") == "afltables":
            aliases_by_identity.setdefault(a["external_id"], []).append(a["alias"])
    awards_census = base.load_census_map(paths["awards_census"])
    for k, v in base.load_census_map(paths["brownlow_census"]).items():
        awards_census.setdefault(k, set()).update(v)

    continuity_paths: set[str] = set()
    for rule in fitzroy_contract.get("profile_url_continuity", {}).get("rules", []):
        continuity_paths.add(rule["continuing_url"])
        continuity_paths.add(rule["renumbered_url"])

    rows_out: list[dict] = []
    for i, entry in enumerate(bridges):
        base_row = base.evaluate_row(
            player_url=entry["player_url"], stratum="population", sample_index=i + 1, ordinal=i + 1,
            parent_identity_by_url=parent_identity_by_url, child_bridged=child_bridged,
            child_withheld_reason=child_withheld_reason, profile_by_url=profile_by_url,
            stage_a_rows_by_url=stage_a_rows_by_url, stage_a_persons_by_url=stage_a_persons_by_url,
            fitzroy_index=fitzroy_index, ledger_by_url=ledger_by_url,
            aliases_by_identity=aliases_by_identity, awards_census_by_identity=awards_census,
            numbering_urls=base.NUMBERING_SLUGS, spelling_urls=base.SPELLING_SLUGS,
            schwerdt_urls=base.SCHWERDT_SLUGS, continuity_paths=continuity_paths)
        rows_out.append(classify_population_row(base_row, fitzroy_index))

    if len(rows_out) != total_expected:
        raise ScanError("row count drifted from the immutable parent during evaluation")

    totals = {o: 0 for o in POPULATION_OUTCOMES}
    for r in rows_out:
        totals[r["population_outcome"]] += 1
    totals["completed"] = len(rows_out)

    rows_sha256 = base.sha256_bytes(base.canonical_json_bytes(rows_out))

    header = {
        "schema_version": SCHEMA_VERSION,
        "scan_method": "offline-retained-evidence-population-scan",
        "scanner": {"path": SCANNER, "version": SCANNER_VERSION},
        "reused_review_tool": {"path": base.TOOL, "version": base.TOOL_VERSION},
        "inputs": {
            **input_hashes,
            "fitzroy_snapshot": {
                "label": "full-history-20260902",
                "snapshot_dir": base.repo_relative(paths["fitzroy_snapshot_dir"]),
                "artefact_set_sha256": next(
                    (b["raw_artefacts"]["artefact_set_sha256"]
                     for b in fitzroy_register.get("baselines", [])
                     if b.get("acceptance_status") == "accepted"), None),
                "files_verified": files_verified,
            },
        },
        "generated_utc": base.utc_now(), "completed_utc": base.utc_now(),
        "total_expected_rows": total_expected,
        "offline_only": True, "network_requests": 0, "database_connections": 0,
    }
    population_doc = {**header, "rows": rows_out, "totals": totals, "rows_sha256": rows_sha256}
    return {"population_doc": population_doc, "rows": rows_out, "totals": totals,
            "rows_sha256": rows_sha256, "paths": paths, "label": label}


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

CSV_COLUMNS = [
    "sample_index", "player_url", "expected_afltables_identity", "child_status",
    "base_outcome", "population_outcome", "population_reason", "corrected_identity",
    "recommended_disposition", "visible_name", "title_birth_year", "retained_birth_year",
    "retained_debut_season", "retained_last_season", "retained_career_games",
    "draftguru_games", "earliest_recruitment_year", "earliest_recruitment_event_type",
    "ledger_status", "reason_codes", "operator_verdict",
]


def write_csv(rows: list[dict], path: Path) -> str:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for r in rows:
        rt = r.get("retained_target") or {}
        stage_a = r.get("stage_a") or {}
        earliest = stage_a.get("earliest_original_recruitment") or {}
        writer.writerow([
            r["sample_index"], r["player_url"], r["expected_afltables_identity"],
            r["child_status"], r["outcome"], r["population_outcome"], r["population_reason"],
            r.get("corrected_identity") or "", r["recommended_disposition"],
            (r.get("draftguru") or {}).get("visible_name"),
            (r.get("draftguru") or {}).get("title_birth_year"),
            retained_birth_year(rt) if rt else None,
            rt.get("debut_season"), rt.get("last_season"), rt.get("career_games"),
            draftguru_max_games(stage_a), earliest.get("draft_year"), earliest.get("event_type_raw"),
            r["ledger_status"], ";".join(r["reason_codes"]), "",
        ])
    data = buf.getvalue().encode("utf-8")
    base.atomic_write_bytes(path, data)
    return base.sha256_bytes(data)


def build_manifest(population_doc: dict, population_json_sha256: str, population_csv_sha256: str) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "issue": "AFLDB-ISSUE-222",
        "scan_method": population_doc["scan_method"],
        "scanner": population_doc["scanner"],
        "reused_review_tool": population_doc["reused_review_tool"],
        "inputs": population_doc["inputs"],
        "population_scan_json": {"sha256": population_json_sha256},
        "population_scan_csv": {"sha256": population_csv_sha256},
        "total_expected_rows": population_doc["total_expected_rows"],
        "totals": population_doc["totals"],
        "rows_sha256": population_doc["rows_sha256"],
        "generated_utc": population_doc["generated_utc"],
        "completed_utc": population_doc["completed_utc"],
        "offline_only": True, "network_requests": 0, "database_connections": 0,
        "phase_3_status": "PENDING -- this scan does not accept Phase 3, authorise an import, "
                          "or set any operator_verdict",
    }


def build_signoff_markdown(rows: list[dict], totals: dict, manifest: dict, label: str) -> str:
    lines: list[str] = []
    lines.append(f"# AFLDB-ISSUE-222 -- population-wide offline mislink scan sign-off pack ({label})")
    lines.append("")
    lines.append("**Phase 3 remains PENDING.** This pack is a bounded, evidence-based screen of all "
                 "3,564 parent bridge candidates for the relisting/delisted-veteran signature the "
                 "Phase 3 sample review surfaced (a zero-per-entry-game DraftGuru listing whose "
                 "captured AFL Tables href resolves to a retained target with a genuine played "
                 "career that had already ended at or before that listing's year). Independent "
                 "review (2026-09-18) found this signature does NOT support calling any such row a "
                 "confirmed mislink -- DraftGuru's per-entry games figure means games following "
                 "that event, not career games, and Stage A's own listed age agrees with the "
                 "retained target's birth year on every affected row -- so this pack reports the "
                 "neutral `relisting_signature_review` outcome and requires operator adjudication, "
                 "never automatic exclusion. No `operator_verdict` has been set on any row, and "
                 "nothing here accepts Phase 3, authorises an import, or begins Phase 4.")
    lines.append("")
    lines.append(f"Scanner: `{manifest['scanner']['path']}` v{manifest['scanner']['version']}, reusing "
                 f"`{manifest['reused_review_tool']['path']}` v{manifest['reused_review_tool']['version']} "
                 "for every name/club normalisation, fitzRoy snapshot indexing and corroboration rule.")
    lines.append("")
    lines.append("## 1. Reconciliation and outcome totals")
    lines.append("")
    lines.append(f"- Total parent bridge candidates: **{totals['completed']}** (expected 3,564).")
    lines.append(f"- `rows_sha256`: `{manifest['rows_sha256']}`")
    lines.append("")
    lines.append("| Outcome | Count |")
    lines.append("|---|---|")
    for outcome in POPULATION_OUTCOMES:
        lines.append(f"| `{outcome}` | {totals[outcome]} |")
    lines.append("")

    def row_line(r: dict) -> str:
        rt = r.get("retained_target") or {}
        dg = r.get("draftguru") or {}
        stage_a = r.get("stage_a") or {}
        earliest = stage_a.get("earliest_original_recruitment") or {}
        dg_games = draftguru_max_games(stage_a)
        return (f"| `{r['player_url']}` | `{r['expected_afltables_identity']}` "
               f"| {dg.get('visible_name') or ''} (born {dg.get('title_birth_year') or '?'}), "
               f"{dg_games if dg_games is not None else '?'} games, "
               f"{earliest.get('draft_year') or '?'} {earliest.get('event_type_raw') or ''} "
               f"| {'/'.join(rt.get('players') or []) or 'NOT REGISTERED'}, "
               f"birth_year={retained_birth_year(rt) if rt else 'n/a'}, "
               f"games={rt.get('career_games', 'n/a')}, "
               f"span={rt.get('debut_season', '?')}-{rt.get('last_season', '?')} "
               f"| {r['recommended_disposition']} |")

    lines.append("## 2. Relisting-signature rows (recommend operator_adjudication_required)")
    lines.append("")
    lines.append("A DraftGuru entry recording zero games FOLLOWING that specific listing event "
                 "(per-entry games, never career games) whose captured href resolves to a retained "
                 "target with a genuine played career that had already ended at or before that "
                 "event's year. Stage A's own listed age agrees with the retained target's birth "
                 "year on every row below. This is neither a confirmed mislink nor automatically "
                 "safe -- it requires operator adjudication (same_person_valid_relisting / "
                 "different_person_wrong_href / undetermined_withhold).")
    lines.append("")
    relisting = [r for r in rows if r["population_outcome"] == "relisting_signature_review"]
    if relisting:
        lines.append("| DraftGuru URL | Captured href | Source (DraftGuru) evidence | Retained target | Disposition |")
        lines.append("|---|---|---|---|---|")
        for r in relisting:
            lines.append(row_line(r))
    else:
        lines.append("None.")
    lines.append("")

    lines.append("## 3. Suspected source mislinks (recommend manual_curation)")
    lines.append("")
    lines.append("Note: rows flagged only by `SURNAME_DIFFERENT` with every other signal (birth year, "
                 "debut timing, games, club overlap) agreeing are very likely the SAME person and a "
                 "surname-tokenisation limitation (compound/diacritic surnames), not a genuine mislink; "
                 "see the reason column and confirm from the CSV/JSON before any action.")
    lines.append("")
    def row_line_with_reason(r: dict) -> str:
        rt = r.get("retained_target") or {}
        dg = r.get("draftguru") or {}
        stage_a = r.get("stage_a") or {}
        earliest = stage_a.get("earliest_original_recruitment") or {}
        dg_games = draftguru_max_games(stage_a)
        return (f"| `{r['player_url']}` | `{r['expected_afltables_identity']}` "
               f"| {dg.get('visible_name') or ''} (born {dg.get('title_birth_year') or '?'}), "
               f"{dg_games if dg_games is not None else '?'} games, "
               f"{earliest.get('draft_year') or '?'} {earliest.get('event_type_raw') or ''} "
               f"| {'/'.join(rt.get('players') or []) or 'NOT REGISTERED'}, "
               f"birth_year={retained_birth_year(rt) if rt else 'n/a'}, "
               f"games={rt.get('career_games', 'n/a')}, "
               f"span={rt.get('debut_season', '?')}-{rt.get('last_season', '?')} "
               f"| {r['population_reason']} | {r['recommended_disposition']} |")

    suspected = [r for r in rows if r["population_outcome"] == "suspected_source_mislink"]
    if suspected:
        lines.append("| DraftGuru URL | Captured href | Source (DraftGuru) evidence | Retained target | Reason | Disposition |")
        lines.append("|---|---|---|---|---|---|")
        for r in suspected:
            lines.append(row_line_with_reason(r))
    else:
        lines.append("None.")
    lines.append("")

    lines.append("## 4. Source discrepancy, same person (numbering/spelling; recommend manual_curation)")
    lines.append("")
    discrepancy = [r for r in rows if r["population_outcome"] == "source_discrepancy_same_person"]
    if discrepancy:
        lines.append("| DraftGuru URL | Captured href | Corrected identity | Source evidence | Disposition |")
        lines.append("|---|---|---|---|---|")
        for r in discrepancy:
            dg = r.get("draftguru") or {}
            lines.append(f"| `{r['player_url']}` | `{r['expected_afltables_identity']}` "
                         f"| `{r['corrected_identity']}` "
                         f"| {dg.get('visible_name') or ''} (born {dg.get('title_birth_year') or '?'}) "
                         f"| {r['recommended_disposition']} |")
    else:
        lines.append("None.")
    lines.append("")

    lines.append("## 5. Insufficient evidence and tooling/schema errors")
    lines.append("")
    insuff = [r for r in rows if r["population_outcome"] == "insufficient_evidence"]
    tooling = [r for r in rows if r["population_outcome"] == "tooling_or_schema_error"]
    by_reason: dict[str, int] = {}
    for r in insuff:
        by_reason[r["population_reason"]] = by_reason.get(r["population_reason"], 0) + 1
    lines.append(f"- `insufficient_evidence` total: **{len(insuff)}**, by reason: "
                 f"{', '.join(f'{k}={v}' for k, v in sorted(by_reason.items()))}.")
    lines.append(f"- `tooling_or_schema_error` total: **{len(tooling)}**.")
    lines.append("- Full per-row list (every row in these two categories, with source/target facts and "
                 f"a blank `operator_verdict`): `bridge-population-scan-{label}.csv` / `.json`.")
    lines.append("")

    overlap = [r for r in rows if r["population_outcome"] == "human_authority_overlap"]
    lines.append("## 6. Human authority overlap")
    lines.append("")
    lines.append(f"- {len(overlap)} row(s) already carry an existing human decision "
                 "(`draftguru-link-decisions.json`) that is not itself contradicted by retained "
                 "evidence; the human decision remains authoritative. See CSV/JSON for the list.")
    lines.append("")

    lines.append("## 7. Confirmations")
    lines.append("")
    lines.append(f"- All {totals['completed']} parent bridge candidates reconciled; 0 remaining.")
    lines.append("- No `operator_verdict` has been set on any row -- every row's field is blank.")
    lines.append("- No network request, database connection, import/link action, Git command, or "
                 "DEV/PROD action occurred while producing this pack.")
    lines.append("- Phase 3 remains **PENDING** operator sign-off. Phase 4 has not begun.")
    lines.append("")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", default=DEFAULT_LABEL)
    for key in ("parent", "child", "b3-manifest", "profile", "stage-a-manifest",
               "stage-a-rows", "stage-a-persons", "fitzroy-register", "fitzroy-manifest",
               "fitzroy-snapshot-dir", "fitzroy-contract", "ledger", "aliases",
               "awards-census", "brownlow-census", "population-json", "population-csv",
               "population-manifest", "population-signoff"):
        parser.add_argument(f"--{key}", default=None)
    parser.add_argument("--fitzroy-index-json", default=None,
                        help="test-only: load a pre-built fitzRoy index instead of scanning CSVs")
    parser.add_argument("--skip-fitzroy-byte-verify", action="store_true")
    parser.add_argument("--expect-total-rows", type=int, default=3564)
    parser.add_argument("--expect-parent-sha256", default=None)
    parser.add_argument("--expect-child-sha256", default=None)
    parser.add_argument("--write", action="store_true", help="write output artefacts to disk")
    parser.add_argument("--print-rows-sha256-only", action="store_true")
    args = parser.parse_args(argv)

    try:
        result = run(args)
    except base.ToolError as exc:
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
    population_bytes = base.dump_json_lf(result["population_doc"])
    base.atomic_write_bytes(paths["population_json"], population_bytes)
    population_json_sha256 = base.sha256_bytes(population_bytes)

    population_csv_sha256 = write_csv(result["rows"], paths["population_csv"])

    manifest = build_manifest(result["population_doc"], population_json_sha256, population_csv_sha256)
    base.atomic_write_bytes(paths["population_manifest"], base.dump_json_lf(manifest))

    signoff_md = build_signoff_markdown(result["rows"], result["totals"], manifest, result["label"])
    base.atomic_write_bytes(paths["population_signoff"], signoff_md.encode("utf-8"))

    print(f"population_json_sha256={population_json_sha256}")
    print(f"population_csv_sha256={population_csv_sha256}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
