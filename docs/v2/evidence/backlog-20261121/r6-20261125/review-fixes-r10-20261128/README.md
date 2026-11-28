# R6 r10: Astra's four acceptance cases on draft PR 5 (28 November 2026)

**Status: PROPOSED. Nothing installed. Production was not contacted. No live permission, host group, sudoers file, SSH key, endpoint
or infrastructure was changed. R6 stays NO-GO. PR 5 stays draft. Astra's verdict on the delivered head is pending.** Historical
sitting artefacts and the r7–r9 evidence are unchanged; r10 adds files and amends the operator documents in place, each amendment
labelled r10.

## Pins

Delivered tested revision: `6d0e75ad86bf4b9e2c49b85f453b5fff201c558d` (the pin commit that follows it changes text and records only).

| Pin | sha256 |
|---|---|
| `review-fixes-r7-20261128/verify/SHA256SUMS` (P_VERIFY) | `e253e97545545b7183cf474750cea2b54e36158e6f7b0d80552939bd42665324` |
| wrapper `BUNDLE_SHA` = `verify/bundle/SHA256SUMS` (P_BUNDLE) | `059f2ad445825757873d77b8329fd6be668d2da6bf5e816d599b55b396f20cba` |
| `review-fixes-r10-20261128/phase4/SHA256SUMS` (P_PHASE4) | `8bed56298b8fd3aada979d4c10e9bc5e1734075676b064da3c1c9756d8ca985b` |
| `review-fixes-r9-20261128/accept/SHA256SUMS` (P_ACCEPT) | `6d49ce2a52b71b38d65b9c41d358b94af24ef7a89162c4171f8662fd28e00539` |
| `afldb-gate-accept.sh` | `1b3f7d6547c85a0a907d1ef8613e1f9bd058fb6bb40c4bed4099a514ed7a5525` |
| `afldb-phase4.sh` | `5f77517a1c6d47568113678e3ca951c2d8038c4e59a8dd99e167c2ad475b2aed` |

## What r10 changed

### Case 1. The scheduled pull must have received this dump (receipt, not possession)

* `tools/maintenance/offhost-pull.sh` runs rsync with `--out-format='%i %l %b %n'` and prints
  `RECEIVED <dump> sha256=<h> bytes=<moved> size=<size>` only for a dump that **this run** transferred (itemised `>f+++++++++`,
  a file created here, with at least its size moved) and then verified. A dump that was already present, with `--ignore-existing`
  moving nothing, gets only the ordinary `verified` line. When rsync fails (exit 23 for an unreadable source file) it says
  `rsync failed (exit N); no receipt is issued for any file of this run` and exits 1. Retention and the retention hold are unchanged.
* `kits/afldb-offhost-pull-daily.sh` re-hashes each RECEIVED dump and logs `RECEIVED run= dump= sha256= bytes=` before `END`, logs
  every copy present afterwards as `HELD` (possession only), and only after `END rc=0` writes one
  `RECEIPT run= dump= sha256= bytes= end=` per RECEIVED dump. A failed run writes no RECEIPT.
* `bundle/g0b-core.sh` (and the root facts reader) take `received-at`/`received-sha256` only from the identified 03:10 invocation's
  unique RECEIVED record of the dump G0a named, with G0a's sha256, inside the invocation, plus its unique RECEIPT within 60 s after
  that invocation's END rc=0. r9's VERIFIED record no longer counts. Otherwise: `UNPROVEN … possession only: the scheduled
  invocation did not receive <D> (… it HELD a copy: n time(s); it received: <list>)`, and the wrapper STOPs.
* The rehearsal now runs the **real** `offhost-pull.sh` over real rsync and ssh (an `rrsync -ro` source in the off-host container)
  instead of r7's fixture copy script.

### Case 2. Qualification without a bootstrap loop

* `afldb-verify-call.sh candidate-g0 <date> --host --address --hostkey` and `candidate-version --host --address --hostkey` collect the
  evidence for an **unpinned** candidate. They apply every refusal a pin gets (streamanator, production, unknown host key), print
  `CANDIDATE MODE: …` and one final `CANDIDATE EVIDENCE <G0|VERSION> COMPLETE|INCOMPLETE … qualification=candidate qual-sha256=none …
  (NOT a gate verdict …)`, exit 3 (complete) or 1, and **never** print `OWNER VERDICT` or exit 0. Production transport refuses
  `--utc-offset` (a rehearsal-only key) and a rehearsal refuses a production-format pin; production refuses a fixture-format pin.
* `QUALIFY-OFFHOST.md` §3a and §4: candidate collection → owner review → pin commit → acceptance from a `git archive` export of that
  commit.
* `afldb-gate-accept.sh` (g): release-g0 production requires `--pin-rev <commit>`; the checker reads the pin from that commit in its
  own clone (`git cat-file`) and requires the commit, the pin, the production format and sha256 equal to the `qual-sha256` of 4.6
  and the G0 PASS. An older export (no pin), a fixture pin and an edited pin are `failed=pin`.

### Case 3. An access change voids saved evidence

* `afldb-phase4.sh apply`, `backout` and the new `invalidate --reason TEXT` write a new access epoch (`/var/lib/afldb-access/epoch`,
  root 0644, 32 hex; history in `changes.log`) **before** any change and end with `VOID: STOP: every saved 4.4, 4.5 and 4.6 output
  and every gate verdict made before this moment is VOID, even on this boot and inside the freshness window …`.
* `afldb-verify-dispatch` appends ` access-epoch=<value|none|untrusted|malformed>` to every RESULT line; OWNER-PROCEDURE 4.4 and 4.5
  save `ACCESS-EPOCH <value>` as their second line; `afldb-gate-accept.sh` (f) requires one 32-hex epoch across every passing part
  (`failed=access` with the VOID text otherwise).
* The rule is stated at the steps: OWNER-PROCEDURE Phase 4 ('An access change voids saved evidence', rows 4.4–4.6, Saved evidence),
  the §10 checklist row 4.4–4.6, release RUNBOOK G0 row and §4.1, and R6 plan NG-PRE. A change the owner makes or learns of outside
  the script is recorded first with `afldb-phase4.sh invalidate --reason …`; an unrecorded change is caught only by the repeated 4.4
  owner checks.

### Case 4. Phase 4 approval and recovery bound to the exact change and attempt

* `--dispose` is withdrawn (a usage error). `entry` lists every grant with its `--remove-grant FILE:START-END:SPAN-SHA256:FILE-SHA256`
  token; only selected grants are removed, by apply, from the captured copy (checked with `visudo -cf` at entry); every unselected
  non-`%sudo` grant blocks entry, a second grant in the same file included; malformed, duplicate, overlapping, unknown, `%sudo`-holding
  or out-of-date tokens are refused before mutation. Unrelated lines are preserved byte for byte.
* `entry` creates its own root-only directory `/root/afldb-phase4/attempt-<UTC>-<8 hex>` (with a sealed attempt record naming that
  directory and a random nonce, so two attempts never share a seal), prints `PHASE4 STATE`, `PHASE4 SEAL` and the exact apply, verify
  and back-out commands carrying both. `apply`, `verify` and `backout` require `--state` and `--seal`; apply and backout also require
  the host's applied-attempt record to name that attempt. A copied or moved directory, an old attempt, a wrong seal or a host changed
  outside the plan is refused before mutation; the right one restores bytes, owner, mode and group membership and proves it.
* The fixed recovery path (`/root/afldb-phase4-state`) is gone from the procedure and the checklist; the staged script is
  `/root/afldb-r10-phase4`.

### Round 2: the independent review's findings ([INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md), judged `07f05f3d`)

* **F1 (HIGH, case 3 defeated in round 1).** Four saved files cannot show an access change made after all of them: a complete
  pre-change 4.4–4.6 plus gate verdict still gave GO after a back-out. The checker now requires `--confirm`: a wrapper `version`
  call made after the gate verdict and at most 10 min before the check, whose authenticated production RESULT is after the verdict,
  on the same boot and bundle. Its access epoch joins (f) even when the verdict fails, so the change is named on DEV too. A change
  after the confirm call is the stated residual (act on GO at once; every `afldb-phase4.sh` action prints VOID for an earlier GO).
* **F2 (MED).** The pin at `--pin-rev` must equal the pin at the checker clone's HEAD; a revoked or superseded pin fails.
* **F3 (MED).** Not changed: r9's dated window (2026-11-24..29) is a deliberate fail-closed gate. QUALIFY-OFFHOST now states that
  §3a/§4 cannot be completed in production with these bytes until a reviewed re-dating.
* **F5, F6 (LOW).** `offhost-pull.sh` uses `--whole-file`, gives no receipt for a dump present (or partial) before the run, and
  writes the machine-readable RECEIVED record to fd 3, which rsync and ssh never get; the daily wrapper parses fd 3 only.
* **F7 (LOW).** A FAIL/REFUSED apply or back-out prints `HAND: … invalidate --reason …`, and the procedure says to record a hand
  restoration with `invalidate`.
* **F4, F8, F9.** Texts: the checker binds pin bytes, not wrapper bytes (procedure step); apply adds a final newline to a selected
  file that lacks one, while back-out restores the exact original bytes; VERIFIED wording replaced by RECEIVED/HELD/END/RECEIPT.

## Verification

Tested revisions, in order: `07f05f3d` (round 1, judged by the independent review), `67c80882` (round 2 code), `74f7694f`
(procedure-harness call order), `6d0e75ad` (receipt test fixture). Between `67c80882` and `6d0e75ad` the only non-text changes are
`r8p-run.sh` (procedure harness, rerun at `74f7694f`) and `tests/deploy-web-unit.test.ts` (rerun at `6d0e75ad`); every executable the
operator runs is byte-identical across the three, so each result below holds for the delivered head.

| Run | Revision | Caller exit | Decisive output | Record |
|---|---|---|---|---|
| Verify harness `r7v-run.sh --verify-rev`, DEV containers, real `offhost-pull.sh` over rsync/ssh | `67c80882` | 0 | `R7 VERIFY HARNESS RESULT PASS` (14 scenarios); m: `m2-preplaced:END-rc0,HELD,no-RECEIVED->STOP m3-other-dump:RECEIPT-for-…022700.dump-only->STOP m4-partial:END-rc1,no-RECEIPT->STOP m4-retry:…G0-STOP(failed-0310-run) m1-genuine:RECEIVED+RECEIPT->PASS`; n: `candidate-g0:exit3,no-verdict candidate-version:exit3,no-verdict gate-on-candidate:NO-GO old-export:STOP(qualification=none) pinned-export:G0-PASS checker-pin-C1:PASS checker-pin-C0:FAIL checker-production-fixture-pin:FAIL production-on-fixture-pin:refused(no-ssh)`; residue 0 containers | `evidence/r7v-t67c80882/` |
| Procedure harness `r8p-run.sh --verify-rev` (OWNER-PROCEDURE command blocks extracted from the revision) | `74f7694f` | 0 | `R8 PROCEDURE HARNESS RESULT PASS` (48 scenarios); `access-change-saved-void` and the reviewer's F1 sequence `access-change-all-saved-void`: `got=exit 1 failed=verdict,access` (4.4–4.6 and the gate verdict all one epoch, the confirm another); `access-change-fresh-blocked`: `OWNER CHECKS RESULT BLOCKED fail=B1,B2,B3 … failed=owner-checks,version,verdict,access` | `evidence/r8p-t74f7694f/` |
| Phase 4 harness `p4-run.sh` (clean worktree at the revision; SHA256SUMS `afldb-phase4.sh: OK`) | `74f7694f` | 0 | `R10 PHASE4 HARNESS RESULT PASS (26 of 26 scenarios; residue 0 containers, 0 images, 0 workspaces)` | `phase4/evidence/t74f7694f-*` |
| `vitest run tests/deploy-web-unit.test.ts`, streamanator, disposable `git archive` workspace, Node v22.23.2 | `6d0e75ad` | 0 | `Tests 46 passed (46)` (receipt cases: genuine, pre-placed, different dump, partial failure and retry, leftover partial, fd 3 only) | `evidence/vitest-6d0e75ad/` |
| Gate checker suite `test-gate-accept-r10.sh` (local) | checker `1b3f7d65` | 0 | `GATE ACCEPT TESTS RESULT PASS cases=76 pass=76 fail=0` (h1 is the reviewer's sequence: `failed=access`) | `accept/evidence/`, `evidence/local-gate-accept-76.txt` |
| Wrapper suite `r10q-wrapper-test.sh` (local) | `67c80882` bytes | 0 | `R10Q LOCAL RESULT PASS (45 tests)` | `evidence/local-r10q-wrapper-45.txt` |

The first vitest attempt at `74f7694f` used DEV's default Node v18 and failed at startup (`node:util` has no `styleText`); with
Node 22 one case failed because the fixture source kept a dump the destination had pruned, so the pre-placed run genuinely fetched
it again (a correct receipt, a wrong fixture). `6d0e75ad` trims the fixture source as production's own retention does. The first
procedure-harness run at `67c80882` failed `wrapper-g0-post` only: the new confirm call had been placed between the G0 call and its
assertion; `74f7694f` moves it after. Neither involved a change to an executable the operator runs.

**Not verified:** anything in production; a real off-host endpoint (none is qualified); the dated window after 2026-11-29 (F3);
Astra's verdict on this head.
