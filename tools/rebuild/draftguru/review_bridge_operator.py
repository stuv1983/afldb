#!/usr/bin/env python3
"""AFLDB-ISSUE-222 Phase 3 -- local operator-adjudication helper (build task, 2026-09-18).

Loads the immutable operator adjudication pack

    docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.json

and lets the operator review and record a verdict for each of its 83 rows (44
relisting-signature, 2 tokenisation, 7 source-discrepancy, 30 audit) in a dependency-free
Tkinter GUI. The pack, the parent bridge, the afldb_test child, the immutable 997-row
sample and every population-scan artefact are read-only inputs: this tool NEVER opens any
of them for writing and NEVER modifies them. Verdicts are written to a separate,
hash-linked checkpoint and, on finalisation, to a new versioned output artefact.

This tool makes NO operator decisions of its own: it never preselects, defaults or
bulk-applies a verdict without an explicit, individually confirmed operator action, and it
never marks Phase 3 accepted, generates a bridge v2 dataset, generates a v2 validation
sample, or imports anything. It opens no socket, makes no network request and imports no
database module.

Each row also carries a derived, event-relative "event club appearance relationship"
(no_senior_appearance_ever / pre_event_only / post_event_appearance / unknown /
not_applicable) -- separate from, and never influencing, the identity verdict -- with an
operator acknowledgement required only where it could plausibly be misread as a
contradiction. See tools/rebuild/draftguru/README.md.

Launch (Windows PowerShell, the discovered repository interpreter -- see the tool's own
usage note if this exact path does not exist on your machine):

    C:\\Users\\stuar\\AppData\\Local\\Programs\\Python\\Python312\\python.exe tools\\rebuild\\draftguru\\review_bridge_operator.py

Validate the pack only, without opening the GUI (useful for a DB-free check):

    C:\\Users\\stuar\\AppData\\Local\\Programs\\Python\\Python312\\python.exe tools\\rebuild\\draftguru\\review_bridge_operator.py --validate-only

Load (and, if needed, migrate) the checkpoint and print a summary, without opening the GUI:

    C:\\Users\\stuar\\AppData\\Local\\Programs\\Python\\Python312\\python.exe tools\\rebuild\\draftguru\\review_bridge_operator.py --migrate-checkpoint-only

Independently validate the already-finalised verdict artefacts (canonical JSON, derived CSV/
Markdown) against the pinned, operator-reported hashes and the immutable source pack, without
opening the GUI, acquiring the review lock, touching the checkpoint, or writing/regenerating
any file:

    C:\\Users\\stuar\\AppData\\Local\\Programs\\Python\\Python312\\python.exe tools\\rebuild\\draftguru\\review_bridge_operator.py --validate-final-output
"""

from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import os
import platform
import re
import sys
import uuid
import webbrowser
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

try:  # pragma: no cover -- exercised implicitly whenever tkinter is present (Windows target)
    import tkinter as tk
    from tkinter import messagebox, ttk

    TK_AVAILABLE = True
except Exception:  # pragma: no cover -- headless / no Tcl-Tk environments
    tk = None  # type: ignore[assignment]
    ttk = None  # type: ignore[assignment]
    messagebox = None  # type: ignore[assignment]
    TK_AVAILABLE = False

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]

TOOL = "tools/rebuild/draftguru/review_bridge_operator.py"
TOOL_VERSION = "1.3.0"
SCHEMA_VERSION = 1
# Checkpoint (progress.json) schema. v1 -> v2 added the event-club non-appearance observation
# fields to every decision, additively (see migrate_checkpoint_v1_to_v2 below).
CHECKPOINT_SCHEMA_VERSION = 2
ISSUE = "AFLDB-ISSUE-222"
LABEL = "20260918-v1"

DEFAULT_PACK_PATH = (
    "docs/rebuild-manifests/draftguru/bridge-operator-adjudication-pack-20260918-v1.json"
)
FINAL_JSON_PATH = "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.json"
FINAL_CSV_PATH = "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.csv"
FINAL_MD_PATH = "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-20260918-v1.md"
CHECKPOINT_DIR_REL = "data/review/draftguru-bridge-operator-20260918-v1"

# Hash-linked inputs named in the pack's own hash_links block that do not carry a "path"
# key directly -- their file location is fixed and documented in
# AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md §1. Verified in addition to every hash_links
# entry that does carry both "path" and "sha256".
EXTRA_HASH_LINK_PATHS = {
    "retained_fitzroy_snapshot": {
        "manifest_sha256": "docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json",
    },
}

GROUP_ORDER = ("relisting", "tokenisation", "discrepancy", "audit")

SECTION_SPECS = {
    "relisting": {
        "pack_key": "section_1_relisting_signature_rows",
        "label": "Relisting-signature rows",
        "allowed_verdicts": (
            "same_person_valid_relisting",
            "different_person_wrong_href",
            "undetermined_withhold",
        ),
        "positive_verdict": "same_person_valid_relisting",
        "expected_count": 44,
    },
    "tokenisation": {
        "pack_key": "section_2_suspected_tokenisation_rows",
        "label": "Tokenisation rows",
        "allowed_verdicts": (
            "same_person_valid_href",
            "different_person_wrong_href",
            "undetermined_withhold",
        ),
        "positive_verdict": "same_person_valid_href",
        "expected_count": 2,
    },
    "discrepancy": {
        "pack_key": "section_3_source_discrepancies",
        "label": "Source-discrepancy rows",
        "allowed_verdicts": (
            "approve_manual_curation",
            "reject_candidate",
            "undetermined_withhold",
        ),
        "positive_verdict": "approve_manual_curation",
        "expected_count": 7,
    },
    "audit": {
        "pack_key": "section_4_thirty_row_audit",
        "label": "30-row audit",
        "allowed_verdicts": ("agree", "contradict", "undetermined"),
        "positive_verdict": "agree",
        "expected_count": 30,
    },
}

EXPECTED_TOTAL_ROWS = sum(spec["expected_count"] for spec in SECTION_SPECS.values())
assert EXPECTED_TOTAL_ROWS == 83

REQUIRES_NOTES = {
    "different_person_wrong_href",
    "undetermined_withhold",
    "reject_candidate",
    "contradict",
    "undetermined",
}

# Event-club appearance relationship (usability/data clarification, 2026-09-18 follow-up, and
# its 2026-09-18 same-day correction). A player may be drafted or listed by a club and never
# play a senior VFL/AFL game for that club; separately, a player may have already played senior
# games for a club, be delisted, and be re-drafted/relisted by that SAME club without ever
# playing another senior game after the new listing event. Neither pattern is "never played for
# the club" in the naive sense, neither is an identity contradiction, and neither is proof the
# DraftGuru href is wrong. This field is EVENT-RELATIVE -- it compares the specific event's own
# year against the player's retained senior career bounds for the event club, never just whether
# the club appears anywhere in career history -- and is a SEPARATE review observation from the
# identity verdict above. See derive_event_club_appearance_relationship /
# event_club_observation_required_for below and tools/rebuild/draftguru/README.md.
EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES = (
    "no_senior_appearance_ever",
    "pre_event_only",
    "post_event_appearance",
    "unknown",
    "not_applicable",
)

# The two relationships that could plausibly be misread as an identity contradiction if left
# unacknowledged on a same-person verdict; the other three (post_event_appearance -- the
# ordinary case of a player going on to play -- unknown and not_applicable) need no operator
# acknowledgement.
EVENT_CLUB_APPEARANCE_ACK_REQUIRED_VALUES = {"no_senior_appearance_ever", "pre_event_only"}

# Known SAME-organization club renames only (see src/lib/player-matching/club-identity.ts for
# the database-backed equivalent this offline, DB-free tool cannot use). A genuine merger is
# deliberately never aliased here: Fitzroy's 1996 merger into the Brisbane Lions is a different
# organization_id in AFLDB's own data model, so an event club of "Fitzroy" against retained
# clubs of only "Brisbane Lions" is correctly left as a derived non-appearance, not silently
# folded away.
CLUB_RENAME_ALIASES = {
    "kangaroos": "north melbourne",
    "south melbourne": "sydney",
    "footscray": "western bulldogs",
}

# Ordered (raw_field, display_label) pairs per group -- what the GUI shows for the current
# row's evidence panel. A field absent on a given row is skipped, never shown as blank.
GROUP_FIELD_SPECS = {
    "relisting": [
        ("draftguru_name", "DraftGuru name"),
        ("draftguru_url", "DraftGuru URL"),
        ("captured_afltables_href", "Captured AFL Tables href"),
        ("retained_target_name", "Retained target name"),
        ("event_year", "Event year"),
        ("event_kind", "Event kind"),
        ("event_club", "Event club"),
        ("event_pick", "Event pick"),
        ("draftguru_per_entry_games", "DraftGuru per-entry games (this listing only)"),
        ("stage_a_listed_age", "Stage A listed age"),
        ("stage_a_implied_birth_year", "Stage A implied birth year"),
        ("retained_birth_year", "Retained birth year"),
        ("retained_career_start", "Retained career start"),
        ("retained_career_end", "Retained career end"),
        ("retained_career_games", "Retained career games"),
        ("retained_career_goals", "Retained career goals"),
        ("retained_clubs", "Retained clubs"),
        ("age_birth_evidence_agrees", "Age/birth evidence agrees"),
        ("sample_status", "Sample status"),
    ],
    "tokenisation": [
        ("draftguru_name", "DraftGuru name"),
        ("draftguru_url", "DraftGuru URL"),
        ("captured_afltables_href", "Captured AFL Tables href"),
        ("retained_target_name", "Retained target name"),
        ("draftguru_birth_year", "DraftGuru birth year"),
        ("retained_birth_year", "Retained birth year"),
        ("draftguru_games", "DraftGuru games"),
        ("retained_career_games", "Retained career games"),
        ("retained_career_span", "Retained career span"),
        ("retained_clubs", "Retained clubs"),
        ("reason_codes", "Reason codes"),
    ],
    "discrepancy": [
        ("draftguru_name", "DraftGuru name"),
        ("draftguru_url", "DraftGuru URL"),
        ("captured_href", "Captured href (unregistered)"),
        ("corrected_identity_candidate", "Corrected identity candidate"),
        ("corrected_identity_name", "Corrected identity name"),
        ("draftguru_birth_year", "DraftGuru birth year"),
        ("corrected_identity_birth_year", "Corrected identity birth year"),
        ("draftguru_games", "DraftGuru games"),
        ("corrected_identity_career_games", "Corrected identity career games"),
        ("corrected_identity_clubs", "Corrected identity clubs"),
    ],
    "audit": [
        ("draftguru_name", "DraftGuru name"),
        ("draftguru_url", "DraftGuru URL"),
        ("captured_href", "Captured href"),
        ("stratum", "Sample stratum"),
        ("sample_index", "Sample index"),
        ("event_kind", "Event kind"),
        ("event_year", "Event year"),
        ("draftguru_birth_year", "DraftGuru birth year"),
        ("retained_birth_year", "Retained birth year"),
        ("retained_career_span", "Retained career span"),
        ("retained_career_games", "Retained career games"),
        ("reason_codes", "Reason codes"),
    ],
}

# Partition of each group's GROUP_FIELD_SPECS fields into "A. Source evidence" (DraftGuru-side)
# and "B. Retained target evidence" (AFL Tables/AFLDB-side), for the usability-correction
# evidence-panel reorder (2026-09-18). A field in GROUP_FIELD_SPECS that appears in neither set
# is shown under "Supporting comparison evidence" instead -- see _render_current_row.
SOURCE_EVIDENCE_FIELDS = {
    "relisting": frozenset({
        "draftguru_name", "event_year", "event_kind", "event_club", "event_pick",
        "draftguru_per_entry_games", "stage_a_listed_age", "stage_a_implied_birth_year",
    }),
    "tokenisation": frozenset({"draftguru_name", "draftguru_birth_year", "draftguru_games"}),
    "discrepancy": frozenset({"draftguru_name", "draftguru_birth_year", "draftguru_games"}),
    "audit": frozenset({"draftguru_name", "draftguru_birth_year", "event_kind", "event_year"}),
}
TARGET_EVIDENCE_FIELDS = {
    "relisting": frozenset({
        "retained_target_name", "retained_birth_year", "retained_career_start",
        "retained_career_end", "retained_career_games", "retained_career_goals", "retained_clubs",
    }),
    "tokenisation": frozenset({
        "retained_target_name", "retained_birth_year", "retained_career_games",
        "retained_career_span", "retained_clubs",
    }),
    "discrepancy": frozenset({
        "corrected_identity_name", "corrected_identity_birth_year",
        "corrected_identity_career_games", "corrected_identity_clubs", "corrected_identity_candidate",
    }),
    "audit": frozenset({"retained_birth_year", "retained_career_span", "retained_career_games"}),
}

# The field carrying a machine-generated interpretation/rationale -- always shown clearly
# labelled as NOT an operator decision. None where the pack carries no such field.
RECOMMENDATION_FIELD = {
    "relisting": "recommended_evidence_interpretation",
    "tokenisation": "normalisation_note",
    "discrepancy": "why_not_auto_applicable",
    "audit": None,
}

# Only the relisting group's rows carry the v1 "was this formerly flagged as a mislink, or
# formerly clean" history.
FORMERLY_FIELD = {"relisting": "is_original_23_or_companion_21"}
FORMERLY_LABELS = {
    "original_23": "Formerly flagged: v1 confirmed_source_mislink (label WITHDRAWN by the 2026-09-18 review)",
    "companion_21": "Formerly clean: v1 population_clean (identical shape to the withdrawn flagged rows)",
}

# The verdict control's initial, non-storable placeholder entry. Never a valid verdict value
# for any group (checked below) and never written to a checkpoint or output artefact.
PLACEHOLDER_VERDICT = "Choose a verdict..."
assert all(
    PLACEHOLDER_VERDICT not in spec["allowed_verdicts"] for spec in SECTION_SPECS.values()
)

# The event-club-appearance-relationship control's initial, non-storable placeholder entry -- a
# separate sentinel from PLACEHOLDER_VERDICT so the two controls never share a string.
PLACEHOLDER_RELATIONSHIP = "Choose a relationship..."
assert PLACEHOLDER_RELATIONSHIP not in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES

# Human-readable meanings shown in the Help dialog, matching tools/rebuild/draftguru/README.md.
VERDICT_MEANINGS = {
    "relisting": {
        "same_person_valid_relisting": "The retained evidence describes the same player being listed/drafted again.",
        "different_person_wrong_href": "DraftGuru's captured AFL Tables link identifies a different person.",
        "undetermined_withhold": "Evidence is insufficient; keep the row withheld.",
    },
    "tokenisation": {
        "same_person_valid_href": "Accent, spacing, apostrophe or compound-name handling explains the apparent difference, and retained facts identify the same person.",
        "different_person_wrong_href": "The href identifies another person.",
        "undetermined_withhold": "Evidence is insufficient.",
    },
    "discrepancy": {
        "approve_manual_curation": "Evidence supports the same person, but the href form cannot be automatically corrected under the current contract.",
        "reject_candidate": "The proposed corrected identity is not supported.",
        "undetermined_withhold": "Evidence remains insufficient.",
    },
    "audit": {
        "agree": "Source and retained target evidence describe the same person.",
        "contradict": "Evidence indicates different people.",
        "undetermined": "Evidence is insufficient.",
    },
}

# ---------------------------------------------------------------------------
# Plain-English labels (usability correction, 2026-09-18). Shown in the GUI in place of the raw
# machine-code values; the stored codes themselves never change and remain the ONLY thing ever
# written to the checkpoint or the final verdict artefact -- see the *_CODE_BY_LABEL reverse
# maps below, which the GUI uses to translate a friendly-label selection back to its stored
# code before writing anything.
# ---------------------------------------------------------------------------

VERDICT_FRIENDLY_LABELS = {
    "relisting": {
        "same_person_valid_relisting": "Same player — valid re-draft or re-listing",
        "different_person_wrong_href": "Different player — captured AFL Tables link is wrong",
        "undetermined_withhold": "Unable to determine — withhold this link",
    },
    "tokenisation": {
        "same_person_valid_href": "Same player — spelling or formatting difference only",
        "different_person_wrong_href": "Different player — captured AFL Tables link is wrong",
        "undetermined_withhold": "Unable to determine — withhold this link",
    },
    "discrepancy": {
        "approve_manual_curation": "Same player — approve the corrected identity",
        "reject_candidate": "Different player — reject the corrected identity",
        "undetermined_withhold": "Unable to determine — withhold this link",
    },
    "audit": {
        "agree": "Same player — evidence agrees",
        "contradict": "Different player — evidence contradicts",
        "undetermined": "Unable to determine",
    },
}
assert set(VERDICT_FRIENDLY_LABELS) == set(SECTION_SPECS)
assert all(
    set(VERDICT_FRIENDLY_LABELS[g]) == set(spec["allowed_verdicts"])
    for g, spec in SECTION_SPECS.items()
)

VERDICT_CODE_BY_LABEL = {
    group: {label: code for code, label in labels.items()}
    for group, labels in VERDICT_FRIENDLY_LABELS.items()
}
assert all(
    len(VERDICT_CODE_BY_LABEL[g]) == len(VERDICT_FRIENDLY_LABELS[g]) for g in VERDICT_FRIENDLY_LABELS
)

EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS = {
    "no_senior_appearance_ever": "Never played a senior game for this club",
    "pre_event_only": "Played for this club before this event, but not afterward",
    "post_event_appearance": "Played for this club after this event",
    "unknown": "Unable to determine from the retained evidence",
    "not_applicable": "Not applicable to this row",
}
assert set(EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS) == set(EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES)

EVENT_CLUB_OBSERVATION_CODE_BY_LABEL = {
    label: code for code, label in EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS.items()
}
assert len(EVENT_CLUB_OBSERVATION_CODE_BY_LABEL) == len(EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS)


def confirmed_observation_sentence(relationship: str, event_club: str | None,
                                    event_year: object) -> str:
    """The primary, plain-English confirmation sentence shown once an observation is recorded
    -- as opposed to event_club_appearance_message, which explains the DERIVED suggestion
    before confirmation. Falls back to the plain friendly label when no event club/year is
    known (tokenisation/discrepancy rows, whose observation is always not_applicable)."""
    if event_club and event_year is not None:
        if relationship == "no_senior_appearance_ever":
            return f"Never played a senior game for {event_club}."
        if relationship == "pre_event_only":
            return f"Played for {event_club} before this {event_year} event, but not afterward."
        if relationship == "post_event_appearance":
            return f"Played for {event_club} after this {event_year} event."
    return EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS.get(relationship, relationship)


CSV_FIELDS = [
    "global_order", "group", "row_ordinal_in_group", "draftguru_url", "draftguru_name",
    "retained_or_corrected_name", "machine_classification",
    "event_club", "retained_played_clubs", "event_club_appearance_relationship_derived",
    "event_club_observation",
    "operator_verdict", "operator_notes", "decided_utc",
]


class ToolError(Exception):
    """A refusal: bad input, hash mismatch, schema violation, invalid verdict. Always fails
    closed -- never guesses, never proceeds on partial/ambiguous evidence."""


# ---------------------------------------------------------------------------
# Evidence links -- DraftGuru / AFL Tables Open and Copy buttons (usability correction,
# 2026-09-18). Pure URL construction and scheme/host validation; NEVER performs a network
# request, fetch or scrape. Opening a page only ever launches the operator's own default
# browser via Python's standard webbrowser module, and only in direct response to an explicit
# operator click on a specific row's button -- never automatically, never during startup
# validation, and never during a test (tests always inject a mock opener).
# ---------------------------------------------------------------------------

AFLTABLES_BASE_URL = "https://afltables.com/afl/stats/"
AFLTABLES_ALLOWED_HOSTS = frozenset({"afltables.com", "www.afltables.com"})
DRAFTGURU_ALLOWED_HOSTS = frozenset({"draftguru.com.au", "www.draftguru.com.au"})

# Which raw pack field carries the captured, site-relative AFL Tables href for each group --
# the relisting/tokenisation sections use "captured_afltables_href", the discrepancy/audit
# sections "captured_href" (see GROUP_FIELD_SPECS above, which already documents this split).
HREF_FIELD_BY_GROUP = {
    "relisting": "captured_afltables_href",
    "tokenisation": "captured_afltables_href",
    "discrepancy": "captured_href",
    "audit": "captured_href",
}


def validate_evidence_url(url: str, allowed_hosts: frozenset[str]) -> None:
    """Refuses (ToolError) anything but an http(s) URL on an expected host. Pure validation --
    never opens the URL, never makes a network request; safe to call from a test."""
    if not url or not isinstance(url, str):
        raise ToolError("missing or empty evidence URL")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise ToolError(f"refusing to open a URL with scheme {parts.scheme!r}: {url!r}")
    host = (parts.hostname or "").lower()
    if host not in allowed_hosts:
        raise ToolError(f"refusing to open a URL with unexpected host {host!r}: {url!r}")
    if not parts.netloc or not parts.path:
        raise ToolError(f"malformed evidence URL: {url!r}")


def build_afltables_url(href: str) -> str:
    """Builds the full AFL Tables player URL from the pack's captured href, e.g. the
    site-relative 'players/A/Andrew_Krakouer0.html' every row in the real adjudication pack
    carries -> 'https://afltables.com/afl/stats/players/A/Andrew_Krakouer0.html'. An
    already-absolute afltables.com URL is also accepted unchanged (validated, not
    reconstructed). Pure string construction -- never a network request. Raises ToolError on a
    missing, empty or unexpected-host href instead of guessing."""
    href = (href or "").strip()
    if not href:
        raise ToolError("missing AFL Tables href")
    if href.lower().startswith(("http://", "https://")):
        url = href
    else:
        url = urljoin(AFLTABLES_BASE_URL, href.lstrip("/"))
    validate_evidence_url(url, AFLTABLES_ALLOWED_HOSTS)
    return url


def captured_afltables_href_for(row: dict) -> str | None:
    field = HREF_FIELD_BY_GROUP.get(row["group"])
    if not field:
        return None
    return row["raw"].get(field)


def evidence_links_for(row: dict) -> dict:
    """The two evidence links for a row, ready for display/Open/Copy. Never raises -- any
    construction/validation failure is captured as a '*_error' string instead, so the GUI can
    show a clear refusal dialog rather than crash. Pure computation; opens nothing, fetches
    nothing."""
    result: dict = {
        "draftguru_url": None, "draftguru_error": None,
        "afltables_url": None, "afltables_error": None,
        "afltables_href": captured_afltables_href_for(row),
    }
    draftguru_url = row["raw"].get("draftguru_url")
    if draftguru_url:
        try:
            validate_evidence_url(draftguru_url, DRAFTGURU_ALLOWED_HOSTS)
            result["draftguru_url"] = draftguru_url
        except ToolError as exc:
            result["draftguru_error"] = str(exc)
    else:
        result["draftguru_error"] = "missing or empty evidence URL"

    href = result["afltables_href"]
    if href:
        try:
            result["afltables_url"] = build_afltables_url(href)
        except ToolError as exc:
            result["afltables_error"] = str(exc)
    else:
        result["afltables_error"] = "missing AFL Tables href"
    return result


def open_evidence_url(url: str | None, allowed_hosts: frozenset[str], *, opener=None) -> dict:
    """Validates scheme/host, then launches the operator's own default browser via Python's
    standard webbrowser module, for human evidence review only. NEVER performs its own network
    fetch, request or scrape, and NEVER records, changes or influences any verdict or
    acknowledgement -- the caller alone owns checkpoint state, and this function never touches
    it. A validation failure or a browser-launch failure is returned as
    {'ok': False, 'error': ...} rather than raised, so a failed launch can never crash the
    review session or leave a row half-decided. `opener` defaults to webbrowser.open and exists
    purely so a test can inject a mock in its place -- it is invoked only in direct response to
    this explicit call, never speculatively."""
    if opener is None:
        opener = webbrowser.open
    try:
        validate_evidence_url(url or "", allowed_hosts)
    except ToolError as exc:
        return {"ok": False, "url": url, "error": str(exc)}
    try:
        opened = opener(url)
    except Exception as exc:  # pragma: no cover -- platform-dependent browser failures
        return {"ok": False, "url": url, "error": str(exc)}
    return {"ok": opened is not False, "url": url, "error": None}


# ---------------------------------------------------------------------------
# Small helpers (same conventions as review_person_bridge_offline.py)
# ---------------------------------------------------------------------------

def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.tmp-{os.getpid()}-{uuid.uuid4().hex[:8]}"
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def dump_json_lf(payload: object) -> bytes:
    text = json.dumps(payload, ensure_ascii=True, sort_keys=True, indent=2)
    return (text + "\n").replace("\r\n", "\n").encode("utf-8")


def canonical_json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=True, sort_keys=True,
                       separators=(",", ":")).encode("utf-8")


def repo_relative(path: Path, repo_root: Path = REPO_ROOT) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


# ---------------------------------------------------------------------------
# Pack loading and validation -- read-only; never opens the pack for writing
# ---------------------------------------------------------------------------

def _verify_one_hash_link(repo_root: Path, rel_path: str, expected_sha256: str,
                           label: str) -> dict:
    full = repo_root / rel_path
    if not full.is_file():
        raise ToolError(f"missing hash-linked input for {label}: {rel_path}")
    actual = sha256_file(full)
    if actual != expected_sha256:
        raise ToolError(
            f"hash mismatch for {label} ({rel_path}): expected {expected_sha256}, "
            f"got {actual} -- refusing to start"
        )
    return {"label": label, "path": rel_path, "sha256": actual}


def verify_hash_links(raw: dict, repo_root: Path) -> list[dict]:
    """Verify every hash_links entry that names a checkable (path, sha256) pair, plus the
    extra fixed paths in EXTRA_HASH_LINK_PATHS. Entries carrying only a path with no hash
    (e.g. draftguru_snapshot) or only an aggregate hash with no single backing file (e.g.
    artefact_set_sha256 over the off-tree fitzRoy bytes tree) are not independently
    file-verifiable here and are skipped, never treated as a pass."""
    hash_links = raw.get("hash_links")
    if not isinstance(hash_links, dict) or not hash_links:
        raise ToolError("pack is missing a non-empty hash_links block")
    results: list[dict] = []
    for key in sorted(hash_links):
        entry = hash_links[key]
        if not isinstance(entry, dict):
            continue
        path = entry.get("path")
        sha = entry.get("sha256")
        if path and sha:
            results.append(_verify_one_hash_link(repo_root, path, sha, key))
        for hash_field, extra_path in EXTRA_HASH_LINK_PATHS.get(key, {}).items():
            expected = entry.get(hash_field)
            if expected:
                results.append(
                    _verify_one_hash_link(repo_root, extra_path, expected, f"{key}.{hash_field}")
                )
    if not results:
        raise ToolError("no hash-linked input could be independently verified")
    return results


def normalise_rows(raw: dict) -> list[dict]:
    rows: list[dict] = []
    global_order = 0
    for group in GROUP_ORDER:
        spec = SECTION_SPECS[group]
        section = raw.get(spec["pack_key"])
        if not isinstance(section, dict):
            raise ToolError(f"pack is missing section {spec['pack_key']!r}")

        declared_verdicts = section.get("allowed_operator_verdicts")
        if not isinstance(declared_verdicts, list) or set(declared_verdicts) != set(spec["allowed_verdicts"]):
            raise ToolError(
                f"section {spec['pack_key']!r} allowed_operator_verdicts {declared_verdicts!r} "
                f"does not match the expected set {spec['allowed_verdicts']!r}"
            )

        section_rows = section.get("rows")
        if not isinstance(section_rows, list):
            raise ToolError(f"section {spec['pack_key']!r} is missing rows[]")

        declared_count = section.get("count")
        if declared_count != len(section_rows):
            raise ToolError(
                f"section {spec['pack_key']!r} declares count={declared_count!r} but rows[] "
                f"has {len(section_rows)} entries"
            )
        if declared_count != spec["expected_count"]:
            raise ToolError(
                f"section {spec['pack_key']!r} has {declared_count} rows, expected "
                f"{spec['expected_count']}"
            )

        for i, raw_row in enumerate(section_rows, start=1):
            if not isinstance(raw_row, dict):
                raise ToolError(f"section {spec['pack_key']!r} row {i} is not an object")
            url = raw_row.get("draftguru_url")
            if not url:
                raise ToolError(f"section {spec['pack_key']!r} row {i} has no draftguru_url")
            verdict = raw_row.get("operator_verdict")
            if verdict not in ("", None):
                raise ToolError(
                    f"row {url!r} in {spec['pack_key']!r} already carries a non-blank "
                    f"operator_verdict {verdict!r} -- refusing to start"
                )
            global_order += 1
            rows.append({
                "group": group,
                "group_label": spec["label"],
                "row_ordinal_in_group": i,
                "pack_ordinal": raw_row.get("ordinal"),
                "global_order": global_order,
                "draftguru_url": url,
                "row_id": f"{group}:{url}",
                "raw": raw_row,
            })
    return rows


def load_and_validate_pack(pack_path: Path, repo_root: Path = REPO_ROOT) -> dict:
    """Read-only validation. Never opens pack_path for writing. Raises ToolError with a
    clear message on any mismatch instead of starting the GUI."""
    if not pack_path.is_file():
        raise ToolError(f"adjudication pack not found: {pack_path}")

    pack_bytes = pack_path.read_bytes()
    pack_sha256 = sha256_bytes(pack_bytes)
    try:
        raw = json.loads(pack_bytes.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ToolError(f"adjudication pack is not valid JSON: {exc}") from exc

    if raw.get("schema_version") != 1:
        raise ToolError(f"unexpected pack schema_version {raw.get('schema_version')!r}")

    hash_checks = verify_hash_links(raw, repo_root)
    rows = normalise_rows(raw)

    if len(rows) != EXPECTED_TOTAL_ROWS:
        raise ToolError(f"expected {EXPECTED_TOTAL_ROWS} rows across all sections, found {len(rows)}")

    row_ids = [r["row_id"] for r in rows]
    if len(set(row_ids)) != len(row_ids):
        counts = Counter(row_ids)
        dupes = sorted(k for k, n in counts.items() if n > 1)
        raise ToolError(f"duplicate immutable row identity: {dupes}")

    section1_ordinals = [r["pack_ordinal"] for r in rows if r["group"] == "relisting"]
    if sorted(section1_ordinals) != list(range(1, 45)):
        raise ToolError("section_1_relisting_signature_rows ordinal values are not exactly 1..44, unique")

    return {
        "pack_path": pack_path,
        "pack_sha256": pack_sha256,
        "raw": raw,
        "hash_checks": hash_checks,
        "rows": rows,
        "rows_by_id": {r["row_id"]: r for r in rows},
    }


def assert_pack_unchanged(pack_path: Path, expected_sha256: str) -> None:
    """Defence in depth: confirm the source pack file is still byte-identical to what was
    validated at startup. Never called in a way that opens the file for writing."""
    if not pack_path.is_file():
        raise ToolError(f"adjudication pack disappeared: {pack_path}")
    actual = sha256_file(pack_path)
    if actual != expected_sha256:
        raise ToolError(
            f"adjudication pack changed on disk since it was loaded (expected "
            f"{expected_sha256}, now {actual}) -- refusing to continue"
        )


# ---------------------------------------------------------------------------
# Checkpoint (progress.json) -- gitignored under data/review/
# ---------------------------------------------------------------------------

def checkpoint_paths(repo_root: Path = REPO_ROOT) -> dict:
    d = repo_root / CHECKPOINT_DIR_REL
    return {"dir": d, "progress": d / "progress.json", "lock": d / "review.lock"}


def new_checkpoint(pack_info: dict, operator_display_name: str, repo_root: Path = REPO_ROOT) -> dict:
    now = utc_now()
    return {
        "schema_version": CHECKPOINT_SCHEMA_VERSION,
        "tool": {"path": TOOL, "version": TOOL_VERSION},
        "source_pack_path": repo_relative(pack_info["pack_path"], repo_root),
        "source_pack_sha256": pack_info["pack_sha256"],
        "operator_display_name": operator_display_name or "",
        "review_started_utc": now,
        "last_saved_utc": now,
        "finalized": False,
        "finalized_utc": None,
        "decisions": {},
        "bulk_actions_log": [],
        "migrations": [],
    }


def load_checkpoint(path: Path) -> dict | None:
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_checkpoint(path: Path, checkpoint: dict) -> dict:
    checkpoint = dict(checkpoint)
    checkpoint["last_saved_utc"] = utc_now()
    atomic_write_bytes(path, dump_json_lf(checkpoint))
    return checkpoint


def validate_checkpoint_matches_pack(checkpoint: dict, pack_info: dict) -> None:
    if checkpoint.get("source_pack_sha256") != pack_info["pack_sha256"]:
        raise ToolError(
            "the checkpoint at this path belongs to a different source pack "
            f"(checkpoint sha256 {checkpoint.get('source_pack_sha256')!r}, current pack sha256 "
            f"{pack_info['pack_sha256']!r}) -- refusing to resume"
        )
    known_ids = set(pack_info["rows_by_id"])
    stale = [rid for rid in checkpoint.get("decisions", {}) if rid not in known_ids]
    if stale:
        raise ToolError(f"checkpoint carries decisions for unknown rows: {sorted(stale)[:5]}")


# ---------------------------------------------------------------------------
# Checkpoint schema migration -- additive only. A migration NEVER clears, resets or
# reinterprets an existing decision's operator_verdict/operator_notes/decided_utc; it only adds
# new, initially-blank fields. The source-pack/checkpoint hash check above (
# validate_checkpoint_matches_pack) always runs first, so a migration is refused outright if the
# checkpoint does not belong to the current pack.
# ---------------------------------------------------------------------------

def utc_now_compact() -> str:
    """Filesystem-safe timestamp (no colons) for backup filenames."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def backup_checkpoint_before_migration(path: Path) -> Path:
    """Writes a byte-verified copy of the pre-migration checkpoint next to it, before any
    migration touches the original file. A fresh, unique suffix every call -- never overwrites
    a previous backup."""
    if not path.is_file():
        raise ToolError(f"cannot back up a missing checkpoint before migration: {path}")
    original = path.read_bytes()
    backup_path = (
        path.parent / f"{path.stem}.pre-migration-{utc_now_compact()}-{uuid.uuid4().hex[:8]}.json"
    )
    atomic_write_bytes(backup_path, original)
    if backup_path.read_bytes() != original:
        raise ToolError(
            f"checkpoint backup verification failed at {backup_path} -- refusing to migrate"
        )
    return backup_path


def migrate_checkpoint_v1_to_v2(checkpoint: dict) -> dict:
    """Additive only: every existing decision's group / row_ordinal_in_group / global_order /
    draftguru_url / operator_verdict / operator_notes / decided_utc is preserved exactly. This
    only adds the new, initially-blank event_club_observation fields where a decision does not
    already carry them."""
    migrated = copy.deepcopy(checkpoint)
    for decision in migrated.get("decisions", {}).values():
        decision.setdefault("event_club_observation", "")
        decision.setdefault("event_club_observation_notes", "")
        decision.setdefault("event_club_observation_decided_utc", None)
    migrated["schema_version"] = CHECKPOINT_SCHEMA_VERSION
    migrations = migrated.setdefault("migrations", [])
    migrations.append({
        "from_schema_version": 1,
        "to_schema_version": CHECKPOINT_SCHEMA_VERSION,
        "migrated_utc": utc_now(),
        "tool_version": TOOL_VERSION,
        "note": (
            "additive: added blank event_club_observation / event_club_observation_notes / "
            "event_club_observation_decided_utc to every existing decision; no verdict, notes "
            "or decided_utc changed, cleared or reset"
        ),
    })
    return migrated


def load_or_migrate_checkpoint(paths: dict, pack_info: dict) -> dict:
    """Loads the checkpoint if present (refusing on a source-pack hash mismatch exactly as
    validate_checkpoint_matches_pack always has), migrates it forward to the current schema
    version when needed -- backing up the pre-migration file first and verifying the backup
    byte-for-byte -- and returns the current-schema checkpoint. Creates and saves a fresh
    current-schema checkpoint if none exists yet. Refuses outright, rather than guessing, on an
    unrecognised schema_version."""
    checkpoint = load_checkpoint(paths["progress"])
    if checkpoint is None:
        return save_checkpoint(paths["progress"], new_checkpoint(pack_info, "", REPO_ROOT))

    validate_checkpoint_matches_pack(checkpoint, pack_info)

    schema = checkpoint.get("schema_version")
    if schema == CHECKPOINT_SCHEMA_VERSION:
        return checkpoint
    if schema == 1:
        backup_path = backup_checkpoint_before_migration(paths["progress"])
        migrated = migrate_checkpoint_v1_to_v2(checkpoint)
        migrated = save_checkpoint(paths["progress"], migrated)
        print(
            f"Checkpoint migrated: schema_version 1 -> {CHECKPOINT_SCHEMA_VERSION}. "
            f"Pre-migration backup: {repo_relative(backup_path)}",
            file=sys.stderr,
        )
        return migrated
    raise ToolError(
        f"checkpoint schema_version {schema!r} is not recognised by this tool version "
        f"({TOOL_VERSION}) -- refusing to guess a migration"
    )


# ---------------------------------------------------------------------------
# Lock file -- prevents two sessions running concurrently against one checkpoint
# ---------------------------------------------------------------------------

def acquire_lock(lock_path: Path, force: bool = False) -> dict:
    if lock_path.is_file():
        try:
            existing = json.loads(lock_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = {}
        if not force:
            raise ToolError(
                "a review lock already exists at "
                f"{lock_path} (pid={existing.get('pid')}, host={existing.get('hostname')}, "
                f"started={existing.get('started_utc')}). If you are certain no other review "
                "session is running, rerun with --force-unlock to remove it."
            )
        print(
            f"WARNING: removing existing lock (pid={existing.get('pid')}, "
            f"host={existing.get('hostname')}, started={existing.get('started_utc')}) "
            "because --force-unlock was given",
            file=sys.stderr,
        )
    payload = {
        "pid": os.getpid(),
        "hostname": platform.node(),
        "started_utc": utc_now(),
        "session_id": uuid.uuid4().hex,
    }
    atomic_write_bytes(lock_path, dump_json_lf(payload))
    return payload


def release_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink()
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# Decision validation
# ---------------------------------------------------------------------------

def validate_decision(group: str, verdict: str, notes: str) -> None:
    spec = SECTION_SPECS[group]
    if verdict not in spec["allowed_verdicts"]:
        raise ToolError(f"{verdict!r} is not an allowed verdict for group {group!r}")
    if verdict in REQUIRES_NOTES and not (notes or "").strip():
        raise ToolError(f"verdict {verdict!r} requires operator notes")


def has_valid_verdict(row: dict, checkpoint: dict) -> bool:
    """True once a row carries a valid, correctly-noted identity verdict -- regardless of
    whether a club-observation acknowledgement is also required. Used to decide whether bulk
    action may touch a row: bulk action must never re-write a row that already has a real
    verdict recorded, even if that row is not yet 'decided' in the fuller is_row_decided sense
    (e.g. still missing its club-observation acknowledgement) -- otherwise it would silently
    wipe that row's existing notes."""
    d = checkpoint.get("decisions", {}).get(row["row_id"])
    if not d:
        return False
    verdict = d.get("operator_verdict")
    if not verdict:
        return False
    try:
        validate_decision(row["group"], verdict, d.get("operator_notes", ""))
    except ToolError:
        return False
    return True


def is_row_decided(row: dict, checkpoint: dict) -> bool:
    """A row counts as decided only once its identity verdict is valid AND -- for a
    same-person verdict on a row whose derived event-club appearance relationship needs
    acknowledgement (EVENT_CLUB_APPEARANCE_ACK_REQUIRED_VALUES) -- the operator has also
    recorded a valid event_club_observation acknowledgement. That second requirement is 'where
    applicable' only: most rows never carry it."""
    d = checkpoint.get("decisions", {}).get(row["row_id"])
    if not d:
        return False
    verdict = d.get("operator_verdict")
    if not verdict:
        return False
    try:
        validate_decision(row["group"], verdict, d.get("operator_notes", ""))
    except ToolError:
        return False
    if event_club_observation_required_for(row, verdict):
        observation = d.get("event_club_observation")
        if observation not in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
            return False
        derived = derive_event_club_appearance_relationship(row["raw"])
        try:
            validate_event_club_observation(observation, derived, d.get("event_club_observation_notes", ""))
        except ToolError:
            return False
    return True


def decided_count(pack_info: dict, checkpoint: dict) -> int:
    return sum(1 for row in pack_info["rows"] if is_row_decided(row, checkpoint))


def verdict_totals(pack_info: dict, checkpoint: dict) -> Counter:
    totals: Counter = Counter()
    for row_id in pack_info["rows_by_id"]:
        d = checkpoint.get("decisions", {}).get(row_id)
        if d and d.get("operator_verdict"):
            totals[d["operator_verdict"]] += 1
    return totals


# ---------------------------------------------------------------------------
# Machine classification (preserved separately from the operator verdict)
# ---------------------------------------------------------------------------

def machine_classification_for(row: dict) -> str | None:
    raw = row["raw"]
    group = row["group"]
    if group == "relisting":
        return raw.get("machine_classification")
    if group == "tokenisation":
        return raw.get("population_reason")
    if group == "discrepancy":
        return "source_discrepancy_manual_curation_candidate"
    if group == "audit":
        return "offline_strong_audit_row"
    return None


def retained_or_corrected_name(raw: dict) -> str | None:
    return raw.get("retained_target_name") or raw.get("corrected_identity_name")


def recommendation_text(row: dict) -> str | None:
    field = RECOMMENDATION_FIELD.get(row["group"])
    if not field:
        return None
    return row["raw"].get(field)


def formerly_text(row: dict) -> str | None:
    field = FORMERLY_FIELD.get(row["group"])
    if not field:
        return None
    raw_value = row["raw"].get(field)
    return FORMERLY_LABELS.get(raw_value, raw_value)


# ---------------------------------------------------------------------------
# Event-club appearance relationship -- read-only, EVENT-RELATIVE derivation from the row's own
# captured fields. NEVER reads a database or the network, NEVER guesses past what the row
# itself carries, and NEVER changes or preselects the identity verdict. See
# EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES above.
#
# The comparison year is the row's own captured event_year, taken exactly as recorded -- this
# deliberately does NOT apply a "draft_year + 1" (or any other) destination-season inference.
# That specific heuristic is already an explicitly forbidden mechanism one layer up, in this
# same DraftGuru contract's club_resolution.forbidden_mechanisms
# (tools/rebuild/draftguru/draftguru-contract.json), for the same reason it is avoided here: it
# is an invented rule with no tracked source, and this tool fails closed to 'unknown' rather
# than guess a boundary the data does not state.
# ---------------------------------------------------------------------------

def canonical_club_key(name: str) -> str:
    """Case/whitespace-normalised club-name comparison key, with CLUB_RENAME_ALIASES folded
    in. Deliberately not lineage/database-aware beyond that fixed alias table."""
    key = " ".join(str(name).strip().lower().split())
    return CLUB_RENAME_ALIASES.get(key, key)


def derive_event_club_appearance_relationship(raw: dict) -> str:
    """One of EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES, derived only from fields already
    present on this row (never a network or database read, never a per-club season breakdown
    the pack does not carry):

    - no captured event club, or no captured event year -> 'not_applicable' (no meaningful
      event-relative club comparison exists for this row, e.g. tokenisation, discrepancy);
    - an event club and event year are captured, but no retained/corrected played-for clubs, or
      no retained whole-career start/end, exist to compare against -> 'unknown';
    - the event club does not match any retained/corrected played-for club (after
      canonical_club_key normalisation) -> 'no_senior_appearance_ever' (never played for that
      club at all, at any time);
    - the event club DOES match, and the whole retained career ended at or before the event
      year -> 'pre_event_only' (every appearance, for this club or any other, happened at or
      before the event; consistent with this tool's own relisting-signature section, whose
      entire membership already satisfies this bound);
    - the event club DOES match, and the whole retained career started strictly after the
      event year -> 'post_event_appearance' (every appearance happened after the event);
    - otherwise (the event year falls within the whole career span, i.e. the career started at
      or before it and ended after it) -> 'unknown'. The pack carries only whole-career start/
      end years, never a per-club season breakdown, so whether THIS club's specific appearances
      landed before, after, or on both sides of the event cannot be localised from this data --
      this is deliberately left 'unknown' rather than guessed either way.
    """
    event_club = raw.get("event_club")
    event_year = raw.get("event_year")
    if not event_club or event_year is None:
        return "not_applicable"

    retained_clubs = raw.get("retained_clubs") or raw.get("corrected_identity_clubs")
    career_start = raw.get("retained_career_start")
    career_end = raw.get("retained_career_end")
    if not retained_clubs or career_start is None or career_end is None:
        return "unknown"

    event_key = canonical_club_key(event_club)
    retained_keys = {canonical_club_key(club) for club in retained_clubs}
    if event_key not in retained_keys:
        return "no_senior_appearance_ever"

    if career_end <= event_year:
        return "pre_event_only"
    if career_start > event_year:
        return "post_event_appearance"
    return "unknown"


def event_club_appearance_message(raw: dict, relationship: str | None = None) -> str | None:
    """The prominent, human-readable explanation for a non-not_applicable relationship;
    None for 'not_applicable' (nothing meaningful to show)."""
    if relationship is None:
        relationship = derive_event_club_appearance_relationship(raw)
    event_club = raw.get("event_club")
    event_year = raw.get("event_year")
    if relationship == "no_senior_appearance_ever":
        return f"Never played a senior game for {event_club}."
    if relationship == "pre_event_only":
        return (
            f"Played for {event_club} before this {event_year} listing, but made no senior "
            f"appearance for {event_club} after it."
        )
    if relationship == "post_event_appearance":
        return f"Played for {event_club} after this {event_year} listing event."
    if relationship == "unknown":
        return (
            f"Retained evidence cannot establish whether the {event_club} appearance occurred "
            f"before or after this {event_year} listing event."
        )
    return None  # not_applicable


def event_club_observation_required_for(row: dict, verdict: str) -> bool:
    """True only for a same-person verdict (the row's group's positive_verdict) on a row whose
    derived relationship is one of EVENT_CLUB_APPEARANCE_ACK_REQUIRED_VALUES. Independent of,
    and never influences, the identity verdict itself -- this only gates whether an
    event_club_observation acknowledgement is required for the row to count as decided. A
    relisted player correctly deriving 'pre_event_only' can still correctly receive
    'same_person_valid_relisting'; the acknowledgement never changes that verdict."""
    if not verdict:
        return False
    spec = SECTION_SPECS[row["group"]]
    if verdict != spec["positive_verdict"]:
        return False
    relationship = derive_event_club_appearance_relationship(row["raw"])
    return relationship in EVENT_CLUB_APPEARANCE_ACK_REQUIRED_VALUES


def validate_event_club_observation(value: str, derived: str, notes: str) -> None:
    if value not in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
        raise ToolError(f"{value!r} is not a valid event_club_observation value")
    if value != derived and not (notes or "").strip():
        raise ToolError(
            "event_club_observation notes are required when the operator's observation "
            "differs from the derived suggestion"
        )


# ---------------------------------------------------------------------------
# Separate progress counters (usability correction, 2026-09-18). "N / 83 decided" conflated an
# identity verdict being entered with a row being FULLY complete (identity verdict plus any
# required club-observation acknowledgement), which made 11 identity verdicts read as "1 / 83
# decided". These three counters are now always shown and computed together, from the same
# checkpoint state as decided_count/is_row_decided above -- never a separately maintained
# number that could drift out of sync.
# ---------------------------------------------------------------------------

def identity_verdict_entered_count(pack_info: dict, checkpoint: dict) -> int:
    """Rows carrying a valid, correctly-noted identity verdict, regardless of whether a
    club-observation acknowledgement is also required/outstanding for that row."""
    return sum(1 for row in pack_info["rows"] if has_valid_verdict(row, checkpoint))


def club_acknowledgement_required_count(pack_info: dict, checkpoint: dict) -> int:
    """Rows whose currently recorded verdict requires a club-observation acknowledgement
    (event_club_observation_required_for) that is not yet validly recorded."""
    count = 0
    for row in pack_info["rows"]:
        d = checkpoint.get("decisions", {}).get(row["row_id"], {})
        verdict = d.get("operator_verdict", "")
        if not event_club_observation_required_for(row, verdict):
            continue
        observation = d.get("event_club_observation")
        if observation not in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
            count += 1
            continue
        derived = derive_event_club_appearance_relationship(row["raw"])
        try:
            validate_event_club_observation(observation, derived, d.get("event_club_observation_notes", ""))
        except ToolError:
            count += 1
    return count


# ---------------------------------------------------------------------------
# Confirmed-vs-pending state and navigation (GUI usability defect fix, 2026-09-18). A real
# operator session found that an in-progress, never-successfully-saved club-observation edit
# could be visually indistinguishable from a genuinely persisted one, and that Previous/Next
# gave no feedback at the ends of the filtered list. These are pure functions of plain values
# (never a Tkinter widget, never a checkpoint mutation) so they are fully testable headlessly;
# the GUI class below wires them to actual widget state and button enabling.
# ---------------------------------------------------------------------------

def club_observation_pending_state(persisted_code: str, persisted_notes: str,
                                    pending_code: str, pending_notes: str, derived: str) -> dict:
    """Compares the checkpoint's last-persisted club-observation value against the combo/notes
    widgets' CURRENT (possibly unsaved, possibly invalid) selection. Never mutates anything and
    never itself decides whether the row is "confirmed" -- the confirmed-status line must be
    driven ONLY by (persisted_code, persisted_notes), never by this function's output. This
    function exists solely to answer "is there an edit sitting in the controls that has not
    been successfully saved, and would it currently be accepted if the operator clicked Save".

    Returns {"has_pending": bool, "is_valid": bool, "error": str | None}. has_pending is False
    whenever pending_code is blank (nothing selected) or the pending selection+notes are
    byte-for-byte identical to what is already persisted -- reselecting your own already-saved
    choice is not a pending edit. is_valid mirrors validate_event_club_observation exactly, so
    the GUI's Save button and this function can never disagree about what would be accepted."""
    if not pending_code:
        return {"has_pending": False, "is_valid": True, "error": None}
    if pending_code == persisted_code and pending_notes == persisted_notes:
        return {"has_pending": False, "is_valid": True, "error": None}
    try:
        validate_event_club_observation(pending_code, derived, pending_notes)
        return {"has_pending": True, "is_valid": True, "error": None}
    except ToolError as exc:
        return {"has_pending": True, "is_valid": False, "error": str(exc)}


CANNOT_LEAVE_INVALID_MESSAGE = (
    "Cannot leave this row until the invalid unsaved change is corrected or discarded."
)
CANNOT_LEAVE_UNSAVED_MESSAGE = (
    "You have an unsaved club-relationship selection. Click 'Save observation' or 'Discard "
    "unsaved changes' before leaving this row."
)


def can_leave_row(pending_state: dict) -> tuple[bool, str | None]:
    """Whether navigation/close may proceed given club_observation_pending_state's output, and
    the exact message to show if not. Never mutates anything and never silently saves or
    discards a pending edit on the caller's behalf -- the operator must act explicitly."""
    if not pending_state["has_pending"]:
        return True, None
    if not pending_state["is_valid"]:
        return False, CANNOT_LEAVE_INVALID_MESSAGE
    return False, CANNOT_LEAVE_UNSAVED_MESSAGE


def nav_button_states(filtered_indices: list, cursor: int) -> dict:
    """Pure logic behind Previous/Next enabling and the nearby status message. Raises ToolError
    if cursor is not among filtered_indices (a caller bug, never a normal runtime state)."""
    if cursor not in filtered_indices:
        raise ToolError("cursor is not among the currently filtered rows")
    pos = filtered_indices.index(cursor)
    is_first = pos == 0
    is_last = pos == len(filtered_indices) - 1
    if is_first and is_last:
        status = "Only one row matches the current filters."
    elif is_first:
        status = "Already at the first displayed row."
    elif is_last:
        status = "Already at the last displayed row."
    else:
        status = ""
    return {"prev_enabled": not is_first, "next_enabled": not is_last, "status": status}


def next_cursor(filtered_indices: list, cursor: int, direction: int) -> int:
    """direction=+1 for Next, -1 for Previous, following the CURRENTLY DISPLAYED filtered-row
    order exactly (never the unfiltered pack order). Returns cursor unchanged (never wraps,
    never raises) if already at that end -- the same defence-in-depth guard the GUI's disabled
    button state is meant to make unreachable in practice."""
    pos = filtered_indices.index(cursor)
    new_pos = pos + direction
    if 0 <= new_pos < len(filtered_indices):
        return filtered_indices[new_pos]
    return cursor


# ---------------------------------------------------------------------------
# Layout/wording helpers (screen-size usability fix, 2026-09-18). Pure functions so the actual
# wording and the wrap-width arithmetic are testable without a display.
# ---------------------------------------------------------------------------

def compute_wraplength(available_width: int, *, min_width: int = 220, margin: int = 24) -> int:
    """The pixel wraplength to apply to a responsive Label given the current canvas/window
    width, so text wraps within the visible area instead of forcing horizontal scrolling.
    Never below min_width (a collapsed/zero-width Configure event during startup must not
    produce an unusable near-zero wraplength)."""
    return max(min_width, available_width - margin)


def saved_acknowledgement_text(sentence: str) -> str:
    """The status line for a club-observation value that is genuinely, currently persisted in
    the checkpoint. Never used for a live, unsaved combo/notes selection -- see
    unsaved_change_text for that, which is deliberately a different, unmistakable label."""
    return f"Saved acknowledgement: {sentence}"


def unsaved_change_text(label: str, is_valid: bool, error: str | None) -> str:
    """The status line for whatever is CURRENTLY selected in 'Choose a different relationship'
    but not yet successfully saved. Never labelled or coloured as confirmed/saved -- this
    wording is deliberately distinct from saved_acknowledgement_text's so the two can never be
    mistaken for one another, whether the pending value would currently be accepted (is_valid)
    or refused."""
    if is_valid:
        return f"Unsaved change — not recorded: {label} (click Save observation to persist it)."
    return f"Unsaved change — not recorded: {label} — {error}"


# ---------------------------------------------------------------------------
# Finalisation -- builds the canonical JSON, then deterministically derives CSV/Markdown
# ---------------------------------------------------------------------------

def build_final_document(pack_info: dict, checkpoint: dict, repo_root: Path = REPO_ROOT) -> dict:
    rows = pack_info["rows"]
    decisions = checkpoint.get("decisions", {})

    missing = [r["row_id"] for r in rows if r["row_id"] not in decisions]
    if missing:
        raise ToolError(
            f"{len(missing)} of {EXPECTED_TOTAL_ROWS} rows have no operator decision yet "
            f"(first few: {missing[:5]})"
        )

    out_rows = []
    by_group: Counter = Counter()
    by_verdict: Counter = Counter()
    by_derived_observation: Counter = Counter()
    by_operator_observation: Counter = Counter()
    seen_ids: set[str] = set()

    for r in rows:
        row_id = r["row_id"]
        if row_id in seen_ids:
            raise ToolError(f"internal error: duplicate row identity at finalisation: {row_id}")
        seen_ids.add(row_id)

        d = decisions[row_id]
        verdict = d.get("operator_verdict", "")
        notes = d.get("operator_notes", "") or ""
        validate_decision(r["group"], verdict, notes)

        derived_relationship = derive_event_club_appearance_relationship(r["raw"])
        relationship_message = event_club_appearance_message(r["raw"], derived_relationship)
        club_observation = d.get("event_club_observation") or ""
        club_observation_notes = d.get("event_club_observation_notes") or ""
        if event_club_observation_required_for(r, verdict):
            if club_observation not in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
                raise ToolError(
                    f"row {row_id!r} carries a same-person verdict ({verdict!r}) on a row whose "
                    f"derived event-club appearance relationship is {derived_relationship!r}, "
                    "but no operator event_club_observation acknowledgement is recorded"
                )
            validate_event_club_observation(club_observation, derived_relationship, club_observation_notes)
        elif club_observation:
            validate_event_club_observation(club_observation, derived_relationship, club_observation_notes)

        by_group[r["group"]] += 1
        by_verdict[verdict] += 1
        by_derived_observation[derived_relationship] += 1
        if club_observation:
            by_operator_observation[club_observation] += 1

        out_rows.append({
            "global_order": r["global_order"],
            "group": r["group"],
            "group_label": r["group_label"],
            "row_ordinal_in_group": r["row_ordinal_in_group"],
            "pack_ordinal": r["pack_ordinal"],
            "draftguru_url": r["draftguru_url"],
            "machine_classification": machine_classification_for(r),
            "evidence": r["raw"],
            "operator_verdict": verdict,
            "operator_notes": notes,
            "decided_utc": d.get("decided_utc"),
            "event_club": r["raw"].get("event_club"),
            "retained_played_clubs": (
                r["raw"].get("retained_clubs") or r["raw"].get("corrected_identity_clubs")
            ),
            "event_club_appearance_relationship_derived": derived_relationship,
            "event_club_appearance_relationship_message": relationship_message,
            "event_club_observation": club_observation or None,
            "event_club_observation_notes": club_observation_notes or None,
            "event_club_observation_decided_utc": d.get("event_club_observation_decided_utc"),
        })

    if len(out_rows) != EXPECTED_TOTAL_ROWS or sum(by_group.values()) != EXPECTED_TOTAL_ROWS:
        raise ToolError(
            f"internal error: totals do not sum to {EXPECTED_TOTAL_ROWS} "
            f"(got {sum(by_group.values())})"
        )
    for group, spec in SECTION_SPECS.items():
        if by_group.get(group, 0) != spec["expected_count"]:
            raise ToolError(
                f"internal error: group {group!r} has {by_group.get(group, 0)} decisions, "
                f"expected {spec['expected_count']}"
            )

    rows_sha256 = sha256_bytes(canonical_json_bytes(out_rows))

    doc = {
        "schema_version": SCHEMA_VERSION,
        "issue": ISSUE,
        "label": LABEL,
        "tool": {"path": TOOL, "version": TOOL_VERSION},
        "source_adjudication_pack": {
            "path": repo_relative(pack_info["pack_path"], repo_root),
            "sha256": pack_info["pack_sha256"],
        },
        "source_hash_links": pack_info["hash_checks"],
        "operator_display_name": checkpoint.get("operator_display_name", ""),
        "review_started_utc": checkpoint.get("review_started_utc"),
        "review_completed_utc": utc_now(),
        "rows": out_rows,
        "totals": {
            "by_group": dict(by_group),
            "by_verdict": dict(by_verdict),
            "by_event_club_appearance_relationship_derived": dict(by_derived_observation),
            "by_event_club_observation": dict(by_operator_observation),
            "overall": sum(by_group.values()),
        },
        "event_club_observation_methodology": (
            "event_club_appearance_relationship_derived is derived at review time, EVENT-"
            "RELATIVE: each row's own captured draft/listing event club and event year (taken "
            "exactly as recorded -- no destination-season inference) are compared against the "
            "player's retained whole-career start/end years and retained senior-playing clubs "
            "(case/whitespace-normalised, with a small set of same-organization club-rename "
            "aliases; a merger -- e.g. Fitzroy into the Brisbane Lions -- is never aliased). It "
            "is NOT a manually maintained database fact, and it never changes or preselects the "
            "identity verdict above it -- a relisted player correctly deriving 'pre_event_only' "
            "can still correctly receive a same-person verdict. event_club_observation is the "
            "operator's own confirmation or question of that derived value, recorded "
            "independently; it is required only for a same-person verdict on a row whose "
            "derivation is 'no_senior_appearance_ever' or 'pre_event_only'. Once draft/listing "
            "links are imported, AFLDB should derive this event-relative relationship at query "
            "time from draft_picks versus recorded senior appearances and seasons -- not store "
            "it as a redundant Boolean column."
        ),
        "completion_status": "complete",
        "rows_sha256": rows_sha256,
    }
    return doc


def render_csv(doc: dict) -> bytes:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(CSV_FIELDS)
    for row in doc["rows"]:
        evidence = row.get("evidence") or {}
        retained_played_clubs = row.get("retained_played_clubs") or []
        writer.writerow([
            row.get("global_order", ""),
            row.get("group", ""),
            row.get("row_ordinal_in_group", ""),
            row.get("draftguru_url", ""),
            evidence.get("draftguru_name", ""),
            retained_or_corrected_name(evidence) or "",
            row.get("machine_classification") or "",
            row.get("event_club") or "",
            "; ".join(retained_played_clubs),
            row.get("event_club_appearance_relationship_derived") or "",
            row.get("event_club_observation") or "",
            row.get("operator_verdict", ""),
            (row.get("operator_notes") or "").replace("\r\n", " ").replace("\n", " "),
            row.get("decided_utc") or "",
        ])
    data = buf.getvalue().encode("utf-8")
    return data.replace(b"\r\n", b"\n")


def render_markdown(doc: dict) -> bytes:
    lines: list[str] = []
    lines.append(f"# {doc['issue']} -- operator verdicts ({doc['label']})")
    lines.append("")
    lines.append(
        f"Source pack: `{doc['source_adjudication_pack']['path']}` "
        f"sha256 `{doc['source_adjudication_pack']['sha256']}`"
    )
    lines.append("")
    lines.append(f"Operator: {doc['operator_display_name'] or '(not recorded)'}")
    lines.append(
        f"Review started: {doc['review_started_utc']}  Review completed: "
        f"{doc['review_completed_utc']}"
    )
    lines.append(f"Completion status: **{doc['completion_status']}** ({doc['totals']['overall']}/83)")
    lines.append("")
    lines.append("## Totals by group")
    lines.append("")
    lines.append("| Group | Rows |")
    lines.append("|---|---:|")
    for group in GROUP_ORDER:
        lines.append(f"| {group} | {doc['totals']['by_group'].get(group, 0)} |")
    lines.append("")
    lines.append("## Totals by verdict")
    lines.append("")
    lines.append("| Verdict | Rows |")
    lines.append("|---|---:|")
    for verdict in sorted(doc["totals"]["by_verdict"]):
        lines.append(f"| {verdict} | {doc['totals']['by_verdict'][verdict]} |")
    lines.append("")
    lines.append("## Totals by derived event-club appearance relationship")
    lines.append("")
    lines.append("| Derived relationship | Rows |")
    lines.append("|---|---:|")
    for key in sorted(doc["totals"]["by_event_club_appearance_relationship_derived"]):
        lines.append(
            f"| {key} | {doc['totals']['by_event_club_appearance_relationship_derived'][key]} |"
        )
    lines.append("")
    lines.append("## Totals by operator event-club observation")
    lines.append("")
    lines.append("| Operator observation | Rows |")
    lines.append("|---|---:|")
    for key in sorted(doc["totals"]["by_event_club_observation"]):
        lines.append(f"| {key} | {doc['totals']['by_event_club_observation'][key]} |")
    lines.append("")
    lines.append(f"> {doc['event_club_observation_methodology']}")
    lines.append("")
    lines.append("## Rows (source-pack order)")
    lines.append("")
    lines.append(
        "| # | Group | DraftGuru URL | Machine classification | Event club | Club observation "
        "| Verdict | Notes |"
    )
    lines.append("|---:|---|---|---|---|---|---|---|")
    for row in doc["rows"]:
        notes = (row.get("operator_notes") or "").replace("|", "\\|").replace("\n", " ")
        club_observation_cell = row.get("event_club_observation") or row.get(
            "event_club_appearance_relationship_derived"
        ) or ""
        lines.append(
            f"| {row['global_order']} | {row['group']} | `{row['draftguru_url']}` | "
            f"{row.get('machine_classification') or ''} | {row.get('event_club') or ''} | "
            f"{club_observation_cell} | {row['operator_verdict']} | {notes} |"
        )
    lines.append("")
    text = "\n".join(lines) + "\n"
    return text.replace("\r\n", "\n").encode("utf-8")


def output_paths(repo_root: Path = REPO_ROOT) -> dict:
    return {
        "json": repo_root / FINAL_JSON_PATH,
        "csv": repo_root / FINAL_CSV_PATH,
        "md": repo_root / FINAL_MD_PATH,
    }


def finalize(pack_path: Path, checkpoint: dict, repo_root: Path = REPO_ROOT) -> dict:
    """Re-validates everything from scratch (pack hashes, row/group counts, verdict
    validity, required notes) before writing. Writes JSON, then deterministically re-derives
    CSV/Markdown from that same in-memory document and verifies the re-render is
    byte-identical before returning."""
    pack_info = load_and_validate_pack(pack_path, repo_root)
    validate_checkpoint_matches_pack(checkpoint, pack_info)

    doc = build_final_document(pack_info, checkpoint, repo_root)

    paths = output_paths(repo_root)
    json_bytes = dump_json_lf(doc)
    csv_bytes = render_csv(doc)
    md_bytes = render_markdown(doc)

    if render_csv(doc) != csv_bytes or render_markdown(doc) != md_bytes:
        raise ToolError("non-deterministic CSV/Markdown render detected -- refusing to write")

    atomic_write_bytes(paths["json"], json_bytes)
    atomic_write_bytes(paths["csv"], csv_bytes)
    atomic_write_bytes(paths["md"], md_bytes)

    assert_pack_unchanged(pack_path, pack_info["pack_sha256"])

    updated_checkpoint = dict(checkpoint)
    updated_checkpoint["finalized"] = True
    updated_checkpoint["finalized_utc"] = utc_now()

    return {
        "doc": doc,
        "checkpoint": updated_checkpoint,
        "json_sha256": sha256_bytes(json_bytes),
        "csv_sha256": sha256_bytes(csv_bytes),
        "md_sha256": sha256_bytes(md_bytes),
        "paths": paths,
    }


# ---------------------------------------------------------------------------
# Final-output validation ( --validate-final-output ) -- AFLDB-ISSUE-222 Phase 3 independent
# validation, 2026-09-18. Strictly read-only: never acquires the GUI review lock, never opens
# Tkinter, never touches the checkpoint, and never writes, regenerates or repairs the canonical
# JSON, CSV or Markdown -- it re-derives the CSV/Markdown views in memory ONLY to compare them
# byte-for-byte against the existing files on disk. Never reassesses or overrides an operator
# verdict or acknowledgement; it validates contract consistency only.
# ---------------------------------------------------------------------------

# Pinned, operator-reported hashes/sizes for the ISSUE-222 Phase 3 completed artefact set
# (2026-09-18). validate_final_output() refuses outright if the actual, freshly computed
# hash/size of any of these four files does not match its pinned value here, rather than
# silently trusting whatever bytes happen to be on disk. Update these constants only when a
# newly reviewed and operator-confirmed artefact set genuinely supersedes this one -- never to
# make a failing validation pass.
EXPECTED_SOURCE_PACK_SHA256 = "02d0cbe995b4482cf249fe216a10da18b325de6dfcb0504df2d3dbcba31ae292"
EXPECTED_FINAL_JSON_SHA256 = "b2ae2f4022cd3c22e91bfe6e399538949c02fe8cada95b5c355e6516c82a8822"
EXPECTED_FINAL_CSV_SHA256 = "a74c6f185030cba3d58bd54b755eae14db3a006ad45ade19ec0f5bd8eaf17267"
EXPECTED_FINAL_MD_SHA256 = "60c529df55313099f85b52af977512fa4fed8f5076fb7ce7263d04e2c05732c0"
EXPECTED_FINAL_JSON_SIZE = 169720
EXPECTED_FINAL_CSV_SIZE = 18367
EXPECTED_FINAL_MD_SIZE = 16430

NEGATIVE_VERDICT_CODES = frozenset({
    "different_person_wrong_href", "reject_candidate", "contradict",
})
UNCERTAIN_VERDICT_CODES = frozenset({
    "undetermined_withhold", "undetermined",
})

_EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_ABSOLUTE_PATH_PATTERN = re.compile(r"[A-Za-z]:[\\/]|\\\\[A-Za-z0-9_.-]+\\|/home/|/Users/")
_CREDENTIAL_KEYWORDS = (
    "password", "passwd", "secret", "api_key", "apikey", "access_token",
    "private_key", "credential",
)

# URL-aware local-path detection (correction, 2026-09-18 -- a real operator run found
# _ABSOLUTE_PATH_PATTERN false-positiving on ordinary "https://..." evidence-citation URLs in
# operator_notes: the single letter+colon+slash immediately before "//" in "https://" itself
# matches the Windows-drive-letter branch of that same regex, e.g. the "s:/" inside
# "http**s:/**/afltables.com/..."). _strip_valid_web_urls removes every well-formed http(s)
# URL (valid hostname, via urllib.parse -- never by treating every slash as a path separator)
# from the text BEFORE _ABSOLUTE_PATH_PATTERN ever sees it, so a genuine evidence-citation URL
# can never itself be misread as a local path. It deliberately does NOT disable path detection
# for the note as a whole: whatever text remains after a valid URL is stripped out (surrounding
# prose, a second local path elsewhere in the same note, or a malformed/host-less "URL" that
# was never actually stripped) is still fully scanned.
_URL_CANDIDATE_PATTERN = re.compile(r"https?://\S+", re.IGNORECASE)
_URL_TRAILING_PUNCTUATION = ".,;:!?)]}'\">"
_HOSTNAME_PATTERN = re.compile(
    r"^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)


def _is_valid_web_url(candidate: str) -> bool:
    """True only for a well-formed http(s) URL carrying a syntactically valid DNS-style
    hostname, via urllib.parse.urlsplit -- never by treating every slash as a path separator.
    A literal backslash anywhere in the candidate is refused outright (a real URL never
    contains one; this is what stops a Windows path from being smuggled into a bogus URL's
    netloc/path, e.g. 'https://C:\\Users\\name\\file.txt', whose lenient .hostname would
    otherwise still parse as a truthy 'c'). A 'file:' scheme, any other non-http(s) scheme, a
    missing/malformed hostname, or an invalid port is never considered a valid web URL here."""
    if "\\" in candidate:
        return False
    try:
        parts = urlsplit(candidate)
    except ValueError:
        return False
    if parts.scheme.lower() not in ("http", "https"):
        return False
    hostname = parts.hostname
    if not hostname or not _HOSTNAME_PATTERN.match(hostname):
        return False
    try:
        parts.port
    except ValueError:
        return False
    return True


def _strip_valid_web_urls(text: str) -> str:
    """Replaces every well-formed http(s) URL (see _is_valid_web_url) with spaces of the same
    length, so it can never trigger the local-path scan and so removing one URL never
    accidentally joins the surrounding prose into a new false match. Trailing prose
    punctuation attached to the matched token (a closing parenthesis, a sentence-ending
    period, a quote) is trimmed off before the hostname check and left in the text unchanged.
    A candidate that is not a well-formed http(s) URL with a valid hostname -- a bare
    'file://' URL (never matched by the http(s)-only candidate pattern in the first place), a
    malformed/host-less URL, or ordinary text -- is left completely untouched, so it remains
    fully subject to the local-path scan exactly as before this correction."""
    def _replace(match: re.Match) -> str:
        candidate = match.group(0)
        trimmed = candidate.rstrip(_URL_TRAILING_PUNCTUATION)
        if trimmed and _is_valid_web_url(trimmed):
            trailing = candidate[len(trimmed):]
            return (" " * len(trimmed)) + trailing
        return candidate
    return _URL_CANDIDATE_PATTERN.sub(_replace, text)


def _forbidden_content_in_text(label: str, text: str) -> list[str]:
    """Pure string scan -- never mutates, never reads a file. See check_no_forbidden_content.
    The local-path check runs against a URL-stripped copy of the text (see
    _strip_valid_web_urls); every other check runs against the original, unstripped text."""
    problems: list[str] = []
    if not text:
        return problems
    if _EMAIL_PATTERN.search(text):
        problems.append(f"{label} appears to contain an email address")
    if _ABSOLUTE_PATH_PATTERN.search(_strip_valid_web_urls(text)):
        problems.append(f"{label} appears to contain an absolute local path")
    lowered = text.lower()
    for keyword in _CREDENTIAL_KEYWORDS:
        if keyword in lowered:
            problems.append(f"{label} contains the credential-like keyword {keyword!r}")
    return problems


def check_no_forbidden_content(doc: dict) -> list[str]:
    """Scans only the operator-authored free-text fields (operator_display_name and every
    row's operator_notes / event_club_observation_notes) for an email address, an absolute
    local path, or a credential-like keyword -- never the read-only 'evidence' copy of the
    pack row, which this tool does not author. Returns a list of problems; empty means clean."""
    problems = _forbidden_content_in_text(
        "operator_display_name", doc.get("operator_display_name") or ""
    )
    for row in doc.get("rows", []):
        url = row.get("draftguru_url", "?")
        problems += _forbidden_content_in_text(
            f"row {url} operator_notes", row.get("operator_notes") or ""
        )
        problems += _forbidden_content_in_text(
            f"row {url} event_club_observation_notes", row.get("event_club_observation_notes") or ""
        )
    return problems


def check_no_absolute_paths(doc: dict) -> list[str]:
    """Checks every path-bearing field this tool itself writes (tool.path,
    source_adjudication_pack.path, each source_hash_links[].path) is a relative,
    forward-slash repository path -- never an absolute local filesystem path, and never
    containing a '..' traversal segment out of the repository. These are always plain
    repository-relative paths, never URLs, so this check is deliberately NOT URL-aware -- see
    _strip_valid_web_urls for the operator-authored free-text fields, which are the only
    fields where a legitimate evidence-citation URL can appear."""
    problems: list[str] = []

    def _check(label: str, path: object) -> None:
        if not isinstance(path, str) or not path:
            problems.append(f"{label} is missing or not a string")
            return
        if path.startswith("/") or _ABSOLUTE_PATH_PATTERN.search(path):
            problems.append(f"{label} looks like an absolute local path: {path!r}")
            return
        if ".." in path.split("/"):
            problems.append(f"{label} contains a '..' path-traversal segment: {path!r}")

    _check("tool.path", (doc.get("tool") or {}).get("path"))
    _check("source_adjudication_pack.path", (doc.get("source_adjudication_pack") or {}).get("path"))
    for i, link in enumerate(doc.get("source_hash_links") or []):
        _check(f"source_hash_links[{i}].path", (link or {}).get("path"))
    return problems


def validate_final_output(
    repo_root: Path = REPO_ROOT,
    *,
    pack_path: Path | None = None,
    expected_source_pack_sha256: str = EXPECTED_SOURCE_PACK_SHA256,
    expected_json_sha256: str = EXPECTED_FINAL_JSON_SHA256,
    expected_csv_sha256: str = EXPECTED_FINAL_CSV_SHA256,
    expected_md_sha256: str = EXPECTED_FINAL_MD_SHA256,
    expected_json_size: int = EXPECTED_FINAL_JSON_SIZE,
    expected_csv_size: int = EXPECTED_FINAL_CSV_SIZE,
    expected_md_size: int = EXPECTED_FINAL_MD_SIZE,
) -> dict:
    """Independent, read-only validation of the ALREADY-FINALISED ISSUE-222 Phase 3 verdict
    artefacts. Never acquires the review lock, never opens Tkinter, never touches the
    checkpoint, and never writes, regenerates or repairs any file. Raises ToolError, naming
    the exact failed invariant, on the first problem found; returns a summary dict on success.
    The expected_* keyword arguments default to the real pinned 2026-09-18 values and exist
    only so a test can point this same logic at a small fixture artefact set instead."""
    resolved_pack_path = pack_path or (repo_root / DEFAULT_PACK_PATH)
    pack_info = load_and_validate_pack(resolved_pack_path, repo_root)

    if pack_info["pack_sha256"] != expected_source_pack_sha256:
        raise ToolError(
            "source adjudication pack sha256 does not match the pinned, operator-reported "
            f"value (expected {expected_source_pack_sha256}, got {pack_info['pack_sha256']})"
        )

    paths = output_paths(repo_root)
    for label, path in (
        ("canonical JSON", paths["json"]),
        ("derived CSV", paths["csv"]),
        ("derived Markdown", paths["md"]),
    ):
        if not path.is_file():
            raise ToolError(f"{label} does not exist: {repo_relative(path, repo_root)}")

    json_bytes = paths["json"].read_bytes()
    csv_bytes_on_disk = paths["csv"].read_bytes()
    md_bytes_on_disk = paths["md"].read_bytes()

    for label, actual_bytes, expected_sha, expected_size in (
        ("canonical JSON", json_bytes, expected_json_sha256, expected_json_size),
        ("derived CSV", csv_bytes_on_disk, expected_csv_sha256, expected_csv_size),
        ("derived Markdown", md_bytes_on_disk, expected_md_sha256, expected_md_size),
    ):
        actual_sha = sha256_bytes(actual_bytes)
        if actual_sha != expected_sha:
            raise ToolError(
                f"{label} sha256 does not match the pinned, operator-reported value "
                f"(expected {expected_sha}, got {actual_sha}) -- refusing to treat this as the "
                "reviewed artefact"
            )
        if len(actual_bytes) != expected_size:
            raise ToolError(
                f"{label} size does not match the pinned, operator-reported value (expected "
                f"{expected_size} bytes, got {len(actual_bytes)} bytes)"
            )

    try:
        doc = json.loads(json_bytes.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ToolError(f"canonical JSON is not valid JSON: {exc}") from exc

    # -- 2. Canonical JSON structure ----------------------------------------------------
    if doc.get("schema_version") != SCHEMA_VERSION:
        raise ToolError(f"unexpected schema_version {doc.get('schema_version')!r}")
    if doc.get("issue") != ISSUE:
        raise ToolError(f"unexpected issue {doc.get('issue')!r}")
    if doc.get("label") != LABEL:
        raise ToolError(f"unexpected label {doc.get('label')!r}")

    source_pack_block = doc.get("source_adjudication_pack") or {}
    expected_pack_rel_path = repo_relative(resolved_pack_path, repo_root)
    if source_pack_block.get("path") != expected_pack_rel_path:
        raise ToolError(
            f"source_adjudication_pack.path {source_pack_block.get('path')!r} does not match "
            f"the expected {expected_pack_rel_path!r}"
        )
    if source_pack_block.get("sha256") != expected_source_pack_sha256:
        raise ToolError(
            "source_adjudication_pack.sha256 recorded in the final JSON does not match the "
            "pinned, operator-reported source-pack hash"
        )

    doc_hash_links = doc.get("source_hash_links")
    if not isinstance(doc_hash_links, list) or not doc_hash_links:
        raise ToolError("final JSON is missing a non-empty source_hash_links list")
    expected_hash_link_set = {(h["path"], h["sha256"]) for h in pack_info["hash_checks"]}
    doc_hash_link_set = {(h.get("path"), h.get("sha256")) for h in doc_hash_links}
    if doc_hash_link_set != expected_hash_link_set:
        raise ToolError(
            "final JSON source_hash_links does not match the freshly re-verified pack "
            "hash-linked inputs -- a source/hash-linked input has drifted from what the final "
            "JSON recorded"
        )

    operator_display_name = doc.get("operator_display_name")
    if not isinstance(operator_display_name, str) or not operator_display_name.strip():
        raise ToolError("operator_display_name is blank")

    review_started = doc.get("review_started_utc")
    review_completed = doc.get("review_completed_utc")
    try:
        started_dt = datetime.strptime(review_started, "%Y-%m-%dT%H:%M:%SZ")
        completed_dt = datetime.strptime(review_completed, "%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError) as exc:
        raise ToolError(
            f"review_started_utc/review_completed_utc are not valid timestamps: {exc}"
        ) from exc
    if completed_dt < started_dt:
        raise ToolError("review_completed_utc is earlier than review_started_utc")

    if doc.get("completion_status") != "complete":
        raise ToolError(f"completion_status is {doc.get('completion_status')!r}, not 'complete'")

    doc_rows = doc.get("rows")
    if not isinstance(doc_rows, list):
        raise ToolError("final JSON is missing rows[]")
    if len(doc_rows) != EXPECTED_TOTAL_ROWS:
        raise ToolError(f"final JSON has {len(doc_rows)} rows, expected {EXPECTED_TOTAL_ROWS}")

    absolute_path_problems = check_no_absolute_paths(doc)
    if absolute_path_problems:
        raise ToolError("absolute local path(s) found: " + "; ".join(absolute_path_problems))

    forbidden_content_problems = check_no_forbidden_content(doc)
    if forbidden_content_problems:
        raise ToolError("forbidden content found: " + "; ".join(forbidden_content_problems))

    # -- 3/4. Row identity, decision and event-club-relationship validation -------------
    pack_rows = pack_info["rows"]
    if len(doc_rows) != len(pack_rows):
        raise ToolError(
            f"final JSON has {len(doc_rows)} rows, source pack has {len(pack_rows)} -- refusing"
        )

    by_group: Counter = Counter()
    by_verdict: Counter = Counter()
    by_derived: Counter = Counter()
    by_observation: Counter = Counter()
    negative_rows: list[dict] = []
    uncertain_rows: list[dict] = []
    overridden_rows: list[dict] = []
    seen_row_ids: set[str] = set()

    for position, (doc_row, pack_row) in enumerate(zip(doc_rows, pack_rows), start=1):
        expected_row_id = pack_row["row_id"]
        group = doc_row.get("group")
        url = doc_row.get("draftguru_url")
        doc_row_id = f"{group}:{url}"
        if doc_row_id != expected_row_id:
            raise ToolError(
                f"final JSON row at position {position} is {doc_row_id!r}, expected "
                f"{expected_row_id!r} in source-pack order (missing, duplicate or reordered row)"
            )
        if doc_row_id in seen_row_ids:
            raise ToolError(f"duplicate immutable row identity in final JSON: {doc_row_id!r}")
        seen_row_ids.add(doc_row_id)

        for field in ("row_ordinal_in_group", "pack_ordinal", "global_order", "group_label"):
            if doc_row.get(field) != pack_row.get(field):
                raise ToolError(
                    f"row {doc_row_id!r} field {field!r} ({doc_row.get(field)!r}) does not "
                    f"match the source pack ({pack_row.get(field)!r})"
                )
        if doc_row.get("evidence") != pack_row["raw"]:
            raise ToolError(f"row {doc_row_id!r} evidence does not match the source pack's raw row")

        spec = SECTION_SPECS[group]
        verdict = doc_row.get("operator_verdict")
        notes = doc_row.get("operator_notes") or ""
        if not verdict:
            raise ToolError(f"row {doc_row_id!r} has a blank operator_verdict")
        if verdict == PLACEHOLDER_VERDICT:
            raise ToolError(f"row {doc_row_id!r} still carries the placeholder verdict")
        validate_decision(group, verdict, notes)

        expected_machine = machine_classification_for(pack_row)
        if doc_row.get("machine_classification") != expected_machine:
            raise ToolError(
                f"row {doc_row_id!r} machine_classification "
                f"{doc_row.get('machine_classification')!r} does not match the recomputed "
                f"value {expected_machine!r}"
            )
        if not doc_row.get("decided_utc"):
            raise ToolError(f"row {doc_row_id!r} is missing decided_utc")

        derived = derive_event_club_appearance_relationship(pack_row["raw"])
        if doc_row.get("event_club_appearance_relationship_derived") != derived:
            raise ToolError(
                f"row {doc_row_id!r} event_club_appearance_relationship_derived "
                f"{doc_row.get('event_club_appearance_relationship_derived')!r} does not match "
                f"the freshly re-derived value {derived!r}"
            )

        observation = doc_row.get("event_club_observation")
        observation_notes = doc_row.get("event_club_observation_notes") or ""
        if event_club_observation_required_for(pack_row, verdict):
            if observation not in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
                raise ToolError(
                    f"row {doc_row_id!r} carries a same-person verdict on a row whose derived "
                    f"event-club relationship is {derived!r}, but no valid "
                    "event_club_observation acknowledgement is recorded"
                )
            validate_event_club_observation(observation, derived, observation_notes)
        elif observation is not None:
            if observation not in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
                raise ToolError(f"row {doc_row_id!r} carries an invalid event_club_observation {observation!r}")
            validate_event_club_observation(observation, derived, observation_notes)

        by_group[group] += 1
        by_verdict[verdict] += 1
        by_derived[derived] += 1
        if observation:
            by_observation[observation] += 1

        row_summary = {"draftguru_url": url, "group": group, "verdict": verdict}
        if verdict in NEGATIVE_VERDICT_CODES:
            negative_rows.append(row_summary)
        elif verdict in UNCERTAIN_VERDICT_CODES:
            uncertain_rows.append(row_summary)
        if observation and observation != derived:
            overridden_rows.append({**row_summary, "derived": derived, "observation": observation})

    for group, spec in SECTION_SPECS.items():
        if by_group.get(group, 0) != spec["expected_count"]:
            raise ToolError(
                f"group {group!r} has {by_group.get(group, 0)} decisions in the final JSON, "
                f"expected {spec['expected_count']}"
            )

    doc_totals = doc.get("totals") or {}
    if doc_totals.get("by_group") != dict(by_group):
        raise ToolError(
            f"totals.by_group {doc_totals.get('by_group')!r} does not match the actual decision rows"
        )
    if doc_totals.get("by_verdict") != dict(by_verdict):
        raise ToolError(
            f"totals.by_verdict {doc_totals.get('by_verdict')!r} does not match the actual decision rows"
        )
    if doc_totals.get("by_event_club_appearance_relationship_derived") != dict(by_derived):
        raise ToolError(
            "totals.by_event_club_appearance_relationship_derived does not match the actual "
            "decision rows"
        )
    if doc_totals.get("by_event_club_observation") != dict(by_observation):
        raise ToolError(
            "totals.by_event_club_observation does not match the actual decision rows"
        )
    if doc_totals.get("overall") != EXPECTED_TOTAL_ROWS:
        raise ToolError(f"totals.overall is {doc_totals.get('overall')!r}, expected {EXPECTED_TOTAL_ROWS}")

    # -- 5. Deterministic derived views ---------------------------------------------------
    if render_csv(doc) != csv_bytes_on_disk:
        raise ToolError(
            "the deterministically re-rendered CSV differs from the file on disk -- refusing"
        )
    if render_markdown(doc) != md_bytes_on_disk:
        raise ToolError(
            "the deterministically re-rendered Markdown differs from the file on disk -- refusing"
        )

    # Defence in depth: confirm the source pack is still byte-identical to what was validated
    # at the very start of this function.
    assert_pack_unchanged(resolved_pack_path, pack_info["pack_sha256"])

    return {
        "pack_sha256": pack_info["pack_sha256"],
        "json_sha256": sha256_bytes(json_bytes),
        "csv_sha256": sha256_bytes(csv_bytes_on_disk),
        "md_sha256": sha256_bytes(md_bytes_on_disk),
        "operator_display_name": operator_display_name,
        "review_started_utc": review_started,
        "review_completed_utc": review_completed,
        "by_group": dict(by_group),
        "by_verdict": dict(by_verdict),
        "by_derived": dict(by_derived),
        "by_observation": dict(by_observation),
        "negative_rows": negative_rows,
        "uncertain_rows": uncertain_rows,
        "overridden_rows": overridden_rows,
    }


def print_final_output_validation_report(report: dict) -> None:
    """Prints the concise PASS summary. Never prints all 83 decisions and never prints the
    operator's display name (present in the returned report dict for programmatic use only)."""
    print("PASS: AFLDB-ISSUE-222 Phase 3 operator-verdict final-output validation")
    print(f"  Source adjudication pack sha256: {report['pack_sha256']}")
    print(f"  Canonical JSON sha256:           {report['json_sha256']}")
    print(f"  Derived CSV sha256:              {report['csv_sha256']}")
    print(f"  Derived Markdown sha256:         {report['md_sha256']}")
    print(f"  Review started:   {report['review_started_utc']}")
    print(f"  Review completed: {report['review_completed_utc']}")
    print(f"  Decisions: {sum(report['by_group'].values())} / {EXPECTED_TOTAL_ROWS}")
    print("  Group totals:")
    for group in GROUP_ORDER:
        print(f"    {group}: {report['by_group'].get(group, 0)}")
    print("  Verdict totals:")
    for verdict in sorted(report["by_verdict"]):
        print(f"    {verdict}: {report['by_verdict'][verdict]}")
    print("  Event-club appearance relationship totals (derived):")
    for key in sorted(report["by_derived"]):
        print(f"    {key}: {report['by_derived'][key]}")
    print("  Event-club observation totals (operator):")
    for key in sorted(report["by_observation"]):
        print(f"    {key}: {report['by_observation'][key]}")
    print(f"  Negative-verdict rows ({len(report['negative_rows'])}), for human awareness only:")
    for row in report["negative_rows"]:
        print(f"    {row['group']}: {row['draftguru_url']} -> {row['verdict']}")
    print(f"  Uncertain-verdict rows ({len(report['uncertain_rows'])}), for human awareness only:")
    for row in report["uncertain_rows"]:
        print(f"    {row['group']}: {row['draftguru_url']} -> {row['verdict']}")
    print(
        f"  Operator-overridden club-observation rows ({len(report['overridden_rows'])}), for "
        "human awareness only:"
    )
    for row in report["overridden_rows"]:
        print(
            f"    {row['group']}: {row['draftguru_url']} -> derived {row['derived']}, "
            f"operator recorded {row['observation']}"
        )
    print("  CSV deterministic re-render: PASS (byte-identical to the file on disk)")
    print("  Markdown deterministic re-render: PASS (byte-identical to the file on disk)")
    print("  Source pack byte-identity: PASS (unchanged since load)")
    print("  No source or verdict artefact was modified during this validation.")


# ---------------------------------------------------------------------------
# GUI (only built when TK_AVAILABLE; GUI-independent logic above is importable and testable
# without Tkinter or a display)
# ---------------------------------------------------------------------------

_AppBase = tk.Tk if TK_AVAILABLE else object


class OperatorReviewApp(_AppBase):  # type: ignore[misc]
    """The interactive review window. Never preselects a verdict, never sets one without an
    explicit operator action on the currently displayed row."""

    def __init__(self, pack_info: dict, checkpoint: dict, checkpoint_path: Path,
                 lock_path: Path, repo_root: Path = REPO_ROOT):
        if not TK_AVAILABLE:
            raise RuntimeError(
                "tkinter is not available in this Python environment -- install/enable Tcl/Tk "
                "for the interpreter you are using, or run --validate-only for a headless check"
            )
        super().__init__()
        self.pack_info = pack_info
        self.checkpoint = checkpoint
        self.checkpoint_path = checkpoint_path
        self.lock_path = lock_path
        self.repo_root = repo_root

        self.rows = pack_info["rows"]
        self.filter_group: str | None = None
        self.filter_incomplete_only = tk.BooleanVar(value=False)
        self.filter_needs_club_ack = tk.BooleanVar(value=False)
        self.bulk_enabled = tk.BooleanVar(value=False)
        self.cursor = 0
        self._suspend_trace = False
        # "Show details" toggle for the collapsed-by-default Supporting comparison evidence
        # subsection (screen-size/compaction fix, 2026-09-18) -- persists across row navigation
        # within a session (a deliberate operator preference), never expanded automatically.
        self._supporting_visible = False
        self._wrap_labels: list = []      # static wrapping labels, built once in _build_layout
        self._row_wrap_labels: list = []  # rebuilt every _render_current_row call

        self.title(f"AFLDB-ISSUE-222 operator adjudication -- {LABEL}")
        self.geometry("1024x720")
        self.minsize(760, 480)
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        if not checkpoint.get("operator_display_name"):
            self._prompt_operator_name()

        self._build_menu()
        self._build_layout()
        self._recompute_filtered()
        self._render_current_row()

        # Global shortcuts (screen-size/keyboard-navigation fix, 2026-09-18). Bound at the root
        # window level so they work from every normal control; explicitly re-bound on the two
        # multiline Text widgets too (with "break") so a text field can never swallow Alt+Left/
        # Alt+Right -- see _build_layout.
        self.bind("<Alt-Right>", lambda _e: self._go_next())
        self.bind("<Alt-Left>", lambda _e: self._go_prev())
        self.bind("<Control-s>", lambda _e: self._save())
        self.bind("<Escape>", self._on_escape)
        self.bind("<Prior>", lambda _e: self._main_canvas.yview_scroll(-1, "pages"))   # Page Up
        self.bind("<Next>", lambda _e: self._main_canvas.yview_scroll(1, "pages"))     # Page Down
        self.bind("<Home>", lambda _e: self._main_canvas.yview_moveto(0.0))
        self.bind("<End>", lambda _e: self._main_canvas.yview_moveto(1.0))
        self.bind_all("<FocusIn>", self._on_focus_in_scroll)

    # -- first-launch operator identity -----------------------------------

    def _prompt_operator_name(self) -> None:
        dialog = tk.Toplevel(self)
        dialog.title("Operator display name")
        dialog.transient(self)
        dialog.grab_set()
        tk.Label(
            dialog,
            text="Operator display name (optional -- default blank).\n"
                 "Never request or store an email address, credentials or system username.",
            justify="left",
        ).pack(padx=12, pady=(12, 6))
        entry = tk.Entry(dialog, width=40)
        entry.pack(padx=12, pady=6)
        entry.focus_set()

        def accept() -> None:
            self.checkpoint["operator_display_name"] = entry.get().strip()
            dialog.destroy()

        tk.Button(dialog, text="OK", command=accept).pack(pady=(6, 12))
        dialog.bind("<Return>", lambda _e: accept())
        self.wait_window(dialog)
        self._save()

    # -- help ------------------------------------------------------------------

    def _help_text(self) -> str:
        group = self._current_row()["group"]
        spec = SECTION_SPECS[group]
        paths = output_paths(self.repo_root)
        lines = [
            "AFLDB-ISSUE-222 operator adjudication -- how to use this tool",
            "",
            "1. Read section A (source evidence) and section B (retained target evidence) for",
            "   the row on screen. Click 'Open DraftGuru page' and 'Open AFL Tables page' to",
            "   inspect both source pages in your normal browser, then return to this window --",
            "   opening a link never records a decision by itself.",
            "2. In section C, choose exactly one identity relationship from the dropdown --",
            "   phrased in plain English, with the stable stored code shown underneath your",
            "   selection for reference. Add notes -- mandatory for a negative or uncertain",
            "   choice.",
            "3. In section D, either click 'Confirm suggested relationship' to accept the",
            "   plain-English suggestion shown, or 'Choose a different relationship' to pick a",
            "   different one yourself (notes required only when it differs from the",
            "   suggestion). This is a SEPARATE decision from the identity verdict in C and",
            "   never changes it.",
            "4. Use Previous / Next -- always in the FIXED FOOTER at the bottom of the window,",
            "   never inside the scrolling form -- (or Alt+Left / Alt+Right from any control,",
            "   including from inside a notes field) to move between rows. Previous is visibly",
            "   disabled on the first displayed row, Next on the last; if a club-observation",
            "   edit is sitting unsaved, both are refused until you Save or Discard it, and",
            "   keyboard focus moves to the control that needs attention.",
            "5. Finalise (also in the fixed footer) once every row is fully complete (identity",
            "   verdict plus any required club-appearance confirmation).",
            "",
            "Window layout: a fixed header (status/progress/filters) at the top, a fixed footer",
            "(Previous/Next/row position/Save checkpoint/Discard unsaved changes/Finalise) at",
            "the bottom, and ONE scrollable middle area in between holding sections A-D plus",
            "the collapsed Supporting-evidence and Advanced toggles. Mouse wheel, Page Up/Page",
            "Down, Home and End all scroll that middle area; tabbing or clicking into a control",
            "scrolls it into view automatically. Resizing re-wraps the content to the new width",
            "-- nothing needs horizontal scrolling.",
            "",
            "A player can be drafted again by the SAME club. A same-club re-draft or re-listing",
            "is still a valid re-draft/re-listing event -- do not infer that a retained record",
            "showing only one club means the event was not a re-draft.",
            "",
            "No option is ever preselected. The status line below each control always states",
            "the real, current selection in words -- 'NONE' or 'NOT YET CONFIRMED' until you",
            "explicitly choose or confirm one.",
            "",
            f"Identity relationship choices for the current group ({spec['label']}):",
        ]
        for verdict in spec["allowed_verdicts"]:
            meaning = VERDICT_MEANINGS.get(group, {}).get(verdict, "")
            friendly = VERDICT_FRIENDLY_LABELS.get(group, {}).get(verdict, verdict)
            note = "  (notes required)" if verdict in REQUIRES_NOTES else ""
            lines.append(f"  - {friendly}{note}")
            lines.append(f"      stored value: {verdict} -- {meaning}")
        lines += [
            "",
            "Event-club relationship (section D -- separate from the identity decision in C):",
            "  A player can be drafted/listed by a club and never play a senior game for it. A",
            "  player can ALSO have already played senior games for a club, be delisted, and be",
            "  re-drafted/relisted by that SAME club without ever playing another senior game",
            "  after the new listing event -- neither pattern is an identity contradiction or",
            "  proof the DraftGuru link is wrong. Section D shows a plain-English suggestion",
            "  derived from retained evidence (never an operator decision, and never a database",
            "  fact) that is always one of these five relationships:",
        ]
        for code in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
            lines.append(f"    - {EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS[code]}  (stored value: {code})")
        lines += [
            "  Click 'Confirm suggested relationship' to accept it, or 'Choose a different",
            "  relationship' to record your own from the same five choices -- notes are",
            "  required only when your choice differs from the suggestion. For a same-person",
            "  verdict on a row whose suggestion is 'Never played a senior game for this club'",
            "  or 'Played for this club before this event, but not afterward', this",
            "  confirmation is REQUIRED before the row counts as fully complete. A relisted",
            "  player correctly suggested 'before this event, but not afterward' can still",
            "  correctly receive a same-person identity verdict -- confirming or questioning",
            "  the suggestion never changes or preselects the identity decision above it.",
            "",
            "'Saved acknowledgement:' vs. 'Unsaved change -- not recorded:' (neither line is",
            "ever labelled or coloured 'Confirmed' -- that word read as an endorsement, when it",
            "only ever meant 'this is what is currently persisted'):",
            "  - The bold green 'Saved acknowledgement: <sentence>' line changes ONLY when a",
            "    save actually succeeds (Confirm suggested relationship / Save observation) --",
            "    never merely because you changed the dropdown or typed notes.",
            "  - Editing the dropdown or notes in 'Choose a different relationship' instead",
            "    shows a separate line: 'Unsaved change -- not recorded: <relationship>...' --",
            "    amber if it would currently be accepted, red with the reason if it would",
            "    currently be refused. An unpersisted or validation-failed value is never",
            "    coloured or labelled as saved/confirmed.",
            "  - A refused save leaves the last persisted acknowledgement exactly as it was.",
            "  - 'Discard unsaved changes' (fixed footer, or Escape after a confirmation",
            "    dialog) restores the dropdown/notes to the last persisted value without",
            "    touching the checkpoint -- it never deletes a previously saved verdict or",
            "    acknowledgement.",
            "  - Navigation, Finalise and closing the window are all refused, never silent,",
            "    while a pending club-observation edit exists -- use Save or Discard first;",
            "    keyboard focus moves straight to the control that needs attention.",
            "",
            "Progress counters (always computed the same way in the header, the filters and",
            "the Finalise button):",
            "  - Identity verdicts entered: rows with a valid, correctly-noted identity",
            "    decision, whether or not a club-appearance confirmation is also outstanding.",
            "  - Club acknowledgements still required: rows whose identity decision requires a",
            "    club-appearance confirmation that has not yet been recorded.",
            "  - Fully completed rows: rows where every required field -- identity decision and",
            "    (where required) club-appearance confirmation -- is complete. Only this count",
            "    gates Finalise.",
            "",
            "Evidence links:",
            "  'Open DraftGuru page' / 'Open AFL Tables page' launch your normal web browser for",
            "  human evidence review only -- this tool never fetches, scrapes or requests either",
            "  page itself, and a failed browser launch never affects your saved verdict or",
            "  notes. 'Copy DraftGuru URL' / 'Copy AFL Tables URL' put the exact URL on your",
            "  clipboard; neither URL is ever written into your notes automatically. The AFL",
            "  Tables URL is built from the row's captured href and only ever points at",
            "  afltables.com; an unexpected host or scheme is refused with a clear dialog rather",
            "  than opened.",
            "",
            "Checkpoint / resume:",
            f"  Progress saves automatically to {CHECKPOINT_DIR_REL}/progress.json after every",
            "  verdict change, when notes lose focus, and before closing. Closing and relaunching",
            "  this tool from the same repository resumes the same review; the source pack's",
            "  hash is re-checked on every resume. Opening this tool against an older checkpoint",
            "  migrates it forward additively (adding blank event-club-observation fields; never",
            "  clearing or resetting an existing verdict) and writes a verified backup of the",
            "  pre-migration file first, in the same checkpoint directory.",
            "",
            "Finalisation:",
            f"  Writes {repo_relative(paths['json'], self.repo_root)}",
            f"  plus {repo_relative(paths['csv'], self.repo_root)} and "
            f"{repo_relative(paths['md'], self.repo_root)}.",
            "  Finalising does NOT link players, modify a database, or approve Phase 3.",
            "",
            "Full documentation: tools/rebuild/draftguru/README.md",
        ]
        return "\n".join(lines)

    def _show_help(self) -> None:
        dialog = tk.Toplevel(self)
        dialog.title("How to use this tool")
        dialog.transient(self)
        dialog.geometry("640x520")
        text = tk.Text(dialog, wrap="word", padx=10, pady=10)
        text.insert("1.0", self._help_text())
        text.config(state="disabled")
        text.pack(fill="both", expand=True)
        tk.Button(dialog, text="Close", command=dialog.destroy).pack(pady=(0, 10))

    # -- layout --------------------------------------------------------------

    def _build_menu(self) -> None:
        menubar = tk.Menu(self)
        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="Save checkpoint", command=self._save, accelerator="Ctrl+S")
        file_menu.add_command(label="Set operator name", command=self._prompt_operator_name)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self._on_close)
        menubar.add_cascade(label="File", menu=file_menu)
        help_menu = tk.Menu(menubar, tearoff=0)
        help_menu.add_command(label="How to use...", command=self._show_help)
        menubar.add_cascade(label="Help", menu=help_menu)
        self.config(menu=menubar)

    def _make_wrap_label(self, parent, *, row_scoped: bool = False, **kwargs) -> tk.Label:
        """A Label whose wraplength is kept in sync with the available width (screen-size fix,
        2026-09-18) -- see _on_canvas_configure. row_scoped=True registers it in the list that
        is cleared at the start of every _render_current_row (per-row evidence content);
        row_scoped=False (the default) registers it in the list built once here, for the
        lifetime of the window (static labels: headings, reminders, status lines)."""
        kwargs.setdefault("justify", "left")
        kwargs.setdefault("wraplength", 700)
        label = tk.Label(parent, **kwargs)
        (self._row_wrap_labels if row_scoped else self._wrap_labels).append(label)
        return label

    def _on_canvas_configure(self, event) -> None:
        """Keeps the scrollable content exactly as wide as the visible canvas (so nothing is
        clipped and nothing needs horizontal scrolling) and recalculates every registered
        label's wraplength to match -- screen-size/responsive-width fix, 2026-09-18."""
        self._main_canvas.itemconfigure(self._main_content_window, width=event.width)
        new_wrap = compute_wraplength(event.width)
        for label in self._wrap_labels + self._row_wrap_labels:
            try:
                label.configure(wraplength=new_wrap)
            except tk.TclError:  # pragma: no cover -- widget destroyed mid-callback
                pass

    def _on_mousewheel(self, event) -> None:
        self._main_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

    def _on_focus_in_scroll(self, event) -> None:
        """Scrolls the main content area just enough to bring the newly focused control into
        view (screen-size fix, 2026-09-18) -- never jumps further than needed, and is a no-op
        for focus outside the scrollable form (e.g. the footer, a dialog)."""
        widget = event.widget
        try:
            if not str(widget).startswith(str(self._main_content)):
                return
            self.update_idletasks()
            bbox = self._main_canvas.bbox("all")
            if not bbox:
                return
            total_height = bbox[3] - bbox[1]
            if total_height <= 0:
                return
            widget_top = widget.winfo_rooty() - self._main_content.winfo_rooty()
            widget_bottom = widget_top + widget.winfo_height()
            view_top_frac, view_bottom_frac = self._main_canvas.yview()
            view_top = view_top_frac * total_height
            view_bottom = view_bottom_frac * total_height
            if widget_top < view_top:
                self._main_canvas.yview_moveto(max(0.0, widget_top / total_height))
            elif widget_bottom > view_bottom:
                visible_height = view_bottom - view_top
                self._main_canvas.yview_moveto(max(0.0, (widget_bottom - visible_height) / total_height))
        except (tk.TclError, AttributeError):  # pragma: no cover -- best-effort convenience only
            pass

    def _on_escape(self, _event=None) -> None:
        state = self._club_pending_state()
        if not state["has_pending"]:
            return
        if messagebox.askyesno(
            "Discard unsaved change",
            "Discard the current unsaved club-relationship edit?\n\n"
            "This only abandons what is sitting unsaved in the controls -- it never deletes a "
            "previously saved verdict or acknowledgement.",
        ):
            self._discard_club_pending_edit()

    def _focus_invalid_club_field(self) -> None:
        """Moves keyboard focus to whichever club-observation control needs correcting, and
        scrolls it into view -- called after a navigation/close/finalise attempt is refused for
        an unresolved club-observation edit (keyboard-navigation fix, 2026-09-18)."""
        self.club_choose_frame.pack(fill="x", pady=(0, 6))
        code, _ = self._club_pending_selection()
        target = self.club_obs_combo if not code else self.club_obs_notes_text
        try:
            target.focus_set()
        except tk.TclError:  # pragma: no cover -- widget not yet mapped
            pass

    def _build_layout(self) -> None:
        # ---- Fixed header (always visible at the top) --------------------------------
        top = tk.Frame(self)
        top.pack(side="top", fill="x", padx=8, pady=6)
        top_header = tk.Frame(top)
        top_header.pack(fill="x")
        self.status_var = tk.StringVar()
        tk.Label(top_header, textvariable=self.status_var, font=("TkDefaultFont", 10, "bold")).pack(
            side="left", anchor="w")
        tk.Button(top_header, text="Help", command=self._show_help).pack(side="right")

        # Three SEPARATE progress counters (usability correction, 2026-09-18): entering an
        # identity verdict is not the same as a row being fully complete. All three, the
        # filters below and the Finalise button state are always computed from the same
        # checkpoint functions -- see identity_verdict_entered_count /
        # club_acknowledgement_required_count / decided_count.
        self.identity_progress_var = tk.StringVar()
        tk.Label(top, textvariable=self.identity_progress_var).pack(anchor="w")
        self.club_ack_progress_var = tk.StringVar()
        tk.Label(top, textvariable=self.club_ack_progress_var).pack(anchor="w")
        self.completed_progress_var = tk.StringVar()
        tk.Label(top, textvariable=self.completed_progress_var, font=("TkDefaultFont", 9, "bold")).pack(anchor="w")

        self.verdict_totals_var = tk.StringVar()
        self._make_wrap_label(top, textvariable=self.verdict_totals_var).pack(anchor="w", fill="x")

        self._make_wrap_label(
            self, fg="#8a1f11",
            text="The operator is making the final decision on every row. This tool never "
                 "preselects, defaults or auto-applies a decision.",
        ).pack(side="top", fill="x", padx=8)

        filt = tk.Frame(self)
        filt.pack(side="top", fill="x", padx=8, pady=4)
        tk.Label(filt, text="Group filter:").pack(side="left")
        self.group_filter_var = tk.StringVar(value="(all)")
        group_choices = ["(all)"] + [f"{g} ({SECTION_SPECS[g]['label']})" for g in GROUP_ORDER]
        group_menu = ttk.Combobox(filt, textvariable=self.group_filter_var, values=group_choices,
                                   state="readonly", width=32)
        group_menu.pack(side="left", padx=(4, 12))
        group_menu.bind("<<ComboboxSelected>>", lambda _e: self._on_filter_changed())
        tk.Checkbutton(filt, text="Hide fully completed rows", variable=self.filter_incomplete_only,
                        command=self._on_filter_changed).pack(side="left")
        tk.Checkbutton(filt, text="Needs club-observation acknowledgement",
                        variable=self.filter_needs_club_ack,
                        command=self._on_filter_changed).pack(side="left", padx=(12, 0))

        # ---- Fixed footer (always visible at the bottom) -- packed BEFORE the expanding
        # scrollable area below so it always keeps its space regardless of window size,
        # evidence length or scroll position. Previous/Next/Discard are never inside a
        # scrolling content frame.
        footer = tk.Frame(self, relief="raised", borderwidth=1)
        footer.pack(side="bottom", fill="x")
        self.prev_button = tk.Button(footer, text="< Previous", command=self._go_prev)
        self.prev_button.pack(side="left", padx=(6, 0), pady=6)
        self.next_button = tk.Button(footer, text="Next >", command=self._go_next)
        self.next_button.pack(side="left", padx=(6, 0), pady=6)
        self.footer_position_var = tk.StringVar()
        tk.Label(footer, textvariable=self.footer_position_var,
                 font=("TkDefaultFont", 9, "bold")).pack(side="left", padx=(10, 0))
        self.nav_status_var = tk.StringVar()
        tk.Label(footer, textvariable=self.nav_status_var, fg="#555555").pack(side="left", padx=(10, 0))
        tk.Button(footer, text="Save checkpoint", command=self._save).pack(side="left", padx=(18, 0), pady=6)
        tk.Button(footer, text="Discard unsaved changes",
                  command=self._discard_club_pending_edit).pack(side="left", padx=(6, 0), pady=6)
        self.finalize_button = tk.Button(footer, text="Finalise", command=self._finalize, state="disabled")
        self.finalize_button.pack(side="right", padx=(0, 6), pady=6)

        # ---- Whole-form scrollable main content (sections A-D + Advanced) --------------
        # A single scroll region for the entire form (never a nested scroll region except a
        # genuinely multiline Text field's own internal scrolling) -- screen-size fix,
        # 2026-09-18.
        scroll_container = tk.Frame(self)
        scroll_container.pack(side="top", fill="both", expand=True)
        self._main_canvas = tk.Canvas(scroll_container, highlightthickness=0)
        main_scrollbar = tk.Scrollbar(scroll_container, orient="vertical", command=self._main_canvas.yview)
        self._main_canvas.configure(yscrollcommand=main_scrollbar.set)
        self._main_canvas.pack(side="left", fill="both", expand=True)
        main_scrollbar.pack(side="right", fill="y")

        self._main_content = tk.Frame(self._main_canvas)
        self._main_content_window = self._main_canvas.create_window(
            (0, 0), window=self._main_content, anchor="nw"
        )
        self._main_content.bind(
            "<Configure>",
            lambda _e: self._main_canvas.configure(scrollregion=self._main_canvas.bbox("all")),
        )
        self._main_canvas.bind("<Configure>", self._on_canvas_configure)
        # Mouse wheel only scrolls the form while the pointer is over it -- bind_all while
        # entered (and always over any child widget within it too) so the wheel works
        # regardless of which control the pointer happens to be over, unbind_all on leave so it
        # never steals wheel events from something else (e.g. a dialog) once the pointer moves
        # away.
        self._main_canvas.bind("<Enter>", lambda _e: self._main_canvas.bind_all("<MouseWheel>", self._on_mousewheel))
        self._main_canvas.bind("<Leave>", lambda _e: self._main_canvas.unbind_all("<MouseWheel>"))

        # A + B + supporting evidence -- plain frame, no scroll region of its own
        self.evidence_frame = tk.Frame(self._main_content)
        self.evidence_frame.pack(fill="x", padx=8, pady=4)
        self.evidence_frame.grid_columnconfigure(1, weight=1)

        # C. Identity decision
        decision = tk.LabelFrame(
            self._main_content, text="C. Identity decision (required per row -- nothing preselected)"
        )
        decision.pack(fill="x", padx=8, pady=4)

        verdict_row = tk.Frame(decision)
        verdict_row.pack(fill="x", padx=6, pady=(6, 2))
        tk.Label(verdict_row, text="Relationship:").pack(side="left")
        self.verdict_var = tk.StringVar(value="")
        self.verdict_combo = ttk.Combobox(verdict_row, state="readonly", width=58)
        self.verdict_combo.pack(side="left", padx=(6, 0))
        self.verdict_combo.bind("<<ComboboxSelected>>", self._on_verdict_selected)

        self.verdict_status_var = tk.StringVar()
        self.verdict_status_label = tk.Label(
            decision, textvariable=self.verdict_status_var,
            font=("TkDefaultFont", 10, "bold"), anchor="w",
        )
        self.verdict_status_label.pack(fill="x", padx=6)
        self.verdict_code_var = tk.StringVar()
        tk.Label(decision, textvariable=self.verdict_code_var, anchor="w",
                 fg="#777777", font=("TkDefaultFont", 8)).pack(fill="x", padx=6, pady=(0, 2))

        # Group-specific hint (e.g. relisting: same-club re-drafts are valid) -- see
        # AFLDB-ISSUE-222 usability follow-up: an operator initially misread "re-draft" as
        # requiring a different club.
        self.identity_hint_var = tk.StringVar()
        self._make_wrap_label(
            decision, textvariable=self.identity_hint_var, fg="#555555",
        ).pack(fill="x", padx=6, pady=(0, 4))

        tk.Label(decision, text="Notes (required for a negative/uncertain choice):").pack(anchor="w", padx=6)
        self.notes_text = tk.Text(decision, height=1, wrap="word")
        self.notes_text.pack(fill="x", padx=6, pady=(0, 6))
        self.notes_text.bind("<FocusOut>", lambda _e: self._save())
        self.notes_text.bind("<Alt-Right>", lambda _e: (self._go_next(), "break")[1])
        self.notes_text.bind("<Alt-Left>", lambda _e: (self._go_prev(), "break")[1])
        self.notes_text.bind("<Control-s>", lambda _e: (self._save(), "break")[1])

        # D. Event-club relationship -- a SEPARATE, event-relative observation from the
        # identity decision above; see the Help dialog for the full explanation.
        club_frame = tk.LabelFrame(
            self._main_content, text="D. Event-club relationship (independent of the identity decision above)"
        )
        club_frame.pack(fill="x", padx=8, pady=4)

        self._make_wrap_label(
            club_frame, fg="#555555", text=(
                "Reminder: a same-club re-draft/re-listing is still valid. Distinguish: played "
                "before the event only, played after it, or never played for the club."
            ),
        ).pack(fill="x", padx=6, pady=(6, 4))

        tk.Label(club_frame, text="Suggested from retained evidence:", anchor="w",
                 font=("TkDefaultFont", 9, "bold")).pack(anchor="w", padx=6, pady=(2, 0))
        self.club_obs_message_var = tk.StringVar()
        self._make_wrap_label(
            club_frame, textvariable=self.club_obs_message_var,
        ).pack(fill="x", padx=6)
        self.club_obs_code_var = tk.StringVar()
        tk.Label(club_frame, textvariable=self.club_obs_code_var, anchor="w",
                 fg="#777777", font=("TkDefaultFont", 8)).pack(fill="x", padx=6, pady=(0, 6))

        # "Saved acknowledgement:" reflects ONLY the last successfully persisted checkpoint
        # value -- see _render_current_row and saved_acknowledgement_text. It is never derived
        # from, and never updated by, the live combo/notes widgets below; that live, possibly-
        # unsaved state has its own separate line (club_pending_status_var, "Unsaved change --
        # not recorded: ...") so the two can never be confused with, or mislabelled as, one
        # another.
        self.club_ack_status_var = tk.StringVar()
        self.club_ack_status_label = self._make_wrap_label(
            club_frame, textvariable=self.club_ack_status_var, font=("TkDefaultFont", 10, "bold"),
        )
        self.club_ack_status_label.pack(fill="x", padx=6, pady=(0, 4))

        club_action_row = tk.Frame(club_frame)
        club_action_row.pack(fill="x", padx=6, pady=(0, 4))
        self.club_confirm_button = tk.Button(
            club_action_row, text="Confirm suggested relationship",
            command=self._confirm_suggested_observation,
        )
        self.club_confirm_button.pack(side="left")
        self.club_choose_button = tk.Button(
            club_action_row, text="Choose a different relationship",
            command=self._show_choose_different,
        )
        self.club_choose_button.pack(side="left", padx=(6, 0))

        # Revealed only via "Choose a different relationship", or automatically when the
        # checkpoint already carries the operator's own prior observation that genuinely
        # differs from the derived suggestion -- never for a fresh, blank row.
        self.club_choose_frame = tk.Frame(club_frame)

        club_choice_row = tk.Frame(self.club_choose_frame)
        club_choice_row.pack(fill="x", pady=(4, 2))
        tk.Label(club_choice_row, text="Your relationship:").pack(side="left")
        self.club_obs_combo = ttk.Combobox(club_choice_row, state="readonly", width=52)
        self.club_obs_combo.pack(side="left", padx=(6, 0))
        self.club_obs_combo.bind("<<ComboboxSelected>>", lambda _e: self._update_club_pending_status())

        tk.Label(
            self.club_choose_frame,
            text="Notes (required only if this differs from the suggested relationship):",
        ).pack(anchor="w")
        self.club_obs_notes_text = tk.Text(self.club_choose_frame, height=1, wrap="word")
        self.club_obs_notes_text.pack(fill="x", pady=(0, 4))
        # Deliberately NOT auto-persisted on focus loss (that is exactly how a stray, never-
        # explicitly-saved edit could previously end up silently attached to the checkpoint).
        # This only updates the live "pending" indicator below; only "Save observation" writes
        # to the checkpoint.
        self.club_obs_notes_text.bind("<KeyRelease>", lambda _e: self._update_club_pending_status())
        self.club_obs_notes_text.bind("<Alt-Right>", lambda _e: (self._go_next(), "break")[1])
        self.club_obs_notes_text.bind("<Alt-Left>", lambda _e: (self._go_prev(), "break")[1])
        self.club_obs_notes_text.bind("<Control-s>", lambda _e: (self._save(), "break")[1])

        # Live status of whatever is CURRENTLY in the combo/notes above -- see
        # unsaved_change_text. Blank whenever the controls match what is already persisted
        # (including "nothing selected yet").
        self.club_pending_status_var = tk.StringVar()
        self.club_pending_status_label = self._make_wrap_label(
            self.club_choose_frame, textvariable=self.club_pending_status_var,
        )
        self.club_pending_status_label.pack(fill="x", pady=(0, 4))

        tk.Button(self.club_choose_frame, text="Save observation",
                  command=self._save_chosen_observation).pack(anchor="w", pady=(0, 6))

        # Supporting comparison evidence is collapsed by default (compaction fix, 2026-09-18)
        # -- toggled by _toggle_supporting_details, rendered inside _render_current_row.
        self.supporting_toggle_button = tk.Button(
            self._main_content, text="▸ Show details (supporting comparison evidence)",
            command=self._toggle_supporting_details,
        )
        self.supporting_toggle_button.pack(anchor="w", padx=8, pady=(0, 4))
        self.supporting_frame = tk.Frame(self._main_content)

        # Advanced (collapsed by default) -- bulk action never occupies the main review area.
        advanced_row = tk.Frame(self._main_content)
        advanced_row.pack(fill="x", padx=8)
        self.advanced_visible = False
        self.advanced_toggle_button = tk.Button(
            advanced_row, text="▸ Advanced (bulk actions)", command=self._toggle_advanced,
        )
        self.advanced_toggle_button.pack(anchor="w")

        self.bulk_frame = tk.LabelFrame(self._main_content, text="Bulk action (advanced, off by default)")
        tk.Checkbutton(self.bulk_frame, text="Enable bulk actions for this session",
                        variable=self.bulk_enabled, command=self._on_bulk_toggle).pack(anchor="w", padx=6)
        self.bulk_button = tk.Button(
            self.bulk_frame, text="Bulk-apply positive verdict to filtered incomplete rows in current group",
            command=self._bulk_apply, state="disabled",
        )
        self.bulk_button.pack(anchor="w", padx=6, pady=(0, 6))

    def _toggle_supporting_details(self) -> None:
        self._supporting_visible = not self._supporting_visible
        self._render_current_row()

    def _toggle_advanced(self) -> None:
        if self.advanced_visible:
            self.bulk_frame.pack_forget()
            self.advanced_visible = False
            self.advanced_toggle_button.config(text="▸ Advanced (bulk actions)")
        else:
            self.bulk_frame.pack(fill="x", padx=8, pady=4)
            self.advanced_visible = True
            self.advanced_toggle_button.config(text="▾ Advanced (bulk actions)")

    # -- filtering / navigation ----------------------------------------------

    def _on_filter_changed(self) -> None:
        selection = self.group_filter_var.get()
        self.filter_group = None if selection == "(all)" else selection.split(" ", 1)[0]
        self._recompute_filtered()
        self._render_current_row()

    def _needs_club_ack(self, row: dict) -> bool:
        existing = self.checkpoint.get("decisions", {}).get(row["row_id"], {})
        verdict = existing.get("operator_verdict", "")
        if not event_club_observation_required_for(row, verdict):
            return False
        return existing.get("event_club_observation") not in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES

    def _recompute_filtered(self) -> None:
        indices = []
        for idx, row in enumerate(self.rows):
            if self.filter_group and row["group"] != self.filter_group:
                continue
            if self.filter_incomplete_only.get() and is_row_decided(row, self.checkpoint):
                continue
            if self.filter_needs_club_ack.get() and not self._needs_club_ack(row):
                continue
            indices.append(idx)
        self.filtered_indices = indices or list(range(len(self.rows)))
        if self.cursor not in self.filtered_indices:
            self.cursor = self.filtered_indices[0]

    def _attempt_leave_row(self) -> bool:
        """True if it is safe to navigate away from (or close on) the current row. Never
        silently saves or discards a pending club-observation edit -- see
        club_observation_pending_state / can_leave_row. Committing the IDENTITY notes is still
        safe and unconditional here: unlike the club-observation notes, they only ever attach
        to a verdict that has already been explicitly, validly set."""
        can_leave, message = can_leave_row(self._club_pending_state())
        if not can_leave:
            messagebox.showerror("Unsaved change", message)
            self._focus_invalid_club_field()
            return False
        self._commit_notes()
        return True

    def _go_next(self) -> None:
        if not self._attempt_leave_row():
            return
        self.cursor = next_cursor(self.filtered_indices, self.cursor, +1)
        self._render_current_row()

    def _go_prev(self) -> None:
        if not self._attempt_leave_row():
            return
        self.cursor = next_cursor(self.filtered_indices, self.cursor, -1)
        self._render_current_row()

    # -- rendering -------------------------------------------------------------

    def _render_current_row(self) -> None:
        row = self.rows[self.cursor]
        group = row["group"]
        spec = SECTION_SPECS[group]

        pos = self.filtered_indices.index(self.cursor) + 1
        group_rows = [r for r in self.rows if r["group"] == group]
        group_pos = group_rows.index(row) + 1
        self.status_var.set(
            f"Row {pos} of {len(self.filtered_indices)} shown  |  Group: {spec['label']}  |  "
            f"Group position {group_pos} of {spec['expected_count']}  |  "
            f"Immutable ordinal: {row.get('pack_ordinal') if row.get('pack_ordinal') is not None else row['global_order']}"
        )
        # Footer always carries a compact row-position indicator too (screen-size fix,
        # 2026-09-18) -- the fixed footer never depends on the scrollable header above it.
        self.footer_position_var.set(f"Row {pos} of {len(self.filtered_indices)}")

        # Three SEPARATE counters -- see identity_verdict_entered_count /
        # club_acknowledgement_required_count / decided_count. The header, the filters (via
        # is_row_decided / _needs_club_ack) and the Finalise button below all read the same
        # checkpoint state through the same functions, so they can never disagree.
        identity_entered = identity_verdict_entered_count(self.pack_info, self.checkpoint)
        club_ack_required = club_acknowledgement_required_count(self.pack_info, self.checkpoint)
        fully_completed = decided_count(self.pack_info, self.checkpoint)
        self.identity_progress_var.set(f"Identity verdicts entered: {identity_entered} / {EXPECTED_TOTAL_ROWS}")
        self.club_ack_progress_var.set(f"Club acknowledgements still required: {club_ack_required}")
        self.completed_progress_var.set(f"Fully completed rows: {fully_completed} / {EXPECTED_TOTAL_ROWS}")
        totals = verdict_totals(self.pack_info, self.checkpoint)
        self.verdict_totals_var.set(
            "Identity verdict counts (stored values): "
            + (", ".join(f"{k}={v}" for k, v in sorted(totals.items())) or "(none yet)")
        )
        self.finalize_button.config(state=("normal" if fully_completed == EXPECTED_TOTAL_ROWS else "disabled"))

        for child in self.evidence_frame.winfo_children():
            child.destroy()
        for child in self.supporting_frame.winfo_children():
            child.destroy()
        self._row_wrap_labels = []  # rebuilt fresh for this row's evidence content

        r = 0

        def add_line(label: str, value: object, *, parent=None, bold: bool = False,
                     fg: str | None = None) -> None:
            nonlocal r
            target = parent if parent is not None else self.evidence_frame
            tk.Label(target, text=f"{label}:", anchor="w",
                     font=("TkDefaultFont", 9, "bold" if bold else "normal")).grid(
                row=r, column=0, sticky="nw", padx=(0, 8), pady=1)
            self._make_wrap_label(target, text=str(value), fg=fg, row_scoped=True).grid(
                row=r, column=1, sticky="w", pady=1)
            r += 1

        def add_heading(text: str, *, parent=None) -> None:
            nonlocal r
            target = parent if parent is not None else self.evidence_frame
            tk.Label(target, text=text, anchor="w",
                     font=("TkDefaultFont", 10, "bold"), fg="#1a4fa0").grid(
                row=r, column=0, columnspan=2, sticky="w", pady=(10, 2))
            r += 1

        existing = self.checkpoint.get("decisions", {}).get(row["row_id"], {})
        existing_verdict = existing.get("operator_verdict", "")
        raw = row["raw"]
        links = evidence_links_for(row)
        source_fields = SOURCE_EVIDENCE_FIELDS.get(group, frozenset())
        target_fields = TARGET_EVIDENCE_FIELDS.get(group, frozenset())

        # A. Source evidence (DraftGuru)
        add_heading("A. Source evidence (DraftGuru)")
        for field, label in GROUP_FIELD_SPECS[group]:
            if field in source_fields and raw.get(field) not in (None, ""):
                add_line(label, raw[field])
        btn_row_a = tk.Frame(self.evidence_frame)
        btn_row_a.grid(row=r, column=0, columnspan=2, sticky="w", pady=(4, 0))
        r += 1
        draftguru_url = links["draftguru_url"]
        tk.Button(
            btn_row_a, text="Open DraftGuru page",
            command=lambda u=draftguru_url: self._open_link(u, DRAFTGURU_ALLOWED_HOSTS, "DraftGuru"),
        ).pack(side="left")
        tk.Button(
            btn_row_a, text="Copy DraftGuru URL", command=lambda u=draftguru_url: self._copy_link(u),
        ).pack(side="left", padx=(6, 0))
        add_line(
            "DraftGuru URL",
            draftguru_url if draftguru_url else f"(unavailable: {links['draftguru_error']})",
            fg=None if draftguru_url else "#8a1f11",
        )

        # B. Retained target evidence (AFL Tables / AFLDB)
        add_heading("B. Retained target evidence (AFL Tables / AFLDB)")
        for field, label in GROUP_FIELD_SPECS[group]:
            if field in target_fields and raw.get(field) not in (None, ""):
                add_line(label, raw[field])
        btn_row_b = tk.Frame(self.evidence_frame)
        btn_row_b.grid(row=r, column=0, columnspan=2, sticky="w", pady=(4, 0))
        r += 1
        afltables_url = links["afltables_url"]
        tk.Button(
            btn_row_b, text="Open AFL Tables page",
            command=lambda u=afltables_url: self._open_link(u, AFLTABLES_ALLOWED_HOSTS, "AFL Tables"),
        ).pack(side="left")
        tk.Button(
            btn_row_b, text="Copy AFL Tables URL", command=lambda u=afltables_url: self._copy_link(u),
        ).pack(side="left", padx=(6, 0))
        if links["afltables_href"]:
            add_line("Captured AFL Tables href", links["afltables_href"])
        add_line(
            "AFL Tables URL",
            afltables_url if afltables_url else f"(unavailable: {links['afltables_error']})",
            fg=None if afltables_url else "#8a1f11",
        )

        # Supporting comparison evidence -- everything else the pack carries for this row, plus
        # the machine-generated classification/recommendation, always clearly labelled as
        # evidence to weigh, never as a suggested answer to accept. Collapsed by default
        # (compaction fix, 2026-09-18) so the normal workflow (A, B, identity verdict,
        # club-relationship) is reachable without excessive scrolling; toggled independently of
        # the per-row content via _toggle_supporting_details / self._supporting_visible.
        self.supporting_toggle_button.config(
            text=(
                "▾ Hide details (supporting comparison evidence)" if self._supporting_visible
                else "▸ Show details (supporting comparison evidence)"
            )
        )
        if self._supporting_visible:
            self.supporting_frame.pack(fill="x", padx=8, pady=(0, 4))
            self.supporting_frame.grid_columnconfigure(1, weight=1)
            r = 0
            already_shown_fields = source_fields | target_fields | {
                "reason_codes", "draftguru_url", HREF_FIELD_BY_GROUP.get(group, ""),
            }
            for field, label in GROUP_FIELD_SPECS[group]:
                if field in already_shown_fields:
                    continue
                if raw.get(field) not in (None, ""):
                    add_line(label, raw[field], parent=self.supporting_frame)

            formerly = formerly_text(row)
            if formerly:
                add_line("v1 history", formerly, parent=self.supporting_frame, fg="#555555")

            if raw.get("reason_codes"):
                add_line("Reason codes", ", ".join(raw["reason_codes"]), parent=self.supporting_frame)

            add_line(
                "Machine classification", machine_classification_for(row) or "(none)",
                parent=self.supporting_frame,
            )

            rec = recommendation_text(row)
            if rec:
                add_line(
                    "MACHINE-GENERATED, NOT AN OPERATOR DECISION", rec,
                    parent=self.supporting_frame, fg="#8a1f11",
                )
        else:
            self.supporting_frame.pack_forget()

        # C. Verdict control for this group -- a read-only combobox of plain-English choices
        # that starts blank (PLACEHOLDER_VERDICT) rather than a radio-button group, so exactly
        # one legible value is ever shown and there is no ambiguous "all indicators look
        # filled" state. The stable stored code is shown in small text below the selection --
        # it, never the friendly label, is what is written to the checkpoint.
        friendly_labels = [VERDICT_FRIENDLY_LABELS[group][v] for v in spec["allowed_verdicts"]]
        self._suspend_trace = True
        self.verdict_combo.configure(values=[PLACEHOLDER_VERDICT, *friendly_labels])
        if existing_verdict and existing_verdict in spec["allowed_verdicts"]:
            self.verdict_combo.set(VERDICT_FRIENDLY_LABELS[group][existing_verdict])
            self.verdict_var.set(existing_verdict)
        else:
            self.verdict_combo.set(PLACEHOLDER_VERDICT)
            self.verdict_var.set("")
        self._suspend_trace = False
        self._update_verdict_status()

        self.identity_hint_var.set(
            "This includes being drafted or listed again by the same club."
            if group == "relisting" else ""
        )

        identity_notes_value = existing.get("operator_notes", "")
        self.notes_text.delete("1.0", "end")
        self.notes_text.insert("1.0", identity_notes_value)
        # Compact by default; expand only when notes are required or already contain text
        # (compaction fix, 2026-09-18) -- never a large empty text area for an optional field.
        self.notes_text.configure(
            height=(4 if (existing_verdict in REQUIRES_NOTES or identity_notes_value.strip()) else 1)
        )

        # D. Event-club appearance relationship -- derived fresh every render, never stored as
        # a preselection. Plain English first; the stable stored code is small supporting text.
        derived_relationship = derive_event_club_appearance_relationship(raw)
        relationship_message = event_club_appearance_message(raw, derived_relationship)
        self.club_obs_message_var.set(
            relationship_message or "No event-club comparison applies to this row."
        )
        self.club_obs_code_var.set(f"(stored code: {derived_relationship})")

        existing_club_obs = existing.get("event_club_observation") or ""
        ack_required = event_club_observation_required_for(row, existing_verdict)
        if existing_club_obs in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
            sentence = confirmed_observation_sentence(
                existing_club_obs, raw.get("event_club"), raw.get("event_year")
            )
            # "Saved acknowledgement:" (never "Confirmed:") -- a real operator session found
            # that "Confirmed" read as an endorsement of the value shown, when it only means
            # "this is what is currently persisted"; wording fix, 2026-09-18. This line is
            # driven ONLY by the checkpoint -- see the module docstring on
            # saved_acknowledgement_text / unsaved_change_text.
            self.club_ack_status_var.set(saved_acknowledgement_text(sentence))
            self.club_ack_status_label.config(fg="#0a6e1c")
        elif ack_required:
            self.club_ack_status_var.set(
                "Club-appearance acknowledgement: NOT YET CONFIRMED -- required before this row "
                "is complete"
            )
            self.club_ack_status_label.config(fg="#8a1f11")
        else:
            self.club_ack_status_var.set(
                "Club-appearance acknowledgement: not yet recorded (optional for this row)"
            )
            self.club_ack_status_label.config(fg="#555555")

        self.club_confirm_button.config(
            state=("normal" if derived_relationship != "not_applicable" else "disabled")
        )

        self._suspend_trace = True
        self.club_obs_combo.configure(
            values=[
                PLACEHOLDER_RELATIONSHIP,
                *[EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS[v] for v in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES],
            ]
        )
        if existing_club_obs in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES:
            self.club_obs_combo.set(EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS[existing_club_obs])
        else:
            self.club_obs_combo.set(PLACEHOLDER_RELATIONSHIP)
        self._suspend_trace = False

        club_notes_value = existing.get("event_club_observation_notes", "")
        self.club_obs_notes_text.delete("1.0", "end")
        self.club_obs_notes_text.insert("1.0", club_notes_value)
        self.club_obs_notes_text.configure(height=(3 if club_notes_value.strip() else 1))

        # Only auto-reveal the "choose different" panel to restore the operator's OWN prior
        # override (a stored observation that genuinely differs from the derived suggestion) --
        # never pre-opened for a fresh, blank row, and never because the row merely needs
        # acknowledgement.
        if existing_club_obs in EVENT_CLUB_APPEARANCE_RELATIONSHIP_VALUES and existing_club_obs != derived_relationship:
            self.club_choose_frame.pack(fill="x", padx=6, pady=(0, 6))
        else:
            self.club_choose_frame.pack_forget()

        # The combo/notes above now mirror the persisted state exactly (nothing pending yet on
        # a fresh render), so the live pending indicator always starts blank here.
        self._update_club_pending_status()

        self._update_nav_buttons()

    def _update_nav_buttons(self) -> None:
        state = nav_button_states(self.filtered_indices, self.cursor)
        self.prev_button.config(state=("normal" if state["prev_enabled"] else "disabled"))
        self.next_button.config(state=("normal" if state["next_enabled"] else "disabled"))
        self.nav_status_var.set(state["status"])

    # -- decision handling -------------------------------------------------------

    def _current_row(self) -> dict:
        return self.rows[self.cursor]

    def _update_verdict_status(self) -> None:
        group = self._current_row()["group"]
        code = self.verdict_var.get()
        if code:
            self.verdict_status_var.set(f"Selected: {VERDICT_FRIENDLY_LABELS[group][code]}")
            self.verdict_code_var.set(f"(stored value: {code})")
            self.verdict_status_label.config(fg="#0a6e1c")
        else:
            self.verdict_status_var.set("Selected: NONE -- choose one before continuing")
            self.verdict_code_var.set("")
            self.verdict_status_label.config(fg="#8a1f11")

    def _on_verdict_selected(self, _event=None) -> None:
        if self._suspend_trace:
            return
        selection = self.verdict_combo.get()
        if selection == PLACEHOLDER_VERDICT:
            self.verdict_var.set("")
            self._update_verdict_status()
            return
        group = self._current_row()["group"]
        code = VERDICT_CODE_BY_LABEL[group].get(selection)
        if code is None:
            return
        self.verdict_var.set(code)
        self._commit_decision()
        self._render_current_row()

    # -- event-club relationship: explicit confirm / choose-different workflow --------------
    #
    # Saved-vs-pending discipline (usability-defect fixes, 2026-09-18): a real operator session
    # found that a never-successfully-saved club-observation edit could end up looking
    # identical to a genuinely persisted one, and a follow-up session found "Confirmed" itself
    # misread as an endorsement. The rule enforced everywhere below is: the
    # "Saved acknowledgement:" line (club_ack_status_var, set only in _render_current_row) is
    # driven ONLY by self.checkpoint -- never by the live combo/notes widgets, and never
    # labelled "Confirmed". The live widgets instead drive a SEPARATE club_pending_status_var
    # line via club_observation_pending_state, and
    # nothing ever writes to self.checkpoint except _commit_club_observation, which only ever
    # runs after either an explicit, successful "Save observation" or "Confirm suggested
    # relationship" click.

    def _club_persisted(self, row: dict) -> tuple[str, str]:
        d = self.checkpoint.get("decisions", {}).get(row["row_id"], {})
        return d.get("event_club_observation") or "", d.get("event_club_observation_notes") or ""

    def _club_pending_selection(self) -> tuple[str, str]:
        selection_label = self.club_obs_combo.get()
        code = EVENT_CLUB_OBSERVATION_CODE_BY_LABEL.get(selection_label, "")
        notes = self.club_obs_notes_text.get("1.0", "end-1c")
        return code, notes

    def _club_pending_state(self) -> dict:
        row = self._current_row()
        persisted_code, persisted_notes = self._club_persisted(row)
        pending_code, pending_notes = self._club_pending_selection()
        derived = derive_event_club_appearance_relationship(row["raw"])
        return club_observation_pending_state(
            persisted_code, persisted_notes, pending_code, pending_notes, derived
        )

    def _update_club_pending_status(self) -> None:
        """Never labels or colours an unpersisted value as saved/confirmed -- see
        unsaved_change_text. Also autosizes the notes box so a genuinely in-progress edit is
        never hidden in a 1-line field."""
        state = self._club_pending_state()
        self.club_obs_notes_text.configure(
            height=(3 if self.club_obs_notes_text.get("1.0", "end-1c").strip() else 1)
        )
        if not state["has_pending"]:
            self.club_pending_status_var.set("")
            return
        pending_code, _ = self._club_pending_selection()
        label = EVENT_CLUB_OBSERVATION_FRIENDLY_LABELS.get(pending_code, pending_code)
        self.club_pending_status_var.set(unsaved_change_text(label, state["is_valid"], state["error"]))
        self.club_pending_status_label.config(fg=("#8a6d00" if state["is_valid"] else "#8a1f11"))

    def _confirm_suggested_observation(self) -> None:
        row = self._current_row()
        derived = derive_event_club_appearance_relationship(row["raw"])
        # Persists the derived value and, via the full re-render below, resets the combo/notes
        # from that same now-persisted value -- clearing any abandoned unsaved alternative
        # selection and its unsaved notes exactly as required.
        self._commit_club_observation(derived, notes="")
        self._render_current_row()

    def _show_choose_different(self) -> None:
        self.club_choose_frame.pack(fill="x", padx=6, pady=(0, 6))
        self._update_club_pending_status()

    def _save_chosen_observation(self) -> None:
        row = self._current_row()
        code, notes = self._club_pending_selection()
        if not code:
            messagebox.showerror("Event-club relationship", "Choose a relationship before saving.")
            return
        derived = derive_event_club_appearance_relationship(row["raw"])
        try:
            validate_event_club_observation(code, derived, notes)
        except ToolError as exc:
            messagebox.showerror("Event-club relationship", str(exc))
            self._update_club_pending_status()
            return
        self._commit_club_observation(code, notes=notes)
        self._render_current_row()

    def _discard_club_pending_edit(self) -> None:
        """Restores the combo/notes to the last persisted value WITHOUT touching the checkpoint
        -- deletes no previously saved verdict or acknowledgement, only abandons whatever is
        currently sitting unsaved in the controls."""
        self._render_current_row()

    def _commit_club_observation(self, selection: str, *, notes: str = "") -> None:
        row = self._current_row()
        decisions = self.checkpoint.setdefault("decisions", {})
        existing = decisions.setdefault(row["row_id"], {
            "group": row["group"], "row_ordinal_in_group": row["row_ordinal_in_group"],
            "global_order": row["global_order"], "draftguru_url": row["draftguru_url"],
            "operator_verdict": "", "operator_notes": "",
        })
        existing["event_club_observation"] = selection
        existing["event_club_observation_notes"] = notes
        existing["event_club_observation_decided_utc"] = utc_now()
        self._save()

    # -- evidence links: Open / Copy (human review only; never records a decision) ----------

    def _open_link(self, url: str | None, allowed_hosts: frozenset[str], label: str) -> None:
        result = open_evidence_url(url, allowed_hosts)
        if not result["ok"]:
            messagebox.showerror(
                f"Could not open {label} page",
                f"{result['error']}\n\nThis never affects your saved verdict or notes.",
            )

    def _copy_link(self, url: str | None) -> None:
        if not url:
            messagebox.showerror("Copy URL", "No valid URL is available to copy for this row.")
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(url)
        except Exception:  # pragma: no cover -- platform-dependent clipboard failures
            messagebox.showerror("Copy URL", "Could not access the clipboard on this system.")

    def _commit_notes(self) -> None:
        row = self._current_row()
        row_id = row["row_id"]
        decisions = self.checkpoint.setdefault("decisions", {})
        existing = decisions.get(row_id)
        notes = self.notes_text.get("1.0", "end-1c")
        if existing and existing.get("operator_verdict"):
            existing["operator_notes"] = notes
            self._save()

    def _commit_decision(self) -> None:
        row = self._current_row()
        group = row["group"]
        verdict = self.verdict_var.get()
        if not verdict:
            return
        notes = self.notes_text.get("1.0", "end-1c")
        try:
            validate_decision(group, verdict, notes)
        except ToolError:
            pass  # allowed while the operator is still typing notes; enforced again at finalise
        decisions = self.checkpoint.setdefault("decisions", {})
        decisions[row["row_id"]] = {
            "group": group,
            "row_ordinal_in_group": row["row_ordinal_in_group"],
            "global_order": row["global_order"],
            "draftguru_url": row["draftguru_url"],
            "operator_verdict": verdict,
            "operator_notes": notes,
            "decided_utc": utc_now(),
        }
        self._save()

    def _save(self) -> None:
        self.checkpoint = save_checkpoint(self.checkpoint_path, self.checkpoint)

    # -- bulk action -------------------------------------------------------------

    def _on_bulk_toggle(self) -> None:
        self.bulk_button.config(state=("normal" if self.bulk_enabled.get() else "disabled"))

    def _bulk_apply(self) -> None:
        if not self.bulk_enabled.get():
            return
        group = self._current_row()["group"]
        spec = SECTION_SPECS[group]
        positive_verdict = spec["positive_verdict"]

        targets = [
            self.rows[i] for i in self.filtered_indices
            if self.rows[i]["group"] == group and not has_valid_verdict(self.rows[i], self.checkpoint)
        ]
        if not targets:
            messagebox.showinfo("Bulk action", "No filtered incomplete rows in the current group.")
            return

        confirm = tk.Toplevel(self)
        confirm.title("Confirm bulk action")
        confirm.transient(self)
        confirm.grab_set()
        tk.Label(
            confirm,
            text=(
                f"This will apply verdict '{positive_verdict}' to {len(targets)} currently "
                f"filtered, undecided row(s) in group '{group}'.\n\n"
                "Type exactly: I have reviewed every row in this group\n"
                "to confirm you have individually reviewed each one."
            ),
            justify="left", wraplength=520,
        ).pack(padx=12, pady=12)
        entry = tk.Entry(confirm, width=50)
        entry.pack(padx=12, pady=(0, 6))
        apply_button = tk.Button(confirm, text="Apply", state="disabled")
        apply_button.pack(pady=(0, 12))

        required_phrase = "I have reviewed every row in this group"

        def on_key(_event=None) -> None:
            apply_button.config(state=("normal" if entry.get() == required_phrase else "disabled"))

        entry.bind("<KeyRelease>", on_key)

        def do_apply() -> None:
            now = utc_now()
            decisions = self.checkpoint.setdefault("decisions", {})
            applied_ids = []
            for target_row in targets:
                # Merge onto any existing entry (e.g. a club-observation acknowledgement
                # recorded before a verdict existed) rather than replacing it outright, so
                # bulk action never silently discards a value it did not itself decide.
                existing_entry = decisions.get(target_row["row_id"], {})
                decisions[target_row["row_id"]] = {
                    **existing_entry,
                    "group": group,
                    "row_ordinal_in_group": target_row["row_ordinal_in_group"],
                    "global_order": target_row["global_order"],
                    "draftguru_url": target_row["draftguru_url"],
                    "operator_verdict": positive_verdict,
                    "operator_notes": "",
                    "decided_utc": now,
                }
                applied_ids.append(target_row["row_id"])
            self.checkpoint.setdefault("bulk_actions_log", []).append({
                "utc": now,
                "operator_display_name": self.checkpoint.get("operator_display_name", ""),
                "group": group,
                "verdict": positive_verdict,
                "row_ids": applied_ids,
            })
            self._save()
            confirm.destroy()
            self._render_current_row()
            messagebox.showinfo("Bulk action", f"Applied '{positive_verdict}' to {len(applied_ids)} row(s).")

        apply_button.config(command=do_apply)
        confirm.bind("<Return>", lambda _e: do_apply() if entry.get() == required_phrase else None)

    # -- finalisation -------------------------------------------------------------

    def _finalize(self) -> None:
        can_leave, message = can_leave_row(self._club_pending_state())
        if not can_leave:
            messagebox.showerror("Unsaved change", message)
            self._focus_invalid_club_field()
            return
        self._commit_notes()
        if decided_count(self.pack_info, self.checkpoint) != EXPECTED_TOTAL_ROWS:
            messagebox.showerror(
                "Finalise",
                "Not every row has a valid, complete decision yet (including any required "
                "club-observation acknowledgement). Use the 'Needs club-observation "
                "acknowledgement' filter to find what remains.",
            )
            return
        if not messagebox.askyesno(
            "Finalise",
            "This writes the canonical operator-verdict JSON/CSV/Markdown artefacts. "
            "You confirm this reflects your final decisions on all 83 rows, including every "
            "required club-observation acknowledgement.\n\nProceed?",
        ):
            return
        try:
            result = finalize(self.pack_info["pack_path"], self.checkpoint, self.repo_root)
        except ToolError as exc:
            messagebox.showerror("Finalise failed", str(exc))
            return
        self.checkpoint = save_checkpoint(self.checkpoint_path, result["checkpoint"])
        messagebox.showinfo(
            "Finalise",
            f"Wrote:\n{result['paths']['json']}\n{result['paths']['csv']}\n{result['paths']['md']}\n\n"
            f"JSON sha256: {result['json_sha256']}",
        )
        self._render_current_row()

    # -- close handling -------------------------------------------------------------

    def _has_unsaved_notes(self) -> bool:
        """Identity (verdict) notes only -- these always auto-save on focus-out, unlike the
        club-observation notes, which are governed by _club_pending_state instead (see
        _attempt_leave_row / _on_close) so a validation-failed or never-saved club edit can
        never be silently written to the checkpoint."""
        row = self._current_row()
        existing = self.checkpoint.get("decisions", {}).get(row["row_id"], {})
        current_notes = self.notes_text.get("1.0", "end-1c")
        return current_notes != existing.get("operator_notes", "")

    def _on_close(self) -> None:
        can_leave, message = can_leave_row(self._club_pending_state())
        if not can_leave:
            messagebox.showerror("Unsaved change", message)
            self._focus_invalid_club_field()
            return
        if self._has_unsaved_notes():
            if not messagebox.askyesno(
                "Unsaved changes",
                "The current row's notes have not been saved yet. They will be saved before "
                "closing (nothing is ever discarded silently).\n\nSave and close now?",
            ):
                return
        self._commit_notes()
        self._save()
        release_lock(self.lock_path)
        self.destroy()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", default=None, help="override path to the adjudication pack JSON")
    parser.add_argument("--repo-root", default=None, help="override the repository root")
    parser.add_argument("--force-unlock", action="store_true",
                         help="remove a pre-existing review lock before starting")
    parser.add_argument("--validate-only", action="store_true",
                         help="run all startup validation and exit without opening the GUI, "
                              "acquiring a lock, or creating a checkpoint")
    parser.add_argument("--migrate-checkpoint-only", action="store_true",
                         help="load the checkpoint (migrating it to the current schema version "
                              "if needed, with a verified pre-migration backup), print a "
                              "summary, and exit -- never opens the GUI")
    parser.add_argument("--validate-final-output", action="store_true",
                         help="independently validate the already-finalised Phase 3 verdict "
                              "artefacts against the pinned operator-reported hashes and the "
                              "immutable source pack, print a PASS/REFUSED report, and exit -- "
                              "never opens the GUI, never acquires the review lock, never "
                              "touches the checkpoint, and never writes, regenerates or "
                              "repairs any file")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    repo_root = Path(args.repo_root).resolve() if args.repo_root else REPO_ROOT

    if args.validate_final_output:
        try:
            report = validate_final_output(repo_root)
        except ToolError as exc:
            print(f"REFUSED: {exc}", file=sys.stderr)
            return 2
        print_final_output_validation_report(report)
        return 0

    pack_path = Path(args.pack).resolve() if args.pack else (repo_root / DEFAULT_PACK_PATH)

    try:
        pack_info = load_and_validate_pack(pack_path, repo_root)
    except ToolError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2

    print(f"Pack OK: {repo_relative(pack_path, repo_root)}")
    print(f"  sha256: {pack_info['pack_sha256']}")
    print(f"  rows: {len(pack_info['rows'])} (44 relisting + 2 tokenisation + 7 discrepancy + 30 audit)")
    print(f"  hash-linked inputs verified: {len(pack_info['hash_checks'])}")

    if args.validate_only:
        return 0

    paths = checkpoint_paths(repo_root)
    lock_payload = acquire_lock(paths["lock"], force=args.force_unlock)
    try:
        try:
            checkpoint = load_or_migrate_checkpoint(paths, pack_info)
        except ToolError as exc:
            print(f"REFUSED: {exc}", file=sys.stderr)
            return 2

        if args.migrate_checkpoint_only:
            decided = decided_count(pack_info, checkpoint)
            print(f"Checkpoint schema_version: {checkpoint.get('schema_version')}")
            print(f"Decisions recorded: {len(checkpoint.get('decisions', {}))} / {EXPECTED_TOTAL_ROWS}")
            print(
                "Fully complete (identity verdict + any required club-observation "
                f"acknowledgement): {decided} / {EXPECTED_TOTAL_ROWS}"
            )
            return 0

        if not TK_AVAILABLE:
            print(
                "REFUSED: tkinter is not available in this Python environment; cannot open the "
                "GUI. Run --validate-only for a headless check, or use a Python build with Tcl/Tk.",
                file=sys.stderr,
            )
            return 3

        app = OperatorReviewApp(pack_info, checkpoint, paths["progress"], paths["lock"], repo_root)
        app.mainloop()
    finally:
        release_lock(paths["lock"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
