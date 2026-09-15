# AFLDB-ISSUE-171 — Expand “Record of the week” beyond career-player records

## Status

Resolved locally on 2026-09-14 after focused unit, typecheck, database-backed integration and
production-build validation passed.

## Problem

The AFL home-page setting accepted only five career-player values because the panel directly called
`getCareerRecord()` and assumed every result was a player-career row. Existing public read models
already support useful match, season, coach, venue and curated special records.

Discovery is bounded by `AFLDB-ISSUE-171-CODEX-CONTEXT.md`,
`AFLDB-ISSUE-171-DATA-EVIDENCE.txt` and `ISSUE-171-DATA-EVIDENCE.sql`.

## Implemented design

- A typed compile-time catalogue owns stable value, admin group/label, public title, definition,
  coverage, unit, domain/grain, provider, render kind and optional destination.
- The five legacy values are unchanged. Unknown or malformed stored values fall back to
  `most-goals` before provider dispatch.
- The home path resolves the setting first and executes only the selected bounded provider.
- A finite discriminated row union renders player-career, player-match, player-season, coach,
  venue and curated-player results with entity-correct links and a graceful empty state.
- The admin control remains native but uses six `<optgroup>` groups. `site.settings` authorization
  and AFLW behaviour are unchanged.

## Included catalogue

- Players — Career: Most Goals, Most Games, Most Finals, Most Premierships, Most Brownlow Votes.
- Players — Match: Most Goals in a Match, Most Disposals in a Match.
- Players — Season: Most Goals in a Season.
- Coaches: Most Games, Wins, Finals, Grand Finals and Premierships Coached; Best Coaching Win
  Percentage (minimum 50 games, draws count as half a win).
- Venues: Most Matches, Finals and Grand Finals Hosted; Highest Recorded Attendance.
- Special records: Most After-the-Siren Attempts, Goals and Goals to Win; Most Consecutive Goals
  from First Career Kicks.

## Deferred or rejected

- After-the-siren goals to draw: only nine events and the supplied board is a shallow all-ones tie.
- Average venue attendance: no product-approved minimum recorded-match sample exists.
- Earliest/latest individual events: highlights, not ranked numeric leaderboards.
- Lowest attendance and arbitrary match/team aggregates: weak showcase choices or outside the
  established canonical home-record surfaces.

## Naming and compatibility

The selection-specific `/records` card and page use **Father–Son Selections**, distinct from
**Most Games by Family**. No stored value or schema migration is required.

## Validation

Completed on 2026-09-14:

- Focused unit gate: `tests/site-settings.test.ts`, `tests/home-records.test.ts`,
  `tests/family-records-surfaces.test.ts` and `tests/admin-settings-actions.test.ts` — 4 files,
  53/53 tests passed.
- `npm run typecheck` — passed with no diagnostics.
- Focused `afldb_test` integration: `tests/integration/home-records.test.ts` — 4/4 tests passed via
  `127.0.0.1:55432`, covering career/match/season semantics, canonical coaching assignments,
  venue counts and NULL attendance, and the active-linked curated special-record rules.
- Production build with `DATABASE_URL` temporarily set to `AFLDB_TEST_DATABASE_URL` — Next.js
  16.3.1 build passed, including TypeScript, 1,516/1,516 static pages, build traces, final
  optimisation and `prepare-standalone`; exit code 0.

The build reported only the existing middleware-to-proxy deprecation and Next-internal Edge
Runtime `process.cwd` warnings. Neither is caused by or blocks this issue.
