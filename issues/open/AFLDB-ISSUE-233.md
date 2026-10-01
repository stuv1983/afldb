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

**State after pass 6 (2026-10-01, implementation committed at
`f0abbb4ca8502862946770a7b444784b2daf8a4c`; this pass changes tracking files only, uncommitted):**
- **First real DEV discovery: PASSED** (operator-run, §3b.3). One live fetch, HTTP 200,
  `verdict: no_change`. The offline replay of the retained body gives a byte-identical proposal.
  `afldb_dev` is byte-identical before and after, the registry is unchanged, and
  `in_progress_seasons` is still `[2026]`.
- **D-233-2 write path: `code_test_db` rehearsal DESIGNED, not run, not written** (§4.9). It needs
  no production code change. It is blocked on inputs: a stable-identity (ISSUE-241) bridge and the
  retained 2026 Brownlow snapshot (§4.9.2).
- **R4: classified A, an acceptable fail-safe boundary** (§4.10). No successor issue is needed.
- No database was contacted in this pass. PROD is untouched.

**State after passes 7–9 (2026-10-01, on `f0abbb4c`, uncommitted)** (§4.11):
- **Pass 7:** fresh CONCLUDED 2026 Brownlow snapshot acquired. The `afldb_test` bridge emit linked
  **0/669** because `afldb_test` holds no 2026 matches, so §4.9.2's premise is false today.
- **Pass 8:** operator option A. A DEV read-only bridge was emitted (**669/669**, v1 contract). The
  builder then refused DEV player 6519 (`Jack_Ross.html` + `Jack_Ross3.html`), because it ignored
  the tracked fitzRoy continuity rules.
- **Pass 9:** builder continuity defect **FIXED** (DB-free validated, plus a TS↔Python parity
  test).
  - The real builder ran read-only on DEV: **183/183**, with Jack Ross folded to
    `players/J/Jack_Ross.html`. The artefact was written outside the repo, and the second write was
    `unchanged`.
  - **`code_test_db` coverage: INCOMPLETE, 175/183.** Eight paths are absent and `code_test_db`
    holds no 2026 matches. **Harness NOT written.**
- No database was mutated. PROD was not contacted.

**State after pass 10 (2026-10-01, on `f0abbb4c`, uncommitted)** (§4.11.8–§4.11.13):
- **Decision D-233-R (operator):** the rehearsal prerequisite is a SCOPED `code_test_db` fixture of
  exactly the eight missing 2026 vote-getters' canonical identities. `code_test_db` is NOT rebuilt or
  restored to obtain 2026. The fixture is rehearsal-only and changes neither the rebuild nor the
  current-season architecture.
- **Harness WRITTEN, NOT RUN:** `tools/migration/brownlow_afl_api_season_rehearsal.py`
  (`run` / `restore` / `residue`), with the eight-player fixture as an explicit, journaled setup
  phase inside the exact-restore contract.
- **DB-free tests:** `tests/python/brownlow_afl_api_season_rehearsal_contract.py` **113/113 PASS**.
  The builder's suites still pass (157/157, 35/35).
- **9982 / 9983 explained** (§4.11.11): the one snapshot row without a canonical PMS row is an
  unused emergency (`CD_I993799`, Brayden Fiorini, `CD_M20260140305`, position `EMERG`, 0% time on
  ground). That is expected source semantics, not an acceptance gap.
- New Ruff import-order finding in the builder fixed; the `correct-afl-api-identity-cli` failure is
  proven baseline (§4.11.12). The three stray files were deleted.
- `code_test_db`, DEV and `afldb_test` were not contacted in this pass. PROD was not contacted.
  ISSUE-233 stays **OPEN** until the `code_test_db` rehearsal actually runs.

**State after pass 11 (2026-10-01, HEAD `f0abbb4c` throughout, uncommitted)** (§4.11.14):
- **D-233-2 write path: `code_test_db` rehearsal PASSED, exact restore PASSED** (operator-authorised,
  one bounded run). Evidence: `D:\tmp\issue233\rehearsal-20261001-151415\`.
  - The fixture seeded 8 + 8 rows, and the real resolver then gave 183/183. The DB refusals D1 and
    D2 wrote nothing. Both real loads PASSED. The second load is content-identical and replaces the
    rows and batches.
  - After the restore, a fresh-session fingerprint equalled F0 (`47190a7c…83b2`). Residue was 0 in
    the run and again in a separate `residue` invocation. Coverage is back to 175/183 with the same
    eight unresolved.
- Case 5 (duplicate season) was **NOT RUN**: no genuine master-season AFL API pair exists. Its
  refusal is proven DB-free only. **Not every negative case was live DB-validated.**
- The harness gained two stricter checks before the run: the owner role must be `afldb_owner` and
  neither session may default to read-only; and the post-restore 175/8/0 shape must hold in a fresh
  session.
- DEV, `afldb_test` and PROD were not contacted. Nothing was staged or committed. **ISSUE-233 stays
  OPEN** until the implementation and validation diff is reviewed and committed.

**State after pass 12 (2026-10-01, final review; committed with this text on `sonnet/issue-233`,
parent `f0abbb4c`)** (§4.11.15):
- **Final review: CRITICAL 0, HIGH 0, MEDIUM 2 (both fixed, DB-free validated), LOW 1 (fixed).**
  - M-1: the continuity provenance is now validated (`verify_continuity_provenance()`).
  - M-2: manifest paths are now POSIX, so a Windows-built manifest loads on a Linux rebuild.
- Passes 6–12 are committed together. **Status: OPEN.** Remaining: the operator merges the branch,
  and the promotion gate's first live read happens at the next promotion (§4.6 item 6).

**State after merge (2026-10-01):**
- `f0abbb4c` and `cc1a5f2d` are merged; `main` is at `cc1a5f2d`. No merge is pending.
- **Status: OPEN.** **Next action:** the promotion gate's first live read at the next promotion
  (§4.6 item 6). Do not run a promotion merely to close this issue.

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

### 3b.2 The first real DEV discovery (operator; run in pass 6, evidence in §3b.3)

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

### 3b.3 Pass 6 — first real DEV discovery: PASSED (operator-run, recorded as reported)

| Item | Value |
|---|---|
| Implementation | `f0abbb4ca8502862946770a7b444784b2daf8a4c` |
| UTC stamp | `20261001T034039Z` |
| Endpoint | `GET /afl/v2/competitions/1/compseasons?pageSize=100` |
| HTTP status | 200 |
| Live fetches | exactly one |
| Retained body | `data/sources/afl_api/seasons/20261001T034039Z/00-compseasons.raw.json`, 1,959 bytes |
| Retained-body sha256 | `2aeed4e9fb633926de647346d60ff435d2b314754a8ec3f3c8138df9a437b33e` |
| Proposal | `data/sources/afl_api/seasons/20261001T034039Z/proposal.json` |
| Proposal sha256 | `6eb9c73727d5927e06ba9d5eb7bf675beca2d9676dad7555590f6ec698bc5974` |
| Listing | page 0 of 1; 15 of 15 entries; seasons 2012–2026 |
| Registered, confirmed | 2022–2026 |
| Historical, unregistered | 2012–2021 |
| Proposals | none |
| Findings | none |
| Verdict | `no_change` |
| Offline replay (`--input` on the retained body) | byte-identical proposal, zero network calls |
| Ingestion-gate connection | `afldb_dev`, read-only, as `afldb_app` |
| `afldb_dev` before / after | byte-identical |
| Registry (`afl-api-identities.json`) | unchanged |
| `in_progress_seasons` | still `[2026]` |
| PROD | untouched |

**What "raw bytes" means here.** The 1,959 retained bytes are the response-body bytes the
application receives, after HTTP transport and content decoding. They are kept byte-for-byte,
before any JSON decoding (§4.7.4). They are **not** claimed to be the compressed wire
representation. The response's `Content-Length` was 336, and its `content-encoding` header was not
captured. "Entity bytes" in §4.7.4 and earlier passes means these decoded body bytes.

The retained files sit under `data/sources/`, which is gitignored. As in §4.8.3, they stay
untracked, and their hashes are recorded here. The result matches §3b.2's expectation. No 2027
entry was listed, so nothing is proposed for onboarding yet.

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
   operator's.) **Passes 1–5 committed as `f0abbb4c`. Passes 6–12: final review DONE in pass 12
   (§4.11.15) and committed on `sonnet/issue-233` as `cc1a5f2d`. DONE (2026-10-01): both commits
   merged; `main` at `cc1a5f2d`.**
2. **DONE (pass 5):** the rollback-only census proof against `afldb_test`
   (`npx vitest run tests/integration/afl-api-ownership-census.test.ts`): 5/5, no residue (§4.8.2).
3. **DONE (pass 5):** a read-only census of the current rebuild scope on `afldb_test` and
   `afldb_dev`; both PASS (§4.8.3):
   `npx tsx tools/db/afl-api-ownership-census.ts --database afldb_test --dsn-env AFLDB_TEST_DATABASE_URL`.
4. **DONE (pass 6):** the first real DEV discovery (§3b.2). It returned `no_change`; evidence is in
   §3b.3.
5. Exercising D-233-2's DB phase needs a real season artefact plus `complete` availability. That
   happens naturally at the 2026 rollover, or as a deliberate `code_test_db` rehearsal; either
   needs its own authorisation. **Pass 6:** the `code_test_db` rehearsal is designed (§4.9). Its
   harness is not yet written, and it is blocked on the inputs in §4.9.2. **DONE (pass 11):** the
   `code_test_db` rehearsal PASSED and restored exactly (§4.11.14). Case 5 was not run live
   (DB-free only).
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
- Terminology (pass 6): `arrayBuffer()` returns the body **after** content decoding. "Entity bytes"
  here means those decoded body bytes, not the possibly compressed wire bytes (§3b.3).

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
| R4 | LOW | Follow-up interaction with ISSUE-238 (resolved). `classifySeasonTotals()` (`tools/migration/correct_afl_api_identity.ts`) treats a season-total row that is not `afltables`/`manual_admin_edit` as `unprovable` (SV-3). | Once a D-233-2 AFL API season artefact is loaded (first at the 2026 rollover), an identity correction touching that season **refuses** rather than mis-applying: fail-closed. Recorded here; revisit at the rollover. **Pass 6: classified A, an acceptable fail-safe boundary; no successor issue (§4.10).** |
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

### 4.9 Pass 6 — D-233-2 `code_test_db` write-path rehearsal (DESIGNED; written in pass 10 with the §4.11.9 fixture; not run)

**4.9.1 What the code does today (inspected at `f0abbb4c`).**
- `import_brownlow_season.py` has an offline `--validate-only` and **no DB dry-run**. Its DB path
  reads only the tracked `data/brownlow/` and `data/reference/stat-availability.json`. It refuses
  `--afl-api-dir` / `--stat-availability` unless `--validate-only` is also given (`main()`).
- `load()` commits itself. `common.ImportBatch` commits its row when created and again when it
  finishes. A rollback-only run of the real `load()` is therefore impossible without a proxy
  connection, and a proxy would model the loader rather than run it. **The rehearsal commits, then
  restores exactly** (the ISSUE-249 `runner` precedent).
- `check_database_coverage()` runs **before** any import batch is created. Its refusals (manual
  rows, `declared != complete`, in-progress season, unknown season) therefore write nothing.
- The DB's `stat_availability` and `seasons` come from the tracked JSON at a rebuild
  (`load_reference_data.py`). After the rollover the reviewed change marks 2026
  `brownlow_season_total` `complete`, and `rollover-season.ts` sets `in_progress_seasons` to
  `[2027]`. A loader-only rehearsal must reproduce that post-rollover state on two rows.
- `brownlow_season_votes.id` is `GENERATED ALWAYS AS IDENTITY`, and the loader's
  `TRUNCATE ONLY … ; COPY` assigns new ids and new batch ids on every run. The restore therefore
  replays a full pre-image with `OVERRIDING SYSTEM VALUE`.
- Second-run contract (module docstring: "an identical rerun yields identical rows and counts"):
  **content-idempotent, not a no-op.** Each run replaces the whole table and opens two new batches.
  The builder's own second `--write` **is** a no-op (`unchanged`, content-equal apart from
  `built_at_utc`).

**4.9.2 Season and inputs.** **2026**, the only season D-233-2 will actually load (the master covers
1924–1941 and 1946–2025). Its AFL API count is CONCLUDED: snapshot
`afl-api-brownlow-2026-2026-09-23-015405`, 207 vote sets, 621 vote rows, 1,242 votes, 183
leaderboard players (ISSUE-228 §22.12–§22.15). The rehearsal uses the **real builder output**,
never hand-authored CSV rows. It is blocked until both inputs exist:
1. **The snapshot directory.** `data/sources/` is gitignored, and the snapshot is not in this
   worktree. The operator supplies it; the builder re-hashes it against its own manifest.
2. **A stable-identity bridge.** No tracked bridge declares
   `player_identity_contract: afldb.afl_api_bridge.stable_identity.v1` (0 of the 9 in
   `data/reference/`). ISSUE-241 refuses every pre-241 bridge, and the builder refuses it too. One
   must be emitted read-only from the 2026 full-season match snapshot with
   `tools/current-season/emit-afl-api-player-bridge-test.ts` (pinned to `afldb_test`), and written
   outside the repository. **STOP rule:** if it does not link all 183 vote-receiving providers, the
   builder refuses `unresolved_identity`, and the rehearsal stops there. It never falls back to a
   pre-241 bridge.

Build: run `build_brownlow_season_artefact_from_afl_api.py --label <snapshot> --bridge <v1 bridge>`
(its read-only evidence comes from `afldb_test`, the database that bridge's ids belong to). Run
`--validate-only`, then `--write --out <E>/afl_api/season-votes-afl_api-2026.csv --manifest
<E>/afl_api/season-votes-afl_api-2026.manifest.json`, then the same `--write` again, which must
report `unchanged`. `<E>` is an evidence directory **outside** the repository. Nothing is written to
`data/brownlow/` or `data/reference/`.

The availability fixture is `<E>/stat-availability.json`: a copy of the tracked file with one change,
the 2026 `brownlow_season_total` range `pending` → `complete`. That is exactly the rollover's
reviewed edit, and the diff is asserted to be that one line.

For the duplicate-season case (13): use the retained real 2025 builder output (188 rows, 1 winner,
built 2026-09-20 under ISSUE-228 S7) if it still exists, or a fresh 2025 build. The loader refuses an
overlap on the filename's season, before it reads any content. If neither artefact is available,
case 13 stays proven DB-free only, and the rehearsal records that. A renamed copy is never used.

**4.9.3 The harness.** A new non-production script (proposed:
`tools/migration/brownlow_afl_api_season_rehearsal.py`, with subcommands
`run --acknowledge code_test_db --evidence <E>`, `restore --evidence <E>` and `residue`). It imports
the loader's own functions, and runs exactly `main()`'s DB sequence: `validate_offline()` →
`load_artefact()` / `load_manifest()` → `load_afl_api_artefacts()` → `load()`. The only difference
is the two paths `main()` pins: `afl_api_dir = <E>/afl_api` and `availability = <E>/stat-availability.json`.
Refusals that happen before any DB contact go through the real CLI as child processes. **No
production code change and no new loader option is needed.**

**4.9.4 Sequence.** E1–E12 refer to the expected outcomes in 4.9.5.

| Step | Action | DB writes |
|---|---|---|
| P0 | Build and verify inputs (4.9.2). | none (`afldb_test` read-only) |
| N1 | CLI `--validate-only` with both seams: must PASS, and `afl_api_artefacts` must list exactly 2026, with the manifest's counts **(3, 4, 5)** | none |
| N2 | Changed artefact: one byte flipped in a copy of the CSV. Refuses `csv_sha256 … does not match` **(11)** | none |
| N3 | Changed manifest: `votes_total` + 1 in a copy. Refuses `artefact.votes_total` **(11)** | none |
| N4 | Tracked `stat-availability.json` (2026 `pending`). Refuses "not 'complete' … a pending season never reads as decided" **(12, offline)** | none |
| N5 | 2026 pair + a real 2025 pair. Refuses "season(s) [2025] appear in BOTH" **(13)** | none |
| N6 | CLI without `--validate-only` but with `--afl-api-dir`. Exits 1, offline-validation only; there is no DB bypass | none |
| G | Guards and pre-state (4.9.7); fingerprint F0; pre-image saved to `<E>` **(1, 2)** | none (read-only transaction) |
| PL | Exact plan: on a read-only import connection, `ProfileResolver(pg)` resolves all 16,303 rows to `(season, player_id)` with zero rejections. `expected_after_load()` gives the post-write measurement **(6)** | none |
| D1 | `load()` while DB 2026 is still `pending` / `in_progress`. Refuses "artefact coverage [2026] beyond … `complete` seasons" before any batch **(12, DB)**; fingerprint == F0 | none |
| F1 | Owner: set `stat_availability (brownlow_season_total, 2026)` to `coverage = 'complete'`, `is_recorded = true` | 1 row, committed |
| D2 | `load()` with `seasons` 2026 still `in_progress`. Refuses "in-progress season(s) [2026]"; no batch | none |
| F2 | Owner: set `seasons` 2026 `status = 'complete'` | 1 row, committed |
| A1 | Apply #1 through the loader's own `load()` **(7–10)** | 2 batches; `TRUNCATE ONLY` + COPY of 16,303 rows; `ANALYZE` |
| V1 | Read-only verification against PL and 4.9.5 | none |
| A2 | Apply #2, identical **(14)** | 2 more batches; the same table replacement |
| V2 | The content projection equals V1. Only `id` and `import_batch_id` differ, and all 4 batches are `completed` | none |
| R | Restore (4.9.6), in `finally`, on the owner connection **(15, 16)** | one transaction |
| Z | Fresh-session fingerprint == F0; tracked files unchanged **(17)** | none |

**4.9.5 Expected values.** The 2026 column is bound to the built manifest. The prediction from the
snapshot evidence is in brackets, and a mismatch is a STOP, never an adjustment.

| Measure | Pre (master load) | 2026 artefact | After A1 and after A2 |
|---|---|---|---|
| rows | 16,120 | [183] | 16,303 |
| votes | 79,113 | [1,242 = 207 × 6] | 80,355 |
| sum of `polling_games` | (unchanged) | [621] | pre + 621 |
| winners | 112 | W [1 unless an eligible tie] | 112 + W |
| seasons | 98 | 1 | 99 |
| `source_id = afl_api` rows | 0 | — | 183, all season 2026, all in the A1/A2 `afl_api` batch |
| `afltables` rows | 16,120 | — | 16,120, the same 98 seasons, content-identical to the pre-image |
| NULL `eligible_rank` | 3 | I (ineligible rows) | 3 + I |
| NULL `polling_games` | 4,928 | 0 | 4,928 |
| distinct players | 4,275 | manifest `players` | the profile-path union (PL) |
| `import_batches` | B0 | — | B0 + 2 (A1), B0 + 4 (A2), each 1 `afltables` + 1 `afl_api` |
| `import_rejections` | R0 | — | R0 (zero for every rehearsal batch) |
| `brownlow_round_votes` | count and md5 | — | unchanged |

The `afl_api` batch has `tool = import_brownlow_season.py`, `target_table = brownlow_season_votes`,
`records_inserted = 183` and notes `AFLDB-ISSUE-233 D-233-2 season-scoped AFL API artefacts:
season-votes-afl_api-2026.csv`. Every 2026 row has `source_record_id =
brownlow-season:2026:<profile path>` and `link_status_value = 'unique'`. Every value column equals
the CSV row under `IS NOT DISTINCT FROM`, and an empty cell stays NULL.

**4.9.6 Restore (exact, owner role, one transaction).**
1. Re-assert `current_database() = 'code_test_db'` as the first statement.
2. Refuse if `brownlow_season_votes` holds any batch outside the pre-image and the journal's
   rehearsal batches. Refuse if `import_batches` holds any id above the pre-max that the journal
   does not list.
3. `TRUNCATE ONLY brownlow_season_votes`, then re-insert the saved pre-image (every column,
   including the original `id` and `import_batch_id`) with `INSERT … OVERRIDING SYSTEM VALUE` from
   a temporary table.
4. Delete `import_rejections`, then `import_batches`, for exactly the journal's batch ids (each
   count asserted).
5. Restore the 2026 rows of `seasons` and `stat_availability` from their saved images.
6. `setval` each sequence to its saved `(last_value, is_called)`: the `brownlow_season_votes`
   identity, `import_batches` and `import_rejections`. `nextval` is not transactional.
7. COMMIT, then the fresh-session fingerprint Z must equal F0.

F0 / Z cover: row counts of every `public` table; md5 of the full `brownlow_season_votes` image
(ids included), of `import_batches` / `import_rejections`, and of the 2026 `seasons` /
`stat_availability` rows; every serial/identity sequence; schemas; prepared transactions; the
database comment. Planner statistics written by the loader's `ANALYZE`, and
`pg_stat_*` counters, are not restorable. They are excluded from the fingerprint, and the evidence
says so.

The journal (`<E>/journal.json`) is written before each write step. After a crash,
`restore --evidence <E>` recovers from it alone. `residue` is read-only.

**4.9.7 Safety guards (all before the first write).**
- The DSNs come only from `AFLDB_CODE_TEST_DATABASE_URL` (owner) and
  `AFLDB_CODE_TEST_IMPORT_DATABASE_URL` (import). They are never taken from argv and never printed.
  The `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_DATABASE_URL` and `AFLDB_TEST_*` variables are never read.
- Each DSN must be a `postgresql://` URL whose database is **exactly** `code_test_db`
  (case-sensitive). `afldb_dev`, `afldb_test` and `afldb_prod` are refused by name, and every other
  name is refused as "not exactly code_test_db". `--acknowledge code_test_db` is required.
- After connecting, `current_database()` must equal `code_test_db` on both connections. It is
  re-asserted as the first statement of every write transaction and of the restore. The
  `current_user` values (`afldb_import` / `afldb_owner`) are recorded.
- No other client session may be attached.
- Pre-state must equal the master load: 16,120 rows, 79,113 votes, 112 winners, 98 seasons, only
  `afltables` rows, and zero `manual_admin_edit` rows. DB `brownlow_season_total` must be `complete`
  for exactly the 98 master seasons, with 2026 `pending` and `seasons` 2026 `in_progress`. `sources`
  must hold `afltables` and `afl_api`. Every PL row must resolve exactly once. Anything else STOPs
  with nothing written.
- `<E>` must be new and outside the repository. The sha256 of `data/brownlow/*`,
  `data/reference/stat-availability.json` and `data/reference/seasons.json` is asserted unchanged
  at the end.

**4.9.8 Not proven by this rehearsal (stated, not hidden).**
- `main()` pinning the tracked paths in DB mode: covered by N6 and the existing DB-free tests.
- The rebuild runner's binding of the pair (PRECHECK, stage name, Stage-9 gates): DB-free only. It
  needs the files in `data/brownlow/`, so it belongs to the 2026 rollover's own rebuild.
- Derived recomputation (`player_season_stats` / `player_career_stats` Brownlow totals, the derived
  `stat_availability` grains). The loader never writes them.

### 4.10 Pass 6 — R4 decision: **A, an acceptable fail-safe boundary**

R4 is the concern that `classifySeasonTotals()` (`tools/migration/correct_afl_api_identity.ts:1264`)
returns `unprovable` (SV-3 STOP) for a season whose `brownlow_season_votes` hold `afl_api` rows.
That is true, but supported operations cannot reach it, and where it can be reached the STOP is the
right answer.

1. **When §5.10 runs at all.** `buildClosure()` (`:1597-1893`) evaluates season independence only
   for the *affected seasons*: those of a `player_match_stats` or `brownlow_round_votes` row the
   correction actually MOVEs or DELETEs (`:1712`, `:1837`). Under C11, only `afl_api`-owned rows
   are claimed; foreign rows are NOOPs. ORIGINAL (`runCorrection`, `:2372`) and the CPC/replay
   prediction (`classifyCorrectedProviderInDatabase` → `predictCorrectionClosure`, `:2190`) share
   this one path.
2. **D-233-2 rows exist only for completed seasons in a rebuilt database.**
   - The loader refuses a season that is `pending`, absent from the reviewed availability, or
     `in_progress` (§4.5.1; `check_database_coverage()`).
   - It runs as a rebuild stage, and live databases receive its rows only through the promotion of
     that rebuilt candidate.
3. **In those databases, a completed season has no `afl_api`-owned closure rows.**
   - The rebuild recreates completed seasons from fitzRoy as AFL Tables rows, and fitzRoy/settle own
     `brownlow_round_votes` (`rebuild-test.ts:1104`).
   - D-233-3 refuses to reset a database holding completed-season `afl_api` matches.
   - §3a prepares AFL API data only for the in-progress season.
   - The AFL API match and Brownlow settles never write a completed season (§4.1, §4.7.2).

   So no correction's closure can name a D-233-2 season, and no ORIGINAL or replay correction is
   blocked.
4. **The live window between the rollover and the next promotion.** 2026 `afl_api` round votes
   still exist, but `brownlow_season_votes` 2026 is empty there, because the loader has not run on
   that database. That is SV-0, independent: corrections proceed as they do today.
5. **If it were reached anyway** (a non-standard direct load onto a database still holding
   `afl_api` round votes for that season), the STOP is correct, and implementing SV-2b would not
   change it. The closure rows are CD_I's positive round votes. CD_I's votes reached the artefact
   through the bridge, so P or P′ has a row in V. ISSUE-238 §5.10 SV-2b applies SV-1's rule ("STOP if
   P or P′ has a row in V") because the artefact's `games` come from `player_season_stats`. The season
   totals really do depend on the mapping being corrected. The remedy is to re-issue the artefact
   (ISSUE-238 O-3), not to weaken the predicate.

**Conclusion.** R4 does not make any ordinary supported correction path unusable. No successor
issue is opened. SV-2b stays ISSUE-238's documented deferred predicate. If a future change ever
keeps `afl_api`-owned closure rows in a completed season (ownership replay; D-233-3 forbids it
today), that change must revisit §5.10 SV-2b.

### 4.11 Passes 7–9 — 2026 Brownlow inputs, the builder continuity fix, `code_test_db` coverage

**4.11.1 Pass 7: fresh acquisition; the `afldb_test` bridge is impossible (operator-authorised).**
- Snapshot `afl-api-brownlow-2026-2026-10-01-041609` (gitignored, in the worktree):
  - manifest sha256 `4c9cb2dd…8b6b`;
  - `01-brownlow-season.raw.json` sha256
    `667ddd349b5447fa43d6142c2b1f83b56c42b78407681166d5ab7aa166c66319`;
  - `02-brownlow-leaderboard.raw.json` sha256
    `46bf65a7bfee9afd21d19bc50b335b2e39ad6a3db5fdd095f25cf0bf85c404a2`.
- Contents: both feeds CONCLUDED; 207 vote sets, 621 vote rows, 1,242 votes, 183 vote-getters;
  leaderboard 183 entries, 14 ineligible, 0 mismatches.
- DEV's read-only fingerprint was identical before and after.
- **STOP at the bridge.** `afldb_test` holds no 2026 matches (max season 2025, 16,838 matches).
  The `afldb_test`-pinned emitter therefore linked **0/669** (217 `no_canonical_match`). §4.9.2's
  "emit from `afldb_test`" premise is false until `afldb_test` holds 2026.

**4.11.2 Pass 8: DEV read-only bridge; builder refusal (operator option A).**
- DEV precheck: PASS as `afldb_app`.
- Bridge `D:\tmp\issue233\afl-api-player-bridge-2026-afldb-dev-stable-20261001.json`:
  - sha256 `d9c01983fa4a341ac0a80d9f6e778ae0aaa5c73af0d9183f5c8c16ae5999d049`;
  - contract `afldb.afl_api_bridge.stable_identity.v1`;
  - 217 matches; 669/669 providers linked with identities; 0 refused, 0 unresolved.
- **STOP at the builder.** It refused player 6519, which carries `players/J/Jack_Ross.html` and
  `players/J/Jack_Ross3.html`: "resolve to more than one afltables_profile_url".

**4.11.3 Pass 9: root cause and fix.**
- **Root cause.** `load_identity_and_games()` refused every player with more than one accepted
  `afltables_profile_url`. It never consulted the tracked `profile_url_continuity` rules
  (ISSUE-136).
  - The fitzRoy importer registers both paths of a tracked renumbering on the one folded player.
  - ISSUE-237's `classifyAflApiForwardIdentity()` resolves exactly such a pair to `continuing_url`,
    and the bridge emitter bound player 6519's `candidate_player_identity` with it.
  - So the builder was stricter than the accepted contract. It refused a legitimate single
    identity. It did not mis-attribute anything.
  - All four tracked pairs (Charlie Cameron, Jack Graham, Jack Ross, Jack Williams) are
    structurally affected. Only Jack Ross polled 2026 votes.
- **Fix** (`tools/migration/build_brownlow_season_artefact_from_afl_api.py`):
  - **Rules come from the existing validator.** `load_continuity_rules()` delegates to
    `import_fitzroy_core.load_profile_continuity_rules()`. That module is import-safe: stdlib only
    at module level, DB helpers imported lazily, and already imported by other tools. Nothing was
    re-implemented or extracted.
  - Any validator refusal, unreadable file or invalid JSON becomes `BrownlowArtefactSourceError`,
    before any DB read.
  - The result is a `ValidatedContinuityRules` record (contract path, sha256, rules).
  - `stable_afltables_identity()` refuses any other rule container.
  - **`stable_afltables_identity(paths, rules)`** is the AFL Tables branch of
    `classifyAflApiForwardIdentity()`:
    - one distinct path → that path;
    - two distinct paths equal as a SET to exactly one rule's `{continuing_url, renumbered_url}` →
      `continuing_url`;
    - anything else → refuse.
    - No sort order, no "first", no suffix stripping, no names or ids. A pair spanning two rules
      matches no rule.
  - **Wiring.** `resolve_player_identities()` applies that rule per player and names every
    offender. `load_identity_and_games()` now takes the validated rules.
    `verify_bridge_identities()` is unchanged in logic, but it now compares against the folded
    stable path.
  - **Provenance.** The manifest gains `identity_evidence.profile_url_continuity`: the contract
    path, its sha256, and every fold applied. The schema version is unchanged; the loader does not
    read the key.
  - Only-`renumbered_url`-present is a single path and is accepted as that path. This is
    ISSUE-237's existing semantics. The bridge must then declare the same path, or verification
    refuses (tested).
- **Loader not changed.** `import_brownlow_season.py`'s `ProfileResolver` maps each exact path to
  its set of players. Where both continuity paths sit on one player, `continuing_url` resolves
  uniquely, as the `code_test_db` preflight below shows.
- **INFO (not changed, out of scope).** The Python importer validator treats a non-list
  `rules: {}` as no rules. The TS parser refuses it. Both fail closed for identity: with no rules,
  every pair refuses.

**4.11.4 Pass 9: validation.**
- `tests/python/afl_api_brownlow_season_artefact_contract.py`: **157/157 PASS** (41 new checks,
  cases 1–12 plus resolver, fold-provenance and fake-cursor wiring checks).
- `tests/brownlow-season-artefact.test.ts`: **35/35 PASS**. Six new cases check TS↔Python parity:
  - the real contract, including Jack Ross and all four pairs;
  - a synthetic contract where the continuing path sorts after the renumbered one;
  - four malformed contracts, which both sides refuse.
- `tests/python/fitzroy_profile_continuity_contract.py`: all checks passed (importer unchanged).
- `tests/fitzroy-core-import.test.ts`, `tests/player-link-mutations.test.ts`,
  `tests/correct-afl-api-identity-cli.test.ts`: 503 passed, 5 skipped, **1 failed**.
  - The failure is `correct-afl-api-identity-cli` "the refusal path renders through
    formatManifestProblems", a source-text assertion on `tools/migration/correct_afl_api_identity.ts`.
  - That file and the test are unchanged since `a8a4f170`, so the failure is pre-existing and
    unrelated to this pass.
- `py_compile`: OK. `git diff --check`: clean.

**4.11.5 Pass 9: real builder on DEV, read-only.**
- Inputs: DSN `AFLDB_DEV_DATABASE_URL`, set process-only from the operator-approved DEV
  `DATABASE_URL` (`afldb_app`) via the 55432 tunnel. `--database afldb_dev`.
- `--validate-only` gave:
  - 207 vote sets, 183 leaderboard entries compared, 0 mismatches, both feeds CONCLUDED;
  - **183/183 identities, 0 refusals**;
  - one fold, `Jack_Ross3.html + Jack_Ross.html → players/J/Jack_Ross.html`
    (`2025-jack-ross-renumbered-profile`);
  - bridge identities verified;
  - every vote-getter has 2026 `player_season_stats` (the builder refuses otherwise).
- `--write` to `D:\tmp\issue233\brownlow-2026\`:
  - `season-votes-afl_api-2026.csv` sha256
    `3ad4257d9a256c86d911b6108f164ace7b30d631cd6be5539215777cd8325af6`;
  - `season-votes-afl_api-2026.manifest.json` sha256
    `1d971116f18d0d41ee39e87ef833e881b0d91ea0923d4b5ff113ef9e95c0bbe3`;
  - 183 rows, 1,242 votes, 1 winner (`players/J/Nick_Daicos.html`, 47 votes), 14 ineligible rows;
  - `source_key` `afl_api`;
  - the snapshot label and file hashes as in §4.11.1;
  - bridge sha256 `d9c01983…d049` (669 contributed);
  - `identity_evidence.database = afldb_dev`, `read_only = true`.
  - Jack Ross row: `players/J/Jack_Ross.html`, 3 votes, `bootstrap_player_id` 6519.
- The identical second `--write` returned **`unchanged`**. Both files kept their mtime and hashes.

**4.11.6 Pass 9: `code_test_db` read-only coverage preflight: INCOMPLETE → STOP.**
- Session proof: `current_database() = code_test_db`, `transaction_read_only = on`,
  `default_transaction_read_only = on` (role `afldb_owner`). The session rolled back. No write.
- Every CSV row went through the loader's own `load_artefact()` and `ProfileResolver` (its exact
  production query), plus `load()`'s same-season two-paths-one-player check:
  - **175** unique resolutions, all FK-valid against `players`;
  - **0** ambiguous;
  - **0** same-season collisions;
  - **8 unresolved** ("no canonical player carries this AFL Tables profile path"):
    `Dyson_Sharp`, `Harry_Dean`, `Jagga_Smith`, `Joel_Fitzgerald`, `Milan_Murdock`,
    `Phoenix_Gothard`, `Sam_Swadling`, `Zeke_Uwland`.
- None of the eight has a `players` row by display name either. `code_test_db` holds 0 2026
  matches (max season 2025), and their DEV ids are 13290–13356. They are therefore presumably 2026
  debutants, but this was **not verified on DEV**.
- This is a **target-data gap, not a loader or continuity code gap.** The loader correctly
  refuses them.
- Jack Ross in `code_test_db`: both paths are `unique` on player 6519, and `Jack_Ross.html`
  resolves uniquely.
- `code_test_db` `brownlow_season_votes` 2026: 0 rows.
- **The harness `tools/migration/brownlow_afl_api_season_rehearsal.py` was NOT written:** coverage
  is incomplete.
- **Operator decision needed:** how `code_test_db` comes to carry the 2026 player population. For
  example: a 2026-bearing rebuild or restore, or a scoped fixture of the eight players and their
  identities. Alternatively, accept a rehearsal scope that excludes them, but the loader refuses
  the whole artefact on any rejection, so a partial rehearsal would need a different artefact.

**4.11.7 Boundaries held.** No database was mutated (DEV and `code_test_db` were read only in
read-only sessions). PROD was not contacted. Nothing was staged or committed. The three empty
untracked stray files `one`, `` player_id` `` and `home-and-away` were deleted at the operator's
instruction. Their cause is not claimed. Three more empty untracked files appeared during pass 9
(`10` 14:32:57, `canonical` 14:33:03, `exactly` 14:34:14 local). They were not authorised for
deletion and were left in place.

**4.11.8 Pass 10: decision D-233-R, a scoped prerequisite fixture (operator, 2026-10-01).**
- `code_test_db` is **not** rebuilt or restored to obtain 2026:
  - `db:test:rebuild` deliberately stops at the last completed season, so a fresh historical rebuild
    holds no 2026 population by construction;
  - the production current-season preparation path is pinned to `afldb_test`, and extending it to
    `code_test_db` only for this rehearsal would broaden ISSUE-233.
- D-233-2's loader prerequisite is **profile identity resolution**, not 2026 match ingestion. The
  rehearsal therefore seeds exactly the eight missing canonical identities, keyed by their exact
  artefact paths:
  - `players/D/Dyson_Sharp.html`
  - `players/H/Harry_Dean.html`
  - `players/J/Jagga_Smith.html`
  - `players/J/Joel_Fitzgerald.html`
  - `players/M/Milan_Murdock.html`
  - `players/P/Phoenix_Gothard.html`
  - `players/S/Sam_Swadling.html`
  - `players/Z/Zeke_Uwland.html`
- By surname these are the same eight players that ISSUE-228's test-native bridge entry in
  `issues.md` recorded (2026-09-23) as ISSUE-224 manual registrants with no `player_match_stats` in
  the then `afldb_test`. That earlier record is consistent with the "2026 debutant" reading of
  §4.11.6. It was not re-verified in this pass.
- **Source of truth:** the builder-verified artefact
  `D:\tmp\issue233\brownlow-2026\season-votes-afl_api-2026.csv` (sha256 `3ad4257d…5af6`) and its
  manifest (sha256 `1d971116…bbe3`). Both were re-hashed in this pass and match. The eight rows were
  located by their full `afltables_profile_url`. Their review-only `bootstrap_player_id` values (DEV
  surrogates 13290–13356) are never used.
- The fixture is **rehearsal-only**. It does not change the rebuild, the current-season
  architecture, or any production code.

**4.11.9 Pass 10: the fixture and the harness (WRITTEN, NOT RUN).**
`tools/migration/brownlow_afl_api_season_rehearsal.py` implements §4.9 with the fixture as an
explicit setup phase.
- **Inputs.** The harness takes `--artefact-dir` and refuses unless both files hash to the pinned
  sha256 values and the loader's own `load_afl_api_artefact()` accepts the pair. The pair must
  measure 183 rows, 1,242 votes, 1 winner and 14 ineligible rows.
  - The files are copied byte-for-byte to `<E>/afl_api` and re-hashed.
  - `<E>/stat-availability.json` is the tracked file with one line changed: 2026
    `brownlow_season_total` goes from `pending` to `complete`. The harness asserts that this single
    range is the only difference.
- **Fixture (in the importer's own shape, `import_fitzroy_core.py`):**
  - 8 `players`. `display_name` comes from the artefact row. `slug`, `sort_name` and `search_name`
    are `afldb-issue-233-rehearsal-fixture-<stem>`. `notes` is
    `AFLDB-ISSUE-233 D-233-2 code_test_db rehearsal fixture (not current-season ingestion): <path>`.
    No id is supplied, so `code_test_db` allocates it.
  - 8 `external_identities`: source `afltables`, `external_id` = the exact path, `external_url`
    `https://afltables.com/afl/stats/<path>`, `status` `unique`, `match_method`
    `afltables_profile_url`, and the same `notes`.
  - No `afl_api` identity. No matches, `player_match_stats` or `player_season_stats` (the loader reads
    none of them).
- **Order of a run.** Each step's evidence goes to `<E>/evidence.json`. The journal
  `<E>/journal.json` is written before and after every write.
  1. **Offline cases (the real CLI as child processes, every DSN/`PG*` variable removed):**
     - N1: validate-only, both seams; must pass, listing exactly 2026.
     - N2: one CSV byte flipped → `csv_sha256 … does not match` (case 3).
     - N3: manifest `votes_total` + 1 → `artefact.votes_total` (case 4).
     - N4: the tracked availability → `not 'complete'` (case 1, offline).
     - N5: case 5 runs only with `--duplicate-pair-dir`, a genuine pair for a master season.
       Otherwise it is recorded as NOT RUN. A renamed copy is never used.
     - N6: the seams without `--validate-only` → exit 1.
  2. **G + preflight (read-only).**
     - DSNs, roles (`afldb_import` vs owner) and `current_database()` are checked. No other client
       session may be attached.
     - The table must still be the master load: 16,120 / 79,113 / 112 / 98, only `afltables` rows,
       zero manual rows.
     - Availability must be complete for exactly the master seasons, with 2026 `pending` and
       `seasons` 2026 `in_progress`.
     - **The real `ProfileResolver` must give exactly 183 / 175 / 8 / 0, with 0 collisions, and the
       8 unresolved must be exactly the fixture paths. Otherwise STOP. It never seeds seven.**
     - No fixture slug, note or path may exist in any form.
     - Every restorable sequence must be ahead of its table's `max(id)`.
     - Captured: the `brownlow_season_votes` pre-image (`COPY`, sha256, its columns and batch ids),
       the afltables content projection, `brownlow_round_votes` count/md5, the 2026 `seasons` /
       `stat_availability` images, and F0.
  3. **S (fixture seed):** one owner transaction; 8 + 8 rows; the ids must exceed the pre-max.
  4. **PL:** the real resolver again must give **183 / 183 / 0 / 0**. The eight must resolve to
     exactly the fixture-created ids, and no other path may resolve to a fixture player.
  5. **D1** (DB 2026 `pending`) refuses `beyond` (case 1). **F1** sets that one row to `complete`.
     **D2** refuses `in-progress season(s)` (case 2). **F2** sets `seasons` 2026 to `complete`
     (case 6). Each refusal is proven to have written nothing.
  6. **A1 → V1 → A2 → V2** (cases 8–13) through the real `main()` sequence. The checks are:
     - the table measures pre + the artefact;
     - the afltables projection is content-identical to the pre-image;
     - every 2026 row equals its CSV row under `IS NOT DISTINCT FROM`, with
       `source_id = afl_api`, `source_record_id = brownlow-season:2026:<path>`, the `afl_api` batch
       and `club_id` NULL;
     - two clean `completed` batches per load with the expected counts and notes, and zero
       rejections;
     - `brownlow_round_votes` unchanged;
     - V2's full content projection must equal V1's (content-idempotent, §4.9.1).
     - The winner path is read back as an evidence witness only. It is not hard-coded.
  7. **R (in `finally`, one owner transaction), then Z:**
     - restore the `brownlow_season_votes` pre-image (`OVERRIDING SYSTEM VALUE`);
     - delete the rehearsal's rejections, then its batches;
     - restore the 2026 setup rows and compare them with their images;
     - delete the 8 identities, then the 8 players;
     - `setval` the `players`, `external_identities`, `import_batches`, `import_rejections` and
       `brownlow_season_votes` sequences;
     - commit. A **fresh session** must reproduce F0 (every public table count, nine table images,
       every public sequence, schemas, prepared transactions, database comment), and the residue
       gate must be 0.
     - The sha256 of the tracked inputs is compared before and after.
- **Teardown safety:**
  - Every DELETE is keyed by exact id arrays plus the exact planned keys, and each count is asserted.
  - There is no `LIKE`, wildcard or `CASCADE`.
  - Before each delete, every foreign key into `players`, `external_identities` and
    `import_batches` (discovered from `pg_constraint`) must count zero referencing rows. Otherwise
    the restore REFUSES and rolls back. A composite FK refuses too.
- **Crash recovery:** `restore --acknowledge code_test_db --evidence <E>` works from the journal
  alone.
  - A fixture seed recorded only as intent is located by its exact keys: all eight, or none.
  - Batches above the pre-max are deleted only if they are the loader's and a load was journaled.
  - `residue` is read-only.
- Not restorable, and excluded from F0 / Z: planner statistics from the loader's `ANALYZE`, and
  `pg_stat_*` counters.

**4.11.10 Pass 10: DB-free tests.** `tests/python/brownlow_afl_api_season_rehearsal_contract.py`:
**113/113 PASS**. It never connects and never runs `run`/`restore`/`residue`. It covers:
- **Target guard.** `afldb_dev` / `afldb_test` / `afldb_prod` are refused by name; arbitrary names,
  keyword DSNs and `?dbname=` / `?service=` are refused; only the two variables are read; no argv DSN
  option exists; `--acknowledge` is exact; no password appears in any message.
- **Inputs.** The exact eight-path set. A missing, duplicated, off-season or nameless fixture row
  refuses. A changed CSV or manifest refuses, both on the pin and through the loader.
- **Drift STOPs.** A pre-existing path, an ambiguous path, a different unresolved set, and a
  same-season collision each STOP.
- **The fixture.** Exactly 8 + 8 rows in the importer's shape. No DEV id appears anywhere. The
  post-seed rule holds.
- **Teardown.** Only created rows are targeted: exact keys, the pre-max floor, all eight or none,
  and a cross-check against the journal. Foreign batches refuse. No wildcard and no `CASCADE`. The
  teardown runs in FK order, and an unexpected reference fails closed.
- **The sequence plan** covers every table the harness and the loader write.
- **The journal** records seed intent and commit, setup, load, refusal and restore-complete states,
  and survives a reread from disk.
- **The availability fixture** is a one-line edit.
- Where the genuine artefact exists, the suite reads it and proves the plan's exact eight paths and
  names.

**4.11.11 Pass 10: the 9,982 / 9,983 bridge difference (read-only, offline).**
Source: the DEV bridge (`d9c01983…d049`) and its match snapshot `afl-api-2026-2026-09-25-235854`.
- **The counts.** `snapshotPlayerMatchRows` = 9,983. `canonicalPmsRowsRead` = 9,982.
  `playerMatchRowsCoveredByLinkedProviders` = 9,983.
- Per match, the snapshot rows equal `canonical_rows_read` in 216 of 217 matches. The exception is
  **`CD_M20260140305`** (canonical match 17200): 47 snapshot rows (24 home + 23 away) against 46
  canonical rows.
- The extra row is home index 23: provider **`CD_I993799`** (Brayden Fiorini, `CD_T50`).
  - Its fields: `position: EMERG`, `timeOnGroundPercentage: 0.0`, every counting stat 0, and
    `extendedStats: null`.
  - This is the same row ISSUE-228 recorded as the only null `extendedStats` row.
  - He was an **unused emergency**. The AFL API stats feed lists him, but he did not play, so the
    canonical `player_match_stats` correctly has no row for him.
  - It is the only zero-TOG `EMERG` row in the snapshot. Four other `EMERG`-labelled rows have real
    time on ground (34–85%) and canonical rows.
- **Why the emitter can still link him** (`src/lib/acquisition/afl-api-player-evidence.ts`):
  - The row is a per-row **miss** `no_canonical_row_at_jumper` (`:590-601`). It is not a
    contradiction.
  - The provider is linked on its two other matches (`CD_M20260140102`, `CD_M20260140206`), with
    exact core vectors and 20 agreeing statistics each (`min_matches_for_link` 2).
  - `playerMatchRowsCoveredByLinkedProviders` is a **provider-level** sum of `snapshotRowCount`
    (`:642-646`), so it counts this row as well.
- **The arithmetic.** 9,983 = 9,962 matched + 20 `core_stat_mismatch` + 1
  `no_canonical_row_at_jumper`. The 20 mismatches do have a canonical row at their jumper, so 9,982
  = 9,962 + 20.
- **Verdict: expected source semantics, NOT an acceptance gap.** The difference is one
  non-playing emergency. It neither creates nor weakens any identity link. No bridge policy was
  changed.

**4.11.12 Pass 10: code quality and hygiene.**
- **Ruff, builder.** The pass-9 import of `import_fitzroy_core` added a new I001 hunk and a new
  RUF100. It is now three single-line imports, so the builder reports exactly HEAD's four
  pre-existing findings: the loader-import I001 hunk, two RUF100s and UP037. None of those was
  changed. The new harness and its test are Ruff-clean.
- **`correct-afl-api-identity-cli` "renders through formatManifestProblems": BASELINE.**
  - The test and `tools/migration/correct_afl_api_identity.ts` have identical blob ids at base
    `74d63602`, HEAD `f0abbb4c` and the working tree (`b9df4322…` / `a2e90c13…`). The rerun fails at
    the same assertion (`:3176`).
  - The mechanism is CRLF. The worktree checks the tool out with CRLF, so
    `indexOf('\n}\n')` = −1. The sliced "body" then runs to end-of-file and reaches the unrelated
    `problems.join` at `:4508`.
  - This matches the known Windows CRLF contract-test behaviour. It was not fixed in ISSUE-233.
- **Stray files.** The empty untracked `10`, `canonical` and `exactly` were deleted, by exact name,
  on the operator's instruction. Their cause is not claimed.

**4.11.13 Pass 10: boundaries.**
- No database was contacted: neither `code_test_db`, DEV, `afldb_test` nor PROD. The harness was
  not executed.
- The only commands run were DB-free tests, Ruff, `py_compile`, read-only Git inspection, and
  offline reads of the artefact, bridge and snapshot.
- Nothing was staged or committed.
- **Next action (operator):** authorise the `code_test_db` rehearsal run. Supply the two
  `AFLDB_CODE_TEST_*` DSNs process-only, a new `<E>` outside the repository and, optionally, a
  genuine master-season AFL API pair for case 5. (Done in pass 11, §4.11.14.)

**4.11.14 Pass 11: the `code_test_db` rehearsal (operator-authorised, one bounded run): PASS.**
- **Credentials.** `D:\dev\afldb\.env` holds no `AFLDB_CODE_TEST_*` keys. With the operator's
  approval (option 1), they were derived process-only by a URL parser in a scratch launcher outside
  the repository:
  - owner from `AFLDB_TEST_DATABASE_URL`; import from `AFLDB_IMPORT_DATABASE_URL`;
  - credentials and options kept; only the database (→ `code_test_db`) and the endpoint
    (→ `127.0.0.1:55432`) changed;
  - set only in the child's environment, with every other `*DATABASE_URL` / `PG*` variable
    removed;
  - never printed. `.env` was not edited or copied, and no owner-as-import fallback was used.
- **Harness change before the run (stricter only).**
  - `capture_pre_state()` now requires the owner role to be exactly `afldb_owner`, and
    `default_transaction_read_only = off` on both sessions.
  - A new `post_restore_shape()` re-runs the real resolver in a fresh session after the restore
    (and after a separate `restore`). It requires the measured 183/175/8/0 shape and the same eight
    paths.
  - DB-free suite still 113/113.
- **Run.** `run --acknowledge code_test_db --artefact-dir D:\tmp\issue233\brownlow-2026 --evidence
  D:\tmp\issue233\rehearsal-20261001-151415`, 05:14:15–05:15:12 UTC, exit 0, `REHEARSAL PASS`.
  - The evidence directory was new. Log `rehearsal-20261001-151415.run.log` (sha256
    `8375e807…b3f7`).
  - `evidence.json` sha256 `7d143965…df00`; `journal.json` `d710e679…0e4b`; pre-image
    `d0a1effa…f299`.
- **Inputs.** Both files re-hashed to the pinned values (`3ad4257d…5af6`, `1d971116…bbe3`). The
  staged copies are byte-identical, and the availability fixture is the one-range edit.
- **Preflight (read-only, before any write).**
  - Roles: owner `afldb_owner`, import `afldb_import`; `current_database() = code_test_db` on both;
    neither session read-only by default. No other client session was attached.
  - Sources: `afltables` = 10, `afl_api` = 6.
  - `brownlow_season_votes` = the master load: 16,120 rows, 79,113 votes, 112 winners, 98 seasons,
    4,275 players. NULL `eligible_rank` 3, NULL `polling_games` 4,928, all `afltables`, batch 24 only.
  - 2026: `stat_availability` `pending` / `is_recorded` false; `seasons` `in_progress`.
  - **Real resolver: 183 / 175 / 8 / 0, 0 collisions.** The unresolved paths are exactly the eight.
  - No fixture slug, note or path existed. Pre-residue was 0 in every category. 0 players carried
    the eight display names.
  - Sequences (`last_value`, all `is_called`): `players` 13273, `external_identities` 18334,
    `import_batches` 26, `import_rejections` 681, `brownlow_season_votes` 16120.
  - `brownlow_round_votes`: 320,861 rows, md5 `d568252f…3e00`.
  - **F0 sha256 `47190a7cdf290d6d5bbf17e4e372163218a7ae514b9064f7bc4ed8937ca183b2`.**
- **Offline cases (real CLI).**
  - N1 validate-only: PASS, exactly 2026 (183 / 1,242 / 1 / 183 players).
  - N2 (case 3, changed CSV): refused, `csv_sha256 … does not match`.
  - N3 (case 4, changed manifest): refused, `artefact.votes_total = 1243 … measures 1242`.
  - N4 (case 1 offline, tracked availability pending): refused, `not 'complete'`.
  - **N5 (case 5): NOT RUN.** No genuine master-season pair exists, so its refusal is proven
    DB-free only.
  - N6 (seams without `--validate-only`): refused, exit 1.
- **Fixture (allocated by `code_test_db`).** Every id was above its pre-max, and the resolver then
  gave **183 / 183 / 0 / 0, 0 collisions**, with each fixture path on exactly its id.

  | path | players.id | external_identities.id |
  |---|---|---|
  | `players/D/Dyson_Sharp.html` | 13274 | 18335 |
  | `players/H/Harry_Dean.html` | 13275 | 18336 |
  | `players/J/Jagga_Smith.html` | 13276 | 18337 |
  | `players/J/Joel_Fitzgerald.html` | 13277 | 18338 |
  | `players/M/Milan_Murdock.html` | 13278 | 18339 |
  | `players/P/Phoenix_Gothard.html` | 13279 | 18340 |
  | `players/S/Sam_Swadling.html` | 13280 | 18341 |
  | `players/Z/Zeke_Uwland.html` | 13281 | 18342 |

- **DB refusals, each proven to write nothing** (the table measure and the batch/rejection max
  ids were unchanged):
  - D1 (case 1, DB 2026 `pending`): "artefact coverage [2026] beyond / [] short of the
    brownlow_season_total 'complete' seasons".
  - F1 committed (`stat_availability` 2026 → `complete`, 1 row).
  - D2 (case 2): "artefact carries rows for in-progress season(s) [2026]".
  - F2 committed (`seasons` 2026 → `complete`, 1 row; case 6).
- **A1, the first real load: PASS.**
  - Loader result: 16,303 rows, 80,355 votes, 113 winners, 99 seasons, 4,308 players, 0
    rejections, `afl_api` rows 183 in [2026].
  - V1 measure:
    - 2026 rows 183 (all `afl_api`, source id 6); `afltables` rows 16,120; other sources 0;
    - votes +1,242; winners +1; NULL `eligible_rank` 17 (= 3 + 14 ineligible); NULL
      `polling_games` 4,928; `polling_games` sum +621 (28,654 → 29,275).
  - The `afltables` projection is content-identical to the pre-image (md5 `e13db64e…5dce`).
  - Every 2026 row equals its CSV row under `IS NOT DISTINCT FROM`. Each also has
    `source_record_id = brownlow-season:2026:<path>`, `club_id` NULL, and batch 28.
  - Batches: **27** (`afltables`, read/inserted 16,120, notes NULL) and **28** (`afl_api`,
    read/inserted 183, notes "AFLDB-ISSUE-233 D-233-2 season-scoped AFL API artefacts:
    season-votes-afl_api-2026.csv"). Both `completed`, 0 rejected, 0 rejection rows. The table's
    rows are owned by exactly {27, 28}.
  - `brownlow_round_votes` 320,861, md5 unchanged.
  - Winner witness (read back, not hard-coded): `players/N/Nick_Daicos.html`, which equals the
    CSV's.
- **A2, the second real load: PASS.**
  - The result is identical (16,303 / 80,355 / 113 / 99 / 4,308; `afl_api` 183).
  - New batches **29** (`afltables`) and **30** (`afl_api`) have the same counts and notes.
  - **Observed replacement semantics:**
    - `TRUNCATE ONLY` + COPY replaced the whole table. The rows are now owned by exactly {29, 30},
      with no duplicate logical rows and no surviving `afl_api` rows from A1. The 2026 slice is
      still 183 / 1,242 / 1 / 14.
    - Rows received new identity ids. The verification compares content without `id` /
      `import_batch_id`; the new id values were not separately recorded.
    - A1's batches 27 and 28 **remain as `completed` audit rows** in `import_batches`, owning no
      rows. That is the real loader's contract: each run opens two new batches.
  - **V2's full content projection equals V1's** (md5 `df2a665c09e2b7354cf50118b81b8eb6`, 16,303
    rows): content-idempotent. `brownlow_round_votes` is unchanged.
- **Restore: PASS (one owner transaction).**
  - The pre-image was restored, with its original ids and batch 24.
  - Import batches [27, 28, 29, 30] were deleted, after 0 rejections and 0 FK references.
  - The 2026 `seasons` / `stat_availability` rows equal their images.
  - Identities 18335–18342, then players 13274–13281, were deleted after 0 FK references. There was
    no CASCADE.
  - The five sequences were reset with `setval` to their captured values.
  - **Fresh-session Z sha256 = F0, 0 fingerprint differences**: every public table count, nine
    table images, every public sequence (including the five, back to 13273 / 18334 / 26 / 681 /
    16120), schemas, prepared transactions and the database comment.
  - In-run residue was 0 in all seven categories. The journal records the fixture as `committed`
    and the restore as `complete`. Tracked inputs were unchanged.
  - **Post-restore shape (fresh session, real resolver): 183 / 175 / 8 / 0**, with exactly the
    same eight unresolved paths.
- **Standalone `residue` (a separate read-only invocation):** exit 0, all seven counts 0. Log
  sha256 `6f4ee0da…514a`.
- **Not restorable, as stated:** planner statistics from the loader's two `ANALYZE` runs, and
  `pg_stat_*` counters.
- **Boundaries.** Only `code_test_db` was contacted: the run plus one read-only residue session.
  There was no DEV, `afldb_test` or PROD connection, no network acquisition and no rebuild or
  restore of `code_test_db`. HEAD stayed `f0abbb4c`, and nothing was staged or committed.
- **Next action (operator):** review and commit the ISSUE-233 implementation and validation diff
  (passes 6–11). ISSUE-233 stays OPEN until then. (Done in pass 12, §4.11.15.)

**4.11.15 Pass 12: final review before commit.**
The whole uncommitted diff (nine files) was reviewed against the operator's checklist A–G.
- **A. Continuity fix: PASS.**
  - One path is a direct identity.
  - Exactly one validated rule's `{continuing_url, renumbered_url}`, by set equality, folds to
    `continuing_url`, so a reversed input order gives the same result.
  - There is no sort, suffix or name heuristic.
  - Untracked pairs, pairs spanning two rules, three or more paths, malformed contracts and chained
    rules (refused by the fitzRoy validator) all fail closed.
  - Jack Ross resolves to `players/J/Jack_Ross.html`, and the bridge comparison uses the folded
    path.
- **B. Continuity provenance: MEDIUM M-1, FIXED.**
  - The builder wrote `identity_evidence.profile_url_continuity`, but nothing validated it.
    `import_brownlow_season.py` verifies only a schema-2 manifest's schema, source, season and
    artefact block, and does not read `identity_evidence`. The loader is outside this commit's file
    set.
  - New `verify_continuity_provenance(manifest, rules)` in the builder checks the exact shape
    `{contract, sha256, folds}`:
    - the contract path is separator-normalised;
    - `sha256` must equal the validated contract's;
    - each fold must be exactly one validated rule triple, unique, in `continuing_url` order.
  - It is used in two places:
    - `build()` runs it on its own manifest before reporting success;
    - the rehearsal's `load_fixture_source()` runs it on the genuine artefact, binding it to the
      tracked contract (sha256 `e4001a8d…a466`, fold `2025-jack-ross-renumbered-profile`).
  - The builder docstring now documents `identity_evidence` as builder-owned provenance, which the
    loader permits and does not read.
  - Tests: 14 builder checks, and 2 harness checks (the genuine fold, and a tampered re-pinned
    manifest refusing). One builder check pins that `load_afl_api_artefact()` accepts the block.
- **M-2: manifest paths not portable, FIXED.**
  - Origin: `_rel()` (pre-existing since `bbf87566`) wrote host separators. A Windows-built
    manifest therefore carries `artefact.file` like `D:\tmp\…\season-votes-afl_api-2026.csv`.
  - Effect: the loader's `Path(artefact.file).name` check does not split `\` on Linux, so a Linux
    rebuild would refuse the artefact. That is fail-closed, but it blocks the 2026 rollover if the
    artefact is built on the workstation.
  - This diff's new provenance path inherited the problem.
  - Fix: `_rel()` now always emits POSIX paths. Two builder checks pin it.
  - The pinned genuine artefact (Windows-built) is unchanged and remains valid evidence for the
    Windows-run rehearsal. A rebuild of it would differ only in these path fields.
- **C. Target safety: PASS.**
  - The target must be exactly `code_test_db`; `afldb_dev`, `afldb_test`, `afldb_prod` and other
    names are refused.
  - The roles must be exactly `afldb_owner` and `afldb_import`, and neither session may default to
    read-only.
  - Identical DSNs are refused. There are no argv DSNs, and credentials are redacted and never
    printed.
- **D. Fixture: PASS.**
  - Exactly the eight paths, with ids allocated locally and no DEV/bootstrap id used.
  - 8 players + 8 `afltables` identities, and no match or stat fixture.
  - The run requires 175/8/0 before the seed and 183/183 after it.
  - Cleanup is by exact id, with no wildcard and no CASCADE.
- **E. Real loader: PASS.**
  - The real `main()` DB sequence is used, and the first load is checked against 183 / 1,242 / 1 /
    14 with `afl_api` ownership. `brownlow_round_votes` is checked unchanged.
  - The second load's whole-table replacement is recorded.
  - A1's batches remain as completed audit rows until the teardown, and all rehearsal batches are
    deleted on restore.
- **F. Restore: PASS.**
  - The journal is written before every committed mutation, and an independent `restore` has the
    journal, the pre-image and the staged artefact.
  - Exact table ids and batch ownership, the setup rows, identities then players (with the FK
    reference refusal) and the five sequences are restored.
  - The fresh-session fingerprint and the post-restore 175/183 shape are mandatory. `residue` is
    independent.
- **LOW, FIXED:** a post-restore shape failure is now reported separately from a restore failure
  (it was still fail-closed before). One inaccurate comment was corrected.
- **G. Evidence wording:** checked. `issues.md` now states the 9,983 = 9,962 + 20 + 1 arithmetic
  and that no bridge policy was changed.
- **Validation (DB-free):**
  - harness 115/115; builder 173/173; Brownlow TS 35/35;
  - `fitzroy-core-import` 109 passed / 5 skipped; `fitzroy_profile_continuity_contract.py` all
    passed;
  - Ruff: the new files are clean. The builder carries exactly HEAD's four findings (I001, two
    RUF100, UP037), on the same source lines with an identical I001 fix hunk;
  - `py_compile` OK; `git diff --check` clean.
- **Baseline, not fixed here:** the `correct-afl-api-identity-cli` CRLF failure (§4.11.12).
- No database, network or PROD activity in this pass.

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

Pass 6 (2026-10-01, on `f0abbb4c`; tracking only, no code change, no database contact):
- **M** this runbook (state block, §3b.2–§3b.3, §4.6, §4.7.4 terminology note, §4.8.4 R4, §4.9,
  §4.10), `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.

Passes 7–8 (2026-10-01): no repository file changed (evidence recorded in pass 9, §4.11).

Pass 9 (2026-10-01, on `f0abbb4c`, uncommitted):
- **M** `tools/migration/build_brownlow_season_artefact_from_afl_api.py`: continuity-aware stable
  identity, manifest fold provenance, docstring.
- **M** `tests/python/afl_api_brownlow_season_artefact_contract.py` (41 new checks).
- **M** `tests/brownlow-season-artefact.test.ts` (TS↔Python parity, 6 cases).
- **M** this runbook (state block, §4.11), `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.
- Outside the repository (untracked): `D:\tmp\issue233\brownlow-2026\season-votes-afl_api-2026.csv`
  and `.manifest.json`.

Pass 10 (2026-10-01, on `f0abbb4c`, uncommitted):
- **N** `tools/migration/brownlow_afl_api_season_rehearsal.py` (the harness + eight-player fixture;
  not run).
- **N** `tests/python/brownlow_afl_api_season_rehearsal_contract.py` (113 checks).
- **M** `tools/migration/build_brownlow_season_artefact_from_afl_api.py` (import order only).
- **M** this runbook (state block, §4.9 heading, §4.11.8–§4.11.13), `issues.md`, `IssuesIndex.md`,
  `CHANGELOG.md`.
- **D** the empty untracked stray files `10`, `canonical`, `exactly` (never tracked).

Pass 11 (2026-10-01, on `f0abbb4c`, uncommitted):
- **M** `tools/migration/brownlow_afl_api_season_rehearsal.py`: an exact owner-role check,
  session-writability checks, and the fresh-session `post_restore_shape()`.
- **M** this runbook (state block, §4.11.14), `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.
- Outside the repository: `D:\tmp\issue233\rehearsal-20261001-151415\` and its `.run.log` /
  `.residue.log`.

Pass 12 (2026-10-01, final review; committed with passes 6–11):
- **M** `tools/migration/build_brownlow_season_artefact_from_afl_api.py`:
  `verify_continuity_provenance()` and its use in `build()`; POSIX `_rel()`; docstring.
- **M** `tools/migration/brownlow_afl_api_season_rehearsal.py`: the genuine artefact's continuity
  provenance is verified, a separate post-restore shape failure message, a comment fix.
- **M** `tests/python/afl_api_brownlow_season_artefact_contract.py` (+16 checks),
  `tests/python/brownlow_afl_api_season_rehearsal_contract.py` (+2 checks).
- **M** this runbook (state block, §4.6, §4.11.15), `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`.
