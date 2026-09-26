# AFLDB-ISSUE-240 — Deduplicate repeated `afl_api_identity_contradiction` findings

<!-- afldb-merge-readiness
{"status":"ready","hardBlockers":[],"expectedFiles":["src/lib/acquisition/afl-api-bridge-identity.ts","tools/migration/import_afl_api_player_bridge.ts","tests/afl-api-player-bridge-import.test.ts","tests/afl-api-identity-fake-db.ts","issues/closed/AFLDB-ISSUE-240.md"],"validation":["see issues/closed/AFLDB-ISSUE-241.md §8 (one combined run)","code_test_db rehearsal attempt 1 (2026-09-26) — every 240 check PASS; run then FAILED at the 241 STOP fixture (harness bug, fixed; see AFLDB-ISSUE-241.md §9.1)","code_test_db rehearsal attempt 2 (2026-09-26) — every 240 check PASS; run then FAILED in the 239 dry-run readback (fixture jsonb text, harness defect, fixed; see AFLDB-ISSUE-241.md §9.1)","code_test_db rehearsal attempt 3 (2026-09-26, operator-run) — ACCEPTING RUN: 26/26 PASS; all four 240 checks PASS (two keyed open findings; replay no duplicate, first findings byte-identical; provenance count 4 in import_rejections; distinct key for another evidence class); residue 0 before and after; code_test_db only"]}
-->

## 0. Status

**RESOLVED 2026-09-26** (uncommitted). Implemented the same day as part of the ISSUE-238–241 bulk
pass and DB-free validated. Accepted on the combined `code_test_db` rehearsal
(`AFLDB-ISSUE-241.md` §9), **attempt 3: 26/26 PASS**, with every ISSUE-240 check passing on real
PostgreSQL (§6). Shared architecture: `AFLDB-ISSUE-241.md` §2. No DEV, PROD, `afldb_test` or
retained promotion database was contacted, and no DEV step is required.

## 1. The write path, found

The only writer of `afl_api_identity_contradiction` rows was the bridge loader. It has two sites:

- the provider contradiction (`import_afl_api_player_bridge.py:514-545`);
- the player collision (`:553-587`).

Each ran a plain `INSERT INTO data_issues` with no key, so every replay of the same artefact opened
another row (ISSUE-235 E8/G5). The readers are:

- the admin detail page, which lists open findings by `details->>'external_id'`
  (`src/db/queries/afl-api-player-links.ts:530-536`);
- `audit-afl-api-player-bridge-persisted.ts`;
- `census-afl-api-brownlow-identities.ts`.

The loader is now `tools/migration/import_afl_api_player_bridge.ts` (ISSUE-241), and both sites
live there.

## 2. The key

`data_issues.issue_key` already exists (migration 076). So does the partial unique index
`uq_data_issues_open_by_key (issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS
NULL`. The settle already uses both. **No migration is needed.**

`issue_key = 'afl_api_identity_contradiction:v1:' || sha256(canonicalJson([...]))`
(`aflApiContradictionIssueKey`) is computed over exactly these semantic fields, in a fixed order:

| Field | Why it distinguishes |
|---|---|
| `kind` | `provider_already_linked` vs `player_already_linked` |
| `externalId` | the provider the evidence proposes |
| `evidenceClass` | the artefact's `match_method`: separate evidence lines stay separate |
| `proposedPlayerIdentity` | the claimed player, by **stable identity** |
| `existingExternalId` | the conflicting row's provider (itself, or the holder in a collision) |
| `existingStatus`, `existingMatchMethod` | importer `unique` vs human `resolved`, and its class |
| `existingPlayerRef` | the conflicting row's player by stable identity. It is `player_id:<n>` only when that player has none, or `null_player`, so two unidentified players never merge. |

The key contains **no** timestamp, artefact path or hash, batch id, free text or (identified)
surrogate id. It is therefore stable across replays and across renumbering lineages, which the
"lineage-stable" test proves.

## 3. Behaviour

- `INSERT … ON CONFLICT (issue_type, issue_key) WHERE issue_key IS NOT NULL AND resolved_at IS NULL
  DO NOTHING RETURNING id`.
  - An identical open finding is **neither duplicated nor rewritten**: its description, details,
    `detected_at` and entity stay as first recorded. This is deliberately `DO NOTHING`, not the
    settle's `DO UPDATE` refresh, because the first evidence and provenance are authoritative.
  - A materially different contradiction has a different key and is recorded.
  - A resolved finding does not block a new one: the index covers open rows only, so history is
    kept.
- Details keep every pre-240 field (`source_key`, `external_id`, `proposed_player_id`,
  `existing_status`, `existing_match_method`, `evidence_summary`, `kind`/`existing_external_id` for
  collisions), so existing readers are unchanged. They add:
  - `evidence_class`, `proposed_player_identity`, `candidate_player_id_hint`;
  - `existing_player_id` and `existing_player_ref`;
  - `dedup_key {version, fields}`;
  - `provenance {tool, artefact_sha256}`.
- **Provenance of every detection stays inspectable.** Each apply batch writes one
  `import_rejections` row per detection, deduplicated ones included. It carries `issue_key`,
  `data_issue_id` (NULL when already open), `already_open` and the artefact row.
- `--validate-only` reports "would record new" vs "already open" by reading the open keys.
- **No adjudication or link behaviour changed.** Contradictions and collisions are withheld exactly
  as before, and no identity row is touched.

## 4. Legacy rows (explicit decision)

Rows written before this change carry `issue_key = NULL`. The index ignores them, and they are
**left untouched**: not keyed, merged, resolved or deleted. One more keyed row can appear beside
them the first time the loader meets the same contradiction again. Merging them would mean
rewriting existing findings, which this issue forbids. An operator may resolve legacy duplicates by
hand.

## 5. Validation

- `tests/afl-api-player-bridge-import.test.ts`, describe "the contradiction finding key", covers:
  - determinism;
  - sensitivity to every field;
  - the surrogate fallback;
  - lineage stability;
  - the record's field set.
- The adapter tests cover:
  - an identical replay (no new row, first rows byte-identical, rejections audited);
  - a materially different contradiction (a distinct row);
  - reopening after resolution;
  - a collision against a same-run insert naming its real id.
- The rehearsal `240` checks prove the real `ON CONFLICT` inference and `afldb_import` grants on
  PostgreSQL (`AFLDB-ISSUE-241.md` §9).

## 6. PostgreSQL acceptance and resolution (2026-09-26)

**Resolved on the combined `code_test_db` rehearsal, attempt 3** (`AFLDB-ISSUE-241.md` §9.1):
26/26 checks PASS, rehearsal exit 0, fixture residue
`{"identities":0,"ledger":0,"actors":0,"findings":0,"batches":0}` before and after. The ISSUE-240
checks, all PASS on real PostgreSQL through the `afldb_import` role:

| Check | Proven |
|---|---|
| `240 apply` | two keyed open findings recorded |
| `240 replay` | no duplicate open finding; the first findings byte-identical; `ON CONFLICT … DO NOTHING` inferred the migration 076 partial index and behaved as designed |
| `240 provenance` | every detection, the deduplicated replay included, stays inspectable in `import_rejections` (count 4) |
| `240 materially different contradiction` | another evidence class gets its own key and is recorded separately |

The same four checks also passed in attempts 1 and 2. Both of those runs failed later on
rehearsal fixture defects unrelated to this issue, fixed DB-free (`AFLDB-ISSUE-241.md` §9.1).
Attempt 3 is the accepting run.

**Not proven on PostgreSQL, by design:** reopening after resolution. It rests on the partial index's
`resolved_at IS NULL` predicate and the DB-free adapter test (§5).

**Follow-up.** None required. Legacy NULL-key rows stay as §4 decides; an operator may resolve
legacy duplicates by hand.
