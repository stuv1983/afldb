# ISSUE-348 F-348-1: sealed plan for the DraftGuru reload of `annual-html-20261122` (NOT EXECUTED)

**Status.** Sealed and rehearsed 2026-11-22 (backlog run b). **No production write has happened.** Executing it needs a
separate owner approval of this plan and an attended window. No production host was contacted to prepare it: production facts
come from `../R0-SITTING-20261122.md` and `tools/v2/gap029-ops/profile.production.env`.

**Authority.** Owner message 2026-11-22, decision 4 (F-348-1): update the source check for this reviewed acquisition and pin
it by digest; re-baseline (Q2(b)); accept the three REPLACE_CLUB rows only where incoming equals the 2026-11-05 owner CSV
byte for byte, reference = the CSV hash in `SHA256SUMS.owner-csv` (Q2(c)); present a sealed plan; no production write.

## 1. Digests (everything the sitting checks)

| Item | sha256 |
|---|---|
| Stage A manifest `docs/rebuild-manifests/draftguru/annual-html-20261122.json` | `26ca190b3f0f9c7120c506289319b75118a79305c55767f9db7540d6ef22a27c` |
| Contract pin `reviewed_acquisitions["annual-html-20261122"]` parsed rows (`parsed/rows.jsonl`) | `7f73f2cc3fa7fdfb14345868891ef09f9ae58d3e448e231afc0fec1174fd6f40` |
| Pin robots.txt | `d3bdd06996b60f3806e7ebe732d8c12951b9a4b640706bbbfb77d258a695413b` |
| Raw pages | the 42 entries of `raw-pages.sha256` (this folder), copied verbatim into the contract pin |
| Reload-guard **effect digest** (identical in all 6 runs: 2 dry, 3 loads, runner) | `ff8ef1b8ef900d9ab5b17c89b2f0f85d5b3091e9493456a45b2a5f67cf766452` |
| Guard report `sealed/guard-report-annual-html-20261122.json` | `91d1da0e9f394f26df513df8e8f03835b93623867bc1cd995fa0a719754150a4` |
| Reconciliation `sealed/reconciliation-annual-html-20261122.json` | `cf49f6a5671155c174d60497372fbf9c1fd15fce01bd9f0d3f3dab8619e0de4e` |
| Bridge (the production GAP-029 S2 child, byte-equal off-production copy) | `d6251609b12f48ad1c48a8bd33482820e606e123f9b12fa16a3769e6b7f15d6e` |
| Transfer archive `i348-transfer.tar` (90 snapshot files + child + reconciliation; deterministic, rebuilt twice) | `478d4f809204f329251e9f58d03f1ab8a7491cb51f710c90a5b27f51aea77afb` |
| `sealed/i348-transfer.SHA256SUMS` (92 lines) | `632aefe9024253acd86e967d9285f3f81656788cc20bdbc5a893d3d3de951326` |
| Runner `sealed/i348-load.sh` | `61f44acb10cd63bbc7465e56289759b3a8bddd49713228ebc358683c10429c0d` |
| Digest SQL `sealed/draftguru-surface-digest.sql` | `ae742dcc1cae5f5429e1e8c6a022b27c960ab1f89761f2d90b7456d9746e1dd0` |
| R0 dump (rehearsal base) `afldb_prod-20261122-025248.dump` | `26db476126b8a2e5474a452d5bfdb9b790031a11e797481065e37041c1761d8b` |
| Tool commit (local, unpublished) | `7b52c46c`; `git archive` of it `b03eaf6f…f1e012`. The runner checks **file blobs**, not the commit id: `import_draftguru.py fd7b0abb…`, `reload_guard.py af3874e7…`, `parse_draft_snapshot.py 6f2faa37…`, `draftguru-contract.json cc5e0858…`, manifest `26ca190b…` |

## 2. Effect (rehearsed on the R0 state; identical across three fresh restores)

The write set declared before the rehearsal (reviewer R-5) was observed, **plus changes the declaration did not list**:
`name_key` on 31 audited persons (guard-visible, acknowledged in the reconciliation) and the source re-baseline of unprotected
rows in the "Source re-baseline" bullet below (`source_record_id`, career games/goals, `draft_age`, `height_cm`). They follow from
loading the newer source (owner Q2(b) "re-baseline to the fresh acquisition") but were not declared in advance, so the owner
should read them as part of this approval:

- **No deletions.** 0 picks, 0 persons. `draft_picks` 6,845 → 6,845, `draft_persons` 5,088 → 5,088.
- **Link state unchanged in both directions.** `link_persons` and `link_picks` digests are byte-equal before and after;
  `external_identities` existing 5,057/5,057 keep `player_id`/`status`/`match_method`. Linked picks 5,215, linked persons 3,564.
- **`external_identities(draftguru)` +31** (5,057 → 5,088): the 31 D-336-2 persons, all `unmatched`, `player_id` NULL. All
  5,057 existing rows have `notes` relabelled to `stage_a_snapshot=annual-html-20261122`.
- **Guard-reviewed changes (the reconciliation):** 35 audited picks `competition` NULL → `AFL`; 35 audited persons
  `dg_person_id` (per-load rank), 31 of them also `name_key` from the D-336-2 alphanumeric form to the importer's G6 form;
  191 `original_club_raw` changes = 174 INSERT_SCHOOL + 11 INSERT_CLUB + 3 RENAME_EXPAND (auto-accepted classes; 187 from the
  D-336-3 classifier rows, 4 outside its 1991-2025 range: 233, 378, 635, 859) + 3 REPLACE_CLUB with owner rulings
  (5961, 6784 `Kew Rovers/Xavier College/Oakleigh U18`; 6626 `Surrey Park/Wesley College/Oakleigh U18`; incoming bytes equal
  the single owner-CSV cell, CSVs verified against the tracked `SHA256SUMS.owner-csv` sha `c495599b…a7c0`).
- **Source re-baseline outside the guard's review (unprotected rows, every full reload does this):** `dg_person_id` on 6,676
  picks / 4,967 persons (rank); `source_record_id` index shift on 1,472 picks (same URL, 11 years); `reported_games` +327 /
  NULL→value 35, `reported_goals` +143 / NULL→value 35 (career totals have grown; never decreased); `draft_age` −1 on 101
  (the source's age basis); `height_cm` 8 (6 NULL→value); `confidence_notes` 35 picks / 31 persons (the
  "AFLDB-ISSUE-336 bounded insert" marker is replaced; `data_edits` stays the audit trail). Breakdown: `sealed/logs/characterise.json`.
- **`import_batch_id`** restamped on all 6,845 picks; **one** `import_batches` row (`completed`).
- **Untouched (digest-equal):** `players`, `data_edits`, `data_overrides`, `player_link_resolutions`, `matches`,
  `player_match_stats`, the 8 non-DraftGuru picks.

The whole surface is captured by `sealed/expected-pre.txt` (R0 state) and `sealed/expected-post.txt` (after-state;
identical for reh1, reh2 and the runner rehearsal reh3).

## 3. Preconditions (each is a STOP if not met)

1. Owner approval of this plan and a window. Proposed: inside the weekly Tuesday 10:00–10:30 Melbourne slot once it exists,
   or any attended daytime window; not while a writer unit runs.
2. The tool change is published (origin/main contains blobs equal to §1) and the candidate checkout is extracted from the
   published revision at `/home/arm/ops/i348/cand` (`git archive` of that revision; `node_modules` not needed).
3. `i348-transfer.tar` copied to `/home/arm/ops/i348/in/` (0700), sealed folder copied to `/home/arm/ops/i348/seal/`.
4. A fresh pre-load backup: R0's command with a new directory (`backup.sh --dir <new> --keep 1000`, never bare), sidecar
   hash, off-host copy verified (as R0).
5. Admin draft editor quiet for the window (TOCTOU, `issues.md` ISSUE-348). The `digest pre` check includes `data_edits`,
   `data_overrides` and every DraftGuru row, so any edit since R0 stops the sitting.
6. `digest pre` equals `expected-pre.txt`. Any drift since R0 (an admin draft edit, a settle that touched these tables)
   stops the sitting; re-rehearse from a new backup. The importer independently refuses if the effect digest differs.
7. Production python `/home/arm/projects/afldb/.venv/bin/python` imports psycopg (verified by `verify`; rehearsal used 3.3.4).

## 4. Exact production commands (host `afldb-prod`, user `arm`, no sudo)

```
cd /home/arm/ops/i348/seal
bash i348-load.sh verify        # tar, 92 sums, tool blobs, pages into cand, python, offline --validate-only
bash i348-load.sh digest pre    # must print DIGEST pre MATCHES
bash i348-load.sh load          # the single write; one transaction; refuses a second run
bash i348-load.sh digest post   # must print DIGEST post MATCHES
```

There is deliberately **no production `--dry-run`**: a dry run that passes the guard retains a `failed` `import_batches`
row. The guarded dry run, both rehearsals and this runner ran on R0 restores instead (§5). The load re-runs the guard and
refuses unless the effect digest equals the reconciliation's.

## 5. Rehearsal record (streamanator, isolated cluster `127.0.0.1:61540`, workspace `/mnt/ssd/afldb-backlog-20261122b-348`)

| Run | Database | Result |
|---|---|---|
| R0 restore + migrate | `afldb_v2_b348_r0tpl_test` | `pg_restore` exit 0, 0 stderr lines; ledger 118, nothing to apply |
| Guarded dry run, no reconciliation | `…_dry1_test` | REFUSED, effect digest `ff8ef1b8…` |
| Guarded dry run, reconciliation | `…_dry2_test` | passed; dry run rolled back |
| Real load 1 / 2 (fresh restores) | `…_reh1_test`, `…_reh2_test` | rc 0; after-state digests equal (excluding batch ids) |
| Sealed runner, all phases + 5 refusals | `…_reh3_test` | VERIFY OK, pre MATCHES, load rc 0, post MATCHES; refused: load before pre, post before load, second load, tampered reconciliation, wrong host |

Logs: `sealed/logs/`. Scripts: `sealed/scripts/`. Private row dumps stayed in the workspace (`ev-private/`, 0700).

## 6. Verification after the load

`digest post` MATCHES is the acceptance. Then: the public `/draft/<year>` pages for 2020, 2024 and 2025 render; ISR may
serve the old origins until revalidated (no restart is needed for a data change).

## 7. Recovery

The load is one data transaction: a failure rolls back and the runner stops (never re-run; report). After a successful
commit there is no mechanical partial undo. Recovery is an **owner decision**: restore the pre-load dump of precondition 4,
which also discards every write made after it (settle results included). Link state cannot be damaged by this load (proved
equal), so recovery is only for an unexpected owner objection to the re-baseline.

## 8. Notes the owner should see

- **R-2, still open.** The default-label rebuild (`DRAFTGURU_EXPECTED`) still yields 6,810 / 5,057; the ISSUE-348 clause
  "the rebuild differs from production by 35 rows" is unchanged until the owner decides whether the rebuild moves to this label.
- **R-6.** `--link-only` and the GAP-029 draft-link production path refuse on production today and will after this load.
- Not moved, by design (each verified by search): `parity_baseline`, `EXPECTED_ROWS`/`EXPECTED_PERSONS` (link-only and
  unpinned labels), `DRAFTGURU_EXPECTED`, `EXPECT_STAGE_A_EVENTS`, the linkage SQL, `draftguru-event-kinds.json`, and the
  bridge gate's `EXPECTED_POPULATION`. They describe the 2026-08-26 snapshot, whose verification is preserved.
- Transfer tar entries carry mtime 2026-11-22T00:00Z; extracting before that instant prints a harmless "time stamp in the
  future" warning.
