# ISSUE-348 DraftGuru re-acquisition: preparation and dry-run (2026-11-22)

Worker run under owner decision Q2 (2026-11-22). Preparation and dry-run only: no database other than a private isolated
cluster was written, nothing was committed, no tracked file was edited, production was never contacted. The reload guard
stays enforced; no contract file was edited (the re-baseline below is recorded, not applied).

## 1. Environment (streamanator, no sudo)

| Item | Value |
|---|---|
| Workspace | `/mnt/ssd/afldb-backlog-20261122-dg` (mode 0700) |
| `src/` | `git archive 5199eb4f` of `D:\dev\afldb-backlog-20261121` (tar.gz sha256 `55acb441b92e5c96051a674c1bc74c7e06bbadf140156ccae7e2efe5506d3236`), plus untracked `data/sources/draftguru/` (fresh snapshot, and a read-only copy of the frozen `full-history-20260826` parity oracle from the workstation `D:\dev\afldb`) |
| `prod/` | PRODUCTION dump `afldb_prod-20261122-025248.dump` + `.sha256` (copy), sha256 verified `26db476126b8a2e5474a452d5bfdb9b790031a11e797481065e37041c1761d8b`. Contains auth and audit tables. Left in place for owner disposal |
| Python | `venv/` from `tools/rebuild/python-runtime.requirements.txt` (`--require-hashes`; psycopg 3.3.4) |
| Cluster | PostgreSQL 16.15, `pgdata/`, 127.0.0.1 port 61522, trust auth, db `afldb_prod_r0`. **Stopped** (`pg_ctl stop -m fast` rc 0, no listener) |
| Restore | `pg_restore --no-owner --no-acl --exit-on-error` rc 0, empty stderr. `draft_picks` 6,853 = **6,845 DraftGuru (source_id 13)** + 8 manual (source_id 2); `draft_persons` 5,088 |

## 2. Fresh acquisition (step 2)

Tool: `legacy/offline/tools/rebuild/draftguru/acquire_draft.py` (the `tools/rebuild/draftguru/` copy is a retired stub that
exits with `AFLDB_LEGACY_RETIRED_V2`). Plain HTTP, no credentials, contract `http_policy` (identifying User-Agent, 1.5 s
minimum delay, sequential ascending years, robots.txt honoured: HTTP 200, sha256 `d3bdd069…695413b`). Label
`annual-html-20261122`; host clock 2026-11-21T16:03:01Z to 16:05:58Z (resume run re-fetched robots only).

- 42 year pages (1981, 1982, 1986-2025), all HTTP 200. Per-page sha256: `raw-pages.sha256`. Log: `acquire.log`.
- Parsed: **6,845 rows, 5,088 persons** (baseline in `draftguru-contract.json`: 6,810 / 5,057). Run 1 therefore refused
  as baseline drift (rc 1). The drift is explained, not silent: production holds the same 6,845 DraftGuru picks; Pre-Draft
  events are 405 against the baseline's 370 (+35); +31 persons; the guard (section 4) finds **0** stored picks or persons
  missing from the fresh snapshot. These are the 35 audited D-336-2 picks (ids 6819-6853) and their 31 persons. Per
  (year, kind) counts for 1991-2025 equal production exactly.
- Run 2 with `--accept-baseline-drift` (resume, no re-fetch of pages): **`CSV parity failed`, rc 1, NO manifest written**
  (`acquire-accept-drift.log`). The tool's parity gate compares against the frozen 2026-08-26 CSV oracle: row-count
  mismatches in 2008-2015, 2017, 2021, 2025 (the 35 inserts) and `original club mismatch` in 1988-1991, 1993, 1995, 2007,
  2020, 2022-2024 (the back-filled origins). So the documented tool cannot seal a manifest for a changed source; that is a
  decision for the owner, not something this run adjudicated (finding F-001).

## 3. D-336-3 classifier (steps 3 and 6)

Scripts unmodified (`d3363-classification-20261111/scripts/classify.py`, `extract_pairs.py`, `../reconcile.py`).
Inputs built by `drivers/build_fresh_inputs.py` (fresh parse into `csv_rows.json`) and `export` of the restored
`draft_picks` in `export-draft.mjs`'s column set. Method note: the classifier's domain is 1991-2025 (the CSV range).

| Run | Pairs | INSERT_SCHOOL | INSERT_CLUB | RENAME_EXPAND | REPLACE_CLUB | OTHER / INSERT_MIXED |
|---|---|---|---|---|---|---|
| Committed 2026-11-11 | 187 | 174 | 7 | 3 | 3 | 0 |
| **Fresh acquisition vs restored production** | **187** | **174** | **7** | **3** | **3** | **0** |
| Owner CSV 2026-11-05 vs restored production (reproduction) | 187 | 174 | 7 | 3 | 3 | 0 |

- Fresh vs committed: identical id set (0 new, 0 dropped), identical class per id, identical `db`/`csv` normalised strings.
  Only the display `player` string differs (fresh page text keeps U+00A0 inside names; the CSV tool normalised it).
  Owner-CSV reproduction equals the committed file field-for-field: stored origins have not changed since 2026-11-04.
- Fresh snapshot rows vs the owner CSV rows (5,966 each, 1991-2025): **0 origin differences**. Six keys differ only
  because the owner CSV carries mojibake in player names (Setanta O hAilpin, Ciaran Sheehan, Ciaran Byrne, Red Og Murphy).
- The three REPLACE_CLUB ids are the same three (5961, 6784, 6626). No new REPLACE_CLUB, OTHER or INSERT_MIXED row in range.
- Outside the classifier's range (full snapshot, via the guard): 4 further origin changes, all INSERT_CLUB, none ruled on:
  id 233 (Daryn Cresswell 1988): `North Hobart` to `Glenorchy/<ZWSP>North Hobart`; ids 378 (Shane Fell 1989 pre_draft),
  635 (Danny Noonan 1990 pre_draft), 859 (Shane Fell 1990 midseason): stored NULL ("not recorded") to a value.

Files: `classification-fresh.json` (sha256 `71fe76a9…61740`), `classify-output-fresh.txt`,
`classify-output-owner-csv-reproduction.txt`, `compare-output.txt`.

## 4. Importer dry-run and reload guard (step 4)

DSN via environment (`AFLDB_IMPORT_DATABASE_URL`, no password, loopback). Row counts before and after both runs:
`import_batches` 93, `draft_picks` 6,853 (nothing written).

**A. Genuine, unpatched** `import_draftguru.py --dry-run --label annual-html-20261122 --guard-report …` (rc 1, `dryrun-unpatched.txt`):

    REFUSED: missing Stage A manifest: …/docs/rebuild-manifests/draftguru/annual-html-20261122.json

It never reaches the guard (no manifest could be sealed, section 2), and would next refuse at `EXPECTED_ROWS` 6810 /
`EXPECTED_PERSONS` 5057 and at `validate_identity` against the contract baseline. No guard report was written.

**B. PROVISIONAL, in-memory only** (`drivers/provisional_dryrun.py`; edits no file): an in-memory manifest built from the real
http records, `EXPECTED_ROWS`/`EXPECTED_PERSONS` 6845/5088 and a contract copy with the same baseline, then `main()` with
`--dry-run --guard-report`. This is NOT an accepted import and its digest is provisional. rc 1, `dryrun-provisional.txt`:

    reload guard REVIEW  0 pick deletion(s) (0 audited); 0 person deletion(s) (0 audited); 35 audited pick rewrite(s);
    35 audited person rewrite(s); 191 original_club_raw change(s)
    {'INSERT_CLUB': 11, 'INSERT_SCHOOL': 174, 'RENAME_EXPAND': 3, 'REPLACE_CLUB': 3}
    REFUSED: reload guard (AFLDB-ISSUE-348): ... None is acknowledged ...
    effect_digest ff8ef1b8ef900d9ab5b17c89b2f0f85d5b3091e9493456a45b2a5f67cf766452

Guard report: `guard-report-provisional.json` (74,306 bytes, sha256 `91d1da0e9f394f26df513df8e8f03835b93623867bc1cd995fa0a719754150a4`).

- 0 deletions: every stored DraftGuru key, including the 35 audited picks, is carried by the fresh snapshot.
- 35 protected pick rewrites (ids 6819-6853): the only changed column is `competition`, NULL to `'AFL'`.
- 35 protected person rewrites: `dg_person_id` rank changes (per-load rank; e.g. person 1717: 1717 to 1730).
- 191 origin changes = the 187 above + the 4 out-of-range INSERT_CLUB rows. The three REPLACE_CLUB rows need `owner_rulings`.

## 5. The three REPLACE_CLUB rows (step 5)

Owner CSV list verified first: `SHA256SUMS.owner-csv` in the repo (bytes at 5199eb4f) hashes to `c495599b4bcbdfe7…5f09a7c0`
(equals the README's recorded value); its 35 per-file lines are identical to the retained list; `sha256sum -c` on the
retained CSVs at `/mnt/ssd/afldb/records/d3363-owner-draftguru-csv-20261111/`: 35/35 OK. The comparison is on the **raw**
`original_club_raw` string (the importer stores raw; `/` is followed by U+200B in all three). `three-rows.json` has the
strings and their UTF-8 hex.

| id | Player | Stored (production) | Fresh incoming | Owner CSV 2026-11-05 | Fresh = owner, byte-exact |
|---|---|---|---|---|---|
| 5961 | Finlay Macrae, 2020 National | `Surrey Park/Xavier College/Oakleigh U18` | `Kew Rovers/Xavier College/Oakleigh U18` | same as fresh | **YES** |
| 6784 | Finlay Macrae, 2025 Post-Draft | `Surrey Park/Xavier College/Oakleigh U18` | `Kew Rovers/Xavier College/Oakleigh U18` | same as fresh | **YES** |
| 6626 | Blake Leidler, 2024 Rookie | `Collegians/Wesley College/Oakleigh U18` | `Surrey Park/Wesley College/Oakleigh U18` | same as fresh | **YES** |

(U+200B after each `/` omitted above for legibility.) Nothing differs, so no per-id difference is reported back. Stored
differs from both in all three, as the issue records. Acceptance is the owner's `owner_rulings` entry, not this run.

## 6. Findings for the orchestrator

- **F-001 (MED, escalated):** a real, sealed load of this acquisition is impossible without owner-level changes that Q2 says
  to record only: (a) the tool's parity gate fails against the frozen 2026-08-26 oracle (no manifest; needs an owner policy
  for a source that has legitimately changed); (b) `EXPECTED_ROWS`/`EXPECTED_PERSONS` 6810/5057 in `import_draftguru.py`,
  `parity_baseline` in `draftguru-contract.json` (and, per the issue, `DRAFTGURU_EXPECTED`, `EXPECT_STAGE_A_EVENTS`, the
  linkage SQL) must become 6845/5088. The unpatched dry-run therefore refuses at the manifest, not at the guard.
- **INFO:** the guard's 35 protected-pick rewrites (`competition` NULL to `AFL`) and 35 person rank rewrites need
  `acknowledged_protected_rewrites` / `acknowledged_protected_person_rewrites` entries in the reconciliation.
- **INFO:** 4 origin changes (233, 378, 635, 859) are outside the 187-row review and are auto-accepted classes if an
  `origin_review` entry is supplied; three go from NULL to a value.

## 7. Commands (all on streamanator; rc 0 unless stated)

`tar -xzf`, `sha256sum` (dump), `python3.12 -m venv` + pinned `pip install`, `initdb`/`pg_ctl start`, `createdb`,
`pg_restore --no-owner --no-acl --exit-on-error`, `acquire_draft.py --label annual-html-20261122` (rc 1, drift),
`acquire_draft.py … --accept-baseline-drift` (rc 1, parity), `psql` export, `build_fresh_inputs.py`, `csv_inventory.py`,
`extract_pairs.py`, `reconcile.py`, `classify.py` (fresh and owner), `compare.py`, `compare3.py`,
`import_draftguru.py --dry-run` (rc 1, manifest), `provisional_dryrun.py` (rc 1, guard), `pg_ctl stop -m fast`.
Drivers in `drivers/`.

## 8. Disposal list (owner)

`/mnt/ssd/afldb-backlog-20261122-dg` (1.3 GB): `prod/` (production dump copy), `pgdata/` (restored production auth/audit
data), `venv/`, `src/`, `work-*`, `evidence/`. Nothing was copied elsewhere. A scratch tarball of the source export was on
the workstation only (`D:\tmp\dg-export-scratch`).
