# AFLDB-ISSUE-099 — In-season AFL Tables settle stage

**Status:** Open — planning complete, implementation not started.
**Runbook status:** APPROVED CONTRACT for the implementation session.
**Planning session:** 2026-08-28. Investigation + contract only; no ISSUE-099 code written.
**Parent contract:** `AFLDB-ISSUE-096.md` (Resolved) · **Parent investigation:**
`AFLDB-2026-API-ACQUISITION.md` §2.4, §5, §9 row D, §13.5.

> This file is the durable source of truth for AFLDB-ISSUE-099. Where it and any older
> `issues.md` / `IssuesIndex.md` wording disagree, **this file is authoritative** and the
> older wording is superseded lineage.

---

## 1. Objective

Build the nightly in-season AFL Tables settle pass: a partial fitzRoy acquisition of the
in-progress season, verified offline against its SHA-256 manifest, projected into the
migration-074 source-observation spine, reconciled under the ISSUE-096 verb contract, and
surfaced as **reviewed promotion candidates** plus **idempotent `data_issues` disagreement
rows**.

2026 currently has **no** player-match statistics, **no** period scores, **no** attendance
and **no** Brownlow votes, because the only current-season path stages matches from
Squiggle/Kali and neither source carries any of them. AFL Tables — already AFLDB's frozen
canonical historical source — carries all of them for the in-progress season. This issue
makes the historical source a current-season source without weakening the historical
fail-closed contract.

**v1 writes no canonical data.** See §15.

---

## 2. Established evidence

### 2.1 Probe P5 — PASS, stop condition NOT triggered (2026-08-28)

Authoritative record: `AFLDB-2026-API-ACQUISITION.md` §13.5.

| Measure | Value |
|---|---|
| Dimensions | **9,522 × 81** |
| Date range | 2026-03-05 → 2026-08-23 |
| Distinct matches | 207 |
| Rounds | 1–25, all numeric, **no finals rows yet** |
| `url` NA | **0** |
| `ID` NA | **82** (5 distinct urls, 2 named players) |
| Distinct real `ID` | 663 |
| Distinct `(ID, url)` pairs | **663 — 1:1** |
| Do those 5 urls carry an `ID` anywhere in 2026? | **0 of 5** |
| `Attendance` NA | **0** |
| `Substitute` | NA for all 9,522 rows |

**Binding consequences.**

- **P5 PASSED. The §8 stop condition was NOT triggered. ISSUE-099 is not probe-blocked.**
- The 2026 player-match identity **keys on the stable profile `url`**. `ID` is an
  **enrichment field** and must never be required.
- **Names are never identity.** A 2026 debutant can arrive with NA `Player` and NA `DOB`.
- A `url` unknown to AFLDB is `unresolved_identity` and goes to a human — never an
  auto-created player.

**Do not rerun P5.** Older ISSUE-099 wording describing P5 as pending or gating is stale and
is corrected in `issues.md` and `IssuesIndex.md` (§30.2).

### 2.2 Source availability

`https://afltables.com/afl/seas/2026.html` carries the season through **Round 25, completed
2026-08-23**, including per-match player statistics, venue, attendance and a ladder.

### 2.3 The resolved ISSUE-096 foundation

Applied and checksum-frozen: **migration 074** (three observation grains +
`promotion_candidates` + append-only `promotion_decisions`), plus **073** and **075**.
Evidence: source contract 106/106, spine suite 13/13, FK gate 2/2, privileges 24/24,
migrations 75/75 with 074 before 075, fingerprint
`c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.

Contracts inherited and **not** re-litigated here: tracked source-family registry;
fail-closed typed family parsing; immutable payloads; ordered observation versions;
current-key state; A→B→A correction history; absence as state, never deletion;
reconciliation verb/preference contract; fail-closed ownership; reviewed promotion;
proposed-field baseline hashing; the `stale_review` vs `stale_canonical_target`
distinction; and **no force/override/consensus bypass**.

ISSUE-096 deliberately did **not** build a family importer, the canonical acceptance
transaction, or the `data_issues` disagreement row. The last of those is
**ISSUE-099's** (`AFLDB-ISSUE-096.md` §16.18).

---

## 3. Current repository state — findings F1–F11

All source-verified during the 2026-08-28 planning session.

**F1 — the issue's own "partial snapshot" wording is stale.**
`tools/rebuild/fitzroy/acquire_core.R` no longer labels anything `partial`. It records
`acquisition_kind: "core_snapshot" | "validation_witness"`, `completeness: "unvalidated"`,
`full_history: FALSE`, and a `verdict_authority` string (`:326-374`). The acquirer
deliberately does **not** adjudicate; the full-history verdict is
`import_fitzroy_core.py --require-full-history` → `enforce_full_history()` (`:604`).
⇒ An in-season snapshot needs a **third acquisition kind** and its **own adjudicator**, not
a resurrected `partial` flag.

**F2 — `validate_snapshot()` is already range-agnostic** (`import_fitzroy_core.py:719`).
It verifies mode, label, adapter schema version, fitzRoy pin, per-file SHA-256, header
equality, row-count equality, required columns, per-season filename shape and range
containment — without requiring full history. Reusable verbatim for an in-season snapshot.

**F3 — the DB-free scan layer is correct and complete for in-season use**, and is the one
place the AFL Tables source semantics live: `ClubResolver` era/normalisation rules
(`:279`), `scan_results()` (`:887` — goals/behinds/points and margin reconciliation,
duplicate-match refusal, missing-venue refusal), `scan_player_stats()` (`:1003` — results
join, round/score/venue cross-checks, attendance dedupe with fail-closed conflict,
start-time and quarter-score agreement, URL identity with optional `ID`), `STAT_MAP`
(`:123` — explicit names, never column position), `source_row_corrections` (`:952`),
`normalise_profile_url()` (`:220`), `load_round_vote_seasons()` (`:413`).

**F4 — the canonical `import_*` writers must NOT be reused.** Correct for a clean rebuild,
forbidden for in-season settle:

| Function | Why forbidden |
|---|---|
| `import_matches` (`:1520`) | `ON CONFLICT (match_key) DO UPDATE … source_id = EXCLUDED.source_id` with **no ownership predicate**, plus `DELETE FROM match_period_scores WHERE match_id = ANY(...)` |
| `import_player_match_stats` (`:1646`) | `DELETE FROM player_match_stats WHERE match_id = ANY(...)` |
| `import_brownlow_round_votes` (`:1707`) | `DELETE FROM brownlow_round_votes WHERE season = ANY(...)` |
| `import_venues` (`:1251`) | **creates `venues` and `venue_aliases` rows** — no source may create an identity |
| `import_players` (`:1298`) | creates players — a new player is always a human decision |

**F5 — two of the four canonical targets cannot express source ownership.** Verified across
every migration:

| Target | `source_id` | `source_record_id` | `import_batch_id` | Ownable today? |
|---|---|---|---|---|
| `matches` | ✅ 064 | ✅ 064 | ✅ 064 | yes |
| `player_match_stats` | ✅ 004 | ❌ | ✅ 004 | partly |
| `match_period_scores` | ❌ | ❌ | ❌ | **no** |
| `brownlow_round_votes` | ❌ | ❌ | ❌ | **no** |

Under Decision E a target with no `source_id` is ownership-**indeterminate**, which fails
closed. In v1 this is **correct and sufficient**: v1 writes nothing canonical, so the
honest outcome is a `foreign_owned_collision` refusal candidate that records exactly why
the target is not promotable. **The provenance repair is therefore NOT v1 work** — it is a
prerequisite of the future acceptance stage (§16).

**F6 — `scan_player_stats()` aborts the whole pass on one bad record.** A player row whose
`Player`, `First.name` and `Surname` are all blank raises
`PlayerIdentityError("… has no usable name")` (`:1174-1177`). P5 proved a 2026 debutant can
arrive with NA `Player` and NA `DOB`. Same class: conflicting attendance (`:1071-1074`),
quarter-score disagreement (`:1087-1091`), unresolvable club, failed results join
(`:1037-1040`). Correct for a full rebuild; unacceptable for a nightly settle, where one
bad record would kill the entire run. ⇒ opt-in `--on-record-error reject` (default
`abort`), so the historical path is byte-for-byte unchanged.

**F7 — migration 074 provides no machine-resolvable candidate retirement.**
`promotion_candidates_resolution_ck` and `promotion_candidates_decision_ck` require a
`resolved_decision_id`; `promotion_decisions.admin_user_id` is `NOT NULL`. A machine cannot
retire a candidate without fabricating an admin decision, which is forbidden. This is
**safe, not broken**: a moot candidate cannot be wrongly accepted, because
`evaluateAcceptance` refuses it with `stale_review` once `source_version_seq` has moved.
Recorded as a forward gap; **not repaired here, and no fabricated decision is ever written.**

**F8 — 2026 canonical matches may already be owned by another source.** The shipped
`--update-matches` path (`src/lib/external-afl/current-season-import.ts:1028-1047`)
re-stamps `source_id = squiggle/kali` on an existing match. On a canonically rebuilt
`afldb_test`, 2026 has zero matches (Stage-9 gate `matches_after_accepted_last_season = 0`),
so v1 sees only `new` targets. On `afldb_dev` / production the settle would meet
`foreign_owned_collision`. Recorded as a deployment risk and stop condition — **not worked
around, and no ownership-transfer shortcut is invented.**

**F9 — ISSUE-086's authority mechanism exists but is entity-scoped.** Migration 073
`data_overrides` carries `CHECK (entity_type IN ('players','matches','draft_picks'))`,
natural key `entity_key` (for matches: `matches.match_key`), and `field_group`
(for matches: `attendance`, `score`, `match_time`, `match_event`, `notes` —
`src/lib/edit/spec.ts:112-145`). ⇒ authority is representable for `matches` and **not** for
`player_match_stats`, `match_period_scores`, `brownlow_round_votes`. Widening that CHECK is
ISSUE-086's mechanism, not ISSUE-099's. Under D2, v1 never reaches the authority gate; this
is a prerequisite of the future acceptance stage (§16).

**F10 — `recomputeClubSeasons` no longer depends on `staging.team_seasons`.** ISSUE-095
rewrote it to derive from `matches` (`src/db/queries/player-derived.ts:410-421`); it now
refuses only when the season has zero home-and-away matches. The ISSUE-096 §10 warning
about weakening its guard is satisfied and needs no action here. v1 writes nothing
canonical, so no derived rebuild is triggered.

**F11 — `Brownlow.Votes` coverage for 2026 was never measured.** P5 measured `ID`, `url`,
`Attendance` and `Substitute` NA counts — **not `Brownlow.Votes`**. `stat-availability.json`
declares `brownlow_round_votes` 2026 as `pending`, which `load_round_vote_seasons()` admits.
In-season AFL Tables publishes no votes until the count, so the expected v1 outcome is
**zero** Brownlow candidates. Closed by one bounded **offline** measurement over the
acquired CSV (§9.4, T3). **No network rerun of P5 is required.**

---

## 4. Dependency status

| Dependency | Status |
|---|---|
| Probe **P5** | **PASS 2026-08-28, stop condition NOT triggered.** No longer a gate. |
| `AFLDB-ISSUE-096` (parent contract) | **Resolved.** Migration 074 applied and checksum-frozen. |
| `AFLDB-ISSUE-093` (acquisition/manifest machinery) | **Resolved.** Reused, not duplicated. |
| `AFLDB-ISSUE-098` (shipped importer containment) | **Resolved.** Its spine integration is the pattern v1 extracts and reuses. |
| `AFLDB-ISSUE-086` (manual authority) | **Resolved**, but entity-scoped (F9). **Not a v1 gate**; a prerequisite of the future acceptance stage. |
| `AFLDB-ISSUE-095` (club_seasons) | **Resolved.** No action here (F10). |
| `AFLDB-ISSUE-101` (rollover) | Open, downstream. Not touched. |
| Migration **076** | New forward migration, v1 scope (§10). |

---

## 5. Scope and explicit non-goals

### 5.1 In scope (v1)

Verified in-season AFL Tables snapshot → deterministic observation bundle → migration-074
observation persistence → typed family projections → reconciliation → `promotion_candidates`
→ idempotent `data_issues` → dry-run/apply reporting with deterministic counters.

Two source families, four canonical **targets** (proposal targets only — nothing is
written): `matches`, `match_period_scores`, `player_match_stats`, `brownlow_round_votes`.

### 5.2 Explicit non-goals

- **Any canonical INSERT or UPDATE** (§15) and any `'accept'` `promotion_decisions` row.
- Canonical provenance columns added merely to prepare a later acceptance transaction (§16).
- Admin review UI — an explicit `AFLDB-ISSUE-096` §2 non-goal.
- Scheduling (cron / systemd timer) — not authorised.
- `AFLDB-ISSUE-100` lineups.
- `AFLDB-ISSUE-101` rollover / supersession.
- `AFLDB-ISSUE-095` completed-season `club_seasons` ownership, and no `club_seasons`
  Stage-9 gate.
- `AFLDB-ISSUE-102` awards acquisition.
- `player_match_period_stats` — MISSING from every free source; stays unpopulated.
- Any write to `brownlow_season_votes`.
- Editing migrations **073 / 074 / 075**, or weakening any migration checksum guard.
- `AFLDB_LEGACY_SQLITE`.
- Production or `afldb_dev` work. All DB validation is `afldb_test` only.
- Creating any player, club or venue identity.

---

## 6. Source / data-grain mapping

### 6.1 Families

| Family | `external_record_id` | `scope_key` | Targets |
|---|---|---|---|
| `afltables.match` | `season\|round_code\|date\|home name\|away name` — byte-identical to `matches.match_key`, produced by the existing `match_key_of()` (`import_fitzroy_core.py:1181`) | `season=<year>` | `matches`, `match_period_scores` |
| `afltables.player_match_stats` | `<normalised profile url path>@<match_key>` | `season=<year>` | `player_match_stats`, `brownlow_round_votes` |

Migration 074's `ux_promotion_candidates_pending` is unique on
`(source_id, family, external_record_id, target_table)`, so **one observation legitimately
produces distinct target-specific candidates**. That is the designed dimension and it is
used here rather than inventing extra families.

**Attendance belongs to the `afltables.match` family projection** — it is a `matches` column
(`attendance`, `attendance_status`, `attendance_source_id`), not a family of its own.

### 6.2 Identity contract

| Grain | Key | Rule |
|---|---|---|
| Match | `results.csv` `(date, home historical identity, away historical identity)` → `match_key` | `results.csv` is the **sole** producer of match identity. Every `player_stats` row must join to it (`scan_player_stats` fails the record otherwise), so two source files can never mint duplicate matches. |
| Player | normalised AFL Tables profile **`url`** | P5-binding. `ID` rides the payload as **enrichment only** and is never required. `ID` populated must stay 1:1 with `url` (already enforced, `:1123-1129`, `:1165-1173`). |
| Club | `ClubResolver` era + `source_club_normalisation` rules | Ambiguous or unresolvable ⇒ **refusal**. No club is created. |
| Venue | `venues.legacy_name`, then `venue_aliases.alias` | Unresolved ⇒ `venue_id` stays **NULL** and the real `venue_raw` string is retained; counted as `venueUnmapped`. **No `venues` or `venue_aliases` row is ever created.** This is the schema's designed shape (`003_matches.sql:35-38`) and is **not** the ISSUE-098 defect, which fabricated the literal string `'Unknown'` into a NOT NULL column. |

**Names are never an identity key, at any grain.**

### 6.3 Round vocabulary

`afltables_2026` stays **`anchors_only`**. The settle joins on
`(date, home identity, away identity)` and `match_key`, never on round integers across
vocabularies; canonical `round_code` / `round_number` / `round_type` come from AFL Tables'
own `Round` / `Round.Number` / `Round.Type`, cross-validated against `player_stats` **inside
the one vocabulary** (`:1045-1049`). `translateRound()` is never called, so completing the
mapping is not v1 work. If ISSUE-097 later needs a real cross-source mapping, that is its
decision.

---

## 7. Architecture and data flow

```
S-A  acquire_core.R --acquire --in-season --label L --from Y --to Y
       network; writes CSVs, then the manifest LAST.  NO PostgreSQL.

S-B  import_fitzroy_core.py --label L --require-in-season
       --on-record-error reject --emit-observations bundle.json
       offline: validate_snapshot + enforce_in_season + scan_results + scan_player_stats
       writes bundle.json.  NO PostgreSQL.

S-C  settle-afltables.ts: parse + fail-closed validate the bundle contract,
       re-read the manifest, verify the bundle's binding to it.
       Still NO PostgreSQL.

S-D  settle-afltables.ts --dry-run | --apply : ONE write-capable sql.begin
       import_batches row
         -> per record: decideObservation -> staging.source_payloads /
            source_record_versions / source_records          (EVERY enumerated record)
         -> typed projection rows                            (resolved identity ONLY)
         -> sweepAbsences  (ONLY where the enumeration is proven complete)
         -> reconcile()
         -> promotion_candidates  (insert / refresh-in-place)
         -> import_rejections
         -> data_issues  (open / refresh / resolve, ownership-scoped)
         -> batch counters + status
       --apply commits.  --dry-run ROLLS BACK the entire transaction.
       ZERO canonical writes in both modes.

S-E  (NOT v1)  reviewed canonical acceptance — separate approval, gated on §16.
```

**Division of ownership (D1).**

| Owner | Responsibility |
|---|---|
| **R** (`acquire_core.R`) | network acquisition, snapshot bytes, SHA-256 manifest |
| **Python** (`import_fitzroy_core.py`) | **all AFL Tables interpretation**: `ClubResolver`, `scan_results()`, `scan_player_stats()`, `STAT_MAP`, attendance dedupe, quarter/score reconciliation, `source_row_corrections`, URL normalisation, NULL/NA semantics. **Must not open PostgreSQL in the settle path.** |
| **TypeScript** (`src/lib/acquisition/*`, `tools/current-season/settle-afltables.ts`) | migration-074 observation persistence, reconciliation, promotion candidates, `data_issues` lifecycle, transaction boundaries, CLI apply/dry-run reporting |

The boundary between them is the **explicit versioned deterministic JSON observation-bundle
contract** of §8, validated fail-closed by TypeScript **before any PostgreSQL write**.

---

## 8. The Python → TypeScript observation-bundle contract

Versioned, deterministic, fail-closed. TypeScript refuses the whole run on any drift; there
is no permissive fallback and no force flag.

```jsonc
{
  "bundle_contract_version": 1,
  "generated_by": "tools/migration/import_fitzroy_core.py",
  "snapshot_label": "settle-2026-08-29",
  "manifest_path": "docs/rebuild-manifests/afltables_fitzroy_core/settle-2026-08-29.json",
  "manifest_sha256": "<64 hex>",          // TS re-hashes the manifest and refuses on mismatch
  "acquisition_kind": "in_season_partial",
  "season": 2026,
  "fitzroy_version": "1.8.0",

  // Presence enumeration — the absence-sweep authority. INDEPENDENT of projection success.
  "enumerations": [
    { "family": "afltables.match",
      "scope_key": "season=2026",
      "complete": true,
      "incomplete_reason": null,
      "external_record_ids": ["2026|1|2026-03-05|Sydney|Carlton", "..."] },
    { "family": "afltables.player_match_stats",
      "scope_key": "season=2026",
      "complete": true,
      "incomplete_reason": null,
      "external_record_ids": ["players/M/Marc_Murphy.html@2026|1|2026-03-05|Sydney|Carlton", "..."] }
  ],

  // Every record with a PROVABLE key, whether or not it projected.
  "records": [
    { "family": "afltables.match",
      "scope_key": "season=2026",
      "external_record_id": "2026|1|2026-03-05|Sydney|Carlton",
      "payload": { /* typed, canonicalisable, NULL-preserving */ },
      "observed_columns": ["season", "round_code", "..."],
      "projection": { /* resolved identities + typed fields, or null */ },
      "rejection": null            // or { "reason": "...", "detail": "..." }
    }
  ],

  // Rows with NO provable key. Their presence CANNOT be represented, so they force
  // complete=false on their (family, scope_key).
  "unkeyed_rejections": [
    { "family": "afltables.player_match_stats", "scope_key": "season=2026",
      "reason": "no_profile_url", "detail": "player_stats_2026.csv line 4821" }
  ],

  "counts": { "matches": 207, "player_match_rows": 9522, "rejections": 0, "unkeyed_rejections": 0 }
}
```

**Fail-closed validation performed by TypeScript before any write:**

1. `bundle_contract_version` must equal the supported version exactly.
2. `manifest_sha256` must equal the re-hashed manifest on disk; `snapshot_label` must match.
3. `acquisition_kind` must be `in_season_partial`; `season` must be in
   `data/reference/seasons.json.in_progress_seasons`.
4. Every `records[].family` must be a `declared` family in
   `data/reference/source-families.json`, and `observed_columns` must pass
   `assertProjectableColumns()` (missing required column or undeclared column ⇒ refusal).
5. Every `records[]` entry's `external_record_id` must appear in its family+scope
   `enumerations` entry, and every `external_record_id` in a `complete: true` enumeration
   must have a `records[]` entry. Any mismatch ⇒ refusal.
6. `unkeyed_rejections` non-empty for a `(family, scope_key)` ⇒ that enumeration **must**
   carry `complete: false`; if it does not, refusal.

---

## 9. Reuse-vs-new-code decisions

### 9.1 Reused unchanged

`validate_snapshot()` (F2) · `ClubResolver` · `scan_results()` · `scan_player_stats()` ·
`STAT_MAP` · `iter_player_stats()` + `source_row_corrections` · `normalise_profile_url()` ·
`normalise_results_round()` / `normalise_stats_round()` · `match_key_of()` ·
`load_round_vote_seasons()` · `QUARTER_COLUMNS` · every ISSUE-096 pure module
(`observations.ts`, `reconciliation.ts`, `promotion-review.ts`, `source-families.ts`).

### 9.2 Extended, additively and opt-in

- `acquire_core.R` — new `--in-season` mode (§10.1). The existing full-history and witness
  paths are untouched.
- `fitzroy-contract.json` — new `in_season` block. The `full_history` block is untouched.
- `import_fitzroy_core.py` — new `enforce_in_season()`, `--require-in-season`,
  `--emit-observations`, `--on-record-error {abort,reject}` (**default `abort`**, so the
  historical path is byte-for-byte unchanged).
- `data/reference/source-families.json` — add `afltables.match`; upgrade
  `afltables.player_match_stats` from `identity_only` to `declared` with
  `promotion_policy: "reviewed"`.

### 9.3 Extracted, behaviour-preserving

`persistSourceObservation()` and `markMissingObservationsAbsent()`
(`current-season-import.ts:706-857`) are today the *de facto* spine persistence layer, inline
in one importer. Extract them verbatim into **`src/lib/acquisition/observation-store.ts`**
and re-point the existing caller at it. Its suite must stay at **106/106** with no
behavioural assertion changed — the extraction is proven by the unchanged suite, not by
argument.

*Rejected:* writing a second, ISSUE-099-only persistence adapter. It would be the third
implementation of one contract and the exact acquirer/validator drift ISSUE-093 §H11 was
burned by.

### 9.4 New

- `src/lib/acquisition/settle-afltables.ts` — bundle validation, family projection,
  per-target reconciliation driver, candidate and `data_issues` planning. Pure where
  possible; database access confined to the store and the CLI transaction.
- `tools/current-season/settle-afltables.ts` — the operator CLI.
- `src/db/migrations/076_afltables_settle_projections.sql` (§10.2).

### 9.5 Explicitly NOT reused

Every canonical writer in F4, and `import_venues` / `import_players` in particular.

---

## 10. Schema / migration decision

### 10.1 No schema change for acquisition

The in-season acquisition kind lives in the manifest and the tracked contract, not in
PostgreSQL.

- `acquire_core.R --in-season` requires exactly one season (`--from` == `--to`) and requires
  that season to be listed in `data/reference/seasons.json.in_progress_seasons`. It writes
  `acquisition_kind: "in_season_partial"`, an `in_season` block (season, datasets, rounds
  observed), `completeness: "unvalidated"`, `full_history: FALSE`, and
  `verdict_authority: "import_fitzroy_core.py --label <L> --validate-only --require-in-season"`.
- `enforce_in_season()` re-derives every in-season gate from the contract and the artefacts,
  exactly as `enforce_full_history()` does. The acquirer still never adjudicates.
- **`--require-full-history` and `--require-accepted-baseline` must explicitly refuse any
  manifest whose `acquisition_kind` is `in_season_partial`**, on top of the existing range
  check. `--require-in-season` must symmetrically refuse anything that is not
  `in_season_partial`. An in-season snapshot can therefore never become acceptable to the
  full historical rebuild or to the accepted-baseline register.

### 10.2 Migration 076 — exact v1 scope

`src/db/migrations/076_afltables_settle_projections.sql`. **Nothing in it exists solely for
the future acceptance stage.** Migrations 073, 074 and 075 are not edited.

**(a) Two typed family projection tables — `staging.afltables_match`, `staging.afltables_player_match`.**

*Purpose.* `AFLDB-ISSUE-096` Decision B is binding: *"the jsonb spine never feeds a
promotion. Resolution and diffing read the typed projection; only history and absence read
the spine. A family with no typed projection cannot be promoted at all."* v1 produces
promotion candidates, so v1 requires the typed projections. They are **not** acceptance-stage
preparation.

*Why preferable to a JSON-only projection.*

1. Decision B requires it; a JSON-only projection would be the "JSON dumping ground" that
   rule exists to prevent.
2. Real foreign keys make resolved identity a **database-enforced fact** rather than an
   application claim — an unresolved club, player or season cannot be silently projected.
3. CHECK constraints hold the NULL≠0 and score-reconciliation invariants at the store, so a
   defect in the Python emitter cannot land a fabricated fact.
4. A durable typed row makes the dry-run/apply report and the review queue inspectable and
   re-derivable without re-parsing CSVs.
5. It matches the existing instance of the same pattern, `staging.external_current_matches`
   (migration 063).

*Grain, FKs, NULL semantics, indexes.*

| Table | Grain | Foreign keys | NULL semantics | Indexes |
|---|---|---|---|---|
| `staging.afltables_match` | one row per `afltables.match` observation with **fully resolved** identity: `(source_id, family, external_record_id)` | composite FK → `staging.source_record_versions (source_id, family, external_record_id, version_seq)`; `season → seasons(year)`; `home_club_id`, `away_club_id` → `clubs(id)` **NOT NULL**; `venue_id → venues(id)` **NULL-able** | `venue_id` NULL = unmapped venue string, `venue_raw` NOT NULL and always the real source string; `attendance` NULL = **not recorded, never 0**; `match_time` NULL = not published; quarter columns NULL = not recorded | PK on the grain; FK-covering index on `(source_id, family, external_record_id, version_seq)`; covering indexes on `season`, `home_club_id`, `away_club_id`, `venue_id` |
| `staging.afltables_player_match` | one row per `afltables.player_match_stats` observation with **fully resolved** identity: `(source_id, family, external_record_id)` | composite FK → `staging.source_record_versions`; `player_id → players(id)` **NOT NULL**; `club_id → clubs(id)` **NOT NULL**; `season → seasons(year)` | every one of the 21 statistic columns is **nullable**; NULL = *not recorded*, **never 0**; `brownlow_votes` NULL = **NA, never 0**; `afltables_id` nullable (P5 enrichment) | PK on the grain; FK-covering indexes on the composite version key, `player_id`, `club_id`, `season` |

*CHECK constraints.* Goals/behinds/points reconciliation on the match projection
(`points = 6*goals + behinds` where all three are non-NULL), period 1–4 only, the
`brownlow_votes BETWEEN 0 AND 3` range, and a non-negativity check on every statistic.
These mirror `022_match_result_integrity.sql` and `004_player_match_stats.sql`.

*A row is projected only when its identity is proven.* An unresolved player, club or match
gets **no projection row**; it still gets a full spine observation and an
`unresolved_identity` candidate plus an `import_rejections` row. See §19.

**(b) `data_issues` deduplication support.**

```sql
ALTER TABLE data_issues ADD COLUMN issue_key text;

CREATE UNIQUE INDEX uq_data_issues_open_by_key
  ON data_issues (issue_type, issue_key)
  WHERE issue_key IS NOT NULL AND resolved_at IS NULL;

COMMENT ON COLUMN data_issues.issue_key IS
  'Deterministic natural identity of a recurring issue, so a repeated detection refreshes one open row instead of stacking duplicates. NULL for writers that do not use it. Resolved history is unconstrained.';
```

This is the **migration-072 convention** — a partial unique index over unresolved rows only,
on plain columns — adapted for the one way ISSUE-099 differs: `entity_id` is NULL for a
canonical target that does not exist yet (the common case on a clean 2026 database), and
NULL defeats a plain unique index. A nullable added column needs no table rewrite, leaves
every existing row unaffected, and the generic predicate lets any future writer opt in
without ISSUE-099 owning a per-type list.

*Rejected:* a jsonb expression index on `(details->>'issue_key')` plus a shape CHECK. It
works, but it is less self-documenting, indexes worse, and needs a CHECK that touches every
`data_issues` writer's contract.

**(c) FK-covering indexes** for every foreign key the migration creates, so
`tests/integration/fk-indexes.test.ts` stays green.

**(d) Grants and privilege registration.** Following migration 074's pattern:
`GRANT SELECT, INSERT, UPDATE, DELETE` on both staging tables to `afldb_import`, `GRANT
SELECT` to `afldb_app` (the pre-reconcile catch-up), and register both tables in
`tools/maintenance/privileges.sql` so a reconcile keeps them. `data_issues` is an existing
public table; adding a column changes no grant, but `db:privileges:test` is still re-run
after the migration per the standing rule.

### 10.3 Deliberately EXCLUDED from migration 076

Recorded as **future canonical-acceptance-stage prerequisites** (§16), not v1 work:

- `add_provenance_columns('match_period_scores')`
- `add_provenance_columns('brownlow_round_votes')`
- `player_match_stats.source_record_id`
- any widening of migration 073's `data_overrides.entity_type` CHECK

---

## 11. Observation persistence contract

Executed through the extracted `src/lib/acquisition/observation-store.ts`, unchanged in
semantics from the ISSUE-098 implementation.

1. **Every enumerated record is persisted to the spine, whether or not it projects.** This
   is a hard invariant (§19): the record row's `last_seen_at` must advance for a rejected
   record, or the next sweep would falsely mark it absent.
2. `decideObservation()` decides; the store applies. Unchanged content ⇒ **one**
   `UPDATE staging.source_records` (`last_seen_at`, `last_batch_id`, `absent_since = NULL`)
   and **zero** inserts into `source_payloads` / `source_record_versions`.
3. Changed content ⇒ `INSERT … ON CONFLICT DO NOTHING` on the payload, close the previous
   version, append `version_seq + 1`, update the record head.
4. `payload_hash` is the change oracle. `hash_recipe` is stored, so a later change to a
   family's hash exclusions is a reference-data edit, not a migration.
5. `source_updated_at` is **NULL** for both AFL Tables families — AFL Tables publishes no
   upstream mutation timestamp. Fetch time, `observed_from` and `last_seen_at` are never
   substituted.
6. `scope_key` is `season=<year>`; the whole season is enumerated every run.
7. `resolveSourceId()` is the only place a numeric `sources.id` appears; the tracked
   contracts address `afltables` by stable key only.

---

## 12. Reconciliation contract

`reconcile()` is called **per (record, target_table)** with:

| Input | Supplied by ISSUE-099 |
|---|---|
| `contract` | the family's registry contract |
| `head` | the stored open version, read back from PostgreSQL inside the transaction |
| `observed` | `{ present: true, payload, observedAt, knownPayloadHashes, observedColumns }`, or `{ present: false, scopeKey, enumeratedScopeKeys }` **only for a proven-complete enumeration** |
| `identity` | `resolved` (with `ownership`), `new_target`, or `unresolved` — resolved by the settle resolver, never guessed |
| `proposedValues` | the typed projection restricted to the fields this target would write |
| `targetValues` | the canonical row's current values for exactly those fields; `null` for a new target |
| `recordState` | `'played'` — every AFL Tables results row is a completed match, so `rescheduled` can never apply |
| `scheduleFields` | `[]` — consequence of the above |
| `corroboration` | other independence groups' claims (§13.2) |
| `manualAuthority` | `UNAVAILABLE_MANUAL_AUTHORITY` in v1 |

**Ownership supply rule (binding).** For a target table with **no `source_id` column**
(`match_period_scores`, `brownlow_round_votes` — F5) the settle resolver must supply
`{ state: 'indeterminate' }`. It must **never** supply `'unowned'`, which would be a false
claim. `indeterminate` fails closed to `foreign_owned_collision`, which in v1 is a truthful
refusal candidate recording exactly why the target is not yet promotable.

**Verb outcomes and where they land**

| Outcome | Spine | Candidate | `data_issues` | `import_rejections` |
|---|---|---|---|---|
| `unchanged` | head refreshed | none — existing pending candidate untouched | none | none |
| `history_only` | version appended | none created; existing pending candidate left in place (F7) and counted | none | none |
| `new` / `corrected` | version appended | insert or refresh-in-place | none | none |
| `rescheduled` | n/a — `recordState` is always `'played'` | n/a | n/a | n/a |
| `absent` | `absent_since` stamped | **none — see §18.2** | none | none |
| `unresolved_identity` | version appended | refusal candidate | none — `import_rejections` is the record | one row |
| `foreign_owned_collision` | version appended | refusal candidate | none — the candidate is the record | none |
| `source_disagreement` | version appended | refusal candidate | **one open row, deduplicated (§13)** | none |
| `manual_authority_conflict` | version appended | refusal candidate | none | none |
| `stale_review` | — | refusal, requeue | none | none |

*Note on idempotence.* Because `reconcile()` returns `unchanged` before identity is
evaluated, a persistently unresolved record produces a candidate only on the run where its
payload changed. On subsequent unchanged runs the existing pending candidate simply remains
pending. This is correct and is what makes reruns free of duplicate review items.

---

## 13. `data_issues` disagreement contract

`AFLDB-ISSUE-096` Decision C names `data_issues` for exactly one case —
`source_disagreement`. ISSUE-099 implements exactly that and nothing more.

### 13.1 Shape

| Column | Value |
|---|---|
| `entity_type` | the canonical target table (`matches`, `player_match_stats`, …), matching `promotion_candidates.target_table` and `data_overrides.entity_type` |
| `entity_id` | the canonical row id, **NULL for a target that does not exist yet** |
| `issue_type` | `'source_disagreement'` |
| `issue_key` | `afltables\|<family>\|<external_record_id>\|<target_table>` — the natural identity and the dedup key (§10.2b) |
| `severity` | `warning`; **`error`** on a score-field disagreement for a completed match |
| `description` | human-readable one-line summary |
| `details` | `{ owner: 'AFLDB-ISSUE-099', source_key: 'afltables', family, external_record_id, target_table, source_version_seq, agreeing_groups, disagreeing_groups, conflicts: [{ field, afltables, <group>: value }] }` |

### 13.2 Where the disagreeing evidence comes from

Other providers' claims are read from the **typed projection**
`staging.external_current_matches` (migration 063), never from the jsonb spine — Decision B.
Comparison is restricted to the shared canonical fields of the `matches` target:
**`home_score`, `away_score`, `attendance`**. A field the other source does not carry is
simply not shared, which `classifyCorroboration()` already handles.

Corroboration counts **independence groups**, never source rows. Agreement is recorded for
the reviewer and **authorises nothing** — provider independence is not proven-distinct
ultimate authority (`AFLDB-ISSUE-096` §15.3).

### 13.3 Lifecycle

- **Open:** first detection inserts one row.
- **Recur:** a later run **UPDATEs** the open row's `details`, `severity` and `description`.
  `detected_at` stays at first detection. Never a second row — the partial unique index
  makes a duplicate unrepresentable.
- **Resolve:** `resolved_at = now()`, `resolution = 'source_agreement_restored'` when the
  disagreement no longer reproduces (values now agree, or the other source's observation is
  absent); `resolution = 'reviewed'` when a super admin resolves it. **Never a DELETE.**
- **Ownership:** the settle pass may auto-resolve **only** rows carrying
  `details.owner = 'AFLDB-ISSUE-099'`. This is the ISSUE-090 lesson applied directly — that
  issue's register pass deleted conflicts it did not own.

### 13.4 Deliberately not given a `data_issues` row

`unresolved_identity` (already an `import_rejections` row plus a refusal candidate),
`foreign_owned_collision`, `manual_authority_conflict` and `absent`. Each already has a
durable, deduplicated representation; adding a second would be duplicate bookkeeping with
two writers and two lifecycles. Recorded as a rejected alternative (§29).

---

## 14. Review / promotion-candidate contract

Per target, per `ReconciliationOutcome`:

- **Create or refresh.** `ux_promotion_candidates_pending` is unique on
  `(source_id, family, external_record_id, target_table) WHERE status = 'pending'`, so the
  writer is
  `INSERT … ON CONFLICT (source_id, family, external_record_id, target_table) WHERE status = 'pending' DO UPDATE SET verb, source_version_seq, proposed_fields, baseline_canonical_hash, agreeing_groups, disagreeing_groups, created_by_batch_id`.
  A rerun **refreshes** the single pending row; it never stacks duplicates.
- **`baseline_canonical_hash`** is computed by `promotion-review.ts`'s
  `baselineCanonicalHash()` over **exactly the proposed fields**, using
  `canonicalJson()` — a family's *payload* hash exclusions are never applied to canonical
  values. NULL for a `new` target.
- **`agreeing_groups` / `disagreeing_groups`** are independence groups, from
  `classifyCorroboration()`.
- **`source_version_seq`** is the exact observation version the proposal was derived from,
  so evidence can never be conflated and acceptance can detect that the source moved on.
- **No candidate can be accepted in v1**, and no refusal verb can ever reach `accepted` —
  `promotion_candidates_acceptable_ck` makes that unrepresentable in the schema.
- **No machine retirement (F7).** A candidate that becomes moot is left pending and counted
  as `candidatesMootLeftPending`. No admin decision is ever fabricated, and no empty
  replacement candidate is created.

---

## 15. Explicit v1 canonical-write prohibition

**ISSUE-099 v1 performs ZERO canonical INSERT or UPDATE operations and writes no `'accept'`
`promotion_decisions` row.**

The v1 pipeline terminates at:

> verified AFL Tables snapshot → observation bundle → migration-074 observation persistence
> → typed projection → reconciliation → `promotion_candidates` → idempotent `data_issues`
> → dry-run/apply reporting.

Concretely, in v1 nothing writes to `matches`, `match_period_scores`, `player_match_stats`,
`brownlow_round_votes`, `players`, `clubs`, `venues`, `venue_aliases`, `external_identities`,
`club_seasons`, `brownlow_season_votes`, or `promotion_decisions`.

`canonicalRowsInserted` and `canonicalRowsUpdated` are reported and are **literally 0**,
asserted by an integration test (§24). A non-zero value is stop condition **SC3**.

---

## 16. Future canonical acceptance prerequisites (NOT v1)

Recorded here so the exclusions in §10.3 are not lost. **None is implemented by ISSUE-099
v1, and none justifies schema in migration 076.**

| # | Prerequisite | Owner |
|---|---|---|
| A1 | `add_provenance_columns('match_period_scores')` — without `source_id` the target cannot express ownership (F5) and Decision D's provenance quartet cannot be written | future acceptance stage |
| A2 | `add_provenance_columns('brownlow_round_votes')` — same | future acceptance stage |
| A3 | `player_match_stats.source_record_id` — the one missing quartet member (F5) | future acceptance stage |
| A4 | A representable manual authority for the three player/period-grain targets: migration 073's `data_overrides.entity_type` CHECK covers only `players`, `matches`, `draft_picks` (F9) | **`AFLDB-ISSUE-086`** — its mechanism, not ISSUE-099's |
| A5 | The acceptance/write transaction itself: re-read target, recompute baseline, re-evaluate ownership **and** authority, verify the season is in `in_progress_seasons`, write the row plus its provenance quartet, append the `promotion_decisions` row — all in one `sql.begin` | future acceptance stage, gated on A1–A4 |
| A6 | Ownership handover for 2026 matches already stamped `squiggle/kali` by `--update-matches` (F8) | a reviewed human decision; **never** an automated ownership transfer |
| A7 | A decision on whether acceptance triggers `recomputeClubSeasons` for the in-progress season (F10) | future acceptance stage, adjacent to ISSUE-095/101 |

---

## 17. Per-family projection rules

### 17.1 `afltables.match` → `matches`

Proposed fields: `round_code`, `round_number`, `round_type`, `is_final`, `match_date`,
`match_time`, `venue_id`, `venue_raw`, `home_club_id`, `away_club_id`, `home_goals`,
`home_behinds`, `home_score`, `away_goals`, `away_behinds`, `away_score`, `result`,
`winner_club_id`, `margin`, `attendance`, `attendance_status`, `attendance_source_id`.

- Completeness evidence required before a `new` match may be proposed (this is what
  Squiggle/Kali lacked and ISSUE-098 correctly refused): a `results.csv` row **whose
  goals/behinds reconcile with points and whose margin agrees with the scores**
  (`scan_results` already enforces both), a non-NULL `Venue`, both clubs resolved to
  historical identities, and at least one joined `player_stats` row
  (`MatchFact.has_player_rows`) proving the match was played and supplying the match-grain
  supplements. Anything short of that is not proposed.
- **Attendance** (`AFLDB-2026-API-ACQUISITION.md` §3): repeated at player-match grain and
  deduplicated to match grain by `scan_player_stats`. A blank cell is **no observation**;
  `0` is a legitimate recorded value; **two distinct non-NULL values fail the record closed**
  (in-season this becomes a bundle rejection, not a whole-run abort — F6).
  Non-NULL ⇒ `attendance_status = 'complete'`, `attendance_source_id = afltables`.
  NULL ⇒ `attendance_status = 'not_collected'`, `attendance_source_id = NULL`. This
  satisfies `matches_attendance_status_ck` and `matches_zero_attendance_ck` (migration 020),
  under which a genuine 0 is storable precisely because it cites a source. **NULL is never
  0.**
- **Never** the literal string `'Unknown'` for a venue (the ISSUE-098 defect). `venue_raw`
  always carries the real source string; `venue_id` may be NULL (§6.2).

### 17.2 `afltables.match` → `match_period_scores`

- Source: the 24 `QUARTER_COLUMNS` (`H|A` × `Q1..Q4` × `G|B|P`), cross-validated to agree
  across every player row of the match.
- **Cumulative-to-date, as published** — preserved exactly as the historical importer writes
  them.
- A side/period whose goals, behinds **and** points are all NULL writes **no row**
  (*not recorded* ≠ 0).
- **Extra time:** fitzRoy carries ET columns and the historical path deliberately does not
  import them; `QUARTER_COLUMNS` is periods 1–4 only. ISSUE-099 preserves that exactly and
  **does not invent ET handling**. `match_period_scores.period` remains 1–8 by schema; this
  source writes 1–4.
- **`match_period_scores` is not `player_match_period_stats`.** The latter is a per-quarter
  *player* grain, MISSING from every free source, and is never touched.

### 17.3 `afltables.player_match_stats` → `player_match_stats`

- Proposed fields: `club_id`, `career_game_no`, `jumper_number`, and the 21 statistic
  columns via **`STAT_MAP` by explicit name** (`import_fitzroy_core.py:123-146`).
  **Never by CSV column position.**
- `Time.on.Ground` has no target column and is deliberately not projected.
- **`not recorded` / unavailable ≠ 0.** An empty cell stays NULL through the bundle, the
  projection and the proposal.
- `data/reference/stat-availability.json` remains the coverage authority. All 21 stats are
  `complete` for 2026, so a NULL in a covered stat is **reported** as `nullInCoveredStat`
  and is **not** a refusal — a player can genuinely have an absent value.
- **Participation is never created from unresolved identity.** A `url` unknown to
  `external_identities` (source `afltables`, match_method `afltables_profile_url`) is
  `unresolved_identity`: no projection row, no player created, an `import_rejections` row
  and a refusal candidate for a human.

### 17.4 `afltables.player_match_stats` → `brownlow_round_votes`

- `Brownlow.Votes` is genuine **player-per-match** source data at the correct grain.
- **NA ≠ 0.** A NULL vote produces **no row**, ever.
- Home-and-away rounds only; finals are never polled (`FINALS_CODES` excluded), which is why
  the match grain maps 1:1 onto the round grain.
- Gated by `load_round_vote_seasons()` — 2026 is `pending`, which is admitted.
- One row per `(season, player_id, round_number)`; a duplicate grain fails the record closed.
- **Timing (F11).** In-season AFL Tables publishes no votes until the count. The expected v1
  outcome is **zero Brownlow candidates**, and that is correct, not a defect. Rounds stay
  **pending**: never write `votes = 0` for an unpolled round, never manufacture a
  `played = true, votes = NULL` filler row, and never infer a zero from absence. The family
  observation evidence is retained without claiming any canonical vote fact.
- **`brownlow_season_votes` is independently authoritative and is never written**, and no
  season total is ever derived from a partial round set — an unsafe grain collapse.
- **Required before the Brownlow projection is enabled:** one bounded **offline**
  measurement over the acquired 2026 `player_stats_*.csv` recording the `Brownlow.Votes`
  NA count and the distinct non-NA vote values. **No network rerun of P5.**

---

## 18. Idempotence, correction and absence semantics

### 18.1 Transition table

| Transition | Spine | Typed projection | Candidate | Canonical | Counter |
|---|---|---|---|---|---|
| **A → A** | one `UPDATE staging.source_records`; **0** payloads, **0** versions | refreshed in place (idempotent upsert) | untouched | none | `observationsUnchanged` |
| **A → B** (a projected fact moved) | version appended, previous closed | updated | insert or refresh-in-place | none in v1 | `observationsCorrected`, `candidatesCreated`/`candidatesRefreshed` |
| **A → B → A** | **3 versions over 2 payloads**, strictly ordered | updated back to A | refreshed to the A proposal | none in v1 | as above |
| **payload moved, no projected fact moved** | version appended | updated | none created; an existing pending candidate is **left in place** (F7) | none | `observationsHistoryOnly`, `candidatesMootLeftPending` |
| **present → absent** | `absent_since` stamped, **only inside a proven-complete enumerated scope** | row retained, never deleted | **none — see §18.2** | **none, ever** | `observationsMarkedAbsent` |
| **absent → present** | `absent_since` cleared; a version is appended only if the payload actually changed | refreshed | refreshed if a diff exists | none | `observationsReappeared` |

A repeated nightly run over identical source data performs **zero** canonical writes,
inserts **zero** payload rows, appends **zero** version rows, and creates **zero** duplicate
pending candidates and **zero** duplicate open `data_issues` rows.

### 18.2 Absence creates no promotion candidate

`absent` means exactly three things and nothing more:

1. the observation state changes via `staging.source_records.absent_since`;
2. **no canonical mutation** — absence is never a deletion;
3. **no new promotion proposal is created solely because the source record disappeared.**

**No synthetic or empty `absent` candidate is written.** An absence is reported through the
counters and the operator report, which is where a reviewer sees it.

If an older pending candidate becomes stale or moot after an absence, it is **retained**
under the known migration-074 machine-retirement gap (F7). It is harmless: `evaluateAcceptance`
refuses it with `stale_review` once `source_version_seq` has moved. **No admin decision is
fabricated and no replacement empty candidate is created.**

---

## 19. Rejected-record / absence-sweep invariant (HARD INVARIANT)

> **A source record that was observed must never be marked absent because its projection
> failed.**

The failure mode this forbids:

```
source row observed -> projection rejected -> omitted from bundle
                    -> sweepAbsences() -> FALSELY marked absent
```

**The contract, enforced in three places.**

1. **Presence is enumerated independently of projection.** The bundle's `enumerations` block
   (§8) lists **every** observed `external_record_id` per `(family, scope_key)`, *including
   rows rejected from projection*. Presence and projection are separate facts and are
   carried separately.
2. **Every keyed record reaches the spine.** A record with a provable key but a failed
   projection is still persisted as a full observation — payload, version-or-unchanged,
   and a record-head touch that advances `last_seen_at`. Only the **typed projection row**
   is gated on resolved identity. The next sweep therefore sees it as seen.
3. **An unprovable key disables the sweep, fail-closed.** If a malformed row cannot yield a
   stable key (no `url`, or no `match_key` because the results join failed), its presence
   cannot be represented at all. Python records it in `unkeyed_rejections` and **must** set
   `complete: false` on that `(family, scope_key)`; TypeScript then **skips
   `sweepAbsences()` for that family and scope for that run**, counts it as
   `absenceSweepSkipped`, and reports it. `sweepAbsences()` is already fail-closed against
   an empty scope list (`observations.ts:337-339`), so the scope is simply not passed.

This is a **stop condition** (SC5): any run that marks a record absent while that record
appears in `unkeyed_rejections`, or while its enumeration carries `complete: false`, is a
contract violation.

**Required tests (§24, all four are blocking).**

| # | Assertion |
|---|---|
| I1 | An **observed but rejected** row is **not** marked absent — its `last_seen_at` advanced and `absent_since` stayed NULL. |
| I2 | A **malformed row with no provable key** sets `complete: false` and **prevents the absence sweep** for that family+scope; no record in that scope is stamped. |
| I3 | A **genuine upstream omission** from a **proven-complete** enumeration **is** marked absent. |
| I4 | **Reappearance clears absence** normally, appending no version when the payload is unchanged. |

---

## 20. Provenance and ownership rules

- **Provenance.** v1 writes no canonical row, so it stamps no canonical provenance. Every
  run writes one `import_batches` row (`source_id = afltables`, `tool =
  'settle-afltables.ts'`, `target_table = 'staging.source_record_versions'`) and every
  observation, projection row, candidate and rejection references it.
- **Source containment (Decision E).** A promotion may target a canonical row only where
  `target.source_id IS NULL OR target.source_id = :source_id`. Anything else is
  `foreign_owned_collision` and refuses.
- **Ownership supply rule.** A target table with no `source_id` column is
  `{ state: 'indeterminate' }`, never `'unowned'` (§12).
- **No identity is ever created** — no player, club, venue or venue alias.
- **Manual authority.** `UNAVAILABLE_MANUAL_AUTHORITY` (answers `indeterminate`, which
  refuses) is the provider in v1. Provider agreement is never manual authority. There is no
  force flag, no override, no consensus shortcut and no bypass anywhere in this design.
- **The settle pass never erases another source's evidence.** It reads
  `staging.external_current_matches` for corroboration and writes only its own
  `(source_id = afltables, family = afltables.*)` spine rows. The absence sweep is scoped by
  `(source_id, family, scope_key)` and can never reach a Squiggle or Kali row. If AFL Tables
  disagrees with an independent source, the disagreement stays **reviewable** — it is never
  resolved by whichever importer ran last.

---

## 21. Failure and transaction boundaries

| Stage | Class | Failure behaviour |
|---|---|---|
| **S-A** | network / R acquisition | Writes CSVs, then the manifest **last**. A failure leaves no manifest, so no snapshot is consumable. **PostgreSQL is never opened.** |
| **S-B** | offline verification + emit (Python) | SHA-256, header, row-count, range, required-column, in-season and scan gates. Any failure writes **no bundle**. **PostgreSQL is never opened.** |
| **S-C** | bundle contract validation (TypeScript) | Version, manifest re-hash, label, acquisition kind, season, family/column contract, enumeration consistency (§8). Any failure refuses. **Still no PostgreSQL.** |
| **S-D** | PostgreSQL work | **One `sql.begin`**, mirroring the existing `writeMatches` envelope. Any error rolls back **everything, including the `import_batches` row**, so no batch can claim success and no decision can claim a write that did not happen. |
| **S-E** | canonical acceptance | **Not built in v1.** When built: one `sql.begin` per accepted candidate, re-running every gate inside it. |

A network or acquisition failure cannot mutate PostgreSQL. A malformed or unverified
snapshot cannot mutate PostgreSQL. There is no partial commit.

---

## 22. Dry-run semantics

**`--dry-run` executes the same write-capable PostgreSQL transaction and the same
ISSUE-099 observation / reconciliation / candidate / `data_issues` code path as `--apply`,
collects the real counters and results, and then deliberately rolls the entire transaction
back.**

It is **not** a read-only or simulated path. Consequences, all deliberate:

- real constraints, unique indexes, foreign keys and role privileges are exercised — a
  dry-run that passes proves the apply would too;
- **zero ISSUE-099-owned state survives** a dry-run;
- the `import_batches` row rolls back with everything else;
- canonical writes remain impossible in both modes under §15 — dry-run does not relax D2,
  and apply does not extend it.

The rollback uses the repository's existing deliberate-rollback pattern
(`tests/integration/database.test.ts`: `sql.begin` + a thrown `Rollback` sentinel).

**Required regression (§24):** after a `--dry-run` against a seeded `afldb_test`, every
ISSUE-099-owned relation — `staging.source_payloads`, `staging.source_record_versions`,
`staging.source_records`, `staging.afltables_match`, `staging.afltables_player_match`,
`promotion_candidates`, `promotion_decisions`, `data_issues`, `import_batches`,
`import_rejections` — is **byte-identical** to its pre-run state (row counts and content
digests), and the four canonical targets are unchanged.

---

## 23. Operator workflow and counters

### 23.1 Workflow

```bash
# 1. acquire — network; writes files only, manifest last
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --in-season \
  --label settle-2026-08-29 --from 2026 --to 2026 --datasets player_stats,results

# 2. adjudicate offline — no database
.venv/bin/python tools/migration/import_fitzroy_core.py \
  --label settle-2026-08-29 --validate-only --require-in-season

# 3. emit the observation bundle — no database
.venv/bin/python tools/migration/import_fitzroy_core.py \
  --label settle-2026-08-29 --require-in-season --on-record-error reject \
  --emit-observations data/sources/afltables/fitzroy_core/settle-2026-08-29/observations.json

# 4. dry run — real transaction, deliberately rolled back
npx tsx tools/current-season/settle-afltables.ts --label settle-2026-08-29 --dry-run

# 5. apply — observations, projections, candidates, data_issues. NO canonical write.
npx tsx tools/current-season/settle-afltables.ts --label settle-2026-08-29 --apply

# 6. review the queue — --label is REQUIRED: the report reads the season from the
#    validated bundle, and a report with no bundle would be reporting on nothing
npx tsx tools/current-season/settle-afltables.ts --label settle-2026-08-29 --report
```

**Review-first is the default**: `--dry-run` requires no flag beyond itself, and `--apply`
must be explicit. **Nothing is scheduled by this issue** — no cron entry, no systemd timer.
Scheduling is a separate authorisation.

### 23.2 Counters

Reported by the CLI and stored in `import_batches.validation_result`. Observation counters
and canonical counters are **never summed under one name**, and no counter may decrement.

**Snapshot** — `snapshotMatches`, `snapshotPlayerMatchRows`, `snapshotRejections`,
`snapshotUnkeyedRejections`.

**Observation** — `observationsSeen`, `payloadsCreated`, `payloadsReused`,
`versionsAppended`, `observationsUnchanged`, `observationsCorrected`,
`observationsHistoryOnly`, `observationsMarkedAbsent`, `observationsReappeared`,
`absenceSweepSkipped`.

**Two grains sit under that one heading, and they are not interchangeable** (clarified at T8;
documentation only, no behaviour changed):

| Grain | Counters | Incremented in |
|---|---|---|
| **Per source record** (spine grain) | `observationsSeen`, `payloadsCreated`, `payloadsReused`, `versionsAppended`, `observationsMarkedAbsent`, `observationsReappeared` | `settleFamily()`, once per record |
| **Per (record, target) outcome** (reconciliation grain) | `observationsUnchanged`, `observationsCorrected`, `observationsHistoryOnly` | `recordOutcome()`, once per established target |

The second group is named after `reconcile()`'s verbs, and `reconcile()` is **per target** by
§12's design — each target carries its own identity, ownership and proposed values, and §18.1's
"Typed projection" and "Candidate" columns are already per-target. So
`observationsUnchanged` **legitimately exceeds `observationsSeen`** whenever a family has more
than one established target per record, and no invariant here says otherwise: the stated rules
are that observation and canonical counters are never summed under one name, and that no
counter may decrement. Both hold.

The flaw is the shared **name**, not the arithmetic. It is recorded rather than renamed:
`tests/integration/settle-afltables.test.ts` has asserted the per-target grain since T6
(`observationsUnchanged` = 5 over a 3-record bundle), and renaming a counter that reports the
truth would change a signed-off contract for no integrity gain.

**Projection / resolution** — `projectionRowsWritten`, `venueUnmapped`,
`nullInCoveredStat`, `unresolvedIdentity{player,club,venue,match}`,
`foreignOwnedCollision`, `sourceDisagreement`, `manualAuthorityRefusals`.

**Review** — `candidatesCreated`, `candidatesRefreshed`, `candidatesMootLeftPending`.

**Data issues** — `dataIssuesOpened`, `dataIssuesRefreshed`, `dataIssuesResolved`.

**Canonical** — `canonicalRowsInserted: 0`, `canonicalRowsUpdated: 0`. Literally zero in v1
and asserted (§15).

---

## 24. Test / validation matrix

Reusing the closest existing semantic homes per `CLAUDE.md` §10.

| Layer | Home | Coverage |
|---|---|---|
| Acquisition / manifest, DB-free | `tests/fitzroy-acquisition.test.ts` | `--in-season` mode; single-season and in-progress-season requirement; `acquisition_kind: in_season_partial`; **an in-season manifest can never satisfy full-history or the accepted-baseline register** |
| Source contract, DB-free | `tests/fitzroy-core-import.test.ts` | `enforce_in_season()` gates; `--require-full-history` / `--require-accepted-baseline` refuse `in_season_partial`; bundle contract shape; `--on-record-error` default is `abort` |
| Python behaviour, DB-free | **new** `tests/python/settle_emit_contract.py` (the `reference_cascade_contract.py` behavioural precedent) | `--on-record-error reject` collects rather than aborts; **I1/I2** enumeration completeness; `STAT_MAP` fidelity by name; attendance dedupe and fail-closed conflict; NULL/NA preserved; Brownlow NA produces no row; quarter/ET handling |
| Registry + reconciliation, DB-free | `tests/current-season-import.test.ts` | the two AFL Tables families parse; projection gate refuses drift; per-target reconciliation cases; ownership-`indeterminate` supply rule; corroboration field set; `issue_key` derivation; bundle validation refusals |
| Reference data | `tests/reference-data.test.ts` | registry cross-references; no family declares reviewed promotion without a `sources` row |
| Migration / catalogue | `tests/integration/fk-indexes.test.ts`, `tests/integration/privileges.test.ts` | every 076 FK is covered; the two staging tables carry the intended grants and survive a reconcile |
| Spine, PostgreSQL | `tests/integration/observation-spine.test.ts` | unchanged; still 13/13 |
| **Settle, PostgreSQL** | **new** `tests/integration/settle-afltables.test.ts` | idempotent rerun (0 payloads, 0 versions, 0 new candidates, 0 new `data_issues`); **A→B→A**; **I1–I4**; candidate refresh-in-place under the pending unique index; `data_issues` open/refresh/resolve with ownership scoping and no duplicate; **`canonicalRowsInserted`/`Updated` are 0 as a runtime fact**; **dry-run leaves every ISSUE-099-owned relation byte-identical** (§22); restricted `afldb_import` role parity |
| Bounded real acquisition | operator-run | one 2026 `--in-season` acquisition; record `url` NA, `ID` NA, and the **F11 `Brownlow.Votes` NA measurement** |
| Bounded end-to-end proof | operator-run, `afldb_test` only | dry-run, apply, apply-again; counters stable; zero canonical rows |

Escalate only as far as needed. **No full rebuild and no broad release-gate suite** is part
of this ladder.

---

## 25. Risks and stop conditions

### Stop conditions

- **SC1** — the acquired snapshot's `url` NA count is non-zero, or a `url` maps to two
  `ID`s. The P5 identity contract has broken. **Stop.**
- **SC2** — `--require-full-history` or `--require-accepted-baseline` accepts an in-season
  snapshot in any test. The historical fail-closed contract has been weakened. **Stop.**
- **SC3** — any v1 run reports `canonicalRowsInserted` or `canonicalRowsUpdated` non-zero,
  or writes an `'accept'` `promotion_decisions` row. §15 violated. **Stop.**
- **SC4** — a rerun over identical data creates a second version row, a second pending
  candidate, or a second open `data_issues` row. **Stop.**
- **SC5** — a record is marked absent while it appears in `unkeyed_rejections`, or while its
  enumeration carries `complete: false`, or while it was observed and only its projection
  failed. §19 violated. **Stop.**
- **SC6** — a dry-run leaves any ISSUE-099-owned relation changed. §22 violated. **Stop.**
- **SC7** — implementation evidence materially contradicts this runbook, or exposes a new
  unresolved architecture or data-integrity decision. **Stop and return to a fresh Opus High
  planning session. Do not improvise.**

### Risks

- **R1 (F8)** — on a database where the current-season importer has re-stamped
  `matches.source_id`, every settle proposal is a `foreign_owned_collision`. Expected on
  `afldb_dev`; not present on a canonically rebuilt `afldb_test`. Resolution is A6 — a
  reviewed human decision, never an automated transfer.
- **R2 (F6)** — an in-season pass left on `--on-record-error abort` dies on one bad record.
  The CLI must pass `reject` and the report must make rejections prominent.
- **R3 (F11)** — Brownlow: expect **zero** candidates in-season. Never a `0`, never a
  filler row.
- **R4** — a round-1 settle produces many `unresolved_identity` debutant rows. A new player
  is always a human decision and is not ISSUE-099's to automate.
- **R5 (F5)** — `match_period_scores` and `brownlow_round_votes` proposals against an
  existing canonical row always refuse as `foreign_owned_collision` until A1/A2 land. In v1
  this is correct and truthful; it becomes a blocker only at the acceptance stage.
- **R6 (F7)** — the pending queue accumulates moot candidates that no machine may retire.
  Harmless, and bounded by the pending unique index to one per (record, target).

---

## 26. Staged implementation plan — T1 … T8

| Stage | Deliverable | Gate |
|---|---|---|
| **T1** | `acquire_core.R --in-season`: exactly one season, that season must be in `seasons.json.in_progress_seasons`, `acquisition_kind: "in_season_partial"`, new `in_season` block in `fitzroy-contract.json`. Full-history and witness paths untouched. | `tests/fitzroy-acquisition.test.ts` |
| **T2** | `enforce_in_season()` + `--require-in-season`; `--require-full-history` and `--require-accepted-baseline` explicitly refuse `in_season_partial`, and vice versa. | `tests/fitzroy-core-import.test.ts` |
| **T3** | `--emit-observations` + `--on-record-error {abort,reject}` (default `abort`); the §8 bundle including the `enumerations` / `unkeyed_rejections` presence contract. Record the **F11 offline `Brownlow.Votes` measurement** here. | `tests/fitzroy-core-import.test.ts`, `tests/python/settle_emit_contract.py` (incl. I1/I2) |
| **T4** | Registry: add `afltables.match`; upgrade `afltables.player_match_stats` to `declared` + `promotion_policy: "reviewed"`. | `tests/reference-data.test.ts`, `tests/current-season-import.test.ts` |
| **T5** | **Migration 076** exactly as §10.2 — two typed projections, `data_issues.issue_key` + partial unique index, FK-covering indexes, grants + `privileges.sql` registration. Nothing from §10.3. | `db:migrate:test --status`, `db:migrate:test`, `db:privileges:test`, `fk-indexes.test.ts`, `privileges.test.ts` |
| **T6** | Extract `observation-store.ts` from `current-season-import.ts` (behaviour-preserving; existing suite stays 106/106), then build `src/lib/acquisition/settle-afltables.ts` + `tools/current-season/settle-afltables.ts` with bundle validation, projection, reconciliation and candidate writing. | `tests/current-season-import.test.ts`, then `tests/integration/settle-afltables.test.ts` |
| **T7** | `data_issues` writer / refresher / resolver with ownership scoping; dry-run and apply reporting with the §23.2 counters. | `tests/integration/settle-afltables.test.ts` (incl. I3/I4, dry-run invariance, zero-canonical assertion) |
| **T8** | One bounded real 2026 `--in-season` acquisition, then one bounded end-to-end `afldb_test` proof: dry-run → apply → apply-again. | operator-run |

---

## 27. Files expected to change

| File | Change |
|---|---|
| `tools/rebuild/fitzroy/acquire_core.R` | `--in-season` mode |
| `tools/rebuild/fitzroy/fitzroy-contract.json` | `in_season` block |
| `tools/migration/import_fitzroy_core.py` | `enforce_in_season()`, `--require-in-season`, `--emit-observations`, `--on-record-error` |
| `data/reference/source-families.json` | `afltables.match`; `afltables.player_match_stats` → `declared` / `reviewed` |
| `src/db/migrations/076_afltables_settle_projections.sql` | **new** |
| `src/lib/acquisition/observation-store.ts` | **new** — extracted, behaviour-preserving |
| `src/lib/acquisition/settle-afltables.ts` | **new** |
| `src/lib/external-afl/current-season-import.ts` | re-point at the extracted store **only** |
| `tools/current-season/settle-afltables.ts` | **new** CLI |
| `tools/maintenance/privileges.sql` | register the two staging projections |
| `tests/fitzroy-acquisition.test.ts`, `tests/fitzroy-core-import.test.ts`, `tests/reference-data.test.ts`, `tests/current-season-import.test.ts`, `tests/integration/fk-indexes.test.ts`, `tests/integration/privileges.test.ts` | extended |
| `tests/integration/settle-afltables.test.ts`, `tests/python/settle_emit_contract.py` | **new** |
| `AFLDB-ISSUE-099.md`, `issues.md`, `IssuesIndex.md` | tracking |
| `CHANGELOG.md` | **only** when behaviour lands — not in planning |

**Not touched:** migrations 073/074/075; any other issue's entry; production; `afldb_dev`.

---

## 28. Exact focused verification commands

```bash
# DB-free
npm test -- tests/fitzroy-acquisition.test.ts
npm test -- tests/fitzroy-core-import.test.ts
npm test -- tests/reference-data.test.ts
npm test -- tests/current-season-import.test.ts
.venv/bin/python -m pytest tests/python/settle_emit_contract.py

# migration + catalogue (afldb_test ONLY)
npm run db:migrate:test -- --status
npm run db:migrate:test
npm run db:privileges:test
npm test -- tests/integration/fk-indexes.test.ts
npm test -- tests/integration/privileges.test.ts

# PostgreSQL behaviour (afldb_test ONLY)
npm test -- tests/integration/observation-spine.test.ts
npm test -- tests/integration/settle-afltables.test.ts

# bounded real acquisition + end-to-end proof
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --in-season \
  --label settle-2026-08-29 --from 2026 --to 2026 --datasets player_stats,results
.venv/bin/python tools/migration/import_fitzroy_core.py \
  --label settle-2026-08-29 --validate-only --require-in-season
.venv/bin/python tools/migration/import_fitzroy_core.py \
  --label settle-2026-08-29 --require-in-season --on-record-error reject \
  --emit-observations data/sources/afltables/fitzroy_core/settle-2026-08-29/observations.json
npx tsx tools/current-season/settle-afltables.ts --label settle-2026-08-29 --dry-run
npx tsx tools/current-season/settle-afltables.ts --label settle-2026-08-29 --apply
npx tsx tools/current-season/settle-afltables.ts --label settle-2026-08-29 --apply   # idempotence
```

---

## 29. Rejected alternatives

| Rejected | Why |
|---|---|
| **Reimplement the 074 spine, the ten verbs and the candidate contract in Python** | A second implementation of one contract. Exactly the acquirer/validator drift ISSUE-093 §H11 was burned by. |
| **Reimplement the AFL Tables scan layer (`ClubResolver`, `STAT_MAP`, attendance dedupe, corrections) in TypeScript** | Same objection, other direction: a second implementation of the source contract. |
| **Reuse `import_matches` / `import_player_match_stats` / `import_brownlow_round_votes` with a narrowed range** | They upsert without an ownership predicate and delete by match/season (F4). Correct for a clean rebuild; a destructive unreviewed writer in-season. |
| **Reuse `import_venues` / `import_players`** | They create identities. No source may create an identity. |
| **Resurrect a `partial` snapshot label** | `acquire_core.R` no longer emits one (F1); a third `acquisition_kind` plus its own adjudicator is the current shape. |
| **Relax `enforce_full_history()` to admit a narrowed range** | Would weaken the historical fail-closed contract. The in-season path opts in explicitly instead. |
| **Separate `attendance` and `match_period_scores` families** | They come from one AFL Tables match observation. 074's `target_table` dimension is the designed way to express multiple targets from one record. |
| **Add provenance columns to `match_period_scores` / `brownlow_round_votes` in v1** | v1 makes no canonical write, so nothing in v1 needs them. Recorded as acceptance-stage prerequisites A1–A3 (§16). |
| **Create a synthetic empty `absent` promotion candidate** | Absence is observation state, not a proposal. A candidate implies something to review and write; there is nothing. |
| **Machine-retire a moot candidate** | Requires an `admin_user_id` on `promotion_decisions` (F7). Fabricating an admin decision is forbidden. |
| **A jsonb expression index on `details->>'issue_key'` for `data_issues` dedup** | Works, but is less self-documenting, indexes worse, and needs a shape CHECK touching every `data_issues` writer. A nullable plain column plus a partial unique index matches migration 072's convention. |
| **Give `unresolved_identity` / `foreign_owned_collision` their own `data_issues` rows** | Each already has a durable deduplicated representation (`import_rejections`, the refusal candidate). Duplicate bookkeeping with two lifecycles. |
| **Describe dry-run as read-only** | It would then prove nothing about constraints, privileges or the real code path. Same transaction, same code path, deliberate rollback. |
| **Widen `data_overrides.entity_type` from inside ISSUE-099** | ISSUE-086 owns that mechanism. Recorded as prerequisite A4. |
| **Auto-promote because AFL Tables and Squiggle/Kali agree** | Provider agreement is never manual authority, and provider independence is not proven-distinct ultimate authority (ISSUE-096 §15.3). |
| **Complete the `afltables_2026` round vocabulary** | The settle never compares rounds across vocabularies (§6.3). Work with no consumer. |

---

## 30. Unresolved future decisions, and tracking

### 30.1 Unresolved

| # | Decision | Owner / when |
|---|---|---|
| **U1** | Manual authority for `player_match_stats`, `match_period_scores`, `brownlow_round_votes` (A4, F9) | `AFLDB-ISSUE-086`; required before the acceptance stage |
| **U2** | 2026 `Brownlow.Votes` coverage (F11) | closed by one offline measurement in **T3**; not a blocker for T1–T2 |
| **U3** | Machine candidate retirement (F7) | forward gap; a later schema decision, never a fabricated admin decision |
| **U4** | Whether canonical acceptance triggers `recomputeClubSeasons` for the in-progress season (A7, F10) | acceptance stage; adjacent to ISSUE-095 / ISSUE-101 |
| **U5** | Ownership handover for 2026 matches already stamped `squiggle`/`kali` (A6, F8) | a reviewed human decision at deployment time |

### 30.2 Superseded wording corrected in tracking

`issues.md` and `IssuesIndex.md` carried two statements that current evidence contradicts.
Both were corrected in place with the superseded text retained as lineage:

1. *"Implementation is gated on evidence probe **P5** … If P5 shows AFL Tables lacks stable
   `ID`/`url` for 2026, implementation is blocked."* — **Superseded.** P5 ran on 2026-08-28
   and **PASSED**; the stop condition was **not** triggered; the binding correction is to key
   on `url`, not `ID` (§2.1).
2. *"partial fitzRoy acquisition … producing a snapshot labelled `partial`, which normal
   rebuild mode correctly refuses."* — **Superseded.** `acquire_core.R` no longer emits a
   `partial` label (F1). The in-season path is a third `acquisition_kind` with its own
   adjudicator (§10.1).

**`CHANGELOG.md` was not updated** — this is a planning-only session with no retained
behaviour change.

---

## 31. Implementation handoff

| Field | Value |
|---|---|
| Session | **Fresh** |
| Model | **Opus** |
| Effort | **High** |
| Mode | **Normal** (not plan mode) |
| Working directory | `D:\dev\afldb-issue-099` |
| Branch | `claude/issue-099` |
| Carry-over file | **`AFLDB-ISSUE-099.md`** (this file) |
| Start at | **T1** (§26) |

If implementation evidence materially contradicts this runbook, or exposes a new unresolved
architecture or data-integrity decision, **stop rather than improvising** and return to a
fresh Opus High planning session (SC7).

---

## 32. Implementation log

> Appended by the implementation session. Each stage records what was built, what changed
> from the plan and why, and the evidence that closed it.

### T1 — `acquire_core.R --in-season` (implemented 2026-08-28, AWAITING VALIDATION)

**Implemented.**

1. **`tools/rebuild/fitzroy/fitzroy-contract.json`** — new top-level `in_season` block
   (`contract_in_season_version: 1`). It declares the third `acquisition_kind`
   (`in_season_partial`), `single_season: true`, the season source
   (`data/reference/seasons.json in_progress_seasons`), `required_datasets` /
   `allowed_datasets` = `["player_stats", "results"]`, an `excluded_datasets` block naming
   `player_details` and `ladder` with the reason for each, twelve `completeness_gates` for
   T2's adjudicator to re-derive, a `never_admissible_for` block naming
   `--require-full-history`, `--require-accepted-baseline` and the accepted-baseline
   register, and its own `identity_requirement`. The `full_history` block is **untouched**.
2. **`tools/rebuild/fitzroy/acquire_core.R`** — new opt-in `--in-season` flag. With the flag
   absent every existing path is behaviourally unchanged. With it present: `--from` must
   equal `--to`; that season must appear in `seasons.json.in_progress_seasons` (read from
   the new `SEASONS_PATH` constant); `--datasets` defaults to the contract's
   `required_datasets` and any dataset outside `allowed_datasets` is refused; the season
   accounting is scoped to the requested season via the new `scoped_range` predicate; the
   manifest gains `contract_in_season_version` and an `in_season` block (season, datasets,
   matches, `player_match_rows`, `rounds_observed`, `round_types_observed`,
   `never_admissible_for`), `acquisition_kind: "in_season_partial"`, and
   `verdict_authority: "… --label <L> --validate-only --require-in-season"`.
3. **`tests/fitzroy-acquisition.test.ts`** — nine new assertions across two new describe
   blocks (contract level and adapter level).

**Amendments to the plan — none material.** Three implementation choices the runbook left
open, recorded for T2:

- **A1.** The `in_season` block carries its own `identity_requirement`
  (`required_columns: ["url"]`, `enrichment_columns: ["ID"]`) rather than reusing
  `full_history.identity_requirement`, which requires **both** `ID` and `url`. This is the
  §2.1 P5 binding consequence expressed as tracked contract data, and is what T2's
  `enforce_in_season()` must read. The `full_history` requirement is deliberately left
  stricter and unchanged.
- **A2.** `--in-season` **refuses** a dataset outside `allowed_datasets` (structural
  precondition) but a **missing** required dataset stays an *observation*
  (`datasets_complete: false`), adjudicated by `--require-in-season` in T2. This preserves
  F1: the acquirer establishes the shape of the run and never issues a verdict.
- **A3.** The scoped season accounting reuses the ISSUE-095 witness repair rather than
  relaxing a core gate. Measuring one in-progress season against the 1897–2025 core range
  would have reported 129 missing seasons for a run that acquired everything it claimed —
  the same defect the witness repair exists to prevent. `scoped_range = witness_only ||
  in_season`; core snapshots are unaffected.

**Rejected during T1.**

- *Resurrecting a `partial` completeness label* — already rejected in §29 (F1); the third
  `acquisition_kind` plus its own adjudicator is the current shape.
- *Letting `--in-season` default to `player_stats,player_details,results`* — the default
  would have refused itself against `allowed_datasets`. The in-season default is the
  contract's `required_datasets`.
- *Recording `identity_observations: "not_applicable"` for an in-season run* — an in-season
  snapshot **does** acquire `player_stats`, and the `url` / `ID` NA counts are the live
  evidence for stop condition **SC1**. The measurement is retained; only a witness reports
  `not_applicable`.

**T1 VALIDATED — GREEN 2026-08-28, user-run.** `npm test -- tests/fitzroy-acquisition.test.ts`
— **1 file, 23/23 passed, 0 failures, 839 ms.** ISSUE-099 evidence within that run: the
in-season acquisition **contract** block 6/6 and the in-season acquisition **adapter** block
3/3 — third acquisition kind and its own adjudicator declared; exactly one in-progress
season enforced; witness datasets excluded; an in-season snapshot admissible to neither
`--require-full-history` nor the accepted-baseline register; player identity keyed on the
profile `url` with `ID` enrichment-only; and the existing full-history contract assertions
still green and untouched. (`npm ci` was run first because the fresh worktree had no
`node_modules` — environment setup, not ISSUE-099 evidence.)

**T1 is CLOSED.** Next: T2.

### T2 — `enforce_in_season()` + `--require-in-season` (implemented 2026-08-28, AWAITING VALIDATION)

**Implemented** — all in `tools/migration/import_fitzroy_core.py`, plus its gate suite.

1. **`acquisition_kind(manifest)`** — one reader for the manifest field. A manifest
   predating the field reads as `core_snapshot` (it is one by construction), **never** as
   "unknown, allow". Kind constants `CORE_SNAPSHOT_KIND` / `VALIDATION_WITNESS_KIND` /
   `IN_SEASON_KIND` are declared once.
2. **`refuse_in_season_for_historical(manifest, gate)`** — the explicit symmetric refusal.
   Called **first** inside `enforce_full_history()`, and in `main()` **before the acceptance
   register is opened**. An in-season partial is therefore refused for *what it is*, not
   incidentally for the range it covers, and never surfaces as the misleading "is not the
   accepted baseline".
3. **`load_in_progress_seasons()`** — reads `data/reference/seasons.json`; refuses an empty
   or missing register. The season authority is tracked reference data, never the clock.
4. **`measure_identity_coverage(entries, snapshot_dir, id_rule)`** — **extracted verbatim**
   from `enforce_full_history()` so one implementation of the identity contract serves both
   gates. Behaviour-preserving: same counters, same URL-shape source, same fail-closed
   refusal on `missing_url` / `malformed_url`, same tolerance of an absent `ID`.
5. **`enforce_in_season(manifest, snapshot_dir, contract)`** — the in-season adjudicator,
   built as the mirror of `enforce_full_history()` and re-deriving every gate from the
   contract's `in_season` block, `seasons.json` and the artefacts: kind must be
   `in_season_partial`; `requested_range` must be exactly one season; that season must be
   in `in_progress_seasons`; required datasets present; **no** dataset outside
   `allowed_datasets`; exactly one `player_stats` artefact, for that season; no zero-row
   artefact; then the shared identity measurement.
6. **`--require-in-season`** — new flag. Combining it with `--require-full-history` or
   `--require-accepted-baseline` is an argparse refusal, not a silent precedence.
7. **Offline-only guard.** `--require-in-season` **refuses before any database work**, after
   the `--validate-only` return. `validate_snapshot()` is reused unchanged (F2).

**Amendment A4 — the offline-only guard (added, and why it is in scope).** §26 T2 lists only
the gates, but shipping `--require-in-season` without this guard would have left
`import_fitzroy_core.py --label <in-season label> --require-in-season` (no `--validate-only`)
running the **canonical** `import_matches` / `import_player_match_stats` /
`import_brownlow_round_votes` writers over an in-season snapshot — the exact F4 writers §15
forbids, with no ownership predicate and a `DELETE … WHERE match_id = ANY(...)`. The guard is
the smallest correct closure of that hole, is fail-closed, and adds no capability. T3's
`--emit-observations` will return before it, since emitting the bundle is also offline.

**Rejected during T2.**

- *Refusing every non-`core_snapshot` kind from `enforce_full_history()`* — stricter than the
  approved §10.1, and `validation_witness` handling is ISSUE-095's. Only `in_season_partial`
  is refused explicitly; other kinds keep failing on the existing gates.
- *A second identity-coverage measurement for the in-season gate* — that is the
  acquirer/validator drift ISSUE-093 §H11 was burned by, in miniature. Extracted and shared
  instead; a test pins that exactly one implementation exists and that both gates call it.
- *Letting `--require-in-season` silently win over `--require-full-history`* — a run asking
  for both is asking for a contradiction. It is refused.
- *Deriving "in progress" from the current date* — `seasons.json` is the one authority, and a
  clock-derived answer would make the gate non-deterministic across runs.

**New test coverage** (`tests/fitzroy-core-import.test.ts`, new
`in-season completeness gates (AFLDB-ISSUE-099)` block, 11 cases): a valid in-progress
single-season snapshot passes; a non-`in_season_partial` manifest is refused; a multi-season
range is refused; a **completed** season is refused whatever the manifest claims (**SC2**
guard); a disallowed dataset is refused; an absent `ID` is tolerated while an absent `url` is
not (**P5**); `--require-full-history` and `--require-accepted-baseline` refuse an in-season
partial **explicitly** rather than by range or by label; the gates cannot be combined; the
database import path is never reached; the contract the gate re-derives is pinned; and one
implementation of the identity-coverage contract is pinned. `resultsRow()` gained an opt-in
`season` parameter defaulting to 2024, so every existing fixture is unchanged.

**T2 VALIDATED — GREEN 2026-08-28, user-run.** `npm test -- tests/fitzroy-core-import.test.ts`
— **1 file, 81 cases: 77 passed, 4 skipped, 0 failed, 5.88 s.** The new
`in-season completeness gates (AFLDB-ISSUE-099)` block is **12/12**: a valid single
in-progress-season `in_season_partial` snapshot passes; a wrong acquisition kind is refused;
a multi-season range is refused; a **completed** season is refused whatever the manifest
claims (SC2 guard); an undeclared in-season dataset is refused; a missing fitzRoy `ID` is
tolerated while a missing profile `url` is refused (**P5 preserved**);
`--require-full-history` and `--require-accepted-baseline` each refuse `in_season_partial`
**explicitly**; the historical and in-season gates cannot be combined; and
`--require-in-season` **never reaches the database import path**. The existing
full-history and accepted-baseline blocks stayed green, so the historical fail-closed
contract is unweakened. The 4 skips are pre-existing source-correction / real-data cases,
unrelated to T2.

**Amendment A4 is VALIDATED by execution:** an in-season invocation cannot fall through into
the historical canonical writers.

**T2 is CLOSED.** Next: T3.

### T3 — `--on-record-error` + `--emit-observations` (implemented 2026-08-28, AWAITING VALIDATION)

**Implemented** — `tools/migration/import_fitzroy_core.py`, plus a new behavioural gate.
Still **zero PostgreSQL**: nothing in this stage persists an observation, computes a
reconciliation verb, creates a promotion candidate or touches a canonical table.

1. **`RecordErrorPolicy` / `RecordRejection`.** `abort` (the default) re-raises the original
   exception, so the historical rebuild path is unchanged. `reject` collects the failure and
   the pass continues. A `RecordRejection` carries `external_record_id = None` when **no
   stable key could be established at all** — the materially different case §19 turns on.
   An unknown policy name is refused, never defaulted.
2. **`interpret_results_row()`** — extracted from `scan_results()` without changing a check,
   a message, or the order they run in. `scan_results(path, clubs, policy=None)` wraps it in
   one try/except; with no policy the exception propagates exactly as before.
3. **`scan_player_stats(..., policy=None)`** — same treatment, plus one structural change:
   the match-grain mutations (`attendance`, `match_time`, `quarters`, `has_player_rows`,
   `seen_player_match`) moved **below the last validation** into a commit block. Validation
   order — and therefore which error a bad row raises — is unchanged; what changes is that a
   **rejected record now leaves no partial trace** in the match it belongs to.
4. **Aggregate identity contradictions** (`has no usable name`; one fitzRoy `ID` under two
   profile URLs) can only be decided after every row is read, so they cannot be rejected per
   record. Under `abort` they raise exactly as before; under `reject` they mark the player
   **unusable**, and the emitter refuses to *project* that player's records while still
   *enumerating* them.
5. **`results_identity()` / `player_match_identity()`** — presence keys computed
   **independently of projection**. The match key is byte-identical to `match_key_of()`; the
   player key is `<normalised url path>@<match_key>`. `ID` is never consulted. Either
   returning `None` is exactly the §19 "no provable key" case.
6. **`emit_observation_bundle()`** — the §8 bundle. `enumerations` is built by re-reading
   the acquired rows and keying each one, so an observed-but-rejected record is still
   enumerated; a row with no provable key goes to `unkeyed_rejections` and sets
   `complete: false` on its `(family, scope_key)`. Deterministic output (`sort_keys`, sorted
   ids, records ordered by family + id) and bound to the manifest by re-hash.
7. **Projections** are source-side only: resolved to a **historical club identity** and a
   normalised url, never to a database id. Mapping those onto `clubs.id` / `players.id` /
   `venues.id` — and refusing when they do not map — stays TypeScript's, in T6.
8. **Brownlow.** `NA ⇒ no row, ever`; a published `0` is a real vote; finals and ungated
   seasons produce nothing. **`measure_brownlow_votes()` is the F11/U2 bounded offline
   measurement** — NA count, distinct published values and projectable row count over the
   bytes already on disk. No network, no rerun of P5.
9. **`--emit-observations PATH`** writes the bundle and returns before any database branch.
   **`--on-record-error {abort,reject}`** defaults to `abort`.

**Amendment A5 — both new flags are in-season only.** `--on-record-error reject` and
`--emit-observations` each require `--require-in-season` (argparse refusals). F6's stated
intent is that the historical path stays byte-for-byte unchanged; a default alone protects
it only until an operator passes the flag, and the bundle itself declares
`acquisition_kind: in_season_partial`, so producing one from any other snapshot kind would
be a false declaration. This strictly narrows capability.

**Amendment A6 — payload column naming.** §8 leaves the payload shape open. Both families
declare **snake_case canonical column sets** (`MATCH_PAYLOAD_COLUMNS`, 18;
`PLAYER_MATCH_PAYLOAD_COLUMNS`, 34), and the statistic keys are **STAT_MAP's target names**,
so the one mapping authority is reused rather than a second naming policy invented. The
match payload carries the raw club/venue strings and the source's own round vocabulary;
resolved identities appear only in the projection. T4 declares exactly these column sets in
`data/reference/source-families.json`.

**Amendment A7 — the T3 gate command.** §28 lists
`.venv/bin/python -m pytest tests/python/settle_emit_contract.py`, but **this repository has
no pytest anywhere** — `tests/python/` holds runnable behavioural scripts
(`reference_cascade_contract.py`, `fitzroy_corrections_contract.py`,
`ladder_identity_contract.py`), and `tests/fitzroy-core-import.test.ts:1518` spawns one
directly. The new suite follows that precedent, so the command is
`python tests/python/settle_emit_contract.py`.

**Rejected during T3.**

- *Emitting the bundle from a third parse of the CSVs* — it would be a second implementation
  of the AFL Tables source contract. The emitter reuses `iter_player_stats`, `ClubResolver`,
  `STAT_MAP`, `normalise_profile_url`, `to_int` and `match_key_of`, exactly as
  `import_player_match_stats` already does.
- *Reordering `scan_player_stats`'s validations so identity is checked first* — it would
  change which error the historical path reports for a row that fails two ways. Only the
  mutations moved.
- *Rejecting a duplicate player-match row by retracting the record* — the FIRST row
  legitimately produced that record. `policy.accepted_player_match` (populated from the
  `pm_key` already computed, at zero cost) means a rejection is applied only to a record the
  scan never accepted.
- *Letting a match with no joined player row project* — §17.1 requires player-row evidence
  before a `new` match may be proposed. It is refused as `incomplete_match_evidence` and
  remains fully observed and enumerated.
- *Deriving absence from a failed projection* — the invariant this stage exists to protect.
  Presence is enumerated from the raw rows and never from the projection's success.

**New test coverage** — `tests/python/settle_emit_contract.py`, 32 DB-free behavioural
scenarios driving the real functions over temporary CSV fixtures and the tracked reference
data. Sections: **A** the record-error policy (default is `abort`; `abort` re-raises
unchanged; `reject` collects and keeps the good rows; an unknown policy is refused);
**B** the §19 hard invariant (**I1** an observed-but-rejected record is still enumerated,
carries its full payload and projects nothing; **I2** an unkeyable row goes to
`unkeyed_rejections` and forces `complete: false` on that family+scope only; every
enumerated id has exactly one record and vice versa; the emission is byte-deterministic);
**C** source semantics (url-not-name-not-ID identity; STAT_MAP by name, proven by reversing
the CSV column order; NULL≠0 through payload and projection; attendance blank/0/conflict;
periods 1–4 both sides, cumulative, all-NULL period writes no projection row but survives in
the payload); **D** Brownlow (NA never a row, a real 0 is a row, ungated season ⇒ zero rows
and no filler, and the F11 measurement); **E** projection refusals and the database boundary
(match with no player rows; nameless player refuses the projection not the pass, and still
raises under `abort`; no driver module is imported; no canonical writer is reachable from
the emit path).

**T3 VALIDATED — GREEN 2026-08-28, user-run.** `python tests/python/settle_emit_contract.py`
— **48/48 behavioural scenarios passed, 0 failures.**

| Section | Result | What it proves |
|---|---|---|
| **A** `--on-record-error` | **7/7** | a clean in-season snapshot scans and emits; the bundle declares its contract version and in-season kind and is manifest-hash bound; the default is still **`abort`**; `abort` re-raises the original error unchanged; `reject` contains the bad record and continues; an unknown policy fails closed |
| **B** presence / absence-sweep safety | **11/11** | **observed-but-rejected rows stay ENUMERATED as present** and keep their full source payload with no projection; a provable rejected key keeps the enumeration **complete**; an unprovable key becomes an `unkeyed_rejection` and forces `complete: false` **for the affected family/scope only**; no unkeyed row leaks into the seen-key set; enumerated ids and records are 1:1; identical snapshots emit byte-identically |
| **C** source semantics | **17/17** | identity is the normalised profile-URL path + match key; the **P5** missing-`ID` case still projects; no player NAME is ever identity; `STAT_MAP` maps by explicit name and CSV column order is irrelevant; a blank stat stays NULL through payload **and** projection; blank attendance is absence of observation while a recorded 0 is a real value; a conflicting non-null attendance rejects only the record, preserves its presence, and never leaks into the projection; period scores are periods 1–4 only and cumulative; an all-NULL period produces no projection row rather than fake zeros |
| **D** Brownlow | **7/7** | NA produces no projection; a published vote produces one round-grain row; a published 0 is distinct from NA; NULL stays NULL in the payload; the **F11** offline measurement records the NA count and distinct values; an ungated season produces **zero** rows and no filler; the source evidence is retained even when nothing is projectable |
| **E** database / canonical boundary | **6/6** | incomplete source facts stay enumerated without projecting; a nameless player refuses its projection under `reject` and still raises under `abort`; **emission opens no database driver**; **no canonical writer is reachable from the emit path** |

**The §19 HARD INVARIANT is proven by execution:** an observed record that fails projection is
never marked absent, and an unkeyable record disables the affected absence sweep rather than
being treated as gone. **SC5 is guarded.**

**Amendments A5, A6 and A7 are VALIDATED implementation decisions**, not open questions:
A5 (both new flags are in-season only) is enforced by argparse and leaves the historical
path unreachable from `reject`; A6 (snake_case payload column sets reusing STAT_MAP's target
names) is the contract the emitter actually produced and is now T4's input; A7 (the gate is a
runnable script, not pytest — this repository has no pytest) is the command that ran.

**T3 is CLOSED.** Next: T4.

### T4 — tracked source-family registry (implemented 2026-08-28, AWAITING VALIDATION)

**Implemented** — `data/reference/source-families.json` plus its gate. **No code changed:**
`src/lib/acquisition/source-families.ts` already enforces everything this stage needs
fail-closed, so T4 is a declaration against the exact contract T3's emitter produced. **No
migration, no persistence, no canonical write.**

1. **`afltables` / `match` — new, `declared`, `promotion_policy: "reviewed"`.**
   `known_columns` is exactly `MATCH_PAYLOAD_COLUMNS` (18);
   `external_key` = `["season", "round_code", "match_date", "home_team_raw", "away_team_raw"]`;
   `required_columns` is the 14 that must carry a value, so the nullable
   `round_number` / `attendance` / `match_time` / `period_scores` stay known-but-not-required.
2. **`afltables` / `player_match_stats` — upgraded** from `identity_only` /
   `not_yet_declared` to `declared` / `reviewed`. `known_columns` is exactly
   `PLAYER_MATCH_PAYLOAD_COLUMNS` (34, the 12 explicit plus STAT_MAP's 22 target names);
   `external_key` = `["url", "match_key"]`; `required_columns` = the identity and club
   columns only — **`afltables_id` is deliberately not required (P5)**, and no name column is
   in either list.
3. **NULL-preserving hashing.** Both families: `hash_exclusions: []` (nothing in an AFL
   Tables payload is fetch noise, so the payload hash covers the whole observation and stays
   the change oracle), `zero_is_missing_columns: []` (a recorded 0 attendance, a 0 statistic
   and a 0 Brownlow vote are **real values**; listing any column would silently null them),
   and `source_updated_at_field: null` (§11.5 — AFL Tables publishes no upstream mutation
   timestamp, and fetch time is never substituted).
4. **Independence** `afltables`, `proven_independent`, `derives_from: null` — unchanged, and
   AFL Tables now joins Squiggle and Kali as a **third** match witness group.
5. **Round vocabulary** stays `afltables_2026` / `anchors_only` on both. `translateRound()`
   is still refused, so §6.3 needs no work.

**Amendment A8 — the registry column sets are pinned to the emitter's own constants.** The
new gate does not retype 52 column names: it reads `MATCH_PAYLOAD_COLUMNS`,
`PLAYER_MATCH_PAYLOAD_COLUMNS` and `STAT_MAP` **out of `import_fitzroy_core.py`** and asserts
equality with `known_columns`. A6 made the emitter the semantic source of truth; this makes
that binding executable, so a change to either half that is not made to the other fails.
Retyping them would have been a second field vocabulary — the drift ISSUE-093 §H11 was
burned by.

**Two ISSUE-096 assertions were amended, and both kept everything they protected.**

- *"promotes nothing in v1, and lineups never at all"* → *"promotes only the two reviewed
  AFL Tables families, and lineups never at all"*. That assertion was true only while **no**
  family had a proven shape and key; §9.2 approves exactly this upgrade. Still asserted:
  `reviewed` is the only promotable policy and both carry `promotion_owner:
  AFLDB-ISSUE-099`; lineups, Squiggle and Kali stay `never`; reviewed promotion is still
  refused for a source with no `sources` row and for a family with no proven column
  contract (retargeted at `kali_afl_stats/player_stats`, which is still `identity_only`);
  and a promotable family may not lose the shape that earned it.
- *"refuses to project a family whose shape was never proven"* — the AFL Tables player grain
  was the example while its shape was unproven. It is now the **Kali** grain (P2: still no
  stable provider player id), plus a loop asserting **every** non-`declared` family is
  equally unprojectable and unpromotable. The rule is unchanged; only the example moved.

**Rejected during T4.**

- *A separate `afltables.attendance` or `afltables.period_scores` family* — already rejected
  in §29. Both ride the one match observation; 074's `target_table` dimension is how two
  targets are expressed, and the registry note now records that explicitly.
- *Declaring the resolved club identities as payload columns so `external_key` could name
  them literally* — the payload is the source observation and stays raw. `external_key`
  names the columns the key is **derived from**, with a note that `ClubResolver` turns each
  into exactly one historical identity or fails closed.
- *Listing `attendance` in `zero_is_missing_columns`* — it is the §17.1 defect in miniature:
  a recorded 0 attendance is real and cites its source; absence is NULL.
- *Excluding the player name and DOB columns from the payload hash* — a source name
  correction is a real source change. Reconciliation already classifies it as `history_only`
  because it moves no projected fact field, so history advances with no proposal. Excluding
  them would have discarded evidence to avoid a problem that does not exist.
- *Completing the `afltables_2026` round mapping* — §29; the settle never compares rounds
  across vocabularies.

**T4 run 1 — 2026-08-28, user-run: 39 cases, 36 passed, 2 skipped, 1 failed.**
**Every ISSUE-099 assertion was GREEN on the first run** — `source families dataset` **15/15**
and `AFL Tables in-season families (AFLDB-ISSUE-099)` **5/5**. The single failure was in an
unrelated block, `post-045 tables unreadable to afldb_import (§H12)`, and is **not caused by
T4**: it is a **stale test baseline**, pre-dating migrations 073/074 being applied.

*Classification, source-verified before any edit was made.*

| Table | Created by | Why it is deliberately not import-writable |
|---|---|---|
| `data_overrides` | **073** (`AFLDB-ISSUE-086`), `:11` | Human overrides are not importer-owned. `privileges.sql:296-300` grants `afldb_import` **SELECT only** and says they "deliberately remain outside `afldb_meta.import_writable_tables`" — the importer must *read* them to replay, never write them. |
| `promotion_decisions` | **074** (`AFLDB-ISSUE-096`), `:255` | Append-only **by grant**: `afldb_auth` gets `SELECT, INSERT` and nothing else (`074:320-333`, `privileges.sql:397`). Migration 074 states the reason in full — `grant_import_write()` hands out UPDATE/DELETE/TRUNCATE and `privileges.sql` regenerates the whole set from that registry, so registering it would silently end the append-only guarantee at the next reconcile. Its sibling `promotion_candidates` **is** registered and is correctly absent from the list. |

**Lineage confirmed:** `AFLDB-ISSUE-095` recorded this exact failure and deliberately left it,
on the grounds that repairing it "asserts a privilege decision that belongs to ISSUE-086's
blocked manual-authority contract". That reason is now **spent** — ISSUE-086 is Resolved and
073/074/075 are applied and checksum-frozen — so the decision is settled and the baseline can
be reconciled with it.

**Repair made: test baseline only.** `data_overrides` and `promotion_decisions` were added to
the expected array in `tests/reference-data.test.ts`, each with the reason above recorded
inline. **No migration, no privilege, no grant, no registry semantics and no ISSUE-099
architecture was changed**, and the assertion remains **exact equality** — a future post-045
table that skips `grant_import_write()` must still produce a visible source diff for review,
which a subset check would have destroyed.

**One correction to the classification, recorded rather than smoothed over.** The
cascade-closure claim holds for `data_overrides` (its only FK is `admin_user_id →
auth_users`, so it is outside the closure entirely) but **not exactly** for
`promotion_decisions`, which **is** transitively reachable from the `seasons` truncate root:
`seasons ← promotion_candidates.season (074:162) ← promotion_decisions.candidate_id
(074:257)`, and `afldb_import` cannot SELECT it. This is **not a defect and not a third
member of the §H12 pair**: since §H13 the closure is taken from **populated roots only**, and
a clean rebuild's roots are empty, so it is never adjudicated. If `seasons` were ever
truncated while populated the guard would **refuse** — the fail-closed behaviour working, not
a privilege to widen. Noted in the test comment and owned by neither ISSUE-099 nor this
repair.

**T4 VALIDATED — GREEN 2026-08-28, user-run.** `npm test -- tests/reference-data.test.ts` —
**1 file, 39 cases: 37 passed, 2 skipped, 0 failed, 338 ms.**

- `source families dataset` **15/15** and `AFL Tables in-season families (AFLDB-ISSUE-099)`
  **5/5**.
- Both reviewed families carry a **proven exact shape**, and the registry's `known_columns`
  **equal the emitter's** `MATCH_PAYLOAD_COLUMNS` / `PLAYER_MATCH_PAYLOAD_COLUMNS` + STAT_MAP
  targets — **A6/A8 are executable in both directions**, so the two halves cannot drift.
- Player-match identity stays **profile-URL keyed with `ID` enrichment-only (P5)**; the match
  key is composed from exactly the columns the existing resolver consumes; **NULL stays
  distinct from zero** (`zero_is_missing_columns: []` on both); payload hashing stays whole
  (`hash_exclusions: []`); and registry drift stays fail-closed.
- The two amended ISSUE-096 assertions kept everything they protected: lineups, Squiggle and
  Kali remain `never`; reviewed promotion is still refused for an unregistered source and for
  an unproven column contract; every non-`declared` family is still unprojectable.

**Baseline repair also GREEN, and it changed no behaviour.** `data_overrides` and
`promotion_decisions` are confirmed intentionally outside the general import-write registry —
the first read-only to `afldb_import` by `privileges.sql`, the second append-only by grant per
migration 074's own stated reasoning. **Exact-equality inventory protection retained**; no
privilege, migration or registry semantic changed. The `promotion_decisions` transitive-closure
observation (§ above) is recorded, unowned by ISSUE-099, and harmless under the §H13
populated-roots rule.

**T4 is COMPLETE.** Next: T5.

### T5 — migration 076 (written 2026-08-28, UNAPPLIED, AWAITING DB-FREE VALIDATION)

**`src/db/migrations/076_afltables_settle_projections.sql` — new, not yet applied, and
therefore still editable.** Once it applies successfully to `afldb_test` it is
checksum-frozen and any correction needs a **new forward migration**.

#### 076 contents

**(1) `staging.afltables_match`** — one row per fully-resolved `afltables.match`
observation. Grain `(source_id, family, external_record_id)`; composite FK
`(source_id, family, external_record_id, version_seq)` → `staging.source_record_versions`.
Real FKs make resolved identity a database-enforced fact: `season → seasons(year)`,
`home_club_id`/`away_club_id` → `clubs` **NOT NULL**, `winner_club_id → clubs` (NULL on a
draw), `venue_id → venues` **nullable** (an unmapped venue is normal; `venue_raw` always
carries the real string and **no venue or alias is ever created**),
`attendance_source_id → sources`, `projected_by_batch_id → import_batches`. Carries the
`matches` proposal (§17.1) plus the 24 quarter columns as the `match_period_scores` proposal
(§17.2). CHECKs: clubs differ; margin; `result` restates the scores; `winner_club_id`
restates `result`; `is_final` restates `round_type`; non-negativity; goals/behinds/points
reconciliation **and the same reconciliation per period** (mirroring `022`'s
`match_period_components_ck`, through which the canonical rebuild already wrote 134,704 rows
from this source); and migration 020's two attendance rules, so a proposal cannot be one a
canonical write would have to reject.

**(2) `staging.afltables_player_match`** — one row per fully-resolved
`afltables.player_match_stats` observation. Same grain and composite version FK;
`player_id → players` **NOT NULL**, `club_id → clubs` **NOT NULL**, `season → seasons(year)`.
Carries the §17.3 proposal (`club_id`, `career_game_no`, `jumper_number`, the 21 stats plus
`brownlow_votes`, all nullable) and the §17.4 Brownlow proposal. `afltables_id` is nullable
enrichment (P5). Natural uniqueness `(source_id, player_id, match_key)`. CHECKs: the
`brownlow_votes BETWEEN 0 AND 3` range, non-negativity on every statistic, and the Brownlow
row rule below.

**(3) `data_issues.issue_key`** — exactly §10.2(b): a nullable `text` column plus
`uq_data_issues_open_by_key ON data_issues (issue_type, issue_key) WHERE issue_key IS NOT
NULL AND resolved_at IS NULL`. Migration 072's convention, adapted for the one way ISSUE-099
differs — `entity_id` is NULL for a canonical target that does not exist yet, and NULL never
conflicts in a unique index, so without a stable natural key every nightly rerun would stack
another open row. Rows with a NULL `issue_key` are excluded entirely, so **every existing
`data_issues` writer is unaffected** and migration 072's own index is untouched.

**(4) Grants** — `SELECT, INSERT, UPDATE, DELETE` to `afldb_import` and `SELECT` to
`afldb_app` on the two staging tables. ~~**No `TRUNCATE`**: the v1 path upserts and reads
back, never truncates.~~

> **CORRECTED 2026-08-29 — see "Privilege contradiction" below.** The struck sentence is true
> of the migration's *statements* and **false of the applied state**. The catalogue proves
> `afldb_import` holds `TRUNCATE` on both tables, inherited from migration 014's staging
> default privilege at `CREATE TABLE` time. It was never achievable by omitting a GRANT.

#### Schema decisions taken during T5

- **`match_period_scores` is 24 columns on the match projection, not a third table.**
  §10.2's own NULL-semantics column says "quarter columns NULL = not recorded", and §10.2(a)
  approves **two** tables. A third would have been broadening.
- **No `match_id` on the player projection, and no `local_match_id` on the match
  projection.** On a canonically rebuilt database the in-progress season has **zero**
  matches, so requiring a resolved canonical match would make every in-season projection
  unwritable. `match_key` carries the link at the natural-key level — the same key
  `matches.match_key` uses.
- **No canonical acceptance or provenance schema**, per §10.3: no
  `add_provenance_columns('match_period_scores')`, none for `brownlow_round_votes`, no
  `player_match_stats.source_record_id`, and no widening of 073's `data_overrides.entity_type`
  CHECK. **No v1 operation needed any of them**, so there is no contradiction to report.
- **Exactly one existing table is modified** (`data_issues`, additively). No DML, no trigger,
  no rule, no function, no DROP.

**Amendment A9 — `privileges.sql` is NOT edited, contrary to §10.2(d).** Source-verified:
`privileges.sql:328` already grants `afldb_import` SELECT/INSERT/UPDATE/DELETE/TRUNCATE and
`:182` grants `afldb_app` SELECT on **ALL TABLES IN SCHEMA staging**, so a reconcile keeps
both new tables **without naming them**. Registering them would be a redundant second
declaration of the same grant. The approved *outcome* — grants survive a reconcile — holds;
only the mechanism differs from what §10.2(d) assumed. Also verified: both privilege-registry
assertions in `tests/integration/privileges.test.ts` are scoped to `public`, so staging tables
are outside them and **no registry entry is required or made**. `data_issues` is an existing
public table already in both registries and adding a column changes no grant.

**Amendment A10 — `brownlow_round_number` on the player projection.** §10.2 enumerates the
NULL semantics but not the full column list, and the column set is `proposedValues` — the
fields each target would write (§12). `brownlow_round_votes` is one of the four approved
targets, so under Decision B its proposal must be readable from the **typed projection**.
NULL means *no round-vote row is proposed at all* (an NA vote, a final, or a season the
coverage authority does not gate); non-NULL is the round it would be filed under. Carrying it
keeps the season-gating decision in Python, which owns the source semantics — re-deriving it
in TypeScript would be the duplicated-semantics failure the language boundary forbids. The
CHECK `brownlow_round_number IS NULL OR (brownlow_votes IS NOT NULL AND is_final = false AND
brownlow_round_number >= 1)` makes **"NA becomes a row"** and **"a final was polled"**
structurally unrepresentable rather than merely documented.

#### FK coverage, reviewed before application

The FK-index gate (`tests/integration/fk-indexes.test.ts`) scans `nspname = 'public'` only,
so the two staging tables are **outside** it — no exemption is added and none is needed.
§10.2(c) is satisfied on its own terms regardless. Indexed: both composite version FKs
(`ix_afltables_match_version`, `ix_afltables_player_match_version` — the PK covers only the
first three of the four columns), `player_id`, `venue_id` (partial on the one predicate a
referential probe implies), plus `season`, `home_club_id`, `away_club_id` and `club_id` for
the review queue. Deliberately unindexed, on exactly the grounds `DELETE_FREE_PARENTS`
already accepts: `winner_club_id`/`clubs`, `attendance_source_id`/`sources`,
`projected_by_batch_id`/`import_batches` — those parents are append-only or never deleted
row-by-row, so an index would be maintained for a delete that never happens. Recorded inline
in the migration.

#### Validation state

**New DB-free source contract:** `tests/current-season-import.test.ts`, block
`migration 076 — AFL Tables settle projections (AFLDB-ISSUE-099)`, 8 cases, asserted over
**executable statements** rather than raw text (074's lesson: 076 explains each exclusion in
prose immediately above the schema, so a raw regex would match the explanation of the
forbidden thing instead of the thing). It pins: no acceptance/provenance schema and no edit
to 073/074/075; exactly one additive `ALTER TABLE data_issues` and no DML/trigger/rule; both
projections created in `staging` with the exact composite version FK and no canonical match
FK; the four strictly-required covering indexes verbatim, none UNIQUE, none CONCURRENTLY;
NULL≠0 across every projected column (asserted as whole column definitions), the 24 quarter
columns and **no** extra-time column; the two Brownlow CHECKs; the exact `data_issues` column
and partial unique index with 072's index untouched; the exact four grants with no TRUNCATE
and no `afldb_auth` or public-table grant; and that `privileges.sql` carries the schema-wide
staging grants and does **not** name the two tables — so A9's reasoning is executable, not
merely claimed.

**T5 DB-FREE VALIDATION — GREEN 2026-08-28, user-run.**
`npm test -- tests/current-season-import.test.ts` — **1 file, 132/132 passed, 0 failures,
402 ms.** The new block `migration 076 — AFL Tables settle projections (AFLDB-ISSUE-099)` is
**9/9**: no schema for the future canonical acceptance stage; exactly one existing table
modified and additively only; both typed staging projections present and keyed to the
observation version; the migration covers its own required FKs **before** application; NULL
stays distinct from zero in every projected column; an NA Brownlow vote is **structurally
unable** to become a row; one open `source_disagreement` per stable key is deduplicated
without constraining any unrelated `data_issues` writer; minimum v1 privileges only; and
`privileges.sql` requires no modification. The other 123 cases — the ISSUE-096 S1–S4 pure
modules and the shipped current-season importer — stayed green, so nothing in T5 disturbed
them.

- **A9 VALIDATED:** the existing staging-schema privilege policy covers the two new
  projection tables, and no unnecessary `privileges.sql` or registry edit was introduced.
- **A10 VALIDATED:** `brownlow_round_number` stays part of the typed projection contract, so
  TypeScript never re-derives the Python-owned Brownlow season/round gate, and the schema
  prevents NA or unpublished Brownlow evidence from becoming a projected vote row.

**Status: 076 is UNAPPLIED and NOT checksum-frozen.** No database has been touched by T5.

#### T5 database preflight — BLOCKER RESOLVED, status GREEN (2026-08-29, user-run)

**Blocker.** The local `AFLDB_TEST_DATABASE_URL` credentials were stale for the local
PostgreSQL endpoint, so no DB-backed step could run.

**Resolution, operator-performed.** An SSH tunnel was established from a local loopback port
to the AFLDB host's PostgreSQL service, the current test DSN was obtained from the host
without ever printing its password, and **only the local endpoint** was changed. No
credential, password, DSN, secret or hash is recorded in this file or anywhere else in the
repository, and none was printed. Nothing about the schema, the migration or the ISSUE-099
contract changed — this was environment access only.

**Status evidence — `npm run db:migrate:test -- --status` (read-only):**

| Fact | Value |
|---|---|
| Target | **`afldb_test`** (the tunnelled loopback endpoint), connecting as `afldb_owner` |
| Migration files | **76** |
| Already applied | **75** — 001 … 075 contiguously, **including 073, 074 and 075** |
| Pending | **1 — `076_afltables_settle_projections.sql`, and only that** |
| Drift | **none reported**; the runner validates every applied checksum before doing anything, so a clean status also re-proves 073/074/075 are byte-identical to their applied artefacts |

**Consequences, stated plainly.** 075 is the latest applied migration, 076 is the sole
pending one, and **076 has NOT been applied** — so it is still editable and is **not yet
checksum-frozen**. Production and `afldb_dev` were not touched.

#### Final pre-application source review (2026-08-29)

`src/db/migrations/076_afltables_settle_projections.sql` is **unchanged since the DB-free
gate went green** — no edit was made after that run — and was re-read in full against the
approved contract and amendments A9/A10. Result: **consistent, no defect, no contradiction.**

| Requirement | Finding |
|---|---|
| No DML | 25 executable statements: 2 `CREATE TABLE`, 10 `CREATE INDEX` (one UNIQUE), 8 `COMMENT ON`, 4 `GRANT`, 1 `ALTER TABLE … ADD COLUMN`. **No INSERT, UPDATE, DELETE or TRUNCATE anywhere.** |
| No DROP / TRIGGER / RULE / FUNCTION | None present. |
| No canonical acceptance or provenance schema | No `add_provenance_columns`, no `source_record_id`, no `data_overrides` widening, and **no `ALTER TABLE` against any canonical fact table** (`matches`, `match_period_scores`, `player_match_stats`, `brownlow_round_votes`, `players`, `clubs`, `venues`). §10.3 holds. |
| v1 boundary | Exactly **two `staging` projection tables** plus **additive `data_issues` disagreement support**. Nothing else. No canonical table is written, and no canonical row can be created by this schema. |
| v1-required constraints | Match: clubs-differ, margin, result↔scores, winner↔result, `is_final`↔`round_type`, non-negativity, score components, **per-period** components, period non-negativity, and migration 020's two attendance rules. Player: Brownlow 0–3 range, the NA/finals row rule, statistic non-negativity, natural grain `UNIQUE (source_id, player_id, match_key)`. |
| FK / index rationale | Both composite version FKs, `player_id` and `venue_id` (partial, on the one predicate a referential probe implies) indexed; `season` and the club columns indexed for the review queue; `winner_club_id`, `attendance_source_id` and `projected_by_batch_id` deliberately unindexed on exactly the `DELETE_FREE_PARENTS` grounds, recorded inline. |
| Staging privileges | Exactly four grants; **no `TRUNCATE`**, no `afldb_auth`, no public-table grant, no `grant_import_write`. Migration 074's append-only ledger boundary untouched (A9). |
| `data_issues` additive-only | One **nullable** column with **no default** (so no table rewrite), one partial unique index excluding NULL keys, one comment. Migration 072's `uq_data_issues_open_dob_per_player` untouched; no existing writer is constrained. |

Type compatibility re-verified against the referenced schema: the `round_type`,
`coverage_status` and `match_result` enum labels; `seasons(year)`; `sources(id)` `smallint`;
`import_batches(id)` `bigint`; and the composite FK matching `staging.source_record_versions`'
primary key column-for-column.

#### Migration 076 APPLIED — 2026-08-29, user-run

```
npm run db:migrate:test
AFLDB migrations -> test (afldb_test)
  76 migration file(s), 75 already applied
  applying 076_afltables_settle_projections.sql ... ok (179 ms)
Applied 1 migration(s).
```

**`afldb_test` only.** Production and `afldb_dev` were not touched, and no canonical row was
created or modified — 076 contains no DML.

> **076 IS NOW CHECKSUM-FROZEN. DO NOT EDIT IT.**
> Migrations 073, 074, 075 and **076** are all applied and frozen. If any post-application
> validation exposes a defect in 076, the repair is a **NEW forward migration** — never an
> edit to 076, and never a weakened checksum guard. Stop and report rather than improvising.

**Post-application validation ladder (one command at a time, do not stack, do not proceed
past a failure):**

| # | Command | Proves |
|---|---|---|
| 1 | `npm run db:migrate:test -- --status` | 76/76 applied, 0 pending, **no drift** — and, because the runner re-validates every applied checksum, that 076's stored checksum matches the file it was applied from |
| 2a | `npm test -- tests/integration/privileges.test.ts` | **read-only baseline.** A9 and the accepted A11 contract proven from the **applied catalogue**, before any privilege mutation, plus obligation **O2** (the staging `pg_default_acl` pinned explicitly) |
| 2b | `npm run db:privileges:test` | the privileges reconcile still succeeds with the two new staging tables present |
| 2c | `npm test -- tests/integration/privileges.test.ts` | the reconcile **changed nothing** on these tables — measured, not assumed. This ordering exists precisely because the reconcile's effect here was previously assumed rather than measured, and the assumption was wrong. |
| 3 | `npm test -- tests/integration/fk-indexes.test.ts` | the FK-index gate is still green; 076 adds no unindexed public FK and needs no exemption |
| 4 | `npm test -- tests/integration/privileges.test.ts` | the `public` app/import registries are unchanged, and the new `data_issues` column changed no grant |
| 5 | catalogue shape check | both staging projections and the `data_issues` column/index exist with the exact approved shape, and no canonical table gained a column |

**Ladder step 1 GREEN — 2026-08-29, user-run.** `npm run db:migrate:test -- --status`:
**76 migration files, 76 already applied, 0 pending**, with 073, 074, 075 and **076** all
listed applied. The runner validates every stored checksum before it reports, so this is
simultaneously the ledger proof and the **freeze proof**: 076's stored checksum matches the
file it was applied from. `afldb_test` only; no credential, DSN or hash is recorded here.

**A9 is upgraded from a source claim to an executable one.** Amendment A9 was reasoned out of
`privileges.sql`; a privilege claim inferred from a script is exactly the kind this
repository has had wrong before (the 023 auth tables and 037 `site_media` leaks, both past a
header saying no grant was intended). So `tests/integration/privileges.test.ts` gains a new
block, **`AFL Tables settle projections are privileged like the rest of staging`** (4 cases),
which interrogates the **applied catalogue**:

1. the importer's grants on both projections are **byte-identical to migration 074's
   `staging.source_payloads`** — the same-shaped table, created the same way, never registered
   either — and the set is exactly `DELETE, INSERT, SELECT, TRUNCATE, UPDATE`, with no
   `REFERENCES` and no `TRIGGER`;
2. `afldb_app` reads them and cannot write them, and **`afldb_auth` has no `USAGE` on
   `staging` at all**, so it cannot reach them by any route;
3. migration 074's **append-only ledger boundary is intact** — `afldb_auth` still holds
   `SELECT, INSERT` and nothing else on `promotion_decisions`, and the importer still holds no
   `INSERT` on it;
4. adding `issue_key` to `data_issues` **changed no grant**, including no column-scoped one.

> **SUPERSEDED 2026-08-29.** The paragraph that stood here framed the `TRUNCATE` difference
> as a post-reconcile expectation. The catalogue proves it is **already present**, granted at
> `CREATE TABLE` time by migration 014's default privilege. Assertion 1 above must **not** be
> run as written until the contract is amended: proving equality with `source_payloads` after
> a mutation would demonstrate consistency with the existing broad policy without ever
> adjudicating whether ISSUE-099 may retain `TRUNCATE`. See "Privilege contradiction" below.
> **The new test block is written but has NOT been run, and the reconcile has NOT been run.**

#### Privilege contradiction — HALTED at ladder step 2, adjudication pending (2026-08-29)

**The reconcile was NOT run.** No `GRANT`, `REVOKE`, reconcile, migration or FK gate has been
executed since this was found. Only read-only catalogue inspection.

**Catalogue evidence, user-run, read-only.** `afldb_import` holds **all five** privileges —
`SELECT, INSERT, UPDATE, DELETE, TRUNCATE` — on `staging.afltables_match`,
`staging.afltables_player_match` **and** the 074 comparator `staging.source_payloads`. Raw
ACL on all three is identical:

```
afldb_owner=arwdDxt/afldb_owner
afldb_app=r/afldb_owner
afldb_import=arwdD/afldb_owner
```

and `pg_default_acl` for schema `staging`, role `afldb_owner`, objtype `r` is

```
afldb_app=r/afldb_owner
afldb_import=arwdD/afldb_owner
```

`arwdD` decodes as INSERT, SELECT, UPDATE, DELETE, **TRUNCATE**.

**Mechanism, source-proven.** `src/db/migrations/014_staging_schema.sql:16-17`:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;
```

The migration runner connects as **`afldb_owner`**, so PostgreSQL applied that default the
instant 076's two `CREATE TABLE` statements ran. The table ACL is **identical to the default
ACL**, which is the proof of origin.

**Three consequences, stated plainly.**

1. **Migration 076's four GRANT statements are inert.** Every privilege they name was already
   present, and the one they omit was present too. **No wording of 076 short of an explicit
   `REVOKE` could have produced a different applied state.** "Minimum privileges by omitting
   a GRANT" is not achievable for any table created in `staging` by the owner.
2. **`npm run db:privileges:test` is not the widening event.** `privileges.sql:328` would
   re-assert a grant that already exists. Running it would neither cause nor reveal this.
3. **My earlier T5 claim was wrong.** I asserted a statement-level fact ("076 grants no
   TRUNCATE" — true) as an applied-state fact ("these tables have no TRUNCATE" — false). The
   DB-free gate is structurally incapable of seeing a default privilege, which is a catalogue
   rule attached to *(owner, schema)*, not to a migration. This is exactly the failure mode
   migrations 031/037/038/039 exist to document: *"Do not assume 'I didn't grant it' is
   sufficient."* Recorded as an error, not smoothed over.

#### Adjudication — evidence behind amendment A11 (ACCEPTED; see the decision below)

**Question.** Does ISSUE-099's minimum-privilege requirement compel removing `TRUNCATE` from
these two tables, or must the runbook be amended to accept the inherited staging-wide policy?

**Source-backed findings.**

| # | Finding | Source |
|---|---|---|
| F-a | The staging default privilege is **deliberate**, not an oversight. | `014_staging_schema.sql:16-19` |
| F-b | Migration 045 inverted the identical mechanism to fail-closed **for `public` only**, and **named `staging` as an exemption with a reason**: "Only `public` is touched: staging, staging_aflw and aflw … hold no operational table and **keep their blanket defaults, which is what makes a staging reload work without registering anything**." | `045_import_write_is_fail_closed.sql:218-225` |
| F-c | The reconciler restates the same decision. | `privileges.sql:325-329` |
| F-d | The privilege **test suite** restates it a fourth time: "Scoped to `public`: staging, staging_aflw and aflw keep theirs (migrations 014/025/026) and hold no operational table." | `tests/integration/privileges.test.ts` |
| F-e | **No precedent exists** for a per-table exception inside the staging branch. Every per-table carve-out in `privileges.sql` is in `public` (`data_overrides` read-only `:296-300`; `promotion_decisions` append-only `:393-397`; the `readable`/`written` registries). | `privileges.sql` |
| F-f | `tools/db/privileges.ts` is a thin cross-platform runner for `privileges.sql`; it holds no per-table logic and is not a place a carve-out could live. | `tools/db/privileges.ts` |
| F-g | Both projection tables hold **disposable, re-derivable staging data** — a view of the 074 spine, rebuildable by re-running the settle pass — and **cannot directly mutate a canonical fact**. | §10.2, `076` |
| F-h | Migration 074's three spine tables sit in **exactly** this position and `AFLDB-ISSUE-096` accepted it. The spine holds the observation history itself; ISSUE-099's projections hold a **re-derivable** view of it. The new tables are strictly *less* sensitive than what is already accepted. | `074:303-308`, catalogue |

**Cost of the alternative (durable removal), for completeness.** A one-off `REVOKE` is **not**
sufficient — `privileges.sql:328` re-grants `TRUNCATE` on **ALL TABLES IN SCHEMA staging** at
every reconcile, so it would be undone on the next run. A durable removal needs **all four**
of: (i) a new forward migration issuing the `REVOKE`; (ii) the repository's **first**
per-table exception inside the staging branch of `privileges.sql`; (iii) a drift test to keep
(ii) alive; and (iv) a standing obligation on every future ISSUE-099 staging table to repeat
the `REVOKE`, because the default privilege re-grants at each `CREATE TABLE`. That is
ISSUE-099 unilaterally rewriting a repo-wide privilege architecture owned by migrations
014/045 — for two tables that hold no canonical data, are fully re-derivable, and gain no
capability from the privilege in question.

### Amendment A11 — ACCEPTED 2026-08-29 (user-adjudicated)

**Decision.** ISSUE-099 **accepts** `afldb_import`'s inherited `TRUNCATE` on
`staging.afltables_match` and `staging.afltables_player_match` rather than introducing a
per-table exception. The T5 grant clause is corrected to say what is true: migration 076
grants a **subset** of the schema-wide staging policy, its GRANT statements are **inert**, and
the applied ACL is that policy.

**Accepted rationale, in full.**

1. `afldb_import`'s `TRUNCATE` privilege is an **intentional, repository-wide staging policy**,
   established by migration 014 and **deliberately retained** by migration 045 and
   `privileges.sql`.
2. **ISSUE-099 itself does not require `TRUNCATE`.**
3. The two ISSUE-099 projection tables are **disposable / re-derivable staging data** and
   **cannot directly mutate canonical facts**.
4. `afldb_app` remains **read-only** on them, and `afldb_auth` has **no `staging` schema
   access** at all.
5. Creating a per-table exception would introduce a **new privilege architecture for
   staging** and would require a durable migration **plus** a `privileges.sql` exception
   **plus** drift protection, for limited practical benefit.
6. Therefore ISSUE-099 **accepts the inherited staging privilege** rather than introducing
   that exception.

> **Deliberately NOT part of this rationale:** any claim that `TRUNCATE` "confers no
> capability `DELETE` does not already confer, only speed". That framing is **too broad for
> PostgreSQL** — `TRUNCATE` differs materially in locking, trigger firing, `FK`/`CASCADE`
> behaviour and other semantics. The decision rests on points 1–6 above, **not** on an
> equivalence between the two privileges. An earlier draft of this amendment made that claim;
> it is withdrawn.

**Two obligations this amendment creates. Neither is optional.**

- **O1 (T6/T7).** The ISSUE-099 code path must be **proven never to issue `TRUNCATE` or
  `DELETE`** against either projection. This is the guarantee the struck "No TRUNCATE"
  sentence was reaching for, relocated from the grant — where it was unenforceable — to the
  code, where it is enforceable and testable.
- **O2 (T5, now).** The privilege integration coverage must assert the expected staging
  `pg_default_acl` **explicitly**, so any future widening of the blanket staging policy — a
  stray `REFERENCES`/`TRIGGER`, a new role, a changed role — **fails visibly** instead of
  silently applying to every staging table, present and future.

**If removal had been directed**, the repair design was items (i)–(iv) above, in that order,
with 076 frozen and untouched. It was not directed.

#### Ladder step 2a — PRE-RECONCILE BASELINE GREEN, 2026-08-29, user-run

`npm test -- tests/integration/privileges.test.ts` — **1 file, 29/29 passed, 1.04 s.**
Read-only; no privilege was mutated to obtain it.

New subgroup `AFL Tables settle projections are privileged like the rest of staging` — **5/5**:

1. both projections carry **exactly** the schema-wide staging grant set
   (`DELETE, INSERT, SELECT, TRUNCATE, UPDATE`) and **nothing wider** — no `REFERENCES`, no
   `TRIGGER` — with the expected set stated outright rather than inferred from the comparator;
2. **obligation O2 discharged** — the staging `pg_default_acl` is pinned explicitly to one
   granting role (`afldb_owner`) and exactly `afldb_app=r/afldb_owner` +
   `afldb_import=arwdD/afldb_owner`, so a future widening of migration 014's blanket policy
   fails **here, once**, instead of silently applying to every staging table any later
   migration creates;
3. `afldb_app` is read-only on both and `afldb_auth` has **no `staging` access at all**;
4. migration 074's **append-only** `promotion_decisions` boundary is intact — `afldb_auth`
   holds `SELECT, INSERT` and nothing else, and the importer holds no `INSERT`;
5. adding `issue_key` to `data_issues` **changed no grant**, including no column-scoped one.

**This is the measured PRE-reconcile state.** It is the baseline the post-reconcile run must
reproduce exactly. The remaining 24 cases — the `afldb_app` read-only invariant, the registry
assertions and the importer contract — were unaffected by 076.

#### Ladder steps 2b and 2c — RECONCILE GREEN and NO-OP, 2026-08-29, user-run

**2b — `npm run db:privileges:test`** completed successfully against `afldb_test`:
`afldb_app` 43 public relations readable / 20 revoked; `afldb_import` 40 registered tables
writable / 23 relations revoked; `afldb_auth` grants applied on 34/34 tables / 29 other
relations revoked; `afldb_backup` unchanged (`pg_read_all_data` requires superuser).

**2c — `npm test -- tests/integration/privileges.test.ts` — 29/29 passed, 630 ms**, the
settle-projection subgroup still **5/5** and every assertion identical to the 2a baseline.

**The claim this ordering was designed to test, now measured on both sides:** the reconcile
**did not alter** the accepted ISSUE-099 privilege state. That is evidence, not inference —
which is the point, since the earlier failure was inferring the reconcile's effect instead of
measuring it. `privileges.sql` was **not modified**; no defect required it.

**A11 stands as accepted.** Inherited staging `TRUNCATE` is repository-wide staging policy.
**Obligation O1 remains open and binding on T6/T7:** the ISSUE-099 code path must be proven
never to issue `TRUNCATE` or `DELETE` against either projection.

> ### T5 PRIVILEGE GATE: COMPLETE
> Steps 2a / 2b / 2c all green, measured pre- and post-reconcile. No grant was widened, no
> migration edited, no `privileges.sql` change made.

**Next gate: FK / index (ladder step 3).** Scope stated honestly in advance so the evidence is
not over-claimed: `tests/integration/fk-indexes.test.ts` queries `nspname = 'public'`, so it
**does not** cover the two `staging` projections. What it proves is that **076 introduced no
unindexed `public` foreign key** — it introduces no public FK at all — and that the existing
gate is still green with 076 applied, including its counterweight assertion that no
`DELETE_FREE_PARENTS` exemption has gone stale. The staging tables' own FK coverage was proven
DB-free in the 076 source contract (both composite version FKs, `player_id`, and the partial
`venue_id` index), and **no exemption was added to the gate**.

#### Ladder step 3 — FK / INDEX GATE GREEN, 2026-08-29, user-run

`npm test -- tests/integration/fk-indexes.test.ts` — **2/2 passed, 322 ms**: *indexes every
foreign key whose parent can be deleted from*, and *keeps the exemption list free of entries
that no longer apply*.

**Scope, stated before the run and unchanged after it:** this gate interrogates `public`-schema
FK/index coverage and does **not** runtime-check the two staging projection indexes. 076 adds
no public FK, the staging FK coverage was proven in the DB-free 076 source contract, and **no
`DELETE_FREE_PARENTS` exemption was added**. The second assertion is the counterweight that
matters here: it proves no existing exemption went stale when 076 landed.

#### Ladder step 5 — RETIRED, discharged by steps 1–3

The "catalogue shape check" was an extra I proposed, not an approved §26 T5 gate, and it is
now redundant rather than skipped:

- **Both projection tables exist in the live catalogue** — `privileges.test.ts` resolves them
  through `pg_class` and asserts the returned relation set equals
  `{afltables_match, afltables_player_match, source_payloads}`, which fails if either is
  missing.
- **`data_issues.issue_key` exists in the live catalogue** — asserted through
  `information_schema.columns` in the same suite.
- **Every DDL statement executed.** The migration runner applies a migration atomically, so a
  clean `ok (179 ms)` means each `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE` ran.
- **The applied bytes are the reviewed bytes** — the status re-validates the stored checksum,
  so the exact statement text pinned by the source contract is what the database received.
  That transitively discharges "no canonical table gained a column": the source contract
  proves 076 contains exactly one `ALTER TABLE`, against `data_issues`.

Behavioural verification of these tables under real constraints belongs to
`tests/integration/settle-afltables.test.ts` in T7, not to T5.

---

### T5 — COMPLETE (2026-08-29)

Every §26 T5 gate has run and is green, and no criterion is outstanding.

| Criterion | Evidence |
|---|---|
| Migration 076 written to §10.2, nothing from §10.3 | source contract **9/9** within `current-season-import.test.ts` **132/132** |
| Applied to `afldb_test` | `applying 076_afltables_settle_projections.sql ... ok (179 ms)` |
| Checksum-frozen, ledger complete | `--status`: **76 files, 76 applied, 0 pending**, 073/074/075/076 all listed |
| Privileges — baseline, reconcile, no-op proof | **29/29** → reconcile OK → **29/29**, identical both sides |
| FK / index gate | **2/2** |
| Two typed staging projections | present in the live catalogue, exact approved shape |
| Additive `data_issues` support | `issue_key` column + `uq_data_issues_open_by_key`; migration 072's index untouched; no existing writer constrained |
| No canonical fact-table write | 076 contains **no DML**, no trigger, no rule, no function; the only `ALTER TABLE` targets `data_issues` |
| No acceptance / provenance schema | no `add_provenance_columns`, no `source_record_id`, no `data_overrides` widening |
| v1 boundary | staging projections + additive `data_issues` disagreement support **only** |
| Migrations 073/074/075 | untouched; 076 now frozen alongside them |
| Privileges widened | **none**; `privileges.sql` unmodified |

**Amendments settled in T5:** **A9** (no `privileges.sql` registration needed — the
schema-wide staging grants cover the new tables; proven from the applied catalogue) and
**A11** (inherited staging `TRUNCATE` accepted as repository-wide policy, with the over-broad
`TRUNCATE`≈`DELETE` rationale withdrawn).

> **OBLIGATION O1 CARRIES INTO T6/T7 AND IS BINDING.** The ISSUE-099 code path must be proven
> never to issue `TRUNCATE` or `DELETE` against `staging.afltables_match` or
> `staging.afltables_player_match`. A11 accepted the *grant*; O1 is what constrains the
> *code*, and T5 does not discharge it.

**Next stage: T6.** Extract `observation-store.ts` from `current-season-import.ts`
(behaviour-preserving), then build `src/lib/acquisition/settle-afltables.ts` and
`tools/current-season/settle-afltables.ts`. **Note the baseline has moved:** §26 says the
existing suite "stays at 106/106"; that was the ISSUE-096-era count. The current measured
baseline for `tests/current-season-import.test.ts` is **132/132**, and no behavioural
assertion in it may change.

---

### T6 — pre-implementation typecheck baseline (2026-08-29, user-run, BEFORE any T6 edit)

```bash
npm run typecheck
```

**13 errors in 4 files**, none of them in the T6 extraction target, `observation-store.ts`,
`current-season-import.ts`, or the planned settle module:

| File | Errors | Nature |
|---|---|---|
| `tests/db-test-rebuild.test.ts` | 4 | `ProcessEnv` / `NODE_ENV` typing (lines 734, 741, 745, 746) |
| `tests/draftguru-acquisition.test.ts` | 7 | `string \| NonSharedBuffer` around stdout/stderr handling |
| `tests/integration/draftguru-import.test.ts` | 1 | `lockDraftTables()` missing required `dsn` argument |
| `tests/integration/observation-spine.test.ts` | 1 | `JsonValue` incompatibility from an optional `undefined` `home_score` |

Because the command ran before any T6 implementation edit, this is the **authoritative
pre-T6 typecheck baseline**.

**Binding T6 acceptance rule.** T6 must introduce **zero additional** typecheck errors. A
later `npm run typecheck` must report an identical error count and identical file set,
unless a baseline error is resolved independently of ISSUE-099 and that resolution is
recorded here. **These four files are outside ISSUE-099 scope and are not to be fixed under
this issue.**

---

### T6a — extraction implemented; amendment A12 ACCEPTED (2026-08-29)

**Implemented.** `src/lib/acquisition/observation-store.ts` now holds
`persistSourceObservation()` and `markMissingObservationsAbsent()`, extracted from
`current-season-import.ts:706-857`. The head read (`FOR UPDATE OF r`), the
`decideObservation()` call, the unchanged single-`UPDATE` path, the payload →
close-previous → append-version → move-head order, and the absence predicate
(`last_batch_id <> :batch AND absent_since IS NULL`, scoped by source+family+scope_key)
are all unchanged. Neither function contains `DELETE` or `TRUNCATE` — **O1 preserved**.

Parameterised couplings, and only these: `family` (now `contract.family`),
`externalRecordId`, `scopeKey`, `payload`, `contract`. `markMissingObservationsAbsent()`
now takes an explicit `EnumeratedScope[]` instead of deriving season scopes from an
`ExternalCurrentMatch[]` — the same scopes, plus the §19 ability to omit a scope whose
enumeration is not proven complete. `current-season-import.ts` is a thin adapter
(`matchObservation()`, `enumeratedMatchScopes()`).

#### Amendment A12 — the T6a gate contains six file-location assertions (NOT weakenings)

`tests/current-season-import.test.ts` reads `current-season-import.ts` **as text** and
asserts that six strings appear **in that file**:

| Line | Assertion | Now lives in |
|---|---|---|
| 69 | `decideObservation({ contract, head, payload, observedAt })` | `observation-store.ts` |
| 70 | `INSERT INTO staging.source_payloads` | `observation-store.ts` |
| 71 | `INSERT INTO staging.source_record_versions` | `observation-store.ts` |
| 72 | `UPDATE staging.source_record_versions` | `observation-store.ts` |
| 78 | `SET absent_since = ${observedAt}` | `observation-store.ts` |
| 79 | `AND absent_since IS NULL` | `observation-store.ts` |

These assert **where** the spine writer lives. T6 requires it to move. The two conditions
therefore cannot both hold, and the conflict is structural, not a defect in either.

Unaffected and still passing against `current-season-import.ts`: line 73-74 (the
`persistSourceObservation(` call still precedes the legacy projection insert) and line 80
(the negative `DELETE FROM staging.*` assertion).

#### Amendment A12 — ACCEPTED 2026-08-29 (user-adjudicated)

**This is a test-LOCATION update required by the approved T6a extraction. It is not a
weakening of coverage, and no assertion was deleted, relaxed, reduced or generalised.**

Applied to `tests/current-season-import.test.ts`:

1. Added `const store = readSource('src/lib/acquisition/observation-store.ts');`.
2. Re-pointed exactly the six assertions above from `importer` to `store`. **Every
   assertion string is byte-identical** to the pre-T6a text.
3. **Semantic invariants preserved and made explicit**, all against `store`:
   - `decideObservation({ contract, head, payload, observedAt })` is still the decision;
   - immutable payload/version insertion — `INSERT INTO staging.source_payloads`,
     `INSERT INTO staging.source_record_versions`;
   - **write ordering now pinned by index comparison** rather than left implicit: payload
     insert → close previous version → append new version → move the record head. A
     reordering would leave two open versions or a head citing an unstored payload;
   - head refresh — `FOR UPDATE OF r` row lock and the `return 'head_refreshed';`
     zero-append path;
   - absence UPDATE semantics — `SET absent_since = ${observedAt}`,
     `AND absent_since IS NULL`, and `AND last_batch_id <> ${batchId}`.
4. **Anti-duplication adapter assertion** (the user's explicit condition): the importer
   must import from `'../acquisition/observation-store'` and must **not** contain
   `decideObservation(`, `INSERT INTO staging.source_payloads`,
   `INSERT INTO staging.source_record_versions`,
   `UPDATE staging.source_record_versions`, `INSERT INTO staging.source_records` or
   `UPDATE staging.source_records`. It cannot silently re-grow a second copy of the
   writer. The pre-existing ordering assertion (`persistSourceObservation(` precedes the
   legacy projection insert) is retained unchanged.
5. **O1 gains a DB-free source gate**: `store` must match neither
   `DELETE FROM staging.(source_records|source_record_versions|source_payloads)` nor
   `\bTRUNCATE\b`. The importer keeps its own original negative `DELETE` assertion.

**Two precision notes, both discovered while applying A12 and both deliberate:**

- The importer's `not.toContain` for the versions table is scoped to the DML forms. The
  bare string `staging.source_record_versions` legitimately remains at
  `current-season-import.ts:786` as the `import_batches.target_table` **provenance
  literal** — a recorded value, not a writer. A blanket string ban would have failed on
  correct code.
- `observation-store.ts`'s header comment states the never-delete rule **without naming
  either SQL keyword**, because assertion 5 greps the file for them. The comment says so
  explicitly, so a later editor cannot reintroduce the word and be puzzled by the failure.

**No runtime behaviour was changed to satisfy any test.** All test counts are held at
**132** — every addition lands inside an existing `it()` block, so A12 adds assertions
without adding cases.

#### T6a gate — GREEN (2026-08-29, user-run)

```bash
npm test -- tests/current-season-import.test.ts
```

```
Test Files  1 passed (1)
     Tests  132 passed (132)
  Duration  410 ms
```

**132/132, the measured pre-T6 baseline, held exactly.** The count is unchanged because
A12 added assertions inside existing cases rather than adding cases, so the number is a
like-for-like comparison and not a coincidence of two offsetting changes.

| T6a criterion | Evidence |
|---|---|
| Extraction is behaviour-preserving | the suite proves it, not an argument — §9.3's stated standard |
| Current-season observation-spine behaviour | green |
| Migration 076 source contract | green, and 076 itself untouched and still frozen |
| Reconciliation / promotion-review baseline | green |
| No assertion weakened for the extraction | A12 strings byte-identical; write ordering, row lock, zero-append path and absence predicate now pinned explicitly |
| Importer cannot re-grow a second writer | anti-duplication assertions green |
| **O1** — no `DELETE`/`TRUNCATE` against the spine or either ISSUE-099 projection | DB-free source gate green over `observation-store.ts` |

#### T6a post-extraction typecheck comparison — ZERO regressions (2026-08-29, user-run)

```bash
npm run typecheck
```

```
Found 13 errors in 4 files.
```

| File | Pre-T6 baseline | Post-T6a | Delta |
|---|---|---|---|
| `tests/db-test-rebuild.test.ts` | 4 | 4 | 0 |
| `tests/draftguru-acquisition.test.ts` | 7 | 7 | 0 |
| `tests/integration/draftguru-import.test.ts` | 1 | 1 | 0 |
| `tests/integration/observation-spine.test.ts` | 1 | 1 | 0 |
| **Total** | **13** | **13** | **0** |

Zero errors in `src/lib/acquisition/observation-store.ts`,
`src/lib/external-afl/current-season-import.ts` or `tests/current-season-import.test.ts`.
No new error file appeared. The four baseline files remain outside ISSUE-099 scope and
were not touched.

**T6a introduced zero compiler regressions.**

### T6a — COMPLETE (2026-08-29)

---

### T6b slice 1 — the pure settle contract (implemented 2026-08-29, AWAITING VALIDATION)

`src/lib/acquisition/settle-afltables.ts` — **new**, and entirely pure: no database, no
filesystem, no network, no clock. This is stage **S-C** of §21, so every refusal here
happens **before PostgreSQL is opened at all**. Slice 2 owns the transaction, the CLI and
the projection writers.

**Decisions taken while implementing, and why:**

| Decision | Rationale |
|---|---|
| The manifest re-hash is done by the CALLER; this module compares the digest | Hashing is I/O. Keeping only the comparison here makes §8.2 testable with no snapshot on disk, and the check itself is still unskippable. |
| `BUNDLE_FAMILIES` declares the wire↔contract family mapping once | The bundle names families in dotted form (`afltables.match`); the registry keys them `(afltables, match)`, exactly as `squiggle_api`/`match` is keyed. Declaring the pair once means no call site assembles either spelling by concatenation. |
| `issue_key` uses the **contract** family | §13.1's `afltables\|<family>\|…` would otherwise read `afltables\|afltables.match\|…`. The source key already leads the key, as `observationKey()` does. |
| `match_period_scores` proposes ONE field, `period_scores`, carrying the row set | It is a multi-row target at `(match_id, club_id, period)` grain, so the promotable unit is the set, not a column. `diffFields()` compares it structurally, so one quarter moving is a diff and the reviewer sees the whole set. |
| `brownlow_votes` is **not** in `PLAYER_MATCH_STATS_PROPOSED_FIELDS` | §17.3 names 21 statistic columns; `STAT_MAP` carries 22 pairs. The vote is genuine player-per-match data whose own target is `brownlow_round_votes` (§17.4), so it is proposed once, there — not to two targets from one observation. It is still CARRIED on the projection, because migration 076 stores it. |
| `brownlow_round_votes` proposes `played` and `votes` only | `(season, player_id, round_number)` is the target key, not a written field. `played` is only ever `true`, because a row exists only where a vote was actually published. |
| A round vote on a final is refused when the projection is read | §17.4 says finals are never polled. Migration 076 makes it unrepresentable; this makes it unrepresentable one stage earlier, where the reason is legible. |
| Extra time is refused at read time (`period` outside 1–4) | fitzRoy carries ET columns and the historical importer deliberately does not import them. The pass preserves that exactly and invents no ET handling. |

**Fail-closed behaviour implemented, in §8 order:** contract version equality · snapshot
label · manifest digest · `in_season_partial` · season in `in_progress_seasons` ·
declared family + `assertProjectableColumns()` per record · record↔enumeration consistency
in both directions, plus a duplicate-record and duplicate-scope refusal ·
`unkeyed_rejections` forcing `complete: false`.

`planAbsenceSweep()` is the §19 gate: a scope is sweepable **only** when its enumeration is
proven complete; anything else is skipped, reported and counted as `absenceSweepSkipped`.
There is no best-effort sweep.

`ownershipForTarget()` implements the **binding §12 supply rule**: `match_period_scores`
and `brownlow_round_votes` carry no `source_id` column (F5) and therefore return
`{ state: 'indeterminate' }`, never `'unowned'`. A table that cannot answer has not
declared an absence of ownership, and `indeterminate` fails closed to
`foreign_owned_collision` — a truthful refusal candidate.

**Coverage added** to `tests/current-season-import.test.ts` (§24's named DB-free home),
in four new `describe` blocks: bundle validation refusals, §19 presence-vs-projection
(I1/I2/I3 at the bundle grain), ownership + `issue_key` + corroboration field set, and the
§17 projection rules — attendance blank/zero, NULL-not-zero statistics, url-as-identity
with ID enrichment-only, Brownlow NA vs published zero, and the ET refusal.

#### T6b slice 1 gate — GREEN (2026-08-29, user-run)

```bash
npm test -- tests/current-season-import.test.ts
```

```
Test Files  1 passed (1)
     Tests  153 passed (153)
  Duration  1.43s
```

| Group | Cases |
|---|---|
| observation bundle fail-closed | 7 |
| presence / projection separation (§19) | 3 |
| ownership / `data_issues` identity / corroboration | 3 |
| per-family projection rules (§17) | 8 |
| **New total** | **21** |

**132 pre-existing + 21 new = 153.** An earlier note in this log said 18 new cases and
predicted 150; that arithmetic was wrong and is corrected here. The implementation was
not touched on account of it.

**Baseline reconciliation, verified against the file rather than asserted:** 153 `it(`
cases in `tests/current-season-import.test.ts`, 21 of them after the T6b block marker,
leaving the original **132 intact**. No `it.skip`, `it.only`, `it.todo`, `xit`,
`describe.skip` or `describe.only` appears anywhere in the file. Nothing was removed,
renamed away, skipped or weakened to reach 153.

**T6b slice 1 is COMPLETE.**

---

### T6b slice 2 — the settle transaction and CLI (implemented 2026-08-29, AWAITING VALIDATION)

`runSettleAfltables()` appended to `src/lib/acquisition/settle-afltables.ts`, plus the new
operator CLI `tools/current-season/settle-afltables.ts`.

**Structure.** One `sql.begin`, mirroring the existing `writeMatches` envelope (§21 S-D).
The CLI does all offline work first — read the bundle, re-hash the manifest **from disk**,
validate — and only then opens a connection, so an unverified snapshot cannot reach
PostgreSQL. Reference data (sources, clubs by `legacy_club_hist`, venues by `legacy_name`,
`external_identities` by profile url, `matches` by `match_key`), the open observation heads
and the known payload hashes are each loaded **once per run**, not per record.

**Per record, in order:** persist the observation through the shared store — **every keyed
record, projected or not** (§19) — then, only when it projected, write the typed 076 row,
then reconcile each of the family's two targets.

**Decisions taken, and why:**

| Decision | Rationale |
|---|---|
| Heads are preloaded before persistence, in one query per family | `reconcile()` needs the head as it stood **before** this run moved it. The store still takes its own `FOR UPDATE` read per record; that lock is part of the extracted behaviour and is not bypassed. |
| `promotion_candidates.family` and `staging.afltables_*.family` carry the **contract** family (`match`) | Both have a composite FK onto `staging.source_record_versions`, which the spine keys by contract family. The dotted wire name would not resolve. |
| `match_period_scores` current values are selected with **unaliased** column names | The proposal carries `club_id`/`period`/`goals`/`behinds`/`points`. A camelCase alias would never compare equal, so every run would report a spurious correction. |
| A missing canonical match makes `match_period_scores` and `player_match_stats` **`unresolved`**, not `new_target` | Their target keys need `match_id`. A key component that cannot resolve is an unresolved identity by `reconcile()`'s own definition — and on a rebuilt database the 2026 season has zero matches, so this is the NORMAL in-season state, not an error. No source creates an identity. |
| `match_period_scores` and `brownlow_round_votes` supply `{ state: 'indeterminate' }` whenever a target row exists | The binding §12 rule. F5: no `source_id` column, so the table cannot express ownership. Fails closed to `foreign_owned_collision` — a truthful refusal candidate. |
| An unmapped venue counts `venueUnmapped` **only**, never `unresolvedIdentityVenue` | §17.1: a NULL `venue_id` with a real `venue_raw` is normal and is never a refusal. Counting it as an unresolved identity would misreport a healthy run. |
| `absent` writes **no candidate**; `history_only` leaves an existing pending candidate in place | §18.2 and F7. No synthetic absent candidate, no machine retirement, no fabricated admin decision, no empty replacement. |
| `import_rejections` is written only on an `unresolved_identity` **outcome** | §12's table. An unchanged rejected record produces no outcome and therefore no row, so a nightly rerun does not stack rejection rows for a record nothing changed about. |
| Corroboration reads `staging.external_current_matches` joined on `local_match_id`, carrying only `home_score`/`away_score` | Decision B — the typed projection, never the jsonb spine. That table has no attendance column, so attendance is simply not a shared field, which `classifyCorroboration()` already handles. Scores are oriented onto this proposal's home side before comparison. |
| `RETURNING (xmax = 0) AS inserted` distinguishes `candidatesCreated` from `candidatesRefreshed` | The pending unique index makes the upsert refresh one row; the counters must not conflate a new review item with a refreshed one. |

**O1 — the executable path.** Both projections are maintained by `INSERT … ON CONFLICT …
DO UPDATE` alone. A projection row is replaced in place when its observation moves; it is
never removed and re-inserted, so neither table is even momentarily empty inside the
transaction. No `DELETE` and no `TRUNCATE` statement exists against either table anywhere
in the module. This is stated here as an implementation fact; the **proof** is T7's, and
per the standing instruction it must run over executable SQL and the runtime path rather
than raw file text.

**Dry-run (§22).** `apply: false` executes the identical write path — same statements, same
constraints, same unique indexes, same role privileges — then throws `SettleDryRunRollback`
inside `sql.begin`, which discards everything including the `import_batches` row. It is not
a simulated or read-only path.

**Defect found and fixed during implementation.** The first draft of `scopeOf()` wrote a
**literal U+0000 byte** into the source as a map-key separator, which made
`settle-afltables.ts` register as binary to `file`, `grep` and diff — precisely the defect
`observations.ts` documents against. It is now the `\u0000` escape, with the reason stated
at the site. The character is unchanged; only its spelling is.

**Still T7, deliberately not built here:** the `data_issues` writer / refresher / resolver
with ownership scoping (§13), and the §23.2 reporting beyond the counter block. §26 assigns
both to T7, and each has its own gate in `tests/integration/settle-afltables.test.ts`. The
`sourceDisagreement` counter and the refusal candidate are already produced, so a
disagreement is visible to a reviewer today; only the deduplicated `data_issues` row is
outstanding. `dataIssuesOpened` / `Refreshed` / `Resolved` are reported and are 0 until
that writer lands.

#### T6b slice 2 typecheck comparison — ZERO regressions (2026-08-29, user-run)

```bash
npm run typecheck
```

```
Found 13 errors in 4 files.
```

| File | Pre-T6 baseline | Post-T6a | Post-T6b slice 2 | Delta |
|---|---|---|---|---|
| `tests/db-test-rebuild.test.ts` | 4 | 4 | 4 | 0 |
| `tests/draftguru-acquisition.test.ts` | 7 | 7 | 7 | 0 |
| `tests/integration/draftguru-import.test.ts` | 1 | 1 | 1 | 0 |
| `tests/integration/observation-spine.test.ts` | 1 | 1 | 1 | 0 |
| **Total** | **13** | **13** | **13** | **0** |

Zero compiler errors in `src/lib/acquisition/settle-afltables.ts`,
`tools/current-season/settle-afltables.ts`, `src/lib/acquisition/observation-store.ts`,
`src/lib/external-afl/current-season-import.ts` or `tests/current-season-import.test.ts`.
No new error file appeared. **T6b slice 2 introduced zero compiler regressions.**

**Not yet written:** `tests/integration/settle-afltables.test.ts` (slice 3).

---

### T6 validation ladder — what remains, and what nothing existing can prove

Established before writing slice 3, so the ladder is not padded with runs that cannot fail
on account of this work.

**There is NO existing test that exercises the T6b transaction or the CLI.** The
runbook-required behavioural gate is `tests/integration/settle-afltables.test.ts` (§26 T6,
§28), and it does not exist yet — it is slice 3.

`tests/integration/observation-spine.test.ts` was examined as a candidate and **rejected as
a T6 gate**. Its own header states that `src/lib/acquisition/` "carries no persistence
layer at all", so it drives the pure decision functions and issues *"the SQL a persistence
layer would issue"* itself. It imports neither `observation-store.ts` nor
`settle-afltables.ts`. It therefore **cannot regress from T6**, and running it would prove
only that migration 074 still behaves — which no T6 change could have altered. §24 still
requires it to stay **13/13**, but as a standing invariant, not as evidence for this stage.

| Ladder step | Covers | Status |
|---|---|---|
| `npm test -- tests/current-season-import.test.ts` | T6a extraction + T6b slice 1 pure contract | **GREEN, 153/153** |
| `npm run typecheck` | every T6 file compiles against the real types | **GREEN, baseline held at 13/4** |
| `npm run lint` | the ~700 new lines of slice-2 transaction/CLI code — the only remaining EXISTING check that reads them | **GREEN for ISSUE-099 after one fix** |
| `npm test -- tests/integration/settle-afltables.test.ts` | the §26 T6 behavioural gate: idempotent rerun, A→B→A, I1–I4, candidate refresh-in-place, dry-run byte-identity, `canonicalRows*` = 0 as a runtime fact | **slice 3 — not yet written** |

#### Lint — repo-wide run and the ISSUE-099 slice (2026-08-29, user-run)

```bash
npm run lint
```

Repo-wide: **250 problems (171 errors, 79 warnings)**. There is **no pre-T6 repo-wide lint
baseline**, and this debt is **outside ISSUE-099 scope**. It is recorded here as an
observation only; nothing unrelated was repaired under this issue.

For the T6 files the result was narrow — **one finding**:

```
src/lib/acquisition/settle-afltables.ts:1229:19
warning  'registry' is assigned a value but never used  @typescript-eslint/no-unused-vars
```

Zero findings in `tools/current-season/settle-afltables.ts`,
`src/lib/acquisition/observation-store.ts`,
`src/lib/external-afl/current-season-import.ts` and `tests/current-season-import.test.ts`.

**Fixed, not suppressed.** `runSettleAfltables()` destructured `registry` out of `options`
and never read it: the registry is threaded down through `options` to `settleFamily()`,
which is its only reader. The destructure now takes `bundle` alone, with the reason stated
at the site. No rule was disabled and no `eslint-disable` comment was added — the warning
was true, and the dead binding is gone rather than silenced.

Targeted re-check, scoped to the ISSUE-099 T6 files only:

```bash
npx eslint src/lib/acquisition/settle-afltables.ts tools/current-season/settle-afltables.ts \
  src/lib/acquisition/observation-store.ts src/lib/external-afl/current-season-import.ts \
  tests/current-season-import.test.ts
```

Result: **exit clean, zero errors, zero warnings.**

**T6 evidence to date:** `current-season-import` **153/153** · typecheck at the exact pre-T6
baseline (**13 errors / 4 unrelated files**, zero in any ISSUE-099 file) · targeted ESLint
**0 errors / 0 warnings** across all five T6 files.

---

### T6b slice 3 — BLOCKED on an isolation decision (2026-08-29)

Writing `tests/integration/settle-afltables.test.ts` surfaced a contradiction between the
runbook's isolation precedent and the driver's own transaction contract. It is recorded
before any test is written, because the two available answers mutate `afldb_test`
differently and that is the user's call.

**The finding.** `tests/integration/observation-spine.test.ts` isolates itself by running
everything inside one outer transaction that always rolls back, seeding synthetic `sources`,
`seasons` and `auth_users` rows inside it. That pattern **cannot wrap
`runSettleAfltables()`**, which opens its own `sql.begin` per §21 S-D.

Verified in the driver, not assumed: `node_modules/postgres/types/index.d.ts:723-728`
declares `TransactionSql` with `savepoint` and `prepare` only — **no `begin`** — and
`node_modules/postgres/src/index.js:253` confirms the implementation, where the
transaction-scoped `Sql` is given `savepoint` and `prepare` and nothing else. Passing a
transaction in as the `sql` argument would therefore fail at runtime with
`sql.begin is not a function`, not silently degrade.

**Consequence.** The integration test must pass the top-level `sql`, so every `--apply`
run **commits**. Its fixtures must also be committed, because they have to exist before
the driver opens its own transaction.

**Fixture set, already minimised.** `venues` is deliberately NOT seeded — `venue_id` is
nullable, so leaving the venue unmapped both avoids a canonical insert and exercises the
`venueUnmapped` path. No `matches` row is seeded either: with no canonical match, the
`matches` target is `new_target` (a `new` candidate) while `match_period_scores` and
`player_match_stats` are `unresolved` (refusal candidates) — which is the normal in-season
state on a rebuilt database and covers candidate creation and refusal without touching a
single canonical fact table.

| Option | What it mutates | Cost |
|---|---|---|
| **A — commit fixtures, delete them afterwards** (recommended) | `seasons(2099)`, two `clubs`, one `players`, one `external_identities`, and an `afltables` `sources` row if absent — all committed, then removed in `afterAll`, scoped by season 2099 and an `issue099-` record-id prefix | No production seam. Matches T8's operator flow exactly (dry-run → apply → apply-again). A mid-test crash could leave scoped fixture rows behind. |
| **B — add a savepoint seam to `runSettleAfltables()`** | Nothing: the whole test rolls back, exactly like the spine suite | Puts a test-only branch in the production transaction boundary, which §22 requires to be the same path in both modes. |

**Recommendation: A.** B buys perfect isolation by weakening the one contract §22 exists to
protect. A mutates four canonical tables **as fixtures**, never as settle output, and the
run itself is still provably canonical-write-free.

**O1 proof, over runtime behaviour rather than file text** (both mechanisms need no special
privilege and no DDL):

1. a **sentinel row** is inserted into each 076 projection before the run and asserted still
   present after — a `TRUNCATE`, or any unscoped `DELETE`, would have removed it;
2. `pg_stat_xact_user_tables.n_tup_del` for both projections is asserted **0** across the
   run — proving no row was deleted at all, targeted or otherwise.

**§15 proof, as a runtime fact:** row counts of `matches`, `match_period_scores`,
`player_match_stats` and `brownlow_round_votes` are snapshotted immediately before the
settle run and re-read after, and `canonicalRowsInserted` / `canonicalRowsUpdated` are
asserted to be literally 0.

---

Slice 3 will require DB work against `afldb_test`. The exact command and the state it
touches will be stated before it is run.

**Note for the T7 O1 proof.** `tests/current-season-import.test.ts` already carries a
`sqlStatements()` helper that strips `--` comments and splits on `;`. The final O1 proof
must run over **executable statements** extracted that way (and over the runtime code
path), not over raw file text — otherwise prose can create a false positive and correct
prose has to be contorted to avoid a keyword. The T6a source gate is the weaker
whole-file form and is to be upgraded, not relied on alone.

---

### T6b slice 3 — isolation decision ACCEPTED; the integration gate written (2026-08-29)

**Decision (user-adjudicated).** Option **A — commit dedicated fixtures, then clean them
up**. Option B is rejected outright: a test-only savepoint seam inside
`runSettleAfltables()` would put a branch in the one transaction boundary §22 exists to
protect, and that boundary is the subject under test. The production transaction is left
exactly as it is, and it is what the gate exercises.

**Approved namespace:** the `issue099-` external-record-id prefix, and fixture season
**2094** — see §7 below. (The namespace was first approved as season 2099; the year was
moved on user instruction 2026-08-29 to remove a shared fixture key. Every other isolation
decision is unchanged.)

Written: `tests/integration/settle-afltables.test.ts`.

#### 1. What the suite can mutate

This is stated plainly because "the test changes nothing" would be false.

| Relation | Written by | Removed by |
|---|---|---|
| `seasons` (2094) | fixture, `ON CONFLICT DO NOTHING` | cleanup |
| `players` (one row, slug `issue099-fixture-player`) | fixture | cleanup |
| `external_identities` (one `afltables_profile_url` link) | fixture | cleanup |
| `sources` (`afltables`) | fixture, **only if absent** | cleanup, **only if this run created it** |
| `import_batches` | fixture + every apply | cleanup |
| `staging.source_payloads` / `source_record_versions` / `source_records` | fixture + every apply | cleanup |
| `staging.afltables_match` / `afltables_player_match` | fixture sentinels + every run | cleanup |
| `promotion_candidates`, `import_rejections` | apply runs | cleanup |
| `clubs`, `venues` | **never written — read only** | — |
| `matches`, `match_period_scores`, `player_match_stats`, `brownlow_round_votes` | **never** | — |

`clubs` is READ, not seeded: the fixture takes two existing historical identities and
builds the projection from their `legacy_club_hist` values, so no canonical identity row
is invented. No venue is mapped, so `venue_id` stays NULL and `venueUnmapped` is
exercised. No `matches` row is seeded, so `matches` is `new_target` and every dependent
target is `unresolved` — the normal in-season state, and candidate creation plus refusal
without one canonical fact.

#### 2. Pre-clean and teardown

`cleanupIssue099()` is called **before setup** as well as in `afterAll`, because an
interrupted run leaves committed rows that `afterAll` never got to remove. Dependency
order: projections → candidates → rejections → `source_records` → `source_record_versions`
→ `source_payloads` → `external_identities` → `players` → `import_batches` → `seasons`.

Scope is the `issue099-` prefix on the record id (or `source_record_id`, `external_id`,
`slug`, `tool`/`notes`). Payloads are content-addressed and carry no record id, so every
fixture payload carries an explicit `issue099_fixture` marker key and is deleted by that.

#### 3. How the shared `sources` row is protected

The pre-clean **never** touches `sources`. Setup reads the `afltables` row and creates one
only when genuinely absent, recording ownership in a module flag; `afterAll` deletes it
only when this process created it. A pre-existing row is read and left byte-identical. A
row orphaned by an interrupted run is therefore never deleted by a later run — correct,
because it is legitimate reference data either way.

#### 4. How canonical fact immutability is measured

Two independent measurements, both runtime:

1. **Row counts of all four fact tables are captured immediately before and immediately
   after EVERY settle invocation in the file** (the `runSettle()` wrapper), not once at
   the end, and asserted equal. `canonicalRowsInserted` / `canonicalRowsUpdated` are
   asserted `0` at the same point. This catches an insert or a delete by any run.
2. **Transaction identity.** Each settle transaction's xid is read back from the
   `import_batches` row that transaction itself inserted — `SELECT xmin FROM
   import_batches WHERE id = <batchId>` — so it is the real transaction, not a time
   window. At the end, every fact table is scanned for a surviving tuple whose `xmin` is
   one of those xids. An UPDATE writes a new tuple version carrying the updating xid, so
   this covers updates, which a row count cannot.

#### 5. The final O1 proof — and why `pg_stat_xact_user_tables` is NOT used

**`pg_stat_xact_user_tables` is rejected.** It reports only statistics accumulated by the
**current transaction on the current backend**. `runSettleAfltables()` runs inside its own
`sql.begin`; any assertion the test makes is a different transaction, and by the time it
runs the settle transaction's per-transaction counters no longer exist. A later
`n_tup_del = 0` from the test connection would be a statement about the test's own empty
transaction and would pass no matter what the settle pass did — a vacuous check, which is
worse than no check. The cumulative `pg_stat_user_tables` is no better without machinery:
its flush is rate-limited, so a zero cannot be distinguished from "not yet flushed".

The proof adopted is two-part, and the parts cover each other's gap:

1. **Executable-SQL extraction (covers a targeted delete).** postgres.js issues SQL only
   through tagged templates, so the executable statements of
   `settle-afltables.ts`, `observation-store.ts` and the CLI are exactly the template
   bodies. They are extracted, interpolations stripped, and asserted to contain no
   `DELETE FROM` and no `TRUNCATE` at all. Prose is excluded by construction, so this is
   not the whole-file grep the T6a gate used. It is guarded against vacuity: the
   extraction must yield ≥ 20 statements, must contain the two projection upserts, the
   `promotion_candidates` upsert and the spine version insert, and **every** extracted
   body must begin with `SELECT`/`INSERT`/`UPDATE`/`WITH`. Both projection inserts must
   carry `ON CONFLICT … DO UPDATE SET`.
2. **Runtime sentinels (covers anything dynamic).** One row is seeded in each migration-076
   projection under a record id no bundle ever names, in a scope no enumeration covers.
   After every run in the file both are asserted still present **and still stamped with
   the fixture batch id** — so neither a `TRUNCATE`, nor an unscoped `DELETE`, nor a
   rewrite reached them.

Residual gap, stated rather than hidden: a *targeted* delete-then-reinsert of the pass's
own projection row is invisible to the sentinel and is caught by (1) alone. There is no
no-DDL runtime discriminator for it — both projections' `DO UPDATE SET` lists cover every
non-key column, so no column survives an update that a re-insert would reset.

#### 6. Coverage

Dry-run retains nothing (§22, before any apply) · first apply's creation facts · **I2**
an unkeyed rejection makes the scope unsweepable and nothing in it is stamped · idempotent
rerun (0 payloads, 0 versions, 0 candidates created or refreshed, 0 new rejections, same
rows still attributed to the original batch) · **I3** a genuine omission inside a
proven-complete scope IS marked absent, and no other scope is touched · **I1** an
observed-but-rejected record stays present, keeps its full payload and writes no
projection row · **I4** reappearance clears absence and appends no version · **A → B → A**
three ordered versions over two payloads, projection re-pointed at the open version ·
dry-run after the applies leaves every ISSUE-099-owned relation byte-identical · O1 ·
§15 · restricted `afldb_import` role parity (a dry run through the restricted DSN, skipped
with the standard message when `AFLDB_TEST_IMPORT_DATABASE_URL` is unset).

`data_issues` open/refresh/resolve and the §23.2 counter reporting are **not** here: §26
assigns them to T7, which extends this same file.

#### 7. Fixture season — why it is 2094, not 2099

`tests/integration/observation-spine.test.ts` seeds `seasons(2099)` **inside a transaction
that always rolls back**. This suite **commits** its fixture season for the duration of
the file, so sharing the key would let a parallel full-suite run collide on the `seasons`
primary key — the spine suite's insert failing on a row this suite had committed. The §28
focused command avoids that today by running one file, but a shared fixture key retained
knowingly is future flakiness, so the key was moved rather than relied on.

**Selection (2026-08-29).** The test tree was searched for far-future season values. Every
`20[89]\d`/`2100` occurrence under `tests/`:

| Year | Where | Verdict |
|---|---|---|
| 2099 | `observation-spine.test.ts` (`seasons` row + `season=2099` scope), `awards-reload-links.test.ts` (award year) | taken |
| 2098 | `observation-spine.test.ts` (`season=2098` scope key), `awards-reload-links.test.ts` | taken |
| 2081/2085/2086/2089/2091 | `tests/fixtures/oracle_baseline.json` only — not season values, but avoided anyway | avoided |
| 2100 | an error-message string in `player-link-mutations.test.ts`; also the `seasons_year_ck` upper bound | avoided |
| **2094** | **nothing** | **selected** |

2094 also appears nowhere else in the repository (the only repo-wide match is an
incidental substring inside a sha256 hex digest) and is inside
`seasons_year_ck (1897–2100)`. It is used consistently for the `seasons` row, the scope
key `season=2094`, every projection `season`, every fixture date and every `observedAt`.
`observation-spine.test.ts` was not touched, and neither was any other suite.

#### 8. A NUL byte was removed before the first run

The first draft of `byRecordThenTarget()` joined its sort key with a literal `U+0000`,
copying the separator idea from `scopeOf()` in `settle-afltables.ts` but as a raw byte
rather than an escape. That is exactly what `scopeOf()`'s own comment warns against: it
made the test file **binary to `grep`, `file` and `diff`** (ripgrep refused to search it
and reported "binary file matches"). The separator is now `|`. TypeScript would have
compiled the file either way, which is precisely why this was worth catching — the defect
was in the tooling surface, not the behaviour.

#### 9. The command

```bash
npm test -- tests/integration/settle-afltables.test.ts
```

Requires `AFLDB_TEST_DATABASE_URL` (an `afldb_test` target, over the configured SSH
tunnel) with migration 076 applied. `AFLDB_TEST_IMPORT_DATABASE_URL` is optional; without
it the role-parity case is skipped and says so.

---

### T6b slice 3 — FIRST RUN: 4 passed / 9 failed / 1 skipped (2026-08-29, user-run)

The gate did its job on its first execution: it found a **driver defect that no DB-free
check in this issue could have found**, in code that typechecks, lints clean and passes
153/153 unit tests.

```
npm test -- tests/integration/settle-afltables.test.ts
→ 14 tests: 4 passed, 9 failed, 1 skipped
```

#### What passed, and what that already proves

- the `_test`-database / clean-namespace safety gate;
- **O1, 3/3 green** — the executable-SQL extraction is non-vacuous (≥20 statements, all
  beginning with a SQL verb, both projection upserts present), **no `DELETE FROM` and no
  `TRUNCATE` is sent**, and **both projection sentinels survived every attempted run**,
  still stamped with the fixture batch. O1 is therefore evidenced independently of the
  failure below, because the failing runs still executed the full write path before
  rolling back;
- the restricted-role case skipped for the designed reason
  (`AFLDB_TEST_IMPORT_DATABASE_URL` unset), not silently.

#### Root cause — ONE defect, in one statement

```
PostgresError: invalid input value for enum import_status: "succeeded"
  at src/lib/acquisition/settle-afltables.ts:1277
```

`import_status` is declared once, in migration 001:

```sql
CREATE TYPE import_status AS ENUM ('running', 'completed', 'failed', 'rolled_back');
```

There is no `'succeeded'` member. The settle driver's final batch update invented one, so
**every apply transaction aborted at its last statement and rolled back**. Classification:
**implementation defect in `settle-afltables.ts`, introduced in T6b slice 2. Not a schema
defect, not a test defect, and NOT a migration-076 defect** — 076 does not touch
`import_batches` or `import_status`, and was not edited.

Repository-wide confirmation that the driver alone was wrong: `'succeeded'` as a batch
status appears **nowhere else in the repository**. Every other writer uses `'completed'` —
`src/lib/ingest/pipeline.ts:291`, `src/lib/external-afl/current-season-import.ts:952`,
`tools/records/import-first-kick-goal.ts:1337`, and `tools/migration/common.py:231`, whose
`finish(status="completed")` / `"failed"` pair is the repository's batch-lifecycle
convention. Migration 001's own `ix_import_batches_status … WHERE status <> 'completed'`
keys on the same value.

#### The two cascading failures were confirmed as consequences, not separate defects

Both are explained entirely by "no apply transaction ever committed":

- *"keeps an observed-but-rejected record present and unprojected"* — the spine row it
  reads is written by an apply that rolled back;
- *"wrote no canonical fact row in any settle transaction"* — `settleXids.length` was 0
  rather than ≥5 because each xid is read from a committed `import_batches` row, and none
  survived. The vacuity guard on that assertion is what turned a silently-passing check
  into a visible failure, which is why it is there.

Neither was diagnosed as independent; neither test was touched.

#### A SECOND, independent defect found in the same statement while checking §4

Step 4 of the instruction — *does the settle lifecycle differ from existing import-batch
writers in another substantive way?* — found one that would not have failed any test:

```ts
records_rejected = ${counters.snapshotRejections}   // WRONG
```

`import_batches.records_rejected` is documented at migration 001 as *"must always equal the
number of `import_rejections` rows for the batch"*, and that is enforced in practice by the
shared writer: `tools/migration/common.py:253` passes `len(self._rejections)`.
`snapshotRejections` is a different fact — the number of records the **emitter** rejected
in the bundle. They diverge whenever one record refuses against more than one target. In
this suite's own fixture the bundle carries **1** rejected record while the apply writes
**4** `import_rejections` rows, so the batch row was understating its rejections four-fold.

Fixed by counting the rows the transaction actually wrote, inside that transaction:

```sql
SELECT count(*)::int AS n FROM import_rejections WHERE import_batch_id = <batch>
```

A hand-maintained tally was deliberately not used — it is the thing that drifts from the
writer. No `SettleCounters` field was added, so the §23.2 counter set is unchanged.

#### Test-side edits, stated explicitly

Per instruction, **no counter expectation was changed and no test was weakened.** Two
edits were made to the one batch-row assertion, both strengthening:

1. `expect(batchRow.status).toBe('succeeded')` → `'completed'`. This expectation was
   derived from the defective implementation and asserted a value the column's enum
   **cannot hold**; leaving it would have produced a guaranteed false failure rather than
   a discovery.
2. Added `expect(batchRow.recordsRejected).toBe(4)`, which pins the second fix against the
   four `import_rejections` rows the same test already counts.

#### Not changed, recorded as an observation only

`records_inserted` / `records_updated` stay at their `DEFAULT 0` on the settle batch, where
`current-season-import.ts:953-954` populates the equivalents with
`observationVersionsInserted` / `observationHeadsRefreshed`. No constraint, documented
invariant or test governs them here, and "inserted **what**" is genuinely ambiguous for a
pass whose whole point is that it inserts no canonical row. Changing them would be
inventing a semantic, so it was left alone and is noted here rather than fixed.

---

### T6b slice 3 — SECOND RUN: 12 passed / 1 failed / 1 skipped (2026-08-29, user-run)

Both first-run fixes held. 9 failures collapsed to 1, and the survivor is a **type
representation mismatch in the test's own expectation**, not a defect in the settle path.

```
npm test -- tests/integration/settle-afltables.test.ts
→ 14 tests: 12 passed, 1 failed, 1 skipped
```

The candidate-queue equality failed on one field only, every other field matching:

```
expected createdByBatchId: "17"      <- a STRING
received createdByBatchId:  17       <- a NUMBER
```

#### Adjudication — the number is canonical, and the test was wrong

The two sides were read through different type boundaries:

| Side | Query | Type out |
|---|---|---|
| received — `candidateRows()` | `created_by_batch_id::int AS "createdByBatchId"` | int4 → JS **number** |
| expected — `result.batchId` | driver's `RETURNING id`, **uncast**, on `import_batches.id bigint` | int8 → JS **string** |

`import_batches.id` is `bigint … GENERATED ALWAYS AS IDENTITY` (migration 001:55), and
postgres.js renders int8 as **text** rather than risk a lossy `Number`. This is the
repository's standing `int8` hazard, and it is why the fixture inserts in this very suite
already read ids as `RETURNING id::int` — those comparisons (`fixtures.batchId` against
`max(projected_by_batch_id)::int` in the O1 sentinel case) passed on the first run.

**The DB column and the candidate query are correct**: after the explicit `::int` the value
genuinely is a number, and the number is the canonical representation at this boundary.
The defect was that the *expected* array was built from a value of the other type.

Fixed **test-side only**: the reported id is normalised with `Number(result.batchId)` and
asserted to be an integer, so the normalisation cannot paper over a non-numeric value. The
query was not loosened, the assertion was not weakened, and **no driver semantics or
candidate persistence changed**.

#### Latent finding — NOT fixed, recorded for a decision

`SettleRunResult.batchId` is declared `number | null` (`settle-afltables.ts:1074`) but is a
**string** at runtime, because the driver's `RETURNING id` at `:1256` carries no cast while
its row type claims `{ id: number }`. Nothing currently breaks: every consumer either
interpolates it into a message or passes it straight back as a SQL parameter, where a
string binds correctly to a bigint column. But it is a false type declaration of exactly
the kind that makes a future `=== someNumber` or a number-keyed lookup miss silently.

It was deliberately **not** repaired under this run, because both repairs are out of
proportion to a test assertion:

- adding `::int` to the driver's `RETURNING` is a **lossy cast on a bigint identity
  column** and must not be done casually;
- correcting the declared type to `string` ripples through `SettleRunResult`, the CLI and
  every caller.

Recommended as a small, separately-decided follow-up: keep the bigint, declare the field
honestly (`batchId: string | null`), and let the CLI keep interpolating it. Not actioned
here; the runbook does not authorise it and it is not needed for T6.

---

### T6b slice 3 — THIRD RUN: GREEN, 13 passed / 1 skipped (2026-08-29, user-run)

```
npm test -- tests/integration/settle-afltables.test.ts
→ Test Files 1 passed · Tests 13 passed, 1 skipped · 5.14s
```

Behaviours proved against real PostgreSQL:

| # | Behaviour | §26/§24 item |
|---|---|---|
| 1 | `_test` database + clean namespace safety gate | isolation |
| 2 | full write path in `--dry-run` retains nothing | §22 |
| 3 | apply persists observations, projections and candidates | §11, §17, §14 |
| 4 | an incomplete scope refuses the absence sweep | **I2**, §19 |
| 5 | idempotent rerun — 0 payloads, 0 versions, 0 candidates, 0 rejections | §18.1 |
| 6 | a genuine omission becomes absent only in a proven-complete scope | **I3**, §19 |
| 7 | an observed-but-rejected record stays present and unprojected | **I1**, §19 |
| 8 | reappearance clears absence without appending a version | **I4** |
| 9 | A → B → A is three ordered versions over two payloads | §18.1 |
| 10 | post-apply dry-run leaves every ISSUE-099-owned relation byte-identical | §22 |
| 11-13 | **O1 3/3** — extraction non-vacuous · no `DELETE`/`TRUNCATE` sent · both sentinels survive | **O1** |
| 14 | no canonical fact row written by any settle transaction | **§15** |

Skipped (1): restricted `afldb_import` role parity — `AFLDB_TEST_IMPORT_DATABASE_URL` is
not set. Adjudicated below.

---

### T6 — COMPLETION ADJUDICATION (2026-08-29)

#### A. Is the restricted-role case mandatory to close T6? **No — conditional, by design.**

Re-read against the authoritative text rather than assumed:

- **§26 T6's gate cell** names exactly two artefacts: `tests/current-season-import.test.ts`,
  then `tests/integration/settle-afltables.test.ts`. It says nothing about a second DSN.
- **§28** lists the settle integration command with no import-role variable anywhere in the
  block.
- **§24's** settle row does list "restricted `afldb_import` role parity" — but that same
  cell also lists `data_issues` open/refresh/resolve, which **§26 assigns to T7**. The cell
  therefore describes the file's *eventual* coverage across T6 **and** T7, not T6's gate.

The skip is also the repository's established convention, not an ISSUE-099 invention:
`tests/integration/import-role-parity.ts` exports `IMPORT_ROLE_PARITY_SKIP_MESSAGE` for
exactly this, and `awards-reload-links`, `dob-enrichment-issues`, `draftguru-import` and
`data-editor` all skip the same way when the variable is absent. The case announces the
reason in its own title rather than passing silently.

**Recorded accurately, and no requirement invented.** It remains genuinely outstanding for
§24's full matrix and is a sensible companion to **T8**'s operator proof. To run it, set
`AFLDB_TEST_IMPORT_DATABASE_URL` to the **same host and same `_test` database** as
`AFLDB_TEST_DATABASE_URL` but authenticating as **`afldb_import`** — the harness refuses
any DSN whose endpoint or database differs, or whose `current_user` is not `afldb_import`.
It is not required to close T6.

#### B. `SettleRunResult.batchId` — adjudicated, and NOT closed silently

The declaration is false: `batchId` is declared `number | null` and is a **string** at
runtime. The question posed was whether correcting it belongs inside T6 because this
implementation introduced it. Evidence says **the falsity is not ISSUE-099's to fix alone**:

`src/lib/external-afl/current-season-import.ts:783-789` — ISSUE-098's importer, written
before this issue — reads its batch id the identical way:

```ts
const [batch] = await tx<{ id: number }[]>`
  INSERT INTO import_batches (...) RETURNING id            -- bigint, uncast
`;
```

That same value is passed into `observation-store.ts`, whose
`persistSourceObservation(..., batchId: number, ...)` and
`markMissingObservationsAbsent(..., batchId: number, ...)` signatures **T6a extracted
verbatim under amendment A12's behaviour-preserving mandate**. So the `number` declaration
at the shared boundary is inherited, not introduced.

**The concrete contract reason to defer.** Making the declaration true requires typing the
row read as `{ id: string }` and threading `string` through
`settleFamily` → `projectRecord` → both projection writers → `recordOutcome`, and then
across into `observation-store.ts`'s two exported signatures — which are **shared with
ISSUE-098's importer**. Correcting them forces either a change to another issue's module or
a `number | string` union that is worse than either. The alternatives are both refused:
`RETURNING id::int` is a **lossy cast on a bigint identity column**, and re-declaring only
the public field while the internals keep saying `number` would state one value's type two
different ways inside one module.

**Nothing is currently wrong at runtime**: every consumer either interpolates the value into
a message or re-binds it as a SQL parameter, where PostgreSQL parses the text back to
bigint. The hazard is latent — a future `=== someNumber` or number-keyed lookup would miss
silently, which is exactly how this surfaced (a strict equality against a `::int`-cast
column).

**Disposition: deferred out of T6 with a stated reason, and tracked — not left silent.** It
warrants its own issue ID because it spans `settle-afltables.ts` (ISSUE-099),
`observation-store.ts` (shared) and `current-season-import.ts` (ISSUE-098). Recommended fix
when filed: keep the bigint, declare `string` at every boundary that carries it, and change
no SQL.

#### C. T6 acceptance criteria — reassessed

| Criterion | State |
|---|---|
| DB-free suite 153/153 | green **before** the slice-3 driver edit; **needs one re-run** |
| Typecheck at the exact pre-existing baseline (13 errors / 4 unrelated files, 0 in any ISSUE-099 file) | **not re-run since** the new test file and the driver edit |
| Targeted ESLint 0 errors / 0 warnings | **not run against the new test file** |
| Integration gate | **GREEN — 13 passed / 1 conditional skip** |
| O1 proved | **YES — 3/3**, extraction + sentinels, over executable SQL not file text |
| No canonical fact mutation | **YES** — counts bracketed around every run, plus the per-transaction `xmin` scan; `canonicalRows*` literally 0 |
| No T7-owned work pulled forward | **confirmed** — no `data_issues` writer, no §23.2 reporting; `SettleCounters` unchanged, no field added by either first-run fix |
| Migration 076 untouched and frozen | **confirmed** — both first-run defects were in `settle-afltables.ts`; 076 does not contain `import_batches` or `import_status` and was never opened |

**T6 is therefore behaviourally complete but not yet evidentially closed.** Two files
changed after the last typecheck/lint evidence was taken — `settle-afltables.ts` (the batch
status and `records_rejected` fix) and the new `tests/integration/settle-afltables.test.ts`
— and a criterion cannot be claimed from a run that predates the code it covers.

#### D. Evidence refresh — one new ISSUE-099-owned typecheck error, fixed

The refresh was worth running: it found a defect the green integration run could not,
because the test harness worked at runtime while being **type-incorrect**.

```
tests/integration/settle-afltables.test.ts:144
Type 'string' is not assignable to type 'number'.
```

`postgres.js` types `connection.statement_timeout` as a **number**. The suite's client
passed `'120000'` as a string. PostgreSQL accepts the text form of a GUC over the wire, so
every run behaved correctly and no test could have caught it — precisely the class of
defect a typecheck exists for.

Fixed at the one site, **not suppressed** — no `as`, no `@ts-expect-error`, no rule
disabled:

```ts
connection: { statement_timeout: 120000 },
```

This was the ONLY ISSUE-099-owned error. The remainder is exactly the established pre-T6
baseline, unchanged and untouched:

| File | Errors |
|---|---|
| `tests/db-test-rebuild.test.ts` | 4 |
| `tests/draftguru-acquisition.test.ts` | 7 |
| `tests/integration/draftguru-import.test.ts` | 1 |
| `tests/integration/observation-spine.test.ts` | 1 |
| **total** | **13, in 4 unrelated files** |

Targeted ESLint over all six T6 files ran after the typecheck and produced **no output** —
0 errors, 0 warnings.

Because the integration test file changed again after its last green database run, the
gate is **re-run rather than claimed from the earlier output**. T6 closes on that refreshed
evidence, not on the 13/1 result that predates this fix.

---

## T6 — COMPLETE (2026-08-29)

Closed on refreshed evidence taken **after** the last change to every file it covers. No
criterion is claimed from an earlier run.

### Final evidence, user-run

```bash
npm test -- tests/integration/settle-afltables.test.ts
npm run typecheck
npx eslint src/lib/acquisition/settle-afltables.ts src/lib/acquisition/observation-store.ts \
  tools/current-season/settle-afltables.ts src/lib/external-afl/current-season-import.ts \
  tests/current-season-import.test.ts tests/integration/settle-afltables.test.ts
```

| Gate | Result |
|---|---|
| `tests/integration/settle-afltables.test.ts` | **1 file passed · 13 passed / 1 conditional skip · 4.96s** |
| `npm run typecheck` | **exactly the pre-T6 baseline — 13 errors in 4 files, ZERO in any ISSUE-099 file** |
| targeted ESLint, all six T6 files | **silent clean — 0 errors, 0 warnings** |

Baseline breakdown, unchanged and untouched: `db-test-rebuild.test.ts` 4 ·
`draftguru-acquisition.test.ts` 7 · `integration/draftguru-import.test.ts` 1 ·
`integration/observation-spine.test.ts` 1. The `statement_timeout` error found in the
previous refresh is gone.

Earlier DB-free evidence remains valid for what it covers:
`tests/current-season-import.test.ts` **153/153**.

### Deliverables

| File | Status |
|---|---|
| `src/lib/acquisition/observation-store.ts` | new — behaviour-preserving extraction (A12) |
| `src/lib/acquisition/settle-afltables.ts` | new — pure contract + settle transaction |
| `tools/current-season/settle-afltables.ts` | new — operator CLI, review-first |
| `src/lib/external-afl/current-season-import.ts` | re-pointed at the extracted store only |
| `tests/integration/settle-afltables.test.ts` | new — the §26 T6 behavioural gate |
| `tests/current-season-import.test.ts` | extended — the DB-free contract home |

### Carried forward — binding facts for T7 and beyond

1. **O1 is satisfied for T6.** The executable-SQL proof is non-vacuous (≥20 extracted
   statements, all beginning with a SQL verb, both projection upserts present); **no
   `DELETE FROM` and no `TRUNCATE` is sent**; both projection sentinels survived every run
   still stamped with the fixture batch. The proof runs over extracted executable
   statements and runtime state, **not** raw file text.
2. **No canonical fact row was written by any settle transaction** — proved twice over:
   row counts of all four fact tables bracketed around *every* run, plus a per-transaction
   `xmin` scan keyed on the transaction id of the `import_batches` row each transaction
   inserted. `canonicalRowsInserted` / `canonicalRowsUpdated` are literally 0.
3. **No T7-owned work was pulled forward.** There is no `data_issues` writer, refresher or
   resolver, and no §23.2 operator reporting beyond the counters the CLI already prints.
   `SettleCounters` is unchanged — neither first-run fix added a field.
4. **Restricted `afldb_import` role parity remains an explicitly CONDITIONAL outstanding
   matrix check**, not a T6 debt. §26/§28 never required it; §24's cell mixes T6 and T7
   coverage. It skips by the repository's standard mechanism when
   `AFLDB_TEST_IMPORT_DATABASE_URL` is unset, and is naturally run alongside **T8**'s
   operator validation. To run it, point that variable at the same host and same `_test`
   database as `AFLDB_TEST_DATABASE_URL`, authenticating as `afldb_import`.
5. **The bigint `batchId` runtime/type mismatch is separately tracked cross-issue typing
   debt.** `SettleRunResult.batchId` is declared `number | null` and is a string at
   runtime. It is NOT fixed as part of T6 closure: the same uncast `RETURNING id` pattern
   predates this issue at `current-season-import.ts:783-789`, and the shared
   `observation-store.ts` signatures it flows through were extracted verbatim under A12.
   Nothing misbehaves at runtime; the hazard is latent. **Do not** cast the bigint to `int`
   to satisfy a type.
6. **Migration 076 is applied and checksum-frozen. It must never be edited.** Any defect in
   it requires a forward migration. Both T6 first-run defects were in
   `settle-afltables.ts`; 076 contains neither `import_batches` nor `import_status` and was
   never opened.

### T7 boundary — NOT started

T7 owns: the `data_issues` writer / refresher / resolver with ownership scoping
(`SETTLE_ISSUE_OWNER` = `AFLDB-ISSUE-099`, never resolving a row it does not own), and the
§23.2 dry-run/apply counter reporting. Its gate extends **this same** integration file with
I3/I4 `data_issues` cases, dry-run invariance and the zero-canonical assertion. The
identity helpers it needs — `settleIssueKey()`, `SETTLE_ISSUE_TYPE`, `SETTLE_ISSUE_OWNER`,
`disagreementSeverity()` — already exist and are unit-tested; migration 076 already carries
`data_issues.issue_key` and `uq_data_issues_open_by_key`. No schema work is required.

---

## T7 — the `data_issues` disagreement lifecycle

### T7 accepted decisions (2026-08-29)

Five questions were raised from the runbook before any T7 file was edited. All five were
answered by the user; **A11/A12 precedent applies — these are accepted amendments, not
reinterpretations made during implementation.**

**A13 — §26's "incl. I3/I4" for T7 is the `data_issues` lifecycle, not the spine.**
T6 already proved the spine I3/I4 invariants (genuine omission becomes absent only in a
proven-complete scope; reappearance clears absence without an unnecessary version). T7 does
**not** re-implement them. It adds the `data_issues` open → refresh → resolve lifecycle and
re-runs the same integration file so the established spine invariants stay green.

**A14 — resolution requires POSITIVE current-run evidence.** The originally proposed rule —
leave a row open whenever `reconcile()` returns `unchanged` before corroboration — was
**rejected**: it would let a stale disagreement stand indefinitely after another provider
moved from disagreement to agreement, purely because the AFL Tables payload itself had not
moved. T7 owns the disagreement lifecycle and may **re-evaluate corroboration for an open
ISSUE-099 row independently of `reconcile()`**, without altering the shared reconciliation
precedence in `reconciliation.ts`.

An open ISSUE-099 `source_disagreement` may auto-resolve only when **all seven** hold:

| # | Gate | Where decided |
|---|---|---|
| 1 | the AFL Tables source record is present in this bundle | settle transaction (S3) |
| 2 | its family/scope is valid for this run | settle transaction (S3) |
| 3 | the record is valid/projectable enough to repeat the comparison | settle transaction (S3) |
| 4 | corroboration is explicitly re-evaluated, even on an unchanged payload | settle transaction (S3) |
| 5 | at least one comparable independent provider group currently exists | `agreementRestored()` |
| 6 | `disagreeingGroups` is empty | `agreementRestored()` |
| 7 | at least one group positively agrees on the applicable shared fields | `agreementRestored()` |

Then and only then: `resolved_at = now()`, `resolution = 'source_agreement_restored'`.

Never resolved when the record is absent from the bundle, the scope is incomplete, the
record is rejected/unkeyable/unprojectable for the comparison, no comparable provider group
currently exists, the disagreement was simply not re-tested, or the row is not owned by
AFLDB-ISSUE-099. This is the absence-sweep principle applied to disagreement:
**"not observed disagreeing" is not "agreement restored."** SC4 is unaffected — an
identical rerun refreshes the one open row rather than duplicating it.

**A15 — multi-group conflicts merge per field.** One conflict object per **field**, never
one per (field, group) pair: `{ field, afltables, <groupA>: value, <groupB>: value, … }`.
Only groups that disagree **on that field** are included; field order and group-key order
are deterministic; the single-group case degenerates to §13.1's example exactly. Individual
provider rows are never counted as separate groups.

**A16 — `warning` severity is a recorded v1 limitation.** `staging.external_current_matches`
(migration 063) carries no attendance column, so `attendance` is never a shared field and
every conflict reachable from the v1 corroboration surface is a score conflict. `error` is
therefore the only presently reachable severity. `disagreementSeverity()` stays generic
because it accurately implements §13.1; `warning` remains structurally supported but
currently unreachable. **Neither the staging schema nor another source is widened to make it
reachable, and no warning-severity coverage is manufactured.**

**A17 — one canonical `matches` fixture row is approved for the T7 integration gate**, under
eight conditions (§26 T7 S4). `source_disagreement` is reachable only when a canonical match
exists — `corroborationClaims()` returns `[]` otherwise — and is owned by `afltables`, since
`foreign_owned_collision` outranks `source_disagreement` in `VERB_PRECEDENCE`. The fixture
uses a **separate** `issue099-match-disagree` record and match key so T6's deliberately
unresolved `MATCH_KEY` behaviour is unchanged. **The invariant is that SETTLE performs zero
canonical fact mutations, not that the integration harness never inserts a fixture.** The
harness insert happens before the canonical baseline is captured, must fail closed if the
dedicated key already exists, must never be adopted or overwritten, is cleaned in
dependency-safe order, and the per-transaction xid proof is preserved so any canonical
`matches` UPDATE by settle would still be detected.

**A18 — `promotion_decisions` joins the §22 byte-identity snapshot.** §22 names it, and
including it gives direct evidence that neither dry-run nor apply can alter the append-only
decision ledger, even though ISSUE-099 has no decision-writing path. Scoped to the
ISSUE-099 fixture namespace so unrelated concurrent activity cannot make it flaky. **No
`promotion_decisions` writer is added.**

### T7 slices

| Slice | Scope | Gate |
|---|---|---|
| **S1** | pure disagreement draft builder + the positive-evidence predicate, DB-free | `tests/current-season-import.test.ts` |
| **S2** | the open/refresh writer inside the settle transaction | `npm run typecheck` |
| **S3** | the positive-evidence resolver + §23.2 counters/reporting | targeted ESLint |
| **S4** | integration lifecycle: open → refresh → agreement-restored resolve → unchanged rerun; foreign-owned non-resolution; dry-run byte identity including `data_issues` and `promotion_decisions`; O1 and canonical immutability re-proved | `tests/integration/settle-afltables.test.ts` |

### T7 S1 — COMPLETE (2026-08-29)

Pure only. No transaction, resolver, CLI or integration code was written.

**Deliverables**

| File | Change |
|---|---|
| `src/lib/acquisition/settle-afltables.ts` | `DisagreementConflict`, `disagreementConflicts()`, `SettleDataIssueDraft`, `draftDisagreementIssue()`, `agreementRestored()`; A16 recorded on `disagreementSeverity()` |
| `src/lib/acquisition/reconciliation.ts` | **one keyword** — `sameValue()` is now exported |
| `tests/current-season-import.test.ts` | two new `describe` blocks, 14 cases |

The `sameValue()` export is behaviour-neutral and is **not** the change A14 forbade. It
exists so the row that *explains* a disagreement compares fields with exactly the semantics
that *classified* it; a second implementation could drift and produce a finding naming a
disagreeing group with no conflicting field to show for it. Reconciliation precedence,
`classifyCorroboration()` and every verb rule are untouched.

`draftDisagreementIssue()` fails closed twice: a draft with **no disagreeing group**, and a
draft **naming a disagreeing group with no conflicting field**, both refuse rather than
write a finding the evidence does not support.

**Gate — GREEN (2026-08-29, user-run)**

```bash
npm test -- tests/current-season-import.test.ts
```

| Result | Value |
|---|---|
| Test files | **1 passed** |
| Tests | **167 passed / 167** |
| Duration | **451 ms** |

New T7 coverage inside that total: the §13 `data_issues` disagreement draft **9/9**, and the
positive-evidence restored-agreement logic **5/5**. All **153** pre-T7 cases remain green —
no existing expectation was changed, relaxed or removed.

The draft cases prove: §13.1's exact row shape for a single group; the `owner` stamp that
alone authorises later resolution; a NULL `entity_id` for a target that does not exist yet;
A15's per-field merge with fixed key order (`field`, `afltables`, then groups sorted); field
ordering with an agreeing group never listed as a conflict; own-group drift excluded as a
witness and its value absent from the row entirely; one key per group however many provider
rows carry it, identical whichever order the evidence arrives in; and both fail-closed
refusals.

The resolver cases prove gates 5–7 of A14: agreement restores only on a comparable,
positively agreeing independent group; a still-disagreeing group blocks; **no other provider
at all** does not resolve; a provider sharing **none of the compared fields** does not
resolve; and this source's own group can never be the agreeing witness.

### T7 S2 — COMPLETE (2026-08-29)

The `data_issues` open/refresh writer inside the settle transaction. No resolution, no
reporting, no integration work.

**Deliverable:** `src/lib/acquisition/settle-afltables.ts` only.

**1. Corroboration claims are read once and shared.** `settleFamily()` hoists
`corroborationClaims()` into a local before `reconcile()` and passes the same array on to
`recordOutcome()`. The reconciler and the disagreement writer can never be handed two
different reads of the same providers, so a row cannot name a disagreeing group its
`conflicts` array fails to explain.

**2. `recordOutcome()` takes an options object.** Ten positional parameters plus three more
would have been unreadable. Mechanical change, one call site, no behaviour altered.

**3. `writeDisagreementIssue()`** — called only from `case 'source_disagreement'`:

```sql
INSERT INTO data_issues (entity_type, entity_id, issue_type, issue_key,
                         severity, description, details)
VALUES (…)
ON CONFLICT (issue_type, issue_key)
  WHERE issue_key IS NOT NULL AND resolved_at IS NULL
  DO UPDATE SET entity_id, severity, description, details
RETURNING (xmax = 0) AS inserted
```

- keyed by `settleIssueKey()` through `draftDisagreementIssue()`;
- migration 076's partial unique index makes a second open row **unrepresentable**, so a
  recurrence refreshes the one open row (SC4);
- **`detected_at` is absent from the `DO UPDATE SET` list** and its default applies only on
  INSERT, so it stays at first detection; the row `id` survives because a refresh is an
  UPDATE;
- `resolved_at` / `resolution` untouched — resolution is S3's, with its own evidence;
- `xmax = 0` drives `dataIssuesOpened` vs `dataIssuesRefreshed` from the **actual upsert
  result**, the same idiom as the `promotion_candidates` upsert;
- **no DELETE and no TRUNCATE on any path.** O1 holds; the new statement is an upsert.

Two deliberate choices, both commented at the call site. `entity_id` uses the **resolved**
target id, not the candidate's: `draftCandidate()` reports no target id for a refusal verb,
but a disagreement about an existing canonical row must name that row, and NULL must keep
its §13.1 meaning of "no target yet". `source_version_seq` comes from
`outcome.observation.versionSeq` — the same value `draftCandidate()` derives — so the
finding and the proposal can never cite different evidence. The corroboration report is
asserted non-null with a fail-closed message rather than defaulted.

Migration 076 untouched. `reconciliation.ts` untouched in this slice.

**Gate — GREEN (2026-08-29, user-run)**

```bash
npm run typecheck
```

**Found 13 errors in 4 files** — exactly the established pre-T7 baseline:
`tests/db-test-rebuild.test.ts` 4 · `tests/draftguru-acquisition.test.ts` 7 ·
`tests/integration/draftguru-import.test.ts` 1 ·
`tests/integration/observation-spine.test.ts` 1.

**ZERO errors in any ISSUE-099/T7 file, and no new error file.** The unrelated baseline
debt is left exactly as found.

### T7 S3 — COMPLETE (2026-08-29)

The positive-evidence resolver, the real §23.2 counters and the review-queue reporting.

**Deliverables:** `src/lib/acquisition/settle-afltables.ts` and
`tools/current-season/settle-afltables.ts`.

**Gates 1–4, in `settleFamily()`, per record and per target.** The lifecycle re-evaluates
corroboration **for itself, on every run**, whichever precedence branch `reconcile()` takes.
`reconciliation.ts` is untouched: the claims were already read once before `reconcile()` in
S2, so the re-evaluation is a direct `classifyCorroboration(contract, proposedValues,
claims)` call over the *same* contract, values and claims the reconciler saw.

| Gate | How it is checked |
|---|---|
| 1 record present in this bundle | the loop iterates this run's bundle records |
| 2 scope valid for this run | `completeScopes.has(\`${wireFamily}\|${record.scopeKey}\`)`, built from `planAbsenceSweep().sweepable` — §19's completeness proof reused |
| 3 projectable enough to repeat the comparison | `projected !== null`, so a rejected, unkeyable or unprojectable record is excluded |
| 4 explicitly re-evaluated | the `classifyCorroboration()` call itself, made even when the payload and version did not move |
| 5–7 | the pure `agreementRestored()` from S1 |

Only then does `settleIssueKey(...)` enter the run's `restoredKeys` set. **A key never enters
it because a disagreement merely failed to reappear.**

**`resolveRestoredDisagreements()`**, run after the family loop and the absence sweep and
**before** the batch `UPDATE`, so the counter reaches `validation_result`:

```sql
UPDATE data_issues
   SET resolved_at = now(), resolution = 'source_agreement_restored'
 WHERE issue_type = … AND issue_key = ANY(…::text[])
   AND resolved_at IS NULL AND details->>'owner' = 'AFLDB-ISSUE-099'
RETURNING id
```

UPDATE only — the finding survives as history, and there is no DELETE or TRUNCATE on the
path (O1). Ownership is matched exactly, so another writer's row can never be closed.
`resolved_at IS NULL` makes a rerun after resolution report zero. `dataIssuesResolved` is
`resolved.length` — **the rows PostgreSQL actually updated, never the keys planned** — so a
foreign-owned or already-closed key shows as a resolution that did not happen. `now()` is
transaction time, so a dry-run's resolutions roll back with everything else.

A record cannot both resolve and re-open in one run: `agreementRestored()` requires an empty
`disagreeingGroups`, which is exactly what `reconcile()` needs in order to *reach*
`source_disagreement`.

**Reporting.** The three counters are now real end-to-end: populated by S2/S3, already
persisted whole into `import_batches.validation_result`, already printed by the CLI's
`Data issues` group. `report()` gains the open ISSUE-099-owned `source_disagreement` queue
beside the pending candidates — severity in enum order (`error` first), issue key,
first-detected date and description, capped at 20 with a summary line beyond that. Not
season-scoped, because `data_issues` carries no season and inferring one from a record id
would be a guess. **Strictly read-only: the report offers no accept, resolve or retire
path.**

**Gate — GREEN (2026-08-29, user-run)**

```bash
npx eslint src/lib/acquisition/settle-afltables.ts src/lib/acquisition/observation-store.ts \
  tools/current-season/settle-afltables.ts src/lib/external-afl/current-season-import.ts \
  tests/current-season-import.test.ts tests/integration/settle-afltables.test.ts
```

**Silent clean — 0 errors, 0 warnings.**

### Recorded limitation — the refresh upsert is not ownership-scoped

`ON CONFLICT` infers migration 076's index, whose key is `(issue_type, issue_key)` and which
carries no owner column. So if some other writer ever held an **open** row on an
ISSUE-099-shaped `issue_key`, a recurrence would refresh **that** row rather than opening
its own. §13.3 states the ownership rule for **resolution** only, and §26's S2 instruction
specified exactly this upsert, so the writer implements the contract as written.

This is currently unreachable in practice — `issue_key` is namespaced
`afltables|<family>|<record>|<target>`, ISSUE-099 is the only writer that populates
`issue_key` at all, and migration 076 introduced the column. It is recorded rather than
fixed: narrowing it would need either a pre-read of ownership before the upsert or a schema
change, and neither is authorised under T7. The T7 S4 foreign-ownership case is deliberately
constructed so it does **not** depend on this path — it seeds the foreign row only while the
owned row is resolved, and removes it before the closing dry-run.

**Carried open, unchanged, for final ISSUE-099 / T8 adjudication.** Not fixed under T7 by
decision, not a defect in the contract as written, and not to be silently closed.

### T7 S4 — COMPLETE (2026-08-29)

The integration lifecycle proof. Only `tests/integration/settle-afltables.test.ts` changed;
no implementation file was touched in this slice.

**Fixture expansion (A17).** An opt-in `includeDisagreement` bundle option, **off by
default**, so every T6 expectation in the file is untouched and `issue099-match-key-a` stays
deliberately unresolved. `beforeAll` additionally reads-or-creates the `squiggle_api`
`sources` row on the same borrow-don't-own terms as the AFL Tables one, **refuses to run**
if anything already sits on `issue099-match-key-disagree`, inserts exactly **one** `matches`
fixture row on that key owned by `afltables` **before `canonicalBaseline` is captured**, and
inserts one `staging.external_current_matches` claim at 130 against AFL Tables' 132. The
file header states plainly that the harness creates a canonical fixture and why both §15
proofs still hold over it. Cleanup removes, in dependency-safe order, `data_issues` by key
namespace → `staging.external_current_matches` (it carries the `local_match_id` FK) →
`matches` by its dedicated key → batches → season.

Two consequences the design forced, both commented at the fixture:

1. the canonical row's `attendance` is **41000** against the projection's 42123, so
   `diffFields()` is never empty. Without a changed field `reconcile()` returns
   `history_only` at **step 5** and never reaches corroboration at **step 7** — the
   disagreement would have been *unreachable*, not absent. This is the single most
   important fixture fact in the slice.
2. the payload moves on **existing** keys (`away_points` / `margin`), the way the A → B → A
   case does, while the **projection stays fixed** — so the proposal put to corroboration is
   identical on every run and only the source version and the provider's claim vary.

**§22 / §24 snapshot.** `issue099Snapshot()` now also covers `data_issues` (scoped to this
suite's issue-key namespace) and `promotion_decisions` (joined through this suite's own
candidates — **no decision writer was added**, per A18). The closing dry-run is arranged so
it genuinely *wants* to write — the provider disagrees again and the payload moves — and
asserts `dataIssuesOpened === 1` and `versionsAppended === 1` **before** the byte-identity
comparison, so the invariance is not vacuous.

**Gate — GREEN (2026-08-29, user-run)**

```bash
npm test -- tests/integration/settle-afltables.test.ts
```

| Result | Value |
|---|---|
| Test files | **1 passed** |
| Tests | **18 passed / 1 conditional skip** |
| Duration | **8.11 s** |

Green data_issues lifecycle, 5/5:

1. **OPEN** — exactly one row for a genuine independent score disagreement.
2. **REFRESH** — the same row, `detected_at` preserved.
3. **RESOLVE** — on positive restored agreement **even though the AFL Tables payload did not
   move**. This is A14's proof: `reconcile()` returns `unchanged` at step 3 and never
   reaches corroboration, so the resolution can only have come from T7's own re-evaluation.
4. **POST-RESOLUTION IDEMPOTENCE** — an already-resolved row is not resolved again.
5. **FOREIGN-OWNED NON-RESOLUTION** — the same key, positively re-proved, left untouched
   because the owner differs.

Also green in the same run: **§22** dry-run byte identity, now including `data_issues` and
`promotion_decisions`; **O1 3/3** — the executable statement set is non-vacuous, no `DELETE`,
no `TRUNCATE`, and both projection sentinels survive; **§15** — no canonical fact row written
in any settle transaction, over a database that now *contains* a canonical fixture row; and
the existing **I1 / I2 / I3 / I4** spine behaviour, unchanged and not re-implemented (A13).

**The one skip** remains the restricted `afldb_import` role case, conditional on
`AFLDB_TEST_IMPORT_DATABASE_URL`. §26/§28 never required it; it is carried to **T8** with the
full §24 matrix, exactly as it was at T6 close.

---

## T7 — COMPLETE (2026-08-29), with one static-gate refresh outstanding

### Against §26's T7 cell

| Obligation | Status |
|---|---|
| `data_issues` **writer** | S2 — `writeDisagreementIssue()`, keyed by `settleIssueKey()` |
| `data_issues` **refresher** | S2 — `ON CONFLICT … DO UPDATE`, `detected_at` and row id preserved |
| `data_issues` **resolver** | S3 — positive-evidence only, UPDATE-only, ownership-scoped |
| **ownership scoping** | S3 — `details->>'owner'` matched exactly; proved by S4 case 5 |
| **§23.2 counters, dry-run and apply** | S2/S3 — real end-to-end, asserted in the run result *and* in `import_batches.validation_result` |
| **Gate: `settle-afltables.test.ts`** | 18 passed / 1 conditional skip |
| — incl. I3/I4 | A13: the `data_issues` lifecycle, plus the spine I3/I4 re-run green |
| — dry-run invariance | green, now non-vacuous and covering `data_issues` + `promotion_decisions` |
| — zero-canonical assertion | green, over a database containing a canonical fixture row |

### Slice evidence

| Slice | Gate | Result |
|---|---|---|
| S1 | `npm test -- tests/current-season-import.test.ts` | **167/167 · 451 ms** |
| S2 | `npm run typecheck` | **13 errors / 4 files — exact pre-T7 baseline, zero ISSUE-099** |
| S3 | targeted ESLint, six files | **silent clean — 0 errors, 0 warnings** |
| S4 | `npm test -- tests/integration/settle-afltables.test.ts` | **18 passed / 1 conditional skip · 8.11 s** |

### The V1 boundary held

No canonical fact write, no accept decision, no `promotion_decisions` writer, no canonical
provenance/acceptance schema. Migration 076 was never opened; no new migration was created.
`reconciliation.ts` received exactly one behaviour-neutral change — the `export` keyword on
`sameValue()` — and its precedence, verbs and `classifyCorroboration()` are untouched. No
`DELETE` or `TRUNCATE` on any settle path. The 13 unrelated TypeScript errors were left
exactly as found.

### Recorded, carried open

- **A16** — `warning` severity is structurally supported but currently unreachable from the
  v1 corroboration surface, because `staging.external_current_matches` carries no attendance
  column. No coverage was manufactured for it.
- **The ownership-scoped upsert limitation** above — 076's open-row unique key does not
  include owner, so an existing foreign-owned open row on an exactly ISSUE-099-shaped
  `issue_key` could be refreshed by the S2 upsert. **Unchanged, deliberately, and carried to
  final ISSUE-099 / T8 adjudication.**
- **The bigint `batchId` typing debt** — unchanged from T6 close, still cross-issue.

### Outstanding before T7 can be signed off

**One gate refresh, no code change.** S4 edited
`tests/integration/settle-afltables.test.ts`, and the typecheck (S2) and targeted-ESLint (S3)
evidence both predate that edit. Vitest type-strips rather than typechecks, so the green
integration run does not stand in for either. T6 held itself to exactly this standard —
"because the integration test file changed again after its last green database run, the gate
is re-run rather than claimed from the earlier output" — and T7 is held to it too.

```bash
npm run typecheck
npx eslint src/lib/acquisition/settle-afltables.ts src/lib/acquisition/observation-store.ts \
  tools/current-season/settle-afltables.ts src/lib/external-afl/current-season-import.ts \
  tests/current-season-import.test.ts tests/integration/settle-afltables.test.ts
```

Acceptance is unchanged: exactly the 13 baseline errors in the same 4 unrelated files with
zero in any ISSUE-099 file, and silent clean lint.

That refresh was subsequently run and was green — typecheck at exactly the 13-error / 4-file
baseline with zero ISSUE-099 errors, targeted ESLint silent. **T7 is COMPLETE AND SIGNED
OFF.**

---

## T8 — operator validation and close-out (IN PROGRESS, 2026-08-29)

### T8 amendments, accepted 2026-08-29 (user-adjudicated)

1. **Both carried limitations become separate tracked follow-up issues at ISSUE-099
   close-out**, not follow-up notes on the resolved entry: (a) the foreign-owner
   `data_issues` refresh limitation, (b) the cross-issue bigint `import_batches.id` /
   `SettleRunResult.batchId` runtime typing debt. **Neither blocks ISSUE-099.** The
   adjudication behind (a) is unchanged — see "Foreign-owner refresh — adjudicated" below.
2. **Before the first real `--apply`, three things are POSITIVELY PROVEN**, never inferred
   from a DSN string or an assumption: the target is `afldb_test`, the connected role is
   `afldb_import`, and the conditional restricted-`afldb_import` integration case passes.
   The first two are read from the live connection (`current_database()`, `current_user`).

### T8 environment prerequisite — PASS (2026-08-29, user-run)

```bash
Rscript -e "cat(R.version.string, '| fitzRoy', as.character(packageVersion('fitzRoy')), '\n')"
```

**R 4.6.1 (2026-06-24 ucrt) | fitzRoy 1.8.0.** The installed version equals the contract's
`pinned_version`, so the in-season completeness gate *"fitzroy_version_installed equals
pinned_version and fitzroy_version_match is true"* can be satisfied honestly. **O-A runs
directly from `D:\dev\afldb-issue-099`** — no Linux transfer, and `--allow-version-mismatch`
is neither needed nor permitted.

### T8 DEFECT D1 — the operator path double-prefixed an absolute manifest path

**Status: pre-transaction failure. NO DATABASE MUTATION OCCURRED. T8 PAUSED PENDING REPAIR
(now fixed; gates pending).**

The first real dry-run refused before a connection was opened:

```text
ENOENT: no such file or directory, open
'D:\dev\afldb-issue-099\D:\dev\afldb-issue-099\docs\rebuild-manifests\afltables_fitzroy_core\issue099-t8-20260829.json'
```

**What this does and does not prove.** The failure is in `loadBundle()`, stage S-C of §21 —
offline, fail-closed, *before* `createImportClient()` is ever called. The bundle file was
read and parsed and it named a `manifest_path`; nothing beyond that is evidenced by this run,
and **no O-A / O-B measurement is recorded here** because none was returned. No transaction
was opened, no row was written, no row was read, and `afldb_test` is untouched by it. The
fail-closed design behaved exactly as intended: an unverifiable snapshot could not reach
PostgreSQL.

**Root cause — one line, and it is NOT Windows-specific.**

| Question | Answer |
|---|---|
| Which value is already absolute | `bundle.manifest_path`. `import_fitzroy_core.py:88` builds `MANIFEST_ROOT` from `REPO_ROOT = Path(__file__).resolve()`, so line 1951 emits an **absolute** path on **every** platform, forward-slashed by `.replace("\\", "/")`. |
| Where it was treated as relative | `tools/current-season/settle-afltables.ts`, `loadBundle()` — `join(PROJECT_ROOT, raw.manifest_path)`. |
| Windows-specific, or broader | **Broader.** `join('/repo', '/home/u/afldb/docs/x.json')` on Linux yields `/repo/home/u/afldb/docs/x.json` — equally wrong, merely less visible. Windows only made the doubling loud, because a drive letter cannot hide mid-path. |
| Why no gate caught it | Every existing test constructs a bundle in memory and calls `validateSettleBundle()` / `runSettleAfltables()` directly. `loadBundle()` is the CLI's own adapter and **had never been exercised against a real emitted bundle** — T8's real acquisition is the first thing that ever did. |

**The fix.** `join()` is the wrong operator for a value that may already be absolute. The
resolution rule moved into the contract module as `resolveManifestPath(projectRoot,
manifestPath)`, which is string math and touches no filesystem:

- an already-absolute path is returned as it stands and is **never** re-prefixed;
- a repository-relative path still resolves against **this worktree's** root;
- `projectRoot` **must** be absolute or the call refuses — which is what keeps the result
  independent of the process's working directory. `PROJECT_ROOT` is derived from
  `import.meta.url`, so it always is.

Nothing else changed. Acquisition semantics, manifest contents, the bundle contract, the
digest comparison and every database behaviour are untouched; migration 076 was not opened;
no path validation was weakened — a manifest that is missing or altered still fails the
re-hash and refuses the whole run.

**Regression coverage** — `tests/current-season-import.test.ts`, the §24 DB-free home,
written against the resolution boundary itself rather than by mocking the settle
transaction: an emitter-shaped absolute path is not re-prefixed (asserted both as an equality
and as *the root appears exactly once*, which is the observed symptom stated directly); an
absolute path outside the worktree survives unrewritten; a repository-relative path still
resolves against the root; an empty `manifest_path` and a relative `projectRoot` both refuse.
The cases are platform-native, so they fail on Linux too if the defect returns.

**Files changed by D1:** `src/lib/acquisition/settle-afltables.ts` (new exported helper, one
`node:path` import, header note), `tools/current-season/settle-afltables.ts` (calls the
helper), `tests/current-season-import.test.ts` (the regression block).

### T8 finding D2 — a documentation defect, no code change

§23.1 step 6 shows `settle-afltables.ts --report` with no `--label`, which throws:
`parseArgs()` requires `--label` unconditionally, and `report()` needs the season from the
validated bundle. The **CLI is correct** — a report needs a bundle to know which season it is
reporting on. §23.1 is to be corrected to `--report --label <snapshot>` at close-out.

### D1 repaired — regression gate GREEN (2026-08-29, user-run)

```bash
npm test -- tests/current-season-import.test.ts
```

**171 passed / 171 · 471 ms.** The previous **167 stayed green** and the four new
manifest-path cases passed: an absolute emitter path is not re-prefixed; an absolute path
outside the worktree remains absolute; a repository-relative path still resolves against the
worktree root; a non-absolute project root fails closed. **D1 is repaired at the regression
level.**

### Gates made stale by D1

D1 edited two ISSUE-099 implementation/test files, so the T7 static and integration evidence
no longer describes the tree, by exactly the standard T6 and T7 held themselves to:

1. `npm test -- tests/current-season-import.test.ts` — **DONE, 171/171 above.**
2. `npm run typecheck` — acceptance unchanged: exactly 13 errors in the same 4 unrelated
   files, zero in any ISSUE-099 file. **Outstanding.**
3. targeted ESLint over the six ISSUE-099 files — silent clean. **Outstanding.**
4. `npm test -- tests/integration/settle-afltables.test.ts` — 18 passed / 1 conditional skip.
   `settle-afltables.ts` changed, so its green run predates the tree. **Outstanding.**

The real dry-run may run before 2–4 — it rolls back, and it is the only thing that exercises
the repaired `loadBundle()` path against a real emitted bundle. **All three must be green
before `--apply`.**

---

## T8 — O-A: the real 2026 in-season acquisition (2026-08-29, user-run)

Environment: **R 4.6.1 (2026-06-24 ucrt), fitzRoy 1.8.0**, from `D:\dev\afldb-issue-099`.

```bash
Rscript tools/rebuild/fitzroy/acquire_core.R --acquire --in-season \
  --label issue099-t8-20260829 --from 2026 --to 2026 --datasets player_stats,results
```

| Measure | Value |
|---|---|
| acquisition kind | **`in_season_partial`** |
| season | 2026 (single season, `--from` = `--to`, declared in progress) |
| matches observed | **207** |
| rounds observed | **1–25** |
| `player_stats` rows | **9522** |
| rows without profile URL | **0** |
| rows without `ID` (enrichment only) | **82** |
| `results` rows | 207 |
| total rows | 9729 |
| manifest | `docs/rebuild-manifests/afltables_fitzroy_core/issue099-t8-20260829.json` |

The acquirer reported completeness as **unvalidated**, correctly deferring adjudication to
the importer — `verdict_authority` names `--validate-only --require-in-season`, and the
acquirer never adjudicates its own snapshot.

## T8 — O-B: offline validation and observation emission (2026-08-29, user-run)

Both passes are offline. **Neither opened a database.**

**Validation** — `import_fitzroy_core.py --label issue099-t8-20260829 --validate-only
--require-in-season`:

matches **207**; matches_with_player_rows **207**; attendance_known **207**; players **668**;
players_with_dob **664**; players_with_dob_conflict **0**; player_match_rows **9522**;
venues 17; seasons 2026–2026; **brownlow_round_vote_rows 0**.

Identity gate over 9522 rows: **missing_id 82, missing_url 0, malformed_url 0,
distinct_ids 663, distinct_urls 668**. **In-season gates PASSED.**

**Emission** — the same importer with `--require-in-season --on-record-error reject
--emit-observations …/issue099-t8-20260829/observations.json`:

| Family | Records | `complete` |
|---|---|---|
| `afltables.match` | 207 | **true** |
| `afltables.player_match_stats` | 9522 | **true** |

**rejections 0, unkeyed_rejections 0.**

**F11 / U2 — the `Brownlow.Votes` measurement, on real 2026 bytes:** rows **9522**,
rows_with_votes **0**, rows_na **9522**, distinct_values **`[]`**,
projectable_round_vote_rows **0**, seasons_gated_for_round_votes **`[2026]`**.

### What this evidence establishes

- **SC1 is supported on the half that binds v1**: **0/9522** missing profile URLs and
  **0** malformed URLs, so every observed player-match row has the stable identity §6.2
  keys on. The stop condition is **not** triggered. The clause *"a `url` maps to two `ID`s"*
  is **not directly reported by this output** and is **recorded, not claimed** — the counts
  (663 ids across 668 urls) are consistent with it and imply five URL identities carry no
  `ID` at all, but consistency is not a measurement. It does not bind v1: identity is the
  URL, and `ID` is enrichment only.
- **`ID` could never have been mandatory identity** — 82/9522 rows carry none. The
  §2.1 binding correction to key on `url` rather than `ID` is confirmed by real data.
- **U2 is CLOSED** by measurement on real 2026 evidence, exactly as §30.1 specified,
  and the measurement rides in the bundle rather than in a side channel.
- **R3 is CONFIRMED, and is correct rather than a defect**: all 9522 `Brownlow.Votes`
  observations are NA, so there are **zero** projectable round-vote rows and there will be
  **zero** Brownlow candidates. No `0` was written for an unpolled round, no filler
  `played = true, votes = NULL` row exists, and 2026 stays gated/pending. In-season AFL
  Tables publishes no votes until the count; this is that fact, measured.
- **Both enumerations are `complete: true` with zero unkeyed rejections**, so neither family
  is barred from the absence sweep by §19 — the SC5 hazard does not arise for this snapshot.

## T8 — database identity evidence (2026-08-29, user-run)

`SELECT current_database(), current_user` over `AFLDB_TEST_DATABASE_URL` returned
**`afldb_test | afldb_owner`**.

The **database** is proven correct. The **role is not the apply role.** Under T8 amendment 2
this is **sufficient for the dry-run only**, which rolls back. Before the first `--apply`,
all three must hold: live database `afldb_test`, live role **`afldb_import`**, and the
restricted-role integration case green.

## T8 — the first real APPLY: batch 72 (2026-08-29, user-run)

Run over the positively verified **`afldb_import` @ `afldb_test`** connection. **Persistence
succeeded and canonical safety held.**

| Group | Result |
|---|---|
| Snapshot | matches 207, player rows 9522, rejections **0**, unkeyed rejections **0** |
| Observation | seen 9729, payloads created 9729, reused 0, **versions appended 9729**, unchanged 0, corrected 207, history-only 0, marked absent **0**, reappeared 0, **absence sweep skipped 0** |
| Projection / resolution | projection rows **8926**, venueUnmapped 0, nullInCoveredStat 0, unresolvedIdentity player **803** / club 0 / venue 0 / match **8926**, foreignOwnedCollision **0**, sourceDisagreement 0, manualAuthorityRefusals 0 |
| Review | created **10739**, refreshed 0, moot 0 |
| Data issues | 0 / 0 / 0 |
| **Canonical** | **inserted 0, updated 0** |

Applied as **import batch 72**. **No canonical row was written.**

Pending queue: `brownlow_round_votes / unresolved_identity` **803**; `matches / new` 207;
`match_period_scores / unresolved_identity` 207; `player_match_stats / unresolved_identity`
9522.

**What held.** §15 held — zero canonical rows over a real 9729-observation snapshot. §19 held
— both enumerations complete, nothing marked absent, no sweep skipped. F8/R1 did not bite:
`foreignOwnedCollision` is 0, so `afldb_test` carries no 2026 matches stamped by another
source. The arithmetic is coherent: 8926 projection rows = 207 matches + 8719 player rows,
and 9522 − 8719 = **803** player records whose profile URL is not linked in
`external_identities` on this database. `unresolvedIdentityMatch` 8926 = 207 period-score
targets + 8719 player-stats targets, all refusing because no canonical 2026 match exists yet
to key them on — R5, and correct.

### T8 DEFECT D2 — 803 spurious Brownlow candidates: R3 FAILED

**T8 PAUSED. Batch 72 RETAINED, unaltered. `--apply` again is BLOCKED until this is
resolved.**

The same bundle measured **rows_with_votes 0, rows_na 9522, distinct_values `[]`,
projectable_round_vote_rows 0** — there is no projectable Brownlow observation in the entire
snapshot. Yet 803 pending `brownlow_round_votes / unresolved_identity` candidates were
persisted. **R3 requires zero Brownlow candidates in-season.** The count is exactly
`unresolvedIdentityPlayer`, and the user's reading of the mechanism was correct.

**1. Why an NA record reached candidate persistence.** The per-target loop asked the
existence question of the wrong value:

```ts
const proposedValues = projected ? proposedValuesForTarget(targetTable, projected) : {};
if (projected && proposedValues === null) continue;   // <- gated on `projected`
```

`projected` is the **identity-resolved** projection, and is `null` whenever identity failed.
For the 8719 player records that did resolve, `proposedBrownlowValues()` returned `null`, the
guard fired, and no candidate was written — which is why every existing test passed. For the
**803** that did not resolve, `projected` was `null`, so `proposedValues` defaulted to `{}`,
the guard could not fire, and the loop went on to propose a vote the source never published.

**2. Is it generic "target refusal before target projectability"? Yes — an ordering defect,
and not Brownlow-specific in principle.** The loop resolved and refused a target before
establishing whether that target existed. The deeper error is that target existence was made
a function of identity at all: whether AFL Tables published a vote is a fact about the
source, and cannot depend on whether this database knows the player.

**3. The fix.** A new pure predicate, asked **first**, before `resolveTarget()` and before
any proposal:

```ts
export function targetEstablishedBySource(
  targetTable: SettleTargetTable, projection: JsonValue | null,
): boolean
```

It **takes no identity argument**, which makes the original mistake unstateable. A target it
rejects gets no resolution, no proposal, **no candidate and no `import_rejections` row** —
nothing is written about it at all, and nothing canonical is touched. `brownlow_round_votes`
exists only where the source published a vote; a **published 0 remains a real vote** and its
target exists; a record with no projection at all (uninterpretable) establishes no vote
either, because absence of evidence that a vote exists is not evidence that one does.
Presence is untouched — the observation is still persisted in full (§19). Shape knowledge
stays with `readPlayerMatchProjection()`, the one reader of that JSON, so the predicate
cannot drift from it.

Behaviour is **identical on every existing test**: the fixture player record resolves its
identity, so the old guard already fired for it. That is precisely why the defect survived
T6 and T7 — no fixture ever combined an unresolved identity with an absent optional target.

**4. Does it affect any other optional target? One latent case, NOT fixed here.**
`brownlow_round_votes` is the only target whose proposal is declared nullable, so it is the
only one the old guard ever covered. But `proposedPeriodScoreValues()` returns
`{ period_scores: [] }` rather than `null` for a match with no published quarter scores, so
such a match would produce a `match_period_scores` candidate proposing an **empty** array.
Unreachable in this snapshot — all 207 matches published period scores — and it is a
different function's return contract, so it is **recorded for adjudication rather than
changed** under "do not implement beyond this defect". A match-family record that Python
rejected still refuses on both match targets, exactly as `tests/integration/
settle-afltables.test.ts` asserts today; that behaviour is deliberately unchanged.

**5. Batch 72 after the fix — two options, decision required.** Re-applying on fixed code
will *not* clean up: the 803 spurious rows are simply no longer refreshed, so they would sit
in the pending queue forever, falsifying both the review queue and R3.

| Option | Scope | Cost |
|---|---|---|
| **Minimal** — delete only the 803 spurious `brownlow_round_votes` candidate rows from batch 72 | one `DELETE` on `promotion_candidates`, scoped to `target_table = 'brownlow_round_votes'` and `created_by_batch_id = 72` | Keeps the honest observation history. But the fixed code's first apply then reports `versionsAppended 0`, so the T8 "apply → apply-again" proof has no true *first* apply. |
| **Full scoped reset** (recommended) — remove ISSUE-099's entire batch-72 footprint in `afldb_test`: candidates, both 076 projections, `import_rejections`, the 074 spine rows for the two `afltables` families, and the `import_batches` row | operator-run, explicitly authorised, **`afldb_test` only** | Gives a genuine first apply (9729 versions appended) followed by a genuine idempotent rerun — the proof §26's T8 cell actually asks for. `afldb_test` is disposable and the integration suite's own fixtures are season-2094/2099-scoped, so they are untouched. |

Either way this is an **operator remediation of a defective run, not the settle path deleting
anything**: O1 constrains the executable ISSUE-099 path, which still issues no `DELETE` and no
`TRUNCATE`. No `promotion_decisions` row is written and no candidate is machine-retired (U3 /
F7 stand). **I recommend the full scoped reset**, and it must be user-authorised before any
statement runs.

### Regression coverage for D2

`tests/current-season-import.test.ts` — the §24 DB-free home, alongside the existing Brownlow
NA/zero cases: the exact 2026 NA shape establishes no target; a published **0** does; an
uninterpretable record does not; the three other targets are always established, including
for a rejected record; and the predicate agrees with `readPlayerMatchProjection()` in both
directions.

**DB-free gate — GREEN (2026-08-29, user-run)**

```bash
npm test -- tests/current-season-import.test.ts
```

**172 passed / 172 · 461 ms.** All 171 previous cases stayed green. The new case proves
**NA Brownlow ⇒ no `brownlow_round_votes` target at all, regardless of identity
resolution** — including that a published **0** still establishes the target, that an
uninterpretable record establishes none, that the other three targets are always established,
and that the predicate agrees with `readPlayerMatchProjection()` in both directions.

### D2 PostgreSQL regression — the combination that escaped T6 and T7

The DB-free cases pin the decision at the boundary, but the 803-row *shape* — an unresolved
player identity **and** an NA vote — was reproduced by nothing in the integration suite,
because its fixture player always resolves, so the old guard always fired. That gap is now
closed in `tests/integration/settle-afltables.test.ts`.

**Isolation (A18).** The case gets its **own record id, its own player URL and its own
scope key**, built by a dedicated `unlinkedPlayerBundle()` rather than by an option on
`bundleJson()`. **No signed-off T6/T7 fixture expectation, counter or candidate-set assertion
was altered.** A separate scope also means this bundle's enumeration can never sweep another
test's records: it enumerates exactly one record, in a scope holding exactly that record. The
URL is deliberately never linked in `external_identities`, and that premise is asserted
rather than assumed. It runs after the O1 block and before the §15 scan, so its transaction
id is still covered by the zero-canonical proof.

**What it proves, against a real transaction** — for one observation with valid source
identity, no local link and an NA vote:

- the record is **fully present** (§19) — seen, versioned, `absent_since` NULL;
- identity failed, so **no typed projection row** exists for it;
- **exactly one** candidate: `player_match_stats / unresolved_identity / pending`;
- **zero** `promotion_candidates` rows for `brownlow_round_votes`;
- **zero** `import_rejections` rows for `brownlow_round_votes` — `reason` is prefixed with
  the target table, so this is per-target, not merely per-record;
- **zero** `brownlow_round_votes` rows for the season, and `canonicalRowsInserted` /
  `Updated` are 0, bracketed by `runSettle()` around all four canonical fact tables;
- **no invented vote value** — not a `0`, not a `played = true, votes = NULL` filler.

And the converse, as a dry-run so no second observation is committed: with a **published 0**
the same unlinked player's Brownlow target **does** exist and **is** proposed — two targets,
not one. The payload has to move with it, or `reconcile()` answers `unchanged` and never
reaches a target at all.

O1 is intact — the change adds no `DELETE` or `TRUNCATE` to any settle path; migration 076
was not opened; no canonical fact DML exists; keyed source-presence semantics are unchanged.
The latent `match_period_scores` empty-array case is **deliberately not addressed here** and
remains recorded for follow-up adjudication.

**Integration gate — GREEN (2026-08-29, user-run)**

```bash
npm test -- tests/integration/settle-afltables.test.ts
```

**20 passed / 20 · 17.80 s — ZERO skipped.**

**The conditional role-parity case ran and PASSED**, because
`AFLDB_TEST_IMPORT_DATABASE_URL` is configured in this shell. That closes the **last unrun
cell of the §24 matrix**, carried as CONDITIONAL since T6 and nominated for T8: the whole
settle write path executes under the restricted **`afldb_import`** role against the same
`_test` database. It is no longer outstanding.

Green in the same run, unchanged by D1 and D2:

- the new **D2** case — *opens no Brownlow target for an unlinked player with an NA vote*;
- the `data_issues` lifecycle **5/5**;
- **O1 3/3** — no `DELETE`, no `TRUNCATE`, projection sentinels survive;
- **§15** zero canonical fact mutation;
- I1–I4, A → B → A, and §22 dry-run byte identity.

This run also discharges **stale gate 4**. Gates 2 (`typecheck`) and 3 (targeted ESLint)
remain outstanding and must be green before `--apply` resumes.

---

## T8 — batch 72 remediation (READ-ONLY inventory stage, 2026-08-29)

Batch 72 is **test-database operator remediation, not settle behaviour**. O1 governs the
executable ISSUE-099 path, which still issues no `DELETE` and no `TRUNCATE`; an explicitly
authorised cleanup of a defective run in `afldb_test` is outside it. **Nothing is deleted
until the inventory is read and the plan approved.**

### What the schema says before any query runs

- `staging.source_payloads` is **content-addressed and carries no batch column** — its key is
  `(source_id, family, payload_hash)`. A payload is therefore attributable to batch 72 only
  if **no version row outside batch 72 references it**. This is the one relation that can
  hold shared history, and it is the reason the inventory measures reference counts rather
  than assuming.
- `staging.source_record_versions` carries **both** `opened_by_batch_id` and
  `closed_by_batch_id`, so batch 72 may have **closed** a version an earlier batch opened.
  Both directions are counted.
- `staging.source_records` carries `last_batch_id`, `current_version_seq` and `absent_since`
  — a row batch 72 merely **updated** must be distinguished from one it **created**. The
  inventory decides that per record, by asking whether any version of it was opened by a
  different batch.
- `promotion_candidates.created_by_batch_id`, `import_rejections.import_batch_id` and both
  076 projections' `projected_by_batch_id` are direct attributions.
- `data_issues` has **no batch column**; ownership is `details->>'owner'`.
- Canonical safety is re-provable retroactively: `xmin` on the `import_batches` row for 72
  is the settle transaction's own id, and the four canonical fact tables can be scanned for
  surviving tuples carrying it — the same technique §15 uses in the integration suite.

### The inventory — batch 72 owned its entire footprint (2026-08-29, user-run, read-only)

| Relation | Batch 72 | Shared / pre-existing |
|---|---|---|
| `import_batches` | id 72, tool `settle-afltables.ts`, status `completed`, `records_read` 9729, `records_rejected` 10532, xid **133369**, label `issue099-t8-20260829` | no sibling batch for this label |
| `promotion_candidates` | 10739 — matches/new 207, match_period_scores 207, **brownlow_round_votes 803**, player_match_stats 9522 | 0 candidates from any other batch |
| `import_rejections` | 10532 — brownlow 803, period scores 207, player stats 9522 | — |
| 076 projections | `afltables_match` 207, `afltables_player_match` 8719, **all** `projected_by_batch_id = 72` | none from another batch |
| `staging.source_records` | 207 match + 9522 player, **all created by 72**, max version 1 | **0 pre-existing, 0 absent** |
| `staging.source_record_versions` | 9729 opened by 72 | **0 closed by 72** |
| `staging.source_payloads` | 9729 referenced by 72 | **0 shared — all 9729 exclusive** |
| `data_issues` with `issue_key` | 0 | — |
| `promotion_decisions` on its candidates | 0 | — |
| Canonical xmin scan for 133369 | **0 / 0 / 0 / 0** across all four fact tables | — |

`records_rejected` 10532 = 803 + 207 + 9522 reconciles exactly, and is 207 short of the
candidate total because `matches / new` is a proposal, not a rejection — the T6 fix that made
`records_rejected` count actual `import_rejections` rows holding true on real data.

**Conclusion: nothing shared, nothing pre-existing, nothing decided, no canonical mutation.**
A complete scoped reset was therefore safe and was the option taken.

### The remediation — executed under guard (2026-08-29, user-run)

One explicit transaction, `ON_ERROR_STOP`, no `TRUNCATE`. It refused unless all of:
`current_database()` = `afldb_test`; batch 72 exists with tool `settle-afltables.ts` and notes
naming `issue099-t8-20260829`; its `xmin` still read 133369; no `promotion_decisions` on its
candidates; no payload of its shared with another batch; no record of its carrying another
batch's version; **no version closed by 72** (otherwise deleting the batch would leave those
versions closed with no way to restore `observed_to` — corruption rather than reset); and the
canonical xmin scan still zero. Post-delete assertions re-checked every relation and the four
canonical row counts before `COMMIT`.

Delete order, taken from the FK graph rather than assumption: `promotion_candidates` →
`import_rejections` → both 076 projections → `staging.source_records` (it FKs its current
version) → `staging.source_record_versions` (they FK the payloads) → `staging.source_payloads`
(only where no version still references them) → `import_batches`.

**This is operator remediation of a defective `afldb_test` run, not settle behaviour.** O1
governs the executable ISSUE-099 path, which still issues no `DELETE` and no `TRUNCATE`.

*Evidence note:* the per-statement delete output was not returned to this session, so no row
counts are claimed for it here. The reset is instead evidenced by what followed — batch 90
reported `payloadsCreated` 9729 and `versionsAppended` 9729, which a database still holding
batch 72's spine could not have produced; it would have reported 0 and 0.

---

## T8 — THE CLEAN PROOF: batches 90 and 91 (2026-08-29, user-run)

Both runs under the positively verified **`afldb_import` @ `afldb_test`** connection.

### First apply — batch 90 (a genuine first apply)

`observationsSeen` 9729 · `payloadsCreated` **9729** · `versionsAppended` **9729** ·
`absenceSweepSkipped` 0 · `projectionRowsWritten` 8926 · `unresolvedIdentityPlayer` 803 ·
`unresolvedIdentityMatch` 8926 · `candidatesCreated` **9936** · `candidatesRefreshed` 0 ·
`dataIssues` 0/0/0 · **`canonicalRowsInserted` 0, `canonicalRowsUpdated` 0**.

Pending queue: `matches / new` 207 · `match_period_scores / unresolved_identity` 207 ·
`player_match_stats / unresolved_identity` 9522 · **ZERO `brownlow_round_votes`**.

**D2 is proved against the real 2026 data, by subtraction.** Defective batch 72 wrote 10739
candidates including exactly 803 bogus Brownlow rows; the fixed run writes **9936 — exactly
803 fewer — with no Brownlow target at all**, over the identical bundle. **R3 now holds on
real data**: 9522 NA vote observations produce zero Brownlow candidates, zero rejections and
no invented value.

### Second apply — batch 91 (idempotence)

`observationsSeen` 9729 · `payloadsCreated` **0** · `payloadsReused` **0** ·
`versionsAppended` **0** · `observationsUnchanged` 9936 · `observationsCorrected` 0 ·
`observationsHistoryOnly` 0 · `observationsMarkedAbsent` **0** · `observationsReappeared` 0 ·
`absenceSweepSkipped` 0 · `projectionRowsWritten` 8926 (upserted in place) ·
`candidatesCreated` **0** · `candidatesRefreshed` **0** · `candidatesMootLeftPending` 0 ·
`dataIssues` 0/0/0 · **canonical 0/0**.

The pending queue is unchanged by category and count. **SC4 is discharged on real data**: a
rerun over identical source data created no second version, no second candidate and no second
`data_issues` row, and performed zero canonical writes — §18.1's "repeated nightly run"
guarantee, measured at 9729 observations rather than at fixture scale.

### The 9936 counter — adjudicated as CONTRACT-CORRECT

`observationsUnchanged` 9936 against `observationsSeen` 9729 is **not a defect**. 9936 =
207 matches × 2 established targets + 9522 player rows × 1 = the exact count of established
targets, which is the grain `recordOutcome()` counts at. See the §23.2 clarification added at
T8. Under the defective code this number would have been 10739; that it is 9936 is D2
confirmed a second, independent way. **No code was changed.**

### The final report (2026-08-29, user-run)

`--report` under **`afldb_import` @ `afldb_test`**, read-only:

```text
matches / new                                 207
match_period_scores / unresolved_identity     207
player_match_stats / unresolved_identity     9522
(no brownlow_round_votes line)

Open AFL Tables source disagreements: (none)
```

The queue is exactly what §17 and R5 predict for a database with no accepted 2026 canonical
matches: one `new` proposal per match, and every dependent target refusing because there is
no canonical match to key it on. **No Brownlow line exists at all** — not a zero row, not an
empty candidate. `--report` offers no path to accept, resolve or retire anything.

### Restricted-role parity — the last §24 cell, CLOSED

Live proof on the settle connection: `current_database()` = **`afldb_test`**,
`current_user` = **`afldb_import`**. The whole write path — batches 90 and 91 — executed
under the restricted importer role, and the integration suite's role-parity case ran rather
than skipping: **20/20, no conditional skip remains.** The check carried as CONDITIONAL since
T6 close is discharged.

### Final static-gate refresh — GREEN (2026-08-29, user-run)

```bash
npm run typecheck ; npx eslint src/lib/acquisition/settle-afltables.ts \
  src/lib/acquisition/observation-store.ts tools/current-season/settle-afltables.ts \
  src/lib/external-afl/current-season-import.ts tests/current-season-import.test.ts \
  tests/integration/settle-afltables.test.ts
```

**Typecheck: exactly the established unrelated baseline — 13 errors in 4 files**
(`db-test-rebuild.test.ts` 4, `draftguru-acquisition.test.ts` 7,
`integration/draftguru-import.test.ts` 1, `integration/observation-spine.test.ts` 1),
**ZERO in any ISSUE-099 file**. These 13 are the pre-T6 baseline and are **not** ISSUE-099's
to fix. **ESLint: silent clean, 0 errors / 0 warnings.** Stale gates 2 and 3 are discharged.

---

## §25 STOP CONDITIONS — FINAL ADJUDICATION

| # | Condition | Verdict | Evidence |
|---|---|---|---|
| **SC1** | acquired `url` NA non-zero, or a `url` maps to two `ID`s | **NOT TRIGGERED** | 9522 rows: `missing_url` **0**, `malformed_url` **0**. Identity is the profile URL and every observed row has one. The second clause is **not directly measured** by the importer's output and is recorded as such, not claimed: 663 distinct IDs across 668 distinct URLs is *consistent* with it and implies five URL identities carry no `ID` at all, which is also the source of the 82 ID-less rows. It does not bind v1 — `ID` is enrichment only, and 82/9522 rows prove it could never have been mandatory. |
| **SC2** | a full-history or accepted-baseline gate accepts an in-season snapshot | **NOT TRIGGERED** | T1/T2 gates green and unchanged; `never_admissible_for` refuses both gates explicitly, and `--require-in-season` refuses symmetrically. Untouched by T8. |
| **SC3** | any v1 run reports non-zero canonical rows, or writes an `accept` decision | **NOT TRIGGERED** | `canonicalRowsInserted`/`Updated` **0** on batches 72, 90 and 91 and on every integration run; the retroactive `xmin` scan for batch 72's xid 133369 returned **0/0/0/0** across all four fact tables; `promotion_decisions` on ISSUE-099 candidates: **0**. There is no decision writer. |
| **SC4** | a rerun over identical data creates a second version, candidate or open `data_issues` row | **NOT TRIGGERED** | Batch 91 over the identical bundle: `versionsAppended` **0**, `payloadsCreated` **0**, `candidatesCreated` **0**, `candidatesRefreshed` 0, `dataIssues` 0/0/0, queue unchanged. Proved at 9729-observation scale, not fixture scale. |
| **SC5** | a record marked absent while unkeyed, incomplete, or merely unprojected | **NOT TRIGGERED** | Both enumerations `complete: true` with **0** unkeyed rejections; `observationsMarkedAbsent` **0** and `absenceSweepSkipped` **0** on all three real runs. The 803 unresolved-identity records were observed, versioned and kept present — §19's hard invariant, on real data. |
| **SC6** | a dry-run leaves any ISSUE-099-owned relation changed | **NOT TRIGGERED** | The §22 byte-identity case is green in the 20/20 suite and is non-vacuous — the closing dry-run genuinely wants to append a version and open a data issue, and rolls back byte-identically. The D1 dry-run failure changed nothing: it refused **before** any connection was opened. |
| **SC7** | implementation evidence materially contradicts this runbook, or exposes a new unresolved architecture/data-integrity decision | **TRIGGERED TWICE DURING T8, BOTH DISCHARGED** | **D1** and **D2** were genuine contradictions between the runbook's assumed behaviour and reality. Both were stopped on, diagnosed to root cause, repaired at the smallest correct boundary, given regression coverage, and revalidated end-to-end. Neither required a schema change, and migration 076 was never opened. **No stop condition is active now.** |

Two findings that are recorded rather than open: the §23.1 `--report` syntax defect (fixed
above — the CLI was right, the runbook line was wrong), and the counter-grain naming
clarification in §23.2. Neither is a behaviour defect.

**U2 — CLOSED.** 2026 `Brownlow.Votes` coverage was the one unresolved decision §30.1 assigned
to a measurement. Measured on real 2026 bytes: 9522 rows, **rows_with_votes 0, rows_na 9522,
distinct_values `[]`, projectable_round_vote_rows 0**, 2026 gated. **R3 confirmed**: zero
Brownlow candidates in-season is the correct result, not a defect. U1, U3, U4 and U5 remain
open by design and belong to the acceptance stage and to `AFLDB-ISSUE-086`/`101`.

---

## T8 — COMPLETE (2026-08-29)

Against §26's T8 cell — *one bounded real 2026 `--in-season` acquisition, then one bounded
end-to-end `afldb_test` proof: dry-run → apply → apply-again* — every obligation is
discharged, and the §24 matrix has **no unrun cell left**, including the restricted
`afldb_import` role parity carried as conditional since T6.

| T8 obligation | Result |
|---|---|
| Bounded real acquisition | 207 matches, rounds 1–25, 9522 player rows, 9729 total, `in_season_partial`, fitzRoy 1.8.0 = pinned |
| `url` / `ID` / F11 measurements | 0 missing URLs, 82 missing IDs, 9522/9522 Brownlow NA — **U2 closed** |
| Dry-run → apply → apply-again | batches 90 and 91, clean first apply then true idempotence |
| Counters stable, zero canonical rows | every run 0/0; queue identical across 90 and 91 |
| Review queue | 207 + 207 + 9522, **no Brownlow line**, no open disagreements |
| Static gates | typecheck at baseline, ESLint silent |
| Suites | `current-season-import` 172/172; `settle-afltables` integration 20/20, zero skipped |

**Two genuine defects were found by T8 and repaired**: D1 (absolute manifest path
double-prefixed — a cross-platform bug that Windows merely made visible) and D2 (an optional
target proposed on identity failure, producing 803 Brownlow candidates the source never
published). Both were caught **only** because T8 ran real data through the real operator
path; neither was reachable from any fixture that existed at T7 close. Batch 72, the
defective run, was inventoried read-only and removed under guard, and the clean proof was
re-run from a genuine first apply.

**The v1 boundary held throughout.** No canonical fact row was written by any settle
transaction, in dry-run or apply, at fixture scale or at 9729-observation scale. No
acceptance decision exists, no `promotion_decisions` writer exists, no canonical
acceptance/provenance schema was created, and no force or override path was added. Migration
076 was never edited. O1 holds: the executable settle path issues no `DELETE` and no
`TRUNCATE` — the batch-72 cleanup was operator remediation of a test database, outside that
path by definition.

### Carried out of ISSUE-099 as separately tracked work

- **`AFLDB-ISSUE-104`** — the foreign-owner `data_issues` refresh limitation.
- **`AFLDB-ISSUE-105`** — the bigint `import_batches.id` / `batchId` runtime typing debt.
- **`AFLDB-ISSUE-106`** — `proposedPeriodScoreValues()` returning an empty array rather than
  no target.

None blocks ISSUE-099. The acceptance-stage prerequisites (§16) and U1/U3/U4/U5 remain with
`AFLDB-ISSUE-086`, `AFLDB-ISSUE-101` and the future acceptance stage.
