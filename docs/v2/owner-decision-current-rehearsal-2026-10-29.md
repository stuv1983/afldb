# Current-production rehearsal acceptance — 2026-10-29

**Result: three archive-bound decisions APPROVED as migration evidence for archive `a4641ca0…` only, and bound
in code as a second, explicitly selected acceptance binding.** The binding has not yet been run over the
retained host evidence, so no measured acceptance report exists for this archive (§5). **Production remains
NO-GO.** The privileges integration suite stays 42/43; that failure is not waived.

Provenance: explicit owner instruction in the Claude Code session dated 2026-10-29, repository
`D:\dev\afldbV2`, branch `v2/rebuild`, starting HEAD `df7a8229918b55f10c081137b54344806ba2910e`. Only
untracked `.codex/` existed and nothing was staged; both were preserved. This records the approval of the
exact proposal in [the follow-up record](current-production-shadow-followup-2026-10-29.md) §9.

## 1. Owner approval, verbatim

> I approve the three decisions exactly as scoped in §9 of:
> docs/v2/current-production-shadow-followup-2026-10-29.md
>
> - D-V2-CURRENT-REHEARSAL-1
> - D-V2-CURRENT-SCHEMA-1
> - D-V2-BROWNLOW-ALT-3
>
> These accept migration evidence for archive:
> a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc
>
> They do not grant production release, schema/grant changes, Brownlow publication or live operational acceptance.
>
> I accept the recorded evidence limitations:
> - The older archive's full row-level drift was not measured; the aggregate +18 rows remain unattributed.
> - Existing stored ACLs were compared, but complete ownership and production effective permissions were not.
> - PUBLIC EXECUTE on the receipt function is explicitly disclosed.
> - No complete end-of-run data remeasurement was performed.
> - Identical stored Brownlow reports are migration-preservation evidence, not authentic API reconciliation.
> - The permissions suite remains 42/43, with the absent staging default privileges unresolved. This failure is not waived.

The same instruction authorises local inspection, editing, focused command execution, one focused
independent review, selective staging and local commits. It prohibits repeating the capture, shadow run or
follow-up, and any new production access, deployment, push, rebuild, activation/deactivation, production
database mutation or credential change. EXEC, frozen P/H, authorities and retained evidence are preserved.
Source ISSUE-327 stays parked.

## 2. Recorded decisions

| Identifier | Exact decision (follow-up §9) | Production execution |
|---|---|---|
| D-V2-CURRENT-REHEARSAL-1 | Accept this archive's **migration-only** compatibility, baseline 110 through exactly 111–117, as backend migration evidence. Not operational acceptance | None |
| D-V2-CURRENT-SCHEMA-1 | Accept **only** two deltas for this archive. **116:** the receipt table, `refuse_brownlow_receipt_mutation()` and `brownlow_receipt_immutable`, with an owner-only table ACL, no table privilege for app/import/auth, and the function's default ACL, which is PUBLIC EXECUTE (`proacl` NULL). **117:** the nullable `eligible` and its comment. The 111–115 additions stay with `V2_ADDED_TABLES`. All other definitions and relationships remain under strict comparison | Target-, revision- and window-bound schema installation approval still pending (A-REL) |
| D-V2-BROWNLOW-ALT-3 | For the unavailable staged comparator on this archive, accept as alternative **migration** evidence: complete raw-vote/audit preservation, identical 98-season stored reports, units 508/508, eligibility integration 47/47, and privileges integration 42/43 with one recorded FAIL (absent staging default ACLs), **not waived** | No API reconciliation, ingestion, correction or publication authority |

D-V2-FRESH-REHEARSAL-1, D-V2-FRESH-SCHEMA-1 and D-V2-BROWNLOW-ALT-2 stay bound to `7fefcd9b…` and are
unchanged. D-V2-STAGING-IMPORT-DEFAULT-1 and D-V2-STAGING-APP-DEFAULT-1 remain approved **policy** with no
execution authority. They are absent from captured production, and these decisions neither install nor
accept their absence.

## 3. Evidence binding (exactly as in follow-up §9)

| Item | Value |
|---|---|
| Archive / sidecar | `a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc` / `72f000462a2e7560afee97edf5598723a2ccfa45c9664e7d57ce7b62dddb57d4` |
| Run manifest | `ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75` (38 files). Its one disclosed live-log entry, `shadow.log`, is recorded as `12e4cf94…` and accepted only in its final state `99b6e575…` |
| Follow-up manifest | `30b1a2be9757dfca491aa6b72ade183e2237f90759babbbd6a705a950143d010` (61 files) |
| Ledger | Baseline 110, digest `789946fe734b23c32ec87e59e3b860877d31a4b32b561624bf1d88fb8f055153`, through exactly 111–117 with the seven `FRESH_ACCEPTANCE` canonical-LF checksums |
| Shadow source | `c478c31b2ad84719907e0372d1b94230d3a4c508`. The release candidate commit is named at A-REL |
| Measured bytes | `schema-sections.attempt2.json` `edb83b2a…`; `receipt-catalog.migration.json` `f1f951a9…`; `receipt-mutation.json` `93bca1f4…`; run `schema.diff` `b201707b…`; both stored reports `e2df67ae…`; `it-v2-brownlow-eligibility.json` `7935c56a…`; `it-privileges.json` `63c183be…`; `unit-focused.json` `92bcc392…`; `inventory-comparison.attempt2.json` `d00744c6…`; local `grant-exact.json` `4d41c280…` (full values in the code binding) |

## 4. Code binding

`tools/v2/fresh-rehearsal-acceptance.ts` now holds `CURRENT_ACCEPTANCE` beside the unchanged
`FRESH_ACCEPTANCE`. Both share the seven migration pins. Nothing was repinned from observed output: every
value is copied from §9 and checked against the committed record by a test.

- **Selection is explicit.** With no option the tool runs the original `7fefcd9b…` binding, and its checks,
  verifier and report shape are unchanged. `--binding D-V2-CURRENT-REHEARSAL-1` selects the new one.
  - The lookup reads own properties only, so an unknown name is refused (exit 3) before any evidence is read.
    That includes `constructor` and `__proto__`.
  - A substituted binding object with an approved name is also refused.
  - The bindings are deep-frozen.
  - Focused-check enforcement follows from the binding's own `focusedChecks`, and the verifier from a
    per-binding map. Neither falls back to the other binding.
- **Evidence verifier** (`verifyCurrentEvidence`), over the retained root's own layout (`xfer/`, `evidence/`,
  `followup/evidence/`):
  1. the seven migration checksums and the local `grant-exact.json`;
  2. both manifests by digest, then by line count, then every file they list. Only `shadow.log` may differ,
     and only as the exact disclosed pair;
  3. every measured result that the decisions name;
  4. the sidecar bytes and its `archive_sha256`, `observed_ledger_digest` and `archive_bytes` fields, against
     the archive's actual bytes and hash (`verifyCurrentCapture`).

  Every present file is checked. Any mismatch is FAIL, even if another file is missing. Missing files alone
  give INCOMPLETE.
- **Assessment.** The checks are the same as for `7fefcd9b…`:
  - preservation shows exactly the two approved findings;
  - existing rows are identical, the ledger is exactly +7 and the new tables are empty;
  - parity has only the receipt row-count failure, and Brownlow is `INPUT_MISSING`, never failed.

  ALT-3 adds the focused checks **exactly as measured**:
  - units 508/508 and eligibility 47/47;
  - privileges 42/43, with exactly the one staging-default case failing;
  - nothing skipped.

  Any other result is an unapproved difference: a pass of 43/43 counts too. The report carries
  `privilegesIntegration: FAIL, 42/43, waived: false`, `stagedBrownlowComparator: INCOMPLETE`,
  `productionOperational: INCOMPLETE` and `productionDecision: NO-GO` whatever the outcome.
- **Exit code.** It is 0 only when `migrationCompatibility` is PASS. Runner completion is never read as
  acceptance.

Regression coverage is in `tests/v2-shadow-parity.test.ts`. The real committed parity report and focused-check
results are used where they exist; the preservation snapshots are synthetic, because they are kept only on the
host. The cases cover:
- each binding accepts its own scope, and the new binding records the privileges FAIL unwaived;
- the default report's binding, schema, Brownlow and privileges fields, and its keys, equal the committed
  2026-10-21 report;
- unknown names, including prototype names, are refused;
- each archive is refused under the other binding;
- 20 refusals outside the approval: identity, source, baseline, migration range and file, integrity, schema,
  table, rows, the receipt table no longer empty, outputs, Brownlow, and each focused-check change, including
  privileges 43/43, a different failing case, a skipped test and absent results;
- the binding equals the committed manifests, sidecar and measured hashes;
- strict manifest-line verification, including the disclosed live-log pair and path traversal, and FAIL on a
  changed file even when another is missing;
- the verifier itself over the committed manifests and the committed subset of their files: INCOMPLETE without
  the host-only files. It FAILs on each of these:
  - a substituted manifest;
  - a changed listed file;
  - a non-final `shadow.log`;
  - a wrong archive;
  - a changed sidecar;
  - a changed migration.

  A positive PASS can only be shown with the host evidence (§8).

## 5. Not yet measured: the acceptance run over the retained evidence

The 2026-10-21 decisions were followed by a measured report
([`fresh-rehearsal-acceptance-2026-10-21.json`](evidence/fresh-rehearsal-acceptance-2026-10-21.json)). No
such report exists for `a4641ca0…`. The 38 run files, including both preservation snapshots, and the 61
follow-up files are retained only on streamanator. This session had no authority to read them there.

As a control, the tool was run locally with the new binding over the committed, sanitised subset. It reported:
- `evidenceIntegrity` INCOMPLETE;
- `migrationCompatibility` FAIL;
- `backendFunctional` INCOMPLETE and `backendAcceptance` FAIL;
- NO-GO, exit 1.

That is the truthful result for missing evidence; it is not a finding against the archive. The run that
measures this binding is the next decision (§8).

## 6. Validation (this session, Windows workstation)

| Check | Result |
|---|---|
| `npx vitest run tests/v2-shadow-parity.test.ts` | 201/201 (8 new cases, 30 with expansions). First run 197/197; re-run after the review corrections (§9) |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `npx eslint` on the two changed code files | exit 0 |
| CLI: new binding over the committed subset / unknown binding (`D-V2-NOPE-1`, then `constructor` after review) / default binding over a directory without evidence | exit 1 INCOMPLETE·FAIL·NO-GO / exit 3 refused / exit 1 INCOMPLETE·FAIL |

Not run: any database, Linux or host check. None was required for this offline change, and the measured run
is §8.

## 7. What remains before production (unchanged unless stated)

Gate numbers refer to the [release decision package](release-decision-package-2026-10-28.md) §1.

| Gate | Requirement | State |
|---|---|---|
| 5 | Archive-bound acceptance for the current shadow | **Decisions approved and bound in code.** The measured run over the retained evidence is still pending (§8) |
| 2 | Accept known residuals: 3 strict Gridley failures (V2-GAP-029, 149/99/50), lint debt, and `external-grids-import` NOT RUN (archive unavailable) | Owner decision pending. Recording a residual is not a waiver |
| 3 | Owner visual acceptance (V2-GAP-022); merge of `v2/rebuild`; exact execution commit and build hash; push | Pending |
| 8 | A-AFLT: AFL Tables timer and polkit retirement before A/B (V2-GAP-011/013) | Pending |
| 9 | Host prerequisites: Caddy, systemd, TLS and backup recovery routing | Pending |
| 6 | Window preflight; frozen non-pruning backup with off-host copy and proven restore; comparison with the accepted `a4641ca0…` shadow. Any drift means a fresh rehearsal and acceptance | Pending; window authority |
| 7 | A-REL: 111–117 plus **both staging default declarations**, and the target/revision-bound 116/117 schema approval; then A-ROLLBACK and A-GO | Pending |
| — | **Permissions requirement (unresolved, not waived):** privileges integration must reach 43/43 against the released state once the two staging defaults are executed under A-REL. Production effective permissions, role attributes and object ownership have not been compared | Open |
| 13 | Brownlow operations (V2-GAP-030/031) and authentic API vote-set, identity and leaderboard reconciliation before publication | Five later approvals; not a schema prerequisite |
| 10–12 | C3 inert units; C4/C4b/C5; ISSUE-229 B2 | Stages C/D only; C4 onwards needs 2027 data |
| 14 | Credential containment (C-CRED-1) | Hygiene; owner action |

## 8. Next owner decision (prepared): D-V2-CURRENT-ACCEPTANCE-RUN-1

**Purpose.** Produce the measured acceptance report for the approved binding. This is the counterpart of the
2026-10-21 report, so gate 5 rests on re-hashed evidence rather than on the record.

**Proposed decision (exact).** Authorise one offline acceptance run of `tools/v2/fresh-rehearsal-acceptance.ts
--binding D-V2-CURRENT-REHEARSAL-1`, at the local commit that recorded this decision, over a new restricted
local copy of the retained evidence:
1. **Read-only copy from streamanator.** Copy `/home/arm/afldb-v2-currentshadow-20261028T192336Z/evidence/`
   (the manifest and its 38 files) and `followup/evidence/` (the manifest and its 61 files) with `scp`. Use a
   new directory, `C:\Users\stuar\backups\afldb\current-acceptance-20261029\`, laid out as `evidence/` and
   `followup/evidence/`, with an ACL for the owner, SYSTEM and Administrators only, matching the archive set.
   Nothing is started, written or removed on streamanator, and production is not accessed.
2. **Archive files.** Copy `afldb_prod-20261028T192336Z.dump` and `.provenance.json` into `xfer/` of that
   directory from the existing restricted set `C:\Users\stuar\backups\afldb\current-shadow-20261028T192336Z\`.
   Check both against that set's `SHA256SUMS` first. The original set is not modified.
3. **Run.** From the repository root:

   ```
   npx tsx tools/v2/fresh-rehearsal-acceptance.ts --binding D-V2-CURRENT-REHEARSAL-1 <dir> <dir>\current-rehearsal-acceptance-2026-10-29.json
   ```

   Then check the output for sensitive content: no DSN, credential or raw row is expected. Copy it to
   `docs/v2/evidence/current-rehearsal-acceptance-2026-10-29.json`, record it, and commit locally. Do not push.

**Expected result:**
- `evidenceIntegrity` PASS;
- `migrationCompatibility` PASS with `reasons: []`;
- `backendFunctional` and `backendAcceptance` PASS;
- `originalStrict` and `recomputedStrict` still FAIL;
- `stagedBrownlowComparator` INCOMPLETE;
- `privilegesIntegration` FAIL 42/43, `waived: false`;
- `productionDecision` NO-GO;
- exit 0.

**Stop conditions.**
- Any copy that does not match its manifest entry, other than the disclosed `shadow.log`. That file must hash
  exactly `99b6e575e2c735caf41a0bb920b43cdb92a9518f29928490e3e7c1ffa4d745e8` against its recorded
  `12e4cf94…` line. So the copied `evidence/` must verify 37/38 plus that exact pair, and
  `followup/evidence/` must verify 61/61.
- An exit other than 0.
- A non-empty `reasons`.

Any of these is reported to the owner as found. Nothing is repinned, re-run with changed inputs or edited to
pass.

**Not covered.** Production access, writes on streamanator, cluster start, new captures or rehearsals,
deletion of the working copy (a later owner decision), push, deployment, any schema, grant or Brownlow action.

**Alternative, not recommended.** Running on streamanator itself would avoid copying the evidence. It would
need the reviewed tool installed beside a dependency tree on the host, and the private `c478c31b` copy must
stay unmodified.

Approval prompt, if accepted:

> D-V2-CURRENT-ACCEPTANCE-RUN-1 — APPROVED as prepared in docs/v2/owner-decision-current-rehearsal-2026-10-29.md §8.

## 9. Independent review and dispositions

The code, the tests and every record change were reviewed by one separate agent. It had no edit tools, was
given the code and the approval text rather than these conclusions, and wrote nothing.

It recomputed independently:
- every pinned value against §9 and the committed evidence: both manifests and their line counts, the sidecar
  and its fields, `grant-exact.json`, `shadow.log` and the measured files;
- the real parity and strict findings;
- the focused-check counts and the failing name;
- the known-gaps rows (35 / 19 / 16).

It also confirmed that the host layout matches the capture and follow-up scripts. It ran the suite (197/197)
and the typecheck (exit 0).

Result: **no CRIT or HIGH; two MED, four LOW and several INFO.** All are dispositioned before commit.

| Grade | Finding | Disposition |
|---|---|---|
| MED-1 | The known-gaps explanation was wrong: 023 was always counted, and the summary went stale when `58bd9e4c` closed 035 | Verified with `git show 58bd9e4c` and corrected. The count itself (35/19/16) was right |
| MED-2 | The §8 stop condition would fire on the disclosed `shadow.log` entry | The exception is written into §8: exact final hash, 37/38 plus that pair, 61/61 |
| LOW-1 | The verifier's manifest and measured-file steps were never reached by a test, because the archive was checked first. A test title said "manifest" for a sidecar case | Order changed so manifests and measured files come before the archive, and a mismatch is FAIL even when another file is missing. The archive step is split out as `verifyCurrentCapture`. Tests now reach every step over the committed manifests and subset, and the title is corrected. A positive PASS still needs the host evidence |
| LOW-2 | No test pinned the default report to the committed 2026-10-21 report | Added: binding, schema, Brownlow and privileges fields and the key set equal the committed report. The `shadow.log` final hash is pinned against the committed copy |
| LOW-3 | Plain-object lookup (`constructor`, `__proto__`), a fallback to the original binding's wording, dispatch by identity, unfrozen bindings | `Object.hasOwn` lookup, deep freeze, no fallback, dispatch on `focusedChecks` and a per-binding verifier map. Four refusal cases added, and the CLI was re-checked with `--binding constructor` (exit 3) |
| LOW-4 | Release wording: "both approved" for rows 4–5; the old go/no-go paragraph standing alone; gate 7 lacking the 43/43 requirement | Reworded row 4 text, added a superseded pointer, and added the unresolved permissions requirement to gate 7 |
| INFO | Exit 1 covers both FAIL and INCOMPLETE (unchanged; the report fields stay distinct). An exit-0 `backendAcceptance` PASS with `privilegesIntegration` FAIL is the intended ALT-3 shape. Identity rests on the verifier and the snapshot scope, and `c478c31b` is bound through the pinned `reviewed-commit.txt`. The historical inventory `issues/open/AFLDB-ISSUE-316-readiness-prep-20261025/P-SOURCE-HASHES.json` pins this tool's previous hash; no code reads it, and it is a frozen record of that date, not a constraint on this change | Noted; no change |

Re-run after the corrections (only the affected checks):
- the focused suite: 201/201;
- typecheck exit 0, and lint of both code files exit 0;
- the three CLI controls, with the same results as before.
