# AFLDB-ISSUE-227 — DraftGuru bridge lineage tooling: v2-only pin with no CLI override for a later corrected parent

**Status: Resolved.**
**Opened:** 2026-09-19 (Sonnet 5).
**Resolved:** 2026-09-23 (Sonnet 5).

---

## Symptom

`tools/rebuild/draftguru/validate_person_bridge_child.py` and
`tools/rebuild/draftguru/bridge_import_gate.py` each hard-coded the expected DraftGuru bridge
lineage — parent hash, deployment-child hash, population counts, and the v1→v2 corrected-identity
map — as module-level constants, with no CLI override and no concept of "lineage" as a dimension
separate from `--target`.

Raised 2026-09-19 while executing AFLDB-ISSUE-224 Phase 5 read-only steps against a new,
independently corrected v3 source-evidence parent (Dean Laidley / Matthew Capuano corrected out of
`target_not_registered` into their already-registered identities,
`bridge-v3-reconciliation-issue224-20260919-v1.json`, `changed_rows=2`). The v3 export itself
succeeded cleanly; both validation tools then refused, tracing entirely to the hard-coded v2 pins —
`validate_person_bridge_child.py` reported 7 explainable FAILs naming only the two corrected
persons, and `bridge_import_gate.py plan --target test` refused **before opening any database
connection** (`child count bridges is 3470, expected 3468`).

Both refusals were the tools working exactly as designed (fail closed on an unrecognised lineage).
This was a reusable-tooling maintenance gap — it would recur at the next parent correction (v4, v5,
…) regardless of how AFLDB-ISSUE-224's own registration population was resolved — not a
data-integrity or security defect, and not evidence against the v3 parent correction itself.

## Root cause

Neither tool separated "which database a run reads" (`--target`) from "which source-evidence
parent/deployment-child artefact vintage a run is pinned against" (lineage). Lineage was baked into
the same module constants the tools' fail-closed checks read directly, so a later accepted lineage
could only be reached by editing tool source.

## Fix

**`tools/rebuild/draftguru/bridge_import_gate.py`** — an additive `LINEAGES = {"v2": ..., "v3": ...}`
dict, built by reference to the pre-existing v2 module constants (never retyped, so the two
representations cannot drift apart), plus a new `effective_config(target, lineage)` that returns a
**fresh dict on every call**. Substitution applies to the `test` target's child fields only; `dev`
keeps its child fields `None` regardless of lineage, since a DEV deployment child is always a live
per-target measurement, never a pinned artefact. No module global (`TARGETS`, `CHILD_REL`,
`EXPECTED_CHILD_SHA256`, `EXPECTED_CHILD_COUNTS`, `PARENT_REL`, `EXPECTED_PARENT_SHA256`) is ever
mutated, so a `--lineage v3` invocation cannot leak into a later, unrelated call within the same
process. `refuse_test_child_under()` was widened to enumerate every entry in `LINEAGES` — not just
the caller's own `--lineage` — so adding a lineage only ever *adds* to the DENY set and the v2
refusal stays exactly as strong as it was before lineages existed. A new `--lineage {v2,v3}` CLI
flag (default `v2`) substitutes both the `--parent` and `--expect-parent-sha256` defaults post-parse
for every target, closing an argparse-definition-time asymmetry that otherwise let the parent
default silently apply to `dev` while the child defaults correctly did not. An unsupported
`--lineage` value is rejected immediately by argparse, before any file or DSN is read.

**`tools/rebuild/draftguru/validate_person_bridge_child.py`** (the v1→v2 validator) — **zero edits.**
A fresh run reproduces the pinned `summary_sha256: 5bc5336b…` exactly.

**`tools/rebuild/draftguru/validate_person_bridge_child_v3.py`** (new) — a wholly separate module,
never importing or editing the v2 validator. Its own pinned constants
(`CHILD_REL`/`EXPECTED_CHILD_SHA256`/`PINNED_INPUTS`/`CORRECTED`/`EXPECT`) and its own
seven-section check sequence (bytes and pinned lineage; identity of the child; schema/partition/
uniqueness; parent containment; the exact v2→v3 transition; registration measurement and timestamp
ordering; hygiene) prove the transition end to end against the real AFLDB-ISSUE-224 artefact schema
(`classification`/`operator_decision`/`evidence_reference`), not the unrelated AFLDB-ISSUE-222
verdict schema's `operator_verdict`/`draftguru_url`/`corrected_identity_candidate` fields. Opens no
database, performs no network request, writes no file; `validate()` takes every input as an
explicit parameter and returns a fresh summary dict per call.

## Validation (2026-09-23, against current `main`, `afldb_test`/`afldb_dev` untouched, no database connection opened, no production contact)

- `python tools/rebuild/draftguru/validate_person_bridge_child.py` (v2, unmodified file): PASS,
  `summary_sha256: 5bc5336be116cc797b011900b3fdbc010cd4dd59a9eba4c4495c321f7e6ce590` — the exact
  externally-pinned v2 digest, unchanged.
- `python tools/rebuild/draftguru/validate_person_bridge_child_v3.py` against the real committed v3
  lineage now on `main`: **26 checks, 26 PASS**,
  `summary_sha256: f58503bb276c0610ca15ae5d916b5349e13650ea4e7e4dec35715ea931a847a7` — matches the
  digest the new contract test independently pins.
- `tests/python/draftguru_bridge_v2_contract.py`, `draftguru_child_validation_contract.py`,
  `draftguru_import_gate_contract.py`, `draftguru_child_validation_v3_contract.py` — all PASS.
- Manual wrong-lineage / wrong-artefact checks (dummy, unreachable DSN, so no real connection is
  ever attempted): `--lineage v3` + the v2 child → `REFUSED: child count bridges is 3468, expected
  3470`; `--lineage v2` (default) + the v3 child → `REFUSED: child count bridges is 3470, expected
  3468`; each lineage against its own pinned child passes every file-level check and stops only at
  the connection attempt; `--lineage v4` is rejected immediately by argparse
  (`invalid choice: 'v4' (choose from v2, v3)`).
- No TypeScript is touched by this fix; `npm run typecheck` was not required and was not run.

## Architecture note

A future v4 (or later) lineage remains additive by construction: a new `LINEAGES["v4"]` entry plus a
new `validate_person_bridge_child_v4.py`, never a rewrite of an existing pinned lineage. This is
deliberate — the issue's contract calls for explicit, immutable, enumerated lineages, not a generic
dynamic-trust registry.

## Relationship to other issues

- **AFLDB-ISSUE-224** (2026 debutant player registration and AFL API identity bridge) — the trigger.
  Resolved separately; its own 92+2 reconciliation and registration root cause are unaffected by
  this issue. The v3 evidence artefacts this issue's validator pins were committed as part of
  AFLDB-ISSUE-224's own resolution, not by this fix.
- **AFLDB-ISSUE-236** (`club_seasons` no-match integration test stale fixture) — independent.
  Briefly collided on this same issue number during a separate branch's uncoordinated allocation and
  was renumbered to 236 during the 2026-09-23 AFLDB-ISSUE-224 closure; no relationship beyond that
  numbering collision. Remains open.
