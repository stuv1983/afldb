#!/usr/bin/env python3
"""Load player heights from the acquired AFL Tables player_details register.

    python tools/migration/enrich_heights.py --label full-history-20260902 \
        --supplement-label issue129-t7-20260903 --dry-run --report heights.json
    python tools/migration/enrich_heights.py --label full-history-20260902 \
        --supplement-label issue129-t7-20260903

Why this exists (AFLDB-ISSUE-118 Stage H2)
------------------------------------------
players.height_cm has been NULL for every player on every environment.
The fitzRoy core snapshot already holds the AFL Tables per-club player
register (player_details.csv: Player, Team, Cap, #, HT, WT, Games, ...,
Seasons) with a height for 95% of its rows, but import_fitzroy_core.py
deliberately leaves it alone: the register carries no stable id, so it
cannot be loaded blind.

How a register row is identified
--------------------------------
The SAME snapshot's player_stats files carry, for every match row, the
AFL Tables profile URL that external_identities stores as the canonical
AFL Tables identity (match_method 'afltables_profile_url'). Aggregating
those rows per (profile URL, club) yields exactly the facts the register
prints per (player, club): games, goals, the set of seasons, and the
source's own spelling of the name. A register row is mapped when

  * exactly one (URL, club) aggregate has the same club, the same games,
    the same goals and the same season set, AND
  * the register's name, normalised, equals that aggregate's name
    (first + surname, or the Player column) as the source itself spells
    it.

Every signal comes from AFL Tables on both sides, so nothing is fuzzy
and nothing is matched against AFLDB by name: the URL is looked up in
external_identities and that is the only bridge to players.id. Zero
candidates, two or more candidates, or a unique fact match whose name
is spelled differently on the two pages all FAIL CLOSED and land in
import_rejections with the full source row.

The register was captured on 2026-09-02 and its current players' games
include the 2026 season, which the full-history snapshot stops before.
The tracked in-season snapshot(s) named with --supplement-label supply
the 2026 rows; without them every current player is an honest
"unmatched", never a guess.

What it will and will not do
----------------------------
  * Verifies every file it reads against the tracked manifest sha256
    before touching the database.
  * Records every mapped height in player_height_evidence (migration
    086), including the ones it does not act on.
  * Fills only MISSING heights. An existing value is never overwritten;
    a disagreement with an existing value opens a data_issue.
  * Two different heights for one canonical player (across club rows)
    are both kept as evidence, nobody is filled, and a data_issue is
    opened. Nothing is averaged or preferred.
  * Unknown stays NULL. Bad or ambiguous identity never writes.

Safe to re-run: evidence is upserted on (player_id, source_id,
height_cm), the fill step only touches rows that are still NULL, and an
open data_issue is not duplicated.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (  # noqa: E402
    Reporter, connect_pg, import_batch, load_env, require_env, safe_dsn,
)
from import_fitzroy_core import normalise_profile_url, sha256_file  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_ROOT = REPO_ROOT / "data" / "sources" / "afltables" / "fitzroy_core"
MANIFEST_ROOT = REPO_ROOT / "docs" / "rebuild-manifests" / "afltables_fitzroy_core"

SOURCE_KEY = "afltables"
MATCH_METHOD = "afltables_profile_url"
EVIDENCE_TYPE = "afltables_player_details_register"
ISSUE_TYPE = "height_conflict"
TOOL = "enrich_heights.py"

#: player_stats `Playing.for` spellings that the register folds into one
#: club page. Every other name must appear in the register verbatim.
TEAM_ALIASES = {
    "Footscray": "Western Bulldogs",
    "Kangaroos": "North Melbourne",
    "South Melbourne": "Sydney",
    "Greater Western Sydney": "GWS",
}

HEIGHT_MIN, HEIGHT_MAX = 120, 230


# --------------------------------------------------------------------------
# Pure parsing / reconciliation (no database, no filesystem)
# --------------------------------------------------------------------------


def normalise_name(text: str) -> str:
    """Lower-case, unaccented, punctuation-free, single-spaced."""
    text = unicodedata.normalize("NFKD", text or "")
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def parse_seasons(raw: str | None) -> frozenset[int]:
    """`1991-1993,  1996` -> {1991, 1992, 1993, 1996}. Malformed -> empty."""
    out: set[int] = set()
    for part in (raw or "").split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d{4})(?:-(\d{4}))?", part)
        if not m:
            return frozenset()
        lo = int(m.group(1))
        hi = int(m.group(2) or lo)
        if hi < lo:
            return frozenset()
        out.update(range(lo, hi + 1))
    return frozenset(out)


def parse_height(raw: str | None) -> int | None:
    """`178cm` -> 178. Blank or implausible -> None (never a guess)."""
    m = re.fullmatch(r"\s*(\d{2,3})\s*cm\s*", raw or "")
    if not m:
        return None
    value = int(m.group(1))
    return value if HEIGHT_MIN <= value <= HEIGHT_MAX else None


def parse_int(raw: str | None) -> int:
    raw = (raw or "").strip()
    return int(raw) if raw else 0


@dataclass
class Aggregate:
    """One (profile URL, register club) as the per-match rows describe it."""

    url: str
    team: str
    games: int = 0
    goals: int = 0
    seasons: set[int] = field(default_factory=set)
    jumpers: set[str] = field(default_factory=set)
    names: set[str] = field(default_factory=set)

    @property
    def fact_key(self) -> tuple:
        return (self.team, self.games, self.goals, frozenset(self.seasons))


def aggregate_stats(rows: Any, register_teams: set[str]) -> dict[tuple[str, str], Aggregate]:
    """Fold player_stats rows into (url, club) aggregates.

    Fails closed on a `Playing.for` the register does not know, and on a
    row without a profile URL (the identity the whole join rests on).
    """
    aggregates: dict[tuple[str, str], Aggregate] = {}
    for row in rows:
        url = (row.get("url") or "").strip()
        if not url:
            raise ValueError("player_stats row without a profile url: "
                             f"{row.get('Season')} {row.get('Player')!r}")
        playing_for = (row.get("Playing.for") or "").strip()
        team = TEAM_ALIASES.get(playing_for, playing_for)
        if team not in register_teams:
            raise ValueError(f"player_stats club {playing_for!r} is not a register club")
        agg = aggregates.get((url, team))
        if agg is None:
            agg = aggregates[(url, team)] = Aggregate(url=url, team=team)
        agg.games += 1
        agg.goals += parse_int(row.get("Goals"))
        agg.seasons.add(int(row["Season"]))
        jumper = (row.get("Jumper.No.") or "").strip()
        if jumper:
            agg.jumpers.add(jumper)
        agg.names.add(normalise_name(f"{row.get('First.name', '')} {row.get('Surname', '')}"))
        agg.names.add(normalise_name(row.get("Player") or ""))
        agg.names.discard("")
    return aggregates


@dataclass
class RowResult:
    """One register row's fate on the source side."""

    row: dict
    status: str            # mapped | unmatched | ambiguous | name_mismatch
    url: str | None = None
    height_cm: int | None = None
    candidates: list[str] = field(default_factory=list)
    jumper_corroborated: bool | None = None

    @property
    def record_id(self) -> str:
        return f"{self.row.get('Team')}/{self.row.get('Cap')}"


def reconcile(register_rows: list[dict],
              aggregates: dict[tuple[str, str], Aggregate]) -> list[RowResult]:
    """Map every register row to at most one profile URL, fail-closed."""
    by_fact: dict[tuple, list[Aggregate]] = defaultdict(list)
    for agg in aggregates.values():
        by_fact[agg.fact_key].append(agg)

    results: list[RowResult] = []
    for row in register_rows:
        key = ((row.get("Team") or "").strip(), parse_int(row.get("Games")),
               parse_int(row.get("Goals")), parse_seasons(row.get("Seasons")))
        height = parse_height(row.get("HT"))
        candidates = by_fact.get(key, []) if key[3] else []
        name = normalise_name(row.get("Player") or "")
        named = [c for c in candidates if name and name in c.names]
        if len(named) == 1:
            agg = named[0]
            jumpers = {j.strip() for j in (row.get("#") or "").split(",") if j.strip()}
            results.append(RowResult(
                row=row, status="mapped", url=agg.url, height_cm=height,
                candidates=[agg.url],
                jumper_corroborated=(bool(jumpers & agg.jumpers) if jumpers and agg.jumpers
                                     else None)))
        elif len(named) > 1:
            results.append(RowResult(row=row, status="ambiguous", height_cm=height,
                                     candidates=[c.url for c in named]))
        elif candidates:
            results.append(RowResult(row=row, status="name_mismatch", height_cm=height,
                                     candidates=[c.url for c in candidates]))
        else:
            results.append(RowResult(row=row, status="unmatched", height_cm=height))
    return results


def heights_by_url(results: list[RowResult]) -> dict[str, Counter]:
    """Profile URL -> {height_cm: occurrences} over the mapped rows with a height."""
    out: dict[str, Counter] = defaultdict(Counter)
    for r in results:
        if r.status == "mapped" and r.url and r.height_cm is not None:
            out[r.url][r.height_cm] += 1
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


def verified_files(label: str, snapshot_dir: Path, dataset: str) -> list[Path]:
    """Every manifest file of `dataset`, present on disk and sha256-matched."""
    manifest = load_manifest(label)
    entries = [e for e in manifest.get("files", []) if e.get("dataset") == dataset]
    if not entries:
        sys.exit(f"ERROR: manifest {label!r} lists no {dataset} files")
    paths: list[Path] = []
    for entry in entries:
        path = snapshot_dir / entry["filename"]
        if not path.is_file():
            sys.exit(f"ERROR: {label}: {entry['filename']} is missing from {snapshot_dir}")
        digest = sha256_file(path)
        if digest != entry.get("sha256"):
            sys.exit(f"ERROR: {label}: {entry['filename']} sha256 {digest[:12]}… does not "
                     f"match the tracked manifest ({str(entry.get('sha256'))[:12]}…)")
        paths.append(path)
    return paths


def read_csv(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def iter_csvs(paths: list[Path]):
    for path in paths:
        with path.open(newline="", encoding="utf-8") as fh:
            yield from csv.DictReader(fh)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Load AFL Tables register heights into players.height_cm "
                    "through player_height_evidence, identity fail-closed.")
    parser.add_argument("--label", required=True,
                        help="Tracked full-history snapshot label holding player_details.csv "
                             "and the per-season player_stats files.")
    parser.add_argument("--supplement-label", action="append", default=[],
                        help="Tracked in-season snapshot label(s) whose player_stats rows "
                             "extend the full-history rows (repeatable).")
    parser.add_argument("--snapshot-dir", action="append", default=[], metavar="LABEL=PATH",
                        help=f"Directory override for a label (default {SNAPSHOT_ROOT}/<label>).")
    parser.add_argument("--validate-only", action="store_true",
                        help="Verify the manifests and every artefact's sha256 offline; "
                             "touch no database (the rebuild precheck).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Reconcile and report against the database; write nothing.")
    parser.add_argument("--report", type=Path, default=None,
                        help="Write the full JSON report (counts and every non-mapped row) here.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    overrides: dict[str, Path] = {}
    for item in args.snapshot_dir:
        label, _, path = item.partition("=")
        if not label or not path:
            sys.exit(f"ERROR: --snapshot-dir expects LABEL=PATH, got {item!r}")
        overrides[label] = Path(path)

    def snapshot_dir(label: str) -> Path:
        path = overrides.get(label, SNAPSHOT_ROOT / label)
        if not path.is_dir():
            sys.exit(f"ERROR: snapshot directory for {label!r} not found: {path}")
        return path

    rep = Reporter(verbose=not args.quiet)
    started = time.time()
    print("AFLDB height enrichment (AFL Tables player_details register)")

    # ---- Source side: manifest-verified reads, then the reconciliation.
    base_dir = snapshot_dir(args.label)
    details_path = verified_files(args.label, base_dir, "player_details")
    if len(details_path) != 1:
        sys.exit(f"ERROR: expected one player_details file in {args.label}, found {len(details_path)}")
    register = read_csv(details_path[0])
    register_teams = {(r.get("Team") or "").strip() for r in register}
    stats_paths = verified_files(args.label, base_dir, "player_stats")
    stats_files = {args.label: len(stats_paths)}
    for label in args.supplement_label:
        extra = verified_files(label, snapshot_dir(label), "player_stats")
        stats_paths.extend(extra)
        stats_files[label] = len(extra)
    rep.step(f"register {args.label}: {len(register):,} rows, "
             f"{sum(1 for r in register if parse_height(r.get('HT')) is not None):,} with a height")
    rep.step("player_stats files verified: "
             + ", ".join(f"{k} ({v})" for k, v in stats_files.items()))
    if args.validate_only:
        print(f"  done (validate only) in {time.time() - started:.1f}s")
        return 0

    aggregates = aggregate_stats(iter_csvs(stats_paths), register_teams)
    results = reconcile(register, aggregates)
    by_status = Counter(r.status for r in results)
    per_url = heights_by_url(results)
    source_conflicts = {u: c for u, c in per_url.items() if len(c) > 1}
    jumper_checked = [r for r in results if r.jumper_corroborated is not None]
    rep.step(f"aggregates {len(aggregates):,} (url, club) pairs")
    for status in ("mapped", "unmatched", "ambiguous", "name_mismatch"):
        rep.result(status, by_status.get(status, 0))
    rep.result("mapped rows with a height", sum(1 for r in results
                                               if r.status == "mapped" and r.height_cm is not None))
    rep.result("distinct profile urls with a height", len(per_url))
    rep.result("urls asserting two heights", len(source_conflicts))
    rep.result("jumper corroboration checked", len(jumper_checked),
               f"{sum(1 for r in jumper_checked if not r.jumper_corroborated):,} disagree "
               "(informational: the register prints one guernsey, the match rows several)")

    # ---- Database side.
    load_env()
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    pg = connect_pg(dsn)

    with pg.cursor() as cur:
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
        source_id = cur.fetchone()[0]
        cur.execute(
            """SELECT external_id, player_id FROM external_identities
                WHERE source_id = %s AND match_method = %s
                  AND status IN ('unique', 'resolved') AND player_id IS NOT NULL""",
            (source_id, MATCH_METHOD))
        player_by_path = dict(cur.fetchall())
        cur.execute("SELECT id, height_cm, height_evidence_id FROM players")
        current = {pid: (h, eid) for pid, h, eid in cur.fetchall()}

    # Profile URL -> canonical player, then per-player height agreement.
    asserted: dict[int, Counter] = defaultdict(Counter)   # player_id -> {height: occ}
    path_of: dict[int, str] = {}
    no_canonical: list[RowResult] = []
    for r in results:
        if r.status != "mapped" or r.url is None:
            continue
        path = normalise_profile_url(r.url)
        pid = player_by_path.get(path)
        if pid is None:
            no_canonical.append(r)
            continue
        if r.height_cm is not None:
            asserted[pid][r.height_cm] += 1
            path_of[pid] = path

    fills: list[tuple[int, int]] = []          # (player_id, height)
    agreements = 0
    existing_conflicts: list[tuple[int, int, int]] = []   # pid, existing, asserted
    internal_conflicts: list[tuple[int, dict[int, int]]] = []
    for pid, heights in asserted.items():
        if len(heights) > 1:
            internal_conflicts.append((pid, dict(heights)))
            continue
        (height, _occ), = heights.items()
        existing, _eid = current.get(pid, (None, None))
        if existing is None:
            fills.append((pid, height))
        elif existing == height:
            agreements += 1
        else:
            existing_conflicts.append((pid, existing, height))

    rep.step("canonical side")
    rep.result("mapped rows with no canonical player", len(no_canonical),
               "(profile url not in external_identities on this database)")
    rep.result("canonical players receiving height", len(fills))
    rep.result("already present and agreeing", agreements)
    rep.result("disagree with the existing value", len(existing_conflicts), "(kept, data_issue)")
    rep.result("two heights for one player", len(internal_conflicts), "(no fill, data_issue)")

    summary: dict[str, Any] = {
        "label": args.label, "supplement_labels": args.supplement_label,
        "source_rows": len(results),
        "source_rows_with_height": sum(1 for r in results if r.height_cm is not None),
        "mapped": by_status.get("mapped", 0),
        "unmatched": by_status.get("unmatched", 0),
        "ambiguous": by_status.get("ambiguous", 0),
        "name_mismatch": by_status.get("name_mismatch", 0),
        "distinct_urls_with_height": len(per_url),
        "url_height_conflicts": len(source_conflicts),
        "jumper_checked": len(jumper_checked),
        "jumper_disagree": sum(1 for r in jumper_checked if not r.jumper_corroborated),
        "no_canonical_player": len(no_canonical),
        "players_asserted": len(asserted),
        "players_filled": len(fills),
        "players_agreeing": agreements,
        "players_existing_conflict": len(existing_conflicts),
        "players_internal_conflict": len(internal_conflicts),
        "dry_run": bool(args.dry_run),
    }

    if args.report:
        def row_out(r: RowResult) -> dict:
            return {"status": r.status, "record": r.record_id, "player": r.row.get("Player"),
                    "team": r.row.get("Team"), "seasons": r.row.get("Seasons"),
                    "games": r.row.get("Games"), "goals": r.row.get("Goals"),
                    "ht": r.row.get("HT"), "candidates": r.candidates}
        report = {
            **summary,
            "not_mapped": [row_out(r) for r in results if r.status != "mapped"],
            "no_canonical_player_rows": [row_out(r) for r in no_canonical],
            "jumper_disagreements": [row_out(r) for r in jumper_checked if not r.jumper_corroborated],
            "internal_conflicts": [{"player_id": pid, "heights": h} for pid, h in internal_conflicts],
            "existing_conflicts": [{"player_id": pid, "existing": e, "asserted": a}
                                   for pid, e, a in existing_conflicts],
            # The planned fills, so the Gridley height oracle can measure
            # coverage before anything is written (AFLDB_HEIGHT_PLANNED).
            "fills": sorted(fills),
        }
        args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
        rep.step(f"report written to {args.report}")

    if args.dry_run:
        print(f"  done (dry run) in {time.time() - started:.1f}s")
        return 0

    # ---- Writes: one batch, one transaction.
    with import_batch(pg, SOURCE_KEY, TOOL, "players") as batch:
        batch.records_read = len(results)
        with pg.cursor() as cur:
            # Every mapped height is evidence, conflicting ones included.
            evidence_rows = []
            for pid, heights in asserted.items():
                for height, occ in sorted(heights.items()):
                    evidence_rows.append((
                        pid, source_id, path_of[pid], height, EVIDENCE_TYPE, "sourced",
                        occ, batch.id,
                        f"AFL Tables player_details register, snapshot {args.label}"
                        + (f" + {', '.join(args.supplement_label)}" if args.supplement_label else "")
                        + "; identity via the snapshot's own per-match rows "
                          "(club, games, goals, season set, name) -> profile url."))
            cur.executemany(
                """INSERT INTO player_height_evidence
                     (player_id, source_id, external_id, height_cm, evidence_type,
                      confidence, occurrences, batch_id, notes)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (player_id, source_id, height_cm) DO UPDATE
                     SET occurrences = EXCLUDED.occurrences,
                         batch_id    = EXCLUDED.batch_id,
                         observed_at = now()""",
                evidence_rows)
            batch.records_inserted += len(evidence_rows)

            # Fill only what is still NULL, from single-valued evidence.
            cur.executemany(
                """UPDATE players p
                      SET height_cm = e.height_cm, height_evidence_id = e.id
                     FROM player_height_evidence e
                    WHERE p.id = %s AND p.height_cm IS NULL
                      AND e.player_id = p.id AND e.source_id = %s AND e.height_cm = %s""",
                [(pid, source_id, height) for pid, height in fills])
            batch.records_updated += len(fills)

            # Conflicts: open once, never duplicated while still open.
            issues = []
            for pid, heights in internal_conflicts:
                issues.append((pid, "AFL Tables register asserts two heights for one player; "
                                    "not filled.",
                               json.dumps({"asserted": heights, "external_id": path_of[pid],
                                           "batch_id": batch.id})))
            for pid, existing, height in existing_conflicts:
                issues.append((pid, f"AFL Tables register height {height}cm disagrees with the "
                                    f"existing {existing}cm; existing value kept.",
                               json.dumps({"existing": existing, "asserted": height,
                                           "external_id": path_of[pid], "batch_id": batch.id})))
            cur.executemany(
                """INSERT INTO data_issues (entity_type, entity_id, issue_type, severity,
                                            description, details)
                   SELECT 'player', %s, %s, 'warning', %s, %s::jsonb
                    WHERE NOT EXISTS (SELECT 1 FROM data_issues
                                       WHERE entity_type = 'player' AND entity_id = %s
                                         AND issue_type = %s AND resolved_at IS NULL)""",
                [(pid, ISSUE_TYPE, desc, details, pid, ISSUE_TYPE) for pid, desc, details in issues])

        for r in results:
            if r.status != "mapped":
                batch.reject(r.record_id, f"identity {r.status}: "
                             + {"unmatched": "no (url, club) aggregate with these games/goals/seasons",
                                "ambiguous": "several aggregates share the facts and the name",
                                "name_mismatch": "facts match one profile whose name is spelled "
                                                 "differently"}[r.status],
                             {**r.row, "candidates": r.candidates})
        for r in no_canonical:
            batch.reject(r.record_id, "no canonical player for this profile url on this database",
                         {**r.row, "url": r.url})
        rejected = sum(1 for r in results if r.status != "mapped") + len(no_canonical)
    # The context manager has committed the batch as completed; keep the
    # counters with it, the way settle stores its evidence (ISSUE-131).
    with pg.cursor() as cur:
        cur.execute("UPDATE import_batches SET validation_result = %s WHERE id = %s",
                    (json.dumps(summary), batch.id))
    pg.commit()
    print(f"  batch {batch.id}: filled {len(fills):,}, evidence rows {len(evidence_rows):,}, "
          f"rejections {rejected:,}; done in {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
