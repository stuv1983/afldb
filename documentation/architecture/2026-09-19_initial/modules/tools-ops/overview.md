<!-- DOC | Bootstrap module stub for the tools-ops module of AFLDB -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->


# Module: `tools-ops`

> **Generated stub, 2026-09-19.** Produced mechanically from the API baseline, not written
> by anyone who read this module. Every fact below is a count or a path; nothing here is a
> description of behaviour. `afldb-orchestrator` replaces this with a real overview when
> this module is next worked on. Snapshot credibility decays from the date above.

## Identity

- **Path(s):** `tools/admin`, `tools/build`, `tools/current-season`, `tools/dev`, `tools/gridley`, `tools/issue-152`, `tools/records`, `tools/validation`
- **Apparent purpose:** Grab-bag of eight small operational directories. A PhanesLight grouping, not a CLAUDE.md §6 entry.
- **Tracked files:** 33 (12 examined, 21 not examined)
- **Baseline entries:** 55 (extractor: `tsc-api`)

## Extraction coverage

The API baseline covers `.ts`/`.tsx` and `.sql` only. **21 file(s) in this module
were NOT examined:** 16 `.ps1`, 2 `.mjs`, 2 `.py`, 1 `.md`.

A low or zero entry count above therefore does **not** mean this module has little surface.
It means these extractors do not read those file types. Treat the unexamined set as
unknown, not as empty.

## Largest surfaces (by baseline entry count)

Mechanical ranking only — entry count is a proxy for surface area, not for importance.

- `tools/current-season/repair-match-rekeys.ts` — 14 entries
- `tools/dev/preflight-core.ts` — 10 entries
- `tools/issue-152/phase-d-evidence.ts` — 9 entries
- `tools/issue-152/build-phase-g-corpora.ts` — 8 entries
- `tools/records/special-records-replay.ts` — 7 entries
- `tools/current-season/settle-afltables.ts` — 5 entries
- `tools/dev/bootstrap-worktree.ts` — 1 entry
- `tools/dev/merge-readiness.ts` — 1 entry

## Not established by this stub

Each line records a limit of the *generation method*, not a property of the module.

- Internal structure and layering: **not determined** — this stub counted exports and did
  not read any file in this module. VERIFY against the code before relying on any of it.
- Inbound and outbound dependencies: **not traced** — no import graph was built.
- Behavioural contracts (null-versus-throw, ordering, idempotency): **not captured** — these
  belong in `documentation/registry/tools-ops.md`, which is deliberately empty until someone
  has a confirmed annotation to add.
