# ISSUE-316 D/P structural proposal — 2026-10-25

**Current status: D/P APPROVED FOR READINESS PROOF ONLY. Production NO-GO pending separate apply approval.**

Owner ruling 2026-10-25: [approved bindings](readiness/APPROVAL.json), [day-D runbook](readiness/READINESS-RUNBOOK.md). All reviewed structural bytes below remain unchanged. Earlier proposal wording is historical; D/window/P are now approved for readiness proof. Activation/deactivation authority files retain their exact reviewed bytes and PROPOSED names; execution remains separately unauthorised.

The owner accepted the initial broader B STOP as a D/P proposal restatement defect.
Only proposed copies and supporting validation/evidence were repaired. Final results:

| Projection | Passed | Expected skipped | Failed | Exit |
|---|---:|---:|---:|---:|
| Broader B | 2966 | 7 | 0 | 0 |
| Broader C | 2992 | 7 | 0 | 0 |
| Focused B | 395 | 0 | 0 | 0 |
| Focused C | 396 | 0 | 0 | 0 |

Fresh-context read-only restatement review: **GO, no stopping findings**.
[Review](validation/restatement-repair/REVIEW.md),
[machine-readable map](restatements/RESTATEMENT-MAP.json),
[fixture/classification record](restatements/REPAIR-RECORD.md),
[final evidence](validation/FINAL-PACKAGE-CHECKS.json).
The same seven expected broader skips remain. All 1574 protected accepted-source,
test, reference/deployment and structural-artifact hashes match. No accepted product or
test assertion changed. The accepted retained-input proof is reused, not repeated.
[Historical STOP](STOP-RECORD.md) and failed repair attempts remain retained.

The successor-activation structural gate is **CLOSED / ACCEPTED**. Implementation: `c438f8449e65c28cf9f00879aaa045131b5f0d3a`; evidence/tracking: `def676517da3955aa18db3606785463aac464188`. [Closure receipt](../AFLDB-ISSUE-316-activation-separation-20261025/STRUCTURAL-CLOSURE.json). A separate local documentation/evidence commit is authorised. Its HEAD is never substituted for P. No push is authorised.

## Approved readiness window, D and P

- Approved readiness/proof window: **2026-10-27 02:00–04:00 UTC** (**13:00–15:00 AEDT**, Melbourne).
- Approved rollover date **D = 2026-10-27 (UTC)**. If D slips, STOP, regenerate D-sensitive material and return for owner adjudication.
- Exact structural source **P = `def676517da3955aa18db3606785463aac464188`**. Its parent is the accepted implementation candidate; the difference is evidence/tracking only.
- U3 CONFIRMED; U4 Route B; Brownlow untouched. ISSUE-316 remains OPEN.

## Seven-file apply write set and regenerated pins

[Transition change set](transition-change-set.json): SHA-256 **`d55875cbfa686ac47511eca2e2ac7026cfadefd1fd4e7ab1b31c322f7359644b`**. Its complete write_set and final_sha256 have exactly seven members and omit `tools/db/rebuild-test.ts`.

[Old/new pins](PIN-TABLE.json) includes every base at P. All seven base pins are byte-identical to J2 base `876dadbf`. The accepted J2 transition hash was `85b5f05af179c83fa0fcc4898263204a6d92e6ed99069cb8bb8384f2cb1886a1`; its eight-file coupled shape is obsolete for execution.

| Apply path | Accepted J2 final SHA-256 | Proposed D/P final SHA-256 |
|---|---|---|
| `data/reference/afltables-network.json` | `3d03022267745316dd71d27580f9c4d369bfc6f03e4da332e302965d3c40d2eb` | `04e2a269559cbc09a590e22e46207cd199d78eb60dbdc49c605bb2e724d3b897` |
| `tools/rebuild/afl_api/afl-api-contract.json` | `1453fffaa50dee67c369967ef397c666c180241978f5ffb22c842255af5f5148` | `1453fffaa50dee67c369967ef397c666c180241978f5ffb22c842255af5f5148` |
| `tools/rebuild/afltables/afltables-contract.json` | `ca4291cb19963d83734e94e1dda36e6d27d2abef32491e4cac27e79dfc3ca60f` | `ca4291cb19963d83734e94e1dda36e6d27d2abef32491e4cac27e79dfc3ca60f` |
| `data/reference/fitzroy-accepted-baselines.json` | `6a2a4b8681c2d3d89388abbdfe9aa7569f55014ce2be151788b1d80d67e5a049` | `0d4f7b3067112d8cf7fb3acc97b73ffb909b51cee09d8c4f59c326beb7e4f05f` |
| `data/reference/seasons.json` | `1368e9b100788fd67d2f378830445df424591368536c22473b11add62be629b0` | `1368e9b100788fd67d2f378830445df424591368536c22473b11add62be629b0` |
| `tools/rebuild/fitzroy/fitzroy-contract.json` | `fef594af13b977e60d847f0a692837ce32c61cb2315c8ce6844a44898ac512cd` | `4e98a4c96b57011937f78c5dbd2c7cfd50d4cd65b270d11279173b9dbda3edd5` |
| `data/reference/stat-availability.json` | `e2900084ebd7e9505239b82aef8f8665fcf7939e7b84b94b13e110fa6cfcc2b8` | `e2900084ebd7e9505239b82aef8f8665fcf7939e7b84b94b13e110fa6cfcc2b8` |

The stat-availability write is byte-identical to the base. Thus seven planned writes produce six changed tracked blobs. Adding the two unchanged acquired manifest blobs produces **eight actual Git changes**, despite the older decision form's provisional nine-file commit count. [State B](SIMULATED-TREES-AND-AUTHORITIES.json) retains the complete seven-write membership. The two acquisition manifests are separate inputs, not apply writes.

## Tuple, activation and deactivation

- [Successor tuple](successor-tuple.json): canonical activation-table SHA-256 **`a78d36ee7e689b7bb5978335bff5e6bdd54f368572df5f2f01d10caf35a373aa`**. The pretty-printed artefact SHA-256 is `b95d07e1ac0bc6163f83e23678eb0e5ade11e4c03dd4ce53d81db27dcdb5525e`. The semantic tuple and core/witness hashes equal accepted J2.
- Inactive `rebuild-test.ts`: **`320960e482699e33afb112f8a765d711bd21c6c032ce464d5f18d39d8956ccc8`** ([bytes](pins/rebuild-test.inactive.ts.txt)).
- Projected active `rebuild-test.ts`: **`ab7349470d5de859e83763fb8b9b07c9d4fce1db817046dc3e8a741f65bc3338`** ([bytes](pins/rebuild-test.projected-active.ts.txt)). This is byte-identical to the accepted J2 active rebuild blob.
- [Proposed activation authority](activate-authority.PROPOSED.json): SHA-256 `1d133580f526131cf31136df042b372047b170e9925db525a21ef80c5658f65f`; binds simulated B commit `06e882277644731d665c148970b96ab214f42701`.
- [Proposed deactivation authority](deactivate-authority.PROPOSED.json): SHA-256 `fc45063484cfd6a07b0c716345898399298d2cc62d6b4c406846f554b96dee8c`; binds simulated C commit `75df67dbed56ecd2d3906d561bbdafd53fff9f12`.
- Both are **PROPOSED**, under schema `afldb.rollover.successor_activation/1`. Parsing, change-set/tuple/head/migration binding, exact single-file planning and inverse state classification pass. They grant no owner authority. Actual future commit metadata must match those heads or the authorities must be regenerated and adjudicated; they cannot be applied to the current HEAD.
- [Migration-set binding](migration-binding.json): 117 files, ending `117_brownlow_provider_eligibility_unknown.sql`, set SHA-256 `647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72` (name order and LF-normalised file checksums). The production migration ledger has not been inspected.

## Date-bearing material and semantic difference

[Semantic diff](SEMANTIC-DIFF.json) enumerates all four changed stamps: network `changed_at`, successor acceptance `accepted_on`, successor validation `validated_on`, and fitzRoy range `resolved_on`. The three date-bearing final artefacts and every consuming proposal pin/authority have been regenerated for D. The other four finals are byte-identical to accepted J2.

The candidate is **structural**, not a date-only re-pin: seven apply writes instead of eight; activation separately bound and reversible; the inactive rebuild pin read-only during apply; separate B and C states, recovery boundaries and authorities. The existing resolver/reconstruction functions are unchanged; the accepted code adds tuple hashing and exact inverse removal helpers. No migration, canonical data, Brownlow publication, source input or rebuild expectation was changed.

[Simulated trees and authority checks](SIMULATED-TREES-AND-AUTHORITIES.json) and [incremental review bundles](BUNDLES.json) are offline objects only. B's tree is `a8ce0f34c48766e03c7f4443d53520c494a9e64e`; C's is `4d520565cbe6269cfc9ddc0951a10b8cab44e4cc`. Bundle prerequisites are explicit; the original branch, HEAD and real index were not moved. B is applied/installed/inactive and **rebuild-ineligible**. The projection validates C (1,640 rows, 91 check definitions) and proves B's expected refusal; no SQL or database rebuild proof was executed.

## Validation at exact P

[Complete DB-free matrix](validation/DB-FREE-MATRIX.json): **11,318 passed / 31 skipped / 0 failed**, across 207 suites, using each suite's latest result. This is a complete matrix assembled from the broad run and affected reruns, not a claim that the first broad invocation passed.

- Initial full run: 11,303 passed / 39 skipped / 7 failed, exit 1. All seven failures were missing local immutable data omitted by Git archive.
- Supplied [existing local fixture inputs](validation/fixture-inputs.json) byte-for-byte; affected DraftGuru/fitzRoy suites reran: **328 passed / 1 skipped**, exit 0. The optional recovered coach bundle was supplied and its suite reran: **39 passed**, exit 0. No source/assertion edit.
- Remaining 31 declared skips: 20 database-backed cases; 10 Windows/shell/link/signal limitations; one absent optional Gridley archive. The exact skipped suites/counts remain in the matrix and original JSON results.
- `npm run typecheck`: **exit 0**, [log](validation/typecheck.log). No build, installation, integration run or database work.
- [All 2,687 tracked archived files match P](validation/source-P-integrity.json), zero mismatches. Fixture data and generated type/cache files are outside that committed source inventory. The retained validation tree now lives under `.local-release/issue316-dp-20261025/source-P`, the existing tsconfig exclusion; no tsconfig or product edit was made. Historical run records retain their actual original validation paths.
- [Static transition and state checks](STATIC-VALIDATION.json): strict prepare/binding and seven final pins PASS; C resolves 1,640 and builds 91 checks; B refuses as inactive; 1622 predecessor constant preserved. These are **not** a replacement for the real three Python validator gates.

## Accepted retained proof and repaired restatements

The accepted retained J2 proof remains unchanged: 167/167 package hashes, 264/264
successor inputs, real offline validator exit 0 / 3-of-3 gates / all pins match,
seven-file apply shape, installed/inactive B, and projected C 1,640 rows / 91 check
definitions. It was not repeated because the test restatements were defective.
No new disposable rebuild was performed or indicated.

The initial B 2,956/7/32 result is historical D/P proposal-restatement evidence,
not a product/rebuild finding. P's complete inactive refusal fixtures are restored
in B; J2's adopted resolution/guard/mutation/final-check assertions remain C-only.
Explicit predecessor invariants are retained identically in both states.
The map covers 4364 declarations, including every changed test,
with 0 unmatched P declarations and 0
unmatched runtime titles. Fixture repairs and material input/state assertions are
explicitly recorded. See the linked review and final test results above.

During the restatement repair, root issue/index/changelog files were unchanged.
The subsequent owner D/P approval authorises synchronized documentation/tracking
and a separate local evidence commit. ISSUE-316 remains OPEN. No issue is closed here.
No fresh Git/index/ancestry/diff check is claimed; prior structural evidence is retained.

**Owner D/P adjudication: APPROVED for readiness proof, 2026-10-25.**
The approved window is 2026-10-27 02:00–04:00 UTC (13:00–15:00 AEDT, Melbourne).
P stays `def676517da3955aa18db3606785463aac464188` after documentation commits.
Proof has not run; await the approved window and follow the bound runbook.
Current native/host proof, fresh read-only censuses, nightly/canonical check and
enforced dry run only are authorised. Apply, activation, deactivation, deployment,
disposable rebuild and push remain unauthorised. No production operation was
performed while recording this ruling. Structural gate CLOSED / ACCEPTED;
U3 CONFIRMED; U4 Route B; Brownlow untouched; production NO-GO.
