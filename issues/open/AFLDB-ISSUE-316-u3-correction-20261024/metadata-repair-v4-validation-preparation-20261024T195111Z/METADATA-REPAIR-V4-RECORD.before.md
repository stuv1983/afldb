# ISSUE-316 metadata repair v4 — owner scope clarification

**Validation blocked at remote-transfer approval. No production contact, attempt or
write. U3 unconfirmed; U4 Route B; Brownlow untouched; production NO-GO.**

F-005 is accepted as valid against v3's prior contract. Classification:
**Resolved by owner scope clarification, subject to v4 proving detection and
isolation under the revised contract.** The withdrawn claim was optional absence
protected through COMMIT. V2 and v3 remain frozen and unexecuted. Original accepted
Fiorini correction and completed reconciliation stand. F-001 through F-004's prior
closure is retained as history, pending fresh v4 review.

## Narrow derivation

[V4 package](metadata-repair-v4/README.md) derives from all 46 verified frozen v3
manifest members, manifest 5bf642882f29731c2db95558ac12779fd97a83ccfacf3cfe36e66700ce54034d.
The write body and exact note remain byte-equal to v3. Only one guarded note UPDATE
and one linked audit INSERT are permitted. Actor/full target/authority bindings,
rollback behaviour and note hash are retained. Current owner authority is appended
and rebound by exact hash/reference; no fabricated actor or approval identifier.

Both pg_class/pg_namespace locks and the absence-exclusion claim are removed.
Existing protected relations remain strictly locked before working snapshot/guards.
The migration ledger is added to the locked/fingerprinted inventory because the new
operational guard reads it. Both optional presences/schema observations are recorded
at preflight and inside the locked transaction; existing optional data stays strict.
New optional schema after final assertions is environment drift, not corruption of
the two writes. Exact postcommit assertions run before emitting drift status.

Read-only host/process/service and database activity/lock/prepared-transaction guards
are added. Expected migration ledger is exactly 110 names with bounded checksum
representations from current migration files, based on the retained production
readiness decision. Unknown version/work stops; no migration is run. These checks
are bounded observations, not exclusion of future DDL.

## Actual validation and remaining gate

- Static exact-prefix/inventory/modes/marker check PASS: 25 inherited required
  relations, migration ledger and two conditional optional relations, plus audit
  and actor locks. No catalog locks.
- PGlite **19/19 PASS**: all inherited 16 cases plus optional appearance, optional
  default/schema change, and protected-data corruption despite simultaneous drift.
  No PGlite concurrency claim.
- In-memory wrapper **14/14 PASS**, including drift blocks U3, no retry/reversal,
  failed transport cannot be misclassified as verified drift, review/hash/attempt
  refusals and missing/out-of-order markers. No real transport invoked by these tests.
- Real PostgreSQL script is prepared: inherited existing-writer/after-lock writer,
  timeout, optional-present locks, audit-insert rollback, repeat refusal, postcheck
  mutation cases; early optional CREATE rollback; test-only pause after every final
  assertion before COMMIT with independently committed optional CREATE, then exact
  metadata/authority/protected-state assertions and CONCURRENT_SCHEMA_DRIFT. Added
  operational DDL/version refusal case. **Not run on PostgreSQL for v4.**
- Initial remote validation attempt was denied by the network sandbox before SSH
  connection. The subsequent escalation was rejected by automatic approval review:
  private package/source transfer to arm@10.0.40.100 (streamanator) needed explicit
  destination/egress authorisation. No remote validation bootstrap ran. Approval
  question is pending; rejection is not a PostgreSQL test failure.
- No production wrapper launch or ATTEMPT.json. No production read-only preflight,
  repair, postcheck, census, rollover, activation, apply, deployment, rebuild or Git.

The candidate is separately hashed in MANIFEST.json and its hash is recorded in
V4-STATE.json. This is a candidate snapshot, **not final validated/reviewed freeze
or execution authority**. Real validation evidence will be retained outside the
package in unique metadata-repair-v4-validation-* directories, never overwritten.
After required real tests pass, freeze exact bytes and commission the explicitly
requested fresh-context independent review. No reviewer GO is claimed now.

## Next action and standing controls

Await explicit authorisation for this exact validation host/transfer. Then run only
the prepared isolated test transport. If validation passes, fresh exact-byte review
must re-verify F-001 through F-004 and this owner ruling. Only its GO with no stopping
finding plus unchanged hashes permits read-only production operational/preflight
gates, then exact once-only repair/postcheck. Clean confirms U3 under the approved
wording; drift only keeps U3 unconfirmed without retry/reversal; any protected or
ambiguous failure stops for owner adjudication.

No census, seal/rollover execution, successor activation, production apply,
deployment, rebuild or push. Production NO-GO; U4 Route B. No Python or
tools/migration file changed. [Full changed-file inventory](SESSION-FILES.metadata-repair-v4.json).
