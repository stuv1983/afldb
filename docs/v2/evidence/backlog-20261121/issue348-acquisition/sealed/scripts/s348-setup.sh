#!/usr/bin/env bash
# ISSUE-348 backlog run b: workspace setup on streamanator. Copies only; never writes outside $W.
set -uo pipefail; export LC_ALL=C
W=/mnt/ssd/afldb-backlog-20261122b-348
DG=/mnt/ssd/afldb-backlog-20261122-dg
mkdir -p "$W" && chmod 700 "$W"; cd "$W" || exit 1
[ -d co ] && { echo "co exists"; exit 1; }
mkdir co && tar -xzf "$W/co.tgz" -C co || exit 1
echo "co extracted"
# fresh acquisition (raw + http only; parsed/ is regenerated) — READ from the dg workspace, COPY here
SRC=$DG/src/data/sources/draftguru/annual-html-20261122
DST=$W/co/data/sources/draftguru/annual-html-20261122
mkdir -p "$DST" && cp -a "$SRC/raw" "$SRC/http" "$DST/" || exit 1
( cd "$DST/raw/years" && sha256sum -c --quiet "$W/co/docs/v2/evidence/backlog-20261121/issue348-acquisition/raw-pages.sha256" ) && echo "raw pages: 42 OK vs tracked raw-pages.sha256" || { echo "RAW MISMATCH"; exit 1; }
ls "$DST/raw/years" | wc -l
# frozen CSV oracle (read-only parity corpus) and the 20260826 raw pages (default-label regression)
cp -a "$DG/src/data/sources/draftguru/full-history-20260826" "$W/co/data/sources/draftguru/" || exit 1
A=/mnt/ssd/afldb-rem3-rebuild-20261114/cand/data/sources/draftguru/annual-html-20260826
mkdir -p "$W/co/data/sources/draftguru/annual-html-20260826/raw" && cp -a "$A/raw/years" "$W/co/data/sources/draftguru/annual-html-20260826/raw/" || exit 1
# production S2 child (byte-equal copy held off production)
mkdir -p "$W/in" && chmod 700 "$W/in"
cp -a /mnt/ssd/afldb/workspaces/afldb-v2-gap029-prod-20261103/evidence-private/s2_20261103_080332/work/child.json "$W/in/s2-child.json"
sha256sum "$W/in/s2-child.json"
# R0 production dump (read, copy)
cp -a /mnt/ssd/afldb-post7r3-20261121T155248Z/afldb_prod-20261122-025248.dump "$W/in/" && chmod 600 "$W/in/"*.dump
sha256sum "$W/in/afldb_prod-20261122-025248.dump"
# python venv (own, pinned hashes)
python3.12 -m venv "$W/venv" && "$W/venv/bin/pip" install -q --require-hashes -r "$W/co/tools/rebuild/python-runtime.requirements.txt" && "$W/venv/bin/python" -c 'import psycopg;print("psycopg",psycopg.__version__)'
