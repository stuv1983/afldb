"""AFL Tables coaches snapshot parser: the network-free half of the coach-page acquisition.

AFLDB-ISSUE-319 (mandatory raw replay). Moved here unchanged from the quarantined acquisition
adapter (legacy/offline/tools/rebuild/afltables/acquire_coaches.py), which now imports it, so the
adapter that wrote a snapshot and the rebuild that replays its raw bytes run the same parser. It
reads bytes only: no network, file system or database access. ``render_csv`` is the adapter's
``write_csv`` writer settings, returning the bytes instead of writing them.

Standard library only. Nothing under tools/ may import legacy/; legacy/ may import this module.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from html.parser import HTMLParser


class Terminal(SystemExit):
    def __init__(self, message: str) -> None:
        super().__init__(f"ERROR: {message}")


# ----------------------------------------------------------------- HTML

class TableParser(HTMLParser):
    """Every <table> as rows of (text, first href) cells; h1 text captured too."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[tuple[str, str | None]]]] = []
        self.h1: str | None = None
        self._in_h1 = False
        self._row: list[tuple[str, str | None]] | None = None
        self._cell: list[str] | None = None
        self._href: str | None = None
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "h1":
            self._in_h1 = True
            self.h1 = ""
        elif tag == "table":
            self._depth += 1
            self.tables.append([])
        elif tag == "tr" and self._depth:
            self._flush_row()
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._flush_cell()
            self._cell = []
            self._href = None
        elif tag == "a" and self._cell is not None and self._href is None:
            href = dict(attrs).get("href")
            if href:
                self._href = href

    # AFL Tables omits </tr> on some header rows and </td> is optional in HTML, so a
    # cell or row is closed by whatever comes next, not only by its own end tag.
    def _flush_cell(self) -> None:
        if self._cell is not None and self._row is not None:
            text = re.sub(r"\s+", " ", "".join(self._cell).replace("\xa0", " ")).strip()
            self._row.append((text, self._href))
        self._cell = None

    def _flush_row(self) -> None:
        self._flush_cell()
        if self._row is not None and self.tables:
            self.tables[-1].append(self._row)
        self._row = None

    def handle_endtag(self, tag: str) -> None:
        if tag == "h1":
            self._in_h1 = False
        elif tag in ("td", "th"):
            self._flush_cell()
        elif tag in ("tr", "thead", "tbody", "tfoot"):
            self._flush_row()
        elif tag == "table":
            self._flush_row()
            self._depth = max(0, self._depth - 1)

    def handle_data(self, data: str) -> None:
        if self._in_h1 and self.h1 is not None:
            self.h1 += data
        if self._cell is not None:
            self._cell.append(data)


def parse_html(text: str) -> TableParser:
    parser = TableParser()
    parser.feed(text)
    parser.close()
    return parser


def normalise_profile_path(href: str) -> str:
    """Mirror of tools/migration/import_fitzroy_core.py normalise_profile_url()."""
    path = href.strip().replace("../", "")
    path = re.sub(r"^https?://afltables\.com/afl/stats/", "", path)
    return path.lstrip("/")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ----------------------------------------------------------------- parse

def parse_index(text: str, block: dict) -> list[dict]:
    doc = parse_html(text)
    if not doc.tables:
        raise Terminal("coaches index: no table on the page")
    table = doc.tables[0]
    headers = [[c[0] for c in row] for row in table if row and all(c[1] is None for c in row) and row[0][0] in ("Coach", "")]
    required = list(block["index_required_header"])
    header = next((h for h in headers if h and h[0] == "Coach"), None)
    if header != required:
        raise Terminal(f"coaches index: header is not the contract's. Observed: {header}")
    columns = list(block["index_columns"])
    rows: list[dict] = []
    for row in table:
        if not row or row[0][0] in ("Coach", "") or row[0][1] is None and row[0][0] in ("Totals",):
            continue
        if row[0][1] is None:
            # A footnote ("*Includes grand final replay") spans the table in one cell;
            # a full-width row without a link would be a coach without an identity.
            if len(row) == len(required):
                raise Terminal(f"coaches index: data row without a coach href: {row[0][0]!r}")
            continue
        if len(row) != len(required):
            raise Terminal(f"coaches index: row for {row[0][0]!r} has {len(row)} cells, expected {len(required)}")
        href = row[0][1]
        if "/" in href or not href.endswith(".html"):
            raise Terminal(f"coaches index: coach href {href!r} is not a page in the coaches directory")
        values = [row[0][0], href, f"coaches/{href}"] + [c[0] for c in row[1:]]
        rows.append(dict(zip(columns, values)))
    if not rows:
        raise Terminal("coaches index: no data rows")
    for key in ("name_raw", "coach_path"):
        seen: dict[str, int] = {}
        for r in rows:
            seen[r[key]] = seen.get(r[key], 0) + 1
        dups = sorted(k for k, n in seen.items() if n > 1)
        if dups:
            raise Terminal(f"coaches index: duplicate {key}: {dups}")
    return rows


BORN_RE = re.compile(r"<b>\s*Born:\s*</b>\s*([^<(]*)")
PLAYER_STATS_RE = re.compile(r'<a\s+href="([^"]+)"\s*>\s*Player Stats\s*</a>')


def parse_page(text: str, coach_path: str) -> dict:
    doc = parse_html(text)
    if not doc.h1 or not doc.h1.strip():
        raise Terminal(f"{coach_path}: page has no <h1>")
    born = BORN_RE.search(text)
    born_raw = born.group(1).replace("\xa0", " ").strip() if born else ""
    links = PLAYER_STATS_RE.findall(text)
    if len(links) > 1 and len(set(links)) > 1:
        raise Terminal(f"{coach_path}: two different Player Stats links {sorted(set(links))}")
    player_href = links[0] if links else ""
    profile_path = normalise_profile_path(player_href) if player_href else ""
    if profile_path and not re.match(r"^players/[A-Z]/[^/]+\.html$", profile_path):
        raise Terminal(f"{coach_path}: Player Stats link {player_href!r} is not a player profile path")
    # The Games Coached table: header cell "Games Coached" spanning the row, then # / Game / …
    games = None
    for table in doc.tables:
        if table and table[0] and table[0][0][0] == "Games Coached":
            games = sum(1 for row in table[1:] if row and row[0][0].isdigit())
            break
    if games is None:
        raise Terminal(f"{coach_path}: no 'Games Coached' table")
    return {
        "coach_path": coach_path,
        "display_name": re.sub(r"\s+", " ", doc.h1).strip(),
        "born_raw": born_raw,
        "player_href": player_href,
        "profile_path": profile_path,
        "games_coached": str(games),
    }


# ----------------------------------------------------------------- render

def render_csv(columns: list[str], rows: list[dict]) -> bytes:
    """The parsed CSV bytes exactly as the adapter writes them (UTF-8, LF, csv.DictWriter defaults)."""
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for r in rows:
        writer.writerow({c: r.get(c, "") for c in columns})
    return buf.getvalue().encode("utf-8")
