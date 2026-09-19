<!-- DOC | Bootstrap module stub for the tools-nl module of AFLDB -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->


# Module: `tools-nl`

> **Generated stub, 2026-09-19.** Produced mechanically from the API baseline, not written
> by anyone who read this module. Every fact below is a count or a path; nothing here is a
> description of behaviour. `afldb-orchestrator` replaces this with a real overview when
> this module is next worked on. Snapshot credibility decays from the date above.

## Identity

- **Path(s):** `tools/nl`
- **Apparent purpose:** NL corpora, stress/UI runners, comparisons (CLAUDE.md §6).
- **Tracked files:** 23 (16 examined, 7 not examined)
- **Baseline entries:** 142 (extractor: `tsc-api`)

## Extraction coverage

The API baseline covers `.ts`/`.tsx` and `.sql` only. **7 file(s) in this module
were NOT examined:** 4 `.mjs`, 1 `.md`, 1 `.py`, 1 `.csv`.

A low or zero entry count above therefore does **not** mean this module has little surface.
It means these extractors do not read those file types. Treat the unexamined set as
unknown, not as empty.

## Largest surfaces (by baseline entry count)

Mechanical ranking only — entry count is a proxy for surface area, not for importance.

- `tools/nl/v2.ts` — 33 entries
- `tools/nl/ui-corpus.ts` — 20 entries
- `tools/nl/audit-issue-200-shared.ts` — 14 entries
- `tools/nl/corpus.ts` — 14 entries
- `tools/nl/engine.ts` — 11 entries
- `tools/nl/fix-stale-finals-without-premiership-tie.ts` — 11 entries
- `tools/nl/audit-issue-200-cluster.ts` — 7 entries
- `tools/nl/audit-issue-200-extract.ts` — 7 entries
- `tools/nl/fix-issue-199-stale-expectations.ts` — 6 entries
- `tools/nl/fix-issue-204-stale-coverage-expectations.ts` — 6 entries

## Not established by this stub

Each line records a limit of the *generation method*, not a property of the module.

- Internal structure and layering: **not determined** — this stub counted exports and did
  not read any file in this module. VERIFY against the code before relying on any of it.
- Inbound and outbound dependencies: **not traced** — no import graph was built.
- Behavioural contracts (null-versus-throw, ordering, idempotency): **not captured** — these
  belong in `documentation/registry/tools-nl.md`, which is deliberately empty until someone
  has a confirmed annotation to add.
