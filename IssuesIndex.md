# AFLDB Current Issues Index

> Lightweight session index of open issues only.
>
> `issues.md` is the authoritative detailed ledger.

**Open issues:** 4

All six were opened 2026-09-15 from the Fable NL Search Stage 1 review (Fable 5.1, medium effort),
re-verified by Stage 2 on main `8a0c4cb`. Subsystem: natural-language search (`src/search/nl/`,
`src/db/queries/nl/`). AFLDB-ISSUE-190 resolved 2026-09-15 (Sonnet 5); AFLDB-ISSUE-188 resolved
2026-09-15 (Sonnet 5); see `issues.md`.

| ID | Severity | Area | State | Key files | Next action |
|---|---|---|---|---|---|
| AFLDB-ISSUE-187 | High | NL parser grain election drops career conditions beside a `METRIC_WORDS` threshold | Open / Planning | `src/search/nl/parser.ts` (~2491-2501, ~2853-2858, ~3132-3133) | Sonnet: refuse by name when a non-career grain leaves `careerResult.conditions` unconsumed; extend `tests/nl-semantic-mapping.test.ts` |
| AFLDB-ISSUE-189 | High | Non-leading club/team subject answered at player grain; "teams with the most X" dumps club seasons | Open / Planning | `src/search/nl/parser.ts` (~2348, ~2384, ~2762, ~3396), `vocab.ts` (~168, ~921), `plan.ts` (~1737) | Opus High first: decide decline-vs-club-grain; then pre-extraction subject cue + metric-less `club_season` refusal |
| AFLDB-ISSUE-191 | Medium | Boundary extractor claims bare "first" in finals scope | Open / Planning | `src/search/nl/parser.ts` (~1249, ~1264-1285, ~2338, ~2765) | Sonnet: period-split before boundary, tighten `DEBUT_RE`, refuse boundary+metric; extend `tests/nl-parser.test.ts` |
| AFLDB-ISSUE-192 | Low | Symmetric team-match metrics duplicated per side | Open / Planning | `src/db/queries/nl/team-match.ts` (~19-39, ~210-233) | Sonnet: rank one row per match for `attendance`/`total_score` with no side scope; extend `tests/integration/nl-answers-team-club.test.ts` |

Suggested order: 187 (bounded Sonnet fix, P1), then 189 (needs adjudication), 191, 192.

Completed issue runbooks and supporting evidence are archived under `issues/closed/`.
