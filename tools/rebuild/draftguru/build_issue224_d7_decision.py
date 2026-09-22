#!/usr/bin/env python3
"""Emit the ISSUE-224 operator decision D-7 artefact (2026-09-22).

Operator decision D-7 re-decides the ISSUE-224 Phase 3 disposition for the 92
Category A players, **for the specific purpose of unblocking ISSUE-228 S9 and
for no other purpose**.

The 2026-09-19 Phase 3 verdict artefact

    docs/rebuild-manifests/draftguru/bridge-operator-verdicts-issue224-20260919-v1.json

recorded ``register = 0`` / ``defer_to_rollover = 92``. That artefact is
BYTE-BOUND: it is retained unchanged and this tool never reads it for mutation
nor writes to it. A re-decision is expressed as a NEW artefact with its own
``rows_sha256``, which is what this tool emits.

Every row-level decision here is derived mechanically from the retained target
set

    docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json

which is hash-verified (whole-file sha256 AND its own ``rows_sha256``) before a
single decision row is emitted. This tool therefore asserts nothing of its own
about identity: it records an operator authorisation over a hash-pinned
population.

**This artefact does NOT authorise a database write.** It records that the 92
are authorised registration CANDIDATES. Execution ordering is decision D-8 and
the AFL API acceptance-snapshot contract is decision D-9b; neither is resolved
here.

Deterministic: no wall-clock time, no network, no database, ASCII-escaped, LF
newlines. Re-running it on the same inputs reproduces the same bytes on any
host.

Usage:

    python tools/rebuild/draftguru/build_issue224_d7_decision.py \
      [--repo-root .] [--check]

``--check`` recomputes the artefact and compares it against what is on disk
without writing, exiting non-zero on any difference.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

# --- Byte-bound inputs -------------------------------------------------------
# The target set is the ONLY source of the 92-row population. Its expected
# hashes are pinned here so a drifted target set cannot silently re-author an
# operator decision.
TARGET_SET_REL = "docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json"
TARGET_SET_SHA256 = "e087baf706effdda8034a37cc184311687dee3c49f3e3e23a1e746beb347dcb0"
TARGET_SET_ROWS_SHA256 = "75bd9576ab3d33f19f2e148dffa22642c429a54b932f3e64ec87a9e6aa147f9c"

# Retained, superseded-for-one-purpose, byte-bound. Referenced, never rewritten.
PHASE3_VERDICTS_REL = (
    "docs/rebuild-manifests/draftguru/bridge-operator-verdicts-issue224-20260919-v1.json"
)

OUT_REL = "docs/rebuild-manifests/draftguru/issue224-d7-registration-decision-20260922.json"

EXPECTED_ROWS = 92

# Frozen, not wall-clock: the operator's decision date, so the artefact is
# byte-reproducible.
DECISION_DATE = "2026-09-22"


class Refusal(Exception):
    """A fail-closed refusal. Nothing is written."""


def refuse(message: str) -> Refusal:
    return Refusal(message)


def canonical_bytes(value: object) -> bytes:
    """The deterministic representation every rows_sha256 is taken over.

    Identical convention to build_issue224_s9_target_set.py:145-149, so the two
    artefacts' row hashes are directly comparable.
    """
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_target_set(repo_root: Path) -> dict:
    """Load the target set, refusing unless it is byte-identical to the pin."""
    path = repo_root / TARGET_SET_REL
    if not path.is_file():
        raise refuse(f"target set is absent: {TARGET_SET_REL}")

    actual = sha256_file(path)
    if actual != TARGET_SET_SHA256:
        raise refuse(
            f"target set sha256 mismatch: {TARGET_SET_REL}\n"
            f"  expected {TARGET_SET_SHA256}\n  measured {actual}"
        )

    artefact = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(artefact, dict):
        raise refuse("target set is not a JSON object")

    rows = artefact.get("rows")
    if not isinstance(rows, list) or len(rows) != EXPECTED_ROWS:
        raise refuse(
            f"target set must hold exactly {EXPECTED_ROWS} rows, "
            f"found {len(rows) if isinstance(rows, list) else 'none'}"
        )

    # The target set's own row hash, recomputed rather than trusted.
    declared = artefact.get("rows_sha256")
    recomputed = hashlib.sha256(canonical_bytes(rows)).hexdigest()
    if declared != recomputed:
        raise refuse(
            "target set rows_sha256 does not match its own rows:\n"
            f"  declared   {declared}\n  recomputed {recomputed}"
        )
    if recomputed != TARGET_SET_ROWS_SHA256:
        raise refuse(
            "target set rows_sha256 mismatch against the pin:\n"
            f"  expected {TARGET_SET_ROWS_SHA256}\n  measured {recomputed}"
        )

    return artefact


def build_decision_rows(target_rows: list[dict]) -> list[dict]:
    """One decision row per target-set row, mechanically derived.

    Nothing is inferred. Every field is copied from the hash-verified target
    set, and the decision itself is the operator's uniform D-7 authorisation
    over that whole population.
    """
    seen_providers: set[str] = set()
    seen_paths: set[str] = set()
    out: list[dict] = []

    for row in target_rows:
        provider = row.get("afl_api_provider_id")
        path = row.get("afltables_external_id")
        disposition = row.get("disposition")

        if not isinstance(provider, str) or not provider:
            raise refuse("target-set row has no afl_api_provider_id")
        if not isinstance(path, str) or not path:
            raise refuse(f"target-set row {provider} has no afltables_external_id")
        if disposition != "REGISTER":
            raise refuse(
                f"target-set row {provider} carries disposition {disposition!r}; "
                "D-7 authorises only rows the target set itself dispositioned REGISTER"
            )
        if provider in seen_providers:
            raise refuse(f"duplicate AFL API provider in target set: {provider}")
        if path in seen_paths:
            raise refuse(f"duplicate AFL Tables path in target set: {path}")
        seen_providers.add(provider)
        seen_paths.add(path)

        out.append(
            {
                "afl_api_provider_id": provider,
                "afltables_external_id": path,
                "agreement": row.get("agreement"),
                "competing_candidate_count": row.get("competing_candidate_count"),
                "decision": "REGISTER",
                "draftguru_player_url": row.get("draftguru_player_url"),
                "evidence_grade": row.get("evidence_grade"),
                "identity_withheld": False,
                "supersedes_2026_09_19_row_disposition": "defer_to_rollover",
            }
        )

    out.sort(key=lambda r: r["afl_api_provider_id"])
    return out


def build_artefact(repo_root: Path) -> dict:
    target = load_target_set(repo_root)
    target_rows = target["rows"]
    rows = build_decision_rows(target_rows)

    phase3_path = repo_root / PHASE3_VERDICTS_REL
    if not phase3_path.is_file():
        raise refuse(f"retained Phase 3 verdict artefact is absent: {PHASE3_VERDICTS_REL}")

    source = target.get("afl_api_source", {})
    counts = target.get("counts", {})

    artefact: dict = {
        "schema_version": 1,
        "kind": "issue224_operator_decision",
        "issue": "AFLDB-ISSUE-224",
        "decision": "D-7",
        "decision_title": (
            "Re-decide the ISSUE-224 Phase 3 disposition for the 92 Category A "
            "players, for the purpose of unblocking ISSUE-228 S9"
        ),
        "decision_date": DECISION_DATE,
        "decision_date_basis": (
            "frozen operator decision date, not a wall-clock time, so the artefact "
            "is byte-reproducible"
        ),
        "operator": "Stu",
        "verdict": "APPROVED",
        "disposition": {
            "register": EXPECTED_ROWS,
            "defer_to_rollover": 0,
            "identity_withheld": 0,
            "halt": 0,
        },
        "scope": {
            "supersedes": {
                "artefact": PHASE3_VERDICTS_REL,
                "artefact_sha256": sha256_file(phase3_path),
                "dated": "2026-09-19",
                "superseded_disposition": {"register": 0, "defer_to_rollover": 92},
                "superseded_for_purpose": "ISSUE-228 S9 unblocking",
                "superseded_for_any_other_purpose": False,
                "historical_artefact_retained_unchanged": True,
                "historical_artefact_rewritten": False,
                "note": (
                    "The 2026-09-19 Phase 3 verdict artefact is BYTE-BOUND. It remains "
                    "on disk unmodified and remains the authoritative historical record "
                    "of what was decided on 2026-09-19. This artefact does not rewrite "
                    "it, replace it, or invalidate it as evidence; it records a later, "
                    "narrower operator authorisation that overrides it only for the "
                    "ISSUE-228 S9 unblocking path."
                ),
            },
        },
        "population": {
            "target_set_path": TARGET_SET_REL,
            "target_set_sha256": TARGET_SET_SHA256,
            "target_set_rows_sha256": TARGET_SET_ROWS_SHA256,
            "rows": EXPECTED_ROWS,
            "unique_afl_api_providers": counts.get("unique_afl_api_providers"),
            "unique_afltables_paths": counts.get("unique_afltables_paths"),
            "unanimous": counts.get("unanimous"),
            "non_unanimous_single_candidate": counts.get(
                "non_unanimous_single_candidate"
            ),
            "ambiguous": counts.get("ambiguous"),
            "unmatched": counts.get("unmatched"),
            "competing_candidates": counts.get("competing_candidates"),
        },
        "identity_basis": {
            "evidence": "ESTABLISHED for 92 of 92",
            "name_based_candidate_discovery": False,
            "bijective_provider_to_afltables_profile_mapping": True,
            "surname_validation_is_validation_only": True,
            "surname_validation_measured": "89 of 92",
            "surname_validation_note": (
                "Corrected from an earlier 92/92 statement to the measured 89/92. This "
                "has NO identity consequence: candidate discovery is name-free and "
                "surname equality is a validation signal only, never a matching key. "
                "The correction is recorded so the artefact does not carry an "
                "overstated validation count."
            ),
        },
        "authorises": {
            "registration_candidates": EXPECTED_ROWS,
            "database_write": False,
            "player_registration_execution": False,
            "afltables_settle": False,
            "afl_api_bridge_rebuild": False,
            "afl_api_bridge_import": False,
            "afl_api_settle": False,
            "note": (
                "D-7 authorises the POPULATION only. No step of the D-8 sequence is "
                "authorised to run by this artefact, and none was run when it was "
                "written."
            ),
        },
        "not_owned_here": {
            "D-8": "DEV-only execution ordering (approved separately, sequence only)",
            "D-9b": (
                "which AFL API snapshot is authoritative for ISSUE-228 S9 acceptance"
            ),
        },
        "afl_api_source_context": {
            "note": (
                "Recorded for lineage only. This artefact takes NO position on the "
                "ISSUE-228 S9 acceptance-snapshot contract, which is decision D-9b. "
                "The label below is whichever snapshot the target-set builder actually "
                "read."
            ),
            "target_set_read_snapshot_label": source.get("snapshot_label"),
            "target_set_read_snapshot_manifest_sha256": source.get(
                "snapshot_manifest_sha256"
            ),
            "bridge_pinned_acceptance_snapshot": source.get(
                "acceptance_snapshot_pinned_by_bridge"
            ),
            "bridge_pinned_acceptance_snapshot_manifest_sha256": source.get(
                "acceptance_snapshot_manifest_sha256_pinned_by_bridge"
            ),
        },
        "database_access": "NOT_PERFORMED",
        "network_access": "NOT_PERFORMED",
        "read_only": True,
        "tool": {
            "path": "tools/rebuild/draftguru/build_issue224_d7_decision.py",
            "version": 1,
        },
        "rows": rows,
    }
    artefact["rows_sha256"] = hashlib.sha256(canonical_bytes(rows)).hexdigest()
    return artefact


def render(artefact: dict) -> str:
    return json.dumps(artefact, indent=2, sort_keys=True, ensure_ascii=True) + "\n"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument(
        "--check",
        action="store_true",
        help="recompute and compare against disk without writing",
    )
    args = parser.parse_args(argv)

    repo_root = args.repo_root.resolve()
    try:
        artefact = build_artefact(repo_root)
    except Refusal as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2

    payload = render(artefact)
    out_path = repo_root / OUT_REL

    if args.check:
        if not out_path.is_file():
            print(f"CHECK FAILED: absent: {OUT_REL}", file=sys.stderr)
            return 1
        with out_path.open("r", encoding="utf-8", newline="") as handle:
            on_disk = handle.read()
        if on_disk != payload:
            print(f"CHECK FAILED: on-disk bytes differ: {OUT_REL}", file=sys.stderr)
            return 1
        print(f"CHECK OK: {OUT_REL}")
    else:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # LF newlines unconditionally: the artefact's sha256 is quoted in the
        # issue records, so it must not depend on the host's line-ending
        # translation. Matches build_issue224_s9_target_set.py's convention.
        with out_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
        print(f"wrote {OUT_REL}")

    print(f"  rows        : {len(artefact['rows'])}")
    print(f"  rows_sha256 : {artefact['rows_sha256']}")
    print(f"  sha256      : {hashlib.sha256(payload.encode('utf-8')).hexdigest()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
