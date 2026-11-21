# PLAN: backlog run 22 Nov 2026 (b), owner decisions 3-7 of 2026-11-22
DOC: plan for the orchestrator run on branch claude/backlog-20261122 (worktree D:\dev\afldb-backlog-20261122), base origin/main 7d92042f.
DOC: authority = owner message 2026-11-22 (items 3-7); CLAUDE.md sections 1-14 govern; shell/Git/streamanator authorised for this task.

## 0. Boundaries (binding on every step and every spawn)
- Local commits only on `claude/backlog-20261122`; no push; no AI/Co-Authored-By trailers (owner rule).
- No production contact (no SSH/HTTP to `afldb` / 209.38.87.252). Production facts only from `R0-SITTING-20261122.md`.
- streamanator via `ssh -o BatchMode=yes -i ~/.ssh/afldb_dev arm@10.0.40.100`; new workspaces `/mnt/ssd/afldb-backlog-20261122b-*`
  only; never `fuser -k 3100`; never touch the DEV service/.env/deployment, `D:\dev\afldb-backlog-20261121`, ISSUE-371/372 records,
  or the preserved paths (owner list + OWNER-PACKET section 4). The R0 dump may be READ/copied from
  `/mnt/ssd/afldb-post7r3-20261121T155248Z/`. No `wsl`; never `D:\tmp\afldb-v2-pg16`, `D:\afldb-retained\*`.
- Delete nothing outside my own new workspaces' scratch; no workspace deletion at all (item 7 is a report).

## 1. Steps

### S1. ISSUE-363: S + P-full (worker, parallel with S2)
1. Tracked, opt-in tier-P tool (new file under `tools/v2/`, e.g. `rebuild-tier-p.ts`), productising the 21 Nov prototype
   (`docs/v2/evidence/issue363-20261121/host-scripts/overlay-rekey.mjs`, `overlay-rookie-rekeyed.mts`, `overlay-rookie-prep.mjs`):
   - refuses any target not on an isolated cluster and not named `afldb_v2_rb_*_overlay_test` (never the template, never shared `afldb_test`);
   - labels: rekeys tracked `docs/v2/evidence/gap-029-match-event-correction-2026-11-01-r2.json` by natural key (season, date, round,
     clubs, scores), exactly-one-match or refuse, then runs the existing audited applier `tools/v2/apply-gap029-match-events.ts --apply`
     UNCHANGED on the rekeyed file;
   - Rookie selections: the 8 rows of `data/players/rookie-relisting-outcomes.csv` via the existing `buildEntries`, player resolved by AFL
     Tables profile (exactly one), written through the existing audited `createManualPickInTransaction` in one transaction after
     `assert_viable_super_admin_actor`, with a clone-local actor created only in the disposable copy;
   - writes a report: rekeyed evidence sha256, applier report sha256, content fingerprint (`fp.sql` method).
   Tier S (`rebuild-test.ts`, 30 stages / 91 checks / digest `d8397aab…`) is NOT changed.
2. Unit tests for the rekey and the refusals in the closest existing suite (search first).
3. Tier-S declared-dependency lines: G-a and G-b recorded as "requires tier P" in `docs/v2/isolated-rebuild.md` (documentation; no test skipped).
4. Verification on streamanator (fresh copies of the accepted rebuild dump `d8397aab…` + bridge child v3 `1200e702…`):
   tier P built twice from the same tier-S template (run 1, run 2): rekeyed evidence sha, applier result and content fingerprint equal;
   Gridley suites on each: G-a pass, G-b pass (0 unapproved), G-c measured (expected 118 = 78 unsupported + 40 criterion disagreement,
   equal to the snapshot). Default rebuild untouched.
5. Trackers: new Low issue for G-c (next free ID by targeted search), cross-ref ISSUE-118, with the 118 measured failures; ISSUE-363
   resolved per its own recorded criterion ("on tier P, once the opt-in tooling is implemented and verified" + G-c disposition) if S1.4 passes.

### S2. ISSUE-348: F-348-1 source check + re-baseline (orchestrator)
1. Per-label reviewed acquisition pin (contract): keep `annual-html-20260826` verification exactly as now (CSV-oracle parity,
   6,810/5,057) for the callers that use it (rebuild-test default label, bridge tools, gap029 S2 label, tests); add a reviewed pin for
   `annual-html-20261122`: 42 per-page sha256 (from `raw-pages.sha256`), robots sha, 6,845 rows / 5,088 persons, corpus counts, a parsed-row
   digest, and the owner authority (F-348-1, 2026-11-22). For the pinned label the acquisition's source check = every raw page's sha256 and the
   parsed-row digest equal the pin (any byte difference refuses); CSV-oracle parity is not run for it. Implemented in
   `legacy/offline/tools/rebuild/draftguru/acquire_draft.py` / `parse_draft_snapshot.py` (`validate_identity`, parity) and consumed by
   `import_draftguru.py` (`EXPECTED_ROWS/PERSONS` become per-label; `parity_baseline` updated to the new acquisition with the 20260826 values
   preserved under its label).
2. Constants verified by search, each moved only if its caller loads the new label: `import_draftguru.py` EXPECTED_ROWS/PERSONS,
   `draftguru-contract.json` parity baseline, `DRAFTGURU_EXPECTED` (`tools/db/rebuild-test.ts`, keyed by label so the default rebuild keeps
   6,810), `EXPECT_STAGE_A_EVENTS` (`build_person_bridge_v2.py`, reads the 20260826 rows file), `afldb_test_draft_linkage_checks.sql`,
   `data/reference/draftguru-event-kinds.json`. Each decision recorded with its caller.
3. Seal the manifest `docs/rebuild-manifests/draftguru/annual-html-20261122.json` from the existing raw pages on streamanator (no re-fetch of
   pages) with the updated tool.
4. Tests (extend `tests/draftguru-acquisition.test.ts` / `tests/draftguru-import.test.ts` / python contracts as appropriate): the pinned new
   input passes; an altered raw page and an altered parsed row are refused; the 20260826 path still passes with its CSV parity.
5. Isolated cluster in a new workspace: restore the R0 dump (sha `26db4761…5d8b`); genuine `import_draftguru.py --dry-run --guard-report`
   with `--label annual-html-20261122` and the production-equivalent `--bridge` (resolve which child; the production S2 child is
   `d6251609…` on production only: find a byte-equal copy or regenerate deterministically; else record the gap).
6. Reconciliation file: `acknowledged_protected_rewrites` (35), `acknowledged_protected_person_rewrites` (35), `origin_review` (the 191:
   187 classified + 233/378/635/859), `owner_rulings` 5961/6784/6626 `accept_incoming` gated on byte-equality with the owner CSV
   (reference `SHA256SUMS.owner-csv` `c495599b…`), `effect_digest`. Guarded dry run with `--reconciliation` passes.
7. Disposable rehearsal of the real (non-dry-run) load on a fresh isolated R0 restore: before/after whole-table diff of `draft_picks`,
   `draft_persons`, `external_identities(draftguru)`, `data_edits`, `data_overrides`, `import_batches`; link-state comparison for every
   person and pick (no link may be lost; the 35 D-336-2 picks / 31 persons survive); repeat once for determinism (same effect digest).
8. Sealed plan `docs/v2/evidence/backlog-20261121/issue348-acquisition/SEALED-PLAN.md`: digests (manifest, raw pages, reconciliation,
   guard report, effect digest, tool revision), effect summary, preconditions (publication; production checkout at that revision; raw
   pages transferred and verified; fresh backup; admin draft editor quiet; re-check of the three rulings), exact production commands,
   verification SQL, recovery (restore of the pre-load dump; decision to the owner). No production write. Any lost link or unexplained
   effect => no seal; owner question instead.

### S3. Planning dates + consolidated attended draft (orchestrator)
Record as PROPOSED: weekly slot Tuesday 10:00-10:30 Melbourne (351, kits R1/R6), season-opening Tuesday 23 February 2027 (350, kit R8;
inside 2027-02-15..03-03, G0 by 2027-03-10). One consolidated draft of attended scope + window for R1, R2 (destination blank), R3, R4,
R5, R6, R7, R8 and the 371/372 release (described as including a brief restart) at
`docs/v2/evidence/backlog-20261121/ATTENDED-DRAFT-20261122b.md`. Not executed.

### S4. ISSUE-332 monitoring preparation (orchestrator)
Wrapper and schedule prepared; dry tests against a non-production target on streamanator (e.g. the wrapper against a local stand-in for
the forced-command status output, success and failure paths); no install on production; delivery NOT recorded as verified.

### S5. Workspace inventory (orchestrator; read-only `du`/`ls` on streamanator)
Table: path, size, still needed after DEV qualification (why), production data, credentials. Delete nothing.

### S6. Records and closure
Trackers (issues.md entries 348/350/351/332/363/new G-c issue; IssuesIndex + Open Issues table; CHANGELOG for retained behaviour;
blockers.md where it lists these), run record `docs/v2/evidence/backlog-20261121/RUN-20261122b.md`, `afldb-closure` over the
commits (diff scope, trailers, tests re-run on streamanator), report.

## 2. Ordering and risks
- S1 and S2 are independent (different files) and run in parallel; S3-S5 are records-only.
- S2 risk: the normal reload's link authority is ledger + live `player_link_resolutions` + `--bridge`; without the right child it
  unlinks. Rehearsal (S2.7) is the gate; a lost link is HIGH and blocks the seal.
- S2 risk: `--dry-run` retains a failed `import_batches` row (`tools/v2/gap029-draft-link-production.py` header), so the sealed plan must not
  dry-run on production; dry runs happen on the isolated restore only.
- S1 risk: the tier-P tool must not alter tier S or any default path.

## 3. Review (afldb-reviewer, launch plan review, 2026-11-22): PROCEED-WITH-CHANGES
No CRIT/HIGH. The MED items below are binding amendments to the steps above; where they conflict with section 1, this section wins.

- **R-1 (MED, S2.1/S2.2) additive pin, legacy default untouched.** Do NOT repoint `draftguru-contract.json` `parity_baseline` and do
  NOT turn `EXPECTED_ROWS/PERSONS` into a closed per-label map. Reasons on disk: `validate_identity` takes no label
  (`parse_draft_snapshot.py:499-512`, also `:763`), so a repointed baseline refuses the default-label rebuild;
  `tests/draftguru-acquisition.test.ts:178-179` pins 6810/5057 on `parity_baseline`; `tests/draftguru-import.test.ts:303-304` pins the
  literal `EXPECTED_ROWS = 6810`; `tests/python/draftguru_link_only_contract.py:104,185-191,1227` monkeypatches `imp.EXPECTED_*` and runs
  link-only under a THIRD label, `annual-html-20260902` (DEV's); `bridge_import_gate.py:149` reads the constants at import.
  Design: add a new contract key (e.g. `reviewed_acquisitions["annual-html-20261122"]`) and one helper that returns the pin for a
  pinned label and otherwise the existing module constants / `parity_baseline`, read at call time. Every unpinned label
  (20260826, 20260902, any other) behaves byte-for-byte as today. `import_draftguru.py:310,313,571,573` use the helper with `args.label`;
  the link-only sites (`:941,:1049,:1054`) stay on the legacy constants (no 5,088-person child exists; see R-6).
- **R-2 (MED, S2.2) leave `DRAFTGURU_EXPECTED` unedited.** Its only callers run the default label (`rebuild-test.ts:1301` refuses a
  candidate run on any other label; `tests/db-test-rebuild.test.ts:6105` pins the exact object). Record "not moved, caller = default
  label" and state in the run record and sealed plan that the source rebuild still yields 6,810/5,057, so the 348 "rebuild differs
  from production by 35 rows" clause stays OPEN as an owner follow-up (switching the default label changes tier S and its digest).
  This also removes the only file overlap between S1 and S2. Acceptance: `tests/db-test-rebuild.test.ts`, both draftguru vitest files
  and every `tests/python/draftguru_*contract.py` pass unmodified except for additions; `--validate-only` with the default label on
  the real 20260826 raw pages on streamanator still prints 42 / 5057 / 6810.
- **R-3 (MED, S2.5-S2.8) the sealed bridge is the rehearsed bridge.** The reload guard does not review link columns
  (`reload_guard.py:66-68`) and `effect_digest` does not cover them; normal mode resets every person to unmatched and re-derives links
  from ledger + live resolutions + `--bridge` (`import_draftguru.py:732-736`). So: (a) the sealed plan pins one bridge sha and it must
  be the exact bytes used in S2.5 and S2.7; a production-local file that was not rehearsed may not be named; if no byte-equal
  `d6251609…` copy exists off production and a regenerated child is used, that child is what is transferred and pinned;
  (b) acceptance is link-state EQUALITY, both directions: `player_id`, link status and `match_method` of every DraftGuru person, pick
  and identity row equal to R0, any gained or changed link is "no seal" exactly like a lost one; (c) the sealed plan carries a
  link-state digest SQL with the R0 value as a production PRE-condition (R0 is a 22 Nov copy; admin links made since must stop the
  run) and the rehearsal's after value as the POST check.
- **R-4 (MED, S2.8) `--no-seed` is mandatory in the production command** and in both rehearsal runs: normal mode otherwise may mint a
  player shell (`import_draftguru.py:795-801,1469`).
- **R-5 (MED, S2.7) declare the expected write set before the rehearsal, not after.** Expected by code: +31
  `external_identities(draftguru)` rows (the D-336-2 tool wrote none; `reconcile_draftguru_identities` inserts them), `notes` on all
  5,088 identity rows to `stage_a_snapshot=annual-html-20261122`, `import_batch_id` on every DraftGuru row, `confidence_notes`
  rewritten on the 35 picks / 31 persons (the `AFLDB-ISSUE-336 bounded insert` text is lost; `data_edits` remains the audit trail),
  `competition` on 35, `dg_person_id` renumbering, 191 origins, one `import_batches` row. Anything else is unexplained. "Repeat once"
  means a SECOND fresh restore, comparing after-state table digests excluding batch id and timestamps (the guard digest is pre-write
  and proves nothing about the result).
- **R-6 (LOW, S2.8) state in the sealed plan** that `--link-only` and `gap029-draft-link-production.py` already refuse on production
  (5,088 persons vs `:1049`) and will also refuse on the identity note after the load; no regression, but the owner should read it.
- **R-7 (MED, S1.4) the determinism check as written cannot pass.** `fp.sql` hashes whole rows (`t::text`), so two tier-P builds
  differ in `data_overrides`/`data_edits`/`auth_users` timestamps and the clone-local actor's credentials. Define before running:
  rekeyed-evidence sha equal; a fingerprint over all tables with a declared volatile-column exclusion list (written into the tool's
  report); Gridley counts equal (G-a pass, G-b 0, G-c 118, solved 10,209). Tier-S proof: the template's own `fp.sql` before and after
  both builds is identical.
- **R-8 (MED, S1.1) the tool fabricates a Super Admin**, so its refusals must also cover: non-loopback host, any pre-existing
  `auth_users` row, and the template database itself; each with a unit test. Check `tests/v2-module-boundaries.test.ts` for the new
  `tools/v2` -> `src/db/queries/admin-draft.ts` import.
- **R-9 (LOW)** S2.3 seal must be offline (the existing tool re-fetches robots.txt on resume, `acquire_draft.py:366-369`); section 0
  must authorise READ of the raw pages in `/mnt/ssd/afldb-backlog-20261122-dg` and verify them against the tracked
  `raw-pages.sha256`; regenerate `documentation/plans/_index.md` via `doc-index`.
