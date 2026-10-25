# ISSUE-316 U3: removal committed; required decision note missing

Original owner authorisation dated 2026-10-24 covered only removal of PMS **705437**, Brayden Fiorini
**2121**, match **17214**, Essendon **6**, through the audited Data Editor / Match Sheet,
with durable removal authority, explicit ISSUE-316 / ISSUE-255 decision note, normal derived
recomputation and preserved originating provenance. Current metadata authority and review outcome follow.

**Current state: CANONICAL CORRECTION ACCEPTED; READ-ONLY DERIVED/PERIOD/AGGREGATE CHECKS PASS.
AUDIT 94 NOTE MISSING; INDEPENDENT METADATA REVIEW NO-GO. U3 UNCONFIRMED; production NO-GO.**

## Conditional metadata-repair authority and independent review (current, 2026-10-24)

The owner authorised autonomous execution of the exact reviewed transaction after independent GO, with no further
approval round-trip if all gates passed. A fresh reviewer context returned **NO-GO**: the exact retained proposal
explicitly contains no executable production SQL, and its supporting package contains read-only verification
artifacts rather than a repair transaction. The required actual-SQL review cannot pass. See
[independent findings and reviewed hashes](METADATA-REPAIR-REVIEW-20261024.md).

No production connection, preflight, repair, rollback rehearsal or postcheck was attempted in this continuation.
No transaction was invented or substituted. Owner adjudication is required by the stopping-finding rule; U3's
conditional confirmation has not taken effect, and the next production-readiness decision was not advanced.
The original proposal, authorised note and raw evidence remain unchanged. This is an execution/audit-metadata
incident with unknown cause, not a proven application defect. U4 remains Route B; Brownlow untouched;
no restoration/repeated correction, census, seal/rollover, activation, apply, deployment, rebuild or push.

## Owner adjudication and completed read-only verification (previous checkpoint, 2026-10-24)

The owner accepts the canonical correction as successfully executed and classifies the missing note as audit metadata.
No restoration, repeated removal or Save is authorised. The additional read-only checks passed with no inconsistencies.
See [complete verification and limits](ADJUDICATION-READONLY-REPORT.md) and [metadata-only repair proposal](METADATA-REPAIR-PROPOSAL.md).
No supported audited metadata repair UI exists in the inspected scope; no production write was attempted.
Cause of missing note remains unproven. The later conditional authority and failed review gate are recorded above.
All historical STOP instructions below describe the prior ruling and are superseded only by the owner's latest scope;
all prohibitions on another canonical correction and all production NO-GO operational holds persist.

## Manual submission and failed postcondition (historical, before owner adjudication)

The operator prepared the vacancy for Fiorini, supplied the exact approved note in chat,
and was told to leave Save unclicked until the fresh gate passed. Supplying it in chat
did not establish that it was entered into the production form. The operator subsequently
reported the durable **Manual removal** decision. No Computer Use action submitted it.

Fresh read-only gate snapshot **11:26:57.564078Z** matched every required condition:
`afldb_prod`, OID 66668, system ID 7674454702926115004, retained PMS 705437 / player 2121 /
match 17214 / club 6, application 20834 / batch 32, unchanged retained values/provenance,
one canonical-only key (the target), zero missing baseline keys, 10,029 2026 rows and 24
Essendon rows. The script was SHA-256-identical to the accepted gate. It completed its
read-only transaction, ROLLBACK and completion marker. The PowerShell text pipeline then
appended a carriage-return-only line: bash line 80 returned 127 **after** the 79-line script
completed. This transport-wrapper error is retained, not described as a clean SSH exit;
the database preconditions themselves all passed. No repeat query was run to hide it.

The operator was told the full result and allowed to manually Save once. The committed
decision timestamp is **11:28:46.203865Z**. Read-only postcheck snapshot **11:30:11.345984Z**
ran with the same identity and read-only gate, explicit ROLLBACK, completion marker and
SSH exit **0**. Raw-byte stdin avoided the earlier PowerShell-added trailing line.

Observed production state:

- PMS 705437 and the player-2121/match-17214 key are absent. PMS total 695,499; 2026
  10,028; Essendon match 17214 23. Zero production-only and zero missing AFL Tables keys.
- All PMS IDs excluding the target match the fresh before fingerprint: no unrelated row
  removed or added. Every other 2026 PMS row, every 2026 `matches` row (official scores
  included), and application 20834 match their fresh before fingerprints exactly.
- Durable authority **93**, actor **1**, active `player_match_stats` / `lineup`, payload
  `{"present":false}`, stable key
  `2026|4|2026-03-28|Essendon|North Melbourne|afltables:players/B/Brayden_Fiorini.html`.
- Required edit audit **94**, actor **1**, `matches` / 17214 / `match_sheet`; its only
  player operation is `2121: {kind: remove}`, playersCount 46, scoreUpdated false,
  authority key matches record 93. **Its `note` is NULL, not the required approved note.**
- Fiorini career games 125 and `rebuilt_at` exactly equals the edit/authority transaction
  timestamp; 2026 season and club-season games are 2. These are recomputation evidence,
  not a completed independent reconciliation of every derived total for all affected players.

**STOP:** the required exact decision note is absent. Do not declare correction success,
confirm U3, retry the removal, resubmit the sheet or edit the audit/authority record.
The cause of the absent note is not established; no application defect is inferred.
Preserve the observed committed state and return to the owner for adjudication. Existing
removal authorisation supplies no authority for an alternative audit repair or another write.

Checks stopped on that failed condition. Independent full derived-total reconciliation,
separate period-score table before/after comparison and Brownlow round-vote table
before/after comparison are **not completed**. The earlier fingerprint wording about
period-score columns was too broad: it covers `matches` columns only, not separate tables.
No Brownlow write was requested or performed by Codex; the allowed UI operation was the
ordinary Match Sheet removal. No fresh Brownlow-table immutability proof is claimed.
U4 remains Route B. All census/seal/rollover/activation/apply/deployment/rebuild/push holds stand.

Evidence: `fresh-precheck-20261024T1126Z.{stdout.log,stderr.log,exit.txt,json}`;
`postcheck.sh`, `postcheck.{stdout.log,stderr.log,exit.txt,json}`;
`POSTCHECK-ASSESSMENT.json`, all bound by `SHA256SUMS`. The original 10:54Z evidence
and `DECISION_NOTE.authorised-pending.txt` remain intact; the note filename is historical
and does not imply it was persisted.

## Read-only precheck

Executed once against production, snapshot **2026-10-24T10:54:47.941754Z**:

- `afldb-prod`, `afldb_prod`, role `afldb_backup`, database OID **66668**, system ID
  **7674454702926115004**: matches the previously verified production identity.
- One `REPEATABLE READ READ ONLY` transaction, identity gate before data reads,
  statement/lock timeouts, explicit `ROLLBACK`; completion marker reached; SSH exit **0**.
- Row 705437 exists and its retained ordinary values/provenance fields match exactly:
  player 2121, match 17214, club 6, source 6, batch 32, source record
  `CD_M20260140305|CD_T50|CD_I993799`, jumper 8, career game 126, 21 zero statistics.
  The historical retained row omitted `brownlow_votes`; no historical comparison of that
  omitted field is claimed.
- Application 20834 still has the expected insert verb, source, batch, target key and
  insertion timestamp `2026-09-27T21:11:30.460661Z`.
- Exactly one canonical-only 2026 key, this target; zero AFL Tables staging-only keys.
- Counts: PMS overall **695,500**; PMS 2026 **10,029**; AFL Tables staging 2026
  **10,028**; Essendon match 17214 **24**.
- Re-read the retained frozen J2 CSV at the path in the prior baseline-comparison record:
  SHA-256 **79db69732ea1018b577e548622e6c702c1a79270478cc019dc80571fc217898f**, matching
  the established manifest binding. No new full CSV-to-production value-equivalence proof.

The script retains ordered database MD5 fingerprints of all PMS IDs excluding the target,
all other 2026 PMS rows, all columns of 2026 `matches` rows (official scores included, not separate period-score tables), and
application 20834. These are before-state comparison fingerprints; SHA-256SUMS binds the
evidence files. No after-state or successful correction is claimed.

The initial sandbox network attempt failed before connection (SSH exit 255). Its logs are
preserved separately. The authorised network escalation then ran the query above. No DSN
or password assignment appeared in the captured production output.

## Initial execution blocker and transaction state (before manual correction)

The initial browser inventory returned no apps or browsers. Attempts to open the production Data Editor
returned `Browser is not available: iab` and `Browser is not available: chrome`.

**2026-10-24 continuation (recorded 11:10Z):** the browser connector still returned an empty
inventory, but the installed Windows Computer Use helper exposed a targetable Chrome window.
The previously attempted `https://afldb.com/admin/data-editor` returned HTTP 404; its homepage
is the static coming-soon page. `docs/production-cutover.md` identifies the actual production
application as `https://beta.afldb.com`. Opening its `/admin/data-editor` redirected to
`https://beta.afldb.com/admin/login`, visibly requiring email, password and authenticator code.
Chrome is left at that sign-in page. Authentication is now the operational prerequisite;
the authenticated actor/capability and deployed workflow remain unverified. No credentials
were entered and no correction was submitted. The owner was asked to complete sign-in.

The owner explicitly reaffirmed the existing correction authorisation and accepted the
10:54:47Z precheck. It was not repeated during this continuation. Browser failures neither
invalidate that decision nor permit another write mechanism. Authorisation remains valid
until successful execution plus verification, a failed fresh precondition, or explicit owner
withdrawal. Immediately before submission, the fresh read-only gate must confirm the same
database identity, row 705437 / player 2121 / match 17214 / club 6, application 20834 / batch 32,
unchanged retained values/provenance, this sole production-only 2026 key and zero missing AFL
Tables baseline keys. Any difference stops submission for owner review.

The local workflow was inspected: `saveMatchSheetAction` requires `data.dataEditor`;
`saveMatchSheet` checks freshness, plans only changed rows, removes the specified appearance,
writes `data_overrides`, calls `recomputePlayerDerivedStats`, and writes `data_edits` in the
same transaction. An activity-audit warning can occur after that transaction commits.
Local source inspection does not verify the deployed version or an authenticated actor.

**No correction request was submitted. No mutation transaction, authority/audit write or
derived recomputation was attempted by this session.** There is no partial correction to
retry. Only the read-only transaction ran and rolled back. Post-correction verification
therefore did not run; Brownlow was not modified.

## Owner-directed split execution (historical, before submission)

The owner completed administrator sign-in. Computer Use observed the production Super admin
session, Data Editor access and the exact sheet at
`https://beta.afldb.com/admin/data-editor?mode=match-sheet&id=17214`: Essendon 24 players,
North Melbourne 23, Fiorini's stable player link 2121, and no existing durable sheet decisions.
No removal was staged. A browser-URL confidence policy stop ended that turn, and another
fresh execution turn stopped at state capture after reacquiring Chrome. Neither invoked
Save, the fresh gate, an authority/edit audit write or derived recomputation. The owner
classifies these as automation limitations only, not application/production failures or
partial corrections; authorisation remains unconsumed.

The owner now prohibits another Computer Use attempt to submit. Keep the authenticated
Chrome session open; operator manually navigates to the exact URL above, prepares only
Fiorini's removal plus `DECISION_NOTE.authorised-pending.txt`, changes no other row/field,
and leaves final Save unclicked. Await operator confirmation of that prepared unsaved state.
Codex then runs the already authorised fresh read-only database gate immediately before
manual submission. Counts **10,029** in 2026 and **24** Essendon match rows are required
alongside every previously stated identity/value/provenance/key precondition. Any mismatch
stops submission for owner review. Only on PASS may the operator manually save exactly once.

After manual submission, even if UI response is unclear, immediately perform read-only
post-verification and determine actual transaction/audit/derived state. Never repeat the
removal. Any failed or ambiguous postcondition stops for adjudication with observed state
preserved. Only fully passing post-verification supports a successful correction record;
return to the owner for final U3 confirmation. U4 remains Route B; Brownlow untouched;
production NO-GO. No census, seal/rollover, activation, production apply, deployment, rebuild
or push is authorised. No alternative write mechanism is permitted.

## Original verification and submission controls (historical; current STOP takes precedence)

1. Revalidate the identity/unchanged-data gate against fresh evidence; the snapshot above
   is not a freshness waiver. Stop on any differing precondition.
2. Verify deployed workflow/version and actor capability. Load a fresh sheet/token.
3. Review that the only change is `removedPlayerIds=[2121]`, with all remaining player
   values unchanged and score synchronisation false. Use the retained authorised note.
4. Submit once. On any partial/uncertain failure, stop and inspect transaction/audit state;
   do not repeat the correction.
5. Read-only verification must prove target absence; no other removed PMS row; 2026 count
   10,028; Essendon count 23; zero missing/extra baseline keys; durable removal authority
   and exact note; successful required recomputation; preserved originating history;
   unchanged match totals/scores/periods, unrelated canonical data and 9,522 Brownlow
   round-vote rows. Retain before/after evidence and hashes.

Only after every check passes may the owner's exact final U3 wording be recorded.
U4 stays Route B. Actual day-D nightly recheck and regeneration/re-pinning of affected
production material remain mandatory. This non-date canonical correction cannot be
absorbed into U2's date-only permission. No census, seal/rollover, successor activation,
production apply, deployment, rebuild or push is authorised here.

## Files retained

- `precheck.sh`, `expected-row.json`: exact read-only query and retained row used for comparison.
- `precheck.stdout.log`, `precheck.stderr.log`, `precheck.exit.txt`, `precheck.json`:
  successful production query output, transport state and parsed evidence.
- `sandbox-precheck.stdout.log`, `sandbox-precheck.stderr.log`, `sandbox-precheck.exit.txt`:
  failed pre-connection attempt.
- `browser-availability.json`: unavailable workflow surfaces; no submission.
- `DECISION_NOTE.authorised-pending.txt`: 967-character decision note, explicitly linking
  ISSUE-316 and historical ISSUE-255; not yet persisted in production.
- `RECORD.md`, `SHA256SUMS`: this record and hashes of every retained file except the hash
  manifest itself.

## Repository files changed for the manual execution record

- `CHANGELOG.md`
- `IssuesIndex.md`
- `issues.md`
- `issues/open/AFLDB-ISSUE-316.md`
- In `issues/open/AFLDB-ISSUE-316-u3-correction-20261024/`:
  `RECORD.md`, `SHA256SUMS`,
  `fresh-precheck-20261024T1126Z.stdout.log`,
  `fresh-precheck-20261024T1126Z.stderr.log`,
  `fresh-precheck-20261024T1126Z.exit.txt`,
  `fresh-precheck-20261024T1126Z.json`,
  `postcheck.sh`, `postcheck.stdout.log`, `postcheck.stderr.log`,
  `postcheck.exit.txt`, `postcheck.json`, `POSTCHECK-ASSESSMENT.json`.

No application code, migration, importer or Git state changed. Local validation parses the
captured JSON, compares fresh/post fingerprints and verifies every evidence-manifest hash;
it does not substitute for the incomplete production postconditions above.
