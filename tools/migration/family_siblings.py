#!/usr/bin/env python3
"""Football-family siblings: normalise the legacy Wikipedia export, load canonical sibling rows.

    python tools/migration/family_siblings.py normalize          # writes the tracked artefact
    python tools/migration/family_siblings.py normalize --check  # tracked artefact == regeneration
    python tools/migration/family_siblings.py load --validate-only
    python tools/migration/family_siblings.py load --dry-run
    python tools/migration/family_siblings.py load

Why this exists (AFLDB-ISSUE-118 §23.31, family F — siblings)
-------------------------------------------------------------
``player_relationships`` (migration 006) is the general football-family model
and until now held only the 127 ``parent_child`` rows the father–son loader
writes. The Gridley criterion ``brother`` ("Has at least one brother who has
played in the VFL/AFL") needs explicit sibling evidence, and the only accepted
lineage source is the legacy Sports Data Lab export of the Wikipedia article
"List of Australian rules football families": ``family_members`` (identity
rows: name, Wikipedia URL, listed clubs) and ``family_relationships`` (one row
per person pair with the sentence that evidences it). Both are operator exports
under ``data/players/families/`` (raw, untracked). Only ``relationship_type =
'sibling'`` rows are used; every other type stays where it is, and the export's
father–son material is NOT re-imported (that domain is already canonical).

Identity — the ``normalize`` step (run once against a canonically rebuilt
database, output tracked)
-----------------------------------------------------------------------
Nothing downstream ever matches a name. Each person named in a sibling row is
resolved ONCE to an AFL Tables profile path (the identity ``external_identities``
holds) by these rules, in this order, with the outcome and its reason recorded:

* names are normalised exactly as the father–son normaliser does (diacritics,
  punctuation, middle initials, ``Sr.``/``Jr.``);
* same-name candidates are the players with an AFL Tables identity, one per
  player; ``Sr.``/``Jr.`` keep the earliest/latest debut only when unique;
* the member's listed clubs, when any of them is a VFL/AFL organisation, must
  contain one the candidate played for (organisation lineage: Footscray is
  the Western Bulldogs, South Melbourne is Sydney, the Bears and Fitzroy are
  the Lions'). Listed clubs that are ALL outside the VFL/AFL (state-league
  lists, "Carlton coach") mean the source says this person did not play
  VFL/AFL: unlinked, whatever the name matches;
* when more than one candidate remains and the member's Wikipedia article
  title carries a birth-year disambiguator ("…(footballer, born 1940)"), the
  candidate whose canonical birth year equals it is chosen — only if every
  candidate has a birth year, so the rule can never choose by elimination;
* exactly one candidate is ``unique``; none is ``unmatched`` (most relatives
  never played VFL/AFL, and a few 2025 debutants post-date the fitzRoy
  snapshot); more than one is ``ambiguous`` and stays UNLINKED — the
  candidates are recorded — unless a tracked adjudication decides it;
* adjudications (``data/players/sibling-adjudications.csv``) are keyed by the
  export's stable ``source_member_id`` and carry the evidence and the date;
  each names a profile path or explicitly leaves the person unlinked, must be
  NEEDED (its member would otherwise not be ``unique``) and must apply to
  exactly one member, so a stale adjudication refuses the run.

Coverage — the export is evidence of presence, never of absence
-----------------------------------------------------------------
A pair the export does not carry is UNKNOWN, not "no brother": the article's
prose rule missed pairs (Gary Ablett Jr and Nathan Ablett, whom the family
sentence names only as their father's sons). Such a pair is admitted only with
explicit independent evidence, through ``data/players/sibling-supplements.csv``:
one row per pair naming both AFL Tables profile paths, the label, the evidence
(the sentence that states the relationship, never a shared parent or surname)
and the date. A supplement must be NEEDED (the export must not already carry
the pair) and both profiles must be canonical identities, or the run refuses.
Supplement rows carry ``source_label = supplement`` and their own key.

The legacy export's own ``player_id`` / ``match_status`` (name-matched in the
legacy database) are carried as audit columns and never used to link: the
canonical rebuild does not seed ``legacy_player_id``, so they map to nothing.

Semantics — what a row asserts
------------------------------
Every sibling row of the export becomes one canonical ``sibling`` row. The pair
is ordered deterministically (by profile path, else by normalised name; roles
travel with their person) so a reversed source ordering cannot create a second
canonical pair, and the export's unordered pairs are checked unique; a family the
article lists twice (two source rows resolving to the same two identities) becomes
one canonical pair with the merged source key recorded. Two people resolving to
the same profile refuse the run (a self-pair). The canonical
``relationship_label`` states what the source evidences about sex:

* ``brothers`` — the export's ``siblings/brothers`` label (every such sentence
  says "brothers"), or any sibling sentence that says brother(s);
* ``twin brothers`` — a ``twins`` row that is brothers by the rule above, or
  whose two people both resolve to canonical VFL/AFL players (the competition
  is men's, so two players who are siblings are brothers);
* ``brothers`` likewise for a plain ``siblings`` row whose two people both
  resolve to canonical players;
* ``sisters`` — a sentence that says sister(s) (AFLW relatives; unlinked here);
* otherwise the export's label (``twins``, ``siblings``) — sex not evidenced.

A player HAS A BROTHER WHO PLAYED VFL/AFL exactly when a ``brothers`` /
``twin brothers`` row links both sides and the other side played a match.

Loading — the ``load`` step (the rebuild stage)
------------------------------------------------
Reads only the tracked artefact; resolves every non-empty profile through
``external_identities`` (source ``afltables``, ``match_method
afltables_profile_url``, status unique/resolved) and refuses any that does not
resolve or any link status disagreeing with its profile. Upserts one
``player_relationships`` row per pair on ``(source wikipedia, source_record_id
'siblings:<source_key>')`` and removes stale rows of this prefix. Idempotent:
a second identical load changes nothing.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    Reporter, connect_pg, import_batch, load_env, require_env, safe_dsn,
)
from father_son import PROFILE_RE, normalise_name  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "players" / "families"
DEFAULT_MEMBERS = DEFAULT_RAW_DIR / "family_members.csv"
DEFAULT_RELATIONSHIPS = DEFAULT_RAW_DIR / "family_relationships.csv"
DEFAULT_ARTEFACT = REPO_ROOT / "data" / "players" / "sibling-relationships.csv"
DEFAULT_ADJUDICATIONS = REPO_ROOT / "data" / "players" / "sibling-adjudications.csv"
DEFAULT_SUPPLEMENTS = REPO_ROOT / "data" / "players" / "sibling-supplements.csv"
DEFAULT_PROVENANCE = REPO_ROOT / "data" / "players" / "sibling-relationships.source.json"

SOURCE_KEY = "wikipedia"
IDENTITY_SOURCE_KEY = "afltables"
MATCH_METHOD = "afltables_profile_url"
TOOL = "family_siblings.py"
RELATIONSHIP_PREFIX = "siblings"
SOURCE_ARTICLE = "List of Australian rules football families"

MEMBER_COLUMNS = ["source_member_id", "family_key", "family_name", "member_name", "member_wikipedia_url",
                  "clubs_raw", "parent_source_member_id", "explicit_relation_label", "source_url",
                  "source_revision_id", "player_id", "match_status", "candidate_count",
                  "candidate_player_ids", "match_notes"]
RELATIONSHIP_COLUMNS = ["source_relationship_id", "family_key", "family_name", "person_a_source_member_id",
                        "person_a_name", "person_a_role", "person_b_source_member_id", "person_b_name",
                        "person_b_role", "relationship_type", "relationship_label", "evidence",
                        "extraction_method", "confidence", "source_url", "source_revision_id"]
ARTEFACT_COLUMNS = [
    "source_key", "family_key", "family_name",
    "person_a_name", "person_a_role", "person_a_wikipedia", "person_a_clubs", "person_a_legacy",
    "person_a_profile", "person_a_link", "person_a_note",
    "person_b_name", "person_b_role", "person_b_wikipedia", "person_b_clubs", "person_b_legacy",
    "person_b_profile", "person_b_link", "person_b_note",
    "relationship_label", "source_label", "evidence", "extraction_method", "source_revision_id", "also_source_keys",
]
ADJUDICATION_COLUMNS = ["source_member_id", "member_name", "afltables_profile", "evidence", "decided_on"]
SUPPLEMENT_COLUMNS = ["supplement_key", "family_key", "family_name", "person_a_name", "person_a_profile",
                      "person_b_name", "person_b_profile", "relationship_label", "evidence", "decided_on"]

LINKS = ("unique", "resolved", "unmatched", "ambiguous")
BROTHER_LABELS = ("brothers", "twin brothers")
SOURCE_LABELS = ("siblings/brothers", "siblings", "twins")
SUPPLEMENT_LABEL = "supplement"
CANONICAL_LABELS = (*BROTHER_LABELS, "sisters", "twins", "siblings")

SOURCE_KEY_RE = re.compile(r"^[0-9a-f]{24}$")
SUPPLEMENT_KEY_RE = re.compile(r"^afldb-sibling-supplement:\d{3}$")
BORN_RE = re.compile(r"born[_ ](\d{4})")
BROTHER_WORD_RE = re.compile(r"\bbrothers?\b", re.I)
SISTER_WORD_RE = re.compile(r"\bsisters?\b", re.I)

# Spellings the export uses for VFL/AFL organisations -> club_organizations.slug.
CLUB_ORG = {
    "footscray": "western-bulldogs", "western bulldogs": "western-bulldogs",
    "south melbourne": "sydney", "sydney swans": "sydney",
    "brisbane": "brisbane-lions", "brisbane lions": "brisbane-lions",
    "kangaroos": "north-melbourne", "north melbourne kangaroos": "north-melbourne",
    "gws": "greater-western-sydney", "gws giants": "greater-western-sydney",
    "greater western sydney": "greater-western-sydney",
    "west coast eagles": "west-coast", "adelaide crows": "adelaide",
    "port adelaide power": "port-adelaide", "gold coast suns": "gold-coast",
    "geelong cats": "geelong", "st kilda": "st-kilda",
}
LINEAGE = {"brisbane-lions": ("brisbane-lions", "brisbane-bears", "fitzroy")}
_CLUB_SPLIT_RE = re.compile(r"\s*(?:,|/|&|;|\band\b)\s*")


class SiblingSourceError(ValueError):
    """The export, the adjudications or the artefact cannot be accepted as written."""


# ---------------------------------------------------------------------------
# The raw export
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Member:
    source_member_id: str
    family_key: str
    family_name: str
    name: str
    wikipedia_url: str
    clubs_raw: str
    legacy_player_id: str
    legacy_status: str
    legacy_candidates: str


@dataclass(frozen=True)
class SiblingRow:
    line: int
    source_relationship_id: str
    family_key: str
    family_name: str
    a_id: str
    a_name: str
    a_role: str
    b_id: str
    b_name: str
    b_role: str
    label: str
    evidence: str
    extraction_method: str
    confidence: str
    source_url: str
    source_revision_id: str


def _open(path: Path, required: list[str]) -> list[dict[str, str]]:
    if not path.is_file():
        raise SiblingSourceError(f"raw export missing: {path}")
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in required if c not in (reader.fieldnames or [])]
        if missing:
            raise SiblingSourceError(f"{path.name} lacks columns {missing}")
        return list(reader)


def read_members(path: Path) -> dict[str, Member]:
    out: dict[str, Member] = {}
    for i, r in enumerate(_open(path, MEMBER_COLUMNS), start=2):
        mid = (r["source_member_id"] or "").strip()
        if not SOURCE_KEY_RE.match(mid):
            raise SiblingSourceError(f"{path.name} line {i}: source_member_id {mid!r} malformed")
        if mid in out:
            raise SiblingSourceError(f"{path.name} line {i}: duplicate source_member_id {mid}")
        if not (r["member_name"] or "").strip():
            raise SiblingSourceError(f"{path.name} line {i}: empty member_name")
        out[mid] = Member(mid, r["family_key"].strip(), r["family_name"].strip(), r["member_name"].strip(),
                          (r["member_wikipedia_url"] or "").strip(), (r["clubs_raw"] or "").strip(),
                          (r["player_id"] or "").strip(), (r["match_status"] or "").strip(),
                          (r["candidate_player_ids"] or "").strip())
    if not out:
        raise SiblingSourceError(f"{path.name} has no data rows")
    return out


def read_sibling_rows(path: Path, members: dict[str, Member]) -> tuple[list[SiblingRow], dict[str, int]]:
    """The export's ``sibling`` rows only, plus the inventory of every relationship_type seen."""
    inventory: dict[str, int] = defaultdict(int)
    rows: list[SiblingRow] = []
    seen_ids: set[str] = set()
    seen_pairs: set[frozenset[str]] = set()
    for i, r in enumerate(_open(path, RELATIONSHIP_COLUMNS), start=2):
        rtype = (r["relationship_type"] or "").strip()
        inventory[rtype] += 1
        if rtype != "sibling":
            continue
        rid = (r["source_relationship_id"] or "").strip()
        if not SOURCE_KEY_RE.match(rid):
            raise SiblingSourceError(f"{path.name} line {i}: source_relationship_id {rid!r} malformed")
        if rid in seen_ids:
            raise SiblingSourceError(f"{path.name} line {i}: duplicate source_relationship_id {rid}")
        seen_ids.add(rid)
        a, b = r["person_a_source_member_id"].strip(), r["person_b_source_member_id"].strip()
        for who in (a, b):
            if who not in members:
                raise SiblingSourceError(f"{path.name} line {i}: member {who} is not in the members export")
        if a == b:
            raise SiblingSourceError(f"{path.name} line {i}: a person is their own sibling ({a})")
        pair = frozenset((a, b))
        if pair in seen_pairs:
            raise SiblingSourceError(f"{path.name} line {i}: the pair {sorted(pair)} appears twice")
        seen_pairs.add(pair)
        label = (r["relationship_label"] or "").strip()
        if label not in SOURCE_LABELS:
            raise SiblingSourceError(f"{path.name} line {i}: sibling label {label!r} is not one of {SOURCE_LABELS}")
        rows.append(SiblingRow(i, rid, r["family_key"].strip(), (r["family_name"] or "").strip(),
                               a, members[a].name, (r["person_a_role"] or "").strip(),
                               b, members[b].name, (r["person_b_role"] or "").strip(),
                               label, (r["evidence"] or "").strip(), (r["extraction_method"] or "").strip(),
                               (r["confidence"] or "").strip(), (r["source_url"] or "").strip(),
                               (r["source_revision_id"] or "").strip()))
    if not rows:
        raise SiblingSourceError(f"{path.name} has no sibling rows")
    return rows, dict(inventory)


# ---------------------------------------------------------------------------
# Adjudications
# ---------------------------------------------------------------------------

@dataclass
class Adjudication:
    source_member_id: str
    member_name: str
    profile: str | None
    evidence: str
    decided_on: str
    used: int = 0


def read_adjudications(path: Path) -> list[Adjudication]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != ADJUDICATION_COLUMNS:
            raise SiblingSourceError(f"{path.name} columns {reader.fieldnames} != {ADJUDICATION_COLUMNS}")
        out: list[Adjudication] = []
        for i, r in enumerate(reader, start=2):
            mid = (r["source_member_id"] or "").strip()
            if not SOURCE_KEY_RE.match(mid):
                raise SiblingSourceError(f"{path.name} line {i}: source_member_id {mid!r} malformed")
            profile = (r["afltables_profile"] or "").strip() or None
            if profile is not None and not PROFILE_RE.match(profile):
                raise SiblingSourceError(f"{path.name} line {i}: {profile!r} is not a profile path")
            if not (r["evidence"] or "").strip() or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", (r["decided_on"] or "").strip()):
                raise SiblingSourceError(f"{path.name} line {i}: evidence and decided_on (YYYY-MM-DD) are required")
            out.append(Adjudication(mid, (r["member_name"] or "").strip(), profile, r["evidence"].strip(), r["decided_on"].strip()))
    ids = [a.source_member_id for a in out]
    if len(ids) != len(set(ids)):
        raise SiblingSourceError(f"{path.name}: duplicate adjudication for one member")
    return out


@dataclass(frozen=True)
class Supplement:
    key: str
    family_key: str
    family_name: str
    a_name: str
    a_profile: str
    b_name: str
    b_profile: str
    label: str
    evidence: str
    decided_on: str


def read_supplements(path: Path) -> list[Supplement]:
    """Explicitly evidenced pairs the export lacks (see the module docstring, Coverage)."""
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != SUPPLEMENT_COLUMNS:
            raise SiblingSourceError(f"{path.name} columns {reader.fieldnames} != {SUPPLEMENT_COLUMNS}")
        out: list[Supplement] = []
        for i, r in enumerate(reader, start=2):
            key = (r["supplement_key"] or "").strip()
            if not SUPPLEMENT_KEY_RE.match(key):
                raise SiblingSourceError(f"{path.name} line {i}: supplement_key {key!r} malformed")
            a, b = (r["person_a_profile"] or "").strip(), (r["person_b_profile"] or "").strip()
            for profile in (a, b):
                if not PROFILE_RE.match(profile):
                    raise SiblingSourceError(f"{path.name} line {i}: {profile!r} is not a profile path (both people must be identities)")
            if a == b:
                raise SiblingSourceError(f"{path.name} line {i}: a self-pair")
            label = (r["relationship_label"] or "").strip()
            if label not in CANONICAL_LABELS:
                raise SiblingSourceError(f"{path.name} line {i}: relationship_label {label!r}")
            evidence = (r["evidence"] or "").strip()
            if not evidence or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", (r["decided_on"] or "").strip()):
                raise SiblingSourceError(f"{path.name} line {i}: evidence and decided_on (YYYY-MM-DD) are required")
            if label in BROTHER_LABELS and not BROTHER_WORD_RE.search(evidence):
                raise SiblingSourceError(f"{path.name} line {i}: a brothers supplement must quote evidence that says brother(s)")
            if not (r["person_a_name"] or "").strip() or not (r["person_b_name"] or "").strip() or not (r["family_key"] or "").strip():
                raise SiblingSourceError(f"{path.name} line {i}: names and family_key are required")
            out.append(Supplement(key, r["family_key"].strip(), (r["family_name"] or "").strip(), r["person_a_name"].strip(), a,
                                  r["person_b_name"].strip(), b, label, evidence, r["decided_on"].strip()))
    keys = [x.key for x in out]
    if len(keys) != len(set(keys)):
        raise SiblingSourceError(f"{path.name}: duplicate supplement_key")
    return out


# ---------------------------------------------------------------------------
# Resolution (pure; the database is only a source of these inputs)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Candidate:
    player_id: int
    profile: str
    display_name: str
    given_name: str | None
    surname: str | None
    debut_season: int | None
    games: int | None
    birth_year: int | None
    club_games: dict[str, int] = field(default_factory=dict)  # organisation slug -> games


@dataclass
class Resolution:
    profile: str | None
    link: str            # unique | resolved | unmatched | ambiguous
    note: str


class Roster:
    def __init__(self, candidates: Iterable[Candidate]) -> None:
        self.by_name: dict[str, list[Candidate]] = defaultdict(list)
        self.by_profile: dict[str, Candidate] = {}
        for c in candidates:
            self.by_profile[c.profile] = c
            keys = {normalise_name(c.display_name)[0],
                    normalise_name(f"{c.given_name or ''} {c.surname or ''}")[0]}
            for k in keys:
                if k and all(x.player_id != c.player_id for x in self.by_name[k]):
                    self.by_name[k].append(c)


def parse_clubs(raw: str) -> list[str]:
    """``"Perth , Swan Districts & East Perth"`` -> ``["perth", "swan-districts", "east-perth"]`` (slugs)."""
    out: list[str] = []
    for part in _CLUB_SPLIT_RE.split(raw or ""):
        k = re.sub(r"\s+", " ", part.strip().lower())
        if k:
            out.append(CLUB_ORG.get(k, k.replace(" ", "-")))
    return out


def born_year(url: str) -> int | None:
    m = BORN_RE.search(unquote(url or ""))
    return int(m.group(1)) if m else None


def _suffix_rule(cands: list[Candidate], suffix: str | None) -> list[Candidate]:
    if suffix and len(cands) >= 2:
        seasons = [c.debut_season or 0 for c in cands]
        pick = min(seasons) if suffix == "sr" else max(seasons)
        return [c for c in cands if (c.debut_season or 0) == pick]
    return cands


def _describe(cands: list[Candidate]) -> str:
    return ", ".join(f"{c.profile} (debut {c.debut_season}, born {c.birth_year or '?'}, {c.games} games)"
                     for c in sorted(cands, key=lambda c: c.profile))


def resolve_member(m: Member, roster: Roster, orgs: set[str], adj: Adjudication | None) -> Resolution:
    name, suffix = normalise_name(m.name)
    cands = _suffix_rule(list(roster.by_name.get(name, [])), suffix)
    clubs = parse_clubs(m.clubs_raw)
    known = [s for s in clubs if s in orgs]
    reasons: list[str] = ["name"]
    if suffix and len(roster.by_name.get(name, [])) >= 2:
        reasons.append(f"{suffix}. suffix")
    by_rule: Resolution | None = None
    if clubs and not known:
        by_rule = Resolution(None, "unmatched", f"listed clubs are not VFL/AFL clubs ({m.clubs_raw})")
    else:
        if known:
            lineage = {o for s in known for o in LINEAGE.get(s, (s,))}
            cands = [c for c in cands if any(c.club_games.get(o, 0) > 0 for o in lineage)]
            reasons.append(f"played for a listed club ({', '.join(known)})")
        if len(cands) > 1:
            year = born_year(m.wikipedia_url)
            if year is not None and all(c.birth_year is not None for c in cands):
                narrowed = [c for c in cands if c.birth_year == year]
                if len(narrowed) == 1:
                    cands = narrowed
                    reasons.append(f"Wikipedia title birth year {year}")
        if len(cands) == 1:
            by_rule = Resolution(cands[0].profile, "unique", ", ".join(reasons))
        elif not cands:
            by_rule = Resolution(None, "unmatched", "no VFL/AFL player of that name"
                                 + (" played for a listed club" if known else ""))
        else:
            by_rule = Resolution(None, "ambiguous", f"candidates: {_describe(cands)}")
    if by_rule.link == "unique":
        if adj is not None:
            raise SiblingSourceError(f"member {m.source_member_id} {m.name!r} resolves by rule to {by_rule.profile}; "
                                     "the adjudication is stale")
        return by_rule
    if adj is None:
        return by_rule
    adj.used += 1
    if adj.profile is None:
        return Resolution(None, "unmatched", f"adjudicated unlinked ({adj.decided_on}): {adj.evidence}")
    return Resolution(adj.profile, "resolved", f"adjudicated ({adj.decided_on}): {adj.evidence}")


def canonical_label(source_label: str, evidence: str, both_linked: bool) -> str:
    says_brother = bool(BROTHER_WORD_RE.search(evidence))
    says_sister = bool(SISTER_WORD_RE.search(evidence)) and not says_brother
    twins = source_label == "twins"
    if source_label == "siblings/brothers" or says_brother or both_linked:
        return "twin brothers" if twins else "brothers"
    if says_sister:
        return "sisters"
    return source_label


def _person_key(profile: str | None, name: str) -> str:
    return profile or f"name:{normalise_name(name)[0]}"


def normalise_rows(rows: list[SiblingRow], members: dict[str, Member], roster: Roster, orgs: set[str],
                   adjudications: list[Adjudication], supplements: list[Supplement] | None = None) -> list[dict[str, str]]:
    """The accepted artefact's rows, or a refusal. Each member is resolved once; every
    adjudication must be needed and used exactly once; pairs are ordered and unique; every
    supplement must be a pair the export lacks, between two canonical identities."""
    by_member = {a.source_member_id: a for a in adjudications}
    resolved: dict[str, Resolution] = {}
    for row in rows:
        for mid in (row.a_id, row.b_id):
            if mid not in resolved:
                resolved[mid] = resolve_member(members[mid], roster, orgs, by_member.get(mid))
    unused = [a for a in adjudications if a.used == 0]
    if unused:
        raise SiblingSourceError("adjudications that applied to no sibling member (stale or mistyped): "
                                 + "; ".join(f"{a.source_member_id} {a.member_name}" for a in unused))
    out: list[dict[str, str]] = []
    pairs: dict[tuple[str, str], dict[str, str]] = {}
    for row in sorted(rows, key=lambda r: (r.family_key, r.source_relationship_id)):
        people = []
        for mid, role in ((row.a_id, row.a_role), (row.b_id, row.b_role)):
            m, r = members[mid], resolved[mid]
            people.append((_person_key(r.profile, m.name), m, role, r))
        if people[0][3].profile and people[0][3].profile == people[1][3].profile:
            raise SiblingSourceError(f"line {row.line}: both people resolve to {people[0][3].profile} (a self-pair)")
        people.sort(key=lambda p: p[0])
        pair = (people[0][0], people[1][0])
        both_linked = all(p[3].profile for p in people)
        if pair in pairs:
            # The export lists a family twice (two Wikipedia entries for the same people): the
            # canonical pair exists once. Keep the first row in (family_key, source_key) order
            # and record the merged source key, only when both people are linked identities:
            # two unlinked namesakes are not provably the same pair and refuse.
            if not both_linked:
                raise SiblingSourceError(f"line {row.line}: the pair {pair} appears twice")
            kept = pairs[pair]
            kept["also_source_keys"] = " ".join(filter(None, [kept["also_source_keys"], row.source_relationship_id]))
            continue
        rec: dict[str, str] = {
            "source_key": row.source_relationship_id, "family_key": row.family_key, "family_name": row.family_name,
        }
        pairs[pair] = rec
        for side, (_, m, role, r) in zip(("a", "b"), people):
            rec[f"person_{side}_name"] = m.name
            rec[f"person_{side}_role"] = role
            rec[f"person_{side}_wikipedia"] = m.wikipedia_url
            rec[f"person_{side}_clubs"] = m.clubs_raw
            rec[f"person_{side}_legacy"] = f"{m.legacy_status}:{m.legacy_player_id}" if m.legacy_player_id else m.legacy_status
            rec[f"person_{side}_profile"] = r.profile or ""
            rec[f"person_{side}_link"] = r.link
            rec[f"person_{side}_note"] = r.note
        rec["relationship_label"] = canonical_label(row.label, row.evidence, both_linked)
        rec["source_label"] = row.label
        rec["evidence"] = row.evidence
        rec["extraction_method"] = row.extraction_method
        rec["source_revision_id"] = row.source_revision_id
        rec["also_source_keys"] = ""
        out.append(rec)
    for sup in supplements or []:
        for profile in (sup.a_profile, sup.b_profile):
            if profile not in roster.by_profile:
                raise SiblingSourceError(f"supplement {sup.key}: {profile} is not a canonical identity on this database")
        people = sorted([(sup.a_profile, sup.a_name), (sup.b_profile, sup.b_name)])
        pair = (people[0][0], people[1][0])
        if pair in pairs:
            raise SiblingSourceError(f"supplement {sup.key}: the export already carries the pair {pair}; the supplement is stale")
        role = "brother" if sup.label in BROTHER_LABELS else ("sister" if sup.label == "sisters" else "sibling")
        rec = {"source_key": sup.key, "family_key": sup.family_key, "family_name": sup.family_name}
        for side, (profile, name) in zip(("a", "b"), people):
            rec[f"person_{side}_name"] = name
            rec[f"person_{side}_role"] = role
            rec[f"person_{side}_wikipedia"] = ""
            rec[f"person_{side}_clubs"] = ""
            rec[f"person_{side}_legacy"] = ""
            rec[f"person_{side}_profile"] = profile
            rec[f"person_{side}_link"] = "resolved"
            rec[f"person_{side}_note"] = f"supplement ({sup.decided_on}): {sup.evidence}"
        rec.update({"relationship_label": sup.label, "source_label": SUPPLEMENT_LABEL, "evidence": sup.evidence,
                    "extraction_method": "adjudication", "source_revision_id": "", "also_source_keys": ""})
        pairs[pair] = rec
        out.append(rec)
    out.sort(key=lambda r: (r["family_key"], r["person_a_name"], r["person_b_name"], r["source_key"]))
    return out


def render_artefact(rows: list[dict[str, str]]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=ARTEFACT_COLUMNS, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# The accepted artefact (what the rebuild reads)
# ---------------------------------------------------------------------------

def read_artefact(path: Path) -> list[dict[str, str]]:
    """Shape-check the tracked artefact offline. Any defect refuses the whole file."""
    if not path.is_file():
        raise SiblingSourceError(f"tracked artefact missing: {path}")
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != ARTEFACT_COLUMNS:
            raise SiblingSourceError(f"{path.name} columns {reader.fieldnames} != {ARTEFACT_COLUMNS}")
        rows = list(reader)
    if not rows:
        raise SiblingSourceError(f"{path.name} has no data rows")
    keys: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for i, r in enumerate(rows, start=2):
        key = r["source_key"]
        supplement = r["source_label"] == SUPPLEMENT_LABEL
        if not (SUPPLEMENT_KEY_RE if supplement else SOURCE_KEY_RE).match(key or ""):
            raise SiblingSourceError(f"{path.name} line {i}: source_key {key!r} malformed")
        if key in keys:
            raise SiblingSourceError(f"{path.name} line {i}: duplicate source_key {key}")
        keys.add(key)
        if not r["family_key"].strip():
            raise SiblingSourceError(f"{path.name} line {i}: empty family_key")
        for side in ("a", "b"):
            if not r[f"person_{side}_name"].strip():
                raise SiblingSourceError(f"{path.name} line {i}: empty person_{side}_name")
            profile, link = r[f"person_{side}_profile"].strip(), r[f"person_{side}_link"]
            if link not in LINKS:
                raise SiblingSourceError(f"{path.name} line {i}: person_{side}_link {link!r}")
            if (link in ("unique", "resolved")) != (profile != ""):
                raise SiblingSourceError(f"{path.name} line {i}: person_{side}_link {link} disagrees with profile {profile!r}")
            if profile and not PROFILE_RE.match(profile):
                raise SiblingSourceError(f"{path.name} line {i}: person_{side}_profile {profile!r} is not a profile path")
        a, b = r["person_a_profile"].strip(), r["person_b_profile"].strip()
        if a and a == b:
            raise SiblingSourceError(f"{path.name} line {i}: both people share a profile (a self-pair)")
        ka, kb = _person_key(a or None, r["person_a_name"]), _person_key(b or None, r["person_b_name"])
        if ka > kb:
            raise SiblingSourceError(f"{path.name} line {i}: the pair is not in canonical order ({ka} > {kb})")
        if (ka, kb) in pairs:
            raise SiblingSourceError(f"{path.name} line {i}: the pair ({ka}, {kb}) appears twice")
        pairs.add((ka, kb))
        if r["source_label"] not in (*SOURCE_LABELS, SUPPLEMENT_LABEL):
            raise SiblingSourceError(f"{path.name} line {i}: source_label {r['source_label']!r}")
        if supplement and not (a and b and r["person_a_link"] == "resolved" and r["person_b_link"] == "resolved"):
            raise SiblingSourceError(f"{path.name} line {i}: a supplement pair must link both people as resolved")
        for extra in r["also_source_keys"].split():
            if not SOURCE_KEY_RE.match(extra) or extra in keys:
                raise SiblingSourceError(f"{path.name} line {i}: also_source_keys {extra!r} malformed or repeated")
            keys.add(extra)
        if r["relationship_label"] not in CANONICAL_LABELS:
            raise SiblingSourceError(f"{path.name} line {i}: relationship_label {r['relationship_label']!r}")
        if r["relationship_label"] in BROTHER_LABELS and not (a and b) and not BROTHER_WORD_RE.search(r["evidence"]) \
                and r["source_label"] != "siblings/brothers":
            raise SiblingSourceError(f"{path.name} line {i}: brothers label without brother evidence or two linked players")
    return rows


def artefact_measures(rows: list[dict[str, str]]) -> dict[str, int]:
    """The counts the rebuild gates read from the artefact itself (never typed)."""
    linked = [r for r in rows if r["person_a_profile"] and r["person_b_profile"]]
    brothers = [r for r in linked if r["relationship_label"] in BROTHER_LABELS]
    return {
        "pairs": len(rows),
        "pairs_both_linked": len(linked),
        "pairs_one_linked": sum(1 for r in rows if bool(r["person_a_profile"]) != bool(r["person_b_profile"])),
        "pairs_unlinked": sum(1 for r in rows if not r["person_a_profile"] and not r["person_b_profile"]),
        "brother_pairs_linked": len(brothers),
        "players_with_brother": len({r[f"person_{s}_profile"] for r in brothers for s in ("a", "b")}),
        "unlinked_sides": sum(1 for r in rows for s in ("a", "b") if not r[f"person_{s}_profile"]),
        "ambiguous_sides": sum(1 for r in rows for s in ("a", "b") if r[f"person_{s}_link"] == "ambiguous"),
        "adjudicated_sides": sum(1 for r in rows for s in ("a", "b") if "adjudicated" in r[f"person_{s}_note"]),
        "merged_duplicate_rows": sum(len(r["also_source_keys"].split()) for r in rows),
        "supplement_pairs": sum(1 for r in rows if r["source_label"] == SUPPLEMENT_LABEL),
    }


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def fetch_source_ids(pg: Any) -> dict[str, int]:
    with pg.cursor() as cur:
        cur.execute("SELECT key, id FROM sources WHERE key IN (%s, %s)", (SOURCE_KEY, IDENTITY_SOURCE_KEY))
        source_ids = dict(cur.fetchall())
    for key in (SOURCE_KEY, IDENTITY_SOURCE_KEY):
        if key not in source_ids:
            raise SiblingSourceError(f"sources has no {key!r} row")
    return source_ids


def fetch_roster(pg: Any) -> tuple[Roster, set[str]]:
    source_ids = fetch_source_ids(pg)
    with pg.cursor() as cur:
        cur.execute(
            """SELECT p.id, ei.external_id, p.display_name, p.given_name, p.surname, c.debut_season, c.games,
                      COALESCE(EXTRACT(YEAR FROM p.dob)::int, p.birth_year)
                 FROM external_identities ei
                 JOIN players p ON p.id = ei.player_id
                 LEFT JOIN player_career_stats c ON c.player_id = p.id
                WHERE ei.source_id = %s AND ei.match_method = %s AND ei.status IN ('unique', 'resolved')
                ORDER BY p.id, ei.external_id""",
            (source_ids[IDENTITY_SOURCE_KEY], MATCH_METHOD))
        people = cur.fetchall()
        cur.execute(
            """SELECT s.player_id, o.slug, sum(s.games)::int
                 FROM player_club_season_stats s
                 JOIN clubs c ON c.id = s.club_id
                 JOIN club_organizations o ON o.id = c.organization_id
                GROUP BY s.player_id, o.slug""")
        club_games: dict[int, dict[str, int]] = defaultdict(dict)
        for pid, slug, g in cur.fetchall():
            club_games[pid][slug] = g
        cur.execute("SELECT slug FROM club_organizations")
        orgs = {r[0] for r in cur.fetchall()}
    seen: set[int] = set()
    cands = []
    for pid, profile, display, given, surname, debut, games, born in people:
        if pid in seen:      # a player with two AFL Tables identities is one candidate (first path)
            continue
        seen.add(pid)
        cands.append(Candidate(pid, profile, display, given, surname, debut, games, born, club_games.get(pid, {})))
    return Roster(cands), orgs


def fetch_identity(pg: Any, source_ids: dict[str, int]) -> dict[str, int]:
    with pg.cursor() as cur:
        cur.execute(
            """SELECT ei.external_id, ei.player_id FROM external_identities ei
                WHERE ei.source_id = %s AND ei.match_method = %s AND ei.status IN ('unique', 'resolved')
                  AND ei.player_id IS NOT NULL""",
            (source_ids[IDENTITY_SOURCE_KEY], MATCH_METHOD))
        return dict(cur.fetchall())


def resolve_artefact(rows: list[dict[str, str]], identity: dict[str, int]) -> list[tuple[dict[str, str], int | None, int | None]]:
    """Every non-empty profile must be a canonical identity on this database."""
    out = []
    missing: list[str] = []
    for r in rows:
        ids = []
        for side in ("a", "b"):
            profile = r[f"person_{side}_profile"]
            pid = identity.get(profile) if profile else None
            if profile and pid is None:
                missing.append(profile)
            ids.append(pid)
        if ids[0] is not None and ids[0] == ids[1]:
            raise SiblingSourceError(f"{r['source_key']}: both profiles resolve to player {ids[0]}")
        out.append((r, ids[0], ids[1]))
    if missing:
        raise SiblingSourceError("profiles with no canonical identity on this database: " + ", ".join(sorted(set(missing))[:10]))
    return out


def write_rows(pg: Any, resolved: list[tuple[dict[str, str], int | None, int | None]], source_ids: dict[str, int],
               provenance: dict[str, Any] | None, rep: Reporter) -> dict[str, Any]:
    source_id = source_ids[SOURCE_KEY]
    with import_batch(pg, SOURCE_KEY, TOOL, "player_relationships") as batch:
        batch.records_read = len(resolved)
        with pg.cursor() as cur:
            relationship_rows = []
            for r, a_id, b_id in resolved:
                if r["source_label"] == SUPPLEMENT_LABEL:
                    evidence = f"{r['evidence']} (AFLDB sibling supplement {r['source_key']}: a pair the families export lacks)"
                else:
                    evidence = (f"{r['evidence']} (Wikipedia: {SOURCE_ARTICLE}, {r['family_name'] or r['family_key']} family, "
                                f"revision {r['source_revision_id']})")
                relationship_rows.append((
                    r["family_key"], r["family_name"] or None,
                    a_id, r["person_a_name"], r["person_a_role"] or None,
                    b_id, r["person_b_name"], r["person_b_role"] or None,
                    "sibling", r["relationship_label"], "source", evidence, r["extraction_method"] or None,
                    source_id, f"{RELATIONSHIP_PREFIX}:{r['source_key']}", batch.id))
            cur.executemany(
                """INSERT INTO player_relationships
                     (family_key, family_name, person_a_player_id, person_a_name, person_a_role,
                      person_b_player_id, person_b_name, person_b_role,
                      relationship, relationship_label, confidence, evidence, extraction_method,
                      source_id, source_record_id, import_batch_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source_id, source_record_id) DO UPDATE SET
                     family_key = EXCLUDED.family_key, family_name = EXCLUDED.family_name,
                     person_a_player_id = EXCLUDED.person_a_player_id, person_a_name = EXCLUDED.person_a_name,
                     person_a_role = EXCLUDED.person_a_role, person_b_player_id = EXCLUDED.person_b_player_id,
                     person_b_name = EXCLUDED.person_b_name, person_b_role = EXCLUDED.person_b_role,
                     relationship = EXCLUDED.relationship, relationship_label = EXCLUDED.relationship_label,
                     confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence,
                     extraction_method = EXCLUDED.extraction_method, import_batch_id = EXCLUDED.import_batch_id
                   WHERE (player_relationships.family_key, player_relationships.family_name,
                          player_relationships.person_a_player_id, player_relationships.person_a_name,
                          player_relationships.person_a_role, player_relationships.person_b_player_id,
                          player_relationships.person_b_name, player_relationships.person_b_role,
                          player_relationships.relationship, player_relationships.relationship_label,
                          player_relationships.confidence, player_relationships.evidence,
                          player_relationships.extraction_method)
                         IS DISTINCT FROM
                         (EXCLUDED.family_key, EXCLUDED.family_name, EXCLUDED.person_a_player_id,
                          EXCLUDED.person_a_name, EXCLUDED.person_a_role, EXCLUDED.person_b_player_id,
                          EXCLUDED.person_b_name, EXCLUDED.person_b_role, EXCLUDED.relationship,
                          EXCLUDED.relationship_label, EXCLUDED.confidence, EXCLUDED.evidence,
                          EXCLUDED.extraction_method)""",
                relationship_rows)
            keys = [f"{RELATIONSHIP_PREFIX}:{r['source_key']}" for r, _, _ in resolved]
            cur.execute(
                """DELETE FROM player_relationships
                    WHERE source_id = %s AND source_record_id LIKE %s AND NOT (source_record_id = ANY(%s))""",
                (source_id, f"{RELATIONSHIP_PREFIX}:%", keys))
            stale = cur.rowcount
            cur.execute(
                """SELECT count(*) FILTER (WHERE import_batch_id = %s), count(*)
                     FROM player_relationships WHERE source_id = %s AND source_record_id LIKE %s""",
                (batch.id, source_id, f"{RELATIONSHIP_PREFIX}:%"))
            changed, total = cur.fetchone()
        batch.records_inserted += changed
    rep.result("player_relationships sibling rows", total)
    rep.result("rows inserted or changed", changed)
    rep.result("stale rows removed", stale)
    summary = {"pairs": len(relationship_rows), "changed": changed, "stale_removed": stale,
               "measures": artefact_measures([r for r, _, _ in resolved]), "provenance": provenance}
    with pg.cursor() as cur:
        cur.execute("UPDATE import_batches SET validation_result = %s WHERE id = %s", (json.dumps(summary), batch.id))
    pg.commit()
    summary["batch_id"] = batch.id
    return summary


def read_provenance(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ("wikipedia_title", "revision_id", "raw_members", "raw_relationships", "raw_sibling_rows"):
        if key not in data:
            raise SiblingSourceError(f"{path.name} lacks {key}")
    return data


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_normalize(args: argparse.Namespace) -> int:
    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB football-family siblings: normalise the legacy Wikipedia export")
    members = read_members(args.members)
    rows, inventory = read_sibling_rows(args.relationships, members)
    adjudications = read_adjudications(args.adjudications)
    supplements = read_supplements(args.supplements)
    rep.step(f"{args.members.name}: {len(members)} members; {args.relationships.name}: "
             f"{sum(inventory.values())} relationships ({', '.join(f'{k} {v}' for k, v in sorted(inventory.items()))}); "
             f"{len(rows)} sibling rows; {args.adjudications.name}: {len(adjudications)} adjudications; "
             f"{args.supplements.name}: {len(supplements)} supplement pairs")
    load_env()
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  identities from: {safe_dsn(dsn)}")
    pg = connect_pg(dsn)
    roster, orgs = fetch_roster(pg)
    out = normalise_rows(rows, members, roster, orgs, adjudications, supplements)
    m = artefact_measures(out)
    for k, v in m.items():
        rep.result(k, v)
    labels = defaultdict(int)
    for r in out:
        labels[r["relationship_label"]] += 1
    rep.step("labels: " + ", ".join(f"{k} {v}" for k, v in sorted(labels.items())))
    text = render_artefact(out)
    if args.check:
        current = args.out.read_text(encoding="utf-8") if args.out.is_file() else None
        if current is None:
            sys.exit(f"ERROR: {args.out} is not in this checkout")
        if current.replace("\r\n", "\n") != text:
            sys.exit(f"ERROR: {args.out.name} differs from a fresh normalisation of the export on this database")
        print(f"  {args.out.name} is exactly the regeneration; done (check) in {time.time() - started:.1f}s")
        return 0
    args.out.write_text(text, encoding="utf-8", newline="\n")
    revisions = sorted({r.source_revision_id for r in rows})
    provenance = {
        "wikipedia_title": SOURCE_ARTICLE, "revision_id": revisions[0] if len(revisions) == 1 else revisions,
        "source_url": rows[0].source_url,
        "raw_files": [str(p.relative_to(REPO_ROOT)).replace("\\", "/") for p in (args.members, args.relationships)],
        "raw_members": len(members), "raw_relationships": sum(inventory.values()),
        "raw_relationship_types": dict(sorted(inventory.items())), "raw_sibling_rows": len(rows),
        "supplement_pairs": len(supplements),
        "normalised_on": time.strftime("%Y-%m-%d"), "measures": m, "labels": dict(sorted(labels.items())),
    }
    args.provenance.write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"  wrote {args.out.name} ({len(out)} rows) and {args.provenance.name}; done in {time.time() - started:.1f}s")
    return 0


def cmd_load(args: argparse.Namespace) -> int:
    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB football-family siblings (tracked Wikipedia-derived artefact)")
    rows = read_artefact(args.csv)
    provenance = read_provenance(args.provenance)
    m = artefact_measures(rows)
    rep.step(f"{args.csv.name}: {m['pairs']} sibling pairs, shape verified"
             + (f"; provenance revision {provenance['revision_id']}" if provenance else ""))
    if args.validate_only:
        print(f"  done (validate only) in {time.time() - started:.1f}s")
        return 0
    load_env()
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    pg = connect_pg(dsn)
    source_ids = fetch_source_ids(pg)
    resolved = resolve_artefact(rows, fetch_identity(pg, source_ids))
    rep.result("pairs with both people linked", sum(1 for _, a, b in resolved if a is not None and b is not None))
    rep.result("players with a linked brother", m["players_with_brother"])
    if args.dry_run:
        print(f"  done (dry run) in {time.time() - started:.1f}s")
        return 0
    summary = write_rows(pg, resolved, source_ids, provenance, rep)
    print(f"  batch {summary['batch_id']}: {summary['pairs']} sibling pairs, {summary['changed']} inserted or changed, "
          f"{summary['stale_removed']} stale removed; done in {time.time() - started:.1f}s")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    n = sub.add_parser("normalize", help="resolve the export's sibling rows to profile paths and write the tracked artefact")
    n.add_argument("--members", type=Path, default=DEFAULT_MEMBERS)
    n.add_argument("--relationships", type=Path, default=DEFAULT_RELATIONSHIPS)
    n.add_argument("--adjudications", type=Path, default=DEFAULT_ADJUDICATIONS)
    n.add_argument("--supplements", type=Path, default=DEFAULT_SUPPLEMENTS)
    n.add_argument("--out", type=Path, default=DEFAULT_ARTEFACT)
    n.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    n.add_argument("--check", action="store_true", help="compare the tracked artefact with a fresh normalisation; write nothing")
    n.add_argument("--quiet", action="store_true")
    n.set_defaults(func=cmd_normalize)
    l = sub.add_parser("load", help="load the tracked artefact into player_relationships")
    l.add_argument("--csv", type=Path, default=DEFAULT_ARTEFACT)
    l.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    l.add_argument("--validate-only", action="store_true", help="Check the artefact's shape offline; touch no database.")
    l.add_argument("--dry-run", action="store_true")
    l.add_argument("--quiet", action="store_true")
    l.set_defaults(func=cmd_load)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except SiblingSourceError as exc:
        sys.exit(f"ERROR: {exc}")


if __name__ == "__main__":
    sys.exit(main())
