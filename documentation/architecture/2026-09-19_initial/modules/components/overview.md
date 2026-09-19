<!-- DOC | Bootstrap module stub for the components module of AFLDB -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->


# Module: `components`

> **Generated stub, 2026-09-19.** Produced mechanically from the API baseline, not written
> by anyone who read this module. Every fact below is a count or a path; nothing here is a
> description of behaviour. `afldb-orchestrator` replaces this with a real overview when
> this module is next worked on. Snapshot credibility decays from the date above.

## Identity

- **Path(s):** `src/components`
- **Apparent purpose:** Shared React UI components (CLAUDE.md §6).
- **Tracked files:** 56 (56 examined, 0 not examined)
- **Baseline entries:** 75 (extractor: `tsc-api`)

## Extraction coverage

Every tracked file in this module was examined by the baseline extractor.

## Largest surfaces (by baseline entry count)

Mechanical ranking only — entry count is a proxy for surface area, not for importance.

- `src/components/CoachCareerRecord.tsx` — 7 entries
- `src/components/SiteNav.tsx` — 5 entries
- `src/components/SortableTable.tsx` — 4 entries
- `src/components/admin/action-submit.ts` — 2 entries
- `src/components/Breadcrumbs.tsx` — 2 entries
- `src/components/NlAnswerSection.tsx` — 2 entries
- `src/components/PlayerFamilyCard.tsx` — 2 entries
- `src/components/RouteSortHeader.tsx` — 2 entries
- `src/components/SortableHeader.tsx` — 2 entries
- `src/components/admin/AdminPager.tsx` — 1 entry

## Task routing (from `CLAUDE.md` §7)

Frontend/UI: shared component/theme only when implicated by the route.

## Existing test homes

Extend the closest existing suite; do not create a new test file by default (`CLAUDE.md` §10).

`tests/club-comparison-view.test.ts and sibling view tests`

## Not established by this stub

Each line records a limit of the *generation method*, not a property of the module.

- Internal structure and layering: **not determined** — this stub counted exports and did
  not read any file in this module. VERIFY against the code before relying on any of it.
- Inbound and outbound dependencies: **not traced** — no import graph was built.
- Behavioural contracts (null-versus-throw, ordering, idempotency): **not captured** — these
  belong in `documentation/registry/components.md`, which is deliberately empty until someone
  has a confirmed annotation to add.
