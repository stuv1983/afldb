#!/usr/bin/env python3
"""AFLDB-ISSUE-093 section 13.5 -- DraftGuru annual-snapshot validation parser.

Consumes ONLY an acquired snapshot under data/sources/draftguru/<label>/
(raw server-response bytes plus per-request HTTP records) and derives the
deterministic parsed outputs:

    parsed/rows.jsonl                one record per table row
    parsed/persons.jsonl             one record per distinct player_url
    parsed/schema.json               per-year header fingerprints + encoding counts
    parsed/trade_column_profile.json runbook section 9 profile

Contract (issues/closed/AFLDB-ISSUE-093-DRAFTGURU-ACQUISITION-HANDOFF.md section 6):

  * no database access of any kind -- pure stdlib, importable everywhere;
  * never touches the live site; never reads the CSV corpus except in the
    explicitly separate parity stage (--parity, runbook section 7);
  * fails closed on any unknown header/schema drift, on any row without a
    player href, and on any player URL that does not match the canonical
    stored form settled by U1 (2026-08-26):
        https://www.draftguru.com.au/players/<slug>/<ordinal>
  * the ordinal path segment is durable person identity and is preserved
    exactly -- /players/brad_miller/1 and /players/brad_miller/2 are two
    persons forever, despite identical rendered names;
  * blank means absence and becomes null, never 0; Games/Goals/Coaches/
    Brownlow are captured for parity only and are never emitted as facts;
  * raw/ is the source of truth and is strictly read-only here -- every
    normalisation is a comparison-time function on preserved bytes.

Entry point:

    python tools/rebuild/draftguru/parse_draft_snapshot.py \
        --label <snapshot-label> [--validate-only] [--require-complete] \
        [--parity [--parity-dir DIR]] [--accept-baseline-drift]

Exit is non-zero on any contract violation, with the failing year/row
identified.

This file is deliberately pure ASCII; every special codepoint is built with
chr() so no editor or transport can silently normalise it.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import unicodedata
from html.parser import HTMLParser
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOL_DIR.parents[2]
CONTRACT_PATH = TOOL_DIR / "draftguru-contract.json"

NBSP = chr(0x00A0)            # no-break space: every CSV player name uses it
ZWSP = chr(0x200B)            # zero-width space: after '/' in Original Club
DOWN_ARROW = chr(0x21A7)      # the sort glyph baked into the selection header
MOJIBAKE_SIGNATURE = chr(0x00C3)  # CP1252/Latin-1 mojibake signature byte

FROZEN_CSV_LABEL = "full-history-20260826"


class ParseFailure(Exception):
    """A contract violation. Message always identifies year/row where known."""


# ---------------------------------------------------------------------------
# Contract
# ---------------------------------------------------------------------------

def load_contract() -> dict:
    with open(CONTRACT_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def build_year_url(contract: dict, year: int) -> str:
    return contract["year_url_pattern"].format(base_url=contract["base_url"], year=year)


def canonicalise_player_href(contract: dict, href: str) -> tuple[str, str, int]:
    """Normalise a player href to the canonical stored form (U1).

    Root-relative hrefs are resolved against the single base URL constant;
    already-canonical absolute URLs pass through unchanged (idempotent).
    Anything else -- other hosts, http scheme, trailing slash, missing or
    non-numeric ordinal -- fails closed.
    """
    base = contract["base_url"]
    href = href.strip()
    if href.startswith("/"):
        url = base + href
    else:
        url = href
    if not re.match(contract["canonical_player_url"]["regex"], url):
        raise ParseFailure(
            f"player href {href!r} does not normalise to the canonical form "
            f"{contract['canonical_player_url']['form']} (got {url!r})")
    slug, ordinal = url.rsplit("/", 2)[-2:]
    return url, slug, int(ordinal)


# ---------------------------------------------------------------------------
# HTML table extraction (stdlib html.parser; entities expanded to characters)
# ---------------------------------------------------------------------------

class _Cell:
    __slots__ = ("parts", "links")

    def __init__(self) -> None:
        self.parts: list[str] = []
        self.links: list[str] = []

    def text(self) -> str:
        # Collapse ASCII whitespace runs introduced by HTML source formatting;
        # NBSP/ZWSP and every other non-ASCII codepoint are preserved verbatim.
        raw = "".join(self.parts)
        return re.sub(r"[ \t\r\n]+", " ", raw).strip(" \t\r\n")


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[_Cell]]] = []
        self._table: list[list[_Cell]] | None = None
        self._row: list[_Cell] | None = None
        self._cell: _Cell | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "table":
            if self._table is not None:
                raise ParseFailure(
                    "nested <table> encountered -- schema drift, refusing to parse")
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = _Cell()
        elif tag == "a" and self._cell is not None:
            for name, value in attrs:
                if name == "href" and value is not None:
                    self._cell.links.append(value)
        elif tag == "br" and self._cell is not None:
            # A <br> is real node separation in the source, not decoration: the
            # live Pick/Signing cells write 'Priority<br/>(Fremantle)' and
            # 'Father-Son<br/>(<a ...>Gary Ablett</a>)'. Concatenating the text
            # nodes across it would fuse them ('Priority(Fremantle)'). Emit a
            # newline, which _Cell.text()'s existing ASCII-whitespace collapse
            # reduces to exactly one space -- matching how the browser renders
            # the break, and no new trimming rule. html.parser routes both <br>
            # and <br/> through handle_starttag.
            self._cell.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "table" and self._table is not None:
            self.tables.append(self._table)
            self._table = None
        elif tag == "tr" and self._row is not None:
            if self._table is not None:
                self._table.append(self._row)
            self._row = None
        elif tag in ("td", "th") and self._cell is not None:
            if self._row is not None:
                self._row.append(self._cell)
            self._cell = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.parts.append(data)


def _normalise_header_cell(text: str) -> str:
    # Headers only: unify every whitespace codepoint (including NBSP) to a
    # single space so the selection header compares stably however the source
    # spaces it.
    return " ".join(text.split())


def header_fingerprint(columns: list[str]) -> str:
    payload = json.dumps(columns, ensure_ascii=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def accepted_headers_for_year(contract: dict, year: int) -> list[list[str]]:
    for variant in contract["csv_schema_variants"].values():
        if year in variant["years"]:
            cols = list(variant["columns"])
            return [cols, cols + ["Trade"]]
    raise ParseFailure(f"year={year}: not covered by any pinned schema variant")


# ---------------------------------------------------------------------------
# Field parsing
# ---------------------------------------------------------------------------

def blank_to_none(text: str) -> str | None:
    return text if text != "" else None


def parse_pick_number(text: str | None, *, year: int, row_index: int) -> int | None:
    """Selection number: blank is not-applicable and becomes None, never 0.

    Accepts plain integers and the float-formatted integers ('55.0') the
    15-column exports carry.
    """
    if text is None:
        return None
    match = re.fullmatch(r"([0-9]+)(?:\.0)?", text.strip())
    if not match or int(match.group(1)) <= 0:
        raise ParseFailure(
            f"year={year} row={row_index}: selection number {text!r} is not a "
            "positive integer")
    return int(match.group(1))


def parse_club_cell(contract: dict, cell: _Cell) -> tuple[str, str | None, str | None]:
    name = cell.text()
    href = cell.links[0] if cell.links else None
    slug = None
    if href is not None:
        match = re.fullmatch(
            r"(?:%s)?/clubs/([^/]+)" % re.escape(contract["base_url"]), href.strip())
        if match:
            slug = match.group(1)
    return name, href, slug


def encoding_counts(text: str) -> dict:
    return {
        "nbsp": text.count(NBSP),
        "zwsp": text.count(ZWSP),
        "downward_arrow": text.count(DOWN_ARROW),
        "mojibake_signature": text.count(MOJIBAKE_SIGNATURE),
    }


def declared_charset(raw: bytes, http_record: dict) -> tuple[str, str]:
    """(charset, provenance). HTTP Content-Type wins; else a <meta> in the
    first 2KB; else utf-8 by default."""
    content_type = http_record.get("content_type") or ""
    match = re.search(r"charset=([A-Za-z0-9_\-]+)", content_type)
    if match:
        return match.group(1).lower(), "http-content-type"
    head = raw[:2048].decode("ascii", errors="replace")
    match = re.search(r"<meta[^>]+charset=[\"']?([A-Za-z0-9_\-]+)", head, re.IGNORECASE)
    if match:
        return match.group(1).lower(), "meta-charset"
    return "utf-8", "default"


# ---------------------------------------------------------------------------
# Year parsing
# ---------------------------------------------------------------------------

def parse_year(contract: dict, year: int, raw: bytes, http_record: dict) -> tuple[list[dict], dict]:
    charset, charset_provenance = declared_charset(raw, http_record)
    try:
        document = raw.decode(charset)
    except (UnicodeDecodeError, LookupError) as exc:
        raise ParseFailure(
            f"year={year}: cannot decode raw bytes as {charset!r}: {exc}") from exc

    raw_counts = encoding_counts(document)

    parser = _TableParser()
    parser.feed(document)
    parser.close()

    accepted = accepted_headers_for_year(contract, year)
    matched_header: list[str] | None = None
    matched_tables: list[list[list[_Cell]]] = []
    seen_headers: list[list[str]] = []
    for table in parser.tables:
        if not table:
            continue
        header = [_normalise_header_cell(cell.text()) for cell in table[0]]
        seen_headers.append(header)
        if header in accepted:
            if matched_header is not None and header != matched_header:
                raise ParseFailure(
                    f"year={year}: multiple tables with different accepted headers -- "
                    "schema drift, refusing to parse")
            matched_header = header
            matched_tables.append(table)
    if matched_header is None:
        raise ParseFailure(
            f"year={year}: no table matches an accepted header. Accepted: {accepted!r}. "
            f"Seen: {seen_headers!r}. Unknown headers fail closed -- never best-effort.")

    columns = matched_header
    col = {name: i for i, name in enumerate(columns)}
    trade_present = "Trade" in col
    selection_header = contract["selection_column_header"]
    source_url = http_record.get("final_url") or http_record.get("url") \
        or build_year_url(contract, year)
    allowed_blank = set(contract["selection_blank_event_types"])

    rows: list[dict] = []
    extracted_text_parts: list[str] = [c for c in columns]
    row_index = 0
    for table in matched_tables:
        for cells in table[1:]:
            if len(cells) != len(columns):
                raise ParseFailure(
                    f"year={year} row={row_index}: {len(cells)} cells against a "
                    f"{len(columns)}-column header -- schema drift, refusing to parse")

            def cell(name: str) -> _Cell | None:
                return cells[col[name]] if name in col else None

            def text_of(name: str) -> str | None:
                c = cell(name)
                return blank_to_none(c.text()) if c is not None else None

            player_cell = cell("Player")
            player_name = text_of("Player")
            if player_name is None:
                raise ParseFailure(f"year={year} row={row_index}: blank Player cell")
            if len(player_cell.links) != 1:
                raise ParseFailure(
                    f"year={year} row={row_index}: Player cell for {player_name!r} carries "
                    f"{len(player_cell.links)} hrefs; exactly one durable player href is "
                    "required -- identity would be lost, refusing to parse")
            player_href_raw = player_cell.links[0]
            player_url, slug, ordinal = canonicalise_player_href(contract, player_href_raw)

            club_name, club_href, club_slug = parse_club_cell(contract, cell("Club"))
            if club_name == "":
                raise ParseFailure(f"year={year} row={row_index}: blank Club cell")

            event_type = text_of("Draft")
            pick_number = parse_pick_number(
                text_of(selection_header), year=year, row_index=row_index)
            if pick_number is None:
                if event_type is None or event_type not in allowed_blank:
                    raise ParseFailure(
                        f"year={year} row={row_index}: blank selection number on event "
                        f"{event_type!r}; blank is valid only for {sorted(allowed_blank)}")
            elif event_type in allowed_blank:
                raise ParseFailure(
                    f"year={year} row={row_index}: event {event_type!r} carries selection "
                    f"number {pick_number}; the four non-ordered event types are always blank")

            record = {
                "draft_year": year,
                "source_url": source_url,
                "row_index": row_index,
                "player_name_raw": player_name,
                "player_href_raw": player_href_raw,
                "player_url": player_url,
                "player_slug": slug,
                "player_ordinal": ordinal,
                "club_name_raw": club_name,
                "club_href_raw": club_href,
                "club_slug": club_slug,
                "pick_note_raw": text_of("Pick"),
                "event_type_raw": event_type,
                "pick_number": pick_number,
                "signing_raw": text_of("Signing"),
                "detail_raw": text_of("Detail"),
                "age_raw": text_of("Age"),
                "height_raw": text_of("Height"),
                "original_club_raw": text_of("Original Club"),
                "trade_column_present": trade_present,
                "trade_raw": text_of("Trade"),
                # Captured for CSV parity only. Never emitted as facts: the
                # source coerces absence to 0 here, violating NULL != 0 at
                # source.
                "parity_only": {
                    "grade": text_of("Grade"),
                    "games": text_of("Games"),
                    "goals": text_of("Goals"),
                    "coaches": text_of("Coaches"),
                    "brownlow": text_of("Brownlow"),
                    "awards": text_of("Awards"),
                },
            }
            rows.append(record)
            extracted_text_parts.extend(c.text() for c in cells)
            row_index += 1

    schema_info = {
        "header": columns,
        "fingerprint": header_fingerprint(columns),
        "column_count": len(columns),
        "trade_column_present": trade_present,
        "table_count": len(matched_tables),
        "row_count": len(rows),
        "declared_charset": charset,
        "charset_provenance": charset_provenance,
        "content_type": http_record.get("content_type"),
        "encoding_counts_raw_document": raw_counts,
        "encoding_counts_extracted": encoding_counts(" ".join(extracted_text_parts)),
    }
    return rows, schema_info


# ---------------------------------------------------------------------------
# Snapshot loading
# ---------------------------------------------------------------------------

def resolve_snapshot_dir(contract: dict, snapshot_root: str | None, label: str) -> Path:
    root = Path(snapshot_root) if snapshot_root else (REPO_ROOT / contract["snapshot"]["root"])
    snapshot_dir = root / label
    if snapshot_dir.name == FROZEN_CSV_LABEL:
        raise ParseFailure(
            f"{FROZEN_CSV_LABEL} is the frozen browser-export CSV artifact -- it is a "
            "parity oracle, never a snapshot label")
    if not snapshot_dir.is_dir():
        raise ParseFailure(f"snapshot directory not found: {snapshot_dir}")
    return snapshot_dir


def discover_years(contract: dict, snapshot_dir: Path) -> dict[int, Path]:
    years: dict[int, Path] = {}
    raw_dir = snapshot_dir / "raw" / "years"
    if not raw_dir.is_dir():
        raise ParseFailure(f"missing raw/years directory under {snapshot_dir}")
    for path in sorted(raw_dir.glob("year_*.html")):
        match = re.fullmatch(r"year_(\d{4})\.html", path.name)
        if not match:
            raise ParseFailure(f"unexpected file in raw/years: {path.name}")
        year = int(match.group(1))
        if year not in contract["expected_years"]:
            gap_years = {g["year"] for g in contract["known_coverage_gaps"]}
            reason = "an intentional coverage gap (no draft held)" if year in gap_years \
                else "outside the pinned expected-year set"
            raise ParseFailure(f"year={year}: acquired page is {reason} -- refusing to parse")
        years[year] = path
    if not years:
        raise ParseFailure(f"no raw year pages found under {raw_dir}")
    return years


def load_http_record(snapshot_dir: Path, year: int) -> dict:
    path = snapshot_dir / "http" / "years" / f"year_{year}.json"
    if not path.is_file():
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def parse_snapshot(contract: dict, snapshot_dir: Path, *, require_complete: bool) -> dict:
    year_paths = discover_years(contract, snapshot_dir)
    if require_complete:
        expected = set(contract["expected_years"])
        found = set(year_paths)
        if found != expected:
            missing = sorted(expected - found)
            extra = sorted(found - expected)
            raise ParseFailure(
                f"snapshot is not complete: missing years {missing}, unexpected years "
                f"{extra}. A snapshot is not complete if any required year is absent.")

    rows_by_year: dict[int, list[dict]] = {}
    schema_by_year: dict[int, dict] = {}
    for year in sorted(year_paths):
        raw = year_paths[year].read_bytes()
        if len(raw) == 0:
            raise ParseFailure(f"year={year}: zero-byte raw file")
        http_record = load_http_record(snapshot_dir, year)
        rows, schema_info = parse_year(contract, year, raw, http_record)
        if not rows:
            raise ParseFailure(f"year={year}: table matched but contained no rows")
        rows_by_year[year] = rows
        schema_by_year[year] = schema_info

    persons: dict[str, dict] = {}
    for year in sorted(rows_by_year):
        for row in rows_by_year[year]:
            person = persons.setdefault(row["player_url"], {
                "player_url": row["player_url"],
                "slug": row["player_slug"],
                "ordinal": row["player_ordinal"],
                "display_names_raw": set(),
                "years": set(),
                "row_count": 0,
            })
            person["display_names_raw"].add(row["player_name_raw"])
            person["years"].add(year)
            person["row_count"] += 1

    return {
        "rows_by_year": rows_by_year,
        "schema_by_year": schema_by_year,
        "persons": persons,
        "total_rows": sum(len(r) for r in rows_by_year.values()),
        "distinct_person_count": len(persons),
    }


# ---------------------------------------------------------------------------
# Identity validation (runbook section 8)
# ---------------------------------------------------------------------------

def validate_identity(contract: dict, result: dict, *, require_complete: bool,
                      accept_baseline_drift: bool) -> dict:
    regex = re.compile(contract["canonical_player_url"]["regex"])
    for year in sorted(result["rows_by_year"]):
        for row in result["rows_by_year"][year]:
            if not row["player_url"] or not regex.match(row["player_url"]):
                raise ParseFailure(
                    f"year={year} row={row['row_index']}: player_url "
                    f"{row['player_url']!r} escaped canonical validation")
            if row["player_ordinal"] < 1:
                raise ParseFailure(
                    f"year={year} row={row['row_index']}: non-positive ordinal")

    baseline = contract["parity_baseline"]
    report = {
        "total_rows": result["total_rows"],
        "distinct_person_count": result["distinct_person_count"],
        "baseline_total_rows": baseline["total_rows"],
        "baseline_distinct_persons": baseline["distinct_persons"],
        "baseline_drift": None,
    }
    if require_complete:
        drift = []
        if result["total_rows"] != baseline["total_rows"]:
            drift.append(
                f"total rows {result['total_rows']} != baseline {baseline['total_rows']}")
        if result["distinct_person_count"] != baseline["distinct_persons"]:
            drift.append(
                f"distinct persons {result['distinct_person_count']} != baseline "
                f"{baseline['distinct_persons']}")
        if drift:
            report["baseline_drift"] = drift
            if not accept_baseline_drift:
                raise ParseFailure(
                    "baseline drift (investigate before accepting -- runbook sections "
                    "7/8, U5): " + "; ".join(drift)
                    + ". Re-run with --accept-baseline-drift only after the difference "
                    "is explained and recorded.")
    return report


# ---------------------------------------------------------------------------
# Trade-column profile (runbook section 9)
# ---------------------------------------------------------------------------

def build_trade_profile(result: dict) -> dict:
    years_with_header: list[int] = []
    populated_by_year: dict[str, int] = {}
    distinct_values: dict[str, int] = {}
    link_paths: set[str] = set()
    cross_tab: dict[str, int] = {}
    for year in sorted(result["schema_by_year"]):
        if result["schema_by_year"][year]["trade_column_present"]:
            years_with_header.append(year)
            populated = 0
            for row in result["rows_by_year"][year]:
                if row["trade_raw"] is not None:
                    populated += 1
                    distinct_values[row["trade_raw"]] = \
                        distinct_values.get(row["trade_raw"], 0) + 1
                    event = row["event_type_raw"] or "__no_draft_column__"
                    cross_tab[event] = cross_tab.get(event, 0) + 1
            populated_by_year[str(year)] = populated
    return {
        "years_with_trade_header": years_with_header,
        "populated_by_year": populated_by_year,
        "total_populated": sum(populated_by_year.values()),
        "distinct_values": dict(sorted(distinct_values.items())),
        "link_paths": sorted(link_paths),
        "event_type_cross_tab": dict(sorted(cross_tab.items())),
        "note": "No database destination for this column is approved until this profile "
                "covers all 42 pages and has been reviewed (runbook section 9).",
    }


# ---------------------------------------------------------------------------
# CSV parity (runbook section 7) -- the only stage that reads the CSV corpus
# ---------------------------------------------------------------------------

def normalise_for_comparison(value: str | None) -> str | None:
    if value is None:
        return None
    text = unicodedata.normalize("NFC", value.replace(NBSP, " ").replace(ZWSP, ""))
    return re.sub(r"\s+", " ", text).strip()


# The browser export damaged exactly six player names: one original UTF-8 byte
# pair was re-read as CP1252/Latin-1, so a single accented character became a
# lead character (U+00C2/U+00C3) followed by a continuation character in
# U+0080-U+00BF.  Repair ONLY those pairs.
#
# Why not a whole-string round trip (the defect this replaced): every CSV
# player name also carries a NBSP, which encodes to the lone byte 0xA0 under
# latin-1 -- not valid UTF-8 -- so .decode("utf-8") raised UnicodeDecodeError
# and the value was silently returned unrepaired.  Pair-scoped repair is
# unaffected by NBSP, ZWSP or any other character outside the pattern, so it
# cannot alter anything but the known double-encoding.
_MOJIBAKE_PAIR = re.compile(
    "[" + chr(0x00C2) + chr(0x00C3) + "][" + chr(0x0080) + "-" + chr(0x00BF) + "]")


def repair_mojibake(value: str) -> tuple[str, bool]:
    """Parity-comparison-only repair of the browser export's double-encoding.

    Applied to the CSV side alone (see csv_name in run_parity).  The live
    parsed values, player_url and the frozen CSV corpus are never touched, and
    this is NOT accent- or Unicode-equivalence matching: a name that merely
    differs by an accent still fails parity.
    """
    if MOJIBAKE_SIGNATURE not in value:
        return value, False
    applied = False

    def _repair_pair(match) -> str:
        nonlocal applied
        try:
            decoded = match.group(0).encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return match.group(0)
        applied = True
        return decoded

    return _MOJIBAKE_PAIR.sub(_repair_pair, value), applied


def classify_pick_label(label: str) -> str:
    for family in ("FA Compensation", "Priority", "Compensation", "Inactive", "Penalised"):
        if label.startswith(family):
            return family
    return "__other__"


def _multiset(values) -> dict:
    counts: dict = {}
    for value in values:
        key = value if value is not None else "__blank__"
        counts[key] = counts.get(key, 0) + 1
    return counts


def load_parity_csv(contract: dict, parity_dir: Path) -> dict[int, list[dict]]:
    pattern = re.compile(contract["csv_artifact"]["filename_pattern"])
    files: dict[int, Path] = {}
    for path in sorted(parity_dir.glob("*.csv")):
        match = pattern.match(path.name)
        if match:
            files[int(match.group(1))] = path
    if not files:
        raise ParseFailure(f"no parity CSV files found under {parity_dir}")
    rows_by_year: dict[int, list[dict]] = {}
    for year, path in sorted(files.items()):
        with open(path, "r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.reader(fh)
            header = [_normalise_header_cell(h) for h in next(reader)]
            expected = accepted_headers_for_year(contract, year)[0]
            if header != expected:
                raise ParseFailure(
                    f"parity CSV {path.name}: header {header!r} does not match the "
                    f"pinned variant {expected!r}")
            col = {name: i for i, name in enumerate(header)}
            rows = []
            for line_no, cells in enumerate(reader):
                if len(cells) != len(header):
                    raise ParseFailure(
                        f"parity CSV {path.name} line {line_no + 2}: {len(cells)} cells "
                        f"against {len(header)} columns")

                def text_of(name: str) -> str | None:
                    if name not in col:
                        return None
                    return blank_to_none(cells[col[name]].strip())

                rows.append({
                    "player_name_raw": text_of("Player"),
                    "club_name_raw": text_of("Club"),
                    "event_type_raw": text_of("Draft"),
                    "pick_number": parse_pick_number(
                        text_of(contract["selection_column_header"]),
                        year=year, row_index=line_no),
                    "pick_note_raw": text_of("Pick"),
                    "signing_raw": text_of("Signing"),
                    "detail_raw": text_of("Detail"),
                    "original_club_raw": text_of("Original Club"),
                })
            rows_by_year[year] = rows
    return rows_by_year


def run_parity(contract: dict, result: dict, parity_dir: Path, *,
               require_complete: bool) -> dict:
    csv_rows_by_year = load_parity_csv(contract, parity_dir)
    html_years = set(result["rows_by_year"])
    csv_years = set(csv_rows_by_year)
    failures: list[str] = []
    repairs: list[dict] = []

    if require_complete:
        expected = set(contract["expected_years"])
        if html_years != expected:
            failures.append(f"HTML years {sorted(html_years)} != expected 42-year set")
        if csv_years != expected:
            failures.append(f"CSV years {sorted(csv_years)} != expected 42-year set")
        compare_years = sorted(expected & html_years & csv_years)
    else:
        compare_years = sorted(html_years & csv_years)
        if not compare_years:
            failures.append(
                f"no overlapping years between snapshot ({sorted(html_years)}) and "
                f"parity corpus ({sorted(csv_years)})")

    def html_name(row: dict) -> str | None:
        return normalise_for_comparison(row["player_name_raw"])

    def csv_name(year: int, row: dict) -> str | None:
        name = row["player_name_raw"]
        if name is None:
            return None
        repaired, applied = repair_mojibake(name)
        if applied:
            repairs.append({"year": year, "csv_value": name, "repaired": repaired})
        return normalise_for_comparison(repaired)

    for year in compare_years:
        html_rows = result["rows_by_year"][year]
        csv_rows = csv_rows_by_year[year]
        if len(html_rows) != len(csv_rows):
            failures.append(
                f"year={year}: row count HTML {len(html_rows)} != CSV {len(csv_rows)}")
            continue
        checks = [
            ("event vocabulary",
             _multiset((r["event_type_raw"] or "__no_draft_column__") for r in html_rows),
             _multiset((r["event_type_raw"] or "__no_draft_column__") for r in csv_rows)),
            ("selection numbers",
             _multiset(r["pick_number"] for r in html_rows),
             _multiset(r["pick_number"] for r in csv_rows)),
            ("special pick labels",
             _multiset(normalise_for_comparison(r["pick_note_raw"]) for r in html_rows),
             _multiset(normalise_for_comparison(r["pick_note_raw"]) for r in csv_rows)),
            ("player display names",
             _multiset(html_name(r) for r in html_rows),
             _multiset(csv_name(year, r) for r in csv_rows)),
            ("destination club labels",
             _multiset(normalise_for_comparison(r["club_name_raw"]) for r in html_rows),
             _multiset(normalise_for_comparison(r["club_name_raw"]) for r in csv_rows)),
            ("signing values",
             _multiset(normalise_for_comparison(r["signing_raw"]) for r in html_rows),
             _multiset(normalise_for_comparison(r["signing_raw"]) for r in csv_rows)),
            ("detail values",
             _multiset(normalise_for_comparison(r["detail_raw"]) for r in html_rows),
             _multiset(normalise_for_comparison(r["detail_raw"]) for r in csv_rows)),
            ("original club",
             _multiset(normalise_for_comparison(r["original_club_raw"]) for r in html_rows),
             _multiset(normalise_for_comparison(r["original_club_raw"]) for r in csv_rows)),
        ]
        for label, html_side, csv_side in checks:
            if html_side != csv_side:
                only_html = {k: v for k, v in html_side.items() if csv_side.get(k) != v}
                only_csv = {k: v for k, v in csv_side.items() if html_side.get(k) != v}
                failures.append(
                    f"year={year}: {label} mismatch -- HTML {only_html!r} vs CSV {only_csv!r}")

    corpus_checks = {}
    if require_complete and not failures:
        baseline = contract["parity_baseline"]
        total_csv = sum(len(rows) for rows in csv_rows_by_year.values())
        blank_selection = sum(
            1 for rows in result["rows_by_year"].values() for r in rows
            if r["pick_number"] is None)
        event_totals = _multiset(
            (r["event_type_raw"] or "__no_draft_column__")
            for rows in result["rows_by_year"].values() for r in rows)
        label_totals: dict[str, int] = {}
        for rows in result["rows_by_year"].values():
            for r in rows:
                if r["pick_note_raw"] is not None:
                    family = classify_pick_label(r["pick_note_raw"])
                    label_totals[family] = label_totals.get(family, 0) + 1
        corpus_checks = {
            "csv_total_rows": total_csv,
            "blank_selection_numbers": blank_selection,
            "event_totals": event_totals,
            "special_pick_label_totals": label_totals,
        }
        if total_csv != baseline["total_rows"]:
            failures.append(
                f"CSV corpus rows {total_csv} != baseline {baseline['total_rows']}")
        if blank_selection != baseline["selection_number_blank"]:
            failures.append(
                f"blank selection numbers {blank_selection} != baseline "
                f"{baseline['selection_number_blank']}")
        if event_totals != contract["event_type_baseline"]:
            failures.append(f"event totals {event_totals!r} != pinned baseline")
        expected_labels = {k: v for k, v in contract["special_pick_label_baseline"].items()
                           if k != "total"}
        if label_totals != expected_labels:
            failures.append(
                f"special pick label totals {label_totals!r} != baseline "
                f"{expected_labels!r}")

    report = {
        "compared_years": compare_years,
        "failures": failures,
        "documented_exceptions": [
            "Trade column: live-only, absent from the CSV export -- excluded from parity",
            "player_url: absent from the CSV export -- excluded from parity",
        ],
        "mojibake_repairs_applied": repairs,
        "corpus_checks": corpus_checks,
        "status": "FAIL" if failures else "PASS",
    }
    if failures:
        raise ParseFailure(
            "CSV parity failed (unexplained population differences fail validation):\n  "
            + "\n  ".join(failures))
    return report


# ---------------------------------------------------------------------------
# Deterministic parsed output
# ---------------------------------------------------------------------------

def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def write_parsed(snapshot_dir: Path, result: dict, trade_profile: dict) -> None:
    parsed_dir = snapshot_dir / "parsed"
    parsed_dir.mkdir(parents=True, exist_ok=True)

    with open(parsed_dir / "rows.jsonl", "w", encoding="utf-8", newline="\n") as fh:
        for year in sorted(result["rows_by_year"]):
            for row in result["rows_by_year"][year]:
                fh.write(_dump(row) + "\n")

    with open(parsed_dir / "persons.jsonl", "w", encoding="utf-8", newline="\n") as fh:
        for url in sorted(result["persons"]):
            person = result["persons"][url]
            fh.write(_dump({
                "player_url": person["player_url"],
                "slug": person["slug"],
                "ordinal": person["ordinal"],
                "display_names_raw": sorted(person["display_names_raw"]),
                "years": sorted(person["years"]),
                "row_count": person["row_count"],
            }) + "\n")

    variants: dict[str, dict] = {}
    for year in sorted(result["schema_by_year"]):
        info = result["schema_by_year"][year]
        variant = variants.setdefault(info["fingerprint"], {
            "fingerprint": info["fingerprint"],
            "columns": info["header"],
            "years": [],
        })
        variant["years"].append(year)
    with open(parsed_dir / "schema.json", "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({
            "years": {str(y): result["schema_by_year"][y]
                      for y in sorted(result["schema_by_year"])},
            "variants": [variants[k] for k in sorted(variants)],
        }, ensure_ascii=True, sort_keys=True, indent=2) + "\n")

    with open(parsed_dir / "trade_column_profile.json", "w", encoding="utf-8",
              newline="\n") as fh:
        fh.write(json.dumps(trade_profile, ensure_ascii=True, sort_keys=True, indent=2) + "\n")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--label", help="snapshot label under the snapshot root")
    parser.add_argument("--snapshot-root",
                        help="override the snapshot root (default: data/sources/draftguru)")
    parser.add_argument("--validate-only", action="store_true",
                        help="parse and validate without writing parsed/ output")
    parser.add_argument("--require-complete", action="store_true",
                        help="fail unless all 42 expected years are present")
    parser.add_argument("--parity", action="store_true",
                        help="reconcile against the CSV parity corpus (runbook section 7)")
    parser.add_argument("--parity-dir",
                        help="override the parity corpus directory (fixture-scale testing)")
    parser.add_argument("--accept-baseline-drift", action="store_true",
                        help="explicitly accept an investigated, explained drift from the "
                             "6,810-row / 5,057-person baseline; the delta is recorded")
    parser.add_argument("--print-canonical", metavar="HREF",
                        help="print the canonical form of one player href and exit")
    args = parser.parse_args(argv)

    contract = load_contract()
    try:
        if args.print_canonical is not None:
            url, _slug, _ordinal = canonicalise_player_href(contract, args.print_canonical)
            print(url)
            return 0

        if not args.label:
            parser.error("--label is required (unless --print-canonical is used)")

        snapshot_dir = resolve_snapshot_dir(contract, args.snapshot_root, args.label)
        result = parse_snapshot(contract, snapshot_dir,
                                require_complete=args.require_complete)
        identity_report = validate_identity(
            contract, result, require_complete=args.require_complete,
            accept_baseline_drift=args.accept_baseline_drift)
        trade_profile = build_trade_profile(result)

        parity_report = None
        if args.parity:
            parity_dir = Path(args.parity_dir) if args.parity_dir \
                else REPO_ROOT / contract["csv_artifact"]["path"]
            parity_report = run_parity(contract, result, parity_dir,
                                       require_complete=args.require_complete)

        if not args.validate_only:
            write_parsed(snapshot_dir, result, trade_profile)

        print(json.dumps({
            "label": args.label,
            "years_parsed": sorted(result["rows_by_year"]),
            "total_rows": result["total_rows"],
            "distinct_person_count": result["distinct_person_count"],
            "identity": identity_report,
            "parity": (parity_report["status"] if parity_report else "SKIPPED"),
            "validate_only": args.validate_only,
        }, ensure_ascii=True, sort_keys=True))
        return 0
    except ParseFailure as exc:
        print(f"PARSE FAILURE: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
