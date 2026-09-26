# AFLDB-ISSUE-250 — Production promotion can silently lose writes committed after the target snapshot

## 0. Status

- **OPEN. Severity: High.** Opened 2026-09-26 under operator decision **D-P5-1**, recorded in the
  AFLDB-ISSUE-238 pass-5 design (`issues/open/AFLDB-ISSUE-238.md` §13.1).
- **2026-09-26 pass 1: design written** (§4–§13) from read-only repository inspection.
- **2026-09-26: `afldb-reviewer` design review — PASS WITH MEDIUM/LOW NOTES** (no CRIT/HIGH;
  F-001…F-011, §14). All MED/LOW corrections are folded into this design.
- **2026-09-26: IMPLEMENTED and DB-free validated, uncommitted** (§16). No SQL, database,
  deployment or Git command ran. **Not rehearsed, not accepted.**
- ~~**It blocks AFLDB-ISSUE-237 L5 PROD.** L5 must not run until the §12 rehearsal has run and been
  recorded and the operator has accepted this issue (§13).~~ *(Superseded 2026-09-26, below.)*
- **2026-09-26: DEV REHEARSAL PASS / technically accepted for the ISSUE-237 L5 prerequisite**
  (§17). Operator-authorised, DEV only (`afldb_dev` on `streamanator`), run from a scratch copy
  holding exactly this worktree's uncommitted ISSUE-250 files. Every §12 case passed, including a
  full freeze-enabled DEV promotion (stamp `20260926-195601`) and its guarded rollback. Three
  procedure-text defects were found and fixed in the docs (R-1..R-3); two LOW follow-ups stay open
  (R-4, R-5). PROD was never contacted.
- **Still OPEN**: the code is uncommitted, and the production path itself has not run.
- **ISSUE-237 L5 is no longer blocked on an untested ISSUE-250 mechanism.** It still requires, in
  order: operator review and commit of the ISSUE-250 work (with the §17 doc fixes), merge, the
  code on the PROD checkout, and a **separate operator authorisation for L5**. L5 runs the
  freeze-bound procedure (`docs/production-promotion.md` §4.0–§10).
- **Next action:** operator commit/merge of ISSUE-250; then the separately authorised ISSUE-237 L5.

## 1. Symptom

A write committed to the live production target **after** the promotion's authoritative target
snapshot can be absent from the candidate. When the candidate is swapped live, that write is
**silently lost**. No existing gate detects the loss in every case.

## 2. Confirmed mechanism (repository evidence)

`docs/production-promotion.md`:

- **§4** takes the mandatory production dump (`bash tools/maintenance/backup.sh`, then
  `PRE=$(ls -1t ~/backups/afldb/afldb_prod-*.dump | head -1)`). `pg_dump` reads one MVCC snapshot
  taken when it starts. Nothing in §4 stops the web service or any timer.
- **§5** writes the production-owned state snapshot. It is **row counts only**.
- **§7** reinstates production-owned state into the candidate from **`$PRE`**
  (`--pre-cutover-dump "$PRE"`; §7.2 restores one table at a time with `pg_restore --data-only`).
- **§8** stops `afldb-settle-afltables.timer`, `afldb-settle-afltables.service` and `afldb` **only
  immediately before the swap**, then starts `afldb` again **before** `--phase production` runs.

So from the start of the §4 `pg_dump` snapshot until the §8 service stop, every production writer
stays live. A write to a table §7 reinstates from `$PRE` during that window is not in the
candidate and disappears at the swap. `--compare` (counts) misses any UPDATE and any
insert-plus-delete pair; ISSUE-237's ledger binding (§6 → §7.5) covers one table and only the
§4 → §6 part of the window.

**A second, independent path to the same loss (found in this pass).** `$PRE` is chosen as "the
newest `afldb_prod-*.dump` in the directory". If `backup.sh` failed, or a nightly dump is newer
or older than expected, `$PRE` can silently be a dump taken **before** the promotion began. Nothing
binds `$PRE` to the state the promotion claims to preserve.

## 3. Confirmed example

A Super Admin AFL API `linked` or `revoked` adjudication (`/admin/player-links/afl-api`, table
`afl_api_identity_adjudications`) committed after the captured §4 state, but before cutover. The
ledger is promotion-reinstated from the dump (`promotion-inventory.ts`, contract entry
`afl_api_identity_adjudications`, staged). §7.5 compares the dump-reinstated ledger with the §6
live binding, so it covers only §4 → §6. A write after §6 is lost at the swap.

## 4. The exact promotion window (current procedure)

| Step | What happens | Target writable by app/admin/timers? |
|---|---|---|
| §3 preflight | read-only checks | yes |
| **§4 `backup.sh`** | `pg_dump` (role `afldb_backup`) takes its snapshot **S** at start | **yes — writes after S are not in `$PRE`** |
| §4 `restore-test.sh` | `$PRE` → `afldb_restore_test`; count parity vs live | yes |
| §5 `--phase pre-cutover` | counts snapshot, afl_api census | yes |
| §6 source dump, candidate restore, `--phase restored` | reads live target (ledger binding, G2/G3, lineage) | yes |
| §7 plan, truncate, reinstate from `$PRE`, §7.5 `--phase candidate` | candidate only | yes |
| §8 `systemctl stop … afldb` | **first point writes stop** | no |
| §8 swap | two `ALTER DATABASE … RENAME` | no (services stopped) |
| §8 `systemctl start afldb`, then `--phase production` | app writes to the promoted DB before acceptance | yes (new DB) |
| §10 rollback (if chosen) | promoted DB renamed aside; its post-swap writes are left in it | — |

The **loss window is S → §8 stop**. It is typically tens of minutes to hours (backup, restore
test, transfer, candidate restore, reinstatement, reviews).

## 5. Affected-state inventory

Derived from `PROMOTION_CONTRACT` (`tools/db/promotion-inventory.ts`) and
`afldb_meta.import_writable_tables`. The checker's classification gate already refuses a public
table that is in neither set, so the list is complete **by construction** for `public`.

| Class | Tables | Race consequence today |
|---|---|---|
| **Production-owned, reinstated from `$PRE`** | `auth_users`, `admin_invites`, `auth_audit_log`, `beta_access_codes`, `beta_allowed_emails`, `beta_join_requests`, `site_settings`, `site_media`, `data_edits`, `data_overrides`, `data_submissions`, `data_submission_rows`, `player_link_suggestions`, `player_link_resolutions`, `afl_api_identity_adjudications` (staged), `nl_search_log`, `nl_search_review`, `nl_search_feedback`, `app_health_events`, `external_grid_sources` (staged), `external_grids`, `external_grid_axes`, `brownlow_vote_entry_state` (staged), `brownlow_season_authority`, every `staging_aflw.*` table | **LOST** if written in the window |
| Reset by contract (ephemeral / recorded gap) | `auth_sessions`, `beta_login_tokens`, `promotion_decisions` | discarded by design at every promotion; not a race |
| Regenerated after promotion | `player_link_match_candidates` | rebuilt from rebuilt players + reinstated resolutions; not a race |
| Externally regenerated (rebuilt) | every `import_writable_tables` table, `canonical_applications`, `staging.*`, `player_match_period_stats` | replaced by the rebuild; in-season rows re-acquired (§9); not a race |
| **Mixed ownership** | rebuilt tables that carry admin-created rows re-created from reinstated authority: `external_identities` human `resolved` rows (from `afl_api_identity_adjudications`), admin-created `players`/`draft_picks`/`coaches`/`match_coaches`/`fixtures`/`club_leadership`/`season_list_members`/`player_achievements`/`after_siren_kicks` rows (from `data_overrides` replay) | the **authority** rows are in the first class; a write to the authority in the window is lost, so the derived row is lost too |
| Immutable/reference | `afldb_meta.schema_migrations`, `afldb_meta.*_tables` registries | rebuilt, parity-gated |
| Unknown | none in `public` (the classification gate refuses one) | a future unclassified table is refused before any promotion |

**The mechanism chosen in §7 does not depend on this list being complete.** It stops every
non-operator connection to the target database, whatever table a writer would touch. The list
matters only for the **digest proof** (§8), which is generated from the contract, not typed:
every contract table whose treatment is not `rebuilt`, plus every `staging_aflw` table
(`freezeDigestTables()`).

## 6. Writer inventory

| Writer | How it reaches the database | Role | Stopped today before S? |
|---|---|---|---|
| Web app (`afldb.service`): public pages, NL search telemetry (`nl_search_log` on every search), health events, beta join/login, apex early-access form | `DATABASE_URL` | `afldb_app` | no |
| Web app auth (login, sessions, audit) | `AFLDB_AUTH_DATABASE_URL` | `afldb_auth` | no |
| Admin Centre mutations (data editor, overrides, player links, AFL API adjudications, Brownlow, special records, settings, media, season lists, fixtures, leadership) | `AFLDB_IMPORT_DATABASE_URL` inside the app | `afldb_import` | no |
| `afldb-settle-afltables.timer/.service` | `.env` import DSN | `afldb_import` | no |
| `afldb-settle-afl-api.timer/.service`, `afldb-settle-afl-api-brownlow.timer/.service` (ISSUE-232; may not be installed on PROD) | `.env` import DSN | `afldb_import` | no |
| `afldb-email-intake.timer/.service` | **no DSN** (the unit unsets every DSN); posts to the app over HTTP | via the app | no |
| Operator CLIs: importers, settle by hand, replays, recovery tools | import DSN | `afldb_import` | n/a |
| Operator: `db:migrate`, `db:privileges`, promotion checker (read-only) | owner DSN | `afldb_owner` | n/a |
| `backup.sh` (and any host cron running it) | backup DSN, read-only | `afldb_backup` | n/a |
| `restore-test.sh` | owner DSN; **reads** the source for parity, writes only `afldb_restore_test` | `afldb_owner` | n/a |
| Superuser via `sudo -u postgres` | local socket | `postgres` | n/a |

`afldb_backup` holds `pg_read_all_data` and nothing else (`privileges.sql` "reads everything,
writes nothing"), and `privileges.sql` never touches a database-level ACL, so a `db:privileges`
reconcile during a freeze cannot undo it.

Every automated and application writer uses `afldb_app`, `afldb_auth` or `afldb_import`. The only
roles that can reach the target once §7's freeze is in place are `afldb_owner` and `afldb_backup`
(operator-held) and superusers (operator-held, via `sudo`).

**No maintenance mode, read-only mode or write freeze exists** in the application, the deployment
units or the promotion tooling (read-only search of `src/lib`, `deploy/`, `tools/`). The production
application is served only on the gated beta host; the apex is a static page
(`deploy/Caddyfile.production`), so stopping the application is a small, bounded outage.

## 7. Chosen mechanism: an enforced, database-level promotion freeze

**Options considered.**

- *`systemctl stop` before §4 only.* Necessary hygiene, **not enforcement**: a timer, a manual
  CLI or an accidental `systemctl start` can still commit. Rejected as the sole mechanism.
- *App-level read-only mode.* Does not exist; would need every mutator and the telemetry writers
  audited. Larger than the problem. Rejected.
- *Table-level `REVOKE INSERT/UPDATE/DELETE`.* Must be reconciled against `privileges.sql`, leaves
  pre-existing sessions able to commit work already done, and needs per-table maintenance.
  Rejected.
- *`ALTER DATABASE … ALLOW_CONNECTIONS false`.* Also blocks `afldb_backup` and the owner, so the
  dump and the checker could not run. Rejected.
- *`ALTER ROLE afldb_app/afldb_auth/afldb_import NOLOGIN` + terminate* (reviewer F-010). Three
  statements, but cluster-wide (on the DEV host it would also freeze `afldb_test` and every
  rehearsal database), not bound to the physical database (the kept database becomes writable
  again the moment LOGIN is restored), and it leaves no rename-proof marker. Rejected.
- **Chosen: revoke `CONNECT` on the target database from every non-operator role, terminate every
  other backend, and prove quiescence before the snapshot.** It is one catalog change, enforced by
  PostgreSQL at connection time for every writer in §6, independent of systemd, independent of
  the table inventory, and reversible by one guarded statement.

### 7.1 Freeze state (durable, in the cluster)

A database is **frozen for a promotion** when both hold:

1. **ACL:** `PUBLIC` holds no `CONNECT` on it, and the only non-superuser login roles for which
   `has_database_privilege(role, db, 'CONNECT')` is true are `afldb_owner` (the database owner)
   and `afldb_backup`.
2. **Marker:** its database comment (`shobj_description(oid, 'pg_database')`, the shared catalog)
   is exactly `afldb.promotion_freeze.v1 token=<32 hex> environment=<prod|dev> database=<name>`.

Both live in shared catalogs keyed by the database OID, so they **survive a crash, a restart and a
rename**. `pg_dump` without `--create` carries neither, so neither `$PRE` nor the candidate ever
inherits them. The rebuild marker (`afldb.afl_api_identities.rebuild_capture`) also lives in the
database comment; the freeze refuses a database that carries **any** comment, so the two can never
overwrite each other.

The **token** is a random 128-bit value generated with the freeze plan. It binds every later
artefact (freeze record, dump proof, swap guard, rollback guard, unfreeze) to one physical freeze.
It is an identity binding, not a secret.

### 7.2 Artefacts

| Artefact | Written by | Content |
|---|---|---|
| `promotion-freeze.json` (manifest) | `--freeze-plan` (no DB) | format, environment, database, token, comment |
| `promotion-freeze.sql` | `--freeze-plan` | guarded freeze, one transaction, terminates nothing (run as `postgres` on the `postgres` DB, never with `-1`) |
| `promotion-terminate.sql` | `--freeze-plan` | token-guarded, **re-runnable** termination of every other session (F-004) |
| `promotion-unfreeze.sql` | `--freeze-plan` | guarded release of the **live name** only — the exact inverse of the freeze (F-002) |
| `promotion-unfreeze-recovery-<token8>.sql` | `--unfreeze-recovery` (no DB) | the same release rebuilt from the token `--freeze-status` shows, when the freeze directory is lost |
| freeze record | `--phase frozen` (only on PASS) | token, environment, database, **database OID**, per-table digest `F0`, payload sha256 |
| dump proof | `--phase freeze-dump` (only on PASS) | token, record payload sha256, `$PRE` sha256, digest equality |
| freeze-bound `promotion-swap.sql` / `promotion-rollback.sql` | `--plan` with the record and proof | guard DO blocks before the renames |

All files are mode 600 and never overwritten.

### 7.3 In-flight transactions and quiescence (the ordering rule)

`CONNECT` is checked only when a session starts, so revoking it does not stop a session that is
already connected. The freeze therefore runs in this order, and the snapshot is taken only after a
**read proof** that it holds:

1. **Block new writers.** `promotion-freeze.sql`, in one transaction: guards (the database exists,
   is owned by `afldb_owner`, carries no comment, and has no explicit `CONNECT` grantee except
   `PUBLIC` and the owner; `PUBLIC` currently holds `CONNECT`, so the release restores exactly
   today's access), then `REVOKE CONNECT, TEMPORARY … FROM PUBLIC`, `GRANT CONNECT … TO
   afldb_backup`, `COMMENT ON DATABASE … IS '<marker>'`. `COMMIT` — from here no new app, auth or
   import session can connect. **Every ACL test uses the effective ACL**,
   `aclexplode(coalesce(datacl, acldefault('d', datdba)))` (F-001): production's `datacl` is NULL
   (createdb's defaults, never materialised), which is the expected pre-freeze state; the REVOKE
   materialises it. After a release the ACL is the explicit `{=Tc/afldb_owner,
   afldb_owner=CTc/afldb_owner}`, which the same test reads as equivalent, so a freeze → release →
   freeze cycle works (F-002).
2. **Remove existing sessions.** `promotion-terminate.sql`, a separate, re-runnable file (F-004):
   it refuses (terminates nothing) unless this token's freeze is in place, then runs
   `pg_terminate_backend` on **every** other backend of the target (any role). Because the freeze
   file terminates nothing, running it under `psql -1` cannot open a gap between a terminate and
   the revoke's commit. A terminated backend's open transaction is rolled back; a transaction
   whose commit record was already written committed *before* the proof below.
3. **Prove quiescence (`--phase frozen`, read-only).** PASS only when, read from the target:
   - the marker equals the manifest's comment (token match) and the ACL is frozen (§7.1);
   - **no other non-superuser session** is connected to the target (`pg_stat_activity`,
     excluding this session and its own parallel workers). The checker runs as `afldb_owner`, not
     a superuser, so for other users' rows `backend_type` may be hidden; `usesysid` is visible to
     every caller. The FAIL set is exactly what the freeze must have removed (F-003): another row
     with a **non-superuser role** (the owner's own stray psql included). A superuser row is an
     operator's, reported as WARN (its writes are caught by the digest). A role-less row — an
     autovacuum worker, whatever PostgreSQL reports for it — is INFO. So the rule does not depend
     on how autovacuum workers report `usesysid`; §12 observes it anyway;
   - **no prepared transaction** exists for the target (`pg_prepared_xacts`) — a prepared
     transaction survives backend termination and could commit later;
   then it computes the per-table content digest **F0** over `freezeDigestTables()` and writes the
   freeze record with the database **OID**.
4. **Take the snapshot.** Only now `backup.sh`. Any session that can connect from step 1 on is an
   operator role; no application, admin, timer or import writer can.

No step relies on a wall-clock delay. If a terminated backend has not yet exited, step 3 FAILs and
is simply re-run.

### 7.4 Binding the snapshot to the frozen state (closes the `$PRE` selection path too)

`restore-test.sh` gains two statements: it clears the comment on `afldb_restore_test` before it
restores, and after its parity checks pass it records
`afldb.restore_test.v1 sha256=<sha256 of the dump it restored>` as that database's comment.
`--phase freeze-dump --database afldb_restore_test --freeze-record R --pre-cutover-dump "$PRE"`
then PASSes only when:

- the recorded sha256 equals the sha256 of `$PRE` (hashed by the checker), and
- the digest of `afldb_restore_test` equals **F0** table for table.

It writes the dump proof. `--plan` (production) requires the record and the proof, re-hashes
`$PRE`, and refuses a mismatch. So the file §7 reinstates from is **proven** to hold exactly the
frozen target state — an old nightly dump, a failed backup or a dump taken before the freeze is
refused. The generated `promotion-reinstate.sh` then begins with `sha256sum --check` of `$PRE`
against the proven digest, so a file replaced between `--plan` and §7.2 is caught too (F-006).
`restore-test.sh` hashes the dump **before** restoring, clears any earlier binding at the start,
and records the binding only after every parity check passes; if the comment cannot be written the
script fails rather than reporting "proven". `freeze-dump` treats an absent or foreign comment as
FAIL (F-008).

### 7.5 Gates while frozen

For `--environment prod` every phase that touches the target requires `--freeze-record` and
re-verifies §7.3 step 3 (marker, ACL, quiescence, prepared transactions) **and digest = F0**:

| Phase | Target check |
|---|---|
| `pre-cutover` (§5) | target = frozen, quiescent, digest = F0 |
| `restored` (§6) | the `--old-database` (live target) = frozen, quiescent, digest = F0 |
| `--plan` (§7) | record + dump proof + `$PRE` hash agree (no DB) |
| `candidate` (§7.5) — **the pre-swap gate** | additionally opens the live target: frozen, quiescent, digest = F0 |
| swap SQL (§8) | guard, as `postgres`: live name carries the marker, PUBLIC holds no CONNECT, only owner/backup are explicit grantees, no prepared transaction for it, candidate carries no freeze marker — **else no rename runs** |
| `production` (§8) — **post-swap acceptance** | `--old-database <kept>`: kept DB OID = record OID, marker + ACL still frozen, digest = F0; new live DB OID ≠ record OID and carries no freeze marker |

### 7.6 The residual cutover race, closed

The last *pre*-swap digest runs in `--phase candidate`; between it and the renames, only operator
roles can connect. The race is closed by the **post-swap** gate: the swap renames the physical
database whose OID the record holds, and after the renames nothing but an operator can connect to
it. `--phase production` reads that exact database (by OID) and requires its content digest to
equal F0 = `$PRE`. Any write to a **production-owned table** committed to the old target at any
moment between the freeze and the swap — including one in the last-check → swap gap — makes the
digest differ, and the promotion is **not accepted** (rollback, §9). The race is converted into a
failing gate, as §6.7 of the original record required.

*Bound of the claim (F-005).* Only digest-set tables are detected. An owner or superuser write to a
`rebuilt` football table is neither blocked nor detected — but it is replaced by the candidate by
design, exactly as any pre-freeze write to that table is. The operator rule, stated in the
procedure: while frozen, the only owner-DSN tools run against the target are the checker and
`restore-test.sh`.

A write that lands on the kept database *after* the swap (only possible for an operator role, by
its `pre_rebuild` name) also fails the gate. That is a false refusal, and it fails closed.

### 7.7 Release and service order after the swap

The new live database is the candidate: it was created by `createdb` with the default ACL and
never frozen, so nothing needs unfreezing on success. The kept database **stays frozen** until
cleanup drops it (a useful property: nothing can write to it by accident).

**Changed order in §8:** stop → guarded swap → **`--phase production` (with the record and the
kept DB) PASS** → only then `systemctl start afldb` (the freeze release: writes are allowed again,
on the new database) → health → admin login → post-promotion replays → §9 timers. The app no
longer writes to a promoted database that has not yet been accepted.

## 8. The digest (F0)

- Tables: `freezeDigestTables(environment)` = every public contract table whose treatment is not
  `rebuilt` (the `truncatedPublicTables()` set, env-independent) + every `staging_aflw` table from
  the contract. Generated, so a new contract entry is covered automatically.
- Per table: `count(*)` and `md5(string_agg(md5(t::text), '' ORDER BY md5(t::text)))`, with the
  session's output settings pinned (`TimeZone=UTC`, `DateStyle=ISO, YMD`, `IntervalStyle=postgres`,
  `extra_float_digits=1`, `bytea_output=hex`) so the same rows always render the same text.
  Order-independent, sensitive to any INSERT, UPDATE or DELETE.
- Overall: sha256 over the canonical JSON of the per-table entries.
- It is computed only on the **frozen target, the kept target and `afldb_restore_test`** — three
  databases holding the same bytes by construction. It is never computed on the candidate, whose
  reinstated rows are legitimately transformed (lineage remap, audit marker, resets).
- A table missing from the database being digested is a FAIL.

## 9. Failure and recovery contract

**Owner of freeze state:** the cluster (ACL + marker, per database OID). The files in the freeze
directory are the operator's handles on it. The checker never writes to a database.

**Fail-closed rule:** an abandoned or ambiguous freeze leaves the target **frozen** (application
down, timers failing to connect). Nothing unfreezes automatically; nothing unfreezes a database
whose marker token differs; nothing ever unfreezes a `pre_rebuild` database.

**Detection after a crash or terminal loss:** `--freeze-status` (read-only) connects to the
**`postgres` database, never a target by name** (mid-recovery the live name may be absent; the
shared catalogs are readable from anywhere, F-011) and lists every database of the environment's
naming family with its role (live / kept / candidate), whether it carries a freeze marker (and its
token), whether its ACL is frozen, and what that combination means. `\l+` as `postgres` shows the
same comment. `--unfreeze-recovery` contacts no database at all.

**Stop/restart unit list (F-007):** `afldb`, `afldb-settle-afltables.timer/.service`, and — if
installed — `afldb-settle-afl-api.timer/.service`, `afldb-settle-afl-api-brownlow.timer/.service`
(`OnCalendar=*:0/5`), `afldb-email-intake.timer/.service`. Stopping them is the first numbered
step of the procedure's §4.0; restart after an abort is the same list.

| Failure point | State | Recovery |
|---|---|---|
| Freeze SQL guard refuses | nothing changed | fix the cause (e.g. a leftover marker from an abandoned promotion → recover *that* freeze first); services may be restarted |
| After freeze, `--phase frozen` FAILs (session still present), or a crash between the freeze commit and the terminate | frozen | run `promotion-terminate.sql` again, then re-run `--phase frozen`; investigate a persistent session; or abort: `promotion-unfreeze.sql` |
| Backup / restore-test / freeze-dump fails | frozen | fix and repeat, or abort: `promotion-unfreeze.sql`, start services |
| Candidate build, reinstatement or any pre-swap gate fails | frozen; candidate exists | `dropdb` the candidate (optional, may be kept for diagnosis), `promotion-unfreeze.sql`, start services |
| Swap guard refuses | frozen, nothing renamed | as above |
| Swap fails between the two renames | live name absent; old DB renamed aside, still frozen | rename it back by hand (`ALTER DATABASE "<pre_rebuild>" RENAME TO "<live>"`), confirm with `--freeze-status`, then abort as above |
| `--phase production` FAILs (digest drift, marker, OID) | new DB live but **app still stopped**; nothing written to it | freeze-bound `promotion-rollback.sql` (guard: kept DB carries the token; live does not), `--phase frozen`-equivalent check optional, `promotion-unfreeze.sql`, start services. **No write is lost**: the restored DB is the one that was frozen, including any drift write that caused the refusal |
| Health or admin login fails after `start afldb` | new DB live and writable | `promotion-rollback.sql`, then `promotion-unfreeze.sql`, start services. Writes to the promoted DB between start and rollback stay in the renamed candidate (unchanged §10 contract); record them in the promotion record |
| Terminal lost at any point | state is durable | `--freeze-status`, then continue from the last passed gate or abort by the row above |
| Freeze directory lost | frozen | `--unfreeze-recovery --database <live> --freeze-token <token shown by --freeze-status>` writes a token-bound unfreeze file; same guards |
| Second promotion started while one is frozen | — | the second freeze SQL refuses (comment present); `--phase frozen` refuses a token mismatch |

**Rollback write state:** a rollback before `start afldb` restores exactly F0 plus any operator
drift write — the full authoritative state. The kept DB is renamed back **still frozen**, and only
the deliberate, token-guarded `promotion-unfreeze.sql` releases it.

## 10. DEV

`--environment dev` is unchanged unless the operator opts in: the freeze artefacts and phases work
identically for `afldb_dev`, but `--freeze-record` is **required only under `prod`**. Without it,
every DEV phase, plan file, swap and rollback is byte-identical to today (pinned by tests).

## 11. Relationship to ISSUE-238 and ISSUE-237

- `afl_api_identity_adjudications` is in the digest set, so ISSUE-250's candidate-phase target
  digest and post-swap kept-DB digest **subsume ISSUE-238's PSG and post-swap ledger gate for the
  race** (same fail-closed outcome, whole-database coverage). ISSUE-238's corrected census and its
  §7.5 semantic checks remain useful: they check *what* the corrected state means, not whether it
  moved. ISSUE-238 may bind to the freeze record instead of implementing its own PSG; that is
  ISSUE-238's decision after ISSUE-237 L5. No ISSUE-238 code changes here.
- ISSUE-237's §6 ledger binding and §7.5 reinstatement fidelity checks remain (they prove the
  dump → candidate step; ISSUE-250 proves the live → dump step and the no-drift-to-swap step).

## 12. Rehearsal plan (non-production; separately authorised)

On `code_test_db`-style throwaway databases or a DEV promotion with `--environment dev
--freeze-record` (DEV mutation needs its own authorisation):

0. Record the start state: `datacl` of the target (expected NULL on a database `createdb` made,
   F-001) and `--freeze-status`.
1. Stop services; `--freeze-plan`; run `promotion-freeze.sql`, then `promotion-terminate.sql`.
   Also run a freeze → release → freeze cycle and confirm the second freeze's guard accepts the
   post-release explicit ACL (F-002).
2. **Mutation refused:** connect as `afldb_app`, `afldb_auth` and `afldb_import` → `permission
   denied for database`; an Admin Centre action fails; a settle timer run fails to connect.
3. **In-flight writer:** before step 1, open an `afldb_import` session with an uncommitted
   INSERT into `site_settings`; run the freeze; the session is terminated and its row is absent;
   `--phase frozen` PASSes only after the backend has exited.
4. **Prepared transaction** (if `max_prepared_transactions > 0` on the rehearsal cluster): a
   prepared transaction on the target makes `--phase frozen` FAIL.
5. `backup.sh`, `restore-test.sh "$PRE"`, `--phase freeze-dump` PASS; the same phase with an older
   dump FAILs (sha256 and digest).
6. Pre-cutover, restored, plan, candidate PASS with the record.
7. **Drift detection:** as `afldb_owner`, UPDATE one `site_settings` row on the frozen target after
   `--phase candidate`; swap; `--phase production` FAILs on the digest; rollback + unfreeze
   restores the original DB with the drift write intact.
8. **Happy path:** repeat without drift; `--phase production` PASSes; `start afldb`; an admin
   mutation succeeds on the new DB; the kept DB still refuses `afldb_app`.
9. **Crash recovery:** abandon a freeze; `--freeze-status` reports it; `--unfreeze-recovery` with
   the token releases it; a wrong token is refused; unfreeze of a `pre_rebuild` name is impossible.
10. Confirm the swap guard: with the marker removed by hand, `promotion-swap.sql` renames nothing.
11. **Autovacuum observation (F-003):** while frozen, as `afldb_owner`, run `SELECT usesysid,
    usename, backend_type FROM pg_stat_activity` during an autovacuum/`VACUUM` of a target table,
    and confirm `--phase frozen` does not FAIL on that row.
12. **Digest cost (F-009):** record the wall time of `--phase frozen` and `--phase freeze-dump`
    on production-sized data (the digest runs six times per promotion).
13. **Swap semantics:** the guarded swap and rollback run end to end (the guard DO blocks precede
    the existing `pg_terminate_backend` + two `ALTER DATABASE … RENAME`, unchanged in shape).

### 12.1 Exact DEV rehearsal commands (RUN 2026-09-26 — see §17 for the record and the corrections folded in here)

Everything below is `--environment dev` on `streamanator`. It exercises the freeze on the real
`afldb_dev` without promoting: the dump, proofs and gates run, then a **failed** swap acceptance
and a rollback, then a crash recovery. A full DEV promotion with the freeze follows the same
commands with the §5–§8 steps of `docs/production-promotion.md` §13 inserted.

```bash
# DEV: streamanator
cd ~/projects/afldb && hostname
STAMP=$(date +%Y%m%d-%H%M%S); FREEZE=~/backups/afldb/promotion-dev-$STAMP-freeze
sudo -u postgres psql -d postgres -Atc "SELECT datname, datacl IS NULL AS default_acl FROM pg_database WHERE datname = 'afldb_dev'"   # step 0
npm run db:promotion:check -- --environment dev --freeze-status

# step 3 set-up — terminal 2, an in-flight writer left OPEN. site_settings is written by afldb_auth
# (privileges.sql), NOT afldb_import: the import role gets "permission denied for table site_settings"
# and the probe is void (met on the 2026-09-26 rehearsal, §17 P5):
#   psql "$AFLDB_AUTH_DATABASE_URL"
#   BEGIN; INSERT INTO site_settings (key, value) VALUES ('i250.inflight_probe.<stamp>', '"probe"'::jsonb);
#   -- do not COMMIT

# steps 1–3 — terminal 1
systemctl list-units --all 'afldb*' --no-pager
sudo systemctl stop afldb                                   # plus every installed afldb-settle-* unit
npm run db:promotion:check -- --environment dev --freeze-plan --database afldb_dev --freeze-dir "$FREEZE"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -f - < "$FREEZE/promotion-freeze.sql"   # stdin: postgres cannot read ~arm (§17)
npm run db:promotion:check -- --environment dev --phase frozen --database afldb_dev \
    --freeze-manifest "$FREEZE/promotion-freeze.json" --freeze-record-out "$FREEZE/record.json"   # EXPECT FAIL: terminal 2's session
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -f - < "$FREEZE/promotion-terminate.sql" # terminal 2 is disconnected; its INSERT rolled back
npm run db:promotion:check -- --environment dev --phase frozen --database afldb_dev \
    --freeze-manifest "$FREEZE/promotion-freeze.json" --freeze-record-out "$FREEZE/record.json"   # EXPECT PASS; note wall time (step 12)

# step 2 — each must print "permission denied for database" (or "not permitted to log in")
psql "$AFLDB_IMPORT_DATABASE_URL" -c 'SELECT 1'
psql "$DATABASE_URL" -c 'SELECT 1'
psql "$AFLDB_AUTH_DATABASE_URL" -c 'SELECT 1'
sudo systemctl start afldb; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health; sudo systemctl stop afldb   # EXPECT non-200

# step 11 — autovacuum/VACUUM row as seen by the owner, while frozen
psql "$AFLDB_OWNER_DATABASE_URL" -c 'VACUUM (VERBOSE) public.nl_search_log' &
psql "$AFLDB_OWNER_DATABASE_URL" -c "SELECT pid, usesysid, usename, backend_type FROM pg_stat_activity WHERE datname = 'afldb_dev'"
wait

# step 5 — backup, restore test, dump proof (and a refusal with an older dump)
bash tools/maintenance/backup.sh --keep 14
PRE=$(ls -1t ~/backups/afldb/afldb_dev-*.dump | head -1); echo "$PRE"
bash tools/maintenance/restore-test.sh "$PRE"
npm run db:promotion:check -- --environment dev --phase freeze-dump --database afldb_restore_test \
    --freeze-record "$FREEZE/record.json" --pre-cutover-dump "$PRE" --freeze-dump-proof-out "$FREEZE/proof.json"   # EXPECT PASS
OLD=$(ls -1t ~/backups/afldb/afldb_dev-*.dump | sed -n 2p)
npm run db:promotion:check -- --environment dev --phase freeze-dump --database afldb_restore_test \
    --freeze-record "$FREEZE/record.json" --pre-cutover-dump "$OLD" --freeze-dump-proof-out "$FREEZE/proof-old.json"  # EXPECT FAIL (sha256)

# step 6 — a freeze-bound target read
npm run db:promotion:check -- --environment dev --phase pre-cutover --database afldb_dev \
    --snapshot "$FREEZE/snapshot.json" --freeze-record "$FREEZE/record.json"                      # EXPECT PASS

# step 7 — drift detection: an OWNER write to a production-owned table while frozen
psql "$AFLDB_OWNER_DATABASE_URL" -c "UPDATE site_settings SET updated_at = now() WHERE key = (SELECT min(key) FROM site_settings)"
npm run db:promotion:check -- --environment dev --phase pre-cutover --database afldb_dev \
    --snapshot "$FREEZE/snapshot-2.json" --freeze-record "$FREEZE/record.json"                    # EXPECT FAIL: public.site_settings changed

# step 10 — swap guard: with the marker removed by hand, the freeze-bound swap renames nothing
#   (generate a throwaway freeze-bound plan with --plan ... --freeze-record/--freeze-dump-proof for a
#    candidate name that does not exist, remove the marker, run promotion-swap.sql, EXPECT the guard to raise)

# step 9 — crash recovery: lose the freeze directory's release file
npm run db:promotion:check -- --environment dev --freeze-status                                  # prints LIVE DATABASE FROZEN + token
npm run db:promotion:check -- --environment dev --unfreeze-recovery --database afldb_dev \
    --freeze-token <token printed above> --freeze-dir "$FREEZE/recovery"
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -f - < "$FREEZE/recovery/promotion-unfreeze-recovery-<token8>.sql"    # EXPECT released
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -f - < "$FREEZE/promotion-unfreeze.sql"   # EXPECT refusal: not frozen by this token
npm run db:promotion:check -- --environment dev --freeze-status                                  # live, writable (normal)
psql "$AFLDB_IMPORT_DATABASE_URL" -c 'SELECT 1'                                                  # EXPECT success
sudo systemctl start afldb                                                                       # plus the stopped timers

# step 1 (F-002) — freeze → release → freeze: a second --freeze-plan in a new directory and its
# promotion-freeze.sql must now succeed on the post-release explicit ACL; release it again.
```

Steps 4 (prepared transaction; only if `max_prepared_transactions > 0`), 8 (happy-path swap and
post-swap acceptance) and 13 (guarded swap/rollback end to end) need a real candidate and so run
inside a full DEV promotion with the freeze, per `docs/production-promotion.md` §13.

## 13. Acceptance criteria

1. Implementation in place (checker phases, freeze/unfreeze/recovery generators, freeze-bound
   swap/rollback, restore-test binding, procedure and checklist updated).
2. DB-free tests cover every refusal in §7.5 and §9 and prove DEV unchanged; typecheck and lint
   clean; existing promotion tests green.
3. §12 rehearsal run and recorded with evidence (operator-authorised), including at least one
   failed promotion (step 7) and one crash recovery (step 9). **MET 2026-09-26 (§17).**
4. Operator acceptance recorded here. Only then is ISSUE-237 L5 unblocked. **2026-09-26: DEV
   REHEARSAL PASS / technically accepted for the ISSUE-237 L5 prerequisite**, under the operator's
   own stated rule for this run: every rehearsal case and the freeze-enabled DEV promotion and
   rollback passed (§17). L5 itself still needs its own authorisation.

## 14. Review

**`afldb-reviewer` (Fable), 2026-09-26: PASS WITH MEDIUM/LOW NOTES.** No CRIT or HIGH. The reviewer
verified on disk that the mechanism closes the §4 → swap window including the last-check → swap
race, that the `$PRE` selection path is real (`backup.sh` writes `.partial` then renames, so a
failed backup leaves the previous dump newest) and is closed, that no automated unit holds the
owner DSN, that `privileges.sql` has no database-level ACL statement, that `afldb_backup`'s
`pg_read_all_data` does not confer CONNECT (so the explicit grant is necessary), that the freeze
marker cannot collide with the rebuild marker, and that `--phase production` needs no running
application.

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| F-001 | MED | ACL guard must read the effective ACL (`datacl` is NULL on PROD) | folded (§7.3 step 1); every guard and gate uses `coalesce(datacl, acldefault('d', datdba))`; test pinned |
| F-002 | MED | Release must be the exact inverse (revoke `afldb_backup`, clear comment) | folded (§7.2); test pinned |
| F-003 | MED | Quiescence keyed on NULL `usesysid` could loop on autovacuum/operator sessions | folded (§7.3 step 3): FAIL = non-superuser role session; superuser WARN; role-less INFO; §12 step 11 observes autovacuum |
| F-004 | MED | Terminate must be a separate, token-guarded, re-runnable file | folded: `promotion-terminate.sql`; the freeze file terminates nothing |
| F-005 | LOW | Digest detects production-owned tables only | folded (§7.6 bound + operator rule) |
| F-006 | LOW | Re-check `$PRE` in the reinstate transcript | folded: `sha256sum --check` step 0 |
| F-007 | LOW | Numbered stop step listing every settle unit | folded (procedure §4.0, §9) |
| F-008 | LOW | `restore-test.sh` binding must hash first and fail loudly | folded (§7.4); test pinned |
| F-009 | INFO | Measure digest cost | §12 step 12 |
| F-010 | INFO | Record why role-level NOLOGIN was rejected | folded (§7) |
| F-011 | INFO | `--freeze-status`/recovery must not connect to the target | folded (§9) |

## 16. Implementation (2026-09-26, uncommitted, DB-free validated)

**Files (ISSUE-250 only):**

- `tools/db/promotion-freeze.ts` (**new**, pure): marker/manifest/token; `freezeSql`,
  `freezeTerminateSql`, `unfreezeSql`, `recoveryManifest`; `frozenGuardSql`, `frozenSwapSql`,
  `frozenRollbackSql`; the read-only observation SQL; `judgeFreezeState`; `freezeDigestTables`
  (generated from the contract), `readFreezeDigest` (pinned GUCs, reset afterwards),
  `judgeFreezeDigest`; freeze record and dump proof (build/parse, payload-hashed, bound to each
  other and to this checkout's table set); `restoreTestComment`; `sha256File`;
  `describeFreezeStatus`.
- `tools/db/promotion-check.ts`: `--freeze-plan`, `--freeze-status`, `--unfreeze-recovery` and
  the `--freeze-*` flags; phases `frozen` and `freeze-dump` (standalone, like
  `dev-regeneration-census`); `--freeze-record` **required under `prod`** for pre-cutover,
  restored, candidate, production and `--plan` (with `--freeze-dump-proof`); `candidate` opens the
  live target (pre-swap gate); `production` takes `--old-database <kept>` and gates the kept
  database by OID + F0 and the live database as the unfrozen candidate; `writePlan` writes the
  freeze-bound swap/rollback and the dump check only when bound. Still read-only by construction
  (no new `writeFileSync`; the generated SQL is never executed by the checker).
- `tools/db/promotion-inventory.ts`: phases `frozen`/`freeze-dump`, `RESTORE_TEST_DATABASE`,
  `PlanInput.preCutoverDumpSha256` + the transcript's step 0, and the acceptance checklist.
- `tools/maintenance/restore-test.sh`: the dump-sha256 binding (§7.4).
- `docs/production-promotion.md` (§4.0/§4.1, §5, §6, §7, §7.5, §8 order, §10, §13) and
  `docs/backup-restore.md` §2.
- `tests/db-promotion-check.test.ts`: 52 new DB-free tests (fake read-only database for the freeze
  phases) plus 6 existing argument tests updated to pass the now-required production freeze
  arguments.

**Validation (run 2026-09-26 on the Windows workstation; no database):**

- `npx vitest run tests/db-promotion-check.test.ts` — **264/264 PASS** (212 pre-existing + 52 new).
- `npx tsc --noEmit -p .` — **clean** (exit 0).
- `npx eslint` on the four changed TypeScript files — **clean** (0 errors, 0 warnings).
- Adjacent DB-free suites (`db-test-rebuild`, `data-overrides-source-contract`,
  `issue248-cleanup-dev-auth-fixtures`, `reference-data`, `afl-api-identity-correction`):
  811/814; the 3 failures are outside this change's files and pre-date it (an unresolved
  `data/reference/afl-api-identities.json` import in a reachability test, an `INSERT INTO`
  assertion on rebuild tooling, and a post-045 table-list mismatch in `reference-data`).

**What the tests prove:** freeze absent → every production phase and plan refuses; a valid freeze
is accepted; wrong database / non-live name / wrong environment refuse; a stale or foreign marker
(another token, the rebuild marker, none) refuses; a second freeze plan refuses; an in-flight
writer, a writer arriving during the digest, and a prepared transaction each block the record;
zero-row tables follow the same protocol; an older or unbound dump refuses; pre-swap drift
refuses; post-swap drift (the last-check → swap gap) and a different physical database refuse
acceptance; the swap and rollback run nothing unless the right database carries the token; the
rollback leaves the original frozen and only the token-guarded release reopens it; crash state is
reported (frozen live, missing live, inconsistent); DEV plan files are byte-identical without a
freeze.

**What only a rehearsal can prove (§12):** PostgreSQL's real behaviour for the REVOKE on a NULL
`datacl`, connection refusal per role, termination and exit of sessions, autovacuum rows as seen by
`afldb_owner`, digest determinism between the kept database and `afldb_restore_test`, digest wall
time, the guarded swap/rollback end to end, and `systemd` unit handling.

## 17. DEV rehearsal (2026-09-26, operator-authorised, DEV only): PASS

**Authorisation and boundary.** The operator authorised the §12.1 DEV freeze rehearsal and a full
freeze-enabled DEV promotion and rollback, on DEV only. The authorisation excluded PROD,
`afldb_prod`, ISSUE-237 L5, deployment, and every Git mutation. The `sudo` steps ran through a
temporary, operator-installed drop-in, `/etc/sudoers.d/afldb-i250`. It allows `postgres`:
`psql`, `createdb` and `dropdb`, and `root`: `systemctl stop|start afldb` only. The operator
removes it.

**Code under test.** The live checkout (`~/projects/afldb`, `dd7e28a6`) was left untouched. The
rehearsal ran from `~/i250/afldb`, an rsync of that checkout with `node_modules` and `.env`
symlinked. The four ISSUE-250 files from this worktree were overlaid, LF-normalised, and their
sha256 verified equal on both hosts:

| File | sha256 |
|---|---|
| `tools/db/promotion-check.ts` | `2819cde6…9e64e70` |
| `tools/db/promotion-inventory.ts` | `c26048f5…d9c3` |
| `tools/db/promotion-freeze.ts` | `ab72379a…0bf2` |
| `tools/maintenance/restore-test.sh` | `270adda8…48c8` |

`tools/db/*` does not differ between `dd7e28a6` and this worktree's HEAD, `7bcf6ef9`.

**Evidence.** Everything is retained on DEV:

- `~/i250/evidence/*.log`: one log per phase — `p1`, `p1b`, `p3`, `p6`, `p7`, `p8`, `p9`,
  `p10`, `p12a`–`p12d`, `p13`, `p14`, plus the B4, C2, reinstatement and production logs.
- `~/i250/state.env` and the phase scripts `~/i250/p*.sh`.
- The freeze directories `~/backups/afldb/promotion-dev-20260926-194554-freeze`,
  `…-cycleB-freeze`, `…-cycleC-freeze` and `promotion-dev-20260926-195601-freeze`.
- The plan directory `promotion-dev-20260926-195601/` and its `.sha256` ledger.

No DSN or password was printed. Every psql and pg_* call passed the password through `PGPASSWORD`.

### 17.1 Results by phase

| Phase | Result | Evidence (key lines) |
|---|---|---|
| P1 pre-capture | PASS | DEV host `streamanator`; checkout `dd7e28a6`, where the only dirty files are 3 untracked settle manifests. `afldb.service` active, health 200, no afldb timers installed. The preflight proved every DSN names `afldb_dev` with its role: `afldb_owner`, `afldb_import`, `afldb_backup`, `afldb_app`, `afldb_auth`. The source is `afldb_test`/`afldb_owner` with parity 104/104. The DEV `.env` mentions `afldb_prod` 0 times and the PROD IP 0 times. `afldb_dev` oid **202860**, `datacl` **NULL** (F-001's expected state), no comment. `max_prepared_transactions=0`; `--freeze-status` normal. Safety backup `afldb_dev-20260926-193040.dump` (sha `01987934…`), proven by `restore-test.sh` (parity 9/9, binding comment written). |
| P2 artefacts | PASS | `--freeze-plan` refused `afldb_prod` (dev), `afldb_dev` under `--environment prod`, and `afldb_test`, and wrote no directory for any of them. The DEV plan: token `0f92ba197fd589f386eeb4f826509c51`; the manifest binds `environment=dev database=afldb_dev`. All four files hold 0 occurrences of `afldb_prod` or `environment=prod`. The SQL was read in full before it ran. |
| P3 freeze | PASS | `promotion-freeze.sql` committed. `datacl` became `{afldb_owner=CTc/afldb_owner,afldb_backup=c/afldb_owner}` and the marker was set. `has_database_privilege(…,'CONNECT')` is false for app, auth and import, and true for backup and owner. `promotion-terminate.sql` found 0 sessions (app stopped). `--phase frozen` PASSed and wrote the record: oid 202860; **F0: 36 tables, 80,841 rows, digest `95390626d3e1f4a7…`**. Prepared xacts: 0. |
| P4 refusal | PASS | `afldb_app`, `afldb_auth` and `afldb_import` each got `FATAL: permission denied for database "afldb_dev" / User does not have CONNECT privilege`. `afldb_backup` and `afldb_owner` connect. `afldb` started while frozen served `/api/health` 503 (`{"status":"error","database":"unreachable"}`), and its journal showed `permission denied for database "afldb_dev"`. `--freeze-status` printed `LIVE DATABASE FROZEN` with the token. A freeze-bound `pre-cutover` after the app attempt PASSed (quiescent, digest = F0). |
| P5 in-flight | PASS (at the second attempt) | Attempt 1 was **void**: the runbook's set-up used `afldb_import`, which has no privilege on `site_settings` (`permission denied for table site_settings`), so no transaction was ever open (R-2). Redo, cycle B: an `afldb_auth` session held an uncommitted INSERT of `i250.inflight_probe.cycleB.20260926-194554` (`idle in transaction`, xid held). Then:<br>• the freeze committed;<br>• `--phase frozen` **REFUSED** (`1 other session(s) still connected … pid 2081188 afldb_auth`) and wrote no record;<br>• `promotion-terminate.sql` terminated it (`t`);<br>• `--phase frozen` PASSed;<br>• the writer's later `COMMIT` died with `FATAL: terminating connection due to administrator command`;<br>• probe rows: **0**. |
| P6 stale dump | PASS | A backup while frozen, `PRE=afldb_dev-20260926-194759.dump` (sha `7abddddf…`), passed restore parity 9/9, and `freeze-dump` PASSed (= F0). **Refusals:**<br>• **A** — naming the safety dump while `afldb_restore_test` held PRE: `a different dump was restored`.<br>• **B** — L4's older pre-cutover dump (`…085910`): `restore-test.sh` parity FAILed (3 checks), so no binding was written. `freeze-dump` then FAILed twice: `carries no restore-test.sh proof comment`, and `5 table(s) changed` (`auth_audit_log` 958≠962, `auth_sessions`, `auth_users`, `data_edits`, `player_link_match_candidates`).<br>• **C** — the pre-freeze safety dump restored and bound: **PASSed**, because its production-owned content was byte-identical to F0 (R-3).<br>At `--plan`, a dump that is not the proven one was REFUSED: `hashes to 01987934…, but --phase freeze-dump proved 7abddddf…`. |
| P7 drift | PASS | An owner `UPDATE site_settings SET updated_at = now()` on key `acquisition.afl_api_brownlow_enabled` made the freeze-bound `pre-cutover` **REFUSE**: `public.site_settings: 17 row(s) digest 5cf0cf1c…, frozen … 63284785…`. A dump of the drifted state passed `restore-test.sh` and was bound, but `freeze-dump` **REFUSED** it on the same table. The exact original value (`2026-09-23 00:18:47.532027+00`) was then restored: the row md5 `15332097…` equals the original, and the gate PASSed again with digest = F0. |
| P8 crash / recovery | PASS | **Swap guard:** a throwaway freeze-bound plan's swap, run while frozen with a non-existent candidate, raised `candidate … does not exist; refusing` before any terminate or rename. **Abandoned freeze:** with `promotion-unfreeze.sql` moved to `lost/`:<br>• `--freeze-status` printed the token, which matched the manifest;<br>• app, auth and import were still refused;<br>• `--unfreeze-recovery` refused `afldb_test`, `afldb_dev_pre_rebuild_20260926-085511`, `afldb_prod` and `afldb_restore_test`, and wrote no file;<br>• a wrong-token recovery file generated, but its guard raised `not frozen by this token … nothing released`, and DEV stayed frozen;<br>• the recovery file built from the status token matches the lost original's non-comment lines exactly, and it released DEV;<br>• the lost original then refused (`comment: <none>`).<br>After release, the swap and rollback guards on the unfrozen live database raised, and nothing was renamed. All roles reconnected; health 200. |
| P9 cycle | PASS | Freeze B (token `2cc2c902…`) → proved → released → access restored → freeze C (`ba03ba01…`) → proved → released. Both freezes ran on the **post-release explicit ACL** `{afldb_owner=CTc/afldb_owner,=Tc/afldb_owner}` (F-002). F0 was identical in every record. Health 200 after each release. |
| P10 privileged sessions | PASS (autovacuum not observed) | A superuser session gave **WARN** (`superuser session(s) connected … pid … postgres`), and the record was still written. A stray owner session and an `afldb_backup` session each **FAIL**ed, by design (F-003). The runbook's owner `VACUUM (VERBOSE) public.nl_search_log` appears to the owner as `afldb_owner | client backend`. **No autovacuum worker ran on `afldb_dev` during the 150-second sampler** (the last autovacuum was at 16:07; DEV was idle). The role-less INFO path is therefore still unobserved live (R-6). |
| P11 timing | recorded | 36 tables / 80,841 rows. `--phase frozen` 1.97–2.06 s; `freeze-dump` 2.13–2.22 s; freeze-bound `pre-cutover` 2.22–2.31 s; `candidate` 2.27 s; `production` 2.16 s; each `restore-test.sh` run 10–13 s; each `backup.sh` run 10 s. No operational concern at DEV size. The digest runs six times per promotion, so about 13 s in total. |
| P12 full promotion | PASS | Stamp `20260926-195601`, token `cf6fd6541b08041ad9ddf8cdd9d26871`, detailed in §17.2. |
| P13 rollback | PASS | Detailed in §17.3. |
| P14 postchecks | PASS | Exactly one live `afldb_dev`, the original oid 202860, with no comment. 0 freeze markers on any database and 0 prepared xacts. `--freeze-status` normal; `afldb` active; health 200. All five roles connect to `afldb_dev`. Probe rows 0. `afldb_dev` still holds exactly F0. No stray rehearsal process. |

### 17.2 Full freeze-enabled DEV promotion (P12)

1. **A3 source G1:** PASS, 802 rows (3/129/397/273), importer sha `e04a5776…`.
2. **A4:** ledger 0; manual registrations 92 on DEV and 92 on `afldb_test`; A4.3 no rows.
3. **§4.0:** the app stopped, then freeze, terminate (0 sessions) and `--phase frozen`, which PASSed with F0 equal to §17.1's.
4. **§4.1:** `PRE12=afldb_dev-20260926-195611.dump` (sha `0d28d9b2…`), a fresh dump taken while frozen. Restore parity 9/9. `freeze-dump` PASSed (= F0).
5. **§5 / A5:** `pre-cutover --snapshot … --freeze-record` PASSed, 15 gates, including frozen + quiescent + F0. Target importer rows 803, sha `c138a731…`.
6. **§6:** a fresh `afldb_test` dump (sha `ddd5d9f4…`), then a new candidate `afldb_dev_candidate_20260926-195601`, oid **245069**. Only the two tolerated extension-owner errors appeared.
7. **B4 (`restored` + `--freeze-record`), run 1:** REFUSED on exactly two gates:
   - `external_grids.import_batch_id → import_batches: 2 … missing in the candidate` (the L4 "grid repair" case);
   - G3 `CD_I297354: FAIL (hard_loss)`.

   The ISSUE-250 target gates PASSed.
8. **§7.4b option 1 (candidate only; R-7).** The two referenced batches were reinstated from the
   sha-verified `PRE12`:
   - `pg_restore --data-only --table=import_batches -f -` was filtered to ids 82 and 84, giving a header, 2 rows and a terminator;
   - loaded with `psql --single-transaction` (`COPY 2`);
   - `setval(pg_get_serial_sequence('public.import_batches','id'), max(id))` returned 84;
   - per-row md5 on the candidate equals `afldb_dev`'s (82 `f2954193…`, 84 `6c62fb80…`).
9. **B4 run 2:** the §6.3 generator wrote `afl-api-dev-regeneration-20260926-195601.json` (one entry, `CD_I297354`), sha `1ebb8b8b…`.
10. **B4 run 3:** PASS, 23 gates. It included:
    - the freeze gates;
    - 92/92 ISSUE-242 rebinds;
    - A4.2 (present 92) and A4.3 PASS;
    - E_promotion = ∅;
    - G3 `CD_I297354: WARN (hard_loss_regeneration)`.

    It wrote the lineage file (`c0e54da4…`) and the E file (`0bc4f836…`).
11. **B5 plan:** `--freeze-record` + `--freeze-dump-proof` gave a freeze-bound plan. `promotion-reinstate.sh` step 0 is `sha256sum --check` of `PRE12`. The swap and rollback carry the token guards.
12. **C1:** the transcript was followed verbatim (step 0 `OK`). Stage-completion readback: `afl_api_identity_adjudications|0`, `brownlow_vote_entry_state|3`, `external_grid_sources|1`. 2d printed the ISSUE-247 permitted-empty NOTICE. Resync, audit marker and `privileges.sql` followed.
13. **C2 (`candidate` + `--freeze-record`):** PASS, 15 gates, including `live target afldb_dev frozen and quiescent` and `holds exactly the frozen state F0`. C3: the E file was unchanged.
14. **D:**
    - Before the swap, the real rollback file refused (`afldb_dev_pre_rebuild_20260926-195601 does not exist`).
    - The swap ran with the app stopped and 0 sessions terminated. It renamed oid 202860 to `afldb_dev_pre_rebuild_20260926-195601` (still frozen, same token) and oid 245069 to `afldb_dev`.
    - `--phase production --freeze-record --old-database afldb_dev_pre_rebuild_20260926-195601` ran **before the app started** and PASSed 13 gates:
      - kept oid 202860 frozen;
      - kept holds exactly F0;
      - the promoted live database is the candidate (oid 245069), unfrozen.
    - Only then did `afldb` start; health 200.
15. **E / F:**
    - E1 replay loop: all nine branches ran, none raised.
    - E1b first-kick-goal: `recreated 1` (census 335).
    - E2: `{inserted 0, noops 0, stops [], supersedes []}`.
    - E3: `afl_api identity invariant: OK`.
    - F1 `pre-cutover`: PASS, 802 importer rows.
    - The §6.3 `dev-regeneration-census` was **not** run and is not due: this promotion was deliberately rolled back (P13). A kept promotion would owe it after §9.

### 17.3 Guarded rollback (P13)

1. A rollback plan bound to **another** freeze token (P3's `0f92ba19…`, same candidate name) raised
   `afldb_dev_pre_rebuild_20260926-195601 is not frozen by this token`. Nothing was renamed.
2. With `afldb` stopped, the real `promotion-rollback.sql` (hash re-verified) returned oid
   **202860** as `afldb_dev`, **still frozen** (marker `cf6fd654…`, ACL frozen). The promoted
   database went back to `afldb_dev_candidate_20260926-195601` (oid 245069).
3. While still frozen, app, auth and import were refused, and `afldb` served 503. A freeze-bound
   `pre-cutover` PASSed: quiescent, exactly F0, first-kick-goal census 335.
4. `promotion-unfreeze.sql` (same token) released it. All roles connect; health 200.
5. Writes made to the promoted database during its roughly one-minute live window (the E1b
   recreate, app sessions and health events) stay in `afldb_dev_candidate_20260926-195601`, per
   the §10 contract.

### 17.4 Findings

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| R-1 | MED | `sudo -u postgres psql -f ~/backups/afldb/…` cannot open the generated files. `/home/arm` is 750 and the files are 600, so the documented freeze, swap, rollback and release commands fail with `Permission denied` and run nothing. This fails safe, but the procedure cannot be executed as written. Proven live in P3. | **Fixed in docs.** `docs/production-promotion.md` §4.0, §8 and §10 and §12.1 here now use `sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d postgres -f - < "$FILE"`, the form every step of this rehearsal used. |
| R-2 | LOW | §12.1's in-flight set-up used `afldb_import`, but `site_settings` is written by `afldb_auth` (`privileges.sql`). | **Fixed in §12.1**; P5 was redone correctly. |
| R-3 | LOW | Docs claimed that "a dump taken before the freeze is refused". The proof is by content: a pre-freeze dump byte-identical to F0 is accepted (P6.5). The safety property holds, because nothing can be lost. | **Fixed in docs** (`docs/production-promotion.md` §4.1 wording). |
| R-4 | LOW | A REFUSED `--phase pre-cutover` still writes its `--snapshot` file (`snapshot-drift.json`, P7). The same pre-existing behaviour is noted in ISSUE-237 §11d.14. | Open follow-up. Operator rule: never reuse a snapshot from a refused run. Not changed here. |
| R-5 | LOW | The generated SQL header comments (`promotion-freeze.ts:204/256/274`) still print the `-f <file>` form that R-1 shows cannot work. | Open follow-up, a code-text change for the commit review. Not changed here, to keep the reviewed code byte-identical to what was rehearsed. |
| R-6 | INFO | No autovacuum worker ran on `afldb_dev` while frozen. The superuser path is WARN, and the owner and backup paths are FAIL, as designed. So the quiet check must never run while `backup.sh` is dumping; the procedure never overlaps them. | Record only. |
| R-7 | INFO | Any DEV promotion from the current `afldb_test` needs the §7.4b option-1 reinstatement of `import_batches` 82/84. The exact, hash-bound commands are in §17.2 step 8, which is the first written record of L4's "targeted grid repair" shape. DEV G3 also needs the §6.3 classification for `CD_I297354`. | Record; not an ISSUE-250 defect. |
| R-8 | INFO | After the first release, `afldb_dev.datacl` is materialised as `{afldb_owner=CTc/afldb_owner,=Tc/afldb_owner}`, which is equivalent to the default. Later freezes accept it (P9, P12). | By design (F-002). |

### 17.5 Unrelated test failures (the 811/814 run), re-checked

Rerunning the adjacent DB-free suites plus the promotion suite on the workstation gives
**1075/1078**. The three failures are the same three signatures as before:

1. `tests/db-test-rebuild.test.ts` › *AFLDB-ISSUE-235 I18 fixture harness (DB-free)* › *teardown
   and verify run under plain tsx…*: `Error: unresolved import
   '../../../data/reference/afl-api-identities.json' from src/db/queries/afl-api-player-links.ts`.
   The file exists; the test's import-graph resolver does not resolve `.json`.
2. `tests/db-test-rebuild.test.ts` › *AFLDB-ISSUE-237 recovery attribution actor* › *never
   populates a credential…*: `expected 'export async function remapActors(\r\…' not to contain
   'INSERT INTO'`. This is a **Windows CRLF artefact** of the test's source slicing.
3. `tests/reference-data.test.ts` › *§H12* › *finds the tables created after 045…*: `expected [
   …(18) ] to deeply equal [ 'app_health_events', …(16) ]`.

**Differential on Linux (DEV)**, running `tests/db-test-rebuild.test.ts` and
`tests/reference-data.test.ts`:

- in a copy of the deployed **baseline `dd7e28a6` without ISSUE-250**: failures 1 and 3 reproduce
  with identical signatures;
- in the ISSUE-250 overlay: the same two, and nothing new;
- failure 2 does not occur on Linux in either copy.

The baseline's 2 skips come from that copy having no `.venv`.

ISSUE-250 changes none of the implicated files: neither test file, nor
`src/db/queries/afl-api-player-links.ts`, `tools/migration/`, `data/reference/` or the
reference-data table list. The overlay's `tests/db-promotion-check.test.ts` is **264/264 on Linux**
too. None of the three is an ISSUE-250 regression, and none is fixed here.

### 17.6 State left behind

- **Live:** `afldb_dev` (oid 202860), released; `afldb` active.
- **New retained databases:** `afldb_dev_candidate_20260926-195601` (oid 245069; the promoted,
  then rolled-back, candidate, holding its post-swap writes).
- **Pre-existing databases, untouched:** `afldb_dev_candidate_20260926-033212`,
  `afldb_dev_pre_rebuild_20260906-112500`, `afldb_dev_pre_rebuild_20260926-085511`, `afldb_test`
  and `afldb_test_pre_rebuild_20260825`.
- **`afldb_restore_test`** holds `PRE12` with its binding comment.
- **New dumps:**
  - `~/backups/afldb/afldb_dev-20260926-193040.dump` (safety), `-194759.dump` (PRE, P3–P11) and
    `-195611.dump` (PRE12);
  - `~/i250/dumps/afldb_dev-20260926-195304.dump` (the drift-state dump, kept out of the backup
    series);
  - `/home/arm/afldb_test_rebuilt_20260926-195601.dump`.

  `backup.sh` ran with `--keep 30`, so no older backup was pruned.
- **Scratch trees** `~/i250/afldb` and `~/i250/baseline`, and the evidence tree.
- **Cleanup is the operator's:** the retained candidate, the scratch trees and the sudo drop-in.

### 17.7 Validation of record at commit (2026-09-26)

Established before the ISSUE-250 local commit; nothing was re-run for the commit.

- Design review (`afldb-reviewer`): PASS WITH MEDIUM/LOW NOTES, no CRITICAL/HIGH (§14).
- Focused promotion suite `tests/db-promotion-check.test.ts`: 264/264 (§16).
- Promotion/docs tests after the §17 rehearsal fixes: 329/329.
- ISSUE-238 + promotion suites together (earlier run): 336/336.
- TypeScript (`tsc --noEmit`) clean; ESLint clean on the changed files.
- DEV freeze rehearsal PASS; full freeze-enabled DEV promotion PASS; guarded rollback PASS; final
  DEV health 200 (§17.1–§17.3). PROD was never contacted.
- The adjacent-suite run is **811/814, not a full green suite**: three reproduced, unrelated,
  pre-existing failures (§17.5).

## 15. History

- **2026-09-26: opened** under D-P5-1 during the ISSUE-238 design pass 5. Documentation only.
- **2026-09-26: design pass 1** (§2 second path, §4–§13). Read-only inspection only.
- **2026-09-26: reviewer PASS WITH MEDIUM/LOW NOTES; corrections folded; implemented and
  DB-free validated** (§14, §16). Uncommitted. No database touched.
- **2026-09-26: DEV rehearsal PASS** (§17), operator-authorised, DEV only: every §12 case, a full
  freeze-enabled DEV promotion (`20260926-195601`) and its guarded rollback. R-1..R-3 fixed in the
  docs; R-4/R-5 open LOW follow-ups. **Technically accepted for the ISSUE-237 L5 prerequisite.**
  Uncommitted. PROD never contacted.
