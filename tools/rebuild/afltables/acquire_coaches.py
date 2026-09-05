#!/usr/bin/env python3
"""AFLDB-ISSUE-118 Stage E2 — AFL Tables coaches index and coach pages.

    python tools/rebuild/afltables/acquire_coaches.py [--label coaches-YYYYMMDD] [--out-dir DIR]

Reads https://afltables.com/afl/stats/coaches/coaches_idx.html (one row per person
who ever coached a VFL/AFL match) and every coach page it links. Keeps what the
accepted fitzRoy baseline's per-match ``Coach`` column cannot supply: the person
behind the "Surname, Given" string, and that person's "Player Stats" link — the
exact ``players/<L>/<Name>.html`` profile path ``external_identities`` already
holds, so a coach who played joins the existing player row through AFLDB's own
identity key and a coach who never played has no player row.

Writes, under data/sources/afltables/coaches/<label>/:

  raw/coaches_idx.html, raw/<coach file>      the exact response bytes (gitignored, hash-bound)
  parsed/coaches_index.csv                    one row per index row (contract index_columns)
  parsed/coach_pages.csv                      one row per page (contract page_columns)
  manifest.json                               SHA-256 of every artefact; copy to
                                              docs/rebuild-manifests/afltables_coaches/ to pin

Contract: tools/rebuild/afltables/afltables-contract.json (``coaches``). Adjudicates
nothing. Terminal failures (no manifest is written): a non-200 page after the retry
policy, an index header that is not the contract's, an index row without a coach
href, a duplicate name or path on the index, a page without an <h1>.

Standard library only, so the acquisition has no dependency the rebuild host lacks;
the HTTP policy (User-Agent, pacing, timeout, retries) is the contract's, the same
one acquire_club_lists.R obeys.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = Path("tools/rebuild/afltables/afltables-contract.json")
ADAPTER = "tools/rebuild/afltables/acquire_coaches.py"
ADAPTER_SCHEMA_VERSION = 1
SOURCE_KEY = "afltables"
FAMILY = "coach_pages"
WORKING_ROOT = Path("data/sources/afltables/coaches")
COACHES_DIR = "https://afltables.com/afl/stats/coaches/"


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


# ----------------------------------------------------------------- HTTP

class Fetcher:
    def __init__(self, policy: dict) -> None:
        self.ua = policy["user_agent"]
        self.pacing = float(policy["min_pacing_seconds"])
        self.timeout = float(policy["timeout_seconds"])
        self.backoff = list(policy["retries"]["backoff_seconds"])
        self.last: float | None = None

    def get(self, url: str) -> tuple[int, bytes]:
        attempt = 0
        while True:
            if self.last is not None:
                wait = self.pacing - (time.monotonic() - self.last)
                if wait > 0:
                    time.sleep(wait)
            self.last = time.monotonic()
            status, body, transient, detail = self._once(url)
            if not transient:
                return status, body
            attempt += 1
            if attempt > len(self.backoff):
                raise Terminal(f"{url}: {detail} after {attempt - 1} retries — terminal, no manifest written.")
            time.sleep(self.backoff[attempt - 1])

    def _once(self, url: str) -> tuple[int, bytes, bool, str]:
        req = urllib.request.Request(url, headers={"User-Agent": self.ua})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.status, resp.read(), False, ""
        except urllib.error.HTTPError as exc:
            body = exc.read() if exc.fp else b""
            transient = exc.code >= 500 or exc.code == 429
            return exc.code, body, transient, f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            return 0, b"", True, f"{type(exc).__name__}: {exc}"


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


# ----------------------------------------------------------------- main

def write_csv(path: Path, columns: list[str], rows: list[dict]) -> str:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for r in rows:
            writer.writerow({c: r.get(c, "") for c in columns})
    return sha256_bytes(path.read_bytes())


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", default=f"coaches-{date.today():%Y%m%d}")
    parser.add_argument("--out-dir", default=None)
    args = parser.parse_args()

    contract_path = REPO_ROOT / CONTRACT_PATH
    if not contract_path.is_file():
        raise Terminal(f"missing acquisition contract: {CONTRACT_PATH}")
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    block = contract.get("coaches")
    if not block:
        raise Terminal(f"{CONTRACT_PATH} carries no `coaches` block; refusing.")
    policy = contract["http_policy"]

    out_dir = Path(args.out_dir) if args.out_dir else REPO_ROOT / WORKING_ROOT / args.label
    raw_dir, parsed_dir = out_dir / "raw", out_dir / "parsed"
    raw_dir.mkdir(parents=True, exist_ok=True)
    parsed_dir.mkdir(parents=True, exist_ok=True)

    print("AFLDB-ISSUE-118 AFL Tables coaches acquisition")
    print(f"  label: {args.label}  out: {out_dir}")
    fetch = Fetcher(policy)
    started = utc_now()

    robots_status, robots_body = fetch.get("https://afltables.com/robots.txt")
    robots_sha = None
    if robots_status == 200:
        robots_sha = sha256_bytes(robots_body)
        body = robots_body.decode("utf-8", "replace")
        if re.search(r"(?mi)^Disallow:\s*/(afl(/stats(/coaches)?)?)?\s*$", body):
            raise Terminal("robots.txt disallows the coaches path; refusing.")
    print(f"  robots.txt: {robots_status}")

    status, index_bytes = fetch.get(block["index_endpoint"])
    if status != 200:
        raise Terminal(f"coaches index: HTTP {status} — terminal, no manifest written.")
    (raw_dir / "coaches_idx.html").write_bytes(index_bytes)
    index_rows = parse_index(index_bytes.decode("utf-8", "replace"), block)
    print(f"  index: {len(index_rows)} coaches")

    pages: list[dict] = []
    files: list[dict] = []
    t0 = time.time()
    for i, row in enumerate(index_rows, start=1):
        # The href is kept verbatim as identity ("Allan_La Fontaine.html" has a space);
        # only the request line is percent-encoded.
        url = block["page_endpoint"].replace("<coach file>", urllib.parse.quote(row["coach_href"]))
        status, page_bytes = fetch.get(url)
        if status != 200:
            raise Terminal(f"{row['coach_path']}: HTTP {status} for {url} — terminal, no manifest written.")
        (raw_dir / row["coach_href"]).write_bytes(page_bytes)
        page = parse_page(page_bytes.decode("utf-8", "replace"), row["coach_path"])
        page["raw_sha256"] = sha256_bytes(page_bytes)
        pages.append(page)
        files.append({
            "dataset": "coach_page", "coach_path": row["coach_path"], "name_raw": row["name_raw"],
            "url": url, "http_status": status,
            "raw_filename": f"raw/{row['coach_href']}", "raw_sha256": page["raw_sha256"],
            "profile_path": page["profile_path"] or None, "games_coached": int(page["games_coached"]),
        })
        if i % 25 == 0 or i == len(index_rows):
            print(f"  {i:4d}/{len(index_rows)} pages [{time.time() - t0:.0f}s]  last: {page['display_name']}")

    index_columns = list(block["index_columns"])
    page_columns = list(block["page_columns"])
    index_sha = write_csv(parsed_dir / "coaches_index.csv", index_columns, index_rows)
    pages_sha = write_csv(parsed_dir / "coach_pages.csv", page_columns, pages)
    linked = sum(1 for p in pages if p["profile_path"])

    manifest = {
        "source": "AFL Tables (afltables.com) coaches index and coach pages",
        "source_key": SOURCE_KEY,
        "family": FAMILY,
        "adapter": ADAPTER,
        "adapter_schema_version": ADAPTER_SCHEMA_VERSION,
        "contract_path": str(CONTRACT_PATH).replace("\\", "/"),
        "contract_coaches_version": block["contract_coaches_version"],
        "extraction_date": f"{date.today():%Y-%m-%d}",
        "extraction_started_utc": started,
        "extraction_timestamp_utc": utc_now(),
        "mode": "acquire",
        "snapshot_label": args.label,
        "acquisition_kind": block["acquisition_kind"],
        "scope_key": f"coaches={len(index_rows)}",
        "coaches_indexed": len(index_rows),
        "pages_acquired": len(pages),
        "pages_with_player_profile": linked,
        "pages_without_player_profile": len(pages) - linked,
        "working_directory": str(WORKING_ROOT / args.label).replace("\\", "/"),
        "http_policy": {
            "user_agent": policy["user_agent"], "concurrency": 1,
            "min_pacing_seconds": policy["min_pacing_seconds"], "timeout_seconds": policy["timeout_seconds"],
            "retry_backoff_seconds": policy["retries"]["backoff_seconds"],
        },
        "robots_txt": {"status": robots_status, "sha256": robots_sha},
        "identity_rule": block["identity_rule"],
        "index": {
            "url": block["index_endpoint"], "http_status": 200,
            "raw_filename": "raw/coaches_idx.html", "raw_sha256": sha256_bytes(index_bytes),
        },
        "parsed": [
            {"dataset": "coaches_index", "filename": "parsed/coaches_index.csv", "sha256": index_sha,
             "row_count": len(index_rows), "observed_columns": index_columns},
            {"dataset": "coach_pages", "filename": "parsed/coach_pages.csv", "sha256": pages_sha,
             "row_count": len(pages), "observed_columns": page_columns},
        ],
        "completeness": "unvalidated",
        "files": files,
    }
    manifest_path = out_dir / "manifest.json"
    with manifest_path.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"  pages: {len(pages)}  with player profile: {linked}  without: {len(pages) - linked}")
    print(f"  manifest: {manifest_path}")
    print("  done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
