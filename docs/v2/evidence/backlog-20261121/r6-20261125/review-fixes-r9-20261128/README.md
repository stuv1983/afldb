# R6 r9: Astra's three merge blockers on draft PR 5 (28 November 2026)

**Status: PROPOSED. Nothing installed. Production was not contacted. No host group, live sudoers, SSH key or infrastructure was
changed. R6 stays NO-GO. PR 5 stays draft. Astra's verdict on the delivered head is pending.** The historical sitting artefacts,
the owner's unresolved "before P4" ruling, the dated gates and the four completed issue closures (368, 374, 375, 377) are unchanged.

## Pins

| Item | Value |
|---|---|
| Base (r8 delivered head, Astra reviewed) | `c83abebddae12874be2674bce44123c79381444e` |
| **Tested revision** | **`b2ef6bedb971375b47abf8c84e9c72890fd0f214`** (every executable, harness and runbook change; runbook pins as placeholders) |
| Delivered head | the pin commit on top of `b2ef6bed`: OWNER-PROCEDURE placeholders filled, this record, the independent review, the T-run evidence, trackers. No executable differs from the tested revision (`git diff b2ef6bed HEAD` touches only `.md`, `.txt` and `.log` evidence) |
| Owner verifier `bundle/SHA256SUMS` = wrapper `BUNDLE_SHA` | `58fceba6…` → **`3ea412092a3b024bd6520d9106694f874e45335974b6be96a85083ffac2ecb95`** (`g0b-core.sh`, `afldb-verify-dispatch`, one `g0-core.sh` message) |
| Owner verifier packet `R7/verify/SHA256SUMS` | `49e0fa7c…` → **`8b605119acb4cfe571cba8d8c963796447f8f37d962ead23d6f903f6d23144d5`** (`build-sums.sh --check` PASS) |
| Phase 4 script `R9/phase4/SHA256SUMS` (new) | **`a4210feb99f8dbb34dfb9cc9bd8042ff1f5f36d149648643916154caaef86558`** (`afldb-phase4.sh` `a52364cd…`) |
| Gate acceptance `R9/accept/SHA256SUMS` (new) | **`e6395776c4438b3ab8111d786a84b35724407a0f7cb330f2f184d6449c14ef64`** (`afldb-gate-accept.sh` `d3981f93…`, `test-gate-accept.sh` `d3b91bda…`) |
| Unchanged | sealed-backup `R7/backup/SHA256SUMS` `e3a68821…`; owner checks `R8/owner-checks/SHA256SUMS` `70d05b10…`; R6 manifest `426c07ff…`; release `scripts/SHA256SUMS` `52900a0e…` |
| `deploy/` hints | `release.mjs` `7dee0dc7…` → `4c99c7ae…`; `post-install-check.sh` `3d0bb2a9…` → `4cdb7d9a…` (line counts unchanged). The historical 24 Nov A2 packet `a1a2-20261124/a2-p0-entry.sh:49` pins the old `post-install-check.sh` and would STOP against this revision; it is a dated record and was not regenerated. The release-17822b29 packet is pinned to `17822b29` and is unaffected |
| Fenced blocks of the ATTENDED-PLAN and the release RUNBOOK | **byte-identical** to `c83abebd` (extracted-block sha256 plan `fb8c413b…`, runbook `b66fa4e8…`): r9 changed table rows and prose only, so r7's printed-block driver proof and release rehearsal still apply |

## What r9 changed

### 1. Independent G0b evidence is mandatory (Astra blocker 1)

* **Withdrawn:** the r8 option to accept and label G0B as arm-attested. OWNER-PROCEDURE §8 and checklist row S, the release
  RUNBOOK G0 row, §4.1 item 3 and §4.1a item 3, and the R6 plan's NG-OFFHOST and NG-DATA rows and its r7-install note now say that
  streamanator is not qualifiable and that its G0B is information only.
* **Wrapper enforcement** (`R7/verify/afldb-verify-call.sh`). The off-host endpoint is named only by the owner's pin
  `R9/offhost/QUALIFIED-ENDPOINT`, located relative to the wrapper and **absent in the repository** (the default is unconfigured).
  * With no pin, `g0` asks streamanator for information only (every relayed line prefixed `[unqualified endpoint, information only]`)
    and ends `OWNER VERDICT G0 STOP … offhost=none offhost-info=<PASS|STOP|…> reason="no qualified off-host endpoint …"`, exit 1,
    **even when streamanator answers an authenticated, fully matching PASS** (local T02; DEV scenario k).
  * A pin naming streamanator or 10.0.40.100, or carrying a host key the owner's known_hosts records for them, or naming
    production, or whose qualification record does not match its digest, is refused before any call.
  * A pinned endpoint's host key must equal the pin; ssh is then given only that key.
  * `--qualification-fixture` is accepted only with `--rehearsal`; every such verdict says `qualification=FIXTURE`. Production
    transport refuses the flag (exit 2, no ssh).
  * `version` targets the qualified endpoint; without a pin its off-host line is `STOP … no qualified off-host endpoint` (exit 1),
    and the production line stays independent.
* **Scheduled-transfer evidence.** `g0b-core.sh` emits `dispatch-at`, `received-at`, `received-sha256`, `complete-at` and
  `rehash-sha256`; the dispatcher turns a G0B PASS lacking any of them into an internal STOP; the wrapper requires all five,
  `dispatch-at` in [D 03:10, +60 s), dispatch − 5 s ≤ received ≤ complete ≤ D 03:10 + 2100 s and ≤ `at=`, and both sha256 values
  equal to G0a's. A matching file without the dispatch or the completion is "possession only" (local T12/T13/T25/T26; DEV l1, l2).
* **Owner procedure:** [offhost/QUALIFY-OFFHOST.md](offhost/QUALIFY-OFFHOST.md) (Q1–Q7: independence of administration,
  hypervisor and storage with evidence, the owner checks run there, the off-host role installed through that host's own admin path,
  the scheduled 03:10 pull, the record, the pin, a second reader, the commit). **No machine is qualified today and none is
  nominated.** Live qualification is Stu's. Until then G0 STOPs, the release stops before P2, and NG-OFFHOST/NG-DATA stay NO-GO.

### 2. Post-Phase-4 checks are decisive (Astra blocker 2)

* OWNER-PROCEDURE 3.13 is labelled an **installation diagnostic**; Phase 3 ends in STOP; checklist rows 3.13 and 3.end say so.
* [accept/afldb-gate-accept.sh](accept/afldb-gate-accept.sh) is the acceptance path. Release G0 is GO only on `GATE ACCEPT
  RELEASE-G0 GO transport=production`, R6 NG-PRE only on `GATE ACCEPT NG-PRE GO transport=production`. GO requires: (a) the saved 4.4
  output with `OWNER CHECKS RESULT PASS` as its last line and all 36 checks PASS (B1–B3 included); (b) the saved 4.5 re-verification of
  both installed bundles, the `--as-arm` identity without `sudo`/`admin`/`wheel`; (c) a 4.6 version check after (a) and (b) on the
  same bundle (release G0 also needs the qualified off-host PASS); (d) the gate's own wrapper verdict after (c), exit 0, at most 3 h
  after (a)/(b), from the same production boot (a `BOOT-ID` line in 4.4/4.5 bound to the authenticated `boot=`), checked at most 1 h later (R9-F-1): `OWNER VERDICT G0 PASS` naming the same endpoint and qualification, or `OWNER VERDICT A2 PASS` (an A2 STOP with
  `backup-origin=attributed` is NO-GO). Relayed lines never match; rehearsal output gives only `GATE ACCEPT REHEARSAL …`.
* Wired into OWNER-PROCEDURE 4.4–4.6 (saved with `tee`, copied to the workstation over the admin path, 4.5a) and the new
  "Saved evidence" paragraph, checklist row G, the RUNBOOK G0 row and §4.1, and the plan's NG-PRE, NG-OFFHOST and NG-DATA rows.

### 3. Phase 4 entry and exact back-out (Astra blocker 3)

* [phase4/afldb-phase4.sh](phase4/afldb-phase4.sh), staged from the workstation tar and pinned (2.1.8):
  * `entry` (4.0) records arm's groups, the sudo group line, a copy, sha256, owner and mode of every sudoers file, and every match;
    admits only `%sudo` (group-only) and `--dispose` files; REFUSES anything else, naming file:line and token. It is deliberately
    stricter than owner-checks B3 (unchanged), also refusing `#uid`, `%#gid`, `%:`/netgroups, `ALL`/negated users, continuation-line
    forms, includes other than `/etc/sudoers.d`, and non-files rule sources (nsswitch, LDAP, sssd, sudo.conf Plugin). It seals the
    state and prints each change's exact back-out.
  * `verify` (4.2): the realised change equals the plan; a STOP means back-out, never "back to 4.1".
  * `backout`: restores disposed files byte-identically with owner, group and mode, restores group membership, runs `visudo -c`, and
    proves the pre-change state; never deletes or overwrites an unplanned file.
* OWNER-PROCEDURE Phase 4 preconditions (console open, two admin logins, separate owner approval after reading 4.0), rows 4.0–4.3,
  the back-out paragraph, the B3 row and the checklist now follow it. The r8 claim that `gpasswd -a arm sudo` "restores the previous
  state exactly" is withdrawn (rehearsed contrast `old-r8-backout`).

### 4. Hints

`deploy/release.mjs:1197` and `deploy/post-install-check.sh:76,134-138,151` now direct the restart and journal reads to the admin
root session [ADM-ROOT] and drop `sudo`; `docs/deployment.md` §3a shows the restart in [ADM-ROOT] and the `node` steps as arm.
**Follow-up (not in scope):** other `sudo` lines remain in `docs/deployment.md` (72, 246, 803, 1326, 1384, 1738),
`docs/production-cutover.md`, `docs/admin-and-beta.md` and `docs/apex-coming-soon.md`; OWNER-PROCEDURE's Phase 4 precondition
already requires them to move to [ADM-ROOT] before arm's sudo is removed.

## Verification

Development runs (worktree bytes equal to `b2ef6bed` for every file they exercise):

| Run | Result |
|---|---|
| Wrapper decision test `offhost/tests/r9q-wrapper-test.sh` (actual wrapper, stub ssh) | `R9Q LOCAL RESULT PASS (31 tests)`; rerun by the coordinator before the commit |
| Verify harness `r9oq2` (DEV, real systemd, real bundle; FIXTURE qualification) | `R7 VERIFY HARNESS RESULT PASS`, 12 scenarios incl. k (unqualified STOP although the off-host container answers PASS; fixture naming streamanator refused; production refuses the fixture flag; unknown host key STOP) and l1/l2 (END removed, dispatch vacuumed: possession only). `offhost/evidence/dev/` |
| Gate acceptance `accept/test-gate-accept.sh` | `GATE ACCEPT TESTS RESULT PASS cases=36`; the counterexample on real Phase 3 outputs (ce1–ce4) NO-GO for both gates; rerun by the coordinator before the commit. `accept/evidence/` |
| Phase 4 fixtures `phase4/p4-run.sh dev-p4g` (DEV, real sudo 1.9.15p5, gpasswd, visudo) | 20/20 PASS: group-only, its back-out, seven refusals (90-arm, User_Alias, %adm, admin group, include, uid, ALL, uid alias, continuation, negation, nsswitch), disposed and disposed-removed with byte-identical back-out, late grant, old r8 back-out losing the rule, unplanned edit, state tamper. Residue 0. `phase4/evidence/` |
| Procedure harness `r9p-dev1` (DEV, the owner procedure end to end with phase4 and acceptance) | `R8 PROCEDURE HARNESS RESULT PASS`; `accept-counterexample-*` NO-GO (release-g0 `failed=owner-checks,reverify,version,verdict`; ng-pre `failed=owner-checks,reverify,verdict`); `accept-post-phase4-ng-pre` NO-GO `failed=verdict` only (A2 STOPs in a container), so parts a–c accept real post-change output. `phase4/evidence/procedure-r9p-dev1/` |

Runs at the tested revision: @@T_RUNS@@

Independent review: [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md). @@REVIEW_SUMMARY@@

## Not exercised, owner actions

* Live qualification of an off-host endpoint (Stu; QUALIFY-OFFHOST.md). Simulated independence in the harness is FIXTURE evidence.
* A GO on real output: no rehearsal produces an A2 PASS or a qualified G0 PASS; the GO cases rest on labelled fixtures.
* Production Phases 0–4 (console, admin account, checks, installs, privilege removal with separate approval).
* The DigitalOcean console, production sshd/sudoers/host key/firewall, interactive `passwd`/`sudo` prompts.
* The pinned base image `sha256:d71c0b28…` is tagged `grafana/alloy:latest` (Ubuntu 24.04.4 userland, entrypoint overridden), not
  the plain Ubuntu 24.04 image the r8 text described (LOW, rehearsal provenance only).
