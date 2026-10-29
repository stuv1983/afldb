#!/usr/bin/env python3
"""Coaches and match coaching assignments from the accepted AFL Tables sources.

    python tools/migration/import_match_coaches.py --label coaches-20260905 \\
        --fitzroy-label full-history-20260902 --supplement-label issue129-t7-20260903 --validate-only
    python tools/migration/import_match_coaches.py --label ... --fitzroy-label ... --dry-run
    python tools/migration/import_match_coaches.py --label ... --fitzroy-label ...

AFLDB-ISSUE-118 Stage E2 (runbook §23.27). Two accepted, manifest-pinned sources:

  * the fitzRoy / AFL Tables baseline named by ``--fitzroy-label`` (plus any pinned
    in-season ``--supplement-label``): every ``player_stats_<season>.csv`` carries a
    per-match ``Coach`` column, "Surname, Given", exactly one string per (match,
    club) — the ASSIGNMENT;
  * the AFL Tables coaches snapshot named by ``--label`` (``acquire_coaches.py``;
    tracked manifest ``docs/rebuild-manifests/afltables_coaches/<label>.json``,
    tracked parsed artefacts under ``data/sources/afltables/coaches/<label>/parsed/``):
    one index row and one page per PERSON who coached — the IDENTITY. Where a page
    links a "Player Stats" profile, that path is the ``players/<L>/<Name>.html``
    identity ``external_identities`` already holds.

What it does, fail-closed at every join:

  * verifies every artefact it reads against its tracked manifest (``--validate-only``
    stops here, offline, for the rebuild's preflight);
  * with ``--require-raw-bundle`` (AFLDB-ISSUE-319; the rebuild passes it for every profile
    except the predecessor), replays the contract-pinned raw bundle in memory through the
    acquisition's own parser (``tools/rebuild/afltables/coach_snapshot_parser.py``) and
    refuses unless the rendered bytes equal the manifest digests and the very bytes it loads;
  * folds the per-match rows to one coach string per (match_key, club); two strings
    for one (match, club) is a refusal;
  * resolves each string to exactly one index ``name_raw`` by EXACT string — an
    unmapped string is a refusal, never a nearest name;
  * resolves each match by ``matches.match_key`` and the club through the canonical
    ``ClubResolver`` (historical identity) — a key that is absent from a season the
    database holds is a refusal; rows of a season the database does not hold at all
    (an in-season supplement beyond a historical baseline) are reported and skipped;
  * links a coach to a player ONLY through the page's profile path and
    ``external_identities`` (source ``afltables``; the fitzRoy contract's continuity
    rules fold a renumbered path). A page whose profile path resolves to no identity
    is a refusal. A page with no profile link is a coach-only person: ``player_id``
    NULL, ``link_status_value`` 'unmatched', and no players row is ever created;
  * upserts ``coaches`` (every index page, whether or not the column names them yet)
    then ``match_coaches`` in one tracked import batch; a rerun rewrites the same rows
    and removes assignments this source no longer asserts.

Nothing here derives or stores a coaching total: games, W/D/L, finals and
premierships are the canonical ``match_coaches`` ⋈ ``matches``. The coach page's own
Games Coached count is kept on the row as cross-check evidence and reported.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import stat
import sys
import tarfile
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(1, str(Path(__file__).resolve().parents[1] / "rebuild" / "afltables"))

import coach_snapshot_parser  # noqa: E402

from common import connect_pg, import_batch, load_env, replay_admin_overrides, require_env, safe_dsn  # noqa: E402
from enrich_heights import verified_files as verified_fitzroy_files  # noqa: E402
from enrich_heights import SNAPSHOT_ROOT as FITZROY_SNAPSHOT_ROOT  # noqa: E402
from import_fitzroy_core import (  # noqa: E402
    CLUBS_JSON, CONTRACT_PATH as FITZROY_CONTRACT_PATH, ClubResolver, MatchIdentityError,
    SnapshotFile, SnapshotValidationError, iter_player_stats, load_row_corrections,
    normalise_profile_url, normalise_stats_round, parse_dob, parse_iso_date, sha256_file,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT_ROOT = REPO_ROOT / "data" / "sources" / "afltables" / "coaches"
MANIFEST_ROOT = REPO_ROOT / "docs" / "rebuild-manifests" / "afltables_coaches"
CONTRACT_PATH = REPO_ROOT / "tools" / "rebuild" / "afltables" / "afltables-contract.json"
SOURCE_KEY = "afltables"
TOOL = "import_match_coaches.py"


# ----------------------------------------------------------------- sources

def load_manifest(label: str) -> dict:
    path = MANIFEST_ROOT / f"{label}.json"
    if not path.is_file():
        sys.exit(f"ERROR: no tracked manifest for label {label!r} at {path}")
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


# AFLDB-ISSUE-319: bounds on the in-memory raw replay (the accepted bundle is 24,023,040 B, its
# largest member 421,662 B). Exceeding either is a refusal, never a partial read.
RAW_BUNDLE_MAX_BYTES = 64 * 1024 * 1024
RAW_MEMBER_MAX_BYTES = 8 * 1024 * 1024
RAW_BUNDLE_PIN_KEYS = {"filename", "sha256", "bytes", "members"}


class RawReplayRefused(RuntimeError):
    """The raw bundle does not prove the parsed artefacts this process loads: refused, never skipped."""


def raw_bundle_pin(label: str, contract: dict) -> dict:
    """coaches.accepted_snapshot.raw_bundle for exactly this label; anything else refuses."""
    accepted = contract.get("accepted_snapshot")
    if not isinstance(accepted, dict) or accepted.get("label") != label:
        raise RawReplayRefused(f"the contract's accepted coaches snapshot is not {label!r}")
    pin = accepted.get("raw_bundle")
    if not isinstance(pin, dict) or set(pin) - {"$comment"} != RAW_BUNDLE_PIN_KEYS:
        raise RawReplayRefused("coaches.accepted_snapshot.raw_bundle is absent or not exactly "
                               f"{sorted(RAW_BUNDLE_PIN_KEYS)}; raw replay is required and has no pin")
    name, digest = pin["filename"], pin["sha256"]
    # The rebuild's own rule (tools/db/rebuild-test.ts coachRawBundlePin): ^[A-Za-z0-9_][A-Za-z0-9_.-]*\.tar$
    if (not isinstance(name, str) or len(name) < 5 or not name.endswith(".tar")
            or not (name[0].isascii() and (name[0].isalnum() or name[0] == "_"))
            or any(not (ch.isascii() and (ch.isalnum() or ch in "_.-")) for ch in name)):
        raise RawReplayRefused(f"raw_bundle.filename {name!r} is not a plain .tar file name")
    if not isinstance(digest, str) or len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
        raise RawReplayRefused("raw_bundle.sha256 is not 64 lowercase hex characters")
    for key in ("bytes", "members"):
        if type(pin[key]) is not int or pin[key] <= 0:
            raise RawReplayRefused(f"raw_bundle.{key} is not a positive integer")
    if pin["bytes"] > RAW_BUNDLE_MAX_BYTES:
        raise RawReplayRefused(f"raw_bundle.bytes {pin['bytes']} exceeds the replay bound {RAW_BUNDLE_MAX_BYTES}")
    return pin


def read_raw_bundle(path: Path, pin: dict) -> bytes:
    """The pinned bundle's bytes: a regular, unlinked file of exactly the pinned size and digest."""
    try:
        before = os.lstat(path)
    except FileNotFoundError:
        raise RawReplayRefused(f"the raw bundle {path.name} is absent; raw replay is required") from None
    if not stat.S_ISREG(before.st_mode):
        raise RawReplayRefused(f"the raw bundle {path.name} is not a regular file")
    if before.st_size != pin["bytes"]:
        raise RawReplayRefused(f"the raw bundle is {before.st_size} B, the pin says {pin['bytes']} B")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0))
    with os.fdopen(fd, "rb") as fh:
        opened = os.fstat(fh.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino) or not stat.S_ISREG(opened.st_mode):
            raise RawReplayRefused("the raw bundle changed identity while it was opened")
        data = fh.read(pin["bytes"] + 1)
    if len(data) != pin["bytes"] or hashlib.sha256(data).hexdigest() != pin["sha256"]:
        raise RawReplayRefused("the raw bundle bytes are not the pinned bundle")
    return data


def raw_bundle_members(data: bytes, expected: dict[str, str]) -> dict[str, bytes]:
    """Every member, in memory, exactly the manifest's raw files: nothing is extracted to disk.

    One directory entry ``raw`` is allowed; any other directory, link, device, duplicate,
    unlisted name (absolute, ``..`` or outside raw/), missing file or changed byte refuses.
    """
    members: dict[str, bytes] = {}
    seen_dir = False
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as tf:
            for m in tf:
                if m.isdir() and m.name == "raw" and not seen_dir:
                    seen_dir = True
                    continue
                if not m.isreg():
                    raise RawReplayRefused(f"non-regular tar member {m.name!r}")
                if m.name in members:
                    raise RawReplayRefused(f"duplicate tar member {m.name!r}")
                if m.name not in expected:
                    raise RawReplayRefused(f"tar member not in the manifest {m.name!r}")
                if m.size > RAW_MEMBER_MAX_BYTES:
                    raise RawReplayRefused(f"tar member {m.name!r} exceeds the replay bound")
                fh = tf.extractfile(m)
                body = fh.read() if fh is not None else None
                if body is None or len(body) != m.size:
                    raise RawReplayRefused(f"tar member {m.name!r} is truncated")
                members[m.name] = body
    except tarfile.TarError as exc:
        raise RawReplayRefused(f"the raw bundle is not a readable uncompressed tar: {exc}") from None
    missing = sorted(set(expected) - set(members))
    if missing:
        raise RawReplayRefused(f"{len(missing)} manifest raw files missing from the bundle, e.g. {missing[:3]}")
    bad = sorted(n for n, b in members.items() if hashlib.sha256(b).hexdigest() != expected[n])
    if bad:
        raise RawReplayRefused(f"{len(bad)} raw members differ from the manifest, e.g. {bad[:3]}")
    return members


def replay_raw_bundle(label: str, contract: dict, manifest: dict, parsed_bytes: dict[str, bytes],
                      snapshot_dir: Path) -> str:
    """AFLDB-ISSUE-319: prove the parsed bytes THIS process loads are the adapter parser's output.

    The pinned bundle's members must be exactly the tracked manifest's raw files; the shared
    acquisition parser (tools/rebuild/afltables/coach_snapshot_parser.py, the code the adapter
    ran) replays them in memory, and the rendered CSV bytes must equal both the manifest's parsed
    digests and ``parsed_bytes`` — the bytes the caller then parses into the rows it loads.
    """
    pin = raw_bundle_pin(label, contract)
    data = read_raw_bundle(snapshot_dir / pin["filename"], pin)
    expected = {manifest["index"]["raw_filename"]: manifest["index"]["raw_sha256"]}
    for entry in manifest.get("files", []):
        if entry["raw_filename"] in expected:
            raise RawReplayRefused(f"the manifest lists {entry['raw_filename']!r} twice")
        expected[entry["raw_filename"]] = entry["raw_sha256"]
    if len(expected) != pin["members"]:
        raise RawReplayRefused(f"the manifest names {len(expected)} raw files, the pin says {pin['members']}")
    members = raw_bundle_members(data, expected)
    parser = coach_snapshot_parser
    try:
        index_rows = parser.parse_index(members[manifest["index"]["raw_filename"]].decode("utf-8", "replace"), contract)
        pages = []
        for row in index_rows:
            body = members.get(f"raw/{row['coach_href']}")
            if body is None:
                raise RawReplayRefused(f"the index names {row['coach_href']!r}, absent from the bundle")
            page = parser.parse_page(body.decode("utf-8", "replace"), row["coach_path"])
            page["raw_sha256"] = parser.sha256_bytes(body)
            pages.append(page)
    except RawReplayRefused:
        raise
    except (SystemExit, Exception) as exc:  # the parser's Terminal is a SystemExit
        raise RawReplayRefused(f"the acquisition parser refused the raw bytes: {exc}") from None
    rendered = {"coaches_index": parser.render_csv(list(contract["index_columns"]), index_rows),
                "coach_pages": parser.render_csv(list(contract["page_columns"]), pages)}
    digests = []
    for entry in manifest["parsed"]:
        dataset = entry["dataset"]
        got = hashlib.sha256(rendered[dataset]).hexdigest()
        if got != entry["sha256"]:
            raise RawReplayRefused(f"{dataset}: the raw replay {got[:12]}… differs from the manifest {entry['sha256'][:12]}…")
        if parsed_bytes.get(dataset) != rendered[dataset]:
            raise RawReplayRefused(f"{dataset}: the parsed input this run loads differs from the raw replay")
        digests.append(f"{dataset} {got}")
    return (f"raw bundle {pin['filename']} sha256 {pin['sha256']} replayed ({len(members)} members): "
            f"{', '.join(digests)} equal to the replay, the manifest and the loaded files")


def verify_coaches_snapshot(label: str, contract: dict, require_raw_bundle: bool = False,
                            ) -> tuple[dict, list[dict], list[dict], str]:
    """The tracked parsed artefacts (always), the raw bytes (when present), hash-verified, and —
    when ``require_raw_bundle`` — the pinned raw bundle replayed into exactly the loaded bytes."""
    manifest = load_manifest(label)
    if manifest.get("family") != contract["family"]:
        sys.exit(f"ERROR: manifest {label!r} is a {manifest.get('family')!r} manifest, not {contract['family']!r}")
    if manifest.get("contract_coaches_version") != contract["contract_coaches_version"]:
        sys.exit(f"ERROR: manifest {label!r} was written under contract version "
                 f"{manifest.get('contract_coaches_version')!r}, the contract is {contract['contract_coaches_version']}")
    snapshot_dir = SNAPSHOT_ROOT / label
    parsed = {e["dataset"]: e for e in manifest.get("parsed", [])}
    if set(parsed) != {"coaches_index", "coach_pages"}:
        sys.exit(f"ERROR: manifest {label!r} lists parsed datasets {sorted(parsed)}; expected coaches_index and coach_pages")
    tables: dict[str, list[dict]] = {}
    parsed_bytes: dict[str, bytes] = {}
    for dataset, columns_key in (("coaches_index", "index_columns"), ("coach_pages", "page_columns")):
        entry = parsed[dataset]
        path = snapshot_dir / entry["filename"]
        if not path.is_file():
            sys.exit(f"ERROR: {label}: {entry['filename']} is missing from {snapshot_dir}")
        # Read once: the digest, the raw replay comparison and the loaded rows are all these bytes.
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != entry.get("sha256"):
            sys.exit(f"ERROR: {label}: {entry['filename']} sha256 {digest[:12]}… does not match the "
                     f"tracked manifest ({str(entry.get('sha256'))[:12]}…)")
        parsed_bytes[dataset] = data
        reader = csv.DictReader(io.StringIO(data.decode("utf-8"), newline=""))
        if reader.fieldnames != list(contract[columns_key]):
            sys.exit(f"ERROR: {path.name}: columns {reader.fieldnames} differ from the contract's")
        rows = list(reader)
        if len(rows) != int(entry["row_count"]):
            sys.exit(f"ERROR: {path.name}: {len(rows)} rows, manifest says {entry['row_count']}")
        tables[dataset] = rows
    index, pages = tables["coaches_index"], tables["coach_pages"]
    files = manifest.get("files", [])
    if not (len(index) == len(pages) == len(files) == int(manifest.get("pages_acquired", -1))
            == int(manifest.get("coaches_indexed", -1))):
        sys.exit(f"ERROR: {label}: index rows {len(index)}, page rows {len(pages)}, manifest files {len(files)}, "
                 f"pages_acquired {manifest.get('pages_acquired')}, coaches_indexed {manifest.get('coaches_indexed')} "
                 "disagree; a partial capture is not loadable")
    if {r["coach_path"] for r in index} != {p["coach_path"] for p in pages}:
        sys.exit(f"ERROR: {label}: the index and the pages name different coach paths")
    by_path = {p["coach_path"]: p for p in pages}
    for entry in files:
        page = by_path.get(entry["coach_path"])
        if page is None or page["raw_sha256"] != entry["raw_sha256"]:
            sys.exit(f"ERROR: {label}: parsed row for {entry['coach_path']} does not carry the manifest's raw sha256")
    raw_dir = snapshot_dir / "raw"
    if raw_dir.is_dir():
        checks = [(manifest["index"]["raw_filename"], manifest["index"]["raw_sha256"])]
        checks += [(e["raw_filename"], e["raw_sha256"]) for e in files]
        for name, expected in checks:
            path = snapshot_dir / name
            if not path.is_file():
                sys.exit(f"ERROR: {label}: raw/ is present but {name} is missing")
            if sha256_file(path) != expected:
                sys.exit(f"ERROR: {label}: {name} does not match the tracked manifest's raw sha256")
        raw_state = f"raw bytes verified ({len(checks)} files)"
    else:
        raw_state = "raw/ not present (the tracked parsed artefacts are the rebuild input)"
    if require_raw_bundle:
        try:
            replayed = f"AFLDB-COACH-RAW-REPLAY VERIFIED: {replay_raw_bundle(label, contract, manifest, parsed_bytes, snapshot_dir)}"
            raw_state = f"{raw_state}; {replayed}" if raw_dir.is_dir() else replayed
        except RawReplayRefused as exc:
            sys.exit(f"ERROR: {label}: AFLDB-COACH-RAW-REPLAY REFUSED: {exc}; nothing was loaded")
    return manifest, index, pages, raw_state


def fitzroy_stats_files(label: str, supplements: list[str]) -> list[SnapshotFile]:
    files: list[SnapshotFile] = []
    for lab in [label, *supplements]:
        for path in verified_fitzroy_files(lab, FITZROY_SNAPSHOT_ROOT / lab, "player_stats"):
            season = int(path.stem.rsplit("_", 1)[1])
            files.append(SnapshotFile(dataset="player_stats", path=path, season=season))
    return files


def continuity_rules() -> dict[str, str]:
    with FITZROY_CONTRACT_PATH.open(encoding="utf-8") as fh:
        contract = json.load(fh)
    return {normalise_profile_url(r["renumbered_url"]): normalise_profile_url(r["continuing_url"])
            for r in contract.get("profile_url_continuity", {}).get("rules", [])}


class CoachIdentityError(RuntimeError):
    """A join the accepted contract forbids: refused, never guessed."""


def fold_assignments(records, clubs: ClubResolver) -> tuple[dict[tuple[str, int, str], str], int, int, int]:
    """(match_key, season, club hist) -> the ONE coach string of the per-match rows.

    ``records`` yields (context, season, row) as iter_player_stats does. Two different
    strings for one (match, club) is a refusal; a blank Coach cell is the source's own
    gap (the group is kept with no string). Returns (assignments, rows_read, groups, blank).
    """
    strings: dict[tuple[str, int, str], set[str]] = defaultdict(set)
    rows_read = blank = 0
    for context, season, row in records:
        rows_read += 1
        match_date = parse_iso_date(row["Date"], context)
        round_code = normalise_stats_round(row["Round"], context)
        home = clubs.resolve(row["Home.team"], season, "player_stats")
        away = clubs.resolve(row["Away.team"], season, "player_stats")
        playing_for = clubs.resolve(row["Playing.for"], season, "player_stats")
        if playing_for not in (home, away):
            raise CoachIdentityError(f"{context}: Playing.for {row['Playing.for']!r} is neither club of the match")
        match_key = "|".join([str(season), round_code, match_date.isoformat(),
                              clubs.name_of(home), clubs.name_of(away)])
        coach = (row.get("Coach") or "").replace("\xa0", " ").strip()
        key = (match_key, season, playing_for)
        if not coach:
            blank += 1
            strings.setdefault(key, set())
            continue
        strings[key].add(coach)
    disagreeing = sorted(k for k, s in strings.items() if len(s) > 1)
    if disagreeing:
        shown = "; ".join(f"{k[0]} {k[2]}: {sorted(strings[k])}" for k in disagreeing[:5])
        raise CoachIdentityError(f"{len(disagreeing)} (match, club) groups carry two coach strings: {shown}")
    return {k: next(iter(s)) for k, s in strings.items() if s}, rows_read, len(strings), blank


def resolve_coach_strings(assignments: dict, index: list[dict]) -> dict[str, str]:
    """Every coach string -> its coach page path, by EXACT index name_raw; else refuse."""
    path_by_name = {r["name_raw"]: r["coach_path"] for r in index}
    unmapped = sorted({v for v in assignments.values() if v not in path_by_name})
    if unmapped:
        raise CoachIdentityError(f"{len(unmapped)} coach strings are not exactly one index name: {unmapped[:10]}")
    return path_by_name


def build_coach_rows(index: list[dict], pages: list[dict], identity: dict[str, int],
                     folded: dict[str, str], source_id: int, label: str,
                     corrections: list[dict] | None = None) -> tuple[list[tuple], int, int]:
    """One coaches row per index page; player_id ONLY through the page's profile path.

    ``identity`` is external_identities (source afltables) as profile path -> player id;
    ``folded`` the fitzRoy contract's renumbered -> continuing profile paths;
    ``corrections`` the contract's profile_link_corrections (a page href AFL Tables does
    not serve, replaced by the served path — exact match on coach page AND href, and every
    rule must apply exactly once). A page with a profile path that resolves to nothing is
    a refusal (a name is never identity); a page with no link is a coach-only person,
    player_id None, link_status 'unmatched'. Returns (rows, linked, unlinked).
    """
    page_by_path = {p["coach_path"]: p for p in pages}
    rows: list[tuple] = []
    linked = unlinked = 0
    applied: Counter[str] = Counter()
    unresolved: list[str] = []
    for r in index:
        page = page_by_path.get(r["coach_path"])
        if page is None:
            raise CoachIdentityError(f"{r['coach_path']}: index row has no page")
        given, surname = split_name(r["name_raw"])
        profile = normalise_profile_url(page["profile_path"]) if page["profile_path"] else None
        for rule in corrections or []:
            if rule["coach_path"] == r["coach_path"] and profile == normalise_profile_url(rule["page_profile_path"]):
                profile = normalise_profile_url(rule["canonical_profile_path"])
                applied[rule["id"]] += 1
        player_id = None
        if profile:
            target = profile if profile in identity else folded.get(profile)
            if target is None or target not in identity:
                unresolved.append(f"{r['coach_path']} -> {profile}")
                continue
            player_id = identity[target]
            linked += 1
        else:
            unlinked += 1
        rows.append((
            r["coach_path"], r["name_raw"], page["display_name"], given, surname, parse_dob(page["born_raw"] or None),
            player_id, "unique" if player_id is not None else "unmatched", profile,
            int(page["games_coached"]), source_id, r["coach_path"], f"snapshot {label}",
        ))
    if unresolved:
        raise CoachIdentityError(f"{len(unresolved)} coach pages link a Player Stats profile that resolves to no "
                                 f"canonical afltables identity (a name is never identity): {'; '.join(unresolved)}")
    dup_players = sorted(pid for pid, n in Counter(c[6] for c in rows if c[6] is not None).items() if n > 1)
    if dup_players:
        raise CoachIdentityError(f"two coach pages link the same player {dup_players}")
    for rule in corrections or []:
        if applied[rule["id"]] != 1:
            raise CoachIdentityError(f"profile_link_corrections rule {rule['id']!r} applied to {applied[rule['id']]} "
                                     "pages, expected exactly 1: the snapshot no longer matches the evidence it was written for")
    return rows, linked, unlinked


def split_name(name_raw: str) -> tuple[str | None, str | None]:
    """'Surname, Given' -> (given, surname); anything else keeps the whole string as surname."""
    if ", " in name_raw:
        surname, given = name_raw.split(", ", 1)
        return given.strip() or None, surname.strip() or None
    return None, name_raw.strip() or None


# ----------------------------------------------------------------- main

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", required=True, help="coaches snapshot label (tracked manifest name)")
    parser.add_argument("--fitzroy-label", required=True, help="accepted fitzRoy baseline label")
    parser.add_argument("--supplement-label", action="append", default=[],
                        help="pinned in-season fitzRoy supplement label(s); repeatable")
    parser.add_argument("--validate-only", action="store_true",
                        help="verify every tracked manifest and artefact hash, then stop (no database)")
    parser.add_argument("--dry-run", action="store_true", help="reconcile and report; write nothing")
    parser.add_argument("--require-raw-bundle", action="store_true",
                        help="AFLDB-ISSUE-319: refuse unless the contract-pinned raw bundle replays, through the "
                             "acquisition parser, into exactly the parsed bytes this run loads (validate, dry run and load)")
    args = parser.parse_args()
    t0 = time.time()

    with CONTRACT_PATH.open(encoding="utf-8") as fh:
        contract = json.load(fh)["coaches"]
    link_corrections = list(contract.get("profile_link_corrections", {}).get("rules", []))
    print("AFLDB coaches import (AFL Tables coach pages + fitzRoy per-match Coach column)")
    manifest, index, pages, raw_state = verify_coaches_snapshot(args.label, contract, args.require_raw_bundle)
    print(f"  {args.label}: {len(index)} index rows, {len(pages)} pages verified; {raw_state}")
    stats_files = fitzroy_stats_files(args.fitzroy_label, args.supplement_label)
    print(f"  fitzRoy player_stats files verified: {args.fitzroy_label} + {args.supplement_label} = {len(stats_files)} files")
    if args.validate_only:
        print(f"  done (validate only) in {time.time() - t0:.1f}s")
        return 0

    # ---- Assignment side: fold the per-match rows to one string per (match, club),
    # then every string to exactly one coach page.
    fitzroy_contract = json.loads(FITZROY_CONTRACT_PATH.read_text(encoding="utf-8"))
    clubs = ClubResolver(json.loads(CLUBS_JSON.read_text(encoding="utf-8")),
                         fitzroy_contract.get("source_club_normalisation", {}).get("rules", []))
    corrections = load_row_corrections(FITZROY_CONTRACT_PATH)
    try:
        assignments, rows_read, groups, _blank = fold_assignments(iter_player_stats(stats_files, corrections), clubs)
        path_by_name = resolve_coach_strings(assignments, index)
    except (MatchIdentityError, SnapshotValidationError, CoachIdentityError) as exc:
        sys.exit(f"ERROR: {exc}; refusing")
    print(f"  rows {rows_read:,}: team-match groups {groups:,}, with a coach {len(assignments):,}, "
          f"without {groups - len(assignments):,}; distinct strings {len(set(assignments.values()))}")

    # ---- Database side.
    load_env()
    dsn = require_env("AFLDB_IMPORT_DATABASE_URL")
    print(f"  target: {safe_dsn(dsn)}")
    if args.dry_run:
        print("  DRY RUN - nothing will be written")
    pg = connect_pg(dsn)
    with pg.cursor() as cur:
        cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
        hit = cur.fetchone()
        if not hit:
            sys.exit(f"ERROR: source {SOURCE_KEY!r} is not registered")
        source_id = hit[0]
        cur.execute("SELECT ei.external_id, ei.player_id FROM external_identities ei WHERE ei.source_id = %s "
                    "AND ei.player_id IS NOT NULL", (source_id,))
        identity = {normalise_profile_url(ext): pid for ext, pid in cur.fetchall()}
        cur.execute("SELECT id, match_key, season, home_club_id, away_club_id FROM matches")
        match_rows = cur.fetchall()
        cur.execute("SELECT id, legacy_club_hist FROM clubs")
        club_by_hist = {hist: cid for cid, hist in cur.fetchall()}
    match_by_key = {key: (mid, home, away) for mid, key, _s, home, away in match_rows}
    seasons_held = {s for _m, _k, s, _h, _a in match_rows}
    print(f"  canonical: matches {len(match_by_key):,} (seasons {min(seasons_held)}–{max(seasons_held)}), "
          f"afltables identities {len(identity):,}")

    # ---- Coaches: every page, linked only through the profile path.
    try:
        coach_rows, linked, unlinked = build_coach_rows(index, pages, identity, continuity_rules(), source_id,
                                                        args.label, link_corrections)
    except CoachIdentityError as exc:
        sys.exit(f"ERROR: {exc}; refusing")
    print(f"  coaches {len(coach_rows)}: linked to a player {linked}, coach-only {unlinked}")

    # ---- Match coaches: resolve match + club; a missing key in a held season refuses.
    assignment_rows: list[tuple] = []   # (match_id, club_id, coach_path, source_record_id)
    skipped_seasons: Counter[int] = Counter()
    missing: list[str] = []
    for (match_key, season, hist), coach in assignments.items():
        hit = match_by_key.get(match_key)
        if hit is None:
            if season not in seasons_held:
                skipped_seasons[season] += 1
                continue
            missing.append(match_key)
            continue
        mid, home_id, away_id = hit
        club_id = club_by_hist.get(hist)
        if club_id is None or club_id not in (home_id, away_id):
            sys.exit(f"ERROR: {match_key}: club {hist!r} (id {club_id}) is not a club of canonical match {mid}")
        assignment_rows.append((mid, club_id, path_by_name[coach], f"{match_key}@{hist}"))
    if missing:
        sys.exit(f"ERROR: {len(missing)} match keys of held seasons are absent from matches: {missing[:5]}; refusing")
    per_match: Counter[int] = Counter(m for m, _c, _p, _r in assignment_rows)
    both = sum(1 for n in per_match.values() if n == 2)
    one = sum(1 for n in per_match.values() if n == 1)
    none = len(match_by_key) - len(per_match)
    per_coach: Counter[str] = Counter(p for _m, _c, p, _r in assignment_rows)
    agree = sum(1 for c in coach_rows if per_coach.get(c[0], 0) == c[9])
    print(f"  match_coaches {len(assignment_rows):,}: matches with both coaches {both:,}, one {one:,}, none {none:,}"
          + (f"; skipped {sum(skipped_seasons.values())} rows of seasons the database does not hold "
             f"{dict(sorted(skipped_seasons.items()))}" if skipped_seasons else ""))
    print(f"  cross-check: coach pages whose Games Coached equals the canonical assignment count {agree} / "
          f"{len(coach_rows)} (differences are the source's own pre-1923/1940 gaps and seasons beyond the baseline)")
    measured = {
        "coaches": len(coach_rows), "coaches_linked_to_players": linked, "coaches_unlinked": unlinked,
        "match_coaches": len(assignment_rows), "matches_with_both_coaches": both,
        "matches_with_one_coach": one, "matches_without_coach": none,
    }
    print(f"  measured: {json.dumps(measured)}")
    if args.dry_run:
        print(f"  done (dry run) in {time.time() - t0:.1f}s")
        return 0

    # ---- Write, one batch, one transaction: coaches then assignments (set-based).
    t_write = time.time()
    with import_batch(pg, SOURCE_KEY, TOOL, "match_coaches") as batch:
        with pg.cursor() as cur:
            cur.execute("""CREATE TEMP TABLE tmp_coaches (
                             afltables_coach_path text PRIMARY KEY, name_key text NOT NULL, display_name text NOT NULL,
                             given_name text, surname text, dob date, player_id integer, link_status text NOT NULL,
                             afltables_profile_path text, source_games_coached integer, source_id smallint NOT NULL,
                             source_record_id text NOT NULL, notes text) ON COMMIT DROP""")
            with cur.copy("COPY tmp_coaches FROM STDIN") as copy:
                for row in coach_rows:
                    copy.write_row(row)
            cur.execute("""INSERT INTO coaches (afltables_coach_path, name_key, display_name, given_name, surname, dob,
                                                player_id, link_status_value, afltables_profile_path, source_games_coached,
                                                source_id, source_record_id, import_batch_id, notes)
                           SELECT afltables_coach_path, name_key, display_name, given_name, surname, dob, player_id,
                                  link_status::link_status, afltables_profile_path, source_games_coached, source_id,
                                  source_record_id, %s, notes
                             FROM tmp_coaches
                           ON CONFLICT (afltables_coach_path) DO UPDATE SET
                             name_key = EXCLUDED.name_key, display_name = EXCLUDED.display_name,
                             given_name = EXCLUDED.given_name, surname = EXCLUDED.surname, dob = EXCLUDED.dob,
                             player_id = EXCLUDED.player_id, link_status_value = EXCLUDED.link_status_value,
                             afltables_profile_path = EXCLUDED.afltables_profile_path,
                             source_games_coached = EXCLUDED.source_games_coached, source_id = EXCLUDED.source_id,
                             source_record_id = EXCLUDED.source_record_id, import_batch_id = EXCLUDED.import_batch_id,
                             notes = EXCLUDED.notes""", (batch.id,))
            coaches_written = cur.rowcount
            # AFLDB-ISSUE-159 §6.2. Inside this batch's transaction, and in this
            # order. The count above is already captured, so the replay cannot
            # perturb the coaches_written guard below; it counts rows affected by
            # the INSERT over tmp_coaches alone, and a manual coach is not in it.
            #
            # Immediately after the coaches upsert and BEFORE any match_coaches
            # work, so every admin-created coach exists as a row before the
            # assignment join needs it.
            replay_admin_overrides(pg, "coaches")
            cur.execute("""CREATE TEMP TABLE tmp_match_coaches (
                             match_id integer NOT NULL, club_id integer NOT NULL, coach_path text NOT NULL,
                             source_record_id text NOT NULL, PRIMARY KEY (match_id, club_id)) ON COMMIT DROP""")
            with cur.copy("COPY tmp_match_coaches FROM STDIN") as copy:
                for row in assignment_rows:
                    copy.write_row(row)
            cur.execute("""DELETE FROM match_coaches mc
                            WHERE mc.source_id = %s
                              AND NOT EXISTS (SELECT 1 FROM tmp_match_coaches t
                                               WHERE t.match_id = mc.match_id AND t.club_id = mc.club_id)""",
                        (source_id,))
            removed = cur.rowcount
            cur.execute("""INSERT INTO match_coaches (match_id, club_id, coach_id, source_id, source_record_id, import_batch_id)
                           SELECT t.match_id, t.club_id, c.id, %s, t.source_record_id, %s
                             FROM tmp_match_coaches t JOIN coaches c ON c.afltables_coach_path = t.coach_path
                           ON CONFLICT (match_id, club_id) DO UPDATE SET
                             coach_id = EXCLUDED.coach_id, source_id = EXCLUDED.source_id,
                             source_record_id = EXCLUDED.source_record_id, import_batch_id = EXCLUDED.import_batch_id""",
                        (source_id, batch.id))
            assignments_written = cur.rowcount
            # After the assignment upsert and BEFORE the integrity checks. The
            # (match_id, club_id) primary key carries no source, so the upsert
            # above WILL have overwritten a manual assignment on a team-match the
            # source now covers; replaying here restores the human decision, and
            # puts it inside the same integrity checks as everything else
            # (AFLDB-ISSUE-159 §6.2, D-4). Both counts are already captured.
            replay_admin_overrides(pg, "match_coaches")
            if coaches_written != len(coach_rows) or assignments_written != len(assignment_rows):
                raise RuntimeError(f"wrote {coaches_written} coaches / {assignments_written} assignments, "
                                   f"expected {len(coach_rows)} / {len(assignment_rows)}")
            cur.execute("SELECT count(*) FROM coaches WHERE player_id IS NOT NULL AND NOT EXISTS "
                        "(SELECT 1 FROM players p WHERE p.id = coaches.player_id)")
            if cur.fetchone()[0]:
                raise RuntimeError("a coach links to a player row that does not exist; refusing to commit")
            batch.records_read = rows_read
            batch.records_inserted = coaches_written + assignments_written
            batch.records_updated = removed
        pg.commit()
    print(f"  batch {batch.id}: coaches {coaches_written}, match_coaches {assignments_written} "
          f"(stale removed {removed}); write {time.time() - t_write:.1f}s; done in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
