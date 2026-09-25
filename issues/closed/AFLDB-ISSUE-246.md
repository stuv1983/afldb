# AFLDB-ISSUE-246 — Orphaned ISSUE-109 DEV match override blocks promotion

## 0. Status

**RESOLVED (2026-09-25).** **Severity:** High. It blocked ISSUE-237 L4, the next DEV promotion,
at A4.3. **Area:** durable admin overrides and DEV operations: `data_overrides`, `auth_audit_log`,
and `tools/maintenance/issue246-retire-issue109-fixture.ts`. **Tier:** T1 (one tool, one test
file, one npm script, and tracking).

**Resolved on operator-run live DEV evidence (§10.1).** The fix was committed as `4bb23a8f`
(`fix(maintenance): retire orphaned dev fixture override`) and deployed to DEV. Under explicit
authorisation, the operator backed up `afldb_dev`, ran validate-only (WOULD_RETIRE), `--apply`
(RETIRED, `auth_audit_log` 983, 2 writes, COMMITTED) and a rerun (ALREADY_RETIRED, the same 983, 0
writes). P1–P5 all PASS. Override `id 1` is preserved and inactive, the canonical fixture match is
still absent, `data_edits` and `data_overrides` did not move, and ISSUE-237 A4.3 now returns no
rows.

ISSUE-237 L4 is **not** continued by this issue. ISSUE-237 stays open, and its next step is L4
A5 under its own authorisation.

*(Historical, implementation pass 2026-09-25: implemented and DB-free validated (§9); NOT run
against any database. No DEV, PROD, `afldb_test`, `code_test_db` or SSH contact happened in that
pass.)*

## 1. Live evidence (ISSUE-237 L4, second attempt, 2026-09-25, operator-reported)

ISSUE-237 L4 STOPPED correctly at A4.3 (runbook `issues/open/AFLDB-ISSUE-237.md` §11d.12). DEV
holds exactly one active 2026+ match-keyed override:

| Column | Value |
|---|---|
| `entity_type` | `matches` |
| `entity_key` | `2026\|R30\|2026-12-31\|104\|103` |
| `field_group` | `notes` |
| `override_values` | `{"notes": "AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN"}` |

DEV has **no** canonical `matches` row for that `match_key`. A4.3 (F-L4-9) refuses because the
historical candidate lacks the match. The `matches` replay (`UPDATE … WHERE entity_key =
match_key`) would then silently lose the decision, and no deferred replay exists after the §9
re-acquisition.

## 2. Root cause (exact)

1. **The fixture was created to be retained (ISSUE-109, 2026-08-30).** ISSUE-109's authenticated
   Data Editor gate ran on a dedicated, future-dated DEV fixture (match 17059). It left one
   active `matches`/`notes` override holding the exact baseline marker, which was intentional
   durable state. The record warned (`issues/closed/AFLDB-ISSUE-109.md`, *Cleanup and
   restoration*):
   - Delete Match deletes the match but never touches `data_overrides`;
   - the override has no FK to `matches`, so deleting the match strands an active natural-key
     override;
   - removal therefore needs a separately approved, audited release action. No such action
     existed.
2. **The fixture match was deleted anyway, on the old DEV lineage.** The ISSUE-139 Phase 4C′ read
   of `afldb_dev` (2026-09-06, `issues.md`, the lineage table under *Phase 4C′*) records the
   fixture's replaced-lineage audit rows as 22–26: creation, `notes` ×3, then **`match_deletion`**.
   The match was gone from DEV itself before any promotion. The override stayed active.
3. **The 2026-09-06 DEV promotion carried the orphan forward and withheld its audit** (ISSUE-139
   Phase 4E):
   - `data_overrides` is reinstated verbatim, so override `id 1` survived.
   - `data_edits` is **historical-only on a DEV promotion** (ISSUE-139 D2 / ISSUE-143;
     `tools/db/promotion-inventory.ts`, the `data_edits` `historicalOnly` entry). Promoted DEV
     therefore held `data_edits` **0**, and rows 22–26 now exist only in that promotion's
     pre-cutover dump and retained `afldb_dev_pre_rebuild_<stamp>`.
   - The post-settle §8.1 replay recorded the override as "inert on the new lineage", and
     `matches` has no 2026-12-31 row before or after.
4. **Nothing could retire it.** No application or tool path releases or deactivates an override
   with an audit. ISSUE-109 explicitly forbade direct SQL, and the next promotion (L4) now
   refuses the orphan by design.

This is precisely the orphan state ISSUE-109 warned about. ISSUE-237 A4.3 is correct and is not
weakened. Promotion is not taught to discard an unmatched override.

## 3. Historical specification and what is not on `afldb_dev`

The closed ISSUE-109 record is the immutable specification, together with the ISSUE-139 4E
readback for the override id:

- match id **17059** and audit rows **22–25** (ISSUE-109's accepted history). These are
  **replaced-lineage** facts.
- ISSUE-139 4C′ independently records row 26 as the later `match_deletion`. ISSUE-246 accepts
  22–25 as ISSUE-109's history and cites 26 only as that independent observation.
- match key `2026|R30|2026-12-31|104|103`; group `notes`; the exact baseline payload;
- author `admin_user_id = 4`; acceptance date 2026-08-30;
- override `id 1` (`issues.md`, ISSUE-139 Phase 4E §8.1 re-run row).

**Not on `afldb_dev`:**
- the ISSUE-109 audit chain, withheld by D2;
- any meaningful id 17059, because a rebuilt-lineage `matches.id` 17059 may be a different, real
  match.

The tool never looks anything up by 17059, and never writes it anywhere but a provenance field.

## 4. Operator decisions (2026-09-25)

- **OD-246-1: historical audit evidence = in-database provenance.**
  - **Not accepted:** a literal data_edits chain on DEV. A chain that reappeared there would be
    ambiguous and STOPs.
  - **Not used:** `afldb_dev_pre_rebuild_*`. It is rollback material, not a permanent
    provenance dependency.
  - **The live guard proves** (§6):
    - exactly one matching override, with the exact key, group and payload;
    - the recorded ISSUE-109 provenance and timestamp window;
    - it is active;
    - the canonical match is absent;
    - no current `data_edits` row purports to be the fixture's surviving chain;
    - **one or more** later DEV `database.promoted` markers record `data_edits` as historical-only.

  Together these show three things: the durable override survived; its canonical match
  disappeared; and the audit chain's absence is explained by the supported promotion lifecycle,
  not by corruption.
- **OD-246-2: audit sink = `auth_audit_log`**, `action = 'data_override.retired'`, bound to the
  natural key and the override record, never to the historical match id.
  - **Why not `data_edits`:** its `row_id` must name a live row in the current lineage. 17059 would
    be a fabricated or misattributed target. `data_edits` is also historical-only on DEV
    promotions, so the next DEV promotion would drop the record.
  - **Why `auth_audit_log`:** it is append-only, reinstated in full (`compare: atLeast`), and
    already the home of the `database.promoted` markers.

## 5. Repair lifecycle

A dedicated maintenance CLI, `npm run db:issue246:retire-issue109-fixture`
(`tools/maintenance/issue246-retire-issue109-fixture.ts`). It is not a UI feature and not a
generic deactivation command. The target, key, group, payload, id, author and window are
constants in code, and no argument can name another target.

```text
--environment dev --actor-email <super admin>            validate only (READ ONLY transaction)
--environment dev --actor-email <super admin> --apply    the one mutation
```

**Desired final state:**
- the `data_overrides` row still exists, with `is_active = false`;
- `override_values`, `admin_user_id` (4, the ISSUE-109 author) and `created_at` are preserved;
- `updated_at` is the retirement instant;
- historical `data_edits` are untouched: the tool neither writes nor deletes any row;
- exactly one new `auth_audit_log` row records the retirement;
- the canonical match remains absent;
- A4.3 sees zero active 2026+ match overrides.

## 6. Database and fixture guards (all before mutation; any failure = STOP, nothing written)

- **Before any connection:**
  - `--environment` must be exactly `dev`. `prod`/`production`/`test` and anything else are
    refused, and there is no production path.
  - `--actor-email` is required and must be well-formed.
  - Unknown arguments are refused. That includes `--force`, `--database`, `--entity-key`,
    `--dsn` and `--override-id`.
  - The DSN comes only from `AFLDB_OWNER_DATABASE_URL`. Its path must be exactly `afldb_dev`.
    `afldb_test`, `code_test_db`, `afldb_prod`, candidate and pre-rebuild names are all refused.
    The DSN is never printed.
- **Inside the transaction** (the override rows are locked `FOR UPDATE` under `--apply`):
  - `current_database()` = `afldb_dev`.
  - Exactly **one** `data_overrides` row names the key. This counts `matches` exact and
    `match_coaches` by `<key>|` prefix, so a second override in any group or entity type is a
    STOP.
  - That row is `matches` / key / `notes`, with `id = 1`, `admin_user_id = 4`, and
    `override_values` **exactly** `{"notes": <baseline>}`. One key and the exact string: a hyphen
    for the em dash, trailing space, an extra key or a double-encoded string all STOP.
  - **Provenance window:** `created_at` and (while active) `updated_at` fall on 2026-08-30 in some
    zone from UTC-12 to UTC+14 (`[2026-08-29T10:00Z, 2026-08-31T12:00Z)`), and `created_at ≤
    updated_at`. The record gives a date without a zone. A later `updated_at` means the override
    changed after ISSUE-109, so it STOPs.
  - **Canonical match absent:** `matches.match_key` = key has 0 rows. It is never checked by id.
  - **No surviving chain:** no `data_edits` row whose note, `old_values` or `new_values` contains
    `AFLDB-ISSUE-109` or the key.
  - **Promotion marker:** at least one `database.promoted` row must qualify. A qualifying row has a
    JSON-object `detail` with `environment = dev` and `replaced = afldb_dev`. Its
    `historical_only` list must name `data_edits`, and its `at` must be later than the fixture's
    last ISSUE-109 write. Every qualifying id is recorded.
  - **Actor:** `--actor-email` matches exactly one `auth_users` row that is `super_admin`, enabled,
    and enrolled with both password and TOTP. That is the same "enabled + enrolled super admin"
    posture as the promotion checker's `--expect-super-admin`. It is checked only when a write
    would happen.
  - **State:** active with zero retirement audits means RETIRE. Inactive with exactly one coherent
    retirement audit means ALREADY_RETIRED (§8). Everything else STOPs:
    - inactive with no audit (it was deactivated outside this lifecycle);
    - active with an audit;
    - duplicate audits;
    - an unreadable or incoherent audit.
  - **Under `--apply`:** the role must hold `UPDATE(is_active, updated_at)` on `data_overrides`
    and `INSERT` on `auth_audit_log`. The `afldb_dev` owner DSN has both. No single restricted role
    holds both, so the owner is required for the atomic pair.

A STOP lists every problem found, not only the first.

## 7. Audit design

One `auth_audit_log` row:

| Column | Value |
|---|---|
| `actor_user_id` | the verified super admin |
| `actor_label` | `operator: retire ISSUE-109 fixture override (AFLDB-ISSUE-246)` |
| `action` | `data_override.retired` |
| `detail` (jsonb object, bound with `sql.json`, never pre-stringified — migration 082) | `issue` `AFLDB-ISSUE-246`; `operation` `override_retirement`; `reason` (ISSUE-237 L4 A4.3 STOP, matches=1, orphaned retained ISSUE-109 fixture); `related_issues` [109, 237]; `database`; `override_id`; `entity_type` / `entity_key` / `field_group`; `previous_state` {`is_active: true`, `admin_user_id`, `created_at`, `updated_at`}; `new_state` {`is_active: false`}; `preserved_override_values`; `canonical_match_present: false`; `historical_provenance` {record, `replaced_lineage_match_id: 17059`, `replaced_lineage_audit_rows: [22,23,24,25]`, current-lineage absence explanation, `promotion_marker_ids`}; `tool` |
| `at` | `now()`, the same transaction timestamp as the override's new `updated_at` |

No historical audit row is rewritten. No `data_edits` row is written.

## 8. Transaction, rollback and idempotence

**The transaction:** one `BEGIN` → lock and read → classify → guarded `UPDATE` → `INSERT` → re-read
and re-classify → `COMMIT`. `executeIssue246` never catches, so any throw leaves `begin()` and
rolls back the UPDATE and the INSERT together:
- **UPDATE guard:** `UPDATE data_overrides SET is_active = false, updated_at = now() WHERE id = 1
  AND` key / group / author `AND is_active AND override_values = <exact baseline>`. It must change
  **exactly 1** row, or the tool refuses before the audit INSERT (0 or >1 rows: no audit).
- **Audit INSERT failure:** the exception propagates and rolls back the `is_active` change.
- **Post-write readback:** it must classify as ALREADY_RETIRED, bound to the new audit id, with
  `audit.at = override.updated_at`. Otherwise it rolls back.

**Idempotence:** a second or later run, `--apply` or validate-only, is a verified
**ALREADY_RETIRED PASS** with 0 writes. It requires everything below, and anything else is a STOP,
so it never creates a duplicate:
- exactly one coherent retirement audit, whose issue, operation, override id, natural key,
  previous/new state and preserved payload all match;
- the audit's `at` equals the override's `updated_at` (proof that both came from one transaction);
- `previous_state.updated_at` inside the window, and a qualifying marker after it;
- the canonical match still absent, and still no `data_edits` claim.

Under concurrency, the `FOR UPDATE` lock serialises two `--apply` runs. The second sees the
committed retired row and the audit, and returns ALREADY_RETIRED.

## 9. Validation (DB-free, Claude-run, 2026-09-25)

| Command | Result |
|---|---|
| `npx vitest run tests/issue246-retire-issue109-fixture.test.ts` | **88/88 PASS** |
| `npx tsc --noEmit` | clean (exit 0) |
| `npx eslint` on the tool and its test | clean (exit 0) |
| `npx vitest run tests/data-overrides-source-contract.test.ts tests/db-promotion-check.test.ts tests/reference-data.test.ts tests/db-test-rebuild.test.ts` | 784/787. The 3 failures are pre-existing and independent of this diff: the `afl-api-player-links.ts` `.json` resolver gap; the `remapActors` slice searching `'\n}\n'` in a CRLF worktree; and `reference-data` §H12 (the ISSUE-237 runbook §11d.11 records the first and third). None reads a file this issue changes. |
| `git diff --check` | clean |

**Coverage:**
- **Fixture recognition:** exact fixture recognition, and a pin to the closed ISSUE-109 record.
- **Refusals** of:
  - a wrong database, before and after connecting;
  - a wrong natural key, entity type or field group;
  - eight wrong payloads;
  - a wrong id or author;
  - provenance outside the window, or a later change;
  - a canonical match that is present;
  - ambiguous or surviving `data_edits` claims;
  - absent historical evidence (eight marker variants), while one-or-more qualifying markers are
    accepted;
  - an unsuitable actor (five variants).
- **State handling:** inactive with no audit, active with an audit, duplicate audits, audit
  instant mismatch, incoherent audits, and ignoring another override's audit.
- **The audit record:** its content, and the absence of `row_id`/`match_id`.
- **The transaction path:** validate-only is read-only; ordering; exactly one UPDATE and one
  INSERT; INSERT failure → rollback; UPDATE 0/2/throw → no audit; readback mismatch → rollback;
  missing privilege → no write; STOP under `--apply` → no write; runs 2–4 ALREADY_RETIRED with no
  duplicate.
- **Source contract:** no `DELETE`/`TRUNCATE`, no `data_edits` write, exactly one UPDATE (two
  columns) and one INSERT, `sql.json` bindings, no `--force`, no prod target, and the npm script.

The in-memory store stages writes and publishes them only when the callback resolves. That is the
`begin()` rollback contract, but a real PostgreSQL proof is §11's optional rehearsal.

## 10. Live DEV procedure (operator-run; RUN 2026-09-25, PASS — evidence §10.1)

**Prerequisites:**
1. **This code on the DEV host.** The ISSUE-246 code is committed, merged and on the DEV checkout
   (`~/projects/afldb`).
2. **An explicit DEV authorisation** for this one mutation.
3. **The DSN exported.** `AFLDB_OWNER_DATABASE_URL` is exported in the host shell and names
   `afldb_dev`, the same variable ISSUE-237 §11d A4 uses.

It is independent of the ISSUE-237/242/243 commits, but it must run **before** L4 is resumed.

```bash
# DEV: streamanator
cd ~/projects/afldb && hostname && git log -1 --oneline

dev_ro() { PGOPTIONS='-c default_transaction_read_only=on' psql -X -A -t -v ON_ERROR_STOP=1 -d "$AFLDB_OWNER_DATABASE_URL" -c "$1"; }

# 0. Pre-state record (read-only). Keep the output.
dev_ro "SELECT format('db=%s data_edits=%s/%s audit=%s/%s overrides=%s', current_database(), (SELECT count(*) FROM data_edits), (SELECT max(id) FROM data_edits), (SELECT count(*) FROM auth_audit_log), (SELECT max(id) FROM auth_audit_log), (SELECT count(*) FROM data_overrides))"

# 1. Mandatory safety net before a DEV write (docs/backup-restore.md).
bash tools/maintenance/backup.sh --keep 14            # must print "Backing up afldb_dev to …"

# 2. Validate only (READ ONLY transaction).
npm run db:issue246:retire-issue109-fixture -- --environment dev --actor-email <DEV super admin email>
# expect: verdict WOULD_RETIRE; override data_overrides 1; promotion markers <ids>;
#         transaction READ ONLY (validate only; nothing written); PASS.
# any "REFUSED: STOP before mutation" -> record every listed problem and STOP. Do not work around it.

# 3. The one mutation.
npm run db:issue246:retire-issue109-fixture -- --environment dev --actor-email <DEV super admin email> --apply
# expect: verdict RETIRED; retirement audit auth_audit_log <N>; writes 2; COMMITTED; PASS.

# 4. Idempotence proof.
npm run db:issue246:retire-issue109-fixture -- --environment dev --actor-email <DEV super admin email> --apply
# expect: verdict ALREADY_RETIRED; the SAME auth_audit_log <N>; writes 0; COMMITTED (no writes); PASS.
```

**Read-only post-repair checks** (after step 4):

```bash
# P1. Exactly one override names the fixture: the same row, inactive, payload and author preserved.
dev_ro "SELECT format('db=%s id=%s type=%s group=%s active=%s admin=%s payload_exact=%s created=%s updated=%s', current_database(), id, entity_type, field_group, is_active, admin_user_id, override_values = jsonb_build_object('notes', 'AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN'), created_at, updated_at) FROM data_overrides WHERE (entity_type = 'matches' AND entity_key = '2026|R30|2026-12-31|104|103') OR (entity_type = 'match_coaches' AND starts_with(entity_key, '2026|R30|2026-12-31|104|103|'))"
# expect exactly one line: db=afldb_dev id=1 type=matches group=notes active=false admin=4 payload_exact=true created=2026-08-30… updated=<step 3 instant>

# P2. Exactly one retirement audit, bound to that row in the same transaction.
dev_ro "SELECT format('db=%s audit=%s actor=%s issue=%s override=%s key=%s prev_active=%s new_active=%s payload_exact=%s same_instant=%s', current_database(), a.id, a.actor_user_id, a.detail->>'issue', a.detail->>'override_id', a.detail->>'entity_key', a.detail#>>'{previous_state,is_active}', a.detail#>>'{new_state,is_active}', a.detail->'preserved_override_values' = jsonb_build_object('notes', 'AFLDB-ISSUE-109 DEDICATED DEVELOPMENT VALIDATION FIXTURE — BASELINE — RETAIN'), a.at = o.updated_at) FROM auth_audit_log a JOIN data_overrides o ON o.id = 1 WHERE a.action = 'data_override.retired' ORDER BY a.id"
# expect exactly one line: db=afldb_dev audit=<N> actor=<id> issue=AFLDB-ISSUE-246 override=1 key=2026|R30|2026-12-31|104|103 prev_active=true new_active=false payload_exact=true same_instant=true

# P3. The canonical fixture match is still absent.
dev_ro "SELECT format('db=%s fixture_matches=%s', current_database(), count(*)) FROM matches WHERE match_key = '2026|R30|2026-12-31|104|103'"
# expect: db=afldb_dev fixture_matches=0

# P4. ISSUE-237 A4.3, verbatim.
dev_ro "SELECT current_database(), entity_type, count(*) FROM data_overrides WHERE is_active AND entity_type IN ('matches', 'match_coaches') AND split_part(entity_key, '|', 1) >= '2026' GROUP BY 1, 2 ORDER BY 2"
# expect: no rows.

# P5. Nothing else moved: compare with step 0.
dev_ro "SELECT format('db=%s data_edits=%s/%s audit=%s/%s overrides=%s', current_database(), (SELECT count(*) FROM data_edits), (SELECT max(id) FROM data_edits), (SELECT count(*) FROM auth_audit_log), (SELECT max(id) FROM auth_audit_log), (SELECT count(*) FROM data_overrides))"
# expect: data_edits identical to step 0; overrides identical; auth_audit_log +1 with max = N
#         (more only if an unrelated admin sign-in/action happened meanwhile; P2 must still show exactly one retirement row).
```

Record steps 0–4 and P1–P5 here. Then resolve ISSUE-246 and resume ISSUE-237 L4 from §11d A under
its own authorisation.

### 10.1 Live DEV evidence (2026-09-25, operator-run): PASS

The operator ran this and reported the results; Claude recorded them here and did not re-run
anything. Claude had no database or SSH contact.

**Deployed revision:** `4bb23a8f` `fix(maintenance): retire orphaned dev fixture override`.

**Step 1: mandatory pre-mutation DEV backup.**

| Item | Value |
|---|---|
| Dump | `/home/arm/backups/afldb/afldb_dev-20260925-211927.dump` |
| SHA256 | `a269410ff68c87cd9cc6525e7d827f84c757f689f7fad87c0e06cfbb9c0f3676` |
| `pg_restore` archive objects | 1544 |

**Step 0: pre-state.** `db=afldb_dev data_edits=153/245 audit=964/982 overrides=118`.

**Steps 2–4: the tool.**

| Run | Verdict | Retirement audit | Writes | Transaction | Result |
|---|---|---|---|---|---|
| 2. Validate only | WOULD_RETIRE | — | 0 | READ ONLY | PASS |
| 3. `--apply` | RETIRED | `auth_audit_log` 983 | 2 | COMMITTED | PASS |
| 4. `--apply` rerun (idempotence) | ALREADY_RETIRED | `auth_audit_log` 983 (same) | 0 | COMMITTED (no writes) | PASS |

The validate-only run also reported:
- target database `afldb_dev`;
- override `data_overrides` 1;
- natural key `matches` / `2026|R30|2026-12-31|104|103` / `notes`;
- canonical match absent;
- promotion markers 644;
- actor `auth_users` id 4.

**Read-only post-repair checks.**

| Check | Result |
|---|---|
| P1 | `db=afldb_dev id=1 type=matches group=notes active=false admin=4 payload_exact=true created=2026-08-30 10:22:26.717013+10 updated=2026-09-25 21:21:19.053548+10` |
| P2 | `db=afldb_dev audit=983 actor=4 issue=AFLDB-ISSUE-246 override=1 key=2026\|R30\|2026-12-31\|104\|103 prev_active=true new_active=false payload_exact=true same_instant=true` |
| P3 | `db=afldb_dev fixture_matches=0` |
| P4 (ISSUE-237 A4.3, verbatim) | **no rows** |
| P5 | `db=afldb_dev data_edits=153/245 audit=965/983 overrides=118` |

**Reading P5 against step 0:**
- `data_edits` count and max are unchanged (153/245).
- The `data_overrides` count is unchanged (118).
- `auth_audit_log` grew by exactly one row (964 → 965), and its max id advanced 982 → 983, the
  retirement row. No unrelated audit row landed in the window.
- The orphan override was preserved and made inactive. Its payload, author (4) and `created_at`
  are unchanged, and its `updated_at` equals the audit's `at` (P2 `same_instant=true`).
- The canonical fixture match is still absent (P3).
- ISSUE-237 A4.3 is clear (P4).

**Verdict: PASS.** Every §5 desired-final-state condition holds. ISSUE-246 is resolved.

## 11. Optional `code_test_db` rehearsal (proposed; awaiting operator authorisation)

**Useful, but not required for safety.** Every DB-free-unproven assumption fails **closed** on DEV:
a non-matching UPDATE predicate changes 0 rows and refuses before the audit; a readback mismatch
rolls back. Validate-only (step 2) exercises every read statement read-only first.

What a rehearsal would add is real-PostgreSQL proof of five things:
- the jsonb equality predicate in the UPDATE;
- `now()` equality between `updated_at` and `auth_audit_log.at`;
- `FOR UPDATE` inside a read-write transaction;
- postgres.js `Date`/jsonb decoding of the real rows;
- an actual server-side rollback of the UPDATE when the INSERT fails.

The tool itself refuses `code_test_db` by design, so a rehearsal needs a separate,
`code_test_db`-only harness. That harness would seed the fixture, marker and actor rows, run
`executeIssue246(postgresIssue246Db(tx), …)` with only the classifier's database-name fact adapted,
inject an INSERT failure, then tear down and prove zero residue. **Not written, not run.**

## 12. Not authorised by this issue

- no DEV mutation outside §10's authorised run;
- no promotion; no ISSUE-237 L4 continuation;
- no `data_overrides` or `data_edits` DELETE, and no rewrite of any historical audit row;
- no change to ISSUE-237 A4.3;
- no commit, merge or push without separate authorisation.

ISSUE-243's closure is separate (its four live A2 READY results).
