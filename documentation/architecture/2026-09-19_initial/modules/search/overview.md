<!-- DOC | Bootstrap module stub for the search module of AFLDB -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->


# Module: `search`

> **Generated stub, 2026-09-19.** Produced mechanically from the API baseline, not written
> by anyone who read this module. Every fact below is a count or a path; nothing here is a
> description of behaviour. `afldb-orchestrator` replaces this with a real overview when
> this module is next worked on. Snapshot credibility decays from the date above.

## Identity

- **Path(s):** `src/search`
- **Apparent purpose:** Typed search, query builder, Grid Solver, NL search (CLAUDE.md §6).
- **Tracked files:** 21 (21 examined, 0 not examined)
- **Baseline entries:** 412 (extractor: `tsc-api`)

## Extraction coverage

Every tracked file in this module was examined by the baseline extractor.

## Largest surfaces (by baseline entry count)

Mechanical ranking only — entry count is a proxy for surface area, not for importance.

- `src/search/nl/vocab.ts` — 101 entries
- `src/search/nl/plan.ts` — 81 entries
- `src/search/query-builder-spec.ts` — 34 entries
- `src/search/grid-solver-spec.ts` — 27 entries
- `src/search/aflw-filters.ts` — 19 entries
- `src/search/query-intent.ts` — 18 entries
- `src/search/table-filters.ts` — 18 entries
- `src/search/match-spec.ts` — 17 entries
- `src/search/nl/answer-types.ts` — 17 entries
- `src/search/list-filters.ts` — 14 entries

## Task routing (from `CLAUDE.md` §7)

NL search: exact failing query → relevant stage → focused test. Grid Solver: solver code → UI route/component → focused tests.

## Existing test homes

Extend the closest existing suite; do not create a new test file by default (`CLAUDE.md` §10).

`tests/nl-parser.test.ts, tests/nl-plan.test.ts, tests/nl-describe.test.ts, tests/grid-solver*.test.ts, tests/nl-ui/nl-stress.spec.ts`

## Not established by this stub

Each line records a limit of the *generation method*, not a property of the module.

- Internal structure and layering: **not determined** — this stub counted exports and did
  not read any file in this module. VERIFY against the code before relying on any of it.
- Inbound and outbound dependencies: **not traced** — no import graph was built.
- Behavioural contracts (null-versus-throw, ordering, idempotency): **not captured** — these
  belong in `documentation/registry/search.md`, which is deliberately empty until someone
  has a confirmed annotation to add.
