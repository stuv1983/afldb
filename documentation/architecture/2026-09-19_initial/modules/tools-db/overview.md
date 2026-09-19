<!-- DOC | Bootstrap module stub for the tools-db module of AFLDB -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->


# Module: `tools-db`

> **Generated stub, 2026-09-19.** Produced mechanically from the API baseline, not written
> by anyone who read this module. Every fact below is a count or a path; nothing here is a
> description of behaviour. `afldb-orchestrator` replaces this with a real overview when
> this module is next worked on. Snapshot credibility decays from the date above.

## Identity

- **Path(s):** `tools/db`
- **Apparent purpose:** Database migration runner (CLAUDE.md §6), plus privileges, rebuild and promotion checks.
- **Tracked files:** 12 (12 examined, 0 not examined)
- **Baseline entries:** 311 (extractor: `tsc-api`)

## Extraction coverage

Every tracked file in this module was examined by the baseline extractor.

## Largest surfaces (by baseline entry count)

Mechanical ranking only — entry count is a proxy for surface area, not for importance.

- `tools/db/rebuild-test.ts` — 116 entries
- `tools/db/promotion-inventory.ts` — 107 entries
- `tools/db/prove-reset.ts` — 36 entries
- `tools/db/catalog-fingerprint.ts` — 13 entries
- `tools/db/migration-safety.ts` — 13 entries
- `tools/db/psql.ts` — 13 entries
- `tools/db/promotion-check.ts` — 6 entries
- `tools/db/fingerprint-test.ts` — 4 entries
- `tools/db/migration-checksum.ts` — 3 entries

## Not established by this stub

Each line records a limit of the *generation method*, not a property of the module.

- Internal structure and layering: **not determined** — this stub counted exports and did
  not read any file in this module. VERIFY against the code before relying on any of it.
- Inbound and outbound dependencies: **not traced** — no import graph was built.
- Behavioural contracts (null-versus-throw, ordering, idempotency): **not captured** — these
  belong in `documentation/registry/tools-db.md`, which is deliberately empty until someone
  has a confirmed annotation to add.
