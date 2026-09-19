<!-- DOC | What this tree is for and which AFLDB sources remain authoritative over it -->
<!-- DOC DISCIPLINE | Soft ceiling: 500 lines. One topic per file; structure under ## headings.
     The DOC line above feeds `phaneslight doc-index`, keep it accurate; it is this file's line in _index.md.
     If this file exceeds the ceiling: split it into a same-named folder of focused topic files;
     carry both header lines into every part; update every inbound reference in the same change set;
     finish by running `phaneslight doc-index`.
     Consumers: NEVER bulk-read documentation folders, read _index.md first, load only what you need.
     Audit: `phaneslight doc-check`. -->

# `documentation/` — PhanesLight operational memory

**This tree is agent working memory. It is NOT an authoritative AFLDB source, and it does not
compete with one.**

It exists so PhanesLight agents can carry state between sessions: what was done, what was decided
and why, what is still open, and what each module's contracts are. Everything in it is subordinate
to the AFLDB records below.

## Authority — read this before citing anything in here

| Question | Authoritative source | This tree's role |
|---|---|---|
| What is broken, tracked, open or resolved | **`issues.md`** (detailed ledger), **`IssuesIndex.md`** (open-issue index) | **None.** This tree is not an issue ledger. Never open, resolve or track a defect here. |
| What the system's architecture is | **`docs/`** — `architecture.md`, `project-brief.md`, `search.md`, `data-dictionary.md`, `deployment.md`, `aflw.md` | Dated, decaying *snapshots* for agent orientation only. On any conflict, `docs/` wins. |
| What changed in the product | **`CHANGELOG.md`** | **None.** |
| How agents must operate | **`CLAUDE.md`** §1–§14, then §15 | §15 describes the agent team; §1–§14 govern it. |
| What a module's contracts and prohibitions are | `documentation/registry/<module>.md` | **This is the one thing this tree owns**, because nothing else records it. |

**On conflict, the AFLDB source wins and the file here is the defect.** If you find a contradiction,
fix the file here — never edit `docs/`, `issues.md` or `IssuesIndex.md` to agree with it.

## What lives here

- **`session-summaries/`** — one per session: what was done, decided, and left open. Frozen once
  written; never edited to conform to a later rule.
- **`plans/`** — implementation and fix plans. Working documents, not runbooks of record.
- **`architecture/<date>_<reason>/`** — dated orientation snapshots. **Credibility decays from the
  folder date.** Verify against live code before relying on one for any non-trivial decision.
- **`registry/<module>.md`** — curated module annotations: deprecations, "use X instead", contracts
  beyond type signatures, anti-patterns. Deliberately empty until someone has a *confirmed*
  annotation; pre-filling it with guesses would poison the strongest anti-hallucination signal
  available to agents.
- **`archive/projects/`** — condensed digests of closed register entries. Frozen on write.

## Navigation

**NEVER bulk-read or glob-scan this tree.** Every folder carries a GENERATED `_index.md`: read the
index, pick the entry, recurse, load only the target file. Indexes are written solely by
`node .phaneslight/scripts/cli.js doc-index` — hand-editing one is forbidden; regenerate instead.
Audit hygiene with `doc-check`.

`docs/`, `issues.md` and `IssuesIndex.md` keep their own read discipline from `CLAUDE.md` §3–§5,
which this tree does not modify. In particular, **never bulk-read `issues.md`** — search it
narrowly for the exact entry you need.

## Not migrated here, deliberately

No existing AFLDB record has been copied, moved or restated into this tree, and none should be.
Duplicating `docs/` or `issues.md` content here would create two copies that drift apart with no
rule for which is right. Point at the source instead.
