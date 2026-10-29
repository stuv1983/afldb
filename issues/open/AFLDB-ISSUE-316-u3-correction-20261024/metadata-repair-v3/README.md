# ISSUE-316 U3 exact metadata repair — F-004 lock-order revision v3

Scope: fill only public.data_edits 94.note and append one linked data_edits record.
Accepted canonical correction and read-only canonical/derived reconciliation stand.
U3 is unconfirmed until commit and all postconditions pass. U4 Route B; Brownlow
untouched; overall production readiness NO-GO. This is not rollover/apply authority.

## Concrete binding and evidence

- `binding.json`: every retained column of edit 94 and authority 93, normalised only
  for timestamp comparison to PostgreSQL's UTC JSON rendering. Timestamps retain
  all six fractional digits. Full JSON equality also refuses extra current columns.
- `note.txt`: exactly 967 UTF-8 bytes/characters; SHA-256
  `3d2d25ea4919dcdc1cfd8fcaa1b2ede6941e10ab0d07404fa0e2279fcc33621d`.
  Extracted by verifying the original 968-byte retained file and removing exactly
  its one framing LF. There is no trim or newline normalisation of the stored value.
- `OWNER-RULING.md`: explicitly labelled excerpt of the current owner's instruction and F-004 supplement.
  Its byte SHA-256, filename and identifying heading form the approval reference;
  no external approval number is invented.
- Actual existing account: user 1, stuart.villanti@gmail.com, super_admin. The retained
  `../browser-inspection.json` shows this account and the attributed original edit;
  `../metadata-investigation.json` identifies original admin_user_id 1. The new
  operation is Codex executing the owner's delegated instruction on that account's
  behalf, through existing SSH `afldb` / Unix `arm` / `sudo -n -u postgres`. These
  transport/database identities must be observed exactly at execution. No grants,
  new actor, impersonated browser request or account modification is performed.
- `schema-evidence.json`, `audit-schema-source.txt`, `audit-log-source.txt` and
  `PRIOR-NO-GO.md`: current retained schema/conventions and all three prior findings.
  The audit convention uses parent `matches`, row_id 17214, unrestricted operation
  key `audit_note_repair`. Exact target audit 94 and authority 93 are in old/new JSON,
  along with issue, owner approval hash, reviewed manifest and review-record hashes,
  reason and actual database role. No schema extension is required.

## Executables

- `preflight.sql`: REPEATABLE READ READ ONLY; database/OID/system ID/role identity,
  full row and NULL note guards, input note hash, actor/approval/schema/privilege
  guards, original authority, canonical counts/absence and both baseline differences.
- `repair.sql`: SERIALIZABLE; literal local settings, complete plain relation
  locks, then production identity, held-lock verification and row locks, all preflight guards repeated, complete snapshot equality against
  the immediately preceding read-only preflight, two logical writes in
  `repair-body.sql`, then every postcondition before COMMIT.
- `postcheck.sql`: a fresh REPEATABLE READ READ ONLY transaction on the same psql
  connection, after COMMIT. It independently re-reads note/hash, linked audit,
  original audit fields, all other audit rows, authority and protected data.
- `snapshot.sql` / `protected.json`: full-table SHA-256 fingerprints for all 25
  required protected relations and two optional later Brownlow tables (absence is
  fingerprinted too). Includes entire canonical/PMS/lineup/period/derived tables,
  player spans, import and application history, Brownlow authoritative/admin/staging
  representations, staging baseline and all auth_audit_log rows. This is a logical
  preservation comparison, not an ISSUE-316 production eligibility/source census.
  No credentials, session tokens, password hashes or TOTP secrets are read.
- `run.cjs`: local fail-closed wrapper; expands only manifest-bound SQL includes;
  uses built-in Node APIs and the existing OpenSSH client; sends SQL as stdin to
  one fixed remote psql command. No DSN/environment file is read. psql uses `-X`,
  ON_ERROR_STOP, ten-minute statement timeout, two-second lock timeout, and no
  application runtime. No persistent remote package is installed.
  `runtime.json` pins the actual local Node and OpenSSH executable bytes. Remote
  installed bash/sudo/env/psql/PostgreSQL are the existing trusted system platform,
  not supplied repair artifacts; their bytes have not been fetched or replaced.

## Hash/review gate and execution

`MANIFEST.json` covers every retained executable and input in this package, including
the fixture runner and validation evidence. Its own SHA-256 is pinned externally in
`REVIEW.json` and in the review record. The review record and its hash are also bound
at launch, avoiding a circular manifest/review hash. Any executable/input change
invalidates the review; never regenerate a manifest merely to pass an old GO.

The independently authored `REVIEW.json` must say GO, zero stopping findings and
the exact manifest/report SHA-256. After GO only:

```
node issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v3/run.cjs verify MANIFEST_SHA256
node issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v3/run.cjs execute MANIFEST_SHA256 REVIEW_JSON_SHA256
```

Use the literal hashes recorded by the independent reviewer, never a freshly
computed substituted pin. `ATTEMPT.json` is exclusively created before SSH and
prevents another launch. `execution/` retains submitted SQL, stdout, stderr, outcome
and hashes. A PASS requires psql exit 0, preflight output, commit acknowledgement and
postcheck output. Precommit output alone is not commit evidence.

The SQL files are executable psql files with hash-bound `\ir` includes; they use
session settings prepared by the wrapper. `afldb.i316.before` and
`afldb.i316.receipt` persist across read-only preflight, repair and fresh postcheck
transactions. They are not database tables. Never invoke the write SQL manually
with improvised settings. A separate-session forensic read-only postcheck can only
use the exact retained before/receipt evidence under a separately adjudicated step
after an ambiguous outcome; the wrapper never retries or initiates that step.

## Atomicity, failure and rollback

No exception is caught in SQL. A failed identity/value/cardinality/actor/approval/
schema/insert/isolation assertion aborts the write transaction. ON_ERROR_STOP closes
psql, rolling back note and audit together. All protected table SHARE locks and catalog/actor locks remain
until commit; lock contention fails after two seconds. No automatic retry. A
failed INSERT may consume a sequence value even on rollback; never reset it.

The fingerprints scan full protected historical rows and can hold SHARE locks for
the duration of two snapshots. Ordinary writes may therefore briefly wait during
this exceptional repair. Timeout or concurrent drift stops rather than relaxing
the guards. External writes immediately after commit cause the postcheck to stop
if they change a protected fingerprint or add any audit row.

Any ambiguous SSH/COMMIT result or failed postcheck is STOP_NO_RETRY. Preserve all
evidence and return to the owner. Do not infer rollback from a missing acknowledgement.
No postcommit reversal is authorised: it would need a separately approved audited
metadata transaction, never deletion of audit history, authority edits, canonical
restoration, Match Sheet Save or another removal.

## Disposable validation and limits

Run `node .../metadata-repair-v3/validate.cjs`. The repository's existing PGlite
0.2.17 dependency runs in memory without a server/socket. The exact shared guard,
transaction body, locks, snapshot and postcheck SQL execute against synthetic
protected tables and target audit schema/rows. Production identity is never
spoofed or relaxed: `identity.sql` is tested separately and must refuse this
database, then is excluded only in the fixture's SQL expansion. This is local
semantic/atomicity evidence, not Linux/transport/live-schema acceptance.

Validation covers the happy path, refused repeat/non-NULL/wrong identity/missing
row, actual audit INSERT failure after UPDATE with rollback, wrong actor/approval,
authority drift, exact note framing, canonical drift/count failures, unexpected
trigger and postcheck detection of Brownlow/additional audit changes. All SQL and
inputs remain subject to a fresh independent review before production access.

## F-004 ordering and concurrency evidence

`SEMANTICS.md` records each pre-lock statement and the checked PostgreSQL 16 source.
No DO/catalog/guard read precedes the complete lock set. The original protected
inventory is unchanged. Plain SHARE locks also cover auth_users and pg_class/
pg_namespace so actor changes and optional-table/schema DDL cannot evade the proof.
The catalog locks briefly exclude unrelated DDL too and use the same 2s timeout.
Optional lock branches use read-only preflight booleans; locked in-transaction
coverage and all material guards are authoritative and can refuse independently.

Runtime markers, in order: TRANSACTION_BEGUN; PROTECTED_LOCKS_ACQUIRED;
POST_LOCK_GUARDS_PASSED; BEFORE_STATE_CAPTURED; METADATA_WRITES_COMPLETED;
IN_TRANSACTION_ASSERTIONS_PASSED; COMMIT_ACKNOWLEDGED;
POSTCOMMIT_VERIFICATION_PASSED (each prefixed I316_). Only client echoes emit the
pre-lock markers. The wrapper requires the ordered marker sequence and the original
preflight/receipt/postcheck evidence with exit 0. No marker contains credentials.

Run `node .../metadata-repair-v3/validate-order.cjs` and
`node .../metadata-repair-v3/validate.cjs` locally.
`validate-remote.cjs` stages hash-checked synthetic test inputs to a fresh private
streamanator directory and runs `validate-pg.cjs /usr/lib/postgresql/16/bin` with the
existing Node postgres module. It creates its own Unix-socket-only cluster and
`i316_f004_test`, stops that cluster, and retains logs. It never reads application
environment files or connects to shared DEV/test/prod. This does not consume rebuild
authorisation. PGlite results alone do not claim concurrency semantics.

Frozen v2 remains NO-GO evidence (`V2-NO-GO.md` is a copy, not permission to run it).
Every changed executable must be frozen under a new manifest and independently
reviewed before production access. Production rollout remains NO-GO regardless of
this metadata-only gate.

Real PostgreSQL exposed one additional limit requiring independent disposition:
an optional-table CREATE whose statement already finished can commit while catalog
SHARE locks are held. In the isolated test the in-transaction assertions detect
the new relation and roll back both metadata writes. The catalog locks are not
claimed to exclude this pre-existing DDL commit. See SEMANTICS.md and the explicit
PG-VALIDATION.json case; the owner's stopping rules remain authoritative.
