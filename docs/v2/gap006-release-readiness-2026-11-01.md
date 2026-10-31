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
| `v2-brownlow-production-correction` | **8/8, 0 failed, 0 skipped** on the final candidate (HEAD `23eb5fa9`), run 2026-11-01 on the retained authentic inputs (section "Authentic Brownlow inputs"). This is a separate, later run from the earlier **4/8** (cases 1, 6, 7, 8 only; cases 2 to 5 could not execute then, and two earlier attempts could not run). Per-case time 46 s to 207 s, 995 s in total. Machine-readable: `docs/v2/evidence/gap006-brownlow-cases-20261101/results-8of8.json` |
| `v2-coleman-publication` | 28/28 from the earlier accepted run. **Correction (2026-11-01):** the earlier claim "code and tests unchanged, so not re-run" was wrong: `src/db/queries/coleman-award-winners.ts` changed (it now names its workflow to the seal). It was run on Linux against the candidate: 28/28 (`docs/v2/evidence/gap006-linux-qualification-20261101/`) |
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
| LOW: rows written by the first design may hold the justification | **Scoped and closed as a local matter; no deployment gate.** Nothing ran against DEV or PRODUCTION, so no production remediation or pre-deployment count is required by this finding. A read-only census of the local disposable clones is recorded in "Note-exposure census (local)" below |

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

## Authentic Brownlow inputs: retrieved read-only from the DEV host and verified (2026-11-01)

Owner authorisation (this task): a narrowly scoped read-only retrieval of the retained artefacts from the documented DEV
host; no production connection, and no database connection, service operation, new export, WSL start or provider
acquisition on the host. Evidence: `docs/v2/evidence/gap006-brownlow-cases-20261101/`.

**Source identity.** Host `streamanator` (10.0.40.100), user `arm`, Ubuntu 24.04.5 LTS, kernel 6.8.0-147-generic; this
matches `docs/v2/linux-verification-2026-10-28.md` section 1. Reached with the DEV key, never the production alias.
Only `ls`, `cat`, `stat`, `sha256sum` and `scp` ran, against `/home/arm/afldb-v2-brownlowverify-20261028/xfer` and
`.../evidence`. Local copies live under `D:\tmp\afldb-gap006-brownlow-artifacts-20261101\` (restricted ACL, outside Git,
contents never printed).

| Artefact | Full sha256 (host `SHA256SUMS` = host recomputation = local recomputation after transfer) | Check |
|---|---|---|
| `afldb_v2_rb_brownlow2025_test.dump` (29,920,966 B) | `5be45eab11549a206f3a8c444f0e4481c807e4f30f3145c851d9e7847623ba4b` | 1,640 TOC entries, as recorded |
| `fixture-root.tar` (15,994,880 B) | `23cc8b76bbab21897aa9fcbd41573bd77166ad82ce53d3e36dbfc3130f37ce23` | 483 members, as recorded |
| `acquisition-014218.tar` (440,320 B) | `3ed1b46b16673ea1dcff0fdfba253243fd10d1cf54029523a45b91de453aa3b1` | 4 members, as recorded |

Archive member paths were validated before extraction (no absolute path, `..`, backslash, drive letter or link), and
each archive was extracted into its own new directory.

**Binding limitations, stated plainly.**

- The earlier local records kept only 8-hex prefixes. The full hashes above come from the host's own `SHA256SUMS`
  (written at export, 2026-10-28 14:44 +1100) and were re-computed on the host and locally. Each starts with the
  recorded prefix, and sizes and timestamps fit the record, but a prefix is 32 bits per file and the full hashes were
  never recorded independently. This is **consistency with the record, not a proven historical full-hash match**.
- Content-level corroboration is stronger than the prefixes: the restored template reproduced every recorded identity
  figure and md5 prefix (ledger 115; `brownlow_round_votes` 330,383 `097a9f86…`; `brownlow_season_votes` 16,120
  `252aa832…`; staged `afl_api_brownlow_vote` 621 for 2025 `48fc8ff0…`; 13,365 players; 17,056 matches), and the host's
  `template-identity.txt` is byte-identical to the restored identity.
- The chain back to the original frozen rehearsal store cannot be re-verified from this machine: the dump was exported
  from a copy of that store, and the store's vhdx has since changed (ISSUE-331). Nothing here asserts the current state
  of that store.
- The fixture root's `source-families.json` and `afl-api-identities.json` are the retained 2026-10-20 copies; they were
  not compared with the current tree (the suite passed with them, as it did on 2026-10-28).

**Provisioning.** Guarded recovery cluster only: recovered 16.14 distribution; listener re-identified by executable and
data directory; loopback 127.0.0.1:55432; cluster `afldb_v2_isolated`; isolation marker verified before every write;
no `.env`; no credential-exposure marker. Template `afldb_v2_rb_brownlow2025_test` was restored with
`pg_restore --exit-on-error` using the TOC list that excludes only the `pg_trgm` and `unaccent` extension entries (4
entries, as on the host). The clone `afldb_v2_brownlow_policy_final_test` (the earlier 4/8 clone) was dropped through the
guard, re-created from the template, and had migrations 116 and 117 applied through the normal runner, then privileges.
The test file is byte-identical to the host's accepted attempt 4 (blob `0083f421`, sha256 `b44b6d95…`). The run set
`AFLDB_BROWNLOW_REHEARSAL_SOURCE_ROOT` to the extracted `fixture-root`.

**Result.** `tests/integration/v2-brownlow-production-correction.test.ts` on HEAD `23eb5fa9`: **8 passed, 0 failed,
0 skipped**, vitest exit 0, stderr holds only the launcher banner. This is a new full run: it is not the earlier 4/8 and
does not reuse the 2026-10-28 host result. The approvals inside the suite are its own SYNTHETIC ones; no real Brownlow
was recorded, backfilled, adopted or published, and nothing touched DEV or PRODUCTION.

**Operational note.** A background-task stop hard-killed the freshly started recovery server once during setup. It was
restarted, completed crash recovery, and every later check (database list, template restore, the suite) ran after
that. The original cluster root and the cold backup were not touched. The cluster was stopped cleanly at the end.

## Note-exposure census (local)

Scope is set by where the first design (record notes coupled to the correction text) actually ran. The retained logs
show it ran only on disposable local clones of `afldb_v2_rb_final_test` on the isolated cluster: `afldb_v2_gap006_test`
(all 2026-10-31 integration and visual runs) and `afldb_v2_gap006b_test` (the review visual journey). `gap006d` also
ran the pre-fix query files once as a deliberate negative control; `gap006c` has no retained log. Clones `gap006e` and
`gap006h` were dropped earlier and cannot be counted. **Nothing was deployed to DEV or PRODUCTION, and no production
census or remediation is required or claimed.**

A read-only census (`census.sql`, `default_transaction_read_only=on`, counts only) over the seven surviving
`afldb_v2_gap006*_test` clones:

| Clone | Record-note rows (list / leadership / override) | Equal to a `data_edits.note` for the same entity |
|---|---|---|
| `gap006b` | 2 / 0 / 2 | **2 / 0 / 2** |
| `gap006g` (corrected design, note-separation visual) | 2 / 1 / 3 | 0 / 0 / 0 |
| `gap006`, `gap006c`, `gap006d`, `gap006f`, `gap006i` | 0 / 0 / 0 | 0 / 0 / 0 |

The only matches are two synthetic list entries in `gap006b`, written by the first-design review visual journey, whose
evidence text was typed once and, in that design, stored in both places. **Matching record and audit text alone does
not establish that this candidate caused exposure**; here it is consistent with the known first-design coupling on a
labelled synthetic journey, and the corrected design's journey (`gap006g`) shows no matches. These rows are test data in
a disposable database that is never published. Disposition: **no action required, no deployment gate, no remediation
SQL.** The clones may be dropped through the guard when no longer needed as evidence.

## Linux qualification and release package (2026-11-01)

Candidate bound as `fd48ace0` (tree `01b3e685`): after the tested `23eb5fa9` the only changes are documentation, evidence and one test-only fixture fix. Qualified on streamanator in a new disposable workspace with a guarded isolated cluster (loopback 55481): core editor/publication integration 653 passed / 0 failed / 5 skipped; import/settle-coupled 315/315; Coleman 28/28; unit suites 11,528 passed / 0 failed; release-route suite 33/33; `tsc --noEmit` exit 0; production-mode build exit 0 (3 min 16 s, peak RSS 1.59 GB) and boot smoke clean. The Linux pass found one real fixture defect (an admin-created 2026 draft selection in `draftguru-import` now needs a correction note because 2026 is sealed), fixed in the test only. Evidence: `docs/v2/evidence/gap006-linux-qualification-20261101/`. The release package is `docs/v2/gap006-editor-protections-release-package.md`. Nothing has been pushed or deployed.

## Remaining limitations and gates

1. **Database-level enforcement:** not implemented (owner decision pending; deferred under Option B).
2. **Other writers:** direct library calls, legacy loaders (V2-GAP-011, V2-GAP-013), the AFL Tables settle, ISSUE-316
   tooling and ad hoc SQL bypass the editors.
3. **Deployment:** nothing is deployed. The usual release path applies; `afldb_import` must hold `SELECT` on
   `data_edits` (migration 108 and `privileges.sql` grant it; verify on the target). The earlier proposed one-off count
   of production note rows is **withdrawn**: the first design never reached DEV or PRODUCTION.
4. **Brownlow production-correction cases:** all eight pass locally (this record). This is isolated-test evidence only;
   it grants no authority for any real Brownlow recording, backfill, adoption or publication.
5. **ISSUE-331 stays open:** the unexplained disappearance of the isolated root's files, the frozen `ext4.vhdx` drift
   (47,045,410,816 B, mtime 2026-10-31 20:33:45) and the absent WSL export base. No cause is attributed. Those stores
   were not started, modified or re-pinned.
6. **Screenshots of the sealed season-list path** use a synthetic registry (labelled), by necessity.
