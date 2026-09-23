#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import os
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))

import review_person_bridge_offline as base
import build_person_bridge_v2 as v2


TOOL = "tools/rebuild/draftguru/build_person_bridge_v3_issue224.py"
TOOL_VERSION = "1.0.0"

PARENT_V2_REL = (
    "data/reference/"
    "draftguru-person-bridge-20260918-v2.json"
)

DECISIONS_REL = (
    "docs/rebuild-manifests/draftguru/"
    "bridge-operator-verdicts-issue224-20260919-v1.json"
)

PARENT_V3_REL = (
    "data/reference/"
    "draftguru-person-bridge-20260918-v3.json"
)

RECON_REL = (
    "docs/rebuild-manifests/draftguru/"
    "bridge-v3-reconciliation-issue224-20260919-v1.json"
)

DIFF_REL = (
    "docs/rebuild-manifests/draftguru/"
    "bridge-v3-diff-issue224-20260919-v1.csv"
)


EXPECT_PARENT_V2_SHA256 = (
    "ad25d965cba72b97be895451dc488bf03a1899421e902394baa52a620abe8e57"
)

EXPECT_PARENT_V2_ROWS_SHA256 = (
    "ce7816f7905f8a758761676ce50f2673055cc0be9c5174d004fdee7931327e7f"
)

EXPECT_DECISIONS_SHA256 = (
    "3c7b5aff6649047ef0a727feffe4303ac7ea618a6cba3ca4f32b718636875038"
)

EXPECT_DECISION_ROWS_SHA256 = (
    "1fc8ff220c2f655a5003f852e33c59c6ab8e7c6cfa8445ba01746fd57b912211"
)

EXPECT_PARENT_V3_ROWS_SHA256 = (
    "2d0b36b8f41105a7d13a383af613158f40124fdf70a7405a04bc9db4da6fa249"
)


CORRECTIONS = {
    "https://www.draftguru.com.au/players/dean_laidley/1": {
        "old": "players/D/Dean_Laidley.html",
        "new": "players/D/Dani_Laidley.html",
        "player_id_evidence": 3208,
    },

    "https://www.draftguru.com.au/players/matthew_capuano/1": {
        "old": "players/M/Matthew_Capuano.html",
        "new": "players/M/Mathew_Capuano.html",
        "player_id_evidence": 9198,
    },
}


class BuildError(RuntimeError):
    pass


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(doc):
    return (
        json.dumps(
            doc,
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    ).encode("utf-8")


def csv_bytes(rows):
    fields = [
        "player_url",
        "v2_afltables_external_id",
        "v3_afltables_external_id",
        "operator_decision",
        "player_id_evidence",
    ]

    stream = io.StringIO(
        newline=""
    )

    writer = csv.DictWriter(
        stream,
        fieldnames=fields,
        lineterminator="\n",
    )

    writer.writeheader()
    writer.writerows(rows)

    return stream.getvalue().encode(
        "utf-8"
    )


def canonical_parent_rows_sha(doc):
    return base.sha256_bytes(
        base.canonical_json_bytes(
            {
                "bridges":
                    doc["bridges"],

                "withheld":
                    doc["withheld"],
            }
        )
    )


def canonical_rows_sha(rows):
    return base.sha256_bytes(
        base.canonical_json_bytes(
            rows
        )
    )


def write_immutable(path, data):
    digest = sha256_bytes(data)

    if path.exists():
        existing = path.read_bytes()

        if existing != data:
            raise BuildError(
                "refusing to overwrite existing "
                f"non-identical artefact: {path}"
            )

        return digest

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp = path.with_name(
        path.name + ".tmp"
    )

    if temp.exists():
        temp.unlink()

    temp.write_bytes(data)

    os.replace(
        temp,
        path,
    )

    return digest


def build(root):

    parent_path = (
        root / PARENT_V2_REL
    )

    decisions_path = (
        root / DECISIONS_REL
    )


    # --------------------------------------------------------
    # Immutable input verification
    # --------------------------------------------------------

    parent_sha = base.sha256_file(
        parent_path
    )

    if (
        parent_sha
        != EXPECT_PARENT_V2_SHA256
    ):
        raise BuildError(
            "v2 parent sha256 mismatch: "
            f"{parent_sha}"
        )


    decisions_sha = base.sha256_file(
        decisions_path
    )

    if (
        decisions_sha
        != EXPECT_DECISIONS_SHA256
    ):
        raise BuildError(
            "Phase 3 file sha256 mismatch: "
            f"{decisions_sha}"
        )


    parent = base.load_json(
        parent_path,
        "ISSUE-224 v2 parent",
    )

    decisions = base.load_json(
        decisions_path,
        "ISSUE-224 Phase 3 decisions",
    )


    if (
        parent.get("rows_sha256")
        != EXPECT_PARENT_V2_ROWS_SHA256
    ):
        raise BuildError(
            "v2 parent recorded "
            "rows_sha256 mismatch"
        )


    if (
        canonical_parent_rows_sha(parent)
        != EXPECT_PARENT_V2_ROWS_SHA256
    ):
        raise BuildError(
            "v2 parent canonical "
            "rows_sha256 does not reproduce"
        )


    rows = decisions.get(
        "rows"
    )

    if (
        not isinstance(rows, list)
        or len(rows) != 94
    ):
        raise BuildError(
            "Phase 3 must contain "
            "exactly 94 rows"
        )


    if (
        decisions.get("rows_sha256")
        != EXPECT_DECISION_ROWS_SHA256
    ):
        raise BuildError(
            "Phase 3 recorded "
            "rows_sha256 mismatch"
        )


    if (
        canonical_rows_sha(rows)
        != EXPECT_DECISION_ROWS_SHA256
    ):
        raise BuildError(
            "Phase 3 canonical "
            "rows_sha256 does not reproduce"
        )


    if (
        decisions.get(
            "completion_status"
        )
        != "complete"
    ):
        raise BuildError(
            "Phase 3 decisions "
            "are not complete"
        )


    frozen_utc = decisions.get(
        "review_completed_utc"
    )

    if (
        not isinstance(
            frozen_utc,
            str,
        )
        or not frozen_utc
    ):
        raise BuildError(
            "Phase 3 has no "
            "review_completed_utc"
        )


    deferred = [
        row
        for row in rows
        if row.get(
            "operator_decision"
        )
        == "defer-to-rollover"
    ]


    approved = {
        row["player_url"]: row
        for row in rows
        if row.get(
            "operator_decision"
        )
        == "route-to-parent-evidence-correction"
    }


    if len(deferred) != 92:
        raise BuildError(
            "expected 92 "
            "defer-to-rollover decisions"
        )


    if set(approved) != set(
        CORRECTIONS
    ):
        raise BuildError(
            "Phase 3 correction set "
            "is not exactly the two "
            "approved Category B rows"
        )


    # --------------------------------------------------------
    # Build v3 entirely in memory
    # --------------------------------------------------------

    proposed = copy.deepcopy(
        parent
    )


    by_url = {
        row["player_url"]: row
        for row in proposed["bridges"]
    }


    if (
        len(by_url)
        != len(proposed["bridges"])
    ):
        raise BuildError(
            "duplicate player_url in "
            "v2 parent"
        )


    target_owner = {
        row["afltables_external_id"]:
            row["player_url"]
        for row in proposed["bridges"]
    }


    if (
        len(target_owner)
        != len(proposed["bridges"])
    ):
        raise BuildError(
            "duplicate AFL Tables target "
            "in v2 parent"
        )


    diff_rows = []


    for url, correction in (
        CORRECTIONS.items()
    ):

        if url not in by_url:
            raise BuildError(
                "required correction row "
                f"missing from parent: {url}"
            )


        decision = approved[url]

        evidence = (
            decision.get(
                "evidence_reference"
            )
            or {}
        )


        old_target = correction[
            "old"
        ]

        new_target = correction[
            "new"
        ]

        player_id = correction[
            "player_id_evidence"
        ]


        if (
            by_url[url][
                "afltables_external_id"
            ]
            != old_target
        ):
            raise BuildError(
                f"{url}: current target "
                "does not equal expected "
                f"{old_target}"
            )


        if (
            decision.get(
                "afltables_external_id"
            )
            != old_target
        ):
            raise BuildError(
                f"{url}: Phase 3 "
                "captured target mismatch"
            )


        if (
            evidence.get(
                "registered_path_evidence"
            )
            != new_target
        ):
            raise BuildError(
                f"{url}: Phase 3 "
                "corrected target mismatch"
            )


        if (
            evidence.get(
                "player_id_evidence"
            )
            != player_id
        ):
            raise BuildError(
                f"{url}: player_id "
                "evidence mismatch"
            )


        owner = target_owner.get(
            new_target
        )

        if (
            owner is not None
            and owner != url
        ):
            raise BuildError(
                f"{new_target} is already "
                f"bridged by {owner}"
            )


        by_url[url][
            "afltables_external_id"
        ] = new_target


        diff_rows.append(
            {
                "player_url":
                    url,

                "v2_afltables_external_id":
                    old_target,

                "v3_afltables_external_id":
                    new_target,

                "operator_decision":
                    "route-to-parent-evidence-correction",

                "player_id_evidence":
                    player_id,
            }
        )


    # --------------------------------------------------------
    # Prove there are exactly two bridge changes
    # --------------------------------------------------------

    old_by_url = {
        row["player_url"]:
            row["afltables_external_id"]
        for row in parent["bridges"]
    }


    new_by_url = {
        row["player_url"]:
            row["afltables_external_id"]
        for row in proposed["bridges"]
    }


    observed = sorted(
        (
            url,
            old_by_url[url],
            new_by_url[url],
        )
        for url in old_by_url
        if (
            old_by_url[url]
            != new_by_url[url]
        )
    )


    expected = sorted(
        (
            url,
            correction["old"],
            correction["new"],
        )
        for (
            url,
            correction,
        ) in CORRECTIONS.items()
    )


    if observed != expected:
        raise BuildError(
            "unexpected bridge delta set: "
            f"{observed}"
        )


    if (
        proposed["withheld"]
        != parent["withheld"]
    ):
        raise BuildError(
            "withheld[] changed; "
            "Phase 4 forbids this"
        )


    if (
        len(proposed["bridges"])
        != 3562
        or len(proposed["withheld"])
        != 1495
    ):
        raise BuildError(
            "population counts changed"
        )


    # --------------------------------------------------------
    # Versioned v3 metadata
    # --------------------------------------------------------

    proposed["$comment"] = (
        "AFLDB-ISSUE-224 bridge v3 "
        "source-evidence parent. "
        "Supersedes the immutable "
        "ISSUE-222 v2 parent and applies "
        "exactly two operator-approved "
        "parent-evidence corrections: "
        "Dean Laidley and Matthew Capuano. "
        "No deployment-target resolution "
        "is encoded here."
    )


    proposed["exporter"] = TOOL

    proposed[
        "exporter_version"
    ] = TOOL_VERSION


    proposed[
        "generated_utc"
    ] = frozen_utc


    proposed[
        "generated_utc_basis"
    ] = (
        "frozen to the ISSUE-224 "
        "Phase 3 operator decision "
        "artefact's review_completed_utc "
        "so this versioned artefact is "
        "byte-reproducible; it is not "
        "a wall-clock generation time"
    )


    proposed["supersedes"] = {
        "path":
            PARENT_V2_REL,

        "sha256":
            EXPECT_PARENT_V2_SHA256,
    }


    provenance = dict(
        proposed.get(
            "provenance"
        )
        or {}
    )


    provenance.update(
        {
            "v3_generator":
                TOOL,

            "v3_generator_version":
                TOOL_VERSION,

            "v3_operator_decisions_path":
                DECISIONS_REL,

            "v3_operator_decisions_sha256":
                EXPECT_DECISIONS_SHA256,

            "v3_operator_decisions_rows_sha256":
                EXPECT_DECISION_ROWS_SHA256,
        }
    )


    proposed[
        "provenance"
    ] = provenance


    diff_rows.sort(
        key=lambda row:
            row["player_url"]
    )


    proposed[
        "issue224_parent_correction"
    ] = {
        "issue":
            "AFLDB-ISSUE-224",

        "operator_display_name":
            decisions.get(
                "operator_display_name"
            ),

        "decided_utc":
            frozen_utc,

        "source": {
            "path":
                DECISIONS_REL,

            "sha256":
                EXPECT_DECISIONS_SHA256,

            "rows_sha256":
                EXPECT_DECISION_ROWS_SHA256,
        },

        "actions_by_type": {
            "corrected": 2,
            "unchanged": 3560,
            "withheld_unchanged": 1495,
        },

        "affected_rows": [
            {
                "action":
                    "corrected",

                "draftguru_url":
                    row["player_url"],

                "operator_decision":
                    row["operator_decision"],

                "player_id_evidence":
                    row["player_id_evidence"],

                "v2_afltables_external_id":
                    row[
                        "v2_afltables_external_id"
                    ],

                "v3_afltables_external_id":
                    row[
                        "v3_afltables_external_id"
                    ],
            }
            for row in diff_rows
        ],
    }


    proposed[
        "rows_sha256"
    ] = canonical_parent_rows_sha(
        proposed
    )


    if (
        proposed["rows_sha256"]
        != EXPECT_PARENT_V3_ROWS_SHA256
    ):
        raise BuildError(
            "v3 rows_sha256 mismatch: "
            f"{proposed['rows_sha256']}"
        )


    # Existing offline repository validator.
    v2.self_validate_bridge_schema(
        proposed,
        v2.load_canonical_url_regex(
            root
        ),
    )


    # --------------------------------------------------------
    # Deterministic outputs
    # --------------------------------------------------------

    parent_data = json_bytes(
        proposed
    )

    diff_data = csv_bytes(
        diff_rows
    )


    parent_v3_sha = (
        sha256_bytes(
            parent_data
        )
    )


    diff_sha = sha256_bytes(
        diff_data
    )


    reconciliation = {
        "schema_version": 1,

        "issue":
            "AFLDB-ISSUE-224",

        "label":
            "20260919-v1",

        "tool": {
            "path":
                TOOL,

            "version":
                TOOL_VERSION,
        },

        "generated_utc":
            frozen_utc,

        "generated_utc_basis":
            (
                "frozen to the ISSUE-224 "
                "Phase 3 operator decision "
                "artefact's review_completed_utc; "
                "not a wall-clock generation time"
            ),

        "parent_v2": {
            "path":
                PARENT_V2_REL,

            "sha256":
                EXPECT_PARENT_V2_SHA256,

            "rows_sha256":
                EXPECT_PARENT_V2_ROWS_SHA256,
        },

        "phase3_decisions": {
            "path":
                DECISIONS_REL,

            "sha256":
                EXPECT_DECISIONS_SHA256,

            "rows_sha256":
                EXPECT_DECISION_ROWS_SHA256,
        },

        "parent_v3": {
            "path":
                PARENT_V3_REL,

            "sha256":
                parent_v3_sha,

            "rows_sha256":
                proposed[
                    "rows_sha256"
                ],
        },

        "diff_report": {
            "path":
                DIFF_REL,

            "sha256":
                diff_sha,

            "changed_rows":
                2,
        },

        "counts": {
            "bridges":
                len(
                    proposed["bridges"]
                ),

            "withheld":
                len(
                    proposed["withheld"]
                ),

            "population":
                (
                    len(
                        proposed["bridges"]
                    )
                    + len(
                        proposed["withheld"]
                    )
                ),

            "changed_bridges":
                2,

            "unchanged_bridges":
                3560,

            "changed_withheld":
                0,
        },

        "changed_rows":
            diff_rows,

        "invariants": {
            "only_phase3_named_bridges_changed":
                "PASS",

            "withheld_content_unchanged":
                "PASS",

            "bridge_count_unchanged":
                "PASS",

            "withheld_count_unchanged":
                "PASS",

            "population_partition_unchanged":
                "PASS",

            "schema_validation":
                "PASS",

            "database_access":
                "NOT_PERFORMED",

            "network_access":
                "NOT_PERFORMED",
        },
    }


    reconciliation[
        "rows_sha256"
    ] = canonical_rows_sha(
        diff_rows
    )


    reconciliation_data = json_bytes(
        reconciliation
    )


    hashes = {
        "parent_v3_sha256":
            parent_v3_sha,

        "parent_v3_rows_sha256":
            proposed[
                "rows_sha256"
            ],

        "diff_sha256":
            diff_sha,

        "diff_rows_sha256":
            reconciliation[
                "rows_sha256"
            ],

        "reconciliation_sha256":
            sha256_bytes(
                reconciliation_data
            ),
    }


    outputs = {
        PARENT_V3_REL:
            parent_data,

        RECON_REL:
            reconciliation_data,

        DIFF_REL:
            diff_data,
    }


    return (
        proposed,
        diff_rows,
        hashes,
        outputs,
    )


def main():

    parser = argparse.ArgumentParser(
        description=(
            "AFLDB-ISSUE-224 "
            "deterministic DB-free "
            "v2 -> v3 parent correction"
        )
    )


    mode = (
        parser
        .add_mutually_exclusive_group(
            required=True
        )
    )


    mode.add_argument(
        "--validate-only",
        action="store_true",
    )


    mode.add_argument(
        "--write",
        action="store_true",
    )


    parser.add_argument(
        "--root",
        default=str(
            REPO_ROOT
        ),
    )


    args = parser.parse_args()

    root = Path(
        args.root
    ).resolve()


    before_parent = (
        base.sha256_file(
            root / PARENT_V2_REL
        )
    )


    before_decisions = (
        base.sha256_file(
            root / DECISIONS_REL
        )
    )


    (
        proposed,
        diff_rows,
        hashes,
        outputs,
    ) = build(root)


    print(
        "AFLDB-ISSUE-224 PHASE 4 V3"
    )

    print(
        "--------------------------"
    )

    print(
        "mode                      : "
        + (
            "WRITE"
            if args.write
            else "VALIDATE ONLY"
        )
    )

    print(
        "v2 parent sha256          : "
        + EXPECT_PARENT_V2_SHA256
    )

    print(
        "Phase 3 decisions sha256  : "
        + EXPECT_DECISIONS_SHA256
    )

    print(
        "v3 rows_sha256            : "
        + hashes[
            "parent_v3_rows_sha256"
        ]
    )

    print(
        "v3 predicted file sha256  : "
        + hashes[
            "parent_v3_sha256"
        ]
    )

    print(
        "bridges                   : "
        + str(
            len(
                proposed["bridges"]
            )
        )
    )

    print(
        "withheld                  : "
        + str(
            len(
                proposed["withheld"]
            )
        )
    )

    print(
        "changed bridges           : "
        + str(
            len(diff_rows)
        )
    )

    print()


    for row in diff_rows:
        print(
            row["player_url"]
        )

        print(
            "  - "
            + row[
                "v2_afltables_external_id"
            ]
        )

        print(
            "  + "
            + row[
                "v3_afltables_external_id"
            ]
        )


    if args.write:

        print()

        for (
            rel,
            data,
        ) in outputs.items():

            digest = (
                write_immutable(
                    root / rel,
                    data,
                )
            )

            print(
                "WROTE "
                + rel
            )

            print(
                "  sha256: "
                + digest
            )


    after_parent = (
        base.sha256_file(
            root / PARENT_V2_REL
        )
    )


    after_decisions = (
        base.sha256_file(
            root / DECISIONS_REL
        )
    )


    if (
        before_parent
        != after_parent
    ):
        raise BuildError(
            "immutable v2 parent "
            "changed during run"
        )


    if (
        before_decisions
        != after_decisions
    ):
        raise BuildError(
            "immutable Phase 3 "
            "decision artefact changed "
            "during run"
        )


    print()

    if args.write:
        print(
            "PHASE 4 WRITE PASS"
        )
    else:
        print(
            "PHASE 4 VALIDATION PASS "
            "- no v3 artefacts written"
        )


    print(
        "No database or network "
        "access was used."
    )


    return 0


if __name__ == "__main__":

    try:
        raise SystemExit(
            main()
        )

    except BuildError as exc:

        print(
            f"HALT: {exc}",
            file=sys.stderr,
        )

        raise SystemExit(1)
