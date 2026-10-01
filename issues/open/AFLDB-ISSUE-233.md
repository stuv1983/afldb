# AFLDB-ISSUE-233 — AFL API season discovery and season rollover ownership

**Status:** Open. **Severity:** Medium. **Opened:** 2026-09-23 (ISSUE-228 §16 S10, §19.3(c);
replaces resolved ISSUE-101/F as owner of the rollover change). **This runbook:** created
2026-09-26 in the bulk successor pass on `opus/afl-api-successors-229-234` (base `main`
`2e587415`). Uncommitted.

**State after this pass:**
- Discovery: **BLOCKED ON SOURCE EVIDENCE.**
- Rollover changes: **BLOCKED ON OPERATOR DECISION** (D-233-2, D-233-3).

No code was written for this issue. The procedure below is derived only from the decided parts.

**State after pass 2 (2026-09-26, uncommitted):**
- **Decisions recorded (operator, 2026-09-26):**
  - **D-233-1 = proposal JSON.** Discovery emits a deterministic, reviewable proposal JSON plus a
    human-readable stdout summary. It never edits `afl-api-identities.json` or
    `in_progress_seasons`.
  - **D-233-2 = season-scoped Brownlow artefacts.** AFL API season totals are NOT merged into the
    master `data/brownlow/season-votes.csv`. The rebuild loads reviewed season-scoped AFL API
    artefacts beside the master, gated by `stat_availability`.
  - **D-233-3 = preserve AFL API ownership or refuse.** A rebuild never silently converts an
    `afl_api`-owned canonical match to AFL Tables ownership. Until ownership replay exists, a
    rebuild fails closed if a completed season being rebuilt holds any `afl_api`-owned canonical
    match. 2026 holds zero, so this does not block the 2026 rollover.
- **Discovery: UNBLOCKED and IMPLEMENTED / DB-FREE VALIDATED** (§3a).
- D-233-2 / D-233-3: **decided, planned (§4.3), not implemented.** They were not in this pass's
  work list.

**State after pass 3 (2026-10-01, branch `sonnet/issue-233`, base `74d63602`, uncommitted):**
- **D-233-3: IMPLEMENTED / DB-FREE VALIDATED** (§4.4). The rebuild's census stage refuses before
  the capture and the reset; the rollover requires census evidence and refuses on the same rule.
  The census SQL's rollback-only PostgreSQL proof is written and **not yet run** (§4.4.4).
- **D-233-2: IMPLEMENTED / DB-FREE VALIDATED** (§4.5). No AFL API season artefact is tracked
  today, so the master-only load is unchanged. The DB phase is unexercised (§4.5.4).
- **Discovery: audited, unchanged** (§3b). The first real DEV `--fetch` is the operator step (§3b.2).
- Still open: the operator steps in §4.6. Not resolvable until they are done.

**State after pass 4 (2026-10-01, same branch and base, uncommitted):**
- **D-233-3 now protects BOTH:**
  - the **rebuild** of completed seasons (§4.4);
  - **promotion over a live target** (§4.7): `promotion-check.ts` refuses completed-season
    `afl_api` ownership on the live target at every phase that reads it. There is no override.
- **Ownership replay remains intentionally unimplemented.** The rule is still refusal.
- The census refuses a damaged schema (§4.7.3).
- Discovery `--fetch` retains the HTTP entity bytes verbatim (§3b.1 note, §4.7.4).
- DB-free validated only. No DEV acceptance is claimed.

**State after pass 5 (2026-10-01, same branch and base, uncommitted): live-safe validation + final
review** (§4.8):
- Full DB-free suite: no failure new to ISSUE-233 (the 13 failures reproduce identically at HEAD).
- `tests/integration/afl-api-ownership-census.test.ts`: **5/5 PASS on `afldb_test`**, no residue.
- Read-only census, current rebuild scope 1897..2025 excluding 2026: **PASS on `afldb_test` and
  on `afldb_dev`**. Both hold **zero** `afl_api`-owned matches in any season, 2026 included.
- `afldb_dev` was read only, in read-only transactions, as the app role; its before/after snapshot
  is identical. No PROD or `code_test_db` contact.
- Final pre-merge review: no CRIT/HIGH/MED finding; no code changed (§4.8.4).
- **Still OPEN:** the first real DEV discovery `--fetch` (§3b.2) has not run, D-233-2's Brownlow
  write path has never run against a database (§4.5.4), and PROD is untouched.

---

## 1. The contract

- **Discovery is proposal-only** (ISSUE-228 §13.4). A `discover-seasons` command reads
  `GET aflapi.afl.com.au/afl/v2/competitions/1/compseasons?pageSize=100` and **proposes**
  `{year, compSeasonId, providerId}` additions to `data/reference/afl-api-identities.json`
  `seasons` as a diff. It never writes `seasons.json` and never advances `in_progress_seasons`.
- **One surprising response never rolls a season over.** Registering a season makes it
  *acquirable*. Only the rollover (`tools/db/rollover-season.ts`, review-first,
  `--acknowledge-season-complete`) and the operator's edit of `in_progress_seasons` make it
  *current*. The settle chains read `in_progress_seasons` (`deploy/afldb-settle-afl-api*.sh`).
- **Q7 doctrine** (acquisition doc §5, amended 2026-09-21, lines ~401–430; §19.3(a)/(b) proven):
  the completed-season re-acquisition corroborates `afl_api`-owned rows and never re-owns them.
  The doc says the rollover runbook itself "remains ISSUE-101/F's own document to update". That
  ownership is now this issue's.

## 2. Discovery vs the ISSUE-231 enumeration (kept separate)

| | Discovery (this issue) | Season enumeration (ISSUE-231) |
|---|---|---|
| Question | Which AFL seasons exist that AFLDB has not registered? | Did this response list every match of a registered season? |
| Input | `compseasons` endpoint | The season's own `00-season-matches.json` |
| Output | A proposed registry diff for a human | A completeness verdict plus the whole feed's provider ids |
| Writes | Nothing (stdout / a proposal file) | Nothing; feeds the settle's rekey scope |

A discovered season proves nothing about completeness, and a complete feed proves nothing about
which seasons exist. The only thing they share is the registry entry: discovery proposes it, and
the enumeration checks every entry against its `providerId` (`foreign_comp_season`).

## 3. Why discovery stops here (source evidence)

The `compseasons` response shape is **not in this repository**:
- no retained bytes (`data/sources/afl_api/` is host-local and gitignored);
- no documented envelope. ISSUE-228 §13.4 names only the endpoint, and says the sample
  `00-compseasons.raw.json` "exists in both sample sets".

Those sample sets are outside this worktree (`D:\dev\afldb-issue-228\data\sources\AFLWebsite\…`,
`D:\dev\testAFLGrab\…`, per ISSUE-228 §22.17). Writing a parser without them would mean assuming
the envelope key, the year field and the competition filter.

**To unblock:** the operator copies one `00-compseasons.raw.json` into
`tests/fixtures/afl_api/seasons/` with its sha256 recorded in this runbook. The tool is then built
and tested against that measured shape. It proposes only years absent from `seasons`, and refuses
(as a finding) any registered year whose ids disagree with the response. Registered entries today:
2022–2026, `compSeasonId` 43/52/62/73/85, `providerId` `CD_S<year>014`.

## 3a. Pass 2 — the measured sample and the discovery tool

**Evidence (operator-authorised read-only inspection of `D:\dev\testAFLGrab`;
`D:\dev\afldb-issue-228` no longer exists):**
- Exactly two `compseasons` files exist, and they are **byte-identical**:
  `AFLGamesSamples\historical-samples\00-compseasons.raw.json` and
  `BrownlowSamples\brownlow-samples\00-compseasons.raw.json`. They were separate live fetches
  2m17s apart (2026-09-19 ~11:48Z / 11:50Z). No structural disagreement, so no stop.
- Provenance: `grab-afl-historical-samples.ps1` lines 11, 14, 125, 128, 131–133 (`GET
  https://aflapi.afl.com.au/afl/v2/competitions/1/compseasons?pageSize=100`, raw `.Content`
  written unchanged); historical `README.txt` lines 3, 19, 22–23.
- Retained as `tests/fixtures/afl_api/seasons/00-compseasons.raw.json`: 1,959 bytes, sha256
  **`fe3f164160e37e0ce5b70ff3f379dc41ce234f2efad6e7f481c1b7443111d965`**, single line, no BOM.
- **Measured shape:** `{meta{code, pagination{page, numPages, pageSize, numEntries}},
  compSeasons[{id, providerId, name, shortName, currentRoundNumber}]}`, 15 entries (2012–2026).
  There is **no year field and no competition field**. The year appears only in `providerId`
  `CD_S<YYYY>014` and in `name` `"<YYYY> Toyota AFL Premiership"`. The request asked
  `pageSize=100`; the response echoes `pageSize: 15` (= `numEntries`).
- Registered 2022–2026 (43/52/62/73/85) all agree with the sample.

**Built against that shape only:**
- `src/lib/acquisition/afl-api-season-discovery.ts`: `parseAflApiCompSeasons()` (complete only when
  `meta.pagination.numEntries` equals the entries, page 0 of 1, and there is at least one entry;
  otherwise a gap, never a guess) and `proposeAflApiSeasons()`:
  - The year is read from BOTH `providerId` and `name`. A disagreement between them is
    `year_disagreement`; an entry that fits neither measured pattern is `unrecognised_entry`.
  - A registered year whose ids differ is **`registered_mismatch`: a finding, never a rewrite.**
    Also reported: `registered_absent_from_listing`, `duplicate_year`,
    `unregistered_within_registered_range`, `listing_incomplete`.
  - Any finding makes the verdict `refused`, and **then nothing is proposed**.
  - Only years newer than every registered year are proposed. Older unregistered years
    (2012–2021 today) are listed as `historicalUnregistered`, never proposed.
  - The proposal carries `identitiesSeasonsAdditions`, the exact `seasons` entries a reviewer
    would add by hand. No clock and no timestamp: the same input gives the same bytes.
- `planAflApiCompSeasonsRequest()` (`afl-api-client.ts`): the measured URL, public base, no token.
- `tools/current-season/discover-afl-api-seasons.ts`:
  `--input <raw> --output <proposal.json>` works offline. `--fetch --save-raw <path> --output
  <proposal.json>` makes one GET, gated by the current-season ingestion switch like
  `acquire-afl-api.ts`, and retains the raw bytes verbatim before reading them. Neither output
  may already exist. Exit 1 on `refused`, still writing the proposal with its findings.
- Against today's registry the real sample yields `no_change`: confirmed 2022–2026, historical
  2012–2021, no finding.

**Tests (DB-free, `tests/afl-api-match.test.ts`):** 15 tests covering the hash binding, the plan
URL, the measured parse, `no_change` on real bytes, a synthetic 2027 proposal (test data,
labelled as such), mismatch refusal, year disagreement and unrecognised entries, incomplete
listing, registered-absent and the in-range gap, determinism, malformed envelopes, and the CLI
(args, `--input` writing no reference data and refusing to overwrite, the `--fetch` gate refusing
before any request, and `--fetch` raw retention bound to its sha256).

**Operator use:** `npx tsx tools/current-season/discover-afl-api-seasons.ts --fetch --save-raw
data/sources/afl_api/seasons/<UTC-stamp>/00-compseasons.raw.json --output
data/sources/afl_api/seasons/<UTC-stamp>/proposal.json` on DEV (database-reachable for the gate).
Review the proposal, then hand-edit `afl-api-identities.json` in a reviewed diff (§4.1 step 1).

## 3b. Pass 3 — discovery audit (no code change)

### 3b.1 Audit against §3a, at base `74d63602`

| Requirement | Where | Verdict |
|---|---|---|
| Measured endpoint shape | `parseAflApiCompSeasons()`; `planAflApiCompSeasonsRequest()` | met |
| Proposal-only | the CLI writes only `--output` and, under `--fetch`, `--save-raw` | met |
| Registered mismatch refuses | `registered_mismatch` finding, nothing proposed | met |
| Year disagreement refuses | `yearOf()`: `providerId` vs `name` | met |
| Incomplete listing refuses | `numEntries`, page 0 of 1, ≥ 1 entry | met |
| Older seasons listed, not proposed | `historicalUnregistered` | met |
| Deterministic output | no clock; `serialiseAflApiSeasonDiscoveryProposal()` | met |
| `--fetch` gated by the ingestion switch | `readAflApiIngestionControls()` before `requestAflApi()` | met |
| Raw bytes retained before parsing | `writeFileSync(saveRaw)`, then read back and hashed | met (see note) |
| Overwrite refusal | `refuseExisting()` for both outputs | met |

Note (LOW in pass 3; **fixed in pass 4**, §4.7.4): `--save-raw` wrote `response.bodyText`
re-encoded as UTF-8. That is the response bytes exactly for valid UTF-8 without a BOM, which every
measured `compseasons` response is (ASCII JSON). A BOM or an invalid sequence would not have
survived verbatim. It now writes the entity bytes themselves.

### 3b.2 The first real DEV discovery (operator, not run)

On DEV, with the switch read from the database (the tool never writes it):

```bash
# DEV: streamanator
cd ~/projects/afldb && hostname
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
npx tsx tools/current-season/discover-afl-api-seasons.ts --fetch \
  --save-raw data/sources/afl_api/seasons/$STAMP/00-compseasons.raw.json \
  --output data/sources/afl_api/seasons/$STAMP/proposal.json
sha256sum data/sources/afl_api/seasons/$STAMP/00-compseasons.raw.json
```

Expected today: `verdict: no_change` (confirmed 2022–2026, historical 2012–2021). A `2027` entry
would be `proposals`; anything else is a finding. Return the stdout, the raw sha256 and the
proposal JSON for review. Nothing in `data/reference/` changes.

## 4. Rollover changes (the ISSUE-101/F items without an owner)

### 4.1 Decided; checklist below

**Onboarding a new AFL API season** (all tracked reference data, all reviewed diffs):
1. `afl-api-identities.json` `seasons.<year>`: `{compSeasonId, providerId}` from the discovery
   proposal (§3), or hand-entered from the `compseasons` response until discovery exists.
2. `source-families.json`: the per-season round vocabulary `afl_api_<year>`, with its
   Opening Round offset (§6.4 round-translation contract). A season without one refuses
   `round_vocabulary_missing`, which is intended.
3. Team and venue maps: any new `CD_T`/`CD_V` shows up as `unmapped_team` (a build failure) or
   `venueProviderUnmapped` (finding) on the first settle, and is added by hand.
4. Proof: `settle-afl-api.ts --label <first snapshot> --validate-only` builds without failures
   and prints `Season feed CD_S<year>014: … complete`.

**Rollover ordering for the completing season:**
1. Last AFL API match settle and the Brownlow completed-count settle, both while the season is
   still in `in_progress_seasons`. The season gate refuses them afterwards.
2. `rollover-season.ts`: dry run, then `--apply --acknowledge-season-complete`, with the reviewed
   `--stat-availability` document moving the season's `brownlow_*` rows from `pending` to
   `complete` (2026 is `pending` today for `brownlow_match_votes` and `brownlow_round_votes`).
   Since D-233-3 it **requires** `--afl-api-ownership-census <file>` (repeatable), the evidence
   `tools/db/afl-api-ownership-census.ts --through-season <completing season> --out <file>` writes
   (§4.4.3). Take it on `afldb_test` and on the live database before the dry run.
3. Advance `in_progress_seasons` to the new season only after its onboarding (above) is merged.

### 4.2 Operator decisions

- **D-233-1 — discovery output form.** A proposal JSON file, or a printed unified diff of
  `afl-api-identities.json`. Either way, nothing is applied automatically.
- **D-233-2 — loading the AFL API Brownlow season-totals artefact.**
  `build_brownlow_season_artefact_from_afl_api.py` writes a season-scoped
  `data/brownlow/season-votes-afl_api-<season>.csv` plus its own manifest. Its header states that
  merging it into the master `data/brownlow/season-votes.csv` "is a rollover decision, deliberately
  out of scope". Options: (a) merge the season's rows into the master artefact and re-bind the
  master manifest; (b) teach the rebuild's Brownlow season load to read season-scoped AFL API
  artefacts beside the master. The gate is the reviewed `stat-availability` transition in §4.1
  step 2. Undecided; the rollover runbook cannot name the step until it is.
- **D-233-3 — an `afl_api`-owned season across a rebuild.** `rollover-season.ts` performs no
  canonical write. Completed seasons are superseded "the one way they already are: by
  `npm run db:test:rebuild`" from the fitzRoy baseline. A rebuild recreates the season's
  `matches` as AFL Tables rows, which cannot honour Q7's "never re-own" for any row `afl_api`
  owned first. This is moot for 2026 (0 `afl_api`-owned matches, ISSUE-244 F031). It needs a rule
  before any season in which `afl_api` owns rows is rolled over. For example: the rebuild
  replays `afl_api` ownership, or the operator records the ownership transfer with ledger rows.

### 4.3 Pass 2 — plans for the decided D-233-2 / D-233-3 (not implemented)

**D-233-2 (season-scoped artefacts beside the master):**
1. `tools/migration/import_brownlow_season.py` today loads only `data/brownlow/season-votes.csv`
   (`ARTEFACT_PATH`/`MANIFEST_PATH`, lines 86–87). It reads `stat_availability` `coverage =
   'complete'` seasons (line ~614). Extend it to also discover
   `data/brownlow/season-votes-afl_api-<season>.csv` plus each file's own manifest (written by
   `build_brownlow_season_artefact_from_afl_api.py`), verify each manifest hash, and load a
   season's AFL API rows only when that season's `brownlow_*` rows are `complete` in the reviewed
   `stat-availability` document.
2. Refuse a season present in BOTH the master and an AFL API artefact (no silent precedence).
3. Bind the extra artefacts into `tools/db/rebuild-test.ts`'s tracked-input list (lines ~259,
   ~410) so a rebuild's evidence names them.
4. Tests: the existing Python Brownlow contract suite plus `tests/db-test-rebuild.test.ts`.

**D-233-3 (fail closed on `afl_api`-owned rows):**
1. A pre-rebuild census (read-only, on the database being superseded) counts `matches` with
   `source_id = afl_api` per completed season in the rebuild's scope. Any non-zero count refuses
   the rebuild, naming seasons and counts. The natural home is the rebuild's existing preflight in
   `tools/db/rebuild-test.ts`, with the same message in `rollover-season.ts`'s review output.
2. 2026 is expected to pass (0 `afl_api`-owned rows, ISSUE-244 F031). The refusal lifts only
   with an ownership-replay design, which is a separate future change.

### 4.4 Pass 3 — D-233-3 implemented

**4.4.1 One census, three callers.** `src/lib/rollover/afl-api-ownership-census.ts` (pure) defines the
census once:
- scope: `rebuildCensusScope()` = the fitzRoy contract's `full_history.season_range` minus every
  season `seasons.json` declares in progress or the contract declares `current_season_excluded`
  (today **1897..2025 excluding 2026**); `rolloverCensusScope()` = the same first season through
  the completing season, which is in progress today and therefore deliberately included;
- SQL: one `SET TRANSACTION READ ONLY` stream counting `matches` joined to `sources.key = 'afl_api'`
  per season, every count a `RAISE WARNING` line. `enforce` ends in `RAISE EXCEPTION` naming every
  in-scope season and count; `report` emits a verdict line. (Pass 3: a database without `matches`,
  `sources` or `matches.source_id` passed as `schema_absent`. Pass 4 narrows this: only "no
  `matches` table" is `schema_absent`, and a damaged schema refuses, §4.7.3.)
- `parseCensusOutput()`, `refusalMessage()`, `censusRecord()` / `readCensusRecord()`: the evidence
  is re-validated and its verdict recomputed from its counts, never trusted.

**4.4.2 The rebuild (`tools/db/rebuild-test.ts`).** New stage `afl-api-ownership-census`
(`kind: validation`, `run: validate`, through the existing read-only `runValidation` psql path),
**second in every plan**: after PRECHECK, before `afl-api-adjudications-capture` (which writes the
rebuild marker) and before `recreate`. A refusal therefore leaves nothing captured, marked or
destroyed, and the CLI reports it as a refusal of an untouched database. No option skips or
weakens it. The ISSUE-237 rehearsal prefix is now PRECHECK → census → capture → recreate. The banner
prints the scope. The runner imports the census through `tools/db/afl-api-ownership-census.ts`
(re-export), because its interpreter guard forbids any parent-relative path in its source.

**4.4.3 The rollover.** `tools/db/afl-api-ownership-census.ts --database <db> --dsn-env <VAR>
[--through-season <Y>] [--out <file>]` is a read-only operator command (exit 0 pass, 1 refuse,
2 not taken); the database is named twice and must equal `current_database()`. It never overwrites
evidence. `rollover-season.ts` now **requires** `--afl-api-ownership-census <file>` (repeatable,
one per database). The planner (stage one, before any validator runs) refuses evidence that is not
for exactly `first..<completing season>`, is of a database without the schema, repeats a
database, is internally inconsistent, or counts any `afl_api`-owned match in scope. That is the
same condition and wording the rebuild enforces. A passing census lands in the plan notes. The
rollover still opens no database connection.

**4.4.4 Not proven DB-free.** That the SQL counts the right rows needs PostgreSQL.
`tests/integration/afl-api-ownership-census.test.ts` is the rollback-only proof: it re-owns a
few matches inside one `--single-transaction` psql stream that always ends in a sentinel
exception, and asserts deltas over a baseline census (per-season counts, other sources ignored,
an excluded season reported outside the scope, the enforcing form's refusal text). Not run in
pass 3 (this worktree has no `.env`). **Run in pass 5: 5/5 PASS on `afldb_test`, no residue**
(§4.8.2).

**4.4.5 Promotion gap (found in pass 3, CLOSED in pass 4, §4.7).** The rebuild census reads only
the database the rebuild resets (`afldb_test` / `code_test_db`). Rows the live AFL API settle owns
in `afldb_dev` / `afldb_prod` are superseded by the later **promotion** of the rebuilt source.
The promotion's ISSUE-252 dependency gate checks owner parity only for F1/F2/F3 rows. The
promotion checker now enforces D-233-3 on the live target itself.

### 4.5 Pass 3 — D-233-2 implemented

**4.5.1 Loader (`tools/migration/import_brownlow_season.py`).** The keys, as measured on main:
`stat_availability` `brownlow_season_total` (complete 1924–1941, 1946–2025; 2026 `pending`), and
builder manifest `schema_version` 2 with `source_key: afl_api`.
- `discover_afl_api_artefacts()` reads exact names only
  (`season-votes-afl_api-<YYYY>.csv` / `.manifest.json`), in ascending season order. Any other
  name under the prefix, or half a pair, refuses.
- `load_afl_api_artefact()` checks the artefact against **its own** manifest: schema 2,
  `source_key`, season = filename, `artefact.file`, columns = `HEADER`, coverage `[[s, s]]`,
  `csv_sha256` and every measured count. The rows go through the same strict `load_artefact()`
  as the master. There must be a winner and one path per player.
- An artefact is loaded only when its season is `complete` for `brownlow_season_total` in the
  reviewed `data/reference/stat-availability.json`. Pending or absent refuses, in line with the
  existing contract that a pending season never reads as decided; it is never skipped.
- A season in both the master and an AFL API artefact refuses. There is no precedence.
- The DB phase writes the master rows and the AFL API rows in one transaction and one COPY:
  - the AFL API rows get `source_id = afl_api` and their own import batch (notes name the files);
  - `check_database_coverage()` is unchanged, applied to the union of seasons;
  - after the write it re-checks the combined counts and NULL counts, and checks that the
    `afl_api` rows sit exactly in the artefact seasons.
- `--validate-only` JSON gains `afl_api_artefacts` (per artefact: season, both sha256s, snapshot
  label, counts). That list is `[]` today.
- `--afl-api-dir` / `--stat-availability` are test seams, accepted only with `--validate-only`.
- With no artefact, nothing new is read, and the master-only load and its output are unchanged.

**4.5.2 Rebuild binding (`tools/db/rebuild-test.ts`).**
- `brownlowAflApiSeasonArtefacts()` probes the exact filename for every tracked season. The runner
  never lists a directory: its no-"latest label" guard forbids it, and the loader's own
  `--validate-only` in PRECHECK refuses stray names.
- `brownlowSeasonPreflightFiles()` binds each pair into PRECHECK. The `brownlow-season` stage name
  names them.
- `brownlowSeasonExpected()` adds their rows, votes, winners and seasons. Stage 9 then expects:
  - `brownlow_season_rows_not_sourced_from_afltables` = the AFL API rows;
  - new `brownlow_season_rows_sourced_from_afl_api` = the AFL API rows;
  - new `brownlow_season_afl_api_rows_outside_artefact_seasons` = 0.
- With none, every constant, the stage name and the check list are byte-identical.

**4.5.3 Rollover step (replaces the §4.2 D-233-2 open question).**
1. After the Brownlow count, while the season is still in progress, build
   `season-votes-afl_api-<Y>.csv` and its manifest with
   `build_brownlow_season_artefact_from_afl_api.py --write`.
2. Commit them in the same reviewed change as the rollover, whose reviewed `--stat-availability`
   moves `brownlow_season_total` `<Y>` from `pending` to `complete`. Committed earlier, the next
   rebuild refuses, by design.

**4.5.4 Not proven.** The DB phase has not been run against a database.

### 4.6 Remaining before resolution (operator)

1. Review and commit this pass. (Final review DONE in pass 5, §4.8.4; the commit is the
   operator's.)
2. **DONE (pass 5):** the rollback-only census proof against `afldb_test`
   (`npx vitest run tests/integration/afl-api-ownership-census.test.ts`): 5/5, no residue (§4.8.2).
3. **DONE (pass 5):** a read-only census of the current rebuild scope on `afldb_test` and
   `afldb_dev`; both PASS (§4.8.3):
   `npx tsx tools/db/afl-api-ownership-census.ts --database afldb_test --dsn-env AFLDB_TEST_DATABASE_URL`.
4. Run the first real DEV discovery (§3b.2) and review its output. **Not run.**
5. Exercising D-233-2's DB phase needs a real season artefact plus `complete` availability. That
   happens naturally at the 2026 rollover, or as a deliberate `code_test_db` rehearsal; either
   needs its own authorisation.
6. (Pass 4) The promotion gate's first live read happens on the next promotion's `--phase
   dependencies`. Expected today: PASS on `afldb_dev` and `afldb_prod`, with 2026 reported outside
   scope. Before that, the step-3 censuses predict the result.

§4.4.5 is no longer an open decision: pass 4 closed it (§4.7).

### 4.7 Pass 4 — D-233-3 on the live promotion target; census and discovery hardening

**4.7.1 Root cause of the gap.** D-233-3 was enforced where a rebuild destroys rows, and in the
rollover evidence. A live database's rows are destroyed by the promotion swap, not by the rebuild.
The promotion checker had no ownership rule beyond ISSUE-252's F1–F3 owner parity. No candidate
can carry completed-season `afl_api` ownership:
- the rebuild recreates completed seasons as AFL Tables rows, and refuses to reset a database
  holding such ownership;
- §3a prepares only the in-progress season.

So a live target holding completed-season `afl_api` ownership would have been re-owned silently by
a supported path.

**4.7.2 The permanent gate (`tools/db/promotion-check.ts`).**
- `gateAflApiOwnership()` (gate `afl_api completed-season ownership on the live target
  (AFLDB-ISSUE-233 D-233-3)`) runs the shared census queries on the target connection only.
- Its scope is `promotionOwnershipCensusScope()` = `rebuildCensusScope()` of the same tracked
  documents (today 1897..2025, 2026 excluded). The scope is read before any database is opened.
- It runs unconditionally at `AFL_API_OWNERSHIP_PHASES`:

| Phase | Database read | Why there |
|---|---|---|
| `dependencies` | `--database` (live), before manifest A/B is written | Earliest refusal, before the preparation, freeze and backup. No manifest A, so `--phase source` cannot run. |
| `pre-cutover` | `--database` (live, frozen under PROD), after the freeze gate | The definitive freeze-bound check, re-derived live rather than from any file. |
| `restored` | `--old-database` (the target) | Before any reinstatement. |
| `candidate` | the live name, always opened, frozen or not | The last read before the swap. |
| `production` (with `--freeze-record`) | the kept `…_pre_rebuild_<stamp>` | Closes the last-check-to-swap gap as F0 does. A FAIL refuses acceptance, and §10's rollback returns that untouched database. |

- FAIL in each of these cases, every one before the swap except the `production` backstop:
  - any completed-season `afl_api`-owned match (each season named with its exact count);
  - no `matches` table;
  - a damaged schema;
  - `current_database()` other than the one named.
- In-progress ownership is reported on an "outside scope" line and never blocked.
- With zero affected rows the gate adds one PASS line and changes nothing else. Manifest A's
  dependency content is unchanged (proven).
- No option, flag or file exists to skip or weaken it.
- Why it is race-safe:
  - every phase re-reads live state; none trusts an earlier result or a file;
  - under the freeze, only owner and superuser sessions can write between `pre-cutover` and the
    swap;
  - the AFL API settle's season gate never writes a completed season;
  - the kept-database read at `production` catches anything in the final gap.
- Residual, unchanged from ISSUE-250: an unfrozen DEV promotion (the DEV freeze is opt-in) has no
  kept-database backstop, because `--old-database` at `production` needs a freeze record. Its last
  check is `candidate`.
- Why ISSUE-252's dependency manifest was not extended:
  - it is a match_key owner-PARITY set for F1–F3 dependencies, and D-233-3 is an unconditional
    refusal;
  - its frozen re-check is opt-in on DEV;
  - the protection must not depend on an operator-supplied file.

**4.7.3 No-schema census conclusion.**
- In pass 3, a database whose `matches` table existed without `sources` or `matches.source_id`
  read as `schema_absent` and passed. That was a false-PASS path for a **damaged** database. It now
  refuses in every form (SQL `RAISE EXCEPTION`; TypeScript `judgeCensusRows()`).
- `schema_absent` now means only "no `public.matches`", which holds no canonical match.
- Only the rebuild treats it as a pass, and only for the database it is about to reset:
  - `resolveTarget()` requires the admin DSN to name the selected target, and the census stage
    runs on that DSN;
  - the very next stage's D11b marker and pending-capture decision table
    (`rebuild_afl_api_adjudications.ts`) is the existing contract that tells a genuinely-empty
    database from a destroyed one;
  - in that database there are no rows left whose ownership the reset could convert.
- A database expected to hold canonical state cannot satisfy a safety census by being empty:
  - the rollover refuses `schema_absent` evidence (§4.4.3);
  - the promotion gate refuses a live target without the table;
  - the CLI prints `ABSENT` and records `schema_present: false`, which the rollover then refuses.
- Tests:
  - `db-test-rebuild.test.ts` ("no-schema census …"): the stream's branches and
    `judgeCensusRows()`;
  - `db-promotion-check.test.ts`: absent, damaged and wrong database each FAIL.
- The rollback-only integration proof does not exercise a damaged schema (it ran 5/5 in pass 5,
  §4.8.2); the damaged-schema branches are proven DB-free only.

**4.7.4 Discovery raw bytes.**
- `discover-afl-api-seasons.ts --fetch` wraps the fetch it hands to the unchanged
  `requestAflApi()`. The wrapper takes `response.clone().arrayBuffer()` of the one response the
  client accepts.
- It writes those bytes to `--save-raw`, reads the file back and refuses unless the bytes are equal.
  Only then does it decode them, through a fatal UTF-8 `TextDecoder`: a BOM is dropped as
  `text()` drops it, and an invalid sequence refuses. `--input` uses the same decoder.
- Unchanged:
  - the overwrite refusal;
  - the ingestion gate before any request;
  - the networking (one GET, the same plan and retry);
  - the ASCII fixture result (byte-identical, same sha256).
- A new test serves a BOM + trailing-CRLF body and an invalid-UTF-8 body. The previous
  implementation fails it; this one passes.

**4.7.5 Rollover caller audit.**
- `rollover-season.ts` has no npm script and no `deploy/` or `.claude/workflows/` reference. No
  `docs/` page or README invokes it.
- Its references are:
  - its own usage block (already passes the flag);
  - this runbook (§4.1 step 2 now names the census step);
  - historical ledger entries (ISSUE-101, ISSUE-161 closed record; left as history);
  - `tests/season-rollover.test.ts`. Its `complete` argv already carries the flag. The
    banned-flag test's base did not, and now does, so that refusal is proven to be the banned
    flag's alone.
- The flag stays mandatory.

### 4.8 Pass 5 — live-safe validation and final review (2026-10-01)

Operator-authorised, from the Windows workstation over the `127.0.0.1:55432` tunnel to the DEV
host. Every DSN was loaded into the process environment only (never printed, never written to a
tracked file). Nothing was staged or committed.

**4.8.1 DB-free baseline (operator-accepted).**
- Worktree full DB-free run: 7,282 passed, 13 failed, 33 skipped.
- The same failing files run at exact HEAD `74d63602` give 13 failed, 593 passed, 3 skipped. The
  failing-file and failing-test lists are identical, so none is new to ISSUE-233.
- The one failing suite that imports an ISSUE-233-touched module fails in unrelated, unchanged
  source, and fails identically at HEAD.

**4.8.2 Rollback-only integration proof (`afldb_test`).**
- Target proven before the run: `current_database=afldb_test`, `transaction_read_only=on`, role
  `afldb_owner`. Every test-suite DSN resolved to database `afldb_test`.
- `npx vitest run tests/integration/afl-api-ownership-census.test.ts`: **5/5 passed**, 1 file.
- Residue check: a read-only snapshot was taken before and after the run. It covered:
  - `matches` total;
  - an md5 over `id:source_id` for 2023–2025;
  - per-season counts by source for 2023–2026;
  - the `afl_api` total.
- The two snapshots are byte-identical (sha256 `5ced2355…ce645`): 16,838 matches, md5
  `c4ab7b7c…dadfc`, 216 `afltables` matches in each of 2023/2024/2025, `afl_api` total 0.
  **No residue.**

**4.8.3 Read-only censuses (current rebuild scope, `--out` evidence).** Both use the reporting form
inside one `SET TRANSACTION READ ONLY` psql stream, census SQL sha256
`f13e5b733b79e4a2eee0cff0ac33586a6105aa232bfbb5ae83581cb8c4b5bebf`.

| Database | Proof before the census | Scope | Result | Evidence sha256 |
|---|---|---|---|---|
| `afldb_test` | `current_database=afldb_test`, `transaction_read_only=on` | 1897..2025 excl. 2026 | schema present; in scope none; outside scope none; **PASS**, exit 0 (captured 2026-10-01T03:25:26Z) | `c49dca22…f71b` |
| `afldb_dev` | `current_database=afldb_dev`, `transaction_read_only=on`, app role | 1897..2025 excl. 2026 | schema present; in scope none; outside scope none; **PASS**, exit 0 (captured 2026-10-01T03:25:38Z) | `a588d6e6…5171` |

- `afldb_dev` before/after snapshots (same read-only query as §4.8.2) are byte-identical (sha256
  `0cfd4a14…d3c9`):
  - 17,055 matches;
  - 2023–2025 md5 `c4ab7b7c…dadfc`, the same as `afldb_test`;
  - 2026: 217 `afltables` matches;
  - `afl_api` total 0.

  **DEV was not mutated.**
- Evidence retention: the convention of recent issues (ISSUE-221 to ISSUE-254) is inline runbook
  evidence, with no tracked evidence files. The two census JSON records and the four snapshot files
  held no DSN, credential, role or host. They stay untracked, and their results and hashes are
  recorded here. They are **current-rebuild-scope** censuses. A rollover's
  `--afl-api-ownership-census` needs fresh evidence taken with `--through-season <completing
  season>`.
- Neither database holds an `afl_api`-owned canonical match in **any** season, so the next rebuild
  and the next promotion are predicted to pass D-233-3. Ownership by in-progress 2026 would only be
  reported, never blocked.

**4.8.4 Final pre-merge review.** Every changed and new file was read in full. No code changed;
`docs/deployment.md`'s stage table gained the census stage.

| # | Grade | Finding | Disposition |
|---|---|---|---|
| R1 | LOW | `docs/deployment.md`'s fixed rebuild stage table omitted the new `afl-api-ownership-census` stage, and did not mention the season-scoped AFL API Brownlow artefacts at `brownlow-season`. | **Fixed (doc only).** The census is row `1a`, so the "Stage 2 = capture" references in code and docs keep their numbers. The table already lacked ISSUE-249's `first-kick-goal` stage before this issue; left as is (out of scope). |
| R2 | LOW | The census CLI prints `PASS` (exit 0) for a database with **no** `matches` table. It also prints `schema ABSENT` and records `schema_present: false`. | Accepted, no change. The rollover refuses such evidence and the promotion gate refuses such a target. Only the rebuild treats absence as a pass, for the database it resets (§4.7.3). |
| R3 | LOW | The rollover accepts census evidence of any database name, with no capture-time freshness bound. | Accepted, no change. The rollover evidence is a review artefact; enforcement is the rebuild's own pre-reset stage and the promotion gate, which both re-read live state. |
| R4 | LOW | Follow-up interaction with ISSUE-238 (resolved). `classifySeasonTotals()` (`tools/migration/correct_afl_api_identity.ts`) treats a season-total row that is not `afltables`/`manual_admin_edit` as `unprovable` (SV-3). | Once a D-233-2 AFL API season artefact is loaded (first at the 2026 rollover), an identity correction touching that season **refuses** rather than mis-applying: fail-closed. Recorded here; revisit at the rollover. |
| R5 | INFO | `AFL_API_PLAYER_REFERENCE_MANIFEST`'s reason text for `brownlow_season_votes` (`src/lib/acquisition/afl-api-adjudication.ts`) still says the loader writes only `afltables` rows. | The class `LINK_INDEPENDENT` stays correct: AFL API season rows resolve players through the AFL Tables profile path, never an `afl_api` link, and runtime code branches only on `LINK_DEPENDENT` and `NOT_SOURCE_BEARING`. Reason text left unchanged (manifest data owned by ISSUE-235/237); revisit with R4. |
| R6 | INFO | Unfrozen DEV promotions have no kept-database backstop; their last ownership check is `candidate`. | Already recorded as an ISSUE-250 residual (§4.7.2). PROD requires the freeze. |

Areas confirmed with no finding:
- **D-233-3:**
  - the census runs second in every plan, on `target.adminDsn`, before the capture marker and the reset;
  - no option or flag skips it;
  - the promotion gate reads only the live target, at `dependencies`, `pre-cutover`, `restored`,
    `candidate` and frozen `production`;
  - `dependencies` writes no manifest after a FAIL;
  - the scope is derived from the tracked contract and in-progress seasons stay excluded;
  - every affected season is named with its count;
  - rebuild, CLI, rollover and promotion share one SQL definition;
  - the ISSUE-238/250/252 gates are unchanged (the `candidate` freeze gate is still freeze-only).
- **D-233-2:**
  - discovery uses exact names, in ascending order, with pairs required;
  - stray or partial files refuse;
  - each artefact is verified against its own manifest: schema, `source_key`, season, columns,
    coverage, hash and every count;
  - a pending season refuses, and a master/AFL API overlap refuses;
  - rows are written with `source_id = afl_api` and their own batch;
  - the preflight, stage name and Stage-9 binding are covered;
  - with no artefact the run is unchanged (proven).
- **Discovery:**
  - the entity bytes are retained and read back equal before decoding;
  - the overwrite refusal and the ingestion gate are unchanged;
  - no registry or season state is written.
- **Compatibility:**
  - no rehearsal fixture seeds completed-season `afl_api` matches (the correction rehearsal uses
    season 2092);
  - no npm script, deploy unit or doc invokes `rollover-season.ts`.
- **Hygiene:** no credentials in the diff beyond the existing dummy-DSN test idiom, and no junk files.

## 5. Dependencies

- ISSUE-229 needs the next season registered (§4.1 step 1) to acquire its pre-match feed.
- The ISSUE-231 enumeration is the proof step for a newly registered season (§4.1 step 4).

## 6. Files changed (this pass, for this issue)

This runbook only.

Pass 2:
- **N** `src/lib/acquisition/afl-api-season-discovery.ts`
- **N** `tools/current-season/discover-afl-api-seasons.ts`
- **N** `tests/fixtures/afl_api/seasons/00-compseasons.raw.json` (authentic, sha256 above)
- **M** `src/lib/acquisition/afl-api-client.ts` (`planAflApiCompSeasonsRequest()`)
- **M** `tests/afl-api-match.test.ts` (discovery suite)

Pass 3 (2026-10-01):
- **N** `src/lib/rollover/afl-api-ownership-census.ts`
- **N** `tools/db/afl-api-ownership-census.ts`
- **N** `tests/integration/afl-api-ownership-census.test.ts` (rollback-only; not run)
- **M** `tools/db/rebuild-test.ts`, `src/lib/rollover/season-rollover.ts`, `tools/db/rollover-season.ts`
- **M** `tools/migration/import_brownlow_season.py`
- **M** `tests/db-test-rebuild.test.ts`, `tests/season-rollover.test.ts`,
  `tests/brownlow-season-artefact.test.ts`, `tests/python/afl_api_brownlow_season_artefact_contract.py`
- **M** this runbook, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`

Pass 4 (2026-10-01):
- **M** `src/lib/rollover/afl-api-ownership-census.ts`: the shared schema/count queries,
  `judgeCensusRows()`, damaged-schema refusal, promotion wording.
- **M** `tools/db/promotion-check.ts`: `gateAflApiOwnership()` and its phase wiring.
- **M** `tools/current-season/discover-afl-api-seasons.ts`: entity-byte retention.
- **M** `docs/production-promotion.md`: §2 gate description.
- **M** `tests/db-promotion-check.test.ts`, `tests/db-test-rebuild.test.ts`,
  `tests/afl-api-match.test.ts`, `tests/season-rollover.test.ts`.
- **M** this runbook, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.

Pass 5 (2026-10-01, validation and review; no code change):
- **M** `docs/deployment.md`: rebuild stage table, census stage `1a`, `brownlow-season` row.
- **M** this runbook (§4.8), `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.
