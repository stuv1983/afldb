# R6 r10: Astra's four acceptance cases on draft PR 5 (28 November 2026)

**Status: PROPOSED. Nothing installed. Production was not contacted. No live permission, host group, sudoers file, SSH key, endpoint
or infrastructure was changed. R6 stays NO-GO. PR 5 stays draft. Astra's verdict on the delivered head is pending.** Historical
sitting artefacts and the r7–r9 evidence are unchanged; r10 adds files and amends the operator documents in place, each amendment
labelled r10.

## Pins

@PINS@

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

@VERIFICATION@
