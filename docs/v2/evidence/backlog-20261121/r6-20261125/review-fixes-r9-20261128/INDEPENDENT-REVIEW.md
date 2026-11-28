# INDEPENDENT REVIEW: R6 r9 (draft PR 5), revision T = b2ef6bedb971375b47abf8c84e9c72890fd0f214

Date: 28 Nov 2026. Reviewer: afldb-reviewer (independent of the implementer and of Astra).

**Method and limits.** Read-only review of the files in the worktree `D:\dev\afldb-closeout-20261127`. I had no shell: I ran
nothing, hashed nothing and diffed nothing. Every statement about behaviour comes from reading the code. Every statement about a
run comes from the committed logs, which are development runs at worktree bytes, not runs at T. I could not confirm that the logged
wrapper digest (`offhost/evidence/local-r9q.log:2`, `a33e3176…`) is the wrapper at T. The checker digest in
`accept/evidence/summary.txt:37` (`d3981f93…`) equals `accept/SHA256SUMS:1`. The `@@…@@` placeholders are not counted as defects;
each is used where its value belongs (OWNER-PROCEDURE.md:87-93, 189-196, 316, 321, 388).

Paths: `R7=…/review-fixes-r7-20261128`, `R8=…/review-fixes-r8-20261128`, `R9=…/review-fixes-r9-20261128`,
`RUNBOOK=docs/v2/evidence/release-17822b29-20261124/RUNBOOK.md`, `PLAN=docs/v2/evidence/backlog-20261121/ATTENDED-PLAN-R6-20261125.md`.

## Result

No CRIT and no HIGH finding. Astra's three blockers are closed on the documented path. Four MED findings remain, two of which let
the acceptance checker print GO while production's owner checks would be BLOCKED (not from Phase 3 outputs, but from stale or
non-production inputs). They go to the orchestrator.

| Question | Answer |
|---|---|
| Q1. Can a matching PASS from the current streamanator endpoint authorise G0? | **NO** on every route that does not also need the owner to commit a pin for it |
| Q2. Can Phase 3 installation success authorise release or reboot while the owner checks are BLOCKED? | **NO** for Phase 3 outputs. **YES** for two adjacent paths in which the checker prints GO while the checks are BLOCKED (R9-F-1) |
| Q3. Can an unrelated sudoers grant pass Phase 4 entry, or can the back-out lose a pre-existing rule? | Entry: **YES** for one adversarial form (R9-F-5, caught at 4.2). Back-out losing a rule: **NO** |

## Q1. streamanator and G0

| Route | Outcome | Evidence |
|---|---|---|
| No pin (the default) | G0 STOP, exit 1, even on a fully matching authenticated G0B PASS | `$R7/verify/afldb-verify-call.sh:109` (absent pin gives `Q_KIND=none`), `:286-294`; `local-r9q.log:33-35` (T02); `dev/r9oq2-summary.log:11` |
| Pin with `host=` or `address=` streamanator / 10.0.40.100 | refused before any call | `afldb-verify-call.sh:65`, `:138`; `local-r9q.log:55-57` (T04), `:64-66` (T05) |
| Pin under another name or address, carrying streamanator's host key | refused | `afldb-verify-call.sh:174-175`; `local-r9q.log:78` (T06) |
| Pin under another address with `host=` another name | STOP: the RESULT `host=` must equal the pin's `host=`, and the verifier reports the kernel host name | `afldb-verify-call.sh:228`, `:297`; `bundle/lib.sh:15`; `local-r9q.log:346` (T21) |
| `--qualification-fixture` on production transport | exit 2, no call | `afldb-verify-call.sh:78-79`; `local-r9q.log:364-368` (T23) |
| A fixture naming streamanator in rehearsal | refused | `afldb-verify-call.sh:138`; `dev/r9oq2-summary.log:11` |
| Relayed lines | every line of the unqualified answer is prefixed; elsewhere `OWNER VERDICT` / `AFLDB-VERIFY RESULT` text is neutralised | `afldb-verify-call.sh:192-202`, `:288`; `local-r9q.log:32-33` |
| `version` | production line, then an off-host STOP, exit 1 | `afldb-verify-call.sh:319-320`, `:325`; `local-r9q.log:46-51` (T03) |
| The checker accepting such a G0 | NO-GO: it needs the off-host VERSION PASS and the G0 PASS to carry the same `qualification=pinned qual-sha256=` | `$R9/accept/afldb-gate-accept.sh:112`, `:125-126`, `:152-153`; `summary.txt:26`, `:34-35` |
| Possession only | STOP from a qualified endpoint without dispatch, completion or received record; the dispatcher also turns a core PASS without the five fields into STOP | `afldb-verify-call.sh:245-264`, `:299-301`; `bundle/afldb-verify-dispatch:145`; `bundle/g0b-core.sh:85`, `:112`, `:117`; `local-r9q.log:158` (T12), T13-T19; `dev/r9oq2-summary.log:13` |

The arm-attested option is gone from OWNER-PROCEDURE §8 (`:427-437`), row S (`:538`), RUNBOOK G0 row (`:211`) and §4.1a (`:345-349`),
PLAN NG-OFFHOST and NG-DATA (`:341`, `:343`). Simulated independence is labelled `qualification=FIXTURE` on every verdict
(`afldb-verify-call.sh:145`, `:302`; `dev/r9oq2-summary.log:2`).

**Residual, stated plainly.** The three refusals are a name, an address and a known-key test. streamanator's root sets its own
kernel host name and can add a host key. A pin that names streamanator under a new host name, a new address alias and a key the
owner's `known_hosts` does not hold for 10.0.40.100 is not caught by the wrapper. It needs the owner to add that key and commit that
pin, so it is a qualification failure, not a wrapper bypass. QUALIFY-OFFHOST.md:153-155 says so. See R9-F-6 and R9-F-10.

## Q2. Phase 3 and the gates

Phase 3 ends in STOP (OWNER-PROCEDURE.md:321, `:323-328`, row `3.end` at `:530`). The summary rows and the detailed text reach the
same decision: OWNER-PROCEDURE `:386-400` and row G (`:536`); RUNBOOK G0 row (`:211`), §4.1 (`:229-233`, `:291-296`); PLAN NG-PRE,
NG-OFFHOST, NG-DATA (`:340-343`) and `:947-948`.

Astra's counterexample (both installs PASS, VERSION PASS, owner checks BLOCKED on B1/B2/B3) is NO-GO for both gates, on real
harness output: `summary.txt:1-4` (ce1-ce4); `procedure-r9p-dev1/r9p-dev1-summary.txt:30-31`. Further: a Phase 3 version call is
rejected on time order (`afldb-gate-accept.sh:123`; `summary.txt:12`); a pre-Phase-4 reverify is rejected because arm still carries
`sudo` (`:92-93`; `summary.txt:15`); an A2 STOP with `backup-origin=attributed` is NO-GO and exit 0 is required (`:140-145`;
`summary.txt:9-11`, `:22`); relayed lines do not count (`summary.txt:17-19`); rehearsal wrapper output is refused for a real gate
(`:103`; `summary.txt:20`, `:32`).

The two paths on which GO coexists with BLOCKED owner checks are R9-F-1.

## Q3. Phase 4 entry and back-out

| Form | Entry | Evidence |
|---|---|---|
| line naming `arm`, `User_Alias` with arm, `%<other group>` | REFUSED | `$R9/phase4/afldb-phase4.sh:82-93`, `:211-216`; `dev-p4g-summary.txt:3-5` |
| `#<uid>`, uid in an alias, continuation line | REFUSED | `:104-109`, `:118-120`; `dev-p4g-summary.txt:11`, `:13-14` |
| `%#<gid>`, `%:`, netgroup | REFUSED by code; **no scenario** | `:121-122`, `:128`, `:136-138` |
| `ALL` user, negation | REFUSED | `:129`, `:136`; `dev-p4g-summary.txt:12`, `:15` |
| include other than `/etc/sudoers.d` | REFUSED | `:160-166`; `dev-p4g-summary.txt:7` |
| nsswitch `sudoers:` | REFUSED | `:146-149`; `dev-p4g-summary.txt:16` |
| LDAP, sssd, `sudo.conf` Plugin | REFUSED by code; **no scenario** | `:150-157` |
| arm in `admin` / `wheel`; link, non-regular or odd name in `sudoers.d` | REFUSED | `:194`, `:219`; `dev-p4g-summary.txt:6` |
| grant added after entry | 4.2 STOP, back-out FAIL naming the file, then PASS after removal | `:278`, `:312`; `dev-p4g-summary.txt:17` |
| disposed file edited or removed | back-out restores bytes, owner, group and mode, then `visudo -c` | `:293-305`; `dev-p4g-summary.txt:9-10` |
| state directory tampered | verify STOP, back-out FAIL | `:174-181`; `dev-p4g-summary.txt:20` |
| r8 back-out (`gpasswd -a` alone) after a rule edit | shown to lose the rule; the r9 back-out does not | `dev-p4g-summary.txt:18` |

The open console, the two admin logins and the separate owner approval are preserved (OWNER-PROCEDURE.md:332-349; printed by entry
at `afldb-phase4.sh:245-248`). The three named hints direct privileged actions to [ADM-ROOT]: `deploy/release.mjs:1197`,
`deploy/post-install-check.sh:76`, `:134-138`, `:151`, `docs/deployment.md:226-233`.

## Findings

### R9-F-1 (MED): the checker prints GO on stale or non-production owner evidence

`$R9/accept/afldb-gate-accept.sh:57`, `:75-76`, `:150`.

* **Stale.** The only age rule is "verdict at most 24 h after (a)/(b)" (`:150`). Nothing compares any input with the workstation
  clock. Scenario: Phase 4 and 4.4-4.6 are saved at 09:00. At 15:00 arm regains sudo (a back-out, or any later access change), so the
  owner checks would be BLOCKED. At 08:50 next day the owner runs `a2`, gets PASS, and runs the checker on the documented files in
  `~/afldb-r9-accept`. Result: `GATE ACCEPT NG-PRE GO transport=production`. OWNER-PROCEDURE.md:397 asks for a repeat "on a later
  gate day", but the checker does not enforce it.
* **Not production.** Inputs (a) and (b) carry no transport marker, and the rehearsal container is also `host=afldb-prod`
  (`procedure-r9p-dev1/r9p-dev1-in-4.4-owner-checks.txt:1`). The suite itself shows it: p3/p4 print
  `GATE ACCEPT RELEASE-G0 GO transport=production` and `GATE ACCEPT NG-PRE GO transport=production` over the rehearsal 4.4/4.5 files
  (`summary.txt:7-8`, same `owner-checks-at`/`reverify-at` as p1/p2 at `:5-6`; `test-gate-accept.sh:97-98`, `:127-129`). The
  `fx-*-prod.txt` inputs are committed under `accept/evidence/inputs/`, so that GO line can be reproduced at any time.

Smallest fix: (1) require the verdict time to be within a short window (for example 2 h) of the workstation clock, and (a)/(b) to be
within a few hours of the verdict rather than 24 h; (2) have 4.4 and 4.5 each start with a root-printed boot id line and require
both to equal the `boot=` of the authenticated VERSION RESULT line; (3) make the checker refuse an input whose first line is the
fixture marker, or generate the `-prod` fixtures in a temporary directory instead of committing them. Acceptance: three new cases
in `test-gate-accept.sh` (verdict older than the window; boot id differs; fixture marker), each NO-GO.

### R9-F-2 (MED): a `%sudo` line in a disposed file is classified "disposed" and listed for removal

`$R9/phase4/afldb-phase4.sh:211`, `:240`.

Scenario: production's `/etc/sudoers` has an appended `arm ALL=(ALL) ALL`, so the owner runs `entry --dispose /etc/sudoers`. The
stock `%sudo ALL=(ALL:ALL) ALL` line is in the same file. Entry prints it as `class disposed` and lists it in "removing or changing
line(s) N(%sudo) M(arm)". Step 4.1 says to change "exactly the lines 4.0 named" (OWNER-PROCEDURE.md:354). Deleting the `%sudo` line
removes `afldb-admin`'s own route to root (it has sudo by group, step 1.8). `verify` still PASSes, because it judges arm only. The
loss shows at 4.3, and the recovery is the console back-out. No scenario disposes of `/etc/sudoers` (`p4-scen.sh:111-131` uses
`90-arm` only).

Smallest fix: test `%sudo` before `is_disposed` at `:211`, and leave group-only tokens out of the line list at `:240`. Acceptance:
a new scenario that disposes of `/etc/sudoers` holding both lines and expects `%sudo … class group-only` and a change list naming
only the arm line.

### R9-F-3 (MED): a test hook yields `transport=production` verdicts without contacting any host

`$R7/verify/afldb-verify-call.sh:69`, `:240`; `$R9/accept/afldb-gate-accept.sh:139-140`.

`AFLDB_VERIFY_SSH` replaces the ssh binary on production transport. The verdict still says `transport=production` and prints only
the basename (`ssh=`). The checker accepts any `ssh=` value. `local-r9q.log:138` is a complete
`OWNER VERDICT G0 PASS transport=production ssh=stub-ssh … qualification=pinned` made by a stub. For `a2` and `version` no pin is
needed at all. Scenario: the variable is left exported in the owner's Git Bash after a local test run; the `a2` call returns the
stub's PASS and the checker accepts it for NG-PRE. I could not tell whether the hook predates r9.

Smallest fix: when the variable is set and the transport is production, label the verdict and header `transport=production-stub`
(the checker then refuses it unchanged), or honour the variable only with `--rehearsal`. Acceptance: T11 prints
`transport=production-stub`, and a checker case on it is NO-GO.

### R9-F-4 (MED): RUNBOOK and PLAN still pin the r8 revision and bundle, with no placeholder

`RUNBOOK:313-315`, `:353-356`, `:233-234`, `:237`; `PLAN:957-958`, `:1003-1007`; `$R9/README.md:13`.

The pin commit fills OWNER-PROCEDURE only. RUNBOOK §4.1a and the PLAN note keep `12e46305…` and `58fceba6…` and tell the owner to
export `V7` at that revision. The wrapper there has no qualification rule, so `g0` against streamanator prints
`OWNER VERDICT G0 PASS transport=production`, and RUNBOOK:233-234 still carries "G0 passes only on `OWNER VERDICT G0 PASS`".
`PLAN:1006` still requires VERSION PASS "for `streamanator` (role offhost)", and `RUNBOOK:237` names streamanator as the G0b host.
Only the checker (which needs the `qualification=pinned` fields) stops that path, so the wrapper-side enforcement that blocker 1
asked for can be bypassed by following the document. A mixed install (r8 bundle, r9 wrapper) fails closed on the bundle digest.

Smallest fix: in the pin commit, replace those r8 values with the r9 revision, `verify/SHA256SUMS` and `BUNDLE_SHA`, and strike
`PLAN:1006-1007` and the streamanator clause of `RUNBOOK:237`. Acceptance: a search of both files for `12e46305` and `58fceba6`
finds only struck-through history.

### R9-F-5 (LOW): an escaped name in a `User_Alias` passes entry

`$R9/phase4/afldb-phase4.sh:126-130` (alias branch) against `:134` (user-spec branch).

`User_Alias X = ar\m` followed by `X ALL=(ALL) ALL` grants arm (sudoers collapses the escape). The B3 scan does not match it, and the
alias branch does not flag a backslash. Entry PASSes as `group-only`, so `gpasswd -d` runs with the grant in place. `verify` then
STOPs on `sudo -l -U arm` (`:284`) and the back-out is exact, so no privilege survives unnoticed. Fix: flag any alias member that
contains a backslash or a quote, as `:134` does for user lists.

### R9-F-6 (LOW): the pin is not bound to a committed, reviewed value

`$R7/verify/afldb-verify-call.sh:109`, `:141-143`; OWNER-PROCEDURE.md:360; QUALIFY-OFFHOST.md:135-137.

The wrapper honours any `QUALIFIED-ENDPOINT` in the working tree, tracked or not, and any record bytes that hash to the pin (an
empty file passes). Step 4.6 runs from the working clone. QUALIFY §4.5 compares `qual-sha256` with the same working-tree file. The
second reader and the commit are procedure only. Fix: give the checker `--qual-sha256` and document its source as
`git show <rev>:$R9/offhost/QUALIFIED-ENDPOINT | sha256sum`.

### R9-F-7 (LOW): `g0` accepts only 2026-11-24..29, so QUALIFY Q7 cannot be met after tomorrow

`$R7/verify/afldb-verify-call.sh:68`, `:273`; QUALIFY-OFFHOST.md:42, `:109-113`. A machine built from 29 Nov has its first
scheduled night outside the window, and `g0` answers usage (exit 2). Fail-closed, and acknowledged at OWNER-PROCEDURE.md:101 and
PLAN:1009-1010; the re-dated packet must widen it.

### R9-F-8 (LOW): `sudo systemctl restart afldb` remains in deployment.md

`docs/deployment.md:250` (inside §3a), `:72`, `:807`, `:1330`, `:1388`, `:1742`. After Phase 4 these fail, and they invite typing a
password in an arm session. Acknowledged as outstanding at OWNER-PROCEDURE.md:346-347.

### R9-F-9 (INFO): coverage gaps

No scenario for `%#gid`, `%:`, netgroups, LDAP, sssd, a Plugin line, a trailing-blank continuation, or disposal of `/etc/sudoers`.
All logs are development runs at worktree bytes; the runs at T were in progress and are not judged here.

### R9-F-10 (INFO): streamanator in disguise

See the Q1 residual. The control is the qualification record and its review (QUALIFY-OFFHOST.md:44-46, `:153-155`).

## Files written

Only this file: `docs/v2/evidence/backlog-20261121/r6-20261125/review-fixes-r9-20261128/INDEPENDENT-REVIEW.md`.

---

# Round 2 (T2 89e09ba4ef26605641f5e66c0ef8764547ee828a)

Date: 28 Nov 2026. Same reviewer, same limits: no shell, nothing run, hashed or diffed. I re-read from disk the checker, the
Phase 4 script, the wrapper's transport section, OWNER-PROCEDURE 4.0-4.6 and the back-out, the RUNBOOK and PLAN pin lines,
QUALIFY-OFFHOST §4.7, and the new evidence summaries. The logs are development runs at worktree bytes, which the coordinator states
equal T2; the reruns at T2 were in progress and are not judged. The checker digest in `accept/evidence/summary.txt:48` (`0e6db5ae…`)
equals `accept/SHA256SUMS:1`.

## Result

No CRIT and no HIGH. F-2, F-3, F-4 and F-5 are closed. F-1 is closed in three of its four parts; the freshness rule measures
against the **newer** of (a) and (b), which leaves one stale input accepted (new R9-F-11, MED, a one-token fix).

| Finding | Status at T2 | Evidence |
|---|---|---|
| R9-F-1 stale evidence | **partly closed**: see R9-F-11 | `afldb-gate-accept.sh:193-202`; `summary.txt:28-31` (n20-n23) |
| R9-F-1 non-production (a)/(b) | closed: `BOOT-ID` first line in 4.4 and 4.5, bound to the `boot=` of the authenticated VERSION and verdict RESULT lines | `afldb-gate-accept.sh:92`, `:120`, `:155-156`, `:181-185`; OWNER-PROCEDURE.md:359-360, `:401-403`; `summary.txt:32-35` (n24-n27) |
| R9-F-1 committed fixtures | closed: any input with a `[FIXTURE r9]` line is refused; `--now` only with `--rehearsal` | `afldb-gate-accept.sh:47-48`, `:68`, `:79`, `:103`, `:127`; `summary.txt:36-37`, `:39` |
| R9-F-2 `%sudo` in a disposed file | closed: `%sudo` is classified first; a file whose only match is `%sudo` cannot be disposed; a `%sudo` line sharing a line with a disposed match is refused; the change line names only disposed lines and prints KEEP; verify requires every other line byte-identical and `sudo -l -U afldb-admin` unchanged | `afldb-phase4.sh:238`, `:230-231`, `:248-252`, `:277`, `:316-341`; `dev-p4h-summary.txt:21-24` |
| R9-F-3 stub labelled production | closed: `transport=production-stub` with a warning line; the checker takes only the exact token | `afldb-verify-call.sh:84-87`; `afldb-gate-accept.sh:126-130`; `local-r9q-r9f3.log:157`, `:528`, `:539`; `summary.txt:38` |
| R9-F-4 r8 pins in RUNBOOK and PLAN | closed: r8 values struck, r9 placeholders added, "never use the r8 wrapper" stated; the `streamanator` VERSION PASS line is gone from the PLAN | `RUNBOOK:315-317`, `:358`; `PLAN:957-958`, `:1005-1006` |
| R9-F-5 escaped alias member | closed | `afldb-phase4.sh:144-145`; `dev-p4h-summary.txt:25` |
| R9-F-6, R9-F-7 (LOW) | documented, not enforced | QUALIFY-OFFHOST.md:44, `:148-153` |

## New findings

### R9-F-11 (MED): freshness is measured from the newer of (a) and (b), so one of them may be arbitrarily old

`$R9/accept/afldb-gate-accept.sh:195`, `:198`; documented the same way at OWNER-PROCEDURE.md:400, RUNBOOK:233.

Line 195 picks the later of the two times. The T version picked the older one. Scenario: 4.4 is saved on day 1 with PASS. On day 2
arm gains a route that 4.5 does not test (an explicit `arm ALL=` rule without the `sudo` group, the `docker` group, a superuser
role), with no reboot. On day 3 the owner runs 4.5, 4.5a and 4.6 but not 4.4. The day-1 4.4 file is still in `/root` and is copied
again by 4.5. Its `BOOT-ID` matches, the version call is later than both, and (e) compares the verdict only with the fresh 4.5 time.
Result: `GATE ACCEPT NG-PRE GO transport=production` while the owner checks would be BLOCKED. No case covers one stale input:
n20 and n21 age both together (`summary.txt:28-29`).

Smallest fix: at `:195` take the older time (`$B_TS < $E`), and say "older" in the three documents. Acceptance: a new case with a
4.4 header four hours before a fresh 4.5 and verdict, expecting `NO-GO failed=fresh`.

### R9-F-12 (LOW): RUNBOOK still names streamanator as the expected G0b host

`RUNBOOK:238` ("`afldb-prod` for G0a, `streamanator` for G0b"), under the r7 text kept at `:234`. The wrapper can no longer accept
that host, so it fails closed. Replace it with "the pinned endpoint's `host=`".

### R9-F-13 (INFO): a change hunk in a disposed file may add lines

`afldb-phase4.sh:329-334` checks only the old line range of a `c` hunk. Replacing a disposed line with several new lines passes
this check. The rescan (`:344`) and `sudo -l -U arm` (`:347`) still catch anything that names arm, so no arm grant survives.

## Final answers at T2

| Question | Answer |
|---|---|
| Q1. Can a matching PASS from streamanator authorise G0? | **NO.** Unchanged from round 1; the stub route now also carries a non-production label. The disguise residual (R9-F-10) and the uncommitted-pin residual (R9-F-6) remain procedural controls |
| Q2. Can Phase 3 success authorise release or reboot while the owner checks are BLOCKED? | **NO** for Phase 3 outputs, rehearsal or fixture inputs, a stub, another host or another boot. **YES** on one remaining path: a stale 4.4 from the same boot with a fresh 4.5 (R9-F-11) |
| Q3. Can an unrelated grant pass entry, or the back-out lose a rule? | **NO** for every form I could construct, the escaped alias included. Back-out: **NO**. `%#gid`, `%:`, netgroup, LDAP, sssd and Plugin refusals remain code-only, without a scenario |

## Files written in round 2

Only this section, appended to this file.

---

# Round 3 (T3 0c8de418da271068add1528c0a57e416ade51151)

Date: 28 Nov 2026. Same reviewer and limits (no shell; nothing run, hashed or diffed). Re-read from disk at T3: part (b) and part
(e) of the checker, the two new cases in the evidence summary, and the amended lines of OWNER-PROCEDURE and the RUNBOOK. `$R7` was
not re-read; the coordinator states it is unchanged from T2. The checker digest in `accept/evidence/summary.txt:50` (`2258f2b4…`)
equals `accept/SHA256SUMS:1`. The summary is a development run, not a run I made.

| Finding | Status at T3 | Evidence |
|---|---|---|
| R9-F-11 (MED) | **closed**. Each of (a) and (b) must be at most 3 h before the verdict; (b) is timed from its first header, so the older one decides | `afldb-gate-accept.sh:112` (`B_T0`), `:195-203`; `summary.txt:40-41` (n32 stale 4.4, n33 stale 4.5, both `NO-GO failed=fresh`); OWNER-PROCEDURE.md:400 ("OLDER of"); RUNBOOK:233 ("each of (a) and (b)"). No "newer" wording remains in the checker, OWNER-PROCEDURE, the RUNBOOK or the PLAN |
| R9-F-12 (LOW) | **closed** | RUNBOOK:238 names the pinned endpoint's `host=`, "never `streamanator`" |

**New findings at T3:** none. A part with no time is skipped in (e) only after it has already failed above (`:199`), so the result
stays NO-GO.

**Q2 at T3: NO.** Phase 3 success cannot authorise release or reboot while the owner checks are BLOCKED. GO needs a post-change
owner-checks PASS and a re-verification that are each at most 3 h older than the verdict and from the same production boot as the
authenticated version and verdict lines, a version call after both, the whole wrapper verdict with exit 0, and a check within 1 h
of that verdict. I found no remaining path in which GO coexists with BLOCKED owner checks, short of an access change inside that
3 h window, which the procedure forbids and no saved-output checker can see.

Q1 and Q3 are unchanged from round 2 (NO and NO). Still open as LOW or INFO, with no work required: R9-F-6, R9-F-7, R9-F-8,
R9-F-9, R9-F-10, R9-F-13.

## Files written in round 3

Only this section, appended to this file.
