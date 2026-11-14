# Remediation run 4 — run plan (owner-authorised 2026-11-15)

Integration branch `claude/remediation-20261114`, start tip `c8ea9ef8` (run-3 records tip; run-3 candidate `5cef810b`, executable
revision Q′ `692b1902`). `origin/main` `de640826` (re-read by `git ls-remote`, 2026-11-15). Nothing is pushed. Common brief:
`AGENT-BRIEF-COMMON-4.md`. Agent returns are persisted verbatim under the gitignored `.phaneslight/returns/rem4-20261115/` of the
integration worktree. Plan review: `PLAN-REVIEW-4.md` (CRIT/HIGH stops the run; MED is folded in here and in the brief).

## 0. Scope contract (owner message of 2026-11-15, verbatim in the main-session launch; summarised)

Decisions approved for local implementation and qualification: **D-365-1**, **363-W**, **363-G**, **363-C**, **363-B**, **363-3**
(the isolated standard rebuild is the evidence for decision (3); no shared `afldb_test` rebuild), **RB-1** (retain, record, exclude
from cleanup). Work items 1–8: (1) evidence checker cross-folder ambiguity, verified in a fresh clone of the final candidate, the
original failure preserved; (2) restore issue276 finals coverage with collision-free suite-owned fixtures; (3) Brownlow suites using
`CD_I297354`: isolated ids where they create/mutate/clean fixtures, read-only historical assertions preserved; (4) the four
time-sensitive assertions; (5) integration on the accepted rebuilt baseline, dedicated clones, and the supported shared mode;
(6) an exact failure ledger (continuity is not correctness); (7) requalify, final integrated checks; (8) full-delta review, tracking,
residuals, handoff. **Not authorised:** any push/publication; any production operation (B0–B8, even read-only B0); any DEV application
operation (DEV `8b024098` untouched; state recorded read-only before/after); live Brownlow state outside isolated databases; host
policies; deleting logs; expanding the lint allowance (338/43 may only go down); rebuilding the shared `afldb_test`; touching RB-1.

**Interpretation recorded for review:** item 4's "four time-sensitive assertions" are the four `database.test.ts` count witnesses
re-pinned in run 3 (`bb81cbc9`: 695,499 player-match rows, 120, 268, 223), flagged by `CLOSURE-3.md` F-005 and `RESIDUALS-3.md`
§2.4a as going stale when the next season completes. The release-gates "2026 is provisional" gates are 363-G, a separate item.

**RB-1:** `/mnt/ssd/afldb-i316-rb-I-20261023T0905Z` is a symlink (created 2026-11-05) to
`/mnt/ssd/afldb/workspaces/afldb-i316-rb-I-20261023T0905Z` (same inode 23068673, read-only `ls`/`stat`, `RB1-PATHS.txt`): one
directory, two names. Both names are protected in every brief.

## 1. Steps

| Step | Scope | Agent | Port | Depends on | Items / decisions |
|---|---|---|---|---|---|
| 0 | plan, common brief, DEV state before, plan review | orchestrator + reviewer | — | — | — |
| 1 | `brownlow`: D-365-1 in `recomputeBrownlowCoverage` (+ any sibling applying the same rule), docs, regressions for both cases; then item 3 in the `settle-afl-api-brownlow*` and other Brownlow suites | worker | 55681 | 0 | D-365-1, item 3 |
| 2 | `gates`: `release-gates` 363-W (3 ids), 363-G (3 gates), 363-B (3 birth-date ids) | worker | 55682 | 0 | 363-W/G/B |
| 3 | `clubcmp`: `club-comparison` 24 + 2 surrogate-id ids (stable keys, explicit ≤ 2025 scope); item 4 (`database` 4 witnesses); classify the two rebuild-only Gridley assertions (no oracle edit) | worker | 55683 | 0 | 363-W, item 4 |
| 4 | `coleman276`: 363-C (`awards-reload-links` Coleman contract after provenance, independently derived legacy-transition expectation); item 2 (issue276 finals coverage) | worker | 55684 | 0 | 363-C, item 2 |
| 5 | `shared`: shared-mode cross-file defects T363-2 (`admin-fixtures`) and T363-3 (`after-siren`), red/green in shared mode | worker | 55685 | 0 | item 5/6 (363 criterion) |
| 5b | `baseline`: the three cells run 3 never measured, at B4 (F-009): accepted rebuild × per-file (`=all`), accepted rebuild × shared, snapshot × shared (file order recorded); raw verdicts only, no code | worker | 55686 | 0 | items 5, 6 |
| 6 | `evidence`: fixed manifest checker (full-relative-path resolution, every manifest incl. run 2, explicit host map), self-test red/green, original failure preserved | worker | — | 0 (starts when a slot frees; ≤ 5 in flight) | item 1 |
| 7 | integrate (`cherry-pick -x`) into `claude/remediation-20261114`; conflicts resolved by the orchestrator; commit qualification scripts → **Q″** (last executable commit) | orchestrator | — | 1–6 | — |
| 8 | `qual`: fresh host workspace at Q″ — typecheck, lint ratchet, unit (all fixtures), shell harnesses, build; rebuild-reachability decision (rebuild again only if a changed file is reachable from the rebuild plan); integration per-file **and** shared on the accepted rebuild, per-file **and** shared on the snapshot, dedicated clones (two Brownlow clone suites, OD-5 rebuild-named clone, Coleman schema-only base); raw verdicts | worker | 55687 | 7 | items 5, 7 |
| 9 | failure ledger `FAILURE-LEDGER-4.{tsv,md}` (every failing id per mode/base, one class each, gone/new/continuing vs run 3); fix-loop for any demonstrated in-scope defect (→ Q‴, requalify only what changed, reuse justified) | orchestrator (+ worker if a fix) | 55689 | 8 | item 6 |
| 10 | records: `QUALIFICATION-4`, `RESIDUALS-4`, `issues.md` (363, 365, Open Issues table), `IssuesIndex.md`, `CHANGELOG.md`, `blockers.md`, `HANDOFF.md`, `APPROVAL-PACKET-4`, DEV state after; manifest verification with the fixed checker in a fresh clone of this pre-final tip (committed) | orchestrator | — | 9 | item 8 |
| 11 | `afldb-closure` phase A on the pre-final tip: re-derive the delta from `c8ea9ef8` and from `de640826`, re-run focused checks, re-verify manifests in a fresh clone, check packet numbers and ledgers | closure | 55688 | 10 | item 8 |
| 12 | LOW corrections + `CLOSURE-4.md` committed → **final candidate C**; create the durable refs (§2); nothing is committed after C | orchestrator | — | 11 | — |
| 13 | `afldb-closure` phase B (outside the repository): fresh clone of the tag, fixed checker on C, `ref → SHA` equality for tag, branch and integration-branch tip, `git diff --name-only Q″ C` records-only, DEV state re-read; output written outside the candidate | closure | — | 12 | items 1, 8 |

Fan-out: steps 1–5 in parallel (5 in flight), step 6 when the first returns. Each worker has its own worktree `D:\dev\afldb-rem4-<scope>`,
branch `claude/rem4-<scope>-20261115` from the run-4 base B4 (this plan's commit), host workspace `/mnt/ssd/afldb-rem4-<scope>-20261115`,
own cluster root and port. Heavy phases share `flock /mnt/ssd/afldb-rem4-base/heavy.lock`.

## 2. The final-candidate mechanism (no candidate-versus-tip split)

1. **Q″** is the last commit that changes anything outside the record paths (`docs/v2/evidence/…` records, `issues.md`,
   `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`, `issues/`); qualification scripts and the fixed checker are committed at or before Q″.
   Its full SHA is stated in the packet.
2. Every commit after Q″ touches record paths only; the last one, **C**, carries `CLOSURE-4.md` and the packet.
3. After C (and with nothing committed after it): a local **annotated tag `remediation-final-20261115`** on C whose message states
   C's full SHA, Q″'s full SHA, the exact push command `git push origin <C-full-SHA>:main` and Approval A's text with that SHA;
   plus a local branch **`claude/remediation-final-20261115`** at C. `claude/remediation-20261114` also ends at C.
4. The packet (inside C) names Q″ in full and the tag/branch, and tells the owner to run one command,
   `git show -s --format='%H %s' 'remediation-final-20261115^{commit}'` (and `git tag -v`-free `git cat-file -p remediation-final-20261115`
   for the annotation), which prints the SHA the approval and push command name. A packet cannot contain its own hash, so C's SHA
   lives in the tag annotation and in the post-commit verification record written **outside** the candidate by closure phase B
   (and in the final report to the main session).
5. Closure phase B verifies: tag^{commit} = branch tip = integration tip = the SHA in the tag message = the SHA in its report;
   `git diff --name-only Q″ C` is records-only; the fixed checker passes in a fresh clone of the tag.

## 3. Rebuild rule (PLAN-REVIEW-3 F-008 carried)

The accepted-baseline dump `/mnt/ssd/afldb-rem3-base/rebuilt/afldb_v2_rb_rem3-6d5388ea.dump` (sha256 `d8397aab…65c63`) is reused unless
`git diff 6d5388ea Q″` touches a file reachable from the rebuild plan (`tools/db/rebuild-test.ts` stage list: `tools/db`, `tools/migration`,
`tools/rebuild`, `tools/records`, `src/db/migrations`, `data/reference`, and any `src/` module transitively imported by a TypeScript stage
entry). If reachable, rebuild at Q″ in `/mnt/ssd/afldb-rem4-qual-20261115` from the run-3 rebuild workspace's hash-verified input copies
(re-verified against their tracked manifests), never by writing to RB-1.

## 3a. Plan-review mitigations adopted (PLAN-REVIEW-4: PROCEED WITH MITIGATIONS, 0 CRIT/HIGH, 15 MED; all MED binding)

- **B4** is the commit that adds this amended plan, the amended brief and `PLAN-REVIEW-4.md` (F-010); the host bundle and its sha256 are cut after it.
  Fan-out order: wave 1 = `brownlow`, `gates`, `clubcmp`, `coleman276`, `baseline`; wave 2 = `shared`, `evidence` as slots free (≤ 5 in flight).
  Allocation of files, fixture seasons and provider-id prefixes: brief §3a. Only the orchestrator edits `leaked-fixtures.ts` (step 7).
- **F-001 (363-C):** the Coleman contract `data/reference/coleman-derivation.json` and `tests/coleman-derivation.test.ts` stay frozen; only the
  awards-reload-links test's family-size precondition/row counts are reconciled (legacy size 46 for 1980–2025 kept as an explicitly scoped quantity;
  current family size from an independent raw-SQL oracle). Acceptance: red at B4 on both bases; green per-file and shared on both; the two frozen
  files byte-identical to B4; a mutation proof that a 2026 row left in legacy scope makes the rekey refuse.
- **F-002..F-005 (D-365-1):** one named constant of declared no-medal ranges, exactly 1897–1923 and 1942–1945, with provenance
  (`data/reference/stat-availability.json` `coverage_ranges`), bound as parameters, governing the final `ELSE` of all three grains (declared →
  `not_applicable`, otherwise `pending`); the rule never reads the season's existing `stat_availability` row and never treats a missing medal as
  evidence of absence; no table/column/migration (stop and report if one seems needed); `docs/data-dictionary.md` and `docs/architecture.md` updated
  before Q″. Consumers: the rehearsal tool's `SETTLED_BROWNLOW_COVERAGE` pins re-derived as literals from the rule; the rehearsal tool and both Brownlow
  clone suites run at the scope tip and again at Q″ (no run-3 reuse for them). Seven acceptance checks (PLAN-REVIEW-4 F-004). The change does **not**
  repair a row a past recompute already wrote `not_applicable`: the packet says "fixed locally for future recomputes", keeps the read-only production
  probe of 2026 as its own approval, and offers a separately approved conditional repair with its acceptance query; ISSUE-365 stays open until the
  probe result is known (F-005).
- **F-006 (public text):** decided now: **no UI change in run 4.** `brownlowStatusNote('pending')` ("The season is still in progress; the Brownlow
  Medal has not been awarded.") is wrong for a completed season whose results are not loaded; it is carried to the packet as a substantive owner
  decision with proposed neutral wording. No worker edits it.
- **F-007 (item 1):** exact resolution only (manifest directory + entry path, or an explicit committed per-manifest map with root/host-root/alias);
  more than one candidate is its own error class; both halves of the defect (false positive, masked real mismatch) shown red on the run-2 script and
  green on the new one; run-2 manifests included. **Pass criterion:** COMMITTED-MISMATCH 0, AMBIGUOUS 0, every manifest entry in exactly one class
  (committed exact, committed by alias, host-verified, host-missing, declared not retained), manifest UNRESOLVED 0 or each listed with its reason;
  README prose prefixes reported as a separate informational class. Run-2 script byte-identical; its failing output kept; the original run once more
  at B4 as the red; explanation in the run-4 record plus a new `run2/evidence/ERRATA.md` (the one run-2-tree file granted). Run-4 manifests list
  committed files relative to their directory; host-only hashes go in a separately named file with absolute paths. The packet reports counts per class.
- **F-008 (candidate):** record-path **allowlist** for "records only": `issues.md`, `IssuesIndex.md`, `blockers.md`, `CHANGELOG.md`, `issues/**/*.md`,
  and `docs/v2/evidence/remediation-20261114/**` **except** files ending `.sh .mjs .cjs .js .ts .py .tsv` under any `evidence/` checker directory and the
  checker's map (any change to a script, the checker or its map makes a new executable revision with stated requalification). Phase B: on failure,
  delete the local tag and branch (never pushed), correct, cut C′, recreate, rerun phase B in full; assert empty porcelain and tag^{commit} = final
  branch = integration branch; re-read origin `main` (unchanged) and prove `de640826` is an ancestor of C; rehearse the refspec against a throwaway local
  bare repository. Packet push command: `git push origin "remediation-final-20261115^{commit}:refs/heads/main"`; the tag annotation and the final
  report carry the same command with the full SHA; shell-neutral print `git rev-list -n 1 remediation-final-20261115`. The tag is not part of Approval A
  and is not pushed. Verification of C lives outside C; the packet says where and that its committed manifest figures are for the pre-final tip.
- **F-009 (ledger cells):** four cells, named base × `AFLDB_TEST_PER_FILE_DB`: snapshot × `all` (run-3 diff vocabulary gone/new/continuing),
  rebuild × `all`, rebuild × unset (shared), snapshot × unset (shared) — for the last three the B4 measurement of step 5b is the baseline. Mode `1` is
  not run. Shared runs record their file order. Pre-registered base-dependent changes: the three birth-date ids fail on the snapshot once pinned to the
  rebuild (363-B); surrogate-id fingerprints differ by base.
- **F-011 (rebuild):** reachability computed mechanically (import closure of each TypeScript stage entry ∩ `git diff --name-only 6d5388ea Q″`, plus the
  path prefixes) and committed. Expected to fire; then rebuild at Q″ from the run-3 rebuild workspace's input copies (RB-1 not read), and integration
  runs on the Q″ rebuild with recorded equivalence to the run-3 dump (83-table counts and every season's Brownlow `stat_availability` rows).
  `QUALIFICATION-4` carries a reuse table with the exact `git diff` for each reused check.
- **F-012 (363-G):** provisional-season contracts asserted on a season the test establishes inside an always-rolled-back transaction; the structural
  invariant (at most one in-progress season, and it is the latest) asserted separately on the real table; mutation reds on both bases; fingerprints
  over stable keys.
- **F-013 (item 4):** application result equals an independent raw-SQL oracle, and the oracle bounded to seasons ≤ 2025 equals 685,471 / 114 / 261 /
  219; acceptance: a synthetic later completed season on a scratch copy makes the B4 assertions fail and the new ones pass.
- **F-014 (RB-1):** owned by the orchestrator at step 7: `docs/v2/isolated-rebuild.md` (before Q″), `blockers.md`, `HANDOFF.md`, `RESIDUALS-4`; a
  proposed `CLAUDE.md` line goes in the packet only. Run-3 workspaces and the review workspace are read-only and excluded from cleanup (brief §1).
- **F-015/F-016/F-017/F-019:** clone database names permitted (brief §2); ports: baseline 55686, qual 55687, closure 55688, fix-loop 55689;
  `lint:gate --update` forbidden; "shared mode" ≠ shared `afldb_test`.
- **F-020/F-021/F-022:** closure phase A carries brief §3 as a checklist over `B4..Q″`; `RESIDUALS-4` records that the approved release-gates re-pins
  remain baseline-pinned; the packet states the item-4 interpretation.

## 4. Stop conditions

CRIT/HIGH from plan review → stop, return to the main session. HIGH/CRIT during execution → decision matrix (defer with a recorded
justification, or `afldb-reviewer`). Any action outside the authority above → stop and disclose. Context ceiling → State summary and handover.
