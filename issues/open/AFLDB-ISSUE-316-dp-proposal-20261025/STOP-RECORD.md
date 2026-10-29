# Offline D/P validation — STOP for owner adjudication

2026-10-25. **Proposal validation INCOMPLETE. Production NO-GO.**

D = **2026-10-27**, window **02:00–04:00 UTC**, and P =
`def676517da3955aa18db3606785463aac464188` remain proposal values. This record
does not reopen the CLOSED / ACCEPTED structural gate or grant execution authority.

## Passed retained-input and candidate checks

- [J2 integrity](validation/retained-J2-integrity.json): **167/167** members match the
  retained package's current `HASHES.sha256` (manifest SHA-256
  `6d61c1c3ca35d315226efd15af8142e9f180c68e400be7e450088d1aa0e45d82`).
- [Exact external input inventory](validation/external-inputs.json): **264/264**
  successor files match the hash-bound `scripts/stage/FILE_ORIGINS.json`:
  132 core CSVs, 130 ladder CSVs, and the two acquisition manifests. They were read
  from the exact `D:/tmp/afldb-i316-J2-20261023T2317Z/local/dryrun-2-pinned/`
  root named by retained `validation/dryrun-2-J2-pinned.log`, then copied byte-for-byte
  into the existing excluded source-P/B/C validation trees. No nearby directory was searched.
- Three retained `scripts/stage/census-afldb_{prod,dev,test}.json` files were consumed
  offline. Their 2026-10-23 observations are **expired**, confer no production freshness,
  and required no database contact. Their exact paths, timestamps and hashes are in the input inventory.
- [Real validator log](validation/retained-input-validator.attempt-3.log): **exit 0,
  3/3 gates**, all final pins match, **1622 → 1640**, **4** renumbered profiles,
  **91** final-check definitions. The CLI ran dry, using the unchanged P implementation
  and genuine Python validators. All **3,520 inventoried non-configuration files** in
  the isolated tree remained unchanged. The unused `.env.example` template was excluded
  from that inventory; no `.env` was present or consumed.
- [Candidate/state/authority reconciliation](validation/OFFLINE-RECONCILIATION.json):
  **7 apply writes**, rebuild file excluded; State B installed/inactive/rebuild-ineligible;
  projected State C resolves `c2-2026-successor`, 1,640 rows and 91 check definitions.
  No SQL checks or new database rebuild were executed.
- Both PROPOSED authorities still bind the exact change set, tuple, D, source P,
  simulated heads, migration set, and inverse inactive/active rebuild pins. The active
  rebuild bytes equal accepted J2. No authority/final/tuple/pin bytes needed changing.
  The prior simulation ancestry check is retained evidence; no fresh Git check is claimed.
- The J2 F-J05 addendum explicitly supersedes the older NOT-RUN records and records
  the completed historical disposable rebuild. Nothing inspected requires another rebuild.

## Stopping finding F-DP-01: State B restatement is materially invalid

[Broader State B results](validation/state-B-broader.exit.json): **2,956 passed /
7 skipped / 32 failed**, exit **1**, across the 14 test files in the existing
restatement plan. These numbers supersede no earlier State A or focused rollover result.

The unchanged B preview demonstrably mixes inactive B and adopted C assumptions:

- `restatements/state-B/tests/db-test-rebuild.test.ts.txt:238–251` expects the real
  inactive B tree to resolve and plan the adopted successor; it correctly refuses.
- Lines `259–267` construct `adopted()`/`variant()` from the same inactive real tree,
  so many mutation cases fail before reaching the condition they intend to test.
- Lines `273–278` reference **undefined `fabricated`**; two tests raise `ReferenceError`.
- Lines `5685–5692` again resolve the accepted successor against the inactive real tree.

These independent source/fixture failures establish a material B restatement failure.
The 32 failures also include child-process/credential-refusal runtime cases under the
validation guard. Their exact messages remain in the results; **not all 32 are classified
as application defects**. No assertion was changed, skipped or weakened to obtain a pass.

**Stopped after B. Broader State C was NOT RUN.** Prior focused rollover checks
(395/395 for each state) and the current C projection do not complete broader C validation.
The package cannot be returned as a finished, passed D/P adjudication package.

Owner adjudication is required before repairing the proposed B/C restatement material
and resuming the gated validation. The accepted implementation remains unchanged.

## Runtime and safety evidence

Two initial launch failures were Node/tsx `os.userInfo` ENOMEM in the restricted Windows
runtime, before any Python validator started. Logs remain retained; the successful
validator ran outside that restriction with the same offline input/candidate bytes.

Node socket connect/send operations were replaced by throwing guards; Python audit
hooks blocked socket connections. Database/libpq/credential environment variables were
removed from child environments. The successful validator's audit records three guarded
Python subprocesses and one blocked Node transport attempt. Its raw JSON says `STOP`
solely because the original harness additionally required **zero attempts**, despite
the CLI's exit 0 and all validator checks passing. The reconciliation preserves that
raw result and explains that a blocked pre-connect attempt establishes no connection.
The broader test audit is also retained. Guard instrumentation belongs only to this
proposal package; validators, product code and accepted assertions were not edited.

No production/configuration credentials were read. No production or database connection,
production census, native-policy proof window, enforced production dry run, apply,
activation, deployment, disposable rebuild, Git command or push was performed.
External retained evidence was read-only and re-verifies unchanged.

Standing: structural gate **CLOSED / ACCEPTED**; U3 **CONFIRMED**; U4 **Route B**;
Brownlow **untouched**; ISSUE-316 **OPEN**; production **NO-GO**.

## Subsequent owner ruling and repair

The owner accepted this STOP and classified the original B result as a D/P proposal
restatement defect. Proposal-only repair was authorised without reopening the
structural gate or repeating accepted J2 proof. Final broader B 2966/7/0,
broader C 2992/7/0, focused B 395/0/0 and C
396/0/0 all exit 0. Fresh read-only review GO, no stopping
findings. [Current proposal](PROPOSAL.md), [repair record](restatements/REPAIR-RECORD.md),
[review](validation/restatement-repair/REVIEW.md). The earlier text/results above
are preserved historical evidence. D/P adjudication remains the owner's decision;
production NO-GO.
