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
from dataclasses import dataclass
from pathlib import Path

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
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except AfterSirenSourceError as exc:
        sys.exit(f"ERROR: {exc}")


if __name__ == "__main__":
    sys.exit(main())
