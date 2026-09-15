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
AFLDB-ISSUE-193 (opened 2026-09-15 during ISSUE-189 planning) resolved 2026-09-15 (Sonnet 5,
operator-validated); see `issues.md`.
AFLDB-ISSUE-192 resolved 2026-09-15 (Sonnet 5, operator-validated: 31/31 integration tests,
5/5 ISSUE-192 regression tests, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-187..193 all remain resolved; the Stage 2 closeout audit (2026-09-16, Sonnet 5 High)
found three neighbouring, unrelated defects while verifying the resolved fixes and opened
AFLDB-ISSUE-194..196. AFLDB-ISSUE-196 resolved 2026-09-16 (Sonnet 5 High, from the approved
runbook — one runbook correction to the `across` regression contract mid-implementation, see
`issues.md` — operator-validated: 389/389 `nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`,
clean `tsc --noEmit`). AFLDB-ISSUE-194 and 195 remain open. Stage 2 status:
**PASS WITH NEW ISSUES — not signed off.**

| ID | Severity | Area | State | Key files | Next action |
|---|---|---|---|---|---|
| AFLDB-ISSUE-194 | Low/P3 | NL team-match compiler | Open, not implemented | `src/db/queries/nl/team-match.ts` | Extend the ISSUE-192 home-side gate to `scope.matchup`; DB-backed regression in `tests/integration/nl-answers-team-club.test.ts` |
| AFLDB-ISSUE-195 | High/P1 | NL parser / club-season semantics | Runbook approved (`AFLDB-ISSUE-195.md`), not implemented | `src/search/nl/vocab.ts`, `parser.ts`, `plan.ts` | Implement the approved runbook: subject-gated "won the/a premiership" vocabulary + club-season ownership guard; regression block in `tests/nl-parser.test.ts` (AFLDB-ISSUE-189 describe) |

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 sign-off conditions (not yet met)

- AFLDB-ISSUE-194 and 195 resolved.
- Mapped regression suites green.
- `npx tsc --noEmit` clean.
- A fresh V1 parse-only corpus run compared row-by-row against the retained baseline
  `~/nl-stress-v46`.
- The current 208 `AMBIGUITY_NOT_DETECTED` corpus rows triaged into stale/incorrect corpus
  expectations vs. genuine fail-open defects.
- Any genuine reproducible fail-open found during that triage tracked as a new issue before
  sign-off.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
