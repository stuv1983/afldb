#!/usr/bin/env python3
"""Profile acquired AFLDB-ISSUE-093 Stage B1 DraftGuru person pages (runbook §30.8).

Offline, standard library only: no network, no database access, no legacy embedded
data store.  This module reads the raw bytes an earlier acquisition stored and answers
the single Stage B1 question with measured evidence:

    does a DraftGuru person page carry a deterministic
    player_url -> AFL Tables external identity bridge,
    including for the identities AFLDB currently lacks?

Outputs (inside the Stage B1 snapshot only):

    parsed/person_profile.jsonl        one verbatim evidence record per requested person
    parsed/afltables_link_profile.json the aggregate answers (coverage, cohorts,
                                       vocabulary, collisions, convergence pairs)

Hard rules, enforced here and pinned by the test suite:

  * an AFL Tables identity is taken from an ``<a href>`` alone -- **never** inferred
    from a rendered player name;
  * AFL Tables normalisation mirrors ``normalise_profile_url()`` in
    ``tools/migration/import_fitzroy_core.py`` exactly, so a ``www.`` host does **not**
    reduce and is reported as a FINDING rather than silently repaired;
  * ``player_url`` identity is byte-exact -- percent-encoded slug components
    (``%20``, ``%C3%A1``) are never decoded for matching;
  * a stored filename is never identity (``http/persons_index.json`` is the mapping);
  * raw bytes are read, never modified;
  * two DraftGuru persons resolving to one AFL Tables profile is a finding, never an
    instruction to merge.

Page-structure extraction beyond hrefs (display name, DOB, height, original club,
reported games) is explicitly **heuristic** and is labelled as such in every record: the
real DraftGuru person-page structure is validated against real acquired bytes, never
assumed here.

Output files carry no timestamp, so re-profiling identical inputs is byte-identical.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOL_DIR))
import parse_draft_snapshot as snapshot_parser  # noqa: E402  (offline, stdlib only)
import stage_b1_sample as sample_tool           # noqa: E402  (offline, stdlib only)

REPO_ROOT = TOOL_DIR.parents[2]

PROFILER = "tools/rebuild/draftguru/profile_person_pages.py"
PROFILER_VERSION = "1.0.0"
PROFILE_CONTRACT_VERSION = 1

ANNUAL_LABEL_IN_PATH = re.compile(r"annual-html-[0-9]{8}")

# Heuristic field probes.  Deliberately conservative: a miss is recorded as "not
# exposed", never guessed, and nothing here ever contributes to identity.
HEIGHT_RE = re.compile(r"\b(\d{2,3})\s?cm\b")
DOB_ISO_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
DOB_TEXT_RE = re.compile(
    r"\b(\d{1,2}[ /-](?:January|February|March|April|May|June|July|August|September|"
    r"October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
    r"[ /-]\d{4})\b", re.IGNORECASE)
GAMES_LABEL_RE = re.compile(r"\b(games)\b", re.IGNORECASE)


class ProfileError(Exception):
    """A Stage B1 profiling contract violation.  Always fails closed."""


# ---------------------------------------------------------------------------
# AFL Tables link vocabulary (contract person_stage.afltables_link)
# ---------------------------------------------------------------------------

def normalise_afltables_url(url: str | None) -> str | None:
    """Exact mirror of ``import_fitzroy_core.normalise_profile_url``.

    Deliberately NOT broadened: the prefix strip is anchored on the bare
    ``afltables.com`` host, so ``https://www.afltables.com/...`` does not reduce.
    That non-reduction is a Stage B1 finding, not a defect to paper over here --
    broadening it would silently change the external-identity form AFLDB already
    stores.
    """
    if not url:
        return None
    path = url.strip().replace("../", "")
    path = re.sub(r"^https?://afltables\.com/afl/stats/", "", path)
    return path.lstrip("/") or None


def _split_url(href: str) -> tuple[str, str, str]:
    """(scheme, host, rest) without importing any network module."""
    text = href.strip()
    match = re.match(r"^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]*)(.*)$", text)
    if not match:
        return "", "", text
    return match.group(1).lower(), match.group(2).lower(), match.group(3)


def classify_afltables_href(contract: dict, href: str) -> dict:
    """Classify one href against the approved AFL Tables vocabulary."""
    link = contract["person_stage"]["afltables_link"]
    path_re = re.compile(link["path_regex"])
    scheme, host, _rest = _split_url(href)
    normalised = normalise_afltables_url(href)
    reduces = bool(normalised) and "://" not in normalised
    record = {
        "href": href,                       # verbatim, never rewritten
        "scheme": scheme or None,
        "host": host or None,
        "absolute": bool(scheme),
        "normalised": normalised,
        "reduces": reduces,
        "path_shape_ok": bool(normalised) and reduces and bool(path_re.match(normalised)),
    }

    if not record["absolute"]:
        record["classification"] = "malformed"
        record["reason"] = ("AFL Tables reference is not an absolute URL -- identity "
                            "cannot be established from a relative href")
    elif host not in link["hosts"]:
        record["classification"] = "not_afltables"
        record["reason"] = f"host {host!r} is outside the recognised AFL Tables vocabulary"
    elif scheme not in link["schemes"]:
        record["classification"] = "malformed"
        record["reason"] = f"scheme {scheme!r} is outside the recognised schemes"
    elif not reduces:
        record["classification"] = "non_reducing_host"
        record["reason"] = (
            "host does not reduce under the existing canonicaliser "
            f"({link['normalisation']['strip_prefix_regex']}) -- FINDING, reported and "
            "never silently repaired or normalised more broadly")
    elif not record["path_shape_ok"]:
        record["classification"] = "unexpected_path"
        record["reason"] = (f"reduced to {normalised!r}, which is not the expected "
                            f"{link['path_shape']} shape")
    else:
        record["classification"] = "canonical"
        record["reason"] = None
    return record


def is_afltables_reference(href: str) -> bool:
    """A candidate worth classifying: mentions the AFL Tables host in any form."""
    return "afltables" in href.lower()


# ---------------------------------------------------------------------------
# HTML extraction (tolerant on purpose -- the live structure is being profiled,
# not asserted; a parse problem is a finding, never a silent repair)
# ---------------------------------------------------------------------------

class _PersonPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.h1_parts: list[list[str]] = []
        # Real DraftGuru person pages carry the display name in <h2 class="heading">
        # and have no <h1> at all (measured on the 2026-08-26 probe bytes). Captured as
        # display evidence only -- rendered text is never identity.
        self.h2_parts: list[list[str]] = []
        self.anchors: list[dict] = []
        self.meta: list[dict] = []
        self.labelled: list[dict] = []
        self.text_parts: list[str] = []
        self._in_title = False
        self._h1_depth = 0
        self._h2_depth = 0
        self._anchor: dict | None = None
        self._cell: list[str] | None = None
        self._cell_kind: str | None = None
        self._pending_label: str | None = None
        self.parse_error: str | None = None

    # -- structural ------------------------------------------------------
    def handle_starttag(self, tag: str, attrs) -> None:
        attributes = {name: (value or "") for name, value in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "h1":
            self._h1_depth += 1
            self.h1_parts.append([])
        elif tag == "h2":
            self._h2_depth += 1
            self.h2_parts.append([])
        elif tag == "meta":
            key = attributes.get("property") or attributes.get("name")
            if key and "content" in attributes:
                self.meta.append({"key": key, "content": attributes["content"]})
        elif tag == "a":
            href = attributes.get("href")
            if href is not None:
                self._anchor = {"index": len(self.anchors), "href": href, "text_parts": []}
        elif tag in ("dt", "th"):
            self._cell = []
            self._cell_kind = "label"
        elif tag in ("dd", "td"):
            self._cell = []
            self._cell_kind = "value"

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag == "h1" and self._h1_depth > 0:
            self._h1_depth -= 1
        elif tag == "h2" and self._h2_depth > 0:
            self._h2_depth -= 1
        elif tag == "a" and self._anchor is not None:
            self._anchor["text"] = _clean(" ".join(self._anchor.pop("text_parts")))
            self.anchors.append(self._anchor)
            self._anchor = None
        elif tag in ("dt", "th", "dd", "td") and self._cell is not None:
            text = _clean(" ".join(self._cell))
            if self._cell_kind == "label":
                self._pending_label = text
            elif self._pending_label:
                self.labelled.append({"label": self._pending_label, "value": text})
                self._pending_label = None
            self._cell = None
            self._cell_kind = None

    def handle_data(self, data: str) -> None:
        self.text_parts.append(data)
        if self._in_title:
            self.title_parts.append(data)
        if self._h1_depth > 0 and self.h1_parts:
            self.h1_parts[-1].append(data)
        if self._h2_depth > 0 and self.h2_parts:
            self.h2_parts[-1].append(data)
        if self._anchor is not None:
            self._anchor["text_parts"].append(data)
        if self._cell is not None:
            self._cell.append(data)


def _clean(text: str) -> str:
    """Collapse ASCII whitespace for readability.  Never applied to hrefs."""
    return re.sub(r"[ \t\r\n]+", " ", text).strip()


def extract_page(raw: bytes, http_record: dict) -> dict:
    """Decode a stored page and extract link + display evidence.  Raw bytes are
    read only; nothing on disk is touched."""
    charset, charset_source = snapshot_parser.declared_charset(raw, http_record)
    try:
        text = raw.decode(charset, errors="replace")
    except LookupError:
        charset, charset_source = "utf-8", f"{charset_source} unknown to Python -- fell back"
        text = raw.decode("utf-8", errors="replace")
    parser = _PersonPageParser()
    try:
        parser.feed(text)
        parser.close()
    except Exception as exc:                       # noqa: BLE001 -- a finding, not a crash
        parser.parse_error = f"{type(exc).__name__}: {exc}"

    visible = _clean(" ".join(parser.text_parts))
    title = _clean(" ".join(parser.title_parts)) or None
    h1s = [_clean(" ".join(parts)) for parts in parser.h1_parts]
    h1s = [h for h in h1s if h]
    h2s = [_clean(" ".join(parts)) for parts in parser.h2_parts]
    h2s = [h for h in h2s if h]

    labelled = parser.labelled
    def labelled_matching(pattern: re.Pattern) -> list[dict]:
        return [item for item in labelled if pattern.search(item["label"])]

    return {
        "charset": charset,
        "charset_source": charset_source,
        "encoding_artefacts": snapshot_parser.encoding_counts(text),
        "parse_error": parser.parse_error,
        "title": title,
        "h1": h1s[0] if h1s else None,
        "h1_all": h1s,
        "h2": h2s[0] if h2s else None,
        "h2_all": h2s[:10],
        "display_name_evidence": {
            "$note": "display text only — recorded as evidence, NEVER used for identity "
                     "matching. Real person pages carry the name in <title> and "
                     "<h2 class=\"heading\">, with no <h1>.",
            "title": title,
            "h1": h1s[0] if h1s else None,
            "h2": h2s[0] if h2s else None,
        },
        "meta": parser.meta[:20],
        "anchors": parser.anchors,
        "labelled_fields": labelled[:60],
        "heuristic_fields": {
            "$basis": "heuristic scan of the decoded page -- pending validation against "
                      "real Stage B1 person bytes; NEVER identity",
            "dob_candidates": sorted(set(DOB_ISO_RE.findall(visible))
                                     | set(DOB_TEXT_RE.findall(visible)))[:5],
            "height_candidates": sorted({f"{m}cm" for m in HEIGHT_RE.findall(visible)})[:5],
            "games_labelled": labelled_matching(GAMES_LABEL_RE)[:10],
        },
        "visible_text_length": len(visible),
    }


# ---------------------------------------------------------------------------
# Per-person profiling
# ---------------------------------------------------------------------------

def profile_person(contract: dict, person: dict, http_record: dict | None,
                   raw: bytes | None) -> dict:
    """Build one verbatim evidence record for one requested identity."""
    person_url_re = re.compile(contract["person_stage"]["person_url_pattern"])
    vocabulary_hosts = set(contract["person_stage"]["external_vocabulary_hosts"])
    base_host = _split_url(contract["base_url"])[1]
    player_url = person["player_url"]

    record: dict = {
        "player_url": player_url,                 # byte-exact identity, never decoded
        "slug": person["slug"],
        "ordinal": person["ordinal"],
        "primary_cohort": person["primary_cohort"],
        "eligibility_tags": person.get("eligibility_tags", []),
        "requested_url": (http_record or {}).get("url", player_url),
        "final_url": (http_record or {}).get("final_url"),
        "http_status": (http_record or {}).get("http_status"),
        "terminal_classification": (http_record or {}).get("terminal_classification"),
        "attempts": (http_record or {}).get("attempts", []),
        "raw_filename": (http_record or {}).get("raw_filename"),
        "raw_sha256": (http_record or {}).get("sha256"),
        "byte_size": (http_record or {}).get("byte_size"),
        "content_type": (http_record or {}).get("content_type"),
    }
    record["redirected"] = bool(record["final_url"]) and record["final_url"] != record["requested_url"]
    record["redirect_evidence"] = {
        "requested": record["requested_url"],
        "final": record["final_url"],
        "redirected": record["redirected"],
        "$note": "the acquisition opener surfaces the final URL only; no intermediate "
                 "chain is claimed",
    }

    if raw is None or record["terminal_classification"] != "fetched":
        record.update({
            "profiled": False,
            "page": None,
            "afltables_hrefs": [],
            "afltables_href_count": 0,
            "distinct_afltables_identities": [],
            "distinct_afltables_identity_count": 0,
            "afltables_identity": None,
            "afltables_identity_reason": "page was not fetched -- terminal failure record",
            "draftguru_self_links": [],
            "external_vocabulary": [],
            "flags": {
                "no_afltables_link": True,
                "multiple_afltables_candidates": False,
                "malformed_afltables_link": False,
                "missing_or_dead_page": True,
                "self_link_disagreement": False,
                "non_reducing_host": False,
                "parse_error": False,
            },
            "failure_reason": (http_record or {}).get("reason"),
        })
        return record

    page = extract_page(raw, http_record or {})
    anchors = page.pop("anchors")

    afltables: list[dict] = []
    self_links: list[dict] = []
    vocabulary: list[dict] = []
    for anchor in anchors:
        href = anchor["href"]
        if is_afltables_reference(href):
            classified = classify_afltables_href(contract, href)
            classified["document_index"] = anchor["index"]
            classified["anchor_text"] = anchor.get("text", "")
            classified["$note"] = "identity comes from this href alone; the anchor text is " \
                                  "recorded as evidence and is never identity"
            afltables.append(classified)
            continue
        scheme, host, _rest = _split_url(href)
        if host and host != base_host:
            # Every non-DraftGuru external host is recorded as vocabulary/evidence.
            # Measurement only: no host here is ever an identity source, and only the
            # AFL Tables vocabulary above can produce an external identity.
            vocabulary.append({
                "host": host,
                "href": href,                       # verbatim
                "anchor_text": anchor.get("text", ""),
                "document_index": anchor["index"],
                "recognised_vocabulary": host in vocabulary_hosts,
                "$note": "vocabulary/evidence only — never an identity source",
            })
        candidate = href if scheme else (contract["base_url"] + href if href.startswith("/") else None)
        if candidate and person_url_re.match(candidate):
            self_links.append({"href": href, "canonical": candidate,
                               "document_index": anchor["index"]})

    canonical_ids = sorted({item["normalised"] for item in afltables
                            if item["classification"] == "canonical"})
    malformed = [item for item in afltables
                 if item["classification"] in ("malformed", "unexpected_path")]
    non_reducing = [item for item in afltables if item["classification"] == "non_reducing_host"]

    if len(canonical_ids) == 1:
        identity, reason = canonical_ids[0], None
    elif not canonical_ids:
        identity = None
        reason = ("no href reduced to a canonical AFL Tables identity"
                  if afltables else "no AFL Tables href on the page")
    else:
        identity = None
        reason = (f"{len(canonical_ids)} distinct AFL Tables identities on one page -- "
                  "ambiguous, reported and never resolved by guessing")

    disagreeing = [link for link in self_links if link["canonical"] != player_url]

    record.update({
        "profiled": True,
        "page": page,
        "afltables_hrefs": afltables,
        "afltables_href_count": len(afltables),
        "distinct_afltables_identities": canonical_ids,
        "distinct_afltables_identity_count": len(canonical_ids),
        "afltables_identity": identity,
        "afltables_identity_reason": reason,
        "draftguru_self_links": self_links,
        "external_vocabulary": vocabulary,
        "flags": {
            "no_afltables_link": not afltables,
            "multiple_afltables_candidates": len(canonical_ids) > 1,
            "malformed_afltables_link": bool(malformed),
            "missing_or_dead_page": False,
            "self_link_disagreement": bool(disagreeing),
            "non_reducing_host": bool(non_reducing),
            "parse_error": page["parse_error"] is not None,
        },
        "failure_reason": None,
    })
    return record


# ---------------------------------------------------------------------------
# Aggregate (runbook §30.8 questions 1-10)
# ---------------------------------------------------------------------------

def _pct(part: int, whole: int) -> float | None:
    return None if whole == 0 else round(100.0 * part / whole, 2)


def aggregate(contract: dict, sample: dict, records: list[dict]) -> dict:
    by_url = {r["player_url"]: r for r in records}
    cohorts = contract["person_stage"]["sample_contract"]["primary_cohorts"]

    fetched = [r for r in records if r["terminal_classification"] == "fetched"]
    failed = [r for r in records if r["terminal_classification"] == "failed"]
    with_identity = [r for r in fetched if r["afltables_identity"]]

    cohort_rows: dict[str, dict] = {}
    for cohort in cohorts:
        members = [r for r in records if r["primary_cohort"] == cohort]
        got = [r for r in members if r["afltables_identity"]]
        cohort_rows[cohort] = {
            "persons": len(members),
            "fetched": len([r for r in members if r["terminal_classification"] == "fetched"]),
            "with_afltables_identity": len(got),
            "coverage_pct": _pct(len(got), len(members)),
        }

    vocabulary: dict[str, int] = {}
    for record in records:
        for href in record["afltables_hrefs"]:
            key = f"{href['scheme'] or '?'}://{href['host'] or '?'} [{href['classification']}]"
            vocabulary[key] = vocabulary.get(key, 0) + 1

    external_hosts: dict[str, int] = {}
    unrecognised_hosts: set[str] = set()
    for record in records:
        for link in record["external_vocabulary"]:
            external_hosts[link["host"]] = external_hosts.get(link["host"], 0) + 1
            if not link.get("recognised_vocabulary"):
                unrecognised_hosts.add(link["host"])

    collisions: dict[str, list[str]] = {}
    for record in with_identity:
        collisions.setdefault(record["afltables_identity"], []).append(record["player_url"])
    collision_findings = [
        {"afltables_identity": identity, "player_urls": sorted(urls),
         "$note": "two DraftGuru persons resolving to one AFL Tables profile is a FINDING, "
                  "never an instruction to merge"}
        for identity, urls in sorted(collisions.items()) if len(urls) > 1]

    pairs: dict[str, list[dict]] = {}
    for record in records:
        if record["primary_cohort"] == "convergence":
            pairs.setdefault(record["slug"], []).append(record)
    convergence = []
    for slug in sorted(pairs):
        members = sorted(pairs[slug], key=lambda r: r["ordinal"])
        identities = [m["afltables_identity"] for m in members]
        resolved = [i for i in identities if i]
        convergence.append({
            "slug": slug,
            "members": [{"player_url": m["player_url"], "ordinal": m["ordinal"],
                         "afltables_identity": m["afltables_identity"],
                         "reason": m["afltables_identity_reason"],
                         "terminal_classification": m["terminal_classification"]}
                        for m in members],
            "both_resolved": len(resolved) == len(members),
            "distinct_identities": (len(set(resolved)) == len(members)
                                    if len(resolved) == len(members) else None),
            "$note": "these pairs are proven DIFFERENT people; a shared AFL Tables identity "
                     "would contradict the source, not the AFLDB model",
        })

    return {
        "$comment": "AFLDB-ISSUE-093 Stage B1 aggregate AFL Tables link profile (runbook "
                    "§30.8). Profiling evidence only -- never an import source, never a "
                    "merge instruction. Timestamp-free so re-profiling is byte-identical.",
        "stage": "B1",
        "profile_contract_version": PROFILE_CONTRACT_VERSION,
        "profiler": PROFILER,
        "profiler_version": PROFILER_VERSION,
        "snapshot_label": sample["snapshot_label"],
        "identity_complete": False,
        "import_capable": False,
        "sample_basis": {
            "total": sample["counts"]["total"],
            "by_primary_cohort": sample["counts"]["by_primary_cohort"],
            "residual_input_sha256": sample["residual_input"]["sha256"],
            "stage_a_label": sample["stage_a_source"]["label"],
            "stage_a_manifest_sha256": sample["stage_a_source"]["manifest_sha256"],
        },
        "counts": {
            "requested": len(records),
            "fetched": len(fetched),
            "failed": len(failed),
            "profiled": len([r for r in records if r["profiled"]]),
            "with_afltables_identity": len(with_identity),
            "without_afltables_link": len([r for r in fetched if r["flags"]["no_afltables_link"]]),
            "multiple_candidates": len([r for r in fetched
                                        if r["flags"]["multiple_afltables_candidates"]]),
            "malformed_links": len([r for r in fetched
                                    if r["flags"]["malformed_afltables_link"]]),
            "non_reducing_host": len([r for r in fetched if r["flags"]["non_reducing_host"]]),
            "self_link_disagreement": len([r for r in fetched
                                           if r["flags"]["self_link_disagreement"]]),
            "parse_errors": len([r for r in fetched if r["flags"]["parse_error"]]),
        },
        "coverage": {
            "overall_pct_of_requested": _pct(len(with_identity), len(records)),
            "overall_pct_of_fetched": _pct(len(with_identity), len(fetched)),
            "by_primary_cohort": cohort_rows,
        },
        "residual_bridge": {
            "$question": "how many of the 68 residual identities gain a usable AFL Tables "
                         "identity directly from DraftGuru?",
            **cohort_rows.get("residual", {}),
        },
        "zero_game_bridge": cohort_rows.get("zero_game_control", {}),
        "url_form_vocabulary": dict(sorted(vocabulary.items())),
        "external_vocabulary_hosts": dict(sorted(external_hosts.items())),
        "external_vocabulary_hosts_outside_contract": sorted(unrecognised_hosts),
        "$external_vocabulary_note": "measurement only — no external host other than the "
                                     "AFL Tables vocabulary can ever yield an identity",
        "collisions": collision_findings,
        "convergence_pairs": convergence,
        "failures": [{"player_url": r["player_url"],
                      "terminal_classification": r["terminal_classification"],
                      "http_status": r["http_status"],
                      "reason": r["failure_reason"]}
                     for r in sorted(failed, key=lambda r: r["player_url"])],
        "unresolved_identities": [
            {"player_url": r["player_url"], "primary_cohort": r["primary_cohort"],
             "reason": r["afltables_identity_reason"]}
            for r in sorted(fetched, key=lambda r: r["player_url"])
            if not r["afltables_identity"]],
        "$missing_from_sample": sorted(set(p["player_url"] for p in sample["persons"])
                                       - set(by_url)),
    }


# ---------------------------------------------------------------------------
# Snapshot IO
# ---------------------------------------------------------------------------

def assert_inside_snapshot(path: Path, person_dir: Path) -> Path:
    """Structural refusal: Stage B1 never writes outside its own snapshot, and never
    into an accepted annual Stage A snapshot."""
    resolved = path.resolve()
    if ANNUAL_LABEL_IN_PATH.search(resolved.as_posix()):
        raise ProfileError(
            f"refusing to write into an accepted annual Stage A snapshot path: {resolved}")
    if person_dir != resolved and person_dir not in resolved.parents:
        raise ProfileError(
            f"refusing to write outside the Stage B1 snapshot {person_dir}: {resolved}")
    return resolved


def person_filename(contract: dict, person: dict) -> str:
    """``<slug>__<ordinal>`` -- a storage name, never identity."""
    charset = contract["person_stage"]["person_snapshot"]["slug_filename_charset"]
    slug = person["slug"]
    if not re.match(charset, slug):
        raise ProfileError(
            f"slug {slug!r} contains characters outside the accepted filename charset "
            f"{charset} -- refusing rather than inventing an escaping rule")
    return f"{slug}__{int(person['ordinal'])}"


def load_sample(contract: dict, person_dir: Path, sample_path: Path | None) -> dict:
    path = sample_path or (person_dir / "sample.json")
    if not path.is_file():
        raise ProfileError(f"missing Stage B1 sample.json: {path}")
    sample = json.loads(path.read_bytes().decode("utf-8"))
    expected = contract["person_stage"]["sample_contract"]
    if sample.get("counts", {}).get("total") != expected["total"]:
        raise ProfileError(
            f"sample.json holds {sample.get('counts', {}).get('total')} persons, contract "
            f"requires {expected['total']}")
    if sample.get("counts", {}).get("by_primary_cohort") != expected["primary_cohorts"]:
        raise ProfileError("sample.json primary_cohort counts do not match the frozen contract")
    return sample


def load_person_artifacts(contract: dict, person_dir: Path, person: dict
                          ) -> tuple[dict | None, bytes | None]:
    stem = person_filename(contract, person)
    http_path = person_dir / "http" / "persons" / f"{stem}.json"
    raw_path = person_dir / "raw" / "persons" / f"{stem}.html"
    if not http_path.is_file():
        return None, None
    http_record = json.loads(http_path.read_bytes().decode("utf-8"))
    if http_record.get("player_url") != person["player_url"]:
        raise ProfileError(
            f"{http_path} records player_url {http_record.get('player_url')!r} but the sample "
            f"requested {person['player_url']!r} -- a filename is never identity, refusing")
    raw = raw_path.read_bytes() if raw_path.is_file() else None
    return http_record, raw


def run_profile(contract: dict, person_dir: Path, sample: dict, *,
                require_complete: bool, write: bool = True) -> dict:
    """Profile every person in the sample.  Offline; nothing is fetched here."""
    records = []
    for person in sorted(sample["persons"], key=lambda p: (p["slug"], int(p["ordinal"]))):
        http_record, raw = load_person_artifacts(contract, person_dir, person)
        if http_record is None:
            if require_complete:
                raise ProfileError(
                    f"{person['player_url']} has no terminal classification -- the "
                    "experiment is incomplete and must not be profiled as complete")
            continue
        records.append(profile_person(contract, person, http_record, raw))

    if require_complete:
        terminal = [r for r in records if r["terminal_classification"] in ("fetched", "failed")]
        if len(terminal) != len(sample["persons"]):
            raise ProfileError(
                f"{len(terminal)} of {len(sample['persons'])} identities carry a terminal "
                "classification -- incomplete experiment")

    summary = aggregate(contract, sample, records)

    paths = {}
    if write:
        profile_path = assert_inside_snapshot(
            person_dir / "parsed" / "person_profile.jsonl", person_dir)
        link_path = assert_inside_snapshot(
            person_dir / "parsed" / "afltables_link_profile.json", person_dir)
        payload = "".join(
            json.dumps(r, ensure_ascii=True, sort_keys=True) + "\n" for r in records)
        sample_tool.atomic_write_bytes(profile_path, payload.encode("utf-8"))
        sample_tool.atomic_write_bytes(link_path, sample_tool.dump_bytes(summary))
        paths = {"person_profile": profile_path, "afltables_link_profile": link_path}

    return {"records": records, "aggregate": summary, "paths": paths}


# ---------------------------------------------------------------------------
# CLI (validation/debugging; the accepted full run is orchestrated by
# acquire_persons.py, which writes the manifest LAST)
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", required=True, help="Stage B1 snapshot label")
    parser.add_argument("--snapshot-root", help="override the contract snapshot root")
    parser.add_argument("--sample", help="override the sample.json path")
    parser.add_argument("--require-complete", action="store_true",
                        help="fail unless all sampled identities are terminally classified")
    parser.add_argument("--no-write", action="store_true",
                        help="profile and print the aggregate without writing parsed/ output")
    args = parser.parse_args(argv)

    try:
        contract = snapshot_parser.load_contract()
        person_dir = sample_tool.resolve_person_snapshot_dir(
            contract, args.snapshot_root, args.label)
        sample = load_sample(contract, person_dir,
                             Path(args.sample) if args.sample else None)
        outcome = run_profile(contract, person_dir, sample,
                              require_complete=args.require_complete,
                              write=not args.no_write)
        summary = outcome["aggregate"]
        print(json.dumps({
            "label": args.label,
            "counts": summary["counts"],
            "coverage": summary["coverage"],
            "collisions": len(summary["collisions"]),
            "written": {k: str(v) for k, v in outcome["paths"].items()},
        }, ensure_ascii=True, sort_keys=True, indent=2))
        return 0
    except (ProfileError, sample_tool.SampleError, snapshot_parser.ParseFailure) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
