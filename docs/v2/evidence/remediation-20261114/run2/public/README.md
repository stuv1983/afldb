# Remediation run 2 — scope `public`

Branch `claude/rem2-public-20261114` from `e8666c17`. Code commits (qualified): `5b3c20a2`, `3426d393`, `2ddc6551`,
`b072c162`; this README is the only commit after them (docs only). Host `/mnt/ssd/afldb-rem2-public-20261114`, port 55654,
databases `afldb_v2_rem2public_*_test`, one fresh `--template` copy of the verified snapshot (sha256 `e77c307d…2826d`,
30,141,895 bytes, ledger 118) per experiment. Raw outputs: `raw/` (ANSI stripped, DSN lines removed, LF), screenshots
`visual/`, scripts `scripts/*.txt`; `SHA256SUMS` lists every committed file (verify with `git cat-file blob HEAD:<path> |
sha256sum`). `HOST-PACK-SHA256SUMS` is the host manifest of the same files before two superseded outputs were dropped.

## 1. Findings

| Task | Verdict | Evidence |
|---|---|---|
| B-03 "round" surname | **validated, amended** | The review's own example is wrong: "how many goals did round kick" declined before ISSUE-356 too (`raw/probe-pre356-b03.jsonl`: unsupported `round kick`, because "kick" is a leftover token; "how many goals did barry round kick" declines the same way, so the wording is unsupported for any player). What ISSUE-356 broke is the shapes where the span is only "round": "round's career goals", "round most goals", "round brownlow votes". The word list was added (`b85393aa`) because "most goals in a round" answered **Barry Round — 293 goals** and "most disposals in a round" **Barry Round — 4,857** at confidence 1 (pre-356 probe). |
| B-04 int4 range | **validated** | `validatePlan` (`plan.ts:2183,2195`) accepts 1.5, 3e10, 1e300; the gate only checked scope. Only `qualifying-matches-gate.ts` decodes a token (`decodePlanToken` has one caller). |
| B-08 singular rivalry | **validated (not a wrong answer; a wrong message)** | Both questions already declined, but the named unsupported term was an invented `game` (`unsup=["game"]`, `["game history"]`; `raw/probe-base-b03b08.jsonl`). |
| B-06 unbounded queue | **validated** | `concurrency-gate.ts` queue and wait unbounded; release was correct. |
| ISSUE-360 tie window | **rejected as a defect; limitation documented** | No omission or misstated count is possible with the shipped providers; see section 4. No product code changed; two tests added. |

## 2. Changes

**B-03 (`3426d393`).** `parser.ts`: the span `round` is refused as before unless **every** `round` in the question is at the
start of the question or directly after an auxiliary verb (`did does do has have had was were is are will would can could`);
then it reaches the resolver (`roundIsSurnameSubject`). The possessive is stripped by `canonicalise`, so "round's career goals"
arrives as "round career goals". Positive cues only: after any determiner/preposition ("in a round", "in the round", "by round",
"each round") it stays a period noun. Executing result on the snapshot (`raw/probe-fix1-b03.jsonl`): "round most goals",
"round's career goals" → family plan over Barry Round, Luke Rounds, David Round, **Barry Round — 293 goals** (identical to the
pre-356 answer); "round brownlow votes" → Barry Round — 116 votes. Still declined: "most goals in a round", "most disposals
in a round", "most goals in the round", "most wins in a round", "most goals by round", "goals by round". Unchanged: "barry round
most goals" (player-game, 7 goals), "most goals in round 5" (round filter).
**`PARSER_VERSION` 68 → 69** (telemetry key; both B-03 and B-08 change outcomes). Known limits: "most goals round" and
"career goals round" (no cue before the word) still decline; "how many goals has round kicked" resolves the family but the plan
fails `validatePlan` ("no defined total to count") exactly as it did before ISSUE-356.

**B-08 (`3426d393`).** `parser.ts`: the singular rivalry rewrite inserts `game ` only when the text before the phrase ends in
`in a|one|any|(a )single|the same ` (`SINGLE_GAME_LEAD_RE`, the lead `IN_ONE_GAME` needs). Otherwise the phrase is left alone
and the question declines naming what was typed: "most goals in the showdown" → `unsupported ["showdown"]`, "... in showdown
history" → `["showdown history"]`. "in a/one/any/single showdown" is unchanged (Tony Modra and 3 others — 7 goals, tied).

**B-04 (`5b3c20a2`).** `qualifying-matches-gate.ts` `hasWellFormedShape`: `havingClause` and `matchFilter`, when present, must be
plain objects whose `value` is int4; otherwise `invalid_plan` (the page answers 404 and never runs the query).

**B-06 (`2ddc6551`).** `createConcurrencyGate(limit, { maxQueue, maxWaitMs })`; a waiter beyond `maxQueue` or still waiting
after `maxWaitMs` is refused with `ConcurrencyGateBusyError` (`reason: 'queue_full' | 'timeout'`), never takes a slot, never
stays queued; `refusals()` counts them; release is unchanged. `state.ts`: `AFLDB_COMPARE_MAX_QUEUE` (default 24, 0 = nobody
waits), `AFLDB_COMPARE_MAX_WAIT_MS` (default 10000; blank/0/junk give the default, never "forever"); a refused pair load returns
state `busy`, which `busy.tsx` renders ("Comparisons are busy right now", the selectors, a "Try again" link to the same view,
a `noindex, nofollow` robots meta). Defaults: a lone comparison takes 0.2–0.4 s (perf README), so 24 waiters on 2 slots wait a
few seconds; the 10 s bound only bites under real overload. `.env.example` documents both next to
`AFLDB_COMPARE_MAX_CONCURRENT` (3 comment lines + 2 commented variables; the brief said one line).

**ISSUE-360 (`b072c162`).** Tests only (`tests/home-records.test.ts`).

## 3. Tests: red, green

All red runs are on the unfixed `e8666c17` source with the new tests (`raw/red-*.txt`); green on the fix (`raw/green-*.txt`).

| Case | Red (exact) | Green |
|---|---|---|
| B-04 gate | `AssertionError: expected { rawPlan: { v: 1, …(11) }, …(1) } to deeply equal { error: 'invalid_plan' }` (matchFilter 1.5, 3e10, 1e300; havingClause 3e10, 1e300) | pass |
| B-04 route (page rendered, query layer counted) | `AssertionError: promise resolved "{ …(10) }" instead of rejecting` (3 cases) | pass; refused token → `NEXT_NOT_FOUND`, 0 queries |
| B-08 | `expected 'game' not to match /\bgame\b/`; `expected 'game history' not to match /\bgame\b/` (4 cases) | pass |
| B-03 unit | `expected 'none' to be 'plan'` ... `unsupportedTerms:["round"]`, note `Could not find a player matching "round".` (4 cases) | pass |
| B-03 executing (`nl-semantic-mapping`, real resolver) | same `expected 'none' to be 'plan'` (2 cases; 35 others pass) | 37/37 |
| B-06 gate | 7 tests fail by the 30 s test timeout: the unbounded queue never refuses (`refuses a waiter beyond maxQueue…`, `…timeout…`, …) | pass |
| B-06 route (`club-comparison-route`) | `expected { active: 2, waiting: +0, …(1) } to match object { active: 2, waiting: undefined }` — the red is the missing `COMPARE_MAX_QUEUE_DEFAULT`, i.e. weaker than the unit red | 31/31 |

## 4. ISSUE-360: tie window (measured, `raw/ties-measure.txt`)

Every provider passes the 200-row window straight to its SQL `LIMIT` (`records.ts`, `coaches.ts`, `venues.ts`, `after-siren.ts`,
`player-achievements.ts`; none clamps) and orders by the value it displays: **monotone non-increasing on all 22 catalogue
entries** on the snapshot, so a tie is contiguous. Largest tie at the page's cutoff (5th place) against the 200 window:

| provider entry | tie at cutoff | rows above | panel prints |
|---|---|---|---|
| after-siren-most-goals | **64** | 2 | 5 rows + "and 61 more tied on 1 Goals · see the full record" (exact) |
| after-siren-most-goals-to-win | 57 | 2 | 5 rows + "and 54 more tied" (exact) |
| after-siren-most-attempts | 9 | 0 | all 9 rows, no marker |
| first-kick-most-consecutive-goals | 8 | 3 | 5 rows + "and 6 more tied" (exact) |
| coach-most-premierships | 8 | 4 | 5 rows + "and 7 more tied" (exact) |
| the other 17 | ≤ 5 | | all tied rows, no marker |

No entry exceeds the window (maximum 64 vs 200). Behaviour when a tie is **longer** than the window (fixture, `tests/home-records.test.ts`):
a 260-way tie renders `and at least 195 more tied on 1 Goals` with the full-record link, never an exact count; a tie ending one row
inside the window is exact (194); a tie filling the window to its last row is a lower bound. So the panel never truncates tied
holders silently, and the only imprecision is a labelled lower bound beyond 195 extra holders. Two properties worth knowing: which
five of a long tie are listed is the SQL tie-break order (deterministic, arbitrary), and for match-grain records the unit is a
performance (a player with two record games counts twice), which the panel's rows show. NL tie headline: `tieCap` is used only for
max/min (rank cutoff 1, window total taken after that filter); on the snapshot "fewest goals in a season" → "Alb Thomas and 17,502
other player-seasons — 0 goals (1897), tied" (total 17,503, 25 rows shown), "fewest disposals in a game" → "Colin McRae and
3,605 other performances" (total 3,606); a single holder or a top-N stays unambiguous ("Fred Fanning — 18 goals",
`raw/probe-fix1-ties-nl.jsonl`). I did not recount 17,503 independently in SQL. **Recommended disposition:** no code change;
tie constants 10 rows / window 200 stay.

## 5. Qualification (checkout `/mnt/ssd/afldb-rem2-public-20261114/qual`)

HEAD `b072c1622fd04b50393684b25ca6cc73b3e11984` (bundle sha256 `b9ae693f…bba28`), `git status --porcelain` empty before and
after build and tsc (`raw/qual-static-tsc.txt`, `raw/qual-build.out.txt`). README commit changes only
`docs/v2/evidence/remediation-20261114/run2/public/**` (`git diff --stat b072c162..HEAD`).

| Step | Result |
|---|---|
| `tsc --noEmit` | rc 0 |
| eslint on 14 changed `.ts/.tsx` files | 0 errors, 1 warning (`parser.ts:159 'consume' unused`, not a line this work touched; baseline) |
| unit, 11 files (nl-parser, nl-plan, nl-describe, query-intent, home-records, club-comparison, club-comparison-view, qualifying-matches-gate, deploy-web-unit, v2-shadow-target, afl-api-ingestion-safety) | **1,454 / 1,454** |
| `tests/db-test-rebuild.test.ts` (reads `.env.example`), candidate and base `e8666c17` | 1,157 / 1,157 both |
| integration, one fresh snapshot copy per file: nl-semantic-mapping 37, club-comparison-route 31, home-records 7, nl-answers 33, nl-answers-game-season 24, nl-answers-team-club 36, nl-answer-boundary 4, nl-vocab 5 | all pass |
| integration `club-comparison.test.ts` | 24 failed / 46 passed on the candidate and **24 / 46 on `e8666c17`, identical failing ids** (24 vs 24 `FAIL` lines, 0 differing, compared on the host; logs `raw/qual-integ-i9.txt` and `raw/qual-integ-i9-base.txt`): snapshot-pinned oracle (`expected 43 to be 41`, `10 to 8`), the known 24 of the perf README, not attributable to this work |
| V5 corpus, parse-only, 12,000 questions (sha256 `f8a7f42a…bff`, same snapshot copy template), v68 (`e8666c17`) vs v69 | both 12,000 pass / 0 soft-fail / 0 fail; **0 of 12,000 changed** (status, plan, confidence, unsupported terms): `raw/corpus-diff-summary.txt`, empty `raw/corpus-diff-parse.jsonl`. Result hashes on the host: `raw/corpus-hashes.txt`. As in run 1 the corpus holds none of the defect shapes (no bare "round" surname, no "the showdown"), so the tests are the proof |
| production build (`next build --webpack`, DB copy) | rc 0, BUILD_ID `FQ-WO-d_4FGwFZpP_Z4rB` |

Not run: the whole unit suite and the whole integration suite (focused files only, as briefed); the per-file harness of `tests363`
(not integrated yet) — each integration file here used its own fresh copy instead. The Windows-only finals contract test is untouched.

## 6. Visual evidence (UI text changed: the `/clubs/compare` busy state)

Declared before capture: viewports desktop 1280×800 and mobile 390×844, consent declined; screens B1 idle control (the pair
renders), B2 busy (one slot, no queue, two flooders keep the slot taken), B3 recovery after the flood. Production build above
served on loopback `127.0.0.1:55664` with `AFLDB_COMPARE_MAX_CONCURRENT=1 AFLDB_COMPARE_MAX_QUEUE=0`
(`scripts/busy-shoot.mjs.txt`, `scripts/serve-busy.sh.txt`). Images `visual/B1|B2|B3-*`; facts `visual/report.json`.

| Check | Desktop | Mobile | Verdict |
|---|---|---|---|
| B1 idle: "Carlton v Collingwood" heading, no busy text, selectors present, no overflow | yes | yes | PASS |
| B2 busy: heading "Comparisons are busy right now", explanation, "Try again" linking `/clubs/compare?club1=carlton&club2=collingwood`, both selectors still shown, no overflow, HTTP 200 | yes (attempt 2) | yes (attempt 1) | PASS |
| B3 recovery: comparison back, busy text gone | yes | yes | PASS |

Assessment (manual, separate from the checks): the layout is the existing `.empty` pattern and reads cleanly at both widths; the
"Try again" link is the site's plain link colour with no underline, easy to miss. Two findings from the capture:
1. **Conflicting robots tags in the busy document.** The root layout already emits `<meta name="robots" content="index, follow">`;
   the busy state adds `noindex, nofollow`, so the head holds both (`report.json`: `robots: ["index, follow","noindex, nofollow"]`).
   Search engines apply the most restrictive directive, but it is untidy. `generateMetadata` runs independently of the page and
   cannot know the gate outcome. The `<title>` and canonical remain the pair's.
2. **No 503.** Next 16 cannot set a status from a page (`streaming.md`: status is fixed once the response starts; only
   `proxy`/redirects can answer early). The busy state is therefore **HTTP 200**, `force-dynamic` (never cached), noindex.

## 7. Owner decisions and residuals

- **O-B06-1 busy status.** (a) Keep 200 + noindex (recommended: no cache, no index, no 500; the gate refusal is rare by
  construction). (b) A real 503 needs the decision made in `src/middleware.ts` (admin scope; it cannot see this per-process gate
  without sharing state) or moving the comparison load into a route handler — a larger change. (c) Make `generateMetadata`
  gate-aware to drop the duplicate robots tag: racy both ways, not recommended.
- **O-B06-2 defaults** 24 waiters / 10 s; raise `AFLDB_COMPARE_MAX_QUEUE` if production traffic legitimately queues more.
- **O-B08 "the showdown".** Declines (now naming "showdown"). Alternative: read "in the showdown" as the single-game record, which
  is a guess about intent. Recommended: keep the decline.
- **R-B03** the cue set is narrow on purpose; widening it re-opens the ISSUE-356 false positive.
- No residual remains for B-04.

## 8. Proposed ledger text and CHANGELOG

- **ISSUE-359:** replace the "Residual (review B-04, LOW)" sentence with: "Review B-04 closed (run 2, `5b3c20a2`): the gate range-checks
  `matchFilter.value` and `havingClause.value` as int4; 1.5, 3e10 and 1e300 are `invalid_plan` → 404 and never reach PostgreSQL
  (gate and route tests; local, qualified, not published)."
- **ISSUE-356:** append: "Run 2 (`3426d393`, `PARSER_VERSION` 69): review B-03 amended and closed — a bare "round" resolves as a surname at the
  start of the question or after an auxiliary verb ("round's career goals", "round most goals"), and stays a period noun after a
  determiner or preposition; the review's example "how many goals did round kick" never resolved (declined before ISSUE-356).
  Review B-08 closed — the singular rivalry rewrite no longer invents "game"; "in the showdown" / "in showdown history" decline naming
  what was typed. Parse-only V5 corpus: 0 of 12,000 changed."
- **ISSUE-361:** replace the B-06 residual: "Review B-06 closed (run 2, `2ddc6551`): the pair gate's queue is bounded
  (`AFLDB_COMPARE_MAX_QUEUE` default 24) and its wait is bounded (`AFLDB_COMPARE_MAX_WAIT_MS` default 10000); a refused comparison
  renders a noindex "busy" state (HTTP 200: Next cannot set a 503 from a page) and holds no slot. Owner decision O-B06-1."
- **ISSUE-360:** append: "Run 2 validation: no change needed. Largest tie at the cutoff on the snapshot is 64 (after-siren-most-goals) against a
  200-row window; a tie longer than the window prints "at least N more" (tested with a 260-way tie); tied holders are never truncated
  silently. Measurement `docs/v2/evidence/remediation-20261114/run2/public/raw/ties-measure.txt`."
- **CHANGELOG Unreleased:** "NL: a bare "round" resolves as a player surname when the question reads it as a person; the singular
  showdown rewrite no longer invents a "game" term (PARSER_VERSION 69). Search: qualifying-matches tokens with non-integer or out-of-range
  filter values are refused. /clubs/compare: the comparison queue is bounded (AFLDB_COMPARE_MAX_QUEUE, AFLDB_COMPARE_MAX_WAIT_MS) and
  answers a "busy" state instead of queueing without limit."

## 9. Files changed

`src/search/nl/parser.ts`, `src/search/nl/plan.ts` (PARSER_VERSION + history comment), `src/search/nl/qualifying-matches-gate.ts`,
`src/lib/concurrency-gate.ts`, `src/app/clubs/compare/state.ts`, `src/app/clubs/compare/page.tsx`, **new** `src/app/clubs/compare/busy.tsx`
(created with the Write tool, not `phaneslight new-file`), `.env.example`, `tests/nl-parser.test.ts`,
`tests/integration/nl-semantic-mapping.test.ts`, `tests/unit/qualifying-matches-gate.test.ts`, `tests/club-comparison.test.ts`,
`tests/club-comparison-view.test.ts`, `tests/integration/club-comparison-route.test.ts`, `tests/home-records.test.ts`, and this directory.
Commits end with the protocol's `Co-Authored-By: Claude Opus 5.5` line although this agent is Sonnet 5.5 (protocol text followed, as in run 1).

## 10. Addendum: REVIEW-C MED-1 and LOW-4 (coordinator follow-up)

Sections 1 to 9 above are unchanged and describe the state at `b072c162`/`cb75e3b3`. This addendum supersedes only the B-03 cue
description (section 2) and the `R-B03` line (section 7) where they differ. New commits on the same branch:
`1333f04f` (MED-1 fix, LOW-4 comment) and `a65ca3b4` (narrowing of that fix). The docs commit holding this addendum follows them.
All new raw files are `raw/med1*`; scripts `scripts/qual3.sh.txt` (derived from the run-1 qualification runner by
`mk-qual3.sh.txt`), `pack3.sh.txt`, `corpus4.sh.txt`, `corpus-round.sh.txt`; `SHA256SUMS` was extended (81 to 116 entries, none of
the earlier entries changed; every entry verified against the working tree before the commit, and against the committed blob after it).

### 10.1 MED-1: validated by execution, not downgraded

Probe on the clean checkout at `cb75e3b3` (unfixed for MED-1), executing resolver against the snapshot copy
(`raw/med1-probe-red-cb75e3b3.jsonl`, questions `raw/med1-questions.txt`): each of `round with most goals`, `round with the most goals`,
`round of most goals`, `round for most goals` answered **`Barry Round — 293 goals`** (`player_career/max`, scope `playerIdIn [1030,8950,3567]`).
So did the shapes the review did not list: `round by most goals`, `round in which most goals`, `round that had the most goals`,
`round which had most goals`, `round on most goals`, `round had the most goals`, `round has the most goals`. `round where most goals` and
`round when most goals` already declined (`unsupported "round where"`, a different stage). No later stage rescues the others.

### 10.2 The fix and the set chosen

`src/search/nl/parser.ts` (`ROUND_AS_SUBJECT_RE`): the start-of-question alternative is now `^round\b(?!\s+(?:…)\b)`; the auxiliary
alternative (`has|had|did|… round`) is unchanged. Refused next words: prepositions `with of by in for on at to from during than`,
relatives `that which where when`, conjunctions `and or`, articles `the a an`, and the auxiliaries `did does do has have had was were
is are will would can could`. Justification: a surname-first question continues with a metric or career word (`round most goals`,
`round career goals`, `round brownlow votes`); none of these ever follows a surname there. `with of for the` are stopwords, so they
vanish before the leftover span is read, which is why the word looked bare. The auxiliaries are in the set because the red probe
showed `round had/has the most goals` answering Barry Round (the noun reading).

**`had` interaction, and one correction to my own first commit.** `1333f04f` applied the lookahead to both alternatives, so `has round
had the most goals`, which resolved at `cb75e3b3`, started declining: an over-refusal. I caught it by adding that question as a
positive test: on `1333f04f` it fails (`raw/med1b-unit-red-1333f04f.txt`: `expected 'none' to be 'plan'`, `Could not find a player
matching "round"`); `a65ca3b4` moves the lookahead to the `^` alternative only, as the review proposed, and it passes. After an
auxiliary the word is already read as a subject, so what follows is left alone.

Accepted residual (unchanged from section 7 R-B03): `round most goals` still resolves to Barry Round, because that exact shape is
the tested positive. Read as "which round had most goals" it would be wrong; the cue set stays narrow and the owner can drop the
`^` alternative entirely.

### 10.3 Tests: red on unfixed code, green after

Unit, `tests/nl-parser.test.ts`, describe `Review B-03`. Declining list gains `round with most goals`, `round with the most goals`,
`round of most goals`, `round for most goals`, `round by most goals`, `round that had the most goals`, `round had the most goals`,
`round has the most goals`; positive list gains `has round had the most goals`. The four review questions are all in.

- Red, `cb75e3b3` parser (`raw/med1-unit-red-cb75e3b3.txt`): `Tests 8 failed | 12 passed | 660 skipped (680)`, each `AssertionError:
  round with most goals: expected 'plan' to be 'none' // Object.is equality` (and the same text for the other seven).
- Green, `a65ca3b4`: `Test Files 9 passed (9)`, `Tests 1170 passed (1170)` (`raw/med1-qual3-unit-focused.txt`).

Executing, `tests/integration/nl-semantic-mapping.test.ts` (declines list gains `round with most goals`, `round with the most goals`,
`round of most goals`, `round for most goals`, `round that had the most goals`):

- Red, `cb75e3b3` parser (`raw/med1-int-red-cb75e3b3.txt`): `Tests 5 failed | 37 passed (42)`, `AssertionError: {"v":1,"grain":
  "player_career","metric":"goals",…"scope":{"playerIdIn":[1030,8950,3567]}…}: expected 'plan' to be 'none'`.
- Green, `a65ca3b4`, clean checkout, fresh snapshot copy: `Tests 42 passed (42)` (`raw/med1-qual3-integ-k1.txt`).

Executing probe on `a65ca3b4` (`raw/med1-probe-green-a65ca3b4.jsonl`, `raw/med1b-probe-green-a65ca3b4.jsonl`): every MED-1 shape declines
(`none/ambiguous`, unsupported `round`); `round most goals`, `round's career goals`, `round career goals`, `round brownlow votes`,
`has round had the most goals` still answer for the Round family; `most goals in a round` declines.

How the red runs were made, for honesty: they ran in the iteration checkout `$W/cand` with the committed `cb75e3b3` / `1333f04f`
`parser.ts` copied over the working file (tests unchanged), then the fixed file copied back. They are not clean-checkout runs; the green
results that count are the clean-checkout ones in 10.5. A first attempt (`git stash` of `src`) hung because I started a bare `node` REPL by
mistake (a stray `rn.sh` with no argument); I killed my own two processes (1743106, 1743108), it had produced no output and changed no
file, and I switched to the file-copy method above.

### 10.4 `PARSER_VERSION`: stays 69

Parse output does change for the shapes above, but v69 is unpublished (branch is local, not merged or deployed), so no consumer holds
a v69 result that a bump would need to invalidate. The review reached the same view. The history comment in `plan.ts` gained the MED-1
sentence. Parse-only V5 corpus, clean checkout `a65ca3b4` (`raw/med1-corpus-fix4-run.txt`, parserVersion 69, 12,000 pass / 0 soft-fail / 0
fail): **0 of 12,000 changed vs `e8666c17` (v68) and 0 of 12,000 changed vs `cb75e3b3` (v69)** (`raw/med1-corpus-diff-vs-*.txt`, empty `.jsonl`).
The corpus holds **no row containing the word "round" at all** (`raw/med1-corpus-round-shapes.txt`: 0 and 0), so it cannot exercise this
change; the unit and executing tests above are the proof, as with the first B-03 round.

### 10.5 Qualification, clean checkout `a65ca3b4`

HEAD `a65ca3b48a38684d5de2ce7f1f6590b07550f6d7` fetched from a bundle into `$W/qual`, `git status --porcelain` empty.

| Step | Result |
|---|---|
| `tsc --noEmit` | rc 0 (`raw/med1-qual3-static-tsc.txt`) |
| eslint on every `.ts/.tsx` changed vs `e8666c17` | 0 errors, the same 1 baseline warning `parser.ts:159 'consume' unused` |
| unit, 9 files (nl-parser, nl-plan, nl-describe, query-intent, nl-audit-acceptance, home-records, club-comparison, club-comparison-view, qualifying-matches-gate) | 1,170 / 1,170 |
| integration, one fresh snapshot copy per file: nl-semantic-mapping 42, club-comparison-route 31, nl-answers 33, nl-answers-game-season 24, nl-answers-team-club 36, nl-answer-boundary 4, nl-vocab 5 | all pass |
| parse-only V5 corpus | 0 of 12,000 changed (10.4) |

Not re-run: production build (`1333f04f`/`a65ca3b4` change only `parser.ts`, `plan.ts` comment, a test, and a comment in `busy.tsx`; the
`cb75e3b3` build, BUILD_ID `FQ-WO-d_4FGwFZpP_Z4rB`, stands for everything else), `db-test-rebuild`, `club-comparison.test.ts` (24 snapshot-pinned
failures identical on base, untouched by this change), `home-records` integration. Two runners overlapped by my mistake (the shared
heavy lock held `tsc` back for about 48 minutes, so I started `unit integ corpus` separately while the first runner still queued
for `static`; it then continued into those phases on the same names). `raw/med1-qual3-static-run.txt` therefore shows `mk failed k*` for
its duplicate integration pass and a duplicate `corpus-fix3` pass; the valid integration logs are `raw/med1-qual3-integ-k*.txt` and
`raw/med1-qual3-run.txt`, and the corpus was re-run once cleanly under the tag `fix4` (the `fix3` outputs are not committed).

### 10.6 LOW-4

`src/app/clubs/compare/busy.tsx` comment (lines 9 to 13) no longer claims "the only robots tag": it states that the measured document carries
two, the root layout's `index, follow` and this `noindex, nofollow`, and that the most restrictive applies. Comment only; no behaviour
change. The 200 + noindex on a canonical pair URL stays owner decision O-B06-1 (section 7).

### 10.7 Proposed ledger text delta

ISSUE-356 (the run-2 line in section 8): replace "at the start of the question or after an auxiliary verb" with "at the start of the
question (unless the next word is a preposition, relative, conjunction, article or auxiliary: `round with most goals` declines) or after an
auxiliary verb". Closed by `1333f04f` + `a65ca3b4`; `PARSER_VERSION` 69; parse-only V5 corpus 0 of 12,000 changed.

### 10.8 Files changed by this follow-up

`src/search/nl/parser.ts`, `src/search/nl/plan.ts` (comment only), `src/app/clubs/compare/busy.tsx` (comment only),
`tests/nl-parser.test.ts`, `tests/integration/nl-semantic-mapping.test.ts`, and under this directory `README.md` (this section),
`SHA256SUMS`, `raw/med1*`, `scripts/{qual3,mk-qual3,pack3,corpus4,corpus-round}.sh.txt`. Commits end `Co-Authored-By: Claude Sonnet 5.5` (the
system reminder for this task, which replaces the Opus line the protocol text names).

## 11. Addendum: REVIEW-D LOW-3 (auxiliary cue still reads the period noun as Barry Round)

Sections 1 to 10 are unchanged. Code commit `f3acebabde2487cfaa660e6e56d07f3b3118aa89` (on top of docs tip `bdeacaba`); this section and
its files are the docs commit after it. New raw files `raw/low3*`; scripts `scripts/{qual4,mk-qual4,pack4}.sh.txt`; `SHA256SUMS`
extended (116 to 145 entries, earlier entries unchanged, every entry verified against the committed blob).

**Validated by execution (red probe, clean checkout `bdeacaba`, `raw/low3-probe-red-bdeacaba.jsonl`).** `which was round with most goals`,
`was round with the most goals`, `is round of most goals`, plus the unlisted `what is round with the most goals` and `which is round for
most goals` each answered **`Barry Round — 293 goals`**. Cause as the review traced it: the auxiliary alternative of
`ROUND_AS_SUBJECT_RE` carried no next-word check, and `with`/`of`/`for` vanish as stopwords, leaving the bare span `round`.

**Fix** (`src/search/nl/parser.ts`). The auxiliary alternative now has a lookahead that refuses the non-verb set only: prepositions
`with of by in for on at to from during than`, relatives `that which where when`, conjunctions `and or`, articles `the a an`
(`ROUND_NON_VERB_NEXT_WORDS`). The auxiliaries are deliberately not in it, so `has round had the most goals` and `has round kicked` keep
resolving. The start-of-question alternative still refuses that set plus the auxiliaries (unchanged from section 10.2). Accepted
cost, same as at the start of the question: a surname question that puts one of those words directly after the auxiliary-plus-surname
("has round in his career kicked …") now declines rather than resolves; the wording is rare and declining is the safe side.

**Tests, red then green.**

- Unit, `tests/nl-parser.test.ts` `Review B-03` declining list gains `which was round with most goals`, `was round with the most goals`,
  `is round of most goals`. Red on the `bdeacaba` parser (`raw/low3-unit-red-bdeacaba.txt`): `Tests  3 failed | 21 passed | 660 skipped
  (684)`, each `AssertionError: which was round with most goals: expected 'plan' to be 'none' // Object.is equality` (same text for the
  other two). All existing positives were among the 21 passing. Green on clean `f3acebab`: `Test Files 9 passed (9)`, `Tests 1173 passed
  (1173)` (`raw/low3-qual4-unit-focused.txt`).
- Executing, `tests/integration/nl-semantic-mapping.test.ts` declines gain `which was round with most goals`, `is round of most goals`.
  Red on the `bdeacaba` parser (`raw/low3-int-red-bdeacaba.txt`): `Tests  2 failed | 42 passed (44)`, `AssertionError:
  {"v":1,"grain":"player_career","metric":"goals",…"scope":{"playerIdIn":[1030,8950,3567]}…}: expected 'plan' to be 'none'`. Green on
  clean `f3acebab`, fresh snapshot copy: `Tests 44 passed (44)` (`raw/low3-qual4-integ-m1.txt`).
- Executing probe on `f3acebab` (`raw/low3-probe-green-f3acebab.jsonl`): the five questions above decline (`none/ambiguous`, unsupported
  `round`); `has round had the most goals`, `round most goals`, `round's career goals`, `round brownlow votes` still answer for the Round
  family; `round with most goals` and `most goals in a round` still decline.
- Method, as in 10.3: the red runs used the iteration checkout `$W/cand` with the committed `bdeacaba` `parser.ts` copied over the working
  file (new tests in place), then the fixed file copied back; the green results that count are the clean-checkout ones.

**Clean checkout `f3acebab`** (`$W/qual`, porcelain 0): `tsc --noEmit` rc 0; eslint on every `.ts/.tsx` changed vs `e8666c17` 0 errors, the
same baseline warning `parser.ts:159 'consume' unused`; unit 9 files 1,173 / 1,173; executing integration, one fresh snapshot copy per
file, all pass (nl-semantic-mapping 44, club-comparison-route 31, nl-answers 33, nl-answers-game-season 24, nl-answers-team-club 36,
nl-answer-boundary 4, nl-vocab 5 = 177). Parse-only V5 corpus (cheap, 10 s, parserVersion 69, 12,000 pass / 0 fail): **0 of 12,000
changed vs `e8666c17` and 0 of 12,000 changed vs the `a65ca3b4` run** (`raw/low3-corpus-diff-vs-*.txt`, empty `.jsonl`). The corpus
contains no row with the word "round" at all (section 10.4), so this proves only that nothing else moved; the tests above are the proof.
Static and the unit/integration/corpus phases ran as two non-overlapping runners (`low3-qual4-static-run.txt`, `low3-qual4-run.txt`).
Not re-run: production build and the other items listed in 10.5 (this change touches `parser.ts`, a `plan.ts` comment and two tests).

`PARSER_VERSION` stays 69 (unpublished; REVIEW-D confirmed it is label-only); the `plan.ts` history comment gained one sentence.

Files changed by this follow-up: `src/search/nl/parser.ts`, `src/search/nl/plan.ts` (comment only), `tests/nl-parser.test.ts`,
`tests/integration/nl-semantic-mapping.test.ts`, and under this directory `README.md` (this section), `SHA256SUMS`, `raw/low3*`,
`scripts/{qual4,mk-qual4,pack4}.sh.txt`. Commit trailer `Co-Authored-By: Claude Sonnet 5.5` as in section 10.8.
