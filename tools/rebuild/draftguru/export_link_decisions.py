#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B2-3 — export the explicit human/admin link decisions to a ledger.

READ-ONLY against PostgreSQL. The only thing this writes is one tracked JSON file on the
local filesystem; **no SQL statement here is anything but SELECT**, and the transaction is
always rolled back.

What this is for
----------------
Six explicit human/admin decisions live in `player_link_resolutions`, keyed by
`draft_picks.id` — a surrogate that a fresh rebuild regenerates. They therefore cannot
survive a rebuild as stored. This exporter converts them, once, into a natural-key ledger
keyed by the durable DraftGuru `player_url`.

**This is a controlled natural-key export, deliberately different from the aggregate-only
egress boundary every other Stage B2 runner obeys** (B2 handoff §16). It emits `player_url`
values and AFL Tables profile paths into a tracked file, because that is the entire point.
It emits **nothing else**: no surrogate id, no DOB, no weight, no birth-year bounds, no admin
note, no height, no admin identity, and no Stage A display payload. Terminal output stays
aggregate — counts and the output path only.

Decision → target classification
--------------------------------
`confirmed_unlinked` → `target: null`; creates no canonical player.

`linked` is classified by the **rebuild's own player-existence rule**, not by this database's
registration state (`import_fitzroy_core.py:711-716` builds `players` only from fitzRoy
`player_stats` rows and fails closed without an ID/profile URL):

  * the target player **has senior games**  → it will be created by the fitzRoy import and
    will necessarily hold an `afltables_profile_url` identity → `source: "afltables"`;
  * the target player has **zero senior games** → the fitzRoy import will never create it →
    `source: "draftguru"`, `external_id` = the decision's own canonical `player_url`, which
    the importer may mint as the approved minimal zero-game player shell.

Known admissibility boundary
----------------------------
Of the three `afltables` targets, `afldb_dev` currently registers a stable identity for only
two; the third is one of the 889 played-but-unregistered players (B2 handoff §38). Its AFL
Tables path is observable in the accepted Stage B1 snapshot, but §21 admits that snapshot as a
**profiling / validation oracle only**, never an import source. So by default this exporter
**fails closed** on it rather than quietly authoring durable state from an inadmissible
source. `--admit-b1-bridge-identity` is the explicit, reviewed opt-in; when used, the affected
decision carries `identity_evidence: "stage_b1_person_page_bridge"` so the ledger itself
records that one entry came from the oracle rather than from `external_identities`.

Safety envelope — identical to every other Stage B2 runner: `AFLDB_OWNER_DATABASE_URL` parsed
out of `.env` (never sourced, never printed); DSN path hard-guarded to `/afldb_dev`; the
preserved pre-rebuild database refused by name; `default_transaction_read_only=on` at connect;
`REPEATABLE READ` read-only; in-session verification of database / user / read-only /
isolation; SELECT only; explicit `ROLLBACK` and a safe close on success and failure alike.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]

REQUIRED_DB = "afldb_dev"
REQUIRED_PATH = f"/{REQUIRED_DB}"
REFUSED_SUBSTRINGS = ("afldb_test_pre_rebuild",)
ENV_KEY = "AFLDB_OWNER_DATABASE_URL"

LEDGER_PATH = REPO_ROOT / "data" / "reference" / "draftguru-link-decisions.json"
SCHEMA_VERSION = 1

# Settled canonical forms. Identity is byte-exact; percent-encoding is never decoded.
PLAYER_URL_RE = re.compile(r"^https://www\.draftguru\.com\.au/players/[^/]+/[1-9][0-9]*$")
AFLTABLES_PATH_RE = re.compile(r"^players/[A-Za-z]/[^/]+\.html$")

EXPECTED_DECISIONS = 6
EXPECTED_DISTRIBUTION = {"afltables": 3, "draftguru": 2, None: 1}

B1_LABEL = "person-html-20260826"
B1_MANIFEST = REPO_ROOT / "docs" / "rebuild-manifests" / "draftguru" / f"{B1_LABEL}.json"
# Pinned so the chain of custody starts in tracked code, not in a file on disk that could
# have been edited: code -> manifest -> parsed output.
B1_MANIFEST_SHA256 = "bca69a59b1492ae81c180119789bf2fd751e3888945fa325f51955b0b1bf43a7"
B1_EXPECTED_RECORDS = 120

# Exactly one decision is approved for promotion from the Stage B1 oracle.
EXPECTED_PROMOTIONS = 1


# The operative decision per decided pick, normalised to its person — mirroring
# import_draft.py read_decisions(): the audit trail is append-only, so the newest
# row for a target is the decision that stands.
DECISIONS_SQL = """
WITH operative AS (
  SELECT DISTINCT ON (r.target_id)
         r.target_id, r.action, r.player_id, p.player_url
  FROM player_link_resolutions r
  JOIN draft_picks k ON k.id = r.target_id
  JOIN sources s ON s.id = k.source_id AND s.key = 'draftguru'
  LEFT JOIN draft_persons p ON p.id = k.draft_person_id
  WHERE r.target_table = 'draft_picks'
  ORDER BY r.target_id, r.created_at DESC, r.id DESC
)
SELECT o.player_url,
       o.action,
       EXISTS (SELECT 1 FROM player_match_stats pms
               WHERE pms.player_id = o.player_id)              AS has_senior_games,
       (SELECT ei.external_id
          FROM external_identities ei
          JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
         WHERE ei.player_id = o.player_id
           AND ei.match_method = 'afltables_profile_url'
           AND ei.status IN ('unique','resolved')
         ORDER BY ei.external_id
         LIMIT 1)                                              AS afltables_external_id,
       (SELECT count(*)
          FROM external_identities ei
          JOIN sources es ON es.id = ei.source_id AND es.key = 'afltables'
         WHERE ei.player_id = o.player_id
           AND ei.match_method = 'afltables_profile_url'
           AND ei.status IN ('unique','resolved'))             AS afltables_identity_count
FROM operative o
ORDER BY o.player_url
"""

Q_RAW_COUNT = """
SELECT count(*) AS audit_rows
FROM player_link_resolutions r
JOIN draft_picks k ON k.id = r.target_id
JOIN sources s ON s.id = k.source_id AND s.key = 'draftguru'
WHERE r.target_table = 'draft_picks'
"""


def read_dsn() -> str:
    """Parse the owner DSN out of .env. The file is never sourced and never printed."""
    env_path = REPO_ROOT / ".env"
    if not env_path.is_file():
        raise SystemExit(f"REFUSED: {env_path} not found")
    for raw in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if line.startswith(f"{ENV_KEY}="):
            dsn = line[len(ENV_KEY) + 1:].strip().strip('"').strip("'")
            break
    else:
        raise SystemExit(f"REFUSED: {ENV_KEY} is not set in .env")
    parsed = urlparse(dsn)
    if parsed.path != REQUIRED_PATH:
        raise SystemExit(f"REFUSED: {ENV_KEY} does not target {REQUIRED_PATH}")
    if any(bad in dsn for bad in REFUSED_SUBSTRINGS):
        raise SystemExit("REFUSED: DSN names a preserved pre-rebuild database")
    return dsn


def load_b1_bridges() -> dict[str, str]:
    """player_url -> observed AFL Tables path, from the ACCEPTED Stage B1 snapshot.

    The promotion this feeds is a one-entry reviewed exception, so the evidence must be
    provably the accepted snapshot and not an arbitrary local page. The chain of custody is
    pinned in code and verified end to end:

        pinned sha256 -> tracked manifest -> manifest's own sha256 for parsed output
                      -> parsed/person_profile.jsonl

    Only records that satisfy the full §14 admissibility contract contribute a bridge, and an
    AFL Tables identity claimed by more than one DraftGuru person anywhere in the 120-person
    sample is dropped as a collision rather than chosen between.
    """
    if not B1_MANIFEST.is_file():
        raise SystemExit(f"REFUSED: --admit-b1-bridge-identity needs {B1_MANIFEST}, "
                         "which is absent")
    manifest_bytes = B1_MANIFEST.read_bytes()
    actual = hashlib.sha256(manifest_bytes).hexdigest()
    if actual != B1_MANIFEST_SHA256:
        raise SystemExit("REFUSED: the Stage B1 manifest does not match its pinned sha256 — "
                         "the evidence is not the accepted snapshot")
    manifest = json.loads(manifest_bytes.decode("utf-8"))

    if manifest.get("snapshot_label") != B1_LABEL:
        raise SystemExit("REFUSED: the Stage B1 manifest names a different snapshot label")
    if manifest.get("immutable") is not True:
        raise SystemExit("REFUSED: the Stage B1 manifest is not declared immutable")
    # Deliberate: this promotion does NOT reclassify Stage B1. If these ever read true, the
    # snapshot's contract has changed and this reviewed exception must be re-reviewed.
    if manifest.get("identity_complete") is not False or manifest.get("import_capable") is not False:
        raise SystemExit("REFUSED: the Stage B1 manifest no longer declares "
                         "identity_complete=false / import_capable=false — the one-entry "
                         "promotion was reviewed against a profiling-only snapshot")

    declared = manifest.get("parsed_outputs", {}).get("person_profile", {})
    path = REPO_ROOT / "data" / "sources" / "draftguru" / B1_LABEL / declared.get("path", "")
    if not path.is_file():
        raise SystemExit(f"REFUSED: the manifest's parsed output {path} is absent")
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != declared.get("sha256"):
        raise SystemExit("REFUSED: parsed/person_profile.jsonl does not match the sha256 the "
                         "accepted manifest declares — it is not the accepted evidence")

    records = [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]
    if len(records) != declared.get("records") or len(records) != B1_EXPECTED_RECORDS:
        raise SystemExit("REFUSED: the Stage B1 profile record count does not match the "
                         "accepted manifest")

    # Full §14 admissibility, per record. Anything short of it contributes no bridge.
    admissible: dict[str, str] = {}
    for record in records:
        identity = record.get("afltables_identity")
        if not identity:
            continue
        if record.get("terminal_classification") != "fetched" or record.get("http_status") != 200:
            continue
        if record.get("profiled") is not True:
            continue
        if record.get("distinct_afltables_identity_count") != 1:
            continue                      # multiple-candidate ambiguity is never resolved here
        if any(record.get("flags", {}).values()):
            continue                      # any finding at all disqualifies the record
        if not AFLTABLES_PATH_RE.match(identity):
            continue
        href = next((h for h in record.get("afltables_hrefs", [])
                     if h.get("normalised") == identity), None)
        if href is None or not href.get("reduces") or not href.get("path_shape_ok"):
            continue
        if href.get("host") != "afltables.com":
            continue                      # a www. host does not reduce; it stays a finding
        admissible[record["player_url"]] = identity

    # Collision across the WHOLE sample: two DraftGuru persons resolving to one AFL Tables
    # profile is a finding, never an instruction to merge, so neither may be promoted.
    claimed: dict[str, int] = {}
    for identity in admissible.values():
        claimed[identity] = claimed.get(identity, 0) + 1
    return {url: identity for url, identity in admissible.items() if claimed[identity] == 1}


def section(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def build_ledger(rows, admit_b1: bool, bridges: dict[str, str]) -> tuple[dict, list[str]]:
    """Classify every operative decision. Returns (ledger, blocking problems)."""
    problems: list[str] = []
    decisions: list[dict] = []
    seen_urls: set[str] = set()
    claimed_afltables: dict[str, int] = {}
    promotions = 0

    for i, (player_url, action, has_games, afl_id, afl_count) in enumerate(rows):
        where = f"decision #{i + 1} (ordinal only — no identifying value is printed)"

        if player_url is None:
            problems.append(f"{where}: the decided pick carries no DraftGuru person identity")
            continue
        if not PLAYER_URL_RE.match(player_url):
            problems.append(f"{where}: player_url is not the canonical form")
            continue
        if player_url in seen_urls:
            problems.append(f"{where}: duplicate player_url key — two decisions on one person")
            continue
        seen_urls.add(player_url)

        if action == "confirmed_unlinked":
            decisions.append({"player_url": player_url,
                              "decision": "confirmed_unlinked",
                              "target": None})
            continue
        if action != "linked":
            problems.append(f"{where}: unknown action {action!r}")
            continue

        if not has_games:
            # Zero senior games: the fitzRoy import will never create this player, so the
            # human decision is the authority that mints it under its DraftGuru identity.
            decisions.append({"player_url": player_url,
                              "decision": "linked",
                              "target": {"source": "draftguru", "external_id": player_url}})
            continue

        # Senior games: the rebuild will create this player with an AFL Tables identity.
        evidence = None
        if afl_count > 1:
            problems.append(f"{where}: target player holds {afl_count} AFL Tables identities — "
                            "ambiguous, refusing to choose")
            continue
        external_id = afl_id
        if external_id is None:
            observed = bridges.get(player_url)
            if admit_b1 and observed:
                external_id = observed
                evidence = "stage_b1_person_page_bridge"
                promotions += 1
            else:
                problems.append(
                    f"{where}: target played senior football but this database registers no "
                    "afltables_profile_url identity for it. It is one of the 889 "
                    "played-but-unregistered players (§38.3). Its AFL Tables path is "
                    f"observable in the accepted Stage B1 snapshot, but §21 admits that "
                    "snapshot as a profiling/validation oracle only. Re-run with "
                    "--admit-b1-bridge-identity to author it from that oracle deliberately, "
                    "or resolve the identity another way.")
                continue
        if not AFLTABLES_PATH_RE.match(external_id):
            problems.append(f"{where}: AFL Tables identity is not the canonical profile form")
            continue
        claimed_afltables[external_id] = claimed_afltables.get(external_id, 0) + 1

        entry = {"player_url": player_url,
                 "decision": "linked",
                 "target": {"source": "afltables", "external_id": external_id}}
        if evidence:
            # Recorded ONLY when the identity did not come from external_identities, so the
            # ledger itself shows which entry crossed the §21 admissibility boundary.
            entry["identity_evidence"] = evidence
        decisions.append(entry)

    for external_id, n in claimed_afltables.items():
        if n > 1:
            problems.append("an AFL Tables identity is claimed by more than one decision — "
                            "refusing to merge two people")

    # Exactly one decision was reviewed and approved for promotion from the Stage B1 oracle.
    # More than one would exceed the approval; none means the flag should not have been used.
    if admit_b1 and promotions != EXPECTED_PROMOTIONS:
        problems.append(f"{promotions} decision(s) required promotion from the Stage B1 "
                        f"oracle, but exactly {EXPECTED_PROMOTIONS} is approved")

    # Deterministic ordering: byte-ascending on the durable key. No timestamp is written,
    # so re-running over unchanged data reproduces the file byte-for-byte.
    decisions.sort(key=lambda d: d["player_url"].encode("utf-8"))

    ledger = {
        "$comment": (
            "AFLDB-ISSUE-093 Stage B2-3 — explicit human/admin DraftGuru link decisions, "
            "re-keyed from regenerating surrogate ids onto the durable DraftGuru player_url. "
            "Decision/identity state ONLY: no surrogate id, no DOB, weight, birth-year bound, "
            "admin note, height or admin identity is carried, by the governance decision in "
            "AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md §47. Authoritative for explicit human "
            "decisions only — automatic historical links are never replayed and never appear "
            "here. Generated by tools/rebuild/draftguru/export_link_decisions.py."
        ),
        "schema_version": SCHEMA_VERSION,
        "source_key": "draftguru",
        "decisions": decisions,
    }
    return ledger, problems


def gate(ledger: dict, problems: list[str]) -> list[str]:
    """Population and distribution gates. Every failure is fatal."""
    failures = list(problems)
    decisions = ledger["decisions"]

    if len(decisions) != EXPECTED_DECISIONS:
        failures.append(f"expected exactly {EXPECTED_DECISIONS} decisions, built "
                        f"{len(decisions)}")

    counts: dict[str | None, int] = {}
    for d in decisions:
        key = d["target"]["source"] if d["target"] else None
        counts[key] = counts.get(key, 0) + 1
    if counts != EXPECTED_DISTRIBUTION:
        readable = {(k or "null"): v for k, v in sorted(counts.items(), key=lambda x: str(x[0]))}
        failures.append(f"target distribution is {readable}, expected "
                        "{'afltables': 3, 'draftguru': 2, 'null': 1}")

    linked = sum(1 for d in decisions if d["decision"] == "linked")
    unlinked = sum(1 for d in decisions if d["decision"] == "confirmed_unlinked")
    if (linked, unlinked) != (5, 1):
        failures.append(f"expected 5 linked + 1 confirmed_unlinked, built {linked} + {unlinked}")

    for d in decisions:
        t = d["target"]
        if t and t["source"] == "draftguru" and t["external_id"] != d["player_url"]:
            failures.append("a draftguru target's external_id differs from its decision key")

    if len({d["player_url"] for d in decisions}) != len(decisions):
        failures.append("duplicate player_url keys in the built ledger")

    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--admit-b1-bridge-identity", action="store_true",
                        help="deliberately author an AFL Tables identity from the accepted "
                             "Stage B1 profiling snapshot when this database registers none "
                             "(crosses the §21 admissibility boundary — reviewed use only)")
    parser.add_argument("--dry-run", action="store_true",
                        help="validate and report, write nothing")
    args = parser.parse_args(argv)

    import psycopg

    bridges = load_b1_bridges() if args.admit_b1_bridge_identity else {}

    dsn = read_dsn()
    conn = psycopg.connect(dsn, options="-c default_transaction_read_only=on")
    try:
        conn.read_only = True
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), current_user, "
                        "current_setting('transaction_read_only'), "
                        "current_setting('default_transaction_read_only'), "
                        "current_setting('transaction_isolation')")
            db, usr, txn_ro, default_ro, iso = cur.fetchone()
            section("SAFETY IDENTITY")
            print(f"  db={db}  user={usr}  txn_ro={txn_ro}  default_ro={default_ro}  isolation={iso}")
            if db != REQUIRED_DB:
                raise SystemExit(f"REFUSED: connected to {db!r}, not {REQUIRED_DB!r}")
            if txn_ro != "on" or default_ro != "on":
                raise SystemExit("REFUSED: transaction is not read-only")
            if not iso.startswith("repeatable"):
                raise SystemExit(f"REFUSED: isolation is {iso!r}")

            cur.execute(Q_RAW_COUNT)
            audit_rows = cur.fetchone()[0]
            cur.execute(DECISIONS_SQL)
            rows = cur.fetchall()
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()
    print("\n  ROLLBACK completed — nothing was written to PostgreSQL.")

    section("DECISIONS READ")
    print(f"  audit rows on draftguru picks      {audit_rows}")
    print(f"  operative decisions (newest wins)  {len(rows)}")
    if audit_rows != len(rows):
        print(f"  note: {audit_rows - len(rows)} superseded audit row(s) correctly ignored")

    ledger, problems = build_ledger(rows, args.admit_b1_bridge_identity, bridges)
    failures = gate(ledger, problems)

    section("LEDGER (aggregate — no identifying value is printed)")
    counts: dict[str, int] = {}
    for d in ledger["decisions"]:
        key = d["target"]["source"] if d["target"] else "null"
        counts[key] = counts.get(key, 0) + 1
    print(f"  decisions built                    {len(ledger['decisions'])}")
    for key in ("afltables", "draftguru", "null"):
        print(f"  target source = {key:<18} {counts.get(key, 0)}")
    evidence_entries = sum(1 for d in ledger["decisions"] if "identity_evidence" in d)
    if evidence_entries:
        print(f"  entries authored from the Stage B1 oracle  {evidence_entries}"
              "   <== §21 boundary crossed deliberately")

    if failures:
        section("FAIL CLOSED — nothing was written")
        for f in failures:
            print(f"  * {f}")
        return 1

    payload = json.dumps(ledger, ensure_ascii=False, indent=2) + "\n"
    if args.dry_run:
        section("DRY RUN — all gates passed, nothing written")
        print(f"  would write {len(payload)} bytes to {LEDGER_PATH.relative_to(REPO_ROOT)}")
        return 0

    LEDGER_PATH.write_text(payload, encoding="utf-8", newline="\n")
    section("WRITTEN")
    print(f"  {LEDGER_PATH.relative_to(REPO_ROOT)}  ({len(payload)} bytes)")
    print("  Deterministic: no timestamp is recorded, so a re-run over unchanged data "
          "reproduces\n  these bytes exactly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
