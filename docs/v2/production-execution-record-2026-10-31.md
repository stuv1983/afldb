# V2 production execution record — D-V2-PROD-EXEC-1 (window 2026-10-31)

This is the window record (package §5 Stage 14, cutover step 11) for the one-session execution of the
[production execution package](production-execution-package-2026-10-30.md) from preparation commit
`94ca2d5dce870c7fa87d83e73649a3bdc5adef91`.

**Outcome.** V2 is deployed on production at the locked application revision
`9ed9c9dd3e84682c43e96c46e98974b245eb54ed`, with `BUILD_ID` `QNEHXAtU53TzUjj0Mb7mv`. It is served behind the
unchanged `beta.afldb.com` route, and the schema is at ledger 117.

One incident occurred. The first host build failed and destroyed the serving bundle (§4). The owner authorised one
controlled rebuild, and it succeeded.

Legacy writers stay retired. No new writer or provider integration was enabled. The admin-edit freeze was lifted at
**10:20:45 AEDT** (23:20:45Z).

Evidence (77 files, hash manifest `SHA256SUMS` `525c074a…`):
`docs/v2/evidence/production-execution-20261030/session-20261030T210000Z/`. It contains:
- the session logs;
- the owner-supplied outputs;
- the live-acceptance screenshots and results;
- under `session-scripts/`, the ad hoc wrapper scripts the session ran (pinned scripts are unchanged).

The logs were scanned for credentials and none are present. No password, MFA, cookie, token or browser storage was
captured.

## 1. Approval and window

| Item | Value |
|---|---|
| Approval | D-V2-PROD-EXEC-1, approved conditionally (owner, 2026-10-30) |
| Pinned bytes | `host-session.sh` `0fe897f8…`; `transfer-session.ps1` `0ee343ba…`; `PINNED.SHA256` `38e7fbb4…`; `src-9ed9c9dd.tar` `ab10691f…`. All were verified at Stage 0 and on every runner call |
| Window | T0 2026-10-31 08:00 AEDT (2026-10-30 21:00Z); hard end 12:45 AEDT. Schema start was due by 10:05, and A-REL ran at 08:44. Build start was due by 10:55, and the build started at about 08:50 |
| Choices | O-DRIFT b; O-ISO streamanator, new root `/home/arm/afldb-v2-prodexec-20261030T210000Z`, isolated loopback cluster only; O-FREEZE procedural admin-edit freeze; O-RB a; O-6/HC-1 declined (Caddy unchanged) |
| O-5 | Retain the backup sets until at least 30 days after a successful A-GO with no rollback (A-GO 2026-10-31 09:41 AEDT, so **not before 2026-11-30**); no automatic deletion. Second copy amended by the owner to `streamanator:/mnt/backup/backup(2026-10-31)/` (sdg1, ext4, UUID `4bc4fb8d…`, `arm:700`) |
| O-5 adapter | `second-copy.ps1` `768e46a3…`; controls `second-copy-controls.ps1` `5a6b21fc…` 43/43 (run 4; runs 1–3 retained); independent review recorded, open LOW N1 and N2 ([README](evidence/production-execution-20261030/o5-adapter/README.md)) |

## 2. Stages

| Stage | Result |
|---|---|
| 0 Go check (08:00) | PASS. Host identity: `afldb-prod`. The checkout was `ff100dc2` and the build `vcxM_SyDxFCP0sj9n9W1t`. Database OID 66668, system id `7674454702926115004`, ledger 110 (`789946fe…`). Writers and init PASS; isolated reference set hashes OK |
| 1 Writer retirement (owner sudo) | `afldb-settle-afltables.timer` disabled and inactive. `/etc/polkit-1/rules.d` was empty, so the rule was recorded **absent**, with no kept copy and no invented hash (owner ruling) |
| 2 Freeze | Procedural admin-edit freeze declared 08:17 AEDT; `retired` PASS; `afldb_app` sessions 2 |
| 3 Reviewed checkout | The first attempt stopped because the checkout was not clean: 61 untracked `settle-*.json` manifests. They were moved with `mv -n` (owner choice) to the release directory's `checkout-settle-manifests/` with `SHA256SUMS` `c3908bbc…` and verified. HEAD `9ed9c9dd` clean; `npm ci` 16 s; preflight pending only 111–117. `legacy-writers` PASS under owner sudo, because `arm` cannot list `rules.d` |
| 4 Frozen backup | `afldb_prod-20261031-082655.dump`, sha256 `599e32a1a0034b30f49c203ba6f306fe07f410e44f966a0554b00c21056731eb`, 29,781,936 bytes, 1,549 TOC entries; series 11 = 11; sealed manifest before `4060c929…` |
| 5 Proven restore | PASS 9/9 parity |
| 6 Off-host copies | Workstation copy: TRANSFER PASS. Second copy: SECONDCOPY PASS (`frozen`, sums `e4f67f71…`). PushPinned, `pinned` and PushIso: PASS |
| 7 Isolated rehearsal | PASS-PENDING-OWNER-GO in 611 s. D ATTRIBUTED_ONLY (settle bookkeeping and runtime telemetry, 0 stops); R REPRODUCED; **T 43/43 on an isolated clone** (no test ran on production); ledger 117 digest `647c3fb3…` |
| Gate D | Owner **GO**, 08:43 AEDT |
| 8 A-ROLLBACK | Routes named against the frozen dump (log `stage7-8-gateD-GO-and-rollback.txt`) |
| 9 A-REL | PASS 08:44: migrations 111–117, `privileges.sql` and both staging defaults applied; ledger 117 digest equal to the rehearsal's; read-back 12/12. The first runner call was refused at the argument check, before connecting (runner defect, log `hs-arel.log`); attempt 2 PASS |
| 10 Gate V2 | IDENTICAL (B vs production `P.permissions.txt` `8ebc118c…`, read under `transaction_read_only=on`) |
| 11 Gate V3 | Post-schema dump `afldb_prod-20261031-084435.dump` `3f5b5339cee312950c308b494ca98ff29a2f1620d9f60a4d062fbaf37b624730`. Pull PASS; SECONDCOPY PASS (`postschema`, sums `47e5313f…`); after PASS, V3 LEDGER_TIMING_ONLY. Three runner calls did not start because of a PowerShell variable clash; they are kept as `*.not-started-variable-clash.log` and were rerun |
| 12 A-GO | Attempt 1 failed and caused the incident in §4. Attempt 2, the owner-authorised controlled rebuild, passed and the owner started the service at 09:41:25 AEDT |
| 13 Acceptance | Accepted; see §3 |
| 14 Close | Backups re-verified, writers still retired, freeze lifted 10:20:45 AEDT; this record |

## 3. Stage 13 acceptance

| Check | Result |
|---|---|
| Health | 200 directly (`127.0.0.1:3100`) and through `beta.afldb.com`; `{"status":"ok","database":"ok"}` |
| Pages and assets (curl) | Every public page answered 200 at the beta gate. All 8 referenced CSS and JS assets returned 200 with correct content types. `/admin/operations` redirects to `/admin/login` when signed out |
| Retired intake | `POST /api/admin/email-intake` → 410 |
| Journal | 0 error lines since start |
| Gate M | Sealed scope identical (manifest after `ba1d5c64…`) |
| Scheduler loop | AFL Tables timer disabled and inactive; AFL API and email-intake units absent; no settle, migrate, dump or restore process; `writers` PASS (ledger 117) |
| Legacy writers (owner sudo) | PASS, exit 0 (owner-reported; `stage13-owner-legacy-writers.txt`) |
| Super Admin | The owner's screenshot of a live Operations centre Super Admin session is retained by the owner as Super Admin evidence only |
| **Admin live acceptance** | Headed Chromium (the repository's Playwright; the Playwright MCP is not granted in this repository). The owner signed in; visible role **Admin**, 2026-10-30T23:16:51Z. Run 2 scripted checks scored 10/12 and the owner **accepted** the run as recorded. Run 1 (harness `networkidle` timeout) is retained |
| Build identity (amended gate) | **PASS as amended**; header check **not** PASS (see below) |

Admin run 2 (`acceptance-admin-20261031-run2/`; screenshots 01–04 with URL, viewport and timestamp in
`results.json`):
- `/admin/operations` at 1440×900 renders **Operations centre** with 11 sections, including Data health, Sealed seasons,
  Acquisition runs, Curated awards, Inspection tools and Maintenance.
- The navigation holds all 13 Admin links and **none** of the 10 Super-Admin-only links.
- There is no page-wide overflow (scrollWidth 1425 ≤ 1440).
- All 11 static assets were good and the console had 0 errors.
- At 390×844 it renders with no overflow (375 ≤ 390).
- The home page opened from an internal link to `/` on the admin page, past the beta gate.
- The two public pages were reached by header links. `/players` showed real content (13,365 players) with 0 console
  errors. `/clubs` showed real content with 1 asset fetched and 0 errors. Neither page overflowed.

Two scripted checks failed because of my own assertions, not the application:
- **`ops-no-mutation-controls`:** the one form on the page is the Sign-out form. The only buttons are "Collapse the
  admin menu" and "Sign out".
- **`/players` assets:** in-app navigation reused JS and CSS that were already loaded, so 0 were fetched and 0 failed.

Follow-up observations, **not investigated** and with no cause claimed:
1. Next.js link-prefetch requests (`?_rsc=`) stayed pending for 16 s or more after load.
2. The `/players` list, sorted by games descending, shows two rows with no club and 0 games (Riley Onley, Fred
   Rodriguez) above the 442-game leader.

**Build identity, amended gate** (the owner accepted equivalent evidence for `BUILD_ID` `QNEHXAtU53TzUjj0Mb7mv`;
logs `stage12-identity-amended.log`, `stage12-identity-diff.log`, `stage13-build-proof.log`):
- **Checkout:** `9ed9c9dd…` with a clean porcelain.
- **Artifact:** every one of the 12,994 entries in the recorded recovery-build manifest (`b8a0c6d3…`) is present and
  byte-identical. The live tree additionally holds **28 files under `.next/server/app/matches/*`** that the running
  server rendered and cached on demand (newest 10:02:07), so a whole-tree manifest taken later (`c35ac032…`) differs by
  additions only. This is recorded as written; it is not a whole-tree hash equality.
- **Build manifest URL:** `/_next/static/QNEHXAtU53TzUjj0Mb7mv/_buildManifest.js` returns 200 directly and through
  `beta.afldb.com`. The old build's (`vcxM_SyDxFCP0sj9n9W1t`) returns 404 on both.
- **Running service:** MainPID 3170412 runs `deploy/server-cluster.mjs`. Both `next-server v16.3.1` workers run from
  `/home/arm/projects/afldb/.next/standalone` and started at 09:41:24, after the `BUILD_ID` file was written at 09:39:35.
  The only other standalone bundles on the host are set-aside copies from 2026-10-17 under `/home/arm/afldb-recovery/`,
  and nothing serves them.
- **`x-afldb-build` header:** absent, because request tracing is disabled (`AFLDB_TRACE_REQUESTS` off,
  `deploy/server-cluster.mjs:130`). It is **not** marked PASS, and `.env` was not changed.

## 4. Incident: the failed in-place build destroyed the serving bundle

**What happened.**
1. Stage 12 attempt 1 (`npm run build`, `AFLDB_ENV=production`) started at about 08:50 AEDT.
2. It ran out of JavaScript heap during the TypeScript phase. The host has 3.9 GB RAM, no swap and 2 CPUs, and the
   default heap is about 2 GB.
3. `next build` clears `.next`, including `.next/standalone`, before it builds. By the time it failed, the running
   service's static assets were gone.
4. From about 08:50, `beta.afldb.com` pages still answered, but every `/_next/static` CSS and JS asset returned 500,
   so the site was degraded (`stage12-after-build-failure-livecheck.log`, `stage12-livecheck2.log`).
5. Production data, the schema and the backups were unaffected.

**Invalidated assumption.** Package §6 row "Build fails (Stage 12)" and the Stage 8 routes said "the previous build
still serves (the build runs before the restart)". That is false for an in-place build in the serving checkout. The
same flaw affects the rollback route (rollback runbook §4.1: checkout, `npm ci`, `npm run build` in place, then
restart), and that route's gate R4 depends on the `x-afldb-build` header, which production does not emit.

**Recovery (owner decision, Option 1).**
- The owner stopped the service; it was inactive at the 09:33:52 pre-check.
- The failed attempt's logs were preserved on the host as `build.attempt1-oom.log` (`ccaecc41…`) and
  `build.attempt1-oom.exit` (`4355a46b…`).
- One controlled rebuild of the locked revision ran from 09:33:53 with `NODE_OPTIONS=--max-old-space-size=3072
  AFLDB_BUILD_WORKERS=1 AFLDB_ENV=production`, under a memory guard that would have killed the build below 200 MB
  available.
- It exited 0, with a minimum of 443 MB available. `BUILD_ID` was `QNEHXAtU53TzUjj0Mb7mv` for both `.next` and the
  standalone bundle.
- Static files 184/184; the 7 runtime files were byte-identical; no `.env*` in the bundle; artifact manifest
  `b8a0c6d3…` (12,994 files, 810,719,022 bytes); `build.attempt2.log` `4bc73395…`.
- The owner started the service at 09:41:25.
- `.env` was not edited, there is no swap, and no code, migration, revision or permission changed.

The site was degraded from about 08:50 and unavailable from the owner's stop until 09:41:25 AEDT.

The deployment defect is tracked separately as **AFLDB-ISSUE-329**.

## 5. Backups (re-verified at Stage 14, 10:1x AEDT)

| Location | Content | Stage 14 result |
|---|---|---|
| `afldb-prod:/home/arm/backups/afldb/release-v2-20261030T210000Z/` | Frozen and post-schema sets, restore test, moved checkout manifests, pinned files, build logs and manifests | `frozen`, `postschema`, `restore-test` and `checkout-settle-manifests` (61) SHA256SUMS all OK |
| `C:\Users\stuar\backups\afldb\release-v2-20261030T210000Z\` | Workstation copies of both sets, plus the isolated evidence | frozen 6/6, postschema 6/6, 0 mismatches |
| `streamanator:/mnt/backup/backup(2026-10-31)/release-v2-20261030T210000Z/{frozen,postschema}/` | O-5 second copy | `second-copy.ps1 -Mode Verify`: SECONDCOPY VERIFY PASS for both. Mount `/mnt/backup`, `/dev/sdg1`, ext4, UUID `4bc4fb8d…`, `arm:700`. Open LOW N1 applies: a later Verify cannot prove a disk read |
| `streamanator:/home/arm/afldb-v2-prodexec-20261030T210000Z` | Isolated rehearsal root | Retained. Its cluster is stopped and the databases are kept |

Retention: until at least **2026-11-30**, and only after a separate decision. Nothing is deleted automatically.

## 6. State at close (2026-10-31 10:2x AEDT)

- **Deployed:** application `9ed9c9dd3e84682c43e96c46e98974b245eb54ed`, `BUILD_ID` `QNEHXAtU53TzUjj0Mb7mv`, service
  `afldb` active since 09:41:25 with NRestarts 0. The schema is at ledger 117 with V2 privileges and defaults.
  `beta.afldb.com` goes through the unchanged Caddy route; no apex launch.
- **Writers:** AFL Tables timer disabled and inactive. AFL API, AFL API Brownlow and email-intake units are absent.
  `acquisition.afl_api_current_season_enabled` is unchanged. No settle, Brownlow, Coleman or curated operation ran.
- **Freeze:** lifted 10:20:45 AEDT.
- **Unchanged:** Caddy, `.env`, DNS, EXEC and frozen P/H. Nothing happened in `D:\dev\afldb`. ISSUE-327 stays parked.

## 7. Remaining work

1. **AFLDB-ISSUE-329:** make host builds non-destructive, as a separate decision. *(Update, 2026-10-31 after this
   window: resolved; the route is installed and production serves `61a95f7397da-JYIBkYn8ynPgYMn1e5nK-`. See
   `issues/closed/AFLDB-ISSUE-329.md` §10.)* It also covers the rollback route's
   in-place build and its `x-afldb-build` gate, and the host's build memory headroom.
2. **Acceptance observations** in §3: the pending link prefetches and the 0-game `/players` rows. *(Update, 2026-10-31
   after this window: the `/players` ordering is AFLDB-ISSUE-330, fixed locally; the prefetch observation was triaged:
   navigation is not impaired, no defect registered
   (`issues/closed/AFLDB-ISSUE-329-installation-20261031/evidence/live/observation-1-prefetch-triage.md`).)* Both are uninvestigated
   and need an owner decision on whether to register them.
3. **Legacy-writers check:** it needs owner sudo while `rules.d` is unreadable by `arm`. The polkit rule is absent.
4. **Moved settle manifests:** 61 files in the release directory's `checkout-settle-manifests/`, kept; their fate is
   the owner's.
5. **O-5 adapter:** LOW N1 and N2 are open.
6. **Backup retention review:** not before 2026-11-30. The isolated root on streamanator is retained.
7. **Still NO-GO:** the ISSUE-316 production AFL API cutover (writer activation), ISSUE-229 B2, any new writer or
   provider, and the apex launch. Source-checkout issues whose PROD installation this release may cover are **not**
   closed on the strength of this acceptance.
