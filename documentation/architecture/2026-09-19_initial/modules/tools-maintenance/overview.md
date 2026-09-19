<!-- DOC | Bootstrap module stub for the tools-maintenance module of AFLDB -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->


# Module: `tools-maintenance`

> **Generated stub, 2026-09-19.** Produced mechanically from the API baseline, not written
> by anyone who read this module. Every fact below is a count or a path; nothing here is a
> description of behaviour. `afldb-orchestrator` replaces this with a real overview when
> this module is next worked on. Snapshot credibility decays from the date above.

## Identity

- **Path(s):** `tools/maintenance`
- **Apparent purpose:** Host setup, privileges, backup/restore, load testing (CLAUDE.md §6).
- **Tracked files:** 10 (1 examined, 9 not examined)
- **Baseline entries:** 1 (extractor: `tsc-api`)

## Extraction coverage

The API baseline covers `.ts`/`.tsx` and `.sql` only. **9 file(s) in this module
were NOT examined:** 7 `.sh`, 1 `.ps1`, 1 `.mjs`.

A low or zero entry count above therefore does **not** mean this module has little surface.
It means these extractors do not read those file types. Treat the unexamined set as
unknown, not as empty.

## Largest surfaces (by baseline entry count)

Mechanical ranking only — entry count is a proxy for surface area, not for importance.

- `tools/maintenance/privileges.sql` — 1 entry

## Task routing (from `CLAUDE.md` §7)

Backup/restore: backup/restore docs → relevant maintenance script/config.

## Not established by this stub

Each line records a limit of the *generation method*, not a property of the module.

- Internal structure and layering: **not determined** — this stub counted exports and did
  not read any file in this module. VERIFY against the code before relying on any of it.
- Inbound and outbound dependencies: **not traced** — no import graph was built.
- Behavioural contracts (null-versus-throw, ordering, idempotency): **not captured** — these
  belong in `documentation/registry/tools-maintenance.md`, which is deliberately empty until someone
  has a confirmed annotation to add.
