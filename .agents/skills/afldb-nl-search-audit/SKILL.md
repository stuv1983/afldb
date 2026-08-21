---
name: afldb-nl-search-audit
description: Review, debug, expand, regression-test, document, and verify AFLDB's deterministic natural-language search against the real PostgreSQL development data and the real /search UI. Use for parser, plan, SQL compiler, alias, coverage, answer-rendering, NL-search regression, audit, and repair work. Maintain issuesFound.md and CHANGELOG.md when defects or codebase changes are found.
disable-model-invocation: true
---

# AFLDB Natural-Language Search Audit

Use this skill when AFLDB natural-language search gives a wrong answer, declines an answerable question, ignores part of a question, returns the wrong grain, renders a misleading explanation, exposes a browser/runtime failure, or needs a new supported query family.

The objective is **semantic correctness against AFLDB's real data and real `/search` behaviour**, not merely making a parser unit test pass.

A successful change must satisfy all of these:

1. The question is interpreted correctly.
2. The structured plan preserves every meaningful constraint.
3. `validatePlan` accepts only combinations the SQL layer can actually execute.
4. The grain compiler honours every field in the validated plan.
5. The SQL result agrees with an independently written PostgreSQL truth query when the query is database-backed.
6. The `/search` UI renders the same answer, ties, wording, interpretation, and caveats correctly.
7. Existing NL regression tests and representative neighbouring phrasings do not regress.
8. Parser behaviour changes carry a `PARSER_VERSION` bump.
9. No unsupported scope, metric, qualifier, historical coverage gap, or ambiguity is silently dropped.
10. Every credible defect found is recorded in the repository's `issuesFound` ledger.
11. Every codebase change made by the audit is recorded in the existing `CHANGELOG.md`.
12. The final report distinguishes verified, blocked, not-run, and environment-limited checks.
13. Browser answer correctness and browser runtime health are measured independently: a query may satisfy its answer expectation and still fail the audit because of a console/client/hydration error.
14. An intermittent hydration/client failure is not cleared merely because the same query passes when replayed serially.
15. Generated corpus/oracle defects are classified separately from product defects and repaired at the generator/oracle layer rather than in the parser.

---

# Invocation modes

The first argument may be one of:

- `audit` — inspect, reproduce, classify, verify, and document problems; do not edit application source.
- `fix` — reproduce, patch the smallest correct layer, add regression tests, document, and verify.
- `verify` — run the acceptance set and report results without broad code changes.
- `full` — audit the NL system category by category, fix justified defects, expand tests, update audit records, verify against the development database/UI, and run the broader regression suite.

If no mode is supplied, use `full`.

A remaining argument may identify one query, category, or defect. Prioritise that scope first, then run neighbouring regressions.

Documentation files required by this skill are not considered application-source edits. In `audit` mode, it is valid to update the existing `issuesFound` ledger with defects discovered even though application source must remain untouched.

---

# Safety and repository rules

## Local editing workspace

- Primary Windows editing copy: `D:\dev\afldb`.
- Make source/test/documentation edits in this local working tree first.
- Preserve unrelated local content.
- Do not broadly reformat files as part of an unrelated NL fix.
- Do not modify `tools/migration/**` or `*.py` unless the user explicitly authorises migration/import work.
- Do not change source data to make a search test pass.
- Do not deploy production changes.
- Do not write to production data.
- Do not use production as a test target.

## Limited Git access for audit tooling

Git is permitted only for **read-only repository metadata required to execute existing NL audit/stress tooling**.

The V2 stress runner is explicitly allowed to execute:

```text
git rev-parse HEAD
```

If an existing repository-owned NL test/stress script requires another Git command, allow it only when the command is demonstrably read-only and used solely to obtain repository metadata needed by that script.

Examples of acceptable read-only metadata commands when genuinely required by existing tooling:

```text
git rev-parse HEAD
git rev-parse --short HEAD
git rev-parse --show-toplevel
```

Do **not** broaden this permission into general Git investigation.

Unless the user explicitly asks for Git work, still do not:

- run `gh`;
- commit;
- stage/add;
- stash;
- branch/switch;
- merge/rebase;
- checkout/restore/reset;
- cherry-pick/revert;
- pull/fetch/push;
- tag;
- clean;
- modify Git configuration;
- modify files under `.git`;
- use Git history/log/blame as an investigative shortcut;
- use Git to transfer or reconcile source changes.

The audit must not change repository history, index state, branch state, remotes, tags, or working-tree content through Git.

The user reviews working-tree changes first.

Track files changed during the session yourself; do not depend on Git status/diff for the final changed-file report.

A V2 stress run must **not** be classified as blocked merely because `tools/nl/v2-runner.ts` invokes the permitted read-only `git rev-parse HEAD`.

## Search-system invariants

- Natural-language search remains deterministic and LLM-free.
- Reader text must never be interpolated into SQL identifiers.
- New metrics/operations remain closed and allowlisted.
- Preserve `NULL` as "not recorded"; do not silently coerce it to zero.
- Preserve historical club identity semantics.
- Preserve stable numeric player identity.
- Brownlow season/career totals must use the authoritative season-level source where required.
- Tied records must retain every qualifying holder when the product contract requires ties.
- Do not weaken validation, confidence, coverage, or ambiguity protections just to turn a decline into an answer.

## Never make a failure disappear artificially

Do not "fix" an NL problem by:

- deleting/skipping a valid failing test;
- weakening an assertion without evidence the assertion was wrong;
- swallowing exceptions;
- returning fabricated fallback data;
- using arbitrary sleeps as a race fix;
- suppressing hydration warnings;
- increasing timeouts as the sole fix;
- changing `NULL` to zero;
- hiding unsupported coverage;
- bypassing the beta gate, auth, permissions, or other security controls;
- changing the database to agree with a buggy query;
- reducing browser concurrency only to make hydration errors disappear and then calling the issue fixed;
- classifying React hydration recovery as harmless because answer text eventually appears;
- discarding a failing parallel run because an individual serial replay passes;
- changing the NL parser to accept malformed strings produced by a broken corpus generator.

Fix the first wrong layer.

---

# Development server access

The authoritative Linux environment is a **remote development server**. It is not WSL.

## Development targets

- Windows editing workspace: `D:\dev\afldb`
- Development server: `10.0.40.100`
- SSH target: `arm@10.0.40.100`
- Remote AFLDB checkout: `/home/arm/projects/afldb`
- Development application: `http://10.0.40.100:8090`
- Development PostgreSQL database: `afldb_dev`
- Integration-test database: the database referenced by remote `AFLDB_TEST_DATABASE_URL`, which must end in `_test`
- Existing NL UI auth state when valid: `tests/nl-ui/.auth/state.json`

The Windows working tree is the primary editing workspace.

The Linux development server is authoritative for:

- PostgreSQL truth queries;
- PostgreSQL-backed integration tests;
- Linux runtime behaviour;
- production-style build behaviour;
- NL stress execution requiring real data;
- browser verification against the development deployment.

## Do not use WSL as the AFLDB server

Do not probe WSL for `/home/arm/projects/afldb`.

Do not conclude that the authoritative environment is unavailable because:

- Windows lacks `.env`;
- Windows lacks `psql`;
- WSL lacks Node/PostgreSQL;
- WSL has a different home directory.

Try the development server by SSH first.

Use Windows OpenSSH directly:

```powershell
ssh.exe arm@10.0.40.100
```

A safe initial probe is:

```powershell
ssh.exe arm@10.0.40.100 'cd /home/arm/projects/afldb && pwd && command -v node && command -v npm && command -v psql && test -f .env && echo HAS_ENV'
```

If the execution sandbox blocks SSH/network access, request permission for the exact non-destructive SSH command and retry outside the sandbox.

A sandbox access-denied error does not prove the development server is unavailable.

## Secret handling

The development server owns its environment configuration.

Never:

- print `.env`;
- copy `.env` to Windows;
- display a database URL;
- display passwords/tokens;
- print beta/session cookie values;
- copy production credentials;
- manufacture a replacement database URL.

Load environment variables only inside the remote shell:

```bash
cd /home/arm/projects/afldb
set -a
[ -f .env ] && . ./.env
set +a
```

Do not echo secret environment variables after loading them.

## Development database truth queries

Use the development server's `DATABASE_URL` only for read-only truth verification.

Before querying, prove the database target is exactly `afldb_dev`:

```powershell
ssh.exe arm@10.0.40.100 'cd /home/arm/projects/afldb && set -a && . ./.env && set +a && db="$(psql "$DATABASE_URL" -Atqc "SELECT current_database()")" && printf "database=%s\n" "$db" && test "$db" = "afldb_dev"'
```

If the database is not exactly `afldb_dev`, stop.

Truth queries must be explicitly read-only:

```sql
BEGIN READ ONLY;

-- independent verification SQL

ROLLBACK;
```

`DATABASE_URL` / `afldb_dev` may be used to independently verify AFL facts and the semantic result expected from an NL query.

Do not mutate `afldb_dev` during an NL audit.

## Integration tests

Database-backed integration tests must use the remote environment's existing `AFLDB_TEST_DATABASE_URL`.

Never substitute `DATABASE_URL` or `afldb_dev` for `AFLDB_TEST_DATABASE_URL`.

Before running integration tests:

```powershell
ssh.exe arm@10.0.40.100 'cd /home/arm/projects/afldb && set -a && . ./.env && set +a && test -n "$AFLDB_TEST_DATABASE_URL" || { echo "AFLDB_TEST_DATABASE_URL is unavailable"; exit 20; }; db="$(psql "$AFLDB_TEST_DATABASE_URL" -Atqc "SELECT current_database()")"; printf "test_database=%s\n" "$db"; case "$db" in *_test) ;; *) echo "REFUSED: integration database does not end in _test"; exit 21 ;; esac'
```

Only after that guard passes may integration tests run.

Example:

```powershell
ssh.exe arm@10.0.40.100 'cd /home/arm/projects/afldb && set -a && . ./.env && set +a && npm test -- tests/integration/nl-answers-team-club.test.ts'
```

The `_test` database suffix safety rule is mandatory.

## Remote verification of local source changes

Source fixes are made first in:

```text
D:\dev\afldb
```

For authoritative Linux verification, only files changed by the current NL task may be transferred to the development server.

Never blindly synchronise the whole repository.

Never transfer or overwrite:

```text
.git/
.env
node_modules/
.next/
artifacts/
database files
secret files
credential files
```

Do not transfer `tools/migration/**` or `*.py` unless explicitly authorised.

Before the first local edit to a file that may later be tested remotely:

1. read the corresponding remote file;
2. establish that the remote copy represents the same baseline logic;
3. note a checksum when practical.

When transferring a changed file:

1. copy it first to a temporary remote staging directory such as `/tmp/afldb-nl-audit-upload/`;
2. compare the staged file with `/home/arm/projects/afldb/<path>`;
3. confirm the remote destination does not contain unrelated work that would be overwritten;
4. replace only the intended file;
5. never use Git as the transfer mechanism.

If the remote destination contains unrelated changes or its baseline cannot be reconciled safely, do not overwrite it. Report the remote verification step as blocked for that changed file.

`issuesFound.md` and `CHANGELOG.md` are part of the task's changed-file set and should be kept consistent between the local working copy and the remote development checkout if source files are transferred for authoritative verification.

## Development application verification

The development application is:

```text
http://10.0.40.100:8090
```

Use the repository's existing Playwright configuration and, when valid:

```text
tests/nl-ui/.auth/state.json
```

for the beta gate.

Do not print cookie contents.

If the saved beta state is missing, expired, or rejected, and the user has supplied a beta access code in the current session or through a protected environment variable, use that code through the real beta-access UI to establish a temporary browser session.

Beta-code rules:

- do not hardcode a beta code in `SKILL.md`;
- do not write a beta code into source, tests, `issuesFound`, `CHANGELOG.md`, logs, screenshots, traces, or generated corpus files;
- do not print the code;
- do not include it in command-line arguments that are likely to be persisted in shell history when an existing protected input mechanism is available;
- do not commit browser storage state containing beta/session cookies;
- prefer an ephemeral Playwright browser context or temporary storage-state file outside the repository;
- delete temporary auth state at the end of the run when practical;
- if multiple valid codes were supplied, use only one unless authentication fails.

Do not treat an expired saved storage state as an NL-search defect.

For every user-visible NL fix, verify the exact failing question against the development application after the changed source is actually running there.

If the development application requires a rebuild/restart to pick up changes:

1. inspect the repository's documented development deployment/service workflow;
2. identify the development AFLDB service from existing configuration;
3. use the repository-supported development build/restart procedure;
4. restart only the development AFLDB application;
5. do not alter DNS, Caddy configuration, PostgreSQL configuration, systemd unit definitions, or production services merely to run an NL audit;
6. do not guess a service name.

Do not deploy to `afldb.com` or the production application.

## Remote verification priority

For `full` mode, do not report database-backed verification as blocked merely because the Windows shell lacks database tooling.

Expected order:

```text
Windows/source inspection
-> Windows DB-independent parser/plan/description tests
-> Windows typecheck
-> SSH afldb_dev independent truth queries
-> SSH _test database integration tests
-> Playwright targeted UI smoke (>=60)
-> Playwright expanded stratified UI corpus (>=500)
-> full existing 12,000-question UI corpus when present
-> full V2 stress
-> failure replay / DB truth controls
```

Only report the database portion as blocked if the remote development server itself cannot provide the required environment after SSH access has been attempted.

---

# Required audit records

The NL audit is not complete if it finds/fixes an issue but fails to update the repository's issue ledger and changelog.

## `issuesFound` / `issuesFound.md`

The canonical NL defect ledger is the existing root-level `issuesFound` file.

At the beginning of the run:

1. inspect the repository root for an existing file named `issuesFound`, `issuesFound.md`, or the same name with different casing;
2. use the existing file if one exists;
3. do not create a duplicate under different casing;
4. if no existing `issuesFound` ledger exists, create `issuesFound.md` at the repository root.

Do **not** silently substitute a generic `issues.md` file unless the repository already explicitly uses that file as the `issuesFound` ledger. The user's requested audit record is `issuesFound`.

Every credible NL defect discovered must be recorded, including:

- defects fixed immediately;
- description-only defects;
- parser/compiler defects;
- database/data defects;
- UI/runtime defects;
- incorrect declines;
- malformed explanations;
- test/tooling defects that materially limit verification;
- suspicious conditions that remain under investigation;
- blocked verification that prevents a claim of completion.

Do not remove resolved issues. Update their status and preserve their diagnostic history.

If the existing file already has an ID/format convention, preserve it.

If no convention exists, use monotonically increasing IDs:

```text
AFLDB-ISSUE-001
AFLDB-ISSUE-002
...
```

Recommended new-entry format:

```markdown
## AFLDB-ISSUE-### — Short descriptive title

- **Status:** Open | Investigating | Resolved | Blocked | Won't fix
- **Severity:** Critical | High | Medium | Low
- **Area:** NL Search | Parser | Plan | Compiler | Database | Description | UI | Runtime | Tests | Data
- **Found:** YYYY-MM-DD
- **Resolved:** YYYY-MM-DD or N/A
- **Queries:** `exact query`, `variant`
- **Files:** `path/to/file.ts`, `path/to/test.ts`

### Symptom
What the reader/system observes.

### Reproduction
Exact query, command, or UI sequence.

### Expected
Correct semantic behaviour.

### Actual
Observed behaviour.

### Evidence
Relevant plan shape, result value, UI text, error, DB truth, failing test, or code path.

### First wrong layer
Canonicalisation | Entity resolution | Slot extraction | Grain | Validation | Compiler | Database/data | Description | UI/runtime

### Root cause
Technical cause. If not proven, write `Not yet confirmed`.

### Fix
What changed, or `Not yet fixed`.

### Validation
Exact tests/commands and results. Include DB/UI evidence where applicable.

### Follow-up
Remaining risk, related cases, blocked checks, or `None`.
```

For an intermittent hydration/client-runtime issue, also record when available:

- full/expanded corpus baseline count and rate;
- harness concurrency/worker settings;
- exact React/client error code/message;
- serial replay result;
- whether raw failing server HTML exists;
- whether a clean same-query control exists;
- post-fix comparable-run count/rate.

### Update timing

Update the issue ledger during the investigation, not only at the end:

- on credible reproduction: create/update as `Investigating`;
- when root cause is proven: add first-wrong-layer/root-cause evidence;
- when patched: record the fix;
- after validation: set `Resolved` only if the relevant gates pass;
- if verification cannot be completed: use `Blocked` or retain `Investigating` as appropriate.

A defect found and fixed in one session still requires a retained issue entry.

### Example: description-direction defect

A defect such as:

```text
lowest second half score by Essendon
```

returning the correct low value but describing it as:

```text
Highest team score.
```

must be recorded even though the database result itself is correct.

Its first wrong layer is `Description`, and resolution evidence must include the focused description regression plus a real `/search` re-check when available.

## `CHANGELOG.md`

The repository already uses uppercase:

```text
CHANGELOG.md
```

Use that exact existing file.

Do not create a second:

```text
changelog.md
Changelog.md
CHANGELOG.MD
```

on case-sensitive systems.

Update `CHANGELOG.md` for every codebase change made during the audit, including:

- bug fixes;
- parser/vocabulary changes;
- plan/validation changes;
- compiler/query changes;
- description/rendering changes;
- user-visible behaviour changes;
- regression-test additions;
- meaningful test corrections;
- performance changes;
- operational guidance changes;
- audit-skill/documentation changes that materially change project workflow.

Do not add a changelog entry merely for:

- reading files;
- running tests;
- confirming an already-correct behaviour;
- a blocked check when no codebase behaviour/documentation changed.

Match the repository's existing changelog format.

Each change entry should state:

1. what changed;
2. why;
3. the affected NL behaviour;
4. related regression coverage;
5. the related `AFLDB-ISSUE-###` ID where applicable.

Example:

```markdown
- Fixed NL ranked-answer descriptions so `min` aggregations use "Lowest" rather than "Highest" across player, team-match, club-season, player-season and career results (`AFLDB-ISSUE-###`). Added regression coverage for minimum and maximum wording, including `lowest second half score by Essendon`.
```

Do not mark a changelog item as fully fixed if the related issue remains open/blocked.

## Documentation completion gate

Before the final response:

- inspect the current `issuesFound` ledger and confirm every defect discovered in this run appears in it;
- inspect `CHANGELOG.md` and confirm every source/test/documentation change from this run is represented;
- cross-check issue IDs referenced by changelog entries;
- make sure resolved issue entries contain validation evidence;
- ensure blocked checks are not written as passes;
- include both files in the final "Files changed" list whenever they were modified.

If a code fix was made but `issuesFound` or `CHANGELOG.md` is missing its required update, the audit is **not complete**.

---

# Current architecture to preserve

The NL pipeline is:

```text
question
-> canonicalise
-> parser
-> NlQueryPlan
-> validatePlan
-> grain compiler
-> PostgreSQL
-> NlAnswer
-> describe/render
-> /search UI
```

Important source areas include:

- `src/search/nl/parser.ts`
- `src/search/nl/plan.ts`
- `src/search/nl/vocab.ts`
- `src/search/nl/entities.ts`
- `src/search/nl/answer-types.ts`
- `src/search/nl/describe.ts`
- `src/db/queries/nl/`
- `src/db/queries/nl/resolve.ts`
- NL answer/UI components under `src/components/` and `/search`
- `tests/`
- `tools/nl/`
- `docs/search.md`
- schema definitions/migrations when a query depends on stored/derived columns
- `nl_search_log` and NL review tables when available
- `issuesFound` / `issuesFound.md`
- `CHANGELOG.md`

The current plan vocabulary includes or may include:

- grains: `player_career`, `player_game`, `player_season`, `team_match`, `club_season`, `team_streak`, `achievement_summary`
- match scope: club for/against, venue, season range, match type, round number
- period splits: `Q1`, `Q2`, `Q3`, `Q4`, `H1`, `H2`, `FULL_MATCH`
- team streak definitions: win, loss, unbeaten
- team-match aggregation/HAVING support
- player stat allowlists
- tie policy and bounded limits

Do not invent a second representation when an existing plan field correctly models the question.

---

# Core principle: prove where the defect lives

For every failing question, classify the **first incorrect layer**.

Use this order.

## 1. Canonicalisation

Check:

- punctuation;
- slang/filler;
- number interpretation;
- unsupported tokens;
- phrase collision.

Examples:

- Did `50` become a year accidentally?
- Did `at most` collide with `most`?
- Did a filler stripper remove meaningful `one`, `against`, `final`, or another semantic token?

## 2. Entity resolution

Check:

- club;
- historical club identity;
- organisation lineage;
- nickname;
- venue;
- venue alias;
- subject/opponent roles;
- player identity.

Examples:

- Did `Melbourne` get extracted from `Melbourne Cricket Ground` as a club?
- Did `Brisbane Bears` get silently widened to Brisbane Lions?
- Did `Dons` resolve to Essendon?
- Were two clubs reversed?

## 3. Slot extraction

Check every meaningful slot:

- aggregation;
- metric;
- mode;
- match type;
- season;
- round;
- period split;
- streak;
- HAVING/count threshold;
- per-match margin predicate;
- career conditions;
- player mention;
- venue/opponent/club scope.

## 4. Grain election

Determine the required semantic grain:

- player match;
- player season;
- player career;
- one team match;
- grouped team result;
- club season;
- streak;
- achievement summary.

Never patch the compiler to compensate for a plan that chose the wrong grain.

## 5. Plan validation

Ask:

- Does `validatePlan` reject a valid combination?
- Does it accept a combination that a compiler ignores?
- Does it permit a payload/description combination that cannot be rendered meaningfully?
- Can a successful ranked answer reach description code without the metric/entity information it requires?

## 6. SQL compiler

Check:

- every validated plan field is consumed;
- predicates run at the correct grain;
- filtering occurs before ranking/grouping where semantically required;
- one-to-many joins do not multiply aggregates;
- home/away perspective is symmetric where required;
- ties are retained;
- ordering is deterministic;
- historical identities are scoped correctly;
- `NULL` historical data is excluded honestly;
- grouped/HAVING results do not collapse into one arbitrary match.

## 7. Database/data coverage

Check:

- requested stat exists for requested era/grain;
- "no result" is truth rather than missing coverage;
- quarter/half fields exist;
- Brownlow source is authoritative;
- historical identity data supports the requested distinction;
- source data itself is not corrupt.

## 8. Answer description/rendering

Check:

- headline direction (`Highest` / `Lowest`);
- list versus single leader;
- blank metric labels;
- noun/entity wording;
- tie wording;
- payload/metric agreement;
- grouped/HAVING explanation;
- period wording;
- answer value versus described statistic.

Explicit invariant:

```text
agg.kind === 'min' -> wording must express lowest/minimum semantics
agg.kind === 'max' -> wording must express highest/maximum semantics
```

Do not infer semantic direction from incidental result ordering when the canonical plan already carries the aggregation.

## 9. UI/runtime

Check:

- `/search` matches direct execution;
- beta auth/session;
- browser console/page errors;
- hydration;
- stale navigation;
- pending state;
- runtime timeout;
- malformed DOM/prose.

Fix the **first wrong layer**, not a downstream symptom.

---

# Baseline before editing

Before any source change:

1. Read `README.md`, `CHANGELOG.md`, the existing `issuesFound` ledger, `package.json`, `docs/search.md`, and relevant implementation/tests.
2. Record current `PARSER_VERSION`.
3. Inspect the specific parser/plan/vocabulary/compiler/description path.
4. Run the target question through the real `/search` UI when reachable.
5. Capture:
   - question;
   - outcome;
   - displayed headline;
   - interpretation;
   - result rows;
   - caveats/coverage note;
   - parsed/normalised query if exposed;
   - plan token/debug plan if available;
   - browser/runtime errors.
6. Run or add a DB-independent diagnostic that exposes the actual `NlParse`/`NlQueryPlan`.
7. Independently query PostgreSQL for ground truth when the question is database-backed.
8. Only then edit code.

Do not call a question fixed because the AST looks correct.

---

# Database-grounded truth checks

Use PostgreSQL on the development server as the source of truth.

Before writing a truth query, inspect the real schema. Do not guess column names.

Useful inspection patterns:

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1, 2;

SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_name IN (
    'matches',
    'player_match_stats',
    'player_season_stats',
    'player_career_stats',
    'club_seasons',
    'clubs',
    'club_aliases',
    'venues',
    'venue_aliases',
    'brownlow_results'
  )
ORDER BY table_schema, table_name, ordinal_position;
```

For each sample query, write an **independent SQL truth query** that does not simply copy the NL compiler SQL.

Truth-query rules:

- use stable IDs/organisation IDs once resolved;
- for exact games, identify the match first, then rank inside it;
- for team records, correctly model both team perspectives from canonical home/away rows;
- for round queries, verify round type and number;
- for finals, verify stored phase/round semantics;
- for historical aliases, distinguish identity-specific from organisation-lineage questions;
- for quarter/half calculations, prove the calculation from score progression;
- for streaks, use chronological match order and define breaks explicitly;
- for grouped team counts, use `GROUP BY ... HAVING`;
- for margin-threshold counts, apply the margin predicate before grouping/counting;
- for Brownlow season totals, use authoritative Brownlow season/results data.

Treat user-supplied expected answers as hypotheses until verified.

---

# Playwright/UI verification

Browser verification is mandatory for any user-visible NL fix when the development UI can be safely exercised.

Use existing Playwright configuration/helpers.

Inspect actual project tooling before inventing commands:

```bash
ls -la playwright*.config.*
find tests -maxdepth 3 -type f | sort | grep -Ei 'playwright|search|nl'
find tools/nl -maxdepth 3 -type f | sort
```

For each target query:

1. navigate to `/search`;
2. enter the exact query;
3. submit using the real reader control;
4. wait for observable NL answer state, not an arbitrary sleep;
5. assert no browser console/page error;
6. capture/assert headline and interpretation;
7. assert key result values and labels;
8. assert ties where applicable;
9. assert a correct decline for unavailable coverage;
10. reject malformed prose such as:
   - `Highest .`
   - `Lowest .`
   - team/grouped results saying `every player`
   - a `min` query described as `Highest`
11. for grouped/HAVING queries, assert grouped club rows/counts;
12. for `team_score`, assert displayed value equals the independently verified selected-team score;
13. use screenshots/traces only as diagnostic evidence, not as a substitute for text assertions.

Prefer semantic locators.

Do not use arbitrary `waitForTimeout()` as a correctness mechanism.

## Aggressive Playwright audit in `full` mode

In `full` mode, Playwright is a first-class correctness oracle for the rendered `/search` experience, not merely a final smoke check.

Use the existing NL UI harness where possible. Extend its input corpus when necessary rather than writing a separate one-off browser script that bypasses existing instrumentation.

Run the browser audit in escalating phases:

### Phase 1 — targeted high-risk smoke

Run at least 60 deliberately chosen questions spanning every supported/high-risk semantic class.

The smoke set must include:

- min and max direction pairs;
- exact season + round;
- two-club match scope;
- finals and Grand Finals;
- venues and venue aliases;
- historical club identities;
- player game/season/career;
- team-match records;
- grouped/HAVING counts;
- per-match margin thresholds before grouping;
- streaks;
- quarter/half splits;
- Brownlow season totals;
- advanced stat acronyms;
- slang/nicknames;
- ties;
- declines for unavailable data;
- ambiguous or collision-prone wording;
- malformed-input resilience;
- at least one query from every acceptance category in this skill.

### Phase 2 — expanded stratified UI corpus

Generate or assemble at least **500 unique browser queries** by crossing semantic dimensions rather than by random word noise.

Use combinations of:

- aggregation: highest, lowest, most, fewest, top N, list/count;
- operator: `>`, `>=`, `<`, `<=`, exact;
- grain: player game, player season, player career, team match, club season, streak;
- club role: for, against, both clubs;
- era: exact season, since, before, range, all-time;
- round: exact round, finals, Grand Final;
- venue: canonical name and alias;
- period: Q1, Q2, Q3, Q4, H1, H2, full match;
- metric: common and advanced allowlisted stats;
- phrasing: formal, slang, abbreviations, punctuation variation, singular/plural;
- alias: club nickname, historical identity, venue alias;
- tie likelihood;
- supported versus intentionally unsupported combinations.

The expanded set must contain both:

- metamorphic equivalents that should converge on the same plan/answer; and
- near-neighbour non-equivalents that must remain semantically distinct.

Do not generate meaningless strings only to inflate the count.

### Phase 3 — full existing UI corpus

If the repository contains a 12,000-question NL UI corpus/harness, run the **full corpus** in `full` mode after the targeted and expanded phases are stable.

Do not stop at observing 44 of 12,000 questions and call that the full UI corpus.

Use the repository's existing safe concurrency defaults. If the harness exposes concurrency, keep it at or below the project's known-safe level unless the task is explicitly a load test.

Capture:

- total attempted/observed;
- semantic/expectation passes;
- semantic/expectation failures;
- visible declines;
- data-coverage limitations;
- stale-oracle/policy rows;
- HTTP failures;
- page errors;
- console/client errors;
- hydration errors;
- timeouts;
- malformed answer text;
- query/result mismatches;
- report/output paths.

Report semantic expectation failures and runtime/hydration errors separately. A row may belong to both dimensions.

### Phase 4 — failure replay and controls

For every Playwright failure:

1. save the exact query;
2. classify whether failure is parser, compiler, data, description, UI, hydration, timeout, or auth/environment;
3. preserve raw server HTML when hydration is implicated;
4. preserve a screenshot/trace when useful;
5. rerun the same query individually;
6. rerun a semantically equivalent phrasing;
7. run a clean neighbouring control;
8. independently verify PostgreSQL truth when the answer is database-backed.

Intermittent failures must not be dismissed because one replay passes.

For hydration/client failures specifically, a serial replay passing changes the diagnosis to intermittent/load-sensitive; it does not change the original failure to PASS.

### Browser assertions

For every successful answer that is sampled deeply, assert as applicable:

- headline is non-empty and semantically correct;
- interpretation matches the plan;
- min/max wording direction is correct;
- entity noun matches the result grain;
- result values match expected payload shape;
- ties are complete;
- grouped results display counts/groups rather than one match;
- period labels and values agree;
- no `Highest .`, `Lowest .`, `Top N by .`, `undefined`, or `[object Object]`;
- no player-specific wording on team/grouped answers;
- no stale previous-query result after navigation;
- no page/console/hydration error.

### Search-term expansion ledger

When new high-value queries are generated during the audit:

- add durable regression-worthy cases to the appropriate existing corpus/test fixture;
- do not add thousands of redundant permutations to source control;
- keep large generated runs in existing generated-output/corpus locations;
- record newly discovered semantic families in `issuesFound` when they expose a defect;
- document meaningful permanent corpus/test expansion in `CHANGELOG.md`.

## Hydration and client-runtime audit

Hydration/client errors are a separate correctness dimension from NL semantic expectations.

A browser row may count as semantically correct while still recording a React/client/hydration error. Do not merge those dimensions into one pass percentage.

Treat any unexplained hydration/client error as an open runtime defect until classified. This includes React minified hydration errors such as `#418`, recoverable hydration warnings, client exceptions, and server/client tree mismatches even when React recovers and visible answer text appears correct.

### Required run metadata

For every expanded/full UI run record enough information to reproduce the load shape:

- parser version;
- application build/version identifier when available;
- corpus path/version;
- run tag;
- total questions;
- Playwright worker/process count;
- harness concurrency;
- navigation/reuse strategy if relevant;
- target base URL;
- timestamp;
- server worker count when known;
- relevant runtime limits when known;
- output/report directory.

Do not expose secrets while capturing metadata.

### Hydration failure capture

When a hydration/client error occurs in the varied or parallel corpus:

1. preserve the exact query and corpus row/index;
2. preserve browser console text/error classification;
3. preserve page URL/search params and visible NL state;
4. capture the **raw server HTML for the failing request** before hydration when the harness can do so;
5. capture the post-hydration DOM or relevant rendered text;
6. capture screenshot/trace when useful;
7. capture parser version/build identity associated with the run;
8. save a same-query clean control when one can be obtained;
9. save a neighbouring clean query/control;
10. correlate repeated failures by query, worker/process, timing, and run position when possible.

Prefer adding this capture to the real corpus harness so evidence is collected at the moment the intermittent failure occurs. Do not rely solely on a bespoke repeated-query script when the defect only reproduces under sustained varied traffic.

### Serial replay is diagnostic, not clearance

If a hydration failure passes when replayed individually or serially:

- record the serial pass;
- keep the original parallel failure valid;
- classify the issue as concurrency/load-shape/intermittent until disproven;
- continue investigation using the real failing harness conditions.

A serial 8/8 or 100/100 pass does **not** close a defect that reproduces under the expanded/full concurrent corpus.

### Compare failing HTML with a clean control

For a reproducible hydration family, compare:

```text
failing varied/parallel request
-> raw server HTML
-> hydrated/client DOM

same query clean control
-> raw server HTML
-> hydrated/client DOM
```

Look for:

- unstable element order;
- missing/extra nodes;
- differing text/value formatting;
- unstable keys/component identity;
- browser-only values entering initial render;
- non-deterministic ordering of tied results;
- search-param interpretation differences;
- stale previous-query state;
- RSC/client boundary differences;
- revalidation/tree replacement;
- data/result differences between server render and hydration;
- concurrent request/build/cache interactions.

Fix the first wrong boundary. Do not add `suppressHydrationWarning` unless the mismatch is deliberate and documented.

### Before/after validation for a hydration fix

Preserve the pre-fix full-corpus baseline in the issue ledger. The baseline is evidence, not a permanent acceptable threshold.

After a hydration/runtime patch:

1. rerun the exact failing examples;
2. rerun the expanded >=500 corpus at the **same concurrency/load shape** used to reproduce the problem;
3. rerun the same full UI corpus with the same harness configuration;
4. compare hydration/client-error counts and rates before versus after;
5. verify semantic/expectation results did not regress;
6. if the defect is intermittent, run another comparable full/expanded pass when practical before calling it resolved.

Do not validate a concurrency-sensitive fix only with serial execution.

A fix is not proven merely because the hydration rate decreased. Unexplained remaining errors stay open and must be classified.

## Generated corpus and oracle quality

Generated test inputs are part of the audit system and can themselves be wrong.

Before interpreting a large failure cluster as an NL product defect, inspect the generated questions/oracles for systematic generator mistakes such as:

- doubled plurals (`goalss`, `markss`, `handballss`);
- invalid singular/plural transforms;
- malformed aliases;
- impossible/self-contradictory scope produced accidentally;
- stale policy expectations;
- expectations for intentionally unsupported semantics;
- outdated ambiguity policy;
- outdated parser-version assumptions.

When the generator/oracle is wrong:

1. fix the generator/oracle, not the parser;
2. add focused regression coverage for the generator rule;
3. regenerate the affected corpus/output where appropriate;
4. rerun the affected audit slice;
5. record the tooling/oracle defect in the issue ledger when it materially distorted audit results;
6. record permanent generator/test changes in `CHANGELOG.md`.

Keep product correctness metrics separate from invalid generated-row counts.

---

# Parser and plan regression tests

Every parser fix needs direct plan-shape coverage.

Assert the complete semantic shape that matters, not merely:

```text
status === "plan"
```

Example:

```ts
expect(plan).toMatchObject({
  grain: 'player_game',
  metric: 'hitouts',
  agg: { kind: 'max' },
  scope: {
    clubFor: { slug: 'richmond' },
    clubAgainst: { slug: 'essendon' },
    roundNumber: 5,
    seasonMin: 1984,
    seasonMax: 1984,
  },
});
```

Also assert meaningful fields are not absent.

For every new semantic rule, add:

- exact failing phrasing;
- at least 2-3 equivalent/metamorphic variants;
- a neighbouring non-equivalent case;
- collision/negative cases.

Important collision pairs include:

- `most` vs `at most`;
- `win` vs `wins`;
- `loss` vs `losses`;
- `final` match scope vs career `finals`;
- `inside 50` metric vs number/year parsing;
- `Melbourne` vs `Melbourne Cricket Ground`;
- `Brisbane` lineage vs `Brisbane Bears`;
- `v`, `vs`, `versus`, `against`;
- `highest`, `most`, `biggest`, `fewest`, `lowest`;
- singular/plural stat names;
- current/historical venue aliases.

---

# Compiler regression tests

For every plan field involved in a compiler fix, add a database-backed test proving the compiler consumes it.

At minimum compare:

- baseline plan without the field;
- plan with the field;
- expected difference against real data.

This is particularly important for:

- `roundNumber`;
- `periodSplit`;
- `havingClause`;
- streak definition;
- match type;
- opponent;
- venue;
- season bounds;
- margin thresholds;
- historical club identity.

---

# Regression classes to verify first

Do not assume these are currently broken. They are known high-risk classes that must remain covered.

## Ranked direction wording

Queries such as:

```text
lowest second half score by Essendon
highest second half score by Essendon
```

must produce semantically matched direction wording.

A correct low value with:

```text
Highest team score.
```

is a real user-facing correctness defect even though parser/SQL are correct.

## Team-score identity

For full-match `team_score`:

```text
payload.value == selected club's actual final score
```

It must not equal:

- home + away total;
- opponent score;
- cumulative total across matches;
- wrong-period checkpoint;
- grouped count.

For period splits, value must equal the selected team's points during that period.

## Metric labels may never disappear

A successful ranked answer must never render:

```text
Highest .
Lowest .
Top 10 by .
```

If the answer is a grouped/list operation without a ranked metric, route it to a grouped/list description path rather than interpolating an empty metric.

## Entity nouns must match grain

A team-match, team-streak, club-season, or grouped-team answer must not use player-specific tie wording.

Use semantically appropriate nouns:

- player grain -> player(s)
- team-match -> match(es) or team/club as appropriate
- team-streak -> club/streak
- grouped team -> team/club
- club-season -> club season

## Grouped queries must not collapse into one arbitrary match

Examples:

```text
teams with more than 3 wins against the Lions
teams with at least 10 wins at the SCG
```

must return grouped team rows with qualifying counts.

They must not return one incidental high-scoring match.

## Payload-description agreement

For every answer:

- `payload.kind` must match `plan.grain`;
- `payload.value` must mean the same statistic as `plan.metric` where a metric applies;
- the formatter must fit the payload;
- explanation must describe the SQL operation actually performed;
- tie wording must identify the correct holder type;
- grouped/HAVING result must be described as grouped/count-filtered, not as a ranked match record.

---

# Required sample acceptance suite

Use these as the first acceptance corpus. Do not hardcode answers except where the answer has been independently verified.

## A. Exact game, round, and match type

- `most hit out Richmond v Essendon Round 5 1984`
  - expected leader supplied by user: Mark Lee — 29 hitouts
  - independently verify in `afldb_dev`
- `most disposals Collingwood v Carlton Round 1 2010`
- `highest score by Geelong in Round 15 2008`
- `most goals in a Grand Final`
- `fewest points scored in a final at the MCG`
- `Hawthorn highest score in Round 3`

Check:

- season+round scoping;
- two-club role assignment;
- finals/grand-final scope;
- venue+match-type intersection;
- round without season stays multi-season.

## B. Period/quarter splits

- `highest H2 score by the Magpies`
- `lowest second half score by Essendon`
- `highest second half score by Essendon`
- `most goals in Q1 by a player`
- `biggest win margin in a first half`
- `highest team score in Q3`
- `most disposals in the fourth quarter in 2023`

Check:

- Q1 = quarter-time score;
- Q2 = half-time minus quarter-time;
- Q3 = three-quarter-time minus half-time;
- Q4 = final minus three-quarter-time;
- H1 = half-time score;
- H2 = final minus half-time;
- period margin compares the same checkpoint/split for both teams;
- player-quarter stats must decline honestly if not stored;
- min/max description direction is correct.

## C. Team streaks

- `richmond's longest winning strea`
- `longest winning streak against the Blues`
- `Swans longest losing streak at the SCG`
- `longest unbeaten streak in finals`
- `Hawthorn longest winning streak at Waverley`
- `longest losing streak against Collingwood`

Check:

- chronology;
- club/opponent/venue/finals scope;
- draws continue unbeaten;
- draws break pure win/loss streaks unless semantics explicitly say otherwise;
- typo support remains narrow and collision-safe.

## D. HAVING, grouped counts, and margin predicates

- `teams with more than 3 wins against the Lions`
- `teams to lose 5 times by more than 100 points`
- `teams with at least 10 wins at the SCG`
- `teams with more than 5 losses against Geelong since 2000`

Check:

- filtering before grouping;
- `gt` vs `gte`;
- margin threshold applies per qualifying match before count;
- grouped output includes count;
- no incidental score becomes fallback metric;
- explanation identifies grouped/count filtering.

If the current plan shape cannot cleanly express both a group count and per-match predicate, extend the plan explicitly rather than smuggling meaning into strings.

## E. Historical aliases, slang, and venues

- `Bloods biggest win at Marvel`
- `Dons biggest blowout win at Optus Stadium`
- `fewest points scored by the Bears at UTAS`
- `Pies highest score at Kardinia`
- `Suns biggest margin at the Gabba`

Check:

- nickname resolution;
- historical identity versus organisation lineage;
- venue aliases through maintained DB aliases;
- Brisbane Bears is not silently rewritten to modern Brisbane Lions when identity-specific wording is used.

## F. Advanced player stats/acronyms

- `most contested possessions in a game`
- `most uncontested possessions in a season`
- `most inside 50s in a match`
- `most clearances in a game by a Carlton player`
- `most brownlow votes in a season`
- `most rebound 50s in a final`
- `most goal assists in a match`

Check:

- allowlisted metric key;
- correct grain;
- club/match-type scope;
- era coverage;
- authoritative Brownlow season source;
- no `NULL -> 0`.

## G. Career/milestone

- `players with more than 300 games and 500 goals`
- `most goals on debut`
- `most premierships with 3+ clubs`
- `most games without a final`

Check:

- multiple career conditions remain together;
- `more than` is strict `gt`;
- debut is first-match boundary, not debut season;
- `3+ clubs` is career condition while premierships is ranking metric;
- `without a final` means finals = 0, not a match-type scope.

---

# Semantic target examples

Adapt to actual type definitions.

## Exact Richmond v Essendon match

```json
{
  "grain": "player_game",
  "metric": "hitouts",
  "agg": { "kind": "max" },
  "scope": {
    "clubFor": { "name": "Richmond", "slug": "richmond" },
    "clubAgainst": { "name": "Essendon", "slug": "essendon" },
    "roundNumber": 5,
    "seasonMin": 1984,
    "seasonMax": 1984
  }
}
```

## Collingwood second-half score

```json
{
  "grain": "team_match",
  "metric": "team_score",
  "periodSplit": "H2",
  "agg": { "kind": "max" },
  "scope": {
    "clubFor": { "name": "Collingwood", "slug": "collingwood" }
  }
}
```

## Teams with more than three wins against Brisbane Lions

```json
{
  "grain": "team_match",
  "havingClause": {
    "metric": "wins",
    "op": "gt",
    "value": 3
  },
  "agg": { "kind": "list" },
  "scope": {
    "clubAgainst": { "name": "Brisbane Lions", "slug": "brisbane-lions" }
  }
}
```

## Longest winning streak against Carlton

```json
{
  "grain": "team_streak",
  "streakDefinition": { "kind": "win" },
  "agg": { "kind": "max" },
  "scope": {
    "clubAgainst": { "name": "Carlton", "slug": "carlton" }
  }
}
```

---

# Expansion strategy

When the sample suite is stable, expand systematically.

For each semantic feature, vary:

- aggregation: max / min / top N / list / count;
- grain: game / season / career / team match / streak;
- club role: for / against / both clubs;
- venue: none / named / alias;
- time: all-time / exact season / since / range;
- match type: H&A / final / grand final / specific final;
- period: full / quarter / half;
- wording: formal / slang / abbreviation;
- operator: `>`, `>=`, `<`, `<=`, `=`;
- singular/plural and punctuation variants.

Prefer several strong variants per semantic rule over hundreds of mechanically duplicated strings.

Then run the existing larger NL corpus/stress tooling.

---

# Metamorphic tests

Equivalent wording should produce the same canonical plan or semantic answer.

Examples:

- `Richmond v Essendon` == `Richmond vs Essendon` == `Richmond versus Essendon`
- `Dons` == `Essendon`
- `Pies` == `Collingwood`
- `Q4` == `fourth quarter`
- `H2` == `second half`
- `most` == `highest` when metric semantics match
- `more than 3` == `> 3`
- `at least 10` == `>= 10`
- `rebound 50s` == `R50s`
- `inside 50s` == `I50s`

Non-equivalent wording must remain different:

- `at most 20` != `most 20`
- `win` != `wins` when one is match-margin and the other tally
- `Brisbane Bears` != `Brisbane Lions` when historical identity matters
- `a final` != `finals played`
- `on debut` != `in debut season`
- `most goals in a Grand Final` != `most Grand Finals`
- `lowest` != `highest`

---

# Parser-version rule

Any parser vocabulary or decision-logic change that alters outcomes must increment `PARSER_VERSION` in the same change.

Update the version-history comment with:

- old defect;
- why it happened;
- semantic fix;
- meaningful regression/example;
- whether outcome, plan shape, or failure classification changed.

Do not bump parser version for a pure description-only fix unless parser output changes.

---

# Performance checks

Correctness comes first.

For new or materially changed SQL/compiler paths:

- measure on the development environment;
- inspect query predicates/grouping/ranking first;
- use `EXPLAIN (ANALYZE, BUFFERS)` only on safe development/test targets;
- confirm filtering occurs before ranking/grouping where possible;
- inspect existing indexes before proposing new ones;
- avoid per-row correlated work when a grouped CTE/window is clearer;
- preserve result limits/tie policy.

Do not add an index merely because a query looks complex.

A semantically correct query that routinely times out is incomplete.

Record meaningful before/after performance evidence in `issuesFound` and `CHANGELOG.md`.

---

# How to patch

Prefer the smallest coherent change.

| Finding | Correct place to change |
|---|---|
| New nickname/synonym only | `vocab.ts` or maintained alias table |
| Club/venue resolves wrongly | entity/alias resolution |
| Words understood but roles wrong | `parser.ts` |
| Needed semantic field absent | `plan.ts` + validation + parser + compiler |
| Plan correct but answer wrong | grain compiler |
| SQL/result correct but headline/interpretation wrong | `describe.ts` |
| Correct decline due to unavailable era | coverage metadata/message |
| UI differs from direct answer | answer component/search page/runtime |
| Database truth itself wrong | document separately; do not hide in NL logic |

Do not solve a missing plan concept by encoding structured meaning into arbitrary strings.

---

# Progressive verification

Discover actual scripts from `package.json`; do not assume names.

On Windows PowerShell, if `npm.ps1` is blocked by execution policy, use `npm.cmd`.

Recommended sequence:

## 1. Focused DB-independent tests

Examples:

```powershell
npm.cmd test -- tests/nl-describe.test.ts
npm.cmd test -- tests/nl-plan.test.ts
npm.cmd test -- tests/nl-parser.test.ts
```

Run only files that actually exist.

## 2. Typecheck

```powershell
npm.cmd run typecheck
```

## 3. Focused remote DB-backed integration

Use SSH and the guarded `_test` environment.

## 4. Independent `afldb_dev` truth query

For exact database-backed claims.

## 5. Exact `/search` reproduction

Test the original query against the development deployment.

## 6. Neighbouring regressions

At minimum for a semantic fix:

- exact failing query;
- 3 neighbouring/equivalent variants;
- 2 negative/collision cases.

For a pure description-direction fix, explicitly include both min and max cases.

## 7. Broader NL suites and full V2 stress

Run relevant parser/regression/stress/UI corpus suites.

In `full` mode:

1. run the targeted Playwright UI smoke;
2. run the expanded >=500-query stratified browser corpus;
3. run the repository's full 12,000-question UI corpus when present;
4. run the full V2 stress suite when the repository contains the runner and its required development database/runtime is available.

Do not substitute the smaller browser smoke for the full UI corpus.

The runner may use the narrowly permitted read-only Git metadata command:

```text
git rev-parse HEAD
```

Do not skip V2 solely because of that command.

Capture and report at least:

- total cases attempted;
- semantic correctness;
- answer correctness;
- metamorphic consistency;
- hard failures;
- soft failures/declines where reported;
- runtime/errors;
- output/report location.

If V2 cannot run for some reason other than the allowed Git metadata lookup, classify the actual reason as `BLOCKED` and preserve the exact evidence.

## 8. Lint/build

Use only repository-defined non-interactive commands.

If `npm run lint` launches an interactive/deprecated Next.js ESLint migration prompt, record that as a tooling limitation. Do not claim lint passed and do not interactively rewrite lint configuration as part of an NL bug fix unless explicitly requested.

Run build when relevant and safely configured.

## 9. Live UI smoke

Verify:

- exact corrected query;
- inverse/min-max counterpart;
- grouped/HAVING;
- tie wording;
- one normal player record;
- no malformed `Highest .` / `Lowest .`;
- no browser console/page errors for sampled paths.

---

# Full-mode category audit

In `full` mode, do not stop after the first defect.

Audit category by category:

1. canonicalisation/collisions;
2. club/player/venue entity resolution;
3. aggregation/operators;
4. match/round/season scope;
5. period splits;
6. player game;
7. player season;
8. career conditions;
9. team match;
10. grouped/HAVING;
11. streaks;
12. finals/match types;
13. historical club identities;
14. advanced metrics/coverage;
15. answer payload/description;
16. ties;
17. UI/browser rendering;
18. runtime/performance;
19. decline correctness;
20. metamorphic consistency;
21. targeted Playwright UI audit;
22. expanded stratified Playwright corpus;
23. generated-corpus/oracle quality;
24. hydration/client-runtime stability under varied/concurrent traffic;
25. full existing 12,000-question UI corpus when present;
26. full V2 stress/corpus execution when the repository runner and required development environment are available.

For each category, classify:

- verified clean;
- defect found/fixed;
- defect found/open;
- blocked;
- intentionally unsupported;
- data-coverage limited;
- stale corpus/oracle;
- intermittent runtime/hydration defect.

Do not manufacture source changes to make a full audit look productive. A clean category is a valid result.

---

# Issue severity guide

Use impact, not implementation difficulty.

## Critical

Examples:

- security/authorisation bypass;
- secret exposure;
- production data corruption;
- arbitrary SQL/code execution;
- beta-gate bypass.

## High

Examples:

- materially wrong historical/statistical answer presented as correct;
- widespread compiler/query family failure;
- incorrect data source that materially changes published records.

## Medium

Examples:

- incorrect answer in a limited supported query class;
- grouped query returns wrong grain;
- repeated decline of valid common queries;
- reproducible user-visible runtime/hydration failure.

## Low

Examples:

- misleading description with correct data;
- malformed non-data wording;
- minor edge case;
- test/tooling defect that does not affect runtime correctness.

The `lowest second half score by Essendon` value-correct/wording-wrong defect is normally Low severity unless broader evidence shows the same description bug materially misrepresents many result classes.

---

# Reporting format

At the end of `audit`, `fix`, `verify`, or `full`, report:

## Summary

- mode;
- categories inspected;
- queries tested;
- correct;
- wrong answers;
- wording/description defects;
- incorrect declines;
- correct declines/coverage limitations;
- runtime/UI failures;
- hydration/client errors (separate from semantic failures);
- stale corpus/oracle rows;
- data-coverage rows;
- defects fixed;
- defects still open.

## Defects found

For each:

- `AFLDB-ISSUE-###`;
- exact query;
- observed result;
- independent DB truth if applicable;
- first incorrect layer;
- root cause;
- severity;
- files involved;
- status.

## Changes made

List each local file changed and semantic reason.

Always include `issuesFound` and `CHANGELOG.md` if modified.

Do not report Git commits.

## Verification

List exact commands/checks and results.

Distinguish:

- PASS;
- FAIL;
- BLOCKED;
- NOT RUN;
- NOT REQUIRED.

For DB-backed truth, include concise evidence such as:

```text
Richmond v Essendon, Round 5 1984 -> Mark Lee, 29 hitouts (verified directly in afldb_dev).
```

For `full` mode, report browser and V2 results separately.

Browser reporting must include:

- targeted smoke attempted/passed/failed;
- expanded corpus attempted/semantic-passed/expectation-failed;
- full UI corpus attempted/observed/semantic-passed/expectation-failed when present;
- visible declines;
- data-coverage limitations;
- stale corpus/oracle/policy rows;
- HTTP failures;
- page errors;
- console/client errors;
- hydration errors and hydration-error rate;
- timeouts;
- malformed-answer detections;
- harness concurrency/worker configuration;
- parser version/build identity;
- output/report paths.

Do not report a single combined `passed` number as if it covers both semantic correctness and browser-runtime stability.

If hydration/client errors occurred, report:

- how many reproduced under parallel/varied traffic;
- how many passed serial replay;
- whether raw failing server HTML was captured;
- whether a same-query clean control was captured;
- current issue/status.

V2 reporting must include corpus size and key semantic/answer/metamorphic metrics. If it was not run, state the precise blocker; the permitted read-only `git rev-parse HEAD` command is not itself a blocker.

## Audit records

State explicitly:

```text
issuesFound: updated / unchanged (reason)
CHANGELOG.md: updated / unchanged (reason)
```

If a defect was found, `issuesFound` should not be `unchanged`.

If code/test/documentation behaviour was changed, `CHANGELOG.md` should not be `unchanged`.

## Remaining gaps

Separate:

- parser/feature gaps;
- compiler gaps;
- data coverage limitations;
- data-quality defects;
- performance concerns;
- UI/runtime gaps;
- hydration/client-runtime stability;
- corpus-generator/oracle debt;
- intentionally unsupported ambiguity;
- environment/tooling blocks.

---

# Completion standard

Do not declare the work complete until all applicable conditions are met:

- every user-supplied sample question has a classified result;
- known high-risk team/grouped/period/description regression classes are covered;
- no successful answer can emit blank ranked metric labels;
- no team/grouped answer uses player-specific tie wording;
- min/max ranked descriptions agree with the canonical aggregation;
- every fixed DB-backed question is verified against `afldb_dev` when the remote environment is available;
- DB-backed integration tests use only the guarded `_test` database;
- every fixed user-visible path is exercised through the real `/search` UI when deployable safely;
- meaningful plan fields have compiler coverage;
- no fixed phrase leaves a known collision regression;
- parser versioning is correct;
- the broader NL suite shows no unexplained regression;
- in `full` mode, the targeted Playwright smoke has covered at least 60 high-risk questions unless a concrete environment blocker is recorded;
- in `full` mode, an expanded stratified Playwright corpus of at least 500 meaningful unique questions has been exercised unless a concrete environment blocker is recorded;
- in `full` mode, the repository's full 12,000-question UI corpus has been run when that corpus/harness exists and the development UI is available;
- full-mode browser results report semantic expectation failures separately from console/client/hydration failures;
- a full NL audit is **not clean** while unexplained hydration/client errors remain above zero, even if all associated answer assertions eventually pass;
- serial replay success does not close an error that reproduces under the real varied/concurrent harness;
- when a hydration/runtime fix is made, validation repeats the same expanded/full corpus at comparable concurrency/load shape and records before/after counts;
- systematic invalid generated questions/oracles are fixed at the generator/oracle layer and excluded from product-defect conclusions after revalidation;
- in `full` mode, the V2 stress runner has been executed when its required development environment is available; its permitted `git rev-parse HEAD` metadata lookup is not a valid reason to skip it;
- every credible defect found is present in the existing `issuesFound` ledger;
- resolved issue records include root cause, fix, and validation;
- every code/test/documentation change made by the run is represented in `CHANGELOG.md`;
- no blocked/unrun check is presented as passed;
- final report lists every changed file;
- no secrets, temporary debug output, or generated forensic artefacts were accidentally added to tracked project files.

When an open hydration/runtime issue already has a full-corpus baseline, preserve that baseline in the issue ledger before changing code. Use the same corpus and comparable harness settings for the post-fix comparison. Do not encode one historical error rate as an acceptable permanent threshold.

If a query cannot be answered from stored data, say which required field/grain/era is unavailable and decline honestly.

A safe, precise refusal is better than a confident answer built from the wrong statistic.

A clean full audit with zero source changes is also a valid outcome, but any defect discovered during that audit must still be documented in `issuesFound`.
