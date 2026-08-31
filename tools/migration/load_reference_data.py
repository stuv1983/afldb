#!/usr/bin/env python3
"""Load AFLDB static/reference data from data/reference/ into PostgreSQL.

    python tools/migration/load_reference_data.py                    # all groups
    python tools/migration/load_reference_data.py --groups seasons
    python tools/migration/load_reference_data.py --print-plan       # no database
    python tools/migration/load_reference_data.py --list-groups

AFLDB-ISSUE-093 Phase 1: the static/reference definitions previously embedded
in import_legacy_afl.py, now loaded from tracked JSON datasets with zero
dependency on AFLDB_LEGACY_SQLITE. Intended to be the static/reference step of
the future db:test:rebuild orchestrator, and runnable standalone.

The load is deterministic (a pure function of the JSON datasets) and
idempotent: sources upserts by key; every other group truncates its targets
and reloads. Truncation fails closed: if TRUNCATE ... CASCADE would empty a
table outside this loader's own set that currently holds rows, the run
refuses before touching the database unless --allow-cascade is given.

It runs as afldb_import and holds exactly that role's privileges (§H12).
The FK graph reaches admin and link-review relations the import role is
deliberately denied, so the cascade guard classifies dependents through the
catalogue rather than by reading them, and refuses on any it cannot prove
empty. A truncate whose targets are already empty is skipped outright: it
would remove nothing, and TRUNCATE ... CASCADE requires privileges on the
whole cascade set, not merely on the tables named.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg  # noqa: E402

from common import (  # noqa: E402
    Reporter,
    any_rows,
    cascade_dependents,
    connect_pg,
    copy_rows,
    load_env,
    normalise_table,
    require_env,
    safe_dsn,
    scalar,
    selectable,
    truncate,
)

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "reference"

GROUPS = {
    "sources": "source registry (upsert by key)",
    "seasons": "season range, league eras, status",
    "clubs": "club identities, aliases, organizations, relations",
    "coverage": "stat definitions and historical stat coverage",
}
DEFAULT_ORDER = ["sources", "seasons", "clubs", "coverage"]

GROUP_TRUNCATES = {
    "sources": (),
    "seasons": ("seasons",),
    "clubs": ("clubs", "club_aliases"),
    "coverage": ("stat_definitions", "stat_availability"),
}

# Every table a group rebuilds, truncated or not (the clubs group rebuilds
# the organization tables with DELETE inside its transaction). CASCADE from
# this run's truncates may only reach tables the same run rebuilds; anything
# else must be empty or explicitly acknowledged.
GROUP_REBUILDS = {
    "sources": ("sources",),
    "seasons": ("seasons",),
    "clubs": ("clubs", "club_aliases",
              "club_organizations", "club_organization_relations"),
    "coverage": ("stat_definitions", "stat_availability"),
}

# The truncate roots guard_cascade() adjudicated, and the ONLY ones
# reload_truncate() may act on. None means the guard has not run yet, which is
# itself a refusal. Mirrors common._reload_scope's module-level shape.
_cleared_roots: set[str] | None = None


def reset_cascade_state() -> None:
    """Forget the guard's decision. For tests that run several scenarios."""
    global _cleared_roots
    _cleared_roots = None


VALID_SUCCESSIONS = {"current", "renamed", "relocated", "merged", "defunct"}
VALID_COVERAGE = {"complete", "partial", "not_collected", "not_applicable", "pending"}


# ---------------------------------------------------------------------------
# Datasets
# ---------------------------------------------------------------------------


def read_dataset(name: str) -> dict:
    path = DATA_DIR / name
    if not path.exists():
        sys.exit(f"ERROR: reference dataset not found: {path}")
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def validate_datasets(data: dict) -> list[str]:
    """Cross-check the datasets. Returns a list of problems (empty = valid)."""
    problems: list[str] = []
    seasons, clubs = data["seasons"], data["clubs"]
    first, last = seasons["first_season"], seasons["last_season"]

    if not (isinstance(first, int) and isinstance(last, int) and first <= last):
        problems.append(f"season range invalid: {first}..{last}")
    year = first
    for era in seasons["league_eras"]:
        era_first = era["first_season"]
        era_last = era["last_season"] if era["last_season"] is not None else last
        if era_first != year or era_last < era_first:
            problems.append(f"league eras must tile {first}..{last} contiguously; "
                            f"got {era['league']} {era_first}..{era_last} at {year}")
            break
        year = era_last + 1
    else:
        if year != last + 1:
            problems.append(f"league eras stop at {year - 1}, season range ends {last}")
    for y in seasons["in_progress_seasons"]:
        if not first <= y <= last:
            problems.append(f"in_progress season {y} outside {first}..{last}")

    identities = clubs["identities"]
    for field in ("hist", "slug", "name"):
        values = [c[field] for c in identities]
        if len(values) != len(set(values)):
            problems.append(f"club {field} values are not unique")
    hists = {c["hist"] for c in identities}
    self_slugs = {c["slug"] for c in identities if c["successor_hist"] is None}
    for c in identities:
        if c["succession"] not in VALID_SUCCESSIONS:
            problems.append(f"{c['hist']}: bad succession {c['succession']!r}")
        if c["successor_hist"] is not None and c["successor_hist"] not in hists:
            problems.append(f"{c['hist']}: successor {c['successor_hist']!r} unknown")
        c_last = c["last_season"] if c["last_season"] is not None else last
        if not (first <= c["first_season"] <= c_last <= last):
            problems.append(f"{c['hist']}: span {c['first_season']}..{c['last_season']} "
                            f"outside {first}..{last}")
        if c["is_current_afl_club"] != (c["succession"] == "current"):
            problems.append(f"{c['hist']}: is_current_afl_club disagrees with succession")
    for rel in clubs["organization_relations"]:
        for slug in (rel["from_slug"], rel["to_slug"]):
            if slug is not None and slug not in self_slugs:
                problems.append(f"organization relation references {slug!r}, which is not "
                                "an organization (its own current identity)")
        if (rel["relation"] == "folded") != (rel["to_slug"] is None):
            problems.append(f"relation {rel['from_slug']}: folded/to_slug mismatch")

    defs = data["stat_definitions"]["definitions"]
    keys = [d["key"] for d in defs]
    if len(keys) != len(set(keys)):
        problems.append("stat definition keys are not unique")

    avail = data["stat_availability"]
    if avail["status"] == "READY":
        seen: set[tuple[str, int]] = set()
        for r in avail["coverage_ranges"]:
            if r["stat_key"] not in set(keys):
                problems.append(f"coverage range for undefined stat {r['stat_key']!r}")
            if r["coverage"] not in VALID_COVERAGE:
                problems.append(f"{r['stat_key']}: bad coverage {r['coverage']!r}")
            if not (first <= r["first_season"] <= r["last_season"] <= last):
                problems.append(f"{r['stat_key']}: range {r['first_season']}.."
                                f"{r['last_season']} outside {first}..{last}")
                continue
            for y in range(r["first_season"], r["last_season"] + 1):
                if (r["stat_key"], y) in seen:
                    problems.append(f"{r['stat_key']}: season {y} covered twice")
                    break
                seen.add((r["stat_key"], y))
    return problems


def availability_rows(data: dict) -> list[tuple]:
    """Expand coverage ranges into stat_availability rows, deterministically."""
    rows = []
    for r in data["stat_availability"]["coverage_ranges"]:
        for season in range(r["first_season"], r["last_season"] + 1):
            rows.append((r["stat_key"], season,
                         r["coverage"] in ("complete", "partial"),
                         r["coverage"], None, None))
    rows.sort(key=lambda t: (t[0], t[1]))
    return rows


# ---------------------------------------------------------------------------
# Load groups
# ---------------------------------------------------------------------------


def load_sources(pg: psycopg.Connection, data: dict, rep: Reporter) -> None:
    with pg.cursor() as cur:
        for s in data["sources"]["sources"]:
            cur.execute(
                """INSERT INTO sources (key, name, url, kind, description)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (key) DO UPDATE
                     SET name = EXCLUDED.name, url = EXCLUDED.url,
                         kind = EXCLUDED.kind, description = EXCLUDED.description""",
                (s["key"], s["name"], s["url"], s["kind"], s["description"]),
            )
    pg.commit()
    rep.result("sources", scalar(pg, "SELECT count(*) FROM sources"))


def load_seasons(pg: psycopg.Connection, data: dict, rep: Reporter) -> None:
    ds = data["seasons"]
    first, last = ds["first_season"], ds["last_season"]
    league = {}
    for era in ds["league_eras"]:
        era_last = era["last_season"] if era["last_season"] is not None else last
        for y in range(era["first_season"], era_last + 1):
            league[y] = era["league"]
    in_progress = set(ds["in_progress_seasons"])
    notes = {int(k): v for k, v in ds.get("season_notes", {}).items()}

    reload_truncate(pg, "seasons")
    # Measured columns (match dates/counts, data_through_date) belong to the
    # later match-import and season_metadata phases and stay NULL here.
    copy_rows(pg, "seasons", ["year", "league", "status", "notes"],
              [(y, league[y],
                "in_progress" if y in in_progress else "complete",
                notes.get(y))
               for y in range(first, last + 1)])
    pg.commit()
    rep.result("seasons", scalar(pg, "SELECT count(*) FROM seasons"),
               f"({first}-{last}; {len(in_progress)} in progress)")


def load_clubs(pg: psycopg.Connection, data: dict, rep: Reporter) -> None:
    ds = data["clubs"]
    last_season = data["seasons"]["last_season"]

    reload_truncate(pg, "clubs", "club_aliases")
    ids: dict[str, int] = {}
    with pg.cursor() as cur:
        # The first club inserted has no valid identity to point at yet, so
        # the self-referencing FK is deferred to COMMIT while both passes run.
        cur.execute("SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED")

        # Pass 1: insert with a placeholder identity.
        for c in ds["identities"]:
            cur.execute(
                """INSERT INTO clubs
                     (slug, name, short_name, abbreviation, current_identity_id,
                      succession, is_current_afl_club, first_season, last_season,
                      home_state, wikipedia_url, afltables_slug, legacy_club_key,
                      legacy_club_hist, notes)
                   VALUES (%s,%s,%s,%s, 0, %s,%s,%s,%s,%s,%s,%s, NULL, %s,%s)
                   RETURNING id""",
                (
                    c["slug"], c["name"], c["short_name"], c["abbreviation"],
                    c["succession"], c["is_current_afl_club"],
                    c["first_season"],
                    c["last_season"] if c["last_season"] is not None else last_season,
                    c["home_state"], c["wikipedia_url"], c["afltables_slug"],
                    c["hist"], c["notes"],
                ),
            )
            ids[c["hist"]] = cur.fetchone()[0]

        # Pass 2: resolve successor identities.
        for c in ds["identities"]:
            target = ids[c["successor_hist"]] if c["successor_hist"] else ids[c["hist"]]
            cur.execute("UPDATE clubs SET current_identity_id = %s WHERE id = %s",
                        (target, ids[c["hist"]]))

        # Aliases: every string any source uses for the club, so lookups by
        # hist string, name, short name or abbreviation all resolve.
        seen: set[tuple[int, str]] = set()
        for c in ds["identities"]:
            club_id = ids[c["hist"]]
            for alias, alias_type in (
                (c["hist"], "source_string"), (c["name"], "alternate"),
                (c["short_name"], "alternate"), (c["abbreviation"], "abbreviation"),
            ):
                if alias and (club_id, alias) not in seen:
                    seen.add((club_id, alias))
                    cur.execute(
                        """INSERT INTO club_aliases (club_id, alias, alias_type)
                           VALUES (%s,%s,%s) ON CONFLICT DO NOTHING""",
                        (club_id, alias, alias_type),
                    )

        # Organizations, in the same transaction: clubs and their
        # organizations appear together or not at all. Relations cascade from
        # organizations, so they go first.
        cur.execute("DELETE FROM club_organization_relations")
        cur.execute("DELETE FROM club_organizations")
        cur.execute("""
            INSERT INTO club_organizations
                  (id, name, slug, first_season, last_season, is_active)
            SELECT cur.id, cur.name, cur.slug,
                   min(mem.first_season), max(mem.last_season),
                   max(mem.last_season) = (SELECT max(year) FROM seasons)
              FROM clubs cur
              JOIN clubs mem ON mem.current_identity_id = cur.id
             WHERE cur.id = cur.current_identity_id
             GROUP BY cur.id, cur.name, cur.slug
        """)
        cur.execute("""
            SELECT setval(pg_get_serial_sequence('club_organizations', 'id'),
                          (SELECT max(id) FROM club_organizations))
        """)
        cur.execute("UPDATE clubs SET organization_id = current_identity_id")

        for rel in ds["organization_relations"]:
            cur.execute(
                """INSERT INTO club_organization_relations
                     (from_organization_id, to_organization_id, relation,
                      effective_season, notes)
                   SELECT f.id,
                          (SELECT id FROM club_organizations WHERE slug = %s),
                          %s, %s, %s
                     FROM club_organizations f WHERE f.slug = %s""",
                (rel["to_slug"], rel["relation"], rel["effective_season"],
                 rel["notes"], rel["from_slug"]),
            )
    pg.commit()

    orphans = scalar(pg, "SELECT count(*) FROM clubs WHERE organization_id IS NULL")
    if orphans:
        raise RuntimeError(f"{orphans} club identities have no organization")

    rep.result("clubs", scalar(pg, "SELECT count(*) FROM clubs"),
               f"({scalar(pg, 'SELECT count(*) FROM clubs WHERE is_current_afl_club')} current)")
    rep.result("club_aliases", scalar(pg, "SELECT count(*) FROM club_aliases"))
    rep.result("club_organizations",
               scalar(pg, "SELECT count(*) FROM club_organizations"),
               f"({scalar(pg, 'SELECT count(*) FROM club_organization_relations')} relations)")


def load_coverage(pg: psycopg.Connection, data: dict, rep: Reporter) -> None:
    if data["stat_availability"]["status"] != "READY":
        sys.exit("ERROR: data/reference/stat-availability.json is marked "
                 f"{data['stat_availability']['status']!r}, not READY. The coverage "
                 "grid has not been baked in yet; refusing to load an empty grid.")

    reload_truncate(pg, "stat_definitions", "stat_availability")
    with pg.cursor() as cur:
        for d in data["stat_definitions"]["definitions"]:
            cur.execute(
                """INSERT INTO stat_definitions
                     (key, label, short_label, description, unit, display_order)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (d["key"], d["label"], d["short_label"], d["description"],
                 d["unit"], d["display_order"]),
            )
    rows = availability_rows(data)
    copy_rows(pg, "stat_availability",
              ["stat_key", "season", "is_recorded", "coverage",
               "populated_rows", "total_rows"], rows)
    pg.commit()

    recorded = scalar(pg, "SELECT count(*) FROM stat_availability WHERE is_recorded")
    rep.result("stat_definitions", scalar(pg, "SELECT count(*) FROM stat_definitions"))
    rep.result("stat_availability", len(rows), f"({recorded} season/stat pairs recorded)")


# ---------------------------------------------------------------------------
# Cascade safety
# ---------------------------------------------------------------------------


def guard_cascade(pg: psycopg.Connection, groups: list[str], rep: Reporter,
                  allow_cascade: bool) -> None:
    """Refuse to TRUNCATE if CASCADE would empty out-of-scope data.

    cascade_dependents() is FK-graph based, so on a freshly migrated empty
    database it still names matches, player tables, etc. Emptying an empty
    table loses nothing, so the refusal is limited to out-of-scope dependents
    that currently hold rows.
    """
    global _cleared_roots
    _cleared_roots = set()

    to_truncate = {normalise_table(t) for g in groups for t in GROUP_TRUNCATES[g]}
    if not to_truncate:
        return

    # AFLDB-ISSUE-093 §H13. Only a root that HOLDS ROWS is actually truncated --
    # reload_truncate() skips the rest -- and a truncate that never runs cascades
    # into nothing. So the cascade closure must be taken from the POPULATED roots,
    # not from the union of every group's targets.
    #
    # Taking it from the union was the §H12 defect. Migrations 015 and 016 SEED
    # stat_definitions and stat_availability, so a freshly migrated database is
    # never fully empty: those two roots hold rows, the whole-union short circuit
    # could not fire, and the closure of the EMPTY clubs/seasons roots -- which
    # reaches player_link_match_candidates and player_match_period_stats -- was
    # adjudicated anyway. The guard then refused over a cascade that was never
    # going to happen.
    populated_roots = any_rows(pg, sorted(to_truncate))
    _cleared_roots = set(populated_roots)
    if not populated_roots:
        return

    rebuilt = {normalise_table(t) for g in groups for t in GROUP_REBUILDS[g]}
    dependents = cascade_dependents(pg, populated_roots)
    outside = sorted(dependents - rebuilt)

    # AFLDB-ISSUE-093 §H12. cascade_dependents() is FK-graph based, so `outside`
    # names every table that transitively references clubs/seasons -- including
    # admin and link-review relations that afldb_import is DELIBERATELY denied
    # (migration 067's candidate cache is app-readable and import-revoked by
    # design). Counting rows in those raised InsufficientPrivilege and killed the
    # run. The privilege split is asked of the catalogue, so it never touches them.
    readable = selectable(pg, outside)
    unreadable = [t for t in outside if t not in readable]
    populated = any_rows(pg, [t for t in outside if t in readable])

    # An unreadable dependent cannot be PROVEN empty, and this guard exists to
    # refuse exactly when it cannot prove that. It fails closed rather than
    # assuming, and rather than asking for a privilege it should not hold.
    if unreadable and not allow_cascade:
        sys.exit("ERROR: refusing to load reference data: TRUNCATE ... CASCADE "
                 "would reach " + ", ".join(unreadable)
                 + ", which this role may not read, so they cannot be shown to be "
                 "empty. This loader does not rebuild them. Run against a freshly "
                 "migrated database, or pass --allow-cascade if emptying them is "
                 "genuinely intended.")
    if populated:
        if allow_cascade:
            rep.warn("--allow-cascade: emptying populated out-of-scope tables: "
                     + ", ".join(populated))
            return
        sys.exit("ERROR: refusing to load reference data: TRUNCATE ... CASCADE "
                 "would also empty " + ", ".join(populated)
                 + ", which hold data this loader does not rebuild. Run against "
                 "a freshly migrated database, or pass --allow-cascade if "
                 "emptying them is genuinely intended.")
    if unreadable and allow_cascade:
        rep.warn("--allow-cascade: cascading into unreadable out-of-scope tables: "
                 + ", ".join(unreadable))


def reload_truncate(pg: psycopg.Connection, *tables: str) -> None:
    """TRUNCATE the group's targets, unless they are already empty.

    AFLDB-ISSUE-093 §H12. `TRUNCATE a, b CASCADE` requires TRUNCATE privilege on
    every table the cascade reaches, not merely on the ones named -- and the
    cascade from `clubs` reaches relations `afldb_import` is deliberately denied.
    Skipping the statement when every named table is already empty is exactly
    equivalent (truncating an empty table removes nothing) and asks for no
    privilege the role is not meant to have.

    This is not a way around the guard. guard_cascade() has already run, and it
    refuses whenever any of these tables holds a row and the cascade set cannot
    be shown to be safe -- so reaching this function with a populated target
    means the cascade was already established as in-scope.
    """
    if not tables:
        return
    populated = any_rows(pg, [normalise_table(t) for t in tables])
    if not populated:
        return

    # AFLDB-ISSUE-093 §H13. The guard and the truncate must not be able to disagree
    # about which roots are in play -- that disagreement IS the defect this pair of
    # functions exists to close. guard_cascade() records exactly the roots whose
    # cascade it adjudicated; anything else reaching here is unadjudicated, and is
    # refused rather than truncated.
    if _cleared_roots is None:
        sys.exit("ERROR: internal: reload_truncate() reached before guard_cascade(). "
                 "No TRUNCATE may run without an adjudicated cascade.")
    unadjudicated = sorted(set(populated) - _cleared_roots)
    if unadjudicated:
        sys.exit("ERROR: refusing to TRUNCATE " + ", ".join(unadjudicated)
                 + ": these tables hold rows now but were empty when the cascade "
                 "guard ran, so the cascade from them has not been adjudicated.")

    truncate(pg, *tables)


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Load AFLDB static/reference data from data/reference/.")
    parser.add_argument("--groups", nargs="+", choices=DEFAULT_ORDER,
                        help="load only these groups (dependency order is preserved)")
    parser.add_argument("--list-groups", action="store_true")
    parser.add_argument("--print-plan", action="store_true",
                        help="validate the datasets and print planned row counts "
                             "without connecting to the database")
    parser.add_argument("--allow-cascade", action="store_true",
                        help="permit TRUNCATE ... CASCADE to empty populated "
                             "tables this loader does not rebuild; off by default")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    if args.list_groups:
        for name in DEFAULT_ORDER:
            print(f"  {name:<10} {GROUPS[name]}")
        return 0

    data = {
        "sources": read_dataset("sources.json"),
        "seasons": read_dataset("seasons.json"),
        "clubs": read_dataset("clubs.json"),
        "stat_definitions": read_dataset("stat-definitions.json"),
        "stat_availability": read_dataset("stat-availability.json"),
    }
    problems = validate_datasets(data)
    if problems:
        for p in problems:
            print(f"  INVALID: {p}", file=sys.stderr)
        sys.exit(f"ERROR: {len(problems)} problem(s) in data/reference datasets")

    if args.print_plan:
        ds = data["seasons"]
        season_count = ds["last_season"] - ds["first_season"] + 1
        avail = data["stat_availability"]
        print("reference datasets valid")
        print(f"  sources:          {len(data['sources']['sources'])}")
        print(f"  seasons:          {season_count} ({ds['first_season']}-{ds['last_season']})")
        print(f"  clubs:            {len(data['clubs']['identities'])}")
        print(f"  org relations:    {len(data['clubs']['organization_relations'])}")
        print(f"  stat definitions: {len(data['stat_definitions']['definitions'])}")
        print(f"  stat coverage:    {avail['status']} "
              f"({len(availability_rows(data))} rows)")
        return 0

    load_env()
    rep = Reporter(verbose=not args.quiet)
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    groups = [g for g in DEFAULT_ORDER if not args.groups or g in args.groups]

    print("AFLDB reference data load")
    print(f"  data:   {DATA_DIR}")
    print(f"  target: {safe_dsn(dsn)}\n")

    pg = connect_pg(dsn)
    try:
        guard_cascade(pg, groups, rep, args.allow_cascade)
        for group in groups:
            rep.step(f"[{group}] {GROUPS[group]}")
            if group == "sources":
                load_sources(pg, data, rep)
            elif group == "seasons":
                load_seasons(pg, data, rep)
            elif group == "clubs":
                load_clubs(pg, data, rep)
            elif group == "coverage":
                load_coverage(pg, data, rep)
    finally:
        pg.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
