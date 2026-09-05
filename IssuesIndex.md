# AFLDB Current Issues Index

> Lightweight session index of **open issues only**.
>
> `issues.md` is the authoritative detailed ledger. If this file and
> `issues.md` disagree, trust `issues.md` and immediately synchronize this file
> and the Open Issues table at the top of `issues.md`.

**Last updated:** 2026-09-05
**Open issues:** 3 tracked here — `AFLDB-ISSUE-110`, `AFLDB-ISSUE-137`, `AFLDB-ISSUE-138`.

<!-- UPDATE 2026-09-05 (ISSUE-118 REOPENED, later the same day): the closeout below stands as
     history, but its acceptance definition was too weak — 28 valid Gridley criteria were counted
     as acceptable because they were classified data_absent. Reopened with a corrected contract
     (zero unsupported valid criteria); row restored below; 2 -> 3. Runbook moved back to
     `issues/open/AFLDB-ISSUE-118.md` (§23). -->

<!-- UPDATE 2026-09-05 (ISSUE-118 closeout): `AFLDB-ISSUE-118` is **Resolved**. Merged to `main`
     (`4efdf70`), deployed to DEV (`tmEQ-3b-HBNZtkAw90Aag`) and PROD (`pEc4154P6P0QK8Hjoo5Uj`);
     the production journal confirmed digest `1511510695` = SQLSTATE 57014 (two entries,
     2026-09-03 15:49 AEST) and no recurrence after the deploy; migration `080` deliberately NOT
     applied on production (runtime does not read `external_grids`). Authoritative records:
     `issues.md` (Resolution, 2026-09-05) and `issues/closed/AFLDB-ISSUE-118.md` §22.12.
     Next free issue ID is still `AFLDB-ISSUE-138`. -->

<!-- UPDATE 2026-09-04 (ISSUE-125 closeout): `AFLDB-ISSUE-125` is **Resolved**. A rebuilt
     database is now promoted by restoring it into a NEW candidate on the production host,
     truncating every non-rebuilt table there, reinstating production-owned rows from the
     mandatory pre-cutover dump (18 tables in FK order plus `staging_aflw`; `auth_sessions`,
     `beta_login_tokens`, `promotion_decisions` reset; `player_link_match_candidates`
     regenerated; `canonical_applications`/`staging.*` taken from the rebuild), writing a
     `database.promoted` audit marker, running `privileges.sql`, and swapping by
     `ALTER DATABASE … RENAME`. `npm run db:promotion:check` (read-only, fail-closed) binds each
     phase to one database name, refuses any public table without a decided treatment, gates
     migration parity, REFUSES any reserved-domain (`*.test`, `example.*`, …) identity in any
     email-bearing table, proves the real super admin, compares counts to the pre-cutover
     snapshot and probes grants. Procedure: `docs/production-promotion.md`; contract:
     `tools/db/promotion-inventory.ts`; 37 DB-free tests. No production mutation; ISSUE-126
     and ISSUE-137 untouched. Branch `claude/issue-125`, not merged. -->

<!-- UPDATE 2026-09-04 (ISSUE-134 closeout): `AFLDB-ISSUE-134` is **Resolved**. The settle now
     publishes the season it committed to the public ISR cache, and the `404`-on-every-request
     defect the first DEV acceptance found is repaired: gate 1 requires the forwarded client
     address to RESOLVE TO LOOPBACK rather than requiring the forwarding headers to be absent,
     which Next 16 makes meaningless by synthesising both on every request. Soundness rests on
     the tracked proxy contract - both Caddyfiles overwrite `X-Forwarded-For` with
     `{remote_host}` on every proxy block and drop `X-Real-IP`/`Forwarded`, and
     `deploy/afldb.service` binds the app to `127.0.0.1` - and that contract is now asserted
     statically so it cannot drift. Accepted on the real host: correct-secret loopback POST 200,
     non-loopback/chained/malformed 404, wrong secret 401, four distinct worker ordinals reached
     on fresh connections, `/seasons/2026` regenerated inside its hour against a control, and a
     spoofed `X-Forwarded-For: 127.0.0.1` WITH the correct secret still refused through the real
     Caddy proxy. Two real settle runs were 0/0 and published nothing. Branch
     `claude/issue-134` is pushed but **NOT merged and NOT deployed to PROD** - that is the
     operator's call. DEV was restored to `main` @ `169d738`. Evidence:
     `issues/closed/AFLDB-ISSUE-134.md` §11-§12. -->

<!-- UPDATE 2026-09-04 (ISSUE-127 closeout): `AFLDB-ISSUE-127` is **Resolved** — operator host
     validation completed on dev (`streamanator`, deployed revision `169d738`). The polkit grant
     was exercised as `arm` over a non-interactive session: `start` on
     `afldb-settle-afltables.service` allowed, `stop` on the same unit and `start` on
     `afldb.service` both refused. Three Super Admin attempts wrote audit rows 636/637/638
     (`started`, `started`, `already-running`) for two ingestion transactions (batches 91, 92);
     panel counters matched `import_batches` field for field; the control was inert with
     `AFLDB_SETTLE_TRIGGER` unset. Two deviations recorded (dev sudo needs a password, so the
     grant was proved as `arm` directly and `afldb` restarted via `kill MainPID`; and the
     "second press" check needs a stale second tab because `SettleRunPanel.tsx:183` disables the
     button once the unit reads `running`). **No repository code, test, unit-file, migration or
     `privileges.sql` change**, no `CHANGELOG.md` change (the feature's entry already shipped on
     2026-09-03), and **no production command of any kind** — production installation is the two
     ordinary `docs/deployment.md` §7b host steps, not outstanding issue work. Dev's nightly
     settle timer was never installed and still is not; no cadence was created or altered.
     Removed from this index and the `issues.md` Open Issues table; its number stays allocated;
     it claims **no migration number** (`086` still next free). Committed on `codex/issue-127`,
     not merged. Authoritative records: the `AFLDB-ISSUE-127` entry in `issues.md` (Resolution —
     2026-09-04) and `issues/closed/AFLDB-ISSUE-127.md` §13.
     **Next free issue ID is still `AFLDB-ISSUE-138`.** -->

<!-- UPDATE 2026-09-04 (ISSUE-113 closeout): `AFLDB-ISSUE-113` is **Resolved** — tracked
     Brownlow season artefact + fail-closed loader + `brownlow-season` rebuild stage; V1-V13
     green on the canonical `db:test:rebuild` with the ISSUE-136 fold
     (`issues/closed/AFLDB-ISSUE-113.md` §8.18); committed on `claude/issue-113`, not merged,
     not deployed. Production still shows the empty-season-table symptom; its remediation is
     sequenced under `AFLDB-ISSUE-137` (repair the four splits first, then load the artefact). -->

<!-- UPDATE 2026-09-04 (ISSUE-136 closeout): `AFLDB-ISSUE-136` is **Resolved** — canonical
     `db:test:rebuild` and the ISSUE-113 V5 witness are green on the shared `afldb_test`
     (`issues/closed/AFLDB-ISSUE-136.md` §13); committed on `claude/issue-136`, not merged, not
     deployed. `AFLDB-ISSUE-137` is now ALLOCATED and Open (production still holds the four
     split canonical players; not started; no production mutation authorised). Neither claims a
     migration number (`086` still next free). `AFLDB-ISSUE-135` is ALLOCATED on branch
     `claude/issue-135` (worktree `D:\dev\afldb-issue-135`, uncommitted there, subject not
     visible from this branch) and is NOT free; its own branch adds its row.
     **Next free issue ID is `AFLDB-ISSUE-138`.** -->

<!-- UPDATE 2026-09-04 (ISSUE-131 closeout): `AFLDB-ISSUE-131` is **Resolved** — runbook §8's
     production acceptance is reconstructed and accepted from persisted production evidence
     (`issues/closed/AFLDB-ISSUE-131.md` §16). Removed from this index and the `issues.md` Open
     Issues table; its number stays allocated; it claims **NO migration number** (`086` still next
     free) because §7's optional hardening index was never measured (§9.4) and is not adopted.
     Committed on `claude/issue-131`, not merged. No application, test, migration, deployment or
     `CHANGELOG.md` change in the closeout, and no write on any environment.
     **Next free issue ID is still `AFLDB-ISSUE-138`.** -->


<!-- ALLOCATION WARNING 2026-09-01: `AFLDB-ISSUE-118` is allocated and is NOT free.
     It belongs to the Gridley compatibility-corpus project on branch `opus/gridley-corpus`,
     which has committed Stage 0/1/2 under that ID. The NL-search telemetry issue below was
     renumbered 118 -> 119 on 2026-09-01 because its claim was still uncommitted; see
     `issues/closed/AFLDB-ISSUE-119.md` §0. Next free issue ID is `AFLDB-ISSUE-121`.
     NOTE: the branch and worktree have since been renamed to `codex/issue-119` /
     `D:\dev\afldb-issue-119`, so the ID now matches; runbook §21.1/§22.1/§23.1 record the
     former `codex/issue-118` name and are accurate as of their dates.
     MIGRATION NUMBERS 2026-09-01: `080_external_grids.sql` belongs to `opus/gridley-corpus`;
     `081_nl_search_telemetry_clear.sql` is allocated to `AFLDB-ISSUE-119`, committed on
     `codex/issue-119`, applied to `afldb_test` and now validated end to end there.
     UPDATE 2026-09-01: `082_auth_audit_log_jsonb_repair.sql` is committed on `dev` (`54c7a31`) and
     APPLIED to `afldb_test` and `afldb_dev`; it is NOT yet applied to production (ships with or
     after the code fix, never before it). `AFLDB-ISSUE-121` is **Resolved 2026-09-01** and is no
     longer an open issue; its number stays allocated.
     UPDATE 2026-09-02: `AFLDB-ISSUE-122` is now ALLOCATED and Open (automatic current-season AFL
     Tables canonical ingestion; planning complete, nothing implemented). **Next free issue ID is
     `AFLDB-ISSUE-123`.** ISSUE-122 will claim a migration number at implementation time and its
     runbook §12.1/§15.2 REQUIRE a live-branch scan first — `083` is the next free number visible
     from this worktree but is NOT reserved, and `080_external_grids.sql` belongs to
     `opus/gridley-corpus`. `claude/issue-116` must re-scan every live branch tip and derive its
     own number immediately before renumbering its competing `079_access_code_delete.sql`.
     UPDATE 2026-09-02 (later): ISSUE-122 S1 re-scanned 49 tips (083 still free) and CLAIMED
     `083_canonical_auto_apply.sql` on `claude/issue-122`; it is applied to `afldb_test` only and
     is UNCOMMITTED until the operator commits S1, so other branches cannot yet see it. Any other
     branch needing a number must treat `083` as taken and derive `084` or later.
     UPDATE 2026-09-03 (ISSUE-122 closeout): `AFLDB-ISSUE-122` is **Resolved 2026-09-03** and is
     no longer an open issue; its number stays allocated. `083_canonical_auto_apply.sql` is
     COMMITTED and merged to `main` (merge `250caa2`) and is APPLIED TO PRODUCTION — production
     is at `083` with 0 pending — so `083` is now visible to every branch and is definitively
     taken. Four follow-ups were allocated out of that closeout: `AFLDB-ISSUE-123`,
     `AFLDB-ISSUE-124`, `AFLDB-ISSUE-125` and `AFLDB-ISSUE-126`, all Open and none implemented.
     UPDATE 2026-09-03: `AFLDB-ISSUE-127` is now ALLOCATED and Open (Super Admin on-demand AFL
     Tables current-season refresh), implemented on branch `codex/issue-127` in worktree
     `D:\dev\afldb-issue-127`. **Next free issue ID is `AFLDB-ISSUE-128`.** None of 123-127
     claims a migration number — ISSUE-127 adds no schema at all; `084` is the next number
     visible from this worktree but is NOT reserved, and any branch needing one must still
     re-scan every live branch tip before claiming it.
     UPDATE 2026-09-03 (later): `AFLDB-ISSUE-128` and `AFLDB-ISSUE-129` are now ALLOCATED and
     Open, both implemented/raised on branch `codex/issue-127` in worktree
     `D:\dev\afldb-issue-127` alongside ISSUE-127. **Next free issue ID is
     `AFLDB-ISSUE-130`.** `AFLDB-ISSUE-128` claims NO migration number (no schema change).
     `AFLDB-ISSUE-129` **WILL need one and has NOT claimed it** — it must re-scan every live
     branch tip first; `084` is the next number visible from this worktree but is NOT
     reserved.
     UPDATE 2026-09-03 (ISSUE-128 closeout): `AFLDB-ISSUE-128` is **Resolved 2026-09-03** and is
     no longer an open issue; its number stays allocated and it still claims NO migration number.
     **Next free issue ID is still `AFLDB-ISSUE-130`.**
     UPDATE 2026-09-03 (ISSUE-129 closeout): `AFLDB-ISSUE-129` is **Resolved 2026-09-03** and is no
     longer an open issue; its number stays allocated. It **CLAIMED, WROTE AND COMMITTED TWO
     MIGRATION NUMBERS** - `084_round_type_wildcard_final.sql` and
     `085_matches_is_finals_series.sql`, committed on `opus/issue-129` at `b1d4085` after a scan of
     all 54 references and 5 sibling worktrees. Both are APPLIED TO `afldb_test` ONLY - **not**
     `afldb_dev` and **not** production, which is still at `083`. **`084` and `085` are definitively
     taken; the next free migration number is `086`, and any branch needing one must still re-scan
     every live branch tip.** **Next free issue ID is `AFLDB-ISSUE-130`.**
     UPDATE 2026-09-03 (ISSUE-130 Stage 1): `AFLDB-ISSUE-130` is now ALLOCATED and Open (the settle
     service's R library dependency is undeclared and unvalidated), Stage 1 investigation/design only
     on branch `claude/issue-130` in worktree `D:\dev\afldb-issue-130`. UPDATE (Stage 2, same day):
     implemented on that branch (two new `deploy/afldb-r-*.sh` files, settle script, docs, tests);
     awaiting dev-host validation before closure. UPDATE (closeout, same day): `AFLDB-ISSUE-130` is
     **Resolved 2026-09-03** on `claude/issue-130` and is no longer an open issue; its number stays
     allocated. Dev host validated (supervised settle COMPLETE with the drop-in absent), production
     inspected read-only and **already compliant** (fitzRoy 1.8.0 in `/usr/local/lib/R/site-library`,
     no drop-in) — no production reconciliation required. **Not merged to `main`, not deployed.**
     Deployment gate: after the normal controlled production deploy, `sh deploy/afldb-r-preflight.sh`
     on `afldb-prod` must end `R PREFLIGHT: OK` before the settle timer runs on the new code
     (`issues/closed/AFLDB-ISSUE-130.md` §12.5).
     It claims **NO migration number** (no schema change), so the next free migration number is still
     `086`. **Next free issue ID is `AFLDB-ISSUE-131`.**
     UPDATE 2026-09-03 (ISSUE-131 Stage 1, amended after Stage 2): `AFLDB-ISSUE-131` is now ALLOCATED and Open (an upstream
     match rekey duplicates the canonical match instead of updating it), on branch
     `claude/issue-131` in worktree `D:\dev\afldb-issue-131`. Stage 1 was
     investigation/design/RED-reproduction only; **Stage 2 (2026-09-03) implemented and
     validated the fix and the §8 repair tool on `afldb_test`, is UNMERGED, and touched no
     production database — `afldb-settle-afltables.timer` remains STOPPED.** It claims **NO
     migration number** — the identity fix needs no schema change, which Stage 2 confirmed. One OPTIONAL
     hardening index (a UNIQUE on `(season, match_date, home_club_id, away_club_id)`) is proposed and
     is **gated on measuring the full canonical history first** (runbook §7/§9.4); it is NOT adopted
     and NOT reserved, so the next free migration number is still `086` and any branch needing one
     must re-scan every live branch tip. Also synchronised in this pass: `issues.md`'s open-issue
     count line still listed the resolved `AFLDB-ISSUE-130` and now does not.
     **Next free issue ID is `AFLDB-ISSUE-132`.**
     UPDATE 2026-09-03 (ISSUE-132 Stage 1): `AFLDB-ISSUE-132` is now ALLOCATED and Open (Wildcard
     Final visibility on the public and admin UI — the rendered-surface follow-up ISSUE-129
     deferred), on branch `claude/issue-132` in worktree `D:\dev\afldb-issue-132`. Stage 1 is
     inspection/plan only (no defect found; Stage 2 is regression tests). It claims **NO
     migration number**, so the next free migration number is still `086`.
     **Next free issue ID is `AFLDB-ISSUE-133`.**
     UPDATE 2026-09-03 (ISSUE-132 closeout): `AFLDB-ISSUE-132` is **Resolved** — no application
     change; regression tests only (T1-T6/T6b GREEN, `tsc` GREEN, one pre-existing ISSUE-129
     Windows CRLF test artefact dispositioned by the operator). Removed from this index; its
     number stays allocated; it claimed NO migration number, so `086` is still the next free
     migration. **Uncommitted on `claude/issue-132`.** A SEPARATE, NOT-started investigation is
     handed off in `issues/closed/AFLDB-ISSUE-132.md` §11 and the ISSUE-132 ledger Follow-up:
     production holds two canonical 2026 Wildcard Final matches that the observed public season
     UI did not show, although the repository's query/render paths and tests support them.
     Allocate `AFLDB-ISSUE-133` for it when it opens.
     **Next free issue ID is still `AFLDB-ISSUE-133`.**
     UPDATE 2026-09-03 (ISSUE-133 investigation stage): `AFLDB-ISSUE-133` is now ALLOCATED and
     Open (production season page did not show the two 2026 Wildcard Finals), on branch
     `claude/issue-133` in worktree `D:\dev\afldb-issue-133`. Investigation complete and
     CLASSIFIED as stale ISR cache output — deployed revision, migrations, data and query path
     all correct; the deploy prerendered `/seasons/2026` 23 minutes before the settle inserted
     the rows and the route's `revalidate = 3600` window served that prerender. Runbook
     `issues/open/AFLDB-ISSUE-133.md`. No code, migration or production change; it claims NO
     migration number (`086` still next free). **Uncommitted on `claude/issue-133`.**
     **Next free issue ID is `AFLDB-ISSUE-134`.**
     UPDATE 2026-09-03 (ISSUE-133 closeout): `AFLDB-ISSUE-133` is **Resolved** — stale ISR cache
     output caused by build-before-settle ordering plus the one-hour revalidation window; the
     operator's read-only production verification showed the on-disk `/seasons/2026` entry
     regenerated at 23:50:48 AEST with the Wildcard Final block and the live page rendering both
     matches. **No application fix was made.** Removed from this index; its number stays
     allocated; it claimed NO migration number (`086` still next free); runbook moved to
     `issues/closed/AFLDB-ISSUE-133.md`. `AFLDB-ISSUE-134` is now ALLOCATED and Open
     (current-season settle should invalidate/revalidate affected public season ISR — the
     ISSUE-133 §11.4 handoff; NOT started, no branch, no worktree). It claims NO migration
     number. The ISSUE-131 row below carries a dated bookkeeping correction (merged, deployed,
     timer active; §8 acceptance evidence unrecorded); ISSUE-131 stays Open.
     **Uncommitted on `claude/issue-133`.**
     UPDATE 2026-09-04 (ISSUE-113 validation): `AFLDB-ISSUE-135` is ALLOCATED on `claude/issue-135`
     (worktree `D:\dev\afldb-issue-135`, not yet on `main`) and `AFLDB-ISSUE-136` is allocated here on
     `claude/issue-113`. **Next free issue ID is `AFLDB-ISSUE-137`.**
     UPDATE 2026-09-04 (ISSUE-124 closeout): `AFLDB-ISSUE-124` is **Resolved 2026-09-04** and is no
     longer an open issue, superseding the 2026-09-03 line above that listed it as Open and
     unimplemented; its number stays allocated and it claims **NO migration number** - `086` is
     still the next free one. The fix is a `deploy/afldb.service` section move only: no migration,
     schema, `privileges.sql`, `.env`, timer, polkit or database change. Of the four ISSUE-122
     follow-ups, `AFLDB-ISSUE-123`, `-125` and `-126` remain Open and unimplemented. Committed on
     `claude/issue-124`, **not merged**. -->

<!-- The former "`AFLDB-ISSUE-110` is allocated and is NOT free" merge warning is retired:
     the ISSUE-110 branch merged into dev on 2026-08-31 and its own row below is now
     authoritative. -->

## How Claude should use this file

- Read this file once near the start of technical AFLDB work.
- Use it to identify overlap with a known open issue.
- If an issue is relevant, read only that exact detailed entry from `issues.md`.
- Do not read all of `issues.md` just to understand current project problems.
- When an issue is created, reopened, resolved, materially reclassified, or
  given a materially different next action, update this file in the same task.
- Keep this file synchronized with the Open Issues table at the top of
  `issues.md`.

## Open issues at a glance

| Issue | Severity | Area | Current state |
|---|---|---|---|
<!-- RETIRED 2026-09-01 — `AFLDB-ISSUE-119` is **Resolved** and is NO LONGER an
     open issue. Final guarded Playwright acceptance passed 9/9 against the
     disposable loopback `afldb_test` deployment. Authoritative records:
     `issues.md` (Resolution, 2026-09-01) and
     `issues/closed/AFLDB-ISSUE-119.md` §34. -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-107` is **Resolved** and is NO LONGER an open issue.
     Its pre-resolution row and detail block are retired below; their "Only open gate" and
     "Exact next action" text is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-107`
     entry in `issues.md` (Resolution, 2026-08-30) and `issues/closed/AFLDB-ISSUE-107.md` "Gates".
     Final gate state: G0/G1/G2/G3/G4 PASS; G5 (production eligibility) is out of ISSUE-107's
     scope by design and is NOT a completion condition. G2 closed when `AFLDB-ISSUE-108`
     validated green on Linux at commit 673f0e3 (89 passed / 5 skipped files, 2,515 passed /
     104 skipped tests, 0 failures, 122.21 s). Production rollout is separate work under its
     own review and is NOT authorised by this resolution. -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-108` is **Resolved** and is NO LONGER an open issue.
     Do not read the row below as current: it is the pre-resolution index row, kept only as
     lineage, and its "Open" / "awaiting serial re-run" / "Next" text is SUPERSEDED.
     Authoritative records: the `AFLDB-ISSUE-108` entry in `issues.md` (Resolved, 2026-08-30)
     and `issues/closed/AFLDB-ISSUE-108.md` §12. Final validation, Linux, exact commit 673f0e3, Node
     v22.23.2 / npm 10.9.8, `npm test -- --no-file-parallelism`: 89 passed / 5 skipped test
     files (94), 2,515 passed / 104 skipped tests, 0 failures, 122.21 s. `afldb_test` was NOT
     rebuilt and was never stale — it matched the accepted canonical baseline
     `full-history-20260827`. Every residual is a deliberate skip with an owning issue
     (`AFLDB-ISSUE-090` §27.5 Brownlow, DraftGuru Stage B3, `AFLDB-ISSUE-099` 2026 provisional,
     retired DOB adjudication, the gitignored DraftGuru CSV oracle, and the restricted
     `afldb_import`-role parity cases). Non-blocking follow-up carried forward, NOT reopening
     this issue: `tools/validation/validate_migration.py` and `tests/fixtures/oracle_baseline.json`
     are still bound to the retired legacy dataset. This closure set `AFLDB-ISSUE-107` G2 to PASS.
     The pre-resolution index row is DELETED, not merely commented out, so ISSUE-108 cannot
     render as an open row under any renderer. Its full pre-resolution text is preserved in
     `issues/closed/AFLDB-ISSUE-108.md` §9 and in the `AFLDB-ISSUE-108` entry in `issues.md`. -->

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-090` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "Next action" text is SUPERSEDED. Authoritative records:
     the `AFLDB-ISSUE-090` entry in `issues.md` (Resolution, 2026-08-28) and
     `issues/closed/AFLDB-ISSUE-090.md` §27. Final evidence: DOB reconciliation suite 27/27, the canonical
     external-identity release assertion 1/1 (pin 13,275), privileges 24/24 with no grant
     widened. NOTE: the full `release-gates.test.ts` suite is NOT green — Gate 1 was 42
     passed / 22 failed on 2026-08-28 and the 16 unrelated failures stay with
     `AFLDB-ISSUE-095`, `AFLDB-ISSUE-093`/DraftGuru B3, `AFLDB-ISSUE-096`/`-098`/`-099` and
     rebuild-baseline drift. Two unowned observations are carried at `issues/closed/AFLDB-ISSUE-090.md`
     §27.5: no legacy-free writer for `brownlow_season_votes`, and no writer at all for
     `unlinked_player_with_games` backlog issues. Neither was converted to an issue here.

| `AFLDB-ISSUE-090` | Medium | Data integrity / Import | Club-list DOB enrichment stacked duplicate unresolved `dob_conflict` rows on rerun and the register pass deleted conflicts it did not own. **Reconciliation contract IMPLEMENTED and PROVEN**: migration 072 applied, focused suite 27/27, and the global duplicate-issue invariant in `release-gates.test.ts` is **GREEN**. **Gate 1 run 2026-08-28** — 64 tests / 42 passed / 22 failed, all classified (handoff §11.3). Owned repair made: external-identity pin `12_472` → `13_275` (test-baseline repair from the canonical rebuild; live 13,275 = `measured.players` = `distinct_urls`, `missing_url` 0). The five `gate: birth dates` population assertions are **RETIRED as acceptance** — the canonical rebuild runs neither enrichment pass, 855 DOBs is the accepted baseline's contracted figure, the register pass needs `AFLDB_LEGACY_SQLITE` plus a `legacy_player_id` nothing writes, and the club-list CSVs are gitignored/absent. Revised standard: `issues/closed/AFLDB-ISSUE-090.md` §27.4. **Next action: run `privileges.test.ts` (Gate 2) — no grant widened.** Other 16 failures owned by ISSUE-095 / ISSUE-093-B3 / ISSUE-096-098-099 / rebuild drift; untouched. |
-->

<!-- Open issues continue. The header is repeated because the retired ISSUE-090 row
     above interrupts the table. -->

| Issue | Severity | Area | Current state |
|---|---|---|---|
<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-095` is **Resolved** and is NO LONGER an open
     issue. The row below is the pre-resolution index row, kept only as lineage; its
     "next action" text is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-095`
     entry in `issues.md` (Resolution, 2026-08-28) and `issues/closed/AFLDB-ISSUE-095.md` §14.
     Final evidence: clean afldb_test rebuild passed, 1,622-row ladder witness
     comparison agreed on every field, final validation 19/19, release gates 45/64
     with all nine club-organization/identity gates green. No migration (75/75), no
     privilege widened. The 19 remaining gate failures are owned by Brownlow
     acquisition, DraftGuru B3, DOB enrichment, the attendance baseline and the
     current-season 2026 pipeline — NOT by this issue.

| `AFLDB-ISSUE-095` | Medium | Data acquisition / Import architecture / Data integrity | `club_seasons` has no canonical, legacy-free acquisition path — `rebuild_derived.py` builds it only from `staging.team_seasons`, whose sole writer is `import_legacy_afl.py` under `AFLDB_LEGACY_SQLITE`. A clean canonical rebuild therefore correctly yields `club_seasons = 0`. **D1–D7 approved and IMPLEMENTED 2026-08-28** (`issues/closed/AFLDB-ISSUE-095.md` §10 decisions, §11 record). The pinned fitzRoy `fetch_ladder_afltables` was deparsed and **computes** its ladder from results under a uniform 4/2/0 rule, so it is adopted as a **validation witness only**; every `club_seasons` column is now derived from canonical `matches` under a declared rule, `ladder_rank` fails closed to NULL on an exact tie (audited: zero ties in 1,622 rows), provenance moved `sports_data_lab` → `afltables`, and a **fail-open** `North Melbourne` 1999–2007 identity gap was closed. Six Stage-9 gates added; nine-stage topology unchanged; no migration. Resolver proof 37/37 DB-free. **Not resolved** — vitest suites unrun (worktree has no `node_modules`), ladder acquisition and clean rebuild outstanding. |
-->
<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-096` is **Resolved** (complete within its authorised S1–S4
     scope) and is NO LONGER an open issue. Do not read the commented-out row below as current:
     it is the pre-resolution index row, kept only as lineage, and its intermediate "UNAPPLIED",
     "BLOCKED" and "next action" text is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-096`
     entry in `issues.md` and `issues/closed/AFLDB-ISSUE-096.md` §16.16–§16.17. Final evidence: source contract
     106/106, spine suite 13/13, FK gate 2/2, privileges 24/24, migrations 75/75 with 074 before
     075, fingerprint `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.
     Downstream work stays with `AFLDB-ISSUE-086` (manual authority), `AFLDB-ISSUE-099`
     (the `data_issues` disagreement row) and `AFLDB-ISSUE-101` (rollover supersession).

| `AFLDB-ISSUE-096` | Medium | Data acquisition / Import architecture | Parent architecture/contract issue for 2026+ API-first acquisition. **HALT LIFTED 2026-08-28** — decisions A–H and §12 approved (`issues/closed/AFLDB-ISSUE-096.md` §14); now foundation implementation S1–S4, still **no family-specific importer**. Evidence baseline: P3/P4/P5/P6 PASS; **P1/P2 RE-RUN 2026-08-28 with the supplied Kali key — both PASS**; P7 still BLOCKED. **P1 falsified an approved S1 declaration**: Kali `/matches` is NOT a Squiggle proxy, so Squiggle+Kali are now TWO match witnesses (`/fixture` stays a proven proxy). **S1 IMPLEMENTED + AMENDED** (GREEN 34/34); **S2 COMPLETE and GREEN 2026-08-28 — final post-hygiene run 61/61, 0 failures, 303 ms** (first run 59/61; the two red source-contract assertions were **confirmed false positives** — both `[^;]*` regexes spanned the migration's own explanatory comments — and the **tests** were repaired to inspect executable SQL statements; migration unchanged, append-only and A→B→A invariants intact). §16.4 hygiene fixed: the NUL bytes in `observations.ts:499` are now source escapes (same character, keys byte-identical — the proposed space separator was **rejected** as semantics-changing and ambiguity-permitting) and the stale "migration 073" header reads 074. Migration **074** (073 is ISSUE-086's `data_overrides`) **UNAPPLIED**; no CHANGELOG entry required at this checkpoint. **S3 COMPLETE and GREEN 2026-08-28 — `84/84`, 0 failures, 316 ms** — `src/lib/acquisition/reconciliation.ts` computes Decision C's ten verbs from a live payload against the stored open version with an exported precedence, reusing S2's ownership predicate and authority boundary; foreign **and unreadable** ownership fail closed before authority is asked, agreement never substitutes for authority, and a payload change moving no projected fact field returns the verb-less `history_only` outcome (settled, not an eleventh verb). **S4 IMPLEMENTED 2026-08-28 and AWAITING VALIDATION (§16.10)** — new pure `src/lib/acquisition/promotion-review.ts` carries the review contract: the candidate record with 074's CHECKs enforced in TypeScript, a `baselineCanonicalHash` over **exactly the proposed fields** (ordering-independent, null for a `new` target), `renderReviewItem`, `evaluateAcceptRequest`, the requeue-vs-supersede rule, and reject/requeue decision drafts; render and accept both recompute the baseline from re-read values and then delegate to **S2's `evaluateAcceptance`**, so its gate order and the `stale_review`/`stale_canonical_target` distinction are unchanged. `observations.ts` gained one additive, behaviour-preserving export (`canonicalJson`) so canonical values are never hashed under a family's *payload* exclusions. **§7's gate is intact by construction:** no `'accept'` decision is representable, a cleared evaluation still returns `write.implemented: false`, and `UNAVAILABLE_MANUAL_AUTHORITY` refuses every promotable verb including `new`. **S4 COMPLETE and GREEN 2026-08-28 — `105/105`, 0 failures, 357 ms** on the final post-hygiene run, user-run: the promotion-review contract renders the approved candidate evidence, hashes a baseline over **exactly** the proposed/touched fields (deterministic, ordering-independent; unrelated canonical changes do not stale a review, proposed-field changes do), keeps moved source evidence and a moved canonical baseline as **distinct** stale outcomes, re-runs every acceptance gate fail-closed (provider agreement never substitutes for authority; foreign and unreadable ownership refuse; authority conflict and indeterminate/unavailable refuse; season ownership enforced), rejects without mutating canonical facts or observations, and exposes no force/override/bypass/consensus path. **The canonical acceptance/write transaction is deliberately NOT implemented** — the write, provenance quartet and real `accept` decision row stay blocked behind ISSUE-086's authority contract, `PromotionDecisionDraft` cannot represent an acceptance, and a fully cleared gate still reports the write as unimplemented. NUL hygiene RESOLVED (user-performed byte repair, verified). Migration 074 UNAPPLIED; no production/`afldb_dev` work; **no approved S5 exists** — §11 stops at S4. `AFLDB-ISSUE-100` remains separate and does not block this checkpoint. **PostgreSQL validation phase HALTED AT PREFLIGHT 2026-08-28 and BLOCKED (§16.13):** `npx tsx tools/db/migrate.ts --status --target test` proved the target is `afldb_test` (73 of 74 applied) and then **refused** because applied migration `073_data_overrides.sql` (**ISSUE-086's**) fails the checksum guard. 074 was **NOT applied and NOT modified**; no database was written; S1–S4 stay green. Line-ending and algorithm causes are eliminated (ISSUE-091's three-representation tolerance; 72 rows validated in the same pass); Git shows **one committed 073 blob only** (`a8ad3079…`, in `2a068a8`/`e0d64aa`), clean worktree, no stashes — so **no committed revision matches the applied artefact** and `dev` holds **no** invalid mutation of an applied migration. **CONFIRMED by the ledger:** stored `47937827…`, committed canonical-LF `778c5bfb…`, applied `2026-08-28 01:54:41.063665+10` — **1 h 1 min 48 s before** the sole committed revision existed (`2026-08-28 02:56:29+10`), so an **uncommitted intermediate** version was migrated and then changed before commit. **Repair owned by `AFLDB-ISSUE-086`** (database-ledger coherence, not history surgery); **a later corrective migration cannot fix it alone** — the runner validates applied checksums before running anything, so the baseline must be made coherent first, and `afldb_test` must **not** be rebuilt from this worktree while pending 074 lacks its §16.14 FK indexes. **074 has NOT failed — it was never executed.** **BLOCKER RESOLVED 2026-08-28:** ISSUE-086 rebuilt `afldb_test` cleanly through the committed 073 — **73/73 applied, 0 pending, no drift** — so the **PostgreSQL validation phase may resume**. The structural pre-application review's **three missing FK-covering indexes** are now **repaired in 074 itself before first application** (§16.14): `ix_promotion_candidates_evidence`, `ix_promotion_candidates_decision`, `ix_promotion_decisions_admin`. **074 remains UNAPPLIED** pending DB-free source-contract validation of that repair, **075 (ISSUE-086) also remains unapplied**, and application must be normal filename order — **074 then 075**. **No DB-backed FK validation is green yet** — `tests/integration/fk-indexes.test.ts` is untouched and cannot run against 074 until 074 is applied. **PHASE RESUMED AND SCHEMA GATE GREEN 2026-08-28 (§16.16):** 074 then 075 applied to `afldb_test` only, **75/75, 0 pending, no drift**, privileges reconciled, FK gate **2/2**, fingerprint `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`. `src/lib/acquisition/` still has **no persistence layer**, so new suite `tests/integration/observation-spine.test.ts` proves the **schema half** of §5.H only — real `decideObservation`/`sweepAbsences` decisions applied to `afldb_test`, each head read back out of PostgreSQL, all inside an always-rolled-back transaction on a synthetic `sources` row. Refreshed matrix: **2 executable** (A→B→A; absence ≠ deletion), **3 partial** (idempotence; foreign ownership; stale-review race), **3 BLOCKED** — manual authority (ISSUE-086), the `data_issues` row (never implemented), rollover supersession (ISSUE-101, no supersession column in 074). **No canonical acceptance/write path added**; blocked rows have no test rather than a fake one. **VALIDATION GREEN 2026-08-28, user-run: source contract `106/106`, FK catalogue gate `2/2`, spine suite `13/13`.** The one first-run failure was a fixture defect (`seasons.is_complete` is generated from `status` since migration 015) that aborted ten cases in shared setup before their bodies ran; seed corrected to `status = 'in_progress'`, no behavioural assertion changed, rerun 13/13. **13/13 proves the implemented PostgreSQL/schema half of §5.H only** — the three partial rows stay partial and the three blocked rows stay blocked. |
-->

<!-- Open issues continue. The header is repeated below because the retired ISSUE-096 row
     above and the retired ISSUE-099 row that follows both interrupt the table. -->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-099` is Resolved (T1-T8 complete, validated end-to-end
     on real 2026 data) and is NO LONGER an open issue. Do not read the commented-out row
     below as current: it is the pre-implementation index row, kept only as lineage, and its
     "nothing implemented" / "start at T1" text is SUPERSEDED. Authoritative records: the
     `AFLDB-ISSUE-099` entry in `issues.md` and `issues/closed/AFLDB-ISSUE-099.md` "T8 — COMPLETE".
     Final evidence: `current-season-import` 172/172; `settle-afltables` integration 20/20
     with zero skips (incl. restricted `afldb_import` role parity); typecheck at the 13-error
     unrelated baseline with zero ISSUE-099 errors; ESLint silent; real 2026 acquisition
     207 matches / 9522 player rows / 0 missing profile URLs; clean apply (batch 90) then
     idempotent rerun (batch 91) with ZERO canonical rows written. Migration 076 is applied
     and checksum-frozen - never edit it. Carried out as separate open work below:
     `AFLDB-ISSUE-104`, `AFLDB-ISSUE-105`, `AFLDB-ISSUE-106`. Downstream: `AFLDB-ISSUE-101`.

| `AFLDB-ISSUE-099` | Medium | Data acquisition / Import architecture | 2026 has no player stats, period scores, attendance or Brownlow votes. Nightly in-season AFL Tables settle pass. **Planning COMPLETE 2026-08-28 — approved contract at `issues/closed/AFLDB-ISSUE-099.md`; nothing implemented. P5 PASSED, stop condition NOT triggered — no longer probe-blocked.** v1 stops at candidates + `data_issues`: **zero canonical writes.** Next action: fresh Opus/High/Normal session, carry-over `issues/closed/AFLDB-ISSUE-099.md`, start at T1. |
-->

| Issue | Severity | Area | Current state |
|---|---|---|---|
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-100` is **Resolved** and is NO LONGER an open
     issue. Implemented and validated end-to-end against the real 2026 R20/R25 source;
     migration 077 applied and checksum-frozen. Retained as lineage only — its
     "next action" text is SUPERSEDED. See `issues.md` for the resolution record.
| `AFLDB-ISSUE-100` | Medium | Data acquisition / Import architecture | Staging-only lineup/team-announcement domain fed by `fetch_lineup_afl`. **Never canonical participation.** **P3 (identity) and P3b (shape/types/NULLs/completeness) both PASS** — no longer probe-blocked; the R20-only column is `lateChanges` and the set is complete at 20. **L1–L3B2 COMPLETE and GREEN 2026-08-29.** Source-family contract, bounded acquisition (`tools/rebuild/afl_api/`), deterministic observation bundle (`lineup-bundle.ts`), **migration 077 applied and checksum-frozen** to `afldb_test`, and persistence (`lineup-store.ts`) through the **074 spine** into the typed `staging.afl_api_lineup`. Durable family-local contracts: `external_record_id` = `providerId\|teamId\|player.playerId` (delimiter-refusing), `scope_key` = `season=YYYY;round=NN`, enumeration `complete:false` permanently. Binding and proved: `source_id` resolved internally from literal `'afl_api'`; unresolved `match_id`/`club_id`/`player_id` stay **NULL** and the row still persists; **no absence sweep**; **no DELETE/TRUNCATE path** (keyed upsert only); **no canonical participation write**; `player.captain` raw evidence but **not projected** (572/572 `FALSE` sentinel); `lateChanges` **verbatim, never parsed**; no closed enum CHECKs; `required_columns` stays at five. Owner **16/16 + 11/11** and **restricted `afldb_import` parity green**. Next: **bounded real R20/R25 persistence validation**, then close-out. |
-->
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-101` is **Resolved** and is NO LONGER an open issue.
     Resolved for the **reusable mechanism only**: an explicit, fail-closed rollover planner +
     dry-run-by-default CLI, with the fitzRoy full-history, accepted-baseline and offline
     ladder-witness authorities all EXECUTED against a temporary successor state before any
     tracked write. `measured` and `identity_scan` are derived from validator execution;
     `--identity-scan` no longer exists. **No season was rolled** — the real boundary is
     unchanged (accepted through 2025, `seasons.json` 2026 / `in_progress [2026]`), no
     migration was added (077 remains the highest, untouched), and no canonical row is
     written. Only `validate_ladder_witness.py --compare` remains post-rebuild, because it
     requires the rebuilt database. Actual 2026 -> 2027 execution is **intentionally deferred**
     until the season is formally complete and genuine completed-season evidence (a real
     full-history candidate `1897..Y` plus a matching ladder witness) exists; it must not be
     manufactured. Final evidence: `tests/season-rollover.test.ts` 131/131;
     broader regression 5/5 suites, 472 passed, 6 existing skips;
     `tests/python/ladder_identity_contract.py` all executable checks passed (acquired witness
     bytes skipped — gitignored by design). Authoritative record: the `AFLDB-ISSUE-101` entry
     in `issues.md`. `AFLDB-ISSUE-101-HANDOFF.md` is handoff documentation only and its §14/§15
     "current active task" and "what remains" text is SUPERSEDED. Do not read the
     commented-out row below as current — its "not yet validated" text is SUPERSEDED.

| `AFLDB-ISSUE-101` | Medium | Data acquisition / Import architecture / Data integrity | End-of-season promotion / baseline rollover. **Planner + CLI IMPLEMENTED 2026-08-29, not yet validated** (`src/lib/rollover/season-rollover.ts`, `tools/db/rollover-season.ts`, `tests/season-rollover.test.ts`). No migration, no canonical write, no clock read; **2026 NOT rolled**. ISSUE-099 and ISSUE-095 are both Resolved, so both dependencies are satisfied. Two policy points adjudicated 2026-08-29: the retired-baseline lifecycle status is **`retired`** (now declared in the real register as `selection_policy.retired_statuses`, a policy-only edit that changed no acceptance, measurement or fingerprint), and **`accepted_corrections` are reviewed per acquisition, never inherited**. **Must not redefine completed-season `club_seasons` ownership** — ISSUE-095's D1–D7 are implemented, not open, and its D7 already added six `club_seasons` Stage-9 gates. |
-->

<!-- Open issues continue. The header is repeated because the retired ISSUE-101 row
     above interrupts the table. -->

**ISSUE-102 / ISSUE-112 closeout checkpoint — 2026-09-02:** both issues are
**Resolved**. ISSUE-112 G1–G8 and ISSUE-102's eight closure criteria all pass; the
authoritative records are `issues/closed/AFLDB-ISSUE-112.md` §32 and
`issues/closed/AFLDB-ISSUE-102.md` §8.4. ISSUE-113 remains Open outside the parent
closure boundary, and the unrelated query-builder timing regression remains with ISSUE-116.

| Issue | Severity | Area | Current state |
|---|---|---|---|
| `AFLDB-ISSUE-136` | High | Data acquisition / Identity / Data integrity | **OPENED 2026-09-04 from the ISSUE-113 database validation (runbook §8.16.4). NOT STARTED.** The accepted fitzRoy baseline `full-history-20260902` has 83 rows in `player_stats_2025.csv` with a blank fitzRoy `ID` and a renumbered AFL Tables profile URL (`Charlie_Cameron3`, `Jack_Graham2`, `Jack_Ross3`, `Jack_Williams3`, `Billy_Wilson2`); `import_fitzroy_core.py` keys identity by path and seeded each as a NEW canonical player, so one person is two players (e.g. `2604` Cameron 229 games 2014-24 + `2608` Cameron 25 games 2025). Present on `afldb_test` and on production (same baseline). Effect: careers split; ISSUE-113's season-grain Brownlow rows key by the current path and land on the 2025 shells (34 votes; `sum(player_season_stats.brownlow_votes)` 79,079 vs 79,113); two re-armed release gates fail. Not to be resolved inside ISSUE-113. Next: confirm current paths on live AFL Tables; define the blank-`ID`/renumbered-URL merge or rekey rule in the core import (ISSUE-131 rekey is the nearest precedent), record per-player decisions in a tracked file, gate blank-`ID` rows in the baseline register; rebuild `afldb_test`; then ISSUE-113 V5-V13 and a production correction plan. |
<!-- RETIRED 2026-09-02 — `AFLDB-ISSUE-102` is Resolved and is NO LONGER an open issue.
     Authoritative records: `issues.md` (Resolution — 2026-09-02) and
     `issues/closed/AFLDB-ISSUE-102.md` §8.4. All eight closure criteria passed; ISSUE-113
     remains open outside the parent closure boundary by §8.3. The historical row below is
     retained as lineage only and must not be read as current state.
| `AFLDB-ISSUE-102` | Medium | Data acquisition / Import architecture | **PARENT ARCHITECTURE / COORDINATION RECORD — scope revised 2026-08-30 by operator decision** from the former "record only; do not design the replacement" boundary, which is now superseded (lineage retained in `issues.md`). Runbook `issues/open/AFLDB-ISSUE-102.md`; continuation state `issues/open/AFLDB-ISSUE-102-HANDOFF.md`. ISSUE-102 owns the architecture, the `AFLDB_LEGACY_SQLITE` inventory, child coordination, the closure criteria and the final verification that `import_awards.py` no longer operationally requires legacy SQLite — **it does not implement loaders**. Confirmed: the dependency is **per-group** (`needs_legacy = any(key not in LEGACY_FREE_GROUPS ...)`; the predicate was generalised from the single `under_22` exemption by ISSUE-111 pass 1), `under_22` is legacy-free via the tracked `data/awards/22-under-22.csv` manifest and `coleman` is legacy-free by derivation, leaving **six of eight** groups still dependent; classified **`LEGACY_SOURCE_DEPENDENCY`**, a repeatable reload still required by `docs/deployment.md` §7. `tools/db/rebuild-test.ts` gained a `coleman` data stage in ISSUE-111, **validated by the 2026-08-30 canonical rebuild** (`AFLDB-ISSUE-111` **Resolved 2026-08-30**; its record stays at `issues/open/AFLDB-ISSUE-111.md` while this parent cites it); the other five awards/honours tables still have **no rebuild stage and no Stage-9 gate**, so a canonical rebuild leaves them at **zero rows** — the `club_seasons = 0` shape of ISSUE-095. Every integrity contract a replacement needs already exists in `reload_keyed` and **no privilege change is required**; but `awards-reload-links.test.ts:205-1247` is **currently unexecutable** (gated on `AFLDB_LEGACY_SQLITE`). Children: **`AFLDB-ISSUE-111`** (Coleman derivation), **`AFLDB-ISSUE-112`** (curated honours manifests), **`AFLDB-ISSUE-113`** (Brownlow season totals — **outside 102's closure boundary**; 102 may resolve while 113 stays open, and the resolution must say so). `AFLDB-ISSUE-110` is NL semantic-mapping work (merged into dev 2026-08-31, own row below) and is **not** a child. **Next action: ISSUE-112 implementation phasing** — G0 is **DONE 2026-09-01 (all nine families PASS**, measured read-only against `afldb_dev`; `AFLDB-ISSUE-112.md` §14.4/§14.6). All 7 slices (honour teams, Hall of Fame, captaincies, Rising Star, All-Australian, club best-and-fairest, named medals) are **IMPLEMENTED + DB-validated** (through 2026-09-02, Pass 14) — every family is manifest-backed and runs legacy-free individually. **ISSUE-112 closeout ATTEMPTED 2026-09-02 (Pass 15, runbook §24) — ISSUE-112 STAYS OPEN.** G2/G4/G7/G8 PASS, G5 PASS-in-shape, **G3 PARTIAL**, **G6 BLOCKED** (the accepted fitzRoy/DraftGuru snapshot bytes are absent from every reachable checkout; re-acquiring is a scrape ISSUE-112 §12 forbids) — **superseded 2026-09-02 by ISSUE-112 Pass 20: the operator authorised reacquisition and then re-acceptance, and G6's input blocker is now cleared (`full-history-20260902`, `ladder-20260828`, `annual-html-20260902`); the rebuild itself is still unrun.** The §7 AWARDS/HONOURS rebuild stage now exists (`awards-honours`, between DraftGuru and DERIVED, Stage-9 per-family row gates), the last two shared definitions and the 33 previously-unowned `rising-star` winner rows are tracked, and a **correctness defect was found and fixed**: the manifests' carried `player_id` denoted a different footballer after a canonical rebuild in **12,392 of 12,392** cases, so links now resolve through the tracked AFL Tables profile identity (`data/awards/player-identity.csv`), fail-closed. **UPDATE 2026-09-02: `AFLDB-ISSUE-112` is RESOLVED** — G1-G8 all PASS, the DraftGuru preflight label defect was fixed at the wiring, and the canonical rebuild ran end to end against `afldb_test` (exit 0, FINAL VALIDATION 38/38, every awards/honours family at its exact expected count, zero orphan and zero wrong-player links, no legacy SQLite in the plan). The former gate "ISSUE-102 cannot close until ISSUE-112 does" is **satisfied**. Both in-boundary children (`AFLDB-ISSUE-111`, `AFLDB-ISSUE-112`) are now closed; `AFLDB-ISSUE-113` is outside this issue's closure boundary. **Next action: evaluate ISSUE-102's own closure criteria (`issues/open/AFLDB-ISSUE-102.md` §8) in a fresh session** — not yet done, so ISSUE-102 stays OPEN. Extraction-source prerequisite (ISSUE-112 §11.1) is **DECIDED 2026-09-01**: the legacy-loaded AFLDB PostgreSQL state, not a fresh scrape. One systemic pre-merge operator decision remains for ISSUE-112 — `source_citation` granularity (no per-row page citation survives in PostgreSQL; no scrape proposed). ISSUE-111's gate is closed: it is Resolved. **No implementation is authorised under ISSUE-102 itself.** |
-->
<!-- RETIRED 2026-09-02 — `AFLDB-ISSUE-112` is **Resolved** and is NO LONGER an open issue.
     Its index row is DELETED, not commented out, so it cannot render as an open row under any
     renderer. Authoritative records: the `AFLDB-ISSUE-112` entry in `issues.md` (Resolution,
     2026-09-02) and `issues/closed/AFLDB-ISSUE-112.md` §32. Final gate state: **G1-G8 all PASS.**
     G6 closed when the canonical `npm run db:test:rebuild` ran end to end against `afldb_test`
     (exit 0, FINAL VALIDATION 38/38, every awards/honours family at its exact expected count,
     zero orphan and zero wrong-player links, no legacy SQLite in the plan). The last blocker was
     an orchestrator defect, not data: `draftguruValidateArgv()` took no label, so the DraftGuru
     preflight could verify one snapshot while the data stage imported another. Fixed at the
     wiring — the preflight argv is now derived from the data-stage argv and `runPreflight` takes
     the same `Options` object `planStages()` uses.
     Carried forward, NOT reopening this issue: the §24.6 identity backlog (18 censused players /
     33 manifest rows, unchanged, plus 16 players / 19 rows first measurable against canonical
     data — all fail closed to unlinked, none mis-linked) still needs an operator decision, and
     the one out-of-scope post-rebuild test failure was routed to `AFLDB-ISSUE-116`, which owns
     that mechanism. -->
<!-- RETIRED 2026-09-03 — `AFLDB-ISSUE-122` is **Resolved** and is NO LONGER an open issue.
     Automatic current-season AFL Tables canonical ingestion is OPERATING IN PRODUCTION.
     `main` merged at `250caa2`; production pulled it, is at migration `083` with 0 pending,
     `db:privileges` reconciled, R 4.3.3 + fitzRoy 1.8.0 installed and pinned. Supervised
     production ladder passed end to end on snapshot `settle-2026-09-02-1958`: a full
     `--dry-run --auto-apply` against the real production schema rolled back completely, the
     real apply (`import_batches` 731) wrote 10582 canonical rows / 9133 ledger rows with 0
     refusals and 0 failures, and the identical rerun (`import_batches` 732) wrote 0/0/0 —
     **SC3 passed on production**. Exception report showed only the 803 unresolved player rows;
     0 other pending candidates, 0 apply failures, 0 source disagreements, 0 moot candidates.
     `deploy/afldb-settle-afltables.timer` is enabled and active, next trigger
     Fri 2026-09-04 04:34:12 AEST, `Persistent=true`; Squiggle/Kali are never invoked
     automatically and no fallback canonical authority exists. **S9 is NOT REQUIRED** — §14
     rule 7 refuses all 189 legacy-loaded 2026 rows, adoptable set 0. Health after the final
     recovery: `{"status":"ok","database":"ok","latencyMs":2}`; production super-admin login
     verified after the auth recovery. `afldb.com` stays the static holding page (its
     `/api/health` 404 is expected); Caddy unchanged. All SC1-SC10 clear. Authoritative record:
     the `AFLDB-ISSUE-122` entry in `issues.md` (Resolution, 2026-09-03) and
     `issues/closed/AFLDB-ISSUE-122.md` §23. Four follow-ups routed out of the closeout:
     `AFLDB-ISSUE-123`, `-124`, `-125`, `-126`. -->
<!-- RETIRED 2026-09-03 - `AFLDB-ISSUE-129` is **Resolved** and is NO LONGER an open issue.
     AFL Tables' Wildcard Final is now canonically representable. Implementation commit `b1d4085`
     on `opus/issue-129` adds migrations `084_round_type_wildcard_final.sql` and
     `085_matches_is_finals_series.sql` - applied to `afldb_test` ONLY, not dev and not production
     - a distinct `wildcard_final` round type with `matches_is_final_ck` UNCHANGED (so
     `is_final = true` by construction), and one canonical `matches.is_finals_series` generated
     column that is false for both `home_and_away` and `wildcard_final`. The full §11 acceptance is
     green: T1-T16; five touched integration suites **268 passed / 5 skipped / 0 failed**;
     typecheck clean; 0 lint findings in changed or new code; **T15 generated-column invariant
     0 mismatches**; **T16 ladder witness 1,622 comparable club-seasons agree**; and **T7 against
     the real live source 209 matches / 9,614 player-match rows, 0 rejected, 0 unkeyed,
     `SOURCE COMPLETENESS: COMPLETE`** (was 207 / 9,522 with 94 unrepresentable rows). ISSUE-128
     needed no code change. Its number stays allocated and `084`/`085` are definitively taken.
     Authoritative record: the `AFLDB-ISSUE-129` entry in `issues.md` (Resolution, 2026-09-03) and
     `issues/closed/AFLDB-ISSUE-129.md` §18.
     **NOT DEPLOYED TO PRODUCTION** - production is at `083` with no wildcard support. ISSUE-128 and
     ISSUE-129 must ship together: deploying 128 alone leaves the nightly settle unit reporting
     `failed` every night the 2026 Wildcard Round is in the acquired window. Next action: merge both
     to `main`, apply `084` then `085` to dev and re-validate, then production in the order
     migrations -> `npm run db:privileges` -> code deploy -> supervised settle. -->
<!-- RETIRED 2026-09-03 — `AFLDB-ISSUE-128` is **Resolved** and is NO LONGER an open issue.
     A current-season settle can no longer report success while dropping rows AFL Tables supplied:
     the completeness verdict is derived from the source's own counters (never a calendar), stated
     by `import_fitzroy_core.py`, enforced by `settle-afltables.ts --require-complete-source`
     **after** the settle commits, passed by `deploy/afldb-settle-afltables.sh`, and projected by
     `/admin/current-season`. The legacy Kali `auto` mode is removed, unknown modes are refused and
     `parseCurrentSeasonSources()` no longer defaults to `kali`. Validated on dev with the real
     systemd chain (`import_batches` 87 committed `completed`, 980 canonical rows, 0 apply failures,
     unit exited **1** with `Source INCOMPLETE: 94 unrepresentable row(s), 2 unswept scope(s)`), then
     accepted on `afldb_test` — `tests/integration/settle-afltables.test.ts` **44 passed / 1 skipped
     / 0 failed** (the skip is the pre-existing restricted `afldb_import`-role check on an unset
     `AFLDB_TEST_IMPORT_DATABASE_URL`). The temporary systemd drop-in repointing the unit at the
     ISSUE-128 worktree has been removed and the unit restored to `/home/arm/projects/afldb`.
     NOT eyeballed in a browser: the rendered INCOMPLETE alert on `/admin/current-season` — proven
     at the data layer only; carried to `AFLDB-ISSUE-129`. Authoritative record: the
     `AFLDB-ISSUE-128` entry in `issues.md` (Resolution, 2026-09-03) and
     `issues/closed/AFLDB-ISSUE-128.md` §12-§13.
     **NOT DEPLOYED TO PRODUCTION, deliberately** — the nightly unit will report `failed` every
     night the 2026 Wildcard Round is in the acquired window. `AFLDB-ISSUE-129` (Wildcard Final
     enum + finals semantics) is the open blocker and must be decided first. -->
<!-- RETIRED 2026-09-03 — `AFLDB-ISSUE-130` is **Resolved** and is NO LONGER an open issue.
     The settle service's R library is declared (`deploy/afldb-r-env.sh`) and validated at deploy
     time (`deploy/afldb-r-preflight.sh`, exact fitzRoy pin read from `fitzroy-contract.json`);
     `/usr/local/lib/R/site-library` is canonical on every host; unit file unchanged. Resolving
     validation: dev-host supervised settle with the untracked drop-in ABSENT and `Environment=`
     empty — 209 / 9,614 / 0 unkeyed / `SOURCE COMPLETENESS: COMPLETE`, exit 0. Production
     inspected read-only at `250caa2`: no drop-in, R 4.3.3, jsonlite/digest from apt, fitzRoy
     1.8.0 in `/usr/local/lib/R/site-library` — already compliant, nothing to reconcile.
     **NOT MERGED, NOT DEPLOYED.** Post-deploy gate: `sh deploy/afldb-r-preflight.sh` on
     `afldb-prod` must print `R PREFLIGHT: OK`. Authoritative record: the `AFLDB-ISSUE-130`
     entry in `issues.md` (Resolution, 2026-09-03) and `issues/closed/AFLDB-ISSUE-130.md` §12-§13. -->
<!-- RETIRED 2026-09-03 — `AFLDB-ISSUE-133` is **Resolved** and is NO LONGER an open issue.
     Classification: stale/static/ISR cache output (build-before-settle ordering plus the one-hour
     revalidation window); no application fix made. Operator production verification: live
     `/seasons/2026` renders the Wildcard Final section; on-disk entry regenerated 23:50:48 AEST
     (5 "wildcard", 1 anchor). Authoritative records: the `AFLDB-ISSUE-133` entry in `issues.md`
     (Resolution, 2026-09-03) and `issues/closed/AFLDB-ISSUE-133.md` §11. Follow-up: `AFLDB-ISSUE-134`. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-136` (fitzRoy canonical player identity split on a blank ID +
     renumbered AFL Tables url) is **Resolved** and is NO LONGER an open issue. Canonical rebuild on the
     shared `afldb_test` GREEN (39 final-validation checks; 13,271 distinct players behind 13,275 AFL
     Tables identities; four players with two registered paths), ISSUE-113 V5 witness 79,113 with a zero
     identity gap, split HALT exercised against the real database. Committed on `claude/issue-136`, not
     merged. Authoritative records: the `AFLDB-ISSUE-136` entry in `issues.md` (Resolution, 2026-09-04)
     and `issues/closed/AFLDB-ISSUE-136.md` §13. Follow-up: `AFLDB-ISSUE-137`. -->
| `AFLDB-ISSUE-137` | High | Data integrity / Operations / Database (production) | **NOT STARTED — allocated 2026-09-04 at the ISSUE-136 closeout; no production mutation authorised.** Production `afldb_prod` still holds the four canonical player splits that `AFLDB-ISSUE-136` fixes at rebuild time (Charlie Cameron, Jack Graham, Jack Ross, Jack Williams: a career player plus a 2025-only duplicate keyed on the renumbered AFL Tables url, the duplicate carrying the 2025 match rows, the awards-census rows and every 2026 settle row). The fixed importer HALTs (`external-identity split`) against such a database by design. Key files: `issues/closed/AFLDB-ISSUE-136.md` §10.3/§13.4 (verification SQL), `tools/migration/import_fitzroy_core.py`, `AFLDB-ISSUE-125` (promotion path). | Operator chooses (a) canonical rebuild-and-promote under `AFLDB-ISSUE-125`, or (b) a supervised, reviewed per-player identity reconciliation on production (re-point the renumbered identity, match rows, award rows and settle rows to the career player, recompute derived tables, retire the duplicate) after a production backup; first step of either is a read-only measurement of the production split. |
| `AFLDB-ISSUE-138` | Low | Testing / Database privileges | **OPEN — found 2026-09-05 during ISSUE-118 §23.28.** `tests/integration/privileges.test.ts` ("afldb_import writes exactly the tables the registry allows") reports `external_grids` / `external_grid_axes` as writable-but-unregistered on every database since migration `080`, whose narrow `afldb_import` grants (SELECT + INSERT, UPDATE on `is_current`) are deliberate and outside the registry; reproduced hand-migrated and after a clean 18-stage rebuild, 34/35 pass. No privilege is wrong. | Extend the suite's exclusion list with the two tables and assert the 080 narrow shape (no DELETE/TRUNCATE), mirroring the `data_overrides` column-scoped case; no privilege change. |
<!-- RESOLVED 2026-09-06 (§23.38) — `AFLDB-ISSUE-118` is **Resolved** and is NO LONGER an open issue.
     After-siren integrated into the deterministic rebuild (data stage + `after-siren-reconcile`); FK
     index migration `090` added the one ISSUE-118 migration 086 left off. Full `afldb_test` rebuild:
     22 stages, FINAL VALIDATION 85 checks, after-siren reconcile 38/38. Final Gridley corpus
     (diagnostic) 1,164/1,164: 9,854 cells solved, `incorrect known answer` 0, ISSUE-118 timeouts 0,
     residual unsupported = exactly the seven §23.36 accepted deferrals. 638 ISSUE-118-domain tests
     pass; `tsc` clean. Authoritative records: `issues.md` (Resolution, 2026-09-06) and
     `issues/closed/AFLDB-ISSUE-118.md` §23.38. Branch `claude/issue-118` pushed, not merged.
     Follow-up (not blocking): DEV load, production deploy (ISSUE-137), International Rules scope,
     `AFLDB-ISSUE-138` (`external_grid_*` privilege-registry drift). -->
<!-- 2026-09-05 (superseded by the REOPEN the same day; kept as history) — `AFLDB-ISSUE-118` was
     marked **Resolved**: merged, deployed to DEV and PROD, accepted on both; see `issues.md`
     (Resolution, 2026-09-05) and runbook §22.12. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-131` (an upstream match rekey duplicates the canonical match
     instead of updating it) is **Resolved** and is NO LONGER an open issue. The fail-closed
     rekey-in-place fix is merged (`657a875`) and deployed; runbook §8's production acceptance is
     reconstructed and accepted in `issues/closed/AFLDB-ISSUE-131.md` §16 from state the pipeline
     persists. Read-only production confirmation 2026-09-04 13:27 AEST: **0 duplicate 2026 fixture
     groups**, 209 canonical 2026 matches (207 home-and-away + 2 wildcard_final), settle batches
     735-739 all `completed` (735 applied 2 matches / 2 period sets / 83 player rows, source
     completeness `complete`, 0 refusals, 0 findings; 736-738 identical no-op reruns with zero
     ledger rows; 739 the nightly timer, also zero), no `data_issues` opened, timer **active**.
     `repair-match-rekeys` shipped and was correctly not needed (0 duplicates before the deploy,
     runbook §15.2). Not retained: the R preflight, repair dry-run and settle dry-run transcripts —
     each superseded by stronger persisted state (§16.5). `canonicalMatchesRekeyed = 0` on every
     production run, so the rekey path itself is proven by the `afldb_test` suite, not by a field
     firing (§16.6). Deferred, non-blocking (§16.8): §9.4/§7 hardening index and §9.6/§5.2 `game_id`,
     both unmeasured and NOT adopted (no migration); dev's 17 empty historical duplicate rows
     (separate supervised cleanup, no DELETE proposed); `AFLDB-ISSUE-134`; and re-measuring batch
     735's nine unresolved-identity rejections after `AFLDB-ISSUE-137`. Authoritative records: the
     `AFLDB-ISSUE-131` entry in `issues.md` (Resolution, 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-131.md` §16. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-126` is **Resolved** and is NO LONGER an open issue.
     The row is DELETED, not merely commented out, so it cannot render as an open row under any
     renderer. Production-only state stranded by the 2026-09-02 cutover was decided per table and
     the approved subset restored to `afldb_prod` on 2026-09-04 (T1 92 audit rows with original
     ids 90–181, T2 7 `site_settings` + 1 `site_media`, T5 all eight `staging_aflw` tables =
     51,018 rows, T6 the `database.recovered` marker id 182); the spent beta code, 17 expired
     sessions, the join request, 2 `data_edits`, 8 player-link rows and colliding telemetry were
     deliberately retired and recorded. Database acceptance all PASS and browser acceptance all
     PASS — the operator's post-recovery super-admin login is audit id 183, and `/`, `/aflw`,
     `/aflw/seasons`, `/aflw/seasons/2025` and an AFLW match page all render the recovered state.
     The two public pages that looked stale straight afterwards were ISR output on the one-hour
     window (`AFLDB-ISSUE-133`/`-134` mechanisms, per-worker page cache included) and converged on
     their own; **no defect, no new issue, no application/schema/migration/privileges change, and
     nothing merged or deployed.** `afldb_prod_auth_recovery` is **still retained** — dropping it
     needs separate explicit approval. Committed on `claude/issue-126`, not merged. It claims
     **NO migration number** (`086` still next free) and **next free issue ID is still
     `AFLDB-ISSUE-138`.** Authoritative records: the `AFLDB-ISSUE-126` entry in `issues.md`
     (Resolution — 2026-09-04) and `issues/closed/AFLDB-ISSUE-126.md` §8.2/§8.3/§10. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-124` is **Resolved** and is NO LONGER an open issue.
     `deploy/afldb.service` moved `StartLimitIntervalSec=120`/`StartLimitBurst=5` from `[Service]`
     to `[Unit]` (commit `146b3e0`, branch `claude/issue-124`), values unchanged; the other four
     `deploy/` units carry no second occurrence. Dev D1-D4 green on `streamanator` (in-place
     relocation, not a file copy). **Production P1-P5 green 2026-09-04** under operator-authorised
     **Option B** — the tracked unit installed as a file behind a host-side `diff` gate that
     returned only this issue's relocation and comment move (net +9 lines, no W1/W2/W3, both md5s
     pinned at install time): `systemd-analyze verify` clean, `StartLimitIntervalUSec=2min`
     (was `10s`), `StartLimitBurst=5`, `MainPID=803941` **unchanged**, `active`, `root root 644`,
     loopback and `https://beta.afldb.com/api/health` both ok, **no service restart**. Option B was
     safe on production only because W1-W3 were already installed and live there before this issue
     — measured read-only pre-change; runbook §5.4.1 is corrected accordingly and the evidence is
     §5.4.2. The withheld set therefore remains outstanding **on dev only**, as a routine gated
     deployment of already-reviewed tracked configuration, not a tracked defect. No migration,
     schema, `privileges.sql`, `.env`, timer, polkit or database change; `086` still next free.
     Authoritative records: the `AFLDB-ISSUE-124` entry below (Resolution, 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-124.md` §7.3. -->
<!-- RETIRED 2026-09-04 (ISSUE-123 closeout) — `AFLDB-ISSUE-123` (current-season settle
     performance is unmeasured at steady state) is **Resolved: measured; no optimisation
     warranted** and is NO LONGER an open issue. The measurement the issue was held open for now
     exists. Production's scheduled nightly firing ran **2026-09-04 04:31:21 -> 04:31:56 AEST =
     35.0 s wall / 21.277 s CPU**, `Result=success`, against `TimeoutStartSec=1h` (**0.97 % of
     budget**): acquire 14 s, adjudicate 2 s, and **19 s for the entire per-record settle phase
     over 9,823 records / 209 matches / 9,614 player-match rows**, writing 0 canonical rows, 0
     ledger rows, source completeness COMPLETE (batch 739), with 0 open pending candidates, 0 open
     apply failures and 0 open source disagreements. Production shows **0 deadlocks / 0 conflicts**
     on `afldb_prod`, no settle batch in any status but `completed` in all 25 settle rows, and a
     next timer elapse of 2026-09-05 04:34:59 — no contention, no long-running query, no timeout,
     no failed or stuck batch, no backlog, no possible overlap at a 0.04 % duty cycle. The ~1 hour
     that opened the issue was batch **731**, a one-time whole-season backfill of 10,582 canonical
     + 9,133 ledger rows preceded by a full dry-run pass; it is not the scheduled workload.
     **No performance code was changed** — the ISSUE-122 SC2/SC3/SC4 invariants are preserved by
     construction and were re-confirmed at `413d1d3`. Read-only production inspection only: no
     settle triggered, no cadence altered, nothing mutated, `AFLDB-ISSUE-137` untouched. No
     `CHANGELOG.md` entry (measurement and tracking only, no retained behaviour change); `086`
     still next free migration number. Committed on `claude/issue-123`, not merged. Authoritative
     records: the `AFLDB-ISSUE-123` entry in `issues.md` (Resolution — 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-123.md`. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-113` (replace legacy `brownlow_season_votes` acquisition) is
     **Resolved** and is NO LONGER an open issue. Authoritative records: `issues.md` (Resolution —
     2026-09-04) and `issues/closed/AFLDB-ISSUE-113.md` §8.18. Tracked artefact `data/brownlow/`,
     loader `tools/migration/import_brownlow_season.py`, `brownlow-season` rebuild stage; V1-V13
     green on the canonical `afldb_test` rebuild with the ISSUE-136 fold (V12 105 passed / 0 failed;
     V13 idempotent, fingerprints unchanged). Committed on `claude/issue-113`, not merged, not
     deployed. Production remediation → `AFLDB-ISSUE-137`. -->
| `AFLDB-ISSUE-110` | Medium | Natural-language search / deterministic semantics | NL semantic-mapping fixes, **merged into dev 2026-08-31**; parser v32 with the ranked-career season-bound fail-closed validator revision. Standing evidence: focused parser/validator **182/182**; expanded focused **345/345**; complete DB-free ISSUE-110 matrix **14 suites, 733/733**; typecheck passed; **authoritative post-final-revision operator DB gate 2 files, 46/46 in 20.65 s, started 18:52:45** (`nl-answers-game-season` 24/24; `nl-semantic-mapping` 22/22) — do not mistake the earlier 17:47 46/46 run for this gate. **Latest independent review verdict: REVISE — NOT READY FOR LARGE-SCALE VALIDATION**, two unresolved HIGH findings recorded as next work: **(A) career-predicate season ownership** — a career predicate can exist without consuming `seasonMin`/`seasonMax`, so e.g. `players with at least 3 grand finals since 2000` silently ignores the requested period; replace the blanket career-predicate exemption with explicit period ownership (only predicates that actually consume the relevant bounds may permit them). **(B) `clubFor` ownership with career predicates** — e.g. `Carlton players who debuted since 2000`: `clubFor` can be carried in the plan while execution bypasses the generic club filter merely because `careerPredicates` exist; allow the bypass only when a predicate explicitly owns the relevant club semantics, otherwise reject or correctly compile the club constraint. Durable record: `issues/open/AFLDB-ISSUE-110.md`. **Both findings independently adjudicated CONFIRMED 2026-08-31** by direct source inspection during the full-codebase review (exact code paths in the runbook's 2026-08-31 adjudication section: `plan.ts:1158`/`plan.ts:1197-1202` blanket `careerPredicates` exemptions + `player-career.ts:146` club-filter bypass). **Next action: fix findings A and B fail-closed, then a fresh independent re-review.** No 480, 1,435/1,440, 100k, telemetry reset, or other large-scale validation before APPROVE; the 22,607-search run remains incomplete. |
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-114` (ladder witness `manifest_sha256` was the pre-ISSUE-108 CRLF hash) is **Resolved** and is NO LONGER an open issue. Contract literal repaired to the canonical LF hash `604a8a16…8d3f`, value-asserted in `tests/db-test-rebuild.test.ts`; operator run `npm test -- tests/db-test-rebuild.test.ts` = **214 passed, 0 failed**. Authoritative record: the `AFLDB-ISSUE-114` entry in `issues.md` (Resolution, 2026-08-30). -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-115` (Data QA multi-domain composable queries) is **Resolved**
     and is NO LONGER an open issue. Stages 0–8 complete on worktree `D:\dev\afldb-issue-115` /
     branch `claude/issue-115`; not merged or deployed. Final evidence: spec suite 24/24, integration
     suite 23/23 (47/47 across both, including the T-C11 cost gate under 1000 ms at the normal 5 s
     timeout), `npx tsc --noEmit` clean, `docs/search.md` §6 reviewed GREEN. Evidence-driven V1
     boundary: `player_match_stats` remains a valid results anchor but hosts no related-domain
     cards; all 12 relationships stay available via the other four anchors; `maxRelatedCards = 4`.
     Authoritative records: the `AFLDB-ISSUE-115` entry in `issues.md` (Resolved, 2026-08-30) and
     `AFLDB-ISSUE-115.md` §20. The pre-existing PMS anchor baseline is `AFLDB-ISSUE-116` below. -->
<!-- RETIRED 2026-09-01 — `AFLDB-ISSUE-120` is **Resolved** and is NO LONGER an open issue.
     F1 (per-IP NL `/search` limiter, 30/60 s, friendly HTTP 200 denial, fail-open), F2
     (`/api/health-event` 32 KiB streaming body cap → 413) and F3 (`Object.hasOwn` guards on the
     two request-derived catalogue lookups) are implemented and merged into dev as `21d7c60`.
     Static/unit closure: 4 focused suites 19/19, `npx tsc --noEmit` clean. Dev live end-to-end
     acceptance 2026-09-01: an authenticated beta browser loop against
     `http://10.0.40.100:8090/search?q=…` was allowed 1–30 and denied on request 31 exactly at the
     budget (`limitedAt: 31`, `hits: {4: 31}`); a read-only `nl_search_log` check showed exactly
     30 rows for the 31 requests (the denied request wrote no telemetry row); an oversized
     `POST /api/health-event` returned 413. An earlier unauthenticated 140-request loop against the
     app origin was invalid — the beta gate 307-redirects before the NL limiter runs.
     Authoritative records: the `AFLDB-ISSUE-120` entry in `issues.md` (Resolution, 2026-09-01) and
     `issues/closed/AFLDB-ISSUE-120.md` §12–§16. The production `AFLDB_BETA_GATE` re-adjudication
     recorded there still stands as a launch precondition. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-116` is **Resolved** and is NO LONGER an open issue.
     `runQueryBuilder` no longer carries the total on the page as `count(*) OVER ()`. The page and
     the count are two statements inside one `REPEATABLE READ READ ONLY` transaction sharing one
     compiled `WHERE` fragment; a short page derives its own exact total, so the count statement is
     skipped entirely for single-page and empty results; and `SET LOCAL jit = off` precedes the
     count, whose unlimited cost estimate crossed `jit_above_cost` and cost ~1.15 s of JIT
     compilation for 75 ms of work. Measured on `afldb_test` (PostgreSQL 16.15, 55432 tunnel):
     `player_match_stats` anchor alone **1144.5 → 353.4 ms**, `players x player.captaincies NOT
     EXISTS link_status=unique` **1073.4 → 320.9 ms**, both under the 1,000 ms T-C11 target, with
     `AFLDB_STATEMENT_TIMEOUT_MS` unchanged at 5000, no index and no schema change. The PMS
     anchor-alone gate was tightened from CEILING_MS to BOUND_MS. Filtering, sort, pagination,
     exact-total, parameterisation and timeout semantics are unchanged; the one deliberate
     correction is that a page past the end now reports the real total instead of 0.
     `QUERYABLE_TABLES.player_match_stats.subjects` stays `[]` (re-admission recorded as a separate
     future decision); `AFLDB-ISSUE-115` was not reopened. Authoritative records: the
     `AFLDB-ISSUE-116` entry in `issues.md` (Resolution, 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-116.md`. -->
<!-- RETIRED 2026-09-04 — `AFLDB-ISSUE-104` is **Resolved** and is NO LONGER an open issue.
     Closed as **NOT REACHABLE**, not fixed, and the old "ISSUE-099 is the only writer" premise is
     SUPERSEDED: a second `issue_key` writer now exists (`canonical_apply_failed`, owner
     `AFLDB-ISSUE-122`), but it carries a distinct `issue_type` and a disjoint key prefix
     (`afltables|apply|…`), so it can never contend for ISSUE-099's index entry. The owner-blind
     `ON CONFLICT` is unchanged and is safe only because each `issue_type` in the keyed namespace
     has exactly one owner. No code, schema, migration or test change; migration 076 untouched.
     Authoritative records: the `AFLDB-ISSUE-104` entry in `issues.md` (Resolution, 2026-09-04) and
     `issues/closed/AFLDB-ISSUE-104.md`. Binding reopen trigger: a second owner writing an
     `issue_type` another owner already writes with a non-NULL `issue_key`; the two `issue_type`
     literals converging; or any writer outside `settle-afltables.ts` populating `issue_key`.
     Guard test: `tests/current-season-import.test.ts:3833-3846`. -->
<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-105` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "NOT yet validated" / "next action" text is SUPERSEDED.
     Authoritative record: the `AFLDB-ISSUE-105` entry in `issues.md` (Resolution, 2026-08-29).
     Final evidence, user-run: `current-season-import` 178/178; `settle-afltables` integration
     19 passed / 1 skipped; `afl-api-lineup-store` integration 10 passed / 1 skipped;
     `observation-spine` 13/13. **Both skips are the restricted `afldb_import`-role parity
     cases, skipped because `AFLDB_TEST_IMPORT_DATABASE_URL` is unset — they did NOT run.**
     Not a blocker: no privilege, role, schema or migration behaviour changed, and the
     representation was proved through real PostgreSQL `RETURNING`/binding paths. No
     migration (077 remains the highest, untouched) and no runtime data-format change.

| `AFLDB-ISSUE-105` | Low | Data acquisition / Import architecture / Type safety | postgres.js returns uncast `import_batches.id` (`bigint`) as a **string** while several call sites declared `number`. **Adjudicated and IMPLEMENTED 2026-08-29, NOT yet validated.** Convention: an opaque branded **string** `ImportBatchId`, decoded once at the driver boundary by a fail-closed `asImportBatchId()` — new `src/lib/import-batch-id.ts`. Applied to every TS `INSERT INTO import_batches ... RETURNING id` and every signature carrying a batch id (observation-store, settle, lineup-store, current-season, ingest pipeline/datasets, submissions page, first-kick-goal tool). **No schema/migration change** (077 stays frozen); **no `bigint`→`int` cast** — seven pre-existing test casts removed; **no `Number()` narrowing** — the ISSUE-099 `Number(result.batchId)` workaround is gone. Runtime behaviour is unchanged: every value was already a string. Next action: run `npm test -- tests/current-season-import.test.ts`, then the settle and lineup integration suites. |
-->

<!-- No open rows follow. Everything below is retired lineage only: ISSUE-106 (retired
     2026-08-29) and ISSUE-093 (retired 2026-08-27). The open issues are ISSUE-104, -110,
     -113 and -116, listed above. -->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-106` is **Resolved** and is NO LONGER an open issue.
     Do not read the commented-out row below as current: it is the pre-resolution index row,
     kept only as lineage, and its "Next action" text is SUPERSEDED.
     Authoritative record: the `AFLDB-ISSUE-106` entry in `issues.md` (Resolution, 2026-08-29).
     Final semantics: absent/NULL/empty `period_scores` all mean the source published NO
     period-score evidence, so `match_period_scores` is **not established**,
     `proposedPeriodScoreValues()` returns `null`, and no empty-array candidate can be
     created. Published periods are preserved exactly (partial publication included, NULL
     stays NULL, no periods 5+ invented). Deliberate accounting corrections: a rejected
     record with `projection: null` establishes `matches` only, so the settle suite's
     rejected-record expectation is 4 candidates / 3 rejections, and `observationsUnchanged`
     — which counts reconciliation outcomes per **established** target — is 4, not 5.
     Final evidence, user-run: `current-season-import` 180/180; `settle-afltables` integration
     19 passed / 1 skipped. **The skip is the restricted `afldb_import`-role parity case,
     skipped because `AFLDB_TEST_IMPORT_DATABASE_URL` is unset — it did NOT run.** Not a
     blocker: no privilege, role, schema or migration behaviour changed. No migration (077
     remains the highest, untouched) and no change to the canonical period-score
     representation.

| `AFLDB-ISSUE-106` | Low | Data acquisition / Import architecture | `proposedPeriodScoreValues()` returns `{ period_scores: [] }` instead of `null` for a match with no published quarter scores, so it would raise an **empty** `match_period_scores` candidate — the sibling of the Brownlow defect ISSUE-099 D2 fixed. **Unreachable in the real T8 snapshot** (all 207 matches carried period scores). Next action: decide whether that match establishes the target; if not, return `null`, extend `targetEstablishedBySource()`, and reconcile the integration suite's rejected-record expectation deliberately. |
-->
<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is Resolved and is NO LONGER an open issue.
     Do not read the commented-out row below: it is the pre-resolution index row, kept only
     as lineage, and its "NEXT PHASE"/"next action" text is SUPERSEDED — the first clean
     rebuild has since PASSED (nine stages, 13/13 final validation). Authoritative records:
     the `AFLDB-ISSUE-093` entry in `issues.md` and `issues/closed/AFLDB-ISSUE-093.md` §H15. The only
     remaining follow-up is `AFLDB-ISSUE-095`, listed above as an open issue.

| `AFLDB-ISSUE-093` | Medium | Tooling / Data integrity / Import architecture | **CHECKPOINT 2026-08-27 — CANONICAL FULL-HISTORY FITZROY SOURCE FROZEN. Read `issues/closed/AFLDB-ISSUE-093.md` §19 first — it is the authoritative current-state record.** Accepted baseline `full-history-20260827` (1897–2025, 131 artefacts, 719,042 rows), hash-bound via `data/reference/fitzroy-accepted-baselines.json` (`exactly_one_accepted`, no latest-label fallback) and independently revalidated offline with no PostgreSQL access. Phases 1–4a COMPLETE; DraftGuru Stage A/B1/B2-1..B2-8 COMPLETE (supported `import_draftguru.py`, tracked link ledger, legacy `import_draft.py` tombstoned); orchestrator `npm run db:test:rebuild` IMPLEMENTED (normal mode auto-selects the accepted baseline; validator runs before any destructive stage). **417/417 DB-free tests.** **RESET BLOCKER 2 CLOSED 2026-08-27 — live rollback proof PASSED (`a8a2a899…` → `a8a2a899…` exact, 950 relations, psql exit 3, 1498 ms). `afldb_test` reconstructed: migrations 001–072 + privileges, schema only, NO canonical data. NEXT PHASE: FIRST ACTUAL CLEAN REBUILD — read the FIRST CLEAN REBUILD HANDOFF (§H1–§H10) at the end of `issues/closed/AFLDB-ISSUE-093.md`.** Incident lineage retained in full and not rewritten: Building the proof had already found and fixed two real defects (`runSql` never sent the SQL at all — `void client.unsafe(...)`; and the `pg_` schema exclusion excluded nothing, so `DROP SCHEMA pg_toast` would have aborted the first loop). The live run then exited 0 without aborting and the reset committed: pre-proof `0229d62c…` → post-incident `f46ce34c…`. **`RESET_SQL` has therefore now RUN against live PostgreSQL and produced exactly the intended clean slate (schemas 1, relations 0, migrations absent, 3 extensions and all 56 extension-owned objects preserved) — its semantics are validated; the ROLLBACK CONTAINMENT is what failed and remains unproven.** Production and `afldb_dev` untouched; loss was schema + privileges only, no import had ever run. No clean rebuild has been executed. **SELF-COLLISION FIXED (§20.14):** the hardened proof then refused twice with "1 other client session(s) connected" — the harness's own postgres.js observer, held open across the psql run; corrected to three phases with nothing spanning the reset, gate unchanged and no session exempted. Key files: `issues/closed/AFLDB-ISSUE-093.md` §19–§20, `issues/closed/AFLDB-ISSUE-093-DRAFTGURU-B2-HANDOFF.md` PART I–XVIII, `tools/db/rebuild-test.ts`, `tools/db/prove-reset.ts`, `tools/migration/import_fitzroy_core.py`, `tools/rebuild/draftguru/import_draftguru.py`, `data/reference/*.json`. **EXECUTION-BOUNDARY AUDIT 2026-08-27 (§H11) — the first clean rebuild is NOT READY: three blockers. F1 `db:migrate:test`/`db:privileges:test` are POSIX-shell scripts and npm on Windows runs them under `cmd.exe`, so stages 3 and 4 fail *after* the destructive stage 2 wipes the database (remedy proven: `npm_config_script_shell=bash`, which also propagates to the nested `npm run` calls). F2 `AFLDB_TEST_IMPORT_DATABASE_URL` is unset on `dev` (ISSUE-083 parked at `fa035ed`), so `resolveTarget()` refuses before preflight — operator must set it or pass `--allow-owner-import-dsn`. F3 stage 9 FINAL VALIDATION is declared `run: 'internal'` and `executeRebuild()` has no `internal` branch, so it does nothing and `FINGERPRINT_QUERIES` is never called — the run cannot fail closed on validation/fingerprint mismatch as §H9 requires. F4 (no DB identity/session/psql-probe gate in the orchestrator) and F5 (no lock/statement timeout on the destructive reset) are recorded and compensated by operator-run read-only checks. `.env` loading, the psql argv, accepted-baseline selection, DraftGuru inputs and the zero-`AFLDB_LEGACY_SQLITE` boundary all audited CORRECT. **REMEDIATED 2026-08-27 (§H11.8): F1 and F3 are RESOLVED.** `db:migrate:test` is now `tsx tools/db/migrate.ts --target test` (new `--target` flag; `AFLDB_MIGRATE_TARGET` still supported, a disagreement is a refusal) and `db:privileges`/`db:privileges:test` route through new `tools/db/privileges.ts`, which resolves the DSN in Node — psql invocation otherwise unchanged, script names unchanged. Stage 9 is now a real `validate` stage with its own `deps.runValidation` separate from the destructive `runSql`: 13 gates bound to the accepted register's `measured` block plus `matches_after_accepted_last_season = 0`, `draft_persons` and `draft_picks`; an unrecognised measured key is a refusal so the gate cannot silently shrink; read-only, reports every value, fails the run on any mismatch. `FINGERPRINT_QUERIES` removed. **182/182 DB-free tests** in `tests/db-test-rebuild.test.ts`. **FIRST CLEAN REBUILD ATTEMPT 1 FAILED AT STAGE 5 — REPAIRED (§H12, 2026-08-27).** PRECHECK/RESET/MIGRATIONS 72-72/PRIVILEGES all passed; REFERENCE died on `psycopg.errors.InsufficientPrivilege: permission denied for table player_link_match_candidates` in `guard_cascade()`, which probed every transitive FK dependent of its truncate roots with `SELECT count(*)`. Root cause: `privileges.sql` grants `afldb_import` SELECT on a **base table** only via `import_writable_tables`; `app_readable_tables` is consulted only for views. Migration 045 seeded that registry from the tables existing then, so every base table created after 045 is revoked unless its migration calls `grant_import_write()` — migration 067 registers the candidate cache app-read ONLY, by design (migration 070 reasons about that exact table). The closure is 30 relations and **two** are unreadable: `player_link_match_candidates` (067) and `player_match_period_stats` (062, direct `club_id → clubs` FK) — so a one-table grant would have failed on the next relation. **Repair (no grant added, `privileges.sql` UNCHANGED):** `guard_cascade()` now classifies dependents via `has_table_privilege()` (new `common.selectable()`), counts rows only in proven-readable ones, and REFUSES on any it cannot prove empty; new `reload_truncate()` skips a TRUNCATE whose targets are already empty, since `TRUNCATE … CASCADE` needs privileges on the whole cascade set. On a clean rebuild the roots are always empty, so no closure relation is read or locked and a future migration cannot reintroduce the failure. **204/204 DB-free tests** (`reference-data` + `db-test-rebuild`), `py_compile` OK, no new tsc errors. `afldb_test` holds migrated+privileged schema and ZERO rows (the guard refuses before any write) — the post-stage-4 state. **BOUNDED STAGE-5 PROOF 1 FAILED SAFELY — REPAIRED AGAIN (§H13).** The §H12 repair was necessary but NOT sufficient and its "complete" claim is amended in place. Root cause of the second failure: **a freshly migrated database is not empty** — migrations 015 and 016 SEED `stat_definitions` and `stat_availability`, both truncate roots of the `coverage` group. `guard_cascade()` evaluated emptiness and took its cascade closure over the **union of every group's truncate targets** while `reload_truncate()` decides per group at call time, so the union short circuit could never fire and the closure of the EMPTY `clubs`/`seasons` roots (whose truncates would have been skipped) was adjudicated anyway — refusing over a cascade that was never going to happen. Hypotheses #1/#2/#3/#4 confirmed, #5 rejected. **Repair:** closure is now taken from `populated_roots` only (on a fresh DB that is `{stat_definitions, stat_availability}`, whose closure is just `stat_availability` — in the loader's own rebuild set, so `outside` is empty and neither denied relation is touched); and `guard_cascade()`/`reload_truncate()` can no longer disagree — the guard records the roots it adjudicated and the truncate refuses anything outside that set, or if the guard never ran. **New `tests/python/reference_cascade_contract.py`: 19 DB-free BEHAVIOURAL scenarios** driving the real functions against a fake connection that raises if the guard reads a denied relation — §H12's source-string tests passed against wrong control flow, which is the lesson. **206/206** TS tests, `py_compile` OK, no new tsc errors. `privileges.sql` and `src/db/migrations/` still UNCHANGED; `--allow-cascade` still unused. `afldb_test` untouched (the guard refuses before any write) and still in the post-stage-4 state. **FIRST COMPLETE CLEAN REBUILD PASSED — 2026-08-27 (§H15). STATUS: CLEAN REBUILD PROVEN — FINAL POST-REBUILD VALIDATION PENDING.** `npm run db:test:rebuild -- --acknowledge-destroy afldb_test` ran end to end: all NINE stages passed (PRECHECK, RESET, MIGRATIONS 72/72, PRIVILEGES, REFERENCE, FITZROY, DRAFTGURU, DERIVED, FINAL VALIDATION), with data stages under the **restricted `afldb_import` role** — no `--allow-owner-import-dsn`, no `AFLDB_LEGACY_SQLITE`, not production, not `afldb_dev`. Baseline `full-history-20260827` (131 artefacts, 719,042 rows, manifest `cc8aaf09…`, artefact-set `8e14ce61…`); DraftGuru `annual-html-20260826` (5,057 persons / 6,810 picks / 6 ledger decisions / 5,052 unmatched / 2 seeded). fitzRoy: venues 52, players 13,275, matches 16,838, match_period_scores 134,704, player_match_stats 685,471, brownlow_round_votes 320,861. **Stage 9: `AFLDB-FINAL-VALIDATION PASSED: 13 checks`**, including `matches_after_accepted_last_season = 0` (2026 correctly excluded). Two defects were exposed only by real execution under the restricted role and are now repaired: the REFERENCE cascade guard (§H12/§H13 — `afldb_import` correctly denied `player_link_match_candidates`/`player_match_period_stats`; migrations 015/016 SEED `stat_definitions`/`stat_availability` so the empty-root assumption was false; repair scopes cascade analysis to populated roots, **`privileges.sql` unchanged, no grant added**) and fitzRoy corrections-parameter threading (§H14 — both import phases repaired, `corrections` now required). **`club_seasons = 0` RESOLVED as SEPARATE FOLLOW-UP (§H15.5, source-proven 2026-08-27) — it does NOT invalidate the core rebuild.** The only writer of `staging.team_seasons` is `tools/migration/import_legacy_afl.py` (`:767/:776/:795`, group key `"ladders"`), which requires `AFLDB_LEGACY_SQLITE` (`:1021`). `REBUILDS["club_seasons"]` selects `FROM staging.team_seasons`, so an empty staging table correctly yields zero rows. The ladder/team-season domain therefore has **no canonical acquisition path yet** and was never in the nine-stage contract — zero is the *expected* outcome of a legacy-free rebuild, not a defect in it. Real degradation while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`, `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser/plan/vocab`, `lib/edit/spec.ts`). fitzRoy can derive `played/wins/draws/losses/points_for/points_against/percentage` (and already derives `is_premier`/`finals_played`); `ladder_rank` and `premiership_points` need an external ladder source — both are nullable in the schema, so a partial rebuild is schema-legal but needs a provenance decision (the SQL hardcodes `source_id` = `sports_data_lab`). **Stage 9 must NOT gate `club_seasons` until the domain lands**, or every canonical rebuild would fail on a known gap. Next action: **record a follow-up issue for canonical legacy-free ladder/team-season acquisition + load stage + Stage-9 gate (determine the next unused id from `issues.md`/`IssuesIndex.md` — NOT `AFLDB-ISSUE-094`, already used by NL semantic mapping; link `AFLDB-ISSUE-015` and `AFLDB-ISSUE-093`, do not absorb ISSUE-015), then ISSUE-093 can be marked Resolved — 2026-08-27.** Do NOT start DraftGuru Stage B3; do NOT merge the parked branches. **ISSUE-059 (`4444d76`) and ISSUE-073 (`0885129`) are now UNBLOCKED** for their own focused DB-backed validation against the rebuilt database, as separate work. Do NOT start DraftGuru Stage B3 (optional, not a blocker); do NOT merge the parked branches — ISSUE-083 is complete and parked at `fa035ed`, ISSUE-059 at `4444d76`, ISSUE-073 at `0885129`.** |
-->

---

<!-- RETIRED 2026-09-01 — `AFLDB-ISSUE-121` is **Resolved** (2026-09-01) and is NO LONGER an
     open issue. Its pre-resolution detail block is removed. Authoritative records: the
     `AFLDB-ISSUE-121` entry in `issues.md` (Resolution, 2026-09-01) and
     `issues/closed/AFLDB-ISSUE-121.md` §14. Closing evidence: code fix committed at `54c7a31`;
     `tests/integration/auth-audit-jsonb.test.ts` 8/8 against `afldb_test`; migration `082`
     applied to `afldb_test` and `afldb_dev`; historical `auth_audit_log` row 632 repaired to a
     JSONB object (`detail->>'deletedLogRows' = 4953`); `auth_audit_log_detail_is_object_ck` live.
     Migration `082` is NOT yet applied to production — it ships with or after the `54c7a31` code
     fix, never before it. `AFLDB-ISSUE-119`'s final live dev acceptance is thereby unblocked. -->

---

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-068` is **Resolved** (2026-08-29) and is NO LONGER an
     open issue. The block below is retained as lineage only; its "Current state" and
     "Exact next action" text is SUPERSEDED. Authoritative record: the `AFLDB-ISSUE-068`
     entry in `issues.md` (Status: Resolved) and `issues/closed/AFLDB-ISSUE-068.md` (Resolution —
     2026-08-29). Closing conclusion: the React #418 hydration defect was owned by the Next
     15.5.23 framework dependency closure/runtime/client/serving path; the Next 16.3.1
     closure eliminated it in matched A/B testing and the result is confirmed on the real
     Linux dev deployment with a clean 1,440-load acceptance at BUILD_ID
     uZReW8G1XnsGnG5FNYY-I. No exact internal Next.js function, commit or upstream bug ID is
     claimed. ISSUE-107, ISSUE-108 and ISSUE-109 remain Open and separate.
## AFLDB-ISSUE-068 — Intermittent React hydration errors during NL UI sweeps

- **Severity:** Medium
- **Area:** UI/Hydration
- **Runbook:** `issues/closed/AFLDB-ISSUE-068.md`.
- **First wrong layer:** Next 15.5.23 framework dependency closure/runtime/client/serving path.
- **Current state:** H9 is confirmed at the owning-layer level. Matched Next 15.5.23 passes
  (`oroK-9PaBQoMFamvJGRqB`) completed 1,440 / 1,440 with 73 and 62 hydration/client errors;
  matched Next 16.3.1 passes (`5RU_F0rm5IyuiVwKX9XHi`) completed 1,440 / 1,440 with zero and
  zero. All four runs had identical 1,238 / 202 / 0 semantics, zero HTTP/page errors, zero
  violations and zero metamorphic disagreements. Per-load `x-afldb-build` proved build identity.
- **Causal boundary:** Do not claim a specific Next.js internal function, upstream bug/commit,
  or `next` alone. React/ReactDOM stayed 19.2.8. Next 16 changes the segment-cache/prefetch
  serving format, so internal hydration correction versus changed serving path is not
  distinguished.
- **Deployed acceptance PASSED 2026-08-29:** ISSUE-107 deployed the closure and proved the live
  build; the sweep then ran against `uZReW8G1XnsGnG5FNYY-I` on `http://10.0.40.100:8090` with the
  full 1,440-question corpus, 4 Playwright workers, pool 10, tracing on, JavaScript enabled and no
  retries. Result: **1,440 / 1,440 observed, all bound to that build; zero hydration errors on
  every cut (per worker, same/cross worker, every RSC cluster), zero client errors, zero
  violations, zero metamorphic disagreements, zero HTTP and page errors.** Outcomes improved to
  1,440 / 0 / 0 — attributable to the NL work merged since the A/B source, not to the framework,
  and recorded as such.
- **Corpus note:** the tracked corpus is five rows short of the A/B set; a commit merged after the
  A/B removed five ambiguous "most games in a game" questions. The complete corpus survived on the
  dev host and was proven a clean superset before use, so no threshold was adjusted.
- **Exact next action:** every stated closure condition is met. Awaiting an explicit operator
  decision to close — closure was not authorised with the run, so the issue is left Open.

-->

<!-- RETIRED 2026-09-01 — `AFLDB-ISSUE-119` is **Resolved** and is NO LONGER an
     open issue. Final guarded Playwright acceptance passed 9/9 against the
     disposable loopback `afldb_test` deployment. Authoritative records:
     `issues.md` (Resolution, 2026-09-01) and
     `issues/closed/AFLDB-ISSUE-119.md` §34. -->
<!-- RETIRED 2026-08-30 — `AFLDB-ISSUE-107` and `AFLDB-ISSUE-108` are both **Resolved** and are
     NO LONGER open issues. The two detail blocks below are retained as lineage only; their
     "Current state", "Only open gate" and "Exact next action" text is SUPERSEDED. Authoritative
     records: the `AFLDB-ISSUE-107` and `AFLDB-ISSUE-108` entries in `issues.md` (both
     Resolved 2026-08-30), `issues/closed/AFLDB-ISSUE-107.md` "Gates" and `issues/closed/AFLDB-ISSUE-108.md` §12.

     ISSUE-108 final validation — Linux, exact commit 673f0e3, Node v22.23.2 / npm 10.9.8,
     `npm test -- --no-file-parallelism`: 89 passed / 5 skipped test files (94), 2,515 passed /
     104 skipped tests, 0 failures, 122.21 s. `afldb_test` was NOT rebuilt and was never stale.

     ISSUE-107 final gate state: G0 PASS, G1 PASS, G2 PASS, G3 PASS, G4 PASS; G5 (production
     eligibility) is out of ISSUE-107's scope by design and is NOT a completion condition.
     Production rollout is separate work under its own review and is NOT authorised by this
     resolution. `AFLDB-ISSUE-109` was open and separate at that checkpoint; it is now
     Resolved (2026-08-30), with its runbook in `issues/closed/AFLDB-ISSUE-109.md`.

## AFLDB-ISSUE-107 — Next.js 16 framework/runtime upgrade (RETIRED)

- **Severity:** Medium
- **Area:** Framework / Runtime / Deployment
- **Runbook:** `issues/closed/AFLDB-ISSUE-107.md`.
- **Current state:** Open; deployed to Linux development on 2026-08-29 and proven live.
  Commit `be2a963` on `dev`, Node `v22.23.2`, Next `16.3.1`, React/ReactDOM `19.2.8`, Webpack.
  Typecheck 0 errors; the Webpack build completed page collection, 1,499 static pages and
  complete standalone output; `deploy/sync-dev.ps1 -Issue107Gate` exited 0; live
  `x-afldb-build` equals BUILD_ID `uZReW8G1XnsGnG5FNYY-I`; systemd active with four
  `next-server (v16.3.1)` workers at `AFLDB_WORKERS=4`, `AFLDB_POOL_MAX=10`,
  `AFLDB_TRACE_REQUESTS=on`; `/api/health` ok; 17/17 focused live routes clean with zero
  console, page and hydration errors. The `/sitemap.xml` question is closed: no duplicate-route
  warning in the production build, and its 404 is the intended `AFLDB_INDEXING`-off behaviour.
- **Key files/subsystem:** `deploy/sync-dev.ps1` (four gate-integrity repairs: nvm Node
  selection, base64 remote transport, server-side `$(…)` evaluation, sudo-less systemd restart);
  the dev host `.env` (`AFLDB_POOL_MAX=10` added).
- **Only open gate:** G2's guarded database integration. 33 stable failures against `afldb_test`
  are content failures with no framework surface — tracked as `AFLDB-ISSUE-108`, not as an
  ISSUE-107 regression.
- **Dev migrations applied 2026-08-29:** on operator instruction, `071`–`077` were applied to
  `afldb_dev` via `npm run db:migrate` after confirming the target database, the absence of
  `AFLDB_PROD_DATABASE_URL` and the 70/77 starting status. Now **77/77, 0 pending**, no checksum
  drift, no privileges reconciliation required, production untouched. Smoke: `/api/health` ok;
  `/admin`, `/admin/data-editor`, `/admin/current-season` all 307 to login with no 500; live
  `x-afldb-build` unchanged at `uZReW8G1XnsGnG5FNYY-I` with no restart or rebuild. Applying `073`
  exposed `AFLDB-ISSUE-109`.
- **Stop conditions:** unexplained React/dependency expansion, simultaneous bundler change,
  semantic/security regression, unreproducible framework controls, live build mismatch,
  reduced concurrency, or any unexplained hydration/client error in ISSUE-068 acceptance.
- **Exact next action:** hand BUILD_ID `uZReW8G1XnsGnG5FNYY-I` on `http://10.0.40.100:8090` to
  ISSUE-068 for its 1,440-row acceptance at 4 Playwright workers (`NL_UI_WORKERS` unset).
  Re-run guarded integration once ISSUE-108 restores `afldb_test`. Do not resolve either issue
  before its owned gates pass, and do not roll out production.

## AFLDB-ISSUE-108 — the guarded test contract predates the canonical legacy-free `afldb_test` (RETIRED)

- **Severity:** Medium
- **Area:** Test database / Data integrity / Tooling
- **Runbook:** `issues/closed/AFLDB-ISSUE-108.md` (authoritative).
- **Current state:** Open; **Path A complete, all 33 stable failures classified, awaiting the
  serial guarded re-run on Linux dev.** Root cause corrected — `afldb_test` (77/77) already matches the accepted canonical
  baseline `full-history-20260827` exactly on every gated value (`player_match_rows` 685,471,
  `players_with_dob` 855, AFL Tables identities 13,275). The 33 failures are a **stale test
  contract** — legacy-SQLite `IMMUTABLE` pins (694,210 `player_match_stats`, 79,113
  `brownlow_season_votes`, 12,478 DOB, 3,459 DraftGuru links, 269-player cohorts) and
  DOB/DraftGuru-B3 enrichment passes the canonical rebuild does not run — plus 3 shared-`afldb_test`
  parallelism flakes. `afldb_test` was **not** rebuilt.
- **Not a framework issue:** every failing file imports nothing from `next`, `react` or
  `src/app`; confirmed on Next 16.3.1 / React 19.2.8 / Node v22.23.2.
- **Changes made (Path A):** Class-A re-pins/skips in `tests/integration/release-gates.test.ts`
  and `database.test.ts` (each skip links its owning gap: `AFLDB-ISSUE-090` §27.5 for Brownlow,
  DraftGuru B3, `AFLDB-ISSUE-099` for the 2026 provisional artefacts); manifest-hash
  cross-platform line-ending defect fixed (`data/reference/fitzroy-accepted-baselines.json`
  `manifest_sha256` → canonical LF hash, new `.gitattributes`, CRLF-tolerant test hashing,
  `tests/season-rollover.test.ts` literal); `src/db/queries/db-health.ts` "missing career row"
  check scoped to players with `player_match_stats`; `tests/integration/data-editor.test.ts`
  score-reversal fixture swaps goals & behinds; `tests/draftguru-acquisition.test.ts` CSV
  parity-oracle test `existsSync`-guarded; `vitest.config.mts` `fileParallelism: false`.
- **Second defect (the last 7 failures, `issues/closed/AFLDB-ISSUE-108.md` §9.4):** the canonical rebuild
  **re-seeds `players.id`** — `import_fitzroy_core.py` inserts with no `legacy_player_id` and
  resolves identity by AFL Tables profile URL; measured 13,277 players, 0 with a
  `legacy_player_id`. Every legacy ID pinned in the suite now addresses a different person
  (788 → Arthur Ford, 2520/2521 → Campbell Gray/Heath, 1105/567 → Ben King/Andrew Foster). The
  protected people are intact, so this is obsolete addressing, not identity corruption — and two
  of those gates were *passing* on the wrong people. All affected gates re-anchored to the data
  (surname lookup discriminated by career facts); the 1960s/two-club exact-membership digest
  re-based from an ID-set hash onto the durable AFL Tables identity (110 keys →
  `4b4c6a2aa975cc17`); cohort counts re-pinned 117 → 115 and 222 → 219, entailed by exact
  fact→derived aggregate agreement with the accepted 685,471-row baseline; the decided-season
  Brownlow genuine-zero gate retired under `AFLDB-ISSUE-090` §27.5 as structurally unreachable
  without a season-grain writer.
- **Known follow-up, not in scope:** `tools/validation/validate_migration.py` and
  `tests/fixtures/oracle_baseline.json` are still bound to the retired legacy dataset and carry
  the same surrogate-ID defect. Outside the guarded vitest gate, so it does not block this issue.
- **Exact next action:** push; on Linux dev run `npm test` against the `afldb_test` DSN (serial is
  now the config default; `--no-file-parallelism` is redundant but harmless). When serial is green
  (or every residual is an accounted-for skip), mark Resolved and set `AFLDB-ISSUE-107` G2 to
  PASS. Neither before that run passes.

     DONE 2026-08-30 — that run passed (89/5 files, 2,515/104 tests, 0 failures, 122.21 s at
     commit 673f0e3). ISSUE-108 Resolved, ISSUE-107 G2 PASS, ISSUE-107 Resolved.
-->


<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-077` is **Resolved** (2026-08-26) and is NO LONGER an
     open issue. The detail block below is retained as lineage only: its "Current state" and
     "Next action" text is the pre-resolution index text and is SUPERSEDED. Authoritative
     record: the `AFLDB-ISSUE-077` entry in `issues.md` (Status: Resolved, Resolved:
     2026-08-26). Root cause: `saveSiteSettings` revalidated only four paths, so statically
     generated pages kept serving a stale root layout and the client router flipped the theme
     on navigation between a revalidated and a stale page. Fix: `revalidatePath('/', 'layout')`
     in `src/app/admin/settings/actions.ts`, invalidating the whole root-layout cache boundary
     in one operation. Validation: `tests/admin-settings-actions.test.ts` 1/1, asserting the
     exact call and that it is the only revalidation issued. This block was left uncommented
     when the issue was resolved and was retired by the 2026-08-28 ledger reconciliation.

## AFLDB-ISSUE-077 — Frontend theme changes unpredictably during a user session (RETIRED)

- **Severity:** Medium
- **Area:** UI/Settings
- **Key files:** `src/db/queries/site-settings.ts`, `src/app/layout.tsx`, theme/layout components, and any client-side theme initialisation/storage code.
- **First wrong layer:** UI/settings state propagation or cache consistency.
- **Current state:** A theme selected by a super admin is not stable during ordinary browsing. One public page can render with the configured theme and the next internal navigation can render a different theme without any settings change. This is separate from ISSUE-072, which only covers the stale `frontendTheme` default-shape test.
- **Next action:** Trace every `frontendTheme` authority and cache boundary (database, admin mutation/revalidation, SSR layout, cookie/local storage, hydration), reduce them to one authoritative resolved theme, then add browser coverage that navigates across multiple routes and proves the theme remains unchanged until a super admin deliberately changes it.

-->




<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-086` is **Resolved** and is NO LONGER an open issue. The
     detail block below is retained as lineage only, and its "unapplied", "1/2" and "next action"
     text is SUPERSEDED. The reopening was solely the missing supporting index on
     `data_overrides(admin_user_id) -> auth_users(id)` omitted by migration 073 — never a defect
     in the durable admin-override behaviour, which remains validated by
     `tests/data-overrides-source-contract.test.ts` 6/6 and
     `tests/integration/draftguru-import.test.ts` 19/19 (an admin override surviving a destructive
     source reload under the restricted importer role). Repaired forward-only in migration 075
     with 073 untouched after application; 075 held until 074 could apply first; 074 then 075
     applied cleanly; ledger 75/75, 0 pending, no drift; `tests/integration/fk-indexes.test.ts`
     2/2; privileges reconciled; `afldb_test` fingerprint
     `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`. All evidence is from
     `afldb_test`; no production or `afldb_dev` application is claimed. Authoritative records:
     the `AFLDB-ISSUE-086` entry in `issues.md` and `issues/closed/AFLDB-ISSUE-086.md`.

## AFLDB-ISSUE-086 — Durable admin overrides: `data_overrides(admin_user_id)` is an unindexed foreign key (RETIRED)

- **Severity:** Medium
- **Area:** Admin / Data integrity
- **Key files:** `src/db/migrations/073_data_overrides.sql` (applied,
  checksum-baselined, **must not be edited**);
  `src/db/migrations/075_data_overrides_fk_index.sql` (**applied to `afldb_test`
  2026-08-28, after 074; now checksum-frozen — must not be edited**);
  `tests/data-overrides-source-contract.test.ts`;
  `tests/integration/fk-indexes.test.ts` (read-only here);
  `issues/closed/AFLDB-ISSUE-086.md` (runbook, durable source of truth).
- **First wrong layer:** Database schema (migration 073).
- **Current state:** REOPENED 2026-08-28. The durable-override fix itself is
  validated and unchanged: checksum-baseline repair completed successfully; the
  clean rebuild through migration 073 passed **13/13** final validation;
  migration status **73/73, 0 pending, no drift**; DB-free source contract
  **6/6**; restricted-role DraftGuru integration **19/19**. Reopened for a
  separate proven defect: migration 073 declares
  `admin_user_id integer NOT NULL REFERENCES auth_users(id)` but indexes only
  `(entity_type, entity_key)`, so `tests/integration/fk-indexes.test.ts` was
  **1/2** on `data_overrides(admin_user_id) -> auth_users` and a parent-side
  `auth_users` delete sequentially scans `data_overrides`. Migration 075 is the
  forward repair (`CREATE INDEX IF NOT EXISTS ix_data_overrides_admin_user_id
  ON data_overrides (admin_user_id);`) and is **APPLIED to `afldb_test`**:
  `AFLDB-ISSUE-096` applied **074 then 075** in that order on 2026-08-28
  (75 files, 75 applied, 0 pending, no drift; privileges reconciled), and
  `tests/integration/fk-indexes.test.ts` is **2/2**, validating ISSUE-096's three
  074 FK indexes and this issue's `ix_data_overrides_admin_user_id` in one pass.
- **Exact next action:** *(The previous action — "repair ISSUE-096's migration
  074 first, then apply **074 then 075**, then re-run
  `tests/integration/fk-indexes.test.ts` and expect 2/2" — was executed on
  2026-08-28 and passed.)* The unindexed-FK defect is repaired and
  database-validated. **Whether that closes `AFLDB-ISSUE-086` is this issue's own
  decision** — `AFLDB-ISSUE-096` synced the proven facts only and changed no
  status, scope, ownership or historical conclusion. Migrations 073, 074 and 075
  are all applied and checksum-frozen: do not edit any of them, and do not
  renumber 075.

-->

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-090` is **Resolved** and is NO LONGER an open issue.
     The detail block below is kept as lineage only. Every "Current state", "Next action"
     and HALT line in it is SUPERSEDED. Authoritative records: the `AFLDB-ISSUE-090` entry
     in `issues.md` (Resolution, 2026-08-28) and `issues/closed/AFLDB-ISSUE-090.md` §27. -->

## AFLDB-ISSUE-090 — DOB enrichment conflict writes are not pass-scoped or idempotent (RETIRED)

- **Status:** **Resolved 2026-08-28.** Final validation, operator-run against the
  canonically rebuilt `afldb_test`: DOB reconciliation suite **27/27** · canonical
  external-identity release assertion **1/1** (63 skipped; pin **13,275**) · privileges
  **24/24** with **no grant widened**. Resolved against the amended standard at
  `issues/closed/AFLDB-ISSUE-090.md` §27.4. **The full `release-gates.test.ts` suite is NOT green** —
  Gate 1 was 42 passed / 22 failed; the 16 unrelated failures keep their own owners and were
  left unchanged.

- **Severity:** Medium
- **Area:** Data integrity / Import
- **Key files:** `tools/migration/enrich_birth_dates_from_club_lists.py` (`:412-432`),
  `tools/migration/enrich_birth_dates.py` (`:407-412`),
  `src/db/migrations/072_dob_conflict_ownership.sql` (new),
  `tests/integration/dob-enrichment-issues.test.ts` (new)
- **Runbook:** `issues/closed/AFLDB-ISSUE-090.md` — durable source of truth. Planning COMPLETE/APPROVED;
  **implementation COMPLETE and validated 2026-08-28** (§27.4 standard, §27.6 resolution) —
  the "implementation IN PROGRESS" text that stood here is superseded lineage.
  Migration 072 APPLIED to `afldb_test`
  (`db:status` 72/72, 0 pending). `dob-enrichment-issues.test.ts` post-migration rerun
  GREEN 23/23 (fixed a test-harness bigint/string assertion defect on the way, not a
  migration defect). `AFLDB-ISSUE-091`'s migration-checksum blocker is Resolved.
- **Current state (SUPERSEDED 2026-08-28 by the Gate 1 result below; retained as lineage):**
  `release-gates.test.ts` validation was HALTED; **the halt is LIFTED as
  of 2026-08-28**. The intended duplicate-`dob_conflict` gate is GREEN (the fix ISSUE-090 set
  out to make). Two unrelated `external_identities` gates had flipped green→red (expected
  12,472 `afltables_profile_url`/`unique` rows, found 0) — root-caused to a pre-existing
  importer defect in `enrich_birth_dates.py` exposed by this issue's own new regression
  suite, **not** to migration 072 (conclusively ruled out — see `issues/closed/AFLDB-ISSUE-090.md`). That
  defect was tracked as **`AFLDB-ISSUE-092`**, which is now **Resolved** (fail-closed
  population gate + `--source-key` containment, validated 27/27 on 2026-08-28), and the
  emptied population was restored to **13,275** by the 2026-08-27 canonical rebuild. The
  0-row condition is gone; what remains is whether the 12,472 pin is still the right expected
  value — an ISSUE-090 decision. This issue is **OPEN and unblocked**, not resolved.
- **Approved decisions:** D1 identical resolved recurrence suppressed (assertion-specific);
  D1a no `recurrence_of`; D2 targeted partial unique index; D3 equivalent
  `dob_internal_conflict` invariant; D4 `external_identity_conflict` is follow-up;
  D5 recompute `players.dob_disputed`.
- **Gate 1 result (2026-08-28):** `release-gates.test.ts` — **64 tests, 42 passed, 22
  failed**, every failure classified in `issues/closed/AFLDB-ISSUE-090-HANDOFF.md` §11.3. **ISSUE-090's own
  duplicate-`dob_conflict` invariant (`:497-507`) is GREEN.** Six failures touched this
  issue: the one stale pin (repaired) and five `gate: birth dates` population assertions
  (retired as acceptance). The other 16 are owned by `AFLDB-ISSUE-095` (3),
  `AFLDB-ISSUE-093`/DraftGuru B3 (2), `AFLDB-ISSUE-096`/`-098`/`-099` (2), rebuild-baseline
  drift (4) and two unowned gaps (5) — **left unchanged.**
- **The one repair:** `tests/integration/release-gates.test.ts` `gate: birth dates` →
  `matches players on the profile URL rather than the name`, `12_472` → `13_275`. A
  **test-baseline repair caused by the canonical rebuild, not a data change** — live
  `afldb_test` 13,275, accepted baseline `measured.players` 13,275,
  `identity_scan.distinct_urls` 13,275, `missing_url`/`malformed_url` 0, Stage 9 PASSED.
  12,472 was the retired `AFLDB_LEGACY_SQLITE` register population. **The
  `player_birth_evidence` 12,472 pin was NOT re-pinned** — a different population, live 855.
- **Acceptance amended (`issues/closed/AFLDB-ISSUE-090.md` §27):** ISSUE-090 no longer has to recreate the
  old 12,478-player enriched DOB snapshot. The canonical rebuild invokes neither enrichment
  pass; `players_with_dob: 855` / `players_with_dob_conflict: 0` are the accepted baseline's
  own contracted figures; the register pass requires `AFLDB_LEGACY_SQLITE` **and** would
  resolve zero players because nothing canonical writes `players.legacy_player_id`; the
  club-list pass's CSV directory is gitignored and absent. Old requirement preserved as
  lineage at §27.3; revised standard at §27.4.
- **Next action — NONE. SUPERSEDED, retained as lineage.** This bullet read *"run
  `npm test -- tests/integration/privileges.test.ts` (Gate 2) … This issue remains **OPEN**
  until Gate 2 passes."* Gate 2 was run on 2026-08-28: **24/24 PASS, no grant widened.** With
  that, every item of the `issues/closed/AFLDB-ISSUE-090.md` §27.4 standard is met and the issue is
  **Resolved**. There is no outstanding ISSUE-090 action.

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-092` is **Resolved** and is NO LONGER an open issue.
     Its index row and detail block have been removed from this open-issues-only file.
     Authoritative records: the `AFLDB-ISSUE-092` entry in `issues.md` and
     `issues/closed/AFLDB-ISSUE-092.md` §17 (§17.1 implementation verification, §17.2 recovery superseded
     by rebuild, §17.5 acceptance validation).

     Outcome: the fail-closed `external_identities` population-drop gate
     (`check_population_drop()` in `tools/migration/common.py`, reused by
     `import_fitzroy_core.py`) plus `--source-key` containment were implemented 2026-08-25
     and VALIDATED 2026-08-28 — `npm test -- tests/integration/dob-enrichment-issues.test.ts`
     **27/27, no skips**, tests 24–27 executed and green. §6 recovery of the emptied test
     database was superseded by the 2026-08-27 canonical rebuild, which repopulated the
     AFL Tables identity population to **13,275** through the gated import path.

     The historical incident (a one-row synthetic register wiping the real 12,472-row
     population via `dob-enrichment-issues.test.ts` test 5) is preserved in full in
     `issues.md` and `issues/closed/AFLDB-ISSUE-092.md` §1/§2 and must not be erased.

     Downstream: `AFLDB-ISSUE-090` is UNBLOCKED but still OPEN, listed above. Its two
     external-identity release gates are pinned at the stale legacy-derived 12,472 against a
     canonical 13,275; that re-pin is an ISSUE-090 decision and 12,472 must not be silently
     reinstated. -->

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-095` is RESOLVED. Retained as lineage only; it is
     NOT an open issue and its "next action" text is SUPERSEDED. See `issues.md` and
     `issues/closed/AFLDB-ISSUE-095.md` §14.

## AFLDB-ISSUE-095 — Canonical legacy-free ladder / team-season acquisition

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Key files:** `issues/closed/AFLDB-ISSUE-095.md` (runbook, durable source of truth);
  `tools/migration/rebuild_derived.py` (`REBUILDS["club_seasons"]`, `:312`);
  `tools/migration/import_legacy_afl.py` (`:767`, `:776`, `:795`, `:996`, `:1021`);
  `src/db/migrations/006_draft_relationships.sql` (`:55-80`);
  `src/db/queries/player-derived.ts` (`recomputeClubSeasons`, `:402-411`);
  `tools/db/rebuild-test.ts` (Stage 9); `data/reference/sources.json`
- **Current state:** OPEN, nothing implemented. Proven during ISSUE-093's first complete
  canonical clean rebuild (`issues/closed/AFLDB-ISSUE-093.md` §H15.5): `club_seasons` is built **only** from
  `staging.team_seasons`, whose **only** writer is `import_legacy_afl.py` under
  `AFLDB_LEGACY_SQLITE`. The canonical rebuild deliberately has no legacy staging-load stage,
  so `club_seasons = 0` is the *expected* outcome of a legacy-free rebuild, not a defect in it.
  Degraded while empty: ladders, premiership/wooden-spoon flags, finals counts and club-season
  NL answers (`clubs.ts`, `seasons.ts`, `rounds.ts`, `grid-solver.ts`, `search.ts`,
  `db-health.ts`, `player-derived.ts`, `nl/club-season.ts`, NL `parser`/`plan`/`vocab`,
  `lib/edit/spec.ts`). Also note `recomputeClubSeasons` fails closed on an empty
  `staging.team_seasons`, so match create/delete/score-edit throws for every season on a
  canonically rebuilt database — by design, not a new defect.
- **DB-free validation: GREEN for this issue** (`issues/closed/AFLDB-ISSUE-095.md` §12) — 309 passed,
  6 skipped, plus the resolver contract 37/37. The single remaining failure,
  `reference-data.test.ts` → `finds the tables created after 045 that never registered
  import write`, is **`AFLDB-ISSUE-096`/`-086` drift** from migrations 073/074
  (`data_overrides`, `promotion_decisions`) and was deliberately left untouched: repairing
  it asserts a privilege decision that belongs to ISSUE-086's blocked manual-authority
  contract.
- **Witness acquired and validated (`issues/closed/AFLDB-ISSUE-095.md` §13).** `ladder-20260828`,
  129 files / 1,622 rows, pinned in the contract by `accepted_witness` + manifest sha256.
  New single-authority validator `tools/rebuild/fitzroy/validate_ladder_witness.py`
  (26/26 offline, no DB, no network); D7 cross-check wired as a tenth **validation** stage
  (`ladder-witness`, between `derived` and `fingerprints`) — the four-stage **data**
  topology is unchanged and now asserted. Durability reuses ISSUE-093's convention:
  bytes gitignored, manifest tracked, PRECHECK refuses before destruction — proven by
  execution (exit 2 with bytes absent, 0 restored).
- **Exact next action:** the clean `afldb_test` rebuild — a **separate authorisation**, and
  the only thing that can prove the D7 cross-check. It is a **full destructive recreate**
  of `afldb_test`. **ZERO supported `AFLDB_LEGACY_SQLITE` dependency.**
- **Do NOT** add a `club_seasons` non-zero Stage-9 gate until this lands — it would fail every
  canonical rebuild over a known, deliberate gap.
- **Links:** `AFLDB-ISSUE-093` (Resolved 2026-08-27, this issue is its recorded follow-up) and
  `AFLDB-ISSUE-015` (Resolved 2026-08-22, per-season `recomputeClubSeasons` parity) —
  **linked, not absorbed**; ISSUE-015's status is unchanged.

<!-- RETIRED 2026-08-28 — `AFLDB-ISSUE-096` is **Resolved**, complete within its authorised S1–S4
     scope. The detail block below is retained as lineage only. It is NOT an open issue, and its
     intermediate "UNAPPLIED", "BLOCKED", "not yet run" and "next action" text is SUPERSEDED:
     migration 074 is applied and checksum-frozen (074 before 075, 75/75, 0 pending), and the
     final validated evidence is source contract 106/106, spine suite 13/13, FK gate 2/2,
     privileges 24/24, fingerprint
     `c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`.
     Authoritative records: the `AFLDB-ISSUE-096` entry in `issues.md` and `issues/closed/AFLDB-ISSUE-096.md`
     §16.16–§16.17. The remaining §5.H partial and blocked rows are NOT unfinished ISSUE-096 work:
     they are either consequences with no code to exercise until a future persistence/accept path
     exists, or downstream capabilities owned by `AFLDB-ISSUE-086` (manual authority),
     `AFLDB-ISSUE-099` (the `data_issues` disagreement row) and
     `AFLDB-ISSUE-101` (rollover supersession), all of which remain open above.

-->

## AFLDB-ISSUE-096 — 2026+ API-first acquisition architecture and contract (RETIRED)

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `issues/closed/AFLDB-ISSUE-096.md` — **durable source of truth for this issue**.
  `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` is the parent investigation runbook (§4, §9 row A, and §13 for
  the dated P1–P7 probe results).
- **Key files:** `data/reference/source-families.json` (new, S1),
  `src/lib/acquisition/source-families.ts` (new, S1), `tests/reference-data.test.ts` (extended);
  `src/db/migrations/074_source_observation_spine.sql` (new, S2, **applied to `afldb_test`**),
  `tests/integration/observation-spine.test.ts` (new, §5.H schema half),
  `src/lib/acquisition/observations.ts` (new, S2), `src/lib/acquisition/reconciliation.ts`
  (new, S3), `tests/current-season-import.test.ts` (extended, S2+S3);
  orientation only: `src/lib/external-afl/current-season-import.ts`,
  `src/db/migrations/063_external_current_match_sources.sql`, `064_matches_external_provenance.sql`
- **Approval:** **HALT LIFTED 2026-08-28.** Decisions A–H and the §12 items approved and recorded
  verbatim in `issues/closed/AFLDB-ISSUE-096.md` §14: three-grain observation model; retain
  `staging.external_current_matches`; **no automatic canonical promotion in v1**; ISSUE-086
  authority boundary is interface-and-invariant only; Kali sits in the Squiggle independence group;
  **P1/P2/P7 are not retried** and no local database substitutes for P7. The issue is now
  foundation implementation S1–S4; family importers remain excluded.
- **S1 IMPLEMENTED (2026-08-28):** tracked source-family registry + pure fail-closed typed parser
  + DB-free contract tests. **Seven** families over four sources; **no family is promotable**;
  AFL API lineup columns deliberately `incomplete` so a round-20 payload refuses;
  `afltables.player_match_stats` and `kali_afl_stats.player_stats` are `identity_only`. No
  migration, no importer, no `sources.json`/`seasons.json` change.
- **P1/P2 RE-RUN 2026-08-28 (user supplied `KALI_AFL_API_KEY` and authorised the retry) — both
  PASS, and P1 AMENDED S1.** Kali `/matches` is **not** a Squiggle proxy: a genuine value
  disagreement on a completed match (Essendon v Port Adelaide 2026-08-23, Kali 95–105 vs
  Squiggle 95–104 at `complete=100`), `crowd` on 80/204 rows where Squiggle has no attendance
  field, 0 shared ids, a different venue vocabulary on 80/160 joined games, no goals/behinds.
  `kali_afl_stats.match` therefore moved to its own `kali` group and to a fully declared
  14-column shape (`sourcedAt` = `source_updated_at`, new `kali_2026` round vocabulary);
  `/fixture` stays a proven proxy in the `squiggle` group. **P2:** no player id on the Kali stat
  grain, so a new `kali_afl_stats.player_stats` family records the gap as `identity_only`.
  **Residual, flagged for review:** P1 disproves *pairwise* derivation; a *common ultimate
  upstream* is not excluded. **P7 stays BLOCKED; no local database substitutes for it.**
- **Current state:** Evidence baseline established 2026-08-28:
  **P3/P4/P5/P6 PASS**, **P5 stop condition NOT triggered** (`url` is 0 NA and 1:1 with `ID`, but
  **`ID` is 82 NA in-season — key on `url`**); **P1/P2 BLOCKED**, no `KALI_AFL_API_KEY`;
  **P7 BLOCKED**, SSH refused and **no database queried**. Contract drafted: three observation
  grains (immutable payloads / ordered versions / current-key state, so A→B→A stays three ordered
  states while repeat polling stays idempotent), reconciliation verb set, reviewed-promotion
  contract with a stale-review recheck, source containment, independence groups, season lifecycle.
- **S2 IMPLEMENTED (2026-08-28), DB-free suite GREEN, migration still unapplied:** `src/db/migrations/074_source_observation_spine.sql`
  (**unapplied**) — three observation grains + `promotion_candidates` + append-only
  `promotion_decisions`; `src/lib/acquisition/observations.ts` (pure: no DB/fs/network/clock);
  `tools/maintenance/privileges.sql` registered so the append-only grant survives a reconcile;
  28 DB-free tests. A→B→A stays three versions over two payloads because history is keyed
  by `version_seq` and **never** unique on `payload_hash`. Acceptance fails closed, and manual
  authority `indeterminate` refuses exactly as `conflict` does.
- **Validation 2026-08-28, three runs: 59/61 (FAILED) → 61/61 (PASSED) → post-hygiene 61/61,
  0 failures, 303 ms (PASSED). S2 IS COMPLETE AND GREEN.** All behavioural tests passed every
  time. The two red assertions
  (`:653` append-only grants, `:668` history uniqueness) were **confirmed false positives**:
  `[^;]*` is not a SQL statement boundary, so both regexes spanned the migration's own
  explanatory comments. Only the **tests** were repaired — a `sqlStatements()` helper strips
  `--` comments and splits on `;`, and the assertions now pin the complete set of executable
  GRANTs on `promotion_decisions` and the single `UNIQUE` statement on the versions table.
  Migration unchanged, no invariant weakened (`issues/closed/AFLDB-ISSUE-096.md` §16.3).
- **S2 hygiene FIXED 2026-08-28 (§16.4):** the two literal NUL bytes in `observations.ts:499`
  are now `U+0000` escapes — **same character, so `observationKey()` output is byte-identical**;
  the runbook's suggested "plain space" separator was NOT adopted, as it would change runtime
  semantics and let a value containing a space make a key ambiguous. Header corrected to
  "migration 074". `073_data_overrides.sql` (ISSUE-086) still observed, not investigated (§16.5);
  `privileges.sql:294`'s "Migration 073" is ISSUE-086's and is correct.
- **S3 COMPLETE and GREEN 2026-08-28 — user-run `npm test -- tests/current-season-import.test.ts`:
  `84/84`, 0 failures, 316 ms.** `src/lib/acquisition/reconciliation.ts` (new, pure: imports only
  `./observations` and `./source-families`) computes exactly Decision C's ten verbs from a live
  payload against the stored open version, precedence exported as `VERB_PRECEDENCE`:
  `stale_review → absent → unchanged → unresolved_identity → foreign_owned_collision →
  source_disagreement → manual_authority_conflict → new / rescheduled / corrected`. Structural
  evidence resolves before content; refusal gates run only when a canonical change is actually
  proposed; `unchanged` comes only from the family hash contract; `rescheduled` stays distinct from
  `corrected`; `absent` is observation state and never deletion; `source_disagreement` needs
  disagreeing **independence groups**, not two source rows; foreign **or unreadable** ownership
  fails closed **before** authority is asked; provider agreement never substitutes for authority;
  `conflict` and indeterminate authority both fail closed; no database/network/filesystem/clock/
  write path, and no force, override or consensus shortcut.
- **`history_only` — settled S3 outcome, not an eleventh verb.** A changed payload that advances
  history but moves **no projected canonical fact field** (Squiggle completion `90 → 100`) returns
  `history_only`: not in `RECONCILIATION_VERBS`, not a candidate verb, not a canonical change —
  history advances with no fact-level proposal. Calling it `unchanged` would erase a real
  source-state transition; calling it `corrected` would propose a candidate with no changed fields.
  Do not redesign unless S4 integration evidence contradicts it.
- **S4 IMPLEMENTED 2026-08-28, AWAITING VALIDATION (§16.10).** New pure module
  `src/lib/acquisition/promotion-review.ts`: the candidate record with migration 074's CHECK
  constraints enforced in TypeScript; `baselineCanonicalHash` over **exactly the proposed fields**
  (`sha256/v1(canonical-fields)`, sorted names, sorted keys at every depth, 64 hex chars, null for a
  `new` target, refusal on an unread field); `renderReviewItem`; `evaluateAcceptRequest`; the
  requeue/supersede rule; and reject/requeue decision drafts. Render and accept both run
  `runPromotionGates`, which recomputes the baseline from re-read values and then delegates to
  **S2's `evaluateAcceptance`** — gate order and the `stale_review` / `stale_canonical_target`
  distinction unchanged. `stale_canonical_target` ⇒ re-render in place (stays pending);
  `stale_review` ⇒ **supersede** so reconciliation can insert the replacement. One additive,
  behaviour-preserving change to `observations.ts`: the canonicaliser is hoisted and exported as
  `canonicalJson`, because a family's payload `hash_exclusions` must never be applied to canonical
  values. 20 DB-free tests added to `tests/current-season-import.test.ts`.
- **§7 gate INTACT and enforced by construction.** `PromotionDecisionDraft` has **no `'accept'`
  decision** and typed-`null` value columns, so S4 cannot represent an acceptance; a cleared
  evaluation returns `write: { implemented: false, blockedBy: 'canonical_write_unimplemented' }`
  with `canonicalChange: 'none'`. Under `UNAVAILABLE_MANUAL_AUTHORITY` every promotable verb —
  `new` included — refuses. **Blocked pending ISSUE-086:** the canonical acceptance transaction
  (write + provenance quartet + `accept` decision row) for `corrected`/`rescheduled` onto an
  existing row. No force flag, override, bypass or consensus shortcut added.
- **Checkpoint — all four approved stages complete:** S1 `34/34`, S2 `61/61`, S3 `84/84`, **S4
  complete and green `105/105`** (0 failures, 357 ms, final post-hygiene run, user-run 2026-08-28).
  The **canonical acceptance/write transaction remains deliberately unimplemented** behind
  ISSUE-086's authority gate, and the S4 type/state model must **not** be read as evidence those
  writes exist. `history_only` remains settled as an observation-layer outcome only. Migration
  **074 UNAPPLIED**, with **no production and no `afldb_dev` database work** at any point.
  `AFLDB-ISSUE-100` remains separate. **No CHANGELOG entry** — nothing has landed behaviour.
- **NUL hygiene RESOLVED (§16.11).** Both `observations.ts` and `source-families.ts` carried a raw
  `0x00` where the intended value is U+0000. The assistant located the second one (the
  `parseSourceFamilyRegistry` duplicate-declaration machine key) but **could not repair it
  natively** and stopped for evidence; **the user verified (`cat -A` showed `^@`, proving the
  separator had not become a space) and performed the byte-level repair**, after which
  `grep -naP '\x00'` returned no matches and the suite stayed green. Runtime semantics unchanged.
  PostgreSQL `text` still cannot store U+0000 — a forward concern only if a later stage proposes
  persisting one of these composite machine keys.
- **Schema/migration gate GREEN 2026-08-28 (`issues/closed/AFLDB-ISSUE-096.md` §16.16).** The migration-073
  baseline blocker is **closed**; the §16.14 three-index repair landed in 074 before its first
  application; 074 and 075 were then applied in normal filename order — **074 then 075** — to
  **`afldb_test` only**. **75/75 applied, 0 pending, no drift**; privileges reconciled;
  `tests/integration/fk-indexes.test.ts` **2/2** (real-catalogue proof of ISSUE-096's three 074
  indexes and `AFLDB-ISSUE-086`'s `data_overrides.admin_user_id` at once); fingerprint
  **`c5afad8cd3e6ff6417e429807bd7dfb4f8da096a84d691e63383691438722227`**.
- **§5.H refreshed (§16.16 supersedes §16.15).** `src/lib/acquisition/` still has **no persistence
  layer**, so 074 created tables and not a writer for them. New suite
  `tests/integration/observation-spine.test.ts` drives the real `decideObservation`/`sweepAbsences`
  and applies each decision to `afldb_test`, reading each head **back out of PostgreSQL**; it
  proves the **schema half** of §5.H only. **2 fully executable** (A→B→A correction replay;
  absence ≠ deletion), **3 partial** (idempotence; foreign ownership; stale-review race),
  **3 BLOCKED** (manual authority — ISSUE-086; `data_issues` disagreement row — never implemented;
  rollover supersession — ISSUE-101, no supersession column in 074). **No canonical
  acceptance/write path exists or was added**; no blocked row was faked.
- **VALIDATION GREEN 2026-08-28 (user-run):** `tests/current-season-import.test.ts` **106/106**,
  `tests/integration/fk-indexes.test.ts` **2/2**, `tests/integration/observation-spine.test.ts`
  **13/13**. The FK gate validates the §16.14 source-contract FK repair in 074 and ISSUE-086's 075
  index together. The first spine run failed only on a **fixture** defect — the seed wrote
  `seasons.is_complete`, generated from `status` since migration 015 — which aborted ten cases in
  shared setup before their bodies ran; the seed now writes `status = 'in_progress'`, **no
  behavioural assertion changed**, rerun 13/13. **13/13 proves the implemented PostgreSQL/schema
  half of §5.H only** — not an importer and not a canonical accept transaction, neither of which
  exists. The three partial rows stay partial and the three blocked rows stay blocked.
- **Exact next action — the last ISSUE-096-owned validation gap:** 074's append-only-by-grant
  invariant on `promotion_decisions` now has catalogue coverage in
  `tests/integration/privileges.test.ts`'s existing append-only contract (positive `SELECT`/`INSERT`
  grant, plus no `UPDATE`/`DELETE`/`TRUNCATE` for `afldb_auth`); `privileges.sql` was inspected and
  **not changed**, its spec was already correct. **Run
  `npm test -- tests/integration/privileges.test.ts`. Do not close ISSUE-096 until it passes.**
- **Exact next action: none inside ISSUE-096 as approved.** §11 decomposes to S1–S4 and stops, so
  **there is no approved S5** — a next stage is a fresh approval decision (§16.12). Unbuilt work and
  blockers: (1) the canonical acceptance/write transaction — **blocked on `AFLDB-ISSUE-086`** by
  §7's gate; (2) applying migration 074 + the §5.H PostgreSQL tests — **not** ISSUE-086-blocked but
  a separate explicitly authorised step, **`afldb_test` only**; (3) the admin review screen — an
  explicit §2 **non-goal** of this issue. Do not apply migration 074 and do not implement
  ISSUE-086 here.
- **Manual-authority boundary:** ISSUE-096 defines only the invariant and the fail-closed
  interface; the **mechanism/storage (incl. `data_overrides`) belongs to `AFLDB-ISSUE-086`** and is
  not pre-empted. Promotion of `corrected` candidates onto existing rows is gated on that contract.
- **Unblocked by this evidence:** `AFLDB-ISSUE-099` (P5) and `AFLDB-ISSUE-100` (P3) are no longer
  probe-blocked. `AFLDB-ISSUE-098` remains independently actionable.
- **Do NOT** implement any family-specific importer here (`AFLDB-ISSUE-099`, `AFLDB-ISSUE-100`
  own those). Do NOT duplicate `AFLDB-ISSUE-086` or `AFLDB-ISSUE-095`.
- **Approved policy retained:** free sources only; fetch/staging/diff automatic; canonical
  promotion reviewed by default; lineups staging-only; in-progress season only; completed
  seasons re-acquired via the full-history fitzRoy path.

-->

## AFLDB-ISSUE-099 — In-season AFL Tables settle stage

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `issues/closed/AFLDB-ISSUE-099.md` — **durable source of truth, approved implementation
  contract.** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §2.4, §5, §9 row D, §13.5 is the parent
  investigation record.
- **Key files:** `tools/rebuild/fitzroy/acquire_core.R`, `fitzroy-contract.json`,
  `tools/migration/import_fitzroy_core.py`, `src/lib/acquisition/*`,
  `src/db/migrations/074_source_observation_spine.sql` (applied — **must not be edited**)
- **Current state:** OPEN, **in implementation on branch `claude/issue-099`**. **T1–T6
  COMPLETE.** Migration **076 applied and checksum-frozen — never edit it**, a defect needs a
  forward migration. T6 delivered `observation-store.ts` (behaviour-preserving extraction),
  `settle-afltables.ts` (pure contract + settle transaction), the review-first operator CLI, and
  the `tests/integration/settle-afltables.test.ts` gate. Final evidence: integration **13 passed
  / 1 conditional skip**, `current-season-import` **153/153**, typecheck at the exact pre-T6
  baseline (13 errors in 4 unrelated files, zero ISSUE-099), targeted ESLint 0/0. O1 proved over
  executable SQL + surviving sentinels; no canonical fact row written by any settle transaction.
  2026 still has no player-match statistics, period scores, attendance or Brownlow votes —
  v1 writes NO canonical row by design.
- **P5 — SUPERSEDED GATE.** The previous entry read *"implementation gated on probe **P5**.
  If P5 shows no stable `ID`/`url` for 2026, implementation is blocked."* **P5 ran
  2026-08-28 and PASSED; the stop condition was NOT triggered.** Do not rerun it. Binding
  result: `url` **0 NA** and 1:1 with populated `ID`; `ID` itself **82 NA** in-season.
  **Key on the stable `url`; never require `ID`; names are never identity.**
- **Superseded wording:** the "snapshot labelled `partial`" description is stale —
  `acquire_core.R` no longer emits a `partial` label. The in-season path is a third
  `acquisition_kind` (`in_season_partial`) with its own offline adjudicator.
- **Approved architecture:** in-season partial acquisition + SHA-256 manifest → deterministic
  Python→TypeScript observation bundle → migration-074 observation persistence → typed family
  projections → reconciliation → `promotion_candidates` → idempotent `data_issues` →
  dry-run/apply reporting. Families: `afltables.match` (→ `matches`, `match_period_scores`;
  attendance is a `matches` field) and `afltables.player_match_stats` (→ `player_match_stats`,
  `brownlow_round_votes`).
- **v1 canonical-write prohibition:** ZERO canonical INSERT/UPDATE and no `accept`
  `promotion_decisions` row. Acceptance is a separately approved later stage; its
  prerequisites are recorded at `issues/closed/AFLDB-ISSUE-099.md` §16.
- **Schema:** new forward migration **076** only — typed staging projections,
  `data_issues.issue_key` + partial unique index, FK-covering indexes, grants. Migrations
  073/074/075 are **not** edited.
- **Dependencies:** `AFLDB-ISSUE-096` Resolved (074 applied, checksum-frozen);
  `AFLDB-ISSUE-086` Resolved but entity-scoped — a prerequisite of the acceptance stage,
  **not** a v1 gate.
- **Exact next action:** **fresh session — start T7**: the `data_issues` writer / refresher /
  resolver with ownership scoping, plus §23.2 dry-run/apply counter reporting. Its gate extends
  `tests/integration/settle-afltables.test.ts`; no schema work is needed (076 already carries
  `data_issues.issue_key` + `uq_data_issues_open_by_key`, and the identity helpers are
  unit-tested). Then T8. Carried-forward constraints are in `issues/closed/AFLDB-ISSUE-099.md` "T6 — COMPLETE":
  restricted `afldb_import` role parity is a conditional matrix check for T8, and the bigint
  `batchId` type mismatch is separately tracked cross-issue debt — do not cast bigint to int.

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-100` is **Resolved** (see `issues.md`). The detail
     block below is retained as lineage only. It is NOT an open issue and its
     "exact next action" is SUPERSEDED: L1-L3B2 shipped, migration 077 is applied and
     checksum-frozen, and real 2026 R20/R25 validation passed with idempotent replay
     (468 and 104 rows; 0 canonical writes; all canonical FKs NULL by design).
## AFLDB-ISSUE-100 — Staging-only lineup / team-announcement domain

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §2.5, §9 row E, **§13.10 (P3b evidence)**.
- **Key files:** `data/reference/source-families.json` (`afl_api.lineup` family +
  `afl_api_2026` round vocabulary), `tools/rebuild/afl_api/` (`afl-api-contract.json`,
  `acquire_lineups.R`, `emit_lineup_bundle.ts`), `src/lib/acquisition/lineup-bundle.ts`,
  `tests/afl-api-lineup.test.ts`, `tests/reference-data.test.ts`; new
  `staging.external_lineups` and the `afl_api` `sources` row (migration **077**, not yet written)
- **L2 COMPLETE and GREEN 2026-08-29** — bounded acquisition + deterministic observation bundle,
  **still entirely DB-free**: no migration, no `sources` row, no staging table, no persistence,
  no absence sweep. Three durable **family-local** contracts now exist: `external_record_id` =
  `providerId|teamId|player.playerId` in declared key order, refusing a missing, blank,
  non-string or `|`-containing component rather than escaping it; `scope_key` =
  `season=<int>;round=<int>`; and enumeration `complete: false` **permanently**, typed as the
  literal `false` so widening it fails typecheck. A **separate** `tools/rebuild/afl_api/`
  source contract was created rather than adding a fourth acquisition kind to
  `fitzroy-contract.json`, whose `applies_to_source` is AFL Tables. Gates: `afl-api-lineup`
  **38/38**; four suites together **272 passed / 2 pre-existing skips**; typecheck at the exact
  13-error unrelated baseline with **zero** ISSUE-100 errors. Proven end-to-end on live
  upstream: R20 468×20 with `lateChanges`, R25 104×19 without; in the real R20 bundle 26 verbatim
  `lateChanges` rows and 442 present-and-null, captain `false` 468/468, jumper integers 1–51,
  every projection null; re-acquire → re-emit byte-identical.
- **Current state:** OPEN, **L1 COMPLETE and GREEN 2026-08-29** — source-family contract only.
  **No schema, no migration, no persistence, no database access.** Both gates
  are satisfied: **P3 PASS** (identity — `CD_M…`/`CD_T…`/`CD_I…`, cross-endpoint join measured
  26/26) and **P3b PASS** (shape/types/NULLs/completeness — R20 468 × 20, R25 104 × 19). The
  column P3 counted but never enumerated is **`lateChanges`**, and it is **conditional**, so
  R25's 19 columns are a strict subset of R20's 20. 0 NA except `lateChanges` (442/468), 0 blank
  strings, **0 duplicate external keys over 572 rows**, exact fixture↔lineup **match-set**
  equality in both rounds. Gates: `tests/reference-data.test.ts` **39 passed / 2 pre-existing
  Python-gated skips**; `tests/current-season-import.test.ts` **172/172**.
- **Approved rule — retained explicitly:** **lineups are staging-only and never become
  canonical participation.** Canonical participation remains the played match sheet. No public
  surface. `promotion_policy` is `never` and is test-pinned.
- **Binding limitations (decisions, not gaps):** **absence sweeping DISABLED** —
  `markMissingObservationsAbsent()` is never called for this family and `absent_since` is never
  set, because match-set completeness does not prove row-grain completeness; migration-074
  version/idempotence persistence is otherwise reused unchanged. **`player.captain` not
  projected** — `FALSE` for 572/572 across 11 matches and 22 team instances, a sentinel, and
  deliberately *not* declared zero-is-missing. **`lateChanges` verbatim, never parsed or
  name-matched** — conditional, nullable, **team-grain** free text with no provider player ids.
  **No closed enum CHECKs** on `status`/`teamStatus`/`teamType`/`compSeason.shortName`/`position`
  — measured vocabularies, not provider contracts. **`required_columns` stays at five.**
- **Still unknown, and design-binding:** whether rows reflect the team **before or after** a late
  change (n = 1); whether team player-rows are **row-grain complete** on every run.
- **Corrected by P3b:** §13.3's round-25 record implied a uniformly unconfirmed payload; R25 is
  **50/50 mixed at match grain**. Identity finding unaffected.
- **L3A COMPLETE 2026-08-29 — all three provider→canonical mappings are `none`.** `CD_M…`/
  `CD_T…`/`CD_I…` appear in no migration, query or lib outside ISSUE-100's own code, and
  `afl_api` appears in no migration at all. `external_identities`'s only writer is
  `import_fitzroy_core.py:2285`, hard-coded to `afltables`/`afltables_profile_url`, so no
  `afl_api` identity exists and no approved bridge populates one. **No mapping was created.**
  **Pre-match match identity is structurally unavailable:** `matches` requires NOT NULL
  scores/result/margin (migration 003), so an unplayed fixture cannot exist there and
  `match_id` can never be NOT NULL. **Club resolution is incomplete:** 12/18 R20 team names
  resolve against the loader-derived alias set; six are marketing forms and two match no field
  at all. The DB-backed measurement was **not run** — no `.env` and no DSN in this worktree;
  none was fabricated.
- **OPTION B approved and implemented:** provider identity is NOT NULL and is the row identity;
  `match_id`/`club_id`/`player_id` are nullable and in no key. Mirrors
  `staging.external_current_matches` (migration 063). `lateChanges` is **settled as
  raw-observation-only** — no column, no table, no parsing, test-pinned.
- **Migration 077 APPLIED and CHECKSUM-FROZEN 2026-08-29** — `afldb_test` only, identity proven
  `afldb_test|afldb_owner`, **77/77 applied, 0 pending**. Registers `afl_api` **fail-closed**
  (idempotent on an identical row, `RAISE EXCEPTION` on a conflicting one — not 060/063's
  blanket `ON CONFLICT DO UPDATE`) and creates `staging.afl_api_lineup`. `jumper_number` is
  `text` per AFLDB's schema-wide convention (004/025/076). Two pre-application corrections
  landed first: the source description now describes the provider and the **lineup family
  only** rather than binding every future `afl_api` family, and "unauthenticated" became
  "requires no operator-supplied API key". **Never edit 077 — a defect needs a forward
  migration.** Gate: `tests/afl-api-lineup-migration.test.ts` **22/22**.
- **L3B2 COMPLETE and GREEN 2026-08-29.** `src/lib/acquisition/lineup-store.ts` persists an
  emitted bundle through the **074 spine** via the shared `persistSourceObservation()` (no
  second observation system), then upserts the typed projection linked to the exact
  `version_seq` read back from PostgreSQL, all inside one `sql.begin`.
  `tools/rebuild/afl_api/persist_lineups.ts` is the operator entry point. Proven properties:
  **`source_id` resolved internally from the literal `'afl_api'`** (no `sourceId` on the
  signature or options; refuses when the key is absent; refuses another source's bundle);
  **unresolved `match_id`/`club_id`/`player_id` stay NULL and the row still persists**;
  **no absence sweep**; **no DELETE/TRUNCATE executable path** (keyed upsert only — a code
  property, since `privileges.sql` grants `afldb_import` both schema-wide); **no canonical
  participation write** (writes exactly `import_batches` + `staging.afl_api_lineup`); **no
  typed `lateChanges` or captain projection**. Validation: `afl-api-lineup-store` **16/16**
  DB-free, `integration/afl-api-lineup-store` **11/11**, and **restricted-role parity GREEN**
  under `AFLDB_TEST_IMPORT_DATABASE_URL` (identity `afldb_test|afldb_import`; first persist,
  idempotent replay, revision advance). DELETE/TRUNCATE were deliberately **not executed**
  under that role — the invariant is that the path never issues them.
- **Exact next action:** **bounded real R20/R25 persistence validation** against the
  acquisitions already on disk at `data/sources/afl_api/lineups/`, then final close-out.
  Everything so far ran on synthetic fixtures. ISSUE-100 stays **Open** until that passes;
  CHANGELOG is deliberately not yet updated. Canonical enrichment (`match_id`/`club_id`/
  `player_id`) remains deferred by decision — `match_id` is unresolvable pre-match by schema,
  club enrichment would need ISSUE-099's private name-based resolver (12/18 on R20), and no
  `afl_api` player bridge exists. Note `tests/integration/fk-indexes.test.ts` scans
  `nspname = 'public'` only, so it does **not** cover this staging table's FK indexes — they
  were added by reading, as migration 076's were.

-->

<!-- RETIRED 2026-08-29 — `AFLDB-ISSUE-101` is **Resolved** (the reusable mechanism; see
     `issues.md` for the authoritative resolution record). The detail block below is retained
     as lineage only. It is NOT an open issue and its "not yet validated" / "Exact next
     action" text is SUPERSEDED: the focused suite is 131/131, the broader regression is
     5/5 suites / 472 passed / 6 existing skips, and
     `tests/python/ladder_identity_contract.py` passed every executable check (acquired
     witness bytes skipped — gitignored by design). **No season was rolled**, and actual
     2026 -> 2027 execution is intentionally deferred until the season is formally complete
     and genuine completed-season evidence exists.

## AFLDB-ISSUE-101 — End-of-season promotion / baseline rollover (RETIRED)

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture / Data integrity
- **Runbook:** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §5 (rollover row), §9 row F.
- **Key files:** `src/lib/rollover/season-rollover.ts` (planner),
  `tools/db/rollover-season.ts` (CLI), `tests/season-rollover.test.ts`,
  `tools/migration/import_fitzroy_core.py` (offline `--contract` / `--stat-availability`),
  `tools/rebuild/fitzroy/validate_ladder_witness.py` (offline `--contract` / `--manifest-dir`),
  `data/reference/fitzroy-accepted-baselines.json`, `data/reference/seasons.json`,
  `data/reference/stat-availability.json`,
  `tools/rebuild/fitzroy/fitzroy-contract.json`,
  `tools/db/rebuild-test.ts` (`CLUB_SEASONS_EXPECTED.rows` only)
- **Current state:** OPEN. **Planner + CLI IMPLEMENTED 2026-08-29, not yet validated.**
  Pure DB-free planner computes and validates the whole successor state in memory; CLI is
  dry-run by default and `--apply` also requires `--acknowledge-season-complete`. No
  migration, no canonical write, no database connection, no clock read. **2026 is NOT
  rolled and the real 2025/2026 boundary is unchanged.**
- **Retired lifecycle vocabulary — ADJUDICATED 2026-08-29:** `retired` is the value for a
  baseline that was accepted and has since been replaced. Declared in the real register as
  `selection_policy.retired_statuses: ["retired"]` — a **policy declaration only**: the
  accepted baseline, `measured.seasons_last` (2025), `required_range` and both acquisition
  fingerprints are untouched. `accepted` may never be listed; `candidate` is **not** valid
  for a previously accepted baseline; unknown values refuse.
- **`accepted_corrections` — ADJUDICATED 2026-08-29:** no longer auto-inherited. Reviewed
  per acquisition via required `--accepted-corrections`; the outgoing record supplies
  **category names only**, never values; "no corrections" is stated explicitly as the same
  categories with empty arrays; missing/unknown/non-array categories and entries lacking
  `kind`/`rule` refuse.
- **Validator authority — corrected 2026-08-29:** operator-supplied validator stdout is no
  longer accepted. The CLI **executes** the validators on every invocation (dry run and apply
  alike), refuses on non-zero exit, and proves from the captured argv that each run was the
  right command against exactly the label/manifest/snapshot being bound. No
  `--skip-validation`, no supplied transcript, no cached success.
- **Pre-apply authority CLOSED 2026-08-29 (§14 of `AFLDB-ISSUE-101-HANDOFF.md`).** Backward-
  compatible, offline-only path overrides were added — `import_fitzroy_core.py --contract` and
  `--stat-availability` (both require `--validate-only`), and
  `validate_ladder_witness.py --contract` / `--manifest-dir` (both refused with `--compare`).
  **All defaults are unchanged**, so the rebuild orchestrator, `tests/python` and the settle
  path are unaffected. The CLI now materialises the computed successor contract and register
  in an OS temp directory and runs **three** gates before any tracked write:
  (1) `--validate-only --require-full-history`, (2) `--validate-only
  --require-accepted-baseline` against the successor register, (3) the offline ladder witness.
  Each captured run is bound by the **bytes read back** from the temporary files, so a gate
  that adjudicated some other state is refused. **`identity_scan` is now MEASURED by gate (1)
  and `--identity-scan` no longer exists as an input.** Only
  `validate_ladder_witness.py --compare` still waits for the rebuilt database.
- **Validation GREEN 2026-08-29 (user-run):** `tests/season-rollover.test.ts` **131/131**,
  no skips; broader regression **5/5 suites, 472 passed, 6 existing skips** (skip count
  unchanged from the 426/6 pre-override baseline). The importer's new paths are exercised
  end-to-end because `tests/fitzroy-core-import.test.ts` spawns it with `--validate-only`,
  `--require-full-history` and `--accepted-baselines`.
- **Exact next action:** run the one uncovered direct test of the changed witness validator —
  `.venv/Scripts/python.exe tests/python/ladder_identity_contract.py`. It is the only
  executable test of `validate_ladder_witness.py` (its §7 spawns it with **default** paths)
  and **no vitest suite runs it**, so the 472 do not cover that file. After it passes, the
  reusable mechanism is implementation-complete and `CHANGELOG.md` becomes appropriate; the
  only remaining work is the deliberate decision in `AFLDB-ISSUE-101-HANDOFF.md` §15.4 —
  defer live CLI exercise until a season actually closes, or rehearse against a throwaway
  temporary state. **Do not manufacture a fake 1897..2026 acquisition.**
- **Dependencies:** `AFLDB-ISSUE-099` and `AFLDB-ISSUE-095` are both **Resolved** — both
  dependencies are satisfied.
- **Corrected orientation (do not re-derive from the old wording):**
  - `matches_after_accepted_last_season` **already derives its boundary** from
    `accepted.measured.seasons_last` and re-points itself; it is not edited here. The gate
    that does **not** self-advance is `CLUB_SEASONS_EXPECTED.rows`.
  - `AFLDB-ISSUE-099` writes **zero canonical rows**, so there is no in-season canonical
    provenance to rewrite; supersession is the existing clean rebuild.
  - the old key-file list omitted `tools/rebuild/fitzroy/fitzroy-contract.json` and
    `data/reference/stat-availability.json`, which carry five of the coupled transitions.
- **Boundary:** **must not independently redefine completed-season `club_seasons` ownership**
  — that stays with `AFLDB-ISSUE-095`, which is **Resolved** and whose D1–D7 are
  **implemented, not open**. Its D7 already added six `club_seasons` Stage-9 gates. **Do not
  add another.** The only coordination point is the accepted ladder witness span.

-->

## AFLDB-ISSUE-102 — Awards have no canonical legacy-free acquisition path (RETIRED — Resolved 2026-09-02)

All eight closure criteria passed. The authoritative resolution and per-criterion evidence are
in `issues/closed/AFLDB-ISSUE-102.md` §8.4. ISSUE-113 remains Open outside the closure boundary;
the ISSUE-116 timing regression remains separately routed and did not affect this resolution.

- **Severity:** Medium
- **Area:** Data acquisition / Import architecture
- **Runbook:** `docs/acquisition/AFLDB-2026-API-ACQUISITION.md` §2.7, §9 row G.
- **Key files:** `tools/migration/import_awards.py` (`:1408`)
- **Current state:** **Resolved 2026-09-02.** `import_awards.py` no longer operationally
  requires `AFLDB_LEGACY_SQLITE` for any canonical awards/honours rebuild group; all eight
  closure criteria passed.
- **Exact next action:** none for ISSUE-102. ISSUE-113 remains separate, Open and outside this
  issue's closure boundary.
- **Links:** `AFLDB-ISSUE-095` as the direct sibling gap — linked, **not absorbed**.

<!-- RETIRED 2026-08-27 — `AFLDB-ISSUE-093` is RESOLVED (see `issues.md` and
     `issues/closed/AFLDB-ISSUE-093.md` §H15). The detail block below is retained as lineage only. It is NOT
     an open issue and its "next action" text is SUPERSEDED: the first clean rebuild has since
     been executed and passed all nine stages with 13/13 final validation, and the only
     remaining follow-up is `AFLDB-ISSUE-095` above.

## AFLDB-ISSUE-093 — Deterministic afldb_test rebuild from authoritative sources (RETIRED)

- **Severity:** Medium
- **Area:** Tooling / Data integrity / Import architecture
- **Key files:** `issues/closed/AFLDB-ISSUE-093.md` (durable source of truth, §15 = Phase-1 record,
  §16 = Phase-2 record); `issues/closed/AFLDB-ISSUE-093-PHASE-3-HANDOFF.md`; `data/reference/*.json`;
  `tools/migration/load_reference_data.py`; `tests/reference-data.test.ts`;
  `tools/rebuild/fitzroy/` (contract + `acquire_core.R`);
  `tests/fitzroy-acquisition.test.ts`;
  `docs/rebuild-manifests/afltables_fitzroy_core/trial-2024.json`.
- **Current state:** Architecture approved; **Phase 1 COMPLETE (2026-08-25)** —
  static/reference domains ported to tracked JSON datasets + standalone loader,
  validated 12/12; old test DB preserved as `afldb_test_pre_rebuild_20260825`
  (`ALLOW_CONNECTIONS=false`, reference-only). **Phase 2 COMPLETE (2026-08-25)** —
  fitzRoy pinned at 1.8.0 (fail-closed version gate), canonical AFL Tables acquisition
  (`fetch_player_stats_afltables` + details + results) verified by real probes and a
  real `trial-2024` acquisition with a tracked SHA-256 manifest; stable ID/name/URL and
  match identity/scores/venue SUPPORTED; DOB/match stats/Brownlow votes (correct
  per-player-per-match grain)/attendance SUPPORTED WITH COVERAGE LIMITATION;
  `player_match_period_stats` MISSING (deferred). 13/13 static tests; zero
  `AFLDB_LEGACY_SQLITE`/PostgreSQL dependency. There is still no database named
  `afldb_test`; no load has been executed anywhere yet.
- **Depends on:** `AFLDB-ISSUE-092` §4 (the fail-closed `external_identities`
  population-sanity gate) must land in whatever importer owns that reconciliation before it
  is ever run against `afldb_test`, rebuilt path or not — this is now part of Phase 3.
- **Phase 3 IMPLEMENTED (2026-08-25, §17):** club-list DOB enrichment wired to canonical
  `data/sources/afltables/club_lists/` (complete-or-refuse in canonical mode, fail-closed
  header/file validation before any DB access, `--require-complete`;
  `tests/club-list-sources.test.ts` new) + ISSUE-092 §4 gate/§5 containment implemented
  (see that issue). Static gate PASS 33/33 (user-run 2026-08-25). DB-side validation of
  the gate tests awaits a test database.
- **Phase 4a IMPLEMENTED (2026-08-25, §18):** `tools/migration/import_fitzroy_core.py` —
  canonical snapshot+manifest → venues, players (+DOB evidence under the distinct
  fitzRoy source, external identities under the ISSUE-092 gate), matches/period
  scores/attendance, player_match_stats (explicit STAT_MAP, NULL ≠ 0), derived
  brownlow_round_votes (coverage-gated, NA ≠ 0). Fail-closed manifest/SHA-256/column
  validation before any DB access; `--validate-only` needs no psycopg.
  `tests/fitzroy-core-import.test.ts` new.
- **Checkpoint (2026-08-27) — read `issues/closed/AFLDB-ISSUE-093.md` §19 first; it supersedes the
  per-phase history above.** Canonical full-history fitzRoy source FROZEN
  (`full-history-20260827`, 1897–2025, accepted via
  `data/reference/fitzroy-accepted-baselines.json` under `exactly_one_accepted`); DraftGuru
  Stage A + supported importer COMPLETE; legacy `import_draft.py` tombstoned; orchestrator
  `npm run db:test:rebuild` implemented but **never executed**. Stage B3 optional, not
  started.
- **Blocker 2 — RESET_SQL proof: IMPLEMENTED, awaiting execution (2026-08-27, §20).**
  Two real defects found and fixed while inspecting it: `runSql` never sent the SQL at all
  (`void client.unsafe(...)` — postgres.js only executes on `.then`/`.execute()`), so the
  destructive stage would have reported success against an untouched database; and the
  `pg_` schema exclusion (`NOT LIKE 'pg\\_%'` through two escaping layers) excluded nothing,
  so `DROP SCHEMA pg_toast` would have aborted the first loop. New rollback-only proof
  `tools/db/prove-reset.ts` + `npm run db:test:prove-reset`; DB-free suite 417/417.
- **Execution-path parity correction (2026-08-27 review, §20.5).** The proof originally ran
  `RESET_SQL` through postgres.js while the real rebuild ran it through psql — proving the
  SQL and leaving the mechanism untested. Now both go through one shared helper
  `tools/db/psql.ts` with identical binary and argv; the proof's stream always ends in
  `RAISE EXCEPTION`, so psql cannot commit it and **exit status 0 is treated as a failure**.
  psql availability is probed through the reset's own argv and fails closed before the reset.
  Owner policy hardened to a refusal: `current_user` and `session_user` must both be exactly
  `afldb_owner`, neither a superuser (§20.5a).
- **INCIDENT 2026-08-27 — THE ROLLBACK PROOF COMMITTED THE RESET; `afldb_test` WAS WIPED
  (§20.9a, §20.12).** psql exited 0 instead of aborting, and the read-only verification then
  returned MISMATCH: pre-proof `0229d62c…` → post-incident `f46ce34c…`, i.e. schemas 1
  (`public` only), relations 0, migrations absent, extensions 3 with all 56 extension-owned
  objects intact. **That is exactly the intended clean slate, so `RESET_SQL` is now
  empirically correct; the rollback containment is what failed.** Production and `afldb_dev`
  were never targeted. Loss was schema + privileges only — no fitzRoy import had ever run.
  Leading cause: the psql argv led with the DSN, and PostgreSQL's own non-permuting
  `getopt_long` (Windows) can then swallow `--single-transaction` and `ON_ERROR_STOP=1` as
  operands, leaving psql to autocommit each statement and exit 0 regardless of errors; the
  stream itself is byte-clean (0 CR, 0 backslashes, 0 NUL, balanced dollar tags, sentinel
  correctly wrapped in a `DO` block). Fixed: DSN passed as `-d`, a probe that fails unless
  stdin is delivered AND a raising script exits non-zero, a deferred-constraint commit trap
  armed before the reset that also detects autocommit and stops the stream before the first
  destructive statement, and redacted relaying of psql's output. `db:privileges[:test]` moved
  off the same argv shape.
- **SELF-COLLISION FOUND AND FIXED 2026-08-27 (§20.14), reproduced twice.** The hardened
  proof refused with "1 other client session(s) connected" while a standalone psql check saw
  none and the phantom vanished on exit. Cause confirmed from the connection lifecycle: the
  CLI held ONE postgres.js observer open across the whole proof, so psql — a second backend —
  correctly counted it, while the Node-side gate could not see itself
  (`pid <> pg_backend_pid()`). The gate was right; the harness was the intruder. Corrected to
  three phases with nothing spanning the psql run: observation session opened and CLOSED,
  then psql only, then a FRESH session for the post-rollback fingerprint. `ProofDeps` now
  exposes `withSession` rather than a `query` handle, so no connection can be kept open, and
  **no application_name/PID/role exemption was added** — asserted by test.
- **RESET BLOCKER 2 CLOSED 2026-08-27.** `afldb_test` reconstructed after the incident
  (migrations 001–072, privileges reconciled, PostgreSQL 16.15, `afldb_owner` non-superuser)
  and the rollback-only proof re-run against a real schema: pre-reset and post-rollback
  fingerprints both `a8a2a899e431ced96afe2d80b4ec258b31533ae27c58791b5e8bf05e0bd0e1d7`
  (exact equality), health 950 relations / 3 extensions, psql exit 3 (the deliberate abort),
  1498 ms; inside the aborted transaction every rebuild-owned object class was 0 and the
  public schema, 3 extensions and 56 extension-owned objects were preserved.
- **Exact next action:** **FIRST ACTUAL CLEAN REBUILD**, fresh session, per the **FIRST CLEAN
  REBUILD HANDOFF (§H1–§H10)** at the end of `issues/closed/AFLDB-ISSUE-093.md`. The database holds
  migrated schema and privileges only — no canonical data has ever been loaded. The agent may
  inspect and prepare; the user runs the destructive command.
- **Superseded next action:** decide sequencing (§20.13). `afldb_test` is now an empty clean
  slate, so re-running the proof against it proves little. **Tell Codex before it touches
  `afldb_test` for ISSUE-083** — its schema and per-object grants are gone. Blocker 2 stays
  OPEN. Do **not** start the clean
  rebuild until it passes. Remaining blockers after that: ISSUE-083 restricted
  `afldb_import` parity (Codex, separate worktree, do not absorb), then the first actual
  clean rebuild. Preserved `afldb_test_pre_rebuild_20260825` stays locked, never an input.
  ISSUE-092 §11 tests 24–27 still pending.
-->
