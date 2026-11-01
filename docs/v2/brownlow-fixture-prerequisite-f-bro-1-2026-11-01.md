# F-BRO-1: the authentic 2025 fixture-identity prerequisite for the Brownlow workflow (2026-11-01)

**Status: IMPLEMENTED AND REHEARSED LOCALLY WITH AUTHENTIC INPUTS. NOT RUN ON PRODUCTION. No production observe or Brownlow operation is authorised by this record.** It supersedes the F-BRO-1 text in the master sequence section 6 and the "prerequisite (corrected)" row of the ordered package.

## 1. The finding, restated

Stage B3 (`adopt`) groups the 207 Brownlow vote sets by match, and every set was `unknown_match` on the production-derived restore because production holds **no 2025 `afl_api` match-family (fixture) observations** (only the 217 of 2026). The general fixtures CLI `settle-afl-api-fixtures.ts` refuses sealed seasons (`refuseSealedSeasonForSettle`), deliberately.

## 2. Correction: the authentic 2025 acquisition **is** retained, and was checked first

The earlier statement "the fixtures snapshot is not retained anywhere" was wrong. It is retained inside `D:\tmp\afldb-gap006-brownlow-artifacts-20261101` (`fixture-root.tar`, sha256 `23cc8b76bbab21897aa9fcbd41573bd77166ad82ce53d3e36dbfc3130f37ce23`): `data/sources/afl_api/fixtures/afl-api-2025-2026-10-20-014218`, 217 files (season index plus 216 fixture files), manifest kind `afl_api_fixture_snapshot`, acquired 2026-10-20T01:42:18Z, manifest sha256 `46a793d8874ff7e1063e4323cb14154f7852dfd184679588dfae58f59b769b36`. Offline `--validate-only` with the real tool: every file hash matches the manifest, the season feed is complete (216, all CONCLUDED), **212 fixture records build**, and 4 do not (round 25 finals `FW1`, which need `finals_match_label`); the Brownlow votes cover only the 207 home-and-away matches, so the four refusals are irrelevant to them. This is identical to the 2026-10-20 authentic rehearsal. **Therefore the one authorised bounded provider capture was not needed and was not made.** Nothing is manufactured from canonical rows and no simulated rehearsal prerequisite is copied into production evidence.

## 3. The route: stage B0, a governed, digest-bound observation

* `observe` with `"stage": "fixture-identities-2025"` (`FIXTURE_IDENTITIES_STAGE`), `--snapshot-label afl-api-2025-2026-10-20-014218`. The operation stays `observe`, so the `brownlow_correction_receipts` CHECK on `operation`, migration 116/117/118 and the closed `AUDITED_CORRECTION_WORKFLOWS` list are **unchanged**; the stage is a field of the request, the approval and the receipt result.
* `tools/v2/brownlow-fixture-prerequisite.ts` **pins** the snapshot in code: season 2025, the label, the manifest sha256 above, scope key `season=2025`, 212 built records, the four refused provider ids. It loads offline (the label must equal the pin; the manifest bytes must hash to the pin; `verifyManifest`; the records are built with the real `buildAflApiFixtureRecords`; count and refusals must match), computes the records digest, and the plan binds all of it. Any other label, a one-byte change in any snapshot file, or a different revision is refused.
* **First load only.** The plan is refused if any `afl_api` `match` observation for `season=2025` already exists.
* **Canonical football data is proven unchanged inside the transaction.** The apply hashes every table in the closed baseline list before and after; only `import_batches`, `staging.source_records` and `staging.source_record_versions` may move. Anything else moving (or those not moving) fails and rolls the whole stage back; this was exercised with an injected trigger that touches `players`.
* **The general CLI refusal is intact**: `settle-afl-api-fixtures.ts` still refuses sealed 2025 (checked as a control in the rehearsal); the only change to it is exporting `fixturesRawFrom`. No blanket bypass, no change to `packages/domain/src/season-seal.ts`.
* **Digest dependency.** B0 adds one `import_batches` row and 212 `staging.source_records` plus their versions. `import_batches` is in the Brownlow baseline list, so a baseline, backup and restore evidence taken before B0 are void for B1 and are retaken after it (master sequence section 3).

## 4. Complete ordered rehearsal with authentic prerequisites

`tools/v2/brownlow-isolated-e2e.mts`, the real runner CLI, real `pg_dump`/`pg_restore` into a second database per stage, a fresh clone of the verified production restore (ledger 117, 17,056 matches, 0 fixtures, **0 afl_api 2025 match observations, 0 seed batches: the starting state is production's**). **Linux, revision `2134e2fd`: 76/76.** The earlier Windows run of the same driver was 74/76 (both failures were driver bugs: `records_inserted` is a bigint that postgres.js returns as a string, and the "plan again is refused" check re-planned from the pre-apply backup, so the baseline guard refused first); fixed in `2e23790a`.

| Stage | Authentic result |
|---|---|
| **B0 fixture-identities** | plan binds the pin, 212 built records and the four finals refusals; refusals (an approval that does not name the stage, a non-pinned snapshot label, an approval pinned to another revision, the general settle CLI on sealed 2025, an injected canonical write) each leave the state unchanged; apply commits **212 observations in one completed batch naming the manifest hash**; **15 canonical tables hashed before and after are identical**; no staging vote row is created; replay writes nothing; a second plan is refused ("first load only"); the 212 `(record id, payload hash)` pairs have fingerprint `212:45c8e8f3d144624ae0b130f8471f80eb`, **identical** to the fingerprint of the 2026-10-20 authentic rehearsal output (compared on Windows) |
| B1 observe | 621 typed rows, 207 distinct sets, no canonical vote change, one receipt, replay writes nothing, 2026 untouched |
| B2 backfill (1984 to 2025) | plan repairs 320,861 rows; injected failure rolls all back; recovery apply commits; `match_id` set on 320,861; the 9,522 2026 rows byte-identical |
| B3 adopt | **207 adoptable, 0 refused** (they were all `unknown_match` before B0); 621 rows adopted to `afl_api`, 8,901 legacy zeros keep their provenance; replay writes nothing |
| Resolve checkpoint | 0 unresolved `afl_api_brownlow_settle` issues, skipped by the package rule |
| E eligibility | 12 decisions; the winner among the eligible is player 9235 with 39 votes, rank 1 |
| Acceptance | exactly five receipts (observe 2, backfill 1, adopt 1, eligibility 1); 2026 vote rows (9,522) byte-identical to the start |

**What is genuine and what is not.** The snapshot, the library, the CLI, the backups, the restores and the hashes are real; the approvals are synthetic (their reference says so) and the target is a disposable restore, not the production OID. Nothing in this run was seeded from another database. The ledger is unchanged by B0 (no migration, no CHECK change).

## 5. Approval statement for stage B0 (when block B is approved)

"I approve Brownlow stage B0 at revision R: `observe` with stage `fixture-identities-2025` of the retained fixtures snapshot `afl-api-2025-2026-10-20-014218` (manifest sha256 `46a793d8…b769b36`, 212 records, four finals refusals), against the target in `target.json`, with the plan digest shown by `plan`, valid until <expiry ≤ 24 h>." It is a separate approval from B1 to E.
