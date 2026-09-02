# AFLDB-ISSUE-122 — Automatic current-season AFL Tables canonical ingestion

> **Approved planning runbook. Implementation contract for a fresh session.**
> Planning session: 2026-09-02, Opus / High / Plan mode, worktree `D:\dev\afldb-issue-122`,
> branch `claude/issue-122`, base `19de501`.
>
> Nothing in this runbook was implemented. Every `file:line` reference below was verified
> against this worktree during planning. Sections marked **[PLANNED]** are design; everything
> else is **[CONFIRMED]** repository evidence.

---

## 1. Problem statement

AFLDB can acquire, validate, persist and project current-season AFL Tables data perfectly, but
that data never becomes canonical. A completed AFL match can exist upstream and AFLDB shows
nothing, because the pipeline terminates at a review row that nothing consumes.

`AFLDB-ISSUE-099` (Resolved 2026-08-29) built the acquire → observe → project → reconcile →
promotion-candidate pipeline and **deliberately stopped**. Its §15 is an explicit *"ISSUE-099 v1
performs ZERO canonical INSERT or UPDATE operations"* prohibition, with
`canonicalRowsInserted`/`canonicalRowsUpdated` asserted to be literally `0` and any non-zero
value declared stop condition SC3. `AFLDB-ISSUE-096` §6 encodes the matching product policy and
closes with *"No automatic canonical promotion is built."*

**The operator has superseded that product policy for AFL Tables current-season data.** The
normal successful path must be automatic; human intervention becomes an exception path only.

ISSUE-122 builds the **S-E stage** that `AFLDB-ISSUE-099` §7 named and left unbuilt, together
with the prerequisites its §16 recorded as A1–A7.

**Target outcome.** Once AFL Tables publishes a valid new completed AFL game, AFLDB
automatically gains the canonical match and all safely available dependent AFL Tables data,
with no administrator clicking approve.

---

## 2. Issue identity [CONFIRMED]

`AFLDB-ISSUE-122` is a **new** issue. Verified during planning:

- `IssuesIndex.md:27` declares `AFLDB-ISSUE-122` the next free ID; a repository-wide grep for
  `ISSUE-12[2-9]` across `*.md`, `*.ts`, `*.sql`, `*.py` returns only that declaration.
- No open issue owns this scope. The four open issues are `AFLDB-ISSUE-104` (a `data_issues`
  dedup precondition, currently unreachable), `AFLDB-ISSUE-110` (NL semantic mapping),
  `AFLDB-ISSUE-113` (`brownlow_season_votes` legacy writer) and `AFLDB-ISSUE-116` (Data QA
  anchor timing).
- Every dependency is **Resolved**: `AFLDB-ISSUE-096` (contract, migration 074),
  `AFLDB-ISSUE-099` (settle pass, migration 076), `AFLDB-ISSUE-086` (`data_overrides` authority,
  migrations 073/075/078), `AFLDB-ISSUE-095` (`club_seasons` derivation), `AFLDB-ISSUE-101`
  (rollover planner).

---

## 3. Root cause — the first wrong layer [CONFIRMED]

### 3.1 The exact boundary

**`recordOutcome()` — `src/lib/acquisition/settle-afltables.ts:2353-2487`.**

A valid, fully resolved, promotable observation reaches the non-refusal `else` branch at `:2439`,
increments `observationsCorrected`, and falls into the **only** terminal action the function
has:

```ts
// settle-afltables.ts:2445
const candidate = draftCandidate({ contract, externalRecordId, outcome, season,
                                   targetTable, targetId, currentValues });
// settle-afltables.ts:2458-2484
INSERT INTO promotion_candidates (...) VALUES (...)
  ON CONFLICT (source_id, family, external_record_id, target_table)
    WHERE status = 'pending' DO UPDATE SET ...
```

`recordOutcome` has no other terminal branch: `unchanged` returns at `:2377`, `history_only` at
`:2385`, `absent` at `:2389`, and every refusal verb falls through to the same insert. **There is
no branch that writes canonical data.** That is the precise function-and-line boundary at which
a valid AFL Tables observation stops progressing toward canonical mutation.

The prohibition is additionally encoded in the type system:
`SettleCounters.canonicalRowsInserted: 0` and `canonicalRowsUpdated: 0` are **literal-zero
types** (`settle-afltables.ts:1327-1329`), and the module header `:1268-1272` enumerates every
table it never writes.

### 3.2 The four independent blocks behind it

| # | Block | Evidence |
|---|---|---|
| **B1** | No canonical writer exists anywhere in `src/lib/acquisition/*`. Exhaustive DML grep yields only `staging.source_*`, `staging.afltables_*`, `import_batches`, `data_issues`, `import_rejections`, `promotion_candidates`. Reads of the four canonical targets are `SELECT` only (`settle-afltables.ts:2082-2218`) | grep |
| **B2** | `evaluateAcceptRequest` returns `write: { implemented: false, blockedBy: 'canonical_write_unimplemented' }`, and `'accept'` is **unrepresentable**: `PromotionDecisionDraft`'s decision union has no `'accept'` member | `promotion-review.ts:29-36`, `:709-719`, `:752-772` |
| **B3** | The shipped authority provider is `UNAVAILABLE_MANUAL_AUTHORITY = () => 'indeterminate'`, so every resolved-target diff refuses with `manual_authority_conflict` | `observations.ts:398`; gate at `reconciliation.ts:574-591` |
| **B4** | `match_period_scores` and `brownlow_round_votes` carry **no `source_id` column**, so `ownershipForTarget()` returns `{state:'indeterminate'}` → `foreign_owned_collision`. Those two targets can never produce a promotable candidate | `settle-afltables.ts:200-211`; `reconciliation.ts:146-148`; ISSUE-099 F5 |

`evaluateAcceptRequest` / `runPromotionGates` / `renderReviewItem` / `buildRejectDecision` have
**zero non-test callers** (only `tests/current-season-import.test.ts:1987-2475`). There is no
promotion-review UI, no admin route, no API handler under `src/app/`. So "remove routine review
from the normal path" is not a removal: the queue simply accumulates and nothing consumes it.

### 3.3 The reconciliation gate order — reused unchanged [CONFIRMED]

`reconcile()` (`src/lib/acquisition/reconciliation.ts:467-614`) is **already** the "determine
safe canonical mutation" stage. It returns a proposal instead of writing:

1. stale review (`:475-484`)
2. absence, only inside an enumerated scope (`:487-497`)
3. projection-column gate, then `decideObservation()` (`:500-508`)
4. unchanged, by the family hash contract alone (`:512-514`)
5. identity — no source creates an identity (`:518-524`)
6. no projected fact moved ⇒ `history_only` (`:541-543`)
7. ownership containment (`:547-555`)
8. corroboration — disagreement between independence groups blocks (`:557-565`)
9. manual authority, last and strongest (`:574-591`)
10. `{ kind: 'candidate', verb }` (`:594-613`)

ISSUE-122 adds **no new judgement**. It adds the write that gate 10 has always described.

### 3.4 The Squiggle/Kali canonical defect [CONFIRMED]

`src/lib/external-afl/current-season-import.ts:922-943` is today's **only** automatic canonical
writer:

```sql
UPDATE matches
   SET home_score, away_score, home_goals, home_behinds, away_goals, away_behinds,
       result, winner_club_id, margin,
       source_id        = ${sourceId},              -- :940
       source_record_id = ${match.externalGameId},  -- :941
       import_batch_id  = ${batchId}                -- :942
 WHERE id = ${localMatchId}
```

It has:

- **no ownership predicate** — the `WHERE` is `id = ${localMatchId}` only. It will overwrite an
  `afltables`-owned row and **stamp its own `source_id` over the previous owner's**, silently
  transferring ownership;
- **no `data_overrides` check**, and there is no TypeScript equivalent of Python's
  `replay_admin_overrides` (`tools/migration/common.py:893`), so an admin score correction made
  through `/admin/data-editor` is silently reverted on the next current-season run;
- **no `data_edits` audit row** for the canonical mutation;
- only `refreshSeasonMetadata(tx, season)` afterwards (`:948-950`) — a private reimplementation
  of `recomputeSeasonMetadata` — so `club_seasons` and every player aggregate go stale after a
  score correction.

INSERT is structurally impossible: `planCurrentSeasonCanonicalWork` hard-returns
`canonicalRowsInserted: 0` (`:533`) and `--insert-missing-matches` throws
(`tools/current-season/update-current-season.ts:42-45`).

This is recorded here as confirmed current-state evidence and is repaired by ISSUE-122 §11,
because this issue is already changing source authority.

---

## 4. Approved source-authority decisions

Operator decisions, 2026-09-02. **Do not re-litigate these.** Only current repository evidence
proving one technically impossible or unsafe may reopen one.

1. **fitzRoy / AFL Tables is the primary authoritative source** for current-season AFL match
   data.
2. **Valid AFL Tables current-season data is written into canonical tables automatically.**
   Routine human review is not wanted.
3. **Human/admin intervention is an exception path only**, for data that cannot be safely
   resolved or applied.
4. **Squiggle and Kali AFL Stats remain in the repository as deprecated fallback sources**, and
   their canonical `matches` write is **retired** (§11).
5. Squiggle/Kali **must not participate in or block** the normal AFL Tables ingestion decision.
6. Their source registrations, provenance history, clients, parsers, registry entries and
   useful tests are **retained**.
7. **No silent failover.** Any future fallback write authority requires its own bounded
   ownership contract and separate approval.
8. Existing manually owned or foreign-authority canonical facts are **never silently
   overwritten**.
9. The observation/history architecture is **preserved** — remove routine review, not
   provenance infrastructure.
10. **Scheduling:** provision R + the pinned fitzRoy on the production droplet and add a
    systemd service/timer pair mirroring `deploy/afldb-email-intake.{service,timer}`.
11. **Audit:** a new append-only `canonical_applications` ledger for machine mutations.
    `promotion_decisions` stays human-only; `admin_user_id` stays `NOT NULL`; `afldb_import`
    gets no access to human decision records.
12. **Identity, per grain.** These are the headline statements; §7.3 and §9 carry the
    authoritative detailed behaviour and are not overridden by this summary.
    - **Unresolved player identity is a human exception**, isolated to that dependent
      player-grain record. The match and every other player still land.
    - **Unresolved club identity is a human exception** that fails closed for that match family
      (the match and its period scores). Other matches are unaffected.
    - **An unmapped venue is not an identity exception.** `venue_raw` is preserved and
      `venue_id` stays NULL under the confirmed existing canonical contract (§7.3). It is
      counted, not refused.
    - **No source creates an identity**, no fuzzy or name-only fallback, and no new admin UI
      unless evidence proves no existing resolution path is usable.

**Documents superseded by these decisions** (edit in place, retain the prior text as lineage):
`docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §0 rule 3 and §4 rule 10;
`AFLDB-ISSUE-096` §6's closing sentence; `AFLDB-ISSUE-099` §15, for ISSUE-122's scope only.

---

## 5. Target architecture [PLANNED]

Keep the entire ISSUE-099 pipeline. Add one stage and complete four prerequisites.

```
acquire (R)  →  emit bundle (Python, offline)  →  validate (TypeScript, offline)
   →  ONE sql.begin
        import_batches
        per record:  spine  →  typed projection  →  per target:
              resolveTarget → proposedValues → corroborationClaims → reconcile()
                 ├─ unchanged / history_only / absent   → no write
                 ├─ refusal verb                        → promotion_candidate  (exception queue)
                 └─ candidate (new | corrected)
                        └─ autoApplyEligible?
                             ├─ no  → promotion_candidate  (exception queue)
                             └─ yes → SAVEPOINT
                                        re-run every gate against re-read state
                                        write canonical row + provenance quartet
                                        INSERT canonical_applications
                                      RELEASE          ← THE NEW STAGE
        absence sweep · data_issues · derived recompute (once, season-scoped)
        batch counters
      --apply commits · --dry-run rolls back
```

### 5.1 Auto-apply eligibility [PLANNED]

All conditions must hold. Every one is re-evaluated **inside the savepoint**, against state
re-read in the same transaction — nothing is trusted from earlier in the run.

| # | Condition |
|---|---|
| E1 | `reconcile()` returned `{kind:'candidate'}` with verb `new` or `corrected` |
| E2 | The season is listed in `data/reference/seasons.json.in_progress_seasons` |
| E3 | **Insert:** no canonical row exists for the identity. **Update:** `target.source_id` resolves to `afltables` — see §7.2; `source_id IS NULL` is **not** sufficient |
| E4 | The manual-authority provider (§8) answers `'clear'`, asked **unconditionally**, including for a `new` target |
| E5 | The canonical baseline hash recomputed inside the savepoint equals the one the proposal was derived from (`stale_canonical_target`) |
| E6 | For `matches`: the source record carries `has_player_rows` — the completion predicate, §9.5 |

Anything else: no canonical write, a `promotion_candidates` refusal row, a counter, and where
applicable a `data_issues` row. **Fail closed. There is no force flag, no override and no
bypass.**

### 5.2 `promotion_candidates` is the exception queue only [PLANNED — binding]

**A successfully auto-applied record creates no promotion candidate.** The automatic path must
never write a candidate and then mark it `accepted`.

- No `promotion_candidates` row is inserted or refreshed on the success path.
- No `promotion_decisions` row is ever written by the machine. `promotion_decisions` is granted
  to `afldb_auth` as `SELECT, INSERT` only, with `admin_user_id NOT NULL`
  (`074_source_observation_spine.sql:255-338`); writing one would require widening a boundary
  migration 074 deliberately set. It stays the **human** review ledger.
- If a **pending candidate already exists** for a `(record, target)` that now auto-applies
  successfully, it is **left pending** and counted as `candidatesMootLeftPending`. It is not
  machine-retired, not marked accepted, and no admin decision is fabricated — the
  `AFLDB-ISSUE-099` F7 invariant is preserved exactly. `evaluateAcceptance` already refuses such
  a candidate with `stale_review` once `source_version_seq` moves.

After ISSUE-122 the pending queue is the **exception surface**: every record that could not be
applied automatically appears in it, with its reason. It is **not** a set of records that are all
*currently* unresolved — under the F7 rule above, a candidate raised before its record later
applied cleanly is deliberately left pending rather than retired, and is reported as **moot**.
The `--report` path must therefore distinguish live exceptions from moot candidates, so the queue
is never read as a backlog of outstanding work when it is not one.

---

## 6. Automatic-ingestion state machine [PLANNED]

Per `(source record, target table)`, after `reconcile()`:

| Reconciliation outcome | Spine | Typed projection | Canonical | Ledger | Candidate | `data_issues` |
|---|---|---|---|---|---|---|
| `unchanged` | head refreshed | refreshed | none | none | untouched | none |
| `history_only` | version appended | updated | none | none | left pending, counted | none |
| `absent` | `absent_since` stamped | retained | **none, ever** | none | none | none |
| `candidate:new`, eligible | version appended | updated | **INSERT** | one `insert` row | **none** | none |
| `candidate:corrected`, eligible | version appended | updated | **UPDATE** | one `update` row | **none** | none |
| `candidate:*`, ineligible | version appended | updated | none | none | refusal candidate | per class |
| `unresolved_identity` | version appended | **no row** | none | none | refusal candidate | none — `import_rejections` is the record |
| `foreign_owned_collision` | version appended | updated | none | none | refusal candidate | none — the candidate is the record |
| `source_disagreement` (advisory, §10) | version appended | updated | **write proceeds** | one row | none | **one open row, deduplicated** |
| `manual_authority_conflict` | version appended | updated | none | none | refusal candidate | none |
| write raises inside the savepoint | version appended | updated | rolled back to savepoint | none | refusal candidate | **one `canonical_apply_failed` row** |

**Idempotence.** A rerun over identical source data yields `unchanged` at gate 4 — before
identity, ownership, authority or any write is considered. Zero canonical writes, zero ledger
rows, zero payload rows, zero version rows, zero new candidates, zero new `data_issues` rows.

**A → B → A.** Three `source_record_versions` rows over two `source_payloads` rows (the existing
074 contract, `:61-64`, `:96-99`), and **two** `canonical_applications` rows — one `update` to B,
one `update` back to A. The source history remains visible even though the canonical value
returned to A. This is the required distinction between source-history append and canonical
value mutation.

**Absence is never deletion.** `absent_since` is stamped on the record head only, inside a
proven-complete enumerated scope. No canonical row is ever deleted or nulled, and no ledger row
is written. `canonical_applications.verb` has no `'delete'` member (§12).

---

## 7. Per-table ownership and write rules [PLANNED]

### 7.1 Write rules

| Target | Conflict key | Absence of a value means | Rule |
|---|---|---|---|
| `matches` | `match_key` — the bundle's `external_record_id`, used **verbatim** | n/a | INSERT on `new`; UPDATE by `id` on `corrected`, touching only the changed proposed fields. Attendance: non-NULL ⇒ `attendance_status='complete'` + `attendance_source_id=afltables`; NULL ⇒ `'not_collected'` + NULL. **NULL is never 0**; a genuine `0` is storable precisely because it cites a source (`matches_zero_attendance_ck`, migration 020). Never the literal `'Unknown'` for a venue. |
| `match_period_scores` | `(match_id, club_id, period)` | **no row** — never a delete | Upsert, periods 1–4 only, cumulative-to-date as published. A side/period whose goals, behinds **and** points are all NULL writes no row. Extra time is never invented. Requires the canonical match to exist in the same savepoint. |
| `player_match_stats` | `pms_player_match_uq (player_id, match_id)` | **NULL, never 0** | Upsert. 21 statistics mapped through `STAT_MAP` **by explicit name**, never by CSV column position (`import_fitzroy_core.py:123-146`). `Time.on.Ground` has no target column and is not projected. Requires a resolved `external_identities` player. |
| `brownlow_round_votes` | `brownlow_round_uq (season, player_id, round_number)` | **no row** — NA ≠ 0, never a filler row | Insert/update only where `Brownlow.Votes` is non-NULL. Home-and-away rounds only (`FINALS_CODES` excluded). `brownlow_season_votes` is **never** written and no season total is derived from a partial round set. Expect **zero** rows in-season until the count — that is correct, not a defect. |

Provenance stamped on every written row: `source_id = afltables`, `source_record_id =
external_record_id`, `import_batch_id`, `imported_at`.

**`match_key` hazard [CONFIRMED].** Three incompatible renderings exist in the repository:
`src/db/queries/match-admin.ts:222` uses club **IDs**; `src/lib/ingest/datasets.ts:545-546` uses
club **names**; Python `match_key_of()` (`import_fitzroy_core.py:1596-1600`) uses resolved
**historical** club names. The bundle's `external_record_id` is byte-identical to the Python
rendering (`source-families.json:286`). **The applier must use it verbatim and must not reuse
`createMatch()`** — a wrong rendering inserts a duplicate fixture instead of conflicting.

### 7.2 Ownership classification [PLANNED — revised after evidence]

| State | Deterministic test | Automatic behaviour |
|---|---|---|
| **No row** | no `matches.match_key` match | INSERT permitted (E1–E6) |
| **AFL Tables-owned** | `source_id` resolves to `afltables` | UPDATE permitted |
| **Foreign source-owned** | `source_id` resolves to another source key | refuse `foreign_owned_collision` |
| **Manually corrected** | an **active** `data_overrides` row covers the field group, or `attendance_source_id` resolves to `manual_admin_edit` | refuse `manual_authority_conflict` |
| **Source-less / legacy** | `source_id IS NULL` | **refuse `ownership_indeterminate`.** Not adopted automatically — see below |
| **Ambiguous / unreadable** | any ownership query fails or returns an inconsistent shape | refuse, fail closed |

**`source_id IS NULL` is not sufficient authority.** This was tightened during planning against
repository evidence:

- `applyDataEdit` stamps `attendance_source_id = 'manual_admin_edit'` for the attendance group
  but **does not re-stamp `matches.source_id`** for the score group
  (`src/db/queries/data-edits.ts:300-308`, `:403`; recorded at `AFLDB-ISSUE-096` §7). A
  human-corrected score therefore leaves `source_id` untouched.
- `createMatch` (`src/db/queries/match-admin.ts:243`) writes a human-created match with **no**
  `source_id` and **no** `import_batch_id`. When attendance is NULL,
  `matches_attendance_status_ck` forces `attendance_source_id` NULL too, so such a row can carry
  **no manual marker at all**.
- `src/lib/ingest/datasets.ts:549` (CSV/email ingest promote) upserts `matches` on `match_key`
  with neither `source_id` nor `import_batch_id`.
- `afldb_import` holds **INSERT only** on `data_edits` (`tools/maintenance/privileges.sql:296`;
  `afldb_auth` has `SELECT, INSERT` at `:403`), so the settle role **cannot read edit
  provenance**, and granting it SELECT would widen a deliberate boundary (stop condition SC5).

Therefore a source-less row cannot be proven unowned from anything the settle role can read.
The generic `evaluateOwnership()` (`observations.ts:362-368`) still returns `'ok'` for a NULL
owner and is **not changed** — the extra condition lives in ISSUE-122's auto-apply eligibility
predicate E3, which is strictly stronger than the generic gate. Generic semantics are untouched;
only the automatic path is narrowed.

Source-less rows route to the §14 reviewed transition.

### 7.3 Unresolved venue is not a failure [CONFIRMED]

Proven from schema, writers and existing tests — this is not a policy assumption:

- `src/db/migrations/003_matches.sql:35-37` — `venue_id integer REFERENCES venues(id)` is
  **nullable**, `venue_raw text NOT NULL`, above the comment *"Venue canonicalisation is a later
  enrichment pass, so venue_id is nullable while venue_raw is always populated."*
- `003_matches.sql:74-75` — `COMMENT ON COLUMN matches.venue_id IS 'Nullable by design: venue
  canonicalisation is an enrichment pass. venue_raw is authoritative until then.'`
- `003_matches.sql:81` — `CREATE INDEX ix_matches_venue ON matches (venue_id) WHERE venue_id IS
  NOT NULL`. A partial index over the non-NULL subset only makes sense where NULLs are expected.
- `002_core_entities.sql:86` — *"enrichment pass, so venue_id is nullable everywhere it is
  referenced."*
- Migration 076 restates it for the settle projection: `:51-53`, `:79`, `:218`, `:231-232`.
- Existing tests already pin the behaviour:
  `tests/current-season-import.test.ts:3147-3154` (*"proposes the matches field set, keeping
  venue_id NULL rather than inventing a venue"*, asserting `values.venue_id` is null), and
  `tests/integration/settle-afltables.test.ts:36`, `:322`, `:1076` exercise the unmapped-venue
  path against real PostgreSQL.
- **No read path is harmed.** All ten match read paths use `LEFT JOIN venues`
  (`match-admin.ts:73`, `:92`; `match-search.ts:116`; `matches.ts:35`, `:91`, `:190`, `:267`;
  `player-compare.ts:162`; `players.ts:648`; `search.ts:324`). The single inner `JOIN venues`
  in the repository (`src/lib/ingest/datasets.ts:181`) is a venue-alias candidate lookup, not a
  match read path.

**Rule:** an unmapped venue leaves `venue_id` NULL, `venue_raw` carrying the real source string,
and increments `venueUnmapped` (`settle-afltables.ts:1824-1828`). It is **not** a refusal and
**never** creates a `venues` or `venue_aliases` row. The historical importer creates venues
(`import_venues`, ISSUE-099 F4) and is forbidden here, so NULL is the settle path's designed
outcome; §15 includes a measurement of how many canonical rows this actually produces.

---

## 8. Manual-authority provider [PLANNED]

New module `src/lib/acquisition/manual-authority.ts` — a real `ManualAuthorityProvider`
replacing the `UNAVAILABLE_MANUAL_AUTHORITY` stub, queried **inside** the transaction so the
answer cannot go stale between check and write (`AFLDB-ISSUE-096` §7 requirement 2).

**For `matches`.** Read
`SELECT field_group FROM data_overrides WHERE entity_type='matches' AND entity_key=:match_key
AND is_active`, then map the proposal's changed fields onto `src/lib/edit/spec.ts` field groups
— `attendance`, `score`, `match_time`, `match_event`, `notes` (`spec.ts:129-144`). Any
intersection ⇒ `'conflict'`. Additionally, `attendance_source_id` resolving to
`manual_admin_edit` ⇒ `'conflict'` for the attendance field.

**For `match_period_scores`, `player_match_stats`, `brownlow_round_votes`.** Migration 073's
`data_overrides.entity_type` CHECK admits only `players`, `matches`, `draft_picks`
(`073_data_overrides.sql:11-27`), and `src/lib/edit/spec.ts` exposes no editor entity for any of
the three. An override for them is therefore **unrepresentable at the database level**,
therefore provably absent, therefore `'clear'`.

This is proven, not assumed, and **`AFLDB-ISSUE-099` A4 is satisfied without widening the 073
CHECK**. A test pins both the CHECK literal and the editor spec's entity set; the provider
answers `'indeterminate'` (refuse) if either ever changes.

**`data_edits` is deliberately not consulted.** `afldb_import` holds INSERT only on it
(`privileges.sql:296`), and `AFLDB-ISSUE-096` §7 declares it audit evidence rather than the
authority record. `data_overrides` is the authority record, and `applyDataEdit` writes one in
the **same transaction** as every canonical edit (`data-edits.ts:216-241`, upsert at `:231`), so
the authority question is fully answerable from a table the settle role can already read. **No
grant is widened.** A privileges test asserts `afldb_import` still has no SELECT on `data_edits`,
so if that ever changes this assumption is revisited rather than silently outgrown.

Any query error or unexpected shape ⇒ `'indeterminate'` ⇒ refuse. There is no force flag.

---

## 9. Exception and fail-closed policy [PLANNED]

### 9.1 Failure isolation

| Failure class | Isolation granularity |
|---|---|
| Unresolved **player** identity | that one `afltables.player_match_stats` record only, covering both its targets. The match and every other player still land |
| Unresolved **club** | the match family (match + period scores). Other matches unaffected |
| Unresolved **venue** | **not a failure** — §7.3 |
| No canonical match yet for a player-grain row | that player record only |
| Constraint violation during the write | that savepoint's unit only; `data_issues` row, counter, run continues |
| Structural contradiction — malformed score, duplicate match identity, inconsistent participants, impossible player/club relation | rejected in Python `scan_results()` / `scan_player_stats()` before the bundle exists; nothing reaches PostgreSQL |
| Bundle, manifest or contract drift | the **whole run** refuses before PostgreSQL is opened (`AFLDB-ISSUE-099` §21 S-C) |

**Structural contradiction versus ordinary unresolved identity.** A contradiction is a source
record that cannot be true (goals/behinds not reconciling with points, margin disagreeing with
scores, two distinct non-NULL attendance values, a duplicate `match_key`, a player row that
joins no results row). These are already refused by the Python scan layer and by the migration
076 CHECK constraints. An unresolved identity is a record that may well be true but whose
canonical referent is unknown. Contradictions refuse the record; unresolved identities refuse
only the dependent row.

### 9.2 `data_issues` and `AFLDB-ISSUE-104` [PLANNED]

Apply failures open a `data_issues` row with a **new `issue_type` of `canonical_apply_failed`**
and `issue_key = afltables|apply|<family>|<record>|<target>`.

Migration 076's partial unique index is `(issue_type, issue_key) WHERE issue_key IS NOT NULL AND
resolved_at IS NULL` (`076:434-436`). Because ISSUE-122's writer uses a **distinct
`issue_type`** from ISSUE-099's `source_disagreement`, the two writers can never contend for the
same index entry, so `AFLDB-ISSUE-104`'s hazard — a foreign writer's open row being refreshed
through `ON CONFLICT` — cannot arise. This satisfies ISSUE-104's binding precondition without a
migration and **without editing frozen migration 076**.

`AFLDB-ISSUE-104` stays **open**; its general hazard is unchanged. A test pins the distinct
`issue_type` so the proof cannot silently lapse.

### 9.3 The exception report [PLANNED]

Per unresolved record the report and the durable record must carry: source (`afltables`); source
family; `external_record_id`; `source_version_seq`; canonical match identity; source player
name; AFL Tables profile URL / provider identity where present; season; club context; affected
target family; the exact resolution failure reason; and **whether the canonical match itself was
successfully applied**.

Use existing infrastructure — `import_rejections` (which already carries batch, source record,
reason and payload; `settle-afltables.ts:2395-2403`), `promotion_candidates` as the queue, and
the CLI `--report` path (`tools/current-season/settle-afltables.ts:162-203`). **No new admin UI**
unless implementation evidence proves no existing resolution path is usable; if it does, stop and
record it rather than building one.

**Retry after resolution.** The next run re-reads `external_identities` in `loadRefs()`
(`settle-afltables.ts:1416-1423`). Because the source payload is unchanged, `reconcile()` returns
`unchanged` at gate 4 and would skip the retry. **The applier must therefore key retry on target
state, not on payload change**: for a record whose projection resolved but whose target row is
absent or stale, the settle must re-evaluate the target even when the observation is unchanged.
Implement this as an explicit `targetNeedsApply` check evaluated after `decideObservation`, and
prove it with a test: resolve a debutant's identity, rerun the identical bundle, and assert the
player's `player_match_stats` row now lands while everything else stays at zero writes.

**Resolved exceptions stop appearing without deleting evidence.** A pending candidate whose
record subsequently applies is left pending and reported as moot (§5.2); an open
`canonical_apply_failed` `data_issues` row is **resolved** by the ownership-scoped resolution
path ISSUE-099 already implements (`resolveRestoredDisagreements`,
`settle-afltables.ts:2335-2352`), never deleted.

### 9.4 Debutant / new-player policy [PLANNED — binding]

ISSUE-122 must **not** auto-create canonical players, must **not** create `external_identities`
mappings from a profile URL alone, and must **not** use name-only or fuzzy fallback. The
standing "no source creates an identity" rule (`AFLDB-ISSUE-092` / `-096` / `-099`) is preserved.
The canonical match still lands when match-level identity and completeness are safe. Run-level
counters `unresolvedIdentity{player,club,venue,match}` already exist
(`settle-afltables.ts:1291-1331`). If routine debutant onboarding proves operationally painful,
record it as a **separate follow-up issue** — do not weaken the identity boundary inside
ISSUE-122.

### 9.5 The completion predicate [CONFIRMED]

`MatchFact.has_player_rows` — `tools/migration/import_fitzroy_core.py:1137`, set `True` at
`:1515-1518` when a `player_stats` row joins the match on `(match_date, home_hist, away_hist)`,
and enforced at `:1909-1912`:

```python
elif not fact.has_player_rows:
    rejection = {"reason": "incomplete_match_evidence",
                 "detail": "no player_stats row joined to this match"}
```

There is **no boolean "completed" column** in the AFL Tables results feed; `results.csv` contains
only played matches, which is why the settle sets `recordState: 'played'` and `scheduleFields:
[]` (`settle-afltables.ts:1763-1765`). Incomplete future fixtures are handled by the separate
`AFLDB-ISSUE-100` staging-only lineup domain and are **never** canonical. ISSUE-122 changes
neither semantic.

---

## 10. Squiggle / Kali corroboration must not block [PLANNED]

`reconciliation.ts:557-565` currently refuses on **any** disagreeing independence group, which
would let a deprecated source veto an AFL Tables canonical write — incompatible with approved
decision 5.

Smallest safe change: declare `corroboration_policy: "blocking" | "advisory"` per family in
`data/reference/source-families.json`, **defaulting to `blocking`** so anything undeclared keeps
today's fail-closed behaviour. Declare `afltables` / `match` and `afltables` /
`player_match_stats` as `advisory`.

Under `advisory`, `classifyCorroboration()` still runs, `agreeing_groups` / `disagreeing_groups`
are still recorded on the ledger row, and the `source_disagreement` `data_issues` row is still
opened and deduplicated — but the write proceeds. **Evidence is preserved; only the veto is
removed.** Squiggle/Kali agreement is never required before an AFL Tables canonical write.

---

## 11. Squiggle / Kali deprecation and retirement [PLANNED]

### 11.1 Consumer audit [CONFIRMED]

| Classification | Sites |
|---|---|
| Network clients (retained) | `src/lib/external-afl/current-matches.ts:111`, `:159` — the only fetchers |
| Normal current-season ingestion (retained: acquisition, observation, staging) | `src/lib/external-afl/current-season-import.ts:17-18`, `:226-232`, `:249-260`, `:367`; `staging.external_current_matches` upsert `:820-835` |
| **Canonical write (RETIRED)** | `current-season-import.ts:870` guard, `:922-943` UPDATE, `:985` counter; `writeMatches(:749)` `updateMatches` parameter |
| Corroboration (retained as advisory, §10) | `reconciliation.ts:213-254`, `:557-565`; `current-season-import.ts:150-223`, `:509-531`, `:890-909` |
| Source registration / historical provenance (retained) | `063_external_current_match_sources.sql:10-16`; `074:37`, `:100` |
| Registry declarations (retained) | `data/reference/source-families.json:13-28`, `:56-75`, `:105-241` — both match families already carry `promotion_policy: never` (`:136`, `:177`) |
| Diagnostic / probe (retained) | `docs/acquisition/AFLDB-2026-API-ACQUISITION.md`; `.agents/skills/afldb-api-data-debug/SKILL.md` |
| Test-only (retained) | `tests/current-season-import.test.ts` (178 refs), `tests/reference-data.test.ts:453-553`, `tests/integration/settle-afltables.test.ts`, `tests/integration/observation-spine.test.ts` |
| Operational surface (updated) | `src/app/admin/current-season/actions.ts:45-49`, `:56`, `:66`; `CurrentSeasonControls.tsx:232-234`, `:242`; `page.tsx:41`; `tools/current-season/update-current-season.ts:47`, `:55`, `:110` |

### 11.2 The retirement change [PLANNED]

**Smallest safe change — remove the canonical write, keep everything else.**

1. `src/lib/external-afl/current-season-import.ts` — delete the `updateMatches` option from
   `CurrentSeasonImportOptions` (`:30`), the `if (updateMatches)` branch and its `UPDATE matches`
   (`:870-943`), and the `canonicalRowsUpdated` accumulation (`:985`). The corroboration
   analysis, staging upsert, observation spine writes, absence sweep and reporting all remain,
   so the source keeps its diagnostic and staging value. `canonicalRowsInserted` /
   `canonicalRowsUpdated` become **structurally** 0 for this path, matching the already-hardcoded
   insert behaviour at `:533`.
2. `tools/current-season/update-current-season.ts` — remove `--update-matches` (`:55`) and its
   help line (`:110`). A supplied `--update-matches` must **fail with an explanatory error**
   naming ISSUE-122, not be silently ignored — the same treatment `--insert-missing-matches`
   already receives at `:42-45`.
3. `src/app/admin/current-season/actions.ts` — remove `updateMatches` (`:49`, `:56`, `:66`).
4. `src/app/admin/current-season/CurrentSeasonControls.tsx:242` — remove the "Overwrite existing
   resolved final scores" checkbox. `page.tsx:41` copy updated to describe a staging/diagnostic
   refresh.
5. `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §3 and §5 — mark Squiggle/Kali **deprecated
   fallback, non-writing**, retaining the prior text as lineage.
6. Tests: the four `updateMatches` references in `tests/` are updated to assert the canonical
   write **no longer exists**; no useful coverage is deleted.

**Not done:** no source row, registry entry, provenance history, client, parser or independence
declaration is removed, and **no replacement fallback writer is introduced**. A future fallback
canonical authority requires its own bounded ownership contract and separate approval
(decision 7).

---

## 12. Migration [PLANNED]

### 12.1 Number

This worktree holds `076`–`079`, `081`, `082`; `080_external_grids.sql` belongs to
`opus/gridley-corpus` (`IssuesIndex.md:21-23`). **The implementation session must derive the
number from every live branch tip before naming the file** — command in §15.2. Do **not** assume
`083`.

Migrations 073, 074, 075 and 076 are applied and checksum-frozen. **Never edit them.**

### 12.2 Contents

**(a) Provenance completion — `AFLDB-ISSUE-099` A1, A2, A3.**

```sql
SELECT add_provenance_columns('match_period_scores');
SELECT add_provenance_columns('brownlow_round_votes');
ALTER TABLE player_match_stats ADD COLUMN source_record_id text;
```

`add_provenance_columns` (`001_foundations.sql:110-119`) adds `source_id smallint REFERENCES
sources(id)`, `source_record_id text`, `import_batch_id bigint REFERENCES import_batches(id)`
and `imported_at timestamptz NOT NULL DEFAULT now()`. `player_match_stats` already has
`source_id` and `import_batch_id` (`004:68-69`), so the helper cannot be used there — add the one
missing column explicitly. This closes block **B4**: both targets become ownership-determinate,
and `TARGETS_WITHOUT_SOURCE_ID` (`settle-afltables.ts:200-203`) becomes empty.

**(b) FK-covering indexes** for every foreign key the migration creates, or
`tests/integration/fk-indexes.test.ts` fails.

**(c) `canonical_applications` — the append-only machine mutation ledger.**

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | |
| `import_batch_id` | `bigint NOT NULL REFERENCES import_batches(id)` | the run |
| `source_id` | `smallint NOT NULL REFERENCES sources(id)` | |
| `family` | `text NOT NULL` | contract family, not the dotted wire name |
| `external_record_id` | `text NOT NULL` | |
| `source_version_seq` | `integer NOT NULL` | the exact evidence version |
| `target_table` | `text NOT NULL` | CHECK in the four canonical targets |
| `target_key` | `jsonb NOT NULL` | the stable natural key, e.g. `{"match_key":…}`, `{"player_id":…,"match_id":…}` |
| `verb` | `text NOT NULL` | `CHECK (verb IN ('insert','update'))` |
| `previous_values` | `jsonb` | `NULL` **iff** `verb='insert'` — enforced by CHECK |
| `new_values` | `jsonb NOT NULL` | |
| `applied_at` | `timestamptz NOT NULL DEFAULT now()` | |

**Source-version binding [CONFIRMED].** `staging.source_record_versions` declares
`PRIMARY KEY (source_id, family, external_record_id, version_seq)` at
`074_source_observation_spine.sql:79`. That is a real primary key and is exactly the key
`promotion_candidates` already references (`074:178-179`). The ledger binds to it with the same
composite foreign key:

```sql
FOREIGN KEY (source_id, family, external_record_id, source_version_seq)
  REFERENCES staging.source_record_versions (source_id, family, external_record_id, version_seq)
```

**No uniqueness is invented or widened** — `ux_source_record_versions_open` (`074:91-93`) is a
*partial* index on open versions and is deliberately not used here, because the ledger must be
able to reference a version that has since been closed.

*Value-size policy.* `previous_values` and `new_values` carry **only the proposed field set for
that target** — never the source payload, which is already preserved immutably in
`staging.source_payloads`. A CHECK bounds each object to at most 64 keys, and the writer
serialises through `canonicalJson()` (`observations.ts:128`) so key order is deterministic. No
free-text or user-supplied content is stored.

*Indexes.* The composite FK cover `(source_id, family, external_record_id, source_version_seq)`;
`(target_table, applied_at DESC)` for audit queries; `(import_batch_id)` for the FK.

**(d) Grants — append-only by grant, mirroring `promotion_decisions` (`074:320-338`) and
`data_overrides` (`073`/`078`).**

Do **not** call `afldb_meta.grant_import_write()` — it grants
`SELECT, INSERT, UPDATE, DELETE, TRUNCATE` (`045:139-141`), far more than this table may allow.
Grant explicitly instead:

```sql
GRANT SELECT, INSERT ON canonical_applications TO afldb_import;
GRANT USAGE, SELECT ON SEQUENCE canonical_applications_id_seq TO afldb_import;
GRANT SELECT ON canonical_applications TO afldb_auth;
```

No `UPDATE`, no `DELETE`, no `TRUNCATE`, to any application role. No `afldb_app` grant — the
table is not a public read surface. **Register it in `tools/maintenance/privileges.sql`**: the
reconciler is subtractive and silently revokes anything missing from its lists.

### 12.3 Why nothing else is needed

The observation spine (074) and the settle projections (076) already carry everything the
automatic path requires: immutable payloads, ordered versions with valid-time intervals, absence
state, typed projections with real foreign keys, the pending-candidate unique index, and the
`data_issues.issue_key` dedup support. No change to `data_overrides.entity_type` is required
(§8). No change to `promotion_candidates` or `promotion_decisions` is required (§5.2).

---

## 13. Transaction boundaries [PLANNED]

| Boundary | Contents |
|---|---|
| **Outer `sql.begin`** — one per run, unchanged from `AFLDB-ISSUE-099` §21 (`settle-afltables.ts:1559-1641`) | `import_batches` row, refs, every spine write, both typed projections, every candidate, `data_issues`, `import_rejections`, the absence sweep, derived recompute, the batch completion UPDATE |
| **SAVEPOINT per match family** | the canonical `matches` row + its `match_period_scores` rows + their ledger rows. Both or neither: a match never exists with half its period scores |
| **SAVEPOINT per player-match record** | that record's `player_match_stats` + `brownlow_round_votes` + ledger rows. One debutant cannot reject 43 team-mates |
| **Derived recompute** | once per run, after every match, season-scoped, **only if** `canonicalRowsInserted + canonicalRowsUpdated > 0` |
| **`--dry-run`** | unchanged: the same write-capable transaction with real constraints and role privileges, deliberately rolled back via `SettleDryRunRollback` (`:1284-1289`, `:1639-1645`) |

**The canonical mutation and its `canonical_applications` row are always inside the same
savepoint**, so a committed canonical change without its audit row is impossible, and a
rolled-back attempt leaves no ledger row.

Independently available families are not forced together: an unresolved player-grain record does
not prevent the match family from landing, and vice versa.

**Derived recompute reuses existing code — build nothing.**
`src/db/queries/player-derived.ts` already provides `recomputeSeasonMetadata(tx, season)`
(`:509`), `recomputeClubSeasons(tx, season)` (`:410`), `recomputeSeasonBrownlowStatus(tx,
season)` (`:358`) and `recomputePlayerDerivedStats(tx, playerIds, season)` (`:24`), and its
header (`:19-22`) declares it the targeted counterpart of `rebuild_derived.py`, to be kept in
lockstep. Scope `recomputePlayerDerivedStats` to the player ids actually written.
**`AFLDB-ISSUE-099` A7 is answered: yes, `recomputeClubSeasons` runs.** Note the live divergence
recorded in §3.4 — `current-season-import.ts` calls only a private `refreshSeasonMetadata`; the
retirement in §11 removes the canonical write that made that divergence matter.

---

## 14. Existing 2026 canonical data — transition policy [PLANNED]

**Nightly behaviour: no adoption.** An existing 2026 `matches` row whose `source_id` is NULL or
foreign is **refused** with `ownership_indeterminate` / `foreign_owned_collision` and routed to
the exception queue. The automatic path only inserts rows that do not exist and only updates rows
`afltables` already owns (§7.2 E3).

**Reviewed transition, if §15.1 shows such rows exist.** An explicit, operator-run,
one-time `--adopt-foreign-2026` mode, **never part of the scheduled job**, requiring **both**:

*(i) the machine proves every condition, all readable by `afldb_import`:*

1. `matches.match_key` equals the bundle's `external_record_id` byte-for-byte — identity only,
   never fuzzy, never name similarity;
2. the identity fields agree exactly: `season`, `round_code`, `match_date`, `home_club_id`,
   `away_club_id`;
3. the current owner is `squiggle_api` or `kali_afl_stats`, or `source_id IS NULL`;
4. provenance coherence — if `source_id IS NULL` then `source_record_id IS NULL` **and**
   `import_batch_id IS NULL`; any mixture is incoherent and refuses;
5. **no** `data_overrides` row exists for `('matches', match_key)` — any `field_group`, **active
   or inactive**. This is stricter than the routine authority gate deliberately: an inactive
   override is still evidence a human once owned the row, and adoption is an irreversible
   ownership claim;
6. `attendance_source_id IS NULL` or it resolves to a key other than `manual_admin_edit`;
7. `legacy_match_id IS NULL` — a legacy-loaded row belongs to the historical baseline, not this
   pipeline;
8. the season is in `in_progress_seasons`.

*(ii) the operator supplies an explicit allowlist of `match_key`s*, produced from the §15.1
measurement and reviewed by hand. This closes the residual hole proven in §7.2: `createMatch`
with NULL attendance and the CSV ingest promote path can both leave a human-originated row
carrying **no** machine-readable manual marker. The machine cannot distinguish it, so it does not
try — a human authorises the exact set.

Both must agree. A key in the allowlist that fails any of 1–8 is refused, not forced.

**After adoption**, disagreeing values are applied as an ordinary `corrected` write with
`previous_values` / `new_values` recorded in `canonical_applications`. Adoption is idempotent:
once `source_id = afltables`, a rerun is an ordinary no-op. **Provenance is never rewritten
silently**, and no row is ever deleted and re-inserted.

If §15.1 shows every 2026 row is already `afltables`-owned or absent, **this section is not
implemented at all** — it becomes a recorded non-requirement.

---

## 15. Operator preflight (Stage S0) — before any code

### 15.1 Read-only SQL — measure existing 2026 canonical data

```sql
-- 1. Who owns the existing 2026 canonical matches?
SELECT COALESCE(s.key, '(source_id IS NULL)') AS owner,
       count(*) AS matches, min(m.match_date) AS first, max(m.match_date) AS last
  FROM matches m
  LEFT JOIN sources s ON s.id = m.source_id
 WHERE m.season = 2026
 GROUP BY 1 ORDER BY 2 DESC;

-- 2. Manual ownership markers on those rows
SELECT m.match_key, o.field_group, o.is_active,
       (m.attendance_source_id IS NOT NULL) AS has_attendance_source,
       (m.legacy_match_id IS NOT NULL)      AS is_legacy_loaded
  FROM matches m
  LEFT JOIN data_overrides o
         ON o.entity_type = 'matches' AND o.entity_key = m.match_key
 WHERE m.season = 2026
   AND (o.id IS NOT NULL OR m.attendance_source_id IS NOT NULL OR m.legacy_match_id IS NOT NULL);

-- 3. Existing 2026 dependent rows (expected 0 on a canonically rebuilt afldb_test)
SELECT (SELECT count(*) FROM player_match_stats p JOIN matches m ON m.id = p.match_id
          WHERE m.season = 2026)                                     AS pms,
       (SELECT count(*) FROM match_period_scores ps JOIN matches m ON m.id = ps.match_id
          WHERE m.season = 2026)                                     AS periods,
       (SELECT count(*) FROM brownlow_round_votes WHERE season = 2026) AS votes;

-- 4. Venue-mapping reality: how many canonical matches already carry a NULL venue_id?
SELECT season, count(*) FILTER (WHERE venue_id IS NULL) AS unmapped, count(*) AS total
  FROM matches WHERE season >= 2020 GROUP BY 1 ORDER BY 1;
```

**Interpretation and stop conditions.**

- Query 1 all `afltables` or zero rows ⇒ §14 is **not required**; record that and skip it.
- Any `squiggle_api` / `kali_afl_stats` / `(source_id IS NULL)` ⇒ §14 **is** required, and the
  count is the expected adoption volume.
- Any row returned by query 2 is **permanently human-owned or legacy-owned**. Record those
  `match_key`s in this runbook by name; §14 must refuse them and they never enter the allowlist.
- Query 3 non-zero on `afldb_test` ⇒ the database is not the canonical rebuild the runbook
  assumes. **Stop** and reconcile before implementing.
- Query 4 is context for §7.3, confirming NULL `venue_id` is an ordinary canonical state.

### 15.2 Migration number and host capability

```powershell
# Next free migration number across EVERY live branch tip — do not assume 083
git fetch --all --prune
git for-each-ref --format='%(refname)' refs/heads refs/remotes |
  ForEach-Object { git ls-tree -r --name-only $_ -- src/db/migrations } |
  Sort-Object -Unique | Select-String '^src/db/migrations/0\d\d' | Select-Object -Last 15
```

```bash
# Is R + the pinned fitzRoy available on the production host? Drives Stage S8.
ssh <prod> 'command -v Rscript && Rscript -e "cat(as.character(packageVersion(\"fitzRoy\")))"'
```

If `Rscript` is absent, S8's provisioning step is real work and must be scheduled; if the
installed fitzRoy version does not match `tools/rebuild/fitzroy/fitzroy-contract.json`'s pin,
`acquire_core.R:76`, `:150-152` will refuse — resolve the pin before scheduling.

---

## 16. Implementation stages

| # | Stage | Deliverable | Gate |
|---|---|---|---|
| **S0** | Preflight | §15 measurements executed and recorded in this file | stop conditions clear |
| **S1** | Migration | A1/A2/A3, FK indexes, `canonical_applications`, grants, `privileges.sql` registration. Applied to **`afldb_test` only** | `fk-indexes` 2/2, `privileges` green, `db:status` no drift |
| **S2** | Manual authority | `src/lib/acquisition/manual-authority.ts`; wired into the CLI in place of `UNAVAILABLE_MANUAL_AUTHORITY` (`tools/current-season/settle-afltables.ts:232`) | DB-free truth table + integration refusal case |
| **S3** | Ownership completion | `TARGETS_WITHOUT_SOURCE_ID` empties; `resolveTarget` reads real `source_id` for all four targets; E3's stricter auto-apply predicate | DB-free |
| **S4** | Corroboration policy | `corroboration_policy` in `source-families.json` + `source-families.ts`; `reconcile()` honours `advisory`, default `blocking` | `reference-data` + `current-season-import` |
| **S5** | The applier | `src/lib/acquisition/canonical-apply.ts` — four target writers, the ledger, savepoint isolation, `targetNeedsApply` retry; wired into `recordOutcome()`. `SettleCounters`' literal-`0` types become `number` | DB-free + integration |
| **S6** | Run integration | Derived recompute wiring; `--auto-apply` CLI flag; `npm run settle:afltables`; exception report; counters | end-to-end on `afldb_test` |
| **S7** | Squiggle/Kali retirement | §11.2 | `current-season-import` tests |
| **S8** | Scheduling | R + pinned fitzRoy on the droplet; `deploy/afldb-settle-afltables.{service,timer}`; `docs/deployment.md` | one supervised real run |
| **S9** | 2026 transition | §14, **only if** §15.1 requires it | idempotence + refusal tests |

### 16.1 Files expected to change

**New:** `src/lib/acquisition/manual-authority.ts`, `src/lib/acquisition/canonical-apply.ts`,
`src/db/migrations/<N>_canonical_auto_apply.sql`, `deploy/afldb-settle-afltables.service`,
`deploy/afldb-settle-afltables.timer`.

**Modified:** `src/lib/acquisition/settle-afltables.ts` (`recordOutcome`, `resolveTarget`,
`ownershipForTarget`, `TARGETS_WITHOUT_SOURCE_ID`, `SettleCounters`),
`src/lib/acquisition/reconciliation.ts` (advisory corroboration),
`src/lib/acquisition/source-families.ts`, `data/reference/source-families.json`,
`tools/current-season/settle-afltables.ts`, `tools/current-season/update-current-season.ts`,
`src/lib/external-afl/current-season-import.ts`,
`src/app/admin/current-season/{actions.ts,CurrentSeasonControls.tsx,page.tsx}`,
`tools/maintenance/privileges.sql`, `package.json`, `docs/deployment.md`,
`docs/acquisition/AFLDB-2026-API-ACQUISITION.md`.

---

## 17. Test and validation plan

Reuse the closest existing semantic homes per `CLAUDE.md` §10. `tests/current-season-import.test.ts`
is the declared DB-free home for this subsystem (its own comment at `:2551`);
`tests/integration/settle-afltables.test.ts` is the PostgreSQL home.

| # | Assertion | Home | DB |
|---|---|---|---|
| 1 | A new completed AFL Tables match appears canonically with no human action | `tests/integration/settle-afltables.test.ts` | yes |
| 2 | Rerunning the identical bundle is a total no-op: 0 canonical writes, 0 ledger rows, 0 payloads, 0 versions, 0 new candidates | same | yes |
| 3 | An upstream correction updates an AFL-Tables-owned fact and writes exactly one `update` ledger row | same | yes |
| 4 | A→B→A yields 3 version rows over 2 payload rows and **2** ledger rows | same | yes |
| 5 | Period scores populate cumulatively; an all-NULL side/period writes no row; extra time is never invented | `tests/current-season-import.test.ts` + integration | both |
| 6 | Attendance: NULL ⇒ `not_collected` + NULL source; a genuine `0` ⇒ `complete` + `afltables`; NULL is never 0 | `tests/current-season-import.test.ts` | no |
| 7 | `player_match_stats` land only for resolved identities, and **one debutant blocks neither the match nor the other players** | integration | yes |
| 8 | Brownlow: NA ⇒ no row; finals never polled; `brownlow_season_votes` untouched; zero rows in-season is the correct outcome | both | both |
| 9 | Unresolved player fails closed at its own record; unresolved club fails closed for the match family; unresolved venue is **not** a failure and writes `venue_id` NULL with the real `venue_raw` | integration | yes |
| 10 | An active `data_overrides` row on the `score` group refuses the write and leaves the canonical row byte-identical | integration | yes |
| 11 | A malformed record cannot partially create a match — savepoint rollback leaves neither the match nor its period scores | integration | yes |
| 12 | **Squiggle/Kali are never a prerequisite**: an AFL Tables write succeeds with zero corroboration claims present, and proceeds under `advisory` when a deprecated group disagrees while still opening the `data_issues` row | `tests/current-season-import.test.ts` | no |
| 13 | Squiggle/Kali retain acquisition, observation and staging; the canonical `UPDATE matches` path no longer exists and `--update-matches` errors explicitly | `tests/current-season-import.test.ts` | no |
| 14 | §14 adoption is idempotent and refuses manual-owned, override-covered (active **or** inactive), legacy-loaded and provenance-incoherent rows | integration | yes |
| 15 | `canonical_applications` is append-only for `afldb_import` — INSERT succeeds, UPDATE and DELETE are denied — and **no grant is widened**; `afldb_import` still has no SELECT on `data_edits` | `tests/integration/privileges.test.ts` | yes |
| 16 | Every new foreign key is index-covered | `tests/integration/fk-indexes.test.ts` | yes |
| 17 | `--dry-run` leaves every relation byte-identical, canonical tables and the ledger included | integration | yes |
| 18 | The authority-unrepresentable proof: migration 073's `entity_type` CHECK literal and `edit/spec.ts`'s entity set are both pinned | `tests/current-season-import.test.ts` | no |
| 19 | A canonical row can never exist without its `canonical_applications` row, and vice versa | integration | yes |
| 20 | Retry-after-resolution: resolving a debutant's identity and rerunning the identical bundle lands that player's row while everything else stays at zero writes | integration | yes |
| 21 | A successfully auto-applied record creates **no** promotion candidate, and an existing pending candidate is left pending, never marked accepted | integration | yes |

**Operator commands, in escalation order.**

```bash
# 1. DB-free
npm test -- tests/current-season-import.test.ts tests/reference-data.test.ts

# 2. Schema and privileges (afldb_test only)
npm run db:migrate:test && npm run db:privileges:test
npm test -- tests/integration/fk-indexes.test.ts tests/integration/privileges.test.ts

# 3. PostgreSQL behaviour (afldb_test only)
npm test -- tests/integration/settle-afltables.test.ts tests/integration/observation-spine.test.ts

# 4. Typecheck
npx tsc --noEmit

# 5. Bounded end-to-end, afldb_test only: dry-run -> apply -> apply again
npx tsx tools/current-season/settle-afltables.ts --label <L> --dry-run
npx tsx tools/current-season/settle-afltables.ts --label <L> --apply --auto-apply
npx tsx tools/current-season/settle-afltables.ts --label <L> --apply --auto-apply   # 0 writes
```

No full rebuild and no broad release-gate suite is part of this ladder. Note that
`tests/integration/release-gates.test.ts` carries **SNAPSHOT-class** 2026 figures that automatic
ingestion will legitimately move; a failure there means "re-pin", not "bug".

---

## 18. Stop conditions

- **SC1** — a canonical row is written while ownership, manual authority, season or baseline
  gates were not all clear. **Stop.**
- **SC2** — a canonical row exists with no matching `canonical_applications` row, or a ledger row
  exists with no canonical effect.
- **SC3** — a rerun over identical source data writes a canonical row or a ledger row.
- **SC4** — one unresolved identity blocks a match or an unrelated player row.
- **SC5** — any grant is widened beyond `SELECT, INSERT` on `canonical_applications`; or
  `promotion_decisions` / `admin_user_id` semantics change; or `afldb_import` gains SELECT on
  `data_edits`.
- **SC6** — an existing manual override, foreign-owned row, or source-less row is adopted
  automatically.
- **SC7** — a deprecated fallback (Squiggle/Kali) performs any canonical write.
- **SC8** — a promotion candidate is created and then machine-marked accepted, or any
  `promotion_decisions` row is written by a machine.
- **SC9** — an applied migration's bytes change, or a checksum guard is weakened.
- **SC10** — implementation evidence materially contradicts this runbook, or exposes a new
  unresolved architecture or data-integrity decision. **Stop and return to a fresh planning
  session. Do not improvise.**

---

## 19. Deployment and operations [PLANNED]

**Execution path.** `deploy/afldb-settle-afltables.service` (`Type=oneshot`) runs the chain —
`acquire_core.R --in-season` → `import_fitzroy_core.py --require-in-season --on-record-error
reject --emit-observations` → `settle-afltables.ts --apply --auto-apply` — driven by
`deploy/afldb-settle-afltables.timer`. Model both on the existing
`deploy/afldb-email-intake.{service,timer}` pair, including its hardening block; unlike the
email poller this unit **does** need `AFLDB_IMPORT_DATABASE_URL`, so the `UnsetEnvironment` list
must be adjusted deliberately and narrowly.

**Cadence.** Nightly in season, at the overnight settle window
(`docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5, T+12–24 h). `Persistent=true` so a missed
run catches up after a reboot.

**Idempotent reruns.** Guaranteed by §6: an unchanged observation performs no work. A rerun after
a partial failure re-attempts only what did not land.

**AFL Tables unavailable.** `acquire_core.R` writes the manifest **last**
(`acquire_core.R:434-478`), so a failed fetch leaves no consumable snapshot, the Python
adjudicator refuses, and PostgreSQL is never opened. The unit fails, systemd reports it, and the
next timer firing retries. **Nothing partial is ever committed.**

**Deprecated fallbacks are never invoked automatically.** Squiggle/Kali run only when a human
explicitly runs `current-season:update` or uses `/admin/current-season`, and after §11 neither
can write canonically.

**Rollout order.** Migration and `db:privileges` **before** the code that depends on them, per
the `AFLDB-ISSUE-027` lesson; validate on `afldb_test`, then `afldb_dev`, then production — and
never move `afldb_dev` while the operator is testing on it.

---

## 20. Explicit non-goals

- The 1897–2025 historical rebuild.
- `AFLDB-ISSUE-101` rollover execution or supersession semantics (interface only, §19).
- Deleting Squiggle/Kali, their source rows, registry entries, provenance history, clients,
  parsers or useful tests.
- Making Squiggle/Kali a mandatory corroboration layer, or introducing any replacement fallback
  canonical writer.
- A promotion-review admin UI.
- Any new admin UI at all, unless implementation evidence proves no existing exception-resolution
  path is usable — in which case **stop and record it**.
- Creating any player, club, venue or venue-alias identity.
- `player_match_period_stats` — missing from every free source; stays unpopulated.
- `brownlow_season_votes` — owned by `AFLDB-ISSUE-113`.
- Editing migrations 073 / 074 / 075 / 076, or weakening any checksum guard.
- `AFLDB_LEGACY_SQLITE`.
- NL search, Grid Solver, player-link or unrelated UI work.
- Production or `afldb_dev` database work during implementation — all validation is `afldb_test`
  only until S8.

---

## 21. Open questions carried into implementation

| # | Question | Resolved by |
|---|---|---|
| **U1** | Do foreign-owned or source-less 2026 canonical matches exist, and which are permanently human-owned? | §15.1 queries 1–2, at S0 |
| **U2** | The exact next free migration number across every live branch | §15.2, at S0 |
| **U3** | Is R + the pinned fitzRoy present on the production host? | §15.2, at S0 |
| **U4** | 2026 `Brownlow.Votes` coverage — `stat-availability.json` declares it `pending`; expect zero rows in-season | one bounded offline measurement over the acquired CSV; `AFLDB-ISSUE-099` F11/U2 |
| **U5** | Machine candidate retirement (`AFLDB-ISSUE-099` F7) remains a forward gap — moot candidates stay pending | not resolved here; never a fabricated admin decision |
| **U6** | Whether debutant onboarding volume warrants its own tooling | measured after the first real in-season runs; **a separate issue**, never a weakening of §9.4 |

---

## 22. Implementation handoff

| Field | Value |
|---|---|
| Session | **Fresh** |
| Model | **Fable** |
| Effort | **High** |
| Mode | **Normal** (not plan mode) |
| Working directory | `D:\dev\afldb-issue-122` |
| Branch | `claude/issue-122` |
| Carry-over file | **`issues/open/AFLDB-ISSUE-122.md`** (this file) |
| Start at | **S0 — the §15 operator measurements and the migration-number scan, before any code** |

If implementation evidence materially contradicts this runbook, **stop rather than improvise**
(SC10) and return to a fresh planning session.

---

## 23. Implementation log

> Appended by the implementation session. Each stage records what was built, what changed from
> this plan and why, and the evidence that closed it.

### S0 — Preflight (2026-09-02, Fable / High / Normal, worktree `D:\dev\afldb-issue-122`, branch `claude/issue-122` at `19de501`)

**Outcome: S0 stop conditions are clear on `afldb_test`. No code, no migration, no commit. S1 may start.**
One S0 item is outstanding and is handed to the operator (the production copy of §15.1 — see
"Deviations" below); it gates only the S9 decision, not S1–S8.

Commands in this stage were executed by Claude under the operator's explicit S0 instruction
(the CLAUDE.md §9 exception). Everything run was read-only: `SELECT`s, `git fetch`/`ls-tree`,
`command -v`. Nothing was written to any database, branch, or host.

#### §15.1 measurements — `afldb_test` (the runbook's named target)

Run 2026-09-02 as `afldb_owner` on the development host (`arm@10.0.40.100`), `current_database()
= afldb_test`, via `psql -X -v ON_ERROR_STOP=1 -f -` over stdin.

| Query | Result |
|---|---|
| Q1 — 2026 canonical ownership | **0 rows.** `afldb_test` holds no `matches` row with `season = 2026` at all. |
| Q2 — manual / legacy markers | **0 rows.** |
| Q3 — 2026 dependent rows | `pms = 0`, `periods = 0`, `votes = 0`. |
| Q4 — NULL `venue_id` reality | 2020: 0/162 · 2021: 0/207 · 2022: 0/207 · 2023: 0/216 · 2024: 0/216 · 2025: 0/216 unmapped. |

Migration state: `afldb_meta.schema_migrations` top row on `afldb_test` is
`082_auth_audit_log_jsonb_repair.sql` (checksum `355f158f…503a5c`, applied 2026-09-02 12:24 +10).
`afldb_dev` is at the same 082 with the identical checksum. **The S1 "no drift" baseline is 082
on both databases.**

#### §15.1 measurements — `afldb_dev` (supplementary, same host, same queries, read-only)

Added because §14 / S9 is a question about the database the scheduled job will actually run
against, and `afldb_test` turned out to contain no 2026 season whatsoever. `afldb_dev` is the
closest measurable proxy for production this session could reach.

| Query | Result |
|---|---|
| Q1 | `(source_id IS NULL)` **189** (2026-03-05 → 2026-08-09) · `squiggle_api` **10** (2026-08-14 → 2026-08-20) · `kali_afl_stats` **7** (2026-08-21 → 2026-08-23). Zero `afltables`-owned rows. |
| Q2 | **189 rows**, exactly the 189 source-less rows: every one has `attendance_source_id IS NOT NULL` **and** `legacy_match_id IS NOT NULL`; none has a `data_overrides` row (`field_group` / `is_active` NULL throughout). Provenance is coherent for all 189 (`source_record_id IS NULL` and `import_batch_id IS NULL`). |
| Q3 | `pms = 8694`, `periods = 1512`, `votes = 0` — expected on a live development database; the Q3 stop condition is scoped to `afldb_test` only. |

**Permanently legacy-owned set (U1, dev).** The 189 legacy-loaded rows are the complete
`season = 2026 AND legacy_match_id IS NOT NULL` set, round codes `1`–`23`, 2026-03-05 → 2026-08-09.
They are recorded here by predicate rather than by 189 individual keys: §14 rule 7 refuses every
one of them unconditionally, so none can ever enter an allowlist, and the predicate is exact.

**Foreign-owned adoption candidates (U1, dev) — 17 rows, all `legacy_match_id IS NULL`,
`attendance_source_id IS NULL`, no override, `source_record_id` + `import_batch_id` both set,
`venue_id IS NULL` on every one:**

| `match_key` | owner |
|---|---|
| `2026\|23\|2026-08-14\|Fremantle\|Adelaide` | squiggle_api |
| `2026\|23\|2026-08-15\|Brisbane Lions\|Gold Coast` | squiggle_api |
| `2026\|23\|2026-08-15\|Hawthorn\|Collingwood` | squiggle_api |
| `2026\|23\|2026-08-15\|North Melbourne\|Geelong` | squiggle_api |
| `2026\|23\|2026-08-15\|Port Adelaide\|Melbourne` | squiggle_api |
| `2026\|23\|2026-08-15\|Richmond\|St Kilda` | squiggle_api |
| `2026\|23\|2026-08-16\|Essendon\|Sydney` | squiggle_api |
| `2026\|23\|2026-08-16\|Greater Western Sydney\|West Coast` | squiggle_api |
| `2026\|23\|2026-08-16\|Western Bulldogs\|Carlton` | squiggle_api |
| `2026\|24\|2026-08-20\|St Kilda\|Gold Coast` | squiggle_api |
| `2026\|24\|2026-08-21\|Collingwood\|Brisbane Lions` | kali_afl_stats |
| `2026\|24\|2026-08-22\|Carlton\|Fremantle` | kali_afl_stats |
| `2026\|24\|2026-08-22\|Geelong\|Richmond` | kali_afl_stats |
| `2026\|24\|2026-08-22\|Melbourne\|Western Bulldogs` | kali_afl_stats |
| `2026\|24\|2026-08-23\|Essendon\|Port Adelaide` | kali_afl_stats |
| `2026\|24\|2026-08-23\|Sydney\|North Melbourne` | kali_afl_stats |
| `2026\|24\|2026-08-23\|West Coast\|Hawthorn` | kali_afl_stats |

Data observation for S9 (not a stop condition): the legacy rows label the 2026-08-06 → 08-09
fixtures round `23`, while Squiggle labels 2026-08-14 → 08-16 round `23` and Kali 2026-08-20 →
08-23 round `24`. The two populations number rounds differently (the Opening Round offset
already noted in project memory). §14 rule 2 requires `round_code` to agree byte-for-byte with
the AFL Tables bundle, so any such row is refused rather than forced; expect refusals, not a
rule change.

#### Interpretation rules and stop conditions

| Rule | Evaluation |
|---|---|
| Q1 all `afltables` or zero rows ⇒ §14 not required | **True on `afldb_test`** (zero rows). **False on `afldb_dev`** (17 foreign-owned + 189 source-less). See "S9" below. |
| Q2 rows are permanently human/legacy-owned; record by name; never allowlisted | `afldb_test`: none. `afldb_dev`: the 189-row legacy predicate above; none has an override. |
| Q3 non-zero on `afldb_test` ⇒ stop | **Clear** — 0 / 0 / 0. |
| Q4 context for §7.3 | NULL `venue_id` is schema-legal (§7.3 stands) but is currently **absent** from every canonical 2020–2025 row on `afldb_test`; the settle path will be the first producer of NULL `venue_id` in modern seasons. The 17 foreign-owned dev rows already carry NULL `venue_id`, consistent with §7.3. |
| SC1–SC9 | Not applicable — nothing was written. |
| SC10 (evidence contradicts the runbook) | **Not triggered.** One assumption is weaker than written: `afldb_test` is not merely "canonically rebuilt", it has **no 2026 season at all**, so S6's end-to-end on `afldb_test` exercises only the insert path unless fixtures seed update/adoption cases. That is a test-design note for S5/S6, not a contradiction. |

#### §15.2 migration number (U2)

`git fetch --all --prune` then `git ls-tree` over **every** `refs/heads/*` and `refs/remotes/*`
tip — 49 refs (42 local heads, 7 remote-tracking including `origin/HEAD`), listed in full during
the scan. Highest committed migration on any tip: `082_auth_audit_log_jsonb_repair.sql`, on
`dev`, `origin/dev`, `claude/issue-122`, `claude/issue-102-fresh`. `081` on the same four plus
`codex/issue-119`. `080_external_grids.sql` only on `opus/gridley-corpus`. `main` / `origin/main`
top out at `079_nl_search_log_head_to_head_grain.sql`.

**Result: the next free number is `083`.** Derived, not assumed. Two caveats: (a) the scan covers
committed tips only — uncommitted files in the sibling worktrees `D:\dev\afldb` (`main`) and
`D:\dev\afldb-issue-102` were not inspected (outside this worktree's boundary); (b) a pre-existing
collision is visible and is **not** this issue's: `079_access_code_delete.sql` on
`claude/issue-116` / `origin/claude/issue-116` versus `079_nl_search_log_head_to_head_grain.sql`
on `main` / `dev`, already flagged in `IssuesIndex.md`. S1 must re-run the scan immediately
before creating `src/db/migrations/083_canonical_auto_apply.sql`, per §12.1.

#### §15.2 host capability (U3)

`ssh afldb` (host reports `afldb-prod`), one batched connection: `command -v Rscript` printed
nothing and exited 1; `R --version` printed nothing. **`Rscript` and `R` are absent on the
production host.** The pinned fitzRoy version is `1.8.0`
(`tools/rebuild/fitzroy/fitzroy-contract.json:186`); `acquire_core.R:76` compares the installed
version to that pin with `identical()` and refuses on mismatch. **S8's provisioning step is real
work**: install R, install fitzRoy `1.8.0` exactly, then a probe run — before any timer is enabled.

#### Is S9 (§14) required?

- On the runbook's literal target, `afldb_test`: **not required** — no 2026 rows exist.
- On `afldb_dev`: **required** — 17 foreign-owned rows are the expected adoption volume, growing
  by one round per week until §11.2 retires the Squiggle/Kali canonical writer; 189 legacy rows are
  refused by rule 7 regardless.
- On production: **unmeasured** (see Deviations). The scheduled job runs against production, so
  the S9 decision is **open pending that one measurement**. Recorded as **"conditionally
  required"**. Because S9 is the final stage and depends on nothing in S1–S8 (and vice versa),
  this does not block S1.

#### Deviations from §15 as written

1. `afldb_dev` was measured in addition to `afldb_test` (read-only, same queries). Reason above.
2. The same read-only §15.1 queries against **production** were attempted and were **blocked by
   the session's auto-mode permission classifier** (production SSH + psql). They were not run.
   The operator should run them; exact command below.
3. Claude executed the S0 commands itself (explicitly instructed), rather than handing each to the
   operator.
4. A stray, empty, untracked file `must` (0 bytes, 2026-09-02 14:17) sits at the worktree root. It
   pre-dates this session and was not touched; it should not be committed.

#### Outstanding S0 item — operator command (production, read-only)

Save §15.1 queries 1–3 to `q.sql` on the workstation, then from PowerShell (the production alias
needs the Windows agent; keep the remote command free of inner quotes and parentheses):

```powershell
(Get-Content q.sql -Raw) -replace "`r`n","`n" | ssh -o BatchMode=yes afldb 'cd ~/projects/afldb; set -a; . ./.env; set +a; psql $DATABASE_URL -X -f -'
```

Paste the output into the next session; record it under this entry and close the S9 decision.

#### Next action — S1

Fresh session, Fable / High / Normal, same worktree and branch, carry-over this file.
1. Re-run the §15.2 branch scan; confirm `083` is still free.
2. Create `src/db/migrations/083_canonical_auto_apply.sql` with the §12.2 contents (A1/A2/A3,
   FK indexes, `canonical_applications`, grants) and register it in
   `tools/maintenance/privileges.sql`.
3. Apply to **`afldb_test` only** (`npm run db:migrate:test` on the development host, baseline 082).
4. Gates: `fk-indexes` 2/2, `privileges` green, `db:status` no drift. Do not touch `afldb_dev`
   or production.

### S1 — Migration (2026-09-02, Fable / High / Normal, worktree `D:\dev\afldb-issue-122`, branch `claude/issue-122` at `19de501`)

**Outcome: S1 COMPLETE on `afldb_test`. Migration `083_canonical_auto_apply.sql` written, applied
to `afldb_test` only, reconciled, and every S1 gate is green. Nothing committed. `afldb_dev` and
production untouched (dev re-verified at `082` after the run).**

Commands in this stage were executed by Claude under the operator's explicit S1 instruction
("run the smallest required validation"), the CLAUDE.md §9 exception, as in S0. The only
database written was `afldb_test`.

#### §15.2 re-scan (before creating anything)

`git fetch --all --prune`, then `git ls-tree -r --name-only <ref> -- src/db/migrations` over every
`refs/heads/*` and `refs/remotes/*` tip — **49 refs**, same population as S0. Highest committed
migration on any tip: `082_auth_audit_log_jsonb_repair.sql`. A search for `08[3-9]`/`09*` under
`src/db/migrations` on every tip returned nothing. The pre-existing `079` collision
(`claude/issue-116` vs `main`/`dev`) is unchanged and was not absorbed. **`083` was still free;
the file was created as `src/db/migrations/083_canonical_auto_apply.sql`.**

#### Files changed (all uncommitted)

| File | Change |
|---|---|
| `src/db/migrations/083_canonical_auto_apply.sql` | **new** — the §12.2 contract, nothing else |
| `tools/maintenance/privileges.sql` | afldb_import table-level exception block: `SELECT, INSERT` on `canonical_applications` + `USAGE` on `canonical_applications_id_seq`; afldb_auth `spec` array: `['canonical_applications', 'SELECT']` (not in `written`) |
| `tests/integration/privileges.test.ts` | §17 row 15: new `it('appends the automatic canonical mutation ledger and can never rewrite it (AFLDB-ISSUE-122)')`; `canonical_applications` added to the afldb_auth grant list and to the exclusion list of "writes exactly the tables the registry allows" (it holds table-level INSERT by design without being registered — the same exception `data_edits` / `player_link_resolutions` already have) |
| `issues.md`, `IssuesIndex.md`, `CHANGELOG.md` | tracking |

Migrations 073/074/075/076 and every other applied migration: untouched. No `manual-authority.ts`,
no settle/reconciliation/Squiggle/Kali/scheduling change.

#### Exact schema created (as applied to `afldb_test`, read back from the catalogue)

**(a) Provenance completion.** `SELECT add_provenance_columns('match_period_scores')` and
`SELECT add_provenance_columns('brownlow_round_votes')` — each now carries `source_id smallint
REFERENCES sources(id)`, `source_record_id text`, `import_batch_id bigint REFERENCES
import_batches(id)`, `imported_at timestamptz NOT NULL DEFAULT now()`. `ALTER TABLE
player_match_stats ADD COLUMN source_record_id text` (its `source_id`/`import_batch_id` from 004
are not duplicated). The two new FK pairs are deliberately unindexed (044 §6(b); both parents
are exempt in `fk-indexes.test.ts`), stated in `COMMENT ON COLUMN` on each `import_batch_id`.

**(c) `canonical_applications`.** Columns exactly as the §12.2 table: `id bigint PRIMARY KEY
GENERATED ALWAYS AS IDENTITY`; `import_batch_id bigint NOT NULL → import_batches(id)`; `source_id
smallint NOT NULL → sources(id)`; `family text NOT NULL`; `external_record_id text NOT NULL`;
`source_version_seq integer NOT NULL`; `target_table text NOT NULL`; `target_key jsonb NOT NULL`;
`verb text NOT NULL`; `previous_values jsonb`; `new_values jsonb NOT NULL`; `applied_at
timestamptz NOT NULL DEFAULT now()`. Constraints read back:

| Constraint | Definition |
|---|---|
| `canonical_applications_source_id_family_external_record_id_fkey` | `FOREIGN KEY (source_id, family, external_record_id, source_version_seq) REFERENCES staging.source_record_versions(source_id, family, external_record_id, version_seq)` — the real PK, not the partial open-version index |
| `canonical_applications_target_table_ck` | `target_table IN ('matches','match_period_scores','player_match_stats','brownlow_round_votes')` |
| `canonical_applications_verb_ck` | `verb IN ('insert','update')` |
| `canonical_applications_previous_ck` | `(previous_values IS NULL) = (verb = 'insert')` |
| `canonical_applications_target_key_ck` | `jsonb_typeof(target_key) = 'object'` |
| `canonical_applications_new_values_ck` | `CASE WHEN jsonb_typeof(new_values) = 'object' THEN jsonb_array_length(jsonb_path_query_array(new_values, '$.keyvalue()')) <= 64 ELSE false END` |
| `canonical_applications_previous_values_ck` | `previous_values IS NULL OR <same 64-key object bound>` |

Indexes: `ix_canonical_applications_source_version (source_id, family, external_record_id,
source_version_seq)` (covers the composite FK), `ix_canonical_applications_target_applied
(target_table, applied_at DESC)`, `ix_canonical_applications_batch (import_batch_id)`, plus the
PK. Registries: `import_writable_tables` 0 rows, `app_readable_tables` 0 rows for the table.

**(d) Grants, read back from `pg_class.relacl` after `privileges.sql`:** table
`{afldb_owner=arwdDxt, afldb_auth=r, afldb_import=ar}`; sequence `canonical_applications_id_seq`
`{afldb_owner=rwU, afldb_import=U}`. No `afldb_app` entry. No UPDATE/DELETE/TRUNCATE for any
application role. `grant_import_write()` not used. `promotion_decisions`, `data_edits`,
`data_overrides`, `admin_user_id` semantics unchanged (asserted: `afldb_import` still has no
SELECT on `data_edits` and no INSERT on `promotion_decisions`).

#### Validation (all on `afldb_test`, development host `arm@10.0.40.100`, PostgreSQL 16.15)

The branch tip is not checked out on the host (its `~/projects/afldb` is `dev` at `ee72563`), so
validation ran in a throwaway `git clone --local` at `/tmp/afldb-it` with the three changed files
copied in (LF-normalised). That base is faithful: `git diff --stat origin/dev HEAD` over
`src/db/migrations`, `privileges.sql`, both test files and `package.json` is empty. The clone and
staging directory were deleted afterwards; the host's deploy checkout was not touched (still 10
pre-existing uncommitted entries, HEAD `ee72563`).

| Step | Command | Result |
|---|---|---|
| Branch scan | §15.2 loop over 49 refs | highest `082`; no `083+` anywhere → **083 free** |
| Status before | `npx tsx tools/db/migrate.ts --status --target test` | `082` applied, `083_canonical_auto_apply.sql` **PENDING**, 1 pending |
| Apply | `npm run db:migrate:test` | `-> test (afldb_owner@localhost:5432/afldb_test)`, `82 migration file(s), 81 already applied`, `applying 083_canonical_auto_apply.sql ... ok (56 ms)`; ledger checksum `3c959e4e91be…`, applied 2026-09-02 15:31:23 +10 |
| Reconcile | `npm run db:privileges:test` | `afldb_app: 43 public relations readable, 21 revoked` · `afldb_import: 40 registered tables writable, 24 relations revoked` · `afldb_auth: grants applied on 35 of 35 tables, 29 other relations revoked` · telemetry-clear grant unchanged |
| Status after | `npx tsx tools/db/migrate.ts --status --target test` | `083` applied, **0 pending — no drift** |
| Gates | `npx vitest run tests/integration/fk-indexes.test.ts tests/integration/privileges.test.ts` | **2 files / 37 tests passed, 0 failed** (`fk-indexes` 2/2, `privileges` 35/35 including the new ISSUE-122 case), 1.29 s |
| CHECK probe | standalone SELECT of the 64-key expression | object → pass; array → fail; scalar → fail; 64-key object → pass; 65-key object → fail |
| Typecheck | `npx tsc --noEmit` (in the clone; the workstation has no TypeScript binary) | exit 0 |
| Whitespace | `git diff --check` (workstation) | clean |
| Non-target check | `afldb_dev` top ledger row after everything | `082_auth_audit_log_jsonb_repair.sql` — untouched |

Note: `npm run db:status` targets **dev** by default; the test-database status form is
`npx tsx tools/db/migrate.ts --status --target test`.

#### Deviations from §12.2 as written (none widen the contract)

1. **Sequence grant is `USAGE` only**, not the runbook's literal `USAGE, SELECT`. An INSERT needs
   only USAGE (the writer will use `RETURNING id`, never `currval()`); this matches the
   `data_edits_id_seq` precedent (`privileges.sql`, migration 066) and the S1 brief ("sequence
   privileges required for INSERT"). Narrower than written; the test pins `selects: false`.
2. **`target_key` gained `CHECK (jsonb_typeof(target_key) = 'object')`.** §12.2 describes the
   column as a JSON-object natural key without spelling out the CHECK; a scalar key would be a
   defect. Small tightening, recorded here.
3. **The 64-key bound uses `jsonb_path_query_array(x, '$.keyvalue()')` inside a `CASE`.** §12.2
   mandates the bound, not the mechanism; a CHECK may contain neither a subquery nor a
   set-returning function, so `jsonb_object_keys` was not usable. The CASE guarantees the
   type test runs first so a non-object is a constraint violation, never a jsonpath error.
   Behaviour probed on PostgreSQL 16.15 (table above).
4. **`ix_canonical_applications_batch` is kept** although 044 §6(b) leaves quartet FKs unindexed:
   §12.2(c) lists it explicitly, and unlike the fact tables this ledger is read by batch by
   design (S6 exception report / counters). The migration comment says so.
5. `privileges.test.ts`'s "writes exactly the tables the registry allows" probe had to learn the
   new table-level exception, or S1 fails its own gate by construction. This is the same
   exclusion the two 066 audit tables carry and does not weaken the assertion.
6. Claude executed the commands (explicitly instructed); validation ran in a throwaway clone on
   the dev host rather than in the branch worktree, for the reason above.

#### Git status at end of S1 (nothing staged, nothing committed)

```text
 M CHANGELOG.md
 M IssuesIndex.md
 M issues.md
 M tests/integration/privileges.test.ts
 M tools/maintenance/privileges.sql
?? issues/open/AFLDB-ISSUE-122.md
?? must                                   <- pre-existing empty stray file; NOT touched, do not commit
?? src/db/migrations/083_canonical_auto_apply.sql
```

`CHANGELOG.md` carries an `Unreleased` entry for the schema change (CLAUDE.md §5: data/schema
behaviour). Branch `claude/issue-122` remains at `19de501`.

#### Carried forward

- **`083` is now claimed by this branch but uncommitted.** Until it is committed and pushed, no
  other branch's scan can see it; `claude/issue-116`'s pending renumber of `079_access_code_delete`
  must therefore land on `084` or later. Commit S1 before starting S2 to make the claim visible.
- The S0 outstanding item (production copy of §15.1, gating the S9 decision) is still open.
- For S5's writer: insert with `RETURNING id`; serialise `previous_values`/`new_values` through
  `canonicalJson()`; ≤ 64 top-level keys per object; `target_key` must be an object.

#### Next action — S2 (Manual authority)

Fresh session, Fable / High / Normal, same worktree and branch, carry-over this file. Scope per
§16 row S2 and §8: create `src/lib/acquisition/manual-authority.ts` (a `data_overrides`-backed
authority provider) and wire it into `tools/current-season/settle-afltables.ts` in place of
`UNAVAILABLE_MANUAL_AUTHORITY` (`:232`). Gates: the DB-free truth table in
`tests/current-season-import.test.ts` and an integration refusal case in
`tests/integration/settle-afltables.test.ts` (both on `afldb_test`, which is now at `083`). No
migration, no applier, no settle-logic change beyond the provider wiring.
