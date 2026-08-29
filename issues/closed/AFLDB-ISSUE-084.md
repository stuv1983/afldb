# AFLDB-ISSUE-084 — proposed execution runbook, **revision 5** (for review)

**This plan file holds the full proposed content of `AFLDB-ISSUE-084.md`.**
Plan mode permits editing only this file. On approval the identical content is
written to `d:/dev/afldb/AFLDB-ISSUE-084.md` and this session stops.

Revision 5 fixes one approval blocker and two consistency defects. **Scope, the
approved phase ordering and every revision-2/3/4 safety improvement are
unchanged.** No broadening into ISSUE-081/082/083/085/086.

### What changed from revision 4

| # | Finding | Resolution in revision 5 |
|---|---|---|
| 1 | **Approval blocker.** §3.4 restored the migration-057 `<G1_DUMP>` over a migration-070 `afldb_prod` with `pg_restore --clean --if-exists`, which drops only objects the **archive** contains — so every 058–070-only object would survive and the result would be a hybrid, not a 057 database | §3.4 rewritten. The defect is stated with its own proof (`player_link_match_candidates` must be absent at 057; the original audit's **S17** asserts exactly that; and 067's FKs would even make a plain archive `DROP TABLE players` fail). Recovery now uses the repository's own clean-target step — `restore-test.sh:99-118`'s clearing statement, reused verbatim and shipped as a hash-verified file rather than nested in a quoted SSH string. Sufficiency is **proved**: migrations 058–070 create only tables, indexes, columns and constraints — no schema, function, type, view, matview, sequence or trigger (all thirteen files searched; the four schemas in use pre-date 057) — so a table-level `CASCADE` pass removes everything. A documented `dropdb`/`createdb` fallback is derived from `00_install_postgres_prod.sh:142,149-154`, with an explicit warning not to re-run that script (it rotates every role password). A **six-check gate** now runs before the old application starts: identity, high-water mark exactly 057, no post-057 object, privileges reconciled from `a32a0a1`, **the original 057-pinned ISSUE-079 audit passing again** (its S16/S17 are what a survivor would trip), and E1 data parity. Argv-safe credential handling is preserved throughout |
| 1b | Gate G1 did not prove the recovery *method*, only that the dump restores | Gate G1 gains **requirement 5** and a new **§3.3a**. The rehearsal is now two steps: bring `afldb_restore_test` to the **070 shape** first (the script's documented no-argument form, whose parity checks legitimately pass), then restore the 057 dump over it — the exact situation a real rollback faces. Queries **A–E** then assert the ledger reads 57 / `057_data_edits.sql` and that every 058–070 table, column, index and constraint is gone, `honour_team_uq` is back, and `player_link_resolutions` is back to 9 columns. §3.4 must not run in production unless that rehearsal passed |
| 2 | "STOP on the gate" (§8.3), "every non-PASS continues" (§8.4) and "STOP = halt, do not proceed" (§13.4) contradicted each other | New **§2.6** defines exactly three verbs — **HALT**, **BLOCK**, **RETRY** — and states that **STOP is shorthand for HALT and nothing else**. §8.3 now evaluates the **schema gate first and separately**: a refusal (missing 059 index, absent `player_link_match_candidates`, surviving `honour_team_uq`, wrong high-water mark) is a **HALT** on the deployment and is explicitly *never* recorded as an awards-reload ambiguity; an audit that cannot complete is RETRY-then-HALT; only a classification, keyset or exposure finding **taken after the schema gate passed** is a **BLOCK**. Phase 9 gains an **entry condition**: never enter `--rekey` out of a HALT. §13.1, §13.2, §13.4, §14 and §15 restated in the same vocabulary |
| 3a | §3.3's Gate-G1 text read as if clearing followed the restore | Corrected to the script's real order — banner, then `clearing afldb_restore_test`, then `pg_restore` — with `restore-test.sh:99-118` cited and the reason stated: a failed restore must not leave the previous generation for the checks to pass against |
| 3b | §14 said "the audit in 8–9 ran … i.e. Phase 10 completed" | Now states explicitly that **both** the Phase-8 Profile-B audit and the Phase-10 post-070 integrity audit completed while `afldb` was still stopped, with the service starting only at Phase 11.1 |

---

# AFLDB-ISSUE-084 — production rollout of the ISSUE-044/078/080 player-link protections

Approved execution runbook, **revision 5**. Execute **one checkpoint at a
time**. The user runs every command; Claude analyses the returned evidence
between checkpoints and authorises the next.

Detailed history lives in `issues.md` (`AFLDB-ISSUE-044`, `-078`, `-079`,
`-080`, `-083`) and in `AFLDB-ISSUE-079.md` / `AFLDB-ISSUE-080.md`. This file
does not restate it.

---

## 0. Objective and scope

Bring `afldb_prod` and the production checkout to the repaired state:

- schema at migration **070**;
- role privileges reconciled by the deployed `tools/maintenance/privileges.sql`,
  **tables and sequences**;
- the three corrected loaders deployed — `import_awards.py` at its ISSUE-080
  version with matching `common.py` and `awards-admin.ts`, `import_draft.py`,
  `import-first-kick-goal.ts`;
- the Profile-B ISSUE-080 audit produced, classified **PASS**, and recorded;
- the one-time `--rekey` completed once, or proven inapplicable;
- a regenerated post-070 ISSUE-079 audit clean against the pre-rollout
  baseline;
- application health normal on the real application host.

**Out of scope, deliberately:** any awards/honours/draft/legacy data reload;
`rebuild_derived.py`; loading 22 Under 22 data into production; and
ISSUE-081/082/083/085/086.

### Authoritative starting state (verified this session)

| Statement | Verified |
|---|---|
| Prod audited clean at migration 057 | Yes — 6 resolutions / 0 dangling, 2 suggestions / 0 dangling, snapshot `2026-08-23 06:57:52+10` |
| Deployed prod checkout `a32a0a1abacbf49a979343094b28c7983ebbea33` | Yes — ISSUE-079 Phase 0a and the ISSUE-080 Plane-A artifact |
| Migrations 058–070 and the ISSUE-044/078/080 repairs undeployed | Yes |
| ISSUE-084 owns the prospective rollout, not historical remediation | Yes |
| Awards deployment must be the ISSUE-080-corrected `import_awards.py` | Yes — deployment prerequisite per the ISSUE-080 handoff |
| A regenerated Profile-B ISSUE-080 audit is required | Yes |
| Production `--rekey` is one-time, per the ISSUE-078 contract | Yes |
| The 057-pinned ISSUE-079 SQL cannot be rerun post-migration | Yes — assertions S16/S17 pin it and will refuse |

### The two user decisions this runbook implements

1. **No production awards/honours reload.** `import_awards.py` is deployed but
   never executed. The regenerated **Profile-B ISSUE-080 audit is still run and
   recorded inside ISSUE-084**, produced from the exact deployment-candidate
   code and the canonical SQLite artifact, and retained as the fail-closed gate
   for the first *future* production awards/honours reload. If that future
   reload consumes a different artifact or keyset, the gate is rerun and
   reclassified under the recorded staleness rules.
2. **Staged deployment with service and write isolation.** Everything the
   tooling safely permits is prepared before the outage; `afldb` is stopped
   before the first schema mutation and stays stopped **through every
   irreversible and data-integrity-proving phase**; it starts only after the
   post-070 integrity audit has passed. **Checkout `a32a0a1` must never serve
   traffic against the migrated schema.** No restart between individual
   migration or privilege steps.

---

## 1. Environment facts (established from the repository — do not re-derive)

| Fact | Value | Source |
|---|---|---|
| Production host | DigitalOcean droplet `afldb-prod`, 2 vCPU / 4 GB, SYD1; SSH alias **`afldb`** | `docs/production-cutover.md:127-145`; `AFLDB-ISSUE-079.md` Phase 3 |
| Development host | `arm@10.0.40.100` (`streamanator`), 24 cores; SSH alias **`dev`** | `docs/deployment.md:30`; `AFLDB-ISSUE-079.md` Phase 3 step 3 |
| Project path (both hosts) | `/home/arm/projects/afldb` | `AFLDB-ISSUE-079.md` Phase 3 (`ENVF`) |
| Production database | `afldb_prod`; roles `afldb_owner`, `afldb_app`, `afldb_import`, `afldb_auth`, `afldb_backup` — **no `_prod` suffix** | `tools/maintenance/00_install_postgres_prod.sh:12,17,52` |
| Prod `.env` DSNs | `AFLDB_OWNER_DATABASE_URL` **and** `AFLDB_PROD_DATABASE_URL` both point at `afldb_prod` | `00_install_postgres_prod.sh:221-231` |
| **Application public host** | **`https://beta.afldb.com`** → `reverse_proxy 127.0.0.1:3100`, carrying `health_uri /api/health` | `deploy/Caddyfile.production` |
| **Apex `afldb.com`** | **Static coming-soon site** from `/var/www/afldb-soon`. Only `/api/early-access*` proxies to the app. **There is no `/api/health` on the apex** | `deploy/Caddyfile.production` |
| `www.afldb.com` | Permanent redirect to the apex, nothing else | `deploy/Caddyfile.production` |
| App port | `PORT` from `.env` (template value `3100`), matching the Caddy proxy target | `.env.example:44`; `deploy/afldb.service` sets no `Environment=PORT` |
| Service | `afldb.service`, `ExecStart=node deploy/server-cluster.mjs`, which imports `.next/standalone/server.js`; `EnvironmentFile=/home/arm/projects/afldb/.env` | `deploy/afldb.service:12,19,23`; `deploy/server-cluster.mjs:180` |
| Secondary unit | `afldb-email-intake.timer` (5 min) → `afldb-email-intake.service`, `Type=oneshot`, plain `python3`, **holds no database DSN**; it POSTs to `127.0.0.1:$PORT` and writes only through the app's route | `deploy/afldb-email-intake.{service,timer}` |
| Migration runner | `npm run db:migrate` → `AFLDB_OWNER_DATABASE_URL`; `AFLDB_MIGRATE_TARGET=prod npm run db:migrate` → `AFLDB_PROD_DATABASE_URL`. **It parses `.env` itself.** Each migration runs in its own transaction; forward-only; refuses if an applied migration's checksum drifted | `tools/db/migrate.ts:40-84,141-186` |
| Privilege runner | `npm run db:privileges` → `psql "$AFLDB_OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -f tools/maintenance/privileges.sql`. **It does not load `.env`**, and there is no `.npmrc`, so the variable must be in the environment — and the DSN reaches psql's argv. See §6.1 | `package.json`; repository has no `.npmrc` |
| Build | `npm run build` = `next build` + `tools/build/prepare-standalone.mjs`; **both required**. `next build` loads `.env` itself (which is why the documented routine deployment sources nothing); `prepare-standalone.mjs` is a separate process reading `process.env.AFLDB_ENV` **from the shell only** | `docs/deployment.md:51-73`; `tools/build/prepare-standalone.mjs:33-39` |
| Backup | `bash tools/maintenance/backup.sh` → `AFLDB_BACKUP_DATABASE_URL`, `pg_dump -Fc --no-owner`; **sources `.env` itself** (`backup.sh:21`); written `.partial` and renamed only after `pg_restore --list` verifies it; `~/backups/afldb/afldb_prod-YYYYmmdd-HHMMSS.dump`, mode 600 | `tools/maintenance/backup.sh:21,40,81-114` |
| Restore rehearsal | `tools/maintenance/restore-test.sh [<abs-path.dump>]` **sources `.env` itself** (`:18`), restores into **`afldb_restore_test` and refuses any other target**, empties it first, tolerates only the two extension-owner errors, then runs 9 parity checks **against `$AFLDB_OWNER_DATABASE_URL`**. `afldb_restore_test` exists on the **dev** host and **not** on the droplet | `restore-test.sh:9-12,18,45,65-80,107-198` |
| Documented restore | `pg_restore --clean --if-exists --no-owner --no-privileges --jobs=N <dump>`, **then privilege reconciliation — not optional**, because the dump carries no ACLs | `docs/backup-restore.md:119-145` |
| Stale-checkout hazard | "a stale checkout's `privileges.sql` run would revoke the grants" | `issues.md:1068` |
| Sequence contract already proven on test | `privileges.test.ts` asserts `afldb_import` holds "INSERT-and-nothing-else on both audit tables and USAGE-and-nothing-else on their sequences" | `issues.md:1064` |
| Legacy SQLite | `/home/arm/projects/sports_data_lab/data/afl/afl.db` on the **development** host; 537,010,176 bytes; sha256 `a56fef4e79f3583a5dfa773190412abd4b4a3eca347a8ec95de6d1b960eac547`. **Not present on production** | `scratchpad/issue-080-planeb-dev-20260823-v2.json` |
| DSN parser | `scratchpad/afldb-dsn-parse.py`, sha256 `eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f`. CLI: `--identity\|--password <env-file> <var-name>`; prints only non-secret identity fields, or only the decoded password; never the raw URL; exits 3 on any malformation | parser source; `AFLDB-ISSUE-079.md` §2a |

---

## 2. Dependency ordering — proved, not inferred

### 2.1 What each object actually requires

| Object | Requires | Evidence |
|---|---|---|
| `059_honour_team_member_identity.sql` | no duplicate `(team_name, player_id)` among linked `honour_team_members` rows — otherwise it raises and the migration rolls back; it also `DROP CONSTRAINT honour_team_uq` by exact name | migration 059:14-38 |
| `069_draft_source_identity.sql` | no duplicate `(source_id, player_url)` in `draft_persons`; no duplicate `(source_id, player_url, draft_year, draft_kind)` among `source_id IS NOT NULL` picks (`NULLS NOT DISTINCT`); constraint `draft_persons_source_id_dg_person_id_key` present under that exact name | migration 069:53-78 |
| Corrected honours loaders | migration **068** applied **and** privileges reconciled, or they fail closed on the `player_link_resolutions` read | migration 068:23-28 |
| Corrected honours loaders | migration **059** applied — `honour_team_linked_player_uq` is the final fail-closed backstop after decision replay. **If 059 is absent, STOP** | ISSUE-080 Correction 2 (M4) |
| Corrected `import_draft.py` | migration **069** applied | migration 069 header; ISSUE-078 Fix |
| Corrected first-kick-goal importer | migration **070** applied **and** privileges reconciled | migration 070:29-33 |
| Privilege reconciliation | must run **after** 066/068/070, because its import revoke loop strips every table and sequence grant not re-granted inside `privileges.sql` | `privileges.sql:239-313` |
| Privilege reconciliation | must run from a checkout **compatible with the schema it reconciles** | `issues.md:1068` |
| ISSUE-080 code | **no migration and no privilege step of its own** | ISSUE-080 handoff table |
| `--rekey` | reads the tracked manifest, but `main()` reads the **extract** `data/records/first-kick-goal.csv` first — and that file is **gitignored** (`.gitignore:42`), so `git pull` does not deliver it | `import-first-kick-goal.ts:685-696, 77-90` |
| `--rekey` | writes `source_record_id` only, and writes **no `import_batches` row** | `import-first-kick-goal.ts:322-411` |

### 2.2 One privilege reconciliation, after all migrations

066, 068 and 070 all add `afldb_import` grants that `privileges.sql` re-grants.
A single reconciliation after migration 070 satisfies all three. Splitting it
adds outage time and buys nothing.

### 2.3 Why the build cannot precede the migrations

`npm run build` prerenders pages that read the database, and the deployment
candidate reads post-057 columns on prerendered routes —
`player_season_stats.frees_for` and siblings (migration 065) via
`src/db/queries/player-derived.ts`, and `award_winners.sort_order`
(migration 061) via `src/db/queries/awards.ts:137`. Building against a
migration-057 schema therefore fails. **Build must follow the migrations.**

`npm ci` is placed inside the outage **unless** Phase 0 shows
`package.json`/`package-lock.json` unchanged between `a32a0a1` and
`<TARGET_SHA>`, in which case dependencies are already correct and the step is
skipped entirely.

### 2.4 What can be prepared before the outage, and what cannot

| Prepared in Phase 0 (no outage cost) | Why it is safe there |
|---|---|
| The read-only preflight SQL script | Reviewed and hashed locally; run twice |
| The Profile-B **Plane A** SQL | Authoring only; execution needs the migrated schema |
| The Profile-B **Plane B** generator **and its run** | Runs on the **dev** host in a temporary worktree at `<TARGET_SHA>`, against the canonical artifact. Production is never contacted. Its artifact hash is re-verified at classification time |
| The regenerated post-070 ISSUE-079 audit **template** | Everything except two placeholders can be written and reviewed now. It is a **template, not the execution file**: `<BASELINE_IDENTITIES>` is not known until Phase 2 and `<ACTIVATION_TS>` not until Phase 4, so the executable file and its authoritative SHA-256 are produced at Phase 10.2 |
| `git fetch` on production | Writes only to `.git`; the checked-out tree and the running service are untouched |

Only execution against the migrated production schema is unavoidably inside
the outage.

### 2.5 Phase order

```
Phase 0   preliminary read-only preflight + artefact authoring   service UP
──────────────────── WRITE ISOLATION BEGINS ────────────────────
Phase 1   stop all writers; prove zero non-operator sessions
Phase 2   AUTHORITATIVE preconditions + identity capture (same script, 2nd run)
Phase 3   authoritative G1 dump + off-host copy + restore rehearsal    ← GATE G1
Phase 4   activate <TARGET_SHA>; record the code-activation boundary
Phase 5   migrations 058 → 070
Phase 6   privilege reconciliation + table AND sequence gate
Phase 7   production-mode build                                        ← GATE G2
Phase 8   Profile-B: Plane A on production, classified vs Plane B      ← GATE G3
Phase 9   conditional one-time --rekey
Phase 10  regenerated post-070 ISSUE-079 integrity audit               ← GATE G4
Phase 11  start afldb; health/header checks; public smoke checks;
          restart the intake timer     ← WRITE ISOLATION ENDS (see §13.4)
──────────────────────────────────────────────────────────────────
Phase 12  ledger, changelog and closure
```

**Every irreversible step (Phase 5 migrations, Phase 9 `--rekey`) and every
data-integrity proof (Phase 8, Phase 10) completes before any production write
is reopened.** That is what keeps `<G1_DUMP>` a lossless recovery point for the
whole rollout.

### 2.6 Action vocabulary — exactly three words, used consistently

Every outcome in this runbook resolves to one of these. No other word carries
operational force, and none of them is a synonym for another.

| Verb | Meaning | Preconditions | What happens next |
|---|---|---|---|
| **HALT** | **Hard rollout stop.** Do not proceed to the next phase. | Used when the deployed state is unproven or self-inconsistent, when this rollout's own evidence cannot be completed or trusted, or when there is actual data-integrity evidence. | Diagnose from the named evidence, then choose **forward repair** (fix and re-run the idempotent step) or **recovery** (§3.4). **Never proceed to Phase 9 `--rekey` out of a HALT.** |
| **BLOCK** | **Closure and reload blocker; the rollout continues.** | Permitted **only** when the migrated schema, privileges and protective code are **positively proven healthy** — Gate G2 passed and, for a Phase-8 finding, the Profile-B **schema gate** itself passed. | Record the blocker in `issues.md`; **prohibit any awards/honours reload**; leave ISSUE-084 **open**; continue Phases 9, 10 and 11 so production is not left dark behind a strictly-safer deployment. |
| **RETRY** | Re-run the same step after correcting a named cause. | The step is idempotent or resumable and this runbook says so. | Re-run once. If it still cannot complete or be trusted, the outcome becomes **HALT**, never BLOCK. |

Two consequences worth stating plainly, because they are the ones easiest to
get wrong:

- **A missing or unexpected migration-058–070 object is never a BLOCK.** A
  Profile-B schema-gate refusal — an absent `honour_team_linked_player_uq`, an
  absent `player_link_match_candidates`, a surviving `honour_team_uq`, a wrong
  high-water mark — is deployed-state inconsistency and is a **HALT**. It is
  not an awards-reload ambiguity and must never be recorded as one.
- **BLOCK is not a softer STOP.** It is a different finding about a different
  thing: the *future reload gate* is unestablished while the *deployment* is
  proven sound. If the deployment is not proven sound, the outcome is HALT.

**One shorthand, and only one.** Each phase lists its exit criteria under
**"STOP if:"**. Throughout this runbook **STOP is shorthand for HALT** and
carries no other meaning — never BLOCK, never "note it and continue". The only
place a finding does not stop the rollout is a Phase-8 **BLOCK**, which is named
BLOCK explicitly wherever it applies. (`ON_ERROR_STOP=1` in the psql commands is
a libpq flag, unrelated to this vocabulary.)

---

## 3. The read-only production SQL envelope

Every live production SQL inspection — Phases 0, 2, 6, 8, 9 and 10 — uses this
envelope. It is the `AFLDB-ISSUE-079` Phase 3 transport, unchanged.

**Accurate boundary statement.** These inspections perform **no production
database mutation**. They do write two temporary files under `/tmp` on the
production host — the reviewed SQL and the reviewed DSN parser — both removed
by the remote `trap … EXIT`. That is the only production-side side effect, and
it is outside the database.

Every such SQL file begins with:

```sql
\pset pager off
\pset null '(null)'

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

\echo '== 0. identity and read-only evidence =='
SELECT current_database(), current_user, version(), now();
SHOW default_transaction_read_only;
SHOW transaction_read_only;
SHOW transaction_isolation;
SHOW search_path;

SELECT CASE WHEN current_database() = 'afldb_prod'
             AND current_user       = 'afldb_owner'
             AND current_setting('transaction_read_only')         = 'on'
             AND current_setting('default_transaction_read_only') = 'on'
            THEN 'true' ELSE 'false' END AS gate_ok \gset

\if :gate_ok
\echo 'IDENTITY GATE PASSED'
\else
\echo '*** IDENTITY / READ-ONLY GATE FAILED - no application data queried ***'
ROLLBACK;
SELECT CAST('IDENTITY GATE FAILED' AS integer);
\endif
```

…and ends with an explicit `ROLLBACK;` and a completion banner.

It is executed by the reviewed transport (`AFLDB-ISSUE-079.md` Phase 3): a
single `/usr/bin/ssh` connection carrying a `tar` payload of the SQL **and**
the parser; both sha256-verified locally before any connection is opened and
again remotely before the env file is read; DSN identity asserted equal to
`role=afldb_owner host=localhost port=5432 dbname=afldb_prod`; the password
moved into `PGPASSWORD` and the rest into `PG*`, so **no DSN reaches argv,
`ps`, the terminal or the artifact**; then

```bash
PGOPTIONS="-c default_transaction_read_only=on" \
  psql -X -a -v ON_ERROR_STOP=1 -P pager=off -f /tmp/<file>.sql < /dev/null
```

with the exit status captured via `${PIPESTATUS[0]}` and appended to the
artifact. Distinct statuses stay meaningful: **3** parser failure or psql
`ON_ERROR_STOP` (including either gate), **4** DSN identity mismatch, **5**
sha256 mismatch, **6** payload extraction failure.

Use `/usr/bin/ssh` explicitly under Git Bash, and keep connections few — a
burst of SSH attempts can trip the home Firewalla IPS and look like the droplet
being down.

---

## Phase 0 — preliminary preflight and artefact authoring (service running)

Nothing here mutates the production **database**. Findings are **preliminary**:
the application can still write, so anything time-sensitive is re-established
in Phase 2 after quiescence.

### P0.1 — Host, revision, worktree and remote

```bash
ssh afldb 'hostname; cd ~/projects/afldb && git rev-parse HEAD && git rev-parse --abbrev-ref HEAD && git remote -v && git status --porcelain && git stash list'
```

**Expect:** hostname `afldb-prod`; HEAD
`a32a0a1abacbf49a979343094b28c7983ebbea33`; a named branch with an `origin`
remote; **empty** `git status --porcelain`.

**STOP if:** HEAD is not `a32a0a1…` — the ISSUE-079/080 evidence is pinned to
it and the baseline must be re-derived first; or the working tree is dirty; or
`git stash list` is non-empty and the operator does not know what it holds. A
leftover stash from the resolved package-drift incident should be reported and
dropped by the operator, **never popped** as part of this rollout.

### P0.2 — Fetch and prove the target is a fast-forward

```bash
ssh afldb 'cd ~/projects/afldb && git fetch --all --prune && git log --oneline -3 origin/<prod-branch>'
ssh afldb 'cd ~/projects/afldb && git merge-base --is-ancestor a32a0a1abacbf49a979343094b28c7983ebbea33 <TARGET_SHA> && echo ANCESTOR-OK || echo NOT-AN-ANCESTOR'
```

`git fetch` writes only to `.git`; it does **not** change the checked-out tree,
so the running service is untouched. Activation is deferred to Phase 4.

Locally, confirm the work is committed and pushed:

```bash
git -C d:/dev/afldb log --oneline -1
git -C d:/dev/afldb status -sb
git -C d:/dev/afldb log --oneline origin/<prod-branch>..HEAD | head -40
```

**Expect:** `ANCESTOR-OK`; every ISSUE-044/078/080 commit present on the branch
production tracks; no uncommitted changes under `src/`, `tools/` or
`src/db/migrations/`. (`CLAUDE.md`, `CLAUDE.old.md` and `scratchpad/` are
unrelated and may stay dirty.) Record the exact target SHA — everything later
refers to it as `<TARGET_SHA>`.

**STOP if:** `NOT-AN-ANCESTOR` — the deployment is not a fast-forward and the
divergence must be understood first — or any required commit is unpushed.
`git pull --ff-only` in Phase 4 remains the final mechanical guard.

### P0.3 — Prod `.env` DSN identity (no secret printed)

```bash
scp scratchpad/afldb-dsn-parse.py afldb:/tmp/afldb-dsn-parse.py
ssh afldb 'sha256sum /tmp/afldb-dsn-parse.py; for v in AFLDB_OWNER_DATABASE_URL AFLDB_PROD_DATABASE_URL AFLDB_IMPORT_DATABASE_URL AFLDB_BACKUP_DATABASE_URL AFLDB_AUTH_DATABASE_URL DATABASE_URL; do printf "%s " "$v"; python3 /tmp/afldb-dsn-parse.py --identity /home/arm/projects/afldb/.env "$v" || echo "(unset/unparseable)"; done; rm -f /tmp/afldb-dsn-parse.py'
```

**Expect:** parser sha256 `eec7b211…1a79f`, and

| Variable | Required identity |
|---|---|
| `AFLDB_OWNER_DATABASE_URL` | `role=afldb_owner … dbname=afldb_prod` |
| `AFLDB_PROD_DATABASE_URL` | `role=afldb_owner … dbname=afldb_prod` |
| `AFLDB_IMPORT_DATABASE_URL` | `role=afldb_import … dbname=afldb_prod` |
| `AFLDB_BACKUP_DATABASE_URL` | `role=afldb_backup … dbname=afldb_prod` |
| `AFLDB_AUTH_DATABASE_URL` | `role=afldb_auth … dbname=afldb_prod` |
| `DATABASE_URL` | `role=afldb_app … dbname=afldb_prod` |

**STOP if:** any DSN names a database other than `afldb_prod`, or
`AFLDB_OWNER_DATABASE_URL` or `AFLDB_BACKUP_DATABASE_URL` is unset. Privilege
reconciliation would otherwise target the wrong database, and `backup.sh`
deliberately does not fall back to the owner DSN.

### P0.4 — Resolve `<PROD_PORT>` and `<PUBLIC_APP_HOST>` once

```bash
ssh afldb 'grep -E "^PORT=|^AFLDB_ENV=|^AFLDB_INDEXING=|^AFLDB_WORKERS=|^AFLDB_BASE_URL=" ~/projects/afldb/.env'
ssh afldb 'sudo grep -nE "^[a-z0-9.]+\.afldb\.com|^afldb\.com|reverse_proxy|root \*" /etc/caddy/Caddyfile'
```

**Expect:** `PORT=3100`, `AFLDB_ENV=production`, `AFLDB_INDEXING` absent or not
`on`, and a live Caddyfile whose application block proxies
`127.0.0.1:<PROD_PORT>`.

Record and use **literally** thereafter:

- `<PROD_PORT>` — expected `3100`, taken from `.env` and cross-checked against
  the Caddy `reverse_proxy` target;
- `<PUBLIC_APP_HOST>` — expected `beta.afldb.com`, the block carrying
  `health_uri /api/health`;
- `<APEX_HOST>` — `afldb.com`, serving **static files** from
  `/var/www/afldb-soon`, with **no `/api/health`**;
- `<AFLDB_ENV_VALUE>` — the exact `AFLDB_ENV` value, required to be
  `production`. Phase 7 passes this one variable to the build and nothing else.

**Never use `${PORT:-3100}` in a later SSH command** — a non-login SSH shell
does not load `.env`, so the fallback would mask a real mismatch.

**STOP if:** `.env`'s `PORT` and the live Caddy proxy target disagree;
`AFLDB_ENV` is not `production`; or the live Caddyfile differs from
`deploy/Caddyfile.production` in ways that change which hostname serves the
application.

### P0.5 — Dependency delta (decides whether `npm ci` is needed)

```bash
git -C d:/dev/afldb diff --stat a32a0a1..<TARGET_SHA> -- package.json package-lock.json
```

**Expect:** no output — dependencies unchanged, **skip `npm ci`** and shorten
the outage — or a listed delta, in which case `npm ci` runs at Phase 7.

### P0.6 — Service and health baseline

```bash
ssh afldb 'systemctl status afldb --no-pager | head -20'
ssh afldb 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<PROD_PORT>/api/health'
curl -s -o /dev/null -w "%{http_code}\n" https://<PUBLIC_APP_HOST>/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://<APEX_HOST>/
```

**Expect:** `active (running)`; `200` on loopback health; `200` from
`https://<PUBLIC_APP_HOST>/api/health`; `200` from the static apex.

### P0.7 — Author, review and hash the preflight script; run it once

Author `artifacts/audits/issue-084-preflight-prod-<rundate>.sql` to the §3
envelope. It is run **twice** — here, and again in Phase 2 after quiescence —
so the two artifacts are directly comparable. Record its sha256 before first
use and do not modify it between runs.

**A. Migration ledger — the read-only replacement for `db:status`.**

```sql
\echo '== A1. applied migrations =='
SELECT name, checksum, applied_at
  FROM afldb_meta.schema_migrations
 ORDER BY name;

\echo '== A2. ledger summary =='
SELECT count(*) AS applied_count, max(name) AS high_water_mark
  FROM afldb_meta.schema_migrations;
```

**Expect:** 57 rows, `001_foundations.sql` … `057_data_edits.sql`,
`high_water_mark = 057_data_edits.sql`. Compare the returned `checksum` values
against locally computed `sha256sum src/db/migrations/0*.sql` at
`<TARGET_SHA>` for `001`–`057`. This proves both facts `db:status` would prove
— high-water mark and no applied-migration drift — **without any DDL**.

> `npm run db:status` is deliberately not used here: it executes
> `CREATE SCHEMA IF NOT EXISTS afldb_meta` and
> `CREATE TABLE IF NOT EXISTS afldb_meta.schema_migrations`
> (`tools/db/migrate.ts:120-128`). Both are no-ops on this database, but they
> are DDL, and a phase described as performing no database mutation must not
> contain them. `db:status` runs in Phase 5, after write isolation.

**B. Migration 059 and 069 fail-closed preconditions.**

```sql
\echo '== B1. 059: duplicate linked identity within a team =='
SELECT team_name, player_id, count(*) AS rows
  FROM honour_team_members
 WHERE player_id IS NOT NULL
 GROUP BY team_name, player_id
HAVING count(*) > 1;

\echo '== B2. 069: draft_persons identity =='
SELECT source_id, player_url, count(*) AS rows
  FROM draft_persons
 GROUP BY source_id, player_url
HAVING count(*) > 1;

\echo '== B3. 069: draft_picks identity (NULLS NOT DISTINCT, source-owned only) =='
SELECT source_id, player_url, draft_year, draft_kind, count(*) AS rows
  FROM draft_picks
 WHERE source_id IS NOT NULL
 GROUP BY source_id, player_url, draft_year, draft_kind
HAVING count(*) > 1;

\echo '== B4. 069: NULL draft_kind among source-owned picks =='
SELECT count(*) AS null_draft_kind
  FROM draft_picks
 WHERE source_id IS NOT NULL AND draft_kind IS NULL;

\echo '== B5. constraints each migration drops by exact name =='
SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE (conrelid = 'honour_team_members'::regclass AND conname = 'honour_team_uq')
    OR (conrelid = 'draft_persons'::regclass
        AND conname = 'draft_persons_source_id_dg_person_id_key')
 ORDER BY 1, 2;
```

**Expect:** B1–B3 return **0 rows**; B4 returns `0`; B5 returns **exactly two**
rows.

**C. First-kick-goal `--rekey` applicability.**

```sql
\echo '== C1. first_kick_goal identity format =='
SELECT count(*)                                                         AS owned_rows,
       count(*) FILTER (WHERE pa.source_record_id ~ '^fkg-[0-9]{3,}$')  AS stable_format,
       count(*) FILTER (WHERE pa.source_record_id IS NULL
                           OR pa.source_record_id !~ '^fkg-[0-9]{3,}$') AS legacy_format
  FROM player_achievements pa
  JOIN sources s ON s.id = pa.source_id
 WHERE pa.achievement_type = 'first_kick_goal'
   AND s.key = 'wikipedia_first_kick_goal';
```

Constants verified: `SOURCE_KEY = 'wikipedia_first_kick_goal'`,
`ACHIEVEMENT_TYPE = 'first_kick_goal'`, `ID_PATTERN = /^fkg-(\d{3,})$/`
(`import-first-kick-goal.ts:68-70,117`). The tracked manifest holds **334
active rows, 0 retired**.

**D. Concurrent activity.**

```sql
\echo '== D1. sessions on afldb_prod =='
SELECT pid, usename, application_name, state, wait_event_type,
       left(query, 120) AS query, xact_start, state_change
  FROM pg_stat_activity
 WHERE datname = 'afldb_prod' AND pid <> pg_backend_pid()
 ORDER BY xact_start NULLS LAST;

\echo '== D2. import batches, newest first =='
SELECT tool, target_table, status, started_at
  FROM import_batches
 ORDER BY started_at DESC LIMIT 10;
```

**E. Restore-rehearsal comparands** — the nine values `restore-test.sh`
compares, captured from production so the Phase 3 rehearsal can be verified
against the right source (§3.3 explains why the script's own verdict cannot be
used across environments).

```sql
\echo '== E1. parity comparands =='
SELECT (SELECT count(*)   FROM player_match_stats)                         AS player_match_stats_rows,
       (SELECT count(*)   FROM players)                                    AS players_rows,
       (SELECT count(*)   FROM matches)                                    AS matches_rows,
       (SELECT count(*)   FROM clubs)                                      AS clubs_rows,
       (SELECT sum(games) FROM player_career_stats)                        AS career_games_total,
       (SELECT sum(goals) FROM player_career_stats)                        AS career_goals_total,
       (SELECT sum(votes) FROM brownlow_season_votes)                      AS brownlow_votes_total,
       (SELECT count(*)   FROM player_match_stats WHERE disposals IS NULL) AS unrecorded_disposals,
       (SELECT count(*)   FROM stat_availability)                          AS stat_availability_rows;
```

**F. Player-link totals.**

```sql
\echo '== F1. player-link totals =='
SELECT (SELECT count(*) FROM player_link_resolutions) AS total_resolutions,
       (SELECT count(*) FROM player_link_suggestions) AS total_suggestions;
```

**G. Exact baseline identities — the survival comparand.**

The retained 2026-08-23 artifact records the six resolutions and two
suggestions **only in aggregate**: its dangling-detail query returned zero rows
(there were none) and its repeated-events query is a count distribution. **No
row ids for the surviving rows exist in that artifact, and none are invented
here.** The strongest available proof is therefore captured now, before any
mutation, and used as Phase 10's comparand.

```sql
\echo '== G1. every resolution, by identity (no admin email, no note body) =='
SELECT r.id, r.target_table, r.target_id, r.action, r.player_id,
       r.previous_status, r.admin_user_id, r.created_at
  FROM player_link_resolutions r
 ORDER BY r.id;

\echo '== G2. every suggestion, by identity (no free text) =='
SELECT s.id, s.target_table, s.target_id, s.status, s.resolved_by, s.created_at
  FROM player_link_suggestions s
 ORDER BY s.id;

\echo '== G3. target liveness per resolution =='
SELECT r.id, r.target_table, r.target_id,
       CASE r.target_table
         WHEN 'award_winners'       THEN EXISTS (SELECT 1 FROM award_winners       x WHERE x.id = r.target_id)
         WHEN 'award_nominations'   THEN EXISTS (SELECT 1 FROM award_nominations   x WHERE x.id = r.target_id)
         WHEN 'hall_of_fame'        THEN EXISTS (SELECT 1 FROM hall_of_fame        x WHERE x.id = r.target_id)
         WHEN 'honour_team_members' THEN EXISTS (SELECT 1 FROM honour_team_members x WHERE x.id = r.target_id)
         WHEN 'captaincies'         THEN EXISTS (SELECT 1 FROM captaincies         x WHERE x.id = r.target_id)
         WHEN 'player_achievements' THEN EXISTS (SELECT 1 FROM player_achievements x WHERE x.id = r.target_id)
         WHEN 'draft_picks'         THEN EXISTS (SELECT 1 FROM draft_picks         x WHERE x.id = r.target_id)
         ELSE NULL
       END AS target_live
  FROM player_link_resolutions r
 ORDER BY r.id;

\echo '== G4. target liveness per suggestion =='
SELECT s.id, s.target_table, s.target_id,
       CASE s.target_table
         WHEN 'award_winners'       THEN EXISTS (SELECT 1 FROM award_winners       x WHERE x.id = s.target_id)
         WHEN 'award_nominations'   THEN EXISTS (SELECT 1 FROM award_nominations   x WHERE x.id = s.target_id)
         WHEN 'hall_of_fame'        THEN EXISTS (SELECT 1 FROM hall_of_fame        x WHERE x.id = s.target_id)
         WHEN 'honour_team_members' THEN EXISTS (SELECT 1 FROM honour_team_members x WHERE x.id = s.target_id)
         WHEN 'captaincies'         THEN EXISTS (SELECT 1 FROM captaincies         x WHERE x.id = s.target_id)
         WHEN 'player_achievements' THEN EXISTS (SELECT 1 FROM player_achievements x WHERE x.id = s.target_id)
         WHEN 'draft_picks'         THEN EXISTS (SELECT 1 FROM draft_picks         x WHERE x.id = s.target_id)
         ELSE NULL
       END AS target_live
  FROM player_link_suggestions s
 ORDER BY s.id;
```

`note`, free-text bodies and admin emails are deliberately excluded, matching
the ISSUE-080 §7.3 output rule.

Run the script through the §3 transport into
`artifacts/audits/issue-084-preflight-prod-<rundate>-live.txt`.

**Preliminary STOP conditions** (any of these ends the rollout now, with
production untouched):

- the identity gate fails, or the artifact does not end in `ROLLBACK` with
  status 0;
- the migration ledger is not exactly `001`–`057`, or any checksum disagrees
  with `<TARGET_SHA>`'s file for `001`–`057`;
- **B5 returns fewer than two rows** — a migration would fail on
  `DROP CONSTRAINT`;
- **C1 shows a mixture** (`stable_format > 0` **and** `legacy_format > 0`), or
  `owned_rows` is neither `0` nor `334`;
- any `target_live` in G3/G4 is `false` or `NULL` — that would be a dangling
  reference existing *before* the rollout, contradicting the 2026-08-23 audit
  and requiring investigation under ISSUE-079, not deployment.

B1–B4 duplicates found here are **preliminary**: report them and treat them as
a STOP unless the operator can account for them, because de-duplication is a
curator decision recorded as its own issue — never an ad-hoc fix inside a
deployment.

### P0.8 — Author and review the audit artefacts (no host contacted)

**a. Profile-B Plane A SQL** — `artifacts/audits/issue-080-planea-prod-<rundate>-profileB.sql`,
per §8.1. This one **is** complete and final here: it depends on no value that
this rollout produces. Reviewed in full; sha256 recorded; that hash is the one
Phase 8 executes.

**b. Regenerated post-070 ISSUE-079 audit — a TEMPLATE, not the execution
file** — `artifacts/audits/issue-079-audit-prod-<rundate>-post070.template.sql`,
per §10.1.

Two values it needs do not exist yet:

| Placeholder | Established in |
|---|---|
| `<BASELINE_IDENTITIES>` — the resolution and suggestion identities Query 14 proves survived | **Phase 2** |
| `<ACTIVATION_TS>` — the code-activation boundary used by Query 13e and its comment | **Phase 4** |

The template is therefore written and reviewed in full **now**, with both
placeholders left explicitly unpopulated and clearly marked. Its header states
the schema this rollout will produce (`001 … 070`), which `S16prod`/`S17prod`
verify at run time; the observed `applied_at` values are recorded in the
artifact and in `issues.md`, not baked into the header.

**The template's sha256 may be recorded as provenance, but it is not the
execution-authoritative hash.** The executable file, its full re-review and its
authoritative sha256 are produced at **Phase 10.2**, after Phase 4. Nothing in
this runbook executes the template.

### P0.9 — Generate Plane B on the development host (no production contact)

Plane B depends only on `<TARGET_SHA>` code and the canonical artifact, both
present on the dev host, so it is produced here and costs no outage time. Its
artifact hash is re-verified at classification time in Phase 8. Full method,
contract and self-test in §8.2.

### P0.10 — Optional: prove the backup mechanism before the outage

```bash
ssh afldb 'cd ~/projects/afldb && bash tools/maintenance/backup.sh --keep 14 && ls -lt ~/backups/afldb | head -5'
```

`backup.sh` sources `.env` itself, so no credential handling is required here.

This dump is **not** the rollback point — a legitimate production write can
occur after it and before isolation. Its only purposes are to prove `backup.sh`
works on this host and to de-risk the Phase 3 rehearsal. P0.10 may be skipped;
Phase 3 then carries the first exercise of the mechanism.

### P0.11 — The pre-rollout ISSUE-079 baseline (aggregate comparand)

From `artifacts/audits/issue-079-player-link-integrity-prod-20260823.txt`,
snapshot `2026-08-23 06:57:52+10`, schema at migration 057:

| Measure | Baseline |
|---|---|
| `player_link_resolutions` total | **6** |
| `player_link_suggestions` total | **2** |
| Resolutions by target | `honour_team_members` 6 (6 live, **0 dangling**); the other six families 0 |
| Suggestions by target | `honour_team_members` 2 (2 open, 2 live, **0 dangling**) |
| Unknown-vocabulary rows (Category B) | **0** resolutions, **0** suggestions |
| Resolutions by action | `linked` 3, `confirmed_unlinked` 3 |
| Targets carrying more than one resolution | **0**; all six targets carry exactly one |
| Dangling detail rows | **0** |
| Loader runs since the audit trail began (Q13c) | **0** across all seven families |
| Other import runs since the trail began (Q13d) | 2 × `enrich_birth_dates_from_club_lists.py (node port)` → `player_birth_evidence` |

This artifact is **aggregate-only**; the row-level comparand is Phase 2's
section **G** capture.

### Gate G0 — proceed only when

P0.1–P0.11 returned their expected evidence; `<TARGET_SHA>` is fixed, pushed
and proven a fast-forward; `<PROD_PORT>`, `<PUBLIC_APP_HOST>` and
`<AFLDB_ENV_VALUE>` are resolved; the `npm ci` decision is made; the preflight
script and the Profile-B Plane A SQL are reviewed and hashed as **final**; the
post-070 audit **template** is reviewed with both placeholders explicitly
unpopulated (its executable form and authoritative hash come at Phase 10.2);
Plane B is generated and self-tested. Any STOP ends the rollout with production
untouched.

---

## Phase 1 — write isolation begins

Stopping a timer is not enough if its service is already running, so both are
stopped and both are verified.

### 1.1 Enumerate before acting — no truncation

```bash
ssh afldb 'systemctl list-timers "afldb*" --all --no-pager'
ssh afldb 'systemctl list-units "afldb*" --all --no-pager'
ssh afldb 'systemctl list-timers --all --no-pager'
ssh afldb 'crontab -l 2>/dev/null; sudo ls -1 /etc/cron.d/ 2>/dev/null'
```

Read the full output. Any unit or cron entry that can write to `afldb_prod`,
POST to the application, or hold a long transaction must be accounted for —
including a backup timer, if one has been installed since the cutover.

### 1.2 Stop the timers, then the services, then the application

```bash
ssh afldb 'sudo systemctl stop afldb-email-intake.timer; systemctl is-active afldb-email-intake.timer'
ssh afldb 'sudo systemctl stop afldb-email-intake.service; systemctl is-active afldb-email-intake.service'
# plus any additional afldb-* timer/service pair the enumeration revealed
ssh afldb 'sudo systemctl stop afldb; systemctl is-active afldb'
ssh afldb 'ss -ltnp | grep -E ":<PROD_PORT>\b" || echo "no listener on <PROD_PORT>"'
ssh afldb 'ps -eo pid,etimes,cmd | grep -Ei "import_|rebuild_derived|first-kick-goal|validate_migration|pg_dump|pg_restore|fetch_and_stage" | grep -v grep || echo "no importer/backup process"'
```

**Expect:** every unit `inactive`; no listener on `<PROD_PORT>`; no importer,
poller or dump process.

The intake poller holds no database DSN and writes only through the app's
route, so stopping `afldb` already neutralises it; the timer and service are
stopped as well so nothing resumes mid-migration and the journal is not filled
with `EX_TEMPFAIL` runs.

Caddy now returns 502 for `https://<PUBLIC_APP_HOST>`. The static apex
`https://<APEX_HOST>` is served from disk and **stays up** — that separation is
the deliberate design of `Caddyfile.production`. Confirm it rather than assume
it:

```bash
curl -s -o /dev/null -w "apex during outage: %{http_code}\n" https://<APEX_HOST>/
```

### 1.3 Prove database quiescence

Re-run section **D1** of the preflight script (Phase 2 re-runs the whole script
anyway).

**Required:** `pg_stat_activity` for `afldb_prod` returns **exactly zero** rows
after excluding the operator's own backend (`pid <> pg_backend_pid()`).

**STOP if:** any session remains. Migrations 059 and 069 take
`ACCESS EXCLUSIVE` locks and would queue behind it, and an open transaction
would make the Phase 3 dump a snapshot of an in-flight state. Identify the
session before proceeding; do not terminate backends blindly.

**Rollback from here:** `sudo systemctl start afldb` and re-enable the timers.
Nothing has been mutated.

---

## Phase 2 — authoritative preconditions and identity capture

Re-run the **identical** preflight script from P0.7 — same file, same sha256 —
into `artifacts/audits/issue-084-preflight-prod-<rundate>-quiescent.txt`.

This is the authoritative evidence. The live run in Phase 0 was preliminary and
must not be the final authority for a state-changing migration.

**Required results:**

| Section | Required |
|---|---|
| Identity gate | PASSED; artifact ends `ROLLBACK`, status 0 |
| A1/A2 | exactly `001`–`057`; high-water mark `057_data_edits.sql`; every checksum matching `<TARGET_SHA>` |
| B1, B2, B3 | **0 rows each** |
| B4 | `0` |
| B5 | exactly two rows |
| C1 | `owned_rows` is `0` **or** `334`, never a mixture |
| D1 | **zero** non-operator sessions |
| E1 | recorded as the restore-rehearsal comparand |
| F1 | recorded |
| **G1–G4** | **recorded as `<BASELINE_IDENTITIES>` — every resolution id and suggestion id with its `(target_table, target_id)`, and `target_live = true` for every one** |

**Diff the two artifacts.** Any difference between the live and quiescent runs
in sections A, B, C or G is significant and must be explained before
proceeding — it means production changed between them.

Because writers are now stopped and stay stopped until Phase 11, the quiescent
values in C1 and G1–G4 remain valid for the rest of the rollout except where
this runbook's own steps change them.

**STOP if:** any required result above is not met.

---

## Phase 3 — authoritative backup, off-host copy and restore rehearsal — **GATE G1**

This is the real rollback point. It is taken **after** writers are stopped and
quiescence is proved, and it stays lossless until Phase 11 starts the service.

### 3.1 Take the authoritative dump

```bash
ssh afldb 'cd ~/projects/afldb && bash tools/maintenance/backup.sh --keep 14'
ssh afldb 'ls -l ~/backups/afldb/ && sha256sum ~/backups/afldb/afldb_prod-*.dump | tail -3'
```

**Expect:** a new `afldb_prod-YYYYmmdd-HHMMSS.dump`, mode 600, with the
script's reported object count. The archive is renamed out of `.partial` only
after `pg_restore --list` reads it back (`backup.sh:107-114`).

**Record in `issues.md`:** the exact filename and its **SHA-256**. Everything
that follows refers to it as `<G1_DUMP>`.

**STOP if:** `backup.sh` reports anything but success.

### 3.2 Off-host copy — mandatory

```bash
scp afldb:~/backups/afldb/<G1_DUMP> D:/backups/afldb/<G1_DUMP>
sha256sum D:/backups/afldb/<G1_DUMP>
```

**Required:** the workstation copy's SHA-256 equals the value recorded in 3.1.
Migrations do not proceed until it matches. The dump otherwise lives on the
same host as the database it protects, which is exactly the gap
`docs/backup-restore.md` §4 names.

### 3.3 Restore rehearsal — repository-supported, on the development host

`restore-test.sh` **is** usable for this, with one limitation that must be
understood rather than glossed over.

What it does (`restore-test.sh:18,45,65-70,107-163`): it sources `.env`
itself, derives its target by replacing the database **name** in
`AFLDB_OWNER_DATABASE_URL` with `afldb_restore_test`, **refuses to restore into
anything else**, refuses when source and target coincide, empties the target
before restoring, tolerates only the two known extension-ownership errors, and
treats every other `pg_restore` line as fatal. `afldb_restore_test` exists on
the **dev** host and **not** on the droplet, so the rehearsal runs on dev.
`afldb_dev` and `afldb_test` are never written to — the only writes are to
`afldb_restore_test`.

**The rehearsal is run in two steps, deliberately.** Restoring the 057
production dump into an *already empty* database would prove only that the dump
restores. It would not prove the thing §3.4 depends on: that the recovery method
turns a **migration-070** database back into a **true migration-057** one. So
the target is first brought to the 070 shape, and the 057 dump is then restored
over it — the exact situation a real rollback faces.

```bash
# Step 1 — bring afldb_restore_test to the migration-070 shape, using the
#          script's own documented no-argument form against dev's newest dump.
#          Its nine parity checks compare against afldb_dev, the true source
#          here, so this run is EXPECTED TO PASS and revalidates the tool.
ssh dev 'cd ~/projects/afldb && bash tools/maintenance/restore-test.sh'

# Step 2 — restore the 057 production dump OVER that 070-shaped database.
scp D:/backups/afldb/<G1_DUMP> dev:/tmp/<G1_DUMP>
ssh dev 'sha256sum /tmp/<G1_DUMP>'
ssh dev 'cd ~/projects/afldb && bash tools/maintenance/restore-test.sh /tmp/<G1_DUMP>'
```

**The limitation, stated exactly.** In **step 2** the script's nine parity
checks compare the restored database against `$AFLDB_OWNER_DATABASE_URL` — on
the dev host that is **`afldb_dev`**, not production. For a production dump
those checks compare prod data with dev data and are **expected to FAIL**, and
the script exits 1. That exit is **not** evidence about the dump. (In **step 1**
the same checks *are* meaningful, because `afldb_dev` genuinely is that dump's
source, and they are expected to pass.)

**What is evidence.** Gate G1 requires all five:

1. The script's own ordering is observed: the banner
   `==> Restoring <G1_DUMP> into afldb_restore_test`, then
   `clearing afldb_restore_test`, then the restore. **The target is emptied
   before `pg_restore` runs** (`restore-test.sh:99-118`) — that is the point of
   the clearing step: a failed restore cannot leave the previous generation in
   place for the checks to pass against.
2. **no** `ERROR: pg_restore reported errors beyond the known extension-owner
   ones` — this is the fatal check and the meaningful one;
3. `restored in Ns` is printed;
4. the restored database's nine values equal the **production** values captured
   in Phase 2 section **E1**;
5. **the recovery-method proof (§3.3a): no migration-058–070 object survived
   step 2**, and the restored ledger reads exactly 57 applied migrations with
   high-water mark `057_data_edits.sql`.

Requirement 4 is proved by this complete, runnable block. It transfers the
reviewed parser, verifies its hash, reads only `afldb_owner`'s password out of
the dev host's `.env`, connects through `PG*` so **no DSN or password reaches
argv or the terminal**, pins the database to `afldb_restore_test`, and removes
the parser on exit:

```bash
scp scratchpad/afldb-dsn-parse.py dev:/tmp/afldb-dsn-parse.py
/usr/bin/ssh -o BatchMode=yes dev '
  set -u
  trap "rm -f /tmp/afldb-dsn-parse.py" EXIT
  ACTUAL=$(sha256sum /tmp/afldb-dsn-parse.py | cut -d" " -f1)
  echo "parser sha256: $ACTUAL"
  [ "$ACTUAL" = eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f ] || {
    echo "FATAL: parser hash mismatch"; exit 5; }

  ENVF=/home/arm/projects/afldb/.env
  IDENT=$(python3 /tmp/afldb-dsn-parse.py --identity "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  echo "dev owner DSN identity: $IDENT"
  case "$IDENT" in
    "role=afldb_owner host=localhost port=5432 dbname=afldb_dev") ;;
    *) echo "FATAL: unexpected dev owner DSN identity"; exit 4 ;;
  esac

  PGPASSWORD=$(python3 /tmp/afldb-dsn-parse.py --password "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  export PGPASSWORD PGHOST=localhost PGPORT=5432 PGUSER=afldb_owner
  export PGDATABASE=afldb_restore_test

  psql -X -v ON_ERROR_STOP=1 -P pager=off -c "SELECT current_database(), current_user"
  PGOPTIONS="-c default_transaction_read_only=on" psql -X -v ON_ERROR_STOP=1 -P pager=off -c "
    SELECT (SELECT count(*)   FROM player_match_stats)                         AS player_match_stats_rows,
           (SELECT count(*)   FROM players)                                    AS players_rows,
           (SELECT count(*)   FROM matches)                                    AS matches_rows,
           (SELECT count(*)   FROM clubs)                                      AS clubs_rows,
           (SELECT sum(games) FROM player_career_stats)                        AS career_games_total,
           (SELECT sum(goals) FROM player_career_stats)                        AS career_goals_total,
           (SELECT sum(votes) FROM brownlow_season_votes)                      AS brownlow_votes_total,
           (SELECT count(*)   FROM player_match_stats WHERE disposals IS NULL) AS unrecorded_disposals,
           (SELECT count(*)   FROM stat_availability)                          AS stat_availability_rows"
'
```

The first `psql` must print `afldb_restore_test | afldb_owner` — a positive
proof of target before any comparison is read. The comparison query runs
read-only for the same reason every other inspection does.

### 3.3a Requirement 5 — proving no newer-schema object survives the recovery

This is the empirical half of the §3.4 correctness argument. Run it against
`afldb_restore_test` immediately after step 2, through the same argv-safe block
(same parser transfer, same hash check, same `PG*` handling, `PGDATABASE`
pinned to `afldb_restore_test`), with the comparison query replaced by:

```sql
-- A. The migration ledger must read exactly 057.
SELECT count(*) AS applied_count, max(name) AS high_water_mark
  FROM afldb_meta.schema_migrations;

-- B. Every table migrations 058-070 create must be ABSENT.
SELECT 'player_match_period_stats'        AS obj, to_regclass('player_match_period_stats')          IS NULL AS absent
UNION ALL SELECT 'player_link_match_candidates', to_regclass('player_link_match_candidates')        IS NULL
UNION ALL SELECT 'staging.external_current_matches', to_regclass('staging.external_current_matches') IS NULL;

-- C. Every column migrations 058-070 add must be ABSENT.
SELECT c.relname || '.' || w.col AS obj,
       NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = w.col
                      AND a.attnum > 0 AND NOT a.attisdropped) AS absent
  FROM (VALUES
      ('award_winners','sort_order'),                    -- 061
      ('matches','source_id'), ('matches','source_record_id'),  -- 064
      ('player_season_stats','frees_for'),
      ('player_club_season_stats','frees_for'),
      ('player_career_stats','frees_for'),               -- 065
      ('player_link_resolutions','match_method'),
      ('player_link_resolutions','match_score'),
      ('player_link_resolutions','algorithm_version')    -- 067
    ) AS w(tbl, col)
  JOIN pg_class c ON c.oid = to_regclass(w.tbl)
 ORDER BY 1;

-- D. Every index/constraint 058-070 creates must be ABSENT, and the one
--    constraint 059 DROPS must be PRESENT again.
SELECT 'honour_team_linked_player_uq' AS obj, to_regclass('honour_team_linked_player_uq') IS NULL     AS absent
UNION ALL SELECT 'honour_team_unlinked_name_uq', to_regclass('honour_team_unlinked_name_uq') IS NULL
UNION ALL SELECT 'draft_persons_source_uq',      to_regclass('draft_persons_source_uq')      IS NULL
UNION ALL SELECT 'draft_picks_source_uq',        to_regclass('draft_picks_source_uq')        IS NULL
UNION ALL SELECT 'ix_plmc_target',               to_regclass('ix_plmc_target')               IS NULL;

SELECT 'honour_team_uq restored' AS obj,
       EXISTS (SELECT 1 FROM pg_constraint
                WHERE conrelid = 'honour_team_members'::regclass
                  AND conname = 'honour_team_uq') AS present;

-- E. player_link_resolutions must be back to its NINE migration-056 columns.
SELECT count(*) AS resolution_columns
  FROM pg_attribute
 WHERE attrelid = 'player_link_resolutions'::regclass
   AND attnum > 0 AND NOT attisdropped;
```

**Required:** A → `57` and `057_data_edits.sql`; B, C, D → `absent` is **true**
for every row; `honour_team_uq restored` → **true**; E → **9**.

**Why this list is complete, and how that was established.** Every object
migrations 058–070 create was enumerated from the migration files. They create
**only** tables, indexes, columns and constraints — **no** schema, function,
type, view, materialized view, standalone sequence, trigger, domain, aggregate
or operator (verified by searching all thirteen files for those `CREATE` forms;
the four schemas the database uses — `staging`, `staging_aflw`, `aflw`,
`afldb_meta` — all pre-date 057, from migrations 001, 025, 026 and 039). That
is what makes a table-level clearing pass sufficient: indexes, columns and
constraints cannot outlive the table they belong to, and the three new tables
are dropped by name.

The static enumeration is the argument; **queries A–E are the proof**, run on a
disposable database before any production mutation.

**Gate G1 passes only when** requirements 1–5 all hold and the workstation
copy's SHA-256 matches §3.1.

**Residual risk, recorded honestly.** This rehearsal proves the dump restores
into a real PostgreSQL database, reproduces production's row counts, and that
the recovery method removes every newer-schema object. It does **not** prove a
restore into `afldb_prod` itself, because the droplet has no disposable
database to rehearse against — `01_setup_service.sh`, which creates
`afldb_restore_test`, is a development-host script, and
`00_install_postgres_prod.sh` creates `afldb_prod` only. `pg_restore --list`
alone is **not** a restore rehearsal and is not treated as one anywhere in this
runbook.

**Housekeeping.** The rehearsal leaves production data in dev's
`afldb_restore_test`. The next dev restore verification empties it first
(`restore-test.sh:99-118`), so it is self-clearing; the operator may clear it
sooner by re-running step 1. Remove `/tmp/<G1_DUMP>` from the dev host when
finished.

### 3.4 The production recovery procedure this gate underwrites

**Not executed unless a rollback is actually required.**

#### Why `pg_restore --clean` alone is not enough — the defect this corrects

`<G1_DUMP>` is a **migration-057** dump, and a rollback restores it over a
database at **migration 070**. `pg_restore --clean --if-exists` emits a `DROP`
only for objects the **archive** contains, so every object existing solely in
058–070 is invisible to it and **survives**. The result would not be a
migration-057 database; it would be a hybrid whose ledger claims 057 while
carrying post-057 tables, columns and indexes. This runbook already depends on
that difference: `player_link_match_candidates` must be absent at 057 and
present at 070, and the original 057-pinned ISSUE-079 audit's **S17** asserts
the post-067 player-link schema is absent — it would fail against such a
hybrid, correctly.

Some of those `DROP`s would not even reach their tables. Migration 067's
`player_link_match_candidates` carries foreign keys into `players` and
`player_link_resolutions`, so a plain `DROP TABLE players` from the archive
fails while a dependent post-057 table still references it.

#### The clean-target method the repository already supports

`restore-test.sh` solves exactly this problem, and its comment says why:

> "Empty the target BEFORE restoring. Without this a failed restore leaves the
> previous generation in place… Tables are dropped individually rather than by
> dropping the schema: pg_trgm and unaccent live in public and are owned by
> another role, so DROP SCHEMA public CASCADE would fail on extension
> ownership." — `restore-test.sh:99-118`

Its clearing statement is reused **verbatim**, not reinvented. Keep it in a
reviewed file — `scratchpad/afldb-clear-target.sql` — rather than nesting it in
a quoted SSH string, so its quoting cannot be mangled in transit and its bytes
can be hash-verified like every other transferred artefact:

```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', r.schemaname, r.tablename);
  END LOOP;
END $$;
```

Write those bytes to `scratchpad/afldb-clear-target.sql`, review them, and
record their sha256 as `<CLEAR_SQL_SHA256>`; the procedure below verifies it
remotely before executing the file, exactly as it does the parser.

**Why this is sufficient, proved rather than assumed.** Migrations 058–070
create **only** tables, indexes, columns and constraints — no schema, function,
type, view, materialized view, standalone sequence, trigger, domain, aggregate
or operator (all thirteen files searched for those `CREATE` forms; the four
schemas in use — `staging`, `staging_aflw`, `aflw`, `afldb_meta` — all pre-date
057, from migrations 001, 025, 026 and 039). Indexes, columns and constraints
cannot outlive their table; the three post-057 tables
(`player_match_period_stats`, `player_link_match_candidates`,
`staging.external_current_matches`) are dropped by the loop, which spans every
non-system schema and uses `CASCADE`. Extensions and their owning role are
untouched, which is exactly why the loop drops tables individually.

`afldb_meta.schema_migrations` is itself a table: the loop drops it and the
archive recreates it with exactly its 57 rows, so after recovery the ledger
tells the truth instead of describing a hybrid.

**This method is rehearsed, not merely reasoned about.** Gate G1 requirement 5
(§3.3a) runs precisely this sequence — a 070-shaped target, then the 057 dump —
against `afldb_restore_test` and asserts queries A–E, before any production
mutation. **Do not execute §3.4 in production unless that rehearsal passed.**

#### If the verification below still finds a survivor

A documented, repository-derived fallback exists: recreate the database from
truly empty. The statements come from `00_install_postgres_prod.sh:142` and
`:149-154` and must not be improvised beyond them — terminate connections,
`sudo -u postgres dropdb afldb_prod`, then
`sudo -u postgres createdb -O afldb_owner afldb_prod`,
`CREATE EXTENSION IF NOT EXISTS pg_trgm;`,
`CREATE EXTENSION IF NOT EXISTS unaccent;`,
`ALTER SCHEMA public OWNER TO afldb_owner;` — followed by the same `pg_restore`
and privilege reconciliation as below. **Do not re-run
`00_install_postgres_prod.sh` itself:** it rotates every role password (`:130`)
and refuses to overwrite `.env` (`:83`), which would desynchronise the host's
credentials. Role definitions are cluster-level and survive a `dropdb`.

This is a last resort: it removes the database entirely for the length of the
restore and needs superuser, whereas the clearing loop needs neither.

#### The procedure

Ordering is not negotiable: recovery must produce a **mutually compatible
trio** — the migration-057 database, the `a32a0a1` source tree, and
**`a32a0a1`'s own `privileges.sql`**. Running the post-070 reconciler against a
restored 057 schema is the "stale checkout" hazard at `issues.md:1068`, in
reverse.

```bash
# 1. Stop every writer and prove quiescence (Phase 1.2 + 1.3, unchanged).
ssh afldb 'sudo systemctl stop afldb-email-intake.timer afldb-email-intake.service; sudo systemctl stop afldb'
#    then re-run preflight section D1: ZERO non-operator sessions on afldb_prod.
#    The clearing step takes ACCESS EXCLUSIVE locks on every table.

# 2. Empty the target, then restore <G1_DUMP>. One connection; both transferred
#    files hash-verified; credentials via the reviewed parser, never in argv.
scp scratchpad/afldb-dsn-parse.py     afldb:/tmp/afldb-dsn-parse.py
scp scratchpad/afldb-clear-target.sql afldb:/tmp/afldb-clear-target.sql
/usr/bin/ssh -o BatchMode=yes afldb '
  set -u
  trap "rm -f /tmp/afldb-dsn-parse.py /tmp/afldb-clear-target.sql" EXIT
  [ "$(sha256sum /tmp/afldb-dsn-parse.py | cut -d" " -f1)" = eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f ] || { echo "FATAL: parser hash mismatch"; exit 5; }
  # The clearing file is reviewed bytes too: verify it the same way, using the
  # sha256 recorded when it was written (see the block above).
  [ "$(sha256sum /tmp/afldb-clear-target.sql | cut -d" " -f1)" = "<CLEAR_SQL_SHA256>" ] || { echo "FATAL: clearing SQL hash mismatch"; exit 5; }
  ENVF=/home/arm/projects/afldb/.env
  IDENT=$(python3 /tmp/afldb-dsn-parse.py --identity "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  echo "owner DSN identity: $IDENT"
  [ "$IDENT" = "role=afldb_owner host=localhost port=5432 dbname=afldb_prod" ] || { echo "FATAL: DSN identity mismatch"; exit 4; }
  PGPASSWORD=$(python3 /tmp/afldb-dsn-parse.py --password "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  export PGPASSWORD PGHOST=localhost PGPORT=5432 PGUSER=afldb_owner PGDATABASE=afldb_prod

  psql -X -v ON_ERROR_STOP=1 -P pager=off -c "SELECT current_database(), current_user"

  # Empty the target FIRST. Without this, pg_restore --clean leaves every
  # 058-070-only object in place and the result is a hybrid, not a 057 database.
  echo "clearing afldb_prod"
  psql -X -v ON_ERROR_STOP=1 -P pager=off -f /tmp/afldb-clear-target.sql

  pg_restore --dbname=afldb_prod --clean --if-exists --no-owner --no-privileges --jobs=2 \
    /home/arm/backups/afldb/<G1_DUMP>
'

# 3. Restore the COMPATIBLE checkout BEFORE reconciling privileges.
ssh afldb 'cd ~/projects/afldb && git checkout a32a0a1abacbf49a979343094b28c7983ebbea33 && git rev-parse HEAD'

# 4. Reconcile privileges using THAT checkout's privileges.sql — not optional.
#    Argv-safe by construction: the reviewed parser supplies the password via
#    PGPASSWORD and the rest via PG*, so no raw DSN and no password reaches
#    argv, the terminal or any retained artifact. The file executed is the
#    a32a0a1 tree's own tools/maintenance/privileges.sql, which is the one
#    compatible with the restored migration-057 schema (issues.md:1068).
scp scratchpad/afldb-dsn-parse.py afldb:/tmp/afldb-dsn-parse.py
/usr/bin/ssh -o BatchMode=yes afldb '
  set -u
  trap "rm -f /tmp/afldb-dsn-parse.py" EXIT
  [ "$(sha256sum /tmp/afldb-dsn-parse.py | cut -d" " -f1)" = eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f ] || { echo "FATAL: parser hash mismatch"; exit 5; }
  ENVF=/home/arm/projects/afldb/.env
  IDENT=$(python3 /tmp/afldb-dsn-parse.py --identity "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  echo "owner DSN identity: $IDENT"
  [ "$IDENT" = "role=afldb_owner host=localhost port=5432 dbname=afldb_prod" ] || { echo "FATAL: DSN identity mismatch"; exit 4; }
  PGPASSWORD=$(python3 /tmp/afldb-dsn-parse.py --password "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  export PGPASSWORD PGHOST=localhost PGPORT=5432 PGUSER=afldb_owner PGDATABASE=afldb_prod
  cd /home/arm/projects/afldb
  git rev-parse HEAD    # must print a32a0a1abacbf49a979343094b28c7983ebbea33
  psql -X -v ON_ERROR_STOP=1 -P pager=off -c "SELECT current_database(), current_user"
  psql -X -v ON_ERROR_STOP=1 -P pager=off -f tools/maintenance/privileges.sql
'

# 5. VERIFY BEFORE STARTING THE OLD APPLICATION — the six-check gate below.

# 6. Restore compatible dependencies and build.
ssh afldb 'cd ~/projects/afldb && npm ci && AFLDB_ENV=production npm run build'

# 7. Start the service.
ssh afldb 'sudo systemctl start afldb'

# 8. Post-start health, then restart the intake timer.
ssh afldb 'systemctl status afldb --no-pager | head -20; curl -s http://127.0.0.1:<PROD_PORT>/api/health; echo'
ssh afldb 'sudo systemctl start afldb-email-intake.timer'
```

#### Step 5 — the recovery verification gate, before the old application starts

All six must hold. Run the read-only checks through the §3 envelope.

| # | Check | Required |
|---|---|---|
| 1 | **Database identity** | `current_database() = afldb_prod`, `current_user = afldb_owner`, asserted in-session by the §3 identity gate |
| 2 | **Migration high-water mark is exactly 057** | `SELECT count(*), max(name) FROM afldb_meta.schema_migrations` → `57`, `057_data_edits.sql` |
| 3 | **No post-057 object survived** | §3.3a queries **B, C, D, E** re-run against `afldb_prod`: every `absent` true; `honour_team_uq` present again; `player_link_resolutions` back to **9** columns |
| 4 | **Privileges reconciled from `a32a0a1`** | step 4 exited 0 from a tree whose `git rev-parse HEAD` printed `a32a0a1…`, and the app role can read — `SELECT count(*) FROM players` succeeds as `afldb_app` |
| 5 | **The original 057-pinned ISSUE-079 audit passes again** | run `artifacts/audits/issue-079-audit-prod-20260823.sql` through the §3 transport at its recorded sha256 `2f00ff5477bc8bf7b9654765e846a42bf6e371f0f1f300b50f52c5e9a7bd0dc8`: every assertion `t` — **including S16 (high-water mark 057) and S17 (post-057 player-link schema absent)** — and counts equal to the P0.11 baseline |
| 6 | **Data parity** | the nine Phase-2 **E1** comparands match the restored database |

**Check 5 is the load-bearing one, and its choice is deliberate.** After a full
rollback the schema is back at 057, so the **original** 057-pinned audit is the
correct file — and its S16/S17 assertions are exactly the ones a surviving
post-057 object would trip. The regenerated post-070 file would correctly
refuse and must not be used here.

**If any check fails, do not start the application.** Re-run the clearing loop
and restore (both idempotent), or escalate to the `dropdb`/`createdb` fallback
above. Starting `a32a0a1` against a hybrid schema is the same class of mistake
as starting it against the migrated one.

**Step 4 is the one that is easy to skip and expensive to skip:** the dump is
taken `--no-privileges`, so a restore recreates every table with no ACLs at all
and `afldb_app` can read nothing. `npm run db:migrate` will not fix it — every
migration is already recorded in `afldb_meta.schema_migrations`, so the runner
correctly reports nothing to apply and the grants stay missing
(`docs/backup-restore.md:140-145`).

`tools/validation/validate_migration.py` is the documented post-restore
verification but needs a Python environment; confirm one exists on the droplet
before relying on it, and otherwise rely on gate checks 5 and 6 above.

---

## Phase 4 — activate `<TARGET_SHA>` and record the code-activation boundary

Deferred to here so the old standalone build never coexists with a new source
tree while serving traffic.

```bash
ssh afldb 'cd ~/projects/afldb && git pull --ff-only && date -Is'
ssh afldb 'cd ~/projects/afldb && git rev-parse HEAD && git status --porcelain && ls src/db/migrations | tail -14'
ssh afldb 'cd ~/projects/afldb && sha256sum tools/maintenance/privileges.sql tools/migration/common.py tools/migration/import_awards.py tools/migration/import_draft.py tools/records/import-first-kick-goal.ts src/db/queries/awards-admin.ts'
```

**Expect:**

- `git pull --ff-only` succeeds — the mechanical fast-forward guard;
- `HEAD` = `<TARGET_SHA>`;
- `git status --porcelain` empty except explicitly accepted **ignored** paths
  (`data/records/first-kick-goal.csv` if already present, `artifacts/`, `.env`,
  `node_modules/`, `.next/`) — tracked files must be clean;
- migrations `058_data_edits_editor_entities.sql` through
  `070_import_reads_link_suggestions.sql` all present.

Cross-check the six hashes against the workstation at `<TARGET_SHA>`:

```bash
for f in tools/maintenance/privileges.sql tools/migration/common.py tools/migration/import_awards.py tools/migration/import_draft.py tools/records/import-first-kick-goal.ts src/db/queries/awards-admin.ts; do
  printf '%s ' "$f"; git -C d:/dev/afldb show "<TARGET_SHA>:$f" | sha256sum
done
```

This is the positive proof that the **ISSUE-080-corrected** `import_awards.py`,
its matching `common.py` and `awards-admin.ts`, and the ISSUE-078
`import_draft.py` / `import-first-kick-goal.ts` are the bytes on the host.

### 4.1 Record the code-activation boundary

Migration `applied_at` records when the **schema** changed. It says nothing
about which importer bytes were on disk. The loader implementation changes
**here**, at activation. Record all three, durably, in `issues.md`:

| Boundary datum | Value |
|---|---|
| `<TARGET_SHA>` | the activated revision |
| `<ACTIVATION_TS>` | the `date -Is` printed immediately after `git pull --ff-only` succeeded, on the production host |
| `<LOADER_HASHES>` | the six sha256 values above |

**`import_batches` carries no code-version field.** Nothing stored in the
database can, on its own, say which importer bytes produced a historical row.
`<TARGET_SHA>`, `<ACTIVATION_TS>` and `<LOADER_HASHES>` recorded here **are**
that provenance, and they live in `issues.md`, not in the data. Migration
`applied_at` remains **solely** the schema boundary and is never used as a
substitute.

**In this rollout, no importer can run between Phase 1 and Phase 11:** every
writer is stopped, and the single importer invocation (`--rekey`, Phase 9)
writes **no `import_batches` row** (`import-first-kick-goal.ts:322-411`). That
is what makes the attribution safe here — not any property of the batch rows
themselves. Query 13e in Phase 10 **corroborates** it by showing no batch
activity after `<ACTIVATION_TS>`; it does not, and cannot, independently
establish which code produced any earlier row.

A future run is attributable to keyed code **only** by the same durable
provenance: its `started_at` later than `<ACTIVATION_TS>` on a host whose
loader files hash to `<LOADER_HASHES>` at `<TARGET_SHA>`.

**STOP if:** `git pull --ff-only` refuses, `HEAD` is not `<TARGET_SHA>`, a
tracked file is dirty, a migration is missing, or any hash disagrees.

**Retry:** safe and idempotent.
**Rollback:** `git checkout a32a0a1…` restores the previous tree; the service is
stopped either way and nothing in the database has been mutated.

---

## Phase 5 — apply migrations 058–070

```bash
ssh afldb 'cd ~/projects/afldb && npm run db:status'
ssh afldb 'cd ~/projects/afldb && AFLDB_MIGRATE_TARGET=prod npm run db:migrate'
ssh afldb 'cd ~/projects/afldb && npm run db:status'
```

`db:status` is used here — after write isolation — because its
`CREATE … IF NOT EXISTS` statements are no longer inside a phase claiming no
database mutation. On this database they are no-ops. The migration runner
parses `.env` itself (`tools/db/migrate.ts:40-84`), so no credential handling
is required.

`AFLDB_MIGRATE_TARGET=prod` is deliberate: on this host it resolves to the same
database as the default, but it states the intent and is the form
`docs/production-cutover.md:156` documents.

**Expect:** `13 pending` before; each of `058` … `070` reported `ok (N ms)`;
`Applied 13 migration(s).`; `0 pending` after, with
`070_import_reads_link_suggestions.sql` last applied. **Record each
migration's `applied_at`** — this is the *schema* boundary, kept alongside but
never substituted for `<ACTIVATION_TS>`.

**Semantics that matter:** each migration runs in its own transaction
(`migrate.ts:170-180`); a failure rolls back **that migration only** and exits
1, leaving earlier ones applied. Migrations are **forward-only** — there is no
down-migration, and none must be invented.

**STOP conditions:**

- any migration reports `FAILED`. The printed PostgreSQL message is the
  evidence. **Do not retry blindly.** 059 and 069 fail closed on data that
  Phase 2 proved clean under quiescence, so a failure here means something
  changed or the evidence was misread;
- `db:status` afterwards reports anything but `0 pending`.

**Retry:** safe. `db:migrate` is resumable — it applies only what is still
pending, so re-running after a corrected data problem continues from the failed
migration.

**Rollback:** none by reversal. Either fix the data and go forward, or execute
§3.4. **This is the first irreversible checkpoint of the rollout, and `<G1_DUMP>`
is still lossless because no production write has been reopened.**

---

## Phase 6 — privilege reconciliation, with a table **and sequence** gate

### 6.1 Run the reconciler

`npm run db:privileges` expands `"$AFLDB_OWNER_DATABASE_URL"` from **its own
environment**; it does not load `.env`, and the repository has no `.npmrc`. Two
equivalent invocations run the identical `tools/maintenance/privileges.sql`
from the activated checkout:

**Variant A — the shipped npm script, exporting only the one variable:**

```bash
ssh afldb 'cd ~/projects/afldb && export AFLDB_OWNER_DATABASE_URL="$(sed -n "s/^AFLDB_OWNER_DATABASE_URL=//p" .env | head -1)" && npm run db:privileges'
```

This exports one credential rather than the whole `.env`. Be aware of what the
shipped script itself does: **the DSN reaches `psql`'s argv**, so it is visible
in `ps` and `/proc/<pid>/cmdline` to the same user for the life of the command.
That is the packaged contract, not something this runbook introduces.

**Variant B — argv-free, identical file, using the reviewed parser:**

```bash
scp scratchpad/afldb-dsn-parse.py afldb:/tmp/afldb-dsn-parse.py
/usr/bin/ssh -o BatchMode=yes afldb '
  set -u
  trap "rm -f /tmp/afldb-dsn-parse.py" EXIT
  [ "$(sha256sum /tmp/afldb-dsn-parse.py | cut -d" " -f1)" = eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f ] || { echo "FATAL: parser hash mismatch"; exit 5; }
  ENVF=/home/arm/projects/afldb/.env
  IDENT=$(python3 /tmp/afldb-dsn-parse.py --identity "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  echo "owner DSN identity: $IDENT"
  [ "$IDENT" = "role=afldb_owner host=localhost port=5432 dbname=afldb_prod" ] || { echo "FATAL: DSN identity mismatch"; exit 4; }
  PGPASSWORD=$(python3 /tmp/afldb-dsn-parse.py --password "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  export PGPASSWORD PGHOST=localhost PGPORT=5432 PGUSER=afldb_owner PGDATABASE=afldb_prod
  cd /home/arm/projects/afldb
  psql -X -v ON_ERROR_STOP=1 -P pager=off -f tools/maintenance/privileges.sql
'
```

Variant B is preferred on a public host; Variant A is acceptable and is what
the documentation names. **Either way the file must come from the activated
`<TARGET_SHA>` checkout** — running a stale checkout's `privileges.sql` revokes
the grants (`issues.md:1068`).

**Expect:** the reconciler's `RAISE NOTICE` lines and exit 0, including the
import-role notices covering `data_edits`, `player_link_resolutions` and
`player_link_suggestions`, and the `afldb_auth` line reporting grants applied
across its table list.

### 6.2 The privilege gate — tables and sequences

Run through the §3 read-only envelope:

```sql
\echo '== P1. afldb_import TABLE privileges on the three audit tables =='
SELECT table_name, privilege_type
  FROM information_schema.table_privileges
 WHERE grantee = 'afldb_import'
   AND table_name IN ('player_link_resolutions','player_link_suggestions','data_edits')
 ORDER BY table_name, privilege_type;

\echo '== P2. afldb_import SEQUENCE privileges (migration 066 contract) =='
SELECT c.relname                                               AS sequence_name,
       has_sequence_privilege('afldb_import', c.oid, 'USAGE')  AS usage_priv,
       has_sequence_privilege('afldb_import', c.oid, 'SELECT') AS select_priv,
       has_sequence_privilege('afldb_import', c.oid, 'UPDATE') AS update_priv
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relkind = 'S'
   AND c.relname IN ('data_edits_id_seq',
                     'player_link_resolutions_id_seq',
                     'player_link_suggestions_id_seq')
 ORDER BY c.relname;
```

**Required — tables:**

| Table | `afldb_import` privileges |
|---|---|
| `player_link_resolutions` | exactly `INSERT`, `SELECT` |
| `player_link_suggestions` | exactly `SELECT` |
| `data_edits` | exactly `INSERT` |

No `UPDATE`, `DELETE` or `TRUNCATE` on any of the three — append-only from the
import role's side by design (migrations 066/068/070).

**Required — sequences:**

| Sequence | `usage_priv` | `select_priv` | `update_priv` |
|---|---|---|---|
| `data_edits_id_seq` | **t** | f | f |
| `player_link_resolutions_id_seq` | **t** | f | f |
| `player_link_suggestions_id_seq` | f | f | f |

This is exactly the reconciler's contract: the import revoke loop strips all
sequence privileges for tables outside `import_writable_tables`
(`privileges.sql:255-259`), then migration 066's two sequences are re-granted
**USAGE only** (`privileges.sql:290,295`). `player_link_suggestions` gains
SELECT on the table and no sequence grant, because the import role never
inserts into it. `USAGE, SELECT, UPDATE` on a sequence is reserved for
`import_writable_tables` members needing `setval()` after a bulk load
(`privileges.sql:246-247`); none of these three qualifies, and seeing it here
would be a real widening. The same shape is already asserted on `afldb_test` by
`tests/integration/privileges.test.ts` (`issues.md:1064`).

**STOP if:** the reconciler exits non-zero; any required grant is missing; any
`UPDATE`/`DELETE`/`TRUNCATE` appears on the three tables; or any sequence shows
a privilege beyond the table above.

**Also capture the revocation notices.** `privileges.sql` revokes anything
absent from its registries. An unexpected revocation on `afldb_app` or
`afldb_auth` means a public table exists that was never registered with
`afldb_meta.grant_app_read()`, and it will surface as a broken page in
Phase 11. Record it now rather than discovering it there.

**Retry:** safe. `privileges.sql` is a reconciler designed to be re-run.

---

## Phase 7 — production-mode build — **GATE G2**

Only if P0.5 showed a dependency delta:

```bash
ssh afldb 'cd ~/projects/afldb && npm ci'
```

Then, always:

```bash
ssh afldb 'cd ~/projects/afldb && AFLDB_ENV=<AFLDB_ENV_VALUE> npm run build'
```

**Why exactly one variable is passed.** `next build` loads `.env` itself, which
is why the documented routine deployment (`docs/deployment.md:51-61`) sources
nothing at all. The single gap is `prepare-standalone.mjs`, a separate Node
process that reads `process.env.AFLDB_ENV` **from the shell only**
(`prepare-standalone.mjs:33`). Passing that one already-verified value —
`<AFLDB_ENV_VALUE>` from P0.4, required to be `production` — closes the gap
without exporting a single production credential into the interactive shell.

**Required build evidence:**

1. `next build` completes without error;
2. **`prepare-standalone: AFLDB_ENV=production detected (HSTS and production
   CSP enabled)`** — this exact line;
3. `prepare-standalone: copied .next/static`;
4. `prepare-standalone: created .next/cache for ISR`;
5. `prepare-standalone: standalone bundle ready`.

**STOP — do not start the service — if** the build prints
`prepare-standalone: info: AFLDB_ENV is not production; building with
development headers`. That bundle would serve without HSTS and with the
development CSP on a public HTTPS host. Fix the environment and rebuild; never
ship it.

Both halves of the build are required — without them the site starts but every
stylesheet 404s and ISR cannot persist (`docs/deployment.md:73`).

On 2 vCPU, if prerendering exhausts connections or memory, cap it:
`AFLDB_BUILD_WORKERS=2 AFLDB_ENV=<AFLDB_ENV_VALUE> npm run build`.

**STOP if:** the build fails on a missing column or relation — a migration did
not apply as believed; return to Phase 5's evidence rather than patching the
build.

**Retry:** safe and idempotent.

**Rollback:** the schema is at 070 and the old checkout **must not** be started
against it. If the build cannot be made to succeed, the path is §3.4 in full —
still lossless, because no production write has been reopened.

**Gate G2 passes when** the schema is at 070, the privilege gate passed, and a
production-mode standalone bundle exists for `<TARGET_SHA>`. The service stays
stopped.

---

## Phase 8 — Profile-B ISSUE-080 audit — **GATE G3**

**Purpose.** Produce, classify and durably record the Profile-B evidence so the
first *future* production awards/honours reload has a valid gate. No reload is
performed in ISSUE-084, so nothing here authorises a write; it establishes the
comparand.

**Placement.** After migrations, privileges and the corrected loaders are in
place (ISSUE-080 §7.2), and before any awards/honours reload — which, in this
rollout, means before any such reload ever occurs. It requires the migrated
schema and the deployment-candidate code, **not** a running application, which
is why it fits inside write isolation.

### 8.1 Plane A — production, Profile-B schema gate

Execute the file authored and hashed in P0.8a, through the §3 transport, into
`artifacts/audits/issue-080-planea-prod-<rundate>-profileB.txt`.

Profile-B gate items (ISSUE-080 §7.2):

| Gate item | Profile A (057) | **Profile B (070)** |
|---|---|---|
| `honour_team_uq` (total constraint) | present | **must be ABSENT** |
| `honour_team_linked_player_uq` | absent | **present**, partial `WHERE player_id IS NOT NULL` |
| `honour_team_unlinked_name_uq` | absent | **present**, partial `WHERE player_id IS NULL` |
| `player_link_resolutions.match_method` / `.match_score` / `.algorithm_version` | must not be assumed | **present** (migration 067) |
| `player_link_match_candidates` | absent | **present** |
| `data_edits` allowlist | 057 list | **058 widened list** |
| Applied high-water mark | `057_data_edits.sql` | **`070_import_reads_link_suggestions.sql`** |
| `22-under-22` award / `wikipedia_22under22` source | evidence only | now deployed in code; report ids as evidence — **not** a hard gate here, since no reload occurs |

Everything else follows ISSUE-080 §7.3 unchanged: totals; provenance counts; in-domain
scope counts for `award_winners` and `award_nominations`; foreign-owned rows in
`hall_of_fame` and `honour_team_members`; link-decision joins on
`target_table = '<name>' AND target_id = …` (**never** on numeric id alone);
`data_edits` evidence; and all four stored-state collision sets — with the
honour-team set evaluated against **Profile B's two partial indexes**, a
different question from Profile A's total constraint. Row detail is bounded to
the exposed/foreign set, with no admin emails and no free-text bodies.

**Expected result, from the Profile-A baseline:** `hall_of_fame` 343 rows and
`honour_team_members` 113 rows, **all Wikipedia-owned**; legacy-winner domain
1,810; All-Australian 1,158; Rising Star 766; **zero foreign-owned, zero
NULL-source, zero foreign+linked rows**; every stored-state collision set
empty.

### 8.2 Plane B — re-derived from the deployment candidate, in a clean worktree

Generated in P0.9 on the **development** host, where the canonical artifact
lives. Production is never written to and never sees the extract.

**The dev host's main worktree is not required to be clean, and nothing in it
is stashed, restored or discarded.** A temporary worktree pinned to
`<TARGET_SHA>` supplies the code:

```bash
ssh dev 'cd ~/projects/afldb && git fetch --all --prune && git worktree add /tmp/afldb-planeb <TARGET_SHA>'
ssh dev 'cd /tmp/afldb-planeb && git rev-parse HEAD && git status --porcelain && git rev-parse HEAD:tools/migration/common.py && git rev-parse HEAD:tools/migration/import_awards.py && sha256sum tools/migration/common.py tools/migration/import_awards.py'
ssh dev 'sha256sum /home/arm/projects/sports_data_lab/data/afl/afl.db; stat -c "%s %y" /home/arm/projects/sports_data_lab/data/afl/afl.db'
# … run the generator inside /tmp/afldb-planeb …
ssh dev 'cd ~/projects/afldb && git worktree remove /tmp/afldb-planeb'
```

**Required:** the temporary worktree's HEAD is `<TARGET_SHA>` and its
`git status --porcelain` is empty; both blob ids and file hashes recorded; the
artifact sha256 is
`a56fef4e79f3583a5dfa773190412abd4b4a3eca347a8ec95de6d1b960eac547`.

**Re-verify the artifact hash at classification time** (§8.3), not only at
generation time — it is one `sha256sum` and it is what pins the keyset.

**The generator's contract, reproduced here so the gate does not depend on the
untracked scratchpad JSON:**

| Contract element | Value |
|---|---|
| Gate order | `argv → repo HEAD → code blob ids → git porcelain clean → sys.path/import → artifact sha256` |
| Imported from `common.py` | `clean_text`, `to_int`, `connect_legacy` |
| Reproduced from `import_awards.py` | `import_hall_of_fame`: SELECT, skip rule, key construction; `import_honour_teams`: SELECT, skip rule, key construction |
| Hall of Fame | SQLite table `hall_of_fame`; key `(clean_text(name), to_int(inducted_year))`; skip when `clean_text(name)` is falsy |
| Honour teams | SQLite table `team_selections`; key `(clean_text(team_name), clean_text(name))`; skip when either is falsy |
| Per-key line | `json.dumps(list(key), ensure_ascii=False, separators=(',',':'))` |
| NULL rendering | `None → null`, never the string `"null"`; ints unquoted |
| Ordering | `sorted()` over the **DISTINCT** serialised lines |
| Payload | `'\n'.join(lines) + '\n'`, encoded UTF-8 |
| Hash | `sha256` of that payload |
| Excluded from fingerprint | `generated_utc`, artifact metadata |
| Evidence-JSON transport | outer JSON `ensure_ascii=True` for ASCII-safe SSH transport; the fingerprint payload stays `ensure_ascii=False` UTF-8 |

Record in `artifacts/audits/issue-080-planeb-dev-<rundate>-profileB.json`: repo
HEAD, both code blob ids, worktree status, Python and SQLite runtime versions,
artifact path/size/mtime/sha256, and per keyset `rows_read`, `rows_skipped`,
`keys_emitted`, `keys_distinct`, `duplicate_count`, `fingerprint`.

**A self-test that proves the rewritten generator at no extra risk.** ISSUE-080
changed ownership scoping and collision preflights; it did **not** change
`clean_text`, `to_int`, the skip rules or key construction — verified this
session at `common.py:90-113`, `import_awards.py:996-1023` and `:1143-1168`.
Therefore, against the **same** artifact, a correct generator run at
`<TARGET_SHA>` **must reproduce the Profile-A fingerprints exactly**:

| Keyset | read | skipped | emitted | distinct | dup | fingerprint |
|---|---:|---:|---:|---:|---:|---|
| Hall of Fame | 343 | 0 | 343 | 343 | 0 | `bcb0c3d609eb9d6251d22488d63ca86fb9f0e998ddec42d076e7e713a3e6bcc7` |
| Honour teams | 113 | 0 | 113 | 113 | 0 | `4a9710b29118f62bd8fb78178e7698513c0a44e5686016be088d04f784777110` |

A match confirms **both** that the generator is correct **and** that the keyset
is unchanged. A mismatch is disambiguated by checking the artifact sha256
first: unchanged artifact ⇒ suspect the generator; changed artifact ⇒ genuine
keyset change.

### 8.3 Classification and outcomes (ISSUE-080 Correction 1, 2026-08-23)

The **operative comparison** is (a) the canonical artifact SHA-256 and (b) the
regenerated incoming natural-key counts and fingerprints. The pre-fix code HEAD
`9b628612…` and blobs `579e129b…` / `b19ea80a…` are **historical provenance
only** — ISSUE-080 necessarily changed both files, so a changed blob does not by
itself invalidate Profile B.

**The schema gate is evaluated first, and it is a different kind of thing from
the classification.** The schema gate asks "is the deployment what it should
be?"; the classification asks "is a future reload safe?". They therefore
resolve to different verbs (§2.6).

| Outcome | Definition | Verb (§2.6) | What happens |
|---|---|---|---|
| **PASS** | Schema gate passed; every Plane-A assertion returned; Plane B regenerated with its full evidence record; artifact SHA-256 and both count/fingerprint pairs match the baseline; Plane A shows zero foreign-owned rows and every stored-state collision set empty | — | Classification set is empty (ISSUE-080 §7.4 "No exposure"). Record as the standing gate for the first future reload. **This is the only outcome that permits closing ISSUE-084** |
| **SCHEMA-GATE REFUSAL** | Any Profile-B gate item mismatched: a missing `honour_team_linked_player_uq` or `honour_team_unlinked_name_uq`; a surviving `honour_team_uq`; an absent `player_link_match_candidates`; a missing 067 column; the 058 `data_edits` allowlist not widened; the high-water mark not `070_import_reads_link_suggestions.sql` | **HALT** | The deployed state contradicts what Phases 5–7 reported, so the deployment is **not** proven healthy. **Do not proceed to Phase 9.** Diagnose against the Phase 5 migration log and the Phase 6 matrices, then forward-repair or recover. **This is never recorded as an awards-reload ambiguity.** |
| **AUDIT COULD NOT COMPLETE** | Transport or `psql` failure; the artifact does not end in `ROLLBACK` with status 0; a Plane-A assertion did not return | **RETRY**, then **HALT** | Re-run once. If it still cannot complete, this rollout's own evidence cannot be trusted — **HALT**; do not proceed to Phase 9 on an unproven deployment |
| **STALE / INVALID** | Schema gate **passed**, but the artifact SHA-256 differs, or either count or either fingerprint differs, or normalisation/skip/key-derivation code changed | **BLOCK** | The classification is void; the newly generated keyset is authoritative and the Plane-A × Plane-B classification is redone, never waived. Deployment proven healthy → continue Phases 9–11 under §8.4 |
| **AMBIGUOUS EXPOSURE** | Schema gate **passed**, but any `incoming_key_present` row; any `ambiguous` row; any non-empty stored-state collision set; any exposed row whose ownership cannot be attributed; any `incoming_key_present` row carrying a link decision | **BLOCK** | Each is a separate curator decision recorded in `issues.md`. Do not encode a default. Continue Phases 9–11 under §8.4 |
| **PLANE B UNOBTAINABLE** | Schema gate **passed**, but the canonical artifact is unreadable or Plane B cannot be derived | **BLOCK** | The reload gate is simply unestablished. Continue Phases 9–11 under §8.4 |

No outcome is ever waived informally, and no BLOCK is available while the
schema gate is refused — a refusal is a HALT regardless of what the
classification would have said.

### 8.4 What a BLOCK does — and, precisely, what it does not do

**A Profile-B PASS is required to close AFLDB-ISSUE-084.** On a **BLOCK**
outcome — and only on a BLOCK, which by definition means the Profile-B schema
gate itself passed and Gate G2 held:

- **no awards/honours reload is authorised** on production, then or later;
- the result is **not** informally waived or reclassified;
- **ISSUE-084 is not closed** — it stays open with the blocker recorded and its
  `IssuesIndex.md` next action set to resolving the Profile-B outcome;
- the deployed schema, privileges and code are **preserved, not rolled back**.
  The protective deployment is itself the fix for the destructive-reload
  exposure and is strictly safer than `a32a0a1`; reverting it would restore that
  exposure in order to remove an audit ambiguity, which is the wrong trade;
- **the rollout continues** to Phases 9, 10 and 11: `--rekey` and the integrity
  audit are independent of Profile B, and the healthy protected application is
  started so production is not left dark;
- a separate tracked issue is created or updated **only** if the finding meets
  the `CLAUDE.md` criteria.

On a **HALT** outcome none of the above applies: the rollout stops where it is,
Phase 9 is not entered, and the resolution is forward repair or §3.4 recovery
chosen from the evidence.

**"Blocks closure and blocks any future awards/honours reload"** and
**"requires rollback of the protective deployment"** are different states. Only
evidence of **actual production data damage** — a dangling resolution, a lost
row, a failed Phase 10 gate — or a deployment that is not proven healthy puts
§3.4 on the table. A Profile-B classification ambiguity does not.

### 8.5 Standing consequence recorded by ISSUE-084

Because no reload runs here, Plane B is pinned to the artifact present at this
run. The first future production awards/honours reload **must** re-derive
Plane B against the artifact it will actually consume and re-apply §8.3. If
that artifact's SHA-256 differs, the classification is void and must be redone.
Independently of the artifact, migration 059 changes what a honour-team
collision *means*, so a Profile-A "no collision" result never carries over on
its own. This standing gate is written into both the ISSUE-080 and ISSUE-084
ledger entries in Phase 12.

---

## Phase 9 — one-time `--rekey` (conditional)

**Entry condition.** Phase 9 is entered only if Phase 8 ended in **PASS** or
**BLOCK**. A Phase-8 **HALT** — a Profile-B schema-gate refusal, or an audit
that could not be completed or trusted — means the deployed state is not proven
healthy, and `--rekey` is irreversible: **never enter Phase 9 out of a HALT**
(§2.6).

### 9.1 Confirm applicability immediately before acting

Re-run section **C1** of the preflight script through the §3 envelope.

Under this ordering the state **cannot** have changed since Phase 2 — every
writer has been stopped throughout — so this is a cheap confirmation rather
than a fresh determination. It is run anyway, because acting on a stale reading
is exactly the failure mode this runbook is built to avoid.

| Result | Action |
|---|---|
| `owned_rows = 334`, `legacy_format = 334`, `stable_format = 0` | Run `--rekey` **once** (9.3) |
| `owned_rows = 334`, `stable_format = 334`, `legacy_format = 0` | Production is already in the stable format. Running `--rekey` here is a **verification no-op**, not proof that the historical transition happened exactly once — no evidence of that exists on this host. Run it once for the verification and record it as such |
| `owned_rows = 0` | **Do not run `--rekey`.** It would report `unmatched manifest 334` and exit 1 having written nothing — a correct refusal that proves nothing. Record the finding: the transition applies at the first production first-kick-goal load, outside ISSUE-084's scope |
| **Mixture** (`stable_format > 0` **and** `legacy_format > 0`), or `owned_rows` neither 0 nor 334 | **STOP.** `--rekey` aborts on a mixture by design (`import-first-kick-goal.ts:355-361`); the discrepancy is an investigation, not a deployment step |

### 9.2 Prerequisite — the extract file must exist on production

`main()` reads the CSV extract before dispatching to the rekey branch
(`import-first-kick-goal.ts:685-696`), and `data/records/first-kick-goal.csv`
is **gitignored** (`.gitignore:42`), so `git pull` did not deliver it. Only the
manifest `data/records/first-kick-goal-ids.csv` is tracked.

```bash
ssh afldb 'ls -l ~/projects/afldb/data/records/ 2>/dev/null || echo "absent"'
# if the extract is absent:
scp d:/dev/afldb/data/records/first-kick-goal.csv afldb:~/projects/afldb/data/records/first-kick-goal.csv
ssh afldb 'sha256sum ~/projects/afldb/data/records/first-kick-goal.csv ~/projects/afldb/data/records/first-kick-goal-ids.csv'
```

Cross-check both hashes against the workstation copies. The rekey bridge maps
**database clean names → manifest ids**; the extract is read but not used for
the mapping. The curated extract is nonetheless the correct file to place, and
the manifest hash must match exactly.

### 9.3 Run it once

```bash
ssh afldb 'cd ~/projects/afldb && npm run records:first-kick-goal -- --rekey'
```

It connects as `AFLDB_IMPORT_DATABASE_URL` (`afldb_import@afldb_prod`), read
from `.env` by the tool itself (`import-first-kick-goal.ts:323-325`).

**Expected evidence — the preflight report, printed before any write:**

```
Rekey preflight:
  active manifest rows        334
  owned database rows         334
  exact 1:1 mappings          334
  unmatched manifest rows     0
  unmatched database rows     0
  duplicate/ambiguous         0
Rekeyed 334 row(s) in place; every surrogate id is unchanged.
```

Or, in the already-transitioned case:
`Already rekeyed: 334 owned row(s) carry valid manifest ids. Nothing to do.`

**Run it once. Do not re-run it as a confirmation step** — the confirmation is
the read-only query in 9.4. A retry is state-safe
(`import-first-kick-goal.ts:317-361`: all-legacy → rekey in place; all-stable →
verify and no-op; a mixture → abort before mutation) and is appropriate **only**
when the first invocation was interrupted or its outcome is genuinely
uncertain — for example an SSH drop mid-run.

**STOP conditions:**

- any non-zero figure in `unmatched manifest rows`, `unmatched database rows`
  or `duplicate/ambiguous` — the tool prints the offending rows and writes
  nothing. Do not force it, and **never** reach for `--allow-link-loss`: it is
  not part of this rollout and is not a remediation;
- `Mixed identity state: N row(s) already carry fkg ids and M do not` — manual
  review, not a deployment step;
- `N stored row(s) carry a stable id the manifest does not know` —
  investigate;
- a permission error on `player_achievements` — return to Phase 6's evidence.

**Rollback.** `--rekey` writes `source_record_id` and nothing else; every
surrogate id is preserved, so it cannot orphan a
`player_link_resolutions.target_id`, and it writes no `import_batches` row.
There is no reverse mode and none must be invented; if it must be undone, the
recovery is §3.4 — **still lossless, because no production write has been
reopened.**

### 9.4 Confirm by read-only query

Re-run section **C1**. **Required:** `owned_rows = 334`,
`stable_format = 334`, `legacy_format = 0`.

---

## Phase 10 — regenerated post-070 ISSUE-079 integrity audit — **GATE G4**

This is the rollout's data-integrity proof, and it runs **before any production
write is reopened**, so a failure can still be answered with a lossless restore
of `<G1_DUMP>`.

The 057-pinned production audit
(`artifacts/audits/issue-079-audit-prod-20260823.sql`) is held to migration 057
by assertions **S16** and **S17**. After Phase 5 both refuse by design. **It
must be regenerated — never rerun, never relaxed.** Retain the 057 file
unchanged as historical evidence; §3.4 step 7 is the one place it becomes valid
again.

### 10.1 The post-070 source file already exists

`artifacts/audits/issue-079-audit-dev-20260823.sql` is the **post-070 variant**
of the same audit, already generated and reviewed for a migration-070 schema:
`S05dev` (twelve post-067 `player_link_resolutions` columns),
`S16dev`/`S17dev` pinned to `070_import_reads_link_suggestions.sql` and to the
*presence* of the 067 schema, and `S18dev` (the eighteen
`player_link_match_candidates` columns). Its **primary queries 1–11 are
byte-identical** to the production file, which is what makes the counts
directly comparable across environments and across time.

The **template** authored in P0.8b is that source file with exactly these
changes. Two of them (items 5–6 and item 8) carry placeholders that Phase 10.2
populates:

1. **Header** stating the schema this rollout produces — applied migrations
   `001 … 070` — and naming the evidence it was generated from. The observed
   `applied_at` values are recorded in the artifact and `issues.md`, not baked
   into the header.
2. **Identity gate** → `current_database() = 'afldb_prod'` and
   `current_user = 'afldb_owner'`; both read-only settings and the isolation
   level unchanged.
3. **`S16dev`/`S17dev` → `S16prod`/`S17prod`**, same semantics, pinning the
   high-water mark to `070_import_reads_link_suggestions.sql` and asserting the
   067 schema is **present**.
4. **Query 13c** re-derived from the **deployed** `import_awards.py` `GROUPS`
   (`import_awards.py:1265-1273`), which includes a group the `a32a0a1` mapping
   did not:

   | tool | `import_batches.target_table` | link target |
   |---|---|---|
   | `import_awards.py` | `awards` | `award_winners` |
   | `import_awards.py` | `all_australian` | `award_winners` |
   | `import_awards.py` | **`under_22`** | **`award_winners`** |
   | `import_awards.py` | `rising_star` | `award_nominations` |
   | `import_awards.py` | `hall_of_fame` | `hall_of_fame` |
   | `import_awards.py` | `honour_teams` | `honour_team_members` |
   | `import_awards.py` | `captaincies` | `captaincies` |
   | `import_draft.py` | `draft_picks` | `draft_picks` |
   | `tools/records/import-first-kick-goal.ts` | `player_achievements` | `player_achievements` |

5. **A new comment fixing the era boundary** — placeholder `<ACTIVATION_TS>`,
   populated at Phase 10.2. Verbatim intent:

   > **`import_batches` has no code-version field, so nothing in this result
   > set can establish which importer bytes produced any historical row.** The
   > durable code-activation provenance is recorded outside the database:
   > `<TARGET_SHA>`, `<ACTIVATION_TS>` and `<LOADER_HASHES>` in `issues.md`.
   > Migration `applied_at` remains **solely** the schema boundary and is never
   > substituted for it.
   >
   > In this rollout every writer was stopped from Phase 1 to Phase 11, and
   > `--rekey` writes no batch row, so no batch activity is possible after
   > activation. Query 13e below **corroborates** that; it does not prove it,
   > and it says nothing about the provenance of earlier rows. On that basis —
   > the recorded provenance plus the isolation — every row visible here is
   > pre-activation, i.e. destructive-era.

6. **A new query 13e corroborating the boundary** — placeholder
   `<ACTIVATION_TS>`, populated at Phase 10.2:

```sql
\echo '== 13e - supplementary: batch rows on either side of the code-activation boundary =='
SELECT b.tool, b.target_table, b.status, count(*) AS runs,
       min(b.started_at) AS earliest, max(b.started_at) AS latest,
       (max(b.started_at) > TIMESTAMPTZ '<ACTIVATION_TS>') AS any_after_code_activation
  FROM import_batches b
 GROUP BY b.tool, b.target_table, b.status
 ORDER BY max(b.started_at) DESC;
```

   **Expected:** `any_after_code_activation` is **false** for every row. Read
   it as corroboration of the recorded provenance, not as provenance itself.

7. The dev-only diagnostics (`QUERY 3x`, `12a`–`12c`) are valid on a Profile-B
   schema and are **retained** behind the existing banner fence, so no post-067
   column appears in a primary result set.

8. **A new query 14 proving baseline survival by identity** — placeholder
   `<BASELINE_IDENTITIES>`, populated at Phase 10.2 from the Phase 2 capture:

```sql
\echo '== 14 - baseline survival: every Phase-2 resolution id still present and live =='
WITH baseline(id, target_table, target_id) AS (VALUES
    -- filled from the Phase 2 section G1 capture, e.g.
    -- (12,'honour_team_members',3407), (13,'honour_team_members',3411), …
    (NULL::bigint, NULL::text, NULL::bigint)
)
SELECT b.id, b.target_table, b.target_id,
       (r.id IS NOT NULL) AS resolution_still_present,
       (r.target_table = b.target_table AND r.target_id = b.target_id) AS identity_unchanged,
       CASE b.target_table
         WHEN 'award_winners'       THEN EXISTS (SELECT 1 FROM award_winners       x WHERE x.id = b.target_id)
         WHEN 'award_nominations'   THEN EXISTS (SELECT 1 FROM award_nominations   x WHERE x.id = b.target_id)
         WHEN 'hall_of_fame'        THEN EXISTS (SELECT 1 FROM hall_of_fame        x WHERE x.id = b.target_id)
         WHEN 'honour_team_members' THEN EXISTS (SELECT 1 FROM honour_team_members x WHERE x.id = b.target_id)
         WHEN 'captaincies'         THEN EXISTS (SELECT 1 FROM captaincies         x WHERE x.id = b.target_id)
         WHEN 'player_achievements' THEN EXISTS (SELECT 1 FROM player_achievements x WHERE x.id = b.target_id)
         WHEN 'draft_picks'         THEN EXISTS (SELECT 1 FROM draft_picks         x WHERE x.id = b.target_id)
         ELSE NULL
       END AS target_still_live
  FROM baseline b
  LEFT JOIN player_link_resolutions r ON r.id = b.id
 WHERE b.id IS NOT NULL
 ORDER BY b.id;
```

   …and the equivalent for `player_link_suggestions` from the G2 capture.

**Everything else stays byte-identical** to the source file, including the
fail-closed `coalesce(..., false)` gate aggregation, the per-row PK-lookup
target-existence test spelling out all seven tables, `ELSE NULL` meaning
Category B, and the terminating `ROLLBACK`.

### 10.2 Produce the executable file, review it, and create the authoritative hash

The Phase-0 artefact is a **template**. It cannot be the execution file,
because two of its values do not exist until this rollout produces them:

| Placeholder | Source | Established in |
|---|---|---|
| `<BASELINE_IDENTITIES>` in **Query 14** (resolutions and suggestions) | the quiescent preflight artifact, sections **G1**/**G2** | **Phase 2** |
| `<ACTIVATION_TS>` in **Query 13e** and its preceding comment | the `date -Is` captured immediately after `git pull --ff-only` | **Phase 4** |

Produce
`artifacts/audits/issue-079-audit-prod-<rundate>-post070.sql` from the template
by:

1. populating Query 14's `VALUES` list with the Phase-2 resolution identities,
   and its suggestion counterpart with the Phase-2 suggestion identities;
2. populating Query 13e's `TIMESTAMPTZ '<ACTIVATION_TS>'` literal and the
   `<ACTIVATION_TS>` / `<TARGET_SHA>` / `<LOADER_HASHES>` references in the
   preceding comment with the Phase-4 values;
3. **changing nothing else.** Diff the executable file against the template and
   confirm the only differences are those two populations.

Then:

4. **review the resulting executable SQL in full** — a complete read, not a
   skim, and not a re-read of the template;
5. compute and record its **sha256**. That value is the
   **execution-authoritative hash** used by the §3 transport's local and remote
   verification;
6. execute **only** that file.

The template's own sha256 may be retained as provenance — it records what was
reviewed before the outage — but it is **not** the execution hash, and the
template is never executed. Nothing in Phase 0 produces a hash that survives to
execution for this artefact. (The preflight script and the Profile-B Plane A
SQL are different: both are final at Phase 0 and their Phase-0 hashes *are* the
execution hashes.)

**STOP if:** the diff against the template shows any change beyond the two
populations, or the executable file cannot be made to match the approved
semantics.

### 10.3 Execute

Use the §3 transport with the Phase-10.2 file and its authoritative sha256,
writing to
`artifacts/audits/issue-079-player-link-integrity-prod-<rundate>-post070.txt`.

### 10.4 Required result

| Measure | Required |
|---|---|
| Identity gate | PASSED |
| Schema gate | every assertion `t`, including `S16prod`/`S17prod` |
| Dangling resolutions (Category A) | **0** across all seven families |
| Unknown-vocabulary resolutions (Category B) | **0** |
| Dangling suggestions | **0** |
| Unknown-vocabulary suggestions | **0** |
| **Query 14 — resolutions** | for **every** `<BASELINE_IDENTITIES>` row: `resolution_still_present = t`, `identity_unchanged = t`, `target_still_live = t` |
| **Query 14 — suggestions** | the same three, for every captured suggestion |
| Totals vs Phase 2 **F1** | unchanged — writers have been stopped since Phase 1, so any change is unexplained and must be investigated |
| Aggregate vs P0.11 | consistent: `honour_team_members` 6 resolutions live / 0 dangling; 2 suggestions live / 0 dangling; `linked` 3, `confirmed_unlinked` 3 |
| Query 13c / 13e | 0 loader runs per family; `any_after_code_activation` false everywhere |
| Transaction | ends `ROLLBACK`; `psql exit status: 0` |

Because production has been write-isolated since Phase 1, the totals should be
**exactly** the Phase 2 values, not merely `≥` them. A change either way is a
STOP.

**STOP if:** any dangling count is non-zero; any baseline row fails any of the
three Query-14 columns; any unknown-vocabulary row appears; the schema gate
refuses; or the artifact does not end in `ROLLBACK` with status 0.

**This is the one class of evidence that puts §3.4 on the table**, because it
is actual data damage rather than an audit ambiguity — and at this point the
restore is still lossless.

### 10.5 Retention

`artifacts/` is gitignored (`.gitignore:89`): raw evidence stays on the
workstation and the durable committed record is the counts written into
`issues.md`. Retain, unmodified:

| File | Role |
|---|---|
| `issue-079-audit-prod-20260823.sql` | the 057-pinned original — valid again only after a full §3.4 rollback |
| `issue-079-player-link-integrity-prod-20260823.txt` | the pre-rollout aggregate baseline |
| `issue-084-preflight-prod-<rundate>.sql` | the preflight script — final at Phase 0; its Phase-0 sha256 **is** its execution hash |
| `issue-084-preflight-prod-<rundate>-{live,quiescent}.txt` | preliminary and authoritative preflight runs; the quiescent one carries `<BASELINE_IDENTITIES>` |
| `issue-079-audit-prod-<rundate>-post070.template.sql` | the Phase-0 template, both placeholders unpopulated; its sha256 is **provenance only** and was never executed |
| `issue-079-audit-prod-<rundate>-post070.sql` | the Phase-10.2 executable file, with the **execution-authoritative** sha256 |
| `issue-079-player-link-integrity-prod-<rundate>-post070.txt` | the post-rollout result |
| `issue-080-planea-prod-<rundate>-profileB.{sql,txt}` | Profile-B Plane A |
| `issue-080-planeb-dev-<rundate>-profileB.json` | Profile-B Plane B evidence |

---

## Phase 11 — start the service, verify, reopen writes

**This phase reopens production writes.** The precise boundary matters: the
lossless window for `<G1_DUMP>` closes at **`systemctl start afldb`**, because
the application is itself a writer — an admin action recorded after that point
would be destroyed by a later restore. It does **not** close at the timer
restart. Everything irreversible and every integrity proof is already complete.

### 11.1 Start and verify

```bash
ssh afldb 'sudo systemctl start afldb'
ssh afldb 'systemctl status afldb --no-pager | head -20'
ssh afldb 'curl -s http://127.0.0.1:<PROD_PORT>/api/health; echo'
ssh afldb 'journalctl -u afldb --since "5 minutes ago" --no-pager | tail -40'
ssh afldb 'cat ~/projects/afldb/.next/standalone/.next/BUILD_ID; cd ~/projects/afldb && git rev-parse HEAD'
curl -s -o /dev/null -w "%{http_code}\n" https://<PUBLIC_APP_HOST>/api/health
curl -s -I https://<PUBLIC_APP_HOST>/ | grep -iE "strict-transport-security|content-security-policy|x-robots-tag"
```

**Expect:** `active (running)`; `{"status":"ok","database":"ok","latencyMs":N}`
on loopback and `200` through `https://<PUBLIC_APP_HOST>/api/health`; no
repeated worker crashes; `HEAD` = `<TARGET_SHA>`; HSTS and the production CSP
present on the public host, with `X-Robots-Tag: noindex, nofollow` still set by
Caddy on the beta host.

**Check status as a separate command, after the start.** Combining a restart
and a `MainPID` check in one invocation races systemd and has previously looked
like a failed restart when it was not.

**STOP if:** health reports `"database":"unreachable"`, the unit enters a
restart loop (`Restart=always` with `StartLimitBurst=5` stops it visibly), or
the public host is missing HSTS or the production CSP. Read the journal first;
a `permission denied for table …` line points back at Phase 6.

### 11.2 Public smoke checks

Read-only, over the public surface. No admin mutation is performed. Each
hostname is tested according to its **actual** purpose.

```bash
ssh afldb 'for p in / /players /clubs /awards /search /api/health; do printf "%s " "$p"; curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" http://127.0.0.1:<PROD_PORT>$p; done'
for p in / /players /clubs /awards /search /api/health; do printf "%s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "https://<PUBLIC_APP_HOST>$p"; done

curl -s -o /dev/null -w "apex / %{http_code}\n"          "https://<APEX_HOST>/"
curl -s -o /dev/null -w "apex robots.txt %{http_code}\n" "https://<APEX_HOST>/robots.txt"
curl -s -o /dev/null -w "www redirect %{http_code}\n"    "https://www.<APEX_HOST>/"

ssh afldb 'journalctl -u afldb --since "20 minutes ago" --no-pager | grep -Ei "error|ECONNREFUSED|permission denied|does not exist" | tail -30'
```

Targeted checks for what this rollout introduced:

- an **award** page rendering ordered representative teams — exercises
  `award_winners.sort_order` (migration 061);
- a **player** page with career totals — exercises the migration-065 `frees_*`
  columns via `player-derived.ts`;
- an **honours / team-of-the-century** page — exercises `honour_team_members`
  under the migration-059 partial indexes.

**Expect:** `200` on every application path; `200` on the apex root and
`robots.txt`; `301`/`308` on `www`; no `permission denied for table …` and no
`column … does not exist` in the journal.

**Do not expect** `/api/health` to answer on the apex — it is a static file
server and only `/api/early-access*` proxies to the app.

**STOP if:** any application page 500s, or the journal shows a privilege or
missing-column error.

### 11.3 Restart the stopped writers

Only once 11.1 and 11.2 are clean:

```bash
ssh afldb 'sudo systemctl start afldb-email-intake.timer; systemctl is-active afldb-email-intake.timer'
# plus any other unit stopped in Phase 1
ssh afldb 'systemctl list-timers "afldb*" --all --no-pager'
```

**Write isolation is now fully ended.** From here, `<G1_DUMP>` is the
**pre-rollout** state only; restoring it would discard any production activity
recorded since 11.1 and must never be described as a lossless rollback for that
activity.

---

## Phase 12 — ledger, changelog and closure

### 12.1 `issues.md` — `AFLDB-ISSUE-084`

Close **only** if every acceptance criterion in §14 is met, Profile B included.
Otherwise leave the issue open with the blocker recorded.

Record, either way:

- the production migration high-water mark and every migration's `applied_at`
  (the **schema** boundary);
- `<TARGET_SHA>`, `<ACTIVATION_TS>` and `<LOADER_HASHES>` (the **code**
  boundary);
- the Phase 6 table **and sequence** privilege matrices;
- `<G1_DUMP>`'s filename and SHA-256, the off-host copy location, the
  restore-rehearsal evidence and its stated limitation;
- `<BASELINE_IDENTITIES>` and the Phase 10 Query-14 survival result;
- the Phase 8 Profile-B outcome, artifact filenames and SHA-256s, the
  regenerated counts and fingerprints, and the **standing gate** wording for
  the first future awards/honours reload;
- the Phase 9 `--rekey` outcome — rekeyed / verification no-op / not
  applicable — with the preflight figures and the honest note that an
  already-stable database carries no evidence of a historical once-only
  transition;
- the Phase 10 audit's **executable** filename and its Phase-10.2
  execution-authoritative sha256 (with the template's sha256 noted separately
  as provenance, if retained), and the full count set;
- the residual rollback risk: no production-side restore rehearsal is possible
  on the droplet.

Preserve the existing Symptom/Scope/Evidence prose; do not rewrite history.

### 12.2 `AFLDB-ISSUE-080` follow-up

Append the Profile-B evidence and the standing pre-reload gate to the ISSUE-080
entry, so a future reload session finds it without reading this runbook.

### 12.3 `IssuesIndex.md`

If ISSUE-084 closed, remove it from the at-a-glance table **and** from the Open
Issues table in `issues.md`; the two must agree. If it did not close, update its
Current state and Next action to name the exact blocker.

### 12.4 `CHANGELOG.md` — `Unreleased`

Write only what actually happened. The entry covers: production schema advanced
057 → 070, role privileges reconciled (tables and sequences), and the
ISSUE-044/078/080 keyed link-preserving loaders deployed, ending the
prospective destructive-reload exposure across all seven `LINK_TARGET_TABLES`
families.

Conditional clauses:

- mention the one-time first-kick-goal `--rekey` **only if it actually ran and
  wrote** — not for a verification no-op and not when it was inapplicable;
- mention Profile-B reload safety **only on a PASS**. On any other outcome,
  state instead that no awards/honours reload is authorised pending the
  Profile-B outcome;
- mention the clean post-migration player-link audit **only if Phase 10 met
  every requirement in §10.4**, including the identity-level survival proof.

No entry for investigation-only steps, raw command output, or status notes.

### 12.5 New issues, if any

Create a tracked issue only for something meeting the `CLAUDE.md` criteria — a
genuine data-integrity finding from Phase 8 or 10, or a reproducible deployment
defect. Do **not** open issues for routine steps.

Deliberately **not** created here, being existing open issues: ISSUE-081,
ISSUE-082, ISSUE-083, ISSUE-085, ISSUE-086.

---

## 13. Rollback and failure handling

### 13.1 By phase

Verbs are those of §2.6 — **HALT**, **BLOCK**, **RETRY** — and nothing else.

| Phase | Reversible? | Failure verb and recovery | `<G1_DUMP>` lossless? |
|---|---|---|---|
| 0 preliminary preflight | n/a | **HALT.** Nothing mutated | n/a (not yet taken) |
| 1 write isolation | Yes | **HALT.** `systemctl start afldb` + re-enable timers | n/a |
| 2 authoritative re-check | Read-only | **HALT** and investigate | n/a |
| 3 backup / rehearsal | n/a | **RETRY** `backup.sh` (it never overwrites a verified dump); a failed §3.3a proof is a **HALT** — the recovery method is unproven | — |
| 4 activate `<TARGET_SHA>` | Yes | **HALT**; `git checkout a32a0a1…` | **Yes** |
| **5 migrations** | **No** | **HALT.** Fix the data and **RETRY** `db:migrate` (resumable), **or** §3.4 | **Yes** |
| 6 privileges | Yes (idempotent) | **HALT**, then **RETRY** the reconciler from the activated checkout | **Yes** |
| 7 build | Yes | **HALT**, then **RETRY**. If unfixable, §3.4 in full | **Yes** |
| 8 Profile-B audit | Read-only | **HALT** on a schema-gate refusal or an audit that cannot be completed/trusted — do **not** enter Phase 9. **BLOCK** on a classification/keyset/exposure finding once the schema gate passed: closure and future reloads blocked, rollout continues (§8.3, §8.4) | **Yes** |
| **9 `--rekey`** | **No** (retry-safe, not reversible) | **HALT.** A **RETRY** is state-safe after an interrupted run. To undo, §3.4. Never `--allow-link-loss` | **Yes** |
| 10 ISSUE-079 audit | Read-only | **HALT.** This is actual data damage or untrustworthy evidence, and it does put §3.4 on the table | **Yes** |
| 11.1 `start afldb` | — | **HALT**; `systemctl stop afldb` | **NO — the lossless window closes here** |
| 11.2 smoke checks | Read-only | **HALT** on a 500 or a privilege/missing-column error; diagnose before closure | No |
| 11.3 timer restart | Yes | **HALT**; stop the timer again | No |

### 13.2 Last known-safe checkpoints

| Before | Checkpoint |
|---|---|
| Migrations | **Gate G1** — writers stopped, quiescence proved, authoritative dump taken, off-host copy hash-verified, restore rehearsed on the dev host |
| Code activation | **Gate G1**; Phase 4 is also reversible by `git checkout` |
| Build | **Gate G2** — schema at 070, privilege gate passed |
| Profile-B gate | **Gate G2**; `<G1_DUMP>` still lossless |
| `--rekey` | **Gate G3** — PASS, or a recorded **BLOCK**. Never a Phase-8 **HALT**; `<G1_DUMP>` still lossless |
| Integrity audit | End of Phase 9; `<G1_DUMP>` still lossless |
| **Reopening writes** | **Gate G4** — the post-070 audit passed. This is the last point at which `<G1_DUMP>` can be restored without discarding real production activity |

### 13.3 Not safely reversible, stated plainly

Migrations 058–070 (forward-only, no down-migrations; 059 and 069 drop and
replace constraints) and the `--rekey` `source_record_id` rewrite. For both,
the only true rollback is the §3.4 restore of `<G1_DUMP>` — and that restore is
**not** a plain `pg_restore --clean`: it requires the clean-target step, because
`--clean` cannot drop objects the 057 archive does not contain. The method is
documented in `docs/backup-restore.md` §6, extended per §3.4 with
`restore-test.sh`'s own clearing statement, and rehearsed end-to-end on the dev
host at Gate G1 requirement 5 — but **not** rehearsed on the droplet itself.

### 13.4 The one safety contract

> **Until Phase 11.1 starts `afldb`, `<G1_DUMP>` is the lossless pre-rollout
> recovery point: every irreversible step and every integrity proof happens
> while it still is. Once `systemctl start afldb` runs, production writes are
> reopened and `<G1_DUMP>` must never again be described as a lossless rollback
> for anything that happened afterwards.**

Everything else follows from that sentence, expressed only in the §2.6 verbs:

- **"Rollback"** before 11.1 means §3.4 in full — including its clean-target
  step — and costs nothing but the rollout. After 11.1 it also costs every
  production write since, and is a decision for the user, not a step in this
  runbook.
- **HALT** means: do not proceed to the next phase, and do not close ISSUE-084.
  It reaches for §3.4 **only** when the evidence is actual production data
  damage (Phase 10) or the deployed state is unproven or self-inconsistent
  (Phases 5–7, a Phase-8 schema-gate refusal, 11.1). Otherwise the answer is
  forward repair.
- **BLOCK** means: closure and any future awards/honours reload are blocked, the
  deployment is proven healthy and stays, and the rollout continues. It is
  available **only** to a Phase-8 classification, keyset or exposure finding
  taken after the Profile-B schema gate itself passed. A schema-gate refusal is
  a HALT, never a BLOCK.
- **RETRY** applies only where a step is stated to be idempotent or resumable,
  and only after a named cause is corrected. A step that still cannot complete
  or be trusted becomes a HALT, never a BLOCK.
- **Unexpected data-integrity evidence is always a HALT**, at any point, and is
  never traded against completing the deployment.

---

## 14. Acceptance criteria — what closing ISSUE-084 requires

1. `npm run db:status` on production reports **0 pending**, with
   `070_import_reads_link_suggestions.sql` applied, and every migration's
   `applied_at` recorded.
2. **Table privileges:** `afldb_import` holds exactly `SELECT, INSERT` on
   `player_link_resolutions`, `SELECT` on `player_link_suggestions`, `INSERT`
   on `data_edits` — and no `UPDATE`, `DELETE` or `TRUNCATE` on any of them.
3. **Sequence privileges:** `afldb_import` holds `USAGE` and **only** `USAGE`
   on `data_edits_id_seq` and `player_link_resolutions_id_seq`, and **no**
   privilege on `player_link_suggestions_id_seq`.
4. Production `git rev-parse HEAD` = `<TARGET_SHA>`; `<ACTIVATION_TS>` and the
   six `<LOADER_HASHES>` are recorded; the hashes match the workstation at that
   revision.
5. Production is demonstrably **no longer running the destructive loaders**:
   the deployed `import_awards.py` is the ISSUE-080 version (hash-verified),
   `import_draft.py` no longer truncates, and the first-kick-goal loader
   reconciles on `(source_id, source_record_id)`.
6. **The Phase 8 Profile-B gate returned PASS**, with its full evidence set —
   artifact SHA-256, both counts, both fingerprints, Plane-A inventory —
   written into `issues.md`, and the standing pre-reload gate recorded on both
   ISSUE-080 and ISSUE-084. **Any other outcome blocks closure**: a **BLOCK**
   leaves the deployment in place with the reload prohibited (§8.4); a **HALT**
   means the rollout did not reach this point at all (§8.3, §2.6).
7. The one-time `--rekey` ran once with the expected preflight figures, **or**
   is recorded as a verification no-op, **or** as not applicable — in each case
   with the Phase 9.1 evidence that decided which, confirmed by 9.4.
8. The regenerated post-070 ISSUE-079 audit — **the Phase-10.2 executable file,
   verified at both ends against its own execution-authoritative sha256, not
   the Phase-0 template** — ran to `ROLLBACK` with exit 0, every schema
   assertion `t`, and **zero** dangling resolutions, **zero** dangling
   suggestions and **zero** unknown-vocabulary rows. The Phase-10.2 diff
   against the template showed only the two placeholder populations.
9. **Query 14 proved survival by identity:** every `<BASELINE_IDENTITIES>`
   resolution and suggestion is still present, still carries the same
   `(target_table, target_id)`, and still resolves to a live target. Totals are
   **unchanged** from Phase 2, not merely non-decreasing.
10. **Both audits ran before any production write was reopened:** the **Phase-8
    Profile-B audit** and the **Phase-10 post-070 integrity audit** each
    completed while `afldb` was still stopped, with the service starting only
    at Phase 11.1.
11. The build was produced with `AFLDB_ENV=production` passed explicitly, and
    `prepare-standalone` reported **`AFLDB_ENV=production detected (HSTS and
    production CSP enabled)`**.
12. `systemctl status afldb` is `active (running)`,
    `http://127.0.0.1:<PROD_PORT>/api/health` returns `"database":"ok"`,
    `https://<PUBLIC_APP_HOST>/api/health` returns 200 with HSTS and the
    production CSP, and the journal is free of privilege and missing-column
    errors.
13. Phase 11.2 smoke checks pass — application paths on `<PUBLIC_APP_HOST>`,
    the static apex root and `robots.txt`, the `www` redirect, and one page
    each exercising migrations 061, 065 and 059.
14. Every writer stopped in Phase 1 has been restarted and verified active.
15. `<G1_DUMP>`'s filename and SHA-256 are recorded, an off-host copy exists
    with a matching hash, and the dev-host rehearsal met **all five** Gate-G1
    requirements — including **requirement 5 (§3.3a)**: the 057 dump was
    restored over a **070-shaped** `afldb_restore_test` and queries A–E proved
    no migration-058–070 object survived, with the ledger reading 57 /
    `057_data_edits.sql`.
16. `issues.md`, `IssuesIndex.md` and `CHANGELOG.md` are updated, mutually
    consistent, and the changelog claims only outcomes that actually occurred
    (§12.4).

**Evidence required to close:** both preflight artifacts (the quiescent one
carrying `<BASELINE_IDENTITIES>`), the Phase 5 migration log, the Phase 6 table
and sequence matrices, the Phase 4 hash cross-check and activation timestamp,
the Phase 3 dump hash + off-host hash + rehearsal output, the Phase 8 Plane-A
and Plane-B artifacts with hashes, the Phase 9 `--rekey` output and
confirmation query, the Phase 10 audit artifact with its Phase-10.2
execution-authoritative sha256 and counts, and the Phase 11 status codes.

---

## 15. Verification summary

| What is proved | How |
|---|---|
| Preconditions held when it mattered | Identical reviewed preflight script run live **and** under quiescence; the two artifacts diffed |
| Rollback point is real **and stays lossless** | `<G1_DUMP>` taken after writers stopped and zero sessions proved; off-host hash match; every irreversible step and every integrity proof completed before `start afldb` |
| The recovery **method** works, not just the dump | Gate G1 requirement 5 (§3.3a): the 057 dump restored over a deliberately **070-shaped** `afldb_restore_test`, then queries A–E proved every migration-058–070 table, column, index and constraint absent, `honour_team_uq` restored, `player_link_resolutions` back to 9 columns, and the ledger at 57 / `057_data_edits.sql` — because `pg_restore --clean` alone cannot drop what the archive does not contain (§3.4) |
| Schema correct | `db:status` = 0 pending at 070; Phase 10 schema gate all-`t` |
| Grants correct | Phase 6 table matrix **and** sequence matrix |
| Code correct | six-file sha256 cross-check, prod vs workstation at `<TARGET_SHA>`; `git merge-base --is-ancestor` + `git pull --ff-only` |
| Loader provenance recorded | `<TARGET_SHA>` + `<ACTIVATION_TS>` + `<LOADER_HASHES>` written to `issues.md` — `import_batches` has no code-version field, so this is the provenance. Query 13e **corroborates** that no batch activity followed activation during this rollout; migration `applied_at` is kept separately as the schema boundary only |
| The executed audit is the reviewed one | The Phase-0 artefact is a template; Phase 10.2 populates its two placeholders, diffs against the template, re-reviews in full, and creates the execution-authoritative sha256 the §3 transport verifies at both ends |
| No link damage | Phase 10: 0 dangling, 0 unknown, and identity-level survival of every Phase-2 baseline row |
| Future reload safety established | Phase 8 Profile-B **PASS** with recorded artifact hash, counts and fingerprints. Its schema gate is evaluated first and separately: a refusal is a **HALT** on the deployment, never a **BLOCK** on the reload gate (§2.6, §8.3) |
| Identity transition handled | Phase 9.1 classification, the once-only run, and the 9.4 read-only confirmation |
| Build is production-mode | `prepare-standalone: AFLDB_ENV=production detected`, plus HSTS/CSP observed on `<PUBLIC_APP_HOST>` |
| App healthy on the right hostname | Loopback `/api/health`, `https://beta.afldb.com/api/health`, and the static apex checked as a static site |
| Writers correctly reopened | Phase 11.3 timer restart verified active |

---

## 16. Handoff

Execution happens in a **fresh session**. Suggested opening prompt:

```text
Execute AFLDB-ISSUE-084 according to AFLDB-ISSUE-084.md.

Treat the approved runbook as authoritative.
Follow CLAUDE.md.
Do not redesign, broaden or weaken the runbook.
Use native repository tools for inspection/editing.
I will execute all shell, tests, build, SQL, SSH/service, deployment and Git commands.
If current evidence materially contradicts the approved runbook, stop and report it.
```

Do not paste this planning conversation. Carry `AFLDB-ISSUE-084.md`, the
`AFLDB-ISSUE-084` entry in `issues.md`, and the current relevant code.

**Author the artefacts in Phase 0, before the outage** — the preflight script,
the Profile-B Plane A SQL, the post-070 audit **template**, and the Plane-B
generator with its dev-host run. All have complete written contracts in this
file and an existing byte-level source file, so each is transcription plus
review rather than design. Doing this work up front keeps the outage to
execution only.

**Two artefact lifecycles, and they are not the same:**

| Artefact | Phase 0 | Execution hash |
|---|---|---|
| Preflight script | complete and final | its Phase-0 sha256 |
| Profile-B Plane A SQL | complete and final | its Phase-0 sha256 |
| Post-070 ISSUE-079 audit | **template only** — `<BASELINE_IDENTITIES>` (Phase 2) and `<ACTIVATION_TS>` (Phase 4) are unpopulated | created at **Phase 10.2**, after populating both placeholders, diffing against the template and re-reviewing the executable file in full. The template's hash is provenance only and is never executed |

Plan for that: Phase 10.2 is a real review step inside the outage, not a
formality.
