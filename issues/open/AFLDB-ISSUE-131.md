# AFLDB-ISSUE-131 — An upstream match rekey duplicates the canonical match

**Status:** Open — Stage 1 (investigation / design) COMPLETE.
**Stage 2 (implementation + validation) COMPLETE 2026-09-03 on `claude/issue-131`, unmerged.**
**Independent review answered 2026-09-03 — merge YES AFTER FIXES; every required fix is
made and validated. See §14.**
Production untouched; the timer stays stopped. See §13 and §14.
**Severity:** High — data integrity, and it blocks re-enabling the production settle timer.
**Area:** Data acquisition / Import architecture / Data integrity
**Branch / worktree:** `claude/issue-131` — `D:\dev\afldb-issue-131`
**Migration:** none claimed. Stage 1 concludes the identity fix needs **no schema change**;
one optional hardening index is proposed in §7 and is gated on measurement.
**Related:** `AFLDB-ISSUE-122` (the applier this defect lives in), `AFLDB-ISSUE-099`
(the observation spine and the five-part key), `AFLDB-ISSUE-128` (source completeness),
`AFLDB-ISSUE-129` (Wildcard Final semantics — the trigger, not the cause),
`AFLDB-ISSUE-086` (`data_overrides`, orphaned by a rekey — see §5.7).

---

## 0. Stage boundary

Stage 1 is investigation, a RED reproduction and an approved design. **No production
code was changed.** The only repository edits are the RED test, this runbook and the
issue/index bookkeeping (§11).

**Stage 2 (§13) implemented §5 and §8 on `claude/issue-131`.** Everything below §12 is
the Stage-1 record and is left as written EXCEPT where §14 names a correction in place;
§13 records what was built, what was proved, and where the implementation had to depart
from the design, and §14 records the independent review and the pre-merge fixes.

`afldb-settle-afltables.timer` on production is **STOPPED and must stay stopped** until
Stage 2 ships and §8's supervised acceptance passes. No production write, settle,
migration, DELETE or repair was performed or is authorised by this document.

---

## 1. Symptom

During development/current-season settlement, stale duplicate/rekeyed canonical 2026
matches were observed around the late home-and-away / Wildcard boundary, described as
stale duplicate/rekeyed Round 24/25 canonical matches: one real-world AFL match present
twice in `matches`, the older row retaining child data.

**The specific stale rows have NOT been enumerated from a database in this session.**
Stage 1 establishes the *mechanism* from the repository with certainty; identifying the
exact affected rows requires the read-only evidence requested in §9, which the operator
must run. Everything in §3 is proven from code and schema; nothing in §3 is inferred
from the symptom.

---

## 2. Scope boundary

In scope: canonical match identity and reconciliation on the automatic AFL Tables
current-season settle path, the child rows and provenance that hang off it, and the
remediation of rows already made stale.

Out of scope: Squiggle and Kali (deprecated diagnostic/manual fallback only — they must
not become automatic canonical writers and this issue does not change that), the
full-history rebuild's own identity handling beyond the §3.6 finding, and any change to
ISSUE-129's Wildcard Final semantics, which are correct and are not the defect.

---

## 3. Reconstructed root cause

### 3.1 The canonical match identity is a content address over mutable metadata

`tools/migration/import_fitzroy_core.py:1615-1619`

```python
def match_key_of(match: MatchFact, clubs: ClubResolver) -> str:
    return "|".join([
        str(match.season), match.round_code, match.match_date.isoformat(),
        clubs.name_of(match.home_hist), clubs.name_of(match.away_hist),
    ])
```

`match_key` is `season|round_code|match_date|home name|away name`. Three of those five
components are metadata the upstream source revises: `round_code`, `match_date`, and the
club *name rendering* (which comes from `clubs.json`, so it can move without the source
moving at all — see §10.3).

### 3.2 The same string is also the source record identity

`tools/migration/import_fitzroy_core.py:1221-1224` builds the match family's
`external_record_id` from the identical five components, and `:1885` enumerates the
`afltables.match` scope by that same key. The declared contract at `:43-47` states it
outright: *"Match identity is results.csv (season, round, date, home, away)"*.

Player rows inherit it: `external_record_id` is `<normalised profile url path>@<match_key>`
(`:1378`, `:1402`), so a rekeyed match rekeys every one of its player records too.

**There is therefore no stable identity anywhere in the pipeline for a match.** The
source identity and the canonical identity are the same mutable string, so they move
together and neither can be used to detect that the other moved.

### 3.3 Reconciliation sees a brand-new record

`reconcile()` (`src/lib/acquisition/reconciliation.ts`) keys on `external_record_id`. A
moved component produces an id that has never been observed, so there is no open version,
and gate order lands on verb `new`. Nothing in the reconciler can ask "is this the record
formerly known as X?" — that question is not representable.

### 3.4 The applier looks the canonical row up by `match_key` and only by `match_key`

- `src/lib/acquisition/settle-afltables.ts:1620-1636` — the run's one canonical lookup
  map, `matchIdsByKey`, is `SELECT match_key, id FROM matches WHERE season = $1`.
- `:2608` — `resolveTarget()` reads that map and returns `new_target` on a miss.
- `src/lib/acquisition/canonical-apply.ts:336` and `:740` — the savepoint re-read is
  `SELECT * FROM matches WHERE match_key = $1`, and a miss is `new_target` again.

`autoApplyOwnership()` then answers `insertable` for `new_target` by design
(`canonical-apply.ts:126`: *"No row: there is nothing to adopt"*), every remaining gate
passes because the evidence is genuinely valid, and `writeMatch()` INSERTs.

The module header even names the hazard it did not close (`canonical-apply.ts:38-42`):
*"a wrong rendering inserts a duplicate fixture instead of conflicting."* It guards
against a wrong *rendering* by using the bundle's key verbatim. It does not guard against
a *moved* one.

### 3.5 Nothing constrains, and nothing revisits, the duplicate

- `src/db/migrations/003_matches.sql:23` — `match_key text NOT NULL UNIQUE` is the only
  uniqueness constraint on `matches`. There is **no** constraint on the real-world
  fixture `(season, match_date, home_club_id, away_club_id)`, so the second row is
  perfectly admissible.
- The vanished record is swept to `absent` inside its now-complete enumeration, and
  `settle-afltables.ts:3033-3034` is explicit: *"§18.2: absence is observation state
  only. No candidate, ever."* Absence correctly never deletes — but nothing else ever
  revisits the stale row either.
- The stale row keeps `match_period_scores` and `player_match_stats`, and the new row
  gets its own copies, because the player records rekeyed alongside it (§3.2). The same
  player-match is then canonical twice, under two match ids.

**This is a general rekey/reschedule defect, not a Wildcard Final defect.** It fires on
any move of `round_code`, `match_date` or the club name rendering. ISSUE-129's `WF`
reclassification is one instance and is the one that exposed it; the RED test in §4
proves the general case first, with the Wildcard case second.

### 3.6 The stable identity exists in the source and is discarded on this path

`results.csv` carries a `Game` column. It is in `RESULTS_REQUIRED`
(`import_fitzroy_core.py:192`), it is parsed into `MatchFact.game_id` (`:1135`, `:1304`),
and the **full-history rebuild writes it as the canonical provenance**:
`import_matches` upserts `... source_record_id ...` with `m.game_id` (`:2613`).

The **current-season settle path drops it entirely**. `game_id` is absent from
`MATCH_PAYLOAD_COLUMNS` (`:1028-1032`) and absent from `match_projection` (`:1723-1753`),
so it never reaches the bundle, never reaches TypeScript and never reaches the canonical
row. Instead `canonical-apply.ts:513` stamps `source_record_id = unit.externalRecordId`,
i.e. the five-part key string.

Two consequences, both findings in their own right:

1. **`matches.source_record_id` holds two incompatible conventions.** Historical rows
   carry an AFL Tables game id; 2026 rows written by the ISSUE-122 settle carry a
   five-part key string. Stage 2 must not silently "normalise" this.
2. **The one candidate stable identity in the feed is available and unused.** §5.2
   proposes carrying it as corroborating evidence only, gated on §10.1's measurement.

---

## 4. RED reproduction

**File:** `tests/integration/settle-afltables.test.ts` — new nested suite
`AFLDB-ISSUE-131 — an upstream rekey must not duplicate the match`, appended inside the
existing `AFLDB-ISSUE-122 S5 — the canonical applier` describe so it reuses that suite's
guarded `afldb_test` client, fixtures and `cleanup122()` teardown. Two new
`T122` timestamps were added. **No existing assertion was changed.**

Per `CLAUDE.md` §10 this extends the closest existing semantic home rather than creating
a new file, and it drives the same `runSettleAfltables()` entry point the production
settle uses.

Two tests, both currently **RED by design**:

1. **`only round_code moves`** — one completed match is settled at `round_code '1'`, then
   the identical real-world match (same season, same date, same two clubs) is settled at
   `round_code '2'`. Asserts the intended contract: exactly ONE canonical row, on the new
   key, carrying the same `matches.id`, citing the new source record, with exactly one
   `player_match_stats` row and four period rows hanging off it.
   **Today:** two `matches` rows and two `player_match_stats` rows.
2. **`wildcard reclassification`** — the ISSUE-129 shape: `24`/`home_and_away` is
   reclassified to `WF`/`wildcard_final` (`round_number` NULL, `is_final` true). Same
   assertions. This proves the mechanism is identical, and it is the case with the worst
   downstream consequence: a surviving stale `24` row is still `home_and_away`, so it
   keeps earning the ladder points ISSUE-129 says a Wildcard Final never earns.

These tests assert the **intended** contract, not current behaviour. They must stay RED
until Stage 2 and must not be weakened to pass. They live only on `claude/issue-131` and
are not merged.

Run command in §9.1.

---

## 5. The reconciliation contract (proposed, for Stage 2)

### 5.1 Canonical identity rule

A `matches` row denotes one real-world fixture. Its **fixture identity** is
`(season, home_club_id, away_club_id, match_date)`, and `match_key` is demoted from
*identity* to *current rendering*: still `UNIQUE`, still maintained equal to the source's
five-part string, but never the sole handle reconciliation uses.

### 5.2 Source identity rule

`external_record_id` for `afltables.match` stays the five-part string in Stage 2.
**Do not adopt `game_id` as the external record id** — that would rekey every existing
observation in the spine at once and orphan the whole 2026 history, which is the same
class of failure this issue exists to fix.

Instead, carry `game_id` through `MATCH_PAYLOAD_COLUMNS` and `match_projection` as
**corroborating evidence** for the §5.3 proof, and only after §10.1 measures whether it
is actually stable across acquisitions. If it is not stable, drop it from the design;
§5.3 stands without it.

### 5.3 When a canonical match may be rekeyed in place

Evaluated on every `matches` record of the run — on a `match_key` lookup HIT as well as a
miss — so the steady state costs one indexed probe per match record. (Stage 1 wrote
"only on a miss"; §13.4 D6 records why that could not stand: the would-merge clause below
is only ever reachable on a hit, so a miss-only search could never see it and the ordinary
update would write into one half of a duplicate pair. Corrected here so §5.3 and the
implementation say the same thing.) Inside the same savepoint, against freshly re-read
state:

Build candidate set `C` = canonical `matches` rows where **all** hold:

- `season` equals the incoming season, exactly;
- `home_club_id` and `away_club_id` equal the incoming resolved club ids, exactly
  (a club move is never a rekey — it is ambiguity);
- the row differs from the incoming record in **at most one** of `{ round_code,
  match_date }`;
- the row is owned by the promoting source (`source_id` resolves to `afltables`) —
  a source-less or foreign-owned row is never a rekey candidate, consistent with
  `autoApplyOwnership()`;
- the row's `match_key` is **not** listed in this run's complete enumeration for the
  match scope, i.e. the source no longer publishes that identity;
- if `game_id` is adopted per §5.2, the stored and incoming ids agree.

Then:

| `|C|` | Outcome |
|---|---|
| 0 | Genuinely new. INSERT. Current behaviour, unchanged. |
| 1 | **Proven rekey.** UPDATE that row in place (§5.4). |
| >1 | **Ambiguous.** Refuse `rekey_ambiguous`, open a `data_issues` finding, write nothing. |

Additionally, if the incoming `match_key` already has a canonical row **and** a stale
candidate also exists, that is two canonical rows for one fixture already: refuse
`rekey_would_merge`, open a finding, write nothing.

**Two existing canonical rows are never merged automatically.** No automatic path moves,
rewrites or deletes another row's children. Merging is a supervised operation only (§8),
and even there it refuses when both rows carry dependent data.

### 5.4 The rekey write

One UPDATE on the existing `matches.id`, inside the existing per-record savepoint:

- set `match_key` to the new rendering — `match_key` joins the proposed field set on the
  rekey path only, never on the ordinary update path;
- set every changed proposed field (`proposedMatchValues()` already proposes
  `round_code`, `round_number`, `round_type`, `is_final`, `match_date`, `home_club_id`,
  `away_club_id` and the score/attendance group, so no new field plumbing is needed);
- restamp the provenance quartet, so `source_record_id` becomes the new external record id;
- write the `canonical_applications` row in the same savepoint, verb `update`, with the
  old `match_key` in `previous_values` and the new one in `new_values`. **No new verb**,
  so migration 083's `canonical_applications_verb_ck` is untouched and no migration is
  needed for the ledger.

Take `SELECT ... FOR UPDATE` on the candidate before writing so two concurrent settles
cannot both claim it. `match_key UNIQUE` is the backstop: a losing racer's UPDATE fails,
its unit rolls back to `write_failed`, and that path is already implemented and tested.

### 5.5 Child rows

**Zero child mutation.** Preserving `matches.id` is the whole point: eight tables
reference `matches(id)` and only `match_period_scores` cascades —
`player_match_stats` (`004:19`), `player_career_stats.first_match_id/last_match_id`
(`007:135-136`), `player_achievements` (`053:69`), `staging.external_current_matches`
(`063:34`), `player_match_period_stats` (`062:8`), `staging.afl_api_lineup` (`077:186`).

A rekey in place leaves every one of them correct with no work. It is also the only
option the settle path takes: **no code on it issues a DELETE or a TRUNCATE against
`matches`**, and ISSUE-099 obligation O1 (`tests/integration/settle-afltables.test.ts`,
*"sends no DELETE and no TRUNCATE at all"*) proves that by asserting on the statements
actually issued. That guarantee is BEHAVIOURAL and tested, not structural: Stage 1 wrote
that `afldb_import` "holds no DELETE on `matches`", which overstates it —
`privileges.sql` decides which DML the role actually holds, this issue changes no grant,
and the role is the blast-radius limit rather than the proof. O1 must not be relaxed.

Player records rekey by their own `url@match_key`; because the match id is unchanged,
their canonical target `(player_id, match_id)` resolves to the existing row and the
ordinary update path handles them with no special case.

### 5.6 Provenance and history

The retired observation stays in the spine, marked `absent` — that is the durable record
that the identity was retired — and the `canonical_applications` row carrying old and new
`match_key` is the auditable link between the two. Nothing is deleted from
`staging.source_records`, `staging.source_record_versions` or `staging.afltables_match`.

### 5.7 Human overrides — a second defect the rekey must not cause

`data_overrides.entity_key` for `matches` **is the `match_key`**
(`manual-authority.ts:153-156`, `073_data_overrides.sql:21`). Migration 073's header
comment claims overrides *"survive source reloads even if the row is rekeyed"* — that is
**false for this class of rekey**, because the natural key is exactly what moves.

A rekey therefore silently orphans every active human override on that match, and the
next settle would then overwrite a field a human had deliberately pinned.

Stage 2 must, inside the same transaction, carry active `data_overrides` rows for the old
`entity_key` across to the new one; and if the new key already holds a row for the same
`field_group`, refuse `rekey_override_conflict` and write nothing.

### 5.8 Completed vs future matches

Unchanged. E6 (`completionProven`) means the settle only ever materialises played
matches, so `recordState: 'played'` with `scheduleFields: []`
(`settle-afltables.ts:2013-2016`) stays correct and a moved date on a played match
remains a *correction*, never a *reschedule*. This issue adds no unplayed-match path.

### 5.9 Idempotence

Running the same input twice produces no second mutation: after the rekey the canonical
row is found by the new `match_key` at the first lookup, `diffFields()` returns empty and
the target is refused `nothing_to_write`. The §5.3 search is only reached on a lookup
miss, so it never runs in the steady state and cannot itself become a source of drift.

### 5.10 Fail-closed summary

`rekey_ambiguous`, `rekey_would_merge` and `rekey_override_conflict` join
`CanonicalApplyRefusal`. Each refuses the unit, writes nothing canonical, opens a
`data_issues` finding and surfaces in the settle exception report. There is no force
flag, no override and no adoption, matching rule 2 of `canonical-apply.ts`.

---

## 6. What Stage 2 must change

| File | Change |
|---|---|
| `src/lib/acquisition/canonical-apply.ts` | The §5.3 candidate search on a `matches` lookup miss; the §5.4 rekey write; the three new refusals; the §5.7 override carry-across. |
| `src/lib/acquisition/settle-afltables.ts` | Pass the run's complete enumeration for the match scope into the applier so §5.3 can ask "does the source still publish this key?"; counters and findings for the new refusals. |
| `src/lib/acquisition/settle-report.ts` | Render the new refusals in the exception report. |
| `tools/migration/import_fitzroy_core.py` | **Only if §10.1 clears it**: add `game_id` to `MATCH_PAYLOAD_COLUMNS` and `match_projection`. |
| `tests/integration/settle-afltables.test.ts` | Turn §4 GREEN; add ambiguity, would-merge, override-conflict, idempotence-after-rekey and concurrent-claim cases. |
| `tools/current-season/repair-match-rekeys.ts` | New — §8. |

---

## 7. Schema and migration implications

**The identity fix needs no migration.** No new column, no new verb, no widened CHECK.

One **optional** hardening is proposed and is **not** a prerequisite: a UNIQUE index on
`(season, match_date, home_club_id, away_club_id)` would make a duplicate fixture
unrepresentable rather than merely undesired. It must **not** be written until it is
measured against the full canonical history — early-era fixtures, replays and any
same-day repeat pairing could legitimately violate it, and a failing migration on
production is a far worse outcome than the defect. §9.4 supplies the measuring query.

If it is adopted it needs the next free migration number. As of this worktree that is
`086` (`084` and `085` are definitively taken by ISSUE-129), and per standing repository
practice the number must be re-derived by scanning every live branch tip immediately
before it is claimed. **ISSUE-131 claims no migration number at Stage 1.**

---

## 8. Production remediation design

For rows already made stale. Ships **after** the §6 code fix, never before.

**New tool:** `tools/current-season/repair-match-rekeys.ts`.

Contract:

1. **Dry-run by default.** No `--apply`, no write of any kind. `--apply` must be explicit.
2. **Target protection.** Opens `AFLDB_IMPORT_DATABASE_URL`, the same restricted
   `afldb_import` role the settle uses, rather than an owner or superuser DSN. The
   guarantee that it never DELETEs or TRUNCATEs `matches` is BEHAVIOURAL: the tool
   contains no DELETE and no TRUNCATE on any path (rule 3), and ISSUE-099 obligation O1
   proves the same of the settle path from the statements it issues. The role bounds the
   blast radius; it is not itself the proof, and no grant is changed here. It prints the
   resolved database name and
   requires `--season`, refusing a season absent from
   `seasons.json.in_progress_seasons` unless `--acknowledge-completed-season`.
3. **No ad-hoc SQL DELETE**, at any point, by anyone. Every repair is an UPDATE.
4. **Plan output.** For each detected duplicate-fixture group: both canonical ids, both
   `match_key`s, `round_code`/`round_type`/`match_date` for each, per-row child counts
   (`player_match_stats`, `match_period_scores`, `player_achievements`,
   `player_match_period_stats`, lineups, derived references), which key the current
   source still publishes, and the proposed action.
5. **Actions**, exactly three:
   - *stale row carries the data, live key absent* → **rekey in place** (§5.4). The
     expected and preferred case. No delete, no child move, ledger row written.
   - *stale row carries no dependent data at all* → **report only.** Retiring an empty
     row still needs a DELETE, which this role cannot and must not do; the tool prints
     the group and leaves it for a separate, supervised decision.
   - *both rows carry dependent data* → **REFUSE**, open a `data_issues` finding, print
     the group. No automatic merge, ever.
6. **Transaction and retry safety.** One transaction; per-fixture savepoints so one
   refusal does not abort the run. `--apply` re-derives the plan inside the transaction
   and aborts if it differs from the dry-run plan it was given (plan hash), so a retry on
   changed data cannot silently do something else. Re-running after a successful apply
   finds nothing to do.
7. **Audit.** Every mutation writes its `canonical_applications` row in the same
   savepoint, exactly as the settle does. Observation history is untouched.
8. **Before/after validation.** The tool prints the §9.4 duplicate-fixture count and the
   ISSUE-129 invariants (`wildcard_final` rows, T15 `is_finals_series` mismatches,
   `player_career_stats` finals drift, `club_seasons` finals sum vs 2 × finals-series
   matches) before and after, so acceptance is a diff, not a claim.

**Production sequence when Stage 2 is accepted** (each step operator-run, timer stays
stopped throughout):

1. §9 read-only evidence on production — establish the actual stale set, which may be empty.
2. Deploy the code fix; `sh deploy/afldb-r-preflight.sh` must end `R PREFLIGHT: OK`
   (the ISSUE-130 §12.5 gate).
3. `repair-match-rekeys` dry-run; review the plan.
4. `repair-match-rekeys --apply`; re-run the validation block.
5. One supervised settle: `--dry-run --auto-apply`, then the real apply, then an
   identical rerun proving 0/0/0 (SC3), as ISSUE-122 §23 did.
6. Only then re-enable `afldb-settle-afltables.timer`.

---

## 9. Evidence still required (all read-only, operator-run)

> **Status 2026-09-03:** §9.1, §9.2 (dev **and** production), §9.3 and §9.5 have been run
> by the operator — results and their consequences are in **§15**. §9.4 and §9.6 remain
> outstanding. The queries below are retained as the exact commands.

Stage 1 could not enumerate the actual stale rows: the acquired CSVs are gitignored
(`data/sources/` is absent from the worktree) and no database may be queried from this
session. These are the exact commands.

### 9.1 The RED reproduction (afldb_test)

```
npx vitest run tests/integration/settle-afltables.test.ts -t "AFLDB-ISSUE-131"
```

Expected at Stage 1: **both tests FAIL**, reporting two `matches` rows where one was
asserted. That failure is the proof. (This worktree has no `node_modules`; junction a
sibling worktree's per the usual workaround before running.)

### 9.2 The actual duplicate fixtures — run on **dev** first, then production

Read-only. Lists every real-world fixture holding more than one canonical row.

```sql
SELECT m.season, m.match_date, m.home_club_id, m.away_club_id,
       count(*) AS canonical_rows,
       array_agg(m.id ORDER BY m.id)          AS match_ids,
       array_agg(m.match_key ORDER BY m.id)   AS match_keys,
       array_agg(m.round_code ORDER BY m.id)  AS round_codes,
       array_agg(m.round_type::text ORDER BY m.id) AS round_types
  FROM matches m
 WHERE m.season = 2026
 GROUP BY m.season, m.match_date, m.home_club_id, m.away_club_id
HAVING count(*) > 1
 ORDER BY m.match_date;
```

### 9.3 Same-fixture pairs that differ only in the date (the other rekey vector)

```sql
SELECT a.id AS id_a, b.id AS id_b, a.match_key AS key_a, b.match_key AS key_b,
       a.match_date AS date_a, b.match_date AS date_b, a.round_code, b.round_code
  FROM matches a
  JOIN matches b
    ON b.season = a.season AND b.id > a.id
   AND b.home_club_id = a.home_club_id AND b.away_club_id = a.away_club_id
   AND b.round_code = a.round_code
 WHERE a.season = 2026
 ORDER BY a.match_date;
```

### 9.4 Whether the §7 hardening index is even representable (full history)

```sql
SELECT count(*) AS violating_groups
  FROM (SELECT 1 FROM matches
         GROUP BY season, match_date, home_club_id, away_club_id
        HAVING count(*) > 1) v;
```

A non-zero result on historical seasons means the index is **not** adoptable as written;
Stage 2 must then either scope it to in-progress seasons or drop it.

### 9.5 Child-row exposure for any group §9.2 returns

Substitute the ids §9.2 reported.

```sql
SELECT m.id, m.match_key, m.round_code, m.source_id, m.source_record_id,
       (SELECT count(*) FROM player_match_stats s WHERE s.match_id = m.id) AS pms,
       (SELECT count(*) FROM match_period_scores p WHERE p.match_id = m.id) AS periods,
       (SELECT count(*) FROM player_achievements a WHERE a.match_id = m.id) AS achievements
  FROM matches m
 WHERE m.id IN (/* ids from 9.2 */);
```

### 9.6 Is `game_id` a stable identity? (§5.2, §10.1)

Historical rows carry it in `source_record_id`; 2026 settle rows carry a key string.

```sql
SELECT season,
       count(*) FILTER (WHERE source_record_id LIKE '%|%') AS key_string_convention,
       count(*) FILTER (WHERE source_record_id NOT LIKE '%|%') AS game_id_convention
  FROM matches
 WHERE source_record_id IS NOT NULL AND season >= 2024
 GROUP BY season ORDER BY season;
```

Stability across acquisitions must additionally be measured by comparing the `Game`
column of two acquired `results_2026.csv` snapshots — the tracked manifests record only
file-level sha256 and row counts (207 rows on `issue099-t8-20260829`, 209 on
`issue129-t7-20260903`), not the values.

---

## 10. Risks and open ambiguities

1. **`game_id` may not be stable.** AFL Tables' `Game` looks like a per-season sequential
   index. If inserting the Wildcard round renumbered later games, it is not an identity
   at all and §5.2 must be dropped. §5.3 does not depend on it. **Measure before use.**
2. **The stale set is not yet known and may be empty on production.** The supplied
   production state (`wildcard_final` rows = 0, T15 mismatches = 0, career-stats finals
   drift = 0, `club_seasons` finals sum 1436 = 2 × finals-series matches) is consistent
   with production holding **no** stale duplicates, because the WF matches were rejected
   as unrepresentable before ISSUE-129 and have never been settled. If §9.2 returns
   nothing on production, the remediation tool is still required — the *next* settle is
   what would create them — but it will have nothing to repair.
3. **Club name rendering is a third rekey vector.** `match_key` embeds
   `clubs.name_of(...)`, so a `clubs.json` edit rekeys matches with no upstream change at
   all, potentially in bulk. §5.3 handles it only if the resolved club **ids** are
   unchanged, which they would be — but the blast radius is every match of that club.
   Worth an explicit Stage 2 regression test.
4. **Ambiguity is real, not theoretical.** Two clubs can meet more than once in a season.
   The "differs in at most one of round_code/date" rule plus exact club and season
   agreement is what keeps `|C| = 1`; a double-up round could still produce `|C| > 1`,
   which is precisely why that case refuses rather than guessing.
5. **The two `source_record_id` conventions (§3.6)** are a latent trap for anything that
   reads that column. Not fixed here; recorded so Stage 2 does not "tidy" it blindly.
6. **The §4 tests are deliberately RED.** They must not be merged to a shared branch in
   that state, and must not be weakened to go green.

---

## 11. Stage 1 record

Repository files changed by Stage 1:

- `tests/integration/settle-afltables.test.ts` — two new `T122` timestamps and the new
  nested `AFLDB-ISSUE-131` RED describe block. No existing assertion altered.
- `issues/open/AFLDB-ISSUE-131.md` — this runbook (new).
- `issues.md` — new ledger entry, Open Issues row, and a correction to the stale open
  count, which still listed the resolved `AFLDB-ISSUE-130`.
- `IssuesIndex.md` — new index row and allocation note.

No `CHANGELOG.md` entry: Stage 1 changes no application behaviour
(`CLAUDE.md` §5 — investigation-only updates are not changelog material).

No shell, Git, SQL, SSH, service, build or deployment command was executed.

---

## 12. Exact next action for Stage 2

1. Operator runs §9.1 and returns the failure output — the RED baseline.
2. Operator runs §9.2 and §9.3 against **dev**, and §9.2 against **production**
   (read-only), so the real stale set is known before code is written.
3. Fresh session, **Fable High**, carry-over = this file plus the returned evidence.
   Implement §6 in order: the §5.3 candidate search and §5.4 rekey write first, turning
   §4 GREEN, then the three refusals, then §5.7, then the §8 tool.
4. Do not touch production. The timer stays stopped until §8's supervised sequence
   completes and is accepted.


---

## 13. Stage 2 — implementation and validation (2026-09-03)

Implemented in this worktree, on `claude/issue-131`, unmerged. **No production database
was opened, no production command was run, and `afldb-settle-afltables.timer` was not
touched.** All validation is against `afldb_test`.

### 13.1 What was built

**One identity rule, in one module.** `src/lib/acquisition/match-rekey.ts` (new) holds
`findRetiredMatchIdentities()` — §5.3's predicate, exactly — and `carryMatchOverrides()`
— §5.7. Both callers import it rather than restating it, so the repository does not grow
a second notion of "the same match" (§7.1's standing hazard).

**The applier** (`canonical-apply.ts`). On a `matches` lookup miss the candidate search
runs inside the savepoint, under `FOR UPDATE`, against state re-read there — rule 1 is not
weakened for this path. One candidate resolves the target to that row; `match_key` is in
the proposed field set on the rekey path only, so the rendering diffs, is covered by the E5
baseline hash, lands in the ledger's `previous_values` / `new_values`, and is written by
the ordinary UPDATE with no special case in `writeMatch()`. E4 is asked under BOTH
renderings and the stronger answer wins, because the human's decision was recorded against
the key the row carried at the time. Three refusals join `CanonicalApplyRefusal`:
`rekey_ambiguous`, `rekey_would_merge`, `rekey_override_conflict`. No force flag.

**The settle pass** (`settle-afltables.ts`). The run derives its match-family published
record ids and proven-complete scope keys once, from the bundle (`matchRekeyScopeOf()`), and
carries them on `SettleRefs`. `resolveTarget()` runs the same search so the proposal is
derived against the row it will actually write, withholds the invitation when the evidence
is ambiguous or would merge, and opens a `canonical_apply_failed` finding for it. A
rekeyed match retires its old key in `refs.matchIdsByKey` and registers the new one against
the same id, so the player family — settled afterwards in the same transaction — resolves
against the preserved row. Two counters: `canonicalMatchesRekeyed`,
`canonicalRekeyRefusals`.

**Zero child mutation**, as §5.5 requires. The canonical id is preserved, so nothing
referencing `matches(id)` is touched, and no DELETE exists on any path.

**The §8 tool**: `tools/current-season/repair-match-rekeys.ts`. Dry run by default,
`AFLDB_IMPORT_DATABASE_URL`, prints the resolved database name, requires `--season`,
refuses a season outside `in_progress_seasons` without `--acknowledge-completed-season`,
one transaction with per-fixture savepoints, `--apply` requires `--plan-hash` and
re-derives the plan inside the transaction and aborts if it differs, ledger row per
mutation, before/after validation block. Three actions only: rekey in place, report only,
refuse.

### 13.2 Files changed

| File | Change |
|---|---|
| `src/lib/acquisition/match-rekey.ts` | **New.** §5.3 candidate search, §5.7 override carry, the two retirement proofs. |
| `src/lib/acquisition/canonical-apply.ts` | Savepoint-side search under `FOR UPDATE`, the rekey resolution, the three refusals, the override carry, `rekeyedMatch` in the unit result, E4 under both renderings. |
| `src/lib/acquisition/settle-afltables.ts` | Run-scoped rekey scope on `SettleRefs`; `resolveTarget()` rekey resolution and the two pre-invitation blocks; `match_key` in the proposal on the rekey path; the reference-map retirement; `writeRekeyRefusalIssue()`; two counters. |
| `src/lib/acquisition/settle-report.ts` | One-line defect fix — see D2. No rendering change was needed. |
| `tools/current-season/settle-afltables.ts` | Reports the two new counters. |
| `tools/current-season/repair-match-rekeys.ts` | **New.** The §8 remediation tool. |
| `tests/integration/settle-afltables.test.ts` | §4's two RED tests turned GREEN unaltered; nine further tests; the fixture helper generalised; the repair tool's batch added to `cleanup122()`. |
| `issues/open/AFLDB-ISSUE-131.md`, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` | Bookkeeping. |

**No migration.** §7's optional hardening index was **not** written: §9.4 has not been
measured, and a failing migration on production is worse than the defect it would prevent.

### 13.3 Validation evidence (all `afldb_test`, Windows, this worktree)

| Command | Result |
|---|---|
| `npx vitest run tests/integration/settle-afltables.test.ts -t "AFLDB-ISSUE-131"` | **11 passed**, 45 skipped. Both §4 tests GREEN, with no assertion weakened. |
| `npx vitest run tests/integration/settle-afltables.test.ts tests/current-season-import.test.ts` | **311 passed, 1 skipped**, 0 failed. |
| `npx vitest run tests/admin-current-season-settle.test.ts tests/fitzroy-core-import.test.ts tests/integration/afl-api-lineup-store.test.ts` | **138 passed**, 5 skipped. |
| `npx vitest run tests/integration/database.test.ts` | **37 passed**, 4 skipped (the ISSUE-129 fixture's home suite). |
| `npx tsc --noEmit -p tsconfig.json` | clean. |
| `npx eslint` over every changed file | clean. |

The RED baseline before the fix was the operator-supplied run: 2 ISSUE-131 tests, both
failing for the intended reason (two canonical rows where one was asserted).

New coverage, all inside the existing `AFLDB-ISSUE-122 S5` suite:

- ISSUE-129 semantics survive the rekey — `is_finals_series` false, `is_final` true,
  `round_number` NULL after the `24` → `WF` move;
- idempotence — the identical rerun rekeys 0, inserts 0, updates 0, refuses 0;
- `rekey_ambiguous` — two retired rows, nothing written, finding opened;
- `rekey_would_merge` — a live row is NOT updated while a retired duplicate exists;
- both `round_code` and `match_date` moved — no rekey, two rows, contract held narrow;
- club identity changed — no rekey;
- foreign-owned canonical row — never a candidate, never restamped;
- override carried across a safe rekey, still `conflict` at the new key, old row retired
  and not deleted;
- `rekey_override_conflict` — a live override under both renderings refuses everything;
- the repair tool: argument guards, the season guard, plan → apply → nothing-left-to-do,
  a wrong `--plan-hash` refused, the ledger row naming both renderings, the four period
  rows still attached to the preserved id, and the ambiguous case refused.

### 13.4 Deviations from the Stage-1 design

**D1 — `game_id` was NOT adopted, and `import_fitzroy_core.py` was not changed.**
§5.2 made it conditional on §10.1's measurement, which needs two acquired
`results_2026.csv` snapshots and was not run. §5.3 does not depend on it. The two
`source_record_id` conventions (§3.6) are untouched and un-normalised.

**D2 — `settle-report.ts` needed no rendering change, but did carry a real defect.**
The three refusals write `canonical_apply_failed` findings under
`CANONICAL_APPLY_ISSUE_OWNER`, which `buildSettleExceptionReport()` already lists and
`resolveAppliedFailureFinding()` already closes when a later run applies the record — so
the lifecycle is correct with no new code. What the work DID find is a latent bug in
`latestBatchOf()`: `SELECT id::text AS id ... ORDER BY id DESC` binds to the **output
alias**, so the newest settle batch was sorted as text and `'963'` sorted above `'1062'`.
The report then names a stale batch, and only once the id crosses a digit-count boundary
— which is why it had never fired. Fixed by qualifying the column
(`ORDER BY import_batches.id DESC`). Surfaced by the new tests pushing the test
sequence past 1000; it applies to production the same way.

**D3 — §5.5's child-table list has one wrong table.** `first_match_id` / `last_match_id`
(`007_derived_stats.sql:135-136`) are on **`player_clubs`**, not `player_career_stats`,
which carries no `matches(id)` reference at all. Corrected in the repair tool's child
counts. The §5.5 conclusion is unaffected: the rekey preserves the id, so no child table
is touched either way.

**D4 — the override carry-across is an INSERT plus a deactivation, not a rekey of the
override row.** `afldb_import` holds `UPDATE` on `data_overrides` for
`(override_values, admin_user_id, is_active, updated_at)` only — **not** `entity_key` —
and no `DELETE` (migration 078, `privileges.sql:318-327`). So the active row is written at
the new key and the old one is set `is_active = false`, never removed. An INACTIVE row at
the new key for the same `field_group` is updated and reactivated (a rekey and back does
exactly this); only an ACTIVE one refuses. Within the existing grants; no migration.

**D5 — "the source no longer publishes that key" is proved through the SOURCE RECORD, not
the `match_key`.** §5.3 phrases the test as the row's `match_key` being absent from the
run's complete enumeration. The enumeration lists `external_record_id`s, and although in
production those two strings are identical (§3.2), they are not the same field. The
implementation therefore requires the candidate's `source_record_id` to resolve to a spine
record of this family whose `scope_key` this run proved complete and whose id this run did
not publish. Same statement in production, and the only correct one when the two diverge —
which is also what keeps the search honest across scopes.

**D6 — `rekey_would_merge` also stops the ORDINARY update.** §5.3's clause requires a
refusal when the incoming key already has a row and a retired candidate also exists. That
state is only reachable on a lookup HIT, so the search now runs on the hit path too, and a
live row is not updated while a retired duplicate of its fixture stands. This is a
behaviour change beyond the miss path: it surfaces pre-existing duplication instead of
writing into one half of it. Regression-tested.

**D7 — after this fix, the settle itself remediates §8's preferred case.** A row under a
retired identity whose live identity has no canonical row is rekeyed forward by the next
settle. The tool remains for the case where the settle is not running (the timer is
stopped) and for enumerating and refusing the duplicate pairs, and it shares
`findRetiredMatchIdentities()` rather than restating the rule.

**D8 — the repair tool proves §3.2's convention per fixture rather than assuming it.**
It has no bundle, and `staging.afltables_match` carries no `match_key` column, so it cannot
read the rendering a live record belongs under. Where the live identity already has a
canonical row, finding it on that key IS the proof. Where it does not — the only case the
tool writes in — the retired row it is about to rekey must itself satisfy
`match_key = source_record_id`; otherwise the fixture is refused
`identity_convention_unproven` and reported. The column is never normalised.

**D9 — no migration, and §7's index was not written.** §9.4 is unmeasured.

### 13.5 Known blockers and what Stage 2 did NOT do

1. **The §9 read-only evidence had not been gathered when this section was written.**
   §9.2 / §9.3 (dev, then production), §9.5 and §9.6 were all outstanding, and this
   session opened no dev or production database. **Superseded on 2026-09-03 by §15:** the
   operator has since run §9.2 (dev and production), §9.3 and §9.5. Dev holds 17 duplicate
   fixtures / 34 rows; production holds **0**, confirming §10 risk 2. §9.4 and §9.6 remain
   outstanding.
2. **§10.1 (`Game` id stability) is unmeasured**, so §5.2 stays undecided.
3. **§7's hardening index is unmeasured and unwritten.**
4. **Nothing was merged.** The work is on `claude/issue-131` only.
5. **Production is untouched.** No settle, no repair, no migration, no write; the timer
   remains stopped.
6. `.env` was copied into this worktree from the sibling checkout so the integration suite
   could reach `afldb_test`. It is gitignored and local.

### 13.6 Exact next action

1. Operator reviews the diff on `claude/issue-131`.
2. Operator runs §9.2 / §9.3 against **dev**, and §9.2 against **production**
   (read-only), so the real stale set is known. **Done — see §15.**
3. Merge to `main` only after that review; then §8's production sequence, in order, with
   the timer still stopped: deploy, `sh deploy/afldb-r-preflight.sh` ending
   `R PREFLIGHT: OK`, `repair-match-rekeys` dry run, review, `--apply --plan-hash`, one
   supervised settle (`--dry-run --auto-apply`, then the real apply, then an identical
   rerun proving 0/0/0), and only then the timer.
4. Optional, separately: measure §9.4 and decide the §7 index; measure §10.1 and decide
   §5.2.

**Superseded by §15.5.**

---

## 14. Independent review and the pre-merge fixes (2026-09-03)

An independent review of the Stage-2 branch returned **merge YES AFTER FIXES**: one HIGH
finding, no blockers, three MEDIUM/LOW corrections and a short list of trivial items.
Everything it required is done in this pass, on `claude/issue-131`, still unmerged.
**Production remained untouched: no production database was opened, no production command
was run, and `afldb-settle-afltables.timer` was not touched.**

### 14.1 HIGH-1 — a rekey refusal did not stop the rest of the fixture family

**The finding, confirmed.** `rekey_would_merge` and `rekey_override_conflict` refused the
`matches` mutation and then let later targets of the SAME real-world fixture write:

1. **`rekey_would_merge`.** The refusal is decided before the invitation, but only the
   `matches` pass carried it. `match_period_scores` for that record resolved against the
   LIVE half of the duplicated fixture and was offered; so was `player_match_stats`,
   settled afterwards in the same transaction against `refs.matchIdsByKey`, which still
   held the live row under the incoming key.
2. **`rekey_override_conflict`.** Decided inside the savepoint, after
   `applyCanonicalUnit()` had already set `matchId` to the STALE candidate. The `matches`
   target was refused and the loop continued, so a pending `match_period_scores` target
   was written onto the stale row — and where that row had no period rows its baseline
   was legitimately "no row", so the insert succeeded.

Both violate the contract that a rekey refusal writes nothing for the fixture, and both
deepen exactly the duplicated state §8 exists to resolve.

**The fix — fixture-family blocking, one mechanism, two levels.**

- `canonical-apply.ts`. `applyCanonicalUnit()` carries a `fixtureBlocked` refusal. It is
  set the moment a rekey refusal stops the unit's `matches` target — from
  `readFreshTarget()` (`rekey_ambiguous`, `rekey_would_merge`) or from the §5.7 override
  carry (`rekey_override_conflict`) — and setting it also clears `matchId`, so no stale
  id survives the refusal. Every remaining target of the unit is then refused unwritten,
  carrying **the same specific refusal**, never a generic `write_failed`. It is returned
  on `CanonicalApplyUnitResult`.
- `settle-afltables.ts`. `SettleRefs` gains `rekeyBlockedFixtures: Map<matchKey,
  refusal>`, run-scoped and mutable exactly as `matchIdsByKey` is. A pre-invitation
  `rekeyBlock` on any pass, or a `fixtureBlocked` returned by the applier, registers the
  fixture; a record whose `match_key` is registered offers **nothing** to the applier.
  The player family is settled after the match family in the same transaction, so it
  reads the block and is withheld with the same refusal.

Reporting semantics are preserved rather than widened: a blocked target opens the same
`canonical_apply_failed` finding under `CANONICAL_APPLY_ISSUE_OWNER`, keyed per target
exactly as the roll-back path already keys its own, and is counted in both
`canonicalApplyRefusals` and `canonicalRekeyRefusals`. A target the automatic path would
not have offered anyway is simply not offered — it is not turned into a finding it never
had — which is why the ambiguous case still reports one finding and not two.

**No fail-closed rule was weakened.** Nothing was relaxed to make room for the block; it
only ever removes writes.

### 14.2 MEDIUM-2 — the override carry is no longer silent

`carryMatchOverrides()` already returned its count and it was discarded.
`CanonicalApplyUnitResult.overridesCarried` now carries it out,
`SettleCounters.canonicalOverridesCarried` accumulates it, and
`tools/current-season/settle-afltables.ts` prints it in the ISSUE-131 counter group.

**The remaining audit limitation, stated rather than papered over.** An automatic carry
writes no `data_edits` row. `data_edits` is the admin UI's human-edit ledger, keyed on an
admin user, and `afldb_import` holds no grant on it; inventing an "automatic" actor for
it would be a larger subsystem change than this issue is scoped for, and D4 already
records that `afldb_import` cannot even UPDATE `data_overrides.entity_key`. The durable
audit of a carry is therefore: the `data_overrides` pair it leaves (the new active row at
the live key and the old row deactivated, never deleted), the `canonical_applications`
row naming both renderings in the same savepoint, and now the run counter. Anything
richer needs its own issue.

### 14.3 MEDIUM-3 — the DELETE/TRUNCATE guarantee is behavioural, not structural

Stage 1 wrote that `afldb_import` "structurally cannot DELETE or TRUNCATE `matches`".
That overstates it: `privileges.sql` decides which DML the role holds, and this issue
changes no grant. Corrected in §5.5, in §8's contract rule 2 and in the repair tool's
header to say what is actually true — the repair tool contains no DELETE and no TRUNCATE
on any path, and ISSUE-099 obligation O1 proves the same of the settle path by asserting
on the statements it issues. The role is the blast-radius limit, not the proof. **No
grant was changed.**

### 14.4 MEDIUM-4 — the §5.3 probe runs on hit AND miss

§5.3's "evaluated only when the `match_key` lookup misses" was already contradicted by
D6, which had to run the search on the hit path so the would-merge clause is reachable at
all. §5.3, `resolveTarget()`'s comment and `findRetiredMatchIdentities()`'s docblock now
all say the same thing: one indexed probe per match record, on both paths.

### 14.5 LOW-9 — the RED framing is gone

The two Stage-1 tests are GREEN and are no longer titled or described as expected to
fail. Their assertions are unchanged.

### 14.6 The smaller items

- **`derivePlan()` could throw on a stale candidate array.** `canonicalFactsOf()` may
  return `null`, so `stale` could be shorter than `retired` and `stale[0].sourceRecordId`
  would throw. It now refuses `rekey_candidate_unreadable` when the two lengths differ:
  an unreadable candidate is evidence to refuse on, never to index past.
- **The repair tool's `import_batches` row is now completed** — `completed_at`,
  `status = 'completed'`, `records_rejected = 0` — inside the same transaction that wrote
  its mutations, exactly as `runSettleAfltables()` closes its own. A row left `running`
  forever is indistinguishable from a crashed run.
- **Per-fixture success is no longer printed before the commit.** The lines are collected
  inside `sql.begin()` and written after it returns.
- **`unresolvedIdentityMatch` is no longer inflated by a rekey.** On a proven rekey the
  canonical match EXISTS — it is simply still carrying the retired rendering — so
  `resolveTarget()` now passes that id to the record's dependent `match_period_scores`
  target. This also closed a real gap: the dependent's baseline used to be recorded as
  "no row" against a row with four period rows, so a genuine period correction was
  refused `stale_canonical_target` on the rekey run and only landed a run later. The
  empty-period-set answer is scoped to the rekey path alone; on the ordinary path an
  existing canonical match with no period rows still falls through to `indeterminate` and
  fails closed, which is what stops a period set being inserted under a foreign-owned or
  source-less `matches` row (E3 unchanged, and regression-proven by the existing
  foreign-owner and source-less tests).
- **`MATCHES_PROPOSED_FIELDS`** is what `proposedMatchValues()` builds and is unchanged;
  its docblock now states that `match_key` joins the proposed set on the rekey path via
  `withRekeyRendering()`, and only there.

### 14.7 New regression coverage

Nine tests to twenty in the ISSUE-131 suites. The five the review required:

1. **`rekey_would_merge` withholds the whole fixture family.** A live half with four
   period rows and a player-match row; the source then retires the duplicate and corrects
   the crowd, the period set and the player's kicks at once. Three targets refused
   (`matches`, `match_period_scores`, `player_match_stats`), nothing mutated, and
   `ledger122()` byte-identical before and after — no dependent ledger write occurs.
2. **`rekey_override_conflict` inserts no period row onto the stale match.** The stale row
   is seeded with an EMPTY period set, so its baseline for that target is genuinely "no
   row" — the exact shape in which the dependent insert used to succeed. Zero period rows
   after, the row still under the retired rendering, the player row untouched, both human
   overrides exactly as they were left, and no ledger row.
3. **Date-only rekey.** `match_date` moves, `round_code` held, same canonical id, and the
   identical rerun rekeys 0 / inserts 0 / updates 0 / refuses 0.
4. **Club-rendering-only rekey (§10 risk 3).** Both club ids, the round and the date all
   unchanged and only the `match_key` rendering moves — the bulk vector a `clubs.json`
   edit opens. Safe in-place rekey, id preserved, and the ledger row names both
   renderings.
5. **`latestBatchOf()`.** Two completed settle batches at `99999999` and `100000000`, so
   the ids cross a digit-count boundary and the lexicographic order inverts the numeric
   one. `buildSettleExceptionReport()` names the numerically latest.

### 14.8 Validation evidence (all `afldb_test`, Windows, this worktree)

| Command | Result |
|---|---|
| `npx vitest run tests/integration/settle-afltables.test.ts -t "AFLDB-ISSUE-131"` | **20 passed**, 45 skipped. The 11 Stage-2 tests plus the 5 new ones and the repair-tool suite. |
| `npx vitest run tests/integration/settle-afltables.test.ts tests/current-season-import.test.ts` | **316 passed, 1 skipped**, 0 failed. |
| `npx vitest run tests/admin-current-season-settle.test.ts tests/fitzroy-core-import.test.ts tests/integration/afl-api-lineup-store.test.ts tests/integration/database.test.ts` | **175 passed**, 9 skipped. |
| `npx tsc --noEmit -p tsconfig.json` | clean. |
| `npx eslint` over every changed file | clean. |

One intermediate failure is worth recording because it is load-bearing evidence rather
than noise: the first cut answered an EMPTY canonical period set as a new target on every
path, and the existing foreign-owner and source-less tests immediately caught it — a
period set would have been INSERTED under a `matches` row this source does not own. The
branch is now scoped to the rekey path, where the candidate is owned by the promoting
source by construction. E3 stands.

### 14.9 Files changed in this pass

| File | Change |
|---|---|
| `src/lib/acquisition/canonical-apply.ts` | `fixtureBlocked` and `overridesCarried` on the unit result; the fixture-family block in the target loop; `matchId` cleared on a rekey refusal. |
| `src/lib/acquisition/settle-afltables.ts` | `rekeyBlockedFixtures` on `SettleRefs`; `applyRecordCanonically()` restructured around one blocked-fixture decision; `canonicalOverridesCarried`; `resolveTarget()`'s `rekeyedMatchId` and the rekey-path empty-period answer; the §5.3 hit-and-miss comment; the `MATCHES_PROPOSED_FIELDS` docblock. |
| `src/lib/acquisition/match-rekey.ts` | Docblock: the search runs on hit and miss. |
| `tools/current-season/settle-afltables.ts` | Reports `canonicalOverridesCarried`. |
| `tools/current-season/repair-match-rekeys.ts` | MEDIUM-3 header correction; `rekey_candidate_unreadable`; the batch row completed; per-fixture lines printed after the commit. |
| `tests/integration/settle-afltables.test.ts` | Five new tests; RED framing removed; `rekeyMatchSpec()` can move the published period set. |
| `issues/open/AFLDB-ISSUE-131.md`, `CHANGELOG.md`, `IssuesIndex.md` | This section and the §5.3 / §5.5 / §8 corrections; bookkeeping. |

`src/lib/acquisition/settle-report.ts` needed no further change: D2's `latestBatchOf()`
fix was already in, and LOW-5 asked only for the regression test, which is now written.

### 14.10 Deliberately deferred, and why

1. **A `data_edits` audit row for an automatic override carry** — §14.2. Out of scope and
   needs its own issue; the limitation is now documented rather than implied.
2. **`game_id` (§5.2 / §10.1)** — still unmeasured, still not adopted. Unchanged by this
   pass, and the review explicitly agreed it does not belong in this stage.
3. **§7's hardening index (§9.4)** — still unmeasured, still unwritten. **No migration.**
4. **§9's read-only environment evidence** — §9.2 / §9.3 against dev, §9.2 against
   production, plus §9.5 and §9.6 — was deliberately NOT started in this session.
   **Gathered by the operator afterwards; see §15.** §9.2/§9.3/§9.5 are complete (dev: 17
   fixtures / 34 rows, all empty-stale + populated-live; production: 0 rows, confirming
   §10 risk 2). §9.4 and §9.6 are still outstanding.
5. **Both-round-and-date moves stay fail-closed.** Unchanged, and regression-tested.

### 14.11 Exact next action

1. Operator reviews the diff on `claude/issue-131` — the Stage-2 work and this pass
   together.
2. Operator runs §9.2 / §9.3 against **dev**, and §9.2 against **production**
   (read-only), so the real stale set is known. **Done — see §15.**
3. Merge to `main` only after that review; then §8's production sequence, in order, with
   the timer still stopped: deploy, `sh deploy/afldb-r-preflight.sh` ending
   `R PREFLIGHT: OK`, `repair-match-rekeys` dry run, review, `--apply --plan-hash`, one
   supervised settle (`--dry-run --auto-apply`, then the real apply, then an identical
   rerun proving 0/0/0), and only then the timer.
4. Optional, separately: measure §9.4 and decide the §7 index; measure §10.1 and decide
   §5.2.

**Superseded by §15.5.**

---

## 15. §9 read-only environment evidence — operator-run (2026-09-03)

The operator ran the §9 queries. **Read-only throughout; no write, no settle, no repair,
no deploy. `afldb-settle-afltables.timer` on production remains STOPPED.** This session
opened neither database and made no application-code change in response — the evidence
does not contradict the implemented contract.

The two environments disagree, and the distinction is the point of this section.

### 15.1 DEV — `streamanator` / `afldb_dev`

**§9.2 duplicate fixtures — 17 duplicate real-world fixtures, 34 canonical rows.**

Every observed rekey is a `round_code` movement, with the season, date, home club and
away club identical across the pair, and every row still `home_and_away`:

| Movement | Observed |
|---|---|
| Round 23 → 24 | yes |
| Round 24 → 25 | yes |
| date-only | none |
| `round_type` change | none in the rows shown |

This is exactly the §3 mechanism, in the field: one component of the five-part
`match_key` moved, `reconcile()` called it verb `new`, and the applier INSERTed rather
than updating. It is also the §10 risk-3-free case — the club renderings did not move.

**§9.3 date-only pairs — 0 rows.** The other rekey vector is not present in dev. The
date-only path stays covered by the §14.7 regression test, not by field evidence.

**§9.5 child/provenance classification — all 34 rows.**

| Measure | Rows |
|---|---|
| duplicate rows | 34 |
| rows with **no** dependent data (`empty_rows`) | 17 |
| rows with dependent data (`populated_rows`) | 17 |
| rows whose `source_record_id` is a five-part key string | 17 |
| rows whose `source_record_id` is numeric (`game_id` convention) | 17 |

Detailed sampling gave one consistent shape for every pair:

- **older canonical row** — numeric `source_record_id`; 0 `player_match_stats`;
  0 `match_period_scores`; 0 `player_achievements`;
- **newer canonical row** — five-part key-string `source_record_id`; ~44–46
  `player_match_stats`; 8 `match_period_scores`; 0 `player_achievements`.

So dev holds 17 pairs in the **empty stale row + populated live row** shape. It does
**not** hold a single pair with both halves populated.

The numeric-vs-key-string split is §3.6's two `source_record_id` conventions showing up
as a clean 17/17: the stale halves came from the full-history rebuild (`game_id`), the
live halves from the settle path (key string). It is corroboration of §3.6, not a new
finding, and nothing here adopts `game_id` as an identity (§15.4).

### 15.2 PRODUCTION — `afldb-prod` / `afldb_prod`

**§9.2 duplicate fixtures — 0 rows.**

Production currently holds **no** duplicate 2026 fixtures of this class. This confirms
**§10 risk 2** as written: the later rekeyed identities have not been settled on
production, because the timer has been stopped since ISSUE-129, so the defect has not yet
had the chance to fire there.

Production was not otherwise accessed from this session, and §9.3 / §9.5 were not run
against it — with §9.2 empty they have no groups to classify.

### 15.3 What this means for the remediation contract

1. **Production needs prevention, not cleanup.** The §6 code fix is the whole of the
   production remediation today. `repair-match-rekeys` must still ship and must still be
   run in §8's sequence, because a dry run finding nothing is the evidence that there is
   nothing to find — but on current production it will report an empty plan. The §8
   ordering is unchanged: the code fix lands before the timer is re-enabled, or the very
   next settle creates on production exactly what dev now holds.
2. **Dev's 17 pairs are §8 action 2 — "report only".** The stale halves carry no
   dependent data at all, so under §8 rule 5 the tool prints the group and stops. It does
   **not** rekey them (the live key is already present, so a rekey would be a merge) and
   it does **not** delete them: retiring an empty row needs a DELETE, `afldb_import` must
   not do that, and §8 rule 3 forbids ad-hoc SQL DELETE at any point, by anyone. **The
   contract stays report-only for this shape.** Nothing in this evidence changes that,
   and no DELETE is being proposed here.
3. **The settle's own behaviour over dev's shape is already specified and tested.** With
   both halves present, a further rekey attempt on one of those fixtures resolves to
   `rekey_would_merge`, which refuses, writes nothing, and — since §14.1 — withholds the
   whole fixture family for the rest of the run. Dev is therefore not made worse by
   running the fixed code against it.
4. **Deciding what to do with dev's 17 empty halves is a separate, supervised decision**
   and is not part of this issue's authorised scope. It needs an owner-level DELETE or an
   equivalent supervised action, on dev only, after the repair tool has printed the
   groups.

### 15.4 §9 status after this pass

| Query | Status |
|---|---|
| §9.1 RED reproduction (`afldb_test`) | **complete** — GREEN since Stage 2 (§13.3, §14.8) |
| §9.2 duplicate fixtures — dev | **complete** — 17 fixtures / 34 rows (§15.1) |
| §9.2 duplicate fixtures — production | **complete** — 0 rows (§15.2) |
| §9.3 date-only pairs — dev | **complete** — 0 rows (§15.1) |
| §9.4 hardening-index representability (full history) | **NOT RUN** — outstanding |
| §9.5 child/provenance classification — dev | **complete** — 17 empty / 17 populated (§15.1) |
| §9.6 `source_record_id` convention by season | **NOT RUN** — outstanding |

Consequently:

- **§7's hardening index remains unmeasured and unwritten. No migration.** §9.4 has not
  been run, so the index is still not known to be representable over full history.
- **`game_id` remains unmeasured and NOT adopted.** §9.6 has not been run and no
  cross-snapshot `Game` comparison was made, so §5.2 stays undecided and §10 risk 1
  stands. The 17 numeric `source_record_id` values in §15.1 show the convention exists on
  the stale halves; they say nothing about stability across acquisitions.

### 15.5 Exact next action

1. Operator reviews the diff on `claude/issue-131` — Stage 2, the §14 review fixes and
   this evidence section.
2. Merge to `main` only after that review.
3. Then §8's production sequence, in order, with the timer still stopped: deploy,
   `sh deploy/afldb-r-preflight.sh` ending `R PREFLIGHT: OK`, `repair-match-rekeys` dry
   run (expected empty on production per §15.2), review, `--apply --plan-hash` if and
   only if the plan is non-empty, one supervised settle (`--dry-run --auto-apply`, then
   the real apply, then an identical rerun proving 0/0/0), and only then re-enable
   `afldb-settle-afltables.timer`.
4. Separately, on **dev**: run `repair-match-rekeys` dry-run to print the 17 report-only
   groups, then take the supervised decision of §15.3 item 4.
5. Optional, separately: run §9.4 and decide the §7 index; run §9.6 plus a cross-snapshot
   `Game` comparison and decide §5.2.
