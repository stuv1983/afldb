# Release 7R2 DEV qualification of `a3c8c67cc98fc35e963795e331e7217a24ccf1e0` (21 November 2026)

**Where.** streamanator, disposable workspace `/mnt/ssd/afldb-rel7r2-20261121` (git-archive export of the candidate, own
`node_modules`, isolated PostgreSQL 16 cluster on 127.0.0.1:55670, stopped afterwards), node v22.23.2,
2026-11-21T01:17Z–01:37Z plus two supplementary steps. No DEV service, DEV database, DEV checkout or production contact.
Scripts: `qual-script-r7r2-qual.sh.txt` (packet 7's `rel7-qual.sh` with the pins changed and the closeout checks added) and
`qual-script-r7r2-367-render.sh.txt`. Summaries: `host-*.txt` beside this file; raw logs stay in the workspace.

## 1. Pins

- Exact tree: 10,129 entries, 0 blob mismatches against `git ls-tree -r a3c8c67c`, 0 extra files.
- `a2e6ea99..a3c8c67c` raw-delta sha256 `b2d0b698…d7a8` (149 paths), the same on Windows Git and Linux Git 2.43.0.
- `deploy/release.mjs`, `deploy/post-install-check.sh` and the three successor blocks are blob-equal to `0a308e2a`.

## 2. Results

| Step | Result |
|---|---|
| `npm ci` | rc 0 |
| **typecheck** (P3's off-host evidence) | **rc 0** |
| lint gate | PASSED at the ratchet baseline 338 errors / 43 files (existing debt, none new) |
| full unit (`--exclude tests/integration/**`), system Python | rc 1: 217 files, 207 passed, 1 skipped, 9 failed (86 tests). Same counts as packet 7's run |
| rerun of those 9 files with the DEV venv Python | 7 files pass; 2 files (7 tests: `draftguru-acquisition` 3, `fitzroy-core-import` 4) fail on gitignored data absent from a Git archive, **the identical failing-test list seen at `b82a6b04`** in the closeout run |
| focused suites `format`, `b1a-successor-lib`, `deploy-release`, `deploy-web-unit`, `catalogue-lookups` | all pass (210 tests: 54 + 32 + 59 + 40 + 25) |
| `reference-data` (Python contracts incl. the new AFLW contract) | system Python: 2 contracts fail on `No module named 'psycopg'`; venv rerun: passes |
| `bash -n` successor blocks, `post-install-check.sh` | rc 0 |
| integration `b1a-successor` | 14/14 |
| integration `brownlow-pending-coverage` | not run (suite refuses: needs four seeded club identities), as packet 7 §3 |
| integration ISSUE-367 and ISSUE-369 (`database.test.ts -t 'AFLDB-ISSUE-36[79]'`) | 3/3 |
| **production `npm run build`** | rc 0, BUILD_ID `q9RjUGEMc7ecXfA7ryW0l` |
| standalone server, beta gate on: health, server.log | ok; 0 error/unhandled lines |
| D-365-W cells (`dee-wording-990365`, desktop and mobile, Playwright DOM) | 2026 "Results not loaded" + exact title; 2025 `0`; 2024 "Not recorded"; 1943 "No medal" |
| P10-shaped after-mode samples (`pat-pending-990366`) | 16 samples, 0 bad |
| controls | anonymous player page 307 → `/beta?from=…`; `/seasons/2026` 200 with the no-votes text; `/brownlow/2026` 404 |

## 3. ISSUE-367 rendered check (supplementary step)

The first probe in the main script was **vacuous** (round votes render inside each round's match listing, and the seed had no
matches) and is not counted. The supplementary step seeded one round-1 match per season for `rory-roundvote-990367` (votes 3 in
2025, accepted; 2 in 2026, pending), cleared the ISR entries the first serve had written for `/seasons/2025` and `/seasons/2026`,
and restarted the same build:

| Surface | 2025 (accepted) | 2026 (pending) |
|---|---|---|
| `/seasons/<y>` round-vote block | player listed | withheld |
| `/matches/<id>` | BV column present | BV column absent |
| `/players/rory-roundvote-990367/matches` | BV `3` | BV `—` |

## 4. Not covered

- Production data: the P10 production samples, the owner browser observations and the 367 observation (packet 7R2 §4–9).
- Playwright e2e journeys and `brownlow-pending-coverage` (need a full-data database).
- `release.mjs build`/`host-gate`/`promote` end to end off production (unchanged since they released `a2e6ea99`).
- 367 visual capture of the season/match/game-log pages (DOM text only): **VISUAL: UNVERIFIED** for those surfaces.
- NL corpus and stress runs.
