# Owner decisions of 22 November 2026 (round 2) and backlog run c

**Source.** Owner decisions 1-8 of 2026-11-22, relayed to `afldb-orchestrator` by the main session; recorded here verbatim in
substance. Run c worked in `D:/dev/afldb-backlog-20261122`, branch `claude/backlog-20261122` from `origin/main` = `731a5025`. Local
commits only, no push, no trailers. **No production contact by this run; no `wsl`; nothing deleted outside this run's own new
streamanator workspaces.** Plan and reviewer amendments F-001..F-008: `documentation/plans/PLAN-backlog-20261122c.md` (plan review
before step 1; no CRIT/HIGH).

## 1. Push (decision 1): DONE by the main session

`7d92042f..731a5025` fast-forwarded to `origin/main` (verified by the main session; re-read here: `origin/main` = `731a5025…b2b7`).

## 2. A1 (decision 2): APPROVED, Tue 24 Nov 2026 10:00-10:30 AEDT

Release the exact DEV-verified candidate `7d92042f`. Before promotion, verify the built revision and the executable-tree
equivalence to `cf158d60`; if the build tooling cannot pin `7d92042f`, stop before promotion and report. The owner wants
secret-safe steps to configure the two production revalidation variables; **the owner performs the production restart.** Verify
release health, the season revalidation 2/2 workers and raw-head checks on both workers; documented application rollback if a
trigger is met. Release id `7d92042fd110-<BUILD_ID>`. Runbook: `ATTENDED-PLAN-A1-A2-20261124.md` §2-§3.

**Main-session findings folded in, each re-derived by this run:**

| | Finding | Re-derivation (22 Nov, local Git, read-only) |
|---|---|---|
| (a) | `cf158d60..7d92042f` touches only records paths | 59 paths, 0 outside `docs/`, `documentation/`, `issues/`, root `*.md`; executable trees equal (`ls-tree -r` minus records sha256 `a18ccac4…e789` for both) |
| (b) | `release.mjs build` pins by `git archive <revision>` and checks only `git cat-file -e <rev>^{commit}` | **Confirmed** (`deploy/release.mjs:960-964`, `:984-1003`, `:1005-1074`; no `HEAD`/porcelain read anywhere in the file; the plan reviewer confirmed independently). `RC-371-372.md` §1 was wrong; corrected by its dated revision note |
| (c) | `origin/main` is `731a5025`, so "ff to origin/main" would land on the wrong commit | P2 is now `git fetch` + `git merge --ff-only 7d92042fd11010eaa20966e2f49ae7a93e286568`; STOP re-derived for exactly `c8d4202a..7d92042f`: 153 paths raw sha256 `b93a294a…91e3`, 13 non-records paths sha256 `fe9285f6…7dee` (`a1a2-20261124/a1-p2-ff.sh`). The ff is still needed: acceptance runs `revalidate-season.ts` (changed in that range) and `post-install-check.sh` from the checkout |
| (d) | `7d92042f..731a5025` is not in the release | non-records paths: `tools/rebuild/draftguru/{draftguru-contract.json,import_draftguru.py,parse_draft_snapshot.py}`, `legacy/offline/tools/rebuild/draftguru/acquire_draft.py`, `tools/v2/rebuild-tier-p.ts`, 3 tests: offline/rebuild tooling only |

Also verified: every file A2 installs or executes from the checkout is byte-equal at `c8d4202a` and `7d92042f` (16 files, full
sha256 in `a2-p0-entry.sh`), so A1's fast-forward does not change what the R2 forced command runs or what R1/R3/R4 install.

## 3. A2 (decision 3): APPROVED, same day 10:30-12:00 AEDT, after A1 passes

R1 host policy; R2 forced-command key **and the first manual run only**; R3 scheduled backups and the off-host pull; R4 combined
Caddy install. Packet preconditions apply; owner `sudo` steps one at a time; for R3 verify the disposable restore target before the
restore test and verify the first off-host copy; if time runs short, stop at a safe boundary and list the outstanding steps.

- **Email delivery (ISSUE-332) is recorded separately from the R2 installation:** delivery through the owner's email was verified on
  22 Nov (owner confirmed receipt of the deliberate test alarm; `731a5025`). It is not an R2 step.
- **The hourly R2 cron and the daily R3 pull cron are NOT part of A2.** Packet R2's Target and command 3 do list the hourly job, and
  packet R3's Target lists "a daily job", but neither approval text names a cron, the owner approved "first manual run only" for R2,
  and both kit lines carried a blank alarm command. Both are separate, still-unapproved owner steps (runbook §4.6, one question).
  Consequence: until approved, no hourly visibility and no daily off-host copy (R3's "within 25 h" acceptance and ISSUE-352's closure
  stay open; R6/R7 prerequisites rest on a manual second pull).
- **Correction (MED, found this run):** `kits/KITS-20261122.md` R2 gave the alarm command as `/bin/sh /home/arm/afldb-ops/alarm-email.sh`.
  The sender is a bash script that uses process substitution, which `sh` (dash) cannot run; the delivery test used the executable path.
  Runbook and kit now say `AFLDB_ALARM_CMD=/home/arm/afldb-ops/alarm-email.sh`.

## 4. ISSUE-348 (decision 4)

- **F-1 ACCEPTED (resolved decision):** for this acquisition keep the version-specific pin `reviewed_acquisitions["annual-html-20261122"]`
  (6,845 picks / 5,088 persons) and preserve the August default rebuild (6,810 / 5,057). R-2 (moving the default rebuild label) is
  thereby decided as "not moved".
- **F-2:** decision-ready review `issue348-acquisition/F2-DECISION-REVIEW.md` (worker W-348, read-only on the preserved rehearsal rows;
  the stopped rehearsal cluster was not started, reviewer F-001). No identity linkage changes in either direction (link digests byte-equal
  before/after in both rehearsals; linked picks 5,215, linked persons 3,564; `dg_person_id` is a per-load rank on which nothing links).
  All eight height changes are unlinked 1996-1999 rookie picks and feed no `players` column. Final write set and plan digest: the
  review's §4-§5; **the plan is unchanged and is not re-sealed**: manifest `26ca190b…a27c`, effect `ff8ef1b8…6452`, reconciliation
  `cf49f6a5…de4e`, transfer tar `478d4f80…7afb`, SHA256SUMS `632aefe9…1326`, runner `61f44acb…9c0d`, digest SQL `ae742dcc…e1dd0`.
- **The production 348 load stays outside A2:** separate sitting, separate owner approval of the F-2 groups and the digests.

## 5. R5, R6, R7 (decision 5)

- **R5: RETAIN** the pre-fix Caddy logs pending a retention decision. Nothing is disposed of; R4 does not truncate them.
- **R6 (attended reboot) and R7 (drop the five stale databases):** to be dated after the owner returns from leave. **The return date
  is not known to this run and is not assumed.** Date-relative proposal (please give the return date, or name an operator):
  - **R6:** the first Thursday 10:00 AEDT alternate slot (procedure 02 §7) on or after the owner's return, provided R3's first nightly
    and an off-host pull are verified, R1 is installed, console access has been confirmed (login prompt seen) and a fallback chosen.
  - **R7:** the first Tuesday slot after R6 that is at least 8 days after A2 (after the first Wednesday verification and an off-host copy).
    The five databases are retained meanwhile (`afldb_prod_auth_recovery`, `afldb_prod_candidate_20260926-213225`,
    `afldb_prod_candidate_20260927-142540`, `afldb_prod_pre_rebuild_20260907-234124`, `afldb_prod_pre_rebuild_20260928-101642`).
- **An earlier reboot by another operator** is possible only if the owner names one. This run does not assume who. They would need:
  DigitalOcean control-panel access to the droplet (Console, and snapshot rights if fallback (a) is used); `arm`'s SSH key (sshd
  admits `arm` only, key authentication only) and `arm`'s sudo password; the exact steps (packet R6 as amended by F-02/F-06, `kits/KITS-20261122.md`
  §R1/R6, procedure 03 §3-§6); the prerequisites checked and recorded (console login prompt seen, fallback chosen, verified off-host
  backup, settle status recorded before the reboot, `release.mjs status` clean, daytime outside the avoided times); authority to
  run `release.mjs rollback --attended` and to call the owner if the host does not return within 10 minutes.

### 5.1 Consequence of deferring the pending kernel reboot (from the records only)

- **What is pending.** Production runs kernel `6.8.0-137` since 2026-08-16 (about 100 days on 24 Nov). `reboot-required` (dated
  2026-11-14) names `linux-image-6.8.0-138/139/142/146/147/149`, `linux-base` and `libc6`; only 137 and 149 are installed; the reboot
  moves to `6.8.0-149` (`R0-SITTING-20261122.md`; procedure 03 §1).
- **Named CVEs: none.** No repository record names a CVE for these kernels (searched `docs/`, `issues/` and `issues.md`
  for `CVE-`: the only mentions are a streamanator zlib update, `issues.md:52697`, and an email-parsing test shape; none concerns
  the production kernel). Procedure 03 §2 states the exposure only as "ninety-plus days of kernel patches unapplied". The specific
  vulnerabilities are therefore **unknown to the records**, not "none". A read-only way to list them, for the owner to approve on a
  future probe: `zcat /usr/share/doc/linux-image-6.8.0-149-generic/changelog.Debian.gz 2>/dev/null | grep -o 'CVE-[0-9]*-[0-9]*' | sort -u | wc -l`
  (if the changelog ships with the package; otherwise `apt changelog`, which needs network).
- **Live patching: unknown.** No record states whether Canonical Livepatch / Ubuntu Pro is enabled; nothing indicates it is. Read-only
  check proposed for a future probe: `pro status --format json 2>/dev/null | head -c 2000; canonical-livepatch status 2>&1 | head -5`.
  Until known, assume running kernel 137 receives **no** fixes.
- **Forced unattended reboot.** The host policy does not reboot automatically: `unattended-upgrades` has no `Automatic-Reboot`
  (procedure 02 §1), and R1 does not change that. The risk is an **unplanned** reboot (provider host maintenance or migration, a
  crash, a power event): the droplet would boot `6.8.0-149` unattended (GRUB `hidden`/0/0, default = newest), with no reachable menu
  to fall back to 137 and console access unverified; `afldb` starts after PostgreSQL and the settle timer's `Persistent=yes` fires a
  catch-up run. Kernel 149 is a routine same-series update, so the likely outcome is a normal boot, but the failure case would meet
  no attended fallback and no verified snapshot. The longer the deferral, the longer that exposure lasts, and the more kernel and
  library updates accumulate into one eventual boot.
- **Interplay with R1.** Before R1, any apt run that upgrades a library (libc6 on 2026-11-14 06:35) makes `needrestart` restart
  `afldb` and PostgreSQL automatically: an unannounced outage, and after a promote it would activate a switched release unattended.
  After R1, those restarts and PostgreSQL server upgrades are held for the owner; security updates still install, kernels still wait.
  R1 therefore **removes surprise restarts but lengthens the time old libraries stay mapped** in `afldb` and PostgreSQL, so the
  weekly owned window and the attended reboot become the only way those updates take effect. A1's restart refreshes `afldb`'s
  libraries once; PostgreSQL keeps its old mappings until its own attended restart or the reboot.
- **How R1 changes the reboot risk.** It does not reduce the kernel exposure. It makes the eventual reboot cleaner (nothing restarts
  in between) and makes `host-gate` report the pending reboot at every promote. Procedure 03 §7's suggested rule is "reboot within 30
  days of the first pending kernel unless the owner records why not"; the first pending kernel predates 2026-11-14, so that rule is
  already exceeded.
- **What would justify an earlier handover:** if the owner's absence is long (weeks), or if the owner learns that a 6.8.0-149 fix
  covers an actively exploited kernel issue relevant to a public web host. Both inputs are the owner's; neither is in the records.

## 6. R8 (decision 6): planning date Tue 23 Feb 2027 11:00 AEDT

A fresh production plan is drafted for separate approval: `R8-OPENING-PLAN-2027-DRAFT.md`. Nothing is executed.

## 7. ISSUE-373 (decision 7): investigated

`issue373-gc-investigation/README.md` (worker W-373). The 118 are 118 **findings** over 113 cells: 78 `unsupported` (equal,
cell for cell, to `data/reference/gridley-approved-deferrals.json`) and 40 `criterion disagreement`, all `brother x …`: Jarryd Lyons
32 (D-GAP029-21, D-GAP029-D3), Jimmy Webster 8 (D-GAP029-D4W). Every one is already owner-approved or retained under the G-b bounded
policy (0 unapproved). N7 (G-c) asserts the raw strict-parity list is empty with no approved subtraction
(`tests/integration/gridley-corpus.test.ts:832-834`), and `tests/gridley-compat.test.ts` pins `strictCorpusParity.passed === false`
with these exact counts, so G-c fails by construction. **No code-only fix exists; nothing was implemented.** Options for the owner:
(1) record the accepted residual and resolve ISSUE-373 (documentation only), or (2) N7 adopts the approved subtraction (a gate change);
(3) model the missing data and (4) widen the brother definition reverse ISSUE-118/D-GAP029 decisions and are not recommended.

## 8. Workspaces on streamanator after the decisions (read-only inventory; nothing deleted; sizes from RUN-20261122b §6 unless new)

| Path (`/mnt/ssd/`) | Size | Production data | Needed until |
|---|---|---|---|
| `afldb-post7r3-20261121T155248Z` (R0 dump) | 29M | yes | R3's first verified pull **and** the 348 load (its rehearsal base) |
| `afldb-offhost-prod` | 0 | becomes yes at A2 R3 | permanent (the R3 destination) |
| `/home/arm/afldb-ops`, `~/.ssh/afldb_settle_status`, `~/.ssh/afldb_backup_pull` | — | credentials once installed | permanent (R2/R3) |
| `afldb-backlog-20261122b-348` | 6.0G | yes (R0 restores, `ev-private/`) | the 348 load (holds `seal/i348-transfer.tar`) |
| `afldb-backlog-20261122-dg` | 1.2G | yes | the 348 load (original raw pages) |
| `afldb-backlog-20261122-dev` | 4.0G | DEV dumps | **unnecessary after A1 is accepted** (DEV 371/372 check closed 22 Nov; its rollback material) |
| `afldb-backlog-20261122-q` | 11.3G | no | **unnecessary after A1 is accepted** (372 qualification; evidence tracked) |
| `afldb-i371-20261121` | 5.8G | no | **unnecessary after A1 is accepted** (concurrent agent's 371 workspace) |
| `afldb-b1a0-20261118T021817Z` (S6) | 29M | yes | R3's first verified pull |
| `afldb-r7r3-20261121` (S1/S2), `afldb-bv2026-20261121` (S3), `afldb-close-20261121` (S4), `afldb-rel7r2-20261121` (S5), `afldb-b1a0-verify-*` (S7/S8), `afldb-rem6r-b1a-20261116` (S9), `afldb-rel7-20261119` (S10), `afldb-i363-20261121`, `afldb-backlog-20261122b-363`, `afldb-backlog-20261122b-332` | as RUN-b §6 | as RUN-b §6 | already not needed (RUN-b §6); unchanged by A1 |
| `afldb-enh-20261116` | 4.8G | no | while the enhancement is parked |
| `afldb-backlog-20261122c-373` (new, run c) | 299K | no (report extracts, aggregates) | not needed (evidence tracked) |
| `afldb-backlog-20261122c-348f` (new, run c) | 0 (empty) | no | not needed |
| `afldb-backlog-20261122c-a2test` (new, run c) | 18K | no (test scripts, a symlink to the non-production rebuild dump, a scratch key file with public keys only) | not needed |

A2 R3 step 12 creates `afldb-a2-firstcopy-<STAMP>` (production data) and deletes it after the record. `/mnt/ssd`: 420G used, 472G free.
