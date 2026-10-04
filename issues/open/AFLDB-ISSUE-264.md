# AFLDB-ISSUE-264 — Legacy CSV promotion overwrites Match Sheet-protected `player_match_stats` fields and re-inserts players the Match Sheet removed

## 0. Status

- **Status:** Open. **Implemented (Option A, refusal), uncommitted**, in worktree
  `afldb-issue-264` (branch `issue/264-legacy-csv-authority`) from main `09feda5c`, 2026-10-04.
  Database-free tests, typecheck, lint, the `afldb_test` integration validation (§14.1) and the full
  build pass. **DEV acceptance is outstanding.** The pre-commit review (§14.2) found **F-005 not a
  bypass on any supported path**. **F-002 (lock order) was decided as Option A on 2026-10-04 and is
  implemented and validated (§14.3)**; a settle can still be a deadlock victim (one unit, §14.3).
- ~~**Commit readiness: ON HOLD (operator, 2026-10-04)** pending §14.4.~~ **Hold cleared 2026-10-04
  (§14.5):**
  - The operator decided D-264-9 (morning-window gap accepted, no repair), D-264-10 (corrected test plan)
    and D-264-11 (the settle-victim limitation, accepted as temporary after the recovery trace; follow-up
    AFLDB-ISSUE-265).
  - The final guarded window `run-20261004-211130` passed, and `afldb_test` was restored.
  - **Ready for operator review and commit.**
- **Opened:** 2026-10-03 (operator decision, from ISSUE-258 finding F-258-I1).
- **Severity:** Medium.
- **Area:** legacy file intake / manual authority — `src/lib/ingest/datasets.ts`
  (`playerMatchStats.promoteRow`), `src/lib/acquisition/match-sheet-authority.ts`.
- **Decision:** Option A, refusal, by operator decision on 2026-10-04 (§12, D-264-1..8).
- **Evidence basis:** the defect is from code inspection. **It was not reproduced against a
  database**, on DEV, PROD or `afldb_test`. No submission has been checked for prior occurrence
  (§6). The fix is proven DB-free and on `afldb_test` (§14.1).
- **Record:** the `issues.md` entry of the same ID stays authoritative; this runbook carries the
  detail for a later implementation session.

## 1. Summary

ISSUE-257 made every Match Sheet change durable `data_overrides` authority so that a settle, a fitzRoy
reload and a promotion do not revert it. The legacy CSV intake's `player_match_stats` promotion reads
none of that authority, so a file can:

1. overwrite a field an active `match_sheet` record protects, when the file supplies a value; and
2. re-insert a `(player, match)` row the Match Sheet removed, when the file names that player.

The submission's validation report says nothing about either, and promotion succeeds.

## 2. Evidence (code inspection; paths and lines as in the ISSUE-258 worktree)

- `src/lib/ingest/datasets.ts:833-882` — `playerMatchStats.promoteRow`. `INSERT … ON CONFLICT
  (player_id, match_id) DO UPDATE`. It reads no `data_overrides`. Line 856 sets
  `club_id = EXCLUDED.club_id` unconditionally; lines 857-880 are `COALESCE(EXCLUDED.x,
  player_match_stats.x)` (ISSUE-258), so a supplied value still wins.
- `src/lib/acquisition/match-sheet-authority.ts:35-37` — `PLAYER_MATCH_STATS_ENTITY =
  'player_match_stats'`, `MATCH_SHEET_FIELD_GROUP = 'match_sheet'`, `LINEUP_FIELD_GROUP = 'lineup'`.
  `:35-61` also defines the twelve protected fields and `COUPLED_DISPOSAL_FIELDS` (`:61`).
- `src/lib/acquisition/match-sheet-authority.ts:860-861` — a removal upserts a `lineup` record with
  payload `{ present: false }` and deactivates the `match_sheet` record. `:865` records
  `{ present: true }` for a (re)added player; `:873` records the `match_sheet` payload.
- `src/db/queries/match-sheet.ts:277-304` — the authority writes (upsert, or `is_active = false`), in
  the Match Sheet save's own transaction.
- `src/lib/ingest/datasets.ts:410-445` — `all_australian.promoteRow`, ISSUE-165 D-12: the closest
  existing pattern. It reads `data_overrides` for an active `lifecycle` or `correction` record and
  throws, refusing promotion. Its comment (`:421-427`) records why a refusal and not a replay.

Not in the evidence: any query result. No row, count or timing here comes from a database.

## 3. Execution path

legacy admin upload → dataset `player_match_stats` validation (`datasets.ts`, up to `:831`) →
approval → `promoteRow` (`:833`) → `player_match_stats`.

## 4. Expected invariant

A promotion of a legacy file never silently reverts a human decision recorded as durable authority.
ISSUE-165 D-12 states the same principle for `award_winners`; ISSUE-257 states it for
`player_match_stats`.

## 5. Actual behaviour

- A file that **supplies** a figure overwrites a field an active `match_sheet` record protects. This
  covers any of the twelve Match Sheet fields, and `club_id` too, because the upsert always sets
  `club_id = EXCLUDED.club_id`.
- A file naming a player whom the Match Sheet removed (active `lineup` record, `present: false`)
  re-inserts that `(player, match)` row.
- Neither case appears in the validation report. Promotion succeeds.

## 6. Not examined

- How the next settle or reload treats a protected field this intake has overwritten, or a
  re-inserted row whose `lineup` record says absent.
- Whether any submission has already done this on DEV or PROD. That is a read-only census and needs
  the operator's authorisation (§9, `CLAUDE.md` §9/§11).

## 7. Relationship to ISSUE-258

ISSUE-258 is **resolved**: committed at `e7b57ede`, DEV-accepted 2026-10-04 and closed by `7d02e781`.
Its runbook is `issues/closed/AFLDB-ISSUE-258.md`, and PROD promotion is still outstanding. It stops
a column the file is silent on (absent or blank) from writing, via `COALESCE`. That **narrows** this defect to supplied figures and re-inserted rows.
It does **not** resolve it. ISSUE-258 §12 puts "manual authority or source ownership of rows a
promotion updates" out of its scope, and ISSUE-257 §12 put "the legacy CSV intake's writes to
`player_match_stats`" out of its scope and named ISSUE-258. Neither owns the defect; this issue does.
Ownership was confirmed by a narrow `issues.md` search that found only those two records.

## 8. Options (decided 2026-10-04: Option A; see §12)

Kept as the record of what was weighed. The operator chose Option A; Option B was not taken.

- **Option A — refusal, modelled on `all_australian` D-12.** Refuse at validation and again at
  promotion a row whose `(match, player identity)` carries either an active `lineup` record with
  `present: false`, or an active `match_sheet` record protecting a field the row supplies with a
  different value. Operator resolves it in the Match Sheet before re-approving.
  - Rejected alternative: replaying authority inside the legacy writer. It would be a second,
    divergent implementation, as D-12 recorded.
  - Open question for the decision: whether "supplies a different value" or "supplies any value" for
    a protected field is the refusal test, and how identity is keyed (`<match_key>|<player
    identity>`) from a row that resolves by name.
- **Option B — retirement.** Retire the two legacy datasets under ISSUE-186 (pipeline deprecated;
  retirement Phases B and C deferred without an ID). That would also close this defect, and is a
  larger, separate decision.

## 9. Scope

- **In scope once decided:** `src/lib/ingest/datasets.ts` (`player_match_stats` validation and
  promotion) with focused tests, extending the closest existing suites rather than adding a file by
  default (`tests/ingest-datasets.test.ts`, `tests/integration/datasets.test.ts`).
- **Out of scope:** the ISSUE-258 implementation; `match_results` (no Match Sheet authority covers
  `matches`); any change to the ISSUE-257 authority model.
- Any census or reproduction against a database is user-executed and needs explicit authorisation.

## 10. Cross-references

- **AFLDB-ISSUE-257** — resolved; defines the authority model and put this writer out of scope.
- **AFLDB-ISSUE-258** — resolved (DEV accepted 2026-10-04; PROD promotion outstanding). Origin of
  F-258-I1 (closed runbook `issues/closed/AFLDB-ISSUE-258.md` §17.7). It narrows this issue but does
  not close it. Its R-258-1 (re-validate any legacy submission validated before deployment) also
  covers this change: a submission validated before ISSUE-264 deploys carries no authority verdict.
  Promotion still re-checks it under the lock (D-264-8).
- **AFLDB-ISSUE-186** — legacy pipeline deprecation and deferred retirement; related, not an owner.
- **AFLDB-ISSUE-165 D-12** — the refusal pattern.

## 11. Next action

1. (Done 2026-10-04, §14.1.)
2. (F-002 decided and implemented, §14.3.) ~~On hold (§14.4).~~ Hold cleared (§14.5: D-264-9..11,
   final window PASS). The operator reviews and commits the local change. The commit message carries no
   attribution or `Co-Authored-By` trailer. F-005 needs no decision to commit. The settle-victim follow-up
   is AFLDB-ISSUE-265 and does not block the commit.
3. `merge:ready`, merge, DEV deploy (application only, `-SkipMigrate`; §14.4.4) and DEV acceptance. Then
   decide PROD, together with ISSUE-258's outstanding PROD promotion.

## 12. Operator decisions (2026-10-04)

- **D-264-1 — Option A, refusal.** No legacy dataset is retired and no authority is replayed.
- **D-264-2** — refuse a supplied value that differs from active protected authority.
- **D-264-3** — an identical protected value passes.
- **D-264-4** — an absent or blank optional value keeps its ISSUE-258 preservation semantics, so it
  never conflicts.
- **D-264-5** — an active `lineup` record with `present: false` refuses reinsertion.
- **D-264-6** — active addition authority is preserved. Incompatible club or presence writes refuse.
- **D-264-7** — indeterminate, ambiguous or unreadable relevant authority fails closed.
- **D-264-8** — keys resolve through the existing ISSUE-257 identity and continuity helpers. There is
  no second identity or authority implementation. Authority is checked at validation for feedback,
  then re-checked inside promotion's transaction while the match lock is held, in the existing lock
  order. A refusal rolls back the whole submission's canonical writes and leaves authority unchanged.

Scope boundaries set with the decision: no schema or authority-model change, no historical census,
no database rebuild, no DEV or PROD contact. Database tests and the full build are operator-run.
Fixtures are synthetic only.

## 13. Implementation (uncommitted)

- **The authority is the settle's own reader.** `buildPlayerMatchStatsAuthority`
  (`src/lib/acquisition/manual-authority.ts`) decodes keys, interprets records, reverse-resolves
  identities through `resolveStoredIdentityToPlayer` with the continuity contract, checks the
  protected club is home or away, and marks a match indeterminate on any doubt. Two changes, both
  additive:
  - each pair also carries the parsed active payload (`fields`) and the protected club id
    (`clubId`), so a value can be compared rather than only a column named;
  - `loadPlayerMatchStatsAuthority` is exported, with an injectable continuity load. The Next runtime
    reads the contract from `process.cwd()` (F-PR-02, the Match Sheet's own path, now exported from
    `src/db/queries/match-sheet.ts` as `CONTINUITY_CONTRACT_SEGMENTS`). The settle's call is unchanged.
- **The decision**, `legacyStatsAuthorityRefusal` (`src/lib/ingest/datasets.ts`), is pure. It runs
  against the effective write set of `promoteRow`:
  - `club_id` is always written, so a protected `club_slug` must match;
  - every other column writes only when supplied, so absent or blank never conflicts;
  - a supplied protected value must be equal. Each supplied member of the coupled
    kicks/handballs/disposals unit is compared;
  - a removal refuses outright;
  - an addition with no protected club, or (at promotion) no row, is an unexpected state and refuses;
  - `allIndeterminate`, or the row's match marked indeterminate, refuses.
- **Validation** (`validateRow`) asks a `matchSheetAuthority` reader that the pipeline supplies.
  `afldb_auth` cannot read `data_overrides` or `external_identities`, so
  `validateSubmission` reads the authority through a short-lived import-role connection inside
  `BEGIN READ ONLY`, once per season, only when asked. Validators receive the answer, not the
  connection. A missing reader or an unreadable answer is a row error. This also applies to the
  e-mail intake route, which only stages and validates.
- **Promotion** has a new optional `DatasetSpec.preparePromotion` hook. The pipeline calls it first
  inside the promotion savepoint, before `import_batches` or any canonical write. For
  `player_match_stats` the hook:
  - locks `matches` `FOR UPDATE` in ascending id order. `canonical-apply` also orders by id when it
    locks more than one match (a rekey), but takes `FOR SHARE` otherwise; the Match Sheet save and
    Return to source take a `FOR UPDATE` on the match before they write authority. The `FOR UPDATE`
    strength and its interaction with other writers are F-002 (§14.2);
  - reads the authority per season of the match key;
  - reads the matches' existing rows (for the addition check only);
  - checks every row and throws one error naming every conflicting row (the first ten).
  The savepoint then rolls back and the submission is marked `failed`, as the D-12 refusal does.
  `promoteRow` is unchanged except for a comment. Its `DO UPDATE` never sets `source_id`, which keeps
  an addition's ownership.

Files: `src/lib/ingest/datasets.ts`, `src/lib/ingest/pipeline.ts`,
`src/lib/acquisition/manual-authority.ts`, `src/db/queries/match-sheet.ts` (export only),
`tests/ingest-datasets.test.ts`, `tests/integration/match-results-promotion.test.ts`.

## 14. Validation

**Done (2026-10-04, Windows worktree, database-free):**
- `tests/ingest-datasets.test.ts` 56/56. The new ISSUE-264 block covers conflicting and identical
  values; absent, blank and explicit not-recorded cells; jumper text; the mandatory club; the coupled
  unit; removals; additions (including no club, and a missing row at promotion); inactive records,
  another player and another season; six match-level and two table-level indeterminate cases; an
  unreadable or missing reader; lock-first ordering with ascending ids and no write; authority
  recorded after validation; and whole-submission refusal.
- `tests/current-season-import.test.ts` + `tests/match-sheet.test.ts` 389 passed, 4 skipped. Those
  four are the existing Python/sh environment gates.
- `npm run typecheck` clean; `eslint` clean on every changed file.

**Proven on `afldb_test` (2026-10-04, §14.1; originally prepared as operator-run):** the nested `AFLDB-ISSUE-264` block in
`tests/integration/match-results-promotion.test.ts`. It uses synthetic players, synthetic AFL Tables
identities and synthetic `data_overrides` records on fixture-season matches R258X and R258Y, all
removed afterwards. It refuses to run unless migration 110 is applied, and proves refusal end to end,
including authority recorded between validation and promotion: the submission is `failed`, neither
row lands, and the records are byte-identical.

**Operator runner (prepared 2026-10-04, outside the repository, not tracked):**
`D:\tmp\issue264\Invoke-Issue264Validation.ps1` with helper `D:\tmp\issue264\issue264-db-probe.mjs`.
It is the ISSUE-258 runner (`issues/closed/AFLDB-ISSUE-258.md` §17.9, run 4 PASS) with the same
steps: environment isolation, derived `afldb_test` DSNs at the tunnel endpoint, read-only target
proof for owner/import/auth/app, baseline, then the three suites and `npm run build`, each followed
by a fingerprint and residue check. Two changes:
- the ISSUE-264 fixtures are excluded from the historical fingerprints (`AFLDB-ISSUE-264 ` players,
  `players/I/Issue264_` identities, `player_match_stats` records keyed `2073|…`), and a new
  `external_identities` fingerprint is added;
- residue counts are added for those identities and records, and both must return to 0.

Checked locally with no database: `node --check` and a PowerShell parse, both clean. The session did
not read the connection settings. The worktree has no `.env`, as the runner requires, and its
`node_modules` is a junction to the main checkout (identical lockfile).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue264\Invoke-Issue264Validation.ps1 -TunnelHost 127.0.0.1 -TunnelPort 55432
```

Options and evidence are as for ISSUE-258: `-BuildRole owner`, `-SkipBuild`; evidence in
`D:\tmp\issue264\run-<stamp>\`. Required for acceptance:
- `match-results-promotion` passes with every ISSUE-185, ISSUE-258 and ISSUE-264 case, and both
  `afterAll` hooks;
- `datasets` and `submission-promotion` pass;
- every post-step check is `clean`;
- `npm run build` exits 0.

### 14.1 `afldb_test` validation window (2026-10-04, agent-run, operator-authorised)

Evidence: `D:\tmp\issue264\run-20261004-094838\` (`summary.txt`, one log per step, `capture.json`,
`baseline.json`). The earlier operator run `run-20261004-093719` had skipped the seven cases because
`afldb_test` lacked migration 110 and its teardown then failed on an undefined `matchX.key`.

**Test lifecycle fix.** The ISSUE-264 block now records what its setup actually created (match keys,
identity player ids) and its `afterAll` removes only those; an early setup failure leaves nothing to
clean and no second error masks the first. The enclosing ISSUE-258 `afterAll` compares the baseline
fingerprint only if one was taken. No case was skipped and no assertion weakened.

**Window** (runner `D:\tmp\issue264\Invoke-Issue264Window.ps1`, helper `issue264-window.mjs`; secret-safe,
untracked): every role proved on `afldb_test` at 127.0.0.1:55432, one server, intended roles; zero other
sessions, locks or prepared transactions; 109 applied and exactly 110 pending (the repository runner's
`--status --target test` agreed); State A; zero `player_match_stats` authority rows. Captured the original
ledger (109 rows), CHECK definition (13 literals), comment and 92 `data_overrides` rows. Applied only
110 with `tools/db/migrate.ts --target test` (218 ms). Verified State B (ledger = capture + 110, CHECK =
captured literals + `player_match_stats`, 110's comment) before any test.

**Results (State B).**
- `match-results-promotion` 17/17 passed, 0 skipped: ISSUE-185, ISSUE-258 and all seven ISSUE-264 cases,
  and both `afterAll` hooks.
- `datasets` 16/16, `submission-promotion` 7/7.
- Settle coverage of the shared authority reader: `settle-afltables` "Durable Match Sheet authority through
  the settle" 11 passed (rest filtered), `settle-afl-api` "Match Sheet authority over an afl_api-owned row
  survives a re-settle" 1 passed.
- `npm run build` with `DATABASE_URL` as `afldb_app` on `afldb_test`: exit 0.
- A fingerprint and residue census after every step: clean.

**Restore.** With zero authority rows (active or inactive) one guarded transaction under ACCESS EXCLUSIVE
re-proved isolation and State B, re-added the captured CHECK, restored the captured comment, deleted the
single 110 ledger row, re-verified against the capture inside the transaction, then committed. A
read-only verification and a final census followed. **`afldb_test` is at its original schema: ledger 109
rows, original CHECK and comment, zero `player_match_stats` authority rows.**

**Residue (itemised).** Not byte-identical, by design: (a) append-only `import_batches` the suites'
promotions create (`admin-upload`): 23 in this window (`match_results` 11, `player_bio` 2,
`player_match_stats` 10), on top of 14 from the earlier run `093719` (37 since the first baseline);
(b) two fixture `auth_users` and the `sports_data_lab` source row, retained by the existing suites'
convention. Every other historical fingerprint (matches, player_match_stats, players, external
identities, seasons, clubs, organizations, `data_overrides`, submissions, sources, auth users) is
identical to the first baseline. No fixture residue.

**Independent review** (afldb-reviewer, read-only; it reported no CRIT/HIGH and graded F-002 LOW; the
pre-commit review in §14.2 regrades F-002 to MED). Confirmed: authority recorded after
validation cannot bypass promotion (the hook runs first in the savepoint; the authority read follows the
`matches ... ORDER BY id FOR UPDATE` lock, and both authority writers take the same match lock before
writing); a refusal writes nothing and the submission ends `failed`; locks are one ascending statement;
the read-only import connection closes in `finally` on success, refusal and error (email intake shares
`validateSubmission`); the shared authority reader change is additive (the settle call is unchanged).
- **F-001 LOW, fixed:** the promotion-time message said "re-validate and re-approve", but a `failed`
  submission can only be promoted again. It now says to resolve in the Match Sheet editor and promote
  again, or upload a corrected file.
- **F-002 MED, RESOLVED by Option A (§14.3; this entry is the finding as first recorded):** a `player_match_stats` promotion locks
  matches ascending while a concurrent `match_results` promotion upserts them in file order, and a
  settle takes match locks in feed order. A deadlock rolls back the victim only; the other transaction
  may commit. The earlier "accepted" and "admin promotions are rare and serial" had no recorded basis.
- **F-003 INFO:** the file's match locks are held for the whole promotion, so a Match Sheet save on those
  matches meets its 5 s lock timeout and shows the retryable refusal.
- **F-004 INFO:** validation (and e-mail intake) now needs `AFLDB_IMPORT_DATABASE_URL` in the Next
  runtime; absent, every stats row errors (fail closed). Promotion already required it.
- **F-005 INFO, not a bypass on any supported path (traced in §14.2):** the promotion check does not
  consult `unresolvedMatchKeys`. A key in that set equals no existing match's key, so it cannot be the
  key of a match this CSV resolves. It matters only for a key stranded by a change made outside the
  supported rekey, deletion and promotion paths, which is also the settle's blind spot.

**Pre-existing, unrelated DB-free failures on Windows (3).** `honours-lifecycle-public-contract` (2) and
`correct-afl-api-identity-cli` "refusal path renders through formatManifestProblems" (1) are CRLF
source-text checks over files this change does not touch (`awards.ts`, `grid-solver.ts`,
`correct_afl_api_identity.ts`: index LF, worktree CRLF, zero diff).

### 14.2 Pre-commit review of F-002 and F-005 (2026-10-04, agent-run, operator-authorised)

Scope: repository inspection, document edits, read-only Git and focused DB-free tests. No database,
DEV or PROD contact, no staging or commit, no schema change. Nothing below was run against PostgreSQL.

#### F-002 — match lock order (MED; regraded from LOW; RESOLVED by Option A, see §14.3)

**Transaction outcome.** When PostgreSQL detects a deadlock it aborts one participant, the one whose
deadlock check fires first (normally the transaction that began waiting first, not a random one). The
victim rolls back and the other transaction may commit. For this hook the victim's submission ends
`failed` (the savepoint is rolled back, the status write follows) and can be promoted again; nothing
lands. If the other participant is a settle that is chosen as victim, **CORRECTED in §14.3:** the
unit it was applying rolls back to its savepoint and the run continues (it is not a whole-run
rollback; that is the Match Sheet save's property). The original sentence said the run rolled back whole.

**This change introduces the conflict.** Before it, a `player_match_stats` promotion only wrote
`player_match_stats` rows, whose foreign key takes `FOR KEY SHARE` on the referenced match (on insert). That does not conflict
with the `FOR NO KEY UPDATE` that `match_results.promoteRow`'s `ON CONFLICT DO UPDATE` takes (it never
updates `match_key`), so the two never waited on each other. The new `matches … ORDER BY id FOR UPDATE`
(`preparePromotion`) conflicts with both. Participants that now meet it:

| Other transaction | Match lock order | Cycle with this hook | Victim cost |
|---|---|---|---|
| `match_results` promotion | file order (`promoteRow` per row) | yes, when two promotions share two matches in different orders | one submission `failed`, retry works |
| AFL Tables / AFL API settle | feed order, one transaction per run, locks held to commit (`FOR SHARE` for a stats unit; `NO KEY UPDATE` or `FOR UPDATE` when it writes or rekeys `matches`) | yes, when the hook's ascending set and the unit order cross | if the settle loses inside a unit: that unit rolls back to its savepoint and one `canonical_apply_failed` finding is opened; the run continues (§14.3 correction) |
| another `player_match_stats` promotion | ascending id | no | none |
| Match Sheet save, Return to source | one match, `FOR UPDATE`, 5 s `lock_timeout` | no cycle on matches alone; it times out with the retryable refusal (F-003) | none |
| `canonical-apply` rekey | ascending id | no | none |

The hook also has no `lock_timeout`: while a settle holds a match, a promotion request waits for the
rest of that run. The recorded basis for "admin promotions are rare and serial" does not exist, so the
LOW grade and the word "accepted" are withdrawn. MED matches how F-S4-01 graded the same shape.

**Proposed fix (not applied; operator decides).**
1. `match_results` gains a `preparePromotion` that derives each row's `matchResultsKey` and locks the
   existing matches `WHERE match_key = ANY(...) ORDER BY id FOR NO KEY UPDATE` before the first upsert
   (the strength the upsert takes anyway). Both legacy writers then acquire match locks in one
   ascending-id order, and rows that insert a new match have nothing to lock. This is the smallest
   change that removes the legacy-writer cycle. It also replaces the "registered for
   `player_match_stats` only" test assertion.
2. The stats hook takes `FOR SHARE` instead of `FOR UPDATE`. It is sufficient: every writer of
   authority or of the match key (Match Sheet, Return to source, rekey carry, `deleteMatch`) takes a
   `FOR UPDATE` or `NO KEY UPDATE`, which conflicts with `FOR SHARE`, so the authority read stays valid
   to commit. It is the strength `canonical-apply` takes for a stats unit, so it no longer conflicts with
   a settle's share locks or with another stats promotion.
3. The settle's unit order is not changed here (outside this issue). The residual is a settle that
   writes or rekeys a `matches` row the promotion has share-locked, in a crossing order.
   Optional: `SET LOCAL lock_timeout = '5s'` in the hook, as the Match Sheet does, so a promotion fails
   fast with a retryable message instead of waiting behind a settle.

**Decision options.** (A) apply 1 + 2 with the test below; (B) apply 2 only and record the
`match_results` cycle; (C) keep `FOR UPDATE` and record all of it. Commit needs one of them recorded.

**Meaningful concurrency test (the design as proposed in §14.2; written and executed in §14.3, which also
replaces its pg_stat_activity polling with `pg_blocking_pids`).** In the
`afldb_test` integration suite, two import-role connections and two fixture matches A < B (A created
first, so its id is lower):
- *Characterisation of today's behaviour:* connection 1 opens a transaction and updates B then A (a
  `match_results` file ordered B, A), pausing after B. Connection 2 runs the stats hook's lock statement
  for A and B. Poll `pg_stat_activity` (`wait_event_type = 'Lock'`) until connection 2 is waiting, then let
  connection 1 update A. Assert with `Promise.allSettled` that exactly one transaction rejects with
  SQLSTATE `40P01`, the other completes, and the survivor's writes are present and the victim's absent.
- *After fix 1:* connection 1 runs `match_results.preparePromotion` first (A, B ascending). Connection 2
  blocks on A until connection 1 commits. Assert no `40P01`, both commit, and the order is serial.
- Both transactions set a `lock_timeout` as a hang guard; the fixtures are removed in `afterAll`.
- DB-free companion: pin the shape of the `match_results` lock statement (`ORDER BY id`, `FOR NO KEY
  UPDATE`, issued before any `INSERT INTO matches`) the way the stats hook's lock order is already pinned.

#### F-005 — `unresolvedMatchKeys` (INFO; not a bypass on any supported path)

**What is consulted.** Validation and promotion use `legacyStatsAuthorityRefusal`, which reads
`allIndeterminate`, `indeterminateMatchIds` and `byPair`. It does not read `unresolvedMatchKeys`. The
settle reads that set only for a unit whose own `match_key` is in it (the Slice 4 case of a settle that
inserts a match before its player rows), a case this writer does not have: `resolveMatch` returns an
existing match by id.

**Why a stranded key cannot normally protect a row this CSV writes.** `loadPlayerMatchStatsAuthority`
looks matches up by exact `match_key = ANY(<record keys>)`. A record whose key finds a match resolves
onto that match (it lands in `byPair` or marks the match in `indeterminateMatchIds`) and is checked.
A key lands in `unresolvedMatchKeys` only when no match has that key. The match a CSV row resolves
therefore carries a key that is not in the set. Such a record could matter only as a *former* key of
that same match.

| Path | Result |
|---|---|
| Rekey in the settle (`canonical-apply`) and `repair-match-rekeys` | `carryMatchOverrides` moves each active record to `<new key>\|<identity>` in the same savepoint, before the key changes. An active record already at the new key, or an identity that cannot be re-encoded, refuses the rekey. Nothing is stranded. |
| `deleteMatch` | refuses while any active `player_match_stats` record exists (D-257-5); inactive records are not loaded. |
| `match_results` promotion | upserts by `match_key` and never updates it; it cannot rekey or delete. |
| Match Sheet save, editor | neither changes `match_key`. |
| Rebuild and promotion | the A4.4 gate and the `pms_preflight` replay refuse an active record that resolves to no match, before the swap. |
| Stale submission, authority recorded after validation | the hook reads the current authority under the match lock and refuses (existing tests, and the integration case "refuses authority recorded after validation"). |
| Stale submission, match rekeyed after validation | the id is unchanged and the authority was carried, so it refuses (new integration case, prepared). |
| Stale submission, match deleted after validation | `matches.length !== matchIds.length` refuses before any authority read (new DB-free test). |
| Malformed `resolved` ids (zero, negative, fractional, text, null) | refuse before any lock or read (new DB-free tests). A boolean or array would pass `isPositiveInt` (it uses `Number()`); only `validateSubmission` writes `resolved`, as numbers, so none is reachable, and the driver's binding of such a value to an integer column was not exercised here. |
| Unreadable record on the row's own match, or an identity resolving to nobody or two players | marks that match; every row on it refuses. Other matches are unaffected (new DB-free test). |
| Undecodable key anywhere, or unreadable continuity contract | `allIndeterminate`: every row refuses. Deliberately coarse: the key names no season or match, so it cannot be shown to be unrelated. Same as the settle. |
| Unrelated unresolved record (readable or not) for a key no match carries | does not refuse (new DB-free test). Nothing it protects exists. |

**Residual.** Authority stranded under a former key of a live match requires a key change outside every
path above (hand-written SQL or tooling that updates `matches.match_key` without carrying). The CSV
writer would then not see it. That is the same blind spot as the settle and as the CSV writer before
this change, and no supported operation creates the state. It is not a blocker. If the operator wants it
closed anyway, the scoped hardening is: refuse a row when an active, authority-bearing unresolved key
shares the row's season and its unordered club pair (parsed from the five-part key), and only then.
That blocks no unrelated match in a healthy database, because the set is empty there. It would
over-refuse a re-played fixture only while such a record exists. Recommendation: do not add it without
evidence of the out-of-band change.

#### Tests

- DB-free: `tests/ingest-datasets.test.ts` 68/68 (was 56): +12 cases for F-005 (unrelated unresolved
  keys, per-match marking, the undecodable key, the carried key resolving to the same pair, six
  malformed ids, the deleted match).
- Prepared in §14.2, **executed and passing in the §14.3 windows**: `tests/integration/match-results-promotion.test.ts`, new case
  "still refuses a stale submission after a rekey carries the authority to the new key". It adds a third
  fixture match `R258Z` (removed by the enclosing `afterAll`; its records by the block's own
  `createdMatchKeys`, which now includes the rekeyed key). The guarded runner should report 18 cases
  in that file. Not type-checked in this pass (no typecheck command was authorised).
- Verification for the operator, in order: `npm run typecheck`, then the guarded `afldb_test` runner.
  (Superseded: run by the agent on 2026-10-04 under the authorisation in §14.3.)

### 14.3 F-002 decided: Option A implemented and validated (2026-10-04, agent-run, operator-authorised)

**Decision.** The operator authorised Option A with a transaction-local 5 s `lock_timeout` for the
legacy promotion preparation hooks. F-005 stays a documented limitation (§14.2); arbitrary out-of-band
SQL is not detected. No staging, commit, push, deployment, DEV/PROD access, rebuild or change to settle
ordering was made.

**Implemented** (`src/lib/ingest/datasets.ts`):
- `match_results.preparePromotion` (new): derives each row's `matchResultsKey` and locks the existing
  target matches `WHERE match_key = ANY(..) ORDER BY id FOR NO KEY UPDATE` in one statement before the
  first upsert. That is the strength the upsert's `ON CONFLICT DO UPDATE` takes anyway (it never changes
  `match_key`), so nothing is upgraded later. A row that inserts a new match has nothing to lock.
- `player_match_stats.preparePromotion`: `FOR UPDATE` -> `FOR SHARE`, still ascending id, still the first
  statement, authority recheck unchanged.
- `withLegacyLockTimeout`: both hooks run their lock acquisition and checks under
  `set_config('lock_timeout', '5s', true)`. It is transaction-local (it cannot outlive the promotion
  transaction or leak through a pooled connection), restored to the previous value on success so the bound
  does not apply to the row writes that follow, and reverted by the pipeline's savepoint rollback on
  failure. SQLSTATE `55P03` (timeout) and `40P01` (deadlock victim) inside the hook become one retryable
  message (`LEGACY_PROMOTION_LOCK_REFUSAL`, original error kept as `cause`); any other error, including a
  real authority refusal, passes through. The submission ends `failed` and can be promoted again.
- The `match_results` hook refuses a row with no resolved season, clubs, round or date before any lock.

**Does FOR SHARE block every supported authority and key writer?** Yes, by the code and by test. Each
takes a lock that conflicts with `FOR SHARE` on the `matches` row before it writes:

| Writer | Lock on the match row before writing | Proven blocked by the held hook |
|---|---|---|
| `saveMatchSheet` | `FOR UPDATE` (`match-sheet.ts`), then pms rows, then `data_overrides` | yes, real writer |
| `returnMatchSheetToSource` | `FOR UPDATE` | yes, real writer |
| `deleteMatch` | `FOR UPDATE` | yes, real writer |
| rekey (`canonical-apply` via `lockUnitMatchRows`, `repair-match-rekeys` via `findRetiredMatchIdentities(.., true)`) then `carryMatchOverrides` + key UPDATE | `FOR UPDATE` on the retired row(s), ascending, before the carry | yes: lock, carry and key UPDATE as those callers run them |
| any other `UPDATE matches` (Data Editor `applyMatchEdit`, score/detail edits) | `FOR NO KEY UPDATE` | yes, plain UPDATE |

No source writer of `data_overrides` with `entity_type = 'player_match_stats'` exists besides the Match
Sheet and the rekey carry (grep over `src/` and `tools/`; the generic `data-edits` upsert writes only
`players`/`matches`). There are no triggers on `matches`, `player_match_stats` or `data_overrides` (the
only trigger is `match_coaches_club_in_match_trg`). `FOR SHARE` does not conflict with readers, with the
`FOR KEY SHARE` an insert's foreign key takes, with a settle's `FOR SHARE` for a stats unit, or with
another stats promotion (tested).

**Lock upgrades and reversed order after the hooks.** None found. The `player_match_stats` upsert's
foreign key takes `FOR KEY SHARE` on a row already held `FOR SHARE`; the `match_results` upsert is
`FOR NO KEY UPDATE` on a row already held `FOR NO KEY UPDATE`; `import_batches` and `data_submissions` are
the promotion's own rows. Both hooks lock in ascending id in one statement (a `LockRows` over a `Sort`),
which the integration case below shows directly: while both writers queue at the lowest match the later
match can still be locked `NOWAIT`.

**Concurrency evidence** (`tests/integration/match-results-promotion.test.ts`, block
"F-002: match lock order and bounded waits", 14 cases; every ordering forced with side transactions and
`pg_blocking_pids`, none raced):
1. Characterisation: an unordered `match_results` writer (B then A, as before this change) against the stats
   hook deadlocks: exactly one participant gets `40P01`, the other commits.
2. After the change, `match_results` (file order B, A) and a stats promotion both queue at the lowest held
   match without holding the later one, then both finish; no deadlock.
3. `FOR SHARE` leaves a plain read and a second stats promotion unblocked.
4. The held hook blocks, until it finishes: the Match Sheet save and Return to source, an `UPDATE` of the
   match row, a rekey (carry plus key change), `deleteMatch`. Each then completes successfully.
5. Authority changes during a promotion: when the Match Sheet save queues first it wins, commits its
   authority, and the promotion then refuses with the usual conflict message and writes nothing; when the
   promotion holds the match first, the queued save refuses as stale and records no authority.
6. Bounded wait: with a match held, both legacy promotions fail after about 5 s (not before 4.5 s) with the
   retryable message, the submissions are `failed` with that text, nothing is written, and re-promoting
   succeeds.
7. The timeout is transaction-local: restored inside the same transaction after the hook, and absent on the
   same pooled connection afterwards, on both the success and the timed-out path.
8. Settle interaction (settle emulated at the lock-statement level: the statements `lockUnitMatchRows` and a
   unit's row writes issue; its own coverage stays in `settle-afltables.test.ts`). For each legacy writer a
   settle that already holds the later match and then asks for the earlier one closes a cycle with the
   hook's ascending acquisition. The promotion began waiting first, so it is the victim (after about 1 s,
   well under the 5 s timeout) and gets the retryable message; nothing is written; the settle survives; a
   retry succeeds. Separately, when the settle began waiting first, the **settle is the victim** (below).
DB-free: `tests/ingest-datasets.test.ts` 81/81 (was 68): lock shape, ordering, timeout scope and restore,
`55P03`/`40P01` mapping and pass-through for both hooks, and the malformed-row guards.

**Rekey and settle conflicts do not disappear.** The shared ascending order removes the cycle between the
two legacy writers, between either of them and a rekey's single ascending lock statement, and between either
of them and the Match Sheet. It does not remove cycles with a settle that holds match locks for its whole run
and takes them in feed order, because the settle's order is unchanged (out of scope, per the decision). A
cycle can still make the settle the deadlock victim: the promotion holds its matches to commit while it still
upserts rows, and if the settle began waiting for one of those matches before the promotion reached a row the
settle holds, the settle's deadlock check fires first (case "characterises that the settle can still be the
deadlock victim"; the promotion then finishes).
- **Correction to §14.2:** the cost to a settle victim is not a whole-run rollback. `canonical-apply` rolls the
  failing unit back to its savepoint (`canonical-apply.ts` ~1267-1291) and the settle opens one
  `canonical_apply_failed` finding per target and continues (`settle-afltables.ts` ~2544-2573). The cost is
  one unit in the exception queue for operator attention, not a lost run. This was found in the independent
  review and checked against the code; the earlier "rolls back whole" wording (§14.2, the CHANGELOG) was wrong.
- This exposure is **new relative to main**: main took no match locks in either hook, so a settle's write to a
  match never waited on a promotion. It is reported, not hidden. **Whether it is acceptable is an operator
  decision, pending (§14.4.3).** It is not recorded as accepted.

**Remaining hazards (the review graded none CRIT or HIGH; whether any blocks commit is for the operator,
§14.4.3).**
- `player_match_stats` row locks. `FOR SHARE` is compatible with another stats promotion and a settle's share
  lock, so two stats promotions sharing two or more (player, match) pairs in opposite file order, or a
  promotion and a settle on one match's rows, can still deadlock on the row locks after about 1 s (raw
  `40P01` in the submission's error; `failed`, re-promotable). This is identical to main (no hook at all) and
  `FOR UPDATE` would have prevented the two-promotion case. The settle-versus-promotion shape is characterised
  above; the two-promotion shape is reasoned, **not run**.
- The 5 s bound covers the hooks only. A promotion waiting behind a settle on a `player_match_stats` row after
  its hook waits unbounded, as on main. A `55P03` from a plain read inside `readMatchSheetAuthority` would be
  reported as a non-retryable read failure (message quality only).
- Two `match_results` promotions inserting the same new match, and a match inserted between the hook's read
  and the upsert, are not covered by a lock (unique-index wait, unchanged from main).
- A re-pointed `external_identities` row is not serialised with the hook (identity corrections do not take
  the match lock). Not an authority or key writer; the settle has the same property. No supported path found
  that does this concurrently with a promotion; not tested.
- A Match Sheet save on a match in a file waits for the promotion, up to its own 5 s, then shows its retryable
  refusal (F-003). The `match_results` hook holds all of a file's existing matches from the start rather than
  progressively; same set, same release point.
- F-005 stays as in §14.2 (documented limitation; out-of-band SQL is not detected).

**Independent review** (afldb-reviewer, read-only, 2026-10-04): no CRIT or HIGH. It confirmed the writer
enumeration and the absence of upgrades or reversed order, the timeout scoping, and the no-trigger finding.
Its LOW/INFO items: the §14.2 victim-cost correction above (applied); the rekey case originally carried
before taking any match lock (fixed: it now locks `FOR UPDATE` first, as the real callers do); the guard
message now names round and date (fixed); the three hazards above (reported).

**Validation (afldb_test, evidence under `D:\tmp\issue264\`).** The guarded runner proved every role on
`afldb_test` at 127.0.0.1:55432 before any write, applied only migration 110 with the repository runner,
verified State B, ran the suites, ran the production build as `afldb_app`, then restored the captured schema
(ledger 109 rows, original CHECK and comment, zero authority rows) and verified it against the capture.
- `run-20261004-195300`: all suites passed (32/32, 16/16, 7/7, 11, 1) and the schema was restored, but the
  census stopped the run before the build. Cause, shown with a read-only query and explained: the census
  hashed `club_seasons` including its identity `id`, and `settle-afl-api.test.ts` (an existing suite that
  works on the real season 2026) delete-and-reinserts that season's two rows in its own setup and
  teardown, re-issuing ids 3204-3205; every other season's ids are one contiguous original run. The census
  never fingerprinted `club_seasons` before this change, so earlier windows could not see it. The fingerprint
  is now value-level (without the identity id) for every season but 2073. Season 2026 is the only season
  whose ids changed; its values are compared from the next baseline onward (no pre-window value hash exists).
  **Superseded by §14.4.1**, which reconstructs this window's id-inclusive fingerprints and finds that the
  season-2026 rows are suite residue, not historical data.
- `run-20261004-200132`: PASS (before the review fixes).
- `run-20261004-202018`: **PASS on the final tree.** `match-results-promotion` 32/32 (every ISSUE-185,
  ISSUE-258 and ISSUE-264 case, the rekey case, and the 14 F-002 cases), `datasets` 16/16,
  `submission-promotion` 7/7, `settle-afltables` Match Sheet authority block 11 passed (65 filtered out),
  `settle-afl-api` 1 passed (71 filtered out), `npm run build` exit 0, a clean census after every step,
  rollback committed and verified, final census clean (historical fingerprints equal the baseline for
  matches, player_match_stats, players, external identities, seasons, clubs, organizations, `club_seasons`,
  `data_edits`, `player_clubs`, `player_career_stats`, `player_season_stats`, `data_overrides`, submissions,
  sources and auth users; no fixture residue).
- Typecheck and eslint clean on every changed source and test file; DB-free `ingest-datasets` 81/81,
  `match-sheet` + `current-season-import` unchanged (469 passed, 4 environment-skipped with it).

**Retained test records (itemised).** Not byte-identical to the first baseline of this session, by design:
(a) append-only `import_batches` (`admin-upload`) the suites' promotions create: 36 per full window
(`match_results` 15, `player_bio` 2, `player_match_stats` 19), three full windows (`195300`, `200132`,
`202018`) = 108 since the session's first baseline (43/4/22 -> 88/10/79); (b) the two fixture
`auth_users` and the `sports_data_lab` source row, retained by the existing suites' convention; (c) season
2026 `club_seasons` rows re-issued with new identity ids by the existing `settle-afl-api` suite (see §14.4.1:
values equal to the 19:52 pre-window state by fingerprint reconstruction; earlier state unverified). The F-002 writers' own audit rows (`data_edits` note
`AFLDB-ISSUE-264 F-002 lock test`), `club_seasons` for 2073 and `player_clubs` for the fixture players are
deleted by the block's `afterAll`; their residue counts were 0 after every step.
`afldb_test` ends at ledger 109 / original CHECK and comment / zero `player_match_stats` authority.

**Commit readiness.** ~~Ready for operator review and commit.~~ **On hold, see §14.4.** Nothing was staged
or committed. ~~Deploy order: on DEV the application must be live before migration 110.~~ Corrected in
§14.4.4: DEV already has migration 110, so this is an application-only deployment (`-SkipMigrate`). DEV
acceptance of the refusal is still outstanding; it should include one promotion held behind a Match Sheet
save (the retryable message) if the operator wants a live check of the bounded wait.

### 14.4 Commit readiness held: validation evidence gap (2026-10-04, agent-run, operator-authorised)

The operator held commit readiness until the historical `club_seasons` changes were explained. This pass
was authorised for read-only evidence inspection and read-only `afldb_test` queries through the existing
guarded tooling. It made no database write, ran no suite and touched no DEV or PROD environment.

Evidence: `D:\tmp\issue264\run-20261004-203858\` (`02-club-seasons-audit.log`/`.json`). The runner was
`Invoke-Issue264Window.ps1 -Phase Inspect`, extended with a read-only `club-seasons-audit` probe mode. The
pre-change tooling is kept as `*.pre-audit-20261004`. Every query ran in one `REPEATABLE READ READ ONLY`
transaction after the target proof (all roles reached `afldb_test` at 127.0.0.1:55432, one server).
Every earlier window's captures, logs and fingerprints are unchanged. Their SHA-256 values are recorded
in the session report.

#### 14.4.1 Season-2026 `club_seasons`: what changed, references, preservation

**Which windows re-issued rows.** Every window that ran `settle-afl-api.test.ts` re-issued the season-2026
rows: `094838` (morning), `195300`, `200132` and `202018`. Filtering the suite with `-t` does not prevent
it. The file-level `beforeAll` (`seedBaseline`) always inserts the keep-alive match and calls
`recompute2026SeasonDerivedState()`. That calls `recomputeClubSeasons(2026)`, which runs
`DELETE FROM club_seasons WHERE season = 2026` and then re-inserts the rows (`player-derived.ts:425`).

**The rows (now).** Two rows:
- id 3304, Brisbane Lions: played 1, L 1, 80–100, 0 points, percentage 80, rank 2, finals_played 1;
- id 3305, Hawthorn: played 1, W 1, 100–80, 4 points, percentage 125, rank 1, finals_played 1;
- both `source_id` 10, `import_batch_id` NULL.

The identity sequence is at 3305 (cache 1). Ids 1–1622 are one contiguous block holding seasons
1897–2025 (129 seasons). No season other than 2026 has an id above 1622.

**They are not historical data.** `afldb_test` holds **zero** season-2026 matches. The matches fingerprint
is equal in every baseline of the session, so this was also true before the first window. The
`seasons` row for 2026 has `match_count` 0 and `club_count` 0. No canonical match exists from which these
rows could be derived. Their values are exactly what the suite's own fixtures produce:
- the keep-alive home-and-away match: Hawthorn 100–80 Brisbane Lions, round 9001;
- the one Preliminary Final that the filtered case ("Match Sheet authority over an afl_api-owned row
  survives a re-settle") settles, giving finals_played 1.

`cleanup()` then deletes those matches. With zero non-final 2026 matches left, the `afterAll` recompute
skips `recomputeClubSeasons`, by the suite's documented design (`settle-afl-api.test.ts:783-794`). The
rows are left standing, so they are residue of the existing suite.

The rebuild block 1–1622 contains no 2026 row. A rebuild by the same pipeline in the ISSUE-233
rehearsal (`D:\tmp\issue233\rehearsal-20261001-151415\evidence.json`) recorded `club_seasons` = 1622 and
`club_seasons_id_seq` = 1622. That rehearsal ran on a different database, so it corroborates the finding
but does not prove it.

**References.** Nothing references these rows:
- no foreign key references `club_seasons`, so nothing could cascade, dangle or be reassigned;
- no column outside `club_seasons` is named for it;
- none of the 9 `entity_type`/`table_name`/`target_table`/`entity_table` columns in any base table holds
  a row naming `club_seasons`;
- `club_seasons` has no user trigger and no dependent view;
- the 2026 rows' own foreign keys are intact: their club, season and source all exist.

**What is proven: reconstruction of the pre-window fingerprint.** The `195300` window's census hashed
`club_seasons` with the identity id (`sum(hashtextextended(t::text, 0))`, season <> 2073). It recorded:
- H0 = `-9411333618602053880` before any write (baselines `195243` and `195300`, 19:52);
- H1 = `-6149499508468076762` after its `settle-afl-api` step.

The audit took today's rows, substituted candidate ids 1–4000 into the two 2026 rows with
`jsonb_populate_record`, and searched for sums that reproduce each hash. A self-check confirmed that the
substitution reproduces today's direct hash.
- H1 is reproduced by exactly one assignment: ids 3204/3205. This matches the `200057` read-only
  diagnostic and validates the method.
- H0 is reproduced by exactly one assignment: ids 3154/3155.

Therefore the whole non-fixture `club_seasons` table at 19:52 equals today's values, including both
season-2026 rows, every other season's rows and their ids. Only the two 2026 identity ids moved, from
3154/3155 to 3204/3205 to 3304/3305 (about 50 sequence values per window, including the 2073 fixture rows
that F-002 writes). This rests on a sum of 64-bit hashes. Over about 5.7 million candidate pairs, an
accidental match has a probability of about 3e-13. The `200132` and `202018` windows also show directly
that the value-level fingerprint was equal before and after their `settle-afl-api` step.

**What is unverified.**
- **The morning window `094838`.** Its census did not fingerprint `club_seasons`, and no capture, dump or
  evidence from before 09:48 holds these values. A search of `D:\tmp` found none for `afldb_test`. Its
  `settle-afl-api` step ran the same filtered case. Its effect on the 2026 rows' values is **unverified**;
  only their re-issue is certain. Seasons 1897–2025 kept their original contiguous ids, so they were not
  deleted and re-inserted. An in-place value change to them in that window is also not excluded by any
  fingerprint, although no suite in the window writes them.
- **Before this session.** The sequence had already advanced from 1622 to about 3105 (inferred at about 50
  values per window) before the morning window. So the residue has been re-issued by earlier runs of the existing suite, probably including
  full runs whose last case differs. The values the morning window found are not recorded anywhere.

**Why the value-level fingerprint is valid for future checks.**
- `club_seasons.id` is a surrogate identity. Nothing references it (above), so re-issuing it changes no
  meaning in the database.
- The value-level hash covers every other column (season, club, tallies, rank, flags, source, batch), so
  any content change is still detected from the baseline it is taken at.
- It is **not** evidence about any earlier state. It does not show that the morning window, or any run
  before the session, changed nothing. The 19:52-onward result above comes from the separate
  reconstruction against H0, not from the new fingerprint.
- §14.4.2 removes the only suite that re-issues these ids, so the runner also restores an id-inclusive
  `club_seasons` fingerprint. Any future delete-and-reinsert outside 2073 will then read as dirty again.

**Proposed repair (not executed; operator decision).** None is needed for referential integrity. The rows
are fixture residue in a test database, and every reference check is clean. Options:
- (a) leave them, since they match the state since at least 19:52 and nothing reads them by id;
- (b) the next `db:test:rebuild` removes them.

Deleting them by hand is not proposed. It would be a further mutation of a real season's rows, and the
existing suite would recreate them on its next run. A suite-level fix would make
`settle-afl-api.test.ts` restore or delete its own 2026 residue. That is an ISSUE-228/244 test-harness
change, out of scope here, and would be tracked separately if wanted.

#### 14.4.2 Corrected test plan (no test file changes required)

`settle-afl-api.test.ts` is removed from the window. It cannot be filtered clear of the 2026
delete-and-reinsert, because the re-issue happens in its file-level `beforeAll`. The runner now lists four
suites plus the build. The probe adds an id-inclusive `club_seasons_with_ids` fingerprint beside the
value-level one.

Why the remaining plan still covers the shared reader:
- **The reader.** Both settles reach the shared reader through `loadManualAuthority` and then
  `loadPlayerMatchStatsAuthority`, which calls the pure `buildPlayerMatchStatsAuthority`:
  - `settle-afltables` via `canonical-apply.ts:1026,1427`;
  - `settle-afl-api` via `settle-afl-api.ts:1549,1654` and the same `canonical-apply` lines.
- **What ISSUE-264 changed.** The change to that reader is additive (`fields` and `clubId` on each pair;
  an exported loader with an injectable continuity load). The settle's own call is unchanged (§13).
- **Window suites, none touching a real season.** In window `195300` the id-inclusive `club_seasons` hash
  was unchanged after steps 06–09, so none of these suites re-issued any row outside 2073:
  - `match-results-promotion` (32): fixture season 2073;
  - `datasets` (16);
  - `submission-promotion` (7);
  - `settle-afltables` "Durable Match Sheet authority through the settle" (11): fixture seasons 2094 and
    2093. It exercises the shared reader through `canonical-apply`, the path both settles use;
  - `npm run build`.
- **DB-free:**
  - `tests/current-season-import.test.ts`: the pure builder and `manualAuthorityVerdict`, about 30
    references;
  - `tests/ingest-datasets.test.ts` (81);
  - `tests/match-sheet.test.ts`.

**Gap, stated.** The two `settle-afl-api.ts` call sites (1549, 1654) and the afl_api-owned-row case are no
longer exercised against a database in this issue's validation. They are unchanged by this issue and the
reader they call is covered above. If the operator wants database coverage of them, the isolated option
needs **test changes in `settle-afl-api.test.ts`**:
- a fixture-season variant of the AFL API bundle (the suite is pinned to 2026 through `SEASON`, its real
  2026 fixture JSON, the keep-alive match and `recompute2026SeasonDerivedState`);
- moving the file-level 2026 setup behind a per-block guard.

That is a material change to an ISSUE-228/244 suite, so it is proposed, not made.

#### 14.4.3 Concurrency limitation: settle as deadlock victim (operator decision pending)

**Scope.**
- **Who.** Any settle that applies through `canonical-apply`, both the AFL Tables and the AFL API settle.
  Both take match locks per unit through `lockUnitMatchRows` in feed order and hold them to the end of the
  settle transaction.
- **Against what.** A concurrent legacy CSV promotion, either `match_results` (`FOR NO KEY UPDATE`) or
  `player_match_stats` (`FOR SHARE`), over an overlapping set of **existing** matches.
- **When it happens.** A cycle needs the settle to hold a later match while asking for an earlier one that
  the promotion holds. The settle is the victim when its deadlock check fires first: it began waiting
  first, and the promotion is still writing rows the settle holds. This was characterised on `afldb_test`
  at the lock-statement level for the AFL Tables shape. It was not run for the AFL API settle, which uses
  the same `lockUnitMatchRows`.
- **New relative to main**, where neither hook took match locks.

**Effect.**
- `canonical-apply` rolls only the failing unit back to its savepoint (`canonical-apply.ts:1267-1291`):
  no canonical row and no `canonical_applications` ledger row survive from that unit.
- The settle increments `canonicalApplyFailures` and opens one `canonical_apply_failed` finding per
  target in the unit (`settle-afltables.ts:2544-2573`; AFL API `settle-afl-api.ts:1145`).
- The run continues and commits its other units, so the run's other writes are unaffected.
- The derived recompute has its own bounded `40P01`-only retry. The unit apply has **no in-run retry**.

**Recovery.**
- **AFL Tables.** The next settle run re-offers the unit through the §9.3 retry invitation. That
  invitation is keyed on target state: the canonical target still differs from the proposal, so the unit
  is offered again even though the source payload has not moved (`settle-afltables.ts:2179-2184,
  2215-2219`). The retry passes through every normal gate (ownership, authority, disagreement). On
  success `resolveAppliedFailureFinding` closes the finding with `canonical_apply_succeeded`
  (`settle-afltables.ts:3484-3494`).
- **AFL API.** ~~Its next-run re-offer was not traced in this pass.~~ Traced in §14.5.2: the next
  in-season AFL API run re-evaluates the unit and closes the finding.
- **Until the next run.** The canonical row lacks that unit's update, and the finding sits in the
  exception queue. ~~DEV has no settle timer (as recorded in earlier issue work), so on DEV recovery waits
  for an operator-run settle.~~ Corrected in §14.5.2: DEV has the AFL API and Brownlow timers but no AFL
  Tables timer.
- **The promotion side.** When it is the victim, it ends `failed` with the retryable message and can be
  promoted again (§14.3).

**Status: operator decision pending.** The options are:
- accept as is;
- require a mitigation before commit (for example an in-run retry of a `40P01` unit, or a settle-side
  ascending lock order, which was out of scope by the F-002 decision);
- defer with a tracked follow-up.

It is **not** recorded as accepted or non-blocking. **Superseded by §14.5.3:** after the recovery trace
(§14.5.2), the operator accepted it as a temporary limitation, tracked as AFLDB-ISSUE-265.

#### 14.4.4 Corrected deployment guidance

- **DEV.** DEV already has migration 110 (ISSUE-257). This issue adds no migration, so its DEV deployment
  is application-only: `deploy/sync-dev.ps1 -SkipMigrate` (with `-RemoteRef` as usual).
- **The "application before 110" order** in migration 110's header applies only to an environment still at
  schema 109. For this issue that is PROD, if it has not yet received 110 when it is promoted.
- **`afldb_test`** is at ledger 109. The ISSUE-264 window applies and reverses 110 itself.

#### 14.4.5 Remaining commit blockers

1. The operator decision on §14.4.3.
2. The operator's acceptance of the corrected test plan (§14.4.2). If database coverage of the AFL API
   settle call sites is wanted, the isolated-fixture test change comes first.
3. The operator's acceptance of the §14.4.1 finding: morning-window value preservation stays unverified,
   and no repair is proposed.
4. If the operator wants the validation re-proved under the corrected plan, one more window with the
   updated runner. It was prepared, not run.

All four are settled in §14.5 (decisions 1–3 by the operator, item 4 by the final window).

### 14.5 Operator decisions, recovery trace and final validation (2026-10-04, agent-run, operator-authorised)

This pass was authorised for code inspection, documentation, database-free tests, read-only Git checks
and one corrected guarded `afldb_test` window. It made no DEV write, had no PROD access, made no
deployment or rebuild, terminated no session, and staged, committed, pushed and merged nothing.

#### 14.5.1 Operator decisions recorded

- **D-264-9 Preservation (§14.4.1).** The operator accepts the morning-window evidence gap **without
  repair**. Nothing claims value preservation before the earliest available baseline, the 19:52 H0
  reconstruction. The two season-2026 `club_seasons` residue rows (Hawthorn and Brisbane Lions, ids
  3304/3305) stay unchanged. They are not deleted and not rebuilt.
- **D-264-10 Test plan (§14.4.2).** The operator approves the corrected runner, which refuses
  `settle-afl-api.test.ts`. The ID-inclusive `club_seasons` fingerprint stays, excluding only precisely
  owned synthetic fixtures: season 2073, which the baseline census proves holds zero rows. Refactoring the
  AFL API suite onto an isolated fixture is outside this pass.
- **D-264-11 Concurrency (§14.4.3).** The operator decided conditionally: if both providers have a
  supported recovery path after a settle-unit deadlock, the limitation is accepted as temporary and gets a
  narrowly scoped follow-up; if either can strand work permanently, that is a blocker. §14.5.2 finds a
  recovery path for both, so the acceptance applies (§14.5.3).

#### 14.5.2 Recovery after a settle-unit deadlock: AFL Tables and AFL API

**Common to both (code).** Both settles apply a unit through `applyCanonicalUnit`
(`canonical-apply.ts:969`). The unit's match lock (`lockUnitMatchRows`, :490) is taken **inside** the
unit savepoint (:1004-1006, :1025). So a `40P01` there, or on any later statement of the unit, is
caught. The unit rolls back to `afldb_canonical_apply_unit`, releases it, and returns `failure` without
throwing (:1267-1291). The outer settle transaction stays usable and commits its other units. No
canonical row and no `canonical_applications` row survive from the failed unit. There is no in-run retry
of the unit. The derived recompute's bounded `40P01` retry is separate; that lock site is ISSUE-261's.

**AFL Tables (code).**
- *Failure.* `canonicalApplyFailures` is incremented, and one `canonical_apply_failed` finding (severity
  `error`) is opened per invited target (`settle-afltables.ts:2546-2573`).
- *Next run re-offers it.* Every run acquires the whole in-progress season
  (`deploy/afldb-settle-afltables.sh:151-152`, `--from/--to "$season"`), so the record is in the next
  bundle. Its payload did not move, so `reconcile()` answers `unchanged`. `invitationFor` then offers a
  `retry` (§9.3) whenever the automatic proposal still differs from the canonical target
  (`settle-afltables.ts:2179-2184`, `:2215-2221`). The retry passes through every normal gate inside the
  savepoint.
- *Finding closes.* On success, `recordOutcome` reaches `resolveAppliedFailureFinding`, which closes the
  finding as `canonical_apply_succeeded` (`settle-afltables.ts:3484-3494`, `settle-core.ts:461-474`).
- *Limits (pre-existing, not new to ISSUE-264).* The failure finding closes **only** on a successful
  apply. Two cases leave it open with the stale deadlock text, though canonical state is already correct
  or correctly refused:
  - on the next run the target no longer differs (for example the competing promotion or a Match Sheet
    save wrote the same values, or authority removed the field), so nothing is offered;
  - a gate refuses the retry (for example a new foreign owner or manual authority).

  AFL Tables has no moot-close (the I244-F009 healers are AFL API only) and writes no refusal finding
  except for rekey refusals. An operator must resolve such a stale finding.

**AFL API (code).**
- *Failure.* `applyUnitOutcome` opens one `canonical_apply_failed` finding per target, keyed
  `canonicalApplyIssueKey('afl_api', family, externalRecordId, targetTable)` (`settle-afl-api.ts:1145-1169`).
  A unit failure does not trigger the `--require-complete-source` rollback, whose inputs exclude
  `canonicalApplyFailures` (`settle-afl-api.ts:1974-1986`).
- *Next run re-offers it.* The nightly chain acquires every `CONCLUDED` match of the season
  (`deploy/afldb-settle-afl-api.sh:121`, no `--since`; default status `acquire-afl-api.ts:367`). The run
  settles every unit (`settle-afl-api.ts:1930-1935`). Recording an unchanged observation does not skip a
  unit (`:1242-1247`). Targets are rebuilt from a diff against **current canonical values**: the match at
  `:1436-1455` and `:1487`, periods at `:1457-1475`, and players at `:1717-1771`. So a target that still
  differs is offered to the applier again.
- *Finding closes.* On success, `recordApplyOutcomeFindings` closes the same key as
  `canonical_apply_succeeded` (`settle-core.ts:763-775`). When the target no longer differs,
  `closeMootApplyFinding` closes it as `canonical_apply_not_needed`, for matches and periods
  (`settle-afl-api.ts:1526-1538`), a corroborated (foreign-owned) match (`:1396-1399`) and players
  (`:1784-1789`). A refused retry refreshes the same open row (`uq_data_issues_open_by_key`) with the
  refusal reason (`settle-core.ts:785-797`).

**Observed test evidence (separate from the code above).**
- *AFL Tables.*
  - A unit write failure rolls back the unit alone, opens one finding per target, and the run continues
    (`settle-afltables.test.ts:3220-3281`). The trigger is a constraint violation, not a deadlock.
  - The §9.3 retry lands on an identical payload once canonical state allows it
    (`:2938-2957`, `canonicalRetryApplied` 1). That retry follows an identity resolution, not a failure.
  - **No test asserts that a `canonical_apply_failed` finding is closed by a later successful retry.**
- *AFL API.*
  - The finding lifecycle on the same type and key is tested for a **refusal**: opened, refreshed on
    replay, then closed as `canonical_apply_succeeded` once the gate clears
    (`settle-afl-api.test.ts:2660-2731`), and closed as `canonical_apply_not_needed` when moot (`:2734-2766`).
  - The resolution vocabulary is tested DB-free (`afl-api-ingestion-safety.test.ts:893`, `:910`).
  - **No AFL API test produces a rolled-back unit** (no `canonicalApplyFailures` > 0 assertion), so
    failure followed by heal is code-only.
  - These AFL API tests were **not run** in this issue's windows (§14.4.2).
- *Deadlock.*
  - The F-002 block characterises the settle as victim at the lock-statement level only: it emulates
    `lockUnitMatchRows` and a unit's writes, in the AFL Tables shape (§14.3 item 8).
  - **No test, for either provider, drives a real settle into a deadlock and then a recovery run.**

**Scheduling (corrected).** Per the operator (2026-10-04), consistent with the ISSUE-232 DEV acceptance
record, DEV runs the **AFL API** nightly timer (`afldb-settle-afl-api.timer`, 05:00 plus up to 15 min,
`Persistent=true`) and the **Brownlow** poll timer, but has **no AFL Tables timer**. The repository ships
`afldb-settle-afltables.timer` (04:30), but installation is per host. This pass did not re-check the host;
that was not needed, because the code path does not depend on it. On DEV, therefore:
- an AFL API unit is retried automatically by the next nightly run;
- an AFL Tables unit waits for an operator-run settle.

PROD scheduling was not examined in this pass.

**Conditions on recovery (both providers).**
- *The season must still be in progress.* Recovery needs a later **in-season** run of the same provider.
  Out of season both wrappers exit without work, and the applier refuses `season_not_in_progress`. A unit
  lost on a season's last in-season run stays unapplied, with its open `error` finding in the settle
  exception report, until an operator settles before the season leaves `in_progress_seasons`, or resolves
  the finding. The same holds today for any `canonical_apply_failed` on main.
- *Latency.* Recovery takes until the next run: about one night for AFL API, and an operator run for AFL
  Tables on DEV.

**Verdict.**
- **Neither provider strands work permanently, in code.** Every later in-season run of the provider
  re-evaluates the rolled-back target against current canonical state. While the target still differs it
  is offered again. Nothing marks it done or suppresses it.
- The open points are latency, the season-end window, and the AFL Tables stale-finding case above. They
  concern visibility and timing; no canonical update is lost.
- **This is not a blocker under D-264-11.** The deadlock itself is **not eliminated**.

#### 14.5.3 Operator acceptance and follow-up

- **Accepted (operator, 2026-10-04, under D-264-11):** as a **temporary limitation** of ISSUE-264, a
  settle unit can be the deadlock victim of a legacy CSV promotion's match locks. The cost is one unit
  rolled back, one finding per target, and recovery on the provider's next in-season run (§14.5.2). The
  deadlock is not eliminated, and this acceptance is not a claim that it is.
- **Follow-up: AFLDB-ISSUE-265** (opened 2026-10-04; runbook `issues/open/AFLDB-ISSUE-265.md`).
  - *Ownership check.* AFLDB-ISSUE-261 owns the end-of-run recompute order against the Data Editor and
    match-admin writers, not the settle unit's match lock against a legacy promotion. A search of
    `issues.md` for deadlock, `40P01` and lock order found no other owner.
  - *Next free ID.* A read-only `git grep` over all 84 local and remote refs, and the `issues.md` of every
    sibling `afldb*` worktree, found no ID from 265 up.
  - *Scope.* Mitigating the settle-unit deadlock-victim case only: a bounded in-run `40P01` retry of the
    unit, a settle-side ascending match-lock order, or making the promotion yield.
  - *Out of scope.* ISSUE-261. The pms row-lock cycles, as on main. The AFL Tables stale-finding
    observation is recorded there as a note only.
  - Nothing implemented.

#### 14.5.4 Final validation

**Code under test.** The tree is unchanged since the `202018` window. This pass edited only tracker and
runbook files. HEAD and `main` are both `09feda5c`.

**Database-free** (no DSN in the process environment, no worktree `.env`):

| Suite | Result |
|---|---|
| `tests/ingest-datasets.test.ts` | 81/81 |
| `tests/afl-api-ingestion-safety.test.ts` | 165/165 |
| `tests/match-sheet.test.ts` + `tests/current-season-import.test.ts` | 389 passed, 4 environment-skipped |

**Guarded `afldb_test` window: `D:\tmp\issue264\run-20261004-211130`, OVERALL PASS** (runner
`Invoke-Issue264Window.ps1 -Phase Full`, tunnel 127.0.0.1:55432; console `window-console-5.txt`).

Each step below was followed by a census against the run's baseline. Every census was clean.

| Step | Result |
|---|---|
| Target proof | `afldb_owner`, `afldb_import`, `afldb_auth` and `afldb_app` all on `afldb_test`, at the expected endpoint, on one server |
| Window preflight | 0 other sessions. Ledger 109, only `110_match_sheet_player_match_stats_authority.sql` pending, State A, zero `player_match_stats` authority. Captured: ledger 109 rows, CHECK 13 literals, comment 358 chars, `data_overrides` 92 rows |
| Baseline | Zero fixture residue, including season-2073 `club_seasons`. Equal to the `202018` final census on every historical fingerprint it had: matches 16,838; `player_match_stats` 685,471; players 13,365; external identities 19,318; seasons 130; clubs 24; organisations 21; value-level `club_seasons` 1,624; `data_edits` 2; `player_clubs` 16,710; career 13,363; season 58,176; `data_overrides` 92; submissions 0; sources 13; auth users 1. `import_batches` max id 1111 was unchanged since then. The id-inclusive `club_seasons` hash `-12746378607811824059` equals the `203858` audit's |
| `migrate.ts --status --target test` | Exactly 1 pending (110). Isolation re-checked just before the write |
| `migrate.ts --target test` | Applied 110 only (241 ms). State B verified |
| `match-results-promotion` | 32/32 |
| `datasets` | 16/16 |
| `submission-promotion` | 7/7 |
| `settle-afltables`, `-t "Durable Match Sheet authority through the settle"` | 11 passed, 65 filtered out |
| `npm run build` (DATABASE_URL = `afldb_app` on `afldb_test`) | Exit 0, 1,515 static pages |
| Restore | Pre-restore census clean. The guarded rollback transaction was verified inside, then committed, with isolation 0. Verify: ledger, CHECK definition, comment and validation flag equal the capture; zero `player_match_stats` authority rows |
| Final census | All 19 fingerprints equal the baseline, `club_seasons_with_ids` included. Zero residue |

`settle-afl-api.test.ts` did not run; the runner refuses it.

#### 14.5.5 Final database state and retained records

- **Schema.** `afldb_test` is back at ledger 109 with its original CHECK, comment and validation flag, and
  zero `player_match_stats` authority. `data_overrides` has 92 rows, as captured. Migration 110 is not
  applied.
- **Historical data.** Unchanged by this window on every fingerprinted table (§14.5.4), and unchanged since
  the `202018` final census.
- **Retained records, itemised.**
  - (a) **36 append-only `admin-upload` import batches** from this window's promotions: `match_results` 15,
    `player_bio` 2, `player_match_stats` 19. Since the session's first baseline that makes 144 over four
    full windows (`admin-upload` totals now 103 / 12 / 98).
    The `import_batches` id sequence moved from 1111 to 1184: the 37 extra values were consumed by
    rolled-back refusal cases and keep no row.
  - (b) **The two fixture `auth_users` and the `sports_data_lab` source row**, retained by the existing
    suites' convention. Counts are unchanged (2 and 1).
  - (c) **The two season-2026 `club_seasons` residue rows** (ids 3304/3305). Left unchanged under D-264-9,
    and not re-issued by this window, because their id-inclusive hash is unchanged.
- Sequences consumed by the suites' own fixture rows (deleted by their teardowns; zero residue) are not
  restored. Nothing references a sequence value.

#### 14.5.6 Commit readiness

**Ready for operator review and commit.** The four §14.4.5 items are settled. The validation passed under
the corrected plan. Nothing was staged or committed.

The commit set is **eleven paths**, listed explicitly: the ten modified tracked paths and the new
`issues/open/AFLDB-ISSUE-265.md`. Do not use `git add .`. The seven empty stray files that were in the
worktree root have been moved outside the worktree by the operator, and `git status` shows no other
untracked path. After the commit:
- `merge:ready`;
- application-only DEV deploy (`deploy/sync-dev.ps1 -SkipMigrate`);
- DEV acceptance (the issue stays open until it passes);
- PROD with ISSUE-258's outstanding promotion.

AFLDB-ISSUE-265 does not block the commit.
