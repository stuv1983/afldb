#!/usr/bin/env python3
"""AFLDB-ISSUE-348 -- the fail-closed reload guard of the full DraftGuru importer.

``import_draftguru.py`` (normal mode) reloads ``draft_picks`` keyed on migration 069's
``PICK_KEY`` and removes every stored key the incoming snapshot does not carry
(``reload_keyed(..., delete_missing=True)``), then removes every childless person. It also
rewrites every column of every matched row. Before ISSUE-348 nothing checked what that would
destroy: the full review of 2026-11-14 (ING-2) showed that the default label would delete the
35 audited D-336-2 picks (ids 6819-6853) and their 31 persons, leave 35 ``data_edits`` rows
pointing at deleted ids and trip no count gate; ING-3 showed that once the DraftGuru constants
are edited a keyed reload overwrites ``original_club_raw`` on the D-336-3 rows (including the
three ``REPLACE_CLUB`` rows 5961, 6784, 6626) before any review.

This module is the pre-write check. ``run_import`` calls ``enforce`` BEFORE ``apply_authority``
(which can mint player seeds) and BEFORE ``import_batch`` opens, so a refusal -- ``--dry-run``
included -- leaves the database, ``import_batches`` included, exactly as it found it. It issues
SELECT statements only (``tests/draftguru-import.test.ts`` pins that statically).

What a normal-mode run must have reviewed before it may proceed ("effects"):

  1. every stored DraftGuru pick whose reload key the incoming snapshot does not carry
     (the reload would delete it), and every stored person that would be left childless;
  2. every stored pick that carries an audit trail -- a ``data_edits`` row for it, an active
     ``data_overrides`` row for its key, or an audited insert (a ``source_insert`` data_edits
     row, or the I336 provenance note) -- whose source-owned columns the reload would change
     (a column an active override covers is excluded: the replay restores it, and the
     override, not the source, decides it);
  3. every such protected person whose ``dg_person_id`` (a per-load rank), name or name key
     would change -- the I336 persons carry a rank past the stored maximum and are renumbered
     by the next full reload;
  4. every stored pick whose ``original_club_raw`` would change (override-covered rows
     excepted), each classified as the D-336-3 classifier classifies it.

"Would delete" and "matched" are decided by PostgreSQL with the very predicates ``reload_keyed``
generates (``common._key_match`` over ``PICK_KEY`` / ``PERSON_KEY`` and ``common._scope_clause``
over ``source_id``), NULL-safe (``IS NOT DISTINCT FROM``), never by a Python re-implementation.

The only way past is a reviewed reconciliation file (``--reconciliation FILE`` with the file's
sha256 pinned by ``--reconciliation-sha256``) that names the exact keys and the digest of the
effects it was reviewed against. The D-336-3 classifier's JSON output is embedded verbatim as
``origin_review``; REPLACE_CLUB / OTHER rows additionally need an explicit ``owner_rulings``
entry. ``--acknowledge-population-drop`` is a different gate (external_identities only) and does
NOT satisfy this one. See ``docs/v2/evidence/remediation-20261114/draftguru/README.md``.

No psycopg import at module level: the pure functions need no driver.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

REPORT_FORMAT = "afldb-draftguru-reload-guard-report/1"
RECONCILIATION_FORMAT = "afldb-draftguru-reconciliation/1"

# data_edits.field_group the D-336-2 tool writes for an audited insert
# (tools/v2/issue336-predraft-insert-production.ts AUDIT_FIELD_GROUP).
AUDITED_FIELD_GROUP = "source_insert"
# Provenance text the same tool writes on the pick / person (a SECOND, non-durable signal:
# --link-only rewrites confidence_notes, so the data_edits trail is the primary one).
AUDITED_PROVENANCE_PREFIXES = ("AFLDB-ISSUE-336 bounded insert",)

# The columns a normal-mode reload writes on a matched pick besides the key, the link columns
# (derived by apply_authority; changing them is the importer's job) and the bookkeeping columns
# (import_batch_id, draft_person_id, dg_person_id, player_url, reported_*).
PICK_FACT_COLUMNS = (
    "draft_type", "pick_number", "pick_note", "player_name_raw", "club_id", "club_name_raw",
    "original_club_raw", "draft_age", "height_cm", "weight_kg", "grade", "competition",
    "signing", "signing_kind", "signing_detail", "detail", "source_record_id",
)
# Person columns whose change is a rewrite the guard refuses for a protected person.
PERSON_FACT_COLUMNS = ("dg_person_id", "display_name_raw", "name_key")

# data_overrides.override_values key -> the draft_picks columns replay_admin_overrides(draft_picks)
# restores from it (tools/migration/common.py, the source-owned patch). club_slug only applies
# when non-null there, so only then does it cover.
OVERRIDE_COVERS = {
    "player_name_raw": ("player_name_raw",),
    "original_club_raw": ("original_club_raw",),
    "draft_age": ("draft_age",),
    "height_cm": ("height_cm",),
    "weight_kg": ("weight_kg",),
    "pick_note": ("pick_note",),
    "detail": ("detail",),
    "pick_number": ("pick_number",),
    "club_slug": ("club_id", "club_name_raw"),
}

# The origin-change classes that need no owner ruling (D-336-3: INSERT_* and RENAME_EXPAND are
# source enrichment). Everything else -- REPLACE_CLUB, INSERT_MIXED, OTHER -- needs one.
AUTO_ACCEPTED_ORIGIN_CLASSES = frozenset(
    {"INSERT_SCHOOL", "INSERT_CLUB", "RENAME_EXPAND", "WHITESPACE_ONLY"})

_KEY_SQL_TYPES = {"source_id": "int", "player_url": "text", "draft_year": "int", "draft_kind": "text"}

_RECONCILIATION_KEYS = {
    "format", "stage_a_label", "effect_digest", "acknowledged_deletions",
    "acknowledged_person_deletions", "acknowledged_protected_rewrites",
    "acknowledged_protected_person_rewrites", "origin_review", "owner_rulings",
}


class ReloadRefused(RuntimeError):
    """The reload guard refused. Nothing has been written."""


# ---------------------------------------------------------------------------
# D-336-3 classifier (a port of
# docs/v2/evidence/issue336-draft-categories-20261105/d3363-classification-20261111/scripts/classify.py)
# ---------------------------------------------------------------------------

_SCHOOL = re.compile(
    r"(College|Grammar|\bSHS\b|\bHS\b|\bSC\b|School|Anglican|Blackfriars|Mount Scopus|"
    r"St Ignatius|Islamic College|\bSS\b)")


def normalise_origin(value: str | None) -> str | None:
    if value is None:
        return None
    value = re.sub(r"\s+", " ", value.replace(" ", " ").replace("​", "")).strip()
    return value or None


def _segments(value: str | None) -> list[str]:
    return [t.strip() for t in value.split("/")] if value else []


def _is_subsequence(small: list[str], big: list[str]) -> bool:
    it = iter(big)
    return all(any(x == y for y in it) for x in small)


def classify_origin_change(stored: str | None, incoming: str | None) -> str:
    """INSERT_SCHOOL / INSERT_CLUB / INSERT_MIXED / RENAME_EXPAND / REPLACE_CLUB / OTHER, as
    classify.py defines them; WHITESPACE_ONLY when only whitespace differs."""
    d_raw, c_raw = normalise_origin(stored), normalise_origin(incoming)
    if d_raw == c_raw:
        return "WHITESPACE_ONLY"
    d, c = _segments(d_raw), _segments(c_raw)
    if _is_subsequence(d, c) and len(c) > len(d):
        inserted = list(c)
        for x in d:
            inserted.remove(x)
        schools = [bool(_SCHOOL.search(t)) for t in inserted]
        kind = "SCHOOL" if all(schools) else "CLUB" if not any(schools) else "MIXED"
        return f"INSERT_{kind}"
    if len(d) == len(c):
        diff = [(a, b) for a, b in zip(d, c) if a != b]
        if len(diff) == 1:
            a, b = diff[0]
            if b.startswith(a + " ") or b.lower().startswith(a.lower()):
                return "RENAME_EXPAND"
            return "REPLACE_CLUB"
    return "OTHER"


# ---------------------------------------------------------------------------
# Reading the stored surface (SELECT only; the matching is PostgreSQL's)
# ---------------------------------------------------------------------------

def _incoming_relation(key_columns: tuple[str, ...]) -> str:
    try:
        casts = ", ".join(f"%s::{_KEY_SQL_TYPES[c]}[]" for c in key_columns)
    except KeyError as exc:                       # a changed reload key must be reviewed here
        raise ReloadRefused(
            f"the reload key names column {exc.args[0]!r}, which the reload guard has no "
            "comparison type for; the guard must be updated with the key") from None
    return f"unnest({casts}) WITH ORDINALITY AS i({', '.join(key_columns)}, ord)"


def _key_arrays(rows: list[dict], key_columns: tuple[str, ...], source_id: int) -> list[list]:
    return [[source_id] * len(rows) if c == "source_id" else [r[c] for r in rows]
            for c in key_columns]


def read_surface(cur, *, source_id: int, picks: list[dict], persons: list[dict],
                 pick_key: tuple[str, ...], person_key: tuple[str, ...]) -> dict:
    """Everything ``compute_effects`` needs, read with SELECT statements only."""
    from common import _key_match, _scope_clause   # the reload's own predicates

    scope_e, scope_params = _scope_clause("e", [("source_id", [source_id], False)])
    pick_arrays = _key_arrays(picks, pick_key, source_id)
    person_arrays = _key_arrays(persons, person_key, source_id)
    pick_rel, person_rel = _incoming_relation(pick_key), _incoming_relation(person_key)
    pick_match, person_match = _key_match("e", "i", pick_key), _key_match("e", "i", person_key)

    pick_cols = (("id", "player_url", "draft_year", "draft_kind", "draft_person_id",
                  "confidence_notes") + PICK_FACT_COLUMNS)
    cur.execute(f"SELECT {', '.join(pick_cols)} FROM public.draft_picks WHERE source_id = %s",
                (source_id,))
    stored_picks = {row[0]: dict(zip(pick_cols, row)) for row in cur.fetchall()}

    cur.execute(f"SELECT e.id, i.ord FROM public.draft_picks e JOIN {pick_rel} "
                f"ON {pick_match} WHERE {scope_e}", (*pick_arrays, *scope_params))
    matched_picks = [(row[0], row[1]) for row in cur.fetchall()]

    cur.execute(f"SELECT e.id FROM public.draft_picks e WHERE {scope_e} AND NOT EXISTS "
                f"(SELECT 1 FROM {pick_rel} WHERE {pick_match})", (*scope_params, *pick_arrays))
    deleted_pick_ids = [row[0] for row in cur.fetchall()]

    person_cols = ("id", "player_url", "confidence_notes", *PERSON_FACT_COLUMNS)
    cur.execute(f"SELECT {', '.join(person_cols)} FROM public.draft_persons WHERE source_id = %s",
                (source_id,))
    stored_persons = {row[0]: dict(zip(person_cols, row)) for row in cur.fetchall()}

    cur.execute(f"SELECT e.id, i.ord FROM public.draft_persons e JOIN {person_rel} "
                f"ON {person_match} WHERE {scope_e}", (*person_arrays, *scope_params))
    matched_persons = [(row[0], row[1]) for row in cur.fetchall()]

    # The statement run_import issues after the pick reload: a person with no pick left. Here a
    # person is "left childless" when the incoming snapshot carries no key for it AND no pick
    # outside the reload scope references it.
    cur.execute(f"SELECT e.id FROM public.draft_persons e WHERE {scope_e} AND NOT EXISTS "
                f"(SELECT 1 FROM {person_rel} WHERE {person_match}) AND NOT EXISTS "
                f"(SELECT 1 FROM public.draft_picks k WHERE k.draft_person_id = e.id "
                f"AND k.source_id IS DISTINCT FROM e.source_id)",
                (*scope_params, *person_arrays))
    deleted_person_ids = [row[0] for row in cur.fetchall()]

    # The audit trail. afldb_import holds SELECT on data_edits since migration 108; a role that
    # cannot read it must stop the run, not be treated as "no audit rows".
    cur.execute("SELECT row_id, bool_or(field_group = %s) FROM public.data_edits "
                "WHERE table_name = 'draft_picks' GROUP BY row_id", (AUDITED_FIELD_GROUP,))
    edit_rows = {int(row[0]): bool(row[1]) for row in cur.fetchall()}

    cur.execute("SELECT entity_key, override_values FROM public.data_overrides "
                "WHERE entity_type = 'draft_picks' AND is_active = true")
    overrides: dict[str, set[str]] = {}
    for entity_key, values in cur.fetchall():
        if not isinstance(entity_key, str) or not entity_key.startswith(f"{source_id}|"):
            continue
        covered = overrides.setdefault(entity_key, set())
        for key, columns in OVERRIDE_COVERS.items():
            if isinstance(values, dict) and key in values:
                if key == "club_slug" and values[key] is None:
                    continue
                covered.update(columns)

    return {
        "stored_picks": stored_picks, "matched_picks": matched_picks,
        "deleted_pick_ids": deleted_pick_ids, "stored_persons": stored_persons,
        "matched_persons": matched_persons, "deleted_person_ids": deleted_person_ids,
        "edit_rows": edit_rows, "overrides": overrides,
    }


# ---------------------------------------------------------------------------
# Effects (pure)
# ---------------------------------------------------------------------------

def incoming_pick_values(pick: dict, club_ids: dict[str, int]) -> dict:
    """The source-owned columns exactly as run_import's ``pick_rows`` writes them."""
    slug = pick["club_slug"]
    return {
        "draft_type": pick["draft_type"], "pick_number": pick["pick_number"],
        "pick_note": pick["pick_note"], "player_name_raw": pick["player_name_raw"],
        "club_id": club_ids.get(slug) if slug else None,
        "club_name_raw": pick["club_name_raw"], "original_club_raw": pick["original_club_raw"],
        "draft_age": pick["draft_age"], "height_cm": pick["height_cm"],
        "weight_kg": None, "grade": None,          # "no source, not imported"
        "competition": pick["competition"], "signing": pick["signing"],
        "signing_kind": pick["signing_kind"], "signing_detail": None,
        "detail": pick["detail"], "source_record_id": pick["source_record_id"],
    }


def _pick_key(row: dict) -> list:
    return [row["player_url"], row["draft_year"], row["draft_kind"]]


def compute_effects(*, source_id: int, surface: dict, picks: list[dict], persons: list[dict],
                    club_ids: dict[str, int]) -> dict:
    stored_picks = surface["stored_picks"]
    edit_rows: dict[int, bool] = surface["edit_rows"]
    overrides: dict[str, set[str]] = surface["overrides"]

    def reasons(row: dict) -> list[str]:
        found = []
        if row["id"] in edit_rows:
            found.append("data_edits")
        notes = row.get("confidence_notes") or ""
        if edit_rows.get(row["id"]) or notes.startswith(AUDITED_PROVENANCE_PREFIXES):
            found.append("audited_insert")
        if row["draft_kind"] is not None and (
                f"{source_id}|{row['player_url']}|{row['draft_year']}|{row['draft_kind']}"
                in overrides):
            found.append("active_override")
        return found

    def covered(row: dict) -> set[str]:
        if row["draft_kind"] is None:
            return set()
        return overrides.get(
            f"{source_id}|{row['player_url']}|{row['draft_year']}|{row['draft_kind']}", set())

    protection = {pid: reasons(row) for pid, row in stored_picks.items()}
    protected_person_ids = {row["draft_person_id"] for pid, row in stored_picks.items()
                            if protection[pid] and row["draft_person_id"] is not None}
    protected_person_ids.update(
        pid for pid, row in surface["stored_persons"].items()
        if (row.get("confidence_notes") or "").startswith(AUDITED_PROVENANCE_PREFIXES))

    deleted_picks = [
        {"id": pid, "key": _pick_key(stored_picks[pid]), "reasons": protection[pid]}
        for pid in sorted(surface["deleted_pick_ids"])]
    deleted_persons = [
        {"id": pid, "player_url": surface["stored_persons"][pid]["player_url"],
         "protected": pid in protected_person_ids}
        for pid in sorted(surface["deleted_person_ids"])]

    origin_changes: list[dict] = []
    protected_rewrites: list[dict] = []
    for pid, ordinal in sorted(surface["matched_picks"]):
        row = stored_picks[pid]
        incoming = incoming_pick_values(picks[ordinal - 1], club_ids)
        skip = covered(row)
        changed = {c: [row[c], incoming[c]] for c in PICK_FACT_COLUMNS
                   if c not in skip and row[c] != incoming[c]}
        if "original_club_raw" in changed:
            before, after = changed["original_club_raw"]
            origin_changes.append({
                "id": pid, "key": _pick_key(row), "year": row["draft_year"],
                "before": before, "after": after,
                "class": classify_origin_change(before, after)})
        if changed and protection[pid]:
            protected_rewrites.append({
                "id": pid, "key": _pick_key(row), "reasons": protection[pid],
                "columns": {c: changed[c] for c in sorted(changed)}})

    protected_person_rewrites: list[dict] = []
    for pid, ordinal in sorted(surface["matched_persons"]):
        if pid not in protected_person_ids:
            continue
        row, incoming = surface["stored_persons"][pid], persons[ordinal - 1]
        changed = {c: [row[c], incoming[c]] for c in PERSON_FACT_COLUMNS if row[c] != incoming[c]}
        if changed:
            protected_person_rewrites.append({
                "id": pid, "player_url": row["player_url"],
                "columns": {c: changed[c] for c in sorted(changed)}})

    return {
        "deleted_picks": deleted_picks, "deleted_persons": deleted_persons,
        "origin_changes": origin_changes, "protected_rewrites": protected_rewrites,
        "protected_person_rewrites": protected_person_rewrites,
    }


def effects_digest(effects: dict) -> str:
    text = json.dumps(effects, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def effects_empty(effects: dict) -> bool:
    return not any(effects[k] for k in effects)


def describe(effects: dict) -> str:
    classes: dict[str, int] = {}
    for change in effects["origin_changes"]:
        classes[change["class"]] = classes.get(change["class"], 0) + 1
    protected_deletions = sum(1 for d in effects["deleted_picks"] if d["reasons"])
    parts = [
        f"{len(effects['deleted_picks'])} pick deletion(s) ({protected_deletions} audited)",
        f"{len(effects['deleted_persons'])} person deletion(s) "
        f"({sum(1 for d in effects['deleted_persons'] if d['protected'])} audited)",
        f"{len(effects['protected_rewrites'])} audited pick rewrite(s)",
        f"{len(effects['protected_person_rewrites'])} audited person rewrite(s)",
        f"{len(effects['origin_changes'])} original_club_raw change(s) "
        f"{dict(sorted(classes.items()))}",
    ]
    return "; ".join(parts)


# ---------------------------------------------------------------------------
# The reviewed reconciliation input
# ---------------------------------------------------------------------------

def load_reconciliation(path: str | None, expected_sha256: str | None) -> dict | None:
    """Static load: no database. ``None`` when neither flag is given."""
    if path is None and expected_sha256 is None:
        return None
    if path is None or expected_sha256 is None:
        raise ReloadRefused("--reconciliation and --reconciliation-sha256 must be given "
                            "together: the reviewed file is pinned by its digest")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ReloadRefused("--reconciliation-sha256 must be 64 lowercase hex characters")
    file = Path(path)
    if not file.is_file():
        raise ReloadRefused(f"reconciliation file not found: {file}")
    data = file.read_bytes()
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected_sha256:
        raise ReloadRefused(f"reconciliation file sha256 {actual} is not the pinned "
                            f"{expected_sha256}; the file is not the one that was reviewed")
    try:
        doc = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ReloadRefused(f"reconciliation file is not valid UTF-8 JSON: {exc}") from None
    return validate_reconciliation(doc)


def validate_reconciliation(doc: Any) -> dict:
    if not isinstance(doc, dict):
        raise ReloadRefused("reconciliation must be a JSON object")
    if doc.get("format") != RECONCILIATION_FORMAT:
        raise ReloadRefused(f"reconciliation format must be {RECONCILIATION_FORMAT!r}")
    unknown = set(doc) - _RECONCILIATION_KEYS
    missing = _RECONCILIATION_KEYS - set(doc)
    if unknown or missing:
        raise ReloadRefused(f"reconciliation keys differ from the contract "
                            f"(unknown {sorted(unknown)}, missing {sorted(missing)})")
    if not isinstance(doc["stage_a_label"], str) or not doc["stage_a_label"]:
        raise ReloadRefused("reconciliation stage_a_label must be a non-empty string")
    if not isinstance(doc["effect_digest"], str) or not re.fullmatch(r"[0-9a-f]{64}",
                                                                    doc["effect_digest"]):
        raise ReloadRefused("reconciliation effect_digest must be 64 lowercase hex characters")
    for name in ("acknowledged_deletions", "acknowledged_person_deletions",
                 "acknowledged_protected_rewrites", "acknowledged_protected_person_rewrites",
                 "origin_review", "owner_rulings"):
        if not isinstance(doc[name], list) or not all(isinstance(e, dict) for e in doc[name]):
            raise ReloadRefused(f"reconciliation {name} must be a list of objects")
    return doc


def _ack_by(entries: list[dict], field: str, name: str, problems: list[str]) -> dict:
    out: dict = {}
    for entry in entries:
        ident = entry.get(field)
        if ident is None or isinstance(ident, bool):
            problems.append(f"{name}: an entry lacks {field}")
            continue
        if ident in out:
            problems.append(f"{name}: {field} {ident!r} is named twice")
        out[ident] = entry
    return out


def _exact(name: str, have: dict, want: dict, problems: list[str]) -> None:
    missing, extra = sorted(set(want) - set(have), key=str), sorted(set(have) - set(want), key=str)
    if missing:
        problems.append(f"{name}: not acknowledged: {missing[:5]}{' ...' if len(missing) > 5 else ''}"
                        f" ({len(missing)})")
    if extra:
        problems.append(f"{name}: acknowledged but not an effect of this run: "
                        f"{extra[:5]}{' ...' if len(extra) > 5 else ''} ({len(extra)})")


def evaluate(effects: dict, digest: str, label: str, reconciliation: dict | None) -> list[str]:
    """Every reason the run may not proceed (empty = proceed)."""
    problems: list[str] = []
    if reconciliation is None:
        if not effects_empty(effects):
            problems.append(
                "this full reload would " + describe(effects) + ". None is acknowledged: a "
                "reviewed reconciliation (--reconciliation FILE --reconciliation-sha256 HEX) "
                "naming these exact keys and effect digest is the only way past; "
                "--acknowledge-population-drop does not apply to this guard")
        return problems

    if reconciliation["stage_a_label"] != label:
        problems.append(f"reconciliation was reviewed for stage_a_label "
                        f"{reconciliation['stage_a_label']!r}, this run uses {label!r}")
    if reconciliation["effect_digest"] != digest:
        problems.append("reconciliation effect_digest does not match the effects of this run "
                        "(the stored data or the incoming snapshot is not what was reviewed)")

    deletions = _ack_by(reconciliation["acknowledged_deletions"], "id",
                        "acknowledged_deletions", problems)
    _exact("pick deletions", deletions, {d["id"]: d for d in effects["deleted_picks"]}, problems)
    for d in effects["deleted_picks"]:
        entry = deletions.get(d["id"])
        if entry is None:
            continue
        if entry.get("key") != d["key"]:
            problems.append(f"pick deletion {d['id']}: acknowledged key differs from the stored key")
        if d["reasons"] and entry.get("acknowledge_audit_orphans") is not True:
            problems.append(f"pick deletion {d['id']} is audited {d['reasons']}: the entry must "
                            "set acknowledge_audit_orphans = true (its data_edits rows would "
                            "point at a deleted id)")

    person_deletions = _ack_by(reconciliation["acknowledged_person_deletions"], "player_url",
                               "acknowledged_person_deletions", problems)
    _exact("person deletions", person_deletions,
           {d["player_url"]: d for d in effects["deleted_persons"]}, problems)

    rewrites = _ack_by(reconciliation["acknowledged_protected_rewrites"], "id",
                       "acknowledged_protected_rewrites", problems)
    _exact("audited pick rewrites", rewrites,
           {r["id"]: r for r in effects["protected_rewrites"]}, problems)
    person_rewrites = _ack_by(reconciliation["acknowledged_protected_person_rewrites"],
                              "player_url", "acknowledged_protected_person_rewrites", problems)
    _exact("audited person rewrites", person_rewrites,
           {r["player_url"]: r for r in effects["protected_person_rewrites"]}, problems)

    review = _ack_by(reconciliation["origin_review"], "id", "origin_review", problems)
    rulings = _ack_by(reconciliation["owner_rulings"], "id", "owner_rulings", problems)
    for change in effects["origin_changes"]:
        if change["class"] == "WHITESPACE_ONLY":
            continue
        pid = change["id"]
        entry = review.get(pid)
        if entry is None:
            problems.append(f"origin change on pick {pid} has no origin_review entry")
        else:
            if entry.get("year") != change["year"]:
                problems.append(f"origin_review {pid}: year {entry.get('year')!r} is not "
                                f"{change['year']!r}")
            if normalise_origin(entry.get("db")) != normalise_origin(change["before"]):
                problems.append(f"origin_review {pid}: stored value differs from the reviewed one")
            if normalise_origin(entry.get("csv")) != normalise_origin(change["after"]):
                problems.append(f"origin_review {pid}: incoming value differs from the reviewed one")
            if entry.get("class") != change["class"]:
                problems.append(f"origin_review {pid}: class {entry.get('class')!r} is not the "
                                f"recomputed {change['class']!r}")
        if change["class"] not in AUTO_ACCEPTED_ORIGIN_CLASSES:
            ruling = rulings.get(pid)
            if (ruling is None or ruling.get("decision") != "accept_incoming"
                    or not isinstance(ruling.get("reference"), str)
                    or not ruling["reference"].strip()):
                problems.append(f"pick {pid} is {change['class']}: it needs an explicit owner "
                                "ruling {id, decision: 'accept_incoming', reference} before the "
                                "importer may replace the stored origin")
    return problems


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def write_report(path: str, label: str, effects: dict, digest: str) -> None:
    doc = {"format": REPORT_FORMAT, "stage_a_label": label, "effect_digest": digest,
           "summary": describe(effects), "effects": effects}
    try:
        with open(path, "x", encoding="utf-8") as handle:
            handle.write(json.dumps(doc, indent=1, ensure_ascii=False, default=str) + "\n")
    except FileExistsError:
        raise ReloadRefused(f"guard report {path} already exists; preserve evidence and "
                            "choose another path") from None


def enforce(cur, rep, *, source_id: int, picks: list[dict], persons: list[dict],
            club_ids: dict[str, int], label: str, reconciliation: dict | None,
            report_path: str | None, pick_key: tuple[str, ...],
            person_key: tuple[str, ...]) -> dict:
    """Raise ``ReloadRefused`` unless the run's effects are empty or fully reconciled."""
    surface = read_surface(cur, source_id=source_id, picks=picks, persons=persons,
                           pick_key=pick_key, person_key=person_key)
    effects = compute_effects(source_id=source_id, surface=surface, picks=picks,
                              persons=persons, club_ids=club_ids)
    digest = effects_digest(effects)
    if report_path:
        write_report(report_path, label, effects, digest)
    # Reporter.result() is the NUMERIC column (a string raises); strings go through value().
    rep.value("reload guard", "clear" if effects_empty(effects) else "REVIEW", describe(effects))
    rep.value("reload guard effect digest", digest)
    problems = evaluate(effects, digest, label, reconciliation)
    if problems:
        raise ReloadRefused("reload guard (AFLDB-ISSUE-348): " + " | ".join(problems)
                            + f" [effect digest {digest}]")
    return {"effects": effects, "digest": digest}
