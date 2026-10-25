# ISSUE-316 U3 — independent metadata-repair execution-gate review

2026-10-24. **NO-GO. No production connection or write attempted in this continuation.**

The owner conditionally authorised the exact reviewed repair after independent GO, without another approval
round-trip. That condition was not met. This stop follows the owner's HIGH/MED finding rule, not the older
proposal's request for an additional approval. The original proposal and note have not been edited.

## Independent reviewer and scope

Fresh reviewer context `/root/metadata_review`, role `afldb-reviewer`, without inherited conversation history.
The reviewer independently inspected the exact retained proposal, authorised note and bounded supporting
read-only evidence from disk. The reviewer made no edits, production connection or database command.
Graph/native file tools were unavailable; local read-only file inspection was used. This was a document/artifact
review, not a new code audit or fresh production preflight. No replacement SQL was drafted.

The proposal labels its transaction section “design, not executable SQL” at line 42 and explicitly disclaims
executable production SQL at lines 93–94. The bounded `.sql` / `.sh` / `.cjs` inventory and search in this retained
correction directory found read-only verification artifacts, with no repair transaction to inspect or execute.

## Findings returned by the independent reviewer

| ID | Grade | Location in METADATA-REPAIR-PROPOSAL.md | Finding |
|---|---|---|---|
| F-001 | HIGH | 42; 93–94 | No executable transaction exists for inspection. Executing from this design would require improvising identity checks, locks, full-row guards, cardinality assertions and atomic failure handling, bypassing the owner's required review gate. |
| F-002 | HIGH | 51–55 | The repair-audit INSERT is only prose: the repair actor, exact old/new JSON, approval/review reference and audit note are unbound. An executor could fill note 94 while recording incomplete or wrongly attributed repair history; mandatory same-transaction audit linkage cannot be verified. |
| F-003 | MED | 75–78 | Excluded-state fingerprints and fresh postcommit comparison are requirements without an executable repair-specific comparison/assertion mechanism. Historical correction checks do not verify the new audit row or all required repair exclusions; declaring success from them could miss unintended changes. |

These are execution-gate findings, not evidence of a product defect or a new canonical-data defect.
All three stop execution under the owner's ruling and return for owner adjudication.

## Ten-condition gate

| Owner condition | Independent assessment |
|---|---|
| 1. Exact production identity | Specified as afldb-prod / afldb_prod / OID 66668 / system ID 7674454702926115004 and supported historically; no executable guard or fresh preflight. |
| 2. Require audit id 94 | Required in prose; no executable target/cardinality guard. |
| 3. Require note still NULL | Historical evidence supports NULL; no executable current-value guard. |
| 4. Exact 967-character authorised note and SHA-256 | Text/hash PASS. The raw file is 968 bytes/characters with one final LF; excluding exactly that LF yields the authorised 967 characters and required hash. The proposal quote matches. No SQL parameter/value binding exists to inspect. |
| 5. Preserve authority 93 | Full-row preservation required in prose and supported historically; no executable lock/guard/fingerprint assertion. |
| 6. No canonical/derived/Brownlow writes | Design restricts writes correctly; no actual transaction or current catalog/role check to verify its implementation. |
| 7. Preserve batch/application history | Required in prose; no executable preservation check. |
| 8. Only one exact linked repair audit besides filling note 94 | Not verifiable: INSERT, actor, exact JSON and approval/review linkage are unbound. |
| 9. Atomic rollback on any failed guard | Required in prose; actual transaction/client failure handling absent. Sequence allocation is explicitly nontransactional in the proposal and must never be reset. |
| 10. Read-only precise metadata delta and absence of canonical changes | Historical correction verification is retained; no executable repair-specific before/after assertion mechanism. |

The historical evidence supports authority 93 intact, PMS 705437 absent, 2026 PMS count 10,028, Essendon / match
17214 count 23, zero baseline-key differences, and the accepted canonical/derived verification. It is not a fresh
pre-execution check. No new before/after production evidence exists because execution never began.

## Reviewed artifact hashes

SHA-256 values independently checked against the then-current `SHA256SUMS`:

| Artifact | SHA-256 |
|---|---|
| METADATA-REPAIR-PROPOSAL.md | c20fba9bd5985b19fc484268a9b2a4dd2dfde4058a9941548a31fd5040ad6634 |
| DECISION_NOTE.authorised-pending.txt, raw file including final LF | 8095d374775a03130cccdb74f1b0485112f2003cf9ac34e1f1896a29a74fc615 |
| Authorised note value, excluding final LF | 3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d |
| ADJUDICATION-READONLY-REPORT.md | a2288ba8a6af4d9602d8ca40e98b497acdf7ede216e2d75741d9cb31a99d1405 |
| ADJUDICATION-ASSESSMENT.json | 2a24792b9729eae284a97b0240ffdfd233e95f5605e01ee0eaf502c7f7b83aa0 |
| metadata-investigation.json | 65d7d2f9b97c889969388b22de8531d7a9cdb1b3c7c7e83d39da2061df41ba48 |
| aggregate-metadata-final.json | 4ef529b26e4d536973eabd9978937fff832041fd9d913f8435aaeeaf5b65625a |
| postcheck.json | a9b57a2e9022dfd254af0952ca345ea5812776cba0a483b2a2eb3465bf7aaefa |
| derived-verification.json | 14a36ae40aceb23245da9f7c709df13c41fb76519cb8cabebd24483df20fa900 |
| RECORD.md, before this review was recorded | 9f8fe692c1294c18bf35f3b1fffe0eb5d9a6f7bd44d356f52bc1367df1a59a05 |
| SHA256SUMS, before this review was recorded | 32fadb268e20cd3d095734494883c9270b23b9cb8f704bb394fbb501992e5676 |

The prior manifest is preserved as `SHA256SUMS.before-metadata-review`. The current manifest binds this report,
the updated RECORD and `SESSION-FILES.metadata-review.json`; previous raw evidence and prior session inventory
remain unchanged.

## Disposition

Return F-001 / F-002 / F-003 for owner adjudication. There is no reviewed executable transaction to run; none
was invented, substituted or retried. The accepted Fiorini correction remains accepted, without restoration or
repetition. Missing-note cause remains unknown: execution/audit-metadata incident, not a proven application defect.
No new issue or regression test was created. ISSUE-316 remains open; index, Open Issues table and runbook reflect
this failed gate. CHANGELOG is unchanged because this continuation records investigation/review only.

U3 remains unconfirmed because the review/commit/post-verification conditions have not been met. The next
production-readiness decision has not been advanced. U4 remains Route B; Brownlow untouched. No census,
seal/rollover, successor activation, production apply, deployment, rebuild, push or Git command was executed.
Production remains **NO-GO**.
