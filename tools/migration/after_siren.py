#!/usr/bin/env python3
"""After-the-siren kicks: normalise the Wikipedia table exports into one tracked artefact.

    python tools/migration/after_siren.py normalize          # writes the tracked artefact
    python tools/migration/after_siren.py normalize --check  # tracked artefact == regeneration

Why this exists (AFLDB-ISSUE-118 §23.33)
----------------------------------------
Wikipedia's "List of kicks after the siren in the VFL/AFL" carries five tables
(goal to win, goal to draw, behind to win, behind to draw, missed opportunity),
the first three of which have a second "other competitions" table for
pre-season and night-series matches. The operator exported them as eight CSVs
under ``data/records/after-siren/`` (raw, untracked; the article revision the
export was taken from is NOT recorded there). AFLDB has no play-by-play data,
so an after-the-siren kick is a curated, cited external fact in the sense of
migration 053, and it is modelled canonically in ``after_siren_kicks``
(migration 089), not as a Grid Solver criterion: every source row is one
historical event, whichever downstream criterion later selects from it.

Semantics — what a row asserts
------------------------------
The kicker's club is always the ``Club`` / ``Team`` column and its score is
always written first in ``Final score``; the separator (``d.`` / ``drew`` /
``lost to``) is checked against the sign of the margin computed from the two
scores, and each score's ``G.B (pts)`` (``S.G.B (pts)`` under ``[c]``
supergoal scoring) must add up. Three typed facts are then derived and
cross-checked against the table the row came from:

* ``kick_scored`` — what the kick registered: ``goal``, ``behind`` or ``none``
  (a missed-table ``Outcome`` of ``Behind`` is a behind that did not change the
  result; ``No score …`` is ``none``);
* ``kick_effect`` — what the kick did to the result: ``won``, ``drew`` or
  ``none`` (every missed-table row);
* ``kicker_result`` — the match result from the kicker's side: ``win``,
  ``draw`` or ``loss``.

A goal-to-win row must show a 1–6 point win, a behind-to-win row a 1 point
win, a draw row a level score, and a missed row a loss or a draw. Anything
else refuses the run unless an adjudication explains it (David King 1994 QF:
a miss at the end of regulation time with scores level, followed by an
extra-time win). ``siren`` records which siren the kick followed: ``final``
for every ordinary row, ``end_of_extra_time`` (Luke Shuey 2017 EF, footnote
``[a]``) and ``end_of_regulation`` (King, footnote ``[b]``), each only by an
adjudication that quotes the footnote, never by a silent rule.

The ``_1`` tables' rows keep their ``Competition`` (``premiership_season`` is
false) and are never forced onto a premiership-season match; Gridley's
``winaftersiren`` is later derived downstream as ``premiership_season AND
kick_scored IN (goal, behind) AND kick_effect = won``, and no column here is
specific to that criterion.

Identity
--------
Nothing here resolves a player, club or match: the normaliser is offline and
deterministic. The event key ``season-competition-round-club-player`` is
derived from the source fields only, so it is stable across regenerations and
unique across files (two files carrying the same event refuse). The
repeat marker the article writes inside the name cell (``Barry Hall (2)``) is
stripped into ``player_name`` and kept in ``player_name_raw``. Resolution to
``players`` / ``clubs`` / ``matches`` belongs to the loader.

Adjudications (``data/records/after-siren-adjudications.csv``) are keyed by
event key and field; each must be NEEDED (the row would otherwise refuse) and
used exactly once, so a stale adjudication refuses the run. A row with an
empty ``Ref.`` needs a ``citation`` adjudication recording the evidence gap.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    Reporter, connect_pg, import_batch, load_env, require_env, safe_dsn,
)
from father_son import normalise_name  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "records" / "after-siren"
DEFAULT_ADJUDICATIONS = REPO_ROOT / "data" / "records" / "after-siren-adjudications.csv"
DEFAULT_ARTEFACT = REPO_ROOT / "data" / "records" / "after-siren-events.csv"
DEFAULT_PROVENANCE = REPO_ROOT / "data" / "records" / "after-siren-events.source.json"

SOURCE_ARTICLE = "List of kicks after the siren in the VFL/AFL"
SOURCE_URL = "https://en.wikipedia.org/wiki/List_of_kicks_after_the_siren_in_the_VFL/AFL"
SOURCE_PAGE_ID = 11694586
#: The live revision inspected for the footnote texts and the article's table
#: headings. The export's own revision is unknown (see the module docstring).
INSPECTED_REVISION_ID = "1371785656"
INSPECTED_ON = "2026-09-05"
PREMIERSHIP_COMPETITION = "VFL/AFL"

FINALS_ORDER = {"WF": 0, "EF": 1, "QF": 2, "SF": 3, "PF": 4, "GF": 5}
SIRENS = ("final", "end_of_regulation", "end_of_extra_time")
ADJUDICATION_FIELDS = ("siren", "citation", "score_arithmetic")

FILE_RE = re.compile(
    r"^Players_to_have_(?:kicked_a_(?P<scored>goal|behind)_to_(?P<effect>win|draw)"
    r"|(?P<missed>missed_an_opportunity_to_win_or_draw))_a_match_after_the_final_siren(?P<other>_1)?\.csv$"
)
TABLE_HEADINGS = {
    ("goal", "win"): "Players to have kicked a goal to win a match after the final siren",
    ("goal", "draw"): "Players to have kicked a goal to draw a match after the final siren",
    ("behind", "win"): "Players to have kicked a behind to win a match after the final siren",
    ("behind", "draw"): "Players to have kicked a behind to draw a match after the final siren",
    ("miss", "none"): "Players to have missed an opportunity to win or draw a match after the final siren",
}
OTHER_COMPETITIONS_SUFFIX = " (other competitions)"

SCORE_RE = re.compile(r"^(?P<parts>\d+(?:\.\d+){1,2}) \((?P<pts>\d+)\)$")
FOOTNOTE_RE = re.compile(r"\[([a-z])\]")
REPEAT_RE = re.compile(r"^(?P<name>.+?) \((?P<n>\d+)\)$")
OUTCOMES = {
    "Behind": ("behind", ""),
    "Behind (hit the goal post)": ("behind", "hit the goal post"),
    "No score (fell short)": ("none", "fell short"),
    "No score (out on the full)": ("none", "out on the full"),
}

ARTEFACT_COLUMNS = [
    "event_key", "season", "competition", "premiership_season", "round_raw", "round_code", "round_kind",
    "player_name_raw", "player_name", "club_raw", "opponent_raw",
    "kick_scored", "kick_effect", "shot_detail", "kicker_result", "siren",
    "kicker_score_raw", "opponent_score_raw", "kicker_points", "opponent_points", "margin", "supergoal_scoring",
    "score_footnote_raw", "outcome_raw", "ref_raw", "cited", "adjudication_keys",
    "source_file", "source_table", "source_line", "note",
]
ADJUDICATION_COLUMNS = ["adjudication_key", "event_key", "field", "value", "evidence", "decided_on"]


class AfterSirenSourceError(RuntimeError):
    pass


@dataclass(frozen=True)
class SourceRow:
    file: str
    table: str
    line: int
    scored_category: str   # goal | behind | miss
    effect_category: str   # win | draw | none
    premiership: bool
    competition: str
    player_raw: str
    club: str
    opponent: str
    round_raw: str
    year: str
    final_score: str
    outcome_raw: str
    ref_raw: str


@dataclass(frozen=True)
class Adjudication:
    key: str
    event_key: str
    field: str
    value: str
    evidence: str
    decided_on: str


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def classify_file(name: str) -> tuple[str, str, bool]:
    """file name -> (scored category, effect category, premiership-season table)."""
    m = FILE_RE.match(name)
    if not m:
        raise AfterSirenSourceError(f"{name}: not an after-siren table export")
    if m.group("missed"):
        return "miss", "none", m.group("other") is None
    return m.group("scored"), m.group("effect"), m.group("other") is None


def table_heading(scored: str, effect: str, premiership: bool) -> str:
    return TABLE_HEADINGS[(scored, effect)] + ("" if premiership else OTHER_COMPETITIONS_SUFFIX)


def read_source_file(path: Path) -> list[SourceRow]:
    scored, effect, premiership = classify_file(path.name)
    text = path.read_text(encoding="utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise AfterSirenSourceError(f"{path.name}: no data rows")
    fields = list(rows[0].keys())
    club_col = "Team" if "Team" in fields else "Club"
    required = ["Player", club_col, "Opponent", "Rd.", "Year", "Final score", "Ref."]
    if scored == "miss":
        required.append("Outcome")
    if not premiership:
        required.append("Competition")
    missing = [c for c in required if c not in fields]
    if missing:
        raise AfterSirenSourceError(f"{path.name}: missing columns {missing}")
    unexpected = [c for c in fields if c not in required]
    if unexpected:
        raise AfterSirenSourceError(f"{path.name}: unexpected columns {unexpected}")
    out: list[SourceRow] = []
    for i, r in enumerate(rows, start=2):
        out.append(SourceRow(
            file=path.name, table=table_heading(scored, effect, premiership), line=i,
            scored_category=scored, effect_category=effect, premiership=premiership,
            competition=PREMIERSHIP_COMPETITION if premiership else (r.get("Competition") or "").strip(),
            player_raw=(r["Player"] or "").strip(), club=(r[club_col] or "").strip(),
            opponent=(r["Opponent"] or "").strip(), round_raw=(r["Rd."] or "").strip(),
            year=(r["Year"] or "").strip(), final_score=(r["Final score"] or "").strip(),
            outcome_raw=(r.get("Outcome") or "").strip(), ref_raw=(r["Ref."] or "").strip(),
        ))
    return out


def read_sources(raw_dir: Path) -> list[SourceRow]:
    files = sorted(p for p in raw_dir.glob("*.csv") if FILE_RE.match(p.name))
    if not files:
        raise AfterSirenSourceError(f"{raw_dir}: no after-siren table exports")
    rows: list[SourceRow] = []
    for p in files:
        rows.extend(read_source_file(p))
    return rows


def read_adjudications(path: Path) -> list[Adjudication]:
    if not path.is_file():
        return []
    rows = list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig"))))
    out: list[Adjudication] = []
    seen: set[tuple[str, str]] = set()
    for i, r in enumerate(rows, start=2):
        if list(r.keys()) != ADJUDICATION_COLUMNS:
            raise AfterSirenSourceError(f"{path.name}: columns must be {ADJUDICATION_COLUMNS}")
        v = {k: (r[k] or "").strip() for k in ADJUDICATION_COLUMNS}
        a = Adjudication(v["adjudication_key"], v["event_key"], v["field"], v["value"], v["evidence"], v["decided_on"])
        for f in ("key", "event_key", "field", "value", "evidence", "decided_on"):
            if not getattr(a, f):
                raise AfterSirenSourceError(f"{path.name} line {i}: empty {f}")
        if a.field not in ADJUDICATION_FIELDS:
            raise AfterSirenSourceError(f"{path.name} line {i}: field {a.field!r} is not one of {ADJUDICATION_FIELDS}")
        if a.field == "siren" and a.value not in SIRENS:
            raise AfterSirenSourceError(f"{path.name} line {i}: siren {a.value!r} is not one of {SIRENS}")
        if a.field == "citation" and a.value != "uncited":
            raise AfterSirenSourceError(f"{path.name} line {i}: citation adjudication value must be 'uncited'")
        if a.field == "score_arithmetic" and a.value != "points_as_written":
            raise AfterSirenSourceError(f"{path.name} line {i}: score_arithmetic adjudication value must be 'points_as_written'")
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", a.decided_on):
            raise AfterSirenSourceError(f"{path.name} line {i}: decided_on {a.decided_on!r} is not a date")
        if (a.event_key, a.field) in seen:
            raise AfterSirenSourceError(f"{path.name} line {i}: {a.event_key} {a.field} adjudicated twice")
        seen.add((a.event_key, a.field))
        out.append(a)
    return out


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not s:
        raise AfterSirenSourceError(f"cannot slugify {text!r}")
    return s


def split_player(raw: str) -> tuple[str, str]:
    """'Barry Hall (2)' -> ('Barry Hall', '(2)'): the article's repeat marker, not a name."""
    m = REPEAT_RE.match(raw)
    if m:
        return m.group("name"), f"({m.group('n')})"
    return raw, ""


def parse_round(raw: str) -> tuple[str, str, int]:
    """'11' / 'EF' -> (round_code, round_kind, sort key)."""
    if re.match(r"^\d+$", raw):
        return raw, "home_and_away", int(raw)
    if raw in FINALS_ORDER:
        return raw, "final", 1000 + FINALS_ORDER[raw]
    raise AfterSirenSourceError(f"unrecognised round {raw!r}")


def parse_score(raw: str, context: str) -> tuple[int, bool, bool]:
    """'10.10 (70)' -> (70, False, True); '0.4.6 (30)' -> (30, True, True). Last: the parts add up."""
    m = SCORE_RE.match(raw)
    if not m:
        raise AfterSirenSourceError(f"{context}: unreadable score {raw!r}")
    parts = [int(p) for p in m.group("parts").split(".")]
    pts = int(m.group("pts"))
    if len(parts) == 2:
        goals, behinds = parts
        total, supergoal = goals * 6 + behinds, False
    else:
        supers, goals, behinds = parts
        total, supergoal = supers * 9 + goals * 6 + behinds, True
    return pts, supergoal, total == pts


def parse_final_score(raw: str, context: str) -> tuple[str, str, int, int, bool, str, bool]:
    """'A d. B[a]' -> (A, B, A pts, B pts, supergoal scoring, footnote marker, both scores add up)."""
    footnotes = FOOTNOTE_RE.findall(raw)
    if len(footnotes) > 1:
        raise AfterSirenSourceError(f"{context}: more than one footnote in {raw!r}")
    body = FOOTNOTE_RE.sub("", raw).strip()
    for sep, expected in ((" d. ", 1), (" drew ", 0), (" lost to ", -1)):
        if sep in body:
            left, right = body.split(sep, 1)
            break
    else:
        raise AfterSirenSourceError(f"{context}: no result separator in {raw!r}")
    kicker_pts, super_a, adds_a = parse_score(left.strip(), context)
    opp_pts, super_b, adds_b = parse_score(right.strip(), context)
    if super_a != super_b:
        raise AfterSirenSourceError(f"{context}: mixed scoring notations in {raw!r}")
    margin = kicker_pts - opp_pts
    sign = (margin > 0) - (margin < 0)
    if sign != expected:
        raise AfterSirenSourceError(f"{context}: separator {sep.strip()!r} disagrees with the scores in {raw!r}")
    footnote = f"[{footnotes[0]}]" if footnotes else ""
    if supergoal := super_a:
        if footnote != "[c]":
            raise AfterSirenSourceError(f"{context}: supergoal notation without the [c] footnote in {raw!r}")
    elif footnote == "[c]":
        raise AfterSirenSourceError(f"{context}: [c] footnote without supergoal notation in {raw!r}")
    return left.strip(), right.strip(), kicker_pts, opp_pts, supergoal, footnote, adds_a and adds_b


def event_key(season: str, competition: str, round_code: str, club: str, player: str) -> str:
    return f"{season}-{slugify(competition)}-{round_code}-{slugify(club)}-{slugify(player)}"


def normalise_row(src: SourceRow, adjudications: dict[tuple[str, str], Adjudication], used: set[tuple[str, str]]) -> dict[str, str]:
    ctx = f"{src.file} line {src.line}"
    for f in ("player_raw", "club", "opponent", "round_raw", "year", "final_score", "competition"):
        if not getattr(src, f):
            raise AfterSirenSourceError(f"{ctx}: empty {f}")
    if not re.match(r"^(18|19|20)\d{2}$", src.year):
        raise AfterSirenSourceError(f"{ctx}: year {src.year!r}")
    if src.premiership and src.competition != PREMIERSHIP_COMPETITION:
        raise AfterSirenSourceError(f"{ctx}: premiership table with competition {src.competition!r}")
    if not src.premiership and src.competition == PREMIERSHIP_COMPETITION:
        raise AfterSirenSourceError(f"{ctx}: other-competitions table carrying the premiership competition")
    player, repeat = split_player(src.player_raw)
    round_code, round_kind, _ = parse_round(src.round_raw)
    key = event_key(src.year, src.competition, round_code, src.club, player)
    kicker_raw, opp_raw, kicker_pts, opp_pts, supergoal, footnote, adds_up = parse_final_score(src.final_score, ctx)
    margin = kicker_pts - opp_pts
    kicker_result = "win" if margin > 0 else "draw" if margin == 0 else "loss"

    def take(field: str) -> Adjudication | None:
        a = adjudications.get((key, field))
        if a is not None:
            if (key, field) in used:
                raise AfterSirenSourceError(f"{ctx}: adjudication {a.key} applied twice")
            used.add((key, field))
        return a

    if src.scored_category == "miss":
        if src.outcome_raw not in OUTCOMES:
            raise AfterSirenSourceError(f"{ctx}: unrecognised Outcome {src.outcome_raw!r}")
        kick_scored, shot_detail = OUTCOMES[src.outcome_raw]
        kick_effect = "none"
    else:
        if src.outcome_raw:
            raise AfterSirenSourceError(f"{ctx}: Outcome on a scoring row")
        kick_scored, shot_detail = src.scored_category, ""
        kick_effect = "won" if src.effect_category == "win" else "drew"

    # The source's goals.behinds must add to its own points; a row where they do not is kept only
    # with an adjudication that records the defect and takes the points as written (the margin
    # and the result read from the points, never from a corrected goals/behinds guess).
    score_adj = take("score_arithmetic")
    if adds_up and score_adj is not None:
        raise AfterSirenSourceError(f"{ctx}: adjudication {score_adj.key} is not needed ({key} adds up)")
    if not adds_up and score_adj is None:
        raise AfterSirenSourceError(f"{ctx}: goals.behinds do not add to the points in {src.final_score!r} ({key})")

    # The siren the kick followed: 'final' unless a footnote is explained by an adjudication.
    siren_adj = take("siren")
    if footnote and footnote != "[c]":
        if siren_adj is None:
            raise AfterSirenSourceError(f"{ctx}: footnote {footnote} on {key} needs a siren adjudication")
        siren = siren_adj.value
    else:
        if siren_adj is not None:
            raise AfterSirenSourceError(f"{ctx}: adjudication {siren_adj.key} is not needed ({key} has no footnote)")
        siren = "final"

    # Category against result: what the table says the kick did must be what the scores show.
    if kick_effect == "won":
        if kicker_result != "win":
            raise AfterSirenSourceError(f"{ctx}: a kick to win in a {kicker_result}")
        limit = 6 if kick_scored == "goal" else 1
        if margin > limit:
            raise AfterSirenSourceError(f"{ctx}: a {kick_scored} cannot turn the result with a {margin}-point margin")
    elif kick_effect == "drew":
        if kicker_result != "draw":
            raise AfterSirenSourceError(f"{ctx}: a kick to draw in a {kicker_result}")
    else:
        if kicker_result == "win" and siren != "end_of_regulation":
            raise AfterSirenSourceError(f"{ctx}: a missed opportunity in a win ({key}) needs an end_of_regulation siren adjudication")
        if kick_scored == "behind" and kicker_result == "draw":
            raise AfterSirenSourceError(f"{ctx}: a behind that left the scores level would have drawn the match, not missed")
    if siren == "end_of_regulation" and kick_effect != "none":
        raise AfterSirenSourceError(f"{ctx}: a kick that decided the match cannot have preceded extra time")

    citation_adj = take("citation")
    if src.ref_raw:
        if not re.match(r"^\[\d+\]$", src.ref_raw):
            raise AfterSirenSourceError(f"{ctx}: unreadable Ref. {src.ref_raw!r}")
        if citation_adj is not None:
            raise AfterSirenSourceError(f"{ctx}: adjudication {citation_adj.key} is not needed ({key} is cited)")
        cited = "true"
    else:
        if citation_adj is None:
            raise AfterSirenSourceError(f"{ctx}: {key} has no Ref. and no citation adjudication")
        cited = "false"

    adj_keys = [a.key for a in (score_adj, siren_adj, citation_adj) if a is not None]
    notes = []
    if repeat:
        notes.append(f"article repeat marker {repeat} stripped from the name cell")
    for a in (score_adj, siren_adj, citation_adj):
        if a is not None:
            notes.append(f"{a.field}: {a.evidence}")
    return {
        "event_key": key, "season": src.year, "competition": src.competition,
        "premiership_season": "true" if src.premiership else "false",
        "round_raw": src.round_raw, "round_code": round_code, "round_kind": round_kind,
        "player_name_raw": src.player_raw, "player_name": player, "club_raw": src.club, "opponent_raw": src.opponent,
        "kick_scored": kick_scored, "kick_effect": kick_effect, "shot_detail": shot_detail,
        "kicker_result": kicker_result, "siren": siren,
        "kicker_score_raw": kicker_raw, "opponent_score_raw": opp_raw,
        "kicker_points": str(kicker_pts), "opponent_points": str(opp_pts), "margin": str(margin),
        "supergoal_scoring": "true" if supergoal else "false",
        "score_footnote_raw": footnote, "outcome_raw": src.outcome_raw, "ref_raw": src.ref_raw, "cited": cited,
        "adjudication_keys": ";".join(adj_keys),
        "source_file": src.file, "source_table": src.table, "source_line": str(src.line),
        "note": "; ".join(notes),
    }


def sort_key(row: dict[str, str]) -> tuple:
    _, _, order = parse_round(row["round_code"])
    return (int(row["season"]), 0 if row["premiership_season"] == "true" else 1, row["competition"],
            order, row["club_raw"].lower(), row["player_name"].lower())


def normalise(sources: list[SourceRow], adjudications: list[Adjudication]) -> list[dict[str, str]]:
    adj = {(a.event_key, a.field): a for a in adjudications}
    used: set[tuple[str, str]] = set()
    out = [normalise_row(s, adj, used) for s in sources]
    stale = sorted(a.key for a in adjudications if (a.event_key, a.field) not in used)
    if stale:
        raise AfterSirenSourceError(f"adjudications not needed by any row: {', '.join(stale)}")
    by_key: dict[str, dict[str, str]] = {}
    for r in out:
        prior = by_key.get(r["event_key"])
        if prior is not None:
            raise AfterSirenSourceError(
                f"duplicate event {r['event_key']}: {prior['source_file']} line {prior['source_line']} "
                f"and {r['source_file']} line {r['source_line']}")
        by_key[r["event_key"]] = r
    out.sort(key=sort_key)
    return out


def render_artefact(rows: list[dict[str, str]]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=ARTEFACT_COLUMNS, lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()


def measures(rows: list[dict[str, str]]) -> dict[str, int]:
    def count(pred) -> int:
        return sum(1 for r in rows if pred(r))
    prem = lambda r: r["premiership_season"] == "true"  # noqa: E731
    return {
        "events": len(rows),
        "premiership_season_events": count(prem),
        "other_competition_events": count(lambda r: not prem(r)),
        "goal_won": count(lambda r: r["kick_scored"] == "goal" and r["kick_effect"] == "won"),
        "behind_won": count(lambda r: r["kick_scored"] == "behind" and r["kick_effect"] == "won"),
        "goal_drew": count(lambda r: r["kick_scored"] == "goal" and r["kick_effect"] == "drew"),
        "behind_drew": count(lambda r: r["kick_scored"] == "behind" and r["kick_effect"] == "drew"),
        "missed": count(lambda r: r["kick_effect"] == "none"),
        "missed_behind": count(lambda r: r["kick_effect"] == "none" and r["kick_scored"] == "behind"),
        "missed_no_score": count(lambda r: r["kick_effect"] == "none" and r["kick_scored"] == "none"),
        "premiership_season_scored_and_won": count(lambda r: prem(r) and r["kick_scored"] != "none" and r["kick_effect"] == "won"),
        "premiership_season_scored_and_won_players": len({r["player_name"] for r in rows if prem(r) and r["kick_scored"] != "none" and r["kick_effect"] == "won"}),
        "siren_end_of_extra_time": count(lambda r: r["siren"] == "end_of_extra_time"),
        "siren_end_of_regulation": count(lambda r: r["siren"] == "end_of_regulation"),
        "uncited": count(lambda r: r["cited"] == "false"),
        "score_arithmetic_defects": count(lambda r: "score_arithmetic:" in r["note"]),
        "adjudicated": count(lambda r: r["adjudication_keys"] != ""),
        "repeat_markers_stripped": count(lambda r: r["player_name_raw"] != r["player_name"]),
    }


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render_provenance(raw_dir: Path, sources: list[SourceRow], adjudications: list[Adjudication], rows: list[dict[str, str]]) -> str:
    files = sorted({s.file for s in sources})
    per_file = {f: sum(1 for s in sources if s.file == f) for f in files}
    provenance = {
        "wikipedia_title": SOURCE_ARTICLE,
        "source_url": SOURCE_URL,
        "page_id": SOURCE_PAGE_ID,
        "export_revision_id": None,
        "export_revision_note": "The operator export does not record the article revision it was taken from. "
                                "The live article was inspected for the footnote texts and table headings; "
                                "its Cameron Zurhaar 2026 row is cited there, so the export predates that citation.",
        "inspected_revision_id": INSPECTED_REVISION_ID,
        "inspected_on": INSPECTED_ON,
        "raw_dir": str(raw_dir.relative_to(REPO_ROOT)).replace("\\", "/"),
        "raw_files": [{"file": f, "rows": per_file[f], "sha256": sha256_file(raw_dir / f)} for f in files],
        "raw_rows": len(sources),
        "adjudications": len(adjudications),
        "measures": measures(rows),
    }
    return json.dumps(provenance, indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Loading — the tracked artefact into after_siren_kicks (migration 089)
# ---------------------------------------------------------------------------
#
# Identity is canonical and fail-closed; nothing here matches fuzzily or on a
# name alone.
#
# * Club — ``club_raw`` / ``opponent_raw`` resolve to exactly one club
#   ORGANISATION through ``clubs`` and ``club_aliases``, so "Kangaroos",
#   "Footscray" and "South Melbourne" are the same lineage as their modern
#   identity. More than one organisation, or none, refuses the run. The era
#   club actually stored is taken from the resolved MATCH wherever there is
#   one, so no era-window tie-break can put the wrong identity on a linked
#   row; only a row with no match falls back to the season-window rule
#   ``src/lib/ingest/datasets.ts`` uses (the era whose own first season is
#   latest among those covering the season).
#
# * Match — the key is (season, round, kicker's organisation, opponent's
#   organisation) and the artefact's own points are the INDEPENDENT check that
#   picks one candidate, which is what separates a drawn final from its replay
#   (1972 SF Carlton–Richmond). A numeric round that finds nothing is retried
#   one higher when the season has an Opening-Round-shaped first round, the
#   rule ``tools/records/import-first-kick-goal.ts`` established. A season this
#   database does not carry at all leaves ``match_id`` NULL and is reported; a
#   season it DOES carry that still cannot resolve refuses, as does a candidate
#   whose scores disagree with the source's.
#
# * Player — within a resolved match the kicker is the one player of that name
#   in that match for the kicker's club, read from ``player_match_stats``:
#   match participation, not a name lookup. A row with no match (the other
#   competitions, and any season absent here) falls back to participation for
#   that club in that season. Both apply ``father_son.normalise_name``'s
#   generational-suffix rule when it is needed to separate same-name players.
#   Nothing resolved leaves ``player_id`` NULL with the source's own spelling
#   kept and ``link_status_value`` recording why, exactly as 053 does.
#
# * Score confirmation — for a linked kicker of a scoring kick in a resolved
#   match, the player's goals (or behinds) in that match must not be zero. A
#   NULL is "not recorded" in the pre-1965 sense, never zero, so it confirms
#   nothing and refuses nothing; a recorded zero contradicts the source and
#   refuses the run.
#
# The upsert is keyed on (source, event key) — the artefact's own stable key —
# and rewrites a row only when a column actually differs, so a second identical
# load inserts nothing, changes nothing and removes nothing.

SOURCE_KEY = "wikipedia_after_siren_kicks"
LOAD_TOOL = "after_siren.py"
TARGET_TABLE = "after_siren_kicks"

WRITTEN_COLUMNS = (
    "player_id", "player_name_raw", "player_name_clean", "link_status_value", "candidate_count",
    "club_id", "club_name_raw", "opponent_club_id", "opponent_name_raw",
    "competition", "premiership_season", "season", "round_raw", "match_id",
    "kick_scored", "kick_effect", "shot_detail", "kicker_result", "siren",
    "kicker_score_raw", "opponent_score_raw", "kicker_points", "opponent_points", "supergoal_scoring",
    "cited", "source_annotation", "notes",
)
# A re-load compares everything it writes except the provenance quartet, so an
# unchanged event is left alone and keeps the batch id that first wrote it.
COMPARED_COLUMNS = WRITTEN_COLUMNS


@dataclass
class Resolution:
    """One artefact row resolved against one database."""

    row: dict[str, str]
    club_id: int | None = None
    opponent_club_id: int | None = None
    match_id: int | None = None
    match_method: str | None = None
    player_id: int | None = None
    link_status: str = "unmatched"
    candidate_count: int = 0
    player_method: str | None = None
    score_check: str = "not_applicable"
    note_parts: list[str] = field(default_factory=list)


def read_artefact(path: Path) -> list[dict[str, str]]:
    """The tracked artefact, shape-checked offline."""
    if not path.is_file():
        raise AfterSirenSourceError(f"{path} is not in this checkout")
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames != ARTEFACT_COLUMNS:
            raise AfterSirenSourceError(
                f"{path.name}: unexpected header\n  expected: {','.join(ARTEFACT_COLUMNS)}\n"
                f"  actual:   {','.join(reader.fieldnames or [])}")
        rows = [dict(r) for r in reader]
    if not rows:
        raise AfterSirenSourceError(f"{path.name} has no rows")
    seen: set[str] = set()
    for r in rows:
        key = r["event_key"]
        if key in seen:
            raise AfterSirenSourceError(f"{path.name}: duplicate event key {key}")
        seen.add(key)
        for flag in ("premiership_season", "cited", "supergoal_scoring"):
            if r[flag] not in ("true", "false"):
                raise AfterSirenSourceError(f"{path.name}: {key} has a non-boolean {flag}")
        if (r["kick_scored"] not in ("goal", "behind", "none")
                or r["kick_effect"] not in ("won", "drew", "none")
                or r["kicker_result"] not in ("win", "draw", "loss")
                or r["siren"] not in SIRENS):
            raise AfterSirenSourceError(f"{path.name}: {key} has an unknown enum value")
        if r["premiership_season"] == "true" and r["competition"] != PREMIERSHIP_COMPETITION:
            raise AfterSirenSourceError(
                f"{path.name}: {key} is a premiership row of competition {r['competition']!r}")
        for col in ("season", "kicker_points", "opponent_points"):
            if not r[col].isdigit():
                raise AfterSirenSourceError(f"{path.name}: {key} has a non-numeric {col}")
    return rows


def read_provenance(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ("wikipedia_title", "page_id", "raw_rows", "measures"):
        if key not in data:
            raise AfterSirenSourceError(f"{path.name} lacks {key}")
    if data["raw_rows"] != data["measures"]["events"]:
        raise AfterSirenSourceError(f"{path.name}: raw_rows disagrees with measures.events")
    return data


def truthy(value: str) -> bool:
    return value == "true"


def fetch_source_id(pg: Any) -> int:
    with pg.cursor() as cur:
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
        row = cur.fetchone()
    if row is None:
        raise AfterSirenSourceError(f"sources has no {SOURCE_KEY!r} row; apply migration 089 first")
    return row[0]


class Canon:
    """The canonical facts this load resolves against, fetched once."""

    def __init__(self, pg: Any) -> None:
        self.pg = pg
        with pg.cursor() as cur:
            cur.execute("SELECT year FROM seasons")
            self.seasons = {r[0] for r in cur.fetchall()}
            cur.execute("SELECT DISTINCT season FROM matches")
            self.match_seasons = {r[0] for r in cur.fetchall()}
            # A season with an Opening Round has a first round markedly shorter
            # than its second (import-first-kick-goal.ts); computed once.
            cur.execute(
                """SELECT season FROM matches WHERE NOT is_final GROUP BY season
                    HAVING count(*) FILTER (WHERE round_code = '1') > 0
                       AND count(*) FILTER (WHERE round_code = '1')
                         < count(*) FILTER (WHERE round_code = '2')""")
            self.opening_round_seasons = {r[0] for r in cur.fetchall()}
        self._orgs: dict[str, int] = {}

    def organisation(self, club_raw: str) -> int:
        """Exactly one club organisation, by club name or alias; anything else refuses."""
        if club_raw in self._orgs:
            return self._orgs[club_raw]
        with self.pg.cursor() as cur:
            cur.execute(
                """WITH candidate AS (
                     SELECT c.organization_id FROM clubs c
                      WHERE afldb_normalise_name(c.name) = afldb_normalise_name(%s)
                     UNION
                     SELECT c.organization_id FROM club_aliases a JOIN clubs c ON c.id = a.club_id
                      WHERE afldb_normalise_name(a.alias) = afldb_normalise_name(%s))
                   SELECT DISTINCT organization_id FROM candidate""", (club_raw, club_raw))
            found = [r[0] for r in cur.fetchall()]
        if len(found) != 1:
            raise AfterSirenSourceError(
                f"club {club_raw!r} resolves to {len(found)} club organisations on this database; "
                "the loader will not guess")
        self._orgs[club_raw] = found[0]
        return found[0]

    def era_club(self, org: int, season: int) -> int | None:
        """The club identity of that organisation active in that season.

        The tie-break is the one ``src/lib/ingest/datasets.ts`` uses: the era
        whose own first season is latest, so 2002 is the Kangaroos rather than
        the North Melbourne identity that spans them. Only rows with no match
        need it; a linked row takes its clubs from the match itself.
        """
        with self.pg.cursor() as cur:
            cur.execute(
                """SELECT id FROM clubs
                    WHERE organization_id = %s AND first_season <= %s
                      AND (last_season IS NULL OR last_season >= %s)
                    ORDER BY first_season DESC NULLS LAST, id LIMIT 1""", (org, season, season))
            row = cur.fetchone()
        return row[0] if row else None


def resolve_match(canon: Canon, row: dict[str, str], res: Resolution) -> None:
    """(season, round, both organisations), with the source's points as the check."""
    season = int(row["season"])
    kicker_org = canon.organisation(row["club_raw"])
    opponent_org = canon.organisation(row["opponent_raw"])
    if not truthy(row["premiership_season"]):
        res.note_parts.append(f"match: not a premiership-season fixture ({row['competition']})")
        return
    if season not in canon.match_seasons:
        res.note_parts.append(f"match: {season} is not in this database's canonical matches")
        return

    codes = [(row["round_raw"].strip().upper(), "round_exact")]
    if row["round_raw"].strip().isdigit() and season in canon.opening_round_seasons:
        codes.append((str(int(row["round_raw"].strip()) + 1), "opening_round_offset"))
    kicker_points, opponent_points = int(row["kicker_points"]), int(row["opponent_points"])

    for code, method in codes:
        with canon.pg.cursor() as cur:
            cur.execute(
                """SELECT m.id, hc.organization_id, m.home_club_id, m.away_club_id, m.home_score, m.away_score
                     FROM matches m
                     JOIN clubs hc ON hc.id = m.home_club_id
                     JOIN clubs ac ON ac.id = m.away_club_id
                    WHERE m.season = %s AND upper(btrim(m.round_code)) = %s
                      AND ((hc.organization_id = %s AND ac.organization_id = %s)
                        OR (hc.organization_id = %s AND ac.organization_id = %s))
                    ORDER BY m.id""",
                (season, code, kicker_org, opponent_org, opponent_org, kicker_org))
            candidates = cur.fetchall()
        if not candidates:
            continue
        agreeing = []
        for match_id, home_org, home_club, away_club, home_score, away_score in candidates:
            kicker_is_home = home_org == kicker_org
            scores = (home_score, away_score) if kicker_is_home else (away_score, home_score)
            if scores == (kicker_points, opponent_points):
                agreeing.append((match_id,
                                 home_club if kicker_is_home else away_club,
                                 away_club if kicker_is_home else home_club))
        if len(agreeing) != 1:
            raise AfterSirenSourceError(
                f"{row['event_key']}: {len(candidates)} match(es) at {season} round {code} between "
                f"{row['club_raw']} and {row['opponent_raw']}, {len(agreeing)} agreeing with the source's "
                f"{kicker_points}-{opponent_points}; the loader will not guess")
        res.match_id, res.club_id, res.opponent_club_id = agreeing[0]
        res.match_method = method
        res.note_parts.append(
            "match: resolved on the round the source states" if method == "round_exact"
            else "match: resolved one round higher (the season has an Opening Round)")
        return

    raise AfterSirenSourceError(
        f"{row['event_key']}: no {season} match between {row['club_raw']} and {row['opponent_raw']} at "
        f"round {row['round_raw']} on a database that carries {season}")


def suffix_rule(candidates: list[tuple], debut_index: int, suffix: str | None) -> list[tuple]:
    """``Sr.`` keeps the earliest debut and ``Jr.`` the latest — only among two or more."""
    if suffix and len(candidates) >= 2:
        debuts = [c[debut_index] or 0 for c in candidates]
        pick = min(debuts) if suffix == "sr" else max(debuts)
        return [c for c in candidates if (c[debut_index] or 0) == pick]
    return candidates


def resolve_player(canon: Canon, row: dict[str, str], res: Resolution) -> None:
    name, suffix = normalise_name(row["player_name"])
    season = int(row["season"])
    if res.match_id is not None:
        with canon.pg.cursor() as cur:
            cur.execute(
                """SELECT pms.player_id, pms.goals, pms.behinds, p.debut_season
                     FROM player_match_stats pms
                     JOIN players p ON p.id = pms.player_id
                     JOIN clubs c ON c.id = pms.club_id
                     JOIN clubs kicker ON kicker.id = %s
                    WHERE pms.match_id = %s
                      AND c.organization_id = kicker.organization_id
                      AND p.search_name = afldb_normalise_name(%s)
                    ORDER BY pms.player_id""", (res.club_id, res.match_id, name))
            candidates = cur.fetchall()
        method = "match_participation"
    else:
        with canon.pg.cursor() as cur:
            cur.execute(
                """SELECT DISTINCT p.id, NULL::smallint, NULL::smallint, p.debut_season
                     FROM players p
                     JOIN player_club_season_stats s ON s.player_id = p.id
                     JOIN clubs c ON c.id = s.club_id
                    WHERE p.search_name = afldb_normalise_name(%s)
                      AND s.season = %s AND c.organization_id = %s
                    ORDER BY p.id""", (name, season, canon.organisation(row["club_raw"])))
            candidates = cur.fetchall()
        method = "club_season_participation"

    res.candidate_count = len(candidates)
    narrowed = suffix_rule(candidates, 3, suffix)
    if len(narrowed) == 1:
        res.player_id = narrowed[0][0]
        res.link_status = "unique" if len(candidates) == 1 else "resolved"
        res.player_method = method
        res.note_parts.append(
            "player: the one player of that name in the match for this club"
            if method == "match_participation"
            else "player: the one player of that name playing for this club that season")
        if res.link_status == "resolved":
            res.note_parts.append(
                f"player: {len(candidates)} same-name candidates separated by the {suffix}. suffix")
        confirm_score(row, narrowed[0], res)
    elif not candidates:
        res.link_status = "unmatched"
        res.note_parts.append(
            "player: no player of that name in that match for this club on this database"
            if method == "match_participation"
            else "player: no player of that name playing for this club that season on this database")
    else:
        res.link_status = "ambiguous"
        res.note_parts.append(
            f"player: {len(candidates)} candidates and no evidence here to separate them")


def confirm_score(row: dict[str, str], candidate: tuple, res: Resolution) -> None:
    """The kicker's own scoring line in the match, as a check on the link.

    NULL is "not recorded", never zero — the earliest rows carry no behinds at
    all — so it confirms nothing and refuses nothing. A recorded zero
    contradicts the source and refuses the run.
    """
    if res.match_id is None or row["kick_scored"] == "none":
        res.score_check = "not_applicable"
        return
    recorded = candidate[1] if row["kick_scored"] == "goal" else candidate[2]
    if recorded is None:
        res.score_check = "not_recorded"
        res.note_parts.append(f"score check: this match records no {row['kick_scored']}s for anyone")
    elif recorded >= 1:
        res.score_check = "confirmed"
    else:
        raise AfterSirenSourceError(
            f"{row['event_key']}: {row['player_name']} is recorded with 0 {row['kick_scored']}s in match "
            f"{res.match_id}, contradicting a kick that scored a {row['kick_scored']}")


def source_annotation(row: dict[str, str]) -> str | None:
    """The source's own qualifying cells, verbatim; nothing AFLDB decided."""
    parts = []
    if row["outcome_raw"]:
        parts.append(f"Outcome: {row['outcome_raw']}")
    if row["score_footnote_raw"]:
        parts.append(f"score footnote {row['score_footnote_raw']}")
    return "; ".join(parts) or None


def row_notes(res: Resolution) -> str | None:
    """The artefact's own note (an adjudication, or the repeat marker) then how
    this database resolved the row. Deterministic, so a re-load compares equal."""
    parts = [res.row["note"]] if res.row["note"] else []
    parts.extend(res.note_parts)
    return "; ".join(parts) or None


def resolve_rows(canon: Canon, rows: list[dict[str, str]]) -> list[Resolution]:
    out = []
    for row in rows:
        res = Resolution(row=row)
        resolve_match(canon, row, res)
        if res.match_id is None:
            season = int(row["season"])
            res.club_id = canon.era_club(canon.organisation(row["club_raw"]), season)
            res.opponent_club_id = canon.era_club(canon.organisation(row["opponent_raw"]), season)
        resolve_player(canon, row, res)
        out.append(res)
    return out


def resolution_measures(resolutions: list[Resolution]) -> dict[str, int]:
    linked = [r for r in resolutions if r.link_status in ("unique", "resolved")]
    return {
        "events": len(resolutions),
        "players_linked": len(linked),
        "players_unresolved": len(resolutions) - len(linked),
        "players_ambiguous": sum(1 for r in resolutions if r.link_status == "ambiguous"),
        "players_distinct": len({r.player_id for r in linked}),
        "players_by_match_participation": sum(1 for r in linked if r.player_method == "match_participation"),
        "players_by_club_season_participation":
            sum(1 for r in linked if r.player_method == "club_season_participation"),
        "matches_linked": sum(1 for r in resolutions if r.match_id is not None),
        "matches_null": sum(1 for r in resolutions if r.match_id is None),
        "matches_null_other_competition":
            sum(1 for r in resolutions if r.match_id is None and not truthy(r.row["premiership_season"])),
        "matches_null_season_absent":
            sum(1 for r in resolutions if r.match_id is None and truthy(r.row["premiership_season"])),
        "matches_by_opening_round_offset": sum(1 for r in resolutions if r.match_method == "opening_round_offset"),
        "clubs_linked": sum(1 for r in resolutions if r.club_id is not None),
        "opponent_clubs_linked": sum(1 for r in resolutions if r.opponent_club_id is not None),
        "score_confirmed": sum(1 for r in resolutions if r.score_check == "confirmed"),
        "score_not_recorded": sum(1 for r in resolutions if r.score_check == "not_recorded"),
    }


def write_rows(pg: Any, resolutions: list[Resolution], source_id: int,
               provenance: dict[str, Any] | None, rep: Reporter) -> dict[str, Any]:
    assignments = ", ".join(f"{c} = EXCLUDED.{c}" for c in WRITTEN_COLUMNS)
    compare_left = ", ".join(f"{TARGET_TABLE}.{c}" for c in COMPARED_COLUMNS)
    compare_right = ", ".join(f"EXCLUDED.{c}" for c in COMPARED_COLUMNS)
    placeholders = (
        "%s,%s,%s,%s::link_status,%s,"
        "%s,%s,%s,%s,"
        "%s,%s,%s,%s,%s,"
        "%s::after_siren_score,%s::after_siren_effect,%s,%s::after_siren_result,%s::after_siren_siren,"
        "%s,%s,%s,%s,%s,"
        "%s,%s,%s,"
        "%s,%s,%s")
    statement = f"""
        INSERT INTO {TARGET_TABLE} ({', '.join(WRITTEN_COLUMNS)}, source_id, source_record_id, import_batch_id)
        VALUES ({placeholders})
        ON CONFLICT (source_id, source_record_id) DO UPDATE SET
          {assignments}, import_batch_id = EXCLUDED.import_batch_id
        WHERE ({compare_left}) IS DISTINCT FROM ({compare_right})"""

    with import_batch(pg, SOURCE_KEY, LOAD_TOOL, TARGET_TABLE) as batch:
        batch.records_read = len(resolutions)
        with pg.cursor() as cur:
            values = []
            for res in resolutions:
                row = res.row
                values.append((
                    res.player_id, row["player_name_raw"], row["player_name"], res.link_status,
                    res.candidate_count,
                    res.club_id, row["club_raw"], res.opponent_club_id, row["opponent_raw"],
                    row["competition"], truthy(row["premiership_season"]), int(row["season"]),
                    row["round_raw"], res.match_id,
                    row["kick_scored"], row["kick_effect"], row["shot_detail"] or None,
                    row["kicker_result"], row["siren"],
                    row["kicker_score_raw"], row["opponent_score_raw"], int(row["kicker_points"]),
                    int(row["opponent_points"]), truthy(row["supergoal_scoring"]),
                    truthy(row["cited"]), source_annotation(row), row_notes(res),
                    source_id, row["event_key"], batch.id))
            cur.executemany(statement, values)
            keys = [r.row["event_key"] for r in resolutions]
            cur.execute(
                f"DELETE FROM {TARGET_TABLE} WHERE source_id = %s AND NOT (source_record_id = ANY(%s))",
                (source_id, keys))
            stale = cur.rowcount
            cur.execute(
                f"""SELECT count(*) FILTER (WHERE import_batch_id = %s), count(*)
                      FROM {TARGET_TABLE} WHERE source_id = %s""", (batch.id, source_id))
            changed, total = cur.fetchone()
        batch.records_inserted += changed
    rep.result("after_siren_kicks rows", total)
    rep.result("rows inserted or changed", changed)
    rep.result("stale rows removed", stale)
    summary = {
        "events": len(resolutions), "rows": total, "changed": changed, "stale_removed": stale,
        "artefact": measures([r.row for r in resolutions]),
        "resolution": resolution_measures(resolutions),
        "provenance": provenance,
    }
    with pg.cursor() as cur:
        cur.execute("UPDATE import_batches SET validation_result = %s WHERE id = %s",
                    (json.dumps(summary), batch.id))
    pg.commit()
    summary["batch_id"] = batch.id
    return summary


# ---------------------------------------------------------------------------
# Reconciliation — the loaded table against the artefact, on one database
# ---------------------------------------------------------------------------


def reconcile(pg: Any, rows: list[dict[str, str]], resolutions: list[Resolution],
              source_id: int) -> list[tuple[str, bool, str]]:
    """Every expectation is derived from the artefact, or from re-resolving it
    against this same canonical database; none is a constant typed here."""
    art = measures(rows)
    res_m = resolution_measures(resolutions)
    checks: list[tuple[str, bool, str]] = []

    def check(label: str, actual: Any, expected: Any) -> None:
        checks.append((label, actual == expected, f"{actual} (expected {expected})"))

    with pg.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {TARGET_TABLE} WHERE source_id = %s", (source_id,))
        total = cur.fetchone()[0]
        cur.execute(f"SELECT count(*) FROM {TARGET_TABLE}")
        table_total = cur.fetchone()[0]
        cur.execute(f"SELECT premiership_season, count(*) FROM {TARGET_TABLE} WHERE source_id = %s GROUP BY 1",
                    (source_id,))
        by_prem = dict(cur.fetchall())
        cur.execute(f"SELECT kick_scored::text, count(*) FROM {TARGET_TABLE} WHERE source_id = %s GROUP BY 1",
                    (source_id,))
        by_scored = dict(cur.fetchall())
        cur.execute(f"SELECT kick_effect::text, count(*) FROM {TARGET_TABLE} WHERE source_id = %s GROUP BY 1",
                    (source_id,))
        by_effect = dict(cur.fetchall())
        cur.execute(f"SELECT kicker_result::text, count(*) FROM {TARGET_TABLE} WHERE source_id = %s GROUP BY 1",
                    (source_id,))
        by_result = dict(cur.fetchall())
        cur.execute(
            f"""SELECT count(*) FILTER (WHERE player_id IS NOT NULL),
                       count(DISTINCT player_id),
                       count(*) FILTER (WHERE player_id IS NULL),
                       count(*) FILTER (WHERE link_status_value = 'ambiguous'),
                       count(*) FILTER (WHERE match_id IS NOT NULL),
                       count(*) FILTER (WHERE match_id IS NULL),
                       count(*) FILTER (WHERE match_id IS NULL AND NOT premiership_season),
                       count(*) FILTER (WHERE club_id IS NOT NULL),
                       count(*) FILTER (WHERE opponent_club_id IS NOT NULL)
                  FROM {TARGET_TABLE} WHERE source_id = %s""", (source_id,))
        (linked, distinct_players, unlinked, ambiguous, matched, null_match,
         null_match_other, clubs, opponent_clubs) = cur.fetchone()
        cur.execute(
            f"""SELECT count(*) FROM (
                  SELECT season, competition, round_raw, club_name_raw, player_name_clean
                    FROM {TARGET_TABLE} WHERE source_id = %s
                   GROUP BY 1,2,3,4,5 HAVING count(*) > 1) d""", (source_id,))
        duplicate_events = cur.fetchone()[0]
        cur.execute(
            f"""SELECT count(*) FROM (
                  SELECT source_id, source_record_id FROM {TARGET_TABLE}
                   GROUP BY 1,2 HAVING count(*) > 1) d""")
        duplicate_keys = cur.fetchone()[0]
        cur.execute(
            f"""SELECT count(*) FILTER (WHERE source_record_id IS NULL),
                       count(*) FILTER (WHERE source_id IS NULL),
                       count(*) FILTER (WHERE import_batch_id IS NULL)
                  FROM {TARGET_TABLE}""")
        null_key, null_source, null_batch = cur.fetchone()
        cur.execute(
            f"""SELECT count(*) FROM {TARGET_TABLE} k
                 WHERE k.source_id = %s AND k.premiership_season AND k.match_id IS NULL
                   AND EXISTS (SELECT 1 FROM matches m WHERE m.season = k.season)""", (source_id,))
        premiership_null_in_carried_season = cur.fetchone()[0]
        cur.execute(
            f"""SELECT count(*) FROM {TARGET_TABLE} k JOIN matches m ON m.id = k.match_id
                 WHERE k.source_id = %s
                   AND (m.season <> k.season
                     OR NOT (k.club_id IN (m.home_club_id, m.away_club_id)
                         AND k.opponent_club_id IN (m.home_club_id, m.away_club_id)))""", (source_id,))
        match_disagreements = cur.fetchone()[0]
        cur.execute(
            f"""SELECT count(*) FROM {TARGET_TABLE} k
                 WHERE k.source_id = %s AND k.match_id IS NOT NULL AND k.player_id IS NOT NULL
                   AND EXISTS (SELECT 1 FROM player_match_stats pms
                                WHERE pms.match_id = k.match_id AND pms.player_id = k.player_id)""",
            (source_id,))
        kickers_in_their_match = cur.fetchone()[0]
        cur.execute(
            f"""SELECT count(*), count(DISTINCT COALESCE(player_id::text, player_name_clean))
                  FROM {TARGET_TABLE}
                 WHERE source_id = %s AND premiership_season
                   AND kick_scored <> 'none' AND kick_effect = 'won'""", (source_id,))
        qualifying, qualifying_players = cur.fetchone()

    check("source events considered", len(rows), art["events"])
    check("canonical rows for this source", total, art["events"])
    check("rows in after_siren_kicks", table_total, art["events"])
    check("premiership-season rows", by_prem.get(True, 0), art["premiership_season_events"])
    check("other-competition rows", by_prem.get(False, 0), art["other_competition_events"])
    check("kick_scored goal", by_scored.get("goal", 0), art["goal_won"] + art["goal_drew"])
    check("kick_scored behind", by_scored.get("behind", 0),
          art["behind_won"] + art["behind_drew"] + art["missed_behind"])
    check("kick_scored none", by_scored.get("none", 0), art["missed_no_score"])
    check("kick_effect won", by_effect.get("won", 0), art["goal_won"] + art["behind_won"])
    check("kick_effect drew", by_effect.get("drew", 0), art["goal_drew"] + art["behind_drew"])
    check("kick_effect none", by_effect.get("none", 0), art["missed"])
    check("kicker_result win", by_result.get("win", 0),
          sum(1 for r in rows if r["kicker_result"] == "win"))
    check("kicker_result draw", by_result.get("draw", 0),
          sum(1 for r in rows if r["kicker_result"] == "draw"))
    check("kicker_result loss", by_result.get("loss", 0),
          sum(1 for r in rows if r["kicker_result"] == "loss"))
    check("qualifying (premiership, scored, won)", qualifying, art["premiership_season_scored_and_won"])
    check("qualifying distinct kickers", qualifying_players, art["premiership_season_scored_and_won_players"])
    check("rows with a linked player", linked, res_m["players_linked"])
    check("distinct linked players", distinct_players, res_m["players_distinct"])
    check("rows with an unresolved player", unlinked, res_m["players_unresolved"])
    check("rows with an ambiguous player", ambiguous, res_m["players_ambiguous"])
    check("rows with a linked match", matched, res_m["matches_linked"])
    check("rows with a NULL match", null_match, res_m["matches_null"])
    check("NULL match, other competition", null_match_other, art["other_competition_events"])
    check("premiership NULL match in a season this database carries", premiership_null_in_carried_season, 0)
    check("rows with a linked club", clubs, res_m["clubs_linked"])
    check("rows with a linked opponent club", opponent_clubs, res_m["opponent_clubs_linked"])
    check("linked match disagreeing with its clubs or season", match_disagreements, 0)
    check("linked kickers present in their linked match", kickers_in_their_match,
          sum(1 for r in resolutions if r.match_id is not None and r.player_id is not None))
    check("duplicate canonical events", duplicate_events, 0)
    check("duplicate (source, source_record_id)", duplicate_keys, 0)
    check("rows without a source record id", null_key, 0)
    check("rows without a source", null_source, 0)
    check("rows without an import batch", null_batch, 0)

    # Each adjudication is applied to exactly one row, and that row states it.
    adjudicated = [r for r in rows if r["adjudication_keys"]]
    check("adjudicated artefact rows", len(adjudicated), art["adjudicated"])
    with pg.cursor() as cur:
        for row in adjudicated:
            cur.execute(
                f"""SELECT count(*) FROM {TARGET_TABLE}
                     WHERE source_id = %s AND source_record_id = %s
                       AND siren = %s::after_siren_siren
                       AND kick_scored = %s::after_siren_score
                       AND kick_effect = %s::after_siren_effect
                       AND cited = %s AND kicker_score_raw = %s AND kicker_points = %s
                       AND position(%s in notes) > 0""",
                (source_id, row["event_key"], row["siren"], row["kick_scored"], row["kick_effect"],
                 truthy(row["cited"]), row["kicker_score_raw"], int(row["kicker_points"]), row["note"]))
            label = f"adjudication {row['adjudication_keys']} applied exactly once to {row['event_key']}"
            checks.append((label, cur.fetchone()[0] == 1, row["event_key"]))
    return checks


def report_checks(checks: list[tuple[str, bool, str]], rep: Reporter) -> int:
    failed = 0
    for label, ok, detail in checks:
        if not ok:
            failed += 1
        rep.step(f"{'PASS' if ok else 'FAIL'}  {label}: {detail}")
    return failed


def cmd_load(args: argparse.Namespace) -> int:
    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB after-the-siren kicks (tracked, cited Wikipedia-derived artefact)")
    rows = read_artefact(args.csv)
    provenance = read_provenance(args.provenance)
    art = measures(rows)
    rep.step(f"{args.csv.name}: {art['events']} events, shape verified"
             + (f"; page {provenance['page_id']}, inspected revision "
                f"{provenance.get('inspected_revision_id')}" if provenance else ""))
    if provenance and provenance["measures"] != art:
        raise AfterSirenSourceError(f"{args.provenance.name} measures disagree with the artefact")
    if args.validate_only:
        for k, v in art.items():
            rep.result(k, v)
        print(f"  done (validate only) in {time.time() - started:.1f}s")
        return 0

    load_env()
    dsn = require_env(args.dsn_env)
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    pg = connect_pg(dsn)
    source_id = fetch_source_id(pg)
    canon = Canon(pg)
    absent = sorted({int(r["season"]) for r in rows} - canon.seasons)
    if absent:
        raise AfterSirenSourceError(f"seasons absent from this database: {absent}")
    resolutions = resolve_rows(canon, rows)
    for k, v in resolution_measures(resolutions).items():
        rep.result(k, v)
    unresolved = [r.row["event_key"] for r in resolutions if r.link_status not in ("unique", "resolved")]
    if unresolved:
        rep.step("kickers left unresolved, the source spelling kept: " + ", ".join(unresolved))
    if args.dry_run:
        print(f"  done (dry run) in {time.time() - started:.1f}s")
        return 0
    summary = write_rows(pg, resolutions, source_id, provenance, rep)
    print(f"  batch {summary['batch_id']}: {summary['rows']} events, {summary['changed']} inserted or changed, "
          f"{summary['stale_removed']} stale removed; done in {time.time() - started:.1f}s")
    return 0


def cmd_reconcile(args: argparse.Namespace) -> int:
    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB after-the-siren kicks: reconcile the loaded table with the tracked artefact")
    rows = read_artefact(args.csv)
    load_env()
    dsn = require_env(args.dsn_env)
    print(f"  target: {safe_dsn(dsn)}")
    pg = connect_pg(dsn)
    source_id = fetch_source_id(pg)
    resolutions = resolve_rows(Canon(pg), rows)
    checks = reconcile(pg, rows, resolutions, source_id)
    failed = report_checks(checks, rep)
    print(f"  {len(checks) - failed}/{len(checks)} checks passed; done in {time.time() - started:.1f}s")
    if failed:
        sys.exit(f"ERROR: {failed} reconciliation check(s) failed")
    return 0


def cmd_normalize(args: argparse.Namespace) -> int:
    print(f"AFLDB after-the-siren kicks: normalise the Wikipedia table exports under {args.raw_dir}")
    sources = read_sources(args.raw_dir)
    adjudications = read_adjudications(args.adjudications)
    rows = normalise(sources, adjudications)
    text = render_artefact(rows)
    provenance = render_provenance(args.raw_dir, sources, adjudications, rows)
    m = measures(rows)
    if not args.quiet:
        print(f"  {len({s.file for s in sources})} files, {len(sources)} rows, {len(adjudications)} adjudications")
        for k, v in m.items():
            print(f"  {k}: {v}")
    if args.check:
        for path, fresh in ((args.out, text), (args.provenance, provenance)):
            if not path.is_file():
                sys.exit(f"ERROR: {path} is not in this checkout")
            if path.read_text(encoding="utf-8").replace("\r\n", "\n") != fresh:
                sys.exit(f"ERROR: {path.name} differs from a fresh normalisation of the exports")
        print(f"  {args.out.name} and {args.provenance.name} are exactly the regeneration; done (check)")
        return 0
    args.out.write_text(text, encoding="utf-8", newline="\n")
    args.provenance.write_text(provenance, encoding="utf-8", newline="\n")
    print(f"  wrote {args.out.name} ({len(rows)} events) and {args.provenance.name}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    n = sub.add_parser("normalize", help="Normalise the raw exports into the tracked artefact.")
    n.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    n.add_argument("--adjudications", type=Path, default=DEFAULT_ADJUDICATIONS)
    n.add_argument("--out", type=Path, default=DEFAULT_ARTEFACT)
    n.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    n.add_argument("--check", action="store_true", help="compare the tracked artefact with a fresh normalisation; write nothing")
    n.add_argument("--quiet", action="store_true")
    n.set_defaults(func=cmd_normalize)
    l = sub.add_parser("load", help="Load the tracked artefact into after_siren_kicks (migration 089).")
    l.add_argument("--csv", type=Path, default=DEFAULT_ARTEFACT)
    l.add_argument("--provenance", type=Path, default=DEFAULT_PROVENANCE)
    l.add_argument("--dsn-env", default="AFLDB_IMPORT_DATABASE_URL",
                   help="environment variable holding the target DSN")
    l.add_argument("--validate-only", action="store_true", help="Check the artefact's shape offline; touch no database.")
    l.add_argument("--dry-run", action="store_true", help="Resolve against the database; write nothing.")
    l.add_argument("--quiet", action="store_true")
    l.set_defaults(func=cmd_load)
    r = sub.add_parser("reconcile", help="Check the loaded table against the tracked artefact.")
    r.add_argument("--csv", type=Path, default=DEFAULT_ARTEFACT)
    r.add_argument("--dsn-env", default="AFLDB_IMPORT_DATABASE_URL",
                   help="environment variable holding the target DSN")
    r.add_argument("--quiet", action="store_true")
    r.set_defaults(func=cmd_reconcile)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except AfterSirenSourceError as exc:
        sys.exit(f"ERROR: {exc}")


if __name__ == "__main__":
    sys.exit(main())
