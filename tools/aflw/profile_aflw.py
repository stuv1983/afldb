#!/usr/bin/env python3
"""Profile and reconcile the parsed AFLW staging files.

Answers the questions that decide the schema, before any of it is
committed to:

  * Does the source agree with itself? Fixture scores against match-page
    scores, team scores against player scores, player season totals
    against the sum of their matches, ladders against results.
  * What are the real shapes? Seasons, conferences, round types, venue
    strings, statistic ranges and null rates.
  * How dangerous is player identity, given the source's only handle on a
    person is a name-derived slug with no disambiguation?

Every check prints PASS, FAIL or a count. Nothing here writes anything.
"""

from __future__ import annotations

import argparse
import collections
import csv
import sys
from pathlib import Path

DEFAULT_IN = Path(__file__).resolve().parents[2] / "data" / "aflw" / "parsed"

SEASON_ORDER = ["2017", "2018", "2019", "2020", "2021", "2022",
                "7", "2023", "2024", "2025", "2026"]


def load(in_dir: Path, name: str) -> list[dict]:
    path = in_dir / f"{name}.csv"
    if not path.exists():
        sys.exit(f"ERROR: {path} not found. Run parse_aflw.py first.")
    with path.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def num(value: str) -> int | None:
    return int(value) if value not in ("", None) else None


def zero(value: str) -> int:
    return int(value) if value not in ("", None) else 0


def flag(value: str) -> bool:
    return value == "True"


def rule(title: str) -> None:
    print(f"\n{'=' * 74}\n{title}\n{'=' * 74}")


def verdict(label: str, failures: list[str], limit: int = 5) -> None:
    if not failures:
        print(f"  PASS  {label}")
        return
    print(f"  FAIL  {label}  ({len(failures):,})")
    for item in failures[:limit]:
        print(f"          {item}")
    if len(failures) > limit:
        print(f"          ... and {len(failures) - limit:,} more")


# ---------------------------------------------------------------------------

def report_seasons(seasons, fixtures, ladders, matches) -> None:
    rule("1. Seasons — the case for a surrogate key")
    print(f"  {'key':>5} {'ord':>4} {'year':>5} {'fixtures':>9} {'played':>7} "
          f"{'ladders':>8} {'GF':>4}  window")
    for row in sorted(seasons, key=lambda r: SEASON_ORDER.index(r["season_key"])):
        print(f"  {row['season_key']:>5} {row['ordinal']:>4} "
              f"{row['calendar_year']:>5} {int(row['fixture_count']):>9,} "
              f"{int(row['played_count']):>7,} {row['ladder_group_count']:>8} "
              f"{'yes' if flag(row['has_grand_final']) else 'NO':>4}  "
              f"{row['first_fixture_date']} .. {row['last_fixture_date']}")

    by_year = collections.defaultdict(list)
    for row in seasons:
        by_year[row["calendar_year"]].append(row["season_key"])
    collisions = {y: k for y, k in by_year.items() if len(k) > 1}
    print(f"\n  Calendar years carrying more than one season: "
          f"{collisions or 'none'}")
    no_premier = [r["season_key"] for r in seasons
                  if not flag(r["has_grand_final"])
                  and int(r["played_count"]) > 0]
    print(f"  Completed seasons with no grand final:          {no_premier}")
    conferences = {r["season_key"] for r in ladders if r["conference"]}
    print(f"  Seasons with conference ladders:                "
          f"{sorted(conferences) or 'none'}")

    scheduled = [r for r in fixtures if not flag(r["is_played"])]
    print(f"  Scheduled but unplayed fixtures:                {len(scheduled):,} "
          f"({', '.join(sorted({r['season_key'] for r in scheduled})) or 'none'})")
    print(f"  Fixtures {len(fixtures):,}  =  played {len(fixtures) - len(scheduled):,} "
          f"+ scheduled {len(scheduled):,};  match pages {len(matches):,}")


def report_fixture_match_agreement(fixtures, matches) -> None:
    rule("2. Fixture list vs match pages")
    played = {r["match_key"]: r for r in fixtures if flag(r["is_played"])}
    detail = {r["match_key"]: r for r in matches}

    verdict("every played fixture has a match page",
            sorted(set(played) - set(detail)))
    verdict("every match page has a fixture",
            sorted(set(detail) - set(played)))

    mismatches = []
    for key, fixture in played.items():
        match = detail.get(key)
        if match is None:
            continue
        for side in ("home", "away"):
            for part in ("goals", "behinds", "score"):
                column = f"{side}_{part}"
                if fixture[column] != match[column]:
                    mismatches.append(
                        f"{key} {column}: fixture {fixture[column]} vs page {match[column]}")
        if fixture["home_team_code"] != match["home_team_code"] or \
                fixture["away_team_code"] != match["away_team_code"]:
            mismatches.append(f"{key} teams differ")
        if fixture["venue_raw"] != match["venue_raw"]:
            mismatches.append(
                f"{key} venue: {fixture['venue_raw']!r} vs {match['venue_raw']!r}")
        if fixture["match_date"] != match["match_date"]:
            mismatches.append(
                f"{key} date: {fixture['match_date']} vs {match['match_date']}")
    verdict("scores, teams, venues and dates agree", mismatches)

    duplicates = [k for k, n in collections.Counter(
        r["match_key"] for r in fixtures).items() if n > 1]
    verdict("match keys are unique across all seasons", duplicates)


def report_score_reconciliation(matches, pms, events) -> None:
    rule("3. Score reconciliation — team vs players vs scoring worm")

    player_goals = collections.Counter()
    player_behinds = collections.Counter()
    for row in pms:
        player_goals[(row["match_key"], row["team_code"])] += zero(row["goals"])
        player_behinds[(row["match_key"], row["team_code"])] += zero(row["behinds"])

    # A behind may have no scorer because it was rushed, and either kind of
    # score may have no scorer simply because this match's worm names only
    # the club ("GOAL Crows" rather than "GOAL Erin Phillips (Crows)").
    # Both cases must be subtracted before player totals can be compared.
    event_goals = collections.Counter()
    event_behinds = collections.Counter()
    unattributed_goals = collections.Counter()
    unattributed_behinds = collections.Counter()
    rushed = collections.Counter()
    for row in events:
        key = (row["match_key"], row["team_code"])
        if row["event_type"] == "GOAL":
            event_goals[key] += 1
            if not row["player_name_raw"]:
                unattributed_goals[key] += 1
        else:
            event_behinds[key] += 1
            if row["event_type"] == "RUSHED BEHIND":
                rushed[key] += 1
            if not row["player_name_raw"]:
                unattributed_behinds[key] += 1

    goal_fail, behind_fail, worm_fail, arithmetic_fail = [], [], [], []
    for match in matches:
        key = match["match_key"]
        for side in ("home", "away"):
            code = match[f"{side}_team_code"]
            goals = num(match[f"{side}_goals"])
            behinds = num(match[f"{side}_behinds"])
            score = num(match[f"{side}_score"])
            if None in (goals, behinds, score):
                continue
            if goals * 6 + behinds != score:
                arithmetic_fail.append(
                    f"{key} {code}: {goals}.{behinds} != {score}")
            # The player stat table is complete whether or not the worm
            # names its scorers, so goals compare directly. Only rushed
            # behinds are genuinely unattributable to a player.
            if player_goals[(key, code)] != goals:
                goal_fail.append(
                    f"{key} {code}: players {player_goals[(key, code)]} vs team {goals}")
            expected_behinds = behinds - rushed[(key, code)]
            if player_behinds[(key, code)] != expected_behinds:
                behind_fail.append(
                    f"{key} {code}: players {player_behinds[(key, code)]} vs "
                    f"{behinds} behinds - {rushed[(key, code)]} rushed")
            if event_goals[(key, code)] != goals or event_behinds[(key, code)] != behinds:
                worm_fail.append(
                    f"{key} {code}: worm {event_goals[(key, code)]}."
                    f"{event_behinds[(key, code)]} vs team {goals}.{behinds}")

    verdict("goals*6 + behinds = score", arithmetic_fail)
    verdict("sum of player goals = team goals", goal_fail)
    verdict("sum of player behinds = team behinds - rushed", behind_fail)
    verdict("scoring worm totals = team score", worm_fail)
    print(f"\n  Rushed behinds:                  {sum(rushed.values()):,} "
          f"of {sum(event_behinds.values()):,} behinds")
    print(f"  Scores with no named scorer:     "
          f"{sum(unattributed_goals.values()) + sum(unattributed_behinds.values()):,} "
          f"of {sum(event_goals.values()) + sum(event_behinds.values()):,}")


def report_player_totals(pms, player_seasons) -> None:
    rule("4. Player season totals — source's own vs sum of match rows")
    columns = ["kicks", "handballs", "disposals", "contested", "metres_gained",
               "marks", "tackles", "hitouts", "fantasy_points", "goals", "behinds"]

    aggregated = collections.defaultdict(collections.Counter)
    games = collections.Counter()
    for row in pms:
        key = (row["season_key"], row["player_slug"])
        games[key] += 1
        for column in columns:
            aggregated[key][column] += zero(row[column])

    missing, mismatched = [], collections.Counter()
    examples: dict[str, str] = {}
    for row in player_seasons:
        key = (row["season_key"], row["player_slug"])
        if key not in games:
            missing.append(f"{key[0]} {key[1]}")
            continue
        if zero(row["games"]) != games[key]:
            mismatched["games"] += 1
            examples.setdefault(
                "games", f"{key[0]} {key[1]}: page {row['games']} vs matches {games[key]}")
        for column in columns:
            if zero(row[column]) != aggregated[key][column]:
                mismatched[column] += 1
                examples.setdefault(
                    column,
                    f"{key[0]} {key[1]}: page {row[column]} vs matches {aggregated[key][column]}")

    verdict("every season-page player appears in match data", missing)
    if not mismatched:
        print(f"  PASS  all {len(columns) + 1} totals reconcile across "
              f"{len(player_seasons):,} player-seasons")
    else:
        print(f"  FAIL  totals disagree ({sum(mismatched.values()):,} cells)")
        for column, count in mismatched.most_common():
            print(f"          {column:<16} {count:>6,}   e.g. {examples[column]}")

    orphans = sorted(set(games) - {(r["season_key"], r["player_slug"])
                                   for r in player_seasons})
    verdict("no player in match data is absent from the season page",
            [f"{s} {p}" for s, p in orphans])


def report_player_identity(pms) -> None:
    rule("5. Player identity — the source's weakest point")
    slugs = collections.defaultdict(set)
    names = collections.defaultdict(set)
    seasons_of = collections.defaultdict(set)
    clubs_of = collections.defaultdict(set)
    club_season = collections.defaultdict(lambda: collections.defaultdict(set))
    for row in pms:
        slug = row["player_slug"]
        slugs[slug].add(row["player_name_raw"])
        names[row["player_name_raw"]].add(slug)
        seasons_of[slug].add(row["season_key"])
        clubs_of[slug].add(row["team_code"])
        club_season[slug][row["season_key"]].add(row["team_code"])

    print(f"  Distinct player slugs:                  {len(slugs):,}")
    print(f"  Distinct display names:                 {len(names):,}")
    print(f"  Player-match rows:                      {len(pms):,}")

    multi_name = {s: n for s, n in slugs.items() if len(n) > 1}
    print(f"  Slugs carrying more than one name:      {len(multi_name)}")
    for slug, values in list(multi_name.items())[:5]:
        print(f"          {slug}: {sorted(values)}")

    multi_slug = {n: s for n, s in names.items() if len(s) > 1}
    print(f"  Names carrying more than one slug:      {len(multi_slug)}")
    for name, values in list(multi_slug.items())[:5]:
        print(f"          {name}: {sorted(values)}")

    print("\n  The slug is name-derived, but the source does disambiguate")
    print("  same-named players with a numeric suffix, inconsistently: one")
    print("  pair is Jordyn_Allen/Jordyn_Allen1, another Ella_Smith0/")
    print("  Ella_Smith1 with no unsuffixed form. The residual risks are a")
    print("  collision it failed to notice, and a surname change splitting")
    print("  one career in two. Surrogates for both:")

    mid_season = {s: {y: c for y, c in years.items() if len(c) > 1}
                  for s, years in club_season.items()}
    mid_season = {s: y for s, y in mid_season.items() if y}
    print(f"    two clubs within one season:          {len(mid_season)}")
    for slug, years in list(mid_season.items())[:8]:
        detail = "; ".join(f"{y}: {'/'.join(sorted(c))}" for y, c in years.items())
        print(f"          {slug} — {detail}")

    long_careers = {s: y for s, y in seasons_of.items() if len(y) >= 10}
    print(f"    present in 10 or 11 seasons:          {len(long_careers)}")

    gaps = []
    for slug, years in seasons_of.items():
        indexes = sorted(SEASON_ORDER.index(y) for y in years)
        if indexes and (indexes[-1] - indexes[0] + 1) - len(indexes) >= 4:
            gaps.append(f"{slug}: {sorted(years, key=SEASON_ORDER.index)}")
    print(f"    career gaps of 4+ seasons:            {len(gaps)}")
    for item in gaps[:5]:
        print(f"          {item}")

    many_clubs = {s: c for s, c in clubs_of.items() if len(c) >= 4}
    print(f"    played for 4 or more clubs:           {len(many_clubs)}")
    for slug, codes in list(many_clubs.items())[:5]:
        print(f"          {slug}: {sorted(codes)}")


def report_statistics(pms) -> None:
    rule("6. Statistics — coverage, ranges and the NULL/zero question")
    columns = ["kicks", "handballs", "disposals", "contested", "metres_gained",
               "marks", "hitouts", "tackles", "goals", "behinds",
               "score_points", "fantasy_points"]
    print(f"  {'column':<16} {'blank':>8} {'zero':>8} {'min':>7} {'max':>8} {'mean':>8}")
    for column in columns:
        values = [num(r[column]) for r in pms]
        present = [v for v in values if v is not None]
        blank = len(values) - len(present)
        zeros = sum(1 for v in present if v == 0)
        print(f"  {column:<16} {blank:>8,} {zeros:>8,} {min(present):>7,} "
              f"{max(present):>8,} {sum(present) / len(present):>8.1f}")

    print("\n  A blank scoreboard cell means the player did not score; goals,")
    print("  behinds and score_points are blank together and are the only")
    print("  columns that are ever blank. Every other statistic is recorded")
    print("  in every season, so AFLW needs no era-based NULL handling —")
    print("  unlike AFL, where NULL means 'not collected in this era'.")

    consistency = [r["match_key"] + " " + r["player_slug"] for r in pms
                   if zero(r["kicks"]) + zero(r["handballs"]) != zero(r["disposals"])]
    verdict("kicks + handballs = disposals", consistency)
    scores = [r["match_key"] + " " + r["player_slug"] for r in pms
              if r["goals"] and zero(r["goals"]) * 6 + zero(r["behinds"]) != zero(r["score_points"])]
    verdict("player goals*6 + behinds = score_points", scores)

    negatives = [c for c in columns
                 if any((num(r[c]) or 0) < 0 for r in pms)]
    print(f"\n  Columns that go negative: {negatives}")
    print("  Metres gained and fantasy points are both signed. Any CHECK")
    print("  constraint assuming a non-negative statistic would reject real rows.")

    positions = collections.Counter(r["position"] for r in pms)
    print(f"\n  Distinct position codes: {len(positions)}")
    for position, count in positions.most_common():
        print(f"    {position:<6} {count:>7,}")
    jumpers = collections.Counter(r["jumper_number"] for r in pms)
    print(f"  Distinct jumper numbers: {len(jumpers)}  "
          f"(blank: {jumpers.get('', 0):,})")


def report_teams_and_venues(fixtures, matches, ladders, pms) -> None:
    rule("7. Clubs and venues")
    names = collections.defaultdict(set)
    seasons_of = collections.defaultdict(set)
    for row in fixtures:
        for side in ("home", "away"):
            names[row[f"{side}_team_code"]].add(row[f"{side}_team_name_raw"])
            seasons_of[row[f"{side}_team_code"]].add(row["season_key"])
    for row in ladders:
        names[row["team_code"]].add(row["team_name_raw"])

    print(f"  {'code':<6} {'name as published':<22} {'seasons':>8}  first .. last")
    for code in sorted(names):
        years = sorted(seasons_of[code], key=SEASON_ORDER.index)
        label = " / ".join(sorted(n for n in names[code] if n))
        print(f"  {code:<6} {label:<22} {len(years):>8}  "
              f"{years[0] if years else '-'} .. {years[-1] if years else '-'}")

    print("\n  Names are the source's CURRENT labels applied to every season:")
    print("  a 2017 match page already says Kuwarna, not Adelaide. The scrape")
    print("  therefore carries no AFLW rename history — that must come from")
    print("  elsewhere and be modelled as era-scoped club identities.")

    venues = collections.Counter(r["venue_raw"] for r in fixtures)
    print(f"\n  Distinct venue strings: {len(venues)}")
    for venue, count in venues.most_common(10):
        print(f"    {count:>4,}  {venue}")
    blank = venues.get("", 0)
    if blank:
        print(f"    {blank} fixture(s) with no venue")

    codes_in_stats = {r["team_code"] for r in pms}
    verdict("every stat table resolves to a known club code",
            sorted(codes_in_stats - set(names)))


def report_ladders(ladders, fixtures) -> None:
    rule("8. Ladders vs results")
    played = [r for r in fixtures if flag(r["is_played"])
              and r["round_type"] == "home_and_away"]
    tally = collections.defaultdict(lambda: collections.Counter())
    for row in played:
        home, away = row["home_team_code"], row["away_team_code"]
        hs, as_ = num(row["home_score"]), num(row["away_score"])
        for code, own, other in ((home, hs, as_), (away, as_, hs)):
            key = (row["season_key"], code)
            tally[key]["played"] += 1
            tally[key]["points_for"] += own
            tally[key]["points_against"] += other
            if own > other:
                tally[key]["wins"] += 1
            elif own < other:
                tally[key]["losses"] += 1
            else:
                tally[key]["draws"] += 1

    failures = []
    for row in ladders:
        key = (row["season_key"], row["team_code"])
        computed = tally.get(key)
        if computed is None:
            failures.append(f"{key[0]} {key[1]}: on ladder, no matches")
            continue
        for column in ("played", "wins", "draws", "losses",
                       "points_for", "points_against"):
            if zero(row[column]) != computed[column]:
                failures.append(f"{key[0]} {key[1]} {column}: ladder "
                                f"{row[column]} vs results {computed[column]}")
    verdict("ladder W/D/L and points reconcile with home-and-away results",
            failures)

    groups = collections.defaultdict(set)
    for row in ladders:
        groups[row["season_key"]].add(row["conference"])
    for key in SEASON_ORDER:
        if key in groups and len(groups[key]) > 1:
            print(f"  {key}: {len(groups[key])} conference ladders "
                  f"{sorted(groups[key])}")


def report_scoring_events(events) -> None:
    rule("9. Scoring progression — data AFLDB has no home for")
    print(f"  Scoring events:            {len(events):,}")
    types = collections.Counter(r["event_type"] for r in events)
    for kind, count in types.most_common():
        print(f"    {kind:<16} {count:>8,}")
    periods = collections.Counter(r["period"] for r in events)
    print(f"  Periods present:           {sorted(periods)}")
    named = sum(1 for r in events if r["player_name_raw"])
    print(f"  Events with a named scorer: {named:,} "
          f"({named / len(events):.1%})")
    matches = {r["match_key"] for r in events}
    print(f"  Matches with a worm:        {len(matches):,}")

    # Attribution is all-or-nothing per match: a worm either names its
    # scorers throughout or names only the club throughout.
    per_match = collections.defaultdict(lambda: [0, 0])
    for row in events:
        if row["event_type"] == "RUSHED BEHIND":
            continue        # never attributable, in any season
        entry = per_match[(row["season_key"], row["match_key"])]
        entry[0] += 1
        entry[1] += 1 if row["player_name_raw"] else 0
    partial = [k for k, (total, named_count) in per_match.items()
               if 0 < named_count < total]
    print(f"  Matches naming only some scorers: {len(partial)}")

    print(f"\n  Scorer attribution by season:")
    print(f"  {'season':>7} {'matches':>8} {'attributed':>11} {'events':>8} {'named':>8}")
    by_season = collections.defaultdict(lambda: [0, 0, 0, 0])
    for (season, _match), (total, named_count) in per_match.items():
        entry = by_season[season]
        entry[0] += 1
        entry[1] += 1 if named_count else 0
        entry[2] += total
        entry[3] += named_count
    for season in SEASON_ORDER:
        if season not in by_season:
            continue
        matches_n, attributed, total, named_count = by_season[season]
        print(f"  {season:>7} {matches_n:>8,} {attributed:>11,} "
              f"{total:>8,} {named_count:>8,}")

    print("\n  Scorers are published as display names only, with no slug, so")
    print("  linking an event to a player needs name resolution within the")
    print("  match's two squads rather than a direct key.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="in_dir", type=Path, default=DEFAULT_IN)
    args = parser.parse_args()

    seasons = load(args.in_dir, "seasons")
    fixtures = load(args.in_dir, "fixtures")
    ladders = load(args.in_dir, "ladders")
    matches = load(args.in_dir, "matches")
    pms = load(args.in_dir, "player_match_stats")
    player_seasons = load(args.in_dir, "player_seasons")
    events = load(args.in_dir, "scoring_events")

    report_seasons(seasons, fixtures, ladders, matches)
    report_fixture_match_agreement(fixtures, matches)
    report_score_reconciliation(matches, pms, events)
    report_player_totals(pms, player_seasons)
    report_player_identity(pms)
    report_statistics(pms)
    report_teams_and_venues(fixtures, matches, ladders, pms)
    report_ladders(ladders, fixtures)
    report_scoring_events(events)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
