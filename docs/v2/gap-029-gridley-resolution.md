# V2-GAP-029 — Gridley residual closeout, 20 October 2026

Status: **partly resolved; strict release gate remains failed**. Code/reference commit: cc11e0d9, followed by the source-denominator assertion correction. Production and broader release gates are unchanged. No full workflow was rerun.

## Counts and evidence

The previous “172 cells” were **172 findings across 156 distinct cells**. The machine-readable inventory is [gap-029-gridley-residual-inventory.json](evidence/gap-029-gridley-residual-inventory.json). It links each dated board/cell and criterion pair to expected IDs, evaluated actual membership, observed differences, adjudication and exact missing evidence. Skipped/unavailable memberships remain UNKNOWN; the oracle's sparse identity bridge cannot prove complete identity parity for unbridged answers.

| Category | Before findings / cells | Resolved findings / cells | Remaining findings / cells |
|---|---:|---:|---:|
| Match events | 42 / 42 | 0 / 0 | 42 / 42 |
| Registration / 2026 | 8 / 8 | 0 / 0 | 8 / 8 |
| Existing §23.36 deferrals | 78 / 78 | 0 / 0 data matches | 78 / 78 approved deferrals |
| Rookie draft | 23 / 7 | 23 / 7 | 0 / 0 |
| Siblings | 21 / 21 | 0 / 0 | 21 / 21 |
| Total | 172 / 156 | 23 / 7 | 149 / 149 |

Raw strict findings and memberships are preserved separately in gap-029-gridley-strict-before.json and gap-029-gridley-strict-after.json. Strict parity: **FAIL, 149 findings**. Approved deferrals: **78**, always **0 data matches**. Policy conformance: **FAIL, 71 unapproved differences**. Any unexpected category, criterion pair or cell fails the policy gate as well as strict parity, including in diagnostic mode.

## Existing approval, not new deferrals

ISSUE-118 §23.36 W.2 expressly classifies the seven criteria; W.3 says “every remaining unsupported-valid criterion is an explicitly accepted deferral”. §23.38 and issues.md record their formal acceptance and closure proof. This is documentary acceptance evidence, not an inference from diagnostic success; a separate signed owner transcript is not retained.

All seven remain unsupported. Their original 26 criterion occurrences bound the same 78 cells in the current corpus: season2024player 14, intrulesplayer 5, irish 2, recruitedByDodoro 2, nfl 1, spoils5season 1, tasmanian 1. data/reference/gridley-approved-deferrals.json enumerates the exact cells and pins the corpus digest. No calendar expiry was recorded. Support, canonical-scope or source changes require review; changed corpus bytes or spent/new unsupported entries fail closed. No new deferral is approved here, and existing approval does not close strict parity.

## Repairs and bounded review

Eight already-reviewed rookie records were admitted through the existing createManualPick writer into **afldb_v2_gap029_test**, a marked clone of the preserved afldb_v2_rb_final_test. Each has a canonical AFL Tables identity, cited evidence with primary/secondary strength retained, one data_edits audit and one stable-identity data_overrides selection payload. Repeat application found all eight present and made no additional selection. Repair, repeat and independent audit evidence are the three gap-029-rookie-*.json files. tools/v2/repair-gridley-rookies.ts defaults to a read-only plan and refuses non-isolated targets, ambiguous identities and conflicting picks. Phil Davis's evidence was upgraded to the directly-read official AFL 2022 draft summary, GWS rookie pick 3. Secondary pick-number provenance for Rischitelli and Gibbs remains explicit.

The combined run exposed one additional stale assertion after these valid additions: an all-source draft count expected 6,810 and saw 6,818. The corrected test strictly retains **6,810 DraftGuru rows**, independently reconciles manual rows to active durable selection records, and rejects unexplained source rows. It does not repin the source denominator or accept an arbitrary larger total.

Both official trade pages were read directly. They establish Jamarra Ugle-Hagan, Western Bulldogs → Gold Coast, the 2025 trade and pick 74. Their extracted text does not expose publication timestamps, so the earlier precise 2025-10-15 completion-day claim is not independently established in this review. The 2025 trade is sufficient to establish that it followed board 541's **2025-01-07** key. The general 1-November tradesAfterBoard rule was removed: the tracked board-541 record applies only to that exact board, cell, date, stable profile, Gridley ID, criterion pair, direction and sole linked trade. Counterexamples cover another identity/cell/board, dates after the verified trade, reverse direction, different thresholds and prior trades.

The seven earlier repaired assertions were reviewed within scope. Historical <=2025 and later >=2026 scopes remain distinct; SQL expectations count underlying facts without invoking application query helpers; legacy and canonical identity digests retain explicit deterministic order and exact original pins. Linux collation is now expressly labelled **inference**, not an observed host fact. No useful regression was skipped or given a tolerance.

## Missing evidence and owner decision

- **42 event cells:** the isolated baseline's 16,838 matches have no labels. The legacy importer reads games.match_event; no recoverable labelled snapshot/export was found in the tracked snapshots or scoped documented artifacts. Need exact sourced event matches/labels. No date/clubs/venue-only rule was invented.
- **8 registration/2026 cells:** the authentic 2026 roster hash matches its retained manifest, but its 2026-09-05 capture post-dates boards 990 (April 1), 992 (April 3), 1000 (April 11) and 1035 (May 16). Existing Malcolm Rosas/Finnbar Maley identities were preserved; Willem Duursma/Jagga Smith are missing canonical identities. Need authentic registrations and match participation by those board cutoffs. The documented raw 2026 match-snapshot directory is empty here. September memberships do not replace historical keys.
- **21 sibling cells:** all concern Jarryd Lyons. Lions primary pages establish Corey as his brother and a Brisbane draftee; the canonical database has no Corey identity. Missing displayed official statistics do not prove zero games. Existing policy is “both sides linked to canonical players, and the brother having played a VFL/AFL match (player_career_stats.games > 0)” (src/db/queries/grid-solver.ts, has_brother). Need evidence of a qualifying senior appearance plus canonical identity, or an explicit owner decision. **Proposed decision, not approved:** if senior-game investigation confirms no qualifying appearance, approve a narrowly enumerated 21-cell semantic adjudication for Jarryd/Corey while preserving raw strict mismatches. Do not broaden has_brother globally.

Primary citations and precise limitations are retained in gap-029-reference-review.json and data/reference/gridley-board-541-trade.json. There is no reason to reapprove the seven existing deferrals.

## Isolated runtime and reproduction

Port 55432 was owned by ssh.exe; the documented isolated cluster was stopped. No SQL ran against that listener: authentication failed before verification. No further connection to it was attempted after its process owner was identified. The preserved data directory was started on unused loopback **55433**, and the launcher verified live cluster afldb_v2_isolated plus the database marker. Existing credentials worked; no reset, reinitialisation, credential change or authentication weakening occurred. The SSH listener was left alone. The isolated cluster remains running on 55433; retain this port override until the unrelated port conflict is resolved.

PowerShell, repository root (no DSN required):

~~~powershell
$env:AFLDB_V2_PG_ROOT='D:\tmp\afldb-v2-pg16'
$env:AFLDB_V2_PG_PORT='55433'
node node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts verify afldb_v2_gap029_test
node node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts run afldb_v2_gap029_test -- node node_modules/tsx/dist/cli.mjs --conditions=react-server tools/v2/repair-gridley-rookies.ts
~~~

Add --apply only for the authorized isolated repair; existing correct rows are idempotent. The full six-file focused command and exact assertion results are retained in gap-029-gridley-verification.json. No production or shared database was modified.

## Verification outcome

Final combined focused run: **1,378 passed / 3 failed / 7 skipped** of 1,388. The three failures are the two preserved strict corpus checks and the independent policy check. Known-answer errors and solver timeouts are zero. Typecheck and changed-file lint pass; all nine tested implementation/reference SHA-256 digests reconcile. The earlier 1,377 / 4 / 7 run and the exposed all-source count failure are retained in the verification record. No full workflow was rerun.

## Repository files changed

- `CHANGELOG.md`
- `data/players/rookie-relisting-outcomes.csv`
- `data/reference/gridley-approved-deferrals.json`
- `data/reference/gridley-board-541-trade.json`
- `docs/v2/evidence/gap-029-gridley-residual-inventory.json`
- `docs/v2/evidence/gap-029-gridley-strict-after.json`
- `docs/v2/evidence/gap-029-gridley-strict-before.json`
- `docs/v2/evidence/gap-029-gridley-verification.json`
- `docs/v2/evidence/gap-029-membership-identities.json`
- `docs/v2/evidence/gap-029-reference-review.json`
- `docs/v2/evidence/gap-029-rookie-audit.json`
- `docs/v2/evidence/gap-029-rookie-idempotence.json`
- `docs/v2/evidence/gap-029-rookie-repair.json`
- `docs/v2/final-report.md`
- `docs/v2/gap-029-gridley-resolution.md`
- `docs/v2/go-no-go.md`
- `docs/v2/known-gaps.md`
- `docs/v2/local-release-review.md`
- `docs/v2/risk-register.md`
- `tests/gridley-compat.test.ts`
- `tests/gridley-corpus-support.ts`
- `tests/gridley-release-policy.ts`
- `tests/integration/gridley-corpus.test.ts`
- `tests/integration/release-gates.test.ts`
- `tools/v2/repair-gridley-rookies.ts`

The pre-existing untracked .codex/ directory was untouched. Ignored .local-release diagnostics/test reports and generated typecheck output were also produced; no temporary diagnostic script is part of the retained implementation. IssuesIndex.md and issues.md were not changed: this is the existing V2-GAP-029 ledger entry in known-gaps.md, whose open index is synchronized above.
