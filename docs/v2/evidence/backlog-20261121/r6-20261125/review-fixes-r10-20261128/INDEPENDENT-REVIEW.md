# R6 r10 independent review (28 November 2026)

**Reviewer:** a separate agent session (model Fable), given the code paths, the operator documents and Astra's four questions, and
not the author's conclusions. Read-only: it ran no harness, contacted no host and wrote nothing in the repository. **Judged
revision:** `07f05f3de7e6c9826d7af823977c73b2f945ce4a` (r10 round 1, the first tested revision). Its report is reproduced below
unedited, except that local workstation paths are shortened to `W` (the worktree) and `R` (`W/docs/v2/evidence/backlog-20261121/r6-20261125`),
as the report itself defines them.

## Disposition (r10 round 2)

| ID | Grade | Disposition | Where |
|---|---|---|---|
| F1 | HIGH | **Fixed.** The checker requires `--confirm`: a wrapper `version` call made after the gate verdict and at most 10 min before the check. Its authenticated production RESULT must be after the verdict, on the same boot, with the 4.5 bundle; its access epoch joins (f) whether or not the verdict passed. An access change at any time before the confirm call is `failed=access`. Residual, stated in the procedure: a change after the confirm call is outside what any saved transcript can show; the procedure acts on GO at once and every `afldb-phase4.sh` action prints VOID for an earlier GO. | `afldb-gate-accept.sh` (h); OWNER-PROCEDURE "Saved evidence" and checklist G; RUNBOOK G0; plan NG-PRE; local cases h1–h7 (h1 is the reviewer's sequence); DEV `access-change-all-saved-void` |
| F2 | MED | **Fixed.** The pin at `--pin-rev` must equal the pin at the checker clone's HEAD (the owner's current reviewed head), so a revoked or superseded pin fails with its old `--pin-rev`. | checker (g); OWNER-PROCEDURE "Saved evidence"; cases g10 (revoked), g11 (superseded) |
| F3 | MED | **Not changed: stated.** The 2026-11-24..29 window is r9's deliberate fail-closed dated gate (R9-F-7, QUALIFY-OFFHOST "Dated gate"). r10 does not widen a reviewed safety property inside a review round. QUALIFY-OFFHOST now says plainly that §3a/§4 cannot be completed in production with these bytes and that a reviewed re-dating (with the offset handling, `g0-core.sh` and the digests) must come first. | QUALIFY-OFFHOST "Dated gate" |
| F4 | LOW | **Stated.** The checker binds the pin's bytes; that the wrapper ran from an unedited export of that commit is the owner's procedure step (QUALIFY-OFFHOST §4 step 7), now said as such in OWNER-PROCEDURE. | OWNER-PROCEDURE "Saved evidence" |
| F5 | LOW | **Fixed.** rsync runs with `--whole-file`, and a dump that was present before the run, as a file or as a partial under `.rsync-partial`, gets no receipt ("not a receipt: … was here before this run"). | `offhost-pull.sh`; vitest (leftover partial) |
| F6 | LOW | **Fixed.** `offhost-pull.sh` writes the machine-readable `RECEIVED` record to fd 3, which rsync and ssh never get (`3>&-`); the daily wrapper reads receipts only from fd 3, never from the mixed output. | `offhost-pull.sh`; `afldb-offhost-pull-daily.sh`; vitest (fd 3) |
| F7 | LOW | **Fixed.** A FAIL or REFUSED apply/back-out prints `HAND: … run afldb-phase4.sh invalidate --reason …`; the back-out FAIL bullet says to record the hand change with `invalidate`. | `afldb-phase4.sh` `finish`; OWNER-PROCEDURE back-out |
| F8 | INFO | **Stated.** A selected sudoers file without a final newline gets one from apply; back-out restores the original bytes exactly. | r10 README case 4 |
| F9 | INFO | **Fixed.** VERIFIED wording replaced by RECEIVED/HELD/END/RECEIPT. | QUALIFY-OFFHOST §3, §5; wrapper comment |

## The report (verbatim)

Method: read-only inspection of the worktree. No tests, harnesses or git commands were run; the only commands were
`cat`/`sed`/`grep`/`ls`/`sha256sum`. `sha256sum verify/bundle/SHA256SUMS` equals the wrapper's `BUNDLE_SHA` (059f2ad4…), and
`sha256sum -c` on the bundle reported no mismatch. Claims about rsync internals (F5, F6) are reasoned from the script, not from
running rsync.

| ID | Grade | Q | file:line | Sequence | Why it works | Suggested fix |
|---|---|---|---|---|---|---|
| F1 | HIGH | 3 | `R/review-fixes-r9-20261128/accept/afldb-gate-accept.sh`:211-228, 248-261; `R/review-fixes-r8-20261128/OWNER-PROCEDURE.md`:452; `W/docs/v2/evidence/release-17822b29-20261124/RUNBOOK.md`:234; ATTENDED-PLAN NG-PRE row :340 | 10:30 4.4–4.6 saved (epoch E1); 10:40 gate call PASS saved (E1); 10:45 Phase 4 back-out or `invalidate` writes E2 and prints VOID on the console; 10:50 owner runs `afldb-gate-accept.sh` on the four saved files. | The checker is offline and only compares the four inputs with each other. All four carry E1, the boot is unchanged, and it is inside 3 h / 1 h, so it prints `GATE ACCEPT … GO access-epoch=E1`, exit 0. The texts say the checker answers `failed=access` for "any access change after 4.4"; that holds only if at least one input postdates the change. Every e1–e9 test has a post-change input; none has all four pre-change. A GO printed before the change is likewise never revoked. | Require a fifth input: a `version` call made after the verdict (at > verdict at, same boot and epoch, within minutes of the check time), or have the checker make that call. Correct the three texts until then. |
| F2 | MED | 2 | `afldb-gate-accept.sh`:236-244; `R/review-fixes-r9-20261128/offhost/QUALIFY-OFFHOST.md` §4 step 4 ("the `--pin-rev` of every later release G0 acceptance") and "Revocation" | Pin committed at R1 and export `$V7` made. Later Q5 fails; owner deletes the pin at R2 as the Revocation text says. A later gate runs the wrapper from the still-present R1 export with `--pin-rev R1`. | (g) accepts any commit in the clone that holds a v1 pin whose hash equals `qual-sha256`. It never compares it with the clone's current reviewed head, so a revoked or superseded pin still gives `ACCEPT pin PASS` and GO. "G0 then STOPs again" is true only for an export of R2. | In (g) also require the pin blob at `--pin-rev` to equal the blob at the reviewed ref (e.g. `origin/main`), and fail if the path is absent there. |
| F3 | MED | text vs code | `R/review-fixes-r7-20261128/verify/afldb-verify-call.sh`:341 (`^2026-11-2[4-9]$`), :80 (`AEDT`); QUALIFY-OFFHOST §3a | Owner installs M, waits "one scheduled night", runs `candidate-g0 <YYYY-MM-DD>` (or later `g0 <date>`) for any date after 29 Nov 2026. | The date regex covers both `g0` and `candidate-g0` (line 326 maps to `g0`), so the call is a usage error, exit 2. No endpoint is qualified today (28 Nov), so the §3a to §4 sequence cannot complete in production with these bytes. Fail-closed, but the "no bootstrap loop" claim is not usable as written. | Widen the date check (derive the offset per date) in the reviewed wrapper before pinning, or state the limit in §3a. |
| F4 | LOW | 2 | `afldb-gate-accept.sh`:243; OWNER-PROCEDURE "Saved evidence" ("must have run from a `git archive` export of that commit") | Wrapper run from a working clone, or an export of another commit, whose pin file is byte-equal to the committed one; or the pin committed locally without the second reader. | Only pin bytes are bound. Wrapper bytes and "reviewed" are procedure; QUALIFY §4.7 admits this, but the checker's reason text and OWNER-PROCEDURE state it as enforced. | Wrapper prints its own sha256 in the header; checker compares with `git cat-file blob <rev>:<wrapper path>`. Soften the texts. |
| F5 | LOW | 1 | `W/tools/maintenance/offhost-pull.sh`:46-53 | An earlier interrupted or manual run leaves `.rsync-partial/<dump>`; the 03:10 run resumes it. | The receipt test is `bytes >= size`. `%b` includes token and protocol overhead, so a partial smaller than that overhead (roughly 0.01–0.05 % of the dump) still passes as "transferred in full". Content is still hash-bound. Unverified: reasoned, not run. | Add `--whole-file`, or refuse a receipt when a partial for that name existed before rsync. |
| F6 | LOW | 1 | `W/docs/v2/evidence/backlog-20261121/kits/afldb-offhost-pull-daily.sh`:44, 53; `offhost-pull.sh`:46-54; OWNER-PROCEDURE:481 (pull key sits in production arm's own `authorized_keys`) | The dump is already held on the off-host. Production arm (controls the sender) emits a line `…Z offhost-pull: RECEIVED <dump> sha256=<h> bytes=N size=N` on ssh stderr, or an rsync info message shaped like an itemise line. | The wrapper parses RECEIVED from `2>&1` output and the pull script trusts rsync stdout; both carry sender-controlled text. The re-hash limits this to turning HELD into RECEIVED for a copy that exists with the right hash; production arm cannot itself pre-place a copy. | Keep stderr out of the parsed stream; pass receipts by a separate fd or file. |
| F7 | LOW | 3 | `R/review-fixes-r10-20261128/phase4/afldb-phase4.sh`:394, 482, 484, 488; OWNER-PROCEDURE back-out bullet "FAIL … restore it by hand" | Back-out FAILs or REFUSES; owner restores sudoers or membership by hand as instructed. | The epoch is written once, before the change. The by-hand steps on the FAIL path carry no `invalidate` instruction (only the "manual equivalent" bullet does), so the access state changes under an unchanged epoch. | Print "then run invalidate" on every by-hand instruction; write a second epoch on completion or failure. |
| F8 | INFO | 4 | `afldb-phase4.sh`:328-330, 359 | A selected sudoers file has no final newline. | `awk … print` adds one, so "keeps every other line byte for byte" is not exact. Back-out restores the true bytes (`cat` copy). | Say so, or refuse such a file at entry. |
| F9 | INFO | text | QUALIFY-OFFHOST §5 first bullet; `afldb-verify-call.sh`:40 | — | Both still say the pull log's "VERIFIED" record counts; r10 code uses RECEIVED/RECEIPT. | Update the wording. |

Checked and found sound (no finding):

- **Q1:** pre-placed copy, different dump, rsync non-zero exit, timeout, manual run or retry, flock collision, missing sidecar and
  stale marker all end without RECEIVED/RECEIPT or with END rc≠0 (`g0b-core.sh`:108-131; kit :52-91). Injected OUTPUT lines cannot
  pose as BEGIN/RECEIVED (`$2` test).
- **Q2:** candidate modes never print `OWNER VERDICT` or exit 0, and their header fails `whdr`. Fixture format, production-stub,
  rehearsal transport and a missing pin are refused in production.
- **Q3:** epoch none, untrusted, malformed or missing is NO-GO; a skipped part is always an already-failed part.
- **Q4:** two grants with one selected, refused entry then retry, copied or moved directory, wrong seal, old attempt, re-apply, host
  changed before apply, and fresh-console back-out are all refused before mutation. Bytes, owner, mode and membership are restored
  and proven.

Verdicts:

1. **Possession as receipt: NOT DEFEATED.** Residual: tiny resumed partial (F5); sender-controlled text can relabel a copy already
   held (F6); the off-host pull log stays arm-written, as stated.
2. **Unpinned candidate authorising a gate: NOT DEFEATED for a candidate or fixture.** Residual: a revoked or superseded pin still
   passes with its old `--pin-rev` (F2); export identity and review are procedure only (F4); `candidate-g0`/`g0` stop working after
   29 Nov (F3).
3. **Invalidated evidence: DEFEATED (F1).** A complete pre-change set (4.4–4.6 plus verdict) still yields GO for up to 1 h after a
   back-out or `invalidate`; the texts claim the checker catches it. Residual: by-hand paths without an epoch (F7).
4. **Recovery on the wrong attempt or change: NOT DEFEATED.** Residual: trailing-newline byte claim (F8).

## Round 2 re-review (same reviewer, judged `67c80882c3caf3883ee037136da025404336c3a7`)

Read-only, as before; no git commands, tests or harnesses. Verdicts: **1 NOT DEFEATED, 2 NOT DEFEATED, 3 NOT DEFEATED for any
recorded change before the confirm call, 4 NOT DEFEATED.** F1, F2, F5 and F6 were judged closed with no new GO path (a confirm
cannot be replayed, taken from another run or skipped; the verdict-failed branch only names the epoch; fd 3 is closed for rsync and
its ssh child).

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| R2-1 | LOW | The RUNBOOK G0 row and the plan NG-PRE row printed the checker command without `--confirm` (usage, exit 2: fail-closed, but not runnable as written). | **Fixed in the pin commit** (text only): both rows now carry the confirm call and `--confirm`. |
| R2-2 | LOW | "HEAD" is whatever is checked out: a stale checkout at the revoked commit still passes the F2 check; the GO line records `pin-rev=` but not the HEAD compared. | **Residual, stated:** the procedure requires the current reviewed head checked out. Printing `head=` is a follow-up for the next checker revision (not made here, so the delivered checker is the tested one). |
| R2-3 | INFO | A change in the up-to-10-min gap between the confirm call and the check gives GO. | **Residual, stated** in OWNER-PROCEDURE "Saved evidence" and checklist G ("immediately", "act on GO at once"). |
| R2-4 | INFO | Sender text shaped like an itemise line can still mark a dump received, but only one absent before the run and present and hash-verified after it, i.e. one the run did transfer. | No change needed. |

Also noted: the `HAND:` line names `afldb-phase4.sh invalidate` without the `env -i …` prefix that the procedure's printed
invalidate command uses (the procedure text is the one to run).
