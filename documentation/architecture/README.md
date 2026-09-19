<!-- DOC | How to read and when to take AFLDB architecture snapshots -->
Architecture snapshots are dated, decreasingly-reliable artifacts.

Each subfolder reflects state on its name-date. Treat snapshots as architectural guidance, NOT source of truth, for any area that may have changed since the snapshot date, verify against current code before relying on it. Snapshot credibility decays day by day from the snapshot date; LLM agents reading a snapshot dated 30 days before the current session must treat it as scaffolding, not specification.

Take new snapshots on explicit triggers ONLY:
- Pre-major-refactor
- Post-milestone
- On demand by user

Do not snapshot automatically. Substantive changes warrant a new dated folder; minor in-place corrections require renaming the folder to the correction date so decay calculations remain meaningful.

Snapshot levels (two levels, high and low; mid-level intentionally omitted to reduce maintenance overhead):
- overview.md, system-level: module list, communication map, tech stack, top-level description
- modules/<module>/overview.md, per-module: workflow, internal structure, key files, layers (frontend/backend/etc.)

Single writer: `<projectSlug>-orchestrator`.
