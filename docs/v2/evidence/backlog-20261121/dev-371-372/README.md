# ISSUE-371/372 deployed DEV check, Phase A (22 November 2026, 04:05–04:15 AEDT)

**Status.** Phase A done: DEV is deployed, configured and primed once as a dry check. The publication and the check
(Phase B) are the coordinator's and the owner's. **There was no production contact.** There was no restart after step 1.

**Revisions.**
- Tested application revision: `cf158d60`.
- Records tip and DEV pin: `7d92042f`, which equals `origin/main` (ls-remote).

## 1. Deployment, configuration, the one restart

- **Pre-deploy backup and artifact** (`/mnt/ssd/afldb-backlog-20261122-dev/backup-20261121T170610Z`):
  - `dev-backup-verify.sh` dump rc 0, verify rc 0, `BACKUP-VERIFIED`. The verify database is
    `afldb_v2_devbk20261121170610_test`, on the isolated cluster at :61540, which is now stopped.
  - Rollback artifact of the build being replaced: `dev-app-Le4vlDXq9IF80l1iAwRMZ.tar` (sha256 checked, 0 `.env`
    members).
- **DEV-only env, appended to `/home/arm/projects/afldb/.env` before the deploy:**
  - `AFLDB_REVALIDATE_URL=http://127.0.0.1:3100`.
  - `AFLDB_REVALIDATE_SECRET` was generated on streamanator (`openssl rand -hex 32`) and never printed. It is recorded
    here only as "configured": one line, 64 characters.
  - The previous `.env` was copied to `$W/env-before-revalidate.bak` (0600) for rollback.
- **Deploy:** `deploy/sync-dev.ps1 -Phase execute -ExpectedRevision 7d92042f… -ExpectedBranch dev-v2-main -BackupDir …
  -ArtifactArchive … -ApprovalWindowStart 2026-11-22T04:05+11:00 -ApprovalWindowEnd 2026-11-22T04:50+11:00`.
  - Exit 0. Gate READY, with every check PASS: writer timers, backup, artifact, migrations 118→118.
  - `5199eb4f` → `7d92042f`; BUILD_ID `QLj8i5VnhcmZ7ZGCbLHMx`.
  - One restart, through the unit's `Restart=` policy (no sudo). Health was ready after 3 s.
  - Evidence: `/mnt/ssd/afldb/records/deploy-preflight/20261121T170719Z-streamanator-5199eb4f8859-execute-2127621.txt`, and
    `deploy-7d92042f-excerpt.txt` in this folder.
- **Running processes, after the restart.** Each has both names; names only were checked, via `/proc/<pid>/environ` counts.

  | Role | pid | `AFLDB_REVALIDATE_URL` | `AFLDB_REVALIDATE_SECRET` |
  |---|---|---|---|
  | primary | 2136687 | 1 | 1 |
  | worker 1 | 2136733 | 1 | 1 |
  | worker 2 | 2136734 | 1 | 1 |
  | worker 3 | 2136735 | 1 | 1 |
  | worker 4 | 2136738 | 1 | 1 |

  DEV runs `AFLDB_WORKERS=4`.
- **Settle units.** Both AFL API units keep `UnsetEnvironment=… AFLDB_REVALIDATE_SECRET` (D-232-3). The
  `afldb-settle-afltables` unit is not scheduled on DEV: no active timer.

## 2. Addressing and identifying workers

- DEV has `AFLDB_TRACE_REQUESTS=on`, so every response carries:
  - `x-afldb-worker` (ordinal 1–4);
  - `x-afldb-pid`;
  - `x-afldb-build`;
  - `x-afldb-request-id`.
- Every probe uses a new connection to `127.0.0.1:3100` (`agent:false`), and the cluster primary rotates connections
  across the workers. The probe samples until each worker has answered *k* times.
- There is no per-worker port; the header and pid are the reliable identity.
- **Beta gate.** DEV has the beta gate on, so an anonymous GET is a 307 to `/beta` and measures nothing.
  - The probe mints a 15-minute `afldb_beta` claim in memory from the DEV `.env`, exactly as `signClaim` does.
  - The claim, the cookie and the secret are never printed, logged or written.

## 3. Targets

| Issue | Target | DEV state now | Expected after publication |
|---|---|---|---|
| 372 | `/seasons/2026` (ISR, `revalidate = 3600`) | 200 on all 4 workers; "Charles Sutton Medal" absent (0/8) | award present on **every** worker, without a restart |
| control | `/awards/bf-western-bulldogs/2026` (dynamic, never cached) | 404, not-found head, on all 4 workers | 200, title `2026 Charles Sutton Medal…`, on every worker |
| 371 | `/brownlow/2026` (ISR) | 404 cached on all 4 workers (`Page not found`, robots `noindex`) | **not publishable on DEV as it stands**; see below |

**ISSUE-372 admin action.** The award is absent from DEV for 2026, and the action is reversible.

1. Open `http://10.0.40.100:8090/admin/awards/winners/new` ("Record an award winner").
2. Award **Charles Sutton Medal**; Season **2026**; Club **Western Bulldogs**.
3. Pick a player through "Select player profile". This is a DEV test record.
4. Admin note: at least 20 characters, for example "ISSUE-372 DEV acceptance; void after the check".
5. Click **Record award winner**.

The client then posts the allowlisted paths, including `/seasons/2026`, to `/admin/awards/revalidate`. The season fan-out
reaches all 4 workers.

- **Reversal.** Open `/admin/awards/winners/<id>` → **Void this record…** → enter a reason → **Void this record**. This is
  audited, and the follow-up refreshes the season again. The full fallback is a restore of the verified backup above.

**ISSUE-371 on DEV is blocked by data, not by code.**
- DEV holds 9,522 2026 round-vote rows, all with `match_id IS NULL`, and 0 of 207 home-and-away matches accounted
  (read-only query).
- `publishBrownlowSeason` therefore refuses with `season_incomplete` ("0 of 207 home-and-away matches are accounted
  for"). The same is true for 2022–2025.
- Making it publishable needs the guarded 7R3 attach CLI, `tools/v2/brownlow-season-attach.ts`, run on the DEV database:
  `plan`, then `apply --commit`, with `--actor` set to the owner's DEV `auth_users.id` and a note of at least 20 characters.
  The CLI has a `reverse` mode.
- After that, the owner would publish at `http://10.0.40.100:8090/admin/brownlow/2026`. That page has a "Publish the season
  total" section, a 20+ character note (2026 is sealed), the **Publish season…** button and then **Confirm publish**.
- This is a DEV database write outside the normal admin action. It was **not run**, because it needs a separate
  authorisation. A Brownlow publication has no unpublish (republishing adds a revision), so its full reversal is the
  backup restore. On DEV that converges with production, where 2026 is published as revision 3.

## 4. Scripts

On streamanator, in `/mnt/ssd/afldb-backlog-20261122-dev/dev371372/` (0700); copies are in this folder.

- `probe.mjs`: read-only GETs.
- `prime.sh [label] [perWorker=2]`: every target on every worker; records the pre-publication state.
- `check.sh [label] [perWorker=4]`: the same probes, with verdicts. Seasons PASS means every sample on every worker shows
  the award. The award-control PASS means 200 with no not-found head. The Brownlow line reads PASS only once 2026 is
  published.
- Output: `out/<stamp>-<mode>-<label>.jsonl`, one line per response, recording worker, pid, `x-nextjs-cache`, title,
  robots, award presence and timestamps; ISR on-disk mtimes before and after; and `….summary.txt`.
- There are no cookies or credentials in the output.

**Dry-run prime** (`20261121T171248Z-prime-dryrun-prime.summary.txt`): every worker answered.
- `/seasons/2026`: 200 HIT, award 0/2 per worker.
- `/brownlow/2026`: 404 `Page not found | AFLDB`, robots `noindex`.
- Award page: 404.
- Good pages read robots `noindex, nofollow` everywhere. DEV indexing is off behind the beta gate, so the robots
  discriminator is `noindex` (not-found head) versus `noindex, nofollow` (page head), plus the title.

## 5. ISR window

- `/seasons/2026` was generated at the build, 2026-11-21T17:09:40Z. `/brownlow/2026`'s 404 was cached at 17:12:49Z.
  Both are `revalidate = 3600`.
- **The primed state is valid until about 18:09Z (05:09 AEDT) for the season page.** After that the next request serves
  stale and regenerates naturally, and a check could then PASS without the fan-out.
- To renew the window, run the attended CLI once, then prime, immediately before publishing. The CLI refreshes
  `/seasons/2026` and `/brownlow/2026` on all workers; it is not a restart:
  `cd /home/arm/projects/afldb && npx tsx tools/maintenance/revalidate-season.ts --season 2026`. Expect exit 0 and 4/4
  workers.
- The DEV AFL API settle fires at 05:01 AEDT. It invalidates nothing (D-232-3).

**The CLI was exercised once on DEV in Phase A.** This also tests the procedure 01 refresh step.
- At 17:14:10Z the CLI printed `REVALIDATED season 2026: 4/4 worker(s) reached (2,4,1,3) in 4 request(s).`, rc 0.
- The re-prime straight after (`20261121T171410Z-prime-after-cli-prime.summary.txt`) shows `x-nextjs-cache: MISS` first on
  **every** worker, for both `/seasons/2026` and `/brownlow/2026`.
- The ISR files were rewritten at 17:14:13Z, so the cross-worker invalidation works on deployed DEV without a restart.
- **The window now runs to about 18:14Z (05:14 AEDT).** Re-run the CLI and prime if the publication will be later.

## 6. Phase B-371 preparation (owner approval 22 Nov: "I approve the DEV attach and 371 publish")

- **Owner's DEV admin.** `auth_users.id = 4`, role `super_admin`. It holds the only live session created in the last 12 h
  (created 04:16:48 AEDT). This was a read-only query on the DEV auth database; no email or credential was recorded.
- **Attach target** (`attach-target-dev.json`, proven on the live connection):
  - `afldb_dev` as `afldb_import` on 127.0.0.1:5432;
  - system identifier `7673872117032104869`, database OID `202860`, cluster `16/main`.
  - The DSN reached the tool only through `AFLDB_BROWNLOW_ATTACH_DSN`, read from the DEV `.env` inside the script.
- **PLAN** (read-only REPEATABLE READ, 2026-11-21T17:18:00Z, rc 0). The tool printed:

  `PLAN season=2026 rows=9522 positive=621 votes=1242 matches=207/207 attach=9522 mirror=9522 digest=100c112f400a492906cbc2a5c3886243c15d412eb62f84d50f17c63ae1f76aa7`

  - The facts are: status `complete`, coverage `pending`, published revision `null`, 0 season-total rows, 9,522
    unattached, 0 participant cells without a row, 0 positive votes outside home-and-away.
  - These figures and the digest equal production's 7R3 D2 plan exactly (`9522/621/1242/207/207`, digest
    `100c112f…76aa7`).
  - Plan file: `attach/plan-2026-20261121T171800Z.json` on the host (sha256 `a47d22fa…0320a6`, 0600).
  - There was no refusal.
- **Expected ineligible list on DEV:** D-370-1's 14 ids, mirroring production revision 3.
  - All 14 polled on DEV (2026 votes): 6841 Jason Horne-Francis 22, 5480 Harley Reid 15, 13246 Zac Bailey 13,
    6667 Jacob van Rooyen 10, 11041 Riley Thilthorpe 5, 3295 Darcy Fogarty 4, 6746 James Sicily 3, 12205 Taylor Walker 3,
    12869 Tristan Xerri 3, 4004 Dylan Moore 2, 10282 Paul Curtis 2, 940 Bailey Humphrey 1, 1108 Ben Long 1,
    3292 Darcy Byrne-Jones 1.
  - Expected publication: 183 rows, 1,242 votes, winner Nick Daicos 47.
- **Apply.** Not run. It waits for the coordinator's go, after the 372 check.

## 7. ISSUE-372 DEV result (coordinator's check, 17:35:03Z): PASS

`20261121T173503Z-check-post-publish.summary.txt`: after the owner recorded the 2026 Charles Sutton Medal through
`/admin/awards/winners/new`:

| Target | Result |
|---|---|
| `/seasons/2026` | Award 4/4 on **each** of workers 1–4 (pids 2136733/34/35/38); `MISS` first, then `HIT`; no restart |
| `/awards/bf-western-bulldogs/2026` (control) | 200 on all 4 workers, title `2026 Charles Sutton Medal — Winner and Full Result \| AFLDB` |
| `/brownlow/2026` | Still 404 (not published), but `MISS` first on every worker. The award's season fan-out also refreshed it, as designed |

## 8. ISSUE-371 attach on DEV (2026-11-21T17:35Z, after the 372 check)

| Run | Result |
|---|---|
| Dry run, rc 0 | `APPLY DRY-RUN (rolled back) season=2026 attached=9522 mirrored=9522 unattached_after=0 mirror_after=9522 audit=- digest=100c112f…76aa7` |
| Commit, run **once**, rc 0 | `APPLY COMMITTED season=2026 attached=9522 mirrored=9522 unattached_after=0 mirror_after=9522 audit=8 digest=100c112f…76aa7` |

- **Inputs:** `--actor 4`; the note cites the owner's DEV attach approval of 2026-11-22. The result files are
  `apply-dryrun-20261121T173535Z.json` and `apply-commit-20261121T173540Z.json`.
- **Read-only re-check:** 2026 unattached rows 0; home-and-away accounted **207/207**; season-total rows 0 (unpublished);
  coverage `pending`.
- **Process ids:** before and after, the primary was 2136687 with workers 2136733, 2136734, 2136735 and 2136738. Nothing
  restarted.
- **Reversal:** `reverse` with the same flags, available until publication.

## 9. Deployed DEV result (ISSUE-371 + ISSUE-372): PASS

**This is separate from the streamanator 2-worker rehearsal** (`docs/v2/evidence/issue372-20261121/QUALIFICATION-20261122.md`).
That run was an isolated production build on a disposable database. This section is the deployed DEV site, run the
normal way, with real admin actions by the owner.

**Conditions.**
- DEV serves `7d92042f` (executable tree = `cf158d60`) with **4 workers**, pids 2136733, 2136734, 2136735 and 2136738.
  The pids were unchanged from the deploy restart through every step below: a **single** restart (the deploy, §1).
- The env change is DEV-only: `AFLDB_REVALIDATE_URL`/`SECRET` are configured, names only (§1).
- DEV indexing is off behind the beta gate, so every good page reads robots `noindex, nofollow`, and the not-found head
  reads `noindex` with the title `Page not found | AFLDB`.

**ISSUE-372.**
- **Change made:** the owner recorded the 2026 Charles Sutton Medal through `/admin/awards/winners/new` as
  `award_winners.id = 3714` (active).
  - To void it: open `http://10.0.40.100:8090/admin/awards/winners/3714`, then **Void this record…**, enter a reason, and
    click **Void this record**.
- **Check** (17:35:03Z, `20261121T173503Z-check-post-publish.*`):
  - `/seasons/2026` showed the award 4/4 on each of workers 1–4, `MISS` first.
  - The `/awards/bf-western-bulldogs/2026` control returned 200 with the correct title on all 4 workers.
- **PASS**, without a restart.

**ISSUE-371.**
- **Attach:** the 2026 round votes were attached on DEV (audit 8, §8).
- **Publication:** the owner published at `/admin/brownlow/2026`, with "14 marked" (audit 9, `data_edits`
  `brownlow_season_authority` `publish`, 04:43:17 AEDT, admin 4).
- **Database, read-only:**
  - authority revision 2, published revision 2;
  - `brownlow_season_votes` 2026: **183 rows, 1,242 votes, 1 winner, 14 ineligible**;
  - the ineligible ids equal D-370-1 exactly (`940,1108,3292,3295,4004,5480,6667,6746,6841,10282,11041,12205,12869,13246`,
    SQL array equality `t`);
  - winner Nick Daicos (9910), 47 votes, rank 1 / eligible rank 1;
  - coverage `complete`.
- **Check** (17:43:36Z, `20261121T174336Z-check-post-publish-371.*`): `/brownlow/2026` returned 200 4/4 on **each**
  worker, `MISS` then `HIT`, title `2026 Brownlow Medal — Winner, Votes & Leaderboard | AFLDB`, robots
  `noindex, nofollow`, 0 not-found heads. The season page and the award control still PASS.
- **Standings per worker** (17:44:31Z, `20261121T174431Z-standings-371.jsonl`, `standings.mjs`). Two samples on each of
  workers 1–4 all show:
  - head: title and `og:title` `2026 Brownlow Medal — Winner, Votes & Leaderboard | AFLDB`, robots `noindex, nofollow`,
    canonical `http://10.0.40.100:8090/brownlow/2026`;
  - body: "Won by Nick Daicos with 47 votes · 2026 season", 183 players polled, and **14** "Recorded ineligible" markers.
  - Top 5 on every worker:
    1. Nick Daicos 47 (Winner)
    2. Bailey Smith 36
    3. Marcus Bontempelli 34
    4. Max Gawn 28
    5. Will Ashcroft 27. Harry Sheezel also has 27 and is joint fifth; the page and the SQL order the tie differently.
  - These match production's 7R3 §7.2 expectations.
- **PASS**, without a restart.

**DEV now differs from its pre-check state as follows.** The 2026 Brownlow is attached and published (as on production),
and there is one 2026 Charles Sutton Medal test record (id 3714; void it when no longer needed). The pre-deploy backup
`backup-20261121T170610Z` remains the full revert.
