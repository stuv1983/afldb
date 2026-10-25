# ISSUE-316 activation-separation local gate (2026-10-25)

Candidate: **`c438f8449e65c28cf9f00879aaa045131b5f0d3a`**, accepted unchanged.
Structural gate: **CLOSED / ACCEPTED**.
Evidence/tracking commit: **`def676517da3955aa18db3606785463aac464188`**.
[Closure receipt](STRUCTURAL-CLOSURE.json).
U3 **CONFIRMED**; U4 **Route B**; Brownlow untouched; production **NO-GO**.

## Execution guard and accepted validation

- Operator cleanup only. Do not remove unknown temp files, retained evidence, repository content or active session state.
- Require at least **5 GiB (5,368,709,120 bytes) free on C:** immediately before the final run. This is an execution guard, not a product requirement.
- Final run preflight: **91,465,203,712 bytes (85.183609008789063 GiB)** free on C: at `2026-10-25T03:14:27.4909068Z`.
- TEMP and TMP remain `C:\Users\stuar\AppData\Local\Temp`; `CLAUDE_CODE_TMPDIR` is unset. Do not redirect them.
- Required command: `npx vitest run tests/db-test-rebuild.test.ts tests/afl-api-cutover.test.ts`.
- Require exit 0, no ENOSPC/infrastructure failure, expected skips only, no assertion modification. An actual assertion failure stops closure for investigation.
- Accepted after F3: `tests/season-rollover.test.ts` **393/393** and `npm run typecheck` **exit 0**; no repeat solely for this gate.
- Earlier **1,539 passed / 5 skipped** remains supporting evidence. ENOSPC is environmental; the D:-temp path failure is diagnostic, not a product regression or gate-closing result.

**Final focused gate PASS (2026-10-25): 1,539 passed / 5 skipped / 0 failed,
exit 0**, 2 files, 1,544 tests, 68.27 s. The five skips are the established
Windows limitations (three rebuild cases and two POSIX signal cases). No
ENOSPC or infrastructure error occurred in the accepted run. TEMP/TMP were both
`C:\Users\stuar\AppData\Local\Temp`; `CLAUDE_CODE_TMPDIR` was unset.
No source/assertion modification was made. [Preflight](FINAL-VITEST-PREFLIGHT.json),
[output](FINAL-VITEST.log), [exit](FINAL-VITEST.exit.txt).

Two preliminary launcher/environment failures are not PASS evidence: PowerShell
refused `npx.ps1` before Vitest started; then the restricted sandbox run returned
1,518 passed / 5 skipped / 21 failed, exit 1, with the documented Node/tsx
`uv_os_get_passwd` ENOMEM startup failure. A standalone `os.userInfo()` probe
failed in the sandbox and passed outside it. The accepted exact command used
the normal `cmd.exe` launcher outside the sandbox, with no execution-policy or
environment redirection. No implementation change was needed.

## Canonical committed activation evidence

[COMMITTED-EVIDENCE.json](COMMITTED-EVIDENCE.json) identifies the full candidate,
parent, exact 14-file committed inventory, Git blob IDs (object identity) and
SHA-256 of exact committed blob bytes (materialised bytes without checkout conversion).
[SHA256SUMS](SHA256SUMS) labels those meanings separately from the materialised
[canonical patch](activation-separation.patch). The patch is the exact complete
parent-to-candidate diff, including original evidence files as committed.

Isolated alternate-index/object-store application reconstructs committed tree
`51543a0b0c6c49f5b9c75320d3e2aabcef44616c` exactly. Regeneration explicitly sources Git attributes from the candidate commit; later
repository metadata cannot change its diff representation. The real checkout/index and candidate
commit are unchanged. All candidate hashes and the retained canonical patch verify.

Earlier working-tree/CRLF-derived evidence: **SUPERSEDED ? NOT CANONICAL**.
Its exact original committed bytes remain in [legacy-c438f844](legacy-c438f844/README.md),
and are also embedded in the canonical complete diff. They have not been edited or hidden.

## Frozen U3 evidence and admission

[Current navigation and preservation classification](../AFLDB-ISSUE-316-u3-correction-20261024/EVIDENCE-NAVIGATION.md)
lives outside the frozen snapshot. Both files added by Codex inside the snapshot
were withdrawn; no pre-existing frozen snapshot bytes were changed.
Directory-local `.gitattributes` files are **later repository metadata**, never
original execution evidence or historical manifest members.

The activation evidence attributes classify archival patch files as byte data
(`-diff`) because their nested historical diff context contains whitespace.
The patch bytes are preserved, and SHA-256 plus exact tree reconstruction validate
them. `git diff --check` passes with that explicit archival-data classification;
ordinary documentation/source checks remain active.

[Original admission audit](IGNORED-U3-ADMISSION.json) retains its pre-admission
state. The later [admission manifest](U3-ADMISSION-MANIFEST.json) is current:
**62 examined, 42 admitted and force-added, 20 excluded**. Immediately before
adding, the original admission-list hash, all 42 paths, reasons, sizes and hashes
were reverified; the Git index then contained exactly those 42 files. Each
candidate retains its inclusion reason and historical manifest/inventory or
canonical narrative reference. No historical execution log was regenerated or edited.

**`PRODUCTION_CREDENTIAL_EXACT_BLIND_SCAN=PASS`**, and structural scans PASS, for
candidate inventory SHA-256
`5e90c8e7d7cdde45e0f91c3f4ab0421e70ffcffa770a9f45837ef9d46c8ff2bc`.
The [scanner](blind-credential-scan.cjs) used a fresh random comparison key over
the existing authorised SSH path. The host alone read the protected DSN; only
transient keyed HMACs and lengths returned for byte-substring comparison of raw
and URI-encoded forms. No DB connection or census occurred. The process
discarded the key, digests and lengths; none is retained. The credential never
left production. The obsolete failed synthetic log remains excluded.

[Hash audit](U3-HASH-AUDIT.json): all v2/v3/v4/v5 package manifests (24/46/40/43
members) and bound final validation/production evidence inventories pass.
Three older narrative entries do not match their later-edited records:

- `SHA256SUMS`: `METADATA-REPAIR-V4-RECORD.md`.
- `SHA256SUMS.before-adjudication`: `RECORD.md`.
- `SHA256SUMS.before-metadata-review`: `RECORD.md`.

For each, [historical narrative drift](HISTORICAL-NARRATIVE-DRIFT.md) records the
hash-set filename, expected/current hashes, affected path, retained owner authority
for the later narrative update and unchanged immutable evidence. Classification:
**EXPECTED HISTORICAL VERSION DRIFT — point-in-time hash retained; narrative subsequently amended; not evidence corruption.**
Independent verification rehashed 771 entries across all 16 sets: 768 exact
matches and exactly those three narrative discrepancies. All immutable execution
evidence and current package/canonical inventories PASS. Old lists and narratives
were not rewritten. These three discrepancies are **not blockers**.

[Git materialisation verification](U3-MATERIALISATION-VERIFICATION.json): **296 files
byte-identical**, including all hash-listed files and the two unpinned original
discovery logs. This supporting proof establishes byte preservation through Git
materialisation; owner-adjudicated drift is documented separately.

## Completed closure and next phase

1. Disk guard and clean final validation **PASS**, as recorded above.
2. Historical drift documented and credential/admission gates PASS; all 42
   admitted disk/index hashes and the accepted blind-scan inventory reverified.
3. Current local link targets and worktree/index `git diff --check` PASS; zero
   excluded files staged. The evidence commit is complete; the index is now empty.
4. Separately authorized local evidence/tracking commit created without product
   edits, amend, squash, candidate recreation or push.
5. No substantive post-review product-code/assertion/activation/apply change.

Then automatically record **CLOSED / ACCEPTED**, without another owner decision
merely to close. Record implementation SHA and the separate evidence/tracking SHA.
The evidence/tracking commit is **`def676517da3955aa18db3606785463aac464188`**.
All required conditions passed; structural closure was automatic under existing owner authority.

[D/P proposal preparation](../AFLDB-ISSUE-316-dp-proposal-20261025/PROPOSAL.md)
is partial and not execution-ready. P is the evidence commit above; proposed D is
2026-10-27. Exact P DB-free matrix: 11,318 passed / 31 declared skips / 0 failed;
typecheck exit 0. The real local three-gate successor validation awaits access to
named retained inputs outside the repository; B/C restatement text previews are
prepared but require separate semantic reconciliation and validation.

After closure only, prepare the real production-window proposal: D, structural P
descended from the candidate, 7-file apply write set, transition and tuple hashes,
inactive/projected-active rebuild pins, activation/deactivation authorities,
migration binding, date-bearing material, old/new pins, semantic diff and full
required DB-free validation at P. Return D/P for owner adjudication **before**
any production census, native-policy proof window or enforced production dry run.

No production census, rollover/apply, successor activation, deployment, disposable
rebuild or push. Apply and activation remain separate approvals.

Current session changes are listed in [SESSION-CHANGES.json](SESSION-CHANGES.json).
The bounded [current verification record](CURRENT-VERIFICATION.json) retains
scope and limits. [Final reverification](FINAL-REVERIFICATION.json) binds the
admitted hashes, blind-scan inventory, canonical blobs, links and diff checks.
