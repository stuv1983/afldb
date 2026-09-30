# AFLDB-ISSUE-253 — Data Editor `deleteMatch` fails on a reconciled database (period-stats read privilege; AFL API Brownlow staging link)

**Status:** Resolved 2026-09-30 on `afldb_test` / `code_test_db` evidence. Uncommitted; awaiting
operator review and integration into the ISSUE-238 line. **Severity:** High (every Data Editor
match deletion failed on any database whose privileges were reconciled). **Opened:** 2026-09-30.
**Area:** Admin / match deletion — `src/db/queries/match-admin.ts` (`deleteMatch`),
`tools/maintenance/privileges.sql`, migration 109.
**Worktree:** `D:\dev\afldb-issue-253`, branch `issue/253-delete-match-runtime-contract`, created
from ISSUE-238 HEAD `d279c8e0` with `git worktree add`, **not** from `main` via
`worktree:bootstrap`. Two reasons: migration numbers 106–108 belong to the ISSUE-238 line, which is
the integration target, and the shared test databases already hold 106–108.

> **Discovered by AFLDB-ISSUE-238 case 72, but not caused by ISSUE-238.** ISSUE-238 Slice 10's
> case 72 drives the real Data Editor `deleteMatch` after a committed Brownlow identity correction.
> Both blockers reproduce with no ISSUE-238 code involved (§2). This issue is about match deletion
> only. It does not touch identity correction, ISSUE-238's Q2 planner, or its acceptance semantics.

> **Migration lineage and promotion dependency (2026-09-30).** This branch was developed from
> `d279c8e0`, which contains neither migration 108 nor 109. Migration 109 is intentionally sequenced
> **after** ISSUE-238's migration 108 (`108_import_reads_data_edits.sql`), so the lineage is
> 107 → 108 (ISSUE-238) → 109 (ISSUE-253). ISSUE-253 must be integrated onto the ISSUE-238 lineage
> before promotion. This original worktree must **not** be promoted independently: that would ship
> 109 without 108. The combined `privileges.sql` reconciliation must preserve both grants:
> ISSUE-238's `GRANT SELECT, INSERT ON data_edits TO afldb_import` and this issue's
> `GRANT SELECT ON player_match_period_stats TO afldb_import`. The functional verdict is unchanged
> (Resolved).

---

## 1. The two blockers

### Defect A — `afldb_import` cannot read `player_match_period_stats`

`deleteMatch` runs as `afldb_import` (`AFLDB_IMPORT_DATABASE_URL`). Its AFLDB-ISSUE-180 pre-check
(`SELECT count(*) … FROM player_match_period_stats WHERE match_id = $1`) needs `SELECT` on that
table, and the role held nothing on it:

- migration 062 created the table without calling `grant_import_write()` or `grant_app_read()`;
- AFLDB-ISSUE-142 **Decision A** (2026-09-06) deliberately kept it OUT of
  `afldb_meta.import_writable_tables`. Registering it would have given `afldb_import`
  UPDATE/DELETE/TRUNCATE for a writer that does not exist. That decision assessed registration
  only, never a read-only grant. ISSUE-238's tracking calls it "ISSUE-141 Decision A"; the decision
  is in fact ISSUE-142's;
- so `privileges.sql`'s import revoke loop reconciled the table to `REVOKE ALL` on every run.

AFLDB-ISSUE-180 (2026-09-15) added the read and recorded "no migration or privilege change was
required". That held only on a database whose ACLs had not been reconciled since. The code contract
and the privilege policy had diverged.

### Defect B — `staging.afl_api_brownlow_vote.match_id` was an un-pre-checked FK

Migration 103 (AFLDB-ISSUE-228 S4) added `staging.afl_api_brownlow_vote.match_id integer REFERENCES
matches(id)`: nullable, NO ACTION. The AFL API Brownlow settle writes it for every settled vote
set. The table post-dates AFLDB-ISSUE-181's "no unhandled foreign key into `matches(id)` remains"
inventory, so `deleteMatch` did not handle it. A match carrying a settled AFL API vote set fell
through to the generic 23503 race-window fallback, which returned a message that misleadingly
advised "Retry the deletion".

A live catalogue census on both test DBs found 13 FKs into `matches(id)`. This is the only one that
`deleteMatch` did not pre-check, clear, or leave to CASCADE / SET NULL.

---

## 2. Independent reproduction (no ISSUE-238 code path)

Every command went through `D:\tmp\issue253\pin-env.mjs`. It pins every DSN to
`127.0.0.1:55432` and one named test DB, poisons the owner and backup DSNs, and prints each
resolved target. Evidence files are in `D:\tmp\issue253\`.

**Pre-state (both DBs, `state-probe.mjs`):**
- 108/108 migrations;
- `afldb_import` on `player_match_period_stats` held SELECT, INSERT, UPDATE, DELETE and TRUNCATE
  all `false`; the table was unregistered, with ACL `{afldb_owner=arwdDxt/afldb_owner}`;
- a direct `SELECT` as `afldb_import` raised **`42501 permission denied for table
  player_match_period_stats`**.

**A, through the real writer.** The unchanged `tests/integration/match-admin-delete.test.ts` ran on
`afldb_test` as `afldb_import` and failed **4 of 5** with `42501`. The only pass was the ISSUE-177
refusal, which returns before the period-stats read. Its `afterAll` then hit `23503` on the ISSUE-180
fixture row and left 4 marker matches plus 1 period-stat row behind. That residue was removed, scoped
by marker, with `suite-residue.mjs --delete` (after: all zero).

**B, through the real writer**, after the Defect-A fix. A throwaway integration test (since deleted)
seeded one fixture match M plus a settled-shape Brownlow projection: payload → spine version →
three 3/2/1 vote rows naming M.
- **Owner-side `DELETE` of M, rolled back:** **`23503`**, constraint
  `afl_api_brownlow_vote_match_id_fkey` on `afl_api_brownlow_vote`.
- **Real `deleteMatch`:** `{ok:false}` carrying the generic "another record still depends on it
  … Retry the deletion" message.
- **After:** M present, 3 links intact, 0 `match_deletion` audits.
- **Residue:** 0.

---

## 3. Defect A fix

- **`tools/maintenance/privileges.sql`:** a new block after the import revoke loop, placed after
  the `player_link_suggestions` block. It is guarded on `to_regclass` and holds exactly
  `GRANT SELECT ON player_match_period_stats TO afldb_import;`. There is no registry row and no
  write.
- **`src/db/migrations/109_import_reads_player_match_period_stats.sql`:** role-guarded; its one
  grant is `GRANT SELECT ON TABLE public.player_match_period_stats TO afldb_import;` (the 068/108
  shape).
- **Tests:**
  - `tests/awards-admin.test.ts`: a new describe pins 109's single grant, its role guard and the
    absence of `grant_import_write`/`grant_app_read`, plus the reconciler's single
    SELECT-only mirror.
  - `tests/integration/privileges.test.ts`: a new case. For `afldb_import` on the table: SELECT
    true; INSERT, UPDATE, DELETE and TRUNCATE false; unregistered; no owned-sequence USAGE or
    UPDATE.
  - The pins encoding the old state were updated honestly:
    - `tests/reference-data.test.ts` §H12 ("needs no new grant" now asserts
      `player_link_match_candidates` is still ungranted and period-stats is SELECT-only);
    - `tests/python/reference_cascade_contract.py`: `REAL_READABLE` now includes period-stats, and
      B2 names only `player_link_match_candidates`.

    The reference loader's cascade guard is unchanged and still fails closed. It now **counts** that
    dependent instead of refusing because it cannot read it, and it still refuses when the dependent
    is populated.
- **Test-fixture consequence.** The ISSUE-181 race-window test's trap trigger was SECURITY INVOKER.
  It fires inside `deleteMatch`'s `afldb_import` transaction and inserts into
  `player_match_period_stats`, so it raised `42501` instead of simulating the race. Defect A had
  masked this. The trap function is now `SECURITY DEFINER SET search_path = public, pg_temp`
  (test-only object). It inserts as the fixture owner, and the genuine 23503 follows.

**Runtime proof.** ACL snapshots (`acl-snapshot2.mjs`, 663 rows):

| Step | `code_test_db` | `afldb_test` |
|---|---|---|
| `db:migrate:*` | applied 109 (108 → 109); the diff is exactly one line: `player_match_period_stats` gains `afldb_import=r` | identical |
| `db:privileges:*` run 1 | exit 0; keeps `afldb_import=r`; the only other line is `data_edits` `afldb_import=ar` → `a` (see §5) | identical |
| `db:privileges:*` run 2 | byte-identical to run 1 (sha `a55b4cf5…`) | byte-identical (sha `4938b34a…`) |

On `afldb_test`, `match-admin-delete` then passed 5/5 (after the trap-fixture fix) and
`privileges.test.ts` passed 39/39.

---

## 4. Defect B contract analysis

1. **What `match_id` means.** It is Option-B resolution enrichment (migration 103's column comment:
   "identity is the provider observation, never the canonical resolution … its absence is expected,
   never a reason to withhold the row"). The row's identity is `(source_id, family,
   external_record_id = provider_match_id, provider_player_id)`, and `match_id` is not part of it.
2. **Who reads it: nobody.** Every reader keys on `provider_match_id` / `provider_player_id`:
   - the settle applier reads the just-written row back through `RETURNING votes`
     (`afl-api-brownlow.ts`);
   - the ISSUE-238 correction's evidence, B4 and Q2 readers (`correct_afl_api_identity.ts`
     `buildBrownlowEvidence`, `providerProjections`);
   - the ISSUE-235 adjudication inventory, which reads `player_id` only.
3. **Who writes it.** Only `projectAflApiBrownlowVoteSet`. It is a keyed upsert whose
   `ON CONFLICT … DO UPDATE SET match_id = EXCLUDED.match_id` **re-points the link on every
   re-projection**. The ISSUE-238 correction already mutates another resolution column of the same
   projection (`player_id`).
4. **What the canonical twin does.** The row is "what this source PROPOSES for
   `brownlow_round_votes`", and `brownlow_round_votes.match_id` is `ON DELETE SET NULL` (migration
   094). By schema design, a canonical Brownlow row survives its match's deletion, detached.
5. **Why this differs from the ISSUE-181 lineup precedent**, even though migration 103 models the
   column's nullability on `afl_api_lineup`. ISSUE-181 refused for lineup on two lineup-specific
   facts: `lineup-store.ts` owns an explicit never-relink invariant, and the current-season importer
   relies on its link. Neither holds here: this writer relinks by design, and no process reads the
   link. ISSUE-177's refusal (`external_current_matches`) rests on reconciliation provenance that
   the importer re-reads; that also does not apply.

**Conclusion (D-253-B).**
- The source observation survives canonical match deletion: the row, its votes, resolved players,
  spine version, payload and projecting batch are all kept.
- Nulling the association is safe. It returns the row to the Option-B "observed, not canonically
  resolved" state its schema admits, and it mirrors `brownlow_round_votes`.
- Deleting the staging row would lose source evidence and is **not** done.
- Refusal is not the documented intent for this table. A permanent refusal would make every match
  carrying a settled AFL API vote set undeletable, and no process exists that could ever clear the
  link.
- No distinct state warranting refusal was found. The Brownlow administration workflow
  (`brownlow_vote_entry_state`, RESTRICT) and curated collateral are still refused earlier.

---

## 5. Defect B fix and acceptance

**Writer change (`match-admin.ts` `deleteMatch`).** The change adds one statement,
`UPDATE staging.afl_api_brownlow_vote SET match_id = NULL WHERE match_id = $M`. It runs:
- **after** every refusal pre-check (Brownlow workflow, special-record collateral, current-season
  staging, period stats, AFL API lineup), so a refused deletion changes nothing;
- **before** the dependent deletes and `DELETE FROM matches`;
- in the same `afldb_import` transaction, so a failed deletion rolls it back.

The `FOR UPDATE` lock that `deleteMatch` takes on M blocks any new FK reference to M, because an
FK check needs `FOR KEY SHARE`. The 23503 backstop comment now names the detached link. The
deletion audit is unchanged: one `data_edits` row, `table_name='matches'`,
`field_group='match_deletion'`, `oldValues {deletedMatchId, season}`, `newValues {}`. The function's
return shape is unchanged. No `projected_at`/`projected_by_batch_id` rewrite; no other Brownlow state
is touched.

**Acceptance (`tests/integration/match-admin-delete.test.ts`, real writer as `afldb_import`,
`afldb_test`).**
- **`seedBrownlowVoteSet()`:** a settled-shape payload, spine version and three 3/2/1 vote rows.
- **Detach-and-delete case (new):**
  1. M exists;
  2. three rows name M;
  3. the real `deleteMatch` runs;
  4. it returns `ok`, and M is gone;
  5. the rows survive, identical except for `match_id`;
  6. `match_id` is NULL;
  7. 0 rows name M, and the spine version is intact;
  8. exactly one `match_deletion` audit with the unchanged shape and note;
  9. an unrelated vote set on another match is byte-identical.
- **Refusal preservation (new):** a match with both a Brownlow set and a current-season staging
  link is refused by ISSUE-177. M survives and all three links still name M.
- **Rollback (extended ISSUE-181 race test):** a Brownlow set on the trap match; the trap's genuine
  23503 fails the deletion; the links still name M.
- **Result:** **7/7, run twice.** Marker-scoped residue was 0 before and after every run.

---

## 6. Validation (2026-09-30)

- **`afldb_test` integration:**
  - `match-admin-delete` 7/7 (×2);
  - `privileges` 39/39;
  - `match-admin-create`, `database` and `admin-special-records` PASS;
  - `admin-match-mutations` (DB-free) PASS. With `privileges` and `match-admin-delete`, that combined
    run was 6 files and 154 tests PASS.
  - `admin-brownlow` 43/44 (needs `--hookTimeout=240000`: its three-season `beforeAll` exceeds 30 s
    over the tunnel). The one failure is **pre-existing** data state: all 320,861 historical
    `brownlow_round_votes` rows on the rebuilt `afldb_test` have `match_id` NULL, while its 16,838
    matches are intact. It is unrelated to deletion.
- **DB-free:**
  - `awards-admin` + `reference-data` + `admin-match-mutations`: 106/107. The one failure is the
    **pre-existing** §H12 list assertion, missing `afl_api_identity_adjudications` from migration
    104; the unmodified base file fails identically (50/51 in the ISSUE-238 worktree).
  - `tests/python/reference_cascade_contract.py`: all scenarios hold.
- **Static gates:**
  - `npx tsc --noEmit -p .`: PASS.
  - ESLint on the five changed TS files: 29 errors, all in `tests/reference-data.test.ts` and all
    **pre-existing** (identical 29 on the unmodified base copy; none in changed lines). The other four
    files are clean.
  - `git diff --check`: PASS.
- **Migrations:** both test DBs at **109/109**. Reconcile is idempotent on both.

**Shared test-DB side effect (expected, temporary).** This branch's `privileges.sql` does not carry
ISSUE-238's uncommitted `GRANT SELECT, INSERT ON data_edits` (migration 108's mirror). The
reconciles here therefore took `data_edits` from `afldb_import=ar` to `a` on both test DBs. The
effects:
- ISSUE-238 correction applies (§8.4 Q2 audit read) fail on these DBs until the **integrated** tree
  runs `db:privileges:test` and `db:privileges:code-test`;
- conversely, ISSUE-238's current reconciler would strip 109's SELECT.

Only the merged `privileges.sql` restores both.

---

## 7. Boundaries (held)

- No ISSUE-238 Q2, planner, harness or acceptance change. ISSUE-238 stays **40/55**; case 72 was
  not rerun.
- `afldb_test` / `code_test_db` only; no DEV or PROD contact.
- The only privilege widening is `SELECT` on `public.player_match_period_stats` for
  `afldb_import`.
- Git: branch and worktree creation only. Nothing is staged or committed. One `git add -N` used for
  `git diff --check` was reverted with `git reset` on the same two paths, leaving the index empty.

## 8. Follow-up

- **Operator.** Review, commit, then integrate into `issue/238-canonical-reattribution`. After
  that:
  1. run `db:privileges:test` and `db:privileges:code-test` from the integrated tree;
  2. rerun ISSUE-238 case 72 from a fresh corrected Brownlow fixture;
  3. then cases 73, 94, 98 and 99.
- **Deployment order (DEV/PROD, with the ISSUE-238 line).** Migration 109 plus
  `npm run db:privileges` restore deletion (Defect A needs no code). Defect B's code change is
  independent of the grant.
- ISSUE-238's case-72 stop note should cite AFLDB-ISSUE-253 at integration.
