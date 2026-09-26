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
