# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.

**Open issues:** 1

- **AFLDB-ISSUE-197** — High (P1). NL resolver/parser boundary: `resolvePlayer`
  (`src/db/queries/nl/resolve.ts`) hard-caps surname candidates at 5 before the parser's ambiguity
  check runs, so the documented 2–12 "complete family" / >12 "decline" contract
  (`NL_LIMITS.maxPlayerCandidates`) is unreachable in production — a ≤12 real family (Ablett, 7
  players) ranks over an incomplete subset, and a >12 generic surname (Brown, Smith, Johnson,
  Williams, Jones, Wilson, Anderson) answers confidently instead of declining. Found by the Stage 2
  closeout audit's 40 `GENUINE_FAIL_OPEN` rows (2026-09-16). Planning complete: runbook
  `AFLDB-ISSUE-197.md` (chosen fix: Option C, a dedicated `resolvePlayerFamily` resolver mirroring
  the parser's whole-word-prefix predicate in SQL; naive "just raise the limit" Option A rejected
  as unsafe). Not implemented. Next action: implement per the runbook, `PARSER_VERSION` 48 → 49, on
  a fresh session/worktree.

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
clean `tsc --noEmit`). AFLDB-ISSUE-195 resolved 2026-09-16 (Sonnet 5 High, from the approved runbook
`AFLDB-ISSUE-195.md`, Option B — subject-gated "won the/a premiership" vocabulary plus a narrow
club-season ownership guard, no runbook correction needed — operator-validated: 398/398
`nl-parser.test.ts`, 167/167 `nl-semantic-mapping.test.ts`, clean `tsc --noEmit`); see `issues.md`.
AFLDB-ISSUE-194 resolved 2026-09-16 (Sonnet 5 Medium, `sonnet/issue-194-team-match-symmetric-matchup`,
unmerged — operator-validated: 34/34 `tests/integration/nl-answers-team-club.test.ts`, clean
`tsc --noEmit`); see `issues.md`. AFLDB-ISSUE-187..196 all now resolved. The Stage 2 corpus triage
of the 208 `AMBIGUITY_NOT_DETECTED` rows (2026-09-16) classified 40 as `GENUINE_FAIL_OPEN`, 168 as
`STALE_CORPUS_EXPECTATION`, and opened AFLDB-ISSUE-197 for the 40 (one root cause). Stage 2 status:
**BLOCKED ON AFLDB-ISSUE-197 — planning complete, not implemented; corpus relabelling still not
started.**

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 sign-off conditions (not yet met)

- Mapped regression suites green.
- `npx tsc --noEmit` clean.
- A fresh V1 parse-only corpus run compared row-by-row against the retained baseline
  `~/nl-stress-v46`.
- The current 208 `AMBIGUITY_NOT_DETECTED` corpus rows triaged into stale/incorrect corpus
  expectations vs. genuine fail-open defects.
- Any genuine reproducible fail-open found during that triage tracked as a new issue before
  sign-off — done: AFLDB-ISSUE-197 (40 rows, one root cause). Sign-off additionally requires
  AFLDB-ISSUE-197 resolved and the 35 affected generic-surname/Ablett corpus rows relabelled.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
