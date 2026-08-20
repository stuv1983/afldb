---
name: afldb-nl-search-audit
description: Review, debug, expand, regression-test, document, and verify AFLDB's deterministic natural-language search against the real PostgreSQL development data and the real /search UI. Use for parser, plan, SQL compiler, alias, coverage, answer-rendering, NL-search regression, audit, and repair work. Maintain issues.md and CHANGELOG.md when defects or codebase changes are found.
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

## Leave Git untouched

Unless the user explicitly asks for Git work:

- do not run `git`;
- do not run `gh`;
- do not inspect or mutate `.git`;
- do not commit;
- do not stage;
- do not stash;
- do not branch;
- do not merge/rebase;
- do not checkout/restore/reset;
- do not pull/fetch/push;
- do not use Git history as an investigative shortcut.

The user reviews the working-tree changes first.

Track the files changed during the session yourself so the final report does not depend on Git.

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
- changing the database to agree with a buggy query.

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
-> development /search UI
-> broader NL regression/stress/UI suite
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

## 7. Broader NL suites

Run relevant parser/regression/stress/UI corpus suites.

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
20. metamorphic consistency.

For each category, classify:

- verified clean;
- defect found/fixed;
- defect found/open;
- blocked;
- intentionally unsupported;
- data-coverage limited.

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
- every credible defect found is present in the existing `issuesFound` ledger;
- resolved issue records include root cause, fix, and validation;
- every code/test/documentation change made by the run is represented in `CHANGELOG.md`;
- no blocked/unrun check is presented as passed;
- final report lists every changed file;
- no secrets, temporary debug output, or generated forensic artefacts were accidentally added to tracked project files.

If a query cannot be answered from stored data, say which required field/grain/era is unavailable and decline honestly.

A safe, precise refusal is better than a confident answer built from the wrong statistic.

A clean full audit with zero source changes is also a valid outcome, but any defect discovered during that audit must still be documented in `issuesFound`.
