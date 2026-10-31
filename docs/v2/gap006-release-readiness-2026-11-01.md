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
| `keepFormOnSubmit` on four `<form action>` forms (player-link resolve, bulk approve, Brownlow publish, delete match) | Found by the visual journey: a refusal wiped the typed note |
| `sealNote` on the Brownlow eligibility publication audit (review F-001) | The seal judged a generated default note and relied on a later call to refuse |
| Draft-editor seal refusals mapped to `validation` (F-002); empty season declaration fails closed (F-005) | Consistency and a latent silent skip |
| **Correction note separated from the record's own note (F-003, corrected 2026-11-01)** | The coupling was never owner policy. `note` is now only the private audit/correction note; a list entry's own text is `memberNote`, an appointment's is `appointmentNote`. Transfer keeps the moved entry's own note. No schema change |
| Sealed-season integration tests for the separation; F-001 real-PostgreSQL tests; `tools/v2/gap006-note-separation-visual.mts` and its evidence | See below |

`storedNoteText` (the 2000-character cap on a stored copy) now applies to the record's own note only.

## Verification (actual results)

Every database run used a fresh disposable clone of `afldb_v2_rb_final_test` on the recovered cluster (migrations 116 and
117 and privileges applied), through the guarded launcher, which proved the listener (postmaster PID, executable, data
directory), loopback binding, cluster name `afldb_v2_isolated` and the isolation marker before any write.

| Check | Result |
|---|---|
| `tsc --noEmit` | clean after the last code change |
| eslint on every changed file | clean |
| Unit `v2-season-seal`, `admin-club-leadership-actions`, `admin-season-list-actions` | 94/94 |
| Integration, final run: `admin-season-lists`, `admin-club-leadership`, `sealed-editor-guard`, `draft-linkage`, `v2-brownlow-eligibility`, `admin-brownlow` | **6 files, 210 passed** |
| F-001 against real PostgreSQL | Brownlow season publication (`admin-brownlow`) and the eligibility publication (`v2-brownlow-eligibility`) refuse an absent, null or short human note on a sealed season, with revision, status, votes and audit count unchanged; the synthetic fixture seasons are sealed through the registry test seam, which is why an earlier run that did not seal them wrongly published |
| Negative controls | the new F-003 tests failed against the pre-fix query files (9 tests); the F-001 test failed with `sealNote` stopped (2 failed, 45 passed); both restored, file diffs verified |
| `v2-brownlow-production-correction` | **4/8** (cases 1, 6, 7, 8). Cases 2 to 5 cannot run: authentic inputs are not recoverable locally (below) |
| `v2-coleman-publication` | 28/28 from the earlier accepted run; its code and tests are unchanged, so it was not re-run |
| Full unit suite | not re-run: the only source changes since the accepted 11,520-pass run are in the season-list and leadership query and action layers, their panels and tests, all covered by the focused runs above |
| Visual journey, headed Chromium, desktop 1280x800 and mobile 390x844 | 15/15 checks, 0 page errors, 0 external requests, no horizontal overflow |

### What the visual journey proves

Run against a production build served on 127.0.0.1:3912 from the same disposable database; the sealed half uses a
SYNTHETIC registry (2027 sealed in the build copy of `seasons.json` only, restored afterwards), because the real registry
keeps the only administrable season open. Screenshots of that half carry `SYNTHETIC-REGISTRY` in their names.

- A sealed add or appointment with only a long record note is refused; nothing is written; the typed values stay.
- With a record note and a correction note, the entry (or appointment) stores only its own note and the audit row only
  the correction note, bound to the actor; the durable override carries the record note and never the correction text.
- The correction text appears nowhere on the rendered admin list page, the leadership panel, the club's public page
  (HTTP 200) or the mobile page; the leadership panel renders the appointment's own note.
- Evidence: `docs/v2/evidence/gap006-note-separation-visual-20261101/` (6 screenshots and `capture-log.txt`); the first
  attempt stopped on a wrong lookup in the script and is retained unchanged as `...-attempt1-aborted/`. The earlier
  sets `gap006-review-visual-20261101/` and `gap006-editor-visual-20261031/` are untouched and keep their
  SYNTHETIC-REGISTRY labels.

## Independent review

One read-only review of the original mutation coverage (earlier today): no CRIT or HIGH and no sealed-season bypass;
F-001 (MED), F-002, F-003, F-004, F-005, F-006, F-007 as recorded in `known-gaps.md`.

One further read-only review of the final corrective diff (this milestone): no HIGH or MED production defect; every
note path (add, multi-add, transfer, copy-forward, appoint, replace, remove, end, reinstate, void, correct) and the form
field names were traced. Findings and dispositions:

| Finding | Disposition |
|---|---|
| MED: the separation was proved only on open seasons; no integration test showed the seal ignores a long record note | **Fixed.** Sealed-season tests added to `admin-season-lists` and `admin-club-leadership` through the registry seam (record note alone refused with nothing written; both notes stored apart) |
| LOW: transfer dropped the entry's own note | **Fixed.** The moved entry keeps its own note; the test asserts it equals the source's and is not the correction text |
| LOW: two new source-contract assertions depend on LF line endings | **Fixed** for the multi-line reader (CRLF normalised). The other source-contract test in that file reads single-line patterns |
| LOW: rows written by the first design may hold the justification | **Open, not deployed.** Nothing ran against DEV or PRODUCTION. Before any deployment, count rows whose `note` equals a `data_edits.note` for the same entity in `season_list_members`, `club_leadership` and `data_overrides` |

## Incident and recovery (ISSUE-331; cause UNKNOWN)

Facts only; no cause is attributed.

- At about 00:51 local on 2026-11-01 the isolated PostgreSQL root `D:\tmp\afldb-v2-pg16` lost `secrets/`, `download/`,
  `dist/pgsql/share`, `lib`, `pg_ctl` and all but 13 files of `dist/pgsql/bin` while its postmaster was running. The
  data directory and databases were intact. Other processes present at the time included Codex runtime node processes
  (co-occurrence only).
- The running postmaster was re-identified by executable, creation time, listener and data directory, not by the
  recorded PID (22068, started 00:02:46 local, 127.0.0.1:55432). New tests and conflicting operations were stopped.
- Provenance of the recovered distribution: vendor zip
  `https://get.enterprisedb.com/postgresql/postgresql-16.14-1-windows-x64-binaries.zip`, 325,739,757 bytes, sha256
  `98af1417ba6a8dc30543e560e5407833a3b9e7cc7ed20e73b2006f3aa2f04663`, md5 `89eec68262da184db1a4502a3cca2503`. The 13
  surviving binaries in the old tree matched it byte for byte (`postgres.exe` sha256 `c4a68396…90d3`). The installed
  `C:\Program Files\PostgreSQL\16` is a command-line-tools-only 16.15 and was not used for the server.
- The original cluster was shut down with the recovered 16.14 `pg_ctl stop -m fast` (shutdown checkpoint logged, no
  force-kill). Its data directory was copied to a private cold backup (37,151 files, 8.381 GB; D: had about 132 GB free)
  and the manifest sha256 `b32809e80651b10b1c8c1755f2147f3e9d2d0dd722483be7a1ddacd70306b033` is identical for the
  original, the backup and the recovery copy. The original root, the backup and the original data were not modified,
  re-initialised or deleted.
- Credentials: no verified private backup existed, so fresh credentials were established on the recovery copy only
  (single-user mode; no listener, no authentication change, nothing on the original). They live in a restricted-ACL
  directory outside Git and were never printed.
- Identity proof before test writes: loopback only, cluster `afldb_v2_isolated`, no SSL, 30 databases carrying the
  isolation marker, `verify` reported ISOLATED TARGET OK, roles as expected.
- Locations (retained, not in Git): `D:\tmp\afldb-gap006-recovery-20261101\` holding `incident/` (config and log copies
  with a sha256 manifest), `PROVENANCE.txt`, `dist-extract/` (recovered distribution), `cold-backup/`, `root/` (recovery
  copy), logs of every run. The recovery cluster was stopped cleanly at the end of the session.
- Also observed, cause unknown: `D:\afldb-v2-rehearsal-20261020\ext4.vhdx` (frozen on 2026-10-28 at 37,885,050,880
  bytes, mtime 2026-10-25T23:15:52Z, sha256 `589597c5…`) is now 47,045,410,816 bytes with mtime 2026-10-31 20:33:45; it
  was not started or hashed. The WSL distro `AFLDB-V2-BrownlowExport-20261028` is registered but its base directory
  `C:\afldb-v2-brownlow-export-20261028` is absent. Neither store was started, altered or substituted.

## Authentic Brownlow inputs: not recoverable locally

`docs/v2/linux-verification-2026-10-28.md` §10.2 records them as retained on the DEV host (`/home/arm/…`). No copy exists
on this machine (searched; none of the 30 recovery databases has the template shape: all 2025-bearing ones hold 9,522
rows, 8,901 zeros, 9,522 linked, 0 staged, where the template needs unlinked 2025 round votes and 621 staged rows).
Reading the host was outside this task's authority, no frozen or credentials-exposed WSL store was started, and no
unrelated fixture or provider data was substituted. Required identities:

| Artefact | Identity |
|---|---|
| exported dump | sha256 prefix `5be45eab…` (full hash in §10.2) |
| `fixture-root.tar` | `23cc8b76…`, 483 members |
| `acquisition-014218.tar` | `3ed1b46b…`, 4 members |
| retained acquisition | `afl-api-brownlow-2025-2026-10-20-014218` |
| source families | `data/reference/source-families.json` |

Needed to provision a clone of the `afldb_v2_rb_brownlow2025_test` shape and to set
`AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT`. The suite passed 8/8 on 2026-10-28 on those inputs.

## Remaining limitations and gates

1. **Database-level enforcement:** not implemented (owner decision pending; deferred under Option B).
2. **Other writers:** direct library calls, legacy loaders (V2-GAP-011, V2-GAP-013), the AFL Tables settle, ISSUE-316
   tooling and ad hoc SQL bypass the editors.
3. **Deployment:** nothing is deployed. The usual release path applies; `afldb_import` must hold `SELECT` on
   `data_edits` (migration 108 and `privileges.sql` grant it; verify on the target). Run the one-off count for rows
   written by the first design (above) first.
4. **Brownlow production-correction cases 2 to 5:** owner decision to authorise a read-only copy of the artefacts
   above from the DEV host, or to accept the 4/8 limit (ISSUE-331).
5. **Cause of the environment incident:** unknown; establish only with evidence.
6. **Screenshots of the sealed season-list path** use a synthetic registry (labelled), by necessity.
