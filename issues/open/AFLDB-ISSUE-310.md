# AFLDB-ISSUE-310 — AFL API link path derives the stable player identity by a different rule from the forward classifier

## 0. Status

- **Status:** Open (2026-10-08). Implemented on `sonnet/issue-310` (2026-10-15), not yet merged: §17.
- **Severity:** Low. **Area:** AFL API identity / adjudication ledger.
- **Key files:** `src/db/queries/afl-api-player-links.ts` (`readPlayerStableIdentity`, `linkAflApiProvider`), `src/lib/acquisition/afl-api-adjudication.ts` (`classifyAflApiForwardIdentity`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-045; partition note R5b-F03).
- **Classification:** the divergence is code-proven. Which path gets picked depends on the database collation.

## 1. Summary

`classifyAflApiForwardIdentity` is documented as "the single implementation behind every forward lookup". It is used by replay, promotion-check and Match Sheet authority. It resolves two AFL Tables paths only when they form a tracked continuity pair, and answers `ambiguous` for any other pair or for two manual tokens. The human link path instead uses `readPlayerStableIdentity`: `ORDER BY (s.key <> 'afltables'), ei.external_id LIMIT 1`. That picks the collation-first path and never refuses.

## 2. Evidence

- `src/db/queries/afl-api-player-links.ts:75-88` and `:721` (`chosenPlayerHasStableIdentity: stableIdentity !== null`).
- `src/lib/acquisition/afl-api-adjudication.ts:1556-1593` (classifier) and `:1634-1647` (the rebuild refuses ambiguous players).
- Classifier users: `tools/migration/replay_afl_api_adjudications.ts:279`, `tools/db/promotion-check.ts:1689`, `src/lib/acquisition/match-sheet-authority.ts:216`.
- The same-domain sibling refuses multiples: `src/db/queries/player-identity.ts:42-56, :96-103`.
- Continuity pairs: `tools/rebuild/fitzroy/fitzroy-contract.json:67-68, :85-86, :103-104, :121-122`.

## 3. Trigger

- (a) A continuity-pair player under a linguistic collation. The renumbered `…Cameron3.html` sorts before the continuing path, so the wrong one is stored. The database collation is pinned nowhere in the repository.
- (b) A player with two non-pair paths or two manual tokens. T7 is never raised, and an arbitrary identity is recorded.

## 4. Expected invariant

The link path uses the forward classifier and maps `ambiguous` / `no_identity` to T7.

## 5. Actual behaviour

The ledger's stored `player_identity` can differ from the §5 forward identity, and a player the rebuild would refuse is admitted.

## 6. First wrong layer

`src/db/queries/afl-api-player-links.ts:75-88`.

## 7. Impact

- Bounded: the reverse consumers accept either side of a continuity rule, so replay and promotion still resolve the right player.
- The string-equality consumers would miss an agreement, overlap or finding (`afl-api-adjudication.ts:1837, :1905`; `afl-api-identity-correction.ts:1504, :1523`).
- A two-token player linked here is later graded `UNEVALUABLE` by G2.

## 8. Reproduction / witness

Not executed. A DB-free witness on `classifyAflApiForwardIdentity` (three shapes) is described in the R5b notes (W1).

## 9. Disproof attempts

The D6-3 comment claims alignment with the promotion-inventory lineage ref, which was pre-amendment (the same `ORDER BY` at `promotion-inventory.ts:1763, :1780, :1948, :1969`). The 2026-09-25 continuity amendment changed the classifier, not these.

## 10. Existing-issue search

ISSUE-235/237/238/241/242; `readPlayerStableIdentity` appears nowhere in the ledger. Classification: **new**, regression-adjacent to the ISSUE-237 continuity amendment.

## 11. Scope

`readPlayerStableIdentity`.

## 12. Out of scope

The `promotion-inventory.ts` lineage ref, which its owner should check against the same amendment (recorded as a lead in the review).

## 13. Proposed fix boundary

Load the accepted rows and call `classifyAflApiForwardIdentity` with `loadFitzroyProfileContinuityRules()`. Map `ambiguous` / `no_identity` to T7.

## 14. Proposed validation

1. The DB-free witness on the classifier.
2. A mocked-transaction test of `linkAflApiProvider` with a two-non-pair-path player, expecting T7.

## 15. Decisions / unresolved questions

- The database collation on DEV/PROD (`SHOW lc_collate`), operator-run. It decides whether trigger (a) is live.

## 16. Next action

Implementation.

## 17. Implementation record (2026-10-15)

- **Commits:** `3961d6fd68bdda20ede4e81ee87556a6d4a324a5` (fix) and `616e383bd10dae12f0e4a3ee14a5337c06ad7b7a` (tests), on `sonnet/issue-310`, base `84e71cd3`. Single agent, no subagents.
- **Scope decision (§15).** The open collation question decides only how often trigger (a) fires on DEV/PROD; it does not change what the link path should do, and trigger (b) (two non-pair paths, two manual tokens) is collation-independent. The fix is therefore the same either way and needs no host action. The collation itself is **not** established here and stays an operator-run fact.
- **Shape (§13).** `readPlayerStableIdentity` (`src/db/queries/afl-api-player-links.ts`) now reads the player's accepted identity rows (same two namespaces and predicate as before) and decides with `classifyAflApiForwardIdentityRows` / `classifyAflApiForwardIdentity`, the implementation behind replay, promotion-check and Match Sheet authority. `ambiguous` and `no_identity` both return `null`, so `chosenPlayerHasStableIdentity` is false and `decideAflApiLink` refuses T7. The tracked continuity contract is read only when exactly two distinct AFL Tables paths exist, from `process.cwd()` (the `match-sheet.ts` precedent), through `loadContinuityRulesFailClosed`; an unreadable contract yields an empty rule set, which names no pair, so the player is `ambiguous` (fail closed). The stored `player_identity` for a continuity pair is the rule's `continuing_url`, not the collation-first path.
- **Callers.** Three callers share the function: the link write (stored identity and T7), the provider detail page (`playerStableIdentity`, which already renders `null` as "no stable identity - cannot be linked", so a now-ambiguous candidate shows as unlinkable instead of previewing an arbitrary identity), and the revoke ledger row.
- **Revoke (not in the §13 sketch; reported).** `afl_api_identity_adjudications.player_identity` is `NOT NULL` (migration 104). With the strict reader a revoke of a player who has since become ambiguous would insert `NULL` and fail, making an existing link impossible to undo. The revoke row therefore uses a new `readPlayerRecordedIdentity`: the forward identity when there is one, otherwise the previous deterministic first accepted row (afltables-first, then `external_id`). Only the link and its preview are gated on the strict rule.
- **T7 wording.** `aflApiRefusalMessage('T7_player_not_stable')` now says "no single stable identity (one AFL Tables profile, a tracked profile continuity pair, or one administrator-created identity)", since the refusal now also covers an ambiguous player. No test pinned the old text.

## 17.1 Validation (2026-10-15, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- New cases: 6, in a new `describe('AFLDB-ISSUE-310: linkAflApiProvider stable identity (DB-free)')` of `tests/player-link-mutations.test.ts` (the suite that already pins `afl-api-player-links.ts`). They drive the real `linkAflApiProvider` through a scripted transaction: two non-pair AFL Tables paths; three paths and two manual tokens; no identity; a real tracked continuity pair (`players/C/Charlie_Cameron.html` / `Charlie_Cameron3.html`, the contract's own rule) in both row orders, asserting the stored `player_identity` is the continuing path; a single path over a manual token and a lone manual token; and a source contract that the revoke uses `readPlayerRecordedIdentity` and the collation-ordered query is gone. The script answers the old reader as well as the new one, so the cases can fail on the old source.
- Result: `-t ISSUE-310` **6 passed**. `tests/player-link-mutations.test.ts` plus `tests/player-links-page.test.ts`: **162 passed, 1 failed (163)**. `npx tsc --noEmit` exit 0. `npx eslint` of the two changed source files exit 0; of the test file only the pre-existing `no-explicit-any` errors, none in the added lines (3661 onward).
- **The one failure is pre-existing and unrelated:** `AFLDB-ISSUE-235 S6 ... I14 owns its actor and its teardown needs nothing from setup`, identical on unchanged `main` `84e71cd3` (re-run there: 1 failed). Not touched.
- **Against the pre-fix source** (`src/db/queries/afl-api-player-links.ts` restored to `84e71cd3`, then back): **3 of the 6 new cases fail** (both ambiguous-to-T7 cases and the revoke contract); the other three pass either way. Honest limit: the continuity-pair case passes on the old source too, because the scripted answer reproduces a *C-collation* sort, under which `Charlie_Cameron.html` happens to sort first; the divergence it guards is a linguistic-collation effect that a JavaScript script cannot recreate. It pins the rule, not the collation bug.

## 17.2 Mutation checks of the tests (2026-10-15, assistant-run; Windows, DB-free)

Each mutant changes the real fix, is applied alone and restored from the saved bytes (verified identical afterwards); only the `ISSUE-310` cases are run. Script and raw output: `D:\tmp\issue310\mutate.py`, `mutation.txt`.

| Mutant | Result |
|---|---|
| M1 continuity rules always empty | killed (1) |
| M2 `ambiguous` mapped to the first row | killed (2) |
| M3 revoke uses the strict reader | killed (1) |
| M4 a pair never consults the contract | killed (1) |

All 4 killed; none survived.

## 17.3 Limits

Not deployed. No PostgreSQL, integration, browser, DEV or PROD action; the real-database cases in `tests/integration/settle-afl-api.test.ts` (including I4/T7) were not run. The DEV/PROD collation (`SHOW lc_collate`) is not established. The revoke of an ambiguous player (the `readPlayerRecordedIdentity` fallback) is pinned by a source contract, not executed. `tools/db/promotion-inventory.ts` (the lineage ref §12 leaves to its owner) is untouched.
