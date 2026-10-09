# AFLDB-ISSUE-310 — AFL API link path derives the stable player identity by a different rule from the forward classifier

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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
