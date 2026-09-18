#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase F -- local operator-adjudication GUI for the required recheck rows
(the 39 mandatory recheck rows of classes 1-10 plus the 30-row deterministic audit, 69 unique
persons) of the v2 validation sample's machine review.

    python tools/rebuild/draftguru/review_validation_operator.py --validate-only
    python tools/rebuild/draftguru/review_validation_operator.py --status
    python tools/rebuild/draftguru/review_validation_operator.py

What it is: a DB-free, network-free Tk application that walks the operator through every
required row once (a person that belongs to several recheck classes is shown once, with all
of its class memberships), shows the DraftGuru person and the proposed AFL Tables identity
with every retained comparison fact the machine review recorded, keeps the machine identity
outcome and the child deployment status visibly distinct, records exactly one terminal verdict
per row in the final validator's vocabulary (``agree`` / ``contradict`` / ``undetermined``,
``review_validation_sample.OPERATOR_VERDICT_VALUES``) with the notes and evidence the validator
demands, checkpoints after every committed verdict, and -- only when every required row
satisfies the contract -- renders the operator verdict artefact
``docs/rebuild-manifests/draftguru/bridge-validation-operator-verdicts-20260918-v2.json``
exactly as ``validate_validation_review.py`` section 6 expects it (a copy of the recheck queue
with ``source_recheck_sha256`` and ``review_completed_utc`` added and the per-row operator block
filled; the machine outcome is never edited).

What it is not: it links no player, opens no database (no database client, importer or
resolver is imported; no environment variable is read), performs no network request (the only
outward action is the operator's own default browser launched by an explicit click on an
evidence button, after scheme/host allow-list validation), never modifies the sample, parent,
child, machine-review, verdict, recheck or residual artefacts, never accepts Phase F or Phase 3,
never imports and never performs Phase 4. Acceptance is decided only by
``validate_validation_review.py`` over the artefact this tool writes.

It is a separate lineage from ``review_bridge_operator.py`` (the earlier 83-row adjudication
pack): no checkpoint is migrated between the two and neither reads the other's state.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import platform
import re
import sys
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

try:  # pragma: no cover -- exercised whenever Tcl/Tk is present (the Windows operator target)
    import tkinter as tk
    from tkinter import messagebox, ttk

    TK_AVAILABLE = True
except Exception:  # pragma: no cover -- headless environments
    tk = None  # type: ignore[assignment]
    ttk = None  # type: ignore[assignment]
    messagebox = None  # type: ignore[assignment]
    TK_AVAILABLE = False

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

import build_person_bridge_v2 as v2gen                # noqa: E402  (DB-free; output hygiene patterns)
import review_person_bridge_offline as base           # noqa: E402  (DB-free; hashing, canonical JSON)
import review_validation_sample as reviewer           # noqa: E402  (DB-free; Phase F vocabulary)
import validate_validation_review as final            # noqa: E402  (DB-free; class prefixes, UTC rule)

ToolError = base.ToolError

TOOL = "tools/rebuild/draftguru/review_validation_operator.py"
TOOL_VERSION = "1.0.0"
CHECKPOINT_SCHEMA_VERSION = 1
CHECKPOINT_DIR_REL = "data/review/draftguru-validation-operator-20260918-v2"

VERDICT_VALUES = tuple(reviewer.OPERATOR_VERDICT_VALUES)          # ("agree", "contradict", "undetermined")
FINAL_REL = reviewer.OPERATOR_VERDICTS_REL
UTC_RE = final.UTC_RE
MANDATORY_CLASS_PREFIXES = final.MANDATORY_CLASS_PREFIXES
AUDIT_CLASS = final.AUDIT_CLASS
NEXT_COMMAND = "python tools/rebuild/draftguru/validate_validation_review.py"

CLASS_ORDER = (
    "1_offline_contradict", "2_offline_limited", "3_target_unregistered",
    "4_offline_unavailable", "5_tooling_or_schema_error", "6_numbering",
    "7_spelling_or_name_variant", "8_schwerdt", "9_ledger_overlap",
    "10_weak_or_suffix_or_continuity", "11_deterministic_audit",
)

CLASS_LABELS: dict[str, str] = {
    "1_offline_contradict": "MACHINE CONTRADICTION: retained birth-year, career-span or identity "
                            "evidence indicates a different person (a contradiction code is present)",
    "2_offline_limited": "LIMITED: the captured identity resolves, but corroboration is incomplete, "
                         "rests on a single signal, or includes an unlisted name variant",
    "3_target_unregistered": "TARGET NOT REGISTERED: the captured identity is not registered on "
                             "afldb_test -- no link ships and there are no retained target facts to "
                             "compare; the settled disposition is continued withholding",
    "4_offline_unavailable": "UNAVAILABLE: required retained evidence is absent (blocks acceptance "
                             "until the input is supplied and the review rerun)",
    "5_tooling_or_schema_error": "TOOLING/SCHEMA ERROR: an input could not be interpreted safely "
                                 "(blocks acceptance until the tool is fixed and the review rerun)",
    "6_numbering": "NUMBERING: a known same-name disambiguation case (numeric-suffix identities)",
    "7_spelling_or_name_variant": "SPELLING / NAME VARIANT: a known spelling or name-change case, "
                                  "or a listed given-name variant pair the operator confirms once",
    "8_schwerdt": "SCHWERDT: the known third-spelling case",
    "9_ledger_overlap": "LEDGER OVERLAP: a human link-decision ledger entry exists for this person",
    "10_weak_or_suffix_or_continuity": "WEAK / SUFFIX / CONTINUITY: strong conditions held with only "
                                       "the minimum third signal and no club overlap, or the identity "
                                       "path carries a numeric suffix, or it is a continuity-rule path",
    "11_deterministic_audit": "DETERMINISTIC AUDIT: an otherwise clean offline_strong row selected by "
                              "the salted audit (never manually chosen, never redrawn)",
}

OUTCOME_LABELS: dict[str, str] = {
    "offline_strong": "offline_strong -- all four strong conditions held offline",
    "offline_limited": "offline_limited -- identity resolves, corroboration incomplete or single-signal",
    "offline_contradict": "offline_contradict -- retained evidence indicates a DIFFERENT person",
    "target_unregistered": "target_unregistered -- identity not registered on afldb_test; no retained "
                           "target facts; NOT an identity contradiction",
    "offline_unavailable": "offline_unavailable -- required retained evidence absent (not terminal)",
    "tooling_or_schema_error": "tooling_or_schema_error -- input not safely interpretable (not terminal)",
}

CONTRADICTION_CODES = frozenset({
    "BIRTH_YEAR_CONFLICT", "CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT", "SURNAME_DIFFERENT",
    "MULTIPLE_FITZROY_IDS", "LEDGER_DISAGREES",
})

REASON_CODE_MEANINGS: dict[str, str] = {
    "BIRTH_YEAR_CONSISTENT": "DraftGuru title year equals the retained birth year",
    "BIRTH_YEAR_CONSISTENT_TOLERANCE": "DraftGuru title year within 1 of the retained birth year",
    "BIRTH_YEAR_CONFLICT": "CONTRADICTION: birth years differ by 2 or more",
    "DEBUT_NOT_BEFORE_EARLIEST_RECRUITMENT": "retained debut season is not before the earliest "
                                             "original recruitment year",
    "DEBUT_BEFORE_EARLIEST_RECRUITMENT": "informational only (not a contradiction): retained debut "
                                         "precedes the earliest DraftGuru recruitment year",
    "SPAN_CONTAINS_EARLIEST_RECRUITMENT_YEAR": "retained career span contains the earliest "
                                               "recruitment year",
    "CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT": "CONTRADICTION: retained career ended before the "
                                                "earliest recruitment year",
    "GAMES_CONSISTENT": "retained career games are consistent with the DraftGuru games figure",
    "GAMES_INCONSISTENT": "informational: games figures disagree (withholds offline_strong only as "
                          "the sole third signal)",
    "CLUB_HISTORY_OVERLAPS": "a DraftGuru event club appears in the retained club history",
    "SURNAME_DIFFERENT": "CONTRADICTION: surnames differ after normalisation",
    "MULTIPLE_FITZROY_IDS": "CONTRADICTION: the retained rows carry more than one fitzRoy ID",
    "LEDGER_DISAGREES": "CONTRADICTION: the human link-decision ledger disagrees",
    "NAME_VARIANT": "given-name variant pair is in the tool's listed variant table",
    "NAME_VARIANT_UNLISTED": "given-name variant is NOT in the listed table (limited, recheck)",
    "TARGET_NOT_REGISTERED": "deployment status: identity not registered on afldb_test (withheld)",
}

VERDICT_LABELS: dict[str, str] = {
    "agree": "Agree -- the proposed AFL Tables identity is the SAME human as this DraftGuru person "
             "(for a target-not-registered row: continued withholding is correct)",
    "contradict": "Contradict -- the proposed identity is a DIFFERENT human (a genuine identity "
                  "contradiction; blocks acceptance of this dataset)",
    "undetermined": "Undetermined -- the evidence does not let you decide (NOT a pass: escalated, "
                    "never redrawn; blocks acceptance of this dataset)",
}

DEPLOYMENT_STATEMENT = (
    "target_not_registered is a DEPLOYMENT status decided by the afldb_test child (no link ships, "
    "no retained target facts exist to compare). It is NOT itself an identity contradiction and it "
    "never edits the machine identity outcome. Under decision O-6 it counts toward n as terminal "
    "withholding; the operator confirms continued withholding with 'agree'."
)

# Evidence links: only these hosts, only http(s), only on an explicit click.
AFLTABLES_BASE_URL = "https://afltables.com/afl/stats/"
AFLTABLES_ALLOWED_HOSTS = frozenset({"afltables.com", "www.afltables.com"})
DRAFTGURU_ALLOWED_HOSTS = frozenset({"draftguru.com.au", "www.draftguru.com.au"})
AFLTABLES_IDENTITY_RE = re.compile(r"^players/[A-Z]/[A-Za-z0-9_\-]+\.html$")

# ---------------------------------------------------------------------------
# Pinned Phase F machine-review artefacts (operator-reported hashes, 2026-09-18) and the
# expected queue shape. Tests pass pinned={} / expect={} to run over a fixture tree.
# ---------------------------------------------------------------------------

PINNED_SHA256: dict[str, str] = {
    "recheck": "3e509021221456d5ac87276b075573eb4d7268a5b89add9155ea7975a627c175",
    "verdicts_json": "2caf980b0a9246c784334c357f08818da7d06f716a672768a3050b4c92fae766",
    "verdicts_csv": "d2a5c3369588ef770474ea4bca838eb90bff96eee0ecb84f855c816506bba88a",
    "residual": "d20a3c6f42cdf98727aaa114ced9ec46ddc5ca39967061bd1f17b488ead2cf26",
    "sample_json": reviewer.SAMPLE_JSON_SHA256,
}
EXPECT: dict = {
    "rows_sha256": "14d918a183fb37c9b214c28d2cd95073b1f26777d40dd0ce06cab659451d3166",
    "mandatory": 39,
    "audit": 30,
    "total": 69,
}


def default_rel() -> dict[str, str]:
    return {
        "recheck": reviewer.OUTPUTS["recheck"],
        "verdicts_json": reviewer.OUTPUTS["verdicts_json"],
        "verdicts_csv": reviewer.OUTPUTS["verdicts_csv"],
        "residual": reviewer.OUTPUTS["residual"],
        "sample_json": reviewer.PINNED_INPUTS["sample_json"][0],
    }


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_bytes(data: bytes) -> str:
    return base.sha256_bytes(data)


def dump_json_lf(payload: object) -> bytes:
    return base.dump_json_lf(payload)


def canonical_json_bytes(payload: object) -> bytes:
    return base.canonical_json_bytes(payload)


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Temp file in the same directory, flushed, fsynced, then os.replace over the target. A
    failure at any step leaves the previous file untouched and removes the temp file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
        raise


def check_output_hygiene(data: bytes, what: str) -> None:
    text = data.decode("utf-8", errors="replace")
    for pattern, kind in v2gen.FORBIDDEN_OUTPUT_PATTERNS:
        match = pattern.search(text)
        if match:
            raise ToolError(f"{what} contains {kind} ({match.group(0)!r}); refusing to write")


def parse_evidence(text: str | None) -> list[str]:
    """One evidence item per non-blank line, trimmed, order preserved, duplicates dropped."""
    items: list[str] = []
    for line in (text or "").splitlines():
        item = line.strip()
        if item and item not in items:
            items.append(item)
    return items


# ---------------------------------------------------------------------------
# Evidence links -- pure construction and validation; opening only on an explicit click
# ---------------------------------------------------------------------------

def validate_evidence_url(url: str, allowed_hosts: frozenset[str]) -> None:
    if not url or not isinstance(url, str):
        raise ToolError("missing or empty evidence URL")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise ToolError(f"refusing a URL with scheme {parts.scheme!r}: {url!r}")
    host = (parts.hostname or "").lower()
    if host not in allowed_hosts:
        raise ToolError(f"refusing a URL with unexpected host {host!r}: {url!r}")
    if not parts.netloc or not parts.path:
        raise ToolError(f"malformed evidence URL: {url!r}")


def build_afltables_url(identity: str) -> str:
    """'players/H/Hayden_Crozier.html' -> 'https://afltables.com/afl/stats/players/H/Hayden_Crozier.html'.
    The canonical identity must be a site-relative player path of the recognised shape; anything
    else is refused rather than guessed. Never a network request."""
    identity = (identity or "").strip()
    if not identity:
        raise ToolError("missing AFL Tables identity")
    if not AFLTABLES_IDENTITY_RE.match(identity):
        raise ToolError(f"identity is not a recognised AFL Tables player path: {identity!r}")
    url = urljoin(AFLTABLES_BASE_URL, identity)
    validate_evidence_url(url, AFLTABLES_ALLOWED_HOSTS)
    return url


def evidence_links_for(qrow: dict) -> dict:
    """Both links for a queue row, or a '*_error' string per link. Never raises; opens nothing."""
    machine = qrow["machine"]
    result: dict = {"draftguru_url": None, "draftguru_error": None,
                    "afltables_url": None, "afltables_error": None,
                    "afltables_identity": machine.get("expected_afltables_identity")}
    try:
        validate_evidence_url(machine.get("player_url") or "", DRAFTGURU_ALLOWED_HOSTS)
        result["draftguru_url"] = machine["player_url"]
    except ToolError as exc:
        result["draftguru_error"] = str(exc)
    try:
        result["afltables_url"] = build_afltables_url(result["afltables_identity"] or "")
    except ToolError as exc:
        result["afltables_error"] = str(exc)
    return result


def open_evidence_url(url: str | None, allowed_hosts: frozenset[str], *, opener=None) -> dict:
    """Validates, then launches the operator's own default browser. Never fetches anything
    itself and never touches a verdict, note, draft or checkpoint. Failures are returned, not
    raised. `opener` exists only so tests can inject a mock."""
    if opener is None:
        opener = webbrowser.open
    try:
        validate_evidence_url(url or "", allowed_hosts)
    except ToolError as exc:
        return {"ok": False, "url": url, "error": str(exc)}
    try:
        opened = opener(url)
    except Exception as exc:  # pragma: no cover -- platform browser failures
        return {"ok": False, "url": url, "error": str(exc)}
    return {"ok": opened is not False, "url": url, "error": None}


def retained_citations(machine_row: dict) -> list[tuple[str, str]]:
    """Any retained Wikipedia/citation/Footywire field genuinely present on the machine row
    (none exists in the 2026-09-18 v2 review; nothing is ever invented)."""
    found: list[tuple[str, str]] = []

    def walk(node, prefix: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                name = f"{prefix}.{key}" if prefix else key
                lowered = key.lower()
                if any(word in lowered for word in ("wikipedia", "citation", "footywire")) and value:
                    found.append((name, json.dumps(value, ensure_ascii=True, sort_keys=True)))
                else:
                    walk(value, name)
        elif isinstance(node, list):
            for i, value in enumerate(node):
                walk(value, f"{prefix}[{i}]")

    walk(machine_row, "")
    return found


# ---------------------------------------------------------------------------
# Inputs: the four machine artefacts + the sample, hash-verified, then the 69-row queue
# ---------------------------------------------------------------------------

def is_mandatory_class(key: str) -> bool:
    return key.startswith(MANDATORY_CLASS_PREFIXES)


def load_inputs(root: Path, *, rel: dict[str, str] | None = None,
                pinned: dict[str, str] | None = None, expect: dict | None = None) -> dict:
    rel = dict(default_rel() if rel is None else rel)
    pinned = dict(PINNED_SHA256 if pinned is None else pinned)
    expect = dict(EXPECT if expect is None else expect)

    raw: dict[str, bytes] = {}
    sha: dict[str, str] = {}
    for key, path_rel in rel.items():
        path = root / path_rel
        if not path.is_file():
            raise ToolError(f"missing {key}: {path_rel}")
        raw[key] = path.read_bytes()
        sha[key] = sha256_bytes(raw[key])
        if key in pinned and pinned[key] != sha[key]:
            raise ToolError(f"hash mismatch for {key} ({path_rel}): observed {sha[key]}, "
                            f"pinned {pinned[key]} -- refusing to review against changed bytes")

    def parse(key: str) -> dict:
        try:
            doc = json.loads(raw[key].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ToolError(f"{key} does not parse as JSON: {exc}") from exc
        if not isinstance(doc, dict):
            raise ToolError(f"{key} is not a JSON object")
        return doc

    recheck = parse("recheck")
    verdicts = parse("verdicts_json")
    residual = parse("residual")

    if recheck.get("verdicts_sha256") != sha["verdicts_json"]:
        raise ToolError("recheck queue is not hash-linked to the verdicts artefact on disk")
    if residual.get("verdicts_sha256") != sha["verdicts_json"]:
        raise ToolError("residual report is not hash-linked to the verdicts artefact on disk")
    if recheck.get("sample_sha256") != sha["sample_json"]:
        raise ToolError("recheck queue is not hash-linked to the sample on disk")
    if residual.get("sample_sha256") != sha["sample_json"]:
        raise ToolError("residual report is not hash-linked to the sample on disk")
    if recheck.get("verdicts_path") != rel["verdicts_json"]:
        raise ToolError(f"recheck verdicts_path {recheck.get('verdicts_path')!r} != {rel['verdicts_json']!r}")
    storage = recheck.get("operator_verdict_storage") or {}
    if storage.get("path") != FINAL_REL or list(storage.get("allowed_verdicts") or []) != list(VERDICT_VALUES):
        raise ToolError("recheck operator_verdict_storage does not name the expected artefact path "
                        "and verdict vocabulary")

    rows = verdicts.get("rows")
    if not isinstance(rows, list) or not rows:
        raise ToolError("verdicts artefact carries no rows")
    rows_sha = sha256_bytes(canonical_json_bytes(rows))
    if rows_sha != verdicts.get("rows_sha256"):
        raise ToolError("verdicts rows_sha256 does not reproduce from the rows")
    if expect.get("rows_sha256") and rows_sha != expect["rows_sha256"]:
        raise ToolError(f"rows_sha256 {rows_sha} != expected {expect['rows_sha256']}")

    rows_by_url: dict[str, dict] = {}
    for i, r in enumerate(rows):
        if not isinstance(r, dict) or not r.get("player_url"):
            raise ToolError(f"row {i + 1}: not an object with a player_url")
        url = r["player_url"]
        if url in rows_by_url:
            raise ToolError(f"duplicate person in the verdicts rows: {url}")
        if r.get("outcome") not in base.OUTCOMES:
            raise ToolError(f"{url}: outcome {r.get('outcome')!r} is not a machine outcome")
        if (r.get("deployment_status") == "target_not_registered") != (r.get("outcome") == "target_unregistered"):
            raise ToolError(f"{url}: deployment status and outcome are inconsistent")
        if r.get("operator_verdict") is not None:
            raise ToolError(f"{url}: the machine artefact carries an operator verdict")
        rows_by_url[url] = r

    classes = recheck.get("classes")
    if not isinstance(classes, dict) or tuple(sorted(classes)) != tuple(sorted(CLASS_ORDER)):
        raise ToolError("recheck classes are not exactly the eleven runbook classes")
    for key in CLASS_ORDER:
        refs = classes[key]
        if not isinstance(refs, list):
            raise ToolError(f"class {key} is not a list")
        seen: set[str] = set()
        for ref in refs:
            url = ref.get("player_url") if isinstance(ref, dict) else None
            if url not in rows_by_url:
                raise ToolError(f"class {key}: {url!r} is not in the verdicts rows")
            if url in seen:
                raise ToolError(f"class {key}: {url} listed twice")
            seen.add(url)
            row = rows_by_url[url]
            if (ref.get("outcome") != row["outcome"] or ref.get("sample_index") != row.get("sample_index")
                    or ref.get("stratum") != row.get("stratum")
                    or list(ref.get("reason_codes") or []) != list(row.get("reason_codes") or [])):
                raise ToolError(f"class {key}: {url} ref disagrees with its machine row")
            if ref.get("operator_verdict") is not None:
                raise ToolError(f"class {key}: {url} template already carries an operator verdict")

    queue = build_queue(recheck, rows_by_url)
    mandatory_n = sum(1 for q in queue if q["is_mandatory"])
    audit_n = sum(1 for q in queue if q["is_audit"])
    audit = recheck.get("audit") or {}
    if recheck.get("mandatory_distinct_rows") != mandatory_n:
        raise ToolError(f"recorded mandatory_distinct_rows {recheck.get('mandatory_distinct_rows')!r} "
                        f"!= derived {mandatory_n}")
    if audit.get("count") != audit_n:
        raise ToolError(f"recorded audit count {audit.get('count')!r} != derived {audit_n}")
    for what, observed in (("mandatory", mandatory_n), ("audit", audit_n), ("total", len(queue))):
        if expect.get(what) is not None and expect[what] != observed:
            raise ToolError(f"expected {what} queue rows {expect[what]}, observed {observed}")

    queue_sha = sha256_bytes(canonical_json_bytes(
        [[q["player_url"], q["classes"], q["sample_index"], q["outcome"]] for q in queue]))
    return {
        "root": root, "rel": rel, "sha256": sha, "recheck": recheck, "rows_by_url": rows_by_url,
        "rows_sha256": rows_sha, "queue": queue, "queue_sha256": queue_sha,
        "mandatory": mandatory_n, "audit": audit_n, "total_sample_rows": len(rows),
        "audit_salt": audit.get("salt"),
    }


def build_queue(recheck: dict, rows_by_url: dict[str, dict]) -> list[dict]:
    """One entry per required person: mandatory rows (classes 1-10) first, then the audit, each
    in sample order. A person in several classes appears once with every membership listed."""
    memberships: dict[str, list[str]] = {}
    for key in CLASS_ORDER:
        for ref in recheck["classes"][key]:
            memberships.setdefault(ref["player_url"], []).append(key)
    entries: list[dict] = []
    for url, keys in memberships.items():
        row = rows_by_url[url]
        is_mandatory = any(is_mandatory_class(k) for k in keys)
        is_audit = AUDIT_CLASS in keys
        if is_mandatory and is_audit:
            raise ToolError(f"{url}: in both the mandatory classes and the audit")
        entries.append({
            "player_url": url, "sample_index": row["sample_index"], "classes": keys,
            "is_mandatory": is_mandatory, "is_audit": is_audit,
            "classification": "mandatory" if is_mandatory else "audit",
            "outcome": row["outcome"], "deployment_status": row.get("deployment_status"),
            "identity_evaluable": bool(row.get("identity_evaluable")),
            "machine": row,
        })
    entries.sort(key=lambda q: (0 if q["is_mandatory"] else 1, q["sample_index"], q["player_url"]))
    for i, q in enumerate(entries):
        q["position"] = i + 1
    return entries


# ---------------------------------------------------------------------------
# Row presentation helpers (pure; used by the GUI and asserted by the contract test)
# ---------------------------------------------------------------------------

def _fmt(value) -> str:
    if value is None:
        return "(not recorded)"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) if value else "(none)"
    return str(value)


def identity_summary(qrow: dict) -> dict:
    m = qrow["machine"]
    dg = m.get("draftguru") or {}
    rt = m.get("retained_target") or {}
    return {
        "draftguru_name": dg.get("visible_name") or "(name not captured)",
        "draftguru_title": dg.get("title"),
        "draftguru_url": m.get("player_url"),
        "proposed_identity": m.get("expected_afltables_identity"),
        "retained_names": list(rt.get("players") or []),
        "outcome": m.get("outcome"),
        "deployment_status": m.get("deployment_status"),
        "identity_evaluable": bool(m.get("identity_evaluable")),
    }


def review_reasons(qrow: dict) -> list[str]:
    m = qrow["machine"]
    flags = m.get("flags") or {}
    reasons = [f"{key}: {CLASS_LABELS[key]}" for key in qrow["classes"]]
    if flags.get("known_exception_class"):
        reasons.append(f"known exception class: {flags['known_exception_class']}")
    if flags.get("name_variant"):
        reasons.append("name variant flagged")
    if flags.get("numeric_suffix"):
        reasons.append("identity path carries a numeric suffix (same-name disambiguation)")
    if flags.get("continuity_rule_url"):
        reasons.append("identity is a continuity-rule path")
    if m.get("weak_evidence"):
        reasons.append("weak evidence: exactly the minimum third signal and no club overlap")
    if m.get("ledger_status") not in (None, "none"):
        reasons.append(f"ledger status: {m.get('ledger_status')}")
    if m.get("missing_fields"):
        reasons.append(f"missing retained fields: {', '.join(m['missing_fields'])}")
    return reasons


def reason_code_lines(qrow: dict) -> list[str]:
    lines = []
    for code in qrow["machine"].get("reason_codes") or []:
        meaning = REASON_CODE_MEANINGS.get(code, "(no description recorded for this code)")
        lines.append(f"{code} -- {meaning}")
    return lines


def comparison_rows(qrow: dict) -> list[tuple[str, str, str]]:
    """(fact, DraftGuru side, retained AFL Tables/AFLDB side)."""
    m = qrow["machine"]
    dg = m.get("draftguru") or {}
    sa = m.get("stage_a") or {}
    rt = m.get("retained_target")
    earliest = sa.get("earliest_original_recruitment") or {}
    sa_rows = sa.get("rows") or []
    sa_clubs: list[str] = []
    for r in sa_rows:
        club = r.get("club_name_raw")
        if club and club not in sa_clubs:
            sa_clubs.append(club)
    sa_games = [r.get("games") for r in sa_rows if r.get("games") is not None]
    if rt is None:
        none = "-- none: identity not registered on afldb_test (no retained target facts) --"
        retained = {k: none for k in ("names", "birth", "span", "games", "clubs", "ids")}
    else:
        dob_years = rt.get("dob_years") or []
        birth = (f"DOB year(s) {_fmt(dob_years)}" if dob_years
                 else f"no DOB recorded; implied from age: {_fmt(rt.get('implied_birth_year'))}")
        retained = {
            "names": f"{_fmt(rt.get('players'))} (first {_fmt(rt.get('first_names'))}; "
                     f"surname {_fmt(rt.get('surnames'))})",
            "birth": birth,
            "span": f"debut {_fmt(rt.get('debut_season'))} ({_fmt(rt.get('debut_date'))}) to "
                    f"last season {_fmt(rt.get('last_season'))}",
            "games": f"career games {_fmt(rt.get('career_games'))} (to season 2025); "
                     f"goals {_fmt(rt.get('goals_sum'))}",
            "clubs": _fmt(rt.get("clubs")),
            "ids": f"fitzRoy ID(s) {_fmt(rt.get('fitzroy_ids'))}; distinct "
                   f"{_fmt(rt.get('distinct_fitzroy_id_count'))}",
        }
    display_raw = [s.replace(" ", " ") for s in (sa.get("display_names_raw") or [])]
    extra_names = []
    if m.get("aliases"):
        extra_names.append(f"aliases {_fmt(m['aliases'])}")
    if m.get("awards_census_names"):
        extra_names.append(f"awards census {_fmt(m['awards_census_names'])}")
    if m.get("brownlow_census_names"):
        extra_names.append(f"Brownlow census {_fmt(m['brownlow_census_names'])}")
    return [
        ("Names", f"{_fmt(dg.get('visible_name'))}; Stage A {_fmt(display_raw)}"
                  + (f"; {'; '.join(extra_names)}" if extra_names else ""), retained["names"]),
        ("Birth year", f"title year {_fmt(dg.get('title_birth_year'))}; DOB candidates "
                       f"{_fmt(dg.get('dob_candidates'))}", retained["birth"]),
        ("Career span", f"earliest original recruitment {_fmt(earliest.get('draft_year'))} "
                        f"({_fmt(earliest.get('event_type_raw'))}); earliest trade year "
                        f"{_fmt(sa.get('earliest_trade_year'))}; trade-only {_fmt(sa.get('trade_only'))}",
         retained["span"]),
        ("Games", f"Stage A games figure(s) {_fmt(sa_games)}", retained["games"]),
        ("Clubs", _fmt(sa_clubs), retained["clubs"]),
        ("Identity", f"captured {_fmt(dg.get('captured_identity'))}; href count "
                     f"{_fmt(dg.get('afltables_href_count'))}; distinct identities "
                     f"{_fmt(dg.get('distinct_afltables_identity_count'))}", retained["ids"]),
    ]


def stage_a_lines(qrow: dict) -> list[str]:
    lines = []
    for r in (qrow["machine"].get("stage_a") or {}).get("rows") or []:
        lines.append(f"{_fmt(r.get('draft_year'))} {_fmt(r.get('event_type_raw'))} -- "
                     f"{_fmt(r.get('club_name_raw'))}; pick {_fmt(r.get('pick_number'))}; age "
                     f"{_fmt(r.get('age_raw'))}; games {_fmt(r.get('games'))}; goals {_fmt(r.get('goals'))}")
    return lines


def verdict_guidance(qrow: dict) -> str:
    outcome = qrow["outcome"]
    parts = []
    if qrow["is_audit"]:
        parts.append("AUDIT ROW: the machine found this row offline_strong. Compare the retained "
                     "facts yourself and record 'agree' only if you confirm the same human. Any "
                     "other verdict is a disproved audit row: acceptance stops and the row is "
                     "never replaced or redrawn (runbook section 8). Nothing is preselected and "
                     "nothing is agreed on your behalf.")
    else:
        parts.append("MANDATORY RECHECK ROW: it needs a terminal verdict from you before the "
                     "validator can decide acceptance.")
    if outcome == "offline_contradict":
        parts.append("The machine recorded a CONTRADICTION. Recording 'agree' overrides it and "
                     "must be justified: notes AND evidence are required for every verdict on this "
                     "row (acceptance rule: an offline_contradict not resolved to 'agree' with "
                     "evidence is a genuine failure).")
    if outcome == "target_unregistered":
        parts.append("Identity is NOT evaluable here: " + DEPLOYMENT_STATEMENT + " 'Agree' confirms "
                     "continued withholding; 'contradict' or 'undetermined' disputes the row's "
                     "disposition, requires notes and evidence, and blocks acceptance.")
    parts.append("Agree: no notes required (welcome). Contradict: a genuine identity failure -- "
                 "notes and evidence required; acceptance is blocked. Undetermined: not a pass, "
                 "escalated and never redrawn -- notes and evidence required; acceptance is blocked. "
                 "Selecting an option does nothing until you click 'Save verdict for this row'.")
    return "\n\n".join(parts)


HELP_TEXT = f"""AFLDB-ISSUE-222 Phase F operator adjudication -- how to use this tool

The queue holds every REQUIRED row exactly once: the mandatory recheck rows (classes 1-10)
first, then the deterministic audit (class 11), each in sample order. A person in several
classes is shown once with all memberships listed. "Row 7 of 69" is your position in the
queue (or in the filtered view, with the queue position beside it).

Per row you see: the DraftGuru person and the proposed AFL Tables identity; why the row
requires review; the MACHINE IDENTITY OUTCOME and, separately, the CHILD DEPLOYMENT STATUS
({DEPLOYMENT_STATEMENT}); the retained comparison evidence (names, birth-year evidence, career
span, games, clubs, identity, Stage A rows, reason codes); and the evidence links.

Evidence links: the full DraftGuru and AFL Tables URLs are shown. Open launches your own
default browser after scheme/host validation ({', '.join(sorted(DRAFTGURU_ALLOWED_HOSTS))};
{', '.join(sorted(AFLTABLES_ALLOWED_HOSTS))}); Copy puts the URL on the clipboard. Neither
creates, changes or saves a verdict, note or checkpoint. Wikipedia/Footywire are never authority;
a retained citation is shown only when one genuinely exists on the row (none does in this review).

Verdicts (stored values in brackets):
  {VERDICT_LABELS['agree']} [agree]
  {VERDICT_LABELS['contradict']} [contradict]
  {VERDICT_LABELS['undetermined']} [undetermined]
Nothing is preselected. Selecting an option is NOT saved until you click "Save verdict for this
row" (Ctrl+S). Contradict and undetermined require notes AND at least one evidence line; on a
machine-contradiction row every verdict does. Audit rows are never auto-agreed and there is no
bulk action.

Navigation: Previous / Next are always visible in the footer (disabled only at the ends);
Alt+Left / Alt+Right do the same; Page Up / Page Down scroll the form; the form scrolls to the
top on every row change. With an unsaved edit, moving away asks Save / Discard / Stay.
Filters (completion, classification, machine outcome, deployment status) never reorder rows.

Checkpoint: {CHECKPOINT_DIR_REL}/progress.json is written atomically after every saved verdict,
when a notes/evidence field loses focus (as a draft, never a verdict) and before close; it is
hash-linked to the recheck queue and every machine artefact and resume is refused on a mismatch.
A review.lock beside it prevents two sessions.

Finalise is enabled only when all required rows carry a valid verdict. It writes exactly
{FINAL_REL}, never overwrites a differing file, imports nothing, links nothing, accepts nothing.
Then run: {NEXT_COMMAND}
"""


# ---------------------------------------------------------------------------
# Decision contract (mirrors validate_validation_review.py section 6, plus the acceptance
# rule's evidence demand for a machine-contradiction override)
# ---------------------------------------------------------------------------

def decision_problems(qrow: dict, verdict: str | None, notes: str | None,
                      evidence: list[str] | None) -> list[str]:
    problems: list[str] = []
    if verdict is None or verdict == "":
        return ["no verdict selected"]
    if verdict not in VERDICT_VALUES:
        return [f"verdict {verdict!r} is not one of {list(VERDICT_VALUES)}"]
    needs = verdict in ("contradict", "undetermined") or qrow["outcome"] == "offline_contradict"
    if needs:
        why = ("a machine-contradiction override" if qrow["outcome"] == "offline_contradict"
               and verdict == "agree" else f"'{verdict}'")
        if not (notes or "").strip():
            problems.append(f"notes are required for {why}")
        if not evidence:
            problems.append(f"at least one evidence line is required for {why}")
    return problems


# ---------------------------------------------------------------------------
# Checkpoint and lock -- gitignored under data/review/
# ---------------------------------------------------------------------------

def checkpoint_paths(root: Path, dir_rel: str = CHECKPOINT_DIR_REL) -> dict:
    d = root / dir_rel
    return {"dir": d, "progress": d / "progress.json", "lock": d / "review.lock"}


def source_block(inputs: dict) -> dict:
    return {
        "recheck_path": inputs["rel"]["recheck"],
        "recheck_sha256": inputs["sha256"]["recheck"],
        "verdicts_json_sha256": inputs["sha256"]["verdicts_json"],
        "verdicts_csv_sha256": inputs["sha256"]["verdicts_csv"],
        "residual_sha256": inputs["sha256"]["residual"],
        "sample_sha256": inputs["sha256"]["sample_json"],
        "rows_sha256": inputs["rows_sha256"],
        "queue_sha256": inputs["queue_sha256"],
        "queue_total": len(inputs["queue"]),
        "mandatory": inputs["mandatory"],
        "audit": inputs["audit"],
    }


def new_checkpoint(inputs: dict, *, clock=utc_now) -> dict:
    now = clock()
    return {
        "schema_version": CHECKPOINT_SCHEMA_VERSION,
        "tool": {"path": TOOL, "version": TOOL_VERSION},
        "issue": reviewer.ISSUE, "label": reviewer.LABEL, "phase": reviewer.PHASE,
        "source": source_block(inputs),
        "final_path": FINAL_REL,
        "review_started_utc": now, "last_saved_utc": now,
        "finalized": False, "finalized_utc": None, "final_sha256": None,
        "decisions": {}, "drafts": {},
    }


def load_checkpoint(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ToolError(f"checkpoint {path} is not valid JSON: {exc}") from exc
    if not isinstance(doc, dict):
        raise ToolError(f"checkpoint {path} is not a JSON object")
    return doc


def save_checkpoint(path: Path, checkpoint: dict, *, clock=utc_now) -> dict:
    checkpoint["last_saved_utc"] = clock()
    atomic_write_bytes(path, dump_json_lf(checkpoint))
    return checkpoint


def validate_checkpoint_matches_inputs(checkpoint: dict, inputs: dict) -> None:
    if checkpoint.get("schema_version") != CHECKPOINT_SCHEMA_VERSION:
        raise ToolError(f"checkpoint schema_version {checkpoint.get('schema_version')!r} is not "
                        f"{CHECKPOINT_SCHEMA_VERSION}; this tool migrates nothing -- refusing to resume")
    expected = source_block(inputs)
    recorded = checkpoint.get("source") or {}
    mismatched = [k for k, v in expected.items() if recorded.get(k) != v]
    if mismatched:
        raise ToolError("the checkpoint belongs to different machine-review artefacts or a different "
                        f"queue ({', '.join(mismatched)} differ) -- refusing to resume; keep it aside "
                        "and confirm which review the operator should be adjudicating")
    known = {q["player_url"] for q in inputs["queue"]}
    for section in ("decisions", "drafts"):
        block = checkpoint.get(section)
        if not isinstance(block, dict):
            raise ToolError(f"checkpoint {section} is not an object")
        stale = [u for u in block if u not in known]
        if stale:
            raise ToolError(f"checkpoint {section} carry rows outside the queue: {sorted(stale)[:5]}")
    by_url = {q["player_url"]: q for q in inputs["queue"]}
    for url, d in checkpoint["decisions"].items():
        if not isinstance(d, dict) or d.get("operator_verdict") not in VERDICT_VALUES:
            raise ToolError(f"checkpoint decision for {url} carries an invalid verdict")
        if not UTC_RE.match(str(d.get("reviewed_utc") or "")):
            raise ToolError(f"checkpoint decision for {url} lacks a UTC reviewed_utc")
        if d.get("machine_outcome") != by_url[url]["outcome"]:
            raise ToolError(f"checkpoint decision for {url} records a machine outcome that differs "
                            "from the machine artefact -- refusing to resume")


def load_or_create_checkpoint(paths: dict, inputs: dict, *, clock=utc_now) -> dict:
    checkpoint = load_checkpoint(paths["progress"])
    if checkpoint is None:
        return save_checkpoint(paths["progress"], new_checkpoint(inputs, clock=clock), clock=clock)
    validate_checkpoint_matches_inputs(checkpoint, inputs)
    return checkpoint


def acquire_lock(lock_path: Path, force: bool = False) -> dict:
    if lock_path.is_file():
        try:
            existing = json.loads(lock_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = {}
        if not force:
            raise ToolError(
                f"a review lock already exists at {lock_path} (pid={existing.get('pid')}, "
                f"host={existing.get('hostname')}, started={existing.get('started_utc')}). If you "
                "are certain no other session is running, rerun with --force-unlock.")
        print(f"WARNING: removing existing lock (pid={existing.get('pid')}, "
              f"host={existing.get('hostname')}, started={existing.get('started_utc')}) because "
              "--force-unlock was given", file=sys.stderr)
    payload = {"pid": os.getpid(), "hostname": platform.node(), "started_utc": utc_now(),
               "session_id": uuid.uuid4().hex, "tool": TOOL}
    atomic_write_bytes(lock_path, dump_json_lf(payload))
    return payload


def release_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# The review session: every workflow rule, GUI-independent and headless-testable
# ---------------------------------------------------------------------------

class UnsavedChanges(Exception):
    """Raised when navigation or filtering is attempted with an unsaved edit on the current row."""


FILTER_VALUES: dict[str, tuple[str, ...]] = {
    "completion": ("all", "incomplete", "complete"),
    "classification": ("all", "mandatory", "audit"),
    "outcome": ("all",) + tuple(base.OUTCOMES),
    "deployment": ("all", "bridged", "target_not_registered"),
}


class ReviewSession:
    def __init__(self, inputs: dict, checkpoint: dict, progress_path: Path, *, clock=utc_now):
        self.inputs = inputs
        self.checkpoint = checkpoint
        self.progress_path = progress_path
        self.clock = clock
        self.queue: list[dict] = inputs["queue"]
        self.by_url: dict[str, dict] = {q["player_url"]: q for q in self.queue}
        self.filters: dict[str, str] = {name: "all" for name in FILTER_VALUES}
        self.index = 0
        self.draft: dict = {"verdict": None, "notes": "", "evidence_text": ""}
        self._load_draft()

    # -- queue and navigation ------------------------------------------------------------
    def _matches(self, q: dict) -> bool:
        f = self.filters
        if f["completion"] == "incomplete" and self.row_state(q["player_url"]) == "complete":
            return False
        if f["completion"] == "complete" and self.row_state(q["player_url"]) != "complete":
            return False
        if f["classification"] != "all" and q["classification"] != f["classification"]:
            return False
        if f["outcome"] != "all" and q["outcome"] != f["outcome"]:
            return False
        if f["deployment"] != "all" and q["deployment_status"] != f["deployment"]:
            return False
        return True

    def visible(self) -> list[dict]:
        return [q for q in self.queue if self._matches(q)]

    def current(self) -> dict | None:
        vis = self.visible()
        if not vis:
            return None
        self.index = max(0, min(self.index, len(vis) - 1))
        return vis[self.index]

    def can_go_prev(self) -> bool:
        return self.current() is not None and self.index > 0

    def can_go_next(self) -> bool:
        vis = self.visible()
        return bool(vis) and self.index < len(vis) - 1

    def _require_clean(self) -> None:
        if self.is_dirty():
            raise UnsavedChanges("the current row has an unsaved edit: save or discard it first")

    def go_prev(self) -> dict | None:
        self._require_clean()
        if self.can_go_prev():
            self.index -= 1
        self._load_draft()
        return self.current()

    def go_next(self) -> dict | None:
        self._require_clean()
        if self.can_go_next():
            self.index += 1
        self._load_draft()
        return self.current()

    def go_to_queue_position(self, position: int) -> dict | None:
        self._require_clean()
        vis = self.visible()
        for i, q in enumerate(vis):
            if q["position"] == position:
                self.index = i
                break
        self._load_draft()
        return self.current()

    def set_filter(self, name: str, value: str) -> None:
        if name not in FILTER_VALUES or value not in FILTER_VALUES[name]:
            raise ToolError(f"unknown filter {name}={value!r}")
        self._require_clean()
        current = self.current()
        self.filters[name] = value
        vis = self.visible()
        self.index = 0
        if current is not None:
            for i, q in enumerate(vis):
                if q["player_url"] == current["player_url"]:
                    self.index = i
                    break
        self._load_draft()

    def position_text(self) -> str:
        vis = self.visible()
        cur = self.current()
        if cur is None:
            return f"No rows match the current filters (queue of {len(self.queue)})"
        if all(v == "all" for v in self.filters.values()):
            return f"Row {self.index + 1} of {len(vis)}"
        return f"Row {self.index + 1} of {len(vis)} shown (queue position {cur['position']} of {len(self.queue)})"

    # -- decisions and drafts ------------------------------------------------------------
    def decision_for(self, url: str) -> dict | None:
        return self.checkpoint["decisions"].get(url)

    def row_state(self, url: str) -> str:
        d = self.decision_for(url)
        if d is None:
            return "incomplete"
        if decision_problems(self.by_url[url], d.get("operator_verdict"), d.get("notes"), d.get("evidence")):
            return "invalid"
        return "complete"

    def _blank_draft(self, url: str) -> dict:
        d = self.decision_for(url)
        if d is None:
            return {"verdict": None, "notes": "", "evidence_text": ""}
        return {"verdict": d["operator_verdict"], "notes": d.get("notes") or "",
                "evidence_text": "\n".join(d.get("evidence") or [])}

    def _load_draft(self) -> None:
        cur = self.current()
        if cur is None:
            self.draft = {"verdict": None, "notes": "", "evidence_text": ""}
            return
        stored = self.checkpoint["drafts"].get(cur["player_url"])
        if stored:
            self.draft = {"verdict": stored.get("verdict"), "notes": stored.get("notes") or "",
                          "evidence_text": stored.get("evidence_text") or ""}
        else:
            self.draft = self._blank_draft(cur["player_url"])

    def set_draft(self, *, verdict=..., notes=..., evidence_text=...) -> None:
        if verdict is not ...:
            self.draft["verdict"] = verdict or None
        if notes is not ...:
            self.draft["notes"] = notes or ""
        if evidence_text is not ...:
            self.draft["evidence_text"] = evidence_text or ""

    def _normalised(self, draft: dict) -> tuple:
        return (draft.get("verdict") or None, (draft.get("notes") or "").strip(),
                tuple(parse_evidence(draft.get("evidence_text"))))

    def is_dirty(self) -> bool:
        cur = self.current()
        if cur is None:
            return False
        return self._normalised(self.draft) != self._normalised(self._blank_draft(cur["player_url"]))

    def draft_problems(self) -> list[str]:
        cur = self.current()
        if cur is None:
            return ["no current row"]
        return decision_problems(cur, self.draft.get("verdict"), self.draft.get("notes"),
                                 parse_evidence(self.draft.get("evidence_text")))

    def status_text(self) -> str:
        cur = self.current()
        if cur is None:
            return "NO ROW: nothing to record"
        d = self.decision_for(cur["player_url"])
        if self.is_dirty():
            v = self.draft.get("verdict")
            if d is None or v != d["operator_verdict"]:
                what = f"'{v}' selected" if v else "no verdict selected"
                return f"UNSAVED: {what} -- not saved until you click 'Save verdict for this row'"
            return "UNSAVED: notes/evidence changed -- not saved until you click 'Save verdict for this row'"
        if d is None:
            return "NO VERDICT: nothing saved for this row"
        return (f"SAVED: '{d['operator_verdict']}' (stored value \"{d['operator_verdict']}\") at "
                f"{d['reviewed_utc']}")

    def save(self) -> None:
        save_checkpoint(self.progress_path, self.checkpoint, clock=self.clock)

    def stash_draft(self) -> None:
        """Persists the current field contents as a DRAFT (never a verdict) so text survives a
        crash; called on focus loss. A clean row has its draft removed."""
        cur = self.current()
        if cur is None:
            return
        url = cur["player_url"]
        if self.is_dirty():
            self.checkpoint["drafts"][url] = dict(self.draft)
        else:
            self.checkpoint["drafts"].pop(url, None)
        self.save()

    def commit(self) -> list[str]:
        """Records the draft as this row's verdict when it satisfies the contract; otherwise
        returns the problems and records nothing."""
        cur = self.current()
        if cur is None:
            return ["no current row"]
        problems = self.draft_problems()
        if problems:
            return problems
        url = cur["player_url"]
        self.checkpoint["decisions"][url] = {
            "operator_verdict": self.draft["verdict"],
            "notes": (self.draft.get("notes") or "").strip() or None,
            "evidence": parse_evidence(self.draft.get("evidence_text")) or None,
            "reviewed_utc": self.clock(),
            "sample_index": cur["sample_index"],
            "classes": list(cur["classes"]),
            "classification": cur["classification"],
            "machine_outcome": cur["outcome"],
            "deployment_status": cur["deployment_status"],
        }
        self.checkpoint["drafts"].pop(url, None)
        self.save()
        self._load_draft()
        return []

    def discard(self) -> None:
        cur = self.current()
        if cur is not None:
            self.checkpoint["drafts"].pop(cur["player_url"], None)
            self.save()
        self._load_draft()

    def clear_decision(self) -> None:
        cur = self.current()
        if cur is None:
            return
        self.checkpoint["decisions"].pop(cur["player_url"], None)
        self.checkpoint["drafts"].pop(cur["player_url"], None)
        self.save()
        self._load_draft()

    # -- progress, gating, finalisation --------------------------------------------------
    def progress(self) -> dict:
        counts = {v: 0 for v in VERDICT_VALUES}
        done = m_done = a_done = 0
        for q in self.queue:
            if self.row_state(q["player_url"]) == "complete":
                done += 1
                counts[self.decision_for(q["player_url"])["operator_verdict"]] += 1
                if q["is_mandatory"]:
                    m_done += 1
                else:
                    a_done += 1
        return {"total": len(self.queue), "completed": done, "remaining": len(self.queue) - done,
                "mandatory_total": self.inputs["mandatory"], "mandatory_completed": m_done,
                "audit_total": self.inputs["audit"], "audit_completed": a_done,
                "by_verdict": counts, "drafts_pending": len(self.checkpoint["drafts"])}

    def progress_text(self) -> str:
        p = self.progress()
        return (f"Saved verdicts {p['completed']} of {p['total']} (mandatory {p['mandatory_completed']}/"
                f"{p['mandatory_total']}, audit {p['audit_completed']}/{p['audit_total']}); "
                f"{p['remaining']} remaining; agree {p['by_verdict']['agree']}, contradict "
                f"{p['by_verdict']['contradict']}, undetermined {p['by_verdict']['undetermined']}")

    def finalize_blockers(self) -> list[str]:
        blockers = []
        for q in self.queue:
            d = self.decision_for(q["player_url"])
            if d is None:
                blockers.append(f"#{q['position']} {q['player_url']}: no verdict saved")
                continue
            for p in decision_problems(q, d.get("operator_verdict"), d.get("notes"), d.get("evidence")):
                blockers.append(f"#{q['position']} {q['player_url']}: {p}")
        return blockers

    def can_finalize(self) -> bool:
        return not self.finalize_blockers()

    def acceptance_preview(self) -> dict:
        """What validate_validation_review.py will conclude from these verdicts (informative;
        the validator alone decides)."""
        contradict, undetermined, audit_not_agree, machine_not_resolved = [], [], [], []
        for q in self.queue:
            d = self.decision_for(q["player_url"])
            if d is None:
                continue
            v = d["operator_verdict"]
            if v == "contradict":
                contradict.append(q["player_url"])
            if v == "undetermined":
                undetermined.append(q["player_url"])
            if q["is_audit"] and v != "agree":
                audit_not_agree.append(q["player_url"])
            if q["outcome"] == "offline_contradict" and v != "agree":
                machine_not_resolved.append(q["player_url"])
        blocked = bool(contradict or undetermined or audit_not_agree or machine_not_resolved)
        return {"contradict": contradict, "undetermined": undetermined,
                "audit_not_agree": audit_not_agree, "machine_contradictions_unresolved": machine_not_resolved,
                "would_be_accepted": not blocked and self.can_finalize()}

    def render_final(self, review_completed_utc: str) -> bytes:
        blockers = self.finalize_blockers()
        if blockers:
            raise ToolError(f"{len(blockers)} required row(s) do not satisfy the verdict contract, "
                            f"e.g. {blockers[:3]}")
        if not UTC_RE.match(review_completed_utc or ""):
            raise ToolError(f"review_completed_utc {review_completed_utc!r} is not a UTC timestamp")
        doc = copy.deepcopy(self.inputs["recheck"])
        counts = {v: 0 for v in VERDICT_VALUES}
        for key in CLASS_ORDER:
            for ref in doc["classes"][key]:
                d = self.checkpoint["decisions"][ref["player_url"]]
                if ref["outcome"] != d["machine_outcome"]:
                    raise ToolError(f"{ref['player_url']}: machine outcome would be edited; refusing")
                ref["operator_verdict"] = d["operator_verdict"]
                ref["reviewed_utc"] = d["reviewed_utc"]
                ref["notes"] = d.get("notes")
                ref["evidence"] = list(d["evidence"]) if d.get("evidence") else None
        for url, d in self.checkpoint["decisions"].items():
            if url in self.by_url:
                counts[d["operator_verdict"]] += 1
        doc["$comment"] = (f"{reviewer.ISSUE} Phase F operator verdicts over the recheck queue "
                           f"{self.inputs['rel']['recheck']}: a copy of that queue with the operator "
                           "block filled on every required row. The machine outcome is never edited. "
                           "Acceptance is decided only by validate_validation_review.py. This file "
                           "authorises no import.")
        doc["source_recheck_path"] = self.inputs["rel"]["recheck"]
        doc["source_recheck_sha256"] = self.inputs["sha256"]["recheck"]
        doc["review_completed_utc"] = review_completed_utc
        doc["operator_tool"] = {"path": TOOL, "version": TOOL_VERSION}
        doc["operator_summary"] = {
            "required_rows": len(self.queue), "mandatory_distinct_rows": self.inputs["mandatory"],
            "audit_rows": self.inputs["audit"], "verdict_counts": counts,
            "machine_outcome_never_edited": True,
            "not_performed": ["any database connection", "any network request", "any importer run",
                              "any player link", "Phase F or Phase 3 acceptance", "Phase 4"],
        }
        data = dump_json_lf(doc)
        check_output_hygiene(data, "the operator verdict artefact")
        return data

    def finalize(self, review_completed_utc: str | None = None) -> dict:
        completed = review_completed_utc or self.clock()
        data = self.render_final(completed)
        path = self.inputs["root"] / FINAL_REL
        digest = sha256_bytes(data)
        if path.is_file():
            existing = path.read_bytes()
            if existing != data:
                raise ToolError(f"{FINAL_REL} already exists with different content (sha256 "
                                f"{sha256_bytes(existing)}); refusing to overwrite it -- move it aside "
                                "deliberately if it is stale")
            identical = True
        else:
            atomic_write_bytes(path, data)
            identical = False
        self.checkpoint["finalized"] = True
        self.checkpoint["finalized_utc"] = completed
        self.checkpoint["final_sha256"] = digest
        self.save()
        return {"path": FINAL_REL, "sha256": digest, "bytes": len(data),
                "already_identical": identical, "review_completed_utc": completed,
                "next_command": NEXT_COMMAND}


# ---------------------------------------------------------------------------
# GUI (built only when Tcl/Tk is available; everything above is importable without it)
# ---------------------------------------------------------------------------

_AppBase = tk.Tk if TK_AVAILABLE else object


class OperatorApp(_AppBase):  # type: ignore[misc]
    FONT_BASE = ("Segoe UI", 10)
    FONT_BOLD = ("Segoe UI", 10, "bold")
    FONT_TITLE = ("Segoe UI", 13, "bold")
    FONT_MONO = ("Consolas", 10)

    def __init__(self, session: ReviewSession):
        if not TK_AVAILABLE:
            raise ToolError("tkinter is not available in this Python environment")
        super().__init__()
        self.session = session
        self._loading = False
        self._wrap_labels: list = []
        self._half_wrap_labels: list = []
        self.title(f"{reviewer.ISSUE} Phase F operator adjudication -- {len(session.queue)} required rows")
        self.geometry("1200x840")
        self.minsize(900, 620)
        # Header and footer are packed BEFORE the expanding body so the body can never squeeze
        # the footer (Previous / Next / Save / Finalise) off-screen at any window size.
        self._build_header()
        self._build_footer()
        self._build_body()
        self.protocol("WM_DELETE_WINDOW", self._on_close)
        self.bind_all("<Alt-Left>", self._kb_prev)
        self.bind_all("<Alt-Right>", self._kb_next)
        self.bind_all("<Control-s>", self._kb_save)
        self.bind_all("<Prior>", lambda _e: self._canvas.yview_scroll(-1, "pages"))
        self.bind_all("<Next>", lambda _e: self._canvas.yview_scroll(1, "pages"))
        self._show_row()

    # -- construction ------------------------------------------------------------------
    def _build_header(self) -> None:
        header = tk.Frame(self, bd=1, relief="groove")
        header.pack(side="top", fill="x")
        tk.Label(header, text=f"{reviewer.ISSUE} Phase F -- operator adjudication of the required "
                              "recheck rows (nothing is preselected; opening a link never records anything)",
                 font=self.FONT_BOLD, anchor="w").pack(fill="x", padx=8, pady=(6, 0))
        self.progress_label = tk.Label(header, font=self.FONT_BASE, anchor="w", justify="left")
        self.progress_label.pack(fill="x", padx=8)
        self.class_label = tk.Label(header, font=self.FONT_BOLD, anchor="w", justify="left", fg="#1f4e79")
        self.class_label.pack(fill="x", padx=8)
        self._register_wrap(self.progress_label)
        self._register_wrap(self.class_label)

        filters = tk.Frame(header)
        filters.pack(fill="x", padx=8, pady=(2, 6))
        self.filter_vars: dict[str, tk.StringVar] = {}
        for name, label in (("completion", "Completion"), ("classification", "Classification"),
                            ("outcome", "Machine outcome"), ("deployment", "Deployment status")):
            tk.Label(filters, text=f"{label}:", font=self.FONT_BASE).pack(side="left", padx=(0, 2))
            var = tk.StringVar(value="all")
            combo = ttk.Combobox(filters, state="readonly", textvariable=var,
                                 values=list(FILTER_VALUES[name]), width=22)
            combo.pack(side="left", padx=(0, 10))
            combo.bind("<<ComboboxSelected>>", lambda _e, n=name: self._on_filter_changed(n))
            self.filter_vars[name] = var
        tk.Button(filters, text="Help", command=self._show_help).pack(side="right")

    def _build_body(self) -> None:
        container = tk.Frame(self)
        container.pack(side="top", fill="both", expand=True)
        self._canvas = tk.Canvas(container, highlightthickness=0)
        scrollbar = tk.Scrollbar(container, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=scrollbar.set)
        self._canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self._content = tk.Frame(self._canvas)
        self._content_window = self._canvas.create_window((0, 0), window=self._content, anchor="nw")
        self._content.bind("<Configure>",
                           lambda _e: self._canvas.configure(scrollregion=self._canvas.bbox("all")))
        self._canvas.bind("<Configure>", self._on_canvas_configure)
        self._canvas.bind("<Enter>", lambda _e: self._canvas.bind_all("<MouseWheel>", self._on_mousewheel))
        self._canvas.bind("<Leave>", lambda _e: self._canvas.unbind_all("<MouseWheel>"))

    def _build_footer(self) -> None:
        footer = tk.Frame(self, bd=1, relief="groove")
        footer.pack(side="bottom", fill="x")
        self.prev_button = tk.Button(footer, text="< Previous (Alt+Left)", width=22, command=self._go_prev)
        self.prev_button.pack(side="left", padx=8, pady=6)
        self.next_button = tk.Button(footer, text="Next > (Alt+Right)", width=22, command=self._go_next)
        self.next_button.pack(side="left", padx=(0, 8), pady=6)
        self.position_label = tk.Label(footer, font=self.FONT_BOLD)
        self.position_label.pack(side="left", padx=8)
        self.finalize_button = tk.Button(footer, text="Finalise...", width=14, command=self._finalize)
        self.finalize_button.pack(side="right", padx=8, pady=6)
        self.discard_button = tk.Button(footer, text="Discard unsaved changes", width=24, command=self._discard)
        self.discard_button.pack(side="right", padx=(0, 8), pady=6)
        self.save_button = tk.Button(footer, text="Save verdict for this row (Ctrl+S)", width=32,
                                     command=self._commit)
        self.save_button.pack(side="right", padx=(0, 8), pady=6)

    # -- layout helpers ----------------------------------------------------------------
    def _register_wrap(self, widget) -> None:
        self._wrap_labels.append(widget)

    def _wrap_width(self) -> int:
        try:
            return max(300, self._canvas.winfo_width() - 48)
        except Exception:  # pragma: no cover
            return 900

    def _on_canvas_configure(self, event) -> None:
        self._canvas.itemconfigure(self._content_window, width=event.width)
        width = max(300, event.width - 48)
        for widget in list(self._wrap_labels):
            try:
                widget.configure(wraplength=width)
            except tk.TclError:
                self._wrap_labels.remove(widget)
        half = max(200, (width - 120) // 2)
        for widget in list(self._half_wrap_labels):
            try:
                widget.configure(wraplength=half)
            except tk.TclError:
                self._half_wrap_labels.remove(widget)

    def _on_mousewheel(self, event) -> None:
        self._canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    def _section(self, title: str):
        frame = tk.LabelFrame(self._content, text=title, font=self.FONT_BOLD, padx=8, pady=6)
        frame.pack(fill="x", padx=8, pady=4)
        return frame

    def _label(self, parent, text: str, *, bold=False, mono=False, fg=None, title=False):
        font = self.FONT_TITLE if title else self.FONT_MONO if mono else self.FONT_BOLD if bold else self.FONT_BASE
        label = tk.Label(parent, text=text, anchor="w", justify="left", font=font,
                         wraplength=self._wrap_width(), fg=fg)
        label.pack(fill="x")
        self._register_wrap(label)
        return label

    # -- rendering the current row -----------------------------------------------------
    def _show_row(self) -> None:
        self._loading = True
        self._wrap_labels = [self.progress_label, self.class_label]
        self._half_wrap_labels = []
        for child in self._content.winfo_children():
            child.destroy()
        q = self.session.current()
        if q is None:
            self._label(self._content, "No rows match the current filters. Change a filter above.", bold=True)
        else:
            self._render_identity(q)
            self._render_reasons(q)
            self._render_outcome(q)
            self._render_comparison(q)
            self._render_links(q)
            self._render_verdict(q)
        self._loading = False
        if q is not None:
            self._refresh_status()
        self._refresh_chrome()
        self.update_idletasks()
        self._canvas.configure(scrollregion=self._canvas.bbox("all"))
        self._canvas.yview_moveto(0.0)

    def _render_identity(self, q: dict) -> None:
        s = identity_summary(q)
        f = self._section("1. Identity under review")
        self._label(f, f"DraftGuru person:  {s['draftguru_name']}", title=True)
        self._label(f, f"DraftGuru title: {_fmt(s['draftguru_title'])}")
        self._label(f, f"Proposed AFL Tables identity:  {_fmt(s['proposed_identity'])}", title=True, fg="#1f4e79")
        self._label(f, f"Retained name(s) at that identity: {_fmt(s['retained_names'])}"
                       if q["machine"].get("retained_target") is not None else
                       "Retained name(s) at that identity: none -- identity not registered on afldb_test")
        self._label(f, f"Sample index {q['sample_index']} of {self.session.inputs['total_sample_rows']}; "
                       f"queue position {q['position']} of {len(self.session.queue)}; "
                       f"classification: {q['classification'].upper()}", bold=True)

    def _render_reasons(self, q: dict) -> None:
        f = self._section("2. Why this row requires operator review")
        for line in review_reasons(q):
            self._label(f, "- " + line)

    def _render_outcome(self, q: dict) -> None:
        f = self._section("3. Machine identity outcome  vs  child deployment status (kept distinct)")
        self._label(f, f"MACHINE IDENTITY OUTCOME: {OUTCOME_LABELS.get(q['outcome'], q['outcome'])}", bold=True,
                    fg="#7a1f1f" if q["outcome"] == "offline_contradict" else None)
        self._label(f, f"identity_evaluable: {q['identity_evaluable']}")
        self._label(f, f"CHILD DEPLOYMENT STATUS: {q['deployment_status']}", bold=True)
        self._label(f, DEPLOYMENT_STATEMENT)
        self._label(f, "Reason codes:", bold=True)
        for line in reason_code_lines(q):
            code = line.split(" -- ")[0]
            self._label(f, "  " + line, fg="#7a1f1f" if code in CONTRADICTION_CODES else None)

    def _render_comparison(self, q: dict) -> None:
        f = self._section("4. Comparison evidence (DraftGuru vs retained AFL Tables-derived facts)")
        grid = tk.Frame(f)
        grid.pack(fill="x")
        grid.grid_columnconfigure(1, weight=1)
        grid.grid_columnconfigure(2, weight=1)
        for col, text in enumerate(("Fact", "DraftGuru", "Retained target (fitzRoy/AFLDB)")):
            tk.Label(grid, text=text, font=self.FONT_BOLD, anchor="w").grid(row=0, column=col, sticky="w", padx=4)
        for r, (fact, left, right) in enumerate(comparison_rows(q), start=1):
            tk.Label(grid, text=fact, font=self.FONT_BOLD, anchor="nw").grid(row=r, column=0, sticky="nw", padx=4, pady=2)
            for col, text in ((1, left), (2, right)):
                label = tk.Label(grid, text=text, anchor="nw", justify="left", font=self.FONT_BASE,
                                 wraplength=max(200, (self._wrap_width() - 120) // 2))
                label.grid(row=r, column=col, sticky="nw", padx=4, pady=2)
                self._half_wrap_labels.append(label)
        self._label(f, "DraftGuru Stage A rows (year event -- club; pick; age; games; goals):", bold=True)
        lines = stage_a_lines(q)
        for line in lines or ["(none captured)"]:
            self._label(f, "  " + line, mono=True)
        citations = retained_citations(q["machine"])
        if citations:
            self._label(f, "Retained citation(s) on this row:", bold=True)
            for name, value in citations:
                self._label(f, f"  {name}: {value}")
        else:
            self._label(f, "No retained Wikipedia/Footywire citation exists on this row (they are never "
                           "authority and were not read).")

    def _render_links(self, q: dict) -> None:
        f = self._section("5. Evidence links (Open = your own browser after host validation; Copy = clipboard; "
                          "neither records anything)")
        links = evidence_links_for(q)
        for label, url_key, err_key, hosts in (
                ("DraftGuru page", "draftguru_url", "draftguru_error", DRAFTGURU_ALLOWED_HOSTS),
                ("AFL Tables page", "afltables_url", "afltables_error", AFLTABLES_ALLOWED_HOSTS)):
            row = tk.Frame(f)
            row.pack(fill="x", pady=2)
            tk.Label(row, text=f"{label}:", font=self.FONT_BOLD, width=16, anchor="w").pack(side="left")
            url = links[url_key]
            entry = tk.Entry(row, font=self.FONT_MONO)
            entry.insert(0, url or f"(unavailable: {links[err_key]})")
            entry.configure(state="readonly")
            entry.pack(side="left", fill="x", expand=True, padx=(0, 6))
            tk.Button(row, text="Open", command=lambda u=url, h=hosts: self._open(u, h),
                      state="normal" if url else "disabled").pack(side="left", padx=2)
            tk.Button(row, text="Copy", command=lambda u=url: self._copy(u),
                      state="normal" if url else "disabled").pack(side="left", padx=2)
        self._label(f, f"AFL Tables URL is built from the canonical identity "
                       f"{_fmt(links['afltables_identity'])} under {AFLTABLES_BASE_URL}")
        self.link_status = self._label(f, "")

    def _render_verdict(self, q: dict) -> None:
        f = self._section("6. Your verdict for this row (nothing preselected; saved only by 'Save verdict')")
        self._label(f, verdict_guidance(q))
        self.verdict_var = tk.StringVar(value="")
        for value in VERDICT_VALUES:
            rb = tk.Radiobutton(f, text=VERDICT_LABELS[value], variable=self.verdict_var, value=value,
                                command=self._on_verdict_selected, anchor="w", justify="left",
                                font=self.FONT_BASE, wraplength=self._wrap_width() - 40)
            rb.pack(fill="x", pady=(4, 0))
            self._register_wrap(rb)
            self._label(f, f"      stored value: \"{value}\"", fg="#555555")
        self._label(f, "Notes (required for contradict / undetermined, and for every verdict on a "
                       "machine-contradiction row):", bold=True)
        self.notes_text = tk.Text(f, height=4, wrap="word", font=self.FONT_BASE)
        self.notes_text.pack(fill="x", pady=(0, 4))
        self.notes_text.bind("<FocusOut>", self._on_text_focus_out)
        self.notes_text.bind("<KeyRelease>", lambda _e: self._refresh_status())
        self._label(f, "Evidence (one item per line: which retained fact decided it, a URL you opened, "
                       "or a citation; required with the notes above):", bold=True)
        self.evidence_text = tk.Text(f, height=4, wrap="word", font=self.FONT_BASE)
        self.evidence_text.pack(fill="x", pady=(0, 4))
        self.evidence_text.bind("<FocusOut>", self._on_text_focus_out)
        self.evidence_text.bind("<KeyRelease>", lambda _e: self._refresh_status())
        for widget in (self.notes_text, self.evidence_text):
            widget.bind("<Alt-Left>", lambda _e: (self._go_prev(), "break")[1])
            widget.bind("<Alt-Right>", lambda _e: (self._go_next(), "break")[1])
        self.status_label = self._label(f, "", bold=True)
        buttons = tk.Frame(f)
        buttons.pack(fill="x", pady=(4, 0))
        tk.Button(buttons, text="Save verdict for this row (Ctrl+S)", command=self._commit).pack(side="left")
        tk.Button(buttons, text="Discard unsaved changes", command=self._discard).pack(side="left", padx=8)
        tk.Button(buttons, text="Clear saved verdict...", command=self._clear_decision).pack(side="left")
        # populate from the session draft (a stored draft is never a verdict)
        d = self.session.draft
        self.verdict_var.set(d.get("verdict") or "")
        self.notes_text.insert("1.0", d.get("notes") or "")
        self.evidence_text.insert("1.0", d.get("evidence_text") or "")
        self._refresh_status()

    def _refresh_chrome(self) -> None:
        s = self.session
        q = s.current()
        self.progress_label.configure(text=s.progress_text())
        if q is None:
            self.class_label.configure(text="")
        else:
            self.class_label.configure(
                text=f"{q['classification'].upper()} row -- classes: {', '.join(q['classes'])}")
        text = s.position_text()
        self.position_label.configure(text=text)
        self.prev_button.configure(state="normal" if s.can_go_prev() else "disabled")
        self.next_button.configure(state="normal" if s.can_go_next() else "disabled")
        self.finalize_button.configure(state="normal" if s.can_finalize() else "disabled")

    def _refresh_status(self) -> None:
        if self._loading or self.session.current() is None:
            return
        try:
            self._pull_fields_into_draft()
            text = self.session.status_text()
            self.status_label.configure(text=text, fg="#7a1f1f" if text.startswith("UNSAVED") else
                                        "#1f6f2f" if text.startswith("SAVED") else "#333333")
        except tk.TclError:  # pragma: no cover -- widgets mid-rebuild
            pass

    # -- field <-> draft -----------------------------------------------------------------
    def _pull_fields_into_draft(self) -> None:
        if self.session.current() is None:
            return
        self.session.set_draft(verdict=self.verdict_var.get() or None,
                               notes=self.notes_text.get("1.0", "end-1c"),
                               evidence_text=self.evidence_text.get("1.0", "end-1c"))

    def _on_verdict_selected(self) -> None:
        self._refresh_status()

    def _on_text_focus_out(self, event) -> None:
        if self._loading:
            return
        try:
            if not event.widget.winfo_exists():
                return
            self._pull_fields_into_draft()
            self.session.stash_draft()
            self._refresh_status()
        except tk.TclError:  # pragma: no cover
            pass

    # -- actions -------------------------------------------------------------------------
    def _resolve_unsaved(self) -> bool:
        """True when it is safe to leave the current row (saved, discarded or already clean)."""
        self._pull_fields_into_draft()
        if not self.session.is_dirty():
            return True
        answer = messagebox.askyesnocancel(
            "Unsaved changes on this row",
            "This row has an unsaved edit.\n\nYes = save it as this row's verdict now\n"
            "No = discard the unsaved edit\nCancel = stay on this row")
        if answer is None:
            return False
        if answer:
            problems = self.session.commit()
            if problems:
                messagebox.showerror("Cannot save this verdict", "\n".join(problems))
                return False
            return True
        self.session.discard()
        return True

    def _go_prev(self) -> None:
        if self._resolve_unsaved():
            self.session.go_prev()
            self._show_row()

    def _go_next(self) -> None:
        if self._resolve_unsaved():
            self.session.go_next()
            self._show_row()

    def _kb_prev(self, _event=None):
        self._go_prev()
        return "break"

    def _kb_next(self, _event=None):
        self._go_next()
        return "break"

    def _kb_save(self, _event=None):
        self._commit()
        return "break"

    def _on_filter_changed(self, name: str) -> None:
        value = self.filter_vars[name].get()
        if value == self.session.filters[name]:
            return
        if not self._resolve_unsaved():
            self.filter_vars[name].set(self.session.filters[name])
            return
        self.session.set_filter(name, value)
        self._show_row()

    def _commit(self) -> None:
        if self.session.current() is None:
            return
        self._pull_fields_into_draft()
        problems = self.session.commit()
        if problems:
            messagebox.showerror("Cannot save this verdict", "\n".join(problems))
        self._refresh_status()
        self._refresh_chrome()

    def _discard(self) -> None:
        if self.session.current() is None:
            return
        self.session.discard()
        self._show_row()

    def _clear_decision(self) -> None:
        q = self.session.current()
        if q is None or self.session.decision_for(q["player_url"]) is None:
            return
        if messagebox.askyesno("Clear saved verdict", "Remove this row's saved verdict? The row becomes "
                                                      "incomplete again; nothing else changes."):
            self.session.clear_decision()
            self._show_row()

    def _open(self, url: str | None, hosts: frozenset[str]) -> None:
        result = open_evidence_url(url, hosts)
        if result["ok"]:
            self.link_status.configure(text=f"Opened in your browser (no verdict changed): {url}")
        else:
            messagebox.showerror("Link refused", result["error"] or "the browser could not be launched")

    def _copy(self, url: str | None) -> None:
        if not url:
            return
        self.clipboard_clear()
        self.clipboard_append(url)
        self.link_status.configure(text=f"Copied to clipboard (no verdict changed): {url}")

    def _show_help(self) -> None:
        dialog = tk.Toplevel(self)
        dialog.title("How to use this tool")
        dialog.geometry("820x640")
        text = tk.Text(dialog, wrap="word", font=self.FONT_BASE)
        text.insert("1.0", HELP_TEXT)
        text.configure(state="disabled")
        text.pack(fill="both", expand=True, padx=8, pady=8)
        tk.Button(dialog, text="Close", command=dialog.destroy).pack(pady=(0, 8))

    def _finalize(self) -> None:
        if not self._resolve_unsaved():
            return
        blockers = self.session.finalize_blockers()
        if blockers:
            messagebox.showerror("Cannot finalise yet", f"{len(blockers)} required row(s) still need a valid "
                                                        "verdict, e.g.\n" + "\n".join(blockers[:6]))
            self._refresh_chrome()
            return
        preview = self.session.acceptance_preview()
        p = self.session.progress()
        lines = [f"All {p['total']} required rows carry a valid verdict: agree {p['by_verdict']['agree']}, "
                 f"contradict {p['by_verdict']['contradict']}, undetermined {p['by_verdict']['undetermined']}.",
                 ""]
        if preview["would_be_accepted"]:
            lines.append("Expected validator result: no blocker from these verdicts (the validator alone decides).")
        else:
            lines.append("Expected validator result: NOT ACCEPTED --")
            for key in ("contradict", "undetermined", "audit_not_agree", "machine_contradictions_unresolved"):
                if preview[key]:
                    lines.append(f"  {key}: {len(preview[key])} row(s)")
        lines += ["", f"Write {FINAL_REL} now? (never overwrites a differing file; imports nothing; "
                      "links nothing; accepts nothing)"]
        if not messagebox.askokcancel("Finalise the operator verdict artefact", "\n".join(lines)):
            return
        try:
            result = self.session.finalize()
        except ToolError as exc:
            messagebox.showerror("Finalisation refused", str(exc))
            return
        messagebox.showinfo("Operator verdict artefact written",
                            f"{result['path']}\nsha256 {result['sha256']} ({result['bytes']} bytes)"
                            + ("\n(an identical file already existed)" if result["already_identical"] else "")
                            + f"\n\nNext, from the repository root run:\n{NEXT_COMMAND}\n\n"
                              "This tool has not imported, linked, accepted or deployed anything.")
        self._refresh_chrome()

    def _on_close(self) -> None:
        if not self._resolve_unsaved():
            return
        try:
            self.session.stash_draft()
        finally:
            self.destroy()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def print_inputs_summary(inputs: dict) -> None:
    print(f"{reviewer.ISSUE} Phase F operator adjudication ({TOOL} {TOOL_VERSION})")
    for key in ("recheck", "verdicts_json", "verdicts_csv", "residual", "sample_json"):
        print(f"  {key}: {inputs['rel'][key]}  sha256 {inputs['sha256'][key]}")
    print(f"  rows_sha256: {inputs['rows_sha256']}  (n = {inputs['total_sample_rows']})")
    print(f"  queue: {len(inputs['queue'])} unique required rows = {inputs['mandatory']} mandatory "
          f"(classes 1-10) + {inputs['audit']} audit (class 11); audit salt {inputs['audit_salt']}")
    print(f"  queue_sha256: {inputs['queue_sha256']}")
    counts: dict[str, int] = {}
    for q in inputs["queue"]:
        counts[q["outcome"]] = counts.get(q["outcome"], 0) + 1
    print("  queue machine outcomes: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    print(f"  final artefact: {FINAL_REL}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=str(REPO_ROOT), help="repository root (tests point this at a fixture)")
    ap.add_argument("--checkpoint-dir", default=CHECKPOINT_DIR_REL,
                    help="repository-relative checkpoint directory (gitignored under data/review/)")
    ap.add_argument("--validate-only", action="store_true",
                    help="verify the machine artefacts and print the queue summary; no lock, no checkpoint, no GUI")
    ap.add_argument("--status", action="store_true",
                    help="print checkpoint progress read-only; no lock, no GUI")
    ap.add_argument("--force-unlock", action="store_true",
                    help="remove a stale review.lock (only when certain no other session is running)")
    args = ap.parse_args(argv)
    root = Path(args.root).resolve()

    try:
        inputs = load_inputs(root)
    except ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    print_inputs_summary(inputs)
    if args.validate_only:
        return 0

    paths = checkpoint_paths(root, args.checkpoint_dir)
    if args.status:
        try:
            checkpoint = load_checkpoint(paths["progress"])
            if checkpoint is None:
                print(f"  checkpoint: none yet at {args.checkpoint_dir}/progress.json")
                return 0
            validate_checkpoint_matches_inputs(checkpoint, inputs)
        except ToolError as exc:
            print(f"REFUSED: {exc}", file=sys.stderr)
            return 2
        session = ReviewSession(inputs, checkpoint, paths["progress"])
        print(f"  checkpoint: {args.checkpoint_dir}/progress.json (last saved {checkpoint.get('last_saved_utc')})")
        print(f"  {session.progress_text()}")
        print(f"  finalised: {checkpoint.get('finalized')} sha256 {checkpoint.get('final_sha256')}")
        blockers = session.finalize_blockers()
        print(f"  finalisation: {'ready' if not blockers else f'{len(blockers)} row(s) outstanding'}")
        return 0

    try:
        acquire_lock(paths["lock"], force=args.force_unlock)
    except ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    try:
        try:
            checkpoint = load_or_create_checkpoint(paths, inputs)
        except ToolError as exc:
            print(f"REFUSED: {exc}", file=sys.stderr)
            return 2
        if not TK_AVAILABLE:
            print("REFUSED: tkinter is not available in this Python environment; cannot open the GUI. "
                  "Run --validate-only or --status headless, or use a Python build with Tcl/Tk.",
                  file=sys.stderr)
            return 3
        session = ReviewSession(inputs, checkpoint, paths["progress"])
        print(f"  checkpoint: {args.checkpoint_dir}/progress.json -- {session.progress_text()}")
        app = OperatorApp(session)
        app.mainloop()
        print(f"  closed -- {session.progress_text()}")
    finally:
        release_lock(paths["lock"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
