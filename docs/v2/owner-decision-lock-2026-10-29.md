# D-V2-LOCK-1 — owner decisions, integration and artifact lock (approved 2026-10-29)

**Production: NO-GO.** This record carries the owner's D-V2-LOCK-1 approval of 2026-10-29, given against the
[consolidated decision package](release-decision-package-final-2026-10-29.md) §9 with the owner's own wording, and
what was executed under it. It authorises nothing beyond that approval.

## 1. The approval, as given

| Item | Owner's wording (condensed only where marked) |
|---|---|
| Scope | Work only in `D:\dev\afldbV2` |
| 1. D-V2-VISUAL-1 | "I ACCEPT ALL screens and states presented for acceptance in docs/v2/owner-visual-review-candidate-2026-10-29.md. This covers the corrected candidate and the synthetic UI evidence. It does not claim authentic provider reconciliation or production acceptance." Close V2-GAP-022, recount the register, update directly affected records |
| 2. Hostname (O-2, P1) | "V2 will serve at beta.afldb.com through the existing Caddy route. The apex launch remains separate. Do not change Caddy here." |
| 3. Ordering (O-3, RISK-27) | "Withdraw 'release after C5'. Stages A/B need not wait for 2027 evidence. A-AFLT remains required before the production schema/code installation, but its execution is not authorised here." |
| 4. Git and artifact (O-4, D-V2-PUSH-1) | Git inspection and fetch; selective local commits; push `v2/rebuild` to its verified existing origin; merge into `main` by a normal history-preserving merge, `--no-ff` where applicable; push the resulting `main` without force. Start from the accepted candidate `610bea5f` with its application tree from `7670441b`, including this visual-acceptance record. Preserve unrelated and staged work; no reset, stash or discard. Stop for an unexpected repository identity, a protected-branch refusal or a material conflict needing a new product decision |
| 5. Build | Lock and record the actual merge commit; one production-configured build by the established release-build procedure with installed tools; record platform, build identity and artifact hash. No substitute environment; no Linux claim from a Windows build. Reuse accepted validation; repeat checks only for actual merge changes or build failures |
| Not authorised | Deployment, DEV/PROD access or mutation, host changes, writer retirement, activation/deactivation, Brownlow operations, data rebuilds. EXEC, frozen P/H, source `D:\dev\afldb` and parked ISSUE-327 preserved |

## 2. D-V2-VISUAL-1 — recorded verdict (V2-GAP-022 closed)

```text
D-V2-VISUAL-1 — owner visual review of docs/v2/owner-visual-review-candidate-2026-10-29.md (corrected candidate,
application tree of 7670441b; build XtSgl4BOQZXC2G8qIWJdV).
ACCEPT: ALL screens and states presented for acceptance: every §1a, §1b and §1c item, every §2 row and every §3 item.
        Covers the corrected candidate and the synthetic UI evidence (§1b).
REJECT: none.
NOT REVIEWED / OUT OF SCOPE (owner's wording): authentic provider reconciliation and production acceptance.
        The other §4 item (a submitted "Revise approved winner" action) was not presented for acceptance and is not
        accepted; the revision panel itself (§3) is. Appendix D is diagnostic history, not for acceptance.
```

- **V2-GAP-022 is CLOSED** by this owner decision: every row and item presented for acceptance is accepted, and
  the remainder is out of scope by the owner's wording. Register recount: **38 total / 23 closed / 15 open**.
- Not claimed: authentic Brownlow provider reconciliation (gate 7; V2-GAP-016, 023's production step, 030, 031),
  production acceptance, or any rendering of production data. The images remain synthetic-fixture evidence on
  disposable isolated clones.

## 3. Hostname and ordering — recorded

- **O-2 / P1:** V2 serves at **`beta.afldb.com`** through the existing Caddy route to `127.0.0.1:3100`. No Caddy
  change was made here, and none is part of the lock. The apex launch is a later, separate decision. HC-1 (installing
  the repository Caddyfile) stays an independent, unapproved option (O-6).
- **O-3 / RISK-27:** "release after C5" is **withdrawn**. Stages A and B do not wait for 2027 evidence. **A-AFLT stays
  required before production schema/code installation** (the cutover preflight's `legacy-writers` check refuses the
  release until it is done); its execution is not authorised by D-V2-LOCK-1. The completed D-316-1 final acquisition
  (2026-10-21) means no AFL Tables acquisition precondition remains for it.

## 4. Git integration and lock (executed 2026-10-29/30)

| Item | Result |
|---|---|
| Repository identity | `D:\dev\afldbV2`, main worktree, branch `v2/rebuild` at `610bea5f` as expected; tracked tree clean; untracked `.codex/` present and preserved (not committed, not touched); no stash entries; staged work none |
| Remote | **None.** `git remote -v` and the remote configuration are empty, as recorded at creation ([baseline](baseline.md): `origin` removed immediately after the clone of `D:\dev\afldb`). There is no "verified existing origin" |
| Fetch and push | **Not performed.** Neither `v2/rebuild` nor `main` was pushed and nothing was fetched: no remote exists, and adding one was not authorised. This was not worked around. See §6, O-PUSH |
| Closure commit | `df50fb0a` on `v2/rebuild`: the visual acceptance, hostname and ordering records (§2–§3), documentation and tracking only |
| Merge | `git checkout main` then `git merge --no-ff v2/rebuild`. Local `main` was `ff100dc2`, the revision deployed on the production host (host findings H1), and an ancestor of `v2/rebuild` (0 commits behind, 191 integrated). No conflict |
| **Locked execution commit** | **`9ed9c9dd3e84682c43e96c46e98974b245eb54ed`** — parents `ff100dc2` and `df50fb0a`; tree `30b9f174ccc2a0cc69f80efbc8647e95ba6a22a4`, identical to `v2/rebuild` at `df50fb0a`. Local `main` points at it |
| Application change versus the accepted candidate | None. `git diff --name-only 7670441b 9ed9c9dd` lists 57 `docs/` paths, 4 `tools/v2/` paths, `CHANGELOG.md`, `IssuesIndex.md` and `issues.md`, and no application path. Accepted validation is reused; no check was repeated |
| Branch placement | This record (and its build evidence) is committed on `v2/rebuild` only, so local `main` stays **exactly** at the locked commit. The working tree was returned to `v2/rebuild` (same tree) |
| Lock condition | The lock assumes the remote `main` is still `ff100dc2`, so that pushing makes it a fast-forward to `9ed9c9dd`. If the remote `main` has moved, the merge must be redone, which produces a new commit and **re-opens the lock** and its build |

## 4a. D-V2-PUSH-ROUTE-1 — push executed (approved and executed 2026-10-30)

The owner approved O-PUSH option (a) and approved O-ARTIFACT as the release method, not as execution authority.
The O-ARTIFACT text is recorded in the [production execution package](production-execution-package-2026-10-30.md) §0.

| Item | Result |
|---|---|
| Source URL | `git -C D:\dev\afldb config --get remote.origin.url` was read, with no write to the source checkout: `https://github.com/stuv1983/afldb.git`. No credential is embedded |
| Identity | V2 and the source repository share root commit `e31dc07be82b9801e9ea96d3c8d4011c3735f876`. `ff100dc2` exists in both and is the first parent of `9ed9c9dd` |
| Remote and fetch | `git remote add origin <that URL>`; `git fetch origin`. `git ls-remote --heads origin main v2/rebuild`: `main` = `ff100dc2b8da8523f550ef45a9eaa3ef96d9d840`, no `v2/rebuild` |
| Push | `ff100dc2` is an ancestor of `9ed9c9dd`, so this is a fast-forward. `git push --atomic origin refs/heads/v2/rebuild:refs/heads/v2/rebuild refs/heads/main:refs/heads/main` exited 0: `ff100dc2..9ed9c9dd main -> main` and `[new branch] v2/rebuild -> v2/rebuild`. No force, no protection refusal, no merge redo |
| **Verified remote refs** | `refs/heads/main` = **`9ed9c9dd3e84682c43e96c46e98974b245eb54ed`** (= local `main`, the locked commit). `refs/heads/v2/rebuild` = **`d3286d92c5f4b8701aba20eb1c6b694c42261620`** (= local `v2/rebuild` at push time) |
| Lock | **Holds**: the remote `main` was `ff100dc2`, as §4's lock condition requires. The records commit that follows this push is on local `v2/rebuild` only, and is not pushed |
| Preserved | The source checkout `D:\dev\afldb` was not written: its local `main` is still `6ffb893b` with its 25 unpushed source-only commits, and its `origin/main` tracking ref is unfetched at `ff100dc2`. Untracked `.codex/` in V2 is untouched. ISSUE-327 stays parked; EXEC and frozen P/H are unchanged |

## 5. Production-configured build (executed 2026-10-29 13:06–13:08 UTC)

| Item | Value |
|---|---|
| Procedure | The established local release build, unchanged: `node node_modules/tsx/dist/cli.mjs tools/v2/isolated-pg.ts run afldb_v2_visual2_test -- node tools/v2/local-release.mjs build v2` = `next build --webpack` then `tools/build/prepare-standalone.mjs`, `NEXT_TELEMETRY_DISABLED=1`, `AFLDB_BUILD_WORKERS=4`, installed `node_modules` only (no download). Same disposable database as the accepted verification build; isolated cluster `afldb_v2_isolated` started on 127.0.0.1:55433 for the build and stopped after it. One build only |
| Source | `HEAD` = `9ed9c9dd…` on `main` at build start; tracked tree clean before and after (`git status`: only the untracked `.codex/`) |
| **Platform** | **Windows 11 Enterprise 10.0.26300 (win32 x64)**, Node v22.21.0, Next.js 16.3.1 (webpack). **Not Linux; no Linux verification is implied** |
| Result | Exit 0. Compiled successfully (one webpack warning inside Next.js itself: `process.cwd` in `dynamic-rendering.js` "not supported in the Edge Runtime"); **1516/1516** static pages; `prepare-standalone` confirmed no `.env*` in the bundle and copied and verified the 7 runtime reference files |
| **Build identity** | `BUILD_ID` **`6z0tEoDM6-V-s4wbIH5RE`** (`.next/BUILD_ID` = `.next/standalone/.next/BUILD_ID`) |
| **Artifact hash** | `.next/standalone`: 12,984 files, 0 symlinks, 788,604,381 bytes. Manifest (sorted `sha256  path` per file) SHA-256 **`68f1d1848e84b154fe2613bfd7179c91b65abd1fa3465ca8fe71e1ca479d4ec6`** ([manifest](evidence/lock-build-20261029/standalone-manifest.sha256), [method](evidence/lock-build-20261029/artifact-manifest.mjs), [log](evidence/lock-build-20261029/build-log.txt)). Spot hashes: `server.js` `a3fd16c6b94e717d2823e5f4fc22d62c166dfd1f45b05020e122da5906cf461f`; `routes-manifest.json` `27da27d2ec741d16ac7a00c9f547d7ef70c504bf8fe805ebee9dd973457f9437`; `prerender-manifest.json` `dc74a589e873c6af7c203a46c11a7ba1e25adeb9eccab632c3e523e90c1afabe` |
| Previous build | The accepted verification build `XtSgl4BOQZXC2G8qIWJdV` was moved, not deleted, to the ignored `.local-release/verification-build-XtSgl4BOQZXC2G8qIWJdV/` before this build |

**What this build is not.** Four facts limit it, and none is waived:

1. **Transport-security flag.** The established local procedure does not set `AFLDB_ENV`, so the build logged
   "AFLDB_ENV is not production; building with development headers": no HSTS and the development CSP, which are
   fixed at build time (`next.config.ts:4–14`). It is a Next.js production-mode build, not one with the AFLDB
   production security headers.
2. **Data.** Its 1,516 prerendered pages come from the synthetic isolated clone, not production data.
3. **Platform.** Windows-native binaries are traced into `standalone/node_modules`; it cannot be installed on Linux.
4. **Reproducibility.** `BUILD_ID` is random per build (no `generateBuildId`), so no later build can reproduce it.

It therefore records the identity of the locked commit under the established procedure. **It is not the
installation artifact.** Production installs by building on the host (cutover runbook step 7; `deployment.md` §3), so
the host build of `9ed9c9dd` needs its own recorded identity (§6, O-ARTIFACT).

## 6. Remaining production approval package

**Production: NO-GO.** Nothing below is approved. Each item is one owner message, in this order. Wording follows the
[release choices](owner-decision-release-choices-2026-10-29.md) (choice numbers) and the
[host change list](host-prerequisites-findings-2026-10-29.md) §4. Unchanged and not waived: privileges 42/43 until
A-REL, strict preservation and parity FAIL, staged Brownlow comparator INCOMPLETE, V2-GAP-029 open, authentic
provider reconciliation separate (gate 7).

> **Update 2026-10-30:** O-PUSH was approved as option (a) and executed (§4a). O-ARTIFACT was approved as option (a),
> as the release method only. O-5 to O-7 and the approvals below are now consolidated, with four new choices
> (O-DRIFT, O-ISO, O-FREEZE, O-RB), into one session package:
> [production execution package](production-execution-package-2026-10-30.md). The text below is kept as prepared.

### 6.1 Owner choices still open, named concretely

| # | Choice | Options | Recommendation | Needed before |
|---|---|---|---|---|
| **O-PUSH** *(new)* | How the locked commit reaches the remote the production host pulls from. V2 has no remote, so D-V2-LOCK-1 item 4's push could not run | (a) Add the source repository's existing `origin` URL to V2 as `origin`; fetch; push only if the remote `main` is `ff100dc2`; push `v2/rebuild` and `main` (`9ed9c9dd`) without force. (b) Push V2 into `D:\dev\afldb` and push from there; this writes to the source checkout the owner asked to preserve | **(a)**, with a stop if the remote `main` is not `ff100dc2` (the lock then re-opens, §4) | A-GO; any host checkout of `9ed9c9dd` |
| **O-ARTIFACT** *(new)* | What "artifact identity re-confirmed" means at A-GO | (a) The host checks out exactly `9ed9c9dd` (`git rev-parse HEAD` must equal it, not just "latest `main`"), runs `npm ci` and `npm run build` with `AFLDB_ENV=production` from the host `.env` (the log must say "AFLDB_ENV=production detected"), and records its own `BUILD_ID` and standalone manifest hash with the same method before restart. (b) A Linux build made elsewhere and copied; this needs a new transfer and verification procedure that does not exist | **(a)**: it is the documented install route. The Windows `68f1d184…` is the lock record, never compared byte-for-byte with a Linux build | A-GO |
| O-5 | Off-host copy (P3): retention period and any second destination | HC-4 workstation pull is prepared; period and second copy are open | State a period (for example: until 30 days after A-GO with no rollback) and whether a second copy is needed | the window |
| O-6 | HC-1: install the repository Caddyfile | Take (fixes F-1; a revert cannot withdraw HSTS already sent for `beta`) or decline (F-1 stays a known residual) | Owner's call; independent of the lock (no tracked file changes) | A-GO |
| O-7 | The window | Date and start time (AEDT); freeze scope: AFL Tables timer pause, email-intake timer, admin edits | Name it in the window approval | the window |

### 6.2 The approvals, in order (copy, fill the brackets, strike nothing else)

```text
D-V2-PUSH-ROUTE-1 — O-PUSH [option a]. In D:\dev\afldbV2 only: read the origin URL of D:\dev\afldb (read-only), add it
as origin in V2, fetch. If origin/main is exactly ff100dc2, push v2/rebuild and main (9ed9c9dd) without force and
record the pushed refs. Otherwise stop: no merge redo, no force; report the remote state. No other repository write.
```

```text
A-AFLT (choice 7, with HC-2) — on the production host: read the AFL Tables polkit rule (name, SHA-256, compare with
deploy/afldb-settle-afltables-trigger.rules 3164e0d9…), keep a root-owned copy, then disable
afldb-settle-afltables.timer and retire that exact rule with the cutover procedure. Read back timer, process and
enabled state; run cutover-preflight legacy-writers from the reviewed artifact and require PASS. Recovery: restore the
kept rule copy with original owner and mode and re-verify its hash. No new writer started.
```

```text
Window and A-BACKUP (choice 8, with HC-3, HC-4, HC-5) — window [date, start time AEDT, duration]; freeze [writers:
email-intake timer and any remaining settle timer; admin edits]. Fresh read-only preflight; then
backup.sh --dir ~/backups/afldb/release-v2-<STAMP> --keep 999 (existing series count unchanged, pg_restore --list
passes, SHA-256 recorded); pull the dump to the workstation with the transfer.ps1 pattern, SHA-256 equal on both
ends, retained [O-5 period / destination]; restore-test.sh into afldb_restore_test, PASS; compare the frozen
baseline with a4641ca0…. Any drift stops the release. No schema, privilege or code change.
```

```text
A-ROLLBACK (choice 9) — recovery routes named against backup [path, SHA-256]: artifact revert to ff100dc2 with the
forward schema kept; no destructive 116 rollback; no NOT NULL on 117 without proven zero NULLs; any reversal of
populated 111–114 only with row and sequence exports; a host restore only from that frozen verified archive, with
full auth and audit recovery and a writer freeze.
```

```text
A-REL (choice 10) — target afldb_prod on the production host, revision 9ed9c9dd. Re-verify identity; require ledger
exactly 110 with zero drift; run exactly 111–117 with the reviewed runner, verifying each (116 and 117 approved for
this target and revision); apply privileges.sql; execute D-V2-STAGING-IMPORT-DEFAULT-1 and
D-V2-STAGING-APP-DEFAULT-1; read back ACLs, default ACLs, memberships and role attributes; first comparison of
production effective permissions and ownership. Privileges integration must reach 43/43 or the release stops before
A-GO. No production test write, ledger or checksum edit, or replay of an assumed baseline.
```

```text
A-GO (choice 11) — [HC-1: take / decline]. On the production host: check out exactly 9ed9c9dd (HEAD must equal it);
npm ci; npm run build with AFLDB_ENV=production; record BUILD_ID and the standalone manifest SHA-256 (O-ARTIFACT a);
restart behind the unchanged beta.afldb.com route; verify read-only: revision, /api/health through Caddy and
directly (HTTP 200, database ok), x-afldb-build equals BUILD_ID, sessions and key pages. Every new canonical writer
and provider integration stays disabled.
```

After A-GO, one approval each and unchanged: C3 inert AFL API units (12); C4/C4b/C5 and ISSUE-229 B2, blocked until
authentic 2027 data (13); Brownlow operations, 2026 excluded (14). The apex launch is a separate decision.
