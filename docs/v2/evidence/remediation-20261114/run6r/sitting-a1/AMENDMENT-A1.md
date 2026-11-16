# Packet 6R sitting — Amendment A1 and pre-execution review (2026-11-16)

Prepared 2026-11-16 by Claude. **No production contact.** DEV contact was limited to a read-only readiness check of the
P4 candidate checkout and to a disposable harness workspace (`/mnt/ssd/afldb-r6r-harness-20261116`). That workspace was
removed afterwards. The candidate is still at `f6af6da9` with porcelain 0, and port 61432 is still free. The production scope
and the window (Wed 18 Nov 2026, 10:00–12:30 AEDT) are unchanged.

## 1. Owner amendment (verbatim, 2026-11-16)

> I approve replacing the literal origin/main=a2e6ea99 check with this bounded amendment:
> - pin the full published preparation commit currently identified as 611630e4;
> - require the approved application revision a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5 to be its ancestor;
> - enumerate and review every intervening path and blob;
> - prove application, dependencies, build inputs and installed release tooling remain unchanged;
> - separately identify and qualify every operational script added under docs/;
> - fast-forward the production checkout only to the exact approved application revision;
> - refuse unexpected remote drift. Do not accept arbitrary future docs/ changes automatically.
>
> Record this amendment explicitly. Silence is not approval for other deviations.
>
> If review finds a material executable correction, qualify it and present its exact artifact hash and approval consequence before use.
> The existing production scope and window remain unchanged.

**Pin:** PREP = `611630e41f3f27391173615d961c0ab5e1ea7810` (published; `origin/main` = PREP; `a2e6ea99` is its ancestor).

**Implementation:**
- **P0 (workstation):** `ls-remote` must equal PREP exactly.
- **P1:** `ls-remote` must equal PREP exactly. This is read-only.
- **P2:**
  - after `git fetch`, `refs/remotes/origin/main` must equal PREP exactly;
  - `a2e6ea99` must be an ancestor of PREP, and `CP..PREP` must be 4 commits;
  - the sha256 of `git -c core.quotepath=true diff --raw --no-abbrev --no-renames CP PREP` must be `f449aa04346731c1b74cd1d7ca21c3117c16acf83b1598385baaebf84dc30157`. That listing is the reviewed 52 paths with every old and new blob id; the exact bytes are in `review/delta-CP-PREP.raw.txt`;
  - no path may lie outside `docs/`, `CHANGELOG.md`, `IssuesIndex.md` and `issues.md`;
  - then `git merge --ff-only a2e6ea99…`, followed by `HEAD = a2e6ea99…`.
- **Refused:** every other remote state, including a later docs-only commit, origin/main at `a2e6ea99` and origin/main at `c34ae24d`. The harness shows each of these cases (§5).

## 2. Intervening paths and blobs (`a2e6ea99..611630e4`)

**Commits (4):**
- `9a68ad52` (packet 6)
- `15aa89cb` (6R artifacts and evidence)
- `c34ae24d` (packet 6R and trackers)
- `611630e4` (approval and sitting)

All four are records-only.

**Paths: 52 in total, 49 added and 3 modified.** The full list with blob ids is in `review/delta-CP-PREP.raw.txt`.

| Group | Paths | Nature |
|---|---|---|
| `CHANGELOG.md`, `IssuesIndex.md`, `issues.md` | 3 M | Tracker prose only. 28 lines added and 5 removed, no code |
| `run6/` | 7 A | Packet 6, its B1/B1a runbooks, public checks, and the withdrawn packet-6 SQL (`b1a-accept.sql`, `b1a-reverse.sql`) |
| `run6r/RELEASE-AND-REPAIR-PACKET-6R.md`, `SHA256SUMS` | 2 A | Packet text and its checksums |
| `run6r/b1a/` | 3 A | Runner `.mts`, accept SQL, reverse SQL (operational) |
| `run6r/b1a0/` | 2 A | DEV restore-verify script, parity SQL (operational) |
| `run6r/checksums/` | 5 A | Checksum evidence |
| `run6r/rehearsal/` | 13 A | 4 rehearsal host scripts and 9 raw outputs |
| `run6r/sitting/` | 17 A | `SITTING.md`, `SHA256SUMS`, and 15 blocks (operational) |

## 3. Application, dependencies, build inputs and release tooling are unchanged

1. **No non-docs code in the delta.** `git diff --stat a2e6ea99 611630e4 -- . ':(exclude)docs'` lists only the three tracker `.md` files. No path under `src`, `tools`, `deploy`, `packages`, `tests` or `public` is in the delta, and neither are `package.json`, `package-lock.json`, `next.config.ts` or `tsconfig.json`.
2. **The production checkout never receives the delta.** P2 fast-forwards it to `a2e6ea99` exactly and asserts `HEAD = a2e6ea99`, so the files on the host are exactly `a2e6ea99`'s tree. Separately, P2 asserts that `c1c4b22e..a2e6ea99` changes no migration and no lockfile.
3. **The build reads only the pinned revision.** `release.mjs build` extracts its source with `git archive --format=tar <revision>` (`a2e6ea99:deploy/release.mjs:982-999`), and P7 passes `--revision a2e6ea99…`. Untracked files, including the B1a artifacts P3 copies in, cannot enter a release. `tsconfig.json` also excludes `docs/v2/evidence`.
4. **Release tooling runs from the checkout.** `deploy/release.mjs`, `deploy/post-install-check.sh` and `tools/maintenance/backup.sh` are executed from the checkout, so they are `a2e6ea99`'s files (P1 alone runs before the fast-forward, from `c1c4b22e`). Nothing installed outside the checkout is updated by the sitting.

## 4. Operational scripts under `docs/` in the delta, and their qualification

| Script(s) | Used at the sitting | Qualification |
|---|---|---|
| `run6r/b1a/b1a-repair-2026-r6r.mts` (sha256 `bcc41311…c32c`), `b1a-accept-r6r.sql` (`dc6211d7…3ec7`) | Yes, at P3, P5, P6 and R1 | Packet 6R rehearsal (`run6r/rehearsal/raw`: dry run, commit, ALREADY-APPLIED, REFUSED identity, concurrency) and hash pins. Unchanged by A1 |
| `run6r/b1a0/b1a0-parity.sql` (`7c2a7be0…fcf5d`), `b1a0-dev-restore-verify.sh` (`3ec8fd20…67cf`) | Yes, at P3 and P4 (DEV) | Packet 6R option-A rehearsal (`rehearsal/raw/opta*.txt`) and hash pins. Unchanged by A1 |
| `run6r/b1a/b1a-reverse-r6r.sql` (`e8343ae6…16f3`) | Copied into `$A` only, never invoked | Database reversal stays separately gated |
| `run6r/sitting/*.sh` (15 blocks) | **Superseded by `sitting-a1/*.sh`** | This review (§5) and the harness (§5.2) |
| `run6/b1a/b1a-accept.sql`, `b1a-reverse.sql` (packet 6, withdrawn) | Never | Not referenced by any A1 block (grep) |
| `run6r/rehearsal/host-scripts/{case,opta,probe,rehearse}.sh` | Never (rehearsal only) | Not referenced by any A1 block (grep) |

## 5. Independent review, focused checks and corrections

### 5.1 Independent review

An independent reviewer read all 15 blocks, their transport, and the tooling they call, without running anything. It found:
- no CRIT;
- one HIGH, which is an operator constraint rather than a code defect: corrected blocks cannot be published before the sitting without moving `origin/main` off the pin;
- five MED executable corrections;
- several LOW items.

It confirmed the following as sound:
- `bash -s` transport and the `main … < /dev/null` pattern;
- every `release.mjs` flag used;
- the `RELEASE READY` id parse;
- `git archive` build isolation;
- promote and rollback link logic;
- backup `--dir` / `--keep 1000` behaviour;
- port 61432 and the VERDICT string;
- `rmdir -p` cleanup.

| # | Grade | Finding (original block) | Disposition in A1 | Harness evidence (orig → A1) |
|---|---|---|---|---|
| R-0 | HIGH (constraint) | Publishing corrections would move origin/main off PREP | A1 stays **unpublished** and is used from the workstation, hash-pinned. The pin stays `611630e4`. A1 is recorded in the post-sitting records commit | — |
| R-1 | MED | `p3:25` guard is an `&&` list, so a wrong HEAD or dirty tree does not stop P3, which installs the runner and takes the dump | Three separate commands | `p3-wrong-head` and `p3-dirty`: orig takes the dump; A1 STOPs |
| R-2 | MED | `p2` cannot be re-run once its fast-forward has succeeded and a later line fails | Start HEAD of H0 or CP accepted; an existing empty `$A` accepted | `p2-status-fails-then-rerun`: orig refuses the re-run; A1 passes |
| R-3 | MED | P6 gates only on the runner's dry-run line. The verdicts of P3 BEFORE-CHECK and P5 are not persisted or required | P3 writes `$D/before-check.txt` and P5 writes `$A/p5-result.txt`; P5 and P6 require them. P5 also requires the literal `VERDICT-PASS` plus the P4-verified sha256, which must equal the production dump's | `p5-before-check-fail` and `p6-p5-notpass`: orig proceeds or commits; A1 STOPs. `p5-wrong-verified-sha` and `p5-no-verdict-arg`: STOP |
| R-4 | MED | P6 exits 0 with free text for every runner outcome | Single verdict. `P6 RESULT COMMITTED EXACT` exits 0. Anything else prints `P6 RESULT ATTENTION … run r1-state.sh STAMP probe` and exits 3. Cleanup still runs first | Runner exit 4 (twice), 3, 1, 2, and no OUTCOME line: orig exits 0 in all six; A1 exits 3 in all six |
| R-5 | MED | R1 does not show the persisted `dryrun.txt` / `commit.txt` OUTCOME after a lost session | R1 prints OUTCOME, exit and RESULT lines from the persisted records | `r1-probe`: orig does not show it; A1 shows `OUTCOME COMMIT-UNKNOWN` |
| R-6 | LOW | `p1:34`: a missing `tsx` still prints PASS | Two separate commands | `p1-no-tsx` |
| R-7 | LOW | `p5:24`: a missing H1/H2/H3 label passes vacuously | H1..H3 must be 32-hex | `p5-H-missing` |
| R-8 | LOW | `p3`: the dump's own 2026 rows are printed but not asserted | Asserted: `not_applicable 669`, `votes_non_null 0` | `p3-dump-pending` |
| R-9 | LOW | P9 `confirm` and R2 `verify`: S8's own `status --expect` lacks `--confirm-attended-restart` | **Operator note** in the SITTING P9 row. No code change, since `deploy/` is fixed at `a2e6ea99` | `p9-confirm` (flag reaches S7) |
| R-10 | LOW | P1 prints the next settle elapse but does not assert it | **Operator note:** if the `settle next` time P1 prints falls before 12:30 AEDT, tell the owner before P3. A settle during B1a fails safe (lock timeout, or a fingerprint DIFF), but it would cost the window | — |
| R-11 | LOW | `backup.sh` creates `$D` before `pg_dump`, so a failed dump blocks a same-STAMP retry | Accepted: a dump failure abandons B1a (packet 6R §4.2) | `p3-backup-fails` |
| R-12 | LOW | ERR trap is not inherited (`set -E`); a nested failure may lack a `STOP line` | Not adopted. A missing `RESULT` line is the stop signal; the harness STOP cases print it at parent level | — |
| R-13 | LOW | P7's 9-minute wait and P11's 30-minute single connection are silent and can be dropped by IPS/NAT | **Owner option** (§7), transport only | — |
| R-14 | LOW | P10 leaves its mode-600 cookie temp file if it stops midway (15-minute claim) | Not adopted | `p10-*` |
| R-15 | INFO | Never yet run on production: the acceptance SQL as the backup role, and `LOCK … SHARE ROW EXCLUSIVE` as the import role | Both fail safe: psql error at P3, or runner exit 2 at P5 | — |

### 5.2 Focused checks

**What ran.** Raw output is in `review/harness-raw-20261116.tgz` (sha256 `65f5aad7c89eb033730a9b09e0c5c41a5a0429db64c6714f4959773e041edbb4`), with summaries in `review/raw/raw-{orig,a1}/SUMMARY.txt`. The harness sources are in `review/harness/`. The checks ran on the DEV host `streamanator` (bash 5.2.21, git 2.43.0) on 2026-11-15 at about 23:55 UTC, against:
- a bare origin and a checkout cloned with `--shared` from the P4 candidate, plus a 468 KB bundle of `f6af6da9..611630e4`;
- unmodified blocks sent as `tr -d '\r' < block | bash -s -- args`.

**Substitutions, the only ones made:**
- the fixed host paths `/home/arm/…` and `/mnt/ssd/` are mapped to a per-case sandbox;
- `node`, `psql`, `pg_restore`, `systemctl`, `ss`, `pgrep`, `tmux` and `curl` are replaced by fixture stubs on PATH;
- `bash tools/maintenance/backup.sh`, `bash deploy/post-install-check.sh` and the P4 verify-script invocation are replaced by stubs;
- in P11 only, `sleep 600` becomes `sleep 0`.

Fixtures come from the packet 6R rehearsal raw output, with the production identity substituted.

**Results:**
- **Original blocks** (`../sitting/`): 88 checks PASS and 1 harness artefact (below). Every defect reproduction held: 9 defect cases and 4 "original accepts or lacks the check" cases. P6's free-text exit 0 was also reproduced for all six non-COMMITTED outcomes.
- **A1 blocks** (`./`): 98 checks PASS, 1 expected-state line, 1 harness artefact. The tested blocks are byte-identical to `SHA256SUMS` here; the hashes are printed in `raw-a1/SUMMARY.txt`.

**The two non-PASS lines:**
- **Expected state:** `p6-p5-notpass` reports "porcelain not empty". A refused P6 stops before cleanup, and the very next check confirms R3 removes the artifacts. That is the SITTING path (R3, then R1).
- **Harness artefact:** `p10-after-pass` reports "cookie never printed" in both sets. The match came from the stub call log appended to the raw file; the block's own output has 0 occurrences (checked).

**Coverage.** P1 through P11 and R1 through R3, including:
- **Git pin:** drift refused for origin at CP, at `c34ae24d` and at a future docs-only commit; dirty tree; wrong start HEAD; non-empty `$A`; bad STAMP. The delta hash computed with Windows git 2.56 matched under git 2.43.
- **B1a artifacts and backup:** artifact tamper; wrong dump database; backup failure.
- **P4:** rc 1 with a PASS line; VERDICT FAIL; sha, size and verify-script mismatches; port 61432 passed through.
- **P5:** fingerprint drift; runner REFUSED; no re-run of P5 or P6.
- **P6:** every runner exit code; acceptance query failure.
- **Build:** the P7 evidence string reaches `release.mjs` as one argument; P7b id parse; `BUILD_EXIT=1`; a log path outside the pattern; an existing tmux session.
- **Promote and post-release checks:** P8 gate refusal; half-switched promote; P8 re-run; wrong id; P9 confirm and S8 failure.
- **Recovery:** R2 links, verify and second-run refusal; half-promote refusal (the owner would need `--to`); R3 idempotence and an unrelated untracked file left in place.
- **Page and observation checks:** P10 selection order; fewer than 4 eligible paths; stale text; HTTP 500. P11 tick failures.

**Not exercised** (each rests on earlier evidence or is fail-safe):
- the real `release.mjs` and PostgreSQL (unchanged at `a2e6ea99`, qualified by T-2);
- the runner itself (packet 6R rehearsal);
- production's bash and git versions;
- ssh transport;
- the real `afldb-settle` timing.

## 6. Corrected artifacts and approval consequence

`sitting-a1/SHA256SUMS` (sha256 **`15aab2e5c46c5339dafdaf171922769185eeeede9a0907afd409019e416b4e66`**) lists the 15 blocks and `SITTING.md`:

| Block | sha256 | vs `../sitting/` |
|---|---|---|
| p1-s1-precheck.sh | `47134e23ff05ede64a999224660c9c75c24e2030b511fe31536bff125b2d245a` | changed (pin, R-6) |
| p2-s2-ff.sh | `7ffda1b00c7b8a5abdeb93ebf67e35091b4190c060f0525f2cb2a08d07a6f9f4` | changed (pin, R-2) |
| p3-b1a0-dump.sh | `57c17feafbfa8fe1a1c6b2b44c1f3b3ff4e8f090c4f9d2cc75a804d8260bce80` | changed (R-1, R-3, R-8) |
| p5-b1a-dryrun.sh | `6b5e428ab4667859bc9cbf769575c373db771c2527cba93ef0ec6b9dce1afd4b` | changed (R-3, R-7) |
| p6-b1a-commit.sh | `963b2bbf5a4eb4922826e1a0213c5c46125c3d37ecdd9b16097654f6daa577d3` | changed (R-3, R-4) |
| r1-state.sh | `c0b471475bf2ca0cda38c603f3d1b9e4bf0d97e01da6f248854d519b4b948760` | changed (R-5) |
| p4, p7, p7b, p8, p9, p10, p11, r2, r3 | as in `../sitting/SHA256SUMS` | byte-identical |
| SITTING.md | `c6fdad840ea6f24b55e701946b1fdc052e580da576d3550b3c9a6f30abc9d316` | P0/P1/P2/P3/P5/P6/P9 rows, header, §2, §6 |

**Approval consequence.**
- **Covered by your amendment:** the P0/P1/P2 pin logic.
- **Not covered: R-1..R-8 in P1, P2, P3, P5, P6 and R1.** These are executable corrections to approved blocks, so silence is not approval. They need your explicit approval of `SHA256SUMS` = `15aab2e5…4e66` before the window.

**If you do not approve A1:**
- The amendment cannot be executed, because the original P2 accepts any later docs-only origin.
- The sitting would therefore STOP at P0/P2.
- Approving only the pin parts would mean a different set of hashes, which I would prepare on request.

**What A1 changes on production:**
- **New files:** P3 writes `$D/before-check.txt`, P5 writes `$A/p5-result.txt`, and P6 writes `$A/p6-result.txt`, all mode 600 and inside the directories already approved.
- **One argument change:** P5 now takes `STAMP VERDICT-PASS <dump sha256>`.
- **Nothing else:** no new production operation; database, release, backup and rollback scope are unchanged.

## 7. Open owner decision (optional, transport only)

**R-13: SSH keepalives.** Should P7 and P11 be sent with `-o ServerAliveInterval=30 -o ServerAliveCountMax=4`?
- No extra connections and no block change.
- **Default: no** (as written), unless you say yes.

## 8. Final immutable preparation pin

`origin/main` = **`611630e41f3f27391173615d961c0ab5e1ea7810`**. The production checkout is fast-forwarded only to `a2e6ea9995a44b6d5b7de7e820d17bb2e14986b5`.

A1 is unpublished workstation material in `D:\dev\afldb-rem-20261114\docs\v2\evidence\remediation-20261114\run6r\sitting-a1\`, pinned by the `SHA256SUMS` hash above. It is committed and published only in the post-sitting records commit, after the sitting's P2 has passed.
