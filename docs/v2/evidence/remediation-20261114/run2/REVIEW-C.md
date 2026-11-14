# REVIEW-C: independent review of remediation run 2 (`e8666c17..52efe47e`)

Reviewer: `afldb-reviewer`, 2026-11-14. Read-only (Read/Grep/Glob); no command, test or Git was run, so every
finding is from source on disk in `D:\dev\afldb-rem-20261114`. Scope: the run-2 scopes `lint364`, `public`, `admin`,
`caddy357`, `ops`, `evidence`, plus `docs/admin-and-beta.md` and the ISSUE-357 describe in
`tests/settle-season-revalidation.test.ts`. **Not reviewed: ISSUE-363 per-file test databases (still in progress).**

**Verdict: no CRIT, no HIGH. 2 MED, 7 LOW.** Neither MED blocks qualification of the code; MED-2 blocks an owner
approval of the Caddy install as the procedures stand.

## Limits of this review

- No diff was available. "No weakened assertion" is checked only as: no `.skip/.only/.todo/xit` in the eleven touched
  suites I searched (none found; the one `describe.skipIf(!linux)` is the existing Linux-only pattern), and the one
  assertion the lint364 README discloses as rewritten (`|| nm_status=$?`). A line-by-line diff of test deletions was
  not possible and is not claimed.
- Caddy matcher semantics (`vars_regexp` on `{http.request.uri}`, directive order `respond` before `reverse_proxy`) and
  Next 16 prefetch URL shapes are external behaviour I cannot confirm from the repository. I rely on the caddy357
  matrix and real-browser run for them and did not re-derive them.

## Findings

### MED-1. B-03: a question that starts with "round" as a period noun is answered for Barry Round
`src/search/nl/parser.ts:2161-2167` (cue), `:3182-3186` (use); `src/search/nl/vocab.ts:1120` (`with` is a stopword).

`ROUND_AS_SUBJECT_RE` treats start-of-question as a positive cue with no check on what follows. Scenario:
`round with most goals` (meaning "which round had the most goals"). After the metric and ranking words are stripped the
remaining tokens are `round with`; `with` is in `STOPWORDS`, so `candidatePlayerSpan` returns `round`;
`roundIsSurnameSubject` sees one occurrence, at `^`, and returns true; the resolver is consulted and the Round family
plan is produced. Expected output by the same path as the tested `round most goals`: **Barry Round, 293 goals**. That
is the ISSUE-356 (c) false positive ("a different question answered at confidence 1") reopened for the
start-of-question shape. Same for `round with the most goals`, `round of most goals`, `round for most goals`
(`of`, `for`, `the` are stopwords too). The declining list in `tests/nl-parser.test.ts:5369-5377` has no
start-of-question case, and the 12,000-question corpus holds no bare "round" shape, so nothing covers it.
Not executed; traced from source. If execution shows a later stage declines it, downgrade to INFO.

Smallest fix: make the `^` alternative refuse when a preposition or relative word follows, for example
`round\b(?!\s+(?:with|of|by|in|for|that|which|where|when|had)\b)`; add the four questions above to the declining
`it.each`; `PARSER_VERSION` is already 69 and unpublished, so no further bump. Acceptance: the focused describe
`Review B-03` in `tests/nl-parser.test.ts`, then the parse-only V5 corpus diff (expect 0 of 12,000 changed).

### MED-2. There is no single install procedure for the candidate Caddyfile; procedure 06 installs the deny unprobed
`run2/ops/procedures/06-caddy-logging.md:4-6, :36, :41-55, :110` versus `run2/caddy357/README.md` section 6.

`deploy/Caddyfile.production` now carries three changes at once (ISSUE-362 log filter, beta-host HSTS/CSP not on the
installed file, ISSUE-357 deny imported at `:207`). Procedure 06 says the 357 steps "are not described here" and lists
"the 357 merge" as unverified; the caddy357 README has its own install with a different backup name
(`.pre-issue357-<stamp>` vs `.pre-i362`) and no log pre-check. Scenario: the owner approves ISSUE-362 O-1 and follows
procedure 06. The deny goes live with none of its probes run (`/seasons/02024` 404, `/seasons/%zz` 400, legitimate
set 200/307), without the two production prerequisites (no slug outside `[a-z0-9-]`, `max(matches.id)` far below
99,999), and without the stated behaviour changes in the approval (trailing slash on a protected route is now a bare
404 instead of Next's 308; the denied body is 9 bytes). If a production slug does fall outside the charset, that
entity's page is a 404 for everyone and procedure 06's validation (`/`, magic link, invite) would not notice.

Smallest fix (documentation only): one combined procedure. Fold caddy357 section 5 prerequisites and section 6 step 5
probes into procedure 06 section 2, one backup name, one rollback, and the approval text naming all three changes.

### LOW-3. Procedure 02 weekly window: `status --expect` will report a problem after the owner's own apt run
`run2/ops/procedures/02-host-patching-policy.md:79-81`; `deploy/release.mjs:254-257, :1410-1417`.
The window runs `apt-get install --only-upgrade postgresql-*`, restarts `afldb`, then `release.mjs status --expect <id>`.
When the current release has a recorded window, the InvocationID has changed and the restart is within five minutes of
an apt-history entry, so `auditActivation` pushes the "unattended-upgrade signature" problem. The message names the
remedy, so the owner is not stuck. Fix: add `--confirm-attended-restart` to that line with one sentence why. All other
procedure commands I checked match the CLIs: `season-opening-check.ts` flags and exits 0/10/11/2
(`tools/v2/season-opening-check.ts:26-48, :107`), `release.mjs host-gate [--strict]`, `status --expect`,
`promote|rollback --attended` (`release.mjs:22-25, :1703`), `backup.sh --dir --keep`, `scheduled-backup.sh status`,
`offhost-pull.sh <source> <dest> --keep N`.

### LOW-4. Busy state: the comment contradicts the measured document, and 200 + noindex sits on a canonical pair URL
`src/app/clubs/compare/busy.tsx:9-13, :18`; `src/app/clubs/compare/state.ts:478-486`.
The comment says the robots meta "is the only robots tag"; the public README section 6 measured two
(`index, follow` from the layout and `noindex, nofollow`). `generateMetadata` still emits the pair's title and
canonical. After launch, a crawler that itself fills the queue receives 200 + noindex on canonical pair URLs. Already
owner decision O-B06-1; correct the comment. Gate itself checked clean (below).

### LOW-5. Pull check blind spots worth stating in procedure 04
`deploy/afldb-settle-failure-status.sh:44-49, :64-68`; `deploy/afldb-settle-afl-api.sh:101-104`.
(a) `Result` is systemd runtime state: a failed nightly followed by a reboot (procedure 03) reads `success` again.
(b) The wrapper exits 0 on `AMBIGUOUS:0` (no in-progress season in `seasons.json`), so that state is `OK` every night;
the check cannot see "nothing was settled". (c) If the timer is not `Persistent=`, `LastTriggerUSec` is `n/a` after a
reboot and the check answers UNKNOWN until the next firing (not verified: I did not read the timer unit). The
`season_row_missing` HALT is correctly visible: `tools/current-season/settle-afl-api.ts:569-572` exits 1, the unit
fails, the check answers FAILED.

### LOW-6. A-05: with a duplicate line-up row the refusal can only be cleared indirectly
`src/db/queries/match-sheet.ts:513-522`; `src/db/queries/admin-brownlow.ts:813-823`.
A player wrongly listed in two home-and-away matches of one 2026 round, holding an unlinked positive vote, is refused
removal from both, including the wrong one. It clears only once a Brownlow entry is saved for the right match (step 1
there links the row). The text says "Resolve it in Brownlow administration" without saying that. Zero such rows on the
snapshot. No code change needed; one sentence in the admin doc is enough.

### LOW-7. Invite token is logged unredacted for a denied aliased spelling
`deploy/Caddyfile.production:62` (anchored `^/admin/invite/`) with `:134`. `//admin/invite/<token>` (a mangled link) is
now answered 404 by the alias layer and logged with the token, because the redaction regexp does not match a doubled
leading slash. The spelling was logged before the deny as well, so this is not a regression. Fix: `^/+admin/invite/`.

### LOW-8. `lint:gate -- --update` can move debt between pairs under the ceiling
`tools/dev/lint-gate.ts:260-271`. `--update` writes whatever ESLint reports; the ceiling test bounds only the totals
(338 / 43), so one fixed error plus one new error elsewhere passes it. Documented as relying on review of the baseline
diff; stated here so the reliance is explicit.

### LOW-9. Transport unit never exercised; two things to confirm on first use
`deploy/afldb-settle-failure-transport@.service:26-27, :43`. `ProtectHome=tmpfs` hides any transport placed under
`/home` outside `deploy/` (the example correctly uses `/usr/local/sbin`); `RestrictAddressFamilies` omits `AF_NETLINK`,
which some resolvers and HTTP clients open. Both fail visibly (exit 4, or the unit in `systemctl --failed`).

## Checked and found sound

- **Concurrency gate** (`src/lib/concurrency-gate.ts:84-122`, `state.ts:332-341, :433-435`): a refused waiter never
  increments `active`; a timed-out waiter is spliced out before `reject`; a granted waiter's timer is cleared before
  `grant`, and the timeout callback is a no-op once the waiter has left the queue, so no double settle and no slot
  leak; release is idempotent and in `finally`; only `ConcurrencyGateBusyError` becomes `busy`, other errors
  propagate; junk env values fall back to the defaults, never to "wait forever"; the route is `force-dynamic`.
- **B-04** (`qualifying-matches-gate.ts:9-13, :62-67`): int4 check precedes `validatePlan`; values stay bound parameters.
- **B-08** (`parser.ts:978, :1091`): the insertion happens only behind the exact `IN_ONE_GAME` lead; plural unchanged.
- **A-05** (`match-sheet.ts:495-574`): parameterised; reads only, inside the caller's transaction after the match and
  line-up locks, no new lock taken; `rv.votes > 0` excludes both zero and NULL; scoped to the match's season,
  home-and-away round and the given player ids.
- **B-05** (`session.ts:267-280`, `admin/login/page.tsx:21-23`, `middleware.ts:154`): the helper is consulted only for
  a live database session; it mints nothing; the door still applies `minEpoch` to admin claims; a malformed epoch
  returns false, so no loop; a current-epoch admin is still redirected.
- **Lint gate** (`lint-gate.ts:138-203`, `preflight.ts:306`, `merge-readiness.ts:243`): every no-verdict path returns
  exit 2 and is a FAIL finding; a thrown gate is a FAIL; no skip flag exists; the findings feed the blocking report.
- **A-09** (`afldb-settle-afl-api.sh:73-87`): `|| nm_status=$?` is safe under `set -eu`; drift needs both a non-zero
  exit and the verdict line; the run continues in every case.
- **Caddy deny**: no route under the eight protected prefixes exists beyond the shapes allowed (16 page files
  enumerated); year bounds equal `parseSeason` (`src/lib/params.ts:59-64`); the int4 player-id regexp equals
  `MAX_INT4_ID`; sitemap ids are at most 300 (`src/app/sitemap.ts:45-50`); layers 1 to 3 exclude the query string, so
  `/beta?from=%2F...`, `/_next/image?url=%2F...` and plan tokens pass; admin dynamic segments are numeric ids or keys
  with no `/`; the two Caddyfiles are pinned to one snippet body by the new contract test.
- **Failure scripts**: instance names are allowlisted before use in a path; no credential in the repository; the
  status script reads `systemctl show` only and sanitises every value.
- **Tests**: no `.skip/.only` in the touched suites; the ISSUE-357 describe is a source contract only, as stated.
