# AFLDB-ISSUE-336 — index section as it stood before the 2026-11-11 rewrite (closure run 8)

Kept verbatim for history; the current section is in `IssuesIndex.md`.

### AFLDB-ISSUE-336 — Draft pages merge National, Rookie and other categories; 35 DraftGuru Pre-Draft rows missing

- **Severity / area:** Medium; public draft pages, player draft history, DraftGuru draft data.
- **State:** Open, opened 2026-11-05.
  - **Implementation** is on `origin/main` `ea9bddf8` (pushed 2026-11-06).
  - **Preview verification:** PASS on an isolated restore of DEV's own data (2026-11-06).
  - **Pinned DEV procedure** prepared 2026-11-06: candidate `8b024098` (local, not pushed) verified in isolation (browser 76/76, backup rehearsed to `BACKUP-VERIFIED`, rollback to `242fa276` proven on the 118 schema, timers checked offline).
  - **Procedure r2** (2026-11-06):
    - sudo-free `-RestartMethod respawn` (tooling `b82dfcea`, about 10 s outage, executed in isolation);
    - corrected 2027 nightly account, with production's Brownlow timer disabled;
    - DEV artifact preserved and restorable without rebuild;
    - next nightly recorded as pending observation.
  - **Published** `7fabc6e5` (A1, 2026-11-06).
  - **Deployed to DEV 2026-11-07:**
    - pin `8b024098` on branch `dev-v2-main` (owner-approved name, since `dev/v2-main` is blocked by DEV's `dev` branch);
    - ledger 118, build `AlYJjIargpO5esTkTX_zq`;
    - **immediate acceptance PASS**: authenticated browser 76/76, 4 workers, timers unchanged.
  - The 2026-11-08 nightly observation is **pending**.
  - D-336-1 accepted. The 35-row production insert (stage I336) is prepared and rehearsed; **not run**.
- **Key files:** `src/lib/draft-categories.ts`, `src/db/queries/draft.ts`, `src/app/draft/[year]/page.tsx`, `src/app/draft/page.tsx`, `src/components/DraftCategoryNav.tsx`, `src/app/players/[slug]/page.tsx`, `tools/v2/issue336-predraft-insert-production.ts`; runbook `issues/open/AFLDB-ISSUE-336.md`; evidence `docs/v2/evidence/issue336-draft-categories-20261105/` (DEV preview and DEV recommendation: `dev-preview-20261106/README.md`).
- **Key files (DEV deployment):** `issues/open/AFLDB-ISSUE-336-DEV-DEPLOYMENT.md`; evidence `docs/v2/evidence/issue336-draft-categories-20261105/dev-preview2-20261106/`, `dev-procedure-corrections-20261106/`, and the execution record `dev-deploy-20261106/README.md`.
- **Next action:**
  - read-only observation of the 2026-11-08 05:08 AEDT nightly (procedure §7.2);
  - production application release (it also carries ISSUE-337, resolved DEV-scoped 2026-11-07);
  - **review hold:** I336 run-name grammar fixed locally 2026-11-08 (`STAGE_RE` in `prod-stage.sh`), `tests/gap029-ops.test.ts` verified 76/76 on streamanator on 2026-11-08; next, revise the pinned revision before D-336-2 execution approval ([runbook section 6](issues/open/AFLDB-ISSUE-336.md));
  - D-336-3 (187 revised origin paths).
  - **2026-11-08, published and pinned:** the grammar fix is on `origin/main` at `c1c4b22e` (fast-forward from `7fabc6e5`, owner-approved). `gap029-ops` passed 76/76 at that exact merged revision, in a fresh clone from GitHub on streamanator. Runbook §3 now pins R′ = `c1c4b22e`, and the §6 review hold is cleared. Remaining: the nightly read, the production release, D-336-2 execution approval and D-336-3.
  - **2026-11-09, nightly observed (read-only):** the 2026-11-08 firing (batch 147) and the 2026-11-09 firing (batch 148) both matched §7.2 row 1. Each read the 2027 feed `CD_S2027014` (218 matches, COMPLETE), applied 0 inserts, 0 updates and 0 refused at the write, and ended `AFLDB_SETTLE_SUCCESS label=afl-api-2027-…`. No 2026 label has appeared since the deploy. The 20 listed apply failures predate the deploy (first detected 1–3 Oct). The observation is closed. Evidence: `docs/v2/evidence/open-issues-closure-20261108/i336-nightly/`.
  - **2026-11-09, release packet drafted:** `docs/v2/issue336-337-340-345-release-packet-2026-11-09.md`. Recommended R = R′ `c1c4b22e`, which also carries 340 and 345 and no migration. Linux release qualification and the full approval document are still to do. The production release, D-336-2 and D-336-3 each stay behind their own owner approval.
  - **2026-11-09, R′ selected and Linux-qualified:** the qualification ran on the approved production snapshot at 118 in an isolated cluster, now stopped.
    - Typecheck clean; release-delta unit 257/257; `admin-lifecycle` 50/50; `admin-draft` 42/0/5; production build and boot smoke PASS.
    - The full approval document is `docs/v2/issue336-337-340-345-release-approval-2026-11-09.md`, with H = R and a static check read from the package commit. **Superseded 2026-11-09 by r2** `docs/v2/issue336-337-340-345-release-approval-r2-2026-11-09.md` (same R, re-derived after `origin/main` moved; ISSUE-344 is on `main` and not in this release). Keep `main` frozen from the r2 PKG until D1 PASS.
    - **Next:** the owner's §9 approval statement, which names the package commit and the window. D-336-2 and D-336-3 stay separate.
  - **2026-11-08, prepared (not executed):** the revised-pin procedure (commit, re-run `gap029-ops` at R′, then update runbook §3), the exact §7.2 nightly read (live DEV, owner action), the release decision and the D-336-2 step list are all in packet P-336 of `issues/open/OPEN-ISSUES-CLOSURE-RUN-20261108.md`.

