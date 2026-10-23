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
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[5]

# AFLDB-ISSUE-319: the network-free parser lives under tools/ so the rebuild's raw replay runs
# exactly this code; legacy/ may import tools/, never the reverse.
sys.path.insert(0, str(REPO_ROOT / "tools" / "rebuild" / "afltables"))
from coach_snapshot_parser import (  # noqa: E402,F401  (re-exported: the adapter's parser IS the shared one)
    BORN_RE, PLAYER_STATS_RE, TableParser, Terminal, normalise_profile_path, parse_html, parse_index,
    parse_page, render_csv, sha256_bytes,
)
CONTRACT_PATH = Path("tools/rebuild/afltables/afltables-contract.json")
ADAPTER = "tools/rebuild/afltables/acquire_coaches.py"
ADAPTER_SCHEMA_VERSION = 1
SOURCE_KEY = "afltables"
FAMILY = "coach_pages"
WORKING_ROOT = Path("data/sources/afltables/coaches")
COACHES_DIR = "https://afltables.com/afl/stats/coaches/"


AFLTABLES_NETWORK_PATH = Path("data/reference/afltables-network.json")
SEASONS_PATH = Path("data/reference/seasons.json")


def _is_json_year(value: object) -> bool:
    """A finite, integer-valued JSON number: 2026 or 2026.0, never a bool, string, null or fraction."""
    return type(value) is int or (type(value) is float and value.is_integer())


def afltables_network_status(root: Path) -> str:
    """AFL API cutover: the one switch for AFL Tables network fetching.

    "active" only when the file says status "active" with an integer-valued
    JSON number as last_season (2026 and 2026.0 both qualify; the R and
    TypeScript gates read it the same way) AND no in-progress season is later
    than it; a missing or unreadable file, any other status or no such
    last_season is "retired" (fail closed); an active switch beyond its
    last_season, or an unreadable register, is "out_of_bounds". See the file's
    $comment.
    """
    def load(rel: Path) -> object:
        try:
            return json.loads((root / rel).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    control = load(AFLTABLES_NETWORK_PATH)
    control = control if isinstance(control, dict) else {}
    last = control.get("last_season")
    if control.get("status") != "active" or not _is_json_year(last):
        return "retired"
    seasons = load(SEASONS_PATH)
    years = seasons.get("in_progress_seasons") if isinstance(seasons, dict) else None
    bounded = isinstance(years, list) and all(_is_json_year(y) and y <= last for y in years)
    return "active" if bounded else "out_of_bounds"


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


# ----------------------------------------------------------------- main

def write_csv(path: Path, columns: list[str], rows: list[dict]) -> str:
    path.write_bytes(render_csv(columns, rows))
    return sha256_bytes(path.read_bytes())


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", default=f"coaches-{date.today():%Y%m%d}")
    parser.add_argument("--out-dir", default=None)
    args = parser.parse_args()

    network = afltables_network_status(REPO_ROOT)
    if network == "out_of_bounds":
        raise Terminal(
            f"AFLDB_AFLTABLES_OUT_OF_BOUNDS: {SEASONS_PATH} has an in-progress season later "
            f"than last_season in {AFLTABLES_NETWORK_PATH} (or is unreadable); AFL Tables "
            "network acquisition is refused."
        )
    if network != "active":
        raise Terminal(
            f"AFLDB_AFLTABLES_RETIRED: {AFLTABLES_NETWORK_PATH} does not say status "
            '"active" with an integer last_season; AFL Tables network acquisition is refused.'
        )

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
