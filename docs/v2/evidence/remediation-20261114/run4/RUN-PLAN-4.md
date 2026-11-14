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
| 6 | `evidence`: fixed manifest checker (full-relative-path resolution, every manifest incl. run 2, explicit host map), self-test red/green, original failure preserved | worker | — | 0 (starts when a slot frees; ≤ 5 in flight) | item 1 |
| 7 | integrate (`cherry-pick -x`) into `claude/remediation-20261114`; conflicts resolved by the orchestrator; commit qualification scripts → **Q″** (last executable commit) | orchestrator | — | 1–6 | — |
| 8 | `qual`: fresh host workspace at Q″ — typecheck, lint ratchet, unit (all fixtures), shell harnesses, build; rebuild-reachability decision (rebuild again only if a changed file is reachable from the rebuild plan); integration per-file **and** shared on the accepted rebuild, per-file **and** shared on the snapshot, dedicated clones (two Brownlow clone suites, OD-5 rebuild-named clone, Coleman schema-only base); raw verdicts | worker | 55687 | 7 | items 5, 7 |
| 9 | failure ledger `FAILURE-LEDGER-4.{tsv,md}` (every failing id per mode/base, one class each, gone/new/continuing vs run 3); fix-loop for any demonstrated in-scope defect (→ Q‴, requalify only what changed, reuse justified) | orchestrator (+ worker if a fix) | 55687 | 8 | item 6 |
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

## 4. Stop conditions

CRIT/HIGH from plan review → stop, return to the main session. HIGH/CRIT during execution → decision matrix (defer with a recorded
justification, or `afldb-reviewer`). Any action outside the authority above → stop and disclose. Context ceiling → State summary and handover.
