---
name: afldb-data-integrity-debug
description: Investigate AFLDB statistical correctness, missing or contradictory historical data, provenance, coverage, NULL semantics, Brownlow totals, player identity links, historical club identities, awards, draft, or derived-summary discrepancies. Use when the suspected problem may be data quality rather than application query logic.
---

# AFLDB Data Integrity Debugging

Determine whether a bad answer is caused by stored data, coverage, derived data, identity resolution, or application logic before editing code.

## Guardrails

- Diagnose read-only first.
- Work only in the local working copy.
- Do not run Git commands unless explicitly requested.
- Do not modify `tools/migration/**` or any `*.py` file unless explicitly requested.
- Do not hand-edit authoritative or derived statistical rows as a shortcut.
- Do not treat missing historical observations as zero.
- Do not guess player identity links.

## Establish the source of truth

For the failing statistic, identify:

1. source/provenance table;
2. coverage period and grain;
3. canonical target table or view;
4. derived table, if any;
5. query that exposes it;
6. UI or search path that presents it.

Use the repository documentation before assuming a dataset is complete.

## Preserve AFLDB model rules

### Brownlow

Per-game votes are incomplete historically. Season and career totals must use the authoritative season-level Brownlow source. Never reconstruct complete career totals from incomplete match rows.

### NULL

A missing statistic means not recorded unless the schema/documentation explicitly defines otherwise. Do not use `COALESCE(..., 0)` just to make a result convenient.

### Historical clubs

Renames and relocations may share an organisation, but historical identities remain distinct. Mergers are linked, not silently combined.

### Player identity

A player is identified by stable numeric ID. For honours/source-name rows:

- `unique` and `resolved` are trusted;
- `ambiguous`, `unmatched`, and `implausible` are not trusted links.

Do not automate a human-only resolution merely because a name looks close.

### AFLW

AFLW is served from a separate read-only `aflw` schema/view model. Do not force AFLW behaviour into the core year-keyed model without deliberate design work.

## Diagnose

- Compare counts and values at every grain.
- Check coverage metadata before calling a missing value a defect.
- Check whether the row is authoritative, staged, derived, or presentation-only.
- If a derived summary is wrong but authoritative rows are correct, fix/rebuild the derivation path rather than patching the summary row.
- If the source itself is incomplete, make the limitation visible rather than manufacturing certainty.

## Output

State clearly whether the defect is:

- stored-data corruption;
- expected coverage gap;
- identity-resolution state;
- derivation bug;
- query bug;
- presentation bug;
- undocumented/uncertain provenance.

If remediation requires migration/import Python, stop at the diagnosis and identify the exact file/path that would require explicit approval.
