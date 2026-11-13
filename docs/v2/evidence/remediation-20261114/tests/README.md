# Remediation 2026-11-14: `tests` scope (ISSUE-363 TST-4, TST-7, TST-8, TST-9)

Branch `claude/rem-tests-20261114`, base `5035ed96`. Local commits only; nothing pushed, no production or DEV access, no
migration, no build. Host workspace `/mnt/ssd/afldb-rem-tests-20261114` on streamanator, isolated PostgreSQL port 55612,
template `afldb_v2_remtests_tmpl_test` restored from the approved snapshot (`afldb_prod-20261104T021037Z.dump`, sha256
`e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d`, 30141895 bytes, both verified; ledger 118).

## Commits

| SHA | Subject |
|---|---|
| `8967554f` | TST-7 tests for the public beta-gate, consent and link-suggestion actions |
| `f992d497` | TST-4 seed the subjects of three integration tests that returned early |
| `f8a74eee` | TST-8 errata for the host-matching /beta predicate in preserved acceptance runners |
| `6154732c` | TST-9 give settle-afltables its own season and name leaked fixtures in the suites they break |

Final qualification ran on a host checkout with `HEAD = 6154732ccd9b3d0b6853602ae7c2ad2768335518` and an empty
`git status --porcelain` (`final-checkout.txt`). The commit that adds this README changes only files under
`docs/v2/evidence/remediation-20261114/tests/`.

## Findings: validated or amended

- **TST-4 validated.** `venue-records.test.ts` (recorded-zero case), `player-matching.test.ts` (apostrophe case) and
  `club-coach-records.test.ts` (bare club) returned early when their subject was absent; the review's probe found zero
  subjects on the snapshot (`agents/tests/evidence/probe-vacuous.out`: zero-attendance venues 0, O-prefixed players 0, bare
  clubs 0). Amended: the same files hold other early returns that this change does not touch (venue-records two-identity
  pair and small-venue cases, ten more in player-matching, the renamed-club case in club-coach-records). They are listed
  under "Not done" below.
- **TST-7 validated.** None of the three action files had a test. Amended: `safeDestination` is a private function of a
  `'use server'` module (only async functions may be exported), so it is tested through `redeemAccessCode`, which is the
  only place it is used. The tests found no defect in the actions.
- **TST-8 validated, amended.** Both named runners carry the pattern. A third preserved file, `stepg.cjs:31`
  (`page.url().includes('/beta')`), is the same class (the ISSUE-336 Step G defect, already a documented assessment), so
  it gets an errata too. The recorded runs are not misreported: their `detail` fields show `307 …/beta?from=%2Fdraft`.
  No current procedure or tool reuses either runner as a template (search of `tools/ deploy/ tests/ docs/`), so no
  corrected tool is shipped; the corrected predicate is in the errata and proved in `tst8-predicate-proof.txt`.
- **TST-9 validated, amended.** Validated: settle-afltables and awards-reload-links both claimed 2094, and an interrupted
  settle run breaks admin-season-lists (`2094: expected true to be false`) and release-gates. Amended: the brief's fix
  ("unique season, pre-clean in `beforeAll`, clean in `afterAll`") cannot by itself stop the breakage. Both suites
  already pre-clean and clean up, and a SIGKILLed process runs neither `afterAll` nor anything else. Whatever season the
  fixture holds, a leaked `seasons` row above the real register shifts `max(year)` and the in-progress set. What this
  change does instead: unique season (settle 2094 to 2076), and a fail-fast check in the two victim suites that names the
  leaked season, the owning suite and the recovery. See "TST-9 proof" for exactly what is and is not now true.

## Tests, red and green (oracle named per test, run-plan R-4)

| Test | Where | Oracle | Red (what was broken, failure) |
|---|---|---|---|
| beta redeem / magic link / join (28 new cases; file 12 to 40) | `tests/beta-verify.test.ts` | DB-free; no snapshot values | 13 source mutations, all red (`tst7-mutations.txt`): e.g. safeDestination reduced to a `//` check fails 6; control-char check removed fails 3; plaintext code bound fails the predicate test; limiter keyed on content fails 5; an added DNS lookup in the action fails 6 via the outbound guard |
| `setConsent` (11 new cases; file 31 to 42) | `tests/nl-feedback.test.ts` | DB-free | decline no longer deleting `nl_sid` fails 1; accepting any value fails 8 |
| `submitPlayerLinkSuggestion` (15 new cases; file 160 to 175) | `tests/player-link-mutations.test.ts` | DB-free | limiter bypassed fails 2; storage failure surfaced to the reader fails 1 |
| recorded-zero crowd | `tests/integration/venue-records.test.ts` | seeded subject; holds on a snapshot copy and a rebuilt database | recorded zero treated as unrecorded: `expected 1500 to be +0`; NULL no longer excluded: `expected null to be 1500` (`tst4-mutations.txt`). The old test passes under both mutations on the snapshot (no zero crowd exists there) |
| apostrophe normalisation | `tests/integration/player-matching.test.ts` | seeded subject | SQL normaliser no longer stripping `'` (disposable copy): `expected 'o\'brienzzfixture' to be 'obrienzzfixture'` |
| bare club | `tests/integration/club-coach-records.test.ts` | seeded subject | club scoping removed: `expected [ { coachId: 179, …(12) }, …(382) ] to deeply equal []` |
| leaked fixture season | `tests/integration/leaked-fixtures.ts`, called by admin-season-lists and release-gates | oracle-independent | see below |

Mail (run-plan S-1): the beta tests run the real `@/lib/email/send` against a stubbed `nodemailer`; the relay host is the
unresolvable `smtp.invalid`; `net.Socket.connect`, `tls.connect` and `dns.lookup` are spied on and any call fails the
test. No email is sent, no relay is contacted.

## TST-9 proof

`leak-before-summary.txt` (unfixed code, settle SIGKILLed mid-run after `seasons(2094)` was committed): admin-season-lists
fails `2094: expected true to be false`; release-gates 9 failed (review baseline). `leak-after-summary.txt` (final code,
settle SIGKILLed after `seasons(2076)` was committed): both suites stop in `beforeAll` with "Committed fixture season(s)
left in the test database by an interrupted earlier run: 2076 (in_progress; reserved by …settle-afltables.test.ts) … Re-run
the owning suite alone (it pre-cleans …)". Recovery as stated: settle-afltables alone passes 85/85 and leaves no season
at or above 2060; admin-season-lists then passes 42/42; release-gates then shows its 8 snapshot-pinned failures and no
leak message.

So: an interrupted run still leaves the fixture and the two suites still do not pass until the owner is re-run. What
changed is that the failure is explicit and actionable instead of a bare year, and the two suites no longer share a
season. Real prevention needs the committed-fixture suites to run against a disposable database copy (owner decision 1).

Unique-season status after this change: 2076 settle (ISSUE-099), 2094 awards (identity block) alone. Still shared, on
purpose or outside this change: 2093 (awards finals season, settle ISSUE-122 block, import-role lock fixture), 2091
(awards, admin-coaches). Recorded in `tests/integration/leaked-fixtures.ts`.

## Qualification (checkout `6154732c`, clean)

Raw logs on the host under `evidence/final/`; sha256 in `host-log-sha256.txt`; summaries in `final-summary.txt`.

- Unit (no database variables): `beta-verify`, `nl-feedback`, `player-link-mutations`: 3 files, 257 tests passed.
- Integration, each file alone on a fresh copy of the template: venue-records 15/15, player-matching 23/23,
  club-coach-records 9/9, settle-afltables 85/85, admin-season-lists 42/42 (5 skipped as before), release-gates 51 passed,
  8 failed, 7 skipped.
- release-gates 8 failures are the review's snapshot-pinned set, identical to its own alone-rerun
  (`agents/tests/evidence/rerun-int-release-gates.log`: 8 failed, 51 passed, 7 skipped): Brownlow authority, Advanced
  Search 261, ladder identity, attendance reasons, birth-date remainder, 2026 pending, no 2026 premier, only 2026 in
  progress. Not caused by or fixable in this scope (suite pinned to a rebuilt `afldb_test`, ISSUE-358 area).
- Typecheck (`next typegen` then `tsc --noEmit -p .` on the same clean checkout): exit 0, checkout still clean (`final-tsc.txt`).

## Not done, and why

- The other early returns named above are untouched. Which of them are vacuous on a rebuilt database is not known without
  one; converting them blind could turn a pass into a failure on the oracle they were written for. Candidate follow-up
  after the pins scope has a rebuilt `afldb_test`.
- `awards-reload-links.test.ts` was not changed and not run (python Coleman loader, 900 s hooks; nothing in it changed).
- No run against a rebuilt `afldb_test` (none is available in this scope); seeded subjects use only schema objects
  (migrations 020, 057) and existing clubs, so they do not depend on snapshot content.

## Owner decisions

1. **Prevent, not just name, committed-fixture leaks.** Options: (A) accept the fail-fast message (done); (B) run the
   committed-fixture suites (settle-afltables, awards-reload-links, wildcard-final consumers, data-editor) against a
   per-file disposable database created with `isolated-pg create-db --template` and dropped after; (C) a sweep helper (not
   recommended: awards' afterAll must reload the real Coleman family, which a sweep cannot do). Recommendation: B as a
   separate change, since it alters how the integration gate is run.
2. **Season overlaps 2091 and 2093.** Recommend giving the awards suite fixtures seasons nobody else uses (2061, 2062 are
   free) and updating the ownership table; not done here because the 2093 pairing with the import-role lock fixture is
   deliberate and the Coleman suite is long.

## Files

`tests/beta-verify.test.ts`, `tests/nl-feedback.test.ts`, `tests/player-link-mutations.test.ts`,
`tests/integration/venue-records.test.ts`, `player-matching.test.ts`, `club-coach-records.test.ts`,
`tests/integration/settle-afltables.test.ts`, `tests/integration/leaked-fixtures.ts` (new helper module, not a test
file), `tests/integration/admin-season-lists.test.ts` and `release-gates.test.ts` (one import and one call each, a file
owned outside this scope), three `ERRATA.md` files beside the preserved runners, and this directory.
