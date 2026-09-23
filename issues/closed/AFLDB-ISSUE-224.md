# AFLDB-ISSUE-224 — Runbook (RESOLVED)

**DraftGuru/AFL API persons whose AFL Tables identity was not registered on the target
(`target_not_registered`): post-baseline (2026) debutants and numbering/spelling cases could not
link until the identity was registered.**

- **Status:** RESOLVED — 2026-09-23.
- **Opened:** 2026-09-18, deferred from `AFLDB-ISSUE-222` Phase F.
- **Severity:** Medium. **Area:** Player registration / import — `external_identities`, fitzRoy
  core, current-season settle, the DraftGuru and AFL API identity bridges.
- **Branch:** `sonnet/issue-224-final` (clean reconstruction on `main`, `8e9d7172`). Superseded
  working history on `sonnet/issue-224` and `sonnet/issue-224-s9-unblock` (neither merged).

---

## 1. Problem

The v2 DraftGuru source-evidence parent admitted 3,562 `(player_url, afltables_external_id)`
pairs; the `afldb_test` deployment child accepted 3,468 and withheld 94 as `target_not_registered`
because the identity had zero registrations in `external_identities`. Separately, the AFL API S9
provider bridge (snapshot `afl-api-2026-2026-09-21-…`) measured 577 providers linked and 92
unresolved against the same underlying gap.

**Root cause (established 2026-09-19, ISSUE-222 D4):** the accepted fitzRoy baseline ends at the
2025 season (`max(player_career_stats.debut_season) = 2025`) while canonical `matches` already
carries the 2026 season (`max(matches.season) = 2026`). A 2026 debutant therefore has no `players`
row and no AFL Tables identity to bridge to — not an encoding or bridge-computation defect.

Two populations shared this one cause and were tracked together, kept conceptually distinct:
- **Population A** — the original 94 DraftGuru-admissible `target_not_registered` persons (16
  sampled, all operator verdict `agree`).
- **Population B** — the AFL API S9 affected population, 92 unresolved providers.

## 2. Fix

| Component | File | Commit (source branch) |
|---|---|---|
| Transaction-scoped debutant registration | `tools/rebuild/draftguru/register_issue224_s9_players.ts` (new) | `e9f829d1`, `517f058b`, `3e3a0532`, `c20c3ae9`, `2e8965a8` |
| `admin-draft.ts` query support | `src/db/queries/admin-draft.ts` | `e9f829d1` |
| Deterministic override-merge on replay | `tools/migration/common.py` | `53fab155` |
| Identity override stays in step with a name edit | `src/db/queries/data-edits.ts`, `src/db/queries/player-identity.ts` (new) | `22c1d195` |
| Evidence/tooling (v3 bridge parent, D7 decision, S9 target set) | `data/reference/draftguru-person-bridge-20260918-v3*.json`, `tools/rebuild/draftguru/build_issue224_d7_decision.py`, `build_issue224_s9_target_set.py`, `build_person_bridge_v3_issue224.py` | `81fd2bb7` |

**Registration tool.** `register_issue224_s9_players.ts` registers each debutant as a canonical
`players` row inside one transaction: `--target test|dev`, gated behind an explicit DEV
import-role preflight (`AFLDB_DEV_IMPORT_DATABASE_URL`, never the application/owner DSN), proving
its own write postcondition transaction-locally rather than via a separate SELECT, and refusing any
given-name/surname split it cannot resolve unambiguously rather than guessing.

**Replay/override consistency.** Two supporting fixes were required, not optional, because the
first registration pass split two names the wrong way (Alex Van Wyk, Hussien El Achkar) and a
straight re-run would have reproduced the same split from the durable `manual_admin_edit`
creation record on any future rebuild:
- `tools/migration/common.py` (`53fab155`) — replay now merges player overrides deterministically.
- `src/db/queries/data-edits.ts` / `player-identity.ts` (`22c1d195`) — a later sanctioned name edit
  now synchronizes the active `manual_admin_edit` identity override payload in the same
  transaction and records its own audit entry, so a rebuild replays the corrected name.

## 3. Validation (2026-09-23, live read-only `afldb_dev`, `role = afldb_owner`, `transaction_read_only = on`)

```text
92 / 92 target players present
92 / 92 with current-season (2026) player_match_stats
830 current rows across that population
0 duplicate player/match pairs

Alex Van Wyk       player_id 13382   given_name Alex       surname Van Wyk
Hussien El Achkar   player_id 13422   given_name Hussien    surname El Achkar
  each: CD_I… external identity, unique

AFL API provider bridge:
  expected providers 669
  persisted providers 669
  linked 669
  unresolved 0
  contradictory 0
```

This live verification independently established acceptance and was **not re-run** for this
closure — the operator directed reuse of this already-established evidence rather than a repeat
DEV mutation/verification cycle.

**827 → 830.** The D-8 step-2 proof-time census independently measured 827 current
`player_match_stats` rows for this population. The 2026-09-23 live verification above found 830.
Both measurements agree on full 92/92 coverage and 0 duplicate player/match pairs; the increase is
consistent with current-season settling that occurred between the two measurements. Exact
row-level attribution of the additional three rows was not established and is not asserted here.

## 4. Reconstruction provenance

This branch (`sonnet/issue-224-final`) is a clean reconstruction on top of `main` at `8e9d7172`,
not a merge of the historical working branches. Source commits, classified:

- **Required — implementation/evidence, reconstructed here:** `81fd2bb7`, `e9f829d1`, `517f058b`,
  `3e3a0532`, `c20c3ae9`, `53fab155`, `22c1d195`, `2e8965a8`.
- **Documentation/evidence references only (not blindly replayed):** `328bc1b2`, `c2a7429c`,
  `0549a637`, and the ISSUE-224 portions of `3de4eef9`.
- **Explicitly excluded:**
  - `f3b09f50` / `6eae820c` / `2af704fe` — duplicate ISSUE-228 work, already on `main`
    independently as `3c470b23` / `38b78791` / `8e9d7172`.
  - `e0b6adc8` (PhanesLight framework removal) — unrelated to ISSUE-224 scope; not on `main`;
    not carried here.
  - Both historical `issues/open/AFLDB-ISSUE-227.md` files — one is the DraftGuru lineage issue's
    own runbook (belongs to `sonnet/issue-227`), the other is this issue's mislabelled club_seasons
    material (renumbered to ISSUE-236, recorded fresh in `issues.md`, not carried as a file).
  - `a073c3f5`'s evidence files, superseded by `81fd2bb7`'s. Compared byte-for-byte: 8 of 10
    overlapping evidence files were identical; the remaining 2
    (`bridge-operator-verdicts-issue224-20260919-v1.json`,
    `issue224-population-classification-20260919.json`) differed only in line endings (CRLF in
    `a073c3f5`, predating this issue's `.gitattributes` LF-forcing rule, vs. LF in `81fd2bb7`) —
    confirmed with `diff --strip-trailing-cr`, not assumed. `81fd2bb7`'s LF copies were used.

## 5. Follow-up, tracked separately

- **`AFLDB-ISSUE-227`** — DraftGuru bridge lineage/gate tooling has no CLI override for a later
  corrected parent. Independent, non-blocking. Implementation on `sonnet/issue-227`, unmerged.
- **`AFLDB-ISSUE-236`** — `tests/integration/data-editor.test.ts`'s AFLDB-ISSUE-015 guard test has
  a stale fixture precondition. Independent, non-blocking, test infrastructure only.
- **`AFLDB-ISSUE-228` S9** — depended on this issue's population-B registration; that dependency
  is resolved.

Neither follow-up issue's implementation is included on this branch.
