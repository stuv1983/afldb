# Linux rehearsal follow-up — 2026-10-20

**Migration compatibility: INCOMPLETE. Production: NO-GO.** Settlement compatibility is
now PASS on the full restored dataset. The missing authentic staged Brownlow comparator
is an absent evidence prerequisite; the acceptance amendment below is proposed, not approved.

One agent; starting branch `v2/rebuild`, HEAD
`ee1ebc40cd24979c4f8259492a2df682bf7eab2d`, matched. Only untracked `.codex/` was present;
remotes were empty. Existing worktrees, subsequent changes and prior evidence were preserved.
No production/shared connection, deployment, timer change or traffic switch was made.
The archive, untouched baseline and migration-only preservation pair were not changed.

## All 27 original settlement failures

Numbers below are the one-based assertion order in retained
`production-copy-settle-afl-api.json` (73 assertions). A denotes a **test-fixture collision**
which correctly triggered fail-closed application behaviour; B an **environment preparation
defect**; C a **test-target mismatch / correct fail-closed refusal**. No application defect
or unmet authentic match-identity prerequisite was demonstrated by these 27 failures.

| Assertion | Contract / original failing assertion | Cause and disposition |
|---|---|---|
| 1 | New CONCLUDED match; inserted count > 0 | A; dedicated test clubs |
| 2 | Idempotent replay; first-run inserted count > 0 | A; dedicated test clubs |
| 3 | Provider contradiction; prerequisite inserted count > 0 | A; dedicated test clubs |
| 6 | Attendance enrichment; missing prerequisite match.sourceId | A; dedicated test clubs |
| 7 | New final derived totals; inserted count > 0 | A; dedicated test clubs |
| 8 | Final correction; prerequisite inserted count > 0 | A; dedicated test clubs |
| 11 | Unmapped provider venue; expected refusal counter 1 | A; earlier identity refusal masked venue gate |
| 12 | Missing canonical venue; expected refusal counter 1 | A; earlier identity refusal masked venue gate |
| 13 | Venue self-heal; expected initial venue refusal 1 | A; earlier identity refusal masked venue gate |
| 14 | Incomplete-source contract; missing expected pending row | A; prerequisite match refused |
| 15 | Terminal batch/replay; inserted count > 0 | A; dedicated test clubs |
| 18 | Unused emergency; expected played-player insertion 1 | A; prerequisite match refused |
| 19 | Durable player refusal; prerequisite insertion > 0 | A; dedicated test clubs |
| 20 | Moot refusal/human resolution; prerequisite insertion > 0 | A; dedicated test clubs |
| 21 | Match Sheet authority; prerequisite match undefined | A; dedicated test clubs |
| 22 | Date correction; prerequisite insertion > 0 | A; dedicated test clubs |
| 23 | Identity collision; prerequisite insertion > 0 | A; dedicated test clubs |
| 24 | DATE refusal; candidate-details object differed | A; extra restored candidate |
| 25 | ROUND refusal; candidate-details object differed | A; extra restored candidate |
| 27 | Second meeting; unexpected identity refusal 1 | A; restored PF remained plausible |
| 28 | Different season; unexpected identity refusal 1 | A; restored current-season PF remained plausible |
| 29 | Swapped orientation; unexpected identity refusal 1 | A; restored original-orientation PF remained plausible |
| 30 | Multiple fixtures; candidate-details object differed | A; extra restored candidate |
| 31 | Apply-time race; candidate already refused during planning | A; dedicated test clubs |
| 45 | Human-link lifecycle; unresolved-player counter 0 instead of 1 | A; prerequisite match refused |
| 59 | Importer-link refusal; provider-evidence SELECT timed out | B; restore had no planner statistics; ANALYZE |
| 68 | OD-5 reinstatement; rebuild target-name refusal | C; use existing `afldb_v2_rb_*_test` family |

Representative evidence preceded repairs: the earlier retained first-case diagnosis proves
`possible_existing_match`; `followup-representatives.json` reproduces insertion refusal and
the provider-evidence timeout on a fresh restored clone. Original assertion 68's retained
stack proves the target-name refusal. Its repaired execution passes on the existing allowed
rebuild family; the guard was not broadened. A combined filtered diagnostic also hit a
temporary setup failure in OD-5; it is retained and is not the target-name proof.

The concrete collision is the authentic AFL Tables-owned 2026 Hawthorn–Brisbane PF on
19 September. Original synthetic cases moved its date but kept season, oriented clubs and
round. That is deliberately a plausible existing match under I244-F030. Calendar weekdays
never provided isolation. The test now creates two namespaced synthetic clubs and their
organisations, injects only a test-local provider-team map, and removes its own fixtures.
Every original assertion remains. No historical match was deleted, renamed or re-owned;
no production reference mapping or ambiguity/ownership rule changed.

On restored data without ANALYZE, the evidence query's plan nested source-family scans
under an incorrect one-row estimate. Restoring application-table statistics fixes the
reproduced timeout at the unchanged 5-second application statement limit. No query or
timeout policy was changed. Rehearsals must ANALYZE a disposable restored test copy before
interpreting performance failures. Owner ANALYZE skipped inaccessible shared system
catalogues with warnings; application table statistics were populated and the full suite passed.

## Full restored compatibility and authentic match identity

All databases below are new copies in WSL `AFLDB-V2-Rehearsal-20261020`, namespace
`afldb-v2-rehearsal`, isolated PostgreSQL port 55434. Child environments are cleared and the
existing launcher supplies verified isolated DSNs. No sensitive environment file is copied.

- `afldb_v2_hist_settlement_test`: untouched-source representative failures, retained.
- `afldb_v2_rb_settlement_test`: full restored migration-copy data, ANALYZE, dedicated
  insertion fixtures, **73 passed / 0 failed / 0 skipped**. Includes real constraints,
  transactional rollback, forced batch-finalisation failure, ambiguity and ownership refusals,
  concurrent apply-time recheck, replay, correction, adjudication and reinstatement.
- `afldb_v2_shadow_authentic_test`: separate restored copy for authentic feed correlation
  and representative rejection/replay stimuli; original attempts and final evidence retained.
- `afldb_v2_shadow_brownlow_before_test` and `..._after_test`: separate baseline/migration
  clones for the read-only alternative comparison; subsequent synthetic integration writes
  occur only on the after clone, outside the preservation pair.

Reproduce the settlement preparation inside the existing isolated launcher environment:

```bash
node --import tsx tools/v2/isolated-pg.ts create-db afldb_v2_rb_<new_tag>_test \
  --template afldb_v2_shadow_migration_test
node --import tsx tools/v2/isolated-pg.ts run afldb_v2_rb_<new_tag>_test -- \
  node /home/rehearsal/evidence/pgtool.mjs psql -v ON_ERROR_STOP=1 -c ANALYZE
node --import tsx tools/v2/isolated-pg.ts run afldb_v2_rb_<new_tag>_test -- \
  node node_modules/vitest/vitest.mjs run tests/integration/settle-afl-api.test.ts --no-cache
```

The retained authentic 2026 feed has 218 entries, 217 concluded and one scheduled. All 217
concluded records build without failure and resolve uniquely to restored canonical matches:
**217/217 exact match-key resolutions** and **217/217 fixture-observation resolutions**.
The existing observation writer, inside one rolled-back transaction, appends 217 initial
versions; its second pass appends zero and reports 217 unchanged observations. No persistent
identity mapping is needed or proposed for these matches. Although all 218 restored 2026
matches are AFL Tables-owned and none carries an AFL API `CD_M` source_record_id, that is
not a missing mapping defect: exact-key and fixture-observation fallback are supported paths.
The scheduled feed record belongs to the separate ISSUE-229 fixture gate.

The unmodified retained full-match sample correctly refuses `unproved_match_date`: its roster
does not contain `venueLocalStartTime`. Nothing was fabricated to call that sample a successful
authentic full-settle acquisition. Separate, explicitly labelled contract stimuli supplement
that roster with a local-time cross-check derived from the fixture, then test two agreeing
replays, a score disagreement and a shifted date against the restored PF. These stimuli
corroborate/refuse without canonical writes. They prove defensive compatibility, not provenance
of a missing authentic roster field or a production correction authorisation.

Hashes/counts of complete `matches`, `match_period_scores`, `player_match_stats`,
`brownlow_round_votes`, `brownlow_season_votes`, `canonical_applications`, `data_overrides`
and `award_winners` remain equal after every representative stimulus and after the rolled-back
observation pathway. Committed diagnostic staging/batch/findings are confined to the disposable
authentic copy. Existing canonical/audit preservation evidence remains applicable.

**Match identity is operationally ready for the retained 217 concluded-match population.**
No unresolved legacy-match mapping blocker was found. New provider date/round discrepancies
still require refusal and supervised investigation; unobserved future matches and complete
authentic roster acquisition are not certified by this correlation check.

## Brownlow: what is missing and what the alternative proves

The original comparator runs the current staged match-vote reconciliation before and after
migrations. Beyond raw-row preservation and synthetic integration tests, an authentic completed
season would exercise real provider/canonical player and match identities, round translation,
3/2/1 completeness, API-versus-stored totals, eligibility/ranks, published outcome and finding
stability on the same real input. The shadow loader has **no staged leaderboard source**;
leaderboard reconciliation would require the retained authentic acquisition separately.

Targeted retained-evidence search only:

- Archive: zero staged Brownlow seasons (already established; no new archive requested).
- Documented local `data/sources/afl_api/brownlow/` and
  `data/sources/AFLWebsite/AFLGamesSamples/`: absent, including the documented source-worktree
  locations under `D:/dev/afldb-afl-api-cutover/`. No parent/drive crawl was performed.
- The retained match-snapshot label directory is empty. The roster snapshot manifest describes
  `fetch_player_details_afl` data, not vote sets or a leaderboard.
- Committed Brownlow fixtures are IN_PROGRESS 2026 examples with Alpha/Bravo/Charlie synthetic
  recipients; they cannot serve as authentic completed-season evidence.
- Acquisition documentation §14.10 records historical backtests for 2022–2025 but supplies no
  accessible authentic vote snapshot/manifest in these retained locations. A historical prose
  PASS is not a new provenance/checksum-verified replay. No public request was necessary for
  this bounded retained-snapshot search; no staging input was fabricated.

Alternative evidence executed with the real production-archive data: read-only, repeatable-read
calls to the production loader and reconciliation, explicitly selecting `storedOnlyFallback`
and `stored_eligible_rank_one`, fixed report time and unchanged season registry. All **98 stored
seasons** produce determined presentations. Complete reports are byte-identical on the
baseline-110 and migrated-115 disposable clones. This proves stored totals/rank/eligibility/
published-outcome read compatibility; it does **not** exercise real API vote-set identity or
API-versus-stored reconciliation. Earlier complete raw-vote/audit preservation remains PASS.

Affected checks: **35/35** Brownlow integration; **159/159** reconciliation, eligibility and
shadow-report unit checks; TypeScript `tsc --noEmit --incremental false` and changed-file ESLint
both exit 0. No application/runtime/schema/packaging file changed, so the previously passing
builds were not repeated. No historical rebuild, screenshots or rollback sequence was repeated.

### Proposed owner acceptance amendment — not approved

> For the specific production archive SHA-256
> `a583fc7d8d4376aa816253adf299a1325da7e65c994576b6b56bfa136ed11b04` and migrations 111–115,
> accept the staged Brownlow before/after criterion as an unavailable comparator prerequisite,
> using the previously passing complete raw-vote/audit preservation, identical 98-season
> stored-only before/after reports, and passing 35 integration / 159 unit-report checks as the
> alternative migration-compatibility evidence. This accepts no authentic API-versus-stored
> vote/identity/leaderboard reconciliation or live-transition claim. Require that evidence on
> the first provenance/checksum-verified supported completed-season snapshot before accepting
> the corresponding API Brownlow operational/publication readiness. This amendment authorises
> no production connection, data correction, deployment, timer or traffic change.

Owner acceptance is still required; compatibility and backend acceptance remain INCOMPLETE.
The evidence absence is not a demonstrated migration functional failure. Remaining risk is
real-provider identity, round, vote-set and eligibility disagreement not exercised together by
the alternative. Existing production gates remain: ISSUE-229 B2/first apply, ISSUE-316 ordered
retirement/inert-install/host rehearsal, host backup/recovery/routing evidence, other existing
release holds (including strict Gridley 50 unapproved findings), and explicit release approvals.

## Restricted evidence

Under `/home/rehearsal/evidence/`: original detailed reports; `followup-representatives.json`,
`followup-repaired-representatives.json`, `followup-full-settlement.json`,
`followup-authentic.mts` / `.json`, `followup-brownlow.mts`,
`followup-brownlow-before.json`, `followup-brownlow-after.json`,
`followup-brownlow-integration.json`, `followup-brownlow-units.json`,
`followup-analyze.log`, `followup-typecheck.log`, `followup-lint.log` and their retained scripts.
Detailed identities and database-derived records remain outside Git. The follow-up evidence
inventory/hash is retained separately; previous manifests and evidence are not overwritten.

SHA-256 of `followup-evidence.sha256`:
`8193f5d40d1caf7ef6a9b53eeff9a04afcd360844234c1b400b66e0a9be6a52d`.
The complete Brownlow before/after reports share SHA-256
`fea86e5dcbd74027f9d5951a6eb09405b95c2669acb03c5cc3a83613e0346db2`.
All 98 outcomes are `reconciled`, with zero findings. Temporary inspection scripts were
retained under the restricted `followup-scripts/` directory; unrelated `.codex/` state remains.
