# AFLDB-ISSUE-079 — read-only production integrity audit (approved runbook, rev. 8)

> **Status: APPROVED. Both environments reconciled against their live schemas.
> Neither integrity audit has been executed.** The rev. 4 design was blocked by
> relevant source drift (Phase 0a). That block is discharged: a read-only metadata
> probe on 2026-08-23 established that the **live production database** is at
> migration 057 (Phase 0b), and the production audit SQL has been regenerated
> against that schema, reviewed in full and hashed (§2e). A second read-only probe
> the same day established that the **live development database** is at migration
> 070 (Phase 0d), and the dev source drift has been classified (Phase 0c). Only the
> production identity probe and the two schema probes have been run — all
> read-only, all ended with `ROLLBACK`. Neither integrity audit has been executed.
>
> **The development audit SQL is deliberately NOT generated in the planning
> session.** Generating, reviewing and hashing it is the **first bounded execution
> preparation step** of the fresh execution session (§2g, Phase 3 step 2).
>
> **At execution time, re-capture the Phase 0 local provenance** (`git rev-parse
> HEAD`, `git status --short`) rather than reusing the values recorded below —
> the working tree may have moved on. Likewise substitute the actual run date for
> `20260823` in every artifact filename.

## Context

Before `AFLDB-ISSUE-044`, destructive honours reloads regenerated surrogate row
ids. A manual decision recorded in `player_link_resolutions.target_id` therefore
points at an id that no longer exists once its source row is recreated. The
loaders never reset their identity sequences, so ids are not reused — the
pointer **dangles** rather than silently naming a different row.

`AFLDB-ISSUE-078` repaired the draft and first-kick-goal reload paths going
forward. That says nothing about resolutions created *before* those repairs. A
read-only audit of `afldb_dev` on 2026-08-22 found 75 resolutions and 0 dangling,
but dev and production have different reload histories and different admin
activity, so production is still unaudited.

Diagnosis only. No production writes. Outcome is either "production clean →
close ISSUE-079" or "production affected → open a separate remediation issue",
plus a preserved raw evidence artifact.

> **Revision note.** Rev. 1 was rejected for eight defects: a fail-open `sed`
> redaction, a gate that could not propagate failure, a missing mandatory SQL
> review stage, a broken hash chain, an unfounded draft reconstruction claim, an
> over-strong host probe, no local-vs-production SHA comparison, and a
> presumption of corruption in a cache table. Two factual errors found while
> fixing them are corrected in Phase 1.
>
> **Rev. 3** fixed four more: the hash chain printed both hashes but never
> compared them (§2f, Phase 3); `set -e` would have killed both shells before the
> exit-status lines ran, so failures went unrecorded (Phase 3); the `DO` gate
> introduced procedural server-side code outside the authorised surface and is
> replaced by a `\gset`/`\if` gate whose failure path is a deliberately failing
> read-only `SELECT` (§2b); and dangling draft-pick resolutions are no longer
> pre-classified (§2d). The SHA-drift stop condition is explicit (Phase 0).
>
> **Rev. 4** fixes three final ones: live schema/catalogue verification was
> running *after* the queries whose assumptions it validates, and is now a second
> fail-closed gate ahead of all application data (§2c); every gate failure path
> now `ROLLBACK`s explicitly before forcing the non-zero exit, and success ends
> with `ROLLBACK` plus a client-side `\echo` rather than another server-side
> `SELECT` (§2b); and Outcome A's mandatory evidence conditions are extended to
> seven, including the schema gate and explicit classification of any
> unknown-vocabulary or schema-integrity finding (Phase 5).
>
> **Rev. 5** is not a design change. It records the result of the 2026-08-23
> production identity probe: `AFLDB_BASE_URL` is demoted from a mandatory
> identity gate condition to recorded deployment context, with
> `https://beta.afldb.com` as the current expected beta-production value
> (Phase 1b, Phase 3 step 1); and the local-vs-production source drift is
> assessed and found **relevant**, which blocks execution until the audit SQL is
> reconciled (new **Phase 0a**). No audit step was run, no database was connected
> to, and nothing in production was changed.
>
> **Rev. 6** reconciles the runbook with the schema actually deployed. The
> production database is confirmed at migration 057 by its own ledger, not
> inferred from a checkout (Phase 0b). The production audit SQL is regenerated
> against that schema and references no post-057 object or column; rev. 4's
> `player_link_match_candidates` query is removed rather than adapted, because
> the table does not exist in production. The live schema gate grows from nine
> assertions to seventeen so that **every** table, column, type, constraint and
> foreign key the body references is checked before any application data is read,
> and two of them pin the file to migration 057 so it refuses to run against a
> schema it was not written for (§2c). Constraints are matched structurally
> rather than by name, because production carries PostgreSQL's generated names. A
> supplementary deployment/exposure query is added and explicitly excluded from
> the closure criterion (§2d). The dev variant is specified as *comparable, not
> identical* (§2g). Closure semantics are corrected: ISSUE-079 closes as a
> point-in-time historical audit, and the undeployed prospective protection —
> which is **ISSUE-044's as well as ISSUE-078's**, covering all seven target
> tables — must be stated separately (Phase 5).
>
> **Rev. 7** fixes two defects found while completing the development side, and
> closes an ownership gap. The supplementary exposure query could not attribute a
> loader run to a target table: `import_awards.py` records the **group key** in
> `import_batches.target_table`, not a table name, so a
> `target_table IN (the seven)` reading would have reported zero exposure for
> `award_winners`, `award_nominations` and `honour_team_members` however many
> reloads had run. Query 13 now carries a source-derived mapping and is
> zero-filled across all seven (§2d). Assertion S15's label claimed it verified
> the `056` ledger row while the SQL checked only the columns; the row-presence
> conjunct is added, because query 13's boundary depends on it (§2c). The dev
> probe is generated and reviewed (§2g), and Phase 5 records that **no open work
> item owns the ISSUE-044/078 deployment**.
>
> **Rev. 8** completes the development side and corrects three things rev. 7 got
> wrong or left open. The dev schema probe ran and returned migration 070
> (Phase 0d). Assessing dev source drift then produced a finding rev. 7 did not
> anticipate: the dev checkout SHA is **absent from the local object database
> entirely**, so — unlike production's `a32a0a1`, which is present and was
> classifiable — dev drift cannot be assessed locally at all. Phase 0c scopes that
> failure precisely: it blocks **Query 13c and nothing else**, because every
> assumption the primary integrity core uses is established from dev's own live
> catalogue rather than from source. Dev's Query 13 therefore ships as
> **13a/13b/13d, mapping-free** (§2d). Rev. 7's §2g plan to carry the three 067
> columns inline on dev's query 3 is **withdrawn** — they move to a separate Q3x so
> the primary query 3 stays byte-comparable with production (§2g). The dev schema
> gate is specified at **22 assertions** (§2c). Phase 5's deployment-issue
> recommendation is **decoupled from ISSUE-079's closure**: it is raised once the
> audit *completes*, whatever the outcome. And dev SQL generation is moved out of
> planning into execution preparation (§2g, Phase 3 step 2).
>
> **Rev. 8 then took three execution-consistency corrections at approval.** First,
> Phase 3 step 1 was **not self-contained**: it invoked `/tmp/afldb-dsn-parse.py`
> while this same runbook records that the Phase 0b probe deleted that file on exit,
> and left "send it first or fold it in" to prose. The command now carries both
> reviewed files in one payload over `/usr/bin/ssh`, verifies both hashes locally and
> remotely, and only then opens the env file. Second, dev's condition 3 said the
> fenced dev-only block was required *and* that it could not block any condition;
> that contradiction is resolved by separating **technical run completeness** (every
> query must execute under `ON_ERROR_STOP`) from **evidential weight** (only Q1–Q11
> determine the integrity verdict) — Phase 5. Third, "no audit SQL is generated in a
> planning session" contradicted this runbook's own record of generating the
> production file in rev. 6/7, and is reworded to scope the ban to *further* SQL in
> *this final* planning session.

---

## Phase 0 — provenance

### Local (captured 2026-08-23 — re-capture at execution time)

| | |
|---|---|
| Commit | `80d57bd6d39d80f19bd86e902cc0831b3985de15` (branch `dev`) |
| Working tree | **dirty**, documentation only |
| Modified | `CLAUDE.md`, `IssuesIndex.md`, `issues.md` |
| Untracked | `CLAUDE.old.md` |

None of the dirty paths touch `src/db/queries/player-links.ts`,
`LINK_TARGET_TABLES`, `src/db/migrations/`, or audit SQL semantics.

### Production checkout — recorded and compared, not assumed

The identity probe also captures the droplet's `git rev-parse HEAD` and
`git status --short`. The artifact records **both** SHAs side by side.

The local checkout is where the audit SQL is authored; it is **not** evidence of
what is deployed. If the two SHAs differ, the drift is assessed before execution:

- **Relevant drift → STOP.** If any commit between the two SHAs touches
  `LINK_TARGET_TABLES`, player-link target semantics, `src/db/migrations/`, or
  any schema assumption the audit SQL is generated from, **do not execute against
  production**. Reconcile the drift first — regenerate the audit SQL from the
  state actually deployed — and record what was reconciled.
- **Unrelated drift → record and accept**, naming the differing commits, and
  proceed.

**Uncommitted changes in the production checkout are treated exactly like commit
drift.** A matching SHA does not mean matching source. If `git status --short` on
the droplet shows modifications, staged changes or untracked files affecting
`LINK_TARGET_TABLES`, `src/db/queries/player-links.ts`, relevant migrations,
player-link target semantics, or any schema assumption the audit SQL is generated
from, **STOP before production execution** and reconcile that state first —
exactly as for relevant commit drift. Unrelated working-tree changes are recorded
and accepted. Both the production SHA and its working-tree state go in the
artifact.

Either way the local SHA is never described as the production deployment source.
The authority on the schema actually deployed is neither SHA but the **live
schema gate (§2c)**, which reads the production catalogue and refuses to query
application data if the deployed schema contradicts the audit's assumptions.

## Phase 0a — production drift assessment (performed 2026-08-23, read-only)

**Outcome: relevant drift → STOP.** The Phase 0 stop condition was met. The audit
SQL had to be reconciled against the state actually deployed before any execution
against production.

> **Discharged by rev. 6.** The reconciliation is complete. Phase 0b records the
> live migration state read from production's own ledger; §2c and §2d record the
> regenerated gate and body; §2e records the full review and hash. This section
> is retained as the evidence trail for *why* regeneration was required.

### Observed provenance

| | |
|---|---|
| Production checkout | `a32a0a1abacbf49a979343094b28c7983ebbea33` — `fix(player-links): revalidate public pages when a link is applied`, 2026-08-19 |
| Production working tree | **clean** |
| Local checkout | `80d57bd6d39d80f19bd86e902cc0831b3985de15` (branch `dev`) |
| `AFLDB_ENV` | `production` |
| `AFLDB_BASE_URL` | `https://beta.afldb.com` (expected during beta — context, not a gate) |
| Owner DSN identity | `role=afldb_owner host=localhost port=5432 dbname=afldb_prod` — matches Phase 1b exactly |

Relationship between the two SHAs, from read-only local Git inspection:

```
git merge-base a32a0a1 80d57bd                       ->  a32a0a1
git rev-list --left-right --count a32a0a1...80d57bd  ->  0   84
```

Production is a strict **ancestor** of local. It carries nothing local lacks;
local is **84 commits ahead**. The drift is therefore entirely "production is
behind", which is the direction that matters here — the runbook's SQL is
generated from schema and code production has not yet received.

### The drift touches the audited surface

`git diff --name-status a32a0a1..80d57bd -- src/db/queries/player-links.ts src/db/migrations/`
returns:

- `M src/db/queries/player-links.ts`
- `A` migrations **058 – 070** (thirteen files, none present in the production
  checkout, whose last migration is `057_data_edits.sql`)

Assessed against the four Phase 0 relevance criteria:

| Criterion | Verdict | Evidence |
|---|---|---|
| `LINK_TARGET_TABLES` | **not affected** | Identical at both SHAs — the same seven values in the same order (`git show a32a0a1:src/db/queries/player-links.ts` lines 24-32, vs `src/db/queries/player-links.ts:37-45`). Phase 1's vocabulary claim survives the drift. |
| `src/db/queries/player-links.ts` | **affected** | Modified in the range. §2d's draft-context reasoning cites `player-links.ts:562-565` for the `player_link_match_candidates` mapping shape; that code does not exist at the production SHA. |
| Relevant migrations | **affected** | `067_player_link_match_candidates.sql`, `068_import_reads_link_resolutions.sql`, `069_draft_source_identity.sql` and `070_import_reads_link_suggestions.sql` are all absent from the production checkout. |
| Player-link target semantics / schema assumptions | **affected** | See below. |

### Specific schema assumptions the deployed source does not support

1. **`player_link_match_candidates` does not exist at the production SHA.**
   `067` creates the whole table (`067:31`) with `plmc_target_table_ck`
   (`067:67-70`) and `plmc_entity_type_ck` (`067:63`). Phase 1's two rev.-1
   corrections are both written from `067`, §2c's catalogue evidence block reads
   `pg_constraint` for this table, and **audit query 12 selects from it**.

2. **`player_link_resolutions` lacks three columns the audit selects.**
   `067:106-109` is `ALTER TABLE player_link_resolutions ADD COLUMN match_method
   text, match_score smallint, algorithm_version text`, with `plr_match_method_ck`
   and `plr_match_score_ck` at `067:111-114`. **Audit query 3 selects
   `match_method`, `match_score` and `algorithm_version`** in its dangling-detail
   row.

3. **`draft_picks` reload identity changed after the production SHA.**
   `069_draft_source_identity.sql` adds the partial unique index
   `draft_picks_source_uq (source_id, player_url, draft_year, draft_kind)`
   (`069:56-57`) as the DraftGuru reload key, and alters `draft_persons`
   (`069:75-76`). `draft_picks` is a `LINK_TARGET_TABLES` member and §2d reasons
   explicitly about draft-pick reload semantics, so this is player-link target
   semantics, not incidental schema churn.

4. **The grant reasoning in Phase 1b describes a state production is not in.**
   Phase 1b says "`afldb_import` gained SELECT only in 068". `068:33` and
   `070:39` grant `afldb_import` SELECT on `player_link_resolutions` and
   `player_link_suggestions` respectively; neither is deployed. This does not
   change the choice of `afldb_owner`, but the stated privilege facts must be
   re-derived rather than restated.

5. **The ISSUE-078 repair is itself inside the drift range.** Commit `7766f8e`
   `fix(import): preserve manual player links across honours reloads` is one of
   the 84 undeployed commits. The Context section says ISSUE-078 "repaired the
   draft and first-kick-goal reload paths going forward"; on production it has
   **not** been deployed, so the forward-looking protection the audit's framing
   assumes is not in force there. That does not change what the audit measures —
   historical dangling targets — but it must be stated in the artifact rather
   than left implied.

### Why the §2c gate does not make this safe to attempt

§2c was restructured in rev. 4 precisely so that schema drift is *prevented from
corrupting the audit rather than recorded after it*. It does not cover this
drift. All nine of its named assertions are satisfiable by the `056`/`057` schema
the production checkout carries: the seven target relations, both
`target_table`/`target_id` CHECK constraints and all three foreign keys are
defined in `056` (`056:28-76`). **The gate would pass**, and the run would then
fail at query 3 on the missing `match_method` column — with `ON_ERROR_STOP=1`
producing exit 3 **after production application data had already been read**.
That is the exact failure mode rev. 4 set out to eliminate, so attempting the run
to "let the gate decide" is not a safe substitute for reconciliation.

### One caveat on what this evidence does and does not establish

A checkout SHA is not the same fact as applied migration state; the live schema
remains the authority, as Phase 0 already says. What is established is narrower
and sufficient: `npm run db:migrate` applies the migration files present in the
checkout and records them in `afldb_meta.schema_migrations`
(`tools/db/migrate.ts:124-135`), so a clean checkout at `a32a0a1` **cannot have
applied 058–070 from that checkout**. The runbook's SQL is generated from schema
the deployed source does not contain.

### Exact next action before any production execution

1. Establish the migration state actually applied in `afldb_prod` — read-only,
   `SELECT name, applied_at FROM afldb_meta.schema_migrations ORDER BY name`,
   under the same identity gate, read-only settings and single-snapshot
   discipline as the audit itself. That is a ledger/catalogue read, not
   application data, and stays within the authorised read-only surface.
2. Regenerate the audit SQL against that state — either by removing the
   `067`-dependent surface (query 3's three columns, query 12, §2c's
   `player_link_match_candidates` catalogue block) for a pre-`067` production, or
   by deploying the outstanding migrations first and auditing the current schema.
   Which of the two is chosen is a deployment decision outside ISSUE-079.
3. Extend §2c so the gate asserts the presence or absence of the `067` artefacts
   the body depends on, rather than passing on `056`-era schema and failing
   mid-body.
4. Re-run §2e's mandatory full read of the regenerated file, then §2f's hash
   chain, before any transfer.
5. Record in the artifact what was reconciled, and re-state both SHAs and
   working-tree states.

**Status of those steps.** 1 — done (Phase 0b: production is at migration 057,
read from `afldb_meta.schema_migrations`). 2 — done, by the first route: the
067-dependent surface is removed rather than deployed, and that choice is
recorded rather than assumed (§2d). 3 — done, and exceeded: the gate now asserts
all seventeen prerequisites and pins the file to migration 057 (§2c). 4 — done
for the production file (§2e); the dev file follows its own probe (§2g). 5 — this
section plus Phase 0b.

Item 5 of the list above also proved **incomplete**: `AFLDB-ISSUE-044`'s repair is
undeployed in production as well as `AFLDB-ISSUE-078`'s, so all seven target
tables are still served by destructive loaders there. That correction is carried
in Phase 5, where it affects closure wording.

---

## Phase 0b — production schema evidence (probe executed 2026-08-23, read-only)

The Phase 0a stop condition was discharged by a read-only metadata probe, not by
assumption. `scratchpad/issue-079-schema-probe.sh` (sha256
`d683f4a4500f274f2ee3257bb21967b61d4da95aac39e0867f33de72c038add2`, reviewed in
full, transferred and hash-verified on the droplet) ran one
`REPEATABLE READ READ ONLY` snapshot of catalogue metadata and the migration
ledger, and ended with `ROLLBACK`. Artifact:
`artifacts/audits/issue-079-schema-probe-prod-20260823.txt`.

`psql exit status: 0`, `ssh/remote exit status: 0`,
`AFLDB-ISSUE-079 SCHEMA PROBE COMPLETE — TRANSACTION ROLLED BACK`. No
application data was read and nothing in production was changed.

### The deployed database, not the deployed checkout

| | |
|---|---|
| Server | PostgreSQL 16.15 (Ubuntu 24.04) |
| Database / role in session | `afldb_prod` / `afldb_owner` |
| `search_path` | `"$user", public` — every audited relation resolves to `public` |
| Read-only settings | `default_transaction_read_only = on`, `transaction_read_only = on`, isolation `repeatable read` |
| Migrations applied | **57**, `001_foundations.sql` … `057_data_edits.sql` |
| Last applied | `057_data_edits.sql`, **2026-08-19 17:42:14.85384+10** |
| `056_player_link_review.sql` applied | **2026-08-19 17:42:14.800707+10** |

This settles the question Phase 0a could not: the **live database itself** is at
migration 057. The checkout being at `a32a0a1` is corroboration, not the proof.
Migrations 058–070 are not applied.

### Confirmed live schema

- **`player_link_match_candidates` is ABSENT** (`present = f`, `relkind` null).
  That is undeployed schema — migration 067 has not run — and is **not** an
  integrity defect. Nothing in ISSUE-079 depends on it.
- **`player_link_resolutions` has exactly nine columns**: `id bigint`,
  `target_table text`, `target_id bigint`, `action text`, `player_id integer`,
  `previous_status link_status`, `admin_user_id integer`, `note text`,
  `created_at timestamptz`. **No `match_method`, `match_score` or
  `algorithm_version`** — those are migration 067 additions.
- **`player_link_suggestions` has exactly nine columns**: `id bigint`,
  `target_table text`, `target_id bigint`, `suggested_name text`, `note text`,
  `status text`, `resolved_by integer`, `resolved_at timestamptz`,
  `created_at timestamptz`.
- All seven `LINK_TARGET_TABLES` relations exist as ordinary tables, each with
  `id integer NOT NULL`, identity `ALWAYS`. `players.id` and `auth_users.id` are
  likewise `integer NOT NULL` (`players` is `GENERATED BY DEFAULT`, which the
  audit does not depend on). The `bigint = integer` comparison is safe: it widens
  rather than truncates, so an out-of-range `target_id` reads as dangling, which
  is the correct answer.
- **Every constraint is present and `convalidated`.** Both `target_table` CHECKs
  list exactly the seven current values; both `target_id > 0` CHECKs exist; the
  three foreign keys are `player_link_resolutions.player_id → players(id)`,
  `player_link_resolutions.admin_user_id → auth_users(id)` and
  `player_link_suggestions.resolved_by → auth_users(id)`. Production names them
  with PostgreSQL's generated names (`player_link_resolutions_target_table_check`
  and so on), so the gate matches them **structurally** — by `conkey`,
  `confrelid`, `confkey`, `contype` and `convalidated` — never by name.
- `link_status` is an enum: `unique, resolved, ambiguous, unmatched,
  implausible`. `import_status` is an enum: `running, completed, failed,
  rolled_back`.
- `import_batches` exists with `tool text`, `target_table text`,
  `status import_status`, `started_at timestamptz`.
- `afldb_meta.schema_migrations` exists with `name text`, `applied_at
  timestamptz`.

### What this bounds

`player_link_resolutions` did not exist in production before **2026-08-19
17:42:14.80+10**. Every row in it, and therefore every dangling row the audit
could find, was created after that instant. The audit's search window is that
narrow, and the supplementary query 13 records it in the artifact.

---

## Phase 0c — development source drift (assessed 2026-08-23, read-only)

**Outcome: unclassifiable drift → SCOPED STOP.** It blocks **Query 13c and nothing
else**. This is deliberately narrower than Phase 0a's blanket stop, and the reason
is set out below rather than assumed.

### The finding

| | |
|---|---|
| Local authoring checkout | `80d57bd6d39d80f19bd86e902cc0831b3985de15` (branch `dev`) |
| Development host checkout | `9b628612cac7ac185be347314b270795a5ce1543` |
| Relationship | **cannot be computed** — the dev commit object is absent locally |

Read-only local Git inspection:

```
git cat-file -e 9b628612cac7…    ->  exit 1   ABSENT from the local object database
git cat-file -e a32a0a1abacb…    ->  exit 0   present  (production WAS classifiable)
git cat-file -e 80d57bd6d39d…    ->  exit 0   present  (local HEAD)
git branch -a --contains 9b62861 ->  error: no such commit
git rev-parse HEAD               ->  80d57bd6d39d…
refs/remotes/origin/dev          ->  80d57bd6d39d…    identical to local HEAD
```

This is **asymmetric with Phase 0a**. Production's `a32a0a1` is in the local object
database, which is exactly how Phase 0a ran `merge-base` and `rev-list` and proved
strict ancestry. The dev SHA cannot even be resolved, so no ancestry, no diff and no
relevance assessment is possible without either a network fetch (ref-mutating,
unauthorised) or a dev-host read (a separate authorised action, not taken).

Dev is running a commit that exists on neither the local branch nor any
remote-tracking ref this clone knows. Unpushed commits made on the dev host, or a
push to `origin/dev` after this clone's last fetch, are both plausible; **neither is
established**, and the runbook claims neither.

Per Phase 0's own rule, unassessable drift **fails closed**. The question is only
*what* it closes.

### What the missing checkout does NOT block

Every assumption the **primary integrity core** relies on is established from dev's
**own live catalogue**, not from any checkout:

| Assumption | Established by |
|---|---|
| all thirteen relations present, `relkind = 'r'`, resolving to `public` | probe P1 |
| `id` of all nine join targets is `integer NOT NULL` | probe P2 |
| column shapes: `player_link_resolutions` 12, `player_link_suggestions` 9, `player_link_match_candidates` 18, plus `auth_users` and `import_batches` | probe P3 |
| **the seven-value target vocabulary** — validated CHECKs on all three player-link tables | probe P4 |
| `target_id > 0`, action, note and 067 match-metadata CHECKs; all FKs; every one `convalidated` | probe P4 |
| `link_status` and `import_status` enums | probe P5 |
| migration ledger, the `056` row, the `070` ceiling | probe P6 / P7 |

The vocabulary point carries the most weight: dev's seven target values come from
dev's **own validated constraints**, so the dev audit never needs
`LINK_TARGET_TABLES` read out of a checkout. A matching migration ledger does not by
itself prove matching source semantics — that caution stands — but here **no primary
metric depends on source semantics at all**.

### What it does block — Query 13c, and only Query 13c

13c maps `import_batches.target_table` — a loader **group key**, not a table name —
onto the link-target tables that loader destroys. That mapping is a source fact, and
it has demonstrably drifted between the two checkouts this repository *can* see:

- Local `GROUPS` (`tools/migration/import_awards.py:1102-1110`) has **eight** keys,
  including `under_22 -> ["awards", "award_winners"]`. Production's `a32a0a1`
  mapping has six and lacks it.
- At local HEAD **every `truncate(` call in `import_awards.py` is gone**, replaced by
  `reload_keyed` (lines 369, 433, 538, 926, 982, 1031, 1084). That is ISSUE-044's
  repair.

So on dev the *same* `(tool, batch_target)` pair means **"destroys link identity"**
before the ISSUE-044/078 repairs landed and **"preserves it"** afterwards. A single
`destructive_runs` count would be semantically wrong on dev, and the transition
instant cannot be dated without the checkout. **13c is therefore omitted from the dev
file rather than guessed** (§2d).

Query 13 is supplementary and is excluded from the closure criterion, so **no closure
condition is weakened by this omission.**

### Dev working-tree state — verified unrelated, not assumed

Observed dirty paths: ` M tests/nl-ui/nl-stress.spec.ts`, `.deploy-backups/`,
`.env.bak-20260815-091704`, `.env.bak-20260818-134133`, `FETCH_HEAD`, and five
`afldb-ui-questions-*.csv` NL-search corpora. None is
`src/db/queries/player-links.ts`, a migration, a loader, or any file the audit's
assumptions derive from. Recorded as unrelated and accepted.

### What would discharge this stop, if it is ever needed

One read-only capture on the dev host — `git rev-parse HEAD`, `git log -1`, the
`GROUPS` block, the `import_batch(...)` line in `import_draft.py`, and the
`import_batches` INSERT in `import-first-kick-goal.ts` — would derive dev's true
mapping and settle the drift classification. It is **not required** for the approved
design, and is recorded here only so a future session does not have to re-derive it.

---

## Phase 0d — development schema evidence (probe executed 2026-08-23, read-only)

`scratchpad/issue-079-schema-probe-dev.sh` (sha256
`31f9a11730b04d42674f0287514bbfbcd964de2c2364c60e93bea6de89fda426`, reviewed by diff
against the already-executed production probe per §2g) ran one
`REPEATABLE READ READ ONLY` snapshot of catalogue metadata and the migration ledger
and ended with `ROLLBACK`. Artifact:
`artifacts/audits/issue-079-schema-probe-dev-20260823.txt`.

Local, expected and remote hashes were identical and the artifact records
`sha256 match confirmed`. `AFLDB-ISSUE-079 PROBE IDENTITY GATE PASSED`,
`psql exit status: 0`, `ssh/remote exit status: 0`,
`AFLDB-ISSUE-079 SCHEMA PROBE COMPLETE — TRANSACTION ROLLED BACK`. No application
data was read and **nothing in development was changed**.

### The deployed development database

| | |
|---|---|
| Host | `streamanator`, `AFLDB_ENV=development`, `AFLDB_BASE_URL=http://10.0.40.100:8090` |
| Server | PostgreSQL 16.15 (Ubuntu 24.04) |
| Database / role in session | `afldb_dev` / `afldb_owner` |
| Owner DSN identity | `role=afldb_owner host=localhost port=5432 dbname=afldb_dev` |
| `search_path` | `"$user", public` — every audited relation resolves to `public` |
| Read-only settings | `default_transaction_read_only = on`, `transaction_read_only = on`, isolation `repeatable read` |
| Snapshot | `2026-08-23 02:17:43.584709+10` |
| Migrations applied | **70**, `001_foundations.sql` … `070_import_reads_link_suggestions.sql` |
| Last applied | `070_import_reads_link_suggestions.sql`, 2026-08-23 00:13:48.32+10 |
| `056_player_link_review.sql` applied | **2026-08-19 09:35:11.538973+10** |
| `067_player_link_match_candidates.sql` applied | 2026-08-22 17:48:13.52+10 |

### Confirmed live development schema

- All thirteen relations exist as ordinary tables in `public`, **including
  `player_link_match_candidates`**.
- All seven `LINK_TARGET_TABLES` have `id integer NOT NULL`, identity `ALWAYS`;
  `auth_users.id` likewise; `players.id` is `integer NOT NULL GENERATED BY DEFAULT`.
  `target_id bigint` **widens** the comparison rather than truncating, so an
  out-of-range value reads as dangling — the correct answer.
- **`player_link_resolutions` has the post-067 twelve-column shape**: the nine 056
  columns plus `match_method text`, `match_score smallint`,
  `algorithm_version text`.
- `player_link_suggestions` has the same nine columns as production.
- **`player_link_match_candidates` has the migration-067 eighteen-column shape.**
- **Every constraint is `convalidated`.** `target_table` CHECKs on all three
  player-link tables name exactly the seven; `plmc_entity_type_ck` names **eight**
  (the seven plus `draft_person`); `target_id > 0` on all three; FKs
  `player_link_resolutions.player_id -> players(id)`, `.admin_user_id ->
  auth_users(id)`, `player_link_suggestions.resolved_by -> auth_users(id)`,
  `player_link_match_candidates.player_id -> players(id)`; plus the 067 metadata
  CHECKs `plr_match_method_ck` and `plr_match_score_ck`, and
  `plmc_entity_rank_uq UNIQUE (resolution_entity_type, resolution_entity_id, rank)`.
  Development carries PostgreSQL's generated names for the 056-era constraints
  exactly as production does, so the dev gate matches **structurally**, never by
  name.
- `link_status`, `import_status` and `player_achievement_type` enums as expected.

### What this bounds, and the resulting comparison

`player_link_resolutions` did not exist in development before **2026-08-19
09:35:11.54+10**, so that is dev's full search window and dev's Query 13 boundary.

The audit therefore compares:

```
PRODUCTION   afldb_prod   migration 057   pre-067 resolutions    no match-candidates table
DEVELOPMENT  afldb_dev    migration 070   post-067 resolutions   match-candidates present
```

The two audits must be **semantically comparable, not physically identical** (§2g).

`player_link_match_candidates` remains a **regenerable cache**. Stale or dangling
cache rows are **not** corruption, are **not** a finding, and can never affect
ISSUE-079's historical closure criterion.

---

## Phase 1 — target vocabulary and schema

### What is deployed in production (migration 057)

`src/db/queries/player-links.ts:37-45` — `LINK_TARGET_TABLES` is unchanged from
what ISSUE-079 recorded, **and is identical at the production SHA**
(`a32a0a1`), so there is no ledger drift and none of the drift affects the
vocabulary:

```
award_winners, award_nominations, hall_of_fame, honour_team_members,
captaincies, player_achievements, draft_picks
```

From `src/db/migrations/056_player_link_review.sql`, every clause below now
confirmed live by the Phase 0b probe rather than inferred from the file:

- `target_table text NOT NULL CHECK (target_table IN (...seven...))` on both
  `player_link_resolutions` and `player_link_suggestions`, both `convalidated`.
  Unknown vocabulary should be structurally impossible — checked anyway, and the
  §2c gate requires both constraints before the audit body runs.
- `target_id bigint NOT NULL CHECK (target_id > 0)`, **no FK** — deliberate,
  since it points into seven tables (`056:20-23`, `056:48-49`). This is the
  dangling surface.
- All seven target tables use `id integer PRIMARY KEY GENERATED ALWAYS AS
  IDENTITY` (`005`, `006:11-12`, `053:37-38`), confirmed live.
- Real FKs: `player_link_resolutions.player_id → players(id)`, `admin_user_id →
  auth_users(id)` (NOT NULL), `player_link_suggestions.resolved_by →
  auth_users(id)`. A dangling one would mean **constraint failure**, not an
  application-level gap; the report must say which.

### What is NOT deployed in production, and is therefore out of the audit

Migration `067_player_link_match_candidates.sql` has not run in production. Two
things follow, and rev. 4's Phase 1 stated both as if they were production
facts — they are not:

1. **`player_link_match_candidates` does not exist in production.** Rev. 4's two
   "corrections to rev. 1" — that the table constrains `target_table`
   (`067:67-70`), and that `067:6-16` documents it as a regenerable cache whose
   stale rows are rejected at approval time — remain correct **about the code**,
   and remain relevant to the **development** audit. They say nothing about
   production, where the table is absent. Rev. 4's supplementary query 12 is
   therefore removed from the production file (§2d).
2. **`player_link_resolutions` has no approval-provenance columns in
   production.** `067:106-114` adds `match_method`, `match_score` and
   `algorithm_version`; production has none of them, so the production
   dangling-detail query selects only the nine columns that exist.

Neither absence is a finding. It is undeployed schema, and the runbook says so
wherever the distinction could be misread.

## Phase 1b — production identity

Authoritative source: **`tools/maintenance/00_install_postgres_prod.sh`**, the
script that created the droplet's database — `DB_NAME="afldb_prod"` (line 52),
`createdb -O afldb_owner "${DB_NAME}"` (line 142), writing
`AFLDB_OWNER_DATABASE_URL=…@localhost:5432/afldb_prod` (line 229). Corroborated
by `docs/production-cutover.md:127-142` and `deploy/afldb.service`.

| | |
|---|---|
| Expected production database | `afldb_prod` |
| Expected production role | `afldb_owner` |
| Host | ssh alias `afldb`, user `arm` |
| Project dir | `/home/arm/projects/afldb`, env file `.env` (mode 600) |
| `AFLDB_BASE_URL` (context only) | `https://beta.afldb.com` during beta |

**`AFLDB_BASE_URL` is deployment context, not an identity gate.** Rev. 4
expected `https://afldb.com` and treated it as a mandatory production identity
condition. That expectation was stale on both counts. The confirmed deployment
state is that `https://beta.afldb.com` is the intentional production base URL
during beta, and `https://afldb.com` becomes the production base URL only at
public go-live. It is also the wrong kind of fact to gate on: the base URL is an
application presentation setting that can be changed at any time without
touching the database, so it can neither prove nor disprove which cluster the
audit is connected to. It is captured, recorded in the artifact alongside
`AFLDB_ENV`, and used to corroborate that the host is the production
deployment — nothing more.

Traps accounted for: one unit file serves both hosts and names no database; role
names are identical on dev and prod, so only `current_database()` separates them;
and `docs/production-cutover.md:151,178-181` shows `afldb_prod_*` role names in a
section explicitly **superseded** at line 127.

**Identity rests on three things only:** the independently established
host/config above, plus in-session `current_database() = 'afldb_prod'`,
`current_user = 'afldb_owner'`, and both read-only settings `on`.

`SELECT datname FROM pg_database` is captured as **corroborating evidence only**.
The absence of `afldb_dev` is suggestive — `00_install_postgres_prod.sh:73` uses
it as a wrong-host probe — but no deployment policy makes "production never has a
database named `afldb_dev`" an invariant, so it is **not** a gate condition and
its absence alone never establishes production.

**Why the owner role:** `afldb_app` cannot read `player_link_resolutions` at all
— `056:95-106` grants it to `afldb_auth` only — and `afldb_auth` cannot read the
honours tables. No application role can join both sides. Read-only safety comes
from four layers instead (Phase 2), not from a weak credential.

Rev. 4 added that "`afldb_import` gained SELECT only in 068". True of the code,
**not true of production**: migration 068 is not applied there (Phase 0b), so
`afldb_import` holds no SELECT on either player-link table in production at all.
That strengthens rather than weakens the argument for the owner role, but the
stated privilege fact is corrected rather than repeated.

---

## Phase 2 — the audit script

### 2a. Fail-closed DSN parser

Rev. 1 used `sed -E "s|…|…|"`, which **prints its input unchanged when the
pattern does not match** — a malformed or unexpected `.env` line would have
echoed the complete production DSN into the artifact. Replaced with
dependency-free Python 3 (already present on the droplet; the email-intake unit
runs `/usr/bin/python3`), transferred as `/tmp/afldb-dsn-parse.py`:

```python
#!/usr/bin/env python3
"""Fail-closed DSN reader for the AFLDB-ISSUE-079 read-only audit.

Prints ONLY non-secret identity fields, or ONLY the decoded password.
Never prints the raw URL. Exits non-zero, printing nothing to stdout,
on any malformation."""
import sys
from urllib.parse import urlsplit, unquote

def fail(msg):
    print("FATAL: " + msg, file=sys.stderr)
    raise SystemExit(3)

if len(sys.argv) != 4 or sys.argv[1] not in ("--identity", "--password"):
    fail("usage: --identity|--password <env-file> <var-name>")
mode, path, var = sys.argv[1], sys.argv[2], sys.argv[3]

raw = None
try:
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line.startswith(var + "="):
                raw = line[len(var) + 1:]
                break
except OSError:
    fail("cannot read env file")
if raw is None:
    fail(var + " is not present in the env file")

try:
    u = urlsplit(raw)
    port = u.port or 5432          # raises ValueError on a malformed port
except ValueError:
    fail("env var is not a parseable URL")
if u.scheme not in ("postgresql", "postgres"):
    fail("unexpected URL scheme")
if not (u.hostname and u.username and u.password):
    fail("URL is missing username, password or host")
db = (u.path or "").lstrip("/")
if not db:
    fail("URL names no database")

if mode == "--identity":
    print("role=%s host=%s port=%s dbname=%s"
          % (unquote(u.username), u.hostname, port, unquote(db)))
else:
    sys.stdout.write(unquote(u.password))
```

Properties: a real URL parser rather than a regex; percent-decodes username and
password via `unquote`; **stdout stays empty on every failure path**; exit 3 on
any malformation; the raw URL and password are never printed in either mode; the
file path is passed as an argument so the DSN never reaches `argv` or a
traceback. `--password` is consumed only by `PGPASSWORD=$(…)` command
substitution, so it never reaches the terminal, the artifact or `ps`.

### 2b. Gate that fails loudly and non-zero, within the authorised surface

Rev. 1's `\gset` / `\if` / `\quit` gate exits psql with status **0**, making a
refused audit indistinguishable from a clean one. Rev. 2 fixed that with a `DO`
block, but introduced procedural server-side code outside the prompt's
authorised `SELECT` / `SHOW` / read-only-control surface. Both are avoidable: the
psql gate is kept, and its failure path runs an intentionally failing **read-only
`SELECT`**, so `ON_ERROR_STOP=1` produces a non-zero exit with no procedural code
anywhere.

```sql
\pset pager off
\pset null '(null)'

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT current_database(), current_user, version(), now();
SHOW default_transaction_read_only;
SHOW transaction_read_only;
SHOW transaction_isolation;
SELECT datname FROM pg_database ORDER BY 1;   -- corroboration only

SELECT CASE WHEN current_database() = 'afldb_prod'      -- 'afldb_dev' in the dev file
             AND current_user       = 'afldb_owner'
             AND current_setting('transaction_read_only')         = 'on'
             AND current_setting('default_transaction_read_only') = 'on'
            THEN 'true' ELSE 'false' END AS gate_ok \gset

\if :gate_ok
\echo 'AFLDB-ISSUE-079 IDENTITY GATE PASSED'
\else
\echo '*** AFLDB-ISSUE-079 IDENTITY / READ-ONLY GATE FAILED — no application data queried ***'
ROLLBACK;
SELECT CAST('AFLDB-ISSUE-079 IDENTITY GATE FAILED' AS integer);
\endif

-- ... LIVE SCHEMA GATE (§2c) ...
-- ... audit body (§2d) ...

ROLLBACK;
\echo 'AFLDB-ISSUE-079 AUDIT COMPLETE — TRANSACTION ROLLED BACK'
```

Every failure branch **explicitly `ROLLBACK`s first**, then runs a plain `SELECT`
with an impossible cast. The transaction is therefore ended deliberately rather
than left to an implicit discard at disconnect, and the subsequent error —
`ERROR: invalid input syntax for type integer: "AFLDB-ISSUE-079 IDENTITY GATE
FAILED"`, the gate message carried by the error itself — makes psql exit **3**
under `ON_ERROR_STOP=1`. `default_transaction_read_only` is still `on` outside the
transaction, so that statement is read-only too.

Successful completion likewise ends with `ROLLBACK;` followed by a client-side
`\echo`, **not** a further server-side `SELECT` after the audited snapshot has
closed. The terminator is therefore psql output, and the last statement the
server sees is the `ROLLBACK`.

Everything executed is `SELECT`, `SHOW`, `BEGIN … READ ONLY`, `ROLLBACK` or a
psql meta-command. Expected identity is a literal in each generated file. Rev. 4
added that the two files therefore "differ only in that one string"; since dev
and production are no longer at the same migration that is no longer true, and
§2g sets out exactly how they differ and what stays comparable. The identity
`SELECT`/`SHOW` output is emitted **before** the gate, so the artifact records
what was observed even when the gate refuses.

Read-only is enforced four ways: `PGOPTIONS=-c default_transaction_read_only=on`
at connection establishment, the explicit `BEGIN … READ ONLY`, the gate refusing
unless both report `on`, and `psql -X` skipping `~/.psqlrc`.

No temp tables or views — `READ ONLY` forbids DDL — so the `targets`/`live` CTE
pair repeats verbatim in each query. That verbosity is itself the evidence.

### 2c. Live schema gate — before any application data, covering every dependency

Rev. 3 left schema verification as query 12, *after* the eleven queries whose
assumptions it validates. Rev. 4 promoted it to a fail-closed gate but its nine
assertions were all satisfiable by `056`/`057` schema, so on the real production
database it would have **passed** and the run would then have died at the
dangling-detail query on the missing `match_method` column — after production
application data had already been read. That is the precise failure rev. 4 set
out to eliminate.

Rev. 6 closes it by construction: **every table, column, type, constraint and
foreign key the audit body references is asserted here, and nothing the body
references is left ungated.** The gate and the body were generated together from
the Phase 0b evidence.

First the catalogue evidence is printed for the artifact (§1a–1d of the generated
file): the presence, `relkind` and resolved schema of all thirteen relations
including the deliberately absent `player_link_match_candidates`; the `id` column
and type of all nine join targets; every column of both player-link tables; and
`pg_constraint` definitions with `contype` and `convalidated` for both.

Then the same facts are reduced to seventeen named assertions, printed as a
pass/fail table and aggregated into one boolean. The `checks` CTE is written out
twice because a `READ ONLY` transaction forbids the temp table or view that would
let it be reused.

| # | Assertion | Body dependency it protects |
|---|---|---|
| S01 | all seven `LINK_TARGET_TABLES` exist as ordinary tables | every existence probe |
| S02 | every target `id` exists, is integer-family, NOT NULL | the `bigint = integer` comparison |
| S03 | `players.id`, `auth_users.id` exist, integer-family, NOT NULL | queries 9, 10 |
| S04 | `auth_users.email` exists and is `text` | queries 3, 6 |
| S05 | `player_link_resolutions` has **exactly** the nine 056 columns, with expected types | queries 1, 2, 3, 7, 8, 9, 10, 11 |
| S06 | `player_link_suggestions` has **exactly** the nine 056 columns, with expected types | queries 4, 5, 6, 8, 10 |
| S07 | `plr.target_table` has one validated CHECK naming exactly the seven | vocabulary classification |
| S08 | `pls.target_table` has one validated CHECK naming exactly the seven | vocabulary classification |
| S09 | both `target_id > 0` CHECKs exist and are validated | query 8 |
| S10 | `plr.player_id` FK → `players(id)`, validated | query 9's constraint-failure reading |
| S11 | `plr.admin_user_id` FK → `auth_users(id)`, NOT NULL, validated | query 10 |
| S12 | `pls.resolved_by` FK → `auth_users(id)`, validated | query 10 |
| S13 | `link_status` enum exists | `previous_status` in query 3 |
| S14 | `import_batches` has `tool`, `target_table`, `status`, `started_at` | query 13 |
| S15 | `afldb_meta.schema_migrations` readable, has `name`/`applied_at`, **and the `056` row exists** | query 13's boundary |
| S16 | **SCHEMA PIN** — highest applied migration is `057_data_edits.sql` | the whole file |
| S17 | **SCHEMA PIN** — post-057 player-link schema absent | the whole file |

**Constraints are matched structurally, never by name.** Production carries
PostgreSQL's generated constraint names, so S07–S12 key off `contype`,
`convalidated`, `conkey`, `confrelid` and `confkey`. S07/S08 additionally require
the definition to name all seven values *and* to contain exactly seven quoted
literals, so a constraint that listed an eighth would fail rather than pass on a
substring match.

**S15 was corrected in rev. 7.** Its label claimed it verified the `056` ledger
row; the SQL checked only that the columns existed. Query 13's boundary is that
row, so the label was writing a cheque the check did not cash — a gate assertion
that overstates what it proves is worse than no assertion. The row-presence
conjunct is now part of the check.

**S16 and S17 are the reconciliation guarantee.** This file is generated for
migration 057. If production is migrated to 058–070 before it runs, S16 and S17
fail, the gate refuses, and the failure message says `REGENERATE this file`. The
audit can no longer silently produce a partial result against a schema it was not
written for — which is exactly how rev. 4 would have failed.

```sql
\if :schema_ok
\echo 'AFLDB-ISSUE-079 LIVE SCHEMA GATE PASSED'
\else
\echo '*** AFLDB-ISSUE-079 LIVE SCHEMA GATE FAILED - no application data queried ***'
\echo '*** If S16/S17 failed, production has moved past migration 057: REGENERATE this file ***'
ROLLBACK;
SELECT CAST('AFLDB-ISSUE-079 LIVE SCHEMA GATE FAILED' AS integer);
\endif
```

`coalesce(bool_and(ok), false)` keeps it fail-closed: a check whose subquery
returns NULL fails the gate rather than passing it. Printing the per-check table
before the aggregate means a refusal names *which* assumption the deployed schema
broke, which is what a reconciliation would need.

#### The development gate — same architecture, 22 assertions, opposite pins

Dev gets its **own** probe-driven gate, generated from Phase 0d and **not** from the
local checkout — and specifically **not by assuming dev is at 070**; the probe is what
established that. The coverage rule is identical and absolute: **every table, column,
type, constraint and foreign key the dev body references is asserted first, and
nothing asserted is left unused.**

S01–S04 and S06–S15 are **carried over unchanged** from the production file.
Changed and new:

| # | Assertion | Body dependency it protects |
|---|---|---|
| S05dev | `player_link_resolutions` has **exactly twelve** columns — the nine 056 plus `match_method text`, `match_score smallint`, `algorithm_version text` | queries 1, 2, 3, 3x, 7, 8, 9, 10, 11 |
| S16dev | **SCHEMA PIN** — highest applied migration is `070_import_reads_link_suggestions.sql` | the whole file |
| S17dev | **SCHEMA PIN** — post-067 player-link schema **PRESENT**: `player_link_match_candidates` is an ordinary table **and** all three 067 columns exist on `player_link_resolutions` | the whole file |
| S18dev | `player_link_match_candidates` has **exactly the eighteen** 067 columns with expected types | queries 12a, 12b, 12c |
| S19dev | `plmc.target_table` has one validated CHECK naming exactly the **seven** | query 12a's zero-fill, query 12b |
| S20dev | `plmc.resolution_entity_type` has one validated CHECK naming exactly the **eight** (the seven plus `draft_person`) | query 12c's probed / not-probed split |
| S21dev | `plmc.player_id` FK → `players(id)` validated, **and** the `plmc` `target_id > 0` CHECK validated | query 12b |
| S22dev | the 067 match-metadata CHECKs on `match_method` and `match_score` are present and validated | query 3x's interpretation |

**S16dev and S17dev are the mirror image of production's pins.** Production asserts
the 067 artefacts **absent**; development asserts them **present**. If dev is migrated
past 070 before the run, S16dev fails, the gate refuses ahead of any application data,
and the message says `REGENERATE this file` — the dev file can no more silently
produce a partial result against an unexpected schema than the production one can.

**One deliberate consequence of the coverage rule.** The dev probe never inventoried
`draft_persons`, so nothing in the dev gate establishes it, so **no dev body query may
probe it**. That is why query 12c splits `draft_person` out as a count with
`entity_target_probed = false` rather than resolving it (§2d). The alternative —
adding a gate assertion for a relation the probe never returned — would break the rule
that the gate is generated from probe evidence.

### 2d. Audit body — one snapshot, ending in `ROLLBACK`

Target existence is tested per row with a primary-key lookup against the named
table, inside a `CASE r.target_table WHEN … THEN EXISTS (…)` covering all seven.
All seven are spelled out; the verbosity is the evidence. `ELSE NULL` means "this
vocabulary is not recognised", which is Category B and never Category A.

| # | Query | Notes |
|---|---|---|
| 1 | Resolution summary | `targets` VALUES list LEFT JOINed to the per-row result, so **all seven rows appear including explicit zeros**; resolutions, live targets, dangling, earliest, latest |
| 2 | Unknown resolution `target_table` | `NOT IN (seven)`; full rows if any |
| 3 | Dangling resolution detail | id, target_table, target_id, action, player_id, previous_status, created_at, admin_user_id, admin email, note — **the nine production columns only**; ordered `target_table, target_id, id` |
| 4 | Suggestion summary | same zero-filled shape, plus open-suggestion count |
| 5 | Unknown suggestion `target_table` | separate finding class |
| 6 | Dangling suggestion detail | id, target, suggested_name, note, status, created_at, resolved_at, resolved_by, resolver email |
| 7a–7c | Totals | totals for both tables; count by `action`; count by `target_table` with an explicit `known_vocabulary` flag |
| 8 | Target-id sanity | NULL / `<= 0` on both tables (both CHECK-prevented — verified anyway) |
| 9 | Player references | rows naming a player, dangling count, rows listed if any — **FK-enforced, so non-zero is constraint failure** |
| 10 | Admin references | `admin_user_id` and `resolved_by` vs `auth_users` — likewise FK-enforced |
| 11 | Repeated events | targets with >1 resolution, max per target, full distribution — **not** classified as corruption |
| 13 | Supplementary deployment/exposure context | See below. **Not** part of the closure criterion |

Categories A (dangling current-vocabulary target) and B (unknown `target_table`)
are reported as **separate** counts throughout and never merged.

**Rev. 4's query 12 is removed, not adapted.** It audited
`player_link_match_candidates`, which the Phase 0b probe confirms does not exist
in production. Its absence is undeployed schema and is recorded as such — in the
§1a catalogue evidence and in assertion S17 — never as a finding. Nothing about
ISSUE-079's closure criterion turns on it. The query survives only in the
**development** variant (§2g), where the table does exist.

**Query 13 is supplementary deployment/exposure context, and nothing in it can
close or block ISSUE-079.** It has four parts: **13a** the `applied_at` of
`056_player_link_review.sql`, the instant the production player-link audit trail
began to exist; **13b** the earliest and latest resolution timestamps; **13c**
destructive loader runs attributed to each of the seven `LINK_TARGET_TABLES`,
zero-filled; **13d** an unmapped backstop listing every import run since the
boundary, flagged by whether 13c's mapping recognised it.

**13c needs an explicit mapping, and this is not a detail.**
`import_batches.target_table` is **not always a table name**.
`tools/migration/import_awards.py:886` writes the **group key**:

```python
with import_batch(pg, "sports_data_lab", "import_awards.py", key) as batch:
```

and `GROUPS` (`import_awards.py:769-776` at the production checkout `a32a0a1`)
maps those keys to the tables each group truncates:

| batch `target_table` (group key) | `LINK_TARGET_TABLES` destroyed |
|---|---|
| `awards` | `award_winners` (with `awards`) |
| `all_australian` | `award_winners` |
| `rising_star` | `award_nominations` |
| `hall_of_fame` | `hall_of_fame` |
| `honour_teams` | `honour_team_members` |
| `captaincies` | `captaincies` |
| `draft_picks` (tool `import_draft.py:237`) | `draft_picks` |
| `player_achievements` (tool `tools/records/import-first-kick-goal.ts:471-472`) | `player_achievements` |

Only **two** group keys coincide with a `LINK_TARGET_TABLES` name. A naive
`target_table IN (the seven)` filter would therefore have reported **zero
exposure for `award_winners`, `award_nominations` and `honour_team_members`**
no matter how many reloads had run — a silent under-report on three of the seven
tables. The mapping is read out of the deployed source, not guessed, and 13d
exists so that any tool or target value the mapping does *not* recognise is still
visible rather than dropped.

Its stated limits are part of the query, and are unchanged in force:

- `import_batches` records what a loader *reported*, not what it did;
- **`status` is not a safety signal** — the Python loaders commit the batch row
  before doing the work, so a `failed` or `rolled_back` batch may still have
  truncated its targets;
- a manual SQL truncate, a restore, or any out-of-band load writes no row at all;
- the mapping is pinned to production checkout `a32a0a1`; if the checkout moves,
  re-derive it from `GROUPS` before trusting 13c;
- a row's presence does not prove any resolution was affected, and **its absence
  does not prove that no destructive operation occurred**.

It is context for reading the result and for sizing the forward exposure in
Phase 5. It is never cited as proof of causation.

**Rev. 1's draft-context query stays removed.** It claimed to classify whether a
dangling draft decision was reconstructable. It cannot, and the reasoning was
wrong: a dangling resolution names a `draft_picks.id` that no longer exists, so
the missing row cannot supply its own `draft_person_id`. Searching for a durable
non-name-based mapping from a historical pick id to a surviving draft person
finds none:

- `player_link_resolutions` stores no `draft_person_id`. On production the column
  set is the nine of migration 056, confirmed live by the Phase 0b probe.
- `player_link_suggestions` offers only `suggested_name` — name-based, excluded.
- `player_link_match_candidates` would be shape-wise the mapping wanted
  (`src/db/queries/player-links.ts:562-565`), but it is a regenerable cache with
  no durability guarantee, it postdates 056, **and in production it does not
  exist at all**.

What this establishes is bounded, and the runbook claims no more than it: **there
is no trustworthy *automatic* old-`draft_picks`-id → `draft_person` mapping in
the production player-link schema.** That is a statement about the available
mechanisms, not a verdict on rows that have not been seen.

So **no dangling draft-pick resolution is pre-classified**. If one actually
exists, the authorised read-only feasibility analysis is performed *for that
specific row*, against whatever durable evidence the audit surfaces, and it is
classified `not safely reconstructable` only when no sufficiently durable
evidence establishes reconstruction. Names, similar picks and nearby ids are
never accepted as proof.

#### The production mapping was re-checked while completing the dev side

Finding the eighth local group key (`under_22`) raised the obvious question of whether
production's six-key mapping is now under-reporting too. It is not. Migration
`060_wikipedia_22_under_22_source.sql` is **not applied in production**, so the
`under_22` group's source key does not exist there and the group cannot have run; and
13d's backstop would surface such a batch regardless. **The production file and its
sha256 `2f00ff54…` stand unchanged** — rev. 8 changes nothing on the production side.

#### Development's Query 13 — 13a, 13b and 13d only

Dev's loader group-key mapping **cannot be derived** (Phase 0c), so **13c is omitted
from the dev file** rather than filled with production's mapping or a guess. Omission
is the fail-closed choice here: 13d reports the raw `(tool, target_table, status)`
rows and the classification is made at reporting time, where the uncertainty is
visible, instead of being buried inside a mapping nobody can check.

| | development Query 13 |
|---|---|
| 13a | player-link migration timeline — `applied_at` of `056`, `067` and `070`, dating both the audit-trail boundary and the cache table's arrival |
| 13b | resolution date range |
| **13c** | **omitted**, with a comment stating why |
| 13d | every import run since the `056` boundary, grouped by `(tool, target_table, status)` with counts and earliest/latest — **mapping-free** |

13d carries a flag `target_table_is_literally_a_link_target_name`, documented in the
query comment as a **literal string match only and explicitly NOT a loader→target
mapping**, so it can never be misread as a substitute for 13c.

Every limit stated above for production applies unchanged to dev, plus one specific to
dev: because dev's history straddles the ISSUE-044/078 repairs, **the same
`(tool, target_table)` pair does not mean the same thing at every point in dev's
timeline**, and 13d must never be read as if it did.

#### Development's `player_link_match_candidates` section — descriptive only

Rev. 4's query 12 survives only in the dev file, where the table exists, and is
extended into three clearly-fenced parts. Its framing is fixed by migration `067:6-16`
and does not change: **a regenerable cache whose stale rows are rejected at approval
time.**

| | |
|---|---|
| 12a | row counts zero-filled across the seven target tables, plus the `algorithm_version` distribution and the `computed_at` range |
| 12b | cache rows whose `target_table`/`target_id` no longer resolves |
| 12c | cache rows whose resolution entity no longer resolves, **split**: the seven probed entity types, versus `draft_person` reported as a count with `entity_target_probed = false` (§2c) |

12b and 12c are labelled in the file itself as **stale regenerable cache — NOT
corruption, NOT a finding**. Nothing in this section can satisfy or block any Phase 5
evidence condition.

The dev file also carries **query 3x**: the 067 approval provenance
(`match_method`, `match_score`, `algorithm_version`) for exactly the rows query 3
listed. It is a **separate query**, not extra columns on query 3 — see §2g.

### 2e. Mandatory pre-execution review (blocking) — production file already reviewed

Rev. 4 deferred generation to execution time. Rev. 6 generates the production
file up front so it can be reviewed as part of this approval rather than in the
middle of a production session.

**Completed for the production file on 2026-08-23:**

1. Generated as `artifacts/audits/issue-079-audit-prod-20260823.sql` against the
   Phase 0b evidence.
2. Verified LF-only. `grep -c $'\r'` is **not** a reliable check in this
   environment — inside a command substitution the ANSI-C quote can collapse to
   the empty pattern and match every line. The authoritative check is
   `tr -dc '\r' < FILE | wc -c`, which reports **0**.
3. **Read start to finish.** Confirmed: only `SELECT`, `SHOW`, catalogue reads,
   `BEGIN … READ ONLY`, `ROLLBACK` and the `\pset` / `\gset` / `\if` / `\else` /
   `\endif` / `\echo` meta-commands. No procedural code — no `DO`, no `$$`, no
   function definition, no `CALL`. No `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/
   `MERGE`/`COPY`/DDL/`GRANT`/`REVOKE`. No `\!`, no `\i`/`\ir`. Identity gate
   present and before the first data query; live schema gate present and likewise
   before it; **all three** `ROLLBACK`s in place — one on each gate-failure path
   ahead of its failing `SELECT`, and one final — with **no `COMMIT` anywhere**;
   terminator present.
4. Static greps supplemented step 3 and confirmed it: the only matches for the
   forbidden-keyword set are inside the header comment that names them, and the
   only occurrences of `match_method` / `match_score` / `algorithm_version` /
   `player_link_match_candidates` are in the header comment, the §1a catalogue
   evidence list and assertion S17 — never in a body query.
5. Hash computed.

| | |
|---|---|
| File | `artifacts/audits/issue-079-audit-prod-20260823.sql` |
| Size | 807 lines, 41,950 bytes, LF-only |
| sha256 | `2f00ff5477bc8bf7b9654765e846a42bf6e371f0f1f300b50f52c5e9a7bd0dc8` |

The rev. 6 hash `a5d756ee…` is superseded by the rev. 7 Query 13 and S15
corrections. The full review of step 3 was **redone** against the changed file,
not carried over: the only occurrences of `import_batch`, `truncate`,
`player_link_match_candidates`, `match_method`, `match_score` and
`algorithm_version` are in header comments, the §1a catalogue evidence list, the
Query 13 explanatory comment and assertion S17 — never in a body query.

**At execution time**, before transfer: re-verify the hash still matches the
value above — if it does not, the file has been edited since review and the
review must be redone — then proceed to §2f. An unreviewed or re-edited
generated file is never executed.

The rev. 4 files generated against the undeployed schema are retained as
`artifacts/audits/issue-079-audit-{prod,dev}-20260823.rev4-superseded.sql`. They
must not be run; they are kept only so the reconciliation is auditable.

The dev file is generated, reviewed and hashed the same way — but **not in a planning
session**. The dev schema probe is complete (Phase 0d); generation follows as Phase 3
step 2 of the execution session, and its sha256 is recorded in §2g at that point.

### 2f. Evidence hash chain

Rev. 1 hashed the remote copy after `tr -d '\r'` had rewritten the stream, so the
hashes could not prove byte identity. Corrected: **one** LF-normalised file is
produced, and that same file is reviewed, hashed, transferred untransformed,
hashed again remotely, and executed.

```
final .sql (LF)  →  Read in full  →  sha256sum (local)
                 →  ssh 'cat > /tmp/…'   [no transformation]
                 →  sha256sum (remote)   →  must equal local
                 →  psql -f /tmp/…       [same bytes executed]
```

The expected hashes are passed to the remote side as non-secret arguments and
**compared there**, not merely printed: on mismatch the remote script exits 5
before the env file is opened, before password extraction and before psql is
invoked (Phase 3, **step 1**). All hashes and the literal `sha256 match confirmed`
line are recorded in the artifact. Reviewed bytes, transferred bytes and executed
bytes are therefore provably identical.

**The chain covers the DSN parser as well as the audit SQL.** Both travel in one
payload and both are verified at both ends (Phase 3 step 1), because the parser is
the component that touches the env file — an unverified parser would be the one
place where a substituted byte could leak a secret.

This chain is not theoretical: the Phase 0b probe ran through it end to end and
its artifact opens with three identical hashes and `sha256 match confirmed`.

### 2g. The development variant — comparable, not identical

Dev and production are no longer at the same migration. Forcing one byte-identical
file on both would mean either querying columns production lacks or discarding
diagnostics dev genuinely has, so the two files differ **by design** and the
runbook says exactly how.

**Identical in both files — the comparable core.** Eleven primary metrics are
generated from **identical SQL**, so the primary counts and integrity classifications
are directly comparable between the two runs, which is exactly what the dev re-check
exists to provide:

```
1.  zero-filled seven-target player_link_resolutions summary
2.  current-vocabulary dangling resolution counts
3.  unknown resolution target_table values
4.  full dangling resolution identities/details, common semantic fields only
5.  zero-filled seven-target player_link_suggestions summary
6.  current-vocabulary dangling suggestion counts
7.  unknown suggestion target_table values
8.  target-id sanity
9.  player-reference sanity
10. administrator-reference sanity
11. repeated resolution-event analysis
```

**Every dev-only diagnostic lives after an explicit banner fence, and no extra dev
column appears in a primary result set.**

**Different by design.**

| | production (057) | development (070) |
|---|---|---|
| Identity gate literal | `afldb_prod` | `afldb_dev` |
| Gate assertions | 17 | **22** |
| Schema pin | S16/S17 pin to `057_data_edits.sql` and assert the 067 artefacts **absent** | S16dev/S17dev pin to `070_import_reads_link_suggestions.sql` and assert them **present** |
| Query 3 columns | the nine 056 columns + admin email | **the same nine + admin email** |
| 067 approval provenance | n/a | **separate query 3x** |
| Query 12 | removed — the table does not exist | retained and extended to 12a/12b/12c, descriptive only |
| Query 13 | 13a, 13b, **13c** (`a32a0a1` mapping), 13d | 13a (extended timeline), 13b, **no 13c**, 13d mapping-free |
| Query 13 boundary | `056` applied 2026-08-19 17:42:14.85+10 | `056` applied 2026-08-19 09:35:11.54+10 |

**Rev. 7's plan for query 3 is withdrawn.** It would have carried `match_method`,
`match_score` and `algorithm_version` inline as extra columns. That makes the primary
dangling-detail result no longer byte-comparable with production's, for a diagnostic
that does not need to be there. In rev. 8 they move to **query 3x**, which reports the
067 provenance for exactly the rows query 3 listed. Primary metric 4 is therefore
limited to fields both environments share, and the extra dev columns cannot change the
meaning of the primary comparison.

**The dev probe.** `scratchpad/issue-079-schema-probe-dev.sh`, sha256
`31f9a11730b04d42674f0287514bbfbcd964de2c2364c60e93bea6de89fda426`, executed
2026-08-23 — Phase 0d.

Its review is the strongest kind available — **the diff is the review**. It is
byte-identical to the already-executed production probe except for four lines,
all of them identity literals:

| line | production | development |
|---|---|---|
| 5 | header comment naming `afldb_prod` | naming `afldb_dev` |
| 95 | `current_database() = 'afldb_prod'` | `current_database() = 'afldb_dev'` |
| 223 | expected DSN `dbname=afldb_prod` | `dbname=afldb_dev` |
| 230 | `PGDATABASE=afldb_prod` | `PGDATABASE=afldb_dev` |

Nothing else changes: the same fail-closed DSN parser, the same identity gate,
the same `PGOPTIONS`/`-X`/`ON_ERROR_STOP=1`, the same `REPEATABLE READ READ ONLY`
transaction, the same catalogue-only P1–P7 sections, the same explicit
`ROLLBACK`. The probe already inventories `player_link_match_candidates` columns
(P3) and its constraints (P4), so it is a **superset** of what the dev audit
needs — no second probe is required for the 067 artefacts.

Dev's gate is generated from what that probe returns — not from the local
checkout, and **not by assuming dev is at 070**. Dev's schema is asserted the
same way production's was, so a dev-only diagnostic can never run against a
column the dev gate has not verified.

The dev host is `arm@10.0.40.100` (`deploy/sync-dev.ps1:25-26`), project dir
`/home/arm/projects/afldb`, same as production's layout.

#### Generation is deferred out of planning, deliberately

**The development audit SQL is NOT generated in the approval session.** Generating,
reviewing and hashing it is the **first bounded execution preparation step** of the
fresh execution session — Phase 3 step 2 — performed before any host is connected to.

| | |
|---|---|
| Dev SQL path | `artifacts/audits/issue-079-audit-dev-20260823.sql` |
| Dev SQL size | 1078 lines, 58,111 bytes, LF-only |
| Dev SQL sha256 | `7656b3e8be27102ba3d1ffeb5e499ea0c23be7540bfae5f0a0648efdfc9e4756` |
| Generated / reviewed | 2026-08-23, execution session (Phase 3 step 2); full §2e review passed; primary Q1–Q11 block diffed byte-identical against the production file (lines 674–883 vs prod 481–690, including the AUDIT BODY banner); 22 assertions present in both CTE copies; 13c absent; production file hash re-verified `2f00ff54…` |

The execution session **may** mechanically fill evidence fields of this kind — the
final hash, the byte/line count, the run date — once the file has been generated and
reviewed. It **must not change approved audit semantics**: not the gate assertions,
not the primary query set, not the 13a/13b/13d shape, not the closure wording.

**If generating or reviewing the dev SQL exposes a substantive discrepancy with rev. 8
— a probe fact that does not reconcile, a body dependency the 22 assertions do not
cover, a primary query that cannot be held identical — execution STOPS and returns to
a fresh investigation session. The execution session does not reinterpret this plan.**

Review is per §2e and is blocking: LF-only via `tr -dc '\r' < FILE | wc -c` → `0`;
read start to finish; only `SELECT`, `SHOW`, catalogue reads, `BEGIN … READ ONLY`,
`ROLLBACK` and the `\pset` / `\gset` / `\if` / `\else` / `\endif` / `\echo`
meta-commands; no `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`MERGE`/`COPY`/DDL/
`GRANT`/`REVOKE`; no `DO`, `$$`, function definition or `CALL`; no `\!`, `\i` or
`\ir`; identity gate and live schema gate both ahead of the first application-data
query; a `ROLLBACK` on **each** gate-failure path plus the final one; **no `COMMIT`
anywhere**; terminator present. Then sha256, recorded before transfer.

A useful extra check available only for the dev file: **diff its primary block against
the production file's queries 1–11.** They must differ in nothing but the identity
literal. That proves comparability (§2g's central claim) rather than asserting it.

## Phase 3 — execution

Kept few — a burst of SSH attempts can trip the home Firewalla IPS and look like
the droplet being down. Production identity and production schema are **already
established** (Phase 0b), so production now needs **one** connection, not two.

**1. Production audit — self-contained: one connection transfers, verifies and
runs everything it needs.**

Rev. 8's first form was not self-contained. It invoked
`python3 /tmp/afldb-dsn-parse.py` while the same runbook recorded that the Phase 0b
probe had **removed** that file on exit, and left the fix to prose — "send it first
or fold it in" — which is a decision the execution session must not have to make.
The command below carries **both** reviewed files in a single payload, verifies
**both** hashes remotely, and only then opens the env file.

Run it as written; the whole block is wrapped in a subshell so its local guards can
`exit` without killing an interactive shell.

```bash
(
set -u
SQL=artifacts/audits/issue-079-audit-prod-20260823.sql
PARSER=scratchpad/afldb-dsn-parse.py
ART=artifacts/audits/issue-079-player-link-integrity-prod-20260823.txt

SQL_SHA=$(sha256sum "$SQL"    | cut -d' ' -f1)
PARSER_SHA=$(sha256sum "$PARSER" | cut -d' ' -f1)

# The reviewed bytes: §2e for the SQL, §2a for the parser.
# A LOCAL mismatch stops before any connection is attempted.
if [ "$SQL_SHA" != 2f00ff5477bc8bf7b9654765e846a42bf6e371f0f1f300b50f52c5e9a7bd0dc8 ]; then
  echo "FATAL: local audit SQL is not the reviewed file"; exit 5
fi
if [ "$PARSER_SHA" != eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f ]; then
  echo "FATAL: local DSN parser is not the reviewed file"; exit 5
fi

{ echo "local sql    sha256: $SQL_SHA"
  echo "local parser sha256: $PARSER_SHA"; } | tee "$ART"

# One payload, so ONE production connection carries both reviewed files.
STAGE=$(mktemp -d)
PAYLOAD=$(mktemp)
trap 'rm -rf "$STAGE" "$PAYLOAD"' EXIT
cp "$PARSER" "$STAGE/afldb-dsn-parse.py"
cp "$SQL"    "$STAGE/issue-079-audit.sql"
tar -cf "$PAYLOAD" -C "$STAGE" afldb-dsn-parse.py issue-079-audit.sql

/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=30 afldb \
  "EXPECTED_SQL_SHA='$SQL_SHA'; EXPECTED_PARSER_SHA='$PARSER_SHA'; "'
  set -u
  trap "rm -f /tmp/issue-079-audit.sql /tmp/afldb-dsn-parse.py" EXIT

  tar -xf - -C /tmp afldb-dsn-parse.py issue-079-audit.sql || {
    echo "FATAL: payload did not extract"; exit 6; }

  ACTUAL_SQL_SHA=$(sha256sum /tmp/issue-079-audit.sql   | cut -d" " -f1)
  ACTUAL_PARSER_SHA=$(sha256sum /tmp/afldb-dsn-parse.py | cut -d" " -f1)
  echo "expected sql    sha256: $EXPECTED_SQL_SHA"
  echo "remote   sql    sha256: $ACTUAL_SQL_SHA"
  echo "expected parser sha256: $EXPECTED_PARSER_SHA"
  echo "remote   parser sha256: $ACTUAL_PARSER_SHA"
  if [ "$EXPECTED_SQL_SHA" != "$ACTUAL_SQL_SHA" ] \
  || [ "$EXPECTED_PARSER_SHA" != "$ACTUAL_PARSER_SHA" ]; then
    echo "FATAL: sha256 mismatch - transferred bytes differ from reviewed bytes"
    exit 5
  fi
  echo "sha256 match confirmed"

  ENVF=/home/arm/projects/afldb/.env
  IDENT=$(python3 /tmp/afldb-dsn-parse.py --identity "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  echo "owner DSN identity: $IDENT"
  if [ "$IDENT" != "role=afldb_owner host=localhost port=5432 dbname=afldb_prod" ]; then
    echo "FATAL: DSN identity mismatch"; exit 4
  fi

  PGPASSWORD=$(python3 /tmp/afldb-dsn-parse.py --password "$ENVF" AFLDB_OWNER_DATABASE_URL) || exit 3
  export PGPASSWORD PGHOST=localhost PGPORT=5432 PGUSER=afldb_owner PGDATABASE=afldb_prod

  PGOPTIONS="-c default_transaction_read_only=on" \
    psql -X -a -v ON_ERROR_STOP=1 -P pager=off -f /tmp/issue-079-audit.sql < /dev/null
  PSQL_RC=$?
  echo "psql exit status: $PSQL_RC"
  exit $PSQL_RC
' < "$PAYLOAD" 2>&1 | tee -a "$ART"
RC=${PIPESTATUS[0]}

echo "ssh/remote exit status: $RC" | tee -a "$ART"
if [ "$RC" -ne 0 ]; then
  echo "AUDIT DID NOT COMPLETE - status $RC" | tee -a "$ART"
fi
)
```

**Why `/usr/bin/ssh`.** Under Git Bash that is the client already proven to work
with the active `ssh-agent`; leaving it as bare `ssh` can resolve to a different
client with a different agent and turn a working key into an interactive prompt,
which `BatchMode=yes` then fails outright.

**Why `tar` and not two `cat`s.** One stdin stream must yield two exact files.
`head -c` over-reads a pipe and would corrupt the remainder; a delimiter split
re-serialises lines and can lose a missing trailing newline. `tar` is byte-exact,
and the guarantee does not rest on `tar` anyway — **both** extracted files are
sha256-verified against the reviewed values before anything else happens.

**Hash comparison is enforced at both ends, and covers both files.** Locally, a
drifted `.sql` or parser stops the run **before a connection is opened**. Remotely,
the two non-secret expected hashes are interpolated into the command
(`"EXPECTED_SQL_SHA='…'; EXPECTED_PARSER_SHA='…'; "` is the only double-quoted
segment; the rest is literal single-quoted script), recomputed after extraction,
and compared — `exit 5` fires **before the env file is read, before any password
extraction, and before psql runs**. `exit 6` fires earlier still if the payload did
not extract.

The parser is `scratchpad/afldb-dsn-parse.py`, sha256
`eec7b211d96f4cb5eb39c9f99f75c826621ba8cecbfadee310401f4c4691a79f`, byte-identical
to §2a. Both `/tmp` files are removed by the remote `trap … EXIT`, and the local
staging directory and payload by the local one.

Everything rev. 8 required is preserved: reviewed-byte/hash guarantees on both
files, no secret ever printed, `default_transaction_read_only` set at connection
establishment via `PGOPTIONS`, `psql -X`, `ON_ERROR_STOP=1`, explicit status
capture, cleanup at both ends, and **one** production SSH connection.

**Exit status is captured without being suppressed.** `${PIPESTATUS[0]}` takes
**ssh's** status rather than `tee`'s zero; the status is appended to the artifact
— on failed runs as well as successful ones. Remotely, `set -u` is used without
`-e` so the explicit `if`/`exit` checks own the control flow and `PSQL_RC=$?`
survives a psql failure; the script then exits with psql's own status. The
`trap … EXIT` cleanup does not alter it.

Distinct statuses make the failure legible in the artifact: **3** parser failure
or psql `ON_ERROR_STOP` (including either gate), **4** DSN identity mismatch,
**5** hash mismatch — local or remote, SQL or parser — and **6** the payload failed
to extract.

The connection targets the independently established `afldb_prod` /
`afldb_owner` via `PG*` variables rather than trusting the DSN string; the DSN's
own claim is verified separately by the parser, and `current_database()` /
`current_user` confirm agreement in-session. No DSN or password ever reaches
argv, `ps`, the terminal or the artifact.

**2. Development audit SQL — generate, review, hash. No host is contacted.** This is
the **first** execution-preparation step and it happens before step 3, not before
step 1. The dev schema probe is already done (Phase 0d), so no further probe is
required. Generate `artifacts/audits/issue-079-audit-dev-<rundate>.sql` to the §2c
gate specification and the §2d / §2g body specification; review it in full per §2e;
record its sha256 in this runbook. If the generated file cannot be made to match the
approved semantics, **STOP** and return to a fresh investigation session (§2g).

**3. Development audit.** Same shape as step 1 against alias `dev` — the same
`/usr/bin/ssh`, the same two-file payload and double hash verification, with dev's
own SQL path and its step-2 hash — expecting
`role=afldb_owner host=localhost port=5432 dbname=afldb_dev`, into
`issue-079-player-link-integrity-dev-<rundate>.txt`. Confirms or corrects the
previous 75 / 0 result under the comparable query set. No dev data modified.

Steps 1 and 3 are independent and either order is acceptable; step 2 must precede
step 3.

## Phase 4 — artifact

`artifacts/audits/` holds, at execution time:

| File | Status |
|---|---|
| `issue-079-identity-prod-20260823.txt` | captured — production identity probe |
| `issue-079-schema-probe-prod-20260823.txt` | captured — the Phase 0b migration/schema evidence |
| `issue-079-audit-prod-20260823.sql` | generated, reviewed, hashed `2f00ff54…` — **not yet run** |
| `issue-079-audit-{prod,dev}-20260823.rev4-superseded.sql` | retained, **must not be run** — generated against the undeployed schema, kept so the reconciliation is auditable |
| `issue-079-schema-probe-dev-20260823.txt` | captured — the Phase 0d migration/schema evidence |
| `issue-079-audit-dev-20260823.sql` | generated, reviewed, hashed `7656b3e8…` (Phase 3 step 2, 2026-08-23) — **not yet run** |
| `issue-079-player-link-integrity-prod-<rundate>.txt` | pending — the production audit capture |
| `issue-079-player-link-integrity-dev-<rundate>.txt` | pending — the dev audit capture |

A hand-written header records timestamp, expected vs connected database and role,
identity authority, both read-only settings, isolation level, **the production
migration state read from `afldb_meta.schema_migrations`**, local and production
SHAs with working-tree state, current `LINK_TARGET_TABLES`, both sha256 hashes,
the observed exit status, and
`Production transaction ended with: ROLLBACK`.

**`/artifacts/` is gitignored** (`.gitignore:89`), matching the existing
`artifacts/hydration/`, `artifacts/nl-ui/` convention. Raw evidence stays on the
workstation; the durable committed record is the counts written into `issues.md`.

## Phase 5 — ledger and closure semantics

### Mandatory evidence — Outcome A is impossible unless all seven are positively observed

1. `AFLDB-ISSUE-079 IDENTITY GATE PASSED`, with no gate-failure error;
2. `AFLDB-ISSUE-079 LIVE SCHEMA GATE PASSED`, with **all seventeen** named
   assertions `t` — including the S16/S17 schema pins, which prove the file was
   run against the migration-057 schema it was generated for;
3. the complete audit body ran — every query 1–11 present with its result, plus
   the supplementary query 13;
4. the explicit final `ROLLBACK` and the terminator
   `AFLDB-ISSUE-079 AUDIT COMPLETE - TRANSACTION ROLLED BACK`, with no `COMMIT`;
5. `psql exit status: 0` **and** `ssh/remote exit status: 0`;
6. current-vocabulary dangling resolutions total **0**;
7. every unknown-vocabulary or schema-integrity finding **explicitly
   classified**, and shown not to invalidate the clean conclusion. An
   unclassified or unexplained finding blocks closure even when condition 6
   holds.

Any one missing → the audit is reported as **not completed**, and ISSUE-079 stays
Open. Closure is never inferred from a zero count alone.

**Query 13 is not among these conditions and cannot satisfy or block any of
them.** It is supplementary deployment/exposure context only.

The same seven conditions apply to the **development** run, with condition 2 reading
**all twenty-two** assertions `t` including S16dev/S17dev.

**Condition 3 on dev needs one distinction that rev. 8 first stated as a
contradiction.** Two different things were being called "completeness":

- **Technical run completeness.** Every query in the dev file — queries 1–11 **and**
  the fenced dev-only block (3x, 12a–12c, 13a, 13b, 13d) — must execute successfully.
  Under `ON_ERROR_STOP=1` a failure anywhere aborts psql with a non-zero status, so a
  dev-only query that errors means the **run** did not complete and condition 3 is not
  met. Every query must run.
- **Evidential weight.** The **result values** of 3x, 12a, 12b, 12c, 13a, 13b and 13d
  are supplementary. They can neither satisfy, invalidate nor block ISSUE-079's
  historical integrity conclusion. Stale or dangling `player_link_match_candidates`
  rows in particular are a regenerable cache and are never a finding.

**The primary comparable metrics Q1–Q11 alone determine the production/development
integrity comparison.** "This query must run" and "this query's answer counts towards
the verdict" are separate facts, and only the first applies to the dev-only block.

### What ISSUE-079 is, and what a clean result does and does not prove

ISSUE-079 is a **point-in-time historical integrity audit**. Its question is
whether any `player_link_resolutions` row in production names a `target_id` that
no longer exists, **as at the audited snapshot**. It is diagnosis only; it
authorises no remediation and no deployment.

The ledger already scopes it that way — *"Historical, not reproducible forward"*,
*"No remediation is authorised by this issue. It covers diagnosis only"* — and
states its closure criterion exactly once: the issue *"stays Open until
production has been audited and its counts recorded here."* Deployment of any
loader repair is not part of that criterion.

Repository convention supports closing on that basis. `CLAUDE.md` defines
resolution as *"implementation plus appropriate verification"*, with no
deployment condition, and `issues.md` already records the separation explicitly
for `AFLDB-ISSUE-075`: **`Resolved: 2026-08-22 (dev; not deployed to
production)`**. Resolution status and deployment status are two facts, tracked
separately, and the deployment fact is annotated rather than allowed to block
resolution.

**So a zero result may close ISSUE-079** — provided all seven evidence conditions
above hold.

### The prospective protection is NOT deployed, and this is broader than rev. 5 recorded

Rev. 5's Phase 0a said the undeployed prospective repair was `AFLDB-ISSUE-078`'s.
That was incomplete. Checking the production checkout directly:

| Loader | State at production `a32a0a1` | Tables it destroys |
|---|---|---|
| `tools/migration/import_awards.py` | `truncate(pg, …)` at lines 361, 550, 632, 677, 720 | `award_winners`, `award_nominations`, `hall_of_fame`, `honour_team_members`, `captaincies` |
| `tools/migration/import_draft.py` | `truncate(pg, "draft_picks", "draft_persons")` at line 241 | `draft_picks` |
| `tools/records/import-first-kick-goal.ts` | `DELETE FROM player_achievements WHERE achievement_type = 'first_kick_goal'` at line 480 | `player_achievements` |

`AFLDB-ISSUE-044` was **Found 2026-08-20 and Resolved 2026-08-22** — both *after*
the production checkout of 2026-08-19 — so the honours-family repair is undeployed
too, not only ISSUE-078's draft and first-kick-goal repair. **All seven
`LINK_TARGET_TABLES` are still served by destructive loaders in the production
checkout.**

This does not change what the audit measures, and it does not make a zero result
wrong. It changes what a zero result may be *said* to mean.

### Required wording — the two statements must never be merged

Any closure of ISSUE-079 must state both of these separately and explicitly:

> **Historical audit result.** At the ISSUE-079 production audit snapshot of
> *<timestamp>*, the production database at migration 057 held *<n>*
> `player_link_resolutions` rows, of which **0** named a target id that no longer
> exists, across all seven `LINK_TARGET_TABLES`. **No historical dangling
> player-link resolution targets were found, and no remediation was required for
> the audited historical rows.** `player_link_resolutions` has existed in
> production only since `056_player_link_review.sql` was applied at 2026-08-19
> 17:42:14.80+10, so that is the full window in which a dangling row could have
> arisen.

> **Prospective protection status — separate, and not established by this
> audit.** At that same snapshot **the prospective protections implemented under
> `AFLDB-ISSUE-044` and `AFLDB-ISSUE-078` were not deployed in production.** The
> deployed checkout `a32a0a1` still contained destructive reload behaviour
> affecting all seven current player-link target families, so a reload run in
> production before those repairs are deployed can create new dangling
> resolutions. **ISSUE-079's clean result is evidence about the past, not
> protection for the future** — it is not proof that future reloads cannot create
> dangling targets. That forward exposure belongs to separate deployment work, not
> to ISSUE-079.

A closure that states only the first is misleading and must not be written.
The `Resolved` field follows the ISSUE-075 precedent and carries the
qualification, e.g. `Resolved: <date> (production audited at migration 057;
ISSUE-044/078 loader repairs not yet deployed)`.

### Does anything already own that deployment? No.

Checked before approving the closure logic, because a closure that hands its
forward exposure to "ISSUE-044 and ISSUE-078's deployment" is only honest if
something actually owns it.

**The deployment instructions exist.** They are recorded, in detail, in the
`Follow-up` sections of both issues:

- `AFLDB-ISSUE-044` — apply migration `068` and run `npm run db:privileges`
  *before* the new importer code, or the honours loaders fail closed on the
  resolution read.
- `AFLDB-ISSUE-078` — apply `069_draft_source_identity.sql` before the new
  `import_draft.py`; apply `070_import_reads_link_suggestions.sql` and run
  `npm run db:privileges` before the new first-kick-goal importer; then run
  `--rekey` **once per target database (dev, production)** before the extract is
  next corrected.

**Nothing open owns them.** Both issues are `Status: Resolved`, and repo
convention removes a resolved issue from `IssuesIndex.md` and the Open Issues
table — so these instructions are invisible to the open-work view. The fifteen
currently open issues are `040`, `054`, `059`, `068`, `071`, `072`, `073`, `074`,
`076`, `077`, `079`, `080`, `081`, `082`, `083`. None is a deployment work item,
and no open entry mentions deployment at all.

**Recommendation — a separate deployment issue, raised once the ISSUE-079 production
audit has SUCCESSFULLY COMPLETED and its result has been established**, not folded
into ISSUE-079. ISSUE-079 is diagnosis-only and must not acquire a remediation or
deployment scope.

**The trigger is audit completion, not ISSUE-079's closure.** Rev. 7 wrongly
conditioned it on the issue closing, which would have left the forward exposure
ownerless for exactly as long as Outcome B kept ISSUE-079 open — the case where the
exposure matters most. The rule is:

| Audit result | ISSUE-079 | What is raised |
|---|---|---|
| **Outcome A** — clean | may **resolve** | the separate **deployment** issue owns the ISSUE-044/078 production rollout |
| **Outcome B** — affected | stays **open** | a separate **historical remediation** issue owns the affected rows, **and** the separate deployment issue still owns the prospective ISSUE-044/078 rollout |
| **Audit did not complete** | stays **open** | **nothing** — no ledger issue is created from incomplete evidence |

The deployment issue is raised in both A and B. It is never raised on a run that
failed a gate, failed a hash comparison, or returned a non-zero exit status.

The new issue would own, in order:

1. migrations `058`–`070` applied to production;
2. `npm run db:privileges` at the points `044` and `078` specify;
3. the new `import_awards.py`, `import_draft.py` and `import-first-kick-goal.ts`;
4. the one-time `--rekey` per database;
5. re-running the ISSUE-079 audit afterwards, since the schema pin S16/S17 will
   by then correctly refuse the migration-057 file.

Until that issue exists, the forward exposure named in the second required
statement has **no owner**, and the closure wording must say so rather than
implying the risk is handled elsewhere.

**It is not created during planning.** Rev. 8 records the recommendation and the
trigger; the ledger entry itself is written only after the audit has completed.

### Outcomes

**Outcome A — production clean.** Record every per-table count (explicit zeros
included), the suggestion audit, structural sanity results, all seventeen
schema-gate assertions, the query-13 exposure context, the dev comparison and the
artifact path in `issues.md` §AFLDB-ISSUE-079; set `Status: Resolved` with the
qualified resolved date above; write **both** required statements; state that no
historical dangling targets were found and no remediation was required; remove
the row from the Open Issues table and from `IssuesIndex.md`, keeping counts
synchronised.

`IssuesIndex.md`'s ISSUE-079 entry currently reads *"no current honours code path
creates new orphans"*. That is true of the repaired code but **false of what is
deployed in production**, and it must be corrected or removed as part of the same
edit rather than left standing next to a closure.

**No `CHANGELOG.md` entry** — repo convention excludes investigation-only updates
with no retained project change.

**Outcome B — production affected.** ISSUE-079 stays **Open**; record affected
tables, exact per-table counts, complete row details, earliest/latest dates,
actions/players/admins; perform the authorised read-only feasibility analysis
**per affected row** and classify each `potentially reconstructable` or `not
safely reconstructable` on its own evidence, per §2d; change nothing in
production. The remediation issue owns the affected historical rows; **the separate
deployment issue is still raised**, because it owns the prospective exposure and that
is a different fact.

**Outcome C / D.** Unknown vocabulary, dangling `player_id`, invalid admin
reference, or schema drift: its own issue, never folded into ISSUE-079's counts.
A dangling `player_id` or admin reference is **constraint failure**, not an
application-level gap, and the report must say which.

In B and C/D the remediation issue is **created in the ledger** — a new
`AFLDB-ISSUE-0xx` entry in `issues.md` with the evidence and feasibility
classification, added to the Open Issues table and `IssuesIndex.md`, id taken
from a targeted heading search.

Any future remediation must preserve historical truth: the original dangling
audit event remains immutable evidence; a reviewed identity reconstruction is
reapplied through the normal player-link workflow, writing a **new** audit event.
The original event is never rewritten to pretend its target id never changed.

---

## Verification

The audit is the verification; there is no code change to test. What proves the
run sound, all visible in the artifact:

1. `current_database() = afldb_prod`, `current_user = afldb_owner`, matching
   `00_install_postgres_prod.sh` and the parser's identity line.
2. `default_transaction_read_only = on`, `transaction_read_only = on`,
   `transaction_isolation = repeatable read`.
3. One `BEGIN … READ ONLY`, an explicit `ROLLBACK`, no `COMMIT`; terminator
   present; **both** `IDENTITY GATE PASSED` and `LIVE SCHEMA GATE PASSED`, with
   all seventeen named assertions true and no gate-failure error.
4. **S16 and S17 true** — the run happened against the migration-057 schema this
   file was generated for. A failure of either means production has moved on and
   the file must be regenerated, not rerun.
5. `sha256 match confirmed` appears in the artifact — the remote comparison
   actually ran and passed — and the same file was read in full at §2e, whose
   recorded hash `2f00ff54…` still matches at execution time.
6. `psql exit status: 0` and `ssh/remote exit status: 0` recorded in the
   artifact, captured via `${PIPESTATUS[0]}` rather than `tee`'s status.
7. Seven rows in each per-table summary, zeros explicit.
8. Production migration state recorded from the ledger itself, not inferred from
   a checkout SHA; local and production SHAs and working-tree states recorded and
   compared, with the relevant drift **reconciled by regeneration** before
   execution rather than noted after it.
9. Dev re-check reproduces or corrects 75 / 0 under the comparable query set,
   with dev's own schema probed (Phase 0d) and gated first — **all twenty-two**
   assertions `t`, including the S16dev/S17dev pins to migration 070 — and its extra
   later-schema diagnostics (3x, 12a–12c) reported separately from the comparable
   core counts.
10. **Before the dev run**, the generated dev SQL passed the §2e review, its sha256
    was recorded in this runbook, and its primary block **diffed clean** against the
    production file's queries 1–11 apart from the identity literal. That diff is what
    proves the primary metrics are comparable; the claim is never merely asserted.
11. Dev source drift is recorded as **unassessable and scoped** (Phase 0c), with the
    Git evidence in the artifact, and dev's Query 13 shown to contain **no 13c**.

The final report closes with: production data changed **NO**, schema **NO**,
privileges **NO**, migrations **NO**, importers **NO**, transaction committed
**NO**, ended with `ROLLBACK` **YES** — stated only if the artifact shows it, and
otherwise replaced with an explanation and a statement that the audit did **not**
complete.

It must also close with the two Phase 5 statements kept separate: the historical
audit result at the snapshot, and the prospective protection status. A report
that gives only the first is incomplete.

## Explicitly out of scope

No ISSUE-078 importer code, no ISSUE-080 ownership work, no reloads, no
`reload_keyed` change, no migrations, no `db:privileges`, no grant or schema
change, no deletion of stale suggestions, no relinking, and no identity inferred
from names.

No Git commands, commit, push, merge, reset or other Git-history operation. No
issue-ledger change: `issues.md` and `IssuesIndex.md` are edited only at Phase 5,
after the audit has run.

Repository changes authorised across the planning and reconciliation sessions are
limited to: `AFLDB-ISSUE-079.md` itself; the gitignored working files under
`artifacts/audits/`; and the reviewed read-only scripts
`scratchpad/afldb-dsn-parse.py`, `scratchpad/issue-079-schema-probe.sh` and
`scratchpad/issue-079-schema-probe-dev.sh`.

**No further audit SQL is generated in this final planning session.** The
already-reviewed production SQL — generated and hashed during the rev. 6/7
reconciliation — is retained unchanged; development SQL generation is deferred to
execution preparation (Phase 3 step 2, §2g).

The deployment issue of Phase 5 is **recommended, not created**, in any planning
session.

**No production writes are authorised under AFLDB-ISSUE-079.**
