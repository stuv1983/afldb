#!/usr/bin/env python3
"""AFLDB-ISSUE-093 Stage B2-4/5 — the supported DraftGuru importer.

Replaces ``tools/migration/import_draft.py`` on the rebuild path. It has **zero**
``AFLDB_LEGACY_SQLITE`` dependency: there is no ``connect_legacy`` here, no SQLite import, and
no code path that could read the legacy database. It never opens a network socket, and it never
reads the frozen browser-export CSV, which is a parity oracle and is not importable.

Inputs (all tracked or accepted)
--------------------------------
* the accepted Stage A snapshot + its manifest — every raw year page verified by sha256 and
  then re-parsed with the tested ``parse_draft_snapshot`` parser, so there is exactly one
  interpretation of the source HTML in the repository;
* ``tools/rebuild/draftguru/draftguru-contract.json`` — canonical identity, club resolution;
* ``data/reference/draftguru-event-kinds.json`` — the frozen event/signing contract;
* ``data/reference/clubs.json`` and ``data/reference/seasons.json``;
* ``data/reference/draftguru-link-decisions.json`` — the six explicit human decisions;
* canonical AFL Tables identities already registered by the fitzRoy phase;
* OPTIONALLY, an approved bridge dataset supplied with ``--bridge`` (Stage B3 later).

**Stage B1's ``person_profile.jsonl`` is not an input and cannot be read by this module.** The
one approved B1 identity promotion was converted into the tracked ledger during B2-3, so the
decision replays without the profiling snapshot.

Identity authority, in strict order (B2 handoff §13, §73.3)
-----------------------------------------------------------
1. explicit human decision — the tracked ledger, or a live ``player_link_resolutions`` row;
2. an admissible bridge, only when an approved bridge dataset is supplied;
3. unmatched.

Names, game counts, birth years, fuzzy matching, DraftGuru ordinal collapse and historical
automatic links are **never** identity authorities. No name column is read for identity
anywhere in this module.

Safety
------
``--validate-only`` performs the whole of Phase A and needs no psycopg. Everything that can
fail before a database connection does. The write phase runs in one ``import_batch``
transaction scoped to ``source_id = draftguru``; admin-created picks (``source_id IS NULL``)
are outside its UPDATE, INSERT and DELETE alike. Connection is through
``AFLDB_IMPORT_DATABASE_URL`` — the ``afldb_import`` role — never owner access.

Atomicity (AFLDB-ISSUE-222 pre-import review, 2026-09-18)
---------------------------------------------------------
Exactly two commits happen on the write path: ``import_batch`` commits the ``running`` batch
row before any data statement, and ``ImportBatch.finish("completed")`` commits every data
write **and** the ``completed`` status in one transaction. ``analyze()`` -- which commits
whatever is open before it toggles autocommit -- is therefore called only AFTER the batch
block has closed, so it can never split the data commit from the audit row's status. Any
exception inside the block, ``--dry-run`` included, rolls the whole data transaction back
before the ``failed`` batch row is recorded. ``tests/python/draftguru_import_atomicity_contract.py``
proves this order against a scripted connection without a database.

``--link-only`` (AFLDB-ISSUE-222 Phase 4b, 2026-09-19)
------------------------------------------------------
A second, separate write path that applies ONLY the already-reviewed trusted linkage to a
DraftGuru population that is already loaded, and rewrites no source-owned Stage A fact.

It exists because a deployment target can hold an accepted Stage A snapshot whose raw bytes are
no longer available anywhere. ``afldb_dev`` was loaded from ``annual-html-20260902``; that
snapshot's pages cannot be re-fetched (they are Rails-rendered and carry a per-render CSRF
token, CHANGELOG 2 September 2026) and no accepted copy of them survives. A normal import is
therefore impossible on that target without regressing it onto the superseded
``annual-html-20260826`` bytes, which the read-only gate correctly refused.

Link-only never reads a Stage A page, a Stage A manifest or the parser's snapshot at all. The
expected state is built from four inputs only:

  1. the population ALREADY STORED on the target (``draft_persons`` / ``draft_picks`` /
     ``external_identities``), which supplies every non-link column unchanged;
  2. the pinned deployment child supplied with ``--bridge``;
  3. the AFL Tables identities registered on that target;
  4. the tracked ledger and the target's live ``player_link_resolutions`` decisions.

``apply_authority()`` -- the same function, in the same order, with seeding forbidden -- then
decides every person's link. The committed write set is exactly:

  * ``import_batches``      one row, ``notes`` = ``mode=link_only stage_a_snapshot=<label> ...``;
  * ``draft_persons``       player_id, link_status, match_method, confidence_notes,
                            is_matching_backlog;
  * ``draft_picks``         player_id, link_status_value, match_method, confidence_notes;
  * ``external_identities`` player_id, status, match_method   (source ``draftguru`` only).

``is_matching_backlog`` is in that set because migration 019's ``draft_persons_backlog_ck``
makes it impossible to leave out: setting ``player_id`` on a person the row still flags as
backlog violates the CHECK and the statement fails. ``confidence_notes`` is in it because it is
the link's own provenance (``draftguru person-page bridge -> <identity>``) and a link whose
provenance still describes the previous decision is a false audit trail. Both are link-derived;
neither is a Stage A fact. Everything else -- ``dg_person_id``, ``display_name_raw``,
``name_key``, ``reported_games`` / ``reported_goals``, ``import_batch_id``,
``source_record_id``, ``detail``, every other pick column, the identity rows'
``external_name`` / ``external_url`` / ``candidate_count`` / ``notes``, ``players``,
``data_overrides``, manual selections and every non-DraftGuru row -- is never named in a SET
clause and cannot move.

Link-only is fail-closed before it writes anything: it requires ``--bridge``, ``--no-seed`` and
an EXPLICIT ``--label``; it refuses ``--snapshot-root`` and ``--acknowledge-population-drop``;
and it refuses outright unless the stored population is exactly the child's population (5,057
persons / 6,810 picks, no missing, extra or duplicate key), every DraftGuru identity row exists
exactly once, and every one of those rows' ``notes`` is exactly
``stage_a_snapshot=<the explicit label>``. That last check is what makes the label honest: the
mode asserts which snapshot the untouched data came from, and refuses if the target disagrees.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
sys.path.insert(0, str(TOOL_DIR))
sys.path.insert(0, str(REPO_ROOT / "tools" / "migration"))

import parse_draft_snapshot as parser_mod  # noqa: E402  (tested Stage A parser, no psycopg)

SOURCE_KEY = "draftguru"
AFLTABLES_SOURCE_KEY = "afltables"
# AFLDB-ISSUE-160 §8.3: the durable identity of a player an administrator created
# through their draft selection, before any source has published them.
MANUAL_SOURCE_KEY = "manual_admin_edit"
AFLTABLES_MATCH_METHOD = "afltables_profile_url"

# Provenance written onto a link, so its authority is visible in the row itself.
LEDGER_MATCH_METHOD = "draftguru_explicit_admin_decision"
BRIDGE_MATCH_METHOD = "draftguru_person_page_afltables_bridge"

STAGE_A_LABEL = "annual-html-20260826"
MANIFEST_DIR = REPO_ROOT / "docs" / "rebuild-manifests" / "draftguru"
EVENT_KINDS_PATH = REPO_ROOT / "data" / "reference" / "draftguru-event-kinds.json"
CLUBS_PATH = REPO_ROOT / "data" / "reference" / "clubs.json"
SEASONS_PATH = REPO_ROOT / "data" / "reference" / "seasons.json"
LEDGER_PATH = REPO_ROOT / "data" / "reference" / "draftguru-link-decisions.json"

AFLTABLES_PATH_RE = re.compile(r"^players/[A-Za-z]/[^/]+\.html$")

EXPECTED_ROWS = 6810
EXPECTED_PERSONS = 5057

NBSP = " "

# migration 069 reload keys. Row ids are durable application identity, so both tables are
# reconciled by natural key and never truncated.
PERSON_KEY = ("source_id", "player_url")
PERSON_COLUMNS = (
    "source_id", "dg_person_id", "player_url", "display_name_raw",
    "name_key", "player_id", "link_status", "candidate_count",
    "match_method", "confidence_notes", "reported_games",
    "reported_goals", "is_matching_backlog",
)
PICK_KEY = ("source_id", "player_url", "draft_year", "draft_kind")
PICK_COLUMNS = (
    "draft_year", "draft_type", "draft_kind", "pick_number",
    "pick_note", "player_id", "player_name_raw", "link_status_value",
    "candidate_count", "match_method", "confidence_notes",
    "club_id", "club_name_raw", "original_club_raw", "draft_age",
    "height_cm", "weight_kg", "grade", "competition", "signing",
    "signing_kind", "signing_detail", "detail",
    "source_id", "source_record_id",
    "import_batch_id", "draft_person_id", "dg_person_id",
    "player_url", "reported_games", "reported_goals",
)

# The states that mean "no confirmed link" (migration 019's CHECK vocabulary).
UNLINKED_DEFAULT = "unmatched"

# --- AFLDB-ISSUE-222 --link-only -------------------------------------------------------------
# The ONLY columns the link-only write path may name in a SET clause, per table. These three
# tuples are the mode's whole contract: bridge_import_gate.py imports them to model the write
# set, and tests/python/draftguru_link_only_contract.py proves by AST that every SET clause in
# the link-only statements assigns exactly these columns and nothing else.
#
# They are the complement of what the gate already calls the non-link columns, so checks 6.4,
# 6.6 and 6.7 keep their existing meaning instead of acquiring a second vocabulary.
LINK_ONLY_MODE = "link_only"
PERSON_LINK_COLUMNS = ("player_id", "link_status", "match_method", "confidence_notes",
                       "is_matching_backlog")
PICK_LINK_COLUMNS = ("player_id", "link_status_value", "match_method", "confidence_notes")
IDENTITY_LINK_COLUMNS = ("player_id", "status", "match_method")
IDENTITY_NOTES_PREFIX = "stage_a_snapshot="

LINK_ONLY_DRY_RUN_MESSAGE = (
    "DRY RUN (--link-only) — every linkage write was rolled back (draft_persons, draft_picks "
    "and external_identities are unchanged, and no non-link column was named in any statement); "
    "the import_batches audit row for this run is retained with status 'failed' and error "
    "'DryRunComplete: '."
)

# What --dry-run leaves behind, stated exactly (AFLDB-ISSUE-222 closeout, 2026-09-19): every data
# write is rolled back, but import_batch() records the run as a FAILED batch row whose error is
# "DryRunComplete: " -- that audit row is committed and retained, so the earlier wording that
# claimed no write at all was never true of import_batches.
# tests/python/draftguru_import_atomicity_contract.py pins both halves of this statement
# against the scripted connection.
DRY_RUN_MESSAGE = (
    "DRY RUN — every data write was rolled back (draft_persons, draft_picks, "
    "external_identities and players are unchanged); the import_batches audit row for this run "
    "is retained with status 'failed' and error 'DryRunComplete: '."
)


class ImportFailure(RuntimeError):
    """A fail-closed refusal. Nothing is written when this is raised."""


class DryRunComplete(Exception):
    """--dry-run finished its work and wants the transaction rolled back.

    A plain exception rather than SystemExit so ``import_batch`` sees it, rolls the
    transaction back and closes the batch row out instead of leaving it ``running``.
    """


# ---------------------------------------------------------------------------
# Frozen derivations
# ---------------------------------------------------------------------------

def fold_nbsp(value: str) -> str:
    """U+00A0 -> ASCII space. Applied to derived values, never to stored raw text."""
    return value.replace(NBSP, " ")


def draftguru_name_key(display_name_raw: str) -> str:
    """The frozen Stage B2-1 G6 rule (B2 handoff §35.2).

    NBSP -> ASCII space; collapse whitespace runs; trim; lowercase. Apostrophes, hyphens and
    non-ASCII letters are PRESERVED and nothing is unaccented — deliberately different from
    ``public.afldb_normalise_name``, which rewrites all three and reproduced only 4,926 of
    5,057 stored values. This rule reproduces all 5,057.

    It is a search/index key and never participates in player identity.
    """
    folded = fold_nbsp(display_name_raw)
    return re.sub(r"\s+", " ", folded).strip().lower()


def leading_int(raw: str | None) -> int | None:
    """'182cm' -> 182, '18yr' -> 18, '' / None -> None. Never guesses a value."""
    if not raw:
        return None
    digits = re.match(r"\s*(\d+)", raw)
    return int(digits.group(1)) if digits else None


def signing_kind_of(signing_raw: str | None) -> str | None:
    """Frozen Stage B2-2 rule: the head, first parenthetical qualifier removed.

    Absence stays absent — a missing Signing value is never coerced into a kind.
    """
    if signing_raw is None:
        return None
    return re.sub(r"\s*\(.*$", "", signing_raw).strip()


def build_competition_resolver(seasons: dict):
    """competition = league_era(draft_year), from tracked data/reference/seasons.json."""
    eras = seasons["league_eras"]

    def resolve(year: int) -> str:
        for era in eras:
            first = era["first_season"]
            last = era["last_season"]
            if year >= first and (last is None or year <= last):
                return era["league"]
        raise ImportFailure(
            f"draft_year {year} falls outside every tracked league era in "
            f"{SEASONS_PATH.relative_to(REPO_ROOT)}; refusing to guess a competition")

    return resolve


# ---------------------------------------------------------------------------
# Phase A — validate every artefact before any database access
# ---------------------------------------------------------------------------

def load_json(path: Path, what: str) -> dict:
    if not path.is_file():
        raise ImportFailure(f"missing {what}: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def verify_stage_a_manifest(label: str) -> dict:
    """The Stage A manifest, checked against its own accepted contract (§21)."""
    manifest = load_json(MANIFEST_DIR / f"{label}.json", "Stage A manifest")
    if manifest.get("snapshot_label") != label:
        raise ImportFailure("the Stage A manifest names a different snapshot label")
    if manifest.get("identity_complete") is not True or manifest.get("import_capable") is not True:
        raise ImportFailure(
            "the Stage A manifest does not declare identity_complete=true / "
            "import_capable=true; only a snapshot whose own accepted contract admits it may "
            "be imported (B2 handoff §21)")
    if manifest.get("total_rows") != EXPECTED_ROWS:
        raise ImportFailure(f"manifest total_rows is {manifest.get('total_rows')}, "
                            f"expected {EXPECTED_ROWS}")
    if manifest.get("distinct_player_url_count") != EXPECTED_PERSONS:
        raise ImportFailure(
            f"manifest distinct_player_url_count is "
            f"{manifest.get('distinct_player_url_count')}, expected {EXPECTED_PERSONS}")
    return manifest


def verify_raw_bytes(manifest: dict, snapshot_dir: Path) -> int:
    """Every raw year page must match the sha256 the accepted manifest records.

    The manifest hashes the RAW bytes, not the parsed output, so the raw files are the anchor
    and the tested parser is re-run over them. Nothing here trusts an unhashed parsed/*.jsonl.
    """
    entries = manifest.get("source_urls") or []
    if not entries:
        raise ImportFailure("the Stage A manifest records no source_urls")
    for entry in entries:
        raw_path = snapshot_dir / entry["raw_filename"]
        if not raw_path.is_file():
            raise ImportFailure(f"manifest names a raw page that is absent: {raw_path}")
        actual = hashlib.sha256(raw_path.read_bytes()).hexdigest()
        if actual != entry["sha256"]:
            raise ImportFailure(
                f"raw page {entry['raw_filename']} does not match the sha256 the accepted "
                "manifest declares; it is not the accepted snapshot")
    return len(entries)


def load_event_mapping() -> tuple[dict[str | None, tuple[str, str]], set[str]]:
    """(event_type_raw -> (draft_type, draft_kind), closed signing-kind vocabulary)."""
    doc = load_json(EVENT_KINDS_PATH, "event-kind mapping")
    mapping: dict[str | None, tuple[str, str]] = {}
    for entry in doc["events"]:
        mapping[entry["event_type_raw"]] = (entry["draft_type"], entry["draft_kind"])
    absent = doc["absent_column"]
    if absent["event_type_raw"] is not None:
        raise ImportFailure("the absent-Draft-column case must be keyed on JSON null")
    mapping[None] = (absent["draft_type"], absent["draft_kind"])

    if doc["matching"]["comparison"] != "exact" or doc["matching"]["trim"] \
            or doc["matching"]["case_fold"] or doc["matching"]["unicode_fold"]:
        raise ImportFailure("the event mapping no longer declares byte-exact matching")
    if doc["unknown_label_policy"]["on_unknown_event_type_raw"] != "HALT":
        raise ImportFailure("the event mapping no longer fails closed on an unknown label")
    signing = doc["signing"]["signing_kind"]
    if signing["on_unknown_head"] != "HALT":
        raise ImportFailure("the signing contract no longer fails closed on an unknown head")
    if doc["signing"]["signing_detail"]["status"] != "NOT_IMPORTED":
        raise ImportFailure("signing_detail is no longer declared NOT_IMPORTED")
    return mapping, set(signing["vocabulary"])


def load_club_rules(contract: dict) -> tuple[set[str], dict[str, None]]:
    """(valid clubs.json slugs, reviewed deliberate-NULL slugs)."""
    clubs = load_json(CLUBS_PATH, "clubs reference")
    slugs = {identity["slug"] for identity in clubs["identities"]}
    resolution = contract.get("club_resolution")
    if resolution is None:
        raise ImportFailure("the DraftGuru contract carries no club_resolution block")
    if resolution["on_unknown_club_slug"] != "HALT":
        raise ImportFailure("the club contract no longer fails closed on an unknown slug")
    deliberate = {entry["club_slug"]: None for entry in resolution["deliberate_null"]}
    for slug in deliberate:
        if slug in slugs:
            raise ImportFailure(
                f"club slug {slug!r} is declared a deliberate NULL but clubs.json resolves "
                "it; the exception and the mapping disagree")
    return slugs, deliberate


def load_ledger() -> dict[str, dict]:
    """The six explicit human decisions, validated against their frozen contract."""
    doc = load_json(LEDGER_PATH, "explicit-decision ledger")
    if doc.get("schema_version") != 1:
        raise ImportFailure("unsupported ledger schema_version")
    if doc.get("source_key") != SOURCE_KEY:
        raise ImportFailure("the ledger is not a DraftGuru ledger")

    url_re = re.compile(parser_mod.load_contract()["canonical_player_url"]["regex"])
    decisions: dict[str, dict] = {}
    claimed: dict[str, str] = {}
    for entry in doc["decisions"]:
        url = entry["player_url"]
        if not url_re.match(url):
            raise ImportFailure("a ledger decision key is not a canonical player_url")
        if url in decisions:
            raise ImportFailure("the ledger carries two decisions for one person")
        action = entry["decision"]
        target = entry.get("target")
        if action == "confirmed_unlinked":
            if target is not None:
                raise ImportFailure("a confirmed_unlinked decision names a target")
        elif action == "linked":
            if not target:
                raise ImportFailure("a linked decision names no target")
            source = target["source"]
            external_id = target["external_id"]
            if source == AFLTABLES_SOURCE_KEY:
                if not AFLTABLES_PATH_RE.match(external_id):
                    raise ImportFailure("an afltables target is not a canonical profile path")
                if external_id in claimed:
                    raise ImportFailure(
                        "two ledger decisions claim one AFL Tables identity; refusing to "
                        "merge two people")
                claimed[external_id] = url
            elif source == SOURCE_KEY:
                if external_id != url:
                    raise ImportFailure(
                        "a draftguru target's external_id differs from its decision key")
            elif source == MANUAL_SOURCE_KEY:
                # AFLDB-ISSUE-160 §8.3. The token is a randomUUID minted by the admin
                # surface; its only structural contract is that it is a non-empty
                # opaque string, and that no two decisions claim the same one -- which
                # would be two people claiming one canonical player.
                if not isinstance(external_id, str) or not external_id.strip():
                    raise ImportFailure("a manual_admin_edit target carries no token")
                if external_id in claimed:
                    raise ImportFailure(
                        "two ledger decisions claim one manual identity; refusing to "
                        "merge two people")
                claimed[external_id] = url
            else:
                raise ImportFailure(f"unknown ledger target source {source!r}")
        else:
            raise ImportFailure(f"unknown ledger decision {action!r}")
        decisions[url] = entry
    return decisions


def load_bridge(path: Path | None, url_re: re.Pattern) -> dict[str, str]:
    """An APPROVED bridge dataset: player_url -> canonical AFL Tables identity.

    Deliberately a separate, explicitly-supplied artefact. Stage B1's profiling snapshot is
    NOT this file and is never read by this module. Absent by default, in which case no
    automatic link is made anywhere.
    """
    if path is None:
        return {}
    doc = load_json(path, "bridge dataset")
    if doc.get("schema_version") != 1:
        raise ImportFailure("unsupported bridge schema_version")
    bridges: dict[str, str] = {}
    claimed: dict[str, str] = {}
    for entry in doc.get("bridges", []):
        url = entry["player_url"]
        identity = entry["afltables_external_id"]
        if not url_re.match(url):
            raise ImportFailure("a bridge entry is not keyed on a canonical player_url")
        if not AFLTABLES_PATH_RE.match(identity):
            raise ImportFailure("a bridge entry names a non-canonical AFL Tables identity")
        if url in bridges:
            raise ImportFailure(
                "the bridge dataset binds one DraftGuru person to multiple AFL Tables "
                "identities; refusing to choose")
        if identity in claimed:
            raise ImportFailure(
                "the bridge dataset binds one AFL Tables identity to multiple DraftGuru "
                "persons; that is a finding, never an instruction to merge")
        bridges[url] = identity
        claimed[identity] = url
    return bridges


# ---------------------------------------------------------------------------
# Building the person and pick frames
# ---------------------------------------------------------------------------

def build_persons(parse_result: dict) -> dict[str, dict]:
    """5,057 persons keyed on player_url, in byte-ascending order.

    ``dg_person_id`` is the rank in that order (index + 1). It is a per-load rank and NEVER
    durable identity — which is exactly why migration 069 keys on player_url instead and why
    its unique constraint is deferred during the write.
    """
    persons: dict[str, dict] = {}
    for url in sorted(parse_result["persons"], key=lambda u: u.encode("utf-8")):
        person = parse_result["persons"][url]
        spellings = set(person["display_names_raw"])
        if len(spellings) != 1:
            raise ImportFailure(
                f"person {url} carries {len(spellings)} distinct display spellings; the "
                "importer will not choose one")
        display = next(iter(spellings))
        persons[url] = {
            "player_url": url,
            "dg_person_id": len(persons) + 1,
            "display_name_raw": display,          # verbatim: NBSP preserved (§73.6)
            "name_key": draftguru_name_key(display),
            "reported_games": 0,
            "reported_goals": 0,
        }
    return persons


def build_picks(parse_result: dict, persons: dict[str, dict], event_map: dict,
                signing_vocab: set[str], club_slugs: set[str], deliberate_null: dict,
                competition_of) -> list[dict]:
    """6,810 picks with every column derived from the frozen contracts."""
    picks: list[dict] = []
    for year in sorted(parse_result["rows_by_year"]):
        for row in parse_result["rows_by_year"][year]:
            url = row["player_url"]

            event_raw = row["event_type_raw"]
            if event_raw not in event_map:
                raise ImportFailure(
                    f"year={year} row={row['row_index']}: unknown event_type_raw "
                    f"{event_raw!r}. The tracked mapping fails closed rather than inventing "
                    "a category.")
            draft_type, draft_kind = event_map[event_raw]

            slug = row["club_slug"]
            if slug in club_slugs:
                club_slug = slug
            elif slug in deliberate_null:
                club_slug = None                  # reviewed exception: brisbane -> NULL
            else:
                raise ImportFailure(
                    f"year={year} row={row['row_index']}: club slug {slug!r} is neither an "
                    "exact clubs.slug nor a reviewed exception. Refusing to resolve it by "
                    "alias, name, similarity or year.")

            signing_raw = row["signing_raw"]
            kind = signing_kind_of(signing_raw)
            if kind is not None and kind not in signing_vocab:
                raise ImportFailure(
                    f"year={year} row={row['row_index']}: signing head {kind!r} is outside "
                    "the closed vocabulary")

            parity = row.get("parity_only") or {}
            person = persons[url]
            games = leading_int(parity.get("games")) or 0
            goals = leading_int(parity.get("goals")) or 0
            # Triage only (migration 019): a person's own reported figures, never a career
            # statistic and never identity evidence. Max across their rows.
            person["reported_games"] = max(person["reported_games"], games)
            person["reported_goals"] = max(person["reported_goals"], goals)

            picks.append({
                "player_url": url,
                "draft_year": year,
                "draft_type": draft_type,
                "draft_kind": draft_kind,
                "pick_number": row["pick_number"],
                "pick_note": row["pick_note_raw"],
                "player_name_raw": row["player_name_raw"],   # verbatim (§73.6)
                "club_slug": club_slug,
                "club_name_raw": row["club_name_raw"],
                "original_club_raw": row["original_club_raw"],
                "draft_age": leading_int(row["age_raw"]),
                "height_cm": leading_int(row["height_raw"]),
                "competition": competition_of(year),
                "signing": signing_raw,
                "signing_kind": kind,
                "detail": row["detail_raw"],
                "source_record_id": f"{row['source_url']}#{row['row_index']}",
            })

    if len(picks) != EXPECTED_ROWS:
        raise ImportFailure(f"built {len(picks)} picks, expected {EXPECTED_ROWS}")
    if len(persons) != EXPECTED_PERSONS:
        raise ImportFailure(f"built {len(persons)} persons, expected {EXPECTED_PERSONS}")

    seen: set[tuple] = set()
    for pick in picks:
        key = (pick["player_url"], pick["draft_year"], pick["draft_kind"])
        if key in seen:
            raise ImportFailure(
                "the derived rows contain a duplicate reload key "
                "(player_url, draft_year, draft_kind); nothing has been written")
        seen.add(key)
    return picks


# ---------------------------------------------------------------------------
# Database phases
# ---------------------------------------------------------------------------

def resolve_source_id(cur, key: str) -> int:
    cur.execute("SELECT id FROM sources WHERE key = %s", (key,))
    rows = cur.fetchall()
    if len(rows) != 1:
        raise ImportFailure(f"expected exactly one sources row for {key!r}, found {len(rows)}")
    return rows[0][0]


def resolve_club_ids(cur) -> dict[str, int]:
    cur.execute("SELECT slug, id FROM clubs")
    return dict(cur.fetchall())


def resolve_afltables_players(cur, afltables_source_id: int) -> dict[str, list[int]]:
    """Canonical AFL Tables identity -> the players it resolves to."""
    cur.execute(
        """SELECT external_id, player_id FROM external_identities
            WHERE source_id = %s AND match_method = %s
              AND status IN ('unique','resolved') AND player_id IS NOT NULL""",
        (afltables_source_id, AFLTABLES_MATCH_METHOD),
    )
    resolved: dict[str, list[int]] = {}
    for external_id, player_id in cur.fetchall():
        resolved.setdefault(external_id, []).append(player_id)
    return resolved


def read_live_decisions(cur, source_id: int) -> dict[str, dict]:
    """Explicit admin decisions made in THIS database, normalised to their person.

    Mirrors import_draft.py:198-211 — the audit trail is append-only, so the newest row for a
    target is the decision that stands. On a fresh rebuild this is empty; on a live database it
    is the ISSUE-078 invariant: a reload must not destroy durable manual link state.
    """
    cur.execute(
        """SELECT DISTINCT ON (r.target_id)
                  p.player_url, r.action, r.player_id
             FROM player_link_resolutions r
             JOIN draft_picks k ON k.id = r.target_id
             LEFT JOIN draft_persons p ON p.id = k.draft_person_id
            WHERE r.target_table = 'draft_picks' AND k.source_id = %s
            ORDER BY r.target_id, r.created_at DESC, r.id DESC""",
        (source_id,),
    )
    live: dict[str, dict] = {}
    contradictory: set[str] = set()
    for player_url, action, player_id in cur.fetchall():
        if player_url is None:
            continue
        seen = live.get(player_url)
        if seen is None:
            live[player_url] = {"action": action, "player_id": player_id}
            continue
        # Identity is person-grained (migration 019), so two picks of one person cannot
        # disagree. Taking either silently would let one pick's decision override another's,
        # which is exactly what import_draft.py's classify_decisions() refuses. B2 handoff
        # §16: this always HALTs and --allow-link-loss deliberately does not apply.
        if seen["action"] != action or seen["player_id"] != player_id:
            contradictory.add(player_url)
    if contradictory:
        listed = ", ".join(sorted(contradictory)[:5])
        raise ImportFailure(
            f"{len(contradictory)} DraftGuru person(s) carry contradictory explicit admin "
            f"decisions across their picks ({listed}). One person cannot be both linked and "
            "unlinked, or linked to two different players. A curator must reconcile them in "
            "/admin/player-links before this import can run; nothing has been written.")
    return live


def seed_player(cur, display_name_raw: str) -> int:
    """Create the approved minimal zero-game canonical player shell.

    Only for a ledger decision whose target is a DraftGuru identity — a person the fitzRoy
    import will never create because they played no senior football. Derivations are the
    repository's own, not new inventions:

      * given/surname/sort_name — the tracked admin-creation split
        (src/db/queries/players.ts:302-312), proven 2/2 for exactly these two targets. It is
        NOT a universal name parser and must not be described as one;
      * search_name and slug — derived in SQL exactly as import_fitzroy_core.py:947-952 does,
        so they can never drift from the normalisation the search queries use.

    Nothing else is seeded: no dob, birth_year, birth-year bounds, weight, height, notes or
    player_career_stats row. Those were deliberately excluded from the tracked corpus by the
    §47 governance decision, and the derived rebuild regenerates career stats from
    player_match_stats anyway (a zero-game player correctly produces no row).
    """
    display_name = fold_nbsp(display_name_raw).strip()
    parts = display_name.split()
    if len(parts) == 1:
        given, surname = None, parts[0]
    else:
        given, surname = " ".join(parts[:-1]), parts[-1]
    sort_name = f"{surname}, {given}" if given else surname

    cur.execute(
        """INSERT INTO players (display_name, sort_name, search_name, slug,
                                given_name, surname)
           VALUES (%s, %s, '', '', %s, %s) RETURNING id""",
        (display_name, sort_name, given, surname),
    )
    player_id = cur.fetchone()[0]
    cur.execute(
        """UPDATE players
              SET search_name = afldb_normalise_name(display_name),
                  slug = regexp_replace(afldb_normalise_name(display_name), '\\s+', '-', 'g')
            WHERE id = %s""",
        (player_id,),
    )
    return player_id


def resolve_manual_players(cur) -> dict[str, list[int]]:
    """manual_admin_edit token -> canonical player ids (AFLDB-ISSUE-160 §8.3).

    The mirror of ``resolve_afltables_players``. A ledger decision may name an
    administrator-created player by the token that player was minted with, which is the
    only durable identity such a player has before the source publishes them.
    """
    cur.execute(
        """SELECT e.external_id, e.player_id
             FROM external_identities e
             JOIN sources s ON s.id = e.source_id
            WHERE s.key = 'manual_admin_edit'
              AND e.match_method = 'manual_admin_edit'
              AND e.status IN ('unique','resolved')
              AND e.player_id IS NOT NULL""")
    out: dict[str, list[int]] = {}
    for external_id, player_id in cur.fetchall():
        out.setdefault(external_id, []).append(player_id)
    return out


def apply_authority(cur, rep, persons: dict[str, dict], ledger: dict[str, dict],
                    live: dict[str, dict], bridges: dict[str, str],
                    afl_players: dict[str, list[int]], source_id: int,
                    dg_identities: dict[str, int], seeds_allowed: bool,
                    manual_players: dict[str, list[int]] | None = None) -> dict:
    """Decide every person's link, in the settled authority order. Fail closed on ambiguity."""
    stats = {"ledger": 0, "live_override": 0, "bridge": 0, "unmatched": 0, "seeded": 0}

    for url, person in persons.items():
        person["player_id"] = None
        person["link_status"] = UNLINKED_DEFAULT
        person["match_method"] = None
        person["confidence_notes"] = None

    # ---- 1. explicit human decisions -----------------------------------
    decided: dict[str, dict] = dict(ledger)
    for url, live_decision in live.items():
        if url in decided:
            rep.warn(
                f"a live admin decision overrides the tracked ledger for one person; the "
                f"ledger should be re-exported (person key withheld from this report)")
            stats["live_override"] += 1
        decided[url] = {
            "decision": live_decision["action"],
            "target": {"source": "__live__", "player_id": live_decision["player_id"]}
            if live_decision["action"] == "linked" else None,
        }

    for url, entry in sorted(decided.items()):
        if url not in persons:
            raise ImportFailure(
                "an explicit decision names a DraftGuru person the accepted snapshot no "
                "longer carries; nothing has been written")
        person = persons[url]
        if entry["decision"] == "confirmed_unlinked":
            person["player_id"] = None
            person["link_status"] = UNLINKED_DEFAULT
            person["match_method"] = LEDGER_MATCH_METHOD
            person["confidence_notes"] = "explicit human decision: confirmed_unlinked"
            stats["ledger"] += 1
            continue

        target = entry["target"]
        if target["source"] == "__live__":
            player_id = target["player_id"]
        elif target["source"] == AFLTABLES_SOURCE_KEY:
            candidates = afl_players.get(target["external_id"], [])
            if len(candidates) != 1:
                raise ImportFailure(
                    f"an explicit decision's AFL Tables target resolves to {len(candidates)} "
                    "canonical players after the fitzRoy import; expected exactly one. "
                    "Refusing to create a replacement player from DraftGuru data.")
            player_id = candidates[0]
        elif target["source"] == MANUAL_SOURCE_KEY:
            # AFLDB-ISSUE-160 §8.3. The player was created by an administrator and is
            # re-created on a rebuilt database by replay_admin_overrides(players), which
            # runs before this importer. Resolve the token; NEVER seed a second player
            # for it -- that is the duplicate this branch exists to prevent.
            candidates = (manual_players or {}).get(target["external_id"], [])
            if len(candidates) != 1:
                raise ImportFailure(
                    f"an explicit decision's manual-identity target resolves to "
                    f"{len(candidates)} canonical players; expected exactly one. The "
                    "administrator-created player it names is missing from this database "
                    "-- replay the players admin overrides before this import.")
            player_id = candidates[0]
        else:
            existing = dg_identities.get(url)
            if existing is not None:
                player_id = existing
            else:
                if not seeds_allowed:
                    raise ImportFailure(
                        "an explicit decision requires minting a minimal canonical player "
                        "shell, which --no-seed forbids")
                player_id = seed_player(cur, person["display_name_raw"])
                dg_identities[url] = player_id
                stats["seeded"] += 1
        person["player_id"] = player_id
        person["link_status"] = "resolved"
        person["match_method"] = LEDGER_MATCH_METHOD
        person["confidence_notes"] = "explicit human decision: linked"
        stats["ledger"] += 1

    # ---- 2. admissible bridge evidence ---------------------------------
    for url, identity in sorted(bridges.items()):
        if url not in persons:
            raise ImportFailure(
                "the bridge dataset names a DraftGuru person the accepted snapshot does not "
                "carry")
        person = persons[url]
        candidates = afl_players.get(identity, [])
        if len(candidates) != 1:
            raise ImportFailure(
                f"a bridge target resolves to {len(candidates)} canonical players after the "
                "fitzRoy import; expected exactly one")
        player_id = candidates[0]
        if url in decided:
            entry = decided[url]
            human_player = person["player_id"]
            if entry["decision"] == "confirmed_unlinked" or human_player != player_id:
                # The audit trail is the failed import_batches row, whose `error` column
                # carries this message and is committed by import_batch AFTER the rollback.
                # A data_issues row would be rolled back with everything else and so would
                # be a promise this importer cannot keep.
                raise ImportFailure(
                    "an admissible bridge contradicts an explicit human decision "
                    f"({entry['decision']} vs bridge identity {identity}). Automatic evidence "
                    "never overrides human authority; a curator must reconcile them.")
            continue                                  # agrees with the human decision
        person["player_id"] = player_id
        person["link_status"] = "unique"              # 'resolved' stays reserved for humans
        person["match_method"] = BRIDGE_MATCH_METHOD
        person["confidence_notes"] = f"draftguru person-page bridge -> {identity}"
        stats["bridge"] += 1

    stats["unmatched"] = sum(1 for p in persons.values() if p["player_id"] is None)
    return stats


def reconcile_draftguru_identities(cur, rep, persons: dict[str, dict], source_id: int,
                                   snapshot_label: str, acknowledged: bool) -> None:
    """external_identities(draftguru): one row per DraftGuru person, bridged or not.

    UNIQUE (source_id, external_id) on the byte-exact player_url makes ordinal collapse
    structurally impossible: /1 and /2 are two rows and nothing can merge them.
    """
    from common import check_population_drop

    cur.execute("SELECT external_id FROM external_identities WHERE source_id = %s",
                (source_id,))
    stored = {row[0] for row in cur.fetchall()}
    asserted = set(persons)
    check_population_drop(
        stored_count=len(stored), asserted_count=len(asserted),
        candidate_delete_count=len(stored - asserted),
        label="external_identities(draftguru)",
        acknowledged=acknowledged, reporter=rep,
    )

    notes = f"stage_a_snapshot={snapshot_label}"
    for url, person in persons.items():
        status = person["link_status"] if person["player_id"] is not None else "unmatched"
        cur.execute(
            """INSERT INTO external_identities
                 (source_id, external_id, external_name, external_url, player_id,
                  status, candidate_count, match_method, notes)
               VALUES (%s, %s, %s, %s, %s, %s, 0, %s, %s)
               ON CONFLICT (source_id, external_id) DO UPDATE
                  SET external_name = EXCLUDED.external_name,
                      external_url  = EXCLUDED.external_url,
                      player_id     = EXCLUDED.player_id,
                      status        = EXCLUDED.status,
                      match_method  = EXCLUDED.match_method,
                      notes         = EXCLUDED.notes""",
            (source_id, url, person["display_name_raw"], url, person["player_id"],
             status, person["match_method"], notes),
        )
    if stored - asserted:
        cur.execute(
            "DELETE FROM external_identities WHERE source_id = %s AND external_id <> ALL(%s)",
            (source_id, list(asserted)),
        )


# ---------------------------------------------------------------------------
# AFLDB-ISSUE-222 --link-only: Phase A (no Stage A page is opened)
# ---------------------------------------------------------------------------

def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_child_dataset(path: Path, url_re: re.Pattern) -> tuple[dict, str]:
    """The pinned deployment child, with its accepted/withheld partition proven complete.

    ``load_bridge`` above already validates ``bridges[]`` (canonical urls, no DraftGuru person
    bound to two identities, no identity claimed by two persons). This adds what link-only
    additionally depends on: that the child is a deployment artefact, that it names its parent,
    and that accepted + withheld PARTITION the population exactly -- no person counted twice,
    none left out, none carrying a blank reason. A child that does not partition cannot be used
    to reason about which persons must remain unlinked.
    """
    if not path.is_file():
        raise ImportFailure(f"missing bridge dataset: {path}")
    doc = load_json(path, "bridge dataset")
    if doc.get("kind") != "deployment":
        raise ImportFailure(
            "--link-only needs a deployment child (kind == 'deployment'); a source-evidence "
            "parent has not been resolved against any target's registration")
    if doc.get("schema_version") != 1:
        raise ImportFailure("unsupported bridge schema_version")
    parent_sha256 = doc.get("parent_sha256")
    if not isinstance(parent_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", parent_sha256):
        raise ImportFailure(
            "the deployment child does not name a pinned source-evidence parent "
            "(parent_sha256 must be a 64-character lowercase sha256); refusing to apply a "
            "bridge whose lineage cannot be stated")

    accepted = [row["player_url"] for row in doc.get("bridges") or []]
    withheld_rows = doc.get("withheld") or []
    withheld = [row["player_url"] for row in withheld_rows]
    for row in withheld_rows:
        if not row.get("reason"):
            raise ImportFailure("a withheld child row carries no reason; refusing to treat an "
                                "unexplained withholding as a decision")
    for url in accepted + withheld:
        if not url_re.match(url):
            raise ImportFailure("a child row is not keyed on a canonical player_url")
    if len(set(accepted)) != len(accepted) or len(set(withheld)) != len(withheld):
        raise ImportFailure("the deployment child repeats a person in bridges[] or withheld[]")
    overlap = set(accepted) & set(withheld)
    if overlap:
        raise ImportFailure(
            f"{len(overlap)} person(s) are both accepted and withheld in the deployment child; "
            "the partition is not a partition and nothing has been written")
    population = len(accepted) + len(withheld)
    if population != EXPECTED_PERSONS:
        raise ImportFailure(
            f"the deployment child partitions {population} persons, expected {EXPECTED_PERSONS}; "
            "it is not a whole-population child")
    return doc, sha256_file(path)


def validate_link_only(args) -> dict:
    """Phase A for ``--link-only``. Needs no psycopg AND no Stage A snapshot.

    Deliberately calls none of ``verify_stage_a_manifest``, ``verify_raw_bytes``,
    ``parser_mod.resolve_snapshot_dir``, ``parser_mod.parse_snapshot``,
    ``parser_mod.validate_identity``, ``build_persons`` or ``build_picks``: link-only's
    non-link state comes from the target, so opening a raw page would be reading a source it is
    not entitled to apply. ``parser_mod.load_contract()`` reads the tracked contract file under
    ``tools/`` -- the canonical-url regex -- which is not snapshot data.
    ``tests/python/draftguru_link_only_contract.py`` proves the absence by AST.
    """
    if not args.bridge:
        raise ImportFailure("--link-only requires --bridge")
    contract = parser_mod.load_contract()
    url_re = re.compile(contract["canonical_player_url"]["regex"])
    child_path = Path(args.bridge)
    child, child_sha256 = load_child_dataset(child_path, url_re)
    bridges = load_bridge(child_path, url_re)
    ledger = load_ledger()
    return {
        "contract": contract, "ledger": ledger, "bridges": bridges, "child": child,
        "child_sha256": child_sha256, "child_path": child_path, "label": args.label,
        "accepted": [row["player_url"] for row in child.get("bridges") or []],
        "withheld": {row["player_url"]: row["reason"] for row in child.get("withheld") or []},
    }


# ---------------------------------------------------------------------------
# --link-only: the stored population, and the preconditions it must satisfy
# ---------------------------------------------------------------------------

STORED_PERSON_SQL = """SELECT player_url, dg_person_id, display_name_raw, name_key,
                              player_id, link_status::text, match_method, confidence_notes,
                              reported_games, reported_goals, is_matching_backlog
                         FROM draft_persons WHERE source_id = %s"""
STORED_PICK_SQL = "SELECT player_url, draft_year, draft_kind FROM draft_picks WHERE source_id = %s"
STORED_IDENTITY_SQL = "SELECT external_id, notes FROM external_identities WHERE source_id = %s"


def read_stored_population(cur, source_id: int) -> dict:
    """The DraftGuru population as the target already holds it. This is link-only's ONLY
    source of non-link values: nothing here is derived from a snapshot."""
    cur.execute(STORED_PERSON_SQL, (source_id,))
    persons: dict[str, dict] = {}
    duplicate_urls: list[str] = []
    for row in cur.fetchall():
        (url, dg_person_id, display_name_raw, name_key, player_id, link_status, match_method,
         confidence_notes, reported_games, reported_goals, is_matching_backlog) = row
        if url in persons:
            duplicate_urls.append(url)
        persons[url] = {
            "player_url": url, "dg_person_id": dg_person_id,
            "display_name_raw": display_name_raw, "name_key": name_key,
            "reported_games": reported_games, "reported_goals": reported_goals,
            "stored_player_id": player_id, "stored_link_status": link_status,
            "stored_match_method": match_method, "stored_confidence_notes": confidence_notes,
            "stored_is_matching_backlog": is_matching_backlog,
        }

    cur.execute(STORED_PICK_SQL, (source_id,))
    pick_keys: list[tuple] = []
    seen_keys: set[tuple] = set()
    duplicate_pick_keys: list[tuple] = []
    for url, draft_year, draft_kind in cur.fetchall():
        key = (url, draft_year, draft_kind)
        if key in seen_keys:
            duplicate_pick_keys.append(key)
        seen_keys.add(key)
        pick_keys.append(key)

    cur.execute(STORED_IDENTITY_SQL, (source_id,))
    identity_notes: dict[str, str | None] = {}
    duplicate_identities: list[str] = []
    for external_id, notes in cur.fetchall():
        if external_id in identity_notes:
            duplicate_identities.append(external_id)
        identity_notes[external_id] = notes

    return {"persons": persons, "duplicate_urls": duplicate_urls, "pick_keys": pick_keys,
            "duplicate_pick_keys": duplicate_pick_keys, "identity_notes": identity_notes,
            "duplicate_identities": duplicate_identities}


def check_stored_population(stored: dict, prepared: dict, label: str) -> None:
    """Every precondition link-only depends on, checked before a single row is written."""
    persons = stored["persons"]
    pick_keys = stored["pick_keys"]
    identity_notes = stored["identity_notes"]

    if stored["duplicate_urls"]:
        raise ImportFailure(
            f"{len(stored['duplicate_urls'])} duplicate DraftGuru player_url(s) are stored; "
            "the population is not keyed and nothing has been written")
    if stored["duplicate_pick_keys"]:
        raise ImportFailure(
            f"{len(stored['duplicate_pick_keys'])} duplicate draft_picks reload key(s) are "
            "stored; nothing has been written")
    if stored["duplicate_identities"]:
        raise ImportFailure(
            f"{len(stored['duplicate_identities'])} duplicate external_identities(draftguru) "
            "row(s) are stored; nothing has been written")
    if len(persons) != EXPECTED_PERSONS:
        raise ImportFailure(
            f"the target holds {len(persons)} DraftGuru persons, expected {EXPECTED_PERSONS}. "
            "--link-only applies linkage to an already-loaded population and never creates, "
            "deletes or reloads one")
    if len(pick_keys) != EXPECTED_ROWS:
        raise ImportFailure(
            f"the target holds {len(pick_keys)} DraftGuru picks, expected {EXPECTED_ROWS}. "
            "--link-only never loads a pick")

    child_population = set(prepared["accepted"]) | set(prepared["withheld"])
    missing = sorted(child_population - set(persons))
    extra = sorted(set(persons) - child_population)
    if missing or extra:
        raise ImportFailure(
            f"the stored DraftGuru population and the deployment child's population differ "
            f"({len(missing)} in the child but not stored, {len(extra)} stored but not in the "
            "child). --link-only refuses to apply a bridge derived from a different population")

    orphan_picks = sorted({k[0] for k in pick_keys} - set(persons))
    if orphan_picks:
        raise ImportFailure(
            f"{len(orphan_picks)} stored DraftGuru pick(s) name a player_url that has no "
            "draft_persons row; nothing has been written")
    childless = sorted(set(persons) - {k[0] for k in pick_keys})
    if childless:
        raise ImportFailure(
            f"{len(childless)} stored DraftGuru person(s) have no pick; the stored population "
            "is not the one the child was derived from")

    if set(identity_notes) != set(persons):
        raise ImportFailure(
            f"external_identities(draftguru) does not hold exactly one row per stored person "
            f"({len(identity_notes)} identity rows vs {len(persons)} persons). --link-only "
            "never inserts or deletes an identity row, so it refuses to run against a "
            "population it cannot update in place")

    expected_notes = f"{IDENTITY_NOTES_PREFIX}{label}"
    wrong = {}
    for external_id, notes in identity_notes.items():
        if notes != expected_notes:
            wrong[notes] = wrong.get(notes, 0) + 1
    if wrong:
        shown = ", ".join(f"{value!r} x{count}"
                          for value, count in sorted(wrong.items(), key=lambda kv: -kv[1])[:3])
        raise ImportFailure(
            f"{sum(wrong.values())} of {len(identity_notes)} stored "
            f"external_identities(draftguru) rows do not carry notes {expected_notes!r} "
            f"(found {shown}). --link-only asserts the snapshot the untouched non-link data "
            "came from; pass the --label the target actually holds, and never a label chosen "
            "to make the check pass")

    for url in prepared["ledger"]:
        if url not in persons:
            raise ImportFailure(
                "an explicit decision names a DraftGuru person the target does not carry; "
                "nothing has been written")
    for url in prepared["bridges"]:
        if url not in persons:
            raise ImportFailure(
                "the bridge dataset names a DraftGuru person the target does not carry; "
                "nothing has been written")


ALLOWED_PERSON_STATES = (
    ("unique", BRIDGE_MATCH_METHOD, True),
    ("resolved", LEDGER_MATCH_METHOD, True),
    (UNLINKED_DEFAULT, None, False),
    (UNLINKED_DEFAULT, LEDGER_MATCH_METHOD, False),
)


def check_link_only_authority(persons: dict[str, dict], prepared: dict, stats: dict) -> None:
    """Fail-closed checks on the DECIDED state, before it is written."""
    if stats["seeded"] != 0:
        raise ImportFailure(
            "--link-only would have to mint a canonical player shell; it never creates a "
            "player and --no-seed is mandatory in this mode")

    bad = [(url, p["link_status"], p["match_method"]) for url, p in persons.items()
           if (p["link_status"], p["match_method"], p["player_id"] is not None)
           not in ALLOWED_PERSON_STATES]
    if bad:
        raise ImportFailure(
            f"{len(bad)} person(s) computed to a link state outside the allowed vocabulary "
            f"(first: {bad[0]}); nothing has been written")

    claimed: dict[int, list[str]] = {}
    for url, person in persons.items():
        if person["player_id"] is not None:
            claimed.setdefault(person["player_id"], []).append(url)
    duplicates = {pid: urls for pid, urls in claimed.items() if len(urls) > 1}
    if duplicates:
        raise ImportFailure(
            f"{len(duplicates)} canonical player(s) would be claimed by more than one DraftGuru "
            "person after this run; refusing to merge two people. Nothing has been written")

    for url, reason in prepared["withheld"].items():
        person = persons.get(url)
        if person is not None and person["match_method"] == BRIDGE_MATCH_METHOD:
            raise ImportFailure(
                f"a person withheld by the deployment child ({reason}) computed to a "
                "bridge link; nothing has been written")


# ---------------------------------------------------------------------------
# --link-only: the write set, and nothing else
# ---------------------------------------------------------------------------
# Three set-based statements, one per table. Each names ONLY its table's link columns in its
# SET clause; each is scoped to the DraftGuru source_id and keyed on the stored row's own
# natural key; each writes only the rows whose link state actually differs, so a re-run over an
# already-linked target is a genuine no-op rather than a silent rewrite. No temp table, no
# COPY, no DELETE, no INSERT, no SET CONSTRAINTS: dg_person_id is never touched, so the
# deferrable unique constraint the full reload needs is irrelevant here.

PERSON_LINK_UPDATE_SQL = """
UPDATE draft_persons AS t
   SET player_id = v.player_id,
       link_status = v.link_status::link_status,
       match_method = v.match_method,
       confidence_notes = v.confidence_notes,
       is_matching_backlog = v.is_matching_backlog
  FROM unnest(%s::text[], %s::int[], %s::text[], %s::text[], %s::text[], %s::boolean[])
         AS v(player_url, player_id, link_status, match_method, confidence_notes,
              is_matching_backlog)
 WHERE t.source_id = %s
   AND t.player_url = v.player_url
   AND (t.player_id, t.link_status::text, t.match_method, t.confidence_notes,
        t.is_matching_backlog)
       IS DISTINCT FROM
       (v.player_id, v.link_status, v.match_method, v.confidence_notes, v.is_matching_backlog)
"""

PICK_LINK_UPDATE_SQL = """
UPDATE draft_picks AS t
   SET player_id = v.player_id,
       link_status_value = v.link_status::link_status,
       match_method = v.match_method,
       confidence_notes = v.confidence_notes
  FROM unnest(%s::text[], %s::int[], %s::text[], %s::text[], %s::text[])
         AS v(player_url, player_id, link_status, match_method, confidence_notes)
 WHERE t.source_id = %s
   AND t.player_url = v.player_url
   AND (t.player_id, t.link_status_value::text, t.match_method, t.confidence_notes)
       IS DISTINCT FROM
       (v.player_id, v.link_status, v.match_method, v.confidence_notes)
"""

IDENTITY_LINK_UPDATE_SQL = """
UPDATE external_identities AS t
   SET player_id = v.player_id,
       status = v.status::link_status,
       match_method = v.match_method
  FROM unnest(%s::text[], %s::int[], %s::text[], %s::text[])
         AS v(external_id, player_id, status, match_method)
 WHERE t.source_id = %s
   AND t.external_id = v.external_id
   AND (t.player_id, t.status::text, t.match_method)
       IS DISTINCT FROM
       (v.player_id, v.status, v.match_method)
"""


def set_clause_columns(sql: str) -> tuple[str, ...]:
    """The column names a statement's SET clause assigns, in order.

    A proof rather than a parser: the three statements above are module constants, and the gate
    and the contract both read their SET clauses back through this function instead of trusting
    a comment. A column added to a SET clause shows up here immediately and fails the contract.
    """
    body = re.search(r"\bSET\b(.*?)\bFROM\b", sql, re.IGNORECASE | re.DOTALL)
    if body is None:
        raise ImportFailure("a link-only statement has no SET ... FROM clause")
    return tuple(m.group(1) for m in re.finditer(r"(?:^|,)\s*([a-z_]+)\s*=", body.group(1)))


def link_only_write_set() -> dict[str, tuple[str, ...]]:
    """The mode's committed write set, read back off the statements themselves."""
    return {
        "draft_persons": set_clause_columns(PERSON_LINK_UPDATE_SQL),
        "draft_picks": set_clause_columns(PICK_LINK_UPDATE_SQL),
        "external_identities": set_clause_columns(IDENTITY_LINK_UPDATE_SQL),
    }


def link_only_rows(persons: dict[str, dict]) -> dict[str, list]:
    """The per-person link values, as parallel arrays for the three statements above."""
    urls = sorted(persons, key=lambda u: u.encode("utf-8"))
    player_ids, statuses, methods, notes, backlog, identity_statuses = [], [], [], [], [], []
    for url in urls:
        person = persons[url]
        linked = person["player_id"] is not None
        player_ids.append(person["player_id"])
        statuses.append(person["link_status"])
        methods.append(person["match_method"])
        notes.append(person["confidence_notes"])
        # migration 019's draft_persons_backlog_ck: a backlog row must be unlinked AND have
        # played. Derived from the STORED reported_games, never from a snapshot.
        backlog.append(not linked and (person["reported_games"] or 0) > 0)
        identity_statuses.append(person["link_status"] if linked else UNLINKED_DEFAULT)
    return {"urls": urls, "player_ids": player_ids, "statuses": statuses, "methods": methods,
            "notes": notes, "backlog": backlog, "identity_statuses": identity_statuses}


def write_link_columns(cur, persons: dict[str, dict], source_id: int) -> dict[str, int]:
    rows = link_only_rows(persons)
    cur.execute(PERSON_LINK_UPDATE_SQL,
                (rows["urls"], rows["player_ids"], rows["statuses"], rows["methods"],
                 rows["notes"], rows["backlog"], source_id))
    persons_updated = cur.rowcount
    cur.execute(PICK_LINK_UPDATE_SQL,
                (rows["urls"], rows["player_ids"], rows["statuses"], rows["methods"],
                 rows["notes"], source_id))
    picks_updated = cur.rowcount
    cur.execute(IDENTITY_LINK_UPDATE_SQL,
                (rows["urls"], rows["player_ids"], rows["identity_statuses"], rows["methods"],
                 source_id))
    identities_updated = cur.rowcount
    return {"draft_persons": persons_updated, "draft_picks": picks_updated,
            "external_identities": identities_updated}


def batch_notes(prepared: dict, label: str) -> str:
    """The audit row's own statement of what this run was. Honest provenance: the mode and the
    label of the snapshot whose data the run did NOT rewrite, plus the child it applied."""
    return (f"mode={LINK_ONLY_MODE} {IDENTITY_NOTES_PREFIX}{label} "
            f"bridge_sha256={prepared['child_sha256']} "
            f"parent_sha256={prepared['child']['parent_sha256']}")


def run_link_only_import(args, prepared: dict, rep) -> int:
    """The link-only write path. Separate from ``run_import`` on purpose: the full reload's
    behaviour is not branched on a flag, so it cannot drift, and the atomicity contract that
    pins it keeps testing exactly the code it was written against."""
    from common import analyze, connect_pg, import_batch, require_env, safe_dsn

    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  target: {safe_dsn(dsn)}")
    pg = connect_pg(dsn)

    with import_batch(pg, SOURCE_KEY, "import_draftguru.py", "draft_persons",
                      notes=batch_notes(prepared, args.label)) as batch:
        with pg.cursor() as cur:
            source_id = resolve_source_id(cur, SOURCE_KEY)
            afltables_source_id = resolve_source_id(cur, AFLTABLES_SOURCE_KEY)
            afl_players = resolve_afltables_players(cur, afltables_source_id)
            manual_players = resolve_manual_players(cur)
            live = read_live_decisions(cur, source_id)
            cur.execute(
                """SELECT external_id, player_id FROM external_identities
                    WHERE source_id = %s AND player_id IS NOT NULL""",
                (source_id,),
            )
            dg_identities = dict(cur.fetchall())

            stored = read_stored_population(cur, source_id)
            check_stored_population(stored, prepared, args.label)
            persons = stored["persons"]
            batch.records_read = len(stored["pick_keys"])

            # The same function, the same authority order, seeding forbidden. Every non-link
            # value in `persons` came from the target and is never written back.
            authority = apply_authority(
                cur, rep, persons, prepared["ledger"], live, prepared["bridges"],
                afl_players, source_id, dg_identities, seeds_allowed=False,
                manual_players=manual_players,
            )
            check_link_only_authority(persons, prepared, authority)

            updated = write_link_columns(cur, persons, source_id)
            batch.records_updated = sum(updated.values())

        # value(), not result(): both are strings, and Reporter.result() is the count column
        # (it renders with a thousands separator, which a string cannot carry).
        rep.value("mode", LINK_ONLY_MODE)
        rep.value("stage_a_snapshot (asserted, not rewritten)", args.label)
        rep.result("persons", len(persons))
        rep.result("picks", batch.records_read)
        for name, value in authority.items():
            rep.result(f"authority: {name}", value)
        for table, count in updated.items():
            rep.result(f"rows updated: {table}", count)

        if args.dry_run:
            raise DryRunComplete()

    # Outside the batch block for the same reason the full path is (see "Atomicity" above):
    # analyze() commits before switching to autocommit, which inside the block would split the
    # linkage commit from the `completed` status.
    analyze(pg, "draft_persons", "draft_picks", "external_identities")
    return 0


def link_only_cli_refusal(args) -> str | None:
    """The mode's CLI contract, as a pure function so every combination is testable without a
    database, a snapshot or a subprocess. Returns the refusal message, or None to proceed."""
    if not args.link_only:
        return None
    if not args.bridge:
        return ("--link-only requires --bridge: the mode applies an already-reviewed "
                "deployment child and has nothing to apply without one")
    if not args.no_seed:
        return ("--link-only requires --no-seed: the mode never creates a canonical player, "
                "and a run that could mint one is not link-only")
    if not getattr(args, "label_explicit", False):
        return ("--link-only requires an explicit --label: the mode asserts which Stage A "
                "snapshot the target's untouched non-link data came from, and a default is "
                "not an assertion")
    if args.acknowledge_population_drop:
        return ("--link-only refuses --acknowledge-population-drop: the mode never deletes a "
                "row, so there is no population drop to acknowledge")
    if args.snapshot_root is not None:
        return ("--link-only refuses --snapshot-root: no Stage A page, manifest or parsed "
                "artefact is read in this mode, so naming a snapshot root would be misleading")
    return None


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def validate(args) -> dict:
    """Phase A in full. Needs no psycopg."""
    contract = parser_mod.load_contract()
    manifest = verify_stage_a_manifest(args.label)
    snapshot_dir = parser_mod.resolve_snapshot_dir(contract, args.snapshot_root, args.label)
    year_count = verify_raw_bytes(manifest, snapshot_dir)

    parse_result = parser_mod.parse_snapshot(contract, snapshot_dir, require_complete=True)
    parser_mod.validate_identity(contract, parse_result, require_complete=True,
                                 accept_baseline_drift=False)

    event_map, signing_vocab = load_event_mapping()
    club_slugs, deliberate_null = load_club_rules(contract)
    competition_of = build_competition_resolver(load_json(SEASONS_PATH, "seasons reference"))
    ledger = load_ledger()
    url_re = re.compile(contract["canonical_player_url"]["regex"])
    bridges = load_bridge(Path(args.bridge) if args.bridge else None, url_re)

    persons = build_persons(parse_result)
    picks = build_picks(parse_result, persons, event_map, signing_vocab,
                        club_slugs, deliberate_null, competition_of)

    for url in ledger:
        if url not in persons:
            raise ImportFailure(
                "a ledger decision names a person the accepted snapshot does not carry")

    return {
        "contract": contract, "manifest": manifest, "snapshot_dir": snapshot_dir,
        "year_count": year_count, "persons": persons, "picks": picks,
        "ledger": ledger, "bridges": bridges,
    }


def run_import(args, prepared: dict, rep) -> int:
    from common import (analyze, connect_pg, import_batch, reload_keyed,
                        replay_admin_overrides, report_reload, require_env, safe_dsn)

    persons: dict[str, dict] = prepared["persons"]
    picks: list[dict] = prepared["picks"]

    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  target: {safe_dsn(dsn)}")
    pg = connect_pg(dsn)

    with import_batch(pg, SOURCE_KEY, "import_draftguru.py", "draft_picks") as batch:
        batch.records_read = len(picks)
        with pg.cursor() as cur:
            source_id = resolve_source_id(cur, SOURCE_KEY)
            afltables_source_id = resolve_source_id(cur, AFLTABLES_SOURCE_KEY)
            club_ids = resolve_club_ids(cur)
            afl_players = resolve_afltables_players(cur, afltables_source_id)
            manual_players = resolve_manual_players(cur)
            live = read_live_decisions(cur, source_id)

            cur.execute(
                """SELECT external_id, player_id FROM external_identities
                    WHERE source_id = %s AND player_id IS NOT NULL""",
                (source_id,),
            )
            dg_identities = dict(cur.fetchall())

            authority = apply_authority(
                cur, rep, persons, prepared["ledger"], live, prepared["bridges"],
                afl_players, source_id, dg_identities, seeds_allowed=not args.no_seed,
                manual_players=manual_players,
            )

            # dg_person_id is a per-load rank, so a reload can PERMUTE it; migration 069 made
            # this constraint deferrable so the whole statement is checked once.
            cur.execute(
                "SET CONSTRAINTS draft_persons_source_id_dg_person_id_key DEFERRED")

        person_stats = reload_keyed(
            pg, "draft_persons", PERSON_KEY, PERSON_COLUMNS,
            (
                (source_id, p["dg_person_id"], p["player_url"], p["display_name_raw"],
                 p["name_key"], p["player_id"], p["link_status"], 0, p["match_method"],
                 p["confidence_notes"], p["reported_games"], p["reported_goals"],
                 p["player_id"] is None and p["reported_games"] > 0)
                for p in persons.values()
            ),
            batch,
            link_columns=None,
            scope_column="source_id", scope_values=[source_id],
            delete_missing=False,
        )

        with pg.cursor() as cur:
            cur.execute("SELECT player_url, id FROM draft_persons WHERE source_id = %s",
                        (source_id,))
            person_ids = dict(cur.fetchall())

        def pick_rows():
            for pick in picks:
                person = persons[pick["player_url"]]
                slug = pick["club_slug"]
                yield (
                    pick["draft_year"], pick["draft_type"], pick["draft_kind"],
                    pick["pick_number"], pick["pick_note"],
                    person["player_id"], pick["player_name_raw"],
                    person["link_status"], 0, person["match_method"],
                    person["confidence_notes"],
                    club_ids[slug] if slug else None,
                    pick["club_name_raw"], pick["original_club_raw"],
                    pick["draft_age"], pick["height_cm"],
                    None,                      # weight_kg — no source, not imported
                    None,                      # grade — parity-only, not promoted
                    pick["competition"], pick["signing"], pick["signing_kind"],
                    None,                      # signing_detail — class D, not imported
                    pick["detail"],
                    source_id, pick["source_record_id"], batch.id,
                    person_ids[pick["player_url"]], person["dg_person_id"],
                    pick["player_url"], person["reported_games"], person["reported_goals"],
                )

        # refuse_out_of_scope_key is retained as defence for a future key change, but it
        # is UNREACHABLE under migration 069's key and must not be read as active
        # protection: source_id is part of the reload key, so the check's join can only
        # match rows whose source_id already equals this loader's, which its own
        # `(scope) IS NOT TRUE` predicate then excludes. Cross-ownership collision is
        # instead prevented structurally — draft_picks_source_uq is PARTIAL on
        # `source_id IS NOT NULL`, so an admin row (source_id NULL) sharing a natural key
        # is outside both the index and this reload's scope. That guarantee is proven by
        # tests/integration/draftguru-import.test.ts -> 'ownership boundary'.
        pick_stats = reload_keyed(
            pg, "draft_picks", PICK_KEY, PICK_COLUMNS, pick_rows(), batch,
            link_columns=None,
            scope_column="source_id", scope_values=[source_id],
            refuse_out_of_scope_key=True,
        )

        with pg.cursor() as cur:
            # A person exists only because a pick references them, so a childless person is
            # exactly one the source no longer carries. NO ACTION FK ordering (ISSUE-078).
            cur.execute(
                """DELETE FROM draft_persons p
                    WHERE p.source_id = %s
                      AND NOT EXISTS (SELECT 1 FROM draft_picks k
                                       WHERE k.draft_person_id = p.id)""",
                (source_id,),
            )
            person_stats.deleted = cur.rowcount

            reconcile_draftguru_identities(
                cur, rep, persons, source_id, args.label, args.acknowledge_population_drop)

        replay_admin_overrides(pg, "draft_picks")

        report_reload(rep, "draft_persons", person_stats)
        report_reload(rep, "draft_picks", pick_stats)
        rep.result("persons", len(persons))
        rep.result("picks", len(picks))
        for name, value in authority.items():
            rep.result(f"authority: {name}", value)

        if args.dry_run:
            raise DryRunComplete()

    # Deliberately OUTSIDE the batch block. analyze() commits any open transaction before it
    # switches to autocommit; inside the block that commit landed the data BEFORE
    # batch.finish("completed") ran, leaving a window in which a crash or a failed ANALYZE
    # left committed data beside a `running` / `failed` batch row. Here the data and the
    # `completed` status share the single commit issued by import_batch's success path, and
    # ANALYZE runs on an already-consistent database (planner statistics only; never data).
    analyze(pg, "draft_persons", "draft_picks", "external_identities")

    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Import DraftGuru draft facts from the accepted "
                                             "Stage A snapshot.")
    # Default None, then substituted below: the effective default is unchanged
    # (STAGE_A_LABEL), and --link-only additionally gets to know whether the operator stated
    # the label or merely inherited it.
    ap.add_argument("--label", default=None,
                    help=f"accepted Stage A snapshot label (default {STAGE_A_LABEL}; "
                         "mandatory and explicit under --link-only)")
    ap.add_argument("--snapshot-root", default=None)
    ap.add_argument("--bridge", default=None,
                    help="path to an APPROVED bridge dataset (Stage B3). Stage B1's profiling "
                         "snapshot is not such a dataset and is never read.")
    ap.add_argument("--link-only", action="store_true",
                    help="apply ONLY the reviewed trusted linkage to an already-loaded "
                         "DraftGuru population; reads no Stage A page and rewrites no "
                         "source-owned column. Requires --bridge, --no-seed and an explicit "
                         "--label.")
    ap.add_argument("--validate-only", action="store_true",
                    help="run every input check and stop; needs no database driver")
    ap.add_argument("--dry-run", action="store_true",
                    help="run the whole transaction, then roll it back")
    ap.add_argument("--no-seed", action="store_true",
                    help="refuse to mint a minimal canonical player shell")
    ap.add_argument("--acknowledge-population-drop", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    args.label_explicit = args.label is not None
    if args.label is None:
        args.label = STAGE_A_LABEL

    if args.link_only:
        return main_link_only(args)

    print("AFLDB DraftGuru import (Stage B2-4/5)")
    try:
        prepared = validate(args)
    except (ImportFailure, parser_mod.ParseFailure) as exc:
        print(f"\nREFUSED: {exc}")
        return 1

    print(f"  snapshot   : {args.label} ({prepared['year_count']} year pages, sha256 verified)")
    print(f"  persons    : {len(prepared['persons'])}")
    print(f"  picks      : {len(prepared['picks'])}")
    print(f"  ledger     : {len(prepared['ledger'])} explicit decisions")
    print(f"  bridge     : {len(prepared['bridges'])} entries"
          f"{'' if args.bridge else ' (no bridge dataset supplied)'}")
    if args.validate_only:
        print("\nvalidate-only: every input check passed. No database was contacted.")
        return 0

    from common import Reporter, load_env
    load_env()
    rep = Reporter(verbose=not args.quiet)
    try:
        return run_import(args, prepared, rep)
    except DryRunComplete:
        print("\n" + DRY_RUN_MESSAGE)
        return 0
    except ImportFailure as exc:
        print(f"\nREFUSED: {exc}")
        return 1


def main_link_only(args) -> int:
    """``--link-only``'s own entry point. Shares no branch with the full reload above."""
    print("AFLDB DraftGuru import (AFLDB-ISSUE-222 --link-only: trusted linkage only)")
    refusal = link_only_cli_refusal(args)
    if refusal is not None:
        print(f"\nREFUSED: {refusal}")
        return 1
    try:
        prepared = validate_link_only(args)
    except ImportFailure as exc:
        print(f"\nREFUSED: {exc}")
        return 1

    print(f"  mode       : {LINK_ONLY_MODE} (no Stage A page, manifest or parsed artefact read)")
    print(f"  label      : {args.label} (asserted against every stored identity row's notes)")
    print(f"  child      : {prepared['child_path'].name} {prepared['child_sha256'][:16]}...")
    print(f"  parent     : {prepared['child']['parent_sha256'][:16]}... (lineage pinned)")
    print(f"  ledger     : {len(prepared['ledger'])} explicit decisions")
    print(f"  bridge     : {len(prepared['bridges'])} accepted, "
          f"{len(prepared['withheld'])} withheld, "
          f"{len(prepared['bridges']) + len(prepared['withheld'])} partitioned")
    for table, columns in link_only_write_set().items():
        print(f"  write set  : {table} -> {', '.join(columns)}")
    if args.validate_only:
        print("\nvalidate-only: every input check passed. No database was contacted.")
        return 0

    from common import Reporter, load_env
    load_env()
    rep = Reporter(verbose=not args.quiet)
    try:
        return run_link_only_import(args, prepared, rep)
    except DryRunComplete:
        print("\n" + LINK_ONLY_DRY_RUN_MESSAGE)
        return 0
    except ImportFailure as exc:
        print(f"\nREFUSED: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
