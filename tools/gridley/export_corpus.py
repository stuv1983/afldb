#!/usr/bin/env python3
"""
AFLDB-ISSUE-118 Stage 1 — export the stored Gridley corpus as a deterministic,
offline test fixture.

The authoritative corpus is `external_grids` (provenance `gridley_api`,
current revisions only), loaded by tools/migration/import_gridley_boards.py.
This tool reads it back and writes two fixture files the exhaustive Grid
Solver compatibility suite (tests/integration/gridley-corpus.test.ts) consumes
without any database access to the corpus tables and without contacting
gridleygame.com:

    tests/fixtures/gridley/corpus.json
        One record per board: number, date, the three row items (upstream
        vItems) and three column items (upstream hItems) with Gridley's own
        id/title/subtitle/description/type, plus the AFL "champion" image id
        when the item carried a player image URL, and the SIZE of every
        cell's answer set.

    tests/fixtures/gridley/corpus-answers.json.gz
        The answer key itself: per board, a 3x3 array of sorted Gridley
        player ids (`correctAnswersPlayerMap` keys). Kept separate and
        gzipped because it is ~1.5 million integers.

Both files are byte-deterministic for a given corpus state: boards are
ordered by number, keys are sorted, ids are sorted numerically, line endings
are LF and the gzip header carries no timestamp. Re-running against an
unchanged corpus produces identical bytes.

Read-only: the tool only ever SELECTs.

    python tools/gridley/export_corpus.py --dsn "$AFLDB_OWNER_DATABASE_URL"
"""

from __future__ import annotations

import argparse
import gzip
import io
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures" / "gridley"
CORPUS_PATH = FIXTURE_DIR / "corpus.json"
ANSWERS_PATH = FIXTURE_DIR / "corpus-answers.json.gz"

CHAMP_ID_RE = re.compile(r"/(\d+)\.png(?:\?|$)")

ITEM_FIELDS = ("id", "title", "subtitle", "description", "type")


def champ_id(item: dict[str, Any]) -> int | None:
    url = item.get("imgUrl")
    if not isinstance(url, str):
        return None
    m = CHAMP_ID_RE.search(url)
    return int(m.group(1)) if m else None


def export_item(item: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for field in ITEM_FIELDS:
        value = item.get(field)
        if value is not None and not isinstance(value, str):
            raise ValueError(f"item field {field!r} is not a string: {value!r}")
        out[field] = value
    cid = champ_id(item)
    if cid is not None:
        out["champId"] = cid
    return out


def export_board(board_number: int, board_date: str, payload: dict[str, Any]) -> tuple[dict[str, Any], list[list[list[int]]]]:
    if payload.get("level") != board_number:
        raise ValueError(f"board {board_number}: payload level {payload.get('level')!r} disagrees")
    rows = payload["vItems"]
    cols = payload["hItems"]
    if len(rows) != 3 or len(cols) != 3:
        raise ValueError(f"board {board_number}: expected 3x3 items")
    answer_map = payload["correctAnswersPlayerMap"]
    if len(answer_map) != 3 or any(len(r) != 3 for r in answer_map):
        raise ValueError(f"board {board_number}: answer map is not 3x3")
    answers: list[list[list[int]]] = []
    sizes: list[list[int]] = []
    for r in range(3):
        answers.append([])
        sizes.append([])
        for c in range(3):
            cell = answer_map[r][c]
            if not isinstance(cell, dict):
                raise ValueError(f"board {board_number}: cell {r},{c} answer map is not an object")
            ids = sorted(int(k) for k in cell.keys())
            answers[r].append(ids)
            sizes[r].append(len(ids))
    record = {
        "board": board_number,
        "date": board_date,
        "rows": [export_item(i) for i in rows],
        "cols": [export_item(i) for i in cols],
        "answerCounts": sizes,
    }
    return record, answers


def fetch_boards(dsn: str) -> list[tuple[int, str, dict[str, Any]]]:
    import psycopg  # only needed for the database path

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT g.board_number, g.board_date::text, g.raw_payload->'payload'
                  FROM external_grids g
                  JOIN external_grid_sources s ON s.id = g.source_id
                 WHERE s.code = 'gridley' AND g.provenance = 'gridley_api' AND g.is_current
                 ORDER BY g.board_number
                """
            )
            return [(int(n), d, p) for n, d, p in cur.fetchall()]


def canonical_json(value: Any) -> bytes:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=1, separators=(",", ":"))
    return (text + "\n").encode("utf-8")


def write_fixtures(boards: list[tuple[int, str, dict[str, Any]]]) -> tuple[int, int]:
    records = []
    answers: dict[str, list[list[list[int]]]] = {}
    for number, date, payload in boards:
        record, cell_answers = export_board(number, date, payload)
        records.append(record)
        answers[str(number)] = cell_answers
    corpus = {
        "source": "external_grids (source gridley, provenance gridley_api, current revisions)",
        "boards": records,
    }
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    corpus_bytes = canonical_json(corpus)
    CORPUS_PATH.write_bytes(corpus_bytes)

    # mtime=0 keeps the gzip header free of a timestamp, so identical input
    # gives identical bytes.
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0) as gz:
        gz.write(canonical_json(answers))
    ANSWERS_PATH.write_bytes(buf.getvalue())
    return len(corpus_bytes), len(buf.getvalue())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dsn", default=os.environ.get("AFLDB_OWNER_DATABASE_URL"),
                        help="PostgreSQL DSN holding external_grids (default: $AFLDB_OWNER_DATABASE_URL)")
    args = parser.parse_args(argv)
    if not args.dsn:
        print("error: --dsn or AFLDB_OWNER_DATABASE_URL is required", file=sys.stderr)
        return 2
    boards = fetch_boards(args.dsn)
    if not boards:
        print("error: no current gridley_api boards found", file=sys.stderr)
        return 1
    corpus_size, answers_size = write_fixtures(boards)
    numbers = [b[0] for b in boards]
    print(f"boards: {len(boards)} (#{numbers[0]}..#{numbers[-1]})")
    print(f"wrote {CORPUS_PATH.relative_to(REPO_ROOT)} ({corpus_size:,} bytes)")
    print(f"wrote {ANSWERS_PATH.relative_to(REPO_ROOT)} ({answers_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
