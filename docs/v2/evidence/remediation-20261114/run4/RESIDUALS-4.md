# Remediation run 4 — residual register (supersedes `../run3/RESIDUALS-3.md` where it differs)

Every residual known at the end of run 4. **"Accepted" appears nowhere here**: a grade is not the owner's acceptance, and each row waits for
the owner (`APPROVAL-PACKET-4.md` §C). Run-3 and run-2 residuals not listed in §3 are **unchanged** (`../run3/RESIDUALS-3.md`,
`../run2/RESIDUALS.md`).

Status words: **fixed locally** (committed on `claude/remediation-20261114`, unpublished); **qualified** (passed at the executable revision,
`QUALIFICATION-4.md`: Q″ `1f7b0d71`, fix-loop Q‴ `16027092`); **awaiting publication / owner decision**.

## 1. Fixed in run 4 (no residual beyond publication)

| Item | Commits (integration branch) | State |
|---|---|---|
| D-365-1: a completed season without loaded Brownlow results stays `pending`; only the declared 1897–1923 and 1942–1945 seasons are `not_applicable` (`BROWNLOW_DECLARED_NO_MEDAL_SEASONS`) | `88edaf43`, `5e4b38bb` | fixed locally for **future recomputes**, qualified; no existing row repaired (§2.1) |
| 363-W: club-comparison 24 + 2 and `database` 4 witnesses: application result = independent all-season oracle, ≤ 2025 oracle = literals; stable keys | `a1571ee5` | fixed locally, qualified |
| 363-G / 363-B: release-gates provisional-season gates on a rolled-back suite season; birth-date pins follow the accepted rebuild | `6778a4ec`, `a88eadc9` | fixed locally, qualified (the 3 pins fail on the 4 Nov snapshot by design: §2.4) |
| 363-C: awards-reload-links Coleman legacy scope 46 (1980–2025) with an independent oracle and a rekey-refusal regression; contract files frozen | `f0848638` | fixed locally, qualified |
| Item 2: issue276 finals coverage restored on suite-owned season 2069 (`CD_I4040S2069`) | `f0848638` | fixed locally, qualified |
| Item 3: the three `settle-afl-api-brownlow*` suites use owned `CD_I4010…` ids; the real `CD_I297354` row asserted unchanged | `ec308d74` | fixed locally, qualified |
| Item 4: the four `database` count witnesses no longer go stale when a season completes (synthetic later-season proof) | `a1571ee5` | fixed locally, qualified |
| Item 5: 40 rebuild-only failures (surrogate ids, empty `auth_users`, real-row deletion in `v2-coleman-publication` teardown) | `430a3a4a` | fixed locally, qualified |
| T363-2 / T363-3 shared mode (`admin-fixtures` deleted all `fixtures`; `after-siren` re-ran the loader) | `c48de090`, `9c73adfb` | fixed locally, qualified: shared mode fails exactly the per-file ids on both bases |
| Shared-mode row leaks (F-003): seven suites restore or remove what they write; awards spans restored (`awards_last_season_fkey`) | `6f580dca`, `581a898b` | fixed locally, qualified |
| state-b borrowed a real `auth_users` row; club-comparison 2026 coverage literal | `ffd7f2ed`, `259df1c5`, `65fe171d`, `6eb90a3e` | fixed locally, qualified (F-FX-1 mutation at Q‴: `fixloop/README.md`) |
| Item 1: the evidence checker's cross-folder basename match (run 3's 1 COMMITTED-MISMATCH) | `d184d63e`, map `16027092` | replaced by `run4/evidence/verify-manifests.sh` (exact resolution; run-2 script byte-identical, `run2/evidence/ERRATA.md`) |
| Stage map line after the D-365-1 edit (`docs/v2/architecture.md` §9) | `6eb90a3e` | fixed at Q‴ (unit (e) failed at Q″) |
| RB-1 recorded (two names, one directory) | `ca806a7f` | `docs/v2/isolated-rebuild.md` §6, `blockers.md`, HANDOFF; excluded from cleanup |

## 2. Residuals

### 2.1 ISSUE-365: existing rows are not repaired (MED, owner)
- The rule changes only future recomputes. On the 4 Nov snapshot (production-derived) the three 2026 `stat_availability` rows read `pending`, but all
  **669** 2026 `player_season_stats.brownlow_status` rows read `not_applicable` (the accepted rebuild: 669 `pending`); `recomputeSeasonBrownlowStatus(2026)`
  clears them (rolled-back dry run, `brownlow/raw/repair2026.txt`). Production itself was not read.
- **Owner path:** B0 read-only probe → conditional repair (packet §B, `brownlow/README.md` §6.3 steps 1–3 with the acceptance query), separately approved.
- `lockMatch` still words an ABSENT coverage row as "No Brownlow Medal was awarded in {season}." (`src/db/queries/admin-brownlow.ts:723-724`; LOW, F-4).
- Migration 016 and the retired `tools/migration/import_legacy_afl.py` still derive `not_applicable` from an absent medal (applied migrations are never
  edited; no live script invokes the importer); `docs/deployment.md` §7 and `docs/production-cutover.md:158` still document that path (INFO).

### 2.2 Public wording of a `pending` Brownlow season (MED, owner decision; no UI change in run 4)
- `brownlowStatusNote('pending')` ("The season is still in progress; the Brownlow Medal has not been awarded.") is false for a completed season whose
  results are not loaded (`src/lib/format.ts`, `/players/[slug]`, pinned by `tests/e2e/journeys.spec.ts:134`). Proposed: "Brownlow Medal results for this
  season have not been loaded yet." Not changed (PLAN-REVIEW-4 F-006).

### 2.3 Gridley on the accepted rebuild (class 5, owner)
- Three Gridley corpus ids fail only on the rebuild: the standard rebuild reproduces **0** `data_overrides` (snapshot 165) and 64 GAP-029 `match_event`
  labels (`clubcmp` F-CC-4). Owner: must the standard rebuild reproduce administrator overrides, or are these ids rebuild-limitations? The snapshot's
  one Gridley id is run 3's N7 (unchanged).

### 2.4 Base-pinned expectations (LOW, owner)
- **363-B:** the three birth-date gates are pinned to the accepted rebuild (13,347 / 13,367 / 14,294) and fail on the 4 Nov snapshot (13,255 / 13,275 /
  14,110) until production is re-enriched; class 1 there, pre-registered (PLAN-REVIEW-4 F-009).
- **PLAN-REVIEW-4 F-021:** the approved release-gates re-pins remain baseline-pinned: they go stale when the accepted baseline changes.
- **`nl-answers-after-siren`** carries two literal sets selected by measured state (snapshot vs rebuild: 5 or 0 2026 kicks without a match link); the owner
  may retire the snapshot set once the snapshot is no longer a qualification base (`shared` F-002, LOW).
- Snapshot-only class-1 ids (each passes on the accepted rebuild): `admin-brownlow` P2, `data-editor` ×5, `draft-linkage` ×2, release-gates Brownlow
  authority (183 vs 0) and "remaining players" (110 vs 18).

### 2.5 Test-harness notes (LOW / INFO)
- Fixture season **2071** is used by `admin-fixtures` (run 4) and `settle-afl-api-state-b` (run 3); suites run serially in shared mode and each removes its
  own rows, so only crash debris could collide (registered as a known overlap in `tests/integration/leaked-fixtures.ts`). Season **2075** is
  `brownlow-fixture.ts`'s accounting season (the `leaks` allocation collided; that scope committed no season). **2066**: `brownlow-pending-projection`
  commits it; `release-gates` uses it only inside a rolled-back transaction.
- Shared-mode residue after a full run: `import_batches` grows (rebuild 27 → 149, snapshot 75 → 197; tests read it only relatively) and the snapshot
  gains one 2026 `award_winners` row (award 47, source 10) from awards-reload-links' real reload, which the rebuild already holds (qual F-003; present
  at B4 too, `leaks/raw/attrib-greensnap.tsv`). Owner: capture/restore of real award rows in that suite, or accept convergence to the extract.
- `v2-coleman-publication` refuses on any base holding a Coleman 2001 row (by design; 28/28 on its schema-only base); its teardown no longer deletes the real row.
- Three long-rivalry performance tests have ~250 ms Brownlow ceilings with little headroom under load (`clubcmp` F-CC-2, INFO).
- The Q″ rebuild assigns `venue_aliases` surrogate ids non-deterministically (set-equal, counts identical; qual F-004, INFO).
- `tests/rate-limit.test.ts:55` (1 ms window) failed once in one full unit run at Q‴ and passed 10/10 alone and in a second full run: a timing flake, pre-existing, not in the diff (`fixloop` F-002, LOW).
- F-FX-1 acceptance: a club-less 2026 vote row for a player without a 2026 season row (`mnew`) correctly trips the unchanged multi-club invariant at
  `club-comparison.test.ts:1800`; the acceptance mutation is the club-attributed `mreal` (70/70 on both bases). Orchestrator decision, recorded (`fixloop` F-001).
- `run2/qualification-2/SHA256SUMS:28` pins the hash of a never-committed stripped copy of `unit-stagea2.log`; the run-4 checker verifies it through a
  declared transform (`evidence` F-001, LOW).
- The `settle-afl-api` OD-5 test refuses a non-rebuild database name by design (74/74 on an `afldb_v2_rb_*_test` clone).
- RUN-PLAN-4 F-008's "evidence/ checker directory" wording was read two ways by qual (both lists recorded in `qualification-4/README.md` P0); the
  orchestrator applies it to `run4/evidence/` (the checker, its map and self-test), so the map change made Q‴ (INFO).

### 2.6 RB-1: rebuild inputs live in one retained workspace (owner; retained, excluded from cleanup)
- `/mnt/ssd/afldb-i316-rb-I-20261023T0905Z` is a symlink (created 2026-11-05) to `/mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z` (same inode):
  one directory, two names, both protected (`RB1-PATHS.txt`, `docs/v2/isolated-rebuild.md` §6). Run 4 never read it: the Q″ rebuild used the run-3
  rebuild workspace's hash-verified copies (8/8 verified before, after copy and after the rebuild).
- Losing it (and the run-3 copies) blocks the standard rebuild. A proposed `CLAUDE.md` line is in the packet only (§C).

## 3. Run-3 residuals changed by run 4

| Run-3 row | Change |
|---|---|
| §2.1 ISSUE-365 | rule fixed locally (D-365-1); existing rows and production unread → §2.1 |
| §2.2 27 stale witnesses | fixed (363-W) |
| §2.3 season-state and contract pins (Coleman 46, three 2026 gates, birth dates) | fixed (363-C, 363-G); birth dates follow the rebuild (363-B, §2.4) |
| §2.4 shared-mode effects; `settle-afl-api-brownlow*` real id | fixed |
| §2.4a issue276 finals coverage; `database` witnesses go stale | fixed (items 2, 4) |
| §2.5 verifier false positive | fixed by the run-4 checker |
| §2.6 rebuild inputs | RB-1, §2.6 |

## 4. Host footprint left in place (owner housekeeping)

Run-owned workspaces `/mnt/ssd/afldb-rem4-*-20261115` and their `-pg` cluster roots (baseline, brownlow, clubcmp, coleman276, evidence, fixup, gates,
leaks, rbfail, shared, qual, fixloop) and `/mnt/ssd/afldb-rem4-base` (bundles `base-B4`, `base-Qpp`, `base-Q3`, `SHA256SUMS`, heavy lock). Every cluster is
stopped. The Q″ rebuild dump (`f3c7dca9…`) is in the qual workspace (`qualification-4/HOST-SHA256SUMS`). Nothing was deleted. Recommendation: keep
`afldb-rem3-base/rebuilt/`, the qual workspace's rebuild dump and RB-1; the rest may be removed after publication on the owner's instruction.
