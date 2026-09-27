# AFLDB-ISSUE-251 — Production promotion cannot converge candidate-only manual player registrations when PROD has never held their AFL Tables paths

## 0. Status

**Open (2026-09-26). High severity. Blocks AFLDB-ISSUE-237 L5 PROD.**

Opened from the first real ISSUE-237 L5 production attempt, promotion stamp
`20260926-213225`. The promotion correctly stopped at `--phase restored`; no reinstatement
plan was generated, no database swap occurred, and the original production database was
released from the ISSUE-250 freeze and returned to service healthy.

This issue is a **promotion/adoption contract defect**, not an instruction to weaken
AFLDB-ISSUE-242 and not a request to copy `afldb_test`'s transport-local provenance into PROD.

The intended resolution is an explicit, fail-closed **PROD adoption path for the already
approved ISSUE-224 92-player registration set**, using PROD-local registration tokens and a
real PROD super-admin actor. Once that state exists, the existing ISSUE-242 cross-database
convergence contract can rebind the rebuilt candidate's transport-local token onto the
PROD-authoritative token for the same accepted AFL Tables path.

`tools/rebuild/draftguru/register_issue224_s9_players.ts` currently and deliberately refuses
PROD. **ISSUE-251 is an authorised design change to that historical boundary**, but PROD support
must be a separately guarded mode with stronger requirements than test/DEV. It is not merely
loosening `assertNotProdLike()` or casually adding `prod` to the current target enum.

No PROD mutation is authorised by this runbook yet.

---

## 1. Origin

AFLDB-ISSUE-237 L5 was run on PROD on 2026-09-26 using the freeze-bound
AFLDB-ISSUE-250 promotion procedure.

Relevant identities:

- PROD checkout/revision: `ce1bc1e1e5e0c3b577dd70cf1e73ba0cd31f35fe`.
- Promotion stamp: `20260926-213225`.
- Original live PROD database: `afldb_prod`, OID `35594`.
- Retained failed candidate: `afldb_prod_candidate_20260926-213225`, OID `49077`.
- Frozen-state F0 digest:
  `4255d4c243533293600cae415d62511ceb049c4cfbf0d32b92f67548f5cc2b70`.
- Authoritative frozen PROD dump SHA-256:
  `12b9d0e83ce796c3e789fb312652cab306e7ef8ec7b5fdb6432173ba98869329`.
- Rebuilt `afldb_test` source dump SHA-256:
  `1714f8a8440962074c4876b0d75c6781c11558a09bf3be71ccafb35b0edae3ea`.

The source gate passed at the exact same checkout as PROD. The rebuilt source carried
802 AFL API importer identities:

- `afl_api_stat_vector_season = 273`
- `afl_api_stat_vector_bootstrap = 397`
- `afl_api_name_team_season_bootstrap = 129`
- `afl_api_manual_adjudication = 3`

Source importer-state SHA-256:

`e04a57767c60479cdac13c054c69c519cc00a826d6f1670dad7bef32bc98783b`

The candidate restore completed with only the two documented extension-owner COMMENT
errors (`pg_trgm`, `unaccent`).

---

## 2. L5 failure

`db:promotion:check --phase restored` correctly refused the candidate on exactly two
related gates:

1. `manual player registration token convergence planned (AFLDB-ISSUE-242)`
2. `data_overrides players replay predicted on the candidate (AFLDB-ISSUE-237 A4.2)`

The checker reported **92 candidate-only `manual_admin_edit` tokens**. For every one,
the candidate held an accepted AFL Tables path, but the target PROD database:

- had no active registration creation record for that path; and
- did not already hold that AFL Tables path on a canonical player.

Under ISSUE-242 this is deliberately a STOP, in the checker's own observed wording:

> candidate-only provenance the target never took, and retiring it would promote a person the
> target does not know

That rule was correct for ISSUE-242's DEV problem. It is insufficient for the first
production promotion that introduces a newly rebuilt, already-approved source-owned player
population.

No `promotion-lineage-20260926-213225.sql` file was published.
No `promotion-afl-api-supersede-20260926-213225.json` file was published.

G2 and G3 themselves passed:

- target human ledger: 0;
- target importer rows: 0;
- candidate importer rows: 802;
- all candidate-only AFL API identities were classified as `INFO (gained_coverage)`;
- there was no production hard loss.

The original target remained frozen at OID `35594` and exactly F0 throughout the failed
restored gate.

---

## 3. Safe abort state

The failed L5 attempt was abandoned before reinstatement and before swap.

The token-bound ISSUE-250 unfreeze completed successfully:

- `afldb_prod` OID `35594`: no marker, ACL open;
- candidate OID `49077`: retained, not frozen;
- pre-existing kept database unchanged.

The application was restarted and verified:

- `afldb.service`: active;
- listener: `127.0.0.1:3100`;
- `/api/health`: `status=ok`, `database=ok`;
- settle timer: inactive;
- settle service: inactive.

The retained candidate remains evidence and MUST NOT be dropped until ISSUE-251 is
resolved or its evidence is deliberately superseded.

---

## 4. Retained-candidate census

A read-only transaction against
`afldb_prod_candidate_20260926-213225` established the exact 92-player state.

### 4.1 Registration identities

- `manual_admin_edit` identities: **92**
- distinct players: **92**
- players with exactly one accepted AFL Tables path: **92**
- multiple AFL Tables paths: **0**
- no AFL Tables path: **0**

Every one of the 92 players carries exactly these three identity-source families:

| Source | Identity rows | Players |
|---|---:|---:|
| `afl_api` | 92 | 92 |
| `afltables` | 92 | 92 |
| `manual_admin_edit` | 92 | 92 |

This proves the cohort is **not manual-only**. Every player has a durable, independently
accepted AFL Tables identity.

### 4.2 Creation records

The candidate contains:

- 92 creation records;
- 92 active creation records;
- 92 records carrying `afltables_profile_path`;
- exactly 1 attribution actor.

That actor is:

- role: `super_admin`;
- disabled: yes;
- password: absent;
- TOTP: absent.

It is the `afldb_test` recovery-attribution actor used to carry the registration lifecycle
through the destructive rebuild. It is **not PROD authority** and MUST NOT be copied or
treated as a production actor.

### 4.3 Football dependencies

Across the 92 players the candidate contains zero rows in:

- `player_match_stats`;
- `player_season_stats`;
- `player_career_stats`;
- `player_clubs`;
- `brownlow_round_votes`.

All 92 also have no `debut_season` / `final_season` career span.

### 4.4 Other canonical / curated dependencies

The census found:

- `award_winners`: **3 rows / 3 players**;
- `draft_picks`: 0;
- `honour_team_members`: 0;
- `player_achievements`: 0;
- `club_leadership`: 0;
- `season_list_members`: 0.

Therefore deleting or omitting these players is not an acceptable workaround. At least three
already participate in rebuilt curated canonical data.

---

## 5. Root cause

ISSUE-224 S9 deliberately created the 92 players on `afldb_test` through the ordinary manual
player lifecycle so that the system could attach their approved AFL Tables identity before the
AFL API bridge was rebuilt.

That lifecycle mints a database-local `manual_admin_edit` token and a durable
`data_overrides('players', 'manual_admin_edit:<token>', 'identity')` creation record.

AFLDB-ISSUE-245 then made those registrations survive a destructive `afldb_test` rebuild.

AFLDB-ISSUE-242 later solved the cross-database token problem for DEV by defining:

- **rebind** — target has its own registration for path P;
- **retire** — target already holds source-owned path P with no manual token;
- **STOP** — candidate has token B + path P but target neither registers nor already holds P.

The real PROD L5 reached that final case for all 92 players.

The missing lifecycle is therefore:

> **How does PROD explicitly adopt an already-approved, source-identifiable player set that the
> rebuilt source knows, but production has never previously held?**

The answer cannot be "copy the candidate token", because the candidate token and recovery actor
are transport-local `afldb_test` provenance.

It also cannot be "relax ISSUE-242 and delete the token", because that would make the promotion
itself introduce people PROD has never explicitly accepted, defeating the target-authority
boundary that ISSUE-242 intentionally enforces.

---

## 6. Decision / target architecture

### D-251-1 — Keep ISSUE-242 fail-closed

The existing candidate-only-orphan STOP remains unchanged.

A future arbitrary candidate-only manual identity MUST still fail when the target neither
registered nor independently owns its durable path.

### D-251-2 — PROD adopts the approved ISSUE-224 cohort before promotion

Extend the existing pinned ISSUE-224 registration workflow with a separately guarded PROD
adoption mode.

The adoption uses:

1. the existing byte-pinned 92-row ISSUE-224 target-set artefact;
2. the existing byte-pinned D-7 `REGISTER` decision artefact;
3. the existing authoritative name-parts artefact for multipart names;
4. an existing **real PROD enabled + enrolled `super_admin`** selected by the operator;
5. a fresh, verified pre-write PROD backup;
6. explicit PROD-write acknowledgement;
7. exact host/database/revision checks.

The write must use the same canonical mutation primitives as the current ISSUE-224 tool:

- `createPlayerInTransaction()`;
- `attachAflTablesIdentityInTransaction()`.

Each PROD registration receives a **new PROD-local `manual_admin_edit` token** and a PROD-owned
creation record attributed to the selected PROD super-admin.

No `afldb_test` token, actor id, actor email or recovery-auth state is copied.

### D-251-3 — AFL API identities are not written by the adoption

ISSUE-251 writes no `afl_api` external identity.

The 92 candidate AFL API identities remain rebuilt/importer-owned data and arrive only through
the normal ISSUE-237 promotion path.

The next L5 must therefore still exercise:

- G1 source census;
- G2 human-vs-importer overlap;
- G3 target-vs-candidate comparison;
- candidate gate;
- post-swap D15 replay as applicable.

### D-251-4 — No special handling for the three `award_winners`

The three `award_winners` rows are rebuilt-source data.

ISSUE-251 only establishes durable PROD player authority. It does not copy, recreate or mutate
the three award rows directly.

The later promotion must prove their stable player lineage normally.

### D-251-5 — PROD pins the name-parts artefact

The existing tool deliberately permits an operator-authored, non-hash-pinned `--name-parts` file
for its existing test/DEV workflow. That existing behaviour is unchanged for test/DEV.

The new PROD adoption mode requires the exact tracked artefact

`docs/rebuild-manifests/draftguru/issue224-s9-name-parts-20260922.json`

and requires its bytes to match a pinned SHA-256 established during implementation/review. An
arbitrary alternate `--name-parts` file must not be accepted in PROD mode.

The SHA-256 itself is not established by this documentation pass; implementation must calculate
it from the current tracked file, and tests must pin it.

### D-251-6 — Shared post-write invariants, DEV and PROD

The current tool's post-write checks are DEV-only.

Implementation must factor the target-independent 92-row postconditions (§8) into **shared
logic used by both DEV and PROD**, rather than cloning the DEV logic for a new PROD path.

PROD adds its own stronger boundary checks around that shared validation:

- exact PROD host;
- exact `afldb_prod` database;
- authorised mutation role;
- expected deployed revision;
- verified backup acknowledgement;
- real enabled+enrolled PROD `super_admin`;
- no recovery/test actor;
- no AFL API identity created by adoption.

Not implemented yet; recorded here as a design requirement for implementation.

### D-251-7 — Manual-registration replay proof boundary (operator decision, 2026-09-27)

§8 item 11 is clarified as follows.

The ISSUE-251 adoption transaction does **not** invoke `replay_admin_overrides` itself. Before
COMMIT it must instead prove the canonical live-state postconditions on which that replay depends,
including the resolved player identity/name state and the complete manual-registration lifecycle
invariants established by the shared post-write checks.

The full existing `replay_admin_overrides` oracle remains an independent validation requirement. It
must be exercised before ISSUE-251 closure through the reviewed rebuild/promotion path, presently
expected at the fresh ISSUE-237 L5 A4.2 gate.

Accordingly:

- failure of the in-transaction postconditions aborts the ISSUE-251 adoption before COMMIT;
- absence of a standalone `replay_admin_overrides` run does not by itself block the Phase 8
  adoption transaction once all Phase 0–7 gates have passed;
- ISSUE-251 must not be marked resolved until the full replay oracle requirement has subsequently
  been satisfied and recorded.

This decision supersedes the literal reading of §8 item 11 that required the full replay oracle
itself to execute inside the adoption transaction before COMMIT. No production implementation
change is implied.

---

## 7. Required PROD adoption classification

The PROD extension MUST classify all 92 pinned rows before any write.

Expected first-adoption shape:

- `CREATE = 92`
- `ALREADY_SATISFIED = 0`
- `CONFLICT = 0`

Anything else is a STOP until deliberately reviewed.

A future retry mechanism may recognise a previous ISSUE-251 apply only if it can prove, from the
live PROD state itself, that all 92 paths are already satisfied by exactly the expected
registrations. It must not infer success from a local log or partial count.

The implementation MUST refuse at minimum when:

- target-set SHA differs from the pinned hash;
- D-7 decision SHA differs from the pinned hash;
- the artefacts contain anything other than the exact approved 92 REGISTER rows;
- a target path is ambiguous;
- a path belongs to an unexpected player;
- a registration token/path relationship is inconsistent;
- an existing manual-only player could be silently merged by name;
- a multipart name lacks the authoritative split required by the existing tool;
- the selected PROD actor is missing, disabled, unenrolled or not `super_admin`;
- a recovery/test/fixture actor is supplied;
- host is not the PROD host;
- database is not exactly `afldb_prod`;
- connection role is not the explicitly permitted mutation role;
- checkout revision is not the operator-approved revision;
- the required verified backup acknowledgement is absent or malformed;
- any write would require fuzzy matching or name-only identity;
- any postcondition differs from the planned 92-row state.

No fallback from a PROD DSN to DEV/test is permitted.

---

## 8. Atomicity and postconditions

The 92-player apply is one transaction.

Before COMMIT it MUST prove:

1. 92 approved AFL Tables paths resolve.
2. They resolve to 92 distinct canonical players.
3. Each player has exactly one accepted AFL Tables profile identity for the pinned path.
4. Each player has exactly one PROD-local `manual_admin_edit` identity.
5. Each manual identity has exactly one active
   `data_overrides('players', 'manual_admin_edit:<token>', 'identity')` creation record.
6. Each creation record carries the same pinned AFL Tables path.
7. Every creation record is attributed to the selected PROD super-admin.
8. No candidate/test/recovery actor is present in the new authority.
9. No unexpected identity/source row was created.
10. No AFL API identity was created by this operation.
11. The existing manual-registration capture/replay oracle accepts the resulting live state.
    **Clarified by D-251-7 (§6):** the transaction proves the postconditions this oracle depends
    on, not a literal in-transaction invocation of the oracle itself; the oracle's own standalone
    run remains required before ISSUE-251 closure, not before this COMMIT.
12. Re-running the read-only classifier sees the intended already-satisfied state with zero
    conflicts.

Any failed assertion rolls the whole transaction back.

---

## 9. Implementation scope

Primary existing implementation to extend:

`tools/rebuild/draftguru/register_issue224_s9_players.ts`

The existing tool already provides:

- pinned target-set SHA;
- pinned D-7 decision SHA;
- exact 92-row requirement;
- AFL Tables path as registration authority;
- CREATE / ALREADY_SATISFIED / CONFLICT classification;
- name-parts refusal;
- canonical player creation;
- canonical AFL Tables attachment;
- one outer transaction;
- post-write checks;
- DEV-specific explicit write acknowledgement.

ISSUE-251 should add PROD support as a **separate guarded mode**, not merely add `prod` to a loose
target enum.

Expected adjacent files:

- `tools/rebuild/draftguru/register_issue224_s9_players.ts`
- its DB-free/unit tests;
- a PROD-specific rehearsal/acceptance harness if the current tests cannot exercise the full
  safety boundary without a live production database;
- `docs/production-promotion.md`
- `issues/open/AFLDB-ISSUE-237.md`
- `IssuesIndex.md`
- `issues.md`
- this runbook.

A schema migration is not expected unless implementation proves an invariant cannot be expressed
with the current model. Do not add one pre-emptively.

---

## 10. Testing requirements

### 10.1 DB-free

Cover at least:

- PROD target cannot be selected without the explicit PROD acknowledgement set.
- DEV acknowledgement cannot satisfy PROD.
- PROD acknowledgement cannot satisfy DEV.
- wrong host refused.
- wrong database refused.
- wrong role refused.
- wrong revision refused.
- malformed/missing backup SHA refused.
- disabled actor refused.
- unenrolled actor refused.
- non-super-admin actor refused.
- fixture/recovery actor refused.
- 92 CREATE exact case.
- any `ALREADY_SATISFIED` on first-adoption mode refuses.
- any CONFLICT refuses.
- ambiguous AFL Tables path refuses.
- manual-only/name-only candidate refuses.
- multipart-name guard remains unchanged.
- tool writes no AFL API identity.
- all postconditions are checked before commit.
- apply remains all-or-nothing.
- retry classification is deterministic.

### 10.2 Rehearsal

Before PROD apply, rehearse the exact PROD branch against an isolated disposable database whose
starting state represents the current PROD relationship to the 92 paths:

- none of the 92 registrations present;
- none of the 92 AFL Tables paths present;
- real schema/migrations;
- synthetic eligible super-admin attribution actor;
- 92 CREATE expected.

The rehearsal must execute the real mutation code, then prove:

- 92 players;
- 92 PROD-style manual tokens;
- 92 creation records;
- 92 AFL Tables paths;
- zero conflict;
- zero AFL API identities written by adoption;
- capture/replay oracle passes;
- second classification is deterministic;
- transaction rollback leaves zero residue under an injected failure.

Do not use the retained PROD candidate as the writable rehearsal database.

### 10.3 PROD preflight

The real PROD apply requires a fresh read-only preflight immediately before the write and must
reconfirm the current baseline. The 2026-09-26 census is evidence for the defect, not permission
to assume the state remains unchanged later.

---

## 11. Interaction with ISSUE-237 L5

ISSUE-251 does not complete ISSUE-237.

After ISSUE-251 is implemented, reviewed, rehearsed, deployed and separately authorised for PROD:

1. take a fresh verified PROD backup for the adoption write;
2. run the PROD adoption;
3. prove the resulting 92 PROD registrations;
4. leave production operating normally;
5. schedule a **completely fresh** ISSUE-237 L5 promotion attempt;
6. generate a new freeze token, F0 record, authoritative frozen dump and proof;
7. rebuild/transfer a fresh source dump as required by the promotion runbook;
8. run `--phase restored`.

Expected ISSUE-242 result on that future candidate:

- candidate: token **B** + path **P**;
- target PROD: token **A** + path **P**;
- convergence: **rebind B → A**;
- no candidate-only orphan remains.

Only a fully passing restored gate may publish the lineage-remap/E_promotion handoff files.

The failed `20260926-213225` attempt is evidence only and MUST NOT be resumed from the failed
restored gate after PROD adoption. It crossed an intentional fail-closed boundary and is
superseded by the future fresh attempt.

---

## 12. Out of scope

ISSUE-251 does **not**:

- weaken or remove ISSUE-242's candidate-only-orphan STOP;
- import AFL API identities directly into PROD;
- restore 2026 match/stat rows;
- modify AFL API G2/G3 semantics;
- implement ISSUE-238 correction/re-attribution;
- copy `afldb_test` recovery actor state to PROD;
- copy `afldb_test` manual tokens to PROD;
- adopt players by display name, surname, DOB guess or fuzzy match;
- mutate the retained failed candidate;
- drop the retained failed candidate;
- restart or enable the settle timer;
- authorise a new L5 attempt automatically.

---

## 13. Acceptance criteria

ISSUE-251 may be resolved only when all of the following are true:

1. The PROD adoption path is explicit, separate and fail-closed.
2. The exact pinned ISSUE-224 92-player set is the only accepted bulk set.
3. The path uses a real existing PROD enabled+enrolled super-admin for attribution.
4. No `afldb_test` token or recovery actor crosses into PROD.
5. No AFL API identity is written by adoption.
6. The write is atomic.
7. DB-free safety/contract tests pass.
8. A real isolated rehearsal of the PROD branch passes.
9. The operator reviews the generated PROD commands before any live write.
10. A fresh verified PROD backup exists immediately before the authorised apply.
11. The live PROD apply, when separately authorised, results in exactly 92 valid PROD
    registrations with zero conflict.
12. A subsequent fresh ISSUE-237 L5 `--phase restored` no longer fails the two 92-registration
    gates and plans the expected ISSUE-242 rebinds.
13. The full L5 still passes every independent ISSUE-237/250 gate; ISSUE-251 success never
    overrides a different failure.

---

## 14. Current operator state

At issue opening:

- live `afldb_prod`: OID `35594`, writable/open, application healthy;
- retained failed candidate:
  `afldb_prod_candidate_20260926-213225`, OID `49077`;
- no swap occurred;
- no restored-gate lineage file was published;
- no restored-gate AFL API supersede file was published;
- settle timer/service remain inactive;
- ISSUE-237 L5 remains **NOT PASS**;
- ISSUE-251 is the current prerequisite before another production promotion attempt.

---

## 15. Next action

Steps 1–4 are **complete** — see §16–§18. Step 5 (full diff/review, operator procedure) is
drafted, corrected and largely exercised (§19–§22); the whole-tree diff/review itself is current,
ongoing work, not yet concluded by this runbook. Step 6 (separate live PROD adoption authorisation)
has not been requested.

1. ~~Inspect the exact existing registration tool/tests and finalise the PROD-mode design against
   the current code.~~ Done — §16.1.
2. ~~Implement the separately guarded PROD adoption mode.~~ Done — §16.
   ~~Move the actor assertion authoritatively inside the write transaction (reviewer finding).~~
   Done — §17.
3. ~~DB-free validation.~~ Done — §16.4, extended §17.7/§17.8.
4. ~~Isolated real-DB rehearsal.~~ Done — §18 (harness run for real against `code_test_db`;
   teardown fix in §18.10).
5. Full diff/review and operator procedure. Procedure drafted and corrected (§21, §21.14);
   checkout-integrity finding closed (§19); privilege-suite gap closed (§20); Phase-9 census
   proved positive-state (§22). The whole-tree diff/review pass itself remains to be concluded
   before operator staging/commit preparation.
6. Only then request separate live PROD adoption authorisation.

**No live PROD mutation is authorised.**

---

## 16. Implementation (this pass, uncommitted)

All of the below is uncommitted on `sonnet/issue-251`, in the worktree `D:\dev\afldb-issue-251`.
Nothing in this section has touched `afldb_prod`, the retained candidate
`afldb_prod_candidate_20260926-213225`, `afldb_dev`, or ISSUE-238's dirty worktree. AFLDB-ISSUE-242
(`tools/db/promotion-check.ts` and its `tests/db-promotion-check.test.ts`) is untouched by this
pass; its 264 DB-free tests still pass unmodified (§16.4).

### 16.1 Files changed

- `tools/rebuild/draftguru/register_issue224_s9_players.ts` — the PROD adoption mode, added
  alongside the unchanged test/DEV paths (see §16.2).
- `tools/rebuild/draftguru/issue251_prod_rehearsal.ts` (new) — the isolated `code_test_db`
  rehearsal harness (§16.5).
- `tests/register-issue224-s9-dev-write-gate.test.ts` — extended with the PROD DB-free suite;
  two pre-existing assertions that literally pinned "no PROD target exists" were updated to
  reflect the now-authorised PROD boundary (they still pin that an unrecognised `--target` value,
  and `--target prod` without `--prod-import-role`, both refuse).
- `package.json` — one new script, `db:code-test:issue251-rehearsal`.
- `.env.example` — two new, commented-out, PROD-only DSN variables (§16.3).
- This runbook.

`docs/production-promotion.md` is **not** changed: ISSUE-251 adoption is a separate, prior step
the operator runs before a *fresh* ISSUE-237 L5 attempt (§11), not a change to the promotion
procedure itself. `IssuesIndex.md`/`issues.md` are updated only when this issue's state changes
there (not yet — still Open).

### 16.2 The PROD adoption mode, as implemented

`--target prod` is accepted by `parseArgs`, but is never resolved by the existing
`resolveTarget()`/`assertNotProdLike()` (those still refuse `'prod'` exactly as before — the
existing pinned test for that is unchanged). Two new, separate functions do PROD's own
resolution: `resolveProdTarget()` (the write DSN, `AFLDB_PROD_IMPORT_DATABASE_URL`, `afldb_import`)
and `resolveProdAuthTarget()` (a brief read-only actor-check DSN, `AFLDB_PROD_AUTH_DATABASE_URL`,
`afldb_auth`). `main()` branches to a wholly separate `runProdMain()` for `--target prod`; the
test/DEV body is untouched.

`--target prod` always requires `--prod-import-role` (there is no reduced-privilege PROD
connection in this tool, unlike DEV's ordinary `afldb_app` path). `--target prod --apply`
additionally requires ALL of `--allow-prod-write`, `--backup-sha256 <64-hex>`,
`--expected-host <hostname>` and `--expected-revision <40-hex-git-sha>` — all checked in
`parseArgs`, and the host/revision re-checked against the real machine and checkout by
`assertProdBoundary()`, before any PROD database connection opens. `--name-parts` is refused
outright for `--target prod`: PROD always loads and hash-pins the tracked
`issue224-s9-name-parts-20260922.json` via `loadPinnedProdNameParts()` (§16.3).

The write itself, `runProdAdoptionWrite()`, is exported and called from exactly two places: the
CLI's `runProdMain()` and the rehearsal harness (§16.5) — never duplicated. It re-asserts the
actor (`assertViableProdActor()`, built on the existing `isViableSuperAdmin` predicate in
`src/lib/auth/admin-lifecycle.ts` — no parallel actor model), classifies via the SAME `classify()`
DEV/test use, requires the exact first-adoption shape CREATE=92/ALREADY_SATISFIED=0/CONFLICT=0
(`assertExactFirstApplyShape()`, now shared — DEV's own inline check was refactored onto it,
behaviourally unchanged), writes through the unmodified `createPlayerInTransaction()` /
`attachAflTablesIdentityInTransaction()` primitives, then runs the shared postcondition battery
(`runDevPostWriteChecks()` — target-independent already; its DEV-only banner comment was updated,
its logic was not) plus one PROD-only proof, `assertNoAflApiIdentityWritten()`.

**Known gap at the end of this pass, flagged rather than silently resolved (§6's "re-read inside
the write transaction"):** `afldb_import` (the write role) holds no `SELECT` on `auth_users`
(migration 023 grants that table only to `afldb_auth`), so the actor could not be re-read inside
the SAME transaction that writes the 92 players without widening `afldb_import`'s privileges — a
change this pass did not make pre-emptively. The implemented approximation at the time: read
`AFLDB_PROD_AUTH_DATABASE_URL` once, immediately before the write transaction opened, and re-run
`assertViableProdActor()` transactionally-adjacent, as that transaction's first act on the same
already-fetched row. This was not byte-for-byte "inside the write transaction".

**Resolved in §17 below** (same worktree, follow-up pass, still uncommitted): migration 105 adds a
narrow `SECURITY DEFINER` function, `public.assert_viable_super_admin_actor(p_actor_id integer)
RETURNS void`, granted `EXECUTE` to `afldb_import` alone, and `runProdAdoptionWrite()` now calls it
as the write transaction's literal first statement. The gap this paragraph flagged no longer
applies; §17 documents the closure.

### 16.3 Calculated SHA-256 (D-251-5)

```
sha256(docs/rebuild-manifests/draftguru/issue224-s9-name-parts-20260922.json)
  = f93d19b1e8cd7cb63917178f9576b5fc4a382b8acaed316d53305ff555db9f41
```

Calculated directly from the currently tracked file (`sha256sum`), pinned as
`PINNED_PROD_NAME_PARTS_SHA256` in `register_issue224_s9_players.ts`, and exercised by
`loadPinnedProdNameParts()` — a mismatch refuses PROD mode before any database connection opens.
`loadAndValidateArtefacts(TARGET_SET, DECISION, loadPinnedProdNameParts())` resolves all 92 rows
(same two multipart names — "Alex Van Wyk", "Hussien El Achkar" — as the DEV/test path with the
same artefact).

### 16.4 DB-free validation

- `tests/register-issue224-s9-dev-write-gate.test.ts`: **93/93 pass** (was 47 before this pass;
  all new PROD coverage plus every pre-existing test, two of which were updated per §16.1).
- `tests/db-promotion-check.test.ts` (AFLDB-ISSUE-242, untouched): **264/264 pass** — pinning that
  this pass changed nothing there.
- `npx tsc --noEmit -p tsconfig.json`: clean, no errors.
- `npx eslint` on every changed/new TypeScript file: clean, no warnings.
- `git diff --check`: clean, no whitespace errors.
- `tests/db-test-rebuild.test.ts` (adjacent, AFLDB-ISSUE-235/245 rebuild-stage suite): **2 of 488
  fail** — both are source-text-shape assertions against `tools/migration/rebuild_afl_api_adjudications.ts`
  and `tools/migration/ensure_issue237_recovery_actor.ts`, neither of which this pass touched
  (`git status` on both is clean). Pre-existing/environmental in this fresh worktree, not a
  regression from this change; not investigated further as out of scope for ISSUE-251.

This worktree had no `node_modules` and no `.env` at the start of this pass (a known state of new
`D:\dev\afldb-<issue>` worktrees; see prior session notes). `npm ci` was run to enable the
requested validation; all tests above ran with a placeholder `DATABASE_URL` (no real database
reachable from this session) since the suites exercised are exactly the ones documented as
DB-free.

### 16.5 Remaining before an isolated real-DB rehearsal

`tools/rebuild/draftguru/issue251_prod_rehearsal.ts` (`npm run db:code-test:issue251-rehearsal --
seed|classify|apply|verify|teardown|residue`) is implemented but **has not been run**: no
PostgreSQL server was reachable from this session/worktree. It targets `code_test_db` exclusively
via `AFLDB_CODE_TEST_DATABASE_URL`/`AFLDB_CODE_TEST_IMPORT_DATABASE_URL` (never the retained PROD
candidate), mints one real enabled+enrolled `super_admin` actor with the app's own
`hashPassword`/`generateTotpSecret` (not the disabled recovery-actor shape), and calls the exact
same `runProdAdoptionWrite()` the real PROD path calls. Before it can be run for real:

1. an operator-provisioned `code_test_db` with current migrations/privileges applied, and neither
   the 92 registrations nor the 92 AFL Tables paths present (`seed` refuses otherwise);
2. `AFLDB_CODE_TEST_DATABASE_URL` / `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` set to that database;
3. run `seed`, `classify` (expect 0/92), `apply`, `verify` (expect 92/92, 0 afl_api identities),
   a second `classify`/read-only preflight (deterministic already-satisfied state), then
   `teardown` and `residue` (expect 0/0).

### 16.6 Findings for the reviewer

- The actor re-read privilege gap, §16.2, is the one design point this pass could not close
  without either widening `afldb_import`'s grants (not done) or a new migration (not done); it is
  a residual TOCTOU of negligible practical width for a manually-run, single-operator, single-shot
  adoption, but it is not literally "inside the write transaction" as §6 asks for.
- No other finding makes the current design unsafe or incomplete, subject to §16.5's rehearsal
  actually being run before any real PROD authorisation is requested.
- **Superseded by §17**: the reviewer's finding above was returned before rehearsal, exactly as
  intended. §17 documents the fix; §16.5's rehearsal still has not been run (this pass added no
  database access from this session either).

---

## 17. Follow-up pass — actor assertion moved in-transaction (this pass, uncommitted)

This section addresses, in full, the reviewer finding returned against §16: the pre-read
approximation (a separate `afldb_auth` read moments before the write transaction opened) is
**rejected** as insufficient, and rehearsal was correctly withheld until it was fixed. Nothing in
this pass has touched `afldb_prod`, the retained candidate
`afldb_prod_candidate_20260926-213225`, `afldb_dev`, or ISSUE-238's dirty worktree — the same
boundary §16 stated still holds. **The isolated real-DB rehearsal has still not been run.**
**ISSUE-251 is still not resolved. ISSUE-237 L5 remains blocked.**

### 17.1 Files changed in this pass

- `src/db/migrations/105_prod_actor_lifecycle_assertion.sql` (new) — the `SECURITY DEFINER`
  actor-assertion function.
- `tools/maintenance/privileges.sql` — reconciles migration 105's function exactly as it already
  reconciles migration 081's, in a new section immediately after it.
- `tools/rebuild/draftguru/register_issue224_s9_players.ts` — `runProdAdoptionWrite()` now calls
  the new function as its first act; `assertProdBoundary()` hard-pins the PROD hostname; doc
  comments updated throughout.
- `tools/rebuild/draftguru/issue251_prod_rehearsal.ts` — the rehearsal actor's email moved off a
  reserved fixture TLD (`example.invalid` → `rehearsal.afldb.internal`), and its `apply()` no
  longer passes a pre-fetched actor row to `runProdAdoptionWrite()`.
- `tests/register-issue224-s9-dev-write-gate.test.ts` — extended (93 → 120 tests) with coverage
  for the new function's SQL contract, the privileges reconciliation, the hardened host boundary,
  and the new in-transaction assertion wrapper.
- This runbook.

### 17.2 The SECURITY DEFINER actor assertion, exactly

Migration 105 creates `public.assert_viable_super_admin_actor(p_actor_id integer) RETURNS void`,
following migration 081's (`nl_search_telemetry_clear()`) pattern precisely:

- **Owner**: `afldb_owner` (reconciled by the migration and, after a privilege-losing restore, by
  `tools/maintenance/privileges.sql`).
- **`SECURITY DEFINER`**, `SET search_path = pg_catalog, pg_temp` — fixed and minimal.
- Fully qualifies `public.auth_users`; no dynamic SQL anywhere inside the function body (the
  ownership/grant `DO` blocks around it, outside `$fn$...$fn$`, use `EXECUTE`/dynamic SQL only for
  setup, exactly as 081 does).
- Accepts exactly one input, the actor id. Returns `void`; every refusal path is a `RAISE
  EXCEPTION` naming the id and the reason (never the row's email or any credential value); success
  returns nothing. `afldb_import` therefore learns pass/fail only, never account state as data it
  could store or branch on.
- Row-locks the selected `auth_users` row `FOR SHARE` as part of the same `SELECT` that reads it,
  before any viability check runs.
- Checks exactly `isViableSuperAdmin()`'s four conditions (`role = 'super_admin'`, `disabled_at IS
  NULL`, `password_hash IS NOT NULL`, `totp_secret IS NOT NULL`), then separately refuses a
  reserved fixture/example email domain using the identical rule
  `tools/db/promotion-inventory.ts` already applies everywhere else in the promotion contract
  (`TEST_FIXTURE_EMAIL_SQL` / `RESERVED_TEST_TLDS` / `RESERVED_EXAMPLE_DOMAINS`), inlined because a
  SQL migration cannot import a TypeScript module — `tests/register-issue224-s9-dev-write-gate.test.ts`
  pins the migration's literal domain lists against those exact TypeScript constants so the two
  can never silently diverge.
- Raises if the actor id does not exist at all (`SELECT ... FOR SHARE` finds no row).
- Never hard-codes `current_database() = 'afldb_prod'`: the CLI (`resolveProdTarget`,
  `assertProdBoundary`) owns the environment/database boundary; this function owns only account
  viability/fixture-domain refusal, so it also works, unmodified, against the isolated
  `code_test_db` rehearsal (§17.6/§16.5 — no database literally named `afldb_prod` is required).

**Privileges** (both migration 105 and `privileges.sql`): `REVOKE ALL ... FROM PUBLIC` runs
immediately after `CREATE FUNCTION`; `GRANT EXECUTE ... TO afldb_import` is the only grant — never
`afldb_auth` (which already holds direct `SELECT` on `auth_users` and has no reason to call this
instead), never `afldb_app`, never `afldb_backup`. `afldb_import` receives no `SELECT` on
`auth_users` anywhere in this pass; `tests/register-issue224-s9-dev-write-gate.test.ts` and the
privileges-section tests both pin that absence directly.

### 17.3 How actor locking works

`SELECT ... FOR SHARE` takes a row-level share lock on the selected `auth_users` row. PostgreSQL
releases row locks only at `COMMIT` or `ROLLBACK` of the transaction that acquired them — never
earlier — so calling the function as the write transaction's first statement holds that lock for
the remaining lifetime of the SAME transaction that performs the 92 registrations. A concurrent
`UPDATE`/`DELETE` against that exact row (disable, demote, credential wipe) is blocked until this
transaction ends, which is what makes the assertion authoritative rather than a snapshot taken
moments before the transaction opened: the actor cannot be invalidated between this call and this
transaction's own `COMMIT`. `FOR SHARE` rather than `FOR UPDATE`: this transaction only needs to
prevent the row from changing under it, never to change the row itself, and `FOR SHARE` does not
serialise two concurrent viability checks against the same actor against each other (share locks
do not conflict with each other), where `FOR UPDATE` would.

### 17.4 Changes to the PROD transaction

`runProdAdoptionWrite(tx, { targets, adminUserId })` — the `actor: ProdActorRow` parameter is
**removed**; no pre-fetched row is accepted or trusted. The function's literal first statement is
now `await assertViableActorInTransaction(tx, params.adminUserId);`, which issues `` tx`SELECT
public.assert_viable_super_admin_actor(${actorId})` `` — before `classify()`, before
`assertExactFirstApplyShape()`, before the first `createPlayerInTransaction()` /
`attachAflTablesIdentityInTransaction()` call. A refusal there rejects the promise, which
`sql.begin()` turns into a rollback of the whole transaction before row 1 is written. A source-order
test (`tests/register-issue224-s9-dev-write-gate.test.ts`) pins that this call textually precedes
all three.

`runProdMain()`'s existing brief `AFLDB_PROD_AUTH_DATABASE_URL` read is **kept**, but is now
explicitly informational only: it gives an operator a fast, friendly refusal for an obviously-wrong
actor before any write connection is even opened, and its result (the fetched row) is discarded
rather than passed into `runProdAdoptionWrite()` — only `args.adminUserId` is. The write-boundary
authority is exclusively the in-transaction `SECURITY DEFINER` call. `issue251_prod_rehearsal.ts`'s
`apply()` was updated the same way.

### 17.5 Host-boundary change

`assertProdBoundary()` no longer treats `actual.host === args.expectedHost` as sufficient — that
comparison alone would let an operator running this tool on some OTHER machine supply that same
machine's own hostname as `--expected-host` and have the two sides trivially agree. A new pinned
literal, `PROD_HOSTNAME = 'afldb-prod'`, is the shared reference both sides must independently
equal:

1. the running host must equal `PROD_HOSTNAME` exactly (refused otherwise, regardless of what
   `--expected-host` claims);
2. `--expected-host` must independently equal `PROD_HOSTNAME` exactly (refused otherwise, even when
   the running host IS `afldb-prod`);
3. only once both hold does the checkout-revision check run.

`current_database() = 'afldb_prod'` (checked where the PROD connection is opened, in
`resolveProdTarget`/`runProdMain`) is unchanged and still exact.

### 17.6 Privilege reconciliation change

`tools/maintenance/privileges.sql` gained one new section, immediately after the existing
migration-081 (`nl_search_telemetry_clear()`) reconciliation, reconciling migration 105's function
in the same shape: owner → `afldb_owner`, then `REVOKE ALL ... FROM PUBLIC`, then (guarded by an
`afldb_import` existence check) `GRANT EXECUTE ... TO afldb_import`. This closes the same
`pg_restore --no-privileges` gap 081's section documents — a restored function with no ACL reverts
to `PUBLIC EXECUTE`, which for a `SECURITY DEFINER` function reading `auth_users` is a strictly
worse widening here than for 081's telemetry-clear function, since `afldb_import` otherwise has no
path at all to read `auth_users`.

### 17.7 Tests added/updated

`tests/register-issue224-s9-dev-write-gate.test.ts`: **93 → 120 tests, all pass.** New coverage
added for: `assertViableActorInTransaction` (calls the function with exactly the given id and
propagates a refusal); a source-order pin that `runProdAdoptionWrite` calls it before `classify()`
and before either canonical mutation primitive, and that its params type no longer accepts a
pre-fetched actor row; migration 105's SQL text (`SECURITY DEFINER`, fixed `search_path`, fully
qualified relation, no dynamic SQL inside the function body, `FOR SHARE` before the viability
checks, all four `isViableSuperAdmin` conditions, the fixture-domain refusal pinned against
`RESERVED_TEST_TLDS`/`RESERVED_EXAMPLE_DOMAINS`, `PUBLIC` revoked before `afldb_import` is granted,
owner pinned to `afldb_owner`, never granting `afldb_import` a direct `auth_users` SELECT, never
hard-coding `current_database() = 'afldb_prod'`); the same reconciliation shape and ordering in
`privileges.sql`, in its own section, guarded by its own `afldb_import` existence check; and the
hardened `assertProdBoundary` host contract, replacing the three prior cases with the exact three
the finding named (`devbox`/`devbox` refused, `afldb-prod`/`other` refused, `afldb-prod`/`afldb-prod`
accepted subject to the revision guard) plus the pre-existing revision-mismatch case.

`tests/db-promotion-check.test.ts` (AFLDB-ISSUE-242, untouched): **264/264 pass**, unmodified —
this pass changed nothing there.

### 17.8 Validation results (this pass)

- `tests/register-issue224-s9-dev-write-gate.test.ts`: **120/120 pass.**
- `tests/db-promotion-check.test.ts`: **264/264 pass** (unmodified).
- `tests/db-test-rebuild.test.ts`: **486/488 pass** — the SAME 2 pre-existing failures §16.4
  documented (source-text-shape assertions against
  `tools/migration/rebuild_afl_api_adjudications.ts` and
  `tools/migration/ensure_issue237_recovery_actor.ts`, neither touched by this pass; `git status`
  on both remains clean). No new regression.
- `npx tsc --noEmit -p tsconfig.json`: clean, no errors.
- `npx eslint` on every changed/new TypeScript file
  (`register_issue224_s9_players.ts`, `issue251_prod_rehearsal.ts`,
  `register-issue224-s9-dev-write-gate.test.ts`): clean, no warnings.
- `git diff --check`: clean, no whitespace errors.
- No database was reachable from this session; the migration's live behaviour (locking, the
  `SECURITY DEFINER` execution context, the actual `PUBLIC`/`afldb_import` ACL) is proven only by
  the DB-free structural pins above plus the (still unrun) rehearsal — not by this pass directly
  executing SQL against any database.

### 17.9 What remains before the isolated real-DB rehearsal

Unchanged from §16.5, with one addition: the rehearsal database must have migration 105 applied
(`npm run db:migrate`) and `tools/maintenance/privileges.sql` run against it before `apply`, or
`assert_viable_super_admin_actor()` will be absent and `runProdAdoptionWrite()` will fail closed
with a "function does not exist" error at its very first statement — which is the correct,
fail-closed behaviour for a rehearsal database that has not yet been fully migrated, not a defect.

**No live PROD mutation is authorised. The rehearsal has not been run. ISSUE-251 is not resolved.**

---

## 18. Isolated real-PostgreSQL rehearsal (2026-09-27, this pass, uncommitted)

The isolated `code_test_db` rehearsal (§16.5/§17.9) has now been run for real, against a live
PostgreSQL server, via an operator-provisioned SSH tunnel to `127.0.0.1:55432`. Nothing in this
pass touched `afldb_prod`, the retained candidate `afldb_prod_candidate_20260926-213225`,
`afldb_dev`, or `afldb_test`. No Git operation was performed. **This section documents the
rehearsal only. ISSUE-251 is still not resolved and no live PROD authorisation is requested by
this pass.**

### 18.1 Database identity

- Target: `code_test_db` exclusively, via `AFLDB_CODE_TEST_DATABASE_URL` (`afldb_owner`) and
  `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` (`afldb_import`), both independently confirmed by
  `current_database()`/`current_user` before any write.
- Pre-migration state: 104 migrations applied, `105_prod_actor_lifecycle_assertion.sql` pending —
  the expected pre-105 baseline.
- Baseline residue census (read-only, before any seed): 0 of the 92 cohort AFL Tables paths
  present, 0 `manual_admin_edit` identities, no rehearsal actor row, 0 active
  `manual_admin_edit` `data_overrides`, 13,273 total players.

### 18.2 Migration 105 and privilege reconciliation — live-catalog evidence

- `npm run db:migrate:code-test`: applied `105_prod_actor_lifecycle_assertion.sql` cleanly (one
  migration applied, ok).
- `npm run db:privileges:code-test`: reconciled cleanly; the exact expected notice fired —
  `assert_viable_super_admin_actor(): PUBLIC revoked, afldb_import EXECUTE granted`.
- Live catalog query (`pg_proc`/`aclexplode`/`has_function_privilege`) against `code_test_db`
  confirmed, independently of the migration/privileges source text:
  - `public.assert_viable_super_admin_actor(integer)` present, owner `afldb_owner`,
    `SECURITY DEFINER` true, volatility `VOLATILE`, `search_path = pg_catalog, pg_temp`.
  - ACL holds exactly two grantees: `afldb_owner` (owner) and `afldb_import` (`EXECUTE`) — no
    `PUBLIC` entry.
  - Per-role `EXECUTE` check: `afldb_app`=false, `afldb_auth`=false, `afldb_backup`=false,
    `afldb_import`=true, `afldb_owner`=true.
  - `afldb_import` holds no `SELECT` on `public.auth_users` (`has_table_privilege` = false).

### 18.3 Actor viability refusal matrix (live, against real rows)

Seven fixture `auth_users` rows (rehearsal-owned, cleaned up immediately after), each fed through
`SELECT public.assert_viable_super_admin_actor($id)` as `afldb_import`:

| Case | Expected | Observed |
|---|---|---|
| Viable, enabled, enrolled `super_admin` | PASS | PASS |
| Disabled | REFUSE | REFUSE (`is disabled`) |
| No password | REFUSE | REFUSE (`no password enrolled`) |
| No TOTP | REFUSE | REFUSE (`no TOTP enrolled`) |
| Role `admin` | REFUSE | REFUSE (`is role admin, not super_admin`) |
| Reserved fixture domain (`example.test`) | REFUSE | REFUSE (`reserved fixture/example email domain`) |
| Nonexistent `auth_users.id` | REFUSE | REFUSE (`does not exist`) |

All seven matched exactly. Fixture rows deleted immediately after.

### 18.4 Row-lock proof

Two independent connections: transaction A (`afldb_import`) called the assertion and held its
transaction open for ~1.5s before committing; transaction B (`afldb_owner`, simulating a
concurrent admin lifecycle write) issued `UPDATE auth_users SET disabled_at = now() ...` against
the same row ~0.3s after A acquired its lock. B's `UPDATE` did not complete until **after** A
committed (observed wait ≈1.6s, matching A's hold time) — the `FOR SHARE` lock held for the
remaining lifetime of A's transaction, exactly as designed. (One earlier attempt at this proof
had a self-deadlock bug in the *test harness* — A's callback awaited B's completion while B
waited on A's lock — corrected by running A and B fully concurrently; not a product defect.)

### 18.5 First-adoption apply

- `seed`: 92 targets confirmed absent; rehearsal actor minted (enabled, `super_admin`,
  password+TOTP enrolled, non-fixture domain).
- `classify` (read-only, pre-apply): **0/92** resolved — matches the required initial shape.
- `apply`: in-transaction classification **CREATE=92 / ALREADY_SATISFIED=0 / CONFLICT=0**;
  all in-transaction postconditions reported OK (92/92 identities resolve, 92 distinct
  `player_id`s, no duplicate slug, 92/92 name-parts correct, player count +92 exactly, 92/92
  `player_career_stats`, 92/92 `data_overrides` durability rows with the attached path, 92/92
  durable payloads carry the resolved name parts, 92/92 `data_edits` audit writes confirmed,
  **0/92 `afl_api` identities created**); transaction committed.

### 18.6 Independent post-commit census (separate from the harness's own `verify`)

Run against `code_test_db` independently of `issue251_prod_rehearsal.ts verify` (which also
passed: "all 92 paths resolved ... 0 afl_api identities"):

- 92 cohort canonical players; 92 distinct players.
- 92 `manual_admin_edit` identities; 92 distinct manual tokens; no player carries a second token.
- 92 accepted (`unique`/`resolved`) AFL Tables identities; no player carries more than one cohort
  path.
- 92 active `data_overrides` creation records; every one's `afltables_profile_path` matches the
  pinned path for that player; every one attributed to the rehearsal actor (`admin_user_id`).
- 0 `afl_api` external_identities among the 92 adopted players.
- Capture/replay lifecycle oracle: the production `replay_admin_overrides(players)` oracle itself
  is Python tooling (`tools/migration/common.py`) invoked as part of a full rebuild pipeline; it
  was **not separately invoked** in this pass (out of scope for a targeted rehearsal). The
  postcondition this oracle depends on — every durable `data_overrides` payload carries the
  resolved `given_name`/`surname` split, not a last-token guess — was proven directly, in-transaction,
  by `runDevPostWriteChecks` (§18.5) and independently re-confirmed here. This is evidence the
  oracle would accept the state, not a run of the oracle itself; flagged rather than silently
  assumed equivalent.

### 18.7 Second classification (deterministic already-satisfied state)

- `classify` (read-only, post-apply): **92/92** resolved — deterministic, as required.
- A second `apply` attempt against this same already-satisfied state was run deliberately (not
  merely classified): in-transaction classification came back **CREATE=0 / ALREADY_SATISFIED=92 /
  CONFLICT=0**, and `assertExactFirstApplyShape` refused it outright (`REFUSED: PROD apply requires
  exactly CREATE=92, ALREADY_SATISFIED=0, CONFLICT=0 ...`). Nothing was written; the independent
  census afterward still showed exactly 92 (no double-write). First-adoption mode does **not**
  silently accept a retry against fully-satisfied state, as designed.

### 18.8 Atomic rollback proof

No purpose-built fault-injection flag exists in `register_issue224_s9_players.ts` or
`issue251_prod_rehearsal.ts` (checked directly; none was added to either). Rather than weaken
production code to manufacture one, this pass followed the same convention already established
elsewhere in this codebase (`ForcedRollback`, `tools/records/first-kick-goal-rehearsal.ts`): a
rehearsal-only script called the real, unmodified `runProdAdoptionWrite()` inside `sql.begin()`
with a freshly-seeded actor and the real 92-row target set, let it complete all 92 real writes and
the full in-transaction postcondition battery for real (identical output to §18.5), then — before
the callback returned, i.e. before `COMMIT` — threw a sentinel error defined only in the
rehearsal script itself. `register_issue224_s9_players.ts` was not modified for this proof.

Post-rollback, independently queried:

- players: identical count before and after (13,273 → 13,273; +0 net).
- cohort AFL Tables identities: 0.
- `manual_admin_edit` identities (any): 0.
- `data_overrides` creation records (any `manual_admin_edit`): 0.
- `data_edits` audit rows for the rollback-proof actor: 0.

Zero residue from the failed transaction, as required.

### 18.9 Retry / conflict cases

Three cases, each set up against a freshly-seeded actor, each independently confirmed to leave
zero unintended state:

1. **One pre-existing correct registration.** One of the 92 targets (`Mitch_Podhajski`) was
   registered for real via the same canonical primitives (`createPlayerInTransaction` +
   `attachAflTablesIdentityInTransaction`), outside `runProdAdoptionWrite`. A subsequent real
   `apply` against the full 92-row target set classified **CREATE=91 / ALREADY_SATISFIED=1 /
   CONFLICT=0** and refused (`assertExactFirstApplyShape`). Independently confirmed only that one
   path remained resolved afterward (no partial write of the other 91). Fixture cleaned up.
2. **Ambiguous/conflicting path.** An `external_identities` row with `status = 'ambiguous'` and
   `player_id = NULL` was seeded for one target path (`Milan_Murdock`). A real `apply` classified
   **CREATE=91 / ALREADY_SATISFIED=0 / CONFLICT=1**, with the CONFLICT detail naming the exact
   unresolved-status reason, and refused before any of the 92 rows was written (`0 CONFLICT row(s)
   — refusing to write ANY of the 92 rows`). Independently confirmed 0 cohort paths resolved
   afterward. Fixture cleaned up.
3. **Actor made non-viable between preflight and write.** A real, viable actor was seeded (as if
   a preflight had already accepted it), then disabled via a separate `afldb_owner` connection —
   simulating exactly the race the migration-105 fix targets. The subsequent real `apply` refused
   with `assert_viable_super_admin_actor: auth_users.id ... is disabled`, and independently
   confirmed **zero** of the 92 rows were written — the in-transaction assertion refused before
   row 1, proving the `SECURITY DEFINER` fix closes the gap §16.2/§16.6 flagged before this
   rehearsal ran.

### 18.10 Teardown and residue

`issue251_prod_rehearsal.ts teardown` initially **failed** on its first real invocation (after the
§18.5 apply):

> `REFUSED: update or delete on table "auth_users" violates foreign key constraint
> "data_edits_admin_user_id_fkey" on table "data_edits"`

**Root cause (rehearsal-fixture defect, not a production defect):** `attachAflTablesIdentityInTransaction`'s
`recordDataEdit()` call writes one append-only `data_edits` row per cohort player, FK'd to the
attributing actor. `teardown()` deleted the cohort's `data_overrides`/`external_identities`/
`player_career_stats`/`players` rows and then tried to delete the actor, but never deleted the
`data_edits` rows referencing that actor first, so the FK refused the actor deletion.

**Fix applied, this pass, to `tools/rebuild/draftguru/issue251_prod_rehearsal.ts` only** (not
`register_issue224_s9_players.ts` — no production code was touched): `teardown()` now deletes
`data_edits WHERE table_name = 'players' AND row_id = ANY(<cohort player ids>)` before deleting
`data_overrides`, scoped to exactly the cohort's own player ids (never a blanket delete by
`admin_user_id`, so it can never remove another actor's audit trail). Re-run after the fix:
`Teardown: removed 92 player(s) and the rehearsal actor.` — clean.

Final residue check (after all of §18.5–§18.9, each of which cleaned up its own fixtures as it
went, plus this final teardown): `Residue: 0 pinned path(s) still present, 0 rehearsal actor
row(s) still present.` Independent census confirmed 13,273 players (the original baseline) and no
lingering `pg_stat_activity`/`pg_locks` entries.

**One incidental operational finding, not a code defect:** partway through this pass, a rehearsal
script that was later found to have a self-deadlocking test-harness bug (§18.4) was killed
client-side; its PostgreSQL backend did not immediately notice the client disconnect (the tunnel
did not propagate the close promptly) and remained connected server-side holding a `FOR SHARE`
lock, blocking a later cleanup attempt for several minutes. Diagnosed via `pg_stat_activity`/
`pg_locks` and resolved with `pg_terminate_backend()` on the specific zombie PIDs (as `afldb_owner`;
the `afldb_import`-owned zombie backend needed an operator-level terminate, which self-resolved
shortly after). This is a rehearsal-session operational hazard (killed client processes on a
tunnelled connection can leave a zombie backend holding a real lock), not a finding about the
ISSUE-251 implementation itself.

### 18.11 Validation after rehearsal

- `npx vitest run tests/register-issue224-s9-dev-write-gate.test.ts`: **120/120 pass** (unchanged).
- `npx vitest run tests/db-promotion-check.test.ts` (AFLDB-ISSUE-242): **264/264 pass** (unchanged).
- `tests/integration/privileges.test.ts` (the tracked live-catalog privilege suite) was **not**
  run against `code_test_db`: its guard (`tests/integration/guard.ts`) requires
  `AFLDB_TEST_DATABASE_URL` naming a database whose name ends `_test`, and connects via the
  global `DATABASE_URL`-based client — `code_test_db` does not match that naming contract, and
  this rehearsal's hard boundary forbids setting up anything that could be mistaken for, or spill
  onto, `afldb_test`. §18.2 already independently proved, directly against the live
  `code_test_db` catalog, every assertion this suite would make about migration 105's function
  (owner, `SECURITY DEFINER`, ACL, no `afldb_import` `SELECT` on `auth_users`) — but the tracked
  suite itself has still never been executed against a real database with migration 105 present.
  Flagged as a genuine gap, not silently assumed equivalent.
- `npx tsc --noEmit -p tsconfig.json`: clean, no errors.
- `npx eslint` on `register_issue224_s9_players.ts`, `issue251_prod_rehearsal.ts`,
  `register-issue224-s9-dev-write-gate.test.ts`: clean, no warnings.
- `git diff --check`: clean, no whitespace errors.
- `git status --short`: identical to session start plus the pre-existing uncommitted ISSUE-251
  files; no unrelated file was created, modified, or left behind (rehearsal scratch scripts used
  during this pass were deleted before this validation ran).

### 18.12 Files changed during this rehearsal pass

- `tools/rebuild/draftguru/issue251_prod_rehearsal.ts` — `teardown()` fix only (§18.10). Every
  other line is unchanged from §16.5/§17.
- This runbook (§18).

No other tracked file was modified. `src/db/migrations/105_prod_actor_lifecycle_assertion.sql` and
`tools/maintenance/privileges.sql` are unchanged from §17 and are now, additionally, **applied to
`code_test_db`** (a live database, not a tracked file — this does not appear in `git status`).

### 18.13 Remaining before ISSUE-251 can be considered for resolution

1. `tests/integration/privileges.test.ts` has still never been run against a real database with
   migration 105 present (§18.11) — only directly-equivalent ad hoc catalog queries have.
2. The production `replay_admin_overrides(players)` oracle itself was not separately invoked
   (§18.6) — only the postcondition it depends on was independently re-proven.
3. Per §15/§16.5, still outstanding regardless of this pass's result: the full diff/review pass,
   and only then a separate, explicit operator authorisation for any live PROD adoption.

**No live PROD mutation is authorised by this pass. ISSUE-251 is not resolved. ISSUE-237 L5
remains blocked pending §15 step 5 (full diff/review) and step 6 (separate PROD authorisation).**

---

## 19. Review finding closed — PROD checkout-integrity boundary (this pass, uncommitted)

The full ISSUE-251 review (following §18) returned exactly one finding, graded MEDIUM:

> `--expected-revision` pins HEAD but does not prove the checkout being executed is free of local
> code drift.

**Operator decision: fixed in code, not accepted as a procedural gap.** This section documents
that fix. Nothing in this pass touched `afldb_prod`, the retained candidate
`afldb_prod_candidate_20260926-213225`, `afldb_dev`, or `afldb_test`; no database was contacted;
no Git operation (stage/commit) was performed. **ISSUE-251 is still not resolved. ISSUE-237 L5
remains blocked.**

### 19.1 The gap, precisely

`assertProdBoundary` (§16.2/§17.5) proves the running host is `afldb-prod`, that `--expected-host`
independently names the same literal, and that `git rev-parse HEAD` equals the operator-supplied
`--expected-revision`. None of that proves the working tree at that commit is otherwise
**unmodified**: an operator could run the tool against the correct commit while a tracked file sat
modified, staged, or deleted underneath it, or while an unrelated untracked file had been dropped
into the checkout — `--expected-revision` alone is silent about all of that.

### 19.2 The fix — `assertProdCheckoutIntegrity`

A new, separate, DB-free boundary function,
`assertProdCheckoutIntegrity()`/`judgeCheckoutIntegrity()`/`gatherCheckoutIntegrityFacts()`
(`tools/rebuild/draftguru/register_issue224_s9_players.ts`), runs in `runProdMain()` immediately
after `assertProdBoundary(args)` and, like it, strictly before `resolveProdTarget()` opens the
writable PROD connection. It proves, via direct `git` process invocation (argv arrays via
`spawnSync`, no shell, nothing interpolated into a command string; every invocation's `cwd` is
fixed to this file's own `REPO_ROOT`, never an inherited process CWD):

1. **Own-repository proof.** `git rev-parse --show-toplevel` (cwd = `REPO_ROOT`) succeeds and its
   answer resolves, via `realpathSync` (symlink/case/short-path safe), to that same `REPO_ROOT` —
   proving the check runs against the repository containing the running tool itself, not whatever
   repository a stray inherited working directory might otherwise have pointed at. A failed
   invocation (not a git repository at all) or a resolved mismatch both REFUSE.
2. **Zero tracked drift.** `git diff HEAD --quiet --exit-code --` reports zero differences. A diff
   against a commit (rather than only the index) covers unstaged modifications, staged
   modifications, deletions, and additions/renames of tracked paths in one comparison — any of
   those REFUSEs.
3. **Zero unexpected untracked files.** `git ls-files --others --exclude-standard -z`, parsed as
   NUL-delimited data (never whitespace-split, so an unusual filename is never misparsed). Every
   resulting path is checked against `PROD_ALLOWED_UNTRACKED_RE`; anything that doesn't match
   REFUSEs, naming the offending path(s).

Any git invocation failure (git missing, non-git directory, unexpected exit status, a `cwd` that
does not exist) throws and is fail-closed — the caller never receives a "successful" but
meaningless facts object. The Git-state judgment is factored into a pure function,
`judgeCheckoutIntegrity(facts)`, taking a plain `CheckoutIntegrityFacts` value — so DB-free tests
exercise the actual decision logic without depending on this (or any) real worktree, and a second,
real-git integration suite exercises `gatherCheckoutIntegrityFacts`/`assertProdCheckoutIntegrity`
against fresh, disposable scratch repositories (never this session's own dirty ISSUE-251
worktree).

### 19.3 The permitted untracked exception, exactly

```
docs/rebuild-manifests/afltables_fitzroy_core/settle-*.json
```

— `PROD_ALLOWED_UNTRACKED_RE = /^docs\/rebuild-manifests\/afltables_fitzroy_core\/settle-[^/]+\.json$/`.
Narrow by construction: exactly that one directory, a `settle-` prefix, a `.json` suffix, no
further path segments. A real PROD checkout's own pre-existing, legitimately untracked settle
manifests under that exact family are the only untracked exception; nothing else under `docs/` (a
different JSON file, a script, a source file, an alternate manifest directory, a temporary or
generated file, arbitrary evidence) is treated as established merely by being nearby. No count of
the current PROD settle-manifest census is hard-coded anywhere in this check — an operator
procedure may separately record the expected PROD baseline count, but the code itself accepts any
number of files matching the exact path family and refuses everything else.

### 19.4 Files changed in this pass

- `tools/rebuild/draftguru/register_issue224_s9_players.ts` — `assertProdCheckoutIntegrity()`,
  `judgeCheckoutIntegrity()`, `gatherCheckoutIntegrityFacts()`, `PROD_ALLOWED_UNTRACKED_RE`, the
  `CheckoutIntegrityFacts` type, and a shared `runGit()` helper (also used to reimplement
  `gitRevision()` without a shell, replacing the prior `execSync` call — `node:child_process`'s
  `spawnSync` is now the only process-spawning primitive in this file); one new call site in
  `runProdMain()`, immediately after `assertProdBoundary(args)`; doc comments updated.
- `tests/register-issue224-s9-dev-write-gate.test.ts` — extended (120 → 144 tests) with: a pure
  `judgeCheckoutIntegrity` suite over hand-built facts; a real-git integration suite that builds
  fresh scratch repositories under the OS temp directory and exercises
  `gatherCheckoutIntegrityFacts`/`assertProdCheckoutIntegrity` against them directly (unstaged
  modification, staged modification, deletion, unexpected `.ts` file, unexpected JSON outside the
  exact settle-manifest path, a permitted settle manifest alongside one unexpected file, a
  non-git directory, a nonexistent `cwd`, and a nested-directory case proving the own-repository
  check actually distinguishes an enclosing toplevel from the directory passed in); and a
  source-order pin that `runProdMain` calls `assertProdBoundary`, then
  `assertProdCheckoutIntegrity`, then `resolveProdTarget` (the write DSN) in that order, gated
  behind `prodWriteAuthorized`, with exactly one call site in the whole file (TEST/DEV paths never
  reach it).
- This runbook (§19).

No other tracked file was touched. `runProdAdoptionWrite`, migration 105, `privileges.sql`,
`issue251_prod_rehearsal.ts`, the pinned artefacts, and every DEV/TEST code path are unchanged by
this pass.

### 19.5 Validation

- `npx vitest run tests/register-issue224-s9-dev-write-gate.test.ts`: **144/144 pass** (was 120
  before this pass).
- `npx vitest run tests/db-promotion-check.test.ts` (AFLDB-ISSUE-242, untouched): **264/264 pass**.
- `npx tsc --noEmit -p tsconfig.json`: clean, no errors.
- `npx eslint` on `register_issue224_s9_players.ts` and
  `register-issue224-s9-dev-write-gate.test.ts`: clean, no warnings.
- `git diff --check`: clean, no whitespace errors.
- No `code_test_db` rehearsal rerun: this pass changes only a CLI-side, pre-connection safety
  boundary; it touches no transaction/database code path (`runProdAdoptionWrite`, migration 105
  and its actor assertion, and every postcondition are byte-for-byte unchanged), so §18's rehearsal
  evidence remains valid as recorded.

### 19.6 Review status

Subject to independent confirmation, this closes the one MEDIUM finding the full ISSUE-251 review
returned, with no new CRITICAL/HIGH/MEDIUM finding introduced by the fix itself:

**REVIEW PASS — no unresolved CRITICAL/HIGH/MEDIUM findings** (pending the reviewer's own
confirmation of this section).

This does **not** by itself authorise a live PROD apply. Per §15, the isolated real-DB rehearsal
evidence (§18) remains valid, but the full diff/review pass and a separate, explicit operator
authorisation for any live PROD adoption are still outstanding, unchanged from §18.13.

**No live PROD mutation is authorised by this pass. ISSUE-251 is not resolved. ISSUE-237 L5
remains blocked.**

---

## 20. Real privilege-suite run against `issue251_privileges_test` — one stale ISSUE-235 test
exception, not an ISSUE-251 defect (2026-09-27, this pass, uncommitted)

§18.11/§18.13 flagged that `tests/integration/privileges.test.ts` had never been run against a
real database with migration 105 present — only directly-equivalent ad hoc catalog queries had.
This pass closed that gap using a disposable database, `issue251_privileges_test`, with current
migrations (including 105) and `tools/maintenance/privileges.sql` applied. Nothing in this pass
touched `afldb_prod`, the retained candidate, `afldb_dev`, or `afldb_test`; no Git operation was
performed. **ISSUE-251 is still not resolved. ISSUE-237 L5 remains blocked.**

### 20.1 Failure observed

`tests/integration/privileges.test.ts` — `afldb_import is confined to the statistical tables >
writes exactly the tables the registry allows, and no others` reported:

`afl_api_identity_adjudications: WRITABLE BUT NOT REGISTERED`

### 20.2 Classification: pre-existing stale ISSUE-235 test exception list, not an ISSUE-251
privilege defect

- Actual database state matched migration 104
  (`src/db/migrations/104_afl_api_identity_adjudications.sql`) and its dedicated contract exactly:
  `afldb_import` holds SELECT + INSERT + identity-sequence USAGE on
  `afl_api_identity_adjudications`, no UPDATE/DELETE/TRUNCATE, and the table is deliberately not
  registered in `afldb_meta.import_writable_tables` — registering it would hand back full DML via
  `grant_import_write()` and destroy the append-only ledger property.
- This branch's `privileges.sql` had already been applied successfully to
  `issue251_privileges_test` (§20's premise); the reconciler is not the defect.
- Direct catalog proof for migration 105 (§18.2's equivalent, re-confirmed live on this database)
  remained green throughout.
- The failing assertion is the aggregate registry-vs-INSERT probe
  (`writes exactly the tables the registry allows, and no others`). Its `c.relname NOT IN (...)`
  exception list already carried eight prior deliberate narrow-write exceptions (migrations 066,
  083, 094 ×2, 080 ×2) but had not been updated when migration 104/AFLDB-ISSUE-235 added a ninth.
  The same file's dedicated ISSUE-235 test (`appends the afl_api human identity ledger and can
  never rewrite it`) already asserted the table's exact narrow shape correctly
  (`inserts: true, selects: true, updates: false, deletes: false, truncates: false,
  registered: false`) and needed no change.
- The correction is test-only: `afl_api_identity_adjudications` was added to the aggregate test's
  named exception list, with the preceding comment extended to identify it as the ninth deliberate
  narrow-write exception (migration 104/AFLDB-ISSUE-235), pointing to the dedicated ISSUE-235 test
  for its exact asserted shape. No exact-equality semantics were weakened; no generic
  ignore-unregistered rule was added.
- This does not invalidate migration-105 or the `code_test_db` rehearsal evidence in §17–§18: those
  passes never touched this aggregate assertion or `afl_api_identity_adjudications`'s privilege
  shape, and the table's actual grants were already correct before this pass — only the test's
  exception list was stale.

### 20.3 Fix applied

`tests/integration/privileges.test.ts` only:

1. Added `'afl_api_identity_adjudications'` to the `c.relname NOT IN (...)` list in the `writes
   exactly the tables the registry allows, and no others` test.
2. Extended the preceding explanatory comment to name it as the ninth deliberate narrow-write
   exception (migration 104/AFLDB-ISSUE-235), noting its exact shape is asserted by the dedicated
   ISSUE-235 test later in the same file.

No migration, no `privileges.sql`, and no non-test TypeScript file changed in this pass.
`afldb_meta.import_writable_tables` was not touched; `grant_import_write('afl_api_identity_adjudications')`
was not called; no grant was widened.

### 20.4 Validation

- DSN confirmation (independent, before any integration test): both `AFLDB_TEST_DATABASE_URL` and
  `AFLDB_TEST_IMPORT_DATABASE_URL`, derived by swapping the database name in the working
  `AFLDB_CODE_TEST_DATABASE_URL`/`AFLDB_CODE_TEST_IMPORT_DATABASE_URL` DSNs, independently queried
  `current_database() = 'issue251_privileges_test'` as `afldb_owner` and `afldb_import`
  respectively before the suite ran.
- `npx vitest run tests/integration/privileges.test.ts`: **38/38 pass.**
- `npx vitest run tests/register-issue224-s9-dev-write-gate.test.ts`: **144/144 pass** (unchanged
  from §19.5; this pass touched no file in that suite's scope).
- `npx vitest run tests/db-promotion-check.test.ts` (AFLDB-ISSUE-242, untouched): **264/264 pass.**
- `npx tsc --noEmit -p tsconfig.json`: clean, no errors.
- `npx eslint tests/integration/privileges.test.ts`: clean, no warnings.
- `git diff --check`: clean, no whitespace errors.
- The database was not mutated to make the test pass; only the test file changed.

### 20.5 Files changed in this pass

- `tests/integration/privileges.test.ts` — the named exception plus its comment (§20.3). No other
  file changed.

### 20.6 Status after this pass

- Prior migration-105 and `code_test_db` rehearsal evidence (§16–§19) remains valid, unmodified,
  and unaffected by this correction.
- `tests/integration/privileges.test.ts` has now been run for real against a database with
  migration 105 present, closing the gap §18.11/§18.13 flagged. Its result is a clean 38/38 pass
  with no defect in migration 104, migration 105, or `privileges.sql`.
- `issue251_privileges_test` is now safe to destroy (not performed by this pass — the operator
  drops it).
- ISSUE-251 has no remaining technical blocker known to this pass before drafting the PROD adoption
  operator procedure. Outstanding per §15/§18.13/§19.6, unchanged: the full diff/review pass (if not
  already considered closed by §19.6's pending confirmation) and a separate, explicit operator
  authorisation for any live PROD adoption. `replay_admin_overrides(players)` was still not
  separately invoked (§18.6) — only its dependent postcondition was independently re-proven.

**No live PROD mutation is authorised by this pass. ISSUE-251 is not resolved. ISSUE-237 L5 remains
blocked. AFLDB-ISSUE-237 L5 is not unblocked by this pass.**

---

## 21. PROD adoption operator procedure (drafted 2026-09-27, this pass, uncommitted — NOT executed)

**This section is a procedure draft only.** Nothing in this pass touched `afldb_prod`, the
retained candidate `afldb_prod_candidate_20260926-213225`, `afldb_dev`, or `afldb_test`; no
database was contacted; no Git operation was performed; no `--apply` was run; ISSUE-251 is **not**
resolved by this section and ISSUE-237 L5 is **not** unblocked by it. Every command below is
derived directly from `tools/rebuild/draftguru/register_issue224_s9_players.ts` as it stands on
this branch (§16–§20), `docs/production-promotion.md`, `docs/deployment.md`,
`docs/backup-restore.md`, `docs/production-cutover.md`, `tools/db/migrate.ts` and
`tools/db/privileges.ts`. Every place the source could not prove an exact command is called out
explicitly in §21.13 rather than invented.

### 21.0 Roles of the three PROD DSNs (read this before any phase)

| Variable | Role | Used by |
|---|---|---|
| `AFLDB_PROD_DATABASE_URL` | `afldb_owner` | `npm run db:migrate -- --target prod`, `npm run db:status -- --target prod`, direct `psql`/backup/restore-test commands. **Never read by the adoption CLI itself.** |
| `AFLDB_PROD_IMPORT_DATABASE_URL` | `afldb_import` | The adoption CLI's write connection (`resolveProdTarget`) — the only DSN `register_issue224_s9_players.ts --target prod` ever opens for writing. |
| `AFLDB_PROD_AUTH_DATABASE_URL` | `afldb_auth` | The adoption CLI's brief, informational, read-only pre-write actor check (`resolveProdAuthTarget`) — never authoritative (§16.2/§17.4). |

All three must independently resolve to `/afldb_prod` or the CLI/tools refuse (`resolveProdTarget`,
`resolveProdAuthTarget`, `tools/db/migrate.ts`'s `TARGETS.prod`). No DSN here is ever printed in
full in any command below — only `hostname`-style identity facts and non-secret row shapes.

### 21.0a Shell, host guard, session variables and CLI environment (review correction 2026-09-27)

**Shells.** Phase 0 runs on the Windows workstation in **Git Bash**. Every other block runs in
**bash**, in an interactive SSH login shell on `afldb-prod`, in `/home/arm/projects/afldb`. No
block is PowerShell. Multi-line commands use bash `\` continuations and must not be pasted into
PowerShell.

**Host guard (the near-miss control).** A bare `hostname` line is only something to read. Every
PROD block below instead starts with, and every line that can write is prefixed by, this guard —
defined once per shell, re-defined after any reconnect:

```bash
# PROD: afldb-prod — define once per shell session
prod_guard() { [ "$(hostname)" = afldb-prod ] || { echo "REFUSED: host is '$(hostname)', not afldb-prod" >&2; return 1; }; }
rev_guard()  { [ -n "${REV:-}" ] && [ "$(git -C /home/arm/projects/afldb rev-parse HEAD)" = "$REV" ] || { echo "REFUSED: HEAD is not \$REV" >&2; return 1; }; }
```

A guarded line copied on its own into a shell where the guard is not defined fails with
`command not found`, and its `&&` stops the command after it — fail-closed. The guards never
`exit` (an `exit` in the SSH shell would hand any remaining pasted lines to the workstation shell).

**Session variables.** `REV`, `ADOPT_STAMP`, `PRE`, `BACKUP_SHA256` and `ADMIN_USER_ID` are each
assigned exactly once, by the line shown in their phase, and recorded in the evidence file as
they are assigned. They are lost on an SSH reconnect: restore them from the recorded evidence
files, never retype them from memory. An empty value fails closed at every consumer.

**CLI environment.** `register_issue224_s9_players.ts` does **not** read `.env` (unlike
`tools/db/migrate.ts` and `tools/db/privileges.ts`, it has no `loadEnv`); both PROD DSNs must be in
the process environment. Their values are PROD's own `afldb_import` and `afldb_auth` DSNs from
PROD's `.env` (`docs/deployment.md` §9: each host's role DSNs name that host's database). Export
them without printing them, then prove only their non-secret shape:

```bash
# PROD: afldb-prod — before Phase 6; re-run after any reconnect
prod_guard && cd /home/arm/projects/afldb \
  && export AFLDB_PROD_IMPORT_DATABASE_URL="$(sed -n 's/^AFLDB_IMPORT_DATABASE_URL=//p' .env | head -1)" \
  && export AFLDB_PROD_AUTH_DATABASE_URL="$(sed -n 's/^AFLDB_AUTH_DATABASE_URL=//p' .env | head -1)"
node -e 'for (const v of ["AFLDB_PROD_IMPORT_DATABASE_URL", "AFLDB_PROD_AUTH_DATABASE_URL"]) { let u; try { u = new URL(process.env[v] || ""); } catch { console.log(v, "UNPARSEABLE"); continue; } console.log(v, u.username || "<none>", u.pathname || "<none>"); }'
  # expect exactly:
  #   AFLDB_PROD_IMPORT_DATABASE_URL afldb_import /afldb_prod
  #   AFLDB_PROD_AUTH_DATABASE_URL afldb_auth /afldb_prod
```

Anything else is a STOP. If PROD's `.env` instead carries explicit `AFLDB_PROD_*` lines, export
those names the same way — the CLI still never reads them from `.env`. The CLI independently
re-refuses any DSN that is not `/afldb_prod` and any connection whose `current_user` is not
`afldb_import` / `afldb_auth`. `AFLDB_PROD_DATABASE_URL` / `AFLDB_OWNER_DATABASE_URL` /
`AFLDB_BACKUP_DATABASE_URL` are read from `.env` by `migrate.ts`, `backup.sh` and `restore-test.sh`
themselves and are never exported by this procedure. At the end of the sitting:
`unset AFLDB_PROD_IMPORT_DATABASE_URL AFLDB_PROD_AUTH_DATABASE_URL`.

Invoke the CLI as `npx --no-install tsx …`: if `tsx` is missing from PROD's `node_modules`, that
refuses instead of fetching a package from the registry onto the production host.

### Phase 0 — prerequisites / no-write boundary

Purpose: prove there is nothing to authorise yet, and that this session's own state matches what
this procedure assumes.

```bash
# Git Bash on the Windows workstation, worktree D:/dev/afldb-issue-251, branch sonnet/issue-251 — NOT PROD
git -C D:/dev/afldb-issue-251 status --short
git -C D:/dev/afldb-issue-251 rev-parse HEAD
grep -n "^## 0. Status" -A 3 D:/dev/afldb-issue-251/issues/open/AFLDB-ISSUE-251.md
grep -n "^## 15. Next action" -A 3 D:/dev/afldb-issue-251/issues/open/AFLDB-ISSUE-237.md
```

**PASS** requires all of:
- `git status --short` shows only files the operator can attribute: the ISSUE-251 set (this
  runbook, `register_issue224_s9_players.ts`, `issue251_prod_rehearsal.ts`,
  `tests/register-issue224-s9-dev-write-gate.test.ts`, `tests/integration/privileges.test.ts`,
  migration 105, `privileges.sql`, `package.json`, `.env.example`) plus the bookkeeping this tree
  already carried at the start of the review (`IssuesIndex.md`, `issues.md`,
  `issues/open/AFLDB-ISSUE-237.md`, the `AFLDB-ISSUE-250.md` open→closed move). Decide at commit
  time which of those belong in the ISSUE-251 commit — nothing unattributable.
- ISSUE-251 §0 still reads **Open**.
- ISSUE-237 §15 still reads L5 blocked / not run.
- No CRITICAL/HIGH/MEDIUM finding is open against ISSUE-251 that this runbook has not recorded as
  closed (§19.6, §20.6 — both currently closed subject to reviewer confirmation).

**STOP** if any of the above disagrees with this section's assumption — do not proceed on stale
context.

This procedure does **not** assume the current dirty Windows worktree is what gets executed on
PROD. Phase 1 is the explicit bridge from "reviewed on a branch" to "a specific 40-hex revision
deployed to `/home/arm/projects/afldb`" — Git remains entirely operator-controlled throughout;
no command in this document performs a commit, merge, push, or checkout.

### Phase 1 — reviewed revision deployment prerequisite (operator-performed, not by this tool)

Before any later phase is contemplated, the operator must, through the repository's own normal
process (§9/§12 of `CLAUDE.md` — Claude does not execute Git or deployment commands):

1. Commit the reviewed ISSUE-251 changes on `sonnet/issue-251` (this worktree).
2. Merge them to `main` through the normal project process (PR review as usual; this branch adds
   no new merge gate of its own).
3. Record the exact resulting 40-hex revision — call it `$REV` for the rest of this procedure.
   `git rev-parse main` (or the merge commit) immediately after merge.
4. Deploy `$REV` to `/home/arm/projects/afldb` on `afldb-prod`, following the routine deployment
   sequence in `docs/deployment.md` §3, **with the target made explicit** (the bare `npm run
   db:migrate` in that section defaults to `dev`; PROD must say so):

   ```bash
   # PROD: afldb-prod — bash; define prod_guard/rev_guard first (§21.0a)
   REV=<the merged 40-hex revision from step 3>            # assign once; record it
   prod_guard && cd /home/arm/projects/afldb && git fetch origin && git log -1 --format=%H origin/main
     # must print exactly $REV; if origin/main has moved past $REV, STOP and re-decide what is deployed
   prod_guard && git checkout main && git pull --ff-only    # operator-performed; not run by this tool
   prod_guard && rev_guard && echo "HEAD = REV"            # REFUSED here = STOP
   prod_guard && rev_guard && npm ci
   prod_guard && rev_guard && npm run db:status -- --target prod
     # must list exactly one PENDING line, 105_prod_actor_lifecycle_assertion.sql, and "1 pending".
     # Any other pending migration is unreviewed scope for this sitting: STOP.
   prod_guard && rev_guard && AFLDB_MIGRATE_TARGET=prod npm run db:migrate
   prod_guard && rev_guard && npm run build && sudo systemctl restart afldb
     # the && means a failed build never restarts the service onto a broken .next
   ```

   This is the `AFLDB-ISSUE-027` order (migration/privileges before code depending on them) applied
   to this deploy: migration 105 must be live before Phase 6/8 can ever succeed, since
   `assert_viable_super_admin_actor()` does not exist until it runs. `tools/db/migrate.ts` resolves
   `--target prod`/`AFLDB_MIGRATE_TARGET=prod` only through `AFLDB_PROD_DATABASE_URL` (read from
   `.env`), and its base guard refuses a branch-local (unmerged) migration on any non-disposable
   target; `--allow-branch-local` is DEV-only and refused for `prod`. Migration 105 therefore reaches
   PROD only after it is merged, through this runner — never by feeding the `.sql` file to `psql`.
5. Confirm the production checkout is compatible with the new checkout-integrity guard (§19):
   after `git pull`, the ONLY untracked paths permitted are
   `docs/rebuild-manifests/afltables_fitzroy_core/settle-*.json`. A routine `git pull` does not by
   itself create stray untracked files, but confirm now rather than discovering it inside Phase 6/8:

   ```bash
   # PROD: afldb-prod — read-only
   prod_guard && git status --short                     # expect: nothing, or only the settle-*.json family
   prod_guard && git diff HEAD --quiet --exit-code -- && echo "no tracked drift"   # must print it
   prod_guard && git ls-files --others --exclude-standard \
     | grep -Ev '^docs/rebuild-manifests/afltables_fitzroy_core/settle-[^/]+\.json$'
   # ^ must print NOTHING. The pattern is PROD_ALLOWED_UNTRACKED_RE exactly; anything printed here is
   #   what assertProdCheckoutIntegrity refuses. Untracked settle manifests are permitted, not required.
   ```

**PASS** requires: `$REV` deployed and checked out exactly; the pre-migrate status listed only
105 pending; `npm run db:migrate` reports migration 105 applied (or already applied) with nothing
else pending; `npm run build` and `systemctl restart
afldb` succeed; the untracked-file check above prints nothing unexpected.

**STOP** on any git/build/service failure, or on any unexpected untracked/tracked-drift finding —
resolve through the normal deployment/troubleshooting path (`docs/deployment.md` §12) before
continuing. Do not proceed to Phase 2 with a checkout that has not passed this.

### Phase 2 — PROD read-only identity and service preflight

Purpose: establish the CURRENT live baseline. The 2026-09-26 census in §4 of this issue is
evidence for the defect, not a substitute for re-measuring now (§10.3, §18.13).

```bash
# PROD: afldb-prod — bash; every command below is read-only
prod_guard && cd /home/arm/projects/afldb && pwd      # must be /home/arm/projects/afldb
prod_guard && rev_guard && echo "HEAD = REV"          # REFUSED = STOP
git status --short                                    # must repeat Phase 1 step 5's result
git branch --show-current                             # expect: main
systemctl list-units --all 'afldb*' --no-pager        # record every installed afldb unit and its state

npm run db:status -- --target prod                    # migration ledger, read-only (see Phase 3)

sudo -u postgres psql -Atc "SELECT oid FROM pg_database WHERE datname = 'afldb_prod';"
sudo -u postgres psql -Atc \
  "SELECT oid FROM pg_database WHERE datname = 'afldb_prod_candidate_20260926-213225';"
  # must return exactly one row: the retained candidate still exists (OID may differ from 49077
  # if it has been touched since — record whatever is observed now; do not assume 49077 is current)

systemctl is-active afldb                              # expect: active
systemctl is-active afldb-settle-afltables.timer afldb-settle-afltables.service
  # expect: inactive, inactive (§0/§14 of this issue: they must remain inactive)
curl -s http://127.0.0.1:3100/api/health               # expect: {"status":"ok","database":"ok",...}

git ls-files --others --exclude-standard docs/rebuild-manifests/afltables_fitzroy_core/ | wc -l
  # record this count as today's settle-manifest baseline (historically ~24; no count is
  # hard-coded anywhere in the code, and none should be hard-coded in this procedure either —
  # record what is actually observed)
```

**PASS** requires: host is exactly `afldb-prod`; checkout matches `$REV` with no drift; `afldb`
active and healthy; both settle units inactive; the retained candidate database still exists
(evidence, not a target); the live `afldb_prod` OID is recorded (whatever it is — do not assume
`35594` is still current, per the user's own instruction and §4/§14 of this issue); the untracked
census is recorded.

**STOP** if host is not `afldb-prod`, if `afldb.service` is not healthy, if either settle unit is
active, if the candidate database is missing (investigate before continuing — it is required
evidence, per §12's "do not drop the retained failed candidate"), or if checkout drift is found
that Phase 1 step 5 did not already resolve.

**Near-miss guard (read before running anything with write potential in later phases):** every
line below that can write carries its own `prod_guard &&` prefix (§21.0a), evaluated in the SAME
shell immediately before that command, never assumed from an earlier phase's output.
The recorded incident (an operator shell landing on `afldb-prod` while intending `streamanator`)
is exactly the class of mistake this guards against.

### Phase 3 — migration / privilege readiness

Purpose: prove migration 105's function exists on live `afldb_prod` with exactly the intended
shape, and that `afldb_import` has exactly the grant it needs and nothing more — read-only, before
touching Phase 4.

```bash
# PROD: afldb-prod — bash; read-only
prod_guard && cd /home/arm/projects/afldb && npm run db:status -- --target prod
  # 105_prod_actor_lifecycle_assertion.sql listed as applied, and "0 pending"

prod_guard && sudo -u postgres psql -X -d afldb_prod -Atc "
  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.provolatile, array_to_string(p.proconfig, ';')
    FROM pg_proc p
   WHERE p.oid = 'public.assert_viable_super_admin_actor(integer)'::regprocedure;
"
  # expect exactly: afldb_owner|t|v|search_path=pg_catalog, pg_temp
  # (an error 'function ... does not exist' = migration 105 absent: STOP)

prod_guard && sudo -u postgres psql -X -d afldb_prod -Atc "
  SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END, a.privilege_type
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = 'public.assert_viable_super_admin_actor(integer)'::regprocedure
   ORDER BY 1;
"
  # expect exactly two rows, in this order:
  #   afldb_import|EXECUTE
  #   afldb_owner|EXECUTE        (the owner's own entry — present once PUBLIC has been revoked; §18.2)
  # ZERO rows means proacl is NULL (the default ACL, i.e. PUBLIC can execute): STOP.
  # Any PUBLIC row, any other grantee, or a missing afldb_import row: STOP.

prod_guard && sudo -u postgres psql -X -d afldb_prod -Atc "
  SELECT r, has_function_privilege(r, 'public.assert_viable_super_admin_actor(integer)', 'EXECUTE')
    FROM unnest(ARRAY['afldb_app','afldb_auth','afldb_backup','afldb_import']) AS r ORDER BY r;
"
  # expect exactly: afldb_app|f  afldb_auth|f  afldb_backup|f  afldb_import|t
prod_guard && sudo -u postgres psql -X -d afldb_prod -Atc \
  "SELECT has_table_privilege('afldb_import', 'public.auth_users', 'SELECT');"
  # expect: f  — this is the whole point of migration 105 (§17.2/§17.6)
```

**PASS** requires every observed value to match exactly what is written above (the live equivalent
of §18.2's `code_test_db` proof, now against real `afldb_prod`). On the normal path this is
expected: `AFLDB_PROD_DATABASE_URL` is the `afldb_owner` DSN, so the function is created owned by
`afldb_owner` (the `ALTER … OWNER` is a no-op), and migration 105's own `REVOKE ALL … FROM PUBLIC`
and `GRANT EXECUTE … TO afldb_import` run inside the same migration transaction.

**STOP conditions — all of them STOP-only; this procedure performs no privilege change:**
- Migration 105 not listed as applied → Phase 1 was not actually completed on this host; return to
  Phase 1. Never feed the migration file to `psql` directly — only `db:migrate` applies it.
- Function present but owner/ACL/`search_path` not exactly as above → **STOP — resolve through
  the normal deployment procedure**, recorded as a separately reviewed finding against this issue
  before any later phase. This procedure supplies **no** reconciliation command: `tools/db/privileges.ts`
  has no `prod` target; the only repository precedent for reconciling `privileges.sql` on the
  PROD host (`AFLDB-ISSUE-084` Phase 6.1: `npm run db:privileges`, whose `dev` target resolves
  `AFLDB_OWNER_DATABASE_URL`, which names `afldb_prod` on that host per
  `docs/production-promotion.md` §3) depends on that host's `.env` and was a separately reviewed
  runbook step; and the `AFLDB-ISSUE-156` in-place PROD deploy deliberately verified grants
  read-only instead of reconciling. Choosing between them is a reviewed decision, not an
  improvisation mid-sitting.

### Phase 4 — backup

Purpose: an operator-verified, fresh, ordinary hot backup — **not** an ISSUE-250/ISSUE-237
promotion freeze. This is a live-serving-database write (via `createPlayerInTransaction` /
`attachAflTablesIdentityInTransaction`), not a cutover; `afldb.service` and the settle units stay
exactly as Phase 2 found them (`Out of scope` §12: "restart or enable the settle timer").

```bash
# PROD: afldb-prod — bash
prod_guard && cd /home/arm/projects/afldb && ls -1t ~/backups/afldb/afldb_prod-*.dump
  # backup.sh --keep 14 PRUNES afldb_prod dumps beyond the newest 14. If the 2026-09-26 L5 frozen
  # dump (sha256 12b9d0e8…) or any other evidence dump is 14th-newest or older, copy it off-host
  # first — it is ISSUE-237/251 evidence (§1), not this adoption's backup.
prod_guard && ADOPT_STAMP=$(date +%Y%m%d-%H%M%S) && echo "$ADOPT_STAMP"

prod_guard && bash tools/maintenance/backup.sh --keep 14 2>&1 | tee ~/backups/afldb/issue251-backup-$ADOPT_STAMP.log
  # must end "==> Done." after "archive readable, <N> objects"
PRE=$(sed -n 's/^==> Backing up afldb_prod to //p' ~/backups/afldb/issue251-backup-$ADOPT_STAMP.log); echo "$PRE"
  # the exact file THIS run wrote, named by backup.sh itself; must be ~/backups/afldb/afldb_prod-<stamp>.dump
  # with a stamp at or after $ADOPT_STAMP. Empty = backup.sh did not dump afldb_prod
  # (AFLDB_BACKUP_DATABASE_URL names another database): STOP. Never substitute `ls -1t | head -1`.
prod_guard && [ -f "$PRE" ] && sha256sum "$PRE" | tee ~/backups/afldb/issue251-adoption-$ADOPT_STAMP.sha256
BACKUP_SHA256=$(awk '{print $1}' ~/backups/afldb/issue251-adoption-$ADOPT_STAMP.sha256); echo "$BACKUP_SHA256"

prod_guard && pg_restore --list "$PRE" | grep -c '^[0-9]'    # objects, must be non-zero
prod_guard && bash tools/maintenance/restore-test.sh "$PRE"   # must end "==> Restore verified: the backup is proven."
prod_guard && sudo -u postgres psql -X -d postgres -Atc \
  "SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = 'afldb_restore_test';"
  # must equal exactly: afldb.restore_test.v1 sha256=<$BACKUP_SHA256>
  # restore-test.sh writes this binding only after every parity check passes (AFLDB-ISSUE-250).
```

**PASS** requires: `backup.sh` completes against `afldb_prod`; `$PRE` is the exact file that run
named; `pg_restore --list` reports a non-zero object count; `restore-test.sh` ends "Restore
verified"; the `afldb_restore_test` comment binds exactly `$BACKUP_SHA256` (this is the
repository-standard restore proof — the same binding `db:promotion:check --phase freeze-dump` reads;
ISSUE-251 has no freeze record, so there is no F0 digest comparison here, and none is claimed);
`$PRE` and its `.sha256` are copied off-host and the copy's `sha256sum` matches.

**Explicit acknowledgement, not proof (per the user's brief):** `--backup-sha256` in Phase 6/8 is
the operator's **acknowledgement** that this exact backup was taken and independently verified —
`register_issue224_s9_players.ts` validates only the value's shape (64 hex characters) and never
re-derives or checks it against any real file (confirmed in source: `parseArgs` only tests
`BACKUP_SHA256_RE = /^[0-9a-fA-F]{64}$/`, and prints only its first 12 characters). The adoption CLI cannot itself
prove the dump exists, is complete, or is restorable — Phase 4's `restore-test.sh` run is what
proves that, and the operator is vouching for it by supplying `$BACKUP_SHA256`.

**Do not reuse** the ISSUE-237 L5 freeze-era backup or its SHA-256, even though one exists from
the 2026-09-26 attempt — that dump predates this adoption and is not this adoption's pre-write
state. Copy `"$PRE"` and its `.sha256` off the host before continuing (`docs/backup-restore.md`
§4), same as the promotion runbook requires.

### Phase 5 — actor selection

Purpose: the operator deliberately picks exactly one real, viable, non-fixture PROD `super_admin`.
No automatic selection from an ambiguous set.

```bash
# PROD: afldb-prod — bash; read-only, no credential field is ever printed
prod_guard && sudo -u postgres psql -X -d afldb_prod -Atc "
  SELECT id, email, role,
         (disabled_at IS NULL) AS enabled,
         (password_hash IS NOT NULL) AS has_password,
         (totp_secret IS NOT NULL) AS has_totp
    FROM auth_users
   WHERE role = 'super_admin'
   ORDER BY id;
"
```

For each candidate row, the operator confirms by eye:
- `enabled = t`, `has_password = t`, `has_totp = t`, `role = super_admin` (exactly
  `isViableSuperAdmin`'s four conditions, `src/lib/auth/admin-lifecycle.ts`);
- the email's domain does **not** match migration 105's reserved-fixture rule: no `.test`,
  `.example`, `.invalid`, `.localhost` suffix, and not exactly `example.com`/`example.net`/
  `example.org` (the same `RESERVED_TEST_TLDS`/`RESERVED_EXAMPLE_DOMAINS` rule
  `tools/db/promotion-inventory.ts` applies elsewhere, inlined into migration 105's SQL — §17.2).

Optionally, dry-test the exact chosen id against the live function itself before committing to it
in Phase 6/8 (a single, unwrapped statement — it takes and releases its `FOR SHARE` lock within
that one statement's implicit transaction, so this is safe to run standalone as a preflight and
imposes no lasting lock):

```bash
prod_guard && sudo -u postgres psql -X -d afldb_prod -Atc "SELECT public.assert_viable_super_admin_actor(<CANDIDATE_ID>);"
  # success prints one empty line (a void result) and no ERROR; any RAISE EXCEPTION names the exact reason
```

**Capture exactly one value for later phases**, typed by the operator from the row they chose —
never piped or derived from the query output:

```bash
ADMIN_USER_ID=<the deliberately chosen id>; echo "$ADMIN_USER_ID"
```

**PASS** requires exactly one operator-selected id, confirmed viable by both the eyeballed catalog
row and (recommended) the direct function dry-test.

**STOP** if the candidate set is empty, if the operator cannot confirm all four conditions plus the
domain rule for the chosen id, or if the dry-test raises. **Never** select the historical disabled
`afldb_test` recovery/rebuild attribution actor (§4.2 of this issue: disabled, no password, no
TOTP) — it fails every one of the checks above by construction and would be refused by
`assert_viable_super_admin_actor()` regardless.

### Phase 6 — adoption dry-run / classification

Purpose: prove the exact `92 CREATE / 0 ALREADY_SATISFIED / 0 CONFLICT` shape against live
`afldb_prod`, with zero write potential. Derived directly from the file's own usage comment and
`runProdMain`'s read-only branch (`args.apply` false ⇒ `resolveProdTarget(false)` opens a
connection with `default_transaction_read_only: true` and never reaches
`runProdAdoptionWrite`) — no flag here is guessed.

```bash
# PROD: afldb-prod — bash; requires the §21.0a CLI environment exports; NO --apply anywhere here
prod_guard && cd /home/arm/projects/afldb && npx --no-install tsx --conditions=react-server \
  tools/rebuild/draftguru/register_issue224_s9_players.ts \
  --target prod --prod-import-role --admin-user-id "$ADMIN_USER_ID" \
  2>&1 | tee ~/backups/afldb/issue251-classify-pre-$ADOPT_STAMP.log
```

No package.json script wraps this invocation directly (only the `code_test_db` rehearsal harness,
`db:code-test:issue251-rehearsal`, has one — flagged in §21.13 item 2); the command above is built
from the file's own documented usage block and the `--conditions=react-server` requirement every
other canonical-primitive tool in this `package.json` already carries (`match:backtest`,
`records:first-kick-goal`).

This dry run requires **no** `--allow-prod-write`, `--backup-sha256`, `--expected-host` or
`--expected-revision` — `parseArgs`/`runProdMain` gate those strictly behind `--apply`
(`prodWriteAuthorized = args.apply`); without `--apply` the connection is opened read-only
(`default_transaction_read_only: true`) and the tool never calls `runProdAdoptionWrite`. Expect
console output ending in:

```
Connected: current_database()='afldb_prod', current_user='afldb_import' (--target prod --prod-import-role), mode=READ-ONLY PREFLIGHT.

Classification against 'afldb_prod' (no write attempted):
  CREATE            = 92
  ALREADY_SATISFIED = 0
  CONFLICT          = 0
  TOTAL             = 92
```

**PASS** requires exactly that shape, with zero `CONFLICT` and zero `ALREADY_SATISFIED`. The tool
sets `process.exitCode = 1` itself if any `CONFLICT` is present; because the output is piped to
`tee`, read the tool's own status with `echo "exit=${PIPESTATUS[0]}"` as the very next command and
treat anything but `exit=0` as an automatic STOP even before reading the printed detail. `exit=0`
is necessary but not sufficient: a `91/1/0` shape also exits 0, so the printed counts are the gate.

**STOP** on any deviation: `CREATE ≠ 92`, `ALREADY_SATISFIED ≠ 0`, or `CONFLICT ≠ 0`. Read the
printed `CONFLICT detail:` block if present — it names the exact AFL Tables path and reason
(`Classification` in the source). Do not proceed to Phase 7/8 on any shape other than exactly
`92/0/0`; this is the same `assertExactFirstApplyShape` gate the write itself enforces, run here
first with zero write risk.

**Independent cohort census (review correction 2026-09-27).** The CLI's classification only looks
at `afltables` identities; it says nothing about tokens, creation records or actor attribution, and
it is the tool under test. The census below is independent of it: it reads the 92 pinned paths
straight from the tracked target-set file (whose bytes the clean checkout at `$REV` guarantees) and
queries the catalog as `postgres` inside a `READ ONLY` transaction that is rolled back. It is run
three times: here (baseline), in Phase 9 (after COMMIT), and after any failed or indeterminate
Phase 8 attempt.

```bash
# PROD: afldb-prod — bash; writes only files under ~/backups/afldb (script, generated SQL, output), never the database
prod_guard && cd /home/arm/projects/afldb && cat > ~/backups/afldb/issue251-census.js <<'JS'
const fs = require('fs');
const set = JSON.parse(fs.readFileSync('docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json', 'utf8'));
const paths = set.rows.map((r) => String(r.afltables_external_id));
if (paths.length !== 92 || new Set(paths).size !== 92) { console.error('REFUSED: target set is not 92 distinct paths'); process.exit(1); }
const actor = process.argv[2] ?? '';
if (!/^[1-9][0-9]*$/.test(actor)) { console.error('REFUSED: ADMIN_USER_ID is not a positive integer'); process.exit(1); }
const values = paths.map((p) => `('${p.replace(/'/g, "''")}')`).join(',\n  ');
process.stdout.write(`\\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
WITH cohort(path) AS (VALUES
  ${values}),
at_all AS (SELECT e.external_id AS path, e.player_id, e.status::text AS status, e.match_method
             FROM external_identities e JOIN sources s ON s.id = e.source_id
            WHERE s.key = 'afltables' AND e.external_id IN (SELECT path FROM cohort)),
acc AS (SELECT path, player_id FROM at_all
         WHERE match_method = 'afltables_profile_url' AND status IN ('unique', 'resolved') AND player_id IS NOT NULL),
mt AS (SELECT e.external_id AS token, e.player_id
         FROM external_identities e JOIN sources s ON s.id = e.source_id
        WHERE s.key = 'manual_admin_edit' AND e.player_id IN (SELECT player_id FROM acc)),
co AS (SELECT o.entity_key, o.admin_user_id, o.override_values->>'afltables_profile_path' AS path, mt.player_id
         FROM data_overrides o JOIN mt ON o.entity_key = 'manual_admin_edit:' || mt.token
        WHERE o.entity_type = 'players' AND o.field_group = 'identity' AND o.is_active)
SELECT n, k, v FROM (VALUES
  (1,  'cohort_paths',                               (SELECT count(*) FROM cohort)),
  (2,  'cohort_paths_distinct',                      (SELECT count(DISTINCT path) FROM cohort)),
  (3,  'afltables_rows_for_cohort_any_status',       (SELECT count(*) FROM at_all)),
  (4,  'afltables_rows_not_cleanly_accepted',        (SELECT count(*) FROM at_all a WHERE NOT (a.match_method = 'afltables_profile_url' AND a.status IN ('unique', 'resolved') AND a.player_id IS NOT NULL))),
  (5,  'accepted_paths_distinct',                    (SELECT count(DISTINCT path) FROM acc)),
  (6,  'cohort_players_distinct',                    (SELECT count(DISTINCT player_id) FROM acc)),
  (7,  'cohort_players_with_non_cohort_afltables',   (SELECT count(DISTINCT e.player_id) FROM external_identities e JOIN sources s ON s.id = e.source_id
                                                       WHERE s.key = 'afltables' AND e.player_id IN (SELECT player_id FROM acc) AND e.external_id NOT IN (SELECT path FROM cohort))),
  (8,  'manual_tokens',                              (SELECT count(*) FROM mt)),
  (9,  'manual_tokens_distinct',                     (SELECT count(DISTINCT token) FROM mt)),
  (10, 'players_with_a_manual_token',                (SELECT count(DISTINCT player_id) FROM mt)),
  (11, 'active_creation_records',                    (SELECT count(*) FROM co)),
  (12, 'players_with_exactly_one_creation_record',   (SELECT count(*) FROM (SELECT player_id FROM co GROUP BY player_id HAVING count(*) = 1) x)),
  (13, 'creation_record_path_equals_player_path',    (SELECT count(*) FROM co JOIN acc ON acc.player_id = co.player_id AND acc.path = co.path)),
  (14, 'creation_records_by_selected_actor',         (SELECT count(*) FROM co WHERE admin_user_id = ${actor})),
  (15, 'creation_records_by_any_other_actor',        (SELECT count(*) FROM co WHERE admin_user_id <> ${actor})),
  (16, 'afl_api_identities_on_cohort_players',       (SELECT count(*) FROM external_identities e JOIN sources s ON s.id = e.source_id
                                                       WHERE s.key = 'afl_api' AND e.player_id IN (SELECT player_id FROM acc))),
  (17, 'players_total',                              (SELECT count(*) FROM players))
) AS t(n, k, v) ORDER BY n;
ROLLBACK;
`);
JS
census() {  # usage: census <label>   — prints 17 "n|name|value" rows and keeps a copy
  prod_guard && cd /home/arm/projects/afldb \
    && node ~/backups/afldb/issue251-census.js "$ADMIN_USER_ID" > ~/backups/afldb/issue251-census.sql \
    && sudo -u postgres psql -X -q -At -d afldb_prod -f - < ~/backups/afldb/issue251-census.sql \
       | tee ~/backups/afldb/issue251-census-$1-$ADOPT_STAMP.txt
}
census pre
```

Baseline (`census pre`) **PASS** requires exactly: rows 1–2 = `92`; rows 3–16 = `0`; row 17 =
the current player count, recorded as `P0`. Anything else is a STOP — in particular a non-zero
row 3 means an AFL Tables identity for a cohort path already exists in some form the CLI's
classification may not have looked at. (Row 17 is the only row that is not cohort-scoped; it
exists to detect player rows a failed attempt might leave without any AFL Tables path.)

### Phase 7 — explicit human authorisation boundary

```
================================================================
LIVE PROD WRITE NOT YET AUTHORISED
================================================================
```

Before anything in Phase 8 is even prepared, the operator manually reviews, in one sitting, every
one of the following, each carrying its own PASS from the phase that produced it:

- [ ] Phase 2: host = `afldb-prod`, checkout = `$REV`, no drift, `afldb` healthy, both settle units
      inactive, candidate database confirmed present (evidence only), current `afldb_prod` OID
      recorded.
- [ ] Phase 3: migration 105 applied; function owner/`SECURITY DEFINER`/`search_path` exact;
      ACL exactly `afldb_import|EXECUTE` + the owner's `afldb_owner|EXECUTE`, no `PUBLIC`;
      `afldb_import` has no `auth_users` SELECT.
- [ ] Phase 4: fresh backup `$PRE` taken today, non-zero object count, `restore-test.sh` clean,
      `$BACKUP_SHA256` recorded and copied off-host.
- [ ] Phase 5: exactly one `$ADMIN_USER_ID`, confirmed viable and non-fixture by both the catalog
      row and the direct function dry-test.
- [ ] Phase 6: dry-run classification exactly `CREATE=92 / ALREADY_SATISFIED=0 / CONFLICT=0`,
      `exit=0`, and `census pre` exactly 92/92/0…0 with `P0` recorded.
- [ ] Zero conflicts, zero already-satisfied, zero unresolved CRITICAL/HIGH/MEDIUM review finding
      against ISSUE-251 (§19.6/§20.6/§21.14).
- [ ] The operator knowingly accepts that `replay_admin_overrides(players)` itself has not been run
      (§21.13 item 5); the fresh L5's A4.2 gate is where replay is next exercised.

This procedure does **not** combine the dry run and the apply into one pasted block, and defines
no auto-confirm mechanism. Phase 8's command is provided as a **template** with placeholders; it is
not to be executed as part of this drafting pass, and not to be executed by anyone until every box
above is independently checked against freshly-produced evidence from **this same operator
sitting** — not carried over from an earlier day.

**`LIVE PROD WRITE NOT YET AUTHORISED.`** Authorisation to proceed to Phase 8 is a separate,
explicit, later operator decision. This document does not grant it.

### Phase 8 — live apply command template (DO NOT RUN YET)

```bash
# PROD: afldb-prod — bash — DO NOT RUN until Phase 7's boundary has been separately, explicitly cleared
echo "REV=$REV ADMIN_USER_ID=$ADMIN_USER_ID BACKUP_SHA256=$BACKUP_SHA256"   # compare with the Phase 7 record; any mismatch: STOP
prod_guard && rev_guard && cd /home/arm/projects/afldb && npx --no-install tsx --conditions=react-server \
  tools/rebuild/draftguru/register_issue224_s9_players.ts \
  --target prod --prod-import-role --apply \
  --allow-prod-write \
  --admin-user-id "$ADMIN_USER_ID" \
  --backup-sha256 "$BACKUP_SHA256" \
  --expected-host afldb-prod \
  --expected-revision "$REV" \
  2>&1 | tee ~/backups/afldb/issue251-apply-$ADOPT_STAMP.log
```

The apply is one pasted command (bash `\` continuations; it would break in PowerShell). It is not
preceded or followed in this block by any other command that runs it. The transcript is kept in
`issue251-apply-$ADOPT_STAMP.log` so an SSH drop mid-run does not lose the evidence; if the session
drops before `Transaction committed = yes` is seen, the outcome is **indeterminate** — follow the
failure policy below, never re-run.

Every flag here is required by `parseArgs`'s PROD-apply gate exactly as written (§16.2/verified
above): `--prod-import-role` unconditionally for any `--target prod`; `--allow-prod-write`,
`--backup-sha256 <64-hex>`, `--expected-host <hostname>` and `--expected-revision <40-hex>` all
together for `--apply`. `--name-parts` is never passed for `--target prod` — the tool refuses it
outright (`parseArgs`) and always loads the pinned tracked artefact instead.

Placeholders that MUST be captured fresh, this same sitting, before this command is ever run for
real:
- `$ADMIN_USER_ID` — Phase 5.
- `$BACKUP_SHA256` — Phase 4, from a backup taken **today**, not an earlier day's.
- `$REV` — Phase 1, the exact deployed 40-hex revision, re-confirmed by Phase 2's
  `git rev-parse HEAD` immediately before this command runs.
- `--expected-host afldb-prod` is a literal, not a variable — it is compared against the pinned
  `PROD_HOSTNAME` constant, not against whatever the running host happens to report (§17.5); typing
  anything else here always refuses, by design.

**DO NOT RUN YET.**

### Phase 9 — immediate post-apply independent verification

Run only after Phase 8 completes and prints `Transaction committed = yes`. Independent of the
tool's own printed report — re-derive from the live catalog, the same way §18.6 independently
re-checked the rehearsal rather than trusting the harness's own `verify()` alone.

```bash
# PROD: afldb-prod — bash; read-only (same shell as Phase 6: census(), exports and variables defined)
census post
  # expect exactly, by row number:
  #   1  cohort_paths                              92
  #   2  cohort_paths_distinct                     92
  #   3  afltables_rows_for_cohort_any_status      92   (exactly one row per path — no ambiguity)
  #   4  afltables_rows_not_cleanly_accepted        0
  #   5  accepted_paths_distinct                   92
  #   6  cohort_players_distinct                   92   (one player per path, one path per player)
  #   7  cohort_players_with_non_cohort_afltables   0
  #   8  manual_tokens                             92
  #   9  manual_tokens_distinct                    92
  #  10  players_with_a_manual_token               92   (with 8: exactly one token per player)
  #  11  active_creation_records                   92
  #  12  players_with_exactly_one_creation_record  92
  #  13  creation_record_path_equals_player_path   92   (each record's afltables_profile_path = its player's pinned path)
  #  14  creation_records_by_selected_actor        92
  #  15  creation_records_by_any_other_actor        0
  #  16  afl_api_identities_on_cohort_players       0   (D-251-3: none introduced by the adoption)
  #  17  players_total                             P0 + 92, unless a separately recorded player write
  #                                                     happened in between (any unexplained delta: STOP)

# Deterministic already-satisfied state — the SAME no-write Phase 6 invocation, still no --apply:
prod_guard && cd /home/arm/projects/afldb && npx --no-install tsx --conditions=react-server \
  tools/rebuild/draftguru/register_issue224_s9_players.ts \
  --target prod --prod-import-role --admin-user-id "$ADMIN_USER_ID" \
  2>&1 | tee ~/backups/afldb/issue251-classify-post-$ADOPT_STAMP.log
echo "exit=${PIPESTATUS[0]}"
  # expect CREATE = 0, ALREADY_SATISFIED = 92, CONFLICT = 0, TOTAL = 92, exit=0
```

The census rows are cohort-scoped: rows 3–16 consider only the 92 pinned paths and the players
they resolve to, never PROD-wide totals, so an unrelated pre-existing `manual_admin_edit` token or
`afl_api` identity elsewhere on PROD neither fails nor masks this check. Row 16 is zero by design
even though a later promotion will bring AFL API identities for these players (D-251-3).

**Second-run refusal is proven without a second apply.** `CREATE=0 / ALREADY_SATISFIED=92 /
CONFLICT=0` from the no-write classifier, together with `assertExactFirstApplyShape`'s exact
`92/0/0` requirement (source; §18.7 on the rehearsal), is the proof that a first-adoption apply
would now refuse. **Do not run Phase 8's command again** — not "to be sure", not to observe the
refusal. A second `--apply` is an unauthorised PROD write attempt under this procedure.

**Known, explicitly flagged limitation (carried from §18.6/§20.6, not resolved by this pass):** the
production `replay_admin_overrides(players)` oracle (Python, `tools/migration/common.py`) is not
separately invoked by this Phase. Only the postcondition it depends on — every durable
`data_overrides` payload carries the resolved `given_name`/`surname` split — is proven by the
tool's own in-transaction `runDevPostWriteChecks` battery only; the independent census proves the
token/record/path/actor structure, not the name split. This is evidence the oracle would accept
the state, not a run of the oracle itself.

**Do not** interpret "0 AFL API identities among the 92 adopted players" as "0 AFL API
identities anywhere on PROD" — census row 16 is scoped to exactly the 92 adopted players,
matching D-251-3/§8 item 10's cohort-specific wording, not a global assertion.

**PASS** requires every census row and the classifier shape to match exactly. **STOP, do not rerun, do not manually adjust
anything** on any deviation — see the rollback/failure policy below.

### Phase 10 — application/service health

```bash
# PROD: afldb-prod — bash; read-only
prod_guard && systemctl is-active afldb                # expect: active (no restart performed or needed)
ss -ltnp 'sport = :3100' 2>/dev/null || sudo ss -ltnp 'sport = :3100'
curl -s http://127.0.0.1:3100/api/health               # expect: {"status":"ok","database":"ok",...}
systemctl is-active afldb-settle-afltables.timer afldb-settle-afltables.service
  # expect: inactive, inactive — UNCHANGED from Phase 2. Do not start them (§12: out of scope).
```

**PASS** requires: `afldb` still active (the adoption write goes through the application's own
canonical primitives via a direct database connection — Phase 8 does not restart the service, and
none is required by the contract); the listener and `/api/health` unchanged from Phase 2's
baseline; both settle units still inactive; `systemctl list-units --all 'afldb*' --no-pager`
identical to Phase 2's record. Nothing in this procedure starts, stops, enables or restarts a
settle unit, and a successful adoption is not a reason to enable settle automation. Finish the
sitting with `unset AFLDB_PROD_IMPORT_DATABASE_URL AFLDB_PROD_AUTH_DATABASE_URL`.

**STOP** if `afldb` is not active or `/api/health` reports anything other than
`status=ok,database=ok` — this is now an application-health incident, handled through the normal
incident path, not by re-running the adoption tool.

### Phase 11 — ISSUE-251 evidence and closure decision

After Phase 9 and Phase 10 both PASS, record in `issues/open/AFLDB-ISSUE-251.md` (a new, dated
section, appended — not by editing §0–§20 in place):

- `$REV`, `$ADOPT_STAMP`, `$PRE`'s filename and `$BACKUP_SHA256`.
- `$ADMIN_USER_ID` and the non-secret catalog fields confirmed for it (role, enabled, has_password,
  has_totp, non-fixture domain) — never a credential value.
- The Phase 6 pre-apply classification (`92/0/0`) and the Phase 8 console output (creation list,
  integrity results, `Transaction committed = yes`).
- Every Phase 9 query and its observed value.
- Phase 10's health confirmation.
- The known `replay_admin_overrides` limitation, repeated (do not let it silently drop out of the
  written record just because Phase 9 passed).

**Do not mark ISSUE-251 resolved merely because the CLI printed success.** Per §13 of this issue,
resolution additionally requires:
1. all of §13 items 1–11 (the design/contract properties, already satisfied by the implementation
   and rehearsal, §16–§20) to still hold against the real PROD write just performed;
2. this Phase's evidence recorded in full, not summarised away;
3. §13 item 12 — **a subsequent fresh ISSUE-237 L5 `--phase restored` run** (Phase 12 below)
   completing and no longer failing the two 92-registration gates — before ISSUE-251 itself is
   marked resolved. Per §13's own item 13, ISSUE-251's success must never be read as overriding a
   *different* L5 failure; a fresh L5 attempt could still fail on an unrelated gate, and ISSUE-251
   remains resolved on its own terms in that case, but the sentence "ISSUE-251 is resolved" should
   not be written until an operator has actually seen §13 item 12 hold.

Only once both this Phase's evidence and a passing fresh L5 restored-gate exist should
`IssuesIndex.md`/`issues.md` be updated to close ISSUE-251, per `CLAUDE.md` §5's resolution
checklist — not performed by this drafting pass.

### Phase 12 — fresh ISSUE-237 L5 retry

Explicitly, per the user's brief and §11/§18.13/§20.6 of this issue:

- The retained candidate `afldb_prod_candidate_20260926-213225` is **not** promoted, reused, or
  resumed from its failed `--phase restored` gate. It remains evidence only.
- A **completely fresh** promotion attempt is required: new `$STAMP`, new freeze (`AFLDB-ISSUE-250`
  §4.0), new F0 record, new authoritative frozen dump and proof, a fresh rebuild/transfer of the
  source dump per `docs/production-promotion.md`, and only then `--phase restored` against a
  **newly created** candidate database. Nothing from stamp `20260926-213225` is an input to it:
  not its freeze directory, freeze manifest/record or F0 digest (`4255d4c2…`), not its frozen dump
  (`12b9d0e8…`) or dump proof, not the rebuilt source dump (`1714f8a8…`), not its snapshot, and not
  any plan/lineage/supersede/reinstatement file (none was published for that stamp; none may be
  hand-made for it). Those remain evidence only.
- The fresh `--phase restored` must itself show, for all 92 paths, that ISSUE-242 now finds target
  authority (a PROD `manual_admin_edit` registration for path P) — the two gates that failed on
  2026-09-26 must pass on fresh evidence, not be inferred from this adoption's Phase 9.
- Expected ISSUE-242 result this time, for each of the 92 paths: candidate token **B** + path
  **P**; target PROD now holds token **A** + path **P** (Phase 8's write); convergence classifies
  as **rebind B → A**, not a candidate-only orphan STOP.
- Only a fully passing restored gate, run fresh after Phase 8, may publish
  `promotion-lineage-<stamp>.sql` / `promotion-afl-api-supersede-<stamp>.json`.
- ISSUE-237 stays blocked until this fresh L5 independently passes — ISSUE-251's own Phase 9/10
  PASS does not by itself unblock it (this drafting pass does not unblock it either).

This Phase is **not** executed by this pass; it is specified here so Phase 11's evidence record has
a clear, correctly-ordered next step rather than an implicit assumption that adoption alone
finishes the job.

### Rollback / failure policy

**Before COMMIT (inside Phase 8's transaction).** `runProdAdoptionWrite` is one transaction; any
assertion failure — the in-transaction actor check, `assertExactFirstApplyShape`, a
`createPlayerInTransaction`/`attachAflTablesIdentityInTransaction` failure, or
`assertNoAflApiIdentityWritten` — rejects the promise, and `sql.begin()` rolls the whole thing back
before any of the 92 rows is left committed (proven on the rehearsal, §18.8/§18.9: three real
fault-injection cases, each independently confirmed to leave **zero** residue). The operator proves
this independently after any failed Phase 8 attempt, with no write: `census failed` must equal
`census pre` row for row (rows 3–16 = `0`, row 17 = `P0` unless a separately recorded player write
explains the difference), and the Phase 6 classifier must again print exactly `92/0/0`. That is
zero partial adoption. A refused attempt is then a STOP: the cause is recorded and reviewed before
any new Phase 7 authorisation — never an immediate retry.

**Indeterminate outcome.** If Phase 8 ends without `Transaction committed = yes` being seen (SSH
drop, killed terminal, an error printed after the write loop), do not assume either way. Run
`census indeterminate` (after re-establishing the §21.0a guards/variables from the evidence files):
- equal to `census pre` → nothing committed; treat as "before COMMIT" above;
- equal to the Phase 9 expected shape → it committed; continue at Phase 9 as normal;
- anything else → treat as "after COMMIT" with unexpected state, below.
If an `afldb-issue251-prod-register` backend (`pg_stat_activity.application_name`) is still
present, wait for PostgreSQL to finish or roll it back before running the census; if it persists,
STOP and escalate — terminating it is not a step of this procedure (§18.10).

**After COMMIT.** If Phase 8 prints `Transaction committed = yes` (or the indeterminate census
shows a commit) but Phase 9's independent verification finds ANY unexpected state (a count that
does not match, an unattributed row, an `afl_api` identity where none should exist):

- **STOP.** Do not rerun the adoption tool against this state.
- **Do not manually delete, update, or "correct" any registration, token, or `data_overrides` row.**
  The rehearsal's own `teardown()` function is a rehearsal-only convenience (`code_test_db` only,
  never exported for use against a real target, and it exists precisely because rehearsal fixtures
  need cleanup) — it is not a sanctioned PROD recovery tool and must never be pointed at
  `afldb_prod`.
- **Preserve evidence.** Capture every Phase 9 query's actual output, the full Phase 8 console
  transcript, and the exact backup/SHA-256 pair from Phase 4 — do not overwrite or summarise it
  away before a reviewer sees it.
- **Leave ISSUE-237 blocked.** Phase 12 does not run against an ISSUE-251 outcome that Phase 9
  flagged as unexpected.
- **Escalate through a new, reviewed corrective issue.** The Phase 4 backup is disaster-recovery
  evidence for that escalation, not permission to improvise a destructive restore over a live
  database that may otherwise be healthy except for the specific discrepancy Phase 9 found.

### Evidence checklist (attach to the Phase 11 record)

- [ ] Phase 0: worktree/branch/status snapshot; ISSUE-251 §0 = Open; ISSUE-237 L5 = blocked.
- [ ] Phase 1: `$REV`; deploy command transcript; untracked-file check output.
- [ ] Phase 2: `hostname`; `git rev-parse HEAD`; `afldb_prod` OID; candidate OID/presence;
      `afldb.service`/settle-unit states; `/api/health` output; settle-manifest count.
- [ ] Phase 3: migration-105 ledger line; the catalog queries' raw output (owner,
      `SECURITY DEFINER`, volatility, `search_path`, the two ACL rows, per-role EXECUTE,
      `has_table_privilege` = f). No reconciliation is performed by this procedure.
- [ ] Phase 4: `issue251-backup-$ADOPT_STAMP.log`; `$PRE` (as named by `backup.sh`);
      `$BACKUP_SHA256`; `pg_restore --list` count; `restore-test.sh` transcript; the
      `afldb_restore_test` sha binding; off-host copy and its matching `sha256sum`.
- [ ] Phase 5: the `super_admin` catalog listing; the chosen `$ADMIN_USER_ID`; the optional direct
      function dry-test output.
- [ ] Phase 6: the `AFLDB_PROD_*` shape check; `issue251-classify-pre-$ADOPT_STAMP.log` ending in
      the exact `92/0/0` block with `exit=0`; `issue251-census-pre-$ADOPT_STAMP.txt`.
- [ ] Phase 7: the checked boxes, dated, with the operator's name.
- [ ] Phase 8: `issue251-apply-$ADOPT_STAMP.log` (only once actually authorised and run — not part
      of this drafting pass).
- [ ] Phase 9: `issue251-census-post-$ADOPT_STAMP.txt`; `issue251-classify-post-$ADOPT_STAMP.log`
      (`0/92/0`, `exit=0`). No second apply is run.
- [ ] Phase 10: health check transcript.
- [ ] Phase 11: the appended runbook section itself.
- [ ] Phase 12: the fresh L5 `$STAMP` and its `--phase restored` result, once run.

### 21.13 Remaining ambiguity found while drafting this procedure

1. **`tools/db/privileges.ts` has no `prod` target** (`TARGETS = { dev, test, code-test }` only,
   confirmed directly in source). Every other target-aware tool in this repository
   (`tools/db/migrate.ts`) has an explicit `prod` entry; this one does not. Phase 3's contingency
   command is inferred by analogy with the promotion runbook's own stdin-feed convention, not a
   command this repository documents verbatim for this exact purpose. **Recommendation:** add a
   `prod: 'AFLDB_PROD_DATABASE_URL'` entry to `tools/db/privileges.ts`'s `TARGETS` map (mirroring
   `tools/db/migrate.ts` exactly) as a small, separately reviewed follow-up, before this contingency
   is ever exercised for real. This does not block Phase 3's read-only ACL check, which is expected
   to PASS without the reconciliation step in the normal case (migration 105's own inline `DO` block
   already performs the grant when the deploying role is a member of `afldb_owner`).
2. **No package.json script wraps `register_issue224_s9_players.ts` directly** for any target
   (`test`/`dev`/`prod`) — only the `code_test_db` rehearsal harness has one
   (`db:code-test:issue251-rehearsal`). Phases 6/8's commands are built from the file's own
   documented usage comment and confirmed flag-by-flag against `parseArgs`, so they are exact, but
   they are manually constructed rather than a single memorable script name. Not a blocker; noted
   so a future pass could add `db:issue251:prod-register` analogous to the existing rehearsal
   script, if the operator wants one.
3. **No existing read-only mode prints a per-row path/registration comparison against a live
   target** for the exact 92 pinned paths (the classify() branch reports only aggregate
   CREATE/ALREADY_SATISFIED/CONFLICT counts, not a path-by-path table). Phase 9's per-path
   cross-check against the pinned target-set JSON is therefore specified as a manual/ad hoc
   comparison, not a single proven command. A future pass could add a `--verbose`/`--report`
   read-only mode that prints all 92 rows; not implemented by this pass.
4. **The exact historical settle-manifest count is not asserted anywhere in code** (by design —
   `PROD_ALLOWED_UNTRACKED_RE` matches the whole family, not a count), so Phase 2's census step
   records whatever is observed rather than checking it against "24" or any other fixed number, per
   the user's own instruction not to hard-code that count into this procedure.
5. **`replay_admin_overrides(players)` (Python oracle) has never been run** against either the
   rehearsal or (necessarily) real PROD by any pass to date (§18.6/§20.6, repeated in Phase 9 above)
   — carried forward as a known, explicitly flagged gap, not resolved by this drafting pass.
6. **Off-host backup copy destination/command is environment-specific and not currently established
   by repository tooling.** Phase 4 (backup) produces a PROD-host backup, but no tracked script or
   documented command copies that artefact off the PROD host to a separate location. This does not
   block Git/deployment preparation, and no destination or command is being invented here — it
   **MUST BE RESOLVED BEFORE ITS PHASE** (Phase 4 closure) before any future live Phase 4 can pass.

None of the above blocks drafting this procedure; items 1 and 3 are the two most likely to matter
operationally, and both have a stated, reviewable fix path rather than an invented command.

**Procedure-review classification (2026-09-27, §21.14):**

| Item | As drafted | After the §21.14 corrections |
|---|---|---|
| 1 — `privileges.ts` has no `prod` target | **BLOCKS LIVE APPLY**: the Phase 3 ACL expectation was wrong, so the normal path would have false-STOPped into an unproven privileged command | **SAFE** — not needed on the normal path; contingency is STOP-only; adding a `prod` target is an optional separately reviewed follow-up, not a precondition |
| 2 — no package script | DOCUMENTATION-ONLY | DOCUMENTATION-ONLY (the unrelated missing-environment defect is fixed in §21.0a) |
| 3 — no per-path verify mode | **BLOCKS LIVE APPLY**: post-COMMIT verification must exist before the write is authorised | **Resolved** by the Phase 6/9 cohort census; a CLI report mode stays optional |
| 4 — settle-manifest count not asserted | SAFE/EXPECTED | SAFE/EXPECTED |
| 5 — `replay_admin_overrides` never run | MUST BE RESOLVED BEFORE ITS PHASE (Phase 11 closure; §8 item 11) | unchanged; explicit Phase 7 acknowledgement added; the fresh L5 A4.2 replay prediction is where it is next exercised |

### 21.14 Procedure review (2026-09-27) — corrections applied, re-review required

§21 was reviewed as an operator procedure against `register_issue224_s9_players.ts`,
`tools/db/migrate.ts`, `tools/db/privileges.ts`, `backup.sh`, `restore-test.sh`, migration 105,
`docs/deployment.md`, `docs/production-promotion.md` and `AFLDB-ISSUE-084`. Verdict on the draft:
**NOT PASS**. Defects found and corrected in place (no code, migration or other file changed):

1. **HIGH — CLI environment never established.** The CLI does not load `.env`; no step exported
   `AFLDB_PROD_IMPORT_DATABASE_URL` / `AFLDB_PROD_AUTH_DATABASE_URL`, so Phases 6/8/9 would refuse
   or force credential improvisation on PROD. Fixed: §21.0a export + non-secret shape check.
2. **HIGH — Phase 3 expected ACL was wrong.** Once PUBLIC is revoked the owner's own
   `afldb_owner=X` entry is explicit (§18.2 observed two grantees), so "exactly one row" would
   false-STOP and route to (3). `proconfig` array quoting also differed from the literal shown.
   Fixed: `aclexplode`/`regprocedure` queries with exact expected output.
3. **HIGH — Phase 3 contingency was an unproven privileged command** (`psql "$AFLDB_PROD_DATABASE_URL"`
   — never exported in the shell, DSN in argv, stdin analogy misapplied). Fixed: STOP-only.
4. **HIGH — Phase 9 verification did not prove the cohort.** Global (not cohort-scoped) counts,
   no `is_active`/`field_group` filter, the actor query sent a literal `$ADMIN_USER_ID` to SQL
   (syntax error), and the per-path check was left to improvisation. Fixed: independent read-only
   cohort census (Phase 6 baseline, Phase 9, failure/indeterminate cases).
5. **MEDIUM — host gates were read-only `hostname` lines.** Pasted blocks run every line
   regardless. Fixed: `prod_guard`/`rev_guard` fail-closed prefixes on every writing line; build
   `&&` restart.
6. **MEDIUM — backup file selection by `ls -1t | head -1` with an eyeballed timestamp.** Fixed: `$PRE`
   taken from `backup.sh`'s own output (also proving it dumped `afldb_prod`), plus the
   `restore-test.sh` sha binding on `afldb_restore_test`; `--keep 14` pruning of evidence dumps flagged.
7. **MEDIUM — second apply was permitted "if performed"; indeterminate commit outcome unspecified.**
   Fixed: no second apply; census-based indeterminate-outcome rule.
8. **LOW** — Phase 1 did not require "only 105 pending" before migrating; Phase 0 used Windows
   paths in a bash block and an incomplete file list; the untracked-file `grep` was broader than
   `PROD_ALLOWED_UNTRACKED_RE`; `npx` could fetch `tsx` from the registry; Phase 2 did not record
   every `afldb*` unit; Phase 12 did not enumerate the stale 2026-09-26 artefacts. All fixed.

Not changed, reported for the operator: `.env.example`'s ISSUE-251 comment implies the two
`AFLDB_PROD_*` DSNs are read from `.env`; the CLI does not read `.env` (§21.0a states the actual
contract).

The corrected procedure and its read-only census SQL have **not** been executed anywhere. Before
any PROD preparation, §21 as corrected needs an independent re-review, and ideally the census run
once against `code_test_db` after a rehearsal apply (no PROD connection) to prove the SQL.

---

**PROCEDURE CORRECTED 2026-09-27 — pending independent re-review (§21.14). Live PROD write NOT
authorised.**

No PROD mutation, PROD connection, Git operation, or issue-status change was performed by this
pass. ISSUE-251 is not resolved. ISSUE-237 L5 remains blocked.

---

## 22. §21 Phase-9 cohort census proved against real committed rehearsal data (2026-09-27, this pass, uncommitted)

**Purpose.** §21.14 flagged that the corrected Phase 9 census SQL had never been executed anywhere.
A prior attempt in this pass ran the exact census against `code_test_db` but found the database
already in its post-teardown baseline (§18.10's residue), so it only proved the census returns the
*negative* (torn-down) shape correctly — it never exercised the *positive* (committed 92-player)
shape the procedure actually depends on. That prior attempt is recorded accurately below rather than
discarded. This section closes that gap by recreating the committed rehearsal state for real and
running the unmodified census SQL against it before teardown.

Nothing in this pass touched `afldb_prod`, the retained candidate `afldb_prod_candidate_20260926-213225`,
`afldb_dev`, `afldb_test`, or the ISSUE-238 worktree. No Git operation was performed. No implementation
or harness code was changed — `tools/rebuild/draftguru/issue251_prod_rehearsal.ts` was used exactly as
it stands from §18.10, unmodified.

### 22.1 Previous (negative-shape) attempt, recorded accurately

Recorded here for accuracy, not re-executed by this pass: a prior read-only census attempt ran the
exact §21 Phase 9 SQL against `code_test_db` as it stood at that time. Result: `cohort_paths` = 92,
`cohort_paths_distinct` = 92, all cohort-state rows 3–16 = 0, `players_total` = 13,273. This exactly
matches §18.10's post-teardown residue state — the database had already been torn down before that
attempt ran. **The census ran correctly; the census SQL itself showed no defect; the pinned target
artefact was correct; the database was correct; the task premise that a committed post-adoption state
still existed was wrong.** No positive-state evidence existed until this section's rehearsal
recreation (§22.4–§22.6).

### 22.2 Database identity — independently proved before any write

Both `code_test_db` DSNs were independently queried (`SELECT current_database(), current_user`),
not merely read from `.env`:

- `AFLDB_CODE_TEST_DATABASE_URL`: dsn user `afldb_owner`, dsn path `/code_test_db`, dsn host
  `127.0.0.1:55432` (the streamanator tunnel endpoint) → live `current_database='code_test_db'`,
  `current_user='afldb_owner'`. MATCH.
- `AFLDB_CODE_TEST_IMPORT_DATABASE_URL`: dsn user `afldb_import`, dsn path `/code_test_db`, dsn host
  `127.0.0.1:55432` → live `current_database='code_test_db'`, `current_user='afldb_import'`. MATCH.

Neither DSN resolved anywhere else; the task's STOP condition was not triggered.

### 22.3 Baseline gate (before recreating anything)

- Target-set artefact (`docs/rebuild-manifests/draftguru/issue224-s9-target-set-20260922.json`):
  92 rows, 92 distinct `afltables_external_id` values (static check).
- `issue251_prod_rehearsal.ts residue`: `Residue: 0 pinned path(s) still present, 0 rehearsal actor
  row(s) still present.`
- Independent census (placeholder actor, cohort empty so actor value is immaterial): rows 1–2 = 92,
  rows 3–16 = 0, row 17 (`players_total`) = 13,273.

Baseline matched the required shape exactly; the rehearsal recreation proceeded.

### 22.4 Rehearsal invocation used

The existing, reviewed `code_test_db` rehearsal harness only, via its documented package script, run
step-by-step so the committed state could be inspected before teardown (the harness has no combined
"apply-then-pause-then-teardown" mode; each subcommand is a separate process, so the committed state
persists in the database between invocations without any code change):

```
npm run db:code-test:issue251-rehearsal -- seed
npm run db:code-test:issue251-rehearsal -- classify
npm run db:code-test:issue251-rehearsal -- apply
   # STOP HERE — census run before any teardown (§22.6)
npm run db:code-test:issue251-rehearsal -- classify
npm run db:code-test:issue251-rehearsal -- verify
npm run db:code-test:issue251-rehearsal -- teardown
npm run db:code-test:issue251-rehearsal -- residue
```

No second `apply` was run at any point. No implementation code was changed to enable this pause; the
existing per-subcommand invocation shape already provides the required safe operator boundary between
committed apply and teardown, so the task's "if there is no supported way to stop… report that as a
gap" condition did not arise.

### 22.5 Rehearsal actor, first classification, committed adoption

- `seed`: `Seeded: 92 target(s) confirmed absent; rehearsal actor admin_user_id=20 (enabled,
  super_admin, password+TOTP enrolled). Nothing else was written.`
- Independently re-queried (read-only, by the deterministic rehearsal email, not by trusting the
  printed id alone): `auth_users` row `id=20`, `role=super_admin`, `enabled=true`, `has_password=true`,
  `has_totp=true`. **`REHEARSAL_ADMIN_USER_ID=20`.**
- `classify` (pre-apply): `0/92 of the pinned AFL Tables paths already resolve to a player` — matches
  the required initial 0/92 shape.
- `apply`: in-transaction classification `CREATE=92 / ALREADY_SATISFIED=0 / CONFLICT=0`; every
  in-transaction postcondition reported OK (92/92 identities resolve, 92 distinct player_ids, no
  duplicate slug, 92/92 name-parts correct, player count +92 exactly, 92/92 `player_career_stats`,
  92/92 `data_overrides` durability rows, 92/92 durable payloads carry resolved name parts, 92/92
  `data_edits` audit writes, **0/92 `afl_api` identities created**); `Transaction committed = yes`.

### 22.6 Exact §21 Phase 9 cohort census — positive-state result (17 rows)

Run against `code_test_db`, actor id 20, the exact pinned target-set file, under an explicit
`BEGIN TRANSACTION READ ONLY … ROLLBACK` — identical SQL to §21 Phase 9, unmodified — immediately
after the commit in §22.5 and before any teardown:

```
1  cohort_paths                              92
2  cohort_paths_distinct                     92
3  afltables_rows_for_cohort_any_status      92
4  afltables_rows_not_cleanly_accepted        0
5  accepted_paths_distinct                   92
6  cohort_players_distinct                   92
7  cohort_players_with_non_cohort_afltables    0
8  manual_tokens                             92
9  manual_tokens_distinct                    92
10 players_with_a_manual_token               92
11 active_creation_records                   92
12 players_with_exactly_one_creation_record   92
13 creation_record_path_equals_player_path   92
14 creation_records_by_selected_actor        92
15 creation_records_by_any_other_actor        0
16 afl_api_identities_on_cohort_players        0
17 players_total                          13,365
```

`players_total` = baseline (`P0` = 13,273) + 92 = 13,365 exactly, with no unexplained delta.
**Every Phase-9 assertion in §21 passed exactly, with zero deviation.** Cohort-specific AFL API
count (row 16) = 0, matching D-251-3.

### 22.7 Post-adoption no-write classification (performed)

- `classify` (post-apply, no `--apply`, no second write): `92/92 of the pinned AFL Tables paths
  already resolve to a player` — the harness's read-only proxy for the deterministic
  `CREATE=0 / ALREADY_SATISFIED=92 / CONFLICT=0` shape §21 Phase 9 specifies (the harness has no
  package-script equivalent of the PROD CLI's own three-way `--target prod` dry-run classifier — see
  §21.13 item 2 — so this is the closest available read-only proxy, exactly as it was in §18.7).
- `verify` (the harness's own independent check, separate from the census): `VERIFY: all 92 paths
  resolved (deterministic second classification), 0 afl_api identities among the adopted players.`
- **No second `apply` was run** — per the procedure, the deterministic already-satisfied shape above
  is the proof that a first-adoption apply would now refuse; a second apply is not itself a step of
  this proof.

### 22.8 Teardown and final zero-residue proof

`issue251_prod_rehearsal.ts teardown`: `Teardown: removed 92 player(s) and the rehearsal actor.`

Independently re-proved, two ways:

- `issue251_prod_rehearsal.ts residue`: `Residue: 0 pinned path(s) still present, 0 rehearsal actor
  row(s) still present.`
- A fresh census run (placeholder actor, cohort now empty): rows 1–2 = 92 (the artefact, unchanged),
  rows 3–16 = 0, row 17 (`players_total`) = **13,273** — restored exactly to the pre-rehearsal
  baseline (`P0`).

No unrelated row was touched. No rehearsal scratch script was left behind (`git status --short`
after this pass is identical to session start plus the same pre-existing uncommitted ISSUE-251 files).

### 22.9 Conclusion

§21's Phase 9 cohort census — the exact independent verification logic drafted in §21.14 and never
previously executed — has now been exercised against real, committed rehearsal data in `code_test_db`,
not merely against an already-torn-down baseline. All 17 rows matched the required positive shape
exactly, on the first and only attempt, with no manual database intervention and no code change.

**This closes the specific evidence gap this pass was scoped to close: the census SQL is now proven
against both shapes (negative/baseline in §22.1 and the original §18.6/§18.10 record, and positive in
§22.6).** It does **not** resolve ISSUE-251, does **not** unblock ISSUE-237 L5, and does **not**
constitute or substitute for the items still outstanding per §21.13/§21.14: the full diff/review
pass, the `replay_admin_overrides` oracle run, the `privileges.ts` `prod` target follow-up, and
separate, explicit operator authorisation for any live PROD adoption. (`tests/integration/
privileges.test.ts` against a real database is **not** in that list — §20 already closed it,
38/38 pass against the disposable `issue251_privileges_test` database; §18.13's mention of it was
accurate only as of §18, before §20 ran, and is superseded.)

No PROD mutation, PROD connection, Git operation, or issue-status change was performed by this pass.
ISSUE-251 is not resolved. ISSUE-237 L5 remains blocked.
