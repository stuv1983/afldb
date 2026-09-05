#!/usr/bin/env python3
"""Father–son rule selections: normalise the Wikipedia list, load the canonical tables.

    python tools/migration/father_son.py normalize --raw data/players/father-son/vfl-afl.csv
    python tools/migration/father_son.py normalize --check          # tracked artefact == regeneration
    python tools/migration/father_son.py load --validate-only       # artefact shape, offline
    python tools/migration/father_son.py load --dry-run
    python tools/migration/father_son.py load

Why this exists (AFLDB-ISSUE-118 §23.29, family F)
-------------------------------------------------
Migration 006 created ``father_son_selections`` (one row per selection under the
AFL father–son rule: the drafted son, the qualifying father, the club, the year
and the pick) and ``player_relationships`` (the general football-family model),
and nothing has ever populated either. The draft source (``draft_picks``) names
the son and carries the father only as free text inside ``signing``; the Gridley
criterion ``fathersonfather`` asks for the FATHER ("player has had a son selected
under the Father-Son rule in the national draft").

Source: the "List of father–son selections" table of the Wikipedia article
"Father–son rule" (VFL/AFL, 1988–2025), exported to
``data/players/father-son/vfl-afl.csv`` (raw, untracked). Its seven columns are
carried verbatim into the tracked accepted artefact
``data/players/father-son-selections.csv`` together with the resolved AFL Tables
profile paths, so provenance survives without tracking the raw export.

Identity — the ``normalize`` step (run once, against a canonically rebuilt
database, and committed)
------------------------------------------------------------------------------
Nothing downstream ever matches a name. The normaliser resolves each person to
an AFL Tables profile path with these rules, and refuses the whole run on any
ambiguity it cannot decide from the row's own evidence:

* names are normalised (diacritics, punctuation, the list's ``^`` "currently
  listed" marker, middle initials, ``Jr.``/``Sr.``/``Snr.`` suffixes);
* a **son** is the unique player of that name whose debut season lies in
  ``[year, year + 7]`` and who played for the drafting club's organisation
  (lineage below). Zero candidates with the list's own games figure ``0`` is a
  son who never played: no player, ``unmatched``. Zero candidates with games
  reported, or more than one candidate after the suffix rule, needs a tracked
  adjudication or the run refuses;
* a **father** is the unique player of that name whose debut season is at
  least fifteen years before the selection and who played for the drafting
  club's organisation. Zero candidates with a state-league or non-player
  annotation on the games figure (``146 (Claremont)``, ``N/A (Administrator)``)
  is a father with no VFL/AFL career: ``unmatched``. Zero candidates with a
  plain games figure (he DID play VFL/AFL under some spelling), a name+era
  candidate who never played for the club's lineage (the state-league fathers
  whose qualification was WAFL/SANFL/QAFL), or more than one candidate needs a
  tracked adjudication or the run refuses;
* the suffix rule: among same-name candidates ``Sr.`` selects the earliest
  debut and ``Jr.`` the latest, only when at least two exist;
* the lineage: an organisation's own historical identities (Footscray → Western
  Bulldogs, South Melbourne → Sydney) plus, for the Brisbane Lions, the Brisbane
  Bears and Fitzroy whose games the Lions' father–son eligibility recognises;
* adjudications (``data/players/father-son-adjudications.csv``) are keyed by
  role, year, club and the verbatim name, carry the evidence and the date, and
  either name a profile path or explicitly leave the person unlinked. Every
  adjudication must be NEEDED (its row would otherwise refuse) and must apply
  exactly once, so a stale adjudication is a refusal, not a silent override;
* the list's games figures are corroboration only, reported and never used to
  choose: for sons they are games for the drafting club, for fathers games for
  the qualifying club (David Cloke: 114 of his 333 are Collingwood's).

Loading — the ``load`` step (the rebuild stage)
------------------------------------------------
Reads only the tracked artefact. A profile path is resolved through
``external_identities`` (source ``afltables``, ``match_method
afltables_profile_url``, status unique/resolved); a non-empty path with no
identity, a link status disagreeing with its path, a duplicate key or a
malformed row refuses the run. Writes ``father_son_selections`` (one row per
selection, keyed on (source, source_record_id)) and one ``parent_child`` row
per father–son pair in ``player_relationships`` (both names verbatim, links
where proven), removing stale rows of this source. Idempotent.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import time
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    Reporter, connect_pg, import_batch, load_env, require_env, safe_dsn,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW = REPO_ROOT / "data" / "players" / "father-son" / "vfl-afl.csv"
DEFAULT_ARTEFACT = REPO_ROOT / "data" / "players" / "father-son-selections.csv"
DEFAULT_ADJUDICATIONS = REPO_ROOT / "data" / "players" / "father-son-adjudications.csv"
DEFAULT_PROVENANCE = REPO_ROOT / "data" / "players" / "father-son-selections.source.json"

SOURCE_KEY = "wikipedia"
IDENTITY_SOURCE_KEY = "afltables"
MATCH_METHOD = "afltables_profile_url"
TOOL = "father_son.py"
RULE = "father-son"
RECORD_PREFIX = "wikipedia-father-son-rule"
RELATIONSHIP_PREFIX = "father-son"
RELATIONSHIP_LABEL = "father and son (AFL father–son rule selection)"

RAW_COLUMNS = ["Year", "Drafted player", "Club", "Father", "Selection", "Games played",
               "Father's games played"]
ARTEFACT_COLUMNS = [
    "source_key", "draft_year", "competition", "selection_pick", "selection_raw", "club",
    "drafted_player", "drafted_games_reported", "drafted_profile", "drafted_link", "drafted_note",
    "father", "father_games_reported", "father_profile", "father_link", "father_note",
]
ADJUDICATION_COLUMNS = ["role", "draft_year", "club", "name_raw", "afltables_profile", "evidence",
                        "decided_on"]

SON_WINDOW = 7          # a son debuts within this many seasons of his selection
FATHER_LEAD = 15        # a father debuted at least this many seasons before the selection

# Draft-club spellings the list uses -> club_organizations.slug
CLUB_ORG = {
    "footscray": "western-bulldogs",
    "brisbane": "brisbane-lions",
    "kangaroos": "north-melbourne",
    "south melbourne": "sydney",
}
# Organisations whose games qualify a father for a club's father–son selection.
LINEAGE = {
    "brisbane-lions": ("brisbane-lions", "brisbane-bears", "fitzroy"),
}
PROFILE_RE = re.compile(r"^players/[A-Z]/[^/]+\.html$")


class FatherSonSourceError(ValueError):
    """The raw list, the adjudications or the artefact cannot be accepted as written."""


# ---------------------------------------------------------------------------
# Names and clubs
# ---------------------------------------------------------------------------

_SUFFIX_RE = re.compile(r",?\s*\b(jr|jnr|sr|snr)\.?\s*$", re.I)
_INITIAL_RE = re.compile(r"\b[A-Za-z]\.?(?=\s)")


def normalise_name(raw: str) -> tuple[str, str | None]:
    """``"Gary Ablett, Sr."`` -> ``("gary ablett", "sr")``; ``"Jesse W. Smith^"`` -> ``("jesse smith", None)``."""
    s = unicodedata.normalize("NFKD", raw or "").encode("ascii", "ignore").decode()
    s = s.replace("^", "").strip()
    suffix = None
    m = _SUFFIX_RE.search(s)
    if m:
        suffix = "jr" if m.group(1).lower().startswith("j") else "sr"
        s = s[: m.start()]
    s = s.replace(",", " ")
    s = _INITIAL_RE.sub(" ", " " + s)  # drop single-letter middle initials
    s = re.sub(r"[.']", "", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s, suffix


def club_org_slug(club_raw: str) -> str:
    k = re.sub(r"\s+", " ", (club_raw or "").strip().lower())
    return CLUB_ORG.get(k, k.replace(" ", "-"))


def lineage_of(org_slug: str) -> tuple[str, ...]:
    return LINEAGE.get(org_slug, (org_slug,))


def parse_selection(raw: str) -> tuple[str, int | None]:
    """``"47 (rookie)"`` -> ``("rookie", 47)``; ``""`` -> ``("pre-draft", None)``; ``"18"`` -> ``("national", 18)``."""
    s = (raw or "").strip()
    if not s:
        return "pre-draft", None
    m = re.fullmatch(r"(\d+)(?:\s*\((rookie)\))?", s)
    if not m:
        raise FatherSonSourceError(f"selection {raw!r} is not a pick number, optionally '(rookie)'")
    return ("rookie" if m.group(2) else "national"), int(m.group(1))


def games_figure(raw: str) -> tuple[int | None, bool]:
    """``"146 (Claremont)"`` -> ``(146, True)``; ``"59"`` -> ``(59, False)``; ``"N/A (Administrator)"`` -> ``(None, True)``."""
    s = (raw or "").strip()
    m = re.match(r"^(\d+)", s)
    number = int(m.group(1)) if m else None
    annotated = bool(re.search(r"\(|unknown|n/a", s, re.I))
    return number, annotated


# ---------------------------------------------------------------------------
# Raw list and adjudications
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RawRow:
    line: int
    year: int
    drafted_player: str
    club: str
    father: str
    selection: str
    games: str
    father_games: str


def read_raw(path: Path) -> list[RawRow]:
    """The Wikipedia export: exact header, data rows are those with a four-digit Year; the
    table's trailing source/notes rows (Year is prose) are skipped and counted."""
    if not path.is_file():
        raise FatherSonSourceError(f"raw list missing: {path}")
    with path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != RAW_COLUMNS:
            raise FatherSonSourceError(f"{path.name} columns {reader.fieldnames} != {RAW_COLUMNS}")
        rows: list[RawRow] = []
        for i, r in enumerate(reader, start=2):
            year = (r["Year"] or "").strip()
            if not re.fullmatch(r"\d{4}", year):
                continue
            for col in ("Drafted player", "Club", "Father"):
                if not (r[col] or "").strip():
                    raise FatherSonSourceError(f"{path.name} line {i}: empty {col}")
            rows.append(RawRow(i, int(year), r["Drafted player"].strip(), r["Club"].strip(),
                               r["Father"].strip(), (r["Selection"] or "").strip(),
                               (r["Games played"] or "").strip(), (r["Father's games played"] or "").strip()))
    if not rows:
        raise FatherSonSourceError(f"{path.name} has no data rows")
    seen: set[tuple[int, str, str]] = set()
    for r in rows:
        key = (r.year, normalise_name(r.drafted_player)[0], club_org_slug(r.club))
        if key in seen:
            raise FatherSonSourceError(f"{path.name} line {r.line}: duplicate selection {key}")
        seen.add(key)
    return rows


@dataclass
class Adjudication:
    role: str
    draft_year: int
    club: str
    name_raw: str
    profile: str | None
    evidence: str
    decided_on: str
    used: int = 0

    @property
    def key(self) -> tuple[str, int, str, str]:
        return (self.role, self.draft_year, club_org_slug(self.club), normalise_name(self.name_raw)[0])


def read_adjudications(path: Path) -> list[Adjudication]:
    if not path.is_file():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != ADJUDICATION_COLUMNS:
            raise FatherSonSourceError(f"{path.name} columns {reader.fieldnames} != {ADJUDICATION_COLUMNS}")
        out: list[Adjudication] = []
        for i, r in enumerate(reader, start=2):
            role = (r["role"] or "").strip()
            if role not in ("son", "father"):
                raise FatherSonSourceError(f"{path.name} line {i}: role {role!r} is not son|father")
            profile = (r["afltables_profile"] or "").strip() or None
            if profile is not None and not PROFILE_RE.match(profile):
                raise FatherSonSourceError(f"{path.name} line {i}: {profile!r} is not a profile path")
            if not (r["evidence"] or "").strip() or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", (r["decided_on"] or "").strip()):
                raise FatherSonSourceError(f"{path.name} line {i}: evidence and decided_on (YYYY-MM-DD) are required")
            out.append(Adjudication(role, int(r["draft_year"]), r["club"].strip(), r["name_raw"].strip(),
                                    profile, r["evidence"].strip(), r["decided_on"].strip()))
    keys = [a.key for a in out]
    if len(keys) != len(set(keys)):
        raise FatherSonSourceError(f"{path.name}: duplicate adjudication key")
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
    club_games: dict[str, int] = field(default_factory=dict)  # organisation slug -> games


@dataclass
class Resolution:
    profile: str | None
    link: str            # unique | resolved | unmatched
    note: str
    corroborated: bool | None = None


class Roster:
    def __init__(self, candidates: Iterable[Candidate]) -> None:
        self.by_name: dict[str, list[Candidate]] = defaultdict(list)
        for c in candidates:
            keys = {normalise_name(c.display_name)[0],
                    normalise_name(f"{c.given_name or ''} {c.surname or ''}")[0]}
            for k in keys:
                if k:
                    self.by_name[k].append(c)


def _suffix_rule(cands: list[Candidate], suffix: str | None) -> list[Candidate]:
    """``Sr.`` keeps the earliest debut, ``Jr.`` the latest — only when that debut is
    unique among the candidates; a shared season decides nothing and stays ambiguous."""
    if suffix and len(cands) >= 2:
        seasons = [c.debut_season or 0 for c in cands]
        pick = min(seasons) if suffix == "sr" else max(seasons)
        return [c for c in cands if (c.debut_season or 0) == pick]
    return cands


def _lineage_games(c: Candidate, lineage: tuple[str, ...]) -> int:
    return sum(g for org, g in c.club_games.items() if org in lineage)


def _describe(cands: list[Candidate]) -> str:
    return ", ".join(f"{c.profile} (debut {c.debut_season}, {c.games} games)" for c in cands)


def _apply_adjudication(adj: Adjudication | None, what: str) -> Resolution:
    if adj is None:
        raise FatherSonSourceError(what)
    adj.used += 1
    if adj.profile is None:
        return Resolution(None, "unmatched", f"adjudicated unlinked ({adj.decided_on}): {adj.evidence}")
    return Resolution(adj.profile, "resolved", f"adjudicated ({adj.decided_on}): {adj.evidence}")


def resolve_son(row: RawRow, roster: Roster, adj: Adjudication | None) -> Resolution:
    name, suffix = normalise_name(row.drafted_player)
    lineage = lineage_of(club_org_slug(row.club))
    cands = [c for c in roster.by_name.get(name, [])
             if c.debut_season is not None and row.year <= c.debut_season <= row.year + SON_WINDOW]
    cands = _suffix_rule([c for c in cands if _lineage_games(c, lineage) > 0], suffix)
    games, _ = games_figure(row.games)
    if len(cands) == 1:
        c = cands[0]
        if adj is not None:
            raise FatherSonSourceError(
                f"line {row.line}: son {row.drafted_player!r} resolves by rule to {c.profile}; the adjudication is stale")
        corroborated = games is not None and games in (c.games, _lineage_games(c, lineage))
        return Resolution(c.profile, "unique",
                          f"name, debut {c.debut_season} within {row.year}..{row.year + SON_WINDOW}, played for the club",
                          corroborated)
    if not cands and games == 0:
        if adj is not None:
            raise FatherSonSourceError(f"line {row.line}: son {row.drafted_player!r} never played; the adjudication is stale")
        return Resolution(None, "unmatched", "never played a VFL/AFL match (list: 0 games)")
    what = (f"line {row.line}: son {row.drafted_player!r} ({row.club} {row.year}, list games {row.games!r}) "
            + (f"is ambiguous: {_describe(cands)}" if cands else "has no candidate of that name in the window for the club")
            + "; an adjudication is required")
    return _apply_adjudication(adj, what)


def resolve_father(row: RawRow, roster: Roster, adj: Adjudication | None) -> Resolution:
    name, suffix = normalise_name(row.father)
    lineage = lineage_of(club_org_slug(row.club))
    era = [c for c in roster.by_name.get(name, [])
           if c.debut_season is not None and c.debut_season <= row.year - FATHER_LEAD]
    era = _suffix_rule(era, suffix)
    club = [c for c in era if _lineage_games(c, lineage) > 0]
    games, annotated = games_figure(row.father_games)
    if len(club) == 1:
        c = club[0]
        if adj is not None:
            raise FatherSonSourceError(
                f"line {row.line}: father {row.father!r} resolves by rule to {c.profile}; the adjudication is stale")
        corroborated = games is not None and games in (c.games, _lineage_games(c, lineage))
        return Resolution(c.profile, "unique",
                          f"name, debut {c.debut_season} at least {FATHER_LEAD} seasons before {row.year}, played for the club",
                          corroborated)
    if not era and annotated:
        if adj is not None:
            raise FatherSonSourceError(f"line {row.line}: father {row.father!r} has no VFL/AFL career; the adjudication is stale")
        return Resolution(None, "unmatched", f"no VFL/AFL career (list: {row.father_games})")
    if not era:
        what = (f"line {row.line}: father {row.father!r} ({row.club} {row.year}) has no candidate of that name "
                f"but the list reports {row.father_games!r} VFL/AFL games; an adjudication is required")
    elif not club:
        what = (f"line {row.line}: father {row.father!r} ({row.club} {row.year}) matches by name and era only "
                f"({_describe(era)}) and never played for the club's lineage; an adjudication is required")
    else:
        what = f"line {row.line}: father {row.father!r} ({row.club} {row.year}) is ambiguous: {_describe(club)}; an adjudication is required"
    return _apply_adjudication(adj, what)


def normalise_rows(raw_rows: list[RawRow], roster: Roster, adjudications: list[Adjudication],
                   known_orgs: set[str] | None = None) -> list[dict[str, str]]:
    """The accepted artefact's rows, or a refusal. Every adjudication must be used exactly once."""
    by_key = {a.key: a for a in adjudications}
    seq: dict[int, int] = defaultdict(int)
    pairs: set[tuple[str, str]] = set()
    out: list[dict[str, str]] = []
    for row in raw_rows:
        org = club_org_slug(row.club)
        if known_orgs is not None and org not in known_orgs:
            raise FatherSonSourceError(f"line {row.line}: club {row.club!r} -> {org!r} is not a club organisation")
        competition, pick = parse_selection(row.selection)
        son = resolve_son(row, roster, by_key.get(("son", row.year, org, normalise_name(row.drafted_player)[0])))
        father = resolve_father(row, roster, by_key.get(("father", row.year, org, normalise_name(row.father)[0])))
        if son.profile and son.profile == father.profile:
            raise FatherSonSourceError(f"line {row.line}: son and father resolve to the same profile {son.profile}")
        pair = (father.profile or f"name:{normalise_name(row.father)[0]}", son.profile or f"name:{normalise_name(row.drafted_player)[0]}")
        if pair in pairs:
            raise FatherSonSourceError(f"line {row.line}: the pair {pair} appears twice")
        pairs.add(pair)
        seq[row.year] += 1
        out.append({
            "source_key": f"{RECORD_PREFIX}:{row.year}:{seq[row.year]:02d}",
            "draft_year": str(row.year),
            "competition": competition,
            "selection_pick": "" if pick is None else str(pick),
            "selection_raw": row.selection,
            "club": row.club,
            "drafted_player": row.drafted_player,
            "drafted_games_reported": row.games,
            "drafted_profile": son.profile or "",
            "drafted_link": son.link,
            "drafted_note": son.note + ("" if son.corroborated is None else
                                        ("; games corroborated" if son.corroborated else "; list games differ from AFLDB (club-grain figure)")),
            "father": row.father,
            "father_games_reported": row.father_games,
            "father_profile": father.profile or "",
            "father_link": father.link,
            "father_note": father.note + ("" if father.corroborated is None else
                                          ("; games corroborated" if father.corroborated else "; list games differ from AFLDB (club-grain figure)")),
        })
    unused = [a for a in adjudications if a.used == 0]
    if unused:
        raise FatherSonSourceError("adjudications that applied to no row (stale or mistyped): "
                                   + "; ".join(f"{a.role} {a.name_raw} {a.club} {a.draft_year}" for a in unused))
    over = [a for a in adjudications if a.used > 1]
    if over:
        raise FatherSonSourceError("adjudications that applied more than once: "
                                   + "; ".join(f"{a.role} {a.name_raw}" for a in over))
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
        raise FatherSonSourceError(f"tracked artefact missing: {path}")
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != ARTEFACT_COLUMNS:
            raise FatherSonSourceError(f"{path.name} columns {reader.fieldnames} != {ARTEFACT_COLUMNS}")
        rows = list(reader)
    if not rows:
        raise FatherSonSourceError(f"{path.name} has no data rows")
    keys: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for i, r in enumerate(rows, start=2):
        key = r["source_key"]
        if not re.fullmatch(rf"{RECORD_PREFIX}:\d{{4}}:\d{{2}}", key or ""):
            raise FatherSonSourceError(f"{path.name} line {i}: source_key {key!r} malformed")
        if key in keys:
            raise FatherSonSourceError(f"{path.name} line {i}: duplicate source_key {key}")
        keys.add(key)
        if not re.fullmatch(r"\d{4}", r["draft_year"]) or key.split(":")[1] != r["draft_year"]:
            raise FatherSonSourceError(f"{path.name} line {i}: draft_year {r['draft_year']!r} disagrees with the key")
        if r["competition"] not in ("national", "rookie", "pre-draft"):
            raise FatherSonSourceError(f"{path.name} line {i}: competition {r['competition']!r}")
        if r["selection_pick"] and not r["selection_pick"].isdigit():
            raise FatherSonSourceError(f"{path.name} line {i}: selection_pick {r['selection_pick']!r}")
        if (r["competition"] == "pre-draft") != (r["selection_pick"] == ""):
            raise FatherSonSourceError(f"{path.name} line {i}: pre-draft rows have no pick and drafted rows have one")
        for who in ("drafted", "father"):
            if not r[who if who == "father" else "drafted_player"].strip():
                raise FatherSonSourceError(f"{path.name} line {i}: empty {who} name")
            profile, link = r[f"{who}_profile"].strip(), r[f"{who}_link"]
            if link not in ("unique", "resolved", "unmatched"):
                raise FatherSonSourceError(f"{path.name} line {i}: {who}_link {link!r}")
            if (link == "unmatched") != (profile == ""):
                raise FatherSonSourceError(f"{path.name} line {i}: {who}_link {link} disagrees with profile {profile!r}")
            if profile and not PROFILE_RE.match(profile):
                raise FatherSonSourceError(f"{path.name} line {i}: {who}_profile {profile!r} is not a profile path")
        if r["drafted_profile"] and r["drafted_profile"] == r["father_profile"]:
            raise FatherSonSourceError(f"{path.name} line {i}: son and father share a profile")
        pair = (r["father_profile"] or f"name:{normalise_name(r['father'])[0]}",
                r["drafted_profile"] or f"name:{normalise_name(r['drafted_player'])[0]}")
        if pair in pairs:
            raise FatherSonSourceError(f"{path.name} line {i}: the pair {pair} appears twice")
        pairs.add(pair)
    return rows


def artefact_measures(rows: list[dict[str, str]]) -> dict[str, int]:
    """The counts the rebuild gates read from the artefact itself (never typed)."""
    return {
        "selections": len(rows),
        "sons_linked": sum(1 for r in rows if r["drafted_profile"]),
        "fathers_linked": sum(1 for r in rows if r["father_profile"]),
        "distinct_fathers_linked": len({r["father_profile"] for r in rows if r["father_profile"]}),
        "distinct_sons_linked": len({r["drafted_profile"] for r in rows if r["drafted_profile"]}),
    }


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def fetch_roster(pg: Any) -> tuple[Roster, set[str], dict[str, int]]:
    with pg.cursor() as cur:
        cur.execute("SELECT key, id FROM sources WHERE key IN (%s, %s)", (SOURCE_KEY, IDENTITY_SOURCE_KEY))
        source_ids = dict(cur.fetchall())
        for key in (SOURCE_KEY, IDENTITY_SOURCE_KEY):
            if key not in source_ids:
                raise FatherSonSourceError(f"sources has no {key!r} row")
        cur.execute(
            """SELECT p.id, ei.external_id, p.display_name, p.given_name, p.surname, c.debut_season, c.games
                 FROM external_identities ei
                 JOIN players p ON p.id = ei.player_id
                 LEFT JOIN player_career_stats c ON c.player_id = p.id
                WHERE ei.source_id = %s AND ei.match_method = %s AND ei.status IN ('unique', 'resolved')""",
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
    roster = Roster(Candidate(pid, profile, display, given, surname, debut, games, club_games.get(pid, {}))
                    for pid, profile, display, given, surname, debut, games in people)
    return roster, orgs, source_ids


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
        son = identity.get(r["drafted_profile"]) if r["drafted_profile"] else None
        father = identity.get(r["father_profile"]) if r["father_profile"] else None
        if r["drafted_profile"] and son is None:
            missing.append(r["drafted_profile"])
        if r["father_profile"] and father is None:
            missing.append(r["father_profile"])
        out.append((r, son, father))
    if missing:
        raise FatherSonSourceError("profiles with no canonical identity on this database: " + ", ".join(sorted(set(missing))[:10]))
    return out


def write_rows(pg: Any, resolved: list[tuple[dict[str, str], int | None, int | None]], source_ids: dict[str, int],
               provenance: dict[str, Any] | None, rep: Reporter) -> dict[str, Any]:
    source_id = source_ids[SOURCE_KEY]
    with pg.cursor() as cur:
        cur.execute("SELECT id, slug FROM club_organizations")
        org_ids = {slug: oid for oid, slug in cur.fetchall()}
        cur.execute("SELECT id, organization_id, first_season, last_season FROM clubs")
        clubs = cur.fetchall()

    def club_for(org_slug: str, year: int) -> int:
        oid = org_ids[org_slug]
        # The organisation's identity contesting the selection's season (the next one); else its latest.
        hits = [c for c in clubs if c[1] == oid and (c[2] or 0) <= year + 1 and (c[3] is None or c[3] >= year + 1)]
        if len(hits) == 1:
            return hits[0][0]
        latest = max((c for c in clubs if c[1] == oid), key=lambda c: c[2] or 0)
        return latest[0]

    with import_batch(pg, SOURCE_KEY, TOOL, "father_son_selections") as batch:
        batch.records_read = len(resolved)
        with pg.cursor() as cur:
            selection_rows = []
            relationship_rows = []
            for r, son_id, father_id in resolved:
                year = int(r["draft_year"])
                note = (f"drafted: {r['drafted_note']}; father: {r['father_note']}; selection {r['selection_raw'] or 'pre-draft'}; "
                        f"list games: son {r['drafted_games_reported'] or '?'}, father {r['father_games_reported'] or '?'}")
                selection_rows.append((
                    year, RULE, r["competition"], son_id, r["drafted_player"], r["drafted_link"],
                    father_id, r["father"], r["father_link"], club_for(club_org_slug(r["club"]), year), r["club"],
                    int(r["selection_pick"]) if r["selection_pick"] else None, note, source_id, r["source_key"], batch.id))
                relationship_rows.append((
                    father_id, r["father"], "father", son_id, r["drafted_player"], "son", "parent_child",
                    RELATIONSHIP_LABEL, "source", f"AFL father–son rule selection, {r['club']} {year} ({r['source_key']})",
                    TOOL, source_id, f"{RELATIONSHIP_PREFIX}:{r['source_key']}", batch.id))
            cur.executemany(
                """INSERT INTO father_son_selections
                     (draft_year, rule, competition, drafted_player_id, drafted_player_name, drafted_link_status,
                      father_player_id, father_name, father_link_status, club_id, club_name_raw,
                      selection_pick, selection_note, source_id, source_record_id, import_batch_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source_id, source_record_id) DO UPDATE SET
                     draft_year = EXCLUDED.draft_year, rule = EXCLUDED.rule, competition = EXCLUDED.competition,
                     drafted_player_id = EXCLUDED.drafted_player_id, drafted_player_name = EXCLUDED.drafted_player_name,
                     drafted_link_status = EXCLUDED.drafted_link_status, father_player_id = EXCLUDED.father_player_id,
                     father_name = EXCLUDED.father_name, father_link_status = EXCLUDED.father_link_status,
                     club_id = EXCLUDED.club_id, club_name_raw = EXCLUDED.club_name_raw,
                     selection_pick = EXCLUDED.selection_pick, selection_note = EXCLUDED.selection_note,
                     import_batch_id = EXCLUDED.import_batch_id""",
                selection_rows)
            cur.executemany(
                """INSERT INTO player_relationships
                     (person_a_player_id, person_a_name, person_a_role, person_b_player_id, person_b_name, person_b_role,
                      relationship, relationship_label, confidence, evidence, extraction_method,
                      source_id, source_record_id, import_batch_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source_id, source_record_id) DO UPDATE SET
                     person_a_player_id = EXCLUDED.person_a_player_id, person_a_name = EXCLUDED.person_a_name,
                     person_a_role = EXCLUDED.person_a_role, person_b_player_id = EXCLUDED.person_b_player_id,
                     person_b_name = EXCLUDED.person_b_name, person_b_role = EXCLUDED.person_b_role,
                     relationship = EXCLUDED.relationship, relationship_label = EXCLUDED.relationship_label,
                     confidence = EXCLUDED.confidence, evidence = EXCLUDED.evidence,
                     extraction_method = EXCLUDED.extraction_method, import_batch_id = EXCLUDED.import_batch_id""",
                relationship_rows)
            keys = [r["source_key"] for r, _, _ in resolved]
            cur.execute(
                """DELETE FROM father_son_selections
                    WHERE source_id = %s AND NOT (source_record_id = ANY(%s))""", (source_id, keys))
            stale_selections = cur.rowcount
            cur.execute(
                """DELETE FROM player_relationships
                    WHERE source_id = %s AND source_record_id LIKE %s AND NOT (source_record_id = ANY(%s))""",
                (source_id, f"{RELATIONSHIP_PREFIX}:{RECORD_PREFIX}:%", [f"{RELATIONSHIP_PREFIX}:{k}" for k in keys]))
            stale_relationships = cur.rowcount
        batch.records_inserted += len(selection_rows) + len(relationship_rows)
    rep.result("father_son_selections written", len(selection_rows))
    rep.result("player_relationships written", len(relationship_rows))
    rep.result("stale rows removed", stale_selections + stale_relationships)
    summary = {"selections": len(selection_rows), "relationships": len(relationship_rows),
               "stale_removed": stale_selections + stale_relationships,
               "measures": artefact_measures([r for r, _, _ in resolved]),
               "provenance": provenance}
    with pg.cursor() as cur:
        cur.execute("UPDATE import_batches SET validation_result = %s WHERE id = %s", (json.dumps(summary), batch.id))
    pg.commit()
    summary["batch_id"] = batch.id
    return summary


def read_provenance(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ("wikipedia_title", "wikipedia_pageid", "revision_id", "revision_timestamp", "raw_rows"):
        if key not in data:
            raise FatherSonSourceError(f"{path.name} lacks {key}")
    return data


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_normalize(args: argparse.Namespace) -> int:
    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB father–son selections: normalise the Wikipedia list")
    raw_rows = read_raw(args.raw)
    adjudications = read_adjudications(args.adjudications)
    rep.step(f"{args.raw.name}: {len(raw_rows)} selections; {args.adjudications.name}: {len(adjudications)} adjudications")
    load_env()
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  identities from: {safe_dsn(dsn)}")
    pg = connect_pg(dsn)
    roster, orgs, _ = fetch_roster(pg)
    rows = normalise_rows(raw_rows, roster, adjudications, orgs)
    m = artefact_measures(rows)
    for k, v in m.items():
        rep.result(k, v)
    rep.result("sons never played (list 0 games)", sum(1 for r in rows if r["drafted_link"] == "unmatched"))
    rep.result("fathers with no VFL/AFL career", sum(1 for r in rows if r["father_link"] == "unmatched"))
    rep.result("adjudicated people", sum(1 for r in rows for w in ("drafted", "father") if r[f"{w}_link"] == "resolved"
                                         or "adjudicated" in r[f"{w}_note"]))
    rep.result("games figures corroborated", sum(1 for r in rows for w in ("drafted", "father") if "games corroborated" in r[f"{w}_note"]))
    text = render_artefact(rows)
    if args.check:
        current = args.out.read_text(encoding="utf-8") if args.out.is_file() else None
        if current is None:
            sys.exit(f"ERROR: {args.out} is not in this checkout")
        if current.replace("\r\n", "\n") != text:
            sys.exit(f"ERROR: {args.out.name} differs from a fresh normalisation of {args.raw.name} on this database")
        print(f"  {args.out.name} is exactly the regeneration; done (check) in {time.time() - started:.1f}s")
        return 0
    args.out.write_text(text, encoding="utf-8", newline="\n")
    provenance = {
        "wikipedia_title": args.wikipedia_title, "wikipedia_pageid": args.wikipedia_pageid,
        "revision_id": args.revision_id, "revision_timestamp": args.revision_timestamp,
        "section": "List of father–son selections (VFL/AFL)",
        "raw_rows": len(raw_rows), "raw_file": str(args.raw.relative_to(REPO_ROOT)).replace("\\", "/"),
        "games_last_updated_note": "Games Played last updated 12/10/2025 (the list's own trailer row)",
        "normalised_on": time.strftime("%Y-%m-%d"), "measures": m,
    }
    args.provenance.write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"  wrote {args.out.name} ({len(rows)} rows) and {args.provenance.name}; done in {time.time() - started:.1f}s")
    return 0


def cmd_load(args: argparse.Namespace) -> int:
    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB father–son selections (tracked Wikipedia-derived artefact)")
    rows = read_artefact(args.csv)
    provenance = read_provenance(args.provenance)
    m = artefact_measures(rows)
    rep.step(f"{args.csv.name}: {m['selections']} selections, shape verified"
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
    with pg.cursor() as cur:
        cur.execute("SELECT key, id FROM sources WHERE key IN (%s, %s)", (SOURCE_KEY, IDENTITY_SOURCE_KEY))
        source_ids = dict(cur.fetchall())
    for key in (SOURCE_KEY, IDENTITY_SOURCE_KEY):
        if key not in source_ids:
            sys.exit(f"ERROR: sources has no {key!r} row")
    resolved = resolve_artefact(rows, fetch_identity(pg, source_ids))
    rep.result("sons linked", sum(1 for _, s, _ in resolved if s is not None))
    rep.result("fathers linked", sum(1 for _, _, f in resolved if f is not None))
    rep.result("distinct fathers linked", len({f for _, _, f in resolved if f is not None}))
    if args.dry_run:
        print(f"  done (dry run) in {time.time() - started:.1f}s")
        return 0
    summary = write_rows(pg, resolved, source_ids, provenance, rep)
    print(f"  batch {summary['batch_id']}: {summary['selections']} selections, {summary['relationships']} relationships; "
          f"done in {time.time() - started:.1f}s")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    n = sub.add_parser("normalize", help="resolve the raw Wikipedia list to profile paths and write the tracked artefact")
    n.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    n.add_argument("--adjudications", type=Path, default=DEFAULT_ADJUDICATIONS)
    n.add_argument("--out", type=Path, default=DEFAULT_ARTEFACT)
    n.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    n.add_argument("--check", action="store_true", help="compare the tracked artefact with a fresh normalisation; write nothing")
    n.add_argument("--wikipedia-title", default="Father–son rule")
    n.add_argument("--wikipedia-pageid", type=int, default=4274230)
    n.add_argument("--revision-id", type=int, default=1370239415)
    n.add_argument("--revision-timestamp", default="2026-08-19T23:51:53Z")
    n.add_argument("--quiet", action="store_true")
    n.set_defaults(func=cmd_normalize)
    l = sub.add_parser("load", help="load the tracked artefact into father_son_selections and player_relationships")
    l.add_argument("--csv", type=Path, default=DEFAULT_ARTEFACT)
    l.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    l.add_argument("--validate-only", action="store_true", help="Check the artefact's shape offline; touch no database.")
    l.add_argument("--dry-run", action="store_true")
    l.add_argument("--quiet", action="store_true")
    l.set_defaults(func=cmd_load)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except FatherSonSourceError as exc:
        sys.exit(f"ERROR: {exc}")


if __name__ == "__main__":
    sys.exit(main())
