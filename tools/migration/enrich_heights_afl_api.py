#!/usr/bin/env python3
"""Record AFL API season-roster heights as a SECOND height evidence source.

    python tools/migration/enrich_heights_afl_api.py --label rosters-20260905 \
        --dry-run --report afl-api-heights.json
    python tools/migration/enrich_heights_afl_api.py --label rosters-20260905

Why this exists (AFLDB-ISSUE-118 Stage H3)
------------------------------------------
Stage H2 filled players.height_cm from the AFL Tables player_details
register through player_height_evidence. The Gridley external oracle
disagrees with that value for 83 bridged players, so a second,
independent source is needed to adjudicate on evidence: the AFL.com.au
API season squad lists (tools/rebuild/afl_api/acquire_rosters.R), which
carry `heightInCm` per (player, season, club) from 2012 onward, keyed by
the stable `providerId`.

What this script does
---------------------
  * Verifies every roster artefact against the TRACKED manifest
    (docs/rebuild-manifests/afl_api/<label>.json) before anything else.
  * Reconciles each providerId to at most one canonical player, fail
    closed: the candidate must carry the same normalised name AND have
    played for the same club organisation in at least one season the API
    lists the providerId with. Zero candidates -> unmatched (a list
    member who never played, or a spelling the source does not share);
    several -> ambiguous. Neither writes anything. A name alone never
    identifies anyone.
  * Writes every distinct listed height per mapped player to
    player_height_evidence (source afl_api, evidence_type
    afl_api_season_roster, occurrences = seasons listing that value,
    notes = the seasons). Conflicting values are all kept.
  * NEVER writes players.height_cm. The AFL Tables register is the
    canonical height source (§23.19); this family corroborates it. A
    player whose canonical height is NULL is reported, not filled.
  * With --disagreements <height-oracle disagreement list> it emits the
    adjudication table the precedence decision is made from.

Safe to re-run: evidence is upserted on (player_id, source_id, height_cm)
and nothing else is written.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    Reporter, connect_pg, import_batch, load_env, require_env, safe_dsn,
)
from enrich_heights import HEIGHT_MAX, HEIGHT_MIN  # noqa: E402
from enrich_heights import normalise_name as _normalise_name  # noqa: E402
from import_fitzroy_core import sha256_file  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_ROOT = REPO_ROOT / "data" / "sources" / "afl_api" / "rosters"
MANIFEST_ROOT = REPO_ROOT / "docs" / "rebuild-manifests" / "afl_api"

SOURCE_KEY = "afl_api"
EVIDENCE_TYPE = "afl_api_season_roster"
TOOL = "enrich_heights_afl_api.py"

#: The API's own team labels -> club_organizations.slug. Every label the
#: snapshot carries must be here; an unknown label aborts (never guessed).
TEAM_SLUGS = {
    "Adelaide Crows": "adelaide",
    "Brisbane Lions": "brisbane-lions",
    "Carlton": "carlton",
    "Collingwood": "collingwood",
    "Essendon": "essendon",
    "Fremantle": "fremantle",
    "Geelong Cats": "geelong",
    "Gold Coast SUNS": "gold-coast",
    "GWS GIANTS": "greater-western-sydney",
    "Hawthorn": "hawthorn",
    "Melbourne": "melbourne",
    "North Melbourne": "north-melbourne",
    "Port Adelaide": "port-adelaide",
    "Richmond": "richmond",
    "St Kilda": "st-kilda",
    "Sydney Swans": "sydney",
    "West Coast Eagles": "west-coast",
    "Western Bulldogs": "western-bulldogs",
}


# --------------------------------------------------------------------------
# Pure parsing / reconciliation
# --------------------------------------------------------------------------


def normalise_name(text: str) -> str:
    """H2's normalisation with apostrophes removed first: the API prints a
    curly apostrophe (O’Meara) that NFKD drops, AFL Tables a straight one
    that becomes a space, so both sides must agree before comparing."""
    return _normalise_name((text or "").replace("’", "").replace("'", ""))


def api_name(first: str | None, surname: str | None) -> str:
    """`Brad J.` + `Miller` -> `brad miller`: the API disambiguates with a
    middle initial AFL Tables does not print, so a lone initial is dropped."""
    first_tokens = [t for t in (first or "").split() if not re.fullmatch(r"[A-Za-z]\.?", t)]
    return normalise_name(" ".join(first_tokens + [surname or ""]))


def parse_height(raw: Any) -> int | None:
    """Integer cm; 0 / null / implausible -> None (zero is missing, never 0)."""
    if raw is None or raw == "":
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if HEIGHT_MIN <= value <= HEIGHT_MAX else None


@dataclass
class Listed:
    """One providerId across every season the snapshot lists it."""

    provider_id: str
    names: set[str] = field(default_factory=set)
    surnames: set[str] = field(default_factory=set)
    club_seasons: set[tuple[str, int]] = field(default_factory=set)   # (slug, season)
    heights: dict[int, int | None] = field(default_factory=dict)      # season -> cm
    jumpers: dict[int, str] = field(default_factory=dict)
    raw_names: set[str] = field(default_factory=set)


def fold_rows(rows: Any) -> dict[str, Listed]:
    listed: dict[str, Listed] = {}
    for row in rows:
        pid = (row.get("providerId") or "").strip()
        team = (row.get("team") or "").strip()
        if not pid:
            raise ValueError(f"roster row without providerId: {row.get('firstName')} {row.get('surname')}")
        slug = TEAM_SLUGS.get(team)
        if slug is None:
            raise ValueError(f"roster team label {team!r} is not a known club organisation")
        season = int(row["season"])
        item = listed.get(pid)
        if item is None:
            item = listed[pid] = Listed(provider_id=pid)
        item.names.add(api_name(row.get("firstName"), row.get("surname")))
        if normalise_name(row.get("surname") or ""):
            item.surnames.add(normalise_name(row.get("surname") or ""))
        item.raw_names.add(f"{row.get('firstName', '')} {row.get('surname', '')}".strip())
        item.club_seasons.add((slug, season))
        item.heights[season] = parse_height(row.get("heightInCm"))
        if row.get("jumperNumber") not in (None, ""):
            item.jumpers[season] = str(row["jumperNumber"])
    return listed


@dataclass
class Canonical:
    """One AFLDB player as canonical match facts describe them."""

    player_id: int
    names: set[str]
    surnames: set[str]
    club_seasons: set[tuple[str, int]]
    jumpers: set[str]
    #: (club slug, season) -> guernseys worn in that stint, for the second rule.
    jumpers_by: dict[tuple[str, int], set[str]] = field(default_factory=dict)


@dataclass
class Match:
    provider_id: str
    status: str                       # mapped | unmatched | ambiguous
    player_id: int | None = None
    candidates: list[int] = field(default_factory=list)
    jumper_corroborated: bool | None = None
    method: str | None = None         # name_club_season | surname_club_season_jumper


def reconcile(listed: dict[str, Listed], canonical: list[Canonical]) -> list[Match]:
    """providerId -> at most one player, by two fact rules, fail-closed.

    Rule 1: same normalised name AND a shared (club, season).
    Rule 2 (only when rule 1 finds nobody): same surname AND, in a shared
    (club, season), the same guernsey. The API prints formal given names
    ("Timothy", "Mitchell") where AFL Tables prints the name the player
    goes by ("Tim", "Mitch"); club + season + guernsey are exact facts on
    both sides, so the given name is not needed to identify the person.
    Several candidates under either rule -> ambiguous; never a choice.
    """
    by_name: dict[str, list[Canonical]] = defaultdict(list)
    by_surname: dict[str, list[Canonical]] = defaultdict(list)
    for c in canonical:
        for n in c.names:
            by_name[n].append(c)
        for n in c.surnames:
            by_surname[n].append(c)
    out: list[Match] = []
    for pid, item in listed.items():
        cands: dict[int, Canonical] = {}
        for n in item.names:
            for c in by_name.get(n, []):
                if c.club_seasons & item.club_seasons:
                    cands[c.player_id] = c
        method = "name_club_season"
        if not cands:
            method = "surname_club_season_jumper"
            for surname in item.surnames:
                for c in by_surname.get(surname, []):
                    for (slug, season) in c.club_seasons & item.club_seasons:
                        j = item.jumpers.get(season)
                        if j is not None and j in c.jumpers_by.get((slug, season), set()):
                            cands[c.player_id] = c
        if len(cands) == 1:
            (c,) = cands.values()
            js = set(item.jumpers.values())
            out.append(Match(pid, "mapped", c.player_id, [c.player_id],
                             (bool(js & c.jumpers) if js and c.jumpers else None), method))
        elif cands:
            out.append(Match(pid, "ambiguous", None, sorted(cands), method=method))
        else:
            out.append(Match(pid, "unmatched"))
    return out


# --------------------------------------------------------------------------
# Snapshot access, manifest-verified
# --------------------------------------------------------------------------


def load_manifest(label: str) -> dict:
    path = MANIFEST_ROOT / f"{label}.json"
    if not path.is_file():
        sys.exit(f"ERROR: no tracked manifest for label {label!r} at {path}")
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def verified_files(label: str, snapshot_dir: Path) -> list[tuple[int, Path]]:
    manifest = load_manifest(label)
    entries = [e for e in manifest.get("files", []) if e.get("dataset") == "roster"]
    if not entries:
        sys.exit(f"ERROR: manifest {label!r} lists no roster files")
    out: list[tuple[int, Path]] = []
    for entry in entries:
        path = snapshot_dir / entry["filename"]
        if not path.is_file():
            sys.exit(f"ERROR: {label}: {entry['filename']} is missing from {snapshot_dir}")
        digest = sha256_file(path)
        if digest != entry.get("sha256"):
            sys.exit(f"ERROR: {label}: {entry['filename']} sha256 {digest[:12]}… does not "
                     f"match the tracked manifest ({str(entry.get('sha256'))[:12]}…)")
        out.append((int(entry["season"]), path))
    return sorted(out)


def iter_rows(files: list[tuple[int, Path]]):
    for _season, path in files:
        with path.open(encoding="utf-8") as fh:
            yield from json.load(fh)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record AFL API season-roster heights in player_height_evidence "
                    "(corroborating source; never writes players.height_cm).")
    parser.add_argument("--label", required=True, help="Tracked roster snapshot label.")
    parser.add_argument("--snapshot-dir", type=Path, default=None,
                        help=f"Directory override (default {SNAPSHOT_ROOT}/<label>).")
    parser.add_argument("--validate-only", action="store_true",
                        help="Verify the manifest and artefacts offline; touch no database.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Reconcile and report against the database; write nothing.")
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--disagreements", type=Path, default=None,
                        help="Height-oracle disagreement list (afldb_id, afltables, bound) "
                             "to adjudicate in the report.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB height evidence (AFL API season rosters)")
    snapshot_dir = args.snapshot_dir or (SNAPSHOT_ROOT / args.label)
    if not snapshot_dir.is_dir():
        sys.exit(f"ERROR: snapshot directory for {args.label!r} not found: {snapshot_dir}")
    files = verified_files(args.label, snapshot_dir)
    rep.step(f"{args.label}: {len(files)} season artefacts verified "
             f"({files[0][0]}-{files[-1][0]})")
    if args.validate_only:
        print(f"  done (validate only) in {time.time() - started:.1f}s")
        return 0

    listed = fold_rows(iter_rows(files))
    rep.result("distinct providerIds", len(listed))
    rep.result("providerIds with at least one height",
               sum(1 for x in listed.values() if any(h is not None for h in x.heights.values())))

    load_env()
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    pg = connect_pg(dsn)

    with pg.cursor() as cur:
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
        source_id = cur.fetchone()[0]
        cur.execute("SELECT id, display_name, given_name, surname, height_cm FROM players")
        prow = cur.fetchall()
        cur.execute(
            """SELECT s.player_id, o.slug, m.season, s.jumper_number
                 FROM player_match_stats s
                 JOIN matches m ON m.id = s.match_id
                 JOIN clubs c ON c.id = s.club_id
                 JOIN club_organizations o ON o.id = c.organization_id
                WHERE m.season >= %s""", (files[0][0],))
        facts: dict[int, tuple[set, set, dict]] = defaultdict(lambda: (set(), set(), {}))
        for pid, slug, season, jumper in cur.fetchall():
            facts[pid][0].add((slug, season))
            if jumper is not None:
                facts[pid][1].add(str(jumper))
                facts[pid][2].setdefault((slug, season), set()).add(str(jumper))
    canonical = []
    current: dict[int, int | None] = {}
    for pid, display, given, surname, height in prow:
        current[pid] = height
        if pid not in facts:
            continue
        names = {normalise_name(display or ""), normalise_name(f"{given or ''} {surname or ''}")}
        names.discard("")
        surnames = {normalise_name(surname or "")} - {""}
        canonical.append(Canonical(pid, names, surnames, facts[pid][0], facts[pid][1], facts[pid][2]))
    rep.step(f"canonical players with a match since {files[0][0]}: {len(canonical):,}")

    matches = reconcile(listed, canonical)
    by_status = Counter(m.status for m in matches)
    for s in ("mapped", "unmatched", "ambiguous"):
        rep.result(s, by_status.get(s, 0))
    by_method = Counter(m.method for m in matches if m.status == "mapped")
    rep.result("  by name + (club, season)", by_method.get("name_club_season", 0))
    rep.result("  by surname + (club, season) + guernsey",
               by_method.get("surname_club_season_jumper", 0))
    corroborated = [m for m in matches if m.jumper_corroborated is not None]
    rep.result("jumper corroboration checked", len(corroborated),
               f"{sum(1 for m in corroborated if not m.jumper_corroborated):,} disagree")
    mapped_players = Counter(m.player_id for m in matches if m.status == "mapped")
    dup_players = {p for p, n in mapped_players.items() if n > 1}
    if dup_players:
        # Two providerIds cannot be one person; refuse the lot rather than pick.
        for m in matches:
            if m.player_id in dup_players:
                m.status, m.candidates, m.player_id = "ambiguous", [m.player_id], None
        rep.result("players claimed by two providerIds (both refused)", len(dup_players))

    # Per player: distinct listed heights with the seasons asserting each.
    asserted: dict[int, dict[int, list[int]]] = defaultdict(lambda: defaultdict(list))
    provider_of: dict[int, str] = {}
    for m in matches:
        if m.status != "mapped":
            continue
        provider_of[m.player_id] = m.provider_id
        for season, h in sorted(listed[m.provider_id].heights.items()):
            if h is not None:
                asserted[m.player_id][h].append(season)

    # Comparison with the canonical (AFL Tables) value.
    latest_agree = any_agree = differ = no_canonical = 0
    deltas: Counter = Counter()
    varying = 0
    for pid, heights in asserted.items():
        latest = max(((max(s), h) for h, s in heights.items()))[1]
        canon = current.get(pid)
        if len(heights) > 1:
            varying += 1
        if canon is None:
            no_canonical += 1
        elif latest == canon:
            latest_agree += 1
        elif canon in heights:
            any_agree += 1
        else:
            differ += 1
            deltas[latest - canon] += 1
    rep.step("against the canonical (AFL Tables) height")
    rep.result("players with AFL API height evidence", len(asserted))
    rep.result("latest listed height == canonical", latest_agree)
    rep.result("an earlier listed height == canonical", any_agree)
    rep.result("no listed season agrees", differ, f"deltas {dict(sorted(deltas.items()))}")
    rep.result("canonical height NULL (reported, not filled)", no_canonical)
    rep.result("players whose listed height varies across seasons", varying)

    summary: dict[str, Any] = {
        "label": args.label, "seasons": [s for s, _ in files],
        "provider_ids": len(listed), "mapped": by_status.get("mapped", 0) - sum(
            1 for m in matches if m.status == "ambiguous" and len(m.candidates) == 1),
        "unmatched": by_status.get("unmatched", 0),
        "mapped_by_method": dict(by_method),
        "ambiguous": sum(1 for m in matches if m.status == "ambiguous"),
        "players_with_evidence": len(asserted), "latest_agrees": latest_agree,
        "earlier_agrees": any_agree, "differs": differ,
        "deltas": {str(k): v for k, v in sorted(deltas.items())},
        "canonical_null": no_canonical, "varying_across_seasons": varying,
        "dry_run": bool(args.dry_run),
    }

    adjudication = []
    if args.disagreements:
        # Which players in the oracle's disagreement list the API can speak to.
        for d in json.loads(args.disagreements.read_text(encoding="utf-8")):
            pid = int(d["afldb_id"])
            heights = asserted.get(pid)
            bound = d["bound"]
            m = re.fullmatch(r"height_(min|max)\((\d+)\)", bound)
            kind, cm = m.group(1), int(m.group(2))
            satisfies = (lambda h: h >= cm) if kind == "min" else (lambda h: h <= cm)
            # kind FN: Gridley lists the player (says the bound holds), AFLDB omits;
            # kind FP: Gridley omits, AFLDB lists. "Gridley's side" is relative to that.
            gridley_says = d.get("kind", "FN") == "FN"
            entry = {**d, "afl_api": None, "verdict": "AFL API unavailable"}
            if heights:
                by_season = {s: h for h, ss in heights.items() for s in ss}
                latest = by_season[max(by_season)]
                api_eq_tables = latest == d["afltables"]
                api_meets_gridley = satisfies(latest) == gridley_says
                any_meets_gridley = any(satisfies(h) == gridley_says for h in heights)
                entry["afl_api"] = {"by_season": dict(sorted(by_season.items())), "latest": latest}
                entry["afl_api_equals_afltables"] = api_eq_tables
                entry["afl_api_latest_on_gridley_side"] = api_meets_gridley
                entry["afl_api_any_season_on_gridley_side"] = any_meets_gridley
                if api_eq_tables and not any_meets_gridley:
                    entry["verdict"] = "AFL API == AFL Tables; Gridley alone"
                elif api_eq_tables and any_meets_gridley:
                    entry["verdict"] = "AFL API latest == AFL Tables; an earlier season met Gridley's bound"
                elif api_meets_gridley:
                    entry["verdict"] = "AFL API == Gridley; AFL Tables alone"
                else:
                    entry["verdict"] = "all three differ"
            adjudication.append(entry)
        verdicts = Counter(e["verdict"] for e in adjudication)
        rep.step(f"disagreement adjudication over {len(adjudication)} players")
        for v, n in verdicts.most_common():
            rep.result(v, n)
        summary["adjudication"] = dict(verdicts)

    if args.report:
        report = {
            **summary,
            "not_mapped": [{"provider_id": m.provider_id, "status": m.status, "method": m.method,
                            "names": sorted(listed[m.provider_id].raw_names),
                            "club_seasons": sorted(listed[m.provider_id].club_seasons),
                            "candidates": m.candidates}
                           for m in matches if m.status != "mapped"],
            "jumper_disagreements": [m.provider_id for m in corroborated if not m.jumper_corroborated],
            "mapped_rows": [{"provider_id": m.provider_id, "player_id": m.player_id, "method": m.method}
                       for m in matches if m.status == "mapped"],
            "differs": [{"player_id": pid, "canonical": current.get(pid),
                         "afl_api": {str(h): s for h, s in asserted[pid].items()}}
                        for pid in asserted
                        if current.get(pid) is not None and current[pid] not in asserted[pid]],
            "canonical_null": [{"player_id": pid, "afl_api": {str(h): s for h, s in asserted[pid].items()}}
                               for pid in asserted if current.get(pid) is None],
            "adjudication": adjudication,
        }
        args.report.write_text(json.dumps(report, indent=1), encoding="utf-8")
        rep.step(f"report written to {args.report}")

    if args.dry_run:
        print(f"  done (dry run) in {time.time() - started:.1f}s")
        return 0

    with import_batch(pg, SOURCE_KEY, TOOL, "player_height_evidence") as batch:
        batch.records_read = len(listed)
        rows = []
        for pid, heights in asserted.items():
            for h, seasons in sorted(heights.items()):
                rows.append((pid, source_id, provider_of[pid], h, EVIDENCE_TYPE, "sourced",
                             len(seasons), batch.id,
                             f"AFL API season roster, snapshot {args.label}; listed "
                             f"{h}cm in {', '.join(map(str, seasons))}; identity via "
                             "name + shared (club, season) match facts -> providerId."))
        with pg.cursor() as cur:
            cur.executemany(
                """INSERT INTO player_height_evidence
                     (player_id, source_id, external_id, height_cm, evidence_type,
                      confidence, occurrences, batch_id, notes)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (player_id, source_id, height_cm) DO UPDATE
                     SET occurrences = EXCLUDED.occurrences, notes = EXCLUDED.notes,
                         batch_id = EXCLUDED.batch_id, observed_at = now()""",
                rows)
        batch.records_inserted += len(rows)
        for m in matches:
            if m.status != "mapped":
                batch.reject(m.provider_id, f"identity {m.status}",
                             {"names": sorted(listed[m.provider_id].raw_names),
                              "club_seasons": sorted(listed[m.provider_id].club_seasons),
                              "candidates": m.candidates})
    with pg.cursor() as cur:
        cur.execute("UPDATE import_batches SET validation_result = %s WHERE id = %s",
                    (json.dumps(summary), batch.id))
    pg.commit()
    print(f"  batch {batch.id}: evidence rows {len(rows):,} over {len(asserted):,} players; "
          f"done in {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
