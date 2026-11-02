# D-316-12 admin wording: smallest UI release approval (2026-11-02)

**Status: PREPARED. NOT GRANTED. Nothing was pushed, built for production, deployed or restarted.** This is the smallest release that puts the corrected `/admin/current-season` wording on production. Mechanical steps are the already-proven route in [gap006-editor-protections-release-package.md](gap006-editor-protections-release-package.md) sections 4.5 to 7 (`deploy/release.mjs`, build heap cap, disk admission, rollback), with the substitutions below; this document does not copy them. Context: [issue316-closeout-and-seasonal-obligations-2026-11-02.md](issue316-closeout-and-seasonal-obligations-2026-11-02.md).

## 1. Candidate and outgoing state

| Item | Value |
|---|---|
| Candidate **R** | `6d41dd3a` (local `main`; **not pushed**; the later commits are documents and evidence only, see 3) |
| Outgoing serving release | `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` (`current`); `previous` = `fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy` |
| Production checkout | `924ff273` (C4b tool revision `N`), clean; it must be moved to R by the owner's push and pull (Git is user-operated; neither is authorised here) |
| Rollback target after the release | `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` (becomes `previous`) |

## 2. What changes, and what does not

Changes (display text only):
- `src/app/admin/current-season/page.tsx`: the page subtitle (AFL Tables retired, match ingestion runs from its timer while the switch is Enabled, Brownlow separately governed and off until a count window, no Start control).
- `src/app/admin/current-season/AflApiSettleUnitsPanel.tsx`: the intro paragraph and a header comment.
- `src/lib/acquisition/settle-status.ts` and `src/lib/acquisition/settle-trigger.ts`: the unconfigured-host status string, which no longer tells an operator to install the retired polkit rule.
- `src/app/admin/current-season/actions.ts`: a comment only.
- `tests/admin-current-season-settle.test.ts`: the wording test. `docs/deployment.md` and the evidence files are not part of the built app.

Does **not** change: any control, server action behaviour, permission or guard (`requireCapability('acquisition.currentSeason')` untouched), ingestion behaviour or source policy, schema or migrations, `.env`, systemd units, timers, `site_settings`, the Brownlow switch or gate. No migration, no database step, so the GAP-006 package's P6/P7 database checks are **not needed**.

## 3. Validation: actual results, and what is not qualified

Done (workstation, Windows): focused suites `tests/admin-current-season-settle.test.ts`, `tests/v2-admin-operations-ui.test.ts`, `tests/v2-module-boundaries.test.ts`, `tests/afl-api-ingestion-safety.test.ts`: **382/382 passed**; `tsc --noEmit` **exit 0**; static-render capture of the real units panel and the real subtitle text with the project CSS at 1280x800 and 390x844, no page-level horizontal overflow ([capture](evidence/d31612-wording-20261102/capture/)).

**Not done and therefore owed before a go (qualification gap, disclosed):**
- Q1. A production-mode build of R (`AFLDB_ENV=production`, `AFLDB_BUILD_TYPECHECK=off-host`, 1 worker, 3072 MB heap) and `tests/deploy-release.test.ts` on a Linux host. The DEV host refused SSH in this session and the rehearsal distro is quarantined, so no Linux build was run. The GAP-006 package recorded 3 min 16 s and 1.59 GB peak for the same route.
- Q2. The authenticated live page was **not** rendered: it needs the database and a Super Admin session. The capture above is a static render, so the live page is **`VISUAL: UNVERIFIED`** until step 4 below.

Qualified-by-construction: no schema, environment or unit change, and the touched files are leaf display strings plus one exported string constant already covered by the focused tests.

## 4. Smallest release sequence (owner-attended; nothing started)

1. Owner pushes R (or the chosen later docs-only head, after checking `git diff --stat 6d41dd3a..HEAD` lists only `docs/`, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`) and pulls it on the production checkout; Claude checks the checkout equals the pinned commit and is clean (read-only).
2. Q1 on a Linux host (owner or the DEV host), as GAP-006 package section 5.
3. `deploy/release.mjs` per the GAP-006 package section 6, then the owner's `sudo systemctl restart afldb`. **The restart must keep `AFLDB_SETTLE_TRIGGER=systemd` in `.env`** (it is there; if it were lost the panel would read "Unit status is not read on this host"). The restart does not touch the AFL API timer or its unit, and a running settle is a separate process. **Do not release before the first-night observation is recorded**, so a web restart cannot confound it; and avoid 05:00 to 05:20 AEDT.
4. **Visual acceptance (authenticated, headed browser, the owner signs in and enters every credential):** `/admin/current-season` at 1280x800 and 390x844. Checklist, each recorded as a captured image or `VISUAL: UNVERIFIED`, never prose: subtitle reads as in section 2; no "still runs on the host" or "neither starts nor stops"; "AFL API Current-Season Ingestion" shows its real state; "Brownlow Live Ingestion" shows Disabled and unchanged; both settle rows show a service state (not the unconfigured text); no Start control; no horizontal page overflow.
5. Post-release read-only checks as `arm`: serving release is R's, `/api/health` 200, the timer's next elapse unchanged, the switch value unchanged (a string `"true"` is still correct), Brownlow and AFL Tables timers disabled.

Stop and recovery: GAP-006 package section 7 (state-aware, `deploy/release.mjs`); the pointer flips back to `ea98a35f2061--vY0EFS0DdR-TiPkxTZz6` and the owner restarts. A UI text release has no data to reverse.

## 5. Approval wording (the owner writes it; nothing is granted until then)

```text
I, Stuart, approve the D-316-12 UI release of commit <R or head> to afldb-prod as the sequence in docs/v2/d31612-ui-release-approval-2026-11-02.md section 4, in the window <start> to <end> on <date>, after the first-night observation is recorded and not between 05:00 and 05:20 AEDT. I will push, pull, run every sudo command and the restart, and sign in for the visual check myself. Claude may, read-only as arm, verify the checkout, run the post-release checks and capture the visual evidence while I am signed in. No schema change, no timer or setting change, no Brownlow step.
```
