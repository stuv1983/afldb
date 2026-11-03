# V2-GAP-029 — ordered execution package: hardened and qualified (2026-11-03, revision 3)

**Status: GAP-029 remains OPEN.** Nothing was applied, nothing was run against production's database, nothing was pushed. This revision supersedes
`gap-029-ordered-execution-handoff-2026-11-03.md` (rev 2, left unchanged) wherever they differ; §0 lists every correction.

Authority used: "No push, production mutation, importer dry run on production, deployment, restart, grants, timer change or cleanup" — none occurred. The only production-host
contact in this task was ONE read-only SSH probe of files and versions (`probe-prod-prereqs.out`; no database connection, no credential value read) plus the earlier read-only
role/ACL probe (`probe-actor-roles-prod.out`, 2026-11-03T03:56Z).

## 0. Corrections to rev 2

| Rev 2 said | Corrected |
|---|---|
| §9.2: the quarantined WSL store was started and "I wrote nothing" | **Withdrawn.** `AFLDB-V2-Rehearsal-20261020` was started despite the prohibition and four commands ran in it (`uname`, `node -v`, `python3 -V`, `ls /home`). Starting a distro can write to its disk, so "store unchanged" is not claimed. The vhdx has only file metadata evidence. The **original disappearance cause stays UNKNOWN** and is a separate matter. Recorded as the second breach in ISSUE-331 and `docs/v2/issue331-incident-assessment-2026-11-01.md` §7. No WSL command was run in this task; the store was not booted, mounted, inspected, hashed, exported, copied, unregistered or deleted. |
| §9.4: `afldb_import` cannot read `data_edits` | **Wrong.** Read-only production probe: `afldb_import` has SELECT and INSERT on `public.data_edits` (160 rows seen; ACL via the owner; RLS off; no policies or triggers). It is denied only direct sequence reads (USAGE suffices). No privilege was requested or granted. |
| §6: "or one backup spanning all four" | **Removed.** Each data stage uses its OWN fresh, restore-verified backup. The tools now enforce it (§5). |
| §9.5: S2/S4 backup fields assembled by hand | **Replaced** by machine-assembled, sealed evidence (§4). |
| §9.1: Linux qualification not run | **Run** on streamanator (§2). |

## 1. Environments, and what each result is

Every result below carries the environment that produced it. A Windows result is not a Linux result.

| Label | Environment |
|---|---|
| **WIN** | This Windows workstation, isolated PostgreSQL cluster at 127.0.0.1:55432 (guarded runner). |
| **LINUX** | streamanator, user `arm`, Linux 6.8.0-147, node v22.23.2, Python 3.12.3 + psycopg 3.3.4, PostgreSQL 16.15 client tools, a **fresh** workspace `/mnt/ssd/afldb-v2-gap029h-20261103T044914Z` and fresh isolated cluster on 127.0.0.1:55493. Block L's workspace was only read (copied). DEV services unchanged in every run (afldb.service MainPID 1677, postgresql@16-main.service MainPID 1536). |
| **PROD-RO** | Read-only production probes (above). |
| **QUARANTINE** | `AFLDB-V2-Rehearsal-20261020`: no result is claimed from it, none was sought. |

## 2. Results

| Check | WIN | LINUX |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| Focused GAP-029 + season-seal suites | 233 passed across 7 files | 127 passed (the DB-free subset the qualifier runs) |
| Python DB-free contract | 7/7 consumer checks | 41 checks pass |
| `bridge_import_gate.py` byte-identical (sha256 `fbce43f7…558d`) | yes | yes |
| Four-stage chain S1→S2→S3→S4 on one disposable clone, with negative controls | **30/30** | **30/30** (q1 at 421de2ba; q4 at 96fc69bb) |
| Evidence assembly, S1–S4 happy path | passed on a **synthetic** dump/provenance | passed on the real retained 117-ledger dump with a **test-fixture provenance** (§2.1) |
| Assembler refusals (wrong dump sha, stale, evidence for another dump, for another source, output exists, work dir exists) | 6/6 | 6/6 |
| Assembled S2 expectation equals the chain's own S2 plan expectation (same baseline) | — | **equal** on all four hashes (q4) |
| Affected editor integration + focused regressions | 247/247 | 241 passed, **6 skipped** (247) — the 6 are `tests/draftguru-import.test.ts` cases that need the gitignored DraftGuru snapshot, absent on the host; they ran on WIN only |
| Final corpus: approved-policy conformance | not an acceptance measurement (template lacked the 64 match-event labels) | **PASS**, 0 unapproved differences |
| Final corpus: incorrect known answers | — | **0** |
| Final corpus: strict parity | — | `passed:false`, **118 findings**, not weakened (10,287 cells, 10,209 solved) |
| Corpus report sha256 | — | q1 `76638b52cc2a1a665c3ff762a8e39943356e036bbdc722285bc08e4859be3602`; q2 `6ae3f36b82e2817a3a613f176d47107e0699b5eed6ed72376d889507da995ca6` (summaries identical apart from the sha, which the report derives from its own content) |

The corpus ran on the production-derived clone **after** S1–S4 had been applied to it (dump `afldb_prod-20261102T022308Z`, sha256 `c2d7ad3e1d3df46e9fc03fc7618f5dd256f09ea16ab3d37fd0896ab7b2ece7f9`, 64 match-event labels present).
Clone fingerprints before/after each stage are in `linux-q1-421de2ba/chain/summary.txt`.

### 2.1 Qualification runs, honestly listed

| Run | Revision | Result | Notes |
|---|---|---|---|
| q1 | 421de2ba | PASS | The assembly happy path could not run: the only real provenance is older than 24 h and the assembler correctly refused it (recorded as the result). Corpus measured here. |
| q2 | 7d3fd683 | FAIL (1) | Used a fixture provenance so assembly ran (happy path + 6 refusals PASS; chain 30/30; editor PASS; corpus PASS). The one FAIL was **my qualifier's own S2 comparison**, which compared `JSON.stringify` output (key order). Field by field all four hashes are equal. Not a tool defect. Evidence kept as is. |
| q3 | ad31e791 | FAIL (1) | Same comparison bug, rerun on a single shared dump. Its evidence was not retained (superseded by q4; the comparison failure was proven to be key order, above). |
| q4 | 96fc69bb | **PASS** | Single dump, fixture provenance, comparison fixed (per-key), corpus skipped (measured in q1/q2). |

**Test fixture, not production evidence.** The q2/q4 provenance is a copy of the retained Block L sidecar with only the four capture/ledger timestamps moved to "now − 1 h" and a `TEST_FIXTURE` field added, so the 24 h freshness rule could be exercised. It lives only in the disposable workspace's private `in/` directory and is never an input to a production plan.

Evidence: `docs/v2/evidence/gap029-hardening-20261103/linux-q1-421de2ba/`, `linux-q2/`, `linux-q4/` (summaries, chain log, corpus summary, vitest/tsc logs, DEV before/after; no connection strings). The corpus `report.json` stays on the host (9.8 MB).

## 3. Failure semantics (S2 and S4 especially)

Every apply ends in exactly one outcome, reported with its exit code:

| Outcome | Exit | Meaning | What you do |
|---|---|---|---|
| `NOTHING_WRITTEN` / `COMMITTED_VERIFIED` | 0 | Planned state present and independently re-verified on a separate read-only connection | Proceed |
| `REFUSED_BEFORE_MUTATION` | 1 | A check failed before the first write | Fix input; nothing changed |
| `ROLLED_BACK` | 2 | Failure after writing began and before commit; a fresh read-only probe shows the baseline | Nothing changed; do not retry blindly |
| `COMMITTED_VERIFICATION_FAILED` | 3 | **Committed.** Post-commit verification found a difference | **Not rolled back, not retried.** Owner decision |
| `COMMITTED_VERIFICATION_UNAVAILABLE` | 4 | **Committed.** Verification could not run | Run the read-only `state` mode; owner decision |
| `OUTCOME_UNDETERMINED` | 5 | The probe cannot say | Run `state`; owner decision |

* Never claimed rolled back after commit; never retried automatically; **"RESTORE REQUIRED" never becomes an automatic restore** — a restore discards every write made since the backup and is a separate owner decision.
* **S1 and S3** (TypeScript): the post-write checks run **inside** the mutation transaction and roll it back; post-commit verification is a second, read-only session.
* **S2 and S4** (Python): the unmodified importer and `family_siblings.py` commit in **their own** transaction, so the checks cannot be placed inside it. A read-only probe classifies the database after **every** writer launch, exit 0 included: an applied state is verified; exit 0 with an unchanged/other/unreadable state is `OUTCOME_UNDETERMINED`; non-zero exit with an unchanged state is `ROLLED_BACK`; non-zero exit with an applied state is verified as committed. **Recovery limit, disclosed:** for S2/S4 a failure mid-write will typically present as `OUTCOME_UNDETERMINED` / state OTHER, not a clean `ROLLED_BACK`; the only repair is owner-decided (a restore of that stage's backup, or a reviewed corrective plan). Subprocess timeouts: 1800 s (S2), 900 s (S4).
* Writer stdout/stderr (connection strings/passwords redacted) is kept in `<out>.writer.log` (mode 0600).
* Tests: `tests/gap029-outcome.test.ts` (post-commit failures, structure of the mark sequence, Python contract), `tests/python/gap029_common_contract.py`.

## 4. Machine-generated evidence

`tools/v2/gap029-assemble-restore-evidence.ts` runs **inside** the guarded runner against the restored disposable database:

* `restore-evidence` builds `afldb.gap029.restore-evidence.1` from the capture provenance sidecar and the dump (database identity is proven by query inside the guarded database).
* `assemble --stage S1..S4` runs the stage's own tool in `--rehearsal` against the restored copy and writes a **sealed** `backup.json` (format `afldb.gap029.restore-evidence-assembly.1`: canonical-JSON body + sha256, binding stage, operation, revision, assembledAt, restore target, dump sha256, restore-evidence sha256, tool hashes, and the derived values).
  * S1 `baselineDigest`; S3 `baselineDigest` + `importBatchesBefore`; S2 `baselineDigest` + `draftLinkRestorePlanExpect` (exactly four hashes) + `batchesBefore`; S4 `baselineDigest` + `siblingContentDigest` + `siblingFullRowDigest` + `siblingImportBatchesBefore`.
* Refused: missing, edited (any one field), mismatched dump/source/target/stage/revision, stale (>24 h), tool-hash drift, existing output or work directory. The seal is **tamper-evident, not a signature**; it detects edits and mix-ups, not a determined author with repository access.
* No value is hand-picked. A production plan checks the seal in TS and Python (cross-language fixture test).
* **Per-stage backup enforced:** each plan compares the sealed production `import_batches` count with live production, so a backup taken before another stage committed is refused.

## 5. Actor and roles (PROD-RO)

* Actor for S3: **`auth_users.id` 1** — the owner's existing account. Probe: role `super_admin`, enabled, fully enrolled, viable by the migration-105 predicate, and the **only** Super Admin (counts: admin 2, contributor 1, super_admin 1). `assert_viable_super_admin_actor` is SECURITY DEFINER owned by `afldb_owner`. No actor is created or substituted; apply re-asserts viability and refuses otherwise. **You must still re-check at apply time** that id 1 is the person accountable for the eight entries (the approval wording below pins it).
* `afldb_import` privilege discrepancy resolved read-only (§0). **No grant is needed or requested.**

## 6. The reviewed package: seal inventory and independent review

* `tests/v2-season-seal.test.ts` classifies all four production writers (`gap029-captaincy-additions-production.ts`, `gap029-rookie-selections-production.ts`, `gap029-draft-link-production.py`, `gap029-sibling-pair-production.py`) as governed, checks the ceremony markers, that the shared modules (`gap029-common.ts`, `gap029_common.py`) write nothing, and the byte-identical gate hash. The seal policy and `bridge_import_gate.py` are unmodified.
* **One** independent read-only review at 4b95faec of mutators, evidence binding, orchestration and recovery semantics: **0 CRIT, 0 HIGH, 2 MED, 4 LOW, 4 INFO.** Dispositions (commit 15ae84b3):
  * **M-1** the Python runner trusted writer exit 0 → now a fresh read-only probe after every launch; exit 0 with a non-planned state is `OUTCOME_UNDETERMINED`. **Fixed.**
  * **M-2** per-stage backup was not enforced for S2/S3 → both bind the production `import_batches` count and refuse a backup from before another stage. **Fixed.**
  * **L-1** structure test now checks a `fail(` between `marks.writing()` and `marks.commitNext()` and that `commitNext` is last. **Fixed.** **L-2** cleanup trap precedes cluster start. **Fixed.** **L-3** `TAG` validated. **Fixed.** **L-4** writer logs retained, redacted. **Fixed.**
  * INFO items: one overstated "nothing is typed in" wording corrected; the rest need no change.
* No second review was run.

## 7. Revisions and hashes (full sha256; LF-normalised blobs)

**Tool/test code is frozen at 15ae84b3 and byte-identical through 96fc69bb** (`git diff 15ae84b3 96fc69bb -- tools tests` is empty). Host scripts and evidence changed after that. Commits since rev 2 (all local, none pushed):
005ba487, cd34f8c8, 4b95faec, 15ae84b3, 52f37885, 421de2ba, 7d3fd683, ad31e791, 96fc69bb. **Pin the production-side checkout at the commit the `plan` is generated from (`git rev-parse HEAD`, clean); a plan embeds that revision and apply refuses if HEAD differs.** Documents-only commits after 96fc69bb do not change any hash below.
Qualification revisions: Linux q1 421de2ba, q4 96fc69bb; Windows 15ae84b3.

| File | sha256 |
|---|---|
| tools/v2/gap029-captaincy-additions-production.ts | 0163a5e525fb8abc6e4f1f16ae813ca4da7b72dcd161eae6a2957c9cb8e01b22 |
| tools/v2/gap029-rookie-selections-production.ts | 228a64b922b199c9b9476aa74396074555fe8fef48999f0e6ca58bfd841cf116 |
| tools/v2/gap029-draft-link-production.py | 97aff072b6a9dbe9b9e16f91b30afc573a264c14faf034be4d98fe658825bded |
| tools/v2/gap029-sibling-pair-production.py | 047ea314573ea346b845b81d833da8c96cb72a589b97d1d7cd16c52032209cd6 |
| tools/v2/gap029-common.ts | 9a42b41bbeffa9b73dec9d8b1d34cc164194cc29ed2319e2512dab971522fe55 |
| tools/v2/gap029_common.py | ddefab1e69ca5ed8e02b32d9eead4f3a790a84b7012e345f94092eaff31231e7 |
| tools/v2/gap029-assemble-restore-evidence.ts | bcf23b9ec27e9d6cb701b207fe28bfa6f6dd3510166f2255060f565726c7c75c |
| tools/rebuild/draftguru/bridge_import_gate.py (unmodified) | fbce43f7f1e374b3dfac05968e627b8ad9f337279f233a49bc19ff57d02d558d |
| tools/rebuild/draftguru/import_draftguru.py | f23e76464818e9109f46004812dc65354c280ae1361a9ebe9fef59493d5540e1 |
| tools/migration/family_siblings.py | 6f1ce0597cc833f289b69fa3e065d72a2d03dcba0ec52c7c0c5703ed5a27fd42 |
| data/players/sibling-relationships.csv (artefact) | b1f0ff4ed0bfcf23b53fc8e0007c08ffee636cfd7077b39c3d07aa3b842bd318 |
| scripts/capture-prod-stage.sh (NOT RUN) | 9ab298ed9dbae1b4df521e63c9a66b2e428675e3892e5a1fab2046c97cfe1af2 |
| scripts/restore-assemble-host.sh | fbd40a60ae4d669ed7c8df11d7fed00c91bd9a53df84d47210d447656b976f6e |
| scripts/qualify-host.sh | e4c45216f258edabdfbe17eb7e16566ee84bbced52a12144d6133a2342daa7e3 |
| scripts/chain-inner.sh | ccb1d3c4d5ffceb8497318b491a55adba2c902cd2c750994e202e353da682fad |
| scripts/probe-prod-prereqs.sh | a97d99a93ef4a34ea835c761aa08a67304d8a24de6a836f9e2e90c52be0dee0d |
| scripts/restore.mjs | b1b7fe41353670a6c6f199a4827d5d3c5586bf67b018b7e0377007b8d22ef66c |
| scripts/probe-dbs.mjs | de732a9e77f5fc9935f2852376b33c53a8b15d5a88bd3cdadeb239894d22f0f9 |
| scripts/fingerprint.mjs | 9632762a80acd33c59e5c0f8fe1543497d2ca0efe13fb6fadfad11d2c5c6efb0 |
| scripts/corpus-summary.mjs | 113ff06363db7b8aa69850c88be1eb09266273c0914e66ed985c0bcd0c582285 |
| scripts/probe-actor-roles-prod.sh | d9d4e375126552cf96b71f21f70260e4c3266f1e090352b2734cc5605dbc4e0b |
| probe-actor-roles-prod.out | 87aaf534e89c6e660e9003eb25b2a8471372ee51b0c4dce870619efaee22894a |

(scripts/ and the two .out files are under `docs/v2/evidence/gap029-hardening-20261103/`.)
Other pinned inputs (unchanged from rev 2): S2 parent sha256 `1f7413a2ad96e7d026cc521acfdeba3de9cab7066794de99002c9b5928e6e21b`, label `annual-html-20260826`; S3 evidence `d1740b8f65429aa32bea8b93a1f63d302674eb79bbc6e7195153d315310e6b6f`; S4 expected after-content digest `d6fceb338d5f37e8fdef18443da696c52225db9caa80cedb9261e401aea212ec`; Webster files per rev 2 §8.

## 8. Production facts (PROD-RO) and one caveat

* `afldb_prod`: system identifier 7674454702926115004, database OID 66668, **ledger 118** (`118_fixtures_unconfirmed_participants.sql`).
* **Ledger caveat:** the retained Block L dumps are at ledger **117**; production is at 118. The host scripts take `LEDGER_PREFIX` (default `118_`; `117_` for those retained dumps). A fresh production backup restores to 118, which the scripts expect by default.
* Production checkout: `/home/arm/projects/afldb` at `d00e07e3…`, clean, node v22.23.2, `node_modules` present (tsx and postgres), `/home/arm/projects/afldb/.venv` python 3.12.3 with psycopg 3.3.4, `/usr/bin/python3` has **no** psycopg, `AFLDB_BACKUP_DATABASE_URL` and `AFLDB_IMPORT_DATABASE_URL` present once each, 51 GB free, `/home/arm/backups/afldb` exists. The serving checkout must **not** be moved to the execution revision; use a private pinned ops checkout as Block L did (below).

## 9. Exact approvals needed — production PREPARATION (per stage; a fresh backup each time)

I have **not** run any of this. Each item below needs your explicit approval. For stage X in S1, S2, S3, S4, in order, each only after the previous stage is applied and accepted:

**P1-X — fresh restore-verified backup (read-only on production).**
"Run `docs/v2/evidence/gap029-hardening-20261103/scripts/capture-prod-stage.sh X` on `afldb-prod` as `arm`, streamed over one SSH connection, to take ONE new full custom-format `pg_dump` of `afldb_prod` as `afldb_backup` (read-only), into ONE new mode-700 directory `/home/arm/backups/afldb/gap029-X-<stamp>`. No other production-host write, no service, timer, privilege or application action." Stops (no capture) if any writer/settle process or timer window conflicts, ledger is not 118, or identity differs. Derived from the reviewed Block L capture script (`gap029-block-l-20261102/scripts/backup-prod.sh`) by asserted substitutions only — its header lists them and `diff` against that file reproduces them; it records but does not assert a remembered ledger digest (the Block L value was for ledger 117).

**P2-X — private transfer + restore + assembly on streamanator (outside production).**
"Copy that dump, its `provenance.json` and `SHA256SUMS` to a new mode-700 workspace on streamanator, and run `restore-assemble-host.sh` with `STAGE=X`, `DUMP_SHA` from the captured sha, `PROVENANCE`, `PROD_TARGET` (the production `target.json`), a new `TAG`, and — for S2 — `LABEL=annual-html-20260826`. Output: the sealed `backup.json`, `restore-evidence.json`, `restore-target.json`." This touches neither production nor the DEV database or services.
*Constraints the tools enforce:* the production-target file must be byte-identical to the one given to that stage's `plan --target`, and its `user` must equal the read-DSN user (`afldb_backup`, as in Block L); for S2, `--child` must be the child exported against that restore with the sha recorded in the sealed evidence.

**P3-X — plan on production (read-only).** "Generate the stage's digest-sealed plan against `afldb_prod` from a private pinned ops checkout, using the sealed `backup.json`." Exact command forms (from the tool headers):
* S1 `node --import tsx --conditions=react-server tools/v2/gap029-captaincy-additions-production.ts plan --target T --backup B --backup-file F --restore-evidence R --out O`
* S3 `… tools/v2/gap029-rookie-selections-production.ts plan --target T --actor-user-id 1 --backup B --backup-file F --restore-evidence R --out O`
* S2 `python tools/v2/gap029-draft-link-production.py plan --target T --child C --child-sha256 H --label annual-html-20260826 --backup B --backup-file F --restore-evidence R --out O` (no production dry run)
* S4 `python tools/v2/gap029-sibling-pair-production.py plan --target T --expect-after-content-digest d6fceb33…12ec --backup B --backup-file F --restore-evidence R --out O`
Read DSN `AFLDB_GAP029_DSN` (the backup role); write DSN `AFLDB_GAP029_WRITE_DSN` (the import role) is needed only at apply and must name the same target. **Open item:** the Block L production-side runner (`prod-ops.sh`: private pinned ops checkout with a linked read-only `node_modules`, credential parsing into environment variables only) has not been re-derived for GAP-029; the `plan` commands above are the exact tool calls but their wrapper is not yet written or reviewed. I recommend that as the first task of the next session; I did not write an unreviewed production-side runner.

## 10. Exact approvals needed — APPLY (one per stage, after you have read that stage's plan)

Each uses the plan's sealed digest, a clean HEAD equal to the plan revision, the stage's own backup (<24 h) and its sealed evidence. **No production dry run.** After each: `state`, the stage's verification, `ANALYZE`, then stop for your acceptance before the next stage.

* **D1-PROD (S1).** "Apply, once, to `afldb_prod` (OID 66668, system identifier 7674454702926115004) the digest-pinned plan `<digest>`: exactly the seven co-captain rows in rev 2 §3, at revision `<plan revision>`, after this stage's fresh verified backup `<sha256>`. Nothing else."
* **D2-PROD (S2).** "Apply, once, to `afldb_prod` the link-only DraftGuru promotion through `gap029-draft-link-production.py`, plan digest `<digest>`, child sha256 `<H>`, label `annual-html-20260826`, parent `1f7413a2…e21b`, importer `f23e7646…40e1`, gate `fbce43f7…558d`, expecting the four after-state hashes equal to this restore's plan. I accept that the importer commits in its own transaction, that a failure mid-write may be reported as `OUTCOME_UNDETERMINED`, and that recovery is an owner-decided restore. Nothing else."
* **D3-PROD (S3).** "Apply, once, the digest-pinned plan `<digest>`: exactly the eight manual rookie selections (rev 2 §6 list, with Rischitelli and Gibbs pick numbers marked secondary-sourced) through the audited editor path **as actor `auth_users.id 1`**, my active, fully enrolled Super Admin, at revision `<…>`, after this stage's fresh verified backup. Nothing else."
* **D4-PROD (S4).** "Apply, once, the digest-pinned plan adding exactly `siblings:afldb-sibling-supplement:015` (Jeremy McGovern 6937 / Mitch McGovern 9714) through `family_siblings.py load`, artefact `b1f0ff4e…d318`, loader `6f1ce059…fd42`, expecting content digest `d6fceb33…12ec`, zero changed, zero stale. I accept the same S2/S4 recovery limit. Nothing else."
* **D5-PROD (S5).** unchanged from rev 2: include the Webster eligibility file and the `D-GAP029-D4W` entry in the pushed revision; no database effect. (Pushing is not authorised in this task.)

## 11. Remaining limitations (not hidden)

1. **Linux assembly was exercised on a test-fixture provenance** (§2.1). The real-evidence happy path on a **fresh production backup** has never run anywhere; it is exactly what P1/P2 produce.
2. **No GAP-029 production-side wrapper** (§9 open item). `capture-prod-stage.sh` is derived from reviewed code but **never run**.
3. **6 DraftGuru snapshot-dependent tests ran on WIN only** (snapshot absent on the host).
4. **Windows chain 30/30 and Linux chain 30/30 both ran on clones of the retained dumps**, not on a fresh production dump; production's current 118-ledger content has been measured only through the read-only probes above.
5. **S2/S4 recovery limit** (§3) is inherent to the unmodified writers and cannot be removed without changing them.
6. **Evidence strength** unchanged: Rischitelli and Gibbs pick numbers are secondary-sourced.
7. **Strict parity stays failing** (118 findings) and the corpus test file exits 1 in diagnostic mode — the accepted state, deliberately not weakened.
8. **The seal is tamper-evident, not a signature** (§4).
9. No DEV/PROD page smoke is claimed (ISR, not measured).

GAP-029 is **open until production application and your acceptance.**
