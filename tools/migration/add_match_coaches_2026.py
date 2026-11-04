#!/usr/bin/env python3
"""AFLDB-ISSUE-333: the NARROWLY ADDITIVE 2026 coach-assignment writer (library + one `apply` command).

    python tools/migration/add_match_coaches_2026.py apply --plan <plan.json>      (AFLDB_IMPORT_DATABASE_URL in the environment)

It is driven ONLY by `tools/v2/issue333-coach-assignments-production.py`, which builds and digest-seals the plan this command reads, and which
classifies the outcome with an independent read-only probe (the exit code of this command is never evidence about its transaction).

Why this exists instead of the broad importer. `import_match_coaches.py` (unmodified; imported here as a library) upserts every `coaches` row,
rewrites coach_id / source_record_id / import_batch_id of every existing assignment in its input, deletes source assignments missing from its
input, replays admin overrides, and commits its import_batches row in a separate earlier transaction. None of that is wanted. This writer:

  * stages the accepted fitzRoy core FRESHLY from the hash-pinned tar (sha256 9a989fdc...4db080) into an exclusive NEW directory, member by member,
    and verifies the staged set against the tracked manifest file by file (no reuse of any earlier extraction; links and non-regular members refuse);
  * folds the per-match Coach column with the importer's own `fold_assignments` / `resolve_coach_strings` / `ClubResolver` (exact strings,
    historical club identity, fail-closed), over ALL seasons;
  * requires: the source agrees with EVERY stored afltables assignment (same coach; a stored row the source no longer asserts is a
    deletion-causing input and refuses), every coach string resolves to a coaches row that ALREADY exists (no coach is inserted or updated),
    and the new set is exactly the reviewed 436 assignments: all season 2026, both sides of all 218 2026 matches, none present;
  * writes, in ONE transaction it controls: SET LOCAL TimeZone/lock/statement timeouts, identity + privilege proof, LOCK match_coaches, coaches,
    import_batches IN SHARE ROW EXCLUSIVE MODE, re-proof of the whole full-row baseline, one import_batches row, a plain INSERT (no ON CONFLICT,
    so a conflict errors) of the 436 rows, then the post-state proof (every pre-existing row byte-identical in every column, exactly +436,
    exactly +1 batch, nothing else written by this transaction per pg_stat_xact_user_tables). COMMIT only if every check passed; otherwise
    ROLLBACK and a non-zero exit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
import tarfile
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "tools" / "v2"))

import import_match_coaches as imc  # noqa: E402  (the broad importer, used as a library only; never modified)
from enrich_heights import load_manifest as load_core_manifest, verified_files as verified_fitzroy_files  # noqa: E402
from import_fitzroy_core import (  # noqa: E402
    CLUBS_JSON, CONTRACT_PATH as FITZROY_CONTRACT_PATH, ClubResolver, MatchIdentityError, SnapshotFile, SnapshotValidationError,
    iter_player_stats, load_row_corrections,
)
import issue333_o2_common as oc  # noqa: E402
from issue333_o2_common import Refused  # noqa: E402

CORE_LABEL = "c2-2026-final-core-v1"
CORE_TAR_SHA256 = "9a989fdcf7177cff24bbedcd0ee4559b772ebc452c05dab331e128859e4db080"
COACH_LABEL = "coaches-20260905"
SEASON = 2026
EXPECT_NEW = 436
EXPECT_MATCHES = 218
TOOL = "add_match_coaches_2026.py"
APP_NAME = "afldb-issue333-writer"     # the ceremony's live-writer probe looks for this application_name (review F-001)
SOURCE_KEY = "afltables"
LOCKED = ("public.match_coaches", "public.coaches", "public.import_batches")
ALLOWED_TRIGGERS = [["match_coaches", "match_coaches_club_in_match_trg"]]
COLUMNS = {
    "match_coaches": ["match_id", "club_id", "coach_id", "source_id", "source_record_id", "import_batch_id"],
    "coaches": ["id", "afltables_coach_path", "name_key", "display_name", "given_name", "surname", "dob", "player_id", "link_status_value",
                "afltables_profile_path", "source_games_coached", "source_id", "source_record_id", "import_batch_id", "notes"],
    "import_batches": ["id", "source_id", "tool", "target_table", "started_at", "completed_at", "status", "records_read", "records_inserted",
                       "records_updated", "records_rejected", "validation_result", "error", "notes"],
    "data_overrides": ["id", "entity_type", "entity_key", "field_group", "override_values", "is_active", "admin_user_id", "created_at", "updated_at"],
}
EXPECTED_WRITES = {"public.import_batches": [1, 1, 0], "public.match_coaches": [EXPECT_NEW, 0, 0]}


# --------------------------------------------------------------------------------------------------- source: fresh staging, file by file

def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest_files() -> dict[str, str]:
    try:
        manifest = load_core_manifest(CORE_LABEL)
    except SystemExit as exc:
        raise Refused(f"core manifest unreadable: {exc}") from None
    out: dict[str, str] = {}
    for e in manifest.get("files", []):
        name, digest = e.get("filename"), e.get("sha256")
        if not isinstance(name, str) or not isinstance(digest, str) or name in out:
            raise Refused("the core manifest lists a malformed or duplicate file")
        out[name] = digest
    if not out:
        raise Refused("the core manifest lists no files")
    return out


def stage_core(tar_path: Path, staging: Path) -> dict:
    """Extract the hash-verified tar into a NEW directory, member by member; then verify the staged set file by file."""
    if file_sha256(tar_path) != CORE_TAR_SHA256:
        raise Refused("core.tar does not hash to the reviewed sha256")
    if os.path.lexists(staging):
        raise Refused("the staging directory already exists; a stale or reused staging directory is refused (choose a new path)")
    if not staging.parent.is_dir():
        raise Refused("the staging directory's parent does not exist")
    expected = manifest_files()
    os.mkdir(staging, 0o700)
    seen: set[str] = set()
    try:
        with tarfile.open(tar_path, "r:") as tf:
            for m in tf:
                name = m.name[2:] if m.name.startswith("./") else m.name
                if m.isdir() and name in ("", "."):
                    continue
                if not m.isreg():
                    raise Refused(f"core.tar member {m.name!r} is not a regular file (links, directories and devices are refused)")
                if not name or "/" in name or "\\" in name or name.startswith(".") or name not in expected:
                    raise Refused(f"core.tar member {m.name!r} is not a manifest file name")
                if name in seen:
                    raise Refused(f"core.tar member {name!r} is duplicated")
                fh = tf.extractfile(m)
                data = fh.read() if fh is not None else b""
                if len(data) != m.size or hashlib.sha256(data).hexdigest() != expected[name]:
                    raise Refused(f"core.tar member {name!r} differs from the tracked manifest")
                fd = os.open(staging / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0), 0o600)
                with os.fdopen(fd, "wb") as out:
                    out.write(data)
                seen.add(name)
    except tarfile.TarError as exc:
        raise Refused(f"core.tar is not a readable uncompressed tar ({type(exc).__name__})") from None
    missing = sorted(set(expected) - seen)
    if missing:
        raise Refused(f"core.tar lacks {len(missing)} manifest files, e.g. {missing[:3]}")
    return verify_staging(staging)


def verify_staging(staging: Path) -> dict:
    """The staged directory holds exactly the manifest's files, each a regular unlinked file with the manifest's sha256."""
    st = os.lstat(staging)
    if not stat.S_ISDIR(st.st_mode):
        raise Refused("the staging path is not a real directory")
    expected = manifest_files()
    names = sorted(os.listdir(staging))
    if names != sorted(expected):
        extra, missing = sorted(set(names) - set(expected)), sorted(set(expected) - set(names))
        raise Refused(f"the staging directory differs from the manifest (extra {extra[:3]}, missing {missing[:3]})")
    for name in names:
        p = staging / name
        if not stat.S_ISREG(os.lstat(p).st_mode):
            raise Refused(f"staged {name} is not a regular file")
        if file_sha256(p) != expected[name]:
            raise Refused(f"staged {name} differs from the manifest (tampered or stale staging)")
    return {"path": str(staging), "files": len(names), "setDigest": oc.sha(oc.canon(sorted([n, expected[n]] for n in names))),
            "manifestSha256": file_sha256(imc.REPO_ROOT / "docs" / "rebuild-manifests" / "afltables_fitzroy_core" / f"{CORE_LABEL}.json")}


def _fold(files, clubs, corrections):
    try:
        return imc.fold_assignments(iter_player_stats(files, corrections), clubs)
    except (MatchIdentityError, SnapshotValidationError, imc.CoachIdentityError) as exc:
        raise Refused(f"the source fold refused: {str(exc)[:300]}") from None


def read_source(staging: Path) -> dict:
    """(match_key, season, club hist) -> coach page path for every asserted assignment, by the importer's own exact rules."""
    with imc.CONTRACT_PATH.open(encoding="utf-8") as fh:
        contract = json.load(fh)["coaches"]
    try:
        _manifest, index, pages, raw_state = imc.verify_coaches_snapshot(COACH_LABEL, contract, False)
        paths = verified_fitzroy_files(CORE_LABEL, staging, "player_stats")
    except SystemExit as exc:
        raise Refused(f"source verification refused: {str(exc)[:300]}") from None
    files = [SnapshotFile(dataset="player_stats", path=p, season=int(p.stem.rsplit("_", 1)[1])) for p in paths]
    fcontract = json.loads(FITZROY_CONTRACT_PATH.read_text(encoding="utf-8"))
    clubs = ClubResolver(json.loads(CLUBS_JSON.read_text(encoding="utf-8")), fcontract.get("source_club_normalisation", {}).get("rules", []))
    corrections = load_row_corrections(FITZROY_CONTRACT_PATH)
    assignments, rows_read, groups, blank = _fold(files, clubs, corrections)
    a26, rows26, groups26, blank26 = _fold([f for f in files if f.season == SEASON], clubs, corrections)
    try:
        path_by_name = imc.resolve_coach_strings(assignments, index)
    except imc.CoachIdentityError as exc:
        raise Refused(f"a coach string is not exactly one index name: {str(exc)[:300]}") from None
    if blank26 or groups26 != len(a26) or {k: v for k, v in assignments.items() if k[1] == SEASON} != a26:
        raise Refused(f"season {SEASON}: {blank26} blank coach cells, {groups26} groups, {len(a26)} with a coach; every 2026 group must carry exactly one string")
    return {"assignments": {k: path_by_name[v] for k, v in assignments.items()}, "names": {path_by_name[v]: v for v in assignments.values()},
            "rowsRead": rows_read, "groups": groups, "blankRows": blank, "season2026Groups": groups26, "season2026Rows": rows26,
            "distinctStrings": len(set(assignments.values())), "coachIndexRows": len(index), "coachPages": len(pages), "rawState": raw_state,
            "files": len(files)}


# --------------------------------------------------------------------------------------------------- database state (SELECT only)

def read_state(cur) -> dict:
    """One consistent read of everything the plan and the write transaction prove. `cur` may be a SELECT-only cursor."""
    cur.execute("SELECT table_name::text, array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = ANY(%s) GROUP BY 1", (list(COLUMNS),))
    cols = {t: list(c) for t, c in cur.fetchall()}
    if cols != COLUMNS:
        raise Refused(f"a touched table's columns differ from the reviewed full-row definition: {sorted(t for t in COLUMNS if cols.get(t) != COLUMNS[t])}")
    cur.execute("SELECT id FROM sources WHERE key = %s", (SOURCE_KEY,))
    hit = cur.fetchone()
    if not hit:
        raise Refused("source afltables is not registered")
    s = {"sourceId": int(hit[0])}
    cur.execute("SELECT id, match_key, season, home_club_id, away_club_id FROM matches ORDER BY id")
    s["matches"] = [tuple(r) for r in cur.fetchall()]
    cur.execute("SELECT id, legacy_club_hist FROM clubs ORDER BY id")
    s["clubs"] = [tuple(r) for r in cur.fetchall()]
    cur.execute(f"SELECT {', '.join(c + ('::text' if c == 'link_status_value' else '') for c in COLUMNS['coaches'])} FROM coaches ORDER BY id")
    s["coaches"] = [tuple(r) for r in cur.fetchall()]
    cur.execute(f"SELECT {', '.join(COLUMNS['match_coaches'])} FROM match_coaches ORDER BY match_id, club_id")
    s["matchCoaches"] = [tuple(r) for r in cur.fetchall()]
    cur.execute(f"SELECT {', '.join(c + ('::text' if c == 'status' else '') for c in COLUMNS['import_batches'])} FROM import_batches ORDER BY id")
    s["importBatches"] = [tuple(r) for r in cur.fetchall()]
    cur.execute("SELECT count(*), coalesce(max(id), 0) FROM import_rejections")
    s["importRejections"] = [int(x) for x in cur.fetchone()]
    cur.execute(f"SELECT {', '.join(COLUMNS['data_overrides'])} FROM data_overrides WHERE entity_type IN ('coaches', 'match_coaches') ORDER BY id")
    s["coachOverrides"] = [tuple(r) for r in cur.fetchall()]
    s["triggers"] = oc.trigger_inventory(cur, LOCKED)
    return s


def baseline(s: dict) -> dict:
    m26 = [r for r in s["matches"] if r[2] == SEASON]
    ib = s["importBatches"]
    operation = {
        "matchCoaches": {"rows": len(s["matchCoaches"]), "fullRowDigest": oc.rows_digest(s["matchCoaches"])},
        "coaches": {"rows": len(s["coaches"]), "fullRowDigest": oc.rows_digest(s["coaches"])},
        "matches2026": {"rows": len(m26), "identityDigest": oc.rows_digest(m26)},
        "coachOverrides": {"rows": len(s["coachOverrides"]), "fullRowDigest": oc.rows_digest(s["coachOverrides"])},
        "triggers": s["triggers"],
    }
    b = {"operation": operation, "operationDigest": oc.sha(oc.canon(operation)),
         "importBatches": {"rows": len(ib), "maxId": max((int(r[0]) for r in ib), default=0), "fullRowDigest": oc.rows_digest(ib)},
         "importRejections": {"rows": s["importRejections"][0], "maxId": s["importRejections"][1]}}
    b["baselineDigest"] = oc.sha(oc.canon(b))
    return b


def import_batches_prefix_digest(s: dict, max_id: int) -> str:
    return oc.rows_digest([r for r in s["importBatches"] if int(r[0]) <= max_id])


def compute_new(src: dict, s: dict) -> dict:
    """The exact rows to insert, or a refusal naming the first reason they are not the reviewed narrowly additive set."""
    source_id = s["sourceId"]
    match_by_key = {r[1]: (int(r[0]), int(r[3]), int(r[4]), int(r[2])) for r in s["matches"]}
    seasons_held = {int(r[2]) for r in s["matches"]}
    club_by_hist = {r[1]: int(r[0]) for r in s["clubs"]}
    coach_by_path = {r[1]: int(r[0]) for r in s["coaches"]}
    stored = {(int(r[0]), int(r[1])): r for r in s["matchCoaches"]}
    new, conflicts, missing_coach, missing_match, asserted = [], [], set(), [], set()
    skipped: Counter = Counter()
    for (mk, season, hist), path in sorted(src["assignments"].items()):
        hit = match_by_key.get(mk)
        if hit is None:
            if season not in seasons_held:
                skipped[season] += 1
            else:
                missing_match.append(mk)
            continue
        mid, home, away, _season = hit
        club = club_by_hist.get(hist)
        if club is None or club not in (home, away):
            raise Refused(f"{mk}: club {hist!r} is not a club of canonical match {mid}")
        cid = coach_by_path.get(path)
        if cid is None:
            missing_coach.add(path)
            continue
        asserted.add((mid, club))
        row = stored.get((mid, club))
        if row is not None:
            if int(row[2]) != cid or int(row[3]) != source_id:
                conflicts.append(f"{mk}@{hist}")
        else:
            new.append((mid, club, cid, source_id, f"{mk}@{hist}", season))
    if missing_match:
        raise Refused(f"{len(missing_match)} source match keys of held seasons are absent from matches, e.g. {missing_match[:3]}")
    if missing_coach:
        raise Refused(f"{len(missing_coach)} coach identities are not already in coaches (this tool never inserts or updates a coach): {sorted(missing_coach)[:5]}")
    if conflicts:
        raise Refused(f"{len(conflicts)} stored assignments conflict with the source (pre-existing assignment conflict), e.g. {conflicts[:3]}")
    afltables_stored = [k for k, r in stored.items() if int(r[3]) == source_id]
    stale = sorted(k for k in afltables_stored if k not in asserted)
    if stale:
        raise Refused(f"deletion-causing input: the source no longer asserts {len(stale)} stored afltables assignments, e.g. {stale[:3]}")
    if skipped:
        raise Refused(f"the source carries seasons the database does not hold: {dict(skipped)}")
    m26 = {int(r[0]) for r in s["matches"] if int(r[2]) == SEASON}
    per_match = Counter(r[0] for r in new)
    if any(r[5] != SEASON for r in new) or len(new) != EXPECT_NEW or len(m26) != EXPECT_MATCHES or set(per_match) != m26 \
            or any(n != 2 for n in per_match.values()):
        raise Refused(f"the new set is not exactly the reviewed {EXPECT_NEW} season-{SEASON} assignments (both sides of all {EXPECT_MATCHES} matches): "
                      f"{len(new)} new, seasons {sorted({r[5] for r in new})}, matches {len(per_match)} of {len(m26)}")
    rows = sorted(r[:5] for r in new)
    name_of = {int(r[0]): r[2] for r in s["coaches"]}
    per_coach = Counter(name_of[r[2]] for r in rows)
    return {"rows": [list(r) for r in rows], "count": len(rows), "digest": oc.rows_digest(rows), "matches": len(per_match),
            "otherSourceStoredRows": len(stored) - len(afltables_stored), "perCoach": dict(sorted(per_coach.items()))}


def facts(src: dict, s: dict) -> dict:
    return {"baseline": baseline(s), "newRows": compute_new(src, s)}


# --------------------------------------------------------------------------------------------------- the post-state, as a classification

def classify(plan: dict, s: dict, strict: bool = False) -> tuple[str, list[str]]:
    """'unchanged' (the plan's baseline), 'applied' (exactly the planned result in every respect) or 'other' (with the reasons).

    Outside the write transaction another writer (the nightly settle) may APPEND an import_batches row of its own; a fresh read-only probe then
    still classifies the operation's own tables exactly, with every pre-existing batch row byte-identical, and reports the appended rows
    (`strict=False`). Inside the write transaction (`strict=True`, tables locked) exactly one appended batch row is allowed: this tool's."""
    pb = plan["baseline"]
    now_b = baseline(s)
    if now_b == pb:
        return "unchanged", []
    problems: list[str] = []
    planned = {(r[0], r[1]): r for r in plan["newRows"]["rows"]}
    max_before = pb["importBatches"]["maxId"]
    old_ids = {int(r[0]) for r in s["importBatches"] if int(r[0]) <= max_before}
    added_batches = [r for r in s["importBatches"] if int(r[0]) > max_before]
    mine = [r for r in added_batches if r[2] == TOOL]
    foreign = [r for r in added_batches if r[2] != TOOL]
    prefix_ok = len(old_ids) == pb["importBatches"]["rows"] and import_batches_prefix_digest(s, max_before) == pb["importBatches"]["fullRowDigest"]
    if not prefix_ok:
        problems.append("a pre-existing import_batches row changed or was removed")
    if strict and foreign:
        problems.append(f"{len(foreign)} import_batches rows other than this tool's were added inside the write transaction")
    untouched = (now_b["operation"] == pb["operation"] and now_b["importRejections"] == pb["importRejections"] and prefix_ok and not mine)
    if untouched and not strict:
        return "unchanged", [f"note: {len(foreign)} import_batches row(s) appended by other tools since the plan: {[[int(r[0]), r[2]] for r in foreign]}"]
    if len(mine) != 1:
        problems.append(f"import_batches does not hold exactly one row of this tool after the plan ({len(mine)})")
    batch = mine[0] if len(mine) == 1 else None
    if batch is not None and (batch[2] != TOOL or batch[6] != "completed" or batch[3] != "match_coaches" or int(batch[1]) != s["sourceId"]
                              or int(batch[8]) != EXPECT_NEW):
        problems.append("the added import_batches row is not this tool's completed batch")
    old = [r for r in s["matchCoaches"] if (int(r[0]), int(r[1])) not in planned]
    added = [r for r in s["matchCoaches"] if (int(r[0]), int(r[1])) in planned]
    if oc.rows_digest(old) != pb["operation"]["matchCoaches"]["fullRowDigest"] or len(old) != pb["operation"]["matchCoaches"]["rows"]:
        problems.append("a pre-existing match_coaches row changed (in any column) or was removed")
    want = sorted([*planned[k][:5], int(batch[0]) if batch is not None else None] for k in planned)
    if len(added) != EXPECT_NEW or sorted([int(r[0]), int(r[1]), int(r[2]), int(r[3]), r[4], int(r[5]) if r[5] is not None else None] for r in added) != want:
        problems.append("the inserted match_coaches rows are not exactly the planned rows with this batch's id")
    for key, label in (("coaches", "coaches"), ("matches2026", "the 2026 matches"), ("coachOverrides", "coach data_overrides")):
        if now_b["operation"][key] != pb["operation"][key]:
            problems.append(f"{label} changed")
    if now_b["operation"]["triggers"] != pb["operation"]["triggers"]:
        problems.append("the trigger inventory changed")
    if now_b["importRejections"] != pb["importRejections"]:
        problems.append("import_rejections changed")
    return ("applied", []) if not problems else ("other", problems)


# --------------------------------------------------------------------------------------------------- apply (the only write)

def plan_body_ok(plan: dict) -> None:
    body = {k: v for k, v in plan.items() if k != "digest"}
    if plan.get("digest") != oc.sha(oc.canon(body)) or plan.get("operation") != "issue333-coach-assignments":
        raise Refused("the plan's digest or operation differs; the writer only runs a sealed ISSUE-333 plan")


def apply(plan: dict, dsn: str) -> dict:
    import psycopg
    plan_body_ok(plan)
    staging = Path(plan["staging"]["path"])
    if verify_staging(staging) != plan["staging"]:
        raise Refused("the staging directory differs from the planned one")
    src = read_source(staging)                                   # before the transaction: it reads ~130 files
    conn = psycopg.connect(dsn, autocommit=False, application_name=APP_NAME)
    try:
        with conn.cursor() as cur:
            settings = oc.configure_writer(cur)
            ident = oc.prove_write_identity(cur, plan["target"], LOCKED)
            oc.rehearsal_target_ok(plan, ident["database"])
            cur.execute("LOCK TABLE public.match_coaches, public.coaches, public.import_batches IN SHARE ROW EXCLUSIVE MODE")
            s = read_state(cur)
            f = facts(src, s)
            if f["baseline"] != plan["baseline"]:
                raise Refused("baseline drift inside the write transaction; re-plan")
            if f["newRows"] != plan["newRows"]:
                raise Refused("the new rows recomputed inside the write transaction differ from the plan")
            if not plan["rehearsal"] and [t[:2] for t in s["triggers"]] != ALLOWED_TRIGGERS:
                raise Refused("a trigger other than the reviewed match_coaches_club_in_match_trg exists on a touched table")
            if oc.transaction_writes(cur):
                raise Refused("the transaction wrote before the insert")
            cur.execute("INSERT INTO import_batches (source_id, tool, target_table, notes) VALUES (%s, %s, 'match_coaches', %s) RETURNING id",
                        (s["sourceId"], TOOL, f"AFLDB-ISSUE-333 narrowly additive 2026 coach assignments; plan {plan['digest']}"))
            batch_id = int(cur.fetchone()[0])
            rows = plan["newRows"]["rows"]
            cur.execute("INSERT INTO match_coaches (match_id, club_id, coach_id, source_id, source_record_id, import_batch_id) "
                        "SELECT u.m, u.c, u.k, u.s, u.r, %s FROM unnest(%s::int[], %s::int[], %s::int[], %s::smallint[], %s::text[]) AS u(m, c, k, s, r)",
                        (batch_id, [r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows], [r[3] for r in rows], [r[4] for r in rows]))
            if cur.rowcount != EXPECT_NEW:
                raise Refused(f"inserted {cur.rowcount} rows, expected {EXPECT_NEW}")
            cur.execute("UPDATE import_batches SET status = 'completed', completed_at = now(), records_read = %s, records_inserted = %s, "
                        "validation_result = %s::jsonb WHERE id = %s",
                        (src["rowsRead"], EXPECT_NEW, json.dumps({"issue": "AFLDB-ISSUE-333", "planDigest": plan["digest"], "newRowsDigest": plan["newRows"]["digest"]}), batch_id))
            if cur.rowcount != 1:
                raise Refused("the batch row could not be completed")
            after = read_state(cur)
            seen, problems = classify(plan, after, strict=True)
            writes = oc.transaction_writes(cur)
            if len(after["importBatches"]) != plan["baseline"]["importBatches"]["rows"] + 1:
                problems.append("import_batches did not grow by exactly one row")
                seen = "other"
            if seen != "applied" or writes != EXPECTED_WRITES:
                raise Refused(f"post-state check failed inside the transaction: {problems[:3]}; writes {writes}")
        conn.commit()
        return {"committed": True, "batchId": batch_id, "inserted": EXPECT_NEW, "settings": settings}
    except BaseException:
        try:
            conn.rollback()
        finally:
            conn.close()
        raise
    finally:
        if not conn.closed:
            conn.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="ISSUE-333 narrowly additive writer; run only through tools/v2/issue333-coach-assignments-production.py")
    ap.add_argument("mode", choices=("apply",))
    ap.add_argument("--plan", required=True)
    a = ap.parse_args(argv)
    try:
        plan = json.loads(Path(a.plan).read_text(encoding="utf-8"))
        if os.environ.get("AFLDB_ISSUE333_PLAN_DIGEST") != plan.get("digest"):
            raise Refused("run only through tools/v2/issue333-coach-assignments-production.py apply (it sets the reviewed plan digest)")
        result = apply(plan, os.environ.get("AFLDB_IMPORT_DATABASE_URL", ""))
    except Refused as exc:
        print(f"ISSUE-333 writer: ROLLED BACK / REFUSED: {exc}")
        return 2
    except Exception as exc:  # noqa: BLE001 -- class only; a driver message may name the host
        print(f"ISSUE-333 writer: FAILED ({type(exc).__name__}); the transaction was rolled back if it was open")
        return 3
    print("ISSUE-333 writer: COMMITTED " + json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
