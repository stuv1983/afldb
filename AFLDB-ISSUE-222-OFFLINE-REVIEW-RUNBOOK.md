# AFLDB-ISSUE-222 — Offline retained-evidence review runbook (decision O-4 revision 2, approved prospectively 2026-09-18)

**EXECUTED 2026-09-18 (Sonnet 5, High).** The tool this runbook specifies
(`tools/rebuild/draftguru/review_person_bridge_offline.py`) was implemented and run twice over all
997 real sample rows with identical `rows_sha256`
(`940f050a4306cb66e4d644e334033a2e2f0ee73e90ed877b665041f769bca3a6`): `offline_strong` 959,
`offline_limited` 1, `offline_contradict` 9, `target_unregistered` 28, `offline_unavailable` 0,
`tooling_or_schema_error` 0. Every output artefact in §4 was written. Full results, the 9
contradict rows and the recheck/audit content: `AFLDB-ISSUE-222.md` §11.8, `issues.md`. **Phase 3
remains PENDING** — the operator recheck and 30-row audit confirmation this runbook's §7/§8
requires are still outstanding, and the acceptance gate is not met while any genuine contradiction
remains. The contract below is retained as written; it was not re-edited to describe the execution.

**Status: the ACTIVE operational contract for the Phase 3 §3.5/§6.5 review. Approved for a later
execution session (Sonnet 5, High). Not executed. Phase 3 remains PENDING until the operator
completes the exception rechecks and the 30-row audit defined here. Nothing in this runbook
authorises an import, a network request, a database connection, a DEV or PROD action, or Phase 4.**

This runbook implements **decision O-4 revision 2** (recorded in
`AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md` §0 and pointed to from `AFLDB-ISSUE-222.md` §0/§11.7).
Revision 2 supersedes, before any review execution, the never-executed revision 1 design that would
have opened every AFL Tables page for all 997 rows with Playwright. Under revision 2 the primary
review source is **evidence the repository already retains**: the captured DraftGuru snapshot on the
source side, and the accepted fitzRoy full-history snapshot plus AFLDB's registered identities on the
target side. Live AFL Tables acquisition is reserved for a measured residual, reported to the operator
first and authorised separately (§9). Playwright MCP is an exception/clarification tool, not the
default mechanism.

Unchanged by this runbook: the sample's membership, ordering, salt and statistical design (census 399
exhaustive + random 598 at a 0.4997% zero-failure bound); D-9; the prohibition on name-only matching;
Wikipedia and Footywire as corroborating links only, never automatic authority; the §3.5 no-redraw
discipline. The outcome it produces is a **"retained fitzRoy/AFLDB comparison plus operator
exception/audit review"**, never "997 manually reviewed by the operator" and never "verified against
AFL Tables live".

**Independence statement (applies to every use of this runbook).**

- DraftGuru's captured AFL Tables href is the **independent, source-side identity assertion**: an
  editor on a different website named an AFL Tables profile for this person.
- fitzRoy/AFLDB player details are **retained target-side evidence ultimately derived from AFL Tables**
  (fitzRoy 1.8.0 reads AFL Tables; the canonical rebuild is built from that snapshot). They are **not
  an independent source from AFL Tables**. Comparing them to a live AFL Tables page would compare AFL
  Tables to itself at two dates; downloading the same pages again duplicates evidence rather than
  adding a source.
- AFLDB's `external_identities` row for the path is the **canonical registration** of that AFL Tables
  identity on a target database (`afldb_test` here).
- Wikipedia and Footywire links on the DraftGuru page are **unused corroborating links**, never authority.
- The question the review answers is therefore: *does DraftGuru's asserted identity consistently
  resolve to the canonical AFLDB player that the accepted source describes?* — not *do two independent
  websites happen to share a name*.

---

## 1. Immutable inputs (all hashes recomputed and refused on mismatch before any row is processed)

| Input | Repository path | sha256 (reproduced 2026-09-18) | Role |
|---|---|---|---|
| Parent bridge (source-evidence) | `data/reference/draftguru-person-bridge-20260918-v1.json` | `92ff142ef71d175046b4949b0a85d5925bc396d3586b5b1fc3f44e51f097320e` | expected AFL Tables identity per row |
| `afldb_test` child (deployment) | `data/reference/draftguru-person-bridge-20260918-v1.afldb_test.json` | `596bbb684424b40f43c22368f1b77aa4198eec8b56a1109a7bb587c5c7a9a27f` | registered-exactly-once vs `target_not_registered`; `target_registration.count` 13,275 |
| Immutable 997-row sample | `docs/rebuild-manifests/draftguru/bridge-review-20260918-v1.json` | `036cc0826428c03a622448d299b803c23bac011bd5cd92eea86c4283e445ba84` | rows, order, strata, salt `AFLDB-ISSUE-222/v1` |
| Captured DraftGuru snapshot — B3 manifest | `docs/rebuild-manifests/draftguru/person-html-20260918.json` | `5e944d0e57985593cbe35f15d5b46613d1d8e0843895a47db3dcd99f1f2538a7` | binds the profile file and raw pages |
| Captured DraftGuru snapshot — profile | `data/sources/draftguru/person-html-20260918/parsed/person_profile.jsonl` | `bad43909112aae4b318336ca4de8576e67608202dd077fdc2f89188b7a04aa37` | captured href, visible name, title birth year, DOB/height candidates, `raw_sha256` |
| Stage A manifest | `docs/rebuild-manifests/draftguru/annual-html-20260826.json` | `d06bf6be358663ad3c44a56066c9096fbc4bdf4760349ed181a642476d374652` | binds rows/persons |
| Stage A rows | `data/sources/draftguru/annual-html-20260826/parsed/rows.jsonl` | `06936baca3b37133949847e7589008a06be76bbc8f1fb5b4d2fef8b743838a64` | draft events, age, club, parity games/goals |
| Stage A persons | `data/sources/draftguru/annual-html-20260826/parsed/persons.jsonl` | `95c98f2aa272b598543357908c91f8b104b5ff501a66405fb1da0a50a4ebcb9d` | display names, years |
| Accepted fitzRoy snapshot — register | `data/reference/fitzroy-accepted-baselines.json` | `c68083aed64e894566054404b93032698e9664d79db377080ad795724d032eef` | names the single accepted baseline `full-history-20260902` and its `snapshot_dir` |
| Accepted fitzRoy snapshot — manifest | `docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json` | `2bd66e3df5ce80411363da9e15c6dddadc9eefe5c5c9eca3f5b7bd7106b0a0c1` (LF bytes; equals the register's `manifest_sha256`) | per-artefact sha256, row counts and columns for 131 files (129 `player_stats_<season>.csv` 1897–2025, `player_details.csv`, `results.csv`); `artefact_set_sha256` `15ba5dc624535d95fd1661c7c5e757ae4fc2d31782a2c0b1414e19358580dd6c` |
| Accepted fitzRoy snapshot — bytes | `data/sources/afltables/fitzroy_core/full-history-20260902/` (gitignored; **operator-supplied**, see §1.1) | every file must equal the manifest's sha256; 131/131 required | retained target-side player facts |
| fitzRoy contract | `tools/rebuild/fitzroy/fitzroy-contract.json` | `e4001a8d3a9ec3afb936f9c09cabf5921cd203978c4061465655d2b756e7a466` | `profile_url_continuity` (4 renumbered-profile rules) and the two 1909 row-drop rules |
| Human ledger | `data/reference/draftguru-link-decisions.json` | `13ea051e6620a1320e3e60cc34d58ece9c7f08be3205d248c93787edc9a931a1` | ledger-overlap class (none in this sample) |
| Curated aliases | `data/reference/player-name-aliases.json` | `c77ccbf8b995c56dd9f33b53bb1907115acefe7b090facf6760b200e1d491ee0` | alias evidence keyed by AFL Tables path (2 entries) |
| Awards identity census (bootstrap era, name-only corroboration) | `data/awards/player-identity.csv` | LF `128b5b99e3b715a870e2b364efb8a8f9ee21ab9fd94a20a2e40d19e9145079de` (CRLF working copy `17d5eb82b67f82b150e4284e4021c9a078fbdce4ac41785288f732df2fb40b03`) | 1,851 path → display name pairs; corroborating only, never sufficient |
| Corrected derived review presentation | superseded — the per-row `evidence` block of the verdict artefact (§4) carries every field the correction handoff §G listed; no separate presentation file is required | — | — |

If the correction session re-versions any file, the v2 path and hash replace the entry above and every
output name gains the matching version.

### 1.1 The accepted fitzRoy bytes are retained but off-tree

The register's `snapshot_dir` is **empty on every repository checkout on the workstation** (measured
2026-09-18: absent in this worktree; the main checkout holds only the empty retired
`full-history-20260827` directory, `trial-2024` and `_probe`). The accepted bytes survive in the
operator's local backup root as the AFLDB-ISSUE-112 Pass 19 staging copy (`issue-112-staging-20260902/
stage-fitzroy/data/sources/afltables/fitzroy_core/`, directory still named `full-history-20260827`).
**All 131 files in that directory hash-match the accepted `full-history-20260902` manifest exactly**
(131 ok / 0 mismatch / 0 missing, verified 2026-09-18, read-only). Before the execution session the
operator copies those 131 files (nothing else) into this worktree at the register's `snapshot_dir`
path, `data/sources/afltables/fitzroy_core/full-history-20260902/`. This is a local copy of retained
bytes, **not an acquisition**: no AFL Tables or fitzRoy request is made. The session recomputes every
sha256 and refuses to start on any mismatch or on fewer than 131 files. `player_details.csv` carries no
profile URL or ID and is **never joined on** (§3); it is verified because the manifest binds it.

Optional, not required: if the operator also holds the `club-lists-20260905` parsed CSVs
(`docs/rebuild-manifests/afltables_club_lists/club-lists-20260905.json`; 16,731 rows with `profile_path`
and a DOB on every row), they may be placed at `data/sources/afltables/club_lists/club-lists-20260905/`
and hash-verified per that manifest; the tool then records exact DOB as an additional retained target
fact. They were **not found anywhere on the workstation** on 2026-09-18, and their absence changes no
outcome rule: implied birth year from the fitzRoy `Age` column is available for every registered row.

## 2. Population

- Exactly **399** census rows, then exactly **598** random-stratum rows, in the sample file's order:
  **997** rows, **zero overlap** (verified 2026-09-18; the random ordering reproduces exactly from
  `sha256("AFLDB-ISSUE-222/v1" + "|" + player_url)` hex ascending, ties by URL).
- Immutable membership and order. **No redraw, no replacement, no skip, no reordering.** A row that
  cannot be completed gets a terminal non-strong outcome and enters the recheck queue; it is never dropped.
- The session counts the rows before starting and refuses on any number other than 997.

## 3. Offline comparison fields (per row, where retained evidence permits; a missing field is recorded, never guessed)

Source side (captured DraftGuru snapshot, never fetched again):

- sample index (1–997), stratum, ordinal within stratum;
- DraftGuru `player_url`; visible name (`page.h2`, NBSP-normalised) and `page.title`;
- DraftGuru birth evidence: the `(born YYYY)` year from the title and `heuristic_fields.dob_candidates`
  (present for 997/997 sampled rows), plus `height_candidates`;
- DraftGuru games/goals: Stage A `parity_only.games` / `parity_only.goals` on each row (leading
  integer parsed; forms like `76 (31)` keep the leading figure);
- every Stage A row (year, `event_type_raw`, pick, club, `age_raw`) and the **earliest
  original-recruitment event** — the first `National`, `National Draft` (absent-column years 1981/1982/
  1987), `Rookie`, `Pre-Season`, `Mid-Season`, `Mini-Draft`, `Pre-Draft` or `Post-Draft` row, never a
  `Trade` or `Free Agency` row; **15 random-stratum rows have only trade rows** and carry `null` here;
- the captured AFL Tables href (`afltables_hrefs[0].href`, exactly one required), its normalised
  identity, `raw_filename` and `raw_sha256`.

Target side (retained, never a live page):

- expected AFL Tables identity (parent `afltables_external_id`); `afldb_test` child status (`bridged`
  = registered exactly once on the target, or `target_not_registered`);
- the fitzRoy `player_stats` rows whose normalised `url` equals the identity (and, for a path named by
  a `profile_url_continuity` rule, its paired path — both register to one player), collapsed from
  player-match grain to one record: fitzRoy numeric `ID` set (must be ≤ 1 distinct), `Player` /
  `First.name` / `Surname` sets, `DOB` set (sparse: 268 of the 969 registered sample rows), implied
  birth year from `Age` at the earliest dated row (available for all 969), debut date and first season,
  last season, career games (max `Career.Games`), goals sum (with the count of NA goal cells kept
  separate), club history (`Playing.for` set);
- canonical AFLDB player identity: **not available offline** — `players.id` is a re-seeded surrogate
  and no retained artefact carries it; the retained canonical identity is the registered path itself;
- retained aliases for the path; awards-census display names for the path (name-only corroboration);
- human-decision status (`linked` agreeing / `linked` disagreeing / `confirmed_unlinked` / none);
- provenance: snapshot label, manifest hash, artefact-set digest, tool version;
- missing-field indicators; evidence-strength outcome; reason codes.

## 4. Output artefacts (repository-consistent paths; every tracked file written as LF bytes, hashed as LF)

| Artefact | Path | Tracked | Content |
|---|---|---|---|
| Structured machine outcomes (also the manifest) | `docs/rebuild-manifests/draftguru/bridge-review-verdicts-20260918-v1.json` | yes | header + `rows[]` (997, sample order) + `totals` + `rows_sha256` |
| Reviewer-friendly CSV | `docs/rebuild-manifests/draftguru/bridge-review-verdicts-20260918-v1.csv` | yes | one line per row, same order, flattened fields of §3, outcome, reason codes |
| Operator recheck queue | `docs/rebuild-manifests/draftguru/bridge-review-recheck-20260918-v1.json` | yes | §7 classes, the 30-row audit, operator verdict blocks |
| Measured residual report | `docs/rebuild-manifests/draftguru/bridge-review-residual-20260918-v1.json` | yes | §9 categories with exact row lists and counts |
| Checkpoint / progress / lock | `data/review/draftguru-bridge-offline-20260918-v1/{checkpoint.json,progress.json,review.lock}` | no (`/data/*` ignored) | §6 |

Every tracked output carries: the sample hash; parent and child hashes; the fitzRoy register, manifest
and `artefact_set_sha256` plus `files_verified: 131`; the B3 manifest and profile hashes; the Stage A
hashes; tool path and version (`tool_version`); `generated_utc` / `completed_utc`; row counts; outcome
totals. **Never** a credential, DSN, cookie, session token or absolute local path; every path is
repository-relative. The immutable review sample is never edited: its `verdict: null` placeholders stay
`null` forever, and the verdict artefact is the only place machine outcomes live (correction handoff §F).

Header schema of the verdict artefact:

```text
schema_version           1
review_method            "offline-retained-evidence+operator-exception-audit"   (O-4 revision 2)
runbook                  "AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md"
tool                     { path: "tools/rebuild/draftguru/review_person_bridge_offline.py", version }
inputs                   { sample, parent, child, b3_manifest, profile, stage_a_manifest, stage_a_rows,
                           stage_a_persons, fitzroy_register, fitzroy_manifest, fitzroy_contract, ledger,
                           aliases, awards_census : {path, sha256};
                           fitzroy_snapshot: {label, snapshot_dir, artefact_set_sha256, files_verified};
                           club_lists: null | {label, manifest sha256, files_verified} }
generated_utc / completed_utc   ISO-8601 Z
total_expected_rows      997
rows[]                   sample_index, stratum, ordinal, player_url,
                         draftguru {...}, stage_a {...}, expected_afltables_identity, child_status,
                         retained_target {...} | null, ledger_status, aliases[], awards_census_names[],
                         flags { numeric_suffix, continuity_rule_url, name_variant, known_exception_class },
                         missing_fields[], outcome, reason_codes[], weak_evidence,
                         operator_review_required, operator_verdict: null (ALWAYS null in this file)
totals                   { completed, offline_strong, offline_limited, offline_contradict,
                           target_unregistered, offline_unavailable, tooling_or_schema_error, remaining }
rows_sha256              sha256 over the canonical JSON of rows[] — identical inputs must reproduce it
```

## 5. Machine outcomes

Exactly one terminal outcome per row:

| Outcome | Meaning |
|---|---|
| `offline_strong` | all four conditions below hold |
| `offline_limited` | the exact captured href resolves to a registered identity with retained rows, but the corroborating facts are incomplete, rest on a single signal, or include an unlisted name variant |
| `offline_contradict` | retained birth year, career span or identity evidence indicates a different person |
| `target_unregistered` | the captured href exists but the identity is not registered on `afldb_test` (child `target_not_registered`); no retained target facts to compare |
| `offline_unavailable` | required retained evidence is absent (snapshot rows missing for a registered identity, profile missing, Stage A rows missing) |
| `tooling_or_schema_error` | an input cannot be interpreted safely (unparseable row, unexpected column set, hash or count mismatch discovered mid-run) |

`offline_strong` requires **all** of:

1. DraftGuru captured **exactly one** AFL Tables href (`afltables_href_count == 1` and
   `distinct_afltables_identity_count == 1`) and it equals the parent identity;
2. the identity is registered **exactly once** on the target (child `bridged`) and the retained
   snapshot holds rows for it with at most one distinct fitzRoy `ID`;
3. corroboration **beyond name equality**: name consistent (surname equal after normalising case,
   diacritics, apostrophes and hyphens; given name equal or a listed variant pair) **and**
   `BIRTH_YEAR_CONSISTENT` (|DraftGuru title year − retained birth year| ≤ 1, retained = DOB year where
   present, else implied from `Age` at the earliest dated row) **and** at least one of
   `DEBUT_NOT_BEFORE_EARLIEST_RECRUITMENT`, `SPAN_CONTAINS_EARLIEST_RECRUITMENT_YEAR` (for trade-only
   rows: the trade year) or `GAMES_CONSISTENT`; for an identity whose path carries a **numeric suffix**
   (34 sampled rows) or which is a **continuity-rule path** (2 sampled rows), additionally
   `CLUB_HISTORY_OVERLAPS` (any DraftGuru row club appears in the retained club history);
4. no contradiction code is present.

Rules:

- **Name equality alone is never sufficient**; a row with a consistent name and nothing else is
  `offline_limited`.
- **Club differences alone are never a contradiction.** Drafting, receiving and debut clubs may all
  legitimately differ; club overlap is a positive corroborator only.
- **Use the earliest original recruitment** (correction handoff §H). `DEBUT_BEFORE_EARLIEST_RECRUITMENT`
  is an informational code, **not a contradiction**: the offline feasibility measurement found 40
  random-stratum rows whose retained debut season precedes their earliest DraftGuru original-recruitment
  year, which is the expected shape for players first listed before DraftGuru's 1981 coverage or before
  the modern draft, later re-listed through a pre-season or pre-draft event. Only
  `CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT` (retained last season earlier than the earliest
  original-recruitment year, or than the earliest trade year for trade-only rows) is a contradiction code.
- Contradiction codes: `BIRTH_YEAR_CONFLICT` (|Δ| ≥ 2), `CAREER_ENDED_BEFORE_EARLIEST_RECRUITMENT`,
  `SURNAME_DIFFERENT`, `MULTIPLE_FITZROY_IDS`, `LEDGER_DISAGREES`. Any one yields `offline_contradict`.
- `GAMES_CONSISTENT`: the retained career games (to season 2025) is ≤ the DraftGuru games figure (Stage A,
  captured 2026-08), and equal when the retained last season is ≤ 2024; otherwise `GAMES_INCONSISTENT`
  (informational; it withholds `offline_strong` only if it is the sole third signal).
- Missing evidence becomes `offline_limited` (partial) or `offline_unavailable` (absent) — **never a guess**.
- Spelling variants, diminutives, Jnr/Snr and hyphenation are name-consistent when listed in the tool's
  variant table (which must contain at least the 11 sampled pairs measured on 2026-09-18: Dan/Daniel,
  Matt/Matthew, Ed/Edward, Harrison/Harry, Lachlan/Lachie, Mitch/Mitchell, Ollie/Oliver, and
  Stephen/Steven) and are recorded with `NAME_VARIANT`; an unlisted variant is `NAME_VARIANT_UNLISTED`
  → `offline_limited` → recheck. Adding a variant is a reviewed edit to the tool, covered by a test.
- Wikipedia and Footywire are never read and never authority.
- `weak_evidence` is set when the strong conditions hold with exactly the minimum third signal and no
  club overlap; such rows enter the recheck queue (§7 class 10).

## 6. Checkpoint and resume

- **Atomic writes**: every tracked output and `checkpoint.json` is written to a temporary file in the
  same directory, flushed and fsynced, then replaced over the target (`os.replace`). Never appended in place.
- **Deterministic reruns**: identical inputs must reproduce identical `rows[]`, `totals` and
  `rows_sha256`; only `generated_utc` / `completed_utc` may differ. The execution session runs the tool
  twice and records that the two `rows_sha256` values are equal.
- **Input-hash validation** before any row and before any resume: every §1 hash, all 131 snapshot
  artefacts, and the sha256 of every output already written; any mismatch is a stop.
- **Preservation of completed results**: a resume starts at the first row without a terminal outcome,
  in sample order, and never truncates or rewrites a completed row unless the operator has set
  `rerun_required: true` on it in `checkpoint.json`.
- **Lock against concurrent execution**: `review.lock` holds `{pid, hostname, started_utc, session_id}`;
  a second run that finds a lock stops and reports it; only the operator removes a lock.
- **Exact sample-order preservation**: rows are emitted in sample order; a row count or order that
  differs from the immutable sample is a stop.
- **Progress totals** to the console and `progress.json` every 100 rows and at completion.
- **No database**: the tool must not import `psycopg`, must not import `tools/migration/common.py`'s
  connection helpers, and must not read any `*DATABASE_URL*` environment variable; a test asserts this.
- **No network**: the tool opens no socket; a test runs it with `socket.socket` replaced by a raiser.

## 7. Operator recheck queue

Written to `bridge-review-recheck-20260918-v1.json` when every row has a terminal outcome, hash-linked
to the verdict artefact (`verdicts_sha256`), the sample, parent and child. Mandatory membership:

1. every `offline_contradict`;
2. every `offline_limited`;
3. every `target_unregistered` in the sample — all 28 (12 census, 16 random), listed with the
   `afldb_test` reason; they are in scope because the sample was drawn on the parent, and their
   settled disposition is **continued withholding** unless the operator records otherwise;
4. every `offline_unavailable`;
5. every `tooling_or_schema_error`;
6. all six numbering/disambiguation cases — in this sample `joel_smith/1` (census), `josh_smith/1`
   (random), `tom_murphy/1` (random); `aaron_black/1`, `alwyn_davey/1`, `sam_butler/1` listed with
   `in_sample: false`;
7. the known spelling/name-change cases — `dean_laidley/1` and `matthew_capuano/1` (`in_sample: false`),
   and every in-sample `NAME_VARIANT` row (11 measured) so the operator confirms each variant pair once;
8. `stephen_schwerdt/1` → `players/S/Steven_Schwerdt.html` (random; likely third spelling case);
9. every human-ledger overlap (none in this sample; recorded as an empty class);
10. every `weak_evidence` row, every numeric-suffix row and both continuity-rule rows
    (`jack_graham/3` → `Jack_Graham2.html`, `jack_ross/3` → `Jack_Ross3.html`);
11. a **deterministic 30-row audit** of otherwise clean `offline_strong` rows.

The 30-row audit:

- is selected **only after** every row has a terminal outcome;
- uses the pre-declared independent salt **`AFLDB-ISSUE-222/audit-v1`** (unchanged from revision 1);
- is the first 30 rows under `sha256("AFLDB-ISSUE-222/audit-v1" + "|" + player_url)` hex ascending,
  ties by URL, over the set of `offline_strong` rows not already in classes 1–10;
- records the selection command and the sha256 of its input set; is **never manually selected and
  never redrawn** because a row is inconvenient.

Per recheck row the artefact carries: `player_url`, stratum, `sample_index`, recheck classes, the
machine outcome and reason codes, the retained facts the operator needs, and an operator block
`{ operator_verdict: null | "agree" | "contradict" | "undetermined", reviewed_utc, notes, evidence }`.
`contradict` and `undetermined` **require** notes and evidence. The operator's verdict never overwrites
the machine outcome. The operator works from the retained evidence in the CSV first; opening a page
(saved or live) is an exception step governed by §9.

## 8. Acceptance (the offline review satisfies the primary §3.5/§6.5 gate only when ALL hold)

- all 997 rows carry terminal offline outcomes;
- every mandatory recheck row has a terminal operator verdict;
- all 30 audit rows are operator-confirmed `agree`;
- zero genuine contradictions remain (a machine `offline_contradict` the operator adjudicates `agree`
  with evidence is not genuine; a machine or operator `contradict` that stands is genuine and blocks);
- every identity the operator leaves `undetermined` is **withheld from every later import dataset** (a
  new child version with reason `review_failure:undetermined`), never imported;
- every hash, count and unit reconciles across sample, verdicts, recheck, residual report and the
  correction handoff tables; the `afldb_test` child figures (3,463 bridged / 1,594 withheld / 101
  `target_not_registered`) and the projection (3,460 net-new + 3 agreeing human rows) are unchanged;
- no immutable input changed (§1 hashes re-verified at completion);
- the final record says **"retained fitzRoy/AFLDB comparison plus operator exception/audit review"**,
  states the achieved bound beside n = 598 without rounding, and states that the comparison target is
  AFL Tables-derived retained evidence, not an independent source.

If any audited `offline_strong` row is disproved: **stop acceptance**; preserve the failed row verbatim
in v1 (v1 can never be described as clean afterwards); investigate the failure mechanism across the
997 and, where it could reach them, the whole 3,564-person bridged population (§3.5 item 2); expand or
repeat the affected review; **never replace or redraw the failed audit row**; any corrected dataset is
a new version with its own revalidation under a new salt.

## 9. Residual network decision (reported first, never fetched automatically)

After the offline review, the residual report lists every row that still lacks sufficient evidence,
by category, with exact counts and URLs. For each category the recommended next evidence is:

| Category | Next evidence | Network? |
|---|---|---|
| `target_unregistered` (28 sampled; 101 in the child) | **continued withholding**; the offline measurement shows these paths have no appearance in the accepted snapshot through season 2025 (0 of the 101 appear in its 13,275-URL set), so registration is a future baseline/in-season event, not a Phase 3 fact to fetch; operator curation through player-links remains available per person | no |
| `offline_contradict` | operator adjudication from retained evidence; if the retained evidence is itself ambiguous, a **bounded AFL Tables HTML snapshot of exactly those URLs** or Playwright inspection of saved evidence, under a new authorisation | only if authorised, exact count stated |
| `offline_limited` — unlisted name variant / games inconsistent / under-corroborated suffix | operator curation from retained evidence; escalate a named remainder to the bounded snapshot above | only if authorised |
| `offline_unavailable` | supply the missing retained bytes (§1.1); never fetch to fill a local gap | no |
| `tooling_or_schema_error` | fix the tool or input handling, rerun deterministically | no |
| read-only database verification | not required for the registration fact (already measured on `afldb_test` 2026-09-18 and cross-confirmed by the snapshot identity set); the correction handoff §E's tracked read-only registration extract remains the way to name `players.id` values if the operator wants them recorded | no network; DB read needs its own authorisation |

**Any network acquisition must receive a new explicit operator authorisation naming the exact URL
count and scope.** If one is granted, the revision 1 conduct rules carry over unchanged as the minimum:
one concurrency, ≥ 1.5 s pacing, respectful bounded retries, stop on 429/CAPTCHA/challenge/block, no
identity or user-agent evasion, no login, only the captured identities on `https://afltables.com`,
same-host redirects only, DraftGuru never refetched, Wikipedia/Footywire never opened, and hashed
evidence stored under `data/review/` with only relative paths in tracked artefacts.

## 10. Fresh Sonnet correction/offline-review prompt

```text
Work in D:\dev\afldb-issue-222 on branch sonnet/issue-222.

Model/effort: Sonnet 5, High.

Mode: implement the approved Phase 3 corrections and execute the offline-only evidence
comparison.

Read AFLDB-ISSUE-222-PHASE3-CORRECTION-HANDOFF.md and
AFLDB-ISSUE-222-OFFLINE-REVIEW-RUNBOOK.md completely.

Precondition: the operator has placed the 131 accepted fitzRoy artefacts at
data/sources/afltables/fitzroy_core/full-history-20260902/ (runbook §1.1). Verify every
file's sha256 against docs/rebuild-manifests/afltables_fitzroy_core/full-history-20260902.json
before anything else and stop if fewer than 131 match.

First implement the required exporter/importer alignment, regression tests, acceptance
arithmetic corrections, residual-evidence corrections and verdict schema. Run the
DB-free real-child validate-only gate.

Then compare all 997 immutable review rows using only:
- the captured DraftGuru snapshot;
- accepted retained fitzRoy/full-history data;
- retained AFLDB identity/player evidence already present locally.

Generate the deterministic CSV/JSON comparison, manifest, verdict artefact, measured
residual report, operator-recheck queue and deterministic 30-row audit.

Do not:
- make any external network request;
- fetch AFL Tables;
- use Playwright;
- connect to a database;
- run import_draftguru.py except its explicitly DB-free --validate-only mode;
- import links;
- modify immutable parent/child/sample files;
- deploy;
- perform DEV/PROD actions;
- run Git commands;
- claim final Phase 3 acceptance before operator rechecks are complete.

Stop after reporting:
- exact offline coverage;
- every evidence-strength total;
- every residual category;
- operator-recheck rows;
- audit rows;
- files/hashes;
- tests and validation;
- whether any new network acquisition is actually necessary.
```
