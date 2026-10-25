# ISSUE-316 U3 exact metadata repair — second-pass execution package

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
- `OWNER-RULING.md`: explicitly labelled excerpt of the current owner's instruction.
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
- `repair.sql`: SERIALIZABLE; production identity, audit table/row and protected
  table locks, all preflight guards repeated, complete snapshot equality against
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
node issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v2/run.cjs verify MANIFEST_SHA256
node issues/open/AFLDB-ISSUE-316-u3-correction-20261024/metadata-repair-v2/run.cjs execute MANIFEST_SHA256 REVIEW_JSON_SHA256
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
psql, rolling back note and audit together. All protected table SHARE locks remain
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

Run `node .../metadata-repair-v2/validate.cjs`. The repository's existing PGlite
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
