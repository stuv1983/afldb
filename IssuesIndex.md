# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.

**Open issues:** 0

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
`STALE_CORPUS_EXPECTATION`, and opened AFLDB-ISSUE-197 for the 40 (one root cause).
**AFLDB-ISSUE-197 resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-197.md` —
Option C, a dedicated `resolvePlayerFamily` resolver mirroring the parser's whole-word-prefix
predicate in SQL; `PARSER_VERSION` 48 → 49; operator-validated: 25/25
`tests/integration/nl-semantic-mapping.test.ts`, 951/951 across the full focused NL suite set,
clean `tsc --noEmit` — see `issues.md` for the full Implementation/Validation/Resolution record,
including one mid-session fixture correction and one integration-path control-flow investigation
that concluded fixture defect, not production defect). AFLDB-ISSUE-187..197 all now resolved.

Stage 2 status: **blocked again, narrowly.** ISSUE-197 resolving its one genuine fail-open root
cause cleared six of the seven generic-surname families (Johnson, Brown, Smith, Williams, Wilson,
Anderson). The v49 regression rerun (2026-09-16) found the seventh, Jones (rows 11626-11630,
5 rows), still hard-failing for a distinct-but-related reason: the parser's own defence-in-depth
`candidateNameWords` re-check does not tokenise hyphenated surnames (`Darcy Byrne-Jones`,
`David Rhys-Jones`) the same way SQL's `afldb_normalise_name` does, undercounting the real 13-member
Jones family to 11 and ranking a wrong answer instead of declining. **AFLDB-ISSUE-198 opened
2026-09-16, resolved 2026-09-16** (Sonnet 5, from the approved runbook `AFLDB-ISSUE-198.md` — one
implementation-time deviation from its §5 Option C code sketch, found empirically: `candidatePlayerSpan`
widens its acceptance test via the new shared `splitNameWords` helper but keeps the original
punctuation-bearing token, rather than exploding it, to stay aligned with the confidence/leftover-token
accounting elsewhere in the parser — see `issues.md`'s Implementation section). `PARSER_VERSION` 49 →
50. Operator-validated 2026-09-16: `tests/integration/nl-semantic-mapping.test.ts` 29/29 (DB-backed,
`afldb_test`), combined focused suite 964/964 across 6 files (`nl-parser.test.ts` 413/413,
`nl-semantic-mapping.test.ts` 167/167, `nl-regression-corpus.test.ts` 163/163,
`nl-audit-acceptance.test.ts` 10/10, `nl-plan.test.ts` 182/182, plus the integration file above),
clean `tsc --noEmit`. AFLDB-ISSUE-187..198 all now resolved.

The unchanged V1 12k-row corpus re-run on parser v50 (post-merge Stage 2 step, expected to clear the
five Jones rows 11626-11630 with no other movement) has NOT been run yet — do not assume its result.
The corpus relabelling that follows from ISSUE-197/198, and the rest of the Stage 2 closeout sequence
below, remain outstanding.

Full entries, evidence, root causes and acceptance criteria are in `issues.md`.

## Stage 2 next task

1. **Done** (2026-09-16) — V1 regression corpus re-run against parser v49 (parse-only): hard
   failures 208 -> 178.
2. **Done** (2026-09-16) — fresh run's semantic rows compared against the retained v48 baseline:
   1271 -> 1241 non-clean rows, 30 rows became clean, 0 new non-clean rows, 0
   changed-but-still-non-clean rows. This comparison is what surfaced the Jones rows (§ above,
   AFLDB-ISSUE-198) as still-hard rather than clean.
3. Corpus expectation cleanup for the ISSUE-197/198-affected rows, still not performed: 30 of the 35
   generic-surname rows (Johnson/Brown/Smith/Williams/Wilson/Anderson, all 5 each) stay expected
   declines and are now clean; the 5 Jones rows (11626-11630) stay expected declines and were still
   hard failures in the v49 corpus record — AFLDB-ISSUE-198 is now resolved and operator-validated,
   but do not relabel the Jones rows until the unchanged corpus is re-run on parser v50 and they are
   confirmed clean row-by-row. The 5 Ablett rows relabel from expected-decline to expected successful
   ranking across the complete 7-player family. Separately, the 168 stale team-streak/coach-record
   rows get their own
   expectation correction (unrelated to ISSUE-197/198, a distinct stale-corpus issue).
4. A fresh exploratory stress sweep to identify any remaining NL coverage/safety gaps beyond this
   triage.

Do not alter the corpus before that dedicated session runs it.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
