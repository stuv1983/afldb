# Rehearsal of the 17822b29 release scripts, 23 November 2026 (streamanator; disposable; production not contacted)

**Result: PASS.** Everything ran against script revision `58e35ce8805e9f559d3dd1008606f90efb84fbab`, from a clean `git archive`, and every check passed. Nothing touched production or beta.afldb.com. The full log is [rehearsal-20261123T1103Z.log](rehearsal-20261123T1103Z.log) (SHA-256 `c7e1a8988ccb6638d4dda1a2c45c0db2582bf9b3e521ad1f66171665fc31515b`).

## 1. Printed staging commands (workstation, 22:02 AEDT)

I ran the runbook §0 block verbatim: `git -C /d/dev/afldb archive …`, `mktemp`, `tar -xf`, `sha256sum -c SHA256SUMS`.

* All 12 files: `OK`.
* Manifest digest `b4e9e584ea47bfc3080cb7f336d50a417b4595a8b06beda93522eb6a0702d87c`.
* `r6-offhost-verify.sh` = `429eec29…cc18c`, the same as R6's reviewed pin.

## 2. Printed production transport against a non-production host (22:03 AEDT)

I sent every production script exactly as the runbook prints it: `tr -d '\r' < <script> | ssh.exe -o BatchMode=yes <host> bash -s -- <args>`. Two things differed from Tuesday:

* the host was streamanator, not `afldb`;
* `MSYS_NO_PATHCONV=1` was set for every line.

| Script | Exit | Output |
|---|---|---|
| G0 | 2 | `STOP not afldb-prod as arm` |
| P1, P2, P3, P3b, P4, P5, raw-head, P6 and both rollback modes | 2 | `STOP not afldb-prod as arm: refused` |

Afterwards there was no `/home/arm/r1-*` file and no tmux session.

**G0b through the real verifier.** I ran the staged `r6-offhost-verify.sh` over the same transport against Monday's real dump, `afldb_prod-20261123-022145.dump` / `3818c759…8fe1`. It exited **10**:

> `COPY-VERIFIED-ORIGIN-UNPROVEN` ("no wrapper invocation links to this dispatch")

That matches the recorded Monday result. Under runbook §4.1 this is a G0 FAIL, so it would defer the release.

Bytes the gate depends on, installed in `/home/arm/afldb-ops` on streamanator, each equal to its 17822b29 file:

| File | SHA-256 |
|---|---|
| `scheduled-pull-evidence.sh` | `d7574254…` |
| `afldb-offhost-pull-daily.sh` | `2ebac1c0…` |
| `offhost-pull.sh` | `a3775aea…` |

## 3. Full harness (`rehearse.sh`, one connection, 22:03:41–22:04:45 AEDT)

Inputs:

* the archive of SCRIPT_REV, extracted and re-hashed on streamanator (12 `OK`);
* a bundle of 17822b29's history (SHA-256 `71af208e…d541`);
* a `node_modules` whose `package-lock.json` matches 17822b29's.

**Fixture.** The harness built the following, all disposable:

1. A disposable bare origin whose `main` is 17822b29, and a checkout on `main` reset to 7d92042f.
2. A sandbox release root holding three releases. Each carries the **real Git blob** of its revision's `deploy/server-cluster.mjs` (c8d4202a, 7d92042f and 17822b29) over a stub standalone server (`stub-server.cjs`). `MANIFEST.sha256` and `release.json` were made by the candidate's own `release.mjs` hashing (`make-release.mjs`).
3. A **systemd user unit of the production shape**:
   * base unit `WorkingDirectory` = the checkout;
   * drop-in `release-route.conf` setting `WorkingDirectory=<root>/current`;
   * `ExecStart=<node> deploy/server-cluster.mjs`;
   * `EnvironmentFile` = the checkout `.env`, with random rehearsal secrets that are never printed;
   * `AFLDB_WORKERS=2`.

Promotion and rollback used the **real `release.mjs`** (`--root <sandbox> --pid <MainPID> --skip-host-gate`).

| Section | What it proved | Checks |
|---|---|---|
| A | `bash -n` of every script and `node --check` of the browser runner. Each production script refuses off afldb-prod and writes nothing. S9 and the browser refuse their rehearsal seams against production. `serving_identity` is byte-identical in P1, P5 and rollback; `revalidate_ordinals` in P5 and rollback; `pick_overnight_dump` is identical to the reviewed R6 copy. | 28 |
| B, C | The checkout sits on `main` at 7d92042f. Both supervisor blobs match their pins and the MANIFEST lines. The P3b rule refuses a one-byte supervisor change and a wrong revision. `release.mjs verify` passes. | 7 |
| D | **P1 route check** passes: drop-in loaded, `WorkingDirectory=<root>/current`, relative ExecStart. **P1 identity**: the primary is in the 7d92042f release, supervisor `d82f24c4…`, workers 1 and 2, names 1/1. It refuses the 17822b29 pin. The supervisor log reads `serving build XWruOm_9nLCSMY8nGPqYU release 7d92042fd110-XWruOm_9nLCSMY8nGPqYU revision 7d92042f…`. Raw-head baseline and the P6 tick pass. | 6 |
| E | **P2 against the real Git**: an unexpected origin pin STOPs with HEAD unchanged. The correct pin passes every delta and tree pin and fast-forwards to exactly 17822b29. A re-run is idempotent. The 17822b29 revalidation CLI reaches the **old** cluster 2/2 with ordinals 1 and 2, so the season-only body is compatible. | 5 |
| F | **Promote**: the links switch, but before the restart the 7d92042f supervisor still serves. **Worker 1 killed**: the primary re-forks it inside the 7d92042f release, with ordinals 1 and 2. | 3 |
| G | **Restart**: the primary is in `releases/17822b29e6de-…` with supervisor `4e8ea9b5…`, workers 1 and 2, and log `… revision 17822b29e6de…`. P5 check 4 gives 2/2 (1,2). The raw-head check passes: titles, robots, winner, 14 badges, genuine 404s, sitemap codes, and the unaccepted-year control now 404, with `R6-NOTE none`. P6 tick and S9 pass (new build 200, old build 404). **Browser runner, headless, desktop + mobile: `VERDICT PASS 38/38`**, with 10 screenshots. | 8 |
| H | **Rollback**: the links switch back, but the 17822b29 supervisor serves until the restart. After the restart: the 7d92042f release, `d82f24c4…`, workers 1 and 2, log names 7d92042f. The revalidation is 2/2. The raw-head check `none` passes. The check with the unaccepted-year control **fails**, as it must, because the old build serves that year. S9 passes with the builds reversed. | 8 |
| I | **Drop-in removed**: the P1 route check refuses, and after a restart the primary runs in the **checkout**, which P1 identity refuses. With the drop-in restored, the release supervisor serves again. | 3 |
| J | Rule fixtures. The revalidation rule refuses 1/2, ordinals (1,3), an INCOMPLETE line and exit 1, and accepts (2,1). The G0 pick accepts a unique attributed dump. It refuses a journal naming another digest, a missing journal line, and two same-window dumps. | 9 |
| K | **R6 amendment**, testing the exact gate lines as files. The amended pre- and post-verify admit `17822b29e6de-*` and `7d92042fd110-XWruOm…`. Post-verify still admits `c8d4202a…`. Pre-verify refuses `accepted` with `c8d4202a…` and refuses a foreign id. The reviewed originals refuse `17822b29e6de-*`, which is why the amendment is needed. The original pre-verify admits the rollback target, so rollback or deferral needs no amendment. | 10 |

Cleanup ran on exit: the unit was stopped and removed, `daemon-reload` was run, and the workspace was deleted. Afterwards I removed the transfer directory, then confirmed there was no `/home/arm/r1-*` file and no `afldb-r1*` unit.

## 4. Defects the rehearsal found (fixed before SCRIPT_REV)

The first shakedown, from a working-tree tar, found two defects:

1. **Host guards did not stop under `set -e`.** The guard `[ "$(hostname)" = afldb-prod ] && [ "$(id -un)" = arm ]` did not stop the script: `set -e` ignores a failure on the left of `&&`. That affected P2, P3, P3b, P4, P5, raw-head, P6 and rollback.
   * The shakedown's guard test of `r1-rawhead.sh baseline` therefore ran on streamanator. It made loopback GETs to the DEV app and wrote `/home/arm/r1-rawhead-baseline.json` there. That file held titles and status codes, no secrets, and I removed it.
   * The fix is `{ [ … ] && [ … ]; } || { echo "STOP not afldb-prod as arm: refused"; exit 2; }` in every script, and the rehearsal now asserts that the guard runs leave no file.
   * Sunday's `a1-*` scripts use separate simple commands in P1 and are not affected there. They are not changed here.
2. Rehearsal-only bugs: a bare clone without `HEAD` on `main`, a function called inside `bash -c`, and a `grep -q` pipe under `pipefail`.

The second shakedown passed 86 of 87 checks. The one failure was the `grep -q` pipe, which I then fixed. The run recorded above is the third, from the committed SCRIPT_REV.

## 5. What the rehearsal does not prove

* **Production facts.** It does not prove any production fact: the real drop-in and unit bytes, the real InvocationID, the backup credential shape, `UNACCEPTED_YEARS`, or Tuesday's 03:10 evidence. P1 and G0 establish those on the day.
* **The Next.js application.** The stub stands in for `.next/standalone/server.js`. The served pages, cache behaviour and the real revalidation route come from the build and the independent review (runbook §1, §5.1), not from this rehearsal.
* **The real build and `post-install-check.sh`.** The rehearsal did not run `release.mjs build` or `post-install-check.sh`, because both need the production host or systemd. Sunday's A1 ran both successfully with the same tooling, and `deploy/release.mjs` and `deploy/post-install-check.sh` are unchanged between 7d92042f and 17822b29.
* **The headed browser.** The browser runner ran headless with a pre-minted cookie on streamanator. The owner's headed sign-in on the workstation (Node v26.13.1, Playwright 1.62.1) is exercised only on Tuesday.
