# AFLDB-ISSUE-096 — 2026+ API-first acquisition architecture and contract

**Status:** approved (§14); S1 IMPLEMENTED + AMENDED and validated GREEN; **S2 COMPLETE and GREEN —
`61/61`, 0 failures, on the final post-hygiene run of 2026-08-28 (§16.2). Migration
`src/db/migrations/074_source_observation_spine.sql` is the correct spine migration and remains
UNAPPLIED.** **S3 COMPLETE and GREEN — `84/84`, 0 failures, 316 ms, user-run 2026-08-28
(§15, S3 section).** **S4 COMPLETE and GREEN — `105/105`, 0 failures,
357 ms on the final post-hygiene run, user-run 2026-08-28 (§16.10). The promotion-review contract
is implemented; the canonical acceptance/write transaction remains **deliberately unimplemented**
behind ISSUE-086's authority gate (§7). The §16.11 NUL hygiene item is RESOLVED. Migration 074
remains UNAPPLIED. §11's stage decomposition ends at S4 — there is no approved S5 (§16.12).**
**The separately authorised PostgreSQL validation phase was HALTED at its preflight on 2026-08-28:
`afldb_test`'s migration baseline is incoherent because applied migration `073_data_overrides.sql`
(`AFLDB-ISSUE-086`'s) fails the runner's checksum guard, so migration 074 cannot be applied through
supported tooling and must not be modified until that is repaired (§16.13, §16.14).**
**Fresh-session handoff: read §16 first, then §16.13.**
**Mode:** foundation implementation, stages S1–S4. No family importer. No Git.
**Created:** 2026-08-28. **Model/effort:** Opus / High / Plan.
**Parent runbook:** `AFLDB-2026-API-ACQUISITION.md` — source evidence, source-of-truth matrix,
operating lifecycle, and the P1–P7 probe results (§13). This file is the durable source of truth
for **ISSUE-096 itself**.

**Amendment record.** Decisions **A**, **E** and the `source_updated_at` semantics were amended on
2026-08-28 after review of the first draft. The superseded positions are recorded in §"Amendment
history" rather than deleted.

---

## 1. Scope

Establish the standing **contract** by which AFLDB acquires a current or future season from
external APIs, so that every data family added later inherits one set of rules instead of
repeating the shipped path's choices.

In scope:

1. immutable source observations / snapshot history;
2. external record identity;
3. payload hashing and change detection;
4. source correction handling;
5. absence versus deletion;
6. source ownership;
7. foreign-owned natural-key collision refusal;
8. reconciliation / diff generation;
9. reviewed super-admin promotion;
10. canonical provenance;
11. manual / admin-decision authority (as an **invariant and interface** — see §7);
12. idempotent refreshes;
13. source disagreement / corroboration semantics;
14. import batch / report semantics;
15. current-season-only ownership;
16. completed-season rollover into the normal fitzRoy baseline.

## 2. Non-goals

- **No family-specific importer.** Matches, player statistics, lineups, rosters and ladders are
  other issues' work.
- ~~**No migration file.** §8 records schema *concepts* only.~~ **Amended 2026-08-28 (§14):** the
  approvals authorise implementing the foundation itself, so **S2 may write the observation /
  promotion-ledger migration**. The rest of §8's boundary stands: no *family* projection table and
  no family importer under this issue.
- **No admin UI implementation.** §6 records what the review screen must render and enforce.
- **No change to the shipped importer's four defects** — that is `AFLDB-ISSUE-098`, independently
  actionable.
- **No ladder/team-season design** — `AFLDB-ISSUE-095`.
- **No override-authority storage design** — `AFLDB-ISSUE-086` (§9).
- **No Champion Data licensing path**, no `player_match_period_stats` work while no free source
  exists.

## 3. Approved standing policy carried in

From `AFLDB-2026-API-ACQUISITION.md` §0 **[DECISION]**, constraints rather than proposals:

1. Free/hobby sources only.
2. Fetch, staging and diff computation may run automatically.
3. **Canonical promotion is reviewed by default** — a super-admin action, never a scheduled job.
4. **Lineups are staging-only** and never become canonical participation.
5. **Only the in-progress season** belongs to this pipeline.
6. Once complete, that season is re-acquired through the standard full-history fitzRoy path and
   **supersedes** the in-season provenance.

Also carried in: no source may fabricate a club or venue identity; no placeholder venue such as
`Unknown` may become canonical; manual decisions outrank source refreshes; ISSUE-095's
`club_seasons` guard is not weakened to make promotion easier; ISSUE-086 is not duplicated; and
Squiggle and Kali are not counted as independent witnesses unless P1 proves independence —
**P1 has now run and proved exactly that for `/matches`, so the conditional is satisfied rather
than waived (§15.1). `/fixture` remains a proven proxy and is still not a second witness.**

## 4. P1–P7 evidence summary

Run 2026-08-28. Full record, commands and interpretation in `AFLDB-2026-API-ACQUISITION.md` §13.

| Gate | Status | Outcome for this contract |
|---|---|---|
| **P1** Kali `/matches` independence | **PASS — re-run 2026-08-28** (was BLOCKED) | **NOT a Squiggle proxy.** Kali `match` gets its own independence group; Squiggle + Kali are **two** witnesses. `/fixture` stays a proven proxy in the `squiggle` group. See §15.1. |
| **P2** Kali stable player id | **PASS — re-run 2026-08-28** (was BLOCKED) | **No player id on the stat grain.** The gap is now *proven*, not assumed: Kali still cannot be designed into the player-grain path, and the registry records it as `identity_only`. See §15.2. |
| **P3** AFL API lineup shape | **PASS** | Identity adequate (`CD_M…`/`CD_T…`/`CD_I…`). **Column set differs between rounds (19 vs 20)** ⇒ projections declare required columns and refuse surprises. **No substitute field.** |
| **P4** AFL API roster identity | **PASS** | `providerId` stable and **proven** identical to the lineup player id (26/26). **`weightInKg` = 0 for 46/46** ⇒ zero-as-missing must map to NULL. |
| **P5** 2026 AFL Tables settle | **PASS — stop condition NOT triggered** | `url` 0 NA and **1:1** with `ID`; **`ID` is 82 NA**. **Key on `url`.** Round vocabularies diverge across all three sources. |
| **P6** AFL Tables ladder shape | **PASS** | 18 × 8. **ISSUE-095 evidence only**; no D-decision made or altered. |
| **P7** 2026 database reality | **BLOCKED (execution)** — SSH refused | **No database was queried.** Not required by this contract. |

**Five findings changed the contract** rather than merely filling a blank: hashing (not source
timestamps) is the change oracle; `url` is the player-match key in-season; round vocabularies are
per-source declarations; zero is not missing; and source schemas drift within a season.

---

## 5. Architectural decisions

### A. Observation storage model — three grains *(amended 2026-08-28)*

The contract must satisfy **two invariants simultaneously**:

- **I1 — idempotence.** Repeated polling of unchanged upstream state produces no new history and
  manufactures no meaningless payload versions.
- **I2 — correction history.** A genuine transition **A → B → A** is historically observable as
  **three ordered source states**, not two.

A single table keyed on the payload hash cannot satisfy both: the second **A** collides with the
first and degrades to a timestamp touch, silently erasing the transition. The contract therefore
separates **immutable content** from **ordered state** from **current-key state**.

**A1 — `staging.source_payloads` — immutable, content-addressed, deduplicated.**

| Element | Definition |
|---|---|
| Key | `(source_id, family, payload_hash)` |
| Columns | `raw_payload jsonb NOT NULL`, `first_stored_at timestamptz NOT NULL` |
| Write | `ON CONFLICT DO NOTHING` — identical content is stored **once** |

Content storage, not history. Deduplication here is what stops A→B→A from storing three copies of
two distinct payloads.

**A2 — `staging.source_record_versions` — the ordered history grain.**

| Element | Definition |
|---|---|
| Key | `(source_id, family, external_record_id, version_seq)` — `version_seq` monotonic **per key** |
| Columns | `payload_hash` (FK → A1), `source_updated_at timestamptz NULL`, `observed_from timestamptz NOT NULL`, `observed_to timestamptz NULL`, `opened_by_batch_id`, `closed_by_batch_id` |
| Append rule | **Append a version only when the incoming `payload_hash` differs from the currently open version's hash.** An unchanged poll appends nothing. |
| Interval chain | Opening version *n+1* closes version *n* by setting its `observed_to` to the new `observed_from`. No gaps, no overlaps; exactly one open version per key. |

Version identity is `version_seq`, **not** the hash. A→B→A therefore yields `version_seq` 1 (A),
2 (B), 3 (A) — **three ordered rows** — referencing only **two** payload rows. I1 and I2 both hold.

**A3 — `staging.source_records` — current-key and observation-event state.**

| Element | Definition |
|---|---|
| Key | `(source_id, family, external_record_id)` — one row per external record |
| Columns | `current_version_seq`, `current_payload_hash`, `first_seen_at`, `last_seen_at`, `last_batch_id`, `absent_since timestamptz NULL` |

**`absent_since` lives here and only here.** Absence is a property of the external *key* — the
record stopped being offered — not of any one historical payload version. Putting it on a version
row would assert that a specific past payload disappeared, which is not what was observed.

**Idempotence primitive.** An unchanged poll is exactly one statement — `UPDATE
staging.source_records SET last_seen_at = now(), last_batch_id = …, absent_since = NULL` — and
**zero inserts in A1 and A2**.

**Absence sweep.** After a fetch, within the **declared key-scope that the fetch actually
enumerated** (e.g. *source × family × season × round*), stamp `absent_since` on records whose
`last_seen_at` predates the batch start. Absence is **never** asserted for keys outside the
enumerated scope, is **never** a delete, **never** appends a version row, and **never** changes
canonical data. A reappearance clears `absent_since` and appends a version row only if the payload
actually changed.

**Payload hash.** SHA-256 over a **canonicalised** payload: keys sorted, with a **per-family
declared exclusion list** for volatile response fields — `data_accessed` from P4 is the proven
case. Without that list every fetch would look like a correction and I1 would fail.

**Deliberate omission.** No per-fetch event row is kept for every record on every run. It would
grow without bound and has no reader: `import_batches` already records each run, and
`source_records.last_seen_at` plus the version intervals reconstruct what was seen when. Recorded
as a decision, not an oversight.

### A′. `source_updated_at` semantics *(amended 2026-08-28)*

`source_updated_at` may contain **only a genuine upstream mutation/update timestamp** — the moment
the source says its own record changed.

- **Retained:** Squiggle `games.updated`, which genuinely represents upstream update time.
- **Excluded:** AFL API `utcStartTime`. It is the **scheduled event start time** and belongs in the
  typed family projection (e.g. `scheduled_start_utc`), never in `source_updated_at`.
- **Excluded:** `data_accessed` (P4) — AFLDB's own fetch date, not upstream. It is also on the hash
  exclusion list.
- **Where the source provides none** — the AFL API lineup and player-details endpoints, and AFL
  Tables — store **NULL** and rely on AFLDB's own `observed_from` / `last_seen_at`.

**Consequence:** the **payload hash is the change oracle**. `source_updated_at` is a corroborating
and diagnostic signal where one truthfully exists, and is never required for correctness.

### B. Generic versus family-specific — spine plus typed projection

**Shared infrastructure:** the three-grain observation store (A1–A3); the
`import_batches`/`import_rejections` report contract; the reconciliation verb set (C); the
promotion candidate and decision ledger (D); the ownership and authority predicates (E, F); and a
`source_families` registry in reference data declaring, per family: the external key shape, the
hash exclusion list, the required column subset, the round mapping, and the independence group.

**Family-specific:** one **typed projection table per family** — typed columns, real foreign keys,
CHECK constraints. `staging.external_current_matches` (migration 063) is already exactly this
shape and is **retained**, gaining a link to its observation version and losing its
payload-overwriting `ON CONFLICT DO UPDATE`.

**The rule that keeps this from becoming a JSON dumping ground: the jsonb spine never feeds a
promotion.** Resolution and diffing read the typed projection; only history and absence read the
spine. **A family with no typed projection cannot be promoted at all.**

P3's finding makes the projection contract sharper: each family declares its **required** columns;
a missing required column or an unexpected column is a **refusal**, not a silent NULL.

### C. Reconciliation verb set

| Verb | Trigger | Default action |
|---|---|---|
| `unchanged` | incoming hash equals the open version's hash | touch `last_seen_at`; no version row, no diff row |
| `new` | `external_record_id` never observed for that source+family | version 1; diff row; candidate `insert` |
| `corrected` | new hash for an existing key, differing in a **fact** field | new version; diff row; candidate `update` |
| `rescheduled` | as `corrected`, but differences are only date/venue/round of an **unplayed** record | new version; distinct verb; **never** a score correction |
| `absent` | key missing from the **enumerated** key-scope | stamp `absent_since`; report line; **no canonical change** |
| `unresolved_identity` | club / venue / player / match will not resolve to a canonical id | `import_rejections` row + diff row; **refusal** |
| `source_disagreement` | ≥2 **independent** sources conflict on one canonical target | `data_issues` row; promotion blocked |
| `foreign_owned_collision` | the target row's source owner is not this source | **refusal, fail closed** |
| `manual_authority_conflict` | the ISSUE-086 authority contract reports an active human authority decision covering the proposed fields, **or cannot determine the authority state** | **refusal**, queued for review (§7) |
| `stale_review` | the canonical baseline changed between review and accept | **refusal**, candidate requeued (§6) |

`unresolved_identity` is also the refusal path for an unmapped club or venue string. No source may
create an identity, and `'Unknown'` is never written — which fixes the shipped
`venue_raw = 'Unknown'` defect **by contract** (the code fix itself is ISSUE-098's).

### D. Provenance and batch/report semantics

- Every accepted promotion writes `source_id`, `source_record_id` and `import_batch_id` on the
  canonical row, via the existing `add_provenance_columns` quartet (migration 001, applied to
  `matches` by 064).
- **Staging counts and canonical counts are never summed under one name.** The shipped
  `records_inserted = staged + inserted` conflation and the unfloored `unresolved -=
  candidates.length` are the anti-pattern; each verb reports its own counter, and no counter may
  go negative. (Repairing the shipped code is ISSUE-098's; forbidding it is this contract's.)
- Every refusal produces a report line and, where a row was rejected, an `import_rejections` row.
  Nothing is silently skipped.

### E. Ownership — source containment

A promotion may write a canonical row only where
`target.source_id IS NULL OR target.source_id = :source_id`.

Anything else is `foreign_owned_collision` and **refuses**. This is the `AFLDB-ISSUE-092`
`--source-key` containment pattern applied to promotion, reused rather than reinvented.

This is **source** ownership only. Human authority is a separate, stronger constraint — §7.

### F. Source corroboration — independence groups, not source rows

- **Definition.** Two sources are independent for a family only when neither's payload is derived
  from the other's dataset. **Independence requires evidence; it is never assumed.**
- Each source declares a per-family `derives_from` (a source key, or null) in reference data.
  `kali_afl_stats` `/fixture` → `squiggle_api`, **[PROBE]-proven**. `kali_afl_stats`
  `/matches` → **null, [PROBE]-proven independent by P1 on 2026-08-28** (§15.1).
  *Superseded:* while P1 was blocked this read **[UNKNOWN]** and the contract treated
  `/matches` as derived — the correct fail-closed default, now replaced by evidence.
- **Corroboration counts distinct independence groups, not distinct source rows.** Squiggle and
  Kali now count as **two** witnesses for matches and **one** for fixtures — the same pair
  of sources, a different answer per family, which is why the declaration is per family.
- **One caveat travels with that:** P1 disproved *pairwise* derivation, not a *common* ultimate
  upstream. Two groups here are weaker than two fully independent witnesses, so a disagreement
  between them is a **review** signal and never an auto-resolution.
- A proxy or derived source is represented explicitly by its `derives_from` edge, never by being
  quietly omitted — it remains a useful availability and latency signal even when it is not a
  second witness.
- Rewriting `sourceDisagreements` and `--source all` against groups is **ISSUE-097's** work. This
  contract supplies only the semantics it must satisfy.

### G. Season lifecycle and rollover

- `data/reference/seasons.json` `in_progress_seasons` is the **ownership switch**. A season in that
  list is owned by the API pipeline; any other season is owned by the fitzRoy full-history
  baseline.
- **Promotion refuses to write any season not in that list**, checked inside the promotion
  transaction. That is the mechanical form of "only the in-progress season belongs to this
  pipeline".
- **Rollover supersedes, never deletes.** In-season observation rows (A1–A3) are retained and
  marked superseded; canonical rows are re-imported by the full-history path, which re-stamps
  `source_id` and `import_batch_id`.
- **Surrogate AFLDB ids survive** because the full-history importer matches on natural/external key
  rather than truncate-and-reload — the `AFLDB-ISSUE-078`/`080`/`085` lesson.
- **Human authority survives rollover.** *(Amended 2026-08-28.)* The full-history rollover import
  is itself a source refresh, and **must respect the same ISSUE-086 authority contract, on the same
  fail-closed terms, once that contract lands** (§7). Rollover is not an exemption from human
  authority.
- Executing the rollover is **ISSUE-101**. This contract defines only the superseding semantics.

### H. Validation strategy

**DB-free contract tests** — extend `tests/current-season-import.test.ts`, the existing semantic
home per `CLAUDE.md` §10:

- canonicalisation and hash determinism, including the per-family volatile-field exclusion list
  (`data_accessed` is the proven case);
- **version-append logic**, driven directly: unchanged poll appends nothing; A→B→A yields
  `version_seq` 1/2/3 against **two** payload rows; interval chaining closes each prior version
  with no gap or overlap and leaves exactly one open version;
- **absence grain**: the sweep writes `absent_since` on the record row only, never on a version;
  absence is not asserted outside the enumerated key-scope;
- one case per reconciliation verb in C;
- independence-group counting, including the Kali-proxy case and the P1-blocked fail-closed case;
- the **authority-interface truth table against a stubbed ISSUE-086 authority provider**, including
  the **indeterminate → refuse** case (§7);
- source-ownership containment truth table;
- per-source round-mapping resolution across the three proven vocabularies.

**PostgreSQL integration tests** — `afldb_test` only, never `afldb_dev`, never production:

- **idempotence** — identical re-run yields 0 canonical writes, 0 new payload rows, 0 new version
  rows, `last_seen_at` advanced, `current_version_seq` unchanged;
- **correction replay** — A→B→A yields **3 version rows and 2 payload rows**, strictly ordered,
  none lost or rewritten;
- **absence ≠ deletion** — `absent_since` set on the record row, canonical untouched, and a later
  reappearance clears it without appending a version when the payload is unchanged;
- **foreign-ownership refusal**;
- **stale-review race** — mutate the target between render and accept ⇒ refusal and requeue;
- **manual-authority refusal**, including the indeterminate case, against the ISSUE-086 contract;
- **source disagreement** — blocked, with a `data_issues` row;
- **rollover supersession** — surrogate ids preserved, human authority preserved.

All fixtures are deterministic. **No test depends on a live API.**

---

## 6. Promotion contract

A **promotion candidate** carries: the verb; the target table; the target id (null for `new`); the
proposed field set; the **agreeing and disagreeing source sets** (by independence group, F); and a
`baseline_canonical_hash` — a hash of the target row's current values for **exactly the fields this
promotion would write**, captured when the review screen renders.

On accept, inside **one** `sql.begin`:

1. re-read the target and recompute `baseline_canonical_hash`;
2. **refuse if it changed** ⇒ verb becomes `stale_review`, candidate returns to the queue. This is
   the answer to "canonical state changed after review but before promotion";
3. **re-evaluate both** the source-ownership predicate (E) **and** the ISSUE-086 authority query
   (§7) — neither is trusted from render time, and **either failing refuses the promotion**;
4. verify the target season is in `in_progress_seasons` (G);
5. write the canonical row plus its provenance quartet (D);
6. append a `promotion_decisions` row — modelled exactly on `player_link_resolutions`
   (migration 056) and `data_edits` (migration 057): append-only by grant, `admin_user_id`,
   `previous_values` / `new_values` jsonb, optional note.

A reject writes the decision row and nothing else.

**What the super-admin sees:** the verb; the canonical target's current values; the proposed
values; a per-field diff; which independence groups agree and which disagree; and the observation
lineage (`first_seen_at`, `version_seq`, `source_updated_at` where one truthfully exists).

**No automatic canonical promotion is built.** The single narrow auto-promote candidate in the
parent runbook §4 rule 10 is recorded as a future option only, and is **not** part of this
contract.

---

## 7. Manual / admin authority — invariant and interface *(amended 2026-08-28)*

**Invariant (owned by ISSUE-096):**

> A current-season promotion must **never** overwrite an active human/admin authority decision, and
> must **fail closed** whenever that authority state cannot be determined.

**Mechanism (owned by `AFLDB-ISSUE-086`, not defined here):**

`AFLDB-ISSUE-086` is currently defining durable source-reload override authority — a `data_overrides`
concept has been indicated. **Its final contract is authoritative.** ISSUE-096 must **call and
reuse** that contract and must **not invent a second, competing authority model**. The storage
design, the granularity of an override, its lifecycle and its expiry are all ISSUE-086's to settle,
and are deliberately not pre-empted here.

**Required interface — behaviour only, no storage design:**

1. A query answering, for a given `(entity, row id, field group)`: *is there an active human
   authority decision covering these fields?*
2. It must be callable **inside the promotion transaction**, so the answer cannot go stale between
   check and write.
3. It must be **fail-closed**. Unavailable, indeterminate, or not-yet-implemented ⇒ the promotion
   **refuses** with `manual_authority_conflict` and is queued for review. Proceeding on an
   unknown answer is prohibited.
4. Its verdict is **not** overridable by this pipeline. There is no force flag.

**`data_edits`** (migration 057) is **audit evidence**. It records what a super admin changed, with
old and new values, append-only by grant. It **may participate in the authority determination only
if ISSUE-086's final contract says so**, and ISSUE-096 does not assume that it does.

**Supporting source evidence, recorded so ISSUE-086 has it** *(not a design decision)*:
`applyDataEdit` (`src/db/queries/data-edits.ts:300-308`) stamps
`attendance_source_id = 'manual_admin_edit'` for the attendance field group, and does **not**
re-stamp `matches.source_id` for the score or dob field groups. Row-level `source_id` therefore
cannot by itself distinguish a manually corrected row from a source-owned one — which is precisely
why the authority mechanism must be ISSUE-086's explicit contract rather than an inference this
pipeline makes on its own.

**Implementation gate.** This contract is complete without ISSUE-086. But **promotion of
`corrected` / `update` candidates onto existing canonical rows cannot be implemented until
ISSUE-086's authority contract lands**, because until then every such promotion is
authority-indeterminate and must refuse. Recorded as a dependency, not as new policy.

---

## 8. Schema concepts — no migration implementation

Concepts only. **No migration file is written under ISSUE-096.** Column lists are indicative; final
types, constraints, indexes and grants belong to whichever implementation issue lands them, and
every new public table needs `afldb_meta.grant_app_read()` / the `privileges.sql` reconciler
treatment.

| Concept | Grain | Purpose |
|---|---|---|
| `staging.source_payloads` | `(source_id, family, payload_hash)` | Immutable deduplicated content (A1) |
| `staging.source_record_versions` | `(source_id, family, external_record_id, version_seq)` | Ordered distinct states, valid-time intervals (A2) |
| `staging.source_records` | `(source_id, family, external_record_id)` | Current-key state, `last_seen_at`, **`absent_since`** (A3) |
| *typed projection per family* | family-specific natural key | Typed, FK-bearing, CHECK-constrained; **the only promotion input** (B). `staging.external_current_matches` is the existing instance. |
| `promotion_candidates` | one per diff awaiting review | Verb, target, proposed fields, agreeing/disagreeing groups, `baseline_canonical_hash` (§6) |
| `promotion_decisions` | one per super-admin decision | Append-only ledger on the `player_link_resolutions` / `data_edits` pattern (§6) |
| *reference data* | `sources.json`, new `source_families` | Per-family `derives_from`, hash exclusions, required columns, round mapping (B, F) |

Existing objects reused unchanged: `sources`, `import_batches`, `import_rejections`, `data_issues`,
`add_provenance_columns`, and the `manual_admin_edit` source row.

## 9. Source and family boundaries

| Family | Preferred source | Promotion | Boundary note |
|---|---|---|---|
| Match result / scores | AFL Tables via fitzRoy | Reviewed | Squiggle is the *trigger*, never the authority. |
| Quarter / period scores, attendance | AFL Tables | Reviewed | Attendance deduped from player-match grain; NULL ≠ 0. |
| Player match statistics | AFL Tables | Reviewed | **Keyed on profile `url`**, not `ID` (P5). |
| Player identity | AFL Tables `url` | Reviewed | A new player is **always** a human decision. AFL API `providerId` is a **secondary** `external_identities` row, through the ISSUE-092 gate. |
| Rosters / DOB / height / jumper | AFL API player details | Reviewed | **`weightInKg` = 0 ⇒ NULL.** DOB respects ISSUE-090 / migration 072 `dob_conflict` rules. |
| Lineups | AFL API `fetch_lineup_afl` | **Never promoted** **[DECISION]** | Staging-only. Required-column subset declared; schema drift is a refusal. |
| Fixtures (unplayed) | AFL API + Squiggle | **Never promoted** | `matches` requires NOT NULL scores; staging-only avoids a schema change. |
| Ladder / team-season | **owned by ISSUE-095** | — | This contract contributes P6 evidence only. |
| Venues, clubs | registry only | **Never** | An unmapped display name is a **refusal**, never an insert. |
| Awards, draft | see ISSUE-102 / DraftGuru | — | Out of scope here. |

## 10. Interaction with other issues

**`AFLDB-ISSUE-086` — override authority.** ISSUE-086 owns the durable mechanism for human/admin
override authority against source reloads, including its storage design, and owns its own severity
triage. ISSUE-096 defines only the **invariant** that a promotion must never overwrite an active
human decision, and the **fail-closed interface** it needs (§7). **No duplicate issue is created**,
no second authority model is invented, and the unrestricted canonical score overwrite at
`current-season-import.ts:567-590` remains ISSUE-086's behaviour class. **ISSUE-096 must not access
ISSUE-086's worktrees or in-flight work.**

**`AFLDB-ISSUE-095` — ladder / team-season.** Coordinated, **not absorbed**. D1–D7 remain open and
are not pre-empted. This work contributes P6 shape evidence only (parent runbook §6, §13.6). Two
standing constraints are respected: **do not weaken `recomputeClubSeasons`'s empty-staging guard**
to make current-season promotion easier, and **do not add a `club_seasons` Stage-9 gate** until
ISSUE-095 lands. A 2026+ API-sourced ladder row must not inherit the hardcoded `sports_data_lab`
`source_id` — that provenance decision is ISSUE-095 D4's.

**`AFLDB-ISSUE-097` — Squiggle/Kali independence.** Consumes F's independence-group semantics and
owns the `sourceDisagreements` / `--source all` rewrite. **P1 remains BLOCKED**; until it resolves,
this contract's fail-closed default holds.

**`AFLDB-ISSUE-098` — shipped importer defects.** Independent of this contract and may proceed now.
This contract forbids the same defect classes going forward; ISSUE-098 repairs the shipped code.
P7 would size the live impact but is not required to start.

**`AFLDB-ISSUE-099` — in-season settle stage.** Depends on this contract. **P5 passed, so it is no
longer probe-blocked**, with one binding correction: **key on profile `url`, not `ID`**.

**`AFLDB-ISSUE-100` — staging-only lineups.** Depends on this contract. **P3 passed, so the shape
is known and it is no longer probe-blocked**, with two binding constraints: a declared required
column subset with refusal on drift, and lineups **never** becoming canonical participation.

**`AFLDB-ISSUE-101` — rollover.** Depends on ISSUE-099 and on coordination with ISSUE-095. Inherits
G, including the amended requirement that rollover respect ISSUE-086's authority contract. Must not
redefine completed-season `club_seasons` ownership.

**`AFLDB-ISSUE-102` — awards.** Record only. No design work, no source selection, no importer.

**None of ISSUE-097–102 is started by this work.**

## 11. Implementation decomposition

**ISSUE-096's own stages — contract only, and none is authorised by this document:**

| Stage | Deliverable |
|---|---|
| **S1** | Reference-data contract: per-family `derives_from` / independence groups; the `source_families` registry (key shape, hash exclusions, required columns, round mapping). |
| **S2** | Schema **concepts** signed off: the three observation grains, the promotion candidate and decision ledger. Still no migration. |
| **S3** | The reconciliation verb set, the source-ownership predicate, and the **ISSUE-086 authority interface** as a typed module with DB-free tests against a stubbed provider. |
| **S4** | The promotion-review contract: what the admin screen must render and enforce, including the stale-review recheck. |

**Explicitly belonging to other issues:** ISSUE-097 independence semantics · ISSUE-098 the four
shipped defects · ISSUE-099 the settle stage · ISSUE-100 lineups · ISSUE-101 rollover · ISSUE-102
awards · ISSUE-095 ladder · ISSUE-086 authority mechanism. **None is absorbed into ISSUE-096.**

---

## 12. Unresolved decisions — requiring user approval

1. **A** — the three-grain observation model (payloads / versions / records) as the way to hold I1
   and I2 simultaneously, and the deliberate omission of a per-fetch event log.
2. **B** — retaining `staging.external_current_matches` as the match projection rather than
   introducing a new table.
3. **D/§6** — **no** automatic canonical promotion at all in v1, including for unambiguous
   completed-match scores.
4. **§7** — that ISSUE-096 defines only the invariant and the fail-closed interface, and that
   promotion of `corrected` candidates is gated on ISSUE-086's contract landing.
5. **F** — treating Kali as Squiggle-derived until P1 proves otherwise.
6. Whether to retry **P1/P2** once a `KALI_AFL_API_KEY` is available, and **P7** once interactive
   SSH/database access is available.

## 13. HALT — **LIFTED 2026-08-28 by §14**

> **Superseded, retained as lineage.** The approval point below was reached and cleared. §14
> records the approvals verbatim and §15 records what has since been implemented. The original
> text is preserved because it defines what was *not* authorised before approval.

**This is the approval point. Stop here.**

No migration, no importer, no schema change, no admin UI and no test file may be written until the
user has reviewed and approved decisions A–H and the §12 list. `AFLDB-ISSUE-098` is the only
related work that may proceed independently.

---

## 14. Approval record — 2026-08-28

The user approved the amended contract and **lifted the §13 HALT**. Recorded verbatim in
substance, because every later stage inherits these as constraints rather than proposals.

| # | Approved | Consequence |
|---|---|---|
| 1 | **A — three-grain observation model.** Immutable content-addressed `source_payloads`; ordered `source_record_versions` keyed by `version_seq` with valid-time intervals; `source_records` for current-key state and `absent_since`. A→B→A = **three version rows, two payload rows**; an unchanged poll = **zero** new observation/version rows. | S2 implements A1–A3 as specified. |
| 2 | **B — retain `staging.external_current_matches`.** Preserve it for compatibility and integrate it into the generalised architecture; do **not** delete it to make the model uniform. | ISSUE-096 is **not** a rewrite of `current-season-import.ts`. |
| 3 | **No automatic canonical promotion in v1.** Acquisition, staging and diff may be automatic; promotion stays reviewed/super-admin. **No score auto-promotion exception.** | The registry (§15) declares no promotable family, and S4 builds no automatic path. |
| 4 | **§7 manual-authority boundary.** ISSUE-096 defines the fail-closed interface and invariant only; **ISSUE-086 owns the mechanism and storage**; `data_overrides` is ISSUE-086's; `data_edits` participates only if ISSUE-086's contract says so. | Do not implement or duplicate ISSUE-086 here. Its worktree is off limits. |
| 5 | **F — Kali independence.** Kali belongs to the Squiggle-derived independence group for match corroboration and must not count as an independent match witness unless P1 later proves independence. | Enforced by the registry validator (§15). |
| 6 | **P1/P2/P7 are not retried.** P1/P2 remain `BLOCKED` (no usable `KALI_AFL_API_KEY`); P7 remains `BLOCKED (execution)` (authoritative host/database never reached). **No local database may substitute for P7**, and no blocked probe authorises guessing. | The unknowns stay recorded as unknowns; nothing infers past them. |

**Scope change this creates.** The approvals convert ISSUE-096 from *design-only* to
*foundation implementation* through stages **S1–S4** (§11). §2's "no migration file" non-goal is
amended accordingly; the family-importer exclusions are unchanged and still binding.

**Additional standing instructions carried in with the approval:** work through the runbook's
established stage order; DB-free semantic tests are mandatory; any PostgreSQL integration
validation uses **`afldb_test` only** — never `afldb_dev`, never production; provenance counters
never mix staging and canonical grains and never go negative; every promotion interface is
source-contained (`source_id IS NULL OR source_id = :source_id`); `data/reference/seasons.json`
`in_progress_seasons` remains the ownership switch; rollover **supersedes**, never deletes.

---

## 15. Implementation record

### 15.1 P1 re-run — Kali `/matches` independence — **PASS**, and it **changed S1**

Approval 6 said P1/P2 were not to be retried; the user then supplied `KALI_AFL_API_KEY` and
**explicitly authorised the retry**, which supersedes that item for P1 and P2 only. **P7 remains
BLOCKED and no local database may substitute for it.** Full evidence:
`AFLDB-2026-API-ACQUISITION.md` §13.1.

**Verdict: Kali `/matches` is NOT a Squiggle proxy**, on five independent proofs — a real
value disagreement on a completed match (Essendon v Port Adelaide 2026-08-23: Kali 95–105 vs
Squiggle 95–104, Squiggle `complete = 100`); `crowd` populated for 80 of 204 rows where
Squiggle publishes no attendance field at all; disjoint id spaces (11405–11611 vs
38494–38729, **0** shared); a different venue vocabulary on 80 of 160 jointly observed games;
and no goals/behinds where Squiggle carries both.

**This falsified an approved S1 declaration.** Approval 5 placed Kali in the Squiggle group
*"unless P1 later proves independence"*. P1 has, so the escape clause fires and the registry is
corrected rather than left knowingly stale. **Amendments applied to S1** (nothing else was
touched, and S2 was not started):

| Element | Before (fail-closed default) | After (evidence) |
|---|---|---|
| `kali_afl_stats`/`match` `independence` | `derives_from: squiggle_api`, group `squiggle`, `assumed_derived_pending_probe` | `derives_from: null`, group **`kali`**, `proven_independent` |
| `kali_afl_stats`/`match` `status` | `identity_only` — shape unknown | **`declared`** — 14 columns, key `["id"]` |
| `kali_afl_stats`/`match` `source_updated_at_field` | `null` | **`sourcedAt`** |
| `kali_afl_stats`/`match` `round_vocabulary` | `null` | new **`kali_2026`** |
| `kali_afl_stats`/`fixture` | proven derived, group `squiggle` | **unchanged** — still a proven verbatim proxy |
| Witnesses for `match` | 1 | **2** |

**`sourcedAt` is a genuine upstream mutation timestamp — measured, not assumed.** Two fetches
1.5 s apart returned byte-identical payloads, and five recent rows carried five distinct values
spanning 2026-08-21 → 2026-08-23. A fetch-time field would have been uniform and would have
advanced. It therefore satisfies A′ and **stays inside the payload hash** as content.
**Residual risk, recorded:** if a later observation ever shows `sourcedAt` advancing while every
other field is unchanged, it must move to the hash exclusion list, because that would break I1.
S2/S3 idempotence testing is where that would surface.

**Round numbering.** Kali numbers Opening Round **0** and the last home-and-away round **24** —
the same integers as Squiggle, with **0** disagreements across all 160 jointly observed games, and
different from AFL Tables (**1** and **25**). Recorded as a shared *convention*; the vocabulary is
still declared per source as `kali_2026`, because agreement is evidence, not identity.

**What P1 does NOT prove, stated plainly:** it disproves *pairwise* derivation, which is what this
contract's independence definition tests. It does **not** exclude a **common ultimate upstream**
— both feeds could read AFL.com.au. So corroboration by these two groups is weaker than two
fully independent witnesses. **This is the one judgement call in the amendment and is flagged for
review:** the contract's own definition is satisfied, so the group split is correct under the
rules as written; if the user prefers independence to also require a proven-distinct *ultimate*
upstream, the definition in F must change and this entry reverts.

**Practical vindication.** Under the old one-group model the Essendon v Port Adelaide
95–105/95–104 disagreement would have been invisible — self-agreement reported as
corroboration. Under the corrected model it is exactly the `source_disagreement` verb's trigger.

### 15.2 P2 re-run — Kali stable player identity — **PASS**; the gap is now proven

Full evidence: `AFLDB-2026-API-ACQUISITION.md` §13.2.

**Verdict: there is no stable provider player identifier on the player-stat grain.**
`/player-stats` and `/player-stats-advanced` project `matchId`, `playerName`, `teamId` and the
statistics — **no player id**. `/players` does hold a stable numeric `id` and slug `onlineId`
(2,865 distinct each, 0 null across the full population), and the documented `player_id` filter
**works** on the numeric id (`player_id=301` → 17 rows, one player; the slug is rejected 400)
— so Kali holds the id internally and simply does not project it.

**Chosen identity contract: refuse.** A new `kali_afl_stats`/`player_stats` family is declared
`identity_only`, so it can be neither projected nor promoted. AFL Tables profile `url` remains the
sole proven player-match identity for 2026. Name + team is a **heuristic and stays one**: it
resolved 200/200 on a round-20 sample, but the population contains same-name players on the *same*
team (two Alwyn Daveys, both `essendon`) and `currentTeamId` is the *current* team, not the team
at match time — so it degrades exactly where history matters. The only real identity path is
enumerating `/players` and fetching per `player_id`, which at 1,000 requests/day is a multi-day
crawl per season. Recorded; not adopted.

**Test amendments made alongside** (`tests/reference-data.test.ts`): the witness-count test now
asserts **two** groups for `match` and pins the derived-group refusal on `/fixture` instead;
a new test keeps the Kali player grain fail-closed; the `source_updated_at` inventory gains
`kali_afl_stats/match`; the "no round vocabulary" refusal moved to `afl_api`/`roster`; and a new
assertion proves `kali_2026` and `squiggle_2026` round integers still refuse comparison despite
agreeing.

### 15.3 Provider independence is NOT ultimate-authority independence — **approved boundary**

Recorded at the user's direction when the P1/P2 amendments were approved, because the distinction
is easy to lose once `independence_group` values simply look different.

**What P1 proved:** Squiggle and Kali `/matches` are **provider/pipeline-independent** for the
`match` family. Kali is not a Squiggle-derived or mirroring source. That is sufficient for separate
`independence_group` values under this contract, whose independence test is *pairwise derivation*.

**What P1 did not prove:** that the two have **distinct ultimate factual authorities**. Both could
still take some facts from a common upstream such as AFL.com.au.

**The standing rules that follow:**

1. Squiggle + Kali count as **two provider/pipeline witnesses** for the `match` family.
2. They must **not** be read as two **proven-distinct ultimate authorities**.
3. **Separate independence groups alone are insufficient evidence for automatic canonical
   promotion.** Agreement between two pipelines that may share an upstream is not corroboration of
   the underlying fact.
4. This changes no behaviour today: S1 declares **zero** automatically promotable families, and S2
   builds no automatic promotion path.
5. If a future promotion policy ever wants **independent ultimate authorities** rather than
   independent acquisition pipelines, that is a **new explicit contract and evidence decision** —
   it may never be inferred from `independence_group`.

`independence_group` therefore answers exactly one question: *did these two payloads come through
the same pipeline?* It does not answer *do these two payloads ultimately rest on the same
observation of the game?*

### S1 — reference-data contract — **IMPLEMENTED 2026-08-28**

**Contradiction check against the approved architecture: none found.** Verified before writing
anything: `current-season-import.ts` already addresses sources by **stable key** and resolves the
numeric id at runtime (`sourceKey()` `:207-209`; `SELECT id FROM sources WHERE key = …` with a
hard failure when absent, `:363-370`), so no tracked contract depends on a database-local
`sources.id` and S1 does not have to unwind an existing dependency.

**Files added**

| File | Role |
|---|---|
| `data/reference/source-families.json` | The tracked declaration: per `(source_key, family)` — external key shape, hash exclusions, required/known columns, round vocabulary, independence group, promotion policy, evidence and notes. |
| `src/lib/acquisition/source-families.ts` | Typed, **pure** (no fs / no DB / no network) fail-closed parser and the S1 accessors: `parseSourceFamilyRegistry`, `getSourceFamily`, `independenceGroups`, `countIndependentWitnesses`, `isPromotable`, `assertProjectableColumns`, `roundKey`, `roundKeysEqual`, `translateRound`. |
| `tests/reference-data.test.ts` (extended) | Nine DB-free contract tests in a new `source families dataset (AFLDB-ISSUE-096 S1)` block. Existing semantic home per `CLAUDE.md` §10 — **no new test file**. |

**What the registry declares today** — **seven** families over four sources (amended by §15.1/§15.2):

| Source | Family | Status | Independence group | Promotion |
|---|---|---|---|---|
| `squiggle_api` | `match` | declared (26 columns) | `squiggle` (proven independent) | `never` — trigger, not authority |
| `kali_afl_stats` | `match` (`/matches`) | declared (14 columns) | **`kali`** (**proven independent, P1**) | `never` |
| `kali_afl_stats` | `player_stats` | **identity_only** — **no player id exists** (P2) | `kali` | `not_yet_declared` |
| `kali_afl_stats` | `fixture` (`/fixture`) | declared (verbatim Squiggle games) | `squiggle` (**proven derived**) | `never` |
| `afltables` | `player_match_stats` | **identity_only** — 81 columns not enumerated | `afltables` | `not_yet_declared` (ISSUE-099) |
| `afl_api` | `lineup` | declared (19 columns, **incomplete**) | `afl_api` | `never` — standing **[DECISION]** |
| `afl_api` | `roster` | declared (17 columns) | `afl_api` | `not_yet_declared` |

**Ladder is deliberately absent.** P6 evidence stays with `AFLDB-ISSUE-095`; no ladder source
decision is made here.

**Invariants the validator now enforces (fail closed, no force flag):**

1. Unknown or missing keys anywhere in the dataset are a **refusal**, not an ignored field.
2. A **derived** source may not invent its own independence group — it must share the group of the
   source it derives from. `derives_from = null` ⟺ `evidence = proven_independent`.
3. `promotion_policy = 'reviewed'` requires a **declared** column contract **and** a source that
   actually has a `sources` row. **No family in the registry is promotable today**, which is the
   mechanical form of approval 3.
4. `status = 'declared'` requires key + required + known columns; `status = 'identity_only'`
   forbids all of them, so a shape nobody proved cannot leak in half-declared.
5. `required` / `external_key` / `hash_exclusions` / `zero_is_missing` ⊆ `known_columns`.
6. A hash-excluded field may **not** also be `source_updated_at` — volatile response noise and a
   genuine upstream mutation timestamp are mutually exclusive.
7. `assertProjectableColumns` refuses a **missing required** column *and* an **unexpected**
   column. There is no silent NULL and no permissive jsonb fallback.
8. Round integers are comparable **only inside one declared vocabulary**; `roundKeysEqual` throws
   across vocabularies and `translateRound` refuses while any mapping is `anchors_only`.

**Evidence bound into the registry** — P3: lineup 104×19 (R25) / 468×20 (R20), `providerId` /
`teamId` / `player.playerId`, `status` / `teamStatus`, no substitute field, 20-value position
vocabulary. P4: Carlton 46×17, 26/26 lineup ids present as `providerId`, `weightInKg` 0 for 46/46
⇒ `zero_is_missing`, `data_accessed` ⇒ hash exclusion. P5: 9,522×81, `url` 0 NA, **`ID` 82 NA
across 5 urls ⇒ never required**, `Substitute` NA throughout, three colliding round vocabularies.
Squiggle `updated` is the **only** genuine `source_updated_at` in the registry (Kali `/fixture`
carries Squiggle's own value verbatim).

**Deviations and consequences — recorded, not smoothed over**

1. **Source-registry drift is recorded, not repaired.** `squiggle_api` and `kali_afl_stats` are
   registered by **migration 063**, not by `data/reference/sources.json`, and `afl_api` has **no
   `sources` row anywhere**. S1 deliberately did **not** add rows to `sources.json`: that dataset
   feeds the canonical rebuild's reference stage, and §8 reuses `sources` unchanged. Instead each
   source declares `registered_by` / `registration_owner`, and the validator refuses reviewed
   promotion for an unregistered source. **Registering `afl_api` belongs to `AFLDB-ISSUE-100`.**
2. **The lineup column set is deliberately incomplete.** P3 enumerated the 19 round-25 columns and
   measured 20 at round 20 without enumerating the extra one. `known_columns_status` is therefore
   `incomplete`, and a round-20 payload **will refuse**. That refusal is correct fail-closed
   behaviour and is `AFLDB-ISSUE-100`'s signal to enumerate the missing column before building
   `staging.external_lineups`. It is not a bug to be relaxed.
3. **Two families are `identity_only`** and cannot be projected or promoted at all: `afltables`
   `player_match_stats` (81 columns unenumerated; ISSUE-099 declares them with its own evidence)
   and `kali_afl_stats` `player_stats` (**no player id exists** — P2). *Amended:* the
   second slot was originally `kali_afl_stats` `match`, which P1 has since resolved to a fully
   declared shape. `current-matches.ts` still probes candidate Kali field names at runtime; that
   is a reader's tolerance and the contract uses the **measured** column set instead.
4. **Round mappings are anchors only.** Only proven anchor points are declared (AFL Tables
   Opening Round = 1 and round 25 = last home-and-away; Squiggle Opening Round = 0; AFL API round
   25 = Wildcard Finals). Completing a mapping belongs to ISSUE-099 / ISSUE-097 / ISSUE-100.
5. **The dataset is not loaded into PostgreSQL.** `load_reference_data.py` reads a fixed file list
   and is untouched, so the new file is inert for the rebuild path. Whether any of this registry
   belongs in a database table is an **S2** question, not an S1 one.

**Not done in S1 (correctly):** no migration, no observation tables, no reconciliation verbs, no
payload hashing (S3 owns it and consumes `hash_exclusions`), no promotion ledger, no family
importer, no change to `sources.json`, `seasons.json`, `current-season-import.ts` or
`staging.external_current_matches`.

**Validation:** DB-free only. `npm test -- tests/reference-data.test.ts` — user-run
2026-08-28, **GREEN 33/33** (source families 9/9), with one assertion corrected for case
sensitivity only (no contract or data change). **The registry has since been amended by the
P1/P2 re-run (§15.1, §15.2), so it needs one more green run before S2.**

### S2 — observation and promotion-ledger foundation — **IMPLEMENTED 2026-08-28**

Approved after the P1/P2 amendments, with the §15.3 authority boundary recorded first.

**Files added/changed**

| File | Role |
|---|---|
| `src/db/migrations/074_source_observation_spine.sql` (new) | The three observation grains + the reviewed-promotion ledger. |
| `src/lib/acquisition/observations.ts` (new) | The pure half: hashing, the version-append decision, absence sweep, ownership, the ISSUE-086 authority boundary, acceptance. No DB, no fs, no network, no clock. |
| `tools/maintenance/privileges.sql` | Registers both promotion tables in the **subtractive** `afldb_auth` reconciler. |
| `tests/current-season-import.test.ts` | 28 DB-free S2 tests in seven new describes — the semantic home this runbook nominated. |

**The three grains, and why each exists**

- `staging.source_payloads` — immutable content addressed by `(source_id, family, payload_hash)`.
  Deduplication here is what makes A→B→A cost **two** payload rows.
- `staging.source_record_versions` — ordered history keyed by **`version_seq`**, with a valid-time
  interval and a partial unique index enforcing **exactly one open version per key**. It carries a
  standing comment forbidding a unique constraint on `payload_hash`: that single index is the one
  thing that would collapse the returning A, and a test asserts it is absent.
- `staging.source_records` — current head, `first_seen_at`/`last_seen_at`, `scope_key` and
  **`absent_since`, which lives here and nowhere else**. Absence is a property of the external key,
  not of a historical payload. `scope_key` records the enumeration the record was last seen in, so
  a sweep can never assert absence outside a scope the fetch actually enumerated.

**Reversibility built in, per the Kali residual.** Every payload row stores the `hash_recipe`
(algorithm + the family's exclusion list) that produced its hash, and `decideObservation()`
recomputes the head's hash from its retained raw payload when the recipe has changed. Moving
`sourcedAt` to the exclusion list is therefore a **reference-data edit**: no migration, no backfill,
and no spurious version on the first poll after the change. A test drives exactly that transition.

**Fail-closed in the schema, not only in code.** `promotion_candidates_acceptable_ck` makes
`status = 'accepted'` representable **only** for `new`/`corrected`/`rescheduled`; every refusal verb
is barred by CHECK. `absent` candidates must carry no target and no proposed fields. A resolved
candidate must name the decision that resolved it.

**Grants — a defect caught during implementation and recorded.** The first draft wrote
`grant_import_write('promotion_decisions')` and then `REVOKE UPDATE, DELETE` to make the ledger
append-only. **Rejected before it landed:** `grant_import_write()` registers the table in
`afldb_meta.import_writable_tables`, and `privileges.sql` regenerates the full
`SELECT/INSERT/UPDATE/DELETE/TRUNCATE` set from that registry — so the REVOKE would have been
silently undone at the next reconcile and the ledger would have stopped being append-only with no
migration, no commit and no warning. **Replaced by** the `data_edits` (057) pattern: the ledger is
written by `afldb_auth` with `SELECT, INSERT` only and is listed in `privileges.sql`'s subtractive
`afldb_auth` spec; `promotion_candidates` gets `SELECT` plus a **column-scoped**
`UPDATE (status, resolved_at, resolved_decision_id)` on the 056 pattern, so a reviewer moves the
workflow but can never edit the proposal or its source evidence. A test asserts both the migration
text and the reconciler entries, because either alone is insufficient.

**Acceptance gate order** (first failure wins, every input re-read rather than trusted from render):
`not_pending` → `verb_not_promotable` → `stale_review` (source version moved) →
`stale_canonical_target` (baseline hash moved) → `season_not_in_progress` →
`foreign_owned_collision` → manual authority. Authority is last and strongest, and has **three**
answers: `clear` proceeds, `conflict` refuses, and **`indeterminate` refuses identically**. The
shipped provider is `UNAVAILABLE_MANUAL_AUTHORITY`, which always answers `indeterminate` — so
until ISSUE-086 lands, promotion onto an existing row refuses by construction rather than by
discipline.

**ISSUE-086 boundary.** The authority question is `{entity, targetKey, fields}` where `targetKey` is
an **opaque record the caller fills in**, so the acquisition spine is not coupled to whatever
surrogate ids or storage ISSUE-086 settles on. No `data_overrides`, no second override store, no
force flag — asserted by test.

**Provider provenance.** `source_id` leads the key of all three grains and the candidate's evidence
FK `(source_id, family, external_record_id, source_version_seq)`, so two providers describing one
real-world match stay two observations **even when their projected payloads hash identically** —
which a test demonstrates directly. `witnessGroups()` reports independence groups and is
**deliberately not consulted by `evaluateAcceptance`**; a test asserts that the acceptance function's
source text never mentions it, so a two-source consensus rule cannot appear by drift. Per §15.3,
two provider groups are not two proven ultimate authorities.

**Not done in S2 (correctly):** no promotion transaction (S4), no admin UI, no family importer, no
diff/verb computation from a live payload (S3), no change to `current-season-import.ts` or
`staging.external_current_matches`, no CHANGELOG entry — the migration has not been applied or
validated anywhere yet, so nothing has actually landed.

**Validation:** user-run 2026-08-28, three runs of
`npm test -- tests/current-season-import.test.ts`. **Run 1 — 59/61, test file FAILED.** Every
behavioural test passed; the two failures were source-contract assertions that read raw migration
text. Both were **confirmed false positives** (they matched the migration's own explanatory
comments) and the **tests** were repaired statement-aware; the migration is unchanged. **Run 2 —
61/61, PASSED**, proving the repair. **Run 3, after the §16.4 hygiene fixes — 61/61, 0 failures,
303 ms, PASSED.** **S2 IS COMPLETE AND GREEN.** Full evidence, the confirmed matched substrings
and the repair are in §16.3. Migration **074** (not 073) is **unapplied**:
any PostgreSQL validation is `afldb_test` only.

### S3 — reconciliation semantics and containment — **COMPLETE and GREEN 2026-08-28**

Entered from §16.7 with S2 green. Nothing in S3 applies migration 074, and no family importer,
promotion transaction or admin screen was written.

**Contradiction check against the approved S3 design: none found.** `observations.ts` still ships
`evaluateOwnership`, `ManualAuthorityProvider` and `UNAVAILABLE_MANUAL_AUTHORITY` exactly as §15's
S2 record describes them, so S3 extends them rather than unwinding anything.

**Files added/changed**

| File | Role |
|---|---|
| `src/lib/acquisition/reconciliation.ts` (new) | The verb computation, the S3 reading of the ownership predicate, and the ISSUE-086 authority boundary. Pure — it imports `./observations` and `./source-families` and nothing else, which a test asserts. |
| `tests/current-season-import.test.ts` | 23 DB-free S3 tests in five new describes, against a stubbed authority provider. |

**The verb computation.** `reconcile()` takes one live source record — payload, or its absence
inside an enumerated scope — the stored open version, the caller's identity resolution, the
family's typed projection of the payload, the canonical row's current values for exactly those
fields, other providers' claims, an authority provider, and (when re-deriving a rendered proposal)
the review context. It returns a classification. **It writes nothing**, and the strongest outcome
it can produce is a candidate a super admin must still accept, at which point `evaluateAcceptance`
re-runs every gate inside the transaction.

**Precedence, exported as `VERB_PRECEDENCE` so it is reviewable rather than implied:**

`stale_review` → `absent` → `unchanged` → `unresolved_identity` → `foreign_owned_collision` →
`source_disagreement` → `manual_authority_conflict` → `new` / `rescheduled` / `corrected`.

Two principles fix that order. **Structural facts come before content:** stale evidence, an absent
key and an unchanged payload are true regardless of what any gate would say. And **a refusal gate
runs only when a canonical write is actually proposed** — refusing a promotion nobody proposed
would fill the review queue with noise on every poll, which is why `unchanged` short-circuits
ahead of every gate and why ownership, corroboration and authority are never consulted for it.

**Verb boundaries, as implemented**

- `unchanged` — decided by `decideObservation` under the family's hash contract alone. No
  candidate or canonical semantics participate, and the authority provider is not called.
- `new` — the identity resolved and **no canonical row exists**. Identity resolution is the family
  importer's job and is consumed, never guessed: a weak or raw name resolves to `unresolved`.
- `corrected` — an existing owned canonical fact whose source-owned values genuinely changed. The
  proposal names **only the fields that moved**.
- `rescheduled` — schedule-only movement on an **unplayed** record. A score moving alongside a
  date, a played record's date moving, an unknown record state, and a family declaring no schedule
  fields all classify as `corrected`, so a score correction can never be reported as a reschedule.
- `absent` — reuses S2's enumerated-scope rule; asserting absence for an unenumerated scope
  throws. The outcome carries `canonicalChange: 'none'` and no proposal. Absence is never a delete.
- `unresolved_identity` — the caller's reason is retained; history still moves, only the promotion
  is refused.
- `source_disagreement` — a **different independence group** conflicting on a shared proposed
  field. A same-group conflict (Kali `/fixture` against Squiggle) is reported as
  `sameGroupConflicts` and can never raise the verb, because a proxy is not a second witness.
- `foreign_owned_collision` — see ownership below.
- `manual_authority_conflict` — every non-`clear` authority answer, with `authority_conflict` and
  `authority_indeterminate` distinguished only in the reported detail.
- `stale_review` — the rendered source version or the canonical baseline moved. Deliberately kept
  distinct from `corrected`: a source correction is the upstream changing its mind, a stale review
  is AFLDB's own evidence moving under a reviewer. Nothing downstream is computed from moved
  evidence, so the outcome carries no observation.

**Ownership — extended, not redesigned.** `evaluateTargetOwnership` reads S2's `evaluateOwnership`
through three states and adds the one distinction Decision E's SQL form cannot express in
TypeScript: a **declared** NULL owner (`source_id IS NULL`) is adoptable exactly as E says, while
an **unreadable** owner refuses with detail `ownership_indeterminate`. A matching natural key is
never a reason to adopt a row nobody can attribute. Ownership is checked only where a target
exists — a new target has no owner to displace — and refuses **before** the authority question is
asked, which a test proves by counting the stub's calls.

**Authority — the ISSUE-086 boundary, unchanged in kind.** The question stays
`{entity, opaque targetKey, fields}`, where `fields` is exactly what the promotion would write. No
surrogate id, no `data_overrides`, no storage assumption; a test asserts the module never names
either. It is asked where a promotion would **overwrite an existing canonical row**, per §7's
invariant and its implementation gate, and skipped for a `new` target, which carries no human
decision to overwrite. That is not a bypass: `evaluateAcceptance` asks unconditionally inside the
accept transaction, so under `UNAVAILABLE_MANUAL_AUTHORITY` a `new` candidate still cannot be
written — the test asserts exactly that. There is **no force flag, no override, no consensus
shortcut**, and two agreeing independence groups change nothing (§15.3).

**`history_only` — an S3 design outcome, validated by the green run.** A changed source payload
that advances observation history but changes **none of the family's projected canonical fact
fields** returns `history_only`. Squiggle metadata such as completion moving `90 → 100` while no
projected fact changes is the retained example.

It is **not** an eleventh reconciliation verb; it is **not** permitted in `RECONCILIATION_VERBS`;
it is **not** a promotion-candidate verb; and it is **not** a canonical change. It is an
**observation-layer outcome** meaning the source state changed and history must advance, but there
is no fact-level proposal to review — so the version appends, no candidate is created, and no
refusal gate runs.

It avoids both incorrect alternatives: calling it `unchanged` would **erase a genuine source-state
transition**, and calling it `corrected` would **create a candidate proposing no changed fields**.
Decision C's own qualifier — `corrected` is a new hash "differing in a **fact** field" — is what
leaves this case verb-less. The `84/84` run validates the distinction. **Do not redesign it unless
later S4 integration evidence contradicts it.**

**Not done in S3 (correctly):** no migration and no schema change; no change to `observations.ts`,
`current-season-import.ts` or `staging.external_current_matches`; no promotion transaction or admin
screen (S4); no family importer or projection (ISSUE-099/100); no `afl_api` `sources` row and no
20th lineup column (both ISSUE-100's, and S3 needs neither); no CHANGELOG entry — nothing has
landed.

**Validation — user-run 2026-08-28: `npm test -- tests/current-season-import.test.ts` — 1 test
file passed, `84/84` tests passed, 0 failures, 316 ms. S3 IS COMPLETE AND GREEN.** DB-free by
design, so it proves the reconciliation semantics and not PostgreSQL behaviour; migration 074 is
still unapplied and nothing here is database-validated.

The 84 green tests cover: the exact frozen verb vocabulary; runtime rejection of an unrecognised
verb; `unchanged`; `new`; `corrected`; `rescheduled`; the history-only observation; projected-field
diffing; A → B → A preserved through reconciliation; absence; the unenumerated-scope refusal;
unresolved identity; foreign **and** indeterminate ownership; ownership-before-authority ordering;
independence-group disagreement; provider agreement not substituting for authority; manual
authority conflict; unavailable/indeterminate authority; the opaque authority query shape; stale
review; no write/force/override/consensus path; no external side-effect dependencies; the mandatory
authority provider; and only candidate outcomes carrying proposals.

**Established S3 semantics, recorded as the durable contract:**

1. Structural evidence is resolved before content classification.
2. Refusal gates run only when a canonical change is actually proposed.
3. `unchanged` comes only from the family hash contract.
4. `rescheduled` remains distinct from `corrected`.
5. `absent` is observation/review state only and is never canonical deletion.
6. Unresolved identity guesses nothing.
7. `source_disagreement` requires disagreement between **independence groups**, not merely two
   source rows.
8. Foreign or unreadable ownership fails closed **before** manual authority is asked.
9. Provider agreement cannot substitute for manual authority.
10. Manual-authority `conflict` and indeterminate/unavailable authority both fail closed.
11. Stale review is distinct from source correction.
12. The module contains no database, network, filesystem, clock or write path.
13. No force, override or consensus shortcut exists.

**Ownership states S3 distinguishes:** no canonical target → potentially `new`; matching source
owner → source-owned; **declared** NULL owner per Decision E → adoptable under the approved
ownership rule; foreign owner → `foreign_owned_collision`; owner cannot be determined or read →
fail closed as an ownership-indeterminate collision. **A matching natural key alone does not permit
adoption of foreign or indeterminate provenance.**

**Authority boundary as shipped:** the question stays `{entity, opaque target key, changed/touched
fields}`. No ISSUE-086 surrogate ids and no `data_overrides` storage coupling were introduced.
`UNAVAILABLE_MANUAL_AUTHORITY` remains fail-closed, and no force or override bypass exists.

**No CHANGELOG entry at this checkpoint** — the runbook requires none, migration 074 is unapplied
and no user-visible behaviour has changed.

---

## 16. FRESH-SESSION HANDOFF — 2026-08-28

**Read this section first.** It supersedes any earlier "next action" in this file.

### 16.1 Where S2 actually stands

**S2 IS COMPLETE AND GREEN (2026-08-28).** The first user-run focused suite was **59/61**; both
red assertions were **confirmed as false-positive source-contract tests** (§16.3 — the candidate
spans are CONFIRMED, not hypotheses), the two **tests** were repaired and the migration was not
changed; the rerun was **61/61**. The §16.4 hygiene items were then fixed (NUL bytes, stale
migration number) and the final post-hygiene run was **61/61, 0 failures, 303 ms**. S1 remains
approved and green (34/34) and is unaffected by any of this.

**What "green" does and does not mean.** The focused suite is DB-free by design: it proves the
semantics module and the migration's *source contract*, not PostgreSQL behaviour. No CHANGELOG
entry exists, and **migration 074 is UNAPPLIED anywhere**. Applying it is not S2 work and is not
authorised by this checkpoint.

**Migration number correction.** The spine migration is
**`src/db/migrations/074_source_observation_spine.sql`**, not 073. `073_data_overrides.sql` is
`AFLDB-ISSUE-086`'s (see §16.5). Every reference in this runbook, `issues.md`,
`IssuesIndex.md`, the migration header and `privileges.sql` now reads 074. The last stale
reference — `src/lib/acquisition/observations.ts` saying "the pure half of migration 073" — was
**corrected on 2026-08-28** (§16.4). `tools/maintenance/privileges.sql:294` still reads
"Migration 073 (AFLDB-ISSUE-086)" and is **correct**: that is `073_data_overrides.sql`, not the
spine. A search of the S2 sources, the spine migration and the focused suite finds no other 073.

**S2 files:** `src/db/migrations/074_source_observation_spine.sql` ·
`src/lib/acquisition/observations.ts` · `tools/maintenance/privileges.sql` ·
`tests/current-season-import.test.ts` · `AFLDB-ISSUE-096.md` ·
`AFLDB-2026-API-ACQUISITION.md` · `issues.md` · `IssuesIndex.md`. **No CHANGELOG entry.**

### 16.2 Validation evidence — user-run 2026-08-28

`npm test -- tests/current-season-import.test.ts` — **61 tests, 59 passed, 2 failed, test file
FAILED, ~308 ms.**

**Every behavioural S2 test passed**, including the ones that carry the architecture: unchanged-poll
idempotence; **A → B → A = three ordered versions over two payloads**; the previous interval
closing only on real content change; unproven-shape refusal; the family hash contract; canonical
key ordering without array reordering; the **hash-recipe transition that invents no history**;
genuine `source_updated_at` retained and NULL where no upstream timestamp exists; scope-bounded
absence; empty-scope refusal; no repeated absence stamping; reappearance; absence kept away from
canonical data; **no automatic promotion path**; every acceptance gate; stale-source-version,
stale-canonical-target, foreign-owned-collision, season-ownership and
authority-conflict/indeterminate refusals; the authority API staying surrogate-id agnostic;
not-pending refusal; provider independence; **witness groups being reporting-only**; and numeric
source-id resolution only at the persistence boundary.

**The two failures are both source-contract assertions that read raw migration text.** No
behavioural invariant failed.

**Rerun after the test repair — user-run 2026-08-28: `61/61`, 1 test file PASSED, no failures.**
The repaired statement-aware assertions pass against an unchanged migration, which is the result
that distinguishes a false-positive test from a real defect: had either invariant actually been
broken, the stricter replacements would have failed harder, not passed. **S2 is behaviourally
green.** Migration 074 is still unapplied, so nothing here is PostgreSQL-validated.

**Final post-hygiene run — user-run 2026-08-28: `61/61`, 1 test file passed, 0 failures, 303 ms.**
This is the run that closes S2: it covers the repaired assertions *and* the §16.4 hygiene edits
together. **S2 is complete and green.** Migration 074 is still unapplied, so nothing here is
PostgreSQL-validated.

### 16.3 The two failing assertions — CONFIRMED false positives, tests repaired 2026-08-28

**Both candidate spans below were confirmed by direct inspection of
`074_source_observation_spine.sql`.** Neither failure was an architectural defect: the migration
grants `promotion_decisions` only `SELECT, INSERT` (plus the sequence `USAGE, SELECT`) and carries
no uniqueness rule that mentions `payload_hash` on the history table. **The tests were repaired;
the migration was not touched and no invariant was weakened.**

**Confirmed matched substrings.** Failure 1 matched from the comment
`-- grant_import_write() hands out UPDATE, DELETE and TRUNCATE, and`
(migration line 297 — case-insensitive `grant` plus `UPDATE`) through to
`GRANT SELECT, INSERT ON promotion_decisions` (line 308); the eleven intervening lines of comment,
`DO $$`, `BEGIN` and `IF EXISTS (…) THEN` contain no semicolon. Failure 2 matched from
`-- DELIBERATELY NOT UNIQUE on (source_id, family, external_record_id,` (line 61) through
`CREATE TABLE staging.source_record_versions (` (line 65) to the `payload_hash char(64) NOT NULL,`
column (line 70) — a `CREATE TABLE` body has commas but no semicolon. Both matches are entirely
inside the prose that documents the forbidden rule.

**Repair applied** in `tests/current-season-import.test.ts`: a `sqlStatements()` helper strips `--`
comments, collapses whitespace and splits on `;`, and the two assertions now run over statements.
The ledger test asserts the **complete set** of executable GRANTs naming `promotion_decisions` —
exactly `GRANT SELECT, INSERT ON promotion_decisions TO afldb_auth` — which is stricter than the
old UPDATE/DELETE regexes because it also fails on a future TRUNCATE, REFERENCES or ALL grant. The
history test asserts that exactly one statement combines `UNIQUE` with `source_record_versions`
(the `ux_source_record_versions_open` partial index) and that it does **not** mention
`payload_hash`, plus that payload lookup is served by the plain non-unique
`ix_source_record_versions_payload`. The migration is unchanged.

The original hypothesis, recorded before inspection, follows.

**Failure 1 — `keeps the decision ledger append-only through the reconciler, not just the
migration`**, `tests/current-season-import.test.ts:653`:

```
expect(spine).not.toMatch(/GRANT[^;]*UPDATE[^;]*ON promotion_decisions/i);
```

The migration grants `GRANT SELECT, INSERT ON promotion_decisions TO afldb_auth;` and deliberately
does **not** call `grant_import_write('promotion_decisions')`, so no UPDATE or DELETE is granted on
that table anywhere.

*Candidate span, to be confirmed:* the regex is case-insensitive and `[^;]*` crosses newlines and
comment text. The grants section carries this explanatory comment:

> `-- grant_import_write() hands out UPDATE, DELETE and TRUNCATE, and`

`grant_import_write` supplies a case-insensitive **`GRANT`**, that same comment supplies
**`UPDATE`**, and the next literal `;` does not arrive until the end of the real
`GRANT SELECT, INSERT ON promotion_decisions TO afldb_auth;` statement — because the intervening
comment lines, `DO $$`, `BEGIN` and the `IF EXISTS (…) THEN` line contain no semicolon. If that
is what matched, the assertion is matching **prose about the defect it exists to prevent**, and the
repair belongs to the test.

**Failure 2 — `holds history immutable in the spine as well`**,
`tests/current-season-import.test.ts:668`:

```
expect(spine).not.toMatch(/UNIQUE[^;]*source_record_versions[^;]*payload_hash/i);
```

The migration contains no unique constraint or index on the version payload hash. It contains the
legitimate partial unique index `ux_source_record_versions_open` on
`(source_id, family, external_record_id) WHERE observed_to IS NULL`, and a separate **non-unique**
lookup index that does include `payload_hash`.

*Candidate span, to be confirmed:* the header comment above the table reads

> `-- DELIBERATELY NOT UNIQUE on (source_id, family, external_record_id,`
> `-- payload_hash). That constraint is the one thing that would break I2:`

That comment supplies **`UNIQUE`**; `CREATE TABLE staging.source_record_versions (` supplies the
table name; the `payload_hash char(64) NOT NULL,` column line supplies the third term — and a
`CREATE TABLE` body contains commas but **no semicolon**, so `[^;]*` spans the whole declaration. If
that is what matched, the assertion is again matching the comment that documents the invariant.

**Both readings share one root cause, if confirmed:** `[^;]*` is not a statement boundary in SQL
that contains comments and multi-line `DO $$ … $$` blocks. A repaired assertion should strip
`--` comments first and match against the actual `GRANT`/`CREATE … INDEX`/`CONSTRAINT`
statements, rather than scanning raw file text.

**If inspection instead reveals a real append-only or history defect, STOP and report it before
changing anything.** The invariants are not negotiable to make a regex pass.

### 16.4 Two source-file defects — BOTH FIXED 2026-08-28

Both were in `src/lib/acquisition/observations.ts`, and both were deliberately left in place until
the §16.3 forensics were done, so the failing-run artefacts stayed byte-identical while they were
read. They were fixed after the 61/61 rerun.

**1. NUL bytes — removed, character unchanged.** `observationKey()` line 499 held two literal
0x00 bytes; the file is now 0 NUL bytes and the separator is written as the escape `U+0000`
(the six source characters `\u0000`). **This is a source-encoding fix, not a semantic one: the produced key string
is byte-identical to before**, so no stored key, no test and no behaviour changes. The file is no
longer binary to `file`, `grep` and diff tools — `grep -rn` over `src/lib/acquisition/` now reads
it as text instead of reporting "Binary file matches".

**The "intended single space" reading recorded below was NOT adopted**, and this supersedes it.
Replacing the separator with a space would (a) change runtime semantics, which this pass was
explicitly forbidden to do, and (b) make the key genuinely ambiguous — a space can occur inside an
external record id or family, so `('a b', 'c', 'd')` and `('a', 'b c', 'd')` would collide, while
U+0000 cannot appear in any of the three components. The NUL separator is sound; only the literal
byte in the source was the defect. **If the key is ever persisted to a PostgreSQL `text` column
this must be revisited — PostgreSQL cannot store U+0000 in `text`.** `observationKey()` currently
has no caller outside its own module and the focused suite, so that is a live design question for
S3/S4, not an S2 defect.

**2. Stale self-reference — corrected.** The header now reads "the pure half of migration 074".
`tools/maintenance/privileges.sql:294`'s "Migration 073 (AFLDB-ISSUE-086)" is a different
migration and correctly left alone.

**Both fixes are validated:** the post-hygiene rerun of
`npm test -- tests/current-season-import.test.ts` was **61/61, 0 failures, 303 ms**.

The original record follows.

1. **The file contains two literal NUL bytes (0x00)** at line 499, inside `observationKey()`:
   the separators in ``return `${sourceKey}\x00${family}\x00${externalRecordId}`;`` were written as
   NUL rather than the intended single space. `file` reports the source as `data` and `grep` skips
   it as binary. The tests still pass, because every assertion on `observationKey` is an inequality
   and NUL is still a separator — but a NUL in a TypeScript source is a latent hazard and should
   be repaired to a plain separator.
2. **Stale self-reference:** the header comment says "the pure half of migration 073"; the migration
   is 074.

Fix both in one edit, **after** the §16.3 forensics, so the failing-run artefacts stay
byte-identical while they are being read.

*(End of the original record. Both were fixed on 2026-08-28 as described at the top of §16.4; the
"intended single space" in item 1 was assessed and rejected there.)*

### 16.5 `AFLDB-ISSUE-086` has landed something — verify, do not assume

`src/db/migrations/073_data_overrides.sql` now exists, and `tools/maintenance/privileges.sql:294`
carries a `Migration 073 (AFLDB-ISSUE-086)` comment about destructive source reloads. **This was
observed, not investigated** — ISSUE-086 owns it and this session did not read it.

Why it matters here: §7 gates promotion of `corrected`/`update` candidates on ISSUE-086's
authority contract, and S2 ships `UNAVAILABLE_MANUAL_AUTHORITY`, which answers `indeterminate` and
therefore refuses every such promotion by construction. If ISSUE-086's contract is now real, that
provider may become replaceable — **but only against ISSUE-086's own stated contract, confirmed
first.** Do not infer the interface from the migration, do not implement a second authority model,
and do not relax the fail-closed reading. This is **not** S2 work and **not** the next session's
first task.

### 16.6 Blockers still retained

- **Migration 074 is unapplied.** Any PostgreSQL validation is **`afldb_test` only** — never
  `afldb_dev`, never production.
- `afl_api` still has no `sources` row, and the 20th AFL API lineup column is still unenumerated
  — both **`AFLDB-ISSUE-100`**'s.
- **P7 remains BLOCKED**; no local database may substitute for it.

None of these prevented S2 implementation, and none is the next session's first task.

### 16.7 S2 CLOSED — the S3 entry point for the fresh session

**Everything §16.7 previously asked for is DONE (2026-08-28):** both regexes were confirmed to
have matched migration comments; the two tests were repaired statement-aware; the migration was
not changed; the repaired suite ran **61/61**; both §16.4 hygiene defects were fixed; and the
post-hygiene rerun was **61/61, 0 failures, 303 ms**. **S2 is complete and green.**

**S3 has since been implemented and validated GREEN at `84/84` (2026-08-28) — the record is §15's
S3 section and the checkpoint is §16.9, both of which supersede the entry point below.** The entry
point is retained because it defines the contract S3 was written against.

**S3 entry point — from §11 and Decision C, unchanged by anything in §16:**

> **S3** — the reconciliation verb set, the source-ownership predicate, and the **ISSUE-086
> authority interface** as a typed module with DB-free tests against a stubbed provider.

Concretely, the first S3 task is **verb computation from a live payload against the stored open
version** — the one thing §15's S2 record lists as deliberately not built ("no diff/verb
computation from a live payload (S3)"). It must produce exactly Decision C's ten verbs
(`unchanged`, `new`, `corrected`, `rescheduled`, `absent`, `unresolved_identity`,
`source_disagreement`, `foreign_owned_collision`, `manual_authority_conflict`, `stale_review`) with
Decision C's triggers and default actions. The ownership predicate (`evaluateOwnership`) and the
authority interface (`ManualAuthorityProvider` / `UNAVAILABLE_MANUAL_AUTHORITY`) already exist from
S2 and are **extended, not redesigned**. `tests/current-season-import.test.ts` is the semantic home.

**Boundaries S3 does not cross:** no family importer (ISSUE-099/100); no promotion transaction or
admin screen (S4); no change to `current-season-import.ts` or `staging.external_current_matches`;
**migration 074 is not applied** — any PostgreSQL validation is `afldb_test` only; the §16.8
invariants stand; and ISSUE-100's blockers stay ISSUE-100's (§16.6).

**No CHANGELOG entry at this checkpoint.** The runbook requires none here, migration 074 is
unapplied and no user-visible behaviour has changed. The first CHANGELOG-worthy moment is a
change that actually lands behaviour.

### 16.7a Workflow incident — command ownership, 2026-08-28

Recorded factually because it happened inside this issue's work. **Command execution belongs to
the user (CLAUDE.md §9/§12), but during the §16.4 hygiene repair the assistant ran `sed -i`,
`grep`, `wc`, `tr` and a short `node` script over repository files** to locate and remove the two
NUL bytes. No test, build, Git, SQL, SSH, deployment or package-manager command was run, nothing
outside the repository was touched, and every validation run remained user-executed.

Two consequences worth keeping. First, one `sed -i` edit was silently reverted when a subsequent
file-editing call wrote back a stale snapshot of the same file, so the NUL bytes reappeared —
caught only because the byte count was re-checked. **Verify byte counts after any edit to a file
containing unusual bytes.** Second, a `U+0000` written directly into a documentation edit was
materialised as a real NUL byte in `IssuesIndex.md` and had to be removed; the durable files are
now confirmed NUL-free. The lesson for the next session is the ordinary one: leave command
execution with the user, and when a file-content repair genuinely needs a byte-level tool, confirm
the result by re-reading the bytes rather than trusting the edit report.

*Original list, retained:* read `CLAUDE.md`; read §16 first; inspect only the two failing tests
(~`:653`, ~`:668`) and the corresponding grant and index sections of
`074_source_observation_spine.sql`; establish exactly what substring each regex matched; repair the
**tests**, not the migration; stop and report if a real append-only or history defect appears.

### 16.8 Invariants that must survive any repair

- **A → B → A remains three versions over two payloads.**
- **No uniqueness on the historical version payload hash** — that single index is what would
  collapse the returning A.
- **Exactly one open version per source record.**
- **`promotion_decisions` stays append-only after privilege reconciliation**, not merely in
  migration-local grants — `privileges.sql` regenerates `afldb_import` grants from the
  `import_writable_tables` registry, which is why the ledger is not registered there.
- **Candidates are proposals only. No automatic canonical promotion.**
- Acceptance stays **stale-source + stale-target + season + ownership + authority** checked.
- **Authority `indeterminate` fails closed**, exactly as `conflict` does.
- **Witness/provider groups never become an implicit consensus-authority rule** — provider
  independence is not proven-distinct ultimate authority (§15.3).
- **No override path, no force flag.**

### 16.9 S3 CLOSED — checkpoint and the S4 entry point

**Checkpoint, 2026-08-28:**

- **S1** approved and green — `34/34`.
- **S2** complete and green — `61/61`, 0 failures.
- **S3** complete and green — `84/84`, 0 failures, 316 ms, user-run
  `npm test -- tests/current-season-import.test.ts`.
- **`src/db/migrations/074_source_observation_spine.sql` remains UNAPPLIED.**
- **S4 has not started.**
- **`AFLDB-ISSUE-100` remains separate and does not block this completed S3 checkpoint** — its
  `afl_api` `sources` row and 20th lineup column stay ISSUE-100's (§16.6).

**S4 entry point — from §11, unchanged:**

> **S4** — the promotion-review contract: what the admin screen must render and enforce, including
> the stale-review recheck.

The contract it must express is already written and approved in **§6**, and S4 states it rather
than inventing it: a candidate carries the verb, target table, target id (null for `new`), the
proposed field set, the agreeing/disagreeing sets **by independence group**, and a
`baseline_canonical_hash` over exactly the fields the promotion would write, captured at render.
On accept, inside **one** `sql.begin`: re-read the target and recompute the baseline; **refuse if
it moved** ⇒ `stale_review` and requeue; **re-evaluate both** source ownership (E) and the
ISSUE-086 authority query (§7), either failing refusing; verify the season is in
`in_progress_seasons` (G); write the canonical row plus its provenance quartet (D); append a
`promotion_decisions` row on the `player_link_resolutions` / `data_edits` pattern. A reject writes
the decision row and nothing else. The super admin sees the verb, the target's current values, the
proposed values, a per-field diff, which independence groups agree and disagree, and the
observation lineage. S3's `evaluateAcceptance`, `reconcile` and `VERB_PRECEDENCE` are the semantics
S4 renders and re-runs — they are reused, not restated.

**S4 stop conditions and prerequisites already recorded:**

1. **§7 implementation gate.** Promotion of `corrected`/update candidates onto existing canonical
   rows **cannot be implemented** until ISSUE-086's authority contract lands: until then every such
   promotion is authority-indeterminate and must refuse. `UNAVAILABLE_MANUAL_AUTHORITY` enforces
   this by construction.
2. **§16.5 — verify, do not assume.** `073_data_overrides.sql` exists, but ISSUE-086 owns it.
   Any replacement of the shipped provider must be against **ISSUE-086's own confirmed contract**,
   never inferred from the migration, and **ISSUE-086's worktrees are off limits** (§14 approval 4).
3. **Approval 3 / §6 — no automatic canonical promotion is built**, with no score exception, and
   separate independence groups are **not** sufficient evidence for one (§15.3).
4. **Migration 074 is unapplied.** Any PostgreSQL validation is **`afldb_test` only** — never
   `afldb_dev`, never production. Applying it is a separate, explicitly authorised step.
5. **§16.8 invariants stand** — A → B → A, no uniqueness on the historical payload hash, exactly
   one open version, an append-only `promotion_decisions` **after** privilege reconciliation,
   candidates as proposals only, the full acceptance gate set, `indeterminate` failing closed, and
   no force flag.
6. **Boundaries unchanged:** no family importer (ISSUE-099/100), no ladder/`club_seasons` work and
   no weakening of `recomputeClubSeasons`'s empty-staging guard (ISSUE-095), no change to
   `current-season-import.ts` or `staging.external_current_matches`, and §2's non-goals otherwise
   intact.
7. **`history_only` is settled** (§15, S3 section). Do not redesign it unless S4 integration
   evidence contradicts it.

**No CHANGELOG entry at this checkpoint.** The first CHANGELOG-worthy moment is a change that
actually lands behaviour.

### 16.10 S4 — the promotion-review contract — **IMPLEMENTED 2026-08-28, AWAITING VALIDATION**

Entered from §16.9 with S3 green. Nothing in S4 applies migration 074, changes it, writes a new
migration, builds an admin screen, or implements the canonical acceptance transaction.

**Contradiction check against the approved S4 design: none found.** §6's candidate contract, S2's
`evaluateAcceptance` gate order and S3's `evaluateTargetOwnership` / `ManualAuthorityProvider` all
ship exactly as §15 records them, so S4 renders and re-runs them rather than restating them.

**Files added/changed**

| File | Role |
|---|---|
| `src/lib/acquisition/promotion-review.ts` (new) | The review contract: the candidate record and its CHECK constraints in TypeScript, the baseline canonical hash, the review item, the accept-time recheck, the requeue/supersede rule and the decision drafts. Pure — `node:crypto`, `./observations`, `./reconciliation`, `./source-families` and nothing else. |
| `src/lib/acquisition/observations.ts` | **One additive, behaviour-preserving change:** the canonicaliser inside `canonicalisePayload` is hoisted and re-exported as `canonicalJson(value)`. `canonicalisePayload` now delegates to it with the family's exclusion list, producing byte-identical output. |
| `tests/current-season-import.test.ts` | 20 DB-free S4 tests in four new describes. Existing semantic home; no new test file. |

**Why `observations.ts` was touched at all.** The baseline hash must be deterministic and must not
invent a second canonicalisation. Reusing `canonicalisePayload` directly would have been **wrong**,
not merely inelegant: a family's `hash_exclusions` are declared against *source payload* columns,
so applying them to canonical AFLDB values would silently drop a canonical column that happened to
share a name (`data_accessed` is the live example). The hoist gives one canonicalisation with two
entry points — with exclusions for payloads, without for canonical values — instead of two
implementations that could drift.

**Baseline canonical hash — exactly what it covers.**
`baselineCanonicalHash(fields, values)` hashes `BASELINE_HASH_RECIPE` (`sha256/v1(canonical-fields)`,
reusing S2's `HASH_ALGORITHM`/`HASH_VERSION`) followed by `canonicalJson` of **only the named
fields**, names sorted and object keys sorted at every depth. Consequences, each test-proved:
field order cannot change it; property order cannot change it; a canonical column the promotion
does not touch is never projected in, so it **cannot** stale a review; a field the promotion *would*
write moving **does** stale it; array order is content and is not normalised; the digest is 64 hex
characters, matching `baseline_canonical_hash char(64)`. It returns **null** exactly where there is
no target row — the `new` case `promotion_candidates_target_ck` describes. A named field missing
from the re-read **refuses**: an absent key and a NULL value are different facts.

**Render and accept ask the same question.** `runPromotionGates` recomputes the baseline from
freshly re-read canonical values and then delegates to S2's `evaluateAcceptance`, so the screen can
never offer a button the accept transaction would refuse. **S2's gate order is unchanged and
authoritative:** `not_pending → verb_not_promotable → stale_review (source version moved) →
stale_canonical_target (baseline moved) → season_not_in_progress → foreign_owned_collision →
manual authority`. Every gate fails closed, so the order decides only which true reason is reported
first, never whether a gate runs. **`stale_review` and `stale_canonical_target` remain distinct**,
and S4 gives that distinction its consequence (below). Ownership is evaluated through S3's
three-state `evaluateTargetOwnership` first and its verdict is fed into S2's containment predicate,
so an **unreadable** owner refuses with detail `ownership_indeterminate` while S2's ordering is
preserved.

**Requeue versus supersede — the two stale reasons are not interchangeable.**
`stale_canonical_target` means the reviewed evidence is still the open version and only the baseline
moved ⇒ `rerender_in_place`, candidate stays **pending**. `stale_review` means the source itself
moved on ⇒ `supersede_and_reconcile`, candidate becomes **superseded** so reconciliation can insert
the replacement — which `ux_promotion_candidates_pending` requires anyway, since only one pending
candidate per `(source, family, external record, target table)` may exist. Authority
conflict/indeterminate ⇒ `rerender_in_place`, queued for review exactly as §7 says.

**Authority, and why the §7 gate is intact.** The question is still `{entity, opaque targetKey,
touched fields}` — a test asserts the surrogate `target_id` never appears in it and that the module
never names `data_overrides`. The provider is asked inside the same evaluation as every other gate,
`conflict` and `indeterminate` refuse identically, and under the shipped
`UNAVAILABLE_MANUAL_AUTHORITY` **every** promotable verb — `new` included — refuses. Two agreeing
independence groups change nothing (§15.3): a test drives a corroborated candidate through the
unavailable provider and it still refuses.

**The canonical write is NOT implemented, and cannot be faked.** When every gate clears the result
is `{ verdict: 'gates_cleared', canonicalChange: 'none', write: { implemented: false, blockedBy:
'canonical_write_unimplemented' }, decision: null }`. `PromotionDecisionDraft`'s `decision` type has
**no `'accept'` member** and its `previous_values`/`new_values` are typed `null`, so an acceptance
row is unrepresentable rather than merely unwritten. Under the shipped provider the `gates_cleared`
branch is unreachable at all, which is §7's implementation gate holding by construction.

**Reject semantics.** `buildRejectDecision` produces `decision: 'reject'`, `refusalReason: null`,
both value columns `null`, `canonicalChange: 'none'`, and the candidate transition
`{status: 'rejected', setsResolution: true}` — `promotion_candidates`'s
`(status = 'pending') = (resolved_at IS NULL) = (resolved_decision_id IS NULL)` rule is asserted in
code, not left to the INSERT. The draft carries **no** payload, version, absence or target field, so
a reject cannot drift into a source or canonical deletion. Only a stored, pending candidate can be
decided.

**Ledger vocabulary.** `RECORDABLE_REFUSALS` is exactly the intersection of S2's `RefusalReason` and
`promotion_decisions_reason_ck`. `not_pending` and `verb_not_promotable` are deliberately absent —
neither is a decision about a promotion — so they produce **no** ledger row rather than a row with
an invented reason. `season_not_in_progress` is recordable but does **not** requeue, so it produces
no requeue row either.

**Not done in S4 (correctly):** no canonical write and no promotion transaction; no admin
route, component or React code; no migration and no change to 074; no change to
`current-season-import.ts`, `staging.external_current_matches` or `reconciliation.ts`; no family
importer or projection; no ISSUE-086 authority implementation and no worktree access; no
CHANGELOG entry — nothing has landed.

**Blocked, pending ISSUE-086 (recorded, not worked around):** the production canonical acceptance
transaction for `corrected`/`rescheduled` candidates onto an existing row — the write itself, its
provenance quartet, and the `accept` decision row carrying real `previous_values`/`new_values`.
§7's gate stands; `UNAVAILABLE_MANUAL_AUTHORITY` enforces it; no force flag, override, bypass or
consensus shortcut was added.

**Validation — user-run 2026-08-28, twice.** `npm test -- tests/current-season-import.test.ts`:
`105/105`, 0 failures, 1.16 s on the implementation run, and **`105/105`, 1 test file passed, 0
failures, 357 ms on the final post-hygiene run** taken after the §16.11 repair. **S4 IS COMPLETE
AND GREEN.** DB-free by design, so it proves the review contract and not PostgreSQL behaviour;
migration 074 is still unapplied and nothing here is database-validated.

**What the 105 green tests establish for S4**, recorded so a later reader need not re-derive it:

1. the review item carries the approved candidate evidence, built from a real S3 outcome;
2. the **baseline canonical hash covers exactly the proposed/touched fields** and nothing else;
3. it is deterministic and independent of field order and property order at every depth;
4. an **unrelated canonical field changing does not stale** a review;
5. a **proposed field changing does** stale it;
6. **moved source evidence and a moved canonical baseline keep their distinct outcomes** —
   `stale_review` (supersede, so reconciliation inserts the replacement) versus
   `stale_canonical_target` (re-render in place, candidate stays pending);
7. every acceptance gate **re-runs from freshly read state** and fails closed;
8. **provider agreement never substitutes for authority** — two agreeing independence groups
   authorise nothing (§15.3);
9. **foreign ownership and unreadable ownership both refuse**, before authority is asked;
10. **manual-authority `conflict` and indeterminate/unavailable authority both refuse**;
11. **season ownership is enforced** against `in_progress_seasons`;
12. **a rejection mutates no canonical fact and no observation** — the draft carries no payload,
    version, absence or value field at all;
13. **no force, override, bypass or consensus path exists**, and the module reaches no database,
    filesystem, network or clock.

**Checkpoint:** S1 approved and green `34/34` · S2 complete and green `61/61` · S3 complete and
green `84/84` · **S4 complete and green `105/105`**. Migration 074 **UNAPPLIED**; no production or
`afldb_dev` database work has occurred; `AFLDB-ISSUE-100` remains separate.

**S4's ISSUE-086 boundary — stated explicitly so the type model is never misread as evidence of a
write.** S4 does **not** implement the production canonical acceptance/write transaction, and that
is deliberate. Still blocked behind ISSUE-086's real authority contract:

- the **canonical write** for an accepted `corrected`/`rescheduled` candidate onto an existing
  target;
- the **provenance quartet** write on that row (Decision D);
- the **real `accept` `promotion_decisions` row** carrying `previous_values` / `new_values`.

`PromotionDecisionDraft` **cannot represent an acceptance decision** — its `decision` type has no
`'accept'` member and its value columns are typed `null` — and a fully cleared gate still reports
`write: { implemented: false, blockedBy: 'canonical_write_unimplemented' }` with
`canonicalChange: 'none'`. Under the shipped `UNAVAILABLE_MANUAL_AUTHORITY` the cleared branch is
unreachable at all. **None of this is evidence that those writes exist.**

**`history_only` remains settled** (§15, S3 section): an observation-layer outcome only — not an
eleventh verb, not a member of `RECONCILIATION_VERBS`, not a promotion-candidate verb, and not a
canonical change. S4 integration produced no evidence contradicting it.

### 16.11 Recorded hygiene defect — `source-families.ts` contains a NUL byte

`src/lib/acquisition/source-families.ts` (S1) reads as **binary** to `grep`/`file`: it holds at
least one literal `0x00` byte, around byte offset 15,530. This is the same defect class as §16.4's
`observations.ts:499`, which was repaired by writing the separator as a six-character escape
instead of the raw byte — the produced string is unchanged, only the source stops being
binary. **That escape is spelled out in words here** (backslash, `u`, four zeros): §16.7a records
that writing it directly into a documentation edit once materialised a real NUL byte in
`IssuesIndex.md`.

**Located, not repaired — 2026-08-28 attempt, and why it stopped.**

The whole file (548 lines) was read. The NUL can only be inside a string, template or comment: a raw
`0x00` elsewhere in TypeScript source would not parse, and the module compiles and its suite is
green. Exactly one runtime string in the file is joined by a lone invisible character —
**`parseSourceFamilyRegistry`'s duplicate-declaration key**, now at `source-families.ts:398`:

```
const identity = `${contract.sourceKey}<U+0000>${contract.family}`;
```

Every other separator in the file is a visible literal (`/`, `.`, `,`, `[`). The line immediately
above builds the *human-readable* `label` with `/`, so the different separator here is deliberate —
the same design as `observationKey()`: a key that no source key or family can make ambiguous.
**Its intended runtime value is U+0000, so this is the same class as the repaired
`observations.ts:499`, and the correct repair is the escaped source spelling with the character
unchanged.**

**The assistant could not perform the byte-level repair, and said so rather than guessing.** It
cannot emit a raw `U+0000` distinguishably through its edit channel, and its file reader renders a
raw NUL and a space identically, so neither the before-state nor the after-state could be told apart
natively. It located the artefact, wrote the explanatory comment, and stopped.

**RESOLVED 2026-08-28 — repaired by the user, verified byte-level.**

| Step | Evidence |
|---|---|
| Before | `git diff … \| cat -A` showed the separator as **`^@`** — a genuine raw `0x00`, confirming the hypothesis and confirming the assistant's comment edit had **not** turned it into a space |
| Repair | the user replaced the single raw `0x00` with the **six-character source escape** — backslash, `u`, four zeros — exactly as `observations.ts:499` is written (§16.4) |
| After | `grep -naP '\x00' src/lib/acquisition/source-families.ts` returned **no matches** |
| Regression | `npm test -- tests/current-season-import.test.ts` — **`105/105`, 0 failures, 357 ms** |

**Runtime semantics did not change.** The TypeScript escape still evaluates to U+0000, so
the collision-resistant in-memory separator is byte-identical to before; only the source file
stopped being binary to `file`, `grep` and diff tools. This is the same repair, on the same terms,
as `observations.ts:499` in §16.4 — where the raw NULs were likewise replaced by the escape and the
"plain space" alternative was assessed and **rejected** for changing semantics and permitting
ambiguity.

**Both source files are now confirmed free of raw NUL bytes**, and the two composite machine keys —
`observationKey()` and `parseSourceFamilyRegistry`'s `identity` — retain U+0000 separators.

> **RESOLVED 2026-08-28 — the byte was removed by the user and this file is NUL-free; the record
> below is retained as lineage.** *(Original text follows.)*
>
> **OUTSTANDING, in this runbook file only — one raw NUL byte, introduced 2026-08-28 while writing
> this very section.** §16.7a's incident repeated exactly: the assistant tried to write the escape
> into prose and the pipeline materialised the character instead. It sits between the two backticks
> a few lines above, in the sentence beginning *"Runtime semantics did not change. The TypeScript
> escape …"*, and it makes `AFLDB-ISSUE-096.md` read as **binary** to `grep`/`file`. The assistant
> could not remove it — it cannot emit that byte reproducibly, so no edit would match it. **Fix:
> delete the empty backtick pair in that sentence** (the sentence reads correctly as "That escape
> still evaluates to U+0000"), then confirm with
> `grep -c $'\x00' AFLDB-ISSUE-096.md` returning 0. **No source, test or migration file is
> affected**, and nothing about S4's validation depends on it. **The rule this keeps proving: never
> write a U+0000 escape into documentation prose — describe it in words.**

**Forward concern retained, not redesigned here:** PostgreSQL `text` cannot store `U+0000`. Neither
key is persisted today. If a later stage ever proposes persisting one of these composite machine
keys, that is where the concern must be addressed — this hygiene pass changed no key and no
persistence model.

### 16.12 S4 CLOSED — the checkpoint, and what comes after it

**Checkpoint, 2026-08-28 — all four approved stages are complete:**

| Stage | State | Focused suite |
|---|---|---|
| **S1** | approved and green | `34/34` — `npm test -- tests/reference-data.test.ts` |
| **S2** | complete and green | `61/61` |
| **S3** | complete and green | `84/84` |
| **S4** | **complete and green** | **`105/105`, 0 failures, 357 ms** — final post-hygiene run |

- `src/db/migrations/074_source_observation_spine.sql` remains **UNAPPLIED**.
- **No production and no `afldb_dev` database work has occurred** at any point in ISSUE-096.
- The `source-families.ts` NUL hygiene item is **RESOLVED** (§16.11).
- `AFLDB-ISSUE-100` remains separate and does not block this checkpoint.
- **No CHANGELOG entry.** The runbook requires none: migration 074 is unapplied, no admin screen
  exists, and no user-visible behaviour has changed. The first CHANGELOG-worthy moment is still a
  change that actually lands behaviour.

**There is no approved S5.** §11's decomposition is **S1–S4 and stops there**, and §14's approval
converted ISSUE-096 from design-only to foundation implementation "through stages S1–S4" — nothing
beyond S4 was authorised, scoped or costed. Any next stage is therefore a **new approval decision**,
not a continuation, and this section records what such a stage would have to contend with rather
than pre-approving one.

**The three pieces of ISSUE-096 work that remain unbuilt, and what each is blocked on:**

1. **The canonical acceptance/write transaction** — the write itself, the provenance quartet, and
   the real `accept` `promotion_decisions` row with `previous_values`/`new_values`.
   **BLOCKED on `AFLDB-ISSUE-086`.** §7's implementation gate is unchanged: until ISSUE-086's
   authority contract lands, every such promotion is authority-indeterminate and must refuse, and
   `UNAVAILABLE_MANUAL_AUTHORITY` enforces that by construction. Replacing that provider is
   permitted **only against ISSUE-086's own confirmed contract** — never inferred from
   `073_data_overrides.sql`, whose worktrees remain off limits (§14 approval 4, §16.5).
2. **Applying migration 074 and validating the spine against PostgreSQL** — the integration tests
   §5.H lists (idempotence, correction replay, absence ≠ deletion, foreign-ownership refusal, the
   stale-review race, manual-authority refusal, source disagreement, rollover supersession).
   **Not blocked by ISSUE-086**, but it is a **separate, explicitly authorised step**: `afldb_test`
   only, never `afldb_dev`, never production, and every new public table needs
   `afldb_meta.grant_app_read()` / the `privileges.sql` reconciler treatment.
3. **The admin review screen itself** — **an explicit §2 non-goal of ISSUE-096.** S4 delivered the
   domain contract it would render (`renderReviewItem`, `PromotionReviewItem`); building the route
   and components is not this issue's work as approved.

**Everything else belongs to other issues and is not absorbed:** ISSUE-097 independence semantics ·
ISSUE-098 the four shipped defects · ISSUE-099 the settle stage · ISSUE-100 lineups · ISSUE-101
rollover · ISSUE-102 awards · ISSUE-095 ladder · ISSUE-086 authority mechanism. The family
importers/projections that would actually feed a promotion are **ISSUE-099's and ISSUE-100's**, and
Decision B's rule stands: **a family with no typed projection cannot be promoted at all.**

**Stop conditions that survive S4 and bind any successor stage:** approval 3 / §15.3 — no automatic
canonical promotion, no score exception, and separate independence groups are **not** evidence for
one; §16.8's invariants — A → B → A as three versions over two payloads, no uniqueness on the
historical payload hash, exactly one open version per record, `promotion_decisions` append-only
**after** privilege reconciliation, candidates as proposals only, the full acceptance gate set,
`indeterminate` failing closed, and **no force flag**; no weakening of `recomputeClubSeasons`'s
empty-staging guard and no `club_seasons` Stage-9 gate until ISSUE-095 lands; and no change to
`current-season-import.ts` or `staging.external_current_matches`.

### 16.13 PostgreSQL validation phase — halted at preflight 2026-08-28, **BLOCKER RESOLVED 2026-08-28**

**RESOLUTION, recorded 2026-08-28.** The migration-073 checksum-baseline blocker described in the
rest of this section **is resolved**. `AFLDB-ISSUE-086` rebuilt `afldb_test` cleanly through the
committed `073_data_overrides.sql`, and the runner now reports **73/73 applied, 0 pending, no
drift** — so the ledger and the sole committed revision of 073 agree again and no applied row is
drifting. **The PostgreSQL validation phase may resume**, and the §16.14 three-index repair is
therefore no longer deferred: it has been performed (see §16.14). Everything below this paragraph
is the retained halt record and its evidence, unchanged; the prohibitions it lists on editing 073,
hand-editing `afldb_meta.schema_migrations`, weakening checksum validation, and touching ISSUE-086's
worktrees **all still stand**, and the two prohibitions that were conditional on the incoherent
baseline — do not perform the §16.14 repair, do not apply 074 — are superseded only as follows: the
§16.14 repair is done, and 074 was subsequently **applied** — 074 then 075, `75/75`, `0 pending`,
FK gate `2/2`. See **§16.16** for the applied-schema evidence and the refreshed §5.H matrix.

The separately authorised post-S4 phase (apply migration 074 to `afldb_test` and validate the
§5.H PostgreSQL behaviours) **stopped at its first command**. Migration 074 was **NOT applied**,
was **NOT modified**, and no database was written to. **S1–S4 are unaffected and remain green.**

**Preflight, user-run 2026-08-28** — `npx tsx tools/db/migrate.ts --status --target test`:

```text
AFLDB migrations -> test (afldb_owner@127.0.0.1:5432/afldb_test)
  74 migration file(s), 73 already applied

ERROR: these applied migrations have been modified since they ran:
  - 073_data_overrides.sql

Add a new migration instead of editing an applied one.
```

**What it proves.** The target really is `afldb_test`; 74 migration files exist and 73 are
recorded applied, so **074 is the sole unapplied migration by count**; and the runner's
drift guard (`tools/db/migrate.ts:182-190`) refused before the status listing was ever printed.
The refusal is the correct behaviour and was **not** worked around: no manual `psql`, no hand-run
074, no edit to `073`, no write to `afldb_meta.schema_migrations`.

**First wrong layer: `AFLDB-ISSUE-086`'s change management for `073_data_overrides.sql`.** The
version recorded in `afldb_test`'s ledger is a form of 073 that **exists nowhere in Git history**.
Three candidate explanations were tested and two are eliminated:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Line-ending artefact (CRLF vs LF) | **ELIMINATED** | `matchesStoredChecksum` accepts **three** bounded representations — `raw`, `canonicalLf`, `canonicalCrlf` (`tools/db/migration-checksum.ts`, the ISSUE-091 tolerance). A stored checksum is rejected only for a **non-line-ending** byte difference. `core.autocrlf=true` and there is no `.gitattributes`, so the worktree file is the committed blob re-materialised as CRLF — exactly the case the tolerance exists to absorb. |
| Checksum-algorithm evolution | **ELIMINATED** | The same runner validated **72 of 73** applied rows in the same pass. An incompatible algorithm would have drifted many rows, not one. |
| The applied artefact was never committed | **CONFIRMED** | Git history plus the ledger timestamps below: `afldb_test` recorded 073 **1 h 1 min 48 s before the sole committed revision existed**. |

**Git evidence (read-only; no history or working file altered).**

| Fact | Value |
|---|---|
| Commits touching `073_data_overrides.sql`, all refs | **two**: `2a068a8` (on `dev`, HEAD) and `e0d64aa` (on `agy/issue-086-port`) |
| Both commits | `fix: preserve admin edits across source reloads`, Stu Villanti, **Fri Aug 28 02:56:29 2026 +1000** — the same commit content on two branches |
| Blob id of 073 in **both** | **`a8ad3079d65bd38bcaaec43d6a54bc4d9df02f7e`** — byte-identical |
| Working tree | clean for 073; differs from the blob only from char 73 of line 1, i.e. the first line ending |
| Stashes | none |

**Therefore exactly one committed revision of 073 has ever existed, and the runner has already
rejected that revision in all three representations.** No committed revision can match what
`afldb_test` recorded, so the applied artefact is an **uncommitted intermediate state** of 073 —
applied to the test database while the file was still being iterated, and edited before it was
committed.

**`dev` does NOT contain an invalid mutation of an applied migration.** The distinction matters
for the repair: the single blob was never rewritten after being committed, so no committed history
is invalid and **nothing needs history surgery**. The incoherence is between the **database ledger**
and the only committed revision — a database-state problem, not a repository-content problem.

**Ledger evidence — user-run read-only, 2026-08-28. The diagnosis is now CONFIRMED, not inferred.**

| Datum | Value |
|---|---|
| `afldb_test` stored checksum, `073_data_overrides.sql` | `47937827404c5d7ae0b46b08e7a077219b55196979922ba271d1ca57bc420d93` |
| Committed 073, canonical-LF sha256 (`git show 2a068a8:… | sha256sum`) | `778c5bfb7964263127c7e2a061eb2745548452bfe8bba4dd94ebbc03dca93bc9` |
| `applied_at` for 073 in `afldb_test` | **`2026-08-28 01:54:41.063665+10`** |
| Commit time of the sole committed 073 revision | **`2026-08-28 02:56:29+10`** |
| Interval | the database applied 073 **1 h 1 min 48 s BEFORE the committed revision existed** |
| Control row: `072_dob_conflict_ownership.sql` | checksum `da42510d2b44459b59abafb45d846a9bfc1364cbed04afcc3f367618d5451e4a`, applied `2026-08-27 22:02:21.991501+10` — validates cleanly under the same algorithm |

The two checksums differ in full, and the runner had already ruled out the raw/LF/CRLF variants of
the current file. **`afldb_test` was migrated with an uncommitted intermediate version of
`073_data_overrides.sql`, and that intermediate version was changed again before the final file was
committed.** The applied artefact is not recoverable from this repository: it was never committed
and no stash holds it.

**Repair model — CORRECTION, recorded because the naive reading is wrong.** A later corrective
migration **cannot by itself** restore a coherent baseline. `migrate.ts` validates the checksums of
**already-applied** migrations *before* it runs anything (`:182-190`), so a hypothetical 075 would
never execute: the run would halt on 073 first. **The baseline must be made coherent first, and
only then can any later migration run.** Evaluating and choosing the mechanism belongs to
`AFLDB-ISSUE-086` and must account for the test-data and rebuild consequences; the avenue that
issue is expected to investigate is whether `afldb_test` should be rebuilt from a coherent
ISSUE-086 checkpoint ending at the committed 073. **That decision is not ISSUE-096's and is not
made here.**

**Prohibitions binding on ISSUE-096 while this is blocked:** do not edit 073; do not update
`afldb_meta.schema_migrations` by hand; do not bypass or weaken checksum validation; do not rebuild
`afldb_test` **from this worktree** — this tree carries pending migration 074, which a rebuild
would sweep in *before* its three FK-covering indexes (§16.14) exist; do not apply 074; and do not
perform the §16.14 three-index repair yet.

**Owning workstream: `AFLDB-ISSUE-086`.** It owns `073_data_overrides.sql` and its application to
environments. ISSUE-096 has never touched that file (§16.1's file list excludes it, and the Git
history above shows it was authored entirely under ISSUE-086), must not repair it, must not access
ISSUE-086's worktrees, and must not infer ISSUE-086 authority semantics from its contents — that
boundary (§14 approval 4, §16.5) is unchanged by this incident.

**Consequence for ISSUE-096, recorded as the durable status:**

- **S1–S4 remain green — `34/34`, `61/61`, `84/84`, `105/105`.** Nothing in this halt reflects on
  them.
- **Migration 074 has NOT failed.** It was never executed: the runner refused before reaching any
  pending migration. 074 remains **unapplied and untouched**.
- The **PostgreSQL validation phase is BLOCKED before 074**, by `AFLDB-ISSUE-086`'s migration-073
  ledger drift — a dependency outside this issue, not a defect in ISSUE-096's work.
- The **PostgreSQL validation phase is BLOCKED** until the `afldb_test` migration baseline is
  coherent. The runner refuses every migration while any applied row drifts, so 074 cannot be
  applied through supported tooling, and no unsupported route is acceptable.
- **Migration 074 must NOT be modified while the baseline is incoherent**, including the FK-index
  repair in §16.14. Editing a pending migration is legitimate; doing it while a *different*
  migration's provenance is unresolved would entangle two independent repairs.
- **Nothing in the S1–S4 design is implicated.** The drift is entirely in a neighbouring migration
  owned by another issue. When the baseline is repaired, ISSUE-096 resumes at exactly this point
  with the §5.H matrix (§16.15) unchanged.

### 16.14 Migration 074 — three uncovered foreign keys, **REPAIRED IN PLACE 2026-08-28**

Found by inspection during the same session, **before** the preflight, deferred while the 073
baseline was incoherent (§16.13), and **now repaired in `074_source_observation_spine.sql` itself**
— legitimately, because 074 has never been applied anywhere. The structural pre-application review
that found them is what makes the repair free: once 074 is applied its file is frozen by the same
checksum guard, and the fix would have cost a further migration.

`tests/integration/fk-indexes.test.ts` is an existing green gate: every foreign key in `public`
whose parent is not in its `DELETE_FREE_PARENTS` list must have a **leading-column** index, and a
partial index counts only when its predicate is exactly `(col IS NOT NULL)`. Its own header names
`auth_users` as the case that must "fail here rather than ship".

074 adds seven foreign keys in `public`. Three are uncovered, so **applying 074 as written turns
that suite red**:

| Foreign key | Covered? |
|---|---|
| `promotion_candidates(source_id) -> sources` | exempt parent |
| `promotion_candidates(season) -> seasons` | exempt parent |
| `promotion_candidates(created_by_batch_id) -> import_batches` | exempt parent |
| `promotion_decisions(candidate_id) -> promotion_candidates` | yes — `ix_promotion_decisions_candidate` |
| **`promotion_candidates(source_id, family, external_record_id, source_version_seq)`** | **NO** — `ux_promotion_candidates_pending` has a different 4th column and a non-matching partial predicate |
| **`promotion_candidates(resolved_decision_id) -> promotion_decisions`** | **NO** |
| **`promotion_decisions(admin_user_id) -> auth_users`** | **NO** |

Staging FKs are out of scope: that suite filters child tables to `nspname = 'public'`.

**Sequencing, and why this is recorded rather than left to be noticed later.** `migrate.ts` refuses
to run once an **applied** migration's checksum drifts, so once 074 is applied its file is frozen
and this repair costs a migration 075. The three indexes therefore had to land in 074 **after** the
073 baseline was repaired and **before** 074 is applied, which is exactly where they now are —
authored into the file's existing table sections, `promotion_candidates` first and
`promotion_decisions` second, with no `IF NOT EXISTS` because none of 074's four pre-existing
`CREATE INDEX` statements uses it:

```sql
CREATE INDEX ix_promotion_candidates_evidence
  ON promotion_candidates (source_id, family, external_record_id, source_version_seq);
CREATE INDEX ix_promotion_candidates_decision
  ON promotion_candidates (resolved_decision_id)
  WHERE resolved_decision_id IS NOT NULL;
CREATE INDEX ix_promotion_decisions_admin
  ON promotion_decisions (admin_user_id);
```

**Nothing else in 074 changed.** The repair was validated DB-free first, by the source-contract
assertion added to `tests/current-season-import.test.ts`
("covers its own foreign keys before it is ever applied"). That test reads the migration's
executable statements, not its prose — the S2 false-positive repair (§16.3) — and pins each index
whole: the evidence index on `promotion_candidates` with the leading key order
`(source_id, family, external_record_id, source_version_seq)`; the decision index on
`promotion_candidates (resolved_decision_id)` with exactly the predicate
`WHERE resolved_decision_id IS NOT NULL`; the admin index on `promotion_decisions (admin_user_id)`
plain rather than partial; and none of the three `UNIQUE` or `CONCURRENTLY`.

**Since confirmed against the real catalogue (§16.16).** 074 and 075 were applied in normal
filename order — **074 then 075** — leaving `75/75` applied, `0 pending`, no drift, and
`tests/integration/fk-indexes.test.ts` **2/2**. That suite is unmodified throughout, so its pass is
independent evidence for both this repair and `AFLDB-ISSUE-086`'s
`ix_data_overrides_admin_user_id`.

These are **not speculative performance indexes** — they satisfy a machine-enforced repository
invariant. `DELETE_FREE_PARENTS` is not to be widened instead: `auth_users` is deletable, and the
suite's companion test refuses an exemption that is not load-bearing.

The rest of 074 was reviewed in full against S2–S4 and **no contradiction was found**: the three
grains carry the approved identities; the only `UNIQUE` on the history table is
`ux_source_record_versions_open` and there is **no uniqueness on `payload_hash`**; `absent_since`
lives only on `source_records`; the candidate verb CHECK is Decision C's nine non-`unchanged` verbs
with `history_only` correctly absent; `promotion_candidates_acceptable_ck` restricts `accepted` to
`PROMOTABLE_VERBS`; the pending partial-unique index still permits supersession; the ledger is
`SELECT, INSERT` to `afldb_auth` only and is deliberately not import-writable; and **no FK carries
an `ON DELETE` action and no trigger or rule exists**, so no observation history can be silently
erased and no observation write can reach a canonical table. Two limitations are recorded rather
than repaired: payload/version immutability is a **grant** property (`privileges.sql` grants
`afldb_import` full DML on all of `staging`, the existing 063 model), and
`baseline_canonical_hash` carries no format CHECK where `payload_hash` does.

### 16.15 §5.H PostgreSQL validation matrix — what is actually provable at this checkpoint

Built before any implementation, as the phase required, and **retained unrun** because §16.13
halted the phase. The governing fact: `src/lib/acquisition/` contains **no persistence layer at
all** — every module is pure, and `resolveSourceId` is the boundary nothing crosses. Any §5.H
assertion whose subject is an import re-run or the accept transaction has no code to exercise.

| §5.H assertion | Class | What is actually provable |
|---|---|---|
| **Idempotence** | **PARTIAL** | The observation half is provable: `decideObservation` returns `unchanged`, the persisted consequence is one `UPDATE staging.source_records` and zero A1/A2 inserts, `current_version_seq` unchanged. The "0 canonical writes" clause is **vacuous** — no code path can write canonical data — and is provable only structurally. |
| **Correction replay A -> B -> A** | **EXECUTABLE** | Fully: three ordered versions over two payloads is pure schema behaviour. |
| **Absence is not deletion** | **EXECUTABLE** | Fully, with "canonical untouched" proven structurally (074 creates no trigger and no rule) plus row-count invariance. |
| **Foreign ownership** | **PARTIAL** | The predicate is pure TypeScript with no DB path (green DB-free at 105/105). DB-provable: a `foreign_owned_collision` candidate reaching `accepted` is unrepresentable by CHECK. |
| **Stale-review race** | **PARTIAL** | No accept transaction exists, so the race cannot be run. DB-provable: the approved S4 distinction has a real schema consequence — `stale_review` -> supersede frees `ux_promotion_candidates_pending` for the replacement candidate, while `stale_canonical_target` -> re-render keeps one pending row; `requeue` requires a `refusal_reason` and both reasons are in the ledger vocabulary. |
| **Manual authority, incl. indeterminate** | **BLOCKED — `AFLDB-ISSUE-086`** | No DB-backed authority query exists. Vocabulary only. |
| **Source disagreement + `data_issues` row** | **BLOCKED — never implemented** | Confirmed by search: **nothing in `src/lib/acquisition/` references `data_issues`.** Decision C names the write; no stage built it, and building it now would absorb ISSUE-097/099. |
| **Rollover supersession** | **BLOCKED — `AFLDB-ISSUE-101`, and unsupported by 074** | Beyond having no code: §5.G requires in-season observation rows to be **marked superseded**, and **074 has no supersession column on any of the three grains** — `superseded` exists only as a `promotion_candidates.status`. Recorded as a forward gap for ISSUE-101; **not** repaired here. |

**Two of eight fully executable, three partial, three blocked.** No blocked assertion is to be made
artificially green, and no fake canonical write is to be created in order to test "0 writes".

**Integration tests did not exist at this checkpoint.** All 21 spine references in
`tests/current-season-import.test.ts` read **migration source text**, not a database; nothing under
`tests/integration/` touched the spine. The conventions named for the resumption were the
repository's own: `import './guard'` first, `sql` from `@/db/client` (redirected to
`AFLDB_TEST_DATABASE_URL` by `tests/setup.ts`, which already refuses any database not matching
`_test`), and `database.test.ts`'s `sql.begin` + deliberate `Rollback` envelope so no fixture is
ever committed. Privilege assertions belong in `tests/integration/privileges.test.ts`.
**Superseded by §16.16**, which was written against the applied schema and follows exactly those
conventions; the classification above is the pre-application one and is retained as history.

### 16.16 PostgreSQL validation phase — RESUMED 2026-08-28, schema gate GREEN

**Schema/migration gate, user-run 2026-08-28. This is recorded evidence, not inference.**

| Fact | Value |
|---|---|
| Application order | **074 then 075**, normal filename order, one run — `074_source_observation_spine.sql ... ok`, `075_data_overrides_fk_index.sql ... ok`, `Applied 2 migration(s).` |
| Post-apply status | **75 migration file(s), 75 already applied, 0 pending** — no drift |
| Privilege reconciliation | completed successfully |
| `tests/integration/fk-indexes.test.ts` | **2/2 passed** |
| Post-migration fingerprint | `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227` |
| Catalogue shape | `afldb_test` / `afldb_owner`; schemas 5, relations 143, routines 44, types 210, extensions 3; `migrations: present|75|075_data_overrides_fk_index.sql` |

The FK gate passing at 2/2 is the **real catalogue** proof of both repairs at once: ISSUE-096's
three §16.14 indexes in 074, and `AFLDB-ISSUE-086`'s `data_overrides.admin_user_id` index in 075.
The §16.13 migration-baseline blocker is **closed** and the §16.14 pre-application review is
**discharged by evidence** rather than by argument.

**The governing constraint has NOT changed.** `src/lib/acquisition/` still contains **no
persistence layer**: every module is pure, `resolveSourceId` is the boundary nothing crosses, and
no module imports `@/db/client`. Applying 074 created tables; it did not create a writer for them.
So a §5.H row whose subject is *an import re-run* or *the accept transaction* still has no
production code to exercise, and none was written here — S1–S4 stop at S4 and there is no approved
S5 (§16.12).

**What the new integration suite therefore is, stated exactly.** `tests/integration/`
`observation-spine.test.ts` drives the **real** decision functions (`decideObservation`,
`sweepAbsences`) and applies each returned decision to `afldb_test` with the SQL a persistence
layer would issue. It proves the **schema half** of §5.H — that PostgreSQL admits the histories the
model requires and refuses the ones it forbids. Every decision is taken from state **read back out
of PostgreSQL** — the stored open head plus the stored payload-hash set — rather than from a value
carried forward in memory, so a write that left the record pointing at the wrong version changes
the outcome instead of being absorbed by the test's own bookkeeping. It does **not** prove any
production persistence path, because none exists. Every
test runs inside one always-rolled-back transaction against a synthetic `sources` row created in
that transaction, so nothing is committed and no fixture id is shared with real data.

**Refreshed §5.H matrix — reassessed against the applied schema and the current code, not carried
over from §16.15.**

| §5.H assertion | Class now | What the DB actually proves |
|---|---|---|
| **Idempotence** | **PARTIALLY EXECUTABLE** | Proved: an unchanged poll's persisted consequence is one `UPDATE staging.source_records` — 0 new payload rows, 0 new version rows, `current_version_seq` unchanged, `last_seen_at` advanced, `first_seen_at` and the open interval untouched. **Unproved:** "0 canonical writes" as a *runtime* fact, and re-running a production import — there is no importer. The canonical clause is instead proved **structurally** from `pg_trigger`/`pg_rewrite`: the five relations carry no trigger and no rule. |
| **Correction replay A → B → A** | **EXECUTABLE DB-BACKED NOW** | Fully. Three ordered `version_seq` rows over **two** payload rows, the third row's hash identical to the first, intervals chained with no gap or overlap, exactly one open version, `opened_by`/`closed_by` batches correct. Also proved: `ux_source_record_versions_open` refuses a second open version, and `source_record_versions_close_ck` refuses a closed version naming no batch. |
| **Absence ≠ deletion** | **EXECUTABLE DB-BACKED NOW** | Fully. `absent_since` stamped on the record row only; a record in a **non-enumerated** scope is untouched; payload/version/record counts invariant across the sweep; reappearance clears `absent_since` and appends no version; `absent_since` exists on `source_records` and on **neither** history table (`information_schema`); an `absent` candidate proposing a target is refused by `promotion_candidates_absent_ck`. Canonical untouched is again structural (no trigger, no rule) plus count invariance. |
| **Foreign ownership** | **PARTIALLY EXECUTABLE** | Proved in PostgreSQL: `foreign_owned_collision` — and every other refusal verb — **cannot reach `accepted`**; `promotion_candidates_acceptable_ck` refuses the transition while the identical transition to `rejected` succeeds, so the refusal is the verb rule and not the workflow columns. **Unproved:** the ownership predicate itself, which is pure TypeScript with no DB path (covered DB-free). |
| **Stale-review race** | **PARTIALLY EXECUTABLE** | Proved in PostgreSQL: one live proposal per record+target (`ux_promotion_candidates_pending` refuses the second pending row); **supersession frees the slot** for the replacement, which is the S4 `stale_review` → supersede distinction having a real schema consequence; a resolved candidate naming no decision is refused (`promotion_candidates_decision_ck`); a `requeue` with no reason is refused (`promotion_decisions_requeue_ck`); both stale reasons are storable and an unknown reason is not (`promotion_decisions_reason_ck`). **Unproved:** the race itself — there is no accept transaction to race. |
| **Manual authority, incl. indeterminate** | **BLOCKED — `AFLDB-ISSUE-086`** | Unchanged. No DB-backed authority query exists; `UNAVAILABLE_MANUAL_AUTHORITY` is still the only provider. Only the refusal **vocabulary** is storable, and no test pretends the predicate ran. |
| **Source disagreement + `data_issues` row** | **BLOCKED — never implemented** | Unchanged and re-verified: **nothing in `src/lib/acquisition/` references `data_issues`.** Decision C names the write; no stage built it. No fabricated `data_issues` row was inserted to make this row green. |
| **Rollover supersession** | **BLOCKED — `AFLDB-ISSUE-101`, unsupported by 074** | Unchanged and re-verified against the applied schema: **074 has no supersession column on any of the three grains** — `superseded` exists only as a `promotion_candidates.status`. A forward gap for ISSUE-101, not repaired here. |

**Two fully executable, three partially executable, three blocked.** The three blocked rows have
**no test at all** rather than a weak one, and nothing was implemented to move a row out of
BLOCKED.

**No canonical acceptance/write path was added.** The suite inserts no canonical row, creates no
`'accept'` decision, and contains no force/override/bypass/consensus path; the only decisions it
writes are `reject` and `requeue`, both of which S4 actually builds. The `accepted` status is
exercised **only** as a transition PostgreSQL must refuse.

**VALIDATION GREEN — user-run 2026-08-28.**

| Suite | Result | What it settles |
|---|---:|---|
| `tests/current-season-import.test.ts` | **106/106** | The DB-free contract, including the 074 source-contract FK-index assertion added with the §16.14 repair — the three indexes are pinned whole, by leading key order and predicate, over executable SQL statements. |
| `tests/integration/fk-indexes.test.ts` | **2/2** | The real catalogue gate, unmodified throughout: **the §16.14 FK repair in 074 is validated**, and so is `AFLDB-ISSUE-086`'s 075 `data_overrides.admin_user_id` index, both in the same pass. |
| `tests/integration/observation-spine.test.ts` | **13/13** | The §5.H rows classified executable or partially executable above, against `afldb_test`. |

Migration state at validation: **75 migration file(s), 75 already applied, 0 pending**, with
**074 applied before 075**; privileges reconciled; fingerprint
**`c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`**.

**The first spine run exposed one defect and it was in the fixture, not in the schema or the
assertions.** `seed()` wrote `seasons.is_complete`, which migration 015 dropped and re-added as
`GENERATED ALWAYS AS (status = 'complete') STORED`; ten cases aborted in shared setup **before
reaching their bodies**, so nothing failed on §5.H semantics. The fixture now writes the writable
authority — `INSERT INTO seasons (year, league, status) VALUES (2099, 'AFL',
'in_progress'::season_status)` — and the rerun passed 13/13. **No behavioural assertion was
changed** to obtain it, and `is_complete` is the only generated column in the entire schema, so no
other seed column was affected.

**What 13/13 does and does not mean.** It proves the **implemented PostgreSQL/schema half** of
§5.H: that migration 074 admits the histories the model requires and refuses the ones it forbids.
It does **not** prove an importer or a canonical accept transaction, because **neither exists** —
`src/lib/acquisition/` still has no persistence layer. **The three PARTIALLY EXECUTABLE rows above
stay partial.** Their schema consequences passing is exactly what "partial" claimed; the
unproved halves — a production import re-run, the ownership predicate's DB path, and the
render-to-accept race itself — have no code to exercise and are not made green by this run.
**The three BLOCKED rows stay blocked** and still have no test at all.

**The one remaining ISSUE-096-owned validation gap — CLOSED 2026-08-28,
`tests/integration/privileges.test.ts` 24/24 passed (user-run).**
074's append-only-by-grant invariant on `promotion_decisions` had no catalogue test:
`tests/integration/privileges.test.ts` names its append-only auth tables in an explicit array and
did not name it, so the drift its own migration comment warns about — `privileges.sql` regenerating
`grant_import_write()`'s UPDATE/DELETE/TRUNCATE over the ledger — would not have been caught.
Closed in that file's **existing** contract, in its two existing homes and with no new privilege
model: `('promotion_decisions', 'SELECT')` and `('promotion_decisions', 'INSERT')` added to the
positive "privileges the reconciler must grant" list, and `promotion_decisions` added to the
append-only array that asserts `afldb_auth` holds **no** UPDATE, DELETE or TRUNCATE.
`tools/maintenance/privileges.sql` was inspected and **not changed**: it already specifies
`['promotion_decisions', 'SELECT, INSERT']` and lists the table in the sequence-grant set, so the
grants are correct and only the test was missing. `promotion_candidates` was deliberately left out
— its column-scoped UPDATE is a different shape and not this invariant.

### 16.17 ISSUE-096 RESOLVED 2026-08-28 — complete within the authorised S1–S4 scope

**Final validated evidence, all user-run 2026-08-28:** `tests/current-season-import.test.ts`
**106/106**; `tests/integration/observation-spine.test.ts` **13/13**;
`tests/integration/fk-indexes.test.ts` **2/2**; `tests/integration/privileges.test.ts` **24/24**;
migrations **75/75 applied, 0 pending** with **074 applied before 075**; privileges reconciled;
fingerprint `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.

**Migration 074 is applied and checksum-frozen. It must not be edited again** — the runner refuses
every migration once an applied file drifts, so any further change to the spine is a new migration.

**The §5.H matrix in §16.16 stands exactly as written.** No partial row became a full pass because
its schema consequences passed; that is precisely what "partially executable" claimed. **The
remaining partial and blocked rows are NOT unfinished ISSUE-096-owned S1–S4 work.** They are, in
every case, one of two things:

1. **A consequence that cannot be exercised without a future persistence or accept path.** The
   unproved halves — a production import re-run, the ownership predicate's DB path, the
   render-to-accept race — have **no code to exercise**: `src/lib/acquisition/` deliberately holds
   no persistence layer, and the canonical acceptance/write transaction is outside S1–S4 by
   approval and gated on `AFLDB-ISSUE-086`.
2. **A separately owned downstream capability.** Manual authority → `AFLDB-ISSUE-086`; the
   `data_issues` disagreement row → never implemented in S1–S4, and building it would absorb
   `AFLDB-ISSUE-097`/`AFLDB-ISSUE-099`; rollover supersession → `AFLDB-ISSUE-101`, which also owns
   the observation-grain supersession model 074 deliberately does not provide.

**No approved S5 exists** (§16.12): a next stage is a fresh approval decision, not a continuation.
The admin review screen remains an explicit §2 non-goal. No family importer was built here.

---

## Amendment history

**2026-08-28 — three corrections after first review. Superseded positions recorded, not deleted.**

1. **Decision A.** The first draft proposed a single append-only table keyed
   `(source_id, family, external_record_id, payload_hash)`. **Rejected:** it is incompatible with
   the correction-history requirement — in an A → B → A transition the second **A** collides with
   the first row and degrades to a `last_seen_at` touch, so three ordered states are recorded as
   two. It also placed `absent_since` on a payload version, which is the wrong grain: absence is a
   property of the external key, not of a historical payload. **Replaced by** the three-grain model
   in A1–A3, which holds I1 and I2 simultaneously and puts `absent_since` on the record. The
   DB-free test strategy in H was amended to assert the version/payload counts directly.
2. **`source_updated_at`.** The first draft listed AFL API `utcStartTime` as a `source_updated_at`
   value. **Rejected:** `utcStartTime` is the scheduled event start time, not an upstream mutation
   timestamp; it belongs in the typed family projection. **Replaced by** A′ — only genuine upstream
   mutation timestamps qualify, Squiggle `updated` is retained, everything else is NULL, and the
   payload hash is the change oracle.
3. **Decision E / manual authority.** The first draft defined the durable mechanism itself, as a
   `data_edits`-based predicate ("no `data_edits` row newer than the last promotion"). **Rejected:**
   ISSUE-086 is defining durable source-reload override authority, including a `data_overrides`
   concept, and a second predicate here would be a competing authority model. **Replaced by** §7 —
   ISSUE-096 states the invariant and the fail-closed interface; ISSUE-086 owns the mechanism and
   storage; `data_edits` is audit evidence that participates only if ISSUE-086's contract says so.
   Decision E was narrowed to **source containment only**. G was amended so the full-history
   rollover must respect the same authority contract once it lands.
