# V2-GAP-006 (editors, Option E1): release-readiness record, 2026-11-01

Local milestone only. Nothing was pushed, deployed or run against a host, a production database or a provider. No
Brownlow was recorded, backfilled, adopted or published. V2-GAP-006 **stays open**.

## What the candidate does

Every audited admin editor mutation that touches a sealed or unknown season is refused unless it carries a human-written
20-2000 character note; open seasons are unchanged. The refusal rolls the whole transaction back. See
`known-gaps.md` V2-GAP-006 and the `CHANGELOG.md` Unreleased entries for the rule, workflow mapping and coverage.

## Changes since the candidate commit `f2563e01`

| Change | Why |
|---|---|
| `parseCorrectionNote` replaces `optionalText(..., 2000)` for the audit-note field (awards, coaches, draft, records, season-lists, leadership actions) | A crafted 2001-character note was cut to 2000 and accepted as a valid correction |
| `storedNoteText` caps the stored copy of an appointment or list note | Keeps open-season storage identical to before |
| `keepFormOnSubmit` on four `<form action>` forms (player-link resolve, bulk approve, Brownlow publish, delete match) | Found by the visual journey: a refusal wiped the typed note |
| `sealNote` on the Brownlow eligibility publication audit (review F-001) | The seal judged a generated default note and relied on a later call to refuse |
| Draft-editor seal refusals mapped to `validation` (F-002); empty season declaration fails closed (F-005) | Consistency and a latent silent skip |
| Tests, `tools/v2/gap006-review-visual.mts`, evidence under `docs/v2/evidence/` | See below |

## Verification (actual results)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean after the last code change |
| eslint on every changed file | clean (three pre-existing warnings elsewhere in the player-links directory) |
| Unit suite, integration excluded | 11,520 passed, 39 skipped, after the last code change; two source-contract tests re-pointed at the new form marker and re-run (160/160) |
| Action-boundary regressions (`tests/integration/sealed-editor-guard.test.ts`) | 21/21: coach assignment, award winner and draft selection refused with a crafted 2001-character note, canonical rows, overrides and audit unchanged; an open season stores 2000 |
| Negative control | against the pre-fix coach and draft actions the two regressions failed (the crafted note was accepted and written to the disposable database) |
| Editor integration, 17 files, fresh clone | 560 passed, 2 skipped (before the review fixes) |
| After the review fixes | `admin-draft`, `admin-club-leadership`, `admin-brownlow`, `sealed-editor-guard` passed. `admin-season-lists`, `draft-linkage`, `v2-brownlow-eligibility` did not complete: the cluster lost its distribution mid-run (below) |
| `v2-coleman-publication` | **28/28** on `afldb_v2_coleman_final_test` (clone of `afldb_v2_release_schema_test`, migrations 116 and 117 applied) |
| `v2-brownlow-production-correction` | **4/8** on `afldb_v2_brownlow_policy_final_test` (clone of `afldb_v2_rb_final_test`, 116 and 117 applied); the four failures are missing prerequisites, not code (below) |
| Visual journeys, headed Chromium | player-link and season-list journeys pass; desktop 1280x800 and mobile 390x844; no horizontal overflow; 0 external requests; evidence in `docs/v2/evidence/gap006-review-visual-20261101/` and `gap006-editor-visual-20261031/` |

Isolation of every run was proved by the launcher: listener PID, executable and data directory matched the cluster's
`postmaster.pid`, loopback only, cluster name `afldb_v2_isolated`, marked databases only. Retained baselines
(`afldb_v2_rb_final_test`, `afldb_v2_release_schema_test`, `afldb_v2_gap006_test`) were only used as clone templates.

## Independent review (one, read-only)

No CRIT or HIGH and no path where a sealed-season fact write commits without a valid note. Seven findings: F-001 (MED),
F-002, F-003, F-004 (LOW), F-005, F-006, F-007 (INFO). Fixed: F-001, F-002, F-005 and the open-season storage part of
F-003. Accepted with reasons: the F-003 design point, F-004, F-006, F-007 (`known-gaps.md`). The reviewer checked affected
seasons (old and new), reference tables, actor and workflow derivation, same-transaction evidence references, atomic
refusal and preserved permissions, and found those areas clean apart from the items above.

## Gaps in the evidence (exact)

1. **`v2-brownlow-production-correction` cases 2, 3, 4 and 5 not run to a pass.** They need (a) a clone of
   `afldb_v2_rb_brownlow2025_test`, the template holding the authentic 2025 provider snapshot (round-vote rows not yet
   linked to matches; 207 sets, 621 positives, 8,901 legacy zeros), which exists only in the stopped WSL rehearsal stores,
   and (b) `AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT` pointing at the retained acquisition
   `afl-api-brownlow-2025-2026-10-20-014218` and `data/reference/source-families.json`. The clone built from
   `afldb_v2_rb_final_test` fails on `expected exactly 207 sets / 621 positives / 8901 legacy zeros` and
   `Explicit retained snapshot root required`. Obtaining them means starting a WSL store or re-acquiring from the
   provider; this session did not, and substituted nothing. The suite passed 8/8 on 2026-10-28 on a restored dump
   (`linux-verification-2026-10-28.md`).
2. **The isolated cluster's distribution was deleted during the session.** At about 00:50 on 2026-11-01 the directories
   `secrets`, `download` and `dist/pgsql/share`, and most of `dist/pgsql/bin`, disappeared from `D:\tmp\afldb-v2-pg16`
   while its postmaster (PID 22068, started by this session through the guarded launcher) was running. New connections now
   fail (`could not open directory ".../share/timezonesets"`). The cause is not known; this session's commands do not
   delete there (checked) and it did not recreate credentials or rebuild the distribution. The data directory and every
   database in it are untouched on disk; the postmaster was left running. Before any further local database work the owner
   should decide whether to restore the distribution (a PostgreSQL 16 Windows zip) and its credentials the usual way.
3. **Not re-run after the review fixes:** `admin-season-lists`, `draft-linkage`, `v2-brownlow-eligibility` integration
   (cause 2). The code under them changed only by `storedNoteText` (season-lists, leadership), the draft catch mapping and
   `sealNote` on the eligibility publication; the source-pinned unit tests for those pass. No live Brownlow publication
   with a sealed season was exercised for F-001 (it needs the Brownlow template); it is pinned by a source test.
4. **Season-list refusal screenshots use a synthetic registry** (2027 sealed in the build copy of `seasons.json`), because
   the real registry keeps the only administrable season open. They are labelled `SYNTHETIC-REGISTRY`.

## Gates that remain before V2-GAP-006 can close

1. Database-level enforcement: not implemented (owner decision pending; deferred under Option B).
2. Other writers: direct library calls, legacy loaders (V2-GAP-011, V2-GAP-013), the AFL Tables settle, ISSUE-316 tooling
   and ad hoc SQL bypass the editors.
3. Deployment: nothing is deployed. The usual release path applies; `afldb_import` must hold `SELECT` on `data_edits`
   (migration 108 and `privileges.sql` grant it; verify on the target).
4. The two evidence gaps above if the owner wants the Brownlow suite and the three integration files re-proved.
