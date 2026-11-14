# REVIEW-B: independent code review of half B (remediation candidate 2026-11-14)

- Worktree: `D:\dev\afldb-rem-20261114`, branch `claude/remediation-20261114`, HEAD `a119a999`, base `5035ed96`.
- Input: `B-code.diff` (read in full, 2,327 lines), current files in the worktree, `tests.diff` (searched).
- Method: static review only. No command, test, build or SQL was run (CLAUDE.md section 9). Nothing here is runtime-verified.
- Result: **no CRIT, no HIGH. 2 MED, 6 LOW.**

## Findings

### B-01 (MED) Admin sign-in and password change now throw when `AFLDB_BETA_EPOCH` is malformed

`src/lib/auth/session.ts:196` (`setAdminSessionCookie` now mints `epoch: betaEpoch()`); `src/lib/auth/tokens.ts:128-138` (`betaEpoch()` throws on a present, non-integer value).

Before this change the admin cookie was minted with a literal `epoch: 1`, so the admin path never read the variable.

Failure scenario: an operator fumbles a kill-switch bump (`AFLDB_BETA_EPOCH=epoch-2`, the exact case the `tokens.ts` comment describes). This applies whether the beta gate is on or off.

- `src/app/admin/login/actions.ts:96`: the credential transaction has already committed (session row inserted, TOTP step consumed, `admin.login` audited), then `setAdminSessionCookie` throws. The action returns a server error and no cookie; each retry leaves another orphan session row.
- `src/app/admin/password/actions.ts:108`: the rotation has committed and revoked every session, then the cookie set throws. The admin is signed out and cannot sign back in.

Net effect: nobody can sign in to `/admin` until the host environment is corrected. Previously the same misconfiguration returned 503 on the public site (gate on) or did nothing (gate off), and `/admin` kept working. It fails closed and is recoverable at the host, hence MED not HIGH.

Smallest fix: in `setAdminSessionCookie`, catch the throw and mint at an epoch that can never pass the beta door (for example 0), so `/admin` still works and the public gate stays closed. Alternatively validate the epoch before the credential transaction starts. Acceptance: a unit test in `tests/auth.test.ts` with `AFLDB_BETA_EPOCH='epoch-2'` asserting the cookie is still set and that the middleware beta branch rejects that claim.

### B-02 (MED) Marquee "setting versus participation" turns on a verb list, so a count of one or noun-style participation is rewritten into a matchup

`src/search/nl/parser.ts:1058-1060` (`explicitCount`, `asSetting`), `:976` (`MARQUEE_PARTICIPATION_LEAD`), `:1072-1075` (rewrite).

`explicitCount` is true for any digit (`1 showdown`, `1+ showdowns`) but for a number word only when `times > 1`. Participation is otherwise recognised only by `played|play|plays|playing|appeared|featured|participated|competed` immediately before the phrase.

Failure scenario, verified at parse level by reading the code: "most goals by players with at least one showdown".

- `rankedQuestion` is true ("most").
- The count word is "one", so `times` is 1 and `explicitCount` is false.
- The 40-character lookback ends "players with at least one ", which does not match the participation lead.
- So `asSetting` is true, and the text becomes "most goals by players with at least one game adelaide v port adelaide".

Before v68 this produced the `matchup_played_min` times=1 predicate, which is the population reading the user asked for. The same question written "1+ showdowns" still takes the predicate path, so the two spellings now diverge. The rewritten text most likely plans as "games >= 1" plus a matchup scope, which would answer goals within Showdowns rather than career goals of Showdown participants. I did not run the parser, so the final plan is an inference.

Same class: "most games by showdown players" (adjectival) is rewritten to "most games by game adelaide v port adelaide players".

Blast radius is limited to ranked questions that contain one of four rivalry phrases without a participation verb or a count above one. This is a parser change, so the focused parser suite and an `nl:stress` corpus run are the acceptance check. Add these cases to `tests/nl-parser.test.ts` under the ISSUE-356 (b) block:

- "most goals by players with at least one showdown"
- "most games by showdown players"
- "most goals in the showdown"
- "most goals in showdown history"

Smallest fix candidates: treat a matched count word, including "one", as explicit when it is preceded by an operator phrase (`at least`, `with`), or extend the participation lead to `(?:players?|those) (?:with|who have|in)`.

### B-03 (LOW) Bare surname "Round" can no longer resolve

`src/search/nl/parser.ts:3145`, `NON_PLAYER_NAME_WORDS` in `src/search/nl/vocab.ts`.

A leftover span consisting only of "round" is now refused before the resolver. Barry Round (1981 Brownlow) and David Round are real players; "how many goals did round kick" previously went to `resolvePlayerFamily` and now declines. "barry round" is unaffected, because the span is not made entirely of listed words. The outcome is a decline, not a wrong answer.

### B-04 (LOW) The qualifying-matches gate still lets two numeric fields produce a 500

`src/search/nl/qualifying-matches-gate.ts:42-60` checks scope only; `src/search/nl/plan.ts:2183` and `:2195`; `src/db/queries/nl/team-match.ts:289` and `:321`.

- `matchFilter.value` is accepted when finite and non-negative. A token carrying `1.5` or `3e10` is bound against an integer margin expression and would fail in PostgreSQL (22P02 or 22003).
- `havingClause.value` is an unbounded integer; `1e300` passes `Number.isInteger`.

Operators are allowlisted (`compareOps.includes`) and values are bound, so this is not injection. It only contradicts the gate's "never throws / never a 500" claim for crafted tokens. Fix: an `isInt4` check on both values in `hasWellFormedShape`.

### B-05 (LOW) A signed-in admin below the current epoch cannot refresh the cookie without signing out

`src/middleware.ts:153-155`; `src/app/admin/login/page.tsx:15` (`if (await getAdminUser()) redirect('/admin')`).

After a legitimate epoch bump, or on any host whose epoch is above 1 at deploy time (existing cookies carry epoch 1), a signed-in admin is sent to `/beta` from every public page while `/admin` still works. `/admin/login` bounces them straight back to `/admin`, so the only way to get a current-epoch cookie is an explicit sign-out and sign-in.

Production reads `AFLDB_BETA_EPOCH=1` (`prod-ro-beta-epoch.txt`), so there is no effect there at deploy. The DEV value was not checked. This is by design per the middleware comment, but it is worth a line in the release note.

### B-06 (LOW) The club-compare gate has no bound on waiting

`src/lib/concurrency-gate.ts:51-56`; `src/app/clubs/compare/state.ts:309`.

Release is correct: `try/finally` covers every throw after acquire, release is idempotent, there is one acquire per request and none nested, and `statement_timeout` in `src/db/client.ts:41` bounds how long a slot is held. I found no deadlock or leak.

Residual: the queue is unbounded and has no timeout. A crawler walking 153 pairs times eras and pages queues behind 2 slots, and each waiter holds an open HTTP request until the upstream proxy gives up, then still runs its ~30 statements for a client that has gone. That is preferable to the old pool starvation, so it is noted only.

### B-07 (LOW) The lint gate crashes instead of returning 2 when ESLint cannot be spawned

`tools/dev/lint-gate.ts:88-94`. When `spawnSync` fails, `run.stdout` is null. `JSON.parse(null)` returns `null` without throwing, so `summariseErrors(null, ...)` raises a TypeError. The process still exits non-zero, so the gate cannot pass falsely.

### B-08 (LOW) Singular rivalry rewrite reaches match grain only behind "in a/one/any/single"

`src/search/nl/parser.ts:1073-1074`; `IN_ONE_GAME` at `src/search/nl/vocab.ts:194`.

The singular branch inserts a bare `game ` token. "most goals in the showdown" becomes "in the game adelaide v ...", and "most goals in showdown history" becomes "in game adelaide v ... history". Neither matches `IN_ONE_GAME`, so the stray "game" is a leftover and the outcome (decline, or a sum across meetings) is untested. No wrong answer is established; the cases are covered by the tests proposed in B-02.

## Checked and found sound

- **SQL parameterisation.** Match Search head-to-head binds both slugs (`match-search.ts`), and `clubSlugs` is de-duplicated and regex-allowlisted before the `=== 2` test (`match-spec.ts:178-190`). The drill-down `LIMIT` is bound. The players CTE reuses the allowlisted `orderBy` fragment. No new unparameterised SQL.
- **NULL versus zero.** The grid-solver `HAVING sum(...) IS NOT NULL` is on both sides of the anti-join, so an unrecorded season neither leads nor competes.
- **Tied holders (NL).** `tieCap` is safe: every max/min executor uses `rnk <= 1` with `count(*) OVER ()` taken after that filter (player-game, player-season, player-career, club-season, coach-record, family, after-siren, team-streak, team-match). Top-N is excluded. `tiedSubject` still returns the single-holder form when the de-duplicated labels number one or fewer.
- **Tied holders (home records).** No provider clamps `limit`, so the 200-row window and the `exact` flag behave as documented.
- **"least" as min.** The `(?<!\bat )` lookbehind mirrors the existing "at most" exclusion, and tests pin "at least N" as an operator.
- **Sitemap move.** `node_modules/next/dist/docs/.../rewrites.md` confirms the order proxy/middleware, then `beforeFiles`, then filesystem. `revalidatePath.md` confirms that the rewrite destination must be passed, so `/sitemap-index.xml` is correct. No `revalidatePath('/sitemap.xml')` caller remains under `src/`, `tools/` or `deploy/`. `robots.ts` still advertises `/sitemap.xml`. The middleware sees the source path, so beta-gate behaviour is unchanged.
- **Sitemap Brownlow exclusion.** `/awards/brownlow-medal` and its season pages do `permanentRedirect` (`awards/[slug]/page.tsx:53,74`; `[season]/page.tsx:56,76`), and `/brownlow` plus `/brownlow/<season>` remain listed (`sitemap.ts:92,176`). No app-emitted canonical now points at a redirect.
- **Strict params.** `parseCanonicalId`, `parseSeason` and `parseEntitySlug` reject only non-canonical spellings and ids above int4; app-emitted links are canonical.
- **AFLW keys.** The page-side claim (segment re-encoded) matches `next/dist/shared/lib/router/utils/get-dynamic-param.js:55-58`. The metadata-side claim (decoded once) was not confirmed from Next source and rests on the author's dev-server probe. If a production build differs, the 17 `%27` player pages get not-found metadata. One production-build fetch of `/aflw/players/Aasta_O%2527Connor`, checking `<title>` and robots, would close it.
- **Players index.** Appending `p.id ASC` makes the order total; `rn` preserves page order; `total` and the past-the-end count path are unchanged.
- **Tests.** In half-B scope I found no weakened assertions. Removed lines are replaced by stricter or equivalent ones (sitemap path, home-records window, match-href `club_match=both`, venue zero-attendance now seeded).
- **Rebuild pin.** The new hash also appears in three GAP-029 documents under `docs/v2/`. The CSV bytes were not hashed.

## Not verified

- Anything requiring execution: the parser outcomes in B-02 and B-08, EXPLAIN for the players CTE, the Turbopack dev-server route conflict, and the AFLW metadata behaviour in a production build.
- The DEV value of `AFLDB_BETA_EPOCH` (B-05).
- `node_modules` is absent in the worktree; Next docs and source were read from `D:\dev\afldb\node_modules` on the assumption that it is the same Next version.
