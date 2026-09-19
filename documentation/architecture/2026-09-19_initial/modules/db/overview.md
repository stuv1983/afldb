<!-- DOC | Bootstrap module stub for the db module of AFLDB -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->


# Module: `db`

> **Generated stub, 2026-09-19.** Produced mechanically from the API baseline, not written
> by anyone who read this module. Every fact below is a count or a path; nothing here is a
> description of behaviour. `afldb-orchestrator` replaces this with a real overview when
> this module is next worked on. Snapshot credibility decays from the date above.

## Identity

- **Path(s):** `src/db`
- **Apparent purpose:** Parameterised PostgreSQL application queries and ordered migrations (CLAUDE.md §6).
- **Tracked files:** 176 (176 examined, 0 not examined)
- **Baseline entries:** 1181 (extractor: `tsc-api`)

## Extraction coverage

Every tracked file in this module was examined by the baseline extractor.

## Largest surfaces (by baseline entry count)

Mechanical ranking only — entry count is a proxy for surface area, not for importance.

- `src/db/queries/club-comparison.ts` — 88 entries
- `src/db/queries/admin-awards.ts` — 80 entries
- `src/db/queries/admin-fixtures.ts` — 78 entries
- `src/db/queries/admin-draft.ts` — 57 entries
- `src/db/queries/admin-special-records.ts` — 55 entries
- `src/db/queries/admin-club-leadership.ts` — 50 entries
- `src/db/queries/admin-season-lists.ts` — 49 entries
- `src/db/queries/aflw.ts` — 45 entries
- `src/db/queries/players.ts` — 36 entries
- `src/db/queries/awards.ts` — 32 entries

## Task routing (from `CLAUDE.md` §7)

DB query/result bug: caller → relevant query → exact tables/columns → targeted SQL evidence. Schema change: current usage → migration → affected queries → targeted validation.

## Existing test homes

Extend the closest existing suite; do not create a new test file by default (`CLAUDE.md` §10).

`tests/integration/*.test.ts (AFLDB_TEST_DATABASE_URL; database name must end in _test)`

## Not established by this stub

Each line records a limit of the *generation method*, not a property of the module.

- Internal structure and layering: **not determined** — this stub counted exports and did
  not read any file in this module. VERIFY against the code before relying on any of it.
- Inbound and outbound dependencies: **not traced** — no import graph was built.
- Behavioural contracts (null-versus-throw, ordering, idempotency): **not captured** — these
  belong in `documentation/registry/db.md`, which is deliberately empty until someone
  has a confirmed annotation to add.
