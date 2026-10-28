# V2 release — owner action sheet and dependency review (2026-10-29)

**Production: NO-GO.** This sheet consolidates what the owner can do next. It grants nothing. It follows
D-V2-RESIDUALS-1, now recorded in [release-residuals-2026-10-29.md](release-residuals-2026-10-29.md).
Choice numbers refer to [the release choices](owner-decision-release-choices-2026-10-29.md) §2.

## 1. Dependency review of the remaining choices

### 1.1 Mandatory release prerequisites, in order

| Step | Choice | Depends on | State |
|---|---|---|---|
| a | 1 D-V2-RESIDUALS-1 | none | **Recorded 2026-10-29**: residuals known and open, nothing waived |
| b | 2 D-V2-VISUAL-1 | the owner's review ([checklist](owner-visual-review-2026-10-29.md)) | Pending. Four screens are stale and one page and several states have no capture |
| c | 6a D-V2-HOST-INSPECT-1, read-only ([procedure](host-prerequisites-inspection-2026-10-29.md)) | none | Prepared, not run |
| d | Policy decisions P1–P2 (§3) | c informs P1 | Open |
| e | 3 D-V2-PUSH-1: push, merge and lock the execution commit, then one production-configured build | a, b, d; and c, see the note below | Pending |
| f | 6b Host change list | c, plus its own approval | Not yet prepared |
| g | 7 A-AFLT | P2 (RISK-27 and the C2 / D-316-1 position) | Pending |
| h | 8 Window and A-BACKUP | e, f, g; a named window; a writer and admin-edit freeze; P3 | Pending |
| i | 9 A-ROLLBACK → 10 A-REL (privileges must reach **43/43**) → 11 A-GO | h | Pending |

**Run the read-only inspection before the lock.** The lock in choice 3 is re-opened by **any** later code
change, and the host prerequisites may need changes to tracked files: `deploy/Caddyfile.production`,
`deploy/afldb.service`, or whichever hostname the release serves (P1). A visual REJECT likewise becomes a
code fix. So run c, settle P1 and finish b **before** e. The inspection itself needs nothing else first.

### 1.2 Optional work: not release blockers

- **1a X-GRIDS-1**: fixture coverage for the later Gridley snapshot. `external-grids-import` stays NOT RUN
  as a recorded residual whether or not this is done.
- **4 C-CRED-1**: credential-containment hygiene, independent of the release order.
- **5 D-V2-EVIDENCE-RETENTION-1**: cleanup of duplicate local copies. Deleting the duplicate set does not
  affect the release; the originals and host evidence must stay.
- Lint cleanup, and GAP-029 source data or a policy per finding class: both are recorded residuals. Neither
  blocks the release, and neither is waived.

### 1.3 Later operations, after installation, each separately approved

- **12** C3 inert AFL API units;
- **13** C4 / C4b / C5 and ISSUE-229 B2, blocked until authentic 2027 data is published;
- **14** Brownlow operations: observe, backfill, adopt, eligibility and resolve, one approval each, with 2026
  excluded.

## 2. Visual review you need to perform

Open [owner-visual-review-2026-10-29.md](owner-visual-review-2026-10-29.md):
1. Review 14 rows at desktop and mobile against the stated criteria. Screens **01, 02, 08 and 09 are stale**
   against the candidate.
2. Review the **7 uncaptured §6 items**. The most important is `/admin/operations/afl-api-refusals`, which
   has no capture at all.
3. For the stale and uncaptured screens, choose a live review on an isolated environment, or authorise a
   recapture (this needs a production build).
4. Return the verdict block from the checklist's §4. Until you do, V2-GAP-022 stays open.

## 3. Policy decisions needed before the artifact lock

Only genuine open policy points are listed. Everything else is an execution approval already prepared in
the release choices.

| # | Decision | Why it is needed before the lock |
|---|---|---|
| **P1** | **What serves V2 at A-GO.** Either `beta.afldb.com` through the existing proxy to `127.0.0.1:3100` with Caddy unchanged, or the apex launch that `deploy/Caddyfile.production` describes ("AT LAUNCH: delete the `handle` blocks…"). No V2 record defines "traffic switch" | An apex launch changes a tracked file, so the change must be in the locked artifact. Decide after the read-only inspection |
| **P2** | **The ISSUE-316 order (RISK-27):** release after C5, or A-AFLT after the D-316-1 final acquisition. And whether production C2 can change any tracked file of the candidate | Plan step 4 requires a pinned rebuilt artifact for any C2 change. If C2 can change the candidate, lock after C2 |

Needed before the window, **not** before the lock:

- **P3, the off-host backup destination and retention for A-BACKUP.** `docs/backup-restore.md` §4 says
  there is no off-host copy yet. `backup.sh` prunes, defaulting to `--keep 7`, while A-BACKUP must be
  non-pruning. Step c reports what exists on the host.

## 4. Read-only host inspection approval, ready to copy

Fill `<commit>` with the commit that contains the script. The final report of this session names it.

```text
D-V2-HOST-INSPECT-1 — APPROVED: one read-only inspection of the production host afldb-prod
(arm@209.38.87.252, ssh alias afldb) for release gate 9, exactly as prepared in
docs/v2/host-prerequisites-inspection-2026-10-29.md §2, using
docs/v2/evidence/host-prerequisites/inspect-host-readonly.sh with SHA-256
345472b324638961b0249ade3aab025af895c3a962a9f127e460946656089046 from v2/rebuild commit <commit>.
Includes one read-only afldb_backup session (identity, extensions, database list, ledger digest).
Retain the log locally, and in the repository only after a sensitive-content check; record the findings
and a proposed host change list with recovery routes; commit locally.
Not approved: any host, Caddy, systemd, timer, polkit, certificate, crontab, .env, backup or database
change; sudo; starting, stopping, reloading, enabling or disabling anything; a backup; a push.
Stop at any §3 stop condition.
```

## 5. Later production actions: NOT authorised by anything above

Each needs its own approval, worded for that action alone, in this order:

1. **6b** host changes from the inspection's change list, each with its recovery route;
2. **3** D-V2-PUSH-1: push and merge `v2/rebuild`, lock the execution commit and record the build hash;
3. **7** A-AFLT: retire the AFL Tables timer and its exact polkit rule; `legacy-writers` PASS;
4. **8** the window: fresh read-only preflight, temporary writer pause, frozen non-pruning backup with
   off-host copy and proven restore, and comparison with the `a4641ca0…` shadow. Any drift stops the
   release;
5. **9** A-ROLLBACK, **10** A-REL (111–117, both staging defaults, privileges **43/43**) and **11** A-GO
   (install with every new writer disabled);
6. after installation: **12** C3, **13** C4 / C4b / C5 and B2, **14** Brownlow operations.

Unchanged by this sheet:
- production stays NO-GO;
- privileges stay 42/43 and are not waived;
- V2-GAP-029 and V2-GAP-022 stay open;
- EXEC and frozen P/H are unchanged;
- source ISSUE-327 stays parked;
- nothing was pushed, merged, built or deployed, and no host or database was accessed.
