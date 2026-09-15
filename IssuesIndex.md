# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.

**Open issues:** 2

AFLDB-ISSUE-187..192 were opened 2026-09-15 from the Fable NL Search Stage 1 review (Fable 5.1,
medium effort), re-verified by Stage 2 on main `8a0c4cb`. Subsystem: natural-language search
(`src/search/nl/`, `src/db/queries/nl/`). AFLDB-ISSUE-190 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-188 resolved 2026-09-15 (Sonnet 5); AFLDB-ISSUE-187 resolved 2026-09-15 (Sonnet 5);
AFLDB-ISSUE-189 resolved 2026-09-15 (Sonnet 5, from the approved runbook, operator-validated);
AFLDB-ISSUE-191 resolved 2026-09-15 (Sonnet 5, operator-validated); see `issues.md`.
AFLDB-ISSUE-193 was opened 2026-09-15 during ISSUE-189 planning and stays open.

| ID | Severity | Area | State | Key files | Next action |
|---|---|---|---|---|---|
| AFLDB-ISSUE-192 | Low | Symmetric team-match metrics duplicated per side | Open / Planning | `src/db/queries/nl/team-match.ts` (~19-39, ~210-233) | Sonnet: rank one row per match for `attendance`/`total_score` with no side scope; extend `tests/integration/nl-answers-team-club.test.ts` |
| AFLDB-ISSUE-193 | Medium | Club-subject "won more than N premierships/flags" counts match wins via a `team_match` having clause | Open / Planning | `src/search/nl/parser.ts` `extractHavingClause` (~1398-1413, ~2360-2371); `tests/nl-parser.test.ts` (~562-566) | Sonnet: decline by name when a club subject's having number governs a career-only noun; update the ISSUE-188 regression |

Suggested order: 193, 192.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
