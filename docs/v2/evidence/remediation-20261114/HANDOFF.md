# Remediation run 2026-11-14 — handoff (interrupted by usage limit)

Integration branch `claude/remediation-20261114` (worktree `D:\dev\afldb-rem-20261114`, base `5035ed96`). Nothing pushed,
deployed or written to production/DEV. Read `AGENT-PROTOCOL.md`, `RUN-PLAN.md`, `PLAN-REVIEW.md` here first.

## Scope branches (local, each with an evidence README under `docs/v2/evidence/remediation-20261114/<scope>/`)
| Scope | Branch head | State |
|---|---|---|
| pins (358; 363 TST-5/6) | `70c1010a` | DONE; **integrated** |
| tests (363 TST-4/7/8/9) | `27b8f3a5` | DONE; **integrated** (integration HEAD `894c2356`) |
| draftguru (348) | `53dd7fe6` | DONE; prod discriminator verified read-only: 6,845 picks, 35 audited picks, 31 audited-only persons |
| nl (356; 360 SRCH-5/7; 359 SRCH-6) | `38261fd4` | DONE; PARSER_VERSION 68; corpus 0/12,000 changed; `/match-search` + qualifying-matches UI VISUAL: UNVERIFIED |
| answers (355; 360 FE-4) | `63876fa3` | DONE; Gridley identical before/after |
| routes (357; 359 FE-2/3; 360 FE-7; 364 sitemap) | `1207024c` | DONE; ISR residual ~50 KB per unknown path (owner O-1) |
| auth (362; 364 lint) | `5e7f5a9c` | DONE; prod `AFLDB_BETA_EPOCH=1` (read-only) so SEC-2 has no immediate admin effect |
| hostops (351; 352; 364 node_modules) | `234869e1` | DONE; `--attended` breaking CLI change |
| admin (353; 354) | `claude/rem-admin-20261114` | was RUNNING at interruption — check branch/report |
| perf (361) | `claude/rem-perf-20261114` | was RUNNING at interruption |
| rollover (350; 332 prep) | `claude/rem-rollover-20261114` | was RUNNING at interruption |

## Remaining work
1. Cherry-pick (`-x`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) in order: admin, draftguru,
   nl, answers, routes, perf, auth, rollover, hostops. Expected overlap: `tests/integration/release-gates.test.ts` (tests + nl).
2. Integration fixes: `deploy/release.mjs:1158` "next:" hint lacks `--attended`; admin `revalidatePath('/sitemap.xml')`
   callers (admin awards/coaches/draft `revalidate-paths.ts`, `draft/actions.ts:63`, `admin-awards.ts:904,927`) must also
   revalidate `/sitemap-index.xml` (verify against Next 16 docs; check pinned tests); `src/db/queries/data-edits.ts:265,270`
   lint `any` after admin merge; regenerate stage map (`npx tsx tools/v2/acquisition-stage-map.ts --write`) after rollover;
   re-measure `tools/dev/lint-baseline.json` on the integrated tree.
3. Integrated qualification on streamanator (heavy lock `/mnt/ssd/afldb-rem-20261114-heavy.lock`): unit gate, typecheck,
   lint gate, focused + broad integration, production build, Playwright for nl/answers/routes UI, PowerShell tests
   (base: 4/4 PASS on Windows PowerShell 5.1), `sync-dev-remote.test.sh` with `-ExportDir`; DraftGuru Stage A checks
   can use a read-only copy of DEV `data/sources/draftguru/annual-html-20260826`.
4. Independent review of the combined delta (afldb-reviewer), then ledger/index/blockers/CHANGELOG updates
   (local, qualified, not published) and the consolidated approval packet.
5. Record DEV state after (compare `DEV-STATE-BEFORE.txt`); stop/clean host workspaces `/mnt/ssd/afldb-rem-*-20261114`.

## Incidents to disclose
- The shared scratchpad caused collisions: routes executed the answers agent's `build.sh` (re-applied an idempotent
  `site_settings` INSERT in answers' own `_test` DB; duplicate build killed). pins overwrote a `setup.sh`. All agents
  report their results came from their own host copies.
- hostops left scratch files in `D:\tmp` (`backup-tests.ts`, `br-tail*.md`, `dep.new`, `newblock.md`, `grants-para.md`,
  `br-new.md`, `fix351.mjs`).
