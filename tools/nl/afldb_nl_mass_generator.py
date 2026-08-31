#!/usr/bin/env python3
"""
AFLDB mass NL-search corpus generator.

Purpose
-------
Generate a very large, deterministic set of meaningful AFL natural-language
search questions for AFLDB. Output can be consumed directly by the existing
5-column NL UI corpus reader:

    id,category,question,expected_status,tags

New synthetic questions deliberately use expected_status=unknown. This is a
discovery/load corpus, not a fabricated semantic oracle. Metamorphic variants
are tagged so the existing browser harness can still detect inconsistent
behaviour between equivalent phrasings.

No third-party Python packages are required.

Examples
--------
Generate 100,000 questions:
    python tools/nl/generate_mass_corpus.py --count 100000 --out mass-100k.csv

Generate 1,000,000 questions using current 30-day exports:
    python tools/nl/generate_mass_corpus.py ^
      --count 1000000 ^
      --searches afldb-nl-searches-30d-2026-08-30.csv ^
      --problems afldb-nl-problems-30d-2026-08-30.csv ^
      --terms afldb-nl-terms-30d-2026-08-30.csv ^
      --reformulations afldb-nl-reformulations-30d-2026-08-30.csv ^
      --plans afldb-nl-plans-30d-2026-08-30.csv ^
      --out mass-1m.csv

Linux:
    python3 tools/nl/generate_mass_corpus.py \
      --count 1000000 \
      --searches afldb-nl-searches-30d-2026-08-30.csv \
      --problems afldb-nl-problems-30d-2026-08-30.csv \
      --terms afldb-nl-terms-30d-2026-08-30.csv \
      --reformulations afldb-nl-reformulations-30d-2026-08-30.csv \
      --plans afldb-nl-plans-30d-2026-08-30.csv \
      --out mass-1m.csv

Profiles:
    balanced   broad supported-looking coverage plus edge cases
    realistic heavier weighting toward mutations of observed real searches
    hostile    heavier weighting toward prior problem shapes and ambiguity

Reproducibility:
    --seed 20260830

Output formats:
    ui      5-column CSV for the existing NL UI harness
    jsonl   JSON Lines with id/category/question/expected_status/tags
    plain   one question per line
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence


DEFAULT_CLUBS = [
    "Adelaide", "Brisbane Lions", "Carlton", "Collingwood", "Essendon",
    "Fremantle", "Geelong", "Gold Coast", "Greater Western Sydney",
    "Hawthorn", "Melbourne", "North Melbourne", "Port Adelaide",
    "Richmond", "St Kilda", "Sydney", "West Coast", "Western Bulldogs",
    # Historical identities are intentional NL-search probes.
    "Fitzroy", "Brisbane Bears", "Kangaroos", "Footscray",
]

CLUB_ALIASES = [
    "Crows", "Lions", "Blues", "Magpies", "Pies", "Bombers", "Dockers",
    "Cats", "Suns", "GWS", "Giants", "Hawks", "Demons", "Roos", "Power",
    "Tigers", "Saints", "Swans", "Eagles", "Bulldogs", "Dogs",
]

DEFAULT_PLAYERS = [
    "Dustin Martin", "Scott Pendlebury", "Lance Franklin",
    "Patrick Dangerfield", "Tony Lockett", "Gary Ablett Jnr",
    "Gary Ablett Snr",
]

PLAYER_ALIASES = [
    "Dusty", "Buddy Franklin", "Dangerfield", "Gary Ablett Jr",
    "Gary Ablett Junior", "Gary Ablett Sr", "Gary Ablett Senior",
]

DEFAULT_VENUES = [
    "MCG", "Melbourne Cricket Ground", "SCG", "Sydney Cricket Ground",
    "Gabba", "Marvel Stadium", "Docklands", "Adelaide Oval",
    "Perth Stadium", "Kardinia Park",
]

# Phrase -> plan metric. Phrase is what appears in the user's question.
PLAYER_METRICS = [
    "goals", "kicks", "handballs", "disposals", "marks", "tackles",
    "hitouts", "clearances", "inside 50s", "contested possessions",
    "uncontested possessions",
]

COMMON_PLAYER_METRICS = [
    "goals", "kicks", "handballs", "disposals", "marks", "tackles",
]

THRESHOLD_PHRASES = [
    "at least", "no fewer than", "more than", "at most",
    "no more than", "fewer than", "less than", "exactly",
]

FILLER_PREFIXES = [
    "please ",
    "quick one: ",
    "can you tell me ",
    "what about ",
    "show me ",
]

FILLER_SUFFIXES = ["?", " please", "!", "??"]

UNSUPPORTED_OR_EDGE_METRICS = [
    "rebound 50s", "metres gained", "pressure acts", "score involvements",
]

SEASONS = list(range(1897, 2027))


@dataclass(frozen=True)
class Pools:
    clubs: tuple[str, ...]
    players: tuple[str, ...]
    venues: tuple[str, ...]
    observed: tuple[str, ...]
    problems: tuple[str, ...]


@dataclass(frozen=True)
class Generated:
    category: str
    question: str
    tags: tuple[str, ...] = ()


def normalise_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def stable64(text: str) -> int:
    return int.from_bytes(
        hashlib.blake2b(text.encode("utf-8"), digest_size=8).digest(), "big"
    )


def unique_keep_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        value = normalise_space(value)
        if not value:
            continue
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            out.append(value)
    return out


def read_csv_dicts(path: Path | None) -> list[dict[str, str]]:
    if path is None or not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def mine_pools(search_rows: Sequence[dict[str, str]]) -> tuple[list[str], list[str], list[str], list[str]]:
    clubs = list(DEFAULT_CLUBS) + list(CLUB_ALIASES)
    players = list(DEFAULT_PLAYERS) + list(PLAYER_ALIASES)
    venues = list(DEFAULT_VENUES)
    observed: list[str] = []

    for row in search_rows:
        q = normalise_space(row.get("question", ""))
        if q:
            observed.append(q)

        raw_plan = row.get("plan", "")
        if not raw_plan:
            continue
        try:
            plan = json.loads(raw_plan)
        except Exception:
            continue

        player = plan.get("player")
        if isinstance(player, dict):
            name = player.get("name")
            if isinstance(name, str) and name.strip():
                players.append(name)

        scope = plan.get("scope")
        if isinstance(scope, dict):
            for key in ("clubFor", "clubAgainst"):
                obj = scope.get(key)
                if isinstance(obj, dict):
                    name = obj.get("name")
                    if isinstance(name, str) and name.strip():
                        clubs.append(name)
            venue = scope.get("venue")
            if isinstance(venue, dict):
                name = venue.get("name")
                if isinstance(name, str) and name.strip():
                    venues.append(name)

    return (
        unique_keep_order(clubs),
        unique_keep_order(players),
        unique_keep_order(venues),
        unique_keep_order(observed),
    )


def other_club(rng: random.Random, clubs: Sequence[str], first: str) -> str:
    for _ in range(20):
        candidate = rng.choice(clubs)
        if candidate.casefold() != first.casefold():
            return candidate
    return "Carlton" if first.casefold() != "carlton" else "Richmond"


def season_for_metric(rng: random.Random, edge: bool = False) -> int:
    if edge:
        return rng.choice(
            list(range(1897, 1931))
            + list(range(1960, 1985))
            + [1998, 1999, 2025, 2026]
        )
    # Favour modern seasons but continue probing the whole competition history.
    if rng.random() < 0.72:
        return rng.randint(1985, 2026)
    return rng.randint(1897, 1984)


def threshold_value(rng: random.Random, metric: str) -> int:
    if metric == "goals":
        return rng.choice([1, 2, 3, 4, 5, 6, 8, 10, 12])
    if metric in {"kicks", "handballs", "disposals", "marks", "tackles", "hitouts", "clearances"}:
        return rng.choice([5, 10, 15, 20, 25, 30, 35, 40, 50])
    if "50" in metric:
        return rng.choice([2, 5, 10, 15, 20])
    return rng.choice([5, 10, 15, 20, 25, 30])


def gen_player_game(rng: random.Random, pools: Pools) -> Generated:
    player = rng.choice(pools.players)
    metric = rng.choice(PLAYER_METRICS)
    club = rng.choice(pools.clubs)
    opp = other_club(rng, pools.clubs, club)
    venue = rng.choice(pools.venues)
    season = season_for_metric(rng)

    patterns = [
        f"{player} most {metric} in a game",
        f"most {metric} by {player} in a game",
        f"{player} highest {metric} in a match",
        f"{player} most {metric} against {opp}",
        f"{player} most {metric} against {opp} in {season}",
        f"{player} most {metric} at {venue}",
        f"{player} most {metric} at {venue} in {season}",
        f"most {metric} by a {club} player in a game",
        f"most {metric} by a {club} player against {opp}",
    ]
    return Generated("player_game", rng.choice(patterns), ("synthetic", "player_game"))


def gen_player_season(rng: random.Random, pools: Pools) -> Generated:
    metric = rng.choice(PLAYER_METRICS)
    season = season_for_metric(rng)
    club = rng.choice(pools.clubs)
    venue = rng.choice(pools.venues)
    patterns = [
        f"who had the most {metric} in {season}",
        f"most {metric} in {season}",
        f"leading {metric} in {season}",
        f"{club} leading {metric} in {season}",
        f"most {metric} for {club} in {season}",
        f"most {metric} at {venue} in {season}",
        f"top 5 {metric} in {season}",
        f"top 10 {metric} in {season}",
    ]
    return Generated("player_season", rng.choice(patterns), ("synthetic", "player_season"))


def gen_player_career(rng: random.Random, pools: Pools) -> Generated:
    player = rng.choice(pools.players)
    metric = rng.choice(COMMON_PLAYER_METRICS + ["games"])
    club = rng.choice(pools.clubs)
    n = rng.choice([10, 25, 50, 75, 100, 150, 200, 250, 300])
    patterns = [
        f"{player} career {metric}",
        f"how many career {metric} did {player} have",
        f"most career {metric}",
        f"{club} career leader for {metric}",
        f"players with at least {n} career games",
        f"players with at least {n} games for {club}",
        f"players with exactly {n} games",
        f"top 10 career {metric}",
    ]
    return Generated("player_career", rng.choice(patterns), ("synthetic", "player_career"))


def gen_threshold(rng: random.Random, pools: Pools) -> Generated:
    metric = rng.choice(PLAYER_METRICS)
    op = rng.choice(THRESHOLD_PHRASES)
    n = threshold_value(rng, metric)
    season = season_for_metric(rng)
    club = rng.choice(pools.clubs)
    patterns = [
        f"players with {op} {n} {metric} in a game",
        f"players with {op} {n} {metric} in {season}",
        f"{club} players with {op} {n} {metric} in a game",
        f"players with {op} {n} {metric} against {club}",
    ]
    return Generated("numeric_threshold", rng.choice(patterns), ("synthetic", "threshold"))


def gen_head_to_head(rng: random.Random, pools: Pools) -> Generated:
    a = rng.choice(pools.clubs)
    b = other_club(rng, pools.clubs, a)
    patterns = [
        f"{a} v {b} head to head",
        f"{a} vs {b} head to head",
        f"{a} record against {b}",
        f"who has won more {a} or {b}",
        f"how many draws between {a} and {b}",
        f"last draw between {a} and {b}",
        f"{a} wins against {b}",
        f"{b} wins against {a}",
    ]
    return Generated("head_to_head", rng.choice(patterns), ("synthetic", "head_to_head"))


def gen_team_match(rng: random.Random, pools: Pools) -> Generated:
    club = rng.choice(pools.clubs)
    opp = other_club(rng, pools.clubs, club)
    venue = rng.choice(pools.venues)
    season = rng.randint(1897, 2026)
    n = rng.choice([1, 2, 3, 4, 5, 10, 20, 50])
    patterns = [
        f"{club} biggest win",
        f"{club} biggest win against {opp}",
        f"{club} highest score against {opp}",
        f"{club} lowest score against {opp}",
        f"{club} highest score at {venue}",
        f"{club} biggest win in {season}",
        f"teams with at least {n} wins against {club}",
        f"teams with at most {n} wins against {club}",
        f"teams with more than {n} losses against {club}",
        f"teams with no more than {n} losses against {club}",
    ]
    return Generated("team_match", rng.choice(patterns), ("synthetic", "team_match"))


def gen_final_round_period(rng: random.Random, pools: Pools) -> Generated:
    metric = rng.choice(COMMON_PLAYER_METRICS)
    club = rng.choice(pools.clubs)
    opp = other_club(rng, pools.clubs, club)
    season = rng.randint(1985, 2026)
    period = rng.choice(["Q1", "Q2", "Q3", "Q4", "first half", "second half"])
    patterns = [
        f"most {metric} in a Grand Final",
        f"most {metric} in finals",
        f"most {metric} in a Grand Final in {season}",
        f"{club} biggest Grand Final win",
        f"{club} finals record against {opp}",
        f"{club} highest score in {period}",
        f"highest score in {period} in {season}",
    ]
    return Generated("round_final_period", rng.choice(patterns), ("synthetic", "finals_period"))


def gen_streak(rng: random.Random, pools: Pools) -> Generated:
    club = rng.choice(pools.clubs)
    patterns = [
        "longest winning streak",
        "longest losing streak",
        f"{club} longest winning streak",
        f"{club} longest losing streak",
        f"{club} longest unbeaten streak",
    ]
    return Generated("streak", rng.choice(patterns), ("synthetic", "streak"))


def gen_coverage_edge(rng: random.Random, pools: Pools) -> Generated:
    metric = rng.choice(PLAYER_METRICS)
    season = season_for_metric(rng, edge=True)
    club = rng.choice(pools.clubs)
    venue = rng.choice(pools.venues)
    patterns = [
        f"most {metric} in {season}",
        f"{club} leading {metric} in {season}",
        f"most {metric} at {venue} in {season}",
        f"most {metric} between {max(1897, season - 5)} and {season}",
        f"record {metric} since {season}",
    ]
    return Generated("coverage_edge", rng.choice(patterns), ("edge", "coverage"))


def gen_ambiguity(rng: random.Random, pools: Pools) -> Generated:
    metric = rng.choice(COMMON_PLAYER_METRICS)
    patterns = [
        f"Gary Ablett career {metric}",
        f"Gary Ablett most {metric} in a game",
        f"Ablett most {metric}",
        "Head most games",
        "who had the most goals for Melbourne",
        "most games for Geelong",
    ]
    return Generated("ambiguity_probe", rng.choice(patterns), ("edge", "ambiguity"))


def gen_unsupported(rng: random.Random, pools: Pools) -> Generated:
    metric = rng.choice(UNSUPPORTED_OR_EDGE_METRICS)
    player = rng.choice(pools.players)
    season = season_for_metric(rng)
    club = rng.choice(pools.clubs)
    patterns = [
        f"most {metric} in {season}",
        f"{player} career {metric}",
        f"{club} leading {metric} in {season}",
        f"most {metric} in a game",
        f"players with at least 10 {metric} in a game",
        f"{player} most goals in debut season",
    ]
    return Generated("unsupported_probe", rng.choice(patterns), ("edge", "unsupported"))


def mutate_observed(rng: random.Random, question: str, source_tag: str) -> Generated:
    q = normalise_space(question)
    style = rng.randrange(8)
    if style == 0:
        q = rng.choice(FILLER_PREFIXES) + q
        tags = ("observed", source_tag, "filler", "metamorphic")
    elif style == 1:
        q = q + rng.choice(FILLER_SUFFIXES)
        tags = ("observed", source_tag, "filler", "metamorphic")
    elif style == 2:
        q = q[:1].upper() + q[1:] if q else q
        tags = ("observed", source_tag, "case")
    elif style == 3:
        q = q.lower()
        tags = ("observed", source_tag, "case")
    elif style == 4:
        q = re.sub(r"\bversus\b", "vs", q, flags=re.I)
        q = re.sub(r"\bagainst\b", "v", q, flags=re.I)
        tags = ("observed", source_tag, "wording")
    elif style == 5:
        q = re.sub(r"\bmost\b", rng.choice(["highest", "most"]), q, count=1, flags=re.I)
        tags = ("observed", source_tag, "wording")
    elif style == 6:
        q = q.rstrip("?!.,") + rng.choice(["?", "!", "??"])
        tags = ("observed", source_tag, "punctuation")
    else:
        q = rng.choice(["AFL question: ", "stats: ", "quick stat: "]) + q
        tags = ("observed", source_tag, "filler", "metamorphic")
    return Generated(f"observed_{source_tag}", normalise_space(q), tags)


def gen_observed(rng: random.Random, pools: Pools) -> Generated:
    if not pools.observed:
        return gen_player_game(rng, pools)
    return mutate_observed(rng, rng.choice(pools.observed), "real")


def gen_problem_mutation(rng: random.Random, pools: Pools) -> Generated:
    if not pools.problems:
        return gen_ambiguity(rng, pools)
    return mutate_observed(rng, rng.choice(pools.problems), "problem")


GENERATORS: dict[str, Callable[[random.Random, Pools], Generated]] = {
    "player_game": gen_player_game,
    "player_season": gen_player_season,
    "player_career": gen_player_career,
    "threshold": gen_threshold,
    "head_to_head": gen_head_to_head,
    "team_match": gen_team_match,
    "final_round_period": gen_final_round_period,
    "streak": gen_streak,
    "coverage_edge": gen_coverage_edge,
    "ambiguity": gen_ambiguity,
    "unsupported": gen_unsupported,
    "observed": gen_observed,
    "problem": gen_problem_mutation,
}

PROFILE_WEIGHTS = {
    "balanced": {
        "player_game": 14, "player_season": 14, "player_career": 10,
        "threshold": 12, "head_to_head": 10, "team_match": 12,
        "final_round_period": 8, "streak": 4, "coverage_edge": 5,
        "ambiguity": 4, "unsupported": 3, "observed": 6, "problem": 2,
    },
    "realistic": {
        "player_game": 10, "player_season": 10, "player_career": 8,
        "threshold": 9, "head_to_head": 8, "team_match": 10,
        "final_round_period": 5, "streak": 3, "coverage_edge": 4,
        "ambiguity": 3, "unsupported": 2, "observed": 23, "problem": 5,
    },
    "hostile": {
        "player_game": 7, "player_season": 7, "player_career": 6,
        "threshold": 12, "head_to_head": 8, "team_match": 7,
        "final_round_period": 5, "streak": 3, "coverage_edge": 12,
        "ambiguity": 12, "unsupported": 9, "observed": 4, "problem": 8,
    },
}


def weighted_generator_name(rng: random.Random, profile: str) -> str:
    weights = PROFILE_WEIGHTS[profile]
    names = list(weights)
    vals = [weights[n] for n in names]
    return rng.choices(names, weights=vals, k=1)[0]


def make_pools(
    searches_path: Path | None,
    problems_path: Path | None,
    terms_path: Path | None,
    reformulations_path: Path | None,
    plans_path: Path | None,
) -> Pools:
    search_rows = read_csv_dicts(searches_path)
    problem_rows = read_csv_dicts(problems_path)
    term_rows = read_csv_dicts(terms_path)
    reform_rows = read_csv_dicts(reformulations_path)
    plan_rows = read_csv_dicts(plans_path)

    clubs, players, venues, observed = mine_pools(search_rows)

    # The auxiliary exports are useful vocabulary/shape evidence even when the
    # full search export is not supplied. They are seed questions only; no
    # expectation is inferred from them.
    auxiliary_questions: list[str] = []
    for row in term_rows:
        auxiliary_questions.append(row.get("example", ""))
    for row in reform_rows:
        auxiliary_questions.append(row.get("parentQuestion", ""))
        auxiliary_questions.append(row.get("question", ""))
    for row in plan_rows:
        auxiliary_questions.append(row.get("example", ""))

    observed = unique_keep_order([*observed, *auxiliary_questions])
    problems = unique_keep_order(row.get("question", "") for row in problem_rows)

    return Pools(
        clubs=tuple(clubs),
        players=tuple(players),
        venues=tuple(venues),
        observed=tuple(observed),
        problems=tuple(problems),
    )


def write_ui_row(writer: csv.writer, idx: int, item: Generated) -> None:
    writer.writerow([
        f"mass_{idx:09d}",
        item.category,
        item.question,
        "unknown",
        ",".join(item.tags),
    ])


def write_jsonl_row(fh, idx: int, item: Generated) -> None:
    fh.write(json.dumps({
        "id": f"mass_{idx:09d}",
        "category": item.category,
        "question": item.question,
        "expected_status": "unknown",
        "tags": list(item.tags),
    }, ensure_ascii=False) + "\n")


def generate(args: argparse.Namespace) -> Counter:
    rng = random.Random(args.seed)
    pools = make_pools(
        args.searches,
        args.problems,
        args.terms,
        args.reformulations,
        args.plans,
    )

    if args.count < 1:
        raise SystemExit("--count must be >= 1")
    if args.count > 50_000_000 and not args.i_know_this_is_huge:
        raise SystemExit(
            "--count above 50,000,000 requires --i-know-this-is-huge "
            "to avoid an accidental enormous run"
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)

    # Keep only a 64-bit digest per question. This is much smaller than keeping
    # millions of full strings in RAM while still making accidental duplicate
    # generation vanishingly unlikely.
    seen: set[int] = set()
    counts: Counter[str] = Counter()
    produced = 0
    attempts = 0
    max_attempts = max(args.count * 40, args.count + 100_000)

    if args.format == "ui":
        fh = args.out.open("w", encoding="utf-8-sig", newline="")
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(["id", "category", "question", "expected_status", "tags"])
    else:
        fh = args.out.open("w", encoding="utf-8", newline="")
        writer = None

    try:
        while produced < args.count:
            attempts += 1
            if attempts > max_attempts:
                raise RuntimeError(
                    f"could only generate {produced:,} unique questions after "
                    f"{attempts:,} attempts; choose a smaller --count or a different --seed"
                )

            name = weighted_generator_name(rng, args.profile)
            item = GENERATORS[name](rng, pools)
            question = normalise_space(item.question)
            if not question or len(question) > 400:
                continue

            digest = stable64(question.casefold())
            if digest in seen:
                continue
            seen.add(digest)

            produced += 1
            item = Generated(item.category, question, item.tags)
            counts[item.category] += 1

            if args.format == "ui":
                assert writer is not None
                write_ui_row(writer, produced, item)
            elif args.format == "jsonl":
                write_jsonl_row(fh, produced, item)
            else:
                fh.write(question + "\n")

            if args.progress and (
                produced == args.count or produced % args.progress == 0
            ):
                print(
                    f"generated {produced:,}/{args.count:,} unique questions "
                    f"({attempts:,} attempts)",
                    file=sys.stderr,
                )
    finally:
        fh.close()

    summary = {
        "count": produced,
        "attempts": attempts,
        "duplicates_rejected": attempts - produced,
        "seed": args.seed,
        "profile": args.profile,
        "format": args.format,
        "output": str(args.out),
        "searches_source": str(args.searches) if args.searches else None,
        "problems_source": str(args.problems) if args.problems else None,
        "terms_source": str(args.terms) if args.terms else None,
        "reformulations_source": str(args.reformulations) if args.reformulations else None,
        "plans_source": str(args.plans) if args.plans else None,
        "observed_seed_questions": len(pools.observed),
        "problem_seed_questions": len(pools.problems),
        "club_pool": len(pools.clubs),
        "player_pool": len(pools.players),
        "venue_pool": len(pools.venues),
        "categories": dict(counts.most_common()),
    }
    summary_path = args.out.with_suffix(args.out.suffix + ".summary.json")
    summary_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return counts


def existing_if_present(name: str) -> Path | None:
    p = Path(name)
    return p if p.exists() else None


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a large deterministic AFLDB NL-search discovery corpus."
    )
    parser.add_argument(
        "--count", type=int, default=100_000,
        help="number of unique questions to generate (default: 100000)",
    )
    parser.add_argument(
        "--out", type=Path, default=Path("afldb-nl-mass-corpus.csv"),
        help="output path",
    )
    parser.add_argument(
        "--seed", type=int, default=20260830,
        help="deterministic PRNG seed (default: 20260830)",
    )
    parser.add_argument(
        "--profile", choices=sorted(PROFILE_WEIGHTS), default="balanced",
        help="generation weighting profile",
    )
    parser.add_argument(
        "--format", choices=["ui", "jsonl", "plain"], default="ui",
        help="output format; ui is compatible with the 5-column browser corpus reader",
    )
    parser.add_argument(
        "--searches", type=Path,
        default=existing_if_present("afldb-nl-searches-30d-2026-08-30.csv"),
        help="optional 30-day search export used for real-query vocabulary/seeds",
    )
    parser.add_argument(
        "--problems", type=Path,
        default=existing_if_present("afldb-nl-problems-30d-2026-08-30.csv"),
        help="optional 30-day problem export used for adversarial seed shapes",
    )
    parser.add_argument(
        "--terms", type=Path,
        default=existing_if_present("afldb-nl-terms-30d-2026-08-30.csv"),
        help="optional 30-day unsupported/interesting-term export",
    )
    parser.add_argument(
        "--reformulations", type=Path,
        default=existing_if_present("afldb-nl-reformulations-30d-2026-08-30.csv"),
        help="optional 30-day reformulation export",
    )
    parser.add_argument(
        "--plans", type=Path,
        default=existing_if_present("afldb-nl-plans-30d-2026-08-30.csv"),
        help="optional 30-day distinct-plan export; example questions become seeds",
    )
    parser.add_argument(
        "--progress", type=int, default=100_000,
        help="print progress every N generated rows; 0 disables",
    )
    parser.add_argument(
        "--i-know-this-is-huge", action="store_true",
        help="allow counts above 50 million",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    generate(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
