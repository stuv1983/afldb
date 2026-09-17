# AFLDB-ISSUE-133 — Production season page did not show the two 2026 Wildcard Finals

**Status:** **Resolved 2026-09-03 — no application fix made.** The investigation stage
classified the discrepancy as stale ISR cache output the same evening (§8); the operator's
production verification (§11) then proved the on-disk ISR entry regenerated with the Wildcard
Final block and that the live public page renders both matches. No application code, test,
migration, deployment config, production state or cache was changed in this issue. Closeout
is on `claude/issue-133`, **uncommitted** (operator instruction). The retained operational
limitation is handed off as `AFLDB-ISSUE-134` (§11.4).
**Classification (final, confirmed §11):** **stale/static/ISR cache output — build-before-settle
ordering plus the one-hour revalidation window.** The deployed build prerendered
`/seasons/2026` at 22:14:46 AEST from a database that did not yet contain the two
`wildcard_final` rows; the settle inserted them at 22:37:47 AEST; the route is ISR with
`revalidate = 3600`, so the build-time HTML (which contains no "Wildcard Final" block) was the
correct thing for Next.js to serve until at least 23:14:46 AEST. The deployed revision, the
migrations, the data and the query path are all correct.
**Severity:** Low — self-healing by design within one hour; no data or code defect. The
retained concern is operational (§8 follow-up).
**Area:** Deployment / Operations / Frontend rendering (ISR)
**Branch / worktree:** `claude/issue-133` — `D:\dev\afldb-issue-133` (base `7712860`)
**Migration:** none.
**Related:** `AFLDB-ISSUE-132` §11 (the handoff this issue executes), `AFLDB-ISSUE-129`
(Wildcard Final semantics), `AFLDB-ISSUE-131` (rekey reconciliation; the settle that inserted
the rows ran under its merged code), `AFLDB-ISSUE-122` (settle service).

Hosts: **PROD** = `afldb-prod` (209.38.87.252, database `afldb_prod`, service `afldb`,
site `https://beta.afldb.com`). **DEV** = `streamanator` (10.0.40.100). **DEV was not
accessed at all in this stage.** All times below are host-local AEST (+10:00) unless marked UTC.

---

## 0. Stage boundary and rules

- Investigation only, in the order the operator set: observation → deployed revision →
  served data → render/cache behaviour → classify.
- Every production command was **read-only**: `git rev-parse/log/status/merge-base`,
  `stat`/`ls`/`find`/`grep` on `.next`, `systemctl show`/`is-active`, `curl` without
  cookies, `psql SELECT` only. No write, settle, migration, restart, purge, rebuild or Git
  state change was made on PROD, and no `git fetch` was run there.
- No `.env` value was printed; the probe printed only whether named keys were present.
- Deviation from CLAUDE.md §9 / ISSUE-132 §11 "operator-executed": the operator's task
  instruction for this stage asked for read-only production verification and labelled
  remote output, so the agent ran the two read-only SSH probes itself (§2). Recorded here so
  the deviation is visible.

---

## 1. Pin the observation (partially pinned)

**What is established, from the handoff only** (`issues/closed/AFLDB-ISSUE-132.md` §11,
recorded 2026-09-03 at the operator's instruction):

- Surface: the **public season page**, expected URL `https://beta.afldb.com/seasons/2026`.
- Viewer: the operator. Auth state (beta cookie vs admin session) not recorded.
- What was seen: the page did **not** show the two 2026 Wildcard Final matches. Whether the
  "Wildcard Final" heading was absent (versus present under another label) is not recorded.
- When: not recorded. It must have been after **22:37:47 AEST on 2026-09-03** (before that
  the rows did not exist in `afldb_prod`, §4) and before the ISSUE-132 closeout was written the
  same evening.

**What is NOT pinned:** exact request time, auth state, screenshot/HTML. The Caddy access log
(`/var/log/caddy/afldb-access.log`, JSON, no query strings) would pin the time and status; the
agent's attempt to read it was blocked by the local permission classifier (§7), so it is left
to the operator (§9 step 1). No inference beyond the above is made.

---

## 2. Commands used (PROD, read-only)

Two SSH sessions from the workstation (PowerShell, alias `afldb`, script shipped base64 and
piped to `bash`), at 23:38:14 and 23:42:39 AEST on 2026-09-03. The material commands:

```bash
# PROD afldb-prod — revision
cd /home/arm/projects/afldb
git rev-parse HEAD; git log -1 --format='%h %ci %s'; git branch --show-current; git status --short
for c in b1d4085 8c646c5 c958367 5f4c082 d734c73 657a875 0b3b248 7712860; do
  git cat-file -e "$c^{commit}" && { git merge-base --is-ancestor "$c" HEAD && echo "$c ANCESTOR_OF_HEAD" || echo "$c present_not_ancestor"; } || echo "$c unknown_to_prod_clone"; done
# PROD — build and service
cat .next/BUILD_ID .next/standalone/.next/BUILD_ID; stat -c %y .next/BUILD_ID .next/standalone/.next/BUILD_ID
systemctl show afldb -p MainPID -p ExecMainStartTimestamp -p ActiveState -p SubState
systemctl is-active afldb-settle-afltables.timer
# PROD — live responses (no cookie)
curl -s -o /dev/null -D - http://127.0.0.1:3100/api/health
curl -s -o /tmp/x.html -D - http://127.0.0.1:3100/seasons/2026
curl -s -o /dev/null -D - https://beta.afldb.com/seasons/2026
# PROD — ISR cache entries on disk
ls -la --time-style=full-iso .next/standalone/.next/server/app/seasons | grep 2026
stat -c %y .next/standalone/.next/server/app/seasons/2026.html
grep -o -i wildcard .next/standalone/.next/server/app/seasons/2026.html | wc -l
grep -o 'id="wildcard-final"' .next/standalone/.next/server/app/seasons/2026.html | wc -l
head -c 500 .next/standalone/.next/server/app/seasons/2026.meta
python3 - <<'PY'   # prerender-manifest entry for /seasons/2026
import json; m=json.load(open('.next/standalone/.next/prerender-manifest.json')); print(m['routes']['/seasons/2026'])
PY
find .next/standalone/.next/server/app -type f -newer .next/standalone/.next/BUILD_ID \( -name '*.html' -o -name '*.rsc' \) -printf '%TY-%Tm-%Td %TH:%TM:%TS %p\n' | sort | tail -20
# PROD — data, app DSN (afldb_app) then owner DSN; SELECT only
psql "$DATABASE_URL" -X -At -F ' | ' <<'SQL'
select current_user, current_database(), now();
select id, season, round_type, round_code, round_number, match_date, is_final, is_finals_series, home_club_id, away_club_id, venue_id, source_record_id from matches where season=2026 and round_type='wildcard_final' order by id;
select round_type, count(*), min(match_date), max(match_date) from matches where season=2026 group by round_type;
select year, is_complete, first_match_date, last_match_date, match_count, last_loaded_round from seasons where year=2026;
-- getSeasonMatches' exact join shape, restricted to the two rows
select m.id, m.round_type, m.round_number, m.match_date, h.name, a.name, m.home_score, m.away_score, coalesce(v.canonical_name, m.venue_raw)
  from matches m join clubs h on h.id=m.home_club_id join clubs a on a.id=m.away_club_id left join venues v on v.id=m.venue_id
 where m.season=2026 and m.round_type='wildcard_final' order by m.match_date, m.id;
select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='round_type';
SQL
psql "$AFLDB_PROD_DATABASE_URL" -X -At -F ' | ' <<'SQL'
select name, applied_at from afldb_meta.schema_migrations order by name desc limit 4;
select id, xmin, started_at, status from import_batches where id between 730 and 740 order by id;
select id, import_batch_id, target_table, verb, target_key::text, applied_at from canonical_applications
 where target_table='matches' and target_key::text like '%WF%' order by id;
SQL
```

---

## 3. Deployed production revision (PROD)

| Fact | PROD value |
|---|---|
| `HEAD` | `657a875b33807abe97c1cb6ded821922a63f5a3c` — "Merge ISSUE-131 canonical match rekey reconciliation", 2026-09-03 22:09:55 +1000, branch `main` |
| Working tree | clean except 3 untracked settle manifests under `docs/rebuild-manifests/afltables_fitzroy_core/` (`settle-2026-09-02-1958`, `settle-2026-09-03-0553`, `settle-2026-09-03-2230`) |
| ISSUE-129 `b1d4085`, `8c646c5`, `c958367` | **ANCESTOR_OF_HEAD** |
| ISSUE-131 `5f4c082`, `d734c73`, `657a875` | **ANCESTOR_OF_HEAD** |
| ISSUE-132 `0b3b248`, `7712860` | **unknown to the PROD clone** — not fetched/deployed |
| `BUILD_ID` | `w9ce2qfWBViW-3wnIRGzt`; `.next/BUILD_ID` written 22:13:24, `.next/standalone/.next/BUILD_ID` 22:15:31 |
| Service | `afldb` active/running, `MainPID=770310`, `ExecMainStartTimestamp` 22:16:18 AEST — i.e. restarted after this build |
| `afldb-settle-afltables.timer` | **active** |
| Migrations (top 4) | `085_matches_is_finals_series.sql` and `084_round_type_wildcard_final.sql` applied 19:00:46 AEST 2026-09-03; `083` 2026-09-02 15:31; `082` 2026-09-02 12:24 |
| `round_type` enum labels | `home_and_away,wildcard_final,elimination_final,qualifying_final,semi_final,preliminary_final,grand_final` |

**Repository `main` versus deployed PROD:** local `main` = `origin/main` = `7712860`
(ISSUE-132 merge). PROD is one merge behind at `657a875`. The only difference is the
ISSUE-132 commits, which change **tests and issue bookkeeping only** (ISSUE-132 §10: "No
application code changed"). So for this discrepancy the deployed revision is **not stale**:
it contains every application change from ISSUE-129 and ISSUE-131, `formatRound` maps
`wildcard_final` → "Wildcard Final", and both migrations are applied.

Side observation, not pursued: the loopback `GET /api/health` response showed only
`HTTP/1.1 200 OK` and `cache-control: no-store` through the header filter — no
`x-afldb-build` header was captured. Build identity was established from `BUILD_ID` on disk
plus the post-build service start time instead. Not material to this classification.

---

## 4. Served production data (PROD, `afldb_prod`)

Queried as `afldb_app` (the application's own role and DSN) at 23:38:14 AEST:

| `id` | `round_type` | `round_code` | `round_number` | `match_date` | `is_final` | `is_finals_series` | home → away | score | `source_record_id` |
|---|---|---|---|---|---|---|---|---|---|
| 17381 | `wildcard_final` | `WF` | NULL | 2026-08-28 | t | f | Western Bulldogs (24) → Collingwood (5), venue 26 (MCG) | 96–93 | `2026\|WF\|2026-08-28\|Western Bulldogs\|Collingwood` |
| 17382 | `wildcard_final` | `WF` | NULL | 2026-08-29 | t | f | Melbourne (15) → Carlton (4), venue 26 (MCG) | 55–74 | `2026\|WF\|2026-08-29\|Melbourne\|Carlton` |

- 2026 rows per `round_type`: `home_and_away` 207 (2026-03-05 … 2026-08-23),
  `wildcard_final` 2 (2026-08-28 … 2026-08-29). No traditional finals yet. Total 209.
- `seasons` row 2026: `is_complete=f`, `first_match_date=2026-03-05`,
  `last_match_date=2026-08-29`, `match_count=209`, **`last_loaded_round='WF'`**.
- `getSeasonMatches`' exact join shape (`JOIN clubs h`, `JOIN clubs a`, `LEFT JOIN venues`)
  returns **both rows** with names, scores and venue resolved; the all-2026 count through the
  same joins is 209, so no row is dropped by the inner joins. `match_date` is non-NULL on
  both, so `ORDER BY m.match_date, m.id` places them after the last Round 25 match
  (2026-08-23) — exactly where the page's grouping puts a "Wildcard Final" block.
- **When the rows arrived:** `canonical_applications` ledger rows 18510 and 18512
  (`target_table='matches'`, verb `insert`, `import_batch_id=735`) were applied at
  **2026-09-03 22:37:47 AEST**. Batch 735 is the first settle after the 22:16 restart; batches
  736–738 (22:39–22:45) followed with 0 inserts/0 updates. The row `xmin`s (27816, 27817) sit
  between batch 732's `xmin` (25709, 05:53 AEST, before migration 084 existed) and batch 735's
  (27900), corroborating the ledger. The settle snapshot `settle-2026-09-03-2230` was acquired
  at 22:31:09 AEST (`extraction_timestamp_utc` 2026-09-03T12:31:09Z).

**Conclusion:** data and query path are correct and complete. Nothing about the two rows would
hide them from `getSeasonMatches`.

---

## 5. Render and cache behaviour (repository + PROD)

**Repository (`src/app/seasons/[year]/page.tsx`, unchanged since before ISSUE-129):**

- `export const revalidate = 3600;` (line 46) — ISR, one-hour revalidation.
- `generateStaticParams()` (line 54) prerenders **every** season at build time, by design
  ("without this the route is rendered on demand and not stored in the full route cache").
- `getSeasonMatches` uses plain `sql` with no `unstable_cache`; the only caching is the route
  level ISR entry.
- `docs/deployment.md` §"Cache invalidation" already states: "Historical pages are cached for
  1–24 hours. After an import, a rebuild and restart refreshes them … Rebuilding is preferred
  over waiting for revalidation, because prerendered pages are regenerated at build time."

**PROD deployed build (`.next/standalone`, Next 16.3.1):**

- `prerender-manifest.json` `routes["/seasons/2026"]`: `compute: "static"`,
  **`initialRevalidateSeconds: 3600`**, `initialExpireSeconds: 31536000`, `htmlSize: 839018`.
  `2026.meta` carries `x-nextjs-prerender: 1`, `x-nextjs-stale-time: 300` and cache tag
  `_N_T_/seasons/2026`.
- The prerendered entry `.next/server/app/seasons/2026.html` was written **22:14:46 AEST**
  during `next build` and copied to `.next/standalone/.next/server/app/seasons/2026.html` at
  **22:15:31**. As of 23:42:39 that file is **unchanged** (839,018 bytes): it contains
  **0 occurrences of "wildcard"** (case-insensitive), **0** `id="wildcard-final"` anchors, and
  **1** `id="round-24"` anchor. That is the correct output for the database as it stood at
  22:14:46 — the rows did not exist until 22:37:47.
- ISR regeneration is **working** in this deployment: 8,183 `.html`/`.rsc` files under
  `.next/standalone/.next/server/app` are newer than `BUILD_ID` (e.g. player pages at
  22:57:29, `/matches/13169` at 23:01:23). The season entry simply has not been regenerated:
  its 3600 s window from 22:14:46 expired at **23:14:46 AEST**, and Next regenerates a stale
  ISR entry in the background only on the next request after expiry (that request still
  receives the stale HTML). Either no request for `/seasons/2026` has arrived since 23:14:46,
  or it arrived and the regeneration had not yet been written by 23:42:39.
- Live fetch without a cookie (loopback `:3100` and public `https://beta.afldb.com`) returns
  **307 → `/beta?from=%2Fseasons%2F2026`** (beta gate on), so the rendered HTML could not be
  compared from an anonymous request. The on-disk ISR entry is what every cookie-bearing
  request was served, so it was used as the served-output evidence instead.
- The cluster runs several Node workers; each also holds an in-memory LRU in front of the
  file-system cache. That can only delay regeneration further; it cannot make a worker serve
  newer content than the file store.

**Timeline (PROD, AEST, 2026-09-03):**

| Time | Event |
|---|---|
| 19:00:46 | migrations `084`, `085` applied to `afldb_prod` |
| 22:09:55 | `657a875` (ISSUE-131 merge) committed; later pulled on PROD |
| 22:13:24 – 22:15:31 | `next build` `w9ce2qfWBViW-3wnIRGzt`; `/seasons/2026` prerendered 22:14:46 with **0** Wildcard Final rows |
| 22:16:18 | `afldb` service restarted on the new build |
| 22:31:09 | settle snapshot `settle-2026-09-03-2230` acquired |
| **22:37:47** | batch 735 **inserts matches 17381 and 17382** (`wildcard_final`) |
| 22:39 – 22:45 | batches 736–738, 0/0 |
| 22:37 – 23:14:46 | any request for `/seasons/2026` is served the 22:14:46 prerender — **no Wildcard Final block** (the observed discrepancy) |
| 23:14:46 | ISR entry becomes stale; next request triggers background regeneration |
| 23:38 / 23:42 | probes: entry still the build-time file, unchanged |

---

## 6. Findings

1. **F1 — Not a stale deployed revision.** PROD `657a875` carries ISSUE-129 and ISSUE-131 in
   full; the missing ISSUE-132 merge is tests/bookkeeping only. Migrations 084/085 applied.
2. **F2 — Not a data or query mismatch.** Both rows exist, have the exact shape the page
   expects, survive the page query's inner joins, and sort into the right place;
   `seasons.last_loaded_round = 'WF'`.
3. **F3 — Root cause: build-before-settle ordering meets a one-hour ISR window.** The deploy
   built (and therefore prerendered) the season page 23 minutes **before** the first settle on
   the new code inserted the rows. With `revalidate = 3600` the page legitimately served the
   pre-settle prerender until 23:14:46 AEST. The observation window (after 22:37:47, same
   evening) falls inside that hour.
4. **F4 — Nothing invalidates ISR after a settle.** The settle path writes canonical rows but
   does not call `revalidatePath`/`revalidateTag` for the affected season/match routes, and the
   nightly `afldb-settle-afltables.timer` (04:30) runs with no rebuild. The project's own
   guidance (docs/deployment.md) relies on "rebuild after import", which the automatic
   in-season settle does not do. This is a retained operational limitation, not a defect of
   ISSUE-129/131/132, and is the follow-up in §8.
5. **F5 — Bookkeeping drift noticed, out of scope, not changed:** `IssuesIndex.md` and the
   `issues.md` Open Issues row for `AFLDB-ISSUE-131` still say "production untouched, timer
   still STOPPED", but PROD shows ISSUE-131 merged and deployed, the timer **active**, and four
   settles run on 2026-09-03 evening. ISSUE-131's closeout state is the operator's to record.

---

## 7. Blockers and deviations

- **Observation not fully pinned (§1).** The agent's second probe, which included
  `journalctl -u afldb-settle-afltables.service` and parsing `/var/log/caddy/afldb-access.log`
  for `/seasons/2026` requests (timestamp, status, `X-Nextjs-Cache`), was **blocked by the
  local permission classifier** before it ran. A narrower re-run without those two reads was
  allowed and is what §2–§5 report. The access-log command is handed to the operator in §9.
- **No cookie-bearing fetch was made.** The agent holds no beta/admin cookie and did not try to
  obtain one; the on-disk ISR entry stands in for "what was served".
- **`x-afldb-build` header not captured** on the loopback health probe (§3); not pursued.
- **No `git fetch` on PROD**, so "one merge behind `origin/main`" is derived from the known
  `main` tip `7712860` and ancestry checks, not from PROD's own remote-tracking ref.
- The agent executed the read-only PROD probes itself (§0) instead of handing every command to
  the operator.

---

## 8. Classification and retained follow-up

**Classification: stale/static/ISR/cache output.** Evidence: §3 (revision current), §4 (data
current and queryable), §5 (route is ISR with a 3600 s window; the on-disk prerender predates
the rows by 23 minutes and contains no Wildcard Final; ISR regeneration works elsewhere in the
same build). No application defect is indicated; ISSUE-132 is **not** reopened and T1's
fixture is not shown to differ from the production rows.

**Expected self-heal:** the first cookie-bearing request to `/seasons/2026` after 23:14:46
AEST returns the stale HTML and schedules regeneration; subsequent requests receive the fresh
render with the "Wildcard Final" block (anchor `wildcard-final`) between Round 25 and the end of
the match list. If that does not happen, §9 step 3 reclassifies.

**Follow-up — allocated 2026-09-03 as `AFLDB-ISSUE-134` (§11.4); not implemented here:** make the settle
apply path, or the post-settle operator step, invalidate the ISR entries it affects
(`revalidateTag('_N_T_/seasons/<season>')` and the touched match/club pages, or a rebuild as
`docs/deployment.md` already prescribes). Until then every in-season nightly settle leaves the
public season page up to an hour behind the database. Meets the "product limitation requiring
future work" criterion; it is now its own issue (§11.4).

---

## 9. Exact next action (operator, PROD, read-only)

**Outcome 2026-09-03 (see §11):** step 2 was executed by the operator and passed (§11.1);
step 1 was not run and is not required for closure (§11.2); neither step 3 reclassification
branch was triggered; step 4 is executed by this closeout (§11.2–§11.4). The steps are kept
below as the record of what was asked.

1. **Pin the observation from the access log** (read-only; prints no query strings or cookies):
   ```bash
   # PROD afldb-prod
   python3 - <<'PY'
   import json,datetime
   tz=datetime.timezone(datetime.timedelta(hours=10))
   for line in open('/var/log/caddy/afldb-access.log', errors='replace'):
       try: e=json.loads(line)
       except Exception: continue
       uri=e['request'].get('uri','')
       if not uri.startswith('/seasons/2026'): continue
       ts=datetime.datetime.fromtimestamp(e['ts'],tz).strftime('%Y-%m-%d %H:%M:%S')
       if ts < '2026-09-03 22:00': continue
       rh=e.get('resp_headers',{})
       print(ts, e.get('status'), uri, 'x-nextjs-cache=%s'%rh.get('X-Nextjs-Cache'))
   PY
   ```
   Record the first row after 22:37:47 as the pinned observation in §1.
2. **Confirm the self-heal:** load `https://beta.afldb.com/seasons/2026` twice, about 10 s
   apart, with a beta/admin cookie (now that 23:14:46 AEST has passed). Expect the second load
   to show a "Wildcard Final" heading with Western Bulldogs v Collingwood (28 Aug) and
   Melbourne v Carlton (29 Aug). Then prove it on disk:
   ```bash
   # PROD afldb-prod
   f=/home/arm/projects/afldb/.next/standalone/.next/server/app/seasons/2026.html
   stat -c %y "$f"; grep -o -i wildcard "$f" | wc -l; grep -o 'id="wildcard-final"' "$f" | wc -l
   ```
   Expect an mtime later than 23:14:46 AEST and non-zero counts.
3. **If step 2 regenerates the file (new mtime) but the counts stay 0**, reclassify as a
   **genuine application defect** not reproduced by ISSUE-132 T1 and open the next stage of this
   issue with the served HTML captured. **If the file never regenerates** despite requests,
   the fault is in ISR regeneration for this route (a different defect class); capture the
   `afldb` journal around the request time.
4. Otherwise mark this issue Resolved (classification stands), decide the §8 follow-up, and
   reconcile the ISSUE-131 bookkeeping drift noted in F5.

---

## 10. Stage record — 2026-09-03

- Repository files changed: `issues/open/AFLDB-ISSUE-133.md` (new), `issues.md` (ledger
  entry, Open Issues table/count, ISSUE-132 Follow-up cross-reference), `IssuesIndex.md`
  (row, count, allocation note). No `CHANGELOG.md` entry (investigation only).
- PROD commands: two read-only SSH probes (§2). DEV: none. Nothing committed.

**Closeout 2026-09-03 (same day, later session):** operator-run read-only production
verification (§11.1); issue resolved (§11.2); ISSUE-131 bookkeeping corrected (§11.3);
`AFLDB-ISSUE-134` allocated (§11.4); files in §11.5. Nothing committed.

---

## 11. Closeout — production verification and resolution (2026-09-03)

### 11.1 Operator verification (PROD `afldb-prod`, read-only, after the ISR window expired)

Live page: `https://beta.afldb.com/seasons/2026`, loaded by the operator, now visibly renders a
**Wildcard Final** section containing:

- Western Bulldogs 96–93 Collingwood, 28 Aug 2026
- Melbourne 55–74 Carlton, 29 Aug 2026

On-disk ISR entry, using the §9 step 2 command unchanged:

```bash
# PROD afldb-prod
f=/home/arm/projects/afldb/.next/standalone/.next/server/app/seasons/2026.html
stat -c %y "$f"
grep -o -i wildcard "$f" | wc -l
grep -o 'id="wildcard-final"' "$f" | wc -l
```

```text
2026-09-03 23:50:48.904873021 +1000
5
1
```

| Check | Before (§5, probed 23:42:39) | After (§11.1) | §9 step 2 expectation |
|---|---|---|---|
| `2026.html` mtime | 22:15:31 AEST (build copy) | **23:50:48 AEST** | later than 23:14:46 |
| "wildcard" occurrences (case-insensitive) | 0 | **5** | non-zero |
| `id="wildcard-final"` anchors | 0 | **1** | non-zero |

The entry regenerated after the ISR window expired, and the regenerated output contains the
Wildcard Final block. Both §9 step 3 reclassification branches (regenerated without the block;
never regenerates) are therefore excluded.

### 11.2 Final root cause and classification

**Stale/static/ISR cache output, caused by build-before-settle ordering plus the one-hour
revalidation window.** The 2026-09-03 production deploy ran `next build`, prerendering
`/seasons/2026` at 22:14:46 AEST, before the first settle on the new code inserted the two
`wildcard_final` rows at 22:37:47 AEST. With `revalidate = 3600` the route served the
pre-settle prerender until the first request after 23:14:46 AEST triggered background
regeneration, which had been written by 23:50:48 AEST. The evidence already established in
§3–§5 stands: the deployed revision, the Wildcard Final semantics, migrations 084/085, the two
canonical rows, `getSeasonMatches`' query shape and `seasons.last_loaded_round = 'WF'` were all
correct throughout.

**There is no application defect and no data/query defect. No application fix was made in
ISSUE-133** — no code, test, migration, deployment configuration, production state or cache was
changed. The page self-healed by design.

§9 step 1 (pinning the exact observation time from the Caddy access log) was **not run**. It
is not required for this classification: the pre-settle prerender was the only season-page
content on disk between 22:37:47 and the regeneration, so any cookie-bearing request in that
window received it. §1's bounds are the final record of the observation.

### 11.3 ISSUE-131 bookkeeping reconciliation (F5)

The `IssuesIndex.md` row, the `issues.md` Open Issues row and ledger Status/Production posture,
and the `issues/open/AFLDB-ISSUE-131.md` header still said "unmerged; production untouched,
timer still STOPPED". This closeout appends a dated correction to each, citing §3–§4 here:
ISSUE-131 is merged as `657a875`, deployed as production `HEAD`, `afldb-settle-afltables.timer`
is **active**, and settle batches 735–738 ran on the evening of 2026-09-03 (735 inserted the
two Wildcard Final rows; 736–738 were 0/0). ISSUE-131 is **not** resolved here: its runbook §8
acceptance evidence (R preflight, `repair-match-rekeys` dry run/apply, supervised settle and
identical rerun) is not recorded anywhere in the repository and remains the operator's to
record. No ISSUE-131 implementation was altered.

### 11.4 Follow-up handed off — `AFLDB-ISSUE-134`

Allocated 2026-09-03 as **`AFLDB-ISSUE-134` — current-season settle should
invalidate/revalidate affected public season ISR** (ledger entry in `issues.md`, row in
`IssuesIndex.md`). Scope, deliberately narrow:

- a successful in-season settle changes canonical season data (batch 735 here is the worked
  example);
- currently nothing in the settle path invalidates `/seasons/[year]` — `src/lib/acquisition/`
  and `deploy/` contain no `revalidatePath`/`revalidateTag` call, and the nightly timer does
  not rebuild; the only in-process precedents are the admin server actions
  (`src/app/admin/data-editor/actions.ts` revalidates the root layout;
  `src/app/admin/current-season/actions.ts` revalidates only `/admin/current-season`);
- production can therefore serve stale season output for up to one hour after every in-season
  settle, and for the full window after any deploy that builds before the first settle;
- investigate the correct Next.js invalidation mechanism (`revalidateTag('_N_T_/seasons/<season>')`,
  the tag the deployed `2026.meta` carries, versus `revalidatePath`, versus the documented
  rebuild) and the transaction/deployment boundary at which it must fire, given that the settle
  runs outside the Next.js server process and the cluster keeps a per-worker in-memory ISR LRU
  in front of the file cache (§5).

Not implemented in this session. Validation evidence and the exact next action are recorded in
the ISSUE-134 ledger entry.

### 11.5 Files changed in the closeout

`issues/open/AFLDB-ISSUE-133.md` → `issues/closed/AFLDB-ISSUE-133.md` (moved and amended:
Status/Classification, §8 follow-up lead, §9 outcome, §10, this §11); `issues.md` (ISSUE-133
entry resolved; Open Issues table and count; allocation note; ISSUE-132 Follow-up path;
ISSUE-131 Status and Production posture corrections; new ISSUE-134 entry); `IssuesIndex.md`
(ISSUE-133 row retired, ISSUE-134 row added, ISSUE-131 row corrected, count and allocation
note); `issues/open/AFLDB-ISSUE-131.md` (one dated header note). No `CHANGELOG.md` entry (no
retained behaviour change). Nothing committed.
