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


def apply_authority(cur, rep, persons: dict[str, dict], ledger: dict[str, dict],
                    live: dict[str, dict], bridges: dict[str, str],
                    afl_players: dict[str, list[int]], source_id: int,
                    dg_identities: dict[str, int], seeds_allowed: bool) -> dict:
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
    from common import (analyze, connect_pg, import_batch, reload_keyed, report_reload,
                        require_env, safe_dsn)

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

        report_reload(rep, "draft_persons", person_stats)
        report_reload(rep, "draft_picks", pick_stats)
        rep.result("persons", len(persons))
        rep.result("picks", len(picks))
        for name, value in authority.items():
            rep.result(f"authority: {name}", value)

        if args.dry_run:
            raise DryRunComplete()

        analyze(pg, "draft_persons", "draft_picks", "external_identities")

    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Import DraftGuru draft facts from the accepted "
                                             "Stage A snapshot.")
    ap.add_argument("--label", default=STAGE_A_LABEL, help="accepted Stage A snapshot label")
    ap.add_argument("--snapshot-root", default=None)
    ap.add_argument("--bridge", default=None,
                    help="path to an APPROVED bridge dataset (Stage B3). Stage B1's profiling "
                         "snapshot is not such a dataset and is never read.")
    ap.add_argument("--validate-only", action="store_true",
                    help="run every input check and stop; needs no database driver")
    ap.add_argument("--dry-run", action="store_true",
                    help="run the whole transaction, then roll it back")
    ap.add_argument("--no-seed", action="store_true",
                    help="refuse to mint a minimal canonical player shell")
    ap.add_argument("--acknowledge-population-drop", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

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
        print("\nDRY RUN — the transaction was rolled back; nothing was written.")
        return 0
    except ImportFailure as exc:
        print(f"\nREFUSED: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
